/* Fraud Twin web deck: navigation, Morph-like shared elements, click steps, count-up. No libraries. */
(() => {
  'use strict';
  const W = 1920, H = 1080;
  const EASE = 'cubic-bezier(.16,1,.3,1)';      // appearances
  const MORPH = 'cubic-bezier(.65,0,.25,1)';    // shared elements travelling between slides
  const MORPH_MS = 1000;
  const stage = document.getElementById('stage');
  const slides = [...stage.querySelectorAll('.s')];
  const clicks = slides.map(s => +s.dataset.clicks || 0);
  const bar = document.querySelector('#bar i');
  const num = document.getElementById('num');
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = rm.matches;
  rm.addEventListener('change', () => { reduced = rm.matches; });

  let cur = 0, step = 0, mobile = false;
  let running = [];          // {anims:[], done:fn}
  const counters = new Set();

  const items = s => [...s.querySelectorAll(':scope > .i')];
  const stepOf = el => +(el.dataset.step || 0);
  const totalStates = clicks.reduce((a, c) => a + c + 1, 0);
  const stateIndex = (i, c) => clicks.slice(0, i).reduce((a, x) => a + x + 1, 0) + c;

  /* ---------- count-up ---------- */
  function parseCount(t) {
    const m = t.match(/^(\d+(?:,\d+)?)(.*)$/s);
    return { v: parseFloat(m[1].replace(',', '.')), dec: (m[1].split(',')[1] || '').length, suf: m[2] };
  }
  function countTo(el, from, delay, dur = 1100) {
    const t = el.querySelector('[data-count]');
    if (!t || reduced) return;
    const span = t.querySelector('span');
    const target = t.dataset.count;
    const { v, dec, suf } = parseCount(target);
    const fmt = x => x.toFixed(dec).replace('.', ',') + suf;
    const c = { span, target, raf: 0 };
    const t0 = performance.now() + delay;
    span.textContent = fmt(from);
    const tick = now => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - k, 4);
      span.textContent = k >= 1 ? target : fmt(from + (v - from) * e);
      if (k < 1) c.raf = requestAnimationFrame(tick); else counters.delete(c);
    };
    c.raf = requestAnimationFrame(tick);
    counters.add(c);
  }
  function countValue(el) {
    const t = el.querySelector('[data-count]');
    return t ? parseCount(t.querySelector('span').textContent).v : null;
  }

  /* ---------- animation bookkeeping ---------- */
  function flush() {
    const r = running; running = [];
    r.forEach(g => { g.anims.forEach(a => { try { a.finish(); } catch (e) {} }); g.done && g.done(); });
    counters.forEach(c => { cancelAnimationFrame(c.raf); c.span.textContent = c.target; });
    counters.clear();
  }
  function track(anims, done) {
    const g = { anims, done };
    running.push(g);
    Promise.all(anims.map(a => a.finished.catch(() => {}))).then(() => {
      const i = running.indexOf(g);
      if (i >= 0) { running.splice(i, 1); done && done(); }
    });
  }

  function enterFrames(fx) {
    switch (fx) {
      case 'rise': return [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }];
      case 'up': return [{ opacity: 0, transform: 'translateY(160px)' }, { opacity: 1, transform: 'none' }];
      case 'slide': return [{ opacity: 0, transform: 'translateX(70px)' }, { opacity: 1, transform: 'none' }];
      case 'wipe': return [{ opacity: 0, transform: 'translateX(-80px)' }, { opacity: 1, transform: 'none' }];
      case 'zoom': return [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }];
      default: return [{ opacity: 0 }, { opacity: 1 }];
    }
  }
  function enter(el, extraDelay = 0, scale = 1) {
    el.classList.remove('h');
    const fx = el.dataset.fx || 'fade';
    const dur = (+el.dataset.dur || (el.classList.contains('blob') ? 1200 : 500)) * scale;
    const delay = (+el.dataset.delay || 0) * scale + extraDelay;
    if (fx === 'zoom') el.style.transformOrigin = '50% 50%';
    const a = el.animate(enterFrames(fx), { duration: dur, delay, easing: EASE, fill: 'backwards' });
    countTo(el, 0, delay + dur * 0.15);
    return a;
  }

  /* ---------- states ---------- */
  function setState(s, c) {
    items(s).forEach(el => el.classList.toggle('h', stepOf(el) > c));
  }
  function ui() {
    bar.style.transform = `scaleX(${(stateIndex(cur, step) + 1) / totalStates})`;
    num.textContent = `${cur + 1} / ${slides.length}`;
    const h = '#' + (cur + 1) + (step ? '.' + step : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function show(i, c, opts = {}) {
    flush();
    const from = slides[cur], to = slides[i];
    const instant = opts.instant || reduced || from === to;
    slides.forEach(s => s.classList.remove('on', 'out'));
    setState(to, c);
    to.classList.add('on');
    const prev = cur;
    cur = i; step = c; ui();
    if (opts.instant || from === to) return;
    if (reduced) {
      const a = to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
      track([a]);
      return;
    }
    const fwd = i > prev;
    from.classList.add('out');
    const anims = [];
    const oldByName = new Map();
    items(from).forEach(el => { if (el.dataset.n && !el.classList.contains('h')) oldByName.set(el.dataset.n, el); });
    const matched = new Set();
    let bigMove = false;
    // shared elements: new one flies from the old box, old one flies to the new box and fades
    items(to).forEach(el => {
      if (el.classList.contains('h')) return;
      const o = el.dataset.n && oldByName.get(el.dataset.n);
      if (!o) return;
      matched.add(o);
      const nb = [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight];
      const ob = [o.offsetLeft, o.offsetTop, o.offsetWidth, o.offsetHeight];
      const isText = el.dataset.k === 'text';
      let sx = ob[2] / nb[2], sy = ob[3] / nb[3];
      if (isText) {
        const fs = e => parseFloat(e.querySelector('p').style.fontSize) || 1;
        sx = sy = fs(o) / fs(el);
      }
      const same = !isText || o.textContent === el.textContent;
      const tIn = `translate(${ob[0] - nb[0]}px,${ob[1] - nb[1]}px) scale(${sx},${sy})`;
      const tOut = `translate(${nb[0] - ob[0]}px,${nb[1] - ob[1]}px) scale(${1 / sx},${1 / sy})`;
      el.style.transformOrigin = o.style.transformOrigin = '0 0';
      const k = { duration: MORPH_MS, easing: MORPH, fill: 'both' };
      const counts = isText && el.querySelector('[data-count]') && o.querySelector('[data-count]');
      if (counts || (same && o.innerHTML === el.innerHTML)) {
        // one object travels: the old copy disappears at once, the number counts from the old value
        anims.push(el.animate([{ transform: tIn }, { transform: 'none' }], k));
        anims.push(o.animate([{ opacity: 0 }, { opacity: 0 }], k));
      } else if (isText) {
        // different words: the old ones leave in the first half, the new ones arrive in the second
        anims.push(el.animate([{ transform: tIn, opacity: 0 }, { opacity: 0, offset: 0.45 }, { transform: 'none', opacity: 1 }], k));
        anims.push(o.animate([{ transform: 'none', opacity: 1 }, { opacity: 0, offset: 0.4 }, { transform: tOut, opacity: 0 }], k));
      } else {
        anims.push(el.animate([{ transform: tIn, opacity: 0 }, { transform: 'none', opacity: 1 }], k));
        anims.push(o.animate([{ transform: 'none', opacity: 1 }, { transform: tOut, opacity: 0 }], k));
      }
      if (!isText && !el.classList.contains('blob') && el.offsetWidth > 300) bigMove = true;
      const v0 = countValue(o);
      if (v0 !== null) countTo(el, v0, 120, MORPH_MS);
    });
    // the rest of the old slide leaves, the rest of the new slide enters
    items(from).forEach(el => {
      if (matched.has(el) || el.classList.contains('h')) return;
      const blob = el.classList.contains('blob');
      const dx = blob ? 0 : (fwd ? -40 : 40);
      anims.push(el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dx}px)` }],
        { duration: blob ? 1100 : 380, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }));
    });
    const lead = bigMove ? 560 : 260; // let the old slide clear (and a travelling plate settle) before new text arrives
    items(to).forEach(el => {
      if (el.classList.contains('h') || (el.dataset.n && oldByName.has(el.dataset.n))) return;
      const blob = el.classList.contains('blob');
      anims.push(enter(el, blob ? 0 : (fwd ? lead : 120), fwd ? 1 : 0.6));
    });
    track(anims, () => {
      from.classList.remove('out');
      [...items(from), ...items(to)].forEach(el => {
        el.getAnimations().forEach(a => a.cancel());
        el.style.transformOrigin = '';
      });
    });
  }

  function reveal(c) {
    flush();
    step = c; ui();
    const els = items(slides[cur]).filter(el => stepOf(el) === c);
    els.forEach(el => el.classList.remove('h'));
    if (reduced) return;
    track(els.map(el => enter(el)));
  }
  function conceal(c) {
    flush();
    const els = items(slides[cur]).filter(el => stepOf(el) === c);
    step = c - 1; ui();
    if (reduced) { els.forEach(el => el.classList.add('h')); return; }
    const anims = els.map(el => el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(16px)' }],
      { duration: 240, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }));
    track(anims, () => els.forEach(el => { el.classList.add('h'); el.getAnimations().forEach(a => a.cancel()); }));
  }

  function next() {
    if (mobile) return;
    if (step < clicks[cur]) reveal(step + 1);
    else if (cur < slides.length - 1) show(cur + 1, 0);
  }
  function prev() {
    if (mobile) return;
    if (step > 0) conceal(step);
    else if (cur > 0) show(cur - 1, clicks[cur - 1]);
  }
  function go(i, c = 0, instant = false) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    c = Math.max(0, Math.min(clicks[i], c));
    show(i, c, { instant });
  }

  /* ---------- layout: letterbox or vertical list ---------- */
  function layout() {
    const vw = innerWidth, vh = innerHeight;
    const m = vw < 760 && vh > vw;
    if (m !== mobile) setMobile(m);
    if (mobile) {
      const k = document.querySelector('.mw').clientWidth / W;
      slides.forEach(s => { s.style.transform = `scale(${k})`; });
    } else {
      const k = Math.min(vw / W, vh / H);
      stage.style.transform = `scale(${k}) translate(-50%,-50%)`;
    }
  }
  let io;
  function setMobile(m) {
    flush();
    mobile = m;
    document.body.classList.toggle('m', m);
    if (m) {
      slides.forEach(s => {
        const w = document.createElement('div');
        w.className = 'mw';
        s.before(w); w.appendChild(s);
        s.classList.add('on');
        setState(s, 99);
      });
      io = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        if (reduced) return;
        items(e.target.firstChild).forEach(el => enter(el, 80 + stepOf(el) * 260, 0.8));
      }), { threshold: 0.35 });
      document.querySelectorAll('.mw').forEach(w => io.observe(w));
    } else {
      io && io.disconnect();
      document.querySelectorAll('.mw').forEach(w => { w.before(w.firstChild); w.remove(); });
      slides.forEach(s => { s.style.transform = ''; });
      go(cur, step, true);
    }
  }

  /* ---------- input ---------- */
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(k)) {
      if (k === 'Enter' && e.target.closest('a,button')) return;
      e.preventDefault(); next();
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') { e.preventDefault(); go(0, 0); }
    else if (k === 'End') { e.preventDefault(); go(slides.length - 1, clicks[slides.length - 1]); }
    else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') fullscreen();
    else if (k === 'n' || k === 'N') next();
    else if (k === 'p' || k === 'P') prev();
    hideHint();
  });
  let swiped = false, tx = 0, ty = 0;
  stage.addEventListener('touchstart', e => { swiped = false; tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (mobile) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped = true; dx < 0 ? next() : prev(); hideHint(); }
  }, { passive: true });
  stage.addEventListener('click', e => {
    if (mobile || swiped || e.target.closest('a,button')) return;
    next();
    hideHint();
  });
  document.getElementById('ctl').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    ({ prev, next, fs: fullscreen })[b.dataset.act]();
    hideHint();
  });
  function fullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else { const r = d.documentElement; (r.requestFullscreen || r.webkitRequestFullscreen || (() => {})).call(r); }
  }
  let uiT;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    document.body.classList.add('ui');
    clearTimeout(uiT); uiT = setTimeout(() => document.body.classList.remove('ui'), 2200);
  });
  const hint = document.getElementById('hint');
  function hideHint() { hint.classList.add('gone'); }
  setTimeout(hideHint, 5000);
  addEventListener('resize', layout);
  addEventListener('hashchange', () => {
    const m = location.hash.match(/^#(\d+)(?:\.(\d+))?$/);
    if (m && (+m[1] - 1 !== cur || +(m[2] || 0) !== step)) go(+m[1] - 1, +(m[2] || 0));
  });

  /* ---------- start ---------- */
  const m0 = location.hash.match(/^#(\d+)(?:\.(\d+))?$/);
  const i0 = m0 ? Math.max(0, Math.min(slides.length - 1, +m0[1] - 1)) : 0;
  const c0 = m0 ? Math.min(clicks[i0], +(m0[2] || 0)) : 0;
  cur = i0; step = c0;
  layout();
  if (!mobile) {
    setState(slides[cur], step);
    slides[cur].classList.add('on');
    ui();
    const start = () => {
      if (reduced) return;
      track(items(slides[cur]).filter(el => !el.classList.contains('h')).map(el => enter(el, 120)));
    };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
  }
  window.deck = { go, next, prev, state: () => ({ slide: cur + 1, step, clicks: clicks[cur], mobile }), flush, states: totalStates };
})();
