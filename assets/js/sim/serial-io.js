/* serial-io.js — «المعمل» real-board backend (IO.Real) over Web Serial, protocol v2 (lab-sim-spec.md §5, §9, §10.4, §10.5).
 *
 * What lives here:
 *   NS.IO.Real.openPort(serialPort, opts) -> Promise<conn>   the opened-port wrapper sim-main passes to create()
 *   NS.IO.Real.ping(conn, opts)            -> Promise<{ board, tag, version }>   token PING handshake (+ retries)
 *   NS.IO.Real.create({ port: conn, profile, onMsg, onLine, onFatal?, onTraffic? }) -> io   the §5 IO interface
 *   NS.IO.Real.check({ ... })              -> { ok, reason, msg_ar }   stage-2 refusal rules (features, board, reserved pins)
 *   NS.IO.Real.pinsSummary(pins, profile)  -> [{ pin, label, how, text_ar }]   rows for the «قبل ما نبعت لجهازكم» dialog
 *   NS.IO.Real.Gate.create(opts)           -> gate   stage-1 gating window (3 s sim time with zero error/warn)
 *   NS.IO.Real.BOARDS / TAGS / AR          tables (whitelists per board, PING tags, Arabic copy)
 *
 * Wire protocol v2 (page -> board):  "X <seq> <op>[;<op>]*"  or  "PING <token>"     (115200 8N1, "\n" line end, ≤ 200 bytes)
 *   ops: PM p m(I|O|U|D) · DW p v · DR p · AR p · AW p v(0..255) · TN p hz ms · NT p · US n(≤10000) · PI p lvl tmo(≤100000) · RS
 * board -> page:  "ok <seq>[ r1 r2 …]"  |  "err <seq> <CODE> <opIndex>"  |  "ok PING <token> <BOARD> 2"  |  "ready beedak-bridge 2 <BOARD>"
 *   Any other line is a device line: it goes to onLine() and never counts as a reply.
 *
 * Rules kept from the old lab: replies are matched by seq (stale replies ignored), PING carries a fresh token,
 * a line with no reply in 2 s stops the run, a lost port stops the run, and nothing is sent before stage 1 passed
 * (sim-main asks check() + Gate; this file never decides to send by itself).
 *
 * No DOM access at load time; navigator/TextEncoder/TextDecoder/setTimeout are read only inside functions,
 * so Node tests can load this file with a mock conn.
 */
