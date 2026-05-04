import { describe, expect, it } from 'vitest';
import { registry } from './index';

describe('tool registry', () => {
  it('registers all 26 browser action tools', () => {
    const names = registry.list().map((t) => t.name).sort();
    expect(names).toEqual([
      'click',
      'click_at',
      'extract_table',
      'fetch_url',
      'fill_form',
      'find_in_page',
      'finish',
      'get_console_errors',
      'get_network_failures',
      'hotkey',
      'navigate',
      'observe',
      'press_key',
      'read_page',
      'recall',
      'remember',
      'screenshot',
      'scroll',
      'tabs_list',
      'tabs_open',
      'tabs_switch',
      'type',
      'type_text',
      'wait',
      'wait_for_selector',
      'wait_for_url',
    ]);
  });

  it('exposes JSON schemas for every tool', () => {
    for (const schema of registry.schemas()) {
      expect(typeof schema.description).toBe('string');
      expect(schema.description.length).toBeGreaterThan(0);
      expect(schema.input_schema.type).toBe('object');
      expect(schema.input_schema.properties).toBeTypeOf('object');
    }
  });

  it('classifies destructive tools the same way the loop did', () => {
    expect(registry.byRisk('destructive')).toEqual(
      new Set([
        'click',
        'type',
        'click_at',
        'press_key',
        'hotkey',
        'type_text',
        'navigate',
        'tabs_open',
        'tabs_switch',
        'fetch_url',
        'fill_form',
      ]),
    );
  });

  it('coerces a click action with mention target', () => {
    const click = registry.getOrThrow('click');
    expect(click.coerce({ target: '@button-submit-0', rationale: 'r' })).toEqual({
      tool: 'click',
      targetId: undefined,
      target: '@button-submit-0',
      rationale: 'r',
    });
  });

  it('throws on unknown tool name', () => {
    expect(() => registry.getOrThrow('nope')).toThrow(/Unknown tool/);
  });

  it('routes runtimes correctly', () => {
    const loopOnly = registry.byRuntime('loop').map((t) => t.name).sort();
    expect(loopOnly).toEqual(['finish', 'navigate', 'screenshot', 'wait']);
    const contentOnly = registry.byRuntime('content').map((t) => t.name).sort();
    expect(contentOnly).toEqual([
      'click',
      'click_at',
      'extract_table',
      'fill_form',
      'find_in_page',
      'get_console_errors',
      'get_network_failures',
      'hotkey',
      'observe',
      'press_key',
      'read_page',
      'recall',
      'remember',
      'scroll',
      'type',
      'type_text',
      'wait_for_selector',
      'wait_for_url',
    ]);
    const backgroundOnly = registry.byRuntime('background').map((t) => t.name).sort();
    expect(backgroundOnly).toEqual(['fetch_url', 'tabs_list', 'tabs_open', 'tabs_switch']);
  });

  it('toContentPayload returns the same shape App.tsx used to produce', () => {
    const click = registry.getOrThrow('click');
    expect(click.toContentPayload?.({ tool: 'click', targetId: 3, target: undefined, rationale: 'r' })).toEqual({
      action: 'click',
      targetId: 3,
      target: undefined,
    });
    const navigate = registry.getOrThrow('navigate');
    expect(navigate.toContentPayload?.({ tool: 'navigate', url: 'https://x.com', rationale: 'r' })).toEqual({
      action: 'navigate',
      value: 'https://x.com',
    });
  });

  it('summarize matches the legacy ActionLogRow summary for typical entries', () => {
    expect(
      registry.getOrThrow('click').summarize({ args: { target: '@a-1' }, message: '' }),
    ).toBe('@a-1');
    expect(
      registry.getOrThrow('click').summarize({ args: { targetId: 3 }, message: '' }),
    ).toBe('id=3');
    expect(
      registry.getOrThrow('hotkey').summarize({ args: { keys: ['Meta', 'K'] }, message: '' }),
    ).toBe('Meta+K');
    expect(
      registry.getOrThrow('finish').summarize({ args: {}, message: 'all done' }),
    ).toBe('all done');
  });
});
