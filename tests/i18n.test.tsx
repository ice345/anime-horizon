import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDisplayTitles } from '../shared/i18n/animeTitle';
import { en } from '../shared/i18n/messages/en';
import { ja } from '../shared/i18n/messages/ja';
import { zhCN } from '../shared/i18n/messages/zh-CN';
import { I18nProvider } from '../shared/i18n/I18nProvider';
import { useI18n } from '../shared/i18n/useI18n';
import {
  detectInitialLocale,
  LOCALE_STORAGE_KEY,
  matchBrowserLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from '../shared/i18n/locales';
import { createTranslator, MESSAGES, PluralMessage } from '../shared/i18n/translate';
import { buildTasteAnalysisPrompt } from '../services/geminiService';
import { Anime } from '../types';

const setBrowserLanguages = (languages: string[]) => {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: languages[0] ?? '', configurable: true });
};

describe('locale resolution', () => {
  it.each([
    [['ja-JP'], 'ja'],
    [['ja'], 'ja'],
    [['zh-CN'], 'zh-CN'],
    [['zh'], 'zh-CN'],
    [['zh-Hans-SG'], 'zh-CN'],
    [['en-GB'], 'en'],
    [['fr-FR'], 'en'],
    [[], 'en'],
    // Traditional Chinese is not offered yet, so resolution moves on to the next preference.
    [['zh-TW', 'ja'], 'ja'],
    [['zh-Hant-HK'], 'en'],
    [['fr-FR', 'zh-CN', 'ja'], 'zh-CN'],
  ])('browser %j resolves to %s', (languages, expected) => {
    expect(resolveLocale(null, languages)).toBe(expected);
  });

  it('lets an explicit stored choice override the browser language', () => {
    expect(resolveLocale('ja', ['zh-CN'])).toBe('ja');
    expect(resolveLocale('en', ['ja-JP'])).toBe('en');
  });

  it('ignores invalid stored values', () => {
    expect(resolveLocale('de', ['ja'])).toBe('ja');
    expect(resolveLocale(undefined, ['zh-CN'])).toBe('zh-CN');
  });

  it('does not treat unrelated tags as Chinese or Japanese', () => {
    expect(matchBrowserLocale('jv')).toBeNull();
    expect(matchBrowserLocale('zu')).toBeNull();
  });
});

const LocaleProbe: React.FC = () => {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="title">{t('myAnime.title')}</p>
      {SUPPORTED_LOCALES.map((option) => (
        <button key={option} type="button" onClick={() => setLocale(option)}>
          {option}
        </button>
      ))}
    </div>
  );
};

describe('I18nProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    setBrowserLanguages(['zh-CN']);
  });
  afterEach(() => localStorage.clear());

  it('uses the browser language for a first visit without persisting it', () => {
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('zh-CN');
    expect(screen.getByTestId('title')).toHaveTextContent('我的番剧');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('switches at runtime, updates <html lang>, and persists the explicit choice across remounts', () => {
    const first = render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>
    );
    expect(document.documentElement.lang).toBe('zh-CN');

    act(() => fireEvent.click(screen.getByRole('button', { name: 'ja' })));
    expect(screen.getByTestId('title')).toHaveTextContent('マイアニメ');
    expect(document.documentElement.lang).toBe('ja');
    expect(document.title).toContain('アニメ年鑑');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
    first.unmount();

    // The browser still prefers Chinese, but the explicit choice wins after a reload.
    expect(detectInitialLocale()).toBe('ja');
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>
    );
    expect(screen.getByTestId('locale')).toHaveTextContent('ja');

    act(() => fireEvent.click(screen.getByRole('button', { name: 'en' })));
    expect(screen.getByTestId('title')).toHaveTextContent('My Anime');
    expect(document.documentElement.lang).toBe('en');
  });
});

type MessageTree = { [key: string]: string | PluralMessage | MessageTree };

const isPlural = (value: unknown): value is PluralMessage =>
  typeof value === 'object' && value !== null && 'other' in value;

