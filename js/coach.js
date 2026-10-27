// The Garmin analysis page: a coach's report for a chosen period, the charts behind it, the weekly
// analysis, and the athlete's thresholds.
(function (TP) {
  var h = TP.h, A = TP.TA, C = TP.chart, fin = A.fin, sp = A.sprintf;
  var CO = TP.coach = {};
  var SEV = { risk: ['✕', '#ff3b30', 'Risk'], watch: ['!', '#d99a00', 'Watch'], good: ['✓', '#00a86b', 'Good'], info: ['i', '#2b4dff', 'Note'] };
  var CTL_COL = '#2b4dff', ATL_COL = '#c2255c';
  function kpi(v, l, s) { return h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, v), h('div', { class: 'kpi-l' }, l), s ? h('div', { class: 'kpi-s' }, s) : null); }
  function panel(title, sub) { var p = h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, title), sub ? h('div', { class: 'muted small' }, sub) : null); return p; }
  CO.panel = panel; CO.kpi = kpi;
  CO.formLabel = function (t) { return t > 25 ? 'Very fresh' : t > 5 ? 'Fresh' : t > -10 ? 'Neutral' : t > -30 ? 'Building fitness' : 'Very tired'; };
  CO.sportCol = function (d) { return A.SPORT_COLOURS[d] || '#585858'; };

  // --- Period ---
  var PRESETS = [{ value: '6w', label: '6 weeks', d: 42 }, { value: '12w', label: '12 weeks', d: 84 }, { value: '6m', label: '6 months', d: 182 }, { value: '1y', label: '1 year', d: 365 }, { value: 'all', label: 'All' }];
  TP.view.gperiod = TP.view.gperiod || { preset: '12w' };
  function period() {
    var p = TP.view.gperiod, today = TP.today(), acts = TP.garmin.acts;
    if (p.preset === 'custom' && p.from && p.to) return { from: p.from, to: p.to };
    var pr = PRESETS.filter(function (x) { return x.value === p.preset; })[0] || PRESETS[1];
    if (pr.value === 'all') return { from: acts.length ? acts[acts.length - 1].date : TP.addDays(today, -84), to: today };
    return { from: TP.addDays(today, -pr.d + 1), to: today };
  }

  CO.render = function (root) {
    var G = TP.garmin, ctx = G.ctx(), per = period();
    var from = TP.input('date', per.from), to = TP.input('date', per.to);
    var apply = h('button', { class: 'btn btn-sm', onclick: function () { if (from.value && to.value && from.value <= to.value) { TP.view.gperiod = { preset: 'custom', from: from.value, to: to.value }; TP.changed(); } } }, 'Show');
    root.appendChild(h('div', { class: 'filter-row' },
      TP.chips(PRESETS.map(function (x) { return { value: x.value, label: x.label }; }), TP.view.gperiod.preset, function (v) { TP.view.gperiod = { preset: v }; TP.changed(); }, 'seg'),
      h('div', { class: 'filter-custom' }, from, h('span', { class: 'muted' }, 'to'), to, apply)));
    var r = A.analyse(ctx.scored, ctx.feats, ctx.prof, per.from, per.to, TP.match.compliance(per.from, per.to));
    if (r.empty) { root.appendChild(h('div', { class: 'empty' }, h('h3', null, 'No activities in this period'), h('p', null, 'Pick another period, or sync it from Garmin above.'))); return; }
    var last = r.load[r.load.length - 1], first = r.load[0], nW = Math.max(1, (TP.daysBetween(per.from, per.to) + 1) / 7);
    var hours = A.sum(r.acts.map(function (a) { return a.hours; })), tss = A.sum(r.acts.map(function (a) { return a.tss; }));
    // Charts first: fitness / fatigue / form and weekly load, then the numbers and the coach's report.
    root.appendChild(h('div', { class: 'coach-2' }, pmc(r), weeklyLoad(r)));
    root.appendChild(h('div', { class: 'kpis kpis-6' },
      kpi(Math.round(last.ctl), 'Fitness (CTL)', sp('%+.0f over the period', last.ctl - first.ctl)),
      kpi(Math.round(last.atl), 'Fatigue (ATL)', 'last 7 days'),
      kpi(sp('%+.0f', last.tsb), 'Form (TSB)', CO.formLabel(last.tsb)),
      kpi(sp('%.1f h', hours / nW), 'Hours a week', sp('%.1f sessions', r.acts.length / nW)),
      kpi(Math.round(tss / nW), 'TSS a week', 'training stress'),
      kpi(r.dist_all.type === 'No data' ? '–' : r.dist_all.type.replace(' / low-intensity focus', ''), 'Intensity mix', fin(r.dist_all.p1) ? sp('%.0f / %.0f / %.0f %%', r.dist_all.p1, r.dist_all.p2, r.dist_all.p3) : null)));

    var grid = h('div', { class: 'coach-grid' }), left = h('div'), right = h('div');
    grid.appendChild(left); grid.appendChild(right); root.appendChild(grid);
    left.appendChild(report(r));
    right.appendChild(intensity(r));
    root.appendChild(weeksTable(r, ctx));
    var perfRow = h('div', { class: 'coach-2' });
    if (r.pcurve) perfRow.appendChild(powerCurve(r));
    if (r.scurve) perfRow.appendChild(paceCurve(r));
    if (perfRow.children.length) root.appendChild(perfRow);
    if (r.best_efforts) root.appendChild(runPerf(r));
    if (r.ef.data.length) root.appendChild(efChart(r));
    var rec = recovery(ctx.wellness, per.from, per.to); if (rec) root.appendChild(rec);
    if (r.compliance) root.appendChild(compliance(r.compliance));
    root.appendChild(h('p', { class: 'hint' }, 'Thresholds used: FTP ' + ctx.prof.ftp + ' W · threshold pace ' + A.fmtPace(ctx.prof.thr_pace_s_km) + ' /km · CSS ' + A.fmtPace(ctx.prof.css_s_100) + ' /100 m · threshold HR ' + ctx.prof.lthr + ' bpm. Check or change them in Settings → Training thresholds.'));
  };

  // --- Coach's report ---
  CO.insightList = function (items) {
    return h('div', { class: 'insights' }, items.map(function (x) {
      var s = SEV[x.severity] || SEV.info;
      return h('div', { class: 'insight' }, h('span', { class: 'sev', style: 'background:' + s[1], title: s[2] }, s[0]),
        h('div', null, h('div', { class: 'ins-cat' }, x.category + ' · ' + s[2]), h('div', { class: 'ins-t' }, x.title), h('div', { class: 'ins-d' }, x.detail),
          x.action ? h('div', { class: 'ins-a' }, '→ ' + x.action) : null));
    }));
  };
  function report(r) {
    var p = panel('Coach’s report', 'What stands out in this period, most important first.');
    p.appendChild(CO.insightList(r.insights));
    return p;
  }

  // --- Fitness, fatigue and form ---
  CO.pmcChart = function (load, opts) {
    opts = opts || {};
    var done = load.filter(function (d) { return d.kind !== 'Planned'; }), plan = load.filter(function (d) { return d.kind === 'Planned'; });
    if (plan.length && done.length) plan = [done[done.length - 1]].concat(plan);
    var series = [
      { name: 'Form (TSB)', col: '#9aa7b4', kind: 'bar', barW: 0.9, pts: load.map(function (d) { return [d.date, d.tsb, d.tsb >= 0 ? (d.kind === 'Planned' ? '#b3e5d1' : '#00a86b') : (d.kind === 'Planned' ? '#dcdcdc' : '#9aa7b4')]; }), fmt: function (v) { return sp('%+.0f', v); } },
      { name: 'Fitness (CTL)', col: CTL_COL, pts: done.map(function (d) { return [d.date, d.ctl]; }), width: 2.2 },
      { name: 'Fatigue (ATL)', col: ATL_COL, pts: done.map(function (d) { return [d.date, d.atl]; }), width: 1.6 }];
    if (plan.length) series.push({ name: 'Fitness, planned', col: CTL_COL, dash: '5 4', pts: plan.map(function (d) { return [d.date, d.ctl]; }) },
      { name: 'Fatigue, planned', col: ATL_COL, dash: '5 4', width: 1.4, pts: plan.map(function (d) { return [d.date, d.atl]; }) });
    return C.xy({ height: opts.height || 230, x: { type: 'date' }, y: { fmt: function (v) { return Math.round(v); }, zero: true }, series: series, bands: opts.bands, vlines: opts.vlines });
  };
  function pmc(r) {
    var p = panel('Fitness, fatigue and form', 'Fitness = 42-day training load, fatigue = last 7 days, form = fitness minus fatigue (above zero is fresh). All in TSS a day.');
    p.appendChild(CO.pmcChart(r.load));
    return p;
  }

  // --- Weekly load by sport ---
  CO.weeklyChart = function (rows, metric, opts) {
    // rows: [{week, discipline, tss, hours, kind}]
    opts = opts || {};
    var sports = ['Swim', 'Bike', 'Run', 'Other'].filter(function (d) { return rows.some(function (x) { return x.discipline === d; }); }), series = [];
    ['Done', 'Planned'].forEach(function (kind) {
      sports.forEach(function (d) {
        var x = rows.filter(function (y) { return y.discipline === d && (y.kind || 'Done') === kind; }); if (!x.length) return;
        var wk = {}; x.forEach(function (y) { wk[y.week] = (wk[y.week] || 0) + y[metric]; });
        series.push({ name: d + (kind === 'Planned' ? ' (planned)' : ''), noLegend: kind === 'Planned', col: CO.sportCol(d), kind: 'bar', stack: true, barW: 5, alpha: kind === 'Planned' ? 0.35 : null,
          pts: Object.keys(wk).sort().map(function (k) { return [TP.addDays(k, 3), wk[k]]; }), fmt: function (v) { return metric === 'hours' ? v.toFixed(1) + ' h' : Math.round(v) + ' TSS'; } });
      });
    });
    return C.xy({ height: opts.height || 200, x: { type: 'date' }, y: { fmt: function (v) { return metric === 'hours' ? v.toFixed(v < 10 ? 1 : 0) : Math.round(v); }, zero: true, min: 0 }, series: series,
      tipX: function (v) { var d = C.dstr(v); return 'Week of ' + TP.fmt(TP.weekStart(d), '%d %b'); }, vlines: opts.vlines });
  };
  function weeklyLoad(r) {
    var p = panel('Weekly training load', 'Training stress each week, by sport.');
    var rows = r.acts.map(function (a) { return { week: a.week, discipline: a.discipline === 'Transition' ? 'Other' : a.discipline, tss: a.tss, hours: a.hours }; });
    var box = h('div'), metric = 'tss';
    function draw() { TP.clear(box); box.appendChild(CO.weeklyChart(rows, metric)); }
    p.firstChild.after(TP.chips([{ value: 'tss', label: 'TSS' }, { value: 'hours', label: 'Hours' }], metric, function (v) { metric = v; draw(); }, 'seg seg-r'));
    p.appendChild(box); draw();
    return p;
  }

  // --- Intensity distribution ---
  function intensity(r) {
    var d = r.dist_all, p = panel('Intensity distribution', 'Seiler’s three zones: easy (below the first lactate threshold), threshold, and hard (above threshold). Most endurance training should be easy.');
    var Z = A.ZONE_COLOURS, names = ['Easy', 'Threshold', 'Hard'], row = function (label, z1, z2, z3) {
      return h('div', { class: 'zone-row' }, h('span', { class: 'zone-l' }, label), C.split([z1, z2, z3].map(function (v, i) { return { label: names[i], value: v, col: Z[i] }; }), function (v) { return Math.round(v / 3600 * 10) / 10 + ' h'; }));
    };
    p.appendChild(h('div', { class: 'dist-head' }, h('b', null, d.type), fin(d.pi) ? h('span', { class: 'muted small' }, sp(' · Polarization Index %.2f', d.pi)) : null));
    p.appendChild(row('All', A.sum(r.acts.map(function (a) { return a.z1; })), A.sum(r.acts.map(function (a) { return a.z2; })), A.sum(r.acts.map(function (a) { return a.z3; }))));
    r.dist_sport.filter(function (x) { return x.z1 + x.z2 + x.z3 > 0 && x.discipline !== 'Transition'; }).forEach(function (x) { p.appendChild(row(x.discipline, x.z1, x.z2, x.z3)); });
    p.appendChild(h('div', { class: 'legend small' }, names.map(function (n, i) { return h('span', null, h('i', { style: 'background:' + Z[i] }), n); })));
    return p;
  }

  // --- Weeks ---
  var VCOL = { 'Strong week': '#00a86b', 'Solid week': '#2b4dff', 'Mixed week': '#d99a00', 'Off track': '#ff3b30', 'In progress': '#7227b8', Upcoming: '#999999' };
  CO.verdictChip = function (v) { return h('span', { class: 'vchip', style: 'color:' + (VCOL[v] || '#666') + ';border-color:' + (VCOL[v] || '#666') }, v); };
  CO.weekRows = function (weeks, sessions, ctx, label, blockId) {
    var links = TP.match.linkMaps();
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Week'), h('th', null, 'Verdict'), h('th', { class: 'num' }, 'Planned done'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Distance'),
        h('th', { class: 'num' }, 'TSS'), h('th', { class: 'num' }, 'Easy'), h('th', { class: 'num' }, 'Fitness (CTL)'), h('th', { class: 'num' }, 'Sleep'), h('th', { class: 'num' }, 'Flags'))),
      h('tbody', null, weeks.slice().reverse().map(function (w, i) {
        var wa = A.weekAnalysis(ctx.scored, ctx.wellness, sessions, links, w);
        return h('tr', { class: 'click', onclick: function () { CO.openWeek(w, blockId, label ? label(w) : null); } },
          h('td', null, h('b', null, label ? label(w) : TP.fmt(w, '%d %b')), h('div', { class: 'muted small' }, TP.fmt(w, '%d %b') + ' – ' + TP.fmt(TP.addDays(w, 6), '%d %b'))),
          h('td', null, CO.verdictChip(wa.verdict), fin(wa.score) ? h('span', { class: 'muted small' }, ' ' + wa.score) : null),
          h('td', { class: 'num' }, wa.due_n ? wa.done_n + ' / ' + wa.due_n : wa.planned_n ? '–' : wa.n + ' done'),
          h('td', { class: 'num' }, wa.hours.toFixed(1) + ' h'), h('td', { class: 'num' }, Math.round(wa.km) + ' km'), h('td', { class: 'num' }, Math.round(wa.tss)),
          h('td', { class: 'num' }, wa.dist && fin(wa.dist.p1) ? Math.round(wa.dist.p1) + '%' : '–'),
          h('td', { class: 'num' }, fin(wa.ctl_end) ? sp('%.0f (%+.1f)', wa.ctl_end, wa.ctl_end - (fin(wa.ctl_start) ? wa.ctl_start : wa.ctl_end)) : '–'),
          h('td', { class: 'num' }, fin(wa.sleep_h) ? wa.sleep_h.toFixed(1) + ' h' : '–'),
          h('td', { class: 'num', style: wa.warn.length ? 'color:#b88305;font-weight:700' : 'color:#999' }, wa.warn.length));
      }))));
  };
  function weeksTable(r, ctx) {
    var weeks = [], w = TP.weekStart(r.from);
    for (; w <= r.to; w = TP.addDays(w, 7)) weeks.push(w);
    var p = panel('Week by week', 'Each Monday–Sunday week scored against your plan and your body’s response. Click a week for its full analysis.');
    p.appendChild(CO.weekRows(weeks, TP.state.sessions, ctx));
    return p;
  }
  // --- One week's full analysis (as the R app's week page) ---
  // blockId: a calendar block, so only its planned sessions count; label: e.g. "Week 3 of Test 10K".
  CO.openWeek = function (wk, blockId, label) { TP.openPage({ kind: 'week', wk: wk, blockId: blockId || '', label: label || null, title: label || 'Week of ' + TP.fmt(wk, '%d %b') }); };
  var VTEXT = { 'Strong week': '#00a86b', 'Solid week': '#2b4dff', 'Mixed week': '#d99a00', 'Off track': '#ff3b30', 'In progress': '#9b30ff' };
  TP.pages.week = function (root, p) {
    var ctx = TP.garmin.ctx(), M = TP.match, wk = p.wk;
    var sessions = p.blockId ? TP.state.sessions.filter(function (s) { return s.block_id === p.blockId; }) : TP.state.sessions;
    var wa = A.weekAnalysis(ctx.scored, ctx.wellness, sessions, M.linkMaps(), wk), col = VTEXT[wa.verdict] || '#999';
    var top = ctx.scored.filter(function (a) { return a.date >= wk && a.date <= TP.addDays(wk, 6); }), ids = [];
    top.forEach(function (a) { var id = a.parent_id || a.id; if (ids.indexOf(id) < 0) ids.push(id); });
    root.appendChild(h('div', { class: 'act-head', style: '--c:' + col },
      h('div', null, h('div', { class: 'rp-type', style: 'color:' + col }, wa.verdict), h('h2', null, p.label || 'Week of ' + TP.fmt(wk, '%d %B')),
        h('div', { class: 'muted' }, TP.fmt(wk, '%A %d %B') + ' – ' + TP.fmt(TP.addDays(wk, 6), '%A %d %B %Y'))),
      h('div', { class: 'btn-row' }, ids.length ? h('button', { class: 'btn btn-sm needs-edit', onclick: function () { CO.copyWeek(wk, ids); } }, TP.icon('copy'), 'Copy week to planner') : null, TP.glossaryButton())));
    if (wa.status === 'upcoming') { root.appendChild(h('p', { class: 'muted' }, 'This week hasn’t started yet – its analysis appears once you start training.')); return; }
    var tiles = [kpi(fin(wa.score) ? wa.score : '–', 'Week score', wa.verdict),
      kpi(wa.hours.toFixed(1) + ' h', 'Training time', wa.prev_hours > 0 ? sp('%+.0f%% vs week before', (wa.hours / wa.prev_hours - 1) * 100) : null),
      kpi(Math.round(wa.km) + ' km', 'Distance', wa.n + (wa.n === 1 ? ' activity' : ' activities')),
      kpi(Math.round(wa.tss), 'Load (TSS)', wa.hard > 0 ? wa.hard + ' hard session' + (wa.hard > 1 ? 's' : '') : null)];
    if (wa.due_n > 0) tiles.push(kpi(wa.done_n + ' / ' + wa.due_n, 'Planned sessions done', wa.planned_km > 0 ? Math.round(wa.planned_km) + ' km planned' : null));
    if (fin(wa.ctl_end)) tiles.push(kpi(Math.round(wa.ctl_end), 'Fitness (CTL)', fin(wa.ctl_start) ? sp('%+.1f this week', wa.ctl_end - wa.ctl_start) : null));
    if (fin(wa.sleep_h)) tiles.push(kpi(wa.sleep_h.toFixed(1) + ' h', 'Sleep a night', fin(wa.sleep_score) ? 'score ' + Math.round(wa.sleep_score) : null));
    if (fin(wa.hrv)) tiles.push(kpi(Math.round(wa.hrv) + ' ms', 'Overnight HRV', fin(wa.hrv_base) ? '4-wk baseline ' + Math.round(wa.hrv_base) : null));
    root.appendChild(h('div', { class: 'kpi-grid' }, tiles));
    root.appendChild(h('div', { class: 'coach-2', style: 'margin-top:12px' },
      h('div', null, h('h3', { class: 'sec-h' }, '✓ What went well'), CO.list(wa.good, 'good')),
      h('div', null, h('h3', { class: 'sec-h' }, '! Watch or change'), CO.list(wa.warn, 'watch'))));
    var d = wa.dist;
    if (d && fin(d.p1)) {
      root.appendChild(h('h3', { class: 'sec-h' }, 'Intensity'));
      root.appendChild(C.split([{ label: 'Easy', value: d.p1, col: A.ZONE_COLOURS[0] }, { label: 'Moderate', value: d.p2, col: A.ZONE_COLOURS[1] }, { label: 'Hard', value: d.p3, col: A.ZONE_COLOURS[2] }]));
      root.appendChild(h('div', { class: 'muted small' }, sp('Easy %.0f%% · Moderate %.0f%% · Hard %.0f%% — %s', d.p1, d.p2, d.p3, d.type)));
    }
    if (wa.planned.length) {
      root.appendChild(h('h3', { class: 'sec-h' }, 'Plan vs. done'));
      root.appendChild(h('p', { class: 'muted small sec-sub' }, 'Planned sessions matched to what Garmin recorded. Click a session to open it.'));
      root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', null, 'Planned'), h('th', null, 'Plan'), h('th', null, 'What happened'))),
        h('tbody', null, wa.planned.map(function (s) {
          var l = M.linkFor(s.id), st = M.status(s), due = s.date < TP.today() || wa.status === 'complete';
          var what = l ? h('span', { class: st && st.st === 'partial' ? 'st-tick st-partial' : 'st-tick st-done' }, (st && st.st === 'partial' ? '◐ ' : '✓ ') + (l.act.name || 'Activity') + (l.act.distance_m > 50 ? sp(' · %.1f km', l.act.distance_m / 1000) : '') + ' · ' + TP.fmtDuration(l.act.moving_s || 0))
            : due ? h('span', { class: 'st-tick st-missed' }, '✕ Missed') : h('span', { class: 'muted' }, 'Coming up');
          return h('tr', { class: 'click', onclick: function () { TP.sessionView(s.id); } }, h('td', { class: 'nowrap' }, TP.fmt(s.date, '%a %d %b')),
            h('td', null, h('span', { class: 'sdot', style: 'background:' + TP.typeCol(s.type) }), TP.sportLabel(s.discipline) + ' · ' + s.type),
            h('td', null, s.total_dist > 0 ? TP.round(s.total_dist, 2) + ' km' : s.duration_min > 0 ? s.duration_min + ' min' : '–'), h('td', null, what));
        })))));
    }
    if (wa.by_sport.length) {
      root.appendChild(h('h3', { class: 'sec-h' }, 'By sport'));
      root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Sport'), h('th', { class: 'num' }, 'Sessions'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, 'TSS'), h('th', { class: 'num' }, 'Longest'))),
        h('tbody', null, wa.by_sport.map(function (x) {
          return h('tr', null, h('td', null, h('span', { class: 'sdot', style: 'background:' + CO.sportCol(x.discipline) }), h('b', null, x.discipline)), h('td', { class: 'num' }, x.sessions),
            h('td', { class: 'num' }, A.fmtDur(x.hours * 3600)), h('td', { class: 'num' }, x.km > 0 ? x.km.toFixed(1) + ' km' : '–'), h('td', { class: 'num' }, Math.round(x.tss)), h('td', { class: 'num' }, A.fmtDur(x.longest_h * 3600)));
        })))));
    }
    if (wa.acts.length) {
      root.appendChild(h('h3', { class: 'sec-h' }, 'Activities'));
      root.appendChild(h('p', { class: 'muted small sec-sub' }, 'Click an activity for its full breakdown. Save turns it into a template or a planned session.'));
      root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', null, 'Activity'), h('th', null, 'Sport'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, 'TSS'), h('th', null, ''))),
        h('tbody', null, wa.acts.map(function (a) {
          var id = a.parent_id || a.id, planned = M.sessionForAct(id);
          return h('tr', { class: 'click', onclick: function () { TP.activityView(id); } }, h('td', { class: 'nowrap' }, TP.fmt(a.date, '%a %d %b')), h('td', null, a.name), h('td', null, a.discipline),
            h('td', { class: 'num' }, TP.fmtDuration(a.moving_s || 0)), h('td', { class: 'num' }, a.km > 0 ? a.km.toFixed(1) + ' km' : '–'), h('td', { class: 'num' }, Math.round(a.tss || 0)),
            h('td', { class: 'nowrap' }, planned ? null : h('span', { class: 'unplanned' }, 'Unplanned'),
              h('button', { class: 'btn btn-sm btn-xs needs-edit', onclick: function (e) { e.stopPropagation(); TP.saveActivity(a.id); } }, TP.icon('bookmark'), 'Save')));
        })))));
    }
  };
  // The week's Garmin sessions as planned sessions, ready to paste into another week in the calendar.
  CO.copyWeek = function (wk, ids) {
    var ctx = TP.garmin.ctx(), list = [];
    ids.forEach(function (id) {
      var rows = TP.garmin.scoredFor(id), row = rows.length === 1 ? rows[0] : null; if (!row) return;
      var x = A.activityToPlan(row, ctx.feats[row.id]); if (!x) return;
      list.push(TP.normaliseSession(Object.assign({ id: 'g' + id, date: row.date, block_id: '' }, x)));
    });
    if (!list.length) { TP.toast('None of these activities has a planner sport (Swim, Run, Bike, Hyrox or Gym).', 'warn'); return; }
    TP.clip.week = { start: wk, sessions: list };
    TP.toast('Copied ' + list.length + ' Garmin sessions from the week of ' + TP.fmt(wk, '%d %b %Y') + '. In the Calendar, pick a day in the week you want and press Paste week.');
  };

  CO.list = function (items, kind) {
    if (!items || !items.length) return h('p', { class: 'muted small' }, 'Nothing flagged.');
    var s = SEV[kind] || SEV.info;
    return h('ul', { class: 'flist' }, items.map(function (x) { return h('li', null, h('span', { class: 'sev sev-s', style: 'background:' + s[1] }, s[0]), h('span', null, x)); }));
  };

  // --- Power and pace curves ---
  function powerCurve(r) {
    var pc = r.pcurve, p = panel('Power curve', 'Your best average power for each duration, first and second half of the period.');
    var ticks = [5, 15, 60, 300, 1200, 3600, 7200];
    var mk = function (k) { return pc.filter(function (x) { return fin(x[k]); }).map(function (x) { return [x.duration, x[k]]; }); };
    p.appendChild(C.xy({ height: 220, x: { type: 'log', ticks: ticks, fmt: function (v) { return A.durLabel(Math.round(Math.exp(v))); } }, tipX: function (v) { return 'Best ' + A.durLabel(Math.round(Math.exp(v))); },
      y: { fmt: function (v) { return Math.round(v); } },
      series: [{ name: 'Whole period', col: '#111111', pts: mk('all'), width: 2.4 }, { name: 'First half', col: '#8fb0c2', pts: mk('first'), width: 1.6 }, { name: 'Second half', col: '#00a86b', pts: mk('second'), width: 1.6 }].map(function (s) { s.fmt = function (v) { return Math.round(v) + ' W'; }; return s; }) }));
    if (r.cp_fit) p.appendChild(h('div', { class: 'small' }, sp("Critical power %.0f W · W′ %.1f kJ (R² %.3f) · modelled FTP ≈ %.0f W", r.cp_fit.cp, r.cp_fit.w_prime / 1000, r.cp_fit.r2, 0.97 * r.cp_fit.cp)));
    return p;
  }
  function paceCurve(r) {
    var sc = r.scurve, p = panel('Run pace curve', 'Your fastest average pace for each duration, first and second half of the period. Faster is higher.');
    var mk = function (k) { return sc.filter(function (x) { return fin(x[k]) && x[k] > 0; }).map(function (x) { return [x.duration, 1000 / x[k]]; }); };
    p.appendChild(C.xy({ height: 220, x: { type: 'log', ticks: [30, 60, 300, 1200, 3600], fmt: function (v) { return A.durLabel(Math.round(Math.exp(v))); } }, tipX: function (v) { return 'Best ' + A.durLabel(Math.round(Math.exp(v))); },
      y: { fmt: A.fmtPace, invert: true },
      series: [{ name: 'Whole period', col: '#111111', pts: mk('all'), width: 2.4 }, { name: 'First half', col: '#ff938d', pts: mk('first'), width: 1.6 }, { name: 'Second half', col: '#ff3b30', pts: mk('second'), width: 1.6 }].map(function (s) { s.fmt = function (v) { return A.fmtPace(v) + ' /km'; }; return s; }) }));
    if (r.cs_fit && r.cs_fit.cp > 2) p.appendChild(h('div', { class: 'small' }, sp("Critical speed %s /km · D′ %.0f m (R² %.3f)", A.fmtPace(1000 / r.cs_fit.cp), r.cs_fit.w_prime, r.cs_fit.r2)));
    return p;
  }
  function runPerf(r) {
    var p = panel('Best runs and race predictions', 'Fastest stretches in this period, and what they predict (critical speed model and Riegel, whichever is faster).');
    p.appendChild(h('div', { class: 'coach-2' },
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Best effort'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Pace'), h('th', null, 'When'))),
        h('tbody', null, r.best_efforts.map(function (b) { return h('tr', { class: 'click', onclick: function () { TP.activityView(b.id.replace(/_leg\d+$/, '')); } }, h('td', null, h('b', null, b.distance)), h('td', { class: 'num' }, A.fmtDur(b.time_s)), h('td', { class: 'num' }, b.pace + ' /km'), h('td', { class: 'small' }, TP.fmt(b.date, '%d %b %Y'))); })))),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Race'), h('th', { class: 'num' }, 'Predicted'), h('th', { class: 'num' }, 'Pace'), h('th', null, 'Based on'))),
        h('tbody', null, r.predictions.map(function (x) { return h('tr', null, h('td', null, h('b', null, x.distance)), h('td', { class: 'num' }, A.fmtDur(x.time_s)), h('td', { class: 'num' }, x.pace + ' /km'), h('td', { class: 'small muted' }, x.method)); }))))));
    return p;
  }
  function efChart(r) {
    var p = panel('Aerobic efficiency', 'Efficiency factor on easy sessions of 30 min or more: output (normalised power, or grade-adjusted pace) per heartbeat. Rising means fitter.');
    var series = [];
    ['Run', 'Bike'].forEach(function (d) {
      var x = r.ef.data.filter(function (a) { return a.discipline === d; }); if (!x.length) return;
      series.push({ name: d, col: CO.sportCol(d), kind: 'dots', r: 4, pts: x.map(function (a) { return [a.date, a.ef]; }), fmt: function (v) { return v.toFixed(2); } });
      var t = r.ef.trends.filter(function (y) { return y.discipline === d; })[0];
      if (t) {
        var d0 = x[0].date, d1 = x[x.length - 1].date, m = t.mean_ef, mx = A.mean(x.map(function (a) { return C.dnum(a.date); }));
        series.push({ name: d + ' trend', col: CO.sportCol(d), dash: '6 4', width: 1.6, hideTip: true, noLegend: true, pts: [[d0, m + t.slope * (C.dnum(d0) - mx)], [d1, m + t.slope * (C.dnum(d1) - mx)]] });
      }
    });
    p.appendChild(C.xy({ height: 200, x: { type: 'date' }, y: { fmt: function (v) { return v.toFixed(2); } }, series: series }));
    if (r.ef.trends.length) p.appendChild(h('div', { class: 'small' }, r.ef.trends.map(function (t) { return sp('%s: %+.1f%% per 4 weeks over %d sessions', t.discipline, t.pct_per_4wk, t.n); }).join(' · ')));
    return p;
  }
  // --- Sleep and HRV ---
  CO.recoveryCharts = function (w, from, to, opts) {
    opts = opts || {};
    var out = h('div'), hrv = w.filter(function (x) { return fin(x.hrv); }), sl = w.filter(function (x) { return fin(x.sleep_h); });
    if (hrv.length >= 3) {
      var avg7 = hrv.map(function (x, i) { var win = hrv.filter(function (y) { return y.date > TP.addDays(x.date, -7) && y.date <= x.date; }); return [x.date, A.mean(win.map(function (y) { return y.hrv; }))]; });
      var series = [{ name: 'Overnight HRV', col: '#9b30ff', kind: 'dots', r: 2.6, pts: hrv.map(function (x) { return [x.date, x.hrv]; }), fmt: function (v) { return Math.round(v) + ' ms'; } },
        { name: '7-day average', col: '#9b30ff', pts: avg7, fmt: function (v) { return Math.round(v) + ' ms'; } }];
      var band = hrv.filter(function (x) { return fin(x.hrv_low) && fin(x.hrv_high); });
      if (band.length) series.unshift({ name: 'Normal range (low)', col: '#00a86b', width: 1, dash: '2 3', pts: band.map(function (x) { return [x.date, x.hrv_low]; }), fmt: function (v) { return Math.round(v) + ' ms'; } },
        { name: 'Normal range (high)', col: '#00a86b', width: 1, dash: '2 3', pts: band.map(function (x) { return [x.date, x.hrv_high]; }), fmt: function (v) { return Math.round(v) + ' ms'; } });
      out.appendChild(C.xy({ title: 'Overnight HRV (ms)', height: 180, x: { type: 'date', min: from, max: to }, y: { fmt: function (v) { return Math.round(v); } }, series: series, bands: opts.bands }));
    }
    if (sl.length >= 3) out.appendChild(C.xy({ title: 'Sleep a night (hours; dashed line = 8 h)', height: 150, x: { type: 'date', min: from, max: to }, y: { fmt: function (v) { return v.toFixed(0); }, zero: true, min: 0 },
      series: [{ name: 'Sleep', col: '#6f93ad', kind: 'bar', barW: 0.85, pts: sl.map(function (x) { return [x.date, x.sleep_h, x.sleep_h >= 8 ? '#6f93ad' : x.sleep_h >= 7 ? '#a9c0cf' : '#ffb400']; }), fmt: function (v) { return v.toFixed(1) + ' h'; } }],
      hlines: [{ y: 8, col: '#111', dash: '4 3' }], bands: opts.bands }));
    var rhr = w.filter(function (x) { return fin(x.rhr); });
    if (rhr.length >= 3) out.appendChild(C.xy({ title: 'Resting heart rate (bpm)', height: 130, x: { type: 'date', min: from, max: to }, y: { fmt: function (v) { return Math.round(v); } },
      series: [{ name: 'Resting HR', col: '#d6336c', pts: rhr.map(function (x) { return [x.date, x.rhr]; }), width: 1.6, fmt: function (v) { return Math.round(v) + ' bpm'; } }], bands: opts.bands }));
    return out.children.length ? out : null;
  };
  function recovery(wellness, from, to) {
    var w = (wellness || []).filter(function (x) { return x.date >= from && x.date <= TP.addDays(to, 1); });
    if (w.filter(function (x) { return fin(x.sleep_h) || fin(x.hrv); }).length < 3) return null;
    var p = panel('Sleep and recovery', 'Nightly sleep, overnight heart-rate variability and resting heart rate from Garmin. HRV falls when training stress outpaces recovery.');
    var m = function (k) { return A.mean(w.map(function (x) { return x[k]; })); };
    p.appendChild(h('div', { class: 'kpis kpis-4' }, kpi(fin(m('sleep_h')) ? m('sleep_h').toFixed(1) + ' h' : '–', 'Average sleep'), kpi(fin(m('sleep_score')) ? Math.round(m('sleep_score')) : '–', 'Sleep score'),
      kpi(fin(m('hrv')) ? Math.round(m('hrv')) + ' ms' : '–', 'Overnight HRV'), kpi(fin(m('rhr')) ? Math.round(m('rhr')) + ' bpm' : '–', 'Resting HR')));
    var ch = CO.recoveryCharts(w, from, to); if (ch) p.appendChild(ch);
    return p;
  }
  function compliance(c) {
    var p = panel('Plan compliance', 'Planned sessions in this period that were due, and the Garmin activities linked to them.');
    p.appendChild(h('div', { class: 'kpis kpis-3' }, kpi(Math.round(c.completion) + '%', 'Sessions completed', c.done + ' of ' + c.planned), kpi(Math.round(c.volume) + '%', 'Of planned distance'), kpi(c.planned - c.done, 'Missed')));
    p.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Sport'), h('th', { class: 'num' }, 'Done'), h('th', { class: 'num' }, 'Planned km'), h('th', { class: 'num' }, 'Actual km'))),
      h('tbody', null, c.by_disc.map(function (x) { return h('tr', null, h('td', null, x.disc), h('td', { class: 'num' }, x.done + ' / ' + x.planned), h('td', { class: 'num' }, Math.round(x.planned_km)), h('td', { class: 'num' }, Math.round(x.actual_km))); })))));
    return p;
  }

  // --- Thresholds ---
  CO.thresholds = function (root) {
    var ctx = TP.garmin.ctx(), prof = ctx.prof, ov = Object.assign({}, ctx.overrides), gp = ctx.garminProfile || {};
    var p = panel('Your thresholds', 'Training stress, zones and race predictions are worked out from these. They’re estimated from your activities (and Garmin’s own settings); enter a tested value to use that instead. Saved with your account.');
    var src = prof.sources, rows = [
      ['lthr', 'Threshold heart rate', 'bpm', prof.lthr, src.lthr],
      ['hrmax', 'Maximum heart rate', 'bpm', prof.hrmax, src.hrmax],
      ['hrrest', 'Resting heart rate', 'bpm', prof.hrrest, src.hrrest],
      ['ftp', 'Cycling FTP', 'W', prof.ftp, src.ftp],
      ['thr_pace_s_km', 'Threshold run pace', '/km', A.fmtPace(prof.thr_pace_s_km), src.thr_speed, true],
      ['css_s_100', 'Swim CSS', '/100 m', A.fmtPace(prof.css_s_100), src.css, true]];
    var inputs = {};
    p.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl thr' }, h('thead', null, h('tr', null, h('th', null, 'Threshold'), h('th', { class: 'num' }, 'In use'), h('th', null, 'Where it comes from'), h('th', null, 'Your value'))),
      h('tbody', null, rows.map(function (r) {
        var cur = ov[r[0]], inp = TP.input('text', cur ? (r[5] ? A.fmtPace(cur) : cur) : '', { placeholder: r[5] ? 'm:ss' : '', inputmode: r[5] ? 'text' : 'numeric', class: 'inp inp-sm' });
        inputs[r[0]] = { el: inp, pace: r[5] };
        return h('tr', null, h('td', null, h('b', null, r[1])), h('td', { class: 'num' }, r[3] + ' ' + r[2]), h('td', { class: 'small muted' }, r[4] || ''), h('td', null, h('span', { class: 'thr-in' }, inp, h('span', { class: 'muted small' }, r[2]))));
      })))));
    var gender = TP.selectEl([{ value: '', label: 'From Garmin (' + (gp.gender ? String(gp.gender).toLowerCase() : 'not set') + ')' }, { value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }], ov.gender || '', { class: 'inp inp-sm' });
    p.appendChild(h('div', { class: 'thr-g' }, h('span', { class: 'small' }, 'Sex (for heart-rate training stress):'), gender));
    p.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', { class: 'btn btn-primary', onclick: function () {
        var out = {}, bad = false;
        Object.keys(inputs).forEach(function (k) {
          var v = inputs[k].el.value.trim(); if (!v) return;
          var n = inputs[k].pace ? A.parseHms(v) : parseFloat(v);
          if (!(n > 0)) { bad = true; return; } out[k] = n;
        });
        if (gender.value) out.gender = gender.value;
        if (bad) { TP.toast('Enter numbers, and paces as m:ss (for example 4:15).', 'warn'); return; }
        var st = Object.assign({}, TP.mine.get('settings')); st.thresholds = out; TP.mine.set('settings', st); TP.toast('Thresholds saved. The analysis has been updated.');
      } }, 'Save thresholds'),
      h('button', { class: 'btn', onclick: function () { var st = Object.assign({}, TP.mine.get('settings')); st.thresholds = {}; TP.mine.set('settings', st); TP.toast('Using the estimated thresholds.'); } }, 'Use the estimates')));
    root.appendChild(p);
    // Zones from the thresholds in use.
    var z = panel('Your zones');
    var hrz = [['Z1 Recovery', 0, 0.85], ['Z2 Endurance', 0.85, 0.9], ['Z3 Tempo', 0.9, 0.95], ['Z4 Threshold', 0.95, 1], ['Z5 Above threshold', 1, null]];
    var pz = [['Z1 Active recovery', 0, 0.55], ['Z2 Endurance', 0.55, 0.75], ['Z3 Tempo', 0.75, 0.9], ['Z4 Threshold', 0.9, 1.05], ['Z5 VO2max', 1.05, 1.2], ['Z6 Anaerobic', 1.2, null]];
    var rz = [['Easy', 1.29, null], ['Steady', 1.14, 1.29], ['Tempo', 1.06, 1.14], ['Threshold', 0.97, 1.06], ['Interval', 0.9, 0.97], ['Fast', null, 0.9]];
    var band = function (lo, hi, f) { return lo === null || lo === 0 ? 'under ' + f(hi) : hi === null ? 'over ' + f(lo) : f(lo) + '–' + f(hi); };
    z.appendChild(h('div', { class: 'coach-3' },
      h('div', null, h('div', { class: 'form-section' }, 'Heart rate (bpm)'), hrz.map(function (x) { return h('div', { class: 'zrow' }, h('span', null, x[0]), h('b', null, band(x[1], x[2], function (v) { return Math.round(v * prof.lthr); }))); })),
      h('div', null, h('div', { class: 'form-section' }, 'Cycling power (W)'), pz.map(function (x) { return h('div', { class: 'zrow' }, h('span', null, x[0]), h('b', null, band(x[1], x[2], function (v) { return Math.round(v * prof.ftp); }))); })),
      h('div', null, h('div', { class: 'form-section' }, 'Run pace (/km)'), rz.map(function (x) {
        var f = function (v) { return A.fmtPace(v * prof.thr_pace_s_km); };
        return h('div', { class: 'zrow' }, h('span', null, x[0]), h('b', null, x[1] === null ? 'faster than ' + f(x[2]) : x[2] === null ? 'slower than ' + f(x[1]) : f(x[2]) + '–' + f(x[1])));
      }))));
    root.appendChild(z);
  };
})(window.TP);
