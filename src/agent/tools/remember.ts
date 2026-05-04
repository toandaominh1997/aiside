import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Remember = Extract<AgentAction, { tool: 'remember' }>;

export const rememberTool = defineTool<Remember>({
  name: 'remember',
  description: 'Store a short page-local fact for this agent run.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Short stable memory key.' },
      value: { type: 'string', description: 'Short fact to remember.' },
      rationale: { type: 'string' },
    },
    required: ['key', 'value', 'rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'remember',
    key: String(args.key ?? ''),
    value: String(args.value ?? ''),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'remember', key: a.key, value: a.value, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'remember', key: a.key, value: a.value }),
  summarize: ({ args }) => String(args.key),
});
