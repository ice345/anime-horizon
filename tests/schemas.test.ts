import { describe, expect, it } from 'vitest';
import { createBackup, parseAndMigrateBackup } from '../features/backup/backupSchema';
import { normalizeAnimeRecord, parseAnimeList } from '../shared/schemas/anime';

const record = (id: number | string = 101) => ({
  id,
  title: { native: '测试作品', romaji: 'Test Work' },
  coverImage: { large: 'https://example.com/cover.jpg' },
  season: 'SUMMER',
  seasonYear: 2024,
  genres: ['Drama'],
});

describe('shared anime schemas', () => {
  it('normalizes external records into the app-owned Anime shape', () => {
    expect(normalizeAnimeRecord(record())).toMatchObject({
      id: '101',
      season: 'SUMMER',
      seasonYear: 2024,
      title: { native: '测试作品', romaji: 'Test Work', english: '' },
      coverImage: { large: 'https://example.com/cover.jpg' },
      userStatus: 'PLAN',
    });
    // No reaction in the source means no reaction recorded, not NEUTRAL.
    expect(normalizeAnimeRecord(record()).userReaction).toBeUndefined();
  });

  it('rejects malformed or oversized external data at the boundary', () => {
    expect(() => normalizeAnimeRecord({ ...record(), id: 'not-a-number' })).toThrow();
    expect(() => parseAnimeList([record(), { ...record(102), description: 'x'.repeat(20_001) }])).toThrow();
  });
});

describe('JSON backup migration', () => {
  it('migrates v1-style data, deduplicates details, and preserves selected IDs', () => {
    const migrated = parseAndMigrateBackup({
      version: 1,
      userSelection: [101, '202'],
      userDetails: [record(101), { ...record(101), userNote: 'newer note' }],
      currentViewData: [record(303)],
      config: { itemsPerSeason: 30, startYear: 2010, endYear: 2024 },
    });

    expect(migrated.version).toBe(4);
    expect(migrated.userSelection).toEqual(['101', '202']);
    expect(migrated.userDetails).toHaveLength(1);
    expect(migrated.currentViewData[0].id).toBe('303');
    expect(migrated.config.itemsPerSeason).toBe(30);
  });

  it('rejects unsupported versions and invalid records without partial state', () => {
    expect(() => parseAndMigrateBackup({ version: 99 })).toThrow(
      expect.objectContaining({ code: 'unsupportedVersion' })
    );
    expect(() => parseAndMigrateBackup({ version: 2, userDetails: [{ id: 'broken' }] })).toThrow();
  });

  it('creates the current backup envelope', () => {
    const backup = createBackup({ userSelection: [], userDetails: [], currentViewData: [], config: {} });
    expect(backup.version).toBe(4);
    expect(() => new Date(backup.timestamp).toISOString()).not.toThrow();
  });
});
