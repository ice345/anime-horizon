import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { detectInitialLocale, Locale, writeStoredLocale } from './locales';
import { createTranslator } from './translate';
import { I18nContext, I18nContextValue } from './useI18n';

interface I18nProviderProps {
  children: React.ReactNode;
  /** Overrides detection; used by tests. */
  initialLocale?: Locale;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ children, initialLocale }) => {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({ ...createTranslator(locale), setLocale }), [locale, setLocale]);

  // Layout effect so assistive technology and font selection see the right language before paint.
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = value.t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', value.t('meta.description'));
  }, [locale, value]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};
