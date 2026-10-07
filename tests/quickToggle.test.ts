import { describe, expect, it } from 'vitest';
import {
  applyEntryEdit,
  applyStatusChange,
  createArchiveEntry,
  mergeArchiveEntries,
} from '../features/archive/archiveOperations';
import { canQuickRemove, withoutRecentAdd, withRecentAdd } from '../features/archive/quickToggle';
import { Anime } from '../types';

const NOW = new Date('2026-10-06T10:00:00Z');
const catalogue: Anime = {
  id: '7',
  title: { native: '', romaji: 'Old Show', english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2018,
  genres: ['Drama'],
};

const justAdded = () => {
  const entry = createArchiveEntry(catalogue, NOW, 'COMPLETED');
  const archive = new Map([['7', entry]]);
  const recent = withRecentAdd(new Map(), entry);
  return { entry, archive, recent };
};

describe('Discover quick toggle eligibility', () => {
  it('allows taking back a title exactly as this visit added it', () => {
    const { archive, recent } = justAdded();
    expect(canQuickRemove(recent, archive, '7')).toBe(true);
  });

  it('never applies to a title that was already saved before this visit', () => {
    const { archive } = justAdded();
    expect(canQuickRemove(new Map(), archive, '7')).toBe(false);
  });

  it.each([
    ['a status change', (entry: Anime) => applyStatusChange(entry, 'WATCHING', NOW)],
    [
      'a rating',
      (entry: Anime) => applyEntryEdit(entry, { reaction: 'LOVE', note: '', startedAt: null, completedAt: null }),
    ],
    [
      'a note',
      (entry: Anime) => applyEntryEdit(entry, { reaction: null, note: 'mine', startedAt: null, completedAt: null }),
    ],
    [
      'a history date',
      (entry: Anime) => applyEntryEdit(entry, { reaction: null, note: '', startedAt: null, completedAt: '2018' }),
    ],
    ['an import of the same title', (entry: Anime) => mergeArchiveEntries(new Map([['7', entry]]), [entry]).get('7')!],
  ])('stops once the record has %s', (_label, change) => {
    const { entry, recent } = justAdded();
    const edited = change(entry);
    expect(edited).not.toBe(entry);
    expect(canQuickRemove(recent, new Map([['7', edited]]), '7')).toBe(false);
  });

  it('a no-op edit keeps the title as just added', () => {
    const { entry, recent } = justAdded();
    const same = applyStatusChange(entry, 'COMPLETED', NOW);
    expect(same).toBe(entry);
    expect(canQuickRemove(recent, new Map([['7', same]]), '7')).toBe(true);
  });

  it('is false once the title is gone or forgotten', () => {
    const { archive, recent } = justAdded();
    expect(canQuickRemove(recent, new Map(), '7')).toBe(false);
    expect(canQuickRemove(withoutRecentAdd(recent, '7'), archive, '7')).toBe(false);
  });

  it('a re-added title is a new record: an older "just added" record does not make it removable', () => {
    const { recent } = justAdded();
    const again = createArchiveEntry(catalogue, new Date('2026-10-06T10:05:00Z'), 'COMPLETED');
    expect(canQuickRemove(recent, new Map([['7', again]]), '7')).toBe(false);
  });

  it('keeps the no-invented-dates rule for every add mode', () => {
    expect(createArchiveEntry(catalogue, NOW, 'COMPLETED').userHistory).toMatchObject({
      addedAt: NOW.toISOString(),
      completedAt: null,
      startedAt: null,
    });
    expect(createArchiveEntry(catalogue, NOW, 'WATCHING').userHistory).toMatchObject({ startedAt: null });
  });
});
