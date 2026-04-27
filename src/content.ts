import type { Mention, MentionKind } from './agent/mentions';

// Map to store interactive elements for action execution.
// Numeric ids are kept for back-compat; stable string ids survive across snapshots
// until the page hash changes.
const interactiveElements = new Map<number, HTMLElement>();
const stableInteractiveElements = new Map<string, HTMLElement>();
const stableIdByElement = new WeakMap<HTMLElement, string>();
const mentionElements = new Map<string, HTMLElement>();
const consoleIssues: Array<{ level: 'error'; message: string; ts: number; source: string }> = [];
const networkIssues: Array<{ url: string; status?: number; kind: string; message: string; ts: number }> = [];
const pageMemory = new Map<string, string>();
let nextElementId = 1;
let instrumentationInstalled = false;

const MAX_ISSUES = 50;
const MAX_MENTIONS = 200;
const TEXT_LIMIT = 120;
const NEARBY_LIMIT = 200;
const ATTR_KEYS = [
  'type',
  'name',
  'href',
  'src',
  'alt',
  'placeholder',
  'role',
  'value',
  'aria-label',
  'aria-checked',
  'aria-disabled',
  'checked',
  'disabled',
];

function pushBounded<T>(items: T[], item: T, max = MAX_ISSUES) {
  items.push(item);
  if (items.length > max) items.splice(0, items.length - max);
}

function issueMessage(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
}

function installInstrumentation() {
  if (instrumentationInstalled) return;
  instrumentationInstalled = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    pushBounded(consoleIssues, {
      level: 'error',
      message: issueMessage(args),
      ts: Date.now(),
      source: 'console.error',
    });
    originalError(...args);
  };

  window.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLElement) {
        const url =
          event.target.getAttribute('src') ||
          event.target.getAttribute('href') ||
          event.target.getAttribute('poster') ||
          '';
        pushBounded(networkIssues, {
          url,
          kind: event.target.tagName.toLowerCase(),
          message: 'Resource failed to load',
          ts: Date.now(),
        });
        return;
      }

      pushBounded(consoleIssues, {
        level: 'error',
        message: event.message || 'Window error',
        ts: Date.now(),
        source: 'window.error',
      });
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    pushBounded(consoleIssues, {
      level: 'error',
      message: String(event.reason),
      ts: Date.now(),
      source: 'unhandledrejection',
    });
  });
}

installInstrumentation();

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function pickAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ATTR_KEYS) {
    const value = el.getAttribute(key);
    if (value !== null && value !== '') out[key] = value;
  }
  return out;
}

function nearbyText(el: Element, max: number): string {
  const parent = el.parentElement;
  if (!parent) return '';
  const text = (parent.textContent ?? '').trim().replace(/\s+/g, ' ');
  return text.slice(0, max);
}

function cssPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    if (cur.id) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      break;
    }
    const tag = cur.nodeName.toLowerCase();
    let nth = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.nodeName.toLowerCase() === tag) nth += 1;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${tag}:nth-of-type(${nth})`);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function makeMention(el: Element, kind: MentionKind, idx: number): Mention | null {
  if (!isVisible(el)) return null;
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, TEXT_LIMIT);
  const ariaLabel = el.getAttribute('aria-label') ?? undefined;
  const role = el.getAttribute('role') ?? undefined;
  const placeholder = (el as HTMLInputElement).placeholder;
  const display = ariaLabel || text || placeholder || (el as HTMLImageElement).alt || el.tagName.toLowerCase();
  const slug = slugify(display) || el.tagName.toLowerCase();
  const id = `${kind}-${slug}-${idx}`;
  const rect = el.getBoundingClientRect();
  return {
    id,
    kind,
    label: `${capitalize(kind)}: ${display.slice(0, 60)}`,
    token: `@${id}`,
    tag: el.tagName.toLowerCase(),
    text,
    attrs: pickAttrs(el),
    selector: cssPath(el),
    bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    ariaLabel,
    role,
    nearby: nearbyText(el, NEARBY_LIMIT),
  };
}

function makeSelectionMention(text: string): Mention {
  const truncated = text.replace(/\s+/g, ' ').slice(0, TEXT_LIMIT);
  return {
    id: 'selection-current',
    kind: 'selection',
    label: `Selected text: ${truncated.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
    token: '@selection',
    tag: '#selection',
    text: truncated,
    attrs: {},
    selector: '',
    bbox: { x: 0, y: 0, w: 0, h: 0 },
  };
}

