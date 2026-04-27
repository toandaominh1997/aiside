import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('content script', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('listens for GET_PAGE_CONTENT and returns text', async () => {
    // Setup a dummy DOM
    document.body.innerHTML = `
      <div>
        <p>Main content here</p>
        <script>console.log('Ignore me')</script>
        <style>.ignore { color: red }</style>
      </div>
    `;

    await import('./content');

    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    
    messageListener({ type: 'GET_PAGE_CONTENT' }, {}, sendResponseMock);

    expect(sendResponseMock).toHaveBeenCalledWith({ text: expect.stringContaining('Main content here') });
    // Make sure script and style tags were ignored
    const calledWith = sendResponseMock.mock.calls[0][0].text;
    expect(calledWith).not.toContain('console.log');
    expect(calledWith).not.toContain('.ignore');
  });

  it('listens for GET_SELECTION and returns selected text', async () => {
    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    
    // Mock window.getSelection
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => 'selected text dummy'
    });

    const sendResponseMock = vi.fn();
    
    messageListener({ type: 'GET_SELECTION' }, {}, sendResponseMock);

    expect(sendResponseMock).toHaveBeenCalledWith({ text: 'selected text dummy' });
  });

  it('listens for GET_DOM_TREE and returns simplified DOM', async () => {
    document.body.innerHTML = `
      <div>
        <button>Click Me</button>
        <input type="text" placeholder="Search..." />
        <a href="#">Link</a>
        <span>Just text</span>
        <script>console.log('ignore')</script>
      </div>
    `;

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener({ type: 'GET_DOM_TREE' }, {}, sendResponseMock);

    expect(sendResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.any(String),
      title: expect.any(String)
    }));

    const domResponse = sendResponseMock.mock.calls[0][0].dom;
    expect(domResponse).toMatch(/^## region: /m);
    expect(domResponse).toMatch(/<button id="1"[^>]*data-aid="[^"]+"[^>]*>Click Me<\/button>/);
    expect(domResponse).toMatch(/<input id="2"[^>]*type="text"[^>]*>Search\.\.\.<\/input>/);
    expect(domResponse).toMatch(/<a id="3"[^>]*>Link<\/a>/);
    expect(domResponse).not.toContain('Just text'); // Not interactive
  });

  it('includes contenteditable, ARIA state, bboxes, and open shadow DOM in GET_DOM_TREE', async () => {
    document.body.innerHTML = `
      <div contenteditable="true">Editable note</div>
      <div role="checkbox" aria-checked="true">Done</div>
      <div id="host"></div>
    `;
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Shadow action</button>';
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 5,
      y: 6,
      width: 70,
      height: 20,
      top: 6,
      right: 75,
      bottom: 26,
      left: 5,
      toJSON: () => ({}),
    });

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener({ type: 'GET_DOM_TREE' }, {}, sendResponseMock);

    const dom = sendResponseMock.mock.calls[0][0].dom;
    expect(dom).toContain('contenteditable="true"');
    expect(dom).toContain('role="checkbox"');
    expect(dom).toContain('aria-checked="true"');
    expect(dom).toContain('bbox="5,6,70,20"');
    expect(dom).toContain('Shadow action');
  });

  it('executes click actions', async () => {
    document.body.innerHTML = `<button id="test-btn">Click Me</button>`;
    const btn = document.getElementById('test-btn')!;
    const clickSpy = vi.spyOn(btn, 'click');

    await import('./content');
    
    // We need to trigger GET_DOM_TREE first to populate the interactiveElements map
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    messageListener({ type: 'GET_DOM_TREE' }, {}, vi.fn());

    const sendResponseMock = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'click', targetId: '1' } }, {}, sendResponseMock);

    expect(clickSpy).toHaveBeenCalled();
    expect(sendResponseMock).toHaveBeenCalledWith({ success: true, message: 'Clicked 1' });
  });

  it('executes scroll down without needing a targetId', async () => {
    document.body.innerHTML = `<div style="height: 5000px"></div>`;
    const scroller = document.scrollingElement ?? document.documentElement;
    let scrollTopValue = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    scroller.scrollBy = vi.fn().mockImplementation((options: { top: number }) => {
      scrollTopValue += options.top;
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener(
      { type: 'EXECUTE_ACTION', payload: { action: 'scroll', direction: 'down' } },
      {},
      sendResponseMock,
    );

    expect(sendResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringMatching(/Scrolled down by \d+px/),
      }),
    );
    expect(scroller.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: expect.any(Number) }),
    );
    expect((scroller.scrollBy as ReturnType<typeof vi.fn>).mock.calls[0][0].top).toBeGreaterThan(0);
  });

  it('reports "already at bottom" when scroll cannot advance', async () => {
    document.body.innerHTML = `<div></div>`;
    const scroller = document.scrollingElement ?? document.documentElement;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: () => {},
    });
    scroller.scrollBy = vi.fn();

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener(
      { type: 'EXECUTE_ACTION', payload: { action: 'scroll', direction: 'down' } },
      {},
      sendResponseMock,
    );

    expect(sendResponseMock).toHaveBeenCalledWith({
      success: true,
      message: 'Already at bottom of page; no scroll happened',
    });
  });

  it('honors scroll direction up', async () => {
    document.body.innerHTML = `<div style="height: 5000px"></div>`;
    const scroller = document.scrollingElement ?? document.documentElement;
    let scrollTopValue = 1000;
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    scroller.scrollBy = vi.fn().mockImplementation((options: { top: number }) => {
      scrollTopValue += options.top;
    });

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener(
      { type: 'EXECUTE_ACTION', payload: { action: 'scroll', direction: 'up' } },
      {},
      sendResponseMock,
    );

    const callArg = (scroller.scrollBy as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.top).toBeLessThan(0);
    expect(sendResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringMatching(/Scrolled up/) }),
    );
  });

  it('returns structured mention candidates for selected text and page elements', async () => {
    document.body.innerHTML = `
      <main aria-label="Pricing page">
        <h1>Pricing</h1>
        <button type="submit">Start trial</button>
        <input name="email" placeholder="Email" />
      </main>
    `;
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => 'selected pricing copy',
    });
    const getBoundingClientRect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    getBoundingClientRect.mockReturnValue({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      top: 20,
      right: 110,
      bottom: 60,
      left: 10,
      toJSON: () => ({}),
    });

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener({ type: 'GET_MENTION_CANDIDATES' }, {}, sendResponseMock);

    const mentions = sendResponseMock.mock.calls[0][0].mentions;
    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'selection',
          label: 'Selected text: selected pricing copy',
          token: '@selection',
          text: 'selected pricing copy',
        }),
        expect.objectContaining({
          kind: 'heading',
          label: 'Heading: Pricing',
          token: expect.stringMatching(/^@heading-pricing-/),
          tag: 'h1',
          text: 'Pricing',
          selector: expect.stringContaining('h1:nth-of-type(1)'),
          bbox: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        }),
        expect.objectContaining({
          kind: 'button',
          label: 'Button: Start trial',
          attrs: expect.objectContaining({ type: 'submit' }),
        }),
        expect.objectContaining({
          kind: 'input',
          label: 'Input: Email',
          attrs: expect.objectContaining({ name: 'email', placeholder: 'Email' }),
        }),
      ]),
    );
  });

  it('executes type actions', async () => {
    document.body.innerHTML = `<input id="test-input" type="text" />`;
    const input = document.getElementById('test-input') as HTMLInputElement;

    await import('./content');

    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    messageListener({ type: 'GET_DOM_TREE' }, {}, vi.fn());

    const sendResponseMock = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'type', targetId: '1', value: 'hello world' } }, {}, sendResponseMock);

    expect(input.value).toBe('hello world');
    expect(sendResponseMock).toHaveBeenCalledWith({ success: true, message: 'Typed "hello world" into 1' });
  });

  it('executes click and type actions by mention token', async () => {
    document.body.innerHTML = `
      <button>Start trial</button>
      <input placeholder="Email" />
    `;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      right: 100,
      bottom: 40,
      left: 0,
      toJSON: () => ({}),
    });
    const button = document.querySelector('button')!;
    const input = document.querySelector('input')!;
    const clickSpy = vi.spyOn(button, 'click');

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    const mentionsResponse = vi.fn();
    messageListener({ type: 'GET_MENTION_CANDIDATES' }, {}, mentionsResponse);
    const mentions = mentionsResponse.mock.calls[0][0].mentions;
    const buttonToken = mentions.find((m: { kind: string }) => m.kind === 'button').token;
    const inputToken = mentions.find((m: { kind: string }) => m.kind === 'input').token;

    const clickResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'click', target: buttonToken } }, {}, clickResponse);
    expect(clickSpy).toHaveBeenCalled();
    expect(clickResponse).toHaveBeenCalledWith({ success: true, message: `Clicked ${buttonToken}` });

    const typeResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'type', target: inputToken, value: 'a@b.com' } }, {}, typeResponse);
    expect(input.value).toBe('a@b.com');
    expect(typeResponse).toHaveBeenCalledWith({ success: true, message: `Typed "a@b.com" into ${inputToken}` });
  });

  it('captures console errors and resource failures', async () => {
    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    console.error('boom');
    const img = document.createElement('img');
    img.src = 'https://example.test/missing.png';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error', { bubbles: true }));

    const consoleResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'get_console_errors' } }, {}, consoleResponse);
    expect(consoleResponse.mock.calls[0][0].data.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'boom', source: 'console.error' })]),
    );

    const networkResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'get_network_failures' } }, {}, networkResponse);
    expect(networkResponse.mock.calls[0][0].data.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'img', message: 'Resource failed to load' })]),
    );
  });

  it('executes coordinate clicks', async () => {
    document.body.innerHTML = `<button>Visual target</button>`;
    const button = document.querySelector('button')!;
    const clickSpy = vi.fn();
    button.addEventListener('click', clickSpy);
    if (typeof document.elementFromPoint !== 'function') {
      (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => null;
    }
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'click_at', x: 12, y: 34 } }, {}, sendResponseMock);

    expect(clickSpy).toHaveBeenCalled();
    expect(sendResponseMock).toHaveBeenCalledWith({ success: true, message: 'Clicked button at 12,34' });
  });

  it('reports coordinate click failure when no element is found', async () => {
    if (typeof document.elementFromPoint !== 'function') {
      (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => null;
    }
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'click_at', x: 12, y: 34 } }, {}, sendResponseMock);

    expect(sendResponseMock).toHaveBeenCalledWith({ success: false, error: 'No element at 12,34' });
  });

  it('executes press_key and hotkey events', async () => {
    document.body.innerHTML = `<input />`;
    const input = document.querySelector('input')!;
    input.focus();
    const keydown = vi.fn();
    const keyup = vi.fn();
    input.addEventListener('keydown', keydown);
    input.addEventListener('keyup', keyup);

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const pressResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'press_key', key: 'Enter' } }, {}, pressResponse);
    expect(keydown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
    expect(keyup).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
    expect(pressResponse).toHaveBeenCalledWith({ success: true, message: 'Pressed Enter' });

    const hotkeyResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'hotkey', keys: ['Meta', 'K'] } }, {}, hotkeyResponse);
    expect(keydown).toHaveBeenCalledWith(expect.objectContaining({ key: 'K', metaKey: true }));
    expect(hotkeyResponse).toHaveBeenCalledWith({ success: true, message: 'Pressed Meta+K' });
  });

  it('types into the focused element and contenteditable targets', async () => {
    document.body.innerHTML = `<input /><div contenteditable="true"></div>`;
    const input = document.querySelector('input')!;
    input.focus();

    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const typeTextResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'type_text', value: 'hello' } }, {}, typeTextResponse);
    expect(input.value).toBe('hello');
    expect(typeTextResponse).toHaveBeenCalledWith({ success: true, message: 'Typed "hello" into focused element' });

    messageListener({ type: 'GET_DOM_TREE' }, {}, vi.fn());
    const targetTypeResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'type', targetId: '2', value: 'note' } }, {}, targetTypeResponse);
    expect(document.querySelector('[contenteditable="true"]')?.textContent).toBe('note');
    expect(targetTypeResponse).toHaveBeenCalledWith({ success: true, message: 'Typed "note" into 2' });
  });

  it('remembers, recalls, and observes page state', async () => {
    document.body.innerHTML = `<button>Go</button>`;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      right: 100,
      bottom: 40,
      left: 0,
      toJSON: () => ({}),
    });
    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const rememberResponse = vi.fn();
    messageListener(
      { type: 'EXECUTE_ACTION', payload: { action: 'remember', key: 'page', value: 'pricing' } },
      {},
      rememberResponse,
    );
    expect(rememberResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { memory: { page: 'pricing' } } }),
    );

    const recallResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'recall', key: 'page' } }, {}, recallResponse);
    expect(recallResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { key: 'page', value: 'pricing' } }),
    );

    const observeResponse = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'observe' } }, {}, observeResponse);
    expect(observeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Observed page state',
        data: expect.objectContaining({
          url: expect.any(String),
          title: expect.any(String),
          dom: expect.stringContaining('<button'),
          consoleErrors: expect.any(Array),
          networkFailures: expect.any(Array),
          memory: { page: 'pricing' },
        }),
      }),
    );
  });

  it('read_page returns title, content, excerpt', async () => {
    document.title = 'Topology Notes';
    document.body.innerHTML = `
      <main>
        <h1>Topology Notes</h1>
        <p>An open set is a set whose complement is closed.</p>
        <h2>Examples</h2>
        <p>The interval (0, 1) is open.</p>
      </main>
    `;
    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener({ type: 'EXECUTE_ACTION', payload: { action: 'read_page' } }, {}, sendResponseMock);
    expect(sendResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          title: 'Topology Notes',
          content: expect.stringContaining('# Topology Notes'),
          excerpt: expect.stringContaining('open set'),
          url: expect.any(String),
        }),
      }),
    );
  });

  it('find_in_page returns hits with surrounding context', async () => {
    document.body.innerHTML = `
      <p>Pricing starts at $10 per month.</p>
      <p>For enterprise pricing contact sales.</p>
    `;
    await import('./content');
    const messageListener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];

    const sendResponseMock = vi.fn();
    messageListener(
      { type: 'EXECUTE_ACTION', payload: { action: 'find_in_page', query: 'pricing', limit: 5 } },
      {},
      sendResponseMock,
    );
    const response = sendResponseMock.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.data.hits.length).toBeGreaterThan(0);
    expect(response.data.hits[0].context.toLowerCase()).toContain('pricing');
  });
});