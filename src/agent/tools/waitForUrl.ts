import { defineTool } from './registry';
import { optionalNumber } from './coerce';
import type { AgentAction } from '../../providers/types';

type WaitForUrl = Extract<AgentAction, { tool: 'wait_for_url' }>;

export const waitForUrlTool = defineTool<WaitForUrl>({
  name: 'wait_for_url',
  description:
    'Wait until window.location.href matches a substring or regex pattern. Polls every 100 ms until match or timeoutMs elapses (default 5000). Use after a click that triggers navigation.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Substring or /regex/ to match against window.location.href.' },
      timeoutMs: { type: 'number', description: 'Max ms to wait. Default 5000.' },
      rationale: { type: 'string' },
    },
    required: ['pattern', 'rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({
    tool: 'wait_for_url',
    pattern: String(args.pattern ?? ''),
    timeoutMs: optionalNumber(args.timeoutMs),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({
    tool: 'wait_for_url',
    pattern: a.pattern,
    timeoutMs: a.timeoutMs,
    rationale: a.rationale,
  }),
  toContentPayload: (a) => ({
    action: 'wait_for_url',
    pattern: a.pattern,
    timeoutMs: a.timeoutMs,
  }),
  summarize: ({ args }) => String(args.pattern),
});
