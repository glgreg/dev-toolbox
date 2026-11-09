/**
 * IndexNow Submitter client-side controller.
 * Manages key generation, hosting verification, URL extraction, and submission.
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Config Section
  const domainInput = /** @type {HTMLInputElement} */ (document.getElementById('input-domain'));
  const keyInput = /** @type {HTMLInputElement} */ (document.getElementById('input-key'));
  const keyLocationInput = /** @type {HTMLInputElement} */ (document.getElementById('input-key-location'));
  const generateKeyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-generate-key'));
  const downloadKeyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-key'));
  const verifySetupBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-verify-setup'));
  const verifyStatusDiv = /** @type {HTMLElement} */ (document.getElementById('verify-status'));
  const skipVerifyCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('check-skip-verify'));

  // DOM Elements - URL Loading Section
  const tabManual = /** @type {HTMLButtonElement} */ (document.getElementById('tab-manual'));
  const tabSitemap = /** @type {HTMLButtonElement} */ (document.getElementById('tab-sitemap'));
  const tabFile = /** @type {HTMLButtonElement} */ (document.getElementById('tab-file'));
  const panelManual = /** @type {HTMLElement} */ (document.getElementById('panel-manual'));
  const panelSitemap = /** @type {HTMLElement} */ (document.getElementById('panel-sitemap'));
  const panelFile = /** @type {HTMLElement} */ (document.getElementById('panel-file'));

  const urlsTextarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('textarea-urls'));
  const sitemapUrlInput = /** @type {HTMLInputElement} */ (document.getElementById('input-sitemap-url'));
  const fetchSitemapBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-fetch-sitemap'));
  const sitemapFetchStatusDiv = /** @type {HTMLElement} */ (document.getElementById('sitemap-fetch-status'));

  const dropZone = /** @type {HTMLElement} */ (document.getElementById('drop-zone'));
  const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
  const dropZoneInfo = /** @type {HTMLElement} */ (document.getElementById('drop-zone-info'));

  const urlCountSpan = /** @type {HTMLElement} */ (document.getElementById('url-count'));
  const clearUrlsBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-clear-urls'));

  // DOM Elements - Submit Section
  const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-submit'));
  const submitLoader = /** @type {HTMLElement} */ (document.getElementById('submit-loader'));
  const submitStatusDiv = /** @type {HTMLElement} */ (document.getElementById('submit-status'));
  const resultsConsole = /** @type {HTMLElement} */ (document.getElementById('results-console'));

  // State
  /** @type {string[]} */
  let loadedUrls = [];
  let hasCustomSitemap = false;
  let hasCustomKeyLocation = false;

  // ==========================================
  // 0. API Endpoint Resolver
  // ==========================================
  /**
   * Resolves the Worker API endpoint URL based on the current hostname.
   * @param {'verify' | 'sitemap' | 'submit'} action Worker action name.
   * @returns {string} Full Worker API endpoint URL.
   */
  const getApiUrl = (action) => {
    // If testing locally (localhost), query wrangler dev server on port 8787.
    // Otherwise, query the deployed Cloudflare Worker URL.
    const base = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8787'
      : 'https://dev-toolbox-indexnow.gustavo-l-gregorio.workers.dev';
    return `${base}/api/indexnow?action=${action}`;
  };

  // ==========================================
  // 1. Initial State & LocalStorage
  // ==========================================
  /**
   * Loads previously saved domain, key, and sitemap settings from localStorage.
   * @returns {void}
   */
  const loadStoredConfig = () => {
    const storedDomain = localStorage.getItem('indexnow_domain');
    const storedKey = localStorage.getItem('indexnow_key');
    const storedLocation = localStorage.getItem('indexnow_key_location');
    const storedSitemap = localStorage.getItem('indexnow_sitemap');

    if (storedDomain) domainInput.value = storedDomain;
    if (storedKey) keyInput.value = storedKey;

    if (storedLocation) {
      keyLocationInput.value = storedLocation;
      hasCustomKeyLocation = true;
    }

    if (storedSitemap) {
      sitemapUrlInput.value = storedSitemap;
      hasCustomSitemap = true;
    }

    // Run calculation to populate empty defaults
    updateKeyLocationAndSitemap();
  };

  /**
   * Persists the current domain, key, keyLocation, and sitemap URL in localStorage.
   * @returns {void}
   */
  const saveConfigToStorage = () => {
    localStorage.setItem('indexnow_domain', domainInput.value.trim());
    localStorage.setItem('indexnow_key', keyInput.value.trim());
    localStorage.setItem('indexnow_key_location', keyLocationInput.value.trim());
    localStorage.setItem('indexnow_sitemap', sitemapUrlInput.value.trim());
  };

  // ==========================================
  // 2. Key Generation & Downloading
  // ==========================================
  /**
   * Generates a random 32-character hexadecimal IndexNow API key.
   * @returns {void}
   */
  const generateRandomKey = () => {
    const chars = '0123456789abcdef';
    let key = '';
    for (let i = 0; i < 32; i++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
    keyInput.value = key;
    updateKeyLocationAndSitemap();
  };

  /**
   * Updates derived Key Location URL and Sitemap URL from the current domain and key.
   * @returns {void}
   */
  const updateKeyLocationAndSitemap = () => {
    const rawDomain = domainInput.value.trim();
    const cleanDomain = rawDomain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    const key = keyInput.value.trim();

    if (!rawDomain) {
      // If domain is empty, reset flags so next domain entry re-generates everything
      hasCustomKeyLocation = false;
      hasCustomSitemap = false;
      keyLocationInput.value = '';
      sitemapUrlInput.value = '';
      toggleDownloadButton();
      return;
    }

    // Auto-update Key Location URL if not customized by user
    if (!hasCustomKeyLocation) {
      if (key) {
        keyLocationInput.value = `https://${cleanDomain}/${key}.txt`;
      } else {
        keyLocationInput.value = `https://${cleanDomain}/your-key.txt`;
      }
    }

    // Auto-update Sitemap URL if not customized by user
    if (!hasCustomSitemap) {
      sitemapUrlInput.value = `https://${cleanDomain}/sitemap.xml`;
    }

    toggleDownloadButton();
  };

  /**
   * Enables or disables the key file download button based on domain and key validity.
   * @returns {void}
   */
  const toggleDownloadButton = () => {
    const key = keyInput.value.trim();
    const domain = domainInput.value.trim();

    if (key && domain && key.length >= 8) {
      downloadKeyBtn.classList.remove('button--disabled');
      downloadKeyBtn.disabled = false;
    } else {
      downloadKeyBtn.classList.add('button--disabled');
      downloadKeyBtn.disabled = true;
    }
  };

  /**
   * Triggers a browser download of the `<key>.txt` verification file.
   * @returns {void}
   */
  const downloadKeyFile = () => {
    const key = keyInput.value.trim();
    if (!key) return;

    const blob = new Blob([key], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${key}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ==========================================
  // 3. Server-Side Key Pre-Verification
  // ==========================================
  /**
   * Verifies via the Worker proxy that the key file is publicly accessible and matches the key.
   * @returns {Promise<boolean>} True if verification succeeded, false otherwise.
   */
  const verifyKeyHosting = async () => {
    let key = keyInput.value.trim();
    const keyLocation = keyLocationInput.value.trim();

    // Auto-extract key if empty but keyLocation is present
    if (!key && keyLocation) {
      const match = keyLocation.match(/\/([a-f0-9]{8,32})\.txt$/i);
      if (match && match[1]) {
        key = match[1];
        keyInput.value = key;
        updateKeyLocationAndSitemap();
      }
    }

    if (!key || !keyLocation) {
      showVerifyStatus('Please fill in the Website Domain and API Key (or paste a valid Key Location URL containing the key filename).', 'error');
      return false;
    }

    showVerifyStatus('Contacting server to verify key file accessibility...', 'info');
    saveConfigToStorage();

    try {
      const response = await fetch(getApiUrl('verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, keyLocation }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = /** @type {{success?: boolean, error?: string}} */ (await response.json());
      if (data.success) {
        showVerifyStatus('Key verified successfully! The key file is hosted correctly and matches.', 'success');
        return true;
      } else {
        showVerifyStatus(`Verification failed: ${data.error}`, 'error');
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showVerifyStatus(`Request error: ${message}`, 'error');
      return false;
    }
  };

  /**
   * Updates the key verification status banner.
   * @param {string} message Status message text.
   * @param {'success' | 'error' | 'info'} type Visual status variant.
   * @returns {void}
   */
  const showVerifyStatus = (message, type) => {
    verifyStatusDiv.style.display = 'block';
    verifyStatusDiv.className = ''; // Reset classes

    if (type === 'success') {
      verifyStatusDiv.innerHTML = `<span class="badge badge--success">Success</span> <span style="margin-left:8px; font-size:var(--font-size-sm);">${message}</span>`;
    } else if (type === 'error') {
      verifyStatusDiv.innerHTML = `<span class="badge badge--error">Error</span> <span style="margin-left:8px; font-size:var(--font-size-sm); color:var(--badge-error-text);">${message}</span>`;
    } else {
      verifyStatusDiv.innerHTML = `<span style="font-size:var(--font-size-sm); color:var(--text-muted);">${message}</span>`;
    }
  };

  // ==========================================
  // 4. URL Loading & Deduplication
  // ==========================================
  /**
   * Parses the URL textarea, filters valid HTTP(S) URLs, deduplicates them, and updates the counter.
   * @returns {void}
   */
  const updateUrlListAndCount = () => {
    const text = urlsTextarea.value;
    const urls = text
      .split('\n')
      .map((url) => url.trim())
      .filter((url) => url.length > 0 && (url.startsWith('http://') || url.startsWith('https://')));

    loadedUrls = [...new Set(urls)];
    urlCountSpan.textContent = String(loadedUrls.length);
  };

  /**
   * Appends extracted URLs to the manual textarea while deduplicating entries.
   * @param {string[]} urls List of URLs to add.
   * @returns {void}
   */
  const addUrlsToTextarea = (urls) => {
    const currentText = urlsTextarea.value.trim();
    const existingLines = currentText ? currentText.split('\n') : [];

    const combined = [...existingLines, ...urls]
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    const unique = [...new Set(combined)];
    urlsTextarea.value = unique.join('\n');
    updateUrlListAndCount();
  };

  /**
   * Fetches and parses a remote XML sitemap via the Worker proxy.
   * @returns {Promise<void>}
   */
  const fetchRemoteSitemap = async () => {
    const sitemapUrl = sitemapUrlInput.value.trim();
    if (!sitemapUrl) {
      showSitemapFetchStatus('Please specify a sitemap URL.', 'error');
      return;
    }

    showSitemapFetchStatus('Downloading and parsing sitemap...', 'info');

    try {
      const response = await fetch(getApiUrl('sitemap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sitemapUrl }),
      });

      if (!response.ok) {
        const errorData = /** @type {{error?: string}} */ (await response.json().catch(() => ({})));
        throw new Error(errorData.error || `Server returned HTTP ${response.status}`);
      }

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      // Parse errors check
      const parserError = xmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error('Fetched file was not valid XML.');
      }

      const locElements = xmlDoc.getElementsByTagName('loc');
      /** @type {string[]} */
      const urls = [];
      for (let i = 0; i < locElements.length; i++) {
        const text = locElements[i].textContent;
        if (text) urls.push(text.trim());
      }

      if (urls.length === 0) {
        showSitemapFetchStatus('No URLs found inside sitemap.xml. Check file contents.', 'error');
      } else {
        addUrlsToTextarea(urls);
        showSitemapFetchStatus(`Success! Extracted ${urls.length} URLs. Switched back to manual list to view.`, 'success');
        // Automatically switch back to manual tab to show loaded URLs
        setTimeout(() => switchTab(tabManual, panelManual), 1500);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showSitemapFetchStatus(`Failed to parse sitemap: ${message}`, 'error');
    }
  };

  /**
   * Displays a status message in the sitemap fetch status container.
   * @param {string} message Status message text.
   * @param {'success' | 'error' | 'info'} type Visual status variant.
   * @returns {void}
   */
  const showSitemapFetchStatus = (message, type) => {
    sitemapFetchStatusDiv.style.display = 'block';
    if (type === 'success') {
      sitemapFetchStatusDiv.innerHTML = `<span class="badge badge--success">Success</span> <span style="margin-left: 8px; font-size: var(--font-size-sm);">${message}</span>`;
    } else if (type === 'error') {
      sitemapFetchStatusDiv.innerHTML = `<span class="badge badge--error">Error</span> <span style="margin-left: 8px; font-size: var(--font-size-sm); color: var(--badge-error-text);">${message}</span>`;
    } else {
      sitemapFetchStatusDiv.innerHTML = `<span style="font-size: var(--font-size-sm); color: var(--text-muted);">${message}</span>`;
    }
  };

  /**
   * Parses a locally uploaded or dropped `.xml`, `.csv`, or `.txt` file for URLs.
   * @param {File} file Local file object selected by the user.
   * @returns {void}
   */
  const parseLocalFile = (file) => {
    const reader = new FileReader();
    dropZoneInfo.style.display = 'block';
    dropZoneInfo.textContent = `Reading ${file.name}...`;

    reader.onload = (e) => {
      const content = String(e.target?.result || '');
      const fileName = file.name.toLowerCase();

      try {
        if (fileName.endsWith('.xml')) {
          // Parse XML sitemap
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(content, 'text/xml');

          if (xmlDoc.querySelector('parsererror')) {
            throw new Error('Invalid XML file formatting.');
          }

          const locElements = xmlDoc.getElementsByTagName('loc');
          /** @type {string[]} */
          const urls = [];
          for (let i = 0; i < locElements.length; i++) {
            const text = locElements[i].textContent;
            if (text) urls.push(text.trim());
          }

          if (urls.length === 0) {
            throw new Error('No <loc> tags found in XML file.');
          }

          addUrlsToTextarea(urls);
          dropZoneInfo.className = 'drop-zone__file-info';
          dropZoneInfo.innerHTML = `<span class="badge badge--success">Parsed</span> Loaded ${urls.length} URLs from XML sitemap.`;
          setTimeout(() => switchTab(tabManual, panelManual), 1500);
        } else if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
          // Parse CSV or raw TXT line-by-line
          const lines = content.split('\n');
          /** @type {string[]} */
          const urls = [];

          // Regex to identify simple URLs
          const urlRegex = /https?:\/\/[^\s,]+/i;

          lines.forEach((line) => {
            const match = line.match(urlRegex);
            if (match) {
              urls.push(match[0].trim());
            }
          });

          if (urls.length === 0) {
            throw new Error('No valid HTTP/HTTPS URLs found in the text file.');
          }

          addUrlsToTextarea(urls);
          dropZoneInfo.className = 'drop-zone__file-info';
          dropZoneInfo.innerHTML = `<span class="badge badge--success">Parsed</span> Loaded ${urls.length} URLs from text/CSV file.`;
          setTimeout(() => switchTab(tabManual, panelManual), 1500);
        } else {
          throw new Error('Unsupported file extension. Please use .xml, .csv, or .txt.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dropZoneInfo.className = 'drop-zone__file-info';
        dropZoneInfo.innerHTML = `<span class="badge badge--error">Error</span> ${message}`;
      }
    };

    reader.onerror = () => {
      dropZoneInfo.className = 'drop-zone__file-info';
      dropZoneInfo.innerHTML = `<span class="badge badge--error">Error</span> Failed to read file.`;
    };

    reader.readAsText(file);
  };

  // ==========================================
  // 5. Submit to IndexNow
  // ==========================================
  /**
   * Validates inputs, runs pre-verification (unless bypassed), and submits URLs to IndexNow.
   * @returns {Promise<void>}
   */
  const submitToIndexNow = async () => {
    const host = domainInput.value.trim().replace(/^(https?:\/\/)?(www\.)?/, '');
    const key = keyInput.value.trim();
    const keyLocation = keyLocationInput.value.trim();

    // Re-verify list before final submit
    updateUrlListAndCount();

    if (!host) {
      showSubmitStatus('Please enter a Website Domain.', 'error');
      return;
    }
    if (!key || key.length < 8) {
      showSubmitStatus('Please enter a valid API Key (at least 8 characters).', 'error');
      return;
    }
    if (loadedUrls.length === 0) {
      showSubmitStatus('Please add at least one URL to submit.', 'error');
      return;
    }

    // Save inputs in storage for next time
    saveConfigToStorage();

    // 1. Run Pre-verification unless explicitly skipped
    if (!skipVerifyCheckbox.checked) {
      const isVerified = await verifyKeyHosting();
      if (!isVerified) {
        showSubmitStatus('Submission aborted: Pre-verification failed. If you know this is incorrect, check the bypass option to proceed.', 'error');
        return;
      }
    }

    // 2. Perform submission proxy
    submitBtn.classList.add('button--disabled');
    submitBtn.disabled = true;
    submitLoader.style.display = 'block';
    submitStatusDiv.style.display = 'none';
    resultsConsole.style.display = 'none';

    try {
      const response = await fetch(getApiUrl('submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          key,
          keyLocation: keyLocation || undefined,
          urlList: loadedUrls,
        }),
      });

      const responseCode = response.status;
      const data = /** @type {Record<string, unknown>} */ (await response.json().catch(() => ({})));

      // Update logs console
      resultsConsole.style.display = 'block';
      resultsConsole.textContent = `>>> POST /api/indexnow?action=submit\n` +
        `>>> Status Code: ${responseCode} ${response.statusText}\n` +
        `>>> JSON Payload Sent:\n${JSON.stringify({ host, key, keyLocation, urlsCount: loadedUrls.length }, null, 2)}\n\n` +
        `>>> Response Body from IndexNow:\n${JSON.stringify(data, null, 2)}`;

      if (responseCode === 200) {
        showSubmitStatus('Success! URLs successfully submitted to IndexNow. Search engines have queued them.', 'success');
      } else if (responseCode === 202) {
        showSubmitStatus('Accepted. Key verification file matches, index requests are queued.', 'success');
      } else {
        let expl = 'IndexNow server returned an error.';
        if (responseCode === 400) expl = 'Bad Request: Invalid payload or key formats.';
        if (responseCode === 403) expl = 'Forbidden: Key mismatch or invalid domain verification.';
        if (responseCode === 422) expl = 'Unprocessable: URLs belong to a different domain host.';

        showSubmitStatus(`Submission failed: HTTP ${responseCode}. ${expl}`, 'error');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showSubmitStatus(`Network error during submit: ${message}`, 'error');
    } finally {
      submitBtn.classList.remove('button--disabled');
      submitBtn.disabled = false;
      submitLoader.style.display = 'none';
    }
  };

  /**
   * Displays a status message in the final submission status container.
   * @param {string} message Status message text.
   * @param {'success' | 'error' | 'info'} type Visual status variant.
   * @returns {void}
   */
  const showSubmitStatus = (message, type) => {
    submitStatusDiv.style.display = 'block';
    if (type === 'success') {
      submitStatusDiv.innerHTML = `<span class="badge badge--success">Success</span> <span style="margin-left: 8px; font-size: var(--font-size-base); font-weight: 500;">${message}</span>`;
    } else if (type === 'error') {
      submitStatusDiv.innerHTML = `<span class="badge badge--error">Error</span> <span style="margin-left: 8px; font-size: var(--font-size-base); font-weight: 500; color: var(--badge-error-text);">${message}</span>`;
    } else {
      submitStatusDiv.innerHTML = `<span style="font-size: var(--font-size-sm); color: var(--text-muted);">${message}</span>`;
    }
  };

  // ==========================================
  // 6. Navigation Tabs & Event Listeners
  // ==========================================
  /**
   * Switches the active URL input tab and panel.
   * @param {HTMLButtonElement} activeTabButton Tab button to activate.
   * @param {HTMLElement} activePanel Tab panel to display.
   * @returns {void}
   */
  const switchTab = (activeTabButton, activePanel) => {
    [tabManual, tabSitemap, tabFile].forEach((btn) => {
      btn.classList.remove('tab-button--active');
      btn.setAttribute('aria-selected', 'false');
    });
    [panelManual, panelSitemap, panelFile].forEach((panel) => {
      panel.style.display = 'none';
    });

    activeTabButton.classList.add('tab-button--active');
    activeTabButton.setAttribute('aria-selected', 'true');
    activePanel.style.display = 'block';
  };

  // Event Listeners: Tab switcher
  tabManual.addEventListener('click', () => switchTab(tabManual, panelManual));
  tabSitemap.addEventListener('click', () => switchTab(tabSitemap, panelSitemap));
  tabFile.addEventListener('click', () => switchTab(tabFile, panelFile));

  // Event Listeners: Key & domain inputs
  domainInput.addEventListener('input', () => {
    updateKeyLocationAndSitemap();
  });

  keyInput.addEventListener('input', () => {
    updateKeyLocationAndSitemap();
  });

  keyLocationInput.addEventListener('input', () => {
    hasCustomKeyLocation = true;
    const urlVal = keyLocationInput.value.trim();
    // Match standard hex keys between 8 and 32 chars in filename
    const match = urlVal.match(/\/([a-f0-9]{8,32})\.txt$/i);
    if (match && match[1]) {
      keyInput.value = match[1];
    }
    toggleDownloadButton();
  });

  sitemapUrlInput.addEventListener('input', () => {
    hasCustomSitemap = true;
  });

  generateKeyBtn.addEventListener('click', generateRandomKey);
  downloadKeyBtn.addEventListener('click', downloadKeyFile);
  verifySetupBtn.addEventListener('click', () => {
    void verifyKeyHosting();
  });

  // Event Listeners: URL Textarea changes
  urlsTextarea.addEventListener('input', updateUrlListAndCount);
  clearUrlsBtn.addEventListener('click', () => {
    urlsTextarea.value = '';
    updateUrlListAndCount();
  });

  // Event Listeners: Remote sitemap fetch
  fetchSitemapBtn.addEventListener('click', () => {
    void fetchRemoteSitemap();
  });

  // Event Listeners: Drag & Drop local file
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      parseLocalFile(fileInput.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone--hover');
  });

  ['dragleave', 'dragend'].forEach((event) => {
    dropZone.addEventListener(event, () => {
      dropZone.classList.remove('drop-zone--hover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--hover');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      parseLocalFile(e.dataTransfer.files[0]);
    }
  });

  // Event Listeners: Final Submit
  submitBtn.addEventListener('click', () => {
    void submitToIndexNow();
  });

  // Initialize
  loadStoredConfig();
  updateUrlListAndCount();
});
