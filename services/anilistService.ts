import {
  anilistEnvelopeSchema,
  collectValid,
  normalizeAnimeRecord,
  parseAnimeList,
  recommendationNodeSchema,
} from '../shared/schemas/anime';
import { z } from 'zod';
import { Anime, Season } from '../types';

const API_URL = 'https://graphql.anilist.co';
type DataMode = 'remote' | 'local' | 'local-strict';
type GraphqlVariables = Record<string, unknown>;

const configuredDataMode = import.meta.env.VITE_DATA_MODE;
const DATA_MODE: DataMode =
  configuredDataMode === 'local' || configuredDataMode === 'local-strict' ? configuredDataMode : 'remote';
const LOCAL_DATA_BASE = import.meta.env.VITE_LOCAL_DATA_BASE || '/data';

/** Per-attempt AniList request timeout. A timeout is retried like a network failure, never "no results". */
export const ANILIST_REQUEST_TIMEOUT_MS = 20_000;

export class AniListTimeoutError extends Error {
  constructor() {
    super('AniList request timed out');
    this.name = 'AniListTimeoutError';
  }
}

const CONFIG = {
  RETRY_DELAY: 60_000,
  MAX_RETRIES: 3,
  CACHE_TTL: 10 * 60_000,
  CACHE_MAX_ENTRIES: 120,
};

/**
 * A season is loaded as a whole: membership is decided only by season/year/format filters,
 * never by score, so unscored new titles and the long tail stay discoverable. Pages are read
 * sequentially (a season is typically 1–2 pages) and capped to bound the request count.
 */
export const SEASON_PAGE_SIZE = 50;
export const MAX_SEASON_PAGES = 6;

interface CacheEntry {
  data: Anime[];
  expiresAt: number;
}

const animeCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<Anime[]>>();

/** Catalogue failure that the UI can explain; translated as `feedback.<code>`. */
export class CatalogueError extends Error {
  readonly code: 'strictLocalMissing';
  readonly year: number;

  constructor(year: number, options?: { cause?: unknown }) {
    super(`Strict local mode has no data for ${year}`, options);
    this.name = 'CatalogueError';
    this.code = 'strictLocalMissing';
    this.year = year;
  }
}

class NonRetryableAniListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableAniListError';
  }
}

const QUERY = `
query ($year: Int, $season: MediaSeason, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(
      season: $season
      seasonYear: $year
      type: ANIME
      countryOfOrigin: JP
      isAdult: false
      sort: [POPULARITY_DESC, ID]
      format_in: [TV,TV_SHORT, MOVIE, OVA, ONA]
    ) {
      id
      title { romaji english native }
      coverImage { extraLarge large color }
      bannerImage
      description(asHtml: false)
      format
      season
      seasonYear
      genres
      averageScore
      popularity
      status
      episodes
      duration
      studios(isMain: true) { nodes { name } }
      nextAiringEpisode { airingAt timeUntilAiring episode }
    }
  }
}
`;

const SEARCH_QUERY = `
query ($search: String!, $year: Int, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(
      search: $search
      seasonYear: $year
      type: ANIME
      countryOfOrigin: JP
      isAdult: false
      sort: [SEARCH_MATCH, POPULARITY_DESC]
      format_in: [TV,TV_SHORT,MOVIE,OVA,ONA]
    ) {
      id
      title { romaji english native }
      coverImage { extraLarge large color }
      bannerImage
      description(asHtml: false)
      format
      season
      seasonYear
      genres
      averageScore
      popularity
      status
      episodes
      duration
      studios(isMain: true) { nodes { name } }
      nextAiringEpisode { airingAt timeUntilAiring episode }
    }
  }
}
`;

