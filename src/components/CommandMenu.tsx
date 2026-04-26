import type { SlashCommand } from '../agent/commands';

interface Props {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

export function CommandMenu({ commands, selectedIndex, onSelect }: Props) {
  if (commands.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 right-0 mb-2 bg-[#1e1f22] border border-gray-600/60 rounded-lg shadow-lg overflow-hidden"
    >
      {commands.map((command, index) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(command);
          }}
          className={`w-full flex items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors ${
            index === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
          }`}
        >
          <span className="text-gray-200 font-medium">/{command.name}</span>
          <span className="text-gray-500 text-xs truncate">{command.description}</span>
        </button>
      ))}
    </div>
  );
}
