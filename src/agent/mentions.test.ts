import { describe, expect, it } from 'vitest';
import {
  findActiveTrigger,
  formatContextBlock,
  rankMentions,
  resolveMentions,
  type Mention,
} from './mentions';

const mention = (overrides: Partial<Mention> = {}): Mention => ({
  id: 'button-submit-0',
  kind: 'button',
  label: 'Button: Submit',
  token: '@button-submit-0',
  tag: 'button',
  text: 'Submit',
  attrs: {},
  selector: 'form > button:nth-of-type(1)',
  bbox: { x: 0, y: 0, w: 80, h: 32 },
  ...overrides,
});

describe('findActiveTrigger', () => {
  it('detects trigger at start of input', () => {
    expect(findActiveTrigger('@but', 4)).toEqual({ start: 0, end: 4, query: 'but' });
  });

  it('detects trigger after whitespace', () => {
    expect(findActiveTrigger('hello @he', 9)).toEqual({ start: 6, end: 9, query: 'he' });
  });

  it('returns null when @ is mid-word', () => {
    expect(findActiveTrigger('user@email', 10)).toBeNull();
  });

  it('returns null when whitespace appears after @', () => {
    expect(findActiveTrigger('@hi there', 9)).toBeNull();
  });

  it('returns null when caret is before any @', () => {
    expect(findActiveTrigger('plain text', 4)).toBeNull();
  });
});

describe('rankMentions', () => {
  const items: Mention[] = [
    mention({ id: 'heading-pricing-0', kind: 'heading', label: 'Heading: Pricing', token: '@heading-pricing-0', text: 'Pricing' }),
    mention({ id: 'button-submit-0', kind: 'button', label: 'Button: Submit', token: '@button-submit-0', text: 'Submit' }),
    mention({ id: 'link-docs-0', kind: 'link', label: 'Link: Docs', token: '@link-docs-0', text: 'Docs' }),
    mention({ id: 'selection-current', kind: 'selection', label: 'Selected text: hi', token: '@selection', text: 'hi' }),
  ];

  it('returns all items (selection pinned) when query is empty', () => {
    const ranked = rankMentions('', items);
    expect(ranked[0].kind).toBe('selection');
    expect(ranked).toHaveLength(items.length);
  });

  it('matches by id prefix first', () => {
    const ranked = rankMentions('button', items);
    expect(ranked.find((m) => m.kind !== 'selection')?.id).toBe('button-submit-0');
  });

  it('falls back to label substring match', () => {
    const ranked = rankMentions('subm', items);
    expect(ranked.some((m) => m.id === 'button-submit-0')).toBe(true);
  });

  it('matches text and nearby context, not only token/id text', () => {
    const ranked = rankMentions('reading', [
      ...items,
      mention({
        id: 'section-main-0',
        kind: 'section',
        label: 'Section: Main content',
        token: '@section-main-0',
        text: 'Article body',
        nearby: 'Further reading and related resources',
      }),
    ]);
    expect(ranked[1].id).toBe('section-main-0');
  });

  it('supports fuzzy subsequence matching', () => {
    const ranked = rankMentions('sbt', items);
    expect(ranked.some((m) => m.id === 'button-submit-0')).toBe(true);
  });

  it('always pins live selection at the top', () => {
    const ranked = rankMentions('subm', items);
    expect(ranked[0].kind).toBe('selection');
  });
});

describe('resolveMentions', () => {
  const store = new Map<string, Mention>();
  store.set('@button-submit-0', mention());
  store.set('@heading-pricing-0', mention({ id: 'heading-pricing-0', token: '@heading-pricing-0', kind: 'heading', label: 'Heading: Pricing' }));

  it('extracts known tokens from raw text', () => {
    const { mentioned } = resolveMentions(
      'Click @button-submit-0 then read @heading-pricing-0',
      store,
    );
    expect(mentioned.map((m) => m.id)).toEqual(['button-submit-0', 'heading-pricing-0']);
  });

  it('deduplicates repeated tokens', () => {
    const { mentioned } = resolveMentions(
      'use @button-submit-0 and @button-submit-0',
      store,
    );
    expect(mentioned).toHaveLength(1);
  });

  it('ignores unknown tokens', () => {
    const { mentioned } = resolveMentions('hello @ghost', store);
    expect(mentioned).toEqual([]);
  });
});

describe('formatContextBlock', () => {
  it('returns empty string when no mentions', () => {
    expect(formatContextBlock([])).toBe('');
  });

  it('renders structured fields in deterministic order', () => {
    const block = formatContextBlock([
      mention({ ariaLabel: 'Submit form', role: 'button', attrs: { type: 'submit' } }),
    ]);
    expect(block).toContain('@button-submit-0');
    expect(block).toContain('kind: button');
    expect(block).toContain('tag: button');
    expect(block).toContain('text: "Submit"');
    expect(block).toContain('ariaLabel: "Submit form"');
    expect(block).toContain('role: button');
    expect(block).toContain('attrs: type="submit"');
    expect(block).toContain('selector: form > button:nth-of-type(1)');
    expect(block).toContain('bbox: x=0 y=0 w=80 h=32');
  });
});
