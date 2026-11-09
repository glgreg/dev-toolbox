import { expect, test } from '@playwright/test';

test.describe('Toolbox Hub E2E', () => {
  test('renders hub cards, toggles theme with persistence, and filters tools via search and shortcuts', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Gregorium Developer Utilities/);
    await expect(page.locator('.header__title')).toHaveText('Developer Utilities');

    const cards = page.locator('.card-grid .card');
    await expect(cards).toHaveCount(4);

    // Verify synchronous default theme and toggle persistence
    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    expect(initialTheme === 'dark' || initialTheme === 'light').toBe(true);

    await page.click('#theme-toggle');
    const toggledTheme = initialTheme === 'dark' ? 'light' : 'dark';
    await expect(html).toHaveAttribute('data-theme', toggledTheme);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', toggledTheme);

    // Keyboard shortcut '/' focuses search input
    await page.keyboard.press('/');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeFocused();

    // Filter for IndexNow
    await searchInput.fill('indexnow');
    await expect(cards.nth(0)).toBeVisible();
    await expect(cards.nth(1)).toBeHidden();

    // Filter for JWT
    await searchInput.fill('jwt');
    await expect(page.locator('.card', { hasText: 'JWT Debugger' })).toBeVisible();

    // Filter with no matches shows #search-empty
    await searchInput.fill('nonexistent-tool');
    await expect(page.locator('#search-empty')).toBeVisible();

    // Escape clears search and restores all cards
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');
    await expect(page.locator('#search-empty')).toBeHidden();
    await expect(cards.nth(0)).toBeVisible();
    await expect(cards.nth(1)).toBeVisible();
  });

  test('navigates from Hub cards to IndexNow, ChatGPT Exporter, and JWT tools', async ({
    page,
  }) => {
    await page.goto('/');

    await page.locator('.card', { hasText: 'IndexNow Submitter' }).locator('a.button').click();
    await expect(page).toHaveURL(/\/indexnow\/?$/);
    await expect(page.locator('.header__title')).toHaveText('IndexNow Submitter');

    await page.click('a:has-text("Hub")');
    await expect(page).toHaveURL(/\/$/);

    await page.locator('.card', { hasText: 'ChatGPT Share Exporter' }).locator('a.button').click();
    await expect(page).toHaveURL(/\/chatgpt-exporter\/?$/);
    await expect(page.locator('.header__title')).toHaveText('ChatGPT Share Exporter');

    await page.click('a:has-text("Hub")');
    await expect(page).toHaveURL(/\/$/);

    await page.locator('.card', { hasText: 'JWT Debugger' }).locator('a.button').click();
    await expect(page).toHaveURL(/\/jwt\/?$/);
    await expect(page.locator('.header__title')).toHaveText('JWT Debugger & Inspector');
  });
});
