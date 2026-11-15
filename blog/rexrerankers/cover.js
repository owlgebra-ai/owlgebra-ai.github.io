/* RexRerankers post, cover artwork: the line-up.

   One bar per candidate product, standing on a baseline; rank runs left to right, and a bar's height
   and ink are its relevance to the query. The page carries a finished static scene and its layout in
   data-layout. This script takes the scene over: the pointer's x scrubs from the first-stage order
   (left edge) to the reranked one (right edge), each out-of-place bar travelling left over the others
   on a low arc, and a click asks a new query. Nothing moves at rest. No libraries, no network. */
(function () {
  'use strict';

  var FALL_MS = 480;           // bars dropping into a new query's first-stage order
  var STAGGER_MS = 140;        // spread of that drop across the line
  var SCRUB_MS = 900;          // the sort playing back to where the reader left it
  var RETURN_MS = 650;         // easing back to the rest position
  var RETURN_AFTER_MS = 1500;  // quiet time before it does
  var FOLLOW_MS = 90;          // how closely the sort trails the pointer
  var REST = 0.35;             // the rest position, as a share of the sort
  var LABEL = 'Interactive artwork of a reranker sorting candidate products by relevance: move the ' +
    'pointer across it or use the left and right arrow keys to scrub from the first-stage order to the ' +
    'reranked one, Home and End to jump to either, click or press Enter or Space for a new query, and ' +
    'press Escape to reset.';

  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(motion && motion.matches); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function inOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function r1(v) { return Math.round(v * 10) / 10; }

  function mulberry32(a) {
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, a | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* One query: a relevance per bar, the first stage's order, and the moves of an insertion sort
     that turns it into the reranked order. The sort works through the first-stage list from the
     front, so the strong products the first stage buried deep are the last to fly forward. */
  function makeScene(L, seed) {
    var n = L.n, rnd = mulberry32(seed), rel = [], rough = [], i, j, k;
    for (i = 0; i < n; i++) {
      var u = rnd();
      var r = i < L.S ? 0.80 + 0.20 * u : i < L.S + L.M ? 0.38 + 0.34 * u : 0.04 + 0.24 * u;
      rel.push(Math.round(r * 1000) / 1000);
    }
    for (i = 0; i < n; i++) rough.push(rel[i] + 0.16 * (2 * rnd() - 1));
    for (k = 0; k < L.P1; k++) rough[k] = 0.22 - 0.05 * k;          // a strong product retrieved deep
    for (k = 0; k < L.P2; k++) rough[n - 1 - k] = 0.84 - 0.07 * k;  // a weak product retrieved near the top
    var perm = [];
    for (i = 0; i < n; i++) perm.push(i);
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(rnd() * (i + 1));
      k = perm[i]; perm[i] = perm[j]; perm[j] = k;
    }
    var R = [], G = [];
    for (i = 0; i < n; i++) { R[perm[i]] = rel[i]; G[perm[i]] = rough[i]; }
    var first = [];
    for (i = 0; i < n; i++) first.push(i);
    first.sort(function (a, b) { return G[b] - G[a] || a - b; });
    function before(a, b) { return R[a] > R[b] || (R[a] === R[b] && a < b); }
    var arr = first.slice(), moves = [], after = [slotsOf(arr)];
    for (j = 1; j < n; j++) {
      var x = arr[j];
      i = j;
      while (i > 0 && before(x, arr[i - 1])) i--;
      if (i < j) {
        moves.push([x, j, i]);
        arr.splice(j, 1);
        arr.splice(i, 0, x);
        after.push(slotsOf(arr));
      }
    }
    var w = moves.map(function (m) { return 1 + 0.12 * (m[1] - m[2]); });
    var tot = w.reduce(function (s, v) { return s + v; }, 0), P = [0];
    w.forEach(function (v) { P.push(P[P.length - 1] + v / tot); });
    P[P.length - 1] = 1;
    var rest = 0;
    for (k = 1; k < P.length; k++) if (Math.abs(P[k] - REST) < Math.abs(P[rest] - REST)) rest = k;
    var top = {};
    arr.slice(0, L.top).forEach(function (it) { top[it] = true; });
    return { rel: R, first: first, moves: moves, after: after, P: P, rest: rest, restP: P[rest], top: top };
  }

  function slotsOf(arr) {
    var s = [];
    arr.forEach(function (it, k) { s[it] = k; });
    return s;
  }

  // Where every bar is at a point p of the sort: a fractional slot and a lift off the baseline.
  function layoutAt(sc, L, p, out) {
    var n = L.n, K = sc.moves.length, i;
    out.mover = -1;
    if (!K) {
      for (i = 0; i < n; i++) { out.x[i] = sc.after[0][i]; out.lift[i] = 0; }
      return out;
    }
    var m = 0;
    while (m < K - 1 && sc.P[m + 1] <= p) m++;
    var u = clamp((p - sc.P[m]) / (sc.P[m + 1] - sc.P[m]), 0, 1);
    var base = sc.after[m];
    for (i = 0; i < n; i++) { out.x[i] = base[i]; out.lift[i] = 0; }
    if (u <= 0) return out;
    var mv = sc.moves[m], it = mv[0], a = mv[1], b = mv[2], d = a - b, e = smooth(u), D = d * e;
    for (i = 0; i < n; i++) {
      var s = base[i];
      // the bars it passes step right, each as the mover goes over it
      if (i !== it && s >= b && s < a) out.x[i] = s + smooth(clamp(D - (a - s - 1), 0, 1));
    }
    out.x[it] = a - D;
    out.lift[it] = Math.min(L.arc[2], L.arc[0] + L.arc[1] * d) * Math.sin(Math.PI * e);
    if (u < 1) out.mover = it;
    return out;
  }

  function Cover(svg, host) {
    var L;
    try { L = JSON.parse(svg.getAttribute('data-layout')); } catch (e) { return; }
    var n = L.n;
    var group = svg.querySelector('.ln-bars');
    var countEl = svg.querySelector('.cv-count');
    var found = svg.querySelectorAll('.ln-b');
    if (!group || found.length !== n) return;
    var els = [], i;
    for (i = 0; i < n; i++) els[+found[i].getAttribute('data-i')] = found[i];
    for (i = 0; i < n; i++) if (!els[i]) return;

    var pitch = (L.x1 - L.x0) / n, bw = pitch * L.bw;
    var scene0 = makeScene(L, L.seed);
    if (scene0.rest !== L.rest) return;  // the page and the script disagree: leave the static scene

    var st = {
      q: 0, sc: scene0, p: scene0.restP, target: scene0.restP,
      tween: null, fall: null, steered: false,
      inside: false, focused: false, keyboard: false, down: null,
      visible: true, frame: 0, timer: 0, last: now(), top: -1, drawn: null,
      lay: { x: [], lift: [], mover: -1 },
      item: []   // which product of the current query each bar stands for
    };
    for (i = 0; i < n; i++) st.item[i] = i;
    // what the page shows now, read from the static scene so the first draw writes nothing
    var shown = { x: [], y: [], h: [], fill: [], count: countEl ? countEl.textContent : '' };
    for (i = 0; i < n; i++) {
      shown.x[i] = els[i].getAttribute('x'); shown.y[i] = els[i].getAttribute('y');
      shown.h[i] = els[i].getAttribute('height'); shown.fill[i] = els[i].getAttribute('fill');
    }

    function height(r) { return L.hmax * (0.06 + 0.94 * r); }
    function grey(r) { return Math.floor(214 - 204 * Math.pow(r, 1.1) + 0.5); }
    function hex(v) {
      var s = clamp(Math.round(v), 0, 255).toString(16);
      if (s.length < 2) s = '0' + s;
      return '#' + s + s + s;
    }

    // the bars as drawn: slot, lift, height, grey
    function current() {
      layoutAt(st.sc, L, st.p, st.lay);
      var c = { x: [], lift: [], h: [], g: [], mover: -1 };
      for (var i = 0; i < n; i++) {
        var it = st.item[i], r = st.sc.rel[it];
        c.x[i] = st.lay.x[it]; c.lift[i] = st.lay.lift[it]; c.h[i] = height(r); c.g[i] = grey(r);
        if (it === st.lay.mover) c.mover = i;
      }
      if (st.fall) {
        var f = st.fall, t = now(), any = false;
        for (i = 0; i < n; i++) {
          var k = clamp((t - f.start - f.delay[i]) / FALL_MS, 0, 1), e = inOut(k);
          if (k < 1) any = true;
          c.x[i] = f.x[i] + (c.x[i] - f.x[i]) * e;
          c.lift[i] = f.lift[i] * (1 - e);
          c.h[i] = f.h[i] + (c.h[i] - f.h[i]) * e;
          c.g[i] = f.g[i] + (c.g[i] - f.g[i]) * e;
        }
        c.mover = -1;
        if (!any) st.fall = null;
      }
      return c;
    }

    function draw() {
      var c = current();
      st.drawn = c;
      var inTop = 0;
      for (var i = 0; i < n; i++) {
        var x = String(r1(L.x0 + pitch * (c.x[i] + 0.5) - bw / 2));
        var y = String(r1(L.base - c.h[i] - c.lift[i]));
        var h = String(r1(c.h[i]));
        var fill = hex(c.g[i]);
        if (shown.x[i] !== x) { els[i].setAttribute('x', x); shown.x[i] = x; }
        if (shown.y[i] !== y) { els[i].setAttribute('y', y); shown.y[i] = y; }
        if (shown.h[i] !== h) { els[i].setAttribute('height', h); shown.h[i] = h; }
        if (shown.fill[i] !== fill) { els[i].setAttribute('fill', fill); shown.fill[i] = fill; }
        if (st.sc.top[st.item[i]] && Math.round(c.x[i]) < L.top) inTop++;
      }
      // the bar in flight is drawn over the ones it passes
      if (c.mover >= 0 && c.mover !== st.top) { group.appendChild(els[c.mover]); st.top = c.mover; }
      if (countEl) {
        var text = inTop + ' of the top ' + L.top + ' in place';
        if (shown.count !== text) { countEl.textContent = text; shown.count = text; }
      }
    }

    /* ── the frame loop: runs only while something moves ───────── */
    function schedule() {
      if (!st.frame && st.visible && !document.hidden) st.frame = window.requestAnimationFrame(frame);
    }
    function frame() {
      st.frame = 0;
      var t = now(), dt = Math.min(64, t - st.last);
      st.last = t;
      if (st.fall) {
        st.p = 0;
      } else if (st.tween) {
        var tw = st.tween, k = clamp((t - tw.start) / tw.ms, 0, 1);
        st.p = tw.from + (tw.to - tw.from) * inOut(k);
        if (k >= 1) st.tween = null;
      } else if (st.p !== st.target) {
        st.p += (st.target - st.p) * (1 - Math.exp(-dt / FOLLOW_MS));
        if (Math.abs(st.target - st.p) < 0.0005) st.p = st.target;
      }
      var falling = !!st.fall;
      draw();
      if (falling && !st.fall) startTween(0, st.target, SCRUB_MS);  // the drop is over: sort again
      if (st.fall || st.tween || st.p !== st.target) schedule();
    }
    function startTween(from, to, ms) {
      if (reduced()) { st.tween = null; st.p = st.target = to; return; }
      st.target = to;
      st.tween = { from: from, to: to, start: now(), ms: ms };
    }
    function steerTo(p) {
      st.tween = null;
      st.target = clamp(p, 0, 1);
      if (reduced()) st.p = st.target;
    }

    /* ── queries, reset and the way back to rest ────────────────── */
    function newQuery(q) {
      var from = st.drawn || current();
      st.q = q;
      st.sc = q === 0 ? scene0 : makeScene(L, L.seed + q);
      st.tween = null;
      // each bar keeps its place in the line and takes on the product the new query puts there,
      // so the line re-inks where it stands instead of shuffling
      var order = [];
      for (var j = 0; j < n; j++) order.push(j);
      order.sort(function (a, b) { return from.x[a] - from.x[b] || a - b; });
      order.forEach(function (bar, slot) { st.item[bar] = st.sc.first[slot]; });
      var target = st.steered ? st.target : st.sc.restP;
      if (reduced()) { st.fall = null; st.p = st.target = target; return; }
      var delay = [];
      for (var i = 0; i < n; i++) delay[i] = STAGGER_MS * clamp(from.x[i] / (n - 1), 0, 1);
      st.fall = { start: now(), delay: delay, x: from.x.slice(), lift: from.lift.slice(), h: from.h.slice(), g: from.g.slice() };
      st.target = target;
      st.p = 0;
    }
    function reset() {
      clearTimeout(st.timer);
      st.steered = false;
      if (st.q !== 0) newQuery(0);
      else startTween(st.p, scene0.restP, RETURN_MS);
    }
    function settleLater() {
      clearTimeout(st.timer);
      st.timer = setTimeout(function () {
        if (st.inside || (st.focused && st.keyboard)) return;
        st.steered = false;
        if (st.fall) { st.target = st.sc.restP; return; }
        startTween(st.p, st.sc.restP, RETURN_MS);
        schedule();
      }, RETURN_AFTER_MS);
    }

    /* ── input ──────────────────────────────────────────────────── */
    function fraction(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return null;
      return ((ev.clientX - r.left) / r.width - 0.05) / 0.9;
    }
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch' && !st.down) return;
      var f = fraction(ev);
      if (f === null) return;
      clearTimeout(st.timer);
      st.inside = true; st.keyboard = false; st.steered = true;
      if (st.fall) st.target = clamp(f, 0, 1); else steerTo(f);
      schedule();
    });
    svg.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button > 0) return;
      st.down = [ev.clientX, ev.clientY];
      if (ev.pointerType === 'touch') { clearTimeout(st.timer); st.inside = true; }
    });
    svg.addEventListener('pointerup', function (ev) {
      var d = st.down;
      st.down = null;
      if (!d || Math.abs(ev.clientX - d[0]) + Math.abs(ev.clientY - d[1]) > 10) return;
      newQuery(st.q + 1);
      schedule();
    });
    function leave() {
      st.inside = false; st.down = null;
      settleLater();
    }
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('pointercancel', leave);
    svg.addEventListener('focus', function () { st.focused = true; });
    svg.addEventListener('blur', function () {
      st.focused = false;
      if (!st.inside) settleLater();
    });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      var step = L.step * (ev.shiftKey ? 4 : 1);
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        st.steered = true;
        steerTo(st.target + (k === 'ArrowLeft' ? -step : step));
      } else if (k === 'Home' || k === 'End') {
        st.steered = true;
        steerTo(k === 'Home' ? 0 : 1);
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        newQuery(st.q + 1);
      } else if (k === 'Escape') {
        reset();
      } else {
        return;
      }
      ev.preventDefault();
      clearTimeout(st.timer);
      st.keyboard = true;
      schedule();
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        st.visible = entries[entries.length - 1].isIntersecting;
        if (st.visible) schedule();
      }).observe(svg);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });

    svg.setAttribute('role', 'group');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', LABEL);
    host.classList.add('is-live');
    draw();

    /* for tests and the curious */
    svg.coverState = function () {
      return { q: st.q, p: st.p, target: st.target, rest: st.sc.restP,
               moving: !!(st.fall || st.tween || st.p !== st.target), count: shown.count };
    };
  }

  var hosts = document.querySelectorAll('.post-cover');
  for (var h = 0; h < hosts.length; h++) {
    var svgs = hosts[h].querySelectorAll('svg.ln-cover[data-layout]');
    for (var s = 0; s < svgs.length; s++) Cover(svgs[s], hosts[h]);
  }
})();
