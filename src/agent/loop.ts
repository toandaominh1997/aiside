import type { AgentAction, Message, Plan, Provider } from '../providers/types';
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
  void deps.agentTabId;
  if (signal.aborted) return { status: 'aborted' };

  const history: Message[] = [];

  for (let step = 0; step < deps.maxSteps; step += 1) {
    if (signal.aborted) return { status: 'aborted' };

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

      const start = Date.now();
      try {
        await deps.navigate(targetUrl);
        deps.onLog(makeLogEntry(action, true, `Navigated to ${targetUrl}`, Date.now() - start));
      } catch (err) {
        deps.onLog(makeLogEntry(action, false, (err as Error).message, Date.now() - start));
        return { status: 'error', error: err as Error };
      }
      history.push({ role: 'assistant', content: `[navigate ${targetUrl}]` });
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
