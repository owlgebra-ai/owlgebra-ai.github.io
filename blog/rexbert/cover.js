/* RexBERT post, cover artwork: "read from both sides".

   The page carries a finished static scene (a barcode of tokens, a few hollow masked spans, arcs
   from one span to the bars around it) and its layout in data-layout. This script takes the scene
   over. The pointer's x picks the token being encoded, its height sets the context window, and a
   click masks or unmasks a span. Nothing moves unless the reader does something; after a pause the
   picture settles back to its rest state. No libraries and no network requests. */
(function () {
  'use strict';

  var IDLE_AFTER_MS = 1600;  // quiet time before the focus and window return to rest
  var BACK_MS = 350;         // window easing back to rest
  var FADE_MS = 180;         // arcs cross-fading when the focus changes
  var LEVEL_MS = 240;        // fill level and mask toggles
  var NS = 'http://www.w3.org/2000/svg';
  var LABEL = 'Interactive artwork of masked language modelling: a row of bars with hollow, masked ' +
    'groups. Move the pointer or use the left and right arrow keys to choose a bar, up and down to ' +
    'widen or narrow the context it reads, click or press Enter or Space to mask or unmask a group, ' +
    'and press Escape to reset.';

  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(motion && motion.matches); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function num(s) { return s ? fmt(parseFloat(s)) : ''; }
  function fmt(v) {
    var s = v.toFixed(2).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  }

  function Cover(svg, host) {
    var L;
    try { L = JSON.parse(svg.getAttribute('data-layout')); } catch (e) { return; }
    var vb = svg.viewBox.baseVal;
    var VW = vb.width, VH = vb.height;
    var N = L.bars.length;
    var bx = [], bw = [], bc = [], cx = [];
    for (var i = 0; i < N; i++) {
      bx.push(L.bars[i][0]); bw.push(L.bars[i][1]); bc.push(L.bars[i][2]);
      cx.push(L.bars[i][0] + L.bars[i][1] / 2);
    }
    var yT = L.yTop, yB = L.yBase, yA = yT - 8, H = yB - yT;
    var W_REST = L.W[0], W_MIN = L.W[1], W_MAX = L.W[2];
    var FIRST = 2, LAST = N - 3;  // the first and last two bars are guards

    var barEls = svg.querySelectorAll('.rx-bars > rect');
    var arcsG = svg.querySelector('.rx-arcs');
    var levelsG = svg.querySelector('.rx-levels');
    var markEl = svg.querySelector('.rx-mark');
    var poolA = svg.querySelector('.rx-pool');
    if (barEls.length !== N || !arcsG || !levelsG || !markEl || !poolA) return;

    /* ── elements the static scene does not carry ─────────────── */
    var pools = [poolA, document.createElementNS(NS, 'g')];
    pools[1].setAttribute('class', 'rx-pool');
    pools[1].setAttribute('opacity', '0');
    arcsG.appendChild(pools[1]);
    var poolPaths = [Array.prototype.slice.call(poolA.querySelectorAll('path')), []];
    while (poolPaths[0].length < L.K) poolPaths[0].push(addArc(poolA));
    for (var k = 0; k < L.K; k++) poolPaths[1].push(addArc(pools[1]));
    function addArc(g) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('class', 'rx-arc');
      p.setAttribute('d', 'M0,0');
      p.style.strokeOpacity = '0';
      g.appendChild(p);
      return p;
    }
    var winEl = document.createElementNS(NS, 'path');
    winEl.setAttribute('class', 'rx-window');
    winEl.setAttribute('d', 'M0,0');
    svg.appendChild(winEl);

    var levelEls = [];
    var staticLevels = levelsG.querySelectorAll('.rx-level');
    for (i = 0; i < staticLevels.length; i++) {
      levelEls[+staticLevels[i].getAttribute('data-i')] = staticLevels[i];
    }
    function levelEl(i) {
      if (!levelEls[i]) {
        var r = document.createElementNS(NS, 'rect');
        r.setAttribute('class', 'rx-level');
        r.setAttribute('x', fmt(bx[i]));
        r.setAttribute('width', fmt(bw[i]));
        r.setAttribute('y', fmt(yB));
        r.setAttribute('height', '0');
        levelsG.appendChild(r);
        levelEls[i] = r;
      }
      return levelEls[i];
    }

    /* ── what each element currently shows, so only changes are written ── */
    var shown = { bar: [], arc: [[], []], level: [], mark: markEl.getAttribute('d'), win: 'M0,0',
                  poolOp: ['1', '0'] };
    for (i = 0; i < N; i++) {
      var el = barEls[i];
      shown.bar.push({ cls: el.getAttribute('class'), x: el.getAttribute('x'), y: el.getAttribute('y'),
                       w: el.getAttribute('width'), h: el.getAttribute('height'),
                       op: num(el.style.fillOpacity) });
    }
    for (var p = 0; p < 2; p++) {
      poolPaths[p].forEach(function (path) {
        shown.arc[p].push({ d: path.getAttribute('d'), sw: num(path.style.strokeWidth),
                            so: num(path.style.strokeOpacity) });
      });
    }

    /* ── state ─────────────────────────────────────────────────── */
    var st = {
      spans: [], born: 0, focus: 0, W: W_REST,
      ghost: [], lv: [], lt: [],
      active: 0, mix: [1, 0], mixTw: null, wTw: null, key: '',
      inside: false, px: 0, py: 0, showWin: false, keyboard: false, focused: false, armed: false,
      pointerType: 'mouse', visible: true, raf: 0, timer: 0
    };
    for (i = 0; i < N; i++) {
      st.ghost.push(false); st.lt.push(null);
      st.lv.push(levelEls[i] ? (+levelEls[i].getAttribute('height')) / H : 0);
      shown.level.push(levelEls[i] ? levelEls[i].getAttribute('height') : '0');
    }

    function restoreSpans() {
      st.spans = L.spans.map(function (s, n) { return { a: s[0], b: s[1], born: -L.spans.length + n }; });
      st.born = 0;
    }
    function restFocus() { return L.spans[L.focus][0]; }
    restoreSpans();
    st.focus = restFocus();

    function spanAt(i) {
      for (var n = 0; n < st.spans.length; n++) if (i >= st.spans[n].a && i <= st.spans[n].b) return st.spans[n];
      return null;
    }
    function maskedCount() {
      return st.spans.reduce(function (s, sp) { return s + sp.b - sp.a + 1; }, 0);
    }
    function unitOf(i) {
      var s = spanAt(i);
      return s ? [s.a, s.b] : [i, i];
    }

    /* ── the drawing for the current state ──────────────────────── */
    function compute() {
      var u = unitOf(st.focus), a = u[0], b = u[1];
      var isSpan = !!spanAt(a);
      var fx = (bx[a] + bx[b] + bw[b]) / 2, fc = bc[a], W = st.W;
      var masked = [], j;
      for (j = 0; j < N; j++) masked.push(!!spanAt(j));
      var sc = [];
      for (j = FIRST; j <= LAST; j++) {
        if (masked[j] || st.ghost[j] || (j >= a && j <= b)) continue;
        var d = Math.abs(cx[j] - fx);
        if (d > W) continue;
        sc.push({ j: j, s: Math.exp(-d / (W / 2)) + (bc[j] === fc ? 0.8 * Math.exp(-d / (1.25 * W)) : 0) });
      }
      sc.sort(function (p, q) { return q.s - p.s || p.j - q.j; });
      var top = sc.slice(0, L.K);
      var smax = top.length ? top[0].s : 1;
      var ctx = {};
      top.forEach(function (o) { ctx[o.j] = o.s / smax; });

      // which bar of the focus each arc leaves from: nearest targets to the outer bars, so arcs nest
      var src = {}, F = [];
      for (j = a; j <= b; j++) F.push(j);
      [-1, 1].forEach(function (side) {
        var t = top.filter(function (o) { return (cx[o.j] - fx) * side > 0; })
          .sort(function (p, q) { return Math.abs(cx[p.j] - fx) - Math.abs(cx[q.j] - fx); });
        var order = side < 0 ? F : F.slice().reverse();
        t.forEach(function (o, r) {
          src[o.j] = order[Math.min(F.length - 1, Math.floor(r * F.length / Math.max(1, t.length)))];
        });
      });
      var arcs = top.slice().sort(function (p, q) { return p.s - q.s || q.j - p.j; }).map(function (o) {
        var sx = cx[src[o.j]], tx = cx[o.j], t = o.s / smax;
        var rx = Math.abs(tx - sx) / 2;
        var ry = Math.min(rx, L.Hmax * (1 - Math.exp(-rx / L.R0)));
        return {
          d: 'M' + fmt(sx) + ',' + fmt(yA) + ' A' + fmt(rx) + ',' + fmt(ry) + ' 0 0 ' + (tx > sx ? 1 : 0) +
             ' ' + fmt(tx) + ',' + fmt(yA),
          sw: fmt(0.75 + 0.75 * t), so: fmt(0.25 + 0.75 * t)
        };
      });

      var conf = 0;
      if (isSpan) {
        var out = [];
        for (j = 0; j < N; j++) if (j < a || j > b) out.push(j);
        out.sort(function (p, q) { return Math.abs(cx[p] - fx) - Math.abs(cx[q] - fx) || p - q; });
        var vis = out.slice(0, 12).filter(function (j) { return !masked[j]; }).length / 12;
        conf = (0.35 + 0.6 * (W - W_MIN) / (W_MAX - W_MIN)) * vis;
      }
      var key = a + '-' + b + '|' + masked.map(function (m, j) { return m ? 'm' : st.ghost[j] ? 'g' : ''; }).join('');
      return { a: a, b: b, isSpan: isSpan, fx: fx, masked: masked, ctx: ctx, arcs: arcs, conf: conf, key: key };
    }

    function setAttr(el, cache, name, attr, v) {
      if (cache[name] !== v) { el.setAttribute(attr, v); cache[name] = v; }
    }

    // discrete: the focus or the masks changed, so levels tween and arcs cross-fade
    function draw(discrete) {
      var s = compute(), i;
      var animate = discrete && !reduced();

      // bars
      for (i = 0; i < N; i++) {
        var el = barEls[i], c = shown.bar[i];
        var hollow = s.masked[i] || st.ghost[i];
        var inF = i >= s.a && i <= s.b;
        var cls, op = '';
        if (hollow) cls = inF ? 'rx-mask is-focus' : 'rx-mask';
        else if (inF) cls = 'rx-bar is-focus';
        else if (s.ctx[i] !== undefined) { cls = 'rx-bar is-ctx'; op = fmt(0.35 + 0.65 * s.ctx[i]); }
        else cls = 'rx-bar';
        var yb = yB + (i < FIRST || i > LAST ? L.guard : 0);
        setAttr(el, c, 'cls', 'class', cls);
        if (hollow) {
          setAttr(el, c, 'x', 'x', fmt(bx[i] + 0.5)); setAttr(el, c, 'y', 'y', fmt(yT + 0.5));
          setAttr(el, c, 'w', 'width', fmt(bw[i] - 1)); setAttr(el, c, 'h', 'height', fmt(H - 1));
        } else {
          setAttr(el, c, 'x', 'x', fmt(bx[i])); setAttr(el, c, 'y', 'y', fmt(yT));
          setAttr(el, c, 'w', 'width', fmt(bw[i])); setAttr(el, c, 'h', 'height', fmt(yb - yT));
        }
        if (c.op !== op) { el.style.fillOpacity = op; c.op = op; }

        // level target: the focused span fills to its confidence; an unmasking bar fills to the top
        var target = st.ghost[i] ? 1 : (s.masked[i] && inF ? s.conf : 0);
        var tw = st.lt[i];
        if (animate && (Math.abs(st.lv[i] - target) > 1e-3 || (st.ghost[i] && !tw))) {
          st.lt[i] = { from: st.lv[i], to: target, t0: now() };
        } else if (tw && !reduced()) {
          tw.to = target;
        } else {
          st.lt[i] = null; st.lv[i] = target;
        }
      }
      paintLevels();

      // arcs: a new focus fades in on the other pool while the old one fades out
      if (s.key !== st.key) {
        if (st.key && animate) {
          st.active = 1 - st.active;
          st.mixTw = { from: st.mix.slice(), t0: now() };
        } else {
          st.mix[st.active] = 1; st.mix[1 - st.active] = 0; st.mixTw = null;
        }
        st.key = s.key;
      }
      paintArcs(st.active, s.arcs);
      paintMix();

      // focus mark
      var md = 'M' + fmt(bx[s.a]) + ',' + fmt(yB + 9) + 'H' + fmt(bx[s.b] + bw[s.b]);
      if (shown.mark !== md) { markEl.setAttribute('d', md); shown.mark = md; }

      // the context window, drawn at the pointer's height
      var wd = 'M0,0';
      if (st.showWin) {
        var y = st.keyboard ? yOfW(st.W) : Math.max(4, Math.min(VH - 4, st.py));
        var l = s.fx - st.W, r = s.fx + st.W;
        var lc = Math.max(L.x0, l), rc = Math.min(L.x1, r);
        wd = 'M' + fmt(lc) + ',' + fmt(y) + 'H' + fmt(rc);
        if (l >= L.x0) wd += 'M' + fmt(lc) + ',' + fmt(y - 4) + 'V' + fmt(y + 4);
        if (r <= L.x1) wd += 'M' + fmt(rc) + ',' + fmt(y - 4) + 'V' + fmt(y + 4);
      }
      if (shown.win !== wd) { winEl.setAttribute('d', wd); shown.win = wd; }

      st.last = s;
      if (busy()) schedule();
    }

    function paintArcs(p, arcs) {
      var paths = poolPaths[p], cache = shown.arc[p];
      for (var k = 0; k < paths.length; k++) {
        var a = arcs[k], c = cache[k], path = paths[k];
        var d = a ? a.d : 'M0,0', sw = a ? a.sw : (c.sw || '0.75'), so = a ? a.so : '0';
        if (c.d !== d) { path.setAttribute('d', d); c.d = d; }
        if (c.sw !== sw) { path.style.strokeWidth = sw + 'px'; c.sw = sw; }
        if (c.so !== so) { path.style.strokeOpacity = so; c.so = so; }
      }
    }
    function paintMix() {
      for (var p = 0; p < 2; p++) {
        var v = fmt(st.mix[p]);
        if (shown.poolOp[p] !== v) { pools[p].setAttribute('opacity', v); shown.poolOp[p] = v; }
      }
    }
    function paintLevels() {
      for (var i = 0; i < N; i++) {
        var h = st.lv[i] * H;
        if (h < 0.05 && !levelEls[i]) continue;
        var hs = fmt(h);
        if (shown.level[i] !== hs) {
          var el = levelEl(i);
          el.setAttribute('y', fmt(yB - h));
          el.setAttribute('height', hs);
          shown.level[i] = hs;
        }
      }
    }

    /* ── window size and pointer height ─────────────────────────── */
    function wOfY(y) {
      if (y >= yT) return W_MIN;
      if (y <= L.yHi) return W_MAX;
      return W_MIN + (yT - y) / (yT - L.yHi) * (W_MAX - W_MIN);
    }
    function yOfW(W) { return yT - (W - W_MIN) / (W_MAX - W_MIN) * (yT - L.yHi); }
    function nearestBar(x) {
      var best = FIRST, bd = Infinity;
      for (var i = FIRST; i <= LAST; i++) {
        var d = Math.abs(cx[i] - x);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    /* ── masking ────────────────────────────────────────────────── */
    function unmask(sp, keepFocus) {
      st.spans.splice(st.spans.indexOf(sp), 1);
      if (!reduced()) for (var i = sp.a; i <= sp.b; i++) st.ghost[i] = true;
      if (!keepFocus && st.focus >= sp.a && st.focus <= sp.b) st.focus = Math.round((sp.a + sp.b) / 2);
    }
    function toggle() {
      var sp = spanAt(st.focus);
      if (sp) {
        unmask(sp);
        if (st.inside && !st.keyboard) st.focus = nearestBar(st.px);
      } else {
        var i = st.focus, len = 2 + (i % 3), b = i;
        while (b + 1 <= LAST && b + 1 < i + len && !spanAt(b + 1)) b++;
        var add = b - i + 1;
        // stay under the cap: the reader's oldest spans go first, then the original ones
        while (maskedCount() + add > L.cap && st.spans.length) {
          var victim = st.spans.slice().sort(function (p, q) {
            return (p.born > 0 ? 0 : 1) - (q.born > 0 ? 0 : 1) || p.born - q.born;
          })[0];
          unmask(victim, true);
        }
        st.spans.push({ a: i, b: b, born: ++st.born });
        for (var j = i; j <= b; j++) {
          st.ghost[j] = false;
          if (!reduced()) { st.lv[j] = 1; st.lt[j] = null; }
        }
      }
      draw(true);
    }

    function reset() {
      restoreSpans();
      for (var i = 0; i < N; i++) { st.ghost[i] = false; st.lt[i] = null; }
      st.focus = restFocus();
      st.W = W_REST; st.wTw = null;
      st.showWin = false; st.armed = false;
      st.key = '';
      st.mixTw = null;
      // with st.key cleared the drawing below lands at once: levels, arcs and mix
      var s = compute();
      for (i = 0; i < N; i++) st.lv[i] = st.ghost[i] ? 1 : (s.masked[i] && i >= s.a && i <= s.b ? s.conf : 0);
      draw(false);
    }

    /* ── settling back to rest ──────────────────────────────────── */
    function armIdle() {
      clearTimeout(st.timer);
      st.timer = setTimeout(goRest, IDLE_AFTER_MS);
    }
    function goRest() {
      st.timer = 0;
      if (st.inside || (st.focused && st.keyboard)) return;
      st.showWin = false; st.armed = false; st.keyboard = false;
      var f = restFocus();
      var changed = unitOf(f)[0] !== unitOf(st.focus)[0];
      st.focus = f;
      if (reduced() || !st.visible || document.hidden) {
        st.W = W_REST; st.wTw = null;
      } else if (Math.abs(st.W - W_REST) > 0.5) {
        st.wTw = { from: st.W, t0: now() };
      }
      draw(changed);
    }

    /* ── frame loop: only while something is easing ─────────────── */
    function busy() {
      if (st.wTw || st.mixTw) return true;
      for (var i = 0; i < N; i++) if (st.lt[i]) return true;
      return false;
    }
    function schedule() {
      if (!st.raf && st.visible && !document.hidden) st.raf = window.requestAnimationFrame(frame);
    }
    function frame() {
      st.raf = 0;
      var t = now(), i, k, finishedGhost = false, redraw = false;
      var instant = reduced();
      if (st.wTw) {
        k = instant ? 1 : Math.min(1, (t - st.wTw.t0) / BACK_MS);
        st.W = st.wTw.from + (W_REST - st.wTw.from) * ease(k);
        if (k >= 1) { st.W = W_REST; st.wTw = null; }
        redraw = true;
      }
      if (st.mixTw) {
        k = instant ? 1 : Math.min(1, (t - st.mixTw.t0) / FADE_MS);
        var a = st.active;
        st.mix[a] = st.mixTw.from[a] + (1 - st.mixTw.from[a]) * ease(k);
        st.mix[1 - a] = st.mixTw.from[1 - a] * (1 - ease(k));
        if (k >= 1) { st.mix[a] = 1; st.mix[1 - a] = 0; st.mixTw = null; }
        paintMix();
      }
      for (i = 0; i < N; i++) {
        var tw = st.lt[i];
        if (!tw) continue;
        k = instant ? 1 : Math.min(1, (t - tw.t0) / LEVEL_MS);
        st.lv[i] = tw.from + (tw.to - tw.from) * ease(k);
        if (k >= 1) {
          st.lv[i] = tw.to; st.lt[i] = null;
          if (st.ghost[i]) { st.ghost[i] = false; st.lv[i] = 0; finishedGhost = true; }
        }
      }
      // an unmasked span turns solid once its level has reached the top
      if (finishedGhost) {
        draw(true);
      } else if (redraw) {
        draw(false);
      } else {
        paintLevels();
      }
      if (busy()) schedule();
    }
    function settleNow() {
      // reduced motion switched on mid-flight: finish everything where it was heading
      if (st.wTw) { st.W = W_REST; st.wTw = null; }
      st.mixTw = null; st.mix[st.active] = 1; st.mix[1 - st.active] = 0;
      for (var i = 0; i < N; i++) {
        if (st.lt[i]) { st.lv[i] = st.lt[i].to; st.lt[i] = null; }
        if (st.ghost[i]) { st.ghost[i] = false; st.lv[i] = 0; }
      }
      draw(false);
    }

    /* ── input ──────────────────────────────────────────────────── */
    function toSvg(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return null;
      return [(ev.clientX - r.left) * VW / r.width, (ev.clientY - r.top) * VH / r.height];
    }
    function pointAt(p) {
      var before = unitOf(st.focus)[0];
      st.px = p[0]; st.py = p[1];
      st.focus = nearestBar(p[0]);
      st.W = wOfY(p[1]); st.wTw = null;
      st.showWin = true; st.keyboard = false;
      draw(unitOf(st.focus)[0] !== before);
    }

    svg.addEventListener('pointerdown', function (ev) { st.pointerType = ev.pointerType || 'mouse'; });
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var p = toSvg(ev);
      if (!p) return;
      st.inside = true;
      clearTimeout(st.timer);
      pointAt(p);
    });
    svg.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType === 'touch') return;
      st.inside = false; st.showWin = false;
      draw(false);
      armIdle();
    });
    svg.addEventListener('click', function (ev) {
      var p = toSvg(ev);
      if (!p) return;
      var type = ev.pointerType || st.pointerType;
      if (type === 'touch') {
        // a first tap moves the focus; a second tap on the same bar or span toggles it
        var same = st.armed && unitOf(nearestBar(p[0]))[0] === unitOf(st.focus)[0];
        if (same) { st.W = wOfY(p[1]); st.py = p[1]; st.px = p[0]; toggle(); }
        else pointAt(p);
        st.armed = true; st.showWin = true;
        draw(false);
        armIdle();
      } else {
        st.inside = true;
        pointAt(p);
        toggle();
      }
    });
    svg.addEventListener('focus', function () { st.focused = true; clearTimeout(st.timer); });
    svg.addEventListener('blur', function () {
      st.focused = false;
      if (st.keyboard) { st.showWin = false; draw(false); }
      armIdle();
    });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        var stops = [];
        for (var i = FIRST; i <= LAST; i++) {
          var sp = spanAt(i);
          stops.push(i);
          if (sp) i = sp.b;
        }
        var cur = unitOf(st.focus)[0], at = stops.indexOf(cur);
        var step = (ev.shiftKey ? 8 : 1) * (k === 'ArrowLeft' ? -1 : 1);
        st.focus = stops[Math.max(0, Math.min(stops.length - 1, at + step))];
        st.keyboard = true; st.showWin = true;
        draw(st.focus !== cur);
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        st.wTw = null;
        st.W = Math.max(W_MIN, Math.min(W_MAX, k === 'ArrowUp' ? st.W * 1.25 : st.W / 1.25));
        st.keyboard = true; st.showWin = true;
        draw(false);
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        st.keyboard = true; st.showWin = true;
        toggle();
      } else if (k === 'Escape') {
        st.keyboard = true;
        reset();
      } else {
        return;
      }
      ev.preventDefault();
      clearTimeout(st.timer);
    });

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        st.visible = entries[entries.length - 1].isIntersecting;
        if (st.visible) schedule();
      }).observe(svg);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });
    if (motion) {
      var onMotion = function () { if (reduced()) settleNow(); };
      if (motion.addEventListener) motion.addEventListener('change', onMotion);
      else if (motion.addListener) motion.addListener(onMotion);
    }

    svg.setAttribute('role', 'group');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', LABEL);
    host.classList.add('is-live');
    st.key = compute().key;
    draw(false);

    /* for tests: read the state the drawing comes from */
    svg.coverApi = {
      state: function () {
        var s = compute();
        return { focus: [s.a, s.b], W: st.W, conf: s.conf, targets: Object.keys(s.ctx).map(Number),
                 spans: st.spans.map(function (sp) { return [sp.a, sp.b]; }), busy: busy() };
      }
    };
  }

  var hosts = document.querySelectorAll('.post-cover');
  for (var h = 0; h < hosts.length; h++) {
    var svgs = hosts[h].querySelectorAll('svg.cover-svg[data-layout]');
    for (var s = 0; s < svgs.length; s++) Cover(svgs[s], hosts[h]);
  }
})();
