import { describe, expect, it } from 'vitest';
import { collectCandidates } from '../features/recommendations/candidates';
import { buildRecommendations, RecommendationResult } from '../features/recommendations/recommendations';
import { selectRecommendationSources, sourceSelectionKey } from '../features/recommendations/sources';
import type { RecommendationGraph, RecommendationGraphLink } from '../services/anilistService';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';

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

const mine = (
  id: number,
  status: UserAnimeStatus,
  reaction: UserAnimeReaction | undefined,
  genres: string[],
  extra: Partial<Anime> = {}
): Anime => ({
  ...anime(id, genres, extra),
  userStatus: status,
  ...(reaction ? { userReaction: reaction } : {}),
});

const link = (target: Anime, rating = 20, continues: string[] = []): RecommendationGraphLink => ({
  anime: target,
  rating,
  continues,
});

const graphOf = (edges: Record<number, RecommendationGraphLink[]>): RecommendationGraph => ({
  nodes: Object.entries(edges)
    .map(([sourceId, links]) => ({ sourceId, links }))
    .sort((left, right) => Number(left.sourceId) - Number(right.sourceId)),
  incomplete: false,
});

const ids = (result: RecommendationResult) => [...result.matches, ...result.explore].map((item) => item.anime.id);
const all = (result: RecommendationResult) => [...result.matches, ...result.explore];
const rankOf = (result: RecommendationResult, id: number) => ids(result).indexOf(String(id));

const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);

describe('positive preference', () => {
  it('ranks candidates linked from loved Music titles above otherwise similar unrelated ones', () => {
    const archive = [
      ...range(1, 4).map((id) => mine(id, 'COMPLETED', 'LOVE', ['Music', 'Drama'])),
      mine(10, 'COMPLETED', 'LIKE', ['Action']),
    ];
    const music = anime(100, ['Music', 'Drama']);
    const other = anime(101, ['Music', 'Drama']);
    const result = buildRecommendations(
      archive,
      graphOf({ 1: [link(music)], 2: [link(music)], 10: [link(other)] }),
      []
    );

    expect(rankOf(result, 100)).toBeLessThan(rankOf(result, 101));
    const reason = all(result).find((item) => item.anime.id === '100')!.reason;
    expect(reason.lead).toMatchObject({ kind: 'loved', others: 1 });
    expect(reason.enjoyedGenres).toEqual(['Drama', 'Music']);
  });

  it('gives LOVE more influence than LIKE', () => {
    const archive = [mine(1, 'COMPLETED', 'LOVE', ['Drama']), mine(2, 'COMPLETED', 'LIKE', ['Drama'])];
    const result = buildRecommendations(
      archive,
      graphOf({ 1: [link(anime(100, ['Comedy']))], 2: [link(anime(101, ['Comedy']))] }),
      []
    );
    expect(ids(result)).toEqual(['100', '101']);
  });
});

describe('negative preference', () => {
  const archive = [
    ...range(1, 3).map((id) => mine(id, 'COMPLETED', 'LIKE', ['Drama'])),
    ...range(10, 8).map((id) => mine(id, 'COMPLETED', id % 2 ? 'HATE' : 'DISLIKE', ['Isekai', 'Fantasy'])),
  ];

  it('ranks candidates dominated by a repeatedly disliked genre lower, without filtering them out', () => {
    const clean = anime(100, ['Drama']);
    const disliked = anime(101, ['Drama', 'Isekai']);
    const result = buildRecommendations(archive, graphOf({ 1: [link(disliked), link(clean)] }), []);

    expect(rankOf(result, 100)).toBeLessThan(rankOf(result, 101));
    expect(rankOf(result, 101)).toBeGreaterThanOrEqual(0);
    expect(all(result).find((item) => item.anime.id === '101')!.reason).toMatchObject({
      despiteGenres: ['Isekai'],
      despiteOutweighed: true,
    });
  });

  it('still recommends a disliked-genre title when positive title evidence is strong enough', () => {
    const lovedArchive = [
      ...range(1, 3).map((id) => mine(id, 'COMPLETED', 'LOVE', ['Music', 'Drama'])),
      ...range(10, 8).map((id) => mine(id, 'COMPLETED', 'HATE', ['Isekai'])),
    ];
    const crossover = anime(100, ['Music', 'Drama', 'Isekai']);
    const plain = anime(101, ['Comedy']);
    const result = buildRecommendations(
      lovedArchive,
      graphOf({ 1: [link(crossover, 100)], 2: [link(crossover, 100)], 3: [link(crossover), link(plain)] }),
      []
    );
    expect(ids(result)[0]).toBe('100');
  });

  it('drops candidates whose evidence nets out negative, e.g. linked only from hated titles', () => {
    const result = buildRecommendations(
      archive,
      graphOf({ 1: [link(anime(100, ['Drama']))], 11: [link(anime(102, ['Isekai']), 100)] }),
      []
    );
    expect(ids(result)).toEqual(['100']);
  });

  it('a heavily watched but mostly disliked genre penalizes, never boosts, similar titles', () => {
    const sliceOfLife = [
      ...range(1, 12).map((id) => mine(id, 'COMPLETED', id % 4 ? 'DISLIKE' : 'HATE', ['Slice of Life'])),
      mine(50, 'COMPLETED', 'LIKE', ['Mystery']),
      mine(51, 'COMPLETED', 'LIKE', ['Mystery']),
    ];
    const sol = anime(100, ['Mystery', 'Slice of Life']);
    const mystery = anime(101, ['Mystery']);
    const result = buildRecommendations(sliceOfLife, graphOf({ 50: [link(sol), link(mystery)] }), []);
    const solItem = all(result).find((item) => item.anime.id === '100')!;
    expect(rankOf(result, 101)).toBeLessThan(rankOf(result, 100));
    expect(solItem.ranked.evidence.genrePenalty).toBeGreaterThan(0);
    expect(solItem.ranked.evidence.positiveGenres).not.toContain('Slice of Life');
  });
});

