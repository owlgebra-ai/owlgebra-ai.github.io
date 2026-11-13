/* Ecom-RLVE post, cover artwork: a swarm of agents.

   The page carries a finished frozen frame, and its layout in data-layout. This script takes the
   frame over and lets it run. Small agents drift in loose flocks (separation, alignment,
   cohesion). Open rings are tasks: a ring that has been called is checked every tick, and when
   enough agents are inside it at once it closes into a disc with a tick, the agents that did it
   turn to ink, and a slightly harder ring appears elsewhere. The pointer (or a caret moved with
   the arrow keys) is a customer request that nearby agents turn toward; a click, a tap or Enter
   drops a new ring there. Everything except the reader's input follows from a seed. No libraries
   and no network requests. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var TICK_MS = 1000 / 60;
  var AUTO_CALL = 300;      // ticks of quiet before the swarm takes on a ring by itself
  var CLOSE_T = 18;         // a verified ring closing into a disc
  var HOLD_T = 96;          // the disc staying in view
  var FADE_T = 54;          // and fading out
  var CHUNK = 90;           // reduced motion: ticks per press
  var NUDGE = 20;           // reduced motion: ticks per pointer step or caret move
  var MAX_USER_RINGS = 3;
  var LABEL = 'Interactive artwork: a swarm of agents gathers on rings, tasks that are checked ' +
    'once enough agents arrive; move the pointer or the arrow-key caret to call agents toward it, ' +
    'click or press Enter or Space to drop a new task there, and press Escape to reset.';

  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(motion && motion.matches); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function num(v) { return String(Math.round(v * 10) / 10); }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Swarm(svg, host) {
    var L;
    try { L = JSON.parse(svg.getAttribute('data-layout')); } catch (e) { return; }
    var agentsEl = svg.querySelector('.sw-agents');
    var tasksEl = svg.querySelector('.sw-tasks');
    if (!agentsEl || !tasksEl || !L.agents) return;
    var W = L.W, H = L.H;
    var k = W >= 800 ? 1 : 0.8;                 // the narrow scene runs at a smaller scale
    var F = L.field;
    var N = L.agents.length;
    var CALM = 0.42 * k, FAST = 1.3 * k, SLOW = 0.16 * k;
    var R_SEE = 52 * k, R_SEP = 25 * k;
    var REACH = 230 * k, RING_REACH = 330 * k, MARGIN = 36 * k;
    var R_MIN = 13 * k, NEED_MAX = W >= 800 ? 9 : 7;
    var R0 = L.rings[0].r, NEED0 = L.rings[0].need;

    var x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
    var ink = new Uint8Array(N), inkEl = new Uint8Array(N), phase = new Float64Array(N);
    var drawn = new Array(N);
    var els = Array.prototype.slice.call(agentsEl.querySelectorAll('.sw-a'));
    if (els.length !== N) return;
    for (var e = 0; e < N; e++) inkEl[e] = els[e].classList.contains('is-ink') ? 1 : 0;

    // a coarse grid for the neighbour search
    var CELL = R_SEE, COLS = Math.ceil(W / CELL) + 1, ROWS = Math.ceil(H / CELL) + 1;
    var head = new Int32Array(COLS * ROWS), next = new Int32Array(N);

    var st = { visible: true, focused: false, keyboard: false, frame: 0, inside: false, acc: 0, last: 0 };
    var caretEl = document.createElementNS(NS, 'path');
    caretEl.setAttribute('class', 'sw-caret');
    caretEl.setAttribute('d', 'M-14,0h9M5,0h9M0,-14v9M0,5v9');
    caretEl.setAttribute('display', 'none');
    svg.querySelector('[clip-path]').appendChild(caretEl);

    /* ── rings ──────────────────────────────────────────────────── */
    function notchPath(r, from, to, need) {
      var d = '';
      for (var i = from; i < to; i++) {
        var t = -Math.PI / 2 + 2 * Math.PI * i / need, c = Math.cos(t), s = Math.sin(t);
        d += 'M' + num((r + 4) * c) + ',' + num((r + 4) * s) + 'L' + num((r + 8) * c) + ',' + num((r + 8) * s);
      }
      return d;
    }
    function tickPath(r) {
      var q = r * 0.42;
      return 'M' + num(-q) + ',' + num(0.05 * r) + 'L' + num(-0.25 * q) + ',' + num(0.75 * q) +
        'L' + num(1.05 * q) + ',' + num(-0.7 * q);
    }
    function setAttr(el, name, v) {
      if (v === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
      else if (el.getAttribute(name) !== v) el.setAttribute(name, v);
    }
    function makeRing(o) {
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'sw-task');
      g.setAttribute('transform', 'translate(' + num(o.x) + ' ' + num(o.y) + ')');
      var parts = ['circle', 'path', 'path', 'circle', 'path'].map(function (t) {
        var el = document.createElementNS(NS, t); g.appendChild(el); return el;
      });
      parts[0].setAttribute('class', 'sw-ring'); parts[0].setAttribute('r', num(o.r));
      parts[1].setAttribute('class', 'sw-notch sw-notch--on');
      parts[2].setAttribute('class', 'sw-notch');
      parts[3].setAttribute('class', 'sw-disc'); parts[3].setAttribute('r', num(o.r));
      parts[3].setAttribute('display', 'none');
      parts[4].setAttribute('class', 'sw-tick'); parts[4].setAttribute('d', tickPath(o.r));
      parts[4].setAttribute('display', 'none');
      tasksEl.appendChild(g);
      var ring = { x: o.x, y: o.y, r: o.r, need: o.need, user: !!o.user, called: false, count: 0,
                   done: null, g: g, ring: parts[0], on: parts[1], off: parts[2], disc: parts[3], tick: parts[4],
                   shown: -1 };
      setNotches(ring, 0);
      return ring;
    }
    function setNotches(ring, n) {
      n = Math.min(n, ring.need);
      if (ring.shown === n) return;
      ring.shown = n;
      ring.on.setAttribute('d', notchPath(ring.r, 0, n, ring.need));
      ring.off.setAttribute('d', notchPath(ring.r, n, ring.need, ring.need));
    }
    function drawRing(ring) {
      var cls = 'sw-task' + (ring.done !== null ? ' is-done' : ring.called ? ' is-called' : '');
      setAttr(ring.g, 'class', cls);
      if (ring.done === null) { setNotches(ring, ring.called ? ring.count : 0); return; }
      var age = st.tick - ring.done;
      var close = Math.min(1, age / CLOSE_T);
      setAttr(ring.ring, 'display', close >= 1 ? 'none' : null);
      setAttr(ring.disc, 'display', null);
      setAttr(ring.disc, 'r', num(ring.r * (1 - Math.pow(1 - close, 3))));
      setAttr(ring.tick, 'display', close >= 1 ? null : 'none');
      setNotches(ring, ring.need);
      var fade = age > CLOSE_T + HOLD_T ? 1 - Math.min(1, (age - CLOSE_T - HOLD_T) / FADE_T) : 1;
      setAttr(ring.g, 'opacity', fade < 1 ? fade.toFixed(2) : null);
    }

    /* ── state ──────────────────────────────────────────────────── */
    function reset(asDrawn) {
      st.rng = mulberry32(L.seed || 7);
      st.tick = 0;
      st.quiet = 0;
      st.level = 0;
      for (var i = 0; i < N; i++) {
        var a = L.agents[i];
        x[i] = a[0]; y[i] = a[1];
        vx[i] = Math.cos(a[2]) * CALM; vy[i] = Math.sin(a[2]) * CALM;
        ink[i] = asDrawn ? a[3] : 0;
        phase[i] = st.rng() * Math.PI * 2;
      }
      while (tasksEl.firstChild) tasksEl.removeChild(tasksEl.firstChild);
      st.rings = L.rings.map(function (o) {
        var ring = makeRing(o);
        if (o.done && asDrawn) ring.done = 0 - CLOSE_T;   // already closed when the page opens
        return ring;
      });
    }

    function centroid() {
      var sx = 0, sy = 0;
      for (var i = 0; i < N; i++) { sx += x[i]; sy += y[i]; }
      return [sx / N, sy / N];
    }
    function nextSize() {
      return { r: Math.max(R_MIN, R0 - 1.6 * st.level * k),
               need: Math.min(NEED_MAX, NEED0 + Math.floor(st.level / 2)) };
    }

    // a new task, a little harder each time: smaller, further from the swarm, needing more agents
    function spawnAuto() {
      var z = nextSize(), r = z.r;
      var c = centroid(), want = Math.min(0.62 * W, (150 + 26 * st.level) * k);
      var best = null, bestErr = Infinity;
      for (var t = 0; t < 14; t++) {
        var px = F[0] + r + 16 + st.rng() * (F[2] - F[0] - 2 * r - 32);
        var py = F[1] + r + 16 + st.rng() * (F[3] - F[1] - 2 * r - 32);
        var clash = st.rings.some(function (o) { return Math.hypot(o.x - px, o.y - py) < o.r + r + 40 * k; });
        var err = Math.abs(Math.hypot(px - c[0], py - c[1]) - want) + (clash ? 1e4 : 0);
        if (err < bestErr) { bestErr = err; best = [px, py]; }
      }
      st.rings.push(makeRing({ x: best[0], y: best[1], r: r, need: z.need }));
    }

    function drop(px, py) {
      px = Math.max(F[0], Math.min(F[2], px)); py = Math.max(F[1], Math.min(F[3], py));
      var users = st.rings.filter(function (o) { return o.user && o.done === null; });
      if (users.length >= MAX_USER_RINGS) removeRing(users[0]);
      var z = nextSize();
      // keep clear of the rings already there
      for (var t = 0; t < 6; t++) {
        var hit = null;
        st.rings.forEach(function (o) { if (Math.hypot(o.x - px, o.y - py) < o.r + z.r + 10 * k) hit = o; });
        if (!hit) break;
        var dx = px - hit.x, dy = py - hit.y, d = Math.hypot(dx, dy) || 1;
        if (d < 1) { dx = 0; dy = 1; d = 1; }
        var need = hit.r + z.r + 12 * k;
        px = Math.max(F[0], Math.min(F[2], hit.x + dx / d * need));
        py = Math.max(F[1], Math.min(F[3], hit.y + dy / d * need));
      }
      var ring = makeRing({ x: px, y: py, user: true, r: z.r, need: z.need });
      ring.called = true;
      st.rings.push(ring);
      st.quiet = 0;
    }

    function removeRing(ring) {
      if (ring.g.parentNode) ring.g.parentNode.removeChild(ring.g);
      st.rings.splice(st.rings.indexOf(ring), 1);
    }

    /* ── one tick of the simulation ─────────────────────────────── */
    function step(target) {
      var i, o;
      st.tick++;
      st.quiet++;
      head.fill(-1);
      for (i = 0; i < N; i++) {
        var c = Math.max(0, Math.min(COLS - 1, Math.floor(x[i] / CELL))) +
                Math.max(0, Math.min(ROWS - 1, Math.floor(y[i] / CELL))) * COLS;
        next[i] = head[c]; head[c] = i;
      }
      var open = st.rings.filter(function (q) { return q.done === null; });
      // after a quiet spell the swarm takes on the oldest open ring by itself
      if (st.quiet >= AUTO_CALL && open.length && !open.some(function (q) { return q.called; })) {
        open[0].called = true;
      }
      var called = open.filter(function (q) { return q.called; });
      // each called ring recruits only the agents nearest to it, a few more than it needs
      var recruit = new Uint8Array(N);
      called.forEach(function (q, ci) {
        q.count = 0;
        var near = [];
        for (var a = 0; a < N; a++) {
          var d = Math.hypot(x[a] - q.x, y[a] - q.y);
          if (d < RING_REACH) near.push([d, a]);
        }
        near.sort(function (p1, p2) { return p1[0] - p2[0]; });
        for (var b = 0; b < Math.min(near.length, q.need + 2); b++) recruit[near[b][1]] |= 1 << ci;
      });

      for (i = 0; i < N; i++) {
        var cx = Math.floor(x[i] / CELL), cy = Math.floor(y[i] / CELL);
        var sx = 0, sy = 0, ax = 0, ay = 0, mx = 0, my = 0, n = 0;
        for (var gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= ROWS) continue;
          for (var gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= COLS) continue;
            for (var j = head[gx + gy * COLS]; j >= 0; j = next[j]) {
              if (j === i) continue;
              var dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy;
              if (d2 > R_SEE * R_SEE) continue;
              n++; ax += vx[j]; ay += vy[j]; mx += x[j]; my += y[j];
              if (d2 < R_SEP * R_SEP && d2 > 0.01) {
                var dd = Math.sqrt(d2), push = (R_SEP - dd) / R_SEP;
                sx -= dx / dd * push; sy -= dy / dd * push;
              }
            }
          }
        }
        var fx = sx * 0.09, fy = sy * 0.09;
        if (n) {
          fx += (ax / n - vx[i]) * 0.035 + (mx / n - x[i]) * 0.0004;
          fy += (ay / n - vy[i]) * 0.035 + (my / n - y[i]) * 0.0004;
        }
        // a slow, smooth wander
        var w = phase[i] + st.tick * 0.011;
        fx += Math.cos(w) * 0.006 * k; fy += Math.sin(w * 1.3) * 0.006 * k;
        // stay inside the field, softly
        if (x[i] < F[0] + MARGIN) fx += (F[0] + MARGIN - x[i]) * 0.0016;
        if (x[i] > F[2] - MARGIN) fx -= (x[i] - F[2] + MARGIN) * 0.0016;
        if (y[i] < F[1] + MARGIN) fy += (F[1] + MARGIN - y[i]) * 0.0016;
        if (y[i] > F[3] - MARGIN) fy -= (y[i] - F[3] + MARGIN) * 0.0016;
        var seeking = false, inside = false;
        // a request: agents within reach turn toward it
        if (target) {
          var tx = target[0] - x[i], ty = target[1] - y[i], td = Math.hypot(tx, ty);
          if (td < REACH && td > 1) {
            var pull = (td > 34 * k ? 0.03 : 0.006) * k;
            fx += tx / td * pull; fy += ty / td * pull; seeking = true;
          }
        }
        // called rings draw in the agents within reach
        for (var r = 0; r < called.length; r++) {
          o = called[r];
          var ox = o.x - x[i], oy = o.y - y[i], od = Math.hypot(ox, oy);
          if (od < o.r) { inside = true; o.count++; }
          else if (recruit[i] & (1 << r)) { fx += ox / od * 0.026 * k; fy += oy / od * 0.026 * k; seeking = true; }
        }
        vx[i] += fx; vy[i] += fy;
        if (inside) { vx[i] *= 0.9; vy[i] *= 0.9; }
        var sp = Math.hypot(vx[i], vy[i]), top = seeking ? FAST : CALM, low = inside ? 0.04 : SLOW;
        if (sp > top) { vx[i] *= top / sp; vy[i] *= top / sp; }
        else if (sp < low && sp > 0) { vx[i] *= low / sp; vy[i] *= low / sp; }
      }
      for (i = 0; i < N; i++) { x[i] += vx[i]; y[i] += vy[i]; }

      // the check: enough agents inside a called ring at the same time
      called.forEach(function (q) {
        if (q.count < q.need) return;
        q.done = st.tick;
        st.level++;
        st.quiet = 0;
        for (var a = 0; a < N; a++) {
          var dx = x[a] - q.x, dy = y[a] - q.y, d = Math.hypot(dx, dy);
          if (d < q.r) {
            ink[a] = 1;
            if (d > 0.5) { vx[a] += dx / d * 0.9 * k; vy[a] += dy / d * 0.9 * k; }
          }
        }
      });
      // rings that have closed and faded make room for the next one
      st.rings.slice().forEach(function (q) {
        if (q.done !== null && st.tick - q.done > CLOSE_T + HOLD_T + FADE_T) {
          removeRing(q);
          if (!q.user) spawnAuto();
        }
      });
    }

    /* ── drawing: only what changed ─────────────────────────────── */
    function draw() {
      for (var i = 0; i < N; i++) {
        var t = 'translate(' + num(x[i]) + ' ' + num(y[i]) + ') rotate(' +
          Math.round(Math.atan2(vy[i], vx[i]) * 180 / Math.PI) + ')';
        if (t !== drawn[i]) { els[i].setAttribute('transform', t); drawn[i] = t; }
        if (ink[i] !== inkEl[i]) { els[i].classList.toggle('is-ink', !!ink[i]); inkEl[i] = ink[i]; }
      }
      st.rings.forEach(drawRing);
      var show = st.keyboard && st.focused && st.caret;
      setAttr(caretEl, 'display', show ? null : 'none');
      if (show) setAttr(caretEl, 'transform', 'translate(' + num(st.caret[0]) + ' ' + num(st.caret[1]) + ')');
    }

    function target() {
      if (st.keyboard && st.focused && st.caret) return st.caret;
      return st.inside && st.pointer ? st.pointer : null;
    }

    /* ── the frame loop (none under reduced motion) ─────────────── */
    function schedule() {
      if (!st.frame && !reduced() && st.visible && !document.hidden) st.frame = window.requestAnimationFrame(frame);
    }
    function frame() {
      st.frame = 0;
      if (!st.visible || document.hidden || reduced()) return;
      var t = now();
      st.acc += Math.min(100, t - st.last);
      st.last = t;
      var n = 0;
      while (st.acc >= TICK_MS && n < 4) { step(target()); st.acc -= TICK_MS; n++; }
      if (n === 4) st.acc = 0;
      draw();
      schedule();
    }
    function wake() { st.last = now(); st.acc = 0; schedule(); }
    function advance(ticks) {
      for (var i = 0; i < ticks; i++) step(target());
      draw();
    }

    /* ── input ──────────────────────────────────────────────────── */
    function toScene(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return null;
      return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height];
    }
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var p = toScene(ev);
      if (!p) return;
      st.pointer = p; st.inside = true; st.keyboard = false; st.quiet = 0;
      if (reduced() && now() - (st.nudged || 0) > 200) { st.nudged = now(); advance(NUDGE); }
    });
    svg.addEventListener('pointerleave', function () { st.inside = false; });
    svg.addEventListener('click', function (ev) {
      var p = toScene(ev);
      if (!p) return;
      st.keyboard = false;
      drop(p[0], p[1]);
      if (reduced()) advance(CHUNK); else draw();
    });
    svg.addEventListener('focus', function () { st.focused = true; draw(); });
    svg.addEventListener('blur', function () { st.focused = false; draw(); });
    svg.addEventListener('keydown', function (ev) {
      var key = ev.key;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      var s = (ev.shiftKey ? 72 : 24) * k;
      var dx = key === 'ArrowLeft' ? -s : key === 'ArrowRight' ? s : 0;
      var dy = key === 'ArrowUp' ? -s : key === 'ArrowDown' ? s : 0;
      var ticks;
      if (dx || dy) {
        var c = st.caret || [W / 2, H / 2];
        st.caret = [Math.max(F[0], Math.min(F[2], c[0] + dx)), Math.max(F[1], Math.min(F[3], c[1] + dy))];
        ticks = NUDGE;
      } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        st.caret = st.caret || [W / 2, H / 2];
        drop(st.caret[0], st.caret[1]);
        ticks = CHUNK;
      } else if (key === 'Escape' || key === 'Esc') {
        ev.preventDefault();
        reset(false);
        st.caret = null;
        draw();
        return;
      } else {
        return;
      }
      ev.preventDefault();
      st.keyboard = true; st.quiet = 0;
      if (reduced()) advance(ticks); else draw();
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        st.visible = entries[entries.length - 1].isIntersecting;
        if (st.visible) wake();
      }).observe(svg);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
    if (motion) {
      if (motion.addEventListener) motion.addEventListener('change', wake);
      else if (motion.addListener) motion.addListener(wake);
    }

    reset(true);
    svg.setAttribute('role', 'group');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', LABEL);
    host.classList.add('is-live');
    draw();
    wake();

    // mean distance from each agent to its nearest neighbour (for tests)
    function spacing() {
      var sum = 0;
      for (var i = 0; i < N; i++) {
        var m = Infinity;
        for (var j = 0; j < N; j++) if (j !== i) m = Math.min(m, Math.hypot(x[j] - x[i], y[j] - y[i]));
        sum += m;
      }
      return Math.round(sum / N * 10) / 10;
    }

    /* for tests and the curious: the same operations the inputs call */
    svg.coverApi = {
      advance: function (n) { advance(n || 1); },
      drop: function (px, py) { drop(px, py); draw(); },
      point: function (px, py) { st.pointer = px == null ? null : [px, py]; st.inside = px != null; },
      reset: function () { reset(false); st.caret = null; draw(); },
      state: function () {
        var inked = 0;
        for (var i = 0; i < N; i++) inked += ink[i];
        return {
          tick: st.tick, level: st.level, inked: inked, agents: N, spacing: spacing(),
          rings: st.rings.map(function (q) {
            return { x: Math.round(q.x), y: Math.round(q.y), r: Math.round(q.r * 10) / 10, need: q.need,
                     called: q.called, done: q.done !== null, user: q.user, count: q.count };
          })
        };
      }
    };
  }

  var hosts = document.querySelectorAll('.post-cover');
  for (var h = 0; h < hosts.length; h++) {
    var svgs = hosts[h].querySelectorAll('svg.cover-svg[data-layout]');
    for (var s = 0; s < svgs.length; s++) Swarm(svgs[s], hosts[h]);
  }
})();
