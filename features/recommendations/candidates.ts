import { normalizeReaction } from '../archive/archiveOperations';
import { Anime } from '../../types';
import type { RecommendationGraph } from '../../services/anilistService';
import { RecommendationSource } from './sources';

/**
 * Step A2 — candidate generation. Collects candidates and the evidence links that brought them in;
 * it never scores or orders by preference. Membership depends only on the graph, the catalogue and the
 * archive, never on random order.
 */
export type CandidateOrigin = 'graph' | 'catalogue';

export interface CandidateLink {
  source: RecommendationSource;
  /** AniList community vote count on the recommendation edge. */
  rating: number;
}

export interface Candidate {
  anime: Anime;
  origin: CandidateOrigin;
  /** Links from archive sources, in source order then AniList order. Empty for catalogue candidates. */
  links: CandidateLink[];
}

export type ExclusionReason = 'known' | 'continuesUnstarted' | 'continuesDisliked';

export interface CandidatePool {
  candidates: Candidate[];
  /** Candidates already in the archive as Plan to Watch: shown separately as "Already on your list". */
  onYourList: Candidate[];
  /** Counts of excluded candidates by reason, for diagnostics and tests. */
  excluded: Record<ExclusionReason, number>;
}

const isWatched = (anime: Anime | undefined) => anime?.userStatus === 'COMPLETED' || anime?.userStatus === 'WATCHING';

/**
 * A later entry (sequel or side story) only makes sense once its predecessor has been watched, and not
 * if the user disliked the predecessor. Candidates continuing an unstarted or disliked title are dropped.
 */
const continuationProblem = (continues: string[], archiveById: Map<string, Anime>): ExclusionReason | null => {
  if (!continues.length) return null;
  const predecessors = continues.map((id) => archiveById.get(id));
  if (
    predecessors.some(
      (anime) => isWatched(anime) && ['DISLIKE', 'HATE'].includes(normalizeReaction(anime!.userReaction) ?? '')
    )
  )
    return 'continuesDisliked';
  if (!predecessors.some(isWatched)) return 'continuesUnstarted';
  return null;
};

export const collectCandidates = (
  archive: Anime[],
  sources: RecommendationSource[],
  graph: RecommendationGraph | null,
  catalogue: Anime[]
): CandidatePool => {
  const archiveById = new Map(archive.map((anime) => [String(anime.id), anime]));
  const sourceById = new Map(sources.map((source) => [String(source.anime.id), source]));
  const byId = new Map<string, Candidate>();
  const onYourList = new Map<string, Candidate>();
  const excluded: Record<ExclusionReason, number> = { known: 0, continuesUnstarted: 0, continuesDisliked: 0 };

  graph?.nodes.forEach((node) => {
    const source = sourceById.get(node.sourceId);
    if (!source) return;
    node.links.forEach(({ anime, rating, continues }) => {
      const id = String(anime.id);
      const known = archiveById.get(id);
      if (known) {
        // Already known titles are never primary recommendations. Planned ones linked from a liked
        // title can be surfaced separately; watched ones are simply skipped.
        if (known.userStatus === 'PLAN' && source.weight > 0) {
          const entry = onYourList.get(id) ?? { anime: known, origin: 'graph' as const, links: [] };
          entry.links.push({ source, rating });
          onYourList.set(id, entry);
        }
        excluded.known += 1;
        return;
      }
      const problem = continuationProblem(continues, archiveById);
      if (problem) {
        excluded[problem] += 1;
        return;
      }
      const entry = byId.get(id) ?? { anime, origin: 'graph' as const, links: [] };
      entry.links.push({ source, rating });
      byId.set(id, entry);
    });
  });

  catalogue.forEach((anime) => {
    const id = String(anime.id);
    if (byId.has(id)) return;
    if (archiveById.has(id)) {
      excluded.known += 1;
      return;
    }
    byId.set(id, { anime, origin: 'catalogue', links: [] });
  });

  return { candidates: Array.from(byId.values()), onYourList: Array.from(onYourList.values()), excluded };
};