const ARCHIVE_RECOMMENDATION_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      title { romaji english native }
      genres
      recommendations(page: 1, perPage: 8) {
        nodes {
          rating
          mediaRecommendation {
            id
            title { romaji english native }
            coverImage { extraLarge large color }
            bannerImage
            description(asHtml: false)
            format
            season
            seasonYear
            genres
            averageScore
            popularity
            status
            episodes
            duration
            studios(isMain: true) { nodes { name } }
            relations { edges { relationType node { id } } }
          }
        }
      }
    }
  }
}
`;

export const MAX_ARCHIVE_RECOMMENDATION_SOURCES = 60;
const ARCHIVE_RECOMMENDATION_BATCH_SIZE = 20;

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, ms);
    if (!signal) return;
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException('The request was aborted', 'AbortError'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });

/**
 * One AniList request (including reading the body) bounded by ANILIST_REQUEST_TIMEOUT_MS. The
 * caller's signal still cancels it; only our own timer turns into an AniListTimeoutError.
 */
const requestOnce = async (query: string, variables: GraphqlVariables, signal?: AbortSignal) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ANILIST_REQUEST_TIMEOUT_MS);
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const json: unknown = response.ok ? await response.json() : undefined;
    return { response, json };
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new AniListTimeoutError();
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
};

async function fetchWithRetry(
  variables: GraphqlVariables,
  retries = 0,
  query = QUERY,
  signal?: AbortSignal
): Promise<unknown> {
  try {
    const { response, json } = await requestOnce(query, variables, signal);

    if (response.status === 429) {
      if (retries >= CONFIG.MAX_RETRIES) throw new Error('AniList rate limit exceeded');
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') || '60', 10);
      await delay(Math.max(retryAfter * 1000, CONFIG.RETRY_DELAY), signal);
      return fetchWithRetry(variables, retries + 1, query, signal);
    }

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        throw new NonRetryableAniListError(`AniList API error: ${response.status}`);
      }
      throw new Error(`AniList API error: ${response.status}`);
    }
    // Only the envelope is validated here; items are validated one by one by the readers.
    const parsed = anilistEnvelopeSchema.safeParse(json);
    if (!parsed.success) throw new NonRetryableAniListError('AniList response schema validation failed');
    if (parsed.data.errors?.length) throw new NonRetryableAniListError('AniList GraphQL request failed');
    return parsed.data;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (error instanceof NonRetryableAniListError) throw error;
    if (retries >= CONFIG.MAX_RETRIES) throw error;
    await delay(2_000, signal);
    return fetchWithRetry(variables, retries + 1, query, signal);
  }
}

/** Nothing usable at all is schema drift, not a partial page: fail instead of showing an empty result. */
const requireSomeValid = <T>(result: { valid: T[]; rejected: number }) => {
  if (!result.valid.length && result.rejected > 0) {
    throw new NonRetryableAniListError('AniList response schema validation failed');
  }
  return result;
};

const warnRejected = (what: string, rejected: number) => {
  if (!rejected) return;
  // eslint-disable-next-line no-console -- diagnostic for partially malformed AniList responses
  console.warn(`[AniList] Skipped ${rejected} malformed ${what}.`);
};

/** Season page records; a malformed record is skipped and counted, its valid siblings are kept. */
export const readPageMedia = (payload: unknown): Anime[] => {
  const { valid, rejected } = requireSomeValid(
    collectValid(anilistEnvelopeSchema.parse(payload).data?.Page?.media || [], (item) => normalizeAnimeRecord(item))
  );
  warnRejected('catalogue record(s)', rejected);
  return valid;
};

const readHasNextPage = (payload: unknown) =>
  Boolean(anilistEnvelopeSchema.parse(payload).data?.Page?.pageInfo?.hasNextPage);

const getCached = (key: string) => {
  const entry = animeCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    animeCache.delete(key);
    return undefined;
  }
  return entry.data;
};

const setCached = (key: string, data: Anime[]) => {
  if (animeCache.size >= CONFIG.CACHE_MAX_ENTRIES) {
    const oldestKey = animeCache.keys().next().value;
    if (oldestKey) animeCache.delete(oldestKey);
  }
  animeCache.set(key, { data, expiresAt: Date.now() + CONFIG.CACHE_TTL });
};

export const buildAnimeCacheKey = (kind: 'season' | 'search', ...parts: Array<string | number>) =>
  `${kind}:${DATA_MODE}:${parts.join(':')}`;

async function fetchLocalBySeason(year: number, season: Season, signal?: AbortSignal): Promise<Anime[]> {
  try {
    const res = await fetch(`${LOCAL_DATA_BASE}/anime-${year}.json`, { signal });
    if (!res.ok) throw new Error(`Local data missing for ${year}`);
    const data: unknown = await res.json();
    return parseAnimeList(data).filter((anime) => anime.season === season);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (DATA_MODE === 'local-strict') throw new CatalogueError(year, { cause: error });
    return fetchRemoteBySeason(year, season, signal);
  }
}

async function fetchRemoteBySeason(year: number, season: Season, signal?: AbortSignal): Promise<Anime[]> {
  const seen = new Set<string>();
  const anime: Anime[] = [];
  for (let page = 1; page <= MAX_SEASON_PAGES; page += 1) {
    const payload = await fetchWithRetry({ year, season, page, perPage: SEASON_PAGE_SIZE }, 0, QUERY, signal);
    readPageMedia(payload).forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      anime.push(item);
    });
    if (!readHasNextPage(payload)) break;
  }
  return anime;
}

export const fetchAnimeBySeason = async (year: number, season: Season, signal?: AbortSignal): Promise<Anime[]> => {
  const cacheKey = buildAnimeCacheKey('season', year, season);
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const pending = inFlightRequests.get(cacheKey);
  if (pending) return pending;

  const loader = DATA_MODE === 'remote' ? fetchRemoteBySeason : fetchLocalBySeason;
  const request = loader(year, season, signal)
    .then((data) => {
      setCached(cacheKey, data);
      return data;
    })
    .finally(() => {
      if (inFlightRequests.get(cacheKey) === request) inFlightRequests.delete(cacheKey);
    });
  inFlightRequests.set(cacheKey, request);
  return request;
};

export const fetchAnimeByYear = async (year: number, signal?: AbortSignal): Promise<Anime[]> => {
  const seasons: Season[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const results = await Promise.all(seasons.map((season) => fetchAnimeBySeason(year, season, signal)));
  return results.flat();
};

export const searchAnime = async (
  search: string,
  year?: number,
  perPage: number = 16,
  signal?: AbortSignal
): Promise<Anime[]> => {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) return [];

  const cacheKey = buildAnimeCacheKey('search', normalizedSearch.toLocaleLowerCase(), year || 'all', perPage);
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const pending = inFlightRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    if (DATA_MODE !== 'remote' && year) {
      try {
        const local = await fetch(`${LOCAL_DATA_BASE}/anime-${year}.json`, { signal });
        if (local.ok) {
          const entries = parseAnimeList(await local.json())
            .filter((item) =>
              [item.title.native, item.title.romaji, item.title.english]
                .filter(Boolean)
                .join(' ')
                .toLocaleLowerCase()
                .includes(normalizedSearch.toLocaleLowerCase())
            )
            .slice(0, perPage);
          setCached(cacheKey, entries);
          return entries;
        }
        if (DATA_MODE === 'local-strict') throw new CatalogueError(year);
      } catch (error) {
        if (signal?.aborted || DATA_MODE === 'local-strict') throw error;
      }
    }

    const payload = await fetchWithRetry(
      { search: normalizedSearch, year: year || null, page: 1, perPage },
      0,
      SEARCH_QUERY,
      signal
    );
    const entries = readPageMedia(payload);
    setCached(cacheKey, entries);
    return entries;
  })().finally(() => {
    if (inFlightRequests.get(cacheKey) === request) inFlightRequests.delete(cacheKey);
  });
  inFlightRequests.set(cacheKey, request);
  return request;
};

/** Prequel/parent relations of a candidate, used to avoid recommending a later entry out of context. */
const relationEdgesSchema = z
  .object({
    edges: z
      .array(
        z
          .object({
            relationType: z.string().max(40).nullish(),
            node: z.object({ id: z.coerce.number().int().positive() }).passthrough().nullish(),
          })
          .passthrough()
      )
      .max(100)
      .nullish(),
  })
  .passthrough()
  .nullish();

const CONTINUATION_RELATIONS = new Set(['PREQUEL', 'PARENT']);

/** One AniList "users also recommend" edge from a source title in the archive to a candidate. */
export interface RecommendationGraphLink {
  /** AniList community vote count for this recommendation edge. */
  rating: number;
  anime: Anime;
  /** IDs this candidate continues (its PREQUEL / PARENT relations). */
  continues: string[];
}

export interface RecommendationGraphNode {
  sourceId: string;
  links: RecommendationGraphLink[];
}

export interface RecommendationGraph {
  nodes: RecommendationGraphNode[];
  /** True when at least one batch failed; such a graph is never cached. */
  incomplete: boolean;
  /** Malformed sources or edges that were skipped (their valid siblings are kept). */
  rejected?: number;
}

const graphCache = new Map<string, { graph: RecommendationGraph; expiresAt: number }>();

const splitIntoBatches = <T>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
};

const graphSourceSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    recommendations: z
      .object({ nodes: z.array(z.unknown()).max(100) })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const readGraphLink = (value: unknown): RecommendationGraphLink | null => {
  const node = recommendationNodeSchema.parse(value);
  // Skip edges the AniList community has voted down (net rating below zero).
  if (!node.mediaRecommendation || (node.rating ?? 0) < 0) return null;
  const relations = relationEdgesSchema.safeParse((node.mediaRecommendation as { relations?: unknown }).relations);
  const continues = relations.success
    ? (relations.data?.edges || [])
        .filter((edge) => edge.node && CONTINUATION_RELATIONS.has(edge.relationType || ''))
        .map((edge) => String(edge.node!.id))
    : [];
  return { rating: node.rating || 0, anime: normalizeAnimeRecord(node.mediaRecommendation), continues };
};

/**
 * Graph nodes from one response. A malformed source or edge is skipped and counted; its valid siblings
 * are kept (before B4, one bad edge failed all 20 sources in the request).
 */
export const readGraphNodes = (payload: unknown): { nodes: RecommendationGraphNode[]; rejected: number } => {
  const sources = requireSomeValid(
    collectValid(anilistEnvelopeSchema.parse(payload).data?.Page?.media || [], (item) => graphSourceSchema.parse(item))
  );
  let rejected = sources.rejected;
  const nodes = sources.valid.map((media) => {
    const links = collectValid(media.recommendations?.nodes || [], readGraphLink);
    rejected += links.rejected;
    return {
      sourceId: String(media.id),
      links: links.valid.filter((link): link is RecommendationGraphLink => link !== null),
    };
  });
  return { nodes, rejected };
};

/**
 * Fetches AniList recommendation edges for the given source titles. This is candidate data only:
 * it does no ranking. Source IDs are sorted and de-duplicated so the same set always produces the
 * same requests, nodes are returned in source-ID order, and complete results are cached, so reopening
 * recommendations with unchanged sources reuses exactly the same graph.
 */
export const fetchRecommendationGraph = async (
  sourceIds: string[],
  signal?: AbortSignal
): Promise<RecommendationGraph> => {
  const ids = Array.from(new Set(sourceIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))).sort(
    (left, right) => left - right
  );
  if (!ids.length) return { nodes: [], incomplete: false };
  const key = ids.join(',');
  const cached = graphCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.graph;

  const settled = await Promise.allSettled(
    splitIntoBatches(ids, ARCHIVE_RECOMMENDATION_BATCH_SIZE).map((batch) =>
      fetchWithRetry({ ids: batch }, 0, ARCHIVE_RECOMMENDATION_QUERY, signal).then(readGraphNodes)
    )
  );
  if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
  const read = settled
    .filter(
      (result): result is PromiseFulfilledResult<ReturnType<typeof readGraphNodes>> => result.status === 'fulfilled'
    )
    .map((result) => result.value);
  if (!read.length) {
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw firstFailure?.reason instanceof Error
      ? firstFailure.reason
      : new Error('AniList recommendation request failed');
  }
  const rejected = read.reduce((sum, item) => sum + item.rejected, 0);
  warnRejected('recommendation source(s) or edge(s)', rejected);
  const nodes = read
    .flatMap((item) => item.nodes)
    .sort((left, right) => Number(left.sourceId) - Number(right.sourceId));
  const graph = { nodes, incomplete: read.length < settled.length, rejected };
  if (!graph.incomplete) graphCache.set(key, { graph, expiresAt: Date.now() + CONFIG.CACHE_TTL });
  return graph;
};

export const clearAnimeCache = () => {
  animeCache.clear();
  graphCache.clear();
  inFlightRequests.clear();
};
