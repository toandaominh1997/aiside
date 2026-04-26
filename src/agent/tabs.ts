export async function openAgentTab(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (typeof tab?.id !== 'number') {
        reject(new Error('chrome.tabs.create returned no tab id'));
        return;
      }
      resolve(tab.id);
    });
  });
}

export async function getAgentTabUrl(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab?.url ?? '');
    });
  });
}

export async function navigateAgentTab(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

export async function sendToAgentTab<T = unknown>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (resp: T) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || '';
        if (errorMsg.includes('Receiving end does not exist') || errorMsg.includes('Could not establish connection')) {
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(`Failed to inject content script: ${chrome.runtime.lastError.message}`));
              return;
            }
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, message, (retryResp: T) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve(retryResp);
              });
            }, 100);
          });
        } else {
          reject(new Error(errorMsg));
        }
        return;
      }
      resolve(resp);
    });
  });
}

export function onAgentTabClosed(tabId: number, cb: () => void): () => void {
  const listener = (id: number) => {
    if (id === tabId) cb();
  };
  chrome.tabs.onRemoved.addListener(listener);
  return () => chrome.tabs.onRemoved.removeListener(listener);
}
