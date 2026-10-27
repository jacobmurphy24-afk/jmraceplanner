// Calendar: year overview, month view, the selected-day panel and the weekly summary pop-up.
(function (TP) {
  var h = TP.h;
  TP.view = { page: 'myweek', mode: 'Year', month: TP.monthStart(TP.today()), year: new Date().getFullYear(), selected: TP.today() };
  TP.clip = { day: null, week: null };

  TP.select = function (d) {
    TP.view.selected = d;
    TP.view.month = TP.monthStart(d);
    TP.view.year = TP.parse(d).getFullYear();
    TP.render();
  };

  // Which block colours a day: training beats recovery, then the event whose race is closest wins.
  function washFor(entries, d) {
    var blk = entries.filter(function (e) { return e.kind === 'train'; });
    if (!blk.length) blk = entries.filter(function (e) { return e.kind === 'recov'; });
    if (!blk.length) return '';
    var best = blk.slice().sort(function (a, b) {
      var ra = TP.state.events[a.bid] ? TP.state.events[a.bid].race_date : a.end, rb = TP.state.events[b.bid] ? TP.state.events[b.bid].race_date : b.end;
      return Math.abs(TP.daysBetween(d, ra)) - Math.abs(TP.daysBetween(d, rb));
    })[0];
    return best.kind === 'train'
      ? 'background-color:' + best.col + ';background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.45),rgba(255,255,255,.45) 2px,transparent 2px,transparent 4px);'
      : 'background-color:' + best.col + ';background-image:radial-gradient(rgba(255,255,255,.85) 1px,transparent 1px);background-size:3px 3px;';
  }

  function stop(fn) { return function (e) { e.stopPropagation(); fn(); }; }

  // --- Year overview: one card per month ---
  function yearMonth(y, m, sched) {
    var start = TP.iso(new Date(y, m, 1)), end = TP.iso(new Date(y, m + 1, 0));
    var inMonth = sched.filter(function (e) { return e.start <= end && e.end >= start; });
    var races = inMonth.filter(function (e) { return e.kind === 'race'; });
    var mSess = TP.sessionsBetween(start, end);
    var pad = (new Date(y, m, 1).getDay() + 6) % 7, nDays = new Date(y, m + 1, 0).getDate();
    var cells = [];
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(function (x) { cells.push(h('div', { class: 'yv-wd' }, x)); });
    for (var k = 0; k < Math.ceil((pad + nDays) / 7) * 7; k++) {
      var di = k - pad + 1;
      if (di < 1 || di > nDays) { cells.push(h('div', { class: 'yv-day yv-empty' })); continue; }
      cells.push(yearDay(TP.iso(new Date(y, m, di)), di, inMonth));
    }
    return h('div', { class: 'yv-card' + (mSess.length + inMonth.length ? ' yv-busy' : '') },
      h('div', { class: 'yv-head', onclick: function () { TP.view.mode = 'Month'; TP.view.month = start; TP.render(); } },
        h('span', { class: 'yv-month' }, TP.MONTHS[m]),
        h('span', { class: 'yv-sum' }, mSess.length ? mSess.length + ' session' + (mSess.length > 1 ? 's' : '') : '')),
      races.length ? h('div', { class: 'yv-races' }, races.map(function (r) {
        var c = TP.deep(r.col);
        return h('span', { class: 'yv-race-pill', style: 'border-color:' + c + ';color:' + c + ';background:' + r.col + '66', title: r.title,
          onclick: function () { TP.eventForm(r.bid); } }, TP.fmt(r.start, '%d') + ' ' + r.title);
      })) : null,
      h('div', { class: 'yv-grid' }, cells));
  }
  function yearDay(d, di, inMonth) {
    var ov = TP.entriesOn(inMonth, d), ds = TP.sessionsOn(d), race = ov.filter(function (e) { return e.kind === 'race'; })[0];
    var cls = 'yv-day' + (d === TP.today() ? ' yv-today' : '') + (d === TP.view.selected ? ' yv-sel' : '');
    var num = race
      ? h('span', { class: 'yv-num yv-race', title: race.title, style: 'background:' + TP.deep(race.col), onclick: stop(function () { TP.eventForm(race.bid); }) }, di)
      : h('span', { class: 'yv-num' }, di);
    var ex = TP.match.extraOn(d);
    var dots = ds.length || ex.length ? h('div', { class: 'yv-dots' }, ds.slice(0, 3).map(function (s) {
      var st = TP.match.status(s), k = st ? st.st : '';
      return h('span', { class: 'yv-dot' + (k ? ' st-' + k : ''), title: TP.sportLabel(s.discipline) + ' · ' + s.type + (k ? ' (' + TP.match.STATUS_LABEL[k].toLowerCase() + ')' : ''), style: 'background:' + TP.typeCol(s.type) + (k === 'done' || k === 'partial' ? '' : '55'),
        onclick: stop(function () { TP.select(d); TP.sessionView(s.id); }) }, TP.SPORT_LETTER[TP.sportOf(s.discipline)] || '?');
    }), ds.length > 3 ? h('span', { class: 'yv-more' }, '+' + (ds.length - 3)) : null,
      ds.length <= 3 && ex.length ? h('span', { class: 'yv-act', title: ex.length + (ex.length > 1 ? ' activities' : ' activity') + ' not in a plan', onclick: stop(function () { TP.select(d); TP.activityView(ex[0].id); }) }, '●') : null) : null;
    var blk = ov.filter(function (e) { return e.kind !== 'race'; });
    var bars = blk.length ? h('div', { class: 'yv-bars' }, blk.map(function (e) {
      return h('div', { class: 'yv-bar' + (e.kind === 'recov' ? ' yv-recov' : ''), title: e.title, style: 'background:' + TP.deep(e.col),
        onclick: stop(function () { if (e.kind === 'train') TP.weekSummary(e.bid, d); else TP.eventForm(e.bid); }) });
    })) : null;
    return h('div', { class: cls, style: washFor(ov, d), onclick: function () { TP.select(d); } }, num, dots, bars);
  }
  TP.renderYear = function (root) {
    var sched = TP.schedule(), y = TP.view.year;
    root.appendChild(navBar(String(y), function () { TP.view.year--; TP.render(); }, function () { TP.view.year++; TP.render(); }));
    var grid = h('div', { class: 'yv-year' });
    for (var m = 0; m < 12; m++) grid.appendChild(yearMonth(y, m, sched));
    root.appendChild(grid);
    var lg = legend(); if (lg) root.appendChild(lg);
  };

  function navBar(label, prev, next) {
    // The selected date (dd/mm/yyyy); pressing it opens a date picker to jump to any day.
    var pick = h('input', { type: 'date', class: 'cal-pick', value: TP.view.selected, tabindex: -1, 'aria-hidden': 'true',
      onchange: function () { if (pick.value) TP.select(pick.value); } });
    var sel = h('button', { class: 'btn btn-sm cal-sel', title: 'Selected date: choose another', onclick: function () {
      try { pick.showPicker(); } catch (e) { pick.focus(); pick.click(); }
    } }, TP.fmt(TP.view.selected, '%d/%m/%Y'), pick);
    return h('div', { class: 'cal-nav' }, sel,
      h('button', { class: 'btn btn-icon', 'aria-label': 'Previous', onclick: prev }, TP.icon('chev-l')),
      h('h2', null, label),
      h('button', { class: 'btn btn-icon', 'aria-label': 'Next', onclick: next }, TP.icon('chev-r')),
      h('button', { class: 'btn btn-sm cal-today', onclick: function () { TP.select(TP.today()); } }, 'Today'));
  }
  function legend() {
    var ev = Object.keys(TP.state.events).map(function (id) { return TP.state.events[id]; }).sort(function (a, b) { return a.race_date < b.race_date ? -1 : 1; });
    if (!ev.length) return null;
    return h('div', { class: 'cal-legend' }, ev.map(function (p) {
      return h('span', null, h('i', { style: 'background:' + p.palette.race }), TP.eventName(p));
    }));
  }

  // --- Month view ---
  // A planned session: green once a Garmin activity completes it, orange if only partly, red if missed.
  function chip(s) {
    var st = TP.match.status(s), k = st ? st.st : '', a = st && st.act;
    if (a) return doneChip(a, k, s);
    var act = a ? (a.distance_m > 50 ? TP.round(a.distance_m / 1000, 1) + ' km' : Math.round((a.moving_s || 0) / 60) + ' min') : '';
    return h('div', { class: 'mchip' + (k ? ' mchip-' + k : ''), style: 'border-left-color:' + TP.typeCol(s.type),
      title: TP.sportLabel(s.discipline) + ' · ' + s.type + (k && k !== 'pending' ? ' — ' + TP.match.STATUS_LABEL[k].toLowerCase() + (a ? ': ' + a.name : '') : ''),
      onclick: stop(function () { TP.select(s.date); TP.sessionView(s.id); }) },
      TP.match.STATUS_ICON[k] ? h('span', { class: 'mchip-tick' }, TP.match.STATUS_ICON[k]) : null,
      h('span', { class: 'mchip-t' }, TP.sportLabel(s.discipline) + ' ' + s.type), h('span', { class: 'mchip-d' }, a ? act : TP.planAmount(s)));
  }
  // A Garmin activity that completes a planned session takes its place: green when done, orange when partly.
  function doneChip(a, k, s) {
    var amt = a.distance_m > 50 ? TP.round(a.distance_m / 1000, 1) + ' km' : a.moving_s ? Math.round(a.moving_s / 60) + ' min' : '';
    return h('div', { class: 'mchip mchip-act mchip-' + k, style: 'border-left-color:' + (TP.SPORT_COLOURS[a.sport] || TP.typeCol(s.type)),
      title: 'Garmin: ' + (a.name || a.type) + ' — ' + TP.match.STATUS_LABEL[k].toLowerCase() + ' (planned: ' + TP.sportLabel(s.discipline) + ' ' + s.type + ', ' + TP.planAmount(s) + ')',
      onclick: stop(function () { TP.select(a.date); TP.activityView(a.id); }) },
      h('span', { class: 'mchip-tick' }, TP.match.STATUS_ICON[k]), h('span', { class: 'mchip-t' }, a.name || a.sport), h('span', { class: 'mchip-d' }, amt));
  }
  // A Garmin activity that isn't a planned session.
  function achip(a) {
    var amt = a.distance_m > 50 ? TP.round(a.distance_m / 1000, 1) + ' km' : a.moving_s ? Math.round(a.moving_s / 60) + ' min' : '';
    return h('div', { class: 'achip', style: 'border-left-color:' + (TP.SPORT_COLOURS[a.sport] || '#8a8a8a'), title: (a.name || a.type) + ': activity not in a plan',
      onclick: stop(function () { TP.select(a.date); TP.activityView(a.id); }) },
      h('span', { class: 'achip-i' }, TP.icon('activity')), h('span', { class: 'mchip-t' }, a.name || a.sport), h('span', { class: 'mchip-d' }, amt));
  }
  TP.renderMonth = function (root) {
    var ms = TP.view.month, y = TP.parse(ms).getFullYear(), m = TP.parse(ms).getMonth(), sched = TP.schedule();
    root.appendChild(navBar(TP.fmt(ms, '%B %Y'), function () { TP.view.month = TP.addMonths(ms, -1); TP.render(); }, function () { TP.view.month = TP.addMonths(ms, 1); TP.render(); }));
    var pad = (new Date(y, m, 1).getDay() + 6) % 7, nDays = new Date(y, m + 1, 0).getDate(), rows = Math.ceil((pad + nDays) / 7);
    var grid = h('div', { class: 'mv-grid', style: 'grid-template-rows: auto repeat(' + rows + ', minmax(0, 1fr));' });
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (x) { grid.appendChild(h('div', { class: 'mv-wd' }, x)); });
    for (var k = 0; k < rows * 7; k++) {
      var di = k - pad + 1;
      if (di < 1 || di > nDays) { grid.appendChild(h('div', { class: 'mv-day mv-empty' })); continue; }
      grid.appendChild(monthDay(TP.iso(new Date(y, m, di)), di, sched));
    }
    root.appendChild(grid);
    var lg = legend(); if (lg) root.appendChild(lg);
  };
  function monthDay(d, di, sched) {
    var ov = TP.entriesOn(sched, d), ds = TP.sessionsOn(d), race = ov.filter(function (e) { return e.kind === 'race'; })[0], shown = {};
    var num = race ? h('span', { class: 'mv-num mv-race', style: 'background:' + race.col, onclick: stop(function () { TP.eventForm(race.bid); }) }, di)
                   : h('span', { class: 'mv-num' }, di);
    var full = h('div', { class: 'mv-full' }, ov.map(function (e) {
      var bg = 'background-color:' + e.col + ';', label = TP.blockWeekLabel(e, d), inner = null, click;
      if (e.kind === 'train') {
        bg += 'background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.4),rgba(255,255,255,.4) 4px,transparent 4px,transparent 8px);';
        click = function () { TP.weekSummary(e.bid, d); };
        var bs = ds.filter(function (s) { return s.block_id === e.bid; });
        bs.forEach(function (s) { shown[s.id] = 1; });
        if (bs.length) inner = h('div', { class: 'mv-blk-sess' }, bs.map(chip));
      } else if (e.kind === 'recov') {
        bg += 'background-image:radial-gradient(rgba(255,255,255,.8) 1.5px,transparent 1.5px);background-size:5px 5px;';
        click = function () { TP.eventForm(e.bid); };
      } else click = function () { TP.eventForm(e.bid); };
      return h('div', { class: 'mv-blk', style: bg },
        h('div', { class: 'mv-blk-t' + (e.kind === 'race' ? ' mv-blk-race' : ''), onclick: stop(click) }, label), inner);
    }), ds.filter(function (s) { return !shown[s.id]; }).map(chip), TP.match.extraOn(d).map(achip));
    // Phones: coloured block bars and a short line per session or activity ("Run 10k").
    var compact = h('div', { class: 'mv-compact' },
      h('div', { class: 'mv-cbars' }, ov.filter(function (e) { return e.kind !== 'race'; }).map(function (e) {
        return h('i', { class: e.kind === 'recov' ? 'recov' : '', style: 'background:' + TP.deep(e.col) });
      })),
      h('div', { class: 'mv-ctext' }, ds.slice(0, 3).map(function (s) {
        var st = TP.match.status(s), k = st ? st.st : '', a = st && st.act;
        if (a) return h('span', { class: 'mv-ct mv-ca mchip-' + k, style: 'border-left-color:' + (TP.SPORT_COLOURS[a.sport] || TP.typeCol(s.type)) }, short(actSport(a), TP.match.actAmount(a).split(' · ')[0]));
        return h('span', { class: 'mv-ct' + (k ? ' mchip-' + k : ''), style: 'border-left-color:' + TP.typeCol(s.type) }, short(TP.sportOf(s.discipline), TP.planAmount(s)));
      }), TP.match.extraOn(d).slice(0, Math.max(0, 3 - ds.length)).map(function (a) {
        return h('span', { class: 'mv-ct mv-ca', style: 'border-left-color:' + (TP.SPORT_COLOURS[a.sport] || '#8a8a8a') }, short(actSport(a), TP.match.actAmount(a).split(' · ')[0]));
      }), ds.length + TP.match.extraOn(d).length > 3 ? h('span', { class: 'mv-cmore' }, '+' + (ds.length + TP.match.extraOn(d).length - 3)) : null));
    return h('div', { class: 'mv-day' + (d === TP.today() ? ' mv-today' : '') + (d === TP.view.selected ? ' mv-sel' : ''), onclick: function () { TP.select(d); } },
      h('div', { class: 'mv-numrow' }, num), full, compact);
  }

  function actSport(a) { return /multi_sport/.test(a.type || '') ? 'Multi' : a.sport; }
  function short(sport, amt) {
    return (sport === 'Other' ? '' : sport) + ' ' + String(amt || '').replace(/\s*km\b/, 'k').replace(/\s*mi\b/, 'mi').replace(/\s*min\b/, "'").replace(/\s*m\b/, 'm');
  }

  // --- Selected day: copy & paste, then everything on it ---
  TP.renderDay = function (root) {
    var d = TP.view.selected, wk = TP.weekStart(d), ds = TP.sessionsOn(d), nWk = TP.sessionsBetween(wk, TP.addDays(wk, 6)).length;
    var evIds = []; TP.entriesOn(TP.schedule(), d).forEach(function (e) { if (evIds.indexOf(e.bid) < 0) evIds.push(e.bid); });
    // On a phone the date is in the calendar's top bar and the + in the tab bar adds sessions and events.
    root.appendChild(h('div', { class: 'day-head' },
      h('div', null, h('div', { class: 'lbl' }, 'Selected date'), h('div', { class: 'day-date' }, TP.fmt(d, '%a %d %b %Y'))),
      h('div', { class: 'day-add needs-edit' },
        h('button', { class: 'btn btn-primary btn-sm', onclick: function () { TP.eventForm(null, d); } }, TP.icon('plus'), 'Event'),
        h('button', { class: 'btn btn-soft btn-sm', onclick: function () { TP.sessionForm(null, { date: d }); } }, TP.icon('plus'), 'Session'))));
    if (ds.length || nWk || TP.clip.day || TP.clip.week) {
      root.appendChild(h('div', { class: 'side-section' }, 'Copy & paste'));
      var b = function (on, icon, label, fn) { return on ? h('button', { class: 'btn btn-soft btn-sm', onclick: fn }, TP.icon(icon), label) : null; };
      root.appendChild(h('div', { class: 'copy-grid needs-edit' },
        b(ds.length > 0, 'copy', 'Copy day', function () { TP.clip.day = { date: d, sessions: ds.map(function (x) { return Object.assign({}, x); }) }; TP.render(); }),
        b(nWk > 0, 'copy', 'Copy week', function () { TP.clip.week = { start: wk, sessions: TP.sessionsBetween(wk, TP.addDays(wk, 6)).map(function (x) { return Object.assign({}, x); }) }; TP.render(); }),
        b(!!TP.clip.day, 'paste', 'Paste day', function () {
          var c = TP.clip.day; TP.state.sessions = TP.state.sessions.concat(TP.placeSessions(c.sessions, c.sessions.map(function () { return d; }))); TP.save();
        }),
        b(!!TP.clip.week, 'paste', 'Paste week', function () {
          var c = TP.clip.week, shift = TP.daysBetween(c.start, wk);
          if (shift === 0) { TP.toast('That is the week you copied – pick a day in another week.', 'warn'); return; }
          var keep = TP.state.sessions.filter(function (s) { return !(s.date >= wk && s.date <= TP.addDays(wk, 6)); });
          TP.state.sessions = keep.concat(TP.placeSessions(c.sessions, c.sessions.map(function (s) { return TP.addDays(s.date, shift); }))); TP.save();
        })));
      if (TP.clip.day || TP.clip.week) {
        root.appendChild(h('div', { class: 'clip-note' },
          h('span', null, [TP.clip.day ? 'Day: ' + TP.fmt(TP.clip.day.date, '%a %d %b') : null, TP.clip.week ? 'Week of ' + TP.fmt(TP.clip.week.start, '%d %b') : null].filter(Boolean).join(' · ')),
          h('a', { href: '#', onclick: function (e) { e.preventDefault(); TP.clip.day = null; TP.clip.week = null; TP.render(); } }, 'Clear')));
        if (TP.clip.week) root.appendChild(h('div', { class: 'hint' }, 'Pasting a week replaces the sessions already in the selected week.'));
      }
    }
    // Events, sessions and Garmin activities on the day, in one list.
    var dayActs = TP.garmin ? TP.garmin.acts.filter(function (a) { return a.date === d; }) : [];
    root.appendChild(h('div', { class: 'side-section' }, 'On ' + TP.fmt(d, '%a %d %b')));
    if (!evIds.length && !ds.length && !dayActs.length) root.appendChild(h('div', { class: 'muted small day-none' }, 'Nothing planned.'));
    evIds.forEach(function (id) {
      var p = TP.state.events[id]; if (!p) return;
      root.appendChild(h('button', { class: 'list-item', onclick: function () { TP.eventForm(id); } },
        h('span', { class: 'dot', style: 'background:' + p.palette.race }),
        h('span', { class: 'grow strong' }, TP.eventName(p)),
        p.race_type !== 'Training Only' ? h('span', { class: 'prio-mini' }, 'P' + p.priority) : null,
        TP.icon('pencil')));
    });
    ds.forEach(function (s) {
      var st = TP.match.status(s), k = st ? st.st : '';
      if (st && st.act && st.act.date === d) return;   // shown below as its Garmin activity
      root.appendChild(h('button', { class: 'list-item', onclick: function () { TP.sessionView(s.id); } },
        h('span', { class: 'dot', style: 'background:' + TP.typeCol(s.type) }),
        h('span', { class: 'grow' }, TP.sportLabel(s.discipline) + ' · ' + s.type),
        TP.match.STATUS_ICON[k] ? h('span', { class: 'st-tick st-' + k, title: TP.match.STATUS_LABEL[k] }, TP.match.STATUS_ICON[k]) : null,
        h('span', { class: 'muted' }, TP.planAmount(s))));
    });
    dayActs.forEach(function (a) {
      var linked = TP.match.sessionObjForAct(a.id), st = linked && TP.match.status(linked), k = st ? st.st : '';
      root.appendChild(h('button', { class: 'list-item', onclick: function () { TP.activityView(a.id); } },
        h('span', { class: 'dot dot-act', style: 'border-color:' + (TP.SPORT_COLOURS[a.sport] || '#8a8a8a') }),
        h('span', { class: 'grow' }, a.name || a.type, h('span', { class: 'muted small' }, linked ? ' · planned ' + TP.sportLabel(linked.discipline) + ' ' + linked.type : ' · Garmin')),
        TP.match.STATUS_ICON[k] ? h('span', { class: 'st-tick st-' + k, title: TP.match.STATUS_LABEL[k] }, TP.match.STATUS_ICON[k]) : null,
        h('span', { class: 'muted' }, TP.match.actAmount(a))));
    });
  };

  // --- Weekly summary (click a training block bar) ---
  TP.donut = function (title, items) {
    items = items.filter(function (x) { return x.value > 0; });
    if (!items.length) return null;
    var tot = items.reduce(function (a, x) { return a + x.value; }, 0), a0 = -Math.PI / 2, R = 46, r = 28, paths = '';
    items.forEach(function (x) {
      var a1 = a0 + x.value / tot * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      if (items.length === 1) { paths += '<circle cx="50" cy="50" r="' + (R + r) / 2 + '" fill="none" stroke="' + x.col + '" stroke-width="' + (R - r) + '"/>'; return; }
      var p = function (rad, a) { return (50 + rad * Math.cos(a)).toFixed(2) + ' ' + (50 + rad * Math.sin(a)).toFixed(2); };
      paths += '<path d="M' + p(R, a0) + 'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p(R, a1) + 'L' + p(r, a1) + 'A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + p(r, a0) + 'Z" fill="' + x.col + '" stroke="#fff" stroke-width="1.2"/>';
      a0 = a1;
    });
    return h('div', { class: 'donut' }, h('div', { class: 'donut-t' }, title),
      h('div', { class: 'donut-row' }, h('div', { class: 'donut-svg', html: '<svg viewBox="0 0 100 100">' + paths + '</svg>' }),
        h('div', { class: 'donut-leg' }, items.map(function (x) { return h('div', null, h('i', { style: 'background:' + x.col }), h('span', null, x.label), h('b', null, x.shown)); }))));
  };
  TP.weekSummary = function (bid, d) {
    TP.view.selected = d; TP.render();
    var ws = TP.weekStart(d), we = TP.addDays(ws, 6), sess = TP.sessionsBetween(ws, we), labels = [];
    TP.schedule().filter(function (e) { return e.kind !== 'race' && e.start <= we && e.end >= ws; }).forEach(function (e) {
      var l = TP.blockWeekLabel(e, ws); if (labels.indexOf(l) < 0) labels.push(l);
    });
    var tot = sess.reduce(function (a, s) { return a + (s.total_dist || 0); }, 0), sports = TP.SPORTS.filter(function (sp) { return sess.some(function (s) { return TP.sportOf(s.discipline) === sp; }); });
    var charts = [];
    if (sports.length > 1) charts.push(TP.donut('Total distance', sports.map(function (sp) {
      var v = sess.filter(function (s) { return TP.sportOf(s.discipline) === sp; }).reduce(function (a, s) { return a + s.total_dist; }, 0);
      return { label: sp, value: v, col: TP.SPORT_SHADES[sp][0], shown: TP.round(v, 1) + ' km' };
    })));
    sports.forEach(function (sp) {
      var x = sess.filter(function (s) { return TP.sportOf(s.discipline) === sp; }), byTime = x.every(function (s) { return !(s.total_dist > 0); });
      var types = []; x.forEach(function (s) { if (types.indexOf(s.type) < 0) types.push(s.type); });
      var shades = TP.typeShades(sp, types);
      charts.push(TP.donut(sp + ' breakdown', Object.keys(shades).map(function (t) {
        var xs = x.filter(function (s) { return s.type === t; });
        var v = byTime ? xs.reduce(function (a, s) { return a + (s.duration_min || 0); }, 0) : xs.reduce(function (a, s) { return a + s.total_dist; }, 0);
        if (byTime && v === 0) v = xs.length;
        return { label: t, value: v, col: shades[t], shown: byTime ? (v >= 1 && xs.some(function (s) { return s.duration_min > 0; }) ? Math.round(v) + ' min' : xs.length + 'x') : TP.round(v, 1) + ' km' };
      })));
    });
    var bySport = sports.map(function (sp) {
      var x = sess.filter(function (s) { return TP.sportOf(s.discipline) === sp; }), km = x.reduce(function (a, s) { return a + s.total_dist; }, 0), mins = x.reduce(function (a, s) { return a + (s.duration_min || 0); }, 0);
      return h('div', { class: 'ws-row' }, h('span', null, h('i', { style: 'background:' + TP.SPORT_COLOURS[sp] }), sp),
        h('span', { class: 'muted' }, x.length + ' ' + (x.length > 1 ? 'sessions' : 'session')), h('b', null, km === 0 && mins > 0 ? mins + ' min' : TP.round(km, 1) + ' km'));
    });
    var m = TP.modal({ size: 'xl', title: h('div', null, h('div', { class: 'md-t' }, 'Weekly training summary'), h('div', { class: 'md-sub' }, 'Week: ' + TP.fmt(ws, '%d %b') + ' – ' + TP.fmt(we, '%d %b %Y'))),
      body: [
        h('div', { class: 'kpis kpis-3' },
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, TP.round(tot, 1) + ' km'), h('div', { class: 'kpi-l' }, 'Total distance')),
          h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, sess.length), h('div', { class: 'kpi-l' }, 'Total activities')),
          h('div', { class: 'kpi' }, labels.length ? labels.map(function (l) { return h('div', { class: 'kpi-blk' }, l); }) : h('div', { class: 'kpi-v' }, 'None'),
            h('div', { class: 'kpi-l' }, labels.length > 1 ? 'Active blocks' : 'Active block'))),
        h('div', { class: 'ws-grid' },
          h('div', { class: 'panel' }, h('div', { class: 'panel-h' }, 'By sport'), bySport.length ? bySport : h('p', { class: 'muted' }, 'No sessions planned.')),
          h('div', { class: 'panel ws-charts' }, charts.filter(Boolean).length ? charts : h('p', { class: 'muted' }, 'Add sessions to see the breakdown.')))],
      footer: [h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Close'),
               h('button', { class: 'btn btn-primary needs-edit', onclick: function () { TP.sessionForm(null, { date: d, block_id: bid }); } }, 'Add session')] });
  };
})(window.TP);
