import { describe, expect, it } from 'vitest';
import { ADD_MODES, availableAddModes, defaultAddMode, seasonOf, seasonTiming } from '../features/archive/addMode';
import { applyEntryEdit, applyStatusChange, createArchiveEntry } from '../features/archive/archiveOperations';
import { deriveJourneyEvents, summarizeJourney } from '../features/journey/journeyEvents';
import { buildTasteModel } from '../features/taste/tasteModel';
import { Anime } from '../types';

// 6 October 2026: the current broadcast season is Fall 2026.
const NOW = new Date(2026, 9, 6, 12, 0, 0);

const catalogue = (overrides: Partial<Anime> = {}): Anime => ({
  id: '9001',
  title: { native: '作品', romaji: 'Old Show', english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2018,
  genres: ['Drama'],
  format: 'TV',
  // AniList says it finished airing long ago; that must not become a watch date.
  status: 'FINISHED',
  ...overrides,
});

describe('season timing and the default add mode', () => {
  it('finds the broadcast season of a date', () => {
    expect(seasonOf(new Date(2026, 0, 15))).toEqual({ year: 2026, season: 'WINTER' });
    expect(seasonOf(new Date(2026, 3, 1))).toEqual({ year: 2026, season: 'SPRING' });
    expect(seasonOf(new Date(2026, 8, 30))).toEqual({ year: 2026, season: 'SUMMER' });
    expect(seasonOf(NOW)).toEqual({ year: 2026, season: 'FALL' });
  });

  it.each([
    [2018, 'SPRING', 'past', 'COMPLETED'],
    [2026, 'SUMMER', 'past', 'COMPLETED'],
    [2026, 'FALL', 'current', 'PLAN'],
    [2027, 'WINTER', 'future', 'PLAN'],
  ] as const)('%i %s is %s and starts on %s', (year, season, timing, mode) => {
    expect(seasonTiming(year, season, NOW)).toBe(timing);
    expect(defaultAddMode(year, season, NOW)).toBe(mode);
  });

  it('offers every status for past and current seasons, and only Plan to Watch before a season starts', () => {
    expect(availableAddModes('past')).toEqual(ADD_MODES);
    expect(availableAddModes('current')).toEqual(ADD_MODES);
    expect(availableAddModes('future')).toEqual(['PLAN']);
  });
});

describe('adding with an explicit mode never invents history', () => {
  it('Completed records the status and when it was added, and leaves the watch dates unknown', () => {
    const entry = createArchiveEntry(catalogue(), NOW, 'COMPLETED');
    expect(entry.userStatus).toBe('COMPLETED');
    expect(entry.userHistory).toEqual({
      addedAt: NOW.toISOString(),
      startedAt: null,
      completedAt: null,
      updatedAt: NOW.toISOString(),
    });
    expect(entry.userReaction).toBeUndefined();
    expect(entry.userNote).toBeUndefined();
  });

  it('Watching leaves the start date unknown, since adding a title is not starting it', () => {
    const entry = createArchiveEntry(
      catalogue({ seasonYear: 2026, season: 'FALL', status: 'RELEASING' }),
      NOW,
      'WATCHING'
    );
    expect(entry.userStatus).toBe('WATCHING');
    expect(entry.userHistory).toMatchObject({ startedAt: null, completedAt: null });
  });

  it('without a mode the title is planned, whatever AniList says about its airing', () => {
    expect(createArchiveEntry(catalogue(), NOW).userStatus).toBe('PLAN');
  });

  it('a backfilled title shows up as "no dates" in Journey instead of on a guessed date', () => {
    const entry = createArchiveEntry(catalogue(), NOW, 'COMPLETED');
    const events = deriveJourneyEvents([entry]);
    expect(events).toEqual([]);
    expect(summarizeJourney([entry], events, null).missingHistory.map((anime) => anime.id)).toEqual(['9001']);
    // With "show added" on, the only event is the real add, dated today.
    expect(deriveJourneyEvents([entry], { includeAdded: true }).map((event) => [event.type, event.date])).toEqual([
      ['added', NOW.toISOString()],
    ]);
  });

  it('counts as watched but unrated in the Taste Map until the user rates it', () => {
    const model = buildTasteModel([createArchiveEntry(catalogue(), NOW, 'COMPLETED')]);
    expect(model.totals).toMatchObject({ watched: 1, rated: 0 });
  });

  it('a recorded completion date is still the user’s to add later, and a later status change keeps it', () => {
    const entry = createArchiveEntry(catalogue(), NOW, 'COMPLETED');
    const dated = applyEntryEdit(entry, { reaction: null, note: '', startedAt: null, completedAt: '2018-06' }, NOW);
    expect(dated.userHistory?.completedAt).toBe('2018-06');
    expect(applyStatusChange(dated, 'WATCHING', NOW).userHistory?.completedAt).toBe('2018-06');
  });
});

describe('rating and note are separate', () => {
  const base = createArchiveEntry(catalogue(), NOW, 'COMPLETED');

  it('writing a note never sets or changes the rating', () => {
    const noted = applyEntryEdit(base, {
      reaction: null,
      note: 'I loved every minute of it',
      startedAt: null,
      completedAt: null,
    });
    expect(noted.userNote).toBe('I loved every minute of it');
    expect(noted.userReaction).toBeUndefined();

    const rated = applyEntryEdit(base, { reaction: 'DISLIKE', note: '', startedAt: null, completedAt: null });
    const renoted = applyEntryEdit(rated, {
      reaction: 'DISLIKE',
      note: 'Masterpiece!',
      startedAt: null,
      completedAt: null,
    });
    expect(renoted.userReaction).toBe('DISLIKE');
  });

  it('keeps "no rating" distinct from an explicit "It was okay"', () => {
    const okay = applyEntryEdit(base, { reaction: 'NEUTRAL', note: '', startedAt: null, completedAt: null });
    expect(okay.userReaction).toBe('NEUTRAL');
    expect(buildTasteModel([okay]).totals.rated).toBe(1);
    expect(buildTasteModel([base]).totals.rated).toBe(0);
  });
});
