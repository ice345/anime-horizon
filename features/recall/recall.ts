import { Anime, Season } from '../../types';

/**
 * Recall: a small memory quiz over anime the user has completed ("When did it air?").
 *
 * - Only COMPLETED titles are used: they are the user's own viewing memories. WATCHING titles are still
 *   in progress and PLAN titles were never watched.
 * - Everything here is pure and read-only. Answers are never stored and never touch the archive,
 *   history, the taste model or recommendations.
 * - No AI is involved: questions, options and correctness come from catalogue metadata.
 * See docs/recall.md.
 */
export interface SeasonSlot {
  year: number;
  season: Season;
}

export interface RecallQuestion {
  anime: Anime;
  answer: SeasonSlot;
  /** Four options in chronological order, one of which is `answer`. */
  options: SeasonSlot[];
}

export const RECALL_ROUND_LENGTH = 5;
/** A title must have aired at least this many seasons ago, so options can fall after it as well. */
export const MIN_SEASONS_SINCE_AIRING = 4;
const OPTION_COUNT = 4;
const MIN_GAP = 2;
const MAX_GAP = 6;
const EARLIEST_YEAR = 1917;
const SEASONS: Season[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

export const slotIndex = ({ year, season }: SeasonSlot) => year * 4 + SEASONS.indexOf(season);
const slotAt = (index: number): SeasonSlot => ({ year: Math.floor(index / 4), season: SEASONS[index % 4] });
export const slotId = (slot: SeasonSlot) => `${slot.year}-${slot.season}`;

/** The AniList season containing a date (WINTER = Jan–Mar, SPRING = Apr–Jun, …). */
export const currentSlot = (now: Date): SeasonSlot => ({
  year: now.getFullYear(),
  season: SEASONS[Math.floor(now.getMonth() / 3)],
});

/** Small deterministic PRNG (mulberry32), so a seed always produces the same round. */
export const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const releaseSlot = (anime: Anime): SeasonSlot | null =>
  Number.isInteger(anime.seasonYear) && anime.seasonYear >= EARLIEST_YEAR && SEASONS.includes(anime.season)
    ? { year: anime.seasonYear, season: anime.season }
    : null;

export const isRecallEligible = (anime: Anime, now: Date) => {
  const slot = releaseSlot(anime);
  return (
    anime.userStatus === 'COMPLETED' &&
    slot !== null &&
    slotIndex(slot) <= slotIndex(currentSlot(now)) - MIN_SEASONS_SINCE_AIRING
  );
};

export const eligibleRecallTitles = (archive: Anime[], now: Date) =>
  archive.filter((anime) => isRecallEligible(anime, now));

/**
 * Builds four options around the actual release season, never around today's date. The number of
 * options placed before the answer is random (0–3), with gaps of 2–6 seasons between neighbours, so
 * the answer is not reliably the newest, oldest or most "current-looking" choice. Options never fall
 * in the future or before 1917.
 */
export const buildSeasonOptions = (answer: SeasonSlot, random: () => number, now: Date): SeasonSlot[] => {
  const answerIndex = slotIndex(answer);
  const latest = slotIndex(currentSlot(now));
  const earliest = EARLIEST_YEAR * 4;
  const gap = () => MIN_GAP + Math.floor(random() * (MAX_GAP - MIN_GAP + 1));
  let before = Math.floor(random() * OPTION_COUNT);
  const indexes = new Set([answerIndex]);
  let cursor = answerIndex;
  for (let after = OPTION_COUNT - 1 - before; after > 0; after -= 1) {
    const next = cursor + gap();
    if (next > latest) {
      before += after;
      break;
    }
    indexes.add(next);
    cursor = next;
  }
  cursor = answerIndex;
  for (; before > 0; before -= 1) {
    const next = cursor - gap();
    if (next < earliest) break;
    indexes.add(next);
    cursor = next;
  }
  // Rare edge: not enough room on either side (very old title, very recent cut-off). Fill the
  // nearest free seasons that are still in range.
  for (let distance = 1; indexes.size < OPTION_COUNT && distance < 400; distance += 1) {
    for (const candidate of [answerIndex - distance, answerIndex + distance]) {
      if (indexes.size < OPTION_COUNT && candidate >= earliest && candidate <= latest) indexes.add(candidate);
    }
  }
  return [...indexes].sort((left, right) => left - right).map(slotAt);
};

/**
 * One round: up to RECALL_ROUND_LENGTH distinct eligible titles in a seeded order. Titles from the
 * previous round (`recentIds`) go to the back, so playing again doesn't repeat them immediately.
 */
export const buildRecallRound = (
  archive: Anime[],
  seed: number,
  now: Date,
  recentIds: string[] = [],
  length = RECALL_ROUND_LENGTH
): RecallQuestion[] => {
  const random = createRandom(seed);
  const pool = eligibleRecallTitles(archive, now)
    .map((anime) => ({ anime, order: random() }))
    .sort((left, right) => left.order - right.order || String(left.anime.id).localeCompare(String(right.anime.id)))
    .map(({ anime }) => anime);
  const recent = new Set(recentIds);
  const ordered = [
    ...pool.filter((anime) => !recent.has(String(anime.id))),
    ...pool.filter((anime) => recent.has(String(anime.id))),
  ];
  return ordered.slice(0, length).map((anime) => {
    const answer = releaseSlot(anime)!;
    return { anime, answer, options: buildSeasonOptions(answer, random, now) };
  });
};

export const isCorrectAnswer = (question: RecallQuestion, choice: SeasonSlot) =>
  slotIndex(choice) === slotIndex(question.answer);
