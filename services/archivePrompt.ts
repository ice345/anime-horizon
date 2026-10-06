import { normalizeReaction } from '../features/archive/archiveOperations';
import { isMissingWatchHistory } from '../features/journey/journeyEvents';
import { DimensionTaste, Stance, TasteModel } from '../features/taste/tasteModel';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';

export const MAX_ARCHIVE_PROMPT_ENTRIES = 512;
export const MAX_ARCHIVE_PROMPT_HIGHLIGHTS = 48;

// Prompt instructions are written in Chinese; the output language is set separately per request.
export const statusLabels: Record<UserAnimeStatus, string> = {
  PLAN: '想看（仅为意向，未观看）',
  WATCHING: '在看（部分观看）',
  COMPLETED: '已看完',
};

export const reactionLabels: Record<UserAnimeReaction, string> = {
  LOVE: '非常喜欢',
  LIKE: '喜欢',
  NEUTRAL: '一般（用户明确选择）',
  DISLIKE: '不太喜欢',
  HATE: '不喜欢',
};

/** A title without a reaction: the user's feeling is unknown. It is not the same as 一般. */
export const UNRATED_LABEL = '未标记感受（未知，不等于一般）';

const compactText = (value: string, max: number) =>
  value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const uniqueTitles = (anime: Anime) =>
  Array.from(new Set([anime.title.native, anime.title.romaji, anime.title.english].filter(Boolean))).map((title) =>
    compactText(title, 80)
  );

export const promptTitleOf = (anime: Anime) => uniqueTitles(anime)[0] || '未命名作品';

const normalizeStatus = (status?: UserAnimeStatus): UserAnimeStatus =>
  status === 'WATCHING' || status === 'COMPLETED' ? status : 'PLAN';

const reactionText = (anime: Anime) => {
  const reaction = normalizeReaction(anime.userReaction);
  return reaction ? reactionLabels[reaction] : UNRATED_LABEL;
};

export const formatArchiveIndexEntry = (anime: Anime) => {
  const titles = uniqueTitles(anime);
  const aliases = titles.slice(1).join(' / ');
  const genres =
    Array.from(new Set((anime.genres || []).filter(Boolean)))
      .slice(0, 3)
      .join('/') || '未知题材';
  const status = statusLabels[normalizeStatus(anime.userStatus)];
  const year = Number.isFinite(anime.seasonYear) ? anime.seasonYear : '未知年份';
  const format = compactText(anime.format || '未知形式', 24);
  const catalogueScore = Number.isFinite(anime.averageScore) ? `；站内参考评分${anime.averageScore}` : '';
  const popularity = Number.isFinite(anime.popularity) ? `；站内人气${anime.popularity}` : '';

  return `- ${promptTitleOf(anime)}${aliases ? `（别名：${compactText(aliases, 160)}）` : ''}【播出${year}；${format}；${status}；${reactionText(anime)}；${compactText(genres, 80)}${catalogueScore}${popularity}】`;
};

export const formatArchiveHighlight = (anime: Anime) => {
  const note = anime.userNote?.trim() ? `；短评：${compactText(anime.userNote, 180)}` : '';
  return `${formatArchiveIndexEntry(anime)}${note}`;
};

const evidenceScore = (anime: Anime) => {
  const status = normalizeStatus(anime.userStatus);
  const statusScore = { PLAN: 0, WATCHING: 2, COMPLETED: 3 }[status];
  const reaction = normalizeReaction(anime.userReaction);
  // Reactions on PLAN titles are not preference evidence (see docs/taste-model.md).
  const reactionScore = status === 'PLAN' || !reaction || reaction === 'NEUTRAL' ? 0 : 3;
  // A short review is the strongest explicit signal, but status/reaction still
  // keep unwritten entries useful when a large archive has only a few reviews.
  const noteScore = anime.userNote?.trim() ? 8 : 0;
  return statusScore + reactionScore + noteScore;
};

