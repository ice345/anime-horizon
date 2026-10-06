import { describe, expect, it } from 'vitest';
import { mergeArchiveEntries, planArchiveMerge } from '../features/archive/archiveOperations';
import { parseAndMigrateBackup } from '../features/backup/backupSchema';
import { Anime } from '../types';

const entry = (id: number, overrides: Partial<Anime> = {}): Anime => ({
  id: String(id),
  title: { native: `作品 ${id}`, romaji: `Work ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2020,
  genres: ['Drama'],
  userStatus: 'COMPLETED',
  userReaction: 'LIKE',
  userNote: `第 ${id} 部的短评`,
  ...overrides,
});

const archiveOf = (count: number) =>
  new Map(Array.from({ length: count }, (_, index) => [String(index + 1), entry(index + 1)]));

describe('archive merge', () => {
  it('keeps 10 titles when a backup contains one title that already exists', () => {
    const current = archiveOf(10);
    const merged = mergeArchiveEntries(current, [entry(3, { userStatus: 'WATCHING', userNote: '备份里的短评' })]);

    expect(merged.size).toBe(10);
    expect(merged.get('3')).toMatchObject({ userStatus: 'WATCHING', userNote: '备份里的短评' });
    expect(merged.get('1')).toMatchObject({ userNote: '第 1 部的短评', userReaction: 'LIKE' });
  });

  it('grows to 11 titles when a backup contains one new title', () => {
    const merged = mergeArchiveEntries(archiveOf(10), [entry(99)]);

    expect(merged.size).toBe(11);
    expect(merged.get('99')).toMatchObject({ userNote: '第 99 部的短评' });
    Array.from({ length: 10 }, (_, index) => String(index + 1)).forEach((id) => expect(merged.has(id)).toBe(true));
  });

  it('collapses duplicate IDs in the import into a single record', () => {
    const merged = mergeArchiveEntries(archiveOf(2), [entry(5, { userNote: '旧' }), entry(5, { userNote: '新' })]);

    expect(merged.size).toBe(3);
    expect(merged.get('5')?.userNote).toBe('新');
  });

  it('never mutates the current archive map', () => {
    const current = archiveOf(3);
    const snapshot = new Map(current);

    mergeArchiveEntries(current, [entry(2, { userNote: '改动' }), entry(8)]);

    expect(current).toEqual(snapshot);
  });

  it('normalizes imported user fields before storing them', () => {
    const merged = mergeArchiveEntries(new Map(), [
      entry(1, { userStatus: 'BROKEN' as Anime['userStatus'], userNote: 'x'.repeat(400) }),
    ]);

    expect(merged.get('1')?.userStatus).toBe('PLAN');
    expect(merged.get('1')?.userNote).toHaveLength(280);
  });

  it('previews the merge with counts that match the result', () => {
    const current = archiveOf(10);
    const incoming = [entry(3), entry(11), entry(12), entry(12)];

    expect(planArchiveMerge(current.keys(), incoming)).toEqual({
      incoming: 3,
      added: 2,
      updated: 1,
      kept: 9,
      total: 12,
    });
    expect(mergeArchiveEntries(current, incoming).size).toBe(12);
  });
});

describe('malformed backups', () => {
  it.each([
    ['a non-object', 'not a backup'],
    ['an unsupported version', { version: 99, userDetails: [] }],
    ['a broken record', { version: 2, userDetails: [{ id: 'broken' }] }],
    ['a non-array detail list', { version: 2, userDetails: { id: 1 } }],
  ])('rejects %s before anything can be merged', (_label, value) => {
    expect(() => parseAndMigrateBackup(value)).toThrow();
  });

  it('only produces merge input after a backup parses completely', () => {
    const current = archiveOf(10);
    let incoming: Anime[] = [];
    try {
      incoming = parseAndMigrateBackup({ version: 2, userDetails: [entry(50), { id: 'broken' }] }).userDetails;
    } catch {
      // A failed parse leaves nothing to merge.
    }

    expect(mergeArchiveEntries(current, incoming).size).toBe(10);
  });
});
