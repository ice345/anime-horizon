import { normalizeReaction } from '../archive/archiveOperations';
import { REACTION_SIGNAL } from '../taste/tasteModel';
import { Anime } from '../../types';

/**
 * Step A1 — which archive titles seed the AniList recommendation graph, and with what weight.
 * See docs/recommendations.md.
 */
export type RecommendationMode = 'personal' | 'exposure' | 'intent' | 'popular';
export type SourceRole = 'loved' | 'liked' | 'disliked' | 'hated' | 'watched' | 'planned';

export interface RecommendationSource {
  anime: Anime;
  role: SourceRole;
  /**
   * Signed influence of one link from this source. Explicit reactions reuse the taste model's
   * REACTION_SIGNAL (LOVE 2, LIKE 1, DISLIKE −1, HATE −2). Watched-without-a-positive-reaction and
   * planned titles are only used when nothing better exists, at a small fixed weight.
   */
  weight: number;
}

export interface SourceSelection {
  mode: RecommendationMode;
  sources: RecommendationSource[];
}

export const MAX_POSITIVE_SOURCES = 50;
export const MAX_NEGATIVE_SOURCES = 10;
export const MAX_FALLBACK_SOURCES = 40;
/** Weight of a link from a watched-but-not-liked or a planned title (cold start only). */
export const WEAK_SOURCE_WEIGHT = 0.25;

const isWatched = (anime: Anime) => anime.userStatus === 'COMPLETED' || anime.userStatus === 'WATCHING';
const updatedAt = (anime: Anime) => Date.parse(anime.userHistory?.updatedAt ?? '') || 0;

/** Strongest weight first, then most recently updated, then AniList ID: a total, stable order. */
const bySourceStrength = (left: RecommendationSource, right: RecommendationSource) =>
  Math.abs(right.weight) - Math.abs(left.weight) ||
  updatedAt(right.anime) - updatedAt(left.anime) ||
  Number(left.anime.id) - Number(right.anime.id);

const roleOf = (anime: Anime): SourceRole | null => {
  const reaction = normalizeReaction(anime.userReaction);
  if (reaction === 'LOVE') return 'loved';
  if (reaction === 'LIKE') return 'liked';
  if (reaction === 'DISLIKE') return 'disliked';
  if (reaction === 'HATE') return 'hated';
  return null;
};

/**
 * - personal: watched titles the user loved or liked seed the graph; disliked ones are added only to
 *   penalize candidates they also point to. Plans never become sources here, so adding a
 *   recommendation to Plan to Watch never changes the source set.
 * - exposure: nothing watched is liked, so watched titles without a negative reaction seed it weakly.
 * - intent: nothing is watched, so Plan to Watch titles seed it weakly.
 * - popular: empty archive (or nothing usable); no personal sources at all.
 * A reaction on a PLAN title is never preference evidence (see docs/taste-model.md).
 */
export const selectRecommendationSources = (archive: Anime[]): SourceSelection => {
  const watched = archive.filter(isWatched);
  const reacted = watched.flatMap((anime): RecommendationSource[] => {
    const role = roleOf(anime);
    const reaction = normalizeReaction(anime.userReaction);
    return role && reaction && reaction !== 'NEUTRAL' ? [{ anime, role, weight: REACTION_SIGNAL[reaction] }] : [];
  });
  const positive = reacted.filter((source) => source.weight > 0).sort(bySourceStrength);
  if (positive.length) {
    const negative = reacted.filter((source) => source.weight < 0).sort(bySourceStrength);
    return {
      mode: 'personal',
      sources: [...positive.slice(0, MAX_POSITIVE_SOURCES), ...negative.slice(0, MAX_NEGATIVE_SOURCES)],
    };
  }

  const neutralOrUnrated = watched
    .filter((anime) => {
      const reaction = normalizeReaction(anime.userReaction);
      return !reaction || reaction === 'NEUTRAL';
    })
    .map((anime): RecommendationSource => ({ anime, role: 'watched', weight: WEAK_SOURCE_WEIGHT }))
    .sort(
      (left, right) =>
        Number(right.anime.userStatus === 'COMPLETED') - Number(left.anime.userStatus === 'COMPLETED') ||
        bySourceStrength(left, right)
    );
  if (neutralOrUnrated.length) return { mode: 'exposure', sources: neutralOrUnrated.slice(0, MAX_FALLBACK_SOURCES) };

  if (watched.length) return { mode: 'popular', sources: [] };

  const planned = archive
    .map((anime): RecommendationSource => ({ anime, role: 'planned', weight: WEAK_SOURCE_WEIGHT }))
    .sort(bySourceStrength);
  if (planned.length) return { mode: 'intent', sources: planned.slice(0, MAX_FALLBACK_SOURCES) };
  return { mode: 'popular', sources: [] };
};

/** Stable identity of a source selection; the graph is only refetched when this changes. */
export const sourceSelectionKey = (selection: SourceSelection) =>
  `${selection.mode}:${selection.sources
    .map((source) => source.anime.id)
    .sort((left, right) => Number(left) - Number(right))
    .join(',')}`;
