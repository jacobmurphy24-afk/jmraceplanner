// One Garmin activity in full: summary, training stress, zones, the coach's notes, second-by-second charts,
// and the planned session it completes (with link / unlink).
(function (TP) {
  var h = TP.h, A = TP.TA, fin = function (x) { return typeof x === 'number' && isFinite(x); };
  var ZONE_NAMES = ['Easy (Z1)', 'Threshold (Z2)', 'Hard (Z3)'];

  function kpi(v, l, s) { return h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, v), h('div', { class: 'kpi-l' }, l), s ? h('div', { class: 'kpi-s' }, s) : null); }
  TP.paceText = function (sport, secs, metres) {
    if (!(metres > 0) || !secs) return '–';
    if (sport === 'Run') return A.fmtPace(secs / (metres / 1000)) + ' /km';
    if (sport === 'Swim') return A.fmtPace(secs / (metres / 100)) + ' /100 m';
    return TP.round(metres / 1000 / (secs / 3600), 1) + ' km/h';
  };

  TP.activityView = function (id) {
    var G = TP.garmin, a = G.acts.filter(function (x) { return x.id === id; })[0]; if (!a) return;
    var rows = G.scoredFor(id), prof = G.ctx().prof, M = TP.match;
    var tss = rows.reduce(function (t, r) { return t + (r.tss || 0); }, 0), main = rows.length === 1 ? rows[0] : null;
    var col = TP.SPORT_COLOURS[a.sport] || '#585858';
    var body = h('div');
    var perf = a.sport === 'Bike' && (a.np || a.avg_power) ? Math.round(a.np || a.avg_power) + ' W' + (a.np ? ' NP' : '') : TP.paceText(a.sport, a.moving_s, a.distance_m);
    body.appendChild(h('div', { class: 'kpis kpis-4' },
      kpi(a.moving_s ? TP.fmtDuration(a.moving_s) : '–', 'Moving time', a.duration_s && Math.abs(a.duration_s - a.moving_s) > 60 ? TP.fmtDuration(a.duration_s) + ' elapsed' : null),
      kpi(a.distance_m > 0 ? TP.round(a.distance_m / 1000, a.sport === 'Swim' ? 2 : 1) + ' km' : '–', 'Distance', a.elev_m ? Math.round(a.elev_m) + ' m climbing' : null),
      kpi(perf, a.sport === 'Bike' && a.avg_power ? 'Power' : a.sport === 'Bike' ? 'Speed' : 'Pace', a.sport === 'Bike' && a.avg_power && a.distance_m ? TP.paceText('Bike', a.moving_s, a.distance_m) : null),
      kpi(a.avg_hr ? Math.round(a.avg_hr) + ' bpm' : '–', 'Avg heart rate', a.max_hr ? 'max ' + Math.round(a.max_hr) : null)));
    if (rows.length) {
      var ifv = main && fin(main.intensity) ? main.intensity : null;
      body.appendChild(h('div', { class: 'kpis kpis-4', style: 'margin-top:8px' },
        kpi(Math.round(tss), 'Training stress (TSS)', main ? main.tss_method : 'sum of the legs'),
        kpi(ifv ? ifv.toFixed(2) : '–', 'Intensity factor', ifv ? (ifv < 0.75 ? 'recovery / endurance' : ifv < 0.85 ? 'aerobic endurance' : ifv < 0.95 ? 'tempo / sweet spot' : ifv < 1.05 ? 'threshold' : 'above threshold') : null),
        kpi(main && fin(main.decoupling) ? main.decoupling.toFixed(1) + '%' : '–', 'Aerobic decoupling', main && fin(main.decoupling) && main.hours >= 1 ? (main.decoupling < 5 ? 'durable' : 'drifted') : 'HR vs output, 1st vs 2nd half'),
        kpi(main && fin(main.ef) ? main.ef.toFixed(2) : a.aerobic_te ? a.aerobic_te.toFixed(1) : '–', main && fin(main.ef) ? 'Efficiency factor' : 'Aerobic TE', main && fin(main.ef) ? (a.sport === 'Bike' ? 'NP per heartbeat' : 'pace per heartbeat') : a.anaerobic_te ? 'anaerobic ' + a.anaerobic_te.toFixed(1) : null)));
    }
    if (main && main.coach_note) body.appendChild(h('div', { class: 'coach-note' }, TP.icon('chart'), h('span', null, main.coach_note.charAt(0).toUpperCase() + main.coach_note.slice(1) + '.')));

    // Legs of a multisport activity.
    if (rows.length > 1) {
      body.appendChild(h('div', { class: 'form-section' }, 'Legs'));
      body.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Leg'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'Distance'), h('th', { class: 'num' }, 'Pace / power'), h('th', { class: 'num' }, 'Avg HR'), h('th', { class: 'num' }, 'TSS'), h('th', { class: 'num' }, 'IF'))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, h('td', null, h('span', { class: 'sdot', style: 'background:' + A.SPORT_COLOURS[r.discipline] }), r.discipline),
            h('td', { class: 'num' }, TP.fmtDuration(r.moving_s || 0)), h('td', { class: 'num' }, r.km ? TP.round(r.km, 2) + ' km' : '–'),
            h('td', { class: 'num' }, r.discipline === 'Bike' && r.np ? Math.round(r.np) + ' W' : TP.paceText(r.discipline, r.moving_s, r.distance_m)),
            h('td', { class: 'num' }, r.avg_hr ? Math.round(r.avg_hr) : '–'), h('td', { class: 'num' }, Math.round(r.tss || 0)), h('td', { class: 'num' }, fin(r.intensity) ? r.intensity.toFixed(2) : '–'));
        })))));
    }

    // Time in zones.
    if (rows.length) {
      var z = [0, 0, 0], hz = [0, 0, 0, 0, 0];
      rows.forEach(function (r) { z[0] += r.z1; z[1] += r.z2; z[2] += r.z3; (r.hz || []).forEach(function (v, i) { hz[i] += v; }); });
      var zcols = A.ZONE_COLOURS, mins = function (v) { return Math.round(v / 60) + ' min'; };
      body.appendChild(h('div', { class: 'form-section' }, 'Intensity'));
      body.appendChild(h('div', { class: 'zone-row' }, h('span', { class: 'zone-l' }, '3 zones'), TP.chart.split(z.map(function (v, i) { return { label: ZONE_NAMES[i], value: v, col: zcols[i] }; }), mins)));
      if (hz.some(function (v) { return v > 0; })) {
        var hcols = ['#c9d9e3', '#8fb0c2', '#c99a3b', '#ff766e', '#ff3b30'], cuts = [0.85, 0.9, 0.95, 1].map(function (x) { return Math.round(x * prof.lthr); });
        var hl = ['under ' + cuts[0], cuts[0] + '–' + cuts[1], cuts[1] + '–' + cuts[2], cuts[2] + '–' + cuts[3], 'over ' + cuts[3]];
        body.appendChild(h('div', { class: 'zone-row' }, h('span', { class: 'zone-l' }, 'HR zones'), TP.chart.split(hz.map(function (v, i) { return { label: 'Z' + (i + 1) + ' (' + hl[i] + ' bpm)', value: v, col: hcols[i] }; }), mins)));
        body.appendChild(h('div', { class: 'legend small' }, hz.map(function (v, i) { return h('span', null, h('i', { style: 'background:' + hcols[i] }), 'Z' + (i + 1) + ' ' + hl[i] + ': ' + mins(v)); })));
      } else body.appendChild(h('div', { class: 'legend small' }, z.map(function (v, i) { return h('span', null, h('i', { style: 'background:' + zcols[i] }), ZONE_NAMES[i] + ': ' + mins(v)); })));
    }

    // The planned session.
    var sid = M.sessionForAct(id), s = sid && TP.state.sessions.filter(function (x) { return x.id === sid; })[0];
    body.appendChild(h('div', { class: 'form-section' }, 'Planned session'));
    if (s) {
      var st = M.status(s);
      body.appendChild(h('div', { class: 'panel g-link' },
        h('button', { class: 'list-item', onclick: function () { TP.sessionView(s.id); } },
          h('span', { class: 'dot', style: 'background:' + TP.typeCol(s.type) }),
          h('span', { class: 'grow' }, h('b', null, TP.sportLabel(s.discipline) + ' · ' + s.type), h('div', { class: 'muted small' }, TP.fmt(s.date, '%a %d %b') + (TP.planAmount(s) ? ' · planned ' + TP.planAmount(s) : ''))),
          st ? h('span', { class: 'st-chip st-' + st.st }, (M.STATUS_ICON[st.st] || '') + ' ' + M.STATUS_LABEL[st.st]) : null),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm', onclick: function () { M.pickSession(id); } }, 'Change'),
          h('button', { class: 'btn btn-sm', onclick: function () { M.unlink(sid); TP.toast('Unlinked.'); m.close(); TP.activityView(id); } }, 'Unlink'))));
    } else {
      body.appendChild(h('div', { class: 'panel g-link' }, h('p', { class: 'small muted', style: 'margin:0 0 8px' }, 'Not linked to a planned session.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', onclick: function () { M.pickSession(id); } }, 'Link to a planned session'),
          main ? h('button', { class: 'btn btn-sm needs-edit', onclick: function () {
            var x = A.activityToPlan(main); if (!x) { TP.toast('This kind of activity has no planner sport (Swim, Run, Bike, Hyrox or Gym).', 'warn'); return; }
            var ns = TP.normaliseSession(Object.assign({ id: TP.uid(), date: a.date, block_id: TP.trainingBlockOn(a.date) }, x));
            TP.upsertSession(ns); M.link(ns.id, id); TP.toast('Added to the plan on ' + TP.fmt(a.date, '%a %d %b') + '.');
          } }, TP.icon('plus'), 'Add to the plan') : null)));
    }

    // Second-by-second charts.
    var charts = h('div', { class: 'act-charts' }, a.fit ? h('p', { class: 'muted small' }, 'Loading the second-by-second data…') : h('p', { class: 'muted small' }, 'Sync with FIT files to see heart rate, pace and power through the activity.'));
    body.appendChild(h('div', { class: 'form-section' }, 'Through the activity'));
    body.appendChild(charts);
    if (a.fit) G.stream(id).then(function (raw) { TP.clear(charts); drawStreams(charts, a, raw); }).catch(function () { TP.clear(charts); charts.appendChild(h('p', { class: 'muted small' }, 'The data for this activity couldn’t be read.')); });

    var m = TP.modal({ size: 'l', stack: true,
      title: h('div', null, h('div', { class: 'md-t' }, h('span', { class: 'sdot', style: 'background:' + col }), a.name || a.type),
        h('div', { class: 'md-sub' }, TP.fmt(a.date, '%A %d %B %Y') + (a.start && a.start.length > 11 ? ' · ' + a.start.slice(11, 16) : '') + ' · ' + String(a.type || '').replace(/_/g, ' '))),
      body: body,
      footer: [h('span', { class: 'grow' }), h('button', { class: 'btn btn-primary', onclick: function () { m.close(); } }, 'Close')] });
  };

  // Heart rate, pace / speed / power and elevation through the activity: separate charts, one scale each.
  function drawStreams(root, a, raw) {
    var disc = a.multisport ? 'Other' : A.discFor(a.type), st = A.cleanStream(raw, disc === 'Other' ? 'Other' : disc);
    if (!st) { root.appendChild(h('p', { class: 'muted small' }, 'Not enough recorded data to chart.')); return; }
    var n = st.n, step = Math.max(1, Math.floor(n / 500)), mins = function (i) { return Math.round(i / 6) / 10; };
    function smooth(x, w) {
      var out = new Array(x.length), s = 0, c = 0, q = [];
      for (var i = 0; i < x.length; i++) { var v = fin(x[i]) ? x[i] : null; q.push(v); if (v !== null) { s += v; c++; } if (q.length > w) { var o = q.shift(); if (o !== null) { s -= o; c--; } } out[i] = c ? s / c : null; }
      return out;
    }
    function pts(x) { var o = []; for (var i = 0; i < n; i += step) o.push([mins(i), x[i]]); return o; }
    var tipX = function (v) { return TP.fmtDuration(Math.round(v * 60)) + ' in'; };
    var xAxis = { type: 'num', fmt: function (v) { return Math.round(v) + "'"; } };
    var hr = st.hr.filter(fin).length > 60 ? smooth(st.hr, 5) : null;
    var power = st.power.filter(function (v) { return v > 0; }).length > 120 ? smooth(st.power, 30) : null;
    var speed = st.speed.filter(fin).length > 120 ? smooth(st.speed, 15) : null;
    var alt = st.altitude.filter(fin).length > 120 ? smooth(st.altitude, 15) : null;
    if (hr) root.appendChild(TP.chart.xy({ title: 'Heart rate', height: 150, x: xAxis, tipX: tipX, y: { fmt: function (v) { return Math.round(v); } },
      series: [{ name: 'Heart rate (bpm)', col: '#d6336c', pts: pts(hr), width: 1.5 }] }));
    if (power && disc === 'Bike') root.appendChild(TP.chart.xy({ title: 'Power (30-second average)', height: 150, x: xAxis, tipX: tipX, y: { fmt: function (v) { return Math.round(v); }, zero: true },
      series: [{ name: 'Power (W)', col: '#00a86b', pts: pts(power), width: 1.5, kind: 'area' }] }));
    if (speed) {
      if (disc === 'Run' || disc === 'Swim') {
        var per = disc === 'Run' ? 1000 : 100, pace = speed.map(function (v) { return v > (disc === 'Run' ? 1.2 : 0.3) ? per / v : null; });
        root.appendChild(TP.chart.xy({ title: 'Pace' + (disc === 'Run' ? ' (/km)' : ' (/100 m)') + ', faster is higher', height: 150, x: xAxis, tipX: tipX, y: { fmt: A.fmtPace, invert: true },
          series: [{ name: 'Pace', col: TP.SPORT_COLOURS[disc], pts: pts(pace), width: 1.5 }] }));
      } else root.appendChild(TP.chart.xy({ title: 'Speed (km/h)', height: 150, x: xAxis, tipX: tipX, y: { fmt: function (v) { return (Math.round(v * 10) / 10).toFixed(1); }, zero: true },
        series: [{ name: 'Speed (km/h)', col: '#1f7aff', pts: pts(speed.map(function (v) { return fin(v) ? v * 3.6 : null; })), width: 1.5 }] }));
    }
    if (alt && disc !== 'Swim') root.appendChild(TP.chart.xy({ title: 'Elevation (m)', height: 110, x: xAxis, tipX: tipX, y: { fmt: function (v) { return Math.round(v); } },
      series: [{ name: 'Elevation (m)', col: '#8a8a8a', pts: pts(alt), width: 1.2, kind: 'area', fillAlpha: 0.2 }] }));
    if (!root.children.length) root.appendChild(h('p', { class: 'muted small' }, 'No heart rate, pace or power was recorded.'));
  }
})(window.TP);
