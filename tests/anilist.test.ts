import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAnimeCacheKey,
  clearAnimeCache,
  fetchAnimeBySeason,
  fetchRecommendationGraph,
  MAX_SEASON_PAGES,
} from '../services/anilistService';

const payload = {
  data: {
    Page: {
      media: [
        {
          id: 501,
          title: { native: '缓存测试', romaji: 'Cache Test', english: null },
          coverImage: { extraLarge: null, large: 'https://example.com/cache.jpg', color: null },
          season: 'WINTER',
          seasonYear: 2024,
          genres: ['Drama'],
        },
      ],
    },
  },
};

const recommendationFor = (sourceId: number) => ({
  id: sourceId,
  title: { native: `来源 ${sourceId}`, romaji: `Source ${sourceId}`, english: null },
  genres: ['Drama'],
  recommendations: {
    nodes: [
      {
        rating: 10,
        mediaRecommendation: {
          id: 900_000 + sourceId,
          title: { native: `推荐 ${sourceId}`, romaji: `Recommendation ${sourceId}`, english: null },
          coverImage: { extraLarge: null, large: 'https://example.com/recommendation.jpg', color: null },
          season: 'SPRING',
          seasonYear: 2025,
          genres: ['Drama'],
          averageScore: 85,
          popularity: 500,
          format: 'TV',
          status: 'FINISHED',
          relations: {
            edges: [
              { relationType: 'PREQUEL', node: { id: 42 } },
              { relationType: 'ADAPTATION', node: { id: 43 } },
            ],
          },
        },
      },
    ],
  },
});

