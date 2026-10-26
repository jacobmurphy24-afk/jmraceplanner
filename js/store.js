// The plan: events (races / training-only blocks), sessions, templates and preferences.
// Saved in this browser's storage on every change; Save plan / Load plan move it between devices.
(function (TP) {
  var KEY = 'tp-planner-v1';
  var listeners = [];

  TP.state = { events: {}, sessions: [], templates: {}, prefs: { units: 'metric', rpAxis: 'Time' } };

  // The plan kept on this device (used when signed out, or when "This device" is the open plan).
  TP.load = function () {
    try {
      var raw = localStorage.getItem(KEY);
      TP.state = raw ? normalise(JSON.parse(raw)) : normalise({ prefs: TP.state.prefs });
    } catch (e) { console.warn('Could not read saved plan', e); }
  };
  // A plan saved on this device before accounts (offered once, at first sign-in, to copy into the account).
  TP.clearLocalPlan = function () { var l = TP.localPlan(); localStorage.setItem(KEY, JSON.stringify(normalise({ prefs: l.prefs }))); };
  TP.localPlan = function () { try { return normalise(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return normalise({}); } };
  // Every change goes through here. With accounts on, the open plan is written to the cloud and only
  // preferences (units, chart axis) are kept on this device; without them, the whole plan is.
  TP.save = function () {
    try {
      if (TP.cloud && TP.cloud.enabled) {
        if (TP.cloud.isActive()) TP.cloud.push();
        var local = TP.localPlan(); local.prefs = TP.state.prefs;
        localStorage.setItem(KEY, JSON.stringify(local));
      } else localStorage.setItem(KEY, JSON.stringify(TP.state));
    } catch (e) { TP.toast && TP.toast('Could not save: ' + e.message, 'error'); }
    TP.changed();
  };
  // Redraw after a change (also used when another person's edits arrive).
  TP.changed = function () { listeners.forEach(function (f) { f(); }); };
  TP.onChange = function (f) { listeners.push(f); };
  TP.offChange = function (f) { listeners = listeners.filter(function (x) { return x !== f; }); };

  TP.normalise = normalise;
  TP.normaliseSession = function (x) { return normaliseSession(x); };
  TP.normaliseEvent = function (x) { return normaliseEvent(x); };
  function normalise(s) {
    s = s || {};
    var out = { events: s.events || {}, sessions: Array.isArray(s.sessions) ? s.sessions : [], templates: s.templates || {}, prefs: Object.assign({ units: 'metric', rpAxis: 'Time' }, s.prefs || {}) };
    out.sessions = out.sessions.map(normaliseSession);
    Object.keys(out.events).forEach(function (id) { out.events[id] = normaliseEvent(out.events[id]); });
    return out;
  }
  function normaliseSession(x) {
    var s = Object.assign({ id: TP.uid(), date: TP.today(), block_id: '', discipline: 'Run', type: 'Easy', details: '', wu_cd_check: false, wu_dist: 0, cd_dist: 0,
      total_dist: 0, num_sets: 1, main_dist_1: 0, main_dist_2: 0, main_dist_3: 0, main_dist_4: 0, main_dist_5: 0, duration_min: null, plan_by: 'Distance', workout: '', brick: '' }, x);
    ['wu_dist', 'cd_dist', 'total_dist', 'num_sets', 'main_dist_1', 'main_dist_2', 'main_dist_3', 'main_dist_4', 'main_dist_5'].forEach(function (k) { s[k] = TP.num(s[k], 0); });
    s.duration_min = isFinite(parseFloat(s.duration_min)) ? parseFloat(s.duration_min) : null;
    s.id = String(s.id); s.block_id = s.block_id ? String(s.block_id) : '';
    s.wu_cd_check = s.wu_cd_check === true || s.wu_cd_check === 'TRUE';
    if (!s.plan_by) s.plan_by = 'Distance';
    return s;
  }
  function normaliseEvent(p) {
    p = Object.assign({}, TP.EVENT_DEFAULTS, p);
    p.race_date = String(p.race_date).slice(0, 10);
    if (!p.palette) p.palette = TP.PALETTES[p.race_type][0];
    return p;
  }

  // --- Event structure (same rules as the R app) ---
  TP.blockWeeks = function (p) {
    var w = p.race_type === 'Training Only' ? p.train_only_weeks : p[TP.EVENT_PREFIX[p.race_type] + '_train'];
    return TP.num(w, 4);
  };
  TP.recovDays = function (p) {
    if (p.race_type === 'Training Only') return p.train_only_recov_check ? TP.num(p.train_only_recov, 0) : 0;
    return TP.num(p[TP.EVENT_PREFIX[p.race_type] + '_recov'], 0);
  };
  TP.eventName = function (p) { return p.race_name || p.race_type; };
  TP.eventDistance = function (p) {
    switch (p.race_type) {
      case 'Triathlon': return p.tri_dist === 'Custom' ? [p.tri_swim, p.tri_bike, p.tri_run].join(' / ') : p.tri_dist;
      case 'Duathlon': return p.du_dist === 'Custom' ? [p.du_run1, p.du_bike, p.du_run2].join(' / ') : p.du_dist;
      case 'Run': return p.run_dist === 'Custom' ? p.run_custom : p.run_dist;
      case 'Swim': return p.swim_dist === 'Custom' ? p.swim_custom : p.swim_dist;
      case 'Bike': return p.bike_dist === 'Custom' ? p.bike_custom : p.bike_dist;
      case 'Hyrox': return p.hyrox_dist === 'Custom' ? p.hyrox_custom : p.hyrox_dist;
    }
    return '';
  };
  TP.blockStart = function (p) { return TP.weekStart(TP.addDays(p.race_date, -7 * TP.blockWeeks(p))); };

  // Calendar entries for every event: race day, the build before it and the recovery after it.
  TP.schedule = function () {
    var out = [];
    Object.keys(TP.state.events).forEach(function (id) {
      var p = TP.state.events[id], rd = p.race_date, name = TP.eventName(p), weeks = TP.blockWeeks(p), rec = TP.recovDays(p), start = TP.blockStart(p);
      if (p.race_type === 'Training Only') {
        out.push({ id: id + '_train', bid: id, kind: 'train', title: 'Block: ' + name, start: start, end: rd, col: p.palette.train });
      } else {
        out.push({ id: id + '_race', bid: id, kind: 'race', title: name + ' (' + TP.eventDistance(p) + ') · P' + (p.priority || 3), start: rd, end: rd, col: p.palette.race });
        out.push({ id: id + '_train', bid: id, kind: 'train', title: weeks + 'Week Build: ' + name, start: start, end: TP.addDays(rd, -1), col: p.palette.train });
      }
      if (rec > 0) out.push({ id: id + '_recov', bid: id, kind: 'recov', title: name + ' Recovery', start: TP.addDays(rd, 1), end: TP.addDays(rd, rec), col: p.palette.recov });
    });
    return out;
  };
  TP.entriesOn = function (sched, d) { return sched.filter(function (e) { return d >= e.start && d <= e.end; }); };
  TP.trainingBlockOn = function (d) {
    var hit = TP.schedule().filter(function (e) { return e.kind === 'train' && d >= e.start && d <= e.end; });
    return hit.length ? hit[0].bid : '';
  };
  TP.newPalette = function (type) {
    var n = Object.keys(TP.state.events).filter(function (id) { return TP.state.events[id].race_type === type; }).length;
    var pals = TP.PALETTES[type]; return pals[n % pals.length];
  };
  // Build, taper or race week for week i of n.
  TP.phase = function (i, n, w, p) {
    if (p.race_date >= w && p.race_date <= TP.addDays(w, 6)) return p.race_type === 'Training Only' ? 'Final week' : 'Race week';
    if (i >= n - 2 && p.race_type !== 'Training Only') return 'Taper';
    return 'Build';
  };
  // Week label inside a block ("Week 3/12", "Race week", "Recovery week 1").
  TP.blockWeekLabel = function (entry, d) {
    var p = TP.state.events[entry.bid]; if (!p) return entry.title;
    var w = Math.floor(TP.daysBetween(TP.weekStart(entry.start), d) / 7) + 1, name = TP.eventName(p), n = TP.blockWeeks(p);
    if (entry.kind === 'recov') return name + ' Recovery Week ' + w;
    if (entry.kind === 'train') return w > n ? name + (p.race_type === 'Training Only' ? ' Final Week' : ' Race Week') : name + ' Week ' + w + '/' + n;
    return entry.title;
  };

  // --- Sessions ---
  TP.sessionsOn = function (d) { return TP.state.sessions.filter(function (s) { return s.date === d; }); };
  TP.sessionsBetween = function (a, b) { return TP.state.sessions.filter(function (s) { return s.date >= a && s.date <= b; }); };
  // Estimated hours: duration if set, otherwise from distance at a typical pace (gym 45 min).
  TP.estHours = function (s) {
    var sp = TP.sportOf(s.discipline);
    if (s.duration_min > 0) return s.duration_min / 60;
    if (sp === 'Gym') return 0.75;
    var pace = TP.PLAN_PACE_H_KM[sp]; if (pace === undefined) pace = 0.1;
    return (s.total_dist || 0) * pace;
  };
  TP.brickLegs = function (json) { try { var b = JSON.parse(json || ''); return Array.isArray(b) && b.length === 2 ? b : null; } catch (e) { return null; } };
  TP.brickText = function (json) {
    var b = TP.brickLegs(json); if (!b) return null;
    return b.map(function (l) { return l.sport + (TP.num(l.km, 0) > 0 ? ' ' + TP.round(TP.num(l.km), 2) + ' km' : ''); }).join(' → ');
  };

  // Detailed workouts: steps and repeats, each a distance or time with an optional target.
  TP.targetUnit = function (target, sport) {
    return { Pace: sport === 'Swim' ? '/100 m' : '/km', Power: 'W', 'Heart rate': 'bpm', Zone: 'zone' }[target] || '';
  };
  TP.partKm = function (x) { var a = TP.num(x.amount, 0); return { km: a, m: a / 1000, mi: a * 1.609344, yd: a * 0.0009144 }[x.measure || 'km'] || 0; };
  TP.partMin = function (x) { var a = TP.num(x.amount, 0); return { min: a, sec: a / 60 }[x.measure] || 0; };
  TP.workoutTotals = function (blocks) {
    var km = 0, mn = 0;
    (blocks || []).forEach(function (b) {
      if (b.kind === 'repeat') { var r = TP.num(b.reps, 1); km += r * (TP.partKm(b.work) + TP.partKm(b.rec)); mn += r * (TP.partMin(b.work) + TP.partMin(b.rec)); }
      else { km += TP.partKm(b); mn += TP.partMin(b); }
    });
    return { km: km, min: mn };
  };
  TP.partText = function (x, sport) {
    var lo = String(x.lo || '').trim(), hi = String(x.hi || '').trim();
    var tgt = (x.target === 'None' || !lo) ? '' : ' @ ' + lo + (hi ? '–' + hi : '') + (x.target !== 'Zone' ? ' ' + TP.targetUnit(x.target, sport) : '');
    return TP.num(x.amount, 0) + ' ' + (x.measure || 'km') + tgt;
  };
  TP.workoutBlocks = function (json) { try { var w = JSON.parse(json || ''); return Array.isArray(w) ? w : []; } catch (e) { return []; } };
  TP.workoutLines = function (json, sport) {
    return TP.workoutBlocks(json).map(function (b) {
      return b.kind === 'repeat' ? (b.reps || 1) + ' × (' + TP.partText(b.work, sport) + ', then ' + TP.partText(b.rec, sport) + ' recovery)'
                                 : (b.role || 'Step') + ': ' + TP.partText(b, sport);
    });
  };
  // One session written out in full (PDF and session view).
  TP.sessionOutline = function (s) {
    if (s.plan_by === 'Brick') { var bt = TP.brickText(s.brick); if (bt) return ['Brick: ' + bt]; }
    if (s.plan_by === 'Builder') { var wl = TP.workoutLines(s.workout, TP.sportOf(s.discipline)); if (wl.length) return wl; }
    var km = function (x) { return x > 0 ? TP.round(x, 2) + ' km' : null; };
    var n = Math.max(1, Math.min(5, Math.round(TP.num(s.num_sets, 1)) || 1)), sets = [];
    for (var i = 1; i <= n; i++) sets.push(TP.num(s['main_dist_' + i], 0));
    var parts = [];
    if (s.wu_cd_check && s.wu_dist > 0) parts.push('Warm-up ' + km(s.wu_dist));
    if (sets.some(function (x) { return x > 0; })) parts.push('Main: ' + (n > 1 ? n + ' sets – ' : '') + sets.filter(function (x) { return x > 0; }).map(km).join(', '));
    if (s.wu_cd_check && s.cd_dist > 0) parts.push('Cool-down ' + km(s.cd_dist));
    return parts;
  };
  // Short planned amount for chips: "10 km" or "45 min".
  TP.planAmount = function (s) {
    if (s.plan_by === 'Time' && s.duration_min > 0) return s.duration_min + ' min';
    if (s.total_dist > 0) return TP.round(s.total_dist, 2) + ' km';
    if (s.duration_min > 0) return s.duration_min + ' min';
    return '';
  };

  TP.upsertSession = function (s) {
    var i = TP.state.sessions.findIndex(function (x) { return x.id === s.id; });
    if (i >= 0) TP.state.sessions[i] = s; else TP.state.sessions.push(s);
    TP.save();
  };
  TP.deleteSession = function (id) { TP.state.sessions = TP.state.sessions.filter(function (x) { return x.id !== id; }); TP.save(); };
  TP.deleteEvent = function (id) {
    delete TP.state.events[id];
    TP.state.sessions.forEach(function (s) { if (s.block_id === id) s.block_id = ''; });
    TP.save();
  };
  // Pasted sessions get new ids. Sessions that belonged to a plan join whichever training block covers
  // their new date; sessions that weren't in a plan stay unassigned.
  TP.placeSessions = function (list, dates) {
    var base = Date.now();
    return list.map(function (s, i) {
      var n = Object.assign({}, s, { id: String(base + i), date: dates[i] });
      n.block_id = s.block_id ? TP.trainingBlockOn(n.date) : '';
      return n;
    });
  };

  // --- Backups ---
  TP.exportJSON = function () { return JSON.stringify({ app: 'training-planner', version: 1, saved: new Date().toISOString(), plan: TP.state }, null, 1); };
  // Accepts plans saved by this site and workspaces converted from the R app (export_for_web.R).
  TP.importJSON = function (text) {
    var d = JSON.parse(text);
    if (d.plan) { TP.state = normalise(d.plan); return; }
    if (d.state_params_data || d.sessions_data) {
      var ev = {};
      Object.keys(d.state_params_data || {}).forEach(function (id) {
        var p = Object.assign({}, d.state_params_data[id]);
        Object.keys(p).forEach(function (k) { if (Array.isArray(p[k]) && k !== 'palette') p[k] = p[k][0]; });
        if (p.palette && Array.isArray(p.palette.race)) p.palette = { race: p.palette.race[0], train: p.palette.train[0], recov: p.palette.recov[0] };
        ev[id] = p;
      });
      TP.state = normalise({ events: ev, sessions: d.sessions_data || [], templates: d.session_templates || {}, prefs: TP.state.prefs });
      return;
    }
    throw new Error('This file isn’t a saved Training Planner plan.');
  };
})(window.TP);
