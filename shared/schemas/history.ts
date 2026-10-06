/**
 * User-history dates.
 *
 * Invariant: anime release time and user watch time are separate domains. Nothing in this module
 * reads AniList metadata; every value here comes from the user's own actions or input.
 *
 * A history date is a locale-independent ISO 8601 string whose shape is its precision:
 * - instant  "2026-10-05T09:30:12.345Z"  recorded automatically by the app (always UTC)
 * - day      "2019-06-15"                entered by the user
 * - month    "2019-06"                   entered by the user
 * - year     "2019"                      entered by the user ("I watched this in 2019")
 * `null` means unknown. Unknown is never replaced by a guessed or migration-time value.
 */
export type HistoryDate = string;
export type HistoryPrecision = 'instant' | 'day' | 'month' | 'year';

export interface UserHistory {
  /** When the title entered the archive. */
  addedAt: HistoryDate | null;
  /** When the user (first) started watching. */
  startedAt: HistoryDate | null;
  /** When the user (first) finished watching. */
  completedAt: HistoryDate | null;
  /** When any user-owned field of the record last changed. Always an instant. */
  updatedAt: HistoryDate | null;
}

export const HISTORY_FIELDS = ['addedAt', 'startedAt', 'completedAt', 'updatedAt'] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];

export const emptyUserHistory = (): UserHistory => ({
  addedAt: null,
  startedAt: null,
  completedAt: null,
  updatedAt: null,
});

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

const validYear = (year: number) => year >= MIN_YEAR && year <= MAX_YEAR;
const validMonth = (month: number) => month >= 1 && month <= 12;
const validDay = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const getHistoryPrecision = (value: HistoryDate): HistoryPrecision => {
  if (YEAR.test(value)) return 'year';
  if (MONTH.test(value)) return 'month';
  if (DAY.test(value)) return 'day';
  return 'instant';
};

/**
 * Returns the canonical form of a history date, or `null` when the value is missing or malformed.
 * Instants are normalized to UTC (`toISOString`); partial dates are kept exactly as written.
 */
export const normalizeHistoryDate = (value: unknown): HistoryDate | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let match = YEAR.exec(text);
  if (match) return validYear(Number(match[1])) ? text : null;
  match = MONTH.exec(text);
  if (match) return validYear(Number(match[1])) && validMonth(Number(match[2])) ? text : null;
  match = DAY.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return validYear(year) && validMonth(month) && validDay(year, month, day) ? text : null;
  }
  if (!INSTANT.test(text)) return null;
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  const instant = new Date(time);
  return validYear(instant.getUTCFullYear()) ? instant.toISOString() : null;
};

/** Normalizes stored or imported history. Each malformed field becomes unknown on its own. */
export const normalizeUserHistory = (value: unknown): UserHistory => {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const history = emptyUserHistory();
  HISTORY_FIELDS.forEach((field) => {
    history[field] = normalizeHistoryDate(source[field]);
  });
  // updatedAt describes a recorded moment, so a partial date is not meaningful there.
  if (history.updatedAt && getHistoryPrecision(history.updatedAt) !== 'instant') history.updatedAt = null;
  return history;
};

export const historyInstant = (now: Date): HistoryDate => now.toISOString();

/** The UTC time span a history date covers: [start, end) in milliseconds. */
export const historyDateRange = (value: HistoryDate): { start: number; end: number } => {
  const precision = getHistoryPrecision(value);
  if (precision === 'instant') {
    const time = Date.parse(value);
    return { start: time, end: time + 1 };
  }
  const [year, month = 1, day = 1] = value.split('-').map(Number);
  const start = Date.UTC(year, month - 1, day);
  const end =
    precision === 'year'
      ? Date.UTC(year + 1, 0, 1)
      : precision === 'month'
        ? Date.UTC(year, month, 1)
        : Date.UTC(year, month - 1, day + 1);
  return { start, end };
};

/** When one value's span contains the other's, the more precise value describes the same moment better. */
const preferContained = (left: HistoryDate, right: HistoryDate): HistoryDate | null => {
  const a = historyDateRange(left);
  const b = historyDateRange(right);
  if (a.start <= b.start && b.end <= a.end) return right;
  if (b.start <= a.start && a.end <= b.end) return left;
  return null;
};

/** Earliest of two known dates; unknown never wins over known. Deterministic for equal spans. */
export const pickEarliestHistoryDate = (left: HistoryDate | null, right: HistoryDate | null) => {
  if (!left || !right) return left ?? right;
  if (left === right) return left;
  const contained = preferContained(left, right);
  if (contained) return contained;
  const a = historyDateRange(left);
  const b = historyDateRange(right);
  if (a.start !== b.start) return a.start < b.start ? left : right;
  return left < right ? left : right;
};

/** Latest of two known dates; unknown never wins over known. */
export const pickLatestHistoryDate = (left: HistoryDate | null, right: HistoryDate | null) => {
  if (!left || !right) return left ?? right;
  if (left === right) return left;
  const contained = preferContained(left, right);
  if (contained) return contained;
  const a = historyDateRange(left);
  const b = historyDateRange(right);
  if (a.end !== b.end) return a.end > b.end ? left : right;
  return left > right ? left : right;
};

export type HistoryInputResult = { value: HistoryDate | null } | { error: 'invalid' | 'future' };

/**
 * Parses what a user typed into a date field. Accepts a year, year-month or full date written with
 * `-`, `/`, `.` or 年/月/日 separators, e.g. "2019", "2019/6", "2019-06-15", "2019年6月15日".
 * Empty input means unknown. Dates that start after `now` are rejected.
 */
export const parseHistoryDateInput = (input: string, now: Date): HistoryInputResult => {
  const text = input.trim();
  if (!text) return { value: null };
  const parts = text
    .replace(/日$/, '')
    .split(/[-/.年月]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return { error: 'invalid' };
  if (parts[0].length !== 4 || parts.slice(1).some((part) => part.length > 2)) return { error: 'invalid' };
  const candidate = [parts[0], ...parts.slice(1).map((part) => part.padStart(2, '0'))].join('-');
  const value = normalizeHistoryDate(candidate);
  if (!value) return { error: 'invalid' };
  if (historyDateRange(value).start > now.getTime()) return { error: 'future' };
  return { value };
};

/** The text shown in a date field for an existing value. Instants show their local calendar day. */
export const toEditableHistoryDate = (value: HistoryDate | null): string => {
  if (!value) return '';
  if (getHistoryPrecision(value) !== 'instant') return value;
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
