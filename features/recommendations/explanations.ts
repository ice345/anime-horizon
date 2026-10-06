import { AnimeTitle } from '../../types';
import { Exploration, RankedCandidate } from './ranking';
import { RecommendationMode } from './sources';

/**
 * Step C — explanations. Built only from `RecommendationEvidence`, the same data that produced the
 * score, so a reason can never claim something the ranking didn't use. The UI turns these
 * language-neutral facts into sentences with `recommendations.reason.*`.
 */
export type ReasonLead =
  | { kind: 'loved'; source: AnimeTitle; others: number }
  | { kind: 'liked'; source: AnimeTitle; others: number }
  | { kind: 'genres'; genres: string[] }
  | { kind: 'watched'; source: AnimeTitle }
  | { kind: 'planned'; source: AnimeTitle }
  | { kind: 'popular' };

export interface RecommendationReason {
  lead: ReasonLead;
  /** Positive genres to mention after a title-based lead (never mixed or negative ones). */
  enjoyedGenres: string[];
  /** Genres the ranking penalized; mentioned only when the title is shown anyway. */
  despiteGenres: string[];
  /** True when positive evidence outweighed that penalty; false when the title was only ranked lower. */
  despiteOutweighed: boolean;
  /** Present only for titles shown as exploration picks. */
  exploration: Exploration | null;
}

const MAX_GENRES = 2;

export const explainRecommendation = (
  ranked: RankedCandidate,
  mode: RecommendationMode,
  isExplorationPick: boolean
): RecommendationReason => {
  const { evidence } = ranked;
  const [strongest, ...rest] = evidence.positiveSources;
  let lead: ReasonLead;
  if (strongest) {
    lead = { kind: evidence.lovedSources > 0 ? 'loved' : 'liked', source: strongest.title, others: rest.length };
  } else if (evidence.weakSources.length && mode === 'exposure') {
    lead = { kind: 'watched', source: evidence.weakSources[0].title };
  } else if (evidence.weakSources.length && mode === 'intent') {
    lead = { kind: 'planned', source: evidence.weakSources[0].title };
  } else if (evidence.positiveGenres.length) {
    lead = { kind: 'genres', genres: evidence.positiveGenres.slice(0, MAX_GENRES) };
  } else {
    lead = { kind: 'popular' };
  }
  return {
    lead,
    enjoyedGenres: lead.kind === 'loved' || lead.kind === 'liked' ? evidence.positiveGenres.slice(0, MAX_GENRES) : [],
    despiteGenres: evidence.genrePenalty > 0 ? evidence.negativeGenres.slice(0, MAX_GENRES) : [],
    despiteOutweighed: evidence.titleSupport + evidence.genreBoost > evidence.genrePenalty + evidence.titlePenalty,
    exploration: isExplorationPick ? evidence.exploration : null,
  };
};
