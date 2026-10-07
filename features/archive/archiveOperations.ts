import { normalizeAnimeRecord } from '../../shared/schemas/anime';
import {
  HistoryDate,
  historyInstant,
  normalizeUserHistory,
  pickEarliestHistoryDate,
  pickLatestHistoryDate,
  UserHistory,
} from '../../shared/schemas/history';
import { DEFAULT_ARCHIVE_STATUS } from '../../services/archiveStatus';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../../types';

export const MAX_ARCHIVE_NOTE_LENGTH = 280;

const normalizeStatus = (status: UserAnimeStatus | undefined): UserAnimeStatus =>
  status === 'PLAN' || status === 'WATCHING' || status === 'COMPLETED' ? status : DEFAULT_ARCHIVE_STATUS;

/** A known reaction, or undefined when none was recorded. NEUTRAL is a real answer, never a default. */
export const normalizeReaction = (reaction: unknown): UserAnimeReaction | undefined =>
  reaction === 'LOVE' || reaction === 'LIKE' || reaction === 'NEUTRAL' || reaction === 'DISLIKE' || reaction === 'HATE'
    ? reaction
    : undefined;

/**
 * Before archive schema 5 / backup version 4 / SQL format 2, every title without a reaction was stored
 * as NEUTRAL, and the card showed it as "no rating yet". A legacy NEUTRAL therefore cannot be told
 * apart from "never rated", so it is read as unknown. Explicit reactions are kept.
 */
export const readLegacyReaction = (reaction: unknown): UserAnimeReaction | undefined =>
  reaction === 'NEUTRAL' ? undefined : normalizeReaction(reaction);

/**
 * Normalizes a record that is about to be stored as a user-owned archive entry.
 * Every archive entry carries a `userHistory`; missing or malformed fields become unknown (null),
 * never a guessed or migration-time date.
 */
export const normalizeArchiveEntry = (anime: Anime): Anime =>
  normalizeAnimeRecord({
    ...anime,
    userStatus: normalizeStatus(anime.userStatus),
    userReaction: normalizeReaction(anime.userReaction),
    userNote: typeof anime.userNote === 'string' ? anime.userNote.slice(0, MAX_ARCHIVE_NOTE_LENGTH) : undefined,
    userHistory: normalizeUserHistory(anime.userHistory),
  });

/**
 * Creates the archive entry for a catalogue title the user has just added.
 *
 * Catalogue data never decides the user's watch status or history (see DEFAULT_ARCHIVE_STATUS). The
 * status is PLAN unless the user explicitly chose another one for this add (Discover's visible
 * "add as" control). Either way the only date recorded is `addedAt`: adding a title today says when
 * it entered the archive, not when it was started or finished, so `startedAt` and `completedAt` stay
 * unknown until the user records them.
 */
export const createArchiveEntry = (
  anime: Anime,
  now: Date = new Date(),
  status: UserAnimeStatus = DEFAULT_ARCHIVE_STATUS
): Anime => ({
  ...anime,
  userStatus: normalizeStatus(status),
  // No reaction until the user gives one.
  userReaction: undefined,
  userNote: undefined,
  userHistory: {
    addedAt: historyInstant(now),
    startedAt: null,
    completedAt: null,
    updatedAt: historyInstant(now),
  },
});

const historyOf = (anime: Anime): UserHistory => normalizeUserHistory(anime.userHistory);

/**
 * Applies a watch-status change and records when it happened.
 *
 * - Choosing the current status again changes nothing.
 * - Every real change sets `updatedAt`.
 * - → WATCHING sets `startedAt` only when neither a start nor a completion is known. Re-entering
 *   WATCHING after a known completion (a likely rewatch) leaves the history untouched.
 * - → COMPLETED sets `completedAt` only when it is unknown; a known completion is never overwritten.
 *   PLAN → COMPLETED leaves `startedAt` unknown rather than inventing a start.
 * - → PLAN, and any other move, never erases a known date.
 */
export const applyStatusChange = (entry: Anime, status: UserAnimeStatus, now: Date = new Date()): Anime => {
  if (entry.userStatus === status) return entry;
  const at = historyInstant(now);
  const history: UserHistory = { ...historyOf(entry), updatedAt: at };
  if (status === 'WATCHING' && !history.startedAt && !history.completedAt) history.startedAt = at;
  if (status === 'COMPLETED' && !history.completedAt) history.completedAt = at;
  return { ...entry, userStatus: status, userHistory: history };
};

