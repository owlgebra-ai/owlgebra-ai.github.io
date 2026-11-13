/* RexRerankers post, cover artwork: the weave.

   The page carries a finished static scene and its layout in data-layout. This script takes the
   scene over: the crossing follows the pointer, the strand nearest the pointer is followed through
   it, and a click asks a new query, which re-inks and re-weaves the same strands. Nothing moves at
   rest. No libraries and no network requests. */
(function () {
  'use strict';

  var TWEEN_MS = 520;          // a new query, or the reset
  var RETURN_MS = 420;         // the crossing easing back to the centre
  var RETURN_AFTER_MS = 1600;  // quiet time before it does
  var LABEL = 'Interactive artwork of a reranker, with strands that enter in a rough order on the ' +
    'left and leave sorted by relevance on the right: move the pointer or use the arrow keys to move ' +
    'the crossing and follow a strand, click or press Enter or Space for a new query, and press ' +
    'Escape to reset.';

  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(motion && motion.matches); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }

  function mulberry32(a) {
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, a | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // One query: a relevance per strand, the first stage's rough order, and the true order.
  function makeScene(n, seed, S, M, P) {
    var rnd = mulberry32(seed), rel = [], rough = [], i, k;
    for (i = 0; i < n; i++) {
      var u = rnd();
      var r = i < S ? 0.82 + 0.18 * u : i < S + M ? 0.38 + 0.34 * u : 0.03 + 0.25 * u;
      rel.push(Math.round(r * 1000) / 1000);
    }
    for (i = 0; i < n; i++) rough.push(rel[i] + 0.20 * (2 * rnd() - 1));
    for (k = 0; k < P; k++) {
      rough[k] = 0.16 - 0.05 * k;          // a strong product retrieved deep in the list
      rough[n - 1 - k] = 0.80 - 0.12 * k;  // a weak product retrieved near the top
    }
    return { rel: rel, left: slots(rough), right: slots(rel) };
  }

  function slots(score) {
    var idx = score.map(function (_, i) { return i; });
    idx.sort(function (a, b) { return score[b] - score[a] || a - b; });
    var slot = [];
    idx.forEach(function (i, s) { slot[i] = s; });
    return slot;
  }

  function crossings(sc) {
    var n = sc.left.length, c = 0;
    for (var i = 0; i < n; i++)
      for (var j = i + 1; j < n; j++)
        if ((sc.left[i] - sc.left[j]) * (sc.right[i] - sc.right[j]) < 0) c++;
    return c;
  }

  // Right-hand slots are spaced like the nDCG discount: room at the top, packed in the tail.
  function rightYs(n, top, bot) {
    var w = [], s = 0, k;
    for (k = 0; k < n - 1; k++) { w.push(0.75 / (Math.log(k + 2) / Math.LN2) + 0.25); s += w[k]; }
    var ys = [top];
    for (k = 0; k < n - 1; k++) ys.push(ys[k] + (bot - top) * w[k] / s);
    return ys;
  }

  function Cover(svg, host) {
    var L;
    try { L = JSON.parse(svg.getAttribute('data-layout')); } catch (e) { return; }
    var n = L.n;
    var group = svg.querySelector('.rk-strands');
    var seam = svg.querySelector('.rk-seam');
    var caps = svg.querySelector('.rk-caps');
    var countEl = svg.querySelector('.cv-count');
    var found = svg.querySelectorAll('.rk-s');
    if (!group || !seam || !caps || found.length !== n) return;

    var els = [], i;
    for (i = 0; i < n; i++) els[+found[i].getAttribute('data-i')] = found[i];
    for (i = 0; i < n; i++) if (!els[i]) return;
    var domOrder = [];
    for (i = 0; i < found.length; i++) domOrder.push(+found[i].getAttribute('data-i'));

    var gap = (L.bot - L.top) / (n - 1);
    var ry = rightYs(n, L.top, L.bot);
    var centre = L.zx;
    var scene0 = { rel: L.rel, left: L.left, right: L.right };

    var st = {
      q: 0, sc: scene0, pairs: crossings(scene0),
      cur: target(scene0),
      zx: centre, follow: -1, steered: false,
      inside: false, focused: false, keyboard: false,
      tween: null, ztween: null, pointer: null, down: null,
      visible: true, frame: 0, timer: 0
    };
    // what the page currently shows, read from the static scene so the first draw writes nothing
    var shown = { d: [], op: [], w: [], caps: caps.getAttribute('d'), seam: seam.getAttribute('x1'),
                  count: countEl ? countEl.textContent : '', steered: false, follow: false };
    for (i = 0; i < n; i++) {
      shown.d[i] = els[i].getAttribute('d');
      shown.op[i] = els[i].getAttribute('stroke-opacity');
      shown.w[i] = els[i].getAttribute('stroke-width');
    }

    function target(sc) {
      var t = { yl: [], yr: [], op: [], w: [] };
      for (var i = 0; i < n; i++) {
        var r = sc.rel[i];
        t.yl.push(L.top + sc.left[i] * gap);
        t.yr.push(ry[sc.right[i]]);
        t.op.push(0.20 + 0.80 * Math.pow(r, 1.3));
        t.w.push(0.7 + (L.wmax - 0.7) * Math.pow(r, 1.6));
      }
      return t;
    }

    /* ── drawing: only attributes that change are written ──────── */
    function draw() {
      var zx = st.zx, a = zx - L.zw / 2, b = zx + L.zw / 2, c = st.cur, f = st.follow, sc = st.sc;
      var A = r1(a), B = r1(b), Z = r1(zx);
      for (var i = 0; i < n; i++) {
        var yl = r1(c.yl[i]), yr = r1(c.yr[i]);
        var d = 'M' + L.x0 + ',' + yl + 'H' + A + 'C' + Z + ',' + yl + ' ' + Z + ',' + yr + ' ' + B + ',' + yr + 'H' + L.x1;
        var op = c.op[i], w = c.w[i];
        if (f >= 0) {
          if (i === f) { op = 1; w = Math.max(w, 2.5); }
          else if ((sc.left[i] - sc.left[f]) * (sc.right[i] - sc.right[f]) >= 0) op *= 0.3;
        }
        var ops = op.toFixed(3), ws = w.toFixed(2);
        if (shown.d[i] !== d) { els[i].setAttribute('d', d); shown.d[i] = d; }
        if (shown.op[i] !== ops) { els[i].setAttribute('stroke-opacity', ops); shown.op[i] = ops; }
        if (shown.w[i] !== ws) { els[i].setAttribute('stroke-width', ws); shown.w[i] = ws; }
      }
      if (shown.seam !== String(Z)) {
        seam.setAttribute('x1', Z); seam.setAttribute('x2', Z); shown.seam = String(Z);
      }
      if (f >= 0) {
        var cd = 'M' + (L.x0 + 0.8) + ',' + r1(c.yl[f] - 7) + 'v14M' + (L.x1 - 0.8) + ',' + r1(c.yr[f] - 7) + 'v14';
        if (shown.caps !== cd) { caps.setAttribute('d', cd); shown.caps = cd; }
      }
      if (countEl) {
        var text = f >= 0 ? (sc.left[f] + 1) + ' → ' + (sc.right[f] + 1)
                          : st.pairs + ' of ' + (n * (n - 1) / 2) + ' pairs reordered';
        if (shown.count !== text) { countEl.textContent = text; shown.count = text; }
      }
      if (shown.steered !== st.steered) { host.classList.toggle('is-steered', st.steered); shown.steered = st.steered; }
      if (shown.follow !== (f >= 0)) { host.classList.toggle('has-follow', f >= 0); shown.follow = f >= 0; }
    }

    // Heavier strands are drawn last so their ink sits on top; the followed one goes over all.
    function restack() {
      var want = [];
      for (var i = 0; i < n; i++) want.push(i);
      var rel = st.sc.rel, f = st.follow;
      want.sort(function (a, b) { return (a === f) - (b === f) || rel[a] - rel[b] || a - b; });
      var same = true;
      for (i = 0; i < n; i++) if (want[i] !== domOrder[i]) { same = false; break; }
      if (same) return;
      want.forEach(function (k) { group.appendChild(els[k]); });
      domOrder = want;
    }

    function setFollow(k) {
      if (k === st.follow) return;
      st.follow = k;
      restack();
    }

    /* ── queries, reset, the return to centre ───────────────────── */
    function sceneFor(q) {
      return q === 0 ? scene0 : makeScene(n, L.seed + q, L.s, L.m, L.p);
    }

    function retarget(q) {
      st.q = q;
      st.sc = sceneFor(q);
      st.pairs = crossings(st.sc);
      restack();
      var to = target(st.sc);
      if (reduced()) { st.cur = to; st.tween = null; return; }
      var from = { yl: st.cur.yl.slice(), yr: st.cur.yr.slice(), op: st.cur.op.slice(), w: st.cur.w.slice() };
      st.tween = { start: now(), from: from, to: to };
    }

    function moveZone(x) {
      st.ztween = null;
      st.zx = clamp(x, L.zmin, L.zmax);
    }

    function easeZoneTo(x) {
      if (reduced() || !st.visible || document.hidden) { st.ztween = null; st.zx = x; return; }
      if (Math.abs(st.zx - x) < 0.05) return;
      st.ztween = { start: now(), from: st.zx, to: x };
    }

    function nextQuery() { retarget(st.q + 1); }

    function reset() {
      clearTimeout(st.timer);
      st.steered = false;
      setFollow(-1);
      retarget(0);
      easeZoneTo(centre);
    }

    function release() {
      st.steered = false;
      setFollow(-1);
      clearTimeout(st.timer);
      st.timer = setTimeout(function () {
        if (st.inside || (st.focused && st.keyboard)) return;
        easeZoneTo(centre);
        schedule();
      }, RETURN_AFTER_MS);
    }

    /* ── frame loop: runs only while something is moving ────────── */
    function schedule() {
      if (!st.frame) st.frame = window.requestAnimationFrame(frame);
    }

    function frame() {
      st.frame = 0;
      var t = now();
      if (st.pointer) {
        var p = st.pointer;
        st.pointer = null;
        moveZone(p[0]);
        setFollow(nearest(p[0], p[1]));
      }
      if (st.tween) {
        var tw = st.tween, k = Math.min(1, (t - tw.start) / TWEEN_MS), e = ease(k);
        ['yl', 'yr', 'op', 'w'].forEach(function (key) {
          var a = tw.from[key], b = tw.to[key], out = st.cur[key];
          for (var i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * e;
        });
        if (k >= 1) st.tween = null;
      }
      if (st.ztween) {
        var z = st.ztween, kz = Math.min(1, (t - z.start) / RETURN_MS);
        st.zx = z.from + (z.to - z.from) * ease(kz);
        if (kz >= 1) st.ztween = null;
      }
      draw();
      if ((st.tween || st.ztween) && st.visible && !document.hidden) schedule();
    }

    // The strand nearest the pointer, measured vertically on the curves at the pointer's x.
    function nearest(x, y) {
      var a = st.zx - L.zw / 2, b = st.zx + L.zw / 2, h;
      if (x <= a) h = 0;
      else if (x >= b) h = 1;
      else {
        // x(t) = a + (b - a)(1.5 t(1 - t) + t^3) rises monotonically; y follows 3t^2 - 2t^3
        var lo = 0, hi = 1, u = (x - a) / (b - a);
        for (var it = 0; it < 24; it++) {
          var m = (lo + hi) / 2;
          if (1.5 * m * (1 - m) + m * m * m < u) lo = m; else hi = m;
        }
        var t = (lo + hi) / 2;
        h = 3 * t * t - 2 * t * t * t;
      }
      var best = -1, bd = Infinity, c = st.cur;
      for (var i = 0; i < n; i++) {
        var d = Math.abs(c.yl[i] + (c.yr[i] - c.yl[i]) * h - y);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    /* ── input ──────────────────────────────────────────────────── */
    var vb = svg.viewBox.baseVal;
    function toSvg(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return null;
      return [(ev.clientX - r.left) * vb.width / r.width, (ev.clientY - r.top) * vb.height / r.height];
    }

    function steer(ev) {
      var p = toSvg(ev);
      if (!p) return;
      clearTimeout(st.timer);
      st.inside = true; st.keyboard = false; st.steered = true;
      st.pointer = p;
      schedule();
    }

    svg.addEventListener('pointermove', steer);
    svg.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button > 0) return;
      st.down = [ev.clientX, ev.clientY];
      steer(ev);
    });
    svg.addEventListener('pointerup', function (ev) {
      var d = st.down;
      st.down = null;
      if (!d || Math.abs(ev.clientX - d[0]) + Math.abs(ev.clientY - d[1]) > 10) return;
      nextQuery();
      schedule();
    });
    function leave() {
      st.inside = false; st.down = null; st.pointer = null;
      release();
      schedule();
    }
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('pointercancel', leave);

    svg.addEventListener('focus', function () { st.focused = true; });
    svg.addEventListener('blur', function () {
      st.focused = false;
      if (!st.inside) { release(); schedule(); }
    });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key, step = L.step * (ev.shiftKey ? 3 : 1);
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        moveZone(st.zx + (k === 'ArrowLeft' ? -step : step));
        st.steered = true;
      } else if (k === 'Home' || k === 'End') {
        moveZone(k === 'Home' ? L.zmin : L.zmax);
        st.steered = true;
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        var left = st.sc.left, slot;
        if (st.follow < 0) slot = k === 'ArrowDown' ? 0 : n - 1;
        else slot = clamp(left[st.follow] + (k === 'ArrowDown' ? 1 : -1), 0, n - 1);
        setFollow(left.indexOf(slot));
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        nextQuery();
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
      return { q: st.q, zx: st.zx, follow: st.follow, steered: st.steered,
               moving: !!(st.tween || st.ztween), count: shown.count };
    };
  }

  var hosts = document.querySelectorAll('.post-cover');
  for (var h = 0; h < hosts.length; h++) {
    var svgs = hosts[h].querySelectorAll('svg.rk-cover[data-layout]');
    for (var s = 0; s < svgs.length; s++) Cover(svgs[s], hosts[h]);
  }
})();
