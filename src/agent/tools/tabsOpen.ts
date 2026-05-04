import { defineTool, type ToolResult } from './registry';
import type { AgentAction } from '../../providers/types';

type TabsOpen = Extract<AgentAction, { tool: 'tabs_open' }>;

export const tabsOpenTool = defineTool<TabsOpen>({
  name: 'tabs_open',
  description:
    "Open a new browser tab at the given URL. Use active=false (default) to open in the background without yanking the user's focus.",
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute URL to open.' },
      active: {
        type: 'boolean',
        description: 'Whether the new tab should become focused. Default false.',
      },
      rationale: { type: 'string' },
    },
    required: ['url', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'background',
  coerce: (args) => ({
    tool: 'tabs_open',
    url: String(args.url ?? ''),
    active: args.active === true,
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'tabs_open', url: a.url, active: a.active, rationale: a.rationale }),
  runInBackground: async (action): Promise<ToolResult> => {
    if (!action.url) return { success: false, error: 'tabs_open requires a non-empty url' };
    const tab = await chrome.tabs.create({ url: action.url, active: action.active === true });
    return {
      success: true,
      message: `Opened ${action.url}${action.active ? '' : ' (background)'}`,
      data: { tabId: tab.id, windowId: tab.windowId },
    };
  },
  summarize: ({ args }) => String(args.url),
});
