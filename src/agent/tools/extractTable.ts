import { defineTool } from './registry';
import { optionalString } from './coerce';
import type { AgentAction } from '../../providers/types';

type ExtractTable = Extract<AgentAction, { tool: 'extract_table' }>;

export const extractTableTool = defineTool<ExtractTable>({
  name: 'extract_table',
  description:
    'Extract a <table> element on the page as JSON rows. Pass an optional CSS selector to pick a specific table; otherwise the first visible table is used.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'Optional CSS selector for the table.' },
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'extract_table',
    selector: optionalString(args.selector),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'extract_table', selector: a.selector, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'extract_table', selector: a.selector }),
  summarize: ({ args }) => (args.selector ? String(args.selector) : 'first visible table'),
});
