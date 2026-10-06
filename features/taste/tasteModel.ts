import { normalizeReaction } from '../archive/archiveOperations';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../../types';

/**
 * Descriptive taste model (see docs/taste-model.md).
 *
 * It keeps four things apart that the retired "otaku rank" model mixed together:
 * - exposure: what the user has actually watched (COMPLETED, and WATCHING as partial viewing);
 * - preference: what the user explicitly said about watched titles (LOVE … HATE);
 * - unknown preference: watched titles without a reaction (never treated as NEUTRAL);
 * - intent: PLAN titles, which are neither viewing nor preference evidence.
 *
 * There is no overall score, rank or confidence percentage. Every conclusion carries the counts it
 * was derived from, and conclusions are withheld when there are too few explicit reactions.
 */
export const TASTE_MODEL_VERSION = 2;

/**
 * How much a title counts toward exposure. COMPLETED is full viewing; WATCHING is real but incomplete
 * viewing, so it counts half when ranking what the user has explored. PLAN is intent only.
 * Displayed counts are always whole titles; the weight only orders and sizes exposure.
 */
export const EXPOSURE_WEIGHT: Record<UserAnimeStatus, number> = { COMPLETED: 1, WATCHING: 0.5, PLAN: 0 };

/**
 * Signed preference signal of an explicit reaction. The scale is ordinal: it encodes direction
 * (positive / negative), "strong" versus "mild", and that NEUTRAL is an explicit middle answer.
 * It is used for an average direction only; no interval or probabilistic meaning is claimed.
 */
export const REACTION_SIGNAL: Record<UserAnimeReaction, number> = {
  LOVE: 2,
  LIKE: 1,
  NEUTRAL: 0,
  DISLIKE: -1,
  HATE: -2,
};

/** Fewest explicit reactions on watched titles before a dimension gets a direction (stance). */
export const MIN_REACTIONS_FOR_STANCE = 3;
/** Below this many reactions, evidence is "limited"; at or above SOLID_EVIDENCE it is "solid". */
export const LIMITED_EVIDENCE_BELOW = 5;
export const SOLID_EVIDENCE = 10;
/**
 * A dimension is "mixed" when at least a third of its reactions are positive and a third negative,
 * i.e. neither side clearly dominates. (A quarter put two-thirds-liked genres into "mixed".)
 */
const MIXED_SHARE = 1 / 3;
/** Share of reactions that must point one way for a positive or negative stance. */
const MAJORITY_SHARE = 0.5;

export type Stance = 'positive' | 'negative' | 'mixed' | 'neutral' | 'insufficient';
export type EvidenceLevel = 'none' | 'limited' | 'moderate' | 'solid';
export type TasteState = 'empty' | 'intentOnly' | 'unrated' | 'sparse' | 'ready';

export interface ReactionCounts {
  /** Watched titles with an explicit reaction. */
  rated: number;
  positive: number;
  loved: number;
  /** Explicit NEUTRAL ("it was okay"). */
  neutral: number;
  negative: number;
  hated: number;
  /** Watched titles without any reaction: preference unknown. */
  unrated: number;
  /** Sum of REACTION_SIGNAL over rated titles. */
  signal: number;
}

export interface DimensionTaste extends ReactionCounts {
  /** Genre name, decade (e.g. "1990"), format group or other dimension value. */
  key: string;
  /** COMPLETED + WATCHING titles. */
  watched: number;
  completed: number;
  watching: number;
  /** PLAN titles: intent, not exposure. */
  planned: number;
  /** Weighted exposure (EXPOSURE_WEIGHT). */
  exposure: number;
  stance: Stance;
  evidence: EvidenceLevel;
  /** Up to three watched titles behind a positive or negative reading, strongest first. */
  positiveExamples: Anime[];
  negativeExamples: Anime[];
}

export type FormatGroup = 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'OTHER';
export type EraLean = 'acrossDecades' | 'mostlyRecent' | 'mostlyOneDecade' | 'mixed' | 'unknown';
export type PopularityBand = 'wellKnown' | 'between' | 'lessKnown';
export type PopularityLean = 'mainstream' | 'mixed' | 'lessKnown' | 'unknown';

/** AniList "popularity" = number of AniList users with the title on a list, at the time it was fetched. */
export const POPULARITY_BANDS = { wellKnownFrom: 100_000, lessKnownBelow: 10_000 } as const;

