import type { AgentAction, Message, Plan, Provider } from '../providers/types';
import { registry } from './tools';

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

export type PermissionMode = 'read-only' | 'ask' | 'auto';
export type PermissionVerdict = 'allow' | 'deny' | 'ask';

export function isDestructive(tool: AgentAction['tool']): boolean {
  return registry.get(tool)?.risk === 'destructive';
}

export function isHighRisk(tool: AgentAction['tool']): boolean {
  return registry.get(tool)?.risk === 'high-risk';
}

export interface LoopDeps {
  agentTabId: number;
  getDomTree: () => Promise<{ dom: string; url: string; title: string }>;
  getCurrentUrl: () => Promise<string>;
  executeAction: (
    action: AgentAction,
  ) => Promise<{ success: boolean; message?: string; error?: string; data?: unknown }>;
  navigate: (url: string) => Promise<void>;
  captureScreenshot?: () => Promise<string | undefined>;
  includeScreenshots?: boolean;
  onLog: (entry: ActionLogEntry) => void;
  maxSteps: number;
  initialMessages?: Message[];
  isOriginAllowed?: (origin: string) => boolean;
  onAllowlistTouch?: (origin: string) => void;
  permissionMode?: PermissionMode;
  checkPermission?: (origin: string, action: AgentAction) => PermissionVerdict;
  onPermissionDecision?: (origin: string, action: AgentAction, decision: 'once' | 'always') => void;
  requestPermission?: (origin: string, action: AgentAction) => Promise<'once' | 'always' | 'deny'>;
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
  void deps.agentTabId;
  if (signal.aborted) return { status: 'aborted' };

  const history: Message[] = deps.initialMessages ? [...deps.initialMessages] : [];
  let lastUrl = '';
  let lastTitle = '';

