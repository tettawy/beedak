/* «بإيدك» lab simulator — Arduino C++ interpreter, part 2 of 2 (B1).
 * SPEC-GAP: split — load immediately after interp.js (see the header there).
 *
 * Codegen: AST → closures (pure expressions/statements: `L => value`) and generator functions
 * (anything that may suspend: delay, pulseIn, Serial TX back-pressure, LCD/DHT time, user calls,
 * loops for budget checks). Static C types per board (§7.3): int16 on Uno, int32 on ESP32,
 * float32 double on Uno, usual arithmetic conversions, wrap-around with H_INT_OVERFLOW.
 *
 * Runtime library: Arduino core, String, Serial, Servo/ESP32Servo, Wire, LiquidCrystal_I2C, DHT,
 * WiFi — all as thin wrappers over the IO backend (§5). No eval / new Function anywhere.
 */
(function (root) {
  'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};
  var I = NS.Interp = NS.Interp || {};

  /** Suspension: q = request yielded to the runner, k = continuation applied to the answer. */
  function Susp(q, k) { this.q = q; this.k = k; }
  function isThen(v) { return v != null && typeof v.then === 'function'; }
  function* runS(r) { while (r instanceof Susp) { var x = yield r.q; r = r.k ? r.k(x) : x; } return r; }
  function noop() { }

  /** Array value: flat data `d`, view offset, length of first dim, dims. */
  function CArr(d, off, n, dims, name) { this.d = d; this.off = off; this.n = n; this.dims = dims; this.name = name; }

  /* ------------------------------------------------------------------ */
  /* Types per board (§7.3)                                              */
  /* ------------------------------------------------------------------ */
  function mkTypes(P) {
    var i16 = P.intBits === 16;
    function it(n, bits, sg, rank) { return { k: 'i', n: n, bits: bits, sg: sg, rank: rank, sz: bits / 8 }; }
    var T = {
      void: { k: 'v', n: 'void', sz: 0 },
      bool: { k: 'b', n: 'bool', bits: 8, sg: false, rank: 0, sz: 1 },
      char: it('char', 8, true, 1), int8: it('int8_t', 8, true, 1), uint8: it('byte', 8, false, 1),
      int16: it('short', 16, true, 2), uint16: it('unsigned short', 16, false, 2),
      int: i16 ? it('int', 16, true, 3) : it('int', 32, true, 3),
      uint: i16 ? it('unsigned int', 16, false, 3) : it('unsigned int', 32, false, 3),
      long: it('long', 32, true, 4), ulong: it('unsigned long', 32, false, 4),
      float: { k: 'f', n: 'float', bits: 32, sz: 4 },
      double: { k: 'f', n: 'double', bits: P.doubleBits || 32, sz: (P.doubleBits || 32) / 8 },
      String: { k: 's', n: 'String', sz: i16 ? 6 : 12 },
      cstr: { k: 'c', n: 'const char*', sz: i16 ? 2 : 4 },
      IPAddress: { k: 'ip', n: 'IPAddress', sz: 4 },
      Servo: { k: 'o', n: 'Servo', cls: 'Servo', sz: 1 },
      DHT: { k: 'o', n: 'DHT', cls: 'DHT', sz: 14 },
      LiquidCrystal_I2C: { k: 'o', n: 'LiquidCrystal_I2C', cls: 'LCD', sz: 9 },
      Serial: { k: 'o', n: 'Serial', cls: 'Serial', sz: 0 },
      Wire: { k: 'o', n: 'Wire', cls: 'Wire', sz: 0 },
      WiFi: { k: 'o', n: 'WiFi', cls: 'WiFi', sz: 0 }
    };
    T.char.ch = true;
    return T;
  }
  function isNum(t) { return t.k === 'i' || t.k === 'b' || t.k === 'f'; }
  function isIntT(t) { return t.k === 'i' || t.k === 'b'; }
  function isCharArr(t) { return t.k === 'a' && t.et.k === 'i' && t.et.bits === 8; }
  function isStrish(t) { return t.k === 's' || t.k === 'c' || isCharArr(t); }
  function maxOf(t) { return t.sg ? Math.pow(2, t.bits - 1) - 1 : Math.pow(2, t.bits) - 1; }
  function fits(t, v) { return t.sg ? v >= -Math.pow(2, t.bits - 1) && v <= maxOf(t) : v >= 0 && v <= maxOf(t); }

  /** Value-wrapping function for an integer/bool type (also truncates floats toward zero). */
  function wrapOf(t) {
    if (t.k === 'b') return function (v) { return v === 0 ? 0 : 1; };
    if (t.bits === 8) return t.sg ? function (v) { return (v << 24) >> 24; } : function (v) { return v & 255; };
    if (t.bits === 16) return t.sg ? function (v) { return (v << 16) >> 16; } : function (v) { return v & 0xFFFF; };
    return t.sg ? function (v) { return v | 0; } : function (v) { return v >>> 0; };
  }
  function f32(v) { return Math.fround(v); }
  function frOf(t) { return t.bits === 32 ? f32 : null; }

  /** Read a C string out of a char array (until NUL). */
  function cstrOf(A) {
    var s = '', end = A.off + A.n;
    for (var i = A.off; i < end; i++) { var c = A.d[i] & 255; if (!c) break; s += String.fromCharCode(c); }
    return s;
  }
  /** Conversion function from type a to b: null = identity, undefined = impossible. */
  function convFn(a, b) {
    if (a === b) return null;
    if (b.k === 'b') {
      if (isNum(a)) return function (v) { return v === 0 ? 0 : 1; };
      if (a.k === 's' || a.k === 'c' || a.k === 'o' || a.k === 'a' || a.k === 'ip') return function () { return 1; };
      return undefined;
    }
    if (b.k === 'i') {
      if (!isNum(a)) return undefined;
      if (a.k !== 'f' && (a.k === 'b' || (a.bits < b.bits && (b.sg || !a.sg)) || (a.bits === b.bits && a.sg === b.sg))) return null;
      return wrapOf(b);
    }
    if (b.k === 'f') {
      if (!isNum(a)) return undefined;
      if (b.bits === 64) return null;
      if (a.k === 'f' && a.bits === 32) return null;
      if (a.k !== 'f' && a.bits <= 16) return null;
      return f32;
    }
    if (b.k === 's') {
      if (a.k === 's' || a.k === 'c') return null;
      if (isCharArr(a)) return cstrOf;
      return undefined;
    }
    if (b.k === 'c') {
      if (a.k === 'c') return null;
      if (isCharArr(a)) return cstrOf;
      return undefined;
    }
    if (b.k === 'ip') return a.k === 'ip' ? null : undefined;
    if (b.k === 'o') return a.k === 'o' && a.cls === b.cls ? null : undefined;
    return undefined;
  }

  /* ------------------------------------------------------------------ */
  /* Number formatting (Arduino Print, String, printf)                   */
  /* ------------------------------------------------------------------ */
  /** Print::printNumber/print(long, base) semantics. */
  function fmtInt(t, v, base) {
    if (base === 0) return String.fromCharCode(v & 255);
    if (!(base >= 2)) base = 10;
    if (base === 10) return String(v);
    return (v >>> 0).toString(base).toUpperCase();   // print(int, HEX) widens to long: 32-bit two's complement
  }
  /** Print::printFloat (exact algorithm; on Uno every step is float32). */
  function printFloat(v, digits, dbl32) {
    var fr = dbl32 ? f32 : function (x) { return x; };
    if (v !== v) return 'nan';
    if (v === Infinity || v === -Infinity) return 'inf';
    if (v > 4294967040.0 || v < -4294967040.0) return 'ovf';
    var out = '';
    if (v < 0) { out = '-'; v = -v; }
    if (!(digits >= 0)) digits = 2;
    digits = Math.min(digits | 0, 20);
    var rounding = fr(0.5);
    for (var i = 0; i < digits; i++) rounding = fr(rounding / 10.0);
    v = fr(v + rounding);
    var ip = Math.floor(v) >>> 0;
    var rem = fr(v - ip);
    out += String(ip);
    if (digits > 0) out += '.';
    while (digits-- > 0) {
      rem = fr(rem * 10.0);
      var d = Math.floor(rem) >>> 0;
      out += String(d);
      rem = fr(rem - d);
    }
    return out;
  }
  /** dtostrf(val, width, prec) — also used by String(float, dec). */
  function dtostrf(v, width, prec) {
    var s;
    if (v !== v) s = 'nan'; else if (v === Infinity) s = 'inf'; else if (v === -Infinity) s = '-inf';
    else s = (Math.round(Math.abs(v) * Math.pow(10, prec)) / Math.pow(10, prec)).toFixed(Math.max(0, Math.min(prec, 20)));
    if (v < 0 && s.charAt(0) !== '-' && /[1-9]/.test(s)) s = '-' + s;
    var w = Math.abs(width | 0);
    while (s.length < w) s = width < 0 ? s + ' ' : ' ' + s;
    return s;
  }
  /** Value → bytes the way String concat()/String(x) does it. */
  function strOf(t, v, R) {
    switch (t.k) {
      case 's': case 'c': case 'ip': return v;
      case 'b': return v ? '1' : '0';
      case 'i': if (t.ch) return String.fromCharCode(v & 255); return String(v);
      case 'f': return dtostrf(v, 4, 2);
      case 'a': return isCharArr(t) ? cstrOf(v) : '';
    }
    return '';
  }
  /** printf/sprintf subset: %d %i %u %ld %lu %x %X %o %c %s %f %.Nf %e %g %% with width/flags. */
  function cfmt(fmt, vals, types, avr, onFloat) {
    var out = '', ai = 0, i = 0;
    function nextArg() { var k = ai++; return k < vals.length ? { v: vals[k], t: types[k] } : { v: 0, t: null }; }
    while (i < fmt.length) {
      var c = fmt[i];
      if (c !== '%') { out += c; i++; continue; }
      var m = /^%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|z|j|t|L)?([diuxXoceEfgGs%p])/.exec(fmt.slice(i));
      if (!m) { out += c; i++; continue; }
      i += m[0].length;
      var flags = m[1], width = m[2], prec = m[3], len = m[4] || '', conv = m[5];
      if (conv === '%') { out += '%'; continue; }
      if (width === '*') width = nextArg().v | 0; else width = width ? parseInt(width, 10) : 0;
      if (prec === '*') prec = nextArg().v | 0; else prec = prec != null ? parseInt(prec, 10) : null;
      var a = nextArg(), s = '', v = a.v, sign = '';
      var left = flags.indexOf('-') >= 0 || width < 0, zero = flags.indexOf('0') >= 0 && !left;
      width = Math.abs(width);
      var isStr = a.t && (a.t.k === 's' || a.t.k === 'c' || a.t.k === 'a' || a.t.k === 'ip');
      if (a.t && a.t.k === 'a') v = cstrOf(v);
      switch (conv) {
        case 'd': case 'i': {
          var n = isStr ? 0 : Math.trunc(Number(v) || 0);
          n = avr && !/l/.test(len) ? ((n << 16) >> 16) : (n | 0);
          if (n < 0) { sign = '-'; n = -n; } else if (flags.indexOf('+') >= 0) sign = '+'; else if (flags.indexOf(' ') >= 0) sign = ' ';
          s = String(n); if (prec != null) { while (s.length < prec) s = '0' + s; zero = false; }
          break;
        }
        case 'u': case 'x': case 'X': case 'o': {
          var u = isStr ? 0 : Math.trunc(Number(v) || 0);
          u = avr && !/l/.test(len) ? (u & 0xFFFF) : (u >>> 0);
          s = u.toString(conv === 'u' ? 10 : conv === 'o' ? 8 : 16);
          if (conv === 'X') s = s.toUpperCase();
          if (flags.indexOf('#') >= 0 && u !== 0) s = (conv === 'o' ? '0' : conv === 'x' ? '0x' : conv === 'X' ? '0X' : '') + s;
          if (prec != null) { while (s.length < prec) s = '0' + s; zero = false; }
          break;
        }
        case 'c': s = String.fromCharCode((Number(v) || 0) & 255); zero = false; break;
        case 's': s = isStr ? String(v) : ''; if (prec != null) s = s.slice(0, prec); zero = false; break;
        case 'p': s = '0x0'; break;
        default: { // f e E g G
          if (avr) { s = '?'; zero = false; if (onFloat) onFloat(); break; }
          var f = Number(v); if (isStr) f = 0;
          var p = prec == null ? 6 : prec;
          if (f !== f) s = 'nan'; else if (!isFinite(f)) s = 'inf';
          else {
            if (f < 0 || (f === 0 && 1 / f < 0)) { sign = '-'; f = -f; } else if (flags.indexOf('+') >= 0) sign = '+'; else if (flags.indexOf(' ') >= 0) sign = ' ';
            if (conv === 'f') s = f.toFixed(Math.min(p, 20));
            else if (conv === 'e' || conv === 'E') s = expFix(f.toExponential(Math.min(p, 20)));
            else {
              var P2 = p === 0 ? 1 : p, ex = f === 0 ? 0 : Math.floor(Math.log10(f));
              if (ex < -4 || ex >= P2) s = expFix(f.toExponential(P2 - 1)); else s = f.toFixed(Math.max(0, P2 - 1 - ex));
              if (flags.indexOf('#') < 0 && s.indexOf('.') >= 0) s = s.replace(/(\.\d*?)0+(e|$)/, '$1$2').replace(/\.(e|$)/, '$1');
            }
            if (conv === 'E' || conv === 'G') s = s.toUpperCase();
          }
        }
      }
      var body = sign + s;
      if (body.length < width) {
        if (left) while (body.length < width) body += ' ';
        else if (zero) { while (s.length + sign.length < width) s = '0' + s; body = sign + s; }
        else while (body.length < width) body = ' ' + body;
      }
      out += body;
    }
    return out;
  }
  function expFix(s) { return s.replace(/e([+-])(\d)$/, 'e$10$2'); }
  /** C atol/atof prefix parsing. */
  function atol(s) {
    var m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(s);
    return m ? (Number(m[1]) | 0) : 0;
  }
  function atof(s) {
    var m = /^[ \t\n\v\f\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(s);
    return m ? parseFloat(m[1]) : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Runtime object: one per runner start                                */
  /* ------------------------------------------------------------------ */
  var ZERO_COST = { stmt: 0, call: 0, digitalWrite: 0, digitalRead: 0, pinMode: 0, analogRead: 0, analogWrite: 0 };
  var NULL_IO = {
    kind: 'sim', timeMode: 'virtual', supports: function () { return true; }, reset: noop, setClock: noop, setInterruptSink: noop,
    nextEventUs: function () { return Infinity; }, tick: noop
  };

  function newRuntime(P, io, wall, hooks) {
    var R = {
      P: P, io: io || NULL_IO, wall: !!wall,
      now: 0, steps: 0, yS: 0, yT: Infinity, t0: 0,
      G: [], F: [], isrLine: [], isrQ: [], intOn: true, inIsr: false, depth: 0, ret: undefined, lo: null, mstr: '',
      once: new Set(), touched: new Map(),
      rxCap: P.intBits === 16 ? 64 : 256,
      ser: { begun: false, baud: 9600, byteUs: 1e7 / 9600, tx: '', txStart: 0, rx: '', timeout: 1000, dec: '' },
      rnd: 0, adcBits: P.adcBits, pwmBits: P.pwmBits, modes: {}, servos: 0, toneUsed: false, tone: null,
      ledc: {}, ledcCh: {}, wire: { addr: -1 }, wifiSsid: '',
      cost: wall ? ZERO_COST : (P.timeCost || ZERO_COST),
      emit: hooks && hooks.emit || noop,
      out: hooks && hooks.out || noop,
      dbl32: (P.doubleBits || 32) === 32
    };
    R.tnow = wall ? function () { return (I._nowMs() - R.t0) * 1000; } : function () { return R.now; };
    R.site = function (site) { return site || { line: 0, col: 0, key: '?' }; };
    R.msg = function (code, vars, site) { site = R.site(site); R.emit(I._mkMsg(code, vars, site.line, site.col)); };
    R.hintOnce = function (code, key, vars, site) {
      var k = code + '@' + key;
      if (R.once.has(k)) return;
      R.once.add(k);
      R.msg(code, vars, site);
    };
    /* String heap (sim realism): a String that would outgrow the board's free heap stays as it was, like a failed
       realloc on the real board (Uno/Nano: about 1.5 KB free; ESP32: about 110 KB in one block). */
    R.strMax = P.sramBytes > 0 ? Math.max(256, P.sramBytes - 548) : 110000;
    R.strFit = function (old, nu, site) {
      if (nu.length <= R.strMax || nu.length <= old.length) return nu;
      R.hintOnce('W_STR_MEM', 'mem', { n: R.strMax }, site);
      return old;
    };
    R.err = function (code, vars, site) { site = R.site(site); return new I._RtErr(code, vars, site.line, site.col); };
    /** io result may be a thenable on the real board: suspend until it settles. */
    R.aw = function (v, k) { if (isThen(v)) return new Susp({ t: 'await', promise: v }, k); return k(v); };
    R.touch = function (pin, how) { var k = pin + ':' + how; if (!R.touched.has(k)) R.touched.set(k, { pin: pin, how: how }); };
    R.flushTx = function (upTo) {
      var s = R.ser;
      if (!s.tx.length) return;
      var k = upTo === Infinity ? s.tx.length : Math.min(s.tx.length, Math.floor((upTo - s.txStart) / s.byteUs + 1e-9));
      if (k <= 0) return;
      var bytes = s.tx.slice(0, k);
      s.tx = s.tx.slice(k);
      s.txStart += k * s.byteUs;
      var d = I._utf8decode(s.dec + bytes, false);
      s.dec = d.rest;
      if (d.text) R.out(d.text, s.baud);
    };
    /** Serial TX with the 64-byte buffer and baud-rate timing (§7.4). */
    R.serWrite = function (bytes, site) {
      var s = R.ser;
      if (!s.begun) { R.hintOnce('H_NO_SERIAL_BEGIN', 'serial', {}, site); return 0; }
      if (R.inIsr) R.hintOnce('H_SERIAL_IN_ISR', site ? site.key : 'isr', {}, site);
      var n = bytes.length;
      if (!n) return 0;
      if (R.wall) {
        var d = I._utf8decode(s.dec + bytes, false); s.dec = d.rest;
        if (d.text) R.out(d.text, s.baud);
        return n;
      }
      R.flushTx(R.now);
      if (!s.tx.length) s.txStart = Math.max(R.now, s.txStart);
      s.tx += bytes;
      var over = s.tx.length - 64;
      if (over > 0 && !R.inIsr) {
        return new Susp({ t: 'sleep', until: s.txStart + over * s.byteUs }, function () { return n; });
      }
      return n;
    };
    return R;
  }
  I._newRuntime = newRuntime;

  /* ------------------------------------------------------------------ */
  /* Pin checks (§7.8). Same code at compile time (constants) and run time. */
  /* ------------------------------------------------------------------ */
  function pinLabel(P, p) {
    if (P.board !== 'esp32' && P.pinIds && P.pinIds[p] && P.pinIds[p].charAt(0) === 'A') return P.pinIds[p];
    return String(p);
  }
  function has(arr, v) { return Array.isArray(arr) && arr.indexOf(v) >= 0; }
  /**
   * kind: 'din' | 'dout' | 'ain' | 'pwm' | 'dac'. Returns {pin, code?, vars?, hint?, hvars?, digital?}.
   */
  function checkPin(P, kind, p) {
    p = Math.trunc(Number(p));
    var r = { pin: p }, lbl = pinLabel(P, p);
    var isDig = has(P.digitalPins, p), aOnly = has(P.analogOnlyPins, p);
    if (kind === 'ain') {
      if (P.board !== 'esp32' && p >= 0 && p < P.adcPins.length) { r.hint = 'H_ANALOG_CHANNEL'; r.hvars = { n: p }; p = r.pin = P.adcPins[p]; }
      if (!has(P.adcPins, p)) { r.code = isDig || aOnly ? 'E_NOT_ADC' : 'E_BAD_PIN'; r.vars = { pin: lbl, board: P.name }; }
      return r;
    }
    if (kind === 'dac') {
      if (!(p === 25 || p === 26)) { r.code = 'E_NOT_DAC'; r.vars = { pin: lbl }; }
      return r;
    }
    if (!isDig) { r.code = 'E_BAD_PIN'; r.vars = { pin: lbl, board: P.name }; return r; }
    if ((kind === 'dout' || kind === 'pwm') && has(P.inputOnlyPins, p)) { r.code = 'E_INPUT_ONLY'; r.vars = { pin: lbl }; return r; }
    if (kind === 'pwm' && Array.isArray(P.pwmPins) && !has(P.pwmPins, p)) { r.hint = 'H_NOT_PWM'; r.hvars = { pin: lbl }; r.digital = true; }
    return r;
  }
  /** Mode checks for pinMode. */
  function checkMode(P, p, mode) {
    if (mode === 3 && !P.hasPulldown) return { code: 'E_NO_PULLDOWN', vars: {} };
    if (mode === 1 && has(P.inputOnlyPins, p)) return { code: 'E_INPUT_ONLY', vars: { pin: pinLabel(P, p) } };
    if ((mode === 2 || mode === 3) && has(P.noPullPins, p)) return { code: 'W_NO_PULL', vars: { pin: pinLabel(P, p) } };
    return null;
  }
  var MODE_HOW = ['INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN'];
  /** Runtime pin check: emits once per call site, returns pin or -1. */
  function rtPin(R, kind, p, site) {
    var r = checkPin(R.P, kind, p);
    if (r.code) { R.hintOnce(r.code, site.key, r.vars, site); return -1; }
    if (r.hint) R.hintOnce(r.hint, site.key, r.hvars, site);
    if (r.digital) return -2 - r.pin; // encoded: non-PWM Uno pin (digital fallback)
    return r.pin;
  }
  function intPin(P, num) {
    // interrupt number → pin
    if (P.interruptPins === 'all') return has(P.digitalPins, num) ? num : -1;
    for (var k in P.interruptPins) if (P.interruptPins[k] === num) return +k;
    return -1;
  }

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  var CONSTS = {
    HIGH: ['int', 1], LOW: ['int', 0], INPUT: ['int', 0], OUTPUT: ['int', 1], INPUT_PULLUP: ['int', 2], INPUT_PULLDOWN: ['int', 3],
    CHANGE: ['int', 1], FALLING: ['int', 2], RISING: ['int', 3],
    DEC: ['int', 10], HEX: ['int', 16], OCT: ['int', 8], BIN: ['int', 2],
    PI: ['double', 3.1415926535897932384626433832795], HALF_PI: ['double', 1.5707963267948966192313216916398],
    TWO_PI: ['double', 6.283185307179586476925286766559], DEG_TO_RAD: ['double', 0.017453292519943295769236907684886],
    RAD_TO_DEG: ['double', 57.295779513082320876798154814105], EULER: ['double', 2.718281828459045235360287471352],
    NULL: ['int', 0], LSBFIRST: ['int', 0], MSBFIRST: ['int', 1], SERIAL_8N1: ['int', 6],
    NAN: ['float', NaN], INFINITY: ['float', Infinity],
    DEFAULT: ['int', 1, 'avr'], INTERNAL: ['int', 3, 'avr'], EXTERNAL: ['int', 0, 'avr']
  };
  var LIB_CONSTS = {
    DHT11: ['int', 11, 'DHT.h'], DHT12: ['int', 12, 'DHT.h'], DHT21: ['int', 21, 'DHT.h'], DHT22: ['int', 22, 'DHT.h'], AM2301: ['int', 21, 'DHT.h'],
    WL_IDLE_STATUS: ['int', 0, 'WiFi.h'], WL_NO_SSID_AVAIL: ['int', 1, 'WiFi.h'], WL_SCAN_COMPLETED: ['int', 2, 'WiFi.h'], WL_CONNECTED: ['int', 3, 'WiFi.h'],
    WL_CONNECT_FAILED: ['int', 4, 'WiFi.h'], WL_CONNECTION_LOST: ['int', 5, 'WiFi.h'], WL_DISCONNECTED: ['int', 6, 'WiFi.h'], WL_NO_SHIELD: ['int', 255, 'WiFi.h'],
    WIFI_OFF: ['int', 0, 'WiFi.h'], WIFI_STA: ['int', 1, 'WiFi.h'], WIFI_AP: ['int', 2, 'WiFi.h'], WIFI_AP_STA: ['int', 3, 'WiFi.h'],
    MIN_PULSE_WIDTH: ['int', 544, 'SERVO'], MAX_PULSE_WIDTH: ['int', 2400, 'SERVO'], DEFAULT_PULSE_WIDTH: ['int', 1500, 'SERVO']
  };
  var NET_IDS = { WiFiClient: 1, HTTPClient: 1, WebServer: 1, WiFiServer: 1, WiFiUDP: 1, ESP8266WiFi: 1 };

  /* ------------------------------------------------------------------ */
  /* Codegen                                                             */
  /* ------------------------------------------------------------------ */
  /**
   * codegen(ast, profile, R|null, {msgs}) → { main, features, pinsUsed, globalsBytes }
   * R null = compile-only (uses a throwaway runtime, collects messages into opt.msgs).
   */
  function codegen(ast, P, Rin, opt) {
    var CErr = I._CErr, RtErr = I._RtErr, mkMsg = I._mkMsg, AR = I._AR, YB = I._YB;
    var compileOnly = !Rin;
    var R = Rin || newRuntime(P, null, false, null);
    var wall = R.wall;
    var T = mkTypes(P);
    var msgs = opt && opt.msgs;
    var avr = P.board !== 'esp32';
    var cs = R.cost.stmt || 0, cc = R.cost.call || 0;
    var G = R.G;
    var features = {}, pinsUsed = [], pinKeys = {};
    var includes = {};
    var serialPinUse = null;
    var nErrors = 0;

    // ---- messages
    function site(n) { return { line: n ? n.line : 0, col: n ? n.col : 0, key: n ? n.line + ':' + n.col : '0' }; }
    function fail(code, vars, n) { throw new CErr(code, vars || {}, n ? n.line : 0, n ? n.col : 0); }
    function note(code, vars, n) { if (msgs) msgs.push(mkMsg(code, vars, n ? n.line : 0, n ? n.col : 0)); }
    function record(e) {
      if (!(e instanceof CErr)) throw e;
      nErrors++;
      if (msgs) msgs.push(mkMsg(e.code, e.vars, e.line, e.col));
      if (nErrors > 40) throw e;
    }
    // runtime messages raised while folding constants at compile time become compile messages
    var savedEmit = R.emit;
    R.emit = function (m) { if (msgs) msgs.push(m); };

    // ---- includes
    var libs = P.libs || [];
    (ast.includes || []).forEach(function (inc) {
      var h = inc.h;
      if (libs.indexOf(h) >= 0) { includes[h] = true; return; }
      if (h === 'Servo.h' && P.board === 'esp32') { record(new CErr('E_SERVO_ESP32', {}, inc.line, inc.col)); return; }
      record(new CErr('E_LIB_UNKNOWN', { h: h, board: P.name, list: libs.join('، ') }, inc.line, inc.col));
    });
    var servoH = P.board === 'esp32' ? 'ESP32Servo.h' : 'Servo.h';
    function needInc(cls, h, n, alt) {
      if (includes[h] || (alt && includes[alt])) return;
      fail('E_LIB_INCLUDE', { cls: cls, h: h }, n);
    }
    function feat(f) { features[f] = true; }
    function usePin(pin, how, n) {
      var k = pin + ':' + how;
      if (!pinKeys[k]) { pinKeys[k] = 1; pinsUsed.push({ pin: pin, how: how }); }
      if (has(P.serialPins, pin) && !serialPinUse) serialPinUse = n;
    }

    // ---- scopes and symbols
    var scopes = [Object.create(null)];
    var funcs = Object.create(null), funcList = [];
    var fnCtx = null;            // current function {ns, ret, name}
    var loopDepth = 0, brkDepth = 0;
    var symId = 0;
    function lookup(name) {
      for (var i = scopes.length - 1; i >= 0; i--) if (scopes[i][name]) return scopes[i][name];
      return null;
    }
    function declare(name, sym, n) {
      var top = scopes[scopes.length - 1];
      if (top[name] || (scopes.length === 1 && funcs[name])) fail('E_REDECL', { name: name }, n);
      sym.id = ++symId; sym.name = name; sym.line = n.line;
      top[name] = sym;
      return sym;
    }

    // ---- compiled expression helpers
    function K(t, v) { return { t: t, pure: true, isK: true, cv: v, ev: function () { return v; } }; }
    function G_(E) {
      if (E.gen) return E.gen;
      var ev = E.ev;
      return (E.gen2 = E.gen2 || function* (L) { return ev(L); });
    }
    /** Fold a pure E whose inputs are all constants. */
    function fold(E, inputs, n) {
      if (!E.pure) return E;
      for (var i = 0; i < inputs.length; i++) if (!inputs[i].isK) return E;
      try { return K(E.t, E.ev(null)); } catch (e) {
        if (e instanceof RtErr) fail(e.code, e.vars, n);
        throw e;
      }
    }
    function map1(E, fn, t, n) {
      if (!fn) return E.t === t ? E : { t: t, pure: E.pure, ev: E.ev, gen: E.gen, isK: E.isK, cv: E.cv, lit: E.lit };
      var R2;
      if (E.pure) { var ev = E.ev; R2 = { t: t, pure: true, ev: function (L) { return fn(ev(L)); } }; return fold(R2, [E], n); }
      var g = E.gen;
      return { t: t, pure: false, gen: function* (L) { return fn(yield* g(L)); } };
    }
    function bin(a, b, fn, t, n) {
      if (a.pure && b.pure) {
        var ea = a.ev, eb = b.ev;
        return fold({ t: t, pure: true, ev: function (L) { return fn(ea(L), eb(L)); } }, [a, b], n);
      }
      var ga = G_(a), gb = G_(b);
      return { t: t, pure: false, gen: function* (L) { var x = yield* ga(L); var y = yield* gb(L); return fn(x, y); } };
    }
    function cvt(E, to, n) {
      if (E.t === to) return E;
      if (E.t.k === 'v') fail('E_TYPE', { from: 'void', to: to.n }, n);
      var fn = convFn(E.t, to);
      if (fn === undefined) fail('E_TYPE', { from: E.t.n, to: to.n }, n);
      return map1(E, fn, to, n);
    }
    function toBool(E, n) { return cvt(E, T.bool, n); }
    function promote(t) {
      if (t.k === 'f') return t;
      if (t.k === 'b' || (t.k === 'i' && t.rank < 3)) return (t.bits < T.int.bits || t.sg) ? T.int : (t.bits === T.int.bits ? T.uint : T.int);
      return t;
    }
    function usual(a, b) {
      if (a.k === 'f' || b.k === 'f') {
        if (a.k === 'f' && b.k === 'f') return a.bits >= b.bits ? a : b;
        return a.k === 'f' ? a : b;
      }
      var pa = promote(a), pb = promote(b);
      if (pa === pb) return pa;
      if (pa.sg === pb.sg) return pa.rank >= pb.rank ? pa : pb;
      var u = pa.sg ? pb : pa, s = pa.sg ? pa : pb;
      if (u.rank >= s.rank) return u;
      if (s.bits > u.bits) return s;
      return s === T.long ? T.ulong : T.uint;
    }
    function needNum(E, n) { if (!isNum(E.t)) fail('E_TYPE', { from: E.t.n, to: 'int' }, n); return E; }
    function needInt(E, n) { if (!isIntT(E.t)) fail('E_TYPE', { from: E.t.n, to: 'int' }, n); return E; }

    /** Arithmetic on values already converted to type rt. Returns fn(x, y). */
    function arithFn(op, rt, n) {
      var st = site(n);
      if (rt.k === 'f') {
        var fr = rt.bits === 32 ? f32 : null;
        switch (op) {
          case '+': return fr ? function (x, y) { return fr(x + y); } : function (x, y) { return x + y; };
          case '-': return fr ? function (x, y) { return fr(x - y); } : function (x, y) { return x - y; };
          case '*': return fr ? function (x, y) { return fr(x * y); } : function (x, y) { return x * y; };
          case '/': return fr ? function (x, y) { return fr(x / y); } : function (x, y) { return x / y; };
          default: fail('E_UNSUPPORTED', { what: op + ' مع float (استخدموا fmod أو int)' }, n); // NEW COPY fragment
        }
      }
      var w = wrapOf(rt), sg = rt.sg, max = maxOf(rt);
      function ovf(r) {
        var v = w(r);
        if (v !== r && sg) R.hintOnce('H_INT_OVERFLOW', st.key, { type: rt.n, max: max }, st);
        return v;
      }
      switch (op) {
        case '+': return function (x, y) { return ovf(x + y); };
        case '-': return function (x, y) { return ovf(x - y); };
        case '*':
          if (rt.bits === 32) return function (x, y) {
            var r = x * y, v = sg ? Math.imul(x, y) : (Math.imul(x, y) >>> 0);
            if (v !== r && sg) R.hintOnce('H_INT_OVERFLOW', st.key, { type: rt.n, max: max }, st);
            return v;
          };
          return function (x, y) { return ovf(x * y); };
        case '/': return function (x, y) { if (y === 0) throw R.err('E_DIV_ZERO', {}, st); return w(Math.trunc(x / y)); };
        case '%': return function (x, y) { if (y === 0) throw R.err('E_DIV_ZERO', {}, st); return w(x % y); };
        case '&': return function (x, y) { return w(x & y); };
        case '|': return function (x, y) { return w(x | y); };
        case '^': return function (x, y) { return w(x ^ y); };
        case '<<': { var m = rt.bits - 1; return function (x, y) { return w(x << (y & m)); }; }
        case '>>': { var m2 = rt.bits - 1; return sg ? function (x, y) { return x >> (y & m2); } : function (x, y) { return w(x >>> (y & m2)); }; }
      }
      fail('E_SYNTAX', { expected: AR.expr, found: op }, n);
    }

    // ---- expressions
    function ex(n) {
      switch (n.T) {
        case 'Num': return exNum(n);
        case 'Chr': return K(T.char, (n.v << 24) >> 24);
        case 'Str': { var e = K(T.cstr, n.v); e.lit = true; return e; }
        case 'Bool': return K(T.bool, n.v);
        case 'Id': return exId(n);
        case 'Bin': return exBin(n);
        case 'Log': return exLog(n);
        case 'Un': return exUn(n);
        case 'Pre': case 'Post': return exInc(n);
        case 'Asg': return exAsg(n);
        case 'Tern': return exTern(n);
        case 'Call': return exCall(n);
        case 'MCall': return exMCall(n);
        case 'SCall': return exSCall(n);
        case 'Idx': return exIdx(n);
        case 'Mem': fail('E_NO_MEMBER', { obj: nodeName(n.o), member: n.name, board: P.name }, n); break;
        case 'Scope': fail('E_UNSUPPORTED', { what: n.cls + '::' + n.name }, n); break;
        case 'Cast': return exCast(n.spec, n.a, n);
        case 'Ctor': return exCtor(n);
        case 'Sizeof': return exSizeof(n);
        case 'Comma': {
          var parts = n.list.map(ex), last = parts[parts.length - 1];
          if (parts.every(function (p) { return p.pure; })) {
            var evs = parts.map(function (p) { return p.ev; });
            return { t: last.t, pure: true, ev: function (L) { var v; for (var i = 0; i < evs.length; i++) v = evs[i](L); return v; } };
          }
          var gs = parts.map(G_);
          return { t: last.t, pure: false, gen: function* (L) { var v; for (var i = 0; i < gs.length; i++) v = yield* gs[i](L); return v; } };
        }
        case 'Init': fail('E_SYNTAX', { expected: AR.expr, found: '{' }, n); break;
      }
      fail('E_SYNTAX', { expected: AR.expr, found: n.T }, n);
    }
    function nodeName(n) { return n.T === 'Id' ? n.name : n.T === 'Mem' ? nodeName(n.o) + '.' + n.name : '…'; }

    function exNum(n) {
      if (n.ty === 'double') return K(T.double, T.double.bits === 32 ? f32(n.v) : n.v);
      if (n.ty === 'float') return K(T.float, f32(n.v));
      var l = n.lit || { dec: true }, v = n.v, cands;
      if (l.u) cands = l.l ? [T.ulong] : [T.uint, T.ulong];
      else if (l.dec) cands = l.l ? [T.long, T.ulong] : [T.int, T.long, T.ulong];
      else cands = l.l ? [T.long, T.ulong] : [T.int, T.uint, T.long, T.ulong];
      for (var i = 0; i < cands.length; i++) if (fits(cands[i], v)) return K(cands[i], v);
      return K(T.ulong, v >>> 0);
    }

    function constE(name, n) {
      var c = CONSTS[name];
      if (c) {
        if (c[2] === 'avr' && !avr) return null;
        if (name === 'INPUT_PULLDOWN' && !P.hasPulldown) return K(T.int, 3); // checked in pinMode (E_NO_PULLDOWN)
        return K(T[c[0]], c[0] === 'double' && T.double.bits === 32 ? f32(c[1]) : c[0] === 'float' ? f32(c[1]) : c[1]);
      }
      if (P.constants && P.constants[name] != null) return K(name === 'LED_BUILTIN' ? T.int : T.uint8, P.constants[name]);
      var lc = LIB_CONSTS[name];
      if (lc) {
        if (lc[2] === 'SERVO') needInc('Servo', servoH, n); else if (lc[2] === 'WiFi.h') needInc(name, 'WiFi.h', n); else needInc(name, lc[2], n);
        return K(T[lc[0]], lc[1]);
      }
      var m = /^B([01]{1,8})$/.exec(name);
      if (m) return K(T.int, parseInt(m[1], 2));
      return null;
    }

    function exId(n) {
      var s = lookup(n.name);
      if (s) return loadSym(s, n);
      var c = constE(n.name, n);
      if (c) return c;
      if (n.name === 'Serial') { feat('serial'); return K(T.Serial, R.ser); }
      if (n.name === 'Wire') { needInc('Wire', 'Wire.h', n, 'LiquidCrystal_I2C.h'); feat('wire'); return K(T.Wire, R.wire); }
      if (n.name === 'WiFi') { if (!P.hasWiFi) fail('E_LIB_UNKNOWN', { h: 'WiFi.h', board: P.name, list: libs.join('، ') }, n); needInc('WiFi', 'WiFi.h', n); feat('wifi'); return K(T.WiFi, null); }
      if (funcs[n.name]) fail('E_UNSUPPORTED', { what: 'function pointers (' + n.name + ')' }, n);
      if (NET_IDS[n.name]) fail('E_UNSUPPORTED', { what: n.name + ' (' + AR.noNet + ')' }, n);
      fail('E_UNDECLARED', { name: n.name }, n);
    }

    function loadSym(s, n) {
      if (s.kind === 'const' || s.cv !== undefined) return K(s.t, s.cv);
      var k = s.slot;
      if (s.glob) return { t: s.t, pure: true, ev: function () { return G[k]; }, sym: s };
      if (s.ref) return { t: s.t, pure: true, ev: function (L) { var r = L[k]; return r.o[r.k]; }, sym: s };
      if (s.t.k === 'i' || s.t.k === 'b' || s.t.k === 'f') {
        var st = site(n), nm = s.name, id = s.id;
        return {
          t: s.t, pure: true, sym: s,
          ev: function (L) { var v = L[k]; if (v === undefined) { R.hintOnce('H_UNINIT', 'v' + id, { name: nm }, st); return 0; } return v; }
        };
      }
      return { t: s.t, pure: true, ev: function (L) { return L[k]; }, sym: s };
    }

    /**
     * Lvalue: {t, sym, pure, at(L) → key (sets R.lo = container), atg (generator, if impure)}.
     */
    function mkLV(n) {
      if (n.T === 'Id') {
        var s = lookup(n.name);
        if (!s) { if (constE(n.name, n)) fail('E_CONST', { name: n.name }, n); fail('E_UNDECLARED', { name: n.name }, n); }
        if (s.kind === 'const' || s.isConst) fail('E_CONST', { name: n.name }, n);
        if (s.t.k === 'a') fail('E_TYPE', { from: 'array', to: n.name }, n);
        var k = s.slot, uninit = !s.glob && !s.ref ? 0 : null;
        if (s.glob) return { t: s.t, sym: s, pure: true, at: function () { R.lo = G; return k; } };
        if (s.ref) return { t: s.t, sym: s, pure: true, at: function (L) { var r = L[k]; R.lo = r.o; return r.k; } };
        return { t: s.t, sym: s, pure: true, local: true, at: function (L) { R.lo = L; return k; } };
      }
      if (n.T === 'Idx') {
        var el = exIdx(n);
        if (!el.lvAt && !el.lvAtg) fail('E_TYPE', { from: el.t.n, to: '=' }, n);
        if (el.constArr) fail('E_CONST', { name: el.constArr }, n);
        return { t: el.t, pure: el.pure, at: el.lvAt, atg: el.lvAtg };
      }
      fail('E_SYNTAX', { expected: 'متغير', found: '=' }, n); // NEW COPY fragment ("a variable")
    }
    function* lvAtGen(lv, L) { if (lv.pure) return lv.at(L); return yield* lv.atg(L); }
    function readLv(o, k, t) { var v = o[k]; return v === undefined ? (t.k === 's' ? '' : 0) : v; }

    function exBin(n) {
      var op = n.op, a = ex(n.a), b = ex(n.b);
      if (a.t.k === 'v' || b.t.k === 'v') fail('E_TYPE', { from: 'void', to: op }, n);
      // String / pointer arithmetic
      if (op === '+' && (a.t.k === 's' || b.t.k === 's')) return strCat(a, b, n);
      if ((op === '+' || op === '-') && (a.t.k === 'c' || isCharArr(a.t)) && isIntT(b.t)) {
        if (op === '-') fail('E_UNSUPPORTED', { what: AR.pointers }, n);
        if (a.lit) R.hintOnce('H_PTR_ADD', site(n).key, {}, site(n));
        var ca = cvt(a, T.cstr, n);
        return bin(ca, b, function (s, i) { return i < 0 || i > s.length ? '' : s.slice(i); }, T.cstr, n);
      }
      if (op === '+' && isIntT(a.t) && (b.t.k === 'c' || isCharArr(b.t))) {
        if (b.lit) R.hintOnce('H_PTR_ADD', site(n).key, {}, site(n));
        var cb = cvt(b, T.cstr, n);
        return bin(a, cb, function (i, s) { return i < 0 || i > s.length ? '' : s.slice(i); }, T.cstr, n);
      }
      if (op === '==' || op === '!=' || op === '<' || op === '>' || op === '<=' || op === '>=') {
        if (isStrish(a.t) && isStrish(b.t)) {
          var sa = cvt(a, T.String, n), sb = cvt(b, T.String, n);
          return bin(sa, sb, cmpFn(op), T.bool, n);
        }
        needNum(a, n); needNum(b, n);
        var ct = usual(a.t, b.t);
        return bin(cvt(a, ct, n), cvt(b, ct, n), cmpFn(op), T.bool, n);
      }
      needNum(a, n); needNum(b, n);
      if (op === '<<' || op === '>>') {
        needInt(a, n); needInt(b, n);
        var pt = promote(a.t);
        return bin(cvt(a, pt, n), cvt(b, promote(b.t), n), arithFn(op, pt, n), pt, n);
      }
      if (op === '%' || op === '&' || op === '|' || op === '^') {
        if (a.t.k === 'f' || b.t.k === 'f') {
          if (op === '%') fail('E_UNSUPPORTED', { what: '% مع float (استخدموا fmod)' }, n); // NEW COPY fragment
          fail('E_TYPE', { from: 'float', to: op }, n);
        }
      }
      var rt = usual(a.t, b.t);
      return bin(cvt(a, rt, n), cvt(b, rt, n), arithFn(op, rt, n), rt, n);
    }
    function cmpFn(op) {
      switch (op) {
        case '==': return function (x, y) { return x === y ? 1 : 0; };
        case '!=': return function (x, y) { return x !== y ? 1 : 0; };
        case '<': return function (x, y) { return x < y ? 1 : 0; };
        case '>': return function (x, y) { return x > y ? 1 : 0; };
        case '<=': return function (x, y) { return x <= y ? 1 : 0; };
        case '>=': return function (x, y) { return x >= y ? 1 : 0; };
      }
    }
    function strCat(a, b, n) {
      if (a.t.k === 'v' || b.t.k === 'v' || a.t.k === 'o' || b.t.k === 'o' || a.t.k === 'a' && !isCharArr(a.t) || b.t.k === 'a' && !isCharArr(b.t)) fail('E_TYPE', { from: (a.t.k === 's' ? b : a).t.n, to: 'String' }, n);
      var ta = a.t, tb = b.t;
      return bin(a, b, function (x, y) { return strOf(ta, x, R) + strOf(tb, y, R); }, T.String, n);
    }

    function exLog(n) {
      var a = toBool(ex(n.a), n.a), b = toBool(ex(n.b), n.b), and = n.op === '&&';
      if (a.pure && b.pure) {
        var ea = a.ev, eb = b.ev;
        return fold({ t: T.bool, pure: true, ev: and ? function (L) { return ea(L) && eb(L) ? 1 : 0; } : function (L) { return ea(L) || eb(L) ? 1 : 0; } }, [a, b], n);
      }
      var ga = G_(a), gb = G_(b);
      return {
        t: T.bool, pure: false, gen: function* (L) {
          var x = yield* ga(L);
          if (and ? !x : x) return x ? 1 : 0;
          return (yield* gb(L)) ? 1 : 0;
        }
      };
    }

    function exUn(n) {
      var a = ex(n.a);
      if (n.op === '!') return map1(toBool(a, n), function (v) { return v ? 0 : 1; }, T.bool, n);
      needNum(a, n);
      var pt = promote(a.t), ca = cvt(a, pt, n);
      if (n.op === '+') return ca;
      if (n.op === '-') {
        if (pt.k === 'f') return map1(ca, function (v) { return -v; }, pt, n);
        var sub = arithFn('-', pt, n);
        return map1(ca, function (v) { return sub(0, v); }, pt, n);
      }
      if (n.op === '~') { needInt(a, n); var w = wrapOf(pt); return map1(ca, function (v) { return w(~v); }, pt, n); }
      fail('E_SYNTAX', { expected: AR.expr, found: n.op }, n);
    }

    function exInc(n) {
      var lv = mkLV(n.a), t = lv.t, post = n.T === 'Post';
      if (!isNum(t)) fail('E_TYPE', { from: t.n, to: n.op }, n);
      var pt = promote(t), f = arithFn(n.op === '++' ? '+' : '-', pt, n), back = convFn(pt, t) || function (v) { return v; };
      var toP = convFn(t, pt) || function (v) { return v; };
      if (lv.pure) {
        var at = lv.at;
        return {
          t: t, pure: true, ev: function (L) {
            var k = at(L), o = R.lo, old = o[k];
            if (old === undefined) old = 0;
            var nv = back(f(toP(old), 1)); o[k] = nv;
            return post ? old : nv;
          }
        };
      }
      return {
        t: t, pure: false, gen: function* (L) {
          var k = yield* lv.atg(L), o = R.lo, old = o[k];
          if (old === undefined) old = 0;
          var nv = back(f(toP(old), 1)); o[k] = nv;
          return post ? old : nv;
        }
      };
    }

    function exAsg(n) {
      // s[i] = c on a String → setCharAt
      if (n.a.T === 'Idx') {
        var base = tryType(n.a.a);
        if (base && base.k === 's') {
          return exMCall({ T: 'MCall', o: n.a.a, name: 'setCharAt', args: [n.a.i, n.b], line: n.line, col: n.col, asg: true });
        }
      }
      var lv = mkLV(n.a), t = lv.t, op = n.op;
      if (t.k === 'o') fail('E_UNSUPPORTED', { what: t.n + ' = …' }, n);
      if (n.b.T === 'Init') fail('E_SYNTAX', { expected: AR.expr, found: '{' }, n.b);
      var b = ex(n.b), val;
      if (op === '=') {
        if (t.k === 's' && isNum(b.t) && b.t.k !== 'f') {
          if (b.t.ch) val = map1(b, function (c) { return String.fromCharCode(c & 255); }, T.String, n);
          else fail('E_TYPE', { from: b.t.n, to: 'String' }, n);
        } else val = cvt(b, t, n);
        if (t.k === 's') { var sst0 = site(n); return assignE(lv, val, function (old, y) { return R.strFit(old || '', y, sst0); }, n); }
        return assignE(lv, val, null, n);
      }
      var bop = op.slice(0, -1);
      if (t.k === 's') {
        if (bop !== '+') fail('E_TYPE', { from: 'String', to: op }, n);
        var tb = b.t;
        if (!isNum(tb) && !isStrish(tb) && tb.k !== 'ip') fail('E_TYPE', { from: tb.n, to: 'String' }, n);
        var sst = site(n);
        return assignE(lv, b, function (old, y) { var o = old || ''; return R.strFit(o, o + strOf(tb, y, R), sst); }, n);
      }
      needNum(b, n);
      if (!isNum(t)) fail('E_TYPE', { from: b.t.n, to: t.n }, n);
      var rt = (bop === '<<' || bop === '>>') ? promote(t) : usual(t, b.t);
      if ((bop === '%' || bop === '&' || bop === '|' || bop === '^' || bop === '<<' || bop === '>>') && (rt.k === 'f' || b.t.k === 'f')) fail('E_TYPE', { from: 'float', to: op }, n);
      var f = arithFn(bop, rt, n), toR = convFn(t, rt) || function (v) { return v; }, back = convFn(rt, t) || function (v) { return v; };
      var cb = (bop === '<<' || bop === '>>') ? cvt(b, promote(b.t), n) : cvt(b, rt, n);
      return assignE(lv, cb, function (old, y) { return back(f(toR(old === undefined ? 0 : old), y)); }, n);
    }
    /** Store (combine ? combine(old, value) : value) into lv; expression value = stored value. */
    function assignE(lv, val, combine, n) {
      if (lv.pure && val.pure) {
        var at = lv.at, ev = val.ev;
        if (!combine) return { t: lv.t, pure: true, ev: function (L) { var v = ev(L); var k = at(L); R.lo[k] = v; return v; } };
        return { t: lv.t, pure: true, ev: function (L) { var y = ev(L); var k = at(L), o = R.lo; var v = combine(o[k], y); o[k] = v; return v; } };
      }
      var gv = G_(val);
      return {
        t: lv.t, pure: false, gen: function* (L) {
          var y = yield* gv(L);
          var k = yield* lvAtGen(lv, L), o = R.lo;
          var v = combine ? combine(o[k], y) : y;
          o[k] = v; return v;
        }
      };
    }
    /** Static type of an expression without generating code twice (used for small lookaheads). */
    function tryType(n) {
      try { return ex(n).t; } catch (e) { if (e instanceof CErr) return null; throw e; }
    }

    function exTern(n) {
      var c = toBool(ex(n.c), n.c), a = ex(n.a), b = ex(n.b), t;
      if (isNum(a.t) && isNum(b.t)) t = usual(a.t, b.t);
      else if (isStrish(a.t) && isStrish(b.t)) t = (a.t.k === 's' || b.t.k === 's') ? T.String : T.cstr;
      else if (a.t === b.t) t = a.t;
      else fail('E_TYPE', { from: b.t.n, to: a.t.n }, n);
      if (t.k !== 'v') { a = cvt(a, t, n.a); b = cvt(b, t, n.b); }
      if (c.pure && a.pure && b.pure) {
        var ec = c.ev, ea = a.ev, eb = b.ev;
        var E = { t: t, pure: true, ev: function (L) { return ec(L) ? ea(L) : eb(L); } };
        return c.isK ? (c.cv ? a : b) : E;
      }
      var gc = G_(c), ga = G_(a), gb = G_(b);
      return { t: t, pure: false, gen: function* (L) { return (yield* gc(L)) ? yield* ga(L) : yield* gb(L); } };
    }

    function exIdx(n) {
      // a[i][j] on a 2-D array → one flat access
      if (n.a.T === 'Idx') {
        var bb = ex(n.a.a);
        if (bb.t.k === 'a' && bb.t.dims.length === 2) {
          var i1 = needInt(ex(n.a.i), n.a), i2 = needInt(ex(n.i), n);
          return elemE(bb, [cvt(i1, T.long, n), cvt(i2, T.long, n)], bb.t.et, n);
        }
      }
      var base = ex(n.a);
      var ix = needInt(ex(n.i), n.i);
      ix = cvt(ix, T.long, n.i);
      if (base.t.k === 'a') {
        if (base.t.dims.length === 2) {
          var rowT = { k: 'a', et: base.t.et, dims: [base.t.dims[1]], n: base.t.et.n + '[]' };
          var st = site(n);
          return bin(base, ix, function (A, i) {
            if (i < 0 || i >= A.dims[0]) throw R.err('E_BOUNDS', { name: A.name, i: i, n: A.dims[0], last: A.dims[0] - 1 }, st);
            return new CArr(A.d, A.off + i * A.dims[1], A.dims[1], [A.dims[1]], A.name);
          }, rowT, n);
        }
        return elemE(base, [ix], base.t.et, n);
      }
      if (base.t.k === 's' || base.t.k === 'c') {
        return bin(base, ix, function (s, i) { return i >= 0 && i < s.length ? (s.charCodeAt(i) << 24) >> 24 : 0; }, T.char, n);
      }
      if (base.t.k === 'ip') return bin(base, ix, function (s, i) { return +(s.split('.')[i] || 0); }, T.uint8, n);
      fail('E_TYPE', { from: base.t.n, to: '[ ]' }, n);
    }
    /** Element access with bounds checks; also provides lvalue at()/atg(). */
    function elemE(base, idxs, et, n) {
      var st = site(n), two = idxs.length === 2;
      function locate(A, i, j) {
        if (two) {
          if (i < 0 || i >= A.dims[0]) throw R.err('E_BOUNDS', { name: A.name, i: i, n: A.dims[0], last: A.dims[0] - 1 }, st);
          if (j < 0 || j >= A.dims[1]) throw R.err('E_BOUNDS', { name: A.name, i: j, n: A.dims[1], last: A.dims[1] - 1 }, st);
          return A.off + i * A.dims[1] + j;
        }
        if (i < 0 || i >= A.n) throw R.err('E_BOUNDS', { name: A.name, i: i, n: A.n, last: A.n - 1 }, st);
        return A.off + i;
      }
      var all = [base].concat(idxs);
      var constArr = base.sym && base.sym.isConst ? base.sym.name : null;
      if (all.every(function (e) { return e.pure; })) {
        var eb = base.ev, e1 = idxs[0].ev, e2 = two ? idxs[1].ev : null;
        var at = two
          ? function (L) { var A = eb(L), i = e1(L), j = e2(L), k = locate(A, i, j); R.lo = A.d; return k; }
          : function (L) { var A = eb(L), i = e1(L), k = locate(A, i, 0); R.lo = A.d; return k; };
        var ev = two
          ? function (L) { var A = eb(L); return A.d[locate(A, e1(L), e2(L))]; }
          : function (L) { var A = eb(L); return A.d[locate(A, e1(L), 0)]; };
        return { t: et, pure: true, ev: ev, lvAt: at, constArr: constArr };
      }
      var gb = G_(base), g1 = G_(idxs[0]), g2 = two ? G_(idxs[1]) : null;
      var atg = function* (L) { var A = yield* gb(L), i = yield* g1(L), j = two ? yield* g2(L) : 0, k = locate(A, i, j); R.lo = A.d; return k; };
      return { t: et, pure: false, gen: function* (L) { var k = yield* atg(L); return R.lo[k]; }, lvAt: null, lvAtg: atg, constArr: constArr };
    }

    function specType(spec, n) {
      var t = T[spec.name];
      if (!t) fail('E_UNSUPPORTED', { what: spec.name }, n);
      return t;
    }
    function exCast(spec, a, n) {
      var t = specType(spec, n), e = ex(a);
      if (t.k === 's') return strCtor([e], n);
      if (t.k === 'c') { if (e.t.k === 'c') return e; if (isCharArr(e.t)) return cvt(e, T.cstr, n); fail('E_UNSUPPORTED', { what: AR.pointers }, n); }
      if (!isNum(t) || !isNum(e.t)) fail('E_TYPE', { from: e.t.n, to: t.n }, n);
      return cvt(e, t, n);
    }
    function exCtor(n) {
      var name = n.spec.name;
      if (name === 'String') return strCtor(n.args.map(ex), n);
      if (name === 'IPAddress') {
        if (n.args.length !== 4) fail('E_ARGS', { name: 'IPAddress', n: 4, m: n.args.length }, n);
        var parts = n.args.map(function (a) { return cvt(needInt(ex(a), a), T.uint8, a); });
        return nary(parts, function (v) { return v.join('.'); }, T.IPAddress, n);
      }
      if (T[name] && T[name].k === 'o') fail('E_UNSUPPORTED', { what: name + '(…)' }, n);
      if (n.args.length !== 1) fail('E_ARGS', { name: name, n: 1, m: n.args.length }, n);
      return exCast(n.spec, n.args[0], n);
    }
    /** String(...) constructor (§7.4). */
    function strCtor(args, n) {
      if (args.length === 0) return K(T.String, '');
      var a = args[0], t = a.t;
      if (args.length === 1) {
        if (isStrish(t)) return cvt(a, T.String, n);
        if (t.k === 'ip') return map1(a, function (v) { return v; }, T.String, n);
        if (!isNum(t)) fail('E_TYPE', { from: t.n, to: 'String' }, n);
        return map1(a, function (v) { return strOf(t, v, R); }, T.String, n);
      }
      if (args.length !== 2) fail('E_ARGS', { name: 'String', n: '1–2', m: args.length }, n);
      needNum(a, n); needNum(args[1], n);
      if (t.k === 'f') return bin(a, args[1], function (v, d) { return dtostrf(v, (d | 0) + 2, d | 0); }, T.String, n);
      // String(int, base): itoa/ltoa/utoa — lowercase digits, negative only with base 10
      return bin(a, args[1], function (v, b) {
        b = b | 0; if (b < 2 || b > 36) b = 10;
        if (b === 10) return String(v);
        var u = t.sg ? (t.bits <= T.int.bits && T.int.bits === 16 ? v & 0xFFFF : v >>> 0) : v;
        return (u >>> 0).toString(b);
      }, T.String, n);
    }
    function exSizeof(n) {
      if (n.spec) { var t = specType(n.spec, n); return K(T.ulong, t.sz); }
      if (n.a.T === 'Str') return K(T.ulong, n.a.v.length + 1);
      var e = ex(n.a);
      if (e.t.k === 'a') {
        var cnt = e.t.dims.reduce(function (x, y) { return x * y; }, 1);
        return K(T.ulong, cnt * e.t.et.sz);
      }
      return K(T.ulong, e.t.sz || 0);
    }
    /** Combine N arguments with fn(valuesArray). */
    function nary(parts, fn, t, n) {
      if (parts.every(function (p) { return p.pure; })) {
        var evs = parts.map(function (p) { return p.ev; });
        return fold({ t: t, pure: true, ev: function (L) { var v = new Array(evs.length); for (var i = 0; i < evs.length; i++) v[i] = evs[i](L); return fn(v); } }, parts, n);
      }
      var gs = parts.map(G_);
      return { t: t, pure: false, gen: function* (L) { var v = new Array(gs.length); for (var i = 0; i < gs.length; i++) v[i] = yield* gs[i](L); return fn(v); } };
    }

    // ---- calls
    function num(v) { return { T: 'Num', v: v, ty: 'int', lit: { dec: true } }; }           // plain int literal
    function numUL(v) { return { T: 'Num', v: v, ty: 'int', lit: { dec: true, u: true, l: true } }; } // 1UL
    /** Arduino macros rewritten to AST (same double evaluation as the real macros). */
    function macro(n) {
      var a = n.args, L = n.line, Cc = n.col;
      function N(T2, o) { o.T = T2; o.line = L; o.col = Cc; return o; }
      function argc(k) { if (a.length !== k) fail('E_ARGS', { name: n.name, n: k, m: a.length }, n); }
      switch (n.name) {
        case 'min': argc(2); return N('Tern', { c: N('Bin', { op: '<', a: a[0], b: a[1] }), a: a[0], b: a[1] });
        case 'max': argc(2); return N('Tern', { c: N('Bin', { op: '>', a: a[0], b: a[1] }), a: a[0], b: a[1] });
        case 'abs': argc(1); return N('Tern', { c: N('Bin', { op: '>', a: a[0], b: num(0) }), a: a[0], b: N('Un', { op: '-', a: a[0] }) });
        case 'constrain': argc(3); return N('Tern', { c: N('Bin', { op: '<', a: a[0], b: a[1] }), a: a[1], b: N('Tern', { c: N('Bin', { op: '>', a: a[0], b: a[2] }), a: a[2], b: a[0] }) });
        case 'sq': argc(1); return N('Bin', { op: '*', a: a[0], b: a[0] });
        case 'radians': argc(1); return N('Bin', { op: '*', a: a[0], b: N('Id', { name: 'DEG_TO_RAD' }) });
        case 'degrees': argc(1); return N('Bin', { op: '*', a: a[0], b: N('Id', { name: 'RAD_TO_DEG' }) });
        case 'bitRead': argc(2); return N('Bin', { op: '&', a: N('Bin', { op: '>>', a: a[0], b: a[1] }), b: num(1) });
        case 'bit': argc(1); return N('Bin', { op: '<<', a: numUL(1), b: a[0] });
        case 'bitSet': argc(2); return N('Asg', { op: '|=', a: a[0], b: N('Bin', { op: '<<', a: numUL(1), b: a[1] }) });
        case 'bitClear': argc(2); return N('Asg', { op: '&=', a: a[0], b: N('Un', { op: '~', a: N('Bin', { op: '<<', a: numUL(1), b: a[1] }) }) });
        case 'bitWrite': argc(3); return N('Tern', {
          c: a[2],
          a: N('Asg', { op: '|=', a: a[0], b: N('Bin', { op: '<<', a: numUL(1), b: a[1] }) }),
          b: N('Asg', { op: '&=', a: a[0], b: N('Un', { op: '~', a: N('Bin', { op: '<<', a: numUL(1), b: a[1] }) }) })
        });
        case 'lowByte': argc(1); return N('Cast', { spec: { name: 'uint8' }, a: N('Bin', { op: '&', a: a[0], b: num(255) }) });
        case 'highByte': argc(1); return N('Cast', { spec: { name: 'uint8' }, a: N('Bin', { op: '>>', a: a[0], b: num(8) }) });
        case 'F': case 'PSTR': argc(1); return a[0];
      }
      return null;
    }

    function exCall(n) {
      var uf = funcs[n.name];
      if (uf && !lookup(n.name)) return callUser(uf, n);
      var m = macro(n);
      if (m) return ex(m);
      var def = BUILTINS[n.name];
      if (def && (!def.b || def.b.indexOf(avr ? 'avr' : 'esp32') >= 0)) return callDef(def, n.name, null, n.args, n, null);
      if (def && def.u) fail('E_UNSUPPORTED', { what: def.u }, n);
      if (NET_IDS[n.name]) fail('E_UNSUPPORTED', { what: n.name + ' (' + AR.noNet + ')' }, n);
      if (lookup(n.name)) fail('E_TYPE', { from: lookup(n.name).t.n, to: n.name + '()' }, n);
      fail('E_UNDECLARED', { name: n.name }, n);
    }

    function callUser(fn, n) {
      var ps = fn.params;
      if (ps.length !== n.args.length) fail('E_ARGS', { name: n.name, n: ps.length, m: n.args.length }, n);
      var parts = n.args.map(function (a, i) {
        var p = ps[i];
        if (p.t.k === 'a') {
          var e = ex(a);
          if (e.t.k !== 'a' || e.t.et !== p.t.et || e.t.dims.length !== p.t.dims.length) fail('E_TYPE', { from: e.t.n, to: p.t.n }, a);
          return e;
        }
        if (p.t.k === 'o') { var eo = ex(a); if (eo.t !== p.t) fail('E_TYPE', { from: eo.t.n, to: p.t.n }, a); return eo; }
        if (p.ref) {
          var isLv = a.T === 'Id' || a.T === 'Idx';
          if (isLv) {
            var lv;
            try { lv = mkLV(a); } catch (e2) { if (!p.isConst) throw e2; lv = null; }
            if (lv) {
              if (lv.t !== p.t) fail('E_TYPE', { from: lv.t.n, to: p.t.n + '&' }, a);
              if (lv.pure) { var at = lv.at; return { t: p.t, pure: true, ev: function (L) { var k = at(L); return { o: R.lo, k: k }; } }; }
              return { t: p.t, pure: false, gen: function* (L) { var k = yield* lv.atg(L); return { o: R.lo, k: k }; } };
            }
          }
          if (!p.isConst) fail('E_TYPE', { from: tryType(a) ? tryType(a).n : '…', to: p.t.n + '&' }, a);
          return map1(argConv(ex(a), p.t, a), function (v) { return { o: [v], k: 0 }; }, p.t, a);
        }
        return argConv(ex(a), p.t, a);
      });
      var idx = fn.idx, F = R.F;
      if (parts.every(function (p) { return p.pure; }) && parts.length <= 4) {
        var evs = parts.map(function (p) { return p.ev; });
        return {
          t: fn.ret, pure: false, gen: function* (L) {
            var v = new Array(evs.length);
            for (var i = 0; i < evs.length; i++) v[i] = evs[i](L);
            return yield* F[idx](v);
          }
        };
      }
      var gs = parts.map(G_);
      return {
        t: fn.ret, pure: false, gen: function* (L) {
          var v = new Array(gs.length);
          for (var i = 0; i < gs.length; i++) v[i] = yield* gs[i](L);
          return yield* F[idx](v);
        }
      };
    }
    /** Argument conversion to a declared parameter type (String accepts char*). */
    function argConv(e, t, n) {
      if (t.k === 's' && isNum(e.t)) fail('E_TYPE', { from: e.t.n, to: 'String' }, n);
      return cvt(e, t, n);
    }

    function exMCall(n) {
      var o = n.o, cls, self = null, lv = null;
      if (o.T === 'Id' && !lookup(o.name) && (o.name === 'Serial' || o.name === 'Wire' || o.name === 'WiFi')) {
        self = exId(o); cls = self.t.cls;
      } else {
        self = ex(o);
        var tk = self.t.k;
        cls = tk === 's' ? 'String' : tk === 'ip' ? 'IPAddress' : tk === 'o' ? self.t.cls : null;
        if (!cls) fail('E_NO_MEMBER', { obj: self.t.n, member: n.name + '()', board: P.name }, n);
      }
      var table = METHODS[cls], def = table && table[n.name];
      if (def && def.b && def.b.indexOf(avr ? 'avr' : 'esp32') < 0) def = null;
      if (!def) {
        var u = table && table['?' + n.name];
        if (u) fail('E_UNSUPPORTED', { what: u }, n);
        fail('E_NO_MEMBER', { obj: cls === 'LCD' ? 'LiquidCrystal_I2C' : cls, member: n.name + '()', board: P.name }, n);
      }
      if (def.mut && (o.T === 'Id' || o.T === 'Idx')) {
        try { lv = mkLV(o); } catch (e) { if (!(e instanceof CErr)) throw e; if (e.code === 'E_CONST') throw e; lv = null; }
      }
      return callDef(def, (cls === 'LCD' ? 'lcd' : cls) + '.' + n.name, self, n.args, n, lv);
    }

    function exSCall(n) {
      if (n.cls === 'ESP32PWM' && /^allocateTimer$/.test(n.name) && P.board === 'esp32') {
        needInc('ESP32PWM', 'ESP32Servo.h', n);
        return K(T.void, undefined);
      }
      fail('E_UNSUPPORTED', { what: n.cls + '::' + n.name }, n);
    }

    /**
     * Builtin/method call. def = { a:[min,max], s: arg kinds ('n' number, 's' string-ish, 'x' any,
     * 'f' ISR function, 'A' char array), t: return type name | fn(argTypes), f(R, vals, types, site, self),
     * blk: may suspend in the simulator, io: may return a thenable on the real board, feat, pre(ctx) }.
     */
    function callDef(def, name, selfE, argNodes, n, lv) {
      var argc = argNodes.length, mn = def.a[0], mx = def.a[1];
      if (argc < mn || argc > mx) fail('E_ARGS', { name: name, n: mn === mx ? mn : mn + '–' + mx, m: argc }, n);
      var kinds = def.s || '';
      var args = argNodes.map(function (a, i) {
        var k = kinds[i] || kinds[kinds.length - 1] || 'n';
        if (k === 'f') {
          if (a.T !== 'Id' || !funcs[a.name]) fail('E_TYPE', { from: a.T === 'Id' ? a.name : '…', to: 'void isr()' }, a);
          var fn = funcs[a.name];
          if (fn.params.length || fn.ret.k !== 'v') fail('E_TYPE', { from: a.name, to: 'void isr()' }, a);
          return K(T.int, fn.idx);
        }
        var e = ex(a);
        if (e.t.k === 'v') fail('E_TYPE', { from: 'void', to: name }, a);
        if (k === 'n' && !isNum(e.t)) fail('E_TYPE', { from: e.t.n, to: 'int' }, a);
        if (k === 's' && !isStrish(e.t) && !(def.sc && isIntT(e.t) && e.t.ch)) fail('E_TYPE', { from: e.t.n, to: 'String' }, a);
        if (k === 'A' && !isCharArr(e.t)) fail('E_TYPE', { from: e.t.n, to: 'char[]' }, a);
        if (k === 'p' && !(isNum(e.t) || isStrish(e.t) || e.t.k === 'ip')) fail('E_TYPE', { from: e.t.n, to: name }, a);
        return e;
      });
      var types = args.map(function (e) { return e.t; });
      var st = site(n);
      var ctx = { args: args, types: types, n: n, site: st, name: name, fail: fail, note: note, feat: feat, usePin: usePin, P: P, T: T, R: R, needInc: needInc, servoH: servoH, avr: avr, compileOnly: compileOnly };
      if (def.feat) feat(def.feat);
      if (def.pre) def.pre(ctx);
      var t = typeof def.t === 'function' ? def.t(types, T, P, args) : T[def.t || 'void'];
      var f = def.f, blk = def.blk || (def.io && wall);
      var allPure = args.every(function (e) { return e.pure; }) && (!selfE || selfE.pure);
      var evSelf = selfE ? selfE.ev : null;
      var mut = def.mut && lv;
      if (!blk && allPure && !mut) {
        var evs = args.map(function (e) { return e.ev; });
        var na = evs.length;
        var E;
        if (na === 0) E = { t: t, pure: true, ev: function (L) { return f(R, [], types, st, evSelf ? evSelf(L) : null); } };
        else if (na === 1) { var e0 = evs[0]; E = { t: t, pure: true, ev: function (L) { return f(R, [e0(L)], types, st, evSelf ? evSelf(L) : null); } }; }
        else if (na === 2) { var a0 = evs[0], a1 = evs[1]; E = { t: t, pure: true, ev: function (L) { return f(R, [a0(L), a1(L)], types, st, evSelf ? evSelf(L) : null); } }; }
        else E = { t: t, pure: true, ev: function (L) { var v = new Array(na); for (var i = 0; i < na; i++) v[i] = evs[i](L); return f(R, v, types, st, evSelf ? evSelf(L) : null); } };
        if (def.fold) return fold(E, args, n);
        return E;
      }
      var gs = args.map(G_), gSelf = selfE ? G_(selfE) : null;
      return {
        t: t, pure: false, gen: function* (L) {
          var k = 0, o = null;
          if (mut) { k = yield* lvAtGen(lv, L); o = R.lo; }
          var self = mut ? readLv(o, k, lv.t) : (gSelf ? yield* gSelf(L) : null);
          var v = new Array(gs.length);
          for (var i = 0; i < gs.length; i++) v[i] = yield* gs[i](L);
          R.mstr = self;
          var r = f(R, v, types, st, self);
          while (r instanceof Susp) { var x = yield r.q; r = r.k ? r.k(x) : x; }
          if (mut) o[k] = R.mstr;
          return r;
        }
      };
    }

    // ---- statements: S = {pure, ev(L) → signal} | {pure:false, gen(L) → signal}; 0 normal, 1 break, 2 continue, 3 return
    function sGen(S) { if (S.gen) return S.gen; var ev = S.ev; return function* (L) { return ev(L); }; }
    var EMPTY_S = { pure: true, ev: function () { return 0; } };

    function stmt(n) {
      try { return stmt0(n); } catch (e) { record(e); return EMPTY_S; }
    }
    function stmt0(n) {
      switch (n.T) {
        case 'Empty': return EMPTY_S;
        case 'Expr': {
          var e = ex(n.e);
          if (e.pure) { var ev = e.ev; return { pure: true, ev: function (L) { R.now += cs; R.steps++; ev(L); return 0; } }; }
          var g = e.gen;
          return { pure: false, gen: function* (L) { R.now += cs; R.steps++; yield* g(L); return 0; } };
        }
        case 'Block': {
          scopes.push(Object.create(null));
          var list = n.body.map(stmt);
          scopes.pop();
          return blockS(list);
        }
        case 'Decl': return declS(n, false);
        case 'If': {
          var c = toBool(ex(n.c), n.c), a = stmt(n.a), b = n.b ? stmt(n.b) : EMPTY_S;
          if (c.pure && a.pure && b.pure) {
            var ec = c.ev, ea = a.ev, eb = b.ev;
            return { pure: true, ev: function (L) { R.now += cs; R.steps++; return ec(L) ? ea(L) : eb(L); } };
          }
          var gc = G_(c), ga = sGen(a), gb = sGen(b);
          return { pure: false, gen: function* (L) { R.now += cs; R.steps++; return (yield* gc(L)) ? yield* ga(L) : yield* gb(L); } };
        }
        case 'While': case 'Do': case 'For': return loopS(n);
        case 'Switch': return switchS(n);
        case 'Break': if (!brkDepth) fail('E_SYNTAX', { expected: AR.expr, found: 'break' }, n); return { pure: true, ev: function () { return 1; } };
        case 'Continue': if (!loopDepth) fail('E_SYNTAX', { expected: AR.expr, found: 'continue' }, n); return { pure: true, ev: function () { return 2; } };
        case 'Return': {
          var rt = fnCtx.ret;
          if (!n.e) return { pure: true, ev: function () { R.now += cs; R.steps++; R.ret = rt.k === 's' ? '' : 0; return 3; } };
          if (rt.k === 'v') fail('E_TYPE', { from: tryType(n.e) ? tryType(n.e).n : '…', to: 'void' }, n);
          var re = rt.k === 's' && ex(n.e).t.k !== 's' ? strCtor([ex(n.e)], n.e) : cvt(ex(n.e), rt, n.e);
          if (re.pure) { var rev = re.ev; return { pure: true, ev: function (L) { R.now += cs; R.steps++; R.ret = rev(L); return 3; } }; }
          var rg = re.gen;
          return { pure: false, gen: function* (L) { R.now += cs; R.steps++; R.ret = yield* rg(L); return 3; } };
        }
        case 'Case': fail('E_SYNTAX', { expected: AR.expr, found: 'case' }, n); break;
        case 'Func': case 'Proto': fail('E_UNSUPPORTED', { what: 'دالة جوّه دالة' }, n); break; // NEW COPY fragment
      }
      fail('E_SYNTAX', { expected: AR.expr, found: n.T }, n);
    }
    function blockS(list) {
      if (list.length === 1) return list[0];
      if (list.every(function (s) { return s.pure; })) {
        var evs = list.map(function (s) { return s.ev; }), m = evs.length;
        return { pure: true, ev: function (L) { for (var i = 0; i < m; i++) { var sg = evs[i](L); if (sg) return sg; } return 0; } };
      }
      var ps = list.map(function (s) { return s.pure; }), es = list.map(function (s) { return s.ev; }), gs = list.map(function (s) { return s.gen; }), n2 = list.length;
      return {
        pure: false, gen: function* (L) {
          for (var i = 0; i < n2; i++) {
            if (R.now >= R.yT || R.steps >= R.yS) yield YB;
            var sg = ps[i] ? es[i](L) : yield* gs[i](L);
            if (sg) return sg;
          }
          return 0;
        }
      };
    }
    function loopS(n) {
      var isFor = n.T === 'For', isDo = n.T === 'Do';
      scopes.push(Object.create(null));
      var init = isFor && n.init ? (n.init.T === 'Decl' ? declS(n.init, false) : stmt(n.init)) : EMPTY_S;
      var c = n.c ? toBool(ex(n.c), n.c) : K(T.bool, 1);
      var upd = isFor && n.upd ? ex(n.upd) : null;
      loopDepth++; brkDepth++;
      var body;
      try { body = stmt(n.body); } finally { loopDepth--; brkDepth--; }
      scopes.pop();
      var ip = init.pure, iev = init.ev, igen = init.gen;
      var cp = c.pure, cev = c.ev, cgen = c.gen;
      var bp = body.pure, bev = body.ev, bgen = body.gen;
      var up = upd ? upd.pure : true, uev = upd ? upd.ev : null, ugen = upd ? upd.gen : null;
      return {
        pure: false, gen: function* (L) {
          if (ip) iev(L); else yield* igen(L);
          var first = true;
          for (;;) {
            R.now += cs; R.steps++;
            if (R.now >= R.yT || R.steps >= R.yS) yield YB;
            if (!(isDo && first)) {
              var cv = cp ? cev(L) : yield* cgen(L);
              if (!cv) break;
            }
            first = false;
            var sg = bp ? bev(L) : yield* bgen(L);
            if (sg === 1) break;
            if (sg === 3) return 3;
            if (uev) uev(L); else if (ugen) yield* ugen(L);
          }
          return 0;
        }
      };
    }
    function switchS(n) {
      var e = ex(n.e);
      if (!isIntT(e.t)) fail('E_TYPE', { from: e.t.n, to: 'switch' }, n.e);
      var pt = promote(e.t);
      e = cvt(e, pt, n.e);
      scopes.push(Object.create(null));
      brkDepth++;
      var list = [], labels = new Map(), dflt = -1;
      try {
        n.body.forEach(function (s) {
          if (s.T === 'Case') {
            if (!s.e) { dflt = list.length; return; }
            var ce;
            try { ce = cvt(ex(s.e), pt, s.e); } catch (err) { record(err); return; }
            if (!ce.isK) { record(new CErr('E_TYPE', { from: 'متغير', to: 'case' }, s.line, s.col)); return; } // NEW COPY fragment
            if (labels.has(ce.cv)) { record(new CErr('E_REDECL', { name: 'case ' + ce.cv }, s.line, s.col)); return; }
            labels.set(ce.cv, list.length);
            return;
          }
          list.push(stmt(s));
        });
      } finally { brkDepth--; scopes.pop(); }
      var ep = e.pure, eev = e.ev, egen = e.gen, m = list.length;
      var ps = list.map(function (s) { return s.pure; }), es = list.map(function (s) { return s.ev; }), gs = list.map(function (s) { return s.gen; });
      return {
        pure: false, gen: function* (L) {
          R.now += cs; R.steps++;
          var v = ep ? eev(L) : yield* egen(L);
          var i = labels.has(v) ? labels.get(v) : dflt;
          if (i < 0) return 0;
          for (; i < m; i++) {
            if (R.now >= R.yT || R.steps >= R.yS) yield YB;
            var sg = ps[i] ? es[i](L) : yield* gs[i](L);
            if (sg === 1) return 0;
            if (sg) return sg;
          }
          return 0;
        }
      };
    }

    // ---- declarations
    var globalInits = [];   // generators run before setup()
    var globalsBytes = 0;
    function defaultOf(t) { return t.k === 's' || t.k === 'c' ? '' : t.k === 'ip' ? '0.0.0.0' : 0; }

    /** Compute dims (with inference from the initializer) */
    function arrDims(d, et) {
      return d.dims.map(function (de, i) {
        if (de) {
          var c = ex(de);
          if (!c.isK || !isIntT(c.t)) fail('E_TYPE', { from: 'متغير', to: 'حجم المصفوفة' }, de); // NEW COPY fragment
          if (c.cv <= 0) fail('E_BOUNDS', { name: d.name, i: c.cv, n: c.cv, last: c.cv - 1 }, de);
          return c.cv;
        }
        if (i !== 0) fail('E_SYNTAX', { expected: '[N]', found: '[]' }, d);
        if (!d.init) fail('E_SYNTAX', { expected: '[N]', found: '[]' }, d);
        if (d.init.T === 'Str') return d.init.v.length + 1;
        if (d.init.T === 'Init') return d.init.items.length;
        fail('E_TYPE', { from: tryType(d.init) ? tryType(d.init).n : '…', to: et.n + '[]' }, d);
      });
    }
    /** Build an initializer function for an array: returns fn(L) filling a fresh CArr, or a generator. */
    function arrInit(d, et, dims) {
      var total = dims.reduce(function (x, y) { return x * y; }, 1);
      var cells = []; // [index, E]
      var strRows = [];
      if (d.init) {
        if (d.init.T === 'Str') {
          if (!isCharArr({ k: 'a', et: et }) || dims.length !== 1) fail('E_TYPE', { from: 'const char*', to: et.n + '[]' }, d.init);
          if (d.init.v.length + 1 > dims[0] + 1 || d.init.v.length > dims[0]) fail('E_BOUNDS', { name: d.name, i: d.init.v.length, n: dims[0], last: dims[0] - 1 }, d.init);
          strRows.push([0, d.init.v]);
        } else if (d.init.T === 'Init') {
          var items = d.init.items;
          if (dims.length === 2) {
            if (items.length > dims[0]) fail('E_BOUNDS', { name: d.name, i: items.length - 1, n: dims[0], last: dims[0] - 1 }, d.init);
            var flat = items.every(function (it) { return it.T !== 'Init' && it.T !== 'Str'; });
            items.forEach(function (row, r) {
              if (flat) { cells.push([r, elemInit(row, et)]); return; }
              if (row.T === 'Str' && et.bits === 8 && et.k === 'i') {
                if (row.v.length > dims[1]) fail('E_BOUNDS', { name: d.name, i: row.v.length, n: dims[1], last: dims[1] - 1 }, row);
                strRows.push([r * dims[1], row.v]); return;
              }
              if (row.T !== 'Init') fail('E_TYPE', { from: tryType(row) ? tryType(row).n : '…', to: et.n + '[]' }, row);
              if (row.items.length > dims[1]) fail('E_BOUNDS', { name: d.name, i: row.items.length - 1, n: dims[1], last: dims[1] - 1 }, row);
              row.items.forEach(function (it, c) { cells.push([r * dims[1] + c, elemInit(it, et)]); });
            });
            if (flat && items.length > total) fail('E_BOUNDS', { name: d.name, i: items.length - 1, n: total, last: total - 1 }, d.init);
          } else {
            if (items.length > dims[0]) fail('E_BOUNDS', { name: d.name, i: items.length - 1, n: dims[0], last: dims[0] - 1 }, d.init);
            items.forEach(function (it, i) { cells.push([i, elemInit(it, et)]); });
          }
        } else fail('E_TYPE', { from: tryType(d.init) ? tryType(d.init).n : '…', to: et.n + '[]' }, d.init);
      }
      var name = d.name, def = defaultOf(et), objCls = et.k === 'o' ? et.cls : null;
      var allPure = cells.every(function (c) { return c[1].pure; });
      function fresh() {
        var data = new Array(total);
        for (var i = 0; i < total; i++) data[i] = objCls ? newObj(objCls, []) : def;
        for (var s = 0; s < strRows.length; s++) {
          var at = strRows[s][0], str = strRows[s][1];
          for (var j = 0; j < str.length; j++) data[at + j] = (str.charCodeAt(j) << 24) >> 24;
        }
        return new CArr(data, 0, dims[0], dims.slice(), name);
      }
      if (allPure) {
        var evs = cells.map(function (c) { return [c[0], c[1].ev]; });
        return { pure: true, ev: function (L) { var A = fresh(); for (var i = 0; i < evs.length; i++) A.d[evs[i][0]] = evs[i][1](L); return A; } };
      }
      var gs = cells.map(function (c) { return [c[0], G_(c[1])]; });
      return { pure: false, gen: function* (L) { var A = fresh(); for (var i = 0; i < gs.length; i++) A.d[gs[i][0]] = yield* gs[i][1](L); return A; } };
    }
    function elemInit(it, et) {
      if (it.T === 'Init') fail('E_TYPE', { from: '{…}', to: et.n }, it);
      var e = ex(it);
      if (et.k === 's' && isNum(e.t)) fail('E_TYPE', { from: e.t.n, to: 'String' }, it);
      return cvt(e, et, it);
    }

    function declS(n, global) {
      var spec = n.spec, t = specType(spec, n), out = [];
      if (t.k === 'v') fail('E_TYPE', { from: 'void', to: n.decls[0].name }, n);
      if (t.k === 'o') {
        var cls = t.cls;
        if (cls === 'Servo') { needInc('Servo', servoH, n); feat('servo'); }
        if (cls === 'DHT') { needInc('DHT', 'DHT.h', n); feat('dht'); }
        if (cls === 'LCD') { needInc('LiquidCrystal_I2C', 'LiquidCrystal_I2C.h', n); feat('lcd'); }
      }
      n.decls.forEach(function (d) {
        try { out.push(declOne(n, d, spec, t, global)); } catch (e) { record(e); }
      });
      return blockS(out.length ? out : [EMPTY_S]);
    }

    function declOne(n, d, spec, t, global) {
      var isArr = d.dims.length > 0;
      var isStatic = spec.isStatic && !global;
      var glob = global || isStatic;
      var sym = { kind: 'var', t: t, glob: glob, isConst: spec.isConst, cv: undefined };
      var initE = null, arrI = null;
      if (isArr) {
        var dims = arrDims(d, t);
        sym.t = { k: 'a', et: t, dims: dims, n: t.n + '[]', sz: dims.reduce(function (x, y) { return x * y; }, 1) * t.sz };
        arrI = arrInit(d, t, dims);
      } else if (t.k === 'o') {
        var args = (d.args || []).map(ex);
        initE = objCtor(t, args, d);
      } else {
        var src = d.init;
        if (!src && d.args) {
          if (t.k === 's') { initE = strCtor(d.args.map(ex), d); }
          else if (d.args.length === 1) src = d.args[0];
          else fail('E_ARGS', { name: d.name, n: 1, m: d.args.length }, d);
        }
        if (src) {
          if (src.T === 'Init') {
            if (src.items.length !== 1) fail('E_TYPE', { from: '{…}', to: t.n }, src);
            src = src.items[0];
          }
          var e = ex(src);
          if (t.k === 's' && isNum(e.t)) {
            if (e.t.ch) initE = map1(e, function (c) { return String.fromCharCode(c & 255); }, T.String, src);
            else fail('E_TYPE', { from: e.t.n, to: 'String' }, src);
          } else initE = cvt(e, t, src);
          if (spec.isConst && initE.isK) sym.cv = initE.cv;
          if (t.k === 'c' && initE.isK) sym.cv = undefined; // const char* can be re-pointed unless 'const' after '*'
        } else if (spec.isConst && !initE) {
          fail('E_CONST', { name: d.name }, d);
        }
      }
      if (sym.t.k === 'c' && spec.ptrConst) sym.isConst = false; // "const char* p" → p itself may change
      if (glob) { sym.slot = G.length; G.push(isArr ? null : (t.k === 'o' ? null : defaultOf(t))); }
      else sym.slot = fnCtx.ns++;
      declare(d.name, sym, d);
      if (global) globalsBytes += sizeOfSym(sym, d);
      var k = sym.slot;
      // code that (re)initialises the variable when the declaration executes
      var valE = isArr ? arrI : initE;
      if (glob) {
        if (!valE && !isArr) { if (t.k === 'o') valE = objCtor(t, [], d); else return EMPTY_S; }
        var initFn = valE.pure ? (function (ev) { return function* () { G[k] = ev(null); }; })(valE.ev) : (function (g) { return function* () { G[k] = yield* g([]); }; })(valE.gen);
        if (global || valE.isK || (valE.pure && isArr)) { globalInits.push(initFn); return EMPTY_S; }
        // static local with a non-constant initializer: run once, the first time
        var flagSlot = G.length; G.push(0);
        var vp = valE.pure, vev = valE.ev, vgen = valE.gen;
        if (vp) return { pure: true, ev: function (L) { if (!G[flagSlot]) { G[flagSlot] = 1; G[k] = vev(L); } return 0; } };
        return { pure: false, gen: function* (L) { if (!G[flagSlot]) { G[flagSlot] = 1; G[k] = yield* vgen(L); } return 0; } };
      }
      if (!valE) {
        var dv = (t.k === 's' || t.k === 'c' || t.k === 'ip') ? defaultOf(t) : undefined;
        return { pure: true, ev: function (L) { R.now += cs; R.steps++; L[k] = dv; return 0; } };
      }
      if (valE.pure) { var ev = valE.ev; return { pure: true, ev: function (L) { R.now += cs; R.steps++; L[k] = ev(L); return 0; } }; }
      var g = valE.gen;
      return { pure: false, gen: function* (L) { R.now += cs; R.steps++; L[k] = yield* g(L); return 0; } };
    }
    function sizeOfSym(sym, d) {
      if (sym.t.k === 'a') return sym.t.sz;
      if (sym.t.k === 's') return T.String.sz + (d.init && d.init.T === 'Str' ? d.init.v.length + 1 : 1);
      if (sym.t.k === 'o' && sym.t.cls === 'Servo') return 1 + 36; // (model) servo index + the library's servo table
      return sym.t.sz || 0;
    }

    /** Library object constructors. */
    function objCtor(t, args, d) {
      var cls = t.cls, types = args.map(function (a) { return a.t; });
      if (cls === 'Servo') {
        if (args.length) fail('E_ARGS', { name: 'Servo', n: 0, m: args.length }, d);
        return { t: t, pure: true, ev: function () { return newObj('Servo', []); } };
      }
      if (cls === 'DHT') {
        if (args.length < 2 || args.length > 3) fail('E_ARGS', { name: 'DHT', n: 2, m: args.length }, d);
        args.forEach(function (a) { needNum(a, d); });
        if (args[0].isK) {
          var r = checkPin(P, 'din', args[0].cv);
          if (r.code) fail(r.code, r.vars, d);
        }
        return nary(args, function (v) { return newObj('DHT', v); }, t, d);
      }
      if (cls === 'LCD') {
        if (args.length !== 3) fail('E_ARGS', { name: 'LiquidCrystal_I2C', n: 3, m: args.length }, d);
        args.forEach(function (a) { needNum(a, d); });
        var E = nary(args, function (v) { return newObj('LCD', v); }, t, d);
        E.isK = false; // never share one object between runs
        return E;
      }
      fail('E_UNSUPPORTED', { what: t.n }, d);
    }

    // ---- top level
    var items = ast.items;
    // pass 1: enums, function signatures
    function fnSig(it) {
      var ret = specType(it.spec, it);
      var params = it.params.map(function (p) {
        var pt = specType(p.spec, p);
        if (pt.k === 'v') fail('E_TYPE', { from: 'void', to: p.name || '…' }, p);
        if (p.dims.length) {
          var dims = p.dims.map(function (de, i) {
            if (!de) { if (i === 0) return 0; fail('E_SYNTAX', { expected: '[N]', found: '[]' }, p); }
            var c = ex(de); if (!c.isK) fail('E_TYPE', { from: 'متغير', to: 'حجم المصفوفة' }, de);
            return c.cv;
          });
          return { name: p.name, t: { k: 'a', et: pt, dims: dims, n: pt.n + '[]' }, ref: false, isConst: p.spec.isConst, line: p.line, col: p.col };
        }
        if (pt.k === 'o' && !p.ref) fail('E_UNSUPPORTED', { what: pt.n + ' بدون & ' }, p); // NEW COPY fragment
        return { name: p.name, t: pt, ref: p.ref && pt.k !== 'o', isConst: p.spec.isConst, line: p.line, col: p.col };
      });
      return { ret: ret, params: params };
    }
    items.forEach(function (it) {
      try {
        if (it.T === 'Enum') {
          var next = 0;
          it.items.forEach(function (e) {
            if (e.val) { var c = ex(e.val); if (!c.isK || !isIntT(c.t)) fail('E_TYPE', { from: 'متغير', to: 'enum' }, e); next = c.cv; }
            declare(e.name, { kind: 'const', t: T.int, cv: next }, e);
            next++;
          });
          if (it.vars) it.vars.forEach(function (v) { declOne({ spec: { name: 'int' } }, v, { name: 'int' }, T.int, true); });
          return;
        }
        if (it.T === 'Func' || it.T === 'Proto') {
          var sig = fnSig(it), prev = funcs[it.name];
          if (prev) {
            var same = prev.params.length === sig.params.length && prev.ret === sig.ret && prev.params.every(function (p, i) { return p.t === sig.params[i].t || (p.t.k === 'a' && sig.params[i].t.k === 'a'); });
            if (!same) fail('E_UNSUPPORTED', { what: 'overloading (' + it.name + ')' }, it);
            if (it.T === 'Func' && prev.def) fail('E_REDECL', { name: it.name }, it);
            if (it.T === 'Func') { prev.def = it; prev.params = sig.params; }
            return;
          }
          var f = { name: it.name, ret: sig.ret, params: sig.params, idx: funcList.length, def: it.T === 'Func' ? it : null, line: it.line };
          funcs[it.name] = f; funcList.push(f);
        }
      } catch (e) { record(e); }
    });
    // pass 2: globals and function bodies, in source order
    items.forEach(function (it) {
      try {
        if (it.T === 'Decl') declS(it, true);
        else if (it.T === 'Func') compileFunc(funcs[it.name], it);
      } catch (e) { record(e); }
    });
    funcList.forEach(function (f) {
      if (!f.def) { record(new CErr('E_UNDECLARED', { name: f.name + '()' }, f.line, 1)); }
      R.isrLine[f.idx] = f.line;
    });

    function compileFunc(f, it) {
      fnCtx = { ns: 0, ret: f.ret, name: f.name };
      scopes.push(Object.create(null));
      f.params.forEach(function (p) {
        if (!p.name) { fnCtx.ns++; return; }
        var s = { kind: 'var', t: p.t, glob: false, ref: p.ref, isConst: p.isConst && !p.ref ? true : p.isConst, slot: fnCtx.ns++, cv: undefined };
        if (p.t.k === 'a') s.isConst = p.isConst;
        declare(p.name, s, p);
      });
      var body;
      try {
        scopes.push(Object.create(null));
        var list = it.body.body.map(stmt);
        scopes.pop();
        body = blockS(list.length ? list : [EMPTY_S]);
      } finally { scopes.pop(); }
      var ns = fnCtx.ns, np = f.params.length, maxD = P.intBits === 16 ? 100 : 400;
      var name = f.name, bp = body.pure, bev = body.ev, bgen = body.gen, dflt = f.ret.k === 's' ? '' : 0;
      var stF = { line: it.line, col: it.col, key: 'fn' + it.line };
      fnCtx = null;
      R.F[f.idx] = function* (args) {
        var L = new Array(ns);
        for (var i = 0; i < np; i++) L[i] = args[i];
        if (++R.depth > maxD) { R.depth = 0; throw R.err('E_STACK', { name: name }, stF); }
        R.now += cc; R.steps++;
        var sg = bp ? bev(L) : yield* bgen(L);
        R.depth--;
        if (sg === 3) return R.ret;
        return dflt;
      };
    }

    var setupF = funcs.setup, loopF = funcs.loop;
    if (!setupF || !setupF.def) record(new CErr(loopF ? 'E_NO_SETUP' : 'E_NO_SETUP', {}, 1, 1));
    else if (!loopF || !loopF.def) record(new CErr('E_NO_LOOP', {}, lastLine(ast), 1));

    // compile-time profile checks
    if (features.serial && serialPinUse) note('W_SERIAL_PINS', { pins: P.serialPins.join(' و') }, serialPinUse);
    var gb = 0;
    if (P.sramBytes > 0) {
      gb = globalsBytes + (features.serial ? 157 : 0) + 9;
      var pc = Math.round(gb / P.sramBytes * 100);
      if (gb > P.sramBytes) note('E_RAM', { n: gb }, { line: 1, col: 1 });
      else if (gb > P.sramBytes * 0.75) note('H_RAM_LOW', { p: pc }, { line: 1, col: 1 });
    }

    R.emit = savedEmit;
    R.once.clear();

    var inits = globalInits;
    var sIdx = setupF ? setupF.idx : -1, lIdx = loopF ? loopF.idx : -1;
    function* main() {
      for (var i = 0; i < inits.length; i++) yield* inits[i]();
      if (sIdx >= 0) yield* R.F[sIdx]([]);
      for (;;) {
        R.steps++;
        if (R.now >= R.yT || R.steps >= R.yS) yield YB;
        yield* R.F[lIdx]([]);
      }
    }
    return { main: main, features: Object.keys(features), pinsUsed: pinsUsed, globalsBytes: gb };
  }
  function lastLine(ast) { var it = ast.items[ast.items.length - 1]; return it ? (it.body && it.body.eline) || it.line : 1; }

  /* ------------------------------------------------------------------ */
  /* Library objects                                                     */
  /* ------------------------------------------------------------------ */
  function newObj(cls, v) {
    if (cls === 'Servo') return { pin: -1, min: 544, max: 2400, us: 1500, att: false };
    if (cls === 'DHT') return { pin: v[0] | 0, type: v[1] | 0, last: 0, ok: false, data: [0, 0, 0, 0, 0] };
    if (cls === 'LCD') return { addr: v[0] | 0, cols: v[1] | 0, rows: v[2] | 0 };
    return {};
  }

  /* ------------------------------------------------------------------ */
  /* Builtins                                                            */
  /* ------------------------------------------------------------------ */
  function cost(R, k) { R.now += R.cost[k] || R.cost.call || 0; }
  function constPin(ctx, i, kind, how) {
    var e = ctx.args[i];
    if (!e || !e.isK) return;
    var r = checkPin(ctx.P, kind, e.cv);
    if (r.code) ctx.fail(r.code, r.vars, ctx.n);
    if (r.hint) ctx.note(r.hint, r.hvars, ctx.n);
    if (how) ctx.usePin(r.pin, how, ctx.n);
  }
  function sleepUs(R, us, k) {
    if (us <= 0) return k ? k() : undefined;
    return new Susp({ t: 'sleep', until: R.tnow() + us }, k);
  }
  function pm(R, pin, site) { if (R.modes[pin] !== 1) { R.modes[pin] = 1; R.io.pinMode(pin, 1); } }
  function u32(v) { return Math.trunc(v) >>> 0; }

  /** Uno one-tone rule (Timer2). */
  function toneOk(R, pin, site) {
    if (R.P.board === 'esp32' || !R.tone) return true;
    if (R.tone.pin !== pin && R.tone.until > R.now) { R.hintOnce('H_TONE_BUSY', site.key, {}, site); return false; }
    return true;
  }

  var MATH1 = {
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    exp: Math.exp, log: Math.log, log10: Math.log10, floor: Math.floor, ceil: Math.ceil, fabs: Math.abs, trunc: Math.trunc,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, cbrt: Math.cbrt, log2: Math.log2
  };
  function dblT(types, T) { return T.double; }

  var BUILTINS = {
    pinMode: {
      a: [2, 2], feat: 'digital', io: true,
      pre: function (c) {
        var p = c.args[0], m = c.args[1];
        if (m.isK) {
          var mode = m.cv | 0;
          if (p.isK) {
            var r = checkPin(c.P, mode === 1 ? 'dout' : 'din', p.cv);
            if (r.code) c.fail(r.code, r.vars, c.n);
            var mc = checkMode(c.P, r.pin, mode);
            if (mc) { if (mc.code.charAt(0) === 'E') c.fail(mc.code, mc.vars, c.n); else c.note(mc.code, mc.vars, c.n); }
            c.usePin(r.pin, MODE_HOW[mode] || 'INPUT', c.n);
          } else if (mode === 3 && !c.P.hasPulldown) c.fail('E_NO_PULLDOWN', {}, c.n);
        }
      },
      f: function (R, v, t, s) {
        var mode = v[1] | 0; if (mode < 0 || mode > 3) mode = 0;
        var pin = rtPin(R, mode === 1 ? 'dout' : 'din', v[0], s);
        if (pin === -1) return;
        var mc = checkMode(R.P, pin, mode);
        if (mc) { R.hintOnce(mc.code, s.key, mc.vars, s); if (mc.code.charAt(0) === 'E') return; }
        cost(R, 'pinMode');
        R.modes[pin] = mode;
        R.touch(pin, MODE_HOW[mode]);
        return R.aw(R.io.pinMode(pin, mode), noop);
      }
    },
    digitalWrite: {
      a: [2, 2], feat: 'digital', io: true,
      pre: function (c) { constPin(c, 0, 'dout', null); },
      f: function (R, v, t, s) {
        var pin = rtPin(R, 'dout', v[0], s);
        if (pin === -1) return;
        cost(R, 'digitalWrite');
        if (R.modes[pin] === undefined) R.touch(pin, 'OUTPUT');
        return R.aw(R.io.digitalWrite(pin, v[1] ? 1 : 0), noop);
      }
    },
    digitalRead: {
      a: [1, 1], t: 'int', feat: 'digital', io: true,
      pre: function (c) { constPin(c, 0, 'din', null); },
      f: function (R, v, t, s) {
        var pin = rtPin(R, 'din', v[0], s);
        if (pin === -1) return 0;
        cost(R, 'digitalRead');
        if (R.modes[pin] === undefined) R.touch(pin, 'INPUT');
        return R.aw(R.io.digitalRead(pin), function (x) { return x ? 1 : 0; });
      }
    },
    analogRead: {
      a: [1, 1], t: 'int', feat: 'analogRead', io: true,
      pre: function (c) { constPin(c, 0, 'ain', 'analog'); },
      f: function (R, v, t, s) {
        var pin = rtPin(R, 'ain', v[0], s);
        if (pin === -1) return 0;
        cost(R, 'analogRead');
        R.touch(pin, 'analog');
        return R.aw(R.io.analogRead(pin), function (x) { return x | 0; });
      }
    },
    analogWrite: {
      a: [2, 2], feat: 'pwm', io: true,
      pre: function (c) { constPin(c, 0, 'pwm', 'pwm'); },
      f: function (R, v, t, s) {
        var pin = rtPin(R, 'pwm', v[0], s), P = R.P;
        if (pin === -1) return;
        cost(R, 'analogWrite');
        var val = Math.trunc(v[1]);
        if (pin <= -2) { // Uno non-PWM pin: the core writes LOW/HIGH
          pin = -2 - pin;
          pm(R, pin, s);
          R.touch(pin, 'OUTPUT');
          return R.aw(R.io.digitalWrite(pin, val < 128 ? 0 : 1), noop);
        }
        if (R.servos > 0 && has(P.servoBreaksPwm, pin)) { R.hintOnce('W_SERVO_PWM', 'servo-pwm', {}, s); return; }
        if (R.toneUsed && has(P.toneBreaksPwm, pin)) { R.hintOnce('W_TONE_PWM', 'tone-pwm', {}, s); return; }
        var bits = P.board === 'esp32' ? R.pwmBits : P.pwmBits, max = Math.pow(2, bits) - 1;
        var hz = typeof P.pwmHz === 'object' ? P.pwmHz[pin] : P.pwmHz;
        if (val < 0) val = 0; if (val > max) val = max;
        pm(R, pin, s);
        R.touch(pin, 'pwm');
        return R.aw(R.io.analogWrite(pin, val, bits, hz), noop);
      }
    },
    analogReadResolution: {
      a: [1, 1], b: ['esp32'],
      f: function (R, v) { var b = Math.max(1, Math.min(16, v[0] | 0)); R.adcBits = b; if (R.io.setAdcBits) R.io.setAdcBits(b); }
    },
    analogWriteResolution: { a: [1, 1], b: ['esp32'], f: function (R, v) { R.pwmBits = Math.max(1, Math.min(16, v[0] | 0)); } },
    analogReference: {
      a: [1, 1], b: ['avr'],
      pre: function (c) { var e = c.args[0]; if (e.isK && e.cv !== 1) c.fail('E_UNSUPPORTED', { what: 'analogReference(INTERNAL/EXTERNAL)' }, c.n); },
      f: function (R, v, t, s) { if ((v[0] | 0) !== 1) R.hintOnce('E_UNSUPPORTED', s.key, { what: 'analogReference(INTERNAL/EXTERNAL)' }, s); }
    },
    dacWrite: {
      a: [2, 2], b: ['esp32'], feat: 'dac', io: true,
      pre: function (c) { constPin(c, 0, 'dac', 'pwm'); },
      f: function (R, v, t, s) { var pin = rtPin(R, 'dac', v[0], s); if (pin === -1) return; cost(R, 'analogWrite'); return R.aw(R.io.dacWrite(pin, v[1] & 255), noop); }
    },
    touchRead: { a: [1, 1], b: [], u: 'touchRead()' },
    ledcAttach: {
      a: [3, 3], t: 'bool', b: ['esp32'], feat: 'ledc', io: true,
      pre: function (c) { constPin(c, 0, 'pwm', 'pwm'); },
      f: function (R, v, t, s) { var pin = rtPin(R, 'pwm', v[0], s); if (pin === -1) return 0; R.ledc[pin] = { hz: v[1], bits: v[2] | 0 }; R.touch(pin, 'pwm'); return 1; }
    },
    ledcSetup: { a: [3, 3], t: 'double', b: ['esp32'], feat: 'ledc', f: function (R, v) { R.ledcCh[v[0] | 0] = { hz: v[1], bits: v[2] | 0, pins: [] }; R.ledcByCh = true; return v[1]; } },
    ledcAttachPin: {
      a: [2, 2], b: ['esp32'], feat: 'ledc',
      pre: function (c) { constPin(c, 0, 'pwm', 'pwm'); },
      f: function (R, v, t, s) { var pin = rtPin(R, 'pwm', v[0], s); if (pin === -1) return; var ch = R.ledcCh[v[1] | 0] || (R.ledcCh[v[1] | 0] = { hz: 5000, bits: 8, pins: [] }); ch.pins.push(pin); R.touch(pin, 'pwm'); }
    },
    ledcWrite: {
      a: [2, 2], t: 'bool', b: ['esp32'], feat: 'ledc', io: true,
      f: function (R, v, t, s) {
        var duty = Math.max(0, Math.trunc(v[1]));
        if (R.ledcByCh) {
          var ch = R.ledcCh[v[0] | 0];
          if (!ch) return 0;
          var res;
          for (var i = 0; i < ch.pins.length; i++) { pm(R, ch.pins[i], s); res = R.io.analogWrite(ch.pins[i], Math.min(duty, Math.pow(2, ch.bits) - 1), ch.bits, ch.hz); }
          return R.aw(res, function () { return 1; });
        }
        var pin = v[0] | 0, cfg = R.ledc[pin];
        if (!cfg) return 0;
        pm(R, pin, s);
        return R.aw(R.io.analogWrite(pin, Math.min(duty, Math.pow(2, cfg.bits) - 1), cfg.bits, cfg.hz), function () { return 1; });
      }
    },
    ledcDetach: { a: [1, 1], t: 'bool', b: ['esp32'], f: function (R, v) { delete R.ledc[v[0] | 0]; return 1; } },
    tone: {
      a: [2, 3], feat: 'tone', io: true,
      pre: function (c) { constPin(c, 0, 'dout', 'tone'); },
      f: function (R, v, t, s) {
        var pin = rtPin(R, 'dout', v[0], s);
        if (pin === -1) return;
        var hz = Math.trunc(v[1]) >>> 0, ms = v.length > 2 ? u32(v[2]) : 0;
        if (!toneOk(R, pin, s)) return;
        if (R.P.board !== 'esp32' && hz < 31) { R.hintOnce('H_TONE_BUSY', s.key + 'f', {}, s); hz = 31; }
        R.tone = { pin: pin, until: ms ? R.now + ms * 1000 : Infinity };
        R.toneUsed = true;
        R.touch(pin, 'tone');
        cost(R, 'call');
        return R.aw(R.io.tone(pin, hz, ms), noop);
      }
    },
    noTone: {
      a: [1, 1], feat: 'tone', io: true,
      f: function (R, v, t, s) {
        var pin = rtPin(R, 'dout', v[0], s);
        if (pin === -1) return;
        if (R.tone && R.tone.pin === pin) R.tone = null;
        return R.aw(R.io.noTone(pin), noop);
      }
    },
    delay: {
      a: [1, 1], blk: true,
      f: function (R, v, t, s) {
        if (R.inIsr) { R.hintOnce('H_DELAY_IN_ISR', s.key, {}, s); return; }
        var ms = u32(v[0]);
        // SPEC-GAP resolved (integrator): on the real board the queued writes go out when delay() starts (§9.2)
        if (R.wall && ms >= 1 && R.io.flush) { try { R.io.flush(); } catch (e) { /* io reports its own errors */ } }
        return sleepUs(R, ms * 1000);
      }
    },
    delayMicroseconds: {
      a: [1, 1], blk: true,
      f: function (R, v, t, s) {
        var us = R.P.intBits === 16 ? (Math.trunc(v[0]) & 0xFFFF) : u32(v[0]);
        if (R.inIsr) { R.now += us; return; }   // busy-wait: works inside ISRs too
        // SPEC-GAP resolved (integrator): on the real board the board itself waits (US op, batched with the pulse), §9.2
        if (R.wall && R.io.delayMicroseconds) return R.aw(R.io.delayMicroseconds(us), noop);
        return sleepUs(R, us);
      }
    },
    millis: { a: [0, 0], t: 'ulong', f: function (R) { return Math.floor(R.tnow() / 1000) >>> 0; } },
    micros: { a: [0, 0], t: 'ulong', f: function (R) { var t = Math.floor(R.tnow()); if (R.P.board !== 'esp32') t -= t % 4; return t >>> 0; } },
    pulseIn: { a: [2, 3], t: 'ulong', feat: 'pulseIn', blk: true, pre: function (c) { constPin(c, 0, 'din', 'INPUT'); }, f: pulseInF },
    pulseInLong: { a: [2, 3], t: 'ulong', feat: 'pulseIn', blk: true, pre: function (c) { constPin(c, 0, 'din', 'INPUT'); }, f: pulseInF },
    attachInterrupt: {
      a: [3, 3], s: 'nfn', feat: 'interrupt', io: true,
      pre: function (c) {
        var e = c.args[0], m = c.args[2];
        if (e.isK) {
          var pin = intPin(c.P, e.cv);
          if (pin < 0) { if (c.P.interruptPins === 'all') c.fail('E_BAD_PIN', { pin: e.cv, board: c.P.name }, c.n); c.fail('E_NO_INT_PIN', {}, c.n); }
          c.usePin(pin, 'INPUT', c.n);
        }
        if (m.isK && (m.cv < 1 || m.cv > 3)) c.fail('E_UNSUPPORTED', { what: 'attachInterrupt(…, LOW/HIGH)' }, c.n);
      },
      f: function (R, v, t, s) {
        var pin = intPin(R.P, v[0] | 0);
        if (pin < 0) { R.hintOnce(R.P.interruptPins === 'all' ? 'E_BAD_PIN' : 'E_NO_INT_PIN', s.key, { pin: v[0], board: R.P.name }, s); return; }
        var mode = v[2] | 0;
        if (mode < 1 || mode > 3) { R.hintOnce('E_UNSUPPORTED', s.key, { what: 'attachInterrupt(…, LOW/HIGH)' }, s); return; }
        if (!R.io.attachInterrupt) return;
        return R.aw(R.io.attachInterrupt(pin, mode, v[1] | 0), noop);
      }
    },
    detachInterrupt: {
      a: [1, 1], feat: 'interrupt', io: true,
      f: function (R, v) { var pin = intPin(R.P, v[0] | 0); if (pin < 0 || !R.io.detachInterrupt) return; return R.aw(R.io.detachInterrupt(pin), noop); }
    },
    digitalPinToInterrupt: {
      a: [1, 1], t: 'int', fold: true,
      f: function (R, v) { var p = v[0] | 0, P = R.P; if (P.interruptPins === 'all') return has(P.digitalPins, p) ? p : -1; var n = P.interruptPins[p]; return n === undefined ? -1 : n; }
    },
    interrupts: { a: [0, 0], f: function (R) { R.intOn = true; R.yS = 0; } },
    noInterrupts: { a: [0, 0], f: function (R) { R.intOn = false; } },
    sei: { a: [0, 0], b: ['avr'], f: function (R) { R.intOn = true; R.yS = 0; } },
    cli: { a: [0, 0], b: ['avr'], f: function (R) { R.intOn = false; } },
    yield: { a: [0, 0], f: noop },
    map: {
      a: [5, 5], t: 'long', fold: true,
      f: function (R, v, t, s) {
        var x = v[0] | 0, a = v[1] | 0, b = v[2] | 0, c = v[3] | 0, d = v[4] | 0;
        var run = (b - a) | 0;
        if (run === 0) { if (R.P.board === 'esp32') return -1; throw R.err('E_DIV_ZERO', {}, s); }
        return (Math.trunc(Math.imul((x - a) | 0, (d - c) | 0) / run) + c) | 0;
      }
    },
    random: {
      a: [1, 2], t: 'long', feat: 'random',
      f: function (R, v) {
        function r31() {
          var x = (R.rnd = (R.rnd + 0x6D2B79F5) >>> 0);
          x = Math.imul(x ^ (x >>> 15), x | 1);
          x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
          return ((x ^ (x >>> 14)) >>> 0) >>> 1;
        }
        if (v.length === 1) { var hb = v[0] | 0; if (hb === 0) return 0; return r31() % hb; }
        var lo = v[0] | 0, hi = v[1] | 0;
        if (lo >= hi) return lo;
        return (r31() % ((hi - lo) | 0) + lo) | 0;
      }
    },
    randomSeed: { a: [1, 1], feat: 'random', f: function (R, v) { var s = v[0] >>> 0; if (s !== 0) R.rnd = s; } },
    pow: { a: [2, 2], t: dblT, f: function (R, v) { return dbl(R, Math.pow(v[0], v[1])); } },
    atan2: { a: [2, 2], t: dblT, f: function (R, v) { return dbl(R, Math.atan2(v[0], v[1])); } },
    fmod: { a: [2, 2], t: dblT, f: function (R, v) { return dbl(R, v[0] % v[1]); } },
    hypot: { a: [2, 2], t: dblT, f: function (R, v) { return dbl(R, Math.hypot(v[0], v[1])); } },
    round: {
      a: [1, 1], t: function (types, T, P) { return P.board === 'esp32' ? T.double : T.long; },
      f: function (R, v) { var x = v[0]; if (R.P.board === 'esp32') return x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5); return (x >= 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5)) | 0; }
    },
    isnan: { a: [1, 1], t: 'int', f: function (R, v) { return v[0] !== v[0] ? 1 : 0; } },
    isinf: { a: [1, 1], t: 'int', f: function (R, v) { return v[0] === Infinity ? 1 : v[0] === -Infinity ? -1 : 0; } },
    word: {
      a: [1, 2], t: 'uint16', fold: true,
      f: function (R, v) { return v.length === 2 ? (((v[0] & 255) << 8) | (v[1] & 255)) : (v[0] & 0xFFFF); }
    },
    isDigit: chr(function (c) { return c >= 48 && c <= 57; }),
    isAlpha: chr(function (c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }),
    isAlphaNumeric: chr(function (c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }),
    isSpace: chr(function (c) { return c === 32 || (c >= 9 && c <= 13); }),
    isWhitespace: chr(function (c) { return c === 32 || c === 9; }),
    isUpperCase: chr(function (c) { return c >= 65 && c <= 90; }),
    isLowerCase: chr(function (c) { return c >= 97 && c <= 122; }),
    isPunct: chr(function (c) { return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126); }),
    toUpperCase: { a: [1, 1], t: 'int', f: function (R, v) { var c = v[0] | 0; return c >= 97 && c <= 122 ? c - 32 : c; } },
    toLowerCase: { a: [1, 1], t: 'int', f: function (R, v) { var c = v[0] | 0; return c >= 65 && c <= 90 ? c + 32 : c; } },
    strlen: { a: [1, 1], s: 's', t: 'ulong', f: function (R, v, t) { return sval(v[0], t[0]).length; } },
    strcmp: { a: [2, 2], s: 'ss', t: 'int', f: function (R, v, t) { var a = sval(v[0], t[0]), b = sval(v[1], t[1]); return a < b ? -1 : a > b ? 1 : 0; } },
    strcpy: { a: [2, 2], s: 'As', t: 'cstr', f: function (R, v, t, s) { writeC(R, v[0], sval(v[1], t[1]), 0, s); return cstrOf(v[0]); } },
    strcat: { a: [2, 2], s: 'As', t: 'cstr', f: function (R, v, t, s) { var cur = cstrOf(v[0]); writeC(R, v[0], sval(v[1], t[1]), cur.length, s); return cstrOf(v[0]); } },
    atoi: { a: [1, 1], s: 's', t: 'int', f: function (R, v, t) { var x = atol(sval(v[0], t[0])); return R.P.intBits === 16 ? (x << 16) >> 16 : x; } },
    atol: { a: [1, 1], s: 's', t: 'long', f: function (R, v, t) { return atol(sval(v[0], t[0])); } },
    atof: { a: [1, 1], s: 's', t: dblT, f: function (R, v, t) { return dbl(R, atof(sval(v[0], t[0]))); } },
    dtostrf: {
      a: [4, 4], s: 'nnnA', t: 'cstr',
      f: function (R, v, t, s) { var str = dtostrf(v[0], v[1] | 0, v[2] | 0); writeC(R, v[3], str, 0, s); return str; }
    },
    sprintf: { a: [2, 20], s: 'Asp', t: 'int', f: function (R, v, t, s) { return sprintfF(R, v, t, s, -1); } },
    snprintf: { a: [3, 20], s: 'Ansp', t: 'int', f: function (R, v, t, s) { return sprintfF(R, v, t, s, v[1] | 0); } },
    printf: { a: [1, 20], u: 'printf() (استخدموا Serial.printf)' }, // NEW COPY fragment
    malloc: { a: [1, 1], b: [], u: 'malloc' },
    esp_restart: { a: [0, 0], b: [], u: 'esp_restart()' },
    deepSleep: { a: [0, 9], b: [], u: 'deep sleep' }
  };
  BUILTINS.printf.b = [];
  for (var mk in MATH1) (function (fn) { BUILTINS[mk] = { a: [1, 1], t: dblT, fold: true, f: function (R, v) { return dbl(R, fn(v[0])); } }; })(MATH1[mk]);
  function chr(fn) { return { a: [1, 1], t: 'bool', f: function (R, v) { return fn(v[0] | 0) ? 1 : 0; } }; }
  function dbl(R, x) { return R.dbl32 ? f32(x) : x; }
  function sval(v, t) { return t && t.k === 'a' ? cstrOf(v) : String(v); }
  /** Write a C string (plus NUL) into a char array at offset; overflow → E_BOUNDS (real: memory corruption). */
  function writeC(R, A, str, at, site) {
    if (at + str.length + 1 > A.n) throw R.err('E_BOUNDS', { name: A.name, i: at + str.length, n: A.n, last: A.n - 1 }, site);
    for (var i = 0; i < str.length; i++) A.d[A.off + at + i] = (str.charCodeAt(i) << 24) >> 24;
    A.d[A.off + at + str.length] = 0;
  }
  function sprintfF(R, v, t, s, limit) {
    var off = limit >= 0 ? 3 : 2, A = v[0], fmt = sval(v[off - 1], t[off - 1]);
    var avr = R.P.board !== 'esp32';
    var out = cfmt(fmt, v.slice(off), t.slice(off), avr, function () { R.hintOnce('H_AVR_PRINTF_FLOAT', s.key, {}, s); });
    var full = out.length;
    if (limit >= 0) { if (limit === 0) return full; out = out.slice(0, limit - 1); }
    writeC(R, A, out, 0, s);
    return full;
  }

  /** pulseIn: the runner waits on io.levelAt / io.nextEdgeUs (§5); real board: io.pulseIn promise. */
  function pulseInF(R, v, t, s) {
    var pin = rtPin(R, 'din', v[0], s);
    var tmo = v.length > 2 ? u32(v[2]) : 1000000;
    if (pin === -1) return 0;
    var lvl = v[1] ? 1 : 0, io = R.io;
    R.touch(pin, 'INPUT');
    if (R.wall || !io.levelAt) {
      if (!io.pulseIn) return 0;
      return R.aw(io.pulseIn(pin, lvl, tmo), function (r) { return (r && r.width ? r.width : 0) >>> 0; });
    }
    if (R.inIsr) return 0;
    var st = 0, start = 0;
    var q = {
      t: 'wait', until: R.now + tmo, pin: pin, val: 0,
      poll: function () {
        var l = io.levelAt(pin) ? 1 : 0;
        if (st === 0) { if (l !== lvl) st = 1; else return false; }
        if (st === 1) { if (l === lvl) { st = 2; start = R.now; } else return false; }
        if (st === 2 && l !== lvl) { q.val = Math.round(R.now - start); return true; }
        return false;
      },
      tmo: function () { return 0; }
    };
    return new Susp(q, function (x) { return x >>> 0; });
  }

  /* ------------------------------------------------------------------ */
  /* Print formatting shared by Serial and LCD                           */
  /* ------------------------------------------------------------------ */
  function printBytes(R, t, v, has2, a2) {
    switch (t.k) {
      case 'i': if (t.ch && !has2) return String.fromCharCode(v & 255); return fmtInt(t, v, has2 ? a2 | 0 : 10);
      case 'b': return fmtInt(t, v, has2 ? a2 | 0 : 10);
      case 'f': return printFloat(v, has2 ? a2 | 0 : 2, R.dbl32);
      case 's': case 'c': case 'ip': return String(v);
      case 'a': return cstrOf(v);
    }
    return '';
  }
  function printArgs(nl) {
    return {
      a: nl ? [0, 2] : [1, 2], s: 'pn', t: 'ulong', blk: true, feat: 'serial',
      pre: function (c) { if (c.args[1] && !isNum(c.types[0])) c.fail('E_ARGS', { name: c.name, n: 1, m: 2 }, c.n); },
      f: function (R, v, t, s) {
        var b = v.length ? printBytes(R, t[0], v[0], v.length > 1, v[1]) : '';
        if (nl) b += '\r\n';
        return R.serWrite(b, s);
      }
    };
  }
  /** Wait for a byte in the RX buffer for up to Serial.setTimeout ms; k(byte | -1). */
  function peekT(R, k) {
    var ser = R.ser;
    if (ser.rx.length) return k(ser.rx.charCodeAt(0));
    if (R.inIsr) return k(-1);
    var q = {
      t: 'wait', until: R.tnow() + ser.timeout * 1000, val: -1,
      poll: function () { if (ser.rx.length) { q.val = ser.rx.charCodeAt(0); return true; } return false; },
      tmo: function () { return -1; }
    };
    return new Susp(q, k);
  }
  function eat(R) { R.ser.rx = R.ser.rx.slice(1); }
  /** Stream::parseInt / parseFloat (SKIP_ALL). */
  function parseNum(R, isFloat) {
    var neg = false, val = 0, frac = false, scale = 1, any = false;
    function result() { var r = neg ? -val : val; return isFloat ? f32(r) : (r | 0); }
    function isD(c) { return c >= 48 && c <= 57; }
    function skip(c) {
      for (;;) {
        if (c < 0) return 0;
        if (c === 45 || isD(c) || (isFloat && c === 46)) return digits(c, true);
        eat(R);
        if (!R.ser.rx.length) return peekT(R, skip);
        c = R.ser.rx.charCodeAt(0);
      }
    }
    function digits(c, first) {
      for (;;) {
        if (c === 45 && first) neg = true;
        else if (isFloat && c === 46 && !frac) frac = true;
        else if (isD(c)) { any = true; if (frac) { scale *= 0.1; val += (c - 48) * scale; } else val = val * 10 + (c - 48); }
        else return result();
        first = false;
        eat(R);
        if (!R.ser.rx.length) return peekT(R, function (c2) { return c2 < 0 ? result() : digits(c2, false); });
        c = R.ser.rx.charCodeAt(0);
      }
    }
    return peekT(R, skip);
  }
  function readUntil(R, term) {
    var acc = '';
    function step(c) {
      for (;;) {
        if (c < 0) return acc;
        eat(R);
        if (c === term) return acc;
        acc += String.fromCharCode(c);
        if (!R.ser.rx.length) return peekT(R, step);
        c = R.ser.rx.charCodeAt(0);
      }
    }
    return peekT(R, step);
  }

  var SER_READ = 'serialRead';
  var LCD_BYTE_US = 1300, LCD_CLEAR_US = 2000, LCD_INIT_US = 1100000, LCD_BL_US = 300; // (model) §7.4

  function lcdCall(R, self, method, args, us) {
    if (R.io.i2cCall) R.io.i2cCall(self.addr, method, args);
    return sleepUs(R, us);
  }
  function lcdPrint(nl) {
    return {
      a: nl ? [0, 2] : [1, 2], s: 'pn', t: 'ulong', blk: true,
      f: function (R, v, t, s, self) {
        var b = v.length ? printBytes(R, t[0], v[0], v.length > 1, v[1]) : '';
        if (nl) b += '\r\n';   // like the real library: CR/LF show up as garbage cells on the LCD
        if (!b.length) return 0;
        var bytes = [];
        for (var i = 0; i < b.length; i++) bytes.push(b.charCodeAt(i));
        return runChain(lcdCall(R, self, 'write', [bytes], LCD_BYTE_US * bytes.length), function () { return bytes.length; });
      }
    };
  }
  function lcdC(method, arg, us) {
    return { a: [0, 0], blk: true, f: function (R, v, t, s, self) { return lcdCall(R, self, method, arg === undefined ? [] : [arg], us); } };
  }

  function dhtRead(R, self, force) {
    var now = Math.floor(R.tnow() / 1000) >>> 0;
    if (!force && ((now - self.last) >>> 0) < 2000) return self.ok;
    self.last = now;
    var bytes = R.io.dhtRead ? R.io.dhtRead(self.pin) : null;
    var ms = self.type === 11 || self.type === 12 ? 23 : 6; // (model) start signal + 40 bits
    var ok = false;
    if (bytes && bytes.length >= 5 && (((bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 255) === (bytes[4] & 255))) {
      self.data = [bytes[0] & 255, bytes[1] & 255, bytes[2] & 255, bytes[3] & 255, bytes[4] & 255];
      ok = true;
    }
    self.ok = ok;
    return sleepUs(R, ms * 1000, function () { return ok; });
  }
  function dhtTemp(self) {
    var d = self.data, f;
    if (self.type === 11) { f = d[2]; if (d[3] & 0x80) f = -1 - f; f += (d[3] & 0x0F) * 0.1; }
    else if (self.type === 12) { f = d[2]; f += (d[3] & 0x0F) * 0.1; if (d[2] & 0x80) f *= -1; }
    else { f = (((d[2] & 0x7F) << 8) | d[3]) * 0.1; if (d[2] & 0x80) f *= -1; }
    return f32(f);
  }
  function dhtHum(self) {
    var d = self.data;
    if (self.type === 11 || self.type === 12) return f32(d[0] + d[1] * 0.1);
    return f32(((d[0] << 8) | d[1]) * 0.1);
  }
  function heatIndex(t, h, isF) {
    var T = isF ? t : t * 1.8 + 32, hi = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (h * 0.094));
    if (hi > 79) {
      hi = -42.379 + 2.04901523 * T + 10.14333127 * h - 0.22475541 * T * h - 0.00683783 * T * T - 0.05481717 * h * h + 0.00122874 * T * T * h + 0.00085282 * T * h * h - 0.00000199 * T * T * h * h;
      if (h < 13 && T >= 80.0 && T <= 112.0) hi -= ((13.0 - h) * 0.25) * Math.sqrt((17.0 - Math.abs(T - 95.0)) * 0.05882);
      else if (h > 85.0 && T >= 80.0 && T <= 87.0) hi += ((h - 85.0) * 0.1) * ((87.0 - T) * 0.2);
    }
    return isF ? hi : (hi - 32) * 0.55555;
  }

  function servoWriteUs(R, self, us) {
    if (us < self.min) us = self.min; if (us > self.max) us = self.max;
    self.us = us;
    if (self.att && R.io.servoWrite) return R.aw(R.io.servoWrite(self.pin, us), noop);
  }

  function strM(f, a, t, extra) { var d = { a: a || [0, 0], t: t || 'void', f: f }; for (var k in extra) d[k] = extra[k]; return d; }
  function bytesOf(v, t) { return t.k === 'a' ? cstrOf(v) : (t.k === 'i' && t.ch) ? String.fromCharCode(v & 255) : String(v); }

  var METHODS = {
    Serial: {
      begin: { a: [1, 4], feat: 'serial', f: function (R, v) { var b = Math.trunc(v[0]) >>> 0 || 9600; R.ser.begun = true; R.ser.baud = b; R.ser.byteUs = 1e7 / b; } },
      end: { a: [0, 0], f: function (R) { R.flushTx(Infinity); R.ser.begun = false; } },
      print: printArgs(false), println: printArgs(true),
      write: {
        a: [1, 2], s: 'pn', t: 'ulong', blk: true, feat: 'serial',
        f: function (R, v, t, s) {
          var b;
          if (v.length === 2) b = sval(v[0], t[0]).slice(0, Math.max(0, v[1] | 0));
          else if (isNum(t[0])) b = String.fromCharCode(v[0] & 255);
          else b = sval(v[0], t[0]);
          return R.serWrite(b, s);
        }
      },
      printf: {
        a: [1, 20], s: 'sp', t: 'ulong', blk: true, feat: 'serial', b: ['esp32'],
        f: function (R, v, t, s) { return R.serWrite(cfmt(sval(v[0], t[0]), v.slice(1), t.slice(1), false), s); }
      },
      available: { a: [0, 0], t: 'int', feat: SER_READ, f: function (R) { return R.ser.rx.length; } },
      availableForWrite: { a: [0, 0], t: 'int', f: function (R) { R.flushTx(R.now); return Math.max(0, 64 - R.ser.tx.length); } },
      read: { a: [0, 0], t: 'int', feat: SER_READ, f: function (R) { if (!R.ser.rx.length) return -1; var c = R.ser.rx.charCodeAt(0); eat(R); return c; } },
      peek: { a: [0, 0], t: 'int', feat: SER_READ, f: function (R) { return R.ser.rx.length ? R.ser.rx.charCodeAt(0) : -1; } },
      parseInt: { a: [0, 0], t: 'long', feat: SER_READ, blk: true, f: function (R) { return parseNum(R, false); } },
      parseFloat: { a: [0, 0], t: 'float', feat: SER_READ, blk: true, f: function (R) { return parseNum(R, true); } },
      readString: {
        a: [0, 0], t: 'String', feat: SER_READ, blk: true,
        f: function (R) { var acc = ''; function step(c) { if (c < 0) return acc; acc += R.ser.rx; R.ser.rx = ''; return peekT(R, step); } return peekT(R, step); }
      },
      readStringUntil: { a: [1, 1], t: 'String', feat: SER_READ, blk: true, f: function (R, v) { return readUntil(R, v[0] & 255); } },
      setTimeout: { a: [1, 1], f: function (R, v) { R.ser.timeout = u32(v[0]); } },
      flush: {
        a: [0, 0], blk: true,
        f: function (R) { if (R.wall) return; R.flushTx(R.now); var s = R.ser; if (!s.tx.length) return; return new Susp({ t: 'sleep', until: s.txStart + s.tx.length * s.byteUs }, noop); }
      },
      setDebugOutput: { a: [1, 1], b: ['esp32'], f: noop }
    },
    Wire: {
      begin: { a: [0, 3], f: noop },
      setClock: { a: [1, 1], f: noop },
      beginTransmission: { a: [1, 1], f: function (R, v) { R.wire.addr = v[0] & 127; } },
      write: { a: [1, 2], s: 'p', t: 'ulong', f: function (R, v, t) { return isNum(t[0]) ? 1 : sval(v[0], t[0]).length; } },
      endTransmission: {
        a: [0, 1], t: 'uint8', blk: true,
        f: function (R) { var ack = R.io.i2cProbe ? R.io.i2cProbe(R.wire.addr) : false; return sleepUs(R, 200, function () { return ack ? 0 : 2; }); } // (model) ~0.2 ms per probe
      },
      requestFrom: { a: [2, 3], t: 'uint8', f: function () { return 0; } },
      available: { a: [0, 0], t: 'int', f: function () { return 0; } },
      read: { a: [0, 0], t: 'int', f: function () { return -1; } }
    },
    WiFi: {
      mode: { a: [1, 1], t: 'bool', f: function () { return 1; } },
      begin: {
        a: [1, 3], s: 'ss', t: 'int', feat: 'wifi',
        f: function (R, v, t) {
          var ssid = sval(v[0], t[0]), pass = v.length > 1 ? sval(v[1], t[1]) : '';
          R.wifiSsid = ssid;
          if (R.io.wifiBegin) R.io.wifiBegin(I._utf8decode(ssid, true).text, I._utf8decode(pass, true).text);
          return R.io.wifiStatus ? R.io.wifiStatus() | 0 : 6;
        }
      },
      status: { a: [0, 0], t: 'int', f: function (R) { cost(R, 'call'); return R.io.wifiStatus ? R.io.wifiStatus() | 0 : 0; } },
      isConnected: { a: [0, 0], t: 'bool', f: function (R) { return R.io.wifiStatus && R.io.wifiStatus() === 3 ? 1 : 0; } },
      localIP: { a: [0, 0], t: 'IPAddress', f: function (R) { return R.io.wifiLocalIP ? String(R.io.wifiLocalIP()) : '0.0.0.0'; } },
      RSSI: { a: [0, 0], t: 'int', f: function (R) { return R.io.wifiRSSI ? R.io.wifiRSSI() | 0 : 0; } },
      SSID: { a: [0, 0], t: 'String', f: function (R) { return R.wifiSsid; } },
      macAddress: { a: [0, 0], t: 'String', f: function () { return '24:0A:C4:00:B1:DA'; } }, // (model) fake MAC
      disconnect: { a: [0, 2], t: 'bool', f: function (R) { if (R.io.wifiDisconnect) R.io.wifiDisconnect(); return 1; } },
      setHostname: { a: [1, 1], s: 's', t: 'bool', f: function () { return 1; } },
      '?softAP': 'WiFi.softAP()', '?scanNetworks': 'WiFi.scanNetworks()'
    },
    IPAddress: {
      toString: { a: [0, 0], t: 'String', f: function (R, v, t, s, self) { return self; } }
    },
    Servo: {
      attach: {
        a: [1, 3], t: 'uint8', feat: 'servo', io: true,
        pre: function (c) { constPin(c, 0, 'dout', 'servo'); },
        f: function (R, v, t, s, self) {
          var pin = rtPin(R, 'dout', v[0], s);
          if (pin === -1) return 0;
          if (v.length >= 3) { self.min = v[1] | 0; self.max = v[2] | 0; }
          if (self.att && self.pin !== pin) { if (R.io.servoDetach) R.io.servoDetach(self.pin); R.servos--; }
          if (!self.att || self.pin !== pin) R.servos++;
          self.pin = pin; self.att = true;
          R.touch(pin, 'servo');
          R.modes[pin] = 1;
          if (R.io.servoAttach) R.io.servoAttach(pin, self.min, self.max);
          var r = servoWriteUs(R, self, self.us);
          return R.aw(r, function () { return 1; });
        }
      },
      write: {
        a: [1, 1], io: true,
        f: function (R, v, t, s, self) {
          var x = Math.trunc(v[0]);
          if (x < 544) { if (x < 0) x = 0; if (x > 180) x = 180; x = Math.trunc((x * (self.max - self.min)) / 180) + self.min; }
          return servoWriteUs(R, self, x);
        }
      },
      writeMicroseconds: { a: [1, 1], io: true, f: function (R, v, t, s, self) { return servoWriteUs(R, self, Math.trunc(v[0])); } },
      read: { a: [0, 0], t: 'int', f: function (R, v, t, s, self) { return Math.trunc(((self.us + 1 - self.min) * 180) / (self.max - self.min)); } },
      readMicroseconds: { a: [0, 0], t: 'int', f: function (R, v, t, s, self) { return self.us; } },
      attached: { a: [0, 0], t: 'bool', f: function (R, v, t, s, self) { return self.att ? 1 : 0; } },
      detach: { a: [0, 0], f: function (R, v, t, s, self) { if (!self.att) return; self.att = false; R.servos--; if (R.io.servoDetach) R.io.servoDetach(self.pin); } },
      setPeriodHertz: { a: [1, 1], b: ['esp32'], f: noop }
    },
    DHT: {
      begin: { a: [0, 1], feat: 'dht', f: function (R, v, t, s, self) { self.last = (Math.floor(R.tnow() / 1000) - 2000) >>> 0; } },
      read: { a: [0, 1], t: 'bool', blk: true, f: function (R, v, t, s, self) { return dhtRead(R, self, !!v[0]); } },
      readTemperature: {
        a: [0, 2], t: 'float', blk: true,
        f: function (R, v, t, s, self) {
          var isF = !!v[0];
          return runChain(dhtRead(R, self, !!v[1]), function (ok) { if (!ok) return NaN; var c = dhtTemp(self); return isF ? f32(c * 1.8 + 32) : c; });
        }
      },
      readHumidity: { a: [0, 1], t: 'float', blk: true, f: function (R, v, t, s, self) { return runChain(dhtRead(R, self, !!v[0]), function (ok) { return ok ? dhtHum(self) : NaN; }); } },
      computeHeatIndex: { a: [2, 3], t: 'float', f: function (R, v) { return f32(heatIndex(v[0], v[1], v.length > 2 ? !!v[2] : true)); } },
      convertCtoF: { a: [1, 1], t: 'float', f: function (R, v) { return f32(v[0] * 1.8 + 32); } },
      convertFtoC: { a: [1, 1], t: 'float', f: function (R, v) { return f32((v[0] - 32) * 0.55555); } }
    },
    LCD: {
      init: lcdC('init', undefined, LCD_INIT_US), begin: { a: [0, 3], blk: true, f: function (R, v, t, s, self) { return lcdCall(R, self, 'init', [], LCD_INIT_US); } },
      clear: lcdC('clear', undefined, LCD_BYTE_US + LCD_CLEAR_US), home: lcdC('home', undefined, LCD_BYTE_US + LCD_CLEAR_US),
      setCursor: { a: [2, 2], blk: true, f: function (R, v, t, s, self) { return lcdCall(R, self, 'setCursor', [v[0] & 255, v[1] & 255], LCD_BYTE_US); } },
      print: lcdPrint(false), println: lcdPrint(true),
      write: {
        a: [1, 1], s: 'p', t: 'ulong', blk: true,
        f: function (R, v, t, s, self) {
          var b = isNum(t[0]) ? String.fromCharCode(v[0] & 255) : sval(v[0], t[0]), bytes = [];
          for (var i = 0; i < b.length; i++) bytes.push(b.charCodeAt(i));
          return runChain(lcdCall(R, self, 'write', [bytes], LCD_BYTE_US * bytes.length), function () { return bytes.length; });
        }
      },
      backlight: lcdC('backlight', true, LCD_BL_US), noBacklight: lcdC('backlight', false, LCD_BL_US),
      setBacklight: { a: [1, 1], blk: true, f: function (R, v, t, s, self) { return lcdCall(R, self, 'backlight', [!!v[0]], LCD_BL_US); } },
      display: lcdC('display', true, LCD_BYTE_US), noDisplay: lcdC('display', false, LCD_BYTE_US),
      cursor: lcdC('cursor', true, LCD_BYTE_US), noCursor: lcdC('cursor', false, LCD_BYTE_US),
      blink: lcdC('blink', true, LCD_BYTE_US), noBlink: lcdC('blink', false, LCD_BYTE_US),
      scrollDisplayLeft: lcdC('scroll', -1, LCD_BYTE_US), scrollDisplayRight: lcdC('scroll', 1, LCD_BYTE_US),
      leftToRight: lcdC('leftToRight', true, LCD_BYTE_US), rightToLeft: lcdC('leftToRight', false, LCD_BYTE_US),
      autoscroll: lcdC('autoscroll', true, LCD_BYTE_US), noAutoscroll: lcdC('autoscroll', false, LCD_BYTE_US),
      '?createChar': 'lcd.createChar()', '?printstr': 'lcd.printstr()'
    },
    String: {
      length: strM(function (R, v, t, s, x) { return x.length; }, [0, 0], 'uint'),
      charAt: strM(function (R, v, t, s, x) { var i = v[0] | 0; return i >= 0 && i < x.length ? (x.charCodeAt(i) << 24) >> 24 : 0; }, [1, 1], 'char'),
      setCharAt: strM(function (R, v, t, s, x) {
        var i = v[0] >>> 0;
        if (i < x.length) R.mstr = x.slice(0, i) + String.fromCharCode(v[1] & 255) + x.slice(i + 1);
        return v[1];
      }, [2, 2], 'char', { mut: true }),
      indexOf: strM(function (R, v, t, s, x) { return x.indexOf(bytesOf(v[0], t[0]), v.length > 1 ? Math.max(0, v[1] | 0) : 0); }, [1, 2], 'int', { s: 'pn' }),
      lastIndexOf: strM(function (R, v, t, s, x) { return x.lastIndexOf(bytesOf(v[0], t[0]), v.length > 1 ? (v[1] | 0) : Infinity); }, [1, 2], 'int', { s: 'pn' }),
      substring: strM(function (R, v, t, s, x) {
        var a = v[0] >>> 0, b = v.length > 1 ? v[1] >>> 0 : x.length;
        if (a > b) { var tmp = a; a = b; b = tmp; }
        if (a >= x.length) return '';
        return x.slice(a, Math.min(b, x.length));
      }, [1, 2], 'String'),
      startsWith: strM(function (R, v, t, s, x) { var p = sval(v[0], t[0]), off = v.length > 1 ? v[1] >>> 0 : 0; return x.length >= p.length + off && x.substr(off, p.length) === p ? 1 : 0; }, [1, 2], 'bool', { s: 'sn' }),
      endsWith: strM(function (R, v, t, s, x) { var p = sval(v[0], t[0]); return x.length >= p.length && x.slice(x.length - p.length) === p ? 1 : 0; }, [1, 1], 'bool', { s: 's' }),
      equals: strM(function (R, v, t, s, x) { return x === sval(v[0], t[0]) ? 1 : 0; }, [1, 1], 'bool', { s: 's' }),
      equalsIgnoreCase: strM(function (R, v, t, s, x) { return x.toLowerCase() === sval(v[0], t[0]).toLowerCase() ? 1 : 0; }, [1, 1], 'bool', { s: 's' }),
      compareTo: strM(function (R, v, t, s, x) {
        var y = sval(v[0], t[0]);
        for (var i = 0; i < Math.min(x.length, y.length); i++) if (x.charCodeAt(i) !== y.charCodeAt(i)) return x.charCodeAt(i) - y.charCodeAt(i);
        return x.length === y.length ? 0 : x.length > y.length ? x.charCodeAt(y.length) : -y.charCodeAt(x.length);
      }, [1, 1], 'int', { s: 's' }),
      concat: strM(function (R, v, t, s, x) { var add = strOf(t[0], v[0], R); R.mstr = R.strFit(x, x + add, s); return R.mstr.length === x.length + add.length ? 1 : 0; }, [1, 1], 'bool', { s: 'p', mut: true }),
      replace: strM(function (R, v, t, s, x) { var a = bytesOf(v[0], t[0]), b = bytesOf(v[1], t[1]); if (a.length) R.mstr = x.split(a).join(b); }, [2, 2], 'void', { s: 'pp', mut: true }),
      remove: strM(function (R, v, t, s, x) { var i = v[0] >>> 0, n = v.length > 1 ? v[1] >>> 0 : x.length; if (i < x.length) R.mstr = x.slice(0, i) + x.slice(Math.min(x.length, i + n)); }, [1, 2], 'void', { mut: true }),
      toInt: strM(function (R, v, t, s, x) { return atol(x); }, [0, 0], 'long'),
      toFloat: strM(function (R, v, t, s, x) { return f32(atof(x)); }, [0, 0], 'float'),
      toDouble: strM(function (R, v, t, s, x) { return dbl(R, atof(x)); }, [0, 0], 'double'),
      trim: strM(function (R, v, t, s, x) { R.mstr = x.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, ''); }, [0, 0], 'void', { mut: true }),
      toUpperCase: strM(function (R, v, t, s, x) { R.mstr = x.replace(/[a-z]+/g, function (m) { return m.toUpperCase(); }); }, [0, 0], 'void', { mut: true }),
      toLowerCase: strM(function (R, v, t, s, x) { R.mstr = x.replace(/[A-Z]+/g, function (m) { return m.toLowerCase(); }); }, [0, 0], 'void', { mut: true }),
      c_str: strM(function (R, v, t, s, x) { return x; }, [0, 0], 'cstr'),
      reserve: strM(function () { return 1; }, [1, 1], 'bool'),
      isEmpty: strM(function (R, v, t, s, x) { return x.length ? 0 : 1; }, [0, 0], 'bool'),
      toCharArray: strM(function (R, v, t, s, x) {
        var A = v[0], n = Math.min(v[1] >>> 0, A.n);
        if (!n) return;
        var str = x.slice(0, n - 1);
        for (var i = 0; i < str.length; i++) A.d[A.off + i] = (str.charCodeAt(i) << 24) >> 24;
        A.d[A.off + str.length] = 0;
      }, [2, 2], 'void', { s: 'An' }),
      getBytes: strM(function (R, v, t, s, x) {
        var A = v[0], n = Math.min(v[1] >>> 0, A.n);
        if (!n) return;
        var str = x.slice(0, n - 1);
        for (var i = 0; i < str.length; i++) A.d[A.off + i] = str.charCodeAt(i) & 255;
        A.d[A.off + str.length] = 0;
      }, [2, 2], 'void', { s: 'An' })
    }
  };
  /** Apply k to a value or to the eventual value of a Susp chain. */
  function runChain(r, k) {
    if (r instanceof Susp) { var k0 = r.k; return new Susp(r.q, function (x) { return runChain(k0 ? k0(x) : x, k); }); }
    return k(r);
  }
  I._codegen = codegen;
  I._fmt = { printFloat: printFloat, fmtInt: fmtInt, cfmt: cfmt, dtostrf: dtostrf };
  I._checkPin = checkPin;
})(typeof window !== 'undefined' ? window : globalThis);
