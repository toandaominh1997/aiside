import { defineTool } from './registry';
import type { AgentAction, FillFormField } from '../../providers/types';

type FillForm = Extract<AgentAction, { tool: 'fill_form' }>;

function coerceFields(value: unknown): FillFormField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const selector = typeof record.selector === 'string' ? record.selector : '';
      const v = record.value;
      const stringValue = typeof v === 'string' ? v : v == null ? '' : String(v);
      if (!selector) return null;
      return { selector, value: stringValue };
    })
    .filter((field): field is FillFormField => field !== null);
}

export const fillFormTool = defineTool<FillForm>({
  name: 'fill_form',
  description:
    'Fill multiple input/textarea fields in one call. Pass an array of {selector, value}; each match has its value set and an input event dispatched. Skips fields whose selectors do not resolve.',
  inputSchema: {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['selector', 'value'],
        },
        description: 'Fields to fill in order.',
      },
      rationale: { type: 'string' },
    },
    required: ['fields', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'fill_form',
    fields: coerceFields(args.fields),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'fill_form', fields: a.fields, rationale: a.rationale }),
  toContentPayload: (a) => ({ action: 'fill_form', fields: a.fields }),
  summarize: ({ args }) => {
    const fields = Array.isArray(args.fields) ? (args.fields as FillFormField[]) : [];
    return `${fields.length} field${fields.length === 1 ? '' : 's'}`;
  },
});
