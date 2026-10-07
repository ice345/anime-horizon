import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';

const media = (id: number, romaji: string) => ({
  id,
  title: { romaji, english: null, native: null },
  coverImage: { extraLarge: '', large: '', color: '' },
  format: 'TV',
  season: 'SPRING',
  seasonYear: 2018,
  genres: ['Drama'],
  averageScore: 80,
  // Low popularity keeps these out of the top of the lead list, so names stay unique to the catalogue.
  popularity: 1000 - id,
  status: 'FINISHED',
});

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({
      json: {
        data: {
          Page: { pageInfo: { hasNextPage: false }, media: [media(1, 'Old Show'), media(2, 'Second Show')] },
        },
      },
    })
  );

type Stored = Array<{ id: string; userStatus?: string; userReaction?: string; userHistory?: Record<string, unknown> }>;
const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]') as Stored, DETAILS_KEY);
const ids = async (page: Page) => (await stored(page)).map((record) => record.id).sort();

const catalogue = (page: Page) => page.locator('#catalogue');
const entry = (page: Page, title: string) => catalogue(page).locator('article').filter({ hasText: title });
const goTo2018 = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Years', exact: true }).getByRole('button', { name: '2018' }).click();
  await expect(page.getByRole('radio', { name: 'Completed' })).toBeChecked();
};

const seedSaved = (page: Page) =>
  page.addInitScript((key) => {
    if (localStorage.getItem('e2e-seeded')) return;
    localStorage.setItem(
      key,
      JSON.stringify([
        {
          ...{ id: '1', title: { native: '', romaji: 'Old Show', english: '' } },
          coverImage: { extraLarge: '', large: '', color: '' },
          season: 'SPRING',
          seasonYear: 2018,
          genres: ['Drama'],
          userStatus: 'PLAN',
          userHistory: { addedAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, updatedAt: null },
        },
      ])
    );
    localStorage.setItem('anime-horizon-archive-schema', '5');
    localStorage.setItem('e2e-seeded', '1');
  }, DETAILS_KEY);

