import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';
const SCHEMA_KEY = 'anime-horizon-archive-schema';

const media = (id: number, genres: string[], extra: object = {}) => ({
  id,
  title: { native: '', romaji: `Show ${id}`, english: null },
  coverImage: { extraLarge: null, large: '', color: null },
  season: 'SPRING',
  seasonYear: 2016,
  genres,
  format: 'TV',
  popularity: 60_000 + id,
  status: 'FINISHED',
  ...extra,
});

const mine = (id: number, status: string, reaction: string | null, genres: string[]) => ({
  ...media(id, genres),
  id: String(id),
  coverImage: { extraLarge: '', large: '', color: '' },
  userStatus: status,
  ...(reaction ? { userReaction: reaction } : {}),
  userHistory: { addedAt: null, startedAt: null, completedAt: null, updatedAt: null },
});

const archive = [
  ...[1, 2, 3, 4, 5].map((id) => mine(id, 'COMPLETED', id === 1 ? 'LOVE' : 'LIKE', ['Music', 'Drama'])),
  ...[10, 11, 12].map((id) => mine(id, 'COMPLETED', 'HATE', ['Horror'])),
];
const candidates = Array.from({ length: 9 }, (_, index) =>
  media(100 + index, index === 4 ? ['Drama', 'Horror'] : ['Drama'], index === 8 ? { seasonYear: 1994 } : {})
);

/** Answers the seasonal query with a small catalogue and the recommendation query with a fixed graph. */
const mockAniList = (page: Page) =>
  page.route(ANILIST, async (route) => {
    const body = route.request().postDataJSON() as { query: string; variables?: { ids?: number[] } };
    if (body.query.includes('recommendations(')) {
      const ids = body.variables?.ids || [];
      const nodes = ids.map((id) => ({
        id,
        title: { romaji: `Show ${id}`, english: null, native: null },
        genres: ['Drama'],
        recommendations: {
          nodes: candidates.map((candidate, index) => ({
            rating: id === 1 ? 90 - index : 5,
            mediaRecommendation: candidate,
          })),
        },
      }));
      return route.fulfill({ json: { data: { Page: { media: nodes } } } });
    }
    return route.fulfill({
      json: {
        data: { Page: { pageInfo: { hasNextPage: false }, media: [media(900, ['Action'], { status: 'RELEASING' })] } },
      },
    });
  });

const seed = (page: Page, details: unknown[]) =>
  page.addInitScript(
    ({ value, key, schemaKey }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem(schemaKey, '5');
      localStorage.setItem('e2e-seeded', '1');
    },
    { value: details, key: DETAILS_KEY, schemaKey: SCHEMA_KEY }
  );

const openRecommendations = async (page: Page, button = 'For you') => {
  await page.goto('/');
  await page.getByRole('button', { name: button, exact: true }).click();
  return page.getByRole('dialog');
};

test.describe('recommendations', () => {
  test.use({ locale: 'en-US' });

  test('are explained, stable on reopen, and adding one removes only that card', async ({ page }) => {
    await mockAniList(page);
    await seed(page, archive);
    const dialog = await openRecommendations(page);
    const matches = dialog.getByRole('region', { name: 'Close to what you like' });
    await expect(matches.getByRole('listitem').first()).toBeVisible();
    await expect(dialog.getByText(/Based on the 5 titles you loved or liked/)).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Something different' }).getByText('Show 108')).toBeVisible();

    const before = await matches.getByRole('heading', { level: 4 }).allTextContents();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'For you', exact: true }).click();
    await expect(matches.getByRole('heading', { level: 4 })).toHaveText(before);

    await dialog.getByRole('button', { name: `Add ${before[2]} to Plan to Watch` }).click();
    await expect(matches.getByRole('heading', { level: 4 })).toHaveText(before.filter((_, index) => index !== 2));
    await expect(dialog.getByRole('region', { name: 'Already on your list' }).getByText(before[2])).toBeVisible();
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), DETAILS_KEY);
    expect(stored.find((item: { id: string }) => item.id === before[2].replace('Show ', ''))).toMatchObject({
      userStatus: 'PLAN',
    });
  });

  test('shows loading, never a false empty state, while the Discover season is still loading', async ({ page }) => {
    await page.route(ANILIST, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return route.fulfill({
        json: { data: { Page: { pageInfo: { hasNextPage: false }, media: [media(900, ['Action'])] } } },
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'For you', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Looking through your archive for the next title…')).toBeVisible();
    await expect(dialog.getByText(/No recommendations yet/)).toHaveCount(0);
    await expect(dialog.getByText('Show 900')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(/No recommendations yet/)).toHaveCount(0);
  });

  test('an empty archive gets clearly non-personalized suggestions', async ({ page }) => {
    await mockAniList(page);
    const dialog = await openRecommendations(page);
    await expect(dialog.getByText(/Not personalized/)).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Suggestions' }).getByText('Show 900')).toBeVisible();
  });
});

for (const { browser, locale, button } of [
  { browser: 'en-US', locale: 'en', button: 'For you' },
  { browser: 'ja-JP', locale: 'ja', button: 'あなたへのおすすめ' },
  { browser: 'zh-CN', locale: 'zh-CN', button: '为你推荐' },
]) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    test(`recommendations fit ${viewport.width}px in ${browser}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('anime-horizon-locale', value), locale);
      await mockAniList(page);
      await seed(page, archive);
      const dialog = await openRecommendations(page, button);
      await expect(dialog.getByRole('listitem').first()).toBeVisible();
      await dialog.locator('details summary').first().click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // Cards stay compact: the reason is short and details are behind a disclosure.
      const tallest = await dialog
        .getByRole('listitem')
        .evaluateAll((items) => Math.max(...items.map((item) => item.getBoundingClientRect().height)));
      expect(tallest).toBeLessThan(400);
    });
  }
}
