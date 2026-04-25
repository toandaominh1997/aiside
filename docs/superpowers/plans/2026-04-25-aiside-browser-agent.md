# Aiside Browser Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plan-and-approve UX, persistent revocable site allowlist, and dual-provider (Anthropic + OpenAI-compatible) tool-call agent loop to the existing Aiside Chrome side-panel extension.

**Architecture:** Extract the new behavior into focused modules under `src/providers/`, `src/agent/`, and `src/components/`. `App.tsx` becomes a thin coordinator. The agent runs in a dedicated new tab; navigation off the user-approved allowlist auto-pauses execution.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Tailwind, Chrome Extension MV3, Anthropic Messages API, OpenAI-compatible chat completions.

**Spec:** [`docs/superpowers/specs/2026-04-25-aiside-browser-agent-design.md`](../specs/2026-04-25-aiside-browser-agent-design.md)

---

## File Structure

**New files:**
- `src/providers/types.ts` — `Provider`, `Plan`, `AgentAction`, `Message` interfaces.
- `src/providers/toolSchemas.ts` — Shared tool JSON schemas (`propose_plan`, `click`, `type`, `navigate`, `scroll`, `finish`).
- `src/providers/openai.ts` — OpenAI-compatible adapter (tools + JSON-fallback).
- `src/providers/anthropic.ts` — Anthropic Messages API adapter.
- `src/providers/index.ts` — `selectProvider(config)` factory.
- `src/agent/plan.ts` — Plan validation, origin normalization.
- `src/agent/allowlist.ts` — `chrome.storage.local`-backed permission store.
- `src/agent/tabs.ts` — Agent tab lifecycle (open, route, off-allowlist guard).
- `src/agent/loop.ts` — Run-plan executor (max-step, retry, stop, action log).
- `src/components/PlanCard.tsx` — Approve / Make changes UI.
- `src/components/ActionLogRow.tsx` — Collapsible step row.
- Sibling `*.test.ts(x)` for each of the above.

**Modified files:**
- `src/App.tsx` — Becomes the coordinator wiring above modules.
- `src/options.tsx` — Adds Provider, Agent settings, Site permissions sections.
- `src/vitest-setup.ts` — Extend Chrome mock with `tabs.create`, `tabs.get`, `tabs.update`, `tabs.onRemoved`, `tabs.onUpdated`, `tabs.captureVisibleTab`, `runtime.lastError`.

**Unchanged:** `src/content.ts`, `src/background.ts` (we may add a small router but not required), `public/manifest.json` (existing `tabs`/`scripting`/`storage`/`<all_urls>` covers all new behavior).

---

## Task 0: Initialize git repository

The project isn't a git repo yet, but the plan relies on one commit per task.

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Init repo**

```bash
cd /Users/tcx/code/aiside
git init
```

- [ ] **Step 2: Add .gitignore**

```gitignore
node_modules/
dist/
coverage/
.DS_Store
*.log
```

- [ ] **Step 3: Baseline commit**

```bash
git add -A
git commit -m "chore: baseline before browser-agent feature"
```

Expected: commit succeeds; `git log` shows one commit.

---

## Task 1: Extend vitest Chrome mock

The existing mock in `src/vitest-setup.ts` doesn't cover all the Chrome APIs the new modules use. Extend it once so every later test can rely on it.

**Files:**
- Modify: `src/vitest-setup.ts`

- [ ] **Step 1: Replace the mockChrome object with the extended version**

Open `src/vitest-setup.ts` and replace the `mockChrome` declaration with:

```ts
const mockChrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    lastError: undefined as undefined | { message: string },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    captureVisibleTab: vi.fn(),
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  sidePanel: {
    setPanelBehavior: vi.fn(() => Promise.resolve()),
    open: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
};
```

- [ ] **Step 2: Run the existing test suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — same test count as before (extending the mock should not break anything).

- [ ] **Step 3: Commit**

```bash
git add src/vitest-setup.ts
git commit -m "test: extend chrome mock with tabs and runtime.lastError"
```

---

## Task 2: Provider types

Pure-interface module. No runtime code, no test. Existence verified by tasks that import it.

**Files:**
- Create: `src/providers/types.ts`

- [ ] **Step 1: Create the types file**

```ts
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Plan {
  summary: string;
  steps: string[];
  sites: string[];
}

export type AgentAction =
  | { tool: 'click'; targetId: number; rationale: string }
  | { tool: 'type'; targetId: number; value: string; rationale: string }
  | { tool: 'navigate'; url: string; rationale: string }
  | { tool: 'scroll'; direction: 'down' | 'up'; rationale: string }
  | { tool: 'finish'; summary: string };

export interface ProviderConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl?: string;
  model: string;
  sendScreenshots?: boolean;
}

export interface ProposePlanInput {
  history: Message[];
  currentTab: { url: string; title: string };
  signal: AbortSignal;
}

export interface RunAgentStepInput {
  plan: Plan;
  history: Message[];
  dom: string;
  screenshot?: string;
  signal: AbortSignal;
}

export interface Provider {
  proposePlan(input: ProposePlanInput): Promise<Plan>;
  runAgentStep(input: RunAgentStepInput): Promise<AgentAction>;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/providers/types.ts
git commit -m "feat(providers): add Provider/Plan/AgentAction types"
```

---

## Task 3: Tool JSON schemas

Shared schemas used by both providers. Pure data; tests verify shape.

**Files:**
- Create: `src/providers/toolSchemas.ts`
- Test: `src/providers/toolSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { TOOL_SCHEMAS, PROPOSE_PLAN_SCHEMA } from './toolSchemas';

describe('toolSchemas', () => {
  it('exposes the five action tools by name', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name).sort();
    expect(names).toEqual(['click', 'finish', 'navigate', 'scroll', 'type']);
  });

  it('every action tool has a description and input_schema with type=object', () => {
    for (const t of TOOL_SCHEMAS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.properties).toBeTypeOf('object');
    }
  });

  it('click requires targetId and rationale', () => {
    const click = TOOL_SCHEMAS.find((t) => t.name === 'click')!;
    expect(click.input_schema.required).toEqual(
      expect.arrayContaining(['targetId', 'rationale']),
    );
  });

  it('type requires targetId, value, rationale', () => {
    const type = TOOL_SCHEMAS.find((t) => t.name === 'type')!;
    expect(type.input_schema.required).toEqual(
      expect.arrayContaining(['targetId', 'value', 'rationale']),
    );
  });

  it('propose_plan requires summary, steps, sites', () => {
    expect(PROPOSE_PLAN_SCHEMA.name).toBe('propose_plan');
    expect(PROPOSE_PLAN_SCHEMA.input_schema.required).toEqual(
      expect.arrayContaining(['summary', 'steps', 'sites']),
    );
  });
});
```

- [ ] **Step 2: Run the test — it must fail**

Run: `npx vitest run src/providers/toolSchemas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schemas**

```ts
// src/providers/toolSchemas.ts
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const PROPOSE_PLAN_SCHEMA: ToolSchema = {
  name: 'propose_plan',
  description:
    'Propose a plan for the user to approve before any browser actions are taken. Include the sites you need permission to act on and a numbered list of steps.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One-line description of the overall goal (max 200 chars).',
      },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: '1-10 ordered steps describing the approach.',
      },
      sites: {
        type: 'array',
        items: { type: 'string' },
        description: '1-5 origins (https://host) the agent needs to act on.',
      },
    },
    required: ['summary', 'steps', 'sites'],
  },
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'click',
    description: 'Click an interactive element by its numeric id from the simplified DOM.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: 'number', description: 'The numeric id of the element.' },
        rationale: { type: 'string', description: 'Why this click is the right next step.' },
      },
      required: ['targetId', 'rationale'],
    },
  },
  {
    name: 'type',
    description: 'Type text into an input or textarea element by id.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: 'number' },
        value: { type: 'string', description: 'Text to type.' },
        rationale: { type: 'string' },
      },
      required: ['targetId', 'value', 'rationale'],
    },
  },
  {
    name: 'navigate',
    description: 'Navigate the agent tab to a new URL. Must be on the approved site allowlist.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL or path resolved against the current page.' },
        rationale: { type: 'string' },
      },
      required: ['url', 'rationale'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page up or down by roughly one viewport.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up'] },
        rationale: { type: 'string' },
      },
      required: ['direction', 'rationale'],
    },
  },
  {
    name: 'finish',
    description: 'Signal the task is complete. Provide the user-facing summary.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Final answer or summary for the user.' },
      },
      required: ['summary'],
    },
  },
];
```

- [ ] **Step 4: Run test — must pass**

Run: `npx vitest run src/providers/toolSchemas.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/providers/toolSchemas.ts src/providers/toolSchemas.test.ts
git commit -m "feat(providers): add shared tool JSON schemas"
```

---

## Task 4: Plan validation

Pure-function module. Validates `Plan` shape and normalizes site origins.

**Files:**
- Create: `src/agent/plan.ts`
- Test: `src/agent/plan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validatePlan, normalizeOrigin, PlanValidationError } from './plan';

