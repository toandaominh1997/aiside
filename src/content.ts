// Map to store interactive elements for action execution
let interactiveElements = new Map<number, HTMLElement>();
let nextElementId = 1;

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
      
      let tag = el.tagName.toLowerCase();
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
  } else if (request.type === "EXECUTE_ACTION") {
    const { action, targetId, value } = request.payload;
    const el = interactiveElements.get(parseInt(targetId));
    
    if (!el && action !== 'navigate') {
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
        window.scrollBy(0, window.innerHeight * 0.8);
        sendResponse({ success: true, message: `Scrolled down` });
      } else {
        sendResponse({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true;
});