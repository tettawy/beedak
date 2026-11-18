/* بإيدك v3: page behaviour for index.html and terms.html. Classic script (works from file://), no libraries.
   Both pages are fully readable without this file; everything here is an enhancement.
   When it runs it adds the class "app" to <html>; CSS shows the interactive parts only then.
   Motion: every animation lives under html.motion-on. The inline <head> script sets it before first paint;
   initMotion() owns it afterwards (pause buttons, saved choice, reduced motion, data saver, low memory). */

/* The WhatsApp booking number (owner decision, 15 Nov 2026: +20 106 853 0159).
   International form without "+" or spaces. Every booking link (a[data-wa]) opens
   https://wa.me/<number>?text=<the case message>; the HTML already carries the same link with the empty
   message template, so it also works without JS. If the number ever changes, change it here AND in the
   data-wa hrefs and the visible number in index.html / terms.html. */
var BOOKING_NUMBER = '201068530159';

(function () {
  'use strict';

  var html = document.documentElement;
  var MOTION_KEY = 'beedak-motion';
  var rmQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(rmQuery && rmQuery.matches);
  var finePointer = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  var motionListeners = [];

  function motionOn() { return html.classList.contains('motion-on'); }
  function onMotion(fn) { motionListeners.push(fn); }
  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { /* not allowed here */ } }
  function restartClass(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  /* ---------- Motion switch: state, three synced pause buttons, saved choice ---------- */
  function readSaved() { try { return window.localStorage.getItem(MOTION_KEY); } catch (e) { return null; } }
  function writeSaved(v) { try { window.localStorage.setItem(MOTION_KEY, v); } catch (e) { /* storage blocked: the choice lasts for this page only */ } }
  function lightDevice() {
    var c = navigator.connection;
    return !!((c && c.saveData === true) || (navigator.deviceMemory && navigator.deviceMemory <= 2));
  }
  function computeMotion() {
    if (reduced) return false;
    var s = readSaved();
    if (s === 'off') return false;
    if (s === 'on') return true;
    return !lightDevice();
  }
  function initMotion() {
    var toggles = document.querySelectorAll('.motion-toggle');
    function apply(on) {
      var was = motionOn();
      html.classList.toggle('rm', reduced);
      html.classList.toggle('motion-on', on);
      each(toggles, function (t) {
        var label = t.querySelector('.mt-label');
        if (label) label.textContent = on ? 'وقّفوا الحركة' : 'شغّلوا الحركة';
      });
      if (was !== on) motionListeners.forEach(function (fn) { try { fn(on); } catch (e) { /* one listener must not stop the others */ } });
    }
    each(toggles, function (t) {
      t.addEventListener('click', function () {
        var next = !motionOn();
        writeSaved(next ? 'on' : 'off');
        apply(next);
      });
    });
    if (rmQuery) {
      var onRm = function (e) { reduced = e.matches; apply(computeMotion()); };
      if (rmQuery.addEventListener) rmQuery.addEventListener('change', onRm); else if (rmQuery.addListener) rmQuery.addListener(onRm);
    }
    apply(computeMotion());
  }

  /* ---------- Sparks: a small burst on the visitor's own completions (motion on only) ---------- */
  var SPARK_COLORS = ['#3DF58C', '#A78BFA', '#E9EEF3'];
  function sparks(x, y, count) {
    if (!motionOn() || !document.body.animate) return;
    count = count || 14;
    for (var i = 0; i < count; i++) {
      var d = document.createElement('span');
      d.className = 'spark';
      d.setAttribute('aria-hidden', 'true');
      d.style.left = (x - 4) + 'px';
      d.style.top = (y - 4) + 'px';
      d.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
      document.body.appendChild(d);
      var a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      var r = 40 + Math.random() * 50;
      var anim = d.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + Math.cos(a) * r + 'px,' + (Math.sin(a) * r + 20) + 'px) scale(.3)', opacity: 0 }
      ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.2,.7,.2,1)' });
      anim.onfinish = (function (el) { return function () { el.remove(); }; })(d);
    }
  }
  function sparksAt(el, count) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    sparks(r.left + r.width / 2, r.top + r.height / 2, count);
  }

  /* ---------- Shared pointer (mouse, pen, finger): read by the background, the duck and the panel glow ---------- */
  var ptr = { x: -9999, y: -9999, has: false, touch: false, down: false, target: null };
  function initPointer() {
    function set(x, y, touch, target) { ptr.x = x; ptr.y = y; ptr.has = true; ptr.touch = touch; if (target) ptr.target = target; }
    window.addEventListener('pointermove', function (e) { set(e.clientX, e.clientY, e.pointerType !== 'mouse', e.target); }, { passive: true });
    window.addEventListener('pointerdown', function (e) { set(e.clientX, e.clientY, e.pointerType !== 'mouse', e.target); if (e.pointerType !== 'mouse') ptr.down = true; }, { passive: true });
    window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') ptr.down = false; }, { passive: true });
    // While a finger scrolls the page the browser cancels the pointer, so touch events keep the lens under the finger.
    window.addEventListener('touchstart', function (e) { var t = e.touches[0]; if (t) set(t.clientX, t.clientY, true, e.target); ptr.down = true; }, { passive: true });
    window.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) set(t.clientX, t.clientY, true); ptr.down = true; }, { passive: true });
    window.addEventListener('touchend', function () { ptr.down = false; }, { passive: true });
    window.addEventListener('touchcancel', function () { ptr.down = false; }, { passive: true });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) ptr.has = false; });
  }

  /* ---------- The interactive code background: one canvas, three blurred depth layers, a zoom lens under the pointer,
     sparse falling "hacker" streams, and a code burst on taps on empty background. aria-hidden, never focusable.
     It runs only with motion on and the tab visible; otherwise it draws one still frame. ---------- */
  var BG_LINES = {
    r: ['throw new Error("timeout");', 'if (!res.ok) throw new Error("500");', 'KeyError: \'owner\'', 'Segmentation fault (core dumped)', 'NULL',
      'TypeError: plan is undefined', 'CONFLICT (content): merge conflict in main.c', 'ERROR 1064 (42000): syntax error', 'WiFi.status() != WL_CONNECTED',
      'Traceback (most recent call last):', 'npm ERR! code ELIFECYCLE', 'FAIL  plan.test.js  // مثال', 'ECONNREFUSED 127.0.0.1:3306', 'stack overflow', '401 Unauthorized'],
    v: ['while (!plan.owner) { await standup(); }', '// TODO: who owns this?', 'git rebase --continue', 'WiFi.begin(ssid, pass);', 'if (deadline < today)',
      'await fetch("/api/plan")', 'lock.acquire()', '#include <WiFi.h>', 'for (int i = 0; i < n; i++)', 'def trace(report):', 'git checkout -b fix/login',
      'SELECT owner FROM tasks;', 'Serial.begin(115200);', 'pinMode(2, OUTPUT);', 'model.fit(X_train, y_train)'],
    g: ['digitalWrite(LED_PIN, HIGH);', 'res.status(200).json(plan);', 'assert plan.next and plan.due', 'PASS  plan.owner', 'git merge --no-ff feature',
      'SELECT * FROM tasks WHERE owner IS NOT NULL;', 'return 0;', 'print("connected")', 'exit 0', 'expect(plan.due).toBeDefined();', '200 OK',
      'const team = await read(case);', 'git push origin main', 'printf("ok\\n");', 'accuracy = model.score(X_test, y_test)']
  };
  var RAIN = ['0x3F', 'sudo', 'ssh', 'GET /api', 'AT+CWJAP', 'digitalWrite(2,HIGH)', 'SELECT * FROM', 'git push', '401', 'ERROR', 'OK', '0xDEADBEEF',
    'chmod +x', 'make', 'npm test', '200', 'Serial.read()', 'ping', '0x7F', 'WL_CONNECTED', 'rm -rf build', 'curl -I'];
  var BURST_WORDS = ['{}', '0x1F', ';', '=>', 'ok', '</>', '01', 'fix()', '&&', '[]', 'PASS', '0x0'];
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  var bg = null; // public handle: burst() and sync() for other parts, numbers for the tests

  function initBgfx() {
    var root = document.querySelector('.bgfx');
    var cv = root && root.querySelector('canvas');
    var ctx = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!ctx) return;
    var FONT = '"Beedak Mono Ar", "Cascadia Mono", Consolas, Menlo, "SF Mono", "Roboto Mono", "DejaVu Sans Mono", monospace';
    var COL = { r: '255,77,94', v: '167,139,250', g: '61,245,140' };
    var HEAD = { r: '255,214,218', g: '214,255,230' };
    var DEPTH = [ // far -> near: smaller and more blurred far away, sharper close up
      { size: 11, blur: 2.6, a: .34, par: 5, scroll: .06, drift: 3 },
      { size: 13, blur: 1.5, a: .42, par: 11, scroll: .14, drift: 6 },
      { size: 15, blur: .8, a: .5, par: 20, scroll: .26, drift: 10 }
    ];
    var mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
    var quality = (mem <= 2 || cores <= 2) ? .5 : (mem <= 4 || cores <= 4) ? .75 : 1;
    var seed = (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0; // new layout on every load
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var W = 0, H = 0, wrapH = 1, docH = 1, tokens = [], streams = [], bursts = [], sprites = {};
    var running = false, raf = 0, lastT = 0, clock = 0, nextStream = 0, maxStreams = 3, slow = 0;
    var par = { x: 0, y: 0 }, lens = { x: -999, y: -999, s: 0 };
    var stat = { frames: 0, tokens: 0, streams: 0, bursts: 0, lens: 0, repaired: 0, running: false, quality: quality, seed: seed };

    function sprite(text, col, d) {
      var key = d + '|' + col + '|' + text;
      var sp = sprites[key];
      if (sp) return sp;
      var D = DEPTH[d], pad = Math.ceil(D.blur * 3 + 2);
      var c = document.createElement('canvas');
      var x = c.getContext('2d');
      x.font = D.size + 'px ' + FONT;
      var w = Math.ceil(x.measureText(text).width) + pad * 2, h = Math.ceil(D.size * 1.5) + pad * 2;
      c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
      x.scale(dpr, dpr);
      x.font = D.size + 'px ' + FONT;
      x.textBaseline = 'middle';
      x.fillStyle = 'rgb(' + COL[col] + ')';
      // Blur through a shadow cast from off-canvas text: baked once per sprite, works in every browser.
      x.shadowColor = 'rgb(' + COL[col] + ')';
      x.shadowBlur = D.blur * 2 * dpr;
      x.shadowOffsetX = 10000 * dpr;
      x.fillText(text, pad - 10000, h / 2);
      sp = sprites[key] = { c: c, w: w, h: h, pad: pad, tw: w - pad * 2 };
      return sp;
    }
    function build() {
      var r = rng(seed);
      var n = Math.round(clamp((W * H) / 15000, 24, 92) * quality);
      wrapH = H + 160;
      tokens = [];
      for (var i = 0; i < n; i++) {
        var rd = r(), d = rd < .4 ? 0 : rd < .76 ? 1 : 2;
        var rc = r(), col = rc < .4 ? 'r' : rc < .68 ? 'v' : 'g';
        var list = BG_LINES[col];
        tokens.push({ text: list[Math.floor(r() * list.length)], col: col, d: d, x: r() * (W + 140) - 70, y: r() * wrapH,
          a: .6 + r() * .4, thr: col === 'g' ? 9 : .1 + r() * 1.05, fix: 0, rep: 0 });
      }
      tokens.sort(function (a, b) { return a.d - b.d; });
      stat.tokens = tokens.length;
    }
    function place(tk, sy, drift) {
      var D = DEPTH[tk.d], y = tk.y - sy * D.scroll - drift * D.drift;
      return ((y % wrapH) + wrapH) % wrapH - 80 - par.y * D.par * 2;
    }
    function measureDoc() { docH = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); }
    function resize() {
      var w = document.documentElement.clientWidth, h = window.innerHeight;
      var widthChanged = w !== W;
      if (!widthChanged && h <= H) return; // the phone URL bar: only ever grow, never rebuild
      W = w; H = widthChanged ? h : Math.max(h, H);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.height = H + 'px';
      if (widthChanged || !tokens.length) build(); else wrapH = H + 160;
      maxStreams = W < 600 ? 3 : 6;
      measureDoc();
      if (!running) draw(0, false);
    }
    function repairAmount(tk, now) {
      if (!tk.rep) return 0;
      var e = now - tk.rep;
      if (e < 380) return 0;                       // scrambling
      if (e < 2980) return 1;                      // repaired: green
      if (e < 4580) return 1 - (e - 2980) / 1600;  // slowly drifts back
      tk.rep = 0;
      return 0;
    }
    var SCR = '01<>/{}[]#$%&*+=?;:abcdefx';
    function scrambled(text, e) {
      var n = Math.floor(text.length * e / 380), s = '', k0 = Math.floor(e / 50);
      for (var k = 0; k < text.length; k++) s += (k < n || text[k] === ' ') ? text[k] : SCR[(k * 7 + k0 * 13) % SCR.length];
      return s;
    }
    function draw(t, live) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var sy = window.scrollY || window.pageYOffset || 0;
      var prog = clamp(sy / docH, 0, 1);
      var tx = 0, ty = 0;
      if (live && ptr.has) { tx = ptr.x / W - .5; ty = ptr.y / H - .5; }
      par.x += (tx - par.x) * (live ? .06 : 1); par.y += (ty - par.y) * (live ? .06 : 1);
      var want = live && ptr.has && (!ptr.touch || ptr.down) ? 1 : 0;
      lens.s += (want - lens.s) * (want ? .16 : .07);
      if (lens.s < .01) lens.s = 0;
      if (ptr.has) {
        if (lens.s < .05) { lens.x = ptr.x; lens.y = ptr.y; }
        else { lens.x += (ptr.x - lens.x) * .22; lens.y += (ptr.y - lens.y) * .22; }
      }
      stat.lens = Math.round(lens.s * 100) / 100;
      var R = W < 600 ? 100 : 125, Z = 1.24, drift = clock / 1000, inLens = [], scr = 0;
      for (var i = 0; i < tokens.length; i++) {
        var tk = tokens[i], D = DEPTH[tk.d];
        var y = place(tk, sy, drift), x = tk.x - par.x * D.par * 2;
        // the story of the page: the further down the reader goes, the more red / violet code turns green
        var goal = prog > tk.thr ? 1 : 0;
        tk.fix = live ? tk.fix + (goal - tk.fix) * .04 : goal;
        var sp = sprite(tk.text, tk.col, tk.d);
        var cx = x + sp.tw / 2, dx = cx - lens.x, dy = y - lens.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var f = lens.s ? lens.s * (1 - smooth(R * .45, R, dist)) : 0;
        if (live && f > .55 && tk.col !== 'g' && !tk.rep && scr < 8) { tk.rep = t; stat.repaired++; }
        if (tk.rep && t - tk.rep < 380) scr++;
        var g = tk.col === 'g' ? 1 : Math.max(tk.fix, repairAmount(tk, t));
        var alpha = D.a * tk.a * (1 - f * .9);
        if (alpha > .01 && y > -40 && y < H + 40) {
          if (g < .99) { ctx.globalAlpha = alpha * (1 - g); ctx.drawImage(sp.c, x - sp.pad, y - sp.h / 2, sp.w, sp.h); }
          if (g > .01) { var gs = sprite(tk.text, 'g', tk.d); ctx.globalAlpha = alpha * g; ctx.drawImage(gs.c, x - gs.pad, y - gs.h / 2, gs.w, gs.h); }
        }
        if (f > .02) inLens.push([tk, x, y, f, g]);
      }
      if (live && lens.s > 0) {
        // the lens: a soft light, then the same code zoomed and sharp inside a circle
        var grd = ctx.createRadialGradient(lens.x, lens.y, 0, lens.x, lens.y, R * 1.15);
        grd.addColorStop(0, 'rgba(61,245,140,' + (.07 * lens.s) + ')');
        grd.addColorStop(1, 'rgba(61,245,140,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = grd;
        ctx.fillRect(lens.x - R * 1.2, lens.y - R * 1.2, R * 2.4, R * 2.4);
        ctx.save();
        ctx.beginPath(); ctx.arc(lens.x, lens.y, R, 0, Math.PI * 2); ctx.clip();
        ctx.textBaseline = 'middle';
        for (var j = 0; j < inLens.length; j++) {
          var it = inLens[j], k = it[0], DD = DEPTH[k.d];
          var lx = lens.x + (it[1] - lens.x) * Z, ly = lens.y + (it[2] - lens.y) * Z;
          var e = k.rep ? t - k.rep : 999;
          var green = e < 380 || it[4] > .5;
          ctx.font = (DD.size * Z) + 'px ' + FONT;
          ctx.fillStyle = 'rgb(' + COL[green ? 'g' : k.col] + ')';
          ctx.globalAlpha = Math.min(.95, DD.a * 1.7 + .12) * it[3];
          ctx.fillText(e < 380 ? scrambled(k.text, e) : k.text, lx, ly);
        }
        ctx.restore();
        ctx.globalAlpha = .1 * lens.s; ctx.strokeStyle = '#E9EEF3'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(lens.x, lens.y, R, 0, Math.PI * 2); ctx.stroke();
      }
      if (live) { drawStreams(t); drawBursts(t); }
      ctx.globalAlpha = 1;
    }
    function drawStreams(t) {
      if (t > nextStream && streams.length < maxStreams) {
        streams.push({ x: 10 + Math.random() * (W - 20), y: -10, v: 45 + Math.random() * 70, txt: RAIN[Math.floor(Math.random() * RAIN.length)], col: Math.random() < .25 ? 'r' : 'g', size: W < 600 ? 13 : 14 });
        nextStream = t + (W < 600 ? 1600 + Math.random() * 2400 : 800 + Math.random() * 1900);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var i = streams.length - 1; i >= 0; i--) {
        var s = streams[i], n = s.txt.length, lh = s.size * 1.18;
        s.y += s.v * stepDt / 1000;
        if (s.y - n * lh > H) { streams.splice(i, 1); continue; }
        ctx.font = s.size + 'px ' + FONT;
        for (var c = 0; c < n; c++) {
          var cy = s.y - (n - 1 - c) * lh;
          if (cy < -lh || cy > H + lh) continue;
          var head = c === n - 1;
          ctx.globalAlpha = head ? .6 : .38 * Math.pow((c + 1) / n, 1.5);
          ctx.fillStyle = 'rgb(' + (head ? HEAD[s.col] : COL[s.col]) + ')';
          ctx.fillText(s.txt[c], s.x, cy);
        }
      }
      ctx.textAlign = 'start';
      stat.streams = streams.length;
    }
    function drawBursts(t) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var i = bursts.length - 1; i >= 0; i--) {
        var b = bursts[i], e = (t - b.t0) / 900;
        if (e >= 1) { bursts.splice(i, 1); continue; }
        if (e < 0) continue;
        var ease = 1 - Math.pow(1 - e, 3);
        ctx.globalAlpha = .35 * (1 - e); ctx.strokeStyle = 'rgb(' + COL.g + ')'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, 8 + 64 * ease, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '13px ' + FONT;
        for (var p = 0; p < b.parts.length; p++) {
          var q = b.parts[p];
          ctx.globalAlpha = .8 * (1 - e);
          ctx.fillStyle = 'rgb(' + COL[q.col] + ')';
          ctx.fillText(q.txt, b.x + q.vx * ease, b.y + q.vy * ease + 18 * e * e);
        }
      }
      ctx.textAlign = 'start';
    }
    var stepDt = 16;
    function frame(t) {
      raf = 0;
      if (!running) return;
      stepDt = lastT ? Math.min(64, t - lastT) : 16;
      lastT = t;
      clock += stepDt;
      // frame budget: if frames stay slow (under ~38 fps) for about 2 seconds, drop a quarter of the code and one stream
      if (stepDt > 26) slow++; else if (slow > 0) slow -= .5;
      if (slow > 90 && tokens.length > 16) {
        tokens = tokens.filter(function (_, k) { return k % 4 !== 0; });
        maxStreams = Math.max(1, maxStreams - 1); slow = 0; stat.tokens = tokens.length;
      }
      draw(t, true);
      stat.frames++;
      raf = window.requestAnimationFrame(frame);
    }
    function sync() {
      var go = motionOn() && !document.hidden && W > 0;
      if (go && !running) { running = true; stat.running = true; lastT = 0; raf = window.requestAnimationFrame(frame); }
      else if (!go && running) {
        running = false; stat.running = false;
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0; streams = []; bursts = []; lens.s = 0;
        tokens.forEach(function (tk) { tk.rep = 0; });
        draw(0, false); // a still frame: same code, no motion, no pointer effects
      }
    }
    function burst(x, y) {
      if (!running) return;
      var parts = [];
      for (var i = 0; i < 10; i++) {
        var a = (i / 10) * Math.PI * 2 + Math.random() * .5, d = 46 + Math.random() * 46;
        parts.push({ txt: BURST_WORDS[Math.floor(Math.random() * BURST_WORDS.length)], vx: Math.cos(a) * d, vy: Math.sin(a) * d, col: i % 4 === 3 ? 'v' : 'g' });
      }
      var now = window.performance.now();
      bursts.push({ x: x, y: y, t0: now, parts: parts });
      if (bursts.length > 4) bursts.shift();
      stat.bursts++;
      // the tap also repairs the code around it
      var sy = window.scrollY || window.pageYOffset || 0;
      tokens.forEach(function (tk) {
        if (tk.col === 'g' || tk.rep) return;
        var dx = tk.x - par.x * DEPTH[tk.d].par * 2 - x, dy = place(tk, sy, clock / 1000) - y;
        if (dx * dx + dy * dy < 150 * 150) { tk.rep = now; stat.repaired++; }
      });
    }
    var EMPTY_STOP = 'a, button, input, select, textarea, label, summary, details, [role="button"], p, h1, h2, h3, h4, li, dt, dd, figure, pre, code, .prop, .duck-peek, .term, .card, .page, .box, .builder, .action, .palette, .hint, .info-block, .outline, .draft, .mobile-bar, .topbar, .foot, .scrim, .steps, .gitgraph, .untangle, .flips';
    document.addEventListener('pointerdown', function (e) {
      if (!running || e.button > 0) return;
      var el = e.target;
      if (el && el.closest && el.closest(EMPTY_STOP)) return;
      burst(e.clientX, e.clientY);
    }, { passive: true });

    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    var started = false;
    function begin() {
      if (started) return;
      started = true;
      resize();
      root.classList.add('live');
      sync();
    }
    ready.then(begin);
    window.setTimeout(begin, 900);
    var rt = 0;
    window.addEventListener('resize', function () { window.clearTimeout(rt); rt = window.setTimeout(resize, 150); }, { passive: true });
    window.addEventListener('load', measureDoc);
    window.setInterval(function () { if (running) measureDoc(); }, 3000);
    document.addEventListener('visibilitychange', sync);
    onMotion(sync);
    bg = { burst: burst, sync: sync, stat: stat };
    window.__bgfx = stat;
  }

  /* ---------- The duck peeks up from behind the headline, looks around, winks (CSS, about 2s), then follows the pointer.
     Hover / tap: wink + a small bounce. Paused or reduced motion: a still peek; a tap toggles a still wink. ---------- */
  var duckApi = null;
  function initDuckPeek() {
    var d = $('duck-peek');
    if (!d) return;
    var head = d.querySelector('.dp-head');
    var wt = 0;
    function finish() { d.classList.add('duck-done'); }
    if (!motionOn()) finish(); else window.setTimeout(finish, 2300);
    function wink() {
      if (motionOn()) {
        d.classList.remove('winked');
        restartClass(d, 'winking');
        window.clearTimeout(wt);
        wt = window.setTimeout(function () { d.classList.remove('winking'); }, 650);
      } else {
        d.classList.toggle('winked');
      }
    }
    d.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' && motionOn() && d.classList.contains('duck-done')) wink(); });
    d.addEventListener('click', function () { wink(); buzz(8); });
    onMotion(function (on) {
      finish();
      d.classList.remove('winking');
      if (!on && head) head.style.transform = '';
    });
    duckApi = {
      look: function (x, y) { // gaze: turn the head toward the pointer (motion on, after the intro)
        if (!head || !motionOn() || !d.classList.contains('duck-done')) return;
        var r = d.getBoundingClientRect();
        if (r.bottom < -100 || r.top > window.innerHeight + 100) return;
        var dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
        var ang = clamp(dx / 260, -1, 1) * 11 + clamp(dy / 400, -1, 1) * (dx < 0 ? -3 : 3);
        head.style.transform = 'translateX(' + clamp(dx / 80, -4, 4).toFixed(1) + 'px) rotate(' + ang.toFixed(1) + 'deg)';
      }
    };
  }

  /* ---------- Project props (ESP32, API, DB, git, gauge, Arduino, PCB): hover lights them up, a tap toggles them (4s on touch) ---------- */
  var gaugeApi = null;
  function initProps() {
    each(document.querySelectorAll('.prop'), function (p) {
      var off = 0;
      function on(v) { p.classList.toggle('is-on', v); if (p === gauge) gaugeZone(v ? 0 : null); }
      p.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { window.clearTimeout(off); on(true); } });
      p.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { window.clearTimeout(off); off = window.setTimeout(function () { on(false); }, 700); } });
      p.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;
        window.clearTimeout(off);
        var v = !p.classList.contains('is-on');
        on(v);
        if (v) off = window.setTimeout(function () { on(false); }, 4000);
        buzz(8);
      });
    });
    // the gauge needle follows the pointer while the gauge is on screen: LOW / OK / HIGH
    var gauge = $('prop-gauge');
    if (!gauge) return;
    var seen = false;
    function gaugeZone(a) {
      if (a === null) a = -62;
      gauge.style.setProperty('--a', a + 'deg');
      var z = a < -27 ? 'z-low' : a > 27 ? 'z-high' : 'z-ok';
      if (!gauge.classList.contains(z)) { gauge.classList.remove('z-low', 'z-ok', 'z-high'); gauge.classList.add(z); }
    }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; }).observe(gauge);
    gaugeApi = {
      follow: function (x) {
        if (!seen || !motionOn() || gauge.classList.contains('is-on')) return;
        var r = gauge.getBoundingClientRect();
        gaugeZone(Math.round(clamp((x - (r.left + r.width / 2)) / 320, -1, 1) * 80));
      }
    };
    onMotion(function (on) { if (!on && !gauge.classList.contains('is-on')) gaugeZone(null); });
  }

  /* ---------- Pointer reactions: cursor-follow glow on panels, a slight tilt on cards, magnetic buttons, the duck's gaze.
     One pointermove listener, one write per frame. Mouse only for glow / tilt / magnet; the duck also follows a finger. ---------- */
  var GLOW_SEL = '.card, .term, .page, .box, .season li, .faq details, .steps li, .builder, .action, .palette, .duck-note, .tsec, .outline, .referral .n, .about-list li, .info-block, .hint, .untangle, .plan-item, .flip .face';
  var TILT_SEL = '.card, .season li, .box, .steps li, .referral .n';
  function initPointerFx() {
    var queued = false, glowEl = null, tiltEl = null, magEl = null, lastTouchGlow = 0;
    function clearGlow() { if (glowEl) { glowEl.style.removeProperty('--mx'); glowEl.style.removeProperty('--my'); glowEl = null; } }
    function clearTilt() { if (tiltEl) { tiltEl.style.transform = ''; tiltEl.classList.remove('tilt'); tiltEl = null; } }
    function clearMag() { if (magEl) { magEl.style.translate = ''; magEl = null; } }
    function frame() {
      queued = false;
      var x = ptr.x, y = ptr.y, t = ptr.target;
      if (duckApi) duckApi.look(x, y);
      if (gaugeApi && !ptr.touch) gaugeApi.follow(x);
      if (!motionOn()) { clearGlow(); clearTilt(); clearMag(); return; }
      if (ptr.touch) return; // touch gets its glow from taps (below)
      var g = t && t.closest ? t.closest(GLOW_SEL) : null;
      if (g !== glowEl) clearGlow();
      if (g) {
        var r = g.getBoundingClientRect();
        g.style.setProperty('--mx', Math.round(x - r.left) + 'px');
        g.style.setProperty('--my', Math.round(y - r.top) + 'px');
        glowEl = g;
      }
      var tl = t && t.closest ? t.closest(TILT_SEL) : null;
      if (tl !== tiltEl) clearTilt();
      if (tl) {
        var rr = tl === g ? r : tl.getBoundingClientRect();
        var rx = ((y - rr.top) / rr.height - .5) * -3, ry = ((x - rr.left) / rr.width - .5) * 3;
        tl.classList.add('tilt');
        tl.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
        tiltEl = tl;
      }
      var b = t && t.closest ? t.closest('.btn') : null;
      if (b !== magEl) clearMag();
      if (b && !b.closest('.mobile-bar')) {
        var br = b.getBoundingClientRect();
        var cur = (b.style.translate || '0px 0px').split(' ');
        var cx = br.left - (parseFloat(cur[0]) || 0) + br.width / 2, cy = br.top - (parseFloat(cur[1]) || 0) + br.height / 2;
        b.style.translate = clamp((x - cx) * .12, -7, 7).toFixed(1) + 'px ' + clamp((y - cy) * .2, -4, 4).toFixed(1) + 'px';
        magEl = b;
      }
    }
    function request() { if (!queued) { queued = true; window.requestAnimationFrame(frame); } }
    window.addEventListener('pointermove', request, { passive: true });
    window.addEventListener('touchmove', request, { passive: true });
    window.addEventListener('scroll', function () { if (glowEl || tiltEl || magEl) { clearTilt(); clearMag(); } }, { passive: true });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) { clearGlow(); clearTilt(); clearMag(); } });
    // touch: a short glow where the finger lands, and the duck looks there
    document.addEventListener('pointerdown', function (e) {
      request();
      if (e.pointerType === 'mouse' || !motionOn()) return;
      var g = e.target && e.target.closest ? e.target.closest(GLOW_SEL) : null;
      if (!g) return;
      clearGlow();
      var r = g.getBoundingClientRect();
      g.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
      g.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
      glowEl = g;
      var stamp = lastTouchGlow = Date.now();
      window.setTimeout(function () { if (lastTouchGlow === stamp) clearGlow(); }, 900);
    }, { passive: true });
    onMotion(function (on) { if (!on) { clearGlow(); clearTilt(); clearMag(); } });
  }

  /* ---------- Code tokens decode (Latin only, aria-hidden): once when they enter the view, again on hover / tap of their block ---------- */
  var SCR_SEL = '.eyebrow .tok, .term-title, .card-cmd, .cron, .stage, .rv, .cmt-label, .split-fn, .fn, .tab .tok, .mw .tok, .band-cmd, .tcode bdi, .root-label, .crumb';
  var SCR_HOST = '.card, .season li, .steps li, .head, .case-intro, .book-head, .term, .tsec, .page, .flip, .outline a, .method, .about-head, .band-in';
  var SCR_CHARS = '01<>/{}[]#$%&*+=?;:abcdefx';
  function scrambleEl(el) {
    if (!motionOn() || el._scr) return;
    var node = null;
    for (var i = el.childNodes.length - 1; i >= 0; i--) {
      var c = el.childNodes[i];
      if (c.nodeType === 3 && c.nodeValue.trim()) { node = c; break; }
    }
    if (!node || /[؀-ۿ]/.test(node.nodeValue)) return;
    var orig = node.nodeValue, t0 = 0, last = -1;
    el._scr = true;
    function step(t) {
      if (!t0) t0 = t;
      var e = Math.min(1, (t - t0) / 420);
      var k0 = Math.floor((t - t0) / 45);
      if (k0 !== last) {
        last = k0;
        var n = Math.floor(orig.length * e), s = '';
        for (var k = 0; k < orig.length; k++) { var ch = orig[k]; s += (k < n || ch === ' ') ? ch : SCR_CHARS[(k * 5 + k0 * 11) % SCR_CHARS.length]; }
        node.nodeValue = s;
      }
      if (e < 1 && motionOn()) window.requestAnimationFrame(step);
      else { node.nodeValue = orig; el._scr = false; }
    }
    window.requestAnimationFrame(step);
  }
  function initScramble() {
    var els = document.querySelectorAll(SCR_SEL);
    if (!els.length) return;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); scrambleEl(e.target); } });
      }, { threshold: 1 });
      each(els, function (el) { io.observe(el); });
    }
    var lastHost = null, lastAt = 0;
    function hostRun(target) {
      var h = target && target.closest ? target.closest(SCR_HOST) : null;
      if (!h || !motionOn()) return;
      var now = Date.now();
      if (h === lastHost && now - lastAt < 2500) return;
      lastHost = h; lastAt = now;
      each(h.querySelectorAll(SCR_SEL), scrambleEl);
      if (h.matches(SCR_SEL)) scrambleEl(h);
    }
    document.addEventListener('pointerover', function (e) { if (e.pointerType === 'mouse') hostRun(e.target); }, { passive: true });
    document.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') hostRun(e.target); }, { passive: true });
    document.addEventListener('focusin', function (e) { hostRun(e.target); });
  }

  /* ---------- Section headings type in (right to left) the first time they scroll into view; only ones that start off screen ---------- */
  function initDecode() {
    var hs = document.querySelectorAll('main h2:not(.sr-only)');
    if (!hs.length || !('IntersectionObserver' in window)) return;
    // The parent is observed: a heading fully hidden by its own clip-path never reports as intersecting.
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var h = e.target._decH;
        if (!h) return;
        h.classList.remove('dec-pre');
        if (!motionOn()) return;
        h.classList.add('dec-run');
        window.setTimeout(function () { h.classList.remove('dec-run'); }, 800);
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    each(hs, function (h) {
      var r = h.getBoundingClientRect();
      if (!motionOn() || (r.top < window.innerHeight && r.bottom > 0) || !h.parentNode) return;
      h.classList.add('dec-pre');
      h.parentNode._decH = h;
      io.observe(h.parentNode);
    });
    onMotion(function (on) { if (!on) each(hs, function (h) { h.classList.remove('dec-pre', 'dec-run'); }); });
  }

  /* ---------- Hero terminal: example breakpoints, duck console, counter ---------- */
  var DUCK_LINES = [
    '«احكولي المشروع في جملة واحدة.»',
    '«إيه آخر حاجة كانت شغالة؟»',
    '«وإيه اللي اتغيّر من ساعتها؟»',
    '«لو شرحتوا الجزء الواقف سطر سطر، هيقف فين؟»',
    '«مين في الفريق ماسك الجزء ده؟»',
    '«المشرف طلب إيه بالظبط؟»',
    '«لو عندكم أسبوع بس، هتبدأوا بإيه؟»',
    '«لو لقيتوا الإجابة لوحدكم، ممتاز. ولو لأ، احجزوا التشخيص.»'
  ];
  var ROW_QUESTIONS = [ // the duck question that follows each marked row (same order as the rows)
    '«إيه آخر حاجة كانت شغالة؟»',
    '«مين في الفريق ماسك الجزء ده؟»',
    '«لو عندكم أسبوع بس، هتبدأوا بإيه؟»',
    '«لو شرحتوا الجزء الواقف سطر سطر، هيقف فين؟»',
    '«احكولي المشروع في جملة واحدة.»'
  ];
  var ALL_FOUND_LINE = '«كل دي أمثلة. في التشخيص بنحدد اللي واقف عندكم وسببه، وانتو اللي بتحلّوه.»';

  function initHeroTerminal() {
    var list = $('problems');
    var term = $('hero-term');
    if (!list || !term) return;
    var say = $('duck-say');
    var count = $('desk-count');
    var duck = $('duck-btn');
    var allFoundEl = $('all-found');
    var ring = document.querySelector('.cta-ring');
    var rows = [], lineIdx = -1, allDone = false;

    // The rows are plain list text without JS; here each becomes a toggle button (same content, so nothing new is announced).
    each(list.querySelectorAll('li.prob'), function (li, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'prob';
      b.setAttribute('aria-pressed', 'false');
      while (li.firstChild) b.appendChild(li.firstChild);
      li.className = 'prob-li';
      li.removeAttribute('data-i');
      li.appendChild(b);
      rows.push(b);
      b.addEventListener('click', function () {
        var on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) { if (say) say.textContent = ROW_QUESTIONS[i] || DUCK_LINES[0]; buzz(10); }
        update(true);
      });
    });

    function update(fromUser) {
      var found = rows.filter(function (r) { return r.getAttribute('aria-pressed') === 'true'; }).length;
      if (count) count.textContent = found === rows.length
        ? 'لقيتوا الـ' + rows.length + ' أمثلة كلها.'
        : 'دوسوا على الأدلة وعلى البطة: لقيتوا ' + found + ' من ' + rows.length + '.';
      if (found === rows.length && !allDone) {
        allDone = true;
        if (say) say.textContent = ALL_FOUND_LINE;
        if (allFoundEl) allFoundEl.hidden = false;
        if (fromUser) {
          if (ring && motionOn()) restartClass(ring, 'go');
          sparksAt(duck || term, 18);
          buzz(30);
        }
      } else if (found < rows.length && allDone) {
        allDone = false;
        if (allFoundEl) allFoundEl.hidden = true;
      }
    }

    if (duck && say) {
      duck.addEventListener('click', function () {
        lineIdx = (lineIdx + 1) % DUCK_LINES.length;
        say.textContent = DUCK_LINES[lineIdx];
        if (motionOn()) restartClass(duck, 'quack');
        buzz(8);
      });
    }
    update(false);

    // The boot print (CSS) runs once; after it, toggling motion never replays it.
    if (!motionOn()) { html.classList.add('booted'); term.classList.add('caret-done'); }
    window.setTimeout(function () { html.classList.add('booted'); }, 1500);
    window.setTimeout(function () { term.classList.add('caret-done'); }, 5200);
    onMotion(function (on) { if (!on) { html.classList.add('booted'); term.classList.add('caret-done'); } });
  }

  /* ---------- «واقف؟»: one glitch after the fonts load, then on hover with a 4s cooldown ---------- */
  function initGlitch() {
    var w = $('bug-word');
    if (!w) return;
    var last = 0, timer = 0;
    function run() {
      if (!motionOn()) return;
      var now = Date.now();
      if (now - last < 4000) return;
      last = now;
      restartClass(w, 'glitching');
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { w.classList.remove('glitching'); }, 900);
    }
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () { window.setTimeout(run, 250); });
    var h1 = w.closest('h1');
    if (h1 && finePointer) h1.addEventListener('mouseenter', run);
    onMotion(function (on) { if (!on) w.classList.remove('glitching'); });
  }

  /* ---------- Chapter status badges: earned only by the visitor's own actions ---------- */
  var STATUS_WORDS = { fail: ['عطل', 'FAIL'], blocked: ['واقف', 'BLOCKED'], pass: ['عدّى', 'PASS'], idle: ['لسه', 'IDLE'] };
  var FINAL_LINE = 'الـ4 خطوات عدّوا على المثال. على مشروعكم انتو، البداية جلسة التشخيص.';
  var finalShown = false;

  var ICONS = '<svg class="i st-i-fail" aria-hidden="true" focusable="false"><use href="#i-x"/></svg>' +
    '<svg class="i st-i-blocked" aria-hidden="true" focusable="false"><use href="#i-alert"/></svg>' +
    '<svg class="i st-i-pass" aria-hidden="true" focusable="false"><use href="#i-check"/></svg>';
  function statusHTML(state, word, middle) {
    return '<span class="status" data-s="' + state + '">' + ICONS + '<span class="st-ar">' + word + '</span>' + (middle || '') +
      '<bdi class="tok st-tok" dir="ltr" aria-hidden="true">' + STATUS_WORDS[state][1] + '</bdi></span>';
  }
  /* The badges and pin icons exist only with JS (without it the pins stay neutral numbers and make no pass/fail claim). */
  function initChapterStatus() {
    each(document.querySelectorAll('#thread .step'), function (step) {
      var state = step.getAttribute('data-s') || 'idle';
      var pin = step.querySelector('.pin');
      if (pin) pin.insertAdjacentHTML('beforeend', ICONS.replace(/st-i-/g, 'pin-'));
      var h3 = step.querySelector('h3');
      if (!h3) return;
      var p = document.createElement('p');
      p.className = 'ch-status';
      var flips = step.querySelectorAll('.flip').length;
      p.innerHTML = statusHTML(state, STATUS_WORDS[state][0], flips ? ' <span class="st-n">0/' + flips + '</span>' : '');
      // the step name is read with the state («افهم البلاغ: عدّى»), not the bare word
      var pre = document.createElement('span');
      pre.className = 'sr-only';
      pre.textContent = h3.textContent.replace(/\s+/g, ' ').trim() + ': ';
      p.firstChild.insertBefore(pre, p.firstChild.firstChild);
      h3.insertAdjacentElement('afterend', p);
      p.setAttribute('aria-atomic', 'true');
      p.setAttribute('aria-live', 'polite'); // live only after it exists, so nothing is read on load
    });
  }

  function setStatus(stepId, state, countText) {
    var step = $(stepId);
    if (!step) return;
    var changed = step.getAttribute('data-s') !== state;
    step.setAttribute('data-s', state);
    var st = step.querySelector('.ch-status .status');
    if (st) {
      st.setAttribute('data-s', state);
      var ar = st.querySelector('.st-ar');
      var tok = st.querySelector('.st-tok');
      var n = st.querySelector('.st-n');
      if (ar && changed) ar.textContent = STATUS_WORDS[state][0];
      if (tok && tok.textContent !== STATUS_WORDS[state][1]) tok.textContent = STATUS_WORDS[state][1];
      if (n && countText != null && n.textContent !== countText) n.textContent = countText;
    }
    checkAllPassed();
  }
  function checkAllPassed() {
    var out = $('thread-final');
    if (!out) return;
    var steps = document.querySelectorAll('#thread .step');
    var all = steps.length > 0 && Array.prototype.every.call(steps, function (s) { return s.getAttribute('data-s') === 'pass'; });
    if (all && !finalShown) {
      finalShown = true;
      out.textContent = '';
      out.appendChild(document.createTextNode(FINAL_LINE + ' '));
      var a = document.createElement('a');
      a.className = 'link';
      a.href = '#book';
      a.textContent = 'احجزوا التشخيص';
      out.appendChild(a);
      sparksAt(out, 16);
    } else if (!all && finalShown) {
      finalShown = false;
      out.textContent = '';
    }
  }

  /* ---------- Execution gutter: the green arrow travels down the thread with the reader ---------- */
  function initThread() {
    var wrap = document.querySelector('.thread-wrap');
    var dot = $('thread-dot');
    if (!wrap || !dot) return;
    var ticking = false;
    function update() {
      ticking = false;
      if (!motionOn()) return;
      // clientHeight does not jump when the Android URL bar shows or hides.
      var line = document.documentElement.clientHeight * 0.6;
      var r = wrap.getBoundingClientRect();
      if (r.bottom < -200 || r.top > line + 200) return; // off screen: skip the write
      dot.style.setProperty('--ty', clamp(line - r.top, 0, r.height - 20) + 'px');
    }
    function request() { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
    onMotion(function (on) { if (on) request(); });
    update();
  }

  /* ---------- Chapter 1: cat the example report (types word by word, Arabic words stay whole) + mark the bug ---------- */
  function initReport() {
    var rep = $('report');
    if (!rep) return;
    var words = [];
    each(rep.querySelectorAll('.type-me'), function (el) {
      var parts = el.textContent.split(/(\s+)/);
      el.textContent = '';
      parts.forEach(function (p) {
        if (!p) return;
        if (/^\s+$/.test(p)) { el.appendChild(document.createTextNode(p)); return; }
        var w = document.createElement('span');
        w.className = 'w';
        w.textContent = p;
        el.appendChild(w);
        words.push(w);
      });
    });
    var caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    var timers = [];
    function clearTimers() { timers.forEach(window.clearTimeout); timers = []; }
    function finish() {
      clearTimers();
      rep.classList.remove('is-typing', 'is-waiting');
      words.forEach(function (w) { w.style.opacity = ''; });
      if (caret.parentNode) caret.parentNode.removeChild(caret);
    }
    function type() {
      if (!motionOn()) { finish(); return; }
      clearTimers();
      rep.classList.remove('is-waiting');
      rep.classList.add('is-typing');
      words.forEach(function (w) { w.style.opacity = '0'; });
      var i = 0;
      (function next() {
        if (i >= words.length) {
          timers.push(window.setTimeout(function () { rep.classList.remove('is-typing'); if (caret.parentNode) caret.parentNode.removeChild(caret); }, 900));
          return;
        }
        words[i].style.opacity = '1';
        words[i].after(caret);
        i++;
        timers.push(window.setTimeout(next, 85));
      })();
    }
    var r = rep.getBoundingClientRect();
    var onScreen = r.top < window.innerHeight && r.bottom > 0;
    if (motionOn() && !onScreen && 'IntersectionObserver' in window) {
      rep.classList.add('is-waiting');
      var io = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        io.disconnect();
        type();
      }, { threshold: 0.4 });
      io.observe(rep);
    }
    onMotion(function (on) { if (!on) finish(); });

    var replay = $('report-replay');
    if (replay) replay.addEventListener('click', type);

    var mark = $('report-mark');
    var line = $('bug-line');
    if (mark && line) {
      mark.addEventListener('click', function () {
        var on = mark.getAttribute('aria-pressed') !== 'true';
        mark.setAttribute('aria-pressed', on ? 'true' : 'false');
        line.classList.toggle('is-marked', on);
        setStatus('step-1', on ? 'pass' : 'idle');
        if (on) { sparksAt(line, 12); buzz(12); }
      });
    }
  }

  /* ---------- Chapter 2: untangle the spaghetti (violet -> green, the red exception tags fade) ---------- */
  function knotPath(k) {
    var a = 260 / (6 * Math.PI), pts = [], x = 0, y = 0;
    for (var i = 0; i <= 180; i++) {
      var th = (i / 180) * 6 * Math.PI;
      var b = 30 * k * (0.55 + 0.45 * Math.sin(th * 0.37));
      x = 20 + a * th - b * Math.sin(th);
      y = 45 - b * Math.cos(th) + 12 * k * Math.sin(th * 0.5);
      pts.push((i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1));
    }
    return { d: pts.join(' '), x: x, y: y };
  }
  function mix(a, b, t) { return Math.round(a + (b - a) * t); }
  function initKnot() {
    var range = $('knot-range');
    var path = $('knot-path');
    var box = $('untangle');
    var status = $('knot-status');
    if (!range || !path || !box) return;
    var end = box.querySelector('.knot-end');
    var solved = Number(range.value) >= 100; // a value restored by the browser counts, without celebrating it
    var raf = 0, pendingUser = false;
    function draw(fromUser) {
      var v = Number(range.value);
      var t = v / 100;
      var p = knotPath(1 - t);
      path.setAttribute('d', p.d);
      path.style.stroke = 'rgb(' + mix(167, 61, t) + ',' + mix(139, 245, t) + ',' + mix(250, 140, t) + ')';
      if (end) { end.setAttribute('cx', p.x.toFixed(1)); end.setAttribute('cy', p.y.toFixed(1)); }
      range.style.setProperty('--p', v + '%');
      range.setAttribute('aria-valuetext', v >= 100 ? 'اتفكّت' : v === 0 ? 'العقدة لسه مقفولة' : 'بتتفك، ' + v + ' في المية');
      box.classList.toggle('t1', v >= 33);
      box.classList.toggle('t2', v >= 66);
      box.classList.toggle('t3', v >= 90);
      box.classList.toggle('solved', v >= 100);
      if (v >= 100 && !solved) {
        solved = true;
        if (status) status.textContent = 'اتفكّت. في التشخيص بنحدد اللي واقف وسببه، وانتو اللي بتحلّوه.';
        setStatus('step-2', 'pass');
        if (fromUser) { sparksAt(box, 18); buzz(25); }
      } else if (v < 100 && solved) {
        solved = false;
        if (status) status.textContent = '';
        setStatus('step-2', 'idle');
      }
    }
    range.addEventListener('input', function () {
      pendingUser = true;
      if (!raf) raf = window.requestAnimationFrame(function () { raf = 0; draw(pendingUser); pendingUser = false; });
    });
    draw(false);
    if (solved) setStatus('step-2', 'pass');
  }

  /* ---------- Chapter 3: the plan as a test suite (the 3 items of the guarantee criterion) ---------- */
  function initPlan() {
    var plan = $('plan');
    var out = $('plan-result');
    if (!plan || !out) return;
    var cnt = $('plan-count');
    function refresh(fromUser) {
      var n = plan.querySelectorAll('input:checked').length;
      var t = n === 3
        ? 'خطتكم فيها التلات حاجات. كمّلوا بيها.'
        : n === 0 ? '' : 'لو فيه حاجة ناقصة: في التشخيص بنحدد اللي واقف وسببه، وبتطلعوا بخطة للخطوة الجاية مكتوبة بإيدكم.';
      if (out.textContent !== t) out.textContent = t; // a live region: only write when the sentence really changes
      if (cnt) cnt.textContent = n + '/3 passing';
      setStatus('step-3', n === 3 ? 'pass' : 'idle');
      if (n === 3 && fromUser) { sparksAt(out, 12); buzz(15); }
    }
    plan.addEventListener('change', function () { refresh(true); });
    if (plan.querySelector('input:checked')) refresh(false);
  }

  /* ---------- Chapter 4: review comments (a transparent button on top; the answer is hidden from screen readers until opened) ---------- */
  function initFlips() {
    var flips = document.querySelectorAll('.flip');
    if (!flips.length) return;
    var opened = [];
    each(flips, function (f, i) {
      var btn = f.querySelector('.flip-btn');
      var back = f.querySelector('.face.back');
      var front = f.querySelector('.face.front');
      if (!btn || !back) return;
      back.setAttribute('aria-hidden', 'true');
      btn.addEventListener('click', function () {
        var open = !f.classList.contains('is-open');
        f.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        back.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (front) front.setAttribute('aria-hidden', open ? 'true' : 'false');
        if (open && opened.indexOf(i) === -1) {
          opened.push(i);
          var n = opened.length;
          setStatus('step-4', n >= flips.length ? 'pass' : 'idle', n + '/' + flips.length);
          if (n >= flips.length) { sparksAt(f, 12); buzz(15); }
        }
      });
    });
  }

  /* ---------- Offers: split(350, n) ---------- */
  function initSplit() {
    var nEl = $('split-n'), each_ = $('split-each'), pre = $('split-pre'), sr = $('split-sr'), out = $('split-out');
    var plus = $('split-plus'), minus = $('split-minus');
    if (!nEl || !each_ || !plus || !minus) return;
    var n = 4, MIN = 2, MAX = 8;
    function show(fromUser) {
      nEl.textContent = String(n);
      var v = 350 / n;
      var exact = Math.abs(v - Math.round(v)) < 0.001;
      each_.textContent = String(Math.round(v));
      if (pre) pre.textContent = exact ? 'يعني ' : 'يعني حوالي ';
      if (sr) sr.textContent = n === 2 ? 'عضوين: ' : n + ' أعضاء: ';
      // aria-disabled instead of disabled, so focus stays on the button at the limits.
      minus.setAttribute('aria-disabled', n <= MIN ? 'true' : 'false');
      plus.setAttribute('aria-disabled', n >= MAX ? 'true' : 'false');
      if (fromUser && motionOn()) restartClass(each_, 'bump');
    }
    plus.addEventListener('click', function () { if (n < MAX) { n++; show(true); buzz(6); } });
    minus.addEventListener('click', function () { if (n > MIN) { n--; show(true); buzz(6); } });
    show(false);
    if (out) out.setAttribute('aria-live', 'polite'); // live only after the first render, so nothing is read on load
  }

  /* ---------- Season: mark the current period from the device date (no mark in January) ---------- */
  function initSeason() {
    var items = document.querySelectorAll('.season li[data-months]');
    if (!items.length) return;
    var month = new Date().getMonth() + 1;
    each(items, function (li) {
      if (li.getAttribute('data-months').split(' ').indexOf(String(month)) !== -1) {
        li.classList.add('is-now');
        li.setAttribute('aria-current', 'true');
      }
    });
  }

  /* ---------- One-shot reveals on first view: scope "compile", season pulses, referral merge line ---------- */
  function initRevealOnce() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length || !('IntersectionObserver' in window)) return;
    var timers = [];
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        io.unobserve(el);
        el.classList.remove('pre');
        if (!motionOn()) return;
        el.classList.add('run');
        var dur = el.classList.contains('season') ? 3800 : 1200;
        timers.push(window.setTimeout(function () { el.classList.remove('run'); }, dur));
      });
    }, { threshold: 0.3 });
    each(els, function (el) {
      var r = el.getBoundingClientRect();
      var onScreen = r.top < window.innerHeight && r.bottom > 0;
      if (!motionOn() || onScreen) return; // already visible or no motion: final state at once
      el.classList.add('pre');
      io.observe(el);
    });
    onMotion(function (on) {
      if (on) return;
      timers.forEach(window.clearTimeout);
      each(els, function (el) { el.classList.remove('pre', 'run'); });
    });
  }

  /* ---------- Sticky phone bar: hidden while the hero button or the booking section is on screen ---------- */
  function initStickyCta() {
    var bar = $('mobile-bar');
    if (!bar) return;
    var cta = $('mobile-cta');
    if (!cta) return; // terms.html: the bar only holds the pause button
    var targets = [$('hero-actions'), $('book'), document.querySelector('.offer-main .btn')];
    if (!('IntersectionObserver' in window)) { cta.hidden = true; return; }
    var visibleT = [];
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var idx = visibleT.indexOf(e.target);
        if (e.isIntersecting && idx === -1) visibleT.push(e.target);
        if (!e.isIntersecting && idx !== -1) visibleT.splice(idx, 1);
      });
      var hide = visibleT.length > 0;
      bar.classList.toggle('is-hidden', hide);
      if ('inert' in cta) cta.inert = hide; else cta.tabIndex = hide ? -1 : 0;
    });
    targets.forEach(function (t) { if (t) io.observe(t); });
  }

  /* ---------- Message builder ---------- */
  function checkedValues(name) {
    var out = [];
    var els = document.querySelectorAll('#case-form input[name="' + name + '"]:checked');
    for (var i = 0; i < els.length; i++) if (els[i].value) out.push(els[i].value);
    return out;
  }
  function hasChoice(name) { return !!document.querySelector('#case-form input[name="' + name + '"]:checked'); }

  function fieldText(id) {
    var el = $(id);
    return el ? el.value.replace(/\s+/g, ' ').trim() : '';
  }
  function fileList(id) {
    var el = $(id);
    return el && el.files ? Array.prototype.slice.call(el.files) : [];
  }
  function filesCount(n) {
    if (n === 1) return 'ملف واحد';
    if (n === 2) return 'ملفين';
    if (n <= 10) return n + ' ملفات';
    return n + ' ملف';
  }
  function membersValue() {
    var v = fieldText('f-members');
    var n = parseInt(v, 10);
    return v && n >= 1 ? String(n) : '';
  }
  function isUrgent() { var u = $('f-urgent'); return !!(u && u.checked); }

  // Same lines (and order) as the no-JS template in the static wa.me links in index.html / terms.html.
  function buildMessage() {
    var project = fieldText('f-project');
    // First Strong Isolate ... Pop Directional Isolate: keeps names like "C#" or "C++" from being mirrored in an RTL line.
    if (project) project = '⁨' + project + '⁩';
    var types = checkedValues('type');
    var lines = [];
    if (isUrgent()) lines.push('مستعجل (طوارئ)');
    lines.push('قضية', 'موضوع المشروع: ' + project);
    lines.push('عدد الأعضاء: ' + membersValue());
    if (types.length) lines.push('نوع المشروع: ' + types.join('، '));
    lines.push('مرحلته: ' + checkedValues('stage').join(''));
    lines.push('أكبر حاجة واقفة: ' + checkedValues('blocker').join(''));
    var details = $('f-details') ? $('f-details').value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '';
    lines.push('تفاصيل تانية: ' + (details ? '⁨' + details + '⁩' : ''));
    var cvs = fileList('f-cvs').length;
    lines.push(cvs ? 'الـCV: ' + filesCount(cvs) + ' هتتبعت في نفس الشات' : 'الـCV: هنبعت CV لكل عضو في نفس الشات');
    if (fileList('f-shot').length) lines.push('صورة المشكلة: هتتبعت في نفس الشات');
    // Optional referral line: only when the team wrote who referred them.
    var ref = fieldText('f-ref');
    if (ref) lines.push('رشّحنا فريق: ⁨' + ref + '⁩');
    return lines.join('\n');
  }

  var toastTimer = null;
  function say(text) {
    var t = $('toast');
    if (!t) return;
    t.textContent = '';
    window.setTimeout(function () { t.textContent = text; }, 30);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { t.textContent = ''; }, 6000);
  }

  /* ---------- Copy (adapted from 21st.dev "Copy Button" by ddoemonn) ---------- */
  function writeFallback(text) {
    var prev = document.activeElement;
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.insetInlineStart = '0';
    area.style.opacity = '0';
    area.style.fontSize = '16px'; // avoids the iOS zoom on focus
    document.body.appendChild(area);
    area.select();
    try { area.setSelectionRange(0, area.value.length); } catch (e) { /* not supported */ }
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    if (prev && prev.focus) { try { prev.focus({ preventScroll: true }); } catch (e) { prev.focus(); } }
    return ok;
  }
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(writeFallback(text)); });
      } else {
        resolve(writeFallback(text));
      }
    });
  }
  function showAndSelectPreview() {
    var p = $('preview');
    if (!p) return;
    p.scrollIntoView({ block: 'nearest', behavior: motionOn() ? 'smooth' : 'auto' });
    if (!window.getSelection) return;
    var range = document.createRange();
    range.selectNodeContents(p);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function initCopy(btn, number) {
    if (!btn) return;
    var timer = null;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      copyText(buildMessage()).then(function (ok) {
        btn.setAttribute('data-status', ok ? 'copied' : 'error');
        if (ok) { say('اتنسخت الرسالة.'); sparksAt(btn, 16); buzz(15); }
        else { say('ما اتنسختش. حدّدنا لكم الرسالة، انسخوها بإيدكم.'); showAndSelectPreview(); }
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { btn.setAttribute('data-status', 'idle'); }, 2500);
      });
    });
  }

  /* ---------- Share the page with the team group ---------- */
  function shareData() {
    var text = 'لقيت جلسة تشخيص لأي مشروع، من الثانوي للجامعة: 45 دقيقة أونلاين، وأول 15 فريق مجانًا مقابل رأيهم بعد الجلسة. وبعدهم 350 جنيه للفريق كله (حوالي من 70 لـ90 جنيه للفرد لو احنا 4 أو 5).';
    var url = /^https?:/.test(window.location.protocol) ? window.location.origin + window.location.pathname : '';
    return { text: text, url: url };
  }
  function initShare(btn) {
    if (!btn) return;
    btn.hidden = false;
    function copyFallback(data) {
      copyText(data.text + (data.url ? '\n' + data.url : '')).then(function (ok) {
        say(ok ? 'اتنسخ كلام قصير عن الجلسة. الصقوه في جروب الفريق.' : 'ما اتنسختش. جرّبوا تاني.');
      });
    }
    btn.addEventListener('click', function () {
      var data = shareData();
      if (navigator.share && data.url) {
        navigator.share({ title: 'بإيدك', text: data.text, url: data.url }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          copyFallback(data);
        });
        return;
      }
      copyFallback(data);
    });
  }

  /* ---------- Booking: number slot vs. WhatsApp links, live preview, checks panel, ready state ---------- */
  function initBooking() {
    var form = $('case-form');
    var preview = $('preview');
    if (!form || !preview) return;
    var links = Array.prototype.slice.call(document.querySelectorAll('a[data-wa]'));
    var term = $('preview-term');
    var stamp = $('ready-stamp');
    var neutral = $('ck-neutral');
    var ckList = $('ck-list');
    var number = String(BOOKING_NUMBER || '').replace(/[^0-9]/g, '');
    var wasReady = false, touched = false;
    if (ckList && !ckList.children.length) {
      [['project', 'موضوع المشروع'], ['members', 'عدد الأعضاء'], ['stage', 'مرحلته'], ['blocker', 'أكبر حاجة واقفة']].forEach(function (k) {
        var li = document.createElement('li');
        li.setAttribute('data-k', k[0]);
        li.setAttribute('aria-atomic', 'true');
        li.innerHTML = '<span class="status" data-s="fail">' + ICONS + '<span class="ck-name">' + k[1] + '</span> <span class="st-ar">ناقص</span></span>';
        ckList.appendChild(li);
      });
    }

    function have() {
      return {
        project: !!fieldText('f-project'),
        members: !!membersValue(),
        stage: hasChoice('stage'),
        blocker: checkedValues('blocker').length > 0 // "something else, we'll write it" leaves the line empty on purpose
      };
    }
    function updateChecks(h) {
      if (!ckList || !neutral) return;
      // Neutral until the first input: no red is shown before the visitor did anything.
      neutral.hidden = touched;
      ckList.hidden = !touched;
      if (!touched) return;
      each(ckList.querySelectorAll('li[data-k]'), function (li) {
        var ok = !!h[li.getAttribute('data-k')];
        var st = li.querySelector('.status');
        var ar = li.querySelector('.st-ar');
        if (st && st.getAttribute('data-s') !== (ok ? 'pass' : 'fail')) {
          st.setAttribute('data-s', ok ? 'pass' : 'fail');
          if (ar) ar.textContent = ok ? 'موجود' : 'ناقص';
        }
      });
    }
    function refresh(fromUser) {
      var msg = buildMessage();
      preview.textContent = msg;
      if (number) links.forEach(function (a) { if (a) a.href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg); });
      if (fromUser) touched = true;
      var h = have();
      var ready = h.project && h.members && h.stage && h.blocker;
      updateFiles();
      updateChecks(h);
      if (term) term.classList.toggle('is-ready', ready);
      if (ready && !wasReady && fromUser) { sparksAt(stamp, 12); buzz(12); say('البلاغ جاهز. انسخوا الرسالة أو ابعتوها.'); }
      wasReady = ready;
    }

    /* Files (CVs, screenshot) never leave the browser from here: a wa.me link can only carry text.
       Where the browser can share files (mostly phones), one button shares the message and the files together
       through the system share sheet; otherwise the WhatsApp link opens with the text and a note says to attach them. */
    var shareFilesBtn = $('share-files-btn');
    var filesNote = $('files-note');
    function pickedFiles() { return fileList('f-cvs').concat(fileList('f-shot')); }
    function canShareFiles(files) {
      if (!files.length || !navigator.share || !navigator.canShare) return false;
      try { return navigator.canShare({ files: files, text: 'x' }); } catch (e) { return false; }
    }
    function updateFiles() {
      var files = pickedFiles();
      var can = canShareFiles(files);
      if (shareFilesBtn) shareFilesBtn.hidden = !can;
      if (!filesNote) return;
      if (!files.length) { filesNote.hidden = true; filesNote.textContent = ''; return; }
      filesNote.hidden = false;
      filesNote.textContent = can
        ? 'زرار «ابعتوا الرسالة والملفات مع بعض» بيفتح المشاركة: اختاروا واتساب، وابعتوها للرقم +20 106 853 0159. ولو فتحتوا لينك واتساب بدل كده، ابعتوا الملفات بإيدكم في نفس الشات بعد الرسالة على طول.'
        : 'لينك واتساب بيبعت الكلام بس. بعد ما تبعتوا الرسالة، ابعتوا الـCVs' + (fileList('f-shot').length ? ' وصورة المشكلة' : '') + ' في نفس الشات على طول.';
    }
    if (shareFilesBtn) shareFilesBtn.addEventListener('click', function () {
      var files = pickedFiles();
      if (!canShareFiles(files)) { updateFiles(); return; }
      navigator.share({ text: buildMessage(), files: files }).then(function () {
        say('اتفتحت المشاركة. اتأكدوا إنكم بعتوها لرقم بإيدك على واتساب.');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        say('ما نفعتش المشاركة. ابعتوا الرسالة من زرار واتساب، وبعدها الملفات في نفس الشات.');
      });
    });

    links.forEach(function (a) { a.hidden = false; a.target = '_blank'; a.rel = 'noopener'; });
    form.addEventListener('input', function () { refresh(true); });
    form.addEventListener('change', function () { refresh(true); });
    refresh(false);
    initCopy($('copy-btn'), number);
    initCopy($('copy-btn-2'), number);
    initShare($('share-btn'));
  }

  /* ---------- Move focus to the booking section after jumping there (keyboard and screen readers) ---------- */
  function initBookJump() {
    var book = $('book');
    if (!book) return;
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href="#book"]') : null;
      if (!a) return;
      window.setTimeout(function () { book.focus({ preventScroll: true }); }, motionOn() ? 450 : 0);
    });
  }

  /* =====================================================================
     terms.html
     ===================================================================== */

  /* ---------- Outline: scroll-spy marks the section being read ---------- */
  function initTermsOutline() {
    var outline = $('outline');
    if (!outline || !('IntersectionObserver' in window)) return;
    var links = outline.querySelectorAll('a[href^="#"]');
    var map = {};
    each(links, function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var secs = document.querySelectorAll('.tsec[id]');
    var visible = {};
    function mark() {
      var cur = null;
      for (var i = 0; i < secs.length; i++) if (visible[secs[i].id]) { cur = secs[i].id; break; }
      if (!cur) return;
      each(links, function (a) {
        if (a === map[cur]) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      mark();
    }, { rootMargin: '-15% 0px -60% 0px' });
    each(secs, function (s) { io.observe(s); });
  }

  /* ---------- Find in the terms: Arabic-normalised search, highlighted with the CSS Custom Highlight API ---------- */
  function normChar(ch) {
    var c = ch.charCodeAt(0);
    if ((c >= 0x064B && c <= 0x065F) || c === 0x0670 || c === 0x0640) return ''; // tashkeel, superscript alef, tatweel
    if (ch === 'أ' || ch === 'إ' || ch === 'آ' || ch === 'ٱ') return 'ا';
    if (ch === 'ة') return 'ه';
    if (ch === 'ى') return 'ي';
    if (/\s/.test(ch)) return ' ';
    return ch.toLowerCase();
  }
  function normalize(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var n = normChar(s[i]);
      if (n === ' ' && (out === '' || out[out.length - 1] === ' ')) continue;
      out += n;
    }
    return out.trim();
  }
  function indexItem(el) {
    // A normalised copy of the item's visible text, with a map back to (text node, offset) for every kept character.
    var norm = '', map = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode && n.parentNode.closest('[aria-hidden="true"], svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var node;
    while ((node = walker.nextNode())) {
      var t = node.nodeValue;
      for (var i = 0; i < t.length; i++) {
        var n = normChar(t[i]);
        if (!n) continue;
        if (n === ' ' && (norm === '' || norm[norm.length - 1] === ' ')) continue;
        norm += n;
        map.push([node, i]);
      }
    }
    return { el: el, norm: norm, map: map };
  }
  function initTermsFind() {
    var input = $('find-input');
    if (!input) return;
    var countEl = $('find-count');
    var prev = $('find-prev'), next = $('find-next');
    var items = Array.prototype.map.call(document.querySelectorAll('.doc .tsec li'), indexItem);
    var canHighlight = !!(window.CSS && CSS.highlights && window.Highlight);
    var hits = [], cur = -1, timer = 0, curEl = null;

    function clearMarks() {
      if (canHighlight) { CSS.highlights.delete('terms-hit'); CSS.highlights.delete('terms-cur'); }
      if (curEl) { curEl.classList.remove('is-cur'); curEl = null; }
    }
    function countText() {
      if (!input.value.trim()) return '';
      if (!hits.length) return 'مفيش نتايج';
      var n = hits.length;
      return n === 1 ? 'نتيجة واحدة' : n === 2 ? 'نتيجتين' : n <= 10 ? n + ' نتايج' : n + ' نتيجة';
    }
    function search() {
      clearMarks();
      hits = []; cur = -1;
      var q = normalize(input.value);
      if (q.length >= 2) {
        items.forEach(function (it) {
          var from = 0, at;
          while ((at = it.norm.indexOf(q, from)) !== -1) {
            var s = it.map[at], e = it.map[at + q.length - 1];
            var r = document.createRange();
            r.setStart(s[0], s[1]);
            r.setEnd(e[0], e[1] + 1);
            hits.push({ el: it.el, range: r });
            from = at + q.length;
          }
        });
        if (canHighlight && hits.length) {
          var hl = new Highlight();
          hits.forEach(function (h) { hl.add(h.range); });
          CSS.highlights.set('terms-hit', hl);
        }
      }
      if (countEl) countEl.textContent = q.length >= 2 || !input.value.trim() ? countText() : '';
    }
    function go(step) {
      if (!hits.length) return;
      cur = (cur + step + hits.length) % hits.length;
      var h = hits[cur];
      if (curEl) curEl.classList.remove('is-cur');
      curEl = h.el;
      curEl.classList.add('is-cur');
      if (canHighlight) CSS.highlights.set('terms-cur', new Highlight(h.range));
      curEl.scrollIntoView({ block: 'center', behavior: motionOn() ? 'smooth' : 'auto' });
      if (countEl) {
        var txt = curEl.textContent.replace(/\s+/g, ' ').trim();
        countEl.textContent = 'النتيجة ' + (cur + 1) + ' من ' + hits.length + ': ' + (txt.length > 90 ? txt.slice(0, 90) + '…' : txt);
      }
    }
    input.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(search, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); window.clearTimeout(timer); if (cur === -1 && !hits.length) search(); go(e.shiftKey && e.key === 'Enter' ? -1 : 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
    });
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
  }

  /* ---------- Copy a link to one section of the terms (only over http(s): a file:// link is useless to share) ---------- */
  function initSectionLinks() {
    if (!/^https?:/.test(window.location.protocol)) return;
    var secs = document.querySelectorAll('.tsec[id]');
    each(secs, function (sec) {
      var row = sec.querySelector('.h2row');
      if (!row) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sec-link';
      b.innerHTML = '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-link"/></svg><span class="sr-only">انسخوا لينك الجزء ده</span>';
      var h2 = row.querySelector('h2');
      if (h2 && h2.id) b.setAttribute('aria-describedby', h2.id);
      row.appendChild(b);
      b.addEventListener('click', function () {
        copyText(window.location.origin + window.location.pathname + '#' + sec.id).then(function (ok) {
          say(ok ? 'اتنسخ لينك الجزء ده.' : 'ما اتنسختش. جرّبوا تاني.');
        });
      });
    });
  }

  function start() {
    var parts = [initMotion, initPointer, initBgfx, initDuckPeek, initProps, initPointerFx, initScramble, initDecode, initHeroTerminal, initGlitch, initChapterStatus, initThread, initReport, initKnot, initPlan, initFlips,
      initSplit, initSeason, initRevealOnce, initStickyCta, initBooking, initBookJump, initTermsOutline, initTermsFind, initSectionLinks];
    parts.forEach(function (fn) {
      try { fn(); } catch (e) { if (window.console) console.warn('بإيدك: ' + (fn.name || 'part') + ' did not start', e); }
    });
    html.classList.add('app');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
