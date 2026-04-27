import { useEffect, useRef } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { Plan } from '../providers/types';

interface Props {
  plan: Plan;
  modelLabel: string;
  onApprove: () => void;
  onMakeChanges: () => void;
  disabled?: boolean;
}

export function PlanCard({ plan, modelLabel, onApprove, onMakeChanges, disabled }: Props) {
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    approveRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      const isMod = event.metaKey || event.ctrlKey;
      event.preventDefault();
      if (isMod) onMakeChanges();
      else onApprove();
    }
  }

  return (
    <div
      className="rounded-xl border border-gray-600/60 bg-[#1e1f22] text-gray-200 px-4 py-3 my-2"
      data-testid="plan-card"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">{modelLabel}'s plan</span>
      </div>

      <p className="text-[15px] text-gray-100 mb-3">{plan.summary}</p>

      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Allow actions on these sites</div>
        <ul className="space-y-1">
          {plan.sites.map((site) => (
            <li key={site} className="font-mono text-sm text-sky-300 truncate">
              {site}
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Approach to follow</div>
        <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-200">
          {plan.steps.map((step, i) => (
            <li key={`${i}-${step.slice(0, 20)}`}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="flex items-center gap-2">
        <button
          ref={approveRef}
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className="flex items-center gap-1.5 bg-[#d97757] hover:bg-[#e88868] active:bg-[#c76647] disabled:bg-gray-600 text-white text-sm px-3 py-1.5 rounded-md transition-colors"
        >
          <Check size={14} /> Approve plan
        </button>
        <button
          type="button"
          onClick={onMakeChanges}
          disabled={disabled}
          className="flex items-center gap-1.5 bg-transparent hover:bg-white/5 text-gray-300 text-sm px-3 py-1.5 rounded-md border border-gray-600/60"
        >
          <Pencil size={14} /> Make changes
        </button>
        <span className="text-[11px] text-gray-500 ml-2">Enter to approve · ⌘+Enter to edit</span>
      </div>
    </div>
  );
}
