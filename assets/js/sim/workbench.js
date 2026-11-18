/* بإيدك lab simulator: workbench.js (B3, lab-sim-spec.md §6.5, §2.1, §2.2, §10.3, §10.6, §10.7).
   The 2D top-down bench: SVG with pan / zoom, drag parts, rotate, snap legs into breadboard holes,
   click-click wiring with bend points and colours, one-thing-per-hole realism, selection, hover net
   highlight + probe tooltip, problem marks, undo / redo, keyboard moves, touch pin picking.
   Geometry comes from NS.Parts (at call time), bodies from NS.Art. The bench never knows about the
   electrical solution: sim-main feeds it visuals (setVisuals), marks (setMarks), nets and probes.
   DOM-only module, but the pure helpers (Workbench._pure) are Node-testable: nothing touches the DOM
   at load time. */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- copy (verbatim from §10.7 / §2.2; new strings marked NEW COPY) ---------- */
  var AR = {
    benchLabel: 'طاولة التوصيل',
    emptyHint: 'الطاولة عليها الكارت بس. زوّدوا قطعة من «القطع»، وبعدين وصّلوها.',
    wireHintFine: 'علشان تعملوا سلك: دوسوا على طرف أو خُرم، وبعدين على الطرف التاني. دوسة في مكان فاضي بتعمل تنية في السلك، وEsc بيلغي.',
    wireHintTouch: 'دوسوا على طرف، وبعدين على الطرف التاني. بصباعين تكبّروا وتصغّروا.',
    snapped: 'اتركّبت في البريدبورد.',
    holeBusy: 'الخُرم ده مشغول. استخدموا خُرم تاني في نفس العمود، كلهم متوصلين ببعض.',
    pinBusy: 'الطرف ده عليه سلك خلاص. وصّلوا السلك في البريدبورد وخدوا منه.',
    zoomIn: 'كبّروا', zoomOut: 'صغّروا', fit: 'اعرضوا كل حاجة',
    removed: 'اتشالت.', undoRemove: 'رجّعوها',
    volt: 'فولت', modeOut: 'خرج', modeIn: 'دخل', modePullup: 'دخل بـpull-up', modeFloat: 'عايم',
    modePulldown: 'دخل بـpull-down',                       // NEW COPY
    wireColour: 'لون السلك',
    colours: { auto: 'تلقائي' /* NEW COPY */, red: 'أحمر', black: 'أسود', blue: 'أزرق', green: 'أخضر', yellow: 'أصفر', orange: 'برتقاني', white: 'أبيض', violet: 'بنفسجي' },
    undo: 'ارجعوا خطوة',                                   // NEW COPY
    redo: 'قدّموا خطوة',                                    // NEW COPY
    pickPin: 'اختاروا الطرف:',                              // NEW COPY (touch popover title)
    wireStarted: 'السلك بدأ من {a}. دوسوا على الطرف التاني.', // NEW COPY (screen-reader status)
    wireMade: 'اتعمل سلك من {a} لـ{b}.',                    // NEW COPY
    wireCancelled: 'السلك اتلغى.',                          // NEW COPY
    burnt: 'اتحرقت',                                        // NEW COPY (appended to a burnt part's aria-label)
    readOnly: 'الطاولة للعرض بس دلوقتي، علشان الكود شغال على جهازكم.' // NEW COPY
  };
  var WIRE_COLOURS = { red: '#e5484d', black: '#23262c', blue: '#3b82f6', green: '#22c55e', yellow: '#facc15', orange: '#fb923c', white: '#eef2f6', violet: '#a78bfa' };
  var COLOUR_ORDER = ['auto', 'red', 'black', 'blue', 'green', 'yellow', 'orange', 'white', 'violet'];
  var S_MIN = 2, S_MAX = 60, S_DEFAULT = 12;      // pixels per u
  var HISTORY_MAX = 50;

  /* =====================================================================
     Pure helpers (Node-testable)
     ===================================================================== */
  /** Rotate a pin offset clockwise by rot (§2.1): 90° → (-dy, dx). */
  function rotPt(dx, dy, rot) {
    var r = ((rot || 0) % 360 + 360) % 360;
    if (r === 90) return { x: -dy, y: dx };
    if (r === 180) return { x: -dx, y: -dy };
    if (r === 270) return { x: dy, y: -dx };
    return { x: dx, y: dy };
  }
  /** Loose plug parts sit on half-u positions so their legs are never on a hole centre (≥ 0.7 u away). */
  function halfOff(v) { return Math.floor(v) + 0.5; }
  function round2(v) { return Math.round(v * 2) / 2; }
  function instOf(ref) { var i = ref.indexOf('.'); return i < 0 ? ref : ref.slice(0, i); }
  function pinOf(ref) { var i = ref.indexOf('.'); return i < 0 ? '' : ref.slice(i + 1); }

  /** Undo / redo stack of serialized states. */
  function History(limit) { this.limit = limit || HISTORY_MAX; this.past = []; this.future = []; }
  History.prototype.push = function (state) { this.past.push(state); if (this.past.length > this.limit) this.past.shift(); this.future.length = 0; };
  History.prototype.undo = function (current) { if (!this.past.length) return null; this.future.push(current); return this.past.pop(); };
  History.prototype.redo = function (current) { if (!this.future.length) return null; this.past.push(current); return this.future.pop(); };
  History.prototype.clear = function () { this.past.length = 0; this.future.length = 0; };

  /**
   * Occupancy map (§2.2 one thing per hole / socket): ref -> 'wire' | 'leg'.
   * plugMap: instId -> { bb, holes: { pinId: holeId } } for plugged parts.
   * A plugged leg occupies its hole and the leg itself can't take a wire end.
   */
  function occupancy(wires, plugMap, exceptWireId) {
    var occ = {};
    for (var id in plugMap) {
      var p = plugMap[id]; if (!p) continue;
      for (var pin in p.holes) { occ[p.bb + '.' + p.holes[pin]] = 'leg'; occ[id + '.' + pin] = 'leg'; }
    }
    for (var i = 0; i < wires.length; i++) {
      var w = wires[i]; if (w.id === exceptWireId) continue;
      occ[w.a] = occ[w.a] || 'wire'; occ[w.b] = occ[w.b] || 'wire';
    }
    return occ;
  }
  /**
   * Default wire colour (§12 convention: supply → red, GND → black, signals → green) unless the
   * visitor picked a colour. a / b = { role, label, id } of the two ends (breadboard rail holes carry
   * the rail in their id: tp / bp = +, tn / bn = −).
   */
  function autoColour(a, b, picked) {
    if (picked && picked !== 'auto') return picked;
    function isGnd(p) { return !!p && (p.role === 'gnd' || /^GND/i.test(p.label || '') || /^(tn|bn)\d+$/.test(p.id || '')); }
    function isPwr(p) { return !!p && (p.role === 'power' || /^(5V|3V3|3\.3V|VIN|VCC|\+)$/i.test(p.label || p.id || '') || /^(tp|bp)\d+$/.test(p.id || '')); }
    if (isGnd(a) || isGnd(b)) return 'black';
    if (isPwr(a) || isPwr(b)) return 'red';
    return 'green';
  }
  /**
   * Touch pin picking (§6.5): candidates within rPick px of (x, y); the list is ambiguous when 2+ of them
   * are within rAmb px of the nearest one. points: [{ ref, x, y }] in screen px.
   */
  function pickCandidates(points, x, y, rPick, rAmb) {
    var c = [];
    for (var i = 0; i < points.length; i++) {
      var dx = points[i].x - x, dy = points[i].y - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= rPick) c.push({ ref: points[i].ref, x: points[i].x, y: points[i].y, d: d });
    }
    c.sort(function (a, b) { return a.d - b.d; });
    if (!c.length) return { best: null, list: [] };
    var n = c[0], near = c.filter(function (q) { var ex = q.x - n.x, ey = q.y - n.y; return Math.sqrt(ex * ex + ey * ey) <= rAmb; });
    return { best: n.ref, list: near.length > 1 ? near.slice(0, 6).map(function (q) { return q.ref; }) : [n.ref] };
  }
  /** Polyline path through the points (world u). */
  function pathD(pts) {
    var s = '';
    for (var i = 0; i < pts.length; i++) s += (i ? ' L' : 'M') + (+pts[i].x).toFixed(3) + ' ' + (+pts[i].y).toFixed(3);
    return s;
  }
  /** Index of the wire segment closest to point p (for inserting a bend point). */
  function nearestSegment(pts, p) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
      var t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
      var qx = a.x + t * vx - p.x, qy = a.y + t * vy - p.y, d = qx * qx + qy * qy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* =====================================================================
     DOM helpers
     ===================================================================== */
  function sv(tag, attrs, parent) {
    var n = root.document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, attrs, parent, text) {
    var n = root.document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmt(s, vars) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; }); }
  function closestData(node, stop, test) {
    while (node && node !== stop) { if (node.nodeType === 1 && test(node)) return node; node = node.parentNode; }
    return null;
  }
  var ICON = {
    plus: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    fit: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    undo: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    redo: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>'
  };

  /* =====================================================================
     mount()
     ===================================================================== */
  function mount(container, opts) {
    opts = opts || {};
    var ar = {}, k;
    for (k in AR) ar[k] = AR[k];
    if (opts.ar) for (k in opts.ar) ar[k] = opts.ar[k];
    var Parts = function () { return NS.Parts; };
    var Art = function () { return NS.Art || {}; };
    var doc = root.document;

    /* ---------- state ---------- */
    var parts = [], byId = {}, wires = [], wById = {}, plug = {};
    var els = {}, pinEl = {}, wireEls = {};
    var view = { tx: 24, ty: 24, s: S_DEFAULT };
    var sel = null, pending = null, ro = false;
    var hist = new History(HISTORY_MAX);
    var visuals = {}, pinState = {}, marks = [], ctl = {};
    var colour = 'auto', needFit = false, destroyed = false;
    var pinIdx = {};       // type -> { pinId: pin def }
    var uid = 'wb' + Math.floor(Math.random() * 1e9).toString(36);

    /* ---------- DOM skeleton ---------- */
    var rootEl = h('div', { 'class': 'wb' }, container);
    var bar = h('div', { 'class': 'wb-bar' }, rootEl);
    var zoomG = h('div', { 'class': 'wb-group', role: 'group' }, bar);
    var bOut = h('button', { type: 'button', 'class': 'wb-btn', 'aria-label': ar.zoomOut, title: ar.zoomOut }, zoomG); bOut.innerHTML = ICON.minus;
    var bIn = h('button', { type: 'button', 'class': 'wb-btn', 'aria-label': ar.zoomIn, title: ar.zoomIn }, zoomG); bIn.innerHTML = ICON.plus;
    var bFit = h('button', { type: 'button', 'class': 'wb-btn wb-btn-wide', title: ar.fit, 'aria-label': ar.fit }, zoomG); bFit.innerHTML = ICON.fit;
    h('span', null, bFit, ar.fit);
    var histG = h('div', { 'class': 'wb-group', role: 'group' }, bar);
    var bUndo = h('button', { type: 'button', 'class': 'wb-btn', 'aria-label': ar.undo, title: ar.undo }, histG); bUndo.innerHTML = ICON.undo;
    var bRedo = h('button', { type: 'button', 'class': 'wb-btn', 'aria-label': ar.redo, title: ar.redo }, histG); bRedo.innerHTML = ICON.redo;
    var colG = h('div', { 'class': 'wb-colours', role: 'radiogroup', 'aria-label': ar.wireColour }, bar);
    h('span', { 'class': 'wb-colours-l', 'aria-hidden': 'true' }, colG, ar.wireColour);
    var swatches = {};
    COLOUR_ORDER.forEach(function (c) {
      var b = h('button', { type: 'button', role: 'radio', 'class': 'wb-sw wb-sw-' + c, 'data-colour': c, 'aria-checked': c === colour ? 'true' : 'false', 'aria-label': ar.colours[c], title: ar.colours[c] }, colG);
      h('span', { 'class': 'wb-sw-dot', 'aria-hidden': 'true', style: c === 'auto' ? null : 'background:' + WIRE_COLOURS[c] }, b, c === 'auto' ? 'A' : null);
      swatches[c] = b;
    });

    var stage = h('div', { 'class': 'wb-stage', dir: 'ltr' }, rootEl);
    var svg = sv('svg', { 'class': 'wb-svg', role: 'application', 'aria-label': ar.benchLabel, tabindex: '0', focusable: 'true' }, stage);
    var defs = sv('defs', null, svg);
    var pat = sv('pattern', { id: uid + '-grid', width: 1, height: 1, patternUnits: 'userSpaceOnUse' }, defs);
    sv('circle', { cx: 0.5, cy: 0.5, r: 0.06, 'class': 'wb-grid-dot' }, pat);
    sv('rect', { 'class': 'wb-grid', x: 0, y: 0, width: '100%', height: '100%', fill: 'url(#' + uid + '-grid)' }, svg);
    var world = sv('g', { 'class': 'wb-world' }, svg);
    var layerBB = sv('g', { 'class': 'wb-layer-bb' }, world);
    var layerParts = sv('g', { 'class': 'wb-layer-parts' }, world);
    var layerWires = sv('g', { 'class': 'wb-layer-wires' }, world);
    var layerMarks = sv('g', { 'class': 'wb-layer-marks' }, world);
    var ghost = sv('path', { 'class': 'wb-ghost', d: '' }, world);
    var emptyHint = h('p', { 'class': 'wb-empty', dir: 'rtl' }, stage, ar.emptyHint);
    var tip = h('div', { 'class': 'wb-tip', dir: 'rtl', hidden: '' }, stage);
    var pop = h('div', { 'class': 'wb-pop', dir: 'rtl', hidden: '', role: 'dialog', 'aria-label': ar.pickPin }, stage);
    var hint = h('p', { 'class': 'wb-hint' }, rootEl);
    var toastEl = h('div', { 'class': 'wb-toast', dir: 'rtl', role: 'status', 'aria-live': 'polite' }, stage);
    var srEl = h('p', { 'class': 'sr-only', 'aria-live': 'polite' }, rootEl);

    var coarse = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
    hint.textContent = coarse ? ar.wireHintTouch : ar.wireHintFine;

    /* ---------- geometry ---------- */
    function def(type) { var P = Parts(); return P ? P.get(type) : null; }
    function idx(type) {
      if (pinIdx[type]) return pinIdx[type];
      var d = def(type), m = {}; if (d) d.pins.forEach(function (p) { m[p.id] = p; });
      return (pinIdx[type] = m);
    }
    /** World position of a pinRef (same math as Parts.pinWorld, cached per type). */
    function pinPos(ref) {
      var inst = byId[instOf(ref)]; if (!inst) return null;
      var p = idx(inst.type)[pinOf(ref)]; if (!p) return null;
      var q = rotPt(p.x, p.y, inst.rot);
      return { x: inst.x + q.x, y: inst.y + q.y };
    }
    function pinDef(ref) { var inst = byId[instOf(ref)]; return inst ? idx(inst.type)[pinOf(ref)] || null : null; }
    function kindOf(inst) { var d = def(inst.type); return d ? d.kind : 'part'; }
    function isPlug(inst) { var d = def(inst.type); return !!(d && d.plug); }
    function instBox(inst) {
      var P = Parts(); if (P && P.bbox) return P.bbox(inst);
      var d = def(inst.type), b = d.bbox, a = rotPt(b.x, b.y, inst.rot), c = rotPt(b.x + b.w, b.y + b.h, inst.rot);
      return { x: inst.x + Math.min(a.x, c.x), y: inst.y + Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
    }
    function bbs() { return parts.filter(function (p) { return kindOf(p) === 'breadboard'; }); }
    /** Is every leg of a plug part exactly on a hole of one breadboard? (used on load / undo) */
    function detectPlug(inst) {
      if (!isPlug(inst)) return null;
      var P = Parts(), list = bbs(), pins = def(inst.type).pins;
      for (var i = 0; i < list.length; i++) {
        var holes = {}, ok = true;
        for (var j = 0; j < pins.length && ok; j++) {
          var w = pinPos(inst.id + '.' + pins[j].id), hole = P.holeAt(list[i], w.x, w.y, 0.05);
          if (hole) holes[pins[j].id] = hole; else ok = false;
        }
        if (ok) return { bb: list[i].id, holes: holes };
      }
      return null;
    }
    function screenToWorld(cx, cy) {
      var r = svg.getBoundingClientRect();
      return { x: (cx - r.left - view.tx) / view.s, y: (cy - r.top - view.ty) / view.s };
    }
    function worldToScreen(x, y) {
      var r = svg.getBoundingClientRect();
      return { x: r.left + view.tx + x * view.s, y: r.top + view.ty + y * view.s };
    }
    function applyView() {
      var t = 'translate(' + view.tx.toFixed(2) + ' ' + view.ty.toFixed(2) + ') scale(' + view.s.toFixed(4) + ')';
      world.setAttribute('transform', t); pat.setAttribute('patternTransform', t);
      rootEl.setAttribute('data-zoom', view.s < 6 ? 'far' : view.s > 24 ? 'near' : 'mid');
    }

    /* ---------- rendering ---------- */
    var PIN_STYLE = { hole: [0.56, 0.38], sock: [0.6, 0.34], hdr: [0.5, 0.42], leg: [0.42, 0.5] };
    function pinStyle(inst, p) {
      var kd = kindOf(inst);
      if (kd === 'breadboard') return 'hole';
      if (kd === 'board' && !isPlug(inst)) return 'sock';
      return isPlug(inst) ? 'leg' : 'hdr';
    }
    function renderPart(inst) {
      var d = def(inst.type) || { pins: [], bbox: { x: -1, y: -1, w: 2, h: 2 }, name_ar: inst.type };
      var g = sv('g', { 'class': 'wb-part', 'data-id': inst.id, 'data-type': inst.type, 'data-plugged': '', tabindex: '0', role: 'button',
        'aria-label': (d.name_ar || inst.type) + ' ' + inst.id, 'aria-selected': 'false' });
      var A = Art(), art = A[inst.type] || A.fallback, body;
      try { body = art ? art.draw(inst, d) : sv('g'); } catch (e) { body = A.fallback ? A.fallback.draw(inst, d) : sv('g'); }
      body.setAttribute('class', (body.getAttribute('class') || '') + ' wb-body');
      g.appendChild(body);
      var pg = sv('g', { 'class': 'wb-pins' }, g), pins = {};
      d.pins.forEach(function (p) {
        var st = pinStyle(inst, p), z = PIN_STYLE[st];
        var r = sv('rect', { 'class': 'wb-pin wb-pin-' + st, 'data-ref': inst.id + '.' + p.id, x: p.x - z[0] / 2, y: p.y - z[0] / 2, width: z[0], height: z[0],
          rx: st === 'leg' ? z[0] / 2 : 0.06, 'stroke-width': z[1] }, pg);
        pins[p.id] = r; pinEl[inst.id + '.' + p.id] = r;
      });
      (kindOf(inst) === 'breadboard' ? layerBB : layerParts).appendChild(g);
      els[inst.id] = { g: g, body: body, pins: pins, def: d, burnt: null, selBox: null };
      placePart(inst);
      if (visuals[inst.id]) applyVisual(inst.id, visuals[inst.id]);
    }
    function unrenderPart(id) {
      var e = els[id]; if (!e) return;
      for (var p in e.pins) delete pinEl[id + '.' + p];
      if (e.g.parentNode) e.g.parentNode.removeChild(e.g);
      delete els[id];
    }
    function placePart(inst) {
      var e = els[inst.id]; if (!e) return;
      e.g.setAttribute('transform', 'translate(' + (+inst.x).toFixed(3) + ' ' + (+inst.y).toFixed(3) + ') rotate(' + (inst.rot || 0) + ')');
      var p = plug[inst.id];
      e.g.setAttribute('data-plugged', p ? p.bb : '');
      for (var pid in e.pins) e.pins[pid].classList.toggle('wb-pin-plugged', !!p);
    }
    function wirePts(w) {
      var a = pinPos(w.a), b = pinPos(w.b); if (!a || !b) return null;
      var pts = [a];
      (w.pts || []).forEach(function (q) { pts.push({ x: q[0], y: q[1] }); });
      pts.push(b); return pts;
    }
    function renderWire(w) {
      var g = sv('g', { 'class': 'wb-wire-g', 'data-wire': w.id });
      var hit = sv('path', { 'class': 'wb-wire-hit' }, g);
      var out = sv('path', { 'class': 'wb-wire-out' + (w.color === 'black' ? ' wb-wire-out-light' : '') }, g);
      var path = sv('path', { 'class': 'wb-wire', 'data-id': w.id, 'data-a': w.a, 'data-b': w.b, stroke: WIRE_COLOURS[w.color] || WIRE_COLOURS.green }, g);
      var e1 = sv('circle', { 'class': 'wb-wire-end', r: 0.32 }, g), e2 = sv('circle', { 'class': 'wb-wire-end', r: 0.32 }, g);
      var bends = sv('g', { 'class': 'wb-bends' }, g);
      layerWires.appendChild(g);
      wireEls[w.id] = { g: g, hit: hit, out: out, path: path, e1: e1, e2: e2, bends: bends };
      placeWire(w);
      if (sel && sel.kind === 'wire' && sel.id === w.id) g.classList.add('wb-sel');
    }
    function placeWire(w) {
      var e = wireEls[w.id]; if (!e) return;
      var pts = wirePts(w); if (!pts) return;
      var d = pathD(pts);
      e.hit.setAttribute('d', d); e.out.setAttribute('d', d); e.path.setAttribute('d', d);
      e.e1.setAttribute('cx', pts[0].x); e.e1.setAttribute('cy', pts[0].y);
      e.e2.setAttribute('cx', pts[pts.length - 1].x); e.e2.setAttribute('cy', pts[pts.length - 1].y);
      while (e.bends.firstChild) e.bends.removeChild(e.bends.firstChild);
      if (sel && sel.kind === 'wire' && sel.id === w.id && !ro) {
        (w.pts || []).forEach(function (q, i) { sv('circle', { 'class': 'wb-bend', 'data-bend': i, cx: q[0], cy: q[1], r: 0.45 }, e.bends); });
      }
    }
    function unrenderWire(id) { var e = wireEls[id]; if (e && e.g.parentNode) e.g.parentNode.removeChild(e.g); delete wireEls[id]; }
    function wiresOf(ids) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      return wires.filter(function (w) { return set[instOf(w.a)] || set[instOf(w.b)]; });
    }
    function renderAll() {
      [layerBB, layerParts, layerWires, layerMarks].forEach(function (l) { while (l.firstChild) l.removeChild(l.firstChild); });
      els = {}; pinEl = {}; wireEls = {}; pinState = {};
      parts.forEach(renderPart);
      wires.forEach(renderWire);
      drawMarks(); refreshSelection(); updateEmpty();
    }
    function updateEmpty() {
      var onlyBoard = parts.every(function (p) { return kindOf(p) === 'board'; });
      emptyHint.hidden = !onlyBoard;
    }

    /* ---------- state helpers ---------- */
    function snapshot() { return JSON.stringify({ parts: parts, wires: wires }); }
    function restore(str) {
      var o = JSON.parse(str);
      setState(o.parts, o.wires);
      if (sel && !(sel.kind === 'part' ? byId[sel.id] : wById[sel.id])) setSel(null);
      renderAll();
    }
    function setState(ps, ws) {
      parts = ps; byId = {}; parts.forEach(function (p) { byId[p.id] = p; });
      wires = ws; wById = {}; wires.forEach(function (w) { wById[w.id] = w; });
      plug = {}; parts.forEach(function (p) { plug[p.id] = detectPlug(p); });
    }
    function cleanCopy() {
      return {
        parts: parts.map(function (p) {
          var props = {}, k; for (k in (p.props || {})) props[k] = p.props[k];
          return { id: p.id, type: p.type, x: +(+p.x).toFixed(3), y: +(+p.y).toFixed(3), rot: p.rot || 0, props: props };
        }),
        wires: wires.map(function (w) {
          var o = { id: w.id, a: w.a, b: w.b, color: w.color };
          if (w.pts && w.pts.length) o.pts = w.pts.map(function (q) { return [q[0], q[1]]; });
          return o;
        })
      };
    }
    function changed(kind, id, extra) {
      updateEmpty();
      if (typeof opts.onChange === 'function') {
        var ch = { kind: kind, id: id == null ? null : id };
        if (extra) for (var k in extra) ch[k] = extra[k];
        try { opts.onChange(cleanCopy(), ch); } catch (e) { if (root.console) root.console.error(e); }
      }
    }
    function nextWireId() { var n = 1; while (wById['w' + n]) n++; return 'w' + n; }
    function occ(exceptWire) { return occupancy(wires, plug, exceptWire); }

    /* ---------- toasts / status ---------- */
    var toastTimer = 0;
    function toast(msg, undoable) {
      while (toastEl.firstChild) toastEl.removeChild(toastEl.firstChild);
      h('span', null, toastEl, msg);
      if (undoable) {
        var b = h('button', { type: 'button', 'class': 'wb-toast-btn' }, toastEl, ar.undoRemove);
        b.addEventListener('click', function () { api.undo(); hideToast(); });
      }
      toastEl.classList.add('wb-toast-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, undoable ? 6000 : 3200);
    }
    function hideToast() { toastEl.classList.remove('wb-toast-on'); while (toastEl.firstChild) toastEl.removeChild(toastEl.firstChild); }
    function say(msg) { srEl.textContent = ''; setTimeout(function () { srEl.textContent = msg; }, 30); }
    function refLabel(ref) {
      var inst = byId[instOf(ref)], p = pinDef(ref);
      if (inst && kindOf(inst) === 'breadboard') return pinOf(ref);
      return pinOf(ref) + ' · ' + instOf(ref);
    }

    /* ---------- selection ---------- */
    function setSel(s) {
      var same = (!s && !sel) || (s && sel && s.kind === sel.kind && s.id === sel.id);
      sel = s ? { kind: s.kind, id: s.id } : null;
      refreshSelection();
      if (!same && typeof opts.onSelect === 'function') { try { opts.onSelect(sel ? { kind: sel.kind, id: sel.id } : null); } catch (e) { if (root.console) root.console.error(e); } }
    }
    function refreshSelection() {
      var id;
      for (id in els) {
        var e = els[id], on = !!(sel && sel.kind === 'part' && sel.id === id);
        e.g.setAttribute('aria-selected', on ? 'true' : 'false');
        e.g.classList.toggle('wb-sel', on);
        if (on && !e.selBox) {
          var b = e.def.bbox;
          e.selBox = sv('rect', { 'class': 'wb-selbox', x: b.x - 0.35, y: b.y - 0.35, width: b.w + 0.7, height: b.h + 0.7, rx: 0.4 });
          e.g.insertBefore(e.selBox, e.g.firstChild);
        } else if (!on && e.selBox) { e.g.removeChild(e.selBox); e.selBox = null; }
      }
      for (id in wireEls) {
        var on2 = !!(sel && sel.kind === 'wire' && sel.id === id);
        wireEls[id].g.classList.toggle('wb-sel', on2);
        wireEls[id].path.setAttribute('aria-selected', on2 ? 'true' : 'false');
        if (wById[id]) placeWire(wById[id]);
      }
    }

    /* ---------- wiring ---------- */
    function refusal(ref, o) {
      var st = o[ref]; if (!st) return null;
      var inst = byId[instOf(ref)];
      if (st === 'leg' || (inst && kindOf(inst) === 'breadboard')) return ar.holeBusy;
      return ar.pinBusy;
    }
    function startWire(ref) {
      if (ro || !pinPos(ref)) return false;
      var why = refusal(ref, occ());
      if (why) { toast(why); return false; }
      pending = { a: ref, pts: [] };
      rootEl.classList.add('wb-wiring');
      if (pinEl[ref]) pinEl[ref].classList.add('wb-pin-start');
      say(fmt(ar.wireStarted, { a: refLabel(ref) }));
      drawGhost(null);
      return true;
    }
    function cancelWire(silent) {
      if (!pending) return;
      if (pinEl[pending.a]) pinEl[pending.a].classList.remove('wb-pin-start');
      pending = null; rootEl.classList.remove('wb-wiring'); ghost.setAttribute('d', '');
      if (!silent) say(ar.wireCancelled);
    }
    function finishWire(ref) {
      if (!pending || ro) return false;
      if (ref === pending.a) { cancelWire(); return false; }
      if (!pinPos(ref)) return false;
      var why = refusal(ref, occ());
      if (why) { toast(why); return false; }
      hist.push(snapshot());
      var pa = pinDef(pending.a), pb = pinDef(ref);
      var w = { id: nextWireId(), a: pending.a, b: ref, color: autoColour(pa, pb, colour) };
      if (pending.pts.length) w.pts = pending.pts.map(function (q) { return [q[0], q[1]]; });
      var a = pending.a;
      cancelWire(true);
      wires.push(w); wById[w.id] = w; renderWire(w);
      say(fmt(ar.wireMade, { a: refLabel(a), b: refLabel(ref) }));
      changed('wire-add', w.id);
      return true;
    }
    function handleRef(ref) {
      if (ro) return;
      if (pending) finishWire(ref); else startWire(ref);
    }
    function drawGhost(pt) {
      if (!pending) { ghost.setAttribute('d', ''); return; }
      var a = pinPos(pending.a); if (!a) return;
      var pts = [a];
      pending.pts.forEach(function (q) { pts.push({ x: q[0], y: q[1] }); });
      if (pt) pts.push(pt);
      ghost.setAttribute('d', pathD(pts));
    }

    /* ---------- primary controls (operating a part on the bench) ---------- */
    function ctlDef(inst) {
      var d = def(inst.type); if (!d) return null;
      var key = d.primary, cs = d.controls || [];
      if (!key) return null;
      for (var i = 0; i < cs.length; i++) if (cs[i].key === key) return cs[i];
      return null;
    }
    function ctlVal(inst, c) {
      var m = ctl[inst.id] || (ctl[inst.id] = {});
      if (m[c.key] == null) m[c.key] = c.default != null ? c.default : (c.type === 'select' && c.options && c.options[0] ? c.options[0].v : 0);
      return m[c.key];
    }
    function sendPrimary(id, key, value) {
      (ctl[id] || (ctl[id] = {}))[key] = value;
      if (typeof opts.onPrimary === 'function') { try { opts.onPrimary(id, key, value); } catch (e) { if (root.console) root.console.error(e); } }
    }
    /** Click / Enter on a part: toggles, selects, one-shots. Momentary controls are handled as press/release. */
    function primaryClick(inst) {
      var c = ctlDef(inst); if (!c || ro) return;
      if (c.type === 'toggle') sendPrimary(inst.id, c.key, !ctlVal(inst, c));
      else if (c.type === 'button') sendPrimary(inst.id, c.key, true);
      else if (c.type === 'select' && c.options && c.options.length) {
        var cur = ctlVal(inst, c), i = 0;
        for (var j = 0; j < c.options.length; j++) if (String(c.options[j].v) === String(cur)) i = j;
        sendPrimary(inst.id, c.key, c.options[(i + 1) % c.options.length].v);
      } else if (c.type === 'range') {
        var span = (c.max - c.min) || 1, v = +ctlVal(inst, c) + span / 10;
        if (v > c.max + 1e-9) v = c.min;
        sendPrimary(inst.id, c.key, Math.round(v / (c.step || 1)) * (c.step || 1));
      }
    }

    /* ---------- marks (problem badges) ---------- */
    function drawMarks() {
      while (layerMarks.firstChild) layerMarks.removeChild(layerMarks.firstChild);
      marks.forEach(function (m) {
        var target = m.ref || m.instId || m.id, pos = null;
        if (!target) return;
        if (target.indexOf('.') > 0) pos = pinPos(target);
        else if (byId[target]) { var b = instBox(byId[target]); pos = { x: b.x + b.w, y: b.y }; }
        if (!pos) return;
        var sev = m.sev === 'error' ? 'error' : m.sev === 'warn' ? 'warn' : 'hint';
        var g = sv('g', { 'class': 'wb-mark wb-mark-' + sev, 'data-target': target, transform: 'translate(' + pos.x + ' ' + pos.y + ')' }, layerMarks);
        sv('circle', { r: 0.75 }, g);
        var t = sv('text', { y: 0.32, 'text-anchor': 'middle', 'font-size': 0.95 }, g);
        t.textContent = sev === 'error' ? '✕' : sev === 'warn' ? '!' : 'i';
      });
    }

    /* ---------- visuals from the simulation ---------- */
    function isBurnt(v) {
      if (!v) return false;
      if (v.damaged) return true;
      if (v.burnt && typeof v.burnt === 'object') return !!(v.burnt.r || v.burnt.g || v.burnt.b);
      return !!v.burnt;
    }
    function applyVisual(id, v) {
      var e = els[id], inst = byId[id]; if (!e || !inst) return;
      var A = Art(), art = A[inst.type];
      if (art && art.update) { try { art.update(e.body, v, inst); } catch (err) { /* one bad visual must not stop the frame */ } }
      var burnt = isBurnt(v);
      if (burnt && !e.burnt) {
        var b = e.def.bbox, x = b.x + b.w - 0.2, y = b.y + 0.2;
        e.burnt = sv('g', { 'class': 'wb-burnt', transform: 'translate(' + x + ' ' + y + ')' }, e.g);
        sv('path', { 'class': 'wb-smoke', d: 'M-0.6 -0.2 q-0.6 -0.8 0 -1.4 q0.6 -0.6 0.2 -1.4 M0.4 -0.2 q-0.5 -0.7 0.1 -1.2 q0.5 -0.5 0.1 -1.2' }, e.burnt);
        sv('circle', { r: 0.7, cy: 0.4 }, e.burnt);
        var t = sv('text', { y: 0.72, 'text-anchor': 'middle', 'font-size': 0.9 }, e.burnt); t.textContent = '✕';
        e.g.setAttribute('aria-label', (e.def.name_ar || inst.type) + ' ' + id + ' (' + ar.burnt + ')');
      } else if (!burnt && e.burnt) {
        e.g.removeChild(e.burnt); e.burnt = null;
        e.g.setAttribute('aria-label', (e.def.name_ar || inst.type) + ' ' + id);
      }
      // board header pins: show output HIGH / PWM (cheap: only changed pins touch the DOM)
      if (v && v.pins && typeof v.pins === 'object') {
        for (var pid in v.pins) {
          var ps = v.pins[pid], ref = id + '.' + pid, el = pinEl[ref]; if (!el || !ps) continue;
          var st = !v.power ? '' : ps.mode === 1 ? (ps.pwm != null && ps.pwm > 0 && ps.pwm < 1 ? 'pwm' : ps.level ? 'hi' : 'lo') : '';
          if (pinState[ref] === st) continue;
          pinState[ref] = st;
          el.classList.toggle('wb-pin-hi', st === 'hi'); el.classList.toggle('wb-pin-pwm', st === 'pwm');
        }
      }
      // keep the bench's view of primary controls in sync with the simulation
      if (v) {
        if (inst.type === 'switch' && (v.pos === 1 || v.pos === 2)) (ctl[id] || (ctl[id] = {})).pos = v.pos;
        if (inst.type === 'pot' && typeof v.p === 'number') (ctl[id] || (ctl[id] = {})).pos = Math.round(v.p * 100);
      }
    }

    /* ---------- tooltip + net highlight ---------- */
    var hoverRef = null, netLit = [];
    function clearNet() { netLit.forEach(function (el) { el.classList.remove('wb-net'); }); netLit = []; }
    function showTip(ref, cx, cy) {
      var p = pinDef(ref); if (!p) return hideTip();
      while (tip.firstChild) tip.removeChild(tip.firstChild);
      var inst = byId[instOf(ref)], name = kindOf(inst) === 'breadboard' ? pinOf(ref) : (p.label || p.id);
      h('bdi', { dir: 'ltr', 'class': 'wb-tip-pin' }, tip, name + (kindOf(inst) === 'breadboard' ? '' : ' · ' + inst.id));
      var pr = null;
      if (typeof opts.probe === 'function') { try { pr = opts.probe(ref); } catch (e) { pr = null; } }
      if (pr && typeof pr.v === 'number' && isFinite(pr.v) && !pr.floating) {
        h('span', null, tip, ' · ');
        h('bdi', { dir: 'ltr' }, tip, pr.v.toFixed(2));
        h('span', null, tip, ' ' + ar.volt);
      }
      if (pr) {
        var mw = pr.floating ? ar.modeFloat : pr.mode === 1 ? ar.modeOut : pr.mode === 2 ? ar.modePullup : pr.mode === 3 ? ar.modePulldown : pr.mode === 0 ? ar.modeIn : '';
        if (mw) h('span', null, tip, ' · ' + mw);
      } else if (p.ar) {
        h('span', { 'class': 'wb-tip-ar' }, tip, ' · ' + p.ar);
      }
      tip.hidden = false;
      var r = stage.getBoundingClientRect(), tw = tip.offsetWidth || 160, th = tip.offsetHeight || 30;
      var x = Math.min(Math.max(4, cx - r.left + 14), Math.max(4, r.width - tw - 4)), y = cy - r.top + 16;
      if (y + th > r.height - 4) y = cy - r.top - th - 12;
      tip.style.left = x + 'px'; tip.style.top = Math.max(4, y) + 'px';
    }
    function hideTip() { tip.hidden = true; }
    function hoverPin(ref, cx, cy) {
      if (ref === hoverRef) { if (ref) showTip(ref, cx, cy); return; }
      hoverRef = ref; clearNet();
      if (!ref) { hideTip(); return; }
      showTip(ref, cx, cy);
      var net = [ref];
      if (typeof opts.getNet === 'function') { try { net = opts.getNet(ref) || [ref]; } catch (e) { net = [ref]; } }
      net.forEach(function (r2) { var el = pinEl[r2]; if (el) { el.classList.add('wb-net'); netLit.push(el); } });
    }

    /* ---------- touch pin popover ---------- */
    function hidePop() { pop.hidden = true; while (pop.firstChild) pop.removeChild(pop.firstChild); }
    function showPop(list, cx, cy) {
      hidePop();
      h('p', { 'class': 'wb-pop-t' }, pop, ar.pickPin);
      list.forEach(function (ref) {
        var b = h('button', { type: 'button', 'class': 'wb-pop-b', dir: 'ltr' }, pop, refLabel(ref));
        b.addEventListener('click', function () { hidePop(); handleRef(ref); });
      });
      pop.hidden = false;
      var r = stage.getBoundingClientRect(), w = pop.offsetWidth || 180, hh = pop.offsetHeight || 120;
      pop.style.left = Math.max(4, Math.min(cx - r.left - w / 2, r.width - w - 4)) + 'px';
      pop.style.top = Math.max(4, Math.min(cy - r.top + 18, r.height - hh - 4)) + 'px';
      var first = pop.querySelector('button'); if (first) first.focus();
    }
    function touchCandidates(cx, cy) {
      var pts = [], r = svg.getBoundingClientRect();
      parts.forEach(function (inst) {
        var pl = plug[inst.id], d = def(inst.type); if (!d) return;
        d.pins.forEach(function (p) {
          if (pl) return; // plugged legs sit on (occupied) holes; the holes are listed instead
          var q = rotPt(p.x, p.y, inst.rot);
          pts.push({ ref: inst.id + '.' + p.id, x: r.left + view.tx + (inst.x + q.x) * view.s, y: r.top + view.ty + (inst.y + q.y) * view.s });
        });
      });
      return pickCandidates(pts, cx, cy, 24, 8);
    }

    /* ---------- moving parts ---------- */
    function groupIds(inst) {
      var ids = [inst.id];
      if (kindOf(inst) === 'breadboard') for (var id in plug) if (plug[id] && plug[id].bb === inst.id) ids.push(id);
      return ids;
    }
    /** After a move / rotate of a plug part: snap into free holes or lie loose (half-u). */
    function settlePlug(inst) {
      var P = Parts(), others = parts.filter(function (p) { return p.id !== inst.id; });
      plug[inst.id] = null;
      var s = P && P.findSnap ? P.findSnap(inst, others, wires) : null; // 3rd arg: wire ends count as occupied (parts.js extra)
      if (s) {
        var o = occ(), free = true;
        for (var pid in s.holes) if (o[s.bb + '.' + s.holes[pid]]) free = false;
        if (free) { inst.x = +(inst.x + s.dx).toFixed(3); inst.y = +(inst.y + s.dy).toFixed(3); plug[inst.id] = { bb: s.bb, holes: s.holes }; return true; }
      }
      inst.x = halfOff(inst.x); inst.y = halfOff(inst.y);
      return false;
    }
    /** Move a part (and, for a breadboard, everything plugged into it) by (dx, dy) u, then settle. */
    function moveBy(inst, dx, dy, live) {
      var ids = groupIds(inst);
      ids.forEach(function (id) { var p = byId[id]; p.x += dx; p.y += dy; });
      var set = {}; ids.forEach(function (id) { set[id] = 1; });
      if (!live && ids.length > 1) wires.forEach(function (w) {
        if (set[instOf(w.a)] && set[instOf(w.b)] && w.pts) w.pts = w.pts.map(function (q) { return [q[0] + dx, q[1] + dy]; });
      });
      ids.forEach(function (id) { placePart(byId[id]); });
      wiresOf(ids).forEach(placeWire);
    }

    /* ---------- pointer interaction ---------- */
    var ptrs = {}, down = null, drag = null, pinch = null, raf = 0, lastMove = null;
    function ptrCount() { return Object.keys(ptrs).length; }
    function hitInfo(t) {
      var info = { ref: null, act: null, part: null, wire: null, bend: null };
      var n = t;
      while (n && n !== svg) {
        if (n.nodeType === 1) {
          if (info.ref == null && n.getAttribute('data-ref')) info.ref = n.getAttribute('data-ref');
          if (info.bend == null && n.getAttribute('data-bend') != null) info.bend = +n.getAttribute('data-bend');
          if (!info.act && n.classList && n.classList.contains('wb-act')) info.act = n;
          if (!info.wire && n.getAttribute('data-wire')) info.wire = n.getAttribute('data-wire');
          if (!info.part && n.classList && n.classList.contains('wb-part')) info.part = n.getAttribute('data-id');
        }
        n = n.parentNode;
      }
      if (info.ref && pinEl[info.ref] && pinEl[info.ref].classList.contains('wb-pin-plugged')) info.ref = null;
      return info;
    }
    /**
     * Pins win over wires: a jumper lying across a header must not hide the pins under it
     * (real wires can be pushed aside). Part bodies still cover what is under them.
     */
    function hitAt(e) {
      var info = hitInfo(e.target);
      if (!info.wire || info.bend != null || !doc.elementsFromPoint) return info;
      var list = doc.elementsFromPoint(e.clientX, e.clientY);
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n === svg || !svg.contains(n)) break;
        if (closestData(n, svg, function (q) { return q.getAttribute && q.getAttribute('data-wire'); })) continue;
        var i2 = hitInfo(n);
        return i2.ref ? i2 : info;
      }
      return info;
    }
    function onDown(e) {
      if (destroyed) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      hideTip(); if (!pop.contains(e.target)) hidePop();
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ptrCount() === 2) { startPinch(); return; }
      if (ptrCount() > 2) return;
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      var info = hitAt(e);
      down = { pid: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', moved: false, hold: false, timer: 0,
        ref: info.ref, part: info.part, wire: info.wire, bend: info.bend, act: info.act, momentary: false, knob: false };
      var inst = info.part ? byId[info.part] : null;
      if (inst && info.act && !ro) {
        var c = ctlDef(inst);
        if (c && c.type === 'momentary') { down.momentary = c.key; sendPrimary(inst.id, c.key, true); }
        else if (c && c.type === 'range') {
          var r = info.act.getBoundingClientRect();
          down.knob = { key: c.key, cx: r.left + r.width / 2, cy: r.top + r.height / 2, c: c };
        }
      }
      if (inst && down.touch && !info.act) {
        down.timer = setTimeout(function () { if (down && !down.moved) { down.hold = true; setSel({ kind: 'part', id: inst.id }); rootEl.classList.add('wb-holding'); } }, 150);
      }
      if (e.pointerType !== 'mouse') e.preventDefault();
    }
    function onMove(e) {
      if (destroyed) return;
      if (ptrs[e.pointerId]) ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) { updatePinch(); return; }
      if (pending) drawGhost(screenToWorld(e.clientX, e.clientY));
      if (!down) {
        if (e.pointerType === 'mouse') { var info = hitAt(e); hoverPin(info.ref, e.clientX, e.clientY); }
        return;
      }
      if (e.pointerId !== down.pid) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (!down.moved && dist > (down.touch ? 8 : 3)) {
        down.moved = true; clearTimeout(down.timer); hideTip();
        if (down.knob) drag = { type: 'knob' };
        else if (down.bend != null && down.wire && !ro) { hist.push(snapshot()); drag = { type: 'bend', wid: down.wire, i: down.bend }; }
        else if (down.part && !ro && (!down.touch || down.hold)) {
          if (down.momentary) { sendPrimary(down.part, down.momentary, false); down.momentary = false; }
          startPartDrag(byId[down.part]);
        } else {
          if (down.momentary) { sendPrimary(down.part, down.momentary, false); down.momentary = false; }
          drag = { type: 'pan', tx: view.tx, ty: view.ty };
        }
      }
      if (!drag) return;
      lastMove = { x: e.clientX, y: e.clientY };
      if (drag.type === 'pan') { view.tx = drag.tx + dx; view.ty = drag.ty + dy; applyView(); return; }
      if (!raf) raf = (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(frameDrag);
    }
    function frameDrag() {
      raf = 0; if (!drag || !lastMove) return;
      var w = screenToWorld(lastMove.x, lastMove.y);
      if (drag.type === 'part') {
        var inst = byId[drag.id], dx = w.x - drag.w0.x - (inst.x - drag.x0), dy = w.y - drag.w0.y - (inst.y - drag.y0);
        moveBy(inst, dx, dy, true);
      } else if (drag.type === 'bend') {
        var wr = wById[drag.wid]; if (wr && wr.pts && wr.pts[drag.i]) { wr.pts[drag.i] = [round2(w.x), round2(w.y)]; placeWire(wr); }
      } else if (drag.type === 'knob') {
        var c = down && down.knob; if (!c) return;
        var ang = Math.atan2(lastMove.x - c.cx, -(lastMove.y - c.cy)) * 180 / Math.PI; // 0 = up, clockwise +
        var p = Math.max(0, Math.min(1, (ang + 135) / 270));
        var v = c.c.min + p * (c.c.max - c.c.min); v = Math.round(v / (c.c.step || 1)) * (c.c.step || 1);
        if (v !== (ctl[down.part] || {})[c.key]) {
          sendPrimary(down.part, c.key, v);
          var e2 = els[down.part], A = Art(); if (e2 && A.pot && byId[down.part].type === 'pot') A.pot.update(e2.body, { p: p }, byId[down.part]);
        }
      }
    }
    function startPartDrag(inst) {
      drag = { type: 'part', id: inst.id, x0: inst.x, y0: inst.y, w0: screenToWorld(down.x, down.y), snap: snapshot() };
      if (isPlug(inst)) { plug[inst.id] = null; placePart(inst); }
      if (!sel || sel.id !== inst.id) setSel({ kind: 'part', id: inst.id });
      rootEl.classList.add('wb-dragging');
    }
    function finishPartDrag() {
      if (raf) { (root.cancelAnimationFrame || clearTimeout)(raf); raf = 0; frameDrag(); }
      var inst = byId[drag.id]; rootEl.classList.remove('wb-dragging', 'wb-holding');
      if (!inst) return;
      // round the group's move to whole u (boards, breadboards and modules sit on the grid)
      var rx = Math.round(inst.x) - inst.x, ry = Math.round(inst.y) - inst.y;
      var totalX = inst.x + rx - drag.x0, totalY = inst.y + ry - drag.y0;
      // undo the live move, then apply the final one once so bend points of internal wires move too
      moveBy(inst, -(inst.x - drag.x0), -(inst.y - drag.y0), true);
      moveBy(inst, totalX, totalY, false);
      var snapped = false;
      if (isPlug(inst)) { snapped = settlePlug(inst); placePart(inst); wiresOf([inst.id]).forEach(placeWire); }
      if (inst.x !== drag.x0 || inst.y !== drag.y0 || snapped) {
        hist.push(drag.snap);
        if (snapped) toast(ar.snapped);
        drawMarks();
        changed('part-move', inst.id);
      } else if (isPlug(inst)) { plug[inst.id] = detectPlug(inst); placePart(inst); }
    }
    function onUp(e, cancelled) {
      delete ptrs[e.pointerId];
      if (pinch) { if (ptrCount() < 2) pinch = null; down = null; drag = null; return; }
      if (!down || e.pointerId !== down.pid) return;
      clearTimeout(down.timer);
      var d = down; down = null;
      if (d.momentary) sendPrimary(d.part, d.momentary, false);
      if (drag) {
        var dr = drag;
        if (dr.type === 'part') finishPartDrag();
        else if (dr.type === 'bend') { if (raf) { (root.cancelAnimationFrame || clearTimeout)(raf); raf = 0; frameDrag(); } changed('wire-edit', dr.wid); }
        else if (dr.type === 'knob' && raf) { (root.cancelAnimationFrame || clearTimeout)(raf); raf = 0; frameDrag(); }
        drag = null; rootEl.classList.remove('wb-holding');
        return;
      }
      rootEl.classList.remove('wb-holding');
      if (!cancelled && !d.moved) click(d, e);
    }
    function click(d, e) {
      var inst = d.part ? byId[d.part] : null;
      if (d.knob) { if (inst) setSel({ kind: 'part', id: inst.id }); return; }
      if (d.act && inst) {
        setSel({ kind: 'part', id: inst.id });
        var c = ctlDef(inst); if (c && c.type !== 'momentary') primaryClick(inst);
        return;
      }
      if (d.touch) { touchTap(d, e); return; }
      if (d.ref) { handleRef(d.ref); return; }
      if (pending && !ro) { addBend(e); return; }
      if (inst) setSel({ kind: 'part', id: inst.id });
      else if (d.wire) setSel({ kind: 'wire', id: d.wire });
      else setSel(null);
    }
    function addBend(e) {
      var w = screenToWorld(e.clientX, e.clientY);
      pending.pts.push([round2(w.x), round2(w.y)]);
      drawGhost(w);
    }
    function touchTap(d, e) {
      var inst = d.part ? byId[d.part] : null;
      if (inst && !d.ref && !pending && kindOf(inst) === 'part' && !d.hold) { setSel({ kind: 'part', id: inst.id }); return; }
      if (d.hold && inst) return; // long press without moving = select (already done)
      var c = touchCandidates(e.clientX, e.clientY);
      if (!c.best) {
        if (pending && !ro) { addBend(e); return; }
        if (inst) setSel({ kind: 'part', id: inst.id }); else if (d.wire) setSel({ kind: 'wire', id: d.wire }); else setSel(null);
        return;
      }
      if (ro) { if (inst) setSel({ kind: 'part', id: inst.id }); return; }
      if (c.list.length > 1) showPop(c.list, e.clientX, e.clientY); else handleRef(c.best);
    }
    function startPinch() {
      if (down) { clearTimeout(down.timer); if (down.momentary) sendPrimary(down.part, down.momentary, false); }
      if (drag && drag.type === 'part') finishPartDrag();
      down = null; drag = null;
      var ids = Object.keys(ptrs), a = ptrs[ids[0]], b = ptrs[ids[1]];
      var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), s0: view.s, w: screenToWorld(mid.x, mid.y) };
    }
    function updatePinch() {
      var ids = Object.keys(ptrs); if (ids.length < 2) return;
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r = svg.getBoundingClientRect();
      view.s = Math.max(S_MIN, Math.min(S_MAX, pinch.s0 * d / pinch.d0));
      view.tx = mid.x - r.left - pinch.w.x * view.s; view.ty = mid.y - r.top - pinch.w.y * view.s;
      applyView();
    }
    function zoomAt(factor, cx, cy) {
      var r = svg.getBoundingClientRect();
      if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
      var w = screenToWorld(cx, cy);
      view.s = Math.max(S_MIN, Math.min(S_MAX, view.s * factor));
      view.tx = cx - r.left - w.x * view.s; view.ty = cy - r.top - w.y * view.s;
      applyView();
    }
    function onWheel(e) {
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(Math.pow(1.0015, -dy), e.clientX, e.clientY);
    }
    function onLeave() { if (!down) hoverPin(null); }
    function onDbl(e) {
      if (ro) return;
      var info = hitInfo(e.target);
      if (info.wire && wById[info.wire]) {
        var w = wById[info.wire];
        hist.push(snapshot());
        if (info.bend != null) { w.pts.splice(info.bend, 1); if (!w.pts.length) delete w.pts; }
        else {
          var p = screenToWorld(e.clientX, e.clientY), pts = wirePts(w), i = nearestSegment(pts, p);
          w.pts = w.pts || []; w.pts.splice(i, 0, [round2(p.x), round2(p.y)]);
        }
        setSel({ kind: 'wire', id: w.id }); placeWire(w); changed('wire-edit', w.id);
      }
    }

    /* ---------- keyboard ---------- */
    var keyMomentary = null;
    function onKey(e) {
      if (destroyed) return;
      var tg = e.target, tag = tg && tg.tagName ? tg.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (tag === 'button' && (e.key === 'Enter' || e.key === ' '))) return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) api.redo(); else api.undo(); return; }
      if (ctrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); api.redo(); return; }
      if (e.key === 'Escape') {
        if (!pop.hidden) { hidePop(); e.preventDefault(); return; }
        if (pending) { cancelWire(); e.preventDefault(); return; }
        return;
      }
      if (e.key === '+' || e.key === '=') { zoomAt(1.25); e.preventDefault(); return; }
      if (e.key === '-' || e.key === '_') { zoomAt(0.8); e.preventDefault(); return; }
      if (!sel) return;
      if (sel.kind === 'wire') {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); api.removeSelected(); }
        return;
      }
      var inst = byId[sel.id]; if (!inst) return;
      var step = e.shiftKey ? 5 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault(); if (ro) return;
        hist.push(snapshot());
        if (isPlug(inst)) { plug[inst.id] = null; }
        moveBy(inst, mv[0], mv[1], false);
        var snapped = isPlug(inst) ? settlePlug(inst) : false;
        placePart(inst); wiresOf(groupIds(inst)).forEach(placeWire); drawMarks();
        if (snapped) toast(ar.snapped);
        changed('part-move', inst.id);
        return;
      }
      if (e.key === 'r' || e.key === 'R') { if (!ctrl) { e.preventDefault(); api.rotateSelected(); } return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); api.removeSelected(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        var c = ctlDef(inst); if (!c || ro) return;
        e.preventDefault();
        if (c.type === 'momentary') { keyMomentary = { id: inst.id, key: c.key }; sendPrimary(inst.id, c.key, true); }
        else primaryClick(inst);
      }
    }
    function onKeyUp(e) {
      if (keyMomentary && (e.key === 'Enter' || e.key === ' ')) { sendPrimary(keyMomentary.id, keyMomentary.key, false); keyMomentary = null; e.preventDefault(); }
    }
    function onFocusIn(e) {
      var g = closestData(e.target, svg, function (n) { return n.classList && n.classList.contains('wb-part'); });
      var kb = true; try { kb = g ? g.matches(':focus-visible') : false; } catch (x) { kb = true; }
      if (g && kb) { var id = g.getAttribute('data-id'); if (!sel || sel.kind !== 'part' || sel.id !== id) setSel({ kind: 'part', id: id }); }
    }

    /* ---------- bar buttons ---------- */
    bOut.addEventListener('click', function () { api.zoom(-1); });
    bIn.addEventListener('click', function () { api.zoom(1); });
    bFit.addEventListener('click', function () { api.fit(); });
    bUndo.addEventListener('click', function () { api.undo(); });
    bRedo.addEventListener('click', function () { api.redo(); });
    colG.addEventListener('click', function (e) {
      var b = closestData(e.target, colG, function (n) { return n.getAttribute && n.getAttribute('data-colour'); });
      if (!b) return;
      setColour(b.getAttribute('data-colour'));
      if (sel && sel.kind === 'wire' && colour !== 'auto') api.setWireColor(sel.id, colour);
    });
    colG.addEventListener('keydown', function (e) {
      var i = COLOUR_ORDER.indexOf(colour), dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault(); setColour(COLOUR_ORDER[(i + dir + COLOUR_ORDER.length) % COLOUR_ORDER.length]); swatches[colour].focus();
    });
    function setColour(c) {
      colour = c;
      for (var k2 in swatches) { swatches[k2].setAttribute('aria-checked', k2 === c ? 'true' : 'false'); swatches[k2].tabIndex = k2 === c ? 0 : -1; }
    }
    setColour('auto');
    function updHist() { bUndo.disabled = !hist.past.length || ro; bRedo.disabled = !hist.future.length || ro; }

    /* ---------- listeners ---------- */
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', function (e) { onUp(e, false); });
    svg.addEventListener('pointercancel', function (e) { onUp(e, true); });
    svg.addEventListener('pointerleave', onLeave);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', onDbl);
    svg.addEventListener('contextmenu', function (e) { if (down || pending) e.preventDefault(); });
    rootEl.addEventListener('keydown', onKey);
    rootEl.addEventListener('keyup', onKeyUp);
    svg.addEventListener('focusin', onFocusIn);
    var ro_obs = null;
    if (root.ResizeObserver) { ro_obs = new root.ResizeObserver(function () { if (needFit) api.fit(); }); ro_obs.observe(stage); }
    applyView();

    /* =====================================================================
       Public API (§6.5)
       ===================================================================== */
    var api = {
      /** Replace everything. Accepts `on: "bb1:e5"` placements (resolved through Parts.resolvePlacement). */
      load: function (circuit) {
        circuit = circuit || {};
        var ps = (circuit.parts || []).map(function (p) {
          var o = { id: p.id, type: p.type, x: +p.x || 0, y: +p.y || 0, rot: +p.rot || 0, props: {} };
          if (p.on) o.on = p.on;
          for (var k3 in (p.props || {})) o.props[k3] = p.props[k3];
          return o;
        });
        var ws = (circuit.wires || []).map(function (w) {
          var o = { id: w.id, a: w.a, b: w.b, color: WIRE_COLOURS[w.color] ? w.color : 'green' };
          if (w.pts && w.pts.length) o.pts = w.pts.map(function (q) { return [+q[0], +q[1]]; });
          return o;
        });
        if (ps.some(function (p) { return p.on; }) && Parts() && Parts().resolvePlacement) {
          var res = Parts().resolvePlacement({ parts: ps, wires: ws });
          ps = res.parts; ps.forEach(function (p) { delete p.on; });
        }
        cancelWire(true); hidePop(); hideTip();
        visuals = {}; ctl = {}; marks = []; sel = null;
        setState(ps, ws);
        hist.clear(); updHist();
        renderAll();
        api.fit();
      },
      getCircuit: function () { return cleanCopy(); },
      addPart: function (type, props) {
        var P = Parts(), d = def(type); if (ro || !P || !d) return null;
        var id = P.newId(type, parts.map(function (p) { return p.id; }));
        var pr = {}; (d.props || []).forEach(function (q) { if (q.default != null) pr[q.key] = q.default; });
        if (props) for (var k4 in props) pr[k4] = props[k4];
        var r = svg.getBoundingClientRect(), c = screenToWorld(r.left + (r.width || 600) / 2, r.top + (r.height || 400) / 2);
        var inst = { id: id, type: type, x: 0, y: 0, rot: 0, props: pr };
        // free spot nearest to the view centre: rings of candidates 3 u apart, first one that overlaps nothing
        var b = d.bbox, boxes = parts.map(instBox), found = false;
        function tryAt(ox, oy) {
          inst.x = Math.round(c.x - (b.x + b.w / 2) + ox); inst.y = Math.round(c.y - (b.y + b.h / 2) + oy);
          if (d.plug) { inst.x = halfOff(inst.x); inst.y = halfOff(inst.y); }
          var mb = instBox(inst);
          return !boxes.some(function (o) { return mb.x < o.x + o.w + 1 && mb.x + mb.w + 1 > o.x && mb.y < o.y + o.h + 1 && mb.y + mb.h + 1 > o.y; });
        }
        for (var ring = 0; ring <= 30 && !found; ring++) {
          for (var i = -ring; i <= ring && !found; i++) for (var j = -ring; j <= ring && !found; j++) {
            if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
            found = tryAt(i * 3, j * 3);
          }
        }
        if (!found) tryAt(0, 0);
        hist.push(snapshot()); updHist();
        parts.push(inst); byId[id] = inst; plug[id] = null;
        renderPart(inst);
        setSel({ kind: 'part', id: id });
        changed('part-add', id);
        updHist();
        return id;
      },
      removeSelected: function () {
        if (!sel || ro || !(sel.kind === 'wire' ? wById[sel.id] : byId[sel.id])) return;
        hist.push(snapshot());
        if (sel.kind === 'wire') {
          var wid = sel.id;
          wires = wires.filter(function (w) { return w.id !== wid; }); delete wById[wid]; unrenderWire(wid);
          setSel(null); drawMarks(); toast(ar.removed, true); updHist();
          changed('wire-remove', wid);
          return;
        }
        var id = sel.id, inst = byId[id]; if (!inst) return;
        var gone = wires.filter(function (w) { return instOf(w.a) === id || instOf(w.b) === id; });
        gone.forEach(function (w) { delete wById[w.id]; unrenderWire(w.id); });
        wires = wires.filter(function (w) { return instOf(w.a) !== id && instOf(w.b) !== id; });
        for (var pid in plug) if (plug[pid] && plug[pid].bb === id) { plug[pid] = null; if (byId[pid]) placePart(byId[pid]); }
        parts = parts.filter(function (p) { return p.id !== id; }); delete byId[id]; delete plug[id]; delete visuals[id]; delete ctl[id];
        unrenderPart(id);
        if (pending && instOf(pending.a) === id) cancelWire(true);
        setSel(null); drawMarks(); toast(ar.removed, true); updHist();
        changed('part-remove', id);
      },
      select: function (s) {
        if (s && !(s.kind === 'part' ? byId[s.id] : wById[s.id])) s = null;
        setSel(s || null);
        if (s && s.kind === 'part' && els[s.id]) {
          // make sure the selected part is visible
          var b = instBox(byId[s.id]), r = svg.getBoundingClientRect(), p1 = worldToScreen(b.x, b.y), p2 = worldToScreen(b.x + b.w, b.y + b.h);
          if (r.width && (p2.x < r.left || p1.x > r.right || p2.y < r.top || p1.y > r.bottom)) {
            view.tx += (r.left + r.width / 2) - (p1.x + p2.x) / 2; view.ty += (r.top + r.height / 2) - (p1.y + p2.y) / 2; applyView();
          }
        }
      },
      rotateSelected: function () {
        if (!sel || sel.kind !== 'part' || ro) return;
        var inst = byId[sel.id]; if (!inst) return;
        hist.push(snapshot());
        if (kindOf(inst) === 'breadboard') {
          groupIds(inst).slice(1).forEach(function (cid) {
            var c = byId[cid], q = rotPt(c.x - inst.x, c.y - inst.y, 90);
            c.x = inst.x + q.x; c.y = inst.y + q.y; c.rot = ((c.rot || 0) + 90) % 360; placePart(c);
          });
        }
        inst.rot = ((inst.rot || 0) + 90) % 360;
        if (isPlug(inst)) { plug[inst.id] = null; settlePlug(inst); }
        placePart(inst); wiresOf(groupIds(inst)).forEach(placeWire); drawMarks(); updHist();
        changed('part-rotate', inst.id);
      },
      setWireColor: function (wireId, color) {
        var w = wById[wireId]; if (!w || !WIRE_COLOURS[color] || ro || w.color === color) return;
        hist.push(snapshot()); w.color = color;
        var e = wireEls[wireId]; if (e) { e.path.setAttribute('stroke', WIRE_COLOURS[color]); e.out.classList.toggle('wb-wire-out-light', color === 'black'); }
        updHist(); changed('wire-edit', wireId);
      },
      startWire: function (ref) { return startWire(ref); },
      finishWire: function (ref) { var ok = finishWire(ref); updHist(); return ok; },
      cancelWire: function () { cancelWire(); },
      /** Pending wire start (for the inspector's keyboard wiring), or null. */
      pendingWire: function () { return pending ? pending.a : null; },
      setVisuals: function (map) {
        if (!map) return;
        for (var id in map) { visuals[id] = map[id]; applyVisual(id, map[id]); }
      },
      setMarks: function (list) { marks = (list || []).slice(); drawMarks(); },
      zoom: function (dir) { zoomAt(dir > 0 ? 1.25 : 0.8); },
      fit: function () {
        var r = svg.getBoundingClientRect();
        if (!r.width || !r.height) { needFit = true; return; }
        needFit = false;
        if (!parts.length) { view.s = S_DEFAULT; view.tx = r.width / 2; view.ty = r.height / 2; applyView(); return; }
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        parts.forEach(function (p) { var b = instBox(p); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
        wires.forEach(function (w) { (w.pts || []).forEach(function (q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }); });
        var pad = 3, s = Math.min(r.width / (x1 - x0 + 2 * pad), r.height / (y1 - y0 + 2 * pad));
        view.s = Math.max(S_MIN, Math.min(30, s));
        view.tx = r.width / 2 - ((x0 + x1) / 2) * view.s; view.ty = r.height / 2 - ((y0 + y1) / 2) * view.s;
        applyView();
      },
      setReadOnly: function (b) {
        ro = !!b; rootEl.classList.toggle('wb-ro', ro);
        if (ro) { cancelWire(true); hidePop(); hint.textContent = ar.readOnly; }
        else hint.textContent = coarse ? ar.wireHintTouch : ar.wireHintFine;
        COLOUR_ORDER.forEach(function (c) { swatches[c].disabled = ro; });
        updHist(); refreshSelection();
      },
      setProps: function (instId, props) {
        var inst = byId[instId]; if (!inst || !props) return;
        hist.push(snapshot());
        inst.props = inst.props || {};
        for (var k5 in props) inst.props[k5] = props[k5];
        unrenderPart(instId); renderPart(inst);
        // keep layer order: re-rendered part goes back under the wires (renderPart appends to its layer)
        refreshSelection(); updHist();
        changed('prop', instId);
      },
      undo: function () { if (ro) return; var s = hist.undo(snapshot()); if (s == null) return; var n0 = parts.length, w0 = wires.length; cancelWire(true); restore(s); updHist(); changed(kindFor(n0, w0), null, { undo: true }); },
      redo: function () { if (ro) return; var s = hist.redo(snapshot()); if (s == null) return; var n0 = parts.length, w0 = wires.length; cancelWire(true); restore(s); updHist(); changed(kindFor(n0, w0), null, { redo: true }); },
      /** Current pixels-per-u and offset (tests / debugging). */
      view: function () { return { tx: view.tx, ty: view.ty, s: view.s }; },
      destroy: function () {
        destroyed = true; clearTimeout(toastTimer);
        if (ro_obs) ro_obs.disconnect();
        if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
      }
    };
    function kindFor(n0, w0) {
      return parts.length > n0 ? 'part-add' : parts.length < n0 ? 'part-remove' : wires.length > w0 ? 'wire-add' : wires.length < w0 ? 'wire-remove' : 'part-move';
    }
    // history buttons follow every recorded change
    var _push = hist.push; hist.push = function (s) { _push.call(hist, s); setTimeout(updHist, 0); };
    updHist(); updateEmpty();
    return api;
  }

  NS.Workbench = {
    mount: mount,
    AR: AR,
    COLOURS: WIRE_COLOURS,
    _pure: { rotPt: rotPt, halfOff: halfOff, History: History, occupancy: occupancy, autoColour: autoColour, pickCandidates: pickCandidates, pathD: pathD, nearestSegment: nearestSegment }
  };
})(typeof window !== 'undefined' ? window : globalThis);
