/* بإيدك lab simulator: panels.js (lab-sim-spec.md §6.8, §10). NS.UI.build(rootEl, app) -> ui
   Builds the DOM of the simulator around the workbench: toolbar, board picker, examples menu, catalog (search +
   categories), inspector (part info, props, sensor controls, pins + keyboard wiring, 3D), code editor (textarea +
   gutter + line marks), problems list, run stages + real-board box, serial monitor, mobile tab bar, dialogs, toasts.
   This file only draws and forwards events to `app` (sim-main.js); it holds no simulation state.
   Visitor text (code, serial, imported names) always goes through textContent. innerHTML only for static icons. */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};

  /* ---------- copy: §10.7 verbatim unless marked NEW COPY ---------- */
  var AR = {
    pickTitle: 'اختاروا الكارت اللي هتبدأوا بيه',
    pickSub: 'الطاولة هتبدأ بالكارت بس، وانتو بتزوّدوا القطع اللي محتاجينها. تقدروا تغيّروه بعدين.',
    boardNames: { uno: 'Arduino Uno', esp32: 'ESP32 DevKit V1', nano: 'Arduino Nano' },
    boardSub: { uno: '5 فولت · 14 طرف ديجيتال · 6 أنالوج', esp32: '3.3 فولت · واي فاي · ADC 12 بت', nano: 'زي الـUno بس صغير وبيتركب في البريدبورد' }, // NEW COPY
    changeBoard: 'تغيّروا الكارت؟ الأسلاك اللي على أطراف الكارت القديم هتتشال، والقطع التانية هتفضل.', changeOk: 'غيّروه', no: 'لأ',
    run: 'شغّلوا', stop: 'وقّفوا', reset: 'من الأول', speed: 'السرعة', sound: 'الصوت', examples: 'الأمثلة',
    save: 'احفظوا ملف', open: 'افتحوا ملف', clear: 'امسحوا الطاولة', more: 'المزيد',
    speeds: [{ v: 0.25, t: '0.25×', l: 'بالبطيء' }, { v: 1, t: '1×', l: 'زي الحقيقة' }, { v: 4, t: '4×', l: 'أسرع' }],
    exTitle: 'أمثلة جاهزة: بتتحط متوصلة وبكودها',
    exConfirm: 'المثال هيمسح اللي على الطاولة والكود. احفظوا ملف الأول لو عايزينه.', exOk: 'حطّوا المثال',
    clearConfirm: 'تمسحوا كل حاجة على الطاولة (غير الكارت) والكود؟', clearOk: 'امسحوا',
    catTab: 'القطع', search: 'دوّروا على قطعة (مثلًا LED أو حساس)', all: 'الكل', add: 'حطّوها على الطاولة',
    catEmpty: 'مفيش قطعة بالاسم ده. جرّبوا كلمة تانية.',
    onBench: 'على الطاولة',                                                       // NEW COPY
    inspTab: 'القطعة المختارة',
    inspEmpty: 'دوسوا على أي قطعة أو سلك على الطاولة علشان تشوفوا تفاصيله هنا.',
    secWhat: 'بتعمل إيه؟', secFacts: 'معلومات مهمة', secPins: 'أطرافها', secCtl: 'تحكّموا فيها', sec3d: 'الشكل الـ3D',
    secProps: 'الإعدادات',                                                        // NEW COPY
    rotate: 'لِفّوها', remove: 'امسحوها', repair: 'غيّروها بواحدة جديدة', open3d: 'افتحوا الـ3D',
    no3d: 'الشكل الـ3D للقطعة دي لسه مش موجود، بس الرسم اللي فوق قدامكم.',
    connectedTo: 'متوصّل بـ: ', notConnected: 'مش متوصّل بحاجة',
    wireFrom: 'سلك من {a} لـ{b}', wireColour: 'لون السلك', wireRemove: 'امسحوا السلك',
    colours: { red: 'أحمر', black: 'أسود', blue: 'أزرق', green: 'أخضر', yellow: 'أصفر', orange: 'برتقاني', white: 'أبيض', violet: 'بنفسجي' },
    wireTo: 'السلك اللي رايح لـ',                                                 // NEW COPY
    wireStart: 'ابدأوا سلك من هنا', wireEnd: 'وصّلوا السلك هنا', hole: 'الخُرم:', wireCancel: 'الغوا السلك', // last: NEW COPY
    lcdNote: 'على الشاشة الحقيقية: لو الشاشة منورة ومفيش كلام، لفّوا المقاومة الزرقا اللي ورا بمفك.', // §15
    editorLabel: 'الكود ‎(sketch.ino)‎',
    editorHint: 'Tab بيعمل مسافة. علشان تخرجوا من الكود بالكيبورد: Esc وبعدين Tab.',
    restoreEx: 'رجّعوا كود المثال',
    probTitle: 'المشاكل', probEmpty: 'مفيش مشاكل.',
    sev: { error: 'خطأ', warn: 'تحذير', hint: 'ملحوظة' },
    line: 'سطر {n}',                                                               // NEW COPY
    stage1: 'على المحاكي', stage2: 'على جهازكم',                                    // NEW COPY (stage names)
    stageIdle: 'لسه ما اتشغلش.',
    runReal: 'شغّلوه على جهازي', stopReal: 'وقّفوه على جهازي',                    // second: NEW COPY
    hwTitle: 'جهازكم الحقيقي', hwOpt: '(اختياري)',
    serialTitle: 'شاشة السيريال', serialPh: 'اكتبوا هنا وابعتوا للكارت', send: 'ابعتوا', clearSerial: 'امسحوا الشاشة',
    autoscroll: 'انزلوا لآخر سطر لوحدها', readLast: 'اقروا آخر سطر', baud: 'السرعة',
    lineEndings: [{ v: 'none', t: 'من غير نهاية سطر' }, { v: 'nl', t: 'سطر جديد (NL)' }, { v: 'cr', t: 'رجوع لأول السطر (CR)' }, { v: 'both', t: 'الاتنين (NL & CR)' }],
    soundOn: 'الصوت شغال', soundOff: 'الصوت مقفول',
    tabs: { bench: 'الطاولة', parts: 'القطع', code: 'الكود', serial: 'السيريال' },
    tabsLabel: 'أقسام المعمل',                                                     // NEW COPY
    toolbarLabel: 'أدوات المعمل',                                                  // NEW COPY
    close: 'اقفلوا',                                                               // NEW COPY
    startOver: 'ابدأوا من جديد',
    catsLabel: 'أقسام القطع'                                                       // NEW COPY
  };
  function fill(t, v) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }

  /* ---------- tiny DOM helpers ---------- */
  function h(tag, attrs, parent, text) {
    var e = root.document.createElement(tag);
    if (attrs) for (var k in attrs) { if (attrs[k] == null || attrs[k] === false) continue; if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }
  function ltr(text, parent) { return h('bdi', { dir: 'ltr' }, parent, text); }
  var ICONS = {
    play: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-play"/></svg>',
    stop: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-stop"/></svg>',
    reset: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-reset"/></svg>',
    board: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-chip"/></svg>',
    book: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-book"/></svg>',
    more: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-more"/></svg>',
    bench: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-bench"/></svg>',
    parts: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-parts"/></svg>',
    code: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-code"/></svg>',
    serial: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-serial"/></svg>',
    x: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-x"/></svg>',
    sound: '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-sound"/></svg>'
  };
  function btn(cls, label, parent, icon, attrs) {
    var a = { type: 'button', 'class': cls };
    if (attrs) for (var k in attrs) a[k] = attrs[k];
    var b = h('button', a, parent);
    if (icon) b.innerHTML = ICONS[icon];                // static icon markup only
    h('span', { 'class': 'sim-bl' }, b, label);
    return b;
  }
  var SEV_ICON = { error: '✕', warn: '!', hint: 'i' };

  /* =====================================================================
     build
     ===================================================================== */
  function build(rootEl, app) {
    var doc = root.document;
    var P = function () { return NS.Parts; };
    var ui = { AR: AR };
    clear(rootEl);
    rootEl.setAttribute('data-tab', 'bench');

    /* ---------- toasts + live region ---------- */
    var toastBox = h('div', { 'class': 'sim-toasts', role: 'status', 'aria-live': 'polite' }, rootEl);
    var live = h('p', { 'class': 'sr-only', 'aria-live': 'polite' }, rootEl);
    var toastT = null;
    ui.toast = function (text, action) {
      clear(toastBox);
      var t = h('div', { 'class': 'sim-toast' }, toastBox);
      h('span', null, t, text);
      if (action) { var b = btn('seg-btn sim-toast-btn', action.label, t); b.addEventListener('click', function () { clear(toastBox); action.fn(); }); }
      var x = h('button', { type: 'button', 'class': 'sim-toast-x', 'aria-label': AR.close }, t); x.innerHTML = ICONS.x;
      x.addEventListener('click', function () { clear(toastBox); });
      clearTimeout(toastT);
      toastT = setTimeout(function () { clear(toastBox); }, action ? 10000 : 5000);
    };
    ui.say = function (text) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 50); };

    /* ---------- board picker (first visit) ---------- */
    var picker = h('section', { 'class': 'sim-picker', 'aria-labelledby': 'sim-pick-h', hidden: true }, rootEl);
    function pickerCards(parent, onPick) {
      h('h2', { id: parent === picker ? 'sim-pick-h' : null, 'class': 'sim-pick-h' }, parent, AR.pickTitle);
      h('p', { 'class': 'sim-pick-sub' }, parent, AR.pickSub);
      var row = h('div', { 'class': 'sim-pick-row' }, parent);
      (P().boards || ['uno', 'esp32']).forEach(function (t) {
        if (!P().get(t)) return;                         // §10.1: Nano only when built
        var b = h('button', { type: 'button', 'class': 'sim-pick-card', 'data-board': t }, row);
        h('span', { 'class': 'sim-pick-sw sim-pick-' + t, 'aria-hidden': 'true' }, b);
        ltr(AR.boardNames[t] || t, h('b', null, b));
        h('span', { 'class': 'sim-pick-small' }, b, AR.boardSub[t] || '');
        b.addEventListener('click', function () { onPick(t); });
      });
    }
    pickerCards(picker, function (t) { app.pickBoard(t); });
    ui.showPicker = function (on) { picker.hidden = !on; work.hidden = on; bar.hidden = on; tabbar.hidden = on; };

    /* ---------- toolbar ---------- */
    var bar = h('div', { 'class': 'sim-toolbar', role: 'toolbar', 'aria-label': AR.toolbarLabel }, rootEl);
    var boardBtn = btn('seg-btn sim-board-btn', '', bar, 'board', { 'aria-haspopup': 'dialog' });
    boardBtn.addEventListener('click', function () { app.changeBoard(); });
    var exWrap = h('div', { 'class': 'sim-menu' }, bar);
    var exBtn = btn('seg-btn sim-ex-btn', AR.examples, exWrap, 'book', { 'aria-expanded': 'false', 'aria-controls': 'sim-ex-pop' });
    var exPop = h('div', { 'class': 'sim-pop', id: 'sim-ex-pop', hidden: true }, exWrap);
    h('p', { 'class': 'sim-pop-h' }, exPop, AR.exTitle);
    var exList = h('ul', { 'class': 'sim-ex-list' }, exPop);
    function exOpen(on) { exPop.hidden = !on; exBtn.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) { var f = exPop.querySelector('button'); if (f) f.focus(); } }
    exBtn.addEventListener('click', function () { exOpen(exPop.hidden); });
    exPop.addEventListener('keydown', function (e) { if (e.key === 'Escape') { exOpen(false); exBtn.focus(); } });
    doc.addEventListener('pointerdown', function (e) { if (!exPop.hidden && !exWrap.contains(e.target)) exOpen(false); });
    (NS.Examples || []).forEach(function (ex) {
      var li = h('li', null, exList);
      var b = h('button', { type: 'button', 'class': 'sim-ex-item', 'data-example': ex.id }, li);
      h('b', null, b, ex.title_ar);
      h('span', null, b, ex.desc_ar);
      ltr(AR.boardNames[ex.board] || ex.board, h('span', { 'class': 'sim-ex-board' }, b));
      b.addEventListener('click', function () { exOpen(false); app.loadExample(ex.id); });
    });
    var runG = h('div', { 'class': 'sim-run-group' }, bar);
    var runB = btn('run-btn sim-run', AR.run, runG, 'play', { 'data-act': 'run' });
    var stopB = btn('seg-btn sim-stop', AR.stop, runG, 'stop', { 'data-act': 'stop', disabled: true });
    var resetB = btn('seg-btn sim-reset', AR.reset, runG, 'reset', { 'data-act': 'reset', disabled: true });
    runB.addEventListener('click', function () { app.run(); });
    stopB.addEventListener('click', function () { app.stop(); });
    resetB.addEventListener('click', function () { app.reset(); });
    var moreB = btn('seg-btn sim-more-btn', AR.more, bar, 'more', { 'aria-expanded': 'false', 'aria-controls': 'sim-more' });
    var more = h('div', { 'class': 'sim-more', id: 'sim-more' }, bar);
    moreB.addEventListener('click', function () { var on = !more.classList.contains('is-open'); more.classList.toggle('is-open', on); moreB.setAttribute('aria-expanded', on ? 'true' : 'false'); });
    var spL = h('label', { 'class': 'sim-speed' }, more);
    h('span', null, spL, AR.speed);
    var spSel = h('select', { 'class': 'sim-select', 'data-act': 'speed' }, spL);
    AR.speeds.forEach(function (s) { var o = h('option', { value: String(s.v) }, spSel, '‎' + s.t + '‎ (' + s.l + ')'); if (s.v === 1) o.selected = true; });
    spSel.addEventListener('change', function () { app.setSpeed(+spSel.value); });
    var soundB = btn('seg-btn sim-sound', AR.sound, more, 'sound', { 'aria-pressed': 'true', 'aria-label': AR.soundOn });
    soundB.addEventListener('click', function () { app.setSound(soundB.getAttribute('aria-pressed') !== 'true'); });
    var saveB = btn('seg-btn', AR.save, more, null, { 'data-act': 'save' });
    var openB = btn('seg-btn', AR.open, more, null, { 'data-act': 'open' });
    var fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'class': 'sim-file' }, more);
    var clearB = btn('seg-btn', AR.clear, more, null, { 'data-act': 'clear' });
    saveB.addEventListener('click', function () { app.exportFile(); });
    openB.addEventListener('click', function () { fileIn.value = ''; fileIn.click(); });
    fileIn.addEventListener('change', function () { if (fileIn.files && fileIn.files[0]) app.importFile(fileIn.files[0]); });
    clearB.addEventListener('click', function () { app.clearBench(); });
    ui.setSound = function (on) { soundB.setAttribute('aria-pressed', on ? 'true' : 'false'); soundB.setAttribute('aria-label', on ? AR.soundOn : AR.soundOff); };
    ui.setSpeed = function (v) { spSel.value = String(v); };
    ui.setBoard = function (type) { boardBtn.querySelector('.sim-bl').textContent = (AR.boardNames[type] || type) + ' ▾'; boardBtn.setAttribute('dir', 'ltr'); };
    ui.setRunning = function (st) {     // st: 'stopped' | 'sim' | 'real'
      runB.disabled = st === 'real'; stopB.disabled = st !== 'sim'; resetB.disabled = st !== 'sim';
      rootEl.setAttribute('data-run', st);
      tabRun.querySelector('.sim-bl').textContent = st === 'sim' ? AR.stop : AR.run;
      tabRun.innerHTML = '';
      tabRun.innerHTML = st === 'sim' ? ICONS.stop : ICONS.play;
      h('span', { 'class': 'sim-bl' }, tabRun, st === 'sim' ? AR.stop : AR.run);
      tabRun.disabled = st === 'real';
    };

    /* ---------- workspace ---------- */
    var work = h('div', { 'class': 'sim-work' }, rootEl);
    var exNote = h('p', { 'class': 'sim-exnote', hidden: true }, work);
    var side = h('aside', { 'class': 'sim-side', 'aria-label': AR.catTab }, work);
    var benchCol = h('section', { 'class': 'sim-benchcol', 'aria-label': AR.tabs.bench }, work);
    var right = h('div', { 'class': 'sim-right' }, work);
    var codeBox = h('section', { 'class': 'sim-codebox', 'aria-label': AR.tabs.code }, right);
    var serialBox = h('section', { 'class': 'sim-serialbox', 'aria-labelledby': 'sim-serial-h' }, right);
    ui.benchEl = h('div', { 'class': 'sim-bench' }, benchCol);
    ui.setExampleNote = function (ex) {
      exNote.hidden = !ex; clear(exNote);
      if (ex) { h('b', null, exNote, ex.title_ar + ': '); h('span', null, exNote, ex.learn_ar); }
    };

    /* ---------- side: tabs ---------- */
    var sheetHead = h('div', { 'class': 'sim-sheet-head' }, side);
    var sheetX = btn('seg-btn sim-sheet-x', AR.close, sheetHead, 'x');
    var sTabs = h('div', { 'class': 'sim-stabs', role: 'tablist' }, side);
    var tCat = h('button', { type: 'button', role: 'tab', id: 'sim-t-cat', 'aria-controls': 'sim-p-cat', 'aria-selected': 'true', 'class': 'sim-stab' }, sTabs, AR.catTab);
    var tIns = h('button', { type: 'button', role: 'tab', id: 'sim-t-ins', 'aria-controls': 'sim-p-ins', 'aria-selected': 'false', 'class': 'sim-stab', tabindex: '-1' }, sTabs, AR.inspTab);
    var pCat = h('div', { role: 'tabpanel', id: 'sim-p-cat', 'aria-labelledby': 'sim-t-cat', 'class': 'sim-catalog' }, side);
    var pIns = h('div', { role: 'tabpanel', id: 'sim-p-ins', 'aria-labelledby': 'sim-t-ins', 'class': 'sim-inspector', hidden: true }, side);
    function sideTab(which) {
      var c = which === 'cat';
      tCat.setAttribute('aria-selected', c ? 'true' : 'false'); tIns.setAttribute('aria-selected', c ? 'false' : 'true');
      tCat.setAttribute('tabindex', c ? '0' : '-1'); tIns.setAttribute('tabindex', c ? '-1' : '0');
      pCat.hidden = !c; pIns.hidden = c;
    }
    tCat.addEventListener('click', function () { sideTab('cat'); });
    tIns.addEventListener('click', function () { sideTab('ins'); });
    sTabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); var to = tCat.getAttribute('aria-selected') === 'true' ? 'ins' : 'cat'; sideTab(to); (to === 'cat' ? tCat : tIns).focus();
    });
    ui.sideTab = sideTab;

    /* bottom sheet (mobile): the side panel opens over the bench */
    var sheetPrev = null;
    function mobile() { return root.matchMedia && root.matchMedia('(max-width: 719px)').matches; }
    ui.openSheet = function () {
      if (!mobile() || rootEl.getAttribute('data-tab') === 'parts') return;
      sheetPrev = doc.activeElement;
      side.classList.add('sim-sheet'); side.setAttribute('role', 'dialog'); side.setAttribute('aria-modal', 'true');
      sheetX.focus();
    };
    function closeSheet() {
      if (!side.classList.contains('sim-sheet')) return;
      side.classList.remove('sim-sheet'); side.removeAttribute('role'); side.removeAttribute('aria-modal');
      if (sheetPrev && sheetPrev.focus) { try { sheetPrev.focus(); } catch (e) { /* gone */ } }
    }
    ui.closeSheet = closeSheet;
    sheetX.addEventListener('click', closeSheet);
    side.addEventListener('keydown', function (e) {
      if (!side.classList.contains('sim-sheet')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(side.querySelectorAll('button, input, select, textarea, [tabindex="0"]'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });

    /* ---------- catalog ---------- */
    var sL = h('label', { 'class': 'sr-only', 'for': 'sim-search' }, pCat, AR.search);
    var sIn = h('input', { type: 'search', id: 'sim-search', 'class': 'sim-input', placeholder: AR.search, autocomplete: 'off' }, pCat);
    var cats = h('div', { 'class': 'sim-cats', role: 'group', 'aria-label': AR.catsLabel }, pCat);
    var catSel = 'all';
    var catBtns = {};
    [{ id: 'all', label_ar: AR.all }].concat((P().categories || []).filter(function (c) { return c.id !== 'board'; })).forEach(function (c) {
      var b = h('button', { type: 'button', 'class': 'sim-chip', 'data-cat': c.id, 'aria-pressed': c.id === 'all' ? 'true' : 'false' }, cats, c.label_ar);
      catBtns[c.id] = b;
      b.addEventListener('click', function () { catSel = c.id; for (var k in catBtns) catBtns[k].setAttribute('aria-pressed', k === c.id ? 'true' : 'false'); renderCatalog(); });
    });
    var cList = h('ul', { 'class': 'sim-cat-list' }, pCat);
    var cEmpty = h('p', { 'class': 'sim-muted', hidden: true }, pCat, AR.catEmpty);
    h('h3', { 'class': 'sim-h3' }, pCat, AR.onBench);
    var onBench = h('ul', { 'class': 'sim-onbench' }, pCat);
    function norm(s) { return String(s || '').toLowerCase().replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim(); }
    function renderCatalog() {
      clear(cList);
      var q = norm(sIn.value), n = 0;
      P().list().forEach(function (d) {
        if (d.kind === 'board') return;                  // one board per project: changed from the toolbar
        if (catSel !== 'all' && d.category !== catSel) return;
        if (q) {
          var hay = norm([d.name_ar, d.name_en, d.type].concat(d.keywords || []).join(' '));
          if (hay.indexOf(q) < 0) return;
        }
        n++;
        var li = h('li', { 'class': 'sim-cat-item', 'data-type': d.type }, cList);
        var t = h('div', { 'class': 'sim-cat-t' }, li);
        h('b', null, t, d.name_ar);
        ltr(d.name_en, h('span', { 'class': 'sim-muted' }, t));
        var b = btn('seg-btn sim-add', AR.add, li, null, { 'data-add': d.type, 'aria-label': AR.add + ': ' + d.name_ar });
        b.addEventListener('click', function () { app.addPart(d.type); });
      });
      cEmpty.hidden = n > 0;
    }
    sIn.addEventListener('input', renderCatalog);
    renderCatalog();
    ui.renderOnBench = function (parts, selId) {
      clear(onBench);
      parts.forEach(function (p) {
        var d = P().get(p.type);
        var li = h('li', null, onBench);
        var b = h('button', { type: 'button', 'class': 'sim-chip sim-onb', 'data-select': p.id, 'aria-pressed': p.id === selId ? 'true' : 'false' }, li);
        h('span', null, b, (d ? d.name_ar : p.type) + ' ');
        ltr(p.id, b);
        b.addEventListener('click', function () { app.selectPart(p.id); });
      });
    };

    /* ---------- inspector ---------- */
    ui.renderInspector = function (sel, info) {
      clear(pIns);
      if (!sel) { h('p', { 'class': 'sim-muted' }, pIns, AR.inspEmpty); return; }
      if (sel.kind === 'wire') return renderWire(sel, info);
      renderPartInsp(sel, info);
    };
    ui.isInspecting = function (id) { return !pIns.hidden && pIns.getAttribute('data-id') === id; };
    function section(title, parent) { var s = h('section', { 'class': 'sim-sec' }, parent || pIns); h('h3', { 'class': 'sim-h3' }, s, title); return s; }
    function renderWire(sel, w) {
      pIns.setAttribute('data-id', sel.id);
      if (!w) { h('p', { 'class': 'sim-muted' }, pIns, AR.inspEmpty); return; }
      var t = h('p', { 'class': 'sim-insp-title' }, pIns);
      var parts = AR.wireFrom.split(/\{a\}|\{b\}/);
      h('span', null, t, parts[0]); ltr(w.a, t); h('span', null, t, parts[1]); ltr(w.b, t); h('span', null, t, parts[2] || '');
      var lab = h('label', { 'class': 'sim-field' }, pIns);
      h('span', null, lab, AR.wireColour);
      var s = h('select', { 'class': 'sim-select', 'data-wire-colour': w.id }, lab);
      Object.keys(AR.colours).forEach(function (c) { var o = h('option', { value: c }, s, AR.colours[c]); if (c === w.color) o.selected = true; });
      s.addEventListener('change', function () { app.wireColour(w.id, s.value); });
      var rb = btn('seg-btn sim-danger', AR.wireRemove, pIns, 'x', { 'data-act': 'wire-remove' });
      rb.addEventListener('click', function () { app.removeSelected(); });
    }
    function renderPartInsp(sel, info) {
      var inst = info.inst, d = info.def;
      pIns.setAttribute('data-id', inst.id);
      var head = h('div', { 'class': 'sim-insp-head' }, pIns);
      var t = h('p', { 'class': 'sim-insp-title' }, head);
      h('b', null, t, d.name_ar + ' ');
      ltr(inst.id, h('span', { 'class': 'sim-muted' }, t));
      ltr(d.name_en, h('p', { 'class': 'sim-muted sim-insp-en' }, head));
      // preview drawing (same art as the bench)
      try {
        var A = NS.Art || {}, art = A[inst.type] || A.fallback;
        if (art) {
          var SV = 'http://www.w3.org/2000/svg', b = d.bbox, pad = 1;
          var svg = doc.createElementNS(SV, 'svg');
          svg.setAttribute('viewBox', (b.x - pad) + ' ' + (b.y - pad) + ' ' + (b.w + 2 * pad) + ' ' + (b.h + 2 * pad));
          svg.setAttribute('class', 'sim-preview'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
          var g = art.draw({ id: inst.id, type: inst.type, x: 0, y: 0, rot: 0, props: inst.props || {} }, d);
          svg.appendChild(g);
          if (info.visual && art.update) { try { art.update(g, info.visual, inst); } catch (e) { /* cosmetic */ } }
          head.appendChild(svg);
        }
      } catch (e) { /* the preview is decoration */ }
      var acts = h('div', { 'class': 'sim-acts' }, pIns);
      if (d.kind !== 'board') {
        btn('seg-btn', AR.rotate, acts, null, { 'data-act': 'rotate' }).addEventListener('click', function () { app.rotateSelected(); });
        btn('seg-btn sim-danger', AR.remove, acts, 'x', { 'data-act': 'remove' }).addEventListener('click', function () { app.removeSelected(); });
      }
      if (info.damaged) btn('run-btn', AR.repair, acts, null, { 'data-act': 'repair' }).addEventListener('click', function () { app.repair(inst.id); });
      // what it does
      var s1 = section(AR.secWhat); h('p', null, s1, d.info_ar || '');
      // facts
      if ((d.facts && d.facts.length) || inst.type === 'lcd1602') {
        var s2 = section(AR.secFacts), dl = h('dl', { 'class': 'sim-facts' }, s2);
        (d.facts || []).forEach(function (f) { h('dt', null, dl, f.k_ar); ltr(f.v, h('dd', null, dl)); });
        if (inst.type === 'lcd1602') h('p', { 'class': 'sim-muted' }, s2, AR.lcdNote);
      }
      // props
      if (d.props && d.props.length) {
        var s3 = section(AR.secProps);
        d.props.forEach(function (p) {
          var cur = inst.props && inst.props[p.key] != null ? inst.props[p.key] : p.default;
          if (p.type === 'toggle') {
            var lb = h('label', { 'class': 'check-row' }, s3), cb = h('input', { type: 'checkbox', 'data-prop': p.key }, lb);
            cb.checked = !!cur; h('span', null, lb, p.label_ar);
            cb.addEventListener('change', function () { var o = {}; o[p.key] = cb.checked; app.setProps(inst.id, o); });
          } else {
            var l2 = h('label', { 'class': 'sim-field' }, s3); h('span', null, l2, p.label_ar);
            var s = h('select', { 'class': 'sim-select', 'data-prop': p.key }, l2);
            (p.options || []).forEach(function (o) { var op = h('option', { value: String(o.v) }, s, o.label_ar != null ? o.label_ar : String(o.v)); if (String(o.v) === String(cur)) op.selected = true; });
            s.addEventListener('change', function () {
              var v = s.value, src = (p.options || []).filter(function (o) { return String(o.v) === v; })[0];
              var o = {}; o[p.key] = src ? src.v : v; app.setProps(inst.id, o);
            });
          }
        });
      }
      // controls
      if (d.controls && d.controls.length) {
        var s4 = section(AR.secCtl), vals = info.controls || {};
        d.controls.forEach(function (c) { renderControl(s4, inst.id, c, vals[c.key] != null ? vals[c.key] : c.default); });
      }
      // pins
      var s5 = section(AR.secPins);
      if (d.kind === 'breadboard') renderHolePicker(s5, inst, d, info);
      else {
        var ul = h('ul', { 'class': 'sim-pins' }, s5);
        d.pins.forEach(function (p) {
          var ref = inst.id + '.' + p.id, li = h('li', { 'class': 'sim-pin', 'data-pin': ref }, ul);
          var tx = h('p', null, li);
          ltr(p.label || p.id, h('b', null, tx)); h('span', null, tx, ': ' + (p.ar || ''));
          var con = info.netOf ? info.netOf(ref) : [];
          var cp = h('p', { 'class': 'sim-muted' }, li);
          if (con.length) { h('span', null, cp, AR.connectedTo); ltr(con.join(', '), cp); } else cp.textContent = AR.notConnected;
          var row = h('div', { 'class': 'sim-acts' }, li);
          wireButton(row, ref, info.pending);
          (info.wiresAt ? info.wiresAt(ref) : []).forEach(function (w) {   // keyboard path to a wire (select -> recolour / delete)
            var wb = h('button', { type: 'button', 'class': 'seg-btn', 'data-select-wire': w.id }, row);
            h('span', null, wb, AR.wireTo); ltr(w.other, wb);
            wb.addEventListener('click', function () { app.selectWire(w.id); });
          });
        });
      }
      // 3D
      var s6 = section(AR.sec3d);
      if (NS.View3D && NS.View3D.has(inst.type)) {
        var b3 = btn('seg-btn', AR.open3d, s6, null, { 'data-act': 'open3d' });
        b3.addEventListener('click', function () { app.open3d(inst.type, b3); });
      } else h('p', { 'class': 'sim-muted' }, s6, AR.no3d);
    }
    function wireButton(parent, ref, pending) {
      if (pending === ref) {
        btn('seg-btn', AR.wireCancel, parent, null, { 'data-wire-cancel': ref }).addEventListener('click', function () { app.cancelWire(); });
      } else if (pending) {
        btn('seg-btn sim-wire-end', AR.wireEnd, parent, null, { 'data-wire-end': ref }).addEventListener('click', function () { app.finishWire(ref); });
      } else {
        btn('seg-btn', AR.wireStart, parent, null, { 'data-wire-start': ref }).addEventListener('click', function () { app.startWire(ref); });
      }
    }
    function renderHolePicker(parent, inst, d, info) {
      var f = h('div', { 'class': 'sim-hole' }, parent);
      h('span', null, f, AR.hole);
      var rows = {}, cols = {};
      d.pins.forEach(function (p) { var m = /^([a-z]+)(\d+)$/.exec(p.id); if (m) { rows[m[1]] = Math.max(rows[m[1]] || 0, +m[2]); } });
      var rs = h('select', { 'class': 'sim-select', dir: 'ltr', 'aria-label': AR.hole }, f);
      Object.keys(rows).forEach(function (r) { h('option', { value: r }, rs, r); });
      rs.value = rows.e ? 'e' : Object.keys(rows)[0];
      var cn = h('input', { type: 'number', 'class': 'sim-input sim-num', min: '1', max: String(rows[rs.value] || 30), value: '1', dir: 'ltr', 'aria-label': AR.hole }, f);
      rs.addEventListener('change', function () { cn.max = String(rows[rs.value] || 30); });
      var holder = h('div', { 'class': 'sim-acts' }, parent);
      function ref() { var n = Math.max(1, Math.min(+cn.max || 30, Math.round(+cn.value) || 1)); return inst.id + '.' + rs.value + n; }
      var pend = info.pending;
      if (pend) {
        btn('seg-btn sim-wire-end', AR.wireEnd, holder, null, { 'data-wire-end-hole': '1' }).addEventListener('click', function () { app.finishWire(ref()); });
        btn('seg-btn', AR.wireCancel, holder).addEventListener('click', function () { app.cancelWire(); });
      } else btn('seg-btn', AR.wireStart, holder, null, { 'data-wire-start-hole': '1' }).addEventListener('click', function () { app.startWire(ref()); });
    }
    function renderControl(parent, id, c, val) {
      var row = h('div', { 'class': 'sim-ctl', 'data-ctl': c.key }, parent);
      if (c.type === 'range') {
        var lab = h('label', { 'class': 'sim-field' }, row);
        var lt = h('span', null, lab, c.label_ar + ': ');
        var out = h('output', { 'class': 'sim-out' }, lt);
        var log = !!c.log && c.min > 0;
        var r = h('input', { type: 'range', min: '0', max: log ? '1000' : String(c.max), step: log ? '1' : String(c.step || 1), 'data-key': c.key }, lab);
        r.min = log ? '0' : String(c.min);
        function toV(p) { if (!log) return +p; var v = c.min * Math.pow(c.max / c.min, p / 1000); var st = c.step || 0.1; return Math.round(v / st) * st; }
        function toP(v) { return log ? Math.round(1000 * Math.log(v / c.min) / Math.log(c.max / c.min)) : v; }
        function show(v) {
          out.textContent = (Math.round(v * 100) / 100) + (c.unit_ar ? ' ' + c.unit_ar : '');
          var p = (+r.value - +r.min) / ((+r.max - +r.min) || 1) * 100; r.style.setProperty('--p', p.toFixed(1) + '%');
        }
        r.value = String(toP(+val)); show(+val);
        r.addEventListener('input', function () { var v = toV(+r.value); show(v); app.control(id, c.key, v); });
        if (c.presets) {
          var ps = h('div', { 'class': 'sim-presets' }, row);
          c.presets.forEach(function (p) {
            var b = h('button', { type: 'button', 'class': 'sim-chip' }, ps, p.label_ar);
            b.addEventListener('click', function () { r.value = String(toP(p.v)); show(p.v); app.control(id, c.key, p.v); });
          });
        }
      } else if (c.type === 'momentary') {
        var b = h('button', { type: 'button', 'class': 'seg-btn sim-mom', 'aria-pressed': val ? 'true' : 'false', 'data-key': c.key }, row, c.label_ar);
        var down = !!val;
        function set(on) { if (on === down) return; down = on; b.setAttribute('aria-pressed', on ? 'true' : 'false'); app.control(id, c.key, on); }
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } set(true); });
        b.addEventListener('pointerup', function () { set(false); });
        b.addEventListener('pointercancel', function () { set(false); });
        b.addEventListener('lostpointercapture', function () { set(false); });
        b.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); set(true); } });
        b.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(false); } });
        b.addEventListener('blur', function () { set(false); });
      } else if (c.type === 'toggle') {
        var lb = h('label', { 'class': 'check-row' }, row), cb = h('input', { type: 'checkbox', 'data-key': c.key }, lb);
        cb.checked = !!val; h('span', null, lb, c.label_ar);
        cb.addEventListener('change', function () { app.control(id, c.key, cb.checked); });
      } else if (c.type === 'button') {
        var bb = h('button', { type: 'button', 'class': 'seg-btn', 'data-key': c.key }, row, c.label_ar);
        bb.addEventListener('click', function () { app.control(id, c.key, true); });
      } else if (c.type === 'select') {
        var l3 = h('label', { 'class': 'sim-field' }, row); h('span', null, l3, c.label_ar);
        var s = h('select', { 'class': 'sim-select', 'data-key': c.key }, l3);
        (c.options || []).forEach(function (o) { var op = h('option', { value: String(o.v) }, s, o.label_ar); if (String(o.v) === String(val)) op.selected = true; });
        s.addEventListener('change', function () {
          var src = (c.options || []).filter(function (o) { return String(o.v) === s.value; })[0];
          app.control(id, c.key, src ? src.v : s.value);
        });
      }
    }

    /* ---------- code editor ---------- */
    var eh = h('div', { 'class': 'sim-code-head' }, codeBox);
    h('label', { 'for': 'sim-code', 'class': 'ide-label' }, eh, AR.editorLabel);
    var restoreB = btn('seg-btn', AR.restoreEx, eh, 'reset', { hidden: true, 'data-act': 'restore-code' });
    restoreB.addEventListener('click', function () { app.restoreExampleCode(); });
    var ehint = h('p', { 'class': 'sim-muted', id: 'sim-code-hint' }, codeBox, AR.editorHint);
    var ed = h('div', { 'class': 'editor sim-editor' }, codeBox);
    var gut = h('div', { 'class': 'gutter sim-gutter', 'aria-hidden': 'true' }, ed);
    var ta = h('textarea', { id: 'sim-code', 'class': 'code', dir: 'ltr', rows: '16', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      maxlength: '50000', 'aria-describedby': 'sim-code-hint' }, ed);
    var marks = {};
    function syncGutter() {
      var n = ta.value.split('\n').length, have = gut.childNodes.length;
      while (have < n) { have++; h('div', { 'class': 'sim-gl', 'data-line': String(have) }, gut, String(have)); }
      while (have > n) { gut.removeChild(gut.lastChild); have--; }
      Array.prototype.forEach.call(gut.childNodes, function (d, i) { var s = marks[i + 1]; d.className = 'sim-gl' + (s ? ' is-' + s : ''); });
      gut.scrollTop = ta.scrollTop;
    }
    ta.addEventListener('scroll', function () { gut.scrollTop = ta.scrollTop; });
    var escFlag = false;
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { escFlag = true; return; }
      if (e.key === 'Tab' && !escFlag && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        if (e.shiftKey) {
          var ls = v.lastIndexOf('\n', s - 1) + 1;
          if (v.substr(ls, 2) === '  ') { ta.value = v.slice(0, ls) + v.slice(ls + 2); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - 2); }
        } else { ta.value = v.slice(0, s) + '  ' + v.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; }
        onCode();
        return;
      }
      escFlag = false;
    });
    function onCode() { syncGutter(); app.codeChanged(ta.value); }
    ta.addEventListener('input', onCode);
    ui.getCode = function () { return ta.value; };
    ui.setCode = function (code) { ta.value = code; marks = {}; syncGutter(); ta.scrollTop = 0; };
    ui.setMarks = function (msgs) {
      marks = {};
      var rank = { error: 3, warn: 2, hint: 1 };
      (msgs || []).forEach(function (m) { if (m.line && (!marks[m.line] || rank[m.sev] > rank[marks[m.line]])) marks[m.line] = m.sev; });
      syncGutter();
    };
    ui.focusLine = function (line) {
      var lines = ta.value.split('\n'), pos = 0;
      for (var i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      ta.focus(); ta.selectionStart = pos; ta.selectionEnd = pos + (lines[line - 1] || '').length;
      var lh = parseFloat(root.getComputedStyle(ta).lineHeight) || 22; ta.scrollTop = Math.max(0, (line - 3) * lh);
      if (mobile()) ui.setTab('code');
    };
    ui.showRestore = function (on) { restoreB.hidden = !on; };

    /* ---------- problems ---------- */
    var prob = h('section', { 'class': 'sim-problems', 'aria-labelledby': 'sim-prob-h' }, codeBox);
    var ph = h('h3', { 'class': 'sim-h3', id: 'sim-prob-h' }, prob, AR.probTitle);
    var pCount = h('span', { 'class': 'sim-count' }, ph);
    var pEmpty = h('p', { 'class': 'sim-muted' }, prob, AR.probEmpty);
    var pList = h('ul', { 'class': 'sim-prob-list' }, prob);
    var lastKey = '';
    ui.setProblems = function (list) {
      var key = list.map(function (m) { return m.code + '|' + m.msg_ar + '|' + (m.line || ''); }).join('\n');
      if (key === lastKey) return;
      lastKey = key;
      clear(pList);
      pEmpty.hidden = list.length > 0;
      pCount.textContent = list.length ? ' (' + list.length + ')' : '';
      list.forEach(function (m) {
        var li = h('li', null, pList);
        var b = h('button', { type: 'button', 'class': 'sim-prob', 'data-sev': m.sev, 'data-code': m.code }, li);
        h('span', { 'class': 'sim-sev', 'aria-hidden': 'true' }, b, SEV_ICON[m.sev] || 'i');
        var tx = h('span', { 'class': 'sim-prob-t' }, b);
        h('b', null, tx, (AR.sev[m.sev] || '') + (m.line ? ' · ' + fill(AR.line, { n: m.line }) : '') + ': ');
        h('span', null, tx, m.msg_ar || m.code);
        b.addEventListener('click', function () { app.problemClick(m); });
      });
    };

    /* ---------- stages + real board ---------- */
    var steps = h('ol', { 'class': 'rsteps sim-stages', 'aria-label': AR.stage1 + ' / ' + AR.stage2 }, codeBox);
    function stepLi(n, name) {
      var li = h('li', { 'class': 'rstep', 'data-s': n === 1 ? 'idle' : 'locked', id: 'sim-stage-' + n }, steps);
      h('span', { 'class': 'rstep-n', 'aria-hidden': 'true' }, li, String(n));
      var body = h('div', { 'class': 'rstep-body' }, li);
      h('b', null, body, name);
      var t = h('span', { 'class': 'rstep-t', role: 'status' }, body, n === 1 ? AR.stageIdle : NS.IO && NS.IO.Real ? NS.IO.Real.AR.locked : '');
      return { li: li, t: t, body: body };
    }
    var st1 = stepLi(1, AR.stage1), st2 = stepLi(2, AR.stage2);
    var realB = btn('run-btn run-real', AR.runReal, st2.body, 'play', { hidden: true, 'data-act': 'run-real' });
    var realStop = btn('seg-btn', AR.stopReal, st2.body, 'stop', { hidden: true, 'data-act': 'stop-real' });
    realB.addEventListener('click', function () { app.runReal(); });
    realStop.addEventListener('click', function () { app.stopReal(); });
    ui.setStage = function (n, s, text) { var x = n === 1 ? st1 : st2; x.li.setAttribute('data-s', s); if (x.t.textContent !== text) x.t.textContent = text; };
    ui.setRealButtons = function (canRun, running) { realB.hidden = !canRun || running; realStop.hidden = !running; };

    var hw = h('section', { 'class': 'hw sim-hw', 'aria-labelledby': 'sim-hw-h' }, codeBox);
    var hwHead = h('div', { 'class': 'hw-head' }, hw);
    var hwH = h('h3', { 'class': 'hw-h', id: 'sim-hw-h' }, hwHead, AR.hwTitle + ' ');
    h('span', { 'class': 'hw-opt' }, hwH, AR.hwOpt);
    var chip = h('span', { 'class': 'hw-chip', 'data-s': 'off', role: 'status' }, hwHead, 'مفيش جهاز متوصّل');
    var hwNote = h('p', { 'class': 'hw-note', hidden: true }, hw);
    hwNote.appendChild(doc.createTextNode('المتصفح ده ما بيدعمش التوصيل بالـUSB. جرّبوا Chrome أو Edge على الكمبيوتر. المحاكي شغال عادي.'));
    var hwRow = h('div', { 'class': 'hw-row' }, hw);
    var conB = btn('seg-btn hw-btn', 'وصّلوا جهازكم', hwRow, null, { 'data-act': 'connect' });
    conB.addEventListener('click', function () { app.connect(); });
    var bl = h('label', { 'class': 'hw-baud' }, hwRow); h('span', null, bl, AR.baud);
    var hwBaud = h('select', { dir: 'ltr', 'class': 'sim-hw-baud' }, bl);
    ['9600', '57600', '115200'].forEach(function (v) { var o = h('option', { value: v }, hwBaud, v); if (v === '115200') o.selected = true; });
    var how = h('details', { 'class': 'hw-how' }, hw);
    h('summary', null, how, 'أول مرة؟ ارفعوا كود الجسر على الكارت');
    var ol = h('ol', null, how);
    h('li', null, ol, 'المتصفح ما بيرفعش كود على الكارت. الكود بيشتغل في المتصفح، والكارت بينفّذ أوامر الأطراف بس (البروتوكول v2)، فالكارت محتاج كود الجسر مرة واحدة.');
    var li2 = h('li', null, ol);
    var a = h('a', { 'class': 'hw-dl', href: 'assets/firmware/beedak-lab-bridge/beedak-lab-bridge.ino', download: 'beedak-lab-bridge.ino' }, li2, 'نزّلوا ');
    ltr('beedak-lab-bridge.ino', a);
    li2.appendChild(doc.createTextNode(' (نسخة v2) وافتحوه في Arduino IDE.'));
    h('li', null, ol, 'اختاروا الكارت والبورت ودوسوا Upload. لو ESP32، لازم حزمة esp32 تكون متسطّبة في Arduino IDE.');
    h('li', null, ol, 'اقفلوا الـSerial Monitor بتاع Arduino IDE علشان البورت يفضى، وارجعوا هنا ودوسوا «وصّلوا جهازكم» على سرعة 115200.');
    ui.hwBaud = function () { return +hwBaud.value || 115200; };
    ui.setHw = function (o) {     // { available, state: off|busy|on|err, text, connected }
      hwNote.hidden = o.available !== false; hwRow.hidden = o.available === false;
      chip.setAttribute('data-s', o.state || 'off'); chip.textContent = o.text || '';
      conB.querySelector('.sim-bl').textContent = o.connected ? 'افصلوا الجهاز' : 'وصّلوا جهازكم';  // first: NEW COPY
      conB.disabled = !!o.busy;
    };

    /* ---------- serial monitor ---------- */
    var sv = h('div', { 'class': 'serial sim-serial' }, serialBox);
    var sbar = h('div', { 'class': 'sim-serial-bar' }, sv);
    h('h3', { 'class': 'sim-h3', id: 'sim-serial-h' }, sbar, AR.serialTitle);
    var sbL = h('label', { 'class': 'sim-field sim-inline' }, sbar); h('span', null, sbL, AR.baud);
    var sBaud = h('select', { 'class': 'sim-select', dir: 'ltr', 'data-act': 'monitor-baud' }, sbL);
    ['9600', '19200', '38400', '57600', '115200'].forEach(function (v) { h('option', { value: v }, sBaud, v); });
    sBaud.addEventListener('change', function () { app.setMonitorBaud(+sBaud.value); });
    var sOut = h('ol', { 'class': 'serial-out sim-serial-out', role: 'log', 'aria-live': 'off', 'aria-label': AR.serialTitle, tabindex: '0' }, sv);
    var sHint = h('p', { 'class': 'sim-baud-hint', hidden: true }, serialBox);
    var sRow = h('form', { 'class': 'sim-serial-in' }, serialBox);
    var sIn2 = h('input', { type: 'text', 'class': 'sim-input', dir: 'ltr', placeholder: AR.serialPh, 'aria-label': AR.serialPh, autocomplete: 'off', maxlength: '256' }, sRow);
    var le = h('select', { 'class': 'sim-select', 'aria-label': 'نهاية السطر' }, sRow);  // aria: NEW COPY
    AR.lineEndings.forEach(function (o) { h('option', { value: o.v }, le, o.t); });
    le.addEventListener('change', function () { app.setLineEnding(le.value); });
    btn('run-btn', AR.send, sRow, null, { type: 'submit' });
    sRow.addEventListener('submit', function (e) { e.preventDefault(); app.serialSend(sIn2.value); sIn2.value = ''; });
    var sTools = h('div', { 'class': 'sim-acts' }, serialBox);
    btn('seg-btn', AR.clearSerial, sTools, null, { 'data-act': 'serial-clear' }).addEventListener('click', function () { clear(sOut); cur = null; });
    var asL = h('label', { 'class': 'check-row' }, sTools), asC = h('input', { type: 'checkbox', checked: true }, asL); h('span', null, asL, AR.autoscroll);
    btn('seg-btn', AR.readLast, sTools, null, { 'data-act': 'serial-last' }).addEventListener('click', function () {
      var l = sOut.lastChild; ui.say(l ? l.textContent : AR.probEmpty);
    });
    var cur = null;
    ui.setMonitor = function (baud, ending) { sBaud.value = String(baud); if (ending) le.value = ending; };
    ui.lineEnding = function () { return le.value; };
    ui.baudHint = function (text) { sHint.hidden = !text; sHint.textContent = text || ''; };
    /** append text to the monitor; kind: '' (sketch) | 'sys' | 'dev' | 'err' | 'garble' */
    ui.serialWrite = function (text, kind) {
      var parts = String(text).replace(/\r/g, '').split('\n');
      parts.forEach(function (p, i) {
        if (i > 0) cur = null;
        if (p === '' && i < parts.length - 1 && cur) return;
        if (!cur || cur.getAttribute('data-k') !== (kind || '')) {
          if (p === '' && i === parts.length - 1) return;
          cur = h('li', { 'class': 'sl' + (kind ? ' sl-' + kind : ''), 'data-k': kind || '' }, sOut);
        }
        if (p) cur.textContent += p;
        if (kind === 'garble' && cur.textContent.length > 64) cur = null;
      });
      while (sOut.childNodes.length > 1000) sOut.removeChild(sOut.firstChild);
      if (asC.checked) sOut.scrollTop = sOut.scrollHeight;
    };
    ui.serialLine = function (text, kind) { cur = null; ui.serialWrite(text + '\n', kind); cur = null; };
    ui.serialClear = function () { clear(sOut); cur = null; };
    ui.serialText = function () { return Array.prototype.map.call(sOut.childNodes, function (l) { return l.textContent; }).join('\n'); };

    /* ---------- mobile tab bar ---------- */
    var tabbar = h('nav', { 'class': 'sim-tabbar', 'aria-label': AR.tabsLabel }, rootEl);
    var tabBtns = {};
    ['bench', 'parts', 'code', 'serial'].forEach(function (t) {
      var b = btn('sim-tab', AR.tabs[t], tabbar, t, { 'data-tab': t, 'aria-pressed': t === 'bench' ? 'true' : 'false' });
      tabBtns[t] = b;
      b.addEventListener('click', function () { ui.setTab(t); });
    });
    var tabRun = btn('run-btn sim-tab-run', AR.run, tabbar, 'play', { 'data-act': 'tab-run' });
    tabRun.addEventListener('click', function () { if (rootEl.getAttribute('data-run') === 'sim') app.stop(); else app.run(); });
    ui.setTab = function (t) {
      closeSheet();
      rootEl.setAttribute('data-tab', t);
      for (var k in tabBtns) tabBtns[k].setAttribute('aria-pressed', k === t ? 'true' : 'false');
      if (t === 'bench' && app.benchShown) app.benchShown();
    };
    // hide the tab bar while the on-screen keyboard is open (§10.3)
    if (root.visualViewport) {
      var vv = root.visualViewport, base = vv.height;
      vv.addEventListener('resize', function () { if (vv.height > base) base = vv.height; tabbar.classList.toggle('is-kb', vv.height < base * 0.75); });
    }

    /* ---------- dialogs ---------- */
    ui.confirm = function (o) {      // { title?, body, rows?, ok, cancel } -> Promise<bool>
      return new Promise(function (resolve) {
        var d = h('dialog', { 'class': 'sim-dialog sim-confirm', 'aria-labelledby': 'sim-cf-h' }, doc.body);
        var prev = doc.activeElement;
        if (o.title) h('h2', { 'class': 'sim-dialog-title', id: 'sim-cf-h' }, d, o.title);
        h('p', { id: o.title ? null : 'sim-cf-h' }, d, o.body);
        if (o.rows && o.rows.length) { var ul = h('ul', { 'class': 'sim-rows', dir: 'rtl' }, d); o.rows.forEach(function (r) { h('li', null, ul, r); }); }
        var acts = h('div', { 'class': 'sim-acts' }, d);
        var ok = btn('run-btn', o.ok, acts, null, { 'data-act': 'confirm-ok' });
        var no = btn('seg-btn', o.cancel || AR.no, acts, null, { 'data-act': 'confirm-no' });
        var done = false;
        function fin(v) { if (done) return; done = true; try { d.close(); } catch (e) { /* ignore */ } if (d.parentNode) d.parentNode.removeChild(d); if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* gone */ } } resolve(v); }
        ok.addEventListener('click', function () { fin(true); });
        no.addEventListener('click', function () { fin(false); });
        d.addEventListener('cancel', function (e) { e.preventDefault(); fin(false); });
        if (d.showModal) d.showModal(); else d.setAttribute('open', '');
        ok.focus();
      });
    };
    ui.pickBoardDialog = function () {
      return new Promise(function (resolve) {
        var d = h('dialog', { 'class': 'sim-dialog sim-pick-dlg', 'aria-labelledby': 'sim-pd-h' }, doc.body);
        var prev = doc.activeElement, done = false;
        function fin(v) { if (done) return; done = true; try { d.close(); } catch (e) { /* ignore */ } if (d.parentNode) d.parentNode.removeChild(d); if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* gone */ } } resolve(v); }
        pickerCards(d, function (t) { fin(t); });
        var h2 = d.querySelector('.sim-pick-h'); if (h2) h2.id = 'sim-pd-h';
        btn('seg-btn', AR.no, h('div', { 'class': 'sim-acts' }, d)).addEventListener('click', function () { fin(null); });
        d.addEventListener('cancel', function (e) { e.preventDefault(); fin(null); });
        if (d.showModal) d.showModal(); else d.setAttribute('open', '');
        var f = d.querySelector('.sim-pick-card'); if (f) f.focus();
      });
    };

    ui.showPicker(true);
    return ui;
  }

  NS.UI = { build: build, AR: AR, fill: fill };
})(typeof window !== 'undefined' ? window : globalThis);