describe('agent/plan', () => {
  describe('normalizeOrigin', () => {
    it('lowercases host and keeps scheme', () => {
      expect(normalizeOrigin('HTTPS://Example.COM/path?q=1')).toBe('https://example.com');
    });
    it('preserves non-default port', () => {
      expect(normalizeOrigin('http://localhost:8080/x')).toBe('http://localhost:8080');
    });
    it('rejects non-http(s) schemes', () => {
      expect(() => normalizeOrigin('chrome://settings')).toThrow();
      expect(() => normalizeOrigin('file:///etc/passwd')).toThrow();
    });
    it('rejects garbage', () => {
      expect(() => normalizeOrigin('not a url')).toThrow();
    });
  });

  describe('validatePlan', () => {
    const ok = {
      summary: 'do the thing',
      steps: ['a', 'b'],
      sites: ['https://example.com'],
    };

    it('accepts a well-formed plan and normalizes origins', () => {
      const plan = validatePlan({
        summary: 'do',
        steps: ['a'],
        sites: ['HTTPS://Example.com/page'],
      });
      expect(plan.sites).toEqual(['https://example.com']);
    });

    it('rejects empty summary', () => {
      expect(() => validatePlan({ ...ok, summary: '' })).toThrow(PlanValidationError);
    });
    it('rejects oversize summary', () => {
      expect(() => validatePlan({ ...ok, summary: 'x'.repeat(201) })).toThrow(PlanValidationError);
    });
    it('rejects 0 steps', () => {
      expect(() => validatePlan({ ...ok, steps: [] })).toThrow(PlanValidationError);
    });
    it('rejects 11 steps', () => {
      expect(() => validatePlan({ ...ok, steps: Array(11).fill('s') })).toThrow(PlanValidationError);
    });
    it('rejects 0 sites', () => {
      expect(() => validatePlan({ ...ok, sites: [] })).toThrow(PlanValidationError);
    });
    it('rejects 6 sites', () => {
      expect(() => validatePlan({ ...ok, sites: Array(6).fill('https://example.com') })).toThrow(
        PlanValidationError,
      );
    });
    it('rejects non-http site', () => {
      expect(() => validatePlan({ ...ok, sites: ['chrome://settings'] })).toThrow(
        PlanValidationError,
      );
    });
    it('rejects missing fields', () => {
      expect(() => validatePlan({ summary: 'x', steps: ['s'] } as any)).toThrow(
        PlanValidationError,
      );
    });
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/agent/plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/plan.ts
import type { Plan } from '../providers/types';

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

export function normalizeOrigin(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new PlanValidationError(`Invalid URL: ${input}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PlanValidationError(`Unsupported scheme: ${parsed.protocol}`);
  }
  return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
}

export function validatePlan(input: unknown): Plan {
  if (!input || typeof input !== 'object') {
    throw new PlanValidationError('Plan must be an object');
  }
  const obj = input as Record<string, unknown>;

  const summary = obj.summary;
  if (typeof summary !== 'string' || summary.length === 0 || summary.length > 200) {
    throw new PlanValidationError('summary must be a non-empty string ≤ 200 chars');
  }

  const steps = obj.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 10) {
    throw new PlanValidationError('steps must be an array of 1-10 items');
  }
  for (const s of steps) {
    if (typeof s !== 'string' || s.length === 0 || s.length > 200) {
      throw new PlanValidationError('each step must be a non-empty string ≤ 200 chars');
    }
  }

  const sites = obj.sites;
  if (!Array.isArray(sites) || sites.length < 1 || sites.length > 5) {
    throw new PlanValidationError('sites must be an array of 1-5 origins');
  }
  const normalizedSites = sites.map((s) => {
    if (typeof s !== 'string') {
      throw new PlanValidationError('each site must be a string');
    }
    return normalizeOrigin(s);
  });

  return { summary, steps: steps as string[], sites: normalizedSites };
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/agent/plan.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/agent/plan.ts src/agent/plan.test.ts
git commit -m "feat(agent): add Plan validation and origin normalization"
```

---

## Task 5: Site allowlist

`chrome.storage.local`-backed permission store with origin normalization.

**Files:**
- Create: `src/agent/allowlist.ts`
- Test: `src/agent/allowlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { has, addAll, revoke, list, touch, _resetForTest } from './allowlist';

function mockStorage(initial: Record<string, unknown> = {}) {
  let state = { ...initial };
  vi.mocked(chrome.storage.local.get).mockImplementation(((keys: any) => {
    const k = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const key of k) if (key in state) out[key] = state[key];
    return Promise.resolve(out);
  }) as any);
  vi.mocked(chrome.storage.local.set).mockImplementation(((obj: any) => {
    state = { ...state, ...obj };
    return Promise.resolve();
  }) as any);
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
    const stored = (getState().siteAllowlist as any).origins;
    expect(Object.keys(stored).sort()).toEqual(['http://x.test:8080', 'https://example.com']);
  });

  it('addAll is idempotent and updates lastUsedAt', async () => {
    mockStorage();
    await addAll(['https://example.com']);
    const first = (await list())[0];
    await new Promise((r) => setTimeout(r, 5));
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
    await new Promise((r) => setTimeout(r, 5));
    await touch('https://x.com');
    const after = (await list())[0];
    expect(after.addedAt).toBe(before.addedAt);
    expect(after.lastUsedAt).toBeGreaterThan(before.lastUsedAt);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/agent/allowlist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/agent/allowlist.ts
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
  const v = (res as Record<string, unknown>)[KEY] as Store | undefined;
  return v && typeof v === 'object' && v.origins ? v : { origins: {} };
}

async function write(store: Store): Promise<void> {
  await chrome.storage.local.set({ [KEY]: store });
}

export async function has(origin: string): Promise<boolean> {
  const o = safeNormalize(origin);
  if (!o) return false;
  const store = await read();
  return Boolean(store.origins[o]);
}

export async function addAll(origins: string[]): Promise<void> {
  const store = await read();
  const now = Date.now();
  for (const raw of origins) {
    const o = normalizeOrigin(raw);
    const existing = store.origins[o];
    store.origins[o] = {
      addedAt: existing ? existing.addedAt : now,
      lastUsedAt: now,
    };
  }
  await write(store);
}

export async function revoke(origin: string): Promise<void> {
  const o = safeNormalize(origin);
  if (!o) return;
  const store = await read();
  delete store.origins[o];
  await write(store);
}

export async function list(): Promise<Array<{ origin: string; addedAt: number; lastUsedAt: number }>> {
  const store = await read();
  return Object.entries(store.origins).map(([origin, e]) => ({ origin, ...e }));
}

export async function touch(origin: string): Promise<void> {
  const o = safeNormalize(origin);
  if (!o) return;
  const store = await read();
  if (!store.origins[o]) return;
  store.origins[o].lastUsedAt = Date.now();
  await write(store);
}

function safeNormalize(origin: string): string | null {
  try {
    return normalizeOrigin(origin);
  } catch {
    return null;
  }
}

// Test-only hook for resetting any in-memory state. Currently a no-op because
// this module holds no module-level state, but kept for symmetry with the test.
export function _resetForTest(): void {}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/agent/allowlist.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/allowlist.ts src/agent/allowlist.test.ts
git commit -m "feat(agent): add persistent site allowlist with subdomain isolation"
```

---

## Task 6: OpenAI provider adapter

Provider that supports both tool-call models and JSON-fallback models.

**Files:**
- Create: `src/providers/openai.ts`
- Test: `src/providers/openai.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './openai';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as any);
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const config = {
    provider: 'openai' as const,
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  };

  it('proposePlan parses tool_calls.propose_plan arguments', async () => {
    mockFetchOnce({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'propose_plan',
                  arguments: JSON.stringify({
                    summary: 'plan summary',
                    steps: ['s1', 's2'],
                    sites: ['https://example.com'],
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    const p = new OpenAIProvider(config);
    const plan = await p.proposePlan({
      history: [{ role: 'user', content: 'hi' }],
      currentTab: { url: 'https://example.com', title: 'Example' },
      signal: new AbortController().signal,
    });
    expect(plan.summary).toBe('plan summary');
    expect(plan.sites).toEqual(['https://example.com']);
  });

  it('proposePlan falls back to fenced JSON in message.content', async () => {
    mockFetchOnce({
      choices: [
        {
          message: {
            content:
              'Here is the plan:\n```json\n{"summary":"s","steps":["a"],"sites":["https://example.com"]}\n```',
          },
        },
      ],
    });
    const p = new OpenAIProvider(config);
    const plan = await p.proposePlan({
      history: [{ role: 'user', content: 'hi' }],
      currentTab: { url: 'https://example.com', title: 'Example' },
      signal: new AbortController().signal,
    });
    expect(plan.summary).toBe('s');
  });

  it('runAgentStep returns a click AgentAction from tool_calls', async () => {
    mockFetchOnce({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'click',
                  arguments: JSON.stringify({ targetId: 7, rationale: 'cuz' }),
                },
              },
            ],
          },
        },
      ],
    });
    const p = new OpenAIProvider(config);
    const action = await p.runAgentStep({
      plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
      history: [],
      dom: '<button id="7">Go</button>',
      signal: new AbortController().signal,
    });
    expect(action).toEqual({ tool: 'click', targetId: 7, rationale: 'cuz' });
  });

  it('throws when API responds non-OK', async () => {
    mockFetchOnce({ error: { message: 'bad key' } }, { ok: false, status: 401 });
    const p = new OpenAIProvider(config);
    await expect(
      p.proposePlan({
        history: [{ role: 'user', content: 'x' }],
        currentTab: { url: 'https://x.com', title: '' },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/401/);
  });

  it('passes the abort signal through to fetch', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    global.fetch = fetchSpy as any;
    const ctrl = new AbortController();
    const p = new OpenAIProvider(config);
    ctrl.abort();
    await expect(
      p.proposePlan({
        history: [{ role: 'user', content: 'x' }],
        currentTab: { url: 'https://x.com', title: '' },
        signal: ctrl.signal,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalled();
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal).toBe(ctrl.signal);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/providers/openai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/providers/openai.ts
import type {
  AgentAction,
  Plan,
  Provider,
  ProviderConfig,
  ProposePlanInput,
  RunAgentStepInput,
} from './types';
import { TOOL_SCHEMAS, PROPOSE_PLAN_SCHEMA, type ToolSchema } from './toolSchemas';
import { validatePlan } from '../agent/plan';

export class OpenAIProvider implements Provider {
  constructor(private cfg: ProviderConfig) {}

  async proposePlan(input: ProposePlanInput): Promise<Plan> {
    const messages = [
      {
        role: 'system' as const,
        content: this.systemPromptForPlan(input.currentTab),
      },
      ...input.history,
    ];
    const data = await this.post(
      messages,
      [PROPOSE_PLAN_SCHEMA],
      { type: 'function', function: { name: 'propose_plan' } },
      input.signal,
    );
    const choice = data.choices?.[0]?.message;
    if (choice?.tool_calls?.[0]?.function) {
      const args = JSON.parse(choice.tool_calls[0].function.arguments);
      return validatePlan(args);
    }
    if (typeof choice?.content === 'string') {
      const m = choice.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (m) return validatePlan(JSON.parse(m[1]));
    }
    throw new Error('OpenAI proposePlan: no tool_calls and no JSON block in response');
  }

  async runAgentStep(input: RunAgentStepInput): Promise<AgentAction> {
    const messages = [
      { role: 'system' as const, content: this.systemPromptForStep(input.plan) },
      ...input.history,
      {
        role: 'user' as const,
        content: `INTERACTIVE ELEMENTS:\n${input.dom}\n\nPick the next tool to call.`,
      },
    ];
    const data = await this.post(messages, TOOL_SCHEMAS, 'required', input.signal);
    const choice = data.choices?.[0]?.message;
    const call = choice?.tool_calls?.[0];
    if (call?.function) {
      const args = JSON.parse(call.function.arguments);
      return toAgentAction(call.function.name, args);
    }
    if (typeof choice?.content === 'string') {
      const m = choice.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (m) {
        const parsed = JSON.parse(m[1]);
        if (parsed.tool) return toAgentAction(parsed.tool, parsed);
      }
    }
    throw new Error('OpenAI runAgentStep: no tool_calls in response');
  }

  private async post(
    messages: Array<{ role: string; content: string }>,
    tools: ToolSchema[],
    toolChoice: 'required' | { type: 'function'; function: { name: string } },
    signal: AbortSignal,
  ): Promise<any> {
    const url = `${(this.cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: this.cfg.model,
      messages,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: toolChoice,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI API ${res.status}: ${text}`);
    }
    return res.json();
  }

  private systemPromptForPlan(currentTab: { url: string; title: string }) {
    return [
      'You are a browser automation agent.',
      `The user is on: ${currentTab.url} ("${currentTab.title}").`,
      'Before any action, you MUST call propose_plan describing the sites you need permission to act on and the steps you will take.',
      'Sites must be origins like "https://example.com" — no paths, no wildcards.',
    ].join('\n');
  }

  private systemPromptForStep(plan: Plan) {
    return [
      'You are executing an approved plan in the user\'s browser tab.',
      `Plan summary: ${plan.summary}`,
      `Steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      `Approved sites: ${plan.sites.join(', ')}`,
      'On each turn, call exactly ONE of these tools: click, type, navigate, scroll, finish.',
      'When the task is done, call finish with a user-facing summary.',
    ].join('\n');
  }
}

function toAgentAction(tool: string, args: any): AgentAction {
  switch (tool) {
    case 'click':
      return { tool: 'click', targetId: Number(args.targetId), rationale: String(args.rationale ?? '') };
    case 'type':
      return {
        tool: 'type',
        targetId: Number(args.targetId),
        value: String(args.value ?? ''),
        rationale: String(args.rationale ?? ''),
      };
    case 'navigate':
      return { tool: 'navigate', url: String(args.url), rationale: String(args.rationale ?? '') };
    case 'scroll':
      return {
        tool: 'scroll',
        direction: args.direction === 'up' ? 'up' : 'down',
        rationale: String(args.rationale ?? ''),
      };
    case 'finish':
      return { tool: 'finish', summary: String(args.summary ?? '') };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/providers/openai.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/openai.ts src/providers/openai.test.ts
git commit -m "feat(providers): add OpenAI-compatible adapter with tool-call + JSON fallback"
```

---

## Task 7: Anthropic provider adapter

**Files:**
- Create: `src/providers/anthropic.ts`
- Test: `src/providers/anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './anthropic';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as any);
}

describe('AnthropicProvider', () => {
  const config = {
    provider: 'anthropic' as const,
    apiKey: 'sk-ant-test',
    model: 'claude-opus-4-7',
  };

  beforeEach(() => vi.clearAllMocks());

  it('proposePlan reads tool_use input', async () => {
    mockFetchOnce({
      content: [
        {
          type: 'tool_use',
          name: 'propose_plan',
          input: { summary: 'sum', steps: ['a'], sites: ['https://example.com'] },
        },
      ],
    });
    const p = new AnthropicProvider(config);
    const plan = await p.proposePlan({
      history: [{ role: 'user', content: 'hi' }],
      currentTab: { url: 'https://example.com', title: 'X' },
      signal: new AbortController().signal,
    });
    expect(plan.summary).toBe('sum');
  });

  it('runAgentStep returns AgentAction from tool_use', async () => {
    mockFetchOnce({
      content: [
        { type: 'tool_use', name: 'click', input: { targetId: 3, rationale: 'because' } },
      ],
    });
    const p = new AnthropicProvider(config);
    const action = await p.runAgentStep({
      plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
      history: [],
      dom: '<button id="3">x</button>',
      signal: new AbortController().signal,
    });
    expect(action).toEqual({ tool: 'click', targetId: 3, rationale: 'because' });
  });

  it('sends required headers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'propose_plan',
            input: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
          },
        ],
      }),
    });
    global.fetch = fetchSpy as any;
    const p = new AnthropicProvider(config);
    await p.proposePlan({
      history: [{ role: 'user', content: 'x' }],
      currentTab: { url: 'https://x.com', title: '' },
      signal: new AbortController().signal,
    });
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('throws on non-OK response', async () => {
    mockFetchOnce({ error: 'bad' }, { ok: false, status: 500 });
    const p = new AnthropicProvider(config);
    await expect(
      p.proposePlan({
        history: [{ role: 'user', content: 'x' }],
        currentTab: { url: 'https://x.com', title: '' },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/providers/anthropic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/providers/anthropic.ts
import type {
  AgentAction,
  Plan,
  Provider,
  ProviderConfig,
  ProposePlanInput,
  RunAgentStepInput,
} from './types';
import { TOOL_SCHEMAS, PROPOSE_PLAN_SCHEMA, type ToolSchema } from './toolSchemas';
import { validatePlan } from '../agent/plan';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export class AnthropicProvider implements Provider {
  constructor(private cfg: ProviderConfig) {}

  async proposePlan(input: ProposePlanInput): Promise<Plan> {
    const data = await this.post({
      system: this.systemPromptForPlan(input.currentTab),
      messages: input.history.map((m) => ({ role: roleFor(m.role), content: m.content })),
      tools: [PROPOSE_PLAN_SCHEMA],
      tool_choice: { type: 'tool', name: 'propose_plan' },
      signal: input.signal,
    });
    const block = (data.content as any[]).find((c) => c.type === 'tool_use');
    if (!block) throw new Error('Anthropic proposePlan: no tool_use block in response');
    return validatePlan(block.input);
  }

  async runAgentStep(input: RunAgentStepInput): Promise<AgentAction> {
    const data = await this.post({
      system: this.systemPromptForStep(input.plan),
      messages: [
        ...input.history.map((m) => ({ role: roleFor(m.role), content: m.content })),
        { role: 'user', content: `INTERACTIVE ELEMENTS:\n${input.dom}\n\nPick the next tool.` },
      ],
      tools: TOOL_SCHEMAS,
      tool_choice: { type: 'any' },
      signal: input.signal,
    });
    const block = (data.content as any[]).find((c) => c.type === 'tool_use');
    if (!block) throw new Error('Anthropic runAgentStep: no tool_use block in response');
    return toAgentAction(block.name, block.input);
  }

  private async post(opts: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    tools: ToolSchema[];
    tool_choice: { type: 'tool'; name: string } | { type: 'any' };
    signal: AbortSignal;
  }): Promise<any> {
    const body = {
      model: this.cfg.model,
      max_tokens: 4096,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      tool_choice: opts.tool_choice,
    };
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${text}`);
    }
    return res.json();
  }

  private systemPromptForPlan(currentTab: { url: string; title: string }) {
    return [
      'You are a browser automation agent.',
      `The user is on: ${currentTab.url} ("${currentTab.title}").`,
      'Before any action, you MUST call propose_plan with the sites you need permission to act on and the steps you will take.',
      'Sites must be origins like "https://example.com" — no paths, no wildcards.',
    ].join('\n');
  }

  private systemPromptForStep(plan: Plan) {
    return [
      'You are executing an approved plan in the user\'s browser tab.',
      `Plan summary: ${plan.summary}`,
      `Steps:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      `Approved sites: ${plan.sites.join(', ')}`,
      'On each turn, call exactly ONE of: click, type, navigate, scroll, finish.',
      'When done, call finish with a user-facing summary.',
    ].join('\n');
  }
}

function roleFor(role: 'user' | 'assistant' | 'system'): 'user' | 'assistant' {
  return role === 'assistant' ? 'assistant' : 'user';
}

function toAgentAction(tool: string, args: any): AgentAction {
  switch (tool) {
    case 'click':
      return { tool: 'click', targetId: Number(args.targetId), rationale: String(args.rationale ?? '') };
    case 'type':
      return {
        tool: 'type',
        targetId: Number(args.targetId),
        value: String(args.value ?? ''),
        rationale: String(args.rationale ?? ''),
      };
    case 'navigate':
      return { tool: 'navigate', url: String(args.url), rationale: String(args.rationale ?? '') };
    case 'scroll':
      return {
        tool: 'scroll',
        direction: args.direction === 'up' ? 'up' : 'down',
        rationale: String(args.rationale ?? ''),
      };
    case 'finish':
      return { tool: 'finish', summary: String(args.summary ?? '') };
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/providers/anthropic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/anthropic.ts src/providers/anthropic.test.ts
git commit -m "feat(providers): add Anthropic Messages API adapter"
```

---

## Task 8: Provider factory

**Files:**
- Create: `src/providers/index.ts`
- Test: `src/providers/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { selectProvider } from './index';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

describe('selectProvider', () => {
  it('returns OpenAIProvider for provider=openai', () => {
    const p = selectProvider({ provider: 'openai', apiKey: 'k', baseUrl: 'https://x', model: 'gpt-4o' });
    expect(p).toBeInstanceOf(OpenAIProvider);
  });
  it('returns AnthropicProvider for provider=anthropic', () => {
    const p = selectProvider({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-4-7' });
    expect(p).toBeInstanceOf(AnthropicProvider);
  });
  it('throws when apiKey is missing', () => {
    expect(() => selectProvider({ provider: 'openai', apiKey: '', model: 'gpt-4o' })).toThrow();
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/providers/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/providers/index.ts
import type { Provider, ProviderConfig } from './types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

export function selectProvider(cfg: ProviderConfig): Provider {
  if (!cfg.apiKey) throw new Error('apiKey is required');
  switch (cfg.provider) {
    case 'anthropic':
      return new AnthropicProvider(cfg);
    case 'openai':
      return new OpenAIProvider(cfg);
    default:
      throw new Error(`Unknown provider: ${(cfg as any).provider}`);
  }
}

export type { Provider, ProviderConfig } from './types';
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/providers/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/index.ts src/providers/index.test.ts
git commit -m "feat(providers): add selectProvider factory"
```

---

## Task 9: Agent tabs module

Lifecycle helpers for the dedicated agent tab.

**Files:**
- Create: `src/agent/tabs.ts`
- Test: `src/agent/tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  openAgentTab,
  getAgentTabUrl,
  sendToAgentTab,
  onAgentTabClosed,
} from './tabs';

describe('agent/tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('openAgentTab calls chrome.tabs.create and returns the new tab id', async () => {
    vi.mocked(chrome.tabs.create).mockImplementation(((info: any, cb?: any) => {
      const tab = { id: 42, url: info.url };
      if (cb) cb(tab);
      return Promise.resolve(tab);
    }) as any);
    const id = await openAgentTab('https://example.com');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com', active: true });
    expect(id).toBe(42);
  });

  it('getAgentTabUrl reads tab.url via chrome.tabs.get', async () => {
    vi.mocked(chrome.tabs.get).mockImplementation(((id: any, cb?: any) => {
      const tab = { id, url: 'https://example.com/page' };
      if (cb) cb(tab);
      return Promise.resolve(tab);
    }) as any);
    const url = await getAgentTabUrl(42);
    expect(url).toBe('https://example.com/page');
  });

  it('sendToAgentTab forwards to chrome.tabs.sendMessage', async () => {
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(((id: any, msg: any, cb?: any) => {
      const resp = { ok: true, msg };
      if (cb) cb(resp);
      return Promise.resolve(resp);
    }) as any);
    const resp = await sendToAgentTab<any>(42, { type: 'PING' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'PING' }, expect.any(Function));
    expect(resp).toEqual({ ok: true, msg: { type: 'PING' } });
  });

  it('onAgentTabClosed fires only when matching tabId is removed', () => {
    const cb = vi.fn();
    const dispose = onAgentTabClosed(42, cb);
    const listener = vi.mocked(chrome.tabs.onRemoved.addListener).mock.calls[0][0];
    listener(99, { windowId: 0, isWindowClosing: false });
    expect(cb).not.toHaveBeenCalled();
    listener(42, { windowId: 0, isWindowClosing: false });
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
    expect(chrome.tabs.onRemoved.removeListener).toHaveBeenCalledWith(listener);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/agent/tabs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/agent/tabs.ts
export async function openAgentTab(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (typeof tab?.id !== 'number') {
        reject(new Error('chrome.tabs.create returned no tab id'));
        return;
      }
      resolve(tab.id);
    });
  });
}

export async function getAgentTabUrl(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab?.url ?? '');
    });
  });
}

export async function navigateAgentTab(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

export function sendToAgentTab<T = unknown>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(resp);
    });
  });
}

