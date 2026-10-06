import { createContext, useContext } from 'react';
import type { Locale } from './locales';
import type { Translator } from './translate';

export interface I18nContextValue extends Translator {
  /** Applies a language immediately and remembers it as the user's explicit choice. */
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
};
