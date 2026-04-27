import { describe, expect, it } from 'vitest';
import {
  filterCommands,
  helpMessage,
  parseSlashCommand,
  shouldShowMenu,
  SLASH_COMMANDS,
} from './commands';

describe('shouldShowMenu', () => {
  it('opens on a bare slash and while typing a name', () => {
    expect(shouldShowMenu('/')).toBe(true);
    expect(shouldShowMenu('/sum')).toBe(true);
  });

  it('hides once the user starts typing args (space) or non-slash text', () => {
    expect(shouldShowMenu('/find pricing')).toBe(false);
    expect(shouldShowMenu('hello /find')).toBe(false);
    expect(shouldShowMenu('')).toBe(false);
  });
});

describe('filterCommands', () => {
  it('returns every command for a bare slash', () => {
    expect(filterCommands('/')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('matches by prefix', () => {
    const matches = filterCommands('/su');
    expect(matches.map((command) => command.name)).toEqual(['summarize']);
  });

  it('returns empty for unknown prefixes', () => {
    expect(filterCommands('/zzz')).toEqual([]);
  });
});

describe('parseSlashCommand', () => {
  it('parses a known command without args', () => {
    const parsed = parseSlashCommand('/summarize');
    expect(parsed?.command.name).toBe('summarize');
    expect(parsed?.arg).toBe('');
  });

  it('parses a command with args', () => {
    const parsed = parseSlashCommand('/find  pricing table  ');
    expect(parsed?.command.name).toBe('find');
    expect(parsed?.arg).toBe('pricing table');
  });

  it('returns null for unknown or non-slash input', () => {
    expect(parseSlashCommand('/nope')).toBeNull();
    expect(parseSlashCommand('hello')).toBeNull();
  });
});

describe('SLASH_COMMANDS expand', () => {
  it('extract uses arg when provided', () => {
    const extract = SLASH_COMMANDS.find((command) => command.name === 'extract')!;
    expect(extract.expand!('emails')).toMatch(/Extract emails/);
    expect(extract.expand!('')).toMatch(/Extract the most useful structured data/);
  });

  it('local commands have no expand', () => {
    expect(SLASH_COMMANDS.find((command) => command.name === 'new')?.expand).toBeUndefined();
    expect(SLASH_COMMANDS.find((command) => command.name === 'help')?.local).toBe('help');
  });
});

describe('helpMessage', () => {
  it('lists every command in markdown', () => {
    const text = helpMessage();
    for (const command of SLASH_COMMANDS) {
      expect(text).toContain(`/${command.name}`);
      expect(text).toContain(command.description);
    }
  });
});