const flatten = (tree: MessageTree, prefix = ''): Map<string, string | PluralMessage> => {
  const entries = new Map<string, string | PluralMessage>();
  Object.entries(tree).forEach(([key, value]) => {
    const path = `${prefix}${key}`;
    if (typeof value === 'string' || isPlural(value)) entries.set(path, value);
    else flatten(value, `${path}.`).forEach((nested, nestedKey) => entries.set(nestedKey, nested));
  });
  return entries;
};

const placeholders = (value: string | PluralMessage) => {
  const texts = typeof value === 'string' ? [value] : Object.values(value).filter(Boolean);
  return new Set(texts.flatMap((text) => Array.from(String(text).matchAll(/\{(\w+)\}/g), (match) => match[1])));
};

describe('translation completeness', () => {
  const flattened = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, flatten(MESSAGES[locale] as unknown as MessageTree)])
  );
  const englishKeys = Array.from(flattened.en.keys()).sort();

  it.each(SUPPORTED_LOCALES)('%s exposes exactly the English key set', (locale) => {
    expect(Array.from(flattened[locale].keys()).sort()).toEqual(englishKeys);
  });

  it.each(SUPPORTED_LOCALES)('%s has no empty messages', (locale) => {
    flattened[locale].forEach((value, key) => {
      const texts = typeof value === 'string' ? [value] : Object.values(value);
      texts.forEach((text) => expect(String(text).trim(), `${locale}:${key}`).not.toBe(''));
    });
  });

  it.each(['ja', 'zh-CN'] as const)('%s uses the same interpolation params as English', (locale) => {
    englishKeys.forEach((key) => {
      const english = placeholders(flattened.en.get(key)!);
      const translated = placeholders(flattened[locale].get(key)!);
      // A plural message may omit {count} in languages without plural forms only if English does too.
      expect(Array.from(translated).sort(), `${locale}:${key}`).toEqual(Array.from(english).sort());
    });
  });

  it('keeps plural messages structurally plural in every locale', () => {
    englishKeys.forEach((key) => {
      const englishIsPlural = isPlural(flattened.en.get(key));
      SUPPORTED_LOCALES.forEach((locale) => {
        expect(isPlural(flattened[locale].get(key)), `${locale}:${key}`).toBe(englishIsPlural);
      });
    });
  });
});

describe('translator formatting', () => {
  it('selects English plural forms and formats counts with grouping', () => {
    const { t } = createTranslator('en');
    expect(t('guide.count', { count: 1 })).toBe('1 title');
    expect(t('guide.count', { count: 1200 })).toBe('1,200 titles');
  });

  it('never groups year params', () => {
    expect(createTranslator('en').t('journey.yearOnly', { year: 2026 })).toBe('Sometime in 2026');
    expect(createTranslator('ja').t('journey.yearOnly', { year: 2026 })).toBe('2026年のどこかで');
  });

  it('formats AniList scores as locale-aware percentages', () => {
    expect(createTranslator('en').formatScore(87)).toBe('87%');
    expect(createTranslator('ja').formatScore(87)).toBe('87%');
  });

  it('falls back to the key itself instead of crashing on an unknown key', () => {
    const { t } = createTranslator('ja');
    expect(t('missing.key' as never)).toBe('missing.key');
  });
});