export interface TasteModel {
  version: typeof TASTE_MODEL_VERSION;
  state: TasteState;
  totals: ReactionCounts & {
    titles: number;
    watched: number;
    completed: number;
    watching: number;
    planned: number;
    /** PLAN titles that carry a reaction; reported, but never used as preference evidence. */
    plannedWithReaction: number;
  };
  /** Genres of watched titles, most explored first. */
  genres: DimensionTaste[];
  /** Genres of PLAN titles only, most planned first. Intent, not taste. */
  intentGenres: Array<{ key: string; planned: number }>;
  /** Release decades of watched titles, oldest first. Describes exposure, not preference. */
  eras: DimensionTaste[];
  formats: DimensionTaste[];
  range: {
    eraLean: EraLean;
    /** Decade that dominates when eraLean is "mostlyOneDecade". */
    mainDecade: number | null;
    earliestYear: number | null;
    latestYear: number | null;
    decades: number;
    formatGroups: number;
  };
  popularity: Record<PopularityBand, number> & { unknown: number; lean: PopularityLean };
  /** Watched titles the user loved or liked: LOVE first, then titles with notes, then most recent. */
  favorites: Anime[];
  /** Watched titles the user disliked: HATE first. */
  dislikes: Anime[];
}

const statusOf = (anime: Anime): UserAnimeStatus =>
  anime.userStatus === 'WATCHING' || anime.userStatus === 'COMPLETED' ? anime.userStatus : 'PLAN';

const isWatched = (anime: Anime) => statusOf(anime) !== 'PLAN';

/** Preference evidence only comes from watched titles; a reaction on a PLAN title is not counted. */
const preferenceOf = (anime: Anime): UserAnimeReaction | undefined =>
  isWatched(anime) ? normalizeReaction(anime.userReaction) : undefined;

const emptyCounts = (): ReactionCounts => ({
  rated: 0,
  positive: 0,
  loved: 0,
  neutral: 0,
  negative: 0,
  hated: 0,
  unrated: 0,
  signal: 0,
});

const addReaction = (counts: ReactionCounts, reaction: UserAnimeReaction | undefined) => {
  if (!reaction) {
    counts.unrated += 1;
    return;
  }
  counts.rated += 1;
  counts.signal += REACTION_SIGNAL[reaction];
  if (reaction === 'LOVE' || reaction === 'LIKE') counts.positive += 1;
  if (reaction === 'LOVE') counts.loved += 1;
  if (reaction === 'NEUTRAL') counts.neutral += 1;
  if (reaction === 'DISLIKE' || reaction === 'HATE') counts.negative += 1;
  if (reaction === 'HATE') counts.hated += 1;
};

export const evidenceLevel = (rated: number): EvidenceLevel =>
  rated === 0 ? 'none' : rated < LIMITED_EVIDENCE_BELOW ? 'limited' : rated < SOLID_EVIDENCE ? 'moderate' : 'solid';

/**
 * Direction of explicit reactions in one dimension.
 * - fewer than MIN_REACTIONS_FOR_STANCE reactions → insufficient (exposure alone never implies taste);
 * - at least a third positive and a third negative → mixed (checked first);
 * - at least half positive, and more positive than negative → positive;
 * - at least half negative, and more negative than positive → negative;
 * - otherwise neutral (mostly "okay", or no clear lean).
 * Shares, not the average signal, decide the stance: a genre that is two-thirds LIKE and one-third
 * DISLIKE reads as "mostly enjoyed" to a person, even though its average signal is small.
 */
export const classifyStance = (counts: ReactionCounts): Stance => {
  if (counts.rated < MIN_REACTIONS_FOR_STANCE) return 'insufficient';
  const positiveShare = counts.positive / counts.rated;
  const negativeShare = counts.negative / counts.rated;
  if (positiveShare >= MIXED_SHARE && negativeShare >= MIXED_SHARE) return 'mixed';
  if (positiveShare >= MAJORITY_SHARE && counts.positive > counts.negative) return 'positive';
  if (negativeShare >= MAJORITY_SHARE && counts.negative > counts.positive) return 'negative';
  return 'neutral';
};

const updatedAtOf = (anime: Anime) => Date.parse(anime.userHistory?.updatedAt ?? '') || 0;