export function onAgentTabClosed(tabId: number, cb: () => void): () => void {
  const listener = (id: number) => {
    if (id === tabId) cb();
  };
  chrome.tabs.onRemoved.addListener(listener);
  return () => chrome.tabs.onRemoved.removeListener(listener);
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/agent/tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tabs.ts src/agent/tabs.test.ts
git commit -m "feat(agent): add agent-tab lifecycle helpers"
```

---

## Task 10: Agent loop

Core executor: pulls DOM, calls `provider.runAgentStep`, dispatches actions, enforces allowlist + retry + max-step + abort.

**Files:**
- Create: `src/agent/loop.ts`
- Test: `src/agent/loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPlan, type ActionLogEntry } from './loop';
import type { AgentAction, Plan, Provider } from '../providers/types';

const plan: Plan = { summary: 's', steps: ['a'], sites: ['https://x.com'] };

function makeProvider(actions: AgentAction[]): Provider {
  let i = 0;
  return {
    proposePlan: vi.fn(),
    runAgentStep: vi.fn().mockImplementation(async () => {
      const a = actions[i++];
      if (!a) throw new Error('no more queued actions');
      return a;
    }),
  };
}

const baseDeps = () => ({
  agentTabId: 42,
  getDomTree: vi.fn().mockResolvedValue({ dom: '<button id="1">x</button>', url: 'https://x.com', title: '' }),
  getCurrentUrl: vi.fn().mockResolvedValue('https://x.com'),
  executeAction: vi.fn().mockResolvedValue({ success: true, message: 'done' }),
  navigate: vi.fn().mockResolvedValue(undefined),
  isAllowed: vi.fn().mockResolvedValue(true),
  onLog: vi.fn(),
  maxSteps: 25,
});

