// Passage Progress: service worker.
// Owns the context menu, toolbar button, keyboard commands and the per-tab badge.

// The parent item's title doubles as a live readout ("Passage 63% · Page 41%"),
// so the current progress is visible right on the page's right-click menu.
const ROOT = 'pp-root';
const ROOT_TITLE = 'Passage Progress';
const MENU = [
  { id: 'pp-start', title: 'Set passage START here' },
  { id: 'pp-end', title: 'Set passage END here' },
  { id: 'pp-stop', title: 'Mark where we stopped (dated)' },
  { id: 'pp-sep', type: 'separator' },
  { id: 'pp-clear', title: 'Clear passage marks' },
  { id: 'pp-toggle', title: 'Show/hide progress meter' },
];

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: ROOT, title: ROOT_TITLE, contexts: ['all'] });
    for (const m of MENU) chrome.contextMenus.create({ ...m, parentId: ROOT, contexts: ['all'] });
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
    case 'pp-stop':
      send(tab.id, { type: 'mark-context', which: 'stop' });
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
  if (command === 'pick-stop') send(tab.id, { type: 'pick', which: 'stop' });
});

// Page zoom (Cmd/Ctrl +/-). The content script uses this to keep the meter the
// same on-screen size however far the page is zoomed. "base" is the browser's
// default zoom, so a global default zoom setting is still respected.
async function zoomInfo(tabId) {
  const [factor, settings] = await Promise.all([
    chrome.tabs.getZoom(tabId),
    chrome.tabs.getZoomSettings(tabId).catch(() => null),
  ]);
  return { factor, base: (settings && settings.defaultZoomFactor) || 1 };
}

chrome.tabs.onZoomChange.addListener(({ tabId }) => {
  zoomInfo(tabId)
    .then((z) => send(tabId, { type: 'zoom', ...z }))
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'get-zoom' && sender.tab && sender.tab.id != null) {
    zoomInfo(sender.tab.id).then(sendResponse, () => sendResponse(null));
    return true; // async response
  }
  if (msg && msg.type === 'badge' && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: msg.text }).catch(() => {});
    chrome.action
      .setBadgeBackgroundColor({ tabId, color: msg.passage ? '#15803d' : '#475569' })
      .catch(() => {});
    if (sender.tab.active && msg.page != null) {
      setMenuTitle(msg.pass != null ? `Passage ${msg.pass}%  ·  Page ${msg.page}%` : `Page ${msg.page}%`);
    }
  }
});

// ---- keep the menu readout in step with whichever tab is in front

let menuTitle = '';
function setMenuTitle(title) {
  if (title === menuTitle) return;
  menuTitle = title;
  chrome.contextMenus.update(ROOT, { title }, () => void chrome.runtime.lastError);
}

// Show the plain name until the new tab's page reports in (pages where the
// extension can't run never will).
function refresh(tabId) {
  setMenuTitle(ROOT_TITLE);
  send(tabId, { type: 'refresh' });
}

chrome.tabs.onActivated.addListener(({ tabId }) => refresh(tabId));

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs
    .query({ active: true, windowId })
    .then(([t]) => t && t.id != null && refresh(t.id))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' && tab.active) setMenuTitle(ROOT_TITLE);
});
