import { Anime } from '../types';
import {
  chatCompletionResponseSchema,
  normalizedTasteAnalysisSchema,
  sessionAIConfigSchema,
  tasteAnalysisPayloadSchema,
  TasteAnalysisResult,
  SessionAIConfig,
} from '../shared/schemas/ai';
import { buildArchivePromptData, formatTasteEvidence } from './archivePrompt';
import { buildTasteModel } from '../features/taste/tasteModel';
import { Locale } from '../shared/i18n/locales';
import { Translator } from '../shared/i18n/translate';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEFAULT_DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_MS = 45_000;
const env = import.meta.env;
const DEEPSEEK_PROXY_URL = env.VITE_DEEPSEEK_PROXY_URL || '/api/deepseek/chat';
const SESSION_AI_CONFIG_KEY = 'anime-horizon-session-ai-config';
const LEGACY_SESSION_DEEPSEEK_KEY = 'anime-horizon-session-deepseek-key';

export type { SessionAIConfig, SessionAIProvider, TasteAnalysisResult } from '../shared/schemas/ai';
export { MAX_ARCHIVE_PROMPT_ENTRIES as MAX_TASTE_PROMPT_ENTRIES } from './archivePrompt';

type AIRequestSource = 'personal' | 'site';

export class AIRequestError extends Error {
  readonly source: AIRequestSource;
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { source: AIRequestSource; status?: number; code?: string }) {
    super(message);
    this.name = 'AIRequestError';
    this.source = options.source;
    this.status = options.status;
    this.code = options.code;
  }
}

const readErrorCode = async (res: Response) => {
  try {
    const payload = (await res.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : undefined;
  } catch {
    return undefined;
  }
};

export type AIErrorMessageKey =
  | 'aiError.notConfigured'
  | 'aiError.originRejected'
  | 'aiError.emptyResult'
  | 'aiError.busy'
  | 'aiError.auth'
  | 'aiError.balance'
  | 'aiError.invalidRequest'
  | 'aiError.rateLimited'
  | 'aiError.timeout'
  | 'aiError.personalUnreachable'
  | 'aiError.siteUnavailable';

/** Language-neutral description of an AI failure; the UI translates it with `formatAIError`. */
export interface AIErrorDescription {
  key: AIErrorMessageKey;
  source: AIRequestSource;
}

export const describeAIError = (error: unknown, source: AIRequestSource): AIErrorDescription => {
  const requestError = error instanceof AIRequestError ? error : undefined;
  const status = requestError?.status;
  const code = requestError?.code;
  const describe = (key: AIErrorMessageKey): AIErrorDescription => ({ key, source });

  if (code === 'AI_NOT_CONFIGURED') return describe('aiError.notConfigured');
  if (code === 'CORS_FORBIDDEN' || code === 'ORIGIN_REQUIRED') return describe('aiError.originRejected');
  if (code === 'AI_EMPTY_RESULT') return describe('aiError.emptyResult');
  if (code === 'RATE_LIMITED' || code === 'AI_QUOTA_EXCEEDED' || code === 'CONCURRENCY_LIMITED')
    return describe('aiError.busy');
  if (code === 'AI_UPSTREAM_AUTH' || status === 401 || status === 403) return describe('aiError.auth');
  if (code === 'AI_UPSTREAM_BALANCE' || status === 402) return describe('aiError.balance');
  if (code === 'AI_UPSTREAM_INVALID_REQUEST' || status === 404 || status === 422)
    return describe('aiError.invalidRequest');
  if (code === 'AI_UPSTREAM_RATE_LIMITED' || status === 429) return describe('aiError.rateLimited');
  if (code === 'AI_TIMEOUT' || (error instanceof DOMException && error.name === 'AbortError'))
    return describe('aiError.timeout');
  if (source === 'personal' && (!requestError || requestError.status === undefined))
    return describe('aiError.personalUnreachable');
  return describe('aiError.siteUnavailable');
};

export const formatAIError = (description: AIErrorDescription, t: Translator['t']) =>
  t(description.key, {
    source: t(description.source === 'personal' ? 'aiError.sourcePersonal' : 'aiError.sourceSite'),
  });

/**
 * Output-language rules appended to AI prompts. Prompts stay in Chinese; only the user-visible
 * prose the model writes follows the UI locale. JSON field names never change.
 */
const AI_OUTPUT_LANGUAGE: Record<Locale, { name: string; tagRule: string; titleRule: string }> = {
  'zh-CN': {
    name: '简体中文',
    tagRule: '2~5 个汉字',
    titleRule: '中文观众常用的作品名；不确定时使用日文原名',
  },
  ja: {
    name: '自然的日语',
    tagRule: '2~8 个字的日语短语',
    titleRule: '日本播出时的日文正式标题',
  },
  en: {
    name: '自然的英语',
    tagRule: '1~3 个英文单词',
    titleRule: '官方英文标题；没有官方英文标题时使用罗马字标题',
  },
};

export const getSessionAIConfig = (): SessionAIConfig | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_AI_CONFIG_KEY);
    if (raw) {
      const parsed = sessionAIConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }

    const legacyKey = window.sessionStorage.getItem(LEGACY_SESSION_DEEPSEEK_KEY)?.trim();
    if (!legacyKey) return null;
    const parsed = sessionAIConfigSchema.safeParse({
      provider: 'DEEPSEEK',
      apiKey: legacyKey,
      endpoint: DEFAULT_DEEPSEEK_ENDPOINT,
      model: DEFAULT_DEEPSEEK_MODEL,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const setSessionAIConfig = (config: SessionAIConfig) => {
  if (typeof window === 'undefined') return;
  const normalized = sessionAIConfigSchema.parse(config);
  window.sessionStorage.setItem(SESSION_AI_CONFIG_KEY, JSON.stringify(normalized));
  window.sessionStorage.removeItem(LEGACY_SESSION_DEEPSEEK_KEY);
};

export const clearSessionAIConfig = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_AI_CONFIG_KEY);
  window.sessionStorage.removeItem(LEGACY_SESSION_DEEPSEEK_KEY);
};

