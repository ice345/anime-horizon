import { expect, Page, test } from '@playwright/test';

// These specs assert on the Simplified Chinese UI; e2e/i18n.spec.ts covers English and Japanese.
test.use({ locale: 'zh-CN' });

const ANILIST = /graphql\.anilist\.co/;
const STORAGE_DETAILS = 'anime-horizon-details-v3';
const STORAGE_IDS = 'anime-horizon-selected-v3';

interface SeedEntry {
  id: string;
  title: { native: string; romaji: string; english: string };
  coverImage: { extraLarge: string; large: string; color: string };
  season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
  seasonYear: number;
  genres: string[];
  status?: string;
  averageScore?: number | null;
  popularity?: number;
  format?: string;
  userStatus?: 'PLAN' | 'WATCHING' | 'COMPLETED';
  userReaction?: 'LOVE' | 'LIKE' | 'NEUTRAL' | 'DISLIKE' | 'HATE';
  userNote?: string;
}

const entry = (id: number, overrides: Partial<SeedEntry> = {}): SeedEntry => ({
  id: String(id),
  title: { native: `测试作品 ${id}`, romaji: `Test Work ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2020,
  genres: ['Drama'],
  format: 'TV',
  status: 'FINISHED',
  userStatus: 'COMPLETED',
  userReaction: 'LIKE',
  userNote: `第 ${id} 部的短评`,
  ...overrides,
});

const mockAniList = async (page: Page, media: SeedEntry[] = []) => {
  await page.route(ANILIST, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media } } }),
    })
  );
};

/** Seeds the archive once; later reloads keep whatever the app persisted. */
const seedArchive = async (page: Page, entries: SeedEntry[]) => {
  await page.addInitScript(
    ({ details, keys }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(keys.details, JSON.stringify(details));
      localStorage.setItem(keys.ids, JSON.stringify(details.map((item: { id: string }) => item.id)));
      localStorage.setItem('e2e-seeded', '1');
    },
    { details: entries, keys: { details: STORAGE_DETAILS, ids: STORAGE_IDS } }
  );
};

const readArchive = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]') as SeedEntry[], STORAGE_DETAILS);

const tenTitles = () => Array.from({ length: 10 }, (_, index) => entry(index + 1));

const openDataSettings = async (page: Page) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '设置', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
};

const chooseBackup = async (page: Page, content: string) => {
  await page.locator('input[type=file][accept*="json"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(content),
  });
};

test.describe('archive data safety', () => {
  test('clicking an archive cover or title never removes the entry or its review', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, [entry(1, { userReaction: 'LOVE', userNote: '第一集的光影太好了' })]);
    await page.goto('/my-anime');

    const card = page.locator('main article').first();
    await expect(card).toContainText('测试作品 1');
    // The original bug: the cover was a toggle button that deleted the entry.
    await card.locator('img').click();
    await card.locator('h3').click();
    await expect(page.locator('main article')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('main article')).toHaveCount(1);
    const stored = await readArchive(page);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userReaction: 'LOVE', userNote: '第一集的光影太好了' });
  });

  test('removal needs an explicit confirmed control and can be undone with all user data', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, [entry(1, { userReaction: 'LOVE', userNote: '想记住的一句话' }), entry(2)]);
    await page.goto('/my-anime');

    await page.getByRole('button', { name: '移出年鉴：测试作品 1' }).click();
    await page.getByRole('button', { name: '保留' }).click();
    await expect(page.locator('main article')).toHaveCount(2);

    await page.getByRole('button', { name: '移出年鉴：测试作品 1' }).click();
    await page.getByRole('button', { name: '确认移出' }).click();
    await expect(page.locator('main article')).toHaveCount(1);
    expect((await readArchive(page)).map((item) => item.id)).toEqual(['2']);

    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.locator('main article')).toHaveCount(2);
    const restored = (await readArchive(page)).find((item) => item.id === '1');
    expect(restored).toMatchObject({ userStatus: 'COMPLETED', userReaction: 'LOVE', userNote: '想记住的一句话' });
  });

  test('restoring a backup with one existing title keeps all 10 titles', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, tenTitles());
    await page.goto('/');
    await openDataSettings(page);

    const backup = { version: 2, userSelection: ['3'], userDetails: [entry(3, { userNote: '备份里的短评' })] };
    await chooseBackup(page, JSON.stringify(backup));
    await expect(page.getByText(/新增 0 部；更新 1/)).toBeVisible();
    await page.getByRole('button', { name: '确认合并这份备份' }).click();

    const stored = await readArchive(page);
    expect(stored).toHaveLength(10);
    expect(stored.find((item) => item.id === '3')?.userNote).toBe('备份里的短评');
    expect(stored.find((item) => item.id === '7')?.userNote).toBe('第 7 部的短评');
  });

  test('restoring a backup with one new title grows the archive to 11 titles', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, tenTitles());
    await page.goto('/');
    await openDataSettings(page);

    await chooseBackup(page, JSON.stringify({ version: 2, userDetails: [entry(42)] }));
    await expect(page.getByText(/新增 1 部；更新 0/)).toBeVisible();
    await page.getByRole('button', { name: '确认合并这份备份' }).click();

    const stored = await readArchive(page);
    expect(stored).toHaveLength(11);
    expect(stored.map((item) => item.id)).toEqual(expect.arrayContaining(['1', '10', '42']));
  });

  test('malformed and cancelled restores leave the archive untouched', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, tenTitles());
    await page.goto('/');
    await openDataSettings(page);

    await chooseBackup(page, '{"version": 2, "userDetails": [');
    await expect(page.getByText(/解析失败/)).toBeVisible();
    await chooseBackup(page, JSON.stringify({ version: 2, userDetails: [{ id: 'broken' }] }));
    await expect(page.getByText(/解析失败/)).toBeVisible();
    expect(await readArchive(page)).toHaveLength(10);

    await chooseBackup(page, JSON.stringify({ version: 2, userDetails: [entry(42)] }));
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('已取消恢复，现有年鉴没有任何改动。')).toBeVisible();
    expect(await readArchive(page)).toHaveLength(10);
  });
});

test('adding an anime that finished airing years ago records it as 想看 (PLAN)', async ({ page }) => {
  await mockAniList(page, [entry(9001, { seasonYear: 2006, status: 'FINISHED', userStatus: undefined })]);
  await page.goto('/');

  await page.getByRole('button', { name: '加入年鉴：测试作品 9001' }).click();
  expect((await readArchive(page))[0]).toMatchObject({ id: '9001', userStatus: 'PLAN' });

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '我的番剧' }).click();
  await expect(page.getByLabel('测试作品 9001 的观看状态')).toHaveValue('PLAN');
});

test('season discovery includes unscored titles beyond the first page', async ({ page }) => {
  const scored = Array.from({ length: 50 }, (_, index) =>
    entry(5000 + index, { averageScore: 80, popularity: 90_000 - index, userStatus: undefined })
  );
  const unscored = entry(6000, {
    title: { native: '还没有评分的新番', romaji: 'Brand New', english: '' },
    averageScore: null,
    popularity: 15,
    userStatus: undefined,
  });
  await page.route(ANILIST, async (route) => {
    const pageNumber = route.request().postDataJSON().variables.page;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { Page: { pageInfo: { hasNextPage: pageNumber === 1 }, media: pageNumber === 1 ? scored : [unscored] } },
      }),
    });
  });
  await page.goto('/');

  await expect(page.locator('#catalogue').getByText('51 部作品')).toBeVisible();
  await expect(page.getByRole('button', { name: '加入年鉴：还没有评分的新番' })).toBeVisible();
});

test.describe('AI analysis failures', () => {
  test('a failure shows an error, is not cached, and retry sends a new request', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, [entry(1)]);
    let calls = 0;
    // These tests exercise a deployment that has explicitly enabled the site AI.
    await page.route('**/api/deepseek/status', (route) => route.fulfill({ json: { siteAI: 'enabled' } }));
    await page.route('**/api/deepseek/chat', async (route) => {
      calls += 1;
      if (calls <= 2) {
        // A temporary upstream failure: retryable, unlike "site AI not enabled".
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'AI_UPSTREAM_UNAVAILABLE' }),
        });
        return;
      }
      const analysis = { tags: ['细腻青春'], analysis: '一份真实的分析文本', personality: '克制', questions: [] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }),
      });
    });
    // The taste report lives at the end of Journey's Taste Map.
    await page.goto('/journey/taste');
    await page.getByRole('button', { name: '生成鉴赏档案' }).click();
    const dialog = page.getByRole('dialog', { name: '鉴赏档案' });
    await expect(dialog.getByRole('alert')).toContainText('这次没有生成鉴赏档案');
    await expect(dialog.getByText('待补充')).toHaveCount(0);
    expect(calls).toBe(1);

    // A failure is not cached: reopening issues a new request.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成鉴赏档案' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(calls).toBe(2);

    await dialog.getByRole('button', { name: '重试' }).click();
    await expect(dialog.getByText('一份真实的分析文本')).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(calls).toBe(3);

    // A successful report is cached.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '生成鉴赏档案' }).click();
    await expect(dialog.getByText('一份真实的分析文本')).toBeVisible();
    expect(calls).toBe(3);
  });
});

test('archive card controls do not overlap on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAniList(page);
  await seedArchive(page, [entry(1, { title: { native: 'ウィッチウォッチ', romaji: 'Witch Watch', english: '' } })]);
  await page.goto('/my-anime');

  const select = await page.getByLabel('ウィッチウォッチ 的观看状态').boundingBox();
  const review = await page.getByRole('button', { name: /写点评|编辑点评/ }).boundingBox();
  const remove = await page.getByRole('button', { name: '移出年鉴：ウィッチウォッチ' }).boundingBox();
  expect(select && review && remove).toBeTruthy();
  const overlaps = (a: NonNullable<typeof select>, b: NonNullable<typeof select>) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(select!, review!)).toBe(false);
  expect(overlaps(select!, remove!)).toBe(false);
  expect(overlaps(review!, remove!)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
