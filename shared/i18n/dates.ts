import { getHistoryPrecision, HistoryDate } from '../schemas/history';
import type { Locale } from './locales';

/**
 * Formats a stored history date for display. Storage stays locale-independent ISO 8601; only the
 * rendering is localized, and only to the precision the value actually has:
 * - instant → the local calendar day (e.g. "Oct 5, 2026" / "2026/10/05" / "2026年10月5日")
 * - day     → that calendar day, never shifted by time zone
 * - month   → "June 2019" / "2019年6月"
 * - year    → "2019" / "2019年"
 */
export const formatHistoryDate = (value: HistoryDate, locale: Locale, timeZone?: string): string => {
  const precision = getHistoryPrecision(value);
  if (precision === 'instant') {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(value));
  }
  const [year, month = 1, day = 1] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const options: Intl.DateTimeFormatOptions =
    precision === 'day'
      ? { dateStyle: 'medium', timeZone: 'UTC' }
      : precision === 'month'
        ? { year: 'numeric', month: 'long', timeZone: 'UTC' }
        : { year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale, options).format(utc);
};
