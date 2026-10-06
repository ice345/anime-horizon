import { describe, expect, it } from 'vitest';
import { loadArchiveState, saveArchiveState, ARCHIVE_STORAGE_KEYS } from '../shared/storage/archiveStorage';

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
