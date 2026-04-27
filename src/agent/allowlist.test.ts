import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addOrigins,
  ALLOWLIST_STORAGE_KEY,
  actMode,
  isAllowed,
  loadAllowlist,
  revokeAll,
  revokeOrigin,
  setOriginActMode,
  touchOrigin,
} from './allowlist';

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
  return {
    snapshot: () => state,
  };
}

describe('agent/allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty allowlist when storage is empty', async () => {
    mockStorage({});
    const list = await loadAllowlist();
    expect(list).toEqual({ version: 1, origins: {} });
  });

  it('migrates legacy shape without version', async () => {
    mockStorage({ [ALLOWLIST_STORAGE_KEY]: { origins: { 'https://x.com': { addedAt: 1, lastUsedAt: 2 } } } });
    const list = await loadAllowlist();
    expect(list.version).toBe(1);
    expect(list.origins['https://x.com']).toMatchObject({ addedAt: 1, lastUsedAt: 2 });
  });

  it('addOrigins normalizes origins and is idempotent', async () => {
    const store = mockStorage({});
    await addOrigins(['HTTPS://Example.COM/path?x=1', 'https://example.com']);
    const list = await loadAllowlist();
    expect(Object.keys(list.origins)).toEqual(['https://example.com']);
    expect(store.snapshot()[ALLOWLIST_STORAGE_KEY]).toBeDefined();
  });

  it('keeps subdomains isolated', async () => {
    mockStorage({});
    await addOrigins(['https://learning.oreilly.com', 'https://oreilly.com']);
    const list = await loadAllowlist();
    expect(Object.keys(list.origins).sort()).toEqual(['https://learning.oreilly.com', 'https://oreilly.com']);
  });

  it('revokeOrigin removes a single entry', async () => {
    mockStorage({});
    await addOrigins(['https://a.com', 'https://b.com']);
    await revokeOrigin('https://a.com');
    const list = await loadAllowlist();
    expect(Object.keys(list.origins)).toEqual(['https://b.com']);
  });

  it('revokeAll clears every entry', async () => {
    mockStorage({});
    await addOrigins(['https://a.com', 'https://b.com']);
    const cleared = await revokeAll();
    expect(cleared.origins).toEqual({});
  });

  it('touchOrigin updates lastUsedAt only when origin exists', async () => {
    mockStorage({});
    await addOrigins(['https://a.com']);
    const before = (await loadAllowlist()).origins['https://a.com'].lastUsedAt;
    await new Promise((r) => setTimeout(r, 5));
    await touchOrigin('https://a.com/some/path');
    await touchOrigin('https://nope.com');
    const list = await loadAllowlist();
    expect(list.origins['https://a.com'].lastUsedAt).toBeGreaterThanOrEqual(before);
    expect(list.origins['https://nope.com']).toBeUndefined();
  });

  it('setOriginActMode persists per-origin act mode', async () => {
    mockStorage({});
    await addOrigins(['https://a.com']);
    const list = await setOriginActMode('https://a.com', 'auto');
    expect(list.origins['https://a.com'].modes?.act).toBe('auto');
    expect(actMode(list, 'https://a.com/x')).toBe('auto');
  });

  it('allows valid origins by default and blocks never-mode origins', async () => {
    let list = await addOrigins(['https://x.com']);
    list = await setOriginActMode('https://x.com', 'never');
    expect(isAllowed(list, 'https://other.com')).toBe(true);
    expect(isAllowed(list, 'https://x.com/anything')).toBe(false);
    expect(isAllowed(list, 'not a url')).toBe(false);
  });

  it('defaults action mode to auto for origins without overrides', () => {
    expect(actMode({ version: 1, origins: {} }, 'https://x.com')).toBe('auto');
    expect(actMode({ version: 1, origins: {} }, 'not a url')).toBe('never');
  });
});
