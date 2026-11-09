import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exporterHtml = readFileSync(
  resolve(process.cwd(), 'dist/chatgpt-exporter/index.html'),
  'utf8',
);
const exporterScript = readFileSync(
  resolve(process.cwd(), 'dist/chatgpt-exporter/exporter.js'),
  'utf8',
);

const VALID_UUID = '6aa1d178-350c-83e9-a514-4cd6e6698087';

/**
 * Mounts the ChatGPT Exporter DOM and initializes the controller script.
 */
function mountExporter(): void {
  document.documentElement.innerHTML = exporterHtml;
  const fn = new Function(exporterScript);
  fn();
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('ChatGPT Share Exporter UI (dist/chatgpt-exporter/exporter.js)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-blob');
    URL.revokeObjectURL = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    mountExporter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows validation error when input does not contain a valid UUID', async () => {
    const input = document.getElementById('input-share-url') as HTMLInputElement;
    const fetchBtn = document.getElementById('btn-fetch') as HTMLButtonElement;
    const fetchStatus = document.getElementById('fetch-status') as HTMLElement;

    input.value = 'https://chatgpt.com/share/not-a-valid-uuid';
    fetchBtn.click();

    expect(fetchStatus.style.display).toBe('block');
    expect(fetchStatus.textContent).toContain('valid ChatGPT share URL or UUID');
  });

  it('parses linear_conversation, renders MD/JSONL/TXT views, and triggers exports', async () => {
    const mockPayload = {
      title: 'Keystone Context Design',
      create_time: 1730000000,
      linear_conversation: [
        {
          message: {
            id: 'u1',
            author: { role: 'user' },
            create_time: 1730000001,
            content: { parts: ['What is Keystone?'] },
          },
        },
        {
          message: {
            id: 'a1',
            author: { role: 'assistant' },
            create_time: 1730000005,
            metadata: { model_slug: 'gpt-4o' },
            content: { parts: ['Keystone is an architectural context protocol.'] },
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const input = document.getElementById('input-share-url') as HTMLInputElement;
    const fetchBtn = document.getElementById('btn-fetch') as HTMLButtonElement;
    const exportCard = document.getElementById('export-card') as HTMLElement;
    const previewPanel = document.getElementById('preview-panel') as HTMLElement;
    const tabJsonl = document.getElementById('tab-preview-jsonl') as HTMLButtonElement;
    const tabTxt = document.getElementById('tab-preview-txt') as HTMLButtonElement;
    const copyBtn = document.getElementById('btn-copy-md') as HTMLButtonElement;
    const downloadMdBtn = document.getElementById('btn-download-md') as HTMLButtonElement;

    input.value = `https://chatgpt.com/share/${VALID_UUID}`;
    fetchBtn.click();

    await vi.waitFor(() => {
      expect(exportCard.style.display).toBe('block');
    });

    // Markdown view (default)
    expect(previewPanel.textContent).toContain('# Keystone Context Design');
    expect(previewPanel.textContent).toContain('## User');
    expect(previewPanel.textContent).toContain('## Assistant (gpt-4o)');

    // Switch to JSONL view
    tabJsonl.click();
    const jsonlLines = (previewPanel.textContent || '').trim().split('\n');
    expect(jsonlLines).toHaveLength(2);
    const firstTurn = JSON.parse(jsonlLines[0]) as { index: number; role: string; content: string };
    expect(firstTurn).toEqual({
      index: 1,
      role: 'user',
      content: 'What is Keystone?',
      timestamp: 1730000001,
    });

    // Switch to Plain Text view
    tabTxt.click();
    expect(previewPanel.textContent).toContain('Title: Keystone Context Design');
    expect(previewPanel.textContent).toContain('[USER]');
    expect(previewPanel.textContent).toContain('[ASSISTANT (gpt-4o)]');

    // Trigger Markdown download & clipboard copy
    downloadMdBtn.click();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    copyBtn.click();
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('# Keystone Context Design'),
      );
    });
  });

  it('falls back to mapping DAG traversal when linear_conversation is absent', async () => {
    const dagPayload = {
      title: 'DAG Fallback Chat',
      current_node: 'node-2',
      mapping: {
        'node-1': {
          parent: null,
          message: {
            id: 'm1',
            author: { role: 'user' },
            content: { parts: ['First DAG message'] },
          },
        },
        'node-2': {
          parent: 'node-1',
          message: {
            id: 'm2',
            author: { role: 'assistant' },
            metadata: { resolved_model_slug: 'o3-mini' },
            content: { parts: ['Second DAG message'] },
          },
        },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(dagPayload), { status: 200 }),
    );

    const input = document.getElementById('input-share-url') as HTMLInputElement;
    const fetchBtn = document.getElementById('btn-fetch') as HTMLButtonElement;
    const previewPanel = document.getElementById('preview-panel') as HTMLElement;

    input.value = VALID_UUID;
    fetchBtn.click();

    await vi.waitFor(() => {
      expect(previewPanel.textContent).toContain('First DAG message');
    });
    expect(previewPanel.textContent).toContain('## Assistant (o3-mini)');
    expect(previewPanel.textContent).toContain('Second DAG message');
  });
});
