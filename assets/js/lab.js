/* بإيدك: «المعمل» (lab.html only; index.html shows a static teaser). Classic script, no libraries, no external files, works from file://.
   Lightweight CSS 3D devices on a bench (ESP32, Arduino Uno, breadboard, HC-SR04): each one is a few CSS cuboids
   (6 faces, transform-style: preserve-3d) with an inline SVG drawing on top. Drag = rotate 360°, move mode or
   Shift+drag = slide on the bench, double-click = reset. Keyboard: the device buttons (arrows / Shift+arrows / Enter).
   The ESP32 reads everything from window.ESP_BEHAVIOR (assets/js/esp-behavior.js, owner-editable).
   Visitor code box: our own tiny parser for a fixed command list. No eval, no Function, no innerHTML with visitor text.
   Motion: idle spin, inertia and tweens only while html.motion-on and not prefers-reduced-motion; direct
   manipulation and buttons always work. Without this file the static picture in .lab-static stays.
   18 Nov 2026 (owner order): a components panel per device (highlights on the model), the visitor's own board over
   Web Serial (Chrome / Edge desktop), and a two-stage run: stage 1 always on the virtual parts; stage 2 sends the
   same commands as text lines to the board only after a clean stage 1. The board needs
   assets/firmware/beedak-lab-bridge/beedak-lab-bridge.ino once (the browser never uploads firmware). */
