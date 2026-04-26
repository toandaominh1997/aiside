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
      dom: expect.stringContaining('<button id="1">Click Me</button>'),
      url: expect.any(String),
      title: expect.any(String)
    }));
    
    const domResponse = sendResponseMock.mock.calls[0][0].dom;
    expect(domResponse).toContain('<input id="2" type="text">Search...</input>');
    expect(domResponse).toContain('<a id="3">Link</a>');
    expect(domResponse).not.toContain('Just text'); // Not interactive
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
    expect(sendResponseMock).toHaveBeenCalledWith({ success: true, message: 'Clicked element 1' });
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
    expect(sendResponseMock).toHaveBeenCalledWith({ success: true, message: 'Typed "hello world" into element 1' });
  });
});