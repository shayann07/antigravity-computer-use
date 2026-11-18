(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const RM = document.documentElement.classList.contains('rm');
  // Motion tokens, mirrored from the CSS custom properties of the same names.
  const T = {fast: 100, normal: 200, slow: 300, inout: 'cubic-bezier(.77,0,.175,1)', out: 'cubic-bezier(.23,1,.32,1)'};
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const fmt = n => n.toLocaleString('en-US');
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const live = $('live');
  const say = text => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); };

  /* ---------- 1. the painter: replays the real stroke plan ---------- */
  const painter = (() => {
    const art = $('art'), canvas = $('paint'), ctx = canvas.getContext('2d', {alpha: false});
    const agent = $('agent'), pill = $('pill'), pillText = $('pillText'), count = $('count'), swatch = $('swatch');
    const stopBtn = $('stop'), stopText = $('stopText'), stopKey = stopBtn.querySelector('kbd');
    const W = 468, H = 832, BRUSH = 2.9;   // plan units; the 4 px Paint brush at the plan's scale
    const DURATION = 14000;                  // the 65 minute run, about 280x faster
    const FILL_AT = 700;                     // the run opens with a bucket fill in the first colour
    let strokes = [], pal = [], drawn = 0, filled = false, elapsed = 0, state = 'idle', last = 0, raf = 0;
    let cssW = 0, cx = 0, cy = 0, tx = 0, ty = 0;

    function size() {
      cssW = art.clientWidth;
      const k = cssW / W * Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * k); canvas.height = Math.round(H * k);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineWidth = BRUSH; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      blank(); if (filled) fill();
      const upTo = drawn; drawn = 0; draw(upTo);
    }
    function blank() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
    function fill() { filled = true; ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, W, H); }
    function draw(upTo) {
      let colour = -1;
      for (; drawn < upTo; drawn++) {
        const [c, p] = strokes[drawn];
        if (c !== colour) { colour = c; ctx.strokeStyle = pal[c]; }
        ctx.beginPath(); ctx.moveTo(p[0], p[1]);
        for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
        if (p.length === 2) ctx.lineTo(p[0] + .01, p[1]);
        ctx.stroke();
      }
    }
    function readout() {
      count.textContent = `Stroke ${fmt(drawn)} / ${fmt(strokes.length)}`;
      if (drawn) swatch.style.background = pal[strokes[drawn - 1][0]];
    }
    function setButton(mode) {
      stopKey.hidden = mode !== 'stop';
      stopText.textContent = {stop: 'Stop it', resume: 'Resume', again: 'Paint it again'}[mode];
    }
    function frame(now) {
      const dt = Math.min(64, now - last); last = now;
      if (state === 'running') {
        elapsed += dt;
        if (!filled && elapsed >= FILL_AT) { fill(); swatch.style.background = pal[0]; }
        const target = Math.min(strokes.length, Math.floor(Math.max(0, elapsed - FILL_AT) / (DURATION - FILL_AT) * strokes.length));
        if (target > drawn) {
          draw(target); readout();
          const p = strokes[drawn - 1][1], s = cssW / W;
          tx = p[p.length - 2] * s; ty = p[p.length - 1] * s;
        }
        if (drawn >= strokes.length) finish();
      }
      // the hand trails its brush a little, so it glides instead of teleporting
      const a = 1 - Math.pow(1 - .3, dt / 16.7);
      cx += (tx - cx) * a; cy += (ty - cy) * a;
      agent.style.transform = `translate3d(${cx}px,${cy}px,0)`;
      raf = state === 'running' || Math.abs(tx - cx) + Math.abs(ty - cy) > .5 ? requestAnimationFrame(frame) : 0;
    }
    function loop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    function start() {
      state = 'running'; art.classList.add('working'); agent.classList.add('on');
      pill.classList.remove('stopped'); pillText.textContent = 'Antigravity is working'; pill.classList.add('on');
      setButton('stop'); loop();
    }
    function stop() {
      if (state !== 'running') return;
      state = 'stopped'; art.classList.remove('working'); agent.classList.remove('on');
      pill.classList.add('stopped'); pillText.textContent = `Stopped at stroke ${fmt(drawn)}. You pressed Esc.`;
      setButton('resume'); say(`Stopped at stroke ${fmt(drawn)} of ${fmt(strokes.length)}.`);
    }
    function finish() {
      state = 'done'; art.classList.remove('working'); agent.classList.remove('on');
      pill.classList.add('stopped'); pillText.textContent = `Done. ${fmt(strokes.length)} strokes.`;
      setButton('again');
    }
    function restart() {
      drawn = 0; elapsed = 0; filled = false; blank(); readout(); aim(); start();
    }
    stopBtn.addEventListener('click', () => {
      if (state === 'running') stop();
      else if (state === 'stopped') start();
      else if (state === 'done') restart();
    });
    function init() {
      const plan = window.PAINT_PLAN;
      if (!plan) return;
      pal = plan.pal; let colour = 0;
      for (const s of plan.steps) {
        if (typeof s === 'string') { if (s[0] === 'H') colour = +s.slice(1); }
        else strokes.push([colour, s]);
      }
      size();
      let rw = cssW; new ResizeObserver(() => { if (art.clientWidth !== rw) { rw = art.clientWidth; size(); } }).observe(art);
      if (RM) { fill(); draw(strokes.length); readout(); finish(); return; }
      readout(); cx = cssW * .9; cy = cssW * 1.6; aim(); start();
    }
    // before the fill, the hand travels to the middle of the canvas to click the bucket
    function aim() { tx = cssW * .5; ty = cssW * 16 / 9 * .5; }
    return {init, stop, get running() { return state === 'running'; }};
  })();

  /* ---------- 2. the exhibit: painting against the photo ---------- */
  (() => {
    const cmp = $('cmp'), rv = $('rv'), rvImg = $('rvImg'), handle = $('handle');
    let x = 100, touched = false, rect = null;
    function set(v) {
      x = clamp(v, 0, 100);
      rv.style.transform = `translateX(${x}%)`; rvImg.style.transform = `translateX(${-x}%)`; handle.style.transform = `translateX(${x}%)`;
      const shown = Math.round(100 - x);
      cmp.setAttribute('aria-valuenow', shown); cmp.setAttribute('aria-valuetext', `${shown}% of the photo shown`);
    }
    function sweep() {
      if (touched) return;
      if (RM) { set(50); return; }
      const t0 = performance.now(), from = x;
      const step = now => {
        if (touched) return;
        const t = clamp((now - t0) / 1400);
        set(from + (50 - from) * easeInOut(t));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    const at = e => set((e.clientX - rect.left) / rect.width * 100);
    cmp.addEventListener('pointerdown', e => { touched = true; rect = cmp.getBoundingClientRect(); cmp.setPointerCapture(e.pointerId); at(e); });
    cmp.addEventListener('pointermove', e => { if (rect && cmp.hasPointerCapture(e.pointerId)) at(e); });
    cmp.addEventListener('pointerup', () => { rect = null; });
    cmp.addEventListener('keydown', e => {
      const d = {ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100}[e.key];
      if (d === undefined) return; e.preventDefault(); touched = true; set(x + d);
    });
    set(100);
    new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { io.disconnect(); setTimeout(sweep, RM ? 0 : 250); } }, {threshold: .55}).observe(cmp);

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
  })();

  /* ---------- 3. how it works: each beat is a timed sequence ---------- */
  const how = (() => {
    const desk = $('desk'), agent = $('dagent'), field = $('field'), typed = $('typed'), save = $('save'), toast = $('toast');
    const pill = $('dpill'), pillText = $('dpillText'), keycap = $('keycap'), tryLine = $('try');
    const beats = [...document.querySelectorAll('.beat')], dots = [...document.querySelectorAll('.dots i')];
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
    async function type(text, ms, id) {
      for (const ch of text) { typed.textContent += ch; await wait(ms, id); }
    }
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
      tryLine.innerHTML = auto ? 'That one was automatic. <button class="stop" type="button" id="again">Run it again</button>' : 'Instant, wherever focus is. <button class="stop" type="button" id="again">Run it again</button>';
      $('again').addEventListener('click', () => { const id = reset(); stopDemo(id).catch(() => {}); });
      say(auto ? 'The demo stopped. Esc was pressed for you.' : 'Stopped. You pressed Esc.');
    }
    keycap.addEventListener('click', () => press(false));

    function play() {
      const id = reset();
      beats.forEach((b, i) => b.classList.toggle('on', i === beat));
      dots.forEach((d, i) => d.classList.toggle('on', i <= beat));
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
    return {get working() { return working; }, press};
  })();

  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (how.working) how.press(false);
    else if (painter.running) painter.stop();
  });

  if (window.PAINT_PLAN) painter.init();
  else document.querySelector('script[src="plan.js"]').addEventListener('load', painter.init, {once: true});

  /* ---------- 4. install: OS tabs and copy ---------- */
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
