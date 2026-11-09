import { expect, test } from '@playwright/test';

const FIXTURE_SHARE_ID = '6aa1d178-350c-83e9-a514-4cd6e6698087';

test.describe('ChatGPT Share Exporter E2E', () => {
  test('validates invalid input, fetches shared conversation, previews MD/JSONL/TXT, and downloads files', async ({
    page,
    request,
  }) => {
    await page.goto('/chatgpt-exporter/');

    // 1. Client-side validation error on invalid input
    await page.fill('#input-share-url', 'not-a-valid-url');
    await page.click('#btn-fetch');
    await expect(page.locator('#fetch-status')).toContainText('valid ChatGPT share URL');

    // 2. Fetch shared conversation
    await page.fill('#input-share-url', `https://chatgpt.com/share/${FIXTURE_SHARE_ID}`);
    await page.click('#btn-fetch');

    const exportCard = page.locator('#export-card');
    await expect(exportCard).toBeVisible();
    await expect(page.locator('#chat-title')).toHaveText('Keystone Context Architecture');

    // 3. Verify Markdown preview
    const previewPanel = page.locator('#preview-panel');
    await expect(previewPanel).toContainText('# Keystone Context Architecture');
    await expect(previewPanel).toContainText('## User');
    await expect(previewPanel).toContainText('## Assistant (gpt-4o)');

    // 4. Switch to JSONL preview and validate JSON lines
    await page.click('#tab-preview-jsonl');
    const jsonlContent = (await previewPanel.textContent()) || '';
    const lines = jsonlContent.trim().split('\n');
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { index: number; role: string; content: string };
      expect(parsed.index).toBeGreaterThan(0);
      expect(['user', 'assistant']).toContain(parsed.role);
      expect(parsed.content.length).toBeGreaterThan(0);
    }

    // 5. Switch to Plain Text preview
    await page.click('#tab-preview-txt');
    await expect(previewPanel).toContainText('Title: Keystone Context Architecture');
    await expect(previewPanel).toContainText('[USER]');
    await expect(previewPanel).toContainText('[ASSISTANT (gpt-4o)]');

    // 6. Verify file download trigger (.md)
    const downloadPromise = page.waitForEvent('download');
    await page.click('#btn-download-md');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Keystone_Context_Architecture.md');

    // 7. Direct API validation for invalid UUID -> HTTP 400
    const resInvalid = await request.get('/api/chatgpt?shareId=invalid-uuid');
    expect(resInvalid.status()).toBe(400);
  });
});