  for (let step = 0; step < deps.maxSteps; step += 1) {
    if (signal.aborted) return { status: 'aborted' };

    const dom = await deps.getDomTree();
    if (deps.isOriginAllowed) {
      const origin = safeOrigin(dom.url);
      if (origin && !deps.isOriginAllowed(origin)) {
        const reason = `Page is on off-allowlist origin ${origin}`;
        return { status: 'paused', reason };
      }
      if (origin) deps.onAllowlistTouch?.(origin);
    }
    const annotatedDom = annotateDom(dom, lastUrl, lastTitle);
    lastUrl = dom.url;
    lastTitle = dom.title;

    let action: AgentAction;
    try {
      const screenshot = deps.includeScreenshots ? await deps.captureScreenshot?.() : undefined;
      action = await provider.runAgentStep({ plan, history, dom: annotatedDom, screenshot, signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { status: 'aborted' };
      return { status: 'error', error: err as Error };
    }

    history.push({ role: 'assistant', content: `ACTION: ${describeAction(action)}` });

    if (
      deps.permissionMode === 'read-only' &&
      (isDestructive(action.tool) || isHighRisk(action.tool))
    ) {
      const reason = `Read-only mode blocked tool ${action.tool}`;
      deps.onLog(makeLogEntry(action, false, reason, 0));
      history.push({
        role: 'user',
        content: `RESULT: ${JSON.stringify({ ok: false, message: reason })}`,
      });
      continue;
    }

    const needsApproval =
      isHighRisk(action.tool) ||
      (deps.permissionMode === 'ask' && isDestructive(action.tool));

    if (needsApproval) {
      const origin = safeOrigin(lastUrl) ?? '';
      const verdict = deps.checkPermission?.(origin, action) ?? 'ask';
      if (verdict === 'deny') {
        const reason = `Permission denied for ${action.tool} on ${origin || 'unknown'}`;
        deps.onLog(makeLogEntry(action, false, reason, 0));
        history.push({
          role: 'user',
          content: `RESULT: ${JSON.stringify({ ok: false, message: reason })}`,
        });
        continue;
      }
      if (verdict === 'ask') {
        const decision = (await deps.requestPermission?.(origin, action)) ?? 'deny';
        if (decision === 'deny') {
          const reason = `User denied ${action.tool} on ${origin || 'unknown'}`;
          deps.onLog(makeLogEntry(action, false, reason, 0));
          return { status: 'paused', reason };
        }
        deps.onPermissionDecision?.(origin, action, decision);
      }
    }

    if (action.tool === 'finish') {
      deps.onLog(makeLogEntry(action, true, action.summary, 0));
      return { status: 'done', summary: action.summary };
    }

    if (action.tool === 'navigate') {
      const currentUrl = await deps.getCurrentUrl();
      const targetUrl = resolveUrl(action.url, currentUrl);

      if (deps.isOriginAllowed) {
        const targetOrigin = safeOrigin(targetUrl);
        if (!targetOrigin || !deps.isOriginAllowed(targetOrigin)) {
          const reason = `Off-allowlist navigation to ${targetOrigin ?? targetUrl}`;
          deps.onLog(makeLogEntry(action, false, reason, 0));
          return { status: 'paused', reason };
        }
        deps.onAllowlistTouch?.(targetOrigin);
      }

      const start = Date.now();
      try {
        await deps.navigate(targetUrl);
        deps.onLog(makeLogEntry(action, true, `Navigated to ${targetUrl}`, Date.now() - start));
        history.push({
          role: 'user',
          content: `RESULT: ${JSON.stringify({ ok: true, message: `navigated to ${targetUrl}` })}`,
        });
      } catch (err) {
        deps.onLog(makeLogEntry(action, false, (err as Error).message, Date.now() - start));
        return { status: 'error', error: err as Error };
      }
      continue;
    }

    if (action.tool === 'wait') {
      const ms = clampWaitMs(action.ms);
      const start = Date.now();
      try {
        await waitFor(ms, signal);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return { status: 'aborted' };
        return { status: 'error', error: err as Error };
      }
      const message = `Waited ${ms}ms`;
      deps.onLog(makeLogEntry(action, true, message, Date.now() - start));
      history.push({ role: 'user', content: `RESULT: ${JSON.stringify({ ok: true, message })}` });
      continue;
    }

    if (action.tool === 'screenshot') {
      const start = Date.now();
      const screenshot = await deps.captureScreenshot?.();
      const ok = Boolean(screenshot);
      const message = ok ? 'Captured screenshot' : 'Screenshot capture unavailable';
      deps.onLog(makeLogEntry(action, ok, message, Date.now() - start));
      history.push({
        role: 'user',
        content: `RESULT: ${JSON.stringify({
          ok,
          message,
          screenshot: screenshot ? '[base64 screenshot captured]' : undefined,
        })}`,
      });
      continue;
    }

    const start = Date.now();
    let result = await deps.executeAction(action);
    if (!result.success && typeof result.error === 'string' && /not found/i.test(result.error)) {
      await deps.getDomTree();
      result = await deps.executeAction(action);
    }

    deps.onLog(
      makeLogEntry(action, result.success, result.message ?? result.error ?? '', Date.now() - start),
    );
    history.push({
      role: 'user',
      content: `RESULT: ${JSON.stringify({
        ok: result.success,
        message: result.success ? result.message ?? '' : result.error ?? '',
        data: result.data,
      })}`,
    });
  }

  return { status: 'paused', reason: `Hit step limit (${deps.maxSteps})` };
}

function annotateDom(
  dom: { dom: string; url: string; title: string },
  lastUrl: string,
  lastTitle: string,
): string {
  const lines = [`URL: ${dom.url}`, `TITLE: ${dom.title}`];
  if (lastUrl && dom.url !== lastUrl) lines.push(`(URL changed from ${lastUrl})`);
  if (lastTitle && dom.title !== lastTitle) lines.push(`(TITLE changed from ${lastTitle})`);
  return `${lines.join('\n')}\n\n${dom.dom}`;
}

function describeAction(action: AgentAction): string {
  const def = registry.get(action.tool);
  if (!def) throw new Error(`Unknown tool: ${action.tool}`);
  return JSON.stringify(def.describe(action));
}

function makeLogEntry(
  action: AgentAction,
  ok: boolean,
  message: string,
  durationMs: number,
): ActionLogEntry {
  const { tool, ...rest } = action as Record<string, unknown> & { tool: AgentAction['tool'] };
  void tool;
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    tool: action.tool,
    args: rest,
    rationale: 'rationale' in action ? action.rationale : undefined,
    ok,
    message,
    durationMs,
  };
}

function clampWaitMs(ms: number): number {
  if (!Number.isFinite(ms)) return 1000;
  return Math.min(10000, Math.max(100, Math.round(ms)));
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function safeOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
  } catch {
    return null;
  }
}
