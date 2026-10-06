import { getHistoryPrecision, historyDateRange, HistoryDate, HistoryPrecision } from '../../shared/schemas/history';
import { Anime } from '../../types';

/**
 * Journey derivation: the only place where user history becomes timeline events.
 *
 * Invariant: events come exclusively from `userHistory`. AniList release data (season, seasonYear,
 * airing status) is never used, and an unknown (null) date never produces an event. A title can have
 * several events in different years (started in December, completed in February).
 */
export type JourneyEventType = 'completed' | 'started' | 'added';

export interface JourneyEvent {
  /** Stable key: `${animeId}:${type}`. */
  key: string;
  anime: Anime;
  type: JourneyEventType;
  /** The stored value, at its original precision. */
  date: HistoryDate;
  precision: HistoryPrecision;
  /** Calendar year of the event (local time for instants). */
  year: number;
  /** 1–12 when the date includes a month; null for year-only dates. */
  month: number | null;
  /** Millisecond instant used for ordering: the start of the date's span. */
  sortTime: number;
}

export interface DeriveOptions {
  /**
   * Include "added to My Anime" events. They describe the archive rather than watching, so the default
   * timeline leaves them out.
   */
  includeAdded?: boolean;
  /** Time zone used to place instants in a year/month. Defaults to the viewer's local time zone. */
  timeZone?: string;
}

/** Later lifecycle first, so a title completed on the same day it was started reads naturally. */
const TYPE_ORDER: Record<JourneyEventType, number> = { completed: 0, started: 1, added: 2 };
const PRECISION_ORDER: Record<HistoryPrecision, number> = { instant: 0, day: 1, month: 2, year: 3 };

const instantParts = (value: HistoryDate, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(
    new Date(value)
  );
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick('year'), month: pick('month') };
};

const toEvent = (anime: Anime, type: JourneyEventType, date: HistoryDate, timeZone?: string): JourneyEvent => {
  const precision = getHistoryPrecision(date);
  let year: number;
  let month: number | null;
  if (precision === 'instant') {
    ({ year, month } = instantParts(date, timeZone));
  } else {
    const [partYear, partMonth] = date.split('-').map(Number);
    year = partYear;
    month = precision === 'year' ? null : partMonth;
  }
  return {
    key: `${anime.id}:${type}`,
    anime,
    type,
    date,
    precision,
    year,
    month,
    sortTime: historyDateRange(date).start,
  };
};

export const deriveJourneyEvents = (archive: Anime[], options: DeriveOptions = {}): JourneyEvent[] => {
  const events: JourneyEvent[] = [];
  archive.forEach((anime) => {
    const history = anime.userHistory;
    if (!history) return;
    if (history.completedAt) events.push(toEvent(anime, 'completed', history.completedAt, options.timeZone));
    if (history.startedAt) events.push(toEvent(anime, 'started', history.startedAt, options.timeZone));
    if (options.includeAdded && history.addedAt)
      events.push(toEvent(anime, 'added', history.addedAt, options.timeZone));
  });
  return events;
};

/**
 * Newest-first ordering inside one period:
 * 1. later span start first;
 * 2. on a tie, more precise first (an exact day before "sometime this month");
 * 3. then completed → started → added;
 * 4. then anime ID, so the order never depends on input order.
 */
export const compareEventsNewestFirst = (left: JourneyEvent, right: JourneyEvent) =>
  right.sortTime - left.sortTime ||
  PRECISION_ORDER[left.precision] - PRECISION_ORDER[right.precision] ||
  TYPE_ORDER[left.type] - TYPE_ORDER[right.type] ||
  left.anime.id.localeCompare(right.anime.id);

/** Years that contain at least one event, newest first. */
export const journeyYears = (events: JourneyEvent[]) =>
  Array.from(new Set(events.map((event) => event.year))).sort((left, right) => right - left);

export interface YearTimeline {
  year: number;
  /** Months with dated events, December first. */
  months: Array<{ month: number; events: JourneyEvent[] }>;
  /** Events known only to the year; shown as "sometime in {year}", never assigned a month. */
  yearOnly: JourneyEvent[];
}

/**
 * Groups one year's events for display. Month-precision events stay in their month group after the
 * exact-day events of that month (their span starts on the 1st); year-only events form their own group.
 */
export const buildYearTimeline = (events: JourneyEvent[], year: number): YearTimeline => {
  const inYear = events.filter((event) => event.year === year).sort(compareEventsNewestFirst);
  const byMonth = new Map<number, JourneyEvent[]>();
  const yearOnly: JourneyEvent[] = [];
  inYear.forEach((event) => {
    if (event.month === null) {
      yearOnly.push(event);
      return;
    }
    byMonth.set(event.month, [...(byMonth.get(event.month) ?? []), event]);
  });
  return {
    year,
    months: Array.from(byMonth.entries())
      .sort(([left], [right]) => right - left)
      .map(([month, monthEvents]) => ({ month, events: monthEvents })),
    yearOnly,
  };
};

/**
 * A title is "missing history" when its current status implies a watch event whose date is unknown:
 * COMPLETED without `completedAt`, or WATCHING with neither `startedAt` nor `completedAt`.
 * Plan-to-watch titles are never flagged: they have no watch event to date.
 */
export const isMissingWatchHistory = (anime: Anime) => {
  const history = anime.userHistory;
  if (anime.userStatus === 'COMPLETED') return !history?.completedAt;
  if (anime.userStatus === 'WATCHING') return !history?.startedAt && !history?.completedAt;
  return false;
};

export interface JourneySummary {
  totalTitles: number;
  watchingNow: number;
  /** Titles whose status implies a watch event (WATCHING or COMPLETED). */
  watchedTitles: number;
  /** Of those, how many have the implied date recorded. */
  datedTitles: number;
  missingHistory: Anime[];
  completedInYear: number;
  startedInYear: number;
}

export const summarizeJourney = (archive: Anime[], events: JourneyEvent[], year: number | null): JourneySummary => {
  const watched = archive.filter((anime) => anime.userStatus === 'WATCHING' || anime.userStatus === 'COMPLETED');
  const missingHistory = watched.filter(isMissingWatchHistory);
  const inYear = year === null ? [] : events.filter((event) => event.year === year);
  return {
    totalTitles: archive.length,
    watchingNow: archive.filter((anime) => anime.userStatus === 'WATCHING').length,
    watchedTitles: watched.length,
    datedTitles: watched.length - missingHistory.length,
    missingHistory,
    completedInYear: inYear.filter((event) => event.type === 'completed').length,
    startedInYear: inYear.filter((event) => event.type === 'started').length,
  };
};
