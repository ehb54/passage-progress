// Passage Progress: saved-readings list (toolbar popup, or a full tab).
// Lists every page with passage marks or "stopped here" markers, newest
// first, grouped by day. Clicking one asks the background to open (or switch
// to) the page and jump to where the group stopped.

(() => {
  const isPopup =
    /[?&]popup\b/.test(location.search) ||
    (!!chrome.extension && typeof chrome.extension.getViews === 'function' &&
      chrome.extension.getViews({ type: 'popup' }).includes(window));
  document.body.classList.toggle('popup', isPopup);

  const listEl = document.getElementById('list');
  const searchEl = document.getElementById('search');
  const showEl = document.getElementById('show-meter');
  let items = [];

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    el.append(...kids.filter((k) => k != null && k !== false));
    return el;
  }

  const fmtTime = (t) =>
    new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const timeOnly = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  function dayLabel(t) {
    const d = new Date(t);
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((start(new Date()) - start(d)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    const opts = { weekday: 'long', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function describeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'file:' ? decodeURIComponent(u.pathname.split('/').pop() || u.pathname) : u.host + (u.pathname === '/' ? '' : u.pathname);
    } catch (_) {
      return url;
    }
  }

  async function load() {
    const all = await chrome.storage.local.get(null);
    showEl.checked = all.showMeter !== false;
    items = Object.keys(all)
      .filter((k) => k.startsWith('marks:'))
      .map((k) => {
        const v = all[k] || {};
        const stops = Array.isArray(v.stops) ? v.stops.filter((s) => s && s.t) : [];
        return {
          key: k,
          url: k.slice('marks:'.length),
          title: v.title || '',
          t: v.t || (stops.length ? stops[stops.length - 1].t : 0),
          stops,
          hasPass: !!(v.start || v.end),
        };
      })
      .filter((it) => it.hasPass || it.stops.length)
      .sort((a, b) => b.t - a.t);
    render();
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const shown = q ? items.filter((it) => (it.title + ' ' + it.url).toLowerCase().includes(q)) : items;
    const kids = [];
    let lastDay = null;
    for (const it of shown) {
      const day = dayLabel(it.t);
      if (day !== lastDay) {
        kids.push(h('div', { class: 'day' }, day));
        lastDay = day;
      }
      kids.push(entry(it));
    }
    if (!items.length) {
      kids.push(h('p', { class: 'empty' },
        'No saved pages yet. Mark a passage, or leave a “Stopped here” marker, on any page and it will be listed here.'));
    } else if (!shown.length) {
      kids.push(h('p', { class: 'empty' }, 'No saved pages match.'));
    }
    listEl.replaceChildren(...kids);
  }

  function entry(it) {
    const last = it.stops[it.stops.length - 1];
    const action = last ? 'Open where you stopped' : 'Open at the passage start';
    const open = h('button', { class: 'open', title: action + '\n⌘/Ctrl-click or middle-click: in a new tab\n' + it.url },
      h('div', { class: 'title' }, it.title || describeUrl(it.url)),
      h('div', { class: 'meta' }, (it.title ? describeUrl(it.url) + ' · ' : '') + timeOnly(it.t)),
      h('div', { class: 'tags' },
        last && h('span', { class: 'tag stop' },
          '⏸ Stopped ' + fmtTime(last.t) + (it.stops.length > 1 ? ' · ' + it.stops.length + ' stops' : '')),
        it.hasPass && h('span', { class: 'tag pass' }, 'Passage marked')));
    // ⌘/Ctrl/Shift-click or middle-click always opens a new tab, even if the
    // page is already open somewhere.
    open.addEventListener('click', (e) => openReading(it.url, e.metaKey || e.ctrlKey || e.shiftKey));
    open.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault()); // no autoscroll
    open.addEventListener('auxclick', (e) => e.button === 1 && openReading(it.url, true));

    const del = h('button', { class: 'del', title: 'Forget this page’s marks', 'aria-label': 'Forget this page’s marks' }, '×');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm');
        del.textContent = 'Remove?';
        return;
      }
      await chrome.storage.local.remove(it.key);
    });
    del.addEventListener('mouseleave', () => {
      del.classList.remove('confirm');
      del.textContent = '×';
    });
    del.addEventListener('blur', () => {
      del.classList.remove('confirm');
      del.textContent = '×';
    });
    return h('div', { class: 'entry' }, open, del);
  }

  async function openReading(url, newTab) {
    try {
      await chrome.runtime.sendMessage({ type: 'open-reading', url, newTab: !!newTab });
    } catch (_) {}
    if (isPopup) window.close();
  }

  searchEl.addEventListener('input', render);
  showEl.addEventListener('change', () => chrome.storage.local.set({ showMeter: showEl.checked }));
  document.getElementById('open-tab').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('readings.html') });
    window.close();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && Object.keys(ch).some((k) => k.startsWith('marks:') || k === 'showMeter')) load();
  });

  load();
  if (!isPopup) searchEl.focus();
})();
