import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecommendationsModal } from '../components/home/RecommendationsModal';
import { I18nProvider } from '../shared/i18n/I18nProvider';
import { Locale } from '../shared/i18n/locales';
import type { RecommendationGraph } from '../services/anilistService';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';

const fetchRecommendationGraph = vi.fn<(ids: string[]) => Promise<RecommendationGraph>>();
vi.mock('../services/anilistService', () => ({
  fetchRecommendationGraph: (ids: string[]) => fetchRecommendationGraph(ids),
}));

const anime = (id: number, genres: string[], extra: Partial<Anime> = {}): Anime => ({
  id: String(id),
  title: { native: '', romaji: `Title ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2016,
  genres,
  format: 'TV',
  popularity: 50_000,
  ...extra,
});
const mine = (id: number, status: UserAnimeStatus, reaction: UserAnimeReaction | undefined, genres: string[]) => ({
  ...anime(id, genres),
  userStatus: status,
  ...(reaction ? { userReaction: reaction } : {}),
});

const archive: Anime[] = [
  ...[1, 2, 3, 4, 5].map((id) => mine(id, 'COMPLETED', id === 1 ? 'LOVE' : 'LIKE', ['Music', 'Drama'])),
  ...[10, 11, 12].map((id) => mine(id, 'COMPLETED', 'HATE', ['Horror'])),
];
const candidates = Array.from({ length: 8 }, (_, index) =>
  anime(100 + index, index === 5 ? ['Drama', 'Horror'] : ['Drama'], { popularity: 40_000 + index })
);
const graph: RecommendationGraph = {
  incomplete: false,
  nodes: [
    {
      sourceId: '1',
      links: candidates.map((candidate, index) => ({ anime: candidate, rating: 80 - index * 5, continues: [] })),
    },
    {
      sourceId: '2',
      links: candidates.slice(0, 3).map((candidate) => ({ anime: candidate, rating: 10, continues: [] })),
    },
  ],
};

/** Mirrors App: adding puts the title in the archive as Plan to Watch; toggling again removes it. */
const Harness: React.FC<{ initial: Anime[]; locale?: Locale }> = ({ initial, locale = 'en' }) => {
  const [items, setItems] = useState(initial);
  const ids = new Set(items.map((item) => String(item.id)));
  return (
    <I18nProvider initialLocale={locale}>
      <RecommendationsModal
        isOpen
        onClose={vi.fn()}
        archive={items}
        fallbackAnime={[anime(900, ['Action'], { popularity: 300_000 })]}
        selectedIds={ids}
        onToggle={(target) =>
          setItems((previous) =>
            previous.some((item) => item.id === target.id)
              ? previous.filter((item) => item.id !== target.id)
              : [...previous, { ...target, userStatus: 'PLAN' }]
          )
        }
      />
    </I18nProvider>
  );
};

const matchTitles = () =>
  within(screen.getByRole('region', { name: 'Close to what you like' }))
    .getAllByRole('heading', { level: 4 })
    .map((heading) => heading.textContent);

describe('RecommendationsModal', () => {
  beforeEach(() => {
    fetchRecommendationGraph.mockReset();
    fetchRecommendationGraph.mockResolvedValue(graph);
  });

  it('explains each pick with evidence, and adding one removes only that card', async () => {
    render(<Harness initial={archive} />);
    await screen.findByRole('region', { name: 'Close to what you like' });
    expect(screen.getByText(/Based on the 5 titles you loved or liked/)).toBeInTheDocument();
    expect(
      screen.getAllByText('Because you loved Title 1, and 1 more title you liked points here too.').length
    ).toBeGreaterThan(0);

    const before = matchTitles();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Add ${before[2]} to Plan to Watch` }));
    });

    const after = matchTitles();
    expect(after).toEqual(before.filter((title) => title !== before[2]));
    const onList = screen.getByRole('region', { name: 'Already on your list' });
    expect(within(onList).getByText(before[2]!)).toBeInTheDocument();
    expect(within(onList).getByText('Added to Plan to Watch')).toBeInTheDocument();
    // Plans are not sources, so the AniList graph is not requested again.
    expect(fetchRecommendationGraph).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(within(onList).getByRole('button', { name: `Remove ${before[2]} from My Anime` }));
    });
    expect(matchTitles()).toEqual(before);
    expect(document.body.textContent).not.toMatch(/\d\s*%/);
  });

  it('says when a disliked genre was penalized, only for titles where it applied', async () => {
    render(<Harness initial={archive} />);
    const card = (await screen.findAllByRole('heading', { name: 'Title 105' }))[0].closest('li')!;
    fireEvent.click(within(card).getByText('Why this?'));
    expect(
      within(card).getByText(
        'It’s Horror, which you’ve mostly disliked, but its links to titles you liked are stronger.'
      )
    ).toBeInTheDocument();
    const other = screen.getByRole('heading', { name: 'Title 100' }).closest('li')!;
    expect(within(other).queryByText(/mostly disliked/)).not.toBeInTheDocument();
  });

  it('labels an empty archive as not personalized and does not call AniList', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/Not personalized/)).toBeInTheDocument();
    expect(screen.getByText('Popular in the season shown in Discover.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Suggestions' })).toBeInTheDocument();
    expect(fetchRecommendationGraph).not.toHaveBeenCalled();
  });

  it('labels watched-but-unrated archives as exposure-based', async () => {
    render(<Harness initial={[mine(1, 'COMPLETED', undefined, ['Drama'])]} />);
    expect((await screen.findAllByText('Linked to Title 1, which you’ve watched.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/so these are linked to what you’ve watched, not to what you enjoyed/)).toBeInTheDocument();
  });

  it.each([
    ['ja', '好みに近い作品', '「Title 1」を「とても好き」にしていて、ほかに「好き」の1作品ともつながっています。'],
    ['zh-CN', '和你的喜好相近', '因为你非常喜欢《Title 1》，另外还有 1 部你喜欢的作品也指向它。'],
  ] as const)('renders reasons in %s', async (locale, heading, reason) => {
    render(<Harness initial={archive} locale={locale} />);
    expect(await screen.findByRole('region', { name: heading })).toBeInTheDocument();
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
  });

  it('shows loading, not an empty result, while Discover is still loading the season', () => {
    const view = (catalogue: Anime[], loading: boolean) => (
      <I18nProvider initialLocale="en">
        <RecommendationsModal
          isOpen
          onClose={vi.fn()}
          archive={[]}
          fallbackAnime={catalogue}
          catalogueLoading={loading}
          selectedIds={new Set()}
          onToggle={vi.fn()}
        />
      </I18nProvider>
    );
    const { rerender } = render(view([], true));
    expect(screen.getByText('Looking through your archive for the next title…')).toBeInTheDocument();
    expect(screen.queryByText(/No recommendations yet/)).not.toBeInTheDocument();

    rerender(view([anime(900, ['Action'])], false));
    expect(screen.getByRole('heading', { name: 'Title 900' })).toBeInTheDocument();

    rerender(view([], false));
    expect(screen.getByText(/No recommendations yet/)).toBeInTheDocument();
  });

  it('says dislikes adjusted the order when nothing is liked but some genres are disliked', () => {
    render(<Harness initial={[10, 11, 12].map((id) => mine(id, 'COMPLETED', 'HATE', ['Horror']))} />);
    expect(screen.getByText(/adjusted for what tends not to work for you/)).toBeInTheDocument();
    expect(screen.queryByText(/^Not personalized/)).not.toBeInTheDocument();
  });
});
