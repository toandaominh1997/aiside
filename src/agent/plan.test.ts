import { describe, expect, it } from 'vitest';
import { PlanValidationError, normalizeOrigin, validatePlan } from './plan';

describe('agent/plan', () => {
  describe('normalizeOrigin', () => {
    it('lowercases host and keeps scheme', () => {
      expect(normalizeOrigin('HTTPS://Example.COM/path?q=1')).toBe('https://example.com');
    });

    it('preserves non-default port', () => {
      expect(normalizeOrigin('http://localhost:8080/x')).toBe('http://localhost:8080');
    });

    it('rejects non-http(s) schemes', () => {
      expect(() => normalizeOrigin('chrome://settings')).toThrow();
      expect(() => normalizeOrigin('file:///etc/passwd')).toThrow();
    });

    it('rejects garbage', () => {
      expect(() => normalizeOrigin('not a url')).toThrow();
    });
  });

  describe('validatePlan', () => {
    const ok = {
      summary: 'do the thing',
      steps: ['a', 'b'],
      sites: ['https://example.com'],
    };

    it('accepts a well-formed plan and normalizes origins', () => {
      const plan = validatePlan({
        summary: 'do',
        steps: ['a'],
        sites: ['HTTPS://Example.com/page'],
      });
      expect(plan.sites).toEqual(['https://example.com']);
    });

    it('rejects empty summary', () => {
      expect(() => validatePlan({ ...ok, summary: '' })).toThrow(PlanValidationError);
    });

    it('rejects oversize summary', () => {
      expect(() => validatePlan({ ...ok, summary: 'x'.repeat(201) })).toThrow(PlanValidationError);
    });

    it('rejects 0 steps', () => {
      expect(() => validatePlan({ ...ok, steps: [] })).toThrow(PlanValidationError);
    });

    it('rejects 11 steps', () => {
      expect(() => validatePlan({ ...ok, steps: Array(11).fill('s') })).toThrow(
        PlanValidationError,
      );
    });

    it('rejects 0 sites', () => {
      expect(() => validatePlan({ ...ok, sites: [] })).toThrow(PlanValidationError);
    });

    it('rejects 6 sites', () => {
      expect(() => validatePlan({ ...ok, sites: Array(6).fill('https://example.com') })).toThrow(
        PlanValidationError,
      );
    });

    it('rejects non-http site', () => {
      expect(() => validatePlan({ ...ok, sites: ['chrome://settings'] })).toThrow(
        PlanValidationError,
      );
    });

    it('rejects missing fields', () => {
      expect(() => validatePlan({ summary: 'x', steps: ['s'] })).toThrow(PlanValidationError);
    });
  });
});
