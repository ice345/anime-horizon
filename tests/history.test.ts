import { describe, expect, it } from 'vitest';
import {
  applyEntryEdit,
  applyStatusChange,
  createArchiveEntry,
  mergeArchiveEntries,
  mergeUserHistory,
} from '../features/archive/archiveOperations';
import { createBackup, parseAndMigrateBackup } from '../features/backup/backupSchema';
import { formatHistoryDate } from '../shared/i18n/dates';
import {
  emptyUserHistory,
  getHistoryPrecision,
  normalizeHistoryDate,
  normalizeUserHistory,
  parseHistoryDateInput,
  pickEarliestHistoryDate,
  pickLatestHistoryDate,
  toEditableHistoryDate,
  UserHistory,
} from '../shared/schemas/history';
import {
  ARCHIVE_SCHEMA_VERSION,
  ARCHIVE_STORAGE_KEYS,
  loadArchiveState,
  migrateArchiveRecord,
  saveArchiveState,
} from '../shared/storage/archiveStorage';
import { Anime } from '../types';

const T0 = new Date('2026-10-01T08:00:00.000Z');
const T1 = new Date('2026-10-03T12:30:00.000Z');
const T2 = new Date('2026-10-05T21:15:00.000Z');

const catalogueAnime = (overrides: Partial<Anime> = {}): Anime => ({
  id: '42',
  title: { native: '響け！ユーフォニアム', romaji: 'Hibike! Euphonium', english: 'Sound! Euphonium' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2015,
  genres: ['Music', 'Drama'],
  status: 'FINISHED',
  ...overrides,
});

const withHistory = (history: Partial<UserHistory>, overrides: Partial<Anime> = {}): Anime => ({
  ...catalogueAnime(overrides),
  userStatus: 'COMPLETED',
  userReaction: 'LOVE',
  userNote: 'note',
  userHistory: { ...emptyUserHistory(), ...history },
  ...overrides,
});

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('history date values', () => {
  it.each([
    ['2019', 'year'],
    ['2019-06', 'month'],
    ['2019-06-15', 'day'],
    ['2026-10-05T09:30:12.345Z', 'instant'],
  ])('keeps %s as a %s-precision value', (value, precision) => {
    expect(normalizeHistoryDate(value)).toBe(value);
    expect(getHistoryPrecision(value)).toBe(precision);
  });

  it('normalizes instants with an offset to UTC', () => {
    expect(normalizeHistoryDate('2026-10-05T18:30:00+09:00')).toBe('2026-10-05T09:30:00.000Z');
  });

  it.each(['', 'yesterday', '2019-13', '2019-02-30', '1899', '19-06-15', '2019-6-1', 42, null, {}])(
    'treats %j as unknown',
    (value) => {
      expect(normalizeHistoryDate(value)).toBeNull();
    }
  );

  it('normalizes each history field independently and never keeps a partial updatedAt', () => {
    expect(
      normalizeUserHistory({ addedAt: 'garbage', startedAt: '2019', completedAt: '2019-02-30', updatedAt: '2020' })
    ).toEqual({ addedAt: null, startedAt: '2019', completedAt: null, updatedAt: null });
    expect(normalizeUserHistory(undefined)).toEqual(emptyUserHistory());
  });

  it('parses year, month or day input written with common separators', () => {
    const now = T2;
    expect(parseHistoryDateInput('2019', now)).toEqual({ value: '2019' });
    expect(parseHistoryDateInput('2019/6', now)).toEqual({ value: '2019-06' });
    expect(parseHistoryDateInput(' 2019-06-15 ', now)).toEqual({ value: '2019-06-15' });
    expect(parseHistoryDateInput('2019年6月15日', now)).toEqual({ value: '2019-06-15' });
    expect(parseHistoryDateInput('', now)).toEqual({ value: null });
    expect(parseHistoryDateInput('June 2019', now)).toEqual({ error: 'invalid' });
    expect(parseHistoryDateInput('2019-02-30', now)).toEqual({ error: 'invalid' });
    expect(parseHistoryDateInput('2027', now)).toEqual({ error: 'future' });
    expect(parseHistoryDateInput('2026', now)).toEqual({ value: '2026' });
  });

  it('shows stored values in an editable form without inventing precision', () => {
    expect(toEditableHistoryDate(null)).toBe('');
    expect(toEditableHistoryDate('2019')).toBe('2019');
    expect(toEditableHistoryDate('2019-06')).toBe('2019-06');
    expect(toEditableHistoryDate('2026-10-05T09:30:00.000Z')).toMatch(/^2026-10-0[4-6]$/);
  });

  it('picks the earliest or latest known value and prefers the more precise of overlapping values', () => {
    expect(pickEarliestHistoryDate(null, '2019')).toBe('2019');
    expect(pickEarliestHistoryDate('2019', null)).toBe('2019');
    expect(pickEarliestHistoryDate('2018-05', '2019')).toBe('2018-05');
    expect(pickEarliestHistoryDate('2019', '2019-06-15')).toBe('2019-06-15');
    expect(pickEarliestHistoryDate('2019-06-15T10:00:00.000Z', '2019-06-15')).toBe('2019-06-15T10:00:00.000Z');
    expect(pickLatestHistoryDate('2026-10-01T00:00:00.000Z', '2026-10-05T00:00:00.000Z')).toBe(
      '2026-10-05T00:00:00.000Z'
    );
    expect(pickLatestHistoryDate(null, null)).toBeNull();
  });
});

describe('timestamp semantics', () => {
  it('adds a new title as PLAN with addedAt and updatedAt only', () => {
    const entry = createArchiveEntry(catalogueAnime(), T0);

    expect(entry.userStatus).toBe('PLAN');
    expect(entry.userHistory).toEqual({
      addedAt: T0.toISOString(),
      startedAt: null,
      completedAt: null,
      updatedAt: T0.toISOString(),
    });
  });

  it('never derives history from AniList release metadata', () => {
    const entry = createArchiveEntry(catalogueAnime({ seasonYear: 2006, status: 'FINISHED' }), T0);

    expect(entry.userHistory?.startedAt).toBeNull();
    expect(entry.userHistory?.completedAt).toBeNull();
  });

  it('PLAN → WATCHING records startedAt and keeps addedAt', () => {
    const watching = applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'WATCHING', T1);

    expect(watching.userHistory).toEqual({
      addedAt: T0.toISOString(),
      startedAt: T1.toISOString(),
      completedAt: null,
      updatedAt: T1.toISOString(),
    });
  });

  it('WATCHING → COMPLETED records completedAt and keeps startedAt', () => {
    const watching = applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'WATCHING', T1);
    const completed = applyStatusChange(watching, 'COMPLETED', T2);

    expect(completed.userHistory).toEqual({
      addedAt: T0.toISOString(),
      startedAt: T1.toISOString(),
      completedAt: T2.toISOString(),
      updatedAt: T2.toISOString(),
    });
  });

  it('PLAN → COMPLETED records completion without inventing a start', () => {
    const completed = applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'COMPLETED', T1);

    expect(completed.userHistory?.startedAt).toBeNull();
    expect(completed.userHistory?.completedAt).toBe(T1.toISOString());
  });

  it('COMPLETED → WATCHING keeps the known completion and does not fabricate a start', () => {
    const completed = applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'COMPLETED', T1);
    const rewatch = applyStatusChange(completed, 'WATCHING', T2);

    expect(rewatch.userHistory).toEqual({
      addedAt: T0.toISOString(),
      startedAt: null,
      completedAt: T1.toISOString(),
      updatedAt: T2.toISOString(),
    });
    // Completing again does not overwrite the first completion.
    expect(applyStatusChange(rewatch, 'COMPLETED', T2).userHistory?.completedAt).toBe(T1.toISOString());
  });

  it('moving back to PLAN never erases known dates', () => {
    const completed = applyStatusChange(
      applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'WATCHING', T1),
      'COMPLETED',
      T1
    );
    const planned = applyStatusChange(completed, 'PLAN', T2);

    expect(planned.userHistory).toMatchObject({
      startedAt: T1.toISOString(),
      completedAt: T1.toISOString(),
      updatedAt: T2.toISOString(),
    });
  });

  it('choosing the same status changes nothing', () => {
    const entry = createArchiveEntry(catalogueAnime(), T0);
    expect(applyStatusChange(entry, 'PLAN', T2)).toBe(entry);
  });

  it('manual dates are stored as entered and are not overwritten by later status changes', () => {
    const entry = createArchiveEntry(catalogueAnime(), T0);
    const backfilled = applyEntryEdit(
      entry,
      { reaction: 'LOVE', note: 'watched with friends', startedAt: '2019', completedAt: '2019-06' },
      T1
    );

    expect(backfilled.userHistory).toEqual({
      addedAt: T0.toISOString(),
      startedAt: '2019',
      completedAt: '2019-06',
      updatedAt: T1.toISOString(),
    });
    const watching = applyStatusChange(backfilled, 'WATCHING', T2);
    const completed = applyStatusChange(watching, 'COMPLETED', T2);
    expect(completed.userHistory).toMatchObject({ startedAt: '2019', completedAt: '2019-06' });
  });

  it('an edit that changes nothing leaves updatedAt alone', () => {
    const entry = createArchiveEntry(catalogueAnime(), T0);
    const same = applyEntryEdit(entry, { reaction: null, note: '', startedAt: null, completedAt: null }, T2);

    expect(same).toBe(entry);
  });
});

