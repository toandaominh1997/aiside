import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Options from './options';

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
  return () => state;
}

describe('Options component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage({
      provider: 'openai',
      apiKey: 'test-api-key',
      baseUrl: 'https://test.api.com',
      model: 'test-model',
      sendScreenshots: false,
      siteAllowlist: { origins: {} },
    });
  });

  it('renders the options form correctly', async () => {
    render(<Options />);

    expect(screen.getByText('Aiside Configuration')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue('test-api-key')).toBeInTheDocument();
      expect(screen.getByDisplayValue('https://test.api.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('test-model')).toBeInTheDocument();
    });
  });

  it('allows user to change values and save them', async () => {
    const user = userEvent.setup();
    render(<Options />);

    await waitFor(() => screen.getByDisplayValue('test-api-key'));

    const apiKeyInput = screen.getByLabelText('API Key');
    const baseUrlInput = screen.getByLabelText('Base URL');
    const modelInput = screen.getByLabelText('Model Name');
    const saveButton = screen.getByRole('button', { name: 'Save Settings' });

    await user.clear(apiKeyInput);
    await user.type(apiKeyInput, 'new-api-key');

    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, 'https://new.api.com');

    await user.clear(modelInput);
    await user.type(modelInput, 'new-model');

    await user.click(saveButton);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      {
        provider: 'openai',
        apiKey: 'new-api-key',
        baseUrl: 'https://new.api.com',
        model: 'new-model',
        sendScreenshots: false,
      },
      expect.any(Function),
    );

    expect(await screen.findByText('Saved!')).toBeInTheDocument();
  });

  it('renders provider radios with anthropic checked', async () => {
    mockStorage({
      provider: 'anthropic',
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      model: 'claude-opus-4-7',
      sendScreenshots: false,
      siteAllowlist: { origins: {} },
    });

    render(<Options />);

    await waitFor(() => {
      expect(screen.getByLabelText(/anthropic/i)).toBeChecked();
      expect(screen.getByLabelText(/openai-compatible/i)).not.toBeChecked();
    });
  });

  it('shows the screenshots toggle (default off)', async () => {
    render(<Options />);

    await waitFor(() => {
      expect(screen.getByLabelText(/send screenshots/i)).not.toBeChecked();
    });
  });

  it('renders the allowed origin and revokes it on click', async () => {
    const getState = mockStorage({
      provider: 'anthropic',
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      model: 'claude-opus-4-7',
      sendScreenshots: false,
      siteAllowlist: {
        origins: { 'https://example.com': { addedAt: 1, lastUsedAt: 2 } },
      },
    });
    const user = userEvent.setup();

    render(<Options />);

    await waitFor(() => screen.getByText('https://example.com'));
    await user.click(screen.getByRole('button', { name: /^revoke$/i }));

    await waitFor(() => {
      expect(getState().siteAllowlist).toEqual({ origins: {} });
    });
  });
});
