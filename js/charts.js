// Charts for the analysis: SVG drawn at the real width of their box (redrawn when it changes), one
// y-axis each, with a crosshair and a tooltip listing every series at the hovered position.
(function (TP) {
  var h = TP.h, C = TP.chart = {}, esc = TP.esc;
  function dnum(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5; }
  function dstr(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function nice(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    var raw = (hi - lo) / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  }
  C.nice = nice;

  // A box that draws itself once its width is known.
  function mount(height, draw) {
    var box = h('div', { class: 'tc', style: 'height:' + height + 'px' }), last = 0;
    var tip = h('div', { class: 'tc-tip', role: 'status' });
    box.appendChild(tip);
    function render() {
      var w = Math.round(box.clientWidth); if (!w || w === last) return; last = w;
      var old = box.querySelector('svg'); if (old) old.remove();
      var svg = draw(w, tip); box.insertBefore(svg, tip);
    }
    if (window.ResizeObserver) new ResizeObserver(function () { render(); }).observe(box);
    requestAnimationFrame(render);
    return box;
  }
  function svgEl(w, hgt, inner) {
    var div = document.createElement('div');
    div.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '">' + inner + '</svg>';
    return div.firstChild;
  }
  function legend(items) {
    return h('div', { class: 'chart-leg' }, items.map(function (s) {
      return h('span', null, s.kind === 'line' || s.kind === 'area' ? h('i', { class: 'ln', style: 'background:' + s.col + (s.dash ? ';background:repeating-linear-gradient(90deg,' + s.col + ' 0 4px,transparent 4px 7px)' : '') }) : h('i', { style: 'background:' + s.col + (s.alpha ? ';opacity:' + s.alpha : '') }), s.name);
    }));
  }
  C.legend = legend;

  // o: { height, x: {type: 'date'|'num'|'log', fmt, ticks, min, max}, y: {fmt, min, max, invert, zero},
  //      series: [{ name, col, kind: 'line'|'bar'|'dots'|'area', pts: [[x, y, colour?]], dash, width, stack, barW, alpha, hideTip }],
  //      bands: [{ x0, x1, fill, label }], vlines: [{ x, col, dash, label }], hlines: [{ y, col, dash }], legend, title }
  C.xy = function (o) {
    var X = o.x || {}, Y = o.y || {}, Y2 = o.y2 || {}, H = o.height || 220;
    var tx = X.type === 'date' ? function (v) { return typeof v === 'string' ? dnum(v) : v; } : X.type === 'log' ? Math.log : function (v) { return v; };
    var series = o.series.filter(function (s) { return s.pts && s.pts.length; }).map(function (s) {
      return Object.assign({ kind: 'line', width: 2 }, s, { P: s.pts.map(function (p) { return [tx(p[0]), p[1], p[2]]; }) });
    });
    // Stacked bars: each point sits on the ones before it at the same x.
    var base = {};
    series.forEach(function (s) {
      if (!s.stack) return;
      s.P = s.P.map(function (p) { var b = base[p[0]] || 0; if (!fin(p[1])) return [p[0], null, p[2], b]; base[p[0]] = b + p[1]; return [p[0], b + p[1], p[2], b]; });
    });
    // Series with axis: 'right' use a second scale on the right (o.y2), e.g. heart rate beside pace.
    var xsAll = [], ysAll = [], ys2 = [], right = series.filter(function (s) { return s.axis === 'right'; });
    series.forEach(function (s) { var ys = s.axis === 'right' ? ys2 : ysAll; s.P.forEach(function (p) { xsAll.push(p[0]); if (fin(p[1])) ys.push(p[1]); if (s.kind === 'bar') ys.push(fin(p[3]) ? p[3] : 0); }); });
    if (right.length && Y2.zero) ys2.push(0);
    (o.bands || []).forEach(function (b) { xsAll.push(tx(b.x0), tx(b.x1)); });
    (o.vlines || []).forEach(function (v) { xsAll.push(tx(v.x)); });
    (o.hlines || []).forEach(function (l) { ysAll.push(l.y); });
    if (Y.zero) ysAll.push(0);
    if (!xsAll.length || !ysAll.length) return h('div', { class: 'muted small' }, 'No data to chart.');
    var barHalf = 0; series.forEach(function (s) { if (s.kind === 'bar') barHalf = Math.max(barHalf, (s.barW || 1) / 2); });
    var x0 = fin(X.min) ? tx(X.min) : Math.min.apply(null, xsAll) - barHalf, x1 = fin(X.max) ? tx(X.max) : Math.max.apply(null, xsAll) + barHalf;
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    var y0 = fin(Y.min) ? Y.min : Math.min.apply(null, ysAll), y1 = fin(Y.max) ? Y.max : Math.max.apply(null, ysAll);
    var pad = (y1 - y0 || Math.abs(y1) || 1) * 0.08;
    if (!fin(Y.min) && !(Y.zero && y0 === 0)) y0 -= pad;
    if (!fin(Y.max)) y1 += pad;
    var yt = nice(y0, y1, H < 160 ? 3 : 5); y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]);
    var fy = Y.fmt || function (v) { return String(Math.round(v * 100) / 100); };
    var r0 = 0, r1 = 1, yt2 = [], fy2 = Y2.fmt || fy;
    if (ys2.length) {
      r0 = fin(Y2.min) ? Y2.min : Math.min.apply(null, ys2); r1 = fin(Y2.max) ? Y2.max : Math.max.apply(null, ys2);
      var pad2 = (r1 - r0 || Math.abs(r1) || 1) * 0.08;
      if (!fin(Y2.min) && !(Y2.zero && r0 === 0)) r0 -= pad2;
      if (!fin(Y2.max)) r1 += pad2;
      yt2 = nice(r0, r1, H < 160 ? 3 : 5); r0 = Math.min(r0, yt2[0]); r1 = Math.max(r1, yt2[yt2.length - 1]);
    }
    var fx = X.fmt || (X.type === 'date' ? function (v) { return TP.fmt(dstr(v), '%d %b'); } : X.type === 'log' ? function (v) { return String(Math.round(Math.exp(v))); } : function (v) { return String(Math.round(v * 10) / 10); });
    var allX = []; series.forEach(function (s) { if (!s.hideTip) s.P.forEach(function (p) { if (allX.indexOf(p[0]) < 0) allX.push(p[0]); }); });
    allX.sort(function (a, b) { return a - b; });

    var box = mount(H, function (W, tip) {
      var L = Math.max(30, 8 + 6.2 * Math.max.apply(null, yt.map(function (v) { return String(fy(v)).length; })));
      var R = yt2.length ? Math.max(30, 8 + 6.2 * Math.max.apply(null, yt2.map(function (v) { return String(fy2(v)).length; }))) : 10;
      var T = Y.label || Y2.label ? 18 : 8, B = 22, pw = W - L - R, ph = H - T - B;
      var sx = function (v) { return L + (v - x0) / (x1 - x0) * pw; };
      var sy = function (v) { var f = (v - y0) / (y1 - y0); return T + (Y.invert ? f : 1 - f) * ph; };
      var sy2 = function (v) { var f = (v - r0) / (r1 - r0); return T + (Y2.invert ? f : 1 - f) * ph; };
      var s = '';
      if (Y.label) s += '<text x="' + L + '" y="11" class="ax-l">' + esc(Y.label) + '</text>';
      if (Y2.label && right.length) s += '<text x="' + (W - R) + '" y="11" text-anchor="end" class="ax-l" fill="' + (right[0] ? right[0].col : '#777') + '">' + esc(Y2.label) + '</text>';
      var rcol = right[0] ? right[0].col : '#777';
      yt2.forEach(function (v) { s += '<text x="' + (W - R + 5) + '" y="' + (sy2(v) + 3.5) + '" class="ax" style="fill:' + rcol + '">' + esc(fy2(v)) + '</text>'; });
      (o.bands || []).forEach(function (b) {
        var a = sx(tx(b.x0)), c = sx(tx(b.x1));
        s += '<rect x="' + a + '" y="' + T + '" width="' + Math.max(0, c - a) + '" height="' + ph + '" fill="' + (b.fill || '#fff2d1') + '"/>';
        if (b.label) s += '<text x="' + (a + c) / 2 + '" y="' + (T + 11) + '" text-anchor="middle" class="ax-b">' + esc(b.label) + '</text>';
      });
      yt.forEach(function (v) { var y = sy(v); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="' + (v === 0 ? '#bdbdbd' : '#ebebeb') + '"/><text x="' + (L - 5) + '" y="' + (y + 3.5) + '" text-anchor="end" class="ax">' + esc(fy(v)) + '</text>'; });
      // x ticks
      var xt = [];
      if (X.ticks) xt = X.ticks.map(tx).filter(function (v) { return v >= x0 && v <= x1; });
      else if (X.type === 'date') {
        var span = x1 - x0, d0 = dstr(Math.ceil(x0)), cur;
        if (span <= 16) { for (cur = Math.ceil(x0); cur <= x1; cur += 1) xt.push(cur); }
        else if (span <= 130) { cur = dnum(TP.weekStart(d0)); if (cur < x0) cur += 7; var st = span <= 60 ? 7 : 14; for (; cur <= x1; cur += st) xt.push(cur); }
        else { var m = TP.monthStart(d0); if (dnum(m) < x0) m = TP.addMonths(m, 1); var every = span > 800 ? 3 : span > 400 ? 2 : 1, k = 0; for (; dnum(m) <= x1; m = TP.addMonths(m, 1), k++) if (k % every === 0) xt.push(dnum(m)); }
      } else xt = nice(x0, x1, Math.max(3, Math.floor(pw / 90)));
      var maxT = X.ticks ? Math.max(2, Math.floor(pw / 30)) : Math.max(2, Math.floor(pw / 52)), stepT = Math.ceil(xt.length / maxT);
      xt.forEach(function (v, i) {
        if (i % stepT) return;
        var lab = X.type === 'date' && x1 - x0 > 130 ? TP.fmt(dstr(v), TP.parse(dstr(v)).getMonth() === 0 ? '%b %y' : '%b') : fx(v);
        s += '<line x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + (T + ph) + '" y2="' + (T + ph + 3) + '" stroke="#bdbdbd"/><text x="' + sx(v) + '" y="' + (H - 6) + '" text-anchor="middle" class="ax">' + esc(lab) + '</text>';
      });
      // marks
      var sy0 = sy, yLo = y0, yHi = y1;
      series.forEach(function (se) {
        var op = se.alpha ? ' opacity="' + se.alpha + '"' : '', sy = se.axis === 'right' ? sy2 : sy0, y0 = se.axis === 'right' ? r0 : yLo, y1 = se.axis === 'right' ? r1 : yHi;
        if (se.kind === 'bar') {
          var bw = Math.max(1, (se.barW || 1) / (x1 - x0) * pw - 2);
          se.P.forEach(function (p) {
            if (!fin(p[1])) return;
            var b = fin(p[3]) ? p[3] : 0, ya = sy(p[1]), yb = sy(b), top = Math.min(ya, yb), hh = Math.max(0.5, Math.abs(yb - ya) - (se.stack && b !== 0 ? 1 : 0));
            s += '<rect x="' + (sx(p[0]) - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + hh + '" fill="' + (p[2] || se.col) + '"' + op + '/>';
          });
        } else if (se.kind === 'dots') {
          se.P.forEach(function (p) { if (fin(p[1])) s += '<circle cx="' + sx(p[0]) + '" cy="' + sy(p[1]) + '" r="' + (se.r || 3) + '" fill="' + (p[2] || se.col) + '" stroke="#fff" stroke-width="1"' + op + '/>'; });
        } else {
          var d = '', on = false, area = '', first = null, lastX = null;
          se.P.forEach(function (p) {
            if (!fin(p[1])) { on = false; return; }
            d += (on ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); on = true;
            if (first === null) first = p[0]; lastX = p[0];
          });
          if (se.kind === 'area' && first !== null) {
            var zb = sy(Math.max(y0, Math.min(0, y1)));
            area = '<path d="' + d + 'L' + sx(lastX) + ' ' + zb + 'L' + sx(first) + ' ' + zb + 'Z" fill="' + se.col + '" opacity="' + (se.fillAlpha || 0.12) + '"/>';
          }
          s += area + '<path d="' + d + '" fill="none" stroke="' + se.col + '" stroke-width="' + se.width + '" stroke-linejoin="round" stroke-linecap="round"' + (se.dash ? ' stroke-dasharray="' + se.dash + '"' : '') + op + '/>';
        }
      });
      (o.hlines || []).forEach(function (l) { var y = sy(l.y); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="' + (l.col || '#111') + '" stroke-width="1"' + (l.dash ? ' stroke-dasharray="' + l.dash + '"' : '') + '/>' + (l.label ? '<text x="' + (W - R - 2) + '" y="' + (y - 3) + '" text-anchor="end" class="ax-b">' + esc(l.label) + '</text>' : ''); });
      (o.vlines || []).forEach(function (v) { var x = sx(tx(v.x)); s += '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (T + ph) + '" stroke="' + (v.col || '#111') + '" stroke-width="1.2"' + (v.dash ? ' stroke-dasharray="' + v.dash + '"' : '') + '/>' + (v.label ? '<text x="' + (x + 3) + '" y="' + (T + 10) + '" class="ax-b">' + esc(v.label) + '</text>' : ''); });
      s += '<line class="tc-x" x1="0" x2="0" y1="' + T + '" y2="' + (T + ph) + '" stroke="#111" stroke-width="1" visibility="hidden"/>';
      s += '<rect class="tc-hit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>';
      var svg = svgEl(W, H, s), cross = svg.querySelector('.tc-x');
      if (!allX.length) return svg;
      // Hover: snap to the nearest x and list every series there.
      function at(ev) {
        var r = svg.getBoundingClientRect(), px = ev.clientX - r.left, v = x0 + (px - L) / pw * (x1 - x0), best = allX[0];
        allX.forEach(function (x) { if (Math.abs(x - v) < Math.abs(best - v)) best = x; });
        var cx = sx(best); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
        TP.clear(tip);
        tip.appendChild(h('div', { class: 'tc-tip-h' }, o.tipX ? o.tipX(best) : X.type === 'date' ? TP.fmt(dstr(best), '%a %d %b %Y') : fx(best)));
        series.forEach(function (se) {
          if (se.hideTip || !se.name) return;
          var p = se.P.filter(function (q) { return q[0] === best; })[0]; if (!p || !fin(p[1])) return;
          var val = se.stack ? p[1] - (p[3] || 0) : p[1];
          tip.appendChild(h('div', { class: 'tc-tip-r' }, h('i', { style: 'background:' + (p[2] || se.col) }), h('b', null, (se.fmt || (se.axis === 'right' ? fy2 : fy))(val)), h('span', null, se.name)));
        });
        tip.style.display = 'block';
        var tw = tip.offsetWidth; tip.style.left = Math.min(Math.max(4, cx + 12 > W - tw - 4 ? cx - tw - 12 : cx + 12), W - tw - 4) + 'px'; tip.style.top = T + 'px';
      }
      var hit = svg.querySelector('.tc-hit');
      hit.addEventListener('pointermove', at); hit.addEventListener('pointerdown', at);
      hit.addEventListener('pointerleave', function () { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); });
      return svg;
    });
    var named = o.series.filter(function (s) { return s.name && s.pts && s.pts.length && !s.noLegend; });
    return h('div', { class: 'chart2' }, o.title ? h('div', { class: 'chart-t' }, o.title) : null, (o.legend !== false && named.length > 1) ? legend(named) : null, box);
  };

  // Horizontal 100% bar (intensity distribution): items [{label, value, col}].
  C.split = function (items, fmt) {
    var tot = items.reduce(function (t, x) { return t + (x.value || 0); }, 0);
    if (!tot) return h('div', { class: 'muted small' }, 'No data');
    return h('div', { class: 'split-bar' }, items.filter(function (x) { return x.value > 0; }).map(function (x) {
      var p = x.value / tot * 100;
      return h('div', { style: 'width:' + p + '%;background:' + x.col, title: x.label + ': ' + (fmt ? fmt(x.value) : Math.round(p) + '%') }, p >= 9 ? Math.round(p) + '%' : '');
    }));
  };

  // Score ring (0-100) with a verdict underneath.
  C.scoreCol = function (x) { return !fin(x) ? '#999999' : x >= 80 ? '#00a86b' : x >= 65 ? '#2b4dff' : x >= 50 ? '#d99a00' : '#ff3b30'; };
  C.ring = function (x, label, size, verdict) {
    size = size || 64; var col = C.scoreCol(x), pct = fin(x) ? x : 0;
    return h('div', { class: 'ring-wrap' },
      h('div', { class: 'ring', style: 'width:' + size + 'px;height:' + size + 'px;background:conic-gradient(' + col + ' ' + pct + '%, #dedede 0)' },
        h('div', { style: 'width:' + (size - 12) + 'px;height:' + (size - 12) + 'px;color:' + col + ';font-size:' + (size / 48).toFixed(2) + 'rem' }, fin(x) ? Math.round(x) : '–')),
      h('div', { class: 'ring-l' }, label), verdict ? h('div', { class: 'ring-v', style: 'color:' + col }, verdict) : null);
  };
  C.dnum = dnum; C.dstr = dstr;
})(window.TP);