describe('storage migration', () => {
  const legacyRecord = {
    id: 42,
    title: { native: '響け！ユーフォニアム', romaji: 'Hibike! Euphonium' },
    season: 'SPRING',
    seasonYear: 2015,
    genres: ['Music'],
    status: 'FINISHED',
    userStatus: 'COMPLETED',
    userReaction: 'LOVE',
    userNote: '名场面太多了',
  };

  it('migrates a legacy COMPLETED record with every history date unknown', () => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify([legacyRecord]));

    const state = loadArchiveState(storage);
    const entry = state.selectedAnimeDetails.get('42');

    expect(state.schemaVersion).toBe(3);
    expect(entry).toMatchObject({ userStatus: 'COMPLETED', userReaction: 'LOVE', userNote: '名场面太多了' });
    // No fake migration timestamp.
    expect(entry?.userHistory).toEqual(emptyUserHistory());
  });

  it('is idempotent and records the schema version on save', () => {
    const once = migrateArchiveRecord(legacyRecord);
    const twice = migrateArchiveRecord(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);

    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify([legacyRecord]));
    const first = loadArchiveState(storage);
    saveArchiveState(first, storage);
    expect(storage.getItem(ARCHIVE_STORAGE_KEYS.schemaVersion)).toBe(String(ARCHIVE_SCHEMA_VERSION));

    const second = loadArchiveState(storage);
    expect(second.schemaVersion).toBe(ARCHIVE_SCHEMA_VERSION);
    expect(Array.from(second.selectedAnimeDetails.values())).toEqual(Array.from(first.selectedAnimeDetails.values()));
  });

  it('keeps known history across save and load', () => {
    const storage = new MemoryStorage();
    const entry = applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'WATCHING', T1);
    saveArchiveState({ selectedIds: new Set(['42']), selectedAnimeDetails: new Map([['42', entry]]) }, storage);

    expect(loadArchiveState(storage).selectedAnimeDetails.get('42')?.userHistory).toEqual(entry.userHistory);
  });

  it('turns a malformed stored date into unknown without discarding the record', () => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.schemaVersion, '4');
    storage.setItem(
      ARCHIVE_STORAGE_KEYS.details,
      JSON.stringify([
        { ...legacyRecord, userHistory: { addedAt: 'not a date', completedAt: '2019-06-15', updatedAt: 5 } },
      ])
    );

    expect(loadArchiveState(storage).selectedAnimeDetails.get('42')?.userHistory).toEqual({
      addedAt: null,
      startedAt: null,
      completedAt: '2019-06-15',
      updatedAt: null,
    });
  });
});

