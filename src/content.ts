import type { Mention, MentionKind } from './agent/mentions';

// Map to store interactive elements for action execution
const interactiveElements = new Map<number, HTMLElement>();
let nextElementId = 1;

const MAX_MENTIONS = 200;
const TEXT_LIMIT = 120;
const NEARBY_LIMIT = 200;
const ATTR_KEYS = ['type', 'name', 'href', 'src', 'alt', 'placeholder', 'role', 'value'];

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
      i += 1;
    }
  });
  return i;
}

function collectMentionCandidates(): Mention[] {
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
  if (el.hasAttribute('onclick') || el.hasAttribute('role') && ['button', 'link', 'checkbox', 'menuitem', 'tab'].includes(el.getAttribute('role') || '')) return true;
  const style = window.getComputedStyle(el);
  if (style.cursor === 'pointer') return true;
  return false;
}

function getSimplifiedDOM() {
  interactiveElements.clear();
  nextElementId = 1;
  
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as HTMLElement;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') {
        return NodeFilter.FILTER_REJECT;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let domString = "";
  let node;
  
  while ((node = walker.nextNode())) {
    const el = node as HTMLElement;
    if (isInteractive(el)) {
      const id = nextElementId++;
      interactiveElements.set(id, el);
      
      const tag = el.tagName.toLowerCase();
      let text = (el.innerText || el.textContent || '').trim().substring(0, 50) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || '';
      text = text.replace(/\n/g, ' '); // Clean up newlines
      
      let typeInfo = '';
      if (tag === 'input') {
        typeInfo = ` type="${el.getAttribute('type') || 'text'}"`;
      }
      
      if (text || tag === 'input' || tag === 'textarea') {
        domString += `<${tag} id="${id}"${typeInfo}>${text}</${tag}>\n`;
      }
    }
  }
  
  return domString || "No interactive elements found.";
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
    const { action, targetId, value, direction } = request.payload;
    const needsElement = action === 'click' || action === 'type';
    const el = needsElement ? interactiveElements.get(parseInt(String(targetId))) : undefined;

    if (needsElement && !el) {
      sendResponse({ success: false, error: `Element with id ${targetId} not found` });
      return true;
    }

    try {
      if (action === 'click') {
        el?.click();
        sendResponse({ success: true, message: `Clicked element ${targetId}` });
      } else if (action === 'type') {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          sendResponse({ success: true, message: `Typed "${value}" into element ${targetId}` });
        } else {
          sendResponse({ success: false, error: `Element ${targetId} is not an input or textarea` });
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
      } else {
        sendResponse({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (e: unknown) {
      sendResponse({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return true;
});
