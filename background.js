// Passage Progress: service worker.
// Owns the context menu, toolbar button, keyboard commands and the per-tab badge.

// The parent item's title doubles as a live readout ("Passage 63% · Page 41%"),
// so the current progress is visible right on the page's right-click menu.
const ROOT = 'pp-root';
const ROOT_TITLE = 'Passage Progress';
const MENU = [
  // title/enabled follow the page in front: see setResumeItem()
  { id: 'pp-resume', title: 'Resume where we stopped', enabled: false },
  { id: 'pp-sep0', type: 'separator' },
  { id: 'pp-start', title: 'Set passage START here' },
  { id: 'pp-end', title: 'Set passage END here' },
  { id: 'pp-stop', title: 'Mark where we stopped (dated)' },
  { id: 'pp-sep', type: 'separator' },
  { id: 'pp-clear', title: 'Clear passage marks' },
  { id: 'pp-toggle', title: 'Show/hide progress meter' },
  { id: 'pp-list', title: 'Saved readings…' },
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
    case 'pp-resume':
      send(tab.id, { type: 'resume' });
      break;
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
    case 'pp-list':
      chrome.tabs.create({ url: chrome.runtime.getURL('readings.html'), index: tab.index + 1 });
      break;
  }
});

// The toolbar button opens the saved-readings popup (readings.html); the
// meter's show/hide switch lives there, and on Alt+Shift+P.

// ---- open a saved reading where the group stopped

const PENDING_MS = 2 * 60 * 1000;

// Switch to the page if it's already open; otherwise open it and leave a
// "resume" note that the page's content script collects once it has loaded.
async function openReading(url) {
  if (!/^(https?|file):/i.test(url)) return;
  const tabs = await chrome.tabs.query({});
  const open = tabs.find((t) => t.url && t.url.split('#')[0] === url);
  if (open) {
    await chrome.tabs.update(open.id, { active: true });
    chrome.windows.update(open.windowId, { focused: true }).catch(() => {});
    send(open.id, { type: 'resume' });
    return;
  }
  await chrome.storage.session.set({ ['pending:' + url]: Date.now() });
  await chrome.tabs.create({ url });
}

async function takePending(url) {
  const key = 'pending:' + url;
  const got = await chrome.storage.session.get(key);
  if (!got[key]) return false;
  await chrome.storage.session.remove(key);
  return Date.now() - got[key] < PENDING_MS;
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-meter') return toggleMeter();
  if (!tab || tab.id == null) return;
  if (command === 'pick-start') send(tab.id, { type: 'pick', which: 'start' });
  if (command === 'pick-end') send(tab.id, { type: 'pick', which: 'end' });
  if (command === 'pick-stop') send(tab.id, { type: 'pick', which: 'stop' });
  if (command === 'resume') send(tab.id, { type: 'resume' });
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
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === 'open-reading' && typeof msg.url === 'string') {
    openReading(msg.url).then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (msg && msg.type === 'get-pending' && typeof msg.url === 'string') {
    takePending(msg.url).then((resume) => sendResponse({ resume }), () => sendResponse(null));
    return true;
  }
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
      setResumeItem(msg.stopT, msg.hasStart);
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

// "Resume where we stopped (Tue, Nov 11, 3:40 PM)" for the page in front;
// "Go to passage start" when it has a passage but no stop; greyed out otherwise.
let resumeState = '';
function setResumeItem(stopT, hasStart) {
  let props;
  if (stopT) {
    const when = new Date(stopT).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    props = { title: `Resume where we stopped (${when})`, enabled: true };
  } else if (hasStart) {
    props = { title: 'Go to passage start', enabled: true };
  } else {
    props = { title: 'Resume where we stopped', enabled: false };
  }
  const key = props.title + '|' + props.enabled;
  if (key === resumeState) return;
  resumeState = key;
  chrome.contextMenus.update('pp-resume', props, () => void chrome.runtime.lastError);
}

// Show the plain name until the new tab's page reports in (pages where the
// extension can't run never will).
function refresh(tabId) {
  setMenuTitle(ROOT_TITLE);
  setResumeItem(null, false);
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
  if (info.status === 'loading' && tab.active) {
    setMenuTitle(ROOT_TITLE);
    setResumeItem(null, false);
  }
});