describe('mixed areas', () => {
  it('treats a mixed genre as neither liked nor disliked and never names it as enjoyed', () => {
    const archive = [
      ...range(1, 4).map((id) => mine(id, 'COMPLETED', 'LOVE', ['Romance'])),
      ...range(10, 4).map((id) => mine(id, 'COMPLETED', 'HATE', ['Romance'])),
      mine(20, 'COMPLETED', 'LIKE', ['Drama']),
    ];
    const romance = anime(100, ['Romance']);
    const result = buildRecommendations(archive, graphOf({ 20: [link(romance)] }), []);
    const item = all(result)[0];
    expect(item.ranked.evidence).toMatchObject({ mixedGenres: ['Romance'], genreBoost: 0, genrePenalty: 0 });
    expect(item.reason.enjoyedGenres).toEqual([]);
    expect(item.reason.despiteGenres).toEqual([]);
  });
});

describe('no reaction is unknown, not NEUTRAL', () => {
  it('never makes unrated or NEUTRAL watched titles into positive sources', () => {
    const archive = [
      mine(1, 'COMPLETED', undefined, ['Drama']),
      mine(2, 'COMPLETED', 'NEUTRAL', ['Drama']),
      mine(3, 'COMPLETED', 'LIKE', ['Comedy']),
    ];
    const { mode, sources } = selectRecommendationSources(archive);
    expect(mode).toBe('personal');
    expect(sources.map((source) => [source.anime.id, source.role, source.weight])).toEqual([['3', 'liked', 1]]);
  });

  it('uses unrated titles only as weak exposure sources when nothing is liked, and says so', () => {
    const archive = [mine(1, 'COMPLETED', undefined, ['Drama']), mine(2, 'WATCHING', undefined, ['Drama'])];
    const selection = selectRecommendationSources(archive);
    expect(selection.mode).toBe('exposure');
    expect(selection.sources.every((source) => source.role === 'watched' && source.weight === 0.25)).toBe(true);

    const result = buildRecommendations(archive, graphOf({ 1: [link(anime(100, ['Drama']))] }), []);
    expect(result.matches[0].reason.lead).toMatchObject({ kind: 'watched' });
    expect(result.matches[0].reason.enjoyedGenres).toEqual([]);
  });

  it('an unrated genre creates no positive genre evidence', () => {
    const archive = [
      ...range(1, 10).map((id) => mine(id, 'COMPLETED', undefined, ['Mecha'])),
      mine(20, 'COMPLETED', 'LIKE', ['Drama']),
    ];
    const result = buildRecommendations(archive, graphOf({ 20: [link(anime(100, ['Mecha']))] }), []);
    expect(result.matches[0].ranked.evidence).toMatchObject({ positiveGenres: [], genreBoost: 0 });
  });
});

