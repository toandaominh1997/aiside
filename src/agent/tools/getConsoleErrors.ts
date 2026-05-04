import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type GetConsoleErrors = Extract<AgentAction, { tool: 'get_console_errors' }>;

export const getConsoleErrorsTool = defineTool<GetConsoleErrors>({
  name: 'get_console_errors',
  description: 'Read console errors and unhandled page errors captured by AISide.',
  inputSchema: {
    type: 'object',
    properties: {
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({ tool: 'get_console_errors', rationale: String(args.rationale ?? '') }),
  describe: (a) => ({ tool: 'get_console_errors', rationale: a.rationale }),
  toContentPayload: () => ({ action: 'get_console_errors' }),
  summarize: () => 'console errors',
});
