import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type TypeText = Extract<AgentAction, { tool: 'type_text' }>;

export const typeTextTool = defineTool<TypeText>({
  name: 'type_text',
  description: 'Type text into the currently focused input, textarea, or contenteditable element.',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'Text to type.' },
      rationale: { type: 'string' },
    },
    required: ['value', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'type_text',
    value: String(args.value ?? ''),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'type_text', value: a.value, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'type_text', value: a.value }),
  summarize: ({ args }) => `"${args.value}"`,
});
