/* بإيدك lab simulator: view3d.js (lab-sim-spec.md §1, §6.6, §11 "View3D note").
   The CSS-3D viewer extracted from the retired assets/js/lab.js: the same cuboid models (uno, esp32, breadboard, HC-SR04)
   and the same per-component explanations, shown one part at a time in a <dialog>. The breadboard model no longer draws
   the pre-wired demo plane, so the 3D view never shows parts the visitor didn't add.
   View3D.has(type) -> bool · View3D.open(type, opener) · View3D.close()
   Drag = rotate, arrow keys = rotate, Esc closes and focus returns to the opener. No animation loop: renders on input only.
   Uses the existing .bench/.floor/.dev/.cb/.fc styles of styles.css + lab-extra.css. DOM-only; nothing runs at load time. */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};

  var AR = {
    title: 'الشكل الـ3D',
    close: 'اقفلوا',
    hint: 'اسحبوا الموديل علشان تلفّوه، أو استخدموا الأسهم. دوسوا على أي جزء من تحت علشان يتعلّم عليه.', // NEW COPY
    parts: 'أجزاء القطعة',                                                                               // NEW COPY
    reset: 'رجّعوه زي ما كان'                                                                             // NEW COPY
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls, parent) { var e = root.document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  /* ---------- cuboid builder (from lab.js) ---------- */
  var FACES = ['t', 'b', 'n', 'f', 'r', 'l'];
  function box(parent, cls, w, d, h, x, y, z) {
    var b = el('div', 'cb ' + cls, parent);
    b.style.setProperty('--w', w); b.style.setProperty('--d', d); b.style.setProperty('--h', h);
    b.style.transform = 'translate3d(calc(var(--k) * ' + (x || 0) + 'px), calc(var(--k) * ' + (y || 0) + 'px), calc(var(--k) * ' + (z || 0) + 'px))';
    FACES.forEach(function (f) { el('div', 'fc fc-' + f, b); });
    return b;
  }
  function top(b, svg) { b.querySelector('.fc-t').innerHTML = svg; return b; }   // static markup only
  function plane(parent, cls, w, d, x, y, z, svg) {
    var p = el('div', 'lpl ' + cls, parent);
    p.style.setProperty('--w', w); p.style.setProperty('--d', d);
    p.style.transform = 'translate3d(calc(var(--k) * ' + x + 'px), calc(var(--k) * ' + y + 'px), calc(var(--k) * ' + z + 'px))';
    p.innerHTML = svg;
    return p;
  }
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

  /* ---------- top-face drawings (from lab.js, decorative) ---------- */
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
    '<rect width="34" height="36" fill="url(#v3d-metal)"/><text x="17" y="15" class="sh-tx" text-anchor="middle">ESP32-WROOM</text>' +
    '<text x="17" y="22" class="sh-tx sh-sm" text-anchor="middle">Wi-Fi + BT</text><circle cx="5" cy="30" r="1.4" fill="#8A97A6"/></svg>';
  var SVG_UNO = '<svg viewBox="0 0 140 106" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<path d="M3 1h128l6 6v92l-6 6H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Z" fill="#0A7C83" stroke="#08636A"/>' +
    '<circle cx="15" cy="6" r="3" fill="#06555B"/><circle cx="132" cy="18" r="3" fill="#06555B"/><circle cx="132" cy="96" r="3" fill="#06555B"/><circle cx="16" cy="99" r="3" fill="#06555B"/>' +
    '<text x="60" y="44" class="uno-tx uno-big">UNO</text><text x="60" y="54" class="uno-tx">ARDUINO</text>' +
    '<text x="38" y="20" class="uno-tx uno-sm">L</text><rect class="uno-l" x="36" y="22" width="5" height="3" rx="1"/>' +
    '<text x="110" y="34" class="uno-tx uno-sm">ON</text><rect x="110" y="36" width="5" height="3" rx="1" fill="#3DF58C"/>' +
    '<text x="38" y="32" class="uno-tx uno-sm">TX RX</text>' +
    '<path d="M70 66h40M70 72h40M74 80h30" stroke="#0FA3AC" stroke-width="1"/></svg>';
  var SVG_BB = '<svg viewBox="0 0 170 110" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<defs><pattern id="v3d-holes" width="6" height="6" patternUnits="userSpaceOnUse"><rect x="2" y="2" width="2.2" height="2.2" rx=".4" fill="#5E5A52"/></pattern></defs>' +
    '<rect x="0.5" y="0.5" width="169" height="109" rx="3" fill="#ECE7DB" stroke="#CFC8B8"/>' +
    '<path d="M6 5H164M6 105H164" stroke="#E0464F" stroke-width="1"/><path d="M6 15H164M6 95H164" stroke="#3D7BE0" stroke-width="1"/>' +
    '<rect x="6" y="7" width="158" height="6" fill="url(#v3d-holes)"/><rect x="6" y="97" width="158" height="6" fill="url(#v3d-holes)"/>' +
    '<rect x="6" y="22" width="158" height="30" fill="url(#v3d-holes)"/><rect x="6" y="58" width="158" height="30" fill="url(#v3d-holes)"/>' +
    '<rect x="4" y="52.5" width="162" height="5" fill="#D8D1C2"/></svg>';
  var SVG_SR04 = '<svg viewBox="0 0 90 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<rect x="0.5" y="0.5" width="89" height="39" rx="2" fill="#1C5BB8" stroke="#164A96"/>' +
    '<text x="45" y="35" class="sr-tx" text-anchor="middle">HC-SR04</text><text x="10" y="8" class="sr-tx">T</text><text x="77" y="8" class="sr-tx">R</text>' +
    pins(4, 37, 3.5, 5.3, 0, 1.2, 'sr-pin') +
    '<text x="37" y="9" class="sr-tx sr-pl" text-anchor="middle">VCC</text><text x="42.3" y="12" class="sr-tx sr-pl" text-anchor="middle">Trig</text>' +
    '<text x="47.6" y="9" class="sr-tx sr-pl" text-anchor="middle">Echo</text><text x="52.9" y="12" class="sr-tx sr-pl" text-anchor="middle">GND</text></svg>';
  var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="v3d-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E4E9EF"/><stop offset=".45" stop-color="#A9B4C0"/><stop offset=".55" stop-color="#C9D1DA"/><stop offset="1" stop-color="#8B96A3"/></linearGradient></defs></svg>';

  /* ---------- models: part type -> old lab.js device ---------- */
  var MODELS = {
    esp: { name: 'ESP32 DevKit V1', w: 60, d: 118, h: 4, yaw: -28,
      build: function (r) {
        top(box(r, 'pcb pcb-esp', 60, 118, 4, 0, 0, 0), SVG_ESP);
        top(box(r, 'metal', 34, 36, 4, 0, -14, 4), SVG_SHIELD);
        box(r, 'hdr', 6, 92, 7, -25.5, 13, 5.5);
        box(r, 'hdr', 6, 92, 7, 25.5, 13, 5.5);
        box(r, 'metal usb', 13, 9, 4, 0, 56, 4);
      } },
    uno: { name: 'Arduino Uno R3', w: 140, d: 106, h: 4, yaw: 14,
      build: function (r) {
        top(box(r, 'pcb pcb-uno', 140, 106, 4, 0, 0, 0), SVG_UNO);
        box(r, 'metal usbb', 26, 22, 18, -62, -26, 11);
        box(r, 'jack', 24, 16, 18, -62, 32, 11);
        box(r, 'hdr hdr-x', 78, 7, 9, 22, -47, 6.5);
        box(r, 'hdr hdr-x', 64, 7, 9, 28, 47, 6.5);
        box(r, 'ic-chip', 56, 13, 4, 28, 18, 4);
        box(r, 'rst-btn', 7, 7, 4, -40, -44, 4);
      } },
    bb: { name: 'Breadboard', w: 170, d: 110, h: 9, yaw: -6,
      build: function (r) { top(box(r, 'bboard', 170, 110, 9, 0, 0, 0), SVG_BB); } },   // §11: no pre-wired plane
    sr: { name: 'HC-SR04', w: 90, d: 40, h: 3, yaw: 20,
      build: function (r) {
        top(box(r, 'pcb pcb-sr', 90, 40, 3, 0, 0, 0), SVG_SR04);
        cylinder(r, 15, 12, -24, -1, 2);
        cylinder(r, 15, 12, 24, -1, 2);
        box(r, 'metal xtal', 12, 5, 4, 0, -11, 3.5);
      } }
  };
  var TYPE_MODEL = { uno: 'uno', esp32: 'esp', bb400: 'bb', bb830: 'bb', hcsr04: 'sr' };

  /* components of each model (texts from lab.js; the ESP32 LED line no longer mentions the retired command language) */
  var PARTS = {
    esp: [
      { id: 'module', name: 'ESP32-WROOM-32', hl: [{ x: 0, y: -14, w: 38, d: 40, z: 6.6, r: 2 }],
        text: 'الموديول المعدني: جواه معالج ESP32 بنواتين لحد 240 ميجاهرتز، وذاكرة فلاش (غالبًا 4 ميجابايت). ده العقل اللي بينفّذ الكود بتاعكم.' },
      { id: 'radio', name: 'Wi-Fi + Bluetooth', hl: [{ x: 0, y: -51, w: 40, d: 14, z: 2.6, r: 2 }],
        text: 'واي فاي 2.4 جيجاهرتز وبلوتوث Classic وBLE. الهوائي هو الخط المتعرّج في طرف الموديول، فبلاش تحطوا عليه معدن أو أسلاك.' },
      { id: 'led', name: 'LED (GPIO2)', hl: [{ x: 16, y: 25, w: 11, d: 11, z: 2.6, r: 5.5 }],
        text: 'أغلب لوحات DevKit عليها لمبة متوصلة على GPIO2، وفيه لوحات ما عليهاش غير لمبة الباور. بتنوّر لما تكتبوا digitalWrite(2, HIGH).' }, // NEW COPY (last sentence)
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
        text: 'المجرى اللي في النص بيفصل النصين عن بعض. الشرايح IC بتتحط فوقه علشان كل رجل تاخد عمود لوحدها.' }
    ],
    sr: [
      { id: 'vcc', name: 'VCC', hl: [{ x: -8, y: -16.5, w: 5, d: 5, z: 2, r: 1 }], text: 'الكهربا: 5 فولت.' },
      { id: 'trig', name: 'Trig', hl: [{ x: -2.7, y: -16.5, w: 5, d: 5, z: 2, r: 1 }],
        text: 'دخل: نبضة HIGH مدتها 10 ميكروثانية بتخلّي الحساس يبعت 8 نبضات صوت على 40 كيلوهرتز.' },
      { id: 'echo', name: 'Echo', hl: [{ x: 2.6, y: -16.5, w: 5, d: 5, z: 2, r: 1 }],
        text: 'خرج: بيفضل HIGH طول ما الصوت رايح وراجع. المسافة بالسنتيمتر تقريبًا = المدة بالميكروثانية ÷ 58. خرجه 5 فولت، فمع ESP32 استخدموا مقسّم جهد.' },
      { id: 'gnd', name: 'GND', hl: [{ x: 7.9, y: -16.5, w: 5, d: 5, z: 2, r: 1 }], text: 'الأرضي، ولازم يكون مشترك مع أرضي الكارت.' },
      { id: 'tr', name: 'T / R', hl: [{ x: -24, y: -1, w: 32, d: 32, z: 14.6, r: 16 }, { x: 24, y: -1, w: 32, d: 32, z: 14.6, r: 16 }],
        text: 'T بتبعت موجة فوق صوتية، وR بتستقبل الصدى. المدى العملي تقريبًا من 2 لـ 400 سم.' },
      { id: 'xtal', name: 'Crystal', hl: [{ x: 0, y: -11, w: 15, d: 8, z: 6, r: 2 }], text: 'كريستالة بتدّي الدايرة اللي على الكارت توقيت ثابت.' }
    ]
  };

  /* ---------- lighting (from lab.js) ---------- */
  var TILT = 56, RAD = Math.PI / 180;
  var L = (function () { var v = [0.3, -0.75, 0.6], n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; })();
  var NORMALS = { t: [0, 0, 1], b: [0, 0, -1], n: [0, 1, 0], f: [0, -1, 0], r: [1, 0, 0], l: [-1, 0, 0] };
  function shade(rootEl, yaw, pitch) {
    var cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD), cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD);
    var ct = Math.cos(TILT * RAD), stt = Math.sin(TILT * RAD);
    FACES.forEach(function (f) {
      var n = NORMALS[f];
      var x = n[0] * cy - n[1] * sy, y = n[0] * sy + n[1] * cy, z = n[2];
      var y2 = y * cp - z * sp, z2 = y * sp + z * cp;
      var y3 = y2 * ct - z2 * stt, z3 = y2 * stt + z2 * ct;
      var lit = Math.max(0, x * L[0] + y3 * L[1] + z3 * L[2]);
      rootEl.style.setProperty('--s-' + f, (0.62 - lit * 0.6).toFixed(2));
    });
  }

  /* ---------- the dialog ---------- */
  var dlg = null, cur = null, opener = null;
  function build() {
    var doc = root.document;
    dlg = el('dialog', 'sim-dialog sim-3d', doc.body);
    dlg.setAttribute('aria-labelledby', 'sim-3d-title');
    var head = el('div', 'sim-dialog-head', dlg);
    var h = el('h2', 'sim-dialog-title', head); h.id = 'sim-3d-title';
    var x = el('button', 'seg-btn sim-dialog-x', head); x.type = 'button'; x.textContent = AR.close;
    x.addEventListener('click', close);
    var bench = el('div', 'bench sim-3d-bench', dlg);
    bench.setAttribute('tabindex', '0'); bench.setAttribute('role', 'img');
    bench.insertAdjacentHTML('afterbegin', DEFS);
    var floor = el('div', 'floor', bench);
    var hint = el('p', 'sim-3d-hint', dlg); hint.textContent = AR.hint;
    var tools = el('div', 'sim-3d-tools', dlg);
    var rs = el('button', 'seg-btn', tools); rs.type = 'button'; rs.textContent = AR.reset;
    var listH = el('h3', 'sim-3d-h', dlg); listH.textContent = AR.parts;
    var list = el('ul', 'parts-list', dlg);
    var info = el('div', 'part-info', dlg); info.hidden = true; info.setAttribute('aria-live', 'polite');
    var iName = el('p', 'part-name', info), iText = el('p', 'part-text', info);
    dlg._ui = { title: h, bench: bench, floor: floor, list: list, info: info, iName: iName, iText: iText };
    dlg.addEventListener('close', function () {
      if (cur && cur.root && cur.root.parentNode) cur.root.parentNode.removeChild(cur.root);
      cur = null;
      if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* gone */ } }
      opener = null;
    });
    rs.addEventListener('click', function () { if (cur) { cur.yaw = cur.m.yaw; cur.pitch = 0; render(); } });
    // drag = rotate
    var drag = null;
    bench.addEventListener('pointerdown', function (e) {
      if (!cur || (e.button !== 0 && e.pointerType === 'mouse')) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { bench.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      bench.classList.add('dragging');
    });
    bench.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id || !cur) return;
      cur.yaw -= (e.clientX - drag.x) * 0.6; cur.pitch = clamp(cur.pitch - (e.clientY - drag.y) * 0.6, -170, 170);
      drag.x = e.clientX; drag.y = e.clientY; render();
    });
    function end() { drag = null; bench.classList.remove('dragging'); }
    bench.addEventListener('pointerup', end); bench.addEventListener('pointercancel', end);
    bench.addEventListener('keydown', function (e) {
      var map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!cur || !map[e.key]) return;
      e.preventDefault();
      cur.yaw -= map[e.key][0] * 15; cur.pitch = clamp(cur.pitch - map[e.key][1] * 15, -170, 170); render();
    });
  }
  function measure() {
    var u = dlg._ui, w = u.bench.clientWidth || 360, hgt = u.bench.clientHeight || 300, m = cur.m;
    var k = clamp(Math.min(w * 0.62 / m.w, hgt * 0.75 / m.d), 0.5, 3);
    u.bench.style.setProperty('--k', k.toFixed(3));
    var FW = Math.round(w * 0.86), FD = Math.round(hgt * 1.3);
    u.floor.style.width = FW + 'px'; u.floor.style.height = FD + 'px';
    u.floor.style.marginLeft = (-FW / 2) + 'px'; u.floor.style.marginTop = (-FD / 2) + 'px';
    cur.k = k;
  }
  function render() {
    if (!cur) return;
    var m = cur.m, sp = Math.abs(Math.sin(cur.pitch * RAD)), cp = Math.abs(Math.cos(cur.pitch * RAD));
    var lift = (sp * m.d / 2 + cp * m.h / 2) * cur.k;
    cur.root.style.transform = 'translate3d(0px,0px,' + lift.toFixed(1) + 'px) rotateX(' + cur.pitch.toFixed(1) + 'deg) rotateZ(' + cur.yaw.toFixed(1) + 'deg)';
    shade(cur.root, cur.yaw, cur.pitch);
  }
  function showPart(p) {
    var u = dlg._ui;
    cur.on = cur.on === p ? null : p;
    (PARTS[cur.key] || []).forEach(function (q) { (q.els || []).forEach(function (e) { e.classList.toggle('on', q === cur.on); }); });
    Array.prototype.forEach.call(u.list.querySelectorAll('.part-btn'), function (b) { b.setAttribute('aria-pressed', cur.on && b.getAttribute('data-part') === cur.on.id ? 'true' : 'false'); });
    u.info.hidden = !cur.on;
    if (cur.on) { u.iName.textContent = cur.on.name; u.iText.textContent = cur.on.text; }
  }

  function has(type) { return !!TYPE_MODEL[type]; }
  function open(type, op) {
    var key = TYPE_MODEL[type]; if (!key) return false;
    if (!dlg) build();
    if (dlg.open) close();
    opener = op || null;
    var m = MODELS[key], u = dlg._ui;
    var def = NS.Parts && NS.Parts.get ? NS.Parts.get(type) : null;
    u.title.textContent = AR.title + ': ' + ((def && def.name_ar) || m.name);
    u.bench.setAttribute('aria-label', AR.title + ': ' + m.name);
    var r = el('div', 'dev dev-' + key, u.floor);
    m.build(r);
    cur = { key: key, m: m, root: r, yaw: m.yaw, pitch: 0, k: 1, on: null };
    while (u.list.firstChild) u.list.removeChild(u.list.firstChild);
    (PARTS[key] || []).forEach(function (p) {
      p.els = p.hl.map(function (h) {
        var sw = 2;
        var svg = '<svg viewBox="0 0 ' + h.w + ' ' + h.d + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="hl-r" x="' + sw / 2 + '" y="' + sw / 2 + '" width="' + (h.w - sw) + '" height="' + (h.d - sw) + '" rx="' + Math.min(h.r || 0, (h.w - sw) / 2) + '"/></svg>';
        return plane(r, 'hl', h.w, h.d, h.x, h.y, h.z, svg);
      });
      var li = el('li', '', u.list), b = el('button', 'part-btn', li);
      b.type = 'button'; b.setAttribute('data-part', p.id); b.setAttribute('aria-pressed', 'false'); b.setAttribute('dir', 'ltr');
      b.textContent = p.name;
      b.addEventListener('click', function () { showPart(p); });
    });
    u.info.hidden = true;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    measure(); render();
    try { u.bench.focus(); } catch (e) { /* ignore */ }
    return true;
  }
  function close() { if (dlg && dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); } }

  NS.View3D = { has: has, open: open, close: close, isOpen: function () { return !!(dlg && dlg.open); }, AR: AR };
})(typeof window !== 'undefined' ? window : globalThis);
