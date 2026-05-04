import { defineTool } from './registry';
import type { AgentAction } from '../../providers/types';

type GetNetworkFailures = Extract<AgentAction, { tool: 'get_network_failures' }>;

export const getNetworkFailuresTool = defineTool<GetNetworkFailures>({
  name: 'get_network_failures',
  description: 'Read network and resource failures captured by AISide.',
  inputSchema: {
    type: 'object',
    properties: {
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'content',
  coerce: (args) => ({ tool: 'get_network_failures', rationale: String(args.rationale ?? '') }),
  describe: (a) => ({ tool: 'get_network_failures', rationale: a.rationale }),
  toContentPayload: () => ({ action: 'get_network_failures' }),
  summarize: () => 'network/resource failures',
});