describe('agent/loop runPlan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs to finish and emits action log entries', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'r' },
      { tool: 'finish', summary: 'all done' },
    ]);
    const deps = baseDeps();
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('done');
    expect(result.summary).toBe('all done');
    expect(deps.executeAction).toHaveBeenCalledTimes(1);
    expect(deps.onLog).toHaveBeenCalledTimes(2); // click + finish
  });

  it('pauses on off-allowlist current URL', async () => {
    const provider = makeProvider([{ tool: 'click', targetId: 1, rationale: 'r' }]);
    const deps = baseDeps();
    deps.isAllowed.mockResolvedValueOnce(false);
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(result.reason).toMatch(/not in the allowlist/i);
    expect(deps.executeAction).not.toHaveBeenCalled();
  });

  it('pauses on off-allowlist navigate target', async () => {
    const provider = makeProvider([
      { tool: 'navigate', url: 'https://forbidden.com', rationale: 'r' },
    ]);
    const deps = baseDeps();
    deps.isAllowed.mockImplementation(async (origin: string) => origin === 'https://x.com');
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('retries once on stale-element failure', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 99, rationale: 'r' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = baseDeps();
    deps.executeAction.mockResolvedValueOnce({ success: false, error: 'Element with id 99 not found' });
    deps.executeAction.mockResolvedValueOnce({ success: true, message: 'clicked after retry' });
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('done');
    expect(deps.executeAction).toHaveBeenCalledTimes(2);
    expect(deps.getDomTree).toHaveBeenCalledTimes(3); // initial + retry + finish-step
  });

  it('pauses on max-step cap', async () => {
    const actions: AgentAction[] = Array.from({ length: 30 }, () => ({
      tool: 'scroll' as const,
      direction: 'down' as const,
      rationale: 'r',
    }));
    const provider = makeProvider(actions);
    const deps = { ...baseDeps(), maxSteps: 3 };
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(result.reason).toMatch(/step limit/i);
    expect(deps.executeAction).toHaveBeenCalledTimes(3);
  });

  it('honors AbortSignal', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'r' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = baseDeps();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await runPlan(plan, provider, deps, ctrl.signal);
    expect(result.status).toBe('aborted');
    expect(deps.executeAction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/agent/loop.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/agent/loop.ts
import type { AgentAction, Plan, Provider } from '../providers/types';
import { normalizeOrigin } from './plan';

export interface ActionLogEntry {
  id: string;
  ts: number;
  tool: AgentAction['tool'];
  args: Record<string, unknown>;
  rationale?: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

export interface LoopDeps {
  agentTabId: number;
  getDomTree: () => Promise<{ dom: string; url: string; title: string }>;
  getCurrentUrl: () => Promise<string>;
  executeAction: (
    action: AgentAction,
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  navigate: (url: string) => Promise<void>;
  isAllowed: (origin: string) => Promise<boolean>;
  onLog: (entry: ActionLogEntry) => void;
  maxSteps: number;
}

export type LoopResult =
  | { status: 'done'; summary: string }
  | { status: 'paused'; reason: string }
  | { status: 'aborted' }
  | { status: 'error'; error: Error };

export async function runPlan(
  plan: Plan,
  provider: Provider,
  deps: LoopDeps,
  signal: AbortSignal,
): Promise<LoopResult> {
  if (signal.aborted) return { status: 'aborted' };

  const history: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];

  for (let step = 0; step < deps.maxSteps; step++) {
    if (signal.aborted) return { status: 'aborted' };

    // Allowlist guard for current tab origin.
    const currentUrl = await deps.getCurrentUrl();
    const currentOrigin = safeOrigin(currentUrl);
    if (!currentOrigin || !(await deps.isAllowed(currentOrigin))) {
      return { status: 'paused', reason: `Current page (${currentUrl}) is not in the allowlist` };
    }

    const dom = await deps.getDomTree();

    let action: AgentAction;
    try {
      action = await provider.runAgentStep({ plan, history, dom: dom.dom, signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { status: 'aborted' };
      return { status: 'error', error: err as Error };
    }

    if (action.tool === 'finish') {
      deps.onLog(makeLogEntry(action, true, action.summary, 0));
      return { status: 'done', summary: action.summary };
    }

    if (action.tool === 'navigate') {
      const targetUrl = resolveUrl(action.url, currentUrl);
      const targetOrigin = safeOrigin(targetUrl);
      if (!targetOrigin || !(await deps.isAllowed(targetOrigin))) {
        return {
          status: 'paused',
          reason: `Navigate target ${targetUrl} is not in the allowlist`,
        };
      }
      const t0 = Date.now();
      try {
        await deps.navigate(targetUrl);
        deps.onLog(makeLogEntry(action, true, `Navigated to ${targetUrl}`, Date.now() - t0));
      } catch (err) {
        deps.onLog(makeLogEntry(action, false, (err as Error).message, Date.now() - t0));
        return { status: 'error', error: err as Error };
      }
      history.push({ role: 'assistant', content: `[navigate ${targetUrl}]` });
      continue;
    }

    // click / type / scroll — run with a single stale-element retry.
    const t0 = Date.now();
    let result = await deps.executeAction(action);
    if (
      !result.success &&
      typeof result.error === 'string' &&
      /not found/i.test(result.error)
    ) {
      // Re-extract DOM and retry once.
      await deps.getDomTree();
      result = await deps.executeAction(action);
    }
    const durationMs = Date.now() - t0;
    deps.onLog(makeLogEntry(action, result.success, result.message ?? result.error ?? '', durationMs));
    history.push({
      role: 'assistant',
      content: `[${action.tool} ${result.success ? 'ok' : 'fail'}]`,
    });
  }

  return { status: 'paused', reason: `Hit step limit (${deps.maxSteps})` };
}

function makeLogEntry(
  action: AgentAction,
  ok: boolean,
  message: string,
  durationMs: number,
): ActionLogEntry {
  const { tool, ...rest } = action as Record<string, unknown> & { tool: AgentAction['tool'] };
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    tool: action.tool,
    args: rest as Record<string, unknown>,
    rationale: (action as any).rationale,
    ok,
    message,
    durationMs,
  };
}

function safeOrigin(url: string): string | null {
  try {
    return normalizeOrigin(url);
  } catch {
    return null;
  }
}

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/agent/loop.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agent/loop.ts src/agent/loop.test.ts
git commit -m "feat(agent): add execution loop with allowlist guard, retry, abort, max-steps"
```

---

## Task 11: PlanCard component

**Files:**
- Create: `src/components/PlanCard.tsx`
- Test: `src/components/PlanCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanCard } from './PlanCard';
import type { Plan } from '../providers/types';

const plan: Plan = {
  summary: 'List all books',
  steps: ['Read home', 'Navigate', 'Extract'],
  sites: ['https://learning.oreilly.com'],
};

describe('PlanCard', () => {
  it('renders sites and steps', () => {
    render(<PlanCard plan={plan} onApprove={() => {}} onMakeChanges={() => {}} />);
    expect(screen.getByText('https://learning.oreilly.com')).toBeInTheDocument();
    expect(screen.getByText('Read home')).toBeInTheDocument();
    expect(screen.getByText('Navigate')).toBeInTheDocument();
    expect(screen.getByText('Extract')).toBeInTheDocument();
  });

  it('calls onApprove when Approve button is clicked', () => {
    const onApprove = vi.fn();
    render(<PlanCard plan={plan} onApprove={onApprove} onMakeChanges={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /approve plan/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onMakeChanges when Make changes button is clicked', () => {
    const onChange = vi.fn();
    render(<PlanCard plan={plan} onApprove={() => {}} onMakeChanges={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /make changes/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons when disabled=true', () => {
    render(<PlanCard plan={plan} onApprove={() => {}} onMakeChanges={() => {}} disabled />);
    expect(screen.getByRole('button', { name: /approve plan/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /make changes/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/components/PlanCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/PlanCard.tsx
import type { Plan } from '../providers/types';

interface Props {
  plan: Plan;
  onApprove: () => void;
  onMakeChanges: () => void;
  disabled?: boolean;
}

export function PlanCard({ plan, onApprove, onMakeChanges, disabled }: Props) {
  return (
    <div className="border border-gray-600/50 rounded-2xl bg-[#2b2d31] p-4 my-3 text-gray-200">
      <div className="flex items-center gap-2 text-sm font-medium mb-3 text-gray-300">
        Aiside's plan
      </div>

      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        Allow actions on these sites
      </div>
      <ul className="mb-4 space-y-1">
        {plan.sites.map((site) => (
          <li key={site} className="flex items-center gap-2 text-sm">
            <span aria-hidden>🌐</span>
            <span>{site}</span>
          </li>
        ))}
      </ul>

      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
        Approach to follow
      </div>
      <ol className="mb-4 space-y-1 list-decimal list-inside text-sm">
        {plan.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onApprove}
          className="w-full rounded-md bg-white text-black text-sm font-medium py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve plan
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onMakeChanges}
          className="w-full rounded-md border border-gray-600 text-sm font-medium py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Make changes
        </button>
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        Aiside will only use the sites listed. You'll be asked before accessing anything else.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/components/PlanCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlanCard.tsx src/components/PlanCard.test.tsx
git commit -m "feat(components): add PlanCard component"
```

---

## Task 12: ActionLogRow component

**Files:**
- Create: `src/components/ActionLogRow.tsx`
- Test: `src/components/ActionLogRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionLogRow } from './ActionLogRow';
import type { ActionLogEntry } from '../agent/loop';

const ok: ActionLogEntry = {
  id: '1', ts: 0, tool: 'click', args: { targetId: 7, rationale: 'go' },
  rationale: 'go', ok: true, message: 'Clicked element 7', durationMs: 12,
};
const fail: ActionLogEntry = {
  id: '2', ts: 0, tool: 'type', args: { targetId: 9, value: 'x', rationale: 'r' },
  rationale: 'r', ok: false, message: 'Element with id 9 not found', durationMs: 5,
};

describe('ActionLogRow', () => {
  it('shows success summary collapsed by default', () => {
    render(<ActionLogRow entry={ok} />);
    expect(screen.getByText(/click/i)).toBeInTheDocument();
    expect(screen.queryByText(/Clicked element 7/)).toBeNull();
  });

  it('expands on click and shows message', () => {
    render(<ActionLogRow entry={ok} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Clicked element 7/)).toBeInTheDocument();
  });

  it('renders failure with error styling', () => {
    render(<ActionLogRow entry={fail} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Element with id 9 not found/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/components/ActionLogRow.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/ActionLogRow.tsx
import { useState } from 'react';
import type { ActionLogEntry } from '../agent/loop';

interface Props {
  entry: ActionLogEntry;
}

export function ActionLogRow({ entry }: Props) {
  const [open, setOpen] = useState(false);
  const icon = entry.ok ? '✓' : '✗';
  const color = entry.ok ? 'text-green-400' : 'text-red-400';

  return (
    <div className="text-xs my-1 border-l-2 border-gray-700 pl-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left hover:bg-white/5 rounded px-1 py-0.5"
      >
        <span className={`${color} font-mono`}>{icon}</span>
        <span className="font-medium uppercase tracking-wide text-gray-400">{entry.tool}</span>
        <span className="text-gray-500 truncate flex-1">
          {summarize(entry)}
        </span>
        <span className="text-gray-600">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2 py-1 text-gray-400 space-y-1">
          <div><span className="text-gray-500">message:</span> {entry.message}</div>
          {entry.rationale && (
            <div><span className="text-gray-500">why:</span> {entry.rationale}</div>
          )}
          <div><span className="text-gray-500">args:</span> <code>{JSON.stringify(entry.args)}</code></div>
          <div><span className="text-gray-500">duration:</span> {entry.durationMs}ms</div>
        </div>
      )}
    </div>
  );
}

function summarize(e: ActionLogEntry): string {
  switch (e.tool) {
    case 'click': return `id=${(e.args as any).targetId}`;
    case 'type': return `id=${(e.args as any).targetId} "${(e.args as any).value}"`;
    case 'navigate': return String((e.args as any).url);
    case 'scroll': return String((e.args as any).direction);
    case 'finish': return e.message;
  }
}
```

- [ ] **Step 4: Run — must pass**

Run: `npx vitest run src/components/ActionLogRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ActionLogRow.tsx src/components/ActionLogRow.test.tsx
git commit -m "feat(components): add ActionLogRow component"
```

---

## Task 13: Options page — provider, agent settings, site permissions

Add three sections while keeping the existing API key flow working.

**Files:**
- Modify: `src/options.tsx`
- Modify: `src/options.test.tsx`

- [ ] **Step 1: Add tests for the three new sections**

Append to `src/options.test.tsx` (or create the test if it doesn't already cover these):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Options from './options';

describe('Options page extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chrome.storage.local.get).mockImplementation(((keys: any, cb?: any) => {
      const out = {
        provider: 'anthropic',
        apiKey: 'k',
        baseUrl: 'https://api.openai.com/v1',
        model: 'claude-opus-4-7',
        sendScreenshots: false,
        siteAllowlist: { origins: { 'https://example.com': { addedAt: 1, lastUsedAt: 2 } } },
      };
      if (typeof cb === 'function') cb(out);
      return Promise.resolve(out);
    }) as any);
    vi.mocked(chrome.storage.local.set).mockImplementation(((_o: any, cb?: any) => {
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    }) as any);
  });

  it('renders provider radios with anthropic checked', async () => {
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
    render(<Options />);
    await waitFor(() => screen.getByText('https://example.com'));
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    await waitFor(() =>
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ siteAllowlist: expect.objectContaining({ origins: {} }) }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npx vitest run src/options.test.tsx`
Expected: FAIL on the new tests.

- [ ] **Step 3: Replace the contents of `src/options.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { list as listAllowed, revoke } from './agent/allowlist';

type ProviderName = 'anthropic' | 'openai';

const VISION_PREFIXES: Record<ProviderName, string[]> = {
  anthropic: ['claude-'],
  openai: ['gpt-4o', 'gpt-4-vision'],
};

const Options = () => {
  const [provider, setProvider] = useState<ProviderName>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('claude-opus-4-7');
  const [sendScreenshots, setSendScreenshots] = useState(false);
  const [allowed, setAllowed] = useState<Array<{ origin: string; addedAt: number; lastUsedAt: number }>>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(
      ['provider', 'apiKey', 'baseUrl', 'model', 'sendScreenshots'],
      (res) => {
        if (res.provider === 'openai' || res.provider === 'anthropic') setProvider(res.provider);
        if (res.apiKey) setApiKey(res.apiKey as string);
        if (res.baseUrl) setBaseUrl(res.baseUrl as string);
        if (res.model) setModel(res.model as string);
        setSendScreenshots(Boolean(res.sendScreenshots));
      },
    );
    refreshAllowed();
  }, []);

  async function refreshAllowed() {
    setAllowed(await listAllowed());
  }

  const visionSupported = VISION_PREFIXES[provider].some((p) => model.toLowerCase().startsWith(p));

  const handleSave = () => {
    chrome.storage.local.set({ provider, apiKey, baseUrl, model, sendScreenshots }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };

  const handleRevoke = async (origin: string) => {
    await revoke(origin);
    refreshAllowed();
  };

  const handleRevokeAll = async () => {
    if (!confirm('Revoke all site permissions?')) return;
    for (const a of allowed) await revoke(a.origin);
    refreshAllowed();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-xl space-y-8">
        <h1 className="text-2xl font-bold text-gray-800">Aiside Configuration</h1>

        {/* Provider */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase text-gray-500">Provider</h2>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="provider"
                value="anthropic"
                checked={provider === 'anthropic'}
                onChange={() => setProvider('anthropic')}
              />
              Anthropic
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="provider"
                value="openai"
                checked={provider === 'openai'}
                onChange={() => setProvider('openai')}
              />
              OpenAI-compatible
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            />
          </div>

          {provider === 'openai' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder={provider === 'anthropic' ? 'claude-opus-4-7' : 'gpt-4o'}
            />
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </section>

        {/* Agent settings */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-gray-500">Agent settings</h2>
          <label
            className="flex items-center gap-2"
            title={visionSupported ? '' : "Selected model doesn't support image input"}
          >
            <input
              type="checkbox"
              checked={sendScreenshots}
              disabled={!visionSupported}
              onChange={(e) => setSendScreenshots(e.target.checked)}
            />
            <span className={visionSupported ? '' : 'text-gray-400'}>
              Send screenshots to model (more accurate, ~2× cost)
            </span>
          </label>
        </section>

        {/* Site permissions */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-gray-500">Site permissions</h2>
          {allowed.length === 0 ? (
            <p className="text-sm text-gray-500">
              Aiside hasn't been approved to act on any sites yet.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md">
                {allowed.map((a) => (
                  <li key={a.origin} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{a.origin}</div>
                      <div className="text-xs text-gray-500">
                        added {new Date(a.addedAt).toLocaleDateString()} · last used{' '}
                        {a.lastUsedAt ? new Date(a.lastUsedAt).toLocaleDateString() : 'never'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(a.origin)}
                      className="text-red-600 text-xs font-medium hover:underline"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleRevokeAll}
                className="text-xs text-red-600 hover:underline"
              >
                Revoke all
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Options;

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<Options />);
  }
}
```

- [ ] **Step 4: Run options tests — must pass**

Run: `npx vitest run src/options.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/options.tsx src/options.test.tsx
git commit -m "feat(options): add provider picker, screenshot toggle, site permissions"
```

---

## Task 14: App.tsx coordinator rewrite

Replace the current agent-mode logic with the new module wiring. Plan-and-approve flow, action log, run controls.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add an integration test exercising plan → approve → run → done**

Replace the existing `src/App.test.tsx` content with the test below. (Existing tests can be removed — the App is being rewritten; the integration test below is the new acceptance.)

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

vi.mock('./providers/index', () => ({
  selectProvider: vi.fn(),
}));
vi.mock('./agent/tabs', () => ({
  openAgentTab: vi.fn().mockResolvedValue(42),
  getAgentTabUrl: vi.fn().mockResolvedValue('https://example.com'),
  navigateAgentTab: vi.fn().mockResolvedValue(undefined),
  sendToAgentTab: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  onAgentTabClosed: vi.fn().mockReturnValue(() => {}),
}));

import { selectProvider } from './providers/index';
import { sendToAgentTab } from './agent/tabs';

describe('App integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chrome.storage.local.get).mockImplementation(((keys: any, cb?: any) => {
      const out = {
        provider: 'anthropic',
        apiKey: 'k',
        model: 'claude-opus-4-7',
        baseUrl: 'https://api.openai.com/v1',
        chatHistory: [],
        siteAllowlist: { origins: {} },
      };
      if (typeof cb === 'function') cb(out);
      return Promise.resolve(out);
    }) as any);
    vi.mocked(chrome.storage.local.set).mockImplementation(((_o: any, cb?: any) => {
      if (typeof cb === 'function') cb();
      return Promise.resolve();
    }) as any);
    vi.mocked(chrome.tabs.query).mockImplementation(((_q: any, cb?: any) => {
      const tabs = [{ id: 1, url: 'https://example.com', title: 'Ex' }];
      if (cb) cb(tabs);
      return Promise.resolve(tabs);
    }) as any);
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
    vi.mocked(selectProvider).mockReturnValue(fakeProvider as any);
    vi.mocked(sendToAgentTab).mockResolvedValue({
      dom: '<button id="1">x</button>',
      url: 'https://example.com',
      title: 'Ex',
    } as any);

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/Ask Aiside/i), {
      target: { value: 'do the thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send|↑|arrow/i }));

    await waitFor(() => screen.getByRole('button', { name: /approve plan/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve plan/i }));

    await waitFor(() => screen.getByText(/done!/i), { timeout: 3000 });
    expect(fakeProvider.runAgentStep).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run — must fail (App not yet rewritten)**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageSquarePlus, MoreVertical } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { selectProvider } from './providers/index';
import type { Message, Plan, ProviderConfig } from './providers/types';
import { validatePlan } from './agent/plan';
import * as allowlist from './agent/allowlist';
import {
  openAgentTab,
  getAgentTabUrl,
  navigateAgentTab,
  sendToAgentTab,
  onAgentTabClosed,
} from './agent/tabs';
import { runPlan, type ActionLogEntry, type LoopDeps, type LoopResult } from './agent/loop';
import { PlanCard } from './components/PlanCard';
import { ActionLogRow } from './components/ActionLogRow';

type RunState =
  | 'idle'
  | 'planning'
  | 'awaiting-approval'
  | 'running'
  | 'paused'
  | 'done'
  | 'error';

const MAX_STEPS = 25;

interface ChatItem {
  kind: 'message' | 'plan' | 'log';
  message?: Message;
  plan?: Plan;
  entry?: ActionLogEntry;
}

function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [pauseReason, setPauseReason] = useState<string>('');
  const [config, setConfig] = useState<ProviderConfig>({
    provider: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'claude-opus-4-7',
    sendScreenshots: false,
  });
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const stopController = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chrome.storage.local.get(
      ['provider', 'apiKey', 'baseUrl', 'model', 'sendScreenshots'],
      (res) => {
        setConfig({
          provider: res.provider === 'openai' ? 'openai' : 'anthropic',
          apiKey: (res.apiKey as string) ?? '',
          baseUrl: (res.baseUrl as string) ?? 'https://api.openai.com/v1',
          model: (res.model as string) ?? 'claude-opus-4-7',
          sendScreenshots: Boolean(res.sendScreenshots),
        });
      },
    );
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const append = (item: ChatItem) => setItems((prev) => [...prev, item]);

  async function getCurrentTab(): Promise<{ url: string; title: string }> {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const t = tabs[0];
        resolve({ url: t?.url ?? '', title: t?.title ?? '' });
      });
    });
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || runState !== 'idle') return;
    if (!config.apiKey) {
      alert('Please configure your API key in the extension options.');
      chrome.runtime.openOptionsPage();
      return;
    }
    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    append({ kind: 'message', message: userMsg });

    setRunState('planning');
    const provider = selectProvider(config);
    stopController.current = new AbortController();
    try {
      const currentTab = await getCurrentTab();
      const raw = await provider.proposePlan({
        history: [userMsg],
        currentTab,
        signal: stopController.current.signal,
      });
      const plan = validatePlan(raw);
      setPendingPlan(plan);
      append({ kind: 'plan', plan });
      setRunState('awaiting-approval');
    } catch (err) {
      append({
        kind: 'message',
        message: { role: 'assistant', content: `Plan failed: ${(err as Error).message}` },
      });
      setRunState('error');
      setTimeout(() => setRunState('idle'), 0);
    }
  }

  async function handleApprove() {
    if (!pendingPlan) return;
    const plan = pendingPlan;
    setPendingPlan(null);
    setRunState('running');
    await allowlist.addAll(plan.sites);
    const tabId = await openAgentTab(plan.sites[0]);
    const dispose = onAgentTabClosed(tabId, () => {
      setRunState('paused');
      setPauseReason('Agent tab was closed');
      stopController.current?.abort();
    });

    const provider = selectProvider(config);
    stopController.current = new AbortController();
    const deps: LoopDeps = {
      agentTabId: tabId,
      getDomTree: async () => {
        const r = await sendToAgentTab<{ dom: string; url: string; title: string }>(tabId, {
          type: 'GET_DOM_TREE',
        });
        return r;
      },
      getCurrentUrl: () => getAgentTabUrl(tabId),
      executeAction: async (action) => {
        return sendToAgentTab(tabId, {
          type: 'EXECUTE_ACTION',
          payload: actionToContentPayload(action),
        });
      },
      navigate: (url) => navigateAgentTab(tabId, url),
      isAllowed: (origin) => allowlist.has(origin),
      onLog: (entry) => {
        append({ kind: 'log', entry });
      },
      maxSteps: MAX_STEPS,
    };

    let result: LoopResult;
    try {
      result = await runPlan(plan, provider, deps, stopController.current.signal);
    } catch (err) {
      result = { status: 'error', error: err as Error };
    } finally {
      dispose();
    }

    if (result.status === 'done') {
      append({ kind: 'message', message: { role: 'assistant', content: result.summary } });
      await allowlist.touch(plan.sites[0]);
      setRunState('done');
      setTimeout(() => setRunState('idle'), 0);
    } else if (result.status === 'paused') {
      setPauseReason(result.reason);
      setRunState('paused');
    } else if (result.status === 'aborted') {
      append({ kind: 'message', message: { role: 'assistant', content: 'Stopped.' } });
      setRunState('idle');
    } else {
      append({
        kind: 'message',
        message: { role: 'assistant', content: `Error: ${result.error.message}` },
      });
      setRunState('error');
      setTimeout(() => setRunState('idle'), 0);
    }
  }

  function handleMakeChanges() {
    if (!pendingPlan) return;
    const draft = `Refine this plan:\n\nSummary: ${pendingPlan.summary}\nSites:\n${pendingPlan.sites
      .map((s) => `- ${s}`)
      .join('\n')}\nSteps:\n${pendingPlan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nMy changes: `;
    setInput(draft);
    setPendingPlan(null);
    setRunState('idle');
  }

  function handleStop() {
    stopController.current?.abort();
    setRunState('idle');
  }

  function clearHistory() {
    setItems([]);
    setRunState('idle');
    setPendingPlan(null);
  }

  return (
    <div className="flex flex-col h-screen bg-[#2b2d31] text-gray-200 font-sans">
      <header className="flex items-center justify-between px-4 py-3">
        <div
          className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1 rounded-md"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <span className="text-[15px] font-medium">{config.model || 'Model'}</span>
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <button onClick={clearHistory} title="New chat">
            <MessageSquarePlus size={18} />
          </button>
          <button onClick={() => chrome.runtime.openOptionsPage()} title="Settings">
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {items.map((it, i) => {
          if (it.kind === 'message' && it.message) {
            const m = it.message;
            return (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] text-[15px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#383a40] text-gray-100 rounded-2xl px-4 py-3'
                      : 'text-gray-200 py-1'
                  }`}
                >
                  {m.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            );
          }
          if (it.kind === 'plan' && it.plan) {
            return (
              <PlanCard
                key={i}
                plan={it.plan}
                onApprove={handleApprove}
                onMakeChanges={handleMakeChanges}
                disabled={runState !== 'awaiting-approval'}
              />
            );
          }
          if (it.kind === 'log' && it.entry) {
            return <ActionLogRow key={i} entry={it.entry} />;
          }
          return null;
        })}
        {(runState === 'planning' || runState === 'running') && (
          <div className="flex justify-start">
            <div className="text-gray-400 py-2 flex items-center gap-2 text-sm">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        {runState === 'paused' && (
          <div className="rounded-md border border-yellow-700 bg-yellow-900/20 text-yellow-200 px-3 py-2 text-sm">
            Paused — {pauseReason}.
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="p-4 pt-2">
        <div className="bg-[#383a40] border border-gray-600/50 rounded-2xl p-3 flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask Aiside..."
            className="w-full max-h-48 min-h-[24px] bg-transparent border-none resize-none text-[15px] text-gray-200 placeholder-gray-500 focus:outline-none"
            rows={1}
          />
          <div className="flex items-center justify-end">
            {runState === 'running' ? (
              <button
                onClick={handleStop}
                className="text-xs px-3 py-1 rounded-md bg-red-600 text-white"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                aria-label="Send"
                disabled={!input.trim() || runState !== 'idle'}
                className={`p-1.5 rounded-full ${
                  input.trim() && runState === 'idle'
                    ? 'bg-[#d97757] text-white'
                    : 'bg-[#4a4c52] text-gray-500'
                }`}
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
        <div className="text-center mt-3 text-[11px] text-gray-500">
          Aiside is AI and can make mistakes. Please double-check responses.
        </div>
      </footer>
    </div>
  );
}

function actionToContentPayload(action: import('./providers/types').AgentAction): {
  action: string;
  targetId?: number;
  value?: string;
} {
  switch (action.tool) {
    case 'click':
      return { action: 'click', targetId: action.targetId };
    case 'type':
      return { action: 'type', targetId: action.targetId, value: action.value };
    case 'scroll':
      return { action: 'scroll' };
    default:
      return { action: action.tool };
  }
}

export default App;
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS for everything (existing + new). If the old App.test had specific assertions about agent-mode JSON parsing, they will be replaced by the new integration test.

- [ ] **Step 5: Build to verify production bundle compiles**

Run: `npm run build`
Expected: vite build succeeds; `dist/` contains `index.html`, `options.html`, `background.js`, `content.js`.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): wire plan-and-approve agent flow into App.tsx coordinator"
```

---

## Task 15: Manual smoke test (acceptance)

This task is not automated — it confirms the extension works in a real browser.

- [ ] **Step 1: Build & load**

Run: `npm run build`

In Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `aiside/dist`.

- [ ] **Step 2: Configure**

Open the extension's options page → choose Anthropic → enter API key → set model `claude-opus-4-7` → Save.

- [ ] **Step 3: Run an agent task**

Open `https://learning.oreilly.com` → click the extension icon → in the side panel type `list a few books on this site` → wait for plan card.

- [ ] **Step 4: Approve & observe**

Click **Approve plan** → a new tab opens at the site → action log rows stream in → final assistant message contains a list of book titles.

- [ ] **Step 5: Verify allowlist**

Open options → "Site permissions" shows `https://learning.oreilly.com` with a recent `last used`. Click **Revoke** → the entry disappears.

- [ ] **Step 6: Off-allowlist redirect**

Run a task that redirects mid-flow (e.g., one that hits a login page on a different origin) → confirm the side panel shows a paused banner naming the new origin.

- [ ] **Step 7: Stop button**

Start a long-running task → click **Stop** while a step is in flight → confirm the loop halts within ~1 step.

- [ ] **Step 8: OpenAI fallback**

Switch provider in options to OpenAI-compatible (gpt-4o, your key) → repeat a simple agent task → confirm it still completes.

- [ ] **Step 9: Commit any final fixes**

If steps 1-8 surface bugs, fix and commit per the standard pattern. Otherwise:

```bash
git tag v1.0.0-browser-agent
```

---

## Self-Review Notes

**Spec coverage check (each spec section maps to a task):**

| Spec section | Implemented in |
|---|---|
| §3 module map | Tasks 2-12 create exactly the listed modules |
| §4.1 Plan | Task 2 (types) + Task 4 (validation) |
| §4.2 AgentAction | Task 2 |
| §4.3 Allowlist | Task 5 |
| §4.4 ActionLogEntry | Task 10 (defined inside loop.ts) |
| §5 Provider interface | Task 2 + Task 6 + Task 7 |
| §5.1 OpenAI tool path + fallback | Task 6 |
| §5.2 Anthropic with required headers | Task 7 |
| §5.3 Shared schemas | Task 3 |
| §6 Lifecycle / state machine | Task 14 (App coordinator) |
| §6.2 Invariants 1-4 | Task 10 (loop) + Task 14 (App) |
| §7.1 PlanCard | Task 11 |
| §7.2 ActionLogRow | Task 12 |
| §7.3 Run controls | Task 14 (inline in App) |
| §7.4 Options additions | Task 13 |
| §8 Error handling table | Tasks 6, 7, 10, 14 |
| §9 Tests | Each task ships its sibling `*.test.*` |
| §9.3 Acceptance manual | Task 15 |

**Naming consistency check:** `runPlan` (Task 10) is used in App.tsx (Task 14). `selectProvider` (Task 8) is used in App.tsx and Options. `validatePlan` (Task 4) is used in providers (Tasks 6, 7) and App (Task 14). `normalizeOrigin` is used in `plan.ts`, `allowlist.ts`, and `loop.ts`. All consistent.

**Placeholder scan:** Each "implement" step contains the full code. No "TBD" or "implement later". Test code is complete in every test step.