describe('backup compatibility', () => {
  it('imports an old v2 backup with history unknown', () => {
    const backup = parseAndMigrateBackup({
      version: 2,
      userDetails: [{ ...catalogueAnime(), userStatus: 'COMPLETED' }],
    });

    expect(backup.userDetails[0].userStatus).toBe('COMPLETED');
    expect(backup.userDetails[0].userHistory).toEqual(emptyUserHistory());
  });

  it('round-trips personal timestamps through a new backup', () => {
    const entry = applyEntryEdit(
      applyStatusChange(createArchiveEntry(catalogueAnime(), T0), 'COMPLETED', T1),
      { reaction: 'LOVE', note: '', startedAt: '2019', completedAt: T1.toISOString() },
      T2
    );
    const file = JSON.stringify(
      createBackup({ config: {}, userSelection: ['42'], userDetails: [entry], currentViewData: [] })
    );
    const restored = parseAndMigrateBackup(JSON.parse(file));

    expect(restored.version).toBe(4);
    expect(restored.userDetails[0].userHistory).toEqual(entry.userHistory);
  });

  it('an older backup without timestamps does not erase newer local history', () => {
    const local = withHistory({
      addedAt: T0.toISOString(),
      startedAt: '2019',
      completedAt: T1.toISOString(),
      updatedAt: T2.toISOString(),
    });
    const oldBackup = parseAndMigrateBackup({
      version: 2,
      userDetails: [{ ...catalogueAnime(), userStatus: 'WATCHING', userNote: 'from the old backup' }],
    });

    const merged = mergeArchiveEntries(new Map([['42', local]]), oldBackup.userDetails).get('42');

    expect(merged?.userHistory).toEqual(local.userHistory);
    // Phase A semantics are unchanged: the backup's status and note still win.
    expect(merged).toMatchObject({ userStatus: 'WATCHING', userNote: 'from the old backup' });
  });

  it('merges known dates field by field: earliest occurrence, latest update', () => {
    const local: UserHistory = {
      addedAt: '2026-10-01T00:00:00.000Z',
      startedAt: null,
      completedAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    };
    const incoming: UserHistory = {
      addedAt: '2024-01-01T00:00:00.000Z',
      startedAt: '2019',
      completedAt: '2026-10-04T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    };

    expect(mergeUserHistory(local, incoming)).toEqual({
      addedAt: '2024-01-01T00:00:00.000Z',
      startedAt: '2019',
      completedAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    });
    // Order of arguments does not change the result.
    expect(mergeUserHistory(incoming, local)).toEqual(mergeUserHistory(local, incoming));
  });

  it('normalizes malformed backup timestamps to unknown instead of rejecting the backup', () => {
    const backup = parseAndMigrateBackup({
      version: 3,
      userDetails: [{ ...catalogueAnime(), userHistory: { addedAt: '2019-99-99', completedAt: '2019-06' } }],
    });

    expect(backup.userDetails[0].userHistory).toEqual({
      addedAt: null,
      startedAt: null,
      completedAt: '2019-06',
      updatedAt: null,
    });
  });
});

describe('locale-aware history dates', () => {
  it.each([
    ['en', 'Oct 5, 2026', 'Jun 15, 2019', 'June 2019', '2019'],
    ['ja', '2026/10/05', '2019/06/15', '2019年6月', '2019年'],
    ['zh-CN', '2026年10月5日', '2019年6月15日', '2019年6月', '2019年'],
  ] as const)('formats each precision in %s', (locale, instant, day, month, year) => {
    expect(formatHistoryDate('2026-10-05T09:30:00.000Z', locale, 'UTC')).toBe(instant);
    expect(formatHistoryDate('2019-06-15', locale)).toBe(day);
    expect(formatHistoryDate('2019-06', locale)).toBe(month);
    expect(formatHistoryDate('2019', locale)).toBe(year);
  });

  it('never shifts a date-only value across time zones', () => {
    expect(formatHistoryDate('2019-01-01', 'en', 'Pacific/Honolulu')).toBe('Jan 1, 2019');
  });
});
