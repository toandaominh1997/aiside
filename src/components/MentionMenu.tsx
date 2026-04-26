import type { Mention, MentionKind } from '../agent/mentions';

interface Props {
  items: Mention[];
  selectedIndex: number;
  onSelect: (mention: Mention) => void;
}

const KIND_LABEL: Record<MentionKind, string> = {
  selection: 'sel',
  heading: 'h',
  button: 'btn',
  link: 'link',
  input: 'input',
  image: 'img',
  table: 'table',
  form: 'form',
  section: 'sec',
  landmark: 'land',
  element: 'el',
};

const KIND_COLOR: Record<MentionKind, string> = {
  selection: 'bg-amber-500/30 text-amber-300',
  heading: 'bg-violet-500/25 text-violet-300',
  button: 'bg-orange-500/25 text-orange-300',
  link: 'bg-sky-500/25 text-sky-300',
  input: 'bg-emerald-500/25 text-emerald-300',
  image: 'bg-pink-500/25 text-pink-300',
  table: 'bg-yellow-500/25 text-yellow-300',
  form: 'bg-cyan-500/25 text-cyan-300',
  section: 'bg-indigo-500/25 text-indigo-300',
  landmark: 'bg-fuchsia-500/25 text-fuchsia-300',
  element: 'bg-gray-500/25 text-gray-300',
};

export function MentionMenu({ items, selectedIndex, onSelect }: Props) {
  return (
    <div
      role="listbox"
      aria-label="Page mentions"
      className="absolute bottom-full left-0 right-0 mb-2 bg-[#1e1f22] border border-gray-600/60 rounded-lg shadow-lg max-h-64 overflow-y-auto"
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-gray-500 text-sm">No matches on this page</div>
      ) : (
        items.map((mention, index) => (
          <button
            key={mention.id}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(mention);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
              index === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
            }`}
          >
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${KIND_COLOR[mention.kind]}`}
            >
              {KIND_LABEL[mention.kind]}
            </span>
            <span className="text-gray-200 truncate flex-1">{mention.label}</span>
            <span className="shrink-0 text-gray-500 text-[11px] font-mono truncate max-w-[40%]">
              {mention.token}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
