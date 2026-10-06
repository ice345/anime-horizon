import {
  DimensionTaste,
  EvidenceLevel,
  FormatGroup,
  formatGroupOf,
  popularityBandOf,
  TasteModel,
} from '../taste/tasteModel';
import { Anime } from '../../types';
import { Candidate } from './candidates';
import { RecommendationMode } from './sources';

/**
 * Step B — scoring and ordering. A thin layer that applies the taste model (which describes the user)
 * to candidates. It does not compute its own genre preferences. Every number that affects the order
 * is kept in `RecommendationEvidence`, and explanations are derived from that same evidence.
 * See docs/recommendations.md for the policy behind each weight.
 */

/** Title links: AniList vote count only scales a link between half and full strength (log scale). */
const EDGE_VOTES_FOR_FULL_STRENGTH = 100;
/** Weight of the genre layer relative to one LIKE link (1.0). */
const GENRE_WEIGHT = 0.6;
/** Cap on summed genre weight per direction, so many-genre titles don't win by genre count alone. */
const GENRE_CAP = 1.5;
/** Popularity is a weak prior: at most this much, less than half of one LIKE link. */
const POPULARITY_WEIGHT = 0.15;
const POPULARITY_FLOOR = 1_000;
const POPULARITY_CEILING = 300_000;
const EVIDENCE_FACTOR: Record<EvidenceLevel, number> = { none: 0, limited: 0.5, moderate: 0.75, solid: 1 };
/** Exploration needs a watched history to compare with, and a share below this counts as "rarely". */
const MIN_WATCHED_FOR_EXPLORATION = 5;
const RARE_SHARE = 0.1;

export type ExplorationKind = 'era' | 'format' | 'lessKnown' | 'newGenre';

export interface Exploration {
  kind: ExplorationKind;
  decadeYear?: number;
  format?: FormatGroup;
  genre?: string;
}

export interface RecommendationEvidence {
  /** Sum of positive link weights × edge strength. */
  titleSupport: number;
  /** Sum of negative link weights × edge strength (as a positive number). */
  titlePenalty: number;
  /** Positive sources, strongest first (LOVE before LIKE). */
  positiveSources: Anime[];
  lovedSources: number;
  /** Sources from cold-start modes (watched-not-liked or planned). */
  weakSources: Anime[];
  dislikedSources: Anime[];
  /** Candidate genres the taste model reads as positive / negative / mixed for this user. */
  positiveGenres: string[];
  negativeGenres: string[];
  mixedGenres: string[];
  genreBoost: number;
  genrePenalty: number;
  popularityPrior: number;
  exploration: Exploration | null;
}

