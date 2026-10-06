import { normalizeReaction, readLegacyReaction } from '../features/archive/archiveOperations';
import { normalizeAnimeRecord } from '../shared/schemas/anime';
import { Anime, Season, UserAnimeStatus } from '../types';

const TABLE_NAME = 'anime_archive';
export const MAX_SQL_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_SQL_ROWS = 2_000;
export const MAX_SQL_FIELDS = 13;
const MAX_SQL_FIELD_CHARS = 20_000;
const INSERT_COLUMNS = [
  'anilist_id',
  'title_native',
  'title_romaji',
  'season_year',
  'season',
  'format',
  'average_score',
  'cover_image',
  'genres',
  'description',
  'user_status',
  'user_reaction',
  'user_note',
].join(',');

export type ArchiveSqlErrorCode =
  | 'tooLarge'
  | 'notArchive'
  | 'noInsert'
  | 'columnMismatch'
  | 'fieldTooLong'
  | 'invalidNumber'
  | 'fieldCount'
  | 'tooManyRows'
  | 'incomplete'
  | 'empty';

/** Parse failure with a stable code; the UI translates `sqlImport.error.<code>` with `count`. */
export class ArchiveSqlError extends Error {
  readonly code: ArchiveSqlErrorCode;
  readonly count?: number;

  constructor(code: ArchiveSqlErrorCode, message: string, count?: number) {
    super(message);
    this.name = 'ArchiveSqlError';
    this.code = code;
    this.count = count;
  }
}

const normalizeStatus = (status: unknown): UserAnimeStatus =>
  status === 'WATCHING' || status === 'COMPLETED' ? status : 'PLAN';

/**
 * Export format marker. Format 2 writes NULL for "no reaction recorded" and NEUTRAL only for an explicit
 * choice. Dumps without the marker come from older versions, where every unrated title was exported as
 * NEUTRAL, so their NEUTRAL is imported as "no reaction".
 */
export const SQL_FORMAT_MARKER = '-- anime-horizon-sql-format: 2';

const escapeSql = (value: string | undefined | null) => {
  if (!value) return 'NULL';
  return `'${value.replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
};

export const generateArchiveSql = (selectedAnime: Anime[]) => {
  const createTable = `
${SQL_FORMAT_MARKER}
-- user_reaction: NULL = no reaction recorded; NEUTRAL = "it was okay"
-- 1. Create Table Structure for MySQL 8+
CREATE TABLE IF NOT EXISTS \`${TABLE_NAME}\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`anilist_id\` INT NOT NULL,
  \`title_native\` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  \`title_romaji\` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  \`season_year\` INT,
  \`season\` VARCHAR(20),
  \`format\` VARCHAR(20),
  \`average_score\` INT,
  \`cover_image\` VARCHAR(255),
  \`genres\` JSON,
  \`description\` TEXT,
  \`user_status\` VARCHAR(20) NOT NULL DEFAULT 'PLAN',
  \`user_reaction\` VARCHAR(20) NULL DEFAULT NULL,
  \`user_note\` TEXT,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY \`unique_anime\` (\`anilist_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

  if (!selectedAnime.length) return createTable.trim();

  const values = selectedAnime
    .map((anime) => {
      const native = escapeSql(anime.title.native);
      const romaji = escapeSql(anime.title.romaji);
      const score = anime.averageScore || 'NULL';
      const season = escapeSql(anime.season);
      const format = escapeSql(anime.format);
      const cover = escapeSql(anime.coverImage.extraLarge || anime.coverImage.large);
      const description = escapeSql(anime.description || '');
      const userStatus = escapeSql(anime.userStatus || 'PLAN');
      const userReaction = escapeSql(normalizeReaction(anime.userReaction));
      const userNote = escapeSql(anime.userNote?.trim() || '');
      const genres = escapeSql(JSON.stringify(anime.genres || []));

      return `(${anime.id}, ${native}, ${romaji}, ${anime.seasonYear}, ${season}, ${format}, ${score}, ${cover}, ${genres}, ${description}, ${userStatus}, ${userReaction}, ${userNote})`;
    })
    .join(',\n  ');

  const insertData = `
-- 2. Insert Selected Data
INSERT IGNORE INTO \`${TABLE_NAME}\`
  (\`anilist_id\`, \`title_native\`, \`title_romaji\`, \`season_year\`, \`season\`, \`format\`, \`average_score\`, \`cover_image\`, \`genres\`, \`description\`, \`user_status\`, \`user_reaction\`, \`user_note\`)
VALUES
  ${values};
`;

  return (createTable + insertData).trim();
};

type SqlValue = string | number | null;

