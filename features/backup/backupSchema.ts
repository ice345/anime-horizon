import { z } from 'zod';
import { Anime } from '../../types';
import { normalizeAnimeRecord } from '../../shared/schemas/anime';
import { normalizeArchiveEntry, readLegacyReaction } from '../archive/archiveOperations';

/**
 * Backup versions:
 * - 1/2: archive records without `userHistory` (imported with every history date unknown).
 * - 3: archive records carry `userHistory`.
 * - 4: a missing `userReaction` means "no reaction recorded"; NEUTRAL is an explicit choice. In 1–3,
 *   NEUTRAL was also written for unrated titles, so it is imported as "no reaction".
 */
export const CURRENT_BACKUP_VERSION = 4;
const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2, 3, CURRENT_BACKUP_VERSION]);
const EXPLICIT_NEUTRAL_BACKUP_VERSION = 4;
export const MAX_BACKUP_ENTRIES = 2_000;
export const MAX_BACKUP_VIEW_ENTRIES = 500;

const idSchema = z
  .union([z.string().trim().min(1).max(32), z.number().int().positive().max(2_000_000_000)])
  .transform(String)
  .refine((id) => /^\d{1,32}$/.test(id), 'Anime IDs must be numeric');

const backupConfigSchema = z
  .object({
    itemsPerSeason: z.coerce.number().int().min(10).max(50).optional(),
    startYear: z.coerce.number().int().min(1900).max(2200).optional(),
    endYear: z.coerce.number().int().min(1900).max(2200).optional(),
  })
  .passthrough()
  .default({});

const rawBackupSchema = z
  .object({
    version: z.coerce.number().int().positive().optional().default(1),
    timestamp: z.string().max(80).optional(),
    config: backupConfigSchema,
    userSelection: z.array(idSchema).max(MAX_BACKUP_ENTRIES).default([]),
    userDetails: z.array(z.unknown()).max(MAX_BACKUP_ENTRIES).default([]),
    currentViewData: z.array(z.unknown()).max(MAX_BACKUP_VIEW_ENTRIES).default([]),
  })
  .passthrough();

export interface NormalizedBackup {
  version: typeof CURRENT_BACKUP_VERSION;
  timestamp: string;
  config: {
    itemsPerSeason?: number;
    startYear?: number;
    endYear?: number;
  };
  userSelection: string[];
  userDetails: Anime[];
  currentViewData: Anime[];
}

const normalizeEntries = (entries: unknown[], max: number, isArchive = false, version = CURRENT_BACKUP_VERSION) => {
  const seen = new Set<string>();
  const normalized: Anime[] = [];
  for (const entry of entries.slice(0, max)) {
    // Archive records always come out with a normalized history (unknown dates stay null);
    // catalogue cache records never carry user data.
    const record = normalizeAnimeRecord(entry);
    if (isArchive && version < EXPLICIT_NEUTRAL_BACKUP_VERSION) {
      const userReaction = readLegacyReaction(record.userReaction);
      if (userReaction) record.userReaction = userReaction;
      else delete record.userReaction;
    }
    const anime = isArchive ? normalizeArchiveEntry(record) : record;
    if (!isArchive) {
      delete anime.userHistory;
      delete anime.userReaction;
    }
    if (seen.has(anime.id)) continue;
    seen.add(anime.id);
    normalized.push(anime);
  }
  return normalized;
};

export type BackupErrorCode = 'tooLarge' | 'readFailed' | 'unsupportedVersion' | 'invalid';

/** Restore failure with a stable code; the UI translates `backupError.<code>`. */
export class BackupError extends Error {
  readonly code: BackupErrorCode;
  readonly version?: number;

  constructor(code: BackupErrorCode, message: string, version?: number) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    this.version = version;
  }
}

export const parseAndMigrateBackup = (value: unknown): NormalizedBackup => {
  const parsed = rawBackupSchema.safeParse(value);
  if (!parsed.success) throw new BackupError('invalid', 'Backup does not match the expected format');
  const raw = parsed.data;
  if (!SUPPORTED_BACKUP_VERSIONS.has(raw.version)) {
    throw new BackupError('unsupportedVersion', `Unsupported backup version: ${raw.version}`, raw.version);
  }

  let userDetails: Anime[];
  let currentViewData: Anime[];
  try {
    userDetails = normalizeEntries(raw.userDetails, MAX_BACKUP_ENTRIES, true, raw.version);
    currentViewData = normalizeEntries(raw.currentViewData, MAX_BACKUP_VIEW_ENTRIES);
  } catch {
    throw new BackupError('invalid', 'Backup contains an invalid anime record');
  }
  const detailIds = userDetails.map((anime) => anime.id);
  const userSelection = Array.from(new Set([...raw.userSelection, ...detailIds]));

  return {
    version: CURRENT_BACKUP_VERSION,
    timestamp: raw.timestamp || new Date().toISOString(),
    config: {
      itemsPerSeason: raw.config.itemsPerSeason,
      startYear: raw.config.startYear,
      endYear: raw.config.endYear,
    },
    userSelection,
    userDetails,
    currentViewData,
  };
};

export const createBackup = (input: Omit<NormalizedBackup, 'version' | 'timestamp'>): NormalizedBackup => ({
  ...input,
  version: CURRENT_BACKUP_VERSION,
  timestamp: new Date().toISOString(),
});