function pushAll(out: Mention[], els: NodeListOf<Element>, kind: MentionKind, offset: number): number {
  let i = offset;
  els.forEach((el) => {
    const m = makeMention(el, kind, i);
    if (m) {
      out.push(m);
      if (el instanceof HTMLElement) {
        mentionElements.set(m.id, el);
        mentionElements.set(m.token, el);
      }
      i += 1;
    }
  });
  return i;
}

function collectMentionCandidates(): Mention[] {
  mentionElements.clear();
  const out: Mention[] = [];

  const sel = (window.getSelection()?.toString() ?? '').trim();
  if (sel) out.push(makeSelectionMention(sel));

  pushAll(out, document.querySelectorAll('h1,h2,h3,h4,h5,h6'), 'heading', 0);
  pushAll(out, document.querySelectorAll('main,nav,aside,section,header,footer,[role="region"]'), 'section', 0);
  pushAll(out, document.querySelectorAll('button,[role="button"]'), 'button', 0);
  pushAll(out, document.querySelectorAll('a[href]'), 'link', 0);
  pushAll(out, document.querySelectorAll('input,textarea,select'), 'input', 0);
  pushAll(out, document.querySelectorAll('img[alt]'), 'image', 0);
  pushAll(out, document.querySelectorAll('table'), 'table', 0);
  pushAll(out, document.querySelectorAll('form'), 'form', 0);

  const seen = new Set<string>();
  const deduped: Mention[] = [];
  for (const m of out) {
    const key = m.kind === 'selection' ? m.id : m.selector;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
    if (deduped.length >= MAX_MENTIONS) break;
  }
  return deduped;
}

function isInteractive(el: HTMLElement): boolean {
  const tagName = el.tagName.toLowerCase();
  if (['a', 'button', 'input', 'select', 'textarea', 'summary', 'dialog'].includes(tagName)) return true;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
  const role = el.getAttribute('role');
  if (
    el.hasAttribute('onclick') ||
    (role &&
      [
        'button',
        'link',
        'checkbox',
        'switch',
        'radio',
        'option',
        'menuitem',
        'tab',
        'textbox',
        'searchbox',
        'combobox',
      ].includes(role))
  ) {
    return true;
  }
  const style = window.getComputedStyle(el);
  if (style.cursor === 'pointer') return true;
  return false;
}

function isSkippedElement(el: HTMLElement): boolean {
  return ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName);
}

function isHiddenElement(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}

function elementText(el: HTMLElement, max = 50): string {
  return (
    (el.innerText || el.textContent || '').trim() ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('value') ||
    ''
  )
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

function domAttrs(el: HTMLElement, id: number): string {
  const rect = el.getBoundingClientRect();
  const attrs: string[] = [`id="${id}"`];
  for (const key of ATTR_KEYS) {
    const value = key === 'checked' || key === 'disabled' ? booleanAttr(el, key) : el.getAttribute(key);
    if (value !== null && value !== '') attrs.push(`${key}="${escapeAttr(value)}"`);
  }
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') attrs.push('contenteditable="true"');
  attrs.push(`bbox="${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}"`);
  return attrs.join(' ');
}

function booleanAttr(el: HTMLElement, key: 'checked' | 'disabled'): string | null {
  if (key === 'checked' && el instanceof HTMLInputElement && el.checked) return 'true';
  if (key === 'disabled' && 'disabled' in el && Boolean((el as { disabled?: boolean }).disabled)) return 'true';
  return el.hasAttribute(key) ? 'true' : null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function traverseElements(root: ParentNode, visit: (el: HTMLElement) => void) {
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (isSkippedElement(child) || isHiddenElement(child)) continue;
    visit(child);
    if (child.shadowRoot) traverseElements(child.shadowRoot, visit);
    traverseElements(child, visit);
  }
}

function targetElement(targetId: unknown, target: unknown): HTMLElement | undefined {
  if (targetId !== undefined && targetId !== null && targetId !== '') {
    const raw = String(targetId).trim();
    const stable = stableInteractiveElements.get(raw);
    if (stable) return stable;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const byNumber = interactiveElements.get(numeric);
      if (byNumber) return byNumber;
    }
  }

  if (typeof target === 'string' && target.trim()) {
    const raw = target.trim();
    return (
      mentionElements.get(raw) ??
      mentionElements.get(raw.startsWith('@') ? raw.slice(1) : `@${raw}`) ??
      stableInteractiveElements.get(raw)
    );
  }

  return undefined;
}

