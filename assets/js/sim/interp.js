/* «بإيدك» lab simulator — Arduino C++ interpreter, part 1 of 2 (B1).
 *
 * Pipeline (spec §7.1):
 *   source → lexer (comments, literals, line/col) → preprocessor (#include, object-like #define)
 *          → recursive-descent parser → AST → codegen (interp-2.js: scopes, static types per
 *          board, constant folding, profile checks, closures + generators) → runner.
 *
 * This file: message table, lexer, preprocessor, parser, runner (scheduler: virtual time,
 * budgets, sleeps/waits, interrupts, serial TX timing) and the public API
 *   Interp.compile(source, profile), Interp.createRunner(program, opts), Interp.MSG, Interp.FEATURE_IO.
 * interp-2.js: codegen, Arduino core API, String, Serial, Servo/Wire/LCD/DHT/WiFi wrappers.
 *
 * SPEC-GAP: split — interp.js would exceed 150 KB, so it is split into interp.js + interp-2.js
 * (same namespace pattern; load interp-2.js immediately after interp.js; Node tests load both).
 *
 * Safety: visitor code is never passed to eval / new Function. It is tokenized and parsed here
 * and executed by closures/generators built from the AST.
 */
(function (root) {
  'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};
  var I = NS.Interp = NS.Interp || {};

  /* ------------------------------------------------------------------ */
  /* Messages (§7.9). Every interpreter message carries msg_ar.          */
  /* ------------------------------------------------------------------ */
  var MSG = {
    E_SYNTAX: ['error', 'فيه غلط في الكتابة هنا: كنا مستنيين {expected} ولقينا {found}.'],
    E_SEMI: ['error', 'ناقص «;» في آخر السطر ده.'],
    E_BRACE: ['error', 'فيه قوس «{open}» مفتوح ومش مقفول.'],
    E_UNDECLARED: ['error', '«{name}» مش متعرّف. نسيتوا تعرّفوه، ولا مكتوب غلط؟ الحروف الكبيرة والصغيرة بتفرق.'],
    E_REDECL: ['error', '«{name}» متعرّف قبل كده في نفس المكان.'],
    E_ARGS: ['error', 'الدالة {name} محتاجة {n} مدخلات، وانتو حاطين {m}.'],
    E_TYPE: ['error', 'ما ينفعش تحطّوا {from} في {to}.'],
    E_CONST: ['error', '«{name}» ثابت (const)، ما ينفعش تغيّروه.'],
    E_NO_SETUP: ['error', 'الكود لازم يكون فيه void setup() وvoid loop().'],
    E_NO_LOOP: ['error', 'ناقص void loop(). حتى لو فاضية، لازم تكون موجودة.'],
    E_LIB_INCLUDE: ['error', 'علشان تستخدموا {cls} لازم تكتبوا ‎#include <{h}>‎ فوق.'],
    E_LIB_UNKNOWN: ['error', 'المكتبة {h} مش موجودة في المعمل. المتاح على {board}: {list}.'],
    E_SERVO_ESP32: ['error', 'على الـESP32 استخدموا ‎#include <ESP32Servo.h>‎ بدل Servo.h.'],
    E_NO_MEMBER: ['error', '{obj} مفيهاش {member} على {board}.'],
    E_UNSUPPORTED: ['error', '{what} مش مدعوم في المعمل لسه.'],
    E_BAD_PIN: ['error', 'الطرف {pin} مش موجود في {board}.'],
    E_INPUT_ONLY: ['error', 'الأطراف 34 و35 و36 و39 في الـESP32 دخل بس، ما ينفعش تطلّعوا منها.'],
    E_NO_PULLDOWN: ['error', 'الـUno مفيهوش INPUT_PULLDOWN. استخدموا مقاومة 10k لـGND، أو INPUT_PULLUP واعكسوا القراية.'],
    E_NOT_ADC: ['error', 'الطرف {pin} ما بيقراش analog في {board}.'],
    E_NO_INT_PIN: ['error', 'الـinterrupt في الـUno على الطرفين 2 و3 بس.'],
    E_RAM: ['error', 'الذاكرة مش هتكفي: الكود محتاج حوالي {n} بايت والـUno فيه 2048 بس.'],
    E_DIV_ZERO: ['error', 'قسمة على صفر في السطر ده. الكارت الحقيقي هيطلّع نتيجة غلط أو يعمل ريستارت.'],
    E_BOUNDS: ['error', 'خرجتوا برّه حدود المصفوفة {name}: الخانة {i} والمصفوفة حجمها {n} (من 0 لـ{last}).'],
    E_STACK: ['error', 'الذاكرة خلصت: الدالة {name} بتنادي نفسها كتير قوي.'],
    E_ISR_LONG: ['error', 'الـinterrupt ده طويل قوي. خلّوه قصير، وسيبوا الشغل التقيل لـloop().'],
    E_REAL_IO: ['error', 'الجهاز ما ردّش على الأمر: {detail}'],
    // NEW COPY: dacWrite on a pin without DAC (ESP32 DAC is only on GPIO25/26).
    E_NOT_DAC: ['error', 'الطرف {pin} مفيهوش DAC. في الـESP32 الـdacWrite على 25 و26 بس.'],
    // NEW COPY: a bug inside the simulator itself (never the visitor's fault).
    E_INTERNAL: ['error', 'حصل خطأ جوّه المحاكي نفسه ({detail}). ده مش غلطكم. جرّبوا تشغّلوا تاني.'],
    W_NO_PULL: ['warn', 'الطرف {pin} مفيهوش pull-up داخلي. حطّوا مقاومة 10k.'],
    W_SERIAL_PINS: ['warn', 'الأطراف {pins} هي خط السيريال (USB). لو استخدمتوها مع Serial الاتنين هيلخبطوا بعض.'],
    W_SERVO_PWM: ['warn', 'مكتبة Servo على الـUno بتوقّف analogWrite على الطرفين 9 و10.'],
    W_TONE_PWM: ['warn', 'tone() على الـUno بتبوّظ analogWrite على الطرفين 3 و11.'],
    H_INT_OVERFLOW: ['hint', 'الرقم عدّى أكبر قيمة للـ{type} ({max}) ولفّ. على الـUno الـint من ‎-32768‎ لـ32767. استخدموا long أو اكتبوا الرقم كده: 60000UL.'],
    H_PTR_ADD: ['hint', '"نص" + رقم في C++ مش بيلزق الرقم في النص. اكتبوا String("نص") + رقم، أو اطبعوهم على مرتين.'],
    H_UNINIT: ['hint', 'المتغير {name} اتقري قبل ما ياخد قيمة. على الكارت الحقيقي قيمته هتبقى أي حاجة.'],
    H_NOT_PWM: ['hint', 'الطرف {pin} في الـUno مش PWM. analogWrite عليه بيدّي LOW أو HIGH بس. أطراف الـPWM: 3 و5 و6 و9 و10 و11.'],
    H_ANALOG_CHANNEL: ['hint', 'analogRead({n}) على الـUno بتقرا A{n}. الأوضح تكتبوا A{n}.'],
    H_NO_SERIAL_BEGIN: ['hint', 'بتطبعوا على Serial من غير Serial.begin()، فمفيش حاجة هتظهر.'],
    H_SERIAL_RX_FULL: ['hint', 'الكارت ما لحقش يقرا: البيانات اللي اتبعتت أكتر من مساحة الاستقبال واتفقد منها جزء.'],
    H_DELAY_IN_ISR: ['hint', 'delay() جوّه الـinterrupt ما بيشتغلش، وmillis() بيقف.'],
    H_SERIAL_IN_ISR: ['hint', 'الطباعة جوّه الـinterrupt ممكن توقّف الكارت. الأحسن تغيّروا متغير volatile وتطبعوا في loop().'],
    H_AVR_PRINTF_FLOAT: ['hint', 'sprintf على الـUno ما بتطبعش float (بتطلّع ‎?‎). استخدموا dtostrf أو Serial.print(x, 2).'],
    H_RAM_LOW: ['hint', 'الذاكرة قربت تخلص ({p}٪). الكارت ممكن يهنّج.'],
    // NEW COPY (spec §7.9 marks it NEW COPY)
    H_TONE_BUSY: ['hint', 'الـUno بيطلّع نغمة واحدة بس في نفس الوقت، وأقل تردد 31 هرتز. وقّفوا الأولى بـnoTone() قبل التانية.']
  };
  // Small Arabic fragments used inside {vars} of the messages above.
  var AR = {
    eof: 'آخر الكود',                         // NEW COPY: "found: end of the code"
    pointers: 'المؤشرات (pointers)',            // NEW COPY
    noNet: 'الإنترنت الحقيقي مش متاح في المعمل', // spec §7.4 wording
    expr: 'قيمة أو متغير',                      // NEW COPY: "expected: a value or a variable"
    type: 'نوع متغير',                          // NEW COPY: "expected: a type"
    name: 'اسم',                                // NEW COPY: "expected: a name"
    realOnly: 'على الجهاز الحقيقي'              // NEW COPY
  };
  var MSG_PUBLIC = {};
  Object.keys(MSG).forEach(function (k) { MSG_PUBLIC[k] = { sev: MSG[k][0], ar: MSG[k][1] }; });

  /** Build a message object {code, sev, msg_ar, line?, col?, vars}. */
  function mkMsg(code, vars, line, col) {
    var m = MSG[code] || MSG.E_INTERNAL;
    vars = vars || {};
    var ar = m[1].replace(/\{(\w+)\}/g, function (all, k) { return vars[k] != null ? String(vars[k]) : all; });
    var o = { code: MSG[code] ? code : 'E_INTERNAL', sev: m[0], msg_ar: ar, vars: vars };
    if (line) { o.line = line; o.col = col || 1; }
    return o;
  }

  /** Compile-time error (thrown by lexer/parser, caught by compile()). */
  function CErr(code, vars, line, col) { this.code = code; this.vars = vars; this.line = line; this.col = col; }
  /** Runtime error (thrown by generated code, caught by the runner). */
  function RtErr(code, vars, line, col) { this.code = code; this.vars = vars; this.line = line; this.col = col; }

  /* ------------------------------------------------------------------ */
  /* UTF-8 helpers. Interpreter strings are "byte strings": each JS char */
  /* is one byte 0..255 (so String.length() counts UTF-8 bytes, like the */
  /* real board).                                                        */
  /* ------------------------------------------------------------------ */
  function utf8(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0x800) out += String.fromCharCode(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out += String.fromCharCode(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out += String.fromCharCode(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  /** Streaming UTF-8 decoder: returns {text, rest} where rest = incomplete trailing bytes. */
  function utf8decode(b, final) {
    var out = '', i = 0, n = b.length;
    while (i < n) {
      var c = b.charCodeAt(i), need = c < 0x80 ? 0 : (c >> 5) === 6 ? 1 : (c >> 4) === 14 ? 2 : (c >> 3) === 30 ? 3 : -1;
      if (need < 0) { out += '�'; i++; continue; }
      if (i + need >= n && need > 0 && !final) break;
      var cp = need === 0 ? c : c & (0x3F >> need), ok = true;
      for (var k = 1; k <= need; k++) {
        var d = b.charCodeAt(i + k);
        if (isNaN(d) || (d & 0xC0) !== 0x80) { ok = false; break; }
        cp = (cp << 6) | (d & 63);
      }
      if (!ok) { out += '�'; i++; continue; }
      out += cp >= 0x10000 ? String.fromCharCode(0xD800 + ((cp - 0x10000) >> 10), 0xDC00 + ((cp - 0x10000) & 1023)) : String.fromCharCode(cp);
      i += need + 1;
    }
    return { text: out, rest: b.slice(i) };
  }
  I._utf8 = utf8; I._utf8decode = utf8decode;

  /* ------------------------------------------------------------------ */
  /* Lexer                                                               */
  /* ------------------------------------------------------------------ */
  var OPS3 = ['<<=', '>>=', '...'];
  var OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '::'];
  var OPS1 = '+-*/%=<>!&|^~?:;,.(){}[]';

  /**
   * Tokenize. Token: {k: 'id'|'num'|'str'|'chr'|'op'|'pp'|'eof', v, line, col, el, ec, ...}.
   * (el, ec) = line/col of the token's last char (used to place «missing ;» on the right line).
   */
  function lex(src, line0) {
    var toks = [], i = 0, n = src.length, line = line0 || 1, col = 1, lineStart = true;
    function err(code, vars) { throw new CErr(code, vars, line, col); }
    function adv(k) { for (var j = 0; j < k; j++) { if (src[i] === '\n') { line++; col = 1; lineStart = true; } else col++; i++; } }
    while (i < n) {
      var c = src[i];
      if (c === '\n') { adv(1); continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { adv(1); continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(1); continue; }
      if (c === '/' && src[i + 1] === '*') {
        var sl = line, sc = col; adv(2);
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) adv(1);
        if (i >= n) throw new CErr('E_BRACE', { open: '/*' }, sl, sc);
        adv(2); continue;
      }
      var tl = line, tc = col;
      if (c === '#' && lineStart) {
        // directive: read to end of line, joining "\\\n" continuations
        var txt = ''; adv(1);
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { adv(src[i + 1] === '\r' ? 3 : 2); txt += ' '; continue; }
          txt += src[i]; adv(1);
        }
        toks.push({ k: 'pp', v: txt, line: tl, col: tc, el: tl, ec: tc });
        continue;
      }
      lineStart = false;
      if (/[A-Za-z_]/.test(c)) {
        var s = i; while (i < n && /[A-Za-z0-9_]/.test(src[i])) adv(1);
        toks.push({ k: 'id', v: src.slice(s, i), line: tl, col: tc, el: line, ec: col - 1 });
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var t = lexNumber(src, i, tl, tc); adv(t.len);
        t.el = line; t.ec = col - 1; toks.push(t); continue;
      }
      if (c === '"' || c === "'") {
        var q = c, val = ''; adv(1);
        while (i < n && src[i] !== q) {
          if (src[i] === '\n') throw new CErr('E_SYNTAX', { expected: q, found: AR.eof }, tl, tc);
          if (src[i] === '\\') {
            var e = src[i + 1]; adv(2);
            if (e === 'n') val += '\n'; else if (e === 't') val += '\t'; else if (e === 'r') val += '\r';
            else if (e === 'a') val += '\x07'; else if (e === 'b') val += '\b'; else if (e === 'f') val += '\f'; else if (e === 'v') val += '\v';
            else if (e === 'x') { var h = ''; while (/[0-9a-fA-F]/.test(src[i] || '') && h.length < 2) { h += src[i]; adv(1); } val += String.fromCharCode(parseInt(h || '0', 16) & 255); }
            else if (/[0-7]/.test(e)) { var o = e; while (/[0-7]/.test(src[i] || '') && o.length < 3) { o += src[i]; adv(1); } val += String.fromCharCode(parseInt(o, 8) & 255); }
            else if (e === '\n') { /* line continuation inside a string */ }
            else val += utf8(e || '');
            continue;
          }
          // normal char (may be non-ASCII → UTF-8 bytes)
          var cc = src[i], cp = src.charCodeAt(i);
          if (cp >= 0xD800 && cp <= 0xDBFF) { cc = src.slice(i, i + 2); adv(1); }
          val += utf8(cc); adv(1);
        }
        if (i >= n) throw new CErr('E_SYNTAX', { expected: q, found: AR.eof }, tl, tc);
        adv(1);
        if (q === '"') toks.push({ k: 'str', v: val, line: tl, col: tc, el: line, ec: col - 1 });
        else {
          if (val.length !== 1) throw new CErr('E_UNSUPPORTED', { what: "'" + utf8decode(val, true).text + "' (حرف عربي أو أكتر من حرف بين ' ')" }, tl, tc); // NEW COPY fragment
          toks.push({ k: 'chr', v: val.charCodeAt(0), line: tl, col: tc, el: line, ec: col - 1 });
        }
        continue;
      }
      var three = src.substr(i, 3), two = src.substr(i, 2);
      if (OPS3.indexOf(three) >= 0) { adv(3); toks.push({ k: 'op', v: three, line: tl, col: tc, el: line, ec: col - 1 }); continue; }
      if (OPS2.indexOf(two) >= 0) { adv(2); toks.push({ k: 'op', v: two, line: tl, col: tc, el: line, ec: col - 1 }); continue; }
      if (OPS1.indexOf(c) >= 0) { adv(1); toks.push({ k: 'op', v: c, line: tl, col: tc, el: line, ec: col }); continue; }
      // anything else: smart quotes, Arabic letters outside strings, '@', '$', '`'...
      var bad = c, bcp = src.charCodeAt(i);
      if (bcp >= 0xD800 && bcp <= 0xDBFF) bad = src.slice(i, i + 2);
      throw new CErr('E_SYNTAX', { expected: AR.expr, found: bad }, tl, tc);
    }
    toks.push({ k: 'eof', v: '', line: line, col: col, el: line, ec: col });
    return toks;
  }

  /** Number literal with C type rules (§7.3). Returns token {k:'num', v, ty, len}. */
  function lexNumber(src, i, line, col) {
    var s = i, n = src.length, isFloat = false, base = 10, digits;
    var m;
    var rest = src.slice(i, i + 80);
    if ((m = /^0[xX]([0-9a-fA-F]+)/.exec(rest))) { base = 16; digits = m[1]; i += m[0].length; }
    else if ((m = /^0[bB]([01]+)/.exec(rest))) { base = 2; digits = m[1]; i += m[0].length; }
    else if ((m = /^(\d*\.\d*(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)/.exec(rest)) && /[.eE]/.test(m[1]) && m[1] !== '.') { isFloat = true; digits = m[1]; i += m[0].length; }
    else if ((m = /^0([0-7]+)/.exec(rest))) { base = 8; digits = m[1]; i += m[0].length; if (/[89]/.test(src[i] || '')) throw new CErr('E_SYNTAX', { expected: '0-7', found: src[i] }, line, col); }
    else { m = /^\d+/.exec(rest); digits = m[0]; i += m[0].length; }
    var suf = /^[uUlLfF]*/.exec(src.slice(i, i + 4))[0];
    i += suf.length;
    if (/[A-Za-z_0-9]/.test(src[i] || '')) throw new CErr('E_SYNTAX', { expected: AR.expr, found: src.slice(s, i + 1) }, line, col);
    var su = suf.toLowerCase();
    if (isFloat) {
      if (/u/.test(su)) throw new CErr('E_SYNTAX', { expected: AR.expr, found: src.slice(s, i) }, line, col);
      return { k: 'num', v: parseFloat(digits), ty: /f/.test(su) ? 'float' : 'double', len: i - s, line: line, col: col };
    }
    if (/f/.test(su)) throw new CErr('E_SYNTAX', { expected: AR.expr, found: src.slice(s, i) }, line, col);
    if (/ll/.test(su)) throw new CErr('E_UNSUPPORTED', { what: 'long long' }, line, col);
    var v = parseInt(digits, base);
    // the type is decided per board in codegen (int width differs); keep the literal class here
    return { k: 'num', v: v, ty: 'int', lit: { dec: base === 10, u: /u/.test(su), l: /l/.test(su) }, len: i - s, line: line, col: col };
  }

  /* ------------------------------------------------------------------ */
  /* Preprocessor: #include, object-like #define/#undef, #pragma once.   */
  /* ------------------------------------------------------------------ */
  function preprocess(toks) {
    var out = [], defs = Object.create(null), includes = [];
    function expand(t, active, at) {
      if (t.k === 'id' && defs[t.v] && !active[t.v]) {
        active[t.v] = true;
        var body = defs[t.v];
        for (var j = 0; j < body.length; j++) expand(body[j], active, at || t);
        active[t.v] = false;
        return;
      }
      if (at) { var c = {}; for (var key in t) c[key] = t[key]; c.line = at.line; c.col = at.col; c.el = at.el; c.ec = at.ec; out.push(c); }
      else out.push(t);
    }
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.k !== 'pp') { expand(t, {}, null); continue; }
      var txt = t.v.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, ' ').trim();
      var m = /^(\w*)\s*([\s\S]*)$/.exec(txt), d = m[1], rest = m[2];
      if (d === 'include') {
        var im = /^[<"]\s*([^>"]+?)\s*[>"]/.exec(rest);
        if (!im) throw new CErr('E_SYNTAX', { expected: '<…>', found: rest || AR.eof }, t.line, t.col);
        includes.push({ h: im[1], quoted: rest[0] === '"', line: t.line, col: t.col });
      } else if (d === 'define') {
        var dm = /^([A-Za-z_]\w*)(\(?)/.exec(rest);
        if (!dm) throw new CErr('E_SYNTAX', { expected: AR.name, found: rest || AR.eof }, t.line, t.col);
        if (dm[2]) throw new CErr('E_UNSUPPORTED', { what: '#define ' + dm[1] + '(…) (macro بمدخلات)' }, t.line, t.col); // NEW COPY fragment
        var body = lex(rest.slice(dm[1].length), t.line);
        body.pop(); // eof
        for (var b = 0; b < body.length; b++) if (body[b].k === 'pp') throw new CErr('E_SYNTAX', { expected: AR.expr, found: '#' }, t.line, t.col);
        defs[dm[1]] = body;
      } else if (d === 'undef') {
        delete defs[rest.trim()];
      } else if (d === 'pragma') {
        if (rest.trim() !== 'once') throw new CErr('E_UNSUPPORTED', { what: '#pragma ' + rest.trim() }, t.line, t.col);
      } else if (d === '') {
        /* null directive */
      } else {
        throw new CErr('E_UNSUPPORTED', { what: '#' + d }, t.line, t.col);
      }
    }
    return { toks: out, includes: includes, defines: defs };
  }

  /* ------------------------------------------------------------------ */
  /* Parser                                                              */
  /* ------------------------------------------------------------------ */
  // canonical type names: void bool char int8 uint8 int16 uint16 int uint long ulong float double String cstr
  var NAMED_TYPES = {
    void: 'void', bool: 'bool', boolean: 'bool', byte: 'uint8', uint8_t: 'uint8', int8_t: 'int8', word: 'uint16',
    uint16_t: 'uint16', int16_t: 'int16', uint32_t: 'ulong', int32_t: 'long', size_t: 'ulong', float: 'float', double: 'double',
    String: 'String'
  };
  var SPEC_KW = { unsigned: 1, signed: 1, short: 1, long: 1, int: 1, char: 1 };
  var QUALS = { const: 1, static: 1, volatile: 1, PROGMEM: 1, inline: 1, register: 1, extern: 1, constexpr: 1 };
  var CLASSES = { Servo: 1, DHT: 1, LiquidCrystal_I2C: 1, IPAddress: 1 };
  var NET_CLASSES = { WiFiClient: 1, WiFiServer: 1, HTTPClient: 1, WebServer: 1, WiFiUDP: 1, WiFiClientSecure: 1, AsyncWebServer: 1 };
  var UNSUP_KW = { struct: 'struct', class: 'class', union: 'union', typedef: 'typedef', template: 'template', goto: 'goto', new: 'new', delete: 'delete', operator: 'operator', namespace: 'namespace', using: 'using', try: 'try/catch', throw: 'throw', asm: 'asm', __asm__: 'asm', auto: 'auto', int64_t: 'int64_t', uint64_t: 'uint64_t', malloc: 'malloc', free: 'free', this: 'this' };
  var ATTRS = { IRAM_ATTR: 1, ICACHE_RAM_ATTR: 1, ARDUINO_ISR_ATTR: 1 };

  function Parser(toks, enums) { this.t = toks; this.i = 0; this.enums = enums || Object.create(null); }
  var PP = Parser.prototype;
  PP.peek = function (o) { return this.t[Math.min(this.i + (o || 0), this.t.length - 1)]; };
  PP.next = function () { var t = this.t[this.i]; if (this.i < this.t.length - 1) this.i++; return t; };
  PP.prev = function () { return this.t[Math.max(0, this.i - 1)]; };
  PP.is = function (v, o) { var t = this.peek(o); return (t.k === 'op' || t.k === 'id') && t.v === v; };
  PP.isOp = function (v, o) { var t = this.peek(o); return t.k === 'op' && t.v === v; };
  PP.tokText = function (t) { return t.k === 'eof' ? AR.eof : t.k === 'str' ? '"…"' : t.k === 'chr' ? "'…'" : String(t.k === 'num' ? (t.raw || t.v) : t.v); };
  PP.fail = function (expected, t) { t = t || this.peek(); throw new CErr('E_SYNTAX', { expected: expected, found: this.tokText(t) }, t.line, t.col); };
  PP.expect = function (v) {
    var t = this.peek();
    if (t.k === 'op' && t.v === v) return this.next();
    if (v === ';') { var p = this.prev(); throw new CErr('E_SEMI', {}, p.el || p.line, (p.ec || p.col) + 1); }
    if (t.k === 'eof' && (v === '}' || v === ')' || v === ']')) this.fail('«' + v + '»', t);
    this.fail('«' + v + '»', t);
  };
  PP.ident = function () { var t = this.peek(); if (t.k !== 'id') this.fail(AR.name, t); this.next(); return t; };
  PP.unsup = function (what, t) { t = t || this.peek(); throw new CErr('E_UNSUPPORTED', { what: what }, t.line, t.col); };

  /** Is the token at offset o the start of a type? */
  PP.isTypeAt = function (o) {
    var t = this.peek(o);
    if (t.k !== 'id') return false;
    return !!(NAMED_TYPES[t.v] || SPEC_KW[t.v] || QUALS[t.v] || this.enums[t.v] || CLASSES[t.v] || NET_CLASSES[t.v]);
  };
  /** A declaration starts here (type keyword, or class/enum name followed by a name). */
  PP.isDeclStart = function () {
    var t = this.peek();
    if (t.k !== 'id') return false;
    if (NAMED_TYPES[t.v] === 'String' || CLASSES[t.v] || NET_CLASSES[t.v] || this.enums[t.v]) {
      var n = this.peek(1);
      return n.k === 'id' || (n.k === 'op' && (n.v === '&' || n.v === '*'));
    }
    return !!(NAMED_TYPES[t.v] || SPEC_KW[t.v] || QUALS[t.v]);
  };

  /** Parse a type specifier: qualifiers + base + optional "*" (char* only). */
  PP.typeSpec = function () {
    var first = this.peek(), q = {}, words = [], named = null, cls = null;
    for (;;) {
      var t = this.peek();
      if (t.k !== 'id') break;
      if (QUALS[t.v]) { q[t.v] = true; this.next(); continue; }
      if (UNSUP_KW[t.v] && !named && !words.length) this.unsup(UNSUP_KW[t.v], t);
      if (SPEC_KW[t.v] && !named && !cls) { words.push(t.v); this.next(); continue; }
      if (!words.length && !named && !cls) {
        if (NAMED_TYPES[t.v]) { named = NAMED_TYPES[t.v]; this.next(); continue; }
        if (this.enums[t.v]) { named = 'int'; this.next(); continue; }
        if (CLASSES[t.v]) { cls = t.v; this.next(); continue; }
        if (NET_CLASSES[t.v]) this.unsup(t.v + ' (' + AR.noNet + ')', t);
      }
      break;
    }
    var base;
    if (cls) base = cls;
    else if (named) base = named;
    else if (words.length) {
      var w = words.slice().sort().join(' ');
      var map = {
        'char': 'char', 'char signed': 'int8', 'char unsigned': 'uint8',
        'short': 'int16', 'int short': 'int16', 'short signed': 'int16', 'int short signed': 'int16',
        'short unsigned': 'uint16', 'int short unsigned': 'uint16',
        'int': 'int', 'signed': 'int', 'int signed': 'int', 'unsigned': 'uint', 'int unsigned': 'uint',
        'long': 'long', 'int long': 'long', 'long signed': 'long', 'int long signed': 'long',
        'long unsigned': 'ulong', 'int long unsigned': 'ulong'
      };
      if (/long.*long/.test(w)) this.unsup('long long', first);
      if (words.length === 1 && words[0] === 'long' && this.is('double')) { this.next(); base = 'double'; }
      else base = map[w];
      if (!base) this.fail(AR.type, first);
    } else {
      if (q.const || q.static || q.volatile) this.fail(AR.type, this.peek());
      return null;
    }
    // trailing const (e.g. "char const *")
    while (this.is('const') || this.is('volatile')) { q[this.next().v] = true; }
    var ptr = false;
    if (this.isOp('*')) {
      if (base !== 'char') this.unsup(AR.pointers);
      this.next(); ptr = true; base = 'cstr';
      while (this.is('const') || this.is('PROGMEM')) this.next();
      if (this.isOp('*')) this.unsup(AR.pointers);
    }
    return { name: base, isConst: !!q.const && !ptr, ptrConst: !!q.const, isStatic: !!q.static, isVolatile: !!q.volatile, line: first.line, col: first.col };
  };

  PP.program = function () {
    var items = [];
    while (this.peek().k !== 'eof') {
      var t = this.peek();
      if (t.k === 'op' && t.v === ';') { this.next(); continue; }
      if (t.k === 'id' && t.v === 'enum') { items.push(this.enumDecl()); continue; }
      if (t.k === 'id' && UNSUP_KW[t.v]) this.unsup(UNSUP_KW[t.v], t);
      if (t.k === 'id' && t.v === 'using') this.unsup('using', t);
      if (!this.isTypeAt(0)) {
        if (t.k === 'id' && this.isOp('(', 1)) {
          // function without return type ("setup() {"), common beginner slip
          this.fail(AR.type, t);
        }
        this.fail(AR.type, t);
      }
      items.push(this.topDecl());
    }
    return items;
  };

  PP.enumDecl = function () {
    var kw = this.next(), name = null;
    if (this.peek().k === 'id' && !this.isOp('{')) { name = this.next().v; if (name === 'class') this.unsup('enum class', kw); }
    if (name) this.enums[name] = true;
    this.expect('{');
    var items = [];
    while (!this.isOp('}')) {
      var id = this.ident(), val = null;
      if (this.isOp('=')) { this.next(); val = this.expr(); }
      items.push({ name: id.v, val: val, line: id.line, col: id.col });
      if (this.isOp(',')) { this.next(); continue; }
      if (!this.isOp('}')) this.fail('«,» / «}»');
    }
    this.expect('}');
    var vars = null;
    if (this.peek().k === 'id') { // enum E {…} var;
      vars = [];
      do { var vt = this.ident(); vars.push({ name: vt.v, dims: [], init: null, line: vt.line, col: vt.col }); } while (this.isOp(',') && this.next());
    }
    this.expect(';');
    return { T: 'Enum', name: name, items: items, vars: vars, line: kw.line, col: kw.col };
  };

  PP.topDecl = function () {
    var spec = this.typeSpec();
    while (this.peek().k === 'id' && ATTRS[this.peek().v]) this.next();
    var nameTok = this.ident();
    if (this.isOp('(') && !CLASSES[spec.name] && !(spec.name === 'String' && this.looksLikeCtorArgs())) {
      return this.funcRest(spec, nameTok);
    }
    if (this.isOp('::')) this.unsup('::', this.peek());
    return this.declRest(spec, nameTok, true);
  };
  /** For "String s(...)" at global scope: constructor call vs function definition. */
  PP.looksLikeCtorArgs = function () {
    var a = this.peek(1);
    // 'String f()' is a function (C++'s most vexing parse), 'String f(int x)' too; 'String s("x")' is a constructor
    if (a.k === 'op' && a.v === ')') return false;
    if (a.k === 'id' && (this.isTypeAt(1) || a.v === 'void')) return false;
    return true;
  };

  PP.funcRest = function (spec, nameTok) {
    this.expect('(');
    var params = [];
    if (this.is('void') && this.isOp(')', 1)) this.next();
    while (!this.isOp(')')) {
      var pt = this.peek();
      if (pt.k === 'op' && pt.v === '...') this.unsup('... (variadic)', pt);
      var ps = this.typeSpec();
      if (!ps) this.fail(AR.type);
      var ref = false;
      if (this.isOp('&')) { this.next(); ref = true; }
      if (this.isOp('*')) this.unsup(AR.pointers);
      var pn = null;
      if (this.peek().k === 'id') pn = this.next();
      var dims = [];
      while (this.isOp('[')) {
        this.next();
        if (this.isOp(']')) { dims.push(null); this.next(); }
        else { dims.push(this.expr()); this.expect(']'); }
      }
      if (this.isOp('=')) this.unsup('default arguments', this.peek());
      params.push({ spec: ps, ref: ref, name: pn ? pn.v : null, dims: dims, line: (pn || pt).line, col: (pn || pt).col });
      if (this.isOp(',')) { this.next(); continue; }
      if (!this.isOp(')')) this.fail('«,» / «)»');
    }
    this.expect(')');
    while (this.peek().k === 'id' && ATTRS[this.peek().v]) this.next();
    if (this.isOp(';')) { this.next(); return { T: 'Proto', spec: spec, name: nameTok.v, params: params, line: nameTok.line, col: nameTok.col }; }
    if (!this.isOp('{')) this.fail('«{»');
    var body = this.block();
    return { T: 'Func', spec: spec, name: nameTok.v, params: params, body: body, line: nameTok.line, col: nameTok.col };
  };

  /** Rest of a variable/object declaration after "type name". */
  PP.declRest = function (spec, nameTok, global) {
    var decls = [];
    for (;;) {
      var d = { name: nameTok.v, dims: [], init: null, args: null, line: nameTok.line, col: nameTok.col };
      while (this.isOp('[')) {
        this.next();
        if (this.isOp(']')) { d.dims.push(null); this.next(); }
        else { d.dims.push(this.expr()); this.expect(']'); }
      }
      if (d.dims.length > 2) this.unsup('arrays > 2D', nameTok);
      if (this.isOp('(')) {
        // constructor-style init: Servo s; DHT d(2, DHT11); String s("x"); int x(5);
        this.next(); d.args = [];
        while (!this.isOp(')')) { d.args.push(this.assign()); if (this.isOp(',')) this.next(); else if (!this.isOp(')')) this.fail('«,» / «)»'); }
        this.expect(')');
      } else if (this.isOp('=')) {
        this.next();
        if (this.isOp('{')) d.init = this.initList();
        else d.init = this.assign();
      } else if (this.isOp('{')) {
        d.init = this.initList(); // C++11 brace init: int x{5}; int a[3]{1,2,3};
      }
      decls.push(d);
      if (this.isOp(',')) {
        this.next();
        if (this.isOp('*') && spec.name === 'cstr') this.next();
        nameTok = this.ident(); continue;
      }
      break;
    }
    this.expect(';');
    return { T: 'Decl', spec: spec, decls: decls, global: !!global, line: spec.line, col: spec.col };
  };

  PP.initList = function () {
    var open = this.expect('{'), items = [];
    while (!this.isOp('}')) {
      if (this.peek().k === 'eof') throw new CErr('E_BRACE', { open: '{' }, open.line, open.col);
      items.push(this.isOp('{') ? this.initList() : this.assign());
      if (this.isOp(',')) { this.next(); continue; }
      if (!this.isOp('}')) this.fail('«,» / «}»');
    }
    this.next();
    return { T: 'Init', items: items, line: open.line, col: open.col };
  };

  PP.block = function () {
    var open = this.expect('{'), body = [];
    while (!this.isOp('}')) {
      if (this.peek().k === 'eof') throw new CErr('E_BRACE', { open: '{' }, open.line, open.col);
      body.push(this.stmt());
    }
    var close = this.next();
    return { T: 'Block', body: body, line: open.line, col: open.col, eline: close.line };
  };

  PP.stmt = function () {
    var t = this.peek();
    if (t.k === 'op') {
      if (t.v === '{') return this.block();
      if (t.v === ';') { this.next(); return { T: 'Empty', line: t.line, col: t.col }; }
    }
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': {
          this.next(); this.expect('('); var c = this.expr(); this.expect(')');
          var a = this.stmt(), b = null;
          if (this.is('else') && this.peek().k === 'id') { this.next(); b = this.stmt(); }
          return { T: 'If', c: c, a: a, b: b, line: t.line, col: t.col };
        }
        case 'while': {
          this.next(); this.expect('('); var wc = this.expr(); this.expect(')');
          return { T: 'While', c: wc, body: this.stmt(), line: t.line, col: t.col };
        }
        case 'do': {
          this.next(); var db = this.stmt();
          if (!this.is('while')) this.fail('while');
          this.next(); this.expect('('); var dc = this.expr(); this.expect(')'); this.expect(';');
          return { T: 'Do', c: dc, body: db, line: t.line, col: t.col };
        }
        case 'for': {
          this.next(); this.expect('(');
          var init = null, cond = null, upd = null;
          if (this.isOp(';')) this.next();
          else if (this.isDeclStart()) { var sp = this.typeSpec(); init = this.declRest(sp, this.ident(), false); }
          else { init = { T: 'Expr', e: this.exprList(), line: this.peek().line, col: this.peek().col }; this.expect(';'); }
          if (!this.isOp(';')) cond = this.expr();
          this.expect(';');
          if (!this.isOp(')')) upd = this.exprList();
          this.expect(')');
          return { T: 'For', init: init, c: cond, upd: upd, body: this.stmt(), line: t.line, col: t.col };
        }
        case 'switch': {
          this.next(); this.expect('('); var se = this.expr(); this.expect(')');
          var open = this.expect('{'), body = [];
          while (!this.isOp('}')) {
            var ct = this.peek();
            if (ct.k === 'eof') throw new CErr('E_BRACE', { open: '{' }, open.line, open.col);
            if (ct.k === 'id' && ct.v === 'case') {
              this.next(); var cv = this.ternary();
              if (this.isOp('...')) this.unsup('case a ... b', ct);
              this.expect(':'); body.push({ T: 'Case', e: cv, line: ct.line, col: ct.col }); continue;
            }
            if (ct.k === 'id' && ct.v === 'default') { this.next(); this.expect(':'); body.push({ T: 'Case', e: null, line: ct.line, col: ct.col }); continue; }
            body.push(this.stmt());
          }
          this.next();
          return { T: 'Switch', e: se, body: body, line: t.line, col: t.col };
        }
        case 'break': this.next(); this.expect(';'); return { T: 'Break', line: t.line, col: t.col };
        case 'continue': this.next(); this.expect(';'); return { T: 'Continue', line: t.line, col: t.col };
        case 'return': {
          this.next(); var re = null;
          if (!this.isOp(';')) re = this.expr();
          this.expect(';');
          return { T: 'Return', e: re, line: t.line, col: t.col };
        }
        case 'case': case 'default': this.fail(AR.expr, t); break;
        case 'else': this.fail(AR.expr, t); break;
        case 'enum': this.unsup('enum جوّه دالة', t); break; // NEW COPY fragment
      }
      if (UNSUP_KW[t.v]) this.unsup(UNSUP_KW[t.v], t);
      if (this.isDeclStart()) {
        var spec = this.typeSpec();
        if (this.isOp('&')) this.unsup('references (&) جوّه الدالة', this.peek()); // NEW COPY fragment
        var nt = this.ident();
        if (this.isOp('(') && !CLASSES[spec.name] && spec.name !== 'String' && this.isTypeAt(1)) this.unsup('دالة جوّه دالة', nt); // NEW COPY fragment
        return this.declRest(spec, nt, false);
      }
    }
    var e = this.expr();
    this.expect(';');
    return { T: 'Expr', e: e, line: t.line, col: t.col };
  };

  PP.exprList = function () {
    var first = this.expr();
    if (!this.isOp(',')) return first;
    var list = [first];
    while (this.isOp(',')) { this.next(); list.push(this.expr()); }
    return { T: 'Comma', list: list, line: first.line, col: first.col };
  };
  PP.expr = function () { return this.assign(); };
  var ASSIGN_OPS = { '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1, '&=': 1, '|=': 1, '^=': 1, '<<=': 1, '>>=': 1 };
  PP.assign = function () {
    var a = this.ternary(), t = this.peek();
    if (t.k === 'op' && ASSIGN_OPS[t.v]) {
      this.next();
      var b = this.isOp('{') ? this.initList() : this.assign();
      return { T: 'Asg', op: t.v, a: a, b: b, line: t.line, col: t.col };
    }
    return a;
  };
  PP.ternary = function () {
    var c = this.binary(0);
    if (this.isOp('?')) {
      var q = this.next(); var a = this.expr(); this.expect(':'); var b = this.assign();
      return { T: 'Tern', c: c, a: a, b: b, line: q.line, col: q.col };
    }
    return c;
  };
  var BIN_LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  PP.binary = function (lvl) {
    if (lvl >= BIN_LEVELS.length) return this.unary();
    var a = this.binary(lvl + 1);
    for (;;) {
      var t = this.peek();
      if (t.k !== 'op' || BIN_LEVELS[lvl].indexOf(t.v) < 0) return a;
      this.next();
      var b = this.binary(lvl + 1);
      a = { T: (t.v === '&&' || t.v === '||') ? 'Log' : 'Bin', op: t.v, a: a, b: b, line: t.line, col: t.col };
    }
  };
  PP.unary = function () {
    var t = this.peek();
    if (t.k === 'op') {
      if (t.v === '!' || t.v === '~' || t.v === '-' || t.v === '+') { this.next(); return { T: 'Un', op: t.v, a: this.unary(), line: t.line, col: t.col }; }
      if (t.v === '++' || t.v === '--') { this.next(); return { T: 'Pre', op: t.v, a: this.unary(), line: t.line, col: t.col }; }
      if (t.v === '&' || t.v === '*') this.unsup(AR.pointers, t);
      if (t.v === '(' && this.isTypeAt(1)) {
        // C cast "(type) expr" — but not "(String)" used as a value
        var save = this.i;
        this.next();
        var spec = this.typeSpec();
        if (spec && this.isOp(')')) { this.next(); return { T: 'Cast', spec: spec, a: this.unary(), line: t.line, col: t.col }; }
        this.i = save;
      }
    }
    if (t.k === 'id' && t.v === 'sizeof') {
      this.next();
      if (this.isOp('(') && this.isTypeAt(1)) {
        var s2 = this.i; this.next(); var sp = this.typeSpec();
        if (sp && this.isOp(')')) { this.next(); return { T: 'Sizeof', spec: sp, line: t.line, col: t.col }; }
        this.i = s2;
      }
      return { T: 'Sizeof', a: this.unary(), line: t.line, col: t.col };
    }
    return this.postfix();
  };
  PP.args = function () {
    this.expect('(');
    var args = [];
    while (!this.isOp(')')) {
      if (this.peek().k === 'eof') this.fail('«)»');
      args.push(this.assign());
      if (this.isOp(',')) { this.next(); continue; }
      if (!this.isOp(')')) this.fail('«,» / «)»');
    }
    this.next();
    return args;
  };
  PP.postfix = function () {
    var e = this.primary();
    for (;;) {
      var t = this.peek();
      if (t.k !== 'op') return e;
      if (t.v === '[') { this.next(); var ix = this.expr(); this.expect(']'); e = { T: 'Idx', a: e, i: ix, line: t.line, col: t.col }; continue; }
      if (t.v === '(') {
        var args = this.args();
        if (e.T === 'Id') e = { T: 'Call', name: e.name, args: args, line: e.line, col: e.col };
        else if (e.T === 'Mem') e = { T: 'MCall', o: e.o, name: e.name, args: args, line: e.line, col: e.col };
        else if (e.T === 'Scope') e = { T: 'SCall', cls: e.cls, name: e.name, args: args, line: e.line, col: e.col };
        else this.unsup(AR.pointers, t);
        continue;
      }
      if (t.v === '.') { this.next(); var m = this.ident(); e = { T: 'Mem', o: e, name: m.v, line: m.line, col: m.col }; continue; }
      if (t.v === '->') this.unsup('->', t);
      if (t.v === '::') {
        if (e.T !== 'Id') this.unsup('::', t);
        this.next(); var sm = this.ident(); e = { T: 'Scope', cls: e.name, name: sm.v, line: e.line, col: e.col }; continue;
      }
      if (t.v === '++' || t.v === '--') { this.next(); e = { T: 'Post', op: t.v, a: e, line: t.line, col: t.col }; continue; }
      return e;
    }
  };
  PP.primary = function () {
    var t = this.peek();
    if (t.k === 'num') { this.next(); return { T: 'Num', v: t.v, ty: t.ty, lit: t.lit, line: t.line, col: t.col }; }
    if (t.k === 'chr') { this.next(); return { T: 'Chr', v: t.v, line: t.line, col: t.col }; }
    if (t.k === 'str') {
      var s = ''; this.next(); s = t.v;
      while (this.peek().k === 'str') s += this.next().v;
      return { T: 'Str', v: s, line: t.line, col: t.col };
    }
    if (t.k === 'op' && t.v === '(') {
      this.next(); var e = this.exprList(); this.expect(')');
      return e;
    }
    if (t.k === 'op' && t.v === '[') this.unsup('lambda', t);
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') { this.next(); return { T: 'Bool', v: t.v === 'true' ? 1 : 0, line: t.line, col: t.col }; }
      if (UNSUP_KW[t.v]) this.unsup(UNSUP_KW[t.v], t);
      if (NET_CLASSES[t.v]) this.unsup(t.v + ' (' + AR.noNet + ')', t);
      if (t.v === 'static_cast' || t.v === 'reinterpret_cast' || t.v === 'const_cast') {
        if (t.v !== 'static_cast') this.unsup(t.v, t);
        this.next(); this.expect('<'); var cs = this.typeSpec(); if (!cs) this.fail(AR.type);
        this.expect('>'); this.expect('('); var ce = this.expr(); this.expect(')');
        return { T: 'Cast', spec: cs, a: ce, line: t.line, col: t.col };
      }
      // functional cast / constructor: int(x), float(x), String(x, HEX), byte(x)
      if ((NAMED_TYPES[t.v] || SPEC_KW[t.v]) && this.isOp('(', 1) && t.v !== 'word') {
        var fs = this.typeSpec();
        var fa = this.args();
        return { T: 'Ctor', spec: fs, args: fa, line: t.line, col: t.col };
      }
      if (CLASSES[t.v] && this.isOp('(', 1)) {
        this.next(); var ca = this.args();
        return { T: 'Ctor', spec: { name: t.v }, args: ca, line: t.line, col: t.col };
      }
      this.next();
      return { T: 'Id', name: t.v, line: t.line, col: t.col };
    }
    this.fail(AR.expr, t);
  };

  /** Parse a whole sketch → {items, includes}. Throws CErr. */
  function parse(source) {
    var toks = lex(String(source).replace(/\r\n?/g, '\n'));
    var pp = preprocess(toks);
    // pre-scan enum names so "State s;" parses as a declaration anywhere
    var enums = Object.create(null), tk = pp.toks;
    for (var i = 0; i + 1 < tk.length; i++) if (tk[i].k === 'id' && tk[i].v === 'enum' && tk[i + 1].k === 'id' && tk[i + 1].v !== 'class') enums[tk[i + 1].v] = true;
    var p = new Parser(tk, enums);
    var items = p.program();
    return { items: items, includes: pp.includes, enums: enums };
  }
  I._parse = parse; I._lex = lex;

  /* ------------------------------------------------------------------ */
  /* Public: compile                                                     */
  /* ------------------------------------------------------------------ */
  /**
   * Interp.compile(source, profile) → { ok:true, program, msgs } | { ok:false, msgs }
   * program = { features, pinsUsed, globalsBytes, board, ... } (spec §6.1).
   */
  function compile(source, profile) {
    var msgs = [];
    var ast;
    try {
      ast = parse(source);
    } catch (e) {
      if (e instanceof CErr) { msgs.push(mkMsg(e.code, e.vars, e.line, e.col)); return { ok: false, msgs: msgs }; }
      msgs.push(mkMsg('E_INTERNAL', { detail: String(e && e.message || e) }, 1, 1));
      return { ok: false, msgs: msgs };
    }
    var res;
    try {
      res = I._codegen(ast, profile, null, { msgs: msgs });
    } catch (e2) {
      if (e2 instanceof CErr) msgs.push(mkMsg(e2.code, e2.vars, e2.line, e2.col));
      else { msgs.push(mkMsg('E_INTERNAL', { detail: String(e2 && e2.message || e2) }, 1, 1)); if (typeof console !== 'undefined') console.error(e2); }
      return { ok: false, msgs: dedupe(msgs) };
    }
    msgs = dedupe(msgs);
    var hasErr = msgs.some(function (m) { return m.sev === 'error'; });
    if (hasErr) return { ok: false, msgs: msgs };
    var program = {
      board: profile.board,
      profile: profile,
      source: String(source),
      ast: ast,
      features: res.features,
      pinsUsed: res.pinsUsed,
      globalsBytes: res.globalsBytes
    };
    return { ok: true, program: program, msgs: msgs };
  }
  function dedupe(msgs) {
    var seen = {}, out = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i], k = m.code + ':' + (m.line || 0) + ':' + (m.col || 0) + ':' + m.msg_ar;
      if (seen[k]) continue; seen[k] = 1; out.push(m);
    }
    out.sort(function (a, b) { return (a.line || 0) - (b.line || 0) || (a.col || 0) - (b.col || 0); });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Runner (scheduler)                                                  */
  /* ------------------------------------------------------------------ */
  var YB = I._YB = { t: 'budget' };       // shared "budget check" yield request
  function nowMs() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }

  function Runner(program, opts) {
    this.program = program;
    this.opts = opts || {};
    this.io = this.opts.io;
    this.P = this.opts.profile || program.profile;
    this.state = 'stopped';
    this.R = null;
    this.gen = null;
    this.susp = null;
    this.rv = undefined;
    this.restartAt = null;
  }
  var RP = Runner.prototype;

  RP._setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    if (this.opts.onState) { try { this.opts.onState(s); } catch (e) { /* UI errors must not kill the run */ } }
  };
  RP._emit = function (m) { if (this.opts.onMsg) { try { this.opts.onMsg(m); } catch (e) { /* ignore */ } } };

  /** Reset io, init globals, run setup() then loop() forever (spec §6.1). */
  RP.start = function () {
    var self = this, io = this.io, wall = io && io.timeMode === 'wall';
    var R = I._newRuntime(this.P, io, wall, {
      emit: function (m) { self._emit(m); },
      out: function (text, baud) { if (self.opts.onSerialOut) { try { self.opts.onSerialOut(text, baud); } catch (e) { /* ignore */ } } }
    });
    var code = I._codegen(this.program.ast, this.P, R, { msgs: null });
    R.t0 = nowMs();
    this.R = R;
    this.gen = code.main();
    this.susp = null; this.rv = undefined; this.restartAt = null;
    this.wallStart = nowMs();
    try { if (io.reset) io.reset(); } catch (e) { /* io is defensive */ }
    if (io.setClock) io.setClock(function () { return R.tnow(); });
    if (io.setInterruptSink) io.setInterruptSink(function (id) { self.raise(id); });
    this._setState('running');
  };

  RP.stop = function () {
    if (this.R) this._flushTx(true);
    this.gen = null; this.susp = null; this.restartAt = null;
    this._setState('stopped');
  };

  RP.now = function () { return this.R ? this.R.tnow() : 0; };

  /** Queue an ISR (called by io's interrupt sink). */
  RP.raise = function (id) {
    var R = this.R;
    if (!R || !this.gen) return;
    if (R.isrQ.length < 64) R.isrQ.push(id);
    R.yS = 0; // force a yield at the next statement boundary
  };

  /** Append bytes typed in the serial monitor to the RX buffer. */
  RP.serialIn = function (text) {
    var R = this.R;
    if (!R) return;
    var b = utf8(String(text)), cap = R.rxCap, room = cap - R.ser.rx.length;
    if (!R.ser.begun) return; // UART not enabled: bytes are lost, like the real board
    if (b.length > room) {
      R.ser.rx += b.slice(0, Math.max(0, room));
      R.hintOnce('H_SERIAL_RX_FULL', 'rx', {}, null);
    } else R.ser.rx += b;
  };

  RP.stats = function () {
    var R = this.R;
    if (!R) return { steps: 0, simUs: 0, wallMs: 0, ratio: 0 };
    var wallMs = nowMs() - this.wallStart;
    return { steps: R.steps, simUs: R.now, wallMs: wallMs, ratio: wallMs > 0 ? R.now / (wallMs * 1000) : 0 };
  };

  RP.pinsTouched = function () {
    var R = this.R, out = [];
    if (!R) return out;
    R.touched.forEach(function (v) { out.push({ pin: v.pin, how: v.how }); });
    return out;
  };

  /** Pass due io events, then run queued ISRs. */
  RP._events = function () {
    var R = this.R, io = this.io;
    if (io.nextEventUs && io.tick) {
      var ev = io.nextEventUs();
      if (ev <= R.now) io.tick(R.now);
    }
    if (R.isrQ.length) this._isrs();
  };

  RP._isrs = function () {
    var R = this.R;
    if (R.inIsr || !R.intOn) return;
    var guard = 0;
    while (R.isrQ.length && R.intOn && guard++ < 64) this._runIsr(R.isrQ.shift());
  };

  RP._runIsr = function (id) {
    var R = this.R, fn = R.F[id];
    if (!fn) return;
    var g = fn([]), steps0 = R.steps, saveT = R.yT, v;
    R.inIsr = true; R.yT = Infinity;
    try {
      for (;;) {
        R.yS = R.steps + 1024;
        var it = g.next(v); v = undefined;
        if (it.done) break;
        var q = it.value;
        if (R.steps - steps0 > 10000) throw new RtErr('E_ISR_LONG', {}, R.isrLine[id] || 0, 1);
        if (q === YB) continue;
        if (q.t === 'sleep') continue;            // delay() inside an ISR does nothing (millis frozen)
        if (q.t === 'wait') { v = q.tmo ? q.tmo() : undefined; continue; }
        if (q.t === 'await') throw new RtErr('E_REAL_IO', { detail: 'interrupt' }, R.isrLine[id] || 0, 1);
      }
    } finally {
      R.inIsr = false; R.yT = saveT;
    }
  };

  /** Serial TX: move bytes that have "left the wire" by now to onSerialOut. */
  RP._flushTx = function (all) { if (this.R) this.R.flushTx(all ? Infinity : this.R.now); };

  /**
   * Advance until virtual time reaches targetUs or the wall budget is used (spec §7.5).
   * Never blocks longer than wallBudgetMs.
   */
  RP.runUntil = function (targetUs, wallBudgetMs) {
    var R = this.R;
    if (!R || !this.gen || this.state === 'stopped' || this.state === 'error') return { state: this.state, now: R ? R.tnow() : 0 };
    var io = this.io, wall = R.wall;
    var wEnd = nowMs() + (wallBudgetMs > 0 ? wallBudgetMs : 8);
    if (wall) targetUs = Infinity;
    if (!(targetUs >= 0)) targetUs = R.now;
    try {
      for (;;) {
        if (this.restartAt != null) {
          if (targetUs < this.restartAt) { R.now = Math.max(R.now, targetUs); break; }
          var start = this.restartAt; this.restartAt = null;
          R.now = start;
          this.start();      // panic reboot: back to setup()
          return { state: this.state, now: this.R.now };
        }
        if (this.susp) {
          if (!this._waitStep(targetUs, wEnd)) break;
          continue;
        }
        if (wall) R.now = (nowMs() - R.t0) * 1000;
        R.yS = R.steps + 1024;
        var ne = io.nextEventUs ? io.nextEventUs() : Infinity;
        R.yT = wall ? Infinity : (ne > R.now && ne < targetUs ? ne : targetUs);
        var it = this.gen.next(this.rv);
        this.rv = undefined;
        if (it.done) { this.gen = null; this._setState('stopped'); break; }
        var q = it.value;
        if (q === YB) {
          if (wall) R.now = (nowMs() - R.t0) * 1000;
          this._events();
          if (R.now >= targetUs || nowMs() >= wEnd) { this._setState('running'); break; }
          continue;
        }
        this.susp = q;
        if (q.t === 'await') {
          q.done = false;
          q.promise.then(function (v) { q.done = true; q.val = v; }, function (e) { q.done = true; q.err = e || 'error'; });
        }
      }
    } catch (e) {
      this._fail(e);
    }
    this._flushTx(false);
    return { state: this.state, now: R.now };
  };

  /** One sleep/wait/await step. Returns true when the generator should resume. */
  RP._waitStep = function (targetUs, wEnd) {
    var s = this.susp, R = this.R, io = this.io;
    if (s.t === 'await') {
      if (!s.done) { this._setState('waiting'); return false; }
      this.susp = null;
      if (s.err) throw new RtErr('E_REAL_IO', { detail: String(s.err && s.err.message || s.err) }, s.line || 0, s.col || 1);
      this.rv = s.post ? s.post(s.val) : s.val;
      this._setState('running');
      return true;
    }
    if (R.wall) {
      R.now = (nowMs() - R.t0) * 1000;
      if (R.isrQ.length) this._isrs();
      if (s.poll && s.poll()) { this.susp = null; this.rv = s.val; this._setState('running'); return true; }
      if (R.now >= s.until) { this.susp = null; this.rv = s.tmo ? s.tmo() : undefined; this._setState('running'); return true; }
      this._setState(s.t === 'sleep' ? 'sleeping' : 'waiting');
      return false;
    }
    var guard = 0, n = 0;
    for (;;) {
      if (s.poll && s.poll()) { this.susp = null; this.rv = s.val; this._setState('running'); return true; }
      if (R.now >= s.until) { this.susp = null; this.rv = s.tmo ? s.tmo() : undefined; this._setState('running'); return true; }
      var wake = s.until;
      var ev = io.nextEventUs ? io.nextEventUs() : Infinity;
      if (ev < wake) wake = ev;
      if (s.pin != null && io.nextEdgeUs) { var e2 = io.nextEdgeUs(s.pin, R.now); if (e2 < wake) wake = e2; }
      if (wake <= R.now) {
        wake = R.now;
        if (++guard > 200) { // io keeps announcing an event it does not consume: move on
          wake = Math.min(s.until, targetUs, R.now + 1);
        }
      } else guard = 0;
      if (wake > targetUs) {
        if (targetUs > R.now) R.now = targetUs;
        if (io.tick) io.tick(R.now);
        if (R.isrQ.length) this._isrs();
        if (s.poll && s.poll()) { this.susp = null; this.rv = s.val; this._setState('running'); return true; }
        this._setState(s.t === 'sleep' ? 'sleeping' : 'waiting');
        return false;
      }
      R.now = wake;
      if (io.tick) io.tick(wake);
      if (R.isrQ.length) this._isrs();
      if ((++n & 63) === 0 && nowMs() >= wEnd) { this._setState(s.t === 'sleep' ? 'sleeping' : 'waiting'); return false; }
    }
  };

  RP._fail = function (e) {
    var R = this.R;
    if (e instanceof RtErr) {
      this._emit(mkMsg(e.code, e.vars, e.line, e.col));
      if (e.code === 'E_DIV_ZERO' && this.P.board === 'esp32') {
        // ESP32 panic handler: message at 115200, reboot after ~1 s (spec §7.3)
        R.flushTx(Infinity);
        R.out("Guru Meditation Error: Core  1 panic'ed (IntegerDivideByZero). Exception was unhandled.\r\n", 115200);
        this.gen = null; this.susp = null;
        this.restartAt = R.now + 1e6;
        this.gen = { next: function () { return { done: false, value: YB }; } }; // placeholder until reboot
        this._setState('reset');
        return;
      }
    } else if (e instanceof CErr) {
      this._emit(mkMsg(e.code, e.vars, e.line, e.col));
    } else {
      this._emit(mkMsg('E_INTERNAL', { detail: String(e && e.message || e) }, 0, 0));
      if (typeof console !== 'undefined') console.error(e);
    }
    this.gen = null; this.susp = null;
    this._setState('error');
  };

  function createRunner(program, opts) {
    if (!program || !program.ast) throw new Error('Interp.createRunner: program from Interp.compile() expected');
    if (!opts || !opts.io) throw new Error('Interp.createRunner: opts.io required');
    return new Runner(program, opts);
  }

  /* ------------------------------------------------------------------ */
  /* Exports                                                             */
  /* ------------------------------------------------------------------ */
  I.compile = compile;
  I.createRunner = createRunner;
  I.MSG = MSG_PUBLIC;
  I.FEATURE_IO = { lcd: 'lcd', wire: 'i2c', dht: 'dht', servo: 'servo', wifi: 'wifi', interrupt: 'interrupt', dac: 'dac', ledc: 'ledc', tone: 'tone', pulseIn: 'pulseIn', pwm: 'pwm', analogRead: 'analogRead' };
  I._mkMsg = mkMsg; I._CErr = CErr; I._RtErr = RtErr; I._AR = AR; I._nowMs = nowMs;
  I._CLASSES = CLASSES;
})(typeof window !== 'undefined' ? window : globalThis);
