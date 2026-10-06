import type { MessageKey } from './translate';

/** AniList genre names are stable English identifiers; map them to semantic message keys. */
const GENRE_KEYS: Record<string, MessageKey> = {
  Action: 'genre.action',
  Adventure: 'genre.adventure',
  Comedy: 'genre.comedy',
  Drama: 'genre.drama',
  Ecchi: 'genre.ecchi',
  Fantasy: 'genre.fantasy',
  Horror: 'genre.horror',
  'Mahou Shoujo': 'genre.mahouShoujo',
  Mecha: 'genre.mecha',
  Music: 'genre.music',
  Mystery: 'genre.mystery',
  Psychological: 'genre.psychological',
  Romance: 'genre.romance',
  'Sci-Fi': 'genre.sciFi',
  'Slice of Life': 'genre.sliceOfLife',
  Sports: 'genre.sports',
  Supernatural: 'genre.supernatural',
  Thriller: 'genre.thriller',
  'Avant Garde': 'genre.avantGarde',
  'Award Winning': 'genre.awardWinning',
  'Boys Love': 'genre.boysLove',
  'Girls Love': 'genre.girlsLove',
  Suspense: 'genre.suspense',
};

/** Translated genre label; unknown AniList genres are shown as delivered. */
export const genreLabel = (t: (key: MessageKey) => string, genre: string) => {
  const key = GENRE_KEYS[genre];
  return key ? t(key) : genre;
};