const parseSqlValues = (source: string): SqlValue[][] => {
  if (new TextEncoder().encode(source).byteLength > MAX_SQL_IMPORT_BYTES) {
    throw new ArchiveSqlError('tooLarge', 'SQL is larger than 5 MB');
  }

  const insertMatch = source.match(/INSERT\s+IGNORE\s+INTO\s+`anime_archive`\s*\(([^)]{1,2000})\)\s*VALUES\b/i);
  if (!insertMatch || insertMatch.index === undefined)
    throw new ArchiveSqlError('noInsert', 'No supported archive INSERT statement');
  const columns = insertMatch[1].replace(/`/g, '').replace(/\s+/g, '').toLowerCase();
  if (columns !== INSERT_COLUMNS)
    throw new ArchiveSqlError('columnMismatch', 'INSERT columns do not match the export format');

  const body = source.slice(insertMatch.index + insertMatch[0].length);
  const rows: SqlValue[][] = [];
  let row: SqlValue[] = [];
  let field = '';
  let inString = false;
  let inRow = false;

  const pushField = () => {
    const raw = field.trim();
    if (raw.length > MAX_SQL_FIELD_CHARS) throw new ArchiveSqlError('fieldTooLong', 'SQL field is too long');
    if (!raw || raw.toUpperCase() === 'NULL') row.push(null);
    else if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new ArchiveSqlError('invalidNumber', 'Invalid SQL number');
      row.push(number);
    } else row.push(raw);
    field = '';
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];

    if (!inRow) {
      if (char === '(') {
        inRow = true;
        row = [];
        field = '';
      } else if (char === ';') {
        break;
      }
      continue;
    }

    if (inString) {
      if (char === "'" && next === "'") {
        field += "'";
        index += 1;
      } else if (char === '\\' && next === '\\') {
        field += '\\';
        index += 1;
      } else if (char === "'") {
        inString = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
    } else if (char === ',') {
      pushField();
    } else if (char === ')') {
      pushField();
      if (row.length !== MAX_SQL_FIELDS)
        throw new ArchiveSqlError('fieldCount', `SQL rows must have ${MAX_SQL_FIELDS} fields`, MAX_SQL_FIELDS);
      rows.push(row);
      if (rows.length > MAX_SQL_ROWS)
        throw new ArchiveSqlError('tooManyRows', `SQL cannot exceed ${MAX_SQL_ROWS} rows`, MAX_SQL_ROWS);
      inRow = false;
    } else if (char !== ';') {
      field += char;
    }
  }

  if (inString || inRow) throw new ArchiveSqlError('incomplete', 'SQL content is incomplete');
  return rows;
};

const toSeason = (value: SqlValue): Season =>
  value === 'WINTER' || value === 'SPRING' || value === 'SUMMER' || value === 'FALL' ? value : 'WINTER';

const parseGenres = (value: SqlValue) => {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((genre): genre is string => typeof genre === 'string') : [];
  } catch {
    return [];
  }
};

export const parseArchiveSql = (source: string): Anime[] => {
  if (!source.includes(`\`${TABLE_NAME}\``))
    throw new ArchiveSqlError('notArchive', 'Not an Anime Horizon archive SQL export');

  const seenIds = new Set<string>();
  const readReaction = source.includes(SQL_FORMAT_MARKER) ? normalizeReaction : readLegacyReaction;
  const anime = parseSqlValues(source).flatMap((row) => {
    const [
      id,
      native,
      romaji,
      seasonYear,
      season,
      format,
      averageScore,
      coverImage,
      genres,
      description,
      userStatus,
      userReaction,
      userNote,
    ] = row;
    const numericYear = typeof seasonYear === 'number' ? seasonYear : Number(seasonYear);
    const titleNative = typeof native === 'string' ? native : '';
    const titleRomaji = typeof romaji === 'string' ? romaji : '';
    const animeId = String(id ?? '');

    if (
      !/^\d{1,32}$/.test(animeId) ||
      !Number.isFinite(numericYear) ||
      numericYear < 1900 ||
      numericYear > 2200 ||
      (!titleNative && !titleRomaji) ||
      seenIds.has(animeId)
    )
      return [];

    const image = typeof coverImage === 'string' ? coverImage : '';
    try {
      const normalized = normalizeAnimeRecord({
        id: animeId,
        title: { native: titleNative, romaji: titleRomaji, english: '' },
        coverImage: { extraLarge: image, large: image, color: '' },
        season: toSeason(season),
        seasonYear: numericYear,
        genres: parseGenres(genres),
        averageScore: typeof averageScore === 'number' ? averageScore : undefined,
        format: typeof format === 'string' ? format : undefined,
        description: typeof description === 'string' ? description : undefined,
        userStatus: normalizeStatus(userStatus),
        userReaction: readReaction(userReaction),
        userNote: typeof userNote === 'string' ? userNote.slice(0, 280) : undefined,
      });
      seenIds.add(animeId);
      return [normalized];
    } catch {
      return [];
    }
  });

  if (!anime.length) throw new ArchiveSqlError('empty', 'No importable titles found');
  return anime;
};
