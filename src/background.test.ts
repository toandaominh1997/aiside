import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('background script', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registers context menu on install', async () => {
    // Dynamically import the background script so it runs against our mocks
    await import('./background');

    // Trigger onInstalled event
    const onInstalledCallback = vi.mocked(chrome.runtime.onInstalled.addListener).mock.calls[0][0];
    onInstalledCallback({ reason: 'install' });

    expect(chrome.contextMenus.create).toHaveBeenCalledWith({
      id: "ask-aiside",
      title: "Ask Aiside about this",
      contexts: ["selection", "page"]
    });
  });

  it('handles context menu clicks', async () => {
    await import('./background');
    
    const onClickCallback = vi.mocked(chrome.contextMenus.onClicked.addListener).mock.calls[0][0];

    // Mock setTimeout so it runs synchronously
    vi.useFakeTimers();

    onClickCallback({ menuItemId: 'ask-aiside', selectionText: 'test selection' }, { id: 1, windowId: 100 });

    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 100 });
    
    vi.advanceTimersByTime(500);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CONTEXT_MENU_SELECTION",
      text: "test selection"
    });

    vi.useRealTimers();
  });

  it('handles context menu clicks for pageUrl', async () => {
    await import('./background');
    
    const onClickCallback = vi.mocked(chrome.contextMenus.onClicked.addListener).mock.calls[0][0];

    vi.useFakeTimers();

    onClickCallback({ menuItemId: 'ask-aiside', pageUrl: 'https://example.com' }, { id: 1, windowId: 100 });

    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 100 });
    
    vi.advanceTimersByTime(500);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CONTEXT_MENU_PAGE",
      url: "https://example.com"
    });

    vi.useRealTimers();
  });
});