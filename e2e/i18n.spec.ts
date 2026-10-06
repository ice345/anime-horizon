import { expect, Page, test } from '@playwright/test';

const ANILIST = /graphql\.anilist\.co/;
const STORAGE_DETAILS = 'anime-horizon-details-v3';
const LOCALE_KEY = 'anime-horizon-locale';

const entry = (id: number, note: string) => ({
  id: String(id),
  title: { native: `作品 ${id}`, romaji: `Test Work ${id}`, english: '' },
  coverImage: { extraLarge: '', large: '', color: '' },
  season: 'SPRING',
  seasonYear: 2020,
  genres: ['Drama', 'Music'],
  format: 'TV',
  status: 'FINISHED',
  averageScore: 82,
  popularity: 50_000,
  userStatus: 'COMPLETED',
  userReaction: 'LOVE',
  userNote: note,
});

const seasonMedia = [
  {
    ...entry(7001, ''),
    title: { native: '響け！ユーフォニアム', romaji: 'Hibike! Euphonium', english: 'Sound! Euphonium' },
    seasonYear: 2026,
    season: 'FALL',
    status: 'RELEASING',
    userStatus: undefined,
    userReaction: undefined,
    userNote: undefined,
  },
];

const mockAniList = (page: Page) =>
  page.route(ANILIST, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: seasonMedia } } }),
    })
  );

const seedArchive = (page: Page, entries: unknown[]) =>
  page.addInitScript(
    ({ details, key }) => {
      if (localStorage.getItem('e2e-seeded')) return;
      localStorage.setItem(key, JSON.stringify(details));
      localStorage.setItem('e2e-seeded', '1');
    },
    { details: entries, key: STORAGE_DETAILS }
  );

const noHorizontalOverflow = async (page: Page) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
};

const LOCALES = [
  {
    browser: 'en-US',
    lang: 'en',
    nav: 'Main navigation',
    myAnime: 'My Anime',
    journey: 'Journey',
    settings: 'Settings',
    language: 'Language',
    remove: 'Remove from archive: Test Work 1',
    confirmRemove: 'Remove',
    hero: 'Sound! Euphonium',
  },
  {
    browser: 'ja-JP',
    lang: 'ja',
    nav: 'メインナビゲーション',
    myAnime: 'マイアニメ',
    journey: '視聴のあゆみ',
    settings: '設定',
    language: '言語',
    remove: '年鑑から外す：作品 1',
    confirmRemove: '外す',
    hero: '響け！ユーフォニアム',
  },
  {
    browser: 'zh-CN',
    lang: 'zh-CN',
    nav: '主导航',
    myAnime: '我的番剧',
    journey: '观看历程',
    settings: '设置',
    language: '语言',
    remove: '移出年鉴：作品 1',
    confirmRemove: '确认移出',
    hero: '響け！ユーフォニアム',
  },
];

const navLink = (page: Page, nav: string, name: string) =>
  page.getByRole('navigation', { name: nav }).getByRole('link', { name, exact: true });

