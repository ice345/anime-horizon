import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';

const record = (id: string, title: string, status: string, history: Record<string, string | null> | null) => ({
  id,
  title: { native: '', romaji: title, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2012,
  genres: ['Drama'],
  format: 'TV',
  status: 'FINISHED',
  userStatus: status,
  userReaction: 'NEUTRAL',
  ...(history
    ? { userHistory: { addedAt: null, startedAt: null, completedAt: null, updatedAt: null, ...history } }
    : {}),
});

const catalogue = [
  { ...record('9100', 'New Show', 'PLAN', null), seasonYear: 2026, season: 'FALL', status: 'RELEASING' },
];

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: catalogue } } }),
    })
  );

const seed = (page: Page, details: unknown[]) =>
  page.addInitScript(
    ({ value, key }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(value));
      localStorage.setItem('e2e-seeded', '1');
    },
    { value: details, key: DETAILS_KEY }
  );

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

test.describe('four-destination navigation', () => {
  test.use({ locale: 'en-US' });

  test('every destination loads directly, and unknown or legacy paths behave predictably', async ({ page }) => {
    await mockAniList(page);
    await seed(page, [record('1', 'Old Show', 'COMPLETED', null)]);

    await page.goto('/');
    await expect(mainNav(page).getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page');
    for (const [path, title] of [
      ['/my-anime', 'My Anime'],
      ['/journey', 'Journey'],
      ['/settings', 'Settings'],
    ]) {
      await page.goto(path);
      await expect(h1(page, title)).toBeVisible();
      await expect(mainNav(page).getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page');
    }
    await expect(page).toHaveTitle('Settings · Anime Horizon');

    await page.goto('/archive');
    await expect(page).toHaveURL(/\/my-anime$/);
    await page.goto('/discover');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/no-such-page');
    await expect(h1(page, 'Page not found')).toBeVisible();
    await page.getByRole('button', { name: 'Go to Discover' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('back and forward move between destinations without losing archive data', async ({ page }) => {
    await mockAniList(page);
    await seed(page, [record('1', 'Old Show', 'COMPLETED', null)]);
    await page.goto('/');

    await mainNav(page).getByRole('link', { name: 'My Anime' }).click();
    await expect(h1(page, 'My Anime')).toBeVisible();
    await mainNav(page).getByRole('link', { name: 'Journey' }).click();
    await expect(h1(page, 'Journey')).toBeVisible();
    // Focus moves to the new page heading for keyboard and screen-reader users.
    await expect(h1(page, 'Journey')).toBeFocused();

    await page.goBack();
    await expect(h1(page, 'My Anime')).toBeVisible();
    await expect(page.getByText('Old Show')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.goForward();
    await expect(h1(page, 'My Anime')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Old Show')).toBeVisible();
  });

  test('My Anime is organized by watch status and titles move between tabs', async ({ page }) => {
    await mockAniList(page);
    await page.goto('/');
    await page.locator('#catalogue').getByRole('button', { name: 'Add to archive: New Show' }).click();
    await mainNav(page).getByRole('link', { name: 'My Anime' }).click();

    const tabs = page.getByRole('group', { name: 'Filter by status' });
    await expect(tabs.getByRole('button', { name: /Plan to Watch/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Watch status for New Show').selectOption('WATCHING');
    await expect(page.getByText('Nothing saved to watch later.')).toBeVisible();

    await tabs.getByRole('button', { name: /Watching/ }).click();
    await expect(page).toHaveURL(/status=watching/);
    await page.getByLabel('Watch status for New Show').selectOption('COMPLETED');
    await expect(page.getByText('You’re not watching anything right now.')).toBeVisible();

    await tabs.getByRole('button', { name: /Completed/ }).click();
    await expect(page.getByLabel('Watch status for New Show')).toHaveValue('COMPLETED');
    await page.reload();
    await expect(page.getByLabel('Watch status for New Show')).toHaveValue('COMPLETED');
  });

  test('empty archive shows a path back to Discover in My Anime and Journey', async ({ page }) => {
    await mockAniList(page);
    await page.goto('/my-anime');
    await expect(page.getByText('Nothing here yet. Add anime from Discover to start your list.')).toBeVisible();
    await page.goto('/journey');
    await expect(page.getByText('Your Journey will appear as you add, start and complete anime.')).toBeVisible();
    await page.getByRole('button', { name: 'Go to Discover' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Journey', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  test('a legacy archive is not treated as empty and offers an optional review path', async ({ page }) => {
    await mockAniList(page);
    await seed(page, [record('1', 'Old Show', 'COMPLETED', null), record('2', 'Older Show', 'WATCHING', null)]);
    await page.goto('/journey');

    await expect(page.getByRole('heading', { name: 'Your history hasn’t been recorded yet' })).toBeVisible();
    await expect(page.getByText(/2 watched titles are in My Anime/)).toBeVisible();
    await page.getByText('Review titles without dates').click();
    await expect(page.locator('main article')).toHaveCount(2);
  });

  test('shows events by the year the user watched, never by airing year', async ({ page }) => {
    await mockAniList(page);
    await seed(page, [
      // Aired 2012, completed by the user in 2024.
      record('1', 'Classic Show', 'COMPLETED', { completedAt: '2024-03-10' }),
      // Started December 2024, completed February 2025: events in both years.
      record('2', 'Winter Show', 'COMPLETED', { startedAt: '2024-12', completedAt: '2025-02-03' }),
      // Only the year is remembered.
      record('3', 'Memory Show', 'COMPLETED', { completedAt: '2019' }),
      record('4', 'Undated Show', 'COMPLETED', null),
    ]);
    await page.goto('/journey');

    const years = page.getByRole('navigation', { name: 'Choose a year' });
    await expect(years.getByRole('button')).toHaveText(['2025', '2024', '2019']);
    await expect(years.getByRole('button', { name: '2025' })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('1 completed in 2025')).toBeVisible();

    await years.getByRole('button', { name: '2024' }).click();
    await expect(page).toHaveURL(/year=2024/);
    const timeline = page.getByRole('region', { name: 'Timeline for 2024' });
    await expect(timeline.getByRole('heading', { name: 'December 2024' })).toBeVisible();
    await expect(timeline.getByRole('heading', { name: 'March 2024' })).toBeVisible();
    await expect(timeline.getByText('Winter Show')).toBeVisible();
    await expect(timeline.getByText('Classic Show')).toBeVisible();
    await expect(timeline.getByText('2012')).toHaveCount(0);

    await years.getByRole('button', { name: '2019' }).click();
    const memory = page.getByRole('region', { name: 'Timeline for 2019' });
    await expect(memory.getByRole('heading', { name: 'Sometime in 2019' })).toBeVisible();
    await expect(memory.locator('time')).toHaveText(['2019']);

    // Missing history is explained without blocking anything.
    await expect(page.getByText('1 watched title has no dates')).toBeVisible();
    await expect(page.getByText('Yearly counts only include titles with recorded dates.')).toBeVisible();
  });
});

const OVERFLOW_LOCALES = [
  { browser: 'en-US', nav: 'Main navigation' },
  { browser: 'ja-JP', nav: 'メインナビゲーション' },
  { browser: 'zh-CN', nav: '主导航' },
];

for (const { browser, nav } of OVERFLOW_LOCALES) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 1100 },
  ]) {
    test(`no horizontal overflow on any destination in ${browser} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page
        .context()
        .addInitScript(
          (locale) => localStorage.setItem('anime-horizon-locale', locale),
          browser === 'en-US' ? 'en' : browser === 'ja-JP' ? 'ja' : 'zh-CN'
        );
      await mockAniList(page);
      await seed(page, [
        record('1', 'Classic Show', 'COMPLETED', { completedAt: '2024-03-10' }),
        record('2', 'Old Show', 'COMPLETED', null),
      ]);
      for (const path of ['/', '/my-anime', '/journey', '/settings']) {
        await page.goto(path);
        await expect(page.getByRole('navigation', { name: nav }).getByRole('link').first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path}`).toBeLessThanOrEqual(0);
      }
    });
  }
}
