import { defineTool, type ToolResult } from './registry';
import type { AgentAction } from '../../providers/types';

type TabsSwitch = Extract<AgentAction, { tool: 'tabs_switch' }>;

export const tabsSwitchTool = defineTool<TabsSwitch>({
  name: 'tabs_switch',
  description: 'Focus a specific browser tab by its numeric tab id (from tabs_list).',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab id from tabs_list.' },
      rationale: { type: 'string' },
    },
    required: ['tabId', 'rationale'],
  },
  risk: 'destructive',
  runtime: 'background',
  coerce: (args) => ({
    tool: 'tabs_switch',
    tabId: Number(args.tabId),
    rationale: String(args.rationale ?? ''),
  }),
  describe: (a) => ({ tool: 'tabs_switch', tabId: a.tabId, rationale: a.rationale }),
  runInBackground: async (action): Promise<ToolResult> => {
    if (!Number.isFinite(action.tabId)) {
      return { success: false, error: 'tabs_switch requires a numeric tabId' };
    }
    const tab = await chrome.tabs.update(action.tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    return { success: true, message: `Focused tab ${action.tabId}`, data: { url: tab?.url } };
  },
  summarize: ({ args }) => `tabId=${args.tabId}`,
});
