import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type Screenshot = Extract<AgentAction, { tool: 'screenshot' }>;

export const screenshotTool = defineTool<Screenshot>({
  name: 'screenshot',
  description: 'Capture the visible tab to inspect visual page state.',
  inputSchema: {
    type: 'object',
    properties: {
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'loop',
  coerce: (args) => ({ tool: 'screenshot', rationale: String(args.rationale ?? '') }),
  describe: (a) => ({ tool: 'screenshot', rationale: a.rationale }),
  summarize: () => 'capture visible tab',
});
