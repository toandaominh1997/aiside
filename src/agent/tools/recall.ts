import { defineTool } from './registry';
import { optionalString } from './coerce';
import type { AgentAction } from '../../providers/types';

type Recall = Extract<AgentAction, { tool: 'recall' }>;

export const recallTool = defineTool<Recall>({
  name: 'recall',
  description: 'Recall one page-local fact by key, or all page-local memory when key is omitted.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Optional memory key.' },
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'recall',
    key: optionalString(args.key),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'recall', key: a.key, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'recall', key: a.key }),
  summarize: ({ args }) => (args.key ? String(args.key) : 'all memory'),
});
