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

  it('passes screenshot to provider when screenshots are enabled', async () => {
    const provider = makeProvider([{ tool: 'finish', summary: 'k' }]);
    const deps = {
      ...baseDeps(),
      includeScreenshots: true,
      captureScreenshot: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
    };

    await runPlan(plan, provider, deps, new AbortController().signal);

    expect(deps.captureScreenshot).toHaveBeenCalled();
    expect(vi.mocked(provider.runAgentStep).mock.calls[0][0].screenshot).toBe('data:image/jpeg;base64,abc');
  });

  it('does not capture screenshot when screenshots are disabled', async () => {
    const provider = makeProvider([{ tool: 'finish', summary: 'k' }]);
    const deps = {
      ...baseDeps(),
      includeScreenshots: false,
      captureScreenshot: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
    };

    await runPlan(plan, provider, deps, new AbortController().signal);

    expect(deps.captureScreenshot).not.toHaveBeenCalled();
  });

  it('handles screenshot tool without storing raw base64 in history', async () => {
    const provider = makeProvider([
      { tool: 'screenshot', rationale: 'look' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = {
      ...baseDeps(),
      captureScreenshot: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
    };

    await runPlan(plan, provider, deps, new AbortController().signal);

    const secondHistory = vi.mocked(provider.runAgentStep).mock.calls[1][0].history.map((m) => m.content).join('\n');
    expect(secondHistory).toContain('[base64 screenshot captured]');
    expect(secondHistory).not.toContain('data:image/jpeg;base64,abc');
  });

  it('waits, clamps duration, and logs result', async () => {
    vi.useFakeTimers();
    const provider = makeProvider([
      { tool: 'wait', ms: 1, rationale: 'tiny wait' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = baseDeps();

    const promise = runPlan(plan, provider, deps, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    vi.useRealTimers();

    expect(result.status).toBe('done');
    expect(deps.onLog).toHaveBeenCalledWith(expect.objectContaining({ tool: 'wait', message: 'Waited 100ms' }));
  });

  it('feeds observe result data into next runAgentStep call', async () => {
    const provider = makeProvider([
      { tool: 'observe', rationale: 'check page' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = baseDeps();
    deps.executeAction.mockResolvedValueOnce({
      success: true,
      message: 'Observed page state',
      data: { url: 'https://x.com', consoleErrors: [] },
    });

    await runPlan(plan, provider, deps, new AbortController().signal);

    const secondHistory = vi.mocked(provider.runAgentStep).mock.calls[1][0].history.map((m) => m.content).join('\n');
    expect(secondHistory).toContain('"data"');
    expect(secondHistory).toContain('consoleErrors');
  });

  it('seeds runAgentStep history from initialMessages', async () => {
    const provider = makeProvider([{ tool: 'finish', summary: 'k' }]);
    const deps = {
      ...baseDeps(),
      initialMessages: [{ role: 'user' as const, content: 'find me books on topology' }],
    };
    await runPlan(plan, provider, deps, new AbortController().signal);
    const firstCall = vi.mocked(provider.runAgentStep).mock.calls[0][0];
    expect(firstCall.history.map((m) => m.content)).toContain('find me books on topology');
  });

  it('pauses when navigate target is off-allowlist', async () => {
    const provider = makeProvider([
      { tool: 'navigate', url: 'https://evil.com', rationale: 'r' },
    ]);
    const deps = { ...baseDeps(), isOriginAllowed: (origin: string) => origin === 'https://x.com' };
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(result).toMatchObject({ reason: expect.stringMatching(/Off-allowlist navigation/i) });
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('pauses when the page url drifts off-allowlist', async () => {
    const provider = makeProvider([{ tool: 'finish', summary: 'k' }]);
    const deps = baseDeps();
    deps.getDomTree.mockResolvedValueOnce({ dom: '', url: 'https://drift.com', title: '' });
    const result = await runPlan(plan, provider, {
      ...deps,
      isOriginAllowed: (origin: string) => origin === 'https://x.com',
    }, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(result).toMatchObject({ reason: expect.stringMatching(/off-allowlist origin/i) });
  });

  it('blocks destructive tools in read-only permission mode', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'r' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = { ...baseDeps(), permissionMode: 'read-only' as const };
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('done');
    expect(deps.executeAction).not.toHaveBeenCalled();
    const calls = vi.mocked(deps.onLog).mock.calls.map(([entry]) => entry);
    expect(calls.some((entry) => /Read-only mode blocked/.test(entry.message))).toBe(true);
  });

  it('asks before destructive action in ask mode and pauses on deny', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'r' },
    ]);
    const deps = {
      ...baseDeps(),
      permissionMode: 'ask' as const,
      checkPermission: () => 'ask' as const,
      requestPermission: vi.fn().mockResolvedValue('deny'),
    };
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('paused');
    expect(deps.requestPermission).toHaveBeenCalled();
    expect(deps.executeAction).not.toHaveBeenCalled();
  });

  it('proceeds when allow verdict is returned in ask mode', async () => {
    const provider = makeProvider([
      { tool: 'click', targetId: 1, rationale: 'r' },
      { tool: 'finish', summary: 'k' },
    ]);
    const deps = {
      ...baseDeps(),
      permissionMode: 'ask' as const,
      checkPermission: () => 'allow' as const,
    };
    const result = await runPlan(plan, provider, deps, new AbortController().signal);
    expect(result.status).toBe('done');
    expect(deps.executeAction).toHaveBeenCalledTimes(1);
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
