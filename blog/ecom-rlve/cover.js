/* Ecom-RLVE post, cover artwork: a thread through a row of gates.

   The page carries a finished static scene, and its layout in data-layout. This script takes the
   scene over. A gate is a comb of pins with one gap each, and the thread gets through a gate only
   when every gap sits on its line. Only the gate in the middle responds: the pointer (or the arrow
   keys) slides its gaps, and a click (or Enter) has the gate checked. A gate that passes is
   threaded, and the row moves on so that a harder gate takes its place. No libraries and no
   network requests. */
(function () {
  'use strict';

  var FOLLOW = 0.35;        // fraction of the way a gap moves toward its target each frame
  var TIP_MS = 180;         // thread tip easing to its new resting place
  var RUN_MS = 60;          // per pin, the tip running through a gate that passed
  var SLIDE_MS = 420;       // the row moving on to the next gate
  var SHAKE_MS = 240;       // a blocking pin shaking
  var MARK_MS = 600;        // reduced motion: how long a blocking pin is drawn heavy instead
  var BREATHE_MS = 1600;    // the tip breathing while a solved gate waits to be checked
  var IDLE_AFTER_MS = 1600;
  var DRIFT = 4;            // units of idle drift on the open gaps
  var KEY_STEP = 6;
  var KEY_STEP_BIG = 18;
  var NS = 'http://www.w3.org/2000/svg';
  var LABEL = 'Interactive artwork: a thread passes a gate only when every pin’s gap is on its ' +
    'line. Move the pointer over the pins of the middle gate, or use the left and right arrow keys ' +
    'to choose a pin and up and down to move its gap. Click or press Enter or Space to check the ' +
    'gate; when it passes, a harder gate takes its place. Escape resets.';

  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(motion && motion.matches); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function num(v) { return String(Math.round(v * 100) / 100); }

  // small seeded generator, so the gates after the drawn ones are the same on every load
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Cover(svg, host) {
    var L;
    try { L = JSON.parse(svg.getAttribute('data-layout')); } catch (e) { return; }
    var scene = svg.querySelector('.gt-scene');
    var gatesEl = svg.querySelector('.gt-gates');
    var threadEl = svg.querySelector('.gt-thread');
    var aheadEl = svg.querySelector('.gt-ahead');
    var tipEl = svg.querySelector('.gt-tip');
    if (!scene || !gatesEl || !threadEl || !aheadEl || !tipEl || !L.gates) return;
    var vb = svg.viewBox.baseVal;
    var W = vb.width, H = vb.height;
    var Y = L.line, S = L.s, CAP = L.cap, TIP = L.tip;

    var caretEl = document.createElementNS(NS, 'path');
    caretEl.setAttribute('class', 'gt-caret');
    caretEl.setAttribute('d', 'M0,0l3.5,6h-7z');
    caretEl.setAttribute('display', 'none');
    scene.appendChild(caretEl);

    function nOf(k) { return L.n[Math.min(k, L.n.length - 1)]; }
    function gOf(k) { return L.g[Math.min(k, L.g.length - 1)]; }
    function clampC(v) { return Math.max(L.lo, Math.min(L.hi, v)); }
    function isAligned(c, g) { return Math.abs(c - Y) <= g / 2 - 3; }
    function lastX(gate) { return gate.x + (gate.n - 1) * S; }

    // set attributes only when they change; null removes
    var cache = typeof WeakMap === 'function' ? new WeakMap() : null;
    function set(el, name, value) {
      var c = cache && cache.get(el);
      if (!c) { c = {}; if (cache) cache.set(el, c); }
      if (c[name] === value) return;
      c[name] = value;
      if (value === null) el.removeAttribute(name); else el.setAttribute(name, value);
    }

    var st = { visible: true, inside: false, focused: false, keyboard: false, frame: 0 };

    /* ── gates ──────────────────────────────────────────────────── */
    function addGate(k, centres) {
      var n = nOf(k), g = gOf(k);
      var prev = st.gates[st.gates.length - 1];
      var x = prev ? lastX(prev) + L.sep : null;
      if (!centres) {
        // a new gate starts fully unsolved: no gap on or near the line
        centres = [];
        for (var i = 0; i < n; i++) {
          var c;
          do { c = Math.round(L.lo + st.rng() * (L.hi - L.lo)); } while (Math.abs(c - Y) <= g / 2 - 3 + 8);
          centres.push(c);
        }
      }
      var el = document.createElementNS(NS, 'g');
      el.setAttribute('class', 'gt-gate');
      var pins = [];
      for (var j = 0; j < n; j++) {
        var p = document.createElementNS(NS, 'path');
        el.appendChild(p);
        pins.push(p);
      }
      gatesEl.appendChild(el);
      var gate = { k: k, n: n, g: g, x: x, c: centres.slice(), target: centres.slice(),
                   el: el, pins: pins, op: 1, shake: null };
      st.gates.push(gate);
      return gate;
    }

    function firstOpen(gate) {
      for (var i = 0; i < gate.n; i++) if (!isAligned(gate.c[i], gate.g)) return i;
      return -1;
    }
    function restTip(gate) {
      var i = firstOpen(gate);
      return i < 0 ? lastX(gate) + S / 2 : gate.x + i * S - S / 2;
    }
    function aheadOp(gi) {
      return gi <= st.cur ? 1 : L.fade[Math.min(gi - st.cur - 1, L.fade.length - 1)];
    }

    function reset() {
      st.rng = mulberry32(L.seed || 7);
      st.gates = [];
      while (gatesEl.firstChild) gatesEl.removeChild(gatesEl.firstChild);
      for (var k = 0; k < L.gates.length; k++) addGate(k, L.gates[k]);
      // lay the drawn gates out around the one in play, which sits at "home"
      var x = L.home;
      for (var b = L.play - 1; b >= 0; b--) x -= L.sep + (st.gates[b].n - 1) * S;
      for (var i = 0; i < st.gates.length; i++) {
        st.gates[i].x = x;
        x = lastX(st.gates[i]) + L.sep;
      }
      st.cur = L.play;
      st.offset = 0;
      st.gates.forEach(function (gate, gi) { gate.op = aheadOp(gi); });
      st.tip = restTip(st.gates[st.cur]);
      st.tipTo = st.tip;
      st.tipAnim = null;
      st.anim = [];
      st.busy = false;
      st.sel = -1;
      st.mark = null;
      st.drift = 0;
      st.breathe = null;
      st.scale = 1;
      if (st.markTimer) { clearTimeout(st.markTimer); st.markTimer = 0; }
    }

    /* ── drawing ────────────────────────────────────────────────── */
    function pinPath(x, c, g) {
      var a = c - g / 2, b = c + g / 2;
      return 'M' + num(x) + ',' + num(L.top) + 'V' + num(a) +
        'M' + num(x - CAP) + ',' + num(a) + 'h' + num(2 * CAP) +
        'M' + num(x) + ',' + num(b) + 'V' + num(L.bottom) +
        'M' + num(x - CAP) + ',' + num(b) + 'h' + num(2 * CAP);
    }

    function draw(t) {
      t = t || now();
      set(scene, 'transform', st.offset ? 'translate(' + num(-st.offset) + ' 0)' : null);
      for (var gi = 0; gi < st.gates.length; gi++) {
        var gate = st.gates[gi];
        var off = gate.x - CAP - st.offset > W - 4;
        set(gate.el, 'display', off ? 'none' : null);
        set(gate.el, 'opacity', gate.op < 1 ? gate.op.toFixed(2) : null);
        for (var i = 0; i < gate.n; i++) {
          var c = gate.c[i], cls;
          if (gi < st.cur) cls = 'gt-pin gt-pin--passed';
          else if (gi > st.cur) cls = 'gt-pin gt-pin--ahead';
          else if (isAligned(c, gate.g)) cls = 'gt-pin gt-pin--set';
          else {
            cls = 'gt-pin gt-pin--open';
            if (st.drift > 0.01) c += st.drift * Math.sin(t / 1100 + i * 1.7);  // display only
          }
          if (st.mark && st.mark.gate === gate && st.mark.i === i) cls += ' is-blocking';
          var dx = 0;
          if (gate.shake && gate.shake.i === i) {
            var k = Math.min(1, (t - gate.shake.start) / SHAKE_MS);
            dx = 3 * Math.sin(k * 4 * Math.PI) * (1 - k);
            if (k >= 1) gate.shake = null;
          }
          set(gate.pins[i], 'class', cls);
          set(gate.pins[i], 'd', pinPath(gate.x + i * S, c, gate.g));
          set(gate.pins[i], 'transform', Math.abs(dx) > 0.01 ? 'translate(' + num(dx) + ' 0)' : null);
        }
      }
      set(threadEl, 'd', 'M' + num(st.offset) + ',' + num(Y) + 'H' + num(st.tip));
      set(aheadEl, 'd', 'M' + num(st.tip + TIP + 4) + ',' + num(Y) + 'H' + num(st.offset + W));
      set(tipEl, 'transform', 'translate(' + num(st.tip) + ' ' + num(Y) + ')' +
        (st.scale !== 1 ? ' scale(' + st.scale.toFixed(3) + ')' : ''));
      var cur = st.gates[st.cur];
      var showCaret = st.keyboard && st.focused && st.sel >= 0 && !st.busy;
      set(caretEl, 'display', showCaret ? null : 'none');
      if (showCaret) set(caretEl, 'transform', 'translate(' + num(cur.x + st.sel * S) + ' ' + num(L.bottom + 8) + ')');
    }

    /* ── checking a gate ────────────────────────────────────────── */
    function animate(ms, step, done) {
      if (reduced() || ms <= 0) { step(1); if (done) done(); return; }
      st.anim.push({ start: now(), ms: ms, step: step, done: done });
      schedule();
    }

    function submit() {
      if (st.busy) return;
      var gate = st.gates[st.cur];
      for (var i = 0; i < gate.n; i++) gate.c[i] = gate.target[i];
      var block = firstOpen(gate);
      st.tipAnim = null;
      st.breathe = null;
      st.scale = 1;
      if (block >= 0) fail(gate, block); else pass(gate);
      schedule();
    }

    function fail(gate, i) {
      var rest = restTip(gate);
      st.tipTo = rest;
      if (reduced()) {
        st.tip = rest;
        st.mark = { gate: gate, i: i };
        if (st.markTimer) clearTimeout(st.markTimer);
        st.markTimer = setTimeout(function () { st.markTimer = 0; st.mark = null; draw(); }, MARK_MS);
        return;
      }
      // the tip runs up against the blocking pin and settles back; the pin shakes
      var from = st.tip, touch = gate.x + i * S - TIP - 1.5;
      st.busy = true;
      gate.shake = { i: i, start: now() };
      animate(SHAKE_MS, function (k) {
        st.tip = from + (rest - from) * easeOut(k) + (touch - rest) * Math.sin(Math.PI * k);
      }, function () { st.tip = rest; st.busy = false; });
    }

    function pass(gate) {
      st.busy = true;
      var end = lastX(gate) + S / 2;
      var from = st.tip;
      var pins = Math.max(0, Math.ceil((end - from) / S));
      animate(pins * RUN_MS, function (k) { st.tip = from + (end - from) * k; }, function () {
        moveOn(gate);
      });
    }

    function moveOn(gate) {
      st.cur += 1;
      while (st.gates.length - 1 - st.cur < 3) {
        var g = addGate(st.gates[st.gates.length - 1].k + 1);
        g.op = 0;
      }
      var next = st.gates[st.cur];
      var o0 = st.offset, o1 = next.x - L.home;
      var t0 = st.tip, t1 = restTip(next);
      var c0 = gate.c.slice();
      var op0 = st.gates.map(function (g) { return g.op; });
      var op1 = st.gates.map(function (g, gi) { return aheadOp(gi); });
      if (st.sel >= 0 || st.keyboard) st.sel = 0;
      animate(SLIDE_MS, function (k) {
        var e = easeOut(k);
        st.offset = o0 + (o1 - o0) * e;
        st.tip = t0 + (t1 - t0) * e;
        for (var i = 0; i < gate.n; i++) gate.c[i] = gate.target[i] = c0[i] + (Y - c0[i]) * e;
        st.gates.forEach(function (g, gi) { g.op = op0[gi] + (op1[gi] - op0[gi]) * e; });
      }, function () {
        // drop the gates that have left the frame on the left
        var gone = 0;
        while (st.gates.length && lastX(st.gates[0]) + CAP < st.offset - 4) {
          gatesEl.removeChild(st.gates[0].el);
          st.gates.shift();
          gone++;
        }
        st.cur -= gone;
        st.tipTo = st.tip;
        st.busy = false;
        draw();
      });
    }

    /* ── the frame loop ─────────────────────────────────────────── */
    function idle(t) {
      return !reduced() && !st.busy && !st.inside && !(st.focused && st.keyboard) &&
        t - st.lastInput > IDLE_AFTER_MS;
    }

    function schedule() {
      if (!st.frame && st.visible && !document.hidden) st.frame = window.requestAnimationFrame(frame);
    }

    function frame() {
      st.frame = 0;
      var t = now();
      var busy = false;
      var rm = reduced();

      if (st.anim.length) {
        var running = st.anim;
        st.anim = [];
        running.forEach(function (a) {
          var k = rm ? 1 : Math.min(1, (t - a.start) / a.ms);
          a.step(k);
          if (k < 1) st.anim.push(a); else if (a.done) a.done();
        });
        if (st.anim.length) busy = true;
      }

      var gate = st.gates[st.cur];
      if (!st.busy) {
        // gaps follow their targets
        for (var i = 0; i < gate.n; i++) {
          var d = gate.target[i] - gate.c[i];
          if (Math.abs(d) < 0.05 || rm) gate.c[i] = gate.target[i];
          else { gate.c[i] += d * FOLLOW; busy = true; }
        }
        // the tip eases to its resting place before the first open pin
        var rest = restTip(gate);
        if (rest !== st.tipTo) {
          st.tipTo = rest;
          st.tipAnim = { from: st.tip, start: t };
        }
        if (st.tipAnim) {
          var tk = rm ? 1 : Math.min(1, (t - st.tipAnim.start) / TIP_MS);
          st.tip = st.tipAnim.from + (st.tipTo - st.tipAnim.from) * easeOut(tk);
          if (tk >= 1) st.tipAnim = null; else busy = true;
        }
        // a solved gate waiting to be checked: the tip breathes
        if (firstOpen(gate) < 0 && !st.tipAnim && !rm) {
          if (!st.breathe) st.breathe = t;
          var ph = ((t - st.breathe) % BREATHE_MS) / BREATHE_MS;
          st.scale = 1 + 0.125 * (1 - Math.cos(2 * Math.PI * ph));
          busy = true;
        } else {
          st.breathe = null;
          st.scale = 1;
        }
      }

      // idle drift on the open gaps, faded in and out
      var want = idle(t) ? DRIFT : 0;
      if (rm) st.drift = 0;
      else if (Math.abs(want - st.drift) > 0.01) { st.drift += (want - st.drift) * 0.04; busy = true; }
      else st.drift = want;
      if (st.drift > 0.01) busy = true;
      if (!rm && !want && !st.busy && !st.inside && !(st.focused && st.keyboard)) busy = true;  // waiting to go idle
      for (var g = 0; g < st.gates.length; g++) if (st.gates[g].shake) busy = true;

      draw(t);
      if (busy) schedule();
    }

    /* ── input ──────────────────────────────────────────────────── */
    function toScene(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return null;
      return [(ev.clientX - r.left) * W / r.width + st.offset, (ev.clientY - r.top) * H / r.height];
    }
    function pinAt(x) {
      var gate = st.gates[st.cur];
      var i = Math.round((x - gate.x) / S);
      if (i < 0 || i >= gate.n || Math.abs(x - (gate.x + i * S)) > S / 2) return -1;
      return i;
    }
    function touched() { st.lastInput = now(); }

    svg.addEventListener('pointerdown', function (ev) { st.pointerType = ev.pointerType; });
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var p = toScene(ev);
      if (!p) return;
      st.inside = true; st.keyboard = false; touched();
      var i = st.busy ? -1 : pinAt(p[0]);
      svg.classList.toggle('gt-grab', i >= 0);
      if (i >= 0) {
        var gate = st.gates[st.cur];
        gate.target[i] = clampC(p[1]);
        if (reduced()) gate.c[i] = gate.target[i];
      }
      schedule();
    });
    svg.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType === 'touch') return;
      st.inside = false; touched();
      svg.classList.remove('gt-grab');
      schedule();
    });
    svg.addEventListener('click', function (ev) {
      if (st.busy) return;
      var p = toScene(ev);
      if (!p) return;
      st.keyboard = false; touched();
      var i = pinAt(p[0]);
      if (i >= 0) {
        var gate = st.gates[st.cur], v = clampC(p[1]);
        if (st.pointerType === 'touch' && Math.abs(v - Y) <= Math.max(gate.g / 2 - 3, 14)) v = Y;
        gate.c[i] = gate.target[i] = v;
      }
      submit();
      draw();
    });
    svg.addEventListener('focus', function () { st.focused = true; draw(); });
    svg.addEventListener('blur', function () { st.focused = false; touched(); draw(); schedule(); });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key;
      var keys = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Enter: 1, ' ': 1, Spacebar: 1, Escape: 1, Esc: 1 };
      if (!keys[k] || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      st.keyboard = true; touched();
      if (k === 'Escape' || k === 'Esc') {
        reset();
      } else if (!st.busy) {
        var gate = st.gates[st.cur];
        var fresh = st.sel < 0;
        if (fresh) st.sel = Math.max(0, firstOpen(gate));
        if (k === 'ArrowLeft' && !fresh) st.sel = Math.max(0, st.sel - 1);
        else if (k === 'ArrowRight' && !fresh) st.sel = Math.min(gate.n - 1, st.sel + 1);
        else if (k === 'ArrowUp' || k === 'ArrowDown') {
          var step = (ev.shiftKey ? KEY_STEP_BIG : KEY_STEP) * (k === 'ArrowUp' ? -1 : 1);
          gate.target[st.sel] = clampC(gate.target[st.sel] + step);
          if (reduced()) gate.c[st.sel] = gate.target[st.sel];
        } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
          submit();
        }
      }
      draw();
      schedule();
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        st.visible = entries[entries.length - 1].isIntersecting;
        if (st.visible) schedule();
      }).observe(svg);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });
    if (motion) {
      var onMotion = function () { if (reduced()) { st.drift = 0; st.scale = 1; } draw(); schedule(); };
      if (motion.addEventListener) motion.addEventListener('change', onMotion);
      else if (motion.addListener) motion.addListener(onMotion);
    }

    reset();
    svg.setAttribute('role', 'group');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', LABEL);
    host.classList.add('is-live');
    st.lastInput = now();
    draw();
    schedule();

    /* for tests and the curious: the same operations the inputs call */
    svg.coverApi = {
      setPin: function (i, y) {
        var gate = st.gates[st.cur];
        if (st.busy || i < 0 || i >= gate.n) return;
        gate.c[i] = gate.target[i] = clampC(y);
        touched(); draw(); schedule();
      },
      submit: function () { touched(); submit(); draw(); },
      reset: function () { reset(); touched(); draw(); schedule(); },
      state: function () {
        var gate = st.gates[st.cur];
        return {
          level: gate.k, pins: gate.n, gap: gate.g, x: gate.x,
          centres: gate.c.slice(),
          aligned: gate.c.map(function (c) { return isAligned(c, gate.g); }),
          tip: st.tip, offset: st.offset, sel: st.sel, busy: st.busy,
          gates: st.gates.map(function (g) { return g.k; })
        };
      }
    };
  }

  var hosts = document.querySelectorAll('.post-cover');
  for (var h = 0; h < hosts.length; h++) {
    var svgs = hosts[h].querySelectorAll('svg.cover-svg[data-layout]');
    for (var s = 0; s < svgs.length; s++) Cover(svgs[s], hosts[h]);
  }
})();
