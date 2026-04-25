import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentTabUrl, onAgentTabClosed, openAgentTab, sendToAgentTab } from './tabs';

describe('agent/tabs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('openAgentTab calls chrome.tabs.create and returns the new tab id', async () => {
    vi.mocked(chrome.tabs.create).mockImplementation(((info, callback) => {
      const tab = { id: 42, url: info.url };
      if (callback) callback(tab);
      return Promise.resolve(tab);
    }) as typeof chrome.tabs.create);
    const id = await openAgentTab('https://example.com');
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      { url: 'https://example.com', active: true },
      expect.any(Function),
    );
    expect(id).toBe(42);
  });

  it('getAgentTabUrl reads tab.url via chrome.tabs.get', async () => {
    vi.mocked(chrome.tabs.get).mockImplementation(((id, callback) => {
      const tab = { id, url: 'https://example.com/page' };
      if (callback) callback(tab);
      return Promise.resolve(tab);
    }) as typeof chrome.tabs.get);
    const url = await getAgentTabUrl(42);
    expect(url).toBe('https://example.com/page');
  });

  it('sendToAgentTab forwards to chrome.tabs.sendMessage', async () => {
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(((id, msg, callback) => {
      const resp = { ok: true, msg };
      if (callback) callback(resp);
      return Promise.resolve(resp);
    }) as typeof chrome.tabs.sendMessage);
    const resp = await sendToAgentTab(42, { type: 'PING' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'PING' }, expect.any(Function));
    expect(resp).toEqual({ ok: true, msg: { type: 'PING' } });
  });

  it('onAgentTabClosed fires only when matching tabId is removed', () => {
    const cb = vi.fn();
    const dispose = onAgentTabClosed(42, cb);
    const listener = vi.mocked(chrome.tabs.onRemoved.addListener).mock.calls[0][0];
    listener(99, { windowId: 0, isWindowClosing: false });
    expect(cb).not.toHaveBeenCalled();
    listener(42, { windowId: 0, isWindowClosing: false });
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
    expect(chrome.tabs.onRemoved.removeListener).toHaveBeenCalledWith(listener);
  });
});