function targetLabel(targetId: unknown, target: unknown): string {
  return typeof target === 'string' && target.trim() ? target.trim() : String(targetId);
}

function memoryObject(): Record<string, string> {
  return Object.fromEntries(pageMemory.entries());
}

function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

function accessibleName(el: HTMLElement): string {
  return (
    el.getAttribute('aria-label') ||
    (el as HTMLInputElement).placeholder ||
    (el as HTMLImageElement).alt ||
    elementText(el, 40) ||
    el.getAttribute('name') ||
    el.getAttribute('title') ||
    ''
  );
}

function elementRoleHint(el: HTMLElement): string {
  return (el.getAttribute('role') || el.tagName).toLowerCase();
}

function nameSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16);
}

function stableElementId(el: HTMLElement): string {
  const cached = stableIdByElement.get(el);
  if (cached) return cached;
  const role = elementRoleHint(el);
  const name = nameSlug(accessibleName(el)) || 'el';
  const path = cssPath(el);
  const id = `${role}-${name}-${shortHash(`${role}|${name}|${path}`)}`;
  stableIdByElement.set(el, id);
  return id;
}

function isInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.left <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function nearestRegionLabel(el: HTMLElement): string {
  let cur: HTMLElement | null = el;
  while (cur) {
    const tag = cur.tagName?.toLowerCase();
    const role = cur.getAttribute?.('role') || '';
    if (tag === 'main' || role === 'main') return 'main';
    if (tag === 'nav' || role === 'navigation') return 'nav';
    if (tag === 'header' || role === 'banner') return 'header';
    if (tag === 'footer' || role === 'contentinfo') return 'footer';
    if (tag === 'aside' || role === 'complementary') return 'aside';
    if (role === 'region') {
      return `region:${nameSlug(cur.getAttribute('aria-label') || '') || 'unnamed'}`;
    }
    cur = cur.parentElement;
  }
  return 'body';
}

function getSimplifiedDOM() {
  interactiveElements.clear();
  stableInteractiveElements.clear();
  nextElementId = 1;

  const groups = new Map<
    string,
    Array<{ el: HTMLElement; numericId: number; stableId: string; viewport: boolean }>
  >();

  traverseElements(document.body, (el) => {
    if (!isInteractive(el)) return;
    const numericId = nextElementId++;
    interactiveElements.set(numericId, el);
    const stableId = stableElementId(el);
    stableInteractiveElements.set(stableId, el);
    stableInteractiveElements.set(`@${stableId}`, el);
    const region = nearestRegionLabel(el);
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region)!.push({ el, numericId, stableId, viewport: isInViewport(el) });
  });

  if (groups.size === 0) return 'No interactive elements found.';

  const REGION_ORDER = ['main', 'nav', 'header', 'footer', 'aside', 'body'];
  const sortedRegions = [...groups.keys()].sort((a, b) => {
    const ai = REGION_ORDER.indexOf(a);
    const bi = REGION_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const lines: string[] = [];
  for (const region of sortedRegions) {
    const items = groups.get(region)!;
    items.sort((a, b) => Number(b.viewport) - Number(a.viewport));
    lines.push(`## region: ${region}`);
    for (const item of items) {
      const tag = item.el.tagName.toLowerCase();
      const text = elementText(item.el);
      const attrs = domAttrs(item.el, item.numericId);
      const stable = ` data-aid="${item.stableId}"${item.viewport ? ' data-viewport="1"' : ''}`;
      lines.push(`<${tag} ${attrs}${stable}>${text}</${tag}>`);
    }
  }
  return lines.join('\n');
}

function focusElement(el: HTMLElement) {
  if (typeof el.focus === 'function') el.focus();
}

function insertText(el: Element | null, text: string): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    focusElement(el);
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (typeof el.setRangeText === 'function') {
      el.setRangeText(text, start, end, 'end');
    } else {
      el.value = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if (el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true')) {
    focusElement(el);
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      el.append(document.createTextNode(text));
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }

  return false;
}

function dispatchKey(target: EventTarget, type: 'keydown' | 'keyup', key: string, modifiers: KeyModifiers) {
  target.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      metaKey: modifiers.metaKey,
      ctrlKey: modifiers.ctrlKey,
      altKey: modifiers.altKey,
      shiftKey: modifiers.shiftKey,
    }),
  );
}

