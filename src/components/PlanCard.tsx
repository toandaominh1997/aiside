import type { Plan } from '../providers/types';

interface Props {
  plan: Plan;
  onApprove: () => void;
  onMakeChanges: () => void;
  disabled?: boolean;
}

export function PlanCard({ plan, onApprove, onMakeChanges, disabled }: Props) {
  return (
    <div className="border border-gray-600/50 rounded-lg bg-[#2b2d31] p-4 my-3 text-gray-200">
      <div className="flex items-center gap-2 text-sm font-medium mb-3 text-gray-300">
        Aiside's plan
      </div>

      <div className="text-xs uppercase text-gray-500 mb-1">Allow actions on these sites</div>
      <ul className="mb-4 space-y-1">
        {plan.sites.map((site) => (
          <li key={site} className="flex items-center gap-2 text-sm">
            <span aria-hidden>site</span>
            <span>{site}</span>
          </li>
        ))}
      </ul>

      <div className="text-xs uppercase text-gray-500 mb-1">Approach to follow</div>
      <ol className="mb-4 space-y-1 list-decimal list-inside text-sm">
        {plan.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onApprove}
          className="w-full rounded-md bg-white text-black text-sm font-medium py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve plan
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onMakeChanges}
          className="w-full rounded-md border border-gray-600 text-sm font-medium py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Make changes
        </button>
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        Aiside will only use the sites listed. You'll be asked before accessing anything else.
      </p>
    </div>
  );
}
