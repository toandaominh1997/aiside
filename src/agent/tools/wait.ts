import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Wait = Extract<AgentAction, { tool: 'wait' }>;

export const waitTool = defineTool<Wait>({
  name: 'wait',
  description: 'Wait briefly for async page changes. Use 100-10000 milliseconds.',
  inputSchema: {
    type: 'object',
    properties: {
      ms: { type: 'number', description: 'Milliseconds to wait, clamped to 100-10000.' },
      rationale: { type: 'string' },
    },
    required: ['ms', 'rationale'],
  },
  risk: 'safe',
  runtime: 'loop',
  coerce: (args) => ({
    tool: 'wait',
    ms: Number(args.ms ?? 1000),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'wait', ms: a.ms, rationale: a.rationale }),
  summarize: ({ args }) => `${args.ms}ms`,
});
