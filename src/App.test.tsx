import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./providers/index', () => ({
  selectProvider: vi.fn(),
}));

vi.mock('./agent/tabs', () => ({
  openAgentTab: vi.fn().mockResolvedValue(42),
  getAgentTabUrl: vi.fn().mockResolvedValue('https://example.com'),
  navigateAgentTab: vi.fn().mockResolvedValue(undefined),
  sendToAgentTab: vi.fn(),
  onAgentTabClosed: vi.fn().mockReturnValue(() => {}),
}));

import { sendToAgentTab, onAgentTabClosed, getAgentTabUrl, navigateAgentTab } from './agent/tabs';
import { selectProvider } from './providers/index';
import type { Provider } from './providers/types';

function mockStorage(initial: Record<string, unknown>) {
  let state = { ...initial };
  vi.mocked(chrome.storage.local.get).mockImplementation(((keys, callback) => {
    const lookup = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const key of lookup) {
      if (key in state) out[key] = state[key];
    }
    if (typeof callback === 'function') callback(out);
    return Promise.resolve(out);
  }) as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(((data, callback) => {
    state = { ...state, ...(data as Record<string, unknown>) };
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  }) as typeof chrome.storage.local.set);
}

describe('App integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-opus-4-7',
      baseUrl: 'https://api.openai.com/v1',
      chatHistory: [],
      siteAllowlist: { origins: {} },
    });
    vi.mocked(chrome.tabs.query).mockImplementation(((query, callback) => {
      void query;
      const tabs = [{ id: 1, url: 'https://example.com', title: 'Ex' }];
      if (callback) callback(tabs);
      return Promise.resolve(tabs);
    }) as typeof chrome.tabs.query);
    vi.mocked(getAgentTabUrl).mockResolvedValue('https://example.com');
    vi.mocked(navigateAgentTab).mockResolvedValue(undefined);
    vi.mocked(onAgentTabClosed).mockReturnValue(() => {});
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('plans, lets the user approve, and runs to finish', async () => {
    const fakeProvider = {
      proposePlan: vi.fn().mockResolvedValue({
        summary: 'do',
        steps: ['s1'],
        sites: ['https://example.com'],
      }),
      runAgentStep: vi
        .fn()
        .mockResolvedValueOnce({ tool: 'click', targetId: 1, rationale: 'r' })
        .mockResolvedValueOnce({ tool: 'finish', summary: 'done!' }),
    };
    vi.mocked(selectProvider).mockReturnValue(fakeProvider as Provider);
    vi.mocked(sendToAgentTab).mockImplementation(async (_tabId, message) => {
      if ((message as { type?: string }).type === 'GET_DOM_TREE') {
        return {
          dom: '<button id="1">x</button>',
          url: 'https://example.com',
          title: 'Ex',
        };
      }
      return { success: true, message: 'ok' };
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Act without asking/i }));
    fireEvent.click(screen.getByRole('option', { name: /Ask before acting/i }));
    fireEvent.change(screen.getByPlaceholderText(/Type \/ for commands/i), {
      target: { value: 'do the thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    const approveButton = await screen.findByRole('button', { name: /Approve plan/i }, { timeout: 3000 });
    fireEvent.click(approveButton);

    await waitFor(() => expect(screen.getAllByText(/done!/i).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(fakeProvider.runAgentStep).toHaveBeenCalledTimes(2);
    expect(sendToAgentTab).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'GET_DOM_TREE' }));
  });

  it('seeds initial messages with the user prompt', async () => {
    const fakeProvider = {
      proposePlan: vi.fn().mockResolvedValue({
        summary: 'do',
        steps: ['s1'],
        sites: ['https://example.com'],
      }),
      runAgentStep: vi.fn().mockResolvedValue({ tool: 'finish', summary: 'done!' }),
    };
    vi.mocked(selectProvider).mockReturnValue(fakeProvider as Provider);
    vi.mocked(sendToAgentTab).mockImplementation(async (_tabId, message) => {
      if ((message as { type?: string }).type === 'GET_DOM_TREE') {
        return { dom: '<button id="1">x</button>', url: 'https://example.com', title: 'Ex' };
      }
      return { success: true, message: 'ok' };
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Act without asking/i }));
    fireEvent.click(screen.getByRole('option', { name: /Ask before acting/i }));
    fireEvent.change(screen.getByPlaceholderText(/Type \/ for commands/i), {
      target: { value: 'find me books' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    const approve = await screen.findByRole('button', { name: /Approve plan/i });
    fireEvent.click(approve);

    await waitFor(() => expect(fakeProvider.runAgentStep).toHaveBeenCalled());
    const firstCall = fakeProvider.runAgentStep.mock.calls[0][0] as { history: Array<{ content: string }> };
    expect(firstCall.history.some((m) => m.content.includes('find me books'))).toBe(true);
  });

  it('declining a plan returns the user to the input draft', async () => {
    const fakeProvider = {
      proposePlan: vi.fn().mockResolvedValue({ summary: 'do', steps: ['s1'], sites: ['https://example.com'] }),
      runAgentStep: vi.fn(),
    };
    vi.mocked(selectProvider).mockReturnValue(fakeProvider as Provider);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Act without asking/i }));
    fireEvent.click(screen.getByRole('option', { name: /Ask before acting/i }));
    fireEvent.change(screen.getByPlaceholderText(/Type \/ for commands/i), {
      target: { value: 'do thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    const makeChanges = await screen.findByRole('button', { name: /Make changes/i });
    fireEvent.click(makeChanges);
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Type \/ for commands/i) as HTMLTextAreaElement;
      expect(textarea.value).toContain('do thing');
    });
    expect(fakeProvider.runAgentStep).not.toHaveBeenCalled();
  });

  it('auto mode runs without a plan card on already approved auto sites', async () => {
    mockStorage({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-opus-4-7',
      baseUrl: 'https://api.openai.com/v1',
      chatHistory: [],
      siteAllowlist: {
        version: 1,
        origins: {
          'https://example.com': {
            addedAt: Date.now(),
            lastUsedAt: Date.now(),
            modes: { act: 'auto' },
          },
        },
      },
    });
    const fakeProvider = {
      proposePlan: vi.fn().mockResolvedValue({ summary: 'do', steps: ['s1'], sites: ['https://example.com'] }),
      runAgentStep: vi.fn().mockResolvedValue({ tool: 'finish', summary: 'done!' }),
    };
    vi.mocked(selectProvider).mockReturnValue(fakeProvider as Provider);
    vi.mocked(sendToAgentTab).mockImplementation(async (_tabId, message) => {
      if ((message as { type?: string }).type === 'GET_DOM_TREE') {
        return { dom: '<button id="1">x</button>', url: 'https://example.com', title: 'Ex' };
      }
      return { success: true, message: 'ok' };
    });

    render(<App />);
    expect(screen.getByRole('button', { name: /Act without asking/i })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Type \/ for commands/i), {
      target: { value: 'do thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(fakeProvider.runAgentStep).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Approve plan/i })).not.toBeInTheDocument();
  });
});