test.describe('Discover quick toggle', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-06T10:00:00Z'));
    await mockAniList(page);
  });

  test('click adds with the current mode, click again takes it back, and it can be added again', async ({ page }) => {
    await goTo2018(page);

    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    expect(await stored(page)).toEqual([
      expect.objectContaining({
        id: '1',
        userStatus: 'COMPLETED',
        userHistory: expect.objectContaining({
          addedAt: '2026-10-06T10:00:00.000Z',
          completedAt: null,
          startedAt: null,
        }),
      }),
    ]);

    await catalogue(page).getByRole('button', { name: 'Undo adding Old Show' }).click();
    await expect.poll(() => ids(page)).toEqual([]);
    await expect(page.getByRole('status')).toHaveText(/Old Show is no longer in My Anime\./);

    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    await expect.poll(() => ids(page)).toEqual(['1']);

    // Watching backfill: no invented start date either.
    await page.getByRole('radio', { name: 'Watching' }).check();
    await catalogue(page).getByRole('button', { name: 'Add to archive: Second Show' }).click();
    const second = (await stored(page)).find((record) => record.id === '2');
    expect(second).toMatchObject({ userStatus: 'WATCHING', userHistory: { startedAt: null, completedAt: null } });
  });

  test('a title saved before this visit is never removed by clicking its cover or title', async ({ page }) => {
    await seedSaved(page);
    await goTo2018(page);

    const saved = entry(page, 'Old Show');
    await expect(saved.getByText('Plan to Watch', { exact: true })).toBeVisible();
    await expect(saved.getByRole('button')).toHaveCount(0);
    await saved.getByRole('img', { name: 'Old Show' }).click();
    await saved.getByRole('heading', { name: 'Old Show' }).click();
    expect(await ids(page)).toEqual(['1']);
  });

  test('after a reload, a title added earlier is established and no longer toggles', async ({ page }) => {
    await goTo2018(page);
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    await page.reload();
    await page.getByRole('navigation', { name: 'Years', exact: true }).getByRole('button', { name: '2018' }).click();

    await expect(entry(page, 'Old Show').getByRole('button')).toHaveCount(0);
    await entry(page, 'Old Show').getByRole('img', { name: 'Old Show' }).click();
    expect(await ids(page)).toEqual(['1']);
  });

  test('once the new record is edited, Discover will not delete it', async ({ page, context }) => {
    await goTo2018(page);
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    await expect(catalogue(page).getByRole('button', { name: 'Undo adding Old Show' })).toBeVisible();

    // Rate it in another tab while this page stays on Discover: the record is no longer "just added".
    const other = await context.newPage();
    await mockAniList(other);
    await other.goto('/my-anime');
    await other.getByRole('button', { name: 'Rate or add a note' }).click();
    await other.getByLabel('Rating for Old Show').selectOption('LOVE');
    await other.getByRole('button', { name: 'Save' }).click();
    await other.close();

    const saved = entry(page, 'Old Show');
    await expect(saved.getByText('Loved it')).toBeVisible();
    await expect(saved.getByRole('button')).toHaveCount(0);
    await saved.getByRole('img', { name: 'Old Show' }).click();
    expect(await stored(page)).toEqual([expect.objectContaining({ id: '1', userReaction: 'LOVE' })]);
  });

  test('editing in My Anime and coming back also ends the quick toggle', async ({ page }) => {
    await goTo2018(page);
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Anime' }).click();
    await page.getByLabel('Watch status for Old Show').selectOption('WATCHING');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Discover' }).click();
    await page.getByRole('navigation', { name: 'Years', exact: true }).getByRole('button', { name: '2018' }).click();

    await expect(entry(page, 'Old Show').getByRole('button')).toHaveCount(0);
    expect(await stored(page)).toEqual([expect.objectContaining({ id: '1', userStatus: 'WATCHING' })]);
  });

  test('the toast Undo restores a quick-removed title, which can then be toggled again', async ({ page }) => {
    await goTo2018(page);
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    const [created] = await stored(page);
    await catalogue(page).getByRole('button', { name: 'Undo adding Old Show' }).click();
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();

    expect(await stored(page)).toEqual([created]);
    await catalogue(page).getByRole('button', { name: 'Undo adding Old Show' }).click();
    await expect.poll(() => ids(page)).toEqual([]);
  });

  test('a stale toast never overwrites or duplicates a title added again', async ({ page }) => {
    await goTo2018(page);
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    await catalogue(page).getByRole('button', { name: 'Undo adding Old Show' }).click();
    await expect(page.getByRole('status')).toBeVisible();

    // Adding it again is newer than the toast, so the toast goes away instead of offering a restore.
    await page.getByRole('radio', { name: 'Plan to Watch' }).check();
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(await stored(page)).toEqual([expect.objectContaining({ id: '1', userStatus: 'PLAN' })]);
  });

  test('works from the keyboard, with focus kept on the entry', async ({ page }) => {
    await goTo2018(page);
    const add = catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' });
    // Arrive by keyboard (as a keyboard user would), so the browser shows focus as keyboard focus.
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    const undo = catalogue(page).getByRole('button', { name: 'Undo adding Old Show' });
    await expect(undo).toBeFocused();
    await expect(entry(page, 'Old Show').getByText('Click again to undo')).toBeVisible();
    await page.keyboard.press('Space');
    await expect.poll(() => ids(page)).toEqual([]);
    await expect(add).toBeFocused();
  });
});

test.describe('Discover quick toggle on a phone', () => {
  test.use({ locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('tap adds, the cue is visible without hover, and a second tap takes it back', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-06T10:00:00Z'));
    await mockAniList(page);
    await goTo2018(page);

    const add = catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' });
    await expect(add.getByText('+ Completed')).toBeVisible();
    await add.tap();
    await expect(entry(page, 'Old Show').getByText('Tap again to undo')).toBeVisible();
    await expect(entry(page, 'Old Show').getByText('Completed', { exact: true })).toBeVisible();

    await catalogue(page).getByRole('button', { name: 'Undo adding Old Show' }).tap();
    await expect.poll(() => ids(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('reduced motion and the quiet opener', () => {
  test.use({ locale: 'en-US' });

  test('transitions become immediate, and the opener has no artwork', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockAniList(page);
    await page.goto('/');
    await expect(catalogue(page).locator('article').first()).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    const durations = await page.evaluate(() => {
      const seconds = (value: string) => Math.max(...value.split(',').map((part) => parseFloat(part) || 0));
      return ['.ah-layer', '.ah-entry-rule', '.ah-fade', '.ah-choice-rule'].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return Math.max(seconds(style.transitionDuration), seconds(style.animationDuration));
      });
    });
    for (const duration of durations) expect(duration).toBeLessThan(0.001);

    await expect(page.locator('section[aria-labelledby="season-title"] img')).toHaveCount(0);
  });
});
