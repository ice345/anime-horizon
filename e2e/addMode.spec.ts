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

const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]') as Array<Record<string, unknown>>, DETAILS_KEY);

const catalogue = (page: Page) => page.locator('#catalogue');

test.describe('Discover add mode', () => {
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ page }) => {
    // Fall 2026 is the current season; 2018 is in the past and 2027 in the future.
    await page.clock.setFixedTime(new Date('2026-10-06T10:00:00Z'));
    await mockAniList(page);
  });

  test('a past season defaults to Completed, records no watch dates, and every add can be undone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('radio', { name: 'Plan to Watch' })).toBeChecked();

    await page.getByRole('navigation', { name: 'Years', exact: true }).getByRole('button', { name: '2018' }).click();
    await expect(page.getByRole('radio', { name: 'Completed' })).toBeChecked();
    await expect(page.getByText('Titles you click are added as Completed.')).toBeVisible();

    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    const added = catalogue(page).locator('article').filter({ hasText: 'Old Show' });
    await expect(added.getByText('Completed', { exact: true })).toBeVisible();
    // The pointer is still over the entry, so the cue says how to take the add back.
    await expect(added.getByText('Click again to undo')).toBeVisible();

    // The user switches mode before the next click.
    await page.getByRole('radio', { name: 'Watching' }).check();
    await catalogue(page).getByRole('button', { name: 'Add to archive: Second Show' }).click();

    const records = await stored(page);
    const byId = Object.fromEntries(records.map((record) => [record.id, record]));
    expect(byId['1']).toMatchObject({
      userStatus: 'COMPLETED',
      userHistory: { startedAt: null, completedAt: null },
    });
    expect((byId['1'].userHistory as { addedAt: string }).addedAt).toBe('2026-10-06T10:00:00.000Z');
    expect(byId['2']).toMatchObject({ userStatus: 'WATCHING', userHistory: { startedAt: null, completedAt: null } });
    expect(byId['1'].userReaction).toBeUndefined();

    // A misclick is one more click on the same title; established titles are never removable from Discover.
    await added.getByRole('button', { name: 'Undo adding Old Show' }).click();
    await expect.poll(async () => (await stored(page)).map((record) => record.id)).toEqual(['2']);
    await expect(catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' })).toBeVisible();
  });

  test('the current season starts on Plan to Watch and a future season offers nothing else', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('radio', { name: 'Plan to Watch' })).toBeChecked();
    await catalogue(page).getByRole('button', { name: 'Add to archive: Old Show' }).click();
    expect((await stored(page))[0]).toMatchObject({ userStatus: 'PLAN' });

    await page.getByRole('navigation', { name: 'Years', exact: true }).getByRole('button', { name: '2027' }).click();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByText('This season hasn’t started yet')).toBeVisible();
  });

  test('changing the season resets the mode to that season’s default', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Years', exact: true }).getByRole('button', { name: '2018' }).click();
    await page.getByRole('radio', { name: 'Plan to Watch' }).check();
    await page.getByRole('tab', { name: 'Spring' }).click();
    await expect(page.getByRole('radio', { name: 'Completed' })).toBeChecked();
  });
});

test.describe('rating and note wording', () => {
  test.use({ locale: 'zh-CN' });

  test('the editor separates 喜欢程度 from 短评', async ({ page }) => {
    await mockAniList(page);
    await page.addInitScript((key) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            ...{ id: '1', title: { native: '旧作', romaji: 'Old Show', english: '' } },
            coverImage: { extraLarge: '', large: '', color: '' },
            season: 'SPRING',
            seasonYear: 2018,
            genres: ['Drama'],
            userStatus: 'COMPLETED',
            userNote: '很好看',
            userHistory: { addedAt: null, startedAt: null, completedAt: null, updatedAt: null },
          },
        ])
      );
      localStorage.setItem('anime-horizon-archive-schema', '5');
      localStorage.setItem('e2e-seeded', '1');
    }, DETAILS_KEY);
    await page.goto('/my-anime');

    // A note without a rating says so, rather than implying one.
    const card = page.locator('main article').first();
    await expect(card.getByText('未评价')).toBeVisible();
    await card.getByRole('button', { name: '编辑评价与短评' }).click();
    await expect(card.getByText('喜欢程度', { exact: true })).toBeVisible();
    await expect(card.getByText('只写给自己看。写短评不会改变上面的喜欢程度。')).toBeVisible();
    await expect(card.getByRole('combobox', { name: '旧作 的喜欢程度' })).toHaveValue('');

    await card.getByRole('textbox', { name: '旧作 的短评' }).fill('看完以后很喜欢');
    await card.getByRole('button', { name: '保存' }).click();
    expect((await stored(page))[0]).toMatchObject({ userNote: '看完以后很喜欢' });
    expect((await stored(page))[0].userReaction).toBeUndefined();
  });
});
