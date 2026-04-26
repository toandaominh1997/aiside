export interface SlashCommand {
  name: string;
  description: string;
  expand?: (arg: string) => string;
  local?: 'new' | 'help';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'summarize',
    description: 'Summarize the current page',
    expand: () => 'Summarize the current page in 5 concise bullet points.',
  },
  {
    name: 'extract',
    description: 'Pull structured data (e.g. /extract emails)',
    expand: (arg) =>
      arg
        ? `Extract ${arg} from the current page and return a clean, deduplicated list.`
        : 'Extract the key structured data from the current page (links, headings, prices, dates) as a clean list.',
  },
  {
    name: 'find',
    description: 'Find something on the page (e.g. /find pricing)',
    expand: (arg) =>
      arg
        ? `Find "${arg}" on the current page. Scroll to it and report the surrounding context.`
        : 'Find the most relevant section on the current page and report the surrounding context.',
  },
  {
    name: 'ask',
    description: 'Answer without taking browser actions',
    expand: (arg) =>
      arg
        ? `Answer based on the current page without taking any browser actions: ${arg}`
        : 'Answer based on the current page without taking any browser actions.',
  },
  {
    name: 'new',
    description: 'Start a new chat',
    local: 'new',
  },
  {
    name: 'help',
    description: 'Show available commands',
    local: 'help',
  },
];

export function shouldShowMenu(input: string): boolean {
  return input.startsWith('/') && !input.includes(' ') && !input.includes('\n');
}

export function filterCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return SLASH_COMMANDS;
  const filter = input.slice(1).toLowerCase();
  if (!filter) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => command.name.toLowerCase().startsWith(filter));
}

export interface ParsedCommand {
  command: SlashCommand;
  arg: string;
}

export function parseSlashCommand(input: string): ParsedCommand | null {
  if (!input.startsWith('/')) return null;
  const rest = input.slice(1);
  const spaceIndex = rest.search(/\s/);
  const name = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
  const arg = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1).trim();
  const command = SLASH_COMMANDS.find((entry) => entry.name === name);
  if (!command) return null;
  return { command, arg };
}

export function helpMessage(): string {
  const lines = SLASH_COMMANDS.map((command) => `- \`/${command.name}\` — ${command.description}`);
  return `**Available commands**\n\n${lines.join('\n')}`;
}
