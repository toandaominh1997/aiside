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

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'click',
    description: 'Click an interactive element by its numeric id from the simplified DOM.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: 'number', description: 'The numeric id of the element.' },
        rationale: { type: 'string', description: 'Why this click is the right next step.' },
      },
      required: ['targetId', 'rationale'],
    },
  },
  {
    name: 'type',
    description: 'Type text into an input or textarea element by id.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: 'number' },
        value: { type: 'string', description: 'Text to type.' },
        rationale: { type: 'string' },
      },
      required: ['targetId', 'value', 'rationale'],
    },
  },
  {
    name: 'navigate',
    description: 'Navigate the agent tab to a new URL. Must be on the approved site allowlist.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL or path resolved against the current page.' },
        rationale: { type: 'string' },
      },
      required: ['url', 'rationale'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page up or down by roughly one viewport.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up'] },
        rationale: { type: 'string' },
      },
      required: ['direction', 'rationale'],
    },
  },
  {
    name: 'finish',
    description: 'Signal the task is complete. Provide the user-facing summary.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Final answer or summary for the user.' },
      },
      required: ['summary'],
    },
  },
];
