/* o-means post, cover artwork.

   build_post.py draws a finished static scene and stores its layout in data-layout. This script
   takes the scene over: the query point follows the pointer, only the three nearest cells are
   searched, and dropping the point nudges the ringed centroid toward it. Every fifth drop the
   cells re-form around where the centroids now are. No libraries and no network requests. */
(function () {
  'use strict';

  var DROP_STEP = 0.35;    // fraction of the way the nearest centroid moves toward a drop
  var REFORM_EVERY = 5;    // drops between two re-formings of the cells
  var DROP_MS = 240;
  var REFORM_MS = 420;
  var IDLE_AFTER_MS = 1600;
  var LABEL = 'Interactive artwork of o-means’ search: a point is compared only with the centroids ' +
    'in its three nearest cells. Move the pointer or use the arrow keys to move it, click or press ' +
    'Enter or Space to drop it, and press Escape to reset.';

  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(motion && motion.matches); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function d2(ax, ay, bx, by) { return (ax - bx) * (ax - bx) + (ay - by) * (ay - by); }

  function Cover(svg, host) {
    var L;
    try { L = JSON.parse(svg.getAttribute('data-layout')); } catch (e) { return; }
    var vb = svg.viewBox.baseVal;
    var W = vb.width, H = vb.height;
    var unit = W >= 800 ? W / 1200 : W / 400;
    var P = L.p || 3;
    var dotEls = svg.querySelectorAll('.cv-d');
    var linkEls = svg.querySelectorAll('.cv-l');
    var tickEls = svg.querySelectorAll('.cv-c');
    var winEl = svg.querySelector('.cv-win');
    var ringEl = svg.querySelector('.cv-ring');
    var qEl = svg.querySelector('.cv-q');
    var countEl = svg.querySelector('.cv-count');
    if (dotEls.length !== L.dots.length || linkEls.length < P || tickEls.length < P) return;
    var qs = L.qs || 6;
    var tick = L.tick || 4;

    var st = {};
    var awakeEl = [];  // per dot: whether its element currently carries is-awake
    for (var i = 0; i < dotEls.length; i++) awakeEl.push(dotEls[i].classList.contains('is-awake'));

    function reset() {
      st.cells = L.cells.map(function (c) { return [c[0], c[1]]; });
      st.dots = L.dots.map(function (d) { return [d[0], d[1], d[2]]; });
      st.q = [L.q[0], L.q[1]];
      st.target = null;
      st.drops = 0;
      st.anim = [];
      for (var i = 0; i < dotEls.length; i++) {
        dotEls[i].setAttribute('cx', st.dots[i][0].toFixed(1));
        dotEls[i].setAttribute('cy', st.dots[i][1].toFixed(1));
      }
    }
    reset();
    st.inside = false;
    st.keyboard = false;
    st.focused = false;
    st.lastInput = now();
    st.visible = true;
    st.t0 = now();
    st.phase = null;
    st.frame = 0;
    st.lastCount = countEl ? countEl.textContent : '';

    /* ── the search ─────────────────────────────────────────────── */
    function draw() {
      var q = st.q, cells = st.cells, dots = st.dots;
      var order = [];
      for (var j = 0; j < cells.length; j++) order.push([d2(q[0], q[1], cells[j][0], cells[j][1]), j]);
      order.sort(function (a, b) { return a[0] - b[0]; });
      var near = order.slice(0, P).map(function (o) { return o[1]; });
      var awake = {};
      near.forEach(function (j) { awake[j] = true; });
      var win = -1, best = Infinity, members = 0;
      for (var i = 0; i < dots.length; i++) {
        var on = !!awake[dots[i][2]];
        if (on) {
          members++;
          var dd = d2(q[0], q[1], dots[i][0], dots[i][1]);
          if (dd < best) { best = dd; win = i; }
        }
        if (on !== awakeEl[i]) { dotEls[i].classList.toggle('is-awake', on); awakeEl[i] = on; }
      }
      var qx = q[0].toFixed(1), qy = q[1].toFixed(1);
      near.forEach(function (j, k) {
        var cx = cells[j][0], cy = cells[j][1];
        set(linkEls[k], { x1: qx, y1: qy, x2: cx.toFixed(1), y2: cy.toFixed(1) });
        set(tickEls[k], { d: 'M' + (cx - tick).toFixed(1) + ',' + cy.toFixed(1) + 'h' + 2 * tick +
                              'M' + cx.toFixed(1) + ',' + (cy - tick).toFixed(1) + 'v' + 2 * tick });
      });
      if (win >= 0) {
        var wx = dots[win][0].toFixed(1), wy = dots[win][1].toFixed(1);
        set(winEl, { x1: qx, y1: qy, x2: wx, y2: wy });
        set(ringEl, { cx: wx, cy: wy });
      }
      set(qEl, { d: 'M' + (q[0] - qs).toFixed(1) + ',' + qy + 'h' + 2 * qs +
                    'M' + qx + ',' + (q[1] - qs).toFixed(1) + 'v' + 2 * qs });
      if (countEl) {
        var text = (cells.length + members) + ' of ' + dots.length + ' compared';
        if (text !== st.lastCount) { countEl.textContent = text; st.lastCount = text; }
      }
      st.win = win;
    }

    function set(el, attrs) {
      for (var k in attrs) if (el.getAttribute(k) !== String(attrs[k])) el.setAttribute(k, attrs[k]);
    }

    /* ── drops and re-forming ───────────────────────────────────── */
    function drop() {
      draw();
      var i = st.win;
      if (i < 0) return;
      var d = st.dots[i];
      var from = [d[0], d[1]];
      var to = [d[0] + DROP_STEP * (st.q[0] - d[0]), d[1] + DROP_STEP * (st.q[1] - d[1])];
      animate(DROP_MS, function (t) {
        d[0] = from[0] + (to[0] - from[0]) * t;
        d[1] = from[1] + (to[1] - from[1]) * t;
        dotEls[i].setAttribute('cx', d[0].toFixed(1));
        dotEls[i].setAttribute('cy', d[1].toFixed(1));
      });
      st.drops += 1;
      if (st.drops % REFORM_EVERY === 0) reform();
    }

    function reform() {
      var cells = st.cells, dots = st.dots;
      // one assignment step: each centroid is filed under its nearest cell centre
      dots.forEach(function (d) {
        var best = Infinity, bj = d[2];
        for (var j = 0; j < cells.length; j++) {
          var dd = d2(d[0], d[1], cells[j][0], cells[j][1]);
          if (dd < best) { best = dd; bj = j; }
        }
        d[2] = bj;
      });
      // one mean step: each cell centre moves to its members' mean
      var sum = cells.map(function () { return [0, 0, 0]; });
      dots.forEach(function (d) { var s = sum[d[2]]; s[0] += d[0]; s[1] += d[1]; s[2] += 1; });
      var from = cells.map(function (c) { return [c[0], c[1]]; });
      var to = cells.map(function (c, j) { return sum[j][2] ? [sum[j][0] / sum[j][2], sum[j][1] / sum[j][2]] : [c[0], c[1]]; });
      animate(REFORM_MS, function (t) {
        for (var j = 0; j < cells.length; j++) {
          cells[j][0] = from[j][0] + (to[j][0] - from[j][0]) * t;
          cells[j][1] = from[j][1] + (to[j][1] - from[j][1]) * t;
        }
      });
    }

    function animate(ms, step) {
      if (reduced()) { step(1); draw(); return; }
      st.anim.push({ start: now(), ms: ms, step: step });
      schedule();
    }

    /* ── the frame loop: animations, pointer target, idle drift ── */
    function idle() {
      return !reduced() && st.visible && !st.inside && !(st.focused && st.keyboard) &&
        now() - st.lastInput > IDLE_AFTER_MS && !document.hidden;
    }

    function schedule() {
      if (!st.frame) st.frame = window.requestAnimationFrame(frame);
    }

    function frame() {
      st.frame = 0;
      var t = now();
      var busy = false;
      st.anim = st.anim.filter(function (a) {
        var k = Math.min(1, (t - a.start) / a.ms);
        a.step(ease(k));
        return k < 1;
      });
      if (st.anim.length) busy = true;
      if (st.target) {
        st.q[0] = st.target[0]; st.q[1] = st.target[1];
        st.target = null;
      } else if (idle()) {
        // a slow Lissajous path; the query eases onto it from wherever it was left
        var s = (t - st.t0) / 1000;
        var px = W / 2 + W * 0.3 * Math.sin(s * 0.105 + 1.1);
        var py = H / 2 + H * 0.27 * Math.sin(s * 0.163 + 0.4);
        st.q[0] += (px - st.q[0]) * 0.012;
        st.q[1] += (py - st.q[1]) * 0.012;
        busy = true;
      } else if (!reduced() && !st.inside && st.visible && !(st.focused && st.keyboard) &&
                 t - st.lastInput <= IDLE_AFTER_MS) {
        busy = true;  // waiting out IDLE_AFTER_MS before drifting
      }
      draw();
      if (busy) schedule();
    }

    /* ── input ──────────────────────────────────────────────────── */
    function toSvg(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return null;
      return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height];
    }
    function clamp(p) {
      return [Math.max(0, Math.min(W, p[0])), Math.max(0, Math.min(H, p[1]))];
    }

    svg.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType !== 'touch') st.inside = true;
    });
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var p = toSvg(ev);
      if (!p) return;
      st.inside = true; st.keyboard = false; st.lastInput = now();
      st.target = p;
      schedule();
    });
    svg.addEventListener('pointerleave', function () {
      st.inside = false; st.lastInput = now();
      schedule();
    });
    svg.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button > 0) return;
      var p = toSvg(ev);
      if (!p) return;
      st.keyboard = false; st.lastInput = now();
      st.q = clamp(p); st.target = null;
      drop();
      draw();
      schedule();
    });
    svg.addEventListener('focus', function () { st.focused = true; });
    svg.addEventListener('blur', function () { st.focused = false; st.lastInput = now(); schedule(); });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key, step = (ev.shiftKey ? 60 : 20) * unit;
      var dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      var dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      if (dx || dy) {
        st.q = clamp([st.q[0] + dx, st.q[1] + dy]);
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        drop();
      } else if (k === 'Escape') {
        st.anim = [];
        reset();
      } else {
        return;
      }
      ev.preventDefault();
      st.keyboard = true; st.lastInput = now();
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
    if (motion && motion.addEventListener) motion.addEventListener('change', schedule);

    svg.setAttribute('role', 'group');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', LABEL);
    host.classList.add('is-live');
    st.lastInput = now() - IDLE_AFTER_MS + 900;  // rest for a moment on the drawn scene, then drift
    draw();
    schedule();

    /* for tests and the curious: the same operations the inputs call */
    svg.coverApi = {
      moveTo: function (x, y) { st.q = clamp([x, y]); st.lastInput = now(); draw(); },
      drop: function () { st.lastInput = now(); drop(); draw(); },
      reset: function () { st.anim = []; reset(); draw(); },
      state: function () { return { q: st.q.slice(), drops: st.drops, win: st.win }; }
    };
  }

  var hosts = document.querySelectorAll('.post-cover');
  for (var h = 0; h < hosts.length; h++) {
    var svgs = hosts[h].querySelectorAll('svg.cover-svg[data-layout]');
    for (var s = 0; s < svgs.length; s++) Cover(svgs[s], hosts[h]);
  }
})();
