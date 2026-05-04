import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Finish = Extract<AgentAction, { tool: 'finish' }>;

export const finishTool = defineTool<Finish>({
  name: 'finish',
  description: 'Signal the task is complete. Provide the user-facing summary.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Final answer or summary for the user.' },
    },
    required: ['summary'],
  },
  risk: 'safe',
  runtime: 'loop',
  coerce: (args) => ({ tool: 'finish', summary: String(args.summary ?? '') }),
  describe: (a) => ({ tool: 'finish', summary: a.summary }),
  summarize: ({ message }) => message,
});