describe('intent', () => {
  it('never lets planned titles outweigh demonstrated preference', () => {
    const archive = [
      ...range(1, 25).map((id) => mine(id, 'PLAN', 'LOVE', ['Fantasy'])),
      ...range(100, 15).map((id) => mine(id, 'COMPLETED', id % 2 ? 'HATE' : 'DISLIKE', ['Fantasy'])),
      mine(200, 'COMPLETED', 'LIKE', ['Drama']),
    ];
    const selection = selectRecommendationSources(archive);
    expect(selection.mode).toBe('personal');
    expect(selection.sources.some((source) => source.anime.userStatus === 'PLAN')).toBe(false);

    const fantasy = anime(500, ['Fantasy']);
    const drama = anime(501, ['Drama']);
    const result = buildRecommendations(archive, graphOf({ 200: [link(fantasy), link(drama)] }), []);
    expect(rankOf(result, 501)).toBeLessThan(rankOf(result, 500));
  });

  it('uses the watch list only when nothing has been watched, and labels it as intent', () => {
    const archive = range(1, 5).map((id) => mine(id, 'PLAN', undefined, ['Fantasy']));
    const result = buildRecommendations(archive, graphOf({ 1: [link(anime(100, ['Fantasy']))] }), []);
    expect(result.mode).toBe('intent');
    expect(result.matches[0].reason.lead).toMatchObject({ kind: 'planned' });
  });
});

describe('known titles and continuations', () => {
  it('excludes every title already in the archive and de-duplicates candidates', () => {
    const archive = [
      mine(1, 'COMPLETED', 'LOVE', ['Drama']),
      mine(2, 'WATCHING', 'LIKE', ['Drama']),
      mine(3, 'PLAN', undefined, ['Drama']),
    ];
    const target = anime(100, ['Drama']);
    const result = buildRecommendations(
      archive,
      graphOf({ 1: [link(archive[1]), link(archive[2]), link(target)], 2: [link(target), link(archive[0])] }),
      [archive[0], target]
    );
    expect(ids(result)).toEqual(['100']);
    expect(result.onYourList.map((item) => item.anime.id)).toEqual(['3']);
  });

  it('skips sequels of unstarted or disliked titles but keeps continuations of liked ones', () => {
    const archive = [mine(1, 'COMPLETED', 'LOVE', ['Drama']), mine(2, 'COMPLETED', 'HATE', ['Drama'])];
    const pool = collectCandidates(
      archive,
      selectRecommendationSources(archive).sources,
      graphOf({
        1: [
          link(anime(100, ['Drama']), 20, ['999']),
          link(anime(101, ['Drama']), 20, ['2']),
          link(anime(102, ['Drama']), 20, ['1']),
        ],
      }),
      []
    );
    expect(pool.candidates.map((candidate) => candidate.anime.id)).toEqual(['102']);
    expect(pool.excluded).toMatchObject({ continuesUnstarted: 1, continuesDisliked: 1 });
  });
});

describe('determinism and stability', () => {
  const archive = [
    ...range(1, 6).map((id) => mine(id, 'COMPLETED', id % 2 ? 'LOVE' : 'LIKE', ['Drama', 'Music'])),
    ...range(10, 3).map((id) => mine(id, 'COMPLETED', 'DISLIKE', ['Horror'])),
  ];
  const candidates = range(100, 20).map((id) =>
    anime(id, id % 3 ? ['Drama'] : ['Horror', 'Drama'], { popularity: 5_000 + id * 100 })
  );
  const graph = graphOf(
    Object.fromEntries(
      range(1, 6).map((source) => [
        source,
        candidates.filter((_, index) => (index + source) % 3 !== 0).map((c) => link(c, source * 7)),
      ])
    )
  );

  it('produces the identical order on repeated runs and regardless of input order', () => {
    const first = ids(buildRecommendations(archive, graph, []));
    for (let run = 0; run < 5; run += 1) expect(ids(buildRecommendations(archive, graph, []))).toEqual(first);
    expect(ids(buildRecommendations([...archive].reverse(), graph, []))).toEqual(first);
  });

  it('adding recommendation #3 to Plan to Watch removes it and keeps everyone else in order', () => {
    const before = buildRecommendations(archive, graph, []);
    const third = before.matches[2].anime;
    const after = buildRecommendations([...archive, { ...third, userStatus: 'PLAN' }], graph, []);

    // Plans are not sources, so the graph (and the request) stays the same.
    expect(sourceSelectionKey(selectRecommendationSources([...archive, { ...third, userStatus: 'PLAN' }]))).toBe(
      sourceSelectionKey(selectRecommendationSources(archive))
    );
    expect(ids(after)).not.toContain(third.id);
    expect(after.onYourList.map((item) => item.anime.id)).toContain(third.id);
    const remainingBefore = before.matches.map((item) => item.anime.id).filter((id) => id !== third.id);
    expect(after.matches.map((item) => item.anime.id).slice(0, remainingBefore.length)).toEqual(remainingBefore);
    expect(after.explore.map((item) => item.anime.id)).toEqual(before.explore.map((item) => item.anime.id));
  });
});

