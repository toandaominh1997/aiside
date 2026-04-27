import { normalizeOrigin, PlanValidationError } from './plan';

export type PerActionMode = 'auto' | 'ask' | 'never';

export interface OriginPolicy {
  addedAt: number;
  lastUsedAt: number;
  modes?: { read?: 'auto' | 'ask'; act?: PerActionMode };
}

export interface Allowlist {
  version: 1;
  origins: Record<string, OriginPolicy>;
}

const STORAGE_KEY = 'siteAllowlist';

function emptyAllowlist(): Allowlist {
  return { version: 1, origins: {} };
}

function migrate(input: unknown): Allowlist {
  if (!input || typeof input !== 'object') return emptyAllowlist();
  const obj = input as { version?: number; origins?: unknown };
  const origins = obj.origins && typeof obj.origins === 'object' ? (obj.origins as Record<string, unknown>) : {};
  const out: Allowlist = emptyAllowlist();
  for (const [origin, raw] of Object.entries(origins)) {
    if (!raw || typeof raw !== 'object') continue;
    const policy = raw as Partial<OriginPolicy>;
    out.origins[origin] = {
      addedAt: typeof policy.addedAt === 'number' ? policy.addedAt : Date.now(),
      lastUsedAt: typeof policy.lastUsedAt === 'number' ? policy.lastUsedAt : Date.now(),
      modes: policy.modes && typeof policy.modes === 'object' ? policy.modes : undefined,
    };
  }
  return out;
}

export async function loadAllowlist(): Promise<Allowlist> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(migrate(result?.[STORAGE_KEY]));
    });
  });
}

async function save(allowlist: Allowlist): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: allowlist }, () => resolve());
  });
}

function safeNormalize(origin: string): string | null {
  try {
    return normalizeOrigin(origin);
  } catch (err) {
    if (err instanceof PlanValidationError) return null;
    throw err;
  }
}

export async function addOrigins(origins: string[]): Promise<Allowlist> {
  const list = await loadAllowlist();
  const now = Date.now();
  for (const origin of origins) {
    const normalized = safeNormalize(origin);
    if (!normalized) continue;
    const existing = list.origins[normalized];
    list.origins[normalized] = existing
      ? { ...existing, lastUsedAt: now }
      : { addedAt: now, lastUsedAt: now };
  }
  await save(list);
  return list;
}

export async function revokeOrigin(origin: string): Promise<Allowlist> {
  const list = await loadAllowlist();
  const normalized = safeNormalize(origin) ?? origin;
  delete list.origins[normalized];
  await save(list);
  return list;
}

export async function revokeAll(): Promise<Allowlist> {
  const cleared = emptyAllowlist();
  await save(cleared);
  return cleared;
}

export async function touchOrigin(origin: string): Promise<void> {
  const normalized = safeNormalize(origin);
  if (!normalized) return;
  const list = await loadAllowlist();
  if (!list.origins[normalized]) return;
  list.origins[normalized] = { ...list.origins[normalized], lastUsedAt: Date.now() };
  await save(list);
}

export async function setOriginActMode(origin: string, mode: PerActionMode): Promise<Allowlist> {
  const list = await loadAllowlist();
  const normalized = safeNormalize(origin);
  if (!normalized) return list;
  const existing = list.origins[normalized] ?? { addedAt: Date.now(), lastUsedAt: Date.now() };
  list.origins[normalized] = {
    ...existing,
    modes: { ...existing.modes, act: mode },
  };
  await save(list);
  return list;
}

export function isAllowed(list: Allowlist, origin: string): boolean {
  const normalized = safeNormalize(origin);
  if (!normalized) return false;
  return list.origins[normalized]?.modes?.act !== 'never';
}

export function actMode(list: Allowlist, origin: string): PerActionMode {
  const normalized = safeNormalize(origin);
  if (!normalized) return 'never';
  return list.origins[normalized]?.modes?.act ?? 'auto';
}

export const ALLOWLIST_STORAGE_KEY = STORAGE_KEY;