interface KeyModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function activeKeyTarget(): EventTarget {
  return document.activeElement ?? document.body;
}

function modifierName(key: string): keyof KeyModifiers | undefined {
  const normalized = key.toLowerCase();
  if (['meta', 'command', 'cmd'].includes(normalized)) return 'metaKey';
  if (['control', 'ctrl'].includes(normalized)) return 'ctrlKey';
  if (['alt', 'option'].includes(normalized)) return 'altKey';
  if (normalized === 'shift') return 'shiftKey';
  return undefined;
}

function pressHotkey(keys: string[]): string {
  const target = activeKeyTarget();
  const modifiers: KeyModifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  const finalKey = keys.filter(Boolean).at(-1) ?? '';
  const modifierKeys = keys.slice(0, -1);

  for (const key of modifierKeys) {
    const modifier = modifierName(key);
    if (modifier) modifiers[modifier] = true;
    dispatchKey(target, 'keydown', key, modifiers);
  }
  dispatchKey(target, 'keydown', finalKey, modifiers);
  dispatchKey(target, 'keyup', finalKey, modifiers);
  for (const key of modifierKeys.reverse()) {
    const modifier = modifierName(key);
    if (modifier) modifiers[modifier] = false;
    dispatchKey(target, 'keyup', key, modifiers);
  }
  return keys.join('+');
}

function clickAt(x: number, y: number): { success: boolean; message?: string; error?: string } {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof HTMLElement)) return { success: false, error: `No element at ${x},${y}` };
  focusElement(el);
  const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  const PointerCtor = typeof PointerEvent === 'undefined' ? MouseEvent : PointerEvent;
  el.dispatchEvent(new PointerCtor('pointerdown', eventInit));
  el.dispatchEvent(new MouseEvent('mousedown', eventInit));
  el.dispatchEvent(new PointerCtor('pointerup', eventInit));
  el.dispatchEvent(new MouseEvent('mouseup', eventInit));
  el.dispatchEvent(new MouseEvent('click', eventInit));
  return { success: true, message: `Clicked ${el.tagName.toLowerCase()} at ${x},${y}` };
}

function readableText(el: Element | null | undefined): string {
  if (!el) return '';
  const innerText = (el as HTMLElement).innerText;
  if (typeof innerText === 'string' && innerText.length > 0) return innerText;
  return (el.textContent ?? '').trim();
}

