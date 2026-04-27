import { describe, expect, it } from 'vitest';
import { PROPOSE_PLAN_SCHEMA, TOOL_SCHEMAS } from './toolSchemas';

describe('toolSchemas', () => {
  it('exposes the browser action tools by name', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name).sort();
    expect(names).toEqual([
      'click',
      'click_at',
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
      'type',
      'type_text',
      'wait',
    ]);
  });

  it('every action tool has a description and input_schema with type=object', () => {
    for (const t of TOOL_SCHEMAS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.properties).toBeTypeOf('object');
    }
  });

  it('click supports numeric ids and mention targets', () => {
    const click = TOOL_SCHEMAS.find((t) => t.name === 'click');
    expect(click?.input_schema.properties).toHaveProperty('targetId');
    expect(click?.input_schema.properties).toHaveProperty('target');
    expect(click?.input_schema.required).toEqual(['rationale']);
  });

  it('type supports numeric ids and mention targets', () => {
    const type = TOOL_SCHEMAS.find((t) => t.name === 'type');
    expect(type?.input_schema.properties).toHaveProperty('targetId');
    expect(type?.input_schema.properties).toHaveProperty('target');
    expect(type?.input_schema.required).toEqual(['value', 'rationale']);
  });

  it('visual and keyboard tools require their action fields and rationale', () => {
    expect(TOOL_SCHEMAS.find((t) => t.name === 'click_at')?.input_schema.required).toEqual([
      'x',
      'y',
      'rationale',
    ]);
    expect(TOOL_SCHEMAS.find((t) => t.name === 'press_key')?.input_schema.required).toEqual([
      'key',
      'rationale',
    ]);
    expect(TOOL_SCHEMAS.find((t) => t.name === 'hotkey')?.input_schema.required).toEqual([
      'keys',
      'rationale',
    ]);
    expect(TOOL_SCHEMAS.find((t) => t.name === 'type_text')?.input_schema.required).toEqual([
      'value',
      'rationale',
    ]);
  });

  it('wait requires milliseconds and rationale', () => {
    const wait = TOOL_SCHEMAS.find((t) => t.name === 'wait');
    expect(wait?.input_schema.required).toEqual(['ms', 'rationale']);
  });

  it('remember requires key, value, rationale', () => {
    const remember = TOOL_SCHEMAS.find((t) => t.name === 'remember');
    expect(remember?.input_schema.required).toEqual(['key', 'value', 'rationale']);
  });

  it('recall only requires rationale and has optional key', () => {
    const recall = TOOL_SCHEMAS.find((t) => t.name === 'recall');
    expect(recall?.input_schema.properties).toHaveProperty('key');
    expect(recall?.input_schema.required).toEqual(['rationale']);
  });

  it('propose_plan requires summary, steps, sites', () => {
    expect(PROPOSE_PLAN_SCHEMA.name).toBe('propose_plan');
    expect(PROPOSE_PLAN_SCHEMA.input_schema.required).toEqual(
      expect.arrayContaining(['summary', 'steps', 'sites']),
    );
  });
});
