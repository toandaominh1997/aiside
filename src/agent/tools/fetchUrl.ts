import { defineTool, type ToolResult } from './registry';
import type { AgentAction } from '../../providers/types';

type FetchUrl = Extract<AgentAction, { tool: 'fetch_url' }>;

const MAX_BYTES = 256 * 1024;

export const fetchUrlTool = defineTool<FetchUrl>({
  name: 'fetch_url',
  description:
    'Fetch a URL via the extension (cross-origin allowed). Returns up to 256 KB of response text plus status and content-type. GET by default; pass method+body for POST.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute URL to fetch (http(s) only).' },
      method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method, default GET.' },
      body: { type: 'string', description: 'Request body string for POST.' },
      rationale: { type: 'string' },
    },
    required: ['url', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'background',
  coerce: (args) => ({
    tool: 'fetch_url',
    url: String(args.url ?? ''),
    method: args.method === 'POST' ? 'POST' : 'GET',
    body: typeof args.body === 'string' ? args.body : undefined,
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({
    tool: 'fetch_url',
    url: a.url,
    method: a.method,
    body: a.body,
    rationale: a.rationale,
  }),
  runInBackground: async (action): Promise<ToolResult> => {
    let parsed: URL;
    try {
      parsed = new URL(action.url);
    } catch {
      return { success: false, error: `Invalid URL: ${action.url}` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: `Unsupported protocol: ${parsed.protocol}` };
    }

    try {
      const init: RequestInit = { method: action.method ?? 'GET' };
      if (action.method === 'POST' && action.body !== undefined) init.body = action.body;
      const res = await fetch(action.url, init);
      const contentType = res.headers.get('content-type') ?? '';
      const buffer = await res.arrayBuffer();
      const truncated = buffer.byteLength > MAX_BYTES;
      const slice = truncated ? buffer.slice(0, MAX_BYTES) : buffer;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      return {
        success: true,
        message: `${res.status} ${res.statusText} (${buffer.byteLength} bytes${truncated ? `, truncated to ${MAX_BYTES}` : ''})`,
        data: {
          status: res.status,
          contentType,
          body: text,
          truncated,
          byteLength: buffer.byteLength,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
  summarize: ({ args }) => `${args.method ?? 'GET'} ${args.url}`,
});
