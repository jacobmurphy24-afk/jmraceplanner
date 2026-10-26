// Block reports: season timeline, a card per block, the block pop-up and the printable plan.
(function (TP) {
  var h = TP.h;

  // Everything a report needs about one block.
  TP.reportBlock = function (bid) {
    var p = TP.state.events[bid]; if (!p) return null;
    var start = TP.blockStart(p), n = Math.floor(TP.daysBetween(start, TP.weekStart(p.race_date)) / 7) + 1, today = TP.today(), weeks = [];
    for (var i = 0; i < n; i++) weeks.push(TP.addDays(start, 7 * i));
    var sess = TP.state.sessions.filter(function (s) { return s.block_id === bid; }).map(function (s) {
      return Object.assign({}, s, { sport: TP.sportOf(s.discipline), h: TP.estHours(s), km: s.total_dist || 0 });
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var cur = today >= start && today <= p.race_date ? Math.floor(TP.daysBetween(start, today) / 7) + 1 : null;
    return { id: bid, p: p, name: TP.eventName(p), race_date: p.race_date, start: start, n: n, weeks: weeks, sess: sess, cur: cur,
      status: today < start ? 'Upcoming' : today > p.race_date ? 'Completed' : 'In progress',
      col: p.palette.race, light: p.palette.train,
      phase: weeks.map(function (w, i) { return TP.phase(i + 1, n, w, p); }) };
  };
  function weekSess(rb, w) { var e = TP.addDays(w, 6); return rb.sess.filter(function (s) { return s.date >= w && s.date <= e; }); }
  function sum(a, k) { return a.reduce(function (t, x) { return t + (x[k] || 0); }, 0); }
  function statusChip(rb) {
    var st = { Upcoming: ['#e3e8ff', '#1a33c4'], 'In progress': ['#eddaff', '#7227b8'], Completed: ['#d1efe4', '#057b50'] }[rb.status];
    return h('span', { class: 'rp-chip', style: 'background:' + st[0] + ';color:' + st[1] }, rb.status === 'In progress' ? 'Week ' + rb.cur + ' of ' + rb.n : rb.status);
  }
  function prioChip(p) {
    if (p.race_type === 'Training Only' || !p.priority) return null;
    return h('span', { class: 'prio prio-' + p.priority, title: TP.PRIORITY_LABELS[p.priority] }, 'P' + p.priority + ' · ' + TP.PRIORITY_LABELS[p.priority]);
  }
  function kpi(v, l, s) { return h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, v), h('div', { class: 'kpi-l' }, l), s ? h('div', { class: 'kpi-s' }, s) : null); }

  // Planned training per week, stacked by sport, as SVG. metric: 'h' or 'km'.
  TP.volumeChart = function (rb, compact, metric) {
    var W = compact ? 320 : 640, H = compact ? 110 : 240, L = compact ? 4 : 40, R = 6, T = compact ? 6 : 22, B = compact ? 16 : 26;
    var sports = TP.SPORTS.filter(function (sp) { return rb.sess.some(function (s) { return s.sport === sp; }); });
    var f = metric === 'km' ? TP.distFactor() : 1;
    var data = rb.weeks.map(function (w) { var ws = weekSess(rb, w); return sports.map(function (sp) { return sum(ws.filter(function (s) { return s.sport === sp; }), metric) * f; }); });
    var tots = data.map(function (d) { return d.reduce(function (a, x) { return a + x; }, 0); });
    var max = Math.max.apply(null, tots.concat([metric === 'km' ? 10 : 1])) * 1.12, bw = (W - L - R) / rb.n;
    var y = function (v) { return T + (H - T - B) * (1 - v / max); }, s = '';
    rb.phase.forEach(function (ph, i) { if (ph !== 'Build') s += '<rect x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="#fff2d1" opacity=".7"/>'; });
    if (!compact) {
      var step = niceStep(max);
      for (var g = 0; g <= max; g += step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#ebebeb"/><text x="' + (L - 5) + '" y="' + (y(g) + 3) + '" text-anchor="end" class="ax">' + TP.round(g, 1) + '</text>';
    }
    data.forEach(function (d, i) {
      var acc = 0, x = L + i * bw + bw * 0.14;
      d.forEach(function (v, j) { if (v <= 0) return; s += '<rect x="' + x + '" y="' + y(acc + v) + '" width="' + bw * 0.72 + '" height="' + (y(acc) - y(acc + v)) + '" fill="' + TP.SPORT_COLOURS[sports[j]] + '"/>'; acc += v; });
      if (!compact && tots[i] > 0) s += '<text x="' + (L + i * bw + bw / 2) + '" y="' + (y(tots[i]) - 4) + '" text-anchor="middle" class="tot">' + (metric === 'km' ? Math.round(tots[i]) : tots[i].toFixed(1)) + '</text>';
      var lbl = !compact || i === 0 || (i + 1) % 4 === 0 || i === rb.n - 1;
      if (lbl) s += '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" class="ax">' + (i + 1) + '</text>';
    });
    if (rb.cur) { var cx = L + (rb.cur - 0.5) * bw; s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#9b30ff" stroke-dasharray="4 3"/>'; }
    var legend = compact ? '' : '<div class="chart-leg">' + sports.map(function (sp) { return '<span><i style="background:' + TP.SPORT_COLOURS[sp] + '"></i>' + sp + '</span>'; }).join('') + '</div>';
    return h('div', { class: 'chart no-units', html: legend + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" class="vchart' + (compact ? ' mini' : '') + '">' + s + '</svg>' });
  };
  function niceStep(max) { var raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p; }

  // --- Page ---
  TP.renderReports = function (root) {
    root.appendChild(h('div', { class: 'page-head' }, h('h2', null, 'Training block reports'),
      h('p', { class: 'muted' }, 'Your season at a glance. Open a block for its weekly plan and sport mix, or download it as a PDF.')));
    var ids = Object.keys(TP.state.events).sort(function (a, b) { return TP.state.events[a].race_date < TP.state.events[b].race_date ? -1 : 1; });
    if (!ids.length) {
      root.appendChild(h('div', { class: 'empty' }, TP.icon('calendar', 'width:32px;height:32px'), h('h3', null, 'No events yet'),
        h('p', null, 'Add an event and its training block report appears here.'),
        h('button', { class: 'btn btn-primary', onclick: function () { TP.eventForm(null); } }, TP.icon('plus'), 'Add event')));
      return;
    }
    var rbs = ids.map(TP.reportBlock);
    root.appendChild(season(rbs));
    root.appendChild(h('div', { class: 'rp-grid' }, rbs.map(card)));
  };

  function season(rbs) {
    var all = []; rbs.forEach(function (r) { all = all.concat(r.sess); });
    var lo = TP.monthStart(rbs.reduce(function (a, r) { return r.start < a ? r.start : a; }, rbs[0].start));
    var hi = TP.addDays(rbs.reduce(function (a, r) { return r.race_date > a ? r.race_date : a; }, rbs[0].race_date), 7);
    var span = Math.max(1, TP.daysBetween(lo, hi)), pct = function (d) { return (TP.daysBetween(lo, d) / span * 100).toFixed(2) + '%'; };
    // Overlapping blocks go on separate lanes.
    var laneEnd = [], lanes = {};
    rbs.slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; }).forEach(function (r) {
      var k = laneEnd.findIndex(function (e) { return e < r.start; }); if (k < 0) k = laneEnd.length;
      laneEnd[k] = TP.addDays(r.race_date, 2); lanes[r.id] = k;
    });
    var nLanes = laneEnd.length, ticks = [], m = lo;
    while (m <= hi) { ticks.push(m); m = TP.addMonths(m, 1); }
    var upcoming = rbs.filter(function (r) { return r.race_date >= TP.today() && r.p.race_type !== 'Training Only'; })[0];
    var tl = h('div', { class: 'rp-timeline', style: 'height:' + (26 * nLanes + 26) + 'px' },
      ticks.map(function (t) { return h('div', { class: 'rp-tick', style: 'left:' + pct(t) }, TP.fmt(t, TP.parse(t).getMonth() === 0 ? '%b %Y' : '%b')); }),
      TP.today() >= lo && TP.today() <= hi ? h('div', { class: 'rp-today', style: 'left:' + pct(TP.today()) }, h('span', null, 'Today')) : null,
      rbs.map(function (r) {
        return h('div', { class: 'rp-seg', title: r.name + ' · ' + TP.fmt(r.start, '%d %b') + ' – ' + TP.fmt(r.race_date, '%d %b %Y'), onclick: function () { TP.blockModal(r.id); },
          style: 'left:' + pct(r.start) + ';width:' + ((TP.daysBetween(r.start, r.race_date) + 1) / span * 100).toFixed(2) + '%;top:' + 26 * lanes[r.id] + 'px;background:' + r.light + ';border-color:' + r.col },
          h('span', null, r.name), h('i', { class: 'rp-flag', style: 'background:' + r.col }));
      }));
    return h('div', { class: 'rp-season' },
      h('div', { class: 'kpis kpis-4' },
        kpi(rbs.length, 'Events'), kpi(all.length, 'Planned sessions'), kpi(TP.fmtKm(sum(all, 'km')), 'Planned distance'),
        kpi(upcoming ? TP.daysBetween(TP.today(), upcoming.race_date) + ' days' : '–', 'Next race', upcoming ? upcoming.name : null)),
      h('div', { class: 'rp-timeline-wrap' }, tl));
  }

  function card(rb) {
    var s = rb.sess, toGo = TP.daysBetween(TP.today(), rb.race_date);
    var prog = rb.status === 'Completed' ? 100 : rb.status === 'Upcoming' ? 0 : (rb.cur - 0.5) / rb.n * 100;
    var counts = TP.SPORTS.filter(function (sp) { return s.some(function (x) { return x.sport === sp; }); });
    return h('div', { class: 'rp-card', style: '--c:' + rb.col, onclick: function () { TP.blockModal(rb.id); } },
      h('div', { class: 'rp-card-top' }, h('div', null, h('div', { class: 'rp-type' }, rb.p.race_type.toUpperCase()), h('div', { class: 'rp-name' }, rb.name)),
        h('div', { class: 'chips-r' }, prioChip(rb.p), statusChip(rb))),
      h('div', { class: 'rp-dates' }, h('span', null, TP.fmt(rb.start, '%d %b %Y') + ' – ' + TP.fmt(rb.race_date, '%d %b %Y') + ' · ' + rb.n + ' weeks'),
        h('b', null, toGo > 0 ? toGo + ' days to go' : toGo === 0 ? 'Today' : '')),
      h('div', { class: 'rp-progress' }, h('div', { style: 'width:' + prog + '%' })),
      h('div', { class: 'mini-kpis' }, h('div', null, h('b', null, s.length), h('span', null, 'sessions')), h('div', null, h('b', null, TP.fmtKm(sum(s, 'km'))), h('span', null, 'distance')),
        h('div', null, h('b', null, rb.n), h('span', null, 'weeks'))),
      TP.volumeChart(rb, true, TP.state.prefs.rpAxis === 'Distance' ? 'km' : 'h'),
      h('div', { class: 'rp-card-foot' },
        h('div', { class: 'rp-sports' }, counts.length ? counts.map(function (sp) { return h('span', null, h('i', { style: 'background:' + TP.SPORT_COLOURS[sp] }), sp + ' ' + s.filter(function (x) { return x.sport === sp; }).length); })
                                                     : h('span', { class: 'muted' }, 'No sessions planned yet')),
        h('div', { class: 'chips-r' },
          h('button', { class: 'btn btn-sm', onclick: function (e) { e.stopPropagation(); TP.printPlan(rb.id); } }, TP.icon('download'), 'PDF'),
          h('span', { class: 'rp-open' }, 'Open report →'))));
  }

  // --- Block pop-up ---
  TP.blockModal = function (bid) {
    var rb = TP.reportBlock(bid); if (!rb) return;
    var s = rb.sess, chartBox = h('div'), bigBox = h('div');
    function drawChart() {
      var km = TP.state.prefs.rpAxis === 'Distance';
      TP.clear(chartBox); chartBox.appendChild(TP.volumeChart(rb, false, km ? 'km' : 'h'));
      var v = rb.weeks.map(function (w) { return sum(weekSess(rb, w), km ? 'km' : 'h'); }), mx = Math.max.apply(null, v.concat([0]));
      TP.clear(bigBox); bigBox.appendChild(kpi(mx > 0 ? (km ? TP.fmtKm(mx) : mx.toFixed(1) + ' h') : '–', 'Biggest week'));
    }
    var totH = Math.max(sum(s, 'h'), 0.01);
    var sports = TP.SPORTS.filter(function (sp) { return s.some(function (x) { return x.sport === sp; }); });
    var sportTbl = sports.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Sport'), h('th', { class: 'num' }, 'Sessions'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, 'Est. time'), h('th', null, 'Share of time'), h('th', null, 'Session types'))),
      h('tbody', null, sports.map(function (sp) {
        var ss = s.filter(function (x) { return x.sport === sp; }), types = {};
        ss.forEach(function (x) { types[x.type] = (types[x.type] || 0) + 1; });
        var share = sum(ss, 'h') / totH * 100;
        return h('tr', null, h('td', null, h('span', { class: 'sdot', style: 'background:' + TP.SPORT_COLOURS[sp] }), h('b', null, sp)),
          h('td', { class: 'num' }, ss.length), h('td', { class: 'num' }, TP.fmtKm(sum(ss, 'km'))), h('td', { class: 'num' }, TP.fmtH(sum(ss, 'h'))),
          h('td', null, h('span', { class: 'share' }, h('span', { style: 'width:' + share.toFixed(0) + '%;background:' + TP.SPORT_COLOURS[sp] })), h('span', { class: 'muted' }, ' ' + share.toFixed(0) + '%')),
          h('td', null, Object.keys(types).sort(function (a, b) { return types[b] - types[a]; }).map(function (t) { return h('span', { class: 'type-chip', style: 'border-color:' + TP.typeCol(t) }, t + ' ' + types[t]); })));
      })))) : h('p', { class: 'muted' }, 'No sessions planned in this block yet.');

    var weeks = rb.weeks.map(function (w, i) {
      var ws = weekSess(rb, w), ph = rb.phase[i], isNow = rb.cur === i + 1;
      var d = h('details', { class: 'rp-week' + (isNow ? ' now' : ''), open: isNow },
        h('summary', null, h('span', { class: 'wk-n' }, i + 1), h('span', { class: 'wk-d' }, TP.fmt(w, '%d %b') + ' – ' + TP.fmt(TP.addDays(w, 6), '%d %b')),
          h('span', { class: 'phase ' + ph.toLowerCase().replace(' ', '-') }, ph),
          h('span', { class: 'wk-sports' }, ws.length ? TP.SPORTS.filter(function (sp) { return ws.some(function (x) { return x.sport === sp; }); }).map(function (sp) {
            return h('span', null, h('i', { style: 'background:' + TP.SPORT_COLOURS[sp] }), sp + ' ' + ws.filter(function (x) { return x.sport === sp; }).length);
          }) : h('span', { class: 'muted' }, 'Nothing planned')),
          h('span', { class: 'wk-tot' }, ws.length ? [sum(ws, 'km') > 0 ? TP.fmtKm(sum(ws, 'km')) : null, TP.fmtH(sum(ws, 'h'))].filter(Boolean).join(' · ') : '')),
        ws.length ? h('div', { class: 'wk-body' }, ws.map(function (x) {
          return h('div', { class: 'wk-sess', onclick: function () { TP.sessionView(x.id); } },
            h('span', { class: 'sdot', style: 'background:' + TP.typeCol(x.type) }), h('span', { class: 'wk-sd' }, TP.fmt(x.date, '%a %d')),
            h('span', { class: 'grow strong' }, TP.sportLabel(x.discipline) + ' · ' + x.type), h('span', { class: 'wk-k' }, TP.planAmount(x)));
        })) : h('div', { class: 'muted wk-body' }, 'Rest week or nothing planned yet.'));
      return d;
    });

    var tabsBody = h('div');
    var overview = h('div', null,
      h('div', { class: 'panel' }, h('div', { class: 'panel-top' }, h('div', { class: 'panel-h' }, 'Planned training by week'),
        TP.chips([{ value: 'Time', label: 'Time' }, { value: 'Distance', label: 'Distance' }], TP.state.prefs.rpAxis || 'Time', function (v) { TP.state.prefs.rpAxis = v; TP.save(); drawChart(); }, 'seg')),
        h('div', { class: 'muted small' }, 'Stacked by sport. Time uses each session’s duration, or an estimate from its distance. Shaded weeks are taper and race week; the dashed line is this week.'),
        chartBox),
      h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, 'By sport'), sportTbl));
    var weeksTab = h('div', null, h('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Open a week to see its sessions.'), weeks);
    function tab(v) { TP.clear(tabsBody); tabsBody.appendChild(v === 'Weeks' ? weeksTab : overview); }

    var m = TP.modal({ size: 'xl',
      title: h('div', { class: 'rp-m-head', style: '--c:' + rb.col },
        h('div', null, h('div', { class: 'rp-type' }, rb.p.race_type.toUpperCase()), h('div', { class: 'md-t' }, rb.name),
          h('div', { class: 'rp-dates' }, TP.fmt(rb.start, '%d %b %Y') + ' – ' + TP.fmt(rb.race_date, '%d %b %Y') + ' · ' + rb.n + ' weeks · ' +
            (rb.p.race_type === 'Training Only' ? 'Final day: ' : 'Race day: ') + TP.fmt(rb.race_date, '%A %d %B %Y'))),
        h('div', { class: 'chips-r' }, prioChip(rb.p), statusChip(rb))),
      body: [
        h('div', { class: 'kpis kpis-4' }, kpi(s.length, 'Sessions'), kpi(TP.fmtKm(sum(s, 'km')), 'Planned distance'), bigBox,
          kpi(rb.status === 'Upcoming' ? TP.daysBetween(TP.today(), rb.start) + ' days' : rb.status === 'In progress' ? 'Week ' + rb.cur : 'Done', rb.status === 'Upcoming' ? 'Until it starts' : 'Progress')),
        TP.chips([{ value: 'Overview', label: 'Overview' }, { value: 'Weeks', label: 'Weeks' }], rb.status === 'In progress' ? 'Weeks' : 'Overview', tab, 'tabs'),
        tabsBody],
      footer: [h('button', { class: 'btn btn-sm', onclick: function () { TP.printPlan(bid); } }, TP.icon('download'), 'Download plan (PDF)'),
               h('span', { class: 'grow' }),
               h('button', { class: 'btn btn-sm', onclick: function () { m.close(); TP.eventForm(bid); } }, TP.icon('pencil'), 'Edit event'),
               h('button', { class: 'btn btn-primary btn-sm', onclick: function () { m.close(); } }, 'Close')] });
    drawChart(); tab(rb.status === 'In progress' ? 'Weeks' : 'Overview');
  };

  // --- Printable plan: cover, weekly overview, month calendars and every session in detail ---
  TP.printPlan = function (bid) {
    var rb = TP.reportBlock(bid); if (!rb) return;
    var e = TP.esc, s = rb.sess, p = rb.p;
    var fk = function (x) { return x > 0 ? TP.round(x, 1) + ' km' : ''; };
    var cols = TP.SPORTS.filter(function (sp) { return s.some(function (x) { return x.sport === sp; }); });
    var cell = function (xs, sp) { var y = xs.filter(function (x) { return x.sport === sp; }), k = sum(y, 'km'), mn = sum(y, 'duration_min'); return !y.length ? '' : k > 0 ? fk(k) : mn > 0 ? Math.round(mn) + ' min' : ''; };
    var rows = rb.weeks.map(function (w, i) {
      var xs = weekSess(rb, w), ph = rb.phase[i];
      return '<tr class="' + (ph !== 'Build' ? ph.toLowerCase().replace(' ', '-') : '') + '"><td class="wk">' + (i + 1) + '</td><td>' + TP.fmt(w, '%d %b') + ' – ' + TP.fmt(TP.addDays(w, 6), '%d %b') +
        '</td><td>' + ph + '</td><td class="num">' + xs.length + '</td>' + cols.map(function (sp) { return '<td class="num">' + cell(xs, sp) + '</td>'; }).join('') + '<td class="num"><b>' + fk(sum(xs, 'km')) + '</b></td></tr>';
    }).join('');
    var overview = '<table class="grid"><thead><tr><th>Wk</th><th>Dates</th><th>Phase</th><th class="num">Sessions</th>' +
      cols.map(function (sp) { return '<th class="num"><span class="sdot" style="background:' + TP.SPORT_COLOURS[sp] + '"></span>' + sp + '</th>'; }).join('') + '<th class="num">Total</th></tr></thead><tbody>' + rows +
      '<tr class="total"><td></td><td>Total</td><td></td><td class="num">' + s.length + '</td>' + cols.map(function (sp) { return '<td class="num">' + cell(s, sp) + '</td>'; }).join('') + '<td class="num"><b>' + fk(sum(s, 'km')) + '</b></td></tr></tbody></table>';
    var chipH = function (x) { return '<span class="chip" style="border-left-color:' + TP.typeCol(x.type) + '">' + e(TP.sportLabel(x.discipline) + ' ' + x.type) + (x.km > 0 ? ' <b>' + fk(x.km) + '</b>' : '') + '</span>'; };
    var months = [], mm = TP.monthStart(rb.start);
    while (mm <= TP.monthStart(TP.addDays(rb.weeks[rb.n - 1], 6))) { months.push(mm); mm = TP.addMonths(mm, 1); }
    var cal = months.map(function (m) {
      var d0 = TP.parse(m), nd = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate(), pad = (d0.getDay() + 6) % 7, cells = [];
      for (var k = 0; k < pad; k++) cells.push(null);
      for (var dd = 1; dd <= nd; dd++) cells.push(TP.iso(new Date(d0.getFullYear(), d0.getMonth(), dd)));
      while (cells.length % 7) cells.push(null);
      var ms = s.filter(function (x) { return TP.monthStart(x.date) === m; }), html = '';
      for (var r = 0; r < cells.length; r += 7) html += '<tr>' + cells.slice(r, r + 7).map(function (d) {
        if (!d) return '<td class="off"></td>';
        var inB = d >= rb.start && d <= rb.race_date, x = s.filter(function (y) { return y.date === d; });
        return '<td class="' + (!inB ? 'off ' : '') + (d === rb.race_date ? 'race' : '') + '"><div class="dn">' + TP.fmt(d, '%d') + '</div>' + (d === rb.race_date ? '<div class="racelbl">' + e(rb.name) + '</div>' : '') + x.map(chipH).join('') + '</td>';
      }).join('') + '</tr>';
      return '<div class="month"><h3>' + TP.fmt(m, '%B %Y') + '<span class="muted">' + ms.length + ' sessions · ' + fk(sum(ms, 'km')) + '</span></h3><table class="pcal"><thead><tr><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th></tr></thead><tbody>' + html + '</tbody></table></div>';
    }).join('');
    var details = rb.weeks.map(function (w, i) {
      var xs = weekSess(rb, w);
      return '<div class="week"><h3>Week ' + (i + 1) + ' · ' + TP.fmt(w, '%d %b') + ' – ' + TP.fmt(TP.addDays(w, 6), '%d %b %Y') + '<span class="muted">' + rb.phase[i] + ' · ' + xs.length + ' sessions · ' + fk(sum(xs, 'km')) + ' · ~' + sum(xs, 'h').toFixed(1) + ' h</span></h3>' +
        (xs.length ? xs.map(function (x) {
          var pts = TP.sessionOutline(x), right = [fk(x.km), x.duration_min > 0 ? x.duration_min + ' min' : ''].filter(Boolean).join(' · ');
          return '<div class="sess" style="border-left-color:' + TP.typeCol(x.type) + '"><div class="sh"><span class="t"><b>' + TP.fmt(x.date, '%A %d %b') + '</b> · ' + e(TP.sportLabel(x.discipline) + ' · ' + x.type) + '</span><span class="right">' + right + '</span></div>' +
            (pts.length ? '<ul>' + pts.map(function (t) { return '<li>' + e(t) + '</li>'; }).join('') + '</ul>' : '') + (x.details ? '<div class="notes">' + e(x.details) + '</div>' : '') + '</div>';
        }).join('') : '<p class="muted">Rest / nothing planned.</p>') + '</div>';
    }).join('');
    var root = document.getElementById('print-root');
    root.innerHTML = '<div class="pp"><div class="cover"><div class="muted">' + e(p.race_type.toUpperCase()) + '</div><h1>' + e(rb.name) + '</h1><div class="dates">' + TP.fmt(rb.start, '%d %b %Y') + ' – ' + TP.fmt(rb.race_date, '%d %b %Y') + ' · ' + rb.n + ' weeks</div>' +
      '<div class="raceday"><b>' + (p.race_type === 'Training Only' ? 'Final Day:' : 'Race Day:') + '</b>' + TP.fmt(rb.race_date, '%A %d %B %Y') + (p.priority && p.race_type !== 'Training Only' ? ' · Priority ' + p.priority + ' (' + TP.PRIORITY_LABELS[p.priority] + ')' : '') + '</div></div>' +
      '<h2>Weekly overview</h2>' + overview + '<div class="pb"><h2>Monthly overview</h2>' + cal + '</div><div class="pb"><h2>Session details</h2>' + details + '</div></div>';
    var title = document.title; document.title = rb.name.replace(/[^A-Za-z0-9]+/g, '_') + '_training_plan';
    document.body.classList.add('printing');
    var done = function () { document.body.classList.remove('printing'); root.innerHTML = ''; document.title = title; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 50);
  };
})(window.TP);
