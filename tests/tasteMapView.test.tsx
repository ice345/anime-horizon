import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TasteMapView } from '../components/pages/TasteMapView';
import { I18nProvider } from '../shared/i18n/I18nProvider';
import { Locale } from '../shared/i18n/locales';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';

const title = (
  id: number,
  status: UserAnimeStatus,
  reaction: UserAnimeReaction | undefined,
  genres: string[],
  overrides: Partial<Anime> = {}
): Anime => ({
  id: String(id),
  title: { native: '', romaji: `Work ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2015,
  genres,
  format: 'TV',
  popularity: 50_000,
  userStatus: status,
  ...(reaction ? { userReaction: reaction } : {}),
  ...overrides,
});

const many = (count: number, make: (index: number) => Anime) => Array.from({ length: count }, (_, i) => make(i));

const renderMap = (archive: Anime[], locale: Locale = 'en') =>
  render(
    <I18nProvider initialLocale={locale}>
      <TasteMapView
        archive={archive}
        onDiscover={vi.fn()}
        onMyAnime={vi.fn()}
        onAnalyze={vi.fn()}
        onOpenPortrait={vi.fn()}
      />
    </I18nProvider>
  );

const section = (name: string) => screen.getByRole('region', { name });

describe('Taste Map', () => {
  it('shows no taste verdict for an empty archive, with paths to Discover and My Anime', () => {
    renderMap([]);
    expect(screen.getByRole('heading', { name: 'No taste profile yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Discover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open My Anime' })).toBeInTheDocument();
    expect(screen.queryByText('What you tend to enjoy')).not.toBeInTheDocument();
  });

  it('labels a PLAN-only archive as intent, never as taste', () => {
    renderMap(many(12, (i) => title(i + 1, 'PLAN', 'LOVE', ['Romance'])));
    expect(screen.getByRole('heading', { name: 'Nothing watched yet' })).toBeInTheDocument();
    expect(within(section('On your watch list')).getByText('Romance · 12 saved')).toBeInTheDocument();
    expect(screen.getByText('Saved titles show interest, not taste.')).toBeInTheDocument();
    expect(screen.queryByText('Mostly enjoyed')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'What you tend to enjoy' })).not.toBeInTheDocument();
  });

  it('shows exposure only when no watched title has a reaction', () => {
    renderMap(many(6, (i) => title(i + 1, 'COMPLETED', undefined, ['Drama'])));
    expect(screen.getByText(/You haven’t reacted to any watched title yet/)).toBeInTheDocument();
    expect(within(section('What you’ve explored')).getByText('6 watched')).toBeInTheDocument();
    expect(screen.queryByText('Mostly enjoyed')).not.toBeInTheDocument();
  });

  it('keeps one or two reactions as limited observations', () => {
    renderMap([title(1, 'COMPLETED', 'LOVE', ['Music']), title(2, 'COMPLETED', undefined, ['Music'])]);
    expect(screen.getByText(/Limited evidence: only 1 watched title has a reaction/)).toBeInTheDocument();
    expect(screen.getByText(/No genre has enough reactions yet/)).toBeInTheDocument();
    expect(screen.getByText('Work 1')).toBeInTheDocument();
  });

  it('puts a heavily watched but disliked genre under "not for you", never under "enjoy"', () => {
    renderMap([
      ...many(14, (i) => title(i + 1, 'COMPLETED', i % 2 ? 'DISLIKE' : 'HATE', ['Slice of Life'])),
      ...many(6, (i) => title(i + 50, 'COMPLETED', 'LOVE', ['Music'])),
    ]);
    const negative = section('What tends not to work for you');
    expect(within(negative).getByText('Slice of Life')).toBeInTheDocument();
    expect(within(negative).getByText('14 watched · 0 liked · 14 disliked')).toBeInTheDocument();
    expect(within(section('What you tend to enjoy')).queryByText('Slice of Life')).not.toBeInTheDocument();
    expect(within(section('What you tend to enjoy')).getByText('Music')).toBeInTheDocument();
    // Evidence is spelled out, and nothing is presented as a percentage or score.
    expect(
      within(negative).getByText('You reacted to 14 of them: 0 Liked or Loved, 0 Okay, 14 Not for me or Disliked.', {
        exact: false,
      })
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d\s*%/);
  });

  it('counts explicit "okay" and missing reactions separately in the evidence', () => {
    renderMap([
      ...many(3, (i) => title(i + 1, 'COMPLETED', 'LIKE', ['Drama'])),
      title(10, 'COMPLETED', 'NEUTRAL', ['Drama']),
      title(11, 'COMPLETED', undefined, ['Drama']),
    ]);
    expect(screen.getByText('5 watched · 3 liked · 1 okay · 0 disliked · 1 no reaction')).toBeInTheDocument();
  });

  it('shows the best-supported genres first and keeps the rest behind "Show more"', () => {
    const genres = ['Action', 'Comedy', 'Drama', 'Fantasy', 'Music', 'Romance', 'Sci-Fi', 'Sports'];
    renderMap(genres.flatMap((genre, g) => many(3 + g, (i) => title(g * 100 + i, 'COMPLETED', 'LIKE', [genre]))));
    const enjoy = section('What you tend to enjoy');
    expect(within(enjoy).getByText('Show 2 more')).toBeInTheDocument();
    // Ordered by evidence: the genre with the most liked titles comes first.
    expect(within(enjoy).getAllByRole('listitem')[0]).toHaveTextContent('Sports');
  });

  it.each([
    ['ja', '好みのマップ', '合わないことが多いもの'],
    ['zh-CN', '口味地图', '通常不太对你胃口的'],
  ] as const)('renders in %s', (locale, heading, negativeHeading) => {
    renderMap(
      many(5, (i) => title(i + 1, 'COMPLETED', 'HATE', ['Drama'])),
      locale
    );
    expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: negativeHeading })).toBeInTheDocument();
  });
});
