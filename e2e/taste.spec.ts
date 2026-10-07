import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';
const SCHEMA_KEY = 'anime-horizon-archive-schema';

const record = (id: number, status: string, reaction: string | null, genres: string[], extra: object = {}) => ({
  id: String(id),
  title: { native: '', romaji: `Show ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2010 + (id % 15),
  genres,
  format: id % 7 === 0 ? 'MOVIE' : 'TV',
  popularity: id % 3 === 0 ? 4_000 : 150_000,
  status: 'FINISHED',
  userStatus: status,
  ...(reaction ? { userReaction: reaction } : {}),
  userHistory: { addedAt: null, startedAt: null, completedAt: null, updatedAt: null },
  ...extra,
});

const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index);

/** Loved Music, disliked Slice of Life (watched a lot), mixed Romance, some plans and unrated titles. */
const realistic = [
  ...range(1, 8).map((id) => record(id, 'COMPLETED', id % 2 ? 'LOVE' : 'LIKE', ['Music', 'Drama'])),
  ...range(20, 10).map((id) => record(id, 'COMPLETED', id % 2 ? 'DISLIKE' : 'HATE', ['Slice of Life'])),
  ...range(40, 6).map((id) => record(id, 'WATCHING', id % 2 ? 'LIKE' : 'HATE', ['Romance'])),
  ...range(60, 4).map((id) => record(id, 'COMPLETED', null, ['Mecha'])),
  ...range(80, 12).map((id) => record(id, 'PLAN', null, ['Fantasy'])),
];

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } }),
    })
  );

const seed = (page: Page, details: unknown[], schema = '5') =>
  page.addInitScript(
    ({ value, key, schemaKey, schemaValue }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem(schemaKey, schemaValue);
      localStorage.setItem('e2e-seeded', '1');
    },
    { value: details, key: DETAILS_KEY, schemaKey: SCHEMA_KEY, schemaValue: schema }
  );

test.describe('Taste Map', () => {
  test.use({ locale: 'en-US' });

  test('has its own URL under Journey and works with back and forward', async ({ page }) => {
    await mockAniList(page);
    await seed(page, realistic);
    await page.goto('/journey/taste');
    await expect(page).toHaveTitle('Taste Map · Anime Horizon');
    const views = page.getByRole('navigation', { name: 'Journey views' });
    await expect(views.getByRole('link', { name: 'Taste Map' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: 'Taste Map' })).toBeVisible();

    await views.getByRole('link', { name: 'Timeline' }).click();
    await expect(page).toHaveURL(/\/journey$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/journey\/taste$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Taste Map' })).toBeVisible();
  });

  test('separates what was enjoyed, mixed and disliked from what was merely watched or planned', async ({ page }) => {
    await mockAniList(page);
    await seed(page, realistic);
    await page.goto('/journey/taste');

    const enjoy = page.getByRole('region', { name: 'What you tend to enjoy' });
    const avoid = page.getByRole('region', { name: 'What tends not to work for you' });
    await expect(enjoy.getByText('Music', { exact: true })).toBeVisible();
    await expect(avoid.getByText('Slice of Life', { exact: true })).toBeVisible();
    await expect(enjoy.getByText('Slice of Life', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Where your feelings are mixed' }).getByText('Romance', { exact: true })
    ).toBeVisible();
    // Unrated Mecha was watched but has no direction; planned Fantasy is intent only.
    await expect(page.getByRole('region', { name: 'What you’ve explored' }).getByText('Mecha')).toBeVisible();
    await expect(enjoy.getByText('Mecha')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'On your watch list' }).getByText('Fantasy · 12 saved')
    ).toBeVisible();
    await expect(page.getByText('Based on 28 watched titles, 24 with a reaction.')).toBeVisible();

    await avoid.getByText('Why?').first().click();
    await expect(avoid.getByText(/Slice of Life appears in 10 titles you’ve watched/)).toBeVisible();
  });

  test('reads a legacy NEUTRAL as "no rating" end to end', async ({ page }) => {
    await mockAniList(page);
    await seed(
      page,
      [
        ...range(1, 4).map((id) => ({ ...record(id, 'COMPLETED', 'NEUTRAL', ['Drama']), userHistory: undefined })),
        { ...record(9, 'COMPLETED', 'LOVE', ['Drama']), userHistory: undefined },
      ],
      '4'
    );
    await page.goto('/journey/taste');
    await expect(page.getByText('Based on 5 watched titles, 1 with a reaction.')).toBeVisible();

    await page.goto('/my-anime?status=all');
    await page.getByRole('combobox', { name: 'Rating' }).selectOption({ label: 'Not rated' });
    await expect(page.locator('main article')).toHaveCount(4);
    await page.getByRole('combobox', { name: 'Rating' }).selectOption({ label: 'It was okay' });
    await expect(page.locator('main article')).toHaveCount(0);
  });

  test('empty archive offers a way forward instead of a verdict', async ({ page }) => {
    await mockAniList(page);
    await page.goto('/journey/taste');
    await expect(page.getByRole('heading', { name: 'No taste profile yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to Discover' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

for (const { browser, locale, nav } of [
  { browser: 'en-US', locale: 'en', nav: 'Main navigation' },
  { browser: 'ja-JP', locale: 'ja', nav: 'メインナビゲーション' },
  { browser: 'zh-CN', locale: 'zh-CN', nav: '主导航' },
]) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    test(`Taste Map fits ${viewport.width}px in ${browser}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('anime-horizon-locale', value), locale);
      await mockAniList(page);
      await seed(page, realistic);
      await page.goto('/journey/taste');
      await expect(page.getByRole('navigation', { name: nav }).getByRole('link').first()).toBeVisible();
      await page.locator('main details summary').first().click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
