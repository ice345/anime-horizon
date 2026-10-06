import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_STORAGE_KEYS,
  loadArchiveState,
  readRawArchivePayload,
  saveArchiveState,
} from '../shared/storage/archiveStorage';

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

const anime = {
  id: '77',
  title: { native: '本地作品', romaji: '', english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'WINTER' as const,
  seasonYear: 2020,
  genres: ['Drama'],
  userStatus: 'COMPLETED' as const,
  userReaction: 'LIKE' as const,
};

describe('archive storage boundary', () => {
  it('round-trips normalized details and IDs', () => {
    const storage = new MemoryStorage();
    saveArchiveState({ selectedIds: new Set(['77']), selectedAnimeDetails: new Map([['77', anime]]) }, storage);

    const state = loadArchiveState(storage);
    expect(state.selectedIds).toEqual(new Set(['77']));
    expect(state.selectedAnimeDetails.get('77')).toMatchObject({ id: '77', userStatus: 'COMPLETED' });
    expect(state.recovered).toBe(false);
  });

  it('keeps valid IDs when the details payload is damaged', () => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.selectedIds, JSON.stringify(['77', 'not-an-id']));
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, '{broken');

    const state = loadArchiveState(storage);
    expect(state.selectedIds).toEqual(new Set(['77']));
    expect(state.selectedAnimeDetails.size).toBe(0);
    expect(state.recovered).toBe(true);
  });

  it('ignores only malformed detail entries instead of discarding the archive', () => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify([anime, { id: 'bad' }]));

    const state = loadArchiveState(storage);
    expect(state.selectedAnimeDetails.size).toBe(1);
    expect(state.selectedIds).toEqual(new Set(['77']));
  });

  it('migrates legacy archive entries without a status to PLAN instead of inferring from the release period', () => {
    const storage = new MemoryStorage();
    const { userStatus: _legacyStatus, ...legacyAnime } = anime;
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify([{ ...legacyAnime, status: 'FINISHED' }]));

    const state = loadArchiveState(storage);
    expect(state.selectedAnimeDetails.get('77')).toMatchObject({ userStatus: 'PLAN' });
  });
});

describe('retired storage', () => {
  it('clears keys from removed features and nothing else', async () => {
    const { clearRetiredStorage } = await import('../shared/storage/retiredStorage');
    const storage = new MemoryStorage();
    storage.setItem('anime-horizon-game-stats-v1', '{"score":10}');
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, '[]');
    clearRetiredStorage(storage);
    expect(storage.getItem('anime-horizon-game-stats-v1')).toBeNull();
    expect(storage.getItem(ARCHIVE_STORAGE_KEYS.details)).toBe('[]');
  });
});

describe('stored data that fails validation is never silently destroyed', () => {
  const valid = { ...anime, id: '1' };
  const badReaction = { ...anime, id: '2', userReaction: 'MEH' };
  const longNote = { ...anime, id: '3', userNote: 'x'.repeat(281) };
  const badTitle = { ...anime, id: '4', title: 42 };

  const seeded = (details: string) => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, details);
    storage.setItem(ARCHIVE_STORAGE_KEYS.selectedIds, JSON.stringify(['1', '2', '3', '4']));
    storage.setItem(ARCHIVE_STORAGE_KEYS.schemaVersion, '5');
    return storage;
  };

  it.each([
    ['an invalid reaction value', [valid, badReaction], 1],
    ['an over-long note', [valid, longNote], 1],
    ['a malformed title object', [valid, badTitle], 1],
    ['all three at once', [valid, badReaction, longNote, badTitle], 3],
  ])('reports %s and leaves the original bytes untouched', (_label, records, dropped) => {
    const raw = JSON.stringify(records);
    const storage = seeded(raw);
    const state = loadArchiveState(storage);

    expect(state.integrity).toEqual({ droppedRecords: dropped, unreadable: false });
    expect([...state.selectedAnimeDetails.keys()]).toEqual(['1']);
    expect(storage.getItem(ARCHIVE_STORAGE_KEYS.details)).toBe(raw);
    expect(readRawArchivePayload(storage)[ARCHIVE_STORAGE_KEYS.details]).toBe(raw);
  });

  it('reports an unparseable payload without replacing it', () => {
    const storage = seeded('{not json');
    const state = loadArchiveState(storage);
    expect(state.integrity).toEqual({ droppedRecords: 0, unreadable: true });
    expect(storage.getItem(ARCHIVE_STORAGE_KEYS.details)).toBe('{not json');
  });

  it('reports nothing for valid released-version data, which keeps migrating automatically', () => {
    const storage = new MemoryStorage();
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify([{ ...anime, userReaction: 'NEUTRAL' }]));
    const state = loadArchiveState(storage);
    expect(state.integrity).toBeNull();
    expect(state.selectedAnimeDetails.get('77')?.userReaction).toBeUndefined();
  });
});
