import { registry } from '../agent/tools';

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const PROPOSE_PLAN_SCHEMA: ToolSchema = {
  name: 'propose_plan',
  description:
    'Propose a plan for the user to approve before any browser actions are taken. Include the sites you need permission to act on and a numbered list of steps.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One-line description of the overall goal (max 200 chars).',
      },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: '1-10 ordered steps describing the approach.',
      },
      sites: {
        type: 'array',
        items: { type: 'string' },
        description: '1-5 origins (https://host) the agent needs to act on.',
      },
    },
    required: ['summary', 'steps', 'sites'],
  },
};

export const TOOL_SCHEMAS: ToolSchema[] = registry.schemas();
