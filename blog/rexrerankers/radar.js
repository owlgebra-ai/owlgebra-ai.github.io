/* RexRerankers post, Figure 5: nDCG@5 by query type as a radar.

   The page carries the full static chart (every model, a plain legend, a tooltip on every point).
   This script turns the legend into buttons that switch models on and off, adds a switch between all
   models and the RexRerankers alone, emphasises a model while the pointer or focus is on it, and reads
   a point's value into a line below the chart. The chart itself takes the arrow keys. No libraries,
   no network requests. */
(function () {
  'use strict';

  var fig = document.querySelector('figure.rr-radar');
  if (!fig) return;
  var legend = fig.querySelector('.rr-rd-legend');
  var svgs = Array.prototype.slice.call(fig.querySelectorAll('svg.rr-rd-svg'));
  var items = Array.prototype.slice.call(legend ? legend.querySelectorAll('.rr-rd-li') : []);
  var axes;
  try { axes = JSON.parse(fig.getAttribute('data-axes')); } catch (e) { return; }
  if (!svgs.length || !items.length || !axes) return;

  var M = items.length;
  var names = items.map(function (li) { return li.textContent.trim(); });
  var rex = [];
  items.forEach(function (li, k) { if (li.classList.contains('rr-rd-li--rex')) rex.push(k); });
  var on = names.map(function () { return true; });
  var hover = -1;          // model under the pointer or focus in the legend
  var pinned = null;       // {m, a}: the point last read out
  var sticky = -1;         // model picked by a click or tap; stays emphasised
  var cursor = null;       // {m, a}: the keyboard's place in the chart
  var chartFocus = null;   // the svg that has keyboard focus

  // per svg: the model groups by legend index, and each model's six vertices
  var charts = svgs.map(function (svg) {
    var groups = [];
    Array.prototype.forEach.call(svg.querySelectorAll('.rr-rd-m'), function (g) {
      var k = +g.getAttribute('data-m');
      groups[k] = { g: g, v: Array.prototype.slice.call(g.querySelectorAll('.rr-rd-v')) };
    });
    return { svg: svg, groups: groups, ring: svg.querySelector('.rr-rd-focus') };
  });

  /* ── controls ───────────────────────────────────────────────── */
  var buttons = items.map(function (li, k) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rr-rd-btn';
    b.setAttribute('aria-pressed', 'true');
    while (li.firstChild) b.appendChild(li.firstChild);
    li.appendChild(b);
    b.addEventListener('click', function () {
      on[k] = !on[k];
      if (!on[k] && cursor && cursor.m === k) cursor = null;
      if (!on[k] && pinned && pinned.m === k) pinned = null;
      if (!on[k] && sticky === k) sticky = -1;
      update();
    });
    b.addEventListener('pointerenter', function (ev) { if (ev.pointerType !== 'touch') { hover = k; update(); } });
    b.addEventListener('pointerleave', function () { if (hover === k) { hover = -1; update(); } });
    b.addEventListener('focus', function () { hover = k; update(); });
    b.addEventListener('blur', function () { if (hover === k) { hover = -1; update(); } });
    return b;
  });
  legend.classList.add('is-live');

  var top = document.createElement('div');
  top.className = 'rr-rd-top';
  var lab = document.createElement('span');
  lab.id = 'rr-rd-mode-label';
  lab.textContent = 'Show';
  var seg = document.createElement('span');
  seg.className = 'seg rr-rd-mode';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-labelledby', lab.id);
  var modes = [['all', 'All models'], ['rex', 'RexRerankers only']].map(function (m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = m[1];
    b.addEventListener('click', function () {
      for (var k = 0; k < M; k++) on[k] = m[0] === 'all' || rex.indexOf(k) >= 0;
      if (cursor && !on[cursor.m]) cursor = null;
      if (pinned && !on[pinned.m]) pinned = null;
      if (sticky >= 0 && !on[sticky]) sticky = -1;
      update();
    });
    seg.appendChild(b);
    return b;
  });
  top.appendChild(lab);
  top.appendChild(seg);
  legend.parentNode.insertBefore(top, legend);

  var readout = document.createElement('p');
  readout.className = 'rr-rd-readout is-empty';
  readout.setAttribute('aria-live', 'polite');
  var cap = fig.querySelector('figcaption');
  fig.insertBefore(readout, cap);
  var EMPTY = 'Point at a marker, or focus the chart and use the arrow keys, to read its value.';

  /* ── state to page ──────────────────────────────────────────── */
  var shownText = null;
  function value(m, a) {
    var v = charts[0].groups[m].v[a];
    return v ? v.getAttribute('data-v') : '';
  }
  function update() {
    var point = cursor && chartFocus ? cursor : pinned;
    var emph = hover >= 0 ? hover : cursor && chartFocus ? cursor.m : sticky;
    charts.forEach(function (c) {
      c.svg.classList.toggle('has-emph', emph >= 0 && on[emph]);
      c.groups.forEach(function (gr, k) {
        if (!gr) return;
        gr.g.classList.toggle('is-emph', k === emph);
        gr.g.classList.toggle('is-off', !on[k]);
      });
      var showRing = !!(cursor && chartFocus === c.svg && on[cursor.m]);
      c.svg.classList.toggle('has-focus', showRing);
      if (showRing) {
        var hit = c.groups[cursor.m].v[cursor.a].querySelector('.rr-rd-vhit');
        c.ring.setAttribute('cx', hit.getAttribute('cx'));
        c.ring.setAttribute('cy', hit.getAttribute('cy'));
      }
    });
    buttons.forEach(function (b, k) { b.setAttribute('aria-pressed', on[k] ? 'true' : 'false'); });
    var all = on.every(Boolean);
    var onlyRex = on.every(function (v, k) { return v === (rex.indexOf(k) >= 0); });
    modes[0].setAttribute('aria-pressed', all ? 'true' : 'false');
    modes[1].setAttribute('aria-pressed', onlyRex ? 'true' : 'false');
    var text = point && on[point.m] ? point : null;
    var key = text ? text.m + ':' + text.a : '';
    if (key !== shownText) {
      shownText = key;
      readout.textContent = '';
      if (text) {
        var b = document.createElement('b');
        b.textContent = names[text.m];
        readout.appendChild(b);
        readout.appendChild(document.createTextNode(' · ' + axes[text.a] + ': nDCG@5 ' + value(text.m, text.a) + '%'));
        readout.classList.remove('is-empty');
      } else {
        readout.textContent = EMPTY;
        readout.classList.add('is-empty');
      }
    }
  }

  /* ── the chart: pointer, tap and keys ───────────────────────── */
  function locate(target) {
    var v = target.closest ? target.closest('.rr-rd-v') : null;
    var g = target.closest ? target.closest('.rr-rd-m') : null;
    if (!g) return null;
    return { m: +g.getAttribute('data-m'), a: v ? +v.getAttribute('data-a') : -1 };
  }
  function visible() {
    var list = [];
    for (var k = 0; k < M; k++) if (on[k]) list.push(k);
    return list;
  }
  charts.forEach(function (c) {
    var svg = c.svg;
    svg.setAttribute('role', 'group');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', 'Radar chart of nDCG@5 by query type: use the left and right arrow keys ' +
      'to move between query types and the up and down arrow keys to move between models.');
    svg.addEventListener('pointerover', function (ev) {
      if (ev.pointerType === 'touch') return;
      var hit = locate(ev.target);
      if (!hit) return;
      hover = hit.m;
      if (hit.a >= 0) pinned = { m: hit.m, a: hit.a };
      update();
    });
    svg.addEventListener('pointerout', function (ev) {
      if (ev.pointerType === 'touch') return;
      var to = ev.relatedTarget && svg.contains(ev.relatedTarget) ? locate(ev.relatedTarget) : null;
      if (!to) { hover = -1; update(); }
    });
    svg.addEventListener('click', function (ev) {
      var hit = locate(ev.target);
      if (hit && hit.a >= 0) pinned = { m: hit.m, a: hit.a };
      else if (hit) pinned = { m: hit.m, a: pinned && pinned.m === hit.m ? pinned.a : 0 };
      else pinned = null;
      sticky = hit ? hit.m : -1;
      if (pinned) cursor = { m: pinned.m, a: pinned.a };
      update();
    });
    svg.addEventListener('focus', function () {
      // a click or tap also focuses the chart; only keyboard focus brings up the cursor
      var keyboard = true;
      try { keyboard = svg.matches(':focus-visible'); } catch (e) { /* older browsers: assume keys */ }
      if (!keyboard) return;
      chartFocus = svg;
      if (!cursor || !on[cursor.m]) {
        var list = visible();
        cursor = list.length ? { m: list[0], a: 0 } : null;
      }
      update();
    });
    svg.addEventListener('blur', function () {
      if (chartFocus === svg) chartFocus = null;
      if (cursor) pinned = cursor;
      update();
    });
    svg.addEventListener('keydown', function (ev) {
      var k = ev.key, list = visible();
      if (!list.length || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      chartFocus = svg;
      if (!cursor || !on[cursor.m]) cursor = { m: list[0], a: 0 };
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        cursor = { m: cursor.m, a: (cursor.a + (k === 'ArrowRight' ? 1 : 5)) % 6 };
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        var i = list.indexOf(cursor.m);
        i = i < 0 ? 0 : (i + (k === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        cursor = { m: list[i], a: cursor.a };
      } else if (k === 'Escape') {
        cursor = null; pinned = null; sticky = -1;
      } else {
        return;
      }
      ev.preventDefault();
      update();
    });
  });

  update();
})();
