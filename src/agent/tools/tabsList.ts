import { defineTool, type ToolResult } from './registry';
import type { AgentAction } from '../../providers/types';

type TabsList = Extract<AgentAction, { tool: 'tabs_list' }>;

export const tabsListTool = defineTool<TabsList>({
  name: 'tabs_list',
  description:
    "List the user's open tabs across all windows. Returns tab id, url, title, windowId, and active flag. Use to discover other open pages before opening or switching.",
  inputSchema: {
    type: 'object',
    properties: {
      rationale: { type: 'string' },
    },
    required: ['rationale'],
  },
  risk: 'safe',
  runtime: 'background',
  coerce: (args) => ({ tool: 'tabs_list', rationale: String(args.rationale ?? '') }),
  describe: (a) => ({ tool: 'tabs_list', rationale: a.rationale }),
  runInBackground: async (): Promise<ToolResult> => {
    const tabs = await chrome.tabs.query({});
    const data = tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      windowId: t.windowId,
      active: t.active,
    }));
    return { success: true, message: `${data.length} tab(s)`, data: { tabs: data } };
  },
  summarize: () => 'list open tabs',
});
