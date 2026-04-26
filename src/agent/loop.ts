import type { AgentAction, Message, Plan, Provider } from '../providers/types';

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
  let lastUrl = '';
  let lastTitle = '';

  for (let step = 0; step < deps.maxSteps; step += 1) {
    if (signal.aborted) return { status: 'aborted' };

    const dom = await deps.getDomTree();
    const annotatedDom = annotateDom(dom, lastUrl, lastTitle);
    lastUrl = dom.url;
    lastTitle = dom.title;

    let action: AgentAction;
    try {
      action = await provider.runAgentStep({ plan, history, dom: annotatedDom, signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { status: 'aborted' };
      return { status: 'error', error: err as Error };
    }

    history.push({ role: 'assistant', content: `ACTION: ${describeAction(action)}` });

    if (action.tool === 'finish') {
      deps.onLog(makeLogEntry(action, true, action.summary, 0));
      return { status: 'done', summary: action.summary };
    }

    if (action.tool === 'navigate') {
      const currentUrl = await deps.getCurrentUrl();
      const targetUrl = resolveUrl(action.url, currentUrl);

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
  switch (action.tool) {
    case 'click':
      return JSON.stringify({ tool: 'click', targetId: action.targetId, rationale: action.rationale });
    case 'type':
      return JSON.stringify({
        tool: 'type',
        targetId: action.targetId,
        value: action.value,
        rationale: action.rationale,
      });
    case 'scroll':
      return JSON.stringify({ tool: 'scroll', direction: action.direction, rationale: action.rationale });
    case 'navigate':
      return JSON.stringify({ tool: 'navigate', url: action.url, rationale: action.rationale });
    case 'finish':
      return JSON.stringify({ tool: 'finish', summary: action.summary });
  }
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

function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
