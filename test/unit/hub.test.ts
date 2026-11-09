import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hubHtml = readFileSync(resolve(process.cwd(), 'dist/index.html'), 'utf8');
const hubScript = readFileSync(resolve(process.cwd(), 'dist/index.js'), 'utf8');

/**
 * Mounts the hub HTML and executes the hub script inside JSDOM.
 */
function mountHub(): void {
  document.documentElement.innerHTML = hubHtml;
  document.documentElement.setAttribute('data-theme', 'dark');
  const fn = new Function(hubScript);
  fn();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('Toolbox Hub (dist/index.js)', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    mountHub();
  });

  it('toggles theme between dark and light and persists to localStorage', () => {
    const toggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    toggleBtn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');

    toggleBtn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('filters tool cards in real time and toggles empty state banner', () => {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.card-grid .card'));
    const emptyState = document.getElementById('search-empty') as HTMLElement;

    expect(cards.length).toBeGreaterThanOrEqual(3);

    // Filter for IndexNow
    searchInput.value = 'indexnow';
    searchInput.dispatchEvent(new Event('input'));

    const visibleForIndexNow = cards.filter((c) => c.style.display !== 'none');
    expect(visibleForIndexNow).toHaveLength(1);
    expect(visibleForIndexNow[0].textContent).toContain('IndexNow Submitter');
    expect(emptyState.style.display).toBe('none');

    // Filter with no matches
    searchInput.value = 'nonexistent-tool-xyz';
    searchInput.dispatchEvent(new Event('input'));

    const visibleForNone = cards.filter((c) => c.style.display !== 'none');
    expect(visibleForNone).toHaveLength(0);
    expect(emptyState.style.display).toBe('block');
  });

  it('supports "/" keyboard shortcut to focus search and "Escape" to clear and blur', () => {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.card-grid .card'));

    // Press '/' when body is active -> focuses searchInput
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(searchInput);

    // Type a filter query
    searchInput.value = 'chatgpt';
    searchInput.dispatchEvent(new Event('input'));
    expect(cards.filter((c) => c.style.display !== 'none')).toHaveLength(1);

    // Press 'Escape' while focused -> clears searchInput and restores all cards
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(searchInput.value).toBe('');
    expect(cards.filter((c) => c.style.display !== 'none')).toHaveLength(cards.length);
  });
});
