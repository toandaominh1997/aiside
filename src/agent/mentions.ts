export type MentionKind =
  | 'selection'
  | 'heading'
  | 'button'
  | 'link'
  | 'input'
  | 'image'
  | 'table'
  | 'form'
  | 'section'
  | 'landmark'
  | 'element';

export interface Mention {
  id: string;
  kind: MentionKind;
  label: string;
  token: string;
  tag: string;
  text: string;
  attrs: Record<string, string>;
  selector: string;
  bbox: { x: number; y: number; w: number; h: number };
  ariaLabel?: string;
  role?: string;
  nearby?: string;
}

export interface ActiveTrigger {
  start: number;
  end: number;
  query: string;
}

export function findActiveTrigger(value: string, caret: number): ActiveTrigger | null {
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = value[i];
    if (ch === '@') {
      const prev = i === 0 ? ' ' : value[i - 1];
      if (!/\s/.test(prev)) return null;
      const query = value.slice(i + 1, caret);
      if (/\s/.test(query)) return null;
      return { start: i, end: caret, query };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

export function rankMentions(query: string, items: Mention[], limit = 50): Mention[] {
  const pinned = items.filter((m) => m.kind === 'selection');
  const rest = items.filter((m) => m.kind !== 'selection');
  if (!query) return [...pinned, ...rest].slice(0, limit);

  const q = query.toLowerCase();
  const scored = rest
    .map((m) => ({ m, score: scoreMention(q, m) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.m);

  return [...pinned, ...scored].slice(0, limit);
}

function scoreMention(q: string, m: Mention): number {
  const fields = [
    { value: m.id, weight: 100 },
    { value: m.label, weight: 90 },
    { value: m.text, weight: 80 },
    { value: m.ariaLabel ?? '', weight: 75 },
    { value: Object.values(m.attrs).join(' '), weight: 65 },
    { value: m.nearby ?? '', weight: 45 },
    { value: m.kind, weight: 35 },
  ];

  return Math.max(...fields.map((field) => scoreText(q, field.value, field.weight)));
}

function scoreText(q: string, value: string, weight: number): number {
  const text = normalize(value);
  if (!text) return 0;
  if (text === q) return weight + 30;
  if (text.startsWith(q)) return weight + 20;

  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => word === q)) return weight + 15;
  if (words.some((word) => word.startsWith(q))) return weight + 10;

  const acronym = words.map((word) => word[0]).join('');
  if (acronym.startsWith(q)) return weight + 5;

  const substringIndex = text.indexOf(q);
  if (substringIndex >= 0) return weight - Math.min(substringIndex, 30);

  const fuzzy = fuzzyScore(q, text);
  return fuzzy > 0 ? Math.max(1, weight - 35 + fuzzy) : 0;
}

function fuzzyScore(q: string, text: string): number {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let gaps = 0;

  for (let textIndex = 0; textIndex < text.length && queryIndex < q.length; textIndex += 1) {
    if (text[textIndex] !== q[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = textIndex;
    if (lastMatch >= 0) gaps += textIndex - lastMatch - 1;
    lastMatch = textIndex;
    queryIndex += 1;
  }

  if (queryIndex < q.length || firstMatch === -1) return 0;
  return Math.max(1, 25 - firstMatch - Math.floor(gaps / 2));
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

const TOKEN_RE = /@[\w-]+/g;

export function resolveMentions(
  raw: string,
  store: Map<string, Mention>,
): { userText: string; mentioned: Mention[] } {
  const tokens = raw.match(TOKEN_RE) ?? [];
  const seen = new Set<string>();
  const mentioned: Mention[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    const item = store.get(token);
    if (item) {
      seen.add(token);
      mentioned.push(item);
    }
  }
  return { userText: raw, mentioned };
}

export function formatContextBlock(mentions: Mention[]): string {
  if (mentions.length === 0) return '';
  const lines: string[] = ['The user mentioned the following page elements:', ''];
  for (const m of mentions) {
    lines.push(m.token);
    lines.push(`  kind: ${m.kind}`);
    lines.push(`  tag: ${m.tag}`);
    if (m.text) lines.push(`  text: ${JSON.stringify(m.text)}`);
    if (m.ariaLabel) lines.push(`  ariaLabel: ${JSON.stringify(m.ariaLabel)}`);
    if (m.role) lines.push(`  role: ${m.role}`);
    const attrEntries = Object.entries(m.attrs);
    if (attrEntries.length > 0) {
      lines.push(
        `  attrs: ${attrEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`,
      );
    }
    lines.push(`  selector: ${m.selector}`);
    if (m.bbox.w > 0 || m.bbox.h > 0) {
      lines.push(
        `  bbox: x=${Math.round(m.bbox.x)} y=${Math.round(m.bbox.y)} w=${Math.round(m.bbox.w)} h=${Math.round(m.bbox.h)}`,
      );
    }
    if (m.nearby) lines.push(`  nearby: ${JSON.stringify(m.nearby)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
