import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response);
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
    const provider = new AnthropicProvider(config);
    const plan = await provider.proposePlan({
      history: [{ role: 'user', content: 'hi' }],
      currentTab: { url: 'https://example.com', title: 'X' },
      signal: new AbortController().signal,
    });
    expect(plan.summary).toBe('sum');
  });

  it('runAgentStep returns AgentAction from tool_use', async () => {
    mockFetchOnce({
      content: [{ type: 'tool_use', name: 'click', input: { targetId: 3, rationale: 'because' } }],
    });
    const provider = new AnthropicProvider(config);
    const action = await provider.runAgentStep({
      plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
      history: [],
      dom: '<button id="3">x</button>',
      signal: new AbortController().signal,
    });
    expect(action).toEqual({ tool: 'click', targetId: 3, target: undefined, rationale: 'because' });
  });

  it('parses mention-target click and power tools', async () => {
    const cases = [
      {
        name: 'click',
        input: { target: '@button-submit-0', rationale: 'mentioned' },
        expected: { tool: 'click', targetId: undefined, target: '@button-submit-0', rationale: 'mentioned' },
      },
      {
        name: 'click_at',
        input: { x: 120, y: 240, rationale: 'visual checkbox' },
        expected: { tool: 'click_at', x: 120, y: 240, rationale: 'visual checkbox' },
      },
      {
        name: 'hotkey',
        input: { keys: ['Meta', 'K'], rationale: 'open command palette' },
        expected: { tool: 'hotkey', keys: ['Meta', 'K'], rationale: 'open command palette' },
      },
      {
        name: 'wait',
        input: { ms: 500, rationale: 'loading' },
        expected: { tool: 'wait', ms: 500, rationale: 'loading' },
      },
      {
        name: 'remember',
        input: { key: 'page', value: 'pricing', rationale: 'use later' },
        expected: { tool: 'remember', key: 'page', value: 'pricing', rationale: 'use later' },
      },
      {
        name: 'recall',
        input: { key: 'page', rationale: 'need context' },
        expected: { tool: 'recall', key: 'page', rationale: 'need context' },
      },
      {
        name: 'get_console_errors',
        input: { rationale: 'debug' },
        expected: { tool: 'get_console_errors', rationale: 'debug' },
      },
    ];

    for (const testCase of cases) {
      mockFetchOnce({
        content: [{ type: 'tool_use', name: testCase.name, input: testCase.input }],
      });
      const provider = new AnthropicProvider(config);
      await expect(
        provider.runAgentStep({
          plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
          history: [],
          dom: '<button id="3">x</button>',
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(testCase.expected);
    }
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
    global.fetch = fetchSpy;
    const provider = new AnthropicProvider(config);
    await provider.proposePlan({
      history: [{ role: 'user', content: 'x' }],
      currentTab: { url: 'https://x.com', title: '' },
      signal: new AbortController().signal,
    });
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('uses configured baseUrl when provided', async () => {
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
    global.fetch = fetchSpy;
    const provider = new AnthropicProvider({
      ...config,
      baseUrl: 'https://anthropic-proxy.test/v1/',
    });
    await provider.proposePlan({
      history: [{ role: 'user', content: 'x' }],
      currentTab: { url: 'https://x.com', title: '' },
      signal: new AbortController().signal,
    });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://anthropic-proxy.test/v1/messages');
  });

  it('translates ACTION/RESULT history into native tool_use/tool_result blocks', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({
        content: [{ type: 'tool_use', id: 'srv-1', name: 'finish', input: { summary: 'k' } }],
      }),
    });
    global.fetch = fetchSpy;
    const provider = new AnthropicProvider(config);
    await provider.runAgentStep({
      plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
      history: [
        { role: 'user', content: 'find books' },
        { role: 'assistant', content: 'ACTION: {"tool":"click","targetId":1,"rationale":"r"}' },
        { role: 'user', content: 'RESULT: {"ok":true,"message":"clicked"}' },
      ],
      dom: '<button id="1">x</button>',
      signal: new AbortController().signal,
    });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toMatchObject([
      { type: 'tool_use', name: 'click', input: expect.objectContaining({ targetId: 1 }) },
    ]);
    const toolResult = messages.find(
      (m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'),
    );
    expect(toolResult).toBeTruthy();
    expect(body.tools.at(-1)).toMatchObject({ cache_control: { type: 'ephemeral' } });
  });

  it('parses read_page and find_in_page tool calls', async () => {
    mockFetchOnce({
      content: [{ type: 'tool_use', name: 'read_page', input: { rationale: 'reading' } }],
    });
    let provider = new AnthropicProvider(config);
    await expect(
      provider.runAgentStep({
        plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
        history: [],
        dom: '',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ tool: 'read_page', rationale: 'reading' });

    mockFetchOnce({
      content: [
        { type: 'tool_use', name: 'find_in_page', input: { query: 'pricing', limit: 3, rationale: 'r' } },
      ],
    });
    provider = new AnthropicProvider(config);
    await expect(
      provider.runAgentStep({
        plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
        history: [],
        dom: '',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ tool: 'find_in_page', query: 'pricing', limit: 3, rationale: 'r' });
  });

  it('parses string targetId for click', async () => {
    mockFetchOnce({
      content: [
        { type: 'tool_use', name: 'click', input: { targetId: 'button-submit-3a4f', rationale: 'r' } },
      ],
    });
    const provider = new AnthropicProvider(config);
    await expect(
      provider.runAgentStep({
        plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
        history: [],
        dom: '',
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      tool: 'click',
      targetId: 'button-submit-3a4f',
      target: undefined,
      rationale: 'r',
    });
  });

  it('throws on non-OK response', async () => {
    mockFetchOnce({ error: 'bad' }, { ok: false, status: 500 });
    const provider = new AnthropicProvider(config);
    await expect(
      provider.proposePlan({
        history: [{ role: 'user', content: 'x' }],
        currentTab: { url: 'https://x.com', title: '' },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/500/);
  });
});
