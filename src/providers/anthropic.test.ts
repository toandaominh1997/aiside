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
    expect(action).toEqual({ tool: 'click', targetId: 3, rationale: 'because' });
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