function pickReadableRoot(): HTMLElement {
  const candidates: HTMLElement[] = [];
  const main = document.querySelector('main');
  if (main instanceof HTMLElement) candidates.push(main);
  const article = document.querySelector('article');
  if (article instanceof HTMLElement) candidates.push(article);
  document.querySelectorAll('[role="main"], section').forEach((el) => {
    if (el instanceof HTMLElement) candidates.push(el);
  });
  candidates.push(document.body);

  let best = document.body;
  let bestScore = 0;
  for (const node of candidates) {
    const text = readableText(node).trim();
    const score = text.length;
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

function blockToMarkdown(el: HTMLElement, depth = 0): string {
  const tag = el.tagName.toLowerCase();
  const text = readableText(el).trim().replace(/\s+/g, ' ');
  if (!text && !['ul', 'ol', 'pre', 'table'].includes(tag)) return '';

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));
    return `${'#'.repeat(level)} ${text}\n\n`;
  }
  if (tag === 'p') return `${text}\n\n`;
  if (tag === 'li') return `${'  '.repeat(depth)}- ${text}\n`;
  if (tag === 'ul' || tag === 'ol') {
    const lines: string[] = [];
    el.querySelectorAll(':scope > li').forEach((li) => {
      if (li instanceof HTMLElement) lines.push(blockToMarkdown(li, depth));
    });
    return `${lines.join('')}\n`;
  }
  if (tag === 'pre') return `\n\`\`\`\n${text}\n\`\`\`\n\n`;
  if (tag === 'blockquote') return `> ${text}\n\n`;
  if (tag === 'a') return text;
  return '';
}

function readPage(): {
  title: string;
  byline?: string;
  excerpt: string;
  content: string;
  url: string;
  lang?: string;
} {
  const root = pickReadableRoot();
  const blocks: string[] = [];
  const selector = 'h1,h2,h3,h4,h5,h6,p,ul,ol,pre,blockquote';
  root.querySelectorAll(selector).forEach((node) => {
    if (node instanceof HTMLElement) {
      const md = blockToMarkdown(node);
      if (md) blocks.push(md);
    }
  });
  const content = blocks.join('').trim().slice(0, 12000);
  const text = readableText(root).trim().replace(/\s+/g, ' ');
  const excerpt = text.slice(0, 280);
  const byline = document.querySelector('meta[name="author"]')?.getAttribute('content') ?? undefined;
  const lang = document.documentElement.lang || undefined;
  return {
    title: document.title,
    byline,
    excerpt,
    content,
    url: window.location.href,
    lang,
  };
}

interface FindHit {
  index: number;
  text: string;
  context: string;
  selector: string;
}

