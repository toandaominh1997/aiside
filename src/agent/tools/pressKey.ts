import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type PressKey = Extract<AgentAction, { tool: 'press_key' }>;

export const pressKeyTool = defineTool<PressKey>({
  name: 'press_key',
  description: 'Press a single key on the focused page element or document body.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key value such as Enter, Tab, ArrowDown, Escape, or a letter.' },
      rationale: { type: 'string' },
    },
    required: ['key', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'press_key',
    key: String(args.key ?? ''),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'press_key', key: a.key, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'press_key', key: a.key }),
  summarize: ({ args }) => String(args.key),
});
