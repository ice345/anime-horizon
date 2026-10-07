import { Season, SEASON_ORDER, UserAnimeStatus } from '../../types';

/** The status Discover gives a title when it is added. Always visible and changeable before adding. */
export type AddMode = UserAnimeStatus;

export const ADD_MODES: AddMode[] = ['COMPLETED', 'WATCHING', 'PLAN'];

export type SeasonTiming = 'past' | 'current' | 'future';

/** The broadcast season a date falls in (Winter = Jan–Mar, Spring = Apr–Jun, ...). */
export const seasonOf = (date: Date): { year: number; season: Season } => {
  const month = date.getMonth();
  const season: Season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL';
  return { year: date.getFullYear(), season };
};

export const seasonTiming = (year: number, season: Season, now: Date = new Date()): SeasonTiming => {
  const current = seasonOf(now);
  const target = year * 4 + SEASON_ORDER[season];
  const today = current.year * 4 + SEASON_ORDER[current.season];
  return target < today ? 'past' : target > today ? 'future' : 'current';
};

/**
 * The suggested starting mode for a season. Browsing a past season is usually rebuilding one's own
 * history, so it starts on Completed; the current and future seasons start on Plan to Watch.
 *
 * This only pre-selects a visible control. It is not inference: nothing is added until the user
 * clicks a title, the chosen mode is shown the whole time, and no watch dates are derived from the
 * season (see createArchiveEntry).
 */
export const defaultAddMode = (year: number, season: Season, now: Date = new Date()): AddMode =>
  seasonTiming(year, season, now) === 'past' ? 'COMPLETED' : 'PLAN';

/** A season that hasn't started can only be planned; past and current seasons offer every status. */
export const availableAddModes = (timing: SeasonTiming): AddMode[] => (timing === 'future' ? ['PLAN'] : ADD_MODES);
