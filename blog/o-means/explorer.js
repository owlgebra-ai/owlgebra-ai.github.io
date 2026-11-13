/* o-means post, figure 1: held-out error against time, one dataset at a time.

   Reads the JSON block that build_post.py writes next to the static figure, draws the chart as
   SVG and hides the static figure once it has drawn. Without JavaScript the static figure stays.
   No libraries and no network requests. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var MINUS = '−';
  var STEP_NAMES = ['25 Lloyd iterations', 'e-means', 'v0, our kernels', 'o-means'];
  var STEP_MS = 3600;
  var LINES = { o: 'l-omeans', e: 'l-emeans', v0: 'l-v0', traj: 'l-lloyd' };

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(e);
    return e;
  }

  function htmlEl(tag, attrs, text, parent) {
    var e = document.createElement(tag);
    for (var k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]); }
    if (text) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function fmt(v) {
    if (v >= 100) return String(Math.round(v));
    return String(Number(v.toPrecision(3)));
  }

  function fmtRel(r) {
    var s = Math.abs(r).toFixed(2);
    if (s === '0.00') return '0.00%';
    return (r < 0 ? MINUS : '+') + s + '%';
  }

  function logTicks(lo, hi) {
    var out = [];
    for (var e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++) {
      [1, 2, 5].forEach(function (m) {
        var v = m * Math.pow(10, e);
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push({ v: Number(v.toPrecision(6)), major: m === 1 });
      });
    }
    return out;
  }

  /* one marker; the legend draws the same shapes */
  function marker(kind, g, x, y) {
    switch (kind) {
      case 'o': return svgEl('circle', { 'class': 'm-omeans', cx: x, cy: y, r: 4.5 }, g);
      case 'e': return svgEl('circle', { 'class': 'm-emeans', cx: x, cy: y, r: 4.25 }, g);
      case 'v0': return svgEl('path', { 'class': 'm-v0', d: 'M' + x + ',' + (y - 5) + 'l5,5l-5,5l-5,-5z' }, g);
      case 'flash': return svgEl('rect', { 'class': 'm-lloyd', x: x - 4, y: y - 4, width: 8, height: 8 }, g);
      case 'faiss': return svgEl('path', { 'class': 'm-faiss', d: 'M' + x + ',' + (y - 5) + 'l4.5,8h-9z' }, g);
      default: return svgEl('circle', { 'class': 'm-traj', cx: x, cy: y, r: 2.75 }, g);
    }
  }

  function glyph(kind) {
    var s = svgEl('svg', { viewBox: '0 0 22 14', width: 22, height: 14, 'aria-hidden': 'true', focusable: 'false' });
    if (LINES[kind]) svgEl('line', { 'class': LINES[kind], x1: 1, x2: 21, y1: 7, y2: 7 }, s);
    marker(kind, s, 11, 7);
    return s;
  }

  function budgetText(s, p) {
    if (s.unit === 'it') return '25 iterations';
    if (s.unit === 'iter') return 'after iteration ' + p[0];
    if (s.unit === 'ep') return p[0] + (p[0] === 1 ? ' epoch' : ' epochs');
    return 'budget of ' + p[0] + (p[0] === 1 ? ' epoch' : ' epochs');
  }

  function describe(s, p) {
    return s.short + ', ' + budgetText(s, p) + ': ' + fmt(p[1]) + ' s, ' + fmt(p[2]) + ' passes, ' +
      fmtRel(p[3]) + ' against 25 Lloyd iterations';
  }

  function init(host) {
    var src = host.querySelector('script.explorer-data');
    var fallback = host.querySelector('figure');
    if (!src || !fallback || !window.SVGElement) return;
    var data;
    try { data = JSON.parse(src.textContent); } catch (err) { return; }
    if (!data.sets || !data.sets.length) return;
    var sets = {};
    data.sets.forEach(function (s) { sets[s.cfg] = s; });
    var reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    var st = { cfg: sets[data['default']] ? data['default'] : data.sets[0].cfg, view: 's',
               sel: null, hover: null, insp: null, step: 0, timer: null, hits: [], width: 0 };

    /* ── markup ─────────────────────────────────────────────────── */
    var fig = htmlEl('figure', { 'class': 'fig explorer', id: 'figure-1-explorer' });
    var controls = htmlEl('div', { 'class': 'ex-controls' }, null, fig);

    var gData = htmlEl('div', { 'class': 'ex-group' }, null, controls);
    htmlEl('span', { 'class': 'ex-label', id: 'ex-ds-label' }, 'Dataset', gData);
    var chips = htmlEl('div', { 'class': 'ex-chips', role: 'group', 'aria-labelledby': 'ex-ds-label' }, null, gData);
    var dsButtons = data.sets.map(function (s) {
      var b = htmlEl('button', { type: 'button', 'class': 'ex-chip', 'data-cfg': s.cfg }, s.label, chips);
      b.addEventListener('click', function () {
        st.cfg = s.cfg; st.sel = null; st.hover = null; st.insp = null;
        render();
      });
      return b;
    });

    var row2 = htmlEl('div', { 'class': 'ex-row' }, null, controls);
    var gAxis = htmlEl('div', { 'class': 'ex-group' }, null, row2);
    htmlEl('span', { 'class': 'ex-label', id: 'ex-ax-label' }, 'Horizontal axis', gAxis);
    var seg = htmlEl('span', { 'class': 'seg', role: 'group', 'aria-labelledby': 'ex-ax-label' }, null, gAxis);
    var axButtons = [['s', 'Seconds'], ['d', 'Distance computations']].map(function (a) {
      var b = htmlEl('button', { type: 'button', 'class': 'ex-seg' }, a[1], seg);
      b.addEventListener('click', function () { st.view = a[0]; render(); });
      return b;
    });

    var gStory = htmlEl('div', { 'class': 'ex-group' }, null, row2);
    htmlEl('span', { 'class': 'ex-label', id: 'ex-st-label' }, 'Story', gStory);
    var story = htmlEl('span', { 'class': 'ex-story', role: 'group', 'aria-labelledby': 'ex-st-label' }, null, gStory);
    var stepButtons = STEP_NAMES.map(function (name, i) {
      var b = htmlEl('button', { type: 'button', 'class': 'ex-step', 'aria-label': 'Step ' + (i + 1) + ': ' + name },
                     String(i + 1), story);
      b.addEventListener('click', function () {
        stopPlay();
        st.step = st.step === i + 1 ? 0 : i + 1;
        st.sel = null; st.hover = null; st.insp = null;
        render();
      });
      return b;
    });
    var play = htmlEl('button', { type: 'button', 'class': 'ex-play', 'aria-label': 'Play the story' }, null, story);
    var playIcon = svgEl('svg', { viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' }, play);
    play.addEventListener('click', function () {
      if (st.timer) { stopPlay(); render(); return; }
      if (st.step === 0 || st.step >= 4) st.step = 1;
      st.sel = null; st.hover = null; st.insp = null;
      st.timer = window.setInterval(function () {
        if (st.step >= 4) { stopPlay(); render(); return; }
        st.step += 1;
        if (st.step >= 4) stopPlay();
        render();
      }, STEP_MS);
      render();
    });

    var caption = htmlEl('p', { 'class': 'ex-caption', 'aria-live': 'polite' }, null, fig);
    htmlEl('p', { 'class': 'ex-hint' }, 'Time to reach the error of 25 Lloyd iterations. Select a series to pick ' +
           'it out; then ← and → step through its points and Esc clears.', fig);
    var legend = htmlEl('div', { 'class': 'ex-legend', role: 'group', 'aria-label': 'Series' }, null, fig);
    var chart = htmlEl('div', { 'class': 'ex-chart' }, null, fig);
    var svg = svgEl('svg', { tabindex: 0, role: 'img', 'aria-describedby': 'ex-readout' }, chart);
    var readout = htmlEl('p', { 'class': 'ex-readout', id: 'ex-readout', 'aria-live': 'polite' }, null, fig);
    var notes = htmlEl('div', { 'class': 'ex-notes' }, null, fig);
    var cap = htmlEl('figcaption', {}, null, fig);
    var label = fallback.querySelector('figcaption b');
    if (label) cap.appendChild(label.cloneNode(true)).insertAdjacentText('afterend', ' ');
    cap.appendChild(document.createTextNode(data.caption));

    /* ── state helpers ──────────────────────────────────────────── */
    function set() { return sets[st.cfg]; }
    function series(id) {
      var ss = set().series;
      for (var i = 0; i < ss.length; i++) if (ss[i].id === id) return ss[i];
      return null;
    }
    function shown(s) { return !st.step || s.step <= st.step; }
    function active(s) {
      if (st.sel) return s.id === st.sel;
      if (st.hover) return s.id === st.hover;
      if (st.step) return s.step === st.step;
      return null;
    }
    function stopPlay() {
      if (st.timer) { window.clearInterval(st.timer); st.timer = null; }
    }
    function closing(s) {  /* first point at or below the Lloyd error, else the last */
      for (var i = 0; i < s.pts.length; i++) if (s.pts[i][3] <= 0) return i;
      return s.pts.length - 1;
    }
    function select(id) {
      if (st.sel === id) { st.sel = null; st.insp = null; }
      else { st.sel = id; st.insp = { sid: id, i: closing(series(id)) }; }
      render();
    }

    /* ── legend ─────────────────────────────────────────────────── */
    function drawLegend() {
      var had = document.activeElement;
      var focusSid = had && legend.contains(had) ? had.getAttribute('data-sid') : null;
      legend.textContent = '';
      set().series.forEach(function (s) {
        var reach = s.reach[st.view === 's' ? 0 : 1];
        var b = htmlEl('button', { type: 'button', 'class': 'ex-leg', 'aria-pressed': String(st.sel === s.id),
                                   'aria-label': s.name + ': ' + reach, title: s.name }, null, legend);
        b.appendChild(glyph(s.kind));
        htmlEl('span', { 'class': 'ex-leg__name' }, s.short, b);
        htmlEl('span', { 'class': 'ex-leg__reach' }, reach, b);
        if (!shown(s)) b.disabled = true;
        var a = active(s);
        if (a === false) b.classList.add('is-dim');
        b.addEventListener('click', function () { select(s.id); });
        b.addEventListener('mouseenter', function () { if (!st.sel && st.hover !== s.id) { st.hover = s.id; drawChart(); } });
        b.addEventListener('mouseleave', function () { if (st.hover === s.id) { st.hover = null; drawChart(); } });
        b.setAttribute('data-sid', s.id);
        if (s.id === focusSid && !b.disabled) b.focus();
      });
    }

    /* ── chart ──────────────────────────────────────────────────── */
    function drawChart() {
      var S = set();
      var W = Math.max(280, Math.round(chart.clientWidth || 640));
      st.width = W;
      var narrow = W < 560;
      var H = narrow ? 310 : 400;
      var m = { l: narrow ? 40 : 48, r: 14, t: 28, b: 44 };
      var px0 = m.l, px1 = W - m.r, py0 = m.t, py1 = H - m.b;
      var xi = st.view === 's' ? 1 : 2;
      var xs = [];
      S.series.forEach(function (s) { s.pts.forEach(function (p) { if (p[xi] > 0) xs.push(p[xi]); }); });
      var lo = Math.min.apply(null, xs) / 1.35, hi = Math.max.apply(null, xs) * 1.35;
      var llo = Math.log10(lo), lhi = Math.log10(hi);
      function X(v) { return px0 + (Math.log10(v) - llo) / (lhi - llo) * (px1 - px0); }
      function Y(r) { return py0 + (S.ymax - r) / (S.ymax - S.ymin) * (py1 - py0); }

      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      svg.setAttribute('aria-label', S.label + ': held-out error relative to 25 Lloyd iterations against ' +
        (st.view === 's' ? 'seconds' : 'distance computations in passes') +
        '. Use the legend buttons to pick a series and the arrow keys to read its points.');
      var clipId = 'ex-clip';
      var defs = svgEl('defs', {}, svg);
      svgEl('rect', { x: px0, y: py0, width: px1 - px0, height: py1 - py0 },
            svgEl('clipPath', { id: clipId }, defs));

      svgEl('text', { 'class': 'ax-title', x: 0, y: 12 }, svg).textContent =
        'Error relative to 25 Lloyd iterations (dashed line)';
      for (var r = Math.ceil(S.ymin); r <= Math.floor(S.ymax); r++) {
        var y = Y(r);
        if (r !== 0) svgEl('line', { 'class': 'ax-grid', x1: px0, x2: px1, y1: y, y2: y }, svg);
        svgEl('text', { 'class': 'ax-tick', x: px0 - 6, y: y + 3.5, 'text-anchor': 'end' }, svg).textContent =
          r === 0 ? '0' : (r > 0 ? '+' : MINUS) + Math.abs(r) + '%';
      }
      var last = -1e9;
      logTicks(lo, hi).forEach(function (t) {
        var x = X(t.v);
        svgEl('line', { 'class': 'ax-grid', x1: x, x2: x, y1: py0, y2: py1, opacity: t.major ? null : 0.6 }, svg);
        if (x - last >= (narrow ? 34 : 30) && (t.major || x - last >= 44)) {
          svgEl('text', { 'class': 'ax-tick', x: x, y: py1 + 15, 'text-anchor': 'middle' }, svg).textContent = String(t.v);
          last = x;
        }
      });
      svgEl('line', { 'class': 'ax-line', x1: px0, x2: px1, y1: py1, y2: py1 }, svg);
      svgEl('text', { 'class': 'ax-title', x: (px0 + px1) / 2, y: H - 8, 'text-anchor': 'middle' }, svg).textContent =
        st.view === 's' ? 'Seconds, log scale' : 'Distance computations, in full passes, log scale';
      svgEl('line', { 'class': 'ax-zero', x1: px0, x2: px1, y1: Y(0), y2: Y(0) }, svg);

      st.hits = [];
      var order = ['traj', 'faiss', 'flash', 'e', 'v0', 'o'];
      var list = S.series.slice().sort(function (a, b) { return order.indexOf(a.kind) - order.indexOf(b.kind); });
      list.forEach(function (s) {
        if (!shown(s)) return;
        var a = active(s);
        var past = a === false && st.step && !st.sel && !st.hover && s.step < st.step;
        var g = svgEl('g', { 'class': 'ex-s' + (past ? ' is-past' : a === false ? ' is-dim' : a ? ' is-active' : '') }, svg);
        var pts = s.pts.map(function (p) { return [X(p[xi]), Y(p[3]), p]; });
        if (LINES[s.kind] && pts.length > 1) {
          svgEl('polyline', { 'class': LINES[s.kind], 'clip-path': 'url(#' + clipId + ')',
            points: pts.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') }, g);
        }
        pts.forEach(function (q, i) {
          var pg = svgEl('g', {}, g);
          svgEl('title', {}, pg).textContent = describe(s, q[2]);
          var x = q[0], y = q[1];
          if (q[2][3] > S.ymax) {
            y = py0 + 4;
            svgEl('path', { 'class': 'm-clip-l', d: 'M' + x + ',' + (py0 - 1) + 'l-4,7h8z' }, pg);
          } else {
            marker(s.kind, pg, x, y);
          }
          st.hits.push({ sid: s.id, i: i, x: x, y: y });
        });
      });

      if (st.insp) {
        var s = series(st.insp.sid);
        var hit = null;
        st.hits.forEach(function (h) { if (h.sid === st.insp.sid && h.i === st.insp.i) hit = h; });
        if (s && hit) {
          svgEl('path', { 'class': 'ex-guide', d: 'M' + px0 + ',' + hit.y + 'H' + hit.x + 'V' + py1 }, svg);
          svgEl('circle', { 'class': 'ex-ring', cx: hit.x, cy: hit.y, r: 9 }, svg);
        }
      }
      drawReadout();
    }

    function drawReadout() {
      readout.textContent = '';
      var s = st.insp ? series(st.insp.sid) : null;
      if (!s || !shown(s)) {
        readout.textContent = 'Hover over or tap a point, or select a series in the legend and use ← and →.';
        readout.classList.add('is-empty');
        return;
      }
      readout.classList.remove('is-empty');
      var p = s.pts[st.insp.i];
      htmlEl('b', {}, s.short, readout);
      readout.appendChild(document.createTextNode(', ' + budgetText(s, p) + ' · '));
      htmlEl('span', { 'class': 'ex-num' }, fmt(p[1]) + ' s', readout);
      readout.appendChild(document.createTextNode(' · '));
      htmlEl('span', { 'class': 'ex-num' }, fmt(p[2]) + ' passes', readout);
      readout.appendChild(document.createTextNode(' · '));
      htmlEl('span', { 'class': 'ex-num' }, fmtRel(p[3]), readout);
      readout.appendChild(document.createTextNode(' against 25 Lloyd iterations' +
        (p[3] > set().ymax ? ' (above the chart)' : '') + ' · point ' + (st.insp.i + 1) + ' of ' + s.pts.length));
    }

    function render() {
      var S = set();
      dsButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-cfg') === st.cfg)); });
      axButtons[0].setAttribute('aria-pressed', String(st.view === 's'));
      axButtons[1].setAttribute('aria-pressed', String(st.view === 'd'));
      stepButtons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(st.step === i + 1)); });
      while (playIcon.firstChild) playIcon.removeChild(playIcon.firstChild);
      if (st.timer) {
        svgEl('path', { d: 'M2,1h3v10h-3zM7,1h3v10h-3z' }, playIcon);
        play.setAttribute('aria-label', 'Pause the story');
      } else {
        svgEl('path', { d: 'M2.5,1l8,5l-8,5z' }, playIcon);
        play.setAttribute('aria-label', 'Play the story');
      }
      caption.textContent = '';
      if (st.step) {
        htmlEl('b', {}, 'Step ' + st.step + ' of 4. ', caption);
        caption.appendChild(document.createTextNode(S.steps[st.step - 1]));
      } else {
        htmlEl('b', {}, S.label, caption);
        caption.appendChild(document.createTextNode(' · ' + S.sub));
      }
      notes.textContent = '';
      S.notes.concat([data.key]).forEach(function (n) { htmlEl('p', {}, n, notes); });
      drawLegend();
      drawChart();
    }

    /* ── pointer and keyboard ───────────────────────────────────── */
    function nearest(ev, radius) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return null;
      var k = st.width / rect.width;
      var x = (ev.clientX - rect.left) * k, y = (ev.clientY - rect.top) * k;
      var best = null, bd = radius * radius;
      st.hits.forEach(function (h) {
        var d = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
        if (d < bd) { bd = d; best = h; }
      });
      return best;
    }
    svg.addEventListener('pointermove', function (ev) {
      if (ev.pointerType === 'touch') return;
      var h = nearest(ev, 22);
      if (h) {
        if (st.insp && st.insp.sid === h.sid && st.insp.i === h.i) return;
        if (!st.sel) st.hover = h.sid;
        if (!st.sel || st.sel === h.sid) { st.insp = { sid: h.sid, i: h.i }; drawLegend(); drawChart(); }
      } else if (st.hover) {
        st.hover = null;
        if (!st.sel) st.insp = null;
        drawLegend(); drawChart();
      }
    });
    svg.addEventListener('pointerleave', function () {
      if (st.hover) {
        st.hover = null;
        if (!st.sel) st.insp = null;
        drawLegend(); drawChart();
      }
    });
    svg.addEventListener('click', function (ev) {
      var h = nearest(ev, 30);
      if (h) {
        st.hover = null; st.sel = h.sid; st.insp = { sid: h.sid, i: h.i };
      } else {
        st.sel = null; st.hover = null; st.insp = null;
      }
      drawLegend(); drawChart();
    });
    fig.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (st.sel || st.insp || st.hover) {
          st.sel = null; st.hover = null; st.insp = null;
          drawLegend(); drawChart();
        }
        return;
      }
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var t = ev.target;
      var fromLegend = t.classList && t.classList.contains('ex-leg');
      if (!fromLegend && t !== svg) return;
      var sid = st.sel || (fromLegend ? t.getAttribute('data-sid') : null);
      if (!sid) {
        var vis = set().series.filter(shown);
        sid = vis.length ? vis[vis.length - 1].id : null;
        for (var j = 0; j < vis.length; j++) if (vis[j].id === 'o') sid = 'o';
      }
      var s = sid ? series(sid) : null;
      if (!s || !shown(s)) return;
      ev.preventDefault();
      var step = ev.key === 'ArrowRight' ? 1 : -1;
      var i;
      if (st.insp && st.insp.sid === sid) i = Math.max(0, Math.min(s.pts.length - 1, st.insp.i + step));
      else i = step > 0 ? 0 : s.pts.length - 1;
      st.sel = sid; st.hover = null; st.insp = { sid: sid, i: i };
      drawLegend();
      drawChart();
      if (fromLegend) {
        var again = legend.querySelector('[data-sid="' + sid + '"]');
        if (again) again.focus();
      }
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (Math.round(chart.clientWidth) !== st.width) drawChart();
      }).observe(chart);
    } else {
      window.addEventListener('resize', drawChart);
    }
    if (reduced && reduced.addEventListener) reduced.addEventListener('change', render);

    host.insertBefore(fig, fallback);
    fallback.hidden = true;
    host.classList.add('is-live');
    render();
  }

  var hosts = document.querySelectorAll('[data-explorer]');
  for (var i = 0; i < hosts.length; i++) init(hosts[i]);
})();
