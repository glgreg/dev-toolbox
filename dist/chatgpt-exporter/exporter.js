/**
 * @typedef {object} ConversationTurn
 * @property {string} id Message turn ID.
 * @property {'user' | 'assistant'} role Speaker role.
 * @property {string | null} model Model slug if available.
 * @property {number | null} timestamp Unix timestamp in seconds if available.
 * @property {string} content Normalized text content.
 */

/**
 * @typedef {object} ChatGPTConversationData
 * @property {string} [title] Conversation title.
 * @property {number} [create_time] Unix creation timestamp in seconds.
 * @property {string} [default_model_slug] Default model identifier.
 * @property {Array<Record<string, any>>} [linear_conversation] Linear turn array.
 * @property {Record<string, Record<string, any>>} [mapping] DAG conversation mapping.
 * @property {string} [current_node] Current leaf node ID in mapping DAG.
 */

/**
 * ChatGPT Share Exporter client-side controller.
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const shareUrlInput = /** @type {HTMLInputElement} */ (document.getElementById('input-share-url'));
  const fetchBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-fetch'));
  const fetchStatus = /** @type {HTMLElement} */ (document.getElementById('fetch-status'));

  const exportCard = /** @type {HTMLElement} */ (document.getElementById('export-card'));
  const chatTitle = /** @type {HTMLElement} */ (document.getElementById('chat-title'));
  const chatMeta = /** @type {HTMLElement} */ (document.getElementById('chat-meta'));

  const downloadMdBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-md'));
  const downloadJsonlBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-jsonl'));
  const downloadTxtBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-txt'));
  const copyMdBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-md'));
  const copyFeedback = /** @type {HTMLElement} */ (document.getElementById('copy-feedback'));

  const tabPreviewMd = /** @type {HTMLButtonElement} */ (document.getElementById('tab-preview-md'));
  const tabPreviewJsonl = /** @type {HTMLButtonElement} */ (document.getElementById('tab-preview-jsonl'));
  const tabPreviewTxt = /** @type {HTMLButtonElement} */ (document.getElementById('tab-preview-txt'));
  const previewPanel = /** @type {HTMLElement} */ (document.getElementById('preview-panel'));

  // State
  /** @type {ChatGPTConversationData | null} */
  let currentData = null;
  /** @type {ConversationTurn[]} */
  let currentTurns = [];
  let currentSourceUrl = '';
  /** @type {'md' | 'jsonl' | 'txt'} */
  let activePreviewTab = 'md';

  /**
   * Builds the relative API endpoint URL for a given share ID.
   * @param {string} shareId Validated UUID v4 share ID.
   * @returns {string} API URL path.
   */
  const getApiUrl = (shareId) => {
    return `/api/chatgpt?shareId=${encodeURIComponent(shareId)}`;
  };

  /**
   * Extracts a UUID v4 share identifier from a URL or raw string.
   * @param {string} input Raw input from the user.
   * @returns {string | null} Matched UUID v4 or null.
   */
  const extractShareId = (input) => {
    const trimmed = input.trim();
    const match = trimmed.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    return match ? match[1] : null;
  };

  /**
   * Sanitizes a conversation title into a safe download filename stem.
   * @param {string | undefined} title Raw conversation title.
   * @param {string} defaultName Fallback filename stem.
   * @returns {string} Sanitized filename stem.
   */
  const sanitizeFilename = (title, defaultName) => {
    if (!title) return defaultName;
    const clean = title.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50);
    return clean || defaultName;
  };

  /**
   * Extracts ordered user and assistant dialogue turns from ChatGPT conversation data.
   * @param {ChatGPTConversationData} data Raw ChatGPT share data payload.
   * @returns {ConversationTurn[]} Array of normalized turns.
   */
  const extractTurns = (data) => {
    /** @type {ConversationTurn[]} */
    const turns = [];

    // Method 1: Try linear_conversation array (default in modern shares)
    if (Array.isArray(data.linear_conversation) && data.linear_conversation.length > 0) {
      for (const item of data.linear_conversation) {
        const msg = item.message;
        if (!msg) continue;

        const role = msg.author?.role;
        if (role !== 'user' && role !== 'assistant') continue;

        const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : [];
        const textParts = parts.filter((/** @type {unknown} */ p) => typeof p === 'string' && p.trim().length > 0);
        if (textParts.length === 0) continue;

        turns.push({
          id: String(msg.id || ''),
          role,
          model: msg.metadata?.model_slug || msg.metadata?.resolved_model_slug || null,
          timestamp: typeof msg.create_time === 'number' ? msg.create_time : null,
          content: textParts.join('\n\n').trim(),
        });
      }
    }

    // Method 2: Fallback to mapping DAG graph traversal if linear_conversation is empty
    if (turns.length === 0 && data.mapping && data.current_node) {
      /** @type {string | null | undefined} */
      let nodeId = data.current_node;
      /** @type {ConversationTurn[]} */
      const mappingTurns = [];

      while (nodeId && data.mapping[nodeId]) {
        const node = data.mapping[nodeId];
        const msg = node.message;

        if (msg) {
          const role = msg.author?.role;
          if (role === 'user' || role === 'assistant') {
            const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : [];
            const textParts = parts.filter((/** @type {unknown} */ p) => typeof p === 'string' && p.trim().length > 0);
            if (textParts.length > 0) {
              mappingTurns.push({
                id: String(msg.id || ''),
                role,
                model: msg.metadata?.model_slug || msg.metadata?.resolved_model_slug || null,
                timestamp: typeof msg.create_time === 'number' ? msg.create_time : null,
                content: textParts.join('\n\n').trim(),
              });
            }
          }
        }
        nodeId = node.parent;
      }

      mappingTurns.reverse();
      turns.push(...mappingTurns);
    }

    return turns;
  };

  /**
   * Formats conversation data and turns into a Markdown document.
   * @param {ChatGPTConversationData} data Conversation metadata.
   * @param {ConversationTurn[]} turns Extracted dialogue turns.
   * @param {string} sourceUrl Original share URL.
   * @returns {string} Formatted Markdown string.
   */
  const generateMarkdown = (data, turns, sourceUrl) => {
    const title = (data.title || 'ChatGPT Conversation').trim();
    const dateStr = data.create_time
      ? new Date(data.create_time * 1000).toISOString()
      : new Date().toISOString();

    let md = `# ${title}\n\n`;
    md += `- Source: ${sourceUrl || 'Shared ChatGPT Conversation'}\n`;
    md += `- Date: ${dateStr}\n`;
    md += `- Turns: ${turns.length}\n\n`;
    md += `---\n\n`;

    for (const turn of turns) {
      const speaker = turn.role === 'user' ? 'User' : `Assistant${turn.model ? ` (${turn.model})` : ''}`;
      md += `## ${speaker}\n\n${turn.content}\n\n---\n\n`;
    }

    return md;
  };

  /**
   * Formats extracted turns into JSON Lines (.jsonl) format.
   * @param {ConversationTurn[]} turns Extracted dialogue turns.
   * @returns {string} Formatted JSONL string.
   */
  const generateJsonl = (turns) => {
    return turns.map((turn, index) => {
      /** @type {Record<string, unknown>} */
      const obj = {
        index: index + 1,
        role: turn.role,
        content: turn.content,
      };
      if (turn.model) obj.model = turn.model;
      if (turn.timestamp) obj.timestamp = turn.timestamp;
      return JSON.stringify(obj);
    }).join('\n') + '\n';
  };

  /**
   * Formats conversation data and turns into a plain text transcript.
   * @param {ChatGPTConversationData} data Conversation metadata.
   * @param {ConversationTurn[]} turns Extracted dialogue turns.
   * @param {string} sourceUrl Original share URL.
   * @returns {string} Formatted plain text string.
   */
  const generatePlainText = (data, turns, sourceUrl) => {
    const title = (data.title || 'ChatGPT Conversation').trim();
    const dateStr = data.create_time
      ? new Date(data.create_time * 1000).toISOString()
      : new Date().toISOString();

    const separator = '='.repeat(80);
    let txt = `Title: ${title}\n`;
    txt += `Source: ${sourceUrl || 'Shared ChatGPT Conversation'}\n`;
    txt += `Date: ${dateStr}\n`;
    txt += `Total Turns: ${turns.length}\n\n`;

    for (const turn of turns) {
      const speaker = turn.role === 'user' ? 'USER' : `ASSISTANT${turn.model ? ` (${turn.model})` : ''}`;
      txt += `${separator}\n[${speaker}]\n${separator}\n\n`;
      txt += `${turn.content}\n\n`;
    }

    return txt;
  };

  /**
   * Triggers a client-side file download using a Blob and object URL.
   * @param {string} content File text content.
   * @param {string} filename Target download filename.
   * @param {string} mimeType MIME type string.
   * @returns {void}
   */
  const triggerDownload = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /**
   * Displays a status message in the fetch status container.
   * @param {string} msg Status text to display.
   * @param {'error' | 'success' | 'info'} type Status visual variant.
   * @returns {void}
   */
  const showStatus = (msg, type) => {
    fetchStatus.style.display = 'block';
    if (type === 'error') {
      fetchStatus.innerHTML = `<span class="badge badge--error">Error</span> <span style="margin-left: 8px; font-size: var(--font-size-sm); color: var(--badge-error-text);">${msg}</span>`;
    } else if (type === 'success') {
      fetchStatus.innerHTML = `<span class="badge badge--success">Loaded</span> <span style="margin-left: 8px; font-size: var(--font-size-sm);">${msg}</span>`;
    } else {
      fetchStatus.innerHTML = `<span style="font-size: var(--font-size-sm); color: var(--text-muted);">${msg}</span>`;
    }
  };

  /**
   * Renders parsed conversation metadata and updates the preview panel.
   * @param {ChatGPTConversationData} data Conversation payload.
   * @param {string} sourceUrl Source share URL.
   * @returns {void}
   */
  const renderConversationUI = (data, sourceUrl) => {
    currentData = data;
    currentSourceUrl = sourceUrl;
    currentTurns = extractTurns(data);

    if (currentTurns.length === 0) {
      showStatus('No dialogue messages found in conversation data.', 'error');
      exportCard.style.display = 'none';
      return;
    }

    const title = (data.title || 'Untitled Conversation').trim();
    chatTitle.textContent = title;

    // Calculate metadata
    const userCount = currentTurns.filter((t) => t.role === 'user').length;
    const assistantCount = currentTurns.filter((t) => t.role === 'assistant').length;
    const totalChars = currentTurns.reduce((acc, t) => acc + t.content.length, 0);
    const modelSlug = currentTurns.find((t) => t.model)?.model || data.default_model_slug || 'Standard';

    chatMeta.innerHTML = `
      <span class="badge" style="background-color: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color);">${currentTurns.length} turns</span>
      <span class="badge" style="background-color: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color);">User: ${userCount}</span>
      <span class="badge" style="background-color: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color);">Assistant: ${assistantCount}</span>
      <span class="badge" style="background-color: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color);">Model: ${modelSlug}</span>
      <span class="badge" style="background-color: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-color);">${(totalChars / 1000).toFixed(1)}k chars</span>
    `;

    exportCard.style.display = 'block';
    updatePreview();
    showStatus(`Successfully parsed "${title}" (${currentTurns.length} turns). Ready to download.`, 'success');
  };

  /**
   * Refreshes the preview panel text according to the active format tab.
   * @returns {void}
   */
  const updatePreview = () => {
    if (!currentData || currentTurns.length === 0) return;

    if (activePreviewTab === 'md') {
      previewPanel.textContent = generateMarkdown(currentData, currentTurns, currentSourceUrl);
    } else if (activePreviewTab === 'jsonl') {
      previewPanel.textContent = generateJsonl(currentTurns);
    } else if (activePreviewTab === 'txt') {
      previewPanel.textContent = generatePlainText(currentData, currentTurns, currentSourceUrl);
    }
  };

  /**
   * Switches the active format preview tab and updates ARIA state.
   * @param {'md' | 'jsonl' | 'txt'} tabName Selected tab format identifier.
   * @param {HTMLButtonElement} activeBtn Selected tab button element.
   * @returns {void}
   */
  const switchPreviewTab = (tabName, activeBtn) => {
    [tabPreviewMd, tabPreviewJsonl, tabPreviewTxt].forEach((b) => {
      b.classList.remove('tab-button--active');
      b.setAttribute('aria-selected', 'false');
    });
    activeBtn.classList.add('tab-button--active');
    activeBtn.setAttribute('aria-selected', 'true');
    activePreviewTab = tabName;
    updatePreview();
  };

  tabPreviewMd.addEventListener('click', () => switchPreviewTab('md', tabPreviewMd));
  tabPreviewJsonl.addEventListener('click', () => switchPreviewTab('jsonl', tabPreviewJsonl));
  tabPreviewTxt.addEventListener('click', () => switchPreviewTab('txt', tabPreviewTxt));

  /**
   * Fetches the shared conversation payload via the serverless proxy.
   * @returns {Promise<void>}
   */
  const fetchSharedChat = async () => {
    const rawInput = shareUrlInput.value.trim();
    const shareId = extractShareId(rawInput);

    if (!shareId) {
      showStatus('Please enter a valid ChatGPT share URL or UUID.', 'error');
      return;
    }

    fetchBtn.classList.add('button--disabled');
    fetchBtn.disabled = true;
    showStatus('Fetching conversation from ChatGPT...', 'info');

    try {
      const response = await fetch(getApiUrl(shareId), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        const errorData = /** @type {Record<string, unknown>} */ (await response.json().catch(() => ({})));
        throw new Error(String(errorData.error || `Server returned HTTP ${response.status}`));
      }

      const data = /** @type {ChatGPTConversationData} */ (await response.json());
      renderConversationUI(data, rawInput.startsWith('http') ? rawInput : `https://chatgpt.com/share/${shareId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showStatus(`Failed to fetch chat: ${message}`, 'error');
    } finally {
      fetchBtn.classList.remove('button--disabled');
      fetchBtn.disabled = false;
    }
  };

  fetchBtn.addEventListener('click', () => {
    void fetchSharedChat();
  });
  shareUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void fetchSharedChat();
    }
  });

  // Export Download handlers
  downloadMdBtn.addEventListener('click', () => {
    if (!currentData || currentTurns.length === 0) return;
    const content = generateMarkdown(currentData, currentTurns, currentSourceUrl);
    const filename = `${sanitizeFilename(currentData.title, 'chatgpt_export')}.md`;
    triggerDownload(content, filename, 'text/markdown;charset=utf-8');
  });

  downloadJsonlBtn.addEventListener('click', () => {
    if (!currentData || currentTurns.length === 0) return;
    const content = generateJsonl(currentTurns);
    const filename = `${sanitizeFilename(currentData.title, 'chatgpt_export')}.jsonl`;
    triggerDownload(content, filename, 'application/x-ndjson;charset=utf-8');
  });

  downloadTxtBtn.addEventListener('click', () => {
    if (!currentData || currentTurns.length === 0) return;
    const content = generatePlainText(currentData, currentTurns, currentSourceUrl);
    const filename = `${sanitizeFilename(currentData.title, 'chatgpt_export')}.txt`;
    triggerDownload(content, filename, 'text/plain;charset=utf-8');
  });

  copyMdBtn.addEventListener('click', async () => {
    if (!currentData || currentTurns.length === 0) return;
    const content = generateMarkdown(currentData, currentTurns, currentSourceUrl);

    try {
      await navigator.clipboard.writeText(content);
      copyFeedback.style.display = 'block';
      setTimeout(() => {
        copyFeedback.style.display = 'none';
      }, 2500);
    } catch {
      alert('Unable to copy to clipboard.');
    }
  });
});
