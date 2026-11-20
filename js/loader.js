/* $NIKO loading screen: key-art panels that wipe in on an angle every few seconds (the series'
   loading-screen manner, with this site's own art), a rotating tip and a slim honest bar.

   Progress blends two sources:
   - THREE.DefaultLoadingManager item counts (textures, small files), and
   - real bytes of the character models from niko.js: 'niko:progress' {key, loaded, total},
     'niko:done' {key, ok}, window.__nikoModels {seat, stand: 'loading'|'ready'|'failed'};
     main.js also fires a plain 'niko:ready' when the character chain settles (used as a backstop).
   Bytes dominate when models are in play. The bar never runs backwards and holds below 100%
   until the page is really ready. It lifts when the manager has gone quiet AND no model is
   still 'loading', with a hard cap of 150 s.
   The head of index.html adds html.is-loading before first paint (skipped for ?t= review and
   reduced motion). ?loadtest=1 fakes a 24 s load and reveals; ?loadtest=hold never lifts. */
(() => {
  'use strict';

  const root = document.documentElement;
  const el = document.getElementById('loader');
  const q = new URLSearchParams(location.search);
  const TEST = q.get('loadtest');               // '1' fake load then reveal, 'hold' fake load and stay
  const CAP = 150000;                           // never hold the page longer than this
  const QUIET = 400;                            // loads arrive in batches: wait this long for a new batch
  const STEP = 4600;                            // panel change interval
  const MB = 1048576;
  const PRIOR = { seat: 71.8e6, stand: 30.3e6 }; // desktop sizes, used only until a real total arrives
  const t0 = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let quietTimer = 0, capTimer = 0, cycleTimer = 0, hintTimer = 0, tick = 0;

  if (window.__ldSafety) { clearTimeout(window.__ldSafety); window.__ldSafety = 0; }

  function lift(immediate) {
    if (lift.done) return; lift.done = true;
    [quietTimer, capTimer, cycleTimer, hintTimer].forEach(clearTimeout); clearInterval(tick);
    if (!el) { root.classList.remove('is-loading'); return; }
    const end = () => {
      if (end.done) return; end.done = true;
      root.classList.remove('is-loading', 'is-lifting');
      el.hidden = true;
      el.setAttribute('aria-busy', 'false');
      window.dispatchEvent(new Event('loader:done'));
    };
    // a fast (cached) load ends before the art has even faded in: just go, no wipe
    const early = performance.now() - t0 < 700;
    if (immediate || reduced || early || !root.classList.contains('is-loading')) { end(); return; }
    root.classList.add('is-lifting');
    el.addEventListener('transitionend', e => { if (e.target === el) end(); }, { once: true });
    setTimeout(end, 1400);   // in case transitionend never fires
  }

  if (!root.classList.contains('is-loading') || !el || !window.THREE || !THREE.DefaultLoadingManager) { lift(true); return; }
  capTimer = setTimeout(() => lift(false), CAP);

  /* ---------- panels ---------- */
  const panels = [...el.querySelectorAll('.ld-panel')];
  const cap = el.querySelector('.ld-cap'), capN = el.querySelector('.ld-cap-n'), capT = el.querySelector('.ld-cap-t');
  const phone = matchMedia('(max-width: 700px)').matches;
  const ready = panels.map((p, i) => i === 0);
  let cur = 0;
  function loadPanels() {   // the first panel is in the markup (and preloaded); the rest load behind it
    if (loadPanels.started) return; loadPanels.started = true;
    panels.forEach((p, i) => {
      if (i === 0) return;
      const img = new Image();
      img.alt = ''; img.decoding = 'async';
      img.onload = () => { (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => { p.appendChild(img); ready[i] = true; }); };
      img.src = phone ? p.dataset.m : p.dataset.d;
    });
  }
  function swap(node) { node.classList.remove('is-swap'); void node.offsetWidth; node.classList.add('is-swap'); }
  function show(i) {
    const prev = panels[cur];
    panels.forEach(p => p.classList.remove('is-off'));
    prev.classList.remove('is-on', 'is-first'); prev.classList.add('is-off');
    panels[i].classList.add('is-on');
    cur = i;
    clearTimeout(show.t); show.t = setTimeout(() => prev.classList.remove('is-off'), 1150);   // the old panel would otherwise peek past the angled edge
    capN.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(panels.length).padStart(2, '0');
    capT.textContent = panels[i].dataset.cap;
    swap(cap);
  }
  function cycle() {
    cycleTimer = setTimeout(() => {
      for (let k = 1; k < panels.length; k++) { const i = (cur + k) % panels.length; if (ready[i]) { if (i !== cur) show(i); break; } }
      cycle();
    }, STEP);
  }

  /* ---------- tips ---------- */
  const hint = el.querySelector('.ld-hint'), hintText = hint && hint.querySelector('span');
  const TIPS = [
    'Scroll to move through the film. It plays at your pace.',
    'Scroll back up to rewind. Nothing is missed.',
    'Space, the arrow keys and Page Down move the film too.',
    'The first visit downloads the city and the man. After that it is cached.',
    'The $NIKO token waits at the end of the film.'
  ];
  let tipI = 0;
  function tips() {
    hintTimer = setTimeout(() => {
      tipI = (tipI + 1) % TIPS.length; hintText.textContent = TIPS[tipI]; swap(hint); tips();
    }, 6200);
  }

  if (!reduced) {
    if (document.readyState === 'complete') loadPanels(); else window.addEventListener('load', loadPanels, { once: true });
    // and start them earlier anyway if the page load drags on (it does: the models are large)
    setTimeout(loadPanels, 1500);
    cycle();
    if (hintText) tips();
  }

  /* ---------- progress ---------- */
  const bar = el.querySelector('.loader-bar i');
  const pct = el.querySelector('.loader-pct');
  const label = el.querySelector('.ld-label');
  let shown = 0, started = false, quiet = false, nikoReady = false, errors = 0;
  let items = 0;                        // manager fraction, monotone
  const bytes = {};                     // key -> {loaded, total, done}
  const models = () => window.__nikoModels || null;

  function modelsPending() {
    const m = models();
    if (m) return Object.keys(m).some(k => m[k] === 'loading') && !nikoReady;
    return !!window.NikoBody && !nikoReady;        // character script present but no status object: wait for niko:ready
  }
  function byteState() {
    const m = models(); const keys = new Set(Object.keys(m || {}).concat(Object.keys(bytes)));
    if (!keys.size) return null;
    // scale the desktop priors by whatever real total we already know (phones load far less)
    let scale = 1;
    for (const k of keys) { const b = bytes[k]; if (b && b.total && PRIOR[k]) { scale = b.total / PRIOR[k]; break; } }
    let l = 0, t = 0;
    for (const k of keys) {
      const b = bytes[k] || { loaded: 0, total: 0 };
      const done = b.done || (m && m[k] && m[k] !== 'loading') || nikoReady;
      let tot = b.total || Math.max(b.loaded * 1.15, (PRIOR[k] || 20e6) * scale);
      tot = Math.max(tot, b.loaded);
      t += tot; l += done ? tot : b.loaded;
    }
    return { l, t, f: t ? l / t : 0 };
  }
  function target() {
    const b = byteState();
    let f = b ? 0.12 * items + 0.88 * b.f : items;
    if (!isFinished()) f = Math.min(f, 0.97);      // never sit at 100% while still waiting
    return { f, b };
  }
  function setProgress(f) {
    f = Math.max(shown, Math.min(1, f));           // totals grow as files are requested: never run backwards
    shown = f;
    if (bar) bar.style.transform = 'scaleX(' + f.toFixed(4) + ')';
    if (pct) pct.textContent = String(Math.floor(f * 100)).padStart(2, '0') + '%';
  }
  function render() {
    if (TEST || lift.done) return;
    const { f, b } = target();
    setProgress(f);
    if (label) {
      if (b && b.t > 4 * MB && !isFinished()) label.textContent = 'Vice City · ' + (b.l / MB).toFixed(b.l < 10 * MB ? 1 : 0) + ' / ' + Math.round(b.t / MB) + ' MB';
      else label.textContent = errors ? 'Rolling with what we have' : 'Loading Vice City';
    }
  }
  function isFinished() { return quiet && !modelsPending(); }

  function finish() {
    if (lift.done || TEST) return;
    if (!isFinished()) return;
    render(); setProgress(1);
    if (label) label.textContent = 'Ready';
    // let the bar land, then hand over
    setTimeout(() => lift(false), performance.now() - t0 < 700 ? 0 : 520);
  }
  function settle() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { quiet = true; (window.__nikoLoad || {}).settled = Math.round(performance.now()); finish(); }, QUIET);
  }

  window.addEventListener('niko:progress', e => {
    const d = e.detail || {}; const k = d.key || d.url || 'model';
    const b = bytes[k] || (bytes[k] = { loaded: 0, total: 0, done: false });
    b.loaded = d.loaded || 0; if (d.total) b.total = d.total;   // a fallback file restarts its key: shown progress still never drops
    started = true; render();
  });
  window.addEventListener('niko:done', e => {
    const d = e.detail || {}; if (!d.key) return;
    const b = bytes[d.key] || (bytes[d.key] = { loaded: 0, total: 0, done: false });
    b.done = true; if (!d.ok) errors++; render(); finish();
  });
  window.addEventListener('niko:ready', () => { nikoReady = true; render(); finish(); });

  const log = window.__nikoLoad = { loads: [], settled: 0, bytes };      // read-only trace for review
  const m = THREE.DefaultLoadingManager;
  const prev = { onStart: m.onStart, onProgress: m.onProgress, onLoad: m.onLoad, onError: m.onError };
  const track = (loaded, total) => { if (total) items = Math.min(1, loaded / total); };
  m.onStart = function (url, loaded, total) {
    if (prev.onStart) prev.onStart.apply(this, arguments);
    started = true; quiet = false; clearTimeout(quietTimer); track(loaded, total); render();
  };
  m.onProgress = function (url, loaded, total) {
    if (prev.onProgress) prev.onProgress.apply(this, arguments);
    started = true; quiet = false; clearTimeout(quietTimer); track(loaded, total); render();
  };
  m.onLoad = function () {
    if (prev.onLoad) prev.onLoad.apply(this, arguments);
    log.loads.push(Math.round(performance.now())); items = 1; render(); settle();
  };
  m.onError = function () {
    if (prev.onError) prev.onError.apply(this, arguments);
    errors++;
  };
  tick = setInterval(render, 250);

  // the film scripts run right after this one; once they have, we know whether WebGL came up
  const check = () => {
    if (TEST) return;
    if (!root.classList.contains('film')) { lift(true); return; }   // no WebGL or reduced motion: the static page needs no loader
    if (!started) {
      // nothing requested yet: give the page until window load, then call it quiet if still idle
      const idle = () => { if (!started) { quiet = true; finish(); } };
      if (document.readyState === 'complete') setTimeout(idle, QUIET); else window.addEventListener('load', () => setTimeout(idle, QUIET), { once: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check, { once: true }); else setTimeout(check, 0);

  /* ---------- ?loadtest: hold the screen open with fake, uneven progress ---------- */
  if (TEST) {
    clearTimeout(capTimer);
    const DUR = 24000; let fake = 0;
    const fakeTick = setInterval(() => {
      const t = (performance.now() - t0) / DUR;
      fake = Math.min(TEST === 'hold' ? 0.97 : 1, t < 1 ? t * (0.85 + 0.15 * Math.sin(t * 9)) : 1);
      setProgress(Math.min(fake, 0.97));
      if (label) label.textContent = 'Vice City · ' + Math.round(fake * 102) + ' / 102 MB';
      if (TEST !== 'hold' && t >= 1.02) {
        clearInterval(fakeTick); setProgress(1); if (label) label.textContent = 'Ready';
        setTimeout(() => lift(false), 520);
      }
    }, 200);
  }

  // review hooks
  window.__loader = { lift: () => lift(false), next: () => show((cur + 1) % panels.length), progress: () => shown };
})();