/** Strongest reaction first, then titles with a note, then most recently updated, then id. */
const byStrength = (left: Anime, right: Anime) =>
  Math.abs(REACTION_SIGNAL[preferenceOf(right) ?? 'NEUTRAL']) -
    Math.abs(REACTION_SIGNAL[preferenceOf(left) ?? 'NEUTRAL']) ||
  Number(Boolean(right.userNote?.trim())) - Number(Boolean(left.userNote?.trim())) ||
  updatedAtOf(right) - updatedAtOf(left) ||
  String(left.id).localeCompare(String(right.id));

interface Accumulator extends ReactionCounts {
  key: string;
  watched: number;
  completed: number;
  watching: number;
  planned: number;
  exposure: number;
  positiveTitles: Anime[];
  negativeTitles: Anime[];
}

const accumulate = (archive: Anime[], keysOf: (anime: Anime) => string[]) => {
  const groups = new Map<string, Accumulator>();
  archive.forEach((anime) => {
    const status = statusOf(anime);
    const reaction = preferenceOf(anime);
    new Set(keysOf(anime)).forEach((key) => {
      const group = groups.get(key) ?? {
        key,
        ...emptyCounts(),
        watched: 0,
        completed: 0,
        watching: 0,
        planned: 0,
        exposure: 0,
        positiveTitles: [],
        negativeTitles: [],
      };
      groups.set(key, group);
      if (status === 'PLAN') {
        group.planned += 1;
        return;
      }
      group.watched += 1;
      group.exposure += EXPOSURE_WEIGHT[status];
      if (status === 'COMPLETED') group.completed += 1;
      else group.watching += 1;
      addReaction(group, reaction);
      if (reaction === 'LOVE' || reaction === 'LIKE') group.positiveTitles.push(anime);
      if (reaction === 'DISLIKE' || reaction === 'HATE') group.negativeTitles.push(anime);
    });
  });
  return Array.from(groups.values());
};

const toDimension = ({ positiveTitles, negativeTitles, ...group }: Accumulator): DimensionTaste => ({
  ...group,
  stance: classifyStance(group),
  evidence: evidenceLevel(group.rated),
  positiveExamples: [...positiveTitles].sort(byStrength).slice(0, 3),
  negativeExamples: [...negativeTitles].sort(byStrength).slice(0, 3),
});

const byExposure = (left: DimensionTaste, right: DimensionTaste) =>
  right.exposure - left.exposure || right.watched - left.watched || left.key.localeCompare(right.key);

export const formatGroupOf = (format: string | undefined): FormatGroup | null => {
  if (!format) return null;
  if (format === 'TV' || format === 'TV_SHORT') return 'TV';
  if (format === 'MOVIE' || format === 'OVA' || format === 'ONA' || format === 'SPECIAL') return format;
  return 'OTHER';
};

const decadeOf = (anime: Anime) =>
  Number.isFinite(anime.seasonYear) && anime.seasonYear > 1900 ? Math.floor(anime.seasonYear / 10) * 10 : null;

export const popularityBandOf = (anime: Anime): PopularityBand | null => {
  if (!anime.popularity || anime.popularity <= 0) return null;
  if (anime.popularity >= POPULARITY_BANDS.wellKnownFrom) return 'wellKnown';
  if (anime.popularity < POPULARITY_BANDS.lessKnownBelow) return 'lessKnown';
  return 'between';
};

/** Fewest watched titles with a known value before a range or popularity reading is offered. */
const MIN_FOR_RANGE = 3;

const describeEras = (watched: Anime[], eras: DimensionTaste[], now: Date): TasteModel['range'] => {
  const years = watched.map((anime) => anime.seasonYear).filter((year) => Number.isFinite(year) && year > 1900);
  const base = {
    mainDecade: null,
    earliestYear: years.length ? Math.min(...years) : null,
    latestYear: years.length ? Math.max(...years) : null,
    decades: eras.length,
    formatGroups: 0,
  };
  if (years.length < MIN_FOR_RANGE) return { ...base, eraLean: 'unknown' };
  // A decade counts toward "several decades" only if it holds a meaningful share, not one stray title.
  const significant = eras.filter((era) => era.watched >= Math.max(1, Math.ceil(years.length * 0.1)));
  if (significant.length >= 3) return { ...base, eraLean: 'acrossDecades' };
  const recent = years.filter((year) => year >= now.getFullYear() - 9).length;
  if (recent / years.length >= 0.75) return { ...base, eraLean: 'mostlyRecent' };
  const top = [...eras].sort((left, right) => right.watched - left.watched)[0];
  if (top && top.watched / years.length >= 0.6)
    return { ...base, eraLean: 'mostlyOneDecade', mainDecade: Number(top.key) };
  return { ...base, eraLean: 'mixed' };
};