export const isUsingSessionAIConfig = () => Boolean(getSessionAIConfig());

/**
 * The AI reflection prompt. It interprets the archive's evidence; it never recommends titles. Anime
 * recommendations come only from the deterministic For You engine (docs/recommendations.md).
 */
export const buildTasteAnalysisPrompt = (archive: Anime[], locale: Locale) => {
  const language = AI_OUTPUT_LANGUAGE[locale];
  const archiveData = buildArchivePromptData(archive);
  const evidence = formatTasteEvidence(buildTasteModel(archive), archive);

  return `
    你是资深、客观且懂制作与叙事的动画鉴赏者。请根据用户主动建立的年鉴，写一份可靠、有证据的观看回顾。

    这是一次 JSON 输出任务。最终回复只能是一个合法 JSON 对象，不能有 Markdown、解释、前后缀或额外字段。即使证据不足，也必须保留全部字段并用“暂无数据”说明，不能编造用户没有看过或评价过的细节。

    年鉴记录：${archiveData.sourceCount} 部；本次完整索引纳入：${archiveData.includedCount} 部。
    评价证据统计：其中 ${archiveData.reviewCount} 部写过短评，本次选取 ${archiveData.highlightCount} 部作为重点证据。

    【口味证据（本地统计得出的事实，请直接引用，不要重新估算或夸大）】
    ${evidence}

    【完整作品索引】
    每行包含作品名、别名、播出年份、形式、用户状态、用户感受和题材：
    ${archiveData.indexText}

    【重点证据】
    以下记录优先包含已看完/在看、明确喜欢或不喜欢、以及写过短评的作品。举例时优先从这里选，但不要把重点样本误当成全部年鉴：
    ${archiveData.highlightText}

    证据边界：
    - 观看、喜欢、不喜欢、想看是四件不同的事。看得多只说明接触多，不说明喜欢；只有明确感受才能说明喜好。
    - “想看”只说明意向，不能当作用户看过或喜欢。“在看”是部分观看。
    - “未标记感受”表示不知道用户的感受，不能当作“一般”，也不能当作喜欢或不喜欢。
    - 短评是重点证据而不是必填项；没有短评的作品仍须依据观看状态、明确感受、题材和年份参与整体归纳，不要因为没有逐部点评就忽略它们。
    - 证据状态为“有限观察”或更少时，必须明确说明样本不足，只描述观察到的事实，不做稳定结论。
    - 播出年份描述作品，不代表用户在那一年观看；不要据此推断用户的年龄、经历或观看时间。
    - 知名度只描述作品有多少人看过；不要暗示小众代表品味更好，也不要暗示主流代表品味更差。
    - 不要使用任何等级、总分、百分比可信度、圈层身份标签或刻板印象；不要把用户归入某种人格类型或“资深程度”。
    - 只引用索引中确实存在的作品名，不要虚构用户短评、剧情细节、台词或观看经历。
    - 不要推荐、列举或暗示任何索引之外的新作品。发现新作品由应用中的“为你推荐”负责，它按固定规则从用户的感受计算；这份回顾只负责解读已有记录。

    区分事实与解读：
    - 事实：口味证据和索引里的计数、作品、感受。陈述事实时可以给出计数（如“看过的 18 部音乐题材中，14 部标记为喜欢”）。
    - 解读：你对这些事实的理解。解读必须使用“可能”“似乎”“从现有记录看”等措辞，并说明依据；不能比证据更确定。

    输出语言：
    - 除 JSON 字段名外，所有面向用户的文字（tags、analysis、personality、goldenEra、questions）都必须使用${language.name}撰写，语气自然，不要逐字翻译本说明。
    - 提到作品名时使用${language.titleRule}。
    - JSON 字段名必须保持下方结构中的英文原样，不得翻译或改名。

    输出字段要求：
    - tags：正好 6 个${language.tagRule}的描述性标签，来自偏正向题材、明确喜欢的作品和观看范围；不要使用身份或等级标签，不要照抄示例。
    - analysis：分段点评。第一段只陈述事实（引用上方计数与作品）；之后再给出解读，比较人物、叙事、演出、配乐或情绪密度，并说明每个解读的依据。证据不足时直接说明，不要硬凑。
    - personality：对观看方式的克制解读（例如偏好的叙事节奏、在意的制作要素），必须标明这是解读并引用 1~2 部明确有感受的作品；不要做人格诊断或现实履历推断。证据不足时说明“记录还不够”。
    - goldenEra：描述已观看作品的播出年代分布（事实），只有当明确感受支持时才说某个年代更受喜欢；否则只说“看得较多”。
    - questions：2~3 个留给用户自己思考的开放问题或小提议，基于上面的证据（例如“喜欢与不喜欢的同题材作品之间差在哪里？”、“哪些看过的作品还没有标记感受？”）。不要在问题里推荐新作品。

    JSON 结构必须严格如下：
    {
      "tags": ["标签1", "标签2", "标签3", "标签4", "标签5", "标签6"],
      "analysis": "深度点评",
      "personality": "克制解读",
      "goldenEra": "年代分布及依据",
      "questions": ["问题1", "问题2"]
    }

    现在只输出最终 JSON。
  `;
};

