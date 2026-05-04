import { defineTool } from './registry';
import { optionalNumber } from './coerce';
import type { AgentAction } from '../../providers/types';

type FindInPage = Extract<AgentAction, { tool: 'find_in_page' }>;

export const findInPageTool = defineTool<FindInPage>({
  name: 'find_in_page',
  description:
    'Search the current page for a substring. Returns up to `limit` matches with surrounding context and scrolls the first match into view.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Substring to search for.' },
      limit: { type: 'number', description: 'Max number of matches to return. Default 5.' },
      rationale: { type: 'string' },
    },
    required: ['query', 'rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'find_in_page',
    query: String(args.query ?? ''),
    limit: optionalNumber(args.limit),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({
    tool: 'find_in_page',
    query: a.query,
    limit: a.limit,
    rationale: a.rationale,
  }),
  toContentPayload: (a) => ({ action: 'find_in_page', query: a.query, limit: a.limit }),
  summarize: ({ args }) => `"${args.query}"`,
});
