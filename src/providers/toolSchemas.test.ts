import { describe, expect, it } from 'vitest';
import { PROPOSE_PLAN_SCHEMA, TOOL_SCHEMAS } from './toolSchemas';

describe('toolSchemas', () => {
  it('exposes the five action tools by name', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name).sort();
    expect(names).toEqual(['click', 'finish', 'navigate', 'scroll', 'type']);
  });

  it('every action tool has a description and input_schema with type=object', () => {
    for (const t of TOOL_SCHEMAS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.properties).toBeTypeOf('object');
    }
  });

  it('click requires targetId and rationale', () => {
    const click = TOOL_SCHEMAS.find((t) => t.name === 'click');
    expect(click?.input_schema.required).toEqual(expect.arrayContaining(['targetId', 'rationale']));
  });

  it('type requires targetId, value, rationale', () => {
    const type = TOOL_SCHEMAS.find((t) => t.name === 'type');
    expect(type?.input_schema.required).toEqual(
      expect.arrayContaining(['targetId', 'value', 'rationale']),
    );
  });

  it('propose_plan requires summary, steps, sites', () => {
    expect(PROPOSE_PLAN_SCHEMA.name).toBe('propose_plan');
    expect(PROPOSE_PLAN_SCHEMA.input_schema.required).toEqual(
      expect.arrayContaining(['summary', 'steps', 'sites']),
    );
  });
});
