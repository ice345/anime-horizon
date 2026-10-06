import { describe, expect, it } from 'vitest';
import { createArchiveEntry } from '../features/archive/archiveOperations';
import { DEFAULT_ARCHIVE_STATUS } from '../services/archiveStatus';
import { Anime } from '../types';

const anime = (overrides: Partial<Anime> = {}): Anime => ({
  id: '1',
  title: { native: '作品', romaji: 'Work', english: 'Work' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SUMMER',
  seasonYear: 2026,
  genres: ['Drama'],
  ...overrides,
});

describe('archive status on add', () => {
  it('keeps the archive default as PLAN', () => {
    expect(DEFAULT_ARCHIVE_STATUS).toBe('PLAN');
  });

  it('adds an anime that finished airing years ago as PLAN, not COMPLETED', () => {
    const entry = createArchiveEntry(anime({ seasonYear: 2006, season: 'SPRING', status: 'FINISHED' }));

    expect(entry.userStatus).toBe('PLAN');
  });

  it('adds a currently airing anime as PLAN, not WATCHING', () => {
    expect(createArchiveEntry(anime({ status: 'RELEASING' })).userStatus).toBe('PLAN');
  });

  it('ignores any status carried over from catalogue data', () => {
    const entry = createArchiveEntry(
      anime({ userStatus: 'COMPLETED', userReaction: 'LOVE', userNote: 'not the user’s note' })
    );

    expect(entry).toMatchObject({ userStatus: 'PLAN', userNote: undefined });
    // A new entry has no reaction yet; it is not "okay" by default.
    expect(entry.userReaction).toBeUndefined();
  });
});