for (const locale of LOCALES) {
  test.describe(`mobile navigation in ${locale.lang}`, () => {
    test.use({ locale: locale.browser, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('resolves the browser language and keeps all destinations usable at 390px', async ({ page }) => {
      await mockAniList(page);
      await seedArchive(page, [entry(1, 'note')]);
      await page.goto('/');

      await expect(page.locator('html')).toHaveAttribute('lang', locale.lang);
      // Title policy: English UI shows the English title; Japanese and Chinese show the original.
      await expect(page.locator('#catalogue h3').first()).toHaveText(locale.hero);
      await noHorizontalOverflow(page);

      for (const [label, path] of [
        [locale.myAnime, '/my-anime'],
        [locale.journey, '/journey'],
        [locale.settings, '/settings'],
      ]) {
        await navLink(page, locale.nav, label).click();
        await expect(page).toHaveURL(new RegExp(`${path}`));
        await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible();
        await expect(navLink(page, locale.nav, label)).toHaveAttribute('aria-current', 'page');
        await noHorizontalOverflow(page);
      }
      await expect(page.getByRole('group', { name: locale.language })).toBeVisible();

      // The undo toast must use the available width instead of squeezing longer translations.
      await navLink(page, locale.nav, locale.myAnime).click();
      await page.getByRole('button', { name: locale.remove }).click();
      await page.getByRole('button', { name: locale.confirmRemove, exact: true }).click();
      const message = await page
        .getByRole('status')
        .filter({ hasText: /./ })
        .last()
        .locator('span')
        .first()
        .boundingBox();
      // At most two lines of text; the old layout squeezed the message into a column of 6+ lines.
      expect(message?.height ?? Infinity).toBeLessThanOrEqual(48);
    });
  });
}

test.describe('runtime language switching', () => {
  test.use({ locale: 'zh-CN' });

  test('switches Chinese → English immediately, keeps the route and archive data, and persists the choice', async ({
    page,
  }) => {
    await mockAniList(page);
    const notes = ['第一集的光影太好了', 'Sound design I want to remember', '最終回で泣いた'];
    await seedArchive(page, [entry(1, notes[0]), entry(2, notes[1]), entry(3, notes[2])]);
    await page.goto('/settings');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    const before = await page.evaluate((key) => localStorage.getItem(key), STORAGE_DETAILS);

    await page.getByText('English', { exact: true }).click();

    // The page updates without a reload and stays on the same destination.
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(navLink(page, 'Main navigation', 'My Anime')).toBeVisible();

    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_DETAILS)).toBe(before);
    expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBe('en');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await navLink(page, 'Main navigation', 'My Anime').click();
    await expect(page.getByRole('heading', { level: 1, name: 'My Anime' })).toBeVisible();
    // User-written notes are shown exactly as written, never translated.
    for (const note of notes) await expect(page.getByText(note)).toBeVisible();
  });
});

test.describe('AI report language', () => {
  test.use({ locale: 'en-US' });

  test('a report cached in one language is not reused for another', async ({ page }) => {
    await mockAniList(page);
    await seedArchive(page, [entry(1, 'note')]);
    const prompts: string[] = [];
    // These tests exercise a deployment that has explicitly enabled the site AI.
    await page.route('**/api/deepseek/status', (route) => route.fulfill({ json: { siteAI: 'enabled' } }));
    await page.route('**/api/deepseek/chat', async (route) => {
      const prompt: string = route.request().postDataJSON().prompt;
      prompts.push(prompt);
      const analysis = prompt.includes('自然的日语')
        ? { tags: ['繊細な青春'], analysis: '日本語の鑑賞レポートです。' }
        : { tags: ['Quiet youth'], analysis: 'An English taste report.' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }),
      });
    });
    const openReport = async (journey: string, tasteMap: string, report: string, nav: string) => {
      await navLink(page, nav, journey).click();
      await page.getByRole('link', { name: tasteMap, exact: true }).click();
      await expect(page).toHaveURL(/\/journey\/taste$/);
      await page.getByRole('button', { name: report }).click();
    };
    const switchLanguage = async (nav: string, settings: string, target: string) => {
      await navLink(page, nav, settings).click();
      await page.getByText(target, { exact: true }).click();
    };

    await page.goto('/');
    await openReport('Journey', 'Taste Map', 'Generate taste report', 'Main navigation');
    await expect(page.getByText('An English taste report.')).toBeVisible();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('自然的英语');
    await page.keyboard.press('Escape');

    await switchLanguage('Main navigation', 'Settings', '日本語');
    await openReport('視聴のあゆみ', '好みのマップ', '鑑賞レポートを作成', 'メインナビゲーション');
    await expect(page.getByText('日本語の鑑賞レポートです。')).toBeVisible();
    await expect(page.getByText('An English taste report.')).toHaveCount(0);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('自然的日语');
    await page.keyboard.press('Escape');

    // Switching back reuses the English report instead of sending another request.
    await switchLanguage('メインナビゲーション', '設定', 'English');
    await openReport('Journey', 'Taste Map', 'Generate taste report', 'Main navigation');
    await expect(page.getByText('An English taste report.')).toBeVisible();
    expect(prompts).toHaveLength(2);
  });
});
