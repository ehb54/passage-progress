// Passage Progress: service worker.
// Owns the context menu, toolbar button, keyboard commands and the per-tab badge.

const MENU = [
  { id: 'pp-start', title: 'Set passage START here' },
  { id: 'pp-end', title: 'Set passage END here' },
  { id: 'pp-sep', type: 'separator' },
  { id: 'pp-clear', title: 'Clear passage marks' },
  { id: 'pp-toggle', title: 'Show/hide progress meter' },
];

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENU) chrome.contextMenus.create({ ...m, contexts: ['all'] });
  });

  // Content scripts only load into tabs opened after install; inject into the
  // tabs that are already open so the meter shows up without a reload.
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.id || !/^(https?|file):/.test(t.url || '')) continue;
    chrome.scripting
      .executeScript({ target: { tabId: t.id }, files: ['content.js'] })
      .catch(() => {});
  }
});

try {
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
} catch (_) {
  /* older Chrome */
}

function send(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});
}

async function toggleMeter() {
  const { showMeter = true } = await chrome.storage.local.get('showMeter');
  await chrome.storage.local.set({ showMeter: !showMeter });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id == null) return;
  switch (info.menuItemId) {
    case 'pp-start':
      send(tab.id, { type: 'mark-context', which: 'start' });
      break;
    case 'pp-end':
      send(tab.id, { type: 'mark-context', which: 'end' });
      break;
    case 'pp-clear':
      send(tab.id, { type: 'clear' });
      break;
    case 'pp-toggle':
      toggleMeter();
      break;
  }
});

chrome.action.onClicked.addListener(() => toggleMeter());

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-meter') return toggleMeter();
  if (!tab || tab.id == null) return;
  if (command === 'pick-start') send(tab.id, { type: 'pick', which: 'start' });
  if (command === 'pick-end') send(tab.id, { type: 'pick', which: 'end' });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'badge' && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: msg.text }).catch(() => {});
    chrome.action
      .setBadgeBackgroundColor({ tabId, color: msg.passage ? '#15803d' : '#475569' })
      .catch(() => {});
  }
});
