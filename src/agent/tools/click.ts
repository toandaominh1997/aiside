import { defineTool } from './registry';
import { optionalNumberOrString, optionalString } from './coerce';
import type { AgentAction } from '../../providers/types';

type Click = Extract<AgentAction, { tool: 'click' }>;

export const clickTool = defineTool<Click>({
  name: 'click',
  description:
    'Click an interactive element by id (string data-aid or numeric id from the simplified DOM), or by an @ mention token from the user.',
  inputSchema: {
    type: 'object',
    properties: {
      targetId: {
        type: ['string', 'number'],
        description: 'The data-aid string or numeric id of the element.',
      },
      target: { type: 'string', description: 'An @ mention token or mention id for a page element.' },
      rationale: { type: 'string', description: 'Why this click is the right next step.' },
    },
    required: ['rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'click',
    targetId: optionalNumberOrString(args.targetId),
    target: optionalString(args.target),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'click', targetId: a.targetId, target: a.target, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'click', targetId: a.targetId, target: a.target }),
  summarize: ({ args }) => (args.target ? String(args.target) : `id=${args.targetId}`),
});
