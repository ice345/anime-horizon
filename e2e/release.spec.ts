import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const DETAILS_KEY = 'anime-horizon-details-v3';

const record = (id: string, extra: object = {}) => ({
  id,
  title: { native: '', romaji: `Saved ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2015,
  genres: ['Drama'],
  format: 'TV',
  status: 'FINISHED',
  userStatus: 'COMPLETED',
  userReaction: 'LOVE',
  userNote: 'keep me',
  userHistory: { addedAt: null, startedAt: null, completedAt: '2020-05', updatedAt: null },
  ...extra,
});

const catalogueTitle = { ...record('4242'), id: 4242, title: { romaji: 'Saved 4242', english: null, native: null } };

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({ json: { data: { Page: { pageInfo: { hasNextPage: false }, media: [catalogueTitle] } } } })
  );

const seedRaw = (page: Page, raw: string) =>
  page.addInitScript(
    ({ value, key }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, value);
      localStorage.setItem('anime-horizon-archive-schema', '5');
      localStorage.setItem('e2e-seeded', '1');
    },
    { value: raw, key: DETAILS_KEY }
  );

const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), DETAILS_KEY);

test.describe('release hardening', () => {
  test.use({ locale: 'en-US' });

  test('stored data that fails validation is kept byte-for-byte until the user decides', async ({ page }) => {
    const raw = JSON.stringify([
      record('1'),
      record('2', { userReaction: 'MEH' }),
      record('3', { userNote: 'x'.repeat(281) }),
      record('4', { title: 42 }),
    ]);
    await mockAniList(page);
    await seedRaw(page, raw);
    await page.goto('/my-anime?status=all');

    const notice = page.getByRole('alert').filter({ hasText: 'Some of your saved data couldn’t be read' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('3 saved titles couldn’t be read, so 1 are shown');
    expect(await stored(page)).toBe(raw);

    // Edits work in memory but are not written while the problem is unresolved.
    await page.getByLabel('Watch status for Saved 1').selectOption('WATCHING');
    await page.reload();
    expect(await stored(page)).toBe(raw);

    const download = page.waitForEvent('download');
    await notice.getByRole('button', { name: 'Download original data' }).click();
    const file = await (await download).path();
    const contents = JSON.parse(await (await import('node:fs/promises')).readFile(file!, 'utf8'));
    expect(contents.localStorage[DETAILS_KEY]).toBe(raw);

    page.once('dialog', (dialog) => dialog.accept());
    await notice.getByRole('button', { name: 'Keep the readable titles' }).click();
    await expect(notice).toHaveCount(0);
    await expect
      .poll(async () => JSON.parse((await stored(page)) || '[]').map((item: { id: string }) => item.id))
      .toEqual(['1']);
  });

  test('clicking a saved title in Discover or search never removes it', async ({ page }) => {
    await mockAniList(page);
    await seedRaw(page, JSON.stringify([record('4242')]));
    await page.goto('/');

    // The saved title carries the user's own mark and offers no add or remove action.
    const card = page.locator('#catalogue article').filter({ hasText: 'Saved 4242' });
    await expect(card.getByText('Loved it')).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(0);
    await card.getByRole('img', { name: 'Saved 4242' }).click();
    await card.getByRole('heading', { name: 'Saved 4242' }).click();
    await expect(page.getByText(/Removed .* from your archive/)).toHaveCount(0);
    expect(JSON.parse((await stored(page)) || '[]')[0]).toMatchObject({ id: '4242', userNote: 'keep me' });

    await page.getByRole('button', { name: 'Search and add any anime' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Search any anime' }).fill('Saved');
    await dialog.getByRole('textbox', { name: 'Search any anime' }).press('Enter');
    await expect(dialog.getByText('In My Anime')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  });

  test('with no site AI, generating a report uploads nothing and offers the alternatives', async ({ page }) => {
    const chatRequests: string[] = [];
    await page.route('**/api/deepseek/chat', (route) => {
      chatRequests.push(route.request().postData() || '');
      return route.fulfill({ status: 503, json: { error: 'AI_NOT_CONFIGURED' } });
    });
    await mockAniList(page);
    await seedRaw(page, JSON.stringify([record('1'), record('2', { userReaction: 'LIKE' })]));
    await page.goto('/journey/taste');

    await expect(page.getByText(/Generating a report sends, for up to 512 titles in My Anime/)).toBeVisible();
    await page.getByRole('button', { name: 'Generate taste report' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'The built-in AI isn’t enabled' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(dialog.getByText(/The copied prompt contains the same data/)).toBeVisible();
    expect(chatRequests).toEqual([]);

    await dialog.getByRole('button', { name: 'Use your own AI service' }).click();
    await expect(page.getByRole('dialog', { name: 'AI & privacy' })).toBeVisible();
  });
});
