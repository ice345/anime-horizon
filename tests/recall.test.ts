import { describe, expect, it } from 'vitest';
import {
  buildRecallRound,
  buildSeasonOptions,
  createRandom,
  currentSlot,
  eligibleRecallTitles,
  isCorrectAnswer,
  slotIndex,
} from '../features/recall/recall';
import { buildRecommendations } from '../features/recommendations/recommendations';
import { buildTasteModel } from '../features/taste/tasteModel';
import { Anime, Season, UserAnimeStatus } from '../types';

const NOW = new Date('2026-10-06T12:00:00Z');
const SEASONS: Season[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

const title = (
  id: number,
  status: UserAnimeStatus,
  year: number,
  season: Season = 'SPRING',
  extra: Partial<Anime> = {}
): Anime => ({
  id: String(id),
  title: { native: '', romaji: `Title ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season,
  seasonYear: year,
  genres: ['Drama'],
  userStatus: status,
  ...extra,
});

describe('eligible titles', () => {
  it('uses only completed titles that aired at least a year ago', () => {
    const archive = [
      title(1, 'COMPLETED', 2014),
      title(2, 'WATCHING', 2014),
      title(3, 'PLAN', 2014),
      title(4, 'COMPLETED', 2026, 'SPRING'),
      title(5, 'COMPLETED', 2026, 'WINTER'),
      title(6, 'COMPLETED', 2025, 'SUMMER'),
    ];
    expect(eligibleRecallTitles(archive, NOW).map((anime) => anime.id)).toEqual(['1', '6']);
  });

  it('has nothing to ask for an archive without completed titles', () => {
    expect(buildRecallRound([title(1, 'PLAN', 2010), title(2, 'WATCHING', 2010)], 1, NOW)).toEqual([]);
  });
});

describe('questions', () => {
  it('asks about the real release season and always includes it among four distinct options', () => {
    const archive = Array.from({ length: 30 }, (_, index) =>
      title(index + 1, 'COMPLETED', 1990 + index, SEASONS[index % 4])
    );
    for (let seed = 0; seed < 50; seed += 1) {
      for (const question of buildRecallRound(archive, seed, NOW)) {
        expect(question.answer).toEqual({ year: question.anime.seasonYear, season: question.anime.season });
        expect(question.options).toHaveLength(4);
        expect(new Set(question.options.map(slotIndex)).size).toBe(4);
        expect(question.options.filter((option) => isCorrectAnswer(question, option))).toHaveLength(1);
        // Chronological order, nothing in the future, nothing absurdly old.
        const indexes = question.options.map(slotIndex);
        expect([...indexes].sort((left, right) => left - right)).toEqual(indexes);
        expect(Math.max(...indexes)).toBeLessThanOrEqual(slotIndex(currentSlot(NOW)));
        expect(Math.min(...indexes)).toBeGreaterThanOrEqual(1917 * 4);
      }
    }
  });

  it('builds distractors around the release period, so the current year does not give the answer away', () => {
    const positions = [0, 0, 0, 0];
    let currentYearIsAnswer = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const answer = { year: 2014, season: 'SPRING' as Season };
      const options = buildSeasonOptions(answer, createRandom(seed), NOW);
      positions[options.findIndex((option) => slotIndex(option) === slotIndex(answer))] += 1;
      // Options stay near 2014, far from 2026.
      expect(options.every((option) => Math.abs(option.year - 2014) <= 5)).toBe(true);
      if (options.some((option) => option.year === NOW.getFullYear())) currentYearIsAnswer += 1;
    }
    expect(currentYearIsAnswer).toBe(0);
    // The answer appears in every position, not reliably first or last.
    expect(positions.every((count) => count > 50)).toBe(true);
  });

  it('for a title from a year ago, still offers later seasons up to now instead of making it the newest choice', () => {
    let newest = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const answer = { year: 2025, season: 'SUMMER' as Season };
      const options = buildSeasonOptions(answer, createRandom(seed), NOW);
      if (slotIndex(options[3]) === slotIndex(answer)) newest += 1;
    }
    expect(newest).toBeLessThan(200);
    expect(newest).toBeGreaterThan(0);
  });

  it('works with a single completed title and does not repeat the last round first', () => {
    expect(buildRecallRound([title(1, 'COMPLETED', 2010)], 3, NOW)).toHaveLength(1);
    const archive = Array.from({ length: 8 }, (_, index) => title(index + 1, 'COMPLETED', 2000 + index));
    const first = buildRecallRound(archive, 11, NOW);
    const second = buildRecallRound(
      archive,
      12,
      NOW,
      first.map((question) => question.anime.id)
    );
    expect(first).toHaveLength(5);
    expect(second.slice(0, 3).map((question) => question.anime.id)).not.toContain(first[0].anime.id);
    expect(second.slice(0, 3).every((question) => !first.some((q) => q.anime.id === question.anime.id))).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const archive = Array.from({ length: 12 }, (_, index) => title(index + 1, 'COMPLETED', 1995 + index));
    expect(buildRecallRound(archive, 42, NOW)).toEqual(buildRecallRound(archive, 42, NOW));
  });
});

describe('Recall has no side effects', () => {
  it('never changes the archive, the taste model or recommendations', () => {
    const archive = [
      title(1, 'COMPLETED', 2012, 'SPRING', { userReaction: 'LOVE', userNote: 'note' }),
      title(2, 'COMPLETED', 2016, 'FALL', { userReaction: 'HATE' }),
      title(3, 'PLAN', 2018),
    ];
    const snapshot = JSON.stringify(archive);
    const tasteBefore = JSON.stringify(buildTasteModel(archive, NOW));
    const recsBefore = JSON.stringify(buildRecommendations(archive, null, []));

    for (const question of buildRecallRound(archive, 5, NOW)) {
      question.options.forEach((option) => isCorrectAnswer(question, option));
    }

    expect(JSON.stringify(archive)).toBe(snapshot);
    expect(JSON.stringify(buildTasteModel(archive, NOW))).toBe(tasteBefore);
    expect(JSON.stringify(buildRecommendations(archive, null, []))).toBe(recsBefore);
  });
});
