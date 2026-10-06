import { describe, expect, it } from 'vitest';
import {
  buildTasteModel,
  classifyStance,
  EXPOSURE_WEIGHT,
  genresByStance,
  TasteModel,
} from '../features/taste/tasteModel';
import { Anime, UserAnimeReaction, UserAnimeStatus } from '../types';

const NOW = new Date('2026-10-05T00:00:00.000Z');

const title = (
  id: number,
  status: UserAnimeStatus,
  reaction: UserAnimeReaction | undefined,
  overrides: Partial<Anime> = {}
): Anime => ({
  id: String(id),
  title: { native: '', romaji: `Work ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2015,
  genres: ['Slice of Life'],
  format: 'TV',
  popularity: 50_000,
  userStatus: status,
  ...(reaction ? { userReaction: reaction } : {}),
  ...overrides,
});

const many = (count: number, make: (index: number) => Anime) => Array.from({ length: count }, (_, i) => make(i));
const genre = (model: TasteModel, key: string) => model.genres.find((item) => item.key === key);

describe('audit regressions: exposure is not preference', () => {
  it('the same watched titles rated all LOVE vs all HATE give opposite profiles', () => {
    const watched = (reaction: UserAnimeReaction) =>
      many(12, (i) => title(i + 1, 'COMPLETED', reaction, { genres: i % 2 ? ['Drama', 'Music'] : ['Drama'] }));
    const loved = buildTasteModel(watched('LOVE'), NOW);
    const hated = buildTasteModel(watched('HATE'), NOW);

    expect(genre(loved, 'Drama')).toMatchObject({ stance: 'positive', positive: 12, negative: 0, watched: 12 });
    expect(genre(hated, 'Drama')).toMatchObject({ stance: 'negative', positive: 0, negative: 12, watched: 12 });
    expect(genre(loved, 'Music')?.stance).toBe('positive');
    expect(genre(hated, 'Music')?.stance).toBe('negative');
    expect(genresByStance(loved).negative).toEqual([]);
    expect(genresByStance(hated).positive).toEqual([]);
    expect(loved.favorites).toHaveLength(8);
    expect(hated.favorites).toEqual([]);
    expect(hated.dislikes).toHaveLength(5);
    // Exposure is identical; only preference differs.
    expect(genre(loved, 'Drama')?.exposure).toBe(genre(hated, 'Drama')?.exposure);
  });

  it('many Slice of Life titles marked mostly DISLIKE/HATE are high exposure with negative preference', () => {
    const archive = [
      ...many(14, (i) => title(i + 1, 'COMPLETED', i % 2 ? 'DISLIKE' : 'HATE')),
      ...many(2, (i) => title(i + 100, 'COMPLETED', 'LIKE')),
      ...many(2, (i) => title(i + 200, 'COMPLETED', undefined)),
    ];
    const sliceOfLife = genre(buildTasteModel(archive, NOW), 'Slice of Life');

    expect(sliceOfLife).toMatchObject({ watched: 18, rated: 16, negative: 14, positive: 2, unrated: 2 });
    expect(sliceOfLife?.stance).toBe('negative');
    expect(genresByStance(buildTasteModel(archive, NOW)).positive).toEqual([]);
  });

  it('distinguishes the three cases from the brief: liked, disliked and only planned', () => {
    const caseA = buildTasteModel(
      [
        ...many(20, (i) => title(i + 1, 'COMPLETED', i % 2 ? 'LOVE' : 'LIKE', { genres: ['Music'] })),
        ...many(2, (i) => title(i + 30, 'COMPLETED', 'HATE', { genres: ['Music'] })),
        ...many(3, (i) => title(i + 40, 'COMPLETED', undefined, { genres: ['Music'] })),
      ],
      NOW
    );
    const caseB = buildTasteModel(
      [
        ...many(3, (i) => title(i + 1, 'COMPLETED', 'LIKE', { genres: ['Music'] })),
        ...many(18, (i) => title(i + 10, 'COMPLETED', i % 2 ? 'DISLIKE' : 'HATE', { genres: ['Music'] })),
        ...many(4, (i) => title(i + 40, 'COMPLETED', undefined, { genres: ['Music'] })),
      ],
      NOW
    );
    const caseC = buildTasteModel(
      many(25, (i) => title(i + 1, 'PLAN', undefined, { genres: ['Music'] })),
      NOW
    );

    expect(genre(caseA, 'Music')).toMatchObject({ watched: 25, positive: 20, negative: 2, stance: 'positive' });
    expect(genre(caseB, 'Music')).toMatchObject({ watched: 25, positive: 3, negative: 18, stance: 'negative' });
    expect(genre(caseC, 'Music')).toBeUndefined();
    expect(caseC.intentGenres).toEqual([{ key: 'Music', planned: 25 }]);
    expect(caseC.state).toBe('intentOnly');
  });
});

describe('PLAN is intent, never viewing or preference', () => {
  it('a PLAN-only archive produces no watched exposure and no taste claims', () => {
    const model = buildTasteModel(
      many(30, (i) => title(i + 1, 'PLAN', i % 3 ? undefined : 'LOVE', { genres: ['Romance', 'Drama'] })),
      NOW
    );

    expect(model.state).toBe('intentOnly');
    expect(model.totals).toMatchObject({ watched: 0, rated: 0, planned: 30, plannedWithReaction: 10 });
    expect(model.genres).toEqual([]);
    expect(model.eras).toEqual([]);
    expect(model.formats).toEqual([]);
    expect(model.favorites).toEqual([]);
    expect(model.range.eraLean).toBe('unknown');
    expect(model.popularity.lean).toBe('unknown');
    expect(model.intentGenres.map((item) => item.key)).toEqual(['Drama', 'Romance']);
  });

  it('PLAN titles do not change exposure or preference of watched genres', () => {
    const watched = many(5, (i) => title(i + 1, 'COMPLETED', 'LIKE', { genres: ['Drama'] }));
    const plans = many(20, (i) => title(i + 50, 'PLAN', 'HATE', { genres: ['Drama'] }));

    const without = genre(buildTasteModel(watched, NOW), 'Drama');
    const withPlans = genre(buildTasteModel([...watched, ...plans], NOW), 'Drama');
    expect({ ...withPlans, planned: 0 }).toEqual(without);
    expect(withPlans?.planned).toBe(20);
  });
});

describe('missing reaction is not NEUTRAL', () => {
  it('keeps unrated and explicit NEUTRAL as different evidence', () => {
    const unrated = buildTasteModel(
      many(6, (i) => title(i + 1, 'COMPLETED', undefined)),
      NOW
    );
    const neutral = buildTasteModel(
      many(6, (i) => title(i + 1, 'COMPLETED', 'NEUTRAL')),
      NOW
    );

    expect(unrated.state).toBe('unrated');
    expect(genre(unrated, 'Slice of Life')).toMatchObject({ rated: 0, unrated: 6, neutral: 0, stance: 'insufficient' });
    expect(neutral.state).toBe('ready');
    expect(genre(neutral, 'Slice of Life')).toMatchObject({ rated: 6, unrated: 0, neutral: 6, stance: 'neutral' });
  });
});

describe('sparse evidence', () => {
  it('gives no verdict for an empty archive', () => {
    const model = buildTasteModel([], NOW);
    expect(model.state).toBe('empty');
    expect(model.genres).toEqual([]);
    expect(model.favorites).toEqual([]);
  });

  it('keeps one or two reactions as observations without a direction', () => {
    const model = buildTasteModel(
      [title(1, 'COMPLETED', 'LOVE', { genres: ['Music'] }), title(2, 'COMPLETED', 'LOVE', { genres: ['Music'] })],
      NOW
    );
    expect(model.state).toBe('sparse');
    expect(genre(model, 'Music')).toMatchObject({ positive: 2, stance: 'insufficient', evidence: 'limited' });
    expect(model.favorites.map((anime) => anime.id)).toEqual(['1', '2']);
  });

  it('labels evidence by the number of reactions, not by a confidence percentage', () => {
    const rated = (count: number) =>
      genre(
        buildTasteModel(
          many(count, (i) => title(i + 1, 'COMPLETED', 'LIKE')),
          NOW
        ),
        'Slice of Life'
      )?.evidence;
    expect([rated(3), rated(5), rated(10)]).toEqual(['limited', 'moderate', 'solid']);
  });
});

describe('status weighting', () => {
  it('counts WATCHING as partial exposure and keeps its reactions as preference evidence', () => {
    const model = buildTasteModel(
      [
        title(1, 'COMPLETED', undefined, { genres: ['Drama'] }),
        title(2, 'WATCHING', 'LOVE', { genres: ['Drama'] }),
        title(3, 'WATCHING', 'LIKE', { genres: ['Drama'] }),
        title(4, 'WATCHING', 'LIKE', { genres: ['Drama'] }),
      ],
      NOW
    );
    expect(EXPOSURE_WEIGHT).toEqual({ COMPLETED: 1, WATCHING: 0.5, PLAN: 0 });
    expect(genre(model, 'Drama')).toMatchObject({
      watched: 4,
      completed: 1,
      watching: 3,
      exposure: 2.5,
      positive: 3,
      stance: 'positive',
    });
  });
});

describe('stance rules', () => {
  const counts = (positive: number, neutral: number, negative: number, loved = 0, hated = 0) => ({
    rated: positive + neutral + negative,
    positive,
    loved,
    neutral,
    negative,
    hated,
    unrated: 0,
    signal: positive + loved - negative - hated,
  });

  it('classifies mixed, neutral and leaning reactions', () => {
    expect(classifyStance(counts(4, 0, 4))).toBe('mixed');
    expect(classifyStance(counts(1, 4, 0))).toBe('neutral');
    expect(classifyStance(counts(2, 1, 0))).toBe('positive');
    expect(classifyStance(counts(0, 1, 2))).toBe('negative');
    expect(classifyStance(counts(2, 0, 0))).toBe('insufficient');
    // A clear majority with some dissent still has a direction; "mixed" needs a third on each side.
    expect(classifyStance(counts(33, 0, 15, 10, 5))).toBe('positive');
    expect(classifyStance(counts(4, 0, 7))).toBe('mixed');
  });
});

describe('viewing range is descriptive', () => {
  it('describes decades and popularity of watched titles only', () => {
    const model = buildTasteModel(
      [
        title(1, 'COMPLETED', undefined, { seasonYear: 1988, popularity: 4_000 }),
        title(2, 'COMPLETED', undefined, { seasonYear: 1998, popularity: 30_000 }),
        title(3, 'COMPLETED', undefined, { seasonYear: 2008, popularity: 150_000, format: 'MOVIE' }),
        title(4, 'COMPLETED', undefined, { seasonYear: 2021, popularity: 5_000 }),
        title(5, 'PLAN', undefined, { seasonYear: 1970, popularity: 1_000, format: 'OVA' }),
      ],
      NOW
    );
    expect(model.eras.map((era) => era.key)).toEqual(['1980', '1990', '2000', '2020']);
    expect(model.range).toMatchObject({ eraLean: 'acrossDecades', earliestYear: 1988, latestYear: 2021 });
    expect(model.formats.map((format) => format.key)).toEqual(['TV', 'MOVIE']);
    expect(model.popularity).toMatchObject({ wellKnown: 1, between: 1, lessKnown: 2, lean: 'lessKnown' });
  });

  it('reports mostly recent viewing without calling it a preference', () => {
    const model = buildTasteModel(
      many(6, (i) => title(i + 1, 'COMPLETED', undefined, { seasonYear: 2020 + (i % 5), popularity: 200_000 })),
      NOW
    );
    expect(model.range.eraLean).toBe('mostlyRecent');
    expect(model.popularity.lean).toBe('mainstream');
    expect(model.eras.every((era) => era.stance === 'insufficient')).toBe(true);
  });
});
