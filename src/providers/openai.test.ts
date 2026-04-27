import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response);
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

    const provider = new OpenAIProvider(config);
    const plan = await provider.proposePlan({
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
    const provider = new OpenAIProvider(config);
    const plan = await provider.proposePlan({
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
    const provider = new OpenAIProvider(config);
    const action = await provider.runAgentStep({
      plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
      history: [],
      dom: '<button id="7">Go</button>',
      signal: new AbortController().signal,
    });
    expect(action).toEqual({ tool: 'click', targetId: 7, target: undefined, rationale: 'cuz' });
  });

  it('parses mention-target click and power tools', async () => {
    const cases = [
      {
        name: 'click',
        args: { target: '@button-submit-0', rationale: 'mentioned' },
        expected: { tool: 'click', targetId: undefined, target: '@button-submit-0', rationale: 'mentioned' },
      },
      {
        name: 'press_key',
        args: { key: 'Enter', rationale: 'toggle focused checkbox' },
        expected: { tool: 'press_key', key: 'Enter', rationale: 'toggle focused checkbox' },
      },
      {
        name: 'type_text',
        args: { value: 'hello', rationale: 'type into focused editor' },
        expected: { tool: 'type_text', value: 'hello', rationale: 'type into focused editor' },
      },
      {
        name: 'wait',
        args: { ms: 500, rationale: 'loading' },
        expected: { tool: 'wait', ms: 500, rationale: 'loading' },
      },
      {
        name: 'remember',
        args: { key: 'page', value: 'pricing', rationale: 'use later' },
        expected: { tool: 'remember', key: 'page', value: 'pricing', rationale: 'use later' },
      },
      {
        name: 'recall',
        args: { key: 'page', rationale: 'need context' },
        expected: { tool: 'recall', key: 'page', rationale: 'need context' },
      },
      {
        name: 'get_network_failures',
        args: { rationale: 'debug' },
        expected: { tool: 'get_network_failures', rationale: 'debug' },
      },
    ];

    for (const testCase of cases) {
      mockFetchOnce({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: testCase.name,
                    arguments: JSON.stringify(testCase.args),
                  },
                },
              ],
            },
          },
        ],
      });
      const provider = new OpenAIProvider(config);
      await expect(
        provider.runAgentStep({
          plan: { summary: 's', steps: ['a'], sites: ['https://x.com'] },
          history: [],
          dom: '<button id="7">Go</button>',
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual(testCase.expected);
    }
  });

  it('throws when API responds non-OK', async () => {
    mockFetchOnce({ error: { message: 'bad key' } }, { ok: false, status: 401 });
    const provider = new OpenAIProvider(config);
    await expect(
      provider.proposePlan({
        history: [{ role: 'user', content: 'x' }],
        currentTab: { url: 'https://x.com', title: '' },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/401/);
  });

  it('passes the abort signal through to fetch', async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    global.fetch = fetchSpy;
    const ctrl = new AbortController();
    const provider = new OpenAIProvider(config);
    ctrl.abort();
    await expect(
      provider.proposePlan({
        history: [{ role: 'user', content: 'x' }],
        currentTab: { url: 'https://x.com', title: '' },
        signal: ctrl.signal,
      }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalled();
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal).toBe(ctrl.signal);
  });
});
