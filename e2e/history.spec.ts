import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';
const SCHEMA_KEY = 'anime-horizon-archive-schema';

// A Phase A (schema v3) record: no userHistory field at all.
const legacyEntry = {
  id: '300',
  title: { native: '旧作品', romaji: 'Old Show', english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2012,
  genres: ['Drama'],
  format: 'TV',
  status: 'FINISHED',
  userStatus: 'COMPLETED',
  userReaction: 'LIKE',
};

const catalogueEntry = {
  id: '9100',
  title: { native: '新作品', romaji: 'New Show', english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'FALL',
  seasonYear: 2026,
  genres: ['Drama'],
  format: 'TV',
  status: 'RELEASING',
};

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: [catalogueEntry] } } }),
    })
  );

const seedLegacyArchive = (page: Page) =>
  page.addInitScript(
    ({ details, key }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(details));
      localStorage.setItem('e2e-seeded', '1');
    },
    { details: [legacyEntry], key: DETAILS_KEY }
  );

const historyGroup = (page: Page, card: ReturnType<Page['locator']>) => card.getByRole('group', { name: 'History' });

test.describe('personal history', () => {
  test.use({ locale: 'en-US', timezoneId: 'UTC' });

  test('legacy records migrate with unknown dates and can be backfilled with a year', async ({ page }) => {
    await mockAniList(page);
    await seedLegacyArchive(page);
    await page.goto('/my-anime');

    const card = page.locator('main article').filter({ hasText: 'Old Show' });
    await card.getByRole('button', { name: 'Edit note' }).click();
    const history = historyGroup(page, card);
    // Migration never invents dates: all three are unknown.
    await expect(history.getByText('Unknown')).toHaveCount(3);
    expect(await page.evaluate((key) => localStorage.getItem(key), SCHEMA_KEY)).toBe('5');

    await history.getByLabel(/^Completed/).fill('2019');
    await card.getByRole('button', { name: 'Save' }).click();
    await page.reload();

    await page
      .locator('main article')
      .filter({ hasText: 'Old Show' })
      .getByRole('button', { name: 'Edit note' })
      .click();
    const reopened = historyGroup(page, page.locator('main article').filter({ hasText: 'Old Show' }));
    await expect(reopened.getByLabel(/^Completed/)).toHaveValue('2019');
    await expect(reopened.getByText('2019', { exact: true })).toBeVisible();
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), DETAILS_KEY);
    expect(stored[0].userHistory).toMatchObject({ addedAt: null, startedAt: null, completedAt: '2019' });
    expect(stored[0].userStatus).toBe('COMPLETED');
  });

  test('adding and progressing a title records added, started and completed dates', async ({ page }) => {
    await mockAniList(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Add to archive: New Show' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Anime' }).click();
    // Stay on "All" so the title remains in view as its status changes.
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^All/ }).click();

    const status = page.getByLabel('Watch status for New Show');
    await expect(status).toHaveValue('PLAN');
    await status.selectOption('WATCHING');
    await status.selectOption('COMPLETED');

    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), DETAILS_KEY);
    const history = stored[0].userHistory;
    expect(history.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(history.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(history.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(history.addedAt)).toBeLessThanOrEqual(Date.parse(history.startedAt));
    expect(Date.parse(history.startedAt)).toBeLessThanOrEqual(Date.parse(history.completedAt));

    await page.reload();
    const card = page.locator('main article').filter({ hasText: 'New Show' });
    await card.getByRole('button', { name: 'Write a note' }).click();
    const today = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date());
    await expect(historyGroup(page, card).getByText(today)).toHaveCount(3);
  });
});

const LOCALES = [
  { browser: 'en-US', open: 'Edit note', group: 'History', unknown: 'Unknown' },
  { browser: 'ja-JP', open: '感想を編集', group: '視聴の記録', unknown: '記録なし' },
  { browser: 'zh-CN', open: '编辑点评', group: '观看记录', unknown: '未记录' },
];

for (const locale of LOCALES) {
  test.describe(`history editor at 390px in ${locale.browser}`, () => {
    test.use({ locale: locale.browser, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('fits the card without horizontal overflow', async ({ page }) => {
      await mockAniList(page);
      await seedLegacyArchive(page);
      await page.goto('/my-anime');
      await page.getByRole('button', { name: locale.open }).click();

      const group = page.getByRole('group', { name: locale.group });
      await expect(group.getByText(locale.unknown)).toHaveCount(3);
      const inputs = group.getByRole('textbox');
      await expect(inputs).toHaveCount(2);
      for (const box of [await group.boundingBox(), await inputs.first().boundingBox()]) {
        expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
