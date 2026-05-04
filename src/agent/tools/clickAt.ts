import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type ClickAt = Extract<AgentAction, { tool: 'click_at' }>;

export const clickAtTool = defineTool<ClickAt>({
  name: 'click_at',
  description:
    'Click viewport/client coordinates from the visible tab screenshot using document.elementFromPoint.',
  inputSchema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Viewport x coordinate in CSS pixels.' },
      y: { type: 'number', description: 'Viewport y coordinate in CSS pixels.' },
      rationale: { type: 'string' },
    },
    required: ['x', 'y', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'click_at',
    x: Number(args.x),
    y: Number(args.y),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'click_at', x: a.x, y: a.y, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'click_at', x: a.x, y: a.y }),
  summarize: ({ args }) => `(${args.x}, ${args.y})`,
});
