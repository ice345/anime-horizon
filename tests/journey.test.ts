import { describe, expect, it } from 'vitest';
import { applyStatusChange, createArchiveEntry } from '../features/archive/archiveOperations';
import { countByTab, defaultTab, filterMyAnime } from '../features/archive/myAnime';
import {
  buildYearTimeline,
  compareEventsNewestFirst,
  deriveJourneyEvents,
  isMissingWatchHistory,
  journeyYears,
  summarizeJourney,
} from '../features/journey/journeyEvents';
import { emptyUserHistory, UserHistory } from '../shared/schemas/history';
import { Anime, UserAnimeStatus } from '../types';

const UTC = { timeZone: 'UTC' };

const entry = (
  id: string,
  status: UserAnimeStatus,
  history: Partial<UserHistory>,
  overrides: Partial<Anime> = {}
): Anime => ({
  id,
  title: { native: `作品${id}`, romaji: `Work ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2012,
  genres: ['Drama'],
  status: 'FINISHED',
  userStatus: status,
  userReaction: 'NEUTRAL',
  userHistory: { ...emptyUserHistory(), ...history },
  ...overrides,
});

describe('journey event derivation', () => {
  it('places a known completion in the year the user completed it, not the airing year', () => {
    const events = deriveJourneyEvents(
      [entry('1', 'COMPLETED', { completedAt: '2024-03-10T12:00:00.000Z' }, { seasonYear: 2012 })],
      UTC
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'completed', year: 2024, month: 3, precision: 'instant' });
    expect(journeyYears(events)).toEqual([2024]);
  });

  it('never fabricates an event for a legacy COMPLETED title without dates', () => {
    const legacy = entry('2', 'COMPLETED', {}, { seasonYear: 2015 });

    expect(deriveJourneyEvents([legacy], UTC)).toEqual([]);
    expect(isMissingWatchHistory(legacy)).toBe(true);
  });

  it('keeps a year-only date in its year without inventing a month', () => {
    const events = deriveJourneyEvents([entry('3', 'COMPLETED', { completedAt: '2019' })], UTC);
    const timeline = buildYearTimeline(events, 2019);

    expect(events[0]).toMatchObject({ year: 2019, month: null, precision: 'year', date: '2019' });
    expect(timeline.months).toEqual([]);
    expect(timeline.yearOnly.map((event) => event.key)).toEqual(['3:completed']);
  });

  it('groups a month-only date into its month without inventing a day', () => {
    const events = deriveJourneyEvents([entry('4', 'COMPLETED', { completedAt: '2019-06' })], UTC);
    const timeline = buildYearTimeline(events, 2019);

    expect(events[0]).toMatchObject({ month: 6, precision: 'month', date: '2019-06' });
    expect(timeline.months).toHaveLength(1);
    expect(timeline.months[0].month).toBe(6);
  });

  it('gives a title that spans two years an event in each year', () => {
    const events = deriveJourneyEvents(
      [entry('5', 'COMPLETED', { startedAt: '2024-12', completedAt: '2025-02-03' })],
      UTC
    );

    expect(journeyYears(events)).toEqual([2025, 2024]);
    expect(buildYearTimeline(events, 2024).months[0].events.map((event) => event.type)).toEqual(['started']);
    expect(buildYearTimeline(events, 2025).months[0].events.map((event) => event.type)).toEqual(['completed']);
  });

  it('only includes "added" events on request', () => {
    const added = createArchiveEntry(entry('6', 'PLAN', {}), new Date('2026-10-01T00:00:00.000Z'));

    expect(deriveJourneyEvents([added], UTC)).toEqual([]);
    expect(deriveJourneyEvents([added], { ...UTC, includeAdded: true }).map((event) => event.type)).toEqual(['added']);
  });

  it('orders newest first, exact dates before same-month approximations, completion before start', () => {
    const archive = [
      entry('a', 'COMPLETED', { completedAt: '2019-06' }),
      entry('b', 'COMPLETED', { completedAt: '2019-06-20' }),
      entry('c', 'COMPLETED', { startedAt: '2019-06-01', completedAt: '2019-06-01' }),
      entry('d', 'COMPLETED', { completedAt: '2019-03-02' }),
    ];
    const timeline = buildYearTimeline(deriveJourneyEvents(archive, UTC), 2019);

    expect(timeline.months.map((group) => group.month)).toEqual([6, 3]);
    expect(timeline.months[0].events.map((event) => event.key)).toEqual([
      'b:completed',
      'c:completed',
      'c:started',
      'a:completed',
    ]);
    // Deterministic regardless of input order.
    const reversed = deriveJourneyEvents([...archive].reverse(), UTC).sort(compareEventsNewestFirst);
    expect(reversed.map((event) => event.key)).toEqual(
      deriveJourneyEvents(archive, UTC)
        .sort(compareEventsNewestFirst)
        .map((event) => event.key)
    );
  });

  it('keeps an old completion for a title currently marked WATCHING again', () => {
    const rewatch = applyStatusChange(
      entry('7', 'COMPLETED', { completedAt: '2020-05' }),
      'WATCHING',
      new Date('2026-10-01T00:00:00.000Z')
    );
    const events = deriveJourneyEvents([rewatch], UTC);

    expect(events.map((event) => [event.type, event.date])).toEqual([['completed', '2020-05']]);
    expect(isMissingWatchHistory(rewatch)).toBe(false);
  });
});

describe('journey summary', () => {
  it('reports only facts that follow from the data, including history coverage', () => {
    const archive = [
      entry('1', 'COMPLETED', { completedAt: '2024-02' }),
      entry('2', 'COMPLETED', {}),
      entry('3', 'WATCHING', { startedAt: '2024' }),
      entry('4', 'WATCHING', {}),
      entry('5', 'PLAN', {}),
    ];
    const events = deriveJourneyEvents(archive, UTC);
    const summary = summarizeJourney(archive, events, 2024);

    expect(summary).toMatchObject({
      totalTitles: 5,
      watchingNow: 2,
      watchedTitles: 4,
      datedTitles: 2,
      completedInYear: 1,
      startedInYear: 1,
    });
    // Plan-to-watch titles are never flagged as missing history.
    expect(summary.missingHistory.map((anime) => anime.id)).toEqual(['2', '4']);
  });
});

describe('My Anime status organization', () => {
  const T0 = new Date('2026-10-01T00:00:00.000Z');
  const T1 = new Date('2026-10-02T00:00:00.000Z');
  const T2 = new Date('2026-10-03T00:00:00.000Z');

  it('moves a title through Plan to Watch → Watching → Completed', () => {
    const added = createArchiveEntry(entry('1', 'PLAN', {}), T0);
    const inTab = (archive: Anime[], tab: 'plan' | 'watching' | 'completed') =>
      filterMyAnime(archive, { tab }, 'en').map((anime) => anime.id);

    expect(inTab([added], 'plan')).toEqual(['1']);
    const watching = applyStatusChange(added, 'WATCHING', T1);
    expect(inTab([watching], 'plan')).toEqual([]);
    expect(inTab([watching], 'watching')).toEqual(['1']);
    const completed = applyStatusChange(watching, 'COMPLETED', T2);
    expect(inTab([completed], 'watching')).toEqual([]);
    expect(inTab([completed], 'completed')).toEqual(['1']);
  });

  it('counts tabs, defaults to the first non-empty one, and filters by rating and search', () => {
    const archive = [
      entry('1', 'PLAN', {}),
      entry('2', 'COMPLETED', {}, { userReaction: 'LOVE' }),
      entry('3', 'COMPLETED', {}, { userReaction: 'HATE' }),
    ];
    const counts = countByTab(archive);

    expect(counts).toEqual({ watching: 0, plan: 1, completed: 2, all: 3 });
    expect(defaultTab(counts)).toBe('plan');
    expect(defaultTab(countByTab([]))).toBe('all');
    expect(filterMyAnime(archive, { tab: 'completed', reaction: 'LOVE' }, 'en').map((anime) => anime.id)).toEqual([
      '2',
    ]);
    expect(filterMyAnime(archive, { tab: 'all', query: 'work 3' }, 'en').map((anime) => anime.id)).toEqual(['3']);
  });

  it('orders by recent activity, then legacy records by title', () => {
    const archive = [
      entry('1', 'PLAN', {}, { title: { native: '', romaji: 'Zeta', english: '' } }),
      entry('2', 'PLAN', { updatedAt: '2026-10-01T00:00:00.000Z' }),
      entry('3', 'PLAN', {}, { title: { native: '', romaji: 'Alpha', english: '' } }),
      entry('4', 'PLAN', { updatedAt: '2026-10-05T00:00:00.000Z' }),
    ];

    expect(filterMyAnime(archive, { tab: 'all' }, 'en').map((anime) => anime.id)).toEqual(['4', '2', '3', '1']);
  });
});
