import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Scroll = Extract<AgentAction, { tool: 'scroll' }>;

export const scrollTool = defineTool<Scroll>({
  name: 'scroll',
  description: 'Scroll the page up or down by roughly one viewport.',
  inputSchema: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['down', 'up'] },
      rationale: { type: 'string' },
    },
    required: ['direction', 'rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'scroll',
    direction: args.direction === 'up' ? 'up' : 'down',
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'scroll', direction: a.direction, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'scroll', direction: a.direction }),
  summarize: ({ args }) => String(args.direction),
});
