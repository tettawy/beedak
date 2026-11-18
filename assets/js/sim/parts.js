/* «بإيدك» lab simulator: board profiles + parts catalog + electrical models.
 * Owner: B2 (Electrical). Spec: design-system/beedak/pages/lab-sim-spec.md §3, §4, §6.2.
 *
 * Node-loadable: no DOM, no storage, no timers. Other modules are reached only at call time.
 * Units: geometry in u (0.1 inch), time in µs, volts, amps, ohms.
 * Anything marked "(model)" is a modelling choice, not a datasheet number.
 *
 * Model contract (§4.5), called by circuit.js:
 *   init(inst) -> state
 *   stamp(S, inst, st, ctx)          add elements; S.n(pinId) -> node, S.R/V/I/D/SW/drive, S.node() (internal node)
 *   decide(view, inst, st, nowUs)    (B2-internal) state that changes what is stamped (powered, relay coil…);
 *                                    returns true when it changed, so the circuit re-solves (max 6 passes)
 *   after(view, inst, st, dtUs, nowUs) -> { visual, conds }
 *   control(inst, st, key, value, nowUs), repair(inst, st)
 *   echo / dht / i2c / servoPulse / events / tick : protocol and timing hooks used by board-sim.js
 * `view` is the per-instance solution view built by circuit.js (v, vd, i, ipk, ms, wOver, floating, …).
 */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};

  /* ------------------------------------------------------------------ */
  /* 1. Board profiles (§3, verbatim)                                     */
  /* ------------------------------------------------------------------ */
  var PROFILES = {
    uno: {
      board: 'uno', name: 'Arduino Uno R3', mcu: 'ATmega328P', vcc: 5.0,
      intBits: 16, doubleBits: 32, sramBytes: 2048,
      adcBits: 10, adcRefV: 5.0,
      adcPins: [14, 15, 16, 17, 18, 19],
      adc2Pins: [],
      digitalPins: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19],
      analogOnlyPins: [],
      inputOnlyPins: [], noPullPins: [],
      hasPulldown: false,
      pwmPins: [3, 5, 6, 9, 10, 11], pwmHz: { 3: 490, 5: 980, 6: 980, 9: 490, 10: 490, 11: 490 }, pwmBits: 8,
      interruptPins: { 2: 0, 3: 1 },
      pullupOhm: 35000,
      pulldownOhm: 0,
      rOutOhm: 25,
      vil: 1.5, vih: 3.0,
      vMaxIn: 5.5,
      pinAbsMaxA: 0.040, pinRecA: 0.020,
      serialPins: [0, 1], i2c: { sda: 18, scl: 19 },
      ledBuiltin: 13,
      constants: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, LED_BUILTIN: 13, SDA: 18, SCL: 19 },
      pinIds: { 0:'D0',1:'D1',2:'D2',3:'D3',4:'D4',5:'D5',6:'D6',7:'D7',8:'D8',9:'D9',10:'D10',11:'D11',12:'D12',13:'D13',14:'A0',15:'A1',16:'A2',17:'A3',18:'A4',19:'A5' },
      libs: ['Arduino.h', 'Servo.h', 'Wire.h', 'LiquidCrystal_I2C.h', 'DHT.h'],
      hasPrintf: false, hasLedc: false, hasWiFi: false, hasDac: false,
      toneBreaksPwm: [3, 11], servoBreaksPwm: [9, 10],
      strappingPins: [],
      timeCost: { stmt: 0.5, call: 1.0, digitalWrite: 4, digitalRead: 4, pinMode: 4, analogRead: 112, analogWrite: 6 }
    },
    esp32: {
      board: 'esp32', name: 'ESP32 DevKit V1 (30 pin)', mcu: 'ESP32-WROOM-32', vcc: 3.3,
      intBits: 32, doubleBits: 64, sramBytes: 0,
      adcBits: 12, adcRefV: 3.3,
      adcPins: [36, 39, 32, 33, 34, 35, 4, 2, 15, 13, 12, 14, 27, 25, 26],
      adc2Pins: [4, 2, 15, 13, 12, 14, 27, 25, 26],
      digitalPins: [1,2,3,4,5,12,13,14,15,16,17,18,19,21,22,23,25,26,27,32,33,34,35,36,39],
      analogOnlyPins: [],
      inputOnlyPins: [34, 35, 36, 39], noPullPins: [34, 35, 36, 39],
      hasPulldown: true,
      pwmPins: 'output', pwmHz: 1000, pwmBits: 8,
      interruptPins: 'all',
      pullupOhm: 45000, pulldownOhm: 45000,
      rOutOhm: 25,
      vil: 0.825, vih: 2.475,
      vMaxIn: 3.6,
      pinAbsMaxA: 0.040, pinRecA: 0.020,
      serialPins: [1, 3], i2c: { sda: 21, scl: 22 },
      ledBuiltin: 2,
      constants: { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26,
                   LED_BUILTIN: 2, SDA: 21, SCL: 22, T0: 4, T2: 2, T3: 15, T4: 13, T5: 12, T6: 14, T7: 27, T8: 33, T9: 32, DAC1: 25, DAC2: 26 },
      pinIds: { 1:'TX0',2:'D2',3:'RX0',4:'D4',5:'D5',12:'D12',13:'D13',14:'D14',15:'D15',16:'RX2',17:'TX2',18:'D18',19:'D19',21:'D21',22:'D22',23:'D23',25:'D25',26:'D26',27:'D27',32:'D32',33:'D33',34:'D34',35:'D35',36:'VP',39:'VN' },
      libs: ['Arduino.h', 'ESP32Servo.h', 'Wire.h', 'LiquidCrystal_I2C.h', 'DHT.h', 'WiFi.h'],
      hasPrintf: true, hasLedc: true, hasWiFi: true, hasDac: true,
      toneBreaksPwm: [], servoBreaksPwm: [],
      strappingPins: [0, 2, 5, 12, 15],
      timeCost: { stmt: 0.05, call: 0.1, digitalWrite: 0.2, digitalRead: 0.2, pinMode: 1, analogRead: 10, analogWrite: 1 }
    }
  };
  // nano = uno except the listed fields (§3)
  (function () {
    var u = PROFILES.uno, n = JSON.parse(JSON.stringify(u));
    n.board = 'nano'; n.name = 'Arduino Nano (ATmega328P)';
    n.adcPins = [14, 15, 16, 17, 18, 19, 20, 21]; n.analogOnlyPins = [20, 21];
    n.constants = { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21, LED_BUILTIN: 13, SDA: 18, SCL: 19 };
    n.pinIds[20] = 'A6'; n.pinIds[21] = 'A7';
    PROFILES.nano = n;
  })();
  function deepFreeze(o) {
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); });
    return Object.freeze(o);
  }
  Object.keys(PROFILES).forEach(function (k) { deepFreeze(PROFILES[k]); });

  /* ------------------------------------------------------------------ */
  /* 2. Categories (§4.2)                                                 */
  /* ------------------------------------------------------------------ */
  var CATEGORIES = [
    { id: 'board', label_ar: 'الكروت' },
    { id: 'proto', label_ar: 'التوصيل' },
    { id: 'out', label_ar: 'لمبات وأصوات' },
    { id: 'in', label_ar: 'زراير ومقاومات' },
    { id: 'sensor', label_ar: 'حساسات' },
    { id: 'display', label_ar: 'شاشات' },
    { id: 'power', label_ar: 'حركة وكهربا' }
  ];

  /* ------------------------------------------------------------------ */
  /* 3. Electrical constants and helpers                                  */
  /* ------------------------------------------------------------------ */
  var VT = 0.02585;          // thermal voltage at ~27 °C
  var LED_N = 2.0, LED_RS = 10; // LED emission coefficient and series resistance (§4.5, binding)
  // Forward voltage at 20 mA (§4.4 led row, datasheet-typical)
  var LED_VF = { red: 2.0, yellow: 2.1, green: 2.2, blue: 3.1, white: 3.1 };

  /** Shockley parameters so that the terminal voltage at 20 mA equals vf (Vd = vf − 0.02·Rs). */
  function diodeParams(vf, rs) {
    rs = rs == null ? LED_RS : rs;
    var nVt = LED_N * VT;
    var vd = vf - 0.020 * rs;
    var is = 0.020 / (Math.exp(vd / nVt) - 1);
    return { Is: is, n: LED_N, Rs: rs, vf: vf };
  }
  var DP_CACHE = {};
  function dp(vf, rs) { var k = vf + ':' + (rs == null ? LED_RS : rs); return DP_CACHE[k] || (DP_CACHE[k] = diodeParams(vf, rs)); }

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function ledB(iAvg) { return iAvg >= 5e-5 ? Math.min(1, Math.sqrt(iAvg / 0.020)) : 0; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  // mulberry32: small seeded PRNG (bounce timing)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ------------------------------------------------------------------ */
  /* 4. Geometry helpers (§2.1)                                           */
  /* ------------------------------------------------------------------ */
  function rotPt(x, y, rot) {
    switch (((rot || 0) % 360 + 360) % 360) {
      case 90: return { x: -y, y: x };
      case 180: return { x: -x, y: -y };
      case 270: return { x: y, y: -x };
      default: return { x: x, y: y };
    }
  }
  function unrotPt(x, y, rot) { return rotPt(x, y, (360 - (((rot || 0) % 360 + 360) % 360)) % 360); }
  function r6(x) { return Math.round(x * 1e6) / 1e6; }

  /* ------------------------------------------------------------------ */
  /* 5. Shared model pieces                                               */
  /* ------------------------------------------------------------------ */
  function ctlDefaults(def) {
    var o = {};
    (def.controls || []).forEach(function (c) {
      if (c.default !== undefined) o[c.key] = c.default;
      else if (c.type === 'momentary' || c.type === 'toggle' || c.type === 'button') o[c.key] = false;
    });
    return o;
  }
  function propOf(inst, def, key) {
    var p = inst.props || {};
    if (p[key] !== undefined && p[key] !== null) return p[key];
    var pd = (def.props || []).filter(function (x) { return x.key === key; })[0];
    return pd ? pd.default : undefined;
  }
  /** Supply voltage of a module (VCC − GND); a floating side counts as 0 V. */
  function supplyV(view, vcc, gnd) {
    var a = view.v(vcc), b = view.v(gnd);
    if (isNaN(a) || isNaN(b)) return 0;
    return a - b;
  }
  /** Common power decision. o = { min, max, vcc:'VCC', gnd:'GND' }. Sets st.powered/st.vcc/st.damaged. */
  function decidePower(view, inst, st, o) {
    var V = supplyV(view, o.vcc || 'VCC', o.gnd || 'GND');
    st.vcc = V;
    if (!st.damaged && V < -0.5) { st.damaged = true; }
    var p = !st.damaged && V >= o.min && V <= (o.max || 1e9);
    if (p !== st.powered) { st.powered = p; return true; }
    return false;
  }
  /** Common module power conditions (§8.4 module power / reversed). */
  function powerConds(view, inst, st, o) {
    var out = [];
    if (st.damaged) { out.push({ code: 'E_REVERSED_POWER', refs: [inst.id], vars: { part: inst.id } }); return out; }
    var V = st.vcc || 0;
    if (V < 0.5) {
      if (view.power) out.push({ code: 'W_NO_POWER', refs: [inst.id], vars: { part: inst.id, vcc: o.label || '5V' } });
    } else if (V < (o.need || o.min)) {
      out.push({ code: o.lowCode || 'W_LOW_VCC', refs: [inst.id], vars: { part: inst.id, need: String(o.need || o.min), v: f2(V) } });
    }
    return out;
  }
  function repairDefault(inst, st) { st.burnt = false; st.damaged = false; st.o30 = 0; st.o60 = 0; st.revUs = 0; st._dirty = true; }

  /** LED-type burn accounting for one junction (§4.5): >30 mA for 200 ms cumulative, or >60 mA for 10 ms. */
  function burnStep(view, b, key, dtUs) {
    if (b.burnt || !(dtUs > 0)) return false;
    var w30 = view.wOver(key, 0.030), w60 = view.wOver(key, 0.060);
    if (w30 > 0) b.o30 = (b.o30 || 0) + dtUs * w30;
    if (w60 > 0) b.o60 = (b.o60 || 0) + dtUs * w60;
    if ((b.o30 || 0) >= 200000 || (b.o60 || 0) >= 10000) {
      b.burnt = true; b.burntMa = view.ipk(key) * 1000; return true;
    }
    return false;
  }

  /** Bounce scheduler shared by button and switch (§4.5). The contact chatters 2–5 extra times over 0.3–2 ms. */
  function scheduleContact(st, target, nowUs, openState) {
    var last = st.q.length ? st.q[st.q.length - 1].s : st.closed;
    if (last === target) return;                     // already there (or already bouncing toward it)
    st.q = [];
    if (!st.bounce) { if (st.closed !== target) { st.closed = target; st._dirty = true; } return; }
    var rnd = mulberry32((st.seed + (++st.nb) * 7919) | 0);
    var m = 2 + Math.floor(rnd() * 4);              // 2..5 extra toggles
    var span = 300 + rnd() * 1700;                   // 0.3..2 ms
    var ts = [];
    for (var i = 0; i < m; i++) ts.push(rnd() * span * 0.95 + 10);
    ts.sort(function (a, b) { return a - b; });
    st.closed = target; st._dirty = true;
    var s = target;
    for (var j = 0; j < ts.length; j++) {
      s = (s === target) ? openState : target;
      st.q.push({ tUs: nowUs + ts[j], s: s });
    }
    st.q.push({ tUs: nowUs + span, s: target });
  }
  function contactEvents(inst, st) { return st.q.length ? st.q[0].tUs : Infinity; }
  function contactTick(inst, st, nowUs) {
    var ch = false;
    while (st.q.length && st.q[0].tUs <= nowUs) {
      var e = st.q.shift();
      if (st.closed !== e.s) { st.closed = e.s; ch = true; }
    }
    return ch;
  }

  /* ------------------------------------------------------------------ */
  /* 6. Board pin tables (§4.4)                                           */
  /* ------------------------------------------------------------------ */
  var AR_PIN = { // NEW COPY: pin descriptions shown in the inspector «أطرافها»
    gnd: 'الأرضي (السالب). كل أطراف GND متوصلة ببعض جوّه الكارت.',
    uno5v: 'بيطلّع 5 فولت من الـUSB لتشغيل الحساسات والموديولات.',
    uno3v3: 'بيطلّع 3.3 فولت، بس أقصى تيار منه حوالي 50 مللي أمبير.',
    unoVin: 'دخل كهربا من الفيشة (7 لـ12 فولت). والكارت شغال من الـUSB الطرف ده ما بيطلّعش كهربا.',
    unoReset: 'لو اتوصل بالـGND الكارت بيعمل ريستارت والكود يبدأ من الأول.',
    ioref: 'بيعرّف الشيلد بفولت الكارت (5 فولت).',
    aref: 'مرجع خارجي للـanalogRead. مش متحاكي في المعمل.',
    nc: 'مش متوصّل بحاجة.',
    espEn: 'الريست (EN): لو اتوصل بالـGND الكارت بيقف لحد ما يتشال.',
    esp3v3: 'بيطلّع 3.3 فولت. ده فولت أطراف الـESP32 كلها.',
    espVin: 'فيه حوالي 4.7 فولت لما الكارت شغال من الـUSB (الـ5 فولت بعد دايود الحماية، تقريبًا في المحاكي).'
  };
  function unoPinAr(g) {
    if (g === 0) return 'طرف رقمي 0، وهو كمان RX بتاع السيريال (الـUSB).';
    if (g === 1) return 'طرف رقمي 1، وهو كمان TX بتاع السيريال (الـUSB).';
    if (g >= 14) {
      var s = 'طرف analog A' + (g - 14) + ': بيقرا فولت من 0 لـ5 (0 لـ1023)، وينفع يشتغل رقمي كمان.';
      if (g === 18) s += ' وهو SDA بتاع I2C.';
      if (g === 19) s += ' وهو SCL بتاع I2C.';
      if (g >= 20) s = 'طرف analog A' + (g - 14) + ': بيقرا analog بس، ما ينفعش رقمي.';
      return s;
    }
    var t = 'طرف رقمي ' + g + ' (دخل أو خرج).';
    if ([3, 5, 6, 9, 10, 11].indexOf(g) >= 0) t = 'طرف رقمي ' + g + '، وبيطلّع PWM (علامة ~) مع analogWrite.';
    if (g === 2 || g === 3) t += ' وبيشتغل interrupt.';
    if (g === 13) t += ' وعليه اللمبة L اللي على الكارت.';
    return t;
  }
  function espPinAr(g) {
    if ([34, 35, 36, 39].indexOf(g) >= 0) return 'GPIO' + g + ': دخل بس (Input only)، وبيقرا analog. مفيهوش pull-up داخلي.';
    if (g === 1) return 'GPIO1 = TX0 بتاع السيريال (الـUSB). سيبوه للسيريال.';
    if (g === 3) return 'GPIO3 = RX0 بتاع السيريال (الـUSB). سيبوه للسيريال.';
    var s = 'GPIO' + g + ': دخل أو خرج 3.3 فولت.';
    if (g === 2) s += ' وعليه اللمبة الزرقا اللي على الكارت.';
    if (g === 21) s += ' وهو SDA بتاع I2C.';
    if (g === 22) s += ' وهو SCL بتاع I2C.';
    if (g === 25 || g === 26) s += ' وفيه DAC (بيطلّع فولت حقيقي من 0 لـ3.3).';
    if (g === 12) s += ' من أطراف التشغيل: لو عليه HIGH وقت التشغيل الكارت ممكن ما يبدأش.';
    if (g === 5 || g === 15) s += ' من أطراف التشغيل (strapping).';
    if (PROFILES.esp32.adc2Pins.indexOf(g) >= 0) s += ' بيقرا analog على ADC2 (ما بيشتغلش والواي فاي شغال).';
    else if (g === 32 || g === 33) s += ' بيقرا analog (ADC1).';
    return s;
  }

  function unoPins(isUno) {
    var P = [];
    var top = [26.0, 25.0, 24.0, 23.0, 22.0, 21.0, 20.0, 19.0, 17.4, 16.4, 15.4, 14.4, 13.4, 12.4];
    var lab = ['0 RX', '1 TX', '2', '~3', '4', '~5', '~6', '7', '8', '~9', '~10', '~11', '12', '13'];
    for (var g = 0; g < 14; g++) P.push({ id: 'D' + g, label: lab[g], ar: unoPinAr(g), x: top[g], y: 1, role: 'gpio', gpio: g });
    P.push({ id: 'GND3', label: 'GND', ar: AR_PIN.gnd, x: 11.4, y: 1, role: 'gnd' });
    P.push({ id: 'AREF', label: 'AREF', ar: AR_PIN.aref, x: 10.4, y: 1, role: 'nc' });
    P.push({ id: 'SDA', label: 'SDA', ar: 'نفس طرف A4 (SDA بتاع I2C).', x: 9.4, y: 1, role: 'passive' });
    P.push({ id: 'SCL', label: 'SCL', ar: 'نفس طرف A5 (SCL بتاع I2C).', x: 8.4, y: 1, role: 'passive' });
    P.push({ id: 'NC', label: 'NC', ar: AR_PIN.nc, x: 11, y: 20, role: 'nc' });
    P.push({ id: 'IOREF', label: 'IOREF', ar: AR_PIN.ioref, x: 12, y: 20, role: 'power', volts: 5.0, rOhm: 10 });
    P.push({ id: 'RESET', label: 'RESET', ar: AR_PIN.unoReset, x: 13, y: 20, role: 'rst' });
    P.push({ id: '3V3', label: '3.3V', ar: AR_PIN.uno3v3, x: 14, y: 20, role: 'power', volts: 3.3, rOhm: 1, maxA: 0.050 });
    P.push({ id: '5V', label: '5V', ar: AR_PIN.uno5v, x: 15, y: 20, role: 'power', volts: 5.0, rOhm: 0.5, maxA: 0.5 });
    P.push({ id: 'GND1', label: 'GND', ar: AR_PIN.gnd, x: 16, y: 20, role: 'gnd' });
    P.push({ id: 'GND2', label: 'GND', ar: AR_PIN.gnd, x: 17, y: 20, role: 'gnd' });
    P.push({ id: 'VIN', label: 'VIN', ar: AR_PIN.unoVin, x: 18, y: 20, role: 'power', volts: 0, rOhm: 0, usbOff: true });
    for (var a = 0; a < 6; a++) P.push({ id: 'A' + a, label: 'A' + a, ar: unoPinAr(14 + a), x: 20 + a, y: 20, role: 'gpio', gpio: 14 + a, adc: true });
    return P;
  }

  function espPins() {
    var L = [['EN', 'EN', null], ['VP', 'VP · GPIO36', 36], ['VN', 'VN · GPIO39', 39], ['D34', 'D34', 34], ['D35', 'D35', 35], ['D32', 'D32', 32],
      ['D33', 'D33', 33], ['D25', 'D25 · DAC1', 25], ['D26', 'D26 · DAC2', 26], ['D27', 'D27', 27], ['D14', 'D14', 14], ['D12', 'D12', 12],
      ['D13', 'D13', 13], ['GND1', 'GND', null], ['VIN', 'VIN', null]];
    var R = [['D23', 'D23', 23], ['D22', 'D22 · SCL', 22], ['TX0', 'TX0 · GPIO1', 1], ['RX0', 'RX0 · GPIO3', 3], ['D21', 'D21 · SDA', 21], ['D19', 'D19', 19],
      ['D18', 'D18', 18], ['D5', 'D5', 5], ['TX2', 'TX2 · GPIO17', 17], ['RX2', 'RX2 · GPIO16', 16], ['D4', 'D4', 4], ['D2', 'D2 · LED', 2],
      ['D15', 'D15', 15], ['GND2', 'GND', null], ['3V3', '3V3', null]];
    var adc = PROFILES.esp32.adcPins;
    function mk(row, x, y) {
      var id = row[0], g = row[2];
      if (g !== null) { var p = { id: id, label: row[1], ar: espPinAr(g), x: x, y: y, role: 'gpio', gpio: g }; if (adc.indexOf(g) >= 0) p.adc = true; return p; }
      if (id === 'EN') return { id: id, label: 'EN', ar: AR_PIN.espEn, x: x, y: y, role: 'rst' };
      if (id === 'VIN') return { id: id, label: 'VIN', ar: AR_PIN.espVin, x: x, y: y, role: 'power', volts: 4.7, rOhm: 1, maxA: 0.5 };
      if (id === '3V3') return { id: id, label: '3V3', ar: AR_PIN.esp3v3, x: x, y: y, role: 'power', volts: 3.3, rOhm: 0.5, maxA: 0.5 };
      return { id: id, label: 'GND', ar: AR_PIN.gnd, x: x, y: y, role: 'gnd' };
    }
    var P = [];
    for (var i = 0; i < 15; i++) { P.push(mk(L[i], 1, 3 + i)); P.push(mk(R[i], 11, 3 + i)); }
    return P;
  }

  function nanoPins() {
    var top = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND1', 'RST1', 'D0', 'D1'];
    var bot = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST2', 'GND2', 'VIN'];
    function mk(id, x, y) {
      var m = /^D(\d+)$/.exec(id), a = /^A(\d)$/.exec(id);
      if (m) { var g = +m[1]; var lab = g === 0 ? 'D0 RX0' : g === 1 ? 'D1 TX1' : ([3, 5, 6, 9, 10, 11].indexOf(g) >= 0 ? '~D' + g : 'D' + g); return { id: id, label: lab, ar: unoPinAr(g), x: x, y: y, role: 'gpio', gpio: g }; }
      if (a) { var ga = 14 + (+a[1]); return { id: id, label: id, ar: unoPinAr(ga), x: x, y: y, role: 'gpio', gpio: ga, adc: true }; }
      if (id === '3V3') return { id: id, label: '3V3', ar: AR_PIN.uno3v3, x: x, y: y, role: 'power', volts: 3.3, rOhm: 1, maxA: 0.050 };
      if (id === '5V') return { id: id, label: '5V', ar: AR_PIN.uno5v, x: x, y: y, role: 'power', volts: 5.0, rOhm: 0.5, maxA: 0.5 };
      if (id === 'VIN') return { id: id, label: 'VIN', ar: AR_PIN.unoVin, x: x, y: y, role: 'power', volts: 0, rOhm: 0, usbOff: true };
      if (id === 'AREF') return { id: id, label: 'AREF', ar: AR_PIN.aref, x: x, y: y, role: 'nc' };
      if (/^RST/.test(id)) return { id: id, label: 'RST', ar: AR_PIN.unoReset, x: x, y: y, role: 'rst' };
      return { id: id, label: 'GND', ar: AR_PIN.gnd, x: x, y: y, role: 'gnd' };
    }
    var P = [];
    for (var i = 0; i < 15; i++) { P.push(mk(top[i], i, 0)); P.push(mk(bot[i], i, 6)); }
    return P;
  }

  /* ------------------------------------------------------------------ */
  /* 7. Breadboards (§4.4)                                                */
  /* ------------------------------------------------------------------ */
  var ROWS = 'abcdefghij';
  function railX(k) { return 3 + 6 * Math.floor((k - 1) / 5) + ((k - 1) % 5); }
  function bbPins(cols, rails) {
    var P = [];
    for (var c = 1; c <= cols; c++) {
      for (var r = 0; r < 10; r++) {
        var y = r < 5 ? 4 + r : 11 + (r - 5);
        P.push({ id: ROWS[r] + c, label: ROWS[r] + c, ar: '', x: c + 1, y: y, role: 'hole' });
      }
    }
    var RL = [['tn', 1, '−'], ['tp', 2, '+'], ['bp', 17, '+'], ['bn', 18, '−']];
    RL.forEach(function (rl) {
      for (var k = 1; k <= rails; k++) P.push({ id: rl[0] + k, label: rl[2] + ' ' + k, ar: '', x: railX(k), y: rl[1], role: 'hole', rail: rl[0] });
    });
    return P;
  }
  /** Internal strips of a breadboard instance (depends on the splitRails prop for bb830). */
  function bbGroups(inst, def) {
    var cols = def.bb.cols, rails = def.bb.rails, G = [], c, r;
    for (c = 1; c <= cols; c++) {
      var top = [], bot = [];
      for (r = 0; r < 5; r++) { top.push(ROWS[r] + c); bot.push(ROWS[5 + r] + c); }
      G.push(top, bot);
    }
    var split = def.type === 'bb830' && !!propOf(inst, def, 'splitRails');
    ['tn', 'tp', 'bp', 'bn'].forEach(function (rl) {
      if (split) {
        var a = [], b = [];
        for (var k = 1; k <= rails; k++) (k <= rails / 2 ? a : b).push(rl + k);
        G.push(a, b);
      } else {
        var g = [];
        for (var k2 = 1; k2 <= rails; k2++) g.push(rl + k2);
        G.push(g);
      }
    });
    return G;
  }

  /* ------------------------------------------------------------------ */
  /* 8. Models                                                            */
  /* ------------------------------------------------------------------ */
  var BOARD_SUPPLIES = {
    uno: [{ pin: '5V', v: 5.0, r: 0.5 }, { pin: '3V3', v: 3.3, r: 1 }, { pin: 'IOREF', v: 5.0, r: 10 }],
    nano: [{ pin: '5V', v: 5.0, r: 0.5 }, { pin: '3V3', v: 3.3, r: 1 }],
    esp32: [{ pin: '3V3', v: 3.3, r: 0.5 }, { pin: 'VIN', v: 4.7, r: 1 }]
  };
  var BOARD_RST = { uno: { pin: 'RESET', v: 5.0, th: 1.5 }, nano: { pin: 'RST1', v: 5.0, th: 1.5 }, esp32: { pin: 'EN', v: 3.3, th: 0.8 } };

  function boardModel(type) {
    var prof = PROFILES[type];
    return {
      init: function (inst) { return { ctl: { reset: false, routerOff: false }, usbOverUs: 0 }; },
      stamp: function (S, inst, st, ctx) {
        var gnd = S.n('GND1');
        if (type === 'esp32') {                                  // on-board blue LED on GPIO2 + 1 kΩ (model)
          var m = S.node();
          S.D(S.n('D2'), m, dp(3.1), 'ledBlue');
          S.R(m, gnd, 1000);
        }
        var d = ctx.drive;
        if (!d || !d.power) return;                             // USB unplugged / shorted: everything high-Z
        BOARD_SUPPLIES[type].forEach(function (s) { S.V(S.n(s.pin), gnd, s.v, s.r, 'sup:' + s.pin); });
        var rs = BOARD_RST[type];
        S.V(S.n(rs.pin), gnd, rs.v, 10000, 'rst');              // 10 kΩ pull-up on RESET / EN
        if (d.reset) return;                                    // held in reset: all GPIO high-Z
        var pins = d.pins || {};
        Object.keys(pins).forEach(function (gs) {
          var g = +gs, ps = pins[gs], pid = prof.pinIds[g];
          if (!pid || !ps) return;
          var n = S.n(pid);
          if (ps.dacV != null) { S.V(n, gnd, ps.dacV, 1, 'pin:' + g); return; }
          if (ps.mode === 1) {
            var lvl = ps.pwm ? (ctx.high && ctx.high[g] ? 1 : 0) : (ps.level ? 1 : 0);
            S.V(n, gnd, lvl ? prof.vcc : 0, prof.rOutOhm, 'pin:' + g);
          } else if (ps.mode === 2) {
            S.V(n, gnd, prof.vcc, prof.pullupOhm, 'pin:' + g);
          } else if (ps.mode === 3 && prof.pulldownOhm) {
            S.V(n, gnd, 0, prof.pulldownOhm, 'pin:' + g);
          }
        });
      },
      after: function (view, inst, st, dtUs) {
        var d = view.drive || { pins: {} }, pinsV = {}, conds = [];
        Object.keys(prof.pinIds).forEach(function (gs) {
          var g = +gs, pid = prof.pinIds[g], ps = (d.pins || {})[g] || { mode: 0, level: 0 };
          pinsV[pid] = { mode: ps.mode || 0, level: ps.level ? 1 : 0, pwm: ps.pwm ? ps.pwm.duty : null, v: view.v(pid) };
        });
        // USB budget: everything that leaves the board's supplies and pins
        var total = 0, i3 = 0;
        BOARD_SUPPLIES[type].forEach(function (s) {
          var I = -view.i('sup:' + s.pin);
          if (I > 0) total += I;
          if (s.pin === '3V3') i3 = I;
        });
        Object.keys(prof.pinIds).forEach(function (gs) { var I = -view.i('pin:' + gs); if (I > 0) total += I; });
        if (view.power && total > 0.5) st.usbOverUs += dtUs; else st.usbOverUs = 0;
        if (st.usbOverUs > 100000) conds.push({ code: 'W_USB_BUDGET', refs: [inst.id], vars: { mA: f1(total * 1000) } });
        if (view.power && type !== 'esp32' && i3 > 0.050) conds.push({ code: 'W_3V3_BUDGET', refs: [inst.id + '.3V3'], vars: { board: prof.name, mA: f1(i3 * 1000) } });
        var vis = { power: !!view.power, reset: !!d.reset, pins: pinsV };
        if (type === 'esp32') { vis.ledBlue = ledB(view.i('ledBlue')); vis.wifi = 'off'; }
        else { vis.ledL = view.power ? view.wVhigh('D13', 2.5) : 0; vis.ledTx = false; vis.ledRx = false; }
        return { visual: vis, conds: conds };
      },
      control: function (inst, st, key, value) { st.ctl[key] = !!value; },
      repair: function (inst, st) { st.usbOverUs = 0; }
    };
  }

  function bbModel() {
    return { init: function () { return { ctl: {} }; }, stamp: function () {}, after: function () { return { visual: {}, conds: [] }; } };
  }

  function ledModel(def) {
    return {
      init: function (inst) { return { ctl: {}, burnt: false, burntMa: 0, o30: 0, o60: 0, revUs: 0 }; },
      stamp: function (S, inst, st) {
        if (st.burnt) return;                                   // burnt LED = open circuit
        S.D(S.n('A'), S.n('K'), dp(LED_VF[propOf(inst, def, 'color')] || 2.0), 'd');
      },
      after: function (view, inst, st, dtUs) {
        var conds = [];
        if (burnStep(view, st, 'd', dtUs)) st._dirty = true;
        var I = st.burnt ? 0 : view.i('d');
        var vr = view.vd('K', 'A');
        var rev = !st.burnt && !isNaN(vr) && vr > 1.0;
        if (rev && view.power) st.revUs += dtUs; else st.revUs = 0;
        if (st.burnt) conds.push({ code: 'E_LED_BURNT', refs: [inst.id], vars: { part: inst.id, mA: f1(st.burntMa) } });
        else {
          if (st.revUs > 500000) conds.push({ code: 'H_LED_REVERSED', refs: [inst.id], vars: { part: inst.id } });
          if (view.power && view.floating('A') !== view.floating('K') && !view.shorted) conds.push({ code: 'H_LED_OPEN', refs: [inst.id], vars: { part: inst.id } });
        }
        return { visual: { b: ledB(I), color: propOf(inst, def, 'color'), burnt: st.burnt, reversed: rev }, conds: conds };
      },
      repair: repairDefault
    };
  }

  function rgbModel() {
    var VF = { r: 2.0, g: 3.1, b: 3.1 }, PIN = { r: 'R', g: 'G', b: 'B' };
    return {
      init: function () { return { ctl: {}, seg: { r: {}, g: {}, b: {} } }; },
      stamp: function (S, inst, st) {
        ['r', 'g', 'b'].forEach(function (k) { if (!st.seg[k].burnt) S.D(S.n(PIN[k]), S.n('C'), dp(VF[k]), k); });
      },
      after: function (view, inst, st, dtUs) {
        var vis = { burnt: {} }, conds = [];
        ['r', 'g', 'b'].forEach(function (k) {
          var s = st.seg[k];
          if (burnStep(view, s, k, dtUs)) st._dirty = true;
          vis[k] = s.burnt ? 0 : ledB(view.i(k));
          vis.burnt[k] = !!s.burnt;
          if (s.burnt) conds.push({ code: 'E_LED_BURNT', refs: [inst.id], vars: { part: inst.id + ' (' + PIN[k] + ')', mA: f1(s.burntMa) } });
        });
        return { visual: vis, conds: conds };
      },
      repair: function (inst, st) { st.seg = { r: {}, g: {}, b: {} }; st._dirty = true; }
    };
  }

  // 5161AS common cathode: pin -> segment
  var SEG_PINS = { '7': 'a', '6': 'b', '4': 'c', '2': 'd', '1': 'e', '9': 'f', '10': 'g', '5': 'dp' };
  function seg7Model() {
    return {
      init: function () { var s = {}; Object.keys(SEG_PINS).forEach(function (p) { s[SEG_PINS[p]] = {}; }); return { ctl: {}, seg: s }; },
      stamp: function (S, inst, st) {
        Object.keys(SEG_PINS).forEach(function (p) { var k = SEG_PINS[p]; if (!st.seg[k].burnt) S.D(S.n(p), S.n('3'), dp(2.0), k); });
      },
      after: function (view, inst, st, dtUs) {
        var seg = {}, burnt = false, conds = [], worst = 0;
        Object.keys(SEG_PINS).forEach(function (p) {
          var k = SEG_PINS[p], s = st.seg[k];
          if (burnStep(view, s, k, dtUs)) st._dirty = true;
          seg[k] = s.burnt ? 0 : ledB(view.i(k));
          if (s.burnt) { burnt = true; worst = Math.max(worst, s.burntMa || 0); }
        });
        if (burnt) conds.push({ code: 'E_LED_BURNT', refs: [inst.id], vars: { part: inst.id, mA: f1(worst) } });
        return { visual: { seg: seg, burnt: burnt }, conds: conds };
      },
      repair: function (inst, st) { Object.keys(st.seg).forEach(function (k) { st.seg[k] = {}; }); st._dirty = true; }
    };
  }

  function resistorModel(def) {
    return {
      init: function () { return { ctl: {} }; },
      stamp: function (S, inst) { S.R(S.n('1'), S.n('2'), Math.max(0.01, +propOf(inst, def, 'ohms') || 220), 'r'); },
      after: function (view, inst) {
        var R = Math.max(0.01, +propOf(inst, def, 'ohms') || 220);
        var P = view.ms('r') * R, conds = [];
        if (P > 0.25) conds.push({ code: 'W_RES_HOT', refs: [inst.id], vars: { part: inst.id, w: f2(P) } });
        return { visual: { hot: P > 0.25, mA: Math.abs(view.i('r')) * 1000 }, conds: conds };
      }
    };
  }

  function buttonModel(def) {
    return {
      init: function (inst) { return { ctl: ctlDefaults(def), closed: false, q: [], seed: hashStr(inst.id), nb: 0, bounce: true }; },
      stamp: function (S, inst, st) { S.SW(S.n('1a'), S.n('2a'), st.closed); },
      control: function (inst, st, key, value, nowUs) {
        st.ctl[key] = !!value;
        scheduleContact(st, !!(st.ctl.pressed || st.ctl.hold), nowUs || 0, false);
      },
      events: contactEvents, tick: contactTick,
      after: function (view, inst, st) { return { visual: { pressed: !!(st.ctl.pressed || st.ctl.hold) }, conds: [] }; }
    };
  }

  function switchModel(def) {
    return {
      init: function (inst) { var c = ctlDefaults(def); return { ctl: c, closed: +c.pos || 1, q: [], seed: hashStr(inst.id), nb: 0, bounce: true }; },
      stamp: function (S, inst, st) {
        S.SW(S.n('C'), S.n('1'), st.closed === 1);
        S.SW(S.n('C'), S.n('2'), st.closed === 2);
      },
      control: function (inst, st, key, value, nowUs) {
        if (key !== 'pos') return;
        st.ctl.pos = (+value === 2) ? 2 : 1;
        scheduleContact(st, st.ctl.pos, nowUs || 0, 0);           // chatter = contact open (0)
      },
      events: contactEvents, tick: contactTick,
      after: function (view, inst, st) { return { visual: { pos: st.ctl.pos }, conds: [] }; }
    };
  }

  function potModel(def) {
    return {
      init: function () { return { ctl: ctlDefaults(def) }; },
      stamp: function (S, inst, st) {
        var p = clamp((+st.ctl.pos) / 100, 0, 1);
        S.R(S.n('1'), S.n('W'), Math.max(1, 10000 * p), 'a');
        S.R(S.n('W'), S.n('3'), Math.max(1, 10000 * (1 - p)), 'b');
      },
      control: function (inst, st, key, value) { if (key === 'pos') st.ctl.pos = clamp(+value || 0, 0, 100); },
      after: function (view, inst, st) { return { visual: { p: clamp((+st.ctl.pos) / 100, 0, 1) }, conds: [] }; }
    };
  }

  function ldrR(lux) { return clamp(15000 * Math.pow(Math.max(lux, 1e-3) / 10, -0.7), 200, 1e6); }
  function ldrModel(def) {
    return {
      init: function () { return { ctl: ctlDefaults(def) }; },
      stamp: function (S, inst, st) { S.R(S.n('1'), S.n('2'), ldrR(+st.ctl.lux), 'r'); },
      control: function (inst, st, key, value) { if (key === 'lux') st.ctl.lux = clamp(+value || 0.1, 0.1, 10000); },
      after: function (view, inst, st) { return { visual: { lux: +st.ctl.lux }, conds: [] }; }
    };
  }

  function buzzerModel() {
    return {
      init: function () { return { ctl: {}, fwd: true }; },
      stamp: function (S, inst, st) { S.R(S.n('P'), S.n('N'), st.fwd ? 330 : 1e6, 'r'); },
      decide: function (view, inst, st) {
        var vd = view.vd('P', 'N'), f = isNaN(vd) ? true : vd >= 0;
        if (f !== st.fwd) { st.fwd = f; return true; }
        return false;
      },
      after: function (view, inst, st) {
        var w = view.wVd('P', 'N', 2.5), vd = view.vd('P', 'N');
        var on = w > 0 && st.fwd;
        var vol = on ? clamp(((isNaN(vd) ? 0 : view.vdPeak('P', 'N')) - 2.5) / 2.5, 0, 1) * w : 0;
        return { visual: { on: on, freq: 2300, vol: vol }, conds: [] };
      }
    };
  }

  function piezoModel() {
    return {
      init: function () { return { ctl: {} }; },
      stamp: function (S, inst) { S.R(S.n('P'), S.n('N'), 1e6, 'r'); },
      after: function (view, inst) {
        var a = view.pwmOn('P'), b = view.pwmOn('N'), src = a && !b ? a : (b && !a ? b : null);
        var other = src === a ? 'N' : 'P';
        var on = !!src && src.hz >= 20 && src.hz <= 20000 && !view.floating(other);
        return { visual: { on: on, freq: on ? src.hz : 0, vol: on ? 1 : 0 }, conds: [] };
      }
    };
  }

  function hcsr04Model(def) {
    return {
      init: function () { return { ctl: ctlDefaults(def), powered: false, vcc: 0, damaged: false, echoHigh: false, busyUntilUs: -1e15, lastTrigUs: -1e15 }; },
      stamp: function (S, inst, st) {
        var vcc = S.n('VCC'), gnd = S.n('GND');
        S.R(vcc, gnd, 330, 'load');                            // ≈ 15 mA at 5 V (model)
        S.R(S.n('Trig'), gnd, 1e6);
        if (st.powered) S.R(S.n('Echo'), st.echoHigh ? vcc : gnd, 100, 'echo'); // push-pull output, 100 Ω (model)
      },
      decide: function (view, inst, st) {
        var ch = decidePower(view, inst, st, { min: 4.5 });
        if (!st.powered && st.echoHigh) { st.echoHigh = false; ch = true; }
        return ch;
      },
      echo: function (inst, st, nowUs) {
        if (!st.powered || nowUs < st.busyUntilUs) return null;
        st.lastTrigUs = nowUs;
        var d = clamp(+st.ctl.distance || 0, 2, 1e6);
        var width = (st.ctl.noObject || d > 400) ? 38000 : Math.round(d * 2 / 0.0343);
        var rise = nowUs + 500;
        st.busyUntilUs = rise + width;
        return { riseUs: rise, widthUs: width };
      },
      control: function (inst, st, key, value) { st.ctl[key] = key === 'noObject' ? !!value : clamp(+value || 0, 2, 450); },
      after: function (view, inst, st) {
        return { visual: { powered: st.powered, distance: +st.ctl.distance, pinging: !!st.echoHigh, damaged: st.damaged },
          conds: powerConds(view, inst, st, { min: 4.5, label: '5V' }) };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  function dhtModel(def, is22) {
    var vmax = is22 ? 6.0 : 5.5, period = is22 ? 2000000 : 1000000;
    return {
      init: function () { return { ctl: ctlDefaults(def), powered: false, vcc: 0, damaged: false, lastReadUs: -1e15, last: null }; },
      stamp: function (S, inst) {
        var vcc = S.n('VCC');
        S.R(vcc, S.n('GND'), 33000, 'load');                   // ≈ 0.15 mA standby (model)
        S.R(S.n('DATA'), vcc, 10000);                          // module's 10 kΩ pull-up on DATA
      },
      decide: function (view, inst, st) {
        var ch = decidePower(view, inst, st, { min: 3.0, max: vmax });
        if (!st.powered) st.last = null;
        return ch;
      },
      /** The 5 raw bytes the sensor sends (§4.5). null = no response. */
      dht: function (inst, st, nowUs) {
        if (!st.powered) return null;
        if (st.last && nowUs - st.lastReadUs < period) return st.last.slice();
        var t = +st.ctl.temp, h = +st.ctl.hum, b;
        if (!is22) {
          var ti = Math.round(clamp(t, 0, 50)), hi = Math.round(clamp(h, 20, 90));
          b = [hi, 0, ti, 0];
        } else {
          t = clamp(t, -40, 80); h = clamp(h, 0, 100);
          var h10 = Math.round(h * 10), t10 = Math.round(Math.abs(t) * 10);
          b = [h10 >> 8, h10 & 255, (t10 >> 8) | (t < 0 && t10 ? 0x80 : 0), t10 & 255];
        }
        b.push((b[0] + b[1] + b[2] + b[3]) & 255);
        st.last = b; st.lastReadUs = nowUs;
        return b.slice();
      },
      control: function (inst, st, key, value) {
        if (key === 'temp') st.ctl.temp = clamp(+value, is22 ? -40 : 0, is22 ? 80 : 50);
        else if (key === 'hum') st.ctl.hum = clamp(+value, is22 ? 0 : 20, is22 ? 100 : 90);
      },
      after: function (view, inst, st) {
        return { visual: { powered: st.powered, t: +st.ctl.temp, h: +st.ctl.hum, damaged: st.damaged },
          conds: powerConds(view, inst, st, { min: 3.0, label: '3.3V أو 5V' }) };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  function sg90Model() {
    return {
      init: function () { return { ctl: {}, powered: false, vcc: 0, damaged: false, angle: 90, target: 90, pulsing: false, moving: false }; },
      stamp: function (S, inst, st) {
        // (model) ≈ 10 mA idle / ≈ 200 mA while moving at 5 V
        S.R(S.n('VCC'), S.n('GND'), st.moving && st.powered ? 25 : 500, 'load');
      },
      decide: function (view, inst, st) { return decidePower(view, inst, st, { min: 3.0, max: 7.5 }); },
      servoPulse: function (inst, st, widthUs) {
        if (!widthUs) { st.pulsing = false; return; }
        st.pulsing = true;
        st.target = clamp((widthUs - 544) * 180 / (2400 - 544), 0, 180);
      },
      after: function (view, inst, st, dtUs) {
        var rate = !st.powered ? 0 : (st.vcc >= 4.5 ? 600 : 240);   // °/s (0.1 s/60° at 4.8 V; ×0.4 on a weak supply)
        if (st.pulsing && rate > 0 && dtUs > 0) {
          var step = rate * dtUs / 1e6, d = st.target - st.angle;
          st.angle = Math.abs(d) <= step ? st.target : st.angle + (d > 0 ? step : -step);
        }
        var mv = st.pulsing && rate > 0 && Math.abs(st.target - st.angle) > 0.01;
        if (mv !== st.moving) { st.moving = mv; st._dirty = true; }
        var conds = powerConds(view, inst, st, { min: 4.5, label: '5V' });
        if (st.powered && !st.pulsing && view.netHasOutput('SIG')) conds.push({ code: 'H_SERVO_NO_PULSE', refs: [inst.id], vars: {} });
        return { visual: { powered: st.powered, angle: st.angle, moving: st.moving, damaged: st.damaged }, conds: conds };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  /* ---- LCD 16x2: HD44780 behind a PCF8574 I2C backpack ----
   * Backpack wiring (common 0x27 modules): P0 = RS, P1 = RW, P2 = EN, P3 = backlight, P4..P7 = D4..D7 (4-bit mode).
   * The interpreter sends high-level calls (§5 vocabulary); this model keeps the HD44780 state:
   * DDRAM 2 × 40, address counter, entry mode (I/D, S), display shift, display/cursor/blink, backlight. */
  function hdNew() {
    var r0 = [], r1 = [];
    for (var i = 0; i < 40; i++) { r0.push(0x20); r1.push(0x20); }
    return { ram: [r0, r1], row: 0, col: 0, shift: 0, id: true, sh: false, display: true, cursor: false, blink: false, backlight: true, uninit: true };
  }
  function hdClear(h) {
    for (var i = 0; i < 40; i++) { h.ram[0][i] = 0x20; h.ram[1][i] = 0x20; }
    h.row = 0; h.col = 0; h.shift = 0; h.id = true;
  }
  function hdWrite(h, b) {
    h.ram[h.row][h.col] = b & 255;
    if (h.id) { h.col++; if (h.col >= 40) { h.col = 0; h.row = 1 - h.row; } }
    else { h.col--; if (h.col < 0) { h.col = 39; h.row = 1 - h.row; } }
    if (h.sh) h.shift = (h.shift + (h.id ? 1 : -1) + 40) % 40;     // autoscroll moves the window with the text
  }
  // Character ROM A00 (the common one): ASCII 0x20–0x7D except 0x5C = ¥, 0x7E = →, 0x7F = ←
  function romChar(b) {
    if (b === 0x5C) return '¥';
    if (b === 0x7E) return '→';
    if (b === 0x7F) return '←';
    if (b >= 0x20 && b <= 0x7D) return String.fromCharCode(b);
    return '▒';
  }
  function lcdModel(def) {
    return {
      init: function () { return { ctl: {}, powered: false, vcc: 0, damaged: false, hd: null }; },
      stamp: function (S, inst, st) {
        var vcc = S.n('VCC');
        S.R(vcc, S.n('GND'), st.powered && st.hd && st.hd.backlight ? 200 : 1000, 'load'); // (model) ≈ 25 / 5 mA
        S.R(S.n('SDA'), vcc, 4700);                            // backpack pull-ups to its VCC
        S.R(S.n('SCL'), vcc, 4700);
      },
      decide: function (view, inst, st) {
        var was = st.powered, ch = decidePower(view, inst, st, { min: 3.0, max: 7 });
        if (st.powered && !was) { st.hd = hdNew(); ch = true; }   // power-up: uninitialised HD44780, backlight on
        if (!st.powered && was) { st.hd = null; ch = true; }      // power loss: state forgotten
        return ch;
      },
      i2c: {
        addr: function (inst) { return +propOf(inst, def, 'addr') || 0x27; },
        call: function (inst, st, method, args) {
          var h = st.hd; if (!h) return;
          args = args || [];
          switch (method) {
            case 'init': hdClear(h); h.display = true; h.cursor = false; h.blink = false; h.sh = false; h.backlight = false; h.uninit = false; st._dirty = true; break;
            case 'clear': hdClear(h); break;
            case 'home': h.row = 0; h.col = 0; h.shift = 0; break;
            case 'setCursor': {
              var c = Math.max(0, (+args[0]) | 0), r = Math.max(0, (+args[1]) | 0);
              if (r > 1) r = 1;                                 // the library clamps the row to rows-1
              h.row = r; h.col = c % 40; break;
            }
            case 'write': (args[0] || []).forEach(function (b) { hdWrite(h, +b); }); break;
            case 'backlight': h.backlight = !!args[0]; st._dirty = true; break;
            case 'display': h.display = !!args[0]; break;
            case 'cursor': h.cursor = !!args[0]; break;
            case 'blink': h.blink = !!args[0]; break;
            case 'scroll': h.shift = (h.shift + (+args[0] < 0 ? 1 : -1) + 40) % 40; break; // scrollDisplayLeft = -1
            case 'leftToRight': h.id = !!args[0]; break;
            case 'autoscroll': h.sh = !!args[0]; break;
          }
        }
      },
      after: function (view, inst, st) {
        var h = st.hd, lines = ['', ''], cursor = null, nonAscii = false;
        if (h && !h.uninit) {
          for (var r = 0; r < 2; r++) {
            var s = '';
            for (var i = 0; i < 16; i++) {
              var b = h.ram[r][(i + h.shift) % 40];
              var ch = romChar(b);
              if (ch === '▒') nonAscii = true;
              s += ch;
            }
            lines[r] = s;
          }
          var vc = (h.col - h.shift + 40) % 40;
          if (h.display && (h.cursor || h.blink) && vc < 16) cursor = { c: vc, r: h.row, blink: h.blink };
        }
        var conds = [];
        if (st.damaged) conds.push({ code: 'E_REVERSED_POWER', refs: [inst.id], vars: { part: inst.id } });
        else if (st.vcc < 0.5) { if (view.power) conds.push({ code: 'W_NO_POWER', refs: [inst.id], vars: { part: inst.id, vcc: '5V' } }); }
        else if (st.vcc < 3.0) conds.push({ code: 'W_LOW_VCC', refs: [inst.id], vars: { part: inst.id, need: '4.5', v: f2(st.vcc) } });
        else if (st.vcc < 4.5) conds.push({ code: 'W_LCD_VOLT', refs: [inst.id], vars: { v: f2(st.vcc) } });
        if (nonAscii && h && h.display) conds.push({ code: 'H_LCD_ASCII', refs: [inst.id], vars: {} });
        return { visual: { powered: !!st.powered, dim: st.powered && st.vcc < 4.5, uninit: !!(h && h.uninit), backlight: !!(h && h.backlight),
          lines: lines, cursor: cursor, display: !!(h && h.display), damaged: st.damaged }, conds: conds };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  function pirModel(def) {
    return {
      init: function () { return { ctl: ctlDefaults(def), powered: false, vcc: 0, damaged: false, out: false, onUs: 0, outUntilUs: 0, blockUntilUs: -1e15, nowUs: 0 }; },
      stamp: function (S, inst, st) {
        var gnd = S.n('GND');
        S.R(S.n('VCC'), gnd, 77000, 'load');                   // ≈ 65 µA (model)
        if (st.powered) S.V(S.n('OUT'), gnd, st.out ? 3.3 : 0, 100, 'out'); // on-board 3.3 V regulator output
      },
      decide: function (view, inst, st, nowUs) {
        var was = st.powered, ch = decidePower(view, inst, st, { min: 4.5, max: 20 });
        if (st.powered && !was) st.onUs = nowUs || 0;
        if (!st.powered && st.out) { st.out = false; ch = true; }
        st.nowUs = nowUs || 0;
        return ch;
      },
      control: function (inst, st, key, value, nowUs) {
        nowUs = nowUs || 0;
        if (key !== 'motion') { st.ctl[key] = key === 'skipWarmup' ? !!value : (key === 'retrigger' ? (value === 'L' ? 'L' : 'H') : clamp(+value || 5, 3, 300)); return; }
        if (!st.powered) return;
        var warmed = st.ctl.skipWarmup || nowUs - st.onUs >= 60e6;
        if (!warmed || nowUs < st.blockUntilUs) return;
        var hold = clamp(+st.ctl.holdS || 5, 3, 300) * 1e6;
        if (st.out) { if (st.ctl.retrigger !== 'L') st.outUntilUs = nowUs + hold; }
        else { st.out = true; st.outUntilUs = nowUs + hold; st._dirty = true; }
      },
      events: function (inst, st) { return st.out ? st.outUntilUs : Infinity; },
      tick: function (inst, st, nowUs) {
        if (st.out && nowUs >= st.outUntilUs) { st.out = false; st.blockUntilUs = nowUs + 2.5e6; return true; }
        return false;
      },
      after: function (view, inst, st, dtUs, nowUs) {
        var left = (!st.powered || st.ctl.skipWarmup) ? 0 : Math.max(0, (st.onUs + 60e6 - (nowUs || 0)) / 1e6);
        return { visual: { powered: st.powered, out: st.out ? 1 : 0, warmupLeftS: Math.ceil(left), damaged: st.damaged },
          conds: powerConds(view, inst, st, { min: 4.5, label: '5V' }) };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  function irModel(def) {
    return {
      init: function () { return { ctl: ctlDefaults(def), powered: false, vcc: 0, damaged: false }; },
      stamp: function (S, inst, st) {
        var vcc = S.n('VCC'), gnd = S.n('GND'), out = S.n('OUT');
        S.R(vcc, gnd, 250, 'load');                            // ≈ 20 mA IR LED at 5 V (model)
        S.R(out, vcc, 10000);                                  // LM393 open-collector output pull-up
        if (st.powered && (+st.ctl.distance) <= (+st.ctl.threshold)) S.R(out, gnd, 50, 'sw');
      },
      decide: function (view, inst, st) { return decidePower(view, inst, st, { min: 3.0, max: 5.5 }); },
      control: function (inst, st, key, value) { st.ctl[key] = clamp(+value || 0, key === 'threshold' ? 2 : 0, key === 'threshold' ? 30 : 40); },
      after: function (view, inst, st) {
        return { visual: { powered: st.powered, detect: st.powered && (+st.ctl.distance) <= (+st.ctl.threshold), damaged: st.damaged },
          conds: powerConds(view, inst, st, { min: 3.0, label: '3.3V أو 5V' }) };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  function soilModel(def) {
    return {
      init: function () { return { ctl: ctlDefaults(def), powered: false, vcc: 0, damaged: false }; },
      stamp: function (S, inst, st) {
        var vcc = S.n('VCC'), gnd = S.n('GND'), a0 = S.n('A0'), d0 = S.n('D0');
        var m = clamp((+st.ctl.moisture) / 100, 0, 1);
        S.R(vcc, gnd, 1000, 'load');                           // (model) ≈ 5 mA: comparator + power LED
        // A0 = Vcc·(1 − 0.8 m) with 1 kΩ Thevenin resistance (model), built as a divider so it scales with VCC
        var r = 1 - 0.8 * m;
        S.R(vcc, a0, 1000 / r);
        S.R(a0, gnd, r >= 0.999999 ? 1e9 : 1000 / (1 - r));
        S.R(d0, vcc, 10000);
        if (st.powered && m >= (+st.ctl.threshold) / 100) S.R(d0, gnd, 50, 'sw');
      },
      decide: function (view, inst, st) { return decidePower(view, inst, st, { min: 3.0, max: 5.5 }); },
      control: function (inst, st, key, value) { st.ctl[key] = clamp(+value || 0, 0, 100); },
      after: function (view, inst, st) {
        var m = +st.ctl.moisture;
        return { visual: { powered: st.powered, m: m, dOut: st.powered && m >= +st.ctl.threshold ? 0 : 1, damaged: st.damaged },
          conds: powerConds(view, inst, st, { min: 3.0, label: '3.3V أو 5V' }) };
      },
      repair: function (inst, st) { st.damaged = false; st._dirty = true; }
    };
  }

  function relayModel(def) {
    return {
      init: function () { return { ctl: {}, powered: false, vcc: 0, damaged: false, on: false }; },
      stamp: function (S, inst, st) {
        var vcc = S.n('VCC'), gnd = S.n('GND'), inp = S.n('IN'), m = S.node();
        if (propOf(inst, def, 'trigger') === 'high') { S.R(inp, m, 1000); S.D(m, gnd, dp(1.2), 'opto'); }
        else { S.R(vcc, m, 1000); S.D(m, inp, dp(1.2), 'opto'); }
        if (st.on) S.R(vcc, gnd, 70, 'coil');                  // SRD-05VDC coil ≈ 70 Ω
        S.SW(S.n('COM'), S.n('NO'), st.on);
        S.SW(S.n('COM'), S.n('NC'), !st.on);
      },
      decide: function (view, inst, st) {
        var V = supplyV(view, 'VCC', 'GND'); st.vcc = V;
        var on = view.i('opto') >= 0.001 && V >= 3.75;
        if (on !== st.on) { st.on = on; st.powered = V >= 3.75; return true; }
        st.powered = V >= 3.75;
        return false;
      },
      after: function (view, inst, st) {
        var conds = [];
        var V = st.vcc || 0;
        if (V < 0.5) { if (view.power) conds.push({ code: 'W_NO_POWER', refs: [inst.id], vars: { part: inst.id, vcc: '5V' } }); }
        else if (V < 3.75) conds.push({ code: 'W_LOW_VCC', refs: [inst.id], vars: { part: inst.id, need: '3.75', v: f2(V) } });
        return { visual: { powered: V >= 3.75, on: st.on, inLed: view.i('opto') >= 0.0005 }, conds: conds };
      }
    };
  }

  function lampModel() {
    return {
      init: function () { return { ctl: {} }; },
      stamp: function (S, inst) { S.R(S.n('1'), S.n('2'), 50, 'r'); },   // 5 V / 0.1 A bulb hot (model)
      after: function (view) { return { visual: { b: clamp(view.ms('r') * 50 / 0.5, 0, 1) }, conds: [] }; }
    };
  }

  function batModel() {
    return {
      init: function () { return { ctl: {} }; },
      stamp: function (S, inst) { S.V(S.n('P'), S.n('N'), 9.0, 1.5, 'bat'); },   // alkaline ≈ 1.5 Ω (model)
      after: function () { return { visual: {}, conds: [] }; }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 9. Part definitions (§4.4). info_ar / facts / pin `ar`: NEW COPY     */
  /* ------------------------------------------------------------------ */
  var COLOR_OPTS = [{ v: 'red', label_ar: 'أحمر' }, { v: 'green', label_ar: 'أخضر' }, { v: 'yellow', label_ar: 'أصفر' }, { v: 'blue', label_ar: 'أزرق' }, { v: 'white', label_ar: 'أبيض' }];
  var BOARD_CONTROLS = [{ key: 'reset', type: 'momentary', label_ar: 'زرار الريست' }];

  var DEFS = [
    /* ---------------- boards ---------------- */
    { type: 'uno', prefix: 'uno', name_ar: 'أردوينو أونو', name_en: 'Arduino Uno R3', category: 'board', kind: 'board', plug: false,
      keywords: ['uno', 'arduino', 'اردوينو', 'أردوينو', 'اونو', 'كارت'],
      bbox: { x: 0, y: 0, w: 27, h: 21 }, pins: unoPins(true),
      internal: [['GND1', 'GND2', 'GND3'], ['SDA', 'A4'], ['SCL', 'A5']],
      props: [], controls: BOARD_CONTROLS,
      info_ar: 'أشهر كارت للتعلّم. أطرافه شغالة على 5 فولت، وبيتشغّل ويتبرمج من الـUSB.',
      facts: [{ k_ar: 'المعالج', v: 'ATmega328P · 16 MHz' }, { k_ar: 'فولت الأطراف', v: '5 V' }, { k_ar: 'أقصى تيار للطرف', v: '20 mA (مستمر) · 40 mA (أقصى حد)' },
        { k_ar: 'أطراف الـPWM', v: '3, 5, 6, 9, 10, 11' }, { k_ar: 'الـanalogRead', v: '10 bit (0–1023) على A0–A5' }, { k_ar: 'الـinterrupt', v: '2, 3' }, { k_ar: 'الـI2C', v: 'SDA = A4 · SCL = A5' }],
      has3d: true },
    { type: 'esp32', prefix: 'esp', name_ar: 'ESP32 (30 طرف)', name_en: 'ESP32 DevKit V1 (30 pin)', category: 'board', kind: 'board', plug: false,
      keywords: ['esp32', 'esp', 'wifi', 'واي فاي', 'كارت'],
      bbox: { x: 0, y: 0, w: 12, h: 21 }, pins: espPins(), internal: [['GND1', 'GND2']],
      props: [], controls: [BOARD_CONTROLS[0], { key: 'routerOff', type: 'toggle', label_ar: 'الراوتر مقفول' }],
      info_ar: 'كارت أسرع وفيه واي فاي وبلوتوث. أطرافه شغالة على 3.3 فولت، فخلّوا بالكم من الحساسات اللي بتطلّع 5 فولت.',
      facts: [{ k_ar: 'المعالج', v: 'ESP32-WROOM-32 · 240 MHz' }, { k_ar: 'فولت الأطراف', v: '3.3 V (مش بيستحمل 5 V)' },
        { k_ar: 'الـanalogRead', v: '12 bit (0–4095)' }, { k_ar: 'أطراف دخل بس', v: '34, 35, 36 (VP), 39 (VN)' }, { k_ar: 'الـI2C', v: 'SDA = 21 · SCL = 22' },
        { k_ar: 'اللمبة اللي على الكارت', v: 'GPIO2 (زرقا)' }],
      has3d: true },
    { type: 'nano', prefix: 'nano', name_ar: 'أردوينو نانو', name_en: 'Arduino Nano (ATmega328P)', category: 'board', kind: 'board', plug: true,
      keywords: ['nano', 'arduino', 'نانو', 'اردوينو', 'كارت'],
      bbox: { x: -2.5, y: -0.55, w: 17.5, h: 7.1 }, pins: nanoPins(), internal: [['GND1', 'GND2'], ['RST1', 'RST2']],
      props: [], controls: BOARD_CONTROLS,
      info_ar: 'نفس معالج الأونو في حجم صغير، وبيتركب في البريدبورد على طول (صف رجول في كل ناحية من المجرى).',
      facts: [{ k_ar: 'المعالج', v: 'ATmega328P · 16 MHz' }, { k_ar: 'فولت الأطراف', v: '5 V' }, { k_ar: 'الـanalogRead', v: 'A0–A7 (A6 و A7 analog بس)' },
        { k_ar: 'طرف 3V3', v: '50 mA بالكتير' }],
      has3d: false },

    /* ---------------- breadboards ---------------- */
    { type: 'bb400', prefix: 'bb', name_ar: 'بريدبورد صغيرة (400 خُرم)', name_en: 'Half breadboard (400)', category: 'proto', kind: 'breadboard', plug: false,
      keywords: ['breadboard', 'بريدبورد', 'بورد', 'تجارب'], bbox: { x: 0, y: 0, w: 33, h: 20 }, pins: bbPins(30, 25), bb: { cols: 30, rails: 25 },
      internal: [], props: [], controls: [],
      info_ar: 'كل 5 خُرم في نفس العمود (a لـe، أو f لـj) متوصلين ببعض جوّه. المجرى اللي في النص بيفصل الناحيتين، والخطوط الحمرا والزرقا على الجناب متوصلة بطولها.',
      facts: [{ k_ar: 'الأعمدة', v: '30' }, { k_ar: 'خطوط الكهربا', v: '4 (2 + و 2 −)، كل واحد لوحده' }, { k_ar: 'المسافة بين الخُرم', v: '2.54 mm (0.1″)' }],
      has3d: true },
    { type: 'bb830', prefix: 'bb', name_ar: 'بريدبورد كبيرة (830 خُرم)', name_en: 'Full breadboard (830)', category: 'proto', kind: 'breadboard', plug: false,
      keywords: ['breadboard', 'بريدبورد', 'بورد', 'كبيرة'], bbox: { x: 0, y: 0, w: 66, h: 20 }, pins: bbPins(63, 50), bb: { cols: 63, rails: 50 },
      internal: [], props: [{ key: 'splitRails', type: 'toggle', label_ar: 'الخطوط الجانبية مقسومة في النص', default: false }], controls: [],
      info_ar: 'نفس فكرة الصغيرة بس 63 عمود. فيه بوردات خطوط الكهربا فيها مقسومة في النص: بصّوا على الخط الأحمر والأزرق في البورد بتاعتكم.',
      facts: [{ k_ar: 'الأعمدة', v: '63' }, { k_ar: 'خطوط الكهربا', v: '4، وممكن تكون مقسومة نصين' }, { k_ar: 'المسافة بين الخُرم', v: '2.54 mm (0.1″)' }],
      has3d: true },

    /* ---------------- outputs ---------------- */
    { type: 'led', prefix: 'led', name_ar: 'لمبة LED', name_en: 'LED 5mm', category: 'out', kind: 'part', plug: true,
      keywords: ['led', 'لمبة', 'ضوء', 'ليد', 'نور'], bbox: { x: -1, y: -3, w: 3, h: 4 },
      pins: [{ id: 'A', label: 'A (+)', ar: 'الرجل الطويلة: الموجب (Anode)', x: 0, y: 0, role: 'passive' },
        { id: 'K', label: 'K (−)', ar: 'الرجل القصيرة: السالب (Cathode)', x: 1, y: 0, role: 'passive' }],
      internal: [], props: [{ key: 'color', type: 'select', label_ar: 'اللون', default: 'red', options: COLOR_OPTS }], controls: [],
      info_ar: 'بتنوّر لما التيار يعدّي فيها من الرجل الطويلة للقصيرة بس. لازم مقاومة قبلها (220 أو 330 أوم) وإلا هتتحرق.',
      facts: [{ k_ar: 'الفولت عليها وهي منورة (Vf)', v: '≈ 2.0 V أحمر · 2.1 V أصفر · 2.2 V أخضر · 3.1 V أزرق وأبيض' },
        { k_ar: 'أقصى تيار مستمر', v: '20 mA' }, { k_ar: 'أقصى حد', v: '≈ 30 mA' }, { k_ar: 'أقصى فولت بالعكس', v: '5 V' }],
      has3d: false },
    { type: 'rgb', prefix: 'rgb', name_ar: 'لمبة RGB (كاثود مشترك)', name_en: 'RGB LED common cathode', category: 'out', kind: 'part', plug: true,
      keywords: ['rgb', 'led', 'لمبة', 'الوان', 'ألوان'], bbox: { x: -0.5, y: -3, w: 4, h: 4 },
      pins: [{ id: 'R', label: 'R', ar: 'الأحمر (+)', x: 0, y: 0, role: 'passive' }, { id: 'C', label: 'C (−)', ar: 'الرجل الأطول: السالب المشترك، يروح GND', x: 1, y: 0, role: 'passive' },
        { id: 'G', label: 'G', ar: 'الأخضر (+)', x: 2, y: 0, role: 'passive' }, { id: 'B', label: 'B', ar: 'الأزرق (+)', x: 3, y: 0, role: 'passive' }],
      internal: [], props: [], controls: [],
      info_ar: 'تلات لمبات في جسم واحد بيشتركوا في السالب. كل لون محتاج مقاومة لوحده، وبـanalogWrite تعملوا أي لون.',
      facts: [{ k_ar: 'Vf', v: 'R ≈ 2.0 V · G ≈ 3.1 V · B ≈ 3.1 V' }, { k_ar: 'أقصى تيار لكل لون', v: '20 mA' }],
      has3d: false },
    { type: 'buzzer', prefix: 'bz', name_ar: 'بازر (Active)', name_en: 'Active buzzer', category: 'out', kind: 'part', plug: true,
      keywords: ['buzzer', 'بازر', 'صوت', 'جرس', 'زمارة'], bbox: { x: -0.85, y: -2.35, w: 4.7, h: 4.7 },
      pins: [{ id: 'P', label: '+', ar: 'الرجل الطويلة: الموجب', x: 0, y: 0, role: 'passive' }, { id: 'N', label: '−', ar: 'السالب، يروح GND', x: 3, y: 0, role: 'passive' }],
      internal: [], props: [], controls: [],
      info_ar: 'جواه مذبذب، فبيزمّر لوحده أول ما ياخد فولت (HIGH). مش محتاج tone().',
      facts: [{ k_ar: 'الفولت', v: '3.5–5.5 V' }, { k_ar: 'التيار', v: '≤ 30 mA' }, { k_ar: 'النغمة', v: '≈ 2.3 kHz' }, { k_ar: 'المسافة بين الرجلين', v: '7.6 mm' }],
      has3d: false },
    { type: 'piezo', prefix: 'pz', name_ar: 'بازر (Passive، بيزو)', name_en: 'Passive piezo', category: 'out', kind: 'part', plug: true,
      keywords: ['piezo', 'buzzer', 'بيزو', 'بازر', 'صوت', 'tone', 'نغمة'], bbox: { x: -0.85, y: -2.35, w: 4.7, h: 4.7 },
      pins: [{ id: 'P', label: '+', ar: 'الموجب', x: 0, y: 0, role: 'passive' }, { id: 'N', label: '−', ar: 'السالب، يروح GND', x: 3, y: 0, role: 'passive' }],
      internal: [], props: [], controls: [],
      info_ar: 'ساكت على الفولت الثابت. محتاج نبضات (tone) علشان يطلّع صوت، وبكده تقدروا تعملوا نغمات.',
      facts: [{ k_ar: 'النوع', v: 'Piezo (مقاومته عالية جدًا)' }, { k_ar: 'بيشتغل بـ', v: 'tone(pin, freq)' }],
      has3d: false },
    { type: 'lamp', prefix: 'lamp', name_ar: 'لمبة 5V صغيرة', name_en: 'Small 5V lamp', category: 'out', kind: 'part', plug: true,
      keywords: ['lamp', 'لمبة', 'لمبه', 'حمل'], bbox: { x: -1, y: -3, w: 4, h: 4 },
      pins: [{ id: '1', label: '1', ar: 'طرف', x: 0, y: 0, role: 'passive' }, { id: '2', label: '2', ar: 'طرف', x: 2, y: 0, role: 'passive' }],
      internal: [], props: [], controls: [],
      info_ar: 'لمبة فتيلة صغيرة بتسحب تيار كبير (حوالي 100 مللي أمبير)، فما تتشغلش من طرف الكارت مباشرةً: استخدموا ريليه.',
      facts: [{ k_ar: 'الفولت', v: '5 V' }, { k_ar: 'التيار', v: '≈ 0.1 A (تقريبًا في المحاكي)' }],
      has3d: false },

    /* ---------------- inputs ---------------- */
    { type: 'resistor', prefix: 'r', name_ar: 'مقاومة', name_en: 'Resistor 1/4 W', category: 'in', kind: 'part', plug: true,
      keywords: ['resistor', 'مقاومة', 'مقاومه', 'ohm', 'اوم'], bbox: { x: -0.3, y: -0.6, w: 4.6, h: 1.2 },
      pins: [{ id: '1', label: '1', ar: 'رجل (المقاومة مالهاش اتجاه)', x: 0, y: 0, role: 'passive' }, { id: '2', label: '2', ar: 'رجل (المقاومة مالهاش اتجاه)', x: 4, y: 0, role: 'passive' }],
      internal: [], props: [{ key: 'ohms', type: 'select', label_ar: 'القيمة', default: 220,
        options: [{ v: 220, label_ar: '220 أوم' }, { v: 330, label_ar: '330 أوم' }, { v: 1000, label_ar: '1 كيلو' }, { v: 10000, label_ar: '10 كيلو' }] }], controls: [],
      info_ar: 'بتقلّل التيار. قبل اللمبة بتحميها، و10 كيلو بتعمل pull-down أو pull-up للزرار. مالهاش اتجاه.',
      facts: [{ k_ar: 'القدرة', v: '1/4 W' }, { k_ar: 'الدقة', v: '±5 %' },
        { k_ar: 'الألوان', v: '220: أحمر أحمر بني دهبي · 330: برتقاني برتقاني بني دهبي · 1k: بني أسود أحمر دهبي · 10k: بني أسود برتقاني دهبي' }],
      has3d: false },
    { type: 'button', prefix: 'btn', name_ar: 'زرار ضغط (4 رجول)', name_en: 'Tactile push button 6x6', category: 'in', kind: 'part', plug: true, primary: 'pressed',
      keywords: ['button', 'زرار', 'زر', 'push', 'switch'], bbox: { x: -0.5, y: -0.5, w: 3, h: 4 },
      pins: [{ id: '1a', label: '1a', ar: 'متوصلة دايمًا بـ1b', x: 0, y: 0, role: 'passive' }, { id: '2a', label: '2a', ar: 'متوصلة دايمًا بـ2b', x: 2, y: 0, role: 'passive' },
        { id: '1b', label: '1b', ar: 'متوصلة دايمًا بـ1a', x: 0, y: 3, role: 'passive' }, { id: '2b', label: '2b', ar: 'متوصلة دايمًا بـ2a', x: 2, y: 3, role: 'passive' }],
      internal: [['1a', '1b'], ['2a', '2b']], props: [],
      controls: [{ key: 'pressed', type: 'momentary', label_ar: 'دوسوا على الزرار' }, { key: 'hold', type: 'toggle', label_ar: 'خلّوه مدسوس' }],
      info_ar: 'الرجلين اللي قصاد بعض متوصلين على طول، والدوسة بتوصّل الناحيتين. بيتركب فوق المجرى، ومحتاج pull-down (10 كيلو لـGND) أو INPUT_PULLUP.',
      facts: [{ k_ar: 'المقاس', v: '6 × 6 mm' }, { k_ar: 'الارتداد (Bounce)', v: 'بيفصل ويوصل كذا مرة في أول 1–2 ms' }],
      has3d: false },
    { type: 'switch', prefix: 'sw', name_ar: 'سويتش منزلق', name_en: 'Slide switch SPDT', category: 'in', kind: 'part', plug: true, primary: 'pos',
      keywords: ['switch', 'سويتش', 'مفتاح', 'slide'], bbox: { x: -1, y: -1.5, w: 4, h: 3 },
      pins: [{ id: '1', label: '1', ar: 'بيتوصل بالنص في وضع 1', x: 0, y: 0, role: 'passive' }, { id: 'C', label: 'C', ar: 'الرجل اللي في النص (المشتركة)', x: 1, y: 0, role: 'passive' },
        { id: '2', label: '2', ar: 'بيتوصل بالنص في وضع 2', x: 2, y: 0, role: 'passive' }],
      internal: [], props: [],
      controls: [{ key: 'pos', type: 'select', label_ar: 'مكان السويتش', default: 1, options: [{ v: 1, label_ar: 'ناحية 1' }, { v: 2, label_ar: 'ناحية 2' }] }],
      info_ar: 'الرجل اللي في النص بتتوصل بواحدة من الطرفين حسب مكان السويتش، وبيفضل على وضعه.',
      facts: [{ k_ar: 'النوع', v: 'SPDT' }],
      has3d: false },
    { type: 'pot', prefix: 'pot', name_ar: 'مقاومة متغيرة 10k', name_en: 'Potentiometer 10k', category: 'in', kind: 'part', plug: true, primary: 'pos',
      keywords: ['pot', 'potentiometer', 'مقاومة متغيرة', 'بوتنشيوميتر', 'متغيرة'], bbox: { x: -1, y: -4, w: 4, h: 5 },
      pins: [{ id: '1', label: '1', ar: 'طرف (غالبًا GND)', x: 0, y: 0, role: 'passive' }, { id: 'W', label: 'W', ar: 'الرجل اللي في النص: الخرج (بيروح على طرف analog)', x: 1, y: 0, role: 'passive' },
        { id: '3', label: '3', ar: 'طرف (غالبًا 5V)', x: 2, y: 0, role: 'passive' }],
      internal: [], props: [],
      controls: [{ key: 'pos', type: 'range', label_ar: 'لفّوا المقاومة', min: 0, max: 100, step: 1, unit_ar: '%', default: 50, log: false }],
      info_ar: 'الطرفين على 5V وGND، والرجل اللي في النص بتطلّع فولت بين الاتنين حسب ما تلفّوا. اقروه بـanalogRead.',
      facts: [{ k_ar: 'القيمة', v: '10 kΩ' }, { k_ar: 'النوع', v: 'خطّي (Linear)' }],
      has3d: false },

    /* ---------------- sensors ---------------- */
    { type: 'ldr', prefix: 'ldr', name_ar: 'حساس ضوء (LDR)', name_en: 'LDR photoresistor', category: 'sensor', kind: 'part', plug: true,
      keywords: ['ldr', 'light', 'ضوء', 'نور', 'حساس'], bbox: { x: -1, y: -3, w: 3, h: 4 },
      pins: [{ id: '1', label: '1', ar: 'رجل (مالوش اتجاه)', x: 0, y: 0, role: 'passive' }, { id: '2', label: '2', ar: 'رجل (مالوش اتجاه)', x: 1, y: 0, role: 'passive' }],
      internal: [], props: [],
      controls: [{ key: 'lux', type: 'range', label_ar: 'كمية النور', min: 0.1, max: 10000, step: 0.1, unit_ar: 'لوكس', default: 300, log: true,
        presets: [{ v: 1, label_ar: 'ضلمة' }, { v: 300, label_ar: 'أوضة منورة' }, { v: 10000, label_ar: 'شمس' }] }],
      info_ar: 'مقاومته بتقل لما النور يزيد. لوحده ما بيطلّعش فولت: حطّوا معاه مقاومة 10 كيلو تعملوا مقسّم جهد، واقروا النص بـanalogRead.',
      facts: [{ k_ar: 'المقاومة', v: '≈ 10–20 kΩ عند 10 لوكس · ≥ 1 MΩ في الضلمة (GL5528)' }],
      has3d: false },
    { type: 'hcsr04', prefix: 'sr', name_ar: 'حساس مسافة HC-SR04', name_en: 'HC-SR04 ultrasonic', category: 'sensor', kind: 'part', plug: true,
      keywords: ['hcsr04', 'hc-sr04', 'ultrasonic', 'مسافة', 'الترا', 'حساس'], bbox: { x: -7.35, y: -7.4, w: 17.7, h: 7.9 },
      pins: [{ id: 'VCC', label: 'VCC', ar: '5 فولت', x: 0, y: 0, role: 'in' }, { id: 'Trig', label: 'Trig', ar: 'نبضة HIGH لمدة 10 ميكروثانية تبدأ القياس', x: 1, y: 0, role: 'in' },
        { id: 'Echo', label: 'Echo', ar: 'بيفضل HIGH قد مدة رحلة الصوت (5 فولت)', x: 2, y: 0, role: 'out' }, { id: 'GND', label: 'GND', ar: 'الأرضي', x: 3, y: 0, role: 'gnd' }],
      internal: [], props: [],
      controls: [{ key: 'distance', type: 'range', label_ar: 'المسافة قدّام الحساس', min: 2, max: 450, step: 1, unit_ar: 'سم', default: 50, log: false },
        { key: 'noObject', type: 'toggle', label_ar: 'مفيش حاجة قدّامه' }],
      info_ar: 'بيبعت صوت عالي ويستنى الصدى. ابعتوا نبضة على Trig، واقيسوا مدة HIGH على Echo بـpulseIn: كل 58 ميكروثانية = 1 سم.',
      facts: [{ k_ar: 'الفولت', v: '5 V · 15 mA' }, { k_ar: 'المدى', v: '2–400 cm' }, { k_ar: 'نبضة Trig', v: 'HIGH ≥ 10 µs' },
        { k_ar: 'Echo', v: '58 µs لكل سم (رايح جاي)' }, { k_ar: 'مع الـESP32', v: 'Echo بيطلّع 5 V: محتاج مقسّم جهد' }, { k_ar: 'بين كل قياس والتاني', v: '≥ 60 ms' }],
      has3d: true },
    { type: 'dht11', prefix: 'dht', name_ar: 'حساس حرارة ورطوبة DHT11 (موديول)', name_en: 'DHT11 module', category: 'sensor', kind: 'part', plug: false,
      keywords: ['dht', 'dht11', 'حرارة', 'رطوبة', 'temperature', 'humidity'], bbox: { x: -1, y: -6, w: 5, h: 7 },
      pins: [{ id: 'VCC', label: 'VCC', ar: '3.3 لـ5.5 فولت', x: 0, y: 0, role: 'in' }, { id: 'DATA', label: 'DATA', ar: 'سلك البيانات (عليه pull-up 10k على الموديول)', x: 1, y: 0, role: 'out' },
        { id: 'GND', label: 'GND', ar: 'الأرضي', x: 2, y: 0, role: 'gnd' }],
      internal: [], props: [],
      controls: [{ key: 'temp', type: 'range', label_ar: 'الحرارة', min: 0, max: 50, step: 1, unit_ar: '°C', default: 25, log: false },
        { key: 'hum', type: 'range', label_ar: 'الرطوبة', min: 20, max: 90, step: 1, unit_ar: '%', default: 60, log: false }],
      info_ar: 'بيقيس الحرارة والرطوبة ويبعتهم على سلك واحد. استخدموا مكتبة DHT، وما تقروش أسرع من مرة كل ثانية. ترتيب الرجول بيختلف من موديول للتاني: اقروا المكتوب عليه.',
      facts: [{ k_ar: 'الفولت', v: '3.3–5.5 V' }, { k_ar: 'الحرارة', v: '0–50 °C (±2 °C)' }, { k_ar: 'الرطوبة', v: '20–90 % (±5 %)' }, { k_ar: 'قراية كل', v: '1 s' }, { k_ar: 'الدقة', v: 'أرقام صحيحة' }],
      has3d: false },
    { type: 'dht22', prefix: 'dht', name_ar: 'حساس حرارة ورطوبة DHT22 (موديول)', name_en: 'DHT22 (AM2302) module', category: 'sensor', kind: 'part', plug: false,
      keywords: ['dht', 'dht22', 'am2302', 'حرارة', 'رطوبة'], bbox: { x: -1, y: -6, w: 5, h: 7 },
      pins: [{ id: 'VCC', label: 'VCC', ar: '3.3 لـ6 فولت', x: 0, y: 0, role: 'in' }, { id: 'DATA', label: 'DATA', ar: 'سلك البيانات (عليه pull-up 10k على الموديول)', x: 1, y: 0, role: 'out' },
        { id: 'GND', label: 'GND', ar: 'الأرضي', x: 2, y: 0, role: 'gnd' }],
      internal: [], props: [],
      controls: [{ key: 'temp', type: 'range', label_ar: 'الحرارة', min: -40, max: 80, step: 0.1, unit_ar: '°C', default: 25, log: false },
        { key: 'hum', type: 'range', label_ar: 'الرطوبة', min: 0, max: 100, step: 0.1, unit_ar: '%', default: 60, log: false }],
      info_ar: 'أدق من الـDHT11 ومداه أوسع، بس ما تقروهوش أسرع من مرة كل ثانيتين. في الكود اكتبوا DHT22 مش DHT11.',
      facts: [{ k_ar: 'الفولت', v: '3.3–6 V' }, { k_ar: 'الحرارة', v: '−40–80 °C (±0.5 °C)' }, { k_ar: 'الرطوبة', v: '0–100 % (±2 %)' }, { k_ar: 'قراية كل', v: '2 s' }, { k_ar: 'الدقة', v: '0.1' }],
      has3d: false },
    { type: 'pir', prefix: 'pir', name_ar: 'حساس حركة PIR HC-SR501', name_en: 'PIR HC-SR501', category: 'sensor', kind: 'part', plug: false,
      keywords: ['pir', 'motion', 'حركة', 'حساس', 'sr501'], bbox: { x: -3, y: -12, w: 10, h: 13 },
      pins: [{ id: 'VCC', label: 'VCC', ar: '5 لـ20 فولت', x: 0, y: 0, role: 'in' }, { id: 'OUT', label: 'OUT', ar: 'بيطلّع 3.3 فولت لما يحس بحركة', x: 1, y: 0, role: 'out' },
        { id: 'GND', label: 'GND', ar: 'الأرضي', x: 2, y: 0, role: 'gnd' }],
      internal: [], props: [],
      controls: [{ key: 'motion', type: 'button', label_ar: 'اعملوا حركة قدّامه' },
        { key: 'holdS', type: 'range', label_ar: 'مدة الإشارة بعد الحركة', min: 3, max: 300, step: 1, unit_ar: 'ثانية', default: 5, log: false },
        { key: 'retrigger', type: 'select', label_ar: 'لو الحركة كمّلت', default: 'H', options: [{ v: 'H', label_ar: 'بيكمّل طول ما فيه حركة' }, { v: 'L', label_ar: 'مرة واحدة' }] },
        { key: 'skipWarmup', type: 'toggle', label_ar: 'سرّعوا التسخين' }],
      info_ar: 'بيحس بحرارة الجسم وهي بتتحرك. بعد ما ياخد كهربا محتاج حوالي دقيقة يستقر، وبعد ما الإشارة تقع بيقفل ثانيتين ونص مش بيحس.',
      facts: [{ k_ar: 'الفولت', v: '4.5–20 V' }, { k_ar: 'الخرج', v: '3.3 V HIGH / 0 V LOW' }, { k_ar: 'التسخين', v: '≈ 1 دقيقة' }, { k_ar: 'وقت القفل', v: '≈ 2.5 s' },
        { k_ar: 'ترتيب الرجول', v: 'بيختلف من شركة للتانية' }],
      has3d: false },
    { type: 'irobst', prefix: 'ir', name_ar: 'حساس عوائق IR (FC-51)', name_en: 'IR obstacle sensor FC-51', category: 'sensor', kind: 'part', plug: false,
      keywords: ['ir', 'obstacle', 'عوائق', 'انفرا', 'حساس', 'fc-51'], bbox: { x: -1, y: -10, w: 6, h: 10 },
      pins: [{ id: 'OUT', label: 'OUT', ar: 'بيبقى LOW لما فيه حاجة قدّامه', x: 0, y: 0, role: 'out' }, { id: 'GND', label: 'GND', ar: 'الأرضي', x: 1, y: 0, role: 'gnd' },
        { id: 'VCC', label: 'VCC', ar: '3.3 لـ5 فولت', x: 2, y: 0, role: 'in' }],
      internal: [], props: [],
      controls: [{ key: 'distance', type: 'range', label_ar: 'بُعد الحاجة اللي قدّامه', min: 0, max: 40, step: 1, unit_ar: 'سم', default: 30, log: false },
        { key: 'threshold', type: 'range', label_ar: 'الحساسية (مسافة الكشف)', min: 2, max: 30, step: 1, unit_ar: 'سم', default: 10, log: false }],
      info_ar: 'بيبعت أشعة تحت حمرا ويشوف لو رجعت. الخرج بيقع LOW لما حاجة تقرّب، واللمبة اللي عليه بتنوّر.',
      facts: [{ k_ar: 'الفولت', v: '3.3–5 V' }, { k_ar: 'الخرج', v: 'LOW = فيه حاجة (LM393)' }, { k_ar: 'المدى', v: '2–30 cm بالمسمار اللي عليه' }],
      has3d: false },
    { type: 'soil', prefix: 'soil', name_ar: 'حساس رطوبة تربة', name_en: 'Soil moisture sensor', category: 'sensor', kind: 'part', plug: false,
      keywords: ['soil', 'moisture', 'تربة', 'زرع', 'رطوبة', 'مية'], bbox: { x: -1, y: -14, w: 6, h: 14 },
      pins: [{ id: 'VCC', label: 'VCC', ar: '3.3 لـ5 فولت', x: 0, y: 0, role: 'in' }, { id: 'GND', label: 'GND', ar: 'الأرضي', x: 1, y: 0, role: 'gnd' },
        { id: 'D0', label: 'D0', ar: 'رقمي: LOW لما التربة مبلولة أكتر من الحد', x: 2, y: 0, role: 'out' }, { id: 'A0', label: 'A0', ar: 'analog: الفولت بيزيد كل ما التربة تنشف', x: 3, y: 0, role: 'out' }],
      internal: [], props: [],
      controls: [{ key: 'moisture', type: 'range', label_ar: 'رطوبة التربة', min: 0, max: 100, step: 1, unit_ar: '%', default: 30, log: false },
        { key: 'threshold', type: 'range', label_ar: 'الحد (مسمار الموديول)', min: 0, max: 100, step: 1, unit_ar: '%', default: 50, log: false }],
      info_ar: 'شوكة بتتحط في التربة. A0 بيدّي رقم (أعلى = أنشف)، وD0 بيقع LOW لما التربة تبقى أبلّ من الحد اللي على المسمار.',
      facts: [{ k_ar: 'الفولت', v: '3.3–5 V' }, { k_ar: 'A0', v: 'فولت أعلى = تربة أنشف' }, { k_ar: 'D0', v: 'LOW = مبلولة (LM393)' }],
      has3d: false },

    /* ---------------- displays ---------------- */
    { type: 'lcd1602', prefix: 'lcd', name_ar: 'شاشة LCD 16×2 بـI2C', name_en: 'LCD 1602 + I2C backpack', category: 'display', kind: 'part', plug: false,
      keywords: ['lcd', 'شاشة', 'شاشه', 'i2c', '1602', '16x2'], bbox: { x: -1, y: -12, w: 32, h: 13 },
      pins: [{ id: 'GND', label: 'GND', ar: 'الأرضي', x: 0, y: 0, role: 'gnd' }, { id: 'VCC', label: 'VCC', ar: '5 فولت', x: 1, y: 0, role: 'in' },
        { id: 'SDA', label: 'SDA', ar: 'بيانات I2C: A4 في الأونو، 21 في الـESP32', x: 2, y: 0, role: 'in' }, { id: 'SCL', label: 'SCL', ar: 'ساعة I2C: A5 في الأونو، 22 في الـESP32', x: 3, y: 0, role: 'in' }],
      internal: [], props: [{ key: 'addr', type: 'select', label_ar: 'العنوان', default: 0x27, options: [{ v: 0x27, label_ar: '0x27' }, { v: 0x3F, label_ar: '0x3F' }] }], controls: [],
      info_ar: 'شاشة سطرين في كل سطر 16 حرف، وراها بورد صغيرة (I2C) فبتتوصل بـ4 أسلاك بس. بتكتب إنجليزي وأرقام بس. لو على الحقيقة منورة ومفيش كلام، لفّوا المقاومة الزرقا اللي ورا بمفك.',
      facts: [{ k_ar: 'الفولت', v: '5 V' }, { k_ar: 'العنوان', v: '0x27 (أو 0x3F)' }, { k_ar: 'الشريحة', v: 'HD44780 + PCF8574' }, { k_ar: 'الأونو', v: 'SDA = A4 · SCL = A5' },
        { k_ar: 'الـESP32', v: 'SDA = 21 · SCL = 22' }, { k_ar: 'الحروف', v: 'ASCII بس (مفيش عربي)' }],
      has3d: false },
    { type: 'seg7', prefix: 'seg', name_ar: 'شاشة 7 سيجمنت (كاثود مشترك)', name_en: '7-segment common cathode (5161AS)', category: 'display', kind: 'part', plug: true,
      keywords: ['7 segment', 'seg', 'سيجمنت', 'رقم', 'شاشة'], bbox: { x: -0.5, y: -0.75, w: 5, h: 7.5 },
      pins: [{ id: '10', label: '10 g', ar: 'السيجمنت g', x: 0, y: 0, role: 'passive' }, { id: '9', label: '9 f', ar: 'السيجمنت f', x: 1, y: 0, role: 'passive' },
        { id: '8', label: '8 COM', ar: 'السالب المشترك (GND)', x: 2, y: 0, role: 'passive' }, { id: '7', label: '7 a', ar: 'السيجمنت a', x: 3, y: 0, role: 'passive' },
        { id: '6', label: '6 b', ar: 'السيجمنت b', x: 4, y: 0, role: 'passive' }, { id: '1', label: '1 e', ar: 'السيجمنت e', x: 0, y: 6, role: 'passive' },
        { id: '2', label: '2 d', ar: 'السيجمنت d', x: 1, y: 6, role: 'passive' }, { id: '3', label: '3 COM', ar: 'السالب المشترك (GND)', x: 2, y: 6, role: 'passive' },
        { id: '4', label: '4 c', ar: 'السيجمنت c', x: 3, y: 6, role: 'passive' }, { id: '5', label: '5 DP', ar: 'النقطة', x: 4, y: 6, role: 'passive' }],
      internal: [['3', '8']], props: [], controls: [],
      info_ar: 'رقم واحد من 7 لمبات صغيرة (a لـg) ونقطة، كلهم سالبهم مشترك. كل سيجمنت محتاج مقاومة لوحده. بتتركب فوق المجرى.',
      facts: [{ k_ar: 'الأطراف', v: '1 e · 2 d · 3 COM · 4 c · 5 DP · 6 b · 7 a · 8 COM · 9 f · 10 g' }, { k_ar: 'Vf', v: '≈ 2.0 V (أحمر)' }, { k_ar: 'أقصى تيار لكل سيجمنت', v: '20 mA' }],
      has3d: false },

    /* ---------------- power / motion ---------------- */
    { type: 'sg90', prefix: 'srv', name_ar: 'موتور سيرفو SG90', name_en: 'SG90 micro servo', category: 'power', kind: 'part', plug: false,
      keywords: ['servo', 'sg90', 'سيرفو', 'موتور', 'motor'], bbox: { x: -2, y: -9, w: 13, h: 8 },
      pins: [{ id: 'GND', label: 'GND', ar: 'السلك البني: الأرضي', x: 0, y: 0, role: 'gnd' }, { id: 'VCC', label: 'VCC', ar: 'السلك الأحمر: 5 فولت', x: 1, y: 0, role: 'in' },
        { id: 'SIG', label: 'SIG', ar: 'السلك البرتقاني: الإشارة (نبضة كل 20 مللي ثانية)', x: 2, y: 0, role: 'in' }],
      internal: [], props: [], controls: [],
      info_ar: 'بيلف لزاوية من 0 لـ180 حسب عرض النبضة اللي بتجيله. استخدموا مكتبة Servo. وهو بيتحرك بيسحب تيار كبير.',
      facts: [{ k_ar: 'الفولت', v: '4.8–6 V' }, { k_ar: 'الزاوية', v: '0–180°' }, { k_ar: 'النبضة', v: '50 Hz · ≈ 0.5–2.4 ms (المكتبة: 544–2400 µs)' }, { k_ar: 'السرعة', v: '0.1 s لكل 60° على 4.8 V' }],
      has3d: false },
    { type: 'relay', prefix: 'rly', name_ar: 'موديول ريليه 5V (قناة واحدة)', name_en: '5V relay module (1 channel)', category: 'power', kind: 'part', plug: false,
      keywords: ['relay', 'ريليه', 'ريلاي', 'مفتاح'], bbox: { x: -1, y: -2, w: 16, h: 10 },
      pins: [{ id: 'VCC', label: 'VCC', ar: '5 فولت (الملف بياخد منه حوالي 70 مللي أمبير)', x: 0, y: 0, role: 'in' }, { id: 'GND', label: 'GND', ar: 'الأرضي', x: 1, y: 0, role: 'gnd' },
        { id: 'IN', label: 'IN', ar: 'إشارة التشغيل من الكارت', x: 2, y: 0, role: 'in' }, { id: 'NO', label: 'NO', ar: 'مفتوح في العادي، بيتقفل لما الريليه يشتغل', x: 14, y: 4, role: 'passive' },
        { id: 'COM', label: 'COM', ar: 'المشترك', x: 14, y: 5, role: 'passive' }, { id: 'NC', label: 'NC', ar: 'مقفول في العادي، بيتفتح لما الريليه يشتغل', x: 14, y: 6, role: 'passive' }],
      internal: [], props: [{ key: 'trigger', type: 'select', label_ar: 'بيشتغل بإيه', default: 'low', options: [{ v: 'low', label_ar: 'بيشتغل بـLOW' }, { v: 'high', label_ar: 'بيشتغل بـHIGH' }] }],
      controls: [],
      info_ar: 'مفتاح بيتحكم فيه الكارت علشان يشغّل حاجة تانية بمصدر كهربا لوحدها. أغلب الموديولات بتشتغل لما IN يبقى LOW. المعمل ما بيحاكيش كهربا البيت خالص.',
      facts: [{ k_ar: 'الملف', v: '5 V · ≈ 70 Ω · ≈ 71 mA (SRD-05VDC)' }, { k_ar: 'أقل فولت يشغّله', v: '3.75 V (75 %)' }, { k_ar: 'الأطراف', v: 'COM · NO · NC' }],
      has3d: false },
    { type: 'bat9v', prefix: 'bat', name_ar: 'بطارية 9V', name_en: '9V battery', category: 'power', kind: 'part', plug: false,
      keywords: ['battery', 'بطارية', 'بطاريه', '9v'], bbox: { x: -1, y: -8, w: 7, h: 9 },
      pins: [{ id: 'P', label: '+', ar: 'الموجب', x: 0, y: 0, role: 'passive' }, { id: 'N', label: '−', ar: 'السالب', x: 2, y: 0, role: 'passive' }],
      internal: [], props: [], controls: [],
      info_ar: 'مصدر كهربا لوحده. لو الدايرة بتاعتها لازم تتقري من الكارت، وصّلوا السالب بتاعها بالـGND بتاع الكارت.',
      facts: [{ k_ar: 'الفولت', v: '9 V' }, { k_ar: 'المقاومة الداخلية', v: '≈ 1.5 Ω (تقريبًا في المحاكي)' }],
      has3d: false }
  ];

  var MODEL_FACTORY = {
    uno: function () { return boardModel('uno'); }, esp32: function () { return boardModel('esp32'); }, nano: function () { return boardModel('nano'); },
    bb400: bbModel, bb830: bbModel,
    led: ledModel, rgb: rgbModel, buzzer: buzzerModel, piezo: piezoModel, lamp: lampModel,
    resistor: resistorModel, button: buttonModel, 'switch': switchModel, pot: potModel,
    ldr: ldrModel, hcsr04: hcsr04Model, dht11: function (d) { return dhtModel(d, false); }, dht22: function (d) { return dhtModel(d, true); },
    pir: pirModel, irobst: irModel, soil: soilModel, lcd1602: lcdModel, seg7: seg7Model,
    sg90: sg90Model, relay: relayModel, bat9v: batModel
  };
  var BY_TYPE = {};
  DEFS.forEach(function (d) {
    d.model = MODEL_FACTORY[d.type](d);
    d.holeMap = null;
    if (d.kind === 'breadboard') {
      var hm = {};
      d.pins.forEach(function (p) { hm[p.x + ',' + p.y] = p.id; });
      d.holeMap = hm;
    }
    var pm = {};
    d.pins.forEach(function (p) { pm[p.id] = p; });
    d.pinMap = pm;
    BY_TYPE[d.type] = d;
  });
  // catalog order: category order, then table order
  var CAT_ORDER = {};
  CATEGORIES.forEach(function (c, i) { CAT_ORDER[c.id] = i; });
  var LIST = DEFS.map(function (d, i) { return { d: d, i: i }; })
    .sort(function (a, b) { return (CAT_ORDER[a.d.category] - CAT_ORDER[b.d.category]) || (a.i - b.i); })
    .map(function (x) { return x.d; });

  /* ------------------------------------------------------------------ */
  /* 10. API (§6.2)                                                        */
  /* ------------------------------------------------------------------ */
  function get(type) { return BY_TYPE[type] || null; }

  function pinWorld(inst, pinId) {
    var d = get(inst.type); if (!d) return null;
    var p = d.pinMap[pinId]; if (!p) return null;
    var r = rotPt(p.x, p.y, inst.rot);
    return { x: r6((+inst.x || 0) + r.x), y: r6((+inst.y || 0) + r.y) };
  }
  function instPins(inst) {
    var d = get(inst.type); if (!d) return [];
    var ox = +inst.x || 0, oy = +inst.y || 0;
    return d.pins.map(function (p) {
      var r = rotPt(p.x, p.y, inst.rot);
      return { ref: inst.id + '.' + p.id, id: p.id, x: r6(ox + r.x), y: r6(oy + r.y), label: p.label, role: p.role };
    });
  }
  function bbox(inst) {
    var d = get(inst.type); if (!d) return { x: +inst.x || 0, y: +inst.y || 0, w: 1, h: 1 };
    var b = d.bbox, cs = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    cs.forEach(function (c) {
      var r = rotPt(c[0], c[1], inst.rot);
      minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x); miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
    });
    return { x: r6((+inst.x || 0) + minx), y: r6((+inst.y || 0) + miny), w: r6(maxx - minx), h: r6(maxy - miny) };
  }
  /** Breadboard hole under a world point (tolerance in u), or null. */
  function holeAt(bbInst, x, y, tol) {
    var d = get(bbInst.type); if (!d || !d.holeMap) return null;
    tol = tol == null ? 0.35 : tol;
    var l = unrotPt(x - (+bbInst.x || 0), y - (+bbInst.y || 0), bbInst.rot);
    var rx = Math.round(l.x), ry = Math.round(l.y);
    if (Math.abs(rx - l.x) > tol || Math.abs(ry - l.y) > tol) return null;
    return d.holeMap[rx + ',' + ry] || null;
  }
  function holeWorld(bbInst, holeId) { return pinWorld(bbInst, holeId); }

  /** Map every pin of a plug part to holes of ONE breadboard, or null (loose part). */
  function pluggedHoles(inst, insts, tol) {
    var d = get(inst.type); if (!d || !d.plug) return null;
    var pins = instPins(inst);
    for (var i = 0; i < insts.length; i++) {
      var bb = insts[i]; if (bb.id === inst.id) continue;
      var bd = get(bb.type); if (!bd || bd.kind !== 'breadboard') continue;
      var map = {}, ok = true;
      for (var j = 0; j < pins.length; j++) {
        var h = holeAt(bb, pins[j].x, pins[j].y, tol == null ? 0.05 : tol);
        if (!h) { ok = false; break; }
        map[pins[j].id] = h;
      }
      if (ok) return { bb: bb.id, holes: map };
    }
    return null;
  }

  /** Holes already used on a breadboard (plugged legs of other parts + wire ends). */
  function occupiedHoles(bbId, insts, wires, exceptId) {
    var occ = {};
    insts.forEach(function (o) {
      if (o.id === exceptId) return;
      var ph = pluggedHoles(o, insts);
      if (ph && ph.bb === bbId) Object.keys(ph.holes).forEach(function (k) { occ[ph.holes[k]] = true; });
    });
    (wires || []).forEach(function (w) {
      [w.a, w.b].forEach(function (r) {
        if (typeof r !== 'string') return;
        var k = r.indexOf('.');
        if (r.slice(0, k) === bbId) occ[r.slice(k + 1)] = true;
      });
    });
    return occ;
  }

  /** §6.2: snap a plug part onto the nearest free holes of one breadboard (|dx|,|dy| <= 0.5 u). */
  function findSnap(inst, insts, wires) {
    var d = get(inst.type); if (!d || !d.plug) return null;
    var pins = instPins(inst); if (!pins.length) return null;
    var p0 = pins[0];
    for (var i = 0; i < insts.length; i++) {
      var bb = insts[i]; if (bb.id === inst.id) continue;
      var bd = get(bb.type); if (!bd || bd.kind !== 'breadboard') continue;
      var l = unrotPt(p0.x - (+bb.x || 0), p0.y - (+bb.y || 0), bb.rot);
      var w = rotPt(Math.round(l.x), Math.round(l.y), bb.rot);
      var dx = r6((+bb.x || 0) + w.x - p0.x), dy = r6((+bb.y || 0) + w.y - p0.y);
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) continue;
      var occ = occupiedHoles(bb.id, insts, wires, inst.id), holes = {}, ok = true;
      for (var j = 0; j < pins.length; j++) {
        var h = holeAt(bb, pins[j].x + dx, pins[j].y + dy, 0.05);
        if (!h || occ[h]) { ok = false; break; }
        holes[pins[j].id] = h;
      }
      if (ok) return { bb: bb.id, dx: dx, dy: dy, holes: holes };
    }
    return null;
  }

  function newId(type, ids) {
    var d = get(type), pre = d ? d.prefix : String(type).toLowerCase().replace(/[^a-z0-9]/g, '') || 'p';
    var used = {};
    (ids || []).forEach(function (x) { used[x] = true; });
    for (var n = 1; n < 100000; n++) if (!used[pre + n]) return pre + n;
    return pre + Date.now();
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /** Converts { on: 'bb1:e5' } placements to x,y (pin[0] on that hole). Returns a new project object. */
  function resolvePlacement(project) {
    var p = clone(project || {}), parts = p.parts || [], byId = {};
    parts.forEach(function (x) { byId[x.id] = x; });
    parts.forEach(function (x) {
      if (typeof x.on !== 'string') return;
      var k = x.on.indexOf(':'), bb = byId[x.on.slice(0, k)], hole = x.on.slice(k + 1);
      if (bb && get(bb.type) && get(bb.type).kind === 'breadboard') {
        var w = holeWorld(bb, hole);
        if (w) {
          var d = get(x.type), p0 = d && d.pins[0] ? rotPt(d.pins[0].x, d.pins[0].y, x.rot) : { x: 0, y: 0 };
          x.x = r6(w.x - p0.x); x.y = r6(w.y - p0.y);
        }
      }
      delete x.on;
    });
    return p;
  }

  var ID_RE = /^[a-z][a-z0-9]{0,11}[0-9]+$/;
  /** §6.2 / §11 project validation. Messages are Arabic (NEW COPY) with LTR ids. */
  function validate(project) {
    var errors = [];
    if (!project || typeof project !== 'object') return { ok: false, errors: ['الملف مش مشروع معمل.'] };
    var parts = Array.isArray(project.parts) ? project.parts : null, wires = Array.isArray(project.wires) ? project.wires : [];
    if (!parts) return { ok: false, errors: ['المشروع مفيهوش قايمة قطع.'] };
    var byId = {}, boards = 0;
    parts.forEach(function (x) {
      if (!x || typeof x !== 'object') { errors.push('فيه قطعة شكلها غلط.'); return; }
      var d = get(x.type);
      if (!d) { errors.push('فيه قطعة مش معروفة: ' + String(x.type)); return; }
      if (typeof x.id !== 'string' || !ID_RE.test(x.id)) { errors.push('اسم القطعة غلط: ' + String(x.id)); return; }
      if (byId[x.id]) { errors.push('الاسم ده متكرر: ' + x.id); return; }
      if (x.on !== undefined && !d.plug) errors.push('القطعة ' + x.id + ' ما بتتركبش في البريدبورد.');
      if (x.on === undefined && (typeof x.x !== 'number' || typeof x.y !== 'number' || !isFinite(x.x) || !isFinite(x.y))) errors.push('مكان القطعة ' + x.id + ' مش متحدد.');
      if (x.rot !== undefined && [0, 90, 180, 270].indexOf(x.rot) < 0) errors.push('لفّة القطعة ' + x.id + ' لازم 0 أو 90 أو 180 أو 270.');
      if (d.kind === 'board') boards++;
      byId[x.id] = x;
    });
    if (boards > 1) errors.push('المعمل بيشتغل بكارت واحد بس.');
    if (errors.length) return { ok: false, errors: errors };
    // geometry checks after resolving `on`
    var rp = resolvePlacement({ parts: parts }), insts = rp.parts;
    var wireIds = {}, pinUse = {}, holeUse = {};
    var plugged = {};
    insts.forEach(function (x) {
      var ph = pluggedHoles(x, insts);
      if (ph) {
        plugged[x.id] = ph;
        Object.keys(ph.holes).forEach(function (pid) {
          var key = ph.bb + '.' + ph.holes[pid];
          if (holeUse[key]) errors.push('الخُرم ' + key + ' عليه أكتر من رجل.');
          holeUse[key] = true;
        });
      }
    });
    wires.forEach(function (w) {
      if (!w || typeof w !== 'object') { errors.push('فيه سلك شكله غلط.'); return; }
      if (typeof w.id !== 'string' || !/^w[0-9]+$/.test(w.id) || wireIds[w.id]) { errors.push('اسم السلك غلط أو متكرر: ' + String(w.id)); return; }
      wireIds[w.id] = true;
      if (w.a === w.b) { errors.push('السلك ' + w.id + ' أوله زي آخره.'); return; }
      [w.a, w.b].forEach(function (r) {
        if (typeof r !== 'string' || r.indexOf('.') < 1) { errors.push('طرف السلك ' + w.id + ' غلط.'); return; }
        var k = r.indexOf('.'), iid = r.slice(0, k), pid = r.slice(k + 1), inst = byId[iid];
        if (!inst || !get(inst.type).pinMap[pid]) { errors.push('طرف السلك ' + w.id + ' مش موجود: ' + r); return; }
        if (pinUse[r]) errors.push('الطرف ' + r + ' عليه أكتر من سلك.');
        pinUse[r] = true;
        if (get(inst.type).kind === 'breadboard') {
          if (holeUse[r]) errors.push('الخُرم ' + r + ' عليه رجل قطعة وسلك مع بعض.');
          holeUse[r] = true;
        }
      });
    });
    return { ok: errors.length === 0, errors: errors };
  }

  /** Internal 0 Ω groups of an instance: def.internal + breadboard strips. (B2 extra) */
  function internalGroups(inst) {
    var d = get(inst.type); if (!d) return [];
    var g = (d.internal || []).slice();
    if (d.kind === 'breadboard') g = g.concat(bbGroups(inst, d));
    return g;
  }

  var Parts = {
    list: function () { return LIST.slice(); },
    get: get,
    categories: CATEGORIES,
    boards: ['uno', 'esp32', 'nano'],
    profile: function (type) { return PROFILES[type] || null; },
    newId: newId,
    pinWorld: pinWorld,
    instPins: instPins,
    bbox: bbox,
    findSnap: findSnap,
    holeAt: holeAt,
    resolvePlacement: resolvePlacement,
    validate: validate,
    // B2 extras (used by circuit.js / board-sim.js; harmless for others)
    internalGroups: internalGroups,
    pluggedHoles: pluggedHoles,
    propOf: function (inst, key) { var d = get(inst.type); return d ? propOf(inst, d, key) : undefined; },
    ctlDefaults: function (type) { var d = get(type); return d ? ctlDefaults(d) : {}; },
    diodeParams: diodeParams,
    ledVf: LED_VF,
    ldrOhms: ldrR,
    lcdChar: romChar,
    rotPt: rotPt,
    mulberry32: mulberry32,
    hashStr: hashStr
  };
  NS.Parts = Parts;
})(typeof window !== 'undefined' ? window : globalThis);
