import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App component', () => {
  beforeEach(() => {
    // Reset chrome storage mock
    vi.mocked(chrome.storage.local.get).mockImplementation((keys, callback) => {
      callback({
        apiKey: 'test-api-key',
        baseUrl: 'https://test.api.com',
        model: 'test-model',
        chatHistory: []
      });
    });

    // Mock fetch
    global.fetch = vi.fn();
    
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders initial state correctly', async () => {
    render(<App />);
    expect(screen.getByText('test-model')).toBeInTheDocument();
    expect(screen.getByText('Take actions with Aiside')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask Aiside...')).toBeInTheDocument();
  });

  it('sends a message and displays response', async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello! "}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"I am Aiside."}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: stream
    });

    render(<App />);

    const input = screen.getByPlaceholderText('Ask Aiside...');
    await user.type(input, 'Hi there');
    
    // Press enter
    await user.keyboard('{Enter}');

    expect(screen.getByText('Hi there')).toBeInTheDocument();
    
    // Wait for the response
    await waitFor(() => {
      expect(screen.getByText('Hello! I am Aiside.')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://test.api.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-key'
        },
        body: JSON.stringify({
          model: 'test-model',
          messages: [
            { role: 'user', content: 'Hi there' }
          ],
          stream: true
        })
      })
    );
  });

  it('handles API errors gracefully', async () => {
    const user = userEvent.setup();
    
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { message: 'Service Unavailable' } })
    });

    render(<App />);

    const input = screen.getByPlaceholderText('Ask Aiside...');
    await user.type(input, 'Test error handling{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Error: API Error: 503/)).toBeInTheDocument();
    });
  });

  it('prompts user to open options page if API key is missing', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation((keys, callback) => {
      callback({
        apiKey: '',
        baseUrl: 'https://test.api.com',
        model: 'test-model',
        chatHistory: []
      });
    });

    const user = userEvent.setup();
    render(<App />);

    // Mock alert
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const input = screen.getByPlaceholderText('Ask Aiside...');
    await user.type(input, 'This should fail{Enter}');

    expect(alertMock).toHaveBeenCalledWith('Please configure your API key in the extension options.');
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('can read page context', async () => {
    const user = userEvent.setup();
    
    const mockTabs = [{ id: 1 }];
    vi.mocked(chrome.tabs.query).mockImplementation((query, callback) => {
      callback(mockTabs as any);
    });

    vi.mocked(chrome.tabs.sendMessage).mockImplementation((tabId, request, callback: any) => {
      if (request.type === 'GET_PAGE_CONTENT') {
        callback({ text: 'This is the mock page content.' });
      } else if (request.type === 'GET_DOM_TREE') {
        callback({ dom: 'Mock DOM', url: 'http://test.com', title: 'Test Title' });
      }
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Summary."}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: stream
    });

    render(<App />);

    const readButton = screen.getByTitle('Read Page Context');
    await user.click(readButton);

    await waitFor(() => {
      expect(screen.getByText(/Please read this page context and summarize it/)).toBeInTheDocument();
    });
  });

  it('handles GET_PAGE_CONTENT failing gracefully', async () => {
    const user = userEvent.setup();
    
    const mockTabs = [{ id: 1, url: 'chrome://extensions', title: 'Extensions' }];
    vi.mocked(chrome.tabs.query).mockImplementation((query, callback) => {
      callback(mockTabs as any);
    });

    // Mock an undefined response (e.g. no content script on the page)
    vi.mocked(chrome.tabs.sendMessage).mockImplementation((tabId, request, callback: any) => {
      callback(); 
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Ok."}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: stream
    });

    render(<App />);
    
    const readButton = screen.getByTitle('Read Page Context');
    await user.click(readButton);

    await waitFor(() => {
      expect(screen.getByText(/\[No text content found\]/)).toBeInTheDocument();
    });
  });

  it('updates configuration when storage changes', async () => {
    render(<App />);
    
    const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
    
    listener(
      {
        apiKey: { newValue: 'new-key', oldValue: 'test-api-key' },
        baseUrl: { newValue: 'https://new-url.com', oldValue: 'https://test.api.com' },
        model: { newValue: 'new-model', oldValue: 'test-model' }
      },
      'local'
    );

    // Verify config is updated by sending a request
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Updated config response"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    
    (global.fetch as any).mockResolvedValueOnce({ ok: true, body: stream });

    const input = screen.getByPlaceholderText('Ask Aiside...');
    await user.type(input, 'Test{Enter}');
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'https://new-url.com/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer new-key'
          })
        })
      );
    });
  });

  it('handles context menu selection events from background', async () => {
    render(<App />);
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls[0][0];
    
    act(() => {
      listener({ type: "CONTEXT_MENU_SELECTION", text: "this is highlighted text" }, {}, () => {});
    });
    
    const input = screen.getByPlaceholderText('Ask Aiside...') as HTMLTextAreaElement;
    expect(input.value).toContain('Context:\n"this is highlighted text"');
  });

  it('opens options page when settings icon is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    
    const settingsBtn = screen.getByTitle('Settings');
    await user.click(settingsBtn);
    
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
