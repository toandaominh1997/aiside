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
    description:
      'Click an interactive element by id (string data-aid or numeric id from the simplified DOM), or by an @ mention token from the user.',
    input_schema: {
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
  },
  {
    name: 'type',
    description: 'Type text into an input or textarea by id (string data-aid or numeric id), or by an @ mention token.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: ['string', 'number'] },
        target: { type: 'string', description: 'An @ mention token or mention id for a page element.' },
        value: { type: 'string', description: 'Text to type.' },
        rationale: { type: 'string' },
      },
      required: ['value', 'rationale'],
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
    name: 'click_at',
    description: 'Click viewport/client coordinates from the visible tab screenshot using document.elementFromPoint.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Viewport x coordinate in CSS pixels.' },
        y: { type: 'number', description: 'Viewport y coordinate in CSS pixels.' },
        rationale: { type: 'string' },
      },
      required: ['x', 'y', 'rationale'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a single key on the focused page element or document body.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key value such as Enter, Tab, ArrowDown, Escape, or a letter.' },
        rationale: { type: 'string' },
      },
      required: ['key', 'rationale'],
    },
  },
  {
    name: 'hotkey',
    description: 'Press a keyboard shortcut on the focused page element, such as Meta+K or Control+L.',
    input_schema: {
      type: 'object',
      properties: {
        keys: { type: 'array', items: { type: 'string' }, description: 'Keys in the combo, e.g. ["Meta", "K"].' },
        rationale: { type: 'string' },
      },
      required: ['keys', 'rationale'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into the currently focused input, textarea, or contenteditable element.',
    input_schema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Text to type.' },
        rationale: { type: 'string' },
      },
      required: ['value', 'rationale'],
    },
  },
  {
    name: 'screenshot',
    description: 'Capture the visible tab to inspect visual page state.',
    input_schema: {
      type: 'object',
      properties: {
        rationale: { type: 'string' },
      },
      required: ['rationale'],
    },
  },
  {
    name: 'get_console_errors',
    description: 'Read console errors and unhandled page errors captured by AISide.',
    input_schema: {
      type: 'object',
      properties: {
        rationale: { type: 'string' },
      },
      required: ['rationale'],
    },
  },
  {
    name: 'get_network_failures',
    description: 'Read network and resource failures captured by AISide.',
    input_schema: {
      type: 'object',
      properties: {
        rationale: { type: 'string' },
      },
      required: ['rationale'],
    },
  },
  {
    name: 'wait',
    description: 'Wait briefly for async page changes. Use 100-10000 milliseconds.',
    input_schema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait, clamped to 100-10000.' },
        rationale: { type: 'string' },
      },
      required: ['ms', 'rationale'],
    },
  },
  {
    name: 'observe',
    description: 'Observe the current page URL, title, DOM, diagnostics, and page memory.',
    input_schema: {
      type: 'object',
      properties: {
        rationale: { type: 'string' },
      },
      required: ['rationale'],
    },
  },
  {
    name: 'remember',
    description: 'Store a short page-local fact for this agent run.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short stable memory key.' },
        value: { type: 'string', description: 'Short fact to remember.' },
        rationale: { type: 'string' },
      },
      required: ['key', 'value', 'rationale'],
    },
  },
  {
    name: 'recall',
    description: 'Recall one page-local fact by key, or all page-local memory when key is omitted.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Optional memory key.' },
        rationale: { type: 'string' },
      },
      required: ['rationale'],
    },
  },
  {
    name: 'read_page',
    description:
      'Read the current page as cleaned-up Markdown (Readability-style). Use to understand article content before acting.',
    input_schema: {
      type: 'object',
      properties: {
        rationale: { type: 'string' },
      },
      required: ['rationale'],
    },
  },
  {
    name: 'find_in_page',
    description:
      'Search the current page for a substring. Returns up to `limit` matches with surrounding context and scrolls the first match into view.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to search for.' },
        limit: { type: 'number', description: 'Max number of matches to return. Default 5.' },
        rationale: { type: 'string' },
      },
      required: ['query', 'rationale'],
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
