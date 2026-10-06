import { Anime } from '../../types';
import { normalizeAnimeRecord } from '../schemas/anime';
import { normalizeArchiveEntry, readLegacyReaction } from '../../features/archive/archiveOperations';

export const ARCHIVE_STORAGE_KEYS = {
  selectedIds: 'anime-horizon-selected-v3',
  details: 'anime-horizon-details-v3',
  /** Schema version of the records under `details`. Missing means 3 (before user history). */
  schemaVersion: 'anime-horizon-archive-schema',
} as const;

/**
 * Archive record schema versions.
 * - 3: Phase A records (status, reaction, note); no history field. Stored without a version marker.
 * - 4: every record carries `userHistory` (addedAt / startedAt / completedAt / updatedAt).
 * - 5: a missing `userReaction` means "no reaction recorded"; NEUTRAL is only stored when the user
 *   explicitly chose it. Before 5, NEUTRAL was also the default for unrated titles.
 * The storage keys themselves are unchanged so older data keeps loading in place.
 */
export const LEGACY_ARCHIVE_SCHEMA_VERSION = 3;
export const ARCHIVE_SCHEMA_VERSION = 5;
/** First schema in which a stored NEUTRAL is known to be an explicit choice. */
const EXPLICIT_NEUTRAL_SCHEMA_VERSION = 5;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ArchiveStorageState {
  selectedIds: Set<string>;
  selectedAnimeDetails: Map<string, Anime>;
  recovered: boolean;
  /** The schema version that was read; records are always returned migrated to ARCHIVE_SCHEMA_VERSION. */
  schemaVersion: number;
}

export class StoragePersistenceError extends Error {
  constructor(message = 'Unable to save the local archive') {
    super(message);
    this.name = 'StoragePersistenceError';
  }
}

const getStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const parseIds = (raw: string | null) => {
  if (!raw) return new Set<string>();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Archive ID data is not an array');
  return new Set(
    value
      .slice(0, 2_000)
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map(String)
      .filter((id) => /^\d{1,32}$/.test(id))
  );
};

const readSchemaVersion = (raw: string | null) => {
  const version = Number(raw);
  return Number.isInteger(version) && version > 0 ? version : LEGACY_ARCHIVE_SCHEMA_VERSION;
};

/**
 * Migrates one stored record to the current schema. Deterministic and idempotent: running it on its
 * own output returns an equal record.
 * - v3 → v4: adds `userHistory` with every field unknown (null). No date is fabricated: the time of
 *   the migration says nothing about when the user added, started or finished a title.
 * - v4: re-validates history field by field; a malformed date becomes unknown without dropping the record.
 * - v3/v4 → v5: a stored NEUTRAL becomes "no reaction", because before v5 it was also the default for
 *   titles the user never rated (and was shown as "no rating yet"). Other reactions are kept.
 * - Missing or invalid status → PLAN (never inferred from AniList metadata).
 */
export const migrateArchiveRecord = (entry: unknown, fromVersion: number = ARCHIVE_SCHEMA_VERSION): Anime => {
  const record = normalizeAnimeRecord(entry);
  if (fromVersion < EXPLICIT_NEUTRAL_SCHEMA_VERSION) {
    const userReaction = readLegacyReaction(record.userReaction);
    if (userReaction) record.userReaction = userReaction;
    else delete record.userReaction;
  }
  return normalizeArchiveEntry(record);
};

const parseDetails = (raw: string | null, schemaVersion: number) => {
  if (!raw) return new Map<string, Anime>();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Archive detail data is not an array');

  const details = new Map<string, Anime>();
  for (const entry of value.slice(0, 2_000)) {
    try {
      const anime = migrateArchiveRecord(entry, schemaVersion);
      details.set(anime.id, anime);
    } catch {
      // Ignore one damaged entry and keep the rest of the local archive usable.
    }
  }
  return details;
};

export const loadArchiveState = (storage: StorageLike | null = getStorage()): ArchiveStorageState => {
  if (!storage)
    return {
      selectedIds: new Set(),
      selectedAnimeDetails: new Map(),
      recovered: false,
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
    };
  let schemaVersion = LEGACY_ARCHIVE_SCHEMA_VERSION;
  try {
    schemaVersion = readSchemaVersion(storage.getItem(ARCHIVE_STORAGE_KEYS.schemaVersion));
  } catch {
    // Unreadable marker: treat the data as legacy; migration only fills unknown history.
  }
  let selectedIds = new Set<string>();
  let selectedAnimeDetails = new Map<string, Anime>();
  let recovered = false;
  try {
    selectedIds = parseIds(storage.getItem(ARCHIVE_STORAGE_KEYS.selectedIds));
  } catch {
    recovered = true;
  }
  try {
    selectedAnimeDetails = parseDetails(storage.getItem(ARCHIVE_STORAGE_KEYS.details), schemaVersion);
  } catch {
    recovered = true;
  }
  if (selectedAnimeDetails.size > 0) {
    return {
      selectedIds: new Set(selectedAnimeDetails.keys()),
      selectedAnimeDetails,
      recovered: recovered || selectedAnimeDetails.size !== selectedIds.size,
      schemaVersion,
    };
  }
  return { selectedIds, selectedAnimeDetails, recovered, schemaVersion };
};

export const saveArchiveState = (
  state: Pick<ArchiveStorageState, 'selectedIds' | 'selectedAnimeDetails'>,
  storage: StorageLike | null = getStorage()
) => {
  if (!storage) return;
  try {
    storage.setItem(ARCHIVE_STORAGE_KEYS.selectedIds, JSON.stringify(Array.from(state.selectedIds)));
    storage.setItem(ARCHIVE_STORAGE_KEYS.details, JSON.stringify(Array.from(state.selectedAnimeDetails.values())));
    storage.setItem(ARCHIVE_STORAGE_KEYS.schemaVersion, String(ARCHIVE_SCHEMA_VERSION));
  } catch {
    throw new StoragePersistenceError();
  }
};

export const clearArchiveState = (storage: StorageLike | null = getStorage()) => {
  if (!storage) return;
  try {
    storage.removeItem(ARCHIVE_STORAGE_KEYS.selectedIds);
    storage.removeItem(ARCHIVE_STORAGE_KEYS.details);
    storage.removeItem(ARCHIVE_STORAGE_KEYS.schemaVersion);
  } catch {
    throw new StoragePersistenceError('Unable to clear the local archive');
  }
};

export const subscribeToArchiveStorage = (listener: (state: ArchiveStorageState) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (
      !Object.values(ARCHIVE_STORAGE_KEYS).includes(
        event.key as (typeof ARCHIVE_STORAGE_KEYS)[keyof typeof ARCHIVE_STORAGE_KEYS]
      )
    )
      return;
    listener(loadArchiveState());
  };
  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
};
