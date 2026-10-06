import { expect, test } from '@playwright/test';

// These specs assert on the Simplified Chinese UI; e2e/i18n.spec.ts covers English and Japanese.
test.use({ locale: 'zh-CN' });

test.beforeEach(async ({ page }) => {
  await page.route('https://graphql.anilist.co', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { media: [] } } }),
    });
  });
});

test('loads the app shell and supports direct archive navigation', async ({ page }) => {
  // The legacy /archive path redirects to My Anime.
  await page.goto('/archive');
  await expect(page).toHaveURL(/\/my-anime$/);
  await expect(page.getByRole('link', { name: 'ANIME HORIZON' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '我的番剧' })).toBeVisible();
});

test('closes a modal with Escape and restores focus to its trigger', async ({ page }) => {
  await page.goto('/');
  const searchButton = page.getByRole('button', { name: '搜索并收录任意动画' });
  await searchButton.click();

  const dialog = page.getByRole('dialog', { name: '从任意年份收录动画' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(searchButton).toBeFocused();
});
