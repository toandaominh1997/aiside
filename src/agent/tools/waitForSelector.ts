import { defineTool } from './registry';
import { optionalNumber } from './coerce';
import type { AgentAction } from '../../providers/types';

type WaitForSelector = Extract<AgentAction, { tool: 'wait_for_selector' }>;

export const waitForSelectorTool = defineTool<WaitForSelector>({
  name: 'wait_for_selector',
  description:
    'Wait until a CSS selector is present and visible in the page. Polls every 100 ms until found or timeoutMs elapses (default 5000). Prefer this over `wait` when a known element should appear.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector to wait for.' },
      timeoutMs: { type: 'number', description: 'Max ms to wait. Default 5000.' },
      rationale: { type: 'string' },
    },
    required: ['selector', 'rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'wait_for_selector',
    selector: String(args.selector ?? ''),
    timeoutMs: optionalNumber(args.timeoutMs),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({
    tool: 'wait_for_selector',
    selector: a.selector,
    timeoutMs: a.timeoutMs,
    rationale: a.rationale,
  }),
  toContentPayload: (a) => ({
    action: 'wait_for_selector',
    selector: a.selector,
    timeoutMs: a.timeoutMs,
  }),
  summarize: ({ args }) => String(args.selector),
});
