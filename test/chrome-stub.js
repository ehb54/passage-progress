// Minimal stand-in for the chrome.* APIs content.js uses, so it can be
// exercised on a plain web page. Storage persists in sessionStorage so
// reload behaviour can be checked.
(() => {
  const KEY = '__ppStub';
  const store = JSON.parse(sessionStorage.getItem(KEY) || '{}');
  const persist = () => sessionStorage.setItem(KEY, JSON.stringify(store));
  const L = { msg: [], storage: [] };
  const fire = (ch) => L.storage.forEach((f) => f(ch, 'local'));
  window.__ppLog = [];
  window.__ppStore = store;
  window.__ppSend = (m) => L.msg.forEach((f) => f(m));
  window.chrome = {
    runtime: {
      id: 'stub',
      // set window.__ppZoom = { factor, base } before load to fake page zoom
      sendMessage: (m) =>
        m && m.type === 'get-zoom'
          ? Promise.resolve(window.__ppZoom || null)
          : (window.__ppLog.push(m), Promise.resolve()),
      onMessage: { addListener: (f) => L.msg.push(f), removeListener() {} },
    },
    storage: {
      local: {
        async get(k) {
          if (k == null) return JSON.parse(JSON.stringify(store));
          const out = {};
          for (const key of [].concat(k)) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return out;
        },
        async set(o) {
          const ch = {};
          for (const [k, v] of Object.entries(o)) {
            ch[k] = { oldValue: store[k], newValue: JSON.parse(JSON.stringify(v)) };
            store[k] = JSON.parse(JSON.stringify(v));
          }
          persist();
          fire(ch);
        },
        async remove(ks) {
          const ch = {};
          for (const k of [].concat(ks)) if (k in store) {
            ch[k] = { oldValue: store[k] };
            delete store[k];
          }
          persist();
          if (Object.keys(ch).length) fire(ch);
        },
      },
      onChanged: { addListener: (f) => L.storage.push(f), removeListener() {} },
    },
  };
})();