describe('anime title display policy', () => {
  const titled = (title: Partial<Anime['title']>): Pick<Anime, 'title'> => ({
    title: { native: '', romaji: '', english: '', ...title },
  });
  const full = titled({ native: '響け！ユーフォニアム', romaji: 'Hibike! Euphonium', english: 'Sound! Euphonium' });

  it('shows the Japanese title first in Japanese and Chinese, with romaji as subtitle', () => {
    expect(getDisplayTitles(full, 'ja')).toEqual({ primary: '響け！ユーフォニアム', secondary: 'Hibike! Euphonium' });
    expect(getDisplayTitles(full, 'zh-CN')).toEqual({
      primary: '響け！ユーフォニアム',
      secondary: 'Hibike! Euphonium',
    });
  });

  it('shows the English title first in English, with the Japanese title as subtitle', () => {
    expect(getDisplayTitles(full, 'en')).toEqual({ primary: 'Sound! Euphonium', secondary: '響け！ユーフォニアム' });
  });

  it('falls back to romaji when AniList has no English title', () => {
    expect(getDisplayTitles(titled({ native: 'ぼっち・ざ・ろっく！', romaji: 'Bocchi the Rock!' }), 'en')).toEqual({
      primary: 'Bocchi the Rock!',
      secondary: 'ぼっち・ざ・ろっく！',
    });
  });

  it('never invents a title and omits a duplicate subtitle', () => {
    expect(getDisplayTitles(titled({ romaji: 'Same', english: 'Same' }), 'en')).toEqual({ primary: 'Same' });
    expect(getDisplayTitles(titled({}), 'zh-CN')).toEqual({ primary: '' });
  });
});

describe('AI output language', () => {
  const anime: Anime = {
    id: '1',
    title: { native: '作品', romaji: 'Work', english: 'Work' },
    coverImage: { extraLarge: '', large: '', color: '' },
    season: 'SPRING',
    seasonYear: 2020,
    genres: ['Drama'],
    userStatus: 'COMPLETED',
    userReaction: 'LIKE',
  };

  it.each([
    ['en', '自然的英语'],
    ['ja', '自然的日语'],
    ['zh-CN', '简体中文'],
  ] as const)('asks for %s prose while keeping the JSON contract stable', (locale, language) => {
    const prompt = buildTasteAnalysisPrompt([anime], locale);

    expect(prompt).toContain(`都必须使用${language}撰写`);
    expect(prompt).toContain('JSON 字段名必须保持下方结构中的英文原样');
    ['"tags"', '"analysis"', '"personality"', '"goldenEra"', '"questions"'].forEach((field) =>
      expect(prompt).toContain(field)
    );
  });
});

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });

describe('hard-coded UI text guard', () => {
  const root = join(__dirname, '..');
  // Files whose Chinese text is data rather than UI (none at the moment).
  const allowedFiles = new Set<string>();
  // Matching patterns that are not shown to users.
  const allowedFragments = ['第[一二三四五六七八九十'];

  it('keeps Chinese UI text out of components', () => {
    const files = [join(root, 'App.tsx'), ...listSourceFiles(join(root, 'components'))];
    const offenders = files.flatMap((file) => {
      const path = relative(root, file);
      if (allowedFiles.has(path)) return [];
      return readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.replace(/\/\/.*$|\/\*.*?\*\/|^\s*\*.*$/g, ''), index }))
        .filter(({ line }) => /[一-鿿]/.test(line))
        .filter(({ line }) => !allowedFragments.some((fragment) => line.includes(fragment)))
        .map(({ line, index }) => `${path}:${index + 1}: ${line.trim()}`);
    });

    expect(offenders).toEqual([]);
  });
});

describe('retired taste verdicts', () => {
  const RETIRED = ['二次元浓度', '萌豚', '婆罗门', '老二次元', '现充', '动漫之神', '成分'];

  it.each([
    ['en', en],
    ['ja', ja],
    ['zh-CN', zhCN],
  ] as const)('are absent from %s messages', (_locale, messages) => {
    const text = JSON.stringify(messages);
    for (const label of RETIRED) expect(text).not.toContain(label);
  });

  it('are absent from app source outside the game data', () => {
    const root = join(__dirname, '..');
    const files = [
      join(root, 'App.tsx'),
      join(root, 'types.ts'),
      ...listSourceFiles(join(root, 'components')),
      ...listSourceFiles(join(root, 'services')),
      ...listSourceFiles(join(root, 'features')),
      ...listSourceFiles(join(root, 'shared')),
    ];
    const offenders = files.flatMap((file) =>
      RETIRED.filter((label) => readFileSync(file, 'utf8').includes(label)).map(
        (label) => `${relative(root, file)}: ${label}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
