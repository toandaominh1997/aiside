export { registry, defineTool } from './registry';
export type {
  BgCtx,
  ToolDef,
  ToolResult,
  ToolRisk,
  ToolRuntime,
  ToolSchema,
  ToolSchemaShape,
} from './registry';

import './click';
import './type';
import './navigate';
import './scroll';
import './clickAt';
import './pressKey';
import './hotkey';
import './typeText';
import './screenshot';
import './getConsoleErrors';
import './getNetworkFailures';
import './wait';
import './observe';
import './readPage';
import './findInPage';
import './remember';
import './recall';
import './finish';
import './tabsList';
import './tabsOpen';
import './tabsSwitch';
import './fetchUrl';
import './waitForSelector';
import './waitForUrl';
import './extractTable';
import './fillForm';
