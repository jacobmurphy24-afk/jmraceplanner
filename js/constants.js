// Shared constants and small helpers: sports, session types, colours, dates and formatting.
// Mirrors the definitions in "Training planner.R" so plans move between the two unchanged.
window.TP = window.TP || {};
(function (TP) {
  // Event colours: race marker, a light wash for training and a paler one for recovery.
  TP.PALETTES = {
    Run: [{ race: '#ff3b30', train: '#ffada8', recov: '#ffd8d6' }, { race: '#cf332a', train: '#eba9a6', recov: '#f5d6d4' },
          { race: '#ff6c64', train: '#ffc1be', recov: '#ffe2e0' }, { race: '#ff8983', train: '#ffcdcb', recov: '#ffe7e6' }],
    Swim: [{ race: '#1f7aff', train: '#a1c7ff', recov: '#d2e4ff' }, { race: '#1c65cf', train: '#a0beeb', recov: '#d2e0f5' },
           { race: '#579bff', train: '#b8d5ff', recov: '#ddebff' }, { race: '#79afff', train: '#c7ddff', recov: '#e4efff' }],
    Bike: [{ race: '#00a86b', train: '#94dac1', recov: '#cceee1' }, { race: '#038a59', train: '#95ceb9', recov: '#cde8de' },
           { race: '#40be90', train: '#afe4d0', recov: '#d9f2e9' }, { race: '#66cba6', train: '#bfe9da', recov: '#e0f5ed' }],
    Triathlon: [{ race: '#ffb400', train: '#ffe094', recov: '#fff0cc' }, { race: '#cf9303', train: '#ebd295', recov: '#f5e9cd' },
                { race: '#ffc740', train: '#ffe7af', recov: '#fff4d9' }],
    Duathlon: [{ race: '#e0562f', train: '#f3b8a6', recov: '#f9dcd2' }, { race: '#c44a6e', train: '#e8b1c1', recov: '#f3d9e0' },
               { race: '#b5622c', train: '#e2bea4', recov: '#f0ded1' }],
    Hyrox: [{ race: '#9b30ff', train: '#d5a8ff', recov: '#ebd6ff' }, { race: '#7f2acf', train: '#c9a6eb', recov: '#e5d4f5' },
            { race: '#b464ff', train: '#e0beff', recov: '#f0e0ff' }],
    'Training Only': [{ race: '#646464', train: '#bebebe', recov: '#e0e0e0' }, { race: '#535353', train: '#b7b7b7', recov: '#dddddd' },
                      { race: '#8b8b8b', train: '#cecece', recov: '#e8e8e8' }]
  };
  TP.EVENT_TYPES = ['Triathlon', 'Duathlon', 'Run', 'Swim', 'Bike', 'Hyrox', 'Training Only'];

  // Bikes are stored as "Indoor Bike" / "Outdoor Bike" so older workspaces keep working.
  TP.SPORTS = ['Swim', 'Run', 'Bike', 'Hyrox', 'Strength'];
  TP.SESSION_TYPES = {
    Swim: ['Endurance', 'Tempo', 'Speed', 'Mixed', 'Technique', 'Open water', 'Brick', 'Recovery', 'Other'],
    Run: ['Easy', 'Long', 'Tempo', 'Intervals', 'Hills', 'Fartlek', 'Brick', 'Recovery', 'Race', 'Other'],
    Bike: ['Endurance', 'Long', 'Tempo', 'Sweet spot', 'Intervals', 'Hills', 'Brick', 'Recovery', 'Race', 'Other'],
    Hyrox: ['Simulation', 'Compromised running', 'Stations', 'Strength endurance', 'Erg intervals', 'Race', 'Other'],
    Strength: ['Strength', 'Hypertrophy', 'Power', 'Mobility', 'Core', 'Circuit', 'Other']
  };
  // Colour by what the session does: greens easy, blue long, ambers steady-hard, reds hard, purples race-specific, slates gym.
  TP.TYPE_COLOURS = {
    Easy: '#40be90', Endurance: '#00a86b', Recovery: '#80d4b5', Technique: '#59c69f', Mobility: '#73cfae', Core: '#26b581', Long: '#1f7aff',
    'Open water': '#62a2ff', 'Erg intervals': '#84b6ff', Tempo: '#ffb400', 'Sweet spot': '#ffca4c', Intervals: '#ff3b30', Speed: '#cf332a',
    Fartlek: '#ff766e', Hills: '#ff938d', Mixed: '#9b30ff', Brick: '#b464ff', Simulation: '#862bdb', Stations: '#b96eff',
    'Compromised running': '#aa4fff', 'Strength endurance': '#c88dff', Strength: '#111111', Hypertrophy: '#585858', Power: '#111111',
    Circuit: '#7c7c7c', Other: '#a0a0a0', Race: '#111111'
  };
  TP.SPORT_COLOURS = { Swim: '#1f7aff', Run: '#ff3b30', Bike: '#00a86b', Hyrox: '#9b30ff', Strength: '#585858' };
  // Pie shades: one hue per sport, dark to light across that sport's session types.
  TP.SPORT_SHADES = { Swim: ['#84b6ff', '#e4efff'], Run: ['#ff938d', '#ffe7e6'], Bike: ['#73cfae', '#e0f5ed'], Hyrox: ['#c88dff', '#f3e6ff'], Strength: ['#a3a3a3', '#ebebeb'] };
  // Typical hours per km, used to estimate time from distance (and distance from time).
  TP.PLAN_PACE_H_KM = { Run: 1 / 11, Bike: 1 / 27, Swim: 1 / 3, Hyrox: 1 / 8, Strength: 0 };
  TP.PRIORITY_LABELS = { 1: 'Season goal', 2: 'Major race', 3: 'Important race', 4: 'Minor race', 5: 'Training race' };
  TP.SPORT_LETTER = { Swim: 'S', Run: 'R', Bike: 'B', Strength: 'St', Hyrox: 'H' };

  // Event distance options and form defaults, per event type.
  TP.EVENT_DISTANCES = {
    Triathlon: ['Sprint', 'Olympic', 'Half-Ironman', 'Custom'], Duathlon: ['Sprint', 'Standard', 'Long', 'Custom'],
    Run: ['5K', '10K', 'Half Marathon', 'Marathon', 'Custom'], Swim: ['1.5km', '3.0km', '5.0km', 'Custom'],
    Bike: ['50km', '100km', '100 Miles', 'Custom'], Hyrox: ['Open', 'Pro', 'Doubles', 'Relay', 'Custom']
  };
  TP.EVENT_PREFIX = { Triathlon: 'tri', Duathlon: 'du', Run: 'run', Swim: 'swim', Bike: 'bike', Hyrox: 'hyrox' };
  TP.EVENT_DEFAULTS = {
    race_name: '', race_type: 'Triathlon',
    tri_dist: 'Olympic', tri_swim: '', tri_bike: '', tri_run: '', tri_train: 12, tri_recov: 14,
    run_dist: '10K', run_custom: '', run_train: 8, run_recov: 7,
    swim_dist: '1.5km', swim_custom: '', swim_train: 6, swim_recov: 5,
    hyrox_dist: 'Open', hyrox_custom: '', hyrox_train: 10, hyrox_recov: 10,
    bike_dist: '100km', bike_custom: '', bike_train: 8, bike_recov: 7,
    du_dist: 'Standard', du_run1: '', du_bike: '', du_run2: '', du_train: 10, du_recov: 10,
    train_only_weeks: 4, train_only_recov_check: false, train_only_recov: 3, priority: 3
  };

  // --- Small helpers ---
  TP.num = function (x, dflt) { var v = parseFloat(x); return isFinite(v) ? v : (dflt === undefined ? NaN : dflt); };
  TP.sportOf = function (disc) { return (disc === 'Indoor Bike' || disc === 'Outdoor Bike' || disc === 'Bike') ? 'Bike' : disc === 'Gym' ? 'Strength' : disc; };
  TP.sportLabel = function (disc) { return (disc === 'Indoor Bike' || disc === 'Outdoor Bike') ? disc.replace(' Bike', '') + ' bike' : disc; };
  // "Run Intervals", "Strength Core"; a Strength session of type Strength is just "Strength".
  TP.sessionName = function (s, sep) { var l = TP.sportLabel(s.discipline); return s.type && s.type !== l ? l + (sep || ' ') + s.type : l; };
  TP.typeCol = function (type) { return TP.TYPE_COLOURS[type] || '#2e2c27'; };
  TP.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  TP.uid = function () { return String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'); };

  // Hex colour helpers: mix two colours, darken a pastel for bars/pills, readable text on a fill.
  function hexToRgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function rgbToHex(r) { return '#' + r.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); }).join(''); }
  TP.mix = function (a, b, t) { var x = hexToRgb(a), y = hexToRgb(b); return rgbToHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); };
  TP.ramp = function (a, b, n) { if (n === 1) return [TP.mix(a, b, 0.5)]; var out = []; for (var i = 0; i < n; i++) out.push(TP.mix(a, b, i / (n - 1))); return out; };
  TP.deep = function (col) {
    if (!/^#[0-9a-f]{6}$/i.test(col)) return '#2e2c27';
    var c = hexToRgb(col).map(function (v) { return v / 255; });
    var mx = Math.max.apply(null, c), mn = Math.min.apply(null, c), d = mx - mn, h = 0;
    if (d) { if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6; else if (mx === c[1]) h = (c[2] - c[0]) / d + 2; else h = (c[0] - c[1]) / d + 4; h /= 6; if (h < 0) h += 1; }
    var s = mx ? d / mx : 0, v = mx;
    s = Math.min(1, Math.max(0.55, s * 3)); v = Math.min(v, 0.78);
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r;
    r = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return rgbToHex(r.map(function (x) { return x * 255; }));
  };
  TP.textOn = function (col) { var v = hexToRgb(col); return (v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114) < 150 ? '#ffffff' : '#111111'; };
  TP.typeShades = function (sport, types) {
    var all = TP.SESSION_TYPES[sport] || [];
    types = types.filter(function (t, i) { return types.indexOf(t) === i; }).sort(function (a, b) { return all.indexOf(a) - all.indexOf(b); });
    var ends = TP.SPORT_SHADES[sport] || ['#333333', '#bdbdbd'], pal = TP.ramp(ends[0], ends[1], types.length), out = {};
    types.forEach(function (t, i) { out[t] = pal[i]; });
    return out;
  };

  // --- Dates: plain 'YYYY-MM-DD' strings throughout, weeks start on Monday ---
  TP.iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  TP.parse = function (s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  TP.today = function () { return TP.iso(new Date()); };
  TP.addDays = function (s, n) { var d = TP.parse(s); d.setDate(d.getDate() + n); return TP.iso(d); };
  TP.daysBetween = function (a, b) { return Math.round((TP.parse(b) - TP.parse(a)) / 864e5); };
  TP.weekStart = function (s) { var d = TP.parse(s), wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return TP.iso(d); };
  TP.monthStart = function (s) { var d = TP.parse(s); return TP.iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
  TP.addMonths = function (s, n) { var d = TP.parse(s); return TP.iso(new Date(d.getFullYear(), d.getMonth() + n, 1)); };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  TP.MONTHS = MONTHS;
  // Format codes follow R's strftime: %d %b %B %Y %a %A %e.
  TP.fmt = function (s, f) {
    var d = typeof s === 'string' ? TP.parse(s) : s;
    return f.replace(/%[dbBYaAem]/g, function (k) {
      switch (k) {
        case '%d': return String(d.getDate()).padStart(2, '0');
        case '%e': return String(d.getDate());
        case '%m': return String(d.getMonth() + 1).padStart(2, '0');
        case '%b': return MONTHS[d.getMonth()].slice(0, 3);
        case '%B': return MONTHS[d.getMonth()];
        case '%Y': return String(d.getFullYear());
        case '%a': return DAYS[d.getDay()].slice(0, 3);
        case '%A': return DAYS[d.getDay()];
      }
      return k;
    });
  };

  // --- Number formatting ---
  TP.round = function (x, n) { var f = Math.pow(10, n || 0); return Math.round(x * f) / f; };
  TP.fmtKm = function (x) { return x > 0 ? TP.round(x, 1) + ' km' : '–'; };
  TP.fmtH = function (x) { return x > 0 ? Math.round(x) + ' h' : '–'; };
  TP.fmtDuration = function (s) {
    if (!isFinite(s)) return '-';
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') : m + ':' + String(sec).padStart(2, '0');
  };
})(window.TP);