(function (root) {
  'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};
  NS.IO = NS.IO || {};

  /* ------------------------------------------------------------------ copy ------------------------------------------------------------------ */
  var AR = {
    // spec §9.2 / §10.4 / §10.5 (verbatim)
    reserved: 'الكود بيستخدم الطرف {pin}، وده محجوز على الجهاز الحقيقي (خط الـUSB أو الفلاش).',
    unsupported: 'الكود ده بيستخدم {libs}، ودي لسه ما بتشتغلش على الجهاز الحقيقي من المتصفح. جرّبوها على المحاكي.',
    mismatch: 'الكود متجرّب على {sim}، والجهاز المتوصل {real}. اختاروا نفس الكارت في المعمل.',
    locked: 'بيستنى الخطوة 1 تنجح من غير مشاكل.',
    noDevice: 'وصّلوا جهازكم الأول (Chrome أو Edge على الكمبيوتر).',
    pulseTmo: 'على الجهاز الحقيقي من المتصفح، pulseIn بيستنى 100 مللي ثانية بالكتير.',
    realIo: 'الجهاز ما ردّش على الأمر: {detail}',             // = Interp.MSG.E_REAL_IO (used only if Interp is not loaded)
    feat: { servo: 'السيرفو', lcd: 'الشاشة LCD', i2c: 'الشاشة LCD', dht: 'حساس DHT', wifi: 'الواي فاي', interrupt: 'الـinterrupt',
      dac: 'dacWrite', ledc: 'ledc' },                          // dac / ledc names: NEW COPY (identifiers only)
    // NEW COPY: stage-1 gate status lines are spec §10.4 verbatim; the rest below is new
    gateRunning: 'شغال على المحاكي… لازم يكمّل {secs} من غير مشاكل.',   // {secs}/{probs}: secsAr/probsAr, batch 4
    gatePass: 'نجح: {secs} من غير أخطاء ولا تحذيرات.',
    gateFail: '{probs}. صلّحوها وشغّلوا تاني.',
    gateChanged: 'الكود أو التوصيل اتغيّر. شغّلوا تاني على المحاكي.',
    // NEW COPY: board error details (filled into {detail} of E_REAL_IO)
    errTimeout: 'الجهاز بطّل يرد (عدّت ثانيتين). اتأكدوا إن كود الجسر v2 متحمّل عليه وإن السرعة 115200.',
    errLost: 'الجهاز اتفصل من الـUSB.',
    errWrite: 'ما قدرناش نبعت للجهاز.',
    errBADOP: 'الجهاز ما فهمش الأمر. حمّلوا آخر نسخة من كود الجسر (v2).',
    errBADPIN: 'الطرف {pin} مش موجود على الجهاز ده.',
    errRESERVED: 'الطرف {pin} محجوز على الجهاز الحقيقي (خط الـUSB أو الفلاش).',
    errINPUTONLY: 'الطرف {pin} دخل بس، ما ينفعش يطلّع.',
    errRANGE: 'رقم برّه المسموح في الأمر {op}.',
    errNOTSUP: 'الأمر {op} على الطرف {pin} مش مدعوم على الجهاز ده.',
    errTOOLONG: 'السطر اللي اتبعت أطول من اللي الجهاز يستحمله.',
    errOther: 'الجهاز رد بخطأ: {code}',
    oldBridge: 'الجهاز عليه نسخة قديمة من كود الجسر. حمّلوا beedak-lab-bridge.ino الجديد (v2) من صفحة المعمل وارفعوه تاني.',
    noReply: 'الجهاز ما ردّش. اتأكدوا إن كود الجسر متحمّل عليه وإن السرعة 115200، وإن مفيش برنامج تاني فاتح البورت.',
    otherBoard: 'جهاز تاني',
    how: { OUTPUT: 'خرج', INPUT: 'دخل', INPUT_PULLUP: 'دخل بـpull-up', INPUT_PULLDOWN: 'دخل بـpull-down',
      analog: 'قراية analog', pwm: 'PWM (analogWrite)', servo: 'سيرفو', tone: 'صوت (tone)' }   // OUTPUT/INPUT/analog: spec §10.4; rest NEW COPY
  };

  function fill(t, vars) {
    return String(t).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  // Arabic count agreement (batch 4): 0 → «مفيش», 1 → singular, 2 → dual, 3–10 → plural, 11+ → singular.
  function secsAr(n) { return n === 1 ? 'ثانية واحدة' : n === 2 ? 'ثانيتين' : n >= 3 && n <= 10 ? n + ' ثواني' : n + ' ثانية'; }
  function probsAr(n) { return n === 0 ? 'مفيش مشاكل' : n === 1 ? 'فيه مشكلة واحدة' : n === 2 ? 'فيه مشكلتين' : n <= 10 ? 'فيه ' + n + ' مشاكل' : 'فيه ' + n + ' مشكلة'; }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }

  /* ------------------------------------------------------------- board tables -------------------------------------------------------------- */
  // §9.3 whitelists. Must match beedak-lab-bridge.ino exactly.
  var BOARDS = {
    uno: { tag: 'UNO', name: 'Arduino Uno', pins: range(2, 19), inputOnly: [], analogOnly: [], adc: range(14, 19), adcBits: 10 },
    nano: { tag: 'NANO', name: 'Arduino Nano', pins: range(2, 21), inputOnly: [], analogOnly: [20, 21], adc: range(14, 21), adcBits: 10 },
    esp32: { tag: 'ESP32', name: 'ESP32 DevKit V1',
      pins: [2, 4, 5].concat(range(12, 19), range(21, 23), range(25, 27), range(32, 39)),
      inputOnly: range(34, 39), analogOnly: [], adc: [36, 39, 32, 33, 34, 35, 4, 2, 15, 13, 12, 14, 27, 25, 26], adcBits: 12 }
  };
  var TAGS = { UNO: 'uno', NANO: 'nano', ESP32: 'esp32' };     // PING / ready tag -> board type (OTHER -> null)
  var PROTO_VERSION = 2;
  var LINE_MAX = 200;           // bytes per line without "\n" (BEEDAK_LINE_MAX in the bridge)
  var BATCH_OPS = 8;            // flush after 8 queued ops
  var BATCH_MS = 20;            // or 20 ms after the first queued op
  var REPLY_MS = 2000;          // each line waits ≤ 2 s for ok/err <seq>
  var MAX_LINES = 4;            // lines queued + in flight before writes make the sketch wait (backpressure)
  var PI_MAX_US = 100000, US_MAX = 10000;
  var SUPPORTED = { pinMode: 1, digital: 1, analogRead: 1, pwm: 1, tone: 1, pulseIn: 1 };   // §10.5
  // Interp.FEATURE_IO copy (spec §6.1), used only when interp.js is not loaded (tests)
  var FEATURE_IO = { lcd: 'lcd', wire: 'i2c', dht: 'dht', servo: 'servo', wifi: 'wifi', interrupt: 'interrupt',
    dac: 'dac', ledc: 'ledc', tone: 'tone', pulseIn: 'pulseIn', pwm: 'pwm', analogRead: 'analogRead' };
  var MODE_CH = ['I', 'O', 'U', 'D'];   // §2.4 numbers -> protocol letters
  var MODE_NAME = ['INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN'];

  function timers() {
    return {
      set: (root.setTimeout || setTimeout).bind(root),
      clear: (root.clearTimeout || clearTimeout).bind(root)
    };
  }
  function nowMs() {
    var p = root.performance;
    return p && typeof p.now === 'function' ? p.now() : Date.now();
  }
  function byteLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3; }
    return n;
  }

  /* ---------------------------------------------------------- port wrapper (DOM) ----------------------------------------------------------- */
  var VENDORS = { 0x303A: 'Espressif (ESP32)', 0x10C4: 'Silicon Labs CP210x', 0x1A86: 'WCH CH340', 0x0403: 'FTDI', 0x2341: 'Arduino', 0x2A03: 'Arduino' };
  var PRODUCTS = { '2341:0043': 'Arduino Uno R3', '2341:0001': 'Arduino Uno', '10C4:EA60': 'Silicon Labs CP2102 / CP2104',
    '1A86:7523': 'WCH CH340', '1A86:55D4': 'WCH CH9102', '0403:6001': 'FTDI FT232R' };
  function hex4(n) { return ('0000' + Number(n).toString(16).toUpperCase()).slice(-4); }
  function portName(port) {
    var i = {};
    try { i = port.getInfo() || {}; } catch (e) { i = {}; }
    var v = i.usbVendorId, p = i.usbProductId;
    if (v == null) return { name: 'جهاز سيريال', ids: '' };
    var key = hex4(v) + ':' + (p != null ? hex4(p) : '----');
    return { name: PRODUCTS[key] || VENDORS[v] || 'جهاز USB', ids: 'USB ' + key };
  }

  /* SPEC-GAP: §5 says create() gets "port /* opened SerialPort wrapper from sim-main *\/" without a shape. This is the shape.
   * Any object with the same three methods works (tests use a mock):
   *   conn.write(line) -> Promise          (adds "\n"; writes are serialized, so overlapping calls never hit a locked writer)
   *   conn.addLineListener(fn(text)) -> remove()     (every received line, "\r" stripped)
   *   conn.addLostListener(fn()) -> remove()         (port unplugged / read stream ended for good)
   * plus conn.close() -> Promise, conn.isOpen() -> bool, conn.info = { name, ids, baud }, conn.port (the SerialPort).
   */
  function openPort(port, opts) {
    opts = opts || {};
    var baud = opts.baud || 115200;
    var lineFns = [], lostFns = [];
    var state = { open: false, closing: false, reader: null, readErrs: 0, chain: Promise.resolve() };
    var conn = {
      port: port,
      info: { name: '', ids: '', baud: baud },
      isOpen: function () { return state.open; },
      write: function (line) {
        var job = state.chain.then(function () {
          if (!state.open || !port.writable) throw new Error('closed');
          var w = port.writable.getWriter();
          var bytes = new root.TextEncoder().encode(String(line) + '\n');
          return w.write(bytes).then(function () { w.releaseLock(); }, function (e) { try { w.releaseLock(); } catch (x) { /* released */ } throw e; });
        });
        state.chain = job.catch(function () { /* keep the chain alive */ });
        return job;
      },
      addLineListener: function (fn) { lineFns.push(fn); return function () { var i = lineFns.indexOf(fn); if (i !== -1) lineFns.splice(i, 1); }; },
      addLostListener: function (fn) { lostFns.push(fn); return function () { var i = lostFns.indexOf(fn); if (i !== -1) lostFns.splice(i, 1); }; },
      close: function () {
        if (!state.open) return Promise.resolve();
        state.closing = true;
        var reader = state.reader;
        var p = reader ? reader.cancel().catch(function () { /* gone */ }) : Promise.resolve();
        return p.then(function () {
          if (reader) { try { reader.releaseLock(); } catch (e) { /* released */ } }
          state.reader = null;
          return state.chain.then(function () { return port.close(); });
        }).catch(function () { /* already gone */ }).then(function () { state.open = false; state.closing = false; });
      }
    };
    function emitLine(t) { lineFns.slice().forEach(function (fn) { try { fn(t); } catch (e) { /* listener bug must not kill the read loop */ } }); }
    function lost() {
      if (!state.open || state.closing) return;
      state.open = false;
      try { Promise.resolve(port.close()).catch(function () { /* gone */ }); } catch (e) { /* gone */ }
      lostFns.slice().forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    }
    function readLoop() {
      if (!port.readable) { lost(); return; }
      var reader = port.readable.getReader();
      state.reader = reader;
      var dec = new root.TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return null;
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          if (buf.length > 400) { parts.push(buf); buf = ''; }   // a device that never sends "\n" must not grow the buffer forever
          parts.forEach(function (l) { l = l.replace(/\r/g, ''); if (l.replace(/\s+/g, '')) emitLine(l); });
          return pump();
        });
      }
      pump().then(function () { return false; }, function () { return true; }).then(function (failed) {
        if (state.reader === reader) { try { reader.releaseLock(); } catch (e) { /* released */ } state.reader = null; }
        if (!state.open || state.closing) return;
        // framing / break / overrun errors end only this stream; the port gives a new readable
        if (failed && port.readable && ++state.readErrs <= 5) { readLoop(); return; }
        lost();
      });
    }
    return Promise.resolve(port.open({ baudRate: baud })).then(function () {
      var n = portName(port);
      conn.info.name = n.name; conn.info.ids = n.ids;
      state.open = true;
      try { port.addEventListener('disconnect', lost); } catch (e) { /* older API */ }
      readLoop();
      return conn;
    });
  }

  /* --------------------------------------------------------------- handshake --------------------------------------------------------------- */
  var pingCounter = 0;
  // PING with a fresh token; the board often restarts when the port opens, so try a few times.
  // Resolves { board: 'uno'|'nano'|'esp32'|null, tag, version }. version 1 = the old bridge (reply without tag/version).
  function ping(conn, opts) {
    opts = opts || {};
    var tries = opts.tries || 3, ms = opts.timeoutMs || 1500;
    var T = timers();
    function once(n) {
      var tok = 'p' + (++pingCounter) + 'x' + Math.floor(Math.random() * 1e6).toString(36);
      return new Promise(function (resolve, reject) {
        var timer = 0, removeLine = null, removeLost = null;
        function done(err, val) {
          T.clear(timer);
          if (removeLine) removeLine();
          if (removeLost) removeLost();
          if (err) reject(err); else resolve(val);
        }
        removeLine = conn.addLineListener(function (t) {
          var m = /^ok\s+PING\s+(\S+)(?:\s+(\S+))?(?:\s+(\d+))?/i.exec(t);
          if (!m || m[1] !== tok) return;      // leftovers from an older PING are skipped
          var tag = m[2] ? m[2].toUpperCase() : null;
          done(null, { board: tag && TAGS[tag] ? TAGS[tag] : null, tag: tag, version: m[3] ? parseInt(m[3], 10) : 1 });
        });
        if (conn.addLostListener) removeLost = conn.addLostListener(function () { done(mkErr('LOST', AR.errLost)); });
        timer = T.set(function () { done(mkErr('TIMEOUT', AR.noReply)); }, ms);
        Promise.resolve(conn.write('PING ' + tok)).catch(function () { done(mkErr('WRITE', AR.errWrite)); });
      }).catch(function (e) {
        if (n <= 1 || e.kind !== 'TIMEOUT') throw e;
        return once(n - 1);
      });
    }
    return once(tries);
  }

  function mkErr(kind, detail, extra) {
    var e = new Error(detail);
    e.code = 'E_REAL_IO';
    e.kind = kind;            // TIMEOUT | LOST | WRITE | BOARD | ABORT
    e.detail = detail;
    e.vars = { detail: detail };
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }
  function realIoMsg(detail) {
    var t = (NS.Interp && NS.Interp.MSG && NS.Interp.MSG.E_REAL_IO && NS.Interp.MSG.E_REAL_IO.ar) || AR.realIo;
    return { code: 'E_REAL_IO', sev: 'error', msg_ar: fill(t, { detail: detail }), vars: { detail: detail } };
  }

  /* ------------------------------------------------------------- the io object ------------------------------------------------------------- */
  function create(opts) {
    var conn = opts.port, profile = opts.profile || {};
    var onMsg = opts.onMsg || function () {}, onLine = opts.onLine || function () {};
    var onFatal = opts.onFatal || function () {}, onTraffic = opts.onTraffic || null;
    var T = timers();
    var boardType = profile.board && BOARDS[profile.board] ? profile.board : 'uno';
    var nativeBits = BOARDS[boardType].adcBits;
    var adcBits = profile.adcBits || nativeBits;

    var seq = 0;
    var batch = [];            // ops of the line being built: { text, read: { resolve, reject, map } | null }
    var batchTimer = 0;
    var outbox = [];           // built lines waiting to be sent
    var inflight = null;       // { seq, text, reads, timer, sentAt, done }
    var drainWaiters = [];     // writers waiting for backpressure to clear
    var dead = null;           // the failure that ended this io (Error) or null
    var stopped = false;
    var hintedPulse = false;
    var clock = function () { return nowMs() * 1000; };

    var removeLine = conn.addLineListener(lineIn);
    var removeLost = conn.addLostListener ? conn.addLostListener(function () { fail(mkErr('LOST', AR.errLost)); }) : null;

    function traffic(dir, t) { if (onTraffic) { try { onTraffic(dir, t); } catch (e) { /* ignore */ } } }

    function lineIn(t) {
      var m = /^(ok|err)\s+(\d+)(?:\s+(.*))?$/i.exec(String(t).trim());
      if (!m) {
        // PING replies are handled by ping(); everything else that is not "ok/err <seq>" is a device line
        if (!/^ok\s+PING\s/i.test(t)) onLine(t);
        traffic('rx', t);
        return;
      }
      traffic('rx', t);
      var s = parseInt(m[2], 10);
      if (!inflight || s !== inflight.seq) return;          // stale reply (older seq, after a timeout/abort): ignore
      var line = inflight;
      T.clear(line.timer);
      if (/^err$/i.test(m[1])) {
        // keep it in flight: fail() rejects its reads
        var parts = (m[3] || '').split(/\s+/);
        boardError(line, parts[0] || '?', parseInt(parts[1], 10));
        return;
      }
      inflight = null;
      var vals = (m[3] || '').split(/\s+/).filter(Boolean).map(function (x) { return parseInt(x, 10); });
      var k = 0;
      line.reads.forEach(function (r) {
        var v = vals[k++];
        if (v == null || isNaN(v)) v = 0;
        r.resolve(r.map ? r.map(v, line) : v);
      });
      line.done();
      pump();
    }

    function boardError(line, code, opIndex) {
      var op = line.ops[opIndex] || line.ops[0] || '';
      var w = op.split(' ');
      var vars = { op: w[0] || '?', pin: w[1] != null ? pinLabel(+w[1], profile) : '?', code: code };
      var t = AR['err' + code.toUpperCase()] || AR.errOther;
      fail(mkErr('BOARD', fill(t, vars), { board: code.toUpperCase(), op: op }));
    }

    // a failure ends this io. It is reported exactly once: through the rejected read promises if any were pending
    // (the runner turns a rejection into E_REAL_IO, spec §7.5), otherwise through onMsg. After that every io call returns a
    // promise that stays pending, and onFatal tells sim-main to stop the runner (and the stage-2 UI to show why).
    function fail(err) {
      if (dead) return;
      dead = err;
      T.clear(batchTimer); batchTimer = 0;
      var reads = [];
      batch.forEach(function (o) { if (o.read) reads.push(o.read); });
      outbox.forEach(function (l) { reads = reads.concat(l.reads); });
      if (inflight) { T.clear(inflight.timer); reads = reads.concat(inflight.reads); inflight.done(); }
      outbox.forEach(function (l) { l.done(); });
      batch = []; outbox = []; inflight = null;
      drainWaiters.splice(0).forEach(function (fn) { fn(); });
      if (err.kind !== 'ABORT') {
        if (reads.length) reads.forEach(function (r) { r.reject(err); });
        else onMsg(realIoMsg(err.detail));
        try { onFatal(err); } catch (e) { /* ignore */ }
      }
    }

    function pending() { return new Promise(function () { /* stays pending: the run is over */ }); }

    // queue one op. read = true -> returns a Promise of the result; writes return undefined (or a Promise under backpressure)
    function op(text, readMap) {
      if (dead || stopped) return pending();
      var r = null, p;
      if (readMap !== undefined) {
        p = new Promise(function (resolve, reject) { r = { resolve: resolve, reject: reject, map: readMap }; });
      }
      // keep the line ≤ LINE_MAX bytes: "X 65535 " + ops joined by ";"
      var cur = batch.map(function (o) { return o.text; }).join(';');
      if (batch.length && byteLen('X 65535 ' + cur + ';' + text) > LINE_MAX) flush();
      batch.push({ text: text, read: r });
      if (r || batch.length >= BATCH_OPS) flush();
      else if (!batchTimer) batchTimer = T.set(function () { batchTimer = 0; flush(); }, BATCH_MS);
      if (r) return p;
      if (outbox.length + (inflight ? 1 : 0) >= MAX_LINES) {
        return new Promise(function (resolve) { drainWaiters.push(resolve); });
      }
      return undefined;
    }

    // build a line from the queued ops and hand it to the sender. Returns a Promise resolved when the board answered it.
    function flush() {
      T.clear(batchTimer); batchTimer = 0;
      if (!batch.length) {
        // nothing new: resolve when what is already queued is answered
        var last = outbox.length ? outbox[outbox.length - 1] : inflight;
        return last ? last.promise : Promise.resolve();
      }
      seq = seq >= 65535 ? 1 : seq + 1;
      var ops = batch.map(function (o) { return o.text; });
      var line = { seq: seq, ops: ops, text: 'X ' + seq + ' ' + ops.join(';'), reads: [], timer: 0, sentAt: 0 };
      batch.forEach(function (o) { if (o.read) line.reads.push(o.read); });
      batch = [];
      line.promise = new Promise(function (resolve) { line.done = resolve; });
      outbox.push(line);
      pump();
      return line.promise;
    }

    // send the next line when nothing is in flight (the bridge answers lines in order; one at a time keeps matching simple)
    function pump() {
      if (dead || inflight || !outbox.length) {
        if (!dead && outbox.length + (inflight ? 1 : 0) < MAX_LINES) drainWaiters.splice(0).forEach(function (fn) { fn(); });
        return;
      }
      var line = outbox.shift();
      inflight = line;
      line.sentAt = nowMs();
      line.timer = T.set(function () {
        if (inflight === line) fail(mkErr('TIMEOUT', AR.errTimeout));
      }, REPLY_MS);
      traffic('tx', line.text);
      Promise.resolve(conn.write(line.text)).catch(function () { if (inflight === line) fail(mkErr('WRITE', AR.errWrite)); });
      if (outbox.length + 1 < MAX_LINES) drainWaiters.splice(0).forEach(function (fn) { fn(); });
    }

    function okPin(pin) { return typeof pin === 'number' && isFinite(pin) && pin >= 0 && pin === Math.floor(pin); }
    function int(n) { n = Math.round(Number(n)); return isFinite(n) ? n : 0; }

    var io = {
      kind: 'real',
      timeMode: 'wall',
      board: boardType,
      supports: function (f) { return !!SUPPORTED[f]; },
      // all pins INPUT + noTone on the board. Drops ops not yet sent. Returns a Promise (the runner may ignore it).
      reset: function () {
        if (dead) return pending();
        stopped = false;
        T.clear(batchTimer); batchTimer = 0;
        batch = [];                     // unsent ops of the previous run are dropped (their reads stay pending, like stop())
        hintedPulse = false;
        op('RS');
        return flush();
      },
      setClock: function (fn) { if (typeof fn === 'function') clock = fn; },
      setInterruptSink: function () { /* interrupts are not supported on the real board in v1 (§10.5) */ },
      nextEventUs: function () { return Infinity; },
      tick: function () { /* wall time: nothing scheduled here; batching uses its own 20 ms timer */ },

      pinMode: function (pin, mode) { if (!okPin(pin)) return; return op('PM ' + pin + ' ' + (MODE_CH[mode] || 'I')); },
      digitalWrite: function (pin, level) { if (!okPin(pin)) return; return op('DW ' + pin + ' ' + (level ? 1 : 0)); },
      digitalRead: function (pin) {
        if (!okPin(pin)) return 0;
        return op('DR ' + pin, function (v) { return v ? 1 : 0; });
      },
      // AR answers in the board's native resolution (Uno 10 bit, ESP32 12 bit); rescale to analogReadResolution (§9.2)
      analogRead: function (pin) {
        if (!okPin(pin)) return 0;
        return op('AR ' + pin, function (v) {
          var d = adcBits - nativeBits;
          v = Math.max(0, Math.min(v, Math.pow(2, nativeBits) - 1));
          return d >= 0 ? v * Math.pow(2, d) : Math.floor(v / Math.pow(2, -d));
        });
      },
      setAdcBits: function (bits) { bits = int(bits); if (bits >= 1 && bits <= 16) adcBits = bits; },
      // AW is always 0..255 on the wire: rescale duty from `bits`; `hz` is ignored (board default frequency, §9.2)
      analogWrite: function (pin, duty, bits) {
        if (!okPin(pin)) return;
        bits = bits || profile.pwmBits || 8;
        var max = Math.pow(2, bits) - 1;
        var d = Math.max(0, Math.min(max, int(duty)));
        return op('AW ' + pin + ' ' + Math.round(d * 255 / max));
      },
      dacWrite: function () { /* not supported on the real board (§10.5); check() refuses before a run */ },
      tone: function (pin, hz, durationMs) {
        if (!okPin(pin)) return;
        return op('TN ' + pin + ' ' + Math.max(1, int(hz)) + ' ' + Math.max(0, int(durationMs || 0)));
      },
      noTone: function (pin) { if (!okPin(pin)) return; return op('NT ' + pin); },
      // SPEC-GAP: §5 has no io.delayMicroseconds, but §9.2 batches "US" so an HC-SR04 trigger pulse keeps real timing.
      // The runner may call io.delayMicroseconds(us) (if present) in wall mode before its own short sleep.
      delayMicroseconds: function (us) {
        us = Math.max(0, int(us));
        var r;
        while (us > 0) { var n = Math.min(US_MAX, us); us -= n; r = op('US ' + n); }
        return r;
      },
      // SPEC-GAP: lets the runner flush the batch when delay(ms ≥ 1) starts (§9.2). Without it the 20 ms timer flushes.
      flush: function () { return dead ? pending() : flush(); },
      pulseIn: function (pin, level, timeoutUs) {
        if (!okPin(pin)) return Promise.resolve({ width: 0, elapsed: 0 });
        var tmo = int(timeoutUs == null ? 1000000 : timeoutUs);
        if (tmo > PI_MAX_US) {
          tmo = PI_MAX_US;
          if (!hintedPulse) { hintedPulse = true; onMsg({ code: 'H_REAL_PULSE_TMO', sev: 'hint', msg_ar: AR.pulseTmo }); }
        }
        if (tmo < 1) tmo = 1;
        var t0 = nowMs();
        return op('PI ' + pin + ' ' + (level ? 1 : 0) + ' ' + tmo, function (v) {
          return { width: Math.max(0, v), elapsed: Math.max(0, Math.round((nowMs() - t0) * 1000)) };
        });
      },
      attachInterrupt: function () { /* §10.5: not on the real board */ },
      detachInterrupt: function () {},
      servoAttach: function () { return false; },
      servoWrite: function () {},
      servoDetach: function () {},
      i2cProbe: function () { return false; },
      i2cCall: function () { return undefined; },
      dhtRead: function () { return null; },
      wifiBegin: function () {},
      wifiStatus: function () { return 6; },        // WL_DISCONNECTED
      wifiLocalIP: function () { return '0.0.0.0'; },
      wifiRSSI: function () { return 0; },
      wifiDisconnect: function () {},
      serialTraffic: function () {},

      // ---- extra (sim-main) ----
      // stop the run: forget everything not sent, send RS (all pins INPUT, noTone) and stop listening afterwards.
      // Returns a Promise that settles when the board acknowledged RS (or at once if the board is gone).
      stop: function () {
        if (dead) { detach(); return Promise.resolve(); }
        stopped = false;
        T.clear(batchTimer); batchTimer = 0;
        // reads that were never sent stay pending (the runner is being stopped; rejecting them would report a fake error)
        batch = [];
        outbox.forEach(function (l) { l.done(); });
        outbox = [];
        op('RS');
        var p = flush();
        stopped = true;
        return p.then(function () { fail(mkErr('ABORT', 'stopped')); detach(); });
      },
      // drop everything without talking to the board (port lost / page leaving)
      abort: function () { fail(mkErr('ABORT', 'aborted')); detach(); },
      isDead: function () { return !!dead; },
      lastError: function () { return dead; },
      stats: function () { return { seq: seq, queued: batch.length, lines: outbox.length + (inflight ? 1 : 0) }; },
      now: function () { return clock(); }
    };
    function detach() {
      if (removeLine) { removeLine(); removeLine = null; }
      if (removeLost) { removeLost(); removeLost = null; }
    }
    return io;
  }

  /* ----------------------------------------------------------- stage-2 checks -------------------------------------------------------------- */
  function pinLabel(pin, profile) {
    var ids = profile && profile.pinIds;
    var b = profile && profile.board;
    if ((b === 'uno' || b === 'nano') && ids && ids[pin] && /^A\d$/.test(ids[pin])) return ids[pin];
    if ((b === 'uno' || b === 'nano') && pin >= 14 && pin <= 21) return 'A' + (pin - 14);
    return String(pin);
  }
  function uniqPins(lists) {
    var seen = {}, out = [];
    lists.forEach(function (l) {
      (l || []).forEach(function (p) {
        if (!p || typeof p.pin !== 'number') return;
        var k = p.pin + ':' + p.how;
        if (seen[k]) return;
        seen[k] = 1; out.push({ pin: p.pin, how: p.how });
      });
    });
    out.sort(function (a, b) { return a.pin - b.pin; });
    return out;
  }
  function joinAr(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join('، ') + ' و' + list[list.length - 1];
  }

  /* check({ features, pins, realBoard, simBoard, version, profile, connected, stage1 })
   *   features: program.features; pins: program.pinsUsed ∪ runner.pinsTouched(); realBoard: ping().board (or null for OTHER);
   *   simBoard: the lab's board type; version: ping().version; stage1: 'pass' when the gate passed.
   * Returns { ok, reason, msg_ar } with reason ∈ locked | noDevice | oldBridge | mismatch | unsupported | reserved | ok.
   * Order follows §10.4 item 4. */
  function check(o) {
    o = o || {};
    if (o.stage1 !== undefined && o.stage1 !== 'pass') return { ok: false, reason: 'locked', msg_ar: AR.locked };
    if (o.connected === false) return { ok: false, reason: 'noDevice', msg_ar: AR.noDevice };
    if (o.version != null && o.version < PROTO_VERSION) return { ok: false, reason: 'oldBridge', msg_ar: AR.oldBridge };
    var simName = BOARDS[o.simBoard] ? BOARDS[o.simBoard].name : String(o.simBoard || '');
    if (o.realBoard !== undefined && o.realBoard !== o.simBoard) {
      var realName = o.realBoard && BOARDS[o.realBoard] ? BOARDS[o.realBoard].name : AR.otherBoard;
      return { ok: false, reason: 'mismatch', msg_ar: fill(AR.mismatch, { sim: simName, real: realName }) };
    }
    var map = (NS.Interp && NS.Interp.FEATURE_IO) || FEATURE_IO;
    var feats = Array.prototype.slice.call(o.features || []);
    var bad = [];
    feats.forEach(function (f) {
      var io = map[f];
      if (!io || SUPPORTED[io]) return;
      var name = AR.feat[io] || io;
      if (bad.indexOf(name) === -1) bad.push(name);
    });
    if (bad.length) return { ok: false, reason: 'unsupported', msg_ar: fill(AR.unsupported, { libs: joinAr(bad) }), features: bad };
    var b = BOARDS[o.realBoard || o.simBoard];
    if (b) {
      var pins = uniqPins([o.pins]);
      for (var i = 0; i < pins.length; i++) {
        if (b.pins.indexOf(pins[i].pin) === -1) {
          return { ok: false, reason: 'reserved', pin: pins[i].pin,
            msg_ar: fill(AR.reserved, { pin: pinLabel(pins[i].pin, o.profile || { board: o.simBoard }) }) };
        }
      }
    }
    return { ok: true, reason: 'ok', msg_ar: '' };
  }

  // rows for the confirm dialog: «13: خرج»، «2: دخل»، «A0: قراية analog»
  function pinsSummary(pins, profile) {
    return uniqPins([pins]).map(function (p) {
      var label = pinLabel(p.pin, profile);
      var how = AR.how[p.how] || p.how;
      return { pin: p.pin, label: label, how: p.how, text_ar: label + ': ' + how };
    });
  }

  /* --------------------------------------------------------------- stage-1 gate ------------------------------------------------------------ */
  /* §10.4 item 3: stage 1 passes after ≥ 3 s of sim time from reset with zero error/warn (compile msgs, runtime events,
   * circuit conditions) and the board powered. A circuit edit restarts the window (the sketch keeps running, like hot-plugging);
   * a code edit needs a new run ('changed'); a new error/warn fails the run.
   *   const g = Gate.create({ windowS: 3 });
   *   g.start(nowUs, compileMsgs) on «شغّلوا» / reset · g.msg(m) for every event · g.tick(nowUs, { powered, conds }) per frame
   *   g.circuitChanged(nowUs) · g.codeChanged() · g.stop() · g.state() · g.status() -> { state, msg_ar, problems, remainS }
   */
  var Gate = {
    create: function (opts) {
      var windowUs = ((opts && opts.windowS) || 3) * 1e6;
      var st = 'idle', from = 0, last = 0, problems = [], seen = {};
      function bad(m) { return m && (m.sev === 'error' || m.sev === 'warn'); }
      function key(m) { return m.code + '|' + (m.refs ? m.refs.slice().sort().join() : '') + '|' + (m.line || ''); }
      function addProblem(m) {
        var k = key(m);
        if (seen[k]) return;
        seen[k] = 1; problems.push(m);
      }
      var g = {
        start: function (nowUs, msgs) {
          st = 'running'; from = nowUs || 0; last = from; problems = []; seen = {};
          (msgs || []).forEach(g.msg);
          return st;
        },
        msg: function (m) {
          if (!bad(m) || st === 'idle' || st === 'changed') return st;
          addProblem(m);
          st = 'fail';
          return st;
        },
        tick: function (nowUs, o) {
          o = o || {};
          if (st !== 'running' && st !== 'pass') return st;
          last = nowUs;
          (o.conds || []).forEach(function (c) { if (bad(c)) { addProblem(c); st = 'fail'; } });
          if (st === 'fail') return st;
          if (o.powered === false) { from = nowUs; return st; }   // power off: the window has to start over
          if (st === 'running' && nowUs - from >= windowUs) st = 'pass';
          return st;
        },
        circuitChanged: function (nowUs) {
          if (st === 'running' || st === 'pass') { st = 'running'; from = nowUs != null ? nowUs : last; }
          else if (st === 'fail') st = 'changed';
          return st;
        },
        codeChanged: function () { if (st !== 'idle') st = 'changed'; return st; },
        stop: function () { if (st === 'running') st = 'idle'; return st; },
        state: function () { return st; },
        status: function () {
          var n = Math.round(windowUs / 1e6);
          var msg = st === 'running' ? fill(AR.gateRunning, { secs: secsAr(n) })
            : st === 'pass' ? fill(AR.gatePass, { secs: secsAr(n) })
            : st === 'fail' ? fill(AR.gateFail, { probs: probsAr(problems.length) })
            : st === 'changed' ? AR.gateChanged : '';
          return { state: st, msg_ar: msg, problems: problems.slice(),
            remainS: st === 'running' ? Math.max(0, (windowUs - (last - from)) / 1e6) : 0 };
        }
      };
      return g;
    }
  };

  NS.IO.Real = {
    create: create,
    openPort: openPort,
    ping: ping,
    check: check,
    pinsSummary: pinsSummary,
    pinLabel: pinLabel,
    portName: portName,
    Gate: Gate,
    BOARDS: BOARDS,
    TAGS: TAGS,
    AR: AR,
    PROTO_VERSION: PROTO_VERSION,
    // available in this browser? (Chrome / Edge desktop over https or localhost)
    available: function () {
      try {
        var nav = root.navigator;
        return root.isSecureContext !== false && !!(nav && nav.serial && typeof nav.serial.requestPort === 'function');
      } catch (e) { return false; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
