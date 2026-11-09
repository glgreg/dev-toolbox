import { expect, test } from '@playwright/test';

test.describe('IndexNow Submitter E2E', () => {
  test('generates API key, fetches remote XML sitemap, verifies key hosting, and submits URLs', async ({
    page,
  }) => {
    await page.goto('/indexnow/');

    await expect(page.locator('.header__title')).toHaveText('IndexNow Submitter');

    const domainInput = page.locator('#input-domain');
    const keyInput = page.locator('#input-key');
    const keyLocationInput = page.locator('#input-key-location');
    const sitemapUrlInput = page.locator('#input-sitemap-url');
    const downloadBtn = page.locator('#btn-download-key');

    await expect(downloadBtn).toBeDisabled();

    // 1. Enter domain & generate key
    await domainInput.fill('example.com');
    await page.click('#btn-generate-key');

    const generatedKey = await keyInput.inputValue();
    expect(generatedKey).toMatch(/^[a-f0-9]{32}$/);
    await expect(keyLocationInput).toHaveValue(`https://example.com/${generatedKey}.txt`);
    await expect(sitemapUrlInput).toHaveValue('https://example.com/sitemap.xml');
    await expect(downloadBtn).toBeEnabled();

    // Verify key file download
    const downloadPromise = page.waitForEvent('download');
    await downloadBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${generatedKey}.txt`);

    // 2. Fetch remote XML sitemap via Worker proxy
    await page.click('#tab-sitemap');
    await page.click('#btn-fetch-sitemap');

    await expect(page.locator('#sitemap-fetch-status')).toContainText('Extracted 2 URLs');
    await expect(page.locator('#url-count')).toHaveText('2');

    // 3. Verify key hosting and submit to IndexNow
    await page.click('#btn-submit');

    await expect(page.locator('#verify-status')).toContainText('Key verified successfully');
    await expect(page.locator('#submit-status')).toContainText(
      'URLs successfully submitted to IndexNow',
    );
    await expect(page.locator('#results-console')).toContainText(
      'https://api.indexnow.org/indexnow',
    );
  });

  test('imports URLs from local CSV/TXT file and deduplicates entries', async ({ page }) => {
    await page.goto('/indexnow/');

    await page.click('#tab-file');
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles({
      name: 'urls.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'https://example.com/page-1\nhttps://example.com/page-2\nhttps://example.com/page-1\n',
      ),
    });

    await expect(page.locator('#drop-zone-info')).toContainText('Loaded 3 URLs');
    await expect(page.locator('#url-count')).toHaveText('2');
  });
});
