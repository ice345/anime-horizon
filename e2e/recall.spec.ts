import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';

const record = (id: number, status: string, year: number, extra: object = {}) => ({
  id: String(id),
  title: { native: '', romaji: `Memory ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: year,
  genres: ['Drama'],
  format: 'TV',
  status: 'FINISHED',
  userStatus: status,
  userHistory: { addedAt: null, startedAt: null, completedAt: null, updatedAt: null },
  ...extra,
});

const archive = [
  record(1, 'COMPLETED', 2014, {
    userReaction: 'LOVE',
    userNote: 'Still think about the last episode.',
    userHistory: { addedAt: null, startedAt: null, completedAt: '2019-08', updatedAt: null },
  }),
  record(2, 'COMPLETED', 2009),
  record(3, 'COMPLETED', 2017),
  record(4, 'PLAN', 2012),
  record(5, 'WATCHING', 2015),
];

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({ json: { data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } } })
  );

const seed = (page: Page, details: unknown[]) =>
  page.addInitScript(
    ({ value, key }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem('anime-horizon-archive-schema', '5');
      localStorage.setItem('anime-horizon-game-stats-v1', '{"score":120}');
      localStorage.setItem('e2e-seeded', '1');
    },
    { value: details, key: DETAILS_KEY }
  );

test.describe('Recall', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  test('quizzes only completed titles, reveals personal context, and changes nothing', async ({ page }) => {
    await mockAniList(page);
    await seed(page, archive);
    await page.goto('/journey');
    await page.getByRole('navigation', { name: 'Journey views' }).getByRole('link', { name: 'Recall' }).click();
    await expect(page).toHaveURL(/\/journey\/recall$/);
    await expect(page).toHaveTitle('Recall · Anime Horizon');
    const before = await page.evaluate((key) => localStorage.getItem(key), DETAILS_KEY);
    // The retired mini-game stats were cleared on startup.
    expect(await page.evaluate(() => localStorage.getItem('anime-horizon-game-stats-v1'))).toBeNull();

    await page.getByRole('button', { name: 'Start (3 questions)' }).click();
    const seen: string[] = [];
    for (let question = 1; question <= 3; question += 1) {
      await expect(page.getByText(`Question ${question} of 3`)).toBeVisible();
      const heading = await page.getByRole('heading', { level: 3 }).first().textContent();
      seen.push(heading || '');
      const options = page.getByRole('group').getByRole('button');
      await expect(options).toHaveCount(4);
      await options.first().click();
      await expect(page.getByText('Aired', { exact: true })).toBeVisible();
      if (heading === 'Memory 1') {
        await expect(page.getByText('You completed it')).toBeVisible();
        await expect(page.getByText('August 2019')).toBeVisible();
        await expect(page.getByText('Loved it')).toBeVisible();
        await expect(page.getByText('“Still think about the last episode.”')).toBeVisible();
      } else {
        await expect(page.getByText('You completed it')).toHaveCount(0);
      }
      await page.getByRole('button', { name: question === 3 ? 'See result' : 'Next' }).click();
    }
    expect(seen.sort()).toEqual(['Memory 1', 'Memory 2', 'Memory 3']);
    await expect(page.getByText(/You remembered \d of 3\./)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), DETAILS_KEY)).toBe(before);
  });

  test('explains what to do when nothing has been completed', async ({ page }) => {
    await mockAniList(page);
    await seed(page, [record(4, 'PLAN', 2012), record(5, 'WATCHING', 2015)]);
    await page.goto('/journey/recall');
    await expect(page.getByRole('heading', { name: 'Nothing to recall yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Open My Anime' }).click();
    await expect(page).toHaveURL(/\/my-anime/);
  });
});

test('removed games, quiz and the More menu are no longer reachable', async ({ page }) => {
  await mockAniList(page);
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('button', { name: /^More/ })).toHaveCount(0);
  await expect(page.getByText(/Mini-games|Taste quiz/)).toHaveCount(0);
  await page.goto('/games');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});

for (const { browser, locale, start } of [
  { browser: 'en-US', locale: 'en', start: 'Start (3 questions)' },
  { browser: 'ja-JP', locale: 'ja', start: 'はじめる（3問）' },
  { browser: 'zh-CN', locale: 'zh-CN', start: '开始（3 题）' },
]) {
  for (const width of [1440, 820, 390, 360]) {
    test(`Recall fits ${width}px in ${browser}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('anime-horizon-locale', value), locale);
      await mockAniList(page);
      await seed(page, archive);
      await page.goto('/journey/recall');
      await page.getByRole('button', { name: start }).click();
      await page.getByRole('group').getByRole('button').first().click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const small = await page
        .locator('main button, main a')
        .evaluateAll((items) => items.filter((item) => item.getBoundingClientRect().height < 24).length);
      expect(small).toBe(0);
    });
  }
}
