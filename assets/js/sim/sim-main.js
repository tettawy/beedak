/* بإيدك lab simulator: sim-main.js (lab-sim-spec.md §6.8, §10, §11). NS.App
   Boot, board picker, project state, workbench ⇄ circuit ⇄ simulated board ⇄ interpreter, the run loop (virtual time,
   per-frame budget, speed), two-stage gating (stage 1 on the simulator, stage 2 on the visitor's board over Web Serial),
   problems (events + conditions), serial monitor, audio, save / load / export / import, and the WhatsApp notes form
   (ported from the retired lab.js). Loaded last (defer); everything else is read from NS at call time.
   No eval / new Function; visitor text only through textContent (panels.js). */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};

  var STORE_KEY = 'beedak-lab-project-v1', SOUND_KEY = 'beedak-lab-sound';
  var WA_NUMBER = '201068530159';                        // same number as app.js / the retired lab.js
  var EMPTY_CODE = 'void setup() {\n  // الكود اللي هنا بيشتغل مرة واحدة أول ما الكارت يشتغل\n\n}\n\nvoid loop() {\n  // الكود اللي هنا بيتكرر على طول\n\n}\n';
  var BOOT_ESP = 'ets Jun  8 2016 00:22:57\n\nrst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\n';
  var AR = {
    compileFail: '{probs} في الكود. صلّحوها الأول.',          // {probs}: probsAr(n), batch 4
    compileOk: 'الكود اتعمله compile من غير أخطاء.',
    uploading: 'بيرفع الكود على الكارت الوهمي…',
    boardOff: 'الكارت فصل. {reason}',
    slow: 'الـloop بتلف من غير ما تستنى، فالمحاكي أبطأ من الكارت الحقيقي دلوقتي ({x}×). ده طبيعي.',
    portBusy: 'الجهاز ما اتفتحش. اقفلوا أي برنامج تاني فاتح البورت (زي Serial Monitor في Arduino IDE)، وجرّبوا تاني.',
    realRunning: 'شغال على جهازكم. كل قراية بتاخد كام مللي ثانية لأنها رايحة جاية على الـUSB.',
    confirmTitle: 'قبل ما نبعت لجهازكم',
    confirmBody: 'اتأكدوا إن التوصيل على جهازكم زي اللي على الطاولة بالظبط. الكود هيستخدم الأطراف دي:',
    confirmOk: 'أيوه، شغّلوه', confirmNo: 'لأ، استنوا',
    baudHint: 'سرعة الشاشة ({m}) مش زي Serial.begin({b})، علشان كده الكلام طالع ملخبط.',
    saved: 'اتحفظ على الجهاز ده.',
    restored: 'رجّعنا آخر شغل ليكم.',
    noStore: 'المتصفح مش سامح بالحفظ، فاحفظوا ملف لو عايزين ترجعوا للشغل.',
    badFile: 'الملف ده مش ملف معمل «بإيدك».',
    bigFile: 'الملف كبير قوي (الحد 500 كيلوبايت).',
    unknownPart: 'فيه قطعة مش معروفة: {type}.',
    noSerialApi: 'مش متاح هنا',
    noDevice: 'مفيش جهاز متوصّل',
    checking: 'بيتأكد من الجهاز…',                         // NEW COPY
    connected: 'متوصّل: {name}',                            // NEW COPY
    fromCode: 'من الكود:',                                   // NEW COPY (sketch Serial during stage 2)
    realStopped: 'وقف على جهازكم.',                         // NEW COPY
    realFailed: 'وقف على جهازكم بسبب مشكلة. شوفوا «المشاكل».', // NEW COPY
    noSerialBrowser: 'التوصيل مش متاح في المتصفح ده.',
    sumTitle: 'ملخص المعمل:', sumBoard: '- الكارت: ', sumParts: '- القطع: ', sumS1: '- على المحاكي: ', sumHw: '- جهازنا: ', sumCode: '- الكود:',
    sumNone: 'الكارت بس', sumNotConn: 'مش متوصّل',          // NEW COPY (summary words)
    s1: { idle: 'لسه ما اتشغلش', running: 'كان لسه شغال', pass: 'نجح من غير أخطاء', fail: 'فيه مشاكل' }, // NEW COPY (summary)
    // paid technical session from the lab (batch 1, problem 2) — NEW COPY
    techMsg: 'عايزين نحجز جلسة فنية (450 جنيه). الدايرة مش شغالة.',
    sumProbs: '- آخر المشاكل: ', sumNoProbs: 'مفيش',
    sumLen: '- عدد سطور الكود: {lines}، وعدد الحروف: {chars}',
    techToast: 'مش عارفين تصلّحوها؟ نقدر نراجعها معاكم في جلسة فنية (450 جنيه).',
    techToastBtn: 'احجزوا على واتساب'
  };
  function fill(t, v) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  // Arabic count agreement (batch 4): 0 → «مفيش», 1 → singular, 2 → dual, 3–10 → plural, 11+ → singular.
  function probsAr(n) { return n === 0 ? 'مفيش مشاكل' : n === 1 ? 'فيه مشكلة واحدة' : n === 2 ? 'فيه مشكلتين' : n <= 10 ? 'فيه ' + n + ' مشاكل' : 'فيه ' + n + ' مشكلة'; }
  function store(get, val) {
    try {
      if (get) return root.localStorage.getItem(get);
      if (val === null) root.localStorage.removeItem(STORE_KEY); else root.localStorage.setItem(val.k, val.v);
      return true;
    } catch (e) { return get ? null : false; }
  }
  function deep(o) { return JSON.parse(JSON.stringify(o)); }

  /* =====================================================================
     state
     ===================================================================== */
  var S = {
    ui: null, wb: null, board: null, profile: null, boardId: null,
    project: null, circuit: null, io: null, netCache: null,
    program: null, compileMsgs: [], runner: null, run: 'stopped', /* stopped | uploading | sim | real */
    gate: null, compileFailN: 0, events: [], conds: [], visuals: {}, sel: null,
    speed: 1, sound: true, now: 0, lastTs: 0, raf: 0, uiT: 0, slow: { t0: 0, s0: 0, bad: 0, said: false },
    exampleId: null, exampleCode: null, saveT: 0, storeOk: true,
    serialBaud: null, monitorBaud: 9600, passPins: null, boardOff: null,
    real: { conn: null, info: null, busy: false, io: null, runner: null, raf: 0, lastSent: null, fail: false },
    audio: { ctx: null, osc: {}, relay: {} }
  };
  var P = function () { return NS.Parts; };

  /* =====================================================================
     boot
     ===================================================================== */
  function init() {
    var app = root.document.getElementById('sim-app');
    if (!app || !NS.Parts || !NS.Interp || !NS.Circuit || !NS.IO || !NS.IO.Sim || !NS.Workbench || !NS.UI) return;
    S.gate = NS.IO.Real.Gate.create({ windowS: 3 });
    S.ui = NS.UI.build(app, API);
    app.hidden = false;
    Array.prototype.forEach.call(root.document.querySelectorAll('.sim-nojs'), function (e) { e.hidden = true; });
    var lab = root.document.getElementById('lab'); if (lab) lab.classList.add('sim-on');
    var snd = store(SOUND_KEY); S.sound = snd !== 'off'; S.ui.setSound(S.sound);
    S.wb = NS.Workbench.mount(S.ui.benchEl, {
      onChange: onBenchChange, onSelect: onSelect, onPrimary: onPrimary,
      getNet: function (ref) { var n = netOf(ref); return n.length ? n : [ref]; },
      probe: function (ref) { if (S.run !== 'sim' || !S.io) return null; var i = S.io.pinInfo(ref); return i ? { v: i.v, mode: i.mode, floating: i.floating } : null; }
    });
    initHw();
    initForm();
    root.document.addEventListener('visibilitychange', function () { if (root.document.hidden) audioStop(); });
    // restore the last project
    var saved = null, raw = store(STORE_KEY);
    if (raw) { try { saved = JSON.parse(raw); } catch (e) { saved = null; } }
    var ok = saved && saved.format === 'beedak-lab' && validProject(saved).ok;
    if (ok) {
      loadProject(saved);
      S.ui.toast(AR.restored, { label: S.ui.AR.startOver, fn: function () { store(null, null); stopAll(); S.ui.showPicker(true); } });
    } else S.ui.showPicker(true);
    if (!testStore()) { S.storeOk = false; S.ui.toast(AR.noStore); }
  }
  function testStore() { try { root.localStorage.setItem('beedak-lab-t', '1'); root.localStorage.removeItem('beedak-lab-t'); return true; } catch (e) { return false; } }

  /* =====================================================================
     project
     ===================================================================== */
  function newProject(board) {
    var id = P().newId(board, []);
    return { format: 'beedak-lab', version: 1, board: board,
      parts: [{ id: id, type: board, x: 0, y: 0, rot: 0, props: {} }], wires: [], controls: {},
      code: EMPTY_CODE, serial: { baud: board === 'esp32' ? 115200 : 9600, lineEnding: 'nl' } };
  }
  function validProject(p) {
    if (!p || !Array.isArray(p.parts) || !Array.isArray(p.wires)) return { ok: false, errors: [AR.badFile] };
    try { return P().validate(P().resolvePlacement(deep(p))); } catch (e) { return { ok: false, errors: [AR.badFile] }; }
  }
  function boardOf(parts) { for (var i = 0; i < parts.length; i++) { var d = P().get(parts[i].type); if (d && d.kind === 'board') return parts[i]; } return null; }
  function loadProject(p, opts) {
    stopAll();
    p = P().resolvePlacement(deep(p));
    p.parts.forEach(function (q) { delete q.on; });
    var b = boardOf(p.parts);
    S.project = p; S.board = b ? b.type : (p.board || 'uno'); S.boardId = b ? b.id : null;
    S.profile = P().profile(S.board);
    S.exampleId = opts && opts.exampleId || null;
    S.exampleCode = S.exampleId ? p.code : null;
    S.ui.showPicker(false);
    S.ui.setBoard(S.board);
    S.ui.setExampleNote(S.exampleId && NS.Examples ? NS.Examples.filter(function (e) { return e.id === S.exampleId; })[0] : null);
    S.ui.setCode(p.code || '');
    S.ui.showRestore(false);
    S.monitorBaud = (p.serial && p.serial.baud) || (S.board === 'esp32' ? 115200 : 9600);
    S.ui.setMonitor(S.monitorBaud, (p.serial && p.serial.lineEnding) || 'nl');
    S.ui.serialClear(); S.ui.baudHint('');
    // circuit + simulated board
    S.circuit = NS.Circuit.create();
    S.circuit.load({ parts: p.parts, wires: p.wires });
    var c = p.controls || {};
    for (var id in c) for (var k in c[id]) { try { S.circuit.setControl(id, k, c[id][k], 0); } catch (e) { /* unknown control */ } }
    S.netCache = null;
    S.io = NS.IO.Sim.create({ circuit: S.circuit, profile: S.profile, boardId: S.boardId, onMsg: onIoMsg, onPower: onPower, onReset: onBoardReset, random: Math.random });
    S.io.setPowered(false);
    S.wb.load({ parts: p.parts, wires: p.wires });
    S.events = []; S.conds = []; S.compileFailN = 0; S.sel = null; S.program = null; S.boardOff = null; S.passPins = null;
    S.gate = NS.IO.Real.Gate.create({ windowS: 3 });
    S.ui.renderInspector(null); S.ui.sideTab('cat');
    S.ui.renderOnBench(p.parts, null);
    S.ui.setMarks([]);
    refreshStopped();
    updateStages();
    if (S.ui.refreshHelp) S.ui.refreshHelp();
    scheduleSave();
  }
  function projectNow() {
    var c = S.wb.getCircuit(), controls = {};
    c.parts.forEach(function (q) {
      var d = P().get(q.type);
      if (d && d.controls && d.controls.length) {
        var v = S.circuit.controls(q.id) || {}, o = {}, any = false;
        d.controls.forEach(function (cd) { if (cd.type !== 'button' && cd.type !== 'momentary' && v[cd.key] != null) { o[cd.key] = v[cd.key]; any = true; } });
        if (any) controls[q.id] = o;
      }
    });
    return { format: 'beedak-lab', version: 1, board: S.board, parts: c.parts, wires: c.wires, controls: controls,
      code: S.ui.getCode(), serial: { baud: S.monitorBaud, lineEnding: S.ui.lineEnding() }, savedAt: new Date().toISOString() };
  }
  function scheduleSave() {
    clearTimeout(S.saveT);
    S.saveT = setTimeout(function () { if (!S.project) return; store(false, { k: STORE_KEY, v: JSON.stringify(projectNow()) }); }, 1000);
  }

  /* =====================================================================
     bench <-> circuit
     ===================================================================== */
  function netOf(ref) {
    if (!S.circuit) return [];
    if (!S.netCache) S.netCache = S.circuit.netlist();
    var nl = S.netCache, id = nl.netOf(ref);
    if (id < 0) return [];
    var n = nl.nets.filter(function (x) { return x.id === id; })[0] || nl.nets[id];
    return n ? n.refs.slice() : [];
  }
  function onBenchChange(circ, ch) {
    S.project.parts = circ.parts; S.project.wires = circ.wires;
    S.circuit.load({ parts: circ.parts, wires: circ.wires });
    S.netCache = null;
    S.io.invalidate();
    if (S.run === 'sim') S.gate.circuitChanged(S.runner ? S.runner.now() : 0);
    else S.gate.circuitChanged();
    if (S.run !== 'sim') refreshStopped();
    S.ui.renderOnBench(circ.parts, S.sel && S.sel.kind === 'part' ? S.sel.id : null);
    if (S.sel) {
      var exists = S.sel.kind === 'part' ? circ.parts.some(function (q) { return q.id === S.sel.id; }) : circ.wires.some(function (w) { return w.id === S.sel.id; });
      if (!exists) S.sel = null;
    }
    renderInspector();
    updateStages();
    scheduleSave();
  }
  function onSelect(sel) {
    S.sel = sel;
    S.ui.renderOnBench(S.wb.getCircuit().parts, sel && sel.kind === 'part' ? sel.id : null);
    renderInspector();
    if (sel && !S.adding) { S.ui.sideTab('ins'); S.ui.openSheet(); }
  }
  function onPrimary(id, key, value) { control(id, key, value); }
  function control(id, key, value) {
    if (!S.io) return;
    S.io.setControl(id, key, value);
    if (S.run !== 'sim') refreshStopped();
    scheduleSave();
  }
  function renderInspector() {
    var sel = S.sel;
    if (!sel) { S.ui.renderInspector(null); return; }
    var c = S.wb.getCircuit();
    if (sel.kind === 'wire') { S.ui.renderInspector(sel, c.wires.filter(function (w) { return w.id === sel.id; })[0]); return; }
    var inst = c.parts.filter(function (q) { return q.id === sel.id; })[0];
    if (!inst) { S.ui.renderInspector(null); return; }
    var st = {}; try { st = S.circuit.state(inst.id) || {}; } catch (e) { st = {}; }
    var vis = S.visuals[inst.id] || {};
    S.ui.renderInspector(sel, {
      inst: inst, def: P().get(inst.type), controls: S.circuit.controls(inst.id) || {}, visual: vis,
      damaged: !!(st.burnt || st.damaged || vis.burnt === true || vis.damaged || (vis.burnt && typeof vis.burnt === 'object' && (vis.burnt.r || vis.burnt.g || vis.burnt.b))),
      pending: S.wb.pendingWire(),
      wiresAt: function (ref) { return c.wires.filter(function (w) { return w.a === ref || w.b === ref; }).map(function (w) { return { id: w.id, other: w.a === ref ? w.b : w.a }; }); },
      netOf: function (ref) { return netOf(ref).filter(function (r) { return r !== ref && !/^bb\d+\./.test(r); }).concat(netOf(ref).filter(function (r) { return r !== ref && /^bb\d+\./.test(r); }).slice(0, 1)); }
    });
  }
  function refreshStopped() {
    if (!S.io || S.run === 'sim') return;
    var f = S.io.frame(S.now);
    applyFrame(f);
  }
  function applyFrame(f) {
    var prevVis = S.visuals;
    S.visuals = f.visuals || {}; S.conds = f.conds || [];
    S.wb.setVisuals(S.visuals);
    var newlyDamaged = Object.keys(S.visuals).some(function (id) { var v = S.visuals[id], o = prevVis[id] || {}; return (v.burnt === true && o.burnt !== true) || (v.damaged && !o.damaged); });
    if (newlyDamaged && S.sel && S.sel.kind === 'part') renderInspector();
    updateProblems();
    if (S.sound && S.run === 'sim') audioFrame();
  }

  /* =====================================================================
     messages
     ===================================================================== */
  function addEvent(m) {
    if (!m || !m.code) return;
    if (!m.msg_ar) m.msg_ar = m.code;
    S.events.push(m);
    if (S.events.length > 50) S.events.shift();
    if (S.run === 'sim') S.gate.msg(m);
  }
  function onIoMsg(m) { addEvent(m); }
  function onRunMsg(m) { addEvent(m); }
  function problems() {
    var seen = {}, out = [];
    function key(m) { return m.code + '|' + (m.refs ? m.refs.slice().sort().join() : '') + '|' + (m.line || '') + '|' + m.msg_ar; }
    S.conds.concat(S.events.slice().reverse()).forEach(function (m) { var k = key(m); if (seen[k]) return; seen[k] = 1; out.push(m); });
    var rank = { error: 0, warn: 1, hint: 2 };
    out.sort(function (a, b) { return (rank[a.sev] || 3) - (rank[b.sev] || 3); });
    return out;
  }
  function updateProblems() {
    var list = problems();
    S.ui.setProblems(list);
    var codeMsgs = list.filter(function (m) { return m.line; });
    S.ui.setMarks(codeMsgs);
    var marks = [];
    list.forEach(function (m) { (m.refs || []).forEach(function (r) { marks.push({ ref: r, sev: m.sev }); }); });
    S.wb.setMarks(marks);
  }

  /* =====================================================================
     run (stage 1: simulator)
     ===================================================================== */
  function run() {
    if (S.run === 'real' || !S.project) return;
    // cookie-free analytics (batch 3): one event per example per visit; beedakTrack comes from app.js and never throws
    if (S.exampleId && !(S.exTracked = S.exTracked || {})[S.exampleId]) {
      S.exTracked[S.exampleId] = 1;
      try { if (typeof root.beedakTrack === 'function') root.beedakTrack('lab_example_run', { example: S.exampleId }); } catch (e) { /* ignore */ }
    }
    audioInit();
    stopSim(true);
    var code = S.ui.getCode(); S.project.code = code;
    var comp = NS.Interp.compile(code, S.profile);
    S.events = []; S.boardOff = null;
    S.compileMsgs = comp.msgs || [];
    S.compileMsgs.forEach(function (m) { if (!m.msg_ar) m.msg_ar = m.code; S.events.push(m); });
    if (!comp.ok) {
      S.compileFailN = S.compileMsgs.filter(function (m) { return m.sev === 'error'; }).length;
      S.program = null;
      updateProblems(); updateStages();
      var first = S.compileMsgs.filter(function (m) { return m.sev === 'error' && m.line; })[0];
      if (first) S.ui.say(fill(AR.compileFail, { probs: probsAr(S.compileFailN) }));
      return;
    }
    S.compileFailN = 0;
    S.program = comp.program;
    S.passPins = null;
    S.run = 'uploading';
    S.io.setPowered(true);
    S.runner = NS.Interp.createRunner(S.program, {
      io: S.io, profile: S.profile,
      onSerialOut: onSerialOut, onMsg: onRunMsg, onState: function () { }
    });
    S.io.setClock(function () { return S.runner ? S.runner.now() : 0; });
    S.io.setInterruptSink(function (id) { if (S.runner) S.runner.raise(id); });
    S.run = 'uploading';
    S.ui.setRunning('sim');
    S.ui.setStage(1, 'run', AR.uploading);
    updateProblems();
    setTimeout(function () {
      if (S.run !== 'uploading') return;
      startRunner();
      S.run = 'sim';
      S.lastTs = 0; S.slow = { t0: 0, s0: 0, bad: 0, said: false };
      S.raf = root.requestAnimationFrame(loop);
      updateStages();
    }, 300);
  }
  function startRunner() {
    if (S.board === 'esp32') { serialChunk(BOOT_ESP, 115200); }
    S.runner.start();
    S.io.setClock(function () { return S.runner ? S.runner.now() : 0; });
    S.io.setInterruptSink(function (id) { if (S.runner) S.runner.raise(id); });
    S.gate.start(0, S.compileMsgs);
    S.now = 0;
  }
  function loop(ts) {
    S.raf = 0;
    if (S.run !== 'sim' || !S.runner) return;
    var dt = S.lastTs ? Math.min(100, ts - S.lastTs) : 16;
    S.lastTs = ts;
    var before = S.runner.now();
    try { S.runner.runUntil(before + dt * 1000 * S.speed, 8); }
    catch (e) { addEvent({ code: 'E_INTERNAL', sev: 'error', msg_ar: (NS.Interp.MSG.E_INTERNAL && NS.Interp.MSG.E_INTERNAL.ar) || 'E_INTERNAL' }); if (root.console) root.console.warn(e); }
    if (S.run !== 'sim' || !S.runner) return;          // stopped from a callback (short)
    S.now = S.runner.now();
    var f = S.io.frame(S.now);
    S.gate.tick(S.now, { powered: S.io.powered(), conds: f.conds });
    applyFrame(f);
    if (S.now > before) slowCheck(ts, S.now); else S.slow.t0 = 0; // review fix (lab-1-06): a halted sketch is not 'slow'
    flushSerial();
    var gs = S.gate.state();
    if (ts - S.uiT > 200 || gs !== S.lastGate) { S.uiT = ts; S.lastGate = gs; updateStages(); if (S.sel && S.sel.kind === 'part' && S.ui.isInspecting(S.sel.id)) { /* live values are on the bench */ } }
    S.raf = root.requestAnimationFrame(loop);
  }
  function slowCheck(ts, now) {
    var s = S.slow;
    if (!s.t0) { s.t0 = ts; s.s0 = now; return; }
    if (ts - s.t0 < 1000) return;
    var ratio = (now - s.s0) / ((ts - s.t0) * 1000 * S.speed);
    s.bad = ratio < 0.5 ? s.bad + 1 : 0;
    if (s.bad >= 2 && !s.said) {
      s.said = true;
      addEvent({ code: 'H_SLOW', sev: 'hint', msg_ar: fill(AR.slow, { x: (Math.round(ratio * 100) / 100) }) });
    }
    s.t0 = ts; s.s0 = now;
  }
  function stopSim(quiet) {
    if (S.raf) { root.cancelAnimationFrame(S.raf); S.raf = 0; }
    if (S.runner) { try { S.runner.stop(); } catch (e) { /* already stopped */ } }
    var was = S.run;
    if (S.run === 'sim' || S.run === 'uploading') S.run = 'stopped';
    if (S.io) S.io.setPowered(false);
    S.gate.stop();
    audioStop();
    flushSerial();
    if (!quiet) { S.ui.setRunning('stopped'); refreshStopped(); updateStages(); }
    return was;
  }
  function stop() { if (S.run === 'real') return stopReal(); stopSim(false); }
  function reset() {
    if (S.run !== 'sim' || !S.runner) return;
    S.events = S.compileMsgs.slice();
    startRunner();
    updateProblems(); updateStages();
  }
  function onBoardReset() {                    // the board came out of reset by itself (button / wiring)
    if (S.run !== 'sim' || !S.runner) return;
    startRunner();
  }
  function onPower(on, reason) {        // the board lost power by itself (supply short): it stops like a real board
    if (on || (S.run !== 'sim' && S.run !== 'uploading')) return;
    S.boardOff = reason;
    setTimeout(function () {
      var wasSim = S.run === 'sim';
      if (S.run === 'sim' || S.run === 'uploading') stopSim(false);
      var cond = S.conds.filter(function (m) { return m.code === reason; })[0];
      S.boardOff = cond ? cond.msg_ar : (NS.Circuit.WARN[reason] ? NS.Circuit.WARN[reason].ar : reason);
      if (cond && !wasSim) S.events.push(cond);
      updateProblems(); updateStages();
    }, 0);
  }
  function stopAll() { if (S.run === 'real') stopReal(); stopSim(false); }

  /* ---------- serial (sim) ---------- */
  var serialBuf = [];
  function onSerialOut(text, baud) {
    if (baud && baud !== S.serialBaud) S.serialBaud = baud;
    serialChunk(text, baud);
  }
  function serialChunk(text, baud) { serialBuf.push({ t: text, b: baud }); if (S.run !== 'sim') flushSerial(); }
  function flushSerial() {
    if (!serialBuf.length) return;
    var q = serialBuf; serialBuf = [];
    var mismatch = null;
    // review fix (lab-1-02): one DOM write per kind-run per frame instead of one per print(), capped to the last ~1000 lines
    var pend = '', pendK = null;
    function done() {
      if (pendK === null) return;
      var NL = String.fromCharCode(10), cut = pend.length, n = 0;
      while (n < 1001 && cut > 0) { cut = pend.lastIndexOf(NL, cut - 1); if (cut < 0) break; n++; }
      if (n >= 1001 && cut > 0) pend = pend.slice(cut + 1); // the monitor keeps 1000 lines anyway
      S.ui.serialWrite(pend, pendK); pend = ''; pendK = null;
    }
    function put(s, k) { if (pendK !== null && pendK !== k) done(); pendK = k; pend += s; }
    q.forEach(function (c) {
      if (c.b && c.b !== S.monitorBaud) {
        mismatch = c.b;
        var bytes = utf8(c.t), s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(0xA0 + ((bytes[i] * 37 + 11) & 0x5F));
        put(s, 'garble');
      } else put(c.t, S.run === 'real' ? 'code' : '');
    });
    done();
    if (mismatch) S.ui.baudHint(fill(AR.baudHint, { m: S.monitorBaud, b: mismatch }));
  }
  function utf8(s) {
    if (root.TextEncoder) return new root.TextEncoder().encode(s);
    var out = []; for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF); return out;
  }
  function serialSend(text) {
    var le = S.ui.lineEnding(), end = le === 'nl' ? '\n' : le === 'cr' ? '\r' : le === 'both' ? '\r\n' : '';
    var r = S.run === 'sim' ? S.runner : S.run === 'real' ? S.real.runner : null;
    if (r) r.serialIn(String(text) + end);
  }

  /* =====================================================================
     stages
     ===================================================================== */
  function stage1State() {
    if (S.compileFailN) return 'fail';
    var g = S.gate.state();
    return g === 'running' ? 'running' : g === 'pass' ? 'pass' : g === 'fail' ? 'fail' : g === 'changed' ? 'changed' : 'idle';
  }
  function realCheck() {
    var R = NS.IO.Real, conn = S.real.conn && S.real.info;
    var pins = S.passPins || [];
    return R.check({ stage1: S.gate.state() === 'pass' && !S.compileFailN ? 'pass' : 'no', connected: !!conn,
      version: conn ? S.real.info.version : null, realBoard: conn ? S.real.info.board : undefined, simBoard: S.board,
      features: S.program ? S.program.features : [], pins: pins, profile: S.profile });
  }
  function updateStages() {
    var ui = S.ui, s1 = stage1State(), st = S.gate.status();
    if (S.run === 'uploading') { /* keep the upload line */ }
    else if (S.compileFailN) ui.setStage(1, 'fail', fill(AR.compileFail, { probs: probsAr(S.compileFailN) }));
    else if (S.boardOff && S.run !== 'sim') ui.setStage(1, 'fail', fill(AR.boardOff, { reason: S.boardOff }));
    else if (s1 === 'idle') ui.setStage(1, 'idle', S.ui.AR.stageIdle);
    else ui.setStage(1, s1 === 'running' ? 'run' : s1 === 'changed' ? 'wait' : s1, st.msg_ar);
    offerTechOnce(S.run !== 'uploading' && (S.compileFailN > 0 || (!!S.boardOff && S.run !== 'sim') || s1 === 'fail'));
    // remember the pins of the passing run (§10.4 item 5)
    if (s1 === 'pass' && S.program && S.runner && !S.passPins) S.passPins = (S.program.pinsUsed || []).concat(S.runner.pinsTouched ? S.runner.pinsTouched() : []);
    if (s1 !== 'pass' && S.run !== 'real') S.passPins = null;
    // stage 2
    if (S.run === 'real') { ui.setStage(2, 'run', AR.realRunning); ui.setRealButtons(false, true); return; }
    if (!NS.IO.Real.available()) { ui.setStage(2, 'locked', AR.noSerialBrowser); ui.setRealButtons(false, false); return; }
    var c = realCheck();
    if (c.ok) { ui.setStage(2, 'ready', fill('جاهز يتبعت لـ {name}.', { name: S.real.conn.info && S.real.conn.info.name ? S.real.conn.info.name : NS.IO.Real.BOARDS[S.board].name })); ui.setRealButtons(true, false); }
    else {
      var txt = S.real.fail && c.reason !== 'locked' ? AR.realFailed : c.msg_ar;
      ui.setStage(2, c.reason === 'noDevice' && s1 === 'pass' ? 'wait' : c.reason === 'locked' || c.reason === 'noDevice' ? 'locked' : 'fail', txt);
      ui.setRealButtons(false, false);
    }
  }

  /* =====================================================================
     real board (stage 2)
     ===================================================================== */
  function hwState(o) {
    var avail = NS.IO.Real.available();
    S.ui.setHw({ available: avail, state: o ? o.state : 'off', text: o ? o.text : (avail ? AR.noDevice : AR.noSerialApi), connected: !!S.real.conn, busy: S.real.busy });
  }
  function initHw() {
    hwState();
    var nav = root.navigator;
    if (!NS.IO.Real.available()) return;
    try {
      nav.serial.addEventListener('disconnect', function (e) { if (S.real.conn && e && e.target === S.real.conn.port) lostPort(); });
    } catch (e) { /* events not supported */ }
  }
  function connect() {
    if (S.real.busy) return;
    if (S.real.conn) { disconnect(); return; }
    var nav = root.navigator;
    S.real.busy = true; hwState({ state: 'busy', text: AR.checking });
    var gotPort = false; // review fix (lab-1-04): a picked port that fails to open must not fail silently
    Promise.resolve().then(function () { return nav.serial.requestPort(); }).then(function (port) {
      gotPort = true;
      return NS.IO.Real.openPort(port, { baud: S.ui.hwBaud() });
    }).then(function (conn) {
      S.real.conn = conn;
      conn.addLineListener(function (t) { if (!/^(ok|err)\s/i.test(t)) S.ui.serialLine(t, 'dev'); });
      if (conn.addLostListener) conn.addLostListener(lostPort);
      return NS.IO.Real.ping(conn, { tries: 3, timeoutMs: 1500 });
    }).then(function (info) {
      S.real.info = info; S.real.busy = false; S.real.fail = false;
      var name = info.board && NS.IO.Real.BOARDS[info.board] ? NS.IO.Real.BOARDS[info.board].name : (S.real.conn.info && S.real.conn.info.name) || '';
      if (info.version < 2) hwState({ state: 'err', text: NS.IO.Real.AR.oldBridge });
      else hwState({ state: 'on', text: fill(AR.connected, { name: name }) });
      updateStages();
    }, function (e) {
      S.real.busy = false;
      var picked = gotPort || !!S.real.conn;
      if (S.real.conn) { try { S.real.conn.close(); } catch (x) { /* gone */ } }
      S.real.conn = null; S.real.info = null;
      hwState(picked ? { state: 'err', text: (e && e.detail) || (S.real.conn ? NS.IO.Real.AR.noReply : AR.portBusy) } : null);
      updateStages();
    });
  }
  function disconnect() {
    if (S.run === 'real') stopReal();
    var c = S.real.conn; S.real.conn = null; S.real.info = null;
    if (c) { try { Promise.resolve(c.close()).catch(function () { /* gone */ }); } catch (e) { /* gone */ } }
    hwState(); updateStages();
  }
  function lostPort() {
    if (!S.real.conn) return;
    if (S.run === 'real') stopReal(true);
    S.real.conn = null; S.real.info = null;
    hwState({ state: 'err', text: NS.IO.Real.AR.errLost }); updateStages();
  }
  function runReal() {
    if (S.run === 'real') return;
    var c = realCheck(); if (!c.ok) { updateStages(); return; }
    var rows = NS.IO.Real.pinsSummary(S.passPins || [], S.profile).map(function (r) { return r.text_ar; });
    S.ui.confirm({ title: AR.confirmTitle, body: AR.confirmBody, rows: rows, ok: AR.confirmOk, cancel: AR.confirmNo }).then(function (yes) {
      if (!yes || !S.real.conn) return;
      stopSim(false);
      S.events = []; S.real.fail = false;
      var io = NS.IO.Real.create({ port: S.real.conn, profile: S.profile, onMsg: function (m) { addEvent(m); if (m.sev === 'error') S.real.fail = true; updateProblems(); },
        onLine: function () { /* device lines are shown by the connection listener */ },
        onFatal: function () { S.real.fail = true; stopReal(true); } });
      S.real.io = io;
      S.real.runner = NS.Interp.createRunner(S.program, { io: io, profile: S.profile, onSerialOut: function (t, b) { serialChunk(t, b); flushSerial(); },
        onMsg: function (m) { addEvent(m); if (m.sev === 'error') S.real.fail = true; updateProblems(); }, onState: function (st) { if (st === 'error') { S.real.fail = true; } } });
      S.run = 'real';
      S.wb.setReadOnly(true);
      S.ui.setRunning('real');
      S.ui.serialLine(AR.fromCode, 'sys');
      S.real.runner.start();
      updateProblems(); updateStages();
      S.real.raf = root.requestAnimationFrame(realLoop);
    });
  }
  function realLoop() {
    S.real.raf = 0;
    if (S.run !== 'real' || !S.real.runner) return;
    try { S.real.runner.runUntil(Infinity, 8); } catch (e) { S.real.fail = true; stopReal(true); return; }
    if (S.real.fail && S.real.runner.state === 'error') { stopReal(true); return; }
    S.real.raf = root.requestAnimationFrame(realLoop);
  }
  function stopReal(failed) {
    if (S.real.raf) { root.cancelAnimationFrame(S.real.raf); S.real.raf = 0; }
    var r = S.real.runner, io = S.real.io;
    S.real.runner = null; S.real.io = null;
    if (r) { try { r.stop(); } catch (e) { /* stopped */ } }
    if (io) { try { if (failed && io.abort) io.abort(); else if (io.stop) Promise.resolve(io.stop()).catch(function () { /* board gone */ }); } catch (e) { /* gone */ } }
    if (S.run === 'real') S.run = 'stopped';
    S.wb.setReadOnly(false);
    S.ui.setRunning('stopped');
    S.ui.serialLine(failed || S.real.fail ? AR.realFailed : AR.realStopped, failed || S.real.fail ? 'err' : 'sys');
    updateProblems(); updateStages();
    offerTechOnce(!!(failed || S.real.fail));
  }

  /* =====================================================================
     toolbar actions
     ===================================================================== */
  function pickBoard(type) {
    loadProject(newProject(type));
    var f = root.document.querySelector('.sim-run'); // review fix (lab-1-07): keep keyboard focus inside the workspace
    if (f && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
  }
  function changeBoard() {
    if (S.run === 'real') return;
    S.ui.pickBoardDialog().then(function (type) {
      if (!type || type === S.board) return;
      S.ui.confirm({ body: S.ui.AR.changeBoard, ok: S.ui.AR.changeOk, cancel: S.ui.AR.no }).then(function (yes) {
        if (!yes) return;
        var p = projectNow(), old = boardOf(p.parts);
        var id = P().newId(type, p.parts.filter(function (q) { return q !== old; }).map(function (q) { return q.id; }));
        p.parts = p.parts.filter(function (q) { return q !== old; });
        p.parts.unshift({ id: id, type: type, x: old ? old.x : 0, y: old ? old.y : 0, rot: 0, props: {} });
        if (old) p.wires = p.wires.filter(function (w) { return w.a.split('.')[0] !== old.id && w.b.split('.')[0] !== old.id; });
        p.board = type;
        p.serial = { baud: type === 'esp32' ? 115200 : 9600, lineEnding: p.serial.lineEnding };
        if (old && p.controls) delete p.controls[old.id];
        loadProject(p);
      });
    });
  }
  function hasWork() {
    if (!S.project) return false;
    var c = S.wb.getCircuit(), code = S.ui.getCode();
    return c.parts.length > 1 || c.wires.length > 0 || (code.trim() !== EMPTY_CODE.trim() && code.trim() !== (S.exampleCode || '').trim());
  }
  function loadExample(id) {
    var ex = NS.Examples.get ? NS.Examples.get(id) : null; if (!ex) return;
    var go = function () { loadProject(ex.project, { exampleId: id }); if (S.ui.setTab && isMobile()) S.ui.setTab('bench'); };
    if (hasWork() && S.exampleId !== id) S.ui.confirm({ body: S.ui.AR.exConfirm, ok: S.ui.AR.exOk, cancel: S.ui.AR.no }).then(function (y) { if (y) go(); });
    else go();
  }
  function clearBench() {
    S.ui.confirm({ body: S.ui.AR.clearConfirm, ok: S.ui.AR.clearOk, cancel: S.ui.AR.no }).then(function (y) { if (y) loadProject(newProject(S.board)); });
  }
  function isMobile() { return root.matchMedia && root.matchMedia('(max-width: 719px)').matches; }
  function exportFile() {
    var p = projectNow(), d = new Date();
    var name = 'beedak-lab-' + S.board + '-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
    var blob = new root.Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    var url = root.URL.createObjectURL(blob), a = root.document.createElement('a');
    a.href = url; a.download = name; a.hidden = true;
    root.document.body.appendChild(a); a.click(); root.document.body.removeChild(a);
    setTimeout(function () { root.URL.revokeObjectURL(url); }, 4000);
    S.ui.toast(AR.saved);
  }
  function importFile(file) {
    if (file.size > 500 * 1024) { S.ui.toast(AR.bigFile); return; }
    var rd = new root.FileReader();
    rd.onload = function () { try { onLoaded(); } catch (e) { S.ui.toast(AR.badFile); } }; // review fix (lab-1-08)
    function onLoaded() {
      var o = null;
      try { o = JSON.parse(String(rd.result)); } catch (e) { o = null; }
      if (!o || typeof o !== 'object' || o.format !== 'beedak-lab' || !Array.isArray(o.parts) || !Array.isArray(o.wires)) { S.ui.toast(AR.badFile); return; }
      for (var i = 0; i < o.parts.length; i++) { var t = o.parts[i] && o.parts[i].type; if (!P().get(t)) { S.ui.toast(fill(AR.unknownPart, { type: String(t).slice(0, 40) })); return; } }
      if (o.parts.length > 120 || o.wires.length > 400) { S.ui.toast(AR.badFile); return; }
      var isObj = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
      if (!o.parts.every(isObj) || !o.wires.every(isObj)) { S.ui.toast(AR.badFile); return; }
      var BAUDS = [9600, 19200, 38400, 57600, 115200]; // same list as the monitor select
      var clean = { format: 'beedak-lab', version: 1, board: String(o.board || ''),
        parts: o.parts.map(function (q) { var r = { id: q.id, type: q.type, rot: +q.rot || 0, props: q.props && typeof q.props === 'object' ? q.props : {} }; if (q.on) r.on = q.on; else { r.x = +q.x || 0; r.y = +q.y || 0; } return r; }),
        wires: o.wires.map(function (w) { var r = { id: w.id, a: w.a, b: w.b, color: w.color }; if (Array.isArray(w.pts)) r.pts = w.pts.slice(0, 50); return r; }),
        controls: o.controls && typeof o.controls === 'object' ? o.controls : {},
        code: typeof o.code === 'string' ? o.code.slice(0, 50000) : EMPTY_CODE,
        serial: { baud: BAUDS.indexOf(+(o.serial && o.serial.baud)) >= 0 ? +o.serial.baud : 9600, lineEnding: ['none', 'nl', 'cr', 'both'].indexOf(o.serial && o.serial.lineEnding) >= 0 ? o.serial.lineEnding : 'nl' } };
      var v = validProject(clean);
      if (!v.ok) { S.ui.toast((v.errors && v.errors[0]) || AR.badFile); return; }
      var b = boardOf(clean.parts); clean.board = b ? b.type : clean.board;
      loadProject(clean);
    }
    rd.onerror = function () { S.ui.toast(AR.badFile); };
    rd.readAsText(file);
  }

  /* =====================================================================
     audio (§10.8)
     ===================================================================== */
  function audioInit() {
    if (S.audio.ctx || !S.sound) return;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try { S.audio.ctx = new AC(); } catch (e) { S.audio.ctx = null; }
  }
  function audioFrame() {
    var a = S.audio; if (!a.ctx) return;
    if (a.ctx.state === 'suspended') { try { a.ctx.resume(); } catch (e) { /* ignore */ } }
    var seen = {};
    Object.keys(S.visuals).forEach(function (id) {
      var v = S.visuals[id];
      if (v && typeof v.on === 'boolean' && v.freq != null) {        // buzzer / piezo
        if (v.on && v.freq > 0) {
          seen[id] = 1;
          var o = a.osc[id];
          if (!o) {
            var osc = a.ctx.createOscillator(), g = a.ctx.createGain();
            osc.type = 'square'; osc.connect(g); g.connect(a.ctx.destination); osc.start();
            o = a.osc[id] = { osc: osc, g: g };
          }
          o.osc.frequency.setValueAtTime(Math.min(20000, v.freq), a.ctx.currentTime);
          o.g.gain.setValueAtTime(0.04 * (v.vol != null ? v.vol : 1), a.ctx.currentTime);
        }
      }
      if (v && typeof v.on === 'boolean' && typeof v.inLed === 'boolean') {   // relay click
        if (a.relay[id] !== undefined && a.relay[id] !== v.on) click();
        a.relay[id] = v.on;
      }
    });
    Object.keys(a.osc).forEach(function (id) { if (!seen[id]) { try { a.osc[id].osc.stop(); a.osc[id].osc.disconnect(); } catch (e) { /* stopped */ } delete a.osc[id]; } });
  }
  function click() {
    var ctx = S.audio.ctx; if (!ctx) return;
    try {
      var n = Math.floor(ctx.sampleRate * 0.004), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
      var src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    } catch (e) { /* no sound */ }
  }
  function audioStop() {
    var a = S.audio;
    Object.keys(a.osc).forEach(function (id) { try { a.osc[id].osc.stop(); a.osc[id].osc.disconnect(); } catch (e) { /* stopped */ } delete a.osc[id]; });
    a.relay = {};
  }

  /* =====================================================================
     WhatsApp notes form (ported from the retired lab.js)
     ===================================================================== */
  function labSummary() {
    var c = S.wb ? S.wb.getCircuit() : { parts: [] }, counts = {}, order = [];
    c.parts.forEach(function (q) { var d = P().get(q.type); if (!d || d.kind === 'board') return; var n = d.name_ar; if (!counts[n]) { counts[n] = 0; order.push(n); } counts[n]++; });
    var parts = order.map(function (n) { return counts[n] > 1 ? n + ' ×' + counts[n] : n; }).join('، ') || AR.sumNone;
    var s1 = stage1State(); s1 = AR.s1[s1 === 'changed' ? 'idle' : s1] || AR.s1.idle;
    var code = S.ui ? S.ui.getCode().trim() : '';
    if (code.length > 600) code = code.slice(0, 600) + '\n…';
    var hw = S.real.conn && S.real.info ? ((S.real.info.board && NS.IO.Real.BOARDS[S.real.info.board] ? NS.IO.Real.BOARDS[S.real.info.board].name : '') || S.real.conn.info.name) : AR.sumNotConn;
    return AR.sumTitle + '\n' + AR.sumBoard + (S.board ? (S.ui.AR.boardNames[S.board] || S.board) : '-') + '\n' + AR.sumParts + parts + '\n' +
      AR.sumS1 + s1 + '\n' + AR.sumHw + hw + (code ? '\n' + AR.sumCode + '\n' + code : '');
  }
  /* paid technical session (batch 1, problem 2): board, parts, stage-1 result, latest error/warning codes and the code length.
     The code itself stays out of this message (the notes form below can carry it). */
  function waNumber() { return String(root.BOOKING_NUMBER || WA_NUMBER).replace(/[^0-9]/g, '') || WA_NUMBER; }
  function techMsg() {
    var c = S.wb ? S.wb.getCircuit() : { parts: [] }, counts = {}, order = [];
    c.parts.forEach(function (q) { var d = P().get(q.type); if (!d || d.kind === 'board') return; var n = d.name_ar; if (!counts[n]) { counts[n] = 0; order.push(n); } counts[n]++; });
    var parts = order.map(function (n) { return counts[n] > 1 ? n + ' ×' + counts[n] : n; }).join('، ') || AR.sumNone;
    var s1 = stage1State(); s1 = AR.s1[s1 === 'changed' ? 'idle' : s1] || AR.s1.idle;
    var seen = {}, codes = [];
    problems().forEach(function (m) { if ((m.sev === 'error' || m.sev === 'warn') && !seen[m.code] && codes.length < 6) { seen[m.code] = 1; codes.push(m.code); } });
    var code = S.ui ? S.ui.getCode() : '', lines = code.trim() ? code.replace(/\s+$/, '').split('\n').length : 0;
    return AR.techMsg + '\n\n' + AR.sumTitle + '\n' + AR.sumBoard + (S.board ? (S.ui.AR.boardNames[S.board] || S.board) : '-') + '\n' +
      AR.sumParts + parts + '\n' + AR.sumS1 + s1 + '\n' +
      AR.sumProbs + (codes.length ? '⁦' + codes.join('، ') + '⁩' : AR.sumNoProbs) + '\n' +
      fill(AR.sumLen, { lines: lines, chars: code.trim().length });
  }
  function techHref() { return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(techMsg()); }
  function openTech() {
    var doc = root.document, a = doc.createElement('a');
    a.href = techHref(); a.target = '_blank'; a.rel = 'noopener'; a.hidden = true;
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
  }
  /* once per visit, right after the first failed run: a toast that offers the session (it goes away by itself) */
  function offerTechOnce(failed) {
    if (!failed || S.techOffered || !S.ui) return;
    S.techOffered = true;
    S.ui.toast(AR.techToast, { label: AR.techToastBtn, fn: openTech });
  }
  function initForm() {
    var doc = root.document, more = doc.getElementById('lab-more'), text = doc.getElementById('more-text'), sum = doc.getElementById('more-sum');
    root.__labSummary = labSummary;
    if (sum && sum.parentNode) sum.parentNode.hidden = false;
    if (!more) return;
    more.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = text ? text.value.trim() : '';
      var msg = 'من المعمل\nتفاصيل تانية: ' + (note || '-');
      if (!sum || sum.checked) msg += '\n\n' + labSummary();
      var a = doc.createElement('a');
      a.href = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(msg);
      a.target = '_blank'; a.rel = 'noopener'; a.hidden = true;
      doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
    });
  }

  /* =====================================================================
     API for panels.js
     ===================================================================== */
  var API = {
    pickBoard: pickBoard, changeBoard: changeBoard, loadExample: loadExample,
    run: run, stop: stop, reset: reset,
    setSpeed: function (v) { S.speed = v > 0 ? v : 1; },
    setSound: function (on) { S.sound = !!on; S.ui.setSound(S.sound); store(false, { k: SOUND_KEY, v: on ? 'on' : 'off' }); if (!on) audioStop(); else audioInit(); },
    exportFile: exportFile, importFile: importFile, clearBench: clearBench,
    addPart: function (type) {
      if (S.run === 'real') return;
      S.adding = true;                                   // stay in the catalog: visitors often add several parts in a row
      var id; try { id = S.wb.addPart(type); } finally { S.adding = false; }
      if (id && isMobile()) S.ui.setTab('bench');
      return id;
    },
    selectWire: function (id) { S.wb.select({ kind: 'wire', id: id }); onSelect({ kind: 'wire', id: id }); },
    selectPart: function (id) { S.wb.select({ kind: 'part', id: id }); onSelect({ kind: 'part', id: id }); },
    rotateSelected: function () { S.wb.rotateSelected(); },
    removeSelected: function () { S.wb.removeSelected(); },
    repair: function (id) { S.io.repair(id); if (S.run !== 'sim') refreshStopped(); renderInspector(); },
    setProps: function (id, props) { S.wb.setProps(id, props); },
    control: control,
    wireColour: function (id, c) { S.wb.setWireColor(id, c); },
    startWire: function (ref) { if (S.wb.startWire(ref)) renderInspector(); },
    finishWire: function (ref) { S.wb.finishWire(ref); renderInspector(); },
    cancelWire: function () { S.wb.cancelWire(); renderInspector(); },
    open3d: function (type, opener) { if (NS.View3D) NS.View3D.open(type, opener); },
    codeChanged: function (code) {
      if (S.project) S.project.code = code;
      S.gate.codeChanged();
      if (S.compileFailN) { S.compileFailN = 0; }
      S.ui.showRestore(!!S.exampleCode && code !== S.exampleCode);
      updateStages(); scheduleSave();
    },
    restoreExampleCode: function () { if (S.exampleCode != null) { S.ui.setCode(S.exampleCode); API.codeChanged(S.exampleCode); } },
    problemClick: function (m) {
      if (m.line) { S.ui.focusLine(m.line); return; }
      var r = (m.refs || [])[0]; if (!r) return;
      var id = r.split('.')[0];
      if (S.wb.getCircuit().parts.some(function (q) { return q.id === id; })) API.selectPart(id);
    },
    setMonitorBaud: function (b) { S.monitorBaud = b; S.ui.baudHint(S.serialBaud && S.serialBaud !== b ? fill(AR.baudHint, { m: b, b: S.serialBaud }) : ''); scheduleSave(); },
    setLineEnding: function () { scheduleSave(); },
    serialSend: serialSend,
    connect: connect, runReal: runReal, stopReal: function () { stopReal(false); },
    techHref: techHref,
    benchShown: function () { if (S.wb) setTimeout(function () { S.wb.fit(); }, 0); }
  };

  /* =====================================================================
     exports
     ===================================================================== */
  NS.App = {
    init: init,
    /** test-only snapshot (§6.5 debug hook); no UI uses it */
    debug: function () {
      var c = S.wb ? S.wb.getCircuit() : { parts: [], wires: [] };
      var s1 = stage1State();
      var s2 = S.run === 'real' ? 'running' : (NS.IO && NS.IO.Real && S.gate ? realCheck().reason : 'locked');
      return { now: S.run === 'real' ? 0 : (S.runner ? S.runner.now() : S.now), run: S.run, board: S.board, speed: S.speed,
        stage1: s1 === 'changed' ? 'idle' : s1, stage2: s2, visuals: deep(S.visuals), conds: deep(S.conds), events: deep(S.events),
        parts: c.parts, wires: c.wires, serial: S.ui ? S.ui.serialText() : '', sel: S.sel, passPins: S.passPins };
    }
  };
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
