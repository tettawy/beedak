/* «بإيدك» lab simulator: the simulated board = IO backend over the circuit (IO.Sim).
 * Owner: B2 (Electrical). Spec: design-system/beedak/pages/lab-sim-spec.md §5, §5.2, §8.3.
 *
 * Responsibilities: MCU pin state (mode / PORT bit / PWM / tone / servo / DAC), lazy circuit solves,
 * digital + analog reads with Schmitt thresholds and floating noise, instantaneous PWM phase for reads,
 * software-PWM averaging per frame, HC-SR04 trigger -> echo timing, DHT raw bytes, LCD over I2C (ACK rules),
 * servo pulses -> angle, interrupts (edges from controls, bounce, echo, floating noise), simulated Wi-Fi,
 * USB power / short latch / reset (button or RESET/EN wired low).
 * Node-loadable (no DOM). Callbacks that let sim-main stop or restart the runner (onPower, onReset) are queued
 * when they are discovered inside an interpreter read and delivered from frame()/setControl()/setPowered(),
 * so the runner is never stopped from inside its own step.
 */
(function (root) { 'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};
  NS.IO = NS.IO || {};

  function noop() {}
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function create(o) {
    o = o || {};
    var c = o.circuit, prof = o.profile, boardId = o.boardId;
    var onMsg = o.onMsg || noop, onPower = o.onPower || noop, onReset = o.onReset || noop;
    var Parts = NS.Parts, Circuit = NS.Circuit;
    var rnd = typeof o.random === 'function' ? o.random : Parts.mulberry32(0x5eed1);
    var avr = prof.board !== 'esp32';

    var clockFn = null, maxSeen = 0;
    var pins = {}, ints = {}, events = [], once = {}, pending = [];
    var usb = false, shortLatched = null, ctlReset = false, wiredReset = false;
    var sol = null, solVer = -1, dirty = true;
    var adcBits = prof.adcBits, intSink = null;
    var wifi = { started: false, status: 0, ip: '0.0.0.0', ssid: '' };
    var lastFrameUs = 0, txUntil = -1, rxUntil = -1;
    var trigRise = {};                                    // hcsr04 id -> time Trig went high

    function now() {
      var t = clockFn ? +clockFn() : maxSeen;
      if (!(t >= 0)) t = 0;
      if (t > maxSeen) maxSeen = t;
      return t;
    }
    function emit(code, vars, refs) { onMsg(Circuit.makeMsg(code, vars, refs)); }
    function emitOnce(key, code, vars, refs) { if (once[key]) return; once[key] = true; emit(code, vars, refs); }
    function label(g) { return Circuit.pinLabel(prof, g); }
    function gref(g) { return c.gpioRef(g) || (boardId + '.' + g); }
    function flush() { var q = pending; pending = []; q.forEach(function (f) { f(); }); }

    /* ---------------- pin state ---------------- */
    function P(g) {
      return pins[g] || (pins[g] = { mode: 0, port: 0, pwm: null, tone: null, servo: null, dacV: null,
        swLvl: 0, swHigh: 0, swEdges: 0, swLastT: lastFrameUs, fl: null, aw: null, lastRead: 0 });
    }
    function effMode(ps) {
      if (avr) return ps.mode === 1 ? 1 : (ps.port ? 2 : 0);   // AVR: PORT bit = pull-up while INPUT
      return ps.mode;
    }
    function hwPwm(ps) {
      if (ps.servo) return { duty: ps.servo.us / 20000, hz: 50 };
      if (ps.tone) return { duty: 0.5, hz: ps.tone.hz };
      return ps.pwm ? { duty: ps.pwm.duty, hz: ps.pwm.hz } : null;
    }
    function plainLevel(ps) { return ps.mode === 1 && !ps.pwm && !ps.tone && !ps.servo && ps.dacV == null ? (ps.port ? 1 : 0) : 0; }
    function isPowered() { return usb && !shortLatched; }
    function held() { return ctlReset || wiredReset; }
    function running() { return isPowered() && !held(); }

    function drive(framePwm) {
      var d = { boardId: boardId, power: isPowered(), reset: held(), pins: {} };
      Object.keys(pins).forEach(function (g) {
        var ps = pins[g], m = effMode(ps), e = { mode: m, level: ps.port ? 1 : 0, pwm: null, dacV: ps.dacV };
        if (m === 1) e.pwm = hwPwm(ps);
        if (framePwm && framePwm[g] && !e.pwm && m === 1) e.pwm = framePwm[g];
        d.pins[g] = e;
      });
      return d;
    }
    function ensureSolved() {
      if (dirty || !sol || c.version() !== solVer) {
        sol = c.solve(drive(null), now());
        solVer = c.version(); dirty = false;
        post(sol);
      }
      return sol;
    }
    /** Reacts to what a solve found: supply short (latch + power off), reset held by wiring. */
    function post(s) {
      if (!s) return;
      if (usb && !shortLatched && s.short) {
        shortLatched = Circuit.makeMsg('E_SHORT', { supply: s.short }, [boardId + '.' + s.short]);
        dirty = true;
        pending.push(function () { onPower(false, 'E_SHORT'); });
      }
      var rh = !!s.resetHeld && isPowered();
      if (rh !== wiredReset) {
        wiredReset = rh; dirty = true;
        if (rh) enterReset();
        else if (!ctlReset) pending.push(function () { onReset(); });
      }
    }
    function enterReset() {
      Object.keys(pins).forEach(function (g) { notifyServo(+g, 0); });
      pins = {}; ints = {}; dirty = true;
    }
    function touch() {
      dirty = true;
      if (Object.keys(ints).length) schedule(now(), function (t) { checkInts(t); }, 'int');
    }

    /* ---------------- events ---------------- */
    function schedule(t, fn, tag) {
      var e = { t: t, fn: fn, tag: tag || '' }, i = events.length;
      while (i > 0 && events[i - 1].t > t) i--;
      events.splice(i, 0, e);
    }
    function cancel(tag) { events = events.filter(function (e) { return e.tag !== tag; }); }

    /* ---------------- reads ---------------- */
    function phaseFn(t) {
      return function (g) {
        var ps = pins[g]; if (!ps) return false;
        var pw = hwPwm(ps); if (!pw || !(pw.hz > 0)) return !!ps.port;
        var per = 1e6 / pw.hz;
        return (t % per) < pw.duty * per;
      };
    }
    function floatBit(ps, t) {
      if (!ps.fl) ps.fl = { bit: rnd() < 0.5 ? 1 : 0, next: t + 200 + rnd() * 4800 };
      var guard = 0;
      while (ps.fl.next <= t && guard++ < 100000) { ps.fl.bit ^= 1; ps.fl.next += 200 + rnd() * 4800; }
      return ps.fl.bit;
    }
    function netVolts(g, t) {
      var s = ensureSolved(), n = c.netOfGpio(g);
      if (n < 0) return NaN;
      if (!s.gIsl[n]) return NaN;                         // cross-island: no common ground -> floating
      return s.vAt(n, phaseFn(t));
    }
    function readLevelAt(g, t, msgs) {
      var ps = P(g), v = netVolts(g, t);
      if (isNaN(v)) {
        if (msgs) emitOnce('fl' + g, 'W_FLOATING', { pin: label(g) }, [gref(g)]);
        return floatBit(ps, t);
      }
      var lvl;
      if (v >= prof.vih) lvl = 1;
      else if (v <= prof.vil) lvl = 0;
      else { lvl = ps.lastRead; if (msgs) emitOnce('ud' + g, 'H_UNDEFINED_LEVEL', { pin: label(g), v: (Math.round(v * 100) / 100).toFixed(2) }, [gref(g)]); }
      ps.lastRead = lvl;
      return lvl;
    }
    function checkInts(t) {
      Object.keys(ints).forEach(function (gs) {
        var it = ints[gs]; if (!it) return;
        var lvl = readLevelAt(+gs, t, false);
        if (lvl === it.last) return;
        var fire = it.mode === 1 || (it.mode === 3 && lvl === 1) || (it.mode === 2 && lvl === 0);
        it.last = lvl;
        if (fire && intSink) intSink(it.id);
      });
    }
    function floatIntNext() {
      var t = Infinity;
      if (!sol) return t;
      Object.keys(ints).forEach(function (gs) {
        var n = c.netOfGpio(+gs), ps = pins[gs];
        if (n >= 0 && (sol.floating[n] || !sol.gIsl[n]) && ps && ps.fl) t = Math.min(t, ps.fl.next);
      });
      return t;
    }

    /* ---------------- HC-SR04 / servo bookkeeping ---------------- */
    function sensorsOnNet(type, pinId, n) { return c.ofType(type).filter(function (i) { return c.netOfRef(i.id + '.' + pinId) === n; }); }
    function onLevelChange(g, ps, prev, t) {
      var lvl = plainLevel(ps);
      if (lvl !== ps.swLvl) {
        if (ps.swLvl) ps.swHigh += t - ps.swLastT;
        ps.swLastT = t; ps.swLvl = lvl; ps.swEdges++;
      }
      if (lvl === prev) return;
      var n = c.netOfGpio(g); if (n < 0) return;
      sensorsOnNet('hcsr04', 'Trig', n).forEach(function (inst) {
        if (lvl) { trigRise[inst.id] = t; return; }
        var r0 = trigRise[inst.id]; delete trigRise[inst.id];
        if (r0 === undefined || t - r0 < 10) return;    // Trig must be HIGH >= 10 µs
        ensureSolved();
        var st = c.state(inst.id), def = c.def(inst.id);
        var r = def.model.echo(inst, st, t);
        if (!r) return;
        schedule(r.riseUs, function () { var s2 = c.state(inst.id); if (s2) { s2.echoHigh = true; c.bump(); } }, 'echo');
        schedule(r.riseUs + r.widthUs, function () { var s2 = c.state(inst.id); if (s2) { s2.echoHigh = false; c.bump(); } }, 'echo');
      });
    }
    function notifyServo(g, us) {
      var n = c.netOfGpio(g); if (n < 0) return;
      sensorsOnNet('sg90', 'SIG', n).forEach(function (inst) { c.def(inst.id).model.servoPulse(inst, c.state(inst.id), us, now()); c.bump(); });
    }
    function resyncServos() {
      c.ofType('sg90').forEach(function (inst) {
        var n = c.netOfRef(inst.id + '.SIG'), us = 0;
        Object.keys(pins).forEach(function (g) { var ps = pins[g]; if (ps.servo && c.netOfGpio(+g) === n) us = ps.servo.us; });
        c.def(inst.id).model.servoPulse(inst, c.state(inst.id), us, now());
      });
      c.bump();
    }

    /* ---------------- LCD / DHT ---------------- */
    function lcdAck(addr) {
      if (!running()) return null;
      ensureSolved();
      var L = c.ofType('lcd1602');
      for (var i = 0; i < L.length; i++) {
        var inst = L[i], st = c.state(inst.id), m = c.def(inst.id).model;
        if (m.i2c.addr(inst) !== addr || !st.powered) continue;
        if (c.netOfRef(inst.id + '.SDA') === c.netOfGpio(prof.i2c.sda) && c.netOfRef(inst.id + '.SCL') === c.netOfGpio(prof.i2c.scl)) return inst;
      }
      return null;
    }
    function wifiOn() { return wifi.started; }
    function wifiAttempt(t) {
      var bst = c.state(boardId);
      if (bst && bst.ctl && bst.ctl.routerOff) { wifi.status = 6; schedule(t + 1e6, wifiAttempt, 'wifi'); return; }
      wifi.status = 3;
      wifi.ip = '192.168.1.' + (20 + Math.floor(rnd() * 200));
    }

    var io = {
      kind: 'sim',
      timeMode: 'virtual',
      supports: function (f) {
        if (f === 'wifi') return !!prof.hasWiFi;
        if (f === 'dac') return !!prof.hasDac;
        if (f === 'ledc') return !!prof.hasLedc;
        return ['pinMode', 'digital', 'analogRead', 'pwm', 'tone', 'pulseIn', 'interrupt', 'servo', 'i2c', 'lcd', 'dht'].indexOf(f) >= 0;
      },
      reset: function () {
        var delta = -maxSeen;
        events = events.filter(function (e) { return e.tag === 'echo'; });   // the sensor keeps its own timing
        if (delta) { events.forEach(function (e) { e.t += delta; }); c.shiftTime(delta); }
        Object.keys(trigRise).forEach(function (k) { delete trigRise[k]; });
        maxSeen = 0;
        Object.keys(pins).forEach(function (g) { if (pins[g].servo) notifyServo(+g, 0); });
        pins = {}; ints = {}; once = {}; adcBits = prof.adcBits;
        wifi = { started: false, status: 0, ip: '0.0.0.0', ssid: '' };
        lastFrameUs = 0; dirty = true;
        if (prof.board === 'esp32' && isPowered()) {         // GPIO12 strapping check at boot
          var s = c.solve(drive(null), 0), n12 = c.netOfGpio(12);
          sol = s; solVer = c.version(); dirty = false;
          if (n12 >= 0 && s.v[n12] >= 2.5) emit('W_STRAP12', {}, [gref(12)]);
        }
      },
      setClock: function (fn) { clockFn = fn; },
      setInterruptSink: function (fn) { intSink = fn; },
      nextEventUs: function () { return Math.min(events.length ? events[0].t : Infinity, c.nextEventUs(), floatIntNext()); },
      tick: function (T) {
        for (var guard = 0; guard < 200000; guard++) {
          var te = events.length ? events[0].t : Infinity, tc = c.nextEventUs(), tf = floatIntNext();
          var t = Math.min(te, tc, tf);
          if (!(t <= T)) break;
          if (te === t) { var e = events.shift(); e.fn(t); }
          else if (tc === t) c.tick(t);
          dirty = true;
          checkInts(t);
        }
      },

      pinMode: function (g, mode) {
        if (!running()) return;
        var ps = P(g), prev = plainLevel(ps), t = now();
        mode = +mode || 0;
        if (mode !== 1) { if (ps.servo) notifyServo(g, 0); ps.pwm = null; ps.tone = null; ps.servo = null; }
        if (avr) { if (mode === 0) ps.port = 0; else if (mode === 2) ps.port = 1; }
        ps.mode = mode; ps.dacV = null;
        onLevelChange(g, ps, prev, t); touch();
      },
      digitalWrite: function (g, level) {
        if (!running()) return;
        var ps = P(g), prev = plainLevel(ps), t = now(), lvl = level ? 1 : 0;
        if (ps.mode !== 1) {
          if (lvl) emitOnce('npm' + g, 'H_NO_PINMODE', { pin: label(g) }, [gref(g)]);
          ps.port = lvl;                                    // AVR: toggles the pull-up; ESP32: latched, output off
        } else { ps.pwm = null; ps.port = lvl; }          // digitalWrite turns hardware PWM off
        onLevelChange(g, ps, prev, t); touch();
      },
      digitalRead: function (g) { if (!running()) return 0; return readLevelAt(g, now(), true); },
      analogRead: function (g) {
        if (!running()) return 0;
        var max = Math.pow(2, adcBits) - 1, t = now();
        if (prof.board === 'esp32' && wifiOn() && prof.adc2Pins.indexOf(g) >= 0) { emitOnce('adc2' + g, 'W_ADC2_WIFI', { pin: label(g) }, [gref(g)]); return 0; }
        var v = netVolts(g, t), ps = P(g);
        if (isNaN(v)) {
          emitOnce('fl' + g, 'W_FLOATING', { pin: label(g) }, [gref(g)]);
          ps.aw = ps.aw == null ? 0.2 + 0.6 * rnd() : clamp(ps.aw + (rnd() - 0.5) * 0.04, 0.2, 0.8);
          return Math.round(ps.aw * max);
        }
        return clamp(Math.round(v / prof.adcRefV * max), 0, max);
      },
      setAdcBits: function (bits) { adcBits = clamp(+bits || prof.adcBits, 1, 16); },
      analogWrite: function (g, duty, bits, hz) {
        if (!running()) return;
        bits = +bits || prof.pwmBits;
        var max = Math.pow(2, bits) - 1, ps = P(g), prev = plainLevel(ps), t = now();
        duty = clamp(Math.round(+duty || 0), 0, max);
        hz = +hz || (typeof prof.pwmHz === 'object' ? prof.pwmHz[g] : prof.pwmHz) || 490;
        var capable = !avr || prof.pwmPins.indexOf(g) >= 0;
        if (avr && capable) {
          var anyServo = Object.keys(pins).some(function (k) { return pins[k].servo; });
          var anyTone = Object.keys(pins).some(function (k) { return pins[k].tone; });
          if ((anyServo && prof.servoBreaksPwm.indexOf(g) >= 0) || (anyTone && prof.toneBreaksPwm.indexOf(g) >= 0)) capable = false;
        }
        ps.mode = 1; ps.tone = null; ps.dacV = null;
        if (!capable) { ps.pwm = null; ps.port = duty >= (max + 1) / 2 ? 1 : 0; }  // core: < 128 -> LOW
        else if (duty === 0) { ps.pwm = null; ps.port = 0; }
        else if (duty === max) { ps.pwm = null; ps.port = 1; }
        else ps.pwm = { duty: duty / max, hz: hz };
        onLevelChange(g, ps, prev, t); touch();
      },
      dacWrite: function (g, value) {
        if (!running() || !prof.hasDac || (g !== 25 && g !== 26)) return;
        var ps = P(g); ps.mode = 1; ps.pwm = null; ps.tone = null;
        ps.dacV = clamp(+value || 0, 0, 255) / 255 * 3.3; touch();
      },
      tone: function (g, hz, ms) {
        if (!running()) return;
        var ps = P(g), prev = plainLevel(ps), t = now();
        ps.mode = 1; ps.pwm = null; ps.dacV = null; ps.tone = { hz: Math.max(1, +hz || 1) };
        cancel('tone' + g);
        if (+ms > 0) schedule(t + ms * 1000, function () { io.noTone(g); }, 'tone' + g);
        onLevelChange(g, ps, prev, t); touch();
      },
      noTone: function (g) {
        var ps = pins[g]; if (!ps) return;
        cancel('tone' + g);
        ps.tone = null; ps.port = 0; dirty = true;
      },
      levelAt: function (g) {
        if (!running()) return 0;
        var t = now(), n = c.netOfGpio(g);
        sensorsOnNet('hcsr04', 'Echo', n).forEach(function (inst) {
          var st = c.state(inst.id);
          if (st.powered && t - st.lastTrigUs > 60000 && t >= st.busyUntilUs) emitOnce('sr04', 'H_SR04_TRIG', {}, [inst.id]);
        });
        return readLevelAt(g, t, false);
      },
      nextEdgeUs: function (g, after) {
        var best = Infinity, n = c.netOfGpio(g), i;
        for (i = 0; i < events.length; i++) if (events[i].t > after) { best = events[i].t; break; }
        var tc = c.nextEventUs(); if (tc > after) best = Math.min(best, tc);
        Object.keys(pins).forEach(function (gs) {
          var ps = pins[gs]; if (ps.mode !== 1 || c.netOfGpio(+gs) !== n) return;
          var pw = hwPwm(ps); if (!pw || !(pw.hz > 0)) return;
          var per = 1e6 / pw.hz, base = after - (after % per), hiEnd = pw.duty * per;
          [base + hiEnd, base + per, base + per + hiEnd].forEach(function (x) { if (x > after && x < best) best = x; });
        });
        var s = sol, ps2 = pins[g];
        if (s && n >= 0 && (s.floating[n] || !s.gIsl[n]) && ps2 && ps2.fl && ps2.fl.next > after) best = Math.min(best, ps2.fl.next);
        return best;
      },
      attachInterrupt: function (g, mode, handlerId) {
        if (!running()) return;
        ints[g] = { mode: +mode, id: handlerId, last: readLevelAt(g, now(), false) };
      },
      detachInterrupt: function (g) { delete ints[g]; },
      servoAttach: function (g, minUs, maxUs) {
        if (!running()) return false;
        var ps = P(g); ps.mode = 1; ps.pwm = null; ps.tone = null; ps.dacV = null;
        ps.servo = { min: +minUs || 544, max: +maxUs || 2400, us: 1500 };   // Servo lib default pulse 1500 µs
        notifyServo(g, 1500); touch();
        return true;
      },
      servoWrite: function (g, us) {
        var ps = pins[g]; if (!ps || !ps.servo || !running()) return;
        ps.servo.us = clamp(+us || 0, ps.servo.min, ps.servo.max);
        notifyServo(g, ps.servo.us); touch();
      },
      servoDetach: function (g) {
        var ps = pins[g]; if (!ps || !ps.servo) return;
        ps.servo = null; ps.port = 0; notifyServo(g, 0); touch();
      },
      i2cProbe: function (addr) { return !!lcdAck(+addr); },
      i2cCall: function (addr, method, args) {
        var inst = lcdAck(+addr);
        if (!inst) {
          if (c.ofType('lcd1602').length && running())
            emitOnce('lcdack', 'W_LCD_NO_ACK', { addr: ('0' + (+addr).toString(16).toUpperCase()).slice(-2) }, c.ofType('lcd1602').map(function (i) { return i.id; }));
          return undefined;
        }
        var st = c.state(inst.id);
        c.def(inst.id).model.i2c.call(inst, st, method, args, now());
        if (st._dirty) { st._dirty = false; c.bump(); }
        return true;
      },
      dhtRead: function (g) {
        if (!running()) return null;
        var s = ensureSolved(), n = c.netOfGpio(g);
        if (n < 0 || !s.gIsl[n]) return null;
        var L = sensorsOnNet('dht11', 'DATA', n).concat(sensorsOnNet('dht22', 'DATA', n));
        if (L.length !== 1) return null;                 // none, or two sensors fighting on one line
        return c.def(L[0].id).model.dht(L[0], c.state(L[0].id), now());
      },
      wifiBegin: function (ssid) {
        if (!running()) return;
        cancel('wifi');
        wifi.started = true; wifi.ssid = String(ssid || '');
        if (!wifi.ssid) { wifi.status = 1; return; }
        wifi.status = 6;                                   // (model) still connecting
        schedule(now() + 2.5e6, wifiAttempt, 'wifi');      // (model) association takes 2.5 s
      },
      wifiStatus: function () { return wifi.status; },
      wifiLocalIP: function () { return wifi.status === 3 ? wifi.ip : '0.0.0.0'; },
      wifiRSSI: function () { return wifi.status === 3 ? -55 : 0; },
      wifiDisconnect: function () { cancel('wifi'); if (wifi.started) wifi.status = 6; },
      serialTraffic: function (dir) { var t = now(); if (dir === 'rx') rxUntil = t + 30000; else txUntil = t + 30000; },

      /* ---------- sim-main only ---------- */
      frame: function (nowUs) {
        var t = nowUs != null ? +nowUs : now();
        var dtF = t - lastFrameUs, framePwm = {}, anySw = false;
        Object.keys(pins).forEach(function (g) {
          var ps = pins[g];
          if (ps.swLvl) ps.swHigh += t - ps.swLastT;
          if (ps.swEdges >= 4 && dtF > 0) { framePwm[g] = { duty: clamp(ps.swHigh / dtF, 0, 1), hz: ps.swEdges / 2 / (dtF / 1e6) }; anySw = true; }
          ps.swHigh = 0; ps.swEdges = 0; ps.swLastT = t;
        });
        lastFrameUs = t;
        var r = c.advance(drive(framePwm), t);
        post(c.lastSolution());
        if (anySw) dirty = true;                           // reads must use the instantaneous level again
        var bv = r.visuals[boardId];
        if (bv) {
          if (prof.board === 'esp32') bv.wifi = !wifi.started ? 'off' : (wifi.status === 3 ? 'on' : 'connecting');
          else { bv.ledTx = t < txUntil; bv.ledRx = t < rxUntil; }
        }
        var conds = r.conds.slice();
        if (shortLatched) conds.push(shortLatched);
        flush();
        return { visuals: r.visuals, conds: conds };
      },
      pinInfo: function (ref) {
        var s = ensureSolved(), n = c.netOfRef(ref);
        var g = -1, b = c.board();
        if (b && ref.indexOf(b.id + '.') === 0) { var pid = ref.slice(b.id.length + 1); Object.keys(prof.pinIds).forEach(function (k) { if (prof.pinIds[k] === pid) g = +k; }); }
        var mode = g >= 0 && pins[g] ? effMode(pins[g]) : 0;
        var fl = n < 0 || !!s.floating[n];
        return { v: fl ? NaN : s.v[n], mode: mode, net: n, floating: fl };
      },
      setControl: function (instId, key, value) {
        var t = now();
        if (instId === boardId && key === 'reset') {
          c.setControl(instId, key, value, t);
          ctlReset = !!value; dirty = true;
          if (ctlReset) enterReset();
          else if (!wiredReset) pending.push(function () { onReset(); });
          flush();
          return;
        }
        c.setControl(instId, key, value, t);
        if (instId === boardId && key === 'routerOff' && value && wifi.status === 3) {
          wifi.status = 5; cancel('wifi'); schedule(t + 1e6, wifiAttempt, 'wifi');   // (model) link lost, keeps retrying
        }
        dirty = true;
        schedule(t, function (tt) { checkInts(tt); }, 'ctl');   // wakes a sleeping/waiting runner
        flush();
      },
      invalidate: function () { dirty = true; sol = null; resyncServos(); },
      setPowered: function (on) {
        usb = !!on;
        if (usb) shortLatched = null;
        else { wiredReset = false; }
        dirty = true;
        if (usb) ensureSolved();
        flush();
      },
      powered: function () { return isPowered(); },
      repair: function (instId) { c.repair(instId); dirty = true; },
      held: function () { return held(); }
    };
    return io;
  }

  NS.IO.Sim = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
