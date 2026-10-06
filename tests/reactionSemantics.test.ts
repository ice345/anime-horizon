import { describe, expect, it } from 'vitest';
import { applyEntryEdit, createArchiveEntry, mergeArchiveEntries } from '../features/archive/archiveOperations';
import { createBackup, parseAndMigrateBackup } from '../features/backup/backupSchema';
import { generateArchiveSql, parseArchiveSql, SQL_FORMAT_MARKER } from '../services/archiveSql';
import {
  ARCHIVE_SCHEMA_VERSION,
  ARCHIVE_STORAGE_KEYS,
  loadArchiveState,
  saveArchiveState,
} from '../shared/storage/archiveStorage';
import { Anime } from '../types';

class MemoryStorage {
  private values = new Map<string, string>();
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

const record = (id: string, reaction?: string): Anime =>
  ({
    id,
    title: { native: `作品${id}`, romaji: `Work ${id}`, english: '' },
    coverImage: { extraLarge: '', large: '', color: '' },
    season: 'SPRING',
    seasonYear: 2015,
    genres: ['Drama'],
    userStatus: 'COMPLETED',
    ...(reaction ? { userReaction: reaction } : {}),
  }) as Anime;

const reactions = (archive: Iterable<Anime>) => Array.from(archive, (anime) => [anime.id, anime.userReaction ?? null]);

describe('no reaction vs explicit NEUTRAL', () => {
  it('new entries start without a reaction', () => {
    expect(createArchiveEntry(record('1', 'LOVE')).userReaction).toBeUndefined();
  });

  it('lets the user choose NEUTRAL and clear it again', () => {
    const entry = createArchiveEntry(record('1'));
    const okay = applyEntryEdit(entry, { reaction: 'NEUTRAL', note: '', startedAt: null, completedAt: null });
    expect(okay.userReaction).toBe('NEUTRAL');
    const cleared = applyEntryEdit(okay, { reaction: null, note: '', startedAt: null, completedAt: null });
    expect(cleared.userReaction).toBeUndefined();
  });
});

describe('archive storage schema 5', () => {
  const store = (version: string | null, details: Anime[]) => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify(details));
    if (version) storage.setItem(ARCHIVE_STORAGE_KEYS.schemaVersion, version);
    return storage;
  };
  const legacy = [record('1', 'NEUTRAL'), record('2', 'LOVE'), record('3', 'HATE'), record('4')];

  it.each([null, '4'])('reads a legacy NEUTRAL (schema %s) as "no reaction" and keeps real reactions', (version) => {
    const state = loadArchiveState(store(version, legacy));
    expect(reactions(state.selectedAnimeDetails.values())).toEqual([
      ['1', null],
      ['2', 'LOVE'],
      ['3', 'HATE'],
      ['4', null],
    ]);
  });

  it('keeps an explicit NEUTRAL saved under schema 5, and migration is idempotent', () => {
    expect(ARCHIVE_SCHEMA_VERSION).toBe(5);
    const migrated = loadArchiveState(store('4', legacy));
    const storage = new MemoryStorage();
    const okay = applyEntryEdit(migrated.selectedAnimeDetails.get('4')!, {
      reaction: 'NEUTRAL',
      note: '',
      startedAt: null,
      completedAt: null,
    });
    const details = new Map(migrated.selectedAnimeDetails).set('4', okay);
    saveArchiveState({ selectedIds: new Set(details.keys()), selectedAnimeDetails: details }, storage);

    const reloaded = loadArchiveState(storage);
    expect(storage.getItem(ARCHIVE_STORAGE_KEYS.schemaVersion)).toBe('5');
    expect(reactions(reloaded.selectedAnimeDetails.values())).toEqual([
      ['1', null],
      ['2', 'LOVE'],
      ['3', 'HATE'],
      ['4', 'NEUTRAL'],
    ]);
  });
});

describe('backups', () => {
  it('imports NEUTRAL from a version 1–3 backup as "no reaction"', () => {
    const restored = parseAndMigrateBackup({ version: 3, userDetails: [record('1', 'NEUTRAL'), record('2', 'LIKE')] });
    expect(reactions(restored.userDetails)).toEqual([
      ['1', null],
      ['2', 'LIKE'],
    ]);
  });

  it('round-trips explicit NEUTRAL and missing reactions through a version 4 backup', () => {
    const file = JSON.stringify(
      createBackup({
        config: {},
        userSelection: [],
        userDetails: [record('1', 'NEUTRAL'), record('2')],
        currentViewData: [],
      })
    );
    const restored = parseAndMigrateBackup(JSON.parse(file));
    expect(restored.version).toBe(4);
    expect(reactions(restored.userDetails)).toEqual([
      ['1', 'NEUTRAL'],
      ['2', null],
    ]);
  });

  it('an import without a reaction never erases a reaction given locally', () => {
    const current = new Map([
      ['1', record('1', 'LOVE')],
      ['2', record('2', 'LIKE')],
    ]);
    const merged = mergeArchiveEntries(current, [record('1'), record('2', 'HATE')]);
    expect(reactions(merged.values())).toEqual([
      ['1', 'LOVE'],
      ['2', 'HATE'],
    ]);
  });
});

describe('SQL', () => {
  it('exports NULL for "no reaction" with a format marker and round-trips explicit NEUTRAL', () => {
    const sql = generateArchiveSql([record('1', 'NEUTRAL'), record('2')]);
    expect(sql).toContain(SQL_FORMAT_MARKER);
    expect(sql).toContain('`user_reaction` VARCHAR(20) NULL DEFAULT NULL');
    expect(reactions(parseArchiveSql(sql))).toEqual([
      ['1', 'NEUTRAL'],
      ['2', null],
    ]);
  });

  it('reads NEUTRAL in an older dump (no marker) as "no reaction"', () => {
    const legacy = generateArchiveSql([record('1', 'NEUTRAL'), record('2', 'LOVE')]).replace(SQL_FORMAT_MARKER, '');
    expect(reactions(parseArchiveSql(legacy))).toEqual([
      ['1', null],
      ['2', 'LOVE'],
    ]);
  });
});
