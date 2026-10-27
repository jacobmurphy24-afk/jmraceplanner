// Forms: events (races / training blocks) and sessions, including the workout builder and templates.
(function (TP) {
  var h = TP.h;

  // =========================================================================
  // EVENT FORM
  // =========================================================================
  TP.eventForm = function (id, defaultDate) {
    var isEdit = !!id && !!TP.state.events[id];
    var p = Object.assign({}, TP.EVENT_DEFAULTS, { race_date: defaultDate || TP.view.selected }, isEdit ? TP.state.events[id] : {});
    var typeBox = h('div'), preview = h('div', { class: 'panel preview' }), prioBox = h('div');
    var name = TP.input('text', p.race_name, { placeholder: 'e.g. Ironman 70.3 Weymouth', oninput: function () { p.race_name = this.value; } });
    var date = TP.input('date', p.race_date, { onchange: function () { if (this.value) { p.race_date = this.value; drawPreview(); } } });
    var numIn = function (key, min, max) {
      return TP.input('number', p[key], { min: min, max: max, step: 1, inputmode: 'numeric', oninput: function () { p[key] = TP.num(this.value, 0); drawPreview(); } });
    };
    var txtIn = function (key, ph) { return TP.input('text', p[key], { placeholder: ph || '', oninput: function () { p[key] = this.value; } }); };

    function drawType() {
      TP.clear(typeBox); TP.clear(prioBox);
      var t = p.race_type, pre = TP.EVENT_PREFIX[t];
      if (t !== 'Training Only') {
        prioBox.appendChild(h('div', { class: 'form-section' }, 'Priority'));
        prioBox.appendChild(TP.chips(Object.keys(TP.PRIORITY_LABELS).map(function (k) { return { value: +k, label: k + ' · ' + TP.PRIORITY_LABELS[k] }; }),
          +p.priority || 3, function (v) { p.priority = v; }));
        prioBox.appendChild(h('div', { class: 'hint' }, '1 is the race the season is built around; 5 is a low-key or training race.'));
        var custom = h('div');
        var drawCustom = function () {
          TP.clear(custom);
          if (p[pre + '_dist'] !== 'Custom') return;
          if (t === 'Triathlon') custom.appendChild(h('div', { class: 'row3' }, TP.field('Swim', txtIn('tri_swim', '1.5km')), TP.field('Bike', txtIn('tri_bike', '40km')), TP.field('Run', txtIn('tri_run', '10km'))));
          else if (t === 'Duathlon') custom.appendChild(h('div', { class: 'row3' }, TP.field('Run 1', txtIn('du_run1', '10km')), TP.field('Bike', txtIn('du_bike', '40km')), TP.field('Run 2', txtIn('du_run2', '5km'))));
          else custom.appendChild(TP.field(t === 'Hyrox' ? 'Category' : 'Distance', txtIn(pre + '_custom', t === 'Run' ? 'e.g. 32km' : '')));
        };
        typeBox.appendChild(h('div', { class: 'form-section' }, 'Distance'));
        typeBox.appendChild(TP.chips(TP.EVENT_DISTANCES[t].map(function (x) { return { value: x, label: x }; }), p[pre + '_dist'], function (v) { p[pre + '_dist'] = v; drawCustom(); }));
        if (t === 'Duathlon') typeBox.appendChild(h('div', { class: 'hint' }, 'Sprint 5 km run / 20 km bike / 2.5 km run · Standard 10 / 40 / 5 km · Long 10 / 150 / 30 km'));
        typeBox.appendChild(custom); drawCustom();
        // Course climbing: used to check the build includes enough hills, and to adjust predicted run times.
        var hasBike = ['Triathlon', 'Duathlon', 'Bike'].indexOf(t) >= 0, hasRun = ['Triathlon', 'Duathlon', 'Run'].indexOf(t) >= 0;
        if (hasBike || hasRun) {
          var ftE = TP.imperial() ? 3.28084 : 1, elevIn = function (key) {
            return TP.input('number', p[key] > 0 ? Math.round(p[key] * ftE) : '', { min: 0, step: 10, inputmode: 'numeric', placeholder: '0', oninput: function () { p[key] = Math.round(TP.num(this.value, 0) / ftE); } });
          };
          typeBox.appendChild(h('div', { class: 'form-section' }, 'Course climbing'));
          typeBox.appendChild(h('div', { class: 'row2' }, hasBike ? TP.field('Bike', elevIn('course_bike_elev'), TP.elevUnit()) : null, hasRun ? TP.field('Run', elevIn('course_run_elev'), TP.elevUnit()) : null));
          typeBox.appendChild(h('div', { class: 'hint' }, 'Total ascent on the course, if you know it. Leave blank for a flat course.'));
        }
        typeBox.appendChild(h('div', { class: 'form-section' }, 'Build & recovery'));
        typeBox.appendChild(h('div', { class: 'row2' }, TP.field('Training block', numIn(pre + '_train', 1, 30), 'weeks'), TP.field('Recovery after', numIn(pre + '_recov', 1, 30), 'days')));
      } else {
        var recBox = h('div');
        var drawRec = function () { TP.clear(recBox); if (p.train_only_recov_check) recBox.appendChild(h('div', { class: 'row2' }, TP.field('Recovery', numIn('train_only_recov', 1, 30), 'days'))); };
        typeBox.appendChild(h('div', { class: 'form-section' }, 'Block'));
        typeBox.appendChild(h('div', { class: 'row2' }, TP.field('Length', numIn('train_only_weeks', 1, 30), 'weeks'),
          h('label', { class: 'check' }, TP.input('checkbox', '', { checked: p.train_only_recov_check, onchange: function () { p.train_only_recov_check = this.checked; drawRec(); drawPreview(); } }), 'Add a recovery phase')));
        typeBox.appendChild(recBox); drawRec();
      }
      drawPreview();
    }
    // Where the event lands: build start, race day, recovery end.
    function drawPreview() {
      TP.clear(preview);
      var wk = TP.blockWeeks(p), rec = TP.recovDays(p), start = TP.blockStart(p), build = TP.daysBetween(start, p.race_date), tot = Math.max(1, build + 1 + rec);
      var f = function (d) { return TP.fmt(d, '%a %d %b %Y'); }, race = p.race_type !== 'Training Only';
      preview.appendChild(h('div', { class: 'bar' },
        h('div', { style: 'width:' + (build / tot * 100) + '%;background:#a9c0cf' }),
        race ? h('div', { style: 'width:' + (100 / tot) + '%;min-width:6px;background:#2b4dff' }) : null,
        rec > 0 ? h('div', { style: 'width:' + (rec / tot * 100) + '%;background:#c7d2fe' }) : null));
      preview.appendChild(h('div', { class: 'legend' },
        h('span', null, h('i', { style: 'background:#a9c0cf' }), 'Build ', h('b', null, f(start)), ' (' + wk + ' weeks)'),
        race ? h('span', null, h('i', { style: 'background:#2b4dff' }), 'Race ', h('b', null, f(p.race_date))) : null,
        rec > 0 ? h('span', null, h('i', { style: 'background:#c7d2fe' }), 'Recovery to ', h('b', null, f(TP.addDays(p.race_date, rec)))) : null));
    }

    var m = TP.modal({ size: 'l', title: h('div', null, h('div', { class: 'md-t' }, isEdit ? 'Edit event' : 'New event'),
        h('div', { class: 'md-sub' }, 'A race (with its training build and recovery) or a training-only block.')),
      body: [
        h('div', { class: 'form-section' }, 'Event type'),
        TP.chips(TP.EVENT_TYPES.map(function (t) { return { value: t, label: t === 'Training Only' ? 'Training only' : t }; }), p.race_type,
          function (v) { p.race_type = v; drawType(); }, 'chips tiles'),
        h('div', { class: 'form-section' }, 'Details'),
        h('div', { class: 'row-75' }, TP.field('Name', name), TP.field('Race / end date', date)),
        prioBox, typeBox,
        h('div', { class: 'form-section' }, 'On your calendar'), preview],
      footer: [
        isEdit ? h('button', { class: 'btn btn-outline-danger needs-edit', onclick: function () {
          TP.confirm('Delete ' + TP.eventName(TP.state.events[id]) + '? Its sessions stay on the calendar, unassigned.', 'Delete', function () { m.close(); TP.deleteEvent(id); });
        } }, TP.icon('trash'), 'Delete') : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel'),
        h('button', { class: 'btn btn-primary needs-edit', onclick: save }, isEdit ? 'Save changes' : 'Add to calendar')] });
    drawType();

    function save() {
      if (!p.race_date) { TP.toast('Please pick a date.', 'error'); return; }
      p.race_name = (p.race_name || '').trim() || p.race_type;
      var bid = isEdit ? id : String(Date.now() / 1000);
      p.palette = isEdit ? TP.state.events[id].palette : TP.newPalette(p.race_type);
      if (isEdit && TP.state.events[id].race_type !== p.race_type) p.palette = TP.newPalette(p.race_type);
      p.priority = p.race_type === 'Training Only' ? null : (+p.priority || 3);
      p.train_weeks = TP.blockWeeks(p);
      TP.state.events[bid] = p;
      m.close(); TP.save();
    }
  };

  // =========================================================================
  // SESSION VIEW
  // =========================================================================
  function blockName(id) { var p = TP.state.events[id]; return p ? TP.eventName(p) : null; }

  TP.sessionView = function (sid) {
    var s = TP.state.sessions.filter(function (x) { return x.id === sid; })[0];
    if (!s) return;
    var col = TP.typeCol(s.type), sport = TP.sportOf(s.discipline), dur = s.duration_min, panel;
    var n = Math.max(1, Math.min(5, Math.round(s.num_sets) || 1)), sets = [];
    for (var i = 1; i <= n; i++) sets.push(s['main_dist_' + i] || 0);
    if (sport === 'Strength') panel = h('div', { class: 'panel' }, h('div', { class: 'lbl' }, 'Duration'), h('div', { class: 'big' }, dur ? dur + ' min' : '–'));
    else if (s.plan_by === 'Brick' && TP.brickLegs(s.brick)) panel = h('div', { class: 'panel' }, h('div', { class: 'lbl' }, 'Brick'), h('div', { class: 'big' }, TP.round(s.total_dist, 2) + ' km'),
      h('div', { class: 'strong' }, TP.brickText(s.brick)));
    else if (s.plan_by === 'Builder') panel = h('div', { class: 'panel' }, h('div', { class: 'lbl' }, 'Workout'),
      h('div', { class: 'big' }, [s.total_dist > 0 ? TP.round(s.total_dist, 2) + ' km' : null, dur ? dur + ' min' : null].filter(Boolean).join(' + ')),
      h('ol', { class: 'steps' }, TP.workoutLines(s.workout, sport).map(function (l) { return h('li', null, l); })));
    else if (s.plan_by === 'Time') panel = h('div', { class: 'panel' }, h('div', { class: 'lbl' }, 'Duration'),
      h('div', { class: 'big' }, dur ? dur + ' min' : '–', s.total_dist > 0 ? h('span', { class: 'big-sub' }, '  ·  ≈ ' + s.total_dist + ' km') : null),
      h('div', { class: 'hint' }, 'Planned by time. Distance is estimated from a typical pace.'));
    else {
      var wu = s.wu_cd_check ? s.wu_dist : 0, cd = s.wu_cd_check ? s.cd_dist : 0, tp = wu + cd + sets.reduce(function (a, x) { return a + x; }, 0);
      panel = h('div', { class: 'panel' },
        h('div', { class: 'split' },
          h('div', null, h('div', { class: 'lbl' }, 'Total distance'), h('div', { class: 'big' }, TP.round(s.total_dist, 2) + ' km', dur ? h('span', { class: 'big-sub' }, '  ·  ' + dur + ' min') : null)),
          h('div', { class: 'muted right' }, n + (n === 1 ? ' main set' : ' main sets') + ': ' + sets.map(function (x) { return x + ' km'; }).join(' + '))),
        tp > 0 ? h('div', { class: 'bar bar-l' },
          wu > 0 ? h('div', { style: 'width:' + wu / tp * 100 + '%;background:#bdbdbd', title: 'Warm-up' }) : null,
          sets.map(function (x, i) { return x > 0 ? h('div', { style: 'width:' + x / tp * 100 + '%;background:' + col + ';border-left:2px solid #fff', title: 'Set ' + (i + 1) }) : null; }),
          cd > 0 ? h('div', { style: 'width:' + cd / tp * 100 + '%;background:#bdbdbd;border-left:2px solid #fff', title: 'Cool-down' }) : null) : null,
        wu + cd > 0 ? h('div', { class: 'hint' }, 'Warm-up ' + wu + ' km · Cool-down ' + cd + ' km') : null);
    }
    var notes = (s.details || '').trim();
    var m = TP.modal({ size: 'm',
      title: h('div', null, h('div', { class: 'md-t' }, TP.sportLabel(s.discipline) + ' · ', h('span', { style: 'color:' + col }, s.type)),
        h('div', { class: 'md-sub' }, TP.fmt(s.date, '%A %d %B %Y') + (blockName(s.block_id) ? ' · ' + blockName(s.block_id) : ''))),
      body: [panel, TP.climbOf(s) ? h('div', { class: 'climb-line' }, 'Climbing ', h('b', null, TP.fmtElev(s.elev_m)), h('span', { class: 'muted' }, ' · adds about ' + Math.round(TP.climbKm(sport, s.elev_m) * TP.PLAN_PACE_H_KM[sport] * 60) + ' min to a flat ' + sport.toLowerCase())) : null,
        notes ? [h('div', { class: 'form-section' }, 'Notes'), h('div', { class: 'notes' }, notes)] : null, TP.match.sessionPanel(s, function () { m.close(); })],
      footer: [
        h('button', { class: 'btn btn-outline-danger needs-edit', onclick: function () { TP.confirm('Delete this session?', 'Delete', function () { m.close(); TP.deleteSession(s.id); }); } }, TP.icon('trash'), 'Delete'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Close'),
        h('button', { class: 'btn btn-primary needs-edit', onclick: function () { TP.sessionForm(s.id); } }, TP.icon('pencil'), 'Edit')] });
  };

  // =========================================================================
  // SESSION FORM
  // =========================================================================
  var uidN = 0;
  function wbUid() { return ++uidN; }
  function wbU() { return TP.imperial() ? 'mi' : 'km'; }
  function wbD(km, mi) { return TP.imperial() ? mi : km; }
  function part(measure, amount, target, lo, hi) { return { measure: measure, amount: amount, target: target || 'None', lo: lo || '', hi: hi || '' }; }
  function step(role, measure, amount, target, lo) { return Object.assign({ kind: 'step', uid: wbUid(), role: role }, part(measure, amount, target, lo)); }
  function rep(n) { return { kind: 'repeat', uid: wbUid(), reps: n, work: part(wbU(), wbD(1, 0.5), 'Zone', 'Z4'), rec: part('min', 2, 'Zone', 'Z1') }; }
  function wbDefault() { return [step('Warm-up', wbU(), wbD(2, 1), 'Zone', 'Z1'), rep(5), step('Cool-down', wbU(), wbD(1.5, 1), 'Zone', 'Z1')]; }

  // opts: {date, block_id} for a new session; restore: a template or saved form state.
  TP.sessionForm = function (sid, opts, restore) {
    opts = opts || {};
    var existing = sid ? TP.state.sessions.filter(function (x) { return x.id === sid; })[0] : null;
    var date = existing ? existing.date : (opts.date || TP.view.selected);
    var base = { block_id: opts.block_id !== undefined ? opts.block_id : TP.trainingBlockOn(date), discipline: 'Run', type: 'Intervals', details: '', wu_cd_check: false, wu_dist: 1, cd_dist: 1,
      total_dist: 0, num_sets: 1, main_dist_1: 0, main_dist_2: 0, main_dist_3: 0, main_dist_4: 0, main_dist_5: 0, duration_min: null, plan_by: 'Distance', workout: '', brick: '' };
    var f = Object.assign({}, base, existing || {}, restore || {});
    if (restore && opts.keepBlock !== undefined) f.block_id = opts.keepBlock;
    var sport = TP.sportOf(f.discipline); if (TP.SPORTS.indexOf(sport) < 0) sport = 'Run';
    var env = f.discipline === 'Indoor Bike' ? 'Indoor' : 'Outdoor';
    var useBuilder = f.plan_by === 'Builder', planBy = f.plan_by === 'Time' ? 'Time' : 'Distance';
    var blocks = TP.workoutBlocks(f.workout).map(function (b) { b.uid = wbUid(); return b; }); if (!blocks.length) blocks = wbDefault();
    var brick = TP.brickLegs(f.brick) || [{ sport: 'Bike', km: 40 }, { sport: 'Run', km: 5 }];

    // Distance boxes show miles when that's the chosen unit; values go back to km on save.
    // A value left as it was shown keeps its exact stored km, so switching units never drifts.
    var orig = {};
    function distIn(key, value) {
      var v = TP.num(value, NaN), shown = isFinite(v) ? TP.round(v * TP.distFactor(), 2) : '';
      if (isFinite(v)) orig[key] = v;
      var el = TP.input('number', shown, { min: 0, step: 0.1, inputmode: 'decimal' }); el.dataset.key = key;
      return el;
    }
    function toKm(el) {
      var v = TP.num(el.value, NaN); if (!isFinite(v)) return NaN;
      var o = orig[el.dataset.key];
      if (o !== undefined && TP.round(o * TP.distFactor(), 2) === v) return o;
      return TP.round(v / TP.distFactor(), 3);
    }
    var U = TP.distUnit();

    // --- Fields ---
    var blockSel = TP.selectEl([{ value: '', label: 'None' }].concat(Object.keys(TP.state.events).map(function (id) {
      var p = TP.state.events[id]; return { value: id, label: TP.eventName(p) + ' (' + p.race_type + ')' };
    })), f.block_id);
    // Moving the session to another day also moves it to that day's block, unless a block was picked by hand.
    var sub = h('div', { class: 'md-sub' }, TP.fmt(date, '%A %d %B %Y'));
    var dateIn = TP.input('date', date, { required: true, onchange: function () {
      if (!this.value) return;
      if (blockSel.value === (TP.trainingBlockOn(date) || '')) blockSel.value = TP.trainingBlockOn(this.value) || '';
      date = this.value; sub.textContent = TP.fmt(date, '%A %d %B %Y');
    } });
    var typeBox = h('div'), structBox = h('div'), envBox = h('div'), builderTick = h('div'), planSeg = h('div');
    var curType = f.type;
    var durGym = TP.input('number', sport === 'Strength' ? f.duration_min : '', { min: 0, step: 5, inputmode: 'numeric' });
    var durTime = TP.input('number', f.plan_by === 'Time' ? f.duration_min : '', { min: 0, step: 5, inputmode: 'numeric', oninput: drawEstimate });
    var estBox = h('div', { class: 'est' });
    var nSets = TP.input('number', Math.max(1, Math.round(f.num_sets) || 1), { min: 1, max: 5, step: 1, inputmode: 'numeric', oninput: function () { drawSets(); autoTotal(); } });
    var setIns = [1, 2, 3, 4, 5].map(function (i) { var e = distIn('main_dist_' + i, f['main_dist_' + i]); e.addEventListener('input', autoTotal); return e; });
    var setsBox = h('div', { class: 'grid-fields' });
    var wuChk = TP.input('checkbox', '', { checked: f.wu_cd_check, onchange: function () { drawWu(); autoTotal(); } });
    var wuIn = distIn('wu_dist', f.wu_dist), cdIn = distIn('cd_dist', f.cd_dist), wuBox = h('div', { class: 'grid-fields' });
    wuIn.addEventListener('input', autoTotal); cdIn.addEventListener('input', autoTotal);
    var totIn = distIn('total_dist', f.total_dist);
    var b1s = TP.selectEl(['Bike', 'Run', 'Swim'], brick[0].sport), b2s = TP.selectEl(['Run', 'Bike', 'Swim'], brick[1].sport);
    var b1d = distIn('brick1', brick[0].km), b2d = distIn('brick2', brick[1].km);
    var notes = h('textarea', { class: 'inp', rows: 2, placeholder: 'e.g. 6 × 1 km at 10K pace, 90 s jog recoveries' }); notes.value = f.details || '';
    // Planned climbing for runs and rides, shown in feet when distances are in miles; stored in metres.
    var ftF = TP.imperial() ? 3.28084 : 1, climbBox = h('div');
    var climbIn = TP.input('number', f.elev_m > 0 ? Math.round(f.elev_m * ftF) : '', { min: 0, step: 10, inputmode: 'numeric', placeholder: '0' });
    function drawClimb() {
      TP.clear(climbBox);
      if (sport !== 'Run' && sport !== 'Bike') return;
      climbBox.appendChild(h('div', { class: 'grid-fields climb-row' }, TP.field('Climbing', climbIn, TP.elevUnit()),
        h('div', { class: 'hint wide' }, 'Total ascent planned. Hilly sessions take longer, so this adds to the estimated time and training load. Leave blank if flat.')));
    }
    var wbBox = h('div', { class: 'wb' });

    function disc() { return sport === 'Bike' ? env + ' Bike' : sport; }
    function drawTypes() {
      TP.clear(typeBox);
      var types = TP.SESSION_TYPES[sport].slice();
      if (curType && types.indexOf(curType) < 0 && TP.sportOf(f.discipline) === sport) types.push(curType);
      if (types.indexOf(curType) < 0) curType = types[0];
      typeBox.appendChild(TP.chips(types.map(function (t) { return { value: t, label: t, dot: TP.typeCol(t) }; }), curType, function (v) { curType = v; drawStruct(); }));
    }
    function drawEnv() {
      TP.clear(envBox);
      if (sport === 'Bike') envBox.appendChild(TP.chips([{ value: 'Indoor', label: 'Indoor' }, { value: 'Outdoor', label: 'Outdoor' }], env, function (v) { env = v; drawEstimate(); }, 'seg'));
    }
    function drawSets() { var n = Math.max(1, Math.min(5, Math.round(TP.num(nSets.value, 1)))); TP.clear(setsBox); setsBox.appendChild(TP.field('Main sets', nSets, 'sets')); for (var i = 0; i < n; i++) setsBox.appendChild(TP.field('Set ' + (i + 1), setIns[i], U)); }
    function drawWu() { TP.clear(wuBox); wuBox.appendChild(h('label', { class: 'check' }, wuChk, 'Warm-up and cool-down')); if (wuChk.checked) { wuBox.appendChild(TP.field('Warm-up', wuIn, U)); wuBox.appendChild(TP.field('Cool-down', cdIn, U)); } }
    // The total adds up from the sets and warm-up / cool-down; typing a total overrides it.
    function autoTotal() {
      var n = Math.max(1, Math.min(5, Math.round(TP.num(nSets.value, 1)))), t = 0;
      for (var i = 0; i < n; i++) t += TP.num(setIns[i].value, 0);
      if (wuChk.checked) t += TP.num(wuIn.value, 0) + TP.num(cdIn.value, 0);
      if (t > 0) totIn.value = TP.round(t, 2);
    }
    function drawEstimate() {
      TP.clear(estBox);
      if (['Run', 'Bike', 'Swim'].indexOf(sport) < 0) { estBox.appendChild(h('div', { class: 'hint' }, 'Hyrox sessions are planned by time only – no distance is estimated.')); return; }
      var mins = TP.num(durTime.value, 0);
      if (!(mins > 0)) { estBox.appendChild(h('div', { class: 'hint' }, 'Enter a duration to estimate the distance.')); return; }
      var kmh = 1 / TP.PLAN_PACE_H_KM[sport], km = kmh * mins / 60;
      var sec = Math.round(sport === 'Swim' ? 360 / kmh : 3600 / kmh), speed = sport === 'Bike' ? TP.round(kmh, 1) + ' km/h' : Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + (sport === 'Swim' ? '/100 m' : '/km');
      estBox.appendChild(h('div', null, h('span', { class: 'lbl' }, 'Estimated distance '), h('b', { class: 'est-v' }, '≈ ' + TP.round(km, 1) + ' km')));
      estBox.appendChild(h('div', { class: 'hint' }, 'At a typical ' + speed + '.'));
    }

    // --- Workout builder ---
    function wbFields(x) {
      var unit = h('span', { class: 'wb-unit' }, TP.targetUnit(x.target, sport));
      var lo = TP.input('text', x.lo, { placeholder: { Pace: '4:30', Power: '250', 'Heart rate': '150', Zone: 'Z2' }[x.target] || 'from', oninput: function () { x.lo = this.value; } });
      return h('div', { class: 'wb-fields' },
        TP.input('number', x.amount, { min: 0, step: 0.1, inputmode: 'decimal', class: 'inp wb-amt', oninput: function () { x.amount = TP.num(this.value, 0); wbTotal(); } }),
        TP.selectEl(TP.imperial() ? ['mi', 'yd', 'min', 'sec', 'km', 'm'] : ['km', 'm', 'min', 'sec', 'mi', 'yd'], x.measure, { class: 'inp wb-meas', onchange: function () { x.measure = this.value; wbTotal(); } }),
        h('span', { class: 'wb-at' }, '@'),
        TP.selectEl([{ value: 'None', label: 'No target' }, 'Pace', 'Power', 'Heart rate', 'Zone'], x.target, { class: 'inp wb-tgt', onchange: function () {
          x.target = this.value; unit.textContent = TP.targetUnit(x.target, sport); lo.placeholder = { Pace: '4:30', Power: '250', 'Heart rate': '150', Zone: 'Z2' }[x.target] || 'from'; } }),
        lo, h('span', { class: 'wb-at' }, '–'),
        TP.input('text', x.hi, { placeholder: 'to', oninput: function () { x.hi = this.value; } }), unit);
    }
    var wbTot = h('span', { class: 'wb-total' });
    function wbTotal() {
      var t = TP.workoutTotals(blocks);
      wbTot.textContent = [t.km > 0 ? TP.round(t.km, 2) + ' km' : null, t.min > 0 ? Math.round(t.min) + ' min' : null].filter(Boolean).join(' + ');
    }
    function drawBuilder() {
      TP.clear(wbBox);
      blocks.forEach(function (b) {
        var rm = h('button', { type: 'button', class: 'wb-x', title: 'Remove', onclick: function () { blocks = blocks.filter(function (x) { return x !== b; }); drawBuilder(); } }, '×');
        if (b.kind === 'repeat') wbBox.appendChild(h('div', { class: 'wb-block' },
          h('div', { class: 'wb-row' }, h('span', { class: 'wb-reps' }, TP.input('number', b.reps, { min: 1, step: 1, inputmode: 'numeric', oninput: function () { b.reps = Math.max(1, Math.round(TP.num(this.value, 1))); wbTotal(); } }), '× repeat'), rm),
          h('div', { class: 'wb-row wb-sub' }, h('span', { class: 'wb-role' }, 'Work'), wbFields(b.work)),
          h('div', { class: 'wb-row wb-sub' }, h('span', { class: 'wb-role' }, 'Recovery'), wbFields(b.rec))));
        else wbBox.appendChild(h('div', { class: 'wb-block' }, h('div', { class: 'wb-row' },
          TP.selectEl(['Warm-up', 'Steady', 'Work', 'Recovery', 'Cool-down'], b.role, { class: 'inp wb-rolesel', onchange: function () { b.role = this.value; } }), wbFields(b), rm)));
      });
      var add = function (label, mk) { return h('a', { href: '#', onclick: function (e) { e.preventDefault(); blocks.push(mk()); drawBuilder(); } }, '+ ' + label); };
      wbBox.appendChild(h('div', { class: 'wb-add' }, h('span', { class: 'wb-role' }, 'Add:'),
        add('Warm-up', function () { return step('Warm-up', wbU(), wbD(2, 1), 'Zone', 'Z1'); }),
        add('Steady', function () { return step('Steady', wbU(), wbD(5, 3), 'Zone', 'Z2'); }),
        add('Repeats', function () { return rep(4); }),
        add('Recovery', function () { return step('Recovery', 'min', 3, 'Zone', 'Z1'); }),
        add('Cool-down', function () { return step('Cool-down', wbU(), wbD(1.5, 1), 'Zone', 'Z1'); }), wbTot));
      wbTotal();
    }

    // --- Structure: which planning panel shows ---
    function drawStruct() {
      TP.clear(structBox); TP.clear(builderTick); TP.clear(planSeg);
      if (sport === 'Strength') {
        structBox.appendChild(h('div', { class: 'panel grid-fields' }, TP.field('Duration', durGym, 'min'), h('div', { class: 'hint wide' }, 'Strength sessions are planned by time. Put the exercises in the notes.')));
        return;
      }
      builderTick.appendChild(h('label', { class: 'check' }, TP.input('checkbox', '', { checked: useBuilder, onchange: function () { useBuilder = this.checked; drawStruct(); } }), 'Detailed workout (targets, recoveries, repeats)'));
      if (useBuilder) { structBox.appendChild(h('div', { class: 'panel' }, wbBox)); drawBuilder(); return; }
      if (curType === 'Brick') {
        structBox.appendChild(h('div', { class: 'panel' },
          h('div', { class: 'brick-row' }, h('span', { class: 'wb-role' }, 'First'), TP.field('Activity', b1s), TP.field('Distance', b1d, U)),
          h('div', { class: 'brick-row' }, h('span', { class: 'wb-role' }, 'Then'), TP.field('Activity', b2s), TP.field('Distance', b2d, U)),
          h('div', { class: 'hint' }, 'Go straight from the first activity into the second; the total is the two added together.')));
        return;
      }
      planSeg.appendChild(TP.chips([{ value: 'Distance', label: 'By distance' }, { value: 'Time', label: 'By time' }], planBy, function (v) { planBy = v; drawStruct(); }, 'seg'));
      if (planBy === 'Time') { structBox.appendChild(h('div', { class: 'panel grid-fields' }, TP.field('Duration', durTime, 'min'), h('div', { class: 'wide' }, estBox))); drawEstimate(); return; }
      drawSets(); drawWu();
      structBox.appendChild(h('div', { class: 'panel' }, setsBox, h('div', { class: 'rule' }), wuBox, h('div', { class: 'rule' }),
        h('div', { class: 'grid-fields' }, TP.field('Total distance', totIn, U), h('div', { class: 'hint wide' }, 'Adds up from the sets and warm-up / cool-down; type a value to override it.'))));
    }
    function setSport(v) { sport = v; drawEnv(); drawTypes(); drawStruct(); drawClimb(); }

    // Everything typed so far, as a session-shaped object (for saving and templates).
    function collect() {
      var dsc = disc(), plan = dsc === 'Strength' ? 'Time' : useBuilder ? 'Builder' : curType === 'Brick' ? 'Brick' : planBy;
      var out = { block_id: blockSel.value, discipline: dsc, type: curType, details: notes.value, plan_by: plan, workout: '', brick: '' };
      var md = [0, 0, 0, 0, 0], tot = toKm(totIn), wu = wuChk.checked, wuD = toKm(wuIn), cdD = toKm(cdIn), n = Math.max(1, Math.min(5, Math.round(TP.num(nSets.value, 1))));
      for (var i = 0; i < 5; i++) { var v = toKm(setIns[i]); md[i] = i < n && isFinite(v) ? v : 0; }
      if (!isFinite(tot)) tot = 0;
      var dur = dsc === 'Strength' ? TP.num(durGym.value, NaN) : plan === 'Time' ? TP.num(durTime.value, NaN) : NaN;
      if (plan === 'Time' && dsc !== 'Strength') {
        // Planned by time: the distance is an estimate at a typical pace, as one block.
        var pace = TP.PLAN_PACE_H_KM[TP.sportOf(dsc)];
        tot = ['Run', 'Bike', 'Swim'].indexOf(TP.sportOf(dsc)) >= 0 && dur > 0 ? TP.round(dur / 60 / pace, 1) : 0;
        wu = false; wuD = 0; cdD = 0; n = 1; md = [tot, 0, 0, 0, 0];
      }
      if (plan === 'Brick') {
        var legs = [{ sport: b1s.value, km: TP.num(toKm(b1d), 0) }, { sport: b2s.value, km: TP.num(toKm(b2d), 0) }];
        out.brick = JSON.stringify(legs); tot = TP.round(legs[0].km + legs[1].km, 2);
        wu = false; wuD = 0; cdD = 0; n = 1; md = [tot, 0, 0, 0, 0];
      }
      if (plan === 'Builder') {
        // Distance steps add up to the total; time steps add to the duration.
        out.workout = JSON.stringify(blocks.map(function (b) { var c = Object.assign({}, b); delete c.uid; return c; }));
        var tt = TP.workoutTotals(blocks); tot = TP.round(tt.km, 2); dur = tt.min > 0 ? Math.round(tt.min) : NaN;
        wu = false; wuD = 0; cdD = 0; n = 1; md = [tot, 0, 0, 0, 0];
      }
      if (!wu) { wuD = 0; cdD = 0; }
      var climb = TP.num(climbIn.value, 0) / ftF; out.elev_m = (sport === 'Run' || sport === 'Bike') && climb > 0 ? Math.round(climb) : null;
      return Object.assign(out, { wu_cd_check: wu, wu_dist: isFinite(wuD) ? wuD : 0, cd_dist: isFinite(cdD) ? cdD : 0, total_dist: tot, num_sets: n,
        main_dist_1: md[0], main_dist_2: md[1], main_dist_3: md[2], main_dist_4: md[3], main_dist_5: md[4], duration_min: isFinite(dur) ? dur : null });
    }

    var m = TP.modal({ size: 'l', cls: 'sess-modal', easyClose: false,
      title: h('div', null, h('div', { class: 'md-t' }, existing ? 'Edit session' : 'New session'), sub),
      body: [
        h('div', { class: 'sess-top' },
          h('div', null, h('div', { class: 'form-section' }, 'Sport'),
            TP.chips(TP.SPORTS.map(function (x) { return { value: x, label: x }; }), sport, setSport, 'chips tiles')),
          h('div', { class: 'sess-when' }, h('div', null, h('div', { class: 'form-section' }, 'Date'), dateIn), h('div', null, h('div', { class: 'form-section' }, 'Training block'), blockSel))),
        h('div', { class: 'sess-head' }, h('div', { class: 'form-section' }, 'Session type'), envBox),
        typeBox,
        h('div', { class: 'sess-head' }, h('div', { class: 'sess-head-l' }, h('div', { class: 'form-section' }, 'Structure'), builderTick), planSeg),
        structBox, climbBox,
        h('div', { class: 'form-section' }, 'Notes'), notes],
      footer: [
        h('button', { class: 'btn btn-sm', onclick: loadTemplate }, TP.icon('folder'), 'Load template'),
        h('button', { class: 'btn btn-sm', onclick: saveTemplate }, TP.icon('bookmark'), 'Save as template'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onclick: save }, existing ? 'Save changes' : 'Add session')] });
    drawEnv(); drawTypes(); drawStruct(); drawClimb();

    function save() {
      if (!dateIn.value) { TP.toast('Pick a date for the session.', 'warn'); return; }
      var s = Object.assign({ id: existing ? existing.id : TP.uid(), date: date }, collect());
      m.close(); TP.upsertSession(s);
    }
    function saveTemplate() {
      var nm = TP.input('text', '', { placeholder: 'e.g. 8 km hills' });
      var t = TP.modal({ size: 's', stack: true, title: 'Save setup as template', body: TP.field('Template name', nm),
        footer: [h('button', { class: 'btn', onclick: function () { t.close(); } }, 'Cancel'),
                 h('button', { class: 'btn btn-primary', onclick: function () {
                   var name = nm.value.trim(); if (!name) return;
                   TP.state.templates[name] = collect(); TP.save(); t.close(); TP.toast('Template saved.');
                 } }, 'Save template')] });
      setTimeout(function () { nm.focus(); }, 50);
    }
    function loadTemplate() {
      var names = Object.keys(TP.state.templates);
      var sel = TP.selectEl(names.length ? names : [{ value: '', label: 'No templates saved' }], names[0]);
      var t = TP.modal({ size: 's', stack: true, title: 'Load template', body: TP.field('Template', sel),
        footer: [h('button', { class: 'btn', onclick: function () { t.close(); } }, 'Cancel'),
                 names.length ? h('button', { class: 'btn btn-outline-danger', onclick: function () {
                   delete TP.state.templates[sel.value]; TP.save(); t.close(); loadTemplate();
                 } }, 'Delete') : null,
                 h('button', { class: 'btn btn-primary', onclick: function () {
                   var tpl = TP.state.templates[sel.value]; if (!tpl) return;
                   t.close(); TP.sessionForm(sid, { date: date, keepBlock: blockSel.value }, tpl);
                 } }, 'Load')] });
    }
  };
})(window.TP);