describe('all LOVE vs all HATE', () => {
  it('produces materially different rankings for the same watched titles', () => {
    const source = (reaction: UserAnimeReaction) =>
      range(1, 6).map((id) => mine(id, 'COMPLETED', reaction, id < 4 ? ['Drama'] : ['Action']));
    const linked = range(100, 6).map((id) => anime(id, ['Drama']));
    const catalogue = range(200, 6).map((id) => anime(id, ['Action'], { popularity: 90_000 + id }));
    const graph = graphOf({ 1: linked.map((c) => link(c)), 4: linked.slice(0, 2).map((c) => link(c)) });

    const loved = buildRecommendations(source('LOVE'), graph, catalogue);
    const hated = buildRecommendations(source('HATE'), graph, catalogue);
    expect(loved.mode).toBe('personal');
    expect(hated.mode).toBe('popular');
    expect(
      ids(loved)
        .slice(0, 6)
        .every((id) => Number(id) < 200)
    ).toBe(true);
    expect(ids(hated).some((id) => Number(id) < 200)).toBe(false);
    expect(hated.matches.every((item) => item.reason.lead.kind === 'popular')).toBe(true);
  });
});

describe('cold start', () => {
  it('labels an empty archive as not personalized', () => {
    const catalogue = range(1, 5).map((id) => anime(id, ['Drama'], { popularity: id * 10_000 }));
    const result = buildRecommendations([], null, catalogue);
    expect(result.mode).toBe('popular');
    expect(result.matches.map((item) => item.anime.id)).toEqual(['5', '4', '3', '2', '1']);
    expect(result.matches.every((item) => item.reason.lead.kind === 'popular')).toBe(true);
    expect(result.explore).toEqual([]);
  });

  it('flags limited evidence when fewer than five watched titles have reactions', () => {
    const archive = [mine(1, 'COMPLETED', 'LOVE', ['Drama']), mine(2, 'COMPLETED', undefined, ['Drama'])];
    const result = buildRecommendations(archive, graphOf({ 1: [link(anime(100, ['Drama']))] }), []);
    expect(result).toMatchObject({ mode: 'personal', limitedEvidence: true, positiveSourceCount: 1 });
  });

  it('falls back to the catalogue, ranked by genre reactions, when the graph is unavailable', () => {
    const archive = range(1, 5).map((id) => mine(id, 'COMPLETED', 'LOVE', ['Music']));
    const catalogue = [anime(100, ['Action'], { popularity: 200_000 }), anime(101, ['Music'], { popularity: 2_000 })];
    const result = buildRecommendations(archive, null, catalogue);
    // The Music title is lesser-known, so it is shown as a grounded exploration pick.
    const music = all(result).find((item) => item.anime.id === '101')!;
    expect(music.ranked.score).toBeGreaterThan(all(result).find((item) => item.anime.id === '100')!.ranked.score);
    expect(music.reason.lead).toMatchObject({ kind: 'genres', genres: ['Music'] });
    expect(result.explore.map((item) => item.anime.id)).toEqual(['101']);
  });
});

describe('exploration', () => {
  it('marks a grounded pick from a rarely watched era as exploration, never obscurity alone', () => {
    const archive = range(1, 8).map((id) => mine(id, 'COMPLETED', 'LIKE', ['Drama'], { seasonYear: 2018 }));
    const oldTitle = anime(100, ['Drama'], { seasonYear: 1995 });
    const recent = anime(101, ['Drama'], { seasonYear: 2019 });
    const result = buildRecommendations(archive, graphOf({ 1: [link(oldTitle), link(recent)] }), []);
    expect(result.explore.map((item) => item.anime.id)).toEqual(['100']);
    expect(result.explore[0].reason.exploration).toEqual({ kind: 'era', decadeYear: 1990 });
    expect(result.matches.map((item) => item.anime.id)).toEqual(['101']);
  });
});
