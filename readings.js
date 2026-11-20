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
  const expanded = new Set(); // pages whose stop history is shown (this visit only)

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

  // ⌘/Ctrl/Shift-click or middle-click always opens a new tab, even if the
  // page is already open somewhere.
  function onOpen(el, go) {
    el.addEventListener('click', (e) => go(e.metaKey || e.ctrlKey || e.shiftKey));
    el.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault()); // no autoscroll
    el.addEventListener('auxclick', (e) => e.button === 1 && go(true));
  }

  // A × that asks once ("Remove?") before doing anything.
  function confirmButton(cls, label, title, ask, onConfirm) {
    const b = h('button', { class: cls, title, 'aria-label': title }, label);
    const reset = () => {
      b.classList.remove('confirm');
      b.textContent = label;
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = ask;
        return;
      }
      onConfirm();
    });
    b.addEventListener('mouseleave', reset);
    b.addEventListener('blur', reset);
    return b;
  }

  const NEW_TAB_HINT = '⌘/Ctrl-click or middle-click: in a new tab';

  function entry(it) {
    const last = it.stops[it.stops.length - 1];
    const action = last ? 'Open where you stopped' : 'Open at the passage start';
    const open = h('button', { class: 'open', title: action + '\n' + NEW_TAB_HINT + '\n' + it.url },
      h('div', { class: 'title' }, it.title || describeUrl(it.url)),
      h('div', { class: 'meta' }, (it.title ? describeUrl(it.url) + ' · ' : '') + timeOnly(it.t)),
      h('div', { class: 'tags' },
        last && h('span', { class: 'tag stop' }, '⏸ Stopped ' + fmtTime(last.t)),
        it.hasPass && h('span', { class: 'tag pass' }, 'Passage marked')));
    onOpen(open, (newTab) => openReading(it.url, newTab));

    const del = confirmButton('del', '×', 'Forget this page’s marks', 'Remove?',
      () => chrome.storage.local.remove(it.key));

    const box = h('div', { class: 'entry' }, open, del);
    // Stop history: hidden by default; offered for pages with more than one
    // stop (and kept open while you delete them down to the last one).
    const n = it.stops.length;
    if (n > 1 || (n && expanded.has(it.key))) {
      const histId = 'hist-' + encodeURIComponent(it.key);
      const toggle = h('button', { class: 'hist-toggle', 'aria-controls': histId });
      let hist = null;
      const show = (on) => {
        toggle.setAttribute('aria-expanded', String(on));
        toggle.title = on ? 'Hide the stop history' : 'Show every stop on this page, to go back to an earlier one or delete it';
        toggle.textContent = (on ? '▾ ' : '▸ ') + n + (n === 1 ? ' stop' : ' stops');
        if (on && !hist) box.append((hist = stopHistory(it, histId)));
        if (!on && hist) (hist.remove(), (hist = null));
      };
      toggle.addEventListener('click', () => {
        const on = !expanded.has(it.key);
        if (on) expanded.add(it.key);
        else expanded.delete(it.key);
        show(on);
      });
      box.append(toggle);
      show(expanded.has(it.key));
    }
    return box;
  }

  function stopHistory(it, id) {
    const rows = [...it.stops].sort((a, b) => b.t - a.t).map((s, i) => {
      const go = h('button', { class: 'hopen', title: 'Open at this stop\n' + NEW_TAB_HINT },
        h('span', { class: 'when' }, '⏸ ' + fmtTime(s.t)),
        i === 0 && h('span', { class: 'latest' }, 'latest'),
        s.snippet && h('span', { class: 'snip' }, '“' + s.snippet + (s.snippet.length >= 60 ? '…”' : '”')));
      onOpen(go, (newTab) => openReading(it.url, newTab, s.t));
      const del = confirmButton('hdel', '×', 'Delete this stop', 'Delete?', () => deleteStop(it.key, s.t));
      return h('li', { class: 'hrow' }, go, del);
    });
    return h('ol', { class: 'hist', id }, ...rows);
  }

  // Removes one stop. The page's date in the list is left alone, so it doesn't
  // jump around while you tidy its history; an open copy of the page updates.
  async function deleteStop(key, t) {
    const cur = (await chrome.storage.local.get(key))[key];
    if (!cur) return;
    const stops = (Array.isArray(cur.stops) ? cur.stops : []).filter((s) => s && s.t !== t);
    if (!stops.length && !cur.start && !cur.end) await chrome.storage.local.remove(key);
    else await chrome.storage.local.set({ [key]: { ...cur, stops } });
  }

  async function openReading(url, newTab, stopT) {
    try {
      await chrome.runtime.sendMessage({ type: 'open-reading', url, newTab: !!newTab, stopT: stopT || null });
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
