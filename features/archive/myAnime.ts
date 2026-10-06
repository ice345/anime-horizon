import { normalizeReaction } from './archiveOperations';
import { getDisplayTitle } from '../../shared/i18n/animeTitle';
import type { Locale } from '../../shared/i18n/locales';
import { MY_ANIME_TABS, MyAnimeTab, TAB_STATUS } from '../../services/router';
import { Anime, UserAnimeReaction } from '../../types';

/**
 * My Anime is organized by the user's current watch status, not by when an anime aired.
 */
export type MyAnimeCounts = Record<MyAnimeTab, number>;

export const countByTab = (archive: Anime[]): MyAnimeCounts => {
  const counts: MyAnimeCounts = { watching: 0, plan: 0, completed: 0, all: archive.length };
  archive.forEach((anime) => {
    if (anime.userStatus === 'WATCHING') counts.watching += 1;
    else if (anime.userStatus === 'COMPLETED') counts.completed += 1;
    else counts.plan += 1;
  });
  return counts;
};

/** The first non-empty tab in the order a returning user most likely wants: watching, plan, completed. */
export const defaultTab = (counts: MyAnimeCounts): MyAnimeTab =>
  (['watching', 'plan', 'completed'] as const).find((tab) => counts[tab] > 0) ?? 'all';

export const isMyAnimeTab = (value: unknown): value is MyAnimeTab => MY_ANIME_TABS.includes(value as MyAnimeTab);

export interface MyAnimeFilter {
  tab: MyAnimeTab;
  /** Only titles with this rating; undefined shows every rating. */
  /** A specific reaction, or 'none' for titles without any reaction (never treated as NEUTRAL). */
  reaction?: UserAnimeReaction | 'none';
  query?: string;
}

const searchText = (anime: Anime) =>
  [anime.title.native, anime.title.romaji, anime.title.english, ...anime.genres]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();

const activityTime = (anime: Anime) => {
  const value = anime.userHistory?.updatedAt;
  return value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
};

/**
 * Filters the archive for one tab and orders it by recent activity: records with a known
 * `updatedAt` first (newest first), then records without one (legacy data) by display title.
 */
export const filterMyAnime = (archive: Anime[], filter: MyAnimeFilter, locale: Locale): Anime[] => {
  const query = filter.query?.trim().toLocaleLowerCase() ?? '';
  return archive
    .filter((anime) => filter.tab === 'all' || (anime.userStatus ?? 'PLAN') === TAB_STATUS[filter.tab])
    .filter((anime) => !filter.reaction || (normalizeReaction(anime.userReaction) ?? 'none') === filter.reaction)
    .filter((anime) => !query || searchText(anime).includes(query))
    .sort(
      (left, right) =>
        activityTime(right) - activityTime(left) ||
        getDisplayTitle(left, locale).localeCompare(getDisplayTitle(right, locale), locale) ||
        left.id.localeCompare(right.id)
    );
};
