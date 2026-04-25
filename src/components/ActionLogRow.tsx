import { useState } from 'react';
import type { ActionLogEntry } from '../agent/loop';

interface Props {
  entry: ActionLogEntry;
}

export function ActionLogRow({ entry }: Props) {
  const [open, setOpen] = useState(false);
  const icon = entry.ok ? 'OK' : 'ERR';
  const color = entry.ok ? 'text-green-400' : 'text-red-400';

  return (
    <div className="text-xs my-1 border-l-2 border-gray-700 pl-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2 text-left hover:bg-white/5 rounded px-1 py-0.5"
      >
        <span className={`${color} font-mono`}>{icon}</span>
        <span className="font-medium uppercase text-gray-400">{entry.tool}</span>
        <span className="text-gray-500 truncate flex-1">{summarize(entry)}</span>
        <span className="text-gray-600">{open ? 'open' : 'closed'}</span>
      </button>
      {open && (
        <div className="px-2 py-1 text-gray-400 space-y-1">
          <div>
            <span className="text-gray-500">message:</span> {entry.message}
          </div>
          {entry.rationale && (
            <div>
              <span className="text-gray-500">why:</span> {entry.rationale}
            </div>
          )}
          <div>
            <span className="text-gray-500">args:</span> <code>{JSON.stringify(entry.args)}</code>
          </div>
          <div>
            <span className="text-gray-500">duration:</span> {entry.durationMs}ms
          </div>
        </div>
      )}
    </div>
  );
}

function summarize(entry: ActionLogEntry): string {
  switch (entry.tool) {
    case 'click':
      return `id=${entry.args.targetId}`;
    case 'type':
      return `id=${entry.args.targetId} "${entry.args.value}"`;
    case 'navigate':
      return String(entry.args.url);
    case 'scroll':
      return String(entry.args.direction);
    case 'finish':
      return entry.message;
  }
}