export const buildArchivePromptData = (anime: Anime[]) => {
  const entries = anime.slice(0, MAX_ARCHIVE_PROMPT_ENTRIES);
  const statusCounts = entries.reduce(
    (counts, item) => {
      counts[normalizeStatus(item.userStatus)] += 1;
      return counts;
    },
    { PLAN: 0, WATCHING: 0, COMPLETED: 0 }
  );
  const highlights = entries
    .map((item, index) => ({ item, index, score: evidenceScore(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_ARCHIVE_PROMPT_HIGHLIGHTS)
    .map(({ item }) => item);
  const reviewCount = entries.filter((item) => Boolean(item.userNote?.trim())).length;

  return {
    sourceCount: anime.length,
    includedCount: entries.length,
    reviewCount,
    highlightCount: highlights.length,
    statusCounts,
    indexText: entries.map(formatArchiveIndexEntry).join('\n') || '无',
    highlightText: highlights.map(formatArchiveHighlight).join('\n') || '无',
  };
};

const STANCE_TEXT: Record<Stance, string> = {
  positive: '偏正向',
  negative: '偏负向',
  mixed: '褒贬不一',
  neutral: '多为“一般”或无明显倾向',
  insufficient: '感受证据不足',
};

const STATE_TEXT: Record<TasteModel['state'], string> = {
  empty: '年鉴为空：没有任何口味证据。',
  intentOnly: '只有“想看”：没有观看记录，只能谈兴趣意向，不能谈口味。',
  unrated: '有观看记录但没有任何明确感受：只能描述接触面，不能判断喜好。',
  sparse: '明确感受很少（少于 5 部）：只能作为有限观察，不能推出稳定结论。',
  ready: '有一定数量的明确感受，可以做克制归纳。',
};

const ERA_TEXT: Record<TasteModel['range']['eraLean'], string> = {
  acrossDecades: '跨越多个年代',
  mostlyRecent: '多为近十年的作品',
  mostlyOneDecade: '集中在某一个年代',
  mixed: '新旧混合',
  unknown: '样本太少，无法描述',
};

const POPULARITY_TEXT: Record<TasteModel['popularity']['lean'], string> = {
  mainstream: '多为知名作品',
  mixed: '知名与小众混合',
  lessKnown: '包含相当比例的较少人看过的作品',
  unknown: '样本太少或缺少人气数据',
};

const dimensionLine = (item: DimensionTaste) =>
  `${item.key}（看过 ${item.watched}；明确感受 ${item.rated}：正向 ${item.positive}、一般 ${item.neutral}、负向 ${item.negative}；未标记 ${item.unrated}）`;

const listOrNone = (items: DimensionTaste[], limit = 8) => items.slice(0, limit).map(dimensionLine).join('；') || '无';

const titleList = (items: Anime[]) =>
  items
    .map((anime) => {
      const note = anime.userNote?.trim() ? `，短评：${compactText(anime.userNote, 120)}` : '';
      return `${promptTitleOf(anime)}（${reactionText(anime)}${note}）`;
    })
    .join('；') || '无';

/**
 * Structured, language-neutral evidence derived from the descriptive taste model. Every line is a
 * fact computed locally; the model is asked to interpret it, not to recompute or exaggerate it.
 */
export const formatTasteEvidence = (model: TasteModel, archive: Anime[]) => {
  const { totals } = model;
  const pick = (stance: Stance) => model.genres.filter((genre) => genre.stance === stance);
  const watched = archive.filter((anime) => normalizeStatus(anime.userStatus) !== 'PLAN');
  const missingDates = archive.filter(isMissingWatchHistory).length;
  const eraLine =
    model.eras.map((era) => `${era.key}年代 ${era.watched} 部（${STANCE_TEXT[era.stance]}）`).join('；') || '无';
  const formatLine =
    model.formats.map((format) => `${format.key} ${format.watched} 部（${STANCE_TEXT[format.stance]}）`).join('；') ||
    '无';

  return [
    `证据状态：${STATE_TEXT[model.state]}`,
    `观看：已看完 ${totals.completed} 部，在看 ${totals.watching} 部（部分观看）；想看 ${totals.planned} 部（只代表意向，不算看过，也不算喜欢）。`,
    `明确感受（只统计看过的作品）：共 ${totals.rated} 部，其中正向（喜欢/非常喜欢）${totals.positive}、一般 ${totals.neutral}、负向（不太喜欢/不喜欢）${totals.negative}；看过但未标记感受 ${totals.unrated} 部（感受未知，不能当作“一般”）。`,
    `题材倾向的判定规则：某题材至少有 3 部看过且明确标记感受的作品才判断方向；看得多不等于喜欢。`,
    `偏正向的题材：${listOrNone(pick('positive'))}`,
    `褒贬不一的题材：${listOrNone(pick('mixed'))}`,
    `偏负向的题材：${listOrNone(pick('negative'))}`,
    `接触最多的题材（仅代表看过，不代表喜欢）：${listOrNone(model.genres, 10)}`,
    `想看清单中的题材（意向）：${
      model.intentGenres
        .slice(0, 8)
        .map((item) => `${item.key} ${item.planned} 部`)
        .join('；') || '无'
    }`,
    `已观看作品的播出年代：${ERA_TEXT[model.range.eraLean]}；分布：${eraLine}`,
    `已观看作品的形式：${formatLine}`,
    `知名度（AniList 收藏人数的快照，只描述作品有多少人看过，不代表质量或品味高低）：知名 ${model.popularity.wellKnown}、中间 ${model.popularity.between}、较少人看过 ${model.popularity.lessKnown}、未知 ${model.popularity.unknown}；${POPULARITY_TEXT[model.popularity.lean]}。`,
    `观看日期记录：已观看 ${watched.length} 部中，有 ${missingDates} 部缺少观看日期；不要根据播出年份推断用户何时观看。`,
    `明确喜欢的作品：${titleList(model.favorites)}`,
    `明确不喜欢的作品：${titleList(model.dislikes)}`,
  ].join('\n');
};
