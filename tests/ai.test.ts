import { describe, expect, it } from 'vitest';
import {
  AIRequestError,
  buildTasteAnalysisPrompt,
  describeAIError,
  formatAIError,
  hasSubstantiveAnalysis,
  MAX_TASTE_PROMPT_ENTRIES,
  normalizeTasteAnalysis,
} from '../services/geminiService';
import { buildPortraitImagePrompt } from '../services/chatgptBridge';
import { buildTasteModel } from '../features/taste/tasteModel';
import { sessionAIConfigSchema } from '../shared/schemas/ai';
import { SUPPORTED_LOCALES } from '../shared/i18n/locales';
import { createTranslator } from '../shared/i18n/translate';
import { Anime } from '../types';

const anime = (index: number, overrides: Partial<Anime> = {}): Anime => ({
  id: String(index),
  title: { native: `作品 ${index}`, romaji: `Work ${index}`, english: `Work ${index}` },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2020,
  genres: ['Drama'],
  userStatus: 'COMPLETED',
  userReaction: 'LIKE',
  ...overrides,
});

const RETIRED_LABELS = ['二次元浓度', '萌豚', '婆罗门', '老二次元', '现充', '动漫之神', '路人', '动画爱好者'];

describe('AI data boundary', () => {
  it('accepts secure personal endpoints and rejects public HTTP endpoints', () => {
    expect(
      sessionAIConfigSchema.parse({
        provider: 'DEEPSEEK',
        apiKey: 'session-key',
        endpoint: 'https://api.example.com/v1/chat/completions',
        model: 'example-model',
      }).endpoint
    ).toContain('https://');

    expect(() =>
      sessionAIConfigSchema.parse({
        provider: 'DEEPSEEK',
        apiKey: 'session-key',
        endpoint: 'http://api.example.com/chat',
        model: 'example-model',
      })
    ).toThrow();
  });

  it('normalizes incomplete model output into the stable UI shape', () => {
    const result = normalizeTasteAnalysis({ tags: ['标签'], analysis: '分析文本' });

    expect(result.tags).toHaveLength(6);
    expect(result.questions).toEqual([]);
    expect(result.roast).toBe('分析文本');
  });

  it('treats a result made only of placeholder padding as a failed analysis', () => {
    expect(hasSubstantiveAnalysis(normalizeTasteAnalysis({}))).toBe(false);
    expect(hasSubstantiveAnalysis(normalizeTasteAnalysis({ tags: ['', '待补充'], questions: ['待补充'] }))).toBe(false);
    expect(hasSubstantiveAnalysis(normalizeTasteAnalysis({ analysis: '真正的分析' }))).toBe(true);
  });

  it('does not send any retired rank, score or stereotype label to the AI', () => {
    for (const prompt of [
      buildTasteAnalysisPrompt([anime(1)], 'zh-CN'),
      buildTasteAnalysisPrompt([anime(1, { userStatus: 'PLAN', userReaction: undefined })], 'en'),
      buildTasteAnalysisPrompt([], 'ja'),
    ]) {
      expect(prompt).not.toContain('用户画像等级');
      for (const label of RETIRED_LABELS) expect(prompt).not.toContain(label);
    }
  });

  it('sends structured evidence that keeps exposure, preference, unknown reactions and intent apart', () => {
    const archive = [
      ...Array.from({ length: 6 }, (_, index) => anime(index, { genres: ['Slice of Life'], userReaction: 'HATE' })),
      anime(20, { genres: ['Slice of Life'], userReaction: undefined }),
      anime(21, { genres: ['Slice of Life'], userReaction: 'NEUTRAL' }),
      anime(30, { userStatus: 'PLAN', userReaction: 'LOVE', genres: ['Romance'] }),
    ];
    const prompt = buildTasteAnalysisPrompt(archive, 'zh-CN');

    expect(prompt).toContain('口味证据');
    expect(prompt).toContain('偏负向的题材：Slice of Life（看过 8；明确感受 7：正向 0、一般 1、负向 6；未标记 1）');
    expect(prompt).toContain('偏正向的题材：无');
    expect(prompt).toContain('想看清单中的题材（意向）：Romance 1 部');
    expect(prompt).toContain('作品 20（别名：Work 20）【播出2020；未知形式；已看完；未标记感受（未知，不等于一般）');
    expect(prompt).toContain('作品 21（别名：Work 21）【播出2020；未知形式；已看完；一般（用户明确选择）');
    expect(prompt).toContain('区分事实与解读');
  });

  it('tells the AI when evidence is too thin for conclusions', () => {
    expect(buildTasteAnalysisPrompt([anime(1, { userStatus: 'PLAN', userReaction: undefined })], 'en')).toContain(
      '只有“想看”'
    );
    expect(buildTasteAnalysisPrompt([anime(1), anime(2)], 'en')).toContain('明确感受很少');
  });

  it('explains site AI failures to users without operator configuration details', () => {
    const description = describeAIError(
      new AIRequestError('not configured', { source: 'site', status: 503, code: 'AI_NOT_CONFIGURED' }),
      'site'
    );

    expect(description).toEqual({ key: 'aiError.notConfigured', source: 'site' });
    for (const locale of SUPPORTED_LOCALES) {
      const message = formatAIError(description, createTranslator(locale).t);
      expect(message).not.toMatch(/Render|DEEPSEEK_API_KEY|CORS_ORIGINS|proxy/i);
    }
  });

  it('explains provider failures without exposing credentials or upstream bodies', () => {
    const description = describeAIError(
      new AIRequestError('upstream failure', { source: 'personal', status: 402 }),
      'personal'
    );
    const message = formatAIError(description, createTranslator('zh-CN').t);

    expect(message).toContain('余额不足');
    expect(message).toContain('个人模型');
    expect(message).not.toContain('upstream failure');
  });

  it('bounds archive data included in an AI prompt', () => {
    const prompt = buildTasteAnalysisPrompt(
      Array.from({ length: MAX_TASTE_PROMPT_ENTRIES + 10 }, (_, index) => anime(index)),
      'zh-CN'
    );

    expect(prompt).toContain(`本次完整索引纳入：${MAX_TASTE_PROMPT_ENTRIES} 部`);
    expect(prompt.length).toBeLessThan(80_000);
  });

  it('does not ask the AI for anime recommendations and ignores any it returns', () => {
    const prompt = buildTasteAnalysisPrompt([anime(1)], 'en');
    expect(prompt).not.toContain('"recommendations"');
    expect(prompt).not.toContain('"avoid"');
    expect(prompt).toContain('不要推荐、列举或暗示任何索引之外的新作品');

    const pasted = normalizeTasteAnalysis({
      analysis: '分析',
      questions: ['问题一', '问题二', '问题三', '问题四'],
      recommendations: [{ title: 'Some Show', reason: 'because' }],
      avoid: [{ title: 'Other Show', reason: 'because' }],
    });
    expect(pasted).not.toHaveProperty('recommendations');
    expect(pasted).not.toHaveProperty('avoid');
    expect(pasted.questions).toEqual(['问题一', '问题二', '问题三']);
  });

  it('keeps the complete archive index while adding high-signal evidence', () => {
    const archive = Array.from({ length: 432 }, (_, index) => anime(index));
    archive[0] = anime(0, { userNote: '这部作品的演出和配乐让我印象很深。' });

    const prompt = buildTasteAnalysisPrompt(archive, 'zh-CN');

    expect(prompt).toContain('完整作品索引');
    expect(prompt).toContain('作品 0');
    expect(prompt).toContain('作品 431');
    expect(prompt).toContain('这部作品的演出和配乐让我印象很深。');
    expect(prompt.length).toBeLessThan(60_000);
  });

  it('prioritizes reviews without requiring one for every archived title', () => {
    const archive = [anime(1, { userNote: '重点短评' }), anime(2, { userNote: undefined, userReaction: 'NEUTRAL' })];
    const prompt = buildTasteAnalysisPrompt(archive, 'zh-CN');

    expect(prompt).toContain('其中 1 部写过短评');
    expect(prompt).toContain('没有短评的作品仍须依据观看状态');
    expect(prompt).toContain('重点短评');
    expect(prompt).toContain('作品 2');
  });

  it('builds the portrait image prompt from favorites and positive themes, never from plans or labels', () => {
    const archive = [
      ...Array.from({ length: 4 }, (_, index) =>
        anime(index, { userReaction: 'LOVE', genres: ['Music'], userNote: index === 0 ? '配乐很动人' : undefined })
      ),
      anime(10, { userStatus: 'PLAN', userReaction: undefined, genres: ['Mecha'] }),
      anime(11, { userReaction: undefined, genres: ['Sports'] }),
    ];
    const prompt = buildPortraitImagePrompt(buildTasteModel(archive));

    expect(prompt).toContain('作品 0（短评：配乐很动人）');
    expect(prompt).toContain('用户明确喜欢的题材（基于至少 3 部有感受记录的作品）：Music');
    expect(prompt).not.toContain('作品 10');
    expect(prompt).not.toContain('Mecha');
    for (const label of RETIRED_LABELS) expect(prompt).not.toContain(label);
  });
});
