import { en } from './messages/en';
import { ja } from './messages/ja';
import { zhCN } from './messages/zh-CN';
import { FALLBACK_LOCALE, Locale } from './locales';

/** A message that varies by count. Keys follow Intl.PluralRules categories; `other` is required. */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

type Widen<T> = T extends string
  ? string
  : T extends { other: string }
    ? PluralMessage
    : { [K in keyof T]: Widen<T[K]> };

/** Every locale must provide exactly the shape of the English source messages. */
export type Messages = Widen<typeof en>;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | PluralMessage ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
export type MessageParams = Record<string, string | number>;

export const MESSAGES: Record<Locale, Messages> = { en, ja, 'zh-CN': zhCN };

const isPluralMessage = (value: unknown): value is PluralMessage =>
  typeof value === 'object' && value !== null && 'other' in value;

const lookup = (messages: Messages, key: string): string | PluralMessage | undefined => {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || isPluralMessage(node) ? node : undefined;
};

const reportedMissing = new Set<string>();
const reportMissing = (locale: Locale, key: string) => {
  const id = `${locale}:${key}`;
  if (reportedMissing.has(id) || !import.meta.env?.DEV) return;
  reportedMissing.add(id);
  // eslint-disable-next-line no-console -- development-only diagnostic for missing translations
  console.warn(`[i18n] Missing message "${key}" for ${locale}`);
};

export interface Translator {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** AniList scores are 0–100. */
  formatScore: (score: number) => string;
}

export const createTranslator = (locale: Locale): Translator => {
  const numberFormat = new Intl.NumberFormat(locale);
  const percentFormat = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const pluralRules = new Intl.PluralRules(locale);

  const interpolate = (template: string, params: MessageParams = {}) =>
    template.replace(/\{(\w+)\}/g, (match, name: string) => {
      if (!(name in params)) return match;
      const value = params[name];
      if (typeof value !== 'number') return value;
      // Years are labels, not quantities: never group them ("2026", not "2,026").
      return /year/i.test(name) ? String(value) : numberFormat.format(value);
    });

  const t = (key: MessageKey, params?: MessageParams) => {
    let message = lookup(MESSAGES[locale], key);
    if (message === undefined) {
      reportMissing(locale, key);
      message = lookup(MESSAGES[FALLBACK_LOCALE], key);
    }
    if (message === undefined) return key;
    if (isPluralMessage(message)) {
      const count = typeof params?.count === 'number' ? params.count : 0;
      const category = pluralRules.select(count) as keyof PluralMessage;
      return interpolate(message[category] ?? message.other, params);
    }
    return interpolate(message, params);
  };

  return {
    locale,
    t,
    formatNumber: (value, options) =>
      options ? new Intl.NumberFormat(locale, options).format(value) : numberFormat.format(value),
    formatScore: (score) => percentFormat.format(score / 100),
  };
};
