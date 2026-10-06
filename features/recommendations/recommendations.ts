import { buildTasteModel, LIMITED_EVIDENCE_BELOW, TasteModel } from '../taste/tasteModel';
import { Anime } from '../../types';
import type { RecommendationGraph } from '../../services/anilistService';
import { collectCandidates } from './candidates';
import { explainRecommendation, RecommendationReason } from './explanations';
import {
  compareRanked,
  MAX_EXPLORATION,
  MAX_RECOMMENDATIONS,
  rankCandidates,
  RankedCandidate,
  scoreCandidate,
} from './ranking';
import { RecommendationMode, selectRecommendationSources } from './sources';

/**
 * Recommendation model = the taste model (which describes the user) applied to candidates:
 *   A. sources + candidates (sources.ts, candidates.ts)
 *   B. scoring + ordering (ranking.ts)
 *   C. explanations from the same evidence (explanations.ts)
 * No AI is involved at any step. See docs/recommendations.md.
 */
export type RecommendationGroup = 'match' | 'explore' | 'onList';

export interface RecommendationItem {
  anime: Anime;
  group: RecommendationGroup;
  reason: RecommendationReason;
  ranked: RankedCandidate;
}

export interface RecommendationResult {
  mode: RecommendationMode;
  /** Personal mode with fewer than 5 reactions on watched titles. */
  limitedEvidence: boolean;
  /** Watched titles with an explicit reaction (from the taste model). */
  ratedCount: number;
  /**
   * Popular mode, but the taste model has genres the user mostly dislikes, so those were ranked lower:
   * the list is not personalized by likes, yet it is adjusted by dislikes, and must say so.
   */
  adjustedByDislikes: boolean;
  /** Number of loved/liked titles used as sources (personal mode; capped, see sources.ts). */
  positiveSourceCount: number;
  /** All watched titles with LOVE or LIKE. */
  positiveTotal: number;
  matches: RecommendationItem[];
  explore: RecommendationItem[];
  /** Planned titles that liked titles also point to; never mixed into the primary list. */
  onYourList: RecommendationItem[];
}

const MAX_ON_YOUR_LIST = 6;

export const buildRecommendations = (
  archive: Anime[],
  graph: RecommendationGraph | null,
  catalogue: Anime[],
  model: TasteModel = buildTasteModel(archive)
): RecommendationResult => {
  const { mode, sources } = selectRecommendationSources(archive);
  const item =
    (group: RecommendationGroup) =>
    (ranked: RankedCandidate): RecommendationItem => ({
      anime: ranked.candidate.anime,
      group,
      ranked,
      reason: explainRecommendation(ranked, mode, group === 'explore'),
    });

  const graphPool = collectCandidates(archive, sources, graph, []);
  const ranked = rankCandidates(graphPool.candidates, model, mode);
  // The catalogue (the season shown in Discover) only tops up a short list, so graph-based results don't
  // change when the user browses another season.
  const shown = ranked.matches.length + ranked.explore.length;
  const graphIds = new Set(graphPool.candidates.map((candidate) => candidate.anime.id));
  const catalogueOnly = collectCandidates(archive, [], null, catalogue).candidates.filter(
    (candidate) => !graphIds.has(candidate.anime.id)
  );
  const catalogueRanked = rankCandidates(catalogueOnly, model, mode);
  const room = Math.max(0, MAX_RECOMMENDATIONS - shown);
  const extraExplore = catalogueRanked.explore.slice(0, Math.min(room, MAX_EXPLORATION - ranked.explore.length));
  const extraMatches = catalogueRanked.matches.slice(0, room - extraExplore.length);

  return {
    mode,
    limitedEvidence: mode === 'personal' && model.totals.rated < LIMITED_EVIDENCE_BELOW,
    ratedCount: model.totals.rated,
    adjustedByDislikes: mode === 'popular' && model.genres.some((genre) => genre.stance === 'negative'),
    positiveTotal: model.totals.positive,
    positiveSourceCount: sources.filter((source) => source.weight > 0 && mode === 'personal').length,
    matches: [...ranked.matches, ...extraMatches].map(item('match')),
    explore: [...ranked.explore, ...extraExplore].map(item('explore')),
    onYourList: graphPool.onYourList
      .map((candidate) => scoreCandidate(candidate, model))
      .sort(compareRanked)
      .slice(0, MAX_ON_YOUR_LIST)
      .map(item('onList')),
  };
};
