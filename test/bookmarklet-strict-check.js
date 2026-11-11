// Checks for bookmarklet-strict.html (run with tools/run_selftest.py).
(async () => {
  const out = [];
  const ok = (name, cond, extra) =>
    out.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await sleep(300);
  ok('Trusted Types is enforced on this page', /enforced/.test(window.__ttStatus), window.__ttStatus);
  const host = document.getElementById('passage-progress-host');
  ok('meter injected', !!host);
  const R = host.shadowRoot;
  ok('styles applied via constructed stylesheet', R.adoptedStyleSheets.length === 1);
  const pill = R.getElementById('pill');
  ok('meter visible and styled', pill.offsetWidth > 100 && getComputedStyle(pill).position === 'fixed', pill.offsetWidth);
  window.scrollTo(0, (document.scrollingElement.scrollHeight - innerHeight) / 2);
  await frame(); await frame();
  ok('page % tracks scrolling', R.getElementById('gpct').textContent === '50%', R.getElementById('gpct').textContent);
  // stop marker via the meter, saved in the site's localStorage
  pill.querySelector('button[data-act=stop]').click();
  const p = document.getElementById('b40');
  p.scrollIntoView({ block: 'center' }); await frame();
  const r = p.getBoundingClientRect();
  document.elementFromPoint(r.left + 40, r.top + 10)
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: r.left + 40, clientY: r.top + 10, button: 0 }));
  await frame(); await frame();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('__passageProgress'))['marks:' + location.href.split('#')[0]]; } catch (_) {}
  ok('stop marker saved in site localStorage', saved && saved.stops && saved.stops.length === 1);
  ok('stop marker drawn', R.getElementById('stops').children.length === 1);
  // clicking the bookmark again toggles the meter
  window.__passageProgress.toggle(); await frame();
  ok('second click hides the meter', R.getElementById('ui').classList.contains('hidden'));
  window.__passageProgress.toggle(); await frame();
  ok('third click shows it again', !R.getElementById('ui').classList.contains('hidden'));
  localStorage.removeItem('__passageProgress');
  const text = out.join('\n');
  fetch('/__selftest_result?r=' + encodeURIComponent(text)).catch(() => {});
})().catch((e) => fetch('/__selftest_result?r=' + encodeURIComponent('ERROR ' + e.stack)));