const parseJsonSafe = (text?: string): unknown => {
  if (!text) throw new Error('Empty response');
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e;
  }
};

export const normalizeTasteAnalysis = (source: unknown): TasteAnalysisResult => {
  const data = typeof source === 'string' ? parseJsonSafe(source) : source;
  const safe = tasteAnalysisPayloadSchema.parse(data || {});
  const fallbackText = '暂无数据';

  const tags = safe.tags.slice(0, 6).map((tag) => tag || '待补充');
  while (tags.length < 6) tags.push('待补充');

  return normalizedTasteAnalysisSchema.parse({
    tags,
    roast: safe.roast || safe.analysis || fallbackText,
    personality: safe.personality || fallbackText,
    goldenEra: safe.goldenEra || fallbackText,
    questions: safe.questions.filter((question) => question && !PLACEHOLDER_VALUES.has(question)).slice(0, 3),
  });
};

const PLACEHOLDER_VALUES = new Set(['待补充', '暂无数据', '']);

export const isPlaceholderText = (value: string | undefined) => PLACEHOLDER_VALUES.has((value || '').trim());

/**
 * True when a normalized result contains real model content. The normalizer pads missing
 * fields with placeholders so the UI shape stays stable; a result made only of padding is a
 * failed analysis and must never be shown or cached as a report.
 */
