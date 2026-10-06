import { Anime } from '../../types';
import { Locale } from './locales';

export interface DisplayTitles {
  /** The title shown as the heading. Empty only when AniList supplied no title at all. */
  primary: string;
  /** A different title shown as a subtitle, when one exists. */
  secondary?: string;
}

type TitleField = keyof Anime['title'];

/**
 * Title order per UI locale. Titles come only from AniList metadata; the app never machine-translates
 * them, and since AniList has no Chinese title field the Chinese UI shows the Japanese original.
 *
 * - `ja`: native (Japanese) → romaji → English; subtitle: romaji, else English.
 * - `en`: English → romaji → native; subtitle: native, else romaji.
 * - `zh-CN`: native → romaji → English; subtitle: romaji, else English (the long-standing behavior).
 */
const TITLE_ORDER: Record<Locale, { primary: TitleField[]; secondary: TitleField[] }> = {
  ja: { primary: ['native', 'romaji', 'english'], secondary: ['romaji', 'english'] },
  en: { primary: ['english', 'romaji', 'native'], secondary: ['native', 'romaji'] },
  'zh-CN': { primary: ['native', 'romaji', 'english'], secondary: ['romaji', 'english'] },
};

const clean = (value: string | undefined) => (value || '').trim();

export const getDisplayTitles = (anime: Pick<Anime, 'title'>, locale: Locale): DisplayTitles => {
  const order = TITLE_ORDER[locale];
  const primary = order.primary.map((field) => clean(anime.title[field])).find(Boolean) || '';
  const secondary = order.secondary
    .map((field) => clean(anime.title[field]))
    .find((title) => title && title !== primary);
  return secondary ? { primary, secondary } : { primary };
};

export const getDisplayTitle = (anime: Pick<Anime, 'title'>, locale: Locale) => getDisplayTitles(anime, locale).primary;
