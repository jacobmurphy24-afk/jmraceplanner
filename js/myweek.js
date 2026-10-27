// Home: one page with the week at a glance - the current training block and how it's going, the
// countdown to the next race, the week's plan against what's been done, and fitness and health.
(function (TP) {
  var h = TP.h, A = TP.TA, C = TP.chart, fin = A.fin, sp = A.sprintf;
  var MW = TP.myWeek = {};
  TP.view.mwOffset = TP.view.mwOffset || 0;
  var DEFAULT_TSS_H = { Run: 60, Bike: 55, Swim: 50, Other: 40 };
  function kpi(v, l, s, col) { return h('div', { class: 'kpi', style: col ? 'border-left-color:' + col : null }, h('div', { class: 'kpi-v', style: col ? 'color:' + col : null }, v), h('div', { class: 'kpi-l' }, l), s ? h('div', { class: 'kpi-s' }, s) : null); }
  function sportOf(s) { var sp2 = TP.sportOf(s.discipline); return ['Swim', 'Bike', 'Run'].indexOf(sp2) >= 0 ? sp2 : 'Other'; }

  // The page: the site's home page.
  MW.page = function (root) {
    root.appendChild(h('div', { class: 'page-head page-head-row mw-head-row' }, h('h2', { class: 'grow' }, 'Home'), TP.garmin.statusButton()));
    if (TP.garmin.prep) root.appendChild(h('div', { class: 'panel prep' }, h('div', { class: 'spinner' }), h('span', { id: 'g-prep' }, 'Analysing activities: ' + TP.garmin.prep.done + ' of ' + TP.garmin.prep.total + '…')));
    MW.render(root);
  };
  MW.render = function (root) {
    var G = TP.garmin, today = TP.today(), ws = TP.addDays(TP.weekStart(today), 7 * TP.view.mwOffset), we = TP.addDays(ws, 6);
    var hasG = G.loaded && G.acts.length > 0, ctx = hasG ? G.ctx() : null, M = TP.match;
    var isNow = TP.view.mwOffset === 0;
    // --- Week picker ---
    root.appendChild(h('div', { class: 'mw-nav' },
      h('button', { class: 'btn btn-icon', 'aria-label': 'Previous week', onclick: function () { TP.view.mwOffset--; TP.changed(); } }, TP.icon('chev-l')),
      h('div', { class: 'mw-title' }, h('b', null, isNow ? 'This week' : TP.view.mwOffset === -1 ? 'Last week' : TP.view.mwOffset === 1 ? 'Next week' : 'Week of ' + TP.fmt(ws, '%d %b')),
        h('span', { class: 'muted' }, TP.fmt(ws, '%a %d %b') + ' – ' + TP.fmt(we, '%a %d %b %Y'))),
      h('button', { class: 'btn btn-icon', 'aria-label': 'Next week', onclick: function () { TP.view.mwOffset++; TP.changed(); } }, TP.icon('chev-r')),
      !isNow ? h('button', { class: 'btn btn-sm', onclick: function () { TP.view.mwOffset = 0; TP.changed(); } }, 'This week') : null));

    var planned = TP.sessionsBetween(ws, we).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var acts = hasG ? ctx.scored.filter(function (a) { return a.date >= ws && a.date <= we && a.discipline !== 'Transition'; }) : [];
    var rate = tssRates(ctx);

    // --- The plan against what's been done ---
    root.appendChild(weekGrid(ws, planned, acts, hasG));

    // --- Block and race ---
    var cards = h('div', { class: 'coach-2' });
    cards.appendChild(blockCard(ws, we));
    cards.appendChild(raceCard(ctx));
    root.appendChild(cards);

    // --- Fitness, fatigue and form (full width) ---
    if (hasG) root.appendChild(formChart(ctx, ws, we, planned, rate));

    // --- Fitness and health ---
    root.appendChild(health(ctx, ws, we, planned));
  };

  // Typical training stress per hour in each sport (last 4 months), to estimate planned load.
  function tssRates(ctx) {
    var rate = Object.assign({}, DEFAULT_TSS_H); if (!ctx) return rate;
    var rec = ctx.scored.filter(function (a) { return a.date >= TP.addDays(TP.today(), -120) && a.hours > 0.25; });
    Object.keys(rate).forEach(function (d) { var v = rec.filter(function (a) { return a.discipline === d; }).map(function (a) { return a.tss / a.hours; }).filter(fin); if (v.length >= 5) rate[d] = A.median(v); });
    return rate;
  }

  // Fitness, fatigue and form over the last six weeks, projected to the end of the week from the plan.
  function formChart(ctx, ws, we, planned, rate) {
    var today = TP.today(), to = we < today ? we : TP.addDays(today, -1), from = TP.addDays(ws, -35);
    var load = A.loadModel(ctx.scored, from, to < from ? from : to).map(function (d) { return Object.assign({ kind: 'Done' }, d); });
    if (load.length && we >= today) {
      var last = load[load.length - 1], c = last.ctl, at = last.atl, tssBy = {};
      planned.forEach(function (s) { if (s.date >= today && !TP.match.linkFor(s.id)) tssBy[s.date] = (tssBy[s.date] || 0) + TP.estHours(s) * (rate[sportOf(s)] || 40); });
      for (var d = TP.addDays(last.date, 1); d <= we; d = TP.addDays(d, 1)) { var t = tssBy[d] || 0, tsb = c - at; c += (t - c) / 42; at += (t - at) / 7; load.push({ date: d, tss: t, ctl: c, atl: at, tsb: tsb, kind: 'Planned' }); }
    }
    var p = h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, 'Fitness, fatigue and form'),
      h('div', { class: 'muted small' }, 'The last six weeks' + (we >= today ? ', and where this week’s plan takes you (dashed)' : '') + '. The shaded area is this week.'));
    p.appendChild(TP.coach.pmcChart(load, { height: 260, bands: [{ x0: C.dnum(ws) - 0.5, x1: C.dnum(we) + 0.5, fill: '#f3f0ff' }] }));
    return p;
  }

  // The training block this week sits in, and how it's going.
  function blockCard(ws, we) {
    var sched = TP.schedule(), entry = sched.filter(function (e) { return (e.kind === 'train' || e.kind === 'recov') && e.start <= we && e.end >= ws; })
      .sort(function (a, b) { return (a.kind === 'train' ? 0 : 1) - (b.kind === 'train' ? 0 : 1); })[0];
    var p = h('div', { class: 'panel mw-card' }, h('div', { class: 'lbl' }, 'Training block'));
    if (!entry) { p.appendChild(h('p', { class: 'muted' }, 'No training block this week.')); p.appendChild(h('button', { class: 'btn btn-sm needs-edit', onclick: function () { TP.eventForm(null, ws); } }, TP.icon('plus'), 'Add an event')); return p; }
    var rb = TP.reportBlock(entry.bid), ev = rb.p, label = TP.blockWeekLabel(entry, ws);
    var wkN = Math.floor(TP.daysBetween(rb.start, ws) / 7) + 1, phase = entry.kind === 'recov' ? 'Recovery' : wkN >= 1 && wkN <= rb.n ? rb.phase[wkN - 1] : '';
    p.style.borderTop = '4px solid ' + rb.col;
    p.appendChild(h('div', { class: 'mw-head' }, h('div', null, h('b', { class: 'mw-name' }, rb.name), h('div', { class: 'muted small' }, label)), phase ? h('span', { class: 'phase ' + phase.toLowerCase().replace(' ', '-') }, phase) : null));
    if (entry.kind === 'train') {
      var pct = Math.max(0, Math.min(100, (TP.daysBetween(rb.start, ws) + 7) / ((rb.n) * 7) * 100));
      p.appendChild(h('div', { class: 'rp-progress', style: 'margin:8px 0' }, h('div', { style: 'width:' + pct + '%' })));
    }
    var due = rb.sess.filter(function (s) { return s.date < TP.today(); }), hasG = TP.garmin.loaded && TP.garmin.acts.length;
    var done = hasG ? due.filter(function (s) { return TP.match.linkFor(s.id); }).length : null;
    p.appendChild(h('div', { class: 'mini-kpis' },
      (function () {
        var nb = TP.blockWeeks(ev);
        if (entry.kind === 'recov') return h('div', null, h('b', null, 'Recovery'), h('span', null, 'after the race'));
        return h('div', null, h('b', null, rb.status === 'Upcoming' || wkN < 1 ? '–' : wkN > nb ? (ev.race_type === 'Training Only' ? 'Final week' : 'Race week') : 'Week ' + wkN + '/' + nb), h('span', null, 'of the build'));
      })(),
      h('div', null, h('b', null, hasG && due.length ? done + '/' + due.length : rb.sess.length), h('span', null, hasG && due.length ? 'sessions done' : 'sessions planned')),
      h('div', null, h('b', null, TP.daysBetween(TP.today(), rb.race_date) >= 0 ? TP.daysBetween(TP.today(), rb.race_date) + ' days' : 'Done'), h('span', null, 'to ' + (ev.race_type === 'Training Only' ? 'the end' : 'race day')))));
    // How it's going (Garmin): the block's progress check.
    if (hasG && rb.status !== 'Upcoming') {
      var pr = TP.reportProgress(rb.id);
      if (pr && !pr.empty) {
        var items = pr.good.slice(0, 2).map(function (x) { return ['good', x]; }).concat(pr.watch.slice(0, 2).map(function (x) { return ['watch', x]; }));
        p.appendChild(h('div', { class: 'lbl', style: 'margin-top:10px' }, 'How it’s going'));
        p.appendChild(h('ul', { class: 'flist' }, items.map(function (x) {
          return h('li', null, h('span', { class: 'sev sev-s', style: 'background:' + (x[0] === 'good' ? '#00a86b' : '#d99a00') }, x[0] === 'good' ? '✓' : '!'), h('span', null, x[1]));
        })));
      }
    }
    p.appendChild(h('div', { class: 'btn-row', style: 'margin-top:8px' },
      h('button', { class: 'btn btn-sm', onclick: function () { TP.blockModal(rb.id); } }, TP.icon('chart'), 'Block report'),
      hasG && rb.start <= TP.today() ? h('button', { class: 'btn btn-sm', onclick: function () { var rv = TP.blocks.list().filter(function (x) { return x.calendar_id === rb.id; })[0]; if (rv) TP.blocks.open(rv); } }, 'Block review') : null));
    return p;
  }

  // Countdown to the next race.
  function raceCard(ctx) {
    var today = TP.today(), ids = Object.keys(TP.state.events).filter(function (id) { var e = TP.state.events[id]; return e.race_type !== 'Training Only' && e.race_date >= today; })
      .sort(function (a, b) { return TP.state.events[a].race_date < TP.state.events[b].race_date ? -1 : 1; });
    var p = h('div', { class: 'panel mw-card' }, h('div', { class: 'lbl' }, 'Next race'));
    if (!ids.length) { p.appendChild(h('p', { class: 'muted' }, 'No races coming up.')); p.appendChild(h('button', { class: 'btn btn-sm needs-edit', onclick: function () { TP.eventForm(null, today); } }, TP.icon('plus'), 'Add a race')); return p; }
    var id = ids[0], e = TP.state.events[id], days = TP.daysBetween(today, e.race_date), weeks = Math.floor(days / 7);
    p.style.borderTop = '4px solid ' + e.palette.race;
    p.appendChild(h('div', { class: 'mw-head' }, h('div', null, h('b', { class: 'mw-name' }, TP.eventName(e)), h('div', { class: 'muted small' }, e.race_type + ' · ' + TP.eventDistance(e) + ' · ' + TP.fmt(e.race_date, '%A %d %B %Y'))),
      e.priority ? h('span', { class: 'prio prio-' + e.priority }, 'P' + e.priority) : null));
    p.appendChild(h('div', { class: 'mw-count' }, h('b', null, days === 0 ? 'Today' : days), days === 0 ? null : h('span', null, days === 1 ? 'day to go' : 'days to go' + (weeks >= 1 ? ' · ' + weeks + (weeks === 1 ? ' week' : ' weeks') + (days % 7 ? ' ' + (days % 7) + (days % 7 === 1 ? ' day' : ' days') : '') : ''))));
    var facts = [];
    // Predicted time for running races, from the last 12 weeks of running.
    var dist = { '5K': 5000, '10K': 10000, 'Half Marathon': 21097.5, Marathon: 42195 }[e.run_dist];
    if (ctx && e.race_type === 'Run' && dist) {
      var r = A.analyse(ctx.scored, ctx.feats, ctx.prof, TP.addDays(today, -84), today, null);
      if (!r.empty) { var pr = A.predictRun(dist, r.cs_fit, r.best_efforts); if (fin(pr.time_s)) facts.push(['Predicted time today', A.fmtDur(pr.time_s), pr.method]); }
    }
    if (ctx && TP.reportBlock(id) && TP.reportBlock(id).status !== 'Upcoming') {
      var prog = TP.reportProgress(id);
      if (prog && !prog.empty) facts.push(['Race-day form (projected)', sp('%+.0f', prog.race_proj.tsb), TP.coach.formLabel(prog.race_proj.tsb) + sp(' · fitness %.0f', prog.race_proj.ctl)]);
    }
    if (ids.length > 1) { var nx = TP.state.events[ids[1]]; facts.push(['Then', TP.eventName(nx), TP.fmt(nx.race_date, '%d %b %Y') + ' · in ' + TP.daysBetween(today, nx.race_date) + ' days']); }
    facts.forEach(function (f) { p.appendChild(h('div', { class: 'mk' }, h('span', null, f[0]), h('span', { class: 'right' }, h('b', null, f[1]), h('div', { class: 'muted small' }, f[2])))); });
    return p;
  }

  // Monday to Sunday: what was planned (with how it went) and what was done.
  function weekGrid(ws, planned, acts, hasG) {
    var M = TP.match, today = TP.today(), p = h('div', { class: 'panel' });
    var plH = A.sum(planned.map(TP.estHours)), plKm = A.sum(planned.map(function (s) { return s.total_dist || 0; }));
    var doH = A.sum(acts.map(function (a) { return a.hours; })), doKm = A.sum(acts.map(function (a) { return a.km; })), doTss = A.sum(acts.map(function (a) { return a.tss; }));
    var due = planned.filter(function (s) { return s.date < today; }), doneN = hasG ? due.filter(function (s) { return M.linkFor(s.id); }).length : 0;
    p.appendChild(h('div', { class: 'panel-top' }, h('div', { class: 'panel-h' }, 'Planned and done'),
      h('div', { class: 'muted small' }, 'Planned ' + planned.length + ' session' + (planned.length === 1 ? '' : 's') + ' · ' + TP.fmtH(plH) + (plKm > 0 ? ' · ' + TP.fmtKm(plKm) : '') +
        (hasG ? '  —  Done ' + acts.length + ' · ' + TP.fmtH(doH) + (doKm > 0 ? ' · ' + TP.fmtKm(doKm) : '') + ' · ' + Math.round(doTss) + ' TSS' + (due.length ? ' · ' + doneN + '/' + due.length + ' planned sessions done' : '') : ''))));
    var grid = h('div', { class: 'mw-grid' });
    for (var i = 0; i < 7; i++) {
      var d = TP.addDays(ws, i), ds = planned.filter(function (s) { return s.date === d; }), da = hasG ? TP.garmin.acts.filter(function (a) { return a.date === d; }) : [];
      var col = h('div', { class: 'mw-day' + (d === today ? ' today' : '') + (d < today ? ' past' : '') },
        h('div', { class: 'mw-day-h' }, h('b', null, TP.fmt(d, '%a')), h('span', { class: 'mw-dl' }, TP.fmt(d, '%d %b')), h('span', { class: 'mw-ds' }, TP.fmt(d, '%d'))));
      ds.forEach(function (s) {
        var st = hasG ? M.status(s) : null, k = st ? st.st : '';
        if (st && st.act) return;   // done: its Garmin activity is shown in its place, below
        col.appendChild(h('div', { class: 'mchip' + (k ? ' mchip-' + k : ''), style: 'border-left-color:' + TP.typeCol(s.type), onclick: function () { TP.sessionView(s.id); } },
          M.STATUS_ICON[k] ? h('span', { class: 'mchip-tick' }, M.STATUS_ICON[k]) : null, h('span', { class: 'mchip-t' }, TP.sportLabel(s.discipline) + ' ' + s.type),
          h('span', { class: 'mchip-s' }, String(s.discipline).replace(/^(Indoor|Outdoor) /, '')), h('span', { class: 'mchip-d' }, TP.planAmount(s))));
      });
      da.forEach(function (a) {
        var linked = M.sessionObjForAct(a.id), lst = linked && M.status(linked), lk = lst ? lst.st : '';
        col.appendChild(h('div', { class: 'achip' + (lk ? ' mchip-' + lk : ''), style: 'border-left-color:' + (TP.SPORT_COLOURS[a.sport] || '#8a8a8a'), onclick: function () { TP.activityView(a.id); },
          title: linked ? (TP.match.STATUS_LABEL[lk] || 'Completed') + ': planned ' + TP.sportLabel(linked.discipline) + ' ' + linked.type + ', ' + TP.planAmount(linked) : 'Activity not in a plan' },
          M.STATUS_ICON[lk] ? h('span', { class: 'mchip-tick' }, M.STATUS_ICON[lk]) : h('span', { class: 'achip-i' }, TP.icon('activity')), h('span', { class: 'mchip-t' }, a.name || a.sport), h('span', { class: 'mchip-s' }, /multi_sport/.test(a.type || '') ? 'Multi' : a.sport), h('span', { class: 'mchip-d' }, M.actAmount(a).split(' · ')[0])));
      });
      if (!ds.length && !da.length) col.appendChild(h('div', { class: 'muted small mw-rest' }, d < today ? 'Rest' : '–'));
      grid.appendChild(col);
    }
    p.appendChild(grid);
    p.appendChild(h('div', { class: 'legend small', style: 'margin-top:8px' }, h('span', null, h('i', { style: 'background:#00a86b' }), 'Done'), h('span', null, h('i', { style: 'background:#e0a100' }), 'Partly done'),
      h('span', null, h('i', { style: 'background:#ff3b30' }), 'Missed'), h('span', null, h('i', { style: 'background:#e4e4e4;border:1px solid #8a8a8a' }), 'Activity not in a plan')));
    return p;
  }

  // Fitness (training load) and health (sleep, HRV, resting heart rate), with a readiness read-out.
  function health(ctx, ws, we) {
    var p = h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, 'Fitness and health'));
    if (!ctx) { p.appendChild(h('p', { class: 'muted small' }, 'Connect Garmin and sync to see your fitness, fatigue, sleep and heart-rate variability here.')); return p; }
    var today = TP.today(), asOf = we < today ? we : today, yday = TP.addDays(asOf, -1);
    var load = A.loadModel(ctx.scored, TP.addDays(asOf, -14), yday), now = load[load.length - 1], wkAgo = load[load.length - 8];
    var ramp = now && wkAgo ? now.ctl - wkAgo.ctl : null, acwr = now && now.ctl > 10 ? now.atl / now.ctl : null;
    var w = ctx.wellness || [], recent = w.filter(function (x) { return x.date <= asOf && x.date > TP.addDays(asOf, -3); });
    var night = recent.length ? recent[recent.length - 1] : null;
    var base = w.filter(function (x) { return x.date < TP.addDays(asOf, -1) && x.date >= TP.addDays(asOf, -29); });
    var last7 = w.filter(function (x) { return x.date <= asOf && x.date > TP.addDays(asOf, -7); });
    var rhrBase = A.mean(base.map(function (x) { return x.rhr; })), hrvBase = A.mean(base.map(function (x) { return x.hrv; }));
    var sleep7 = A.mean(last7.map(function (x) { return x.sleep_h; }));
    var vo2 = ctx.scored.filter(function (a) { return fin(a.vo2max) && a.date <= asOf; }).slice(-1)[0];
    var formCol = !now ? null : now.tsb < -30 ? '#ff3b30' : now.tsb < -10 ? '#2b4dff' : now.tsb <= 25 ? '#00a86b' : '#d99a00';
    p.appendChild(h('div', { class: 'lbl', style: 'margin-top:8px' }, 'Fitness'));
    p.appendChild(h('div', { class: 'kpi-grid' },
      kpi(now ? Math.round(now.ctl) : '–', 'Fitness (CTL)', fin(ramp) ? sp('%+.1f in the last week', ramp) : null),
      kpi(now ? Math.round(now.atl) : '–', 'Fatigue (ATL)', 'last 7 days'),
      kpi(now ? sp('%+.0f', now.tsb) : '–', 'Form (TSB)', now ? TP.coach.formLabel(now.tsb) : null, formCol),
      kpi(fin(acwr) ? acwr.toFixed(2) : '–', 'Load ratio (ACWR)', fin(acwr) ? (acwr > 1.5 ? 'spike – ease off' : acwr > 1.3 ? 'high' : acwr < 0.8 ? 'low' : 'in the safe range') : null, fin(acwr) ? (acwr > 1.5 ? '#ff3b30' : acwr > 1.3 ? '#d99a00' : null) : null),
      vo2 ? kpi(Math.round(vo2.vo2max), 'VO2max', 'Garmin, ' + TP.fmt(vo2.date, '%d %b')) : null));
    p.appendChild(h('div', { class: 'lbl', style: 'margin-top:12px' }, 'Health' + (night ? ' (night of ' + TP.fmt(TP.addDays(night.date, -1), '%a %d %b') + ')' : '')));
    var hrvState = night && fin(night.hrv) ? (fin(night.hrv_low) && night.hrv < night.hrv_low ? 'low' : fin(night.hrv_high) && night.hrv > night.hrv_high ? 'high' : fin(night.hrv_low) ? 'normal' : fin(hrvBase) ? (night.hrv < 0.9 * hrvBase ? 'low' : 'normal') : null) : null;
    var rhrDiff = night && fin(night.rhr) && fin(rhrBase) ? night.rhr - rhrBase : null;
    if (!w.length) p.appendChild(h('p', { class: 'muted small' }, 'No sleep or HRV data yet. Sync from Garmin to add it.'));
    else p.appendChild(h('div', { class: 'kpi-grid' },
      kpi(night && fin(night.sleep_h) ? night.sleep_h.toFixed(1) + ' h' : '–', 'Sleep last night', night && fin(night.sleep_score) ? 'score ' + Math.round(night.sleep_score) : null, night && fin(night.sleep_h) ? (night.sleep_h < 6.5 ? '#d99a00' : null) : null),
      kpi(fin(sleep7) ? sleep7.toFixed(1) + ' h' : '–', 'Sleep, 7-night average', fin(sleep7) ? (sleep7 >= 8 ? 'plenty' : sleep7 >= 7 ? 'OK – 8 h is better' : 'too little') : null, fin(sleep7) && sleep7 < 7 ? '#d99a00' : null),
      kpi(night && fin(night.hrv) ? Math.round(night.hrv) + ' ms' : '–', 'Overnight HRV', night && fin(night.hrv_low) ? 'normal ' + Math.round(night.hrv_low) + '–' + Math.round(night.hrv_high) + ' ms' : fin(hrvBase) ? 'usual ' + Math.round(hrvBase) + ' ms' : null, hrvState === 'low' ? '#d99a00' : hrvState ? '#00a86b' : null),
      kpi(night && fin(night.rhr) ? Math.round(night.rhr) + ' bpm' : '–', 'Resting HR', fin(rhrDiff) ? sp('%+.0f vs your usual', rhrDiff) : null, fin(rhrDiff) && rhrDiff >= 3 ? '#d99a00' : null)));
    // Readiness: what the numbers mean together.
    var good = [], watch = [];
    if (now) {
      if (now.tsb < -30) watch.push(sp('Form %+.0f: very tired. Take an easy day or two before the next key session.', now.tsb));
      else if (now.tsb < -10) good.push(sp('Form %+.0f: productive fatigue – you’re absorbing the training.', now.tsb));
      else if (now.tsb <= 5) good.push(sp('Form %+.0f: neutral – fine for normal training.', now.tsb));
      else if (now.tsb <= 25) good.push(sp('Form %+.0f: fresh – a good day for a key session or a race.', now.tsb));
      else watch.push(sp('Form %+.0f: very fresh – after more than a week or two like this, fitness starts to slip.', now.tsb));
    }
    if (fin(acwr) && acwr > 1.5) watch.push(sp('The last 7 days were %.1f× your usual load: a spike that raises injury risk. Keep the next few days easy.', acwr));
    if (fin(ramp) && ramp > 8) watch.push(sp('Fitness rose %.1f in a week, more than most athletes can absorb. Hold the load steady.', ramp));
    if (hrvState === 'low') watch.push('Overnight HRV is below your normal range: a sign of fatigue, illness or stress. Keep today easy.');
    else if (hrvState === 'normal') good.push('Overnight HRV is in your normal range.');
    else if (hrvState === 'high') good.push('Overnight HRV is above your normal range: well recovered.');
    if (fin(rhrDiff) && rhrDiff >= 3) watch.push(sp('Resting heart rate is %.0f bpm above your usual: watch for illness or overreaching.', rhrDiff));
    if (fin(sleep7) && sleep7 < 7) watch.push(sp('You’ve averaged %.1f h of sleep this week; aim for 8 h to absorb the training.', sleep7));
    var verdict = watch.length >= 2 || (hrvState === 'low' && now && now.tsb < -20) ? ['Take it easy', '#ff3b30'] : watch.length === 1 ? ['Train, but listen to your body', '#d99a00'] : ['Ready to train', '#00a86b'];
    p.appendChild(h('div', { class: 'mw-ready', style: 'border-color:' + verdict[1] }, h('div', { class: 'lbl' }, isToday(asOf) ? 'Readiness today' : 'Readiness at the end of the week'), h('b', { style: 'color:' + verdict[1] }, verdict[0])));
    p.appendChild(h('div', { class: 'coach-2' }, h('div', null, TP.coach.list(good, 'good')), h('div', null, TP.coach.list(watch, 'watch'))));
    // The week's coach's notes (from the week analysis).
    var wa = A.weekAnalysis(ctx.scored, ctx.wellness, TP.state.sessions, TP.match.linkMaps(), ws);
    if (wa.status !== 'upcoming' && (wa.good.length || wa.warn.length)) {
      p.appendChild(h('div', { class: 'lbl', style: 'margin-top:12px' }, 'The week so far · ' + wa.verdict + (fin(wa.score) ? ' (' + wa.score + ')' : '')));
      p.appendChild(h('div', { class: 'coach-2' }, h('div', null, TP.coach.list(wa.good, 'good')), h('div', null, TP.coach.list(wa.warn, 'watch'))));
      p.appendChild(h('button', { class: 'btn btn-sm', style: 'margin-top:6px', onclick: function () { TP.coach.openWeek(ws, '', null); } }, 'Full week analysis →'));
    }
    return p;
  }
  function isToday(d) { return d === TP.today(); }
})(window.TP);