export const hasSubstantiveAnalysis = (result: TasteAnalysisResult) =>
  !isPlaceholderText(result.roast) ||
  !isPlaceholderText(result.personality) ||
  !isPlaceholderText(result.goldenEra) ||
  result.tags.some((tag) => !isPlaceholderText(tag)) ||
  result.questions.length > 0;

const callSessionAI = async (prompt: string, config: SessionAIConfig) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        ...(config.provider === 'DEEPSEEK' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const code = await readErrorCode(res);
      throw new AIRequestError(`Personal AI API Error ${res.status}`, {
        source: 'personal',
        status: res.status,
        code,
      });
    }

    const data = chatCompletionResponseSchema.parse(await res.json());
    return parseJsonSafe(data.choices[0].message.content);
  } catch (error) {
    if (error instanceof AIRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AIRequestError('Personal AI request timed out', { source: 'personal', code: 'AI_TIMEOUT' });
    }
    throw new AIRequestError('Personal AI request could not reach the endpoint', { source: 'personal' });
  } finally {
    clearTimeout(timer);
  }
};

const callDeepSeekRaw = async (prompt: string) => {
  const sessionConfig = getSessionAIConfig();
  if (sessionConfig) {
    // A personal session provider must never fall back to the site account after it is enabled.
    return callSessionAI(prompt, sessionConfig);
  }

  const callServerProxy = async () => {
    const res = await fetch(DEEPSEEK_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok) {
      const code = await readErrorCode(res);
      throw new AIRequestError(`DeepSeek proxy error ${res.status}`, {
        source: 'site',
        status: res.status,
        code,
      });
    }

    const data = chatCompletionResponseSchema.parse(await res.json());
    return parseJsonSafe(data.choices[0].message.content);
  };

  try {
    return await callServerProxy();
  } catch (error) {
    if (error instanceof AIRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AIRequestError('Site AI request timed out', { source: 'site', code: 'AI_TIMEOUT' });
    }
    throw new AIRequestError('Site AI request could not reach the proxy', { source: 'site' });
  }
};

const callDeepSeek = async (prompt: string) => {
  const source: AIRequestSource = getSessionAIConfig() ? 'personal' : 'site';
  let result: TasteAnalysisResult;
  try {
    result = normalizeTasteAnalysis(await callDeepSeekRaw(prompt));
  } catch (error) {
    if (error instanceof AIRequestError) throw error;
    throw new AIRequestError('AI response could not be parsed', { source, code: 'AI_EMPTY_RESULT' });
  }
  if (!hasSubstantiveAnalysis(result)) {
    throw new AIRequestError('AI response did not contain an analysis', { source, code: 'AI_EMPTY_RESULT' });
  }
  return result;
};

export const analyzeAnimeTaste = async (archive: Anime[], locale: Locale) =>
  callDeepSeek(buildTasteAnalysisPrompt(archive, locale));
