/* «بإيدك» lab simulator: netlist + DC solver + realism rules.
 * Owner: B2 (Electrical). Spec: design-system/beedak/pages/lab-sim-spec.md §6.3, §8.
 *
 * Pipeline
 *   load()  : union-find over every pin of every instance (wires, plugged legs -> holes, breadboard strips,
 *             part-internal ties) -> dense nets. The net holding the board GND pins is the reference (0 V).
 *   solve() : for each PWM high/low combination (§8.2): every model stamps elements (Norton sources, resistors,
 *             switches, diodes with series R) -> modified nodal analysis (only node voltages; no branch unknowns)
 *             -> Newton iteration with SPICE pnjlim on every junction -> input clamp-diode pass on GPIO nets ->
 *             floating detection. Models may then `decide()` new discrete states (powered, relay coil…) and the
 *             whole thing is re-solved (max 6 passes). Finally circuit-level realism conditions are computed.
 *   advance(): per animation frame; re-solves only when something changed, integrates burn timers / servo
 *             motion over sim time through every model's after(), returns visuals + current conditions.
 * Node-loadable; no DOM. NS.Parts is read only at call time.
 */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};

  /* ------------------------------------------------------------------ */
  /* Warnings registry (§8.5). `ar` placeholders {x} are filled from vars. */
  /* ------------------------------------------------------------------ */
  var WARN = {
    E_SHORT: { sev: 'error', ar: 'شورت: {supply} متوصّل بالـGND على طول. الكارت فصل علشان يحمي نفسه. شيلوا السلك ده وشغّلوا تاني.' },
    E_PIN_CURRENT: { sev: 'error', ar: 'الطرف {pin} بيعدّي فيه {mA} مللي أمبير، والحد الأقصى 40. كده الطرف بيتحرق. حطّوا مقاومة.' },
    E_PIN_FIGHT: { sev: 'error', ar: 'الطرفين {a} و{b} متوصلين ببعض، وواحد طالع HIGH والتاني LOW. ده شورت بينهم.' },
    E_ESP_5V: { sev: 'error', ar: 'الطرف {pin} في الـESP32 عليه {v} فولت، وهو بيستحمل 3.3 بس. استخدموا مقسّم جهد (مقاومتين) أو level shifter.' },
    E_OVERVOLT: { sev: 'error', ar: 'الطرف {pin} عليه {v} فولت، وده أكتر من اللي الكارت يستحمله.' },
    E_LED_BURNT: { sev: 'error', ar: 'اللمبة {part} اتحرقت: عدّى فيها {mA} مللي أمبير والمفروض 20 بالكتير. حطّوا مقاومة 220 أوم أو أكتر قبلها.' },
    E_REVERSED_POWER: { sev: 'error', ar: '{part} متوصّل بالعكس: الـVCC والـGND مقلوبين.' },
    W_PIN_CURRENT: { sev: 'warn', ar: 'الطرف {pin} عليه {mA} مللي أمبير. أكتر من 20 مش آمن على المدى الطويل.' },
    W_USB_BUDGET: { sev: 'warn', ar: 'الدايرة بتسحب حوالي {mA} مللي أمبير من الـUSB، والـUSB بيدّي 500 بالكتير. استخدموا مصدر كهربا خارجي.' },
    W_3V3_BUDGET: { sev: 'warn', ar: 'طرف 3.3V في {board} بيدّي 50 مللي أمبير بس، والدايرة عايزة {mA}.' },
    H_ESP_5V_WEAK: { sev: 'hint', ar: 'الطرف {pin} في الـESP32 واصله {v} فولت من مقاومة pull-up على 5V. غالبًا هيشتغل، بس الأأمن تشغّلوا {part} على 3.3V أو تستخدموا level shifter.' },
    E_SUPPLY_FIGHT: { sev: 'error', ar: 'طرف {a} وطرف {b} متوصلين ببعض، وكل واحد فيهم فولته مختلف. ده شورت بين مصدرين كهربا. شيلوا السلك ده.' }, // NEW COPY
    W_NO_COMMON_GND: { sev: 'warn', ar: '{part} واخد كهربا من مصدر تاني، والـGND بتاعه مش متوصل بالـGND بتاع الكارت. وصّلوا الـGND ببعض علشان الإشارة تتقري صح.' }, // NEW COPY
    H_PART_SHORTED: { sev: 'hint', ar: 'رجلين {part} في نفس الصف من البريدبورد (أو متوصلين ببعض)، فالتيار بيلف حواليها ومش بيعدّي فيها. حطّوا كل رجل في عمود مختلف.' }, // NEW COPY
    W_RES_HOT: { sev: 'warn', ar: 'المقاومة {part} بتسخن: عليها {w} وات والمقاومة دي 0.25 وات بس.' },
    W_NO_POWER: { sev: 'warn', ar: '{part} مش واخد كهربا. وصّلوا {vcc} وGND.' },
    W_LOW_VCC: { sev: 'warn', ar: '{part} محتاج {need} فولت على الأقل، وواخد {v} بس.' },
    W_FLOATING: { sev: 'warn', ar: 'الطرف {pin} مش متوصل بحاجة ثابتة (عايم)، فالقراية عشوائية. استخدموا INPUT_PULLUP أو مقاومة 10k لـGND.' },
    W_ADC2_WIFI: { sev: 'warn', ar: 'الطرف {pin} على ADC2، وده ما بيقراش والواي فاي شغال. استخدموا 32 أو 33 أو 34 أو 35 أو 36 أو 39.' },
    W_STRAP12: { sev: 'warn', ar: 'الطرف 12 في الـESP32 عليه HIGH وقت التشغيل، وده ممكن يمنع الكارت الحقيقي إنه يبدأ.' },
    W_I2C_PINS: { sev: 'warn', ar: 'الشاشة متوصلة على أطراف غلط. على {board}: SDA = {sda} وSCL = {scl}.' },
    W_I2C_SWAPPED: { sev: 'warn', ar: 'SDA وSCL متبدّلين في توصيل الشاشة.' },
    W_LCD_NO_ACK: { sev: 'warn', ar: 'الشاشة مش بترد على العنوان 0x{addr}. اتأكدوا من الكهربا والأسلاك والعنوان (غالبًا 0x27 أو 0x3F).' },
    W_LCD_VOLT: { sev: 'warn', ar: 'الشاشة واخدة {v} فولت بس، فالكلام هيبان باهت. الشاشة دي محتاجة 5V.' },
    W_RELAY_FROM_PIN: { sev: 'warn', ar: 'ما تشغّلوش ملف الريليه من طرف الكارت مباشرةً. وصّلوا VCC بتاع الموديول بـ5V.' },
    H_LED_REVERSED: { sev: 'hint', ar: 'اللمبة {part} متركبة بالعكس: الرجل الطويلة (+) لازم تروح ناحية الفولت الأعلى.' },
    H_LED_OPEN: { sev: 'hint', ar: 'اللمبة {part} مش مقفول عليها الدايرة: رجلها التانية مش واصلة لـGND.' },
    H_NO_PINMODE: { sev: 'hint', ar: 'نسيتوا pinMode({pin}, OUTPUT)؟ من غيرها اللمبة بتنور باهتة قوي أو ما بتنورش.' },
    H_UNDEFINED_LEVEL: { sev: 'hint', ar: 'الطرف {pin} عليه {v} فولت، وده في النص بين LOW وHIGH. القراية مش مضمونة.' },
    H_UNO_VIN: { sev: 'hint', ar: 'طرف VIN في الـUno ما بيطلّعش كهربا لما الكارت شغال من الـUSB. استخدموا 5V.' },
    H_RESET_HELD: { sev: 'hint', ar: 'الكارت واقف في وضع ريست لأن {pin} متوصل بالـGND.' },
    H_SR04_TRIG: { sev: 'hint', ar: 'الحساس مستني نبضة على Trig الأول: HIGH لمدة 10 ميكروثانية وبعدين LOW.' },
    H_SERVO_NO_PULSE: { sev: 'hint', ar: 'السيرفو مش بيستقبل نبضات تحكم. استخدموا مكتبة Servo مع attach().' },
    H_LCD_ASCII: { sev: 'hint', ar: 'الشاشة دي بتكتب حروف إنجليزي وأرقام بس، والحروف العربي بتطلع رموز غريبة.' },
    W_SOLVER: { sev: 'hint', ar: 'الدايرة دي صعبة على المحاكي، والنتيجة ممكن تكون تقريبية.' }
  };

  function fill(code, vars) {
    var w = WARN[code], s = w ? w.ar : code;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? String(vars[k]) : m; });
  }
  /** Builds a §2.3 message object from a Circuit.WARN code. */
  function makeMsg(code, vars, refs) {
    var w = WARN[code] || { sev: 'hint' };
    return { code: code, sev: w.sev, msg_ar: fill(code, vars || {}), refs: (refs || []).slice(), vars: vars || {} };
  }
  function msgKey(m) { return m.code + '|' + (m.refs || []).slice().sort().join(','); }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  /** Human pin name used in messages: Uno "13" / "A0", ESP32 "18". */
  function pinLabel(profile, g) {
    if (!profile) return String(g);
    if (profile.board === 'esp32') return String(g);
    return g >= 14 ? 'A' + (g - 14) : String(g);
  }

  /* ------------------------------------------------------------------ */
  /* Numerics                                                             */
  /* ------------------------------------------------------------------ */
  var VT = 0.02585, GMIN = 1e-12, MAX_IT = 60;
  var T_R = 0, T_V = 1, T_I = 2, T_J = 3;

  /** Dense Gaussian elimination with partial pivoting. A (n×n, row-major) and b are destroyed. */
  function gauss(A, b, n) {
    for (var k = 0; k < n; k++) {
      var p = k, mx = Math.abs(A[k * n + k]);
      for (var i = k + 1; i < n; i++) { var v = Math.abs(A[i * n + k]); if (v > mx) { mx = v; p = i; } }
      if (!(mx > 1e-300)) return null;
      if (p !== k) {
        for (var j = k; j < n; j++) { var t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
        var tb = b[k]; b[k] = b[p]; b[p] = tb;
      }
      var piv = A[k * n + k];
      for (var r = k + 1; r < n; r++) {
        var f = A[r * n + k] / piv;
        if (f === 0) continue;
        for (var c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
        b[r] -= f * b[k];
      }
    }
    var x = new Float64Array(n);
    for (var q = n - 1; q >= 0; q--) {
      var s = b[q];
      for (var z = q + 1; z < n; z++) s -= A[q * n + z] * x[z];
      x[q] = s / A[q * n + q];
    }
    return x;
  }
  /** SPICE junction voltage limiting. */
  function pnjlim(vnew, vold, nvt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
      if (vold > 0) {
        var arg = 1 + (vnew - vold) / nvt;
        vnew = arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
      } else {
        vnew = nvt * Math.log(Math.max(vnew / nvt, 1e-30));
      }
    }
    return vnew;
  }
  function dI(e, vd) { var ex = Math.exp(Math.min(vd / e.nVt, 100)); return { I: e.Is * (ex - 1), G: e.Is * ex / e.nVt }; }
  function nv(x, i) { return i < 0 ? 0 : x[i]; }

  /** Newton-Raphson on the stamped element list. scale = source-stepping factor. Returns {x, ok, it}. */
  function newton(E, n, x0, scale) {
    var G = new Float64Array(n * n), B = new Float64Array(n), J = [], i, e;
    function sg(a, b, g) {
      if (a >= 0) G[a * n + a] += g;
      if (b >= 0) G[b * n + b] += g;
      if (a >= 0 && b >= 0) { G[a * n + b] -= g; G[b * n + a] -= g; }
    }
    for (i = 0; i < n; i++) G[i * n + i] += GMIN;
    for (i = 0; i < E.length; i++) {
      e = E[i];
      if (e.t === T_R) sg(e.a, e.b, e.g);
      else if (e.t === T_V) { sg(e.a, e.b, e.g); if (e.a >= 0) B[e.a] += e.g * e.v * scale; if (e.b >= 0) B[e.b] -= e.g * e.v * scale; }
      else if (e.t === T_I) { if (e.a >= 0) B[e.a] -= e.i * scale; if (e.b >= 0) B[e.b] += e.i * scale; }
      else if (e.t === T_J) { sg(e.a, e.b, GMIN); J.push(e); }
    }
    if (!J.length) {
      var xl = gauss(G.slice(), B.slice(), n);
      return { x: xl || (x0 || new Float64Array(n)), ok: !!xl, it: 1 };
    }
    var x = x0 ? x0 : new Float64Array(n);
    for (var it = 1; it <= MAX_IT; it++) {
      var A = G.slice(), b = B.slice();
      for (i = 0; i < J.length; i++) {
        e = J[i];
        var d = dI(e, e.vd);
        e._I = d.I; e._G = d.G;
        var ieq = d.I - d.G * e.vd;
        if (e.a >= 0) { A[e.a * n + e.a] += d.G; b[e.a] -= ieq; }
        if (e.b >= 0) { A[e.b * n + e.b] += d.G; b[e.b] += ieq; }
        if (e.a >= 0 && e.b >= 0) { A[e.a * n + e.b] -= d.G; A[e.b * n + e.a] -= d.G; }
      }
      var xn = gauss(A, b, n);
      if (!xn) return { x: x, ok: false, it: it };
      var maxdx = 0;
      for (i = 0; i < n; i++) { var dd = Math.abs(xn[i] - x[i]); if (dd > maxdx) maxdx = dd; }
      var limited = false, resOk = true;
      for (i = 0; i < J.length; i++) {
        e = J[i];
        var vnew = nv(xn, e.a) - nv(xn, e.b);
        var vlim = pnjlim(vnew, e.vd, e.nVt, e.vcrit);
        if (vlim !== vnew) limited = true;
        var real = dI(e, vnew).I, lin = e._I + e._G * (vnew - e.vd);
        if (Math.abs(real - lin) > 1e-9 + 1e-6 * Math.abs(real)) resOk = false;
        e.vd = vlim;
      }
      x = xn;
      if (it > 1 && maxdx < 1e-6 && !limited && resOk) return { x: x, ok: true, it: it };
    }
    return { x: x, ok: false, it: MAX_IT };
  }

  /* ------------------------------------------------------------------ */
  /* Circuit                                                              */
  /* ------------------------------------------------------------------ */
  function create() {
    var C = {};
    var insts = [], byId = {}, defs = {}, states = {};
    var netOf = {}, nets = [], nNets = 0;
    var board = null, prof = null, groundNet = -1, gpioNet = {}, gpioRef = {};
    var version = 1, bounce = true;
    var lastSol = null, lastSig = '', solVer = -1, lastAdvUs = null;
    var seen = {}, structConds = [], pinDmg = {}, shortedParts = {};
    var vdCache = {}, solverWarned = false;

    function P() { return NS.Parts; }

    /* ---------------- netlist ---------------- */
    C.load = function (circ) {
      var Parts = P();
      var parts = (circ && circ.parts) || [], wires = (circ && circ.wires) || [], controls = (circ && circ.controls) || {};
      if (parts.some(function (p) { return p && typeof p.on === 'string'; })) parts = Parts.resolvePlacement({ parts: parts }).parts;
      var newStates = {};
      insts = []; byId = {}; defs = {};
      parts.forEach(function (p) {
        if (!p || byId[p.id]) return;
        var d = Parts.get(p.type); if (!d) return;
        var inst = { id: p.id, type: p.type, x: +p.x || 0, y: +p.y || 0, rot: +p.rot || 0, props: p.props || {} };
        insts.push(inst); byId[inst.id] = inst; defs[inst.id] = d;
        var st = states[inst.id];
        if (!st || st._type !== inst.type) {
          st = d.model.init(inst) || {};
          st._type = inst.type;
          if (!st.ctl) st.ctl = {};
          if ('bounce' in st) st.bounce = bounce;
          var cs = controls[inst.id];
          if (cs) Object.keys(cs).forEach(function (k) {
            if (k === 'motion') return;
            if (d.model.control) d.model.control(inst, st, k, cs[k], 0); else st.ctl[k] = cs[k];
            if (st.q) { st.q = []; }                       // initial values: no bounce
          });
          if (st.q && st.ctl) {                            // settle contact to its control without bounce
            if ('pressed' in st.ctl) st.closed = !!(st.ctl.pressed || st.ctl.hold);
            else if ('pos' in st.ctl && inst.type === 'switch') st.closed = +st.ctl.pos === 2 ? 2 : 1;
          }
        }
        newStates[inst.id] = st;
      });
      states = newStates;

      // union-find over pin refs
      var refs = [], idx = {};
      insts.forEach(function (inst) { Parts.instPins(inst).forEach(function (p) { idx[p.ref] = refs.length; refs.push(p.ref); }); });
      var par = new Int32Array(refs.length);
      for (var i = 0; i < par.length; i++) par[i] = i;
      function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      function uni(a, b) { if (a === undefined || b === undefined) return; a = find(a); b = find(b); if (a !== b) par[b] = a; }
      insts.forEach(function (inst) {
        Parts.internalGroups(inst).forEach(function (g) {
          var a = idx[inst.id + '.' + g[0]];
          for (var k = 1; k < g.length; k++) uni(a, idx[inst.id + '.' + g[k]]);
        });
      });
      insts.forEach(function (inst) {
        var ph = Parts.pluggedHoles(inst, insts, 0.35);
        if (ph) Object.keys(ph.holes).forEach(function (pid) { uni(idx[inst.id + '.' + pid], idx[ph.bb + '.' + ph.holes[pid]]); });
      });
      wires.forEach(function (w) { if (w) uni(idx[w.a], idx[w.b]); });
      var rootNet = {};
      netOf = {}; nets = [];
      for (var r = 0; r < refs.length; r++) {
        var rt = find(r), id = rootNet[rt];
        if (id === undefined) { id = rootNet[rt] = nets.length; nets.push([]); }
        nets[id].push(refs[r]); netOf[refs[r]] = id;
      }
      nNets = nets.length;

      board = null; prof = null; groundNet = -1; gpioNet = {}; gpioRef = {};
      for (var b = 0; b < insts.length; b++) if (defs[insts[b].id].kind === 'board') { board = insts[b]; break; }
      if (board) {
        prof = Parts.profile(board.type);
        var bd = defs[board.id];
        bd.pins.forEach(function (p) {
          if (p.role === 'gnd' && groundNet < 0) groundNet = netOf[board.id + '.' + p.id];
          if (p.gpio !== undefined) { gpioNet[p.gpio] = netOf[board.id + '.' + p.id]; gpioRef[p.gpio] = board.id + '.' + p.id; }
        });
      }
      structConds = computeStruct();
      pinDmg = {}; seen = {}; lastSol = null; version++;
    };

    function instOfRef(ref) { return byId[ref.slice(0, ref.indexOf('.'))]; }
    function netHasGpio(n) { for (var g in gpioNet) if (gpioNet[g] === n) return +g; return -1; }
    function partOnNet(n, skipId) {
      var refs = nets[n] || [];
      for (var i = 0; i < refs.length; i++) {
        var inst = instOfRef(refs[i]);
        if (!inst || inst.id === skipId) continue;
        var k = defs[inst.id].kind;
        if (k !== 'board' && k !== 'breadboard') return inst.id;
      }
      return null;
    }

    var SHORT_PAIRS = { resistor: [['1', '2']], led: [['A', 'K']], buzzer: [['P', 'N']], piezo: [['P', 'N']], ldr: [['1', '2']], lamp: [['1', '2']],
      rgb: [['R', 'C'], ['G', 'C'], ['B', 'C']], seg7: [['1', '3'], ['2', '3'], ['4', '3'], ['5', '3'], ['6', '3'], ['7', '3'], ['9', '3'], ['10', '3']] };
    /** Conditions that depend on wiring only (§8.4). power: true = only while the board is powered. */
    function computeStruct() {
      var out = [];
      shortedParts = {};
      insts.forEach(function (inst) {
        var pairs = SHORT_PAIRS[inst.type];
        if (pairs) pairs.forEach(function (pr) {
          if (netOf[inst.id + '.' + pr[0]] === netOf[inst.id + '.' + pr[1]] && !shortedParts[inst.id]) {
            shortedParts[inst.id] = true;
            out.push({ code: 'H_PART_SHORTED', vars: { part: inst.id }, refs: [inst.id], power: false });
          }
        });
        if (inst.type === 'bat9v' && netOf[inst.id + '.P'] === netOf[inst.id + '.N'])
          out.push({ code: 'E_SHORT', vars: { supply: 'البطارية' }, refs: [inst.id], power: false });
        if (inst.type === 'relay' && netHasGpio(netOf[inst.id + '.VCC']) >= 0)
          out.push({ code: 'W_RELAY_FROM_PIN', vars: {}, refs: [inst.id], power: true });
      });
      if (board) {
        var bd = defs[board.id], sup = bd.pins.filter(function (p) { return p.role === 'power' && p.volts > 0; });
        for (var i = 0; i < sup.length; i++) for (var j = i + 1; j < sup.length; j++) {
          var a = sup[i], b = sup[j];
          if (netOf[board.id + '.' + a.id] === netOf[board.id + '.' + b.id] && Math.abs(a.volts - b.volts) > 0.05)
            out.push({ code: 'E_SUPPLY_FIGHT', vars: { a: a.label, b: b.label }, refs: [board.id + '.' + a.id, board.id + '.' + b.id], power: true });
        }
        if (board.type !== 'esp32') {
          var vn = netOf[board.id + '.VIN'];
          var used = (nets[vn] || []).some(function (rf) {
            var inst = instOfRef(rf); var k = inst && defs[inst.id].kind;
            return inst && k !== 'board' && k !== 'breadboard';
          });
          if (used) out.push({ code: 'H_UNO_VIN', vars: {}, refs: [board.id + '.VIN'], power: false });
        }
      }
      return out;
    }

    /* ---------------- solving ---------------- */
    function normDrive(d) {
      d = d || {};
      return { boardId: d.boardId || (board && board.id), power: !!d.power && !!board, reset: !!d.reset, pins: d.pins || {} };
    }
    function sigOf(d) { return JSON.stringify([d.power, d.reset, d.pins]); }

    function buildCombos(pw) {
      var k = pw.length;
      if (!k) return [{ w: 1, high: {}, tag: null }];
      if (k <= 3) {
        var out = [];
        for (var m = 0; m < (1 << k); m++) {
          var high = {}, w = 1;
          for (var i = 0; i < k; i++) { var h = (m >> i) & 1; high[pw[i].g] = !!h; w *= h ? pw[i].duty : 1 - pw[i].duty; }
          out.push({ w: w, high: high, tag: null });
        }
        return out;
      }
      var avg = 0, H = {}, L = {};
      pw.forEach(function (p) { avg += p.duty / k; H[p.g] = true; L[p.g] = false; });
      return [{ w: avg, high: H, tag: 'H' }, { w: 1 - avg, high: L, tag: 'L' }];
    }

    /** Stamps every model and solves one PWM combination. */
    function solveCombo(drive, cb, nowUs) {
      var nodeOfNet = new Int32Array(nNets);
      for (var i = 0; i < nNets; i++) nodeOfNet[i] = -2;
      if (groundNet >= 0) nodeOfNet[groundNet] = -1;
      var nN = 0, E = [], nodeNet = [];
      function newNode(net) { nodeNet.push(net); return nN++; }
      function nodeForNet(net) { var x = nodeOfNet[net]; if (x === -2) x = nodeOfNet[net] = newNode(net); return x; }
      var ctx = { drive: drive, nowUs: nowUs, high: cb.high, power: drive.power };
      insts.forEach(function (inst) {
        var d = defs[inst.id], m = d.model, id = inst.id;
        if (!m.stamp) return;
        function K(key) { return key ? id + ':' + key : null; }
        var S = {
          ground: -1,
          n: function (pid) { var net = netOf[id + '.' + pid]; return net === undefined ? newNode(-1) : nodeForNet(net); },
          node: function () { return newNode(-1); },
          ref: function (pid) { return id + '.' + pid; },
          R: function (a, b, ohm, key) { E.push({ t: T_R, a: a, b: b, g: 1 / Math.max(ohm, 1e-6), key: K(key) }); },
          V: function (a, b, volts, rOhm, key) { E.push({ t: T_V, a: a, b: b, v: volts, g: 1 / Math.max(rOhm, 1e-6), key: K(key), bat: key === 'bat' }); },
          I: function (a, b, amps, key) { E.push({ t: T_I, a: a, b: b, i: amps, key: K(key) }); },
          D: function (a, k, p, key) {
            var mid = newNode(-1), nVt = p.n * VT, kk = K(key);
            E.push({ t: T_R, a: a, b: mid, g: 1 / p.Rs, key: null });
            E.push({ t: T_J, a: mid, b: k, Is: p.Is, nVt: nVt, vcrit: nVt * Math.log(nVt / (Math.SQRT2 * p.Is)), key: kk, vd: kk && vdCache[kk] !== undefined ? vdCache[kk] : 0 });
          },
          SW: function (a, b, closed, key) { if (closed) E.push({ t: T_R, a: a, b: b, g: 20, key: K(key) }); },
          drive: function (node, volts, rOhm, tag) { E.push({ t: T_V, a: node, b: -1, v: volts, g: 1 / Math.max(rOhm, 1e-6), key: K(tag) }); }
        };
        m.stamp(S, inst, states[id], ctx);
      });

      // structural islands: tie every island without the reference to its own reference (battery N first)
      var G = nN, par = new Int32Array(nN + 1), e;
      for (i = 0; i <= nN; i++) par[i] = i;
      function f(a) { a = a < 0 ? G : a; while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      for (i = 0; i < E.length; i++) { e = E[i]; var ra = f(e.a), rb = f(e.b); if (ra !== rb) par[rb] = ra; }
      var gRoot = f(-1), tie = {};
      for (i = 0; i < E.length; i++) {
        e = E[i];
        if (e.t !== T_V || e.b < 0) continue;
        var rr = f(e.b);
        if (rr === gRoot) continue;
        if (!tie[rr] || (e.bat && !tie[rr].bat)) tie[rr] = { node: e.b, bat: !!e.bat };   // battery N preferred
      }
      var gIslNode = new Uint8Array(nN);
      for (i = 0; i < nN; i++) gIslNode[i] = f(i) === gRoot ? 1 : 0;
      Object.keys(tie).forEach(function (k) { E.push({ t: T_R, a: tie[k].node, b: -1, g: 1, key: null, tie: true }); });

      // Newton (+ source stepping fallback)
      var res = newton(E, nN, null, 1), iters = res.it;
      if (!res.ok && nN > 0) {
        var xs = null, ok = true;
        for (var s = 1; s <= 10 && ok; s++) { var r2 = newton(E, nN, xs, s / 10); xs = r2.x; ok = r2.ok; iters += r2.it; }
        res = { x: xs, ok: ok, it: iters };
      }
      var x = res.x;

      // input clamp diodes (§8.2): only while the MCU is powered and running
      var clampInfo = [];
      if (drive.power && !drive.reset && prof) {
        var added = {}, any = false;
        Object.keys(gpioNet).forEach(function (gs) {
          var nd = nodeOfNet[gpioNet[gs]];
          if (nd < 0 || added[nd]) return;
          var v = x[nd];
          if (v > prof.vMaxIn || v < -0.5) {
            var over = v > prof.vMaxIn;
            var ce = { t: T_V, a: nd, b: -1, v: over ? prof.vcc + 0.6 : -0.6, g: 0.1, key: null, clamp: { g: +gs, v0: v, over: over } };
            E.push(ce); added[nd] = ce; any = true;
          }
        });
        if (any) {
          for (var pass = 0; pass < 2; pass++) {
            var r3 = newton(E, nN, x, 1); x = r3.x; iters += r3.it; res.ok = res.ok && r3.ok;
            var drop = false;
            for (i = E.length - 1; i >= 0; i--) {
              e = E[i]; if (!e.clamp) continue;
              var Iab = e.g * (nv(x, e.a) - e.v), ic = e.clamp.over ? Iab : -Iab;
              if (ic <= 0) { E.splice(i, 1); drop = true; }
            }
            if (!drop) break;
          }
          E.forEach(function (ce2) {
            if (!ce2.clamp) return;
            var Iab2 = ce2.g * (nv(x, ce2.a) - ce2.v);
            clampInfo.push({ g: ce2.clamp.g, v0: ce2.clamp.v0, ic: ce2.clamp.over ? Iab2 : -Iab2 });
          });
        }
      }

      // element currents
      var elemI = {}, adj = [], sourced = new Uint8Array(nN + 1);
      for (i = 0; i <= nN; i++) adj.push([]);
      sourced[G] = 1;
      function link(a, b) { a = a < 0 ? G : a; b = b < 0 ? G : b; if (a !== b) { adj[a].push(b); adj[b].push(a); } }
      for (i = 0; i < E.length; i++) {
        e = E[i];
        var va = nv(x, e.a), vb = nv(x, e.b), I = 0;
        if (e.t === T_R) { I = e.g * (va - vb); if (e.g > 1e-9) link(e.a, e.b); }
        else if (e.t === T_V) { I = e.g * (va - vb - e.v); link(e.a, e.b); sourced[e.a < 0 ? G : e.a] = 1; sourced[e.b < 0 ? G : e.b] = 1; }
        else if (e.t === T_I) { I = e.i; }
        else if (e.t === T_J) { var vd = va - vb; I = dI(e, vd).I; if (e.key) vdCache[e.key] = vd; if (Math.abs(I) > 1e-6) link(e.a, e.b); }
        if (e.key) elemI[e.key] = (elemI[e.key] || 0) + I;
      }
      // floating: no conductive path to a source or the reference
      var reach = new Uint8Array(nN + 1), stack = [];
      for (i = 0; i <= nN; i++) if (sourced[i]) { reach[i] = 1; stack.push(i); }
      while (stack.length) { var u = stack.pop(), L = adj[u]; for (var j = 0; j < L.length; j++) if (!reach[L[j]]) { reach[L[j]] = 1; stack.push(L[j]); } }

      var xNet = new Float64Array(nNets), flNet = new Uint8Array(nNets), gNet = new Uint8Array(nNets);
      for (i = 0; i < nNets; i++) {
        var nd2 = nodeOfNet[i];
        if (nd2 === -1) { xNet[i] = 0; flNet[i] = 0; gNet[i] = 1; }
        else if (nd2 === -2) { xNet[i] = NaN; flNet[i] = 1; gNet[i] = 0; }
        else { xNet[i] = x[nd2]; flNet[i] = reach[nd2] ? 0 : 1; gNet[i] = gIslNode[nd2]; }
      }
      // OUTPUT pins per net (pin fight)
      var outs = {};
      if (drive.power && !drive.reset) Object.keys(drive.pins).forEach(function (gs) {
        var ps = drive.pins[gs]; if (!ps || ps.mode !== 1 || ps.dacV != null || gpioNet[gs] === undefined) return;
        var lvl = ps.pwm ? (cb.high[gs] ? 1 : 0) : (ps.level ? 1 : 0);
        (outs[gpioNet[gs]] = outs[gpioNet[gs]] || []).push({ g: +gs, lvl: lvl });
      });
      return { w: cb.w, high: cb.high, tag: cb.tag, xNet: xNet, flNet: flNet, gNet: gNet, elemI: elemI, clamp: clampInfo, outs: outs, ok: res.ok, it: iters };
    }

    function instNets(inst) {
      var s = {};
      P().instPins(inst).forEach(function (p) { s[netOf[p.ref]] = true; });
      return s;
    }
    function weightsFor(sol, inst) {
      var R = sol._res;
      if (R.length !== 2 || R[0].tag !== 'H') return R.map(function (r) { return r.w; });
      var ns = instNets(inst), sum = 0, cnt = 0;
      sol._pwm.forEach(function (p) { if (ns[gpioNet[p.g]]) { sum += p.duty; cnt++; } });
      var d = cnt ? sum / cnt : R[0].w;
      return [d, 1 - d];
    }

    /** Per-instance solution view handed to models (B2-internal). */
    function view(sol, inst) {
      var id = inst.id, R = sol._res, W = weightsFor(sol, inst), drive = sol.drive;
      function net(pid) { var n = netOf[id + '.' + pid]; return n === undefined ? -1 : n; }
      function vc(r, pid) { var n = net(pid); return n < 0 ? NaN : r.xNet[n]; }
      function I(r, key) { return r.elemI[id + ':' + key] || 0; }
      var V = {
        power: !!drive.power, drive: drive, shorted: !!shortedParts[id], raw: sol, nowUs: sol.nowUs,
        net: net,
        v: function (pid) {
          var s = 0, w = 0;
          for (var c = 0; c < R.length; c++) { var x = vc(R[c], pid); if (!isNaN(x) && W[c] > 0) { s += W[c] * x; w += W[c]; } }
          return w > 0 ? s / w : (R.length ? vc(R[0], pid) : NaN);
        },
        vd: function (a, b) { return V.v(a) - V.v(b); },
        vdPeak: function (a, b) { var m = -Infinity; for (var c = 0; c < R.length; c++) if (W[c] > 0) { var d = vc(R[c], a) - vc(R[c], b); if (d > m) m = d; } return m; },
        floating: function (pid) { var n = net(pid); return n < 0 ? true : !!sol.floating[n]; },
        i: function (key) { var s = 0; for (var c = 0; c < R.length; c++) s += W[c] * I(R[c], key); return s; },
        ipk: function (key) { var m = 0; for (var c = 0; c < R.length; c++) if (W[c] > 0) m = Math.max(m, Math.abs(I(R[c], key))); return m; },
        ms: function (key) { var s = 0; for (var c = 0; c < R.length; c++) { var x = I(R[c], key); s += W[c] * x * x; } return s; },
        wOver: function (key, thr) { var s = 0; for (var c = 0; c < R.length; c++) if (Math.abs(I(R[c], key)) > thr) s += W[c]; return s; },
        wVd: function (a, b, thr) { var s = 0; for (var c = 0; c < R.length; c++) if (vc(R[c], a) - vc(R[c], b) >= thr) s += W[c]; return s; },
        wVhigh: function (pid, thr) { var s = 0; for (var c = 0; c < R.length; c++) if (vc(R[c], pid) > thr) s += W[c]; return s; },
        pwmOn: function (pid) {
          var n = net(pid); if (n < 0 || !drive.power || drive.reset) return null;
          for (var gs in drive.pins) {
            var ps = drive.pins[gs];
            if (ps && ps.mode === 1 && ps.pwm && gpioNet[gs] === n) return { duty: ps.pwm.duty, hz: ps.pwm.hz, gpio: +gs };
          }
          return null;
        },
        netHasOutput: function (pid) {
          var n = net(pid); if (n < 0 || !drive.power || drive.reset) return false;
          for (var gs in drive.pins) { var ps = drive.pins[gs]; if (ps && ps.mode === 1 && gpioNet[gs] === n) return true; }
          return false;
        }
      };
      return V;
    }

    function assemble(drive, res, pwm, nowUs) {
      var sol = { ok: true, iterations: 0, drive: drive, nowUs: nowUs, _res: res, _pwm: pwm,
        v: new Float64Array(nNets), floating: new Uint8Array(nNets), gIsl: res[0].gNet,
        pinI: {}, supplyI: {}, visuals: {}, conds: [], short: null, resetHeld: null };
      for (var n = 0; n < nNets; n++) {
        var s = 0, w = 0, fl = 1;
        for (var c = 0; c < res.length; c++) {
          if (!res[c].flNet[n]) fl = 0;
          var x = res[c].xNet[n];
          if (!isNaN(x) && res[c].w > 0) { s += res[c].w * x; w += res[c].w; }
        }
        sol.floating[n] = fl;
        sol.v[n] = fl ? NaN : (w > 0 ? s / w : res[0].xNet[n]);
      }
      res.forEach(function (r) { sol.ok = sol.ok && r.ok; sol.iterations = Math.max(sol.iterations, r.it); });
      if (board) {
        var bid = board.id;
        Object.keys(gpioNet).forEach(function (g) {
          var s2 = 0; res.forEach(function (r) { s2 += r.w * -(r.elemI[bid + ':pin:' + g] || 0); });
          sol.pinI[g] = s2;
        });
        defs[bid].pins.forEach(function (p) {
          if (p.role !== 'power' || !(p.volts > 0)) return;
          var s3 = 0; res.forEach(function (r) { s3 += r.w * -(r.elemI[bid + ':sup:' + p.id] || 0); });
          sol.supplyI[p.id] = s3;
        });
      }
      /** Instantaneous voltage of a net for the given PWM phases (digital reads, §8.2). highFn(gpio) -> bool */
      sol.vAt = function (n, highFn) {
        if (n < 0) return NaN;
        var pick = res[0];
        if (res.length > 1) {
          if (res[0].tag === 'H') { var hi = 0; pwm.forEach(function (p) { if (highFn(p.g)) hi++; }); pick = hi * 2 >= pwm.length ? res[0] : res[1]; }
          else {
            for (var c = 0; c < res.length; c++) {
              var okc = true;
              for (var k = 0; k < pwm.length; k++) if (!!res[c].high[pwm[k].g] !== !!highFn(pwm[k].g)) { okc = false; break; }
              if (okc) { pick = res[c]; break; }
            }
          }
        }
        return pick.flNet[n] ? NaN : pick.xNet[n];
      };
      return sol;
    }

    function circuitConds(sol) {
      var out = [], drive = sol.drive, res = sol._res;
      structConds.forEach(function (c) { if (!c.power || drive.power) out.push(c); });
      // battery over-current
      insts.forEach(function (inst) {
        if (inst.type !== 'bat9v') return;
        var pk = 0; res.forEach(function (r) { pk = Math.max(pk, -(r.elemI[inst.id + ':bat'] || 0)); });
        if (pk > 2) out.push({ code: 'E_SHORT', vars: { supply: 'البطارية' }, refs: [inst.id] });
      });
      if (!board || !drive.power) return out;
      var bid = board.id, bd = defs[bid];
      // supply short (> 2 A) — includes a supply pin wired straight to GND (same node -> V/r)
      bd.pins.forEach(function (p) {
        if (p.role !== 'power' || !(p.volts > 0)) return;
        var pk = 0; res.forEach(function (r) { pk = Math.max(pk, -(r.elemI[bid + ':sup:' + p.id] || 0)); });
        if (pk > 2) { out.push({ code: 'E_SHORT', vars: { supply: p.label }, refs: [bid + '.' + p.id] }); if (!sol.short) sol.short = p.id; }
      });
      // reset held
      var rst = bd.pins.filter(function (p) { return p.role === 'rst'; })[0];
      if (rst) {
        var rv = sol.v[netOf[bid + '.' + rst.id]], th = board.type === 'esp32' ? 0.8 : 1.5;
        if (!isNaN(rv) && rv < th) { sol.resetHeld = rst.id; out.push({ code: 'H_RESET_HELD', vars: { pin: rst.label }, refs: [bid + '.' + rst.id] }); }
      }
      if (drive.reset) return out;
      // pin currents
      Object.keys(gpioNet).forEach(function (gs) {
        var pk = 0; res.forEach(function (r) { if (r.w > 0) pk = Math.max(pk, Math.abs(r.elemI[bid + ':pin:' + gs] || 0)); });
        if (pk > prof.pinAbsMaxA) pinDmg[gs] = Math.max(pinDmg[gs] || 0, pk * 1000);
        else if (pk > prof.pinRecA && !pinDmg[gs]) out.push({ code: 'W_PIN_CURRENT', vars: { pin: pinLabel(prof, +gs), mA: f1(pk * 1000) }, refs: [gpioRef[gs]] });
      });
      Object.keys(pinDmg).forEach(function (gs) { out.push({ code: 'E_PIN_CURRENT', vars: { pin: pinLabel(prof, +gs), mA: f1(pinDmg[gs]) }, refs: [gpioRef[gs]] }); });
      // output fight
      var fought = {};
      res.forEach(function (r) {
        if (!(r.w > 0)) return;
        Object.keys(r.outs).forEach(function (n) {
          var L = r.outs[n], hi = null, lo = null;
          L.forEach(function (o) { if (o.lvl) hi = hi || o; else lo = lo || o; });
          if (hi && lo && !fought[n]) {
            fought[n] = true;
            out.push({ code: 'E_PIN_FIGHT', vars: { a: pinLabel(prof, hi.g), b: pinLabel(prof, lo.g) }, refs: [gpioRef[hi.g], gpioRef[lo.g]] });
          }
        });
      });
      // over-voltage by clamp current
      var cl = {};
      res.forEach(function (r) { r.clamp.forEach(function (c) { if (!cl[c.g] || c.ic > cl[c.g].ic) cl[c.g] = c; }); });
      Object.keys(cl).forEach(function (gs) {
        var c = cl[gs], pin = pinLabel(prof, +gs), ref = gpioRef[gs];
        if (c.ic >= 0.001) out.push({ code: prof.board === 'esp32' ? 'E_ESP_5V' : 'E_OVERVOLT', vars: { pin: pin, v: f2(c.v0) }, refs: [ref] });
        else if (c.ic >= 20e-6 && prof.board === 'esp32')
          out.push({ code: 'H_ESP_5V_WEAK', vars: { pin: pin, v: f2(c.v0), part: partOnNet(gpioNet[gs]) || '' }, refs: [ref] });
      });
      // no common ground: a GPIO net that is sourced from an island without the board's GND
      Object.keys(gpioNet).forEach(function (gs) {
        var n = gpioNet[gs];
        if (!sol.floating[n] && !sol.gIsl[n]) {
          var part = partOnNet(n) || '';
          out.push({ code: 'W_NO_COMMON_GND', vars: { part: part }, refs: [gpioRef[gs]].concat(part ? [part] : []) });
        }
      });
      // I2C wiring of every powered LCD
      insts.forEach(function (inst) {
        if (inst.type !== 'lcd1602' || !states[inst.id].powered) return;
        var sda = netOf[inst.id + '.SDA'], scl = netOf[inst.id + '.SCL'], mS = gpioNet[prof.i2c.sda], mC = gpioNet[prof.i2c.scl];
        if (sda === mS && scl === mC) return;
        if (sda === mC && scl === mS) out.push({ code: 'W_I2C_SWAPPED', vars: {}, refs: [inst.id] });
        else out.push({ code: 'W_I2C_PINS', vars: { board: prof.name, sda: pinLabel(prof, prof.i2c.sda), scl: pinLabel(prof, prof.i2c.scl) }, refs: [inst.id] });
      });
      if (!sol.ok && !solverWarned) { solverWarned = true; out.push({ code: 'W_SOLVER', vars: {}, refs: [] }); }
      return out;
    }

    function runAfter(sol, dtUs, nowUs) {
      var visuals = {}, conds = [], dirty = false;
      insts.forEach(function (inst) {
        var m = defs[inst.id].model, st = states[inst.id];
        if (!m.after) return;
        var r = m.after(view(sol, inst), inst, st, dtUs, nowUs) || {};
        visuals[inst.id] = r.visual || {};
        (r.conds || []).forEach(function (c) { conds.push(c); });
        if (st._dirty) { st._dirty = false; dirty = true; }
      });
      if (dirty) version++;
      return { visuals: visuals, conds: conds };
    }
    function toMsgs(list) { return list.map(function (c) { return makeMsg(c.code, c.vars, c.refs); }); }
    function remember(list) { list.forEach(function (m) { seen[msgKey(m)] = m; }); }

    C.solve = function (drive, nowUs) {
      drive = normDrive(drive); nowUs = nowUs || 0;
      var pwm = [];
      if (drive.power && !drive.reset && board) Object.keys(drive.pins).forEach(function (gs) {
        var ps = drive.pins[gs];
        if (ps && ps.mode === 1 && ps.pwm && ps.dacV == null && ps.pwm.duty > 0 && ps.pwm.duty < 1 && gpioNet[gs] !== undefined)
          pwm.push({ g: +gs, duty: +ps.pwm.duty, hz: +ps.pwm.hz || 0 });
      });
      var combos = buildCombos(pwm), sol = null;
      for (var pass = 0; pass < 6; pass++) {
        var res = combos.map(function (cb) { return solveCombo(drive, cb, nowUs); });
        sol = assemble(drive, res, pwm, nowUs);
        var changed = false;
        for (var i = 0; i < insts.length; i++) {
          var m = defs[insts[i].id].model;
          if (m.decide && m.decide(view(sol, insts[i]), insts[i], states[insts[i].id], nowUs)) changed = true;
        }
        if (!changed) break;
      }
      var cc = toMsgs(circuitConds(sol));
      var af = runAfter(sol, 0, nowUs);
      sol.visuals = af.visuals;
      sol.conds = cc.concat(toMsgs(af.conds));
      sol._cc = cc;
      remember(sol.conds);
      lastSol = sol; lastSig = sigOf(drive); solVer = version;
      return sol;
    };

    C.advance = function (drive, nowUs) {
      drive = normDrive(drive); nowUs = nowUs || 0;
      if (!lastSol || solVer !== version || sigOf(drive) !== lastSig) C.solve(drive, nowUs);
      var dt = (lastAdvUs === null || nowUs < lastAdvUs) ? 0 : nowUs - lastAdvUs;
      lastAdvUs = nowUs;
      var af = runAfter(lastSol, dt, nowUs);
      lastSol.visuals = af.visuals;
      var all = {}, list = lastSol._cc.concat(toMsgs(af.conds));
      Object.keys(seen).forEach(function (k) { all[k] = seen[k]; });
      list.forEach(function (m) { all[msgKey(m)] = m; });
      seen = {};
      return { visuals: af.visuals, conds: Object.keys(all).map(function (k) { return all[k]; }) };
    };

    /* ---------------- state, controls, events ---------------- */
    C.netlist = function () {
      return { nets: nets.map(function (r, i) { return { id: i, refs: r.slice() }; }),
        netOf: function (ref) { var n = netOf[ref]; return n === undefined ? -1 : n; } };
    };
    C.setControl = function (instId, key, value, nowUs) {
      var inst = byId[instId]; if (!inst) return;
      var m = defs[instId].model, st = states[instId];
      if (m.control) m.control(inst, st, key, value, nowUs || 0); else st.ctl[key] = value;
      st._dirty = false;
      version++;
    };
    C.controls = function (instId) { var st = states[instId]; return st ? JSON.parse(JSON.stringify(st.ctl || {})) : {}; };
    C.state = function (instId) { return states[instId] || null; };
    C.repair = function (instId) {
      var inst = byId[instId]; if (!inst) return;
      var m = defs[instId].model, st = states[instId];
      if (m.repair) m.repair(inst, st);
      if (board && instId === board.id) pinDmg = {};
      Object.keys(seen).forEach(function (k) { if ((seen[k].refs || []).some(function (r) { return r === instId || r.indexOf(instId + '.') === 0; })) delete seen[k]; });
      version++;
    };
    /** Earliest timed model event (bounce toggle, PIR expiry…), Infinity if none. (B2 extra, used by board-sim) */
    C.nextEventUs = function () {
      var t = Infinity;
      insts.forEach(function (inst) { var m = defs[inst.id].model; if (m.events) t = Math.min(t, m.events(inst, states[inst.id])); });
      return t;
    };
    /** Processes timed model events up to nowUs; returns true if anything electrical changed. */
    C.tick = function (nowUs) {
      var ch = false;
      insts.forEach(function (inst) { var m = defs[inst.id].model; if (m.tick && m.tick(inst, states[inst.id], nowUs)) ch = true; });
      if (ch) version++;
      return ch;
    };
    /** Rebase every stored timestamp (keys ending in "Us", bounce queues) when the runner's clock restarts. */
    C.shiftTime = function (delta) {
      function sh(o) {
        Object.keys(o).forEach(function (k) {
          var v = o[k];
          if (typeof v === 'number' && /Us$/.test(k) && isFinite(v)) o[k] = v + delta;
          else if (Array.isArray(v)) v.forEach(function (x) { if (x && typeof x === 'object' && typeof x.tUs === 'number') x.tUs += delta; });
        });
      }
      Object.keys(states).forEach(function (id) { sh(states[id]); });
      if (lastAdvUs !== null) lastAdvUs += delta;
    };
    C.setBounce = function (on) { bounce = !!on; Object.keys(states).forEach(function (id) { if ('bounce' in states[id]) states[id].bounce = bounce; }); };
    C.version = function () { return version; };
    C.bump = function () { version++; };
    C.board = function () { return board; };
    C.profile = function () { return prof; };
    C.instances = function () { return insts.slice(); };
    C.instance = function (id) { return byId[id] || null; };
    C.ofType = function (type) { return insts.filter(function (i) { return i.type === type; }); };
    C.def = function (id) { return defs[id] || null; };
    C.netOfRef = function (ref) { var n = netOf[ref]; return n === undefined ? -1 : n; };
    C.netOfGpio = function (g) { var n = gpioNet[g]; return n === undefined ? -1 : n; };
    C.gpioRef = function (g) { return gpioRef[g] || null; };
    C.gpiosOnNet = function (n) { var o = []; Object.keys(gpioNet).forEach(function (g) { if (gpioNet[g] === n) o.push(+g); }); return o; };
    C.groundNet = function () { return groundNet; };
    C.lastSolution = function () { return lastSol; };
    C.view = function (instId) { return lastSol && byId[instId] ? view(lastSol, byId[instId]) : null; };
    return C;
  }

  NS.Circuit = { create: create, WARN: WARN, makeMsg: makeMsg, fill: fill, msgKey: msgKey, pinLabel: pinLabel };
})(typeof window !== 'undefined' ? window : globalThis);
