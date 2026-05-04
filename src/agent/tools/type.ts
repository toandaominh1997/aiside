import { defineTool } from './registry';
import { optionalNumberOrString, optionalString } from './coerce';
import type { AgentAction } from '../../providers/types';

type Type = Extract<AgentAction, { tool: 'type' }>;

export const typeTool = defineTool<Type>({
  name: 'type',
  description:
    'Type text into an input or textarea by id (string data-aid or numeric id), or by an @ mention token.',
  inputSchema: {
    type: 'object',
    properties: {
      targetId: { type: ['string', 'number'] },
      target: { type: 'string', description: 'An @ mention token or mention id for a page element.' },
      value: { type: 'string', description: 'Text to type.' },
      rationale: { type: 'string' },
    },
    required: ['value', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'type',
    targetId: optionalNumberOrString(args.targetId),
    target: optionalString(args.target),
    value: String(args.value ?? ''),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({
    tool: 'type',
    targetId: a.targetId,
    target: a.target,
    value: a.value,
    rationale: a.rationale,
  }),
  toContentPayload: (a) => ({
    action: 'type',
    targetId: a.targetId,
    target: a.target,
    value: a.value,
  }),
  summarize: ({ args }) => {
    const target = args.target ? String(args.target) : `id=${args.targetId}`;
    return `${target} "${args.value}"`;
  },
});
