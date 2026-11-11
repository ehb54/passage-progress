// Passage Progress: content script (top frame only).
//
// Shows a small draggable meter with how far through the page you are, and,
// once you mark a passage start and/or end, how far through that passage you
// are. Marks are anchored to the text itself (not pixel offsets), so they stay
// put when the page reflows, images load, or the window is resized, and they
// are remembered per URL.

(() => {
  if (!(document.documentElement instanceof HTMLElement)) return;

  const HOST_ID = 'passage-progress-host';
  const MAX_SAVED_PAGES = 500;

  // A previous copy may still be in the page (e.g. the extension was reloaded
  // or updated). If it is still alive, keep it; if it is orphaned, replace it.
  const prev = window.__passageProgress;
  if (prev) {
    if (prev.alive()) return;
    try {
      prev.teardown();
    } catch (_) {}
  }
  const stale = document.getElementById(HOST_ID);
  if (stale) stale.remove();

  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  const store = {
    set(obj) {
      try {
        return chrome.storage.local.set(obj).catch(() => {});
      } catch (_) {}
    },
    remove(keys) {
      try {
        return chrome.storage.local.remove(keys).catch(() => {});
      } catch (_) {}
    },
  };

  // ---------------------------------------------------------------- state

  const S = {
    show: false, // set from storage at startup
    pos: null, // { right, bottom } of the pill, px
    key: pageKey(),
    saved: { start: null, end: null }, // serialized anchors (what we store)
    live: { start: null, end: null }, // resolved anchors (DOM references)
    scroller: null,
    picking: null, // 'start' | 'end' | null
    ctx: null, // anchors captured at the last right-click
    badge: '',
    dead: false,
  };

  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const pct = (p) => (p >= 0.995 ? 100 : Math.floor(p * 100));

  function pageKey() {
    return 'marks:' + location.href.split('#')[0];
  }

  // ------------------------------------------------------------- scroller
  // Most pages scroll the window, but many web apps (LMSes, readers, docs
  // sites) scroll an inner element. Track whichever large element the user
  // actually scrolls.

  const docScroller = () => document.scrollingElement || document.documentElement;
  const isDoc = (el) =>
    !el || el === document.scrollingElement || el === document.documentElement || el === document.body;
  const parentOf = (el) => el.parentElement || (el.parentNode && el.parentNode.host) || null;

  function docScrollable() {
    const d = docScroller();
    if (d.scrollHeight - d.clientHeight < 8) return false;
    const oh = getComputedStyle(document.documentElement).overflowY;
    const ob = document.body ? getComputedStyle(document.body).overflowY : 'visible';
    const vo = oh !== 'visible' ? oh : ob; // body overflow propagates to the viewport
    return vo !== 'hidden' && vo !== 'clip';
  }

  function canScroll(el) {
    if (!el || el.nodeType !== 1 || isDoc(el)) return false;
    if (el.scrollHeight - el.clientHeight < 8) return false;
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  function bigEnough(el) {
    const r = el.getBoundingClientRect();
    return r.height >= innerHeight * 0.4 && r.width >= innerWidth * 0.3;
  }

  function findScroller() {
    if (docScrollable()) return docScroller();
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && !isDoc(el)) {
      if (el !== host && canScroll(el) && bigEnough(el)) return el;
      el = parentOf(el);
    }
    return docScroller();
  }

  function onScroll(e) {
    const t = e.target;
    if (t === document || isDoc(t)) {
      if (!isDoc(S.scroller)) S.scroller = docScroller();
    } else if (t !== S.scroller && canScroll(t) && bigEnough(t)) {
      S.scroller = t;
    }
    schedule();
  }

  // Viewport-space geometry of the active scroller.
  function metrics() {
    let s = S.scroller;
    if (!s || !s.isConnected) s = S.scroller = findScroller();
    if (isDoc(s)) {
      const d = docScroller();
      const h = Math.min(innerHeight, d.clientHeight || innerHeight);
      const w = Math.min(innerWidth, d.clientWidth || innerWidth);
      return {
        doc: true, el: d,
        top: 0, bottom: h, left: 0, right: w, height: h,
        contentTop: 0, scrollTop: window.scrollY, scrollHeight: d.scrollHeight,
      };
    }
    const r = s.getBoundingClientRect();
    const contentTop = r.top + s.clientTop;
    return {
      doc: false, el: s,
      top: Math.max(0, contentTop),
      bottom: Math.min(innerHeight, contentTop + s.clientHeight),
      left: Math.max(0, r.left + s.clientLeft),
      right: Math.min(innerWidth, r.left + s.clientLeft + s.clientWidth),
      height: s.clientHeight,
      contentTop, scrollTop: s.scrollTop, scrollHeight: s.scrollHeight,
    };
  }

  // -------------------------------------------------------------- anchors

  function charRect(node, i) {
    if (i < 0 || i >= node.length) return null;
    const r = document.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    for (const rc of r.getClientRects()) if (rc.height > 0) return rc;
    return null;
  }

  // Rect of the line holding character i; whitespace can be box-less, so look
  // at nearby characters too.
  function lineRect(node, i) {
    for (let k = 0; k < 40; k++) {
      const j = i + (k % 2 ? -((k + 1) >> 1) : k >> 1);
      const rc = charRect(node, j);
      if (rc) return rc;
    }
    return null;
  }

  function caretAt(x, y) {
    try {
      if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) return { node: p.offsetNode, offset: p.offset };
      }
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r) return { node: r.startContainer, offset: r.startOffset };
      }
    } catch (_) {}
    return null;
  }

  // The text line under (x, y): { node, i, rc } or null.
  function lineAt(x, y) {
    const c = caretAt(x, y);
    if (!c || !c.node || c.node.nodeType !== 3 || !c.node.length) return null;
    let best = null;
    let bestD = Infinity;
    for (const i of [c.offset, c.offset - 1, c.offset + 1, c.offset - 2]) {
      const rc = charRect(c.node, i);
      if (!rc) continue;
      const d = y < rc.top ? rc.top - y : y > rc.bottom ? y - rc.bottom : 0;
      if (d < bestD) {
        bestD = d;
        best = { node: c.node, i, rc };
      }
      if (d === 0) break;
    }
    return best && bestD <= 30 ? best : null;
  }

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) {
        parts.unshift('#' + el.id);
        break;
      }
      let n = 1;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === el.localName) n++;
      parts.unshift(`${el.localName}:nth-of-type(${n})`);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function blockOf(el) {
    while (el && !isDoc(el)) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith('inline') && d !== 'contents') return el;
      el = parentOf(el);
    }
    return null;
  }

  // Serializable description of a point on the page.
  function makeAnchor(x, y, which) {
    const m = metrics();
    let el = null;
    let textIndex = -1;
    let offset = 0;
    let lineY = y;
    const L = lineAt(x, y);
    if (L && L.node.parentElement) {
      el = L.node.parentElement;
      textIndex = Array.prototype.indexOf.call(el.childNodes, L.node);
      offset = L.i;
      lineY = which === 'start' ? L.rc.top : L.rc.bottom;
    } else {
      el = document.elementsFromPoint(x, y).find((e) => e !== host) || null;
    }
    const a = { docFrac: clamp((lineY - m.contentTop + m.scrollTop) / Math.max(1, m.scrollHeight)) };
    if (el && !isDoc(el) && el.getRootNode() === document) {
      const r = el.getBoundingClientRect();
      a.path = cssPath(el);
      a.snippet = norm(el.textContent);
      a.textIndex = textIndex;
      a.offset = offset;
      a.frac = r.height > 0 ? clamp((lineY - r.top) / r.height) : 0;
    }
    return a;
  }

  // Find the anchored DOM nodes again (after load, reflow, or re-render).
  function resolve(a) {
    if (!a) return null;
    const live = { a, el: null, node: null, block: null, tries: 0 };
    if (a.path) {
      let el = null;
      try {
        el = document.querySelector(a.path);
      } catch (_) {}
      if (el && a.snippet && norm(el.textContent) !== a.snippet) el = null;
      if (el) {
        live.el = el;
        const n = a.textIndex >= 0 ? el.childNodes[a.textIndex] : null;
        if (n && n.nodeType === 3 && n.length > a.offset) live.node = n;
        live.block = blockOf(el);
      }
    }
    return live;
  }

  // Current viewport y of an anchor ('start' = top of its line, 'end' = bottom).
  function liveY(live, which, m) {
    if (live.node && live.node.isConnected) {
      const rc = lineRect(live.node, live.a.offset);
      if (rc) return which === 'start' ? rc.top : rc.bottom;
    }
    if (live.el && live.el.isConnected) {
      const r = live.el.getBoundingClientRect();
      if (r.height > 0) return r.top + (live.a.frac || 0) * r.height;
    }
    return m.contentTop + live.a.docFrac * m.scrollHeight - m.scrollTop;
  }

  // ---------------------------------------------------------------- marks

  function setMark(which, anchor) {
    if (!anchor) return;
    S.saved[which] = anchor;
    S.live[which] = resolve(anchor);
    if (S.live.start && S.live.end) {
      const m = metrics();
      if (liveY(S.live.end, 'end', m) < liveY(S.live.start, 'start', m)) {
        S.saved = { start: S.saved.end, end: S.saved.start };
        S.live = { start: S.live.end, end: S.live.start };
      }
    }
    save();
    schedule();
  }

  function clearMarks() {
    S.saved = { start: null, end: null };
    S.live = { start: null, end: null };
    store.remove(S.key);
    schedule();
  }

  function applySaved(v) {
    v = v || {};
    S.saved = { start: v.start || null, end: v.end || null };
    S.live = { start: resolve(S.saved.start), end: resolve(S.saved.end) };
    schedule();
  }

  function save() {
    if (!S.saved.start && !S.saved.end) return store.remove(S.key);
    store.set({ [S.key]: { start: S.saved.start, end: S.saved.end, t: Date.now() } });
    prune();
  }

  async function prune() {
    try {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith('marks:'));
      if (keys.length <= MAX_SAVED_PAGES) return;
      keys.sort((a, b) => (all[a].t || 0) - (all[b].t || 0));
      store.remove(keys.slice(0, keys.length - MAX_SAVED_PAGES));
    } catch (_) {}
  }

  function gotoStart() {
    const m = metrics();
    const ys = S.live.start ? liveY(S.live.start, 'start', m) : m.contentTop - m.scrollTop;
    const delta = ys - m.top - 40; // leave room for the START label
    (m.doc ? window : m.el).scrollBy({ top: delta, behavior: 'smooth' });
  }

  // ------------------------------------------------------------- progress

  function compute() {
    const m = metrics();
    const max = m.scrollHeight - m.height;
    const page = max <= 1 ? 1 : clamp(m.scrollTop / max);
    const pageLeft = max <= 1 ? 0 : Math.max(0, max - m.scrollTop) / m.height;

    let pass = null;
    if (S.live.start || S.live.end) {
      const startY = S.live.start ? liveY(S.live.start, 'start', m) : null;
      const endY = S.live.end ? liveY(S.live.end, 'end', m) : null;
      // A missing mark means "top of page" / "bottom of page".
      let ys = startY != null ? startY : m.contentTop - m.scrollTop;
      let ye = endY != null ? endY : m.contentTop - m.scrollTop + m.scrollHeight;
      if (ye < ys) [ys, ye] = [ye, ys];
      const T = m.top;
      const B = m.bottom;
      const H = Math.max(1, B - T);
      const span = ye - ys;
      // 0% when the start line is at the top of the view, 100% when the end
      // line reaches the bottom: the same rule as page scroll percentage.
      let p;
      if (span > H) p = clamp((T - ys) / (span - H));
      else p = ye <= B ? 1 : ys >= B ? 0 : clamp((B - ys) / Math.max(1, span));
      pass = { p, left: Math.max(0, ye - B) / H, before: ys > B, after: ye < T, startY, endY };
    }
    return { m, page, pageLeft, pass };
  }

  const toGo = (n) =>
    n < 0.05 ? null : n < 1 ? 'under a screen to go' : `≈ ${n < 10 ? n.toFixed(1) : Math.round(n)} screens to go`;

  // ------------------------------------------------------------------- UI

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .hidden { display: none !important; }

  .mark { position: fixed; height: 0; border-top: 2px dashed; pointer-events: none; display: none; }
  .mark.start { border-color: #16a34a; }
  .mark.end { border-color: #dc2626; }
  .mark span {
    position: absolute; right: 0; padding: 3px 6px; border-radius: 4px; white-space: nowrap;
    font: 700 10px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    letter-spacing: .05em; color: #fff;
  }
  .mark.start span { background: #16a34a; bottom: 2px; }
  .mark.end span { background: #dc2626; top: 0; }

  .guide { position: fixed; left: 0; right: 0; height: 0; border-top: 2px solid #16a34a; pointer-events: none; display: none; }
  .guide.end { border-color: #dc2626; }
  .guide span {
    position: absolute; right: 12px; bottom: 3px; padding: 4px 7px; border-radius: 4px; white-space: nowrap;
    font: 700 11px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; background: #16a34a;
  }
  .guide.end span { background: #dc2626; }

  .topbar { position: fixed; top: 0; left: 0; right: 0; height: 3px; pointer-events: none; }
  .topbar i { display: block; height: 100%; width: 0; background: #60a5fa; }
  .topbar.pass i { background: #22c55e; }

  .pill {
    position: fixed; right: 16px; bottom: 16px; min-width: 172px; max-width: 300px;
    padding: 9px 12px 10px; border-radius: 12px;
    background: rgba(17, 24, 39, .9); color: #f9fafb;
    font: 500 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 6px 20px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .07);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
  }
  .pill.dragging { cursor: grabbing; }
  .row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; column-gap: 12px; }
  .lbl { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: #9ca3af; }
  .pct { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
  .bar { grid-column: 1 / -1; height: 5px; margin-top: 5px; border-radius: 3px; background: rgba(255, 255, 255, .14); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: #60a5fa; }
  .pass .bar i { background: #4ade80; }
  .sub { grid-column: 1 / -1; margin-top: 4px; font-size: 11px; color: #9ca3af; white-space: nowrap; }
  .sub:empty { display: none; }
  .pass { display: none; }
  .has-pass .pass { display: grid; }
  .has-pass .page { margin-top: 8px; }
  .has-pass .page .pct { font-size: 13px; font-weight: 600; color: #d1d5db; }
  .has-pass .page .bar, .has-pass .page .sub { display: none; }

  .tools { display: none; flex-wrap: wrap; gap: 4px; margin-top: 9px; }
  .pill:hover .tools, .pill.picking .tools { display: flex; }
  button {
    all: unset; cursor: pointer; padding: 5px 7px; border-radius: 6px;
    font: 600 11px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e5e7eb; background: rgba(255, 255, 255, .1);
  }
  button:hover { background: rgba(255, 255, 255, .2); }
  button:focus-visible { outline: 2px solid #60a5fa; }
  button.on[data-act="start"] { background: #16a34a; color: #fff; }
  button.on[data-act="end"] { background: #dc2626; color: #fff; }
  .needs-pass { display: none; }
  .has-pass .needs-pass { display: inline-block; }
  button[data-act="hide"] { margin-left: auto; }
  .hint { display: none; margin-top: 7px; font-size: 11px; color: #fde68a; }
  .picking .hint { display: block; }
</style>
<div id="ui" class="hidden">
  <div class="mark start" id="mstart"><span>▼ START</span></div>
  <div class="mark end" id="mend"><span>▲ END</span></div>
  <div class="topbar" id="topbar"><i id="tbar"></i></div>
  <div class="pill" id="pill">
    <div class="row pass">
      <span class="lbl">Passage</span><span class="pct" id="ppct">0%</span>
      <div class="bar"><i id="pbar"></i></div>
      <span class="sub" id="psub"></span>
    </div>
    <div class="row page">
      <span class="lbl">Page</span><span class="pct" id="gpct">0%</span>
      <div class="bar"><i id="gbar"></i></div>
      <span class="sub" id="gsub"></span>
    </div>
    <div class="tools">
      <button data-act="start" title="Then click the line where the passage starts">Set start</button>
      <button data-act="end" title="Then click the line where the passage ends">Set end</button>
      <button data-act="goto" class="needs-pass" title="Scroll to the passage start">Go to start</button>
      <button data-act="clear" class="needs-pass" title="Remove the passage marks">Clear</button>
      <button data-act="hide" title="Hide meter (click the toolbar icon to bring it back)">✕</button>
    </div>
    <div class="hint" id="hint"></div>
  </div>
</div>
<div class="guide" id="guide"><span id="guidelbl"></span></div>`;

  const $ = (id) => root.getElementById(id);
  const ui = $('ui');
  const pill = $('pill');
  const guide = $('guide');
  const els = {
    ppct: $('ppct'), pbar: $('pbar'), psub: $('psub'),
    gpct: $('gpct'), gbar: $('gbar'), gsub: $('gsub'),
    topbar: $('topbar'), tbar: $('tbar'), mstart: $('mstart'), mend: $('mend'),
    hint: $('hint'), guidelbl: $('guidelbl'),
  };
  document.documentElement.appendChild(host);

  const setText = (el, t) => {
    t = t || '';
    if (el.textContent !== t) el.textContent = t;
  };

  function applyShow() {
    ui.classList.toggle('hidden', !S.show);
  }

  function applyPos() {
    if (!S.pos) {
      pill.style.right = pill.style.bottom = '';
      return;
    }
    const r = pill.getBoundingClientRect();
    pill.style.right = clamp(S.pos.right, 0, Math.max(0, innerWidth - r.width)) + 'px';
    pill.style.bottom = clamp(S.pos.bottom, 0, Math.max(0, innerHeight - r.height)) + 'px';
  }

  function placeMark(mk, y, live, m) {
    if (y == null || y < m.top - 1 || y > m.bottom + 1) {
      mk.style.display = 'none';
      return;
    }
    let L = m.left;
    let R = m.right;
    const b = live && live.block && live.block.isConnected ? live.block.getBoundingClientRect() : null;
    if (b && b.width > 40) {
      L = Math.max(L, b.left - 8);
      R = Math.min(R, b.right + 8);
    }
    mk.style.display = 'block';
    mk.style.top = y + 'px';
    mk.style.left = L + 'px';
    mk.style.width = Math.max(40, R - L) + 'px';
  }

  let raf = 0;
  function schedule() {
    if (!raf && !S.dead) raf = requestAnimationFrame(update);
  }

  function update() {
    raf = 0;
    if (!alive()) return teardown();
    const { m, page, pageLeft, pass } = compute();

    setText(els.gpct, pct(page) + '%');
    els.gbar.style.width = page * 100 + '%';
    setText(els.gsub, toGo(pageLeft) || 'end of page');

    pill.classList.toggle('has-pass', !!pass);
    els.topbar.classList.toggle('pass', !!pass);
    let main = page;
    if (pass) {
      main = pass.p;
      setText(els.ppct, pct(pass.p) + '%');
      els.pbar.style.width = pass.p * 100 + '%';
      setText(
        els.psub,
        pass.before
          ? 'passage starts further down ↓'
          : pass.after || pass.p >= 0.995
            ? 'passage finished ✓'
            : toGo(pass.left) || 'end in view'
      );
      placeMark(els.mstart, pass.startY, S.live.start, m);
      placeMark(els.mend, pass.endY, S.live.end, m);
    } else {
      els.mstart.style.display = els.mend.style.display = 'none';
    }
    els.tbar.style.width = main * 100 + '%';

    const badge = pct(main) + '%' + (pass ? '|p' : '');
    if (badge !== S.badge) {
      S.badge = badge;
      try {
        chrome.runtime
          .sendMessage({ type: 'badge', text: pct(main) + '%', passage: !!pass })
          .catch(() => {});
      } catch (_) {}
    }
  }

  // ----------------------------------------------------------- pill drag

  let drag = null;
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = pill.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.right, dy: e.clientY - r.bottom, x0: e.clientX, y0: e.clientY, moved: false };
    pill.setPointerCapture(e.pointerId);
  });
  pill.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    pill.classList.add('dragging');
    S.pos = { right: innerWidth - (e.clientX - drag.dx), bottom: innerHeight - (e.clientY - drag.dy) };
    applyPos();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) store.set({ pillPos: S.pos });
    drag = null;
    pill.classList.remove('dragging');
  };
  pill.addEventListener('pointerup', endDrag);
  pill.addEventListener('pointercancel', endDrag);
  pill.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    S.pos = null; // double-click resets to the corner
    store.remove('pillPos');
    applyPos();
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act;
    if (act === 'start' || act === 'end') S.picking === act ? stopPick() : startPick(act);
    else if (act === 'goto') gotoStart();
    else if (act === 'clear') clearMarks();
    else if (act === 'hide') store.set({ showMeter: false });
  });

  // ------------------------------------------------------- picking a line

  const inOurUI = (e) => e.composedPath().includes(host);
  const PICK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'];
  let pickStyle = null;
  let gpos = null;
  let graf = 0;

  function startPick(which) {
    if (S.picking) stopPick();
    S.picking = which;
    pill.classList.add('picking');
    for (const b of root.querySelectorAll('button[data-act]')) b.classList.toggle('on', b.dataset.act === which);
    const word = which === 'start' ? 'START' : 'END';
    setText(els.hint, `Click the line where the passage ${which === 'start' ? 'starts' : 'ends'}. Esc cancels.`);
    setText(els.guidelbl, `Set ${word} here (Esc cancels)`);
    guide.classList.toggle('end', which === 'end');
    pickStyle = document.createElement('style');
    pickStyle.textContent = 'html.__pp-picking, html.__pp-picking * { cursor: crosshair !important; }';
    (document.head || document.documentElement).appendChild(pickStyle);
    document.documentElement.classList.add('__pp-picking');
    for (const t of PICK_EVENTS) window.addEventListener(t, onPickEvent, true);
    window.addEventListener('mousemove', onPickMove, true);
    window.addEventListener('keydown', onPickKey, true);
  }

  function stopPick() {
    if (!S.picking) return;
    S.picking = null;
    pill.classList.remove('picking');
    for (const b of root.querySelectorAll('button.on')) b.classList.remove('on');
    guide.style.display = 'none';
    document.documentElement.classList.remove('__pp-picking');
    if (pickStyle) pickStyle.remove();
    pickStyle = null;
    for (const t of PICK_EVENTS) window.removeEventListener(t, onPickEvent, true);
    window.removeEventListener('mousemove', onPickMove, true);
    window.removeEventListener('keydown', onPickKey, true);
  }

  function onPickEvent(e) {
    if (inOurUI(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.button === 0) {
      const which = S.picking;
      stopPick();
      setMark(which, makeAnchor(e.clientX, e.clientY, which));
    }
  }

  function onPickMove(e) {
    if (inOurUI(e)) {
      gpos = null;
      guide.style.display = 'none';
      return;
    }
    gpos = { x: e.clientX, y: e.clientY };
    if (!graf) graf = requestAnimationFrame(drawGuide);
  }

  function drawGuide() {
    graf = 0;
    if (!S.picking || !gpos) return;
    const L = lineAt(gpos.x, gpos.y);
    const y = L ? (S.picking === 'start' ? L.rc.top : L.rc.bottom) : gpos.y;
    guide.style.display = 'block';
    guide.style.top = y + 'px';
  }

  function onPickKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      stopPick();
    }
  }

  // Right-click: remember where, so the context-menu items know the spot.
  function onContextMenu(e) {
    if (inOurUI(e)) {
      S.ctx = null;
      return;
    }
    S.ctx = {
      start: makeAnchor(e.clientX, e.clientY, 'start'),
      end: makeAnchor(e.clientX, e.clientY, 'end'),
    };
  }

  // ------------------------------------------------------------- wiring

  function onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'mark-context' && S.ctx) setMark(msg.which, S.ctx[msg.which]);
    else if (msg.type === 'pick') startPick(msg.which);
    else if (msg.type === 'clear') clearMarks();
  }

  function onStorage(ch, area) {
    if (area !== 'local') return;
    if (ch.showMeter) {
      S.show = ch.showMeter.newValue !== false;
      applyShow();
      schedule();
    }
    if (ch.pillPos) {
      S.pos = ch.pillPos.newValue || null;
      applyPos();
    }
    const mk = ch[S.key];
    if (mk) {
      const v = mk.newValue || {};
      const same =
        JSON.stringify(v.start || null) === JSON.stringify(S.saved.start) &&
        JSON.stringify(v.end || null) === JSON.stringify(S.saved.end);
      if (!same) applySaved(v); // same page open in another tab
    }
  }

  const onResize = () => {
    applyPos();
    schedule();
  };
  const onPageShow = (e) => {
    if (e.persisted) {
      S.badge = '';
      schedule();
    }
  };
  const ro = new ResizeObserver(() => schedule());

  function tick() {
    if (!alive()) return teardown();
    if (document.hidden) return;
    if (!host.isConnected) document.documentElement.appendChild(host);
    const k = pageKey();
    if (k !== S.key) {
      // in-page (SPA) navigation: load this URL's marks
      S.key = k;
      applySaved(null);
      chrome.storage.local.get(k).then((v) => k === S.key && applySaved(v[k])).catch(() => {});
    }
    for (const w of ['start', 'end']) {
      const l = S.live[w];
      if (l && l.a.path && (!l.el || !l.el.isConnected) && l.tries < 30) {
        const again = resolve(l.a);
        again.tries = l.tries + 1;
        S.live[w] = again;
      }
    }
    schedule();
  }
  const tickTimer = setInterval(tick, 1000);

  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('pageshow', onPageShow);
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);

  function teardown() {
    if (S.dead) return;
    S.dead = true;
    stopPick();
    clearInterval(tickTimer);
    document.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pageshow', onPageShow);
    ro.disconnect();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
    } catch (_) {}
    host.remove();
    if (window.__passageProgress === api) delete window.__passageProgress;
  }

  const api = { alive, teardown };
  window.__passageProgress = api;

  chrome.storage.local
    .get(['showMeter', 'pillPos', S.key])
    .then((v) => {
      S.show = v.showMeter !== false;
      S.pos = v.pillPos || null;
      applyShow();
      applyPos();
      applySaved(v[S.key]);
    })
    .catch(() => {});
})();
