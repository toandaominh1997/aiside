import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type ReadPage = Extract<AgentAction, { tool: 'read_page' }>;

export const readPageTool = defineTool<ReadPage>({
  name: 'read_page',
  description:
    'Read the current page as cleaned-up Markdown (Readability-style). Use to understand article content before acting.',
  inputSchema: {
    type: 'object',
    properties: {
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({ tool: 'read_page', rationale: String(args.rationale ?? '') }),
  describe: (a) => ({ tool: 'read_page', rationale: a.rationale }),
  toContentPayload: () => ({ action: 'read_page' }),
  summarize: () => 'read article',
});