function findInPage(query: string, limit = 5): FindHit[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const hits: FindHit[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.nodeValue && node.nodeValue.toLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  let i = 0;
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue ?? '';
    const offset = text.toLowerCase().indexOf(needle);
    const start = Math.max(0, offset - 80);
    const end = Math.min(text.length, offset + needle.length + 80);
    const parent = walker.currentNode.parentElement;
    if (i === 0 && parent) {
      try {
        parent.scrollIntoView({ behavior: 'auto', block: 'center' });
      } catch {
        // ignore
      }
    }
    hits.push({
      index: i,
      text: text.slice(offset, offset + needle.length),
      context: text.slice(start, end),
      selector: parent ? cssPath(parent) : '',
    });
    i += 1;
    if (hits.length >= limit) break;
  }
  return hits;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_PAGE_CONTENT") {
    const clone = document.body.cloneNode(true) as HTMLElement;
    const scripts = clone.querySelectorAll('script, style, noscript');
    scripts.forEach(s => s.remove());
    const text = clone.innerText || clone.textContent || "";
    sendResponse({ text: text });
  } else if (request.type === "GET_SELECTION") {
    const selection = window.getSelection();
    sendResponse({ text: selection ? selection.toString() : "" });
  } else if (request.type === "GET_DOM_TREE") {
    sendResponse({ dom: getSimplifiedDOM(), url: window.location.href, title: document.title });
  } else if (request.type === "GET_MENTION_CANDIDATES") {
    sendResponse({ mentions: collectMentionCandidates() });
  } else if (request.type === "EXECUTE_ACTION") {
    const { action, targetId, target, value, direction, key, keys, x, y } = request.payload;
    const needsElement = action === 'click' || action === 'type';
    const el = needsElement ? targetElement(targetId, target) : undefined;
    const label = targetLabel(targetId, target);

    if (needsElement && !el) {
      sendResponse({ success: false, error: `Target not found: ${label}` });
      return true;
    }

    try {
      if (action === 'click') {
        el?.click();
        sendResponse({ success: true, message: `Clicked ${label}` });
      } else if (action === 'type') {
        if (insertText(el ?? null, String(value ?? ''))) {
          sendResponse({ success: true, message: `Typed "${value}" into ${label}` });
        } else {
          sendResponse({ success: false, error: `Target ${label} is not editable` });
        }
      } else if (action === 'click_at') {
        sendResponse(clickAt(Number(x), Number(y)));
      } else if (action === 'press_key') {
        const pressedKey = String(key ?? '');
        const target = activeKeyTarget();
        const modifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
        dispatchKey(target, 'keydown', pressedKey, modifiers);
        dispatchKey(target, 'keyup', pressedKey, modifiers);
        sendResponse({ success: true, message: `Pressed ${pressedKey}` });
      } else if (action === 'hotkey') {
        const combo = pressHotkey(Array.isArray(keys) ? keys.map(String) : []);
        sendResponse({ success: true, message: `Pressed ${combo}` });
      } else if (action === 'type_text') {
        if (insertText(document.activeElement, String(value ?? ''))) {
          sendResponse({ success: true, message: `Typed "${value}" into focused element` });
        } else {
          sendResponse({ success: false, error: 'Focused element is not editable' });
        }
      } else if (action === 'navigate') {
        window.location.href = value;
        sendResponse({ success: true, message: `Navigating to ${value}` });
      } else if (action === 'scroll') {
        const sign = direction === 'up' ? -1 : 1;
        const scroller = document.scrollingElement ?? document.documentElement;
        const before = scroller.scrollTop;
        const step = Math.max(window.innerHeight * 0.8, 200);
        scroller.scrollBy({ top: sign * step, behavior: 'auto' });
        const after = scroller.scrollTop;
        const delta = Math.abs(after - before);
        if (delta < 1) {
          const edge = sign === 1 ? 'bottom' : 'top';
          sendResponse({ success: true, message: `Already at ${edge} of page; no scroll happened` });
        } else {
          sendResponse({
            success: true,
            message: `Scrolled ${direction === 'up' ? 'up' : 'down'} by ${Math.round(delta)}px`,
          });
        }
      } else if (action === 'get_console_errors') {
        sendResponse({ success: true, message: `${consoleIssues.length} console error(s)`, data: { errors: consoleIssues } });
      } else if (action === 'get_network_failures') {
        sendResponse({ success: true, message: `${networkIssues.length} network failure(s)`, data: { failures: networkIssues } });
      } else if (action === 'observe') {
        sendResponse({
          success: true,
          message: 'Observed page state',
          data: {
            url: window.location.href,
            title: document.title,
            dom: getSimplifiedDOM(),
            consoleErrors: consoleIssues,
            networkFailures: networkIssues,
            memory: memoryObject(),
          },
        });
      } else if (action === 'remember') {
        pageMemory.set(String(key), String(value ?? ''));
        sendResponse({ success: true, message: `Remembered ${key}`, data: { memory: memoryObject() } });
      } else if (action === 'recall') {
        const keyString = typeof key === 'string' && key ? key : undefined;
        sendResponse({
          success: true,
          message: keyString ? `Recalled ${keyString}` : 'Recalled all memory',
          data: keyString ? { key: keyString, value: pageMemory.get(keyString) } : { memory: memoryObject() },
        });
      } else if (action === 'read_page') {
        const readable = readPage();
        sendResponse({
          success: true,
          message: `Read ${readable.title || readable.url}`,
          data: readable,
        });
      } else if (action === 'find_in_page') {
        const queryString = typeof request.payload.query === 'string' ? request.payload.query : '';
        const limitNumber = Number(request.payload.limit ?? 5);
        const hits = findInPage(queryString, Number.isFinite(limitNumber) ? limitNumber : 5);
        sendResponse({
          success: true,
          message: `Found ${hits.length} match(es) for ${JSON.stringify(queryString)}`,
          data: { hits },
        });
      } else {
        sendResponse({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (e: unknown) {
      sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return true;
});