describe('AniList catalogue service', () => {
  beforeEach(() => {
    clearAnimeCache();
    vi.restoreAllMocks();
  });

  it('uses a stable mode-aware cache key', () => {
    expect(buildAnimeCacheKey('season', 2024, 'WINTER')).toBe('season:remote:2024:WINTER');
  });

  it('deduplicates concurrent season requests and validates the response', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      );

    const first = fetchAnimeBySeason(2024, 'WINTER');
    const second = fetchAnimeBySeason(2024, 'WINTER');
    const [left, right] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(left).toEqual(right);
    expect(left[0]).toMatchObject({ id: '501', title: { native: '缓存测试' } });
  });

  it('rejects malformed upstream data instead of passing it to the UI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { Page: { media: [{ id: 'broken' }] } } }), { status: 200 })
    );

    await expect(fetchAnimeBySeason(2024, 'SPRING')).rejects.toThrow('schema validation');
  });

  it('loads every page of a season so unscored and low-ranked titles stay discoverable', async () => {
    const scored = Array.from({ length: 50 }, (_, index) => ({
      ...payload.data.Page.media[0],
      id: 1_000 + index,
      averageScore: 90 - (index % 30),
      popularity: 100_000 - index,
    }));
    const unscored = {
      ...payload.data.Page.media[0],
      id: 2_000,
      title: { native: '还没有评分的新番', romaji: 'Brand New', english: null },
      averageScore: null,
      popularity: 12,
    };
    const requests: Array<{ query: string; variables: { page: number; perPage: number } }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      requests.push(body);
      const page = body.variables.page;
      const media = page === 1 ? scored : [unscored];
      return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: page === 1 }, media } } }), {
        status: 200,
      });
    });

    const season = await fetchAnimeBySeason(2026, 'FALL');

    expect(requests.map((request) => request.variables.page)).toEqual([1, 2]);
    expect(season).toHaveLength(51);
    expect(season.find((item) => item.id === '2000')).toMatchObject({ averageScore: undefined });
    // Score may reorder the list in the UI, but it must not decide which titles are fetched.
    expect(requests[0].query).not.toContain('SCORE_DESC');
  });

  it('caps season pagination to bound the number of AniList requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const page = JSON.parse(String(init?.body || '{}')).variables.page;
      return new Response(
        JSON.stringify({
          data: { Page: { pageInfo: { hasNextPage: true }, media: [{ ...payload.data.Page.media[0], id: page }] } },
        }),
        { status: 200 }
      );
    });

    const season = await fetchAnimeBySeason(2026, 'SUMMER');

    expect(fetchMock).toHaveBeenCalledTimes(MAX_SEASON_PAGES);
    expect(season).toHaveLength(MAX_SEASON_PAGES);
  });

  const graphResponder = (fail?: (ids: number[]) => boolean) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body || '{}')) as { variables?: { ids?: number[] } };
      const ids = requestBody.variables?.ids || [];
      if (fail?.(ids)) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ data: { Page: { media: [...ids].reverse().map(recommendationFor) } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

  it('fetches the recommendation graph in sorted batches and returns nodes in source order', async () => {
    const fetchMock = graphResponder();
    const ids = Array.from({ length: 21 }, (_, index) => String(21 - index));

    const graph = await fetchRecommendationGraph([...ids, '3']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBatch = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).variables.ids;
    expect(firstBatch).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(graph.incomplete).toBe(false);
    expect(graph.nodes.map((node) => node.sourceId)).toEqual(
      Array.from({ length: 21 }, (_, index) => String(index + 1))
    );
    // Only prequel/parent relations count as "continues".
    expect(graph.nodes[0].links[0]).toMatchObject({ rating: 10, continues: ['42'] });
    expect(graph.nodes[0].links[0].anime.title.native).toBe('推荐 1');
  });

  it('reuses a complete graph for the same sources, in any order', async () => {
    const fetchMock = graphResponder();
    const first = await fetchRecommendationGraph(['2', '1']);
    const second = await fetchRecommendationGraph(['1', '2', '2']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('accepts down-voted edges from AniList but does not use them as links', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Page: {
              media: [
                {
                  ...recommendationFor(1),
                  recommendations: {
                    nodes: [
                      { ...recommendationFor(1).recommendations.nodes[0], rating: -3 },
                      ...recommendationFor(2).recommendations.nodes,
                    ],
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const graph = await fetchRecommendationGraph(['1']);
    expect(graph.incomplete).toBe(false);
    expect(graph.nodes[0].links.map((link) => link.anime.id)).toEqual(['900002']);
  });

  it('keeps valid recommendation edges and sources when one item in the batch is malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const good = recommendationFor(1);
    const brokenEdge = { rating: 4, mediaRecommendation: { id: 'not-a-number', title: 42 } };
    const brokenSource = { id: -5, recommendations: { nodes: [] } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Page: {
              media: [
                { ...good, recommendations: { nodes: [...good.recommendations.nodes, brokenEdge] } },
                brokenSource,
                recommendationFor(2),
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const graph = await fetchRecommendationGraph(['1', '2']);
    expect(graph.incomplete).toBe(false);
    expect(graph.rejected).toBe(2);
    expect(graph.nodes.map((node) => [node.sourceId, node.links.length])).toEqual([
      ['1', 1],
      ['2', 1],
    ]);
    expect(warn).toHaveBeenCalledWith('[AniList] Skipped 2 malformed recommendation source(s) or edge(s).');
  });

  it('treats a batch with no valid source as failed, keeping the other batches', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const ids = (JSON.parse(String(init?.body || '{}')) as { variables: { ids: number[] } }).variables.ids;
      const media = ids.includes(21) ? [{ id: 'broken' }] : ids.map(recommendationFor);
      return new Response(JSON.stringify({ data: { Page: { media } } }), { status: 200 });
    });
    const graph = await fetchRecommendationGraph(Array.from({ length: 21 }, (_, index) => String(index + 1)));
    expect(graph.incomplete).toBe(true);
    expect(graph.nodes).toHaveLength(20);
  });

  it('keeps the valid titles of a season page when one record is malformed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const valid = payload.data.Page.media[0];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Page: {
              pageInfo: { hasNextPage: false },
              media: [valid, { id: 'broken', title: null }, { ...valid, id: 502 }],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const season = await fetchAnimeBySeason(2024, 'WINTER');
    expect(season.map((anime) => anime.id)).toEqual(['501', '502']);
  });

  it('can be cancelled when the dialog closes', async () => {
    graphResponder();
    const controller = new AbortController();
    controller.abort();
    await expect(fetchRecommendationGraph(['1'], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('marks a partially failed graph as incomplete and does not cache it', async () => {
    const fetchMock = graphResponder((ids) => ids.includes(21));
    const ids = Array.from({ length: 21 }, (_, index) => String(index + 1));

    const graph = await fetchRecommendationGraph(ids);
    expect(graph.incomplete).toBe(true);
    expect(graph.nodes).toHaveLength(20);
    await fetchRecommendationGraph(ids);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
