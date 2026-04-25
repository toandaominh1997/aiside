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

import { sendToAgentTab } from './agent/tabs';
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
    fireEvent.change(screen.getByPlaceholderText(/Ask Aiside/i), {
      target: { value: 'do the thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => screen.getByRole('button', { name: /approve plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve plan/i }));

    await waitFor(() => expect(screen.getAllByText(/done!/i).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(fakeProvider.runAgentStep).toHaveBeenCalledTimes(2);
  });
});
