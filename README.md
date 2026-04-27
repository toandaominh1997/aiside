# AISide

AISide is a Chrome Manifest V3 extension that brings an agentic AI assistant into the browser side panel. It can read the current page, collect page context, propose an action plan, and then operate a browser tab through tool calls such as clicking, typing, navigating, scrolling, reading page content, and inspecting console or network failures.

The project is built with React, TypeScript, Vite, Tailwind, Vitest, and Chrome extension APIs.

## Features

- **Chrome side panel assistant** opened from the extension action.
- **Plan-first agent flow**: the model proposes a plan and requested sites before browser actions run.
- **Browser action loop** with logged tool calls and stop/pause handling.
- **Dedicated agent tab by default**, with an option to run in the current tab.
- **Default-allow site policy with configurable per-origin overrides** stored in `chrome.storage.local`.
- **Permission modes** for read-only, ask-before-acting, and auto execution.
- **Page-aware prompts** using current URL, title, selected text, simplified DOM, page mentions, and optional diagnostics.
- **`@` mentions** for selected text, headings, landmarks, links, buttons, inputs, images, tables, and forms.
- **Slash commands** for common page tasks.
- **Anthropic and OpenAI-compatible providers**.
- **Native Anthropic tool-use round trip** with prompt caching on the final tool schema.
- **OpenAI-compatible streaming tool calls** and JSON fallback parsing.
- **Readable page tools** for article-style extraction and in-page search.

## How it works

AISide is split into four Chrome extension surfaces:

- `src/App.tsx` — the side panel chat UI, plan approval flow, permission prompts, agent run orchestration, and provider configuration loading.
- `src/background.ts` — the Manifest V3 service worker that enables the side panel and adds the “Ask Aiside about this” context menu.
- `src/content.ts` — the content script that summarizes the page, collects mentions, captures diagnostics, and executes browser actions inside the page.
- `src/options.tsx` — the options page for provider settings and site permissions.

Supporting modules live under:

- `src/agent/loop.ts` — bounded agent loop, action logging, permission gating, blocked-site checks, wait/screenshot/navigate handling, and tool-result feedback.
- `src/agent/plan.ts` — plan validation and HTTP(S) origin normalization.
- `src/agent/allowlist.ts` — persistent site override storage, block removal, last-used timestamps, and per-origin action mode.
- `src/agent/tabs.ts` — agent-tab creation, navigation, content-script messaging, and content-script reinjection.
- `src/agent/mentions.ts` — page mention resolution, ranking, and prompt context formatting.
- `src/agent/commands.ts` — slash command parsing and expansion.
- `src/providers/` — provider adapters, tool schemas, provider config types, and provider selection.
- `src/components/` — UI components for command menus, mention menus, plans, permissions, site permissions, and action logs.

## Browser tools

Tool schemas are defined in `src/providers/toolSchemas.ts`; action types are defined in `src/providers/types.ts`.

AISide currently supports:

- `propose_plan` — propose a user-approvable plan with target sites.
- `click` — click an element by numeric DOM id, stable `data-aid`, or `@` mention.
- `type` — type into an input or textarea by id or mention.
- `navigate` — navigate the agent tab to an absolute URL or path resolved against the current page.
- `scroll` — scroll up or down.
- `click_at` — click viewport coordinates using `document.elementFromPoint`.
- `press_key` — press a single key.
- `hotkey` — press a keyboard shortcut.
- `type_text` — type into the currently focused editable element.
- `screenshot` — capture visible tab state when screenshot capture is available.
- `get_console_errors` — read captured console and unhandled errors.
- `get_network_failures` — read captured resource and network failures.
- `wait` — wait briefly for async page changes.
- `observe` — inspect current page URL, title, DOM, diagnostics, and page-local memory.
- `read_page` — extract readable page content as Markdown-like text.
- `find_in_page` — search current page text and scroll the first match into view.
- `remember` / `recall` — store and retrieve page-local facts during an agent run.
- `finish` — end the task with a user-facing summary.

The content script generates a simplified DOM with stable `data-aid` values, numeric ids, viewport hints, and region grouping so models can refer to page controls consistently across turns.

## Slash commands

