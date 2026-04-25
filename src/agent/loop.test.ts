import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPlan } from './loop';
import type { AgentAction, Plan, Provider } from '../providers/types';

const plan: Plan = { summary: 's', steps: ['a'], sites: ['https://x.com'] };

function makeProvider(actions: AgentAction[]): Provider {
  let index = 0;
  return {
    proposePlan: vi.fn(),
    runAgentStep: vi.fn().mockImplementation(async () => {
      const action = actions[index];
      index += 1;
      if (!action) throw new Error('no more queued actions');
      return action;
    }),
  };
}

const baseDeps = () => ({
  agentTabId: 42,
  getDomTree: vi.fn().mockResolvedValue({
    dom: '<button id="1">x</button>',
    url: 'https://x.com',
    title: '',
  }),
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
    expect(result).toMatchObject({ summary: 'all done' });
    expect(deps.executeAction).toHaveBeenCalledTimes(1);
    expect(deps.onLog).toHaveBeenCalledTimes(2);
  });

  it('pauses on off-allowlist current URL', async () => {
    const provider = makeProvider([{ tool: 'click', targetId: 1, rationale: 'r' }]);
    const deps = baseDeps();
    deps.isAllowed.mockResolvedValueOnce(false);
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(result).toMatchObject({ reason: expect.stringMatching(/not in the allowlist/i) });
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
    deps.executeAction.mockResolvedValueOnce({
      success: false,
      error: 'Element with id 99 not found',
    });
    deps.executeAction.mockResolvedValueOnce({ success: true, message: 'clicked after retry' });
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('done');
    expect(deps.executeAction).toHaveBeenCalledTimes(2);
    expect(deps.getDomTree).toHaveBeenCalledTimes(3);
  });

  it('pauses on max-step cap', async () => {
    const actions: AgentAction[] = Array.from({ length: 30 }, () => ({
      tool: 'scroll',
      direction: 'down',
      rationale: 'r',
    }));
    const provider = makeProvider(actions);
    const deps = { ...baseDeps(), maxSteps: 3 };
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(result).toMatchObject({ reason: expect.stringMatching(/step limit/i) });
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
