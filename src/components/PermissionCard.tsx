import type { AgentAction } from '../providers/types';

export interface PermissionRequest {
  id: string;
  origin: string;
  action: AgentAction;
}

export type PermissionDecision = 'once' | 'always' | 'deny';

interface Props {
  request: PermissionRequest;
  onDecide: (decision: PermissionDecision) => void;
}

function summarizeAction(action: AgentAction): string {
  switch (action.tool) {
    case 'click':
      return `Click ${action.target ?? `id=${action.targetId}`}`;
    case 'type':
      return `Type "${action.value}" into ${action.target ?? `id=${action.targetId}`}`;
    case 'navigate':
      return `Navigate to ${action.url}`;
    case 'click_at':
      return `Click at (${action.x}, ${action.y})`;
    case 'press_key':
      return `Press ${action.key}`;
    case 'hotkey':
      return `Press ${action.keys.join('+')}`;
    case 'type_text':
      return `Type "${action.value}" into focused input`;
    case 'scroll':
      return `Scroll ${action.direction}`;
    default:
      return action.tool;
  }
}

export function PermissionCard({ request, onDecide }: Props) {
  return (
    <div
      data-testid="permission-card"
      className="rounded-xl border border-yellow-700/70 bg-yellow-900/15 text-yellow-100 px-4 py-3 my-2"
    >
      <div className="text-xs uppercase tracking-wide text-yellow-300 mb-1">Confirm action</div>
      <div className="text-sm mb-2">{summarizeAction(request.action)}</div>
      <div className="font-mono text-xs text-yellow-300/80 mb-3 truncate">{request.origin}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onDecide('once')}
          className="bg-[#d97757] hover:bg-[#e88868] text-white text-xs px-3 py-1.5 rounded-md"
        >
          Allow once
        </button>
        <button
          type="button"
          onClick={() => onDecide('always')}
          className="bg-transparent hover:bg-white/5 text-yellow-100 border border-yellow-600/60 text-xs px-3 py-1.5 rounded-md"
        >
          Always on this site
        </button>
        <button
          type="button"
          onClick={() => onDecide('deny')}
          className="ml-auto bg-transparent hover:bg-white/5 text-yellow-100 text-xs px-3 py-1.5 rounded-md"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
