export interface SlashCommand {
  name: string;
  description: string;
  expand?: (arg: string) => string;
  local?: 'new' | 'help';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'summarize',
    description: 'Summarize this page for the current task',
    expand: () =>
      'Summarize the current page in the way that is most useful for AISide: identify what this page is, the important content or state visible now, key details the user may care about, and any likely next actions available on the page. Use headings or bullets as appropriate. Do not click, type, navigate, submit forms, or change page state.',
  },
  {
    name: 'extract',
    description: 'Extract structured data from this page',
    expand: (arg) =>
      arg
        ? `Extract ${arg} from the current page. Return clean, deduplicated results in a structured list or table, include nearby context when useful, and say if nothing relevant is found.`
        : 'Extract the most useful structured data from the current page, such as links, headings, prices, dates, names, emails, tables, and calls to action. Return clean, deduplicated results grouped by type.',
  },
  {
    name: 'find',
    description: 'Find text or sections and show context',
    expand: (arg) =>
      arg
        ? `Find "${arg}" on the current page. Use page search/read tools first, scroll to the best match if helpful, and report the surrounding context plus where it appears.`
        : 'Find the most relevant section on the current page for the user\'s likely task. Use page search/read tools first, scroll if helpful, and report the surrounding context plus where it appears.',
  },
  {
    name: 'ask',
    description: 'Answer from the page without acting',
    expand: (arg) =>
      arg
        ? `Answer this using only the current page context, without clicking, typing, navigating, or changing page state: ${arg}`
        : 'Answer using only the current page context. Do not click, type, navigate, submit forms, or change page state.',
  },
  {
    name: 'new',
    description: 'Clear the conversation and start fresh',
    local: 'new',
  },
  {
    name: 'help',
    description: 'Show all commands and what they do',
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