Slash commands are defined in `src/agent/commands.ts`:

- `/summarize` — summarize the current page in five concise bullets.
- `/extract [thing]` — extract structured data from the current page.
- `/find [query]` — find something on the page, scroll to it, and report surrounding context.
- `/ask [question]` — answer from the current page without taking browser actions.
- `/new` — start a new chat.
- `/help` — show available commands.

## Page mentions

Typing `@` in the prompt opens a page mention menu. AISide can reference:

- current selection
- headings
- sections and landmarks
- buttons
- links
- inputs
- images
- tables
- forms

Mentioned items are converted into a context block containing the element kind, tag, visible text, useful attributes, selector, role, ARIA label, bounding box, and nearby text.

## Providers

AISide supports two provider modes.

### Anthropic

The Anthropic adapter is implemented in `src/providers/anthropic.ts` and calls the Messages API directly from the browser.

Default settings:

- Base URL: `https://api.anthropic.com/v1`
- Model: `claude-opus-4-7`

The adapter sends Anthropic tool schemas, translates the existing action/result history into native `tool_use` and `tool_result` content blocks, and adds ephemeral prompt caching to the final tool schema.

Because calls are made from the browser, requests include `anthropic-dangerous-direct-browser-access: true`.

### OpenAI-compatible

The OpenAI-compatible adapter is implemented in `src/providers/openai.ts` and calls `/chat/completions` with tool definitions.

Default settings:

- Base URL: `https://api.openai.com/v1`
- Model: configurable in options

The options UI also supports local or compatible endpoints such as `http://localhost:11434/v1`.

## Permissions and safety model

AISide requests these Chrome permissions in `public/manifest.json`:

- `sidePanel`
- `storage`
- `tabs`
- `scripting`
- `contextMenus`

It also declares `<all_urls>` host permissions and injects `content.js` on `<all_urls>` so it can inspect and act on pages the user opens.

Runtime safety features include:

- Plan validation before execution.
- Sites are approved by default unless an origin override blocks them.
- Per-origin action mode: `auto`, `ask`, or `never`.
- Per-task permission mode: read-only, ask, or auto.
- Read-only mode blocks destructive tools.
- Ask mode prompts before destructive tools unless the origin/action has already been allowed.
- `never` origin overrides pause page drift and navigation before actions run.
- Agent runs are bounded by `MAX_STEPS = 25` in `src/App.tsx`.
- The user can stop an active run from the side panel.

API keys and provider settings are stored in `chrome.storage.local`. Do not load the extension into Chrome profiles or pages where you are not comfortable granting broad extension access.

## Install and run locally

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist` directory.
5. Open the extension options page and configure a provider/API key.
6. Click the extension icon to open AISide in the side panel.

## Development

Start Vite:

```bash
npm run dev
```

For extension testing, build and load `dist` as an unpacked extension. The Vite build is configured with fixed output names because `public/manifest.json` references `background.js`, `content.js`, `index.html`, and `options.html` directly.

Useful scripts:

```bash
npm run logo           # regenerate extension PNG logos
npm run build          # regenerate logos, typecheck, and build extension output
npm run lint           # run ESLint
npm test               # run Vitest once
npm run test:coverage  # run Vitest with coverage
npm run preview        # preview the Vite build
```

## Project structure

```text
public/manifest.json        Chrome extension manifest
scripts/rasterize-logo.mjs  SVG-to-PNG logo generation
src/background.ts           MV3 service worker
src/content.ts              page context and browser action bridge
src/App.tsx                 side panel application
src/options.tsx             options and permissions page
src/agent/                  agent loop, commands, mentions, tabs, allowlist, plan validation
src/components/             React UI components
src/providers/              Anthropic/OpenAI adapters and tool schemas
src/*.test.ts[x]            Vitest coverage for extension behavior
vite.config.ts              Vite, Rollup, and Vitest configuration
```

## Testing status

The current implementation is covered by Vitest tests for the agent loop, allowlist, tabs, plans, mentions, commands, provider adapters, tool schemas, content script actions, background script behavior, and UI components.

Before submitting changes, run:

```bash
npm run lint
npx tsc -b
npm test
npm run build
```
