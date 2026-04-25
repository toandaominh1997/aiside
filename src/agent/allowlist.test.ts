import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTest, addAll, has, list, revoke, touch } from './allowlist';

function mockStorage(initial: Record<string, unknown> = {}) {
  let state = { ...initial };
  vi.mocked(chrome.storage.local.get).mockImplementation(((keys: string | string[]) => {
    const lookup = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const key of lookup) {
      if (key in state) out[key] = state[key];
    }
    return Promise.resolve(out);
  }) as typeof chrome.storage.local.get);
  vi.mocked(chrome.storage.local.set).mockImplementation(((obj: Record<string, unknown>) => {
    state = { ...state, ...obj };
    return Promise.resolve();
  }) as typeof chrome.storage.local.set);
  return () => state;
}

describe('agent/allowlist', () => {
  beforeEach(() => {
    _resetForTest();
    vi.clearAllMocks();
  });

  it('starts empty', async () => {
    mockStorage();
    expect(await has('https://example.com')).toBe(false);
    expect(await list()).toEqual([]);
  });

  it('addAll persists origins (normalized) and has() returns true', async () => {
    const getState = mockStorage();
    await addAll(['HTTPS://Example.com/path', 'http://x.test:8080']);
    expect(await has('https://example.com')).toBe(true);
    expect(await has('http://x.test:8080')).toBe(true);
    expect(await has('https://other.com')).toBe(false);
    const stored = (getState().siteAllowlist as { origins: Record<string, unknown> }).origins;
    expect(Object.keys(stored).sort()).toEqual(['http://x.test:8080', 'https://example.com']);
  });

  it('addAll is idempotent and updates lastUsedAt', async () => {
    mockStorage();
    await addAll(['https://example.com']);
    const first = (await list())[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addAll(['https://example.com']);
    const second = (await list())[0];
    expect(second.addedAt).toBe(first.addedAt);
    expect(second.lastUsedAt).toBeGreaterThanOrEqual(first.lastUsedAt);
  });

  it('subdomain isolation: approving a subdomain does not approve the parent', async () => {
    mockStorage();
    await addAll(['https://learning.oreilly.com']);
    expect(await has('https://learning.oreilly.com')).toBe(true);
    expect(await has('https://oreilly.com')).toBe(false);
    expect(await has('https://auth.oreilly.com')).toBe(false);
  });

  it('revoke removes a single origin', async () => {
    mockStorage();
    await addAll(['https://a.com', 'https://b.com']);
    await revoke('https://a.com');
    expect(await has('https://a.com')).toBe(false);
    expect(await has('https://b.com')).toBe(true);
  });

  it('touch updates lastUsedAt only', async () => {
    mockStorage();
    await addAll(['https://x.com']);
    const before = (await list())[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
    await touch('https://x.com');
    const after = (await list())[0];
    expect(after.addedAt).toBe(before.addedAt);
    expect(after.lastUsedAt).toBeGreaterThan(before.lastUsedAt);
  });
});
