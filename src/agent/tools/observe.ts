import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Observe = Extract<AgentAction, { tool: 'observe' }>;

export const observeTool = defineTool<Observe>({
  name: 'observe',
  description: 'Observe the current page URL, title, DOM, diagnostics, and page memory.',
  inputSchema: {
    type: 'object',
    properties: {
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({ tool: 'observe', rationale: String(args.rationale ?? '') }),
  describe: (a) => ({ tool: 'observe', rationale: a.rationale }),
  toContentPayload: () => ({ action: 'observe' }),
  summarize: () => 'page snapshot',
});
