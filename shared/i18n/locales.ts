export const SUPPORTED_LOCALES = ['en', 'ja', 'zh-CN'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** The language used when nothing else matches, and the source of truth for message keys. */
export const FALLBACK_LOCALE: Locale = 'en';

/** Explicit user choice only. Browser-derived locales are never written here. */
export const LOCALE_STORAGE_KEY = 'anime-horizon-locale';

/** Each language is shown in its own script so people can find it regardless of the current UI language. */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
};

export const isSupportedLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);

/**
 * Maps one BCP 47 browser tag to a supported locale.
 * - `ja`, `ja-JP` → `ja`
 * - `zh`, `zh-CN`, `zh-SG`, `zh-Hans*` → `zh-CN` (Simplified Chinese)
 * - Traditional Chinese (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant*`) is not matched, because it is not
 *   offered yet; resolution continues with the next browser language.
 * - `en*` → `en`
 */
export const matchBrowserLocale = (tag: string): Locale | null => {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return null;
  const [language, ...rest] = normalized.split('-');
  if (language === 'ja') return 'ja';
  if (language === 'en') return 'en';
  if (language === 'zh') {
    if (rest.includes('hant') || rest.some((part) => ['tw', 'hk', 'mo'].includes(part))) return null;
    return 'zh-CN';
  }
  return null;
};

/**
 * Resolution order: an explicit stored choice, then the first supported browser language
 * (in the browser's preference order), then English.
 */
export const resolveLocale = (stored: unknown, browserLanguages: readonly string[]): Locale => {
  if (isSupportedLocale(stored)) return stored;
  for (const tag of browserLanguages) {
    const match = matchBrowserLocale(tag);
    if (match) return match;
  }
  return FALLBACK_LOCALE;
};

export const readStoredLocale = (): Locale | null => {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
};

export const writeStoredLocale = (locale: Locale) => {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private browsing may reject writes; the in-memory choice still applies for this session.
  }
};

export const readBrowserLanguages = (): readonly string[] => {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
};

export const detectInitialLocale = (): Locale => resolveLocale(readStoredLocale(), readBrowserLanguages());
