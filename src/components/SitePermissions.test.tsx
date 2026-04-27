import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SitePermissions } from './SitePermissions';
import { ALLOWLIST_STORAGE_KEY } from '../agent/allowlist';

function mockStorage(initial: Record<string, unknown>) {
  let state: Record<string, unknown> = { ...initial };
  vi.mocked(chrome.storage.local.get).mockImplementation(((keys, callback) => {
    const lookup = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(state);
    const out: Record<string, unknown> = {};
    for (const key of lookup) if (key in state) out[key] = state[key];
    if (typeof callback === 'function') callback(out);
    return Promise.resolve(out);
  }) as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(((data, callback) => {
    state = { ...state, ...(data as Record<string, unknown>) };
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  }) as typeof chrome.storage.local.set);
}

describe('SitePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows default-allow state when no sites are blocked', async () => {
    mockStorage({});
    render(<SitePermissions />);
    await waitFor(() => {
      expect(screen.getByText(/All http:\/\/ and https:\/\/ sites are approved by default/i)).toBeInTheDocument();
    });
  });

  it('renders rows for configured origin overrides', async () => {
    mockStorage({
      [ALLOWLIST_STORAGE_KEY]: {
        version: 1,
        origins: {
          'https://a.com': { addedAt: 1, lastUsedAt: 1 },
          'https://b.com': { addedAt: 2, lastUsedAt: 2 },
        },
      },
    });
    render(<SitePermissions />);
    await waitFor(() => {
      expect(screen.getByText('https://a.com')).toBeInTheDocument();
      expect(screen.getByText('https://b.com')).toBeInTheDocument();
    });
  });

  it('removes an origin override when Remove is clicked', async () => {
    mockStorage({
      [ALLOWLIST_STORAGE_KEY]: {
        version: 1,
        origins: { 'https://a.com': { addedAt: 1, lastUsedAt: 1, modes: { act: 'never' } } },
      },
    });
    render(<SitePermissions />);
    await waitFor(() => screen.getByText('https://a.com'));
    fireEvent.click(screen.getByRole('button', { name: /Remove$/ }));
    await waitFor(() => {
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  it('adds a blocked origin from the form', async () => {
    mockStorage({});
    render(<SitePermissions />);
    fireEvent.change(screen.getByLabelText(/Origin to block/i), { target: { value: 'https://blocked.com/path' } });
    fireEvent.click(screen.getByRole('button', { name: /Block site/i }));
    await waitFor(() => {
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [ALLOWLIST_STORAGE_KEY]: expect.objectContaining({
            origins: expect.objectContaining({
              'https://blocked.com': expect.objectContaining({ modes: expect.objectContaining({ act: 'never' }) }),
            }),
          }),
        }),
        expect.any(Function),
      );
    });
  });

  it('confirm clear all blocks wipes the list', async () => {
    mockStorage({
      [ALLOWLIST_STORAGE_KEY]: {
        version: 1,
        origins: { 'https://a.com': { addedAt: 1, lastUsedAt: 1 } },
      },
    });
    render(<SitePermissions />);
    await waitFor(() => screen.getByText('https://a.com'));
    fireEvent.click(screen.getByRole('button', { name: /Clear all blocks/i }));
    expect(screen.getByRole('dialog', { name: /Confirm clear all blocks/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yes, clear all/i }));
    await waitFor(() => {
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });
});
