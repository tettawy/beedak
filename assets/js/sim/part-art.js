/* بإيدك lab simulator: part-art.js (B3, lab-sim-spec.md §6.4 / §4.6).
   SVG top-view drawing of every part body. Everything is drawn at rot 0 in grid units u (0.1 inch);
   the workbench scales and rotates the group. Pins / holes are NOT drawn here (the workbench draws
   their hit targets). update(g, visual, inst) only changes attributes, so it is cheap per frame.
   DOM-only module: nothing runs at load time except defining functions. */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- tiny helpers ---------- */
  function el(tag, attrs, parent) {
    var n = root.document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, cls, attrs) {
    var a = { x: x, y: y, 'class': 'wb-t ' + (cls || '') };
    if (attrs) for (var k in attrs) a[k] = attrs[k];
    var t = el('text', a, parent); t.textContent = s; return t;
  }
  function rect(parent, x, y, w, h, fill, extra) {
    var a = { x: x, y: y, width: w, height: h, fill: fill };
    if (extra) for (var k in extra) a[k] = extra[k];
    return el('rect', a, parent);
  }
  function circ(parent, cx, cy, r, fill, extra) {
    var a = { cx: cx, cy: cy, r: r, fill: fill };
    if (extra) for (var k in extra) a[k] = extra[k];
    return el('circle', a, parent);
  }
  function line(parent, x1, y1, x2, y2, stroke, w, extra) {
    var a = { x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, 'stroke-width': w, 'stroke-linecap': 'round' };
    if (extra) for (var k in extra) a[k] = extra[k];
    return el('line', a, parent);
  }
  function group(cls, parent) { return el('g', cls ? { 'class': cls } : null, parent); }
  function setOp(n, v) { if (n) n.setAttribute('opacity', String(Math.max(0, Math.min(1, v)).toFixed(3))); }
  function show(n, on) { if (n) n.setAttribute('display', on ? 'inline' : 'none'); }
  function clamp01(v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  function prop(inst, def, key) {
    if (inst && inst.props && inst.props[key] != null) return inst.props[key];
    var ps = (def && def.props) || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].key === key) return ps[i].default;
    return null;
  }
  function pinOf(def, id) { var ps = (def && def.pins) || []; for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i]; return null; }
  /* silver legs from the body edge down to each pin (top view: a short visible stub) */
  function legs(g, def, fromY, ids) {
    var ps = def.pins || [];
    for (var i = 0; i < ps.length; i++) {
      if (ids && ids.indexOf(ps[i].id) < 0) continue;
      line(g, ps[i].x, fromY, ps[i].x, ps[i].y, '#b9c0c8', 0.16, { 'class': 'wb-leg' });
    }
  }
  /* small text labels next to header pins (module silkscreen) */
  function pinLabels(g, def, dy, size) {
    (def.pins || []).forEach(function (p) {
      txt(g, p.x, p.y + dy, p.label || p.id, 'wb-silk', { 'font-size': size || 0.45, 'text-anchor': 'middle' });
    });
  }

  /* LED colours: [body tint unlit, glow colour] */
  var LED_COL = {
    red: ['#7a1f26', '#ff3b47'], green: ['#1f5c33', '#3df58c'], yellow: ['#7a6a1a', '#ffd84a'],
    blue: ['#1d3a7a', '#4d8dff'], white: ['#9aa3ad', '#f4f7ff']
  };
  /* resistor colour code */
  var BAND = ['#111111', '#7a4a1e', '#d42a2a', '#f07c12', '#e8c80e', '#2f9e3a', '#2650c8', '#8a4fd1', '#8a8f96', '#f2f2f2'];
  var GOLD = '#c9a227';
  function bandsFor(ohms) {
    ohms = Math.round(+ohms || 220);
    var s = String(ohms), d1 = +s[0], d2 = s.length > 1 ? +s[1] : 0, mul = Math.max(0, s.length - 2);
    if (s.length === 1) { d2 = d1; d1 = 0; mul = 0; }
    return [BAND[d1], BAND[d2], BAND[Math.min(9, mul)], GOLD];
  }

  var Art = {};

  /* ---------- Arduino Uno R3: bbox 0,0,27,21 ---------- */
  Art.uno = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-uno'), r = {};
      rect(g, 0, 0, 27, 21, '#0b7d8c', { rx: 0.8, stroke: '#075560', 'stroke-width': 0.15 });
      // mounting holes
      [[6.6, 1.0], [5.6, 19.9], [26.0, 6.2], [26.0, 17.6]].forEach(function (h) { circ(g, h[0], h[1], 0.55, '#e7d9a8'); circ(g, h[0], h[1], 0.32, '#07090d'); });
      // USB-B and barrel jack on the left edge
      rect(g, -1.2, 3.6, 6.2, 4.8, '#b9c0c8', { rx: 0.2, stroke: '#7f8790', 'stroke-width': 0.12 });
      rect(g, -1.2, 4.6, 1.6, 2.8, '#59616a');
      rect(g, -0.9, 14.0, 5.4, 3.6, '#16181c', { rx: 0.3 });
      circ(g, 0.6, 15.8, 0.8, '#2c3036');
      // headers (female sockets): pins sit on top of these
      rect(g, 7.85, 0.45, 10.1, 1.1, '#121418', { rx: 0.1 });
      rect(g, 18.45, 0.45, 8.1, 1.1, '#121418', { rx: 0.1 });
      rect(g, 10.45, 19.45, 8.1, 1.1, '#121418', { rx: 0.1 });
      rect(g, 19.45, 19.45, 6.1, 1.1, '#121418', { rx: 0.1 });
      // pin labels (silkscreen), vertical so they fit at 0.1 inch spacing
      (def.pins || []).forEach(function (p) {
        if (p.id === 'NC') return;
        var top = p.y < 10, lb = p.label || p.id;
        txt(g, 0, 0, lb, 'wb-silk wb-silk-w', { 'font-size': 0.48, 'text-anchor': top ? 'end' : 'start',
          transform: 'translate(' + (p.x + 0.17) + ' ' + (top ? 1.85 : 19.15) + ') rotate(-90)' });
      });
      txt(g, 21.8, 4.6, 'DIGITAL (PWM~)', 'wb-silk wb-silk-w', { 'font-size': 0.55, 'text-anchor': 'middle' });
      txt(g, 14.5, 16.9, 'POWER', 'wb-silk wb-silk-w', { 'font-size': 0.55, 'text-anchor': 'middle' });
      txt(g, 22.8, 16.9, 'ANALOG IN', 'wb-silk wb-silk-w', { 'font-size': 0.55, 'text-anchor': 'middle' });
      // ATmega328P (DIP-28)
      rect(g, 11.2, 12.2, 13.8, 3.0, '#17191d', { rx: 0.15 });
      circ(g, 11.9, 13.7, 0.35, '#2a2d33');
      txt(g, 18.1, 14.0, 'ATMEGA328P', 'wb-silk', { 'font-size': 0.6, 'text-anchor': 'middle', fill: '#8b929a' });
      // 16U2 USB chip + crystal
      rect(g, 7.2, 6.2, 2.4, 2.4, '#17191d', { transform: 'rotate(45 8.4 7.4)' });
      rect(g, 6.0, 10.5, 2.6, 1.1, '#c9ced4', { rx: 0.5 });
      // reset button (top left)
      rect(g, 2.4, 0.7, 2.0, 2.0, '#c9ced4', { rx: 0.2 });
      r.rst = circ(g, 3.4, 1.7, 0.65, '#d23b3b');
      // logo
      txt(g, 17.4, 9.2, 'UNO', 'wb-logo', { 'font-size': 2.4, 'text-anchor': 'middle' });
      txt(g, 17.4, 10.6, 'ARDUINO', 'wb-silk wb-silk-w', { 'font-size': 0.7, 'text-anchor': 'middle' });
      // on-board LEDs: L (D13), TX, RX, ON
      function led(x, y, name, col) {
        rect(g, x - 0.35, y - 0.25, 0.7, 0.5, '#e8d9a0');
        var lit = rect(g, x - 0.35, y - 0.25, 0.7, 0.5, col, { opacity: 0 });
        var glow = circ(g, x, y, 0.9, col, { opacity: 0, 'class': 'wb-glow' });
        txt(g, x + 0.65, y + 0.2, name, 'wb-silk wb-silk-w', { 'font-size': 0.5 });
        return [lit, glow];
      }
      r.L = led(12.9, 3.6, 'L', '#ffb020'); r.TX = led(12.9, 5.0, 'TX', '#ffb020'); r.RX = led(12.9, 6.2, 'RX', '#ffb020');
      r.ON = led(24.6, 9.6, 'ON', '#3df58c');
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      function set(p, b) { setOp(p[0], b); setOp(p[1], b * 0.55); }
      set(r.L, v.power ? clamp01(v.ledL) : 0); set(r.TX, v.power && v.ledTx ? 1 : 0); set(r.RX, v.power && v.ledRx ? 1 : 0);
      set(r.ON, v.power ? 1 : 0);
      r.rst.setAttribute('fill', v.reset ? '#7a1f1f' : '#d23b3b');
    }
  };

  /* ---------- ESP32 DevKit V1 30 pin: bbox 0,0,12,21 ---------- */
  Art.esp32 = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-esp32'), r = {};
      rect(g, 0, 0, 12, 21, '#16191f', { rx: 0.5, stroke: '#2b313a', 'stroke-width': 0.12 });
      // WROOM-32 module: antenna area + metal shield
      rect(g, 2.0, 0.2, 8.0, 10.4, '#1f2a24', { rx: 0.2 });
      el('path', { d: 'M2.6 1.9 h1 v-1.1 h1 v1.1 h1 v-1.1 h1 v1.1 h1 v-1.1 h1 v1.1 h0.8', fill: 'none', stroke: '#c9a227', 'stroke-width': 0.18 }, g);
      rect(g, 2.4, 2.8, 7.2, 7.4, '#aeb5bd', { rx: 0.2, stroke: '#7f8790', 'stroke-width': 0.1 });
      txt(g, 6.0, 5.6, 'ESP-WROOM-32', 'wb-silk', { 'font-size': 0.62, 'text-anchor': 'middle', fill: '#4a5058' });
      r.wifi = txt(g, 6.0, 7.2, 'WiFi', 'wb-silk', { 'font-size': 0.6, 'text-anchor': 'middle', fill: '#4a5058' });
      // header strips
      rect(g, 0.45, 2.45, 1.1, 15.1, '#0d0f12', { rx: 0.1 });
      rect(g, 10.45, 2.45, 1.1, 15.1, '#0d0f12', { rx: 0.1 });
      (def.pins || []).forEach(function (p) {
        var left = p.x < 6;
        txt(g, left ? 1.85 : 10.15, p.y + 0.17, p.label || p.id, 'wb-silk wb-silk-w', { 'font-size': 0.48, 'text-anchor': left ? 'start' : 'end' });
      });
      // USB-UART chip, regulator
      rect(g, 4.6, 12.6, 2.8, 2.8, '#1d2026', { rx: 0.1 });
      rect(g, 4.4, 10.9, 3.2, 1.2, '#1d2026');
      // EN / BOOT buttons, LEDs, micro-USB
      rect(g, 1.9, 18.4, 1.6, 1.4, '#c9ced4', { rx: 0.15 }); circ(g, 2.7, 19.1, 0.45, '#2a2d33');
      rect(g, 8.5, 18.4, 1.6, 1.4, '#c9ced4', { rx: 0.15 }); circ(g, 9.3, 19.1, 0.45, '#2a2d33');
      txt(g, 2.7, 18.2, 'EN', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      txt(g, 9.3, 18.2, 'BOOT', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      rect(g, 4.6, 19.7, 2.8, 1.5, '#b9c0c8', { rx: 0.2 });
      r.pwr = rect(g, 4.3, 17.6, 0.7, 0.5, '#ff3b47', { opacity: 0 });
      rect(g, 6.9, 17.6, 0.7, 0.5, '#d9dde2', { opacity: 0.35 });
      r.blue = rect(g, 6.9, 17.6, 0.7, 0.5, '#4d8dff', { opacity: 0 });
      r.blueGlow = circ(g, 7.25, 17.85, 1.2, '#4d8dff', { opacity: 0, 'class': 'wb-glow' });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      setOp(r.pwr, v.power ? 1 : 0);
      var b = v.power ? clamp01(v.ledBlue) : 0; setOp(r.blue, b); setOp(r.blueGlow, b * 0.5);
      var w = v.power ? v.wifi : 'off';
      r.wifi.setAttribute('fill', w === 'on' ? '#0e7a3a' : w === 'connecting' ? '#7a5bd1' : '#4a5058');
      r.wifi.textContent = w === 'on' ? 'WiFi ✓' : w === 'connecting' ? 'WiFi …' : 'WiFi';
    }
  };

  /* ---------- Arduino Nano (pluggable; origin = D12; rows y 0 and y 6, x 0..14; USB on the left) ---------- */
  Art.nano = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-nano'), r = {};
      rect(g, -2.2, -0.8, 17.4, 7.6, '#1e5bb8', { rx: 0.35, stroke: '#164a85', 'stroke-width': 0.1 });
      rect(g, -2.9, 1.6, 3.0, 2.8, '#b9c0c8', { rx: 0.2 });                      // mini-USB
      rect(g, 5.2, 1.7, 3.6, 2.6, '#17191d', { rx: 0.1, transform: 'rotate(45 7 3)' }); // ATmega328P (TQFP)
      rect(g, 1.4, 2.4, 1.6, 1.2, '#e9ecef', { rx: 0.15 }); circ(g, 2.2, 3.0, 0.4, '#2a2d33'); // reset
      (def.pins || []).forEach(function (p) {
        txt(g, 0, 0, p.label || p.id, 'wb-silk wb-silk-w', { 'font-size': 0.42, 'text-anchor': p.y < 3 ? 'start' : 'end',
          transform: 'translate(' + (p.x + 0.15) + ' ' + (p.y < 3 ? 0.7 : 5.3) + ') rotate(90)' });
      });
      txt(g, 12, 3.3, 'NANO', 'wb-logo', { 'font-size': 1.1, 'text-anchor': 'middle' });
      function led(x, y, col) { rect(g, x - 0.3, y - 0.2, 0.6, 0.4, '#e8d9a0'); return rect(g, x - 0.3, y - 0.2, 0.6, 0.4, col, { opacity: 0 }); }
      r.L = led(10.2, 2.0, '#ffb020'); r.ON = led(10.2, 4.0, '#3df58c'); r.TX = led(13.8, 2.0, '#ffb020'); r.RX = led(13.8, 4.0, '#ffb020');
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      setOp(r.L, v.power ? clamp01(v.ledL) : 0); setOp(r.ON, v.power ? 1 : 0);
      setOp(r.TX, v.power && v.ledTx ? 1 : 0); setOp(r.RX, v.power && v.ledRx ? 1 : 0);
    }
  };

  /* ---------- Breadboards ---------- */
  function railX(k) { return 3 + 6 * Math.floor((k - 1) / 5) + ((k - 1) % 5); }
  function drawBB(inst, def, cols, rails) {
    var g = group('wb-art wb-art-bb'), W = cols + 3, split = !!prop(inst, def, 'splitRails');
    rect(g, 0, 0, W, 20, '#e8e3d6', { rx: 0.4, stroke: '#c9c2b0', 'stroke-width': 0.1 });
    rect(g, 0.6, 9.05, W - 1.2, 0.9, '#d2cbb8', { rx: 0.3 });           // centre trench (0.3 inch)
    rect(g, 0.6, 2.9, W - 1.2, 0.18, '#d8d1bf'); rect(g, 0.6, 16.0, W - 1.2, 0.18, '#d8d1bf');
    var x0 = railX(1) - 0.6, x1 = railX(rails) + 0.6;
    function rl(y, col) {
      if (!split) { line(g, x0, y, x1, y, col, 0.14); return; }
      var mid = (railX(rails / 2) + railX(rails / 2 + 1)) / 2;
      line(g, x0, y, mid - 0.7, y, col, 0.14); line(g, mid + 0.7, y, x1, y, col, 0.14);
    }
    rl(0.35, '#2a5bd7'); rl(2.65, '#d33a3a'); rl(16.35, '#d33a3a'); rl(18.65, '#2a5bd7');
    [[1, '−', '#2a5bd7'], [2, '+', '#d33a3a'], [17, '+', '#d33a3a'], [18, '−', '#2a5bd7']].forEach(function (s) {
      txt(g, 1.3, s[0] + 0.3, s[1], 'wb-silk', { 'font-size': 0.9, 'text-anchor': 'middle', fill: s[2] });
      txt(g, W - 1.0, s[0] + 0.3, s[1], 'wb-silk', { 'font-size': 0.9, 'text-anchor': 'middle', fill: s[2] });
    });
    var rows = 'abcdefghij';
    for (var i = 0; i < 10; i++) {
      var y = i < 5 ? 4 + i : 6 + i;
      txt(g, 0.95, y + 0.2, rows[i], 'wb-silk', { 'font-size': 0.55, 'text-anchor': 'middle', fill: '#8a8473' });
      txt(g, W - 0.95, y + 0.2, rows[i], 'wb-silk', { 'font-size': 0.55, 'text-anchor': 'middle', fill: '#8a8473' });
    }
    for (var c = 1; c <= cols; c++) if (c === 1 || c % 5 === 0) {
      txt(g, c + 1, 3.45, String(c), 'wb-silk', { 'font-size': 0.5, 'text-anchor': 'middle', fill: '#8a8473' });
      txt(g, c + 1, 16.85, String(c), 'wb-silk', { 'font-size': 0.5, 'text-anchor': 'middle', fill: '#8a8473' });
    }
    return g;
  }
  Art.bb400 = { draw: function (inst, def) { return drawBB(inst, def, 30, 25); }, update: function () {} };
  Art.bb830 = { draw: function (inst, def) { return drawBB(inst, def, 63, 50); }, update: function () {} };

  /* ---------- LED (A 0,0 · K 1,0) ----------
     Top view of a 5 mm LED standing in the board: the dome sits right over its two legs, so it does
     not hide the neighbouring rows. The flat of the rim marks the cathode (K) side, like a real one. */
  var LED_CY = -0.1;
  Art.led = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-led'), r = {}, col = LED_COL[prop(inst, def, 'color')] || LED_COL.red, cy = LED_CY;
      r.glow2 = circ(g, 0.5, cy, 2.2, col[1], { opacity: 0, 'class': 'wb-glow' });
      r.glow = circ(g, 0.5, cy, 1.45, col[1], { opacity: 0, 'class': 'wb-glow' });
      el('path', { d: 'M0.5 ' + (cy - 1.05) + ' A1.05 1.05 0 1 0 0.5 ' + (cy + 1.05) + ' L1.42 ' + (cy + 1.05) + ' L1.42 ' + (cy - 1.05) + ' Z', fill: col[0], opacity: 0.9 }, g);
      r.body = circ(g, 0.5, cy, 0.9, col[0], { stroke: 'rgba(255,255,255,.25)', 'stroke-width': 0.08 });
      r.core = circ(g, 0.5, cy, 0.62, col[1], { opacity: 0 });
      circ(g, 0.22, cy - 0.32, 0.2, '#ffffff', { opacity: 0.35 });
      txt(g, -0.75, cy - 0.75, '+', 'wb-silk wb-silk-w', { 'font-size': 0.7, 'text-anchor': 'middle' });
      g.__r = r; g.__col = col; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var burnt = !!v.burnt, b = burnt ? 0 : clamp01(v.b);
      setOp(r.core, b); setOp(r.glow, b * 0.55); setOp(r.glow2, b * 0.25);
      r.body.setAttribute('fill', burnt ? '#2a2122' : g.__col[0]);
    }
  };

  /* ---------- RGB LED common cathode (R 0 · C 1 · G 2 · B 3), dome over the legs ---------- */
  Art.rgb = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-rgb'), r = {};
      r.glow = circ(g, 1.5, -0.1, 2.3, '#ffffff', { opacity: 0, 'class': 'wb-glow' });
      r.body = circ(g, 1.5, -0.1, 1.05, '#d9dde2', { opacity: 0.85, stroke: 'rgba(255,255,255,.4)', 'stroke-width': 0.08 });
      r.core = circ(g, 1.5, -0.1, 0.75, '#ffffff', { opacity: 0 });
      txt(g, 0, -1.3, 'R', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      txt(g, 2, -1.3, 'G', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      txt(g, 3, -1.3, 'B', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var bu = v.burnt || {}, R = bu.r ? 0 : clamp01(v.r), G = bu.g ? 0 : clamp01(v.g), B = bu.b ? 0 : clamp01(v.b);
      var m = Math.max(R, G, B);
      var c = 'rgb(' + Math.round(255 * R / (m || 1)) + ',' + Math.round(255 * G / (m || 1)) + ',' + Math.round(255 * B / (m || 1)) + ')';
      r.core.setAttribute('fill', c); r.glow.setAttribute('fill', c);
      setOp(r.core, m); setOp(r.glow, m * 0.4);
      r.body.setAttribute('fill', (bu.r || bu.g || bu.b) ? '#3a3132' : '#d9dde2');
    }
  };

  /* ---------- Resistor (1 0,0 · 2 4,0), colour bands from ohms ---------- */
  Art.resistor = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-res'), r = {};
      line(g, 0, 0, 4, 0, '#b9c0c8', 0.16, { 'class': 'wb-leg' });
      r.hot = el('rect', { x: 0.65, y: -0.75, width: 2.7, height: 1.5, rx: 0.7, fill: '#ff4d5e', opacity: 0, 'class': 'wb-glow' }, g);
      r.body = el('rect', { x: 0.85, y: -0.45, width: 2.3, height: 0.9, rx: 0.42, fill: '#d9c391', stroke: '#a68f5b', 'stroke-width': 0.06 }, g);
      var b = bandsFor(prop(inst, def, 'ohms')), xs = [1.25, 1.62, 1.99, 2.7];
      for (var i = 0; i < 4; i++) rect(g, xs[i] - 0.11, -0.45, 0.22, 0.9, b[i]);
      g.__r = r; return g;
    },
    update: function (g, v) { var r = g.__r; if (!r || !v) return; setOp(r.hot, v.hot ? 0.55 : 0); }
  };

  /* ---------- Push button 6x6 (1a 0,0 · 2a 2,0 · 1b 0,3 · 2b 2,3) ---------- */
  Art.button = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-btn'), r = {};
      line(g, 0, 0, 0, 0.5, '#b9c0c8', 0.16); line(g, 2, 0, 2, 0.5, '#b9c0c8', 0.16);
      line(g, 0, 3, 0, 2.5, '#b9c0c8', 0.16); line(g, 2, 3, 2, 2.5, '#b9c0c8', 0.16);
      rect(g, -0.2, 0.3, 2.4, 2.4, '#2a2e35', { rx: 0.15, stroke: '#9aa3ad', 'stroke-width': 0.1 });
      [[0.1, 0.6], [1.9, 0.6], [0.1, 2.4], [1.9, 2.4]].forEach(function (p) { circ(g, p[0], p[1], 0.14, '#7f8790'); });
      r.cap = circ(g, 1, 1.5, 0.85, '#15171b', { stroke: '#4b525c', 'stroke-width': 0.1, 'class': 'wb-act' });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      r.cap.setAttribute('r', v.pressed ? '0.72' : '0.85');
      r.cap.setAttribute('stroke', v.pressed ? '#3df58c' : '#4b525c');
    }
  };

  /* ---------- Slide switch SPDT (1 0,0 · C 1,0 · 2 2,0) ---------- */
  Art['switch'] = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-sw'), r = {};
      legs(g, def, -0.4);
      rect(g, -0.9, -1.7, 3.8, 1.4, '#aeb5bd', { rx: 0.15, stroke: '#7f8790', 'stroke-width': 0.08 });
      rect(g, -0.3, -1.35, 2.6, 0.7, '#2a2d33', { rx: 0.1 });
      r.knob = rect(g, -0.25, -1.55, 1.1, 1.1, '#15171b', { rx: 0.15, stroke: '#4b525c', 'stroke-width': 0.08, 'class': 'wb-act' });
      txt(g, 0, -2.0, '1', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      txt(g, 2, -2.0, '2', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
      g.__r = r; return g;
    },
    update: function (g, v) { var r = g.__r; if (!r || !v) return; r.knob.setAttribute('x', v.pos === 2 ? '1.15' : '-0.25'); }
  };

  /* ---------- Potentiometer 10k (1 · W · 3) ---------- */
  Art.pot = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-pot'), r = {};
      legs(g, def, -0.4);
      rect(g, -0.7, -3.7, 3.4, 3.4, '#2659c9', { rx: 0.3 });
      var k = group('wb-act', g); r.knobG = k;
      circ(k, 1, -2, 1.3, '#e9ecef', { stroke: '#9aa3ad', 'stroke-width': 0.08 });
      r.ptr = el('g', { transform: 'rotate(0 1 -2)' }, k);
      rect(r.ptr, 0.88, -3.2, 0.24, 1.2, '#2659c9', { rx: 0.1 });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var a = -135 + 270 * clamp01(v.p);
      r.ptr.setAttribute('transform', 'rotate(' + a.toFixed(1) + ' 1 -2)');
    }
  };

  /* ---------- LDR photoresistor (1 · 2) ---------- */
  Art.ldr = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-ldr'), r = {};
      // 5 mm LDR standing over its legs (top view)
      circ(g, 0.5, -0.1, 0.95, '#d6872f', { stroke: '#a8641c', 'stroke-width': 0.08 });
      el('path', { d: 'M-0.05 -0.7 h1.1 v0.3 h-1.1 v0.3 h1.1 v0.3 h-1.1 v0.3 h1.1', fill: 'none', stroke: '#7a2a14', 'stroke-width': 0.11 }, g);
      r.light = circ(g, 0.5, -0.1, 0.95, '#fff6c2', { opacity: 0 });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var l = Math.log(Math.max(0.1, +v.lux || 0.1)) / Math.log(10); // -1..4
      setOp(r.light, Math.max(0, (l + 1) / 5) * 0.45);
    }
  };

  /* ---------- Buzzer (active) and piezo (passive): P 0,0 · N 3,0 ---------- */
  function drawBuzz(inst, def, active) {
    var g = group('wb-art wb-art-buzz'), r = {};
    r.waves = group('wb-waves', g); r.waves.setAttribute('opacity', '0');
    [3.0, 3.6].forEach(function (rr) { el('path', { d: 'M' + (1.5 + rr * 0.7) + ' ' + (-rr * 0.7) + ' A' + rr + ' ' + rr + ' 0 0 1 ' + (1.5 + rr * 0.7) + ' ' + (rr * 0.7), fill: 'none', stroke: '#3df58c', 'stroke-width': 0.14 }, r.waves); });
    circ(g, 1.5, 0, 2.35, '#121418', { stroke: '#3a3f47', 'stroke-width': 0.1 });
    circ(g, 1.5, 0, 1.8, 'none', { stroke: '#262a30', 'stroke-width': 0.12 });
    if (active) circ(g, 1.5, 0, 1.25, '#e9ecef', { opacity: 0.9 });
    circ(g, 1.5, 0, 0.35, '#000');
    txt(g, 0.1, -1.05, '+', 'wb-silk wb-silk-w', { 'font-size': 0.8, 'text-anchor': 'middle' });
    txt(g, 1.5, 1.75, active ? 'ACTIVE' : 'PASSIVE', 'wb-silk wb-silk-w', { 'font-size': 0.42, 'text-anchor': 'middle' });
    g.__r = r; return g;
  }
  function updBuzz(g, v) { var r = g.__r; if (!r || !v) return; setOp(r.waves, v.on ? 0.3 + 0.7 * clamp01(v.vol == null ? 1 : v.vol) : 0); }
  Art.buzzer = { draw: function (i, d) { return drawBuzz(i, d, true); }, update: updBuzz };
  Art.piezo = { draw: function (i, d) { return drawBuzz(i, d, false); }, update: updBuzz };

  /* ---------- 7-segment common cathode (rows y 0 and y 6) ---------- */
  var SEG = {
    a: [1.1, 0.5, 1.8, 0.36], b: [2.95, 0.92, 0.36, 2.0], c: [2.95, 3.28, 0.36, 2.0], d: [1.1, 5.33, 1.8, 0.36],
    e: [0.69, 3.28, 0.36, 2.0], f: [0.69, 0.92, 0.36, 2.0], g: [1.1, 2.92, 1.8, 0.36]
  };
  Art.seg7 = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-seg'), r = { seg: {} };
      rect(g, -0.45, -0.7, 4.9, 7.4, '#1b1c1f', { rx: 0.15, stroke: '#3a3f47', 'stroke-width': 0.08 });
      var d = group(null, g); d.setAttribute('transform', 'translate(0.2 0.2) skewX(-6)');
      Object.keys(SEG).forEach(function (k) { var s = SEG[k]; r.seg[k] = rect(d, s[0], s[1], s[2], s[3], '#3a1518', { rx: 0.12 }); });
      r.seg.dp = circ(d, 3.75, 5.5, 0.24, '#3a1518');
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var s = v.seg || {};
      Object.keys(r.seg).forEach(function (k) {
        var b = v.burnt ? 0 : clamp01(s[k]);
        r.seg[k].setAttribute('fill', b > 0.02 ? 'rgba(255,59,71,' + (0.35 + 0.65 * b).toFixed(2) + ')' : '#3a1518');
      });
    }
  };

  /* ---------- HC-SR04 (VCC 0 · Trig 1 · Echo 2 · GND 3) ---------- */
  Art.hcsr04 = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-sr'), r = {};
      rect(g, -7.4, -7.8, 17.8, 8.3, '#1f5fa8', { rx: 0.3, stroke: '#164a85', 'stroke-width': 0.1 });
      [-3.3, 6.3].forEach(function (cx, i) {
        circ(g, cx, -4.1, 3.1, '#c3c8cf', { stroke: '#8a9098', 'stroke-width': 0.12 });
        circ(g, cx, -4.1, 2.45, '#3b3f46');
        for (var k = -2; k <= 2; k++) line(g, cx - 2.2, -4.1 + k * 0.8, cx + 2.2, -4.1 + k * 0.8, '#2a2d33', 0.1);
        txt(g, cx, -0.6, i ? 'R' : 'T', 'wb-silk wb-silk-w', { 'font-size': 0.55, 'text-anchor': 'middle' });
      });
      rect(g, 0.6, -7.3, 1.8, 0.8, '#c9ced4', { rx: 0.35 });
      txt(g, 1.5, -2.6, 'HC-SR04', 'wb-silk wb-silk-w', { 'font-size': 0.6, 'text-anchor': 'middle' });
      rect(g, -0.55, -0.55, 4.1, 1.1, '#121418', { rx: 0.1 });
      pinLabels(g, def, -0.85, 0.4);
      r.ping = circ(g, -3.3, -4.1, 3.6, 'none', { stroke: '#3df58c', 'stroke-width': 0.15, opacity: 0 });
      r.dist = txt(g, 1.5, -1.5, '', 'wb-silk', { 'font-size': 0.55, 'text-anchor': 'middle', fill: '#cfe8ff' });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      setOp(r.ping, v.powered && v.pinging ? 0.8 : 0);
      r.dist.textContent = v.distance != null ? Math.round(v.distance) + ' cm' : '';
    }
  };

  /* ---------- DHT11 / DHT22 module (VCC 0 · DATA 1 · GND 2) ---------- */
  function drawDHT(inst, def, white) {
    var g = group('wb-art wb-art-dht'), r = {};
    rect(g, -1, -2.4, 5, 3.3, '#1f5fa8', { rx: 0.2 });
    rect(g, -0.5, -6, 3.0, 3.9, white ? '#eef0f2' : '#3d8fd9', { rx: 0.25 });
    for (var y = -5.5; y < -2.4; y += 0.65) for (var x = 0; x < 2.2; x += 0.7) rect(g, -0.15 + x, y, 0.45, 0.3, white ? '#b9bec5' : '#235c94', { rx: 0.08 });
    rect(g, -0.55, -0.55, 3.1, 1.1, '#121418', { rx: 0.1 });
    pinLabels(g, def, -0.85, 0.4);
    rect(g, 3.0, -2.0, 0.6, 0.45, '#5a1a1f');
    r.pwr = rect(g, 3.0, -2.0, 0.6, 0.45, '#ff3b47', { opacity: 0 });
    txt(g, 3.3, -1.0, white ? '22' : '11', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'middle' });
    g.__r = r; return g;
  }
  function updDHT(g, v) { var r = g.__r; if (!r || !v) return; setOp(r.pwr, v.powered ? 1 : 0); }
  Art.dht11 = { draw: function (i, d) { return drawDHT(i, d, false); }, update: updDHT };
  Art.dht22 = { draw: function (i, d) { return drawDHT(i, d, true); }, update: updDHT };

  /* ---------- SG90 servo (GND brown · VCC red · SIG orange) ---------- */
  Art.sg90 = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-servo'), r = {};
      line(g, 0, -0.4, 0, -3.3, '#6b3e1e', 0.28); line(g, 1, -0.4, 1, -3.3, '#d33a3a', 0.28); line(g, 2, -0.4, 2, -3.3, '#f39a1e', 0.28);
      rect(g, -0.5, -0.6, 3.0, 1.1, '#121418', { rx: 0.1 });
      rect(g, -2, -6.3, 13, 1.7, '#2f6fd6', { rx: 0.3, opacity: 0.95 });
      circ(g, -1.2, -5.45, 0.35, '#07090d'); circ(g, 10.2, -5.45, 0.35, '#07090d');
      rect(g, 0, -7.8, 9, 4.6, '#3a7be0', { rx: 0.3, stroke: '#2556a8', 'stroke-width': 0.1 });
      circ(g, 4.4, -5.5, 1.3, '#3a7be0', { stroke: '#2556a8', 'stroke-width': 0.08 });
      circ(g, 2.3, -5.5, 2.2, '#4a88ea', { stroke: '#2556a8', 'stroke-width': 0.08 });
      txt(g, 6.6, -3.6, 'SG90', 'wb-silk wb-silk-w', { 'font-size': 0.6, 'text-anchor': 'middle' });
      // horn: single arm, angle 0..180 maps to pointing right..left through up
      r.horn = el('g', { transform: 'rotate(-90 2.3 -5.5)' }, g);
      el('path', { d: 'M2.3 -6.25 L6.0 -5.85 A0.35 0.35 0 0 1 6.0 -5.15 L2.3 -4.75 A0.75 0.75 0 0 1 2.3 -6.25 Z', fill: '#f4f6f8', stroke: '#b9c0c8', 'stroke-width': 0.06 }, r.horn);
      circ(r.horn, 5.6, -5.5, 0.12, '#9aa3ad'); circ(r.horn, 4.6, -5.5, 0.12, '#9aa3ad');
      circ(g, 2.3, -5.5, 0.45, '#e9ecef', { stroke: '#9aa3ad', 'stroke-width': 0.06 });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var a = Math.max(0, Math.min(180, +v.angle || 0));
      r.horn.setAttribute('transform', 'rotate(' + (-a).toFixed(1) + ' 2.3 -5.5)');
    }
  };

  /* ---------- LCD 16x2 with I2C backpack (GND · VCC · SDA · SCL) ---------- */
  var LCD_X0 = 1.75, LCD_CW = 1.5, LCD_GAP = 0.17, LCD_Y = [-9.45, -6.15], LCD_CH = 2.6;
  Art.lcd1602 = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-lcd'), r = { cells: [[], []], chars: [[], []], last: ['', ''] };
      rect(g, -1, -12, 32, 13, '#1f7a3e', { rx: 0.4, stroke: '#155a2c', 'stroke-width': 0.1 });
      [[0, -11.2], [30, -11.2], [30, 0.2]].forEach(function (h) { circ(g, h[0], h[1], 0.5, '#e7d9a8'); circ(g, h[0], h[1], 0.3, '#07090d'); });
      rect(g, 0.6, -11.2, 29, 9.0, '#0d0f12', { rx: 0.2 });
      r.screen = rect(g, 1.4, -10.0, 28.0, 6.8, '#14275e', { rx: 0.15 });
      for (var row = 0; row < 2; row++) for (var c = 0; c < 16; c++) {
        var x = LCD_X0 + c * (LCD_CW + LCD_GAP);
        r.cells[row].push(rect(g, x, LCD_Y[row], LCD_CW, LCD_CH, '#ffffff', { opacity: 0.06 }));
        r.chars[row].push(txt(g, x + LCD_CW / 2, LCD_Y[row] + 2.0, '', 'wb-lcd-ch', { 'font-size': 2.1, 'text-anchor': 'middle', fill: '#eaf1ff' }));
      }
      r.cursor = rect(g, 0, 0, LCD_CW, 0.22, '#eaf1ff', { display: 'none' });
      rect(g, -0.55, -0.55, 4.1, 1.1, '#121418', { rx: 0.1 });
      pinLabels(g, def, -0.85, 0.42);
      txt(g, 22, -0.6, 'I2C 0x' + Number(prop(inst, def, 'addr') || 39).toString(16).toUpperCase(), 'wb-silk wb-silk-w', { 'font-size': 0.6, 'text-anchor': 'middle' });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var on = !!v.powered, bl = on && !!v.backlight;
      r.screen.setAttribute('fill', bl ? (v.dim ? '#2a4bb0' : '#3b6ff5') : on ? '#1a326f' : '#101c3d');
      var ink = bl ? '#f2f6ff' : '#7f95c9';
      var lines = v.lines || ['', ''];
      for (var row = 0; row < 2; row++) {
        var block = on && v.uninit && row === 0;
        var s = (!on || v.display === false || v.uninit) ? '' : String(lines[row] || '');
        var key = (block ? 'B' : '') + s + '|' + ink;
        if (r.last[row] === key) continue;
        r.last[row] = key;
        for (var c = 0; c < 16; c++) {
          r.chars[row][c].textContent = s.charAt(c) === ' ' ? '' : s.charAt(c);
          r.chars[row][c].setAttribute('fill', ink);
          r.cells[row][c].setAttribute('opacity', block ? (bl ? 0.95 : 0.6) : 0.06);
        }
      }
      var cu = v.cursor;
      if (on && cu && !v.uninit && v.display !== false && cu.c >= 0 && cu.c < 16 && (cu.r === 0 || cu.r === 1)) {
        r.cursor.setAttribute('x', String(LCD_X0 + cu.c * (LCD_CW + LCD_GAP)));
        r.cursor.setAttribute('y', String(LCD_Y[cu.r] + LCD_CH - 0.3));
        r.cursor.setAttribute('fill', ink); show(r.cursor, true);
      } else show(r.cursor, false);
    }
  };

  /* ---------- PIR HC-SR501 (VCC · OUT · GND) ---------- */
  Art.pir = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-pir'), r = {};
      rect(g, -3, -11.5, 10, 12.3, '#25803f', { rx: 0.3 });
      r.dome = circ(g, 1, -5.6, 4.6, '#f2f1ea', { stroke: '#cfcdc2', 'stroke-width': 0.1, 'class': 'wb-act' });
      for (var k = -3; k <= 3; k++) { line(g, 1 + k * 1.3, -9.6, 1 + k * 1.3, -1.6, '#d9d7cc', 0.06, { opacity: Math.abs(k) < 3 ? 1 : 0 }); }
      for (var j = -2; j <= 2; j++) line(g, -2.6, -5.6 + j * 1.4, 4.6, -5.6 + j * 1.4, '#d9d7cc', 0.06);
      circ(g, 1, -5.6, 4.6, 'none', { stroke: '#cfcdc2', 'stroke-width': 0.12 });
      rect(g, -0.55, -0.55, 3.1, 1.1, '#121418', { rx: 0.1 });
      pinLabels(g, def, -0.85, 0.4);
      // simulator aid (not on the real module): OUT state dot + warm-up countdown
      r.out = circ(g, 5.9, -0.3, 0.38, '#2a2d33', { stroke: '#0d0f12', 'stroke-width': 0.08 });
      r.warm = txt(g, 1, -10.4, '', 'wb-silk', { 'font-size': 0.7, 'text-anchor': 'middle', fill: '#fff6c2' });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      r.out.setAttribute('fill', v.powered && v.out ? '#3df58c' : '#2a2d33');
      var w = v.powered && v.warmupLeftS > 0 ? Math.ceil(v.warmupLeftS) : 0;
      r.warm.textContent = w ? 'warm-up ' + w + 's' : '';
    }
  };

  /* ---------- IR obstacle FC-51 (OUT · GND · VCC) ---------- */
  Art.irobst = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-ir'), r = {};
      rect(g, -1, -9.2, 6, 10, '#1f5fa8', { rx: 0.3 });
      circ(g, 0.4, -9.4, 0.95, '#e9f3ff', { stroke: '#9aa3ad', 'stroke-width': 0.08 });
      circ(g, 3.6, -9.4, 0.95, '#1b1d22', { stroke: '#4b525c', 'stroke-width': 0.08 });
      rect(g, 1.0, -6.4, 2.0, 2.0, '#2659c9', { rx: 0.2 }); circ(g, 2, -5.4, 0.6, '#e9ecef');
      rect(g, 0.0, -3.0, 0.7, 0.5, '#5a1a1f'); r.pwr = rect(g, 0.0, -3.0, 0.7, 0.5, '#ff3b47', { opacity: 0 });
      rect(g, 3.3, -3.0, 0.7, 0.5, '#1f4a2c'); r.det = rect(g, 3.3, -3.0, 0.7, 0.5, '#3df58c', { opacity: 0 });
      r.detGlow = circ(g, 3.65, -2.75, 1.0, '#3df58c', { opacity: 0, 'class': 'wb-glow' });
      rect(g, -0.55, -0.55, 3.1, 1.1, '#121418', { rx: 0.1 });
      pinLabels(g, def, -0.85, 0.4);
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      setOp(r.pwr, v.powered ? 1 : 0); var d = v.powered && v.detect ? 1 : 0; setOp(r.det, d); setOp(r.detGlow, d * 0.5);
    }
  };

  /* ---------- Soil moisture (VCC · GND · D0 · A0) ---------- */
  Art.soil = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-soil'), r = {};
      r.dirt = rect(g, -1, -14, 6, 4.6, '#6b4a2b', { rx: 0.3, opacity: 0.5 });
      el('path', { d: 'M0.2 -13.6 h1.2 v5.6 h1.2 v-5.6 h1.2 v6.8 h-3.6 Z', fill: '#1d3d6e', stroke: '#c9a227', 'stroke-width': 0.1 }, g);
      rect(g, -1, -6.0, 6, 6.8, '#1f5fa8', { rx: 0.3 });
      rect(g, 1.0, -5.2, 2.0, 2.0, '#2659c9', { rx: 0.2 }); circ(g, 2, -4.2, 0.6, '#e9ecef');
      rect(g, 0.0, -2.6, 0.7, 0.5, '#5a1a1f'); r.pwr = rect(g, 0.0, -2.6, 0.7, 0.5, '#ff3b47', { opacity: 0 });
      rect(g, 3.3, -2.6, 0.7, 0.5, '#1f4a2c'); r.d0 = rect(g, 3.3, -2.6, 0.7, 0.5, '#3df58c', { opacity: 0 });
      rect(g, -0.55, -0.55, 4.1, 1.1, '#121418', { rx: 0.1 });
      pinLabels(g, def, -0.85, 0.4);
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var m = clamp01((+v.m || 0) > 1 ? v.m / 100 : v.m);
      r.dirt.setAttribute('fill', m > 0.5 ? '#3b2716' : '#8a6a42'); setOp(r.dirt, 0.4 + 0.5 * m);
      setOp(r.pwr, v.powered ? 1 : 0);
      setOp(r.d0, v.powered && v.dOut === 0 ? 1 : 0);  // module LED lights when D0 is LOW (wet)
    }
  };

  /* ---------- Relay module 5V (VCC · GND · IN · NO · COM · NC) ---------- */
  Art.relay = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-relay'), r = {};
      rect(g, -1, -2, 16, 10, '#1f5fa8', { rx: 0.3 });
      rect(g, 3.6, -1.4, 7.8, 7.6, '#2a63c4', { rx: 0.2, stroke: '#1b4a99', 'stroke-width': 0.1 });
      txt(g, 7.5, 1.0, 'SRD-05VDC-SL-C', 'wb-silk wb-silk-w', { 'font-size': 0.55, 'text-anchor': 'middle' });
      // contact symbol (simulator aid): COM arm to NO (on) or NC (off)
      line(g, 9.6, 3.4, 10.6, 3.4, '#e9ecef', 0.12); line(g, 9.6, 4.6, 10.6, 4.6, '#e9ecef', 0.12);
      r.arm = line(g, 8.0, 4.0, 9.6, 4.6, '#3df58c', 0.16);
      rect(g, 12.6, 3.2, 2.4, 3.6, '#2d6fd1', { rx: 0.2 });
      [4, 5, 6].forEach(function (y) { circ(g, 14, y, 0.42, '#c3c8cf'); line(g, 13.75, y, 14.25, y, '#6b737d', 0.1); });
      txt(g, 12.3, 4.2, 'NO', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'end' });
      txt(g, 12.3, 5.2, 'COM', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'end' });
      txt(g, 12.3, 6.2, 'NC', 'wb-silk wb-silk-w', { 'font-size': 0.45, 'text-anchor': 'end' });
      rect(g, -0.55, -0.55, 3.1, 1.1, '#121418', { rx: 0.1 });
      ['VCC', 'GND', 'IN'].forEach(function (s, i) { txt(g, i, 1.3, s, 'wb-silk wb-silk-w', { 'font-size': 0.4, 'text-anchor': 'middle' }); });
      rect(g, 0.0, 3.0, 0.7, 0.5, '#5a1a1f'); r.pwr = rect(g, 0.0, 3.0, 0.7, 0.5, '#ff3b47', { opacity: 0 });
      rect(g, 0.0, 4.6, 0.7, 0.5, '#1f4a2c'); r.inl = rect(g, 0.0, 4.6, 0.7, 0.5, '#3df58c', { opacity: 0 });
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      setOp(r.pwr, v.powered ? 1 : 0); setOp(r.inl, v.inLed ? 1 : 0);
      r.arm.setAttribute('y2', v.on ? '3.4' : '4.6');
    }
  };

  /* ---------- Small 5V lamp (1 · 2) ---------- */
  Art.lamp = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-lamp'), r = {};
      legs(g, def, -0.4);
      r.glow = circ(g, 1, -1.6, 2.6, '#ffd84a', { opacity: 0, 'class': 'wb-glow' });
      rect(g, 0.3, -0.6, 1.4, 0.6, '#9aa3ad');
      r.glass = circ(g, 1, -1.6, 1.3, '#e9ecef', { opacity: 0.45, stroke: '#cfd4da', 'stroke-width': 0.08 });
      el('path', { d: 'M0.55 -1.0 L0.7 -2.0 Q1 -2.4 1.3 -2.0 L1.45 -1.0', fill: 'none', stroke: '#6b737d', 'stroke-width': 0.08 }, g);
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      var b = clamp01(v.b); setOp(r.glow, b * 0.6); r.glass.setAttribute('fill', b > 0.05 ? '#fff3b0' : '#e9ecef');
    }
  };

  /* ---------- 9V battery (P · N) ---------- */
  Art.bat9v = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-bat'), r = {};
      line(g, 0, -0.3, 0.6, -2.8, '#d33a3a', 0.25); line(g, 2, -0.3, 1.6, -2.8, '#2b2b2b', 0.25);
      rect(g, -0.3, -0.5, 2.6, 0.9, '#121418', { rx: 0.1 });
      rect(g, -1, -8, 7, 5.2, '#1d1f24', { rx: 0.3 });
      rect(g, -1, -8, 7, 1.4, '#c9a227', { rx: 0.3 });
      txt(g, 2.5, -4.3, '9V', 'wb-logo', { 'font-size': 1.6, 'text-anchor': 'middle' });
      rect(g, 0.0, -3.4, 2.2, 0.7, '#0d0f12', { rx: 0.15 });
      txt(g, 0, 1.25, '+', 'wb-silk wb-silk-w', { 'font-size': 0.7, 'text-anchor': 'middle' });
      txt(g, 2, 1.25, '−', 'wb-silk wb-silk-w', { 'font-size': 0.7, 'text-anchor': 'middle' });
      g.__r = r; return g;
    },
    update: function () {}
  };

  /* ---------- Small DC motor (optional part) ---------- */
  Art.motor = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-motor'), r = {};
      legs(g, def, -0.4);
      rect(g, -0.9, -2.9, 3.8, 2.5, '#c3c8cf', { rx: 0.5 });
      r.rotor = el('g', { transform: 'rotate(0 1 -1.65)' }, g);
      line(r.rotor, 0, -1.65, 2, -1.65, '#f39a1e', 0.3);
      g.__r = r; return g;
    },
    update: function (g, v) {
      var r = g.__r; if (!r || !v) return;
      r.rotor.setAttribute('transform', 'rotate(' + Math.round((+v.speed || 0) * 90) + ' 1 -1.65)');
    }
  };

  /* ---------- Fallback: grey box + name (unknown types, optional parts without art) ---------- */
  Art.fallback = {
    draw: function (inst, def) {
      var g = group('wb-art wb-art-fallback'), b = (def && def.bbox) || { x: -1, y: -1, w: 3, h: 2 };
      rect(g, b.x, b.y, b.w, b.h, '#2a313b', { rx: 0.3, stroke: '#66768a', 'stroke-width': 0.1 });
      txt(g, b.x + b.w / 2, b.y + b.h / 2 + 0.25, (def && (def.name_en || def.type)) || (inst && inst.type) || '?', 'wb-silk wb-silk-w', { 'font-size': Math.min(0.9, b.h / 2.5), 'text-anchor': 'middle' });
      return g;
    },
    update: function () {}
  };

  Art._bandsFor = bandsFor; // exported for tests
  NS.Art = Art;
})(typeof window !== 'undefined' ? window : globalThis);
