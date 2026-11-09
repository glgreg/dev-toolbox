import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const indexNowHtml = readFileSync(
  resolve(process.cwd(), 'dist/indexnow/index.html'),
  'utf8',
);
const indexNowScript = readFileSync(
  resolve(process.cwd(), 'dist/indexnow/indexnow.js'),
  'utf8',
);

/**
 * Mounts the IndexNow Submitter HTML and runs its controller script in JSDOM.
 */
function mountIndexNow(): void {
  document.documentElement.innerHTML = indexNowHtml;
  const fn = new Function(indexNowScript);
  fn();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('IndexNow Submitter UI (dist/indexnow/indexnow.js)', () => {
  beforeEach(() => {
    localStorage.clear();
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/key-file');
    URL.revokeObjectURL = vi.fn();
    mountIndexNow();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a 32-char hex key, derives keyLocation and sitemap URLs, and enables key download', () => {
    const domainInput = document.getElementById('input-domain') as HTMLInputElement;
    const keyInput = document.getElementById('input-key') as HTMLInputElement;
    const keyLocationInput = document.getElementById('input-key-location') as HTMLInputElement;
    const sitemapInput = document.getElementById('input-sitemap-url') as HTMLInputElement;
    const generateBtn = document.getElementById('btn-generate-key') as HTMLButtonElement;
    const downloadBtn = document.getElementById('btn-download-key') as HTMLButtonElement;

    expect(downloadBtn.disabled).toBe(true);

    domainInput.value = 'https://www.gregorium.com/path';
    domainInput.dispatchEvent(new Event('input'));

    generateBtn.click();

    expect(keyInput.value).toMatch(/^[a-f0-9]{32}$/);
    expect(keyLocationInput.value).toBe(`https://gregorium.com/${keyInput.value}.txt`);
    expect(sitemapInput.value).toBe('https://gregorium.com/sitemap.xml');
    expect(downloadBtn.disabled).toBe(false);

    downloadBtn.click();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('auto-extracts key when pasting a valid keyLocation URL and deduplicates manual URLs', () => {
    const keyInput = document.getElementById('input-key') as HTMLInputElement;
    const keyLocationInput = document.getElementById('input-key-location') as HTMLInputElement;
    const urlsTextarea = document.getElementById('textarea-urls') as HTMLTextAreaElement;
    const urlCount = document.getElementById('url-count') as HTMLElement;
    const clearBtn = document.getElementById('btn-clear-urls') as HTMLButtonElement;

    keyLocationInput.value = 'https://gregorium.com/abcdef0123456789.txt';
    keyLocationInput.dispatchEvent(new Event('input'));
    expect(keyInput.value).toBe('abcdef0123456789');

    urlsTextarea.value = [
      'https://gregorium.com/a',
      'https://gregorium.com/b',
      'https://gregorium.com/a',
      'not-a-url',
    ].join('\n');
    urlsTextarea.dispatchEvent(new Event('input'));
    expect(urlCount.textContent).toBe('2');

    clearBtn.click();
    expect(urlCount.textContent).toBe('0');
  });

  it('verifies key hosting and submits URLs to IndexNow', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('action=verify')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes('action=submit')) {
        return new Response(
          JSON.stringify({ engineVerified: 'https://api.indexnow.org/indexnow' }),
          { status: 200 },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const domainInput = document.getElementById('input-domain') as HTMLInputElement;
    const keyInput = document.getElementById('input-key') as HTMLInputElement;
    const urlsTextarea = document.getElementById('textarea-urls') as HTMLTextAreaElement;
    const submitBtn = document.getElementById('btn-submit') as HTMLButtonElement;
    const submitStatus = document.getElementById('submit-status') as HTMLElement;
    const resultsConsole = document.getElementById('results-console') as HTMLElement;

    domainInput.value = 'gregorium.com';
    domainInput.dispatchEvent(new Event('input'));
    keyInput.value = '5fa70691500f40fb87256ea0297920ab';
    keyInput.dispatchEvent(new Event('input'));
    urlsTextarea.value = 'https://gregorium.com/\nhttps://gregorium.com/tools';
    urlsTextarea.dispatchEvent(new Event('input'));

    submitBtn.click();

    await vi.waitFor(() => {
      expect(submitStatus.style.display).toBe('block');
      expect(submitStatus.textContent).toContain('URLs successfully submitted to IndexNow');
    });

    expect(resultsConsole.textContent).toContain('Status Code: 200');
    expect(resultsConsole.textContent).toContain('https://api.indexnow.org/indexnow');
  });
});
