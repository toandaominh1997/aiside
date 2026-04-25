import { normalizeOrigin } from './plan';

const KEY = 'siteAllowlist';

interface Entry {
  addedAt: number;
  lastUsedAt: number;
}

interface Store {
  origins: Record<string, Entry>;
}

async function read(): Promise<Store> {
  const res = await chrome.storage.local.get(KEY);
  const value = (res as Record<string, unknown>)[KEY] as Store | undefined;
  return value && typeof value === 'object' && value.origins ? value : { origins: {} };
}

async function write(store: Store): Promise<void> {
  await chrome.storage.local.set({ [KEY]: store });
}

export async function has(origin: string): Promise<boolean> {
  const normalized = safeNormalize(origin);
  if (!normalized) return false;
  const store = await read();
  return Boolean(store.origins[normalized]);
}

export async function addAll(origins: string[]): Promise<void> {
  const store = await read();
  const now = Date.now();

  for (const raw of origins) {
    const origin = normalizeOrigin(raw);
    const existing = store.origins[origin];
    store.origins[origin] = {
      addedAt: existing ? existing.addedAt : now,
      lastUsedAt: now,
    };
  }

  await write(store);
}

export async function revoke(origin: string): Promise<void> {
  const normalized = safeNormalize(origin);
  if (!normalized) return;
  const store = await read();
  delete store.origins[normalized];
  await write(store);
}

export async function list(): Promise<Array<{ origin: string; addedAt: number; lastUsedAt: number }>> {
  const store = await read();
  return Object.entries(store.origins).map(([origin, entry]) => ({ origin, ...entry }));
}

export async function touch(origin: string): Promise<void> {
  const normalized = safeNormalize(origin);
  if (!normalized) return;
  const store = await read();
  if (!store.origins[normalized]) return;
  store.origins[normalized].lastUsedAt = Date.now();
  await write(store);
}

function safeNormalize(origin: string): string | null {
  try {
    return normalizeOrigin(origin);
  } catch {
    return null;
  }
}

export function _resetForTest(): void {}
