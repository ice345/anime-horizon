import { Anime } from '../../types';

/**
 * Discover's quick toggle: clicking a title again right after adding it takes that add back.
 *
 * `recent` maps each title added from Discover during the current visit to the exact record that the
 * add created. It lives only in memory (never stored), so after a reload, or once the user leaves
 * Discover, every saved title is an established record again.
 *
 * A title can be quick-removed only while its archive record is still that same object. Every real
 * change (status, rating, note, dates, an import, a change from another tab) produces a new record,
 * so an edited title is never deleted by a click in the catalogue. Removing established records stays
 * an explicit, confirmed action in My Anime.
 */
export type RecentAdds = ReadonlyMap<string, Anime>;

export const canQuickRemove = (recent: RecentAdds, archive: ReadonlyMap<string, Anime>, id: string): boolean => {
  const added = recent.get(id);
  return added !== undefined && archive.get(id) === added;
};

export const withRecentAdd = (recent: RecentAdds, entry: Anime): Map<string, Anime> =>
  new Map(recent).set(String(entry.id), entry);

export const withoutRecentAdd = (recent: RecentAdds, id: string): Map<string, Anime> => {
  const next = new Map(recent);
  next.delete(id);
  return next;
};
