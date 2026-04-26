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

  it('feeds prior action + result back into the next runAgentStep call', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'click submit' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = baseDeps();
    deps.executeAction.mockResolvedValueOnce({ success: true, message: 'clicked submit' });

    await runPlan(plan, provider, deps, new AbortController().signal);

    const secondCall = vi.mocked(provider.runAgentStep).mock.calls[1][0];
    const historyContents = secondCall.history.map((m) => m.content);
    expect(historyContents[0]).toMatch(/ACTION:.*click.*targetId":1/);
    expect(historyContents[1]).toMatch(/RESULT:.*"ok":true.*clicked submit/);
  });

  it('annotates the DOM with URL/title and notes deltas across steps', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'r' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = baseDeps();
    deps.getDomTree
      .mockResolvedValueOnce({ dom: '<a id="1">go</a>', url: 'https://x.com/a', title: 'A' })
      .mockResolvedValueOnce({ dom: '<a id="2">x</a>', url: 'https://x.com/b', title: 'B' });

    await runPlan(plan, provider, deps, new AbortController().signal);

    const firstDom = vi.mocked(provider.runAgentStep).mock.calls[0][0].dom;
    const secondDom = vi.mocked(provider.runAgentStep).mock.calls[1][0].dom;
    expect(firstDom).toContain('URL: https://x.com/a');
    expect(firstDom).not.toContain('URL changed');
    expect(secondDom).toContain('URL: https://x.com/b');
    expect(secondDom).toContain('URL changed from https://x.com/a');
    expect(secondDom).toContain('TITLE changed from A');
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
