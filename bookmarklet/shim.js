// Stand-in for the chrome.* APIs content.js uses, for the bookmarklet build.
// tools/build.py inlines this ahead of content.js inside one function, so the
// `chrome` below shadows the browser's own.
//
// - storage.local: the site's localStorage (marks + meter position persist per
//   site). The show/hide state is not persisted: clicking the bookmark always
//   means "show it".
// - zoom: estimated from outerWidth / innerWidth, snapped to the browser's zoom
//   steps; anything that doesn't look like a clean zoom step counts as 100%
//   (e.g. a side panel open next to the page).
const chrome = (() => {
  const LS_KEY = '__passageProgress';
  const mem = { showMeter: true };
  const storageListeners = [];
  const messageListeners = [];

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  };
  const persist = (d) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(d));
    } catch (_) {}
  };
  const fire = (ch) => storageListeners.forEach((f) => f(ch, 'local'));

  const local = {
    async get(keys) {
      const all = Object.assign(load(), mem);
      if (keys == null) return all;
      const out = {};
      for (const k of [].concat(keys)) if (k in all) out[k] = all[k];
      return out;
    },
    async set(obj) {
      const d = load();
      const ch = {};
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        ch[k] = { oldValue: k in mem ? mem[k] : d[k], newValue: v };
        if (k in mem) mem[k] = v;
        else d[k] = v;
      }
      persist(d);
      fire(ch);
    },
    async remove(keys) {
      const d = load();
      const ch = {};
      for (const k of [].concat(keys)) {
        if (k in d) {
          ch[k] = { oldValue: d[k] };
          delete d[k];
        }
      }
      persist(d);
      if (Object.keys(ch).length) fire(ch);
    },
  };

  const LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  function estimateZoom() {
    const r = window.outerWidth / window.innerWidth;
    if (!(r > 0) || !isFinite(r)) return 1;
    let best = 1;
    let err = Infinity;
    for (const l of LEVELS) {
      const e = Math.abs(l - r) / l;
      if (e < err) {
        err = e;
        best = l;
      }
    }
    return err < 0.015 ? best : 1;
  }
  let lastZoom = estimateZoom();
  window.addEventListener('resize', () => {
    const z = estimateZoom();
    if (z === lastZoom) return;
    lastZoom = z;
    messageListeners.forEach((f) => f({ type: 'zoom', factor: z, base: 1 }));
  });

  return {
    runtime: {
      id: 'bookmarklet',
      sendMessage(m) {
        if (m && m.type === 'get-zoom') return Promise.resolve({ factor: estimateZoom(), base: 1 });
        return Promise.resolve(); // badge updates: no toolbar button here
      },
      onMessage: {
        addListener: (f) => messageListeners.push(f),
        removeListener: (f) => {
          const i = messageListeners.indexOf(f);
          if (i >= 0) messageListeners.splice(i, 1);
        },
      },
    },
    storage: {
      local,
      onChanged: {
        addListener: (f) => storageListeners.push(f),
        removeListener: (f) => {
          const i = storageListeners.indexOf(f);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },
  };
})();
