/**
 * Central toolbox hub client script.
 * Manages theme persistence/toggling and real-time tool card filtering.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Theme toggle
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    /**
     * Resolves the user's preferred theme from localStorage or OS media query.
     * @returns {'light' | 'dark'} The active theme identifier.
     */
    const getPreferredTheme = () => {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    };

    /**
     * Applies the selected theme to the document root and persists it.
     * @param {'light' | 'dark'} theme The theme to activate.
     * @returns {void}
     */
    const setTheme = (theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
    };

    toggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      setTheme(newTheme);
    });
  }

  // Hub search filter
  const searchInput = /** @type {HTMLInputElement | null} */ (document.getElementById('search-input'));
  const cards = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.card-grid .card'));
  const emptyState = document.getElementById('search-empty');

  if (searchInput && cards.length > 0) {
    /**
     * Filters tool cards on the hub based on the current search query.
     * @returns {void}
     */
    const filterCards = () => {
      const query = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      cards.forEach((card) => {
        const text = (card.textContent || '').toLowerCase();
        const matches = query === '' || text.includes(query);
        card.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
      });

      if (emptyState) {
        emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
      }
    };

    searchInput.addEventListener('input', filterCards);

    // Keyboard shortcut: '/' focuses search input
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        const isInputField = ['INPUT', 'TEXTAREA'].includes(activeTag);
        if (!isInputField) {
          e.preventDefault();
          searchInput.focus();
        }
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.value = '';
        filterCards();
        searchInput.blur();
      }
    });
  }
});
