import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Navigate = Extract<AgentAction, { tool: 'navigate' }>;

export const navigateTool = defineTool<Navigate>({
  name: 'navigate',
  description: 'Navigate the agent tab to a new URL. Must be on the approved site allowlist.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute URL or path resolved against the current page.' },
      rationale: { type: 'string' },
    },
    required: ['url', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'loop',
  coerce: (args) => ({
    tool: 'navigate',
    url: String(args.url),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'navigate', url: a.url, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'navigate', value: a.url }),
  summarize: ({ args }) => String(args.url),
});
