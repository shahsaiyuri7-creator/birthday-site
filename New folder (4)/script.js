/* =========================================================
   for you ♡  —  script.js
   Sections:
     1. CONFIG  (everything you might want to customize)
     2. Helpers
     3. Space engine (stars, dust, hearts, shooting stars, burst)
     4. Page navigation
     5. Page 1 intro sequence
     6. Page 2 video
     7. Page 3 countdown + birthday finale
     8. Boot
   ========================================================= */
(() => {
  'use strict';

  /* =======================================================
     1. CONFIG  ✎ CUSTOMIZE HERE
     ======================================================= */
  const CONFIG = {
    // ✎ Length of the Page 3 animation, in seconds. (It counts 19 → 0.)
    COUNTDOWN_SECONDS: 19,

    // ✎ OPTIONAL — a REAL birthday moment. Leave as null for the default behaviour
    // (a plain 19-second animation that starts whenever Page 3 opens).
    //
    // To make the finale land exactly at a real date/time, put an ISO date WITH a
    // timezone offset, for example (midnight Nov 3, Bangladesh time):
    //     REAL_BIRTHDAY: '2026-11-03T00:00:00+06:00',
    // Then:
    //   • If you open Page 3 earlier than 19s before that moment, it waits quietly
    //     (stars only) and starts the countdown at the right time, so "0" hits exactly then.
    //   • If you open it inside the last 19s, it starts mid-count and still hits 0 on time.
    //   • If that moment has already passed, it just runs the normal 19-second animation.
    // The "play our moment again" button always replays the full 19 seconds.
    REAL_BIRTHDAY: null,

    // How long "0" stays on screen before the number fades and the finale begins (ms)
    ZERO_HOLD_MS: 1100,

    PAGE_FADE_MS: 900,   // must match --page-fade in style.css

    // Page 1 timing (ms)
    INTRO: {
      darkMs: 1400,        // pure darkness before anything appears
      glowDelayMs: 1800,   // after stars begin, when the centre glow appears
      firstMsgDelayMs: 2200,
      fadeInMs: 1900,      // message fade-in (also sets CSS --msg-in)
      holdMs: 2800,        // how long each message stays readable
      fadeOutMs: 1400,     // message fade-out (also sets CSS --msg-out)
      gapMs: 700,          // darkness between messages
      buttonDelayMs: 900   // after the last message, before the button glows in
    },

    // Page 3 finale timing (ms, measured from the moment the number fades)
    FINALE: {
      burstDelayMs: 1000,  // wait for the number to fade before the galaxy lights up
      subDelayMs: 2200,    // after the title appears
      buttonDelayMs: 3600, // after the subtitle starts appearing
      flashRiseMs: 1300,
      flashFallMs: 4800,
      flashPeak: 0.34      // 0–1; how bright the galaxy glows (keep gentle, no flashing)
    }
  };

  /* =======================================================
     2. HELPERS
     ======================================================= */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const TAU = Math.PI * 2;
  const rand = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let REDUCED = motionQuery.matches;

  // A tiny scheduler so every pending timeout can be cancelled in one call
  function createScheduler() {
    const ids = new Set();
    return {
      later(fn, ms) {
        const id = setTimeout(() => { ids.delete(id); fn(); }, ms);
        ids.add(id);
        return id;
      },
      clear() { ids.forEach(clearTimeout); ids.clear(); }
    };
  }

  /* =======================================================
     3. SPACE ENGINE  (one canvas for the whole experience)
     ======================================================= */
  const Space = (() => {
    const canvas = $('#space');
    const ctx = canvas.getContext('2d');
    const flashEl = $('#flash');

    const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 2;
    const perf = lowEnd ? 0.62 : 1;

    let W = 0, H = 0, dpr = 1;
    let stars = [], dust = [], hearts = [], shooters = [], burstParts = [];
    let ring = null;
    let running = false, rafId = 0, last = 0, time = 0;
    let px = 0, py = 0, tx = 0, ty = 0;            // parallax (smoothed / target)
    let nextShoot = 6;
    let intensity = 1;                              // 1 on pages 1–2, higher on page 3
    let starLimit = 0, dustLimit = 0, quality = 0;  // adaptive quality governor
    let frameAcc = 0, frameCount = 0;
    let flashStart = -1, flashLevel = 0;

    /* ---- sprites (pre-rendered once so drawing stays cheap) ---- */
    function glowSprite(size, rgb) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gr.addColorStop(0, `rgba(${rgb},1)`);
      gr.addColorStop(0.28, `rgba(${rgb},.5)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, size, size);
      return c;
    }
    function heartSprite() {
      const size = 64, c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d'), cx = 32, cy = 34, s = 13;
      g.beginPath();
      g.moveTo(cx, cy + s * 0.9);
      g.bezierCurveTo(cx + s * 1.6, cy - s * 0.2, cx + s * 0.8, cy - s * 1.3, cx, cy - s * 0.45);
      g.bezierCurveTo(cx - s * 0.8, cy - s * 1.3, cx - s * 1.6, cy - s * 0.2, cx, cy + s * 0.9);
      g.closePath();
      g.shadowColor = 'rgba(184,148,255,.95)';
      g.shadowBlur = 10;
      g.fillStyle = 'rgba(238,208,255,.95)';
      g.fill();
      return c;
    }
    const sprites = {
      white: glowSprite(64, '236,240,255'),
      violet: glowSprite(64, '176,146,255'),
      blue: glowSprite(64, '120,168,255'),
      heart: heartSprite()
    };
    const STAR_COLORS = ['#ffffff', '#ffffff', '#eaf0ff', '#cfdcff', '#e6dcff', '#d8ccff', '#fff4e6'];

    /* ---- build / resize ---- */
    function build() {
      const area = W * H;
      const count = Math.round(clamp(area / 4300, 130, 520) * perf);
      stars = [];
      for (let i = 0; i < count; i++) {
        const layer = Math.random();
        const d = layer < 0.55 ? 0.25 : layer < 0.88 ? 0.6 : 1;      // depth layers (parallax + drift)
        const bright = Math.random() < 0.05;
        stars.push({
          x: rand(W), y: rand(H), d,
          r: bright ? rand(1.4, 2.1) : rand(0.3, 1.15) * (0.65 + d * 0.5),
          a: bright ? rand(0.75, 1) : rand(0.28, 0.9),
          sp: rand(0.4, 1.9), ph: rand(TAU),
          c: pick(STAR_COLORS), glow: bright
        });
      }
      dust = [];
      const dn = Math.round(30 * perf);
      for (let i = 0; i < dn; i++) {
        dust.push({
          x: rand(W), y: rand(H), vx: rand(-4, 4), vy: rand(-7, -1.5),
          s: rand(8, 26), a: rand(0.06, 0.2), ph: rand(TAU),
          spr: Math.random() < 0.55 ? sprites.violet : sprites.blue
        });
      }
      hearts = [];
      const hn = lowEnd ? 3 : 4;
      for (let i = 0; i < hn; i++) hearts.push(newHeart(Math.random()));
      starLimit = Math.floor(stars.length * (1 - 0.22 * quality));
      dustLimit = Math.floor(dust.length * (1 - 0.3 * quality));
    }

    function newHeart(t0) {
      return {
        t: t0 || 0, life: rand(16, 26), x0: rand(W * 0.12, W * 0.88), y0: rand(H * 0.55, H * 0.95),
        rise: rand(140, 260), sc: rand(0.45, 0.8), max: rand(0.28, 0.5), ph: rand(TAU)
      };
    }

    function resize(force) {
      const nw = window.innerWidth, nh = window.innerHeight;
      // Ignore tiny height changes (mobile address bar) so stars don't reshuffle while scrolling
      if (!force && nw === W && Math.abs(nh - H) < 140) return;
      W = nw; H = nh;
      dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
      if (REDUCED) draw(0);
    }

    /* ---- spawners ---- */
    function spawnShooter() {
      const ang = rand(0.42, 0.7);                 // radians below horizontal
      const dir = Math.random() < 0.78 ? -1 : 1;   // mostly travelling right → left
      const speed = rand(650, 1050);
      shooters.push({
        x: rand(W * 0.25, W * 1.05), y: rand(-10, H * 0.4),
        dx: Math.cos(ang) * dir, dy: Math.sin(ang),
        vx: Math.cos(ang) * dir * speed, vy: Math.sin(ang) * speed,
        len: rand(110, 220), t: 0, life: rand(0.8, 1.3)
      });
    }

    function burst() {
      if (REDUCED) return;
      const cx = W / 2, cy = H * 0.46;
      const n = Math.round(190 * perf);
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), sp = 70 + Math.pow(Math.random(), 0.65) * 560;
        const isHeart = i % 24 === 0;
        burstParts.push({
          x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          s: isHeart ? rand(16, 26) : rand(5, 17),
          life: rand(2.4, 4.4), t: 0, heart: isHeart,
          spr: pick([sprites.white, sprites.white, sprites.violet, sprites.blue])
        });
      }
      ring = { t: 0, life: 2.8, cx, cy };
    }

    function flash() {
      if (REDUCED) return;
      flashStart = performance.now();
    }
    function resetFlash() {
      flashStart = -1; flashLevel = 0; flashEl.style.opacity = '0';
      burstParts = []; ring = null;
    }

    /* ---- drawing ---- */
    function draw(dt) {
      ctx.clearRect(0, 0, W, H);
      const drift = REDUCED ? 0 : 1;

      // Stars (alpha + fillStyle only; no per-star filters)
      const n = Math.min(stars.length, starLimit || stars.length);
      for (let i = 0; i < n; i++) {
        const s = stars[i];
        let x = (s.x + px * s.d * 20) % W; if (x < 0) x += W;
        let y = (s.y - time * s.d * 2.2 * drift + py * s.d * 10) % H; if (y < 0) y += H;
        const tw = REDUCED ? 1 : 0.62 + 0.38 * Math.sin(time * s.sp + s.ph);
        ctx.globalAlpha = s.a * tw;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, TAU);
        ctx.fill();
        if (s.glow) {
          const g = s.r * 9;
          ctx.globalAlpha = s.a * tw * 0.35;
          ctx.drawImage(sprites.white, x - g, y - g, g * 2, g * 2);
        }
      }

      // Floating glowing dust (additive)
      ctx.globalCompositeOperation = 'lighter';
      const dn = Math.min(dust.length, dustLimit || dust.length);
      for (let i = 0; i < dn; i++) {
        const d = dust[i];
        d.x += d.vx * dt * drift; d.y += d.vy * dt * drift;
        if (d.y < -30) { d.y = H + 30; d.x = rand(W); }
        if (d.x < -30) d.x = W + 30; else if (d.x > W + 30) d.x = -30;
        ctx.globalAlpha = d.a * intensity * (0.65 + 0.35 * Math.sin(time * 0.5 + d.ph));
        ctx.drawImage(d.spr, d.x - d.s / 2 + px * 8, d.y - d.s / 2, d.s, d.s);
      }
      ctx.globalCompositeOperation = 'source-over';

      // A few delicate hearts
      for (let i = 0; i < hearts.length; i++) {
        const h = hearts[i];
        if (!REDUCED) h.t += dt / h.life;
        if (h.t >= 1) { hearts[i] = newHeart(0); continue; }
        const p = REDUCED ? 0.5 : h.t;
        const a = Math.sin(Math.PI * p) * h.max;
        const x = h.x0 + Math.sin(p * 5 + h.ph) * 14 + px * 10;
        const y = h.y0 - p * h.rise;
        const sz = 64 * h.sc;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(x, y);
        ctx.rotate(Math.sin(p * 3 + h.ph) * 0.25);
        ctx.drawImage(sprites.heart, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }

      // Shooting stars
      for (let i = shooters.length - 1; i >= 0; i--) {
        const s = shooters[i];
        s.t += dt;
        const p = s.t / s.life;
        if (p >= 1) { shooters.splice(i, 1); continue; }
        s.x += s.vx * dt; s.y += s.vy * dt;
        const a = (1 - p) * Math.min(1, p * 9);
        const x2 = s.x - s.dx * s.len, y2 = s.y - s.dy * s.len;
        const g = ctx.createLinearGradient(s.x, s.y, x2, y2);
        g.addColorStop(0, `rgba(240,244,255,${a})`);
        g.addColorStop(1, 'rgba(150,140,255,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalAlpha = a * 0.8;
        ctx.drawImage(sprites.white, s.x - 7, s.y - 7, 14, 14);
      }

      // Birthday burst + soft shockwave ring
      if (ring) {
        ring.t += dt;
        const p = ring.t / ring.life;
        if (p >= 1) ring = null;
        else {
          const e = 1 - Math.pow(1 - p, 3);
          ctx.globalAlpha = Math.pow(1 - p, 2) * 0.4;
          ctx.strokeStyle = 'rgb(200,190,255)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(ring.cx, ring.cy, e * Math.hypot(W, H) * 0.55, 0, TAU); ctx.stroke();
        }
      }
      if (burstParts.length) {
        ctx.globalCompositeOperation = 'lighter';
        const damp = Math.exp(-1.15 * dt);
        for (let i = burstParts.length - 1; i >= 0; i--) {
          const b = burstParts[i];
          b.t += dt;
          const p = b.t / b.life;
          if (p >= 1) { burstParts.splice(i, 1); continue; }
          b.vx *= damp; b.vy *= damp;
          b.x += b.vx * dt; b.y += b.vy * dt - 6 * dt;
          ctx.globalAlpha = Math.pow(1 - p, 1.5) * Math.min(1, p * 12) * 0.95;
          ctx.drawImage(b.heart ? sprites.heart : b.spr, b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }

    function updateFlash(now) {
      let level = 0;
      if (flashStart >= 0) {
        const t = now - flashStart, rise = CONFIG.FINALE.flashRiseMs, fall = CONFIG.FINALE.flashFallMs;
        if (t < rise) { const k = t / rise; level = k * k * (3 - 2 * k); }
        else if (t < rise + fall) { const k = 1 - (t - rise) / fall; level = k * k * (3 - 2 * k); }
        else flashStart = -1;
      }
      if (Math.abs(level - flashLevel) > 0.002 || (level === 0 && flashLevel !== 0)) {
        flashLevel = level;
        flashEl.style.opacity = (level * CONFIG.FINALE.flashPeak / 0.34 * 0.9).toFixed(3);
      }
    }

    /* ---- loop ---- */
    function frame(ts) {
      rafId = requestAnimationFrame(frame);
      if (!last) last = ts;
      const raw = ts - last;
      last = ts;
      const dt = Math.min(0.05, raw / 1000);
      time += dt;

      // Smooth parallax: pointer + a slow idle sway so touch devices drift too
      const gx = tx + Math.sin(time * 0.07) * 0.35, gy = ty + Math.cos(time * 0.05) * 0.2;
      px += (gx - px) * Math.min(1, dt * 1.6);
      py += (gy - py) * Math.min(1, dt * 1.6);

      if (time > nextShoot && !REDUCED) {
        spawnShooter();
        nextShoot = time + (document.body.dataset.page === '3' ? rand(3.5, 8) : rand(8, 17));
      }

      draw(dt);
      updateFlash(ts);

      // Adaptive quality: if frames are consistently slow, quietly draw fewer particles
      frameAcc += raw; frameCount++;
      if (frameCount >= 90) {
        const avg = frameAcc / frameCount;
        if (avg > 24 && quality < 2) {
          quality++;
          starLimit = Math.floor(stars.length * (1 - 0.22 * quality));
          dustLimit = Math.floor(dust.length * (1 - 0.3 * quality));
        }
        frameAcc = 0; frameCount = 0;
      }
    }

    function start() {
      if (running || REDUCED) return;
      running = true; last = 0;
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    function init() {
      resize(true);
      let rt = 0;
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => resize(false), 150); });
      window.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        tx = (e.clientX / W - 0.5) * 2; ty = (e.clientY / H - 0.5) * 2;
      }, { passive: true });
      document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });
      start();
    }

    function onMotionChange() {
      if (REDUCED) { stop(); resetFlash(); shooters = []; draw(0); }
      else start();
    }

    return {
      init, burst, flash, resetFlash, onMotionChange,
      setIntensity(v) { intensity = v; }
    };
  })();

  /* =======================================================
     4. PAGE NAVIGATION
     ======================================================= */
  const pages = { 1: $('#page-1'), 2: $('#page-2'), 3: $('#page-3') };
  let current = 0;
  let busy = false;

  const hooks = {
    enter: { 1: enterPage1, 2: enterPage2, 3: enterPage3 },
    leave: { 1: leavePage1, 2: leavePage2, 3: leavePage3 }
  };

  async function goTo(n) {
    if (busy || n === current || !pages[n]) return;   // one transition at a time
    busy = true;
    if (current) {
      hooks.leave[current]();
      pages[current].classList.remove('active');
      await sleep(CONFIG.PAGE_FADE_MS);
    }
    current = n;
    document.body.dataset.page = String(n);
    pages[n].scrollTop = 0;
    pages[n].classList.add('active');
    Space.setIntensity(n === 3 ? 1.5 : 1);
    await sleep(CONFIG.PAGE_FADE_MS);
    hooks.enter[n]();
    busy = false;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) goTo(Number(b.dataset.go));
  });

  /* =======================================================
     5. PAGE 1 — OPENING LETTER
     ======================================================= */
  const glowEl = $('#center-glow');
  const btnToVideo = $('#btn-to-video');
  let introRun = 0;
  let introDone = false;

  async function enterPage1() {
    const run = ++introRun;
    const alive = () => run === introRun;
    const T = CONFIG.INTRO;
    const k = REDUCED ? 0.6 : 1;
    const msgs = $$('.msg');

    msgs.forEach((m) => m.classList.remove('show', 'out'));

    if (introDone) {                       // coming back: skip the sequence, keep the button
      document.body.classList.add('ready');
      glowEl.classList.add('on');
      btnToVideo.classList.add('in');
      return;
    }

    btnToVideo.classList.remove('in');
    await sleep(T.darkMs * k);                       if (!alive()) return;
    document.body.classList.add('ready');            // stars + nebula fade in (CSS)
    await sleep(T.glowDelayMs * k);                  if (!alive()) return;
    glowEl.classList.add('on');
    await sleep(T.firstMsgDelayMs * k);              if (!alive()) return;

    for (const m of msgs) {
      m.classList.add('show');
      await sleep((T.fadeInMs + T.holdMs) * k);      if (!alive()) return;
      m.classList.remove('show');
      m.classList.add('out');
      await sleep((T.fadeOutMs + T.gapMs) * k);      if (!alive()) return;
    }
    introDone = true;
    await sleep(T.buttonDelayMs * k);                if (!alive()) return;
    btnToVideo.classList.add('in');
  }
  function leavePage1() { introRun++; }              // cancels a sequence that is mid-way

  btnToVideo.addEventListener('click', () => goTo(2));

  /* =======================================================
     6. PAGE 2 — VIDEO
     ======================================================= */
  const video = $('#love-video');
  const shell = $('#video-shell');
  const orb = $('#video-play');
  const note = $('#video-note');
  let videoMissing = false;

  function showVideoNote() { videoMissing = true; note.hidden = false; orb.classList.add('off'); }

  video.addEventListener('loadedmetadata', () => {
    videoMissing = false; note.hidden = true;
    if (video.videoWidth && video.videoHeight) {
      shell.style.setProperty('--ar', (video.videoWidth / video.videoHeight).toFixed(4)); // no stretching, ever
    }
    if (video.paused) orb.classList.remove('off');
  });
  video.addEventListener('error', showVideoNote);
  const srcEl = video.querySelector('source');
  if (srcEl) srcEl.addEventListener('error', showVideoNote);
  video.addEventListener('play', () => orb.classList.add('off'));
  video.addEventListener('pause', () => { if (!videoMissing) orb.classList.remove('off'); });
  video.addEventListener('ended', () => { if (!videoMissing) orb.classList.remove('off'); });
  orb.addEventListener('click', () => { video.play().catch(() => {}); });   // user-initiated only; never autoplays

  function enterPage2() {
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && video.readyState === 0) showVideoNote();
  }
  function leavePage2() { video.pause(); }

  $('#btn-to-birthday').addEventListener('click', () => goTo(3));

  /* =======================================================
     7. PAGE 3 — COUNTDOWN + BIRTHDAY
     ======================================================= */
  const countEl = $('#count');
  const counterBox = $('#counter-box');
  const waitingEl = $('#waiting');
  const finaleBox = $('#finale-box');
  const titleEl = $('#final-title');
  const subEl = $('#final-sub');
  const replayBtn = $('#btn-replay');
  const back3 = $('#btn-back-3');

  const finaleSched = createScheduler();
  const cd = { timer: 0, wait: 0, shown: null, state: 'idle' };   // state: idle | waiting | running | finale

  function setCount(n) {
    if (cd.shown === n) return;
    cd.shown = n;
    countEl.textContent = String(n);
    if (!REDUCED) {                       // restart the fade + scale animation
      countEl.classList.remove('tick');
      void countEl.offsetWidth;
      countEl.classList.add('tick');
    }
  }

  // Clears EVERY timer belonging to the countdown, so two can never run at once.
  function stopCountdown() {
    clearInterval(cd.timer); cd.timer = 0;
    clearTimeout(cd.wait);   cd.wait = 0;
    finaleSched.clear();
  }

  function resetFinaleDom() {
    counterBox.classList.remove('done');
    waitingEl.hidden = true;
    countEl.hidden = false;
    countEl.classList.remove('tick');
    [titleEl, subEl].forEach((el) => el.classList.remove('in'));
    replayBtn.classList.remove('in');
    finaleBox.classList.remove('live');
    back3.classList.add('off');
    Space.resetFlash();
  }

  // endPerf is a performance.now() timestamp: the instant the number should hit 0.
  function startCountdown(endPerf) {
    stopCountdown();
    resetFinaleDom();
    cd.state = 'running';
    cd.shown = null;
    setCount(Math.max(0, Math.ceil((endPerf - performance.now()) / 1000)));
    cd.timer = setInterval(() => {
      const rem = endPerf - performance.now();     // timestamp-based, so tab throttling can't make it drift
      setCount(Math.max(0, Math.ceil(rem / 1000)));
      if (rem <= 0) {
        clearInterval(cd.timer); cd.timer = 0;
        finaleSched.later(runFinale, CONFIG.ZERO_HOLD_MS);
      }
    }, 100);
  }

  function runFinale() {
    cd.state = 'finale';
    const F = CONFIG.FINALE;
    const k = REDUCED ? 0.4 : 1;
    counterBox.classList.add('done');                      // number fades away
    finaleSched.later(() => {
      Space.flash();                                       // galaxy gently brightens
      Space.burst();                                       // stars + particles expand from the centre
      titleEl.classList.add('in');
    }, F.burstDelayMs * k);
    finaleSched.later(() => subEl.classList.add('in'), (F.burstDelayMs + F.subDelayMs) * k);
    finaleSched.later(() => {
      replayBtn.classList.add('in');
      finaleBox.classList.add('live');
      back3.classList.remove('off');
    }, (F.burstDelayMs + F.subDelayMs + F.buttonDelayMs) * k);
  }

  function enterPage3() {
    const secs = CONFIG.COUNTDOWN_SECONDS;
    const target = CONFIG.REAL_BIRTHDAY ? Date.parse(CONFIG.REAL_BIRTHDAY) : NaN;

    if (Number.isFinite(target) && target - Date.now() > 0) {
      const begin = () => startCountdown(performance.now() + Math.max(0, target - Date.now()));
      const check = () => {
        const wait = target - Date.now() - secs * 1000;
        if (wait <= 0) { begin(); return; }
        cd.wait = setTimeout(check, Math.min(wait, 2 ** 30));   // re-checks, so long waits stay accurate
      };
      if (target - Date.now() - secs * 1000 > 0) {
        stopCountdown();
        resetFinaleDom();
        cd.state = 'waiting';
        countEl.hidden = true;
        waitingEl.hidden = false;
        back3.classList.remove('off');                          // allow leaving while it waits
      }
      check();
      return;
    }
    startCountdown(performance.now() + secs * 1000);            // default: plain 19-second animation
  }

  function leavePage3() {
    stopCountdown();
    cd.state = 'idle';
    resetFinaleDom();
  }

  replayBtn.addEventListener('click', () => {
    if (cd.state !== 'finale') return;
    startCountdown(performance.now() + CONFIG.COUNTDOWN_SECONDS * 1000);   // restarts without reloading
  });

  /* =======================================================
     8. BOOT
     ======================================================= */
  function boot() {
    const r = document.documentElement.style;
    r.setProperty('--msg-in', CONFIG.INTRO.fadeInMs + 'ms');
    r.setProperty('--msg-out', CONFIG.INTRO.fadeOutMs + 'ms');
    r.setProperty('--page-fade', CONFIG.PAGE_FADE_MS + 'ms');

    Space.init();

    motionQuery.addEventListener('change', (e) => { REDUCED = e.matches; Space.onMotionChange(); });

    // Wait briefly for web fonts so the first message doesn't swap fonts mid-fade
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, sleep(1500)]).then(() => goTo(1));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();