export interface ArchiveEntryEdit {
  /** `null` means "no reaction" (unknown), which the user can choose to go back to. */
  reaction: UserAnimeReaction | null;
  note: string;
  /** User-supplied history; `null` clears a date back to unknown. */
  startedAt: HistoryDate | null;
  completedAt: HistoryDate | null;
}

/**
 * Applies the note panel's edits. `updatedAt` moves only when something actually changed.
 * Manually entered dates are taken as the user's statement of fact and are never rewritten later
 * by status changes.
 */
export const applyEntryEdit = (entry: Anime, edit: ArchiveEntryEdit, now: Date = new Date()): Anime => {
  const history = historyOf(entry);
  const reaction = normalizeReaction(edit.reaction);
  const note = edit.note.trim().slice(0, MAX_ARCHIVE_NOTE_LENGTH) || undefined;
  const changed =
    reaction !== normalizeReaction(entry.userReaction) ||
    note !== (entry.userNote || undefined) ||
    edit.startedAt !== history.startedAt ||
    edit.completedAt !== history.completedAt;
  if (!changed) return entry;
  return {
    ...entry,
    userReaction: reaction,
    userNote: note,
    userHistory: {
      ...history,
      startedAt: edit.startedAt,
      completedAt: edit.completedAt,
      updatedAt: historyInstant(now),
    },
  };
};

/**
 * Field-level history merge used by every restore. Unknown never erases known, so an older backup
 * without timestamps cannot wipe newer local history. When both sides know a date:
 * `addedAt`, `startedAt` and `completedAt` keep the earliest (the first time it happened) and
 * `updatedAt` keeps the latest. If one value's span contains the other ("2019" vs "2019-06-15"),
 * the more precise value wins.
 */
export const mergeUserHistory = (local: UserHistory, incoming: UserHistory): UserHistory => ({
  addedAt: pickEarliestHistoryDate(local.addedAt, incoming.addedAt),
  startedAt: pickEarliestHistoryDate(local.startedAt, incoming.startedAt),
  completedAt: pickEarliestHistoryDate(local.completedAt, incoming.completedAt),
  updatedAt: pickLatestHistoryDate(local.updatedAt, incoming.updatedAt),
});

export interface ArchiveMergePlan {
  /** Distinct titles in the incoming data. */
  incoming: number;
  /** Incoming titles that are not in the current archive yet. */
  added: number;
  /** Incoming titles that replace the current record with the same AniList ID. */
  updated: number;
  /** Current titles that are absent from the incoming data and stay untouched. */
  kept: number;
  /** Archive size after the merge. */
  total: number;
}

const uniqueIncomingIds = (incoming: Anime[]) => new Set(incoming.map((anime) => String(anime.id)));

export const planArchiveMerge = (currentIds: Iterable<string>, incoming: Anime[]): ArchiveMergePlan => {
  const current = new Set(currentIds);
  const incomingIds = uniqueIncomingIds(incoming);
  let updated = 0;
  incomingIds.forEach((id) => {
    if (current.has(id)) updated += 1;
  });
  const added = incomingIds.size - updated;
  return {
    incoming: incomingIds.size,
    added,
    updated,
    kept: current.size - updated,
    total: current.size + added,
  };
};

/**
 * Merges imported archive records into the current archive by AniList ID.
 *
 * - Current entries that are absent from the import are always preserved.
 * - An imported record replaces the current record's catalogue snapshot, status and note (the
 *   documented restore semantics). Its reaction replaces the current one only when it is known: an
 *   import without a reaction (for example an older backup) never erases a reaction given locally.
 * - History is merged field by field with `mergeUserHistory`, so known dates are never lost.
 * - Duplicate IDs inside `incoming` collapse into a single record (later ones win, history merged). JSON
 *   backups are already de-duplicated before this point, keeping the first copy (`normalizeEntries`).
 * - The input map is never mutated, so callers can apply the result atomically.
 */
export const mergeArchiveEntries = (current: Map<string, Anime>, incoming: Anime[]): Map<string, Anime> => {
  const next = new Map(current);
  incoming.forEach((anime) => {
    const entry = normalizeArchiveEntry(anime);
    const id = String(entry.id);
    const existing = next.get(id);
    if (!existing) {
      next.set(id, entry);
      return;
    }
    const userReaction = entry.userReaction ?? normalizeReaction(existing.userReaction);
    next.set(id, {
      ...entry,
      ...(userReaction ? { userReaction } : {}),
      userHistory: mergeUserHistory(historyOf(existing), historyOf(entry)),
    });
  });
  return next;
};
