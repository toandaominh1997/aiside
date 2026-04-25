chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "ask-aiside",
    title: "Ask Aiside about this",
    contexts: ["selection", "page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "ask-aiside") {
    if (tab && tab.id) {
      // First, make sure the side panel is open in this window
      chrome.sidePanel.open({ windowId: tab.windowId });
      
      // Delay slightly to give the panel time to load if it wasn't already open
      setTimeout(() => {
        if (info.selectionText) {
          chrome.runtime.sendMessage({ type: "CONTEXT_MENU_SELECTION", text: info.selectionText });
        } else if (info.pageUrl) {
          chrome.runtime.sendMessage({ type: "CONTEXT_MENU_PAGE", url: info.pageUrl });
        }
      }, 500);
    }
  }
});