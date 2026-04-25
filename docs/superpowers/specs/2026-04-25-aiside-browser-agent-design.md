# Aiside browser agent — plan-and-approve UX, allowlist, dual-provider tool use

**Status:** Design — pending user review
**Date:** 2026-04-25
**Owner:** Aiside

## 1. Problem & goal

Aiside today is a Chrome side-panel extension with a working "agent mode" that can click, type, navigate, and scroll on the active tab using DOM extraction and an OpenAI-compatible chat completions endpoint. It lacks the structured **plan-and-approve UX**, **per-site permission allowlist**, and **reliable tool-call agent loop** that Anthropic's Claude Chrome extension demonstrates.

This spec adds those capabilities while keeping the existing OpenAI-compatible path working.

The goal is feature parity with the screenshot the user shared: a "Claude's plan" card showing approved sites + numbered steps with **Approve plan** / **Make changes** buttons, a persistent revocable site allowlist, and a multi-step execution engine with stop/retry/log affordances.

## 2. Scope

In scope (v1):
- Plan-once approval gate before any agent action.
- Persistent revocable site allowlist with subdomain-isolated entries.
- Dual provider support: Anthropic native tool use *and* OpenAI-compatible (existing).
- Agent runs in a dedicated new tab opened at approval time.
- Action log in the chat (one collapsible row per step), max-step cap, stop button, stale-element retry.
- Optional screenshot-between-steps as an opt-in toggle.
- Off-allowlist navigation auto-pauses with inline "add & continue" prompt.

Out of scope (v1):
- Multi-tab orchestration (agent juggling several tabs).
- Headless mode, scripting language, recorded macros.
- Live-provider integration tests in CI.
- Visual regression / Puppeteer end-to-end tests.
- Undo of agent actions.

## 3. Architecture

### 3.1 Module map

```
src/
├── App.tsx                      # Coordinator only
├── background.ts                # (existing) + tab routing helpers
├── content.ts                   # (existing, unchanged)
├── options.tsx                  # + provider picker, + site permissions
│
├── providers/
│   ├── types.ts                 # Provider interface
│   ├── openai.ts                # OpenAI-compatible adapter
│   ├── anthropic.ts             # Anthropic native tool-use adapter
│   ├── toolSchemas.ts           # Shared tool JSON schemas
│   └── index.ts                 # selectProvider(config) → Provider
│
├── agent/
│   ├── plan.ts                  # Plan schema, validation
│   ├── loop.ts                  # Execution loop
│   ├── allowlist.ts             # Persistent site permissions
│   └── tabs.ts                  # Agent tab lifecycle
│
└── components/
    ├── PlanCard.tsx             # Approve / Make changes UI
    └── ActionLogRow.tsx         # Collapsible step row
```

### 3.2 Responsibilities

| Module | Knows about | Does NOT know about |
|---|---|---|
| `providers/*` | HTTP, model APIs, tool schemas | UI, Chrome APIs, plan content |
| `agent/plan.ts` | Plan shape, validation | Provider, UI |
| `agent/loop.ts` | A plan, a provider, a tab | UI rendering, options page |
| `agent/allowlist.ts` | Origins, `chrome.storage.local` | Plans, providers |
| `agent/tabs.ts` | `chrome.tabs`, agent tab id | Plan content, provider |
| `components/*` | Props in, callbacks out | Network, Chrome APIs |
| `App.tsx` | All of the above; orchestrates | Internals of any of them |

## 4. Data model

### 4.1 Plan

```ts
export interface Plan {
  summary: string;        // ≤ 200 chars
  steps: string[];        // 1–10 entries, each ≤ 200 chars
  sites: string[];        // 1–5 origins, http(s) only, normalized
}
```

Origins are normalized to `${url.protocol}//${url.host}` (port included if non-default), lowercase.

### 4.2 AgentAction

```ts
export type AgentAction =
  | { tool: 'click';    targetId: number;             rationale: string }
  | { tool: 'type';     targetId: number; value: string; rationale: string }
  | { tool: 'navigate'; url: string;                  rationale: string }
  | { tool: 'scroll';   direction: 'down' | 'up';     rationale: string }
  | { tool: 'finish';   summary: string };
```

### 4.3 Allowlist

Stored at `chrome.storage.local` key `siteAllowlist`:

```ts
type Allowlist = {
  origins: {
    [origin: string]: {
      addedAt: number;
      lastUsedAt: number;
    }
  }
}
```

