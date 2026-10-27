// One Garmin activity as a full page (as the R app's session page): summary, training stress, zones, the
// session's structure (warm-up, sets, cool-down) and splits, a map of the route for outdoor activities,
// similar sessions, charts through the activity, and the planned session it completes.
(function (TP) {
  var h = TP.h, A = TP.TA, fin = function (x) { return typeof x === 'number' && isFinite(x); }, sp = A.sprintf;
  var ZONE_NAMES = ['Easy (Z1)', 'Threshold (Z2)', 'Hard (Z3)'];
  var KIND_COL = { 'Warm-up': '#999999', Work: '#ff3b30', Recovery: '#6f93ad', 'Cool-down': '#999999', Main: '#00a86b', Set: '#2b4dff' };
  var TYPE_COL = { Intervals: '#ff3b30', Threshold: '#d99a00', 'Long endurance': '#2b4dff', Endurance: '#00a86b', Tempo: '#d99a00', Speed: '#ff3b30', Mixed: '#9b30ff', Recovery: '#666666', Short: '#999999', 'Grey zone': '#7d5a12' };

  function kpi(v, l, s) { return h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, v), h('div', { class: 'kpi-l' }, l), s ? h('div', { class: 'kpi-s' }, s) : null); }
  function section(title, sub) { return [h('h3', { class: 'sec-h' }, title), sub ? h('p', { class: 'muted small sec-sub' }, sub) : null]; }
  TP.paceText = function (sport, secs, metres) {
    if (!(metres > 0) || !secs) return '–';
    if (sport === 'Run') return A.fmtPace(secs / (metres / 1000)) + ' /km';
    if (sport === 'Swim') return A.fmtPace(secs / (metres / 100)) + ' /100 m';
    return TP.round(metres / 1000 / (secs / 3600), 1) + ' km/h';
  };

  // Opens the page. reviewId: the block review it was opened from (adds what it did for that block).
  TP.activityView = function (id, reviewId) {
    var a = TP.garmin.acts.filter(function (x) { return x.id === id; })[0]; if (!a) return;
    TP.openPage({ kind: 'activity', id: id, reviewId: reviewId || null, title: a.name || 'activity' });
  };

  // Session breakdown row and similar sessions for an activity: from its block review if opened from one,
  // otherwise from the same sport over the surrounding 12 weeks.
  function context(row, reviewId) {
    var ctx = TP.garmin.ctx();
    if (reviewId && TP.blocks) {
      var rv = TP.blocks.list().filter(function (x) { return x.id === reviewId; })[0], r = rv && TP.blocks.result(rv);
      if (r && !r.empty && r.sessions) {
        var sb = r.sessions.filter(function (x) { return x.id === row.id; })[0], fid = r.families.assign[row.id];
        return { sb: sb, fam: r.families.families.filter(function (f) { return f.id === fid; })[0] || null, inBlock: rv.name };
      }
    }
    var from = TP.addDays(row.date, -84), to = TP.addDays(row.date, 28);
    var acts = ctx.scored.filter(function (x) { return x.discipline === row.discipline && x.date >= from && x.date <= to; });
    var load = A.loadModel(ctx.scored, from, to);
    var sbAll = A.sessionBreakdownFor(acts, load, ctx.wellness, [row.discipline], TP.addDays(to, 1), row.discipline, ctx.feats, ctx.prof);
    var fams = A.sessionFamilies(sbAll, ctx.feats), fid2 = fams.assign[row.id];
    return { sb: null, type: (sbAll || []).filter(function (x) { return x.id === row.id; }).map(function (x) { return x.type; })[0], fam: fams.families.filter(function (f) { return f.id === fid2; })[0] || null };
  }

  TP.pages.activity = function (root, p) {
    var G = TP.garmin, id = p.id, a = G.acts.filter(function (x) { return x.id === id; })[0];
    if (!a) { root.appendChild(h('p', { class: 'muted' }, 'This activity isn’t stored on this device any more.')); return; }
    var rows = G.scoredFor(id), prof = G.ctx().prof, M = TP.match, main = rows.length === 1 ? rows[0] : null;
    var tss = rows.reduce(function (t, r) { return t + (r.tss || 0); }, 0), col = TP.SPORT_COLOURS[a.sport] || '#585858';
    var f = main ? G.ctx().feats[main.id] || {} : {}, s = f.structure || null, cx = main ? context(main, p.reviewId) : {};
    var type = cx.sb ? cx.sb.type : cx.type;

    // Header
    root.appendChild(h('div', { class: 'act-head', style: '--c:' + col },
      h('div', null, h('div', { class: 'rp-type', style: 'color:' + col }, (a.sport === 'Other' ? String(a.type || '').replace(/_/g, ' ') : a.sport) + (main && main.swim_env ? ' · ' + main.swim_env : '')),
        h('h2', null, a.name || a.type), h('div', { class: 'muted' }, TP.fmt(a.date, '%A %d %B %Y') + (a.start && a.start.length > 11 ? ', ' + a.start.slice(11, 16) : ''))),
      h('div', { class: 'btn-row', style: 'align-items:center' }, type ? h('span', { class: 'tchip big-t', style: 'color:' + (TYPE_COL[type] || '#666') }, type) : null,
        main ? h('button', { class: 'btn btn-sm needs-edit', onclick: function () { TP.saveActivity(main.id, type); } }, TP.icon('bookmark'), 'Save to planner') : null, TP.glossaryButton())));
    if (cx.sb && (cx.sb.why_good || cx.sb.why_bad)) root.appendChild(h('div', { class: 'coach-2', style: 'margin-bottom:12px' },
      cx.sb.why_good ? h('div', { class: 'why why-good' }, '↗ ' + cx.sb.why_good.charAt(0).toUpperCase() + cx.sb.why_good.slice(1) + '.') : null,
      cx.sb.why_bad ? h('div', { class: 'why why-bad' }, '! ' + cx.sb.why_bad.charAt(0).toUpperCase() + cx.sb.why_bad.slice(1) + '.') : null));

    // Numbers
    var swimSets = s && s.unit === 'swim' && (s.segments || []).some(function (g) { return g.stroke; });
    var perf = a.sport === 'Bike' && (a.np || a.avg_power) ? Math.round(a.np || a.avg_power) + ' W' + (a.np ? ' NP' : '')
      : swimSets ? A.fmtOut(A.sum(s.segments.map(function (g) { return g.dist; })) / A.sum(s.segments.map(function (g) { return g.dur; })), 'Swim') : TP.paceText(a.sport, a.moving_s, a.distance_m);
    root.appendChild(h('div', { class: 'kpis kpis-4' },
      kpi(a.moving_s ? TP.fmtDuration(a.moving_s) : '–', 'Moving time', a.duration_s && Math.abs(a.duration_s - a.moving_s) > 60 ? TP.fmtDuration(a.duration_s) + ' elapsed' : null),
      kpi(a.distance_m > 0 ? (a.sport === 'Swim' ? Math.round(a.distance_m) + ' m' : TP.round(a.distance_m / 1000, 2) + ' km') : '–', 'Distance', a.elev_m ? Math.round(a.elev_m) + ' m climbing' : null),
      kpi(perf, a.sport === 'Bike' && a.avg_power ? 'Power' : a.sport === 'Bike' ? 'Speed' : swimSets ? 'Swim pace' : 'Pace', a.sport === 'Bike' && a.avg_power && a.distance_m ? TP.paceText('Bike', a.moving_s, a.distance_m) : swimSets ? 'excluding rests' : null),
      kpi(a.avg_hr ? Math.round(a.avg_hr) + ' bpm' : '–', 'Avg heart rate', a.avg_hr ? Math.round(a.avg_hr / prof.lthr * 100) + '% of threshold' + (a.max_hr ? ' · max ' + Math.round(a.max_hr) : '') : null)));
    if (rows.length) {
      var ifv = main && fin(main.intensity) ? main.intensity : null;
      root.appendChild(h('div', { class: 'kpis kpis-4', style: 'margin-top:8px' },
        kpi(Math.round(tss), 'Training stress (TSS)', main ? main.tss_method : 'sum of the legs'),
        kpi(ifv ? ifv.toFixed(2) : '–', 'Intensity factor', ifv ? (ifv < 0.75 ? 'recovery / endurance' : ifv < 0.85 ? 'aerobic endurance' : ifv < 0.95 ? 'tempo / sweet spot' : ifv < 1.05 ? 'threshold' : 'above threshold') : null),
        kpi(main && fin(main.decoupling) ? main.decoupling.toFixed(1) + '%' : '–', 'HR drift (decoupling)', main && fin(main.decoupling) ? (main.decoupling < 5 ? 'under 5% = durable' : 'over 5%: fading') : '1st vs 2nd half'),
        kpi(main && fin(main.ef) ? main.ef.toFixed(2) : a.aerobic_te ? a.aerobic_te.toFixed(1) : '–', main && fin(main.ef) ? 'Efficiency factor' : 'Aerobic TE', main && fin(main.ef) ? (a.sport === 'Bike' ? 'NP per heartbeat' : 'pace per heartbeat') : a.anaerobic_te ? 'anaerobic ' + a.anaerobic_te.toFixed(1) : null)));
    }
    if (main && main.coach_note) root.appendChild(h('div', { class: 'coach-note' }, TP.icon('chart'), h('span', null, main.coach_note.charAt(0).toUpperCase() + main.coach_note.slice(1) + '.')));

    // Zones
    if (rows.length) {
      var z = [0, 0, 0], hz = [0, 0, 0, 0, 0];
      rows.forEach(function (r) { z[0] += r.z1; z[1] += r.z2; z[2] += r.z3; (r.hz || []).forEach(function (v, i) { hz[i] += v; }); });
      var mins = function (v) { return Math.round(v / 60) + ' min'; };
      root.appendChild(h('div', { class: 'zones' },
        h('div', { class: 'zone-row' }, h('span', { class: 'zone-l' }, '3 zones'), TP.chart.split(z.map(function (v, i) { return { label: ZONE_NAMES[i], value: v, col: A.ZONE_COLOURS[i] }; }), mins)),
        hz.some(function (v) { return v > 0; }) ? (function () {
          var hcols = ['#c9d9e3', '#8fb0c2', '#c99a3b', '#ff766e', '#ff3b30'], cuts = [0.85, 0.9, 0.95, 1].map(function (x) { return Math.round(x * prof.lthr); });
          var hl = ['under ' + cuts[0], cuts[0] + '–' + cuts[1], cuts[1] + '–' + cuts[2], cuts[2] + '–' + cuts[3], 'over ' + cuts[3]];
          return [h('div', { class: 'zone-row' }, h('span', { class: 'zone-l' }, 'HR zones'), TP.chart.split(hz.map(function (v, i) { return { label: 'Z' + (i + 1), value: v, col: hcols[i] }; }), mins)),
            h('div', { class: 'legend small' }, hz.map(function (v, i) { return h('span', null, h('i', { style: 'background:' + hcols[i] }), 'Z' + (i + 1) + ' ' + hl[i] + ' bpm: ' + mins(v)); }))];
        })() : h('div', { class: 'legend small' }, z.map(function (v, i) { return h('span', null, h('i', { style: 'background:' + A.ZONE_COLOURS[i] }), ZONE_NAMES[i] + ': ' + mins(v)); }))));
    }

    // Planned session
    root.appendChild(h('div', null, section('Planned session')));
    var sid = M.sessionForAct(id), ps = sid && TP.state.sessions.filter(function (x) { return x.id === sid; })[0];
    if (ps) {
      var st = M.status(ps);
      root.appendChild(h('div', { class: 'panel g-link' },
        h('button', { class: 'list-item', onclick: function () { TP.sessionView(ps.id); } }, h('span', { class: 'dot', style: 'background:' + TP.typeCol(ps.type) }),
          h('span', { class: 'grow' }, h('b', null, TP.sportLabel(ps.discipline) + ' · ' + ps.type), h('div', { class: 'muted small' }, TP.fmt(ps.date, '%a %d %b') + (TP.planAmount(ps) ? ' · planned ' + TP.planAmount(ps) : ''))),
          st ? h('span', { class: 'st-chip st-' + st.st }, (M.STATUS_ICON[st.st] || '') + ' ' + M.STATUS_LABEL[st.st]) : null),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', onclick: function () { M.pickSession(id); } }, 'Change'),
          h('button', { class: 'btn btn-sm', onclick: function () { M.unlink(sid); TP.toast('Unlinked.'); } }, 'Unlink'))));
    } else {
      root.appendChild(h('div', { class: 'panel g-link' }, h('p', { class: 'small muted', style: 'margin:0 0 8px' }, 'Not linked to a planned session.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', onclick: function () { M.pickSession(id); } }, 'Link to a planned session'),
          main ? h('button', { class: 'btn btn-sm needs-edit', onclick: function () {
            var x = A.activityToPlan(main, f, type); if (!x) { TP.toast('This kind of activity has no planner sport (Swim, Run, Bike, Hyrox or Gym).', 'warn'); return; }
            var ns = TP.normaliseSession(Object.assign({ id: TP.uid(), date: a.date, block_id: TP.trainingBlockOn(a.date) }, x));
            TP.upsertSession(ns); M.link(ns.id, id); TP.toast('Added to the plan on ' + TP.fmt(a.date, '%a %d %b') + '.');
          } }, TP.icon('plus'), 'Add to the plan') : null)));
    }

    // Legs of a multisport activity
    if (rows.length > 1) {
      root.appendChild(h('div', null, section('Legs')));
      root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Leg'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, 'Pace / power'), h('th', { class: 'num' }, 'Avg HR'), h('th', { class: 'num' }, 'TSS'), h('th', { class: 'num' }, 'IF'), h('th', null, 'Structure'))),
        h('tbody', null, rows.map(function (r) {
          var ls = (G.ctx().feats[r.id] || {}).structure;
          return h('tr', null, h('td', null, h('span', { class: 'sdot', style: 'background:' + A.SPORT_COLOURS[r.discipline] }), r.discipline),
            h('td', { class: 'num' }, TP.fmtDuration(r.moving_s || 0)), h('td', { class: 'num' }, r.km ? TP.round(r.km, 2) + ' km' : '–'),
            h('td', { class: 'num' }, r.discipline === 'Bike' && r.np ? Math.round(r.np) + ' W' : TP.paceText(r.discipline, r.moving_s, r.distance_m)),
            h('td', { class: 'num' }, r.avg_hr ? Math.round(r.avg_hr) : '–'), h('td', { class: 'num' }, Math.round(r.tss || 0)), h('td', { class: 'num' }, fin(r.intensity) ? r.intensity.toFixed(2) : '–'),
            h('td', { class: 'small' }, ls ? ls.label : '–'));
        })))));
    }

    // Structure, charts, route, segments and splits (need the second-by-second data).
    var structBox = h('div'), mapBox = h('div'), chartBox = h('div');
    root.appendChild(structBox); root.appendChild(mapBox); root.appendChild(chartBox);
    if (s) {
      structBox.appendChild(h('div', null, section('Session structure', s.source ? (/^detected/.test(s.source) ? s.source.charAt(0).toUpperCase() + s.source.slice(1) : 'From ' + s.source) : null)));
      structBox.appendChild(h('div', { class: 'struct-label' }, s.label));
    }
    if (!a.fit) chartBox.appendChild(h('p', { class: 'muted small' }, 'Sync with FIT files to see heart rate, pace, power, the route and the session’s structure.'));
    else G.stream(id).then(function (raw) {
      drawStreams(chartBox, a, raw, s, rows.length > 1);
      drawRoute(mapBox, a, raw, col);
      tables(structBox, s, main ? main.discipline : a.sport);
    }).catch(function (e) { console.warn(e); chartBox.appendChild(h('p', { class: 'muted small' }, 'The data for this activity couldn’t be read.')); });

    // Similar sessions
    if (main) {
      var fam = cx.fam, sim = fam ? fam.sessions.filter(function (x) { return x.id !== main.id; }) : [];
      var thisEff = fam ? (fam.sessions.filter(function (x) { return x.id === main.id; })[0] || {}).eff : null;
      root.appendChild(h('div', null, section('Similar sessions', fam ? sp('Grouped as “%s”: %d times %s. Comparing like with like is the clearest way to see whether fitness is moving.', fam.name, fam.n, cx.inBlock ? 'in this block' : 'in the 12 weeks around it') : null)));
      if (sim.length) root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Session'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, fam.interval ? 'Rep pace / power' : 'Pace / power'), h('th', { class: 'num' }, 'Avg HR'), h('th', { class: 'num' }, 'Efficiency vs this one'))),
        h('tbody', null, sim.map(function (m) {
          var d = fin(m.eff) && fin(thisEff) ? (m.eff / thisEff - 1) * 100 : null;
          return h('tr', { class: 'click', onclick: function () { TP.activityView(m.parent_id || m.id, p.reviewId); } },
            h('td', { class: 'nowrap' }, TP.fmt(m.date, '%a %d %b')), h('td', null, m.name), h('td', { class: 'num' }, A.fmtDur(m.moving_s)),
            h('td', { class: 'num' }, h('b', null, A.fmtOut(m.out, fam.sport, fam.unit))), h('td', { class: 'num' }, fin(m.hr) ? Math.round(m.hr) : '–'),
            h('td', { class: 'num' }, fin(d) ? h('span', { style: 'font-weight:700;color:' + (d > 1 ? '#00a86b' : d < -1 ? '#ff3b30' : '#666') }, sp('%+.1f%%', d)) : '–'));
        })))));
      else root.appendChild(h('p', { class: 'muted small' }, 'No similar sessions ' + (cx.inBlock ? 'in this block' : 'in the 12 weeks around it') + ' yet.'));
    }
  };

  // Save an activity as a template, or add it to the planner on a date (as the R app's Save button).
  TP.saveActivity = function (rowId, type) {
    var ctx = TP.garmin.ctx(), a = ctx.byId[rowId]; if (!a) return;
    var x = A.activityToPlan(a, ctx.feats[rowId], type);
    if (!x) { TP.toast('This activity type has no matching planner sport (Swim, Run, Bike, Hyrox or Gym).', 'warn'); return; }
    var name = TP.input('text', (a.name || 'Session') + ' ' + TP.fmt(a.date, '%d %b')), date = TP.input('date', TP.addDays(TP.today(), 1));
    var m = TP.modal({ size: 'm', stack: true, title: h('div', { class: 'md-t' }, 'Save this session'),
      body: [h('div', { class: 'panel' }, h('b', null, TP.sportLabel(x.discipline) + ' · ' + x.type), h('div', { class: 'small', style: 'margin-top:4px' }, x.details),
          h('div', { class: 'hint' }, 'Saved as: ' + (x.total_dist > 0 ? x.total_dist + ' km' : x.duration_min + ' min') + (x.wu_cd_check ? sp(' (warm-up %.1f km, cool-down %.1f km)', x.wu_dist, x.cd_dist) : ''))),
        TP.field('Template name', name), h('div', { style: 'margin-top:10px' }, TP.field('Or add it to the planner on', date))],
      footer: [h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel'), h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: function () {
          var nm = name.value.trim() || x.discipline + ' ' + x.type;
          TP.state.templates[nm] = Object.assign({ block_id: '' }, x); TP.save(); m.close();
          TP.toast('Saved “' + nm + '” as a template. Use Load template in any new session form.');
        } }, TP.icon('bookmark'), 'Save as template'),
        h('button', { class: 'btn btn-primary', onclick: function () {
          if (!date.value) return;
          TP.upsertSession(TP.normaliseSession(Object.assign({ id: TP.uid(), date: date.value, block_id: TP.trainingBlockOn(date.value) }, x))); m.close();
          TP.toast('Added ' + TP.sportLabel(x.discipline) + ' ' + x.type + ' to the planner on ' + TP.fmt(date.value, '%a %d %b %Y') + '.');
        } }, TP.icon('plus'), 'Add to planner')] });
  };

  // Warm-up / sets / cool-down table and splits.
  function tables(box, s, disc) {
    if (!s) return;
    var seg = s.segments || [], swimSets = seg.some(function (g) { return g.stroke; }), unit = s.unit;
    if (seg.length) box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Part'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, unit === 'W' ? 'Power' : 'Pace'),
        h('th', { class: 'num' }, 'Avg HR'), h('th', { class: 'num' }, 'Max HR'), swimSets ? h('th', { class: 'num' }, 'Rest after') : null, swimSets ? h('th', null, 'Stroke') : null)),
      h('tbody', null, seg.map(function (g) {
        return h('tr', null, h('td', null, h('span', { class: 'kchip', style: 'color:' + (KIND_COL[g.kind] || '#666') }, g.kind)), h('td', { class: 'num' }, A.fmtDur(g.dur)),
          h('td', { class: 'num' }, g.dist > 0 ? (disc === 'Swim' ? Math.round(g.dist) + ' m' : (g.dist / 1000).toFixed(2) + ' km') : '–'),
          h('td', { class: 'num' }, h('b', null, A.fmtOut(g.out, disc, unit === 'swim' ? null : unit))), h('td', { class: 'num' }, fin(g.hr) ? Math.round(g.hr) : '–'), h('td', { class: 'num' }, fin(g.max_hr) ? Math.round(g.max_hr) : '–'),
          swimSets ? h('td', { class: 'num' }, fin(g.rest) ? A.fmtDur(g.rest) : '–') : null, swimSets ? h('td', null, g.stroke ? g.stroke.charAt(0).toUpperCase() + g.stroke.slice(1) : '') : null);
      })))));
    var spl = s.splits;
    if (spl && spl.length) {
      var step = { Run: 1000, Bike: 5000, Swim: 500 }[disc], stepL = { Run: 'km', Bike: '5 km', Swim: '500 m' }[disc], fastest = spl.reduce(function (b, x) { return x.out > b.out ? x : b; });
      var hasP = spl.some(function (x) { return fin(x.power); });
      box.appendChild(h('div', null, section('Splits (every ' + stepL + ')', 'Fastest split in green.')));
      box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, stepL), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Pace'), hasP ? h('th', { class: 'num' }, 'Power') : null, h('th', { class: 'num' }, 'Avg HR'))),
        h('tbody', null, spl.map(function (x) {
          return h('tr', null, h('td', null, x.dist < 0.95 * step ? sp('%d (%.2f km)', x.n, x.dist / 1000) : x.n), h('td', { class: 'num' }, A.fmtDur(x.dur)),
            h('td', { class: 'num' }, h('b', { style: x === fastest ? 'color:#00a86b' : '' }, A.fmtOut(x.out, disc))), hasP ? h('td', { class: 'num' }, fin(x.power) ? Math.round(x.power) + ' W' : '–') : null,
            h('td', { class: 'num' }, fin(x.hr) ? Math.round(x.hr) : '–'));
        })))));
    }
  }

  // --- Route map (Leaflet + OpenStreetMap, loaded the first time a map is shown) ---
  var leaflet = null;
  function loadLeaflet() {
    if (leaflet) return leaflet;
    leaflet = new Promise(function (res, rej) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
      var js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      js.onload = function () { res(window.L); }; js.onerror = function () { leaflet = null; rej(new Error('The map couldn’t load. Check your connection.')); };
      document.head.appendChild(js);
    });
    return leaflet;
  }
  function drawRoute(box, a, raw, col) {
    var route = ((raw && raw.route) || []).filter(function (p) { return fin(p[1]) && fin(p[2]) && Math.abs(p[1]) > 0.01; });
    var G = TP.garmin;
    if (route.length < 5) {
      // Saved before routes were kept: fetch this one's FIT file again (outdoor activities only).
      var indoor = /indoor|virtual|treadmill|lap_swimming|pool|strength|trainer/.test(String(a.type || '')) ;
      if (!indoor && G.needsRefetch(a)) {
        box.appendChild(h('div', null, section('Route')));
        var msg = h('p', { class: 'muted small' }, G.connected() ? 'Loading the route from Garmin…' : 'Connect Garmin and sync to see the route.');
        box.appendChild(msg);
        if (G.connected()) G.refetch(a.id).then(function () { TP.render(); }).catch(function (e) { msg.textContent = 'The route couldn’t be loaded: ' + e.message; });
      }
      return;
    }
    box.appendChild(h('div', null, section('Route', 'Start in green, finish in black. Drag to move; pinch, use + and −, or click the map and scroll to zoom.')));
    var el = h('div', { class: 'route-map' }); box.appendChild(el);
    loadLeaflet().then(function (L) {
      var ll = route.map(function (p) { return [p[1], p[2]]; });
      var map = L.map(el, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      L.polyline(ll, { color: col, weight: 4, opacity: 0.9 }).addTo(map);
      L.circleMarker(ll[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#00a86b', fillOpacity: 1 }).addTo(map).bindTooltip('Start');
      L.circleMarker(ll[ll.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#111111', fillOpacity: 1 }).addTo(map).bindTooltip('Finish');
      map.fitBounds(L.latLngBounds(ll), { padding: [16, 16] });
      el.addEventListener('click', function () { map.scrollWheelZoom.enable(); });
      setTimeout(function () { map.invalidateSize(); }, 200);
    }).catch(function (e) { el.replaceWith(h('p', { class: 'muted small' }, e.message)); });
  }

  // Charts through the activity: output (pace / speed / power) with the session's parts shaded, then heart
  // rate and elevation - separate charts, one scale each.
  function drawStreams(root, a, raw, s, multi) {
    var disc = multi ? 'Other' : A.discFor(a.type), st = A.cleanStream(raw, disc);
    if (!st) { root.appendChild(h('p', { class: 'muted small' }, 'Not enough recorded data to chart.')); return; }
    root.appendChild(h('div', null, section('Through the session', s && s.segments && s.segments.length > 1 ? 'Shading shows the parts of the session: warm-up and cool-down grey, work red, recovery blue.' : null)));
    var n = st.n, step = Math.max(1, Math.floor(n / 600)), mins = function (i) { return Math.round(i / 6) / 10; };
    function smooth(x, w) {
      var out = new Array(x.length), sm = 0, c = 0, q = [];
      for (var i = 0; i < x.length; i++) { var v = fin(x[i]) ? x[i] : null; q.push(v); if (v !== null) { sm += v; c++; } if (q.length > w) { var o = q.shift(); if (o !== null) { sm -= o; c--; } } out[i] = c ? sm / c : null; }
      return out;
    }
    function pts(x) { var o = []; for (var i = 0; i < n; i += step) o.push([mins(i), x[i]]); return o; }
    var tipX = function (v) { return TP.fmtDuration(Math.round(v * 60)) + ' in'; };
    var xAxis = { type: 'num', fmt: function (v) { return Math.round(v) + "'"; } };
    var bands = s && s.segments && s.segments.length > 1 && s.unit !== 'swim' ? s.segments.map(function (g) {
      return { x0: mins(g.start), x1: mins(g.end), fill: { 'Warm-up': '#efefef', 'Cool-down': '#efefef', Work: '#ffe3e1', Recovery: '#e3edf4', Main: '#ffffff' }[g.kind] || '#ffffff' };
    }) : null;
    var hr = st.hr.filter(fin).length > 60 ? smooth(st.hr, 5) : null;
    var power = st.power.filter(function (v) { return v > 0; }).length > 120 ? smooth(st.power, 15) : null;
    var speed = st.speed.filter(fin).length > 120 ? smooth(st.speed, 30) : null;
    var alt = st.altitude.filter(fin).length > 120 ? smooth(st.altitude, 15) : null;
    if (power && disc === 'Bike') root.appendChild(TP.chart.xy({ title: 'Power (15-second average)', height: 170, x: xAxis, tipX: tipX, bands: bands, y: { fmt: function (v) { return Math.round(v); }, zero: true },
      series: [{ name: 'Power (W)', col: '#00a86b', pts: pts(power), width: 1.5 }] }));
    else if (speed) {
      if (disc === 'Run' || disc === 'Swim') {
        var per = disc === 'Run' ? 1000 : 100, pace = speed.map(function (v) { return v > (disc === 'Run' ? 1.2 : 0.3) ? per / v : null; });
        root.appendChild(TP.chart.xy({ title: 'Pace' + (disc === 'Run' ? ' (/km)' : ' (/100 m)') + ', faster is higher', height: 170, x: xAxis, tipX: tipX, bands: bands, y: { fmt: A.fmtPace, invert: true },
          series: [{ name: 'Pace', col: TP.SPORT_COLOURS[disc], pts: pts(pace), width: 1.5, fmt: A.fmtPace }] }));
      } else root.appendChild(TP.chart.xy({ title: 'Speed (km/h)', height: 170, x: xAxis, tipX: tipX, bands: bands, y: { fmt: function (v) { return v.toFixed(0); }, zero: true },
        series: [{ name: 'Speed (km/h)', col: '#1f7aff', pts: pts(speed.map(function (v) { return fin(v) ? v * 3.6 : null; })), width: 1.5 }] }));
    }
    if (hr) root.appendChild(TP.chart.xy({ title: 'Heart rate (bpm)', height: 140, x: xAxis, tipX: tipX, bands: bands, y: { fmt: function (v) { return Math.round(v); } },
      series: [{ name: 'Heart rate (bpm)', col: '#d6336c', pts: pts(hr), width: 1.5 }] }));
    if (alt && disc !== 'Swim') root.appendChild(TP.chart.xy({ title: 'Elevation (m)', height: 110, x: xAxis, tipX: tipX, y: { fmt: function (v) { return Math.round(v); } },
      series: [{ name: 'Elevation (m)', col: '#8a8a8a', pts: pts(alt), width: 1.2, kind: 'area', fillAlpha: 0.2 }] }));
    // Pool swims: pace of each set.
    if (s && s.unit === 'swim' && s.segments && s.segments.length) {
      root.appendChild(TP.chart.xy({ title: 'Pace of each set (/100 m), faster is higher', height: 160, x: { type: 'num', fmt: function (v) { return Math.round(v) + "'"; } }, tipX: tipX,
        y: { fmt: A.fmtPace, invert: true }, series: [{ name: 'Set pace', col: '#1f7aff', kind: 'dots', r: 5, pts: s.segments.map(function (g) { return [mins(g.start + g.dur / 2), 100 / g.out, KIND_COL[g.kind]]; }), fmt: A.fmtPace }] }));
    }
  }
})(window.TP);
