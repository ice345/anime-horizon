import { UserAnimeStatus } from '../types';

/**
 * The status every title receives when it first enters the personal archive.
 *
 * Invariant: AniList airing data (season, year, release status) describes the
 * anime, not the user. It never implies that the user is watching or has
 * watched a title, so new and legacy entries without a stored status always
 * start as PLAN. Only an explicit user action may set WATCHING or COMPLETED: changing the status
 * later, or choosing a visible "add as" mode before adding (see features/archive/addMode.ts).
 */
export const DEFAULT_ARCHIVE_STATUS: UserAnimeStatus = 'PLAN';
