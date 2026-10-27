// Planned sessions <-> Garmin activities.
// An activity of the same sport on the day of a planned session completes it automatically. One done on
// another day of the same week is offered as a suggestion ("was this your planned session?"), and any
// session can be linked or unlinked by hand. The choices belong to the signed-in person (each person in
// a shared plan ticks off their own training) and are saved with their account, or on this device
// when accounts aren't set up.
(function (TP) {
  var h = TP.h;

  // --- This person's own saved data: users/{uid}/garmin/{name} in the cloud, else this device ---
  var Mi = TP.mine = { docs: {}, subs: {} };
  function cloudOn() { return TP.cloud && TP.cloud.enabled && TP.cloud.user; }
  Mi.reset = function () { Object.keys(Mi.subs).forEach(function (k) { Mi.subs[k](); }); Mi.subs = {}; Mi.docs = {}; };
  Mi.get = function (name) {
    if (Mi.docs[name]) return Mi.docs[name];
    if (cloudOn()) {
      Mi.docs[name] = {};
      if (!Mi.subs[name]) Mi.subs[name] = TP.cloud.listenMine(name, function (d) { Mi.docs[name] = d || {}; if (TP.garmin) TP.garmin.ver++; TP.changed(); });
    } else {
      try { Mi.docs[name] = JSON.parse(localStorage.getItem('tp-mine-' + name) || '{}'); } catch (e) { Mi.docs[name] = {}; }
    }
    return Mi.docs[name];
  };
  Mi.set = function (name, data) {
    Mi.docs[name] = data; if (TP.garmin) TP.garmin.ver++;
    if (cloudOn()) TP.cloud.saveMine(name, data);
    else try { localStorage.setItem('tp-mine-' + name, JSON.stringify(data)); } catch (e) {}
    TP.changed();
  };

  var M = TP.match = {};
  function linksName() { return 'links-' + (TP.cloud && TP.cloud.enabled && TP.cloud.activeId ? TP.cloud.activeId : 'device'); }
  // { pairs: {sessionId: activityId}, rejected: {'sessionId|activityId': 1} }
  function store() { var d = Mi.get(linksName()); return { pairs: Object.assign({}, d.pairs || {}), rejected: Object.assign({}, d.rejected || {}) }; }
  function save(s) { Mi.set(linksName(), s); }

  // Can this activity be the planned session? Hyrox can be logged as a run or a fitness activity; gym as strength.
  function fits(s, a) {
    var sp = TP.sportOf(s.discipline), k = String(a.type || '').toLowerCase();
    if (a.multisport) return sp !== 'Gym';
    if (sp === 'Gym') return a.sport === 'Gym' || /strength|fitness|training/.test(k);
    if (sp === 'Hyrox') return a.sport === 'Hyrox' || (a.sport === 'Run' && !/^running$|trail/.test(k)) || /hiit|hyrox|row|ski/.test(k);
    if (s.plan_by === 'Brick') return a.sport === 'Bike' || a.sport === 'Run';
    return a.sport === sp;
  }
  M.fits = fits;
  function km(a) { return (a.distance_m || 0) / 1000; }
  // The planned amount and what was done, for the completion status.
  function plannedAmount(s) {
    var sp = TP.sportOf(s.discipline);
    if (sp === 'Gym' || sp === 'Hyrox' || (s.plan_by === 'Time' && s.duration_min > 0) || !(s.total_dist > 0)) return s.duration_min > 0 ? { min: s.duration_min } : null;
    return { km: s.total_dist };
  }

  // Work out every link once per change of activities, sessions or saved choices.
  var cache = null;
  M.compute = function () {
    var G = TP.garmin, st = store(), key = (G ? G.ver + ':' + G.acts.length : '') + '|' + TP.state.sessions.length + '|' + JSON.stringify(st) + '|' + linksName() + '|' + TP.today();
    var sessKey = TP.state.sessions.map(function (s) { return s.id + s.date + s.discipline + s.total_dist + s.duration_min; }).join(',');
    key += '|' + sessKey;
    if (cache && cache.key === key) return cache;
    var today = TP.today(), acts = G ? G.acts.filter(function (a) { return a.date && a.date <= today; }) : [], byId = {};
    acts.forEach(function (a) { byId[a.id] = a; });
    var sess = TP.state.sessions.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var bySession = {}, byAct = {}, used = {};
    // 1. Links the person confirmed or made.
    Object.keys(st.pairs).forEach(function (sid) {
      var a = byId[st.pairs[sid]]; if (!a || used[a.id]) return;
      if (!sess.some(function (s) { return s.id === sid; })) return;
      bySession[sid] = { act: a, how: 'confirmed' }; byAct[a.id] = sid; used[a.id] = 1;
    });
    // 2. Same day, same sport: automatic.
    var actsByDate = {}; acts.forEach(function (a) { (actsByDate[a.date] = actsByDate[a.date] || []).push(a); });
    sess.forEach(function (s) {
      if (bySession[s.id] || s.date > today) return;
      var cand = (actsByDate[s.date] || []).filter(function (a) { return !used[a.id] && fits(s, a) && !st.rejected[s.id + '|' + a.id]; });
      if (!cand.length) return;
      var pick = s.total_dist > 0 && cand.some(function (a) { return a.distance_m > 0; })
        ? cand.reduce(function (b, a) { return Math.abs(km(a) - s.total_dist) < Math.abs(km(b) - s.total_dist) ? a : b; })
        : cand.reduce(function (b, a) { return (a.moving_s || 0) > (b.moving_s || 0) ? a : b; });
      bySession[s.id] = { act: pick, how: 'auto' }; byAct[pick.id] = s.id; used[pick.id] = 1;
    });
    // 3. Another day of the same week: ask.
    var sugg = [], suggS = {};
    acts.forEach(function (a) {
      if (used[a.id]) return;
      var wk = TP.weekStart(a.date), we = TP.addDays(wk, 6);
      var cand = sess.filter(function (s) { return !bySession[s.id] && !suggS[s.id] && s.date >= wk && s.date <= we && s.date !== a.date && fits(s, a) && !st.rejected[s.id + '|' + a.id]; });
      if (!cand.length) return;
      var pick = cand.sort(function (x, y) {
        var dx = Math.abs(TP.daysBetween(x.date, a.date)), dy = Math.abs(TP.daysBetween(y.date, a.date));
        if (dx !== dy) return dx - dy;
        return Math.abs((x.total_dist || 0) - km(a)) - Math.abs((y.total_dist || 0) - km(a));
      })[0];
      suggS[pick.id] = 1; sugg.push({ sid: pick.id, aid: a.id });
    });
    cache = { key: key, bySession: bySession, byAct: byAct, suggestions: sugg, byId: byId };
    return cache;
  };

  M.linkFor = function (sid) { return M.compute().bySession[sid] || null; };
  M.sessionForAct = function (aid) { return M.compute().byAct[aid] || null; };
  // Activities that day not linked to a planned session (shown on the calendar in their own right).
  M.extraOn = function (d) {
    var c = M.compute(); if (!TP.garmin) return [];
    return TP.garmin.acts.filter(function (a) { return a.date === d && !c.byAct[a.id]; });
  };
  // 'done' | 'partial' | 'missed' | 'pending' (today, not done yet) | null (future, or no Garmin data for that date)
  M.status = function (s) {
    var G = TP.garmin; if (!G || !G.loaded || !G.acts.length) return null;
    var l = M.linkFor(s.id);
    if (l) {
      var p = plannedAmount(s), a = l.act, ratio = null;
      if (p && p.km && a.distance_m > 0) ratio = km(a) / p.km;
      else if (p && p.min && a.moving_s) ratio = a.moving_s / 60 / p.min;
      else if (p && p.km && !(a.distance_m > 0) && a.moving_s) ratio = (a.moving_s / 3600) / Math.max(TP.estHours(s), 0.01);
      return { st: ratio !== null && ratio < 0.8 ? 'partial' : 'done', ratio: ratio, act: a, how: l.how };
    }
    var today = TP.today();
    if (s.date > today) return null;
    if (s.date === today) return { st: 'pending' };
    if (!G.covered(s.date)) return null;
    return { st: 'missed' };
  };
  M.STATUS_LABEL = { done: 'Completed', partial: 'Partly completed', missed: 'Missed', pending: 'Not done yet' };
  M.STATUS_ICON = { done: '✓', partial: '◐', missed: '✕' };

  // Plan compliance for the analysis: planned sessions in the period that were due, and what was done.
  M.compliance = function (from, to, blockId) {
    var today = TP.today(), end = to < today ? to : TP.addDays(today, -1);
    var pl = TP.state.sessions.filter(function (s) { return s.date >= from && s.date <= end && (!blockId || s.block_id === blockId); });
    if (!pl.length) return null;
    var disc = function (s) { var sp = TP.sportOf(s.discipline); return sp === 'Gym' || sp === 'Hyrox' ? 'Other' : sp; };
    var rows = pl.map(function (s) { var l = M.linkFor(s.id); return { s: s, disc: disc(s), done: !!l, km: l ? km(l.act) : 0 }; });
    var g = {}; rows.forEach(function (r) { var x = g[r.disc] = g[r.disc] || { disc: r.disc, planned: 0, done: 0, planned_km: 0, actual_km: 0 }; x.planned++; if (r.done) x.done++; x.planned_km += r.s.total_dist || 0; x.actual_km += r.km; });
    var pk = rows.reduce(function (t, r) { return t + (r.s.total_dist || 0); }, 0), ak = rows.reduce(function (t, r) { return t + (r.s.total_dist > 0 ? r.km : 0); }, 0);
    return { planned: rows.length, done: rows.filter(function (r) { return r.done; }).length, completion: rows.filter(function (r) { return r.done; }).length / rows.length * 100,
      volume: pk > 0 ? ak / pk * 100 : 100, by_disc: Object.keys(g).map(function (k) { return g[k]; }), sessions: rows };
  };
  // For the analysis: { sessions: {sid: actId}, acts: {actId: sid} }.
  M.linkMaps = function () { var c = M.compute(), s = {}; Object.keys(c.bySession).forEach(function (k) { s[k] = c.bySession[k].act.id; }); return { sessions: s, acts: c.byAct }; };

  // --- Changing links ---
  M.link = function (sid, aid) {
    var st = store();
    Object.keys(st.pairs).forEach(function (k) { if (st.pairs[k] === aid) delete st.pairs[k]; });
    st.pairs[sid] = aid; delete st.rejected[sid + '|' + aid];
    save(st);
  };
  M.unlink = function (sid) {
    var st = store(), l = M.linkFor(sid);
    delete st.pairs[sid];
    if (l) st.rejected[sid + '|' + l.act.id] = 1;   // so the same-day match doesn't come straight back
    save(st);
  };
  M.reject = function (sid, aid) { var st = store(); st.rejected[sid + '|' + aid] = 1; save(st); };

  // --- Same-week suggestions: "Was this your planned session?" ---
  var asked = {}, timer = null;
  M.askSoon = function () { clearTimeout(timer); timer = setTimeout(M.ask, 400); };
  M.ask = function (force) {
    // Not over another pop-up, and only once a plan is open (not on the sign-in screens).
    if (document.body.classList.contains('md-open') || (TP.cloud && TP.cloud.enabled && !TP.cloud.isActive())) return;
    var sugg = M.compute().suggestions.filter(function (x) { return force || !asked[x.sid + '|' + x.aid]; });
    if (!sugg.length) return;
    sugg.forEach(function (x) { asked[x.sid + '|' + x.aid] = 1; });
    var byId = M.compute().byId, rows = h('div', { class: 'sugg-list' });
    var m = TP.modal({ size: 'm', title: h('div', null, h('div', { class: 'md-t' }, 'Was this your planned session?'),
      h('div', { class: 'md-sub' }, sugg.length === 1 ? 'A Garmin activity was done on a different day from the session planned that week.' : sugg.length + ' Garmin activities were done on a different day from sessions planned that week.')),
      body: rows, footer: h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Decide later') });
    function draw() {
      TP.clear(rows);
      var left = sugg.filter(function (x) { return !x.done; });
      if (!left.length) { m.close(); return; }
      left.forEach(function (x) {
        var s = TP.state.sessions.filter(function (y) { return y.id === x.sid; })[0], a = byId[x.aid]; if (!s || !a) { x.done = true; return; }
        rows.appendChild(h('div', { class: 'sugg' },
          h('div', { class: 'sugg-pair' },
            h('div', { class: 'sugg-side' }, h('div', { class: 'lbl' }, 'Garmin activity'), h('b', null, a.name || a.type), h('div', { class: 'muted small' }, TP.fmt(a.date, '%A %d %b') + ' · ' + actAmount(a))),
            h('div', { class: 'sugg-arrow' }, '→'),
            h('div', { class: 'sugg-side' }, h('div', { class: 'lbl' }, 'Planned session'), h('b', null, h('span', { class: 'sdot', style: 'background:' + TP.typeCol(s.type) }), TP.sportLabel(s.discipline) + ' · ' + s.type),
              h('div', { class: 'muted small' }, TP.fmt(s.date, '%A %d %b') + (TP.planAmount(s) ? ' · ' + TP.planAmount(s) : '')))),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-sm', onclick: function () { x.done = true; M.reject(x.sid, x.aid); draw(); } }, 'No, it wasn’t'),
            h('button', { class: 'btn btn-sm btn-primary', onclick: function () { x.done = true; M.link(x.sid, x.aid); draw(); } }, '✓ Yes, link them'))));
      });
    }
    draw();
  };
  function actAmount(a) {
    var bits = [];
    if (a.distance_m > 50) bits.push(TP.round(a.distance_m / 1000, a.sport === 'Swim' ? 2 : 1) + ' km');
    if (a.moving_s) bits.push(TP.fmtDuration(a.moving_s));
    return bits.join(' · ');
  }
  M.actAmount = actAmount;

  // Pick a Garmin activity for a planned session (from that week and the weeks either side).
  M.pickActivity = function (sid) {
    var s = TP.state.sessions.filter(function (x) { return x.id === sid; })[0]; if (!s || !TP.garmin) return;
    var c = M.compute(), wk = TP.weekStart(s.date), from = TP.addDays(wk, -7), to = TP.addDays(wk, 13);
    var list = TP.garmin.acts.filter(function (a) { return a.date >= from && a.date <= to; })
      .sort(function (a, b) { return (fits(s, b) - fits(s, a)) || Math.abs(TP.daysBetween(a.date, s.date)) - Math.abs(TP.daysBetween(b.date, s.date)); });
    var m = TP.modal({ size: 'm', stack: true, title: h('div', null, h('div', { class: 'md-t' }, 'Link a Garmin activity'),
      h('div', { class: 'md-sub' }, TP.sportLabel(s.discipline) + ' · ' + s.type + ' planned for ' + TP.fmt(s.date, '%A %d %b'))),
      body: list.length ? h('div', { class: 'pick-list' }, list.map(function (a) {
        var other = c.byAct[a.id] && c.byAct[a.id] !== sid ? TP.state.sessions.filter(function (x) { return x.id === c.byAct[a.id]; })[0] : null;
        return h('button', { class: 'list-item' + (fits(s, a) ? '' : ' dim'), onclick: function () { m.close(); M.link(sid, a.id); TP.toast('Linked to ' + (a.name || a.type) + '.'); } },
          h('span', { class: 'dot', style: 'background:' + (TP.SPORT_COLOURS[a.sport] || '#a0a0a0') }),
          h('span', { class: 'grow' }, h('b', null, a.name || a.type), h('div', { class: 'muted small' }, TP.fmt(a.date, '%a %d %b') + ' · ' + actAmount(a) + (other ? ' · now linked to ' + TP.sportLabel(other.discipline) + ' ' + other.type + ' (' + TP.fmt(other.date, '%a') + ')' : ''))),
          TP.fmt(a.date, '%d %b') === TP.fmt(s.date, '%d %b') ? h('span', { class: 'tag' }, 'same day') : null);
      })) : h('p', { class: 'muted' }, 'No Garmin activities from ' + TP.fmt(from, '%d %b') + ' to ' + TP.fmt(to, '%d %b') + '. Sync that period on the Analysis page first.'),
      footer: h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel') });
  };
  // Pick a planned session for a Garmin activity.
  M.pickSession = function (aid) {
    var a = (TP.garmin.acts.filter(function (x) { return x.id === aid; }))[0]; if (!a) return;
    var c = M.compute(), wk = TP.weekStart(a.date), from = TP.addDays(wk, -7), to = TP.addDays(wk, 13);
    var list = TP.state.sessions.filter(function (s) { return s.date >= from && s.date <= to; })
      .sort(function (x, y) { return (fits(y, a) - fits(x, a)) || Math.abs(TP.daysBetween(x.date, a.date)) - Math.abs(TP.daysBetween(y.date, a.date)); });
    var m = TP.modal({ size: 'm', stack: true, title: h('div', null, h('div', { class: 'md-t' }, 'Link to a planned session'), h('div', { class: 'md-sub' }, (a.name || a.type) + ' · ' + TP.fmt(a.date, '%A %d %b'))),
      body: list.length ? h('div', { class: 'pick-list' }, list.map(function (s) {
        var l = c.bySession[s.id];
        return h('button', { class: 'list-item' + (fits(s, a) ? '' : ' dim'), onclick: function () { m.close(); M.link(s.id, aid); TP.toast('Linked.'); } },
          h('span', { class: 'dot', style: 'background:' + TP.typeCol(s.type) }),
          h('span', { class: 'grow' }, h('b', null, TP.sportLabel(s.discipline) + ' · ' + s.type), h('div', { class: 'muted small' }, TP.fmt(s.date, '%a %d %b') + (TP.planAmount(s) ? ' · ' + TP.planAmount(s) : '') + (l && l.act.id !== aid ? ' · already linked to ' + (l.act.name || 'another activity') : ''))));
      })) : h('p', { class: 'muted' }, 'No sessions planned around then.'),
      footer: h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel') });
  };

  // The Garmin part of a planned session's pop-up.
  M.sessionPanel = function (s, closeParent) {
    var G = TP.garmin; if (!G || !G.loaded || !G.acts.length) return null;
    var st = M.status(s), l = M.linkFor(s.id);
    var chip = st ? h('span', { class: 'st-chip st-' + st.st }, (M.STATUS_ICON[st.st] ? M.STATUS_ICON[st.st] + ' ' : '') + M.STATUS_LABEL[st.st] + (st.ratio && st.st !== 'done' ? ' (' + Math.round(st.ratio * 100) + '%)' : '')) : null;
    if (l) {
      var a = l.act, sc = G.scoredFor(a.id), tss = sc.reduce(function (t, x) { return t + (x.tss || 0); }, 0);
      return h('div', { class: 'panel g-link' },
        h('div', { class: 'panel-top' }, h('div', { class: 'panel-h' }, 'Done on Garmin'), chip),
        h('button', { class: 'list-item', onclick: function () { TP.activityView(a.id); } },
          h('span', { class: 'dot', style: 'background:' + (TP.SPORT_COLOURS[a.sport] || '#a0a0a0') }),
          h('span', { class: 'grow' }, h('b', null, a.name || a.type), h('div', { class: 'muted small' }, TP.fmt(a.date, '%a %d %b') + ' · ' + actAmount(a) + (a.avg_hr ? ' · avg HR ' + Math.round(a.avg_hr) : '') + (sc.length ? ' · ' + Math.round(tss) + ' TSS' : ''))),
          h('span', { class: 'link-more' }, 'View →')),
        st && st.ratio ? h('div', { class: 'hint' }, 'Done: ' + Math.round(st.ratio * 100) + '% of the planned ' + (plannedAmount(s) && plannedAmount(s).km ? 'distance' : 'time') + '. Under 80% counts as partly completed.') : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm', onclick: function () { M.pickActivity(s.id); } }, 'Change activity'),
          h('button', { class: 'btn btn-sm', onclick: function () { M.unlink(s.id); TP.toast('Unlinked.'); if (closeParent) closeParent(); } }, 'Unlink')),
        l.how === 'auto' ? h('div', { class: 'hint' }, 'Linked automatically: same day, same sport.') : null);
    }
    var sugg = M.compute().suggestions.filter(function (x) { return x.sid === s.id; })[0];
    return h('div', { class: 'panel g-link' },
      h('div', { class: 'panel-top' }, h('div', { class: 'panel-h' }, 'Garmin'), chip),
      st && st.st === 'missed' ? h('p', { class: 'small' }, 'No Garmin activity matched this session. If you did it on another day or logged it as a different sport, link it here.') :
        h('p', { class: 'small muted' }, s.date > TP.today() ? 'Once you’ve done it and synced, the activity is linked automatically.' : 'No activity linked yet.'),
      sugg ? h('div', { class: 'hint' }, 'Possible match: ' + (M.compute().byId[sugg.aid].name || 'an activity') + ' on ' + TP.fmt(M.compute().byId[sugg.aid].date, '%a %d %b') + '.') : null,
      s.date <= TP.addDays(TP.today(), 0) ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', onclick: function () { M.pickActivity(s.id); } }, TP.icon('activity'), 'Link a Garmin activity')) : null);
  };
})(window.TP);
