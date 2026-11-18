(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const RM = document.documentElement.classList.contains('rm');
  const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  // Motion tokens, mirrored from the CSS custom properties of the same names.
  const T = {fast: 100, normal: 200, slow: 300, inout: 'cubic-bezier(.77,0,.175,1)'};
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const fmt = n => n.toLocaleString('en-US');
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const follow = (k, dt) => 1 - Math.pow(1 - k, dt / 16.7);       // frame-rate independent lerp factor
  const live = $('live');
  const say = text => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); };

  /* ---------- the stroke plan, shared by the hero and the exhibit ---------- */
  const W = 468, H = 832, BRUSH = 2.9;     // plan units; the 4 px Paint brush at the plan's scale
  let PAL = [], STROKES = [];
  function parsePlan() {
    const plan = window.PAINT_PLAN; if (!plan) return false;
    PAL = plan.pal; let colour = 0;
    for (const s of plan.steps) {
      if (typeof s === 'string') { if (s[0] === 'H') colour = +s.slice(1); }
      else STROKES.push([colour, s]);
    }
    return true;
  }
  function prep(canvas, cssW, maxRatio = 2, cpu = false) {
    const k = cssW / W * Math.min(devicePixelRatio || 1, maxRatio);
    canvas.width = Math.round(W * k); canvas.height = Math.round(H * k);
    // cpu: a software canvas. Hundreds of round-capped strokes in one frame are cheap
    // for the CPU but stall the GPU's path tessellation, which shows as scroll hitches.
    const ctx = canvas.getContext('2d', {alpha: false, willReadFrequently: cpu});
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineWidth = BRUSH; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return ctx;
  }
  function strokes(ctx, from, to) {
    let colour = -1;
    for (let i = from; i < to; i++) {
      const [c, p] = STROKES[i];
      if (c !== colour) { colour = c; ctx.strokeStyle = PAL[c]; }
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
      if (p.length === 2) ctx.lineTo(p[0] + .01, p[1]);
      ctx.stroke();
    }
  }
  const endOf = i => { const p = STROKES[i][1]; return [p[p.length - 2], p[p.length - 1]]; };
  const fillWith = (ctx, colour) => { ctx.fillStyle = colour; ctx.fillRect(0, 0, W, H); };

  /* ---------- 1. the hero painter: replays the plan once it is in view ---------- */
  const painter = (() => {
    const art = $('art'), canvas = $('paint'), agent = $('agent'), pill = $('pill'), pillText = $('pillText');
    const count = $('count'), swatch = $('swatch'), stopBtn = $('stop'), stopText = $('stopText'), stopKey = stopBtn.querySelector('kbd');
    const DURATION = 14000, FILL_AT = 700;  // the 65 minute run, about 280x faster; it opens with a bucket fill
    let ctx, drawn = 0, filled = false, elapsed = 0, state = 'idle', last = 0, raf = 0, away = false, onScreen = true;
    let cssW = 0, cx = 0, cy = 0, tx = 0, ty = 0;

    function size() {
      cssW = art.clientWidth; ctx = prep(canvas, cssW);
      fillWith(ctx, '#fff'); if (filled) fillWith(ctx, PAL[0]);
      strokes(ctx, 0, drawn);
    }
    function readout() {
      count.textContent = `Stroke ${fmt(drawn)} / ${fmt(STROKES.length)}`;
      swatch.style.background = drawn ? PAL[STROKES[drawn - 1][0]] : filled ? PAL[0] : '#fff';
    }
    function setButton(mode) {
      stopKey.hidden = mode !== 'stop';
      stopText.textContent = {stop: 'Stop it', resume: 'Resume', again: 'Paint it again'}[mode];
    }
    function frame(now) {
      const dt = Math.min(64, now - last); last = now;
      if (state === 'running') {
        elapsed += dt;
        if (!filled && elapsed >= FILL_AT) { filled = true; fillWith(ctx, PAL[0]); readout(); }
        const target = Math.min(STROKES.length, Math.floor(Math.max(0, elapsed - FILL_AT) / (DURATION - FILL_AT) * STROKES.length));
        if (target > drawn) {
          strokes(ctx, drawn, target); drawn = target; readout();
          const [x, y] = endOf(drawn - 1), s = cssW / W; tx = x * s; ty = y * s;
        }
        if (drawn >= STROKES.length) finish();
      }
      // the hand trails its brush a little, so it glides instead of teleporting
      const a = follow(.3, dt); cx += (tx - cx) * a; cy += (ty - cy) * a;
      agent.style.transform = `translate3d(${cx}px,${cy}px,0)`;
      // off screen the painting waits where it is, so scrolling never pays for it
      raf = (state === 'running' && onScreen) || Math.abs(tx - cx) + Math.abs(ty - cy) > .5 ? requestAnimationFrame(frame) : 0;
    }
    function loop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    function aim() { tx = cssW * .5; ty = cssW * 16 / 9 * .5; }
    function start() {
      state = 'running'; art.classList.add('working'); agent.classList.add('on');
      pill.classList.remove('stopped'); pillText.textContent = 'Antigravity is working'; pill.classList.add('on');
      setButton('stop'); loop();
    }
    function stop() {
      if (state !== 'running') return;
      state = 'stopped'; art.classList.remove('working'); agent.classList.remove('on');
      pill.classList.add('stopped'); pillText.textContent = `Stopped at stroke ${fmt(drawn)}. You pressed Esc.`;
      setButton('resume'); say(`Stopped at stroke ${fmt(drawn)} of ${fmt(STROKES.length)}.`);
    }
    function finish() {
      state = 'done'; art.classList.remove('working'); agent.classList.remove('on');
      pill.classList.add('stopped'); pillText.textContent = `Done. ${fmt(STROKES.length)} strokes.`;
      setButton('again');
    }
    function restart() { drawn = 0; elapsed = 0; filled = false; fillWith(ctx, '#fff'); readout(); aim(); start(); }
    stopBtn.addEventListener('click', () => {
      if (state === 'running') stop();
      else if (state === 'stopped') start();
      else if (state === 'done') restart();
      else if (state === 'ready') start();
    });
    function init() {
      size();
      let rw = cssW; new ResizeObserver(() => { if (art.clientWidth !== rw) { rw = art.clientWidth; size(); } }).observe(art);
      if (RM) { filled = true; fillWith(ctx, PAL[0]); strokes(ctx, 0, STROKES.length); drawn = STROKES.length; readout(); finish(); return; }
      readout(); cx = cssW * .9; cy = cssW * 1.6; aim(); state = 'ready'; setButton('stop');
      // start when the canvas is in view; replay a finished painting when you come back to it
      let left = false;
      new IntersectionObserver(([e]) => {
        onScreen = e.intersectionRatio > 0;
        if (onScreen && state === 'running') loop();
        if (e.intersectionRatio >= .4) {
          if (state === 'ready') start();
          else if (state === 'done' && left) { left = false; restart(); }
        } else if (e.intersectionRatio === 0 && state === 'done') left = true;
      }, {threshold: [0, .4]}).observe(art);
    }
    return {
      init, stop,
      get running() { return state === 'running'; },
      // while the narrator has left the canvas, the painter's own pointer steps aside
      setAway(v) { if (v !== away) { away = v; agent.classList.toggle('away', v); } },
      point() { const r = art.getBoundingClientRect(); return state === 'running' || state === 'stopped' ? [r.left + cx, r.top + cy] : [r.left + r.width * .62, r.top + r.height * .78]; }
    };
  })();

  /* ---------- 2. the exhibit: scroll replays the run, then the photo comparison opens ---------- */
  const exhibit = (() => {
    const sec = $('exhibit'), cmp = $('cmp'), canvas = $('scrub'), rv = $('rv'), rvImg = $('rvImg'), handle = $('handle');
    const bar = $('scrubBar'), text = $('scrubText');
    // The run is pre-rendered into still frames while the page is idle. Scrolling only
    // cross-fades two neighbouring frames, so no brush stroke is drawn during a scroll
    // (live strokes there stalled the GPU and showed as scroll hitches).
    const FRAMES = 24;
    let ctx, cssW = 0, cmpW = 0, frames = [], gen = 0, want = -1, shown = '', top = 0, len = 1, x = 100, touched = false, sweeping = 0, rect = null, ready = false;
    const strokesAt = k => Math.round(k / FRAMES * STROKES.length);
    const idle = window.requestIdleCallback ? fn => requestIdleCallback(fn, {timeout: 300}) : fn => setTimeout(() => fn({timeRemaining: () => 10}), 30);
    function build() {
      const my = ++gen; frames = [];
      const work = document.createElement('canvas'); work.width = canvas.width; work.height = canvas.height;
      const w = work.getContext('2d', {alpha: false}), k0 = work.width / W;
      w.setTransform(k0, 0, 0, k0, 0, 0); w.lineWidth = BRUSH; w.lineCap = 'round'; w.lineJoin = 'round';
      fillWith(w, PAL[0]);
      let k = 0;
      const step = deadline => {
        if (my !== gen) return;
        while (k <= FRAMES) {
          if (k > 0) strokes(w, strokesAt(k - 1), strokesAt(k));
          const at = k++;
          createImageBitmap(work).then(bitmap => { if (my === gen) { frames[at] = bitmap; paint(); } });
          if (deadline.timeRemaining() < 6) break;
        }
        if (k <= FRAMES) idle(step);
      };
      idle(step);
    }
    // want: -1 blank canvas, 0 bucket-filled, m = filled plus m strokes
    function paint() {
      if (want < 0) { if (shown !== 'blank') { fillWith(ctx, '#fff'); shown = 'blank'; } return; }
      const f = want / STROKES.length * FRAMES, a = Math.min(FRAMES, Math.floor(f));
      let lo = a; while (lo >= 0 && !frames[lo]) lo--;
      const hi = lo === a && a < FRAMES && frames[a + 1] ? a + 1 : -1, mix = hi < 0 ? 0 : Math.round((f - a) * 32) / 32;
      const key = lo + ':' + mix; if (key === shown) return; shown = key;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (lo < 0) { ctx.fillStyle = PAL[0]; ctx.fillRect(0, 0, canvas.width, canvas.height); } else ctx.drawImage(frames[lo], 0, 0);
      if (mix > 0) { ctx.globalAlpha = mix; ctx.drawImage(frames[hi], 0, 0); }
      ctx.restore();
    }
    function size() {
      cssW = cmpW = cmp.clientWidth; ctx = prep(canvas, cssW, 1); shown = ''; build(); paint(); setX(x);
      const r = sec.getBoundingClientRect(); top = r.top + scrollY; len = Math.max(1, sec.offsetHeight - innerHeight);
    }
    function setX(v) {
      x = clamp(v, 0, 100);
      rv.style.transform = `translateX(${x}%)`; rvImg.style.transform = `translateX(${-x}%)`; handle.style.transform = `translate3d(${(x / 100 * cmpW).toFixed(1)}px,0,0)`;
      const shown = Math.round(100 - x);
      cmp.setAttribute('aria-valuenow', shown); cmp.setAttribute('aria-valuetext', `${shown}% of the photo shown`);
    }
    function sweep(to) {
      cancelAnimationFrame(sweeping);
      if (RM) { setX(to); return; }
      const t0 = performance.now(), from = x;
      const step = now => {
        if (touched) return;
        const t = clamp((now - t0) / 1100);
        setX(from + (to - from) * easeInOut(t));
        if (t < 1) sweeping = requestAnimationFrame(step);
      };
      sweeping = requestAnimationFrame(step);
    }
    function update() {
      if (!ready) return;
      const p = clamp((scrollY - top) / len);
      want = RM ? STROKES.length : p < .03 ? -1 : p < .06 ? 0 : Math.round(clamp((p - .06) / .7) * STROKES.length);
      paint();
      bar.style.transform = `scaleX(${Math.max(0, want) / STROKES.length})`;
      text.textContent = want < 0 ? 'Scroll to paint' : want === 0 ? 'Bucket fill' : `Stroke ${fmt(want)} / ${fmt(STROKES.length)}`;
      const done = want === STROKES.length;
      if (done !== cmp.classList.contains('done')) {
        cmp.classList.toggle('done', done); btn.tabIndex = done ? 0 : -1; btn.classList.toggle('on', done && !cmp.classList.contains('comparing'));
        if (!done) close();
      }
    }
    const at = e => { touched = true; cancelAnimationFrame(sweeping); setX((e.clientX - rect.left) / rect.width * 100); };
    cmp.addEventListener('pointerdown', e => { if (!cmp.classList.contains('comparing')) return; rect = cmp.getBoundingClientRect(); cmp.setPointerCapture(e.pointerId); cmp.classList.add('dragging'); at(e); });
    cmp.addEventListener('pointermove', e => { if (rect && cmp.hasPointerCapture(e.pointerId)) at(e); });
    const release = () => { rect = null; cmp.classList.remove('dragging'); };
    cmp.addEventListener('pointerup', release); cmp.addEventListener('pointercancel', release);
    cmp.addEventListener('keydown', e => {
      const d = {ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100}[e.key];
      if (d === undefined || !cmp.classList.contains('comparing')) return;
      e.preventDefault(); touched = true; cancelAnimationFrame(sweeping); setX(x + d);
    });
    setX(100);
    // the comparison opens on request: one sweep to the middle, then it is yours to drag
    const btn = $('cmpbtn');
    function open() { btn.classList.remove('on'); btn.tabIndex = -1; cmp.classList.add('comparing'); cmp.setAttribute('aria-disabled', 'false'); touched = false; sweep(50); cmp.focus({preventScroll: true}); }
    function close() { cmp.classList.remove('comparing'); cmp.setAttribute('aria-disabled', 'true'); cancelAnimationFrame(sweeping); touched = false; setX(100); }
    btn.addEventListener('click', e => { e.stopPropagation(); open(); });

    const nums = [...document.querySelectorAll('#stats b')];
    new IntersectionObserver((es, io) => {
      if (!es[0].isIntersecting || RM) return; io.disconnect();
      const t0 = performance.now();
      const step = now => {
        const t = easeOut(clamp((now - t0) / 900));
        for (const b of nums) b.textContent = fmt(Math.round(+b.dataset.to * t)) + (b.dataset.unit || '');
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, {threshold: .6}).observe($('stats'));

    return {
      init() { ready = true; size(); update();
        // decode the photo ahead of time, so revealing it never stalls a scrolling frame
        new IntersectionObserver(([e], io) => { if (e.isIntersecting) { io.disconnect(); rvImg.decode?.().catch(() => {}); } }, {rootMargin: '150% 0px'}).observe(cmp); let rw = cmp.clientWidth; new ResizeObserver(() => { if (cmp.clientWidth !== rw) { rw = cmp.clientWidth; size(); update(); } }).observe(cmp); },
      update, resize() { if (ready) { const r = sec.getBoundingClientRect(); top = r.top + scrollY; len = Math.max(1, sec.offsetHeight - innerHeight); } },
      // where the narrator should be: on the brush while it paints, on the handle once it is finished
      point() {
        const r = cmp.getBoundingClientRect();
        if (want === STROKES.length && cmp.classList.contains('comparing')) return [r.left + r.width * x / 100 + 10, r.top + r.height * .5 + 26];
        if (want === STROKES.length) { const b = btn.getBoundingClientRect(); return [b.right - 18, b.bottom - 8]; }
        if (want <= 0) return [r.left + r.width * .5, r.top + r.height * .5];
        const [px, py] = endOf(want - 1), s = r.width / W; return [r.left + px * s, r.top + py * s];
      }
    };
  })();

  /* ---------- 3. how it works: each beat is a timed sequence ---------- */
  const how = (() => {
    const sec = $('how'), desk = $('desk'), agent = $('dagent'), field = $('field'), typed = $('typed'), save = $('save'), toast = $('toast');
    const pill = $('dpill'), pillText = $('dpillText'), keycap = $('keycap'), tryLine = $('try');
    const beats = [...document.querySelectorAll('.beat')], steps = [...document.querySelectorAll('.steps button')];
    const tryText = tryLine.innerHTML;
    let beat = -1, run = 0, inView = false, working = false, pos = [0, 0], autoTimer = 0;

    const wait = (ms, id) => new Promise((res, rej) => setTimeout(() => id === run ? res() : rej(0), RM ? 0 : ms));
    const place = p => { pos = p; agent.style.transform = `translate3d(${p[0]}px,${p[1]}px,0)`; };
    function point(el) {
      const d = desk.getBoundingClientRect(), r = el.getBoundingClientRect();
      return [r.left - d.left + Math.min(r.width * .3, 60), r.top - d.top + r.height * .55];
    }
    async function move(to, ms, id) {
      if (RM) { place(to); return; }
      const a = agent.animate([{transform: `translate3d(${pos[0]}px,${pos[1]}px,0)`}, {transform: `translate3d(${to[0]}px,${to[1]}px,0)`}], {duration: ms, easing: T.inout});
      place(to);
      await a.finished.catch(() => {});
      if (id !== run) throw 0;
    }
    async function type(text, ms, id) { for (const ch of text) { typed.textContent += ch; await wait(ms, id); } }
    function reset() {
      run++; clearTimeout(autoTimer);
      agent.getAnimations().forEach(a => a.cancel());
      desk.classList.remove('reading', 'working'); field.classList.remove('focus'); save.classList.remove('down');
      toast.classList.remove('on'); pill.classList.remove('on', 'stopped'); keycap.classList.remove('on', 'down'); keycap.disabled = true;
      agent.classList.remove('on'); typed.textContent = ''; working = false; tryLine.innerHTML = tryText;
      place([desk.clientWidth * .78, desk.clientHeight * .86]);
      return run;
    }
    async function read(id) { await wait(60, id); desk.classList.add('reading'); }
    async function act(id) {
      agent.classList.add('on'); await wait(350, id);
      await move(point(field), 650, id); field.classList.add('focus'); await wait(200, id);
      await type('portrait.png', 75, id); await wait(250, id);
      field.classList.remove('focus'); await move(point(save), 550, id);
      save.classList.add('down'); await wait(T.fast + 40, id); save.classList.remove('down');
      toast.classList.add('on');
    }
    async function stopDemo(id) {
      desk.classList.add('working'); pillText.textContent = 'Antigravity is working'; pill.classList.add('on');
      keycap.classList.add('on'); keycap.disabled = false; agent.classList.add('on'); working = true;
      autoTimer = setTimeout(() => press(true), RM ? 6000 : 5200);
      await wait(300, id);
      await move(point(field), 600, id); field.classList.add('focus');
      await type('quarterly-report-final.png', 170, id);
    }
    function press(auto) {
      if (!working) return;
      const kept = typed.textContent;
      reset();                                  // stops the typing mid-word, like the real thing
      typed.textContent = kept;
      keycap.classList.add('on', 'down'); setTimeout(() => keycap.classList.remove('down'), T.fast + 40);
      pill.classList.add('on', 'stopped'); pillText.textContent = auto ? 'Stopped. Esc was pressed for you.' : 'Stopped. You pressed Esc.';
      tryLine.innerHTML = (auto ? 'That one was automatic. ' : 'Instant, wherever focus is. ') + '<button class="stop" type="button" id="again">Run it again</button>';
      $('again').addEventListener('click', () => { const id = reset(); stopDemo(id).catch(() => {}); });
      say(auto ? 'The demo stopped. Esc was pressed for you.' : 'Stopped. You pressed Esc.');
    }
    keycap.addEventListener('click', () => press(false));

    function play() {
      const id = reset();
      beats.forEach((b, i) => b.classList.toggle('on', i === beat));
      steps.forEach((b, i) => { b.classList.toggle('past', i < beat); if (i === beat) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      if (!inView) return;
      [read, act, stopDemo][beat](id).catch(() => {});
    }
    for (const t of document.querySelectorAll('.trig')) {
      new IntersectionObserver(es => { if (es[0].isIntersecting && +t.dataset.b !== beat) { beat = +t.dataset.b; play(); } }, {rootMargin: '-50% 0px -50% 0px'}).observe(t);
    }
    new IntersectionObserver(es => {
      inView = es[0].isIntersecting;
      if (beat < 0) beat = 0;
      if (inView) play(); else reset();
    }, {threshold: .35}).observe(desk);
    // the steps are buttons: each jumps to the middle of its beat
    steps.forEach((b, i) => b.addEventListener('click', () => {
      const r = sec.getBoundingClientRect();
      scrollTo({top: r.top + scrollY + i * innerHeight + innerHeight * .15, behavior: RM ? 'auto' : 'smooth'});
    }));
    return {get working() { return working; }, press};
  })();

  /* ---------- the narrator: the same pointer leads you down the page ---------- */
  const narrator = (() => {
    if (RM) return {kick() {}};
    const el = $('narrator'), art = $('art'), ex = $('exhibit'), hw = $('how'), desk = $('desk');
    const marks = [...document.querySelectorAll('.qa summary'), $('copyPrompt')];
    let cx = 0, cy = 0, shown = false, placed = false, raf = 0, last = 0;
    const bez = (a, c, b, t) => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; };
    // after the exhibit it only points: at a question's + sign, or just under the Copy button
    const aimAt = (m, r) => m.tagName === 'SUMMARY' ? [r.right - 14, r.top + r.height * .5 + 2] : [r.left + r.width * .5, r.bottom - 3];
    function target() {
      const vh = innerHeight, exR = ex.getBoundingClientRect(), hwR = hw.getBoundingClientRect();
      // still in the hero: the painter's own pointer is the one on screen
      if (exR.top > vh * .92) return null;
      // leaving the painting for the exhibit, along a gentle arc
      if (exR.top > 57) {
        const t = easeInOut(clamp((vh * .92 - exR.top) / (vh * .92 - 57))), a = painter.point(), b = exhibit.point();
        return bez(a, [Math.max(a[0], b[0]) + 160, (a[1] + b[1]) / 2], b, t);
      }
      // inside the exhibit: on the brush, then on the handle
      if (exR.bottom > vh) return exhibit.point();
      // on to the desk, where the demo's own pointer takes over
      if (hwR.top > 57) {
        const t = easeInOut(clamp((vh - exR.bottom) / (vh - 57 + (hwR.top - exR.bottom)))), a = exhibit.point(), d = desk.getBoundingClientRect(), b = [d.left + d.width * .78, d.top + d.height * .86];
        return bez(a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 80], b, t);
      }
      if (hwR.bottom > vh * .6) return null;
      // then whatever deserves a look: each question, and finally the Copy button
      let best = null, bestEl = null, bestD = Infinity;
      for (const m of marks) {
        const r = m.getBoundingClientRect(); if (r.bottom < 60 || r.top > vh) continue;
        const d = Math.abs(r.top + r.height / 2 - vh * .45); if (d < bestD) { bestD = d; best = r; bestEl = m; }
      }
      return best ? aimAt(bestEl, best) : null;
    }
    function frame(now) {
      const dt = Math.min(64, now - last); last = now;
      const t = target();
      if (!t) { if (shown) { shown = false; el.classList.remove('on'); painter.setAway(false); } raf = 0; return; }
      if (!placed) { cx = t[0]; cy = t[1]; placed = true; }
      if (!shown) { shown = true; el.classList.add('on'); painter.setAway(true); }
      const a = follow(.16, dt); cx += (t[0] - cx) * a; cy += (t[1] - cy) * a;
      el.style.transform = `translate3d(${cx}px,${cy}px,0)`;
      raf = Math.abs(t[0] - cx) + Math.abs(t[1] - cy) > .4 ? requestAnimationFrame(frame) : 0;
    }
    return {kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }};
  })();

  /* ---------- one scroll handler: the exhibit scrub and the narrator ---------- */
  let queued = false;
  const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; exhibit.update(); narrator.kick(); }); };
  addEventListener('scroll', onScroll, {passive: true});
  addEventListener('resize', () => { exhibit.resize(); onScroll(); });

  /* ---------- 3D tilt on hover: mouse only, transform only ---------- */
  if (FINE && !RM) for (const el of document.querySelectorAll('[data-tilt]')) {
    const sheen = document.createElement('span'); sheen.className = 'sheen'; sheen.setAttribute('aria-hidden', 'true');
    const light = document.createElement('i'); sheen.appendChild(light); el.appendChild(sheen);
    const MAX = 5;                              // degrees
    let rect = null, at = -1, tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, last = 0;
    function frame(now) {
      const dt = Math.min(64, now - last); last = now;
      const a = follow(.12, dt); cx += (tx - cx) * a; cy += (ty - cy) * a;
      const still = Math.abs(tx - cx) + Math.abs(ty - cy) < .01;
      el.style.transform = still && tx === 0 && ty === 0 ? '' : `perspective(1100px) rotateX(${cy.toFixed(3)}deg) rotateY(${cx.toFixed(3)}deg)`;
      raf = still ? 0 : requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || el.classList.contains('dragging')) return;
      // measure flat, once per scroll position, so the tilt never feeds back into its own geometry
      if (!rect || at !== scrollY) { const t = el.style.transform; el.style.transform = ''; rect = el.getBoundingClientRect(); el.style.transform = t; at = scrollY; }
      const px = clamp((e.clientX - rect.left) / rect.width), py = clamp((e.clientY - rect.top) / rect.height);
      tx = (px - .5) * 2 * MAX; ty = -(py - .5) * 2 * MAX;
      light.style.transform = `translate3d(${(px - .5) * 100}%,${(py - .5) * 100}%,0)`;
      sheen.classList.add('on'); kick();
    });
    el.addEventListener('pointerleave', () => { tx = ty = 0; rect = null; sheen.classList.remove('on'); kick(); });
    el.addEventListener('pointerdown', () => { tx = ty = 0; kick(); });
  }

  /* ---------- the real recording, in a dialog ---------- */
  const film = $('film'), video = $('filmVideo');
  $('watch').addEventListener('click', () => { film.showModal(); video.play().catch(() => {}); });
  film.addEventListener('close', () => video.pause());
  film.addEventListener('click', e => { if (e.target === film) film.close(); });

  addEventListener('keydown', e => {
    if (e.key !== 'Escape' || film.open) return;               // a open dialog closes on its own
    if (how.working) how.press(false);
    else if (painter.running) painter.stop();
  });

  /* ---------- the plan arrives, then both canvases start ---------- */
  const boot = () => { if (!parsePlan()) return; painter.init(); exhibit.init(); onScroll(); };
  if (window.PAINT_PLAN) boot();
  else document.querySelector('script[src="plan.js"]').addEventListener('load', boot, {once: true});

  /* ---------- trust row: live version and stars, if GitHub answers ---------- */
  const api = 'https://api.github.com/repos/shayann07/antigravity-computer-use';
  // Read fresh on every visit (never from the HTTP cache). Without an answer the row
  // says "Latest release" and "Star on GitHub" rather than a number that may be old.
  const get = url => fetch(url, {cache: 'no-store', headers: {Accept: 'application/vnd.github+json'}}).then(r => r.ok ? r.json() : null).catch(() => null);
  get(api).then(d => { if (d && Number.isFinite(d.stargazers_count)) $('stars').textContent = `${fmt(d.stargazers_count)} ${d.stargazers_count === 1 ? 'star' : 'stars'}`; });
  get(api + '/releases/latest').then(d => { if (d && /^v\d/.test(d.tag_name || '')) { $('ver').textContent = d.tag_name; if (/^https:\/\/github\.com\//.test(d.html_url || '')) $('ver').href = d.html_url; } });

  /* ---------- install: OS tabs and copy ---------- */
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const select = tab => tabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = !on; });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; select(n); n.focus(); } });
  });
  if (/Mac/i.test(navigator.platform || navigator.userAgent)) select($('tab-mac'));
  document.querySelectorAll('.copy').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); } catch { return; }
    b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1600);
  }));
})();