(function () {
  'use strict';
  var lab = document.getElementById('lab');
  var bench = document.getElementById('bench');
  var floor = document.getElementById('floor');
  // the lab starts on lab.html only (body data-page="lab"); anywhere else this file does nothing
  if (!document.body || document.body.getAttribute('data-page') !== 'lab') return;
  if (!lab || !bench || !floor || !window.requestAnimationFrame) return;

  var html = document.documentElement;
  var rmQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function smooth() { return html.classList.contains('motion-on') && !(rmQ && rmQ.matches); }
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /* ---------- Owner config, merged over safe defaults (a broken or missing file never breaks the lab) ---------- */
  var DEF = {
    name: 'ESP32',
    led: { colors: { green: '#3DF58C', red: '#FF4D5E', violet: '#A78BFA' }, startColor: 'green', startOn: false, blinkMs: 450 },
    wifi: { ssid: 'beedak-lab', startState: 'disconnected', connectMs: 1600,
      colors: { disconnected: '#FF4D5E', connecting: '#A78BFA', connected: '#3DF58C' },
      labels: { disconnected: 'WL_DISCONNECTED', connecting: 'WL_IDLE…', connected: 'WL_CONNECTED' } },
    serial: { baud: 115200, maxLines: 60, bootLines: ['boot: ESP32'],
      messages: { connecting: 'connecting to {ssid}…', connected: 'connected: {ssid}', disconnected: 'Wi-Fi off', ledOn: 'LED on', ledOff: 'LED off', color: 'LED colour: {color}', done: 'done.' } },
    onClick: 'hello', autoRun: '',
    idle: { spin: true, spinSpeed: 10 },
    rotation: { dragSpeed: 0.6, inertia: true, keyStep: 15 },
    start: { x: -0.27, y: 0.14, yaw: -28, pitch: 0 },
    sequences: { hello: [{ say: 'hello' }, { blink: 2 }] }
  };
  function merge(a, b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      out[k] = (a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) ? merge(a[k], b[k]) : b[k];
    }
    return out;
  }
  var cfgOk = !!(window.ESP_BEHAVIOR && typeof window.ESP_BEHAVIOR === 'object');
  var CFG = merge(DEF, cfgOk ? window.ESP_BEHAVIOR : {});
  function num(v, d, lo, hi) { v = Number(v); return isFinite(v) ? clamp(v, lo, hi) : d; }
  function hex(v, d) { return (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) ? v : d; }
  function str(v) { return String(v == null ? '' : v).slice(0, 120); }
  var BLINK_MIN = 200; // a full on+off cycle of 400 ms = 2.5 flashes a second, under the 3/s limit
  var blinkMs = num(CFG.led.blinkMs, 450, BLINK_MIN, 3000);
  var dragSpeed = num(CFG.rotation.dragSpeed, 0.6, 0.05, 3);
  var keyStep = num(CFG.rotation.keyStep, 15, 1, 90);
  var spinSpeed = num(CFG.idle.spinSpeed, 10, 0, 120);
  function msg(key, vars) {
    var t = str((CFG.serial.messages || {})[key] || DEF.serial.messages[key] || '');
    return t.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }

  /* ---------- Scene sizes ---------- */
  var TILT = 56; // the bench tilt in degrees
  var k = 1, FW = 600, FD = 600;
  function measure() {
    var w = bench.clientWidth || 360, h = bench.clientHeight || 300;
    k = clamp(w / 430, 0.62, 1.45); // review fix: devices were small on a wide bench
    FW = Math.round(w * 0.86); // the near edge grows with perspective; 0.86 keeps its corners inside the bench
    FD = Math.round(h * 1.3);
    bench.style.setProperty('--k', k.toFixed(3));
    floor.style.width = FW + 'px';
    floor.style.height = FD + 'px';
    floor.style.marginLeft = (-FW / 2) + 'px';
    floor.style.marginTop = (-FD / 2) + 'px';
  }

  /* ---------- Cuboid builder: w × d × h (base px, scaled by --k), centre offset x, y, z ---------- */
  var FACES = ['t', 'b', 'n', 'f', 'r', 'l'];
  function box(parent, cls, w, d, h, x, y, z) {
    var b = el('div', 'cb ' + cls, parent);
    b.style.setProperty('--w', w); b.style.setProperty('--d', d); b.style.setProperty('--h', h);
    b.style.transform = 'translate3d(calc(var(--k) * ' + (x || 0) + 'px), calc(var(--k) * ' + (y || 0) + 'px), calc(var(--k) * ' + (z || 0) + 'px))';
    FACES.forEach(function (f) { el('div', 'fc fc-' + f, b); });
    return b;
  }
  function top(b, svg) { b.querySelector('.fc-t').innerHTML = svg; return b; }
  // a flat plane lying on a surface (for wires, Wi-Fi arcs)
  function plane(parent, cls, w, d, x, y, z, svg) {
    var p = el('div', 'lpl ' + cls, parent);
    p.style.setProperty('--w', w); p.style.setProperty('--d', d);
    p.style.transform = 'translate3d(calc(var(--k) * ' + x + 'px), calc(var(--k) * ' + y + 'px), calc(var(--k) * ' + z + 'px))';
    p.innerHTML = svg;
    return p;
  }
  // a cylinder faked with stacked discs (HC-SR04 "eyes")
  function cylinder(parent, r, h, x, y, z0) {
    var c = el('div', 'cyl', parent);
    c.style.setProperty('--r', r);
    c.style.transform = 'translate3d(calc(var(--k) * ' + x + 'px), calc(var(--k) * ' + y + 'px), 0)';
    var n = 7;
    for (var i = 0; i < n; i++) {
      var d = el('div', 'disc' + (i === n - 1 ? ' disc-top' : ''), c);
      d.style.transform = 'translateZ(calc(var(--k) * ' + (z0 + (h * i) / (n - 1)).toFixed(2) + 'px))';
    }
    return c;
  }
  function pins(n, x0, y0, dx, dy, r, cls) {
    var s = '';
    for (var i = 0; i < n; i++) s += '<rect class="' + cls + '" x="' + (x0 + dx * i - r) + '" y="' + (y0 + dy * i - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" rx="' + (r * 0.3) + '"/>';
    return s;
  }

  /* ---------- Top-face drawings (inline SVG, decorative) ---------- */
  var SVG_ESP = '<svg viewBox="0 0 60 118" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<rect x="0.5" y="0.5" width="59" height="117" rx="3" fill="#10213A" stroke="#1E3A5F"/>' +
    '<rect x="11" y="1.5" width="38" height="44" rx="1.5" fill="#0B1626"/>' +
    '<path d="M15 12V4h4v8h4V4h4v8h4V4h4v8h4V4h3" fill="none" stroke="#D9B44A" stroke-width="1.4"/>' +
    pins(15, 4.5, 30, 0, 5.9, 1.3, 'esp-pad') + pins(15, 55.5, 30, 0, 5.9, 1.3, 'esp-pad') +
    '<rect x="13" y="92" width="8" height="5" rx="1" fill="#2A3442"/><rect x="39" y="92" width="8" height="5" rx="1" fill="#2A3442"/>' +
    '<text x="17" y="102" class="esp-tx">EN</text><text x="40" y="102" class="esp-tx">BOOT</text>' +
    '<text x="30" y="72" class="esp-tx esp-name" text-anchor="middle">ESP32 DevKit</text>' +
    '<rect x="22" y="78" width="16" height="9" rx="1" fill="#1A1A1A"/>' +
    '<circle class="esp-halo" cx="46" cy="84" r="7"/><circle class="esp-led" cx="46" cy="84" r="2.6"/>' +
    '<circle cx="14" cy="84" r="1.6" fill="#B33"/></svg>';
  var SVG_SHIELD = '<svg viewBox="0 0 34 36" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<rect width="34" height="36" fill="url(#lab-metal)"/><text x="17" y="15" class="sh-tx" text-anchor="middle">ESP32-WROOM</text>' +
    '<text x="17" y="22" class="sh-tx sh-sm" text-anchor="middle">Wi-Fi + BT</text><circle cx="5" cy="30" r="1.4" fill="#8A97A6"/></svg>';
  var SVG_WIFI = '<svg viewBox="0 0 70 40" aria-hidden="true" focusable="false">' +
    '<path class="wf-arc wf1" d="M28 36a8 8 0 0 1 14 0"/><path class="wf-arc wf2" d="M22 34a15 15 0 0 1 26 0"/><path class="wf-arc wf3" d="M15 32a23 23 0 0 1 40 0"/></svg>';
  var SVG_UNO = '<svg viewBox="0 0 140 106" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<path d="M3 1h128l6 6v92l-6 6H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Z" fill="#0A7C83" stroke="#08636A"/>' +
    '<circle cx="15" cy="6" r="3" fill="#06555B"/><circle cx="132" cy="18" r="3" fill="#06555B"/><circle cx="132" cy="96" r="3" fill="#06555B"/><circle cx="16" cy="99" r="3" fill="#06555B"/>' +
    '<text x="60" y="44" class="uno-tx uno-big">UNO</text><text x="60" y="54" class="uno-tx">ARDUINO</text>' +
    '<text x="38" y="20" class="uno-tx uno-sm">L</text><rect class="uno-l" x="36" y="22" width="5" height="3" rx="1"/>' +
    '<text x="110" y="34" class="uno-tx uno-sm">ON</text><rect x="110" y="36" width="5" height="3" rx="1" fill="#3DF58C"/>' +
    '<text x="38" y="32" class="uno-tx uno-sm">TX RX</text>' +
    '<path d="M70 66h40M70 72h40M74 80h30" stroke="#0FA3AC" stroke-width="1"/></svg>';
  var SVG_BB = (function () {
    var s = '<svg viewBox="0 0 170 110" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<defs><pattern id="lab-holes" width="6" height="6" patternUnits="userSpaceOnUse"><rect x="2" y="2" width="2.2" height="2.2" rx=".4" fill="#5E5A52"/></pattern></defs>' +
      '<rect x="0.5" y="0.5" width="169" height="109" rx="3" fill="#ECE7DB" stroke="#CFC8B8"/>' +
      '<path d="M6 5H164M6 105H164" stroke="#E0464F" stroke-width="1"/><path d="M6 15H164M6 95H164" stroke="#3D7BE0" stroke-width="1"/>' +
      '<rect x="6" y="7" width="158" height="6" fill="url(#lab-holes)"/><rect x="6" y="97" width="158" height="6" fill="url(#lab-holes)"/>' +
      '<rect x="6" y="22" width="158" height="30" fill="url(#lab-holes)"/><rect x="6" y="58" width="158" height="30" fill="url(#lab-holes)"/>' +
      '<rect x="4" y="52.5" width="162" height="5" fill="#D8D1C2"/></svg>';
    return s;
  })();
  var SVG_WIRES = '<svg viewBox="0 0 170 110" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<g class="wire-sh"><path d="M21 12c8 16 22 16 30 13"/><path d="M45 99c6-18 20-18 28-14"/><path d="M99 70c10-20 30-22 44-12"/><path d="M123 12c-4 14 4 22 12 25"/></g>' +
    '<g class="wire"><path class="w-r" d="M20 10c8 16 22 16 30 13"/><path class="w-g" d="M44 97c6-18 20-18 28-14"/><path class="w-v" d="M98 68c10-20 30-22 44-12"/><path class="w-y" d="M122 10c-4 14 4 22 12 25"/></g>' +
    '<rect x="60" y="34" width="22" height="7" rx="3.5" fill="#D9B88A"/><path d="M65 34v7M70 34v7M76 34v7" stroke="#7A3B1E" stroke-width="1.6"/>' +
    '<circle class="bb-led" cx="106" cy="40" r="5"/><path d="M104 45v6M108 45v6" stroke="#AAB" stroke-width="1"/></svg>';
  var SVG_SR04 = '<svg viewBox="0 0 90 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<rect x="0.5" y="0.5" width="89" height="39" rx="2" fill="#1C5BB8" stroke="#164A96"/>' +
    '<text x="45" y="35" class="sr-tx" text-anchor="middle">HC-SR04</text><text x="10" y="8" class="sr-tx">T</text><text x="77" y="8" class="sr-tx">R</text>' +
    pins(4, 37, 3.5, 5.3, 0, 1.2, 'sr-pin') +
    '<text x="37" y="9" class="sr-tx sr-pl" text-anchor="middle">VCC</text><text x="42.3" y="12" class="sr-tx sr-pl" text-anchor="middle">Trig</text>' +
    '<text x="47.6" y="9" class="sr-tx sr-pl" text-anchor="middle">Echo</text><text x="52.9" y="12" class="sr-tx sr-pl" text-anchor="middle">GND</text></svg>';

  /* ---------- Devices ---------- */
  var st = CFG.start || {};
  var DEVICES = [
    { id: 'esp', name: str(CFG.name) || 'ESP32', w: 60, d: 118, h: 4, fx: num(st.x, -0.27, -0.5, 0.5), fy: num(st.y, 0.14, -0.5, 0.5), yaw: num(st.yaw, -28, -3600, 3600), pitch: num(st.pitch, 0, -3600, 3600),
      build: function (r) {
        top(box(r, 'pcb pcb-esp', 60, 118, 4, 0, 0, 0), SVG_ESP);
        top(box(r, 'metal', 34, 36, 4, 0, -14, 4), SVG_SHIELD);
        box(r, 'hdr', 6, 92, 7, -25.5, 13, 5.5);
        box(r, 'hdr', 6, 92, 7, 25.5, 13, 5.5);
        box(r, 'metal usb', 13, 9, 4, 0, 56, 4);
        plane(r, 'wifi', 70, 40, 0, -66, 2.6, SVG_WIFI);
      } },
    { id: 'uno', name: 'Arduino Uno', w: 140, d: 106, h: 4, fx: 0.2, fy: -0.2, yaw: 14, pitch: 0,
      build: function (r) {
        top(box(r, 'pcb pcb-uno', 140, 106, 4, 0, 0, 0), SVG_UNO);
        box(r, 'metal usbb', 26, 22, 18, -62, -26, 11);
        box(r, 'jack', 24, 16, 18, -62, 32, 11);
        box(r, 'hdr hdr-x', 78, 7, 9, 22, -47, 6.5);
        box(r, 'hdr hdr-x', 64, 7, 9, 28, 47, 6.5);
        box(r, 'ic-chip', 56, 13, 4, 28, 18, 4);
        box(r, 'rst-btn', 7, 7, 4, -40, -44, 4);
      } },
    { id: 'bb', name: 'بريدبورد', w: 170, d: 110, h: 9, fx: 0.19, fy: 0.23, yaw: -6, pitch: 0,
      build: function (r) {
        top(box(r, 'bboard', 170, 110, 9, 0, 0, 0), SVG_BB);
        plane(r, 'wires', 170, 110, 0, 0, 7, SVG_WIRES);
      } },
    { id: 'sr', name: 'HC-SR04', w: 90, d: 40, h: 3, fx: -0.24, fy: -0.3, yaw: 20, pitch: 0,
      build: function (r) {
        top(box(r, 'pcb pcb-sr', 90, 40, 3, 0, 0, 0), SVG_SR04);
        cylinder(r, 15, 12, -24, -1, 2);
        cylinder(r, 15, 12, 24, -1, 2);
        box(r, 'metal xtal', 12, 5, 4, 0, -11, 3.5);
      } }
  ];
  DEVICES.forEach(function (d) {
    d.home = { fx: d.fx, fy: d.fy, yaw: d.yaw, pitch: d.pitch };
    d.vy = 0; d.vp = 0; d.tw = null;
  });

  // a shared metal gradient (one id for the page)
  var defs = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="lab-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E4E9EF"/><stop offset=".45" stop-color="#A9B4C0"/><stop offset=".55" stop-color="#C9D1DA"/><stop offset="1" stop-color="#8B96A3"/></linearGradient></defs></svg>';
  bench.insertAdjacentHTML('afterbegin', defs);

  // review fix: show the live lab before measuring (it is display:none until .lab-on, so the bench measured 0 and every screen got the fallback scale)
  lab.classList.add('lab-on');
  measure();
  DEVICES.forEach(function (d) {
    d.shadow = el('div', 'shadow', floor);
    d.shadow.style.setProperty('--w', d.w); d.shadow.style.setProperty('--d', d.d);
    d.root = el('div', 'dev dev-' + d.id, floor);
    d.root.setAttribute('data-dev', d.id);
    d.build(d.root);
  });
  var esp = DEVICES[0];

  /* ---------- Components of each device: list + highlight on the 3D model ----------
     hl = one or more outlines on the model, in the device's own base px (x, y = centre, w × d, z = height, r = corner radius). */
  var PARTS = {
    esp: [
      { id: 'module', name: 'ESP32-WROOM-32', hl: [{ x: 0, y: -14, w: 38, d: 40, z: 6.6, r: 2 }],
        text: 'الموديول المعدني: جواه معالج ESP32 بنواتين لحد 240 ميجاهرتز، وذاكرة فلاش (غالبًا 4 ميجابايت). ده العقل اللي بينفّذ الكود بتاعكم.' },
      { id: 'radio', name: 'Wi-Fi + Bluetooth', hl: [{ x: 0, y: -51, w: 40, d: 14, z: 2.6, r: 2 }],
        text: 'واي فاي 2.4 جيجاهرتز وبلوتوث Classic وBLE. الهوائي هو الخط المتعرّج في طرف الموديول، فبلاش تحطوا عليه معدن أو أسلاك.' },
      { id: 'led', name: 'LED (GPIO2)', hl: [{ x: 16, y: 25, w: 11, d: 11, z: 2.6, r: 5.5 }],
        text: 'أغلب لوحات DevKit عليها لمبة متوصلة على GPIO2، وفيه لوحات ما عليهاش غير لمبة الباور. دي اللي أوامر led وblink بتشغّلها.' },
      { id: 'buttons', name: 'EN + BOOT', hl: [{ x: -13, y: 35.5, w: 12, d: 9, z: 2.6, r: 1.5 }, { x: 13, y: 35.5, w: 12, d: 9, z: 2.6, r: 1.5 }],
        text: 'EN بيعمل ريستارت للكارت. BOOT متوصل على GPIO0: لو دايسين عليه وانتو بتعملوا ريستارت، الكارت بيدخل وضع رفع الكود.' },
      { id: 'uart', name: 'USB-UART (CP2102 / CH340)', hl: [{ x: 0, y: 23.5, w: 19, d: 12, z: 2.6, r: 1.5 }],
        text: 'شريحة بتحوّل الـUSB لسيريال، علشان الكمبيوتر يرفع الكود ويقرا الـSerial. نوعها بيختلف حسب اللوحة، وبعض الأجهزة محتاجة درايفر ليها.' },
      { id: 'usb', name: 'USB', hl: [{ x: 0, y: 56, w: 16, d: 12, z: 6.6, r: 1.5 }],
        text: 'منه الكهربا (5 فولت) ورفع الكود والسيريال. لازم الكابل يكون بيوصّل داتا، مش شحن بس.' },
      { id: 'gpio', name: 'GPIO', hl: [{ x: -25.5, y: 13, w: 9, d: 95, z: 9.6, r: 2 }, { x: 25.5, y: 13, w: 9, d: 95, z: 9.6, r: 2 }],
        text: 'الأطراف اللي على الجنبين. شغالة على 3.3 فولت ومش بتستحمل 5 فولت مباشرة. فيها ADC وPWM وI2C وSPI وUART، وGPIO34 لـ39 دخل بس.' }
    ],
    uno: [
      { id: 'mcu', name: 'ATmega328P', hl: [{ x: 28, y: 18, w: 60, d: 17, z: 6.6, r: 2 }],
        text: 'المتحكم: 8 بت على 16 ميجاهرتز، فيه 32 كيلوبايت فلاش و2 كيلوبايت RAM. الكود بتاعكم بيتنفّذ هنا.' },
      { id: 'l13', name: 'LED L (pin 13)', hl: [{ x: -31.5, y: -30.5, w: 12, d: 11, z: 2.6, r: 2 }],
        text: 'لمبة متوصلة على الطرف 13، واسمها في الكود LED_BUILTIN. أسهل طريقة تتأكدوا بيها إن الكود اترفع: blink.' },
      { id: 'txrx', name: 'TX / RX', hl: [{ x: -25, y: -22.5, w: 20, d: 7, z: 2.6, r: 2 }],
        text: 'لمبتين بينوّروا لما فيه داتا رايحة أو جاية على السيريال، يعني وقت رفع الكود أو Serial.print.' },
      { id: 'reset', name: 'RESET', hl: [{ x: -40, y: -44, w: 11, d: 11, z: 6.6, r: 2 }],
        text: 'زرار بيعيد تشغيل الكود من الأول من غير ما يمسحه.' },
      { id: 'usb', name: 'USB-B', hl: [{ x: -62, y: -26, w: 30, d: 26, z: 20.6, r: 2 }],
        text: 'الكهربا ورفع الكود والسيريال. الكارت الأصلي فيه شريحة ATmega16U2 بتحوّل USB لسيريال، وكتير من النسخ التانية فيها CH340.' },
      { id: 'jack', name: 'DC jack', hl: [{ x: -62, y: 32, w: 28, d: 20, z: 20.6, r: 2 }],
        text: 'فيشة كهربا علشان الكارت يشتغل من غير كمبيوتر. المنصوح بيه من 7 لـ 12 فولت.' },
      { id: 'digital', name: 'D0–D13', hl: [{ x: 22, y: -47, w: 82, d: 11, z: 11.6, r: 2 }],
        text: '14 طرف دخل وخرج على 5 فولت، منهم 6 بيطلّعوا PWM (3 و5 و6 و9 و10 و11). D0 وD1 هما السيريال، فبلاش توصّلوا عليهم حاجة وانتو بترفعوا الكود.' },
      { id: 'analog', name: 'A0–A5 + Power', hl: [{ x: 28, y: 47, w: 68, d: 11, z: 11.6, r: 2 }],
        text: 'ستة مداخل أنالوج A0 لـ A5 (دقة 10 بت)، وجنبهم أطراف الكهربا: 5V و3.3V وGND وVIN.' }
    ],
    bb: [
      { id: 'rails', name: '+ / −', hl: [{ x: 0, y: -45, w: 164, d: 13, z: 5.6, r: 2 }, { x: 0, y: 45, w: 164, d: 13, z: 5.6, r: 2 }],
        text: 'خطوط الكهربا على الطرفين: الأحمر للموجب والأزرق للسالب، وكل صف متوصل بطوله. في بعض البريدبوردات الطويلة الصف بيبقى مقسوم نصين، فاتأكدوا بالملتيميتر.' },
      { id: 'strips', name: 'a–e / f–j', hl: [{ x: 0, y: -18, w: 162, d: 32, z: 5.6, r: 2 }, { x: 0, y: 18, w: 162, d: 32, z: 5.6, r: 2 }],
        text: 'كل عمود من 5 خروم، من a لـ e أو من f لـ j، متوصلين ببعض من جوه. القطعتين اللي في نفس العمود متوصلين، واللي في عمود جنبه لأ.' },
      { id: 'gap', name: 'DIP gap', hl: [{ x: 0, y: 0, w: 166, d: 7, z: 5.6, r: 2 }],
        text: 'المجرى اللي في النص بيفصل النصين عن بعض. الشرايح IC بتتحط فوقه علشان كل رجل تاخد عمود لوحدها.' },
      { id: 'parts', name: 'R + LED', hl: [{ x: 4, y: -16, w: 56, d: 20, z: 8, r: 3 }],
        text: 'دايرة مثال: مقاومة ولمبة وأسلاك. المقاومة بتحدّ التيار علشان اللمبة ما تتحرقش. دوسوا على البريدبورد نفسه علشان الدايرة تتقفل.' }
    ],
    sr: [
      { id: 'vcc', name: 'VCC', hl: [{ x: -8, y: -16.5, w: 5, d: 5, z: 2, r: 1 }],
        text: 'الكهربا: 5 فولت.' },
      { id: 'trig', name: 'Trig', hl: [{ x: -2.7, y: -16.5, w: 5, d: 5, z: 2, r: 1 }],
        text: 'دخل: نبضة HIGH مدتها 10 ميكروثانية بتخلّي الحساس يبعت 8 نبضات صوت على 40 كيلوهرتز.' },
      { id: 'echo', name: 'Echo', hl: [{ x: 2.6, y: -16.5, w: 5, d: 5, z: 2, r: 1 }],
        text: 'خرج: بيفضل HIGH طول ما الصوت رايح وراجع. المسافة بالسنتيمتر تقريبًا = المدة بالميكروثانية ÷ 58. خرجه 5 فولت، فمع ESP32 استخدموا مقسّم جهد.' },
      { id: 'gnd', name: 'GND', hl: [{ x: 7.9, y: -16.5, w: 5, d: 5, z: 2, r: 1 }],
        text: 'الأرضي، ولازم يكون مشترك مع أرضي الكارت.' },
      { id: 'tr', name: 'T / R', hl: [{ x: -24, y: -1, w: 32, d: 32, z: 14.6, r: 16 }, { x: 24, y: -1, w: 32, d: 32, z: 14.6, r: 16 }],
        text: 'T بتبعت موجة فوق صوتية، وR بتستقبل الصدى. المدى العملي تقريبًا من 2 لـ 400 سم.' },
      { id: 'xtal', name: 'Crystal', hl: [{ x: 0, y: -11, w: 15, d: 8, z: 6, r: 2 }],
        text: 'كريستالة بتدّي الدايرة اللي على الكارت توقيت ثابت.' }
    ]
  };
  DEVICES.forEach(function (d) {
    (PARTS[d.id] || []).forEach(function (p) {
      p.els = p.hl.map(function (h) {
        var sw = 2;
        var svg = '<svg viewBox="0 0 ' + h.w + ' ' + h.d + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="hl-r" x="' + sw / 2 + '" y="' + sw / 2 + '" width="' + (h.w - sw) + '" height="' + (h.d - sw) + '" rx="' + Math.min(h.r || 0, (h.w - sw) / 2) + '"/></svg>';
        return plane(d.root, 'hl', h.w, h.d, h.x, h.y, h.z, svg);
      });
    });
  });

  /* ---------- Lighting: shade each face by its normal against one light (screen space) ---------- */
  var L = (function () { var v = [0.3, -0.75, 0.6], n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; })();
  var NORMALS = { t: [0, 0, 1], b: [0, 0, -1], n: [0, 1, 0], f: [0, -1, 0], r: [1, 0, 0], l: [-1, 0, 0] };
  var RAD = Math.PI / 180;
  function shade(d) {
    var cy = Math.cos(d.yaw * RAD), sy = Math.sin(d.yaw * RAD), cp = Math.cos(d.pitch * RAD), sp = Math.sin(d.pitch * RAD);
    var ct = Math.cos(TILT * RAD), stt = Math.sin(TILT * RAD);
    FACES.forEach(function (f) {
      var n = NORMALS[f];
      // rotateZ(yaw)
      var x = n[0] * cy - n[1] * sy, y = n[0] * sy + n[1] * cy, z = n[2];
      // rotateX(pitch)
      var y2 = y * cp - z * sp, z2 = y * sp + z * cp;
      // rotateX(tilt) of the bench
      var y3 = y2 * ct - z2 * stt, z3 = y2 * stt + z2 * ct;
      var lit = Math.max(0, x * L[0] + y3 * L[1] + z3 * L[2]);
      d.root.style.setProperty('--s-' + f, (0.62 - lit * 0.6).toFixed(2));
    });
  }

  /* ---------- Placement and render ---------- */
  function radius(d) { return 0.5 * Math.max(d.w, d.d) * k; } // review fix: 0.42 let a moved Arduino sit on top of its neighbours
  function place(d) {
    var r = radius(d);
    var mx = 0.5 - r / FW, my = 0.5 - r / FD;
    d.fx = clamp(d.fx, -Math.max(0, mx), Math.max(0, mx));
    d.fy = clamp(d.fy, -Math.max(0, my), Math.max(0, my));
  }
  function separate(d) {
    // push the moved device out of the others (circles; a few passes are enough for four devices)
    for (var pass = 0; pass < 3; pass++) {
      DEVICES.forEach(function (o) {
        if (o === d) return;
        var dx = (d.fx - o.fx) * FW, dy = (d.fy - o.fy) * FD, dist = Math.hypot(dx, dy) || 0.01;
        var need = radius(d) + radius(o);
        if (dist < need) { var p = (need - dist) / dist; d.fx += dx * p / FW; d.fy += dy * p / FD; }
      });
      place(d);
    }
  }
  function render(d) {
    var x = d.fx * FW, y = d.fy * FD;
    var sp = Math.abs(Math.sin(d.pitch * RAD)), cp = Math.abs(Math.cos(d.pitch * RAD));
    var lift = (sp * d.d / 2 + cp * d.h / 2) * k + (d.held ? 10 * k : 0);
    d.root.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + lift.toFixed(1) + 'px) rotateX(' + d.pitch.toFixed(1) + 'deg) rotateZ(' + d.yaw.toFixed(1) + 'deg)';
    var sx = 1, sy2 = cp + sp * (d.h / d.d) + 0.08;
    var fade = clamp(1 - (lift / k - d.h / 2) / 90, 0.35, 1);
    d.shadow.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + (y + lift * 0.35).toFixed(1) + 'px,0.5px) rotateZ(' + d.yaw.toFixed(1) + 'deg) scale(' + sx + ',' + sy2.toFixed(2) + ')';
    d.shadow.style.opacity = fade.toFixed(2);
    shade(d);
  }
  function renderAll() { DEVICES.forEach(function (d) { place(d); render(d); }); }

  /* ---------- Animation loop: runs only while something moves ---------- */
  var looping = false, last = 0, visible = false, touched = false;
  function idleOn() { return CFG.idle.spin && !touched && visible && smooth() && spinSpeed > 0; }
  function busy() {
    if (idleOn()) return true;
    return DEVICES.some(function (d) { return d.tw || d.held || Math.abs(d.vy) > 0.002 || Math.abs(d.vp) > 0.002; });
  }
  function kick() { if (!looping) { looping = true; last = 0; window.requestAnimationFrame(tick); } }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function tick(t) {
    var dt = last ? Math.min(64, t - last) : 16;
    last = t;
    DEVICES.forEach(function (d) {
      var moved = false;
      if (d.tw) {
        var p = clamp((t - d.tw.t0) / d.tw.ms, 0, 1), e = ease(p);
        d.yaw = d.tw.y0 + (d.tw.y1 - d.tw.y0) * e;
        d.pitch = d.tw.p0 + (d.tw.p1 - d.tw.p0) * e;
        if (d.tw.f) { d.fx = d.tw.f.x0 + (d.tw.f.x1 - d.tw.f.x0) * e; d.fy = d.tw.f.y0 + (d.tw.f.y1 - d.tw.f.y0) * e; }
        moved = true;
        if (p >= 1) { var done = d.tw.done; d.tw = null; if (done) done(); }
      } else if (!d.held && (Math.abs(d.vy) > 0.002 || Math.abs(d.vp) > 0.002)) {
        if (!smooth()) { d.vy = d.vp = 0; }
        else {
          d.yaw += d.vy * dt; d.pitch += d.vp * dt;
          var f = Math.pow(0.94, dt / 16); d.vy *= f; d.vp *= f;
          moved = true;
        }
      }
      if (d === esp && idleOn()) { d.yaw -= spinSpeed * dt / 1000; moved = true; }
      if (moved) render(d);
    });
    if (busy()) window.requestAnimationFrame(tick); else looping = false;
  }
  function tweenTo(d, yaw, pitch, ms, f, done) {
    if (!smooth() || !ms) {
      d.yaw = yaw; d.pitch = pitch; if (f) { d.fx = f.x1; d.fy = f.y1; }
      d.tw = null; render(d); if (done) done(); return;
    }
    d.vy = d.vp = 0;
    d.tw = { t0: performance.now(), ms: ms, y0: d.yaw, y1: yaw, p0: d.pitch, p1: pitch, f: f, done: done };
    kick();
  }
  function resetDev(d, quiet) {
    var h = d.home;
    // shortest way back: unwrap the angles first
    d.yaw = h.yaw + (((d.yaw - h.yaw) % 360) + 540) % 360 - 180;
    d.pitch = h.pitch + (((d.pitch - h.pitch) % 360) + 540) % 360 - 180;
    tweenTo(d, h.yaw, h.pitch, 650, { x0: d.fx, x1: h.fx, y0: d.fy, y1: h.fy });
    if (!quiet) announce(d.name + ' رجع مكانه.');
  }

  /* ---------- Selection, modes, hints ---------- */
  var picks = lab.querySelectorAll('.dev-pick');
  var sel = esp;
  function byId(id) { for (var i = 0; i < DEVICES.length; i++) if (DEVICES[i].id === id) return DEVICES[i]; return null; }
  function select(d) {
    var changed = sel !== d || !partsShownFor;
    sel = d;
    DEVICES.forEach(function (o) { o.shadow.classList.toggle('is-sel', o === d); });
    Array.prototype.forEach.call(picks, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dev') === d.id ? 'true' : 'false'); });
    if (changed) renderParts(d);
  }

  /* ---------- Components panel ---------- */
  var partsList = $('parts-list'), partsDev = $('parts-dev'), partInfo = $('part-info'), partName = $('part-name'), partText = $('part-text');
  var partsShownFor = null, partOn = null;
  function lightPart(p) {
    DEVICES.forEach(function (d) { (PARTS[d.id] || []).forEach(function (q) { q.els.forEach(function (e) { e.classList.toggle('on', q === p); }); }); });
  }
  function showPart(d, p) {
    partOn = p;
    lightPart(p);
    if (partsList) Array.prototype.forEach.call(partsList.querySelectorAll('.part-btn'), function (b) { b.setAttribute('aria-pressed', p && b.getAttribute('data-part') === p.id ? 'true' : 'false'); });
    if (!partInfo) return;
    partInfo.hidden = !p;
    if (p) { partName.textContent = p.name; partText.textContent = p.text; }
  }
  function renderParts(d) {
    partsShownFor = d;
    if (!partsList) return;
    if (partsDev) partsDev.textContent = d.name;
    while (partsList.firstChild) partsList.removeChild(partsList.firstChild);
    (PARTS[d.id] || []).forEach(function (p) {
      var li = el('li', '', partsList);
      var b = el('button', 'part-btn', li);
      b.type = 'button';
      b.setAttribute('data-part', p.id);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('dir', 'ltr');
      b.textContent = p.name;
      b.addEventListener('click', function () {
        touched = true;
        showPart(d, partOn === p ? null : p);
        kick();
      });
    });
    showPart(d, null);
  }
  var srBox = $('lab-sr'), srTimer = null;
  function announce(t) {
    if (!srBox) return;
    window.clearTimeout(srTimer);
    srTimer = window.setTimeout(function () { srBox.textContent = t; }, 350);
  }
  var moveMode = false;
  var btnRot = $('mode-rotate'), btnMove = $('mode-move'), btnCtl = $('lab-control'), btnReset = $('lab-reset');
  function setMode(m) {
    moveMode = m;
    if (btnRot) btnRot.setAttribute('aria-pressed', m ? 'false' : 'true');
    if (btnMove) btnMove.setAttribute('aria-pressed', m ? 'true' : 'false');
    bench.classList.toggle('mode-move', m);
  }
  if (btnRot) btnRot.addEventListener('click', function () { setMode(false); });
  if (btnMove) btnMove.addEventListener('click', function () { setMode(true); });
  if (btnReset) btnReset.addEventListener('click', function () { DEVICES.forEach(function (d) { d.vy = d.vp = 0; resetDev(d, true); }); announce('كل الأجهزة رجعت مكانها.'); });
  // Touch: full control (any direction, moving) only after "تحكّم"; otherwise sideways swipes rotate and vertical swipes scroll the page.
  var ctl = false;
  function setCtl(on) {
    ctl = on;
    bench.classList.toggle('ctl', on);
    if (btnCtl) btnCtl.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (btnCtl && coarse) { btnCtl.hidden = false; btnCtl.addEventListener('click', function () { setCtl(!ctl); }); }
  var hintFine = $('lab-hint-fine'), hintTouch = $('lab-hint-touch');
  if (hintFine) hintFine.hidden = coarse;
  if (hintTouch) hintTouch.hidden = !coarse;

  /* ---------- Pointer: rotate / move / tap ---------- */
  var drag = null;
  bench.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    var t = e.target && e.target.closest ? e.target.closest('.dev') : null;
    if (!t) return;
    var d = byId(t.getAttribute('data-dev'));
    if (!d) return;
    touched = true;
    select(d);
    d.tw = null; d.vy = d.vp = 0;
    var isTouch = e.pointerType !== 'mouse' && e.pointerType !== 'pen';
    drag = { d: d, id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: e.timeStamp, dist: 0,
      move: moveMode || e.shiftKey, limited: isTouch && !ctl, vy: 0, vp: 0 };
    d.held = drag.move;
    try { bench.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    bench.classList.add('dragging');
    if (drag.move) render(d);
    kick();
  });
  bench.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, e.timeStamp - drag.t);
    drag.x = e.clientX; drag.y = e.clientY; drag.t = e.timeStamp;
    drag.dist += Math.abs(dx) + Math.abs(dy);
    var d = drag.d;
    if (drag.move && !drag.limited) {
      d.fx += dx / FW;
      d.fy += dy / (FD * Math.cos(TILT * RAD));
      separate(d);
    } else {
      var ay = -dx * dragSpeed, ap = drag.limited ? 0 : -dy * dragSpeed;
      d.yaw += ay; d.pitch += ap;
      drag.vy = 0.6 * drag.vy + 0.4 * (ay / dt);
      drag.vp = 0.6 * drag.vp + 0.4 * (ap / dt);
    }
    render(d);
  });
  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag.d, tap = !cancelled && drag.dist < 6;
    d.held = false;
    if (!tap && !drag.move && CFG.rotation.inertia && smooth() && e && e.timeStamp - drag.t < 80) {
      d.vy = clamp(drag.vy, -1.2, 1.2); d.vp = clamp(drag.vp, -1.2, 1.2);
    }
    bench.classList.remove('dragging');
    render(d);
    drag = null;
    kick();
    if (!tap) return;
    // a mouse double-click means "reset", so a single click waits a moment before acting
    if (e.pointerType === 'mouse') { window.clearTimeout(tapTimer); tapTimer = window.setTimeout(function () { action(d); }, 260); }
    else action(d);
  }
  var tapTimer = null;
  bench.addEventListener('pointerup', function (e) { endDrag(e, false); });
  bench.addEventListener('pointercancel', function (e) { endDrag(e, true); });
  bench.addEventListener('lostpointercapture', function (e) { if (drag && e.pointerId === drag.id) endDrag(e, true); });
  bench.addEventListener('dblclick', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.dev') : null;
    var d = t ? byId(t.getAttribute('data-dev')) : null;
    window.clearTimeout(tapTimer);
    if (d) resetDev(d);
  });
  bench.addEventListener('dragstart', function (e) { e.preventDefault(); });

  /* ---------- Keyboard: on the device buttons ---------- */
  Array.prototype.forEach.call(picks, function (b) {
    var d = byId(b.getAttribute('data-dev'));
    if (!d) return;
    b.addEventListener('click', function () { touched = true; select(d); });
    b.addEventListener('keydown', function (e) {
      var key = e.key;
      if (key === 'Enter' && d === esp) { e.preventDefault(); touched = true; select(d); action(d); return; }
      var map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!map[key]) return;
      e.preventDefault();
      touched = true; select(d);
      d.tw = null; d.vy = d.vp = 0;
      var v = map[key];
      if (e.shiftKey) {
        d.fx += v[0] * 0.05; d.fy += v[1] * 0.06; separate(d); render(d);
        announce(d.name + ' اتحرك.');
      } else {
        d.yaw -= v[0] * keyStep; d.pitch -= v[1] * keyStep; render(d);
        announce(d.name + ' اتلف.');
      }
    });
  });

  /* ---------- Serial monitor ---------- */
  var serial = $('serial');
  var maxLines = num(CFG.serial.maxLines, 60, 5, 400);
  function out(text, kind) {
    if (!serial) return;
    var li = el('li', 'sl sl-' + (kind || 'out'), serial);
    li.textContent = str(text);
    while (serial.children.length > maxLines) serial.removeChild(serial.firstChild);
    serial.scrollTop = serial.scrollHeight;
  }
  var baudEl = $('serial-baud');
  if (baudEl) baudEl.textContent = String(num(CFG.serial.baud, 115200, 300, 2000000));
  if (!cfgOk) out('esp-behavior.js مش موجود أو فيه خطأ: المعمل شغال بالإعدادات الافتراضية.', 'err');

  /* ---------- ESP32 state ---------- */
  var LED_COLORS = {};
  (function () { var c = CFG.led.colors || {}; for (var n in c) if (Object.prototype.hasOwnProperty.call(c, n)) LED_COLORS[n.toLowerCase()] = hex(c[n], '#3DF58C'); })();
  if (!Object.keys(LED_COLORS).length) LED_COLORS = { green: '#3DF58C' };
  var W_STATES = ['disconnected', 'connecting', 'connected'];
  var wifiState = 'disconnected', ledOn = false, ledColor = 'green';
  var stateEl = $('esp-state');
  function setLed(on) {
    ledOn = !!on;
    esp.root.setAttribute('data-led', ledOn ? 'on' : 'off');
  }
  function setColor(name) {
    name = String(name || '').toLowerCase();
    if (!LED_COLORS[name]) return false;
    ledColor = name;
    esp.root.style.setProperty('--led-c', LED_COLORS[name]);
    return true;
  }
  function setWifi(s) {
    if (W_STATES.indexOf(s) === -1) s = 'disconnected';
    wifiState = s;
    esp.root.setAttribute('data-wifi', s);
    esp.root.style.setProperty('--wifi-c', hex((CFG.wifi.colors || {})[s], DEF.wifi.colors[s]));
    if (stateEl) {
      stateEl.textContent = str((CFG.wifi.labels || {})[s] || DEF.wifi.labels[s]);
      stateEl.setAttribute('data-s', s);
    }
  }
  setColor(CFG.led.startColor) || setColor(Object.keys(LED_COLORS)[0]);
  setLed(!!CFG.led.startOn);
  setWifi(CFG.wifi.startState === 'connected' ? 'connected' : 'disconnected');

  /* ---------- Program runner (owner sequences and visitor code share it) ----------
     A program is a list of { op, arg, arg2, ms, line }. One program runs at a time; a new one stops the old. */
  var MAX_STEPS = 120, MAX_TOTAL_MS = 20000;
  var runId = 0, timers = [];
  function later(fn, ms) { var id = window.setTimeout(fn, ms); timers.push(id); return id; }
  var runCb = null, runFailed = false; // the visitor run waiting for its result (stage 1)
  function stopAll() {
    runId++; timers.forEach(window.clearTimeout); timers = [];
    // fix: a run stopped while Wi-Fi was "connecting" left the label stuck on WL_IDLE…
    if (wifiState === 'connecting') setWifi('disconnected');
    if (runCb) { var cb = runCb; runCb = null; cb(false); }
  }
  function fromSequence(name, depth, outList, errs) {
    var seq = (CFG.sequences || {})[name];
    if (!Array.isArray(seq)) { errs.push('مفيش sequence اسمه «' + str(name) + '» في esp-behavior.js'); return; }
    if (depth > 4) { errs.push('sequences جوه بعض أكتر من 4 مرات'); return; }
    seq.forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var ms = num(s.ms, 0, 0, 5000);
      if ('run' in s) { fromSequence(String(s.run), depth + 1, outList, errs); if (ms) outList.push({ op: 'wait', arg: ms }); return; }
      var op = ['led', 'color', 'blink', 'wifi', 'say', 'rotate', 'wait'].filter(function (o) { return o in s; })[0];
      if (!op) { errs.push('خطوة مش معروفة في «' + str(name) + '»'); return; }
      var st2 = { op: op, arg: s[op], ms: ms };
      if (op === 'blink') { st2.arg = num(s.blink, 2, 1, 20); st2.arg2 = blinkMs; }
      outList.push(st2);
    });
  }
  function stepTime(s) {
    if (s.op === 'wait') return num(s.arg, 0, 0, 5000);
    if (s.op === 'blink') return 2 * s.arg2 * s.arg;
    if (s.op === 'rotate') return smooth() ? 700 : 0;
    if (s.op === 'wifi' && s.arg === 'connect') return num(CFG.wifi.connectMs, 1600, 0, 10000);
    return 0;
  }
  function run(list, label, cb) {
    stopAll();
    var my = runId;
    if (list.length > MAX_STEPS) { out('البرنامج أطول من ' + MAX_STEPS + ' خطوة. قصّروه شوية.', 'err'); if (cb) cb(false); return; }
    var total = list.reduce(function (a, s) { return a + stepTime(s) + (s.ms || 0); }, 0);
    if (total > MAX_TOTAL_MS) { out('البرنامج هياخد أكتر من ' + (MAX_TOTAL_MS / 1000) + ' ثانية. قلّلوا الـdelay أو عدد التغميز.', 'err'); if (cb) cb(false); return; }
    if (label) out(label, 'sys');
    runCb = cb || null; runFailed = false;
    var i = 0;
    function next() {
      if (my !== runId) return;
      if (i >= list.length) {
        if (label) out(msg('done'), 'ok');
        setRunning(false);
        var c = runCb; runCb = null; if (c) c(!runFailed);
        return;
      }
      var s = list[i++];
      exec(s, function () { if (my !== runId) return; later(next, s.ms || 0); }, my);
    }
    setRunning(true);
    next();
  }
  function exec(s, done, my) {
    switch (s.op) {
      case 'led': {
        var v = String(s.arg).toLowerCase();
        setLed(v === 'toggle' ? !ledOn : v === 'on');
        out(msg(ledOn ? 'ledOn' : 'ledOff'));
        return done();
      }
      case 'color':
        if (setColor(s.arg)) out(msg('color', { color: String(s.arg).toLowerCase() }));
        else { out('لون مش معروف: ' + str(s.arg), 'err'); runFailed = true; }
        return done();
      case 'blink': {
        var n = s.arg, ms = s.arg2, c = 0;
        var flip = function () {
          if (my !== runId) return;
          setLed(c % 2 === 0);
          c++;
          if (c < n * 2) later(flip, ms); else { setLed(false); later(done, ms); }
        };
        out('blink(' + ms + ', ' + n + ')', 'sys');
        return flip();
      }
      case 'wifi':
        if (String(s.arg) === 'connect') {
          if (wifiState === 'connected') { out(msg('connected', { ssid: str(CFG.wifi.ssid) })); return done(); }
          setWifi('connecting');
          out(msg('connecting', { ssid: str(CFG.wifi.ssid) }), 'sys');
          later(function () { if (my !== runId) return; setWifi('connected'); out(msg('connected', { ssid: str(CFG.wifi.ssid) }), 'ok'); done(); }, num(CFG.wifi.connectMs, 1600, 0, 10000));
          return;
        }
        setWifi('disconnected');
        out(msg('disconnected'), 'err');
        return done();
      case 'say':
        out(str(s.arg));
        return done();
      case 'rotate': {
        var deg = num(s.arg, 0, -720, 720);
        touched = true;
        esp.tw = null; esp.vy = esp.vp = 0;
        tweenTo(esp, esp.yaw - deg, esp.pitch, 700, null, function () { if (my === runId) done(); });
        return;
      }
      case 'wait':
        return later(done, num(s.arg, 0, 0, 5000));
      default:
        return done();
    }
  }
  function runSequence(name, label) {
    var list = [], errs = [];
    fromSequence(name, 0, list, errs);
    errs.forEach(function (m) { out(m, 'err'); });
    if (!errs.length) run(list, label);
  }

  /* ---------- Taps on devices ---------- */
  function speak() { if (serial) serial.setAttribute('aria-live', 'polite'); } // quiet until the visitor does something
  function action(d) {
    speak();
    if (d === esp) {
      var name = str(CFG.onClick);
      if (name) runSequence(name, '> ' + name + '()');
      return;
    }
    d.root.classList.toggle('is-on');
    var on = d.root.classList.contains('is-on');
    if (d.id === 'uno') out('Arduino Uno: digitalWrite(13, ' + (on ? 'HIGH' : 'LOW') + ')', on ? 'ok' : 'sys');
    if (d.id === 'bb') out('بريدبورد: الدايرة ' + (on ? 'اتقفلت واللمبة نوّرت' : 'اتفتحت'), on ? 'ok' : 'sys');
    if (d.id === 'sr') out('HC-SR04: ' + (on ? 'بيبعت نبضة ويستنى الصدى' : 'وقف'), on ? 'ok' : 'sys');
  }

  /* ---------- Visitor code box: a tiny, safe command language ---------- */
  var codeEl = $('esp-code'), gutter = $('esp-gutter'), runBtn = $('esp-run'), stopBtn = $('esp-stop'), resetCode = $('esp-reset-code');
  var SAMPLE = codeEl ? codeEl.value : '';
  function setRunning(on) {
    if (runBtn) runBtn.setAttribute('data-running', on ? 'true' : 'false');
    if (stopBtn) stopBtn.disabled = !on;
  }
  function stripComment(line) {
    var q = null;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '«') { q = '»'; continue; }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }
  // the bridge keeps 200 bytes a line: "PRINT " + the text must fit (Arabic is 2 bytes a letter, symbols like ★ are 3)
  var SAY_MAX_BYTES = 180;
  function utf8Len(t) {
    try { return new TextEncoder().encode(t).length; } catch (e) { return unescape(encodeURIComponent(t)).length; }
  }
  function parse(src) {
    var lines = String(src).split(/\r?\n/), prog = [], errs = [];
    if (lines.length > 80) errs.push({ line: 81, text: 'الكود أطول من 80 سطر.' });
    lines.slice(0, 80).forEach(function (raw, idx) {
      var n = idx + 1;
      var s = stripComment(raw).trim().replace(/;\s*$/, '').trim();
      if (!s) return;
      var m;
      if ((m = /^led\s*\(\s*(on|off|toggle)\s*\)$/i.exec(s))) prog.push({ op: 'led', arg: m[1].toLowerCase(), line: n });
      else if (/^led\s*\(/i.test(s)) errs.push({ line: n, text: 'led() بتاخد on أو off بس. مثال: led(on)' });
      else if ((m = /^blink\s*\(\s*(\d{1,5})\s*(?:,\s*(\d{1,3})\s*)?\)$/i.exec(s))) {
        var ms = parseInt(m[1], 10), times = m[2] ? parseInt(m[2], 10) : 1;
        if (ms < BLINK_MIN) { out('سطر ' + n + ': blink أسرع من ' + BLINK_MIN + ' اتظبط على ' + BLINK_MIN + ' علشان الأمان.', 'sys'); ms = BLINK_MIN; }
        if (ms > 3000) ms = 3000;
        if (times < 1 || times > 20) { errs.push({ line: n, text: 'عدد مرات التغميز من 1 لـ 20.' }); return; }
        prog.push({ op: 'blink', arg: times, arg2: ms, line: n });
      }
      else if (/^blink\s*\(/i.test(s)) errs.push({ line: n, text: 'blink(المدة, العدد). مثال: blink(400, 3)' });
      else if ((m = /^color\s*\(\s*["'«]?\s*([a-z]+)\s*["'»]?\s*\)$/i.exec(s))) {
        if (LED_COLORS[m[1].toLowerCase()]) prog.push({ op: 'color', arg: m[1].toLowerCase(), line: n });
        else errs.push({ line: n, text: 'الألوان المتاحة: ' + Object.keys(LED_COLORS).join(' أو ') });
      }
      else if (/^color\s*\(/i.test(s)) errs.push({ line: n, text: 'color(اسم اللون). مثال: color(green)' });
      else if (/^wifi\s*\.\s*connect\s*\(\s*\)$/i.test(s)) prog.push({ op: 'wifi', arg: 'connect', line: n });
      else if (/^wifi\s*\.\s*disconnect\s*\(\s*\)$/i.test(s)) prog.push({ op: 'wifi', arg: 'disconnect', line: n });
      else if ((m = /^rotate\s*\(\s*(-?\d{1,4})\s*\)$/i.exec(s))) {
        var deg = parseInt(m[1], 10);
        if (Math.abs(deg) > 720) errs.push({ line: n, text: 'rotate من -720 لـ 720 درجة.' });
        else prog.push({ op: 'rotate', arg: deg, line: n });
      }
      else if (/^rotate\s*\(/i.test(s)) errs.push({ line: n, text: 'rotate(عدد الدرجات). مثال: rotate(90)' });
      else if ((m = /^say\s*\(\s*(?:"([^"]*)"|'([^']*)'|«([^»]*)»)\s*\)$/i.exec(s))) {
        var t = m[1] != null ? m[1] : m[2] != null ? m[2] : m[3];
        if (t.length > 80) errs.push({ line: n, text: 'say() لحد 80 حرف.' });
        else if (utf8Len(t) > SAY_MAX_BYTES) errs.push({ line: n, text: 'النص ده طويل على الجهاز (بعض الرموز بتاخد مساحة أكبر من الحروف). قصّروه شوية.' });
        else prog.push({ op: 'say', arg: t, line: n });
      }
      else if (/^say\s*\(/i.test(s)) errs.push({ line: n, text: 'النص بين علامتين. مثال: say("أهلًا")' });
      else if ((m = /^delay\s*\(\s*(\d{1,6})\s*\)$/i.exec(s))) {
        var dl = parseInt(m[1], 10);
        if (dl > 5000) errs.push({ line: n, text: 'delay لحد 5000 (5 ثواني).' });
        else prog.push({ op: 'wait', arg: dl, line: n });
      }
      else if (/^delay\s*\(/i.test(s)) errs.push({ line: n, text: 'delay(مللي ثانية). مثال: delay(500)' });
      else if ((m = /^run\s*\(\s*["']?([A-Za-z0-9_\-]{1,40})["']?\s*\)$/.exec(s))) {
        var sub = [], se = [];
        fromSequence(m[1], 1, sub, se);
        if (se.length) errs.push({ line: n, text: se[0] });
        else Array.prototype.push.apply(prog, sub);
      }
      else errs.push({ line: n, text: 'مش فاهم «' + s.slice(0, 30) + '». الأوامر المتاحة تحت المحرر.' });
    });
    return { prog: prog, errs: errs };
  }
  function syncGutter() {
    if (!codeEl || !gutter) return;
    var n = Math.max(1, codeEl.value.split('\n').length), s = '';
    for (var i = 1; i <= n; i++) s += i + '\n';
    gutter.textContent = s;
    gutter.scrollTop = codeEl.scrollTop;
  }
  if (codeEl) {
    codeEl.addEventListener('input', syncGutter);
    codeEl.addEventListener('scroll', function () { if (gutter) gutter.scrollTop = codeEl.scrollTop; });
    syncGutter();
  }
  /* ---------- Run flow: stage 1 on the virtual parts, stage 2 on the visitor's board (only after a clean stage 1) ---------- */
  var step1 = $('rstep-1'), step1T = $('rstep-1-t'), step2 = $('rstep-2'), step2T = $('rstep-2-t'), runReal = $('run-real'), autoReal = $('auto-real');
  var lastGood = null;   // { prog, src } of the last stage-1 run that finished with zero errors
  var lastRun = { s1: 'idle', errs: 0, s2: 'none', sent: 0, skipped: 0 };
  function setStep(li, tEl, s, text) {
    if (li) li.setAttribute('data-s', s);
    if (tEl) tEl.textContent = text;
  }
  function plural(n) { return n === 1 ? 'خطأ واحد' : n === 2 ? 'خطأين' : n >= 3 && n <= 10 ? n + ' أخطاء' : n + ' خطأ'; }
  function cmdsN(n) { return n === 1 ? 'أمر واحد' : n === 2 ? 'أمرين' : n >= 3 && n <= 10 ? n + ' أوامر' : n + ' أمر'; }
  if (runBtn && codeEl) runBtn.addEventListener('click', function () {
    touched = true;
    speak();
    abortReal();
    lastGood = null;
    var r = parse(codeEl.value);
    if (r.errs.length) {
      stopAll(); setRunning(false);
      r.errs.forEach(function (e2) { out('سطر ' + e2.line + ': ' + e2.text, 'err'); });
      out('الكود فيه ' + plural(r.errs.length) + '. صلّحوه وجرّبوا تاني.', 'err');
      lastRun = { s1: 'fail', errs: r.errs.length, s2: 'none', sent: 0, skipped: 0 };
      setStep(step1, step1T, 'fail', 'فيه ' + plural(r.errs.length) + '. صلّحوه الأول.');
      updateStep2();
      return;
    }
    if (!r.prog.length) {
      out('مفيش أوامر. اكتبوا سطر زي led(on)', 'sys');
      lastRun = { s1: 'idle', errs: 0, s2: 'none', sent: 0, skipped: 0 };
      setStep(step1, step1T, 'idle', 'مفيش أوامر لسه.');
      updateStep2();
      return;
    }
    var src = codeEl.value;
    lastRun = { s1: 'run', errs: 0, s2: 'none', sent: 0, skipped: 0 };
    setStep(step1, step1T, 'run', 'شغال على المكونات الوهمية…');
    updateStep2();
    run(r.prog, '> upload sketch.ino', function (ok) {
      if (ok && codeEl.value === src) {
        lastGood = { prog: r.prog, src: src };
        lastRun.s1 = 'pass';
        setStep(step1, step1T, 'pass', 'نجح من غير أخطاء.');
        updateStep2();
        if (autoReal && autoReal.checked && hw.open) sendToBoard();
      } else {
        lastRun.s1 = ok ? 'idle' : 'stop';
        setStep(step1, step1T, ok ? 'idle' : 'stop', ok ? 'الكود اتغيّر. شغّلوه تاني.' : 'اتوقف قبل ما يخلص.');
        updateStep2();
      }
    });
  });
  if (stopBtn) stopBtn.addEventListener('click', function () {
    var wasReal = real.busy;
    stopAll(); abortReal(); setRunning(false); setLed(false); out('اتوقف.', 'sys');
    if (wasReal) out('بطّلنا نبعت للجهاز. الأمر اللي كان شغال عليه هيكمّل لحد ما يخلص.', 'sys');
  });
  if (resetCode && codeEl) resetCode.addEventListener('click', function () { codeEl.value = SAMPLE; syncGutter(); codeChanged(); codeEl.focus(); });
  function codeChanged() {
    if (!lastGood && lastRun.s1 !== 'pass') return;
    lastGood = null;
    abortReal();
    lastRun.s1 = 'idle';
    setStep(step1, step1T, 'idle', 'الكود اتغيّر. شغّلوه على المكونات الوهمية الأول.');
    updateStep2();
  }
  if (codeEl) codeEl.addEventListener('input', codeChanged);
  setRunning(false);

  /* ---------- The visitor's real board over Web Serial (Chrome / Edge on a computer) ----------
     The browser never uploads firmware: the board needs beedak-lab-bridge.ino once, then we send plain text lines
     ("LED ON", "BLINK 400 3", ...) and wait for an "ok" / "err" line back for each. */
  var serialApi = null;
  try { if (window.isSecureContext !== false && navigator.serial && typeof navigator.serial.requestPort === 'function') serialApi = navigator.serial; } catch (e) { serialApi = null; }
  var hwChip = $('hw-chip'), hwBtn = $('hw-connect'), hwBaud = $('hw-baud'), hwNote = $('hw-unsupported'), hwCtl = $('hw-controls');
  var hw = { port: null, open: false, reader: null, name: '', ids: '', baud: 115200, known: null, closing: false };
  var real = { busy: false, id: 0, waiters: [] };
  var VENDORS = { 0x303A: 'Espressif (ESP32)', 0x10C4: 'Silicon Labs CP210x', 0x1A86: 'WCH CH340', 0x0403: 'FTDI', 0x2341: 'Arduino', 0x2A03: 'Arduino' };
  var PRODUCTS = { '2341:0043': 'Arduino Uno R3', '2341:0001': 'Arduino Uno', '10C4:EA60': 'Silicon Labs CP2102 / CP2104', '1A86:7523': 'WCH CH340', '1A86:55D4': 'WCH CH9102', '0403:6001': 'FTDI FT232R' };
  function hex4(n) { return ('0000' + Number(n).toString(16).toUpperCase()).slice(-4); }
  function portName(port) {
    var i = {};
    try { i = port.getInfo() || {}; } catch (e) { i = {}; }
    var v = i.usbVendorId, p = i.usbProductId;
    if (v == null) return { name: 'جهاز سيريال', ids: '' };
    var key = hex4(v) + ':' + (p != null ? hex4(p) : '----');
    return { name: PRODUCTS[key] || VENDORS[v] || 'جهاز USB', ids: 'USB ' + key };
  }
  function chip(s, text) { if (hwChip) { hwChip.setAttribute('data-s', s); hwChip.textContent = text; } }
  function hwButton() {
    if (!hwBtn) return;
    hwBtn.textContent = hw.open ? 'افصلوا الجهاز' : hw.known ? 'افتحوا الجهاز' : 'وصّلوا جهازكم';
    hwBtn.setAttribute('aria-pressed', hw.open ? 'true' : 'false');
  }
  function lineIn(text) {
    var t = String(text).replace(/\s+$/, '');
    if (!t) return;
    out('USB ‹ ' + t, 'dev');
    // only "ok <VERB> ..." / "err <VERB> ..." for the command we are waiting on counts as its reply.
    // PRINT text comes back as "> ...", and late replies to an older command (after stop or a timeout) are ignored.
    var w = real.waiters[0];
    if (!w) return;
    var m = /^(ok|err)\s+(\S+)(?:\s+(\S+))?/i.exec(t);
    if (!m) return;
    var verb = m[2].toUpperCase();
    var mine = verb === w.verb && (w.token == null || m[3] === w.token);
    var generic = /^err$/i.test(m[1]) && (verb === 'UNKNOWN' || verb === 'TOOLONG');
    if (!mine && !generic) return;
    real.waiters.shift();
    window.clearTimeout(w.timer);
    w.resolve(t);
  }
  function readLoop(port) {
    if (!port.readable) return;
    var reader = port.readable.getReader();
    hw.reader = reader;
    var dec = new TextDecoder(), buf = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return null;
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split(/\r?\n/);
        buf = parts.pop();
        if (buf.length > 400) { parts.push(buf); buf = ''; }
        parts.forEach(lineIn);
        return pump();
      });
    }
    pump().then(function () { return false; }, function () { return true; }).then(function (failed) {
      if (hw.reader === reader) { try { reader.releaseLock(); } catch (e) { /* already released */ } hw.reader = null; }
      if (hw.port !== port || !hw.open || hw.closing) return;
      // a framing / break / overrun error only ends this stream: the port stays open with a new readable
      if (failed && port.readable && (hw.readErrs = (hw.readErrs || 0) + 1) <= 5) { readLoop(port); return; }
      lost(port);
    });
  }
  function openPort(port) {
    var baud = parseInt(hwBaud && hwBaud.value, 10) || 115200;
    chip('busy', 'بيفتح البورت…');
    if (hwBtn) hwBtn.disabled = true;
    return port.open({ baudRate: baud }).then(function () {
      var n = portName(port);
      hw.port = port; hw.open = true; hw.known = port; hw.name = n.name; hw.ids = n.ids; hw.baud = baud; hw.readErrs = 0;
      try { port.addEventListener('disconnect', function () { lost(port); }); } catch (e) { /* older API */ }
      chip('on', n.name + (n.ids ? ' · ' + n.ids : '') + ' · ' + baud);
      speak();
      out('جهازكم اتوصل: ' + n.name + (n.ids ? ' (' + n.ids + ')' : '') + ' على ' + baud + '.', 'ok');
      readLoop(port);
    }).catch(function () {
      if (hw.known === port) hw.known = null;
      chip('err', 'البورت ما اتفتحش');
      speak();
      out('ما قدرناش نفتح البورت. لو Arduino IDE أو أي برنامج تاني فاتحه، اقفلوه وجرّبوا تاني.', 'err');
    }).then(function () { if (hwBtn) hwBtn.disabled = false; hwButton(); updateStep2(); });
  }
  function closePort(quiet) {
    var port = hw.port;
    if (!port) return Promise.resolve();
    hw.closing = true;
    abortReal();
    var reader = hw.reader;
    var p = reader ? reader.cancel().catch(function () {}) : Promise.resolve();
    return p.then(function () {
      if (reader) { try { reader.releaseLock(); } catch (e) { /* released */ } if (hw.reader === reader) hw.reader = null; }
      return port.close();
    }).catch(function () { /* already gone */ }).then(function () {
      hw.closing = false; hw.open = false; hw.port = null;
      if (!quiet) hw.known = null; // the next click shows the browser's device picker again
      chip('off', 'مفيش جهاز متوصّل');
      if (!quiet) out('فصلنا الجهاز.', 'sys');
      hwButton(); updateStep2();
    });
  }
  function lost(port) {
    if (hw.port !== port || !hw.open) return;
    hw.open = false; hw.port = null; hw.reader = null;
    if (hw.known === port) hw.known = null;
    abortReal();
    // close it too, so a later open() of the same port does not fail with "already open"
    try { Promise.resolve(port.close()).catch(function () { /* already gone */ }); } catch (e) { /* already gone */ }
    chip('err', 'الجهاز اتفصل');
    speak();
    out('الجهاز اتفصل من الـUSB.', 'err');
    hwButton(); updateStep2();
  }
  function write(line) {
    if (!hw.port || !hw.port.writable) return Promise.reject(new Error('closed'));
    var w = hw.port.writable.getWriter();
    out('USB › ' + line, 'tx');
    return w.write(new TextEncoder().encode(line + '\n')).then(function () { w.releaseLock(); }, function (e) { try { w.releaseLock(); } catch (x) { /* released */ } throw e; });
  }
  function ask(line, ms, token) {
    return new Promise(function (resolve, reject) {
      var w = { resolve: resolve, reject: reject, timer: 0, verb: String(line).split(' ')[0].toUpperCase(), token: token == null ? null : String(token) };
      w.timer = window.setTimeout(function () {
        var i = real.waiters.indexOf(w);
        if (i !== -1) real.waiters.splice(i, 1);
        reject(new Error('timeout'));
      }, ms);
      real.waiters.push(w);
      write(line).catch(function (e) {
        var i = real.waiters.indexOf(w);
        if (i !== -1) real.waiters.splice(i, 1);
        window.clearTimeout(w.timer);
        reject(e);
      });
    });
  }
  function abortReal() {
    real.id++;
    real.waiters.splice(0).forEach(function (w) { window.clearTimeout(w.timer); w.reject(new Error('aborted')); });
    if (real.busy) { real.busy = false; lastRun.s2 = 'stop'; setRunning(false); updateStep2(); }
  }
  function toBridge(prog) {
    var lines = [], skipped = [];
    prog.forEach(function (s) {
      if (s.op === 'led') lines.push({ cmd: 'LED ' + String(s.arg).toUpperCase(), ms: 0 });
      else if (s.op === 'blink') lines.push({ cmd: 'BLINK ' + s.arg2 + ' ' + s.arg, ms: 2 * s.arg2 * s.arg });
      else if (s.op === 'wait') lines.push({ cmd: 'DELAY ' + num(s.arg, 0, 0, 5000), ms: num(s.arg, 0, 0, 5000) });
      else if (s.op === 'say') lines.push({ cmd: 'PRINT ' + str(s.arg).replace(/[\r\n]+/g, ' '), ms: 0 });
      else if (s.op === 'color') lines.push({ cmd: 'COLOR ' + String(s.arg).toLowerCase(), ms: 0 });
      else if (skipped.indexOf(s.op) === -1) skipped.push(s.op);
      if (s.ms) lines.push({ cmd: 'DELAY ' + num(s.ms, 0, 0, 5000), ms: num(s.ms, 0, 0, 5000) });
    });
    return { lines: lines, skipped: skipped };
  }
  function sendToBoard() {
    if (!lastGood || !hw.open || real.busy) return;
    var t = toBridge(lastGood.prog);
    var my = ++real.id;
    real.busy = true;
    setRunning(true); // the stop button works while sending to the board too
    lastRun.s2 = 'run'; lastRun.sent = 0; lastRun.skipped = t.skipped.length;
    setStep(step2, step2T, 'run', 'بيتبعت لـ ' + hw.name + '…');
    if (runReal) runReal.hidden = true;
    speak();
    out('> الخطوة 2: على جهازكم (' + hw.name + ')', 'sys');
    if (t.skipped.length) out('مش هيتبعت للجهاز: ' + t.skipped.map(function (o) { return o === 'wait' ? 'delay' : o; }).join('، ') + ' (في المعمل بس).', 'sys');
    function alive() { return my === real.id; }
    function ping(n) {
      // the board often restarts when the port opens: give it a few tries.
      // each PING carries a fresh token; replies before its "ok PING <token>" are leftovers and get skipped
      var tok = 'b' + my + '-' + n;
      return ask('PING ' + tok, 1500, tok).catch(function (e) {
        if (!alive() || n <= 1 || (e && e.message !== 'timeout')) throw e;
        return ping(n - 1);
      });
    }
    var i = 0;
    function next() {
      if (!alive()) throw new Error('aborted');
      if (i >= t.lines.length) return null;
      var l = t.lines[i++];
      return ask(l.cmd, l.ms + 2500).then(function (reply) {
        if (/^err/i.test(reply)) { var e = new Error('board'); e.reply = reply; throw e; }
        lastRun.sent++;
        return next();
      });
    }
    ping(3).then(function () { return next(); }).then(function () {
      if (!alive()) return;
      real.busy = false;
      setRunning(false);
      lastRun.s2 = 'pass';
      setStep(step2, step2T, 'pass', 'الجهاز نفّذ ' + cmdsN(lastRun.sent) + ' من غير أخطاء.');
      out('الجهاز خلّص.', 'ok');
      updateStep2();
    }).catch(function (e) {
      if (!alive() || (e && e.message === 'aborted')) return;
      real.busy = false;
      setRunning(false);
      lastRun.s2 = 'fail';
      var why = e && e.message === 'timeout'
        ? (lastRun.sent ? 'الجهاز بطّل يرد.' : 'الجهاز ما ردّش. اتأكدوا إن آخر نسخة من كود الجسر متحمّلة عليه وإن السرعة 115200.')
        : e && e.message === 'board'
          ? (/^err\s+TOOLONG/i.test(e.reply) ? 'السطر كان أطول من اللي الجهاز يستحمله. قصّروا النص وجرّبوا تاني.'
            : /^err\s+UNKNOWN/i.test(e.reply) ? 'الجهاز ما فهمش الأمر. اتأكدوا إن آخر نسخة من كود الجسر متحمّلة عليه.'
            : 'الجهاز رد بخطأ: ' + str(e.reply))
          : 'ما قدرناش نبعت للجهاز.';
      setStep(step2, step2T, 'fail', why);
      out(why, 'err');
      updateStep2();
    });
  }
  function updateStep2() {
    if (real.busy) return;
    var ready = false, s = 'locked', text;
    if (!serialApi) text = 'التوصيل مش متاح في المتصفح ده.';
    else if (lastRun.s1 === 'fail') text = 'مش هيتبعت حاجة: الخطوة 1 فيها أخطاء.';
    else if (lastRun.s1 === 'run') text = 'بيستنى الخطوة 1 تخلص.';
    else if (!lastGood) text = 'بيستنى الخطوة 1 تنجح من غير أخطاء.';
    else if (!hw.open) { s = 'wait'; text = 'الخطوة 1 نجحت. وصّلوا جهازكم علشان تكمّلوا.'; }
    else if (lastRun.s2 === 'pass' || lastRun.s2 === 'fail') { s = lastRun.s2; ready = true; text = step2T ? step2T.textContent : ''; }
    else { s = 'ready'; ready = true; text = 'جاهز يتبعت لـ ' + hw.name + '.'; }
    setStep(step2, step2T, s, text);
    if (runReal) {
      runReal.hidden = !ready;
      runReal.lastChild.textContent = lastRun.s2 === 'pass' || lastRun.s2 === 'fail' ? 'ابعتوه تاني لجهازي' : 'شغّلوه على جهازي';
    }
  }
  if (runReal) runReal.addEventListener('click', function () { sendToBoard(); });

  if (!serialApi) {
    if (hwNote) hwNote.hidden = false;
    if (hwCtl) hwCtl.hidden = true;
    if (autoReal && autoReal.parentNode) autoReal.parentNode.hidden = true;
    chip('off', 'مش متاح هنا');
  } else {
    if (hwBtn) hwBtn.addEventListener('click', function () {
      if (hw.open) { closePort(false); return; }
      if (hw.known) { openPort(hw.known); return; }
      serialApi.requestPort().then(openPort, function () { /* picker closed without a choice */ });
    });
    if (hwBaud) hwBaud.addEventListener('change', function () {
      if (!hw.open) return;
      var port = hw.port;
      closePort(true).then(function () { openPort(port); });
    });
    try {
      serialApi.addEventListener('connect', function (e) {
        if (hw.open || !e || !e.target || e.target === serialApi) return;
        hw.known = e.target;
        chip('seen', 'اتوصل: ' + portName(e.target).name + '. دوسوا «افتحوا الجهاز».');
        hwButton();
      });
      serialApi.addEventListener('disconnect', function (e) {
        if (!e || !e.target) return;
        if (e.target === hw.port) lost(e.target);
        else if (e.target === hw.known && !hw.open) { hw.known = null; chip('off', 'مفيش جهاز متوصّل'); hwButton(); }
      });
    } catch (e) { /* events not supported */ }
    if (typeof serialApi.getPorts === 'function') serialApi.getPorts().then(function (ports) {
      if (hw.open || !ports || !ports.length) return;
      hw.known = ports[0];
      chip('seen', 'فيه جهاز اتسمح له قبل كده: ' + portName(ports[0]).name);
      hwButton();
    }, function () { /* not allowed */ });
    hwButton();
  }
  updateStep2();

  /* ---------- "More details" note: sent with a summary of the lab run on WhatsApp ----------
     Same number as BOOKING_NUMBER in app.js. Without JS the form itself opens wa.me with the note only. */
  var WA_NUMBER = '201068530159';
  var more = $('lab-more'), moreText = $('more-text'), moreSum = $('more-sum');
  if (moreSum && moreSum.parentNode) moreSum.parentNode.hidden = false;
  function labSummary() {
    var s1 = { idle: 'لسه ما اتشغلش', run: 'كان لسه شغال', pass: 'نجح من غير أخطاء', fail: 'فيه ' + plural(lastRun.errs), stop: 'اتوقف قبل ما يخلص' }[lastRun.s1] || 'لسه ما اتشغلش';
    var s2 = !hw.open && lastRun.s2 === 'none' ? 'مفيش جهاز متوصّل'
      : { none: 'ما اتبعتش', run: 'كان لسه بيتبعت', pass: 'نفّذ ' + cmdsN(lastRun.sent), fail: 'وقف بعد ' + cmdsN(lastRun.sent), stop: 'اتوقف' }[lastRun.s2];
    var code = codeEl ? codeEl.value.trim() : '';
    if (code.length > 700) code = code.slice(0, 700) + '\n…';
    return 'ملخص المعمل:\n' +
      '- الجهاز اللي اخترناه: ' + sel.name + '\n' +
      '- على المكونات الوهمية: ' + s1 + '\n' +
      '- جهازنا: ' + (hw.open ? hw.name + (hw.ids ? ' (' + hw.ids + ')' : '') : 'مش متوصّل') + '\n' +
      '- على جهازنا: ' + s2 +
      (code ? '\n- الكود:\n' + code : '');
  }
  function moreMessage() {
    var note = moreText ? moreText.value.trim() : '';
    var msgText = 'من المعمل\nتفاصيل تانية: ' + (note || '-');
    if (!moreSum || moreSum.checked) msgText += '\n\n' + labSummary();
    return msgText;
  }
  if (more) more.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(moreMessage());
    // a real link click (new tab, no opener) instead of window.open, which returns null with noopener
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  /* ---------- Visibility, motion changes, resize ---------- */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    (Array.isArray(CFG.serial.bootLines) ? CFG.serial.bootLines : []).slice(0, 10).forEach(function (l) { out(l, 'sys'); });
    if (CFG.autoRun) runSequence(str(CFG.autoRun));
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) { boot(); kick(); }
      else if (ctl) setCtl(false); // leaving the lab gives touch scrolling back
    }, { rootMargin: '0px 0px -10% 0px' }).observe(bench);
  } else { visible = true; boot(); }
  new MutationObserver(function () { if (!smooth()) DEVICES.forEach(function (d) { d.vy = d.vp = 0; }); kick(); }).observe(html, { attributes: true, attributeFilter: ['class'] });
  var rzT = null, lastW = bench.clientWidth;
  window.addEventListener('resize', function () {
    window.clearTimeout(rzT);
    rzT = window.setTimeout(function () { if (bench.clientWidth === lastW) return; lastW = bench.clientWidth; measure(); renderAll(); }, 120);
  });

  select(esp);
  setMode(false);
  renderAll();
  kick();

  // test handle (read-only numbers for tmp/ scripts)
  window.__lab = {
    get: function (id) { var d = byId(id); return d && { fx: +d.fx.toFixed(3), fy: +d.fy.toFixed(3), yaw: +d.yaw.toFixed(1), pitch: +d.pitch.toFixed(1) }; },
    state: function () { return { wifi: wifiState, led: ledOn, color: ledColor, sel: sel.id, mode: moveMode ? 'move' : 'rotate', ctl: ctl }; },
    run: function () { return { s1: lastRun.s1, s2: lastRun.s2, sent: lastRun.sent, good: !!lastGood, hw: hw.open, busy: real.busy, part: partOn ? partOn.id : null }; },
    message: function () { return moreMessage(); }
  };
})();
