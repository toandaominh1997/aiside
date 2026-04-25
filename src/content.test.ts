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