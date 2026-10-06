import { z } from 'zod';
import { Anime, Season, UserAnimeReaction, UserAnimeStatus } from '../../types';
import { normalizeUserHistory } from './history';

export const seasonSchema = z.enum(['WINTER', 'SPRING', 'SUMMER', 'FALL']);
export const userAnimeStatusSchema = z.enum(['PLAN', 'WATCHING', 'COMPLETED']);
export const userAnimeReactionSchema = z.enum(['LOVE', 'LIKE', 'NEUTRAL', 'DISLIKE', 'HATE']);

const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess(
    (value) => (value === null || value === undefined || value === '' ? undefined : value),
    schema.optional()
  );

const boundedString = (max: number) => z.string().max(max);

export const animeRecordSchema = z
  .object({
    id: z
      .union([z.string().trim().min(1).max(32), z.number().int().positive().max(2_000_000_000)])
      .transform(String)
      .refine((value) => /^\d{1,32}$/.test(value), 'Anime IDs must be numeric'),
    title: z
      .object({
        romaji: boundedString(255).nullish(),
        english: boundedString(255).nullish(),
        native: boundedString(255).nullish(),
      })
      .nullish(),
    coverImage: z
      .object({
        extraLarge: boundedString(2048).nullish(),
        large: boundedString(2048).nullish(),
        color: boundedString(32).nullish(),
      })
      .nullish(),
    bannerImage: boundedString(2048).nullish(),
    description: boundedString(20_000).nullish(),
    season: seasonSchema.nullish(),
    seasonYear: optionalNumber(z.coerce.number().int().min(1900).max(2200)),
    genres: z.array(boundedString(80)).max(30).nullish(),
    averageScore: optionalNumber(z.coerce.number().int().min(0).max(100)),
    popularity: optionalNumber(z.coerce.number().int().min(0).max(10_000_000)),
    format: boundedString(40).nullish(),
    status: boundedString(40).nullish(),
    episodes: optionalNumber(z.coerce.number().int().min(0).max(10_000)),
    duration: optionalNumber(z.coerce.number().int().min(0).max(10_000)),
    studios: z
      .union([
        z.array(boundedString(160)).max(50),
        z.object({ nodes: z.array(z.object({ name: boundedString(160) }).passthrough()).max(50) }).passthrough(),
      ])
      .nullish(),
    nextAiringEpisode: z
      .object({
        airingAt: z.coerce.number().int(),
        timeUntilAiring: z.coerce.number().int(),
        episode: z.coerce.number().int().min(0),
      })
      .passthrough()
      .nullish(),
    userStatus: userAnimeStatusSchema.nullish(),
    userReaction: userAnimeReactionSchema.nullish(),
    userNote: boundedString(280).nullish(),
    // Validated field by field in normalizeUserHistory so one bad date never discards a record.
    userHistory: z.unknown().optional(),
  })
  .passthrough();

export type AnimeRecord = z.infer<typeof animeRecordSchema>;

export const recommendationNodeSchema = z
  .object({
    // Net community votes; AniList returns negative values for down-voted recommendations.
    rating: optionalNumber(z.coerce.number().int()),
    mediaRecommendation: animeRecordSchema.nullish(),
  })
  .passthrough();

const asTitle = (title: AnimeRecord['title']) => ({
  romaji: title?.romaji || '',
  english: title?.english || '',
  native: title?.native || '',
});

const asCover = (cover: AnimeRecord['coverImage']) => ({
  extraLarge: cover?.extraLarge || '',
  large: cover?.large || cover?.extraLarge || '',
  color: cover?.color || '',
});

const asStudios = (studios: AnimeRecord['studios']) => {
  if (Array.isArray(studios)) return studios;
  return studios?.nodes.map((studio) => studio.name) || [];
};

export const normalizeAnimeRecord = (value: unknown): Anime => {
  const record = animeRecordSchema.parse(value);
  const season: Season = seasonSchema.safeParse(record.season).success ? (record.season as Season) : 'WINTER';
  const userStatus: UserAnimeStatus = userAnimeStatusSchema.safeParse(record.userStatus).success
    ? (record.userStatus as UserAnimeStatus)
    : 'PLAN';
  // A missing reaction stays missing: "no reaction recorded" is not the same as an explicit NEUTRAL.
  const userReaction: UserAnimeReaction | undefined = userAnimeReactionSchema.safeParse(record.userReaction).success
    ? (record.userReaction as UserAnimeReaction)
    : undefined;

  return {
    id: record.id,
    title: asTitle(record.title),
    coverImage: asCover(record.coverImage),
    bannerImage: record.bannerImage || undefined,
    description: record.description || undefined,
    season,
    seasonYear: record.seasonYear || 2000,
    genres: record.genres || [],
    averageScore: record.averageScore ?? undefined,
    popularity: record.popularity ?? undefined,
    format: record.format || undefined,
    status: record.status || undefined,
    episodes: record.episodes ?? undefined,
    duration: record.duration ?? undefined,
    studios: asStudios(record.studios),
    nextAiringEpisode: record.nextAiringEpisode || undefined,
    userStatus,
    ...(userReaction ? { userReaction } : {}),
    userNote: record.userNote?.trim() || undefined,
    // Catalogue records have no history; archive records always carry one (see normalizeArchiveEntry).
    ...(record.userHistory !== undefined && record.userHistory !== null
      ? { userHistory: normalizeUserHistory(record.userHistory) }
      : {}),
  };
};

export const parseAnimeList = (value: unknown): Anime[] => {
  const records = z.array(animeRecordSchema).max(5_000).parse(value);
  return records.map(normalizeAnimeRecord);
};

/**
 * AniList response envelope with items left unvalidated. Network responses are validated item by
 * item (see `collectValid`), so one malformed record or edge can't discard an otherwise usable page.
 */
export const anilistEnvelopeSchema = z
  .object({
    data: z
      .object({
        Page: z
          .object({
            pageInfo: z.object({ hasNextPage: z.boolean().nullish() }).passthrough().nullish(),
            media: z.array(z.unknown()).max(100).nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
    errors: z
      .array(z.object({ message: boundedString(500).nullish() }).passthrough())
      .max(20)
      .nullish(),
  })
  .passthrough();

/** Keeps the items that pass `parse` and counts the rest. */
export const collectValid = <T>(items: unknown[], parse: (item: unknown) => T): { valid: T[]; rejected: number } => {
  const valid: T[] = [];
  let rejected = 0;
  items.forEach((item) => {
    try {
      valid.push(parse(item));
    } catch {
      rejected += 1;
    }
  });
  return { valid, rejected };
};
