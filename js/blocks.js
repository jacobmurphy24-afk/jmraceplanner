// Training block reviews: how effective a build was, how well you tapered and recovered, and how the
// race compared with what the training predicted. Every event in the calendar gets one automatically;
// more can be added for blocks that aren't in the calendar. Saved with your account.
(function (TP) {
  var h = TP.h, A = TP.TA, C = TP.chart, CO = TP.coach, fin = A.fin, sp = A.sprintf;
  var B = TP.blocks = {};
  var COMP = { fitness: 'Fitness gain', consistency: 'Consistency', load_safety: 'Load management', intensity: 'Intensity distribution', specificity: 'Race specificity',
    taper: 'Taper & freshness', recovery: 'Recovery (sleep & HRV)', performance: 'Result vs prediction', pacing: 'Pacing', durability: 'Durability' };
  var TYPE_COL = { Intervals: '#ff3b30', Threshold: '#d99a00', 'Long endurance': '#2b4dff', Endurance: '#00a86b', Tempo: '#d99a00', Speed: '#ff3b30', Mixed: '#9b30ff', Recovery: '#666666', Short: '#999999', 'Grey zone': '#7d5a12' };
  var verdict = function (x) { return !fin(x) ? '' : x >= 85 ? 'Excellent' : x >= 75 ? 'Good' : x >= 65 ? 'Solid' : x >= 50 ? 'Mixed' : 'Needs work'; };
  var sportCol = function (s) { return { Run: '#ff3b30', Bike: '#00a86b', Swim: '#1f7aff', Triathlon: '#ffb400', Duathlon: '#ff766e', Hyrox: '#9b30ff' }[s] || '#585858'; };
  var kpi = CO.kpi;

  // --- Reviews: saved ones, and one for every calendar event whose build has started ---
  function saved() { return (TP.mine.get('reviews').items) || {}; }
  B.list = function () {
    var items = saved(), out = Object.keys(items).map(function (k) { return items[k]; }), today = TP.today();
    Object.keys(TP.state.events).forEach(function (bid) {
      if (out.some(function (r) { return r.calendar_id === bid; })) return;
      var p = TP.state.events[bid], start = TP.blockStart(p);
      if (start > today) return;
      out.push({ id: 'cal_' + bid, auto: true, name: TP.eventName(p), sport: p.race_type, start: start, race_date: p.race_date, goal_s: null, race_ids: [], calendar_id: bid });
    });
    return out.sort(function (a, b) { return a.race_date < b.race_date ? 1 : -1; });
  };
  var cache = {};
  B.result = function (rv) {
    var ctx = TP.garmin.ctx(), key = ctx.key + '|' + JSON.stringify(rv) + '|' + TP.match.compute().key;
    if (cache[rv.id] && cache[rv.id].key === key) return cache[rv.id].r;
    var r; try { r = A.blockReview(ctx, rv); } catch (e) { console.error(e); r = { empty: true, error: e.message, review: rv }; }
    cache[rv.id] = { key: key, r: r };
    return r;
  };
  function saveReview(rv) { var st = Object.assign({}, TP.mine.get('reviews')); st.items = Object.assign({}, st.items || {}); st.items[rv.id] = rv; TP.mine.set('reviews', st); }
  function deleteReview(id) { var st = Object.assign({}, TP.mine.get('reviews')); st.items = Object.assign({}, st.items || {}); delete st.items[id]; TP.mine.set('reviews', st); }

  B.render = function (root) {
    var list = B.list();
    root.appendChild(h('div', { class: 'panel-top', style: 'margin-bottom:10px' },
      h('div', null, h('div', { class: 'panel-h' }, 'Training block reviews'), h('div', { class: 'muted small' }, 'Every event in your calendar gets a review once its build starts. Add others for blocks that aren’t in the calendar. Click a tile for the full review.')),
      h('button', { class: 'btn btn-primary', onclick: function () { B.form(null); } }, TP.icon('plus'), 'New block review')));
    if (!list.length) { root.appendChild(h('div', { class: 'empty' }, h('h3', null, 'No blocks to review yet'), h('p', null, 'Add an event to the calendar, or create a review for a previous block with its dates.'))); return; }
    root.appendChild(h('div', { class: 'br-grid' }, list.map(tile)));
  };
  function tile(rv) {
    var r = B.result(rv), weeks = Math.round(TP.daysBetween(rv.start, rv.race_date) / 7), rs = r.race_summary;
    var line = r.empty ? 'No Garmin data for this block yet – open it to sync' : r.upcoming ? 'Race to come – training so far' : !rs ? 'No race activity found on race day'
      : 'Race: ' + A.fmtDur(rs.time_s) + (rs.km > 0 ? sp(' · %.1f km', rs.km) : '') + (fin(rs.display_ratio) ? sp(' · %.1f%% %s than predicted', Math.abs(rs.display_ratio - 1) * 100, rs.display_ratio >= 1 ? 'faster' : 'slower') : '');
    return h('div', { class: 'br-tile', style: 'border-top-color:' + sportCol(rv.sport), onclick: function () { B.open(rv); } },
      h('div', { class: 'br-tile-top' },
        h('div', { style: 'min-width:0' }, h('div', { class: 'rp-type', style: 'color:' + sportCol(rv.sport) }, rv.sport.toUpperCase()), h('div', { class: 'rp-name' }, rv.name),
          h('div', { class: 'muted small' }, weeks + '-week block · race ' + TP.fmt(rv.race_date, '%d %b %Y'))),
        h('div', { class: 'br-rings' }, C.ring(r.empty ? null : r.training_score, 'Training', 52), C.ring(r.empty ? null : r.race_score, 'Race', 52))),
      h('div', { class: 'br-line' }, line));
  }

  // --- Create / edit ---
  B.form = function (rv) {
    var ev = Object.keys(TP.state.events).sort(function (a, b) { return TP.state.events[a].race_date < TP.state.events[b].race_date ? -1 : 1; });
    var cal = TP.selectEl([{ value: '', label: 'Manual entry' }].concat(ev.map(function (id) { var p = TP.state.events[id]; return { value: id, label: TP.eventName(p) + ' (' + TP.fmt(p.race_date, '%d %b %Y') + ')' }; })), rv ? rv.calendar_id || '' : '');
    var name = TP.input('text', rv ? rv.name : ''), sport = TP.selectEl(['Run', 'Bike', 'Swim', 'Triathlon', 'Duathlon', 'Hyrox', 'Training Only'], rv ? rv.sport : 'Run');
    var start = TP.input('date', rv ? rv.start : TP.weekStart(TP.addDays(TP.today(), -84))), race = TP.input('date', rv ? rv.race_date : TP.today());
    var goal = TP.input('text', rv && fin(rv.goal_s) ? A.fmtDur(rv.goal_s) : '', { placeholder: 'e.g. 1:29:59' });
    var picks = h('div'), chosen = (rv && rv.race_ids || []).slice();
    function drawPicks() {
      TP.clear(picks);
      var day = TP.garmin.acts.filter(function (a) { return a.date === race.value; });
      if (!day.length) { picks.appendChild(h('p', { class: 'hint' }, 'No synced activities on race day yet. The race is found automatically after syncing.')); return; }
      picks.appendChild(h('div', { class: 'field-l', style: 'margin-top:10px' }, 'Race activity (leave all unticked to detect it automatically; tick each leg for a triathlon done as separate activities)'));
      day.forEach(function (a) {
        var cb = TP.input('checkbox', '', { checked: chosen.indexOf(a.id) >= 0 });
        cb.addEventListener('change', function () { chosen = chosen.filter(function (x) { return x !== a.id; }); if (cb.checked) chosen.push(a.id); });
        picks.appendChild(h('label', { class: 'check' }, cb, (a.name || a.type) + ' · ' + TP.fmtDuration(a.moving_s || 0) + (a.distance_m > 0 ? ' · ' + TP.round(a.distance_m / 1000, 1) + ' km' : '')));
      });
    }
    race.addEventListener('change', drawPicks);
    cal.addEventListener('change', function () {
      var p = TP.state.events[cal.value]; if (!p) return;
      name.value = TP.eventName(p); sport.value = p.race_type; race.value = p.race_date; start.value = TP.blockStart(p); drawPicks();
    });
    drawPicks();
    var m = TP.modal({ size: 'm', stack: true, title: h('div', { class: 'md-t' }, rv ? 'Edit block review' : 'New training block review'),
      body: [TP.field('Import from a calendar event (optional)', cal), TP.field('Race / block name', name), TP.field('Race type', sport),
        h('div', { class: 'row2', style: 'margin-top:10px' }, TP.field('Block start', start), TP.field('Race date', race)),
        TP.field('Goal time (h:mm:ss, optional)', goal), picks],
      footer: [h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel'), h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', onclick: function () {
          if (!start.value || !race.value || start.value >= race.value) { TP.toast('The block start must be before the race date.', 'warn'); return; }
          var g = goal.value.trim() ? A.parseHms(goal.value) : null;
          if (goal.value.trim() && !g) { TP.toast('Enter the goal time as h:mm:ss or mm:ss.', 'warn'); return; }
          var out = { id: rv && !rv.auto ? rv.id : 'br' + Date.now(), name: name.value.trim() || sport.value + ' block', sport: sport.value, start: start.value, race_date: race.value,
            goal_s: g, race_ids: chosen, calendar_id: cal.value || (rv && rv.calendar_id) || '' };
          saveReview(out); m.close(); B.open(out);
          var G = TP.garmin, covered = G.acts.some(function (a) { return a.date >= out.start && a.date <= TP.addDays(out.start, 7); });
          if (!covered && G.connected()) G.sync(out.start, out.race_date < TP.today() ? TP.addDays(out.race_date, 1) : TP.today(), true);
        } }, 'Save & analyse')] });
  };

  // --- The review ---
  // A review opens as its own page within Analysis (the back link returns to the tiles).
  B.open = function (rv) {
    TP.closeModals();
    TP.view.page = 'garmin'; TP.view.gtab = 'Block reviews'; TP.view.review = rv; TP.view.reviewTab = 'Summary';
    TP.render();
    var main = document.getElementById('main'); if (main) main.scrollTop = 0; window.scrollTo(0, 0);
  };
  B.close = function () { TP.view.review = null; TP.render(); };
  B.page = function (root, rv) {
    var G = TP.garmin, col = sportCol(rv.sport);
    root.appendChild(h('a', { href: '#', class: 'back-link', onclick: function (e) { e.preventDefault(); B.close(); } }, '← All block reviews'));
    root.appendChild(h('div', { class: 'br-page-head', style: '--c:' + col },
      h('div', null, h('div', { class: 'rp-type', style: 'color:' + col }, rv.sport.toUpperCase()), h('h2', null, rv.name),
        h('div', { class: 'muted' }, TP.fmt(rv.start, '%d %b %Y') + ' – race ' + TP.fmt(rv.race_date, '%d %b %Y'))),
      h('div', { class: 'btn-row' },
        G.connected() ? h('button', { class: 'btn btn-sm', disabled: !!G.syncing, onclick: function () { G.sync(rv.start, rv.race_date < TP.today() ? TP.addDays(rv.race_date, 1) : TP.today(), true); } }, TP.icon('download'), G.syncing ? 'Syncing…' : 'Sync this block') : null,
        h('button', { class: 'btn btn-sm', onclick: function () { B.form(rv); } }, TP.icon('pencil'), rv.auto ? 'Customise' : 'Edit'),
        !rv.auto ? h('button', { class: 'btn btn-sm btn-outline-danger', onclick: function () { TP.confirm('Delete the review “' + rv.name + '”? Your Garmin activities aren’t affected.', 'Delete', function () { deleteReview(rv.id); B.close(); }); } }, 'Delete') : null,
        TP.glossaryButton())));
    if (G.progress) root.appendChild(h('div', { class: 'sync-progress' }, G.progress));
    if (!G.loaded) { root.appendChild(h('p', { class: 'muted' }, 'Loading…')); return; }
    var r = B.result(rv);
    if (r.empty) {
      root.appendChild(h('div', { class: 'empty' }, h('h3', null, r.error ? 'Couldn’t analyse this block' : 'No Garmin activities in this block yet'),
        h('p', null, r.error || 'Sync the block’s dates from Garmin (Sync this block above) to see the review.')));
      return;
    }
    if (r.short_history) {
      var from = TP.addDays(rv.start, -42);
      root.appendChild(h('div', { class: 'notice' }, h('span', null, 'Your Garmin data on this device starts ' + TP.fmt(r.history_from, '%d %b %Y') + ', so where your fitness started this block can’t be measured yet. Sync from ' + TP.fmt(from, '%d %b %Y') + ' (6 weeks before the block) for the full review.'),
        G.connected() ? h('button', { class: 'btn btn-sm', disabled: !!G.syncing, onclick: function () { G.sync(from, r.history_from, true); } }, TP.icon('download'), 'Sync the earlier weeks') : null));
    }
    var tabs = ['Summary', 'Weeks', 'Training', 'Recovery', 'Taper & readiness', 'Race'], box = h('div');
    root.appendChild(TP.chips(tabs.map(function (t) { return { value: t, label: t }; }), TP.view.reviewTab || 'Summary', function (v) { TP.view.reviewTab = v; draw(v); }, 'tabs tabs-scroll'));
    root.appendChild(box);
    function draw(t) {
      TP.clear(box);
      try { ({ Summary: summary, Weeks: weeks, Training: training, Recovery: recovery, 'Taper & readiness': taper, Race: raceTab })[t](box, r, rv); }
      catch (e) { console.error(e); box.appendChild(h('p', null, 'Couldn’t draw this tab: ' + e.message)); }
    }
    draw(TP.view.reviewTab || 'Summary');
  };

  function bar(key, val) {
    var col = C.scoreCol(val);
    return h('div', { class: 'cbar' }, h('div', { class: 'cbar-t' }, h('span', null, COMP[key]), h('b', { style: 'color:' + col }, fin(val) ? Math.round(val) : 'no data')),
      h('div', { class: 'cbar-b' }, h('div', { style: 'width:' + (fin(val) ? Math.round(val) : 0) + '%;background:' + col })));
  }
  function summary(box, r) {
    var rs = r.race_summary;
    var head = r.upcoming ? 'Race is upcoming – scores reflect training so far.' : !rs ? 'No race activity found on race day – edit the review to pick it, or sync the race.'
      : A.fmtDur(rs.time_s) + (rs.km > 0 ? sp(' for %.1f km', rs.km) : '') + (fin(rs.display_ratio) ? sp(' · %.1f%% %s than predicted', Math.abs(rs.display_ratio - 1) * 100, rs.display_ratio >= 1 ? 'faster' : 'slower') : '')
        + (fin(rs.goal_delta) ? ' · ' + A.fmtDur(Math.abs(rs.goal_delta)) + (rs.goal_delta <= 0 ? ' under' : ' over') + ' goal' : '');
    box.appendChild(h('div', { class: 'br-sum' },
      h('div', null, h('div', { class: 'br-rings big' }, C.ring(r.training_score, 'Training effectiveness', 96, verdict(r.training_score) + ' build'), C.ring(r.race_score, 'Race execution', 96, fin(r.race_score) ? verdict(r.race_score) + ' race' : 'Race to come')),
        h('div', { class: 'br-head' }, head)),
      h('div', null, h('div', { class: 'form-section' }, 'Training effectiveness'), Object.keys(r.components).map(function (k) { return bar(k, r.components[k]); })),
      h('div', null, h('div', { class: 'form-section' }, 'Race execution'), r.race_components ? Object.keys(r.race_components).map(function (k) { return bar(k, r.race_components[k]); }) : h('p', { class: 'muted small' }, 'Available once the race activity is synced.'))));
    box.appendChild(h('div', { class: 'coach-2', style: 'margin-top:14px' },
      h('div', null, h('div', { class: 'form-section' }, '✓ What worked'), CO.list(r.findings.good, 'good')),
      h('div', null, h('div', { class: 'form-section' }, '→ Change for next block'), CO.list(r.findings.change, 'watch'))));
  }
  function weeks(box, r, rv) {
    var ctx = TP.garmin.ctx(), w0 = TP.weekStart(rv.start), list = [], today = TP.today();
    for (var w = w0; w <= rv.race_date && w <= today; w = TP.addDays(w, 7)) list.push(w);
    if (!list.length) { box.appendChild(h('p', { class: 'muted' }, 'No weeks of this block have started yet.')); return; }
    var sessions = rv.calendar_id ? TP.state.sessions.filter(function (s) { return s.block_id === rv.calendar_id; }) : TP.state.sessions;
    box.appendChild(h('p', { class: 'muted small' }, 'Every week of the block, newest first. Completed weeks are scored; the current week shows progress so far. Click a week for its full analysis.'));
    box.appendChild(CO.weekRows(list, sessions, ctx, function (wk) { return 'Week ' + (Math.round(TP.daysBetween(w0, wk) / 7) + 1); }));
  }
  function training(box, r, rv) {
    var tp = r.taper, nw = Math.max(1, r.train.weekly.length), acts = r.train.acts, d = r.train.dist_all;
    box.appendChild(h('div', { class: 'kpis kpis-5' },
      kpi(sp('%.0f → %.0f', tp.ctl0, tp.ctl_peak), 'Fitness (CTL)', sp('%+.0f%% over the block', tp.gain_pct)),
      kpi(sp('%.1f h', A.sum(acts.map(function (a) { return a.hours; })) / nw), 'Hours a week', sp('%.0f TSS a week', A.sum(acts.map(function (a) { return a.tss; })) / nw)),
      kpi(sp('%.1f', acts.length / nw), 'Sessions a week'),
      kpi(d.type.replace(' / low-intensity focus', ''), 'Intensity mix', fin(d.p1) ? sp('%.0f / %.0f / %.0f %%', d.p1, d.p2, d.p3) : null),
      r.train.compliance ? kpi(Math.round(r.train.compliance.completion) + '%', 'Plan compliance', Math.round(r.train.compliance.volume) + '% of planned km') : kpi('–', 'Plan compliance', 'no sessions planned')));
    var p = CO.panel('Weekly training load and fitness');
    p.appendChild(CO.weeklyChart(acts.map(function (a) { return { week: a.week, discipline: a.discipline, tss: a.tss, hours: a.hours }; }), 'tss'));
    p.appendChild(CO.pmcChart(r.load, { height: 170 }));
    box.appendChild(p);
    if (r.sport_impact.length) {
      box.appendChild(h('div', { class: 'form-section' }, 'How each sport responded'));
      box.appendChild(h('p', { class: 'muted small' }, 'Did each sport get faster, and did it build the endurance to hold up for longer? Like-for-like sessions early and late in the build: speed from best efforts, endurance from efficiency and heart-rate drift on long sessions.'));
      box.appendChild(h('div', { class: 'br-grid' }, r.sport_impact.map(function (x) { return sportCard(x, rv); })));
    }
    var top = A.topSessions(r.sessions, 6);
    box.appendChild(h('div', { class: 'form-section' }, 'Session breakdown'));
    box.appendChild(h('p', { class: 'muted small' }, 'Every session scored on the useful stimulus it gave: workload, purpose (intervals, threshold, long endurance), execution against your norm, race specificity and timing.'));
    box.appendChild(h('div', { class: 'coach-2' },
      h('div', null, h('b', null, '↗ Built the most fitness'), top.best.length ? top.best.map(function (x) { return sessCard(x, true, rv); }) : h('p', { class: 'muted small' }, 'No standout sessions found.')),
      h('div', null, h('b', null, '⊘ Did little or worked against you'), top.worst.length ? top.worst.map(function (x) { return sessCard(x, false, rv); }) : h('p', { class: 'muted small' }, 'No unhelpful sessions flagged. Every session had a clear purpose.'))));
  }
  var FAM_COL = { Improving: '#00a86b', Stable: '#2b4dff', Slipping: '#ff3b30', 'Not comparable': '#999999' };
  function famChange(f) {
    if (!fin(f.out_first) || !fin(f.out_last)) return '';
    return A.fmtOut(f.out_first, f.sport, f.unit) + ' → ' + A.fmtOut(f.out_last, f.sport, f.unit) + (fin(f.hr_first) && fin(f.hr_last) ? sp(' at %.0f → %.0f bpm', f.hr_first, f.hr_last) : '');
  }
  function sportCard(s, rv) {
    var vc = { Improved: '#00a86b', Maintained: '#2b4dff', Declined: '#ff3b30' }[s.verdict] || '#999';
    var mk = function (kind) {
      var x = (s.markers || []).filter(function (m) { return m.kind === kind; }); if (!x.length) return null;
      var ch = kind === 'Speed' ? s.speed_change : s.endurance_change;
      return h('div', null, h('div', { class: 'mk-h' }, h('span', null, kind), fin(ch) ? h('span', { style: 'color:' + (ch > 1.5 ? '#00a86b' : ch < -1.5 ? '#ff3b30' : '#666') }, sp('%+.1f%%', ch)) : null),
        x.map(function (m) { return h('div', { class: 'mk' }, h('span', null, m.label), h('span', { class: 'nowrap' }, h('b', null, m.early + ' → ' + m.late), h('span', { style: 'font-weight:700;color:' + (m.change > 1.5 ? '#00a86b' : m.change < -1.5 ? '#ff3b30' : '#666') }, sp(' %+.1f%%', m.change)))); }));
    };
    var fams = (s.families || []).filter(function (f) { return f.verdict !== 'Not comparable'; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
    return h('div', { class: 'br-tile', style: 'border-top-color:' + A.SPORT_COLOURS[s.sport], onclick: function () { TP.openPage({ kind: 'sport', reviewId: rv.id, sport: s.sport, title: s.sport + ' · ' + rv.name }); } },
      h('div', { class: 'panel-top' }, h('b', null, s.sport), h('span', { class: 'vword', style: 'color:' + vc }, s.verdict)),
      h('div', { class: 'muted small' }, sp('%d sessions · %.1f h · %.0f km · %.0f%% of training time', s.sessions, s.hours, s.km, s.share)),
      h('div', { class: 'mk' }, h('span', null, s.sport + ' fitness (CTL)'), h('b', null, sp('%.0f → %.0f', s.ctl0, s.ctl_peak))),
      s.markers ? [mk('Endurance'), mk('Speed'), h('div', { class: 'hint' }, s.emphasis + ' Compared: ' + s.compare + '.')] : h('div', { class: 'muted small' }, 'Not enough comparable sessions early and late in the block to measure a change.'),
      s.best && s.best.length ? h('div', { class: 'small', style: 'margin-top:6px' }, h('div', { class: 'lbl' }, 'Sessions that did most for your ' + s.sport.toLowerCase()), s.best.map(function (x) { return h('div', null, h('b', null, TP.fmt(x.date, '%d %b')), ' · ' + x.type + ' · ' + A.fmtDur(x.moving_s)); })) : null,
      fams.length ? h('div', { class: 'small', style: 'margin-top:6px' }, h('div', { class: 'lbl' }, 'Repeated sessions'), fams.map(function (f) {
        return h('div', { style: 'margin-bottom:3px' }, h('b', null, f.name), ' (' + f.n + '×) ', h('span', { style: 'font-weight:700;color:' + FAM_COL[f.verdict] }, f.verdict), h('div', { class: 'muted' }, famChange(f)));
      })) : null,
      h('div', { class: 'link-more', style: 'margin-top:8px' }, 'View ' + s.sport.toLowerCase() + ' details →'));
  }
  function sessCard(x, good, rv) {
    var why = good ? x.why_good : x.why_bad;
    return h('div', { class: 'sess-card', style: 'border-left-color:' + A.SPORT_COLOURS[x.discipline], onclick: function () { TP.activityView(x.parent_id || x.id, rv && rv.id); } },
      h('div', { class: 'panel-top' }, h('span', { class: 'small' }, h('b', null, TP.fmt(x.date, '%a %d %b')), ' · ' + x.name), h('span', { class: 'tchip', style: 'color:' + (TYPE_COL[x.type] || '#666') }, x.type)),
      h('div', { class: 'muted small' }, A.fmtDur(x.moving_s) + ' · ' + Math.round(x.tss) + ' TSS' + (x.swim_env ? ' · ' + x.swim_env : '')),
      why ? h('div', { class: 'small' }, why.charAt(0).toUpperCase() + why.slice(1) + '.') : null);
  }
  function recovery(box, r) {
    var rc = r.recovery;
    if (!rc) { box.appendChild(h('div', { class: 'empty' }, h('h3', null, 'No sleep or HRV data for this block'), h('p', null, 'Sync the block from Garmin to fetch nightly sleep, overnight HRV and resting heart rate.'))); return; }
    var rf = A.recoveryFindings(rc), col = function (ok, warn) { return ok ? '#00a86b' : warn ? '#d99a00' : '#ff3b30'; };
    var tile = function (v, l, s, c) { return h('div', { class: 'kpi', style: 'border-left-color:' + c }, h('div', { class: 'kpi-v', style: 'color:' + c }, v), h('div', { class: 'kpi-l' }, l), s ? h('div', { class: 'kpi-s' }, s) : null); };
    box.appendChild(h('p', { class: 'small' }, sp('Based on %d nights of Garmin sleep tracking during the block. Overnight HRV is the most sensitive sign of how well you’re absorbing training: it falls when stress outpaces recovery.', rc.nights)));
    box.appendChild(h('div', { class: 'kpis kpis-5' },
      tile(fin(rc.sleep_h) ? rc.sleep_h.toFixed(1) + ' h' : '–', 'Average sleep', fin(rc.short_nights) ? Math.round(rc.short_nights) + '% of nights under 7 h' : null, col(rc.sleep_h >= 8, rc.sleep_h >= 7)),
      tile(fin(rc.sleep_score) ? Math.round(rc.sleep_score) : '–', 'Sleep score', 'Garmin, out of 100', col(rc.sleep_score >= 80, rc.sleep_score >= 70)),
      tile(fin(rc.hrv) ? Math.round(rc.hrv) + ' ms' : '–', 'Overnight HRV', fin(rc.hrv_base) ? 'baseline ' + Math.round(rc.hrv_base) + ' ms' : null, col(rc.hrv_below_pct <= 15, rc.hrv_below_pct <= 30)),
      tile(fin(rc.hrv_below_pct) ? Math.round(rc.hrv_below_pct) + '%' : '–', 'Nights HRV low', 'below your normal range', col(rc.hrv_below_pct <= 15, rc.hrv_below_pct <= 30)),
      tile(fin(rc.rhr_drift) ? sp('%+.0f bpm', rc.rhr_drift) : '–', 'Resting HR change', fin(rc.rhr_first) ? sp('%.0f → %.0f bpm', rc.rhr_first, rc.rhr_last) : null, col(rc.rhr_drift < 2, rc.rhr_drift < 4))));
    var bands = [{ x0: TP.addDays(r.race_date, -14), x1: r.race_date, fill: '#fff6dd', label: 'final 2 weeks' }];
    box.appendChild(C.xy({ title: 'Daily training stress (TSS)', height: 130, x: { type: 'date', min: r.start, max: r.race_date }, y: { fmt: function (v) { return Math.round(v); }, zero: true, min: 0 },
      series: [{ name: 'TSS', col: '#9a9a9a', kind: 'bar', barW: 0.85, pts: r.load.map(function (d) { return [d.date, d.tss]; }), fmt: function (v) { return Math.round(v) + ' TSS'; } }], bands: bands }));
    var ch = CO.recoveryCharts(rc.daily, r.start, r.race_date, { bands: bands }); if (ch) box.appendChild(ch);
    box.appendChild(h('div', { class: 'coach-2', style: 'margin-top:12px' },
      h('div', null, h('div', { class: 'form-section' }, '✓ Recovering well'), CO.list(rf.good, 'good')),
      h('div', null, h('div', { class: 'form-section' }, '→ To improve'), CO.list(rf.change, 'watch'))));
  }
  function taper(box, r) {
    var tp = r.taper, rc = r.recovery, checks = [], loss = (1 - tp.ctl_race / Math.max(tp.ctl_peak, 1)) * 100, red = tp.reduction;
    checks.push(tp.tsb_race >= 5 && tp.tsb_race <= 25 ? ['good', 'Fatigue cleared', 'You started the race fresh: the fatigue from training had worn off.']
      : tp.tsb_race > 25 ? ['warn', 'Very fresh, maybe too fresh', 'Form this high usually means the taper was long enough to start losing fitness.']
      : tp.tsb_race >= -10 ? ['warn', 'Some fatigue still there', 'You started with a little fatigue left over. A slightly longer or lighter taper would have helped.']
      : ['bad', 'Still tired on race day', 'Training fatigue hadn’t cleared by race day, which usually costs time.']);
    checks[0].push(sp('%+.0f', tp.tsb_race), 'form (TSB), target +5 to +25');
    checks.push(!fin(red) ? ['ok', 'Training cut before the race', 'Not enough data to measure.', '–', '']
      : red >= 30 && red <= 60 ? ['good', 'Training cut by the right amount', sp('You trained %.0f%% less in the last 2 weeks than in the 3 weeks before: the sweet spot for shedding fatigue without losing fitness.', red), sp('-%.0f%%', red), 'target 40-60% less']
      : red > 60 ? ['warn', 'Cut back more than needed', sp('Training dropped %.0f%% in the last 2 weeks. Cutting this much can start to lose fitness.', red), sp('-%.0f%%', red), 'target 40-60% less']
      : red >= 0 ? ['warn', 'Not much of a taper', sp('Training only dropped %.0f%% in the last 2 weeks.', red), sp('-%.0f%%', red), 'target 40-60% less']
      : ['bad', 'No taper', sp('You actually trained %.0f%% more in the last 2 weeks than before.', -red), sp('+%.0f%%', -red), 'target 40-60% less']);
    checks.push(loss <= 5 ? ['good', 'Fitness kept', sp('Fitness on race day was within %.0f%% of its peak (%s).', Math.max(loss, 0), TP.fmt(tp.peak_date, '%d %b')), sp('%.0f / %.0f', tp.ctl_race, tp.ctl_peak), 'CTL race day / peak']
      : ['warn', 'Some fitness lost', sp('Fitness dropped %.0f%% from its peak on %s, a sign the taper was long or very light.', loss, TP.fmt(tp.peak_date, '%d %b')), sp('%.0f / %.0f', tp.ctl_race, tp.ctl_peak), 'CTL race day / peak']);
    checks.push(tp.z3_min >= 10 ? ['good', 'Sharpness kept', sp('%.0f minutes of hard efforts in the last 2 weeks kept your legs sharp.', tp.z3_min), sp('%.0f min', tp.z3_min), 'hard efforts in taper']
      : tp.z3_min >= 5 ? ['ok', 'A little sharpness work', 'A few short hard efforts. Slightly more race-pace work would have helped.', sp('%.0f min', tp.z3_min), 'hard efforts in taper']
      : ['warn', 'No sharpening', 'Almost no hard efforts in the taper. Short race-pace efforts stop you feeling flat on race day.', sp('%.0f min', tp.z3_min), 'hard efforts in taper']);
    if (rc && fin(rc.hrv_taper_change)) checks.push(rc.hrv_taper_change >= 3 ? ['good', 'Body recovered', sp('Overnight HRV rose %.0f%% in race week: your nervous system had recovered.', rc.hrv_taper_change), sp('%+.0f%%', rc.hrv_taper_change), 'HRV, race week vs build']
      : rc.hrv_taper_change >= -3 ? ['ok', 'Recovery steady', 'HRV held steady through the taper.', sp('%+.0f%%', rc.hrv_taper_change), 'HRV, race week vs build']
      : ['warn', 'Recovery incomplete', sp('HRV fell %.0f%% in race week, often caused by nerves, travel or poor sleep.', -rc.hrv_taper_change), sp('%+.0f%%', rc.hrv_taper_change), 'HRV, race week vs build']);
    if (rc && fin(rc.pre_race_sleep)) checks.push(rc.pre_race_sleep >= 7.5 ? ['good', 'Slept well before the race', 'Good sleep over the last 3 nights before the race.', rc.pre_race_sleep.toFixed(1) + ' h', 'avg, last 3 nights']
      : ['warn', 'Short on sleep before the race', 'Bank extra sleep earlier in race week, since the night before is often poor.', rc.pre_race_sleep.toFixed(1) + ' h', 'avg, last 3 nights']);
    var good = checks.filter(function (c) { return c[0] === 'good'; }).length, bad = checks.filter(function (c) { return c[0] === 'warn' || c[0] === 'bad'; }).length;
    box.appendChild(h('div', { class: 'br-head', style: 'text-align:left;font-size:1rem' }, !bad ? 'You arrived at the start line fresh, fit and sharp: a well-executed taper.'
      : good >= bad ? sp('Mostly well prepared: %d of %d readiness checks passed. See what to adjust below.', good, checks.length) : sp('The taper didn’t quite land: only %d of %d readiness checks passed.', good, checks.length)));
    var ST = { good: ['✓', '#00a86b'], ok: ['–', '#2b4dff'], warn: ['!', '#d99a00'], bad: ['✕', '#ff3b30'] };
    box.appendChild(h('div', null, checks.map(function (c) {
      var s = ST[c[0]];
      return h('div', { class: 'check-row' }, h('span', { class: 'sev', style: 'background:' + s[1] }, s[0]), h('div', { class: 'grow' }, h('b', null, c[1]), h('div', { class: 'small' }, c[2])),
        c[3] ? h('div', { class: 'right' }, h('div', { class: 'strong', style: 'color:' + s[1] }, c[3]), h('div', { class: 'hint' }, c[4])) : null);
    })));
    var from = TP.addDays(r.race_date, -42) > r.start ? TP.addDays(r.race_date, -42) : r.start;
    box.appendChild(CO.pmcChart(r.load.filter(function (d) { return d.date >= from; }), { bands: [{ x0: TP.addDays(r.race_date, -14), x1: r.race_date, fill: '#fff6dd', label: 'final 2 weeks' }], vlines: [{ x: r.race_date, col: '#111', label: 'race' }] }));
    box.appendChild(h('p', { class: 'hint' }, 'Blue = fitness (long-term load), pink = fatigue (last 7 days), bars = form (fitness minus fatigue; above zero is fresh). The shaded area is the final two weeks.'));
  }
  function raceTab(box, r) {
    if (!r.legs) { box.appendChild(h('p', { class: 'muted' }, r.upcoming ? 'The race hasn’t happened yet. Come back after race day and sync.' : 'No race activity found on race day. Edit this review to pick it, or sync the race.')); return; }
    var prof = r.prof_pre, rs = r.race_summary;
    var pct = function (x) { return !fin(x) ? null : Math.abs(x - 1) < 0.01 ? 'right on prediction' : sp('%.1f%% %s than predicted', Math.abs(x - 1) * 100, x > 1 ? 'faster' : 'slower'); };
    box.appendChild(h('div', { class: 'race-head' },
      h('div', null, h('div', { class: 'lbl' }, 'Finish time'), h('div', { class: 'big' }, A.fmtDur(rs.time_s)), rs.transition_s > 0 ? h('div', { class: 'muted small' }, 'including ' + A.fmtDur(rs.transition_s) + ' in transitions') : null),
      h('div', { class: 'right' }, fin(rs.display_ratio) || fin(rs.perf_ratio) ? h('div', { class: 'strong' }, 'Overall: ' + pct(fin(rs.display_ratio) ? rs.display_ratio : rs.perf_ratio) + (fin(rs.predicted_s) ? ' (predicted ' + A.fmtDur(rs.predicted_s) + ')' : '')) : null,
        fin(rs.goal_delta) ? h('div', { class: 'strong', style: 'color:' + (rs.goal_delta <= 0 ? '#00a86b' : '#d99a00') }, 'Goal ' + A.fmtDur(rs.goal_s) + ': ' + A.fmtDur(Math.abs(rs.goal_delta)) + (rs.goal_delta <= 0 ? ' under' : ' over')) : null)));
    var cards = h('div', { class: 'legs' }), tr = r.transitions || [];
    r.legs.forEach(function (l, k) {
      var a = l.act, e = l.exp, s = l.stream, t = fin(a.race_s) ? a.race_s : a.moving_s, col = A.SPORT_COLOURS[a.discipline] || '#585858';
      var pace = a.discipline === 'Bike' && fin(a.np) ? sp('%.0f W normalised · %.1f km/h', a.np, a.km / Math.max(t / 3600, 0.01)) : a.discipline === 'Bike' ? sp('%.1f km/h', a.km / Math.max(t / 3600, 0.01))
        : a.discipline === 'Run' ? A.fmtPace(t / Math.max(a.km, 0.01)) + ' /km' : a.discipline === 'Swim' && a.km > 0 ? A.fmtPace(t / (a.km * 10)) + ' /100 m' + (a.swim_env === 'Open water' ? ' · open water' : ' · pool') : '';
      var pacing = !s || !fin(s.split_pct) ? null : s.split_pct < -5 ? sp('Faded %.0f%% in the second half', -s.split_pct) : fin(s.fade_pct) && s.fade_pct < -3 ? sp('Even halves, faded %.0f%% in the last quarter', -s.fade_pct) : s.split_pct > 3 ? sp('Negative split: %.0f%% stronger in the second half', s.split_pct) : 'Evenly paced';
      var ratio = e ? (fin(e.display_ratio) ? e.display_ratio : e.ratio) : null;
      cards.appendChild(h('div', { class: 'leg', style: 'border-top-color:' + col },
        h('b', null, a.discipline), h('div', { class: 'big' }, A.fmtDur(t)), h('div', { class: 'muted small' }, sp('%.2f km · ', a.km) + pace),
        e ? h('div', { class: 'small strong', style: 'margin-top:6px;color:' + (ratio >= 0.99 ? '#00a86b' : ratio >= 0.95 ? '#d99a00' : '#ff3b30') }, pct(ratio) + (e.kind === 'time' ? ' (predicted ' + A.fmtDur(e.expected) + ')' : sp(' (expected %.0f W)', e.expected))) : null,
        pacing ? h('div', { class: 'small' }, pacing) : null,
        fin(a.avg_hr) ? h('div', { class: 'hint' }, sp('Avg HR %.0f (%.0f%% of threshold)', a.avg_hr, a.avg_hr / prof.lthr * 100)) : null,
        e ? h('div', { class: 'hint' }, 'Prediction: ' + e.basis + '.') : null));
      if (tr[k] && k < r.legs.length - 1) cards.appendChild(h('div', { class: 'tleg' }, '→', h('b', null, tr[k].label), A.fmtDur(tr[k].seconds)));
    });
    box.appendChild(cards);
    // Plain-language read-out per leg.
    var notes = [];
    r.legs.forEach(function (l) {
      var a = l.act, e = l.exp, s = l.stream; if (!e) return;
      if (a.discipline === 'Swim') {
        var ow = a.swim_env === 'Open water', gap = (1 / (prof.ow_factor || 0.96) - 1) * 100;
        notes.push(e.ratio >= 1.02 ? sp('Swim: %.0f%% faster than your %s training predicts: a strong swim.', (e.ratio - 1) * 100, ow ? 'open-water' : 'pool')
          : e.ratio >= 0.97 ? sp('Swim: close to what your %s training predicts (%+.1f%%).', ow ? 'open-water' : 'pool', (e.ratio - 1) * 100)
          : sp('Swim: %.0f%% slower than your %s training predicts. %s', (1 - e.ratio) * 100, ow ? 'open-water' : 'pool', ow ? 'Race starts, sighting and swimming straight are the usual gaps, so practise them in open water.' : 'Check race pacing and whether your CSS is set too fast.'));
        if (ow && gap >= 8) notes.push(sp('Your open-water swims run about %.0f%% slower than your pool swims (most swimmers lose 3-6%%). Regular open-water sessions with sighting practice are the cheapest time to gain in this leg.', gap));
      }
      if (a.discipline === 'Bike' && e.if_status) {
        var what = e.hr_based ? sp('heart rate averaged %.0f%% of threshold', a.avg_hr / prof.lthr * 100) : sp('intensity factor was %.2f', a.intensity);
        var bnd = e.hr_based ? sp('%.0f-%.0f%%', e.band[0] * 100, e.band[1] * 100) : sp('%.2f-%.2f', e.band[0], e.band[1]);
        notes.push(e.if_status === 'over' ? sp('Bike: %s, above the %s target. You rode too hard for this distance, and it usually shows up as a slower run.', what, bnd)
          : e.if_status === 'under' ? sp('Bike: %s, below the %s target. You had room to ride harder.', what, bnd) : sp('Bike: %s, inside the %s target for this distance. Well judged.', what, bnd));
      } else if (a.discipline === 'Bike') notes.push('Bike: ' + pct(fin(e.display_ratio) ? e.display_ratio : e.ratio) + '.');
      if (a.discipline === 'Run') {
        var msg = 'Run: ' + pct(fin(e.display_ratio) ? e.display_ratio : e.ratio), fade = s && s.split_pct < -5, drift = fin(a.decoupling) && a.decoupling >= 8;
        if (fade) msg += sp(', fading %.0f%% in the second half', -s.split_pct);
        if (drift) msg += sp(', with heart rate drifting %.0f%% relative to pace', a.decoupling);
        msg += '.';
        if (fade || drift) msg += r.legs.length > 1 ? ' A late run fade usually comes from bike pacing or fuelling, more than run fitness.' : ' Start more conservatively and check your fuelling plan.';
        notes.push(msg);
      }
    });
    if (notes.length) { box.appendChild(h('div', { class: 'form-section' }, 'What the race tells us')); box.appendChild(CO.list(notes, 'info')); }
    r.legs.forEach(function (l) {
      var e = l.exp; if (!e) return;
      if (fin(e.implied_thr_pace)) box.appendChild(h('div', { class: 'implied' }, h('b', null, 'This race implies a threshold pace of ' + A.fmtPace(e.implied_thr_pace) + ' /km'), ' (your training before the race suggested ' + A.fmtPace(prof.thr_pace_s_km) + ' /km). Update it on the Thresholds tab if it’s right.'));
      else if (fin(e.implied_ftp)) box.appendChild(h('div', { class: 'implied' }, h('b', null, sp('This race implies an FTP of %.0f W', e.implied_ftp)), sp(' (your training before the race suggested %d W). Update it on the Thresholds tab if it’s right.', prof.ftp)));
    });
    box.appendChild(h('div', { class: 'form-section' }, 'Pacing through each leg'));
    box.appendChild(h('p', { class: 'muted small' }, 'Your pace or power through the race (smoothed). Flat or rising is good; a line falling away to the right is a fade. Heart rate is shown underneath.'));
    r.legs.forEach(function (l) {
      var s = l.stream, a = l.act; if (!s || !s.series || !s.series.length) return;
      var isW = s.unit === 'W', disc = a.discipline, conv = function (v) { return isW ? v : disc === 'Run' ? (v > 1 ? 1000 / v : null) : disc === 'Swim' ? (v > 0.3 ? 100 / v : null) : v * 3.6; };
      var paceAxis = !isW && (disc === 'Run' || disc === 'Swim');
      box.appendChild(C.xy({ title: disc + (isW ? ' power (W)' : paceAxis ? ' pace' + (disc === 'Run' ? ' (/km)' : ' (/100 m)') + ', faster is higher' : ' speed (km/h)'), height: 150, x: { type: 'num', fmt: function (v) { return Math.round(v) + "'"; } },
        tipX: function (v) { return TP.fmtDuration(Math.round(v * 60)) + ' in'; },
        y: paceAxis ? { fmt: A.fmtPace, invert: true } : { fmt: function (v) { return Math.round(v); } },
        series: [{ name: isW ? 'Power' : paceAxis ? 'Pace' : 'Speed', col: A.SPORT_COLOURS[disc], width: 1.8, pts: s.series.map(function (p) { return [p[0], conv(p[1])]; }), fmt: paceAxis ? A.fmtPace : function (v) { return isW ? Math.round(v) + ' W' : v.toFixed(1) + ' km/h'; } }] }));
      if (s.series.some(function (p) { return fin(p[2]); })) box.appendChild(C.xy({ height: 100, x: { type: 'num', fmt: function (v) { return Math.round(v) + "'"; } }, tipX: function (v) { return TP.fmtDuration(Math.round(v * 60)) + ' in'; },
        y: { fmt: function (v) { return Math.round(v); } }, series: [{ name: 'Heart rate (bpm)', col: '#d6336c', width: 1.4, pts: s.series.map(function (p) { return [p[0], p[2]]; }) }] }));
    });
  }

  // --- One sport within a block review (as the R app's sport page) ---
  TP.pages.sport = function (root, p) {
    var rv = B.list().filter(function (x) { return x.id === p.reviewId; })[0], r = rv && B.result(rv);
    var s = r && !r.empty && r.sport_impact.filter(function (x) { return x.sport === p.sport; })[0];
    if (!s) { root.appendChild(h('p', { class: 'muted' }, 'This review isn’t available any more.')); return; }
    var col = A.SPORT_COLOURS[s.sport], vc = { Improved: '#00a86b', Maintained: '#2b4dff', Declined: '#ff3b30' }[s.verdict] || '#999';
    root.appendChild(h('div', { class: 'act-head', style: '--c:' + col },
      h('div', null, h('div', { class: 'rp-type', style: 'color:' + col }, 'How your ' + s.sport.toLowerCase() + ' responded · ' + rv.name), h('h2', null, s.sport)),
      h('div', { class: 'btn-row', style: 'align-items:center' }, h('span', { class: 'vword big-t', style: 'color:' + vc }, s.verdict), TP.glossaryButton())));
    root.appendChild(h('div', { class: 'kpis kpis-5' }, kpi(s.sessions, 'Sessions'), kpi(s.hours.toFixed(1) + ' h', 'Time'),
      kpi(s.sport === 'Swim' ? s.km.toFixed(1) + ' km' : Math.round(s.km) + ' km', 'Distance'), kpi(Math.round(s.share) + '%', 'Of all training'),
      kpi(sp('%.0f → %.0f', s.ctl0, s.ctl_peak), s.sport + ' fitness', 'start → peak')));
    if (s.markers) {
      var mk = h('div', { class: 'panel' });
      ['Endurance', 'Speed'].forEach(function (kind) {
        var x = s.markers.filter(function (m) { return m.kind === kind; }); if (!x.length) return;
        var ch = kind === 'Speed' ? s.speed_change : s.endurance_change;
        mk.appendChild(h('div', { class: 'mk-h' }, h('span', null, kind), fin(ch) ? h('span', { style: 'color:' + (ch > 1.5 ? '#00a86b' : ch < -1.5 ? '#ff3b30' : '#666') }, sp('%+.1f%%', ch)) : null));
        x.forEach(function (m) { mk.appendChild(h('div', { class: 'mk' }, h('span', null, m.label), h('span', { class: 'nowrap' }, h('b', null, m.early + ' → ' + m.late), h('span', { style: 'font-weight:700;color:' + (m.change > 1.5 ? '#00a86b' : m.change < -1.5 ? '#ff3b30' : '#666') }, sp(' %+.1f%%', m.change))))); });
      });
      mk.appendChild(h('div', { class: 'hint' }, s.emphasis + ' Compared: ' + s.compare + '.'));
      root.appendChild(mk);
    } else root.appendChild(h('p', { class: 'muted small' }, 'Not enough comparable sessions early and late in the block to measure a change.'));
    // Weekly volume, and this sport's fitness: two charts, one scale each.
    var acts = r.train.acts.filter(function (a) { return a.discipline === s.sport; }), metric = 'hours', box = h('div');
    var ctx = TP.garmin.ctx(), sl = A.loadModel(ctx.scored.filter(function (a) { return a.discipline === s.sport; }), r.start, TP.addDays(r.race_date, -1) < TP.today() ? TP.addDays(r.race_date, -1) : TP.today());
    function draw() {
      TP.clear(box);
      var wk = {}; acts.forEach(function (a) { wk[a.week] = (wk[a.week] || 0) + (metric === 'hours' ? a.hours : a.km); });
      box.appendChild(TP.chart.xy({ title: 'Weekly ' + s.sport.toLowerCase() + ' ' + (metric === 'hours' ? 'time (hours)' : 'distance (km)'), height: 170, x: { type: 'date' },
        tipX: function (v) { return 'Week of ' + TP.fmt(TP.weekStart(TP.chart.dstr(v)), '%d %b'); }, y: { fmt: function (v) { return v.toFixed(metric === 'hours' && v < 10 ? 1 : 0); }, zero: true, min: 0 },
        series: [{ name: metric === 'hours' ? 'Hours' : 'Distance', col: col, kind: 'bar', barW: 5, pts: Object.keys(wk).sort().map(function (k) { return [TP.addDays(k, 3), wk[k]]; }),
          fmt: function (v) { return metric === 'hours' ? v.toFixed(1) + ' h' : v.toFixed(1) + ' km'; } }] }));
      box.appendChild(TP.chart.xy({ title: s.sport + ' fitness (CTL from ' + s.sport.toLowerCase() + ' sessions only)', height: 150, x: { type: 'date' }, y: { fmt: function (v) { return Math.round(v); }, zero: true },
        series: [{ name: s.sport + ' fitness', col: '#2b4dff', pts: sl.map(function (d) { return [d.date, d.ctl]; }), width: 2, fmt: function (v) { return Math.round(v); } }] }));
    }
    var pv = h('div', { class: 'panel' }, h('div', { class: 'panel-top' }, h('div', { class: 'panel-h' }, 'Volume and fitness'),
      TP.chips([{ value: 'hours', label: 'Hours' }, { value: 'km', label: 'Distance' }], metric, function (v) { metric = v; draw(); }, 'seg')), box);
    root.appendChild(pv); draw();
    // Repeated sessions
    var fams = (s.families || []).filter(function (f) { return f.verdict !== 'Not comparable'; }).sort(function (a, b) { return b.n - a.n; });
    root.appendChild(h('h3', { class: 'sec-h' }, 'Repeated sessions'));
    root.appendChild(h('p', { class: 'muted small sec-sub' }, 'Sessions with the same structure grouped together. If the same workout gets faster, or the same pace costs fewer heartbeats, that sport is improving. Click any session to open it.'));
    if (!fams.length) root.appendChild(h('p', { class: 'muted small' }, 'No repeated sessions found for this sport in the block.'));
    fams.forEach(function (f) {
      var base = f.sessions[0].eff;
      root.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-top' }, h('span', null, h('b', null, f.name), h('span', { class: 'muted small' }, ' · ' + f.n + ' sessions')), h('span', { class: 'vword', style: 'color:' + FAM_COL[f.verdict] }, f.verdict)),
        h('div', { class: 'small' }, famChange(f) + (fin(f.eff_change) ? sp(' · efficiency %+.1f%%', f.eff_change) : '')),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Session'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, f.interval ? 'Rep pace / power' : 'Pace / power'), h('th', { class: 'num' }, 'Avg HR'), h('th', { class: 'num' }, 'Efficiency vs first'))),
          h('tbody', null, f.sessions.map(function (m, k) {
            var d = fin(m.eff) && fin(base) ? (m.eff / base - 1) * 100 : null;
            return h('tr', { class: 'click', onclick: function () { TP.activityView(m.parent_id || m.id, rv.id); } }, h('td', { class: 'nowrap' }, TP.fmt(m.date, '%a %d %b')), h('td', null, m.name), h('td', { class: 'num' }, A.fmtDur(m.moving_s)),
              h('td', { class: 'num' }, h('b', null, A.fmtOut(m.out, f.sport, f.unit))), h('td', { class: 'num' }, fin(m.hr) ? Math.round(m.hr) : '–'),
              h('td', { class: 'num' }, k === 0 || !fin(d) ? '–' : h('span', { style: 'font-weight:700;color:' + (d > 1 ? '#00a86b' : d < -1 ? '#ff3b30' : '#666') }, sp('%+.1f%%', d))));
          }))))));
    });
    // Every session, sortable.
    var sb = (r.sessions || []).filter(function (x) { return x.discipline === s.sport; }), sortK = 'date', asc = false, tb = h('tbody');
    root.appendChild(h('h3', { class: 'sec-h' }, 'Every ' + s.sport.toLowerCase() + ' session'));
    root.appendChild(h('p', { class: 'muted small sec-sub' }, 'Newest first. Click a column heading to sort by it (click again to reverse); click a session to open it.'));
    var cols = [['date', 'Date'], ['name', 'Session'], ['type', 'Type'], ['structure', 'Structure'], ['km', 'Distance', 1], ['moving_s', 'Time', 1], ['tss', 'TSS', 1]];
    var structOf = function (x) { return ((ctx.feats[x.id] || {}).structure || {}).label || '–'; };
    function fill() {
      TP.clear(tb);
      sb.slice().sort(function (a, b) {
        var va = sortK === 'structure' ? structOf(a) : a[sortK], vb = sortK === 'structure' ? structOf(b) : b[sortK];
        return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
      }).forEach(function (x) {
        tb.appendChild(h('tr', { class: 'click', onclick: function () { TP.activityView(x.parent_id || x.id, rv.id); } }, h('td', { class: 'nowrap' }, TP.fmt(x.date, '%a %d %b')), h('td', null, x.name),
          h('td', null, h('span', { class: 'tchip', style: 'color:' + (TYPE_COL[x.type] || '#666') }, x.type)), h('td', { class: 'small' }, structOf(x)),
          h('td', { class: 'num' }, x.km > 0 ? (s.sport === 'Swim' ? Math.round(x.km * 1000) + ' m' : x.km.toFixed(2) + ' km') : '–'), h('td', { class: 'num' }, A.fmtDur(x.moving_s)), h('td', { class: 'num' }, Math.round(x.tss))));
      });
    }
    var head = h('tr', null, cols.map(function (c) {
      return h('th', { class: (c[2] ? 'num ' : '') + 'sortable', onclick: function () { if (sortK === c[0]) asc = !asc; else { sortK = c[0]; asc = c[0] === 'name' || c[0] === 'type' || c[0] === 'structure'; } fill(); } }, c[1]);
    }));
    root.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, head), tb)));
    fill();
  };

  // History of finished blocks, for the planning advice.
  B.history = function (excludeCal) {
    var seen = {}, rows = [], changes = [], latest = null;
    B.list().forEach(function (rv) {
      if (excludeCal && rv.calendar_id === excludeCal) return;
      var r = B.result(rv); if (r.empty || r.upcoming) return;
      var k = rv.race_date + rv.sport; if (seen[k]) return; seen[k] = 1;
      try { rows.push(A.historyRow(r)); } catch (e) { return; }
      if (!latest || rv.race_date > latest) { latest = rv.race_date; changes = r.findings.change; }
    });
    return { rows: rows, changes: changes };
  };
})(window.TP);