Subdomains are distinct entries — approving `learning.oreilly.com` does not approve `oreilly.com` or `auth.oreilly.com`.

### 4.4 ActionLogEntry

```ts
export interface ActionLogEntry {
  id: string;                         // uuid
  ts: number;
  tool: AgentAction['tool'];
  args: Record<string, unknown>;
  rationale?: string;
  ok: boolean;
  message: string;                    // success or error text
  durationMs: number;
}
```

## 5. Provider interface

```ts
export interface Provider {
  proposePlan(input: {
    history: Message[];
    currentTab: { url: string; title: string };
    signal: AbortSignal;
  }): Promise<Plan>;

  runAgentStep(input: {
    plan: Plan;
    history: Message[];
    dom: string;
    screenshot?: string;              // base64 PNG; optional, model-dependent
    signal: AbortSignal;
  }): Promise<AgentAction>;
}
```

### 5.1 OpenAI adapter
- `proposePlan`: forces a `propose_plan(summary, steps, sites)` tool call via `tool_choice: "required"`. Reads `tool_calls[0].function.arguments`.
- `runAgentStep`: defines five tools (`click`, `type`, `navigate`, `scroll`, `finish`); `tool_choice: "required"`.
- Fallback for tool-less models: parse a fenced JSON block from the assistant message (preserves Aiside's current behavior).

### 5.2 Anthropic adapter
- POSTs to `https://api.anthropic.com/v1/messages` with required headers: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`.
- `proposePlan`: `tool_choice: { type: "tool", name: "propose_plan" }`.
- `runAgentStep`: `tool_choice: { type: "any" }`. Reads first `content[].type === "tool_use"` block.
- Streaming not used in v1 (faster + simpler tool-call handling).
- Default model: `claude-opus-4-7`. User-configurable in options.

### 5.3 Shared tool schemas
`providers/toolSchemas.ts` exports the canonical tool definitions; both adapters wrap them in their respective envelopes. This prevents drift.

## 6. Lifecycle

```
USER message
  → provider.proposePlan()                       runState = 'planning'
  → Plan validated & rendered in PlanCard        runState = 'awaiting-approval'

[Approve plan]
  → allowlist.addAll(plan.sites)
  → tabs.openAgentTab(plan.sites[0])
  → loop.run(plan, provider, agentTabId, signal) runState = 'running'

loop.run iteration:
  1. Get current tab origin; if not in allowlist → pause.
  2. Extract DOM via content script.
  3. provider.runAgentStep() → AgentAction.
  4. If action is 'navigate', resolve the target URL against the current tab's URL (handles relative URLs), then check the resolved origin against the allowlist; if missing → pause.
  5. Dispatch action; on stale-element error, re-extract DOM and retry once.
  6. Emit ActionLogEntry.
  7. If tool === 'finish' → done.

[Stop button]                                    runState = 'idle'
[Make changes] before approve                    plan text → input draft, runState = 'idle'
```

### 6.1 State machine

```
idle ─[user sends]─▶ planning ─[plan ok]─▶ awaiting-approval
awaiting-approval ─[Approve]─▶ running
awaiting-approval ─[Make changes]─▶ idle (with editable draft)
running ─[finish]─▶ done
running ─[off-allowlist | maxSteps]─▶ paused
running ─[Stop | error]─▶ idle | error
paused ─[continue]─▶ running
```

### 6.2 Invariants

1. `loop.run()` cannot be called without a validated `Plan`.
2. The allowlist is checked before every action; no `EXECUTE_ACTION` message is sent without a positive check.
3. AbortController is plumbed through every `fetch` and through `loop.run`.
4. Approve handler awaits `allowlist.addAll()` before starting the loop.

## 7. UI

### 7.1 PlanCard
Inline in the message stream after the user's first task message. Shows: model name pill, "Allow actions on these sites" list, "Approach to follow" numbered steps, [Approve plan] (Enter), [Make changes] (⌘+Enter), and the disclaimer line.

### 7.2 ActionLogRow
Collapsible row per step: status icon (✓ / ✗ / …), one-line summary, expand chevron. Expanded shows tool, args, rationale, message, latency.

### 7.3 Run controls
Compact bar under the input while running or paused:
- running: `[⏸ Stop]   step N/MAX`
- paused: `[▶ Continue] [✕ Cancel]   <reason>`

### 7.4 Options additions
1. **Provider** — radio (Anthropic | OpenAI-compatible) revealing the relevant fields. Persisted as `provider`.
2. **Agent settings** — single toggle: "Send screenshots to model (more accurate, ~2× cost)". Default off. Vision capability is determined by a static allowlist of model name prefixes per provider (`claude-*` for Anthropic; `gpt-4o*`, `gpt-4-vision*` for OpenAI). When the configured model isn't on the allowlist, the toggle is shown but disabled with a tooltip "Selected model doesn't support image input".
3. **Site permissions** — table of allowed origins with per-row Revoke and a global "Revoke all" (with confirm).

## 8. Error handling

| Failure | Caught in | UI | Recoverable |
|---|---|---|---|
| Plan validation fails | `agent/plan.ts` | Toast + retry button | Yes (1 retry) |
| Provider HTTP error | `providers/*` | Inline chat message | Manual |
| AbortError (Stop) | `agent/loop.ts` | "Stopped" log | N/A |
| Stale element | `agent/loop.ts` | Log row marked retried | Auto, 1 retry |
| Off-allowlist navigation | `agent/loop.ts` | Pause card + "Add & continue" | Yes |
| Max-step cap (default 25) | `agent/loop.ts` | Pause card + "Continue 25 more" | Yes |
| Agent tab closed | `agent/tabs.ts` (`tabs.onRemoved`) | "Tab closed — task cancelled" | No |
| Content script not injected | `agent/loop.ts` (timeout) | "Can't run on this page" | No |
| Malformed tool call | `providers/*` | Single retry, then stop | Limited |

### 8.1 Logging
`console.debug('[aiside]', ...)` gated by a `DEBUG` flag in `chrome.storage.local`. No external telemetry.

## 9. Testing

### 9.1 Coverage matrix

| Module | Test type | Key cases |
|---|---|---|
| `providers/openai.ts` | unit (fetch mocked) | tool path, fallback JSON path, malformed response, abort |
| `providers/anthropic.ts` | unit (fetch mocked) | tool_use parse, `tool_choice` envelope, headers correct, abort |
| `agent/plan.ts` | unit | valid, missing fields, too many steps, bad origin scheme, oversize |
| `agent/allowlist.ts` | unit (chrome.storage mocked) | add idempotency, normalization, subdomain isolation, revoke |
| `agent/loop.ts` | integration | run-to-finish, max-step pause, off-allowlist pause, stale retry, abort |
| `agent/tabs.ts` | unit | open, route by id, pause on `tabs.onRemoved` |
| `components/PlanCard.tsx` | RTL | renders, Approve/Make-changes callbacks, keybindings |
| `components/ActionLogRow.tsx` | RTL | success/failure/in-flight, expand toggle |
| `App.tsx` | RTL integration | full task, Make-changes path, Stop |
| `options.tsx` | RTL | provider switch, revoke flow |

### 9.2 Coverage targets
- New non-UI modules: ≥80% lines.
- New UI components: ≥70% lines.
- Match existing repo's vitest configuration.

### 9.3 Acceptance — manual smoke
1. Fresh install → options → set Anthropic key → save.
2. Open `learning.oreilly.com` → side panel → type "list all books on this site".
3. PlanCard renders within ~3 s with 1 site + 3–5 steps.
4. Approve → new tab opens at the origin → action log rows stream in.
5. Final assistant message contains a book list.
6. Options → Site permissions shows `learning.oreilly.com` with recent `lastUsedAt`.
7. Revoke clears the row.
8. Run a task that redirects off-allowlist → pause card → "Add & continue" → resumes.
9. Run a long task and Stop → halts within ≤1 step.
10. Switch provider to OpenAI-compatible (gpt-4o) → steps 2–5 still pass.

## 10. Decisions log (from brainstorming)

| # | Question | Decision |
|---|---|---|
| 1 | Which capability? | Full feature parity (plan UX + allowlist + better engine) |
| 2 | Provider story | Add Anthropic adapter alongside OpenAI; user picks in options |
| 3 | Approval flow | Plan-once gate; "Make changes" populates input draft; auto-pause on off-allowlist navigation |
| 4 | Allowlist persistence | Persistent + revocable in options; subdomain-isolated entries |
| 5 | Engine features | Stop button + max-step cap; stale-element retry; action log in chat; screenshots as off-by-default toggle |
| 6 | Tab scope | New tab per task; agent never touches other tabs |

## 11. Out of scope / explicit non-goals

- Cross-tab orchestration.
- Wildcard origin patterns (e.g., `*.oreilly.com`).
- Undo of agent actions.
- Live-provider testing in CI.
- Recorded scripts or macro replay.
- Headless / non-UI agent runs.
