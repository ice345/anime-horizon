import type { UserHistory } from './shared/schemas/history';

export type { HistoryDate, UserHistory } from './shared/schemas/history';

export type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
export type UserAnimeStatus = 'PLAN' | 'WATCHING' | 'COMPLETED';
export type UserAnimeReaction = 'LOVE' | 'LIKE' | 'NEUTRAL' | 'DISLIKE' | 'HATE';

export interface AnimeTitle {
  romaji: string;
  english: string;
  native: string;
}

export interface AnimeCover {
  extraLarge: string;
  large: string;
  color: string;
}

export interface Anime {
  id: string; // Anilist use numbers usually but we handle as string for ID consistency
  title: AnimeTitle;
  coverImage: AnimeCover;
  bannerImage?: string; // New: For wider display contexts if needed
  description?: string; // New: For hover details
  season: Season;
  seasonYear: number;
  genres: string[];
  averageScore?: number;
  popularity?: number;
  format?: string; // TV, MOVIE, etc.
  status?: string;
  episodes?: number;
  duration?: number;
  studios?: string[];
  nextAiringEpisode?: {
    airingAt: number;
    timeUntilAiring: number;
    episode: number;
  };
  /*
   * ---- User-owned archive fields ----
   * Everything above is an AniList catalogue snapshot. The `user*` fields below belong to the user,
   * exist only on archive records, and are never derived from catalogue data. In particular,
   * anime release time (season, seasonYear, status) and user watch time (userHistory) are separate
   * domains. See docs/data-model.md for the intended split into a separate ArchiveEntry.
   */
  userStatus?: UserAnimeStatus;
  /**
   * The user's explicit reaction. Absent means no reaction was recorded (unknown preference); NEUTRAL
   * is an explicit "it was okay" and is never used as a default. See docs/taste-model.md.
   */
  userReaction?: UserAnimeReaction;
  userNote?: string;
  /** When the user added, started and completed the title. Present on every archive record. */
  userHistory?: UserHistory;
}

// Anilist specific Season Enum
export const SEASONS: Season[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

export const SEASON_ORDER: Record<Season, number> = {
  WINTER: 0,
  SPRING: 1,
  SUMMER: 2,
  FALL: 3,
};