const describePopularity = (watched: Anime[]): TasteModel['popularity'] => {
  const counts = { wellKnown: 0, between: 0, lessKnown: 0, unknown: 0 };
  watched.forEach((anime) => {
    const band = popularityBandOf(anime);
    counts[band ?? 'unknown'] += 1;
  });
  const known = counts.wellKnown + counts.between + counts.lessKnown;
  let lean: PopularityLean = 'unknown';
  if (known >= MIN_FOR_RANGE) {
    if (counts.lessKnown / known >= 0.3) lean = 'lessKnown';
    else if (counts.wellKnown / known >= 0.6) lean = 'mainstream';
    else lean = 'mixed';
  }
  return { ...counts, lean };
};

const stateOf = (titles: number, watched: number, rated: number): TasteState => {
  if (titles === 0) return 'empty';
  if (watched === 0) return 'intentOnly';
  if (rated === 0) return 'unrated';
  if (rated < LIMITED_EVIDENCE_BELOW) return 'sparse';
  return 'ready';
};

export const buildTasteModel = (archive: Anime[], now: Date = new Date()): TasteModel => {
  const watched = archive.filter(isWatched);
  const planned = archive.filter((anime) => !isWatched(anime));
  const totals = {
    ...emptyCounts(),
    titles: archive.length,
    watched: watched.length,
    completed: watched.filter((anime) => statusOf(anime) === 'COMPLETED').length,
    watching: watched.filter((anime) => statusOf(anime) === 'WATCHING').length,
    planned: planned.length,
    plannedWithReaction: planned.filter((anime) => normalizeReaction(anime.userReaction)).length,
  };
  watched.forEach((anime) => addReaction(totals, preferenceOf(anime)));

  const genres = accumulate(archive, (anime) => anime.genres || [])
    .filter((group) => group.watched > 0)
    .map(toDimension)
    .sort(byExposure);
  const intentGenres = accumulate(planned, (anime) => anime.genres || [])
    .map(({ key, planned: count }) => ({ key, planned: count }))
    .sort((left, right) => right.planned - left.planned || left.key.localeCompare(right.key));
  const eras = accumulate(watched, (anime) => {
    const decade = decadeOf(anime);
    return decade === null ? [] : [String(decade)];
  })
    .map(toDimension)
    .sort((left, right) => Number(left.key) - Number(right.key));
  const formats = accumulate(watched, (anime) => {
    const group = formatGroupOf(anime.format);
    return group ? [group] : [];
  })
    .map(toDimension)
    .sort(byExposure);
  const range = { ...describeEras(watched, eras, now), formatGroups: formats.length };

  return {
    version: TASTE_MODEL_VERSION,
    state: stateOf(totals.titles, totals.watched, totals.rated),
    totals,
    genres,
    intentGenres,
    eras,
    formats,
    range,
    popularity: describePopularity(watched),
    favorites: watched
      .filter((anime) => {
        const reaction = preferenceOf(anime);
        return reaction === 'LOVE' || reaction === 'LIKE';
      })
      .sort(byStrength)
      .slice(0, 8),
    dislikes: watched
      .filter((anime) => {
        const reaction = preferenceOf(anime);
        return reaction === 'DISLIKE' || reaction === 'HATE';
      })
      .sort(byStrength)
      .slice(0, 5),
  };
};

/** Genres grouped by stance for the Taste Map; each group is ordered by its own evidence. */
export const genresByStance = (model: TasteModel) => {
  const pick = (stance: Stance) => model.genres.filter((genre) => genre.stance === stance);
  return {
    positive: pick('positive').sort(
      (left, right) => right.positive - left.positive || right.rated - left.rated || left.key.localeCompare(right.key)
    ),
    mixed: pick('mixed').sort((left, right) => right.rated - left.rated || left.key.localeCompare(right.key)),
    negative: pick('negative').sort(
      (left, right) => right.negative - left.negative || right.rated - left.rated || left.key.localeCompare(right.key)
    ),
  };
};