export interface RankedCandidate {
  candidate: Candidate;
  evidence: RecommendationEvidence;
  score: number;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export const edgeStrength = (votes: number) =>
  0.5 + 0.5 * Math.min(1, Math.log1p(Math.max(0, votes)) / Math.log1p(EDGE_VOTES_FOR_FULL_STRENGTH));

/** Log-scaled position of a title's AniList popularity between 1,000 and 300,000, in [0, 1]. */
export const popularityPosition = (anime: Anime) => {
  if (!anime.popularity || anime.popularity <= 0) return 0;
  const low = Math.log1p(POPULARITY_FLOOR);
  const high = Math.log1p(POPULARITY_CEILING);
  return Math.min(1, Math.max(0, (Math.log1p(anime.popularity) - low) / (high - low)));
};

/**
 * How strongly one genre's evidence counts: the taste model's evidence level times the intensity of
 * reactions (|signal| / 2·rated, so HATE- or LOVE-heavy genres count more), at least a quarter.
 */
const genreWeight = (genre: DimensionTaste) =>
  EVIDENCE_FACTOR[genre.evidence] * Math.min(1, Math.max(0.25, Math.abs(genre.signal) / (2 * genre.rated)));

const decadeOf = (anime: Anime) =>
  Number.isFinite(anime.seasonYear) && anime.seasonYear > 1900 ? Math.floor(anime.seasonYear / 10) * 10 : null;

/**
 * Exploration: the candidate is grounded in positive evidence but differs from what the user usually
 * watches — a rarely watched release decade or format, a less widely known title for someone who
 * mostly watches well-known ones, or a genre they haven't watched at all. Obscurity alone never counts.
 */
const explorationOf = (anime: Anime, model: TasteModel): Exploration | null => {
  const watched = model.totals.watched;
  if (watched < MIN_WATCHED_FOR_EXPLORATION) return null;
  const decade = decadeOf(anime);
  if (decade !== null) {
    const seen = model.eras.find((era) => Number(era.key) === decade)?.watched ?? 0;
    if (seen / watched < RARE_SHARE) return { kind: 'era', decadeYear: decade };
  }
  const format = formatGroupOf(anime.format);
  if (format && format !== 'OTHER') {
    const seen = model.formats.find((item) => item.key === format)?.watched ?? 0;
    if (seen / watched < RARE_SHARE) return { kind: 'format', format };
  }
  const known = model.popularity.wellKnown + model.popularity.between + model.popularity.lessKnown;
  if (popularityBandOf(anime) === 'lessKnown' && known > 0 && model.popularity.lessKnown / known < RARE_SHARE)
    return { kind: 'lessKnown' };
  const watchedGenres = new Set(model.genres.map((genre) => genre.key));
  const newGenre = (anime.genres || []).find((genre) => !watchedGenres.has(genre));
  if (newGenre) return { kind: 'newGenre', genre: newGenre };
  return null;
};

const byStrength = (left: Anime, right: Anime, weightOf: (anime: Anime) => number) =>
  weightOf(right) - weightOf(left) || Number(left.id) - Number(right.id);

export const scoreCandidate = (candidate: Candidate, model: TasteModel): RankedCandidate => {
  let titleSupport = 0;
  let titlePenalty = 0;
  const sourceWeight = new Map<string, number>();
  const positive = new Map<string, Anime>();
  const weak = new Map<string, Anime>();
  const disliked = new Map<string, Anime>();
  candidate.links.forEach(({ source, rating }) => {
    const value = source.weight * edgeStrength(rating);
    if (value >= 0) titleSupport += value;
    else titlePenalty -= value;
    const id = String(source.anime.id);
    sourceWeight.set(id, source.weight);
    if (source.role === 'loved' || source.role === 'liked') positive.set(id, source.anime);
    else if (source.role === 'watched' || source.role === 'planned') weak.set(id, source.anime);
    else disliked.set(id, source.anime);
  });
  const weightOf = (anime: Anime) => Math.abs(sourceWeight.get(String(anime.id)) ?? 0);

  const genres = new Map(model.genres.map((genre) => [genre.key, genre]));
  const positiveGenres: DimensionTaste[] = [];
  const negativeGenres: DimensionTaste[] = [];
  const mixedGenres: string[] = [];
  (candidate.anime.genres || []).forEach((key) => {
    const genre = genres.get(key);
    if (!genre) return;
    if (genre.stance === 'positive') positiveGenres.push(genre);
    else if (genre.stance === 'negative') negativeGenres.push(genre);
    else if (genre.stance === 'mixed') mixedGenres.push(key);
  });
  // Mixed, neutral and insufficient genres contribute nothing: title links must carry those candidates.
  const genreBoost =
    GENRE_WEIGHT *
    Math.min(
      GENRE_CAP,
      positiveGenres.reduce((sum, g) => sum + genreWeight(g), 0)
    );
  const genrePenalty =
    GENRE_WEIGHT *
    Math.min(
      GENRE_CAP,
      negativeGenres.reduce((sum, g) => sum + genreWeight(g), 0)
    );
  const popularityPrior = POPULARITY_WEIGHT * popularityPosition(candidate.anime);
  const byGenreWeight = (left: DimensionTaste, right: DimensionTaste) =>
    genreWeight(right) - genreWeight(left) || left.key.localeCompare(right.key);

  const hasPositiveGrounding = titleSupport > 0 && positive.size > 0;
  const evidence: RecommendationEvidence = {
    titleSupport: round(titleSupport),
    titlePenalty: round(titlePenalty),
    positiveSources: [...positive.values()].sort((left, right) => byStrength(left, right, weightOf)),
    lovedSources: [...positive.keys()].filter((id) => (sourceWeight.get(id) ?? 0) >= 2).length,
    weakSources: [...weak.values()].sort((left, right) => Number(left.id) - Number(right.id)),
    dislikedSources: [...disliked.values()].sort((left, right) => byStrength(left, right, weightOf)),
    positiveGenres: [...positiveGenres].sort(byGenreWeight).map((genre) => genre.key),
    negativeGenres: [...negativeGenres].sort(byGenreWeight).map((genre) => genre.key),
    mixedGenres: mixedGenres.sort(),
    genreBoost: round(genreBoost),
    genrePenalty: round(genrePenalty),
    popularityPrior: round(popularityPrior),
    exploration: hasPositiveGrounding || genreBoost > 0 ? explorationOf(candidate.anime, model) : null,
  };
  const score = round(titleSupport - titlePenalty + genreBoost - genrePenalty + popularityPrior);
  return { candidate, evidence, score };
};

/** Total order: score, then title support, then popularity, then AniList ID. Never random. */
export const compareRanked = (left: RankedCandidate, right: RankedCandidate) =>
  right.score - left.score ||
  right.evidence.titleSupport - left.evidence.titleSupport ||
  (right.candidate.anime.popularity || 0) - (left.candidate.anime.popularity || 0) ||
  Number(left.candidate.anime.id) - Number(right.candidate.anime.id);

export interface RankedRecommendations {
  /** Familiar matches, best first. */
  matches: RankedCandidate[];
  /** Grounded exploration picks, best first. */
  explore: RankedCandidate[];
}

export const MAX_RECOMMENDATIONS = 12;
export const MAX_EXPLORATION = 3;

/**
 * Orders candidates and splits them into matches and exploration picks. Within each group the order is
 * a pure sort by score, so removing one title (for example after adding it to Plan to Watch) never
 * changes the relative order of the others.
 *
 * In personal mode, candidates whose evidence nets out negative are dropped: being linked mostly to
 * disliked titles or genres is a reason not to recommend. Other modes have no negative title links.
 */
export const rankCandidates = (
  candidates: Candidate[],
  model: TasteModel,
  mode: RecommendationMode
): RankedRecommendations => {
  const ranked = candidates.map((candidate) => scoreCandidate(candidate, model)).sort(compareRanked);
  const eligible = mode === 'personal' ? ranked.filter((item) => item.score > 0) : ranked;
  const explore = eligible.filter((item) => item.evidence.exploration).slice(0, MAX_EXPLORATION);
  const exploreIds = new Set(explore.map((item) => item.candidate.anime.id));
  const matches = eligible
    .filter((item) => !exploreIds.has(item.candidate.anime.id))
    .slice(0, MAX_RECOMMENDATIONS - explore.length);
  return { matches, explore };
};
