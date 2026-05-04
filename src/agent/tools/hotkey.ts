import { defineTool } from './registry';
import { stringArray } from './coerce';
import type { AgentAction } from '../../providers/types';

type Hotkey = Extract<AgentAction, { tool: 'hotkey' }>;

export const hotkeyTool = defineTool<Hotkey>({
  name: 'hotkey',
  description: 'Press a keyboard shortcut on the focused page element, such as Meta+K or Control+L.',
  inputSchema: {
    type: 'object',
    properties: {
      keys: { type: 'array', items: { type: 'string' }, description: 'Keys in the combo, e.g. ["Meta", "K"].' },
      rationale: { type: 'string' },
    },
    required: ['keys', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'hotkey',
    keys: stringArray(args.keys),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'hotkey', keys: a.keys, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'hotkey', keys: a.keys }),
  summarize: ({ args }) => (Array.isArray(args.keys) ? (args.keys as string[]).join('+') : ''),
});
