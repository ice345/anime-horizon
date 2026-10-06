import type { Season, UserAnimeReaction, UserAnimeStatus } from '../../types';

/**
 * Typed key builders for enum-driven messages. Inline template literals lose their literal
 * type inside some React component signatures, so build these keys through functions.
 */
export const seasonNameKey = (season: Season) => `season.name.${season}` as const;
export const seasonHeroKey = (season: Season, part: 'title' | 'description' | 'alt') =>
  `season.hero.${season}.${part}` as const;
export const statusKey = (status: UserAnimeStatus) => `status.${status}` as const;
export const reactionKey = (reaction: UserAnimeReaction) => `reaction.${reaction}` as const;

const AIRING_STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'HIATUS', 'CANCELLED'] as const;
type AiringStatus = (typeof AIRING_STATUSES)[number];

export const airingKey = (status: string | undefined) =>
  AIRING_STATUSES.includes(status as AiringStatus) ? (`airing.${status as AiringStatus}` as const) : null;
