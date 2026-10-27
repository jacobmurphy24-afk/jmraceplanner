// Training analysis engine (a port of the R app's training_analysis.R).
//
// Turns Garmin activity summaries + second-by-second FIT streams into what a coach would review:
// training stress (TSS / rTSS / sTSS / hrTSS), the Banister performance model (CTL / ATL / TSB),
// injury-risk markers (ramp rate, ACWR, monotony / strain), Seiler 3-zone intensity distribution,
// power / pace duration curves with critical power / critical speed models, aerobic efficiency (EF)
// and durability (decoupling), plan compliance, training block reviews and weekly analysis.
// Pure functions only: no page code here. Dates are 'YYYY-MM-DD' strings.
(function (TP) {
  var A = TP.TA = {};
  A.FEATURE_VERSION = 4;
  var MMP_D = A.MMP_DURATIONS = [5, 10, 15, 30, 60, 120, 180, 300, 480, 600, 720, 1200, 1800, 2700, 3600, 5400, 7200];
  var RUN_D = A.RUN_DURATIONS = [30, 60, 120, 180, 300, 480, 600, 720, 1200, 1800, 2700, 3600];
  var BIKE_SPD_D = [600, 1200, 1800, 3600, 5400, 7200, 10800, 14400, 18000];
  var OW_FACTOR = 0.96;   // open-water swim speed vs pool at the same effort (no push-offs, sighting)
  var BEST = A.BEST_DISTANCES = [['400m', 400], ['1 km', 1000], ['1 mile', 1609.34], ['3 km', 3000], ['5 km', 5000], ['10 km', 10000], ['Half', 21097.5], ['Marathon', 42195]];
  A.SPORT_COLOURS = { Run: '#ff3b30', Swim: '#1f7aff', Bike: '#00a86b', Other: '#585858', Transition: '#999999' };
  A.ZONE_COLOURS = ['#8fb0c2', '#c99a3b', '#ff3b30'];

  // --- Small helpers ---
  var fin = A.fin = function (x) { return x !== null && x !== undefined && typeof x === 'number' && isFinite(x); };
  var or = A.or = function (x, y) { return fin(x) || (typeof x === 'string' && x !== '') || (x && typeof x === 'object') ? x : y; };
  function num(x) { var v = typeof x === 'number' ? x : parseFloat(x); return isFinite(v) ? v : null; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) if (fin(a[i])) s += a[i]; return s; }
  function mean(a) { var s = 0, n = 0; for (var i = 0; i < a.length; i++) if (fin(a[i])) { s += a[i]; n++; } return n ? s / n : null; }
  function median(a) { var v = a.filter(fin).sort(function (x, y) { return x - y; }); if (!v.length) return null; var m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
  function sd(a) { var v = a.filter(fin); if (v.length < 2) return null; var m = mean(v), s = 0; v.forEach(function (x) { s += (x - m) * (x - m); }); return Math.sqrt(s / (v.length - 1)); }
  function max(a) { var m = null; for (var i = 0; i < a.length; i++) if (fin(a[i]) && (m === null || a[i] > m)) m = a[i]; return m; }
  function min(a) { var m = null; for (var i = 0; i < a.length; i++) if (fin(a[i]) && (m === null || a[i] < m)) m = a[i]; return m; }
  function quantile(a, p) { var v = a.filter(fin).sort(function (x, y) { return x - y; }); if (!v.length) return null; var h = (v.length - 1) * p, lo = Math.floor(h); return v[lo] + (h - lo) * ((v[lo + 1] !== undefined ? v[lo + 1] : v[lo]) - v[lo]); }
  var clamp = A.clamp = function (x, lo, hi) { lo = lo === undefined ? 0 : lo; hi = hi === undefined ? 100 : hi; return Math.max(lo, Math.min(hi, x)); };
  function by(rows, key) { var o = {}; rows.forEach(function (r) { var k = typeof key === 'function' ? key(r) : r[key]; (o[k] = o[k] || []).push(r); }); return o; }
  function col(rows, k) { return rows.map(function (r) { return r[k]; }); }
  A.mean = mean; A.median = median; A.sum = sum; A.max = max;
  var addDays = TP.addDays, weekStart = TP.weekStart, days = TP.daysBetween;
  function dnum(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5; }
  function sprintf(f) {
    var args = Array.prototype.slice.call(arguments, 1), i = 0;
    return f.replace(/%([+]?)(\d*)(?:\.(\d+))?([dfs%])/g, function (m, plus, w, p, t) {
      if (t === '%') return '%';
      var v = args[i++];
      if (t === 's') return String(v);
      if (!fin(v)) return '–';
      var s = t === 'd' ? String(Math.round(v)) : v.toFixed(p === undefined ? 6 : +p);
      if (s === '-0' || /^-0\.0*$/.test(s)) s = s.slice(1);
      return (plus && v >= 0 && s.charAt(0) !== '-' ? '+' : '') + s;
    });
  }
  A.sprintf = sprintf;
  var fmtPace = A.fmtPace = function (sec) { if (!fin(sec)) return '–'; sec = Math.round(sec); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); };
  var fmtDur = A.fmtDur = function (s) {
    if (!fin(s)) return '–'; s = Math.round(s);
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? hh + ':' + ('0' + mm).slice(-2) + ':' + ('0' + ss).slice(-2) : mm + ':' + ('0' + ss).slice(-2);
  };
  A.durLabel = function (s) { return s < 60 ? s + 's' : s < 3600 ? s / 60 + 'm' : s / 3600 + 'h'; };
  A.parseHms = function (txt) {
    txt = String(txt || '').trim();
    if (!/^[0-9]+(:[0-5]?[0-9]){1,2}$/.test(txt)) return null;
    var p = txt.split(':').map(Number).reverse(), m = [1, 60, 3600];
    return p.reduce(function (t, x, i) { return t + x * m[i]; }, 0);
  };
  // Least squares y ~ a + b x.
  function lm(x, y) {
    var n = x.length; if (n < 2) return null;
    var mx = mean(x), my = mean(y), sxx = 0, sxy = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxx += (x[i] - mx) * (x[i] - mx); sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) * (y[i] - my); }
    if (sxx === 0) return null;
    var b = sxy / sxx, a = my - b * mx;
    return { a: a, b: b, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 };
  }
  // Least squares y ~ b0 + b1 x1 + b2 x2.
  function lm2(x1, x2, y) {
    var n = y.length; if (n < 4) return null;
    var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (var i = 0; i < n; i++) { var r = [1, x1[i], x2[i]]; for (var j = 0; j < 3; j++) { v[j] += r[j] * y[i]; for (var k = 0; k < 3; k++) S[j][k] += r[j] * r[k]; } }
    // Gaussian elimination.
    var M = S.map(function (row, j) { return row.concat([v[j]]); });
    for (var c = 0; c < 3; c++) {
      var p = c; for (var q = c + 1; q < 3; q++) if (Math.abs(M[q][c]) > Math.abs(M[p][c])) p = q;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (q = 0; q < 3; q++) if (q !== c) { var f = M[q][c] / M[c][c]; for (k = c; k < 4; k++) M[q][k] -= f * M[c][k]; }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // ===========================================================================
  // Streams -> features
  // ===========================================================================
  var COLS = ['hr', 'power', 'speed', 'cadence', 'distance', 'altitude'];
  // Raw FIT columns (seconds from start, gaps where the watch didn't record) -> one row per second.
  // Garmin "smart recording" logs a point every 1-12 s, so only gaps over 15 s are pauses.
  // t0 / t1 restrict to part of the file (one leg of a multisport activity).
  A.cleanStream = function (raw, disc, t0, t1) {
    if (!raw || !raw.t || raw.t.length < 30) return null;
    var idx = [];
    for (var i = 0; i < raw.t.length; i++) { var t = raw.t[i]; if (t !== null && (t0 === undefined || (t >= t0 && t < t1)) && (!idx.length || t > raw.t[idx[idx.length - 1]])) idx.push(i); }
    if (idx.length < 30) return null;
    // Swim watches often log distance but not speed: derive it.
    var hasCol = function (c) { return raw[c] && idx.some(function (k) { return raw[c][k] !== null && raw[c][k] !== undefined; }); };
    if (!hasCol('speed') && hasCol('distance')) {
      var sp = new Array(raw.t.length).fill(null), lastD = null, lastT = null;
      idx.forEach(function (k) {
        var dd = raw.distance[k];
        if (dd === null || dd === undefined) dd = lastD;
        if (lastD !== null && dd !== null) sp[k] = Math.max(dd - lastD, 0) / Math.max(raw.t[k] - lastT, 1);
        if (dd !== null) { lastD = dd; lastT = raw.t[k]; }
      });
      raw = Object.assign({}, raw, { speed: sp });
    }
    var out = { t: [] }, last = {}, recT = null, j = 0;
    COLS.forEach(function (c) { out[c] = []; last[c] = null; });
    var start = raw.t[idx[0]], end = raw.t[idx[idx.length - 1]];
    for (var s = start; s <= end; s++) {
      while (j < idx.length && raw.t[idx[j]] <= s) {
        var r = idx[j];
        COLS.forEach(function (c) { var v = raw[c] ? raw[c][r] : null; if (v !== null && v !== undefined) last[c] = v; });
        recT = raw.t[r]; j++;
      }
      if (s - recT > 15) continue;
      out.t.push(s);
      COLS.forEach(function (c) { out[c].push(last[c]); });
    }
    var n = out.t.length;
    for (i = 0; i < n; i++) {
      if (out.hr[i] !== null && (out.hr[i] < 30 || out.hr[i] > 235)) out.hr[i] = null;
      if (out.power[i] !== null && out.power[i] > 2500) out.power[i] = null;
    }
    var has = function (x) { var c = 0; for (var k = 0; k < x.length; k++) if (x[k] > 0) c++; return c > 30; };
    var keep = null;
    if (disc === 'Run' && has(out.speed)) keep = function (k) { return (out.speed[k] !== null && out.speed[k] > 0.5) || (out.speed[k] === null && out.cadence[k] > 0); };
    else if (disc === 'Bike' && (has(out.speed) || has(out.power) || has(out.cadence))) keep = function (k) { return out.speed[k] > 1 || out.power[k] > 0 || out.cadence[k] > 0; };
    if (keep) {
      var o2 = { t: [] }; COLS.forEach(function (c) { o2[c] = []; });
      for (i = 0; i < n; i++) if (keep(i)) { o2.t.push(out.t[i]); COLS.forEach(function (c) { o2[c].push(out[c][i]); }); }
      out = o2;
    }
    out.n = out.t.length;
    return out.n < 30 ? null : out;
  };

  function zeros(x) { var o = new Array(x.length); for (var i = 0; i < x.length; i++) o[i] = fin(x[i]) ? x[i] : 0; return o; }
  // Trailing rolling means (length L - n + 1), as data.table::frollmean without the leading NAs.
  function roll(x, n) {
    var L = x.length; if (L < n) return null;
    var out = new Array(L - n + 1), s = 0;
    for (var i = 0; i < L; i++) { s += x[i]; if (i >= n) s -= x[i - n]; if (i >= n - 1) out[i - n + 1] = s / n; }
    return out;
  }
  function rollMax(x, n) { var r = roll(x, n); if (!r) return null; var m = -Infinity; for (var i = 0; i < r.length; i++) if (r[i] > m) m = r[i]; return m; }
  function bestMean(x, durs) { var z = zeros(x); return durs.map(function (n) { return rollMax(z, n); }); }
  function np(p) {
    var z = zeros(p); if (z.length < 30) return null;
    var r = roll(z, 30), s = 0; for (var i = 0; i < r.length; i++) s += Math.pow(r[i], 4);
    return Math.pow(s / r.length, 0.25);
  }
  function gapFactor(g) { g = Math.max(Math.min(g * 100, 30), -30); return Math.max(1 + 0.03 * g + 0.0018 * g * g, 0.5); }
  function locfNocb(x) {
    var o = x.slice(), last = null, i;
    for (i = 0; i < o.length; i++) { if (fin(o[i])) last = o[i]; else o[i] = last; }
    last = null; for (i = o.length - 1; i >= 0; i--) { if (fin(o[i])) last = o[i]; else o[i] = last; }
    return o;
  }
  // Second-by-second grade-adjusted speed (m/s) for a run stream.
  function gapSeries(st) {
    var n = st.n, spd = zeros(st.speed), grade = new Array(n).fill(0);
    var nAlt = st.altitude.filter(fin).length, nDist = st.distance.filter(fin).length;
    if (nAlt > n * 0.5 && nDist > n * 0.5) {
      // Watches without a barometer log GPS altitude with metres of noise, so smooth hard and measure
      // grade over at least ~40 m before trusting it.
      var alt = locfNocb(st.altitude), dist = locfNocb(st.distance), altS = new Array(n), s = 0, i;
      for (i = 0; i < n; i++) altS[i] = alt[i];
      for (i = 0; i < n; i++) { s += alt[i]; if (i >= 31) s -= alt[i - 31]; if (i >= 30) altS[i - 15] = s / 31; }
      for (i = 15; i < n - 15; i++) {
        var dr = dist[i + 15] - dist[i - 15], ar = altS[i + 15] - altS[i - 15];
        var g = dr > 40 ? ar / dr : 0; if (!isFinite(g)) g = 0;
        grade[i] = Math.max(Math.min(g, 0.15), -0.15);
      }
    }
    var gap = spd.map(function (v, k) { return v * gapFactor(grade[k]); });
    // A run whose grade adjustment adds more than 12% overall is almost always altitude noise rather than terrain.
    if (mean(gap) > 1.12 * Math.max(mean(spd), 0.1)) gap = spd;
    return gap;
  }
  function bestDistanceTimes(dist, list) {
    var n = dist.length, d = new Array(n), m = 0;
    for (var i = 0; i < n; i++) { var v = fin(dist[i]) ? dist[i] : 0; if (v > m) m = v; d[i] = m; }
    return list.map(function (D) {
      if (d[n - 1] - d[0] < D) return null;
      var best = null, p = 0;
      for (var k = 0; k < n; k++) {
        if (p < k) p = k;
        while (p < n && d[p] <= d[k] + D - 1e-9) p++;
        if (p >= n) break;
        if (best === null || p - k < best) best = p - k;
      }
      return best;
    });
  }
  function tabulate(vals, nb, bin) { var h = new Array(nb).fill(0); vals.forEach(function (v) { if (fin(v)) h[Math.min(Math.max(bin(v), 1), nb) - 1]++; }); return h; }

  // Threshold-independent features for one activity (cached, so a threshold change re-scores instantly).
  A.streamFeatures = function (st, disc) {
    var n = st.n, f = { moving_s: n, has_hr: false, has_power: false, has_speed: false }, hr = st.hr;
    var nhr = hr.filter(fin).length;
    if (nhr > 60) {
      f.has_hr = true; f.avg_hr = mean(hr);
      var hrF = hr.map(function (v) { return fin(v) ? v : f.avg_hr; });
      f.max_hr5 = rollMax(hrF, 5);
      f.hr20 = n >= 1200 ? rollMax(hrF, 1200) : null;
      f.hr_hist = tabulate(hr, 240, function (v) { return Math.round(v); });
    }
    function halves(out) {
      if (!f.has_hr || n < 1200) return null;
      var hh = Math.floor(n / 2);
      return [mean(out.slice(0, hh)) / mean(hr.slice(0, hh)), mean(out.slice(hh)) / mean(hr.slice(hh))];
    }
    var cnt = function (x, lo) { var c = 0; for (var i = 0; i < x.length; i++) if (x[i] > lo) c++; return c; };
    if (disc === 'Bike' && cnt(st.speed, 2) > 600) {
      var sp = zeros(st.speed);
      f.bike_speed_curve = bestMean(sp, BIKE_SPD_D);
      if (f.has_hr) f.speed_per_hr = mean(sp) * 3.6 / f.avg_hr;
    }
    if (disc === 'Bike' && cnt(st.power, 0) > Math.max(120, 0.5 * n)) {
      var p = zeros(st.power);
      f.has_power = true; f.avg_power = mean(p); f.np = np(p); f.kj = sum(p) / 1000;
      f.mmp = bestMean(p, MMP_D);
      f.power_hist = tabulate(p, 400, function (v) { return Math.floor(v / 5) + 1; });
      f.eff_halves = halves(p);
      if (f.has_hr) f.ef = f.np / f.avg_hr;
    }
    if (disc === 'Run' && cnt(st.speed, 0.5) > 120) {
      f.has_speed = true;
      var spd = zeros(st.speed), gap = gapSeries(st);
      f.avg_speed = mean(spd); f.avg_gap = mean(gap);
      var r = roll(gap, 30), s4 = 0; r.forEach(function (v) { s4 += Math.pow(v, 4); }); f.ngp = Math.pow(s4 / r.length, 0.25);
      f.mmp_speed = bestMean(spd, RUN_D);
      f.best_dist = bestDistanceTimes(st.distance, BEST.map(function (b) { return b[1]; }));
      f.speed_hist = tabulate(gap, 200, function (v) { return Math.floor(v / 0.05) + 1; });
      f.eff_halves = halves(gap);
      if (f.has_hr) f.ef = (f.ngp * 60) / f.avg_hr;
      var cad = st.cadence.filter(fin);
      f.avg_cadence = cad.length > 60 ? mean(cad.filter(function (v) { return v > 0; })) * (mean(cad) < 120 ? 2 : 1) : null;
    }
    f.pace = raceStream(st, disc, f);
    return f;
  };

  // Output through the activity (power for rides, grade-adjusted speed for runs), smoothed and thinned
  // for pacing charts, with the second-half split, final-quarter fade and evenness.
  function raceStream(st, disc, f) {
    var n = st.n, out = null, cnt = function (x) { var c = 0; for (var i = 0; i < x.length; i++) if (x[i] > 0) c++; return c; };
    if (disc === 'Bike' && cnt(st.power) > 120) out = zeros(st.power);
    else if ((disc === 'Run' || disc === 'Other') && st.speed.filter(fin).length > 120) out = gapSeries(st);
    else if (st.speed.filter(fin).length > 120) out = zeros(st.speed);
    var res = { n: n, unit: disc === 'Bike' && out && max(out) > 30 ? 'W' : 'm/s' };
    if (out && n >= 600) {
      var hh = Math.floor(n / 2), q = Math.floor(n * 0.75);
      res.split_pct = (mean(out.slice(hh)) / Math.max(mean(out.slice(0, hh)), 1e-6) - 1) * 100;
      res.fade_pct = (mean(out.slice(q)) / Math.max(mean(out.slice(0, q)), 1e-6) - 1) * 100;
      var blocks = []; for (var b = 0; b < n; b += 300) blocks.push(mean(out.slice(b, b + 300)));
      res.cv = blocks.length >= 3 ? sd(blocks) / mean(blocks) * 100 : null;
    }
    if (out) {
      var win = Math.min(120, Math.max(10, Math.floor(n / 60))), o = roll(out, win);
      var hrOk = st.hr.filter(fin).length > 60, hr = hrOk ? roll(locfNocb(st.hr), win) : null;
      if (o) {
        var step = Math.max(1, Math.floor(o.length / 200)), ser = [];
        for (var i = 0; i < o.length; i += step) ser.push([Math.round((i + win) / 6) / 10, Math.round(o[i] * 1000) / 1000, hr ? Math.round(hr[i]) : null]);
        res.series = ser;
      }
    }
    return res;
  }

  // ===========================================================================
  // Session structure: warm-up, sets / intervals, cool-down and splits. Uses structured-workout steps or
  // lap-button laps from the watch when they exist, otherwise detects warm-up and cool-down from the data.
  // st: a clean stream; laps / lengths: from the FIT file, times in seconds from the start of the file.
  // ===========================================================================
  function countLE(arr, x) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo; }
  function twoMeans(x) {
    x = x.filter(function (v) { return fin(v) && v > 0; });
    if (x.length < 3) return null;
    var lo = quantile(x, 0.2), hi = quantile(x, 0.85);
    for (var k = 0; k < 20; k++) {
      var thr = (lo + hi) / 2, a = x.filter(function (v) { return v < thr; }), b = x.filter(function (v) { return v >= thr; });
      if (!a.length || !b.length) return null;
      lo = mean(a); hi = mean(b);
    }
    return { lo: lo, hi: hi, thr: (lo + hi) / 2 };
  }
  function labelBlocks(hard) {
    var k = hard.map(function (x) { return x ? 'Work' : 'Recovery'; }), first = hard.indexOf(true), last = hard.lastIndexOf(true);
    if (first < 0) return hard.map(function () { return 'Main'; });
    for (var i = 0; i < first; i++) k[i] = 'Warm-up';
    for (i = last + 1; i < hard.length; i++) k[i] = 'Cool-down';
    return k;
  }
  // Round half to even, as R's round() does (keeps names identical to the R app's).
  function rhe(x) { var f = Math.floor(x), d = x - f; return Math.abs(d - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(x); }
  function fmtThousands(v) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function rle(v) { var out = []; v.forEach(function (x) { if (out.length && out[out.length - 1].v === x) out[out.length - 1].n++; else out.push({ v: x, n: 1 }); }); return out; }
  A.sessionStructure = function (st, a, laps, lengths) {
    var disc = a.discipline, pool = a.pool_length_m; if (pool > 100) pool /= 100;
    // --- Pool swims: sets from lengths ---
    if (disc === 'Swim' && lengths && lengths.length >= 4 && fin(lengths[0].t)) {
      var L = lengths.slice().sort(function (x, y) { return x.t - y.t; }); if (!(pool > 0)) pool = 25;
      var gap = L.map(function (l, i) { return i < L.length - 1 ? L[i + 1].t - (l.t + l.dur) : null; }), sets = [], cur = null;
      L.forEach(function (l, i) {
        if (!cur || gap[i - 1] > 8) { cur = { ix: [] }; sets.push(cur); }
        cur.ix.push(i);
      });
      sets = sets.map(function (g) {
        var cnt = {}; g.ix.forEach(function (i) { var k = L[i].stroke || ''; cnt[k] = (cnt[k] || 0) + 1; });
        var st2 = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x]; })[0] || '';
        return { start: L[g.ix[0]].t - L[0].t, dur: sum(g.ix.map(function (i) { return L[i].dur; })), dist: g.ix.length * pool, rest: gap[g.ix[g.ix.length - 1]], stroke: st2 };
      });
      // A single lone length between sets is usually a pause mid-set, not a set of its own.
      while (sets.length > 2 && sets.some(function (x) { return x.dist <= pool; })) {
        var k = sets.findIndex(function (x) { return x.dist <= pool; }), j = k > 0 ? k - 1 : k + 1, lo2 = Math.min(k, j), hi2 = Math.max(k, j);
        sets[lo2].dur += sets[hi2].dur; sets[lo2].dist += sets[hi2].dist; sets[lo2].rest = sets[hi2].rest; sets.splice(hi2, 1);
      }
      sets.forEach(function (x, i) { x.out = x.dist / Math.max(x.dur, 1); x.kind = sets.length >= 3 ? (i === 0 ? 'Warm-up' : i === sets.length - 1 ? 'Cool-down' : 'Set') : 'Main'; x.hr = null; x.max_hr = null; x.end = x.start + x.dur; });
      var main = sets.filter(function (x) { return x.kind === 'Set' || x.kind === 'Main'; });
      var swimType = sets.length < 3 ? 'Endurance' : main.every(function (x) { return x.dist >= 300; }) ? 'Tempo' : main.every(function (x) { return x.dist <= 250; }) ? 'Speed' : 'Mixed';
      var runs = rle(main.map(function (x) { return x.dist; })), parts = runs.map(function (r) { return r.n > 1 ? sprintf('%d × %.0f m', r.n, r.v) : sprintf('%.0f m', r.v); });
      var wu = sets.filter(function (x) { return x.kind === 'Warm-up'; }), cd = sets.filter(function (x) { return x.kind === 'Cool-down'; });
      var total = sum(sets.map(function (x) { return x.dist; }));
      var body = swimType === 'Endurance' ? fmtThousands(total) + ' m' + (sets.length > 1 ? ' in one (one short pause)' : ' continuous') : parts.join(' + ');
      var label = swimType + ' swim: ' + [wu.length ? sprintf('Warm-up %.0f m', wu[0].dist) : null, body, cd.length ? sprintf('Cool-down %.0f m', cd[0].dist) : null].filter(Boolean).join(' · ');
      var top = runs.reduce(function (b, r) { return !b || r.n > b.n ? r : b; }, null), reps = top ? top.n : 0;
      var mdist = sum(main.map(function (x) { return x.dist; })), mdur = sum(main.map(function (x) { return x.dur; }));
      return { swim_type: swimType, rep_dist: main.length ? median(main.map(function (x) { return x.dist; })) : null, rep_label: reps >= 2 && swimType !== 'Endurance' ? sprintf('%d × %.0f m', reps, top.v) : null,
        segments: sets, splits: null, source: 'pool lengths recorded by your watch', unit: 'swim', label: label,
        n_work: swimType !== 'Endurance' ? main.length : 0, work_dur: main.length ? median(main.map(function (x) { return x.dur; })) : null, work_dist: main.length ? median(main.map(function (x) { return x.dist; })) : null,
        work_out: main.length ? mdist / mdur : null, work_hr: null, main_out: main.length ? mdist / mdur : null, main_hr: null, wu_dur: sum(wu.map(function (x) { return x.dur; })), cd_dur: sum(cd.map(function (x) { return x.dur; })), total_dist: total };
    }
    if (!st || st.n < 120) return null;
    var n = st.n, nonNull = function (x) { return x.filter(fin).length; };
    var dist = null;
    if (nonNull(st.distance) > n / 2) { dist = locfNocb(st.distance); for (var i = 1; i < n; i++) if (dist[i] < dist[i - 1]) dist[i] = dist[i - 1]; }
    var hasPw = disc === 'Bike' && st.power.filter(function (v) { return v > 0; }).length > 0.5 * n;
    var o = hasPw ? zeros(st.power) : disc === 'Run' && nonNull(st.speed) > n / 2 ? gapSeries(st) : nonNull(st.speed) > n / 2 ? zeros(st.speed) : zeros(st.hr);
    var unit = hasPw ? 'W' : nonNull(st.speed) > n / 2 ? 'm/s' : 'bpm', hr = st.hr;
    // Segment from 0-based inclusive indices [s, e].
    function segFrom(s0, e0, kind) {
      var dur = e0 - s0 + 1, d = dist ? dist[e0] - dist[Math.max(s0 - 1, 0)] : null, hs = hr.slice(s0, e0 + 1);
      return { kind: kind, start: s0, end: e0 + 1, dur: dur, dist: d, out: unit === 'm/s' && d > 0 ? d / dur : mean(o.slice(s0, e0 + 1)), hr: mean(hs), max_hr: max(hs), rest: null, stroke: '' };
    }
    var segs = null, source = '';
    var lapIdx = function () {
      var i1 = laps.map(function (l) { return Math.max(1, countLE(st.t, l.t)); }), i2 = i1.map(function (x, k) { return k < i1.length - 1 ? i1[k + 1] - 1 : n; });
      return { i1: i1, i2: i2 };
    };
    // 1) Structured workout steps from the watch.
    if (laps && laps.length >= 2 && laps.some(function (l) { return ['warmup', 'cooldown', 'rest', 'recovery'].indexOf(l.intensity) >= 0; })) {
      var li = lapIdx(); segs = [];
      laps.forEach(function (l, k) {
        if (!(li.i2[k] > li.i1[k])) return;
        var kind = l.intensity === 'warmup' ? 'Warm-up' : l.intensity === 'cooldown' ? 'Cool-down' : (l.intensity === 'rest' || l.intensity === 'recovery') ? 'Recovery' : 'Work';
        segs.push(segFrom(li.i1[k] - 1, li.i2[k] - 1, kind));
      });
      source = 'workout steps from your watch';
      if (!segs.length) segs = null;
    }
    // 2) Lap-button laps (not automatic distance / time laps).
    if (!segs && laps && laps.filter(function (l) { return l.trigger === 'manual'; }).length >= 3) {
      var lj = lapIdx(), tmp = [];
      laps.forEach(function (l, k) { if (lj.i2[k] - lj.i1[k] >= 10) tmp.push(segFrom(lj.i1[k] - 1, lj.i2[k] - 1, 'Main')); });
      var km = twoMeans(tmp.map(function (x) { return x.out; }));
      if (km && km.hi / km.lo >= 1.12) { var kinds = labelBlocks(tmp.map(function (x) { return x.out >= km.thr; })); tmp.forEach(function (x, q) { x.kind = kinds[q]; }); }
      if (tmp.length) { segs = tmp; source = 'laps you marked with the lap button'; }
    }
    // 3) Steady session: find a slower warm-up and cool-down around the main block.
    if (!segs) {
      var midSlice = o.slice(Math.max(1, Math.floor(n * 0.3)) - 1, Math.max(2, Math.floor(n * 0.7))), mid = median(midSlice);
      var m2 = new Array(n), sAcc = 0;
      for (i = 0; i < n; i++) m2[i] = o[i];
      for (i = 0; i < n; i++) { sAcc += o[i]; if (i >= 120) sAcc -= o[i - 120]; if (i >= 119) m2[i - 60] = sAcc / 120; }
      var wuN = 0, cdN = n, limWu = Math.min(Math.floor(n * 0.3), 1200), thr94 = 0.94 * mid, hitW = -1;
      for (i = 0; i < limWu; i++) if (m2[i] >= thr94) { hitW = i + 1; break; }
      if (hitW >= 180 && m2[0] < thr94) wuN = hitW;
      var tStart = Math.max(wuN + 1, n - Math.min(Math.floor(n * 0.25), 900)), lastHit = -1;
      for (i = tStart; i <= n; i++) if (m2[i - 1] >= thr94) lastHit = i;
      if (lastHit > 0 && n - lastHit >= 180 && m2[n - 1] < thr94) cdN = lastHit;
      segs = [];
      if (wuN > 0) segs.push(segFrom(0, wuN - 1, 'Warm-up'));
      segs.push(segFrom(wuN, cdN - 1, 'Main'));
      if (cdN < n) segs.push(segFrom(cdN, n - 1, 'Cool-down'));
      source = 'detected from your pace/power';
    }
    // Merge back-to-back warm-up / cool-down / steady pieces.
    if (segs.length > 1) {
      var merged = [];
      segs.forEach(function (x, q) {
        var prevS = merged[merged.length - 1];
        if (q > 0 && prevS && x.kind === prevS.kind && ['Warm-up', 'Cool-down', 'Main'].indexOf(x.kind) >= 0) {
          var w = prevS.dur, w2 = x.dur;
          prevS.end = x.end; prevS.dist = (prevS.dist || 0) + (x.dist || 0); prevS.dur = w + w2;
          prevS.out = unit === 'm/s' && prevS.dist > 0 ? prevS.dist / prevS.dur : (prevS.out * w + x.out * w2) / (w + w2);
          prevS.hr = fin(prevS.hr) && fin(x.hr) ? (prevS.hr * w + x.hr * w2) / (w + w2) : or(prevS.hr, x.hr);
          prevS.max_hr = max([prevS.max_hr, x.max_hr]);
        } else merged.push(Object.assign({}, x));
      });
      segs = merged;
    }
    // Splits: every km for runs, 5 km for rides, 500 m for open-water swims.
    var stepD = { Run: 1000, Bike: 5000, Swim: 500 }[disc], splits = null;
    if (stepD && dist && dist[n - 1] >= stepD) {
      var marks = []; for (var mk = stepD; mk <= dist[n - 1]; mk += stepD) marks.push(mk);
      var idx = [0].concat(marks.map(function (x) { return Math.min(countLE(dist, x - 1e-9) + 1, n); }));
      if (dist[n - 1] - marks[marks.length - 1] >= stepD * 0.2) idx.push(n);
      splits = [];
      for (var k2 = 0; k2 < idx.length - 1; k2++) {
        var i1 = idx[k2] + 1, i2 = idx[k2 + 1]; if (i2 <= i1) continue;
        var dd = dist[i2 - 1] - dist[Math.max(i1 - 1, 1) - 1], du = i2 - i1 + 1;
        splits.push({ n: k2 + 1, dist: dd, dur: du, out: dd / du, hr: mean(hr.slice(i1 - 1, i2)), power: hasPw ? mean(o.slice(i1 - 1, i2)) : null });
      }
    }
    var work = segs.filter(function (x) { return x.kind === 'Work'; }), mainS = segs.filter(function (x) { return x.kind === 'Main' || x.kind === 'Work'; });
    var wmean = function (v, w) { var a2 = 0, b2 = 0; v.forEach(function (x, q) { if (fin(x)) { a2 += x * w[q]; b2 += w[q]; } }); return b2 ? a2 / b2 : null; };
    function fmtRep() {
      var wd = median(work.map(function (x) { return x.dur; })), wdist = median(work.map(function (x) { return x.dist; }));
      var rd = [200, 400, 500, 800, 1000, 1200, 1500, 1600, 2000, 3000, 5000];
      if (disc === 'Run' && fin(wdist) && wdist > 150) {
        var near = rd.reduce(function (b, x) { return Math.abs(x - wdist) < Math.abs(b - wdist) ? x : b; });
        if (Math.abs(near - wdist) / near < 0.08) return near >= 1000 ? (near / 1000) + ' km' : near + ' m';
      }
      return wd >= 60 ? fmtDur(Math.round(wd / 15) * 15) : Math.round(wd) + 's';
    }
    var rec2 = segs.filter(function (x) { return x.kind === 'Recovery'; });
    var lab = work.length >= 2 ? sprintf('%d × %s%s', work.length, fmtRep(), rec2.length ? ' (' + fmtDur(Math.round(median(rec2.map(function (x) { return x.dur; })) / 15) * 15) + ' recoveries)' : '')
      : work.length === 1 ? fmtDur(Math.round(work[0].dur / 60) * 60) + ' tempo block' : 'Steady';
    var wuS = segs.filter(function (x) { return x.kind === 'Warm-up'; }), cdS = segs.filter(function (x) { return x.kind === 'Cool-down'; });
    lab = [wuS.length ? 'Warm-up ' + fmtDur(sum(wuS.map(function (x) { return x.dur; }))) : null, lab, cdS.length ? 'Cool-down ' + fmtDur(sum(cdS.map(function (x) { return x.dur; }))) : null].filter(Boolean).join(' · ');
    if (disc === 'Swim') lab = 'Endurance swim: ' + (dist ? fmtThousands(Math.round(dist[n - 1] / 10) * 10) + ' m continuous' : lab);
    return { swim_type: disc === 'Swim' ? 'Endurance' : null, segments: segs, splits: splits, source: source, unit: unit, label: lab,
      rep_label: work.length >= 2 && disc !== 'Swim' ? sprintf('%d × %s', work.length, fmtRep()) : null,
      n_work: work.length >= 2 && disc !== 'Swim' ? work.length : 0, work_dur: work.length ? median(work.map(function (x) { return x.dur; })) : null, work_dist: work.length ? median(work.map(function (x) { return x.dist; })) : null,
      work_out: wmean(work.map(function (x) { return x.out; }), work.map(function (x) { return x.dur; })), work_hr: wmean(work.map(function (x) { return x.hr; }), work.map(function (x) { return x.dur; })),
      main_out: wmean(mainS.map(function (x) { return x.out; }), mainS.map(function (x) { return x.dur; })), main_hr: wmean(mainS.map(function (x) { return x.hr; }), mainS.map(function (x) { return x.dur; })),
      wu_dur: sum(wuS.map(function (x) { return x.dur; })), cd_dur: sum(cdS.map(function (x) { return x.dur; })), total_dist: dist ? dist[n - 1] : null };
  };

  // --- Routes: GPS tracks ([t, lat, lon]) resampled for comparing sessions on the same route ---
  function routeSig(r) {
    if (!r) return null;
    r = r.filter(function (p) { return fin(p[1]) && fin(p[2]) && Math.abs(p[1]) > 0.01; });
    if (r.length < 5) return null;
    var lat0 = mean(r.map(function (p) { return p[1]; })) * Math.PI / 180, d = [0], pts = [r[0]];
    for (var i = 1; i < r.length; i++) {
      var dx = (r[i][2] - pts[pts.length - 1][2]) * 111320 * Math.cos(lat0), dy = (r[i][1] - pts[pts.length - 1][1]) * 110540, step = Math.sqrt(dx * dx + dy * dy);
      if (step > 0) { d.push(d[d.length - 1] + step); pts.push(r[i]); }   // drop repeated fixes (standing still)
    }
    var len = d[d.length - 1], start = [pts[0][1], pts[0][2]];
    if (len < 100 || pts.length < 2) return { start: start, pts: null, len: len };
    var out = [], j = 0;
    for (var k = 0; k < 40; k++) {
      var at = len * k / 39; while (j < d.length - 2 && d[j + 1] < at) j++;
      var f = d[j + 1] > d[j] ? (at - d[j]) / (d[j + 1] - d[j]) : 0;
      out.push([pts[j][1] + f * (pts[j + 1][1] - pts[j][1]), pts[j][2] + f * (pts[j + 1][2] - pts[j][2])]);
    }
    return { start: start, end: [pts[pts.length - 1][1], pts[pts.length - 1][2]], len: len, pts: out };
  }
  A.routeSig = routeSig;
  function geoDist(a, b) { var lat0 = (a[0] + b[0]) / 2 * Math.PI / 180; var x = (a[1] - b[1]) * 111320 * Math.cos(lat0), y = (a[0] - b[0]) * 110540; return Math.sqrt(x * x + y * y); }
  function sameRoute(r1, r2) {
    if (!r1 || !r2 || geoDist(r1.start, r2.start) > 400) return false;
    if (!r1.pts || !r2.pts) return true;
    var dd = function (p, q) { return mean(p.map(function (x, i) { return geoDist(x, q[i]); })); };
    return Math.min(dd(r1.pts, r2.pts), dd(r1.pts, r2.pts.slice().reverse())) <= 250;
  }
  function routeShape(rt) {
    if (!rt || !rt.pts) return '';
    var lat0 = rt.start[0] * Math.PI / 180, dx = rt.pts.map(function (p) { return (p[1] - rt.start[1]) * 111320 * Math.cos(lat0); }), dy = rt.pts.map(function (p) { return (p[0] - rt.start[0]) * 110540; });
    var k = 0; dx.forEach(function (v, i) { if (v * v + dy[i] * dy[i] > dx[k] * dx[k] + dy[k] * dy[k]) k = i; });
    if (Math.sqrt(dx[k] * dx[k] + dy[k] * dy[k]) < 300) return 'laps';
    var dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    var ang = ((Math.atan2(dx[k], dy[k]) * 180 / Math.PI) % 360 + 360) % 360, dir = dirs[Math.round(ang / 45) % 8];
    var closes = rt.end && geoDist(rt.start, rt.end) < 300, n = rt.pts.length, hh = Math.floor(n / 2), mir = [];
    for (var i = 0; i < hh; i++) mir.push(geoDist(rt.pts[i], rt.pts[n - 1 - i]));
    return closes && mean(mir) < 120 ? 'out-and-back to the ' + dir : closes ? 'loop heading ' + dir : 'point-to-point, ' + dir;
  }
  function place(nm) {
    var p = String(nm || '').replace(/\s*[-:]?\s*(open water swimming|pool swim|trail running|road cycling|indoor cycling|running|cycling|swimming|walking|multisport|ride|run|swim)\b.*$/i, '').trim();
    return p || 'Same';
  }

  // Similar sessions: group repeats of the same workout and track how they change. sb: session breakdown rows.
  A.sessionFamilies = function (sb, feats) {
    if (!sb || !sb.length) return { assign: {}, families: [] };
    sb = sb.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var easy = function (t) { return ['Endurance', 'Recovery', 'Grey zone', 'Short'].indexOf(t) >= 0 ? 'Easy' : t; };
    var fam = {}, reps = {}, order = [];
    var ratioOk = function (a, b, lo, hi) { return fin(a) && fin(b) && b > 0 && a / b >= lo && a / b <= hi; };
    sb.forEach(function (row) {
      var f = feats[row.id] || {}, s = f.structure || {}, rt = f.route || null;
      var x = { disc: row.discipline, type: easy(row.type), dur: row.moving_s, unit: s.unit || '', n: s.n_work || 0, wd: or(s.work_dur, null), dist: or(s.total_dist, null),
        env: row.swim_env || '', stype: s.swim_type || 'Endurance', rep_dist: or(s.rep_dist, null), route: rt, has_route: !!(rt && rt.pts), name: row.name };
      if (x.type === 'Easy' && x.disc !== 'Swim') x.n = 0;   // strides in an easy run don't make it an interval session
      if (x.disc === 'Swim') x.n = x.stype === 'Endurance' ? 0 : Math.max(2, x.n);
      var hit = null;
      for (var q = 0; q < order.length && !hit; q++) {
        var r = reps[order[q]];
        if (r.disc !== x.disc || r.unit !== x.unit) continue;
        var ok;
        if (x.disc === 'Swim') ok = x.env === r.env && x.stype === r.stype && ratioOk(x.dist, r.dist, 0.8, 1.25) &&
          (['Tempo', 'Speed'].indexOf(x.stype) < 0 || ratioOk(x.rep_dist, r.rep_dist, 0.6, 1.67)) &&
          (x.env !== 'Open water' || !x.route || !r.route || geoDist(x.route.start, r.route.start) <= 1000);
        else if (x.n >= 2 && r.n >= 2) ok = Math.abs(x.n - r.n) <= Math.max(1, Math.round(0.25 * r.n)) && ratioOk(x.wd, r.wd, 0.7, 1.43);
        else if (x.n < 2 && r.n < 2) ok = x.has_route && r.has_route ? ratioOk(x.dist, r.dist, 0.85, 1.18) && sameRoute(x.route, r.route) : x.type === r.type && ratioOk(x.dur, r.dur, 0.75, 1.33);
        else ok = false;
        if (ok) hit = order[q];
      }
      if (!hit) { hit = 'F' + (order.length + 1); reps[hit] = x; order.push(hit); }
      fam[row.id] = hit;
    });
    var noun = { Run: 'run', Bike: 'ride', Swim: 'swim', Other: 'session' }, families = [];
    var title = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
    order.forEach(function (fid) {
      var m = sb.filter(function (row) { return fam[row.id] === fid; }); if (m.length < 2) return;
      var st = m.map(function (row) { return ((feats[row.id] || {}).structure) || {}; }), r = reps[fid], d = r.disc, isInt = r.n >= 2;
      var out = st.map(function (s) { var v = isInt ? s.work_out : s.main_out; return fin(v) && v > 0 ? v : null; });
      var hrv = st.map(function (s) { return or(isInt ? s.work_hr : s.main_hr, null); });
      var medDist = median(st.map(function (s) { return s.total_dist; })), medDur = median(m.map(function (row) { return row.moving_s; }));
      var rd5 = fmtDur(rhe(medDur / 300) * 300), name;
      if (d === 'Swim') {
        var where = r.env === 'Open water' ? 'Open-water ' : '';
        name = r.stype === 'Tempo' ? where + 'Tempo swim' + (st[0].rep_label ? ': ' + st[0].rep_label : '') : r.stype === 'Speed' ? where + 'Speed swim' + (st[0].rep_label ? ': ' + st[0].rep_label : '')
          : r.stype === 'Mixed' ? where + 'Mixed swim (~' + fmtThousands(rhe(medDist / 100) * 100) + ' m)'
          : (r.env === 'Open water' ? place(r.name) + ' open-water swim' : 'Endurance swim') + ' (~' + fmtThousands(rhe(medDist / 100) * 100) + ' m)';
      } else if (isInt) name = (st[0].rep_label || 'Interval') + ' ' + noun[d] + ' intervals';
      else if (r.has_route) name = place(r.name) + ' ' + (medDist < 20000 ? (rhe(medDist / 100) / 10) : rhe(medDist / 1000)) + ' km ' + noun[d] + ' (' + routeShape(r.route) + ')';
      else name = { 'Long endurance': 'Long ' + noun[d] + ' (~' + rd5 + ')', Threshold: 'Tempo ' + noun[d] + ' (~' + rd5 + ')', Intervals: 'Hard ' + noun[d] + ' (~' + rd5 + ')' }[r.type] || 'Easy ' + noun[d] + ' (~' + rd5 + ')';
      name = title(name.replace(/\s+/g, ' ').trim());
      var eff = out.map(function (v, i) { return fin(v) && fin(hrv[i]) ? v / hrv[i] : null; }), k = out.length;
      var first = k >= 4 ? [0, 1] : [0], last = k >= 4 ? [k - 2, k - 1] : [k - 1], mo = function (v, ix) { return mean(ix.map(function (i) { return v[i]; })); };
      var outCh = fin(mo(out, last)) && fin(mo(out, first)) ? (mo(out, last) / mo(out, first) - 1) * 100 : null;
      var effCh = fin(mo(eff, last)) && fin(mo(eff, first)) ? (mo(eff, last) / mo(eff, first) - 1) * 100 : null, score = fin(effCh) ? effCh : outCh;
      families.push({ id: fid, name: name, sport: d, interval: isInt, n: k, unit: r.unit,
        sessions: m.map(function (row, i) { return { id: row.id, parent_id: row.parent_id, date: row.date, name: row.name, moving_s: row.moving_s, tss: row.tss, out: out[i], hr: hrv[i], eff: eff[i] }; }),
        out_change: outCh, eff_change: effCh, hr_change: fin(mo(hrv, last)) && fin(mo(hrv, first)) ? mo(hrv, last) - mo(hrv, first) : null,
        out_first: mo(out, first), out_last: mo(out, last), hr_first: mo(hrv, first), hr_last: mo(hrv, last),
        verdict: !fin(score) ? 'Not comparable' : score > 2 ? 'Improving' : score < -2 ? 'Slipping' : 'Stable' });
    });
    var names = {}; families.forEach(function (f) { names[f.name] = (names[f.name] || 0) + 1; });
    var seen = {}; families.forEach(function (f) { if (names[f.name] > 1) { seen[f.name] = (seen[f.name] || 0) + 1; f.name += ', route ' + 'ABCDEFGHIJ'.charAt(seen[f.name] - 1); } });
    return { assign: fam, families: families };
  };
  // An output value (m/s or W) for display.
  A.fmtOut = function (v, disc, unit) {
    if (!fin(v)) return '–';
    if (unit === 'W') return Math.round(v) + ' W';
    if (unit === 'bpm') return Math.round(v) + ' bpm';
    if (disc === 'Run') return fmtPace(1000 / v) + ' /km';
    if (disc === 'Swim') return fmtPace(100 / v) + ' /100 m';
    if (disc === 'Bike') return (v * 3.6).toFixed(1) + ' km/h';
    return v.toFixed(2);
  };

  A.discFor = function (sport) {
    var k = String(sport || '').toLowerCase();
    if (k.indexOf('transition') >= 0) return 'Transition';
    if (k.indexOf('swim') >= 0) return 'Swim';
    if (k.indexOf('run') >= 0) return 'Run';
    if (/cycl|bik|ride/.test(k)) return 'Bike';
    return 'Other';
  };
  function swimEnv(key) { key = String(key || '').toLowerCase(); return /open.?water/.test(key) ? 'Open water' : key.indexOf('swim') >= 0 ? 'Pool' : null; }

  // One activity's features: the whole file, and each leg of a multisport file.
  A.activityFeatures = function (a, raw) {
    var disc = A.discFor(a.type), rec = { id: a.id, v: A.FEATURE_VERSION, f: null, legs: null };
    var st = A.cleanStream(raw, disc), meta = { discipline: disc, pool_length_m: a.pool_m };
    rec.f = st ? A.streamFeatures(st, disc) : { moving_s: null };
    if (raw && raw.lengths && raw.lengths.length) rec.f.lengths = raw.lengths.map(function (l) { return l.dur; });
    if (!(raw && raw.legs && raw.legs.length > 1)) {
      try { rec.f.structure = A.sessionStructure(st, meta, raw && raw.laps, raw && raw.lengths); } catch (e) { rec.f.structure = null; }
      rec.f.route = routeSig(raw && raw.route);
    }
    var legs = (raw && raw.legs) || [];
    if (legs.length > 1) {
      var core = legs.filter(function (l) { var d = A.discFor(l.sport); return d === 'Swim' || d === 'Bike' || d === 'Run'; });
      if (core.length >= 2) rec.legs = legs.map(function (l, k) {
        var d = A.discFor(l.sport), el = num(l.elapsed_s) || num(l.timer_s) || 0;
        var x = { k: k + 1, disc: d, sport: l.sport, sub_sport: l.sub_sport || '', start: l.start || 0, timer_s: num(l.timer_s), elapsed_s: el,
          distance_m: num(l.distance_m), avg_hr: num(l.avg_hr), avg_power: num(l.avg_power), np: num(l.np) };
        if (d === 'Swim' || d === 'Bike' || d === 'Run') {
          var t0 = x.start, t1 = x.start + el, ls = A.cleanStream(raw, d, t0, t1), inLeg = function (q) { return q.t >= t0 - 1 && q.t < t1; };
          x.f = ls ? A.streamFeatures(ls, d) : { moving_s: null };
          try { x.f.structure = A.sessionStructure(ls, { discipline: d, pool_length_m: a.pool_m }, (raw.laps || []).filter(inLeg), (raw.lengths || []).filter(function (q) { return q.t >= t0 && q.t < t1; })); } catch (e) { x.f.structure = null; }
          x.f.route = routeSig((raw.route || []).filter(function (q) { return q[0] >= t0 && q[0] < t1; }));
        }
        return x;
      });
    }
    return rec;
  };

  // ===========================================================================
  // Activity index: Garmin summaries, multisport files split into one row per leg
  // ===========================================================================
  function shiftLocal(start, secs) {
    var t = Date.parse(String(start).replace(' ', 'T') + 'Z'); if (!isFinite(t)) return start;
    return new Date(t + secs * 1000).toISOString().replace('T', ' ').slice(0, 19);
  }
  // acts: stored summaries; frecs: { id: feature record }. Returns { idx, feats, transitions }.
  A.buildIndex = function (acts, frecs) {
    var idx = [], feats = {}, trans = {};
    acts.forEach(function (a) {
      if (!a.date) return;
      var disc = A.discFor(a.type), fr = frecs[a.id];
      var row = { id: a.id, name: a.name || a.type, type_key: a.type || '', discipline: disc, sport: a.sport, date: a.date, start_local: a.start,
        duration_s: a.duration_s, moving_s: a.moving_s, distance_m: a.distance_m, elev_gain_m: a.elev_m, avg_hr: a.avg_hr, max_hr: a.max_hr,
        avg_power: a.avg_power, np: a.np, garmin_tss: a.tss, vo2max: a.vo2max, aerobic_te: a.aerobic_te, anaerobic_te: a.anaerobic_te,
        pool_length_m: a.pool_m, swim_env: disc === 'Swim' ? swimEnv(a.type) : null, parent_id: null, group_label: null };
      if (fr && fr.legs) {
        // Garmin records triathlons, duathlons and bricks as one multisport activity: one row per swim / bike / run leg.
        var core = fr.legs.filter(function (l) { return l.disc === 'Swim' || l.disc === 'Bike' || l.disc === 'Run'; }).map(function (l) { return l.disc; });
        var label = core.indexOf('Swim') >= 0 && core.indexOf('Bike') >= 0 && core.indexOf('Run') >= 0 ? 'Triathlon'
          : core.length === 2 && core[0] === 'Bike' && core[1] === 'Run' ? 'Brick'
          : core.indexOf('Bike') >= 0 && core.indexOf('Run') >= 0 && core.indexOf('Swim') < 0 ? 'Duathlon' : 'Multisport';
        var t0 = min(fr.legs.map(function (l) { return l.start; })) || 0;
        trans[a.id] = fr.legs.filter(function (l) { return l.disc === 'Transition'; }).map(function (l, i) { return { label: 'T' + (i + 1), seconds: l.elapsed_s || l.timer_s || 0 }; });
        fr.legs.forEach(function (l) {
          if (!(l.disc === 'Swim' || l.disc === 'Bike' || l.disc === 'Run')) return;
          var sub = String(l.sub_sport || '').toLowerCase(), key = l.disc === 'Swim' ? (/open.?water/.test(sub) ? 'open_water_swimming' : 'lap_swimming') : l.disc === 'Bike' ? (/indoor|virtual|trainer/.test(sub) ? 'indoor_cycling' : 'cycling') : 'running';
          var leg = Object.assign({}, row, { id: a.id + '_leg' + l.k, parent_id: a.id, group_label: label, discipline: l.disc, type_key: key, swim_env: l.disc === 'Swim' ? swimEnv(key) : null,
            name: row.name + ' – ' + l.disc, start_local: shiftLocal(a.start, l.start - t0), moving_s: l.timer_s, duration_s: l.elapsed_s, distance_m: l.distance_m,
            avg_hr: l.avg_hr, max_hr: null, elev_gain_m: null, avg_power: l.disc === 'Bike' ? l.avg_power : null, np: l.disc === 'Bike' ? l.np : null,
            garmin_tss: null, vo2max: null });
          leg.date = leg.start_local.slice(0, 10);
          idx.push(leg); if (l.f) feats[leg.id] = l.f;
        });
        return;
      }
      idx.push(row); if (fr) feats[a.id] = fr.f;
    });
    idx.sort(function (x, y) { return x.start_local < y.start_local ? -1 : x.start_local > y.start_local ? 1 : 0; });
    return { idx: idx, feats: feats, transitions: trans };
  };

  // ===========================================================================
  // Athlete thresholds
  // ===========================================================================
  function cpModel(durs, vals, lo, hi) {
    lo = lo || 120; hi = hi || 1200;
    var t = [], w = [];
    durs.forEach(function (d, i) { if (fin(vals[i]) && d >= lo && d <= hi) { t.push(d); w.push(vals[i] * d); } });
    if (t.length < 3) return null;
    var f = lm(t, w); if (!f || !(f.b > 0) || !(f.a > 0)) return null;
    return { cp: f.b, w_prime: f.a, r2: f.r2 };
  }
  A.cpModel = cpModel;
  function colMax(list, n) { var out = new Array(n).fill(null); list.forEach(function (v) { if (v) v.forEach(function (x, i) { if (fin(x) && (out[i] === null || x > out[i])) out[i] = x; }); }); return out; }

  // gp: Garmin's profile settings (lthr, ftp, lt_speed, gender); overrides: values the athlete set.
  A.estimateProfile = function (idx, feats, gp, wellness, overrides) {
    gp = gp || {}; overrides = overrides || {};
    var src = {}, F = function (r) { return feats[r.id] || {}; };
    var hr5 = idx.map(function (r) { return F(r).max_hr5; }).filter(fin);
    var hrmax = hr5.length ? max(hr5) : (idx.some(function (r) { return fin(r.max_hr); }) ? quantile(col(idx, 'max_hr'), 0.98) : 190);
    src.hrmax = hr5.length ? 'highest 5-s HR in your data' : 'default';

    var lthr = num(gp.lthr);
    if (lthr && lthr > 100) src.lthr = 'Garmin lactate threshold';
    else {
      var hr20 = idx.map(function (r) { return F(r).hr20; }).filter(fin);
      lthr = hr20.length ? max(hr20) : 0.89 * hrmax;
      lthr = Math.min(Math.max(lthr, 0.85 * hrmax), 0.93 * hrmax);
      src.lthr = hr20.length ? 'best 20-min HR (bounded 85-93% HRmax)' : '89% of HRmax';
    }

    var bikes = idx.filter(function (r) { return r.discipline === 'Bike'; });
    var mmps = bikes.map(function (r) { return F(r).mmp; }).filter(Boolean);
    var ftp = num(gp.ftp);
    if (ftp && ftp > 50) src.ftp = 'Garmin FTP';
    else if (mmps.length) {
      var best = colMax(mmps, MMP_D.length), cp = cpModel(MMP_D, best), p20 = best[MMP_D.indexOf(1200)];
      if (cp && cp.r2 > 0.95) { ftp = 0.97 * cp.cp; src.ftp = '97% of modelled critical power'; }
      else if (fin(p20)) { ftp = 0.95 * p20; src.ftp = '95% of best 20-min power'; }
      else { ftp = 200; src.ftp = 'default'; }
      // Nobody holds NP above FTP for over an hour, so long rides set a floor.
      var npLong = max(bikes.filter(function (r) { return (F(r).moving_s || 0) >= 3600; }).map(function (r) { return F(r).np; }));
      if (fin(npLong) && npLong > ftp) { ftp = npLong; src.ftp = 'highest NP held for 60+ min'; }
    } else { ftp = 200; src.ftp = 'default (no power data)'; }
    // Every hard effort sets a floor, races included: P(t) = FTP (t / 1 h)^-0.07, so FTP >= P (t / 1 h)^0.07.
    if (mmps.length) {
      var fl = null;
      mmps.forEach(function (m) { MMP_D.forEach(function (d, i) { if (d >= 1200 && fin(m[i])) { var v = m[i] * Math.pow(d / 3600, 0.07); if (fl === null || v > fl) fl = v; } }); });
      if (fin(fl) && fl > ftp) { ftp = fl; src.ftp = 'your best 20+ min power efforts'; }
    }

    var lts = num(gp.lt_speed), thr;
    if (lts && lts > 0 && lts < 1.5) lts *= 10;   // Garmin stores LT speed in 0.1 m/s units in some regions
    var runs = idx.filter(function (r) { return r.discipline === 'Run'; }), rmats = runs.map(function (r) { return F(r).mmp_speed; }).filter(Boolean);
    if (lts && lts > 2 && lts < 7) { thr = lts; src.thr_speed = 'Garmin lactate threshold pace'; }
    else if (rmats.length) {
      var rb = colMax(rmats, RUN_D.length), cs = cpModel(RUN_D, rb, 180, 1200), s30 = rb[RUN_D.indexOf(1800)];
      if (cs && cs.r2 > 0.95 && cs.cp > 2) { thr = 0.97 * cs.cp; src.thr_speed = '97% of modelled critical speed'; }
      else if (fin(s30)) { thr = 0.97 * s30; src.thr_speed = '97% of best 30-min pace'; }
      else { thr = 1000 / 270; src.thr_speed = 'default'; }
    } else { thr = 1000 / 270; src.thr_speed = 'default (no run data)'; }
    // Riegel 1.06 => speed ~ t^-0.057: best 20-60 min stretches and whole runs of 20 min+ set a floor.
    var rfl = [];
    rmats.forEach(function (m) { RUN_D.forEach(function (d, i) { if (d >= 1200 && fin(m[i])) rfl.push(m[i] * Math.pow(d / 3600, 0.057)); }); });
    runs.forEach(function (r) { if (fin(r.distance_m) && fin(r.moving_s) && r.moving_s >= 1200) rfl.push((r.distance_m / r.moving_s) * Math.pow(r.moving_s / 3600, 0.057)); });
    var rf = max(rfl);
    if (fin(rf) && rf > thr && rf < 7) { thr = rf; src.thr_speed = 'your best 20+ min run efforts'; }

    // CSS: a continuous swim of 1000 m+ is swum just slower than CSS. Last 16 weeks when there's enough.
    var lastDate = idx.length ? idx[idx.length - 1].date : TP.today();
    var sw = idx.filter(function (r) { return r.discipline === 'Swim' && fin(r.distance_m) && r.distance_m >= 400 && r.moving_s > 0; });
    if (sw.some(function (r) { return r.swim_env === 'Pool'; })) sw = sw.filter(function (r) { return r.swim_env === 'Pool'; });
    var recent = sw.filter(function (r) { return r.date >= addDays(lastDate, -112); });
    if (recent.length >= 3) sw = recent;
    // A continuous swim of 1000 m+ is swum just slower than CSS; a hard set of 400 m+ a little faster. Fastest wins.
    var css = null, cand = [], longS = sw.filter(function (r) { return r.distance_m >= 1000; });
    if (longS.length) cand.push([max(longS.map(function (r) { return r.distance_m / r.moving_s; })) * 1.02, 'your fastest recent continuous swim of 1000 m+']);
    var setV = [];
    sw.forEach(function (r) { var g = ((feats[r.id] || {}).structure || {}).segments; if (g && g.some(function (x) { return 'stroke' in x && x.stroke !== ''; })) g.forEach(function (x) { if (x.dist >= 400 && x.dur > 0) setV.push(x.dist / x.dur); }); });
    if (setV.length) cand.push([max(setV) * 0.97, 'your fastest recent 400 m+ set']);
    if (cand.length) { var bc = cand.reduce(function (a, b) { return b[0] > a[0] ? b : a; }); css = bc[0]; src.css = bc[1]; }
    else if (sw.length) { css = max(sw.map(function (r) { return r.distance_m / r.moving_s; })); src.css = 'your fastest recent swim'; }
    else { css = 100 / 120; src.css = 'default (no swim data)'; }

    var rhr = (wellness || []).map(function (w) { return w.rhr; }).filter(fin);
    var hrrest = rhr.length >= 7 ? median(rhr.slice(-60)) : 50;
    src.hrrest = rhr.length >= 7 ? 'Garmin resting HR, last 60 nights' : 'default';

    // Personal open-water gap: medians of recent open-water vs pool swims.
    var all = idx.filter(function (r) { return r.discipline === 'Swim' && r.distance_m >= 500 && r.moving_s > 0 && r.date >= addDays(lastDate, -112); });
    var ow = all.filter(function (r) { return r.swim_env === 'Open water'; }), pool = all.filter(function (r) { return r.swim_env === 'Pool'; });
    var owf = OW_FACTOR; src.ow = sprintf('typical open-water slowdown (%.0f%%)', (1 / OW_FACTOR - 1) * 100);
    if (ow.length >= 2 && pool.length >= 2) {
      owf = Math.min(1, Math.max(0.8, median(ow.map(function (r) { return r.distance_m / r.moving_s; })) / median(pool.map(function (r) { return r.distance_m / r.moving_s; }))));
      src.ow = sprintf('your %d recent open-water swims vs %d pool swims', ow.length, pool.length);
    }

    var prof = { hrmax: Math.round(hrmax), hrrest: Math.round(hrrest), lthr: Math.round(lthr), ftp: Math.round(ftp), ow_factor: owf,
      thr_pace_s_km: Math.round(1000 / thr), css_s_100: Math.round(100 / css), gender: String(gp.gender || 'MALE').toUpperCase(), sources: src };
    ['hrmax', 'hrrest', 'lthr', 'ftp', 'thr_pace_s_km', 'css_s_100'].forEach(function (k) {
      var v = num(overrides[k]); if (v && v > 0) { prof[k] = v; src[{ thr_pace_s_km: 'thr_speed', css_s_100: 'css' }[k] || k] = 'set by you'; }
    });
    if (overrides.gender) prof.gender = overrides.gender;
    return prof;
  };

  // ===========================================================================
  // Per-activity scoring
  // ===========================================================================
  function trimpPerMin(hr, prof) {
    var k = prof.gender === 'FEMALE' ? 1.67 : 1.92, hrr = Math.min(Math.max((hr - prof.hrrest) / (prof.hrmax - prof.hrrest), 0), 1);
    return hrr * 0.64 * Math.exp(k * hrr);
  }
  function hrtss(hist, prof) { var t = 0; hist.forEach(function (c, i) { t += c / 60 * trimpPerMin(i + 1, prof); }); return t / (60 * trimpPerMin(prof.lthr, prof)) * 100; }
  function zoneSecs(hist, upper, cuts) {
    var out = new Array(cuts.length + 1).fill(0);
    hist.forEach(function (c, i) { var u = upper(i), z = 0; while (z < cuts.length && u >= cuts[z]) z++; out[z] += c; });
    return out;
  }
  function intervalOf(v, cuts) { var z = 0; while (z < cuts.length && v >= cuts[z]) z++; return z; }

  A.score = function (idx, feats, prof) {
    var ftp = prof.ftp, thr = 1000 / prof.thr_pace_s_km, css = 100 / prof.css_s_100;
    return idx.map(function (a) {
      var f = feats[a.id] || {}, disc = a.discipline;
      var moving = or(a.moving_s, or(f.moving_s, a.duration_s)), hours = (moving || 0) / 3600;
      var r = Object.assign({}, a, { tss: null, tss_method: '', intensity: null, ef: or(f.ef, null), decoupling: null, vi: null, ngp_s_km: null,
        z1: 0, z2: 0, z3: 0, hz: [0, 0, 0, 0, 0], streams: fin(f.moving_s) });
      if (disc !== 'Bike' || !fin(r.np)) r.np = null;
      var hist = f.hr_hist, z = null;
      if (hist) r.hz = zoneSecs(hist, function (i) { return i + 1; }, [0.85, 0.9, 0.95, 1].map(function (x) { return prof.lthr * x; }));
      if (disc === 'Bike' && f.has_power) {
        r.np = f.np; r.intensity = f.np / ftp; r.vi = f.np / f.avg_power;
        r.tss = hours * r.intensity * r.intensity * 100; r.tss_method = 'TSS (power)';
        z = zoneSecs(f.power_hist, function (i) { return (i + 1) * 5; }, [0.75 * ftp, ftp]);
      } else if (disc === 'Bike' && a.np > 0) {
        r.np = a.np; r.intensity = a.np / ftp; r.tss = hours * r.intensity * r.intensity * 100; r.tss_method = 'TSS (power, summary)';
      } else if (disc === 'Run' && f.has_speed) {
        r.ngp_s_km = 1000 / f.ngp; r.intensity = f.ngp / thr;
        r.tss = hours * r.intensity * r.intensity * 100; r.tss_method = 'rTSS (grade-adjusted pace)';
        if (!hist) z = zoneSecs(f.speed_hist, function (i) { return (i + 1) * 0.05; }, [0.88 * thr, thr]);
      } else if (disc === 'Swim' && a.distance_m > 0 && hours > 0) {
        var spd = a.distance_m / moving;
        r.intensity = spd / (css * (a.swim_env === 'Open water' ? or(prof.ow_factor, OW_FACTOR) : 1));
        r.tss = hours * Math.pow(r.intensity, 3) * 100; r.tss_method = 'sTSS (pace vs CSS)';
        var lens = f.lengths, pool = a.pool_length_m; if (pool > 100) pool /= 100;
        if (lens && lens.length > 4 && pool > 0) {
          z = [0, 0, 0];
          lens.forEach(function (d) { var ls = pool / Math.max(d, 1); z[ls < css * 0.9 ? 0 : ls <= css ? 1 : 2] += d; });
        } else { z = [0, 0, 0]; z[intervalOf(r.intensity, [0.93, 1])] = moving; }
      }
      if (!fin(r.tss)) {
        if (hist) { r.tss = hrtss(hist, prof); r.tss_method = 'hrTSS (TRIMP)'; }
        else if (fin(a.garmin_tss)) { r.tss = a.garmin_tss; r.tss_method = 'Garmin TSS'; }
        else if (fin(a.avg_hr) && hours > 0) { r.tss = hours * 60 * trimpPerMin(a.avg_hr, prof) / (60 * trimpPerMin(prof.lthr, prof)) * 100; r.tss_method = 'hrTSS (avg HR estimate)'; }
        else { r.tss = hours * 40; r.tss_method = 'estimated (duration only)'; }
        if (!fin(r.intensity) && fin(a.avg_hr)) r.intensity = a.avg_hr / prof.lthr;
      }
      // Seiler 3-zone model: power for bikes, HR wherever we have it, pace otherwise.
      if (!z && hist) z = zoneSecs(hist, function (i) { return i + 1; }, [0.89 * prof.lthr, prof.lthr]);
      if (!z) { z = [0, 0, 0]; z[intervalOf(or(r.intensity, 0.7), [0.85, 1])] = moving || 0; }
      r.z1 = z[0]; r.z2 = z[1]; r.z3 = z[2];
      var eh = f.eff_halves;
      if (eh && fin(eh[0]) && fin(eh[1]) && eh[0] > 0) r.decoupling = (eh[0] - eh[1]) / eh[0] * 100;
      r.moving_s = moving;
      r.tss = Math.min(r.tss, 600);
      r.km = fin(a.distance_m) ? a.distance_m / 1000 : 0;
      r.hours = fin(moving) ? moving / 3600 : 0;
      r.week = weekStart(a.date);
      r.coach_note = activityNote(r);
      return r;
    });
  };
  function activityNote(a) {
    var n = [], mins = a.hours * 60, tot = a.z1 + a.z2 + a.z3;
    if (fin(a.intensity)) n.push(sprintf('IF %.2f (%s)', a.intensity, a.intensity < 0.75 ? 'recovery/endurance' : a.intensity < 0.85 ? 'aerobic endurance' : a.intensity < 0.95 ? 'tempo / sweet-spot' : a.intensity < 1.05 ? 'threshold' : 'above-threshold'));
    if (fin(a.decoupling) && mins >= 60 && fin(a.intensity) && a.intensity < 0.88)
      n.push(a.decoupling < -5 ? sprintf('decoupling %.1f%%: output rose relative to HR (uneven pacing or late surge)', a.decoupling)
        : a.decoupling < 5 ? sprintf('decoupling %.1f%%: aerobically durable', a.decoupling) : sprintf('decoupling %.1f%%: aerobic endurance limiter at this duration', a.decoupling));
    if (fin(a.vi) && a.vi > 1.1 && a.intensity < 0.9) n.push(sprintf('VI %.2f: surgy pacing', a.vi));
    if (tot > 0 && a.z2 / tot > 0.4 && fin(a.intensity) && a.intensity < 0.9) n.push(sprintf("%.0f%% in Z2 'grey zone'", a.z2 / tot * 100));
    if (tot > 0 && a.z3 >= 600) n.push(sprintf('%.0f min above threshold: key session', a.z3 / 60));
    if (fin(a.anaerobic_te) && a.anaerobic_te >= 3) n.push(sprintf('anaerobic TE %.1f', a.anaerobic_te));
    return n.join('; ');
  }

  // ===========================================================================
  // Load model: CTL (42-day fitness), ATL (7-day fatigue), TSB (form) for each day from..to
  // ===========================================================================
  A.loadModel = function (acts, from, to) {
    if (!acts.length) return [];
    var tss = {}, firstAct = null;
    acts.forEach(function (a) { tss[a.date] = (tss[a.date] || 0) + (a.tss || 0); if (!firstAct || a.date < firstAct) firstAct = a.date; });
    var first = from < firstAct ? from : firstAct;
    // Start from the typical daily load of the first four weeks of data rather than zero, so a history that
    // begins mid-training doesn't read as weeks of sudden load spikes (fitness ~0, fatigue rising fast).
    // Before the first activity nothing is known, so load is held there and no spikes are counted.
    var seed = 0, end28 = addDays(firstAct, 27);
    Object.keys(tss).forEach(function (d) { if (d >= firstAct && d <= end28) seed += tss[d]; });
    seed /= 28;
    var out = [], c = seed, at = seed, prev = 0, ctlHist = [];
    for (var d = first; d <= to; d = addDays(d, 1)) {
      var known = d >= firstAct, t = tss[d] || 0;
      if (known) { c += (t - c) / 42; at += (t - at) / 7; }
      ctlHist.push(c);
      var row = { date: d, tss: t, ctl: c, atl: at, tsb: prev, ramp: known && ctlHist.length > 7 && addDays(d, -7) >= firstAct ? c - ctlHist[ctlHist.length - 8] : null,
        acwr: known && c > 10 ? at / c : null, week: weekStart(d) };
      prev = c - at;
      if (d >= from) out.push(row);
    }
    return out;
  };

  A.weekly = function (acts, load) {
    if (!acts.length) return [];
    var w = {}, get = function (k) { return w[k] = w[k] || { week: k, long_run_km: null, long_ride_h: null, key_sessions: 0, sessions: 0, hours: 0, km: 0, tss: 0, z1: 0, z2: 0, z3: 0, load: null, monotony: null, strain: null }; };
    acts.forEach(function (a) {
      var x = get(a.week);
      if (a.discipline === 'Run' && (x.long_run_km === null || a.km > x.long_run_km)) x.long_run_km = a.km;
      if (a.discipline === 'Bike' && (x.long_ride_h === null || a.hours > x.long_ride_h)) x.long_ride_h = a.hours;
      if (a.z3 >= 600 || (fin(a.intensity) && a.intensity >= 0.95 && a.hours >= 0.4)) x.key_sessions++;
      x.sessions++; x.hours += a.hours; x.km += a.km; x.tss += a.tss || 0; x.z1 += a.z1; x.z2 += a.z2; x.z3 += a.z3;
    });
    var lw = by(load, 'week');
    Object.keys(lw).forEach(function (k) {
      var t = col(lw[k], 'tss'), x = get(k), s = sd(t);
      x.load = sum(t); x.monotony = s > 0 ? mean(t) / s : null; x.strain = fin(x.monotony) ? x.load * x.monotony : null; x.days = t.length;
    });
    return Object.keys(w).sort().map(function (k) { return w[k]; });
  };

  // Intensity distribution (Treff et al. 2019 Polarization Index).
  A.distribution = function (z1, z2, z3) {
    var tot = z1 + z2 + z3;
    if (tot <= 0) return { p1: null, p2: null, p3: null, pi: null, type: 'No data' };
    var p = [z1 / tot * 100, z2 / tot * 100, z3 / tot * 100];
    var pi = p[0] > p[2] && p[2] > p[1] && p[2] > 0 ? Math.log10((p[0] / Math.max(p[1], 0.1)) * p[2]) : null;
    var type = fin(pi) && pi > 2 ? 'Polarized' : p[0] >= 90 ? 'Base / low-intensity focus' : p[0] > p[1] && p[1] > p[2] ? 'Pyramidal'
      : p[1] >= p[0] && p[1] >= p[2] ? 'Threshold-focused' : p[2] >= p[0] ? 'High-intensity focused' : 'Pyramidal';
    return { p1: p[0], p2: p[1], p3: p[2], pi: pi, type: type };
  };
  function distOf(acts) { return A.distribution(sum(col(acts, 'z1')), sum(col(acts, 'z2')), sum(col(acts, 'z3'))); }

  // Best power / pace curves for the whole period and each half.
  function curve(acts, feats, disc, field, durs, mid) {
    var sel = acts.filter(function (a) { return a.discipline === disc; });
    if (!sel.length) return null;
    var best = function (rows) { return colMax(rows.map(function (a) { return (feats[a.id] || {})[field]; }).filter(Boolean), durs.length); };
    var all = best(sel), first = best(sel.filter(function (a) { return a.date < mid; })), second = best(sel.filter(function (a) { return a.date >= mid; }));
    if (!all.some(fin)) return null;
    return durs.map(function (d, i) { return { duration: d, all: all[i], first: first[i], second: second[i] }; });
  }
  function bestEfforts(acts, feats) {
    var runs = acts.filter(function (a) { return a.discipline === 'Run' && (feats[a.id] || {}).best_dist; });
    if (!runs.length) return null;
    var out = [];
    BEST.forEach(function (b, j) {
      var bestT = null, who = null;
      runs.forEach(function (a) { var t = feats[a.id].best_dist[j]; if (fin(t) && (bestT === null || t < bestT)) { bestT = t; who = a; } });
      if (who) out.push({ distance: b[0], meters: b[1], time_s: bestT, pace: fmtPace(bestT / (b[1] / 1000)), date: who.date, activity: who.name, id: who.id });
    });
    return out.length ? out : null;
  }
  // Riegel: exponent 1.06 up to the half marathon, 1.07 beyond it.
  function riegel(t1, d1, d2) {
    var hm = 21097.5;
    if (d2 <= hm || d1 >= hm) return t1 * Math.pow(d2 / d1, d1 >= hm ? 1.07 : 1.06);
    return t1 * Math.pow(hm / d1, 1.06) * Math.pow(d2 / hm, 1.07);
  }
  // Candidates: the critical speed model plus Riegel from every real best effort of 3 km or more; fastest wins.
  A.predictRun = function (dm, cs, best) {
    var c = [];
    if (cs && cs.cp > 2) {
      var t10 = (10000 - cs.w_prime) / (cs.cp * 0.985);
      var t = dm <= 10000 ? (dm - cs.w_prime) / (cs.cp * (dm > 5000 ? 0.985 : 1)) : dm <= 21100 ? t10 * Math.pow(dm / 10000, 1.06) : t10 * Math.pow(21097.5 / 10000, 1.06) * Math.pow(dm / 21097.5, 1.07);
      c.push({ time_s: t, method: dm <= 10000 ? 'Critical speed model' : 'Riegel from CS-based 10K' });
    }
    (best || []).filter(function (b) { return b.meters >= 3000; }).forEach(function (b) {
      c.push({ time_s: riegel(b.time_s, b.meters, dm), method: Math.abs(dm - b.meters) < 1 ? 'Actual best ' + b.distance : 'Riegel from best ' + b.distance });
    });
    c = c.filter(function (x) { return fin(x.time_s) && x.time_s > 0; });
    if (!c.length) return { time_s: null, method: '' };
    return c.sort(function (a, b) { return a.time_s - b.time_s; })[0];
  };
  function predictions(cs, best) {
    return [['5 km', 5000], ['10 km', 10000], ['Half', 21097.5], ['Marathon', 42195]].map(function (t) {
      var p = A.predictRun(t[1], cs, best); return { distance: t[0], time_s: p.time_s, method: p.method, pace: fmtPace(p.time_s / (t[1] / 1000)) };
    });
  }
  function efTrend(acts) {
    var aer = acts.filter(function (a) { return fin(a.ef) && a.hours >= 0.5 && fin(a.intensity) && a.intensity < 0.85 && (a.discipline === 'Run' || a.discipline === 'Bike'); });
    var trends = [];
    ['Run', 'Bike'].forEach(function (d) {
      var x = aer.filter(function (a) { return a.discipline === d; });
      var dates = {}; x.forEach(function (a) { dates[a.date] = 1; });
      if (x.length < 4 || Object.keys(dates).length < 2) return;
      var f = lm(x.map(function (a) { return dnum(a.date); }), col(x, 'ef')); if (!f) return;
      var m = mean(col(x, 'ef'));
      trends.push({ discipline: d, n: x.length, slope: f.b, mean_ef: m, pct_per_4wk: f.b * 28 / m * 100 });
    });
    return { data: aer, trends: trends };
  }

  // ===========================================================================
  // Full analysis + coach's report for a period. compliance: optional (planned sessions vs links).
  // ===========================================================================
  A.analyse = function (scored, feats, prof, from, to, compliance) {
    var load = A.loadModel(scored, from, to);
    var acts = scored.filter(function (a) { return a.date >= from && a.date <= to && a.discipline !== 'Transition'; });
    if (!acts.length) return { empty: true, from: from, to: to };
    var mid = addDays(from, Math.floor(days(from, to) / 2));
    var pc = curve(acts, feats, 'Bike', 'mmp', MMP_D, mid), sc = curve(acts, feats, 'Run', 'mmp_speed', RUN_D, mid);
    var cp = pc ? cpModel(col(pc, 'duration'), col(pc, 'all')) : null, cs = sc ? cpModel(col(sc, 'duration'), col(sc, 'all'), 180, 1200) : null;
    var best = bestEfforts(acts, feats);
    var ds = {}; acts.forEach(function (a) { var x = ds[a.discipline] = ds[a.discipline] || { discipline: a.discipline, z1: 0, z2: 0, z3: 0 }; x.z1 += a.z1; x.z2 += a.z2; x.z3 += a.z3; });
    var r = { empty: false, from: from, to: to, mid: mid, prof: prof, acts: acts, load: load, weekly: A.weekly(acts, load),
      dist_all: distOf(acts), dist_sport: Object.keys(ds).map(function (k) { return ds[k]; }), pcurve: pc, scurve: sc, cp_fit: cp, cs_fit: cs,
      best_efforts: best, predictions: predictions(cs, best), ef: efTrend(acts), compliance: compliance || null };
    r.insights = insights(r);
    return r;
  };

  function insights(r) {
    var out = [], add = function (cat, sev, title, detail, action) { out.push({ category: cat, severity: sev, title: title, detail: detail, action: action || '' }); };
    var load = r.load, wk = r.weekly, acts = r.acts, nWeeks = Math.max(1, (days(r.from, r.to) + 1) / 7);
    if (load.length > 1) {
      var c0 = load[0].ctl, c1 = load[load.length - 1].ctl, delta = c1 - c0;
      add('Fitness', delta > 3 ? 'good' : delta < -3 ? 'watch' : 'info', sprintf('Chronic training load (fitness) %s %.0f → %.0f', delta >= 0 ? 'rose' : 'fell', c0, c1),
        sprintf('CTL changed by %+.1f TSS/day over %.0f weeks (%+.1f per week). CTL is the 42-day weighted average of daily training stress, the best single proxy for endurance fitness.', delta, nWeeks, delta / nWeeks),
        delta < 0 ? 'If this period was not a planned taper or off-season, rebuild load gradually: aim for +3-5 CTL per week.' : '');
      var ramps = load.filter(function (d) { return fin(d.ramp); });
      if (ramps.length) {
        var pkRow = ramps.reduce(function (a, b) { return b.ramp > a.ramp ? b : a; }), pk = pkRow.ramp;
        if (pk > 8) add('Load management', 'risk', sprintf('Ramp rate peaked at %+.1f CTL/week (%s)', pk, TP.fmt(pkRow.date, '%d %b')),
          'Ramp rates above ~8 CTL/week are associated with sharply higher injury, illness and non-functional overreaching risk.', 'Cap planned increases at 5-7 CTL/week and follow spikes with a lighter week.');
        else if (pk > 5) add('Load management', 'watch', sprintf('Aggressive but tolerable ramp: peak %+.1f CTL/week', pk), '5-8 CTL/week is a productive build rate for experienced athletes but is hard to sustain for more than 3-4 weeks.');
        else if (pk > 2) add('Load management', 'good', sprintf('Controlled progression: peak ramp %+.1f CTL/week', pk), 'Load rose within the 2-5 CTL/week range that most coaches regard as sustainable.');
      }
      var hi = load.filter(function (d) { return d.acwr > 1.5; }).length, midN = load.filter(function (d) { return d.acwr > 1.3 && d.acwr <= 1.5; }).length;
      if (hi > 0) add('Load management', 'risk', sprintf('%d day(s) with acute:chronic workload ratio above 1.5', hi),
        "ACWR (7-day ATL ÷ 42-day CTL) above 1.5 marks a spike in load relative to what your body is adapted to - the 'danger zone' in Gabbett's injury research.", 'Smooth weekly load so ACWR stays within 0.8-1.3.');
      else if (midN > 0) add('Load management', 'watch', sprintf('%d day(s) with ACWR 1.3-1.5', midN), 'Moderate load spikes; acceptable if followed by recovery.');
      var last = load[load.length - 1], tsb = last.tsb;
      var st = tsb > 25 ? ['watch', 'Transition / detraining risk', 'Form is very high - fitness is likely being lost if this continues for more than 1-2 weeks.']
        : tsb > 5 ? ['good', 'Fresh - race ready', 'Positive form: a good state for a race or key test.']
        : tsb > -10 ? ['info', 'Neutral (grey zone)', 'Neither building nor sharpening strongly.']
        : tsb > -30 ? ['good', 'Optimal training zone', 'Productive fatigue: you are absorbing a meaningful training stimulus.']
        : ['risk', 'High fatigue', 'Form below -30 sustained for more than a few days raises overreaching and illness risk.'];
      add('Readiness', st[0], sprintf('Form (TSB) at end of period: %+.0f - %s', tsb, st[1]), sprintf('%s CTL %.0f, ATL %.0f.', st[2], last.ctl, last.atl));
    }
    if (wk.length >= 3) {
      var big = [];
      for (var i = 1; i < wk.length; i++) { var j = wk[i].tss / wk[i - 1].tss - 1; if (j > 0.3 && wk[i - 1].tss > 100) big.push({ i: i, j: j }); }
      if (big.length) { var bmax = big.reduce(function (a, b) { return b.j > a.j ? b : a; });
        add('Load management', 'watch', sprintf('%d week(s) with >30%% week-on-week load increase', big.length), 'Largest: week of ' + TP.fmt(wk[bmax.i].week, '%d %b') + sprintf(' (%+.0f%%).', bmax.j * 100),
          'Keep week-to-week increases under ~10-15% outside of returning from a planned recovery week.'); }
      if (wk.length >= 6) {
        var down = 0;
        for (i = 3; i < wk.length; i++) if (wk[i].tss < 0.8 * (wk[i - 1].tss + wk[i - 2].tss + wk[i - 3].tss) / 3) down++;
        if (!down) add('Periodisation', 'watch', 'No recovery weeks detected', sprintf('Across %d weeks no week dropped below 80%% of the prior 3-week average.', wk.length), 'Build in a 30-40% load reduction every 3-4 weeks to consolidate adaptation.');
        else add('Periodisation', 'good', sprintf('%d recovery week(s) identified', down), 'Load was periodised with lighter weeks, supporting supercompensation.');
      }
      var hm = wk.filter(function (w) { return w.monotony > 2; }).length;
      if (hm) add('Load management', 'watch', sprintf('Training monotony above 2.0 in %d week(s)', hm),
        "Foster's monotony (mean ÷ SD of daily load) above 2.0 means too little hard/easy variation day to day - associated with illness and staleness.", 'Make easy days easier and include at least one full rest or very light day per week.');
      var ks = mean(col(wk, 'key_sessions'));
      if (ks > 3.5) add('Intensity', 'watch', sprintf('%.1f high-intensity sessions per week on average', ks), 'Elite endurance programmes typically contain 2-3 key sessions per week.', 'Consider converting one key session to an aerobic endurance session.');
      else if (ks < 1 && nWeeks >= 3) add('Intensity', 'info', sprintf('Only %.1f high-intensity sessions per week', ks), 'Little work at or above threshold. Fine for a base phase, but VO2max and threshold power/pace need regular stimulus.');
    }
    var ud = Object.keys(by(acts, 'date')).sort(), gap = 0;
    for (i = 1; i < ud.length; i++) gap = Math.max(gap, days(ud[i - 1], ud[i]));
    if (gap > 7) add('Consistency', 'watch', sprintf('Longest break: %d days', gap - 1), 'Breaks over a week start to reverse plasma-volume and enzymatic adaptations.');
    else add('Consistency', 'good', sprintf('Consistent training: %.1f sessions / %.1f h per week', acts.length / nWeeks, sum(col(acts, 'hours')) / nWeeks), 'No breaks longer than a week.');
    var d = r.dist_all;
    if (fin(d.p1)) {
      add('Intensity', ['Polarized', 'Pyramidal', 'Base / low-intensity focus'].indexOf(d.type) >= 0 ? 'good' : 'watch', 'Intensity distribution: ' + d.type,
        sprintf('Z1 %.0f%% / Z2 %.0f%% / Z3 %.0f%% of training time%s.', d.p1, d.p2, d.p3, fin(d.pi) ? sprintf(' - Polarization Index %.2f', d.pi) : ''),
        d.p2 > 25 ? 'Too much time between LT1 and threshold. Pros typically spend ~75-80% below LT1 - slow easy sessions down so you can go harder on key days.'
          : d.p1 < 70 ? 'Less than 70% low-intensity is unusual for endurance athletes and limits sustainable volume.' : '');
    }
    r.ef.trends.forEach(function (t) {
      var p = t.pct_per_4wk;
      add('Aerobic fitness', p > 1 ? 'good' : p < -1 ? 'watch' : 'info', sprintf('%s efficiency factor %s %.1f%% per 4 weeks', t.discipline, p >= 0 ? 'improving' : 'declining', Math.abs(p)),
        sprintf('EF = %s ÷ heart rate on %d easy aerobic sessions. A rising EF means more output at the same cardiovascular cost.', t.discipline === 'Bike' ? 'normalised power' : 'grade-adjusted speed', t.n),
        p < -1 ? 'Check fatigue, heat, and sleep; a falling EF during a build often signals accumulated fatigue.' : '');
    });
    var long = acts.filter(function (a) { return fin(a.decoupling) && a.hours >= 1 && fin(a.intensity) && a.intensity < 0.88; });
    if (long.length >= 2) {
      var md = median(col(long, 'decoupling'));
      add('Durability', md < 5 ? 'good' : md < 8 ? 'info' : 'watch', sprintf('Median aerobic decoupling %.1f%% on %d long steady sessions', md, long.length),
        'Decoupling compares output:HR in the first vs second half. Under 5% indicates a well-developed aerobic base for that duration.',
        md >= 5 ? 'Prioritise progressively longer steady Z1 sessions until decoupling stays under 5%.' : 'Aerobic base is solid - extend duration or add race-pace work inside long sessions.');
    }
    if (r.pcurve) {
      var sel = r.pcurve.filter(function (x) { return [5, 60, 300, 1200].indexOf(x.duration) >= 0 && fin(x.first) && fin(x.second); });
      if (sel.length) {
        var ch = sel.map(function (x) { return (x.second / x.first - 1) * 100; }), mc = mean(ch);
        add('Performance', mc > 1 ? 'good' : mc < -2 ? 'watch' : 'info', 'Power curve: second half vs first half of period',
          sel.map(function (x, k) { return A.durLabel(x.duration) + ' ' + sprintf('%+.0f%%', ch[k]); }).join(' · '), 'Changes reflect both fitness and whether maximal efforts were actually performed in each half.');
      }
      if (r.cp_fit) {
        var cpf = r.cp_fit;
        add('Performance', 'info', sprintf("Critical power %.0f W, W' %.1f kJ", cpf.cp, cpf.w_prime / 1000),
          sprintf('2-parameter CP model fitted to 2-20 min bests (R² %.3f). Modelled FTP ≈ %.0f W vs %.0f W in your profile.', cpf.r2, 0.97 * cpf.cp, r.prof.ftp),
          Math.abs(0.97 * cpf.cp / r.prof.ftp - 1) > 0.05 ? 'Your FTP setting differs by >5% from the model - update it or perform a field test so TSS and zones are accurate.' : '');
      }
    }
    if (r.cs_fit && r.cs_fit.cp > 2) add('Performance', 'info', sprintf("Running critical speed %s /km, D' %.0f m", fmtPace(1000 / r.cs_fit.cp), r.cs_fit.w_prime),
      sprintf('Fitted to 3-20 min best efforts (R² %.3f). CS approximates the boundary between heavy and severe intensity.', r.cs_fit.r2));
    if (r.scurve) {
      var ss = r.scurve.filter(function (x) { return [60, 300, 1200, 3600].indexOf(x.duration) >= 0 && fin(x.first) && fin(x.second); });
      if (ss.length) { var sch = ss.map(function (x) { return (x.second / x.first - 1) * 100; });
        add('Performance', mean(sch) > 1 ? 'good' : 'info', 'Run pace curve: second half vs first half', ss.map(function (x, k) { return A.durLabel(x.duration) + ' ' + sprintf('%+.0f%%', sch[k]); }).join(' · ')); }
    }
    var vo2 = acts.filter(function (a) { return fin(a.vo2max); });
    if (vo2.length >= 2) { var dv = vo2[vo2.length - 1].vo2max - vo2[0].vo2max;
      add('Aerobic fitness', dv > 0 ? 'good' : dv < 0 ? 'watch' : 'info', sprintf('Garmin VO2max %.0f → %.0f', vo2[0].vo2max, vo2[vo2.length - 1].vo2max), 'Firstbeat estimate from HR/pace or power relationship.'); }
    var cmp = r.compliance;
    if (cmp && cmp.planned > 0) add('Plan compliance', cmp.completion >= 85 ? 'good' : cmp.completion >= 70 ? 'watch' : 'risk',
      sprintf('%.0f%% of planned sessions completed, %.0f%% of planned volume', cmp.completion, cmp.volume),
      cmp.by_disc.map(function (x) { return sprintf('%s: %d/%d sessions, %.0f/%.0f km', x.disc, x.done, x.planned, x.actual_km, x.planned_km); }).join(' · '),
      cmp.completion < 85 ? 'Missed sessions are the most common reason plans under-deliver - consider whether the plan is realistic for your weekly availability.' : '');
    var est = acts.filter(function (a) { return /estimated|avg HR/.test(a.tss_method); }).length;
    if (est) add('Data quality', 'info', sprintf('%d session(s) scored without full sensor data', est), 'These use average HR or duration-based estimates, which are less precise.', 'Sync again with FIT files, or wear a HR strap / power meter.');
    if (Object.keys(r.prof.sources).some(function (k) { return /default/.test(r.prof.sources[k]); }))
      add('Data quality', 'watch', 'Some thresholds are defaults, not measured', 'Training stress and zones are only as accurate as your thresholds.', 'Enter tested FTP, threshold pace, CSS and LTHR in Settings → Training thresholds.');
    var order = { risk: 1, watch: 2, good: 3, info: 4 };
    return out.sort(function (a, b) { return order[a.severity] - order[b.severity]; });
  }

  // ===========================================================================
  // Recovery: sleep, overnight HRV and resting HR across a block. wellness: [{date, sleep_h, ...}] sorted.
  // Sleep is keyed by the morning you wake up.
  // ===========================================================================
  A.recovery = function (wellness, load, start, race) {
    if (!wellness || !wellness.length) return null;
    var w = wellness.filter(function (x) { return x.date >= addDays(start, -28) && x.date <= race; }), blk = w.filter(function (x) { return x.date >= start; });
    var cnt = function (rows, k) { return rows.filter(function (x) { return fin(x[k]); }).length; };
    if (cnt(blk, 'sleep_h') < 7 && cnt(blk, 'hrv') < 7) return null;
    var m = function (rows, k) { return mean(col(rows, k)); };
    var baseLow = median(col(blk, 'hrv_low')), baseMid;
    if (fin(baseLow)) baseMid = median(blk.map(function (x) { return fin(x.hrv_low) && fin(x.hrv_high) ? (x.hrv_low + x.hrv_high) / 2 : null; }));
    else { baseMid = median(col(w.filter(function (x) { return x.date < addDays(start, 14); }), 'hrv')); baseLow = fin(baseMid) ? baseMid * 0.9 : null; }
    var taperStart = addDays(race, -14), pre = blk.filter(function (x) { return x.date < taperStart; });
    var first2 = blk.filter(function (x) { return x.date < addDays(start, 14); }), lastBuild = pre.filter(function (x) { return x.date >= addDays(taperStart, -14); });
    var taper = blk.filter(function (x) { return x.date >= addDays(race, -7) && x.date <= race; });
    // Load response: HRV the night after hard days vs other days.
    var wByDate = {}; w.forEach(function (x) { wByDate[x.date] = x; });
    var nxt = load.filter(function (d) { return d.date >= start && d.date < race; }).map(function (d) { var n = wByDate[addDays(d.date, 1)]; return { tss: d.tss, hrv: n ? n.hrv : null }; }).filter(function (x) { return fin(x.hrv); });
    var hardCut = quantile(nxt.map(function (x) { return x.tss; }).filter(function (t) { return t > 0; }), 0.75), hardDrop = null;
    if (nxt.length >= 10 && fin(hardCut)) {
      var hh = mean(nxt.filter(function (x) { return x.tss >= hardCut; }).map(function (x) { return x.hrv; })), ee = mean(nxt.filter(function (x) { return x.tss < hardCut; }).map(function (x) { return x.hrv; }));
      if (fin(hh) && fin(ee)) hardDrop = (hh / ee - 1) * 100;
    }
    var pct = function (num_, den) { return fin(num_) && fin(den) && den ? (num_ / den - 1) * 100 : null; };
    var below = blk.filter(function (x) { return fin(x.hrv) && fin(baseLow); });
    var sl = blk.filter(function (x) { return fin(x.sleep_h); });
    var r = { nights: sl.length, sleep_h: m(blk, 'sleep_h'), sleep_score: m(blk, 'sleep_score'), deep_h: m(blk, 'deep_h'), rem_h: m(blk, 'rem_h'),
      short_nights: sl.length ? sl.filter(function (x) { return x.sleep_h < 7; }).length / sl.length * 100 : null,
      hrv: m(blk, 'hrv'), hrv_base: baseMid, hrv_low: baseLow, hrv_below_pct: below.length ? below.filter(function (x) { return x.hrv < baseLow; }).length / below.length * 100 : null,
      hrv_build_change: pct(m(lastBuild, 'hrv'), m(first2, 'hrv')), hrv_taper_change: pct(m(taper, 'hrv'), m(lastBuild, 'hrv')),
      rhr_first: m(first2, 'rhr'), rhr_last: m(lastBuild, 'rhr'), rhr_taper: m(taper, 'rhr'),
      pre_race_sleep: m(blk.filter(function (x) { return x.date >= addDays(race, -2) && x.date <= race; }), 'sleep_h'), hard_day_hrv: hardDrop, daily: blk };
    r.rhr_drift = fin(r.rhr_last) && fin(r.rhr_first) ? r.rhr_last - r.rhr_first : null;
    var parts = { sleep: fin(r.sleep_h) ? clamp(45 + (r.sleep_h - 6) * 27.5) : null, hrv: fin(r.hrv_below_pct) ? clamp(100 - Math.max(0, r.hrv_below_pct - 10) * 1.4) : null,
      taper: fin(r.hrv_taper_change) ? clamp(75 + r.hrv_taper_change * 5) : null, rhr: fin(r.rhr_drift) ? clamp(100 - Math.max(0, r.rhr_drift - 1) * 12) : null };
    r.parts = parts;
    var pv = Object.keys(parts).map(function (k) { return parts[k]; }).filter(fin);
    r.score = pv.length ? Math.round(mean(pv)) : null;
    return r;
  };
  A.recoveryFindings = function (r) {
    var good = [], change = [];
    if (!r) return { good: good, change: change };
    if (fin(r.sleep_h)) {
      if (r.sleep_h >= 8) good.push(sprintf('Sleep averaged %.1f h a night, enough to absorb the training load.', r.sleep_h));
      else change.push(sprintf('Sleep averaged %.1f h, with %.0f%% of nights under 7 h. Endurance athletes adapt best on 8-9 h; extra sleep is the cheapest performance gain available.', r.sleep_h, r.short_nights));
    }
    if (fin(r.hrv_below_pct)) {
      if (r.hrv_below_pct <= 15) good.push(sprintf('Overnight HRV stayed in your normal range on %.0f%% of nights: the body coped with the load.', 100 - r.hrv_below_pct));
      else change.push(sprintf('HRV was below your baseline on %.0f%% of nights, a sign of accumulated stress. Add recovery days when HRV stays low for 2-3 nights in a row.', r.hrv_below_pct));
    }
    if (fin(r.hard_day_hrv) && r.hard_day_hrv < -8) change.push(sprintf('After your hardest days HRV dropped %.0f%% the following night: those sessions are costly, so keep the day after them easy.', -r.hard_day_hrv));
    if (fin(r.rhr_drift) && r.rhr_drift >= 3) change.push(sprintf('Resting HR crept up %.0f bpm through the build (%.0f to %.0f): a classic early sign of overreaching.', r.rhr_drift, r.rhr_first, r.rhr_last));
    if (fin(r.hrv_taper_change)) {
      if (r.hrv_taper_change >= 3) good.push(sprintf('HRV rose %.0f%% during the taper: you arrived recovered.', r.hrv_taper_change));
      else if (r.hrv_taper_change < -3) change.push(sprintf('HRV fell %.0f%% in race week, so recovery was incomplete. Pre-race nerves, travel or a taper that was too heavy are the usual causes.', -r.hrv_taper_change));
    }
    if (fin(r.pre_race_sleep) && r.pre_race_sleep < 6.5) change.push(sprintf('Only %.1f h average sleep over the last 3 nights before the race. Bank extra sleep earlier in race week, since the night before is often poor.', r.pre_race_sleep));
    return { good: good, change: change };
  };

  // ===========================================================================
  // Training block review
  // ===========================================================================
  A.BLOCK_DISCIPLINES = { Run: ['Run'], Bike: ['Bike'], Swim: ['Swim'], Triathlon: ['Swim', 'Bike', 'Run'], Duathlon: ['Run', 'Bike'], Hyrox: ['Run', 'Other'], 'Training Only': ['Run', 'Bike', 'Swim', 'Other'] };
  // Cross-training transfer: the share of a session's aerobic training effect that carries over to a race
  // discipline (Tanaka 1994; Mutton et al. 1993; Millet et al. 2009).
  var TRANSFER = { Run: { Run: 1, Bike: 0.75, Swim: 0.45, Other: 0.4 }, Bike: { Bike: 1, Run: 0.7, Swim: 0.45, Other: 0.4 },
    Swim: { Swim: 1, Run: 0.35, Bike: 0.3, Other: 0.3 }, Other: { Other: 1, Run: 0.6, Bike: 0.6, Swim: 0.5 } };
  var transfer = A.transfer = function (disc, discs) { return Math.max.apply(null, discs.map(function (d) { var v = (TRANSFER[d] || {})[disc]; return fin(v) ? v : 0.3; })); };

  // Expected performance for one race leg from the athlete's pre-race fitness.
  function expectedLeg(a, train, prof, isTri, feats, preS) {
    var dur = or(a.race_s, a.moving_s), d = a.distance_m;
    if (a.discipline === 'Run' && d > 1000) {
      var p = A.predictRun(d, train.cs_fit, train.best_efforts), thr = 1000 / prof.thr_pace_s_km, tThr = d / thr;
      for (var k = 0; k < 6; k++) tThr = d / (thr * Math.pow(tThr / 3600, -0.057));
      if (!fin(p.time_s) || tThr < p.time_s) p = { time_s: tThr, method: 'threshold pace scaled to race duration' };
      // Running off the bike: the longer you've already raced, the bigger the slowdown.
      var preH = preS / 3600, fat = !isTri ? 1 : Math.min(1.25, 1 + 0.03 + 0.015 * preH + (d > 30000 ? 0.05 : 0));
      var tExp = p.time_s * fat, implied = !isTri && dur >= 900 ? 1000 / ((d / dur) / Math.pow(dur / 3600, -0.057)) : null;
      return { expected: tExp, actual: dur, ratio: tExp / dur, kind: 'time', implied_thr_pace: implied,
        basis: p.method + (isTri ? sprintf(', +%.0f%% for running after %s of racing', (fat - 1) * 100, fmtDur(preS)) : '') };
    }
    if (a.discipline === 'Bike' && a.np > 0) {
      var cp = train.cp_fit, longEv = dur > 7200;
      var expP = cp && dur <= 1800 ? cp.cp + cp.w_prime / dur : !longEv ? prof.ftp * Math.pow(Math.max(dur, 600) / 3600, -0.07) : prof.ftp * 0.85 * Math.pow(dur / 7200, -0.1);
      if (isTri) expP /= 1.02;   // coming off the swim costs ~2% on the bike
      var res = { expected: expP, actual: a.np, ratio: a.np / expP, kind: 'power',
        implied_ftp: dur >= 1200 && !isTri && !longEv ? a.np / Math.pow(dur / 3600, -0.07) : null,
        basis: cp && dur <= 1800 ? 'critical power model' : !longEv ? 'FTP power-duration curve' : 'long-event IF norm for this duration' };
      if (isTri) {
        // In a triathlon the bike is judged on pacing discipline: riding above the IF band costs more on the run than it gains.
        var band = dur < 5400 ? [0.83, 0.92] : dur < 12600 ? [0.75, 0.83] : [0.68, 0.76];
        res.band = band; res.if_status = a.intensity > band[1] ? 'over' : a.intensity < band[0] ? 'under' : 'within';
        res.ratio = Math.min(res.ratio, 1);
        res.basis = sprintf('%s, +2%% for coming off the swim; tri IF target %.2f-%.2f', res.basis, band[0], band[1]);
      }
      return res;
    }
    if (a.discipline === 'Bike' && d > 5000 && !/indoor|virtual/.test(a.type_key || '')) {
      // No power meter: best speed sustained in outdoor training for this duration, scaled to race effort
      // (on the flat speed rises roughly with the cube root of effort, using HR above resting).
      var outRides = train.acts.filter(function (x) { return x.discipline === 'Bike' && !/indoor|virtual/.test(x.type_key || '') && (feats[x.id] || {}).bike_speed_curve; });
      if (outRides.length) {
        var bestV = [], who = [];
        BIKE_SPD_D.forEach(function (dd, j) { var b = null, w = null; outRides.forEach(function (x) { var v = feats[x.id].bike_speed_curve[j]; if (fin(v) && v > 0 && (b === null || v > b)) { b = v; w = x; } }); bestV.push(b); who.push(w); });
        var ok = BIKE_SPD_D.map(function (dd, j) { return fin(bestV[j]); });
        var durs = BIKE_SPD_D.filter(function (dd, j) { return ok[j]; }), v = bestV.filter(fin), hrB = who.filter(function (w, j) { return ok[j]; }).map(function (w) { return w.avg_hr; });
        if (durs.length >= 2) {
          var at = Math.max(dur, durs[0]), vT;
          if (dur <= durs[durs.length - 1]) vT = Math.exp(interp(durs.map(Math.log), v.map(Math.log), Math.log(at)));
          else vT = v[v.length - 1] * Math.pow(dur / durs[durs.length - 1], -0.05);
          var hx = [], hy = []; durs.forEach(function (dd, j) { if (fin(hrB[j])) { hx.push(Math.log(dd)); hy.push(hrB[j]); } });
          var hrT = hx.length ? interp(hx, hy, Math.log(Math.min(at, durs[durs.length - 1]))) : null;
          var band2 = dur < 5400 ? [0.88, 0.95] : dur < 12600 ? [0.83, 0.9] : [0.76, 0.84];
          var tf = isTri ? (band2[0] + band2[1]) / 2 : Math.min(1, 0.9 * Math.pow(Math.max(dur, 3600) / 3600, -0.08)), targetHr = tf * prof.lthr;
          var scale = fin(hrT) && hrT > prof.hrrest + 10 ? Math.min(1.25, Math.max(0.9, Math.pow((targetHr - prof.hrrest) / (hrT - prof.hrrest), 1 / 3))) : 1;
          var tE = d / (vT * scale) * (isTri ? 1.02 : 1);
          var r2 = { expected: tE, actual: dur, ratio: tE / dur, kind: 'time',
            basis: sprintf('best training speed for this duration (%.1f km/h at %.0f bpm), scaled to race effort (%.0f bpm)', vT * 3.6, hrT, targetHr) + (isTri ? ', +2% for coming off the swim' : '') };
          if (isTri && fin(a.avg_hr)) {
            var hrIf = a.avg_hr / prof.lthr;
            r2.band = band2; r2.hr_based = true; r2.if_status = hrIf > band2[1] ? 'over' : hrIf < band2[0] ? 'under' : 'within';
            r2.display_ratio = r2.ratio; r2.ratio = Math.min(r2.ratio, 1.05);
            r2.basis = sprintf('%s; tri HR target %.0f-%.0f%% of threshold HR', r2.basis, band2[0] * 100, band2[1] * 100);
          }
          return r2;
        }
      }
    }
    if (a.discipline === 'Swim' && d > 200) {
      var ow = a.swim_env === 'Open water', owf = or(prof.ow_factor, OW_FACTOR);
      var te = (1500 * prof.css_s_100 / 100) * Math.pow(d / 1500, 1.06) / (ow ? owf : 1);
      return { expected: te, actual: dur, ratio: te / dur, kind: 'time', basis: ow ? sprintf('CSS with Riegel distance scaling, %.0f%% slower for open water (%s)', (1 / owf - 1) * 100, or(prof.sources.ow, 'typical gap')) : 'CSS with Riegel distance scaling' };
    }
    return null;
  }
  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (var i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[ys.length - 1];
  }

  // ctx: { idx, feats, scored, prof, transitions, wellness, garminProfile, overrides, compliance(from, to, blockId) }
  // review: { id, name, sport, start, race_date, goal_s, race_ids, calendar_id }
  A.blockReview = function (ctx, review) {
    var scored = ctx.scored, feats = ctx.feats, prof = ctx.prof, start = review.start, race = review.race_date;
    var discs = A.BLOCK_DISCIPLINES[review.sport] || ['Run', 'Bike', 'Swim', 'Other'];
    var out = { review: review, start: start, race_date: race, discs: discs, upcoming: race > TP.today() };
    var train = A.analyse(scored, feats, prof, start, addDays(race, -1), ctx.compliance ? ctx.compliance(start, addDays(race, -1), review.calendar_id) : null);
    out.train = train;
    if (train.empty) { out.empty = true; return out; }
    out.empty = false;
    var load = A.loadModel(scored, start, race); out.load = load;
    var acts = train.acts;

    // --- Race identification ---
    var day = scored.filter(function (a) { return a.date === race; }), raceRows;
    var multi = ['Triathlon', 'Duathlon', 'Hyrox'].indexOf(review.sport) >= 0, ids = review.race_ids || [];
    var picked = day.filter(function (a) { return ids.indexOf(a.id) >= 0 || (a.parent_id && ids.indexOf(a.parent_id) >= 0); });
    var grp = day.filter(function (a) { return a.parent_id; });
    if (ids.length && picked.length) raceRows = picked;
    else if (multi && grp.length) { var g = by(grp, 'parent_id'), pid = Object.keys(g).sort(function (x, y) { return sum(col(g[y], 'hours')) - sum(col(g[x], 'hours')); })[0]; raceRows = g[pid]; }
    else { raceRows = day.filter(function (a) { return discs.indexOf(a.discipline) >= 0; }); if (!raceRows.length && day.length) raceRows = [day.reduce(function (a, b) { return b.hours > a.hours ? b : a; })]; }
    if (raceRows.length && !multi && !ids.length) raceRows = [raceRows.reduce(function (a, b) { return b.hours > a.hours ? b : a; })];
    raceRows = raceRows.map(function (a) { return Object.assign({}, a, { race_s: a.duration_s > 0 ? a.duration_s : a.moving_s }); }).sort(function (x, y) { return x.start_local < y.start_local ? -1 : 1; });
    out.race = raceRows;
    var pids = {}; raceRows.forEach(function (a) { if (a.parent_id) pids[a.parent_id] = 1; }); pids = Object.keys(pids);
    out.transitions = pids.length === 1 && ctx.transitions[pids[0]] && ctx.transitions[pids[0]].length ? ctx.transitions[pids[0]] : null;
    if (!out.transitions && raceRows.length > 1 && !pids.length) {
      // Legs recorded as separate activities: transitions are the gaps between one leg ending and the next starting.
      var gaps = [];
      for (var i = 1; i < raceRows.length; i++) gaps.push((Date.parse(raceRows[i].start_local.replace(' ', 'T') + 'Z') - Date.parse(raceRows[i - 1].start_local.replace(' ', 'T') + 'Z')) / 1000 - raceRows[i - 1].race_s);
      if (gaps.every(function (x) { return x >= 0 && x < 3600; })) out.transitions = gaps.map(function (x, k) { return { label: 'T' + (k + 1), seconds: x }; });
    }

    // --- Training components ---
    var pre = load.filter(function (d) { return d.date < race; });
    var ctl0 = load[0].ctl, peakRow = pre.length ? pre.reduce(function (a, b) { return b.ctl > a.ctl ? b : a; }) : load[0], ctlPeak = peakRow.ctl;
    var ctlRace = pre.length ? pre[pre.length - 1].ctl : ctl0, tsbRace = load[load.length - 1].tsb;
    var gain = ctl0 > 5 ? (ctlPeak / ctl0 - 1) * 100 : ctlPeak > 20 ? 40 : 0, comp = {};
    // Fitness gain needs ~6 weeks of data before the block to know where fitness started.
    var shortHist = !!ctx.historyStart && ctx.historyStart > addDays(start, -42);
    comp.fitness = shortHist ? null : clamp(40 + 2.4 * gain);
    var wk = train.weekly, weeksOk = wk.length ? wk.filter(function (w) { return w.sessions >= 3; }).length / wk.length : 0;
    var ud = Object.keys(by(acts, 'date')).sort(), longGaps = 0;
    for (i = 1; i < ud.length; i++) if (days(ud[i - 1], ud[i]) > 7) longGaps++;
    comp.consistency = clamp(weeksOk * 100 - 15 * longGaps);
    var acwrHi = load.filter(function (d) { return d.acwr > 1.5; }).length, rampPk = max(col(load, 'ramp')), monoHi = wk.filter(function (w) { return w.monotony > 2; }).length;
    comp.load_safety = clamp(100 - 6 * acwrHi - (fin(rampPk) && rampPk > 8 ? 20 : 0) - 5 * monoHi);
    var dist = train.dist_all;
    comp.intensity = { Polarized: 100, Pyramidal: 95, 'Base / low-intensity focus': 75, 'Threshold-focused': 55, 'High-intensity focused': 45 }[dist.type] || 60;
    var totH = Math.max(sum(col(acts, 'hours')), 0.01);
    var share = sum(acts.map(function (a) { return a.hours * transfer(a.discipline, discs); })) / totH;
    out.share_direct = sum(acts.filter(function (a) { return discs.indexOf(a.discipline) >= 0; }).map(function (a) { return a.hours; })) / totH;
    var balance = 1;
    if (discs.length === 3) {
      var inD = Math.max(sum(acts.filter(function (a) { return discs.indexOf(a.discipline) >= 0; }).map(function (a) { return a.hours; })), 0.01);
      balance = Math.min(1, min(discs.map(function (d) { return sum(acts.filter(function (a) { return a.discipline === d; }).map(function (a) { return a.hours; })) / inD; })) / 0.15);
    }
    var lr = discs.filter(function (d) { return d !== 'Other'; }).map(function (d) {
      var leg = raceRows.filter(function (a) { return a.discipline === d; }); if (!leg.length) return null;
      var raceS = sum(col(leg, 'moving_s')), target = Math.min(raceS, { Run: 3 * 3600, Bike: 5 * 3600, Swim: 1.25 * 3600 }[d]);
      var longest = max(acts.filter(function (a) { return a.discipline === d; }).map(function (a) { return a.moving_s; })) || 0;
      return { discipline: d, longest_s: longest, target_s: target, race_s: raceS, ratio: Math.min(1, longest / Math.max(target * 0.8, 1)) };
    }).filter(Boolean);
    out.long_ready = lr.length ? lr : null; out.share = share;
    comp.specificity = clamp(60 * Math.min(1, share / 0.8) * balance + 40 * (lr.length ? mean(col(lr, 'ratio')) : Math.min(1, share / 0.8)));
    // Taper: race-day form, and load in the final 14 days vs the 3 weeks before.
    var last14 = sum(load.filter(function (d) { return d.date >= addDays(race, -14) && d.date < race; }).map(function (d) { return d.tss; })) / 2;
    var prior21 = sum(load.filter(function (d) { return d.date >= addDays(race, -35) && d.date < addDays(race, -14); }).map(function (d) { return d.tss; })) / 3;
    var taperRed = prior21 > 0 ? (1 - last14 / prior21) * 100 : null, z3T = sum(acts.filter(function (a) { return a.date >= addDays(race, -14); }).map(function (a) { return a.z3; }));
    var tsbS = tsbRace >= 5 && tsbRace <= 25 ? 100 : tsbRace > 25 ? 65 : tsbRace >= -10 ? 60 : 30;
    var redS = !fin(taperRed) ? 50 : taperRed >= 30 && taperRed <= 60 ? 100 : taperRed > 60 ? 70 : taperRed >= 15 ? 65 : 35;
    comp.taper = clamp(0.5 * tsbS + 0.5 * redS - (z3T < 300 ? 10 : 0));
    out.taper = { ctl_peak: ctlPeak, peak_date: peakRow.date, ctl_race: ctlRace, atl_race: pre.length ? pre[pre.length - 1].atl : null, tsb_race: tsbRace,
      taper_days: days(peakRow.date, race), reduction: taperRed, z3_min: z3T / 60, last14_wk: last14, prior21_wk: prior21, ctl0: ctl0, gain_pct: gain };
    out.recovery = A.recovery(ctx.wellness, load, start, race);
    comp.recovery = out.recovery ? out.recovery.score : null;
    out.sessions = sessionBreakdown(acts, load, ctx.wellness, discs, race, review.sport, raceRows, feats, prof);
    var raceH = raceRows.length ? sum(raceRows.map(function (a) { return or(a.race_s, a.moving_s); })) / 3600 : fin(review.goal_s) ? review.goal_s / 3600 : null;
    out.families = A.sessionFamilies(out.sessions, feats);
    out.sport_impact = sportImpact(acts, scored, feats, discs, start, race, out.sessions, raceH);
    out.sport_impact.forEach(function (sp) { sp.families = out.families.families.filter(function (f) { return f.sport === sp.sport; }); });
    // Fitness and load are only judged reliably with ~6 weeks of Garmin data before the block.
    out.history_from = ctx.historyStart || null;
    out.short_history = shortHist;
    var W = { fitness: 0.2, consistency: 0.15, load_safety: 0.1, intensity: 0.15, specificity: 0.1, taper: 0.2, recovery: 0.1 }, tw = 0, ts = 0;
    out.components = {};
    Object.keys(W).forEach(function (k) { out.components[k] = comp[k]; if (fin(comp[k])) { ts += comp[k] * W[k]; tw += W[k]; } });
    out.training_score = Math.round(ts / tw);

    // --- Race execution ---
    if (raceRows.length) {
      // Judge the race only against fitness shown before it: re-estimate thresholds from pre-race data.
      var preIdx = ctx.idx.filter(function (a) { return a.date < race; }), winIdx = preIdx.filter(function (a) { return a.date >= addDays(race, -182); });
      var peW = A.estimateProfile(winIdx, feats, ctx.garminProfile, ctx.wellness, {}), peA = A.estimateProfile(preIdx, feats, ctx.garminProfile, ctx.wellness, {});
      var pp = Object.assign({}, prof, { sources: Object.assign({}, prof.sources) });
      [['ftp', 'ftp'], ['thr_pace_s_km', 'thr_speed'], ['css_s_100', 'css']].forEach(function (x) {
        if (prof.sources[x[1]] === 'set by you') return;
        var pk = !/default/.test(peW.sources[x[1]] || 'default') ? peW : !/default/.test(peA.sources[x[1]] || 'default') ? peA : null;
        if (pk) { pp[x[0]] = pk[x[0]]; pp.sources[x[1]] = pk.sources[x[1]]; }
      });
      if (!/typical/.test(peW.sources.ow || 'typical')) { pp.ow_factor = peW.ow_factor; pp.sources.ow = peW.sources.ow; }
      out.prof_pre = pp;
      var isTri = raceRows.filter(function (a) { return ['Swim', 'Bike', 'Run'].indexOf(a.discipline) >= 0; }).length > 1;
      var trS = out.transitions ? col(out.transitions, 'seconds') : [];
      var legs = raceRows.map(function (a, k) {
        // An unsplit multisport file mixes swim / bike / run, so pacing across it is meaningless.
        var skip = a.discipline === 'Transition' || (a.discipline === 'Other' && /multi_sport|triathlon/.test(a.type_key || ''));
        var preS = sum(raceRows.slice(0, k).map(function (x) { return x.race_s; })) + sum(trS.slice(0, k));
        return { act: a, exp: skip ? null : expectedLeg(a, train, pp, isTri, feats, preS), stream: skip ? null : (feats[a.id] || {}).pace || null, pre_s: preS };
      });
      out.legs = legs;
      var wT = legs.map(function (l) { return or(l.act.race_s, l.act.moving_s) || 0; });
      var wmean = function (vals) { var s = 0, w = 0; vals.forEach(function (v, k) { if (fin(v)) { s += v * wT[k]; w += wT[k]; } }); return w ? s / w : null; };
      var perfRatio = wmean(legs.map(function (l) { return l.exp ? l.exp.ratio : null; }));
      var splitMain = wmean(legs.map(function (l) { return l.stream ? l.stream.split_pct : null; })), fadeMain = wmean(legs.map(function (l) { return l.stream ? l.stream.fade_pct : null; }));
      // Durability: HR drift relative to output on legs of 45 min+, allowing 1 more point per hour already raced.
      var dl = legs.filter(function (l) { return fin(l.act.decoupling) && l.act.hours >= 0.75; }), dh = sum(dl.map(function (l) { return l.act.hours; }));
      var wh = function (f) { return dl.length ? sum(dl.map(function (l) { return f(l) * l.act.hours; })) / dh : null; };
      var decMain = wh(function (l) { return l.act.decoupling; }), decAllow = wh(function (l) { return 5 + l.pre_s / 3600; });
      var durScore = wh(function (l) { return clamp(100 - Math.max(0, l.act.decoupling - (5 + l.pre_s / 3600)) * 8); });
      var goal = fin(review.goal_s) ? review.goal_s : null, tTr = sum(trS);
      var legExp = legs.map(function (l) { return l.exp && l.exp.kind === 'time' ? l.exp.expected : null; });
      var predTotal = legExp.length && legExp.every(fin) ? sum(legExp) + tTr : null, raceTotal = sum(col(raceRows, 'race_s')) + tTr;
      var finishRatio = fin(predTotal) ? predTotal / raceTotal : perfRatio;
      var pacing = null;
      if (fin(splitMain)) { var worst = Math.min(splitMain, or(fadeMain, splitMain)); pacing = worst >= -2 && splitMain <= 3 ? 100 : worst >= -4 ? 80 : worst >= -7 ? 60 : worst >= -10 ? 40 : 20; }
      if (legs.some(function (l) { return l.exp && l.exp.if_status === 'over'; }) && fin(pacing)) pacing = Math.min(pacing, 50);
      var rc = { performance: fin(finishRatio) ? clamp(85 + (finishRatio - 1) * 600) : null, pacing: pacing, durability: durScore };
      var RW = { performance: 0.5, pacing: 0.3, durability: 0.2 }; tw = 0; ts = 0;
      Object.keys(RW).forEach(function (k) { if (fin(rc[k])) { ts += rc[k] * RW[k]; tw += RW[k]; } });
      out.race_components = rc; out.race_score = tw ? Math.round(ts / tw) : null;
      out.race_summary = { time_s: raceTotal, transition_s: tTr, km: sum(col(raceRows, 'km')), tss: sum(col(raceRows, 'tss')), perf_ratio: finishRatio,
        decoupling_allow: decAllow, split_pct: splitMain, fade_pct: fadeMain, decoupling: decMain, goal_s: goal, goal_delta: fin(goal) ? raceTotal - goal : null,
        predicted_s: predTotal, display_ratio: fin(predTotal) ? finishRatio : null };
    } else out.race_score = null;
    out.findings = blockFindings(out);
    return out;
  };

  function blockFindings(b) {
    var good = [], change = [], c = b.components, tp = b.taper;
    if (!fin(c.fitness)) change.push(sprintf('Your Garmin data starts %s, so where fitness began this block can’t be measured. Sync from %s (6 weeks before the block) for the fitness gain and a fuller review.', TP.fmt(b.history_from, '%d %b %Y'), TP.fmt(addDays(b.start, -42), '%d %b %Y')));
    else if (c.fitness >= 75) good.push(sprintf('Fitness rose %.0f%% (CTL %.0f → %.0f peak) - the block delivered a real training stimulus.', tp.gain_pct, tp.ctl0, tp.ctl_peak));
    else change.push(sprintf('Fitness only rose %.0f%% (CTL %.0f → %.0f). Next block: progress load by 3-5 CTL per week through the build phase.', tp.gain_pct, tp.ctl0, tp.ctl_peak));
    if (c.consistency >= 80) good.push('Training was consistent week to week, the single biggest driver of endurance gains.');
    else change.push('Consistency was the limiter - missed weeks or breaks of more than a week. Plan for realistic weekly availability before adding intensity.');
    if (c.load_safety < 70) change.push('Load spiked too sharply at times (ACWR > 1.5, ramp > 8 CTL/week or monotony > 2). Smooth increases and keep a genuine easy day each week.');
    else good.push('Load progressed safely without large spikes.');
    var d = b.train.dist_all;
    if (c.intensity >= 90) good.push(sprintf('Intensity distribution was %s (Z1 %.0f%% / Z2 %.0f%% / Z3 %.0f%%), in line with elite practice.', d.type.toLowerCase(), d.p1, d.p2, d.p3));
    else change.push(sprintf('Distribution was %s (Z1 %.0f%% / Z2 %.0f%% / Z3 %.0f%%). Keep easy sessions truly easy so key sessions can be harder.', d.type.toLowerCase(), d.p1, d.p2, d.p3));
    var direct = or(b.share_direct, b.share);
    if (b.discs.length < 4 && b.share < 0.7) change.push(sprintf('Only %.0f%% of training time was in the race discipline%s (%.0f%% counting what carries over from cross-training). Cross-training builds the engine, but race-specific work transfers best - aim for 70%%+ in the final 8 weeks.', direct * 100, b.discs.length > 1 ? 's' : '', b.share * 100));
    else if (b.discs.length < 4 && direct < 0.9 && b.share >= 0.7) good.push(sprintf('%.0f%% of training was cross-training. It still counted: about %.0f%% of your training effect carried over to the race, with less impact on the legs than doing it all in the race sport.', (1 - direct) * 100, b.share * 100));
    (b.long_ready || []).forEach(function (l) {
      if (l.ratio < 0.9) change.push(sprintf('Longest %s in training was %s vs %s on race day - add progressively longer %s sessions to build race-specific endurance.', l.discipline.toLowerCase(), fmtDur(l.longest_s), fmtDur(l.race_s), l.discipline.toLowerCase()));
      else good.push(sprintf('Long %s sessions (%s longest) prepared you well for the race duration.', l.discipline.toLowerCase(), fmtDur(l.longest_s)));
    });
    if (fin(tp.reduction)) {
      if (tp.reduction >= 30 && tp.reduction <= 60 && tp.tsb_race >= 5) good.push(sprintf('Taper was well executed: load cut %.0f%% over the final 2 weeks and you started with form %+.0f.', tp.reduction, tp.tsb_race));
      else if (tp.reduction < 30 && tp.tsb_race >= 5 && tp.tsb_race <= 25) good.push(sprintf("The final 2 weeks weren't a classic taper (load %+.0f%% vs the 3 weeks before), but you still arrived fresh with form %+.0f.", -tp.reduction, tp.tsb_race));
      else if (tp.reduction < 0) change.push(sprintf('No taper: load rose %.0f%% in the final 2 weeks and you started with form %+.0f. Aim for a 40-60%% volume cut over 8-14 days, keeping some intensity.', -tp.reduction, tp.tsb_race));
      else if (tp.reduction < 30) change.push(sprintf('Taper was too short or too light: load fell only %.0f%% in the final 2 weeks (form %+.0f on race day). Aim for a 40-60%% volume cut over 8-14 days, keeping some intensity.', tp.reduction, tp.tsb_race));
      else if (tp.reduction > 60) change.push(sprintf('Taper cut load by %.0f%% - more than needed. Over-tapering loses fitness; 40-60%% is usually optimal.', tp.reduction));
    }
    if (tp.z3_min < 5) change.push('Almost no intensity in the last 2 weeks. Short race-pace efforts during a taper preserve sharpness.');
    var rs = b.race_summary;
    if (b.race && b.race.some(function (a) { return a.discipline === 'Other' && /multi_sport|triathlon/.test(a.type_key || ''); }))
      change.push('This race is a multisport file without its FIT file yet. Sync it with FIT files on the Analysis page to get swim / bike / run splits, pacing and leg-by-leg predictions.');
    if (rs) {
      if (fin(rs.perf_ratio)) {
        if (rs.perf_ratio >= 1.05) {
          good.push(sprintf('You raced %.1f%% faster than your training data and thresholds predicted - an excellent race day.', (rs.perf_ratio - 1) * 100));
          change.push('A result this far above prediction usually means your thresholds are set too low. Update them from this race (see the Race tab) so zones and training stress are accurate next block.');
        } else if (rs.perf_ratio >= 1.01) good.push(sprintf('Race performance beat what your training predicted by %.1f%% - you raced to (or above) your fitness.', (rs.perf_ratio - 1) * 100));
        else if (rs.perf_ratio >= 0.97) good.push('Race performance matched what your training predicted.');
        else change.push(sprintf('Race was %.1f%% below what training predicted. Check pacing, fuelling, heat and race-day freshness.', (1 - rs.perf_ratio) * 100));
      }
      if (fin(rs.split_pct)) {
        if (rs.split_pct < -5) change.push(sprintf('Output faded %.0f%% in the second half - start more conservatively (aim for even or slightly negative splits).', -rs.split_pct));
        else if (fin(rs.fade_pct) && rs.fade_pct < -3) change.push(sprintf('Even halves (%+.1f%%), but output dropped %.1f%% in the final quarter - a late fade that usually points to fuelling, or durability at race intensity.', rs.split_pct, -rs.fade_pct));
        else if (rs.split_pct >= -2) good.push(sprintf('Pacing was well controlled (second half %+.1f%% vs first, final quarter %+.1f%%).', rs.split_pct, or(rs.fade_pct, 0)));
      }
      (b.legs || []).forEach(function (l) {
        if (!l.exp || !l.exp.if_status) return;
        var msg = l.exp.hr_based ? sprintf('Bike HR %.0f%% of threshold vs %.0f-%.0f%% target for this distance', l.act.avg_hr / b.prof_pre.lthr * 100, l.exp.band[0] * 100, l.exp.band[1] * 100)
          : sprintf('Bike IF %.2f vs %.2f-%.2f target for this distance', l.act.intensity, l.exp.band[0], l.exp.band[1]);
        if (l.exp.if_status === 'over') change.push(msg + ' - over-biked. Riding harder than the band usually costs more time on the run than it saves; cap power at the top of the band next time.');
        else if (l.exp.if_status === 'under') change.push(msg + ' - conservative. There was room to ride harder without compromising the run.');
        else good.push(msg + ' - well judged.');
      });
      var allow = or(rs.decoupling_allow, 5);
      if (fin(rs.decoupling) && rs.decoupling > allow + 2)
        change.push(sprintf("HR drifted %.0f%% relative to output%s, more than the ~%.0f%% that's normal %s. Endurance durability (and possibly fuelling/hydration) is the next thing to build.", rs.decoupling, allow > 5.5 ? ' on the later legs' : ' during the race', allow, allow > 5.5 ? 'at that point in a race this long' : 'for a well-paced race'));
      else if (fin(rs.decoupling) && allow > 5.5 && rs.decoupling <= allow)
        good.push(sprintf("HR drift of %.0f%% on the later legs was within what's normal that deep into a long race (~%.0f%%): good durability.", rs.decoupling, allow));
    }
    var rf = A.recoveryFindings(b.recovery); good = good.concat(rf.good); change = change.concat(rf.change);
    (b.sport_impact || []).forEach(function (sp) {
      if (!sp.markers) return;
      var ew = or(sp.endurance_weight, 0.5), kind = ew > 0.5 ? 'Endurance' : ew < 0.5 ? 'Speed' : null;
      var pick = sp.markers.filter(function (m) { return !kind || m.kind === kind; }); if (!pick.length) pick = sp.markers;
      if (pick.some(function (m) { return !/^Longest/.test(m.label); })) pick = pick.filter(function (m) { return !/^Longest/.test(m.label); });
      var m = pick.reduce(function (a, x) { return sp.verdict === 'Declined' ? (x.change < a.change ? x : a) : (x.change > a.change ? x : a); });
      var msg = sprintf('%s: %s went from %s to %s (%+.1f%%)', sp.sport, m.label.toLowerCase(), m.early, m.late, m.change);
      if (sp.verdict === 'Improved') good.push(msg + '. The ' + sp.sport.toLowerCase() + ' training worked.');
      else if (sp.verdict === 'Declined') change.push(msg + '. The ' + sp.sport.toLowerCase() + " training didn't move this marker; see the Training tab for which sessions helped.");
    });
    return { good: good, change: change };
  }

  // Which sessions built fitness, which did little or harm.
  var TYPE_W = { Intervals: 1.3, Threshold: 1.25, 'Long endurance': 1.3, Endurance: 1, Recovery: 0.5, Short: 0.4, 'Grey zone': 0.75, Tempo: 1.2, Speed: 1.25, Mixed: 1.15 };
  // Longest continuous stretch (seconds) of splits at tempo effort or harder.
  function tempoSeconds(f, disc, prof) {
    var sp = ((f || {}).structure || {}).splits; if (!sp || !sp.length) return 0;
    var best = 0, run = 0;
    sp.forEach(function (x) {
      var hard = (fin(x.hr) && fin(prof.lthr) && x.hr >= 0.89 * prof.lthr) || (disc === 'Bike' && fin(x.power) && fin(prof.ftp) && x.power >= 0.76 * prof.ftp);
      run = hard ? run + x.dur : 0; if (run > best) best = run;
    });
    return best;
  }
  function sessionBreakdown(acts, load, wellness, discs, race, sport, raceRows, feats, prof) {
    feats = feats || {}; prof = prof || {};
    var a = acts.filter(function (x) { return x.date < race && ['Swim', 'Bike', 'Run', 'Other'].indexOf(x.discipline) >= 0; }).map(function (x) { return Object.assign({}, x); });
    if (!a.length) return null;
    var g = by(a, 'discipline'), medH = {}, medT = {}, medEf = {};
    Object.keys(g).forEach(function (d) { medH[d] = median(col(g[d], 'hours')); medT[d] = median(col(g[d], 'tss')); medEf[d] = median(col(g[d], 'ef')); });
    var tsbBy = {}; load.forEach(function (d) { tsbBy[d.date] = d.tsb; });
    var sleepBy = {}; (wellness || []).forEach(function (w) { sleepBy[w.date] = w.sleep_h; });
    var raceOw = (raceRows || []).some(function (r) { return r.swim_env === 'Open water'; });
    a.forEach(function (x) {
      var tot = x.z1 + x.z2 + x.z3, z1p = tot > 0 ? x.z1 / tot : null, z2p = tot > 0 ? x.z2 / tot : null, ifx = fin(x.intensity) ? x.intensity : 0.7;
      // Intervals only when the reps were entered as laps / workout steps; tempo from 15 min+ of splits at tempo effort.
      var stc = (feats[x.id] || {}).structure || {};
      x.type = (stc.n_work || 0) >= 2 ? 'Intervals'
        : tempoSeconds(feats[x.id], x.discipline, prof) >= 900 && (x.discipline === 'Run' || x.discipline === 'Bike') ? 'Tempo'
        : x.z2 >= 1200 && or(z2p, 0) >= 0.35 && ifx >= 0.83 ? 'Threshold'
        : x.hours >= Math.max(1.5 * medH[x.discipline], 1) && or(z1p, 1) >= 0.6 ? 'Long endurance'
        : x.hours < 0.42 && x.tss < 25 ? 'Short' : ifx < 0.68 && x.hours <= 1 ? 'Recovery' : or(z1p, 1) >= 0.75 ? 'Endurance' : 'Grey zone';
      // Swims are typed by their sets: endurance, tempo (main sets 300 m+), speed (250 m or less) or mixed.
      if (x.discipline === 'Swim') {
        var stype = stc.swim_type || null;
        x.type = !stype ? (x.type === 'Grey zone' ? 'Endurance' : x.type) : stype === 'Endurance' && x.type === 'Long endurance' ? 'Long endurance' : stype;
      }
      x.brick = ['Brick', 'Triathlon', 'Duathlon'].indexOf(x.group_label) >= 0;
      x.ef_q = fin(x.ef) && fin(medEf[x.discipline]) ? x.ef / medEf[x.discipline] - 1 : 0;
      x.tsb = tsbBy[x.date]; x.sleep_before = sleepBy[x.date];
      x.xfer = transfer(x.discipline, discs);
      var spec = x.xfer * (x.brick && sport === 'Triathlon' ? 1.15 : 1) * (raceOw && x.swim_env === 'Open water' ? 1.15 : 1);
      x.impact = x.tss * (TYPE_W[x.type] || 1) * spec * (1 + Math.max(Math.min(x.ef_q, 0.15), -0.15) * 2);
      x.z2p = z2p; x.ifx = ifx;
    });
    var hardDays = {}; a.forEach(function (x) { if (['Intervals', 'Threshold', 'Tempo', 'Speed'].indexOf(x.type) >= 0) hardDays[x.date] = 1; });
    a.forEach(function (x) {
      var gd = [], bd = [], cost = 0, hard = ['Intervals', 'Threshold', 'Tempo', 'Speed'].indexOf(x.type) >= 0;
      if (x.type === 'Intervals') gd.push(sprintf('%.0f min above threshold: a strong VO2max/threshold stimulus', x.z3 / 60));
      if (x.type === 'Threshold') gd.push(x.discipline === 'Swim' ? sprintf('swum at %.0f%% of CSS pace: threshold swim work', x.ifx * 100) : sprintf('%.0f min at tempo/threshold: builds sustainable race pace', x.z2 / 60));
      if (x.type === 'Long endurance') gd.push(sprintf('long %s (%s)%s: builds endurance and durability', x.discipline.toLowerCase(), fmtDur(x.moving_s), fin(x.decoupling) && x.decoupling < 5 ? sprintf(' with only %.1f%% decoupling', x.decoupling) : ''));
      if (x.discipline === 'Swim' && ['Tempo', 'Speed', 'Mixed', 'Endurance'].indexOf(x.type) >= 0) {
        var ss = (feats[x.id] || {}).structure || {};
        if (x.type === 'Tempo') gd.push('tempo swim (' + (ss.rep_label || 'long main sets') + '): main sets of 300 m+ build sustained race pace');
        else if (x.type === 'Speed') gd.push('speed swim (' + (ss.rep_label || 'short repeats') + '): short fast repeats build top-end speed and stroke rate');
        else if (x.type === 'Mixed') gd.push('mixed swim: long and short main sets work both endurance and speed');
        else if (x.hours >= 0.5) gd.push(sprintf('%.0f m swum in one: builds swim endurance', or(ss.total_dist, x.moving_s)));
      }
      if (x.brick) gd.push('brick (run off the bike): race-specific');
      if (raceOw && x.swim_env === 'Open water') gd.push('open-water swim: race-specific');
      if (x.ef_q > 0.04) gd.push(sprintf('efficiency %.0f%% above your norm: high-quality execution', x.ef_q * 100));
      if (!gd.length && x.tss >= 1.3 * medT[x.discipline]) gd.push(sprintf('solid workload (%.0f TSS)', x.tss));
      if (x.type === 'Grey zone' && x.ifx >= 0.78) { bd.push(sprintf("moderate 'grey zone' effort (IF %.2f, %.0f%% in Z2): too hard to recover from, too easy to drive adaptation", x.ifx, or(x.z2p, 0) * 100)); cost += 2; }
      if (x.type === 'Short' && !x.brick) { bd.push('too short to add meaningful fitness'); cost += 1; }
      if (fin(x.tsb) && x.tsb < -30 && x.ef_q < -0.05) { bd.push(sprintf('done deep in fatigue (form %+.0f) with efficiency %.0f%% below normal: a recovery day would have helped more', x.tsb, -x.ef_q * 100)); cost += 3; }
      if (hard && hardDays[addDays(x.date, -1)]) { bd.push('hard session the day after another hard day, with no recovery between'); cost += 2; }
      if (hard && fin(x.sleep_before) && x.sleep_before < 6) { bd.push(sprintf('hard session after only %.1f h sleep', x.sleep_before)); cost += 2; }
      if (x.date >= addDays(race, -10) && x.tss > 1.4 * medT[x.discipline] && x.type !== 'Intervals') { bd.push('big session inside the taper: adds fatigue close to race day'); cost += 3; }
      if (discs.indexOf(x.discipline) < 0) {
        if (x.xfer >= 0.6) gd.push(sprintf('%s cross-training: about %.0f%% of the aerobic benefit carries over to %s%s', x.discipline.toLowerCase(), x.xfer * 100, discs.join('/').toLowerCase(), discs.indexOf('Run') >= 0 && (x.discipline === 'Bike' || x.discipline === 'Swim') ? ', without the impact on your legs' : ''));
        else if (x.xfer >= 0.4) gd.push(sprintf('%s cross-training: builds general aerobic fitness (about %.0f%% carries over)%s', x.discipline.toLowerCase(), x.xfer * 100, discs.indexOf('Run') >= 0 && x.discipline === 'Swim' ? ' and gives your legs a break from impact' : ''));
      }
      if (fin(x.ef_q) && x.ef_q < -0.08 && x.type !== 'Recovery' && x.type !== 'Short') { bd.push(sprintf('efficiency %.0f%% below your norm: tired, hot or poorly paced', -x.ef_q * 100)); cost += 1; }
      x.why_good = gd.join('; '); x.why_bad = bd.join('; '); x.cost = cost;
    });
    return a;
  }
  // Session breakdown outside a block review (an activity's page): discs = the sport itself.
  A.sessionBreakdownFor = function (acts, load, wellness, discs, race, sport, feats, prof) { return sessionBreakdown(acts, load, wellness, discs, race, sport, null, feats, prof); };
  A.topSessions = function (sb, n, disc) {
    if (!sb) return { best: [], worst: [] };
    var s = disc ? sb.filter(function (x) { return x.discipline === disc; }) : sb;
    return { best: s.filter(function (x) { return x.cost < 2 && x.why_good; }).sort(function (a, b) { return b.impact - a.impact; }).slice(0, n),
      worst: s.filter(function (x) { return x.cost >= 1; }).sort(function (a, b) { return b.cost - a.cost || b.tss - a.tss; }).slice(0, n) };
  };

  // How each sport responded: speed markers (best efforts) and endurance markers (efficiency and durability
  // on long sessions). Long races weight endurance more, short races speed.
  var LONG_H = { Run: 1.25, Bike: 2, Swim: 0.75 };
  function sportImpact(acts, scored, feats, discs, start, race, sb, raceHours) {
    var sports = ['Swim', 'Bike', 'Run'].filter(function (d) { return discs.length >= 4 ? acts.some(function (a) { return a.discipline === d; }) : discs.indexOf(d) >= 0; });
    var taperStart = addDays(race, -14), span = days(start, taperStart);
    if (span < 21) { taperStart = race; span = days(start, race); }
    // As R's fractional dates: before start + span/3, and from taperStart - span/3.
    var earlyEnd = addDays(start, Math.ceil(span / 3)), lateStart = addDays(taperStart, -Math.floor(span / 3));
    var al = A.loadModel(scored, start, race), atlBy = {}; al.forEach(function (d) { atlBy[d.date] = d.atl; });
    var fatigue = function (x) { return atlBy[addDays(x.date, -1)]; };
    var F = function (x) { return feats[x.id] || {}; };
    var out = [];
    sports.forEach(function (d) {
      var a = acts.filter(function (x) { return x.discipline === d; });
      if (a.length < 2) return;
      var sl = A.loadModel(scored.filter(function (x) { return x.discipline === d; }), start, race);
      var outdoor = function (x) { return !/indoor|virtual/.test(x.type_key || ''); };
      function compute(early, late) {
        var markers = [];
        function add(label, e, l, lower, fmt, ne, nl, kind, change, minN) {
          ne = ne === undefined ? 2 : ne; nl = nl === undefined ? 2 : nl; minN = minN || 2;
          if (ne < minN || nl < minN || !fin(e) || !fin(l)) return;
          markers.push({ label: label, early: fmt(e), late: fmt(l), change: fin(change) ? change : ((lower ? e / l : l / e) - 1) * 100, kind: kind || 'Speed' });
        }
        var f2 = function (v) { return v.toFixed(2); }, f3 = function (v) { return v.toFixed(3); };
        var aer = function (x) { return x.filter(function (r) { return fin(r.ef) && r.hours >= 0.5 && fin(r.intensity) && r.intensity < 0.85; }); };
        if (d === 'Swim') {
          var pool = function (x) { return x.filter(function (r) { return r.swim_env === 'Pool' && r.km >= 0.8; }); }, ow = function (x) { return x.filter(function (r) { return r.swim_env === 'Open water' && r.km >= 0.5; }); };
          var p100 = function (x) { return x.map(function (r) { return r.moving_s / (r.km * 10); }); };
          add('Pool pace (/100m)', median(p100(pool(early))), median(p100(pool(late))), true, fmtPace, pool(early).length, pool(late).length);
          var sph = function (x) { return pool(x).filter(function (r) { return r.avg_hr > 0; }).map(function (r) { return r.km * 1000 / r.moving_s / r.avg_hr * 100; }); };
          add('Aerobic efficiency (m/s per 100 bpm)', median(sph(early)), median(sph(late)), false, f2, sph(early).length, sph(late).length, 'Endurance');
          add('Open-water pace (/100m)', median(p100(ow(early))), median(p100(ow(late))), true, fmtPace, ow(early).length, ow(late).length);
        } else if (d === 'Bike') {
          var p20v = function (x) { return x.map(function (r) { return F(r).has_power ? F(r).mmp[MMP_D.indexOf(1200)] : null; }).filter(fin); };
          var hardPw = function (x) { return x.filter(function (r) { return F(r).has_power && (r.z3 >= 600 || r.intensity >= 0.9); }).length; };
          var pe = max(p20v(early)), pl = max(p20v(late));
          if (hardPw(early) >= 1 && hardPw(late) >= 1 && fin(pe) && fin(pl) && Math.min(pe, pl) >= 0.9 * Math.max(pe, pl))
            add('Best 20-min power', pe, pl, false, function (v) { return Math.round(v) + ' W'; }, p20v(early).length, p20v(late).length);
          add('Aerobic efficiency (NP per heartbeat)', median(col(aer(early), 'ef')), median(col(aer(late), 'ef')), false, f2, aer(early).length, aer(late).length, 'Endurance');
          var efv = function (x) { return x.filter(outdoor).map(function (r) { return F(r).speed_per_hr; }).filter(fin); };
          if (!markers.some(function (m) { return /^Aerobic/.test(m.label); })) add('Aerobic efficiency (outdoor, km/h per bpm)', median(efv(early)), median(efv(late)), false, f3, efv(early).length, efv(late).length, 'Endurance');
        } else {
          var s20v = function (x) { return x.map(function (r) { return (F(r).mmp_speed || [])[RUN_D.indexOf(1200)]; }).filter(fin); };
          add('Best 20-min pace (/km)', 1000 / max(s20v(early)), 1000 / max(s20v(late)), true, fmtPace, s20v(early).length, s20v(late).length);
          add('Aerobic efficiency (pace per heartbeat)', median(col(aer(early), 'ef')), median(col(aer(late), 'ef')), false, f2, aer(early).length, aer(late).length, 'Endurance');
        }
        // Endurance: the same long efforts getting cheaper, steadier and longer.
        var lh = LONG_H[d], longs = function (x) { return x.filter(function (r) { return r.hours >= lh && (!fin(r.intensity) || r.intensity < 0.97); }); };
        var le = longs(early), ll = longs(late);
        if (d !== 'Swim') {
          var efL = function (x) { return col(x, 'ef').filter(fin); };
          var lbl = sprintf('Long-%s efficiency (%s+)', d === 'Run' ? 'run' : 'ride', lh % 1 === 0 ? lh + ' h' : Math.round(lh * 60) + ' min');
          if (efL(le).length >= 1 && efL(ll).length >= 1) add(lbl, median(efL(le)), median(efL(ll)), false, f2, efL(le).length, efL(ll).length, 'Endurance', null, 1);
          else if (d === 'Bike') {
            var sphL = function (x) { return x.filter(outdoor).map(function (r) { return F(r).speed_per_hr; }).filter(fin); };
            add(lbl.replace('efficiency', 'speed per heartbeat'), median(sphL(le)), median(sphL(ll)), false, f3, sphL(le).length, sphL(ll).length, 'Endurance', null, 1);
          }
          var dc = function (x) { return col(x, 'decoupling').filter(fin); }, de = median(dc(le)), dl = median(dc(ll));
          // Drift is already a percentage: each point less drift counts as a 2% improvement (capped).
          if (fin(de) && fin(dl)) add('Durability: heart-rate drift on long sessions', de, dl, true, function (v) { return v.toFixed(1) + '%'; }, dc(le).length, dc(ll).length, 'Endurance', Math.max(-15, Math.min(15, (de - dl) * 2)), 1);
        } else {
          var lp = function (x) { return x.filter(function (r) { return r.km >= 2; }).map(function (r) { return r.moving_s / (r.km * 10); }); };
          add('Long-swim pace (2 km+, /100m)', median(lp(early)), median(lp(late)), true, fmtPace, lp(early).length, lp(late).length, 'Endurance', null, 1);
        }
        // Efficiency at equal fatigue: fit efficiency against time in the block and fatigue, compare at equal fatigue.
        if (d !== 'Swim') {
          var useSph = d === 'Bike' && a.filter(function (r) { return fin(r.ef); }).length < 6;
          var efOf = function (r) { return useSph ? (outdoor(r) ? F(r).speed_per_hr : null) : r.ef; };
          var stdy = function (x) { return x.filter(function (r) { return fin(efOf(r)) && r.hours >= 0.5 && fin(r.intensity) && r.intensity < 0.95; }); };
          var xx = stdy(a.filter(function (r) { return r.date < taperStart; })).filter(function (r) { return fin(fatigue(r)); });
          var fats = xx.map(fatigue);
          if (xx.length >= 6 && sd(fats) > 1 && stdy(early).length && stdy(late).length) {
            var t = xx.map(function (r) { return days(start, r.date); });
            var fit = lm2(t, fats, xx.map(efOf));
            if (fit && fit.every(fin)) {
              var mt = function (x) { return mean(x.map(function (r) { return days(start, r.date); })); }, mf = mean(fats);
              var p1 = fit[0] + fit[1] * mt(stdy(early)) + fit[2] * mf, p2 = fit[0] + fit[1] * mt(stdy(late)) + fit[2] * mf;
              var fe = mean(stdy(early).map(fatigue)), fl = mean(stdy(late).map(fatigue));
              if (p1 > 0 && p2 > 0) add(sprintf('Efficiency at equal fatigue (fatigue %.0f → %.0f)', fe, fl), p1, p2, false, useSph ? f3 : f2, 2, 2, 'Endurance', Math.max(-15, Math.min(15, (p2 / p1 - 1) * 100)));
            }
          }
        }
        return markers.length ? markers : null;
      }
      var mk = compute(a.filter(function (r) { return r.date < earlyEnd; }), a.filter(function (r) { return r.date >= lateStart && r.date < taperStart; })), basis = 'first vs last third of the build';
      if (!mk) { var mid = addDays(start, Math.ceil(span / 2)); mk = compute(a.filter(function (r) { return r.date < mid; }), a.filter(function (r) { return r.date >= mid && r.date < taperStart; })); basis = 'first vs second half of the build'; }
      // 35% endurance for a race of an hour or less, rising to 75% for 3 h or more.
      var wEnd = fin(raceHours) ? Math.max(0.35, Math.min(0.75, 0.35 + (raceHours - 1) * 0.2)) : 0.5;
      var spCh = mk ? mean(mk.filter(function (m) { return m.kind === 'Speed'; }).map(function (m) { return m.change; })) : null;
      var enCh = mk ? mean(mk.filter(function (m) { return m.kind === 'Endurance'; }).map(function (m) { return m.change; })) : null;
      var avg = fin(spCh) && fin(enCh) ? (1 - wEnd) * spCh + wEnd * enCh : fin(spCh) ? spCh : enCh;
      var pre = sl.filter(function (x) { return x.date < race; });
      out.push({ sport: d, sessions: a.length, hours: sum(col(a, 'hours')), km: sum(col(a, 'km')), share: sum(col(a, 'hours')) / Math.max(sum(col(acts, 'hours')), 0.01) * 100,
        ctl0: sl.length ? sl[0].ctl : 0, ctl_peak: max(col(pre, 'ctl')) || 0, markers: mk, change: avg, speed_change: spCh, endurance_change: enCh, endurance_weight: wEnd,
        emphasis: fin(raceHours) ? sprintf('Weighted %.0f%% endurance, %.0f%% speed for a %s race.', wEnd * 100, (1 - wEnd) * 100, fmtDur(raceHours * 3600)) : 'Speed and endurance weighted equally.',
        verdict: !fin(avg) ? 'Not enough comparable sessions' : avg > 1.5 ? 'Improved' : avg < -1.5 ? 'Declined' : 'Maintained',
        best: A.topSessions(sb, 3, d).best, compare: basis });
    });
    return out;
  }

  // ===========================================================================
  // Weekly analysis: what one Monday-Sunday week did, against the plan.
  // planned: sessions that week; links: { sessions: {sid: actId}, acts: {actId: sid} }
  // ===========================================================================
  var HARD_TYPES = A.HARD_PLAN_TYPES = ['Tempo', 'Intervals', 'Speed', 'Hills', 'Sweet spot', 'Fartlek', 'Race', 'Simulation', 'Compromised running', 'Erg intervals', 'Power', 'Brick', 'Mixed'];
  A.weekAnalysis = function (scored, wellness, planned, links, wk) {
    var we = addDays(wk, 6), today = TP.today(), status = we < today ? 'complete' : wk <= today ? 'in progress' : 'upcoming';
    var inWeek = function (a, b) { return scored.filter(function (x) { return x.date >= a && x.date <= b && x.discipline !== 'Transition'; }); };
    var acts = inWeek(wk, we), prev = inWeek(addDays(wk, -7), addDays(wk, -1)), out = { week: wk, status: status, acts: acts };
    var load = scored.length ? A.loadModel(scored, addDays(wk, -7), we < today ? we : (today > wk ? today : wk)) : [];
    var lw = load.filter(function (d) { return d.date >= wk && d.date <= we; }), before = load.filter(function (d) { return d.date === addDays(wk, -1); })[0];
    out.ctl_start = before ? before.ctl : null; out.ctl_end = lw.length ? lw[lw.length - 1].ctl : null; out.tsb_end = lw.length ? lw[lw.length - 1].tsb : null;
    out.acwr_max = max(col(lw, 'acwr'));
    out.hours = sum(col(acts, 'hours')); out.km = sum(col(acts, 'km')); out.tss = sum(col(acts, 'tss')); out.n = acts.length; out.prev_hours = sum(col(prev, 'hours'));
    var bs = by(acts, 'discipline');
    out.by_sport = Object.keys(bs).map(function (d) { var x = bs[d]; return { discipline: d, sessions: x.length, hours: sum(col(x, 'hours')), km: sum(col(x, 'km')), tss: sum(col(x, 'tss')), longest_h: max(col(x, 'hours')) }; });
    out.dist = acts.length ? distOf(acts) : null;
    out.hard = acts.filter(function (a) { return a.z3 >= 600 || (fin(a.intensity) && a.intensity >= 0.95 && a.hours >= 0.4); }).length;
    var pl = (planned || []).filter(function (s) { return s.date >= wk && s.date <= we; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    links = links || { sessions: {}, acts: {} };
    if (pl.length) {
      pl = pl.map(function (s) { return Object.assign({}, s, { done: !!links.sessions[s.id] }); });
      var due = pl.filter(function (s) { return s.date < today || status === 'complete'; });
      out.planned = pl; out.planned_n = pl.length; out.due_n = due.length; out.done_n = pl.filter(function (s) { return s.done; }).length;
      out.planned_km = sum(col(pl, 'total_dist')); out.missed = due.filter(function (s) { return !s.done; });
    } else { out.planned = []; out.planned_n = 0; out.due_n = 0; out.done_n = 0; out.planned_km = 0; out.missed = []; }
    out.extra = acts.filter(function (a) { return !links.acts[a.parent_id || a.id]; });
    // Sleep and HRV (nights stored under the morning you wake up, so up to the Monday after).
    var wl = (wellness || []).filter(function (x) { return x.date >= wk && x.date <= addDays(we, 1); }), base = (wellness || []).filter(function (x) { return x.date >= addDays(wk, -28) && x.date < wk; });
    out.sleep_h = mean(col(wl, 'sleep_h')); out.sleep_score = mean(col(wl, 'sleep_score')); out.hrv = mean(col(wl, 'hrv')); out.hrv_base = mean(col(base, 'hrv'));
    out.rhr = mean(col(wl, 'rhr')); out.rhr_base = mean(col(base, 'rhr'));
    var good = [], warn = [], score = 70;
    if (out.due_n > 0) {
      var pct = out.done_n / out.due_n * 100;
      if (pct >= 90) { good.push(sprintf('Completed %d of %d planned sessions.', out.done_n, out.due_n)); score += 10; }
      else if (pct < 70) {
        warn.push(sprintf('Only %d of %d planned sessions done%s.', out.done_n, out.due_n, out.missed.length ? ' (missed: ' + out.missed.map(function (s) { return TP.fmt(s.date, '%a') + ' ' + s.type; }).join(', ') + ')' : ''));
        score -= 15;
      }
    }
    if (out.prev_hours >= 2 && out.hours > 0 && status === 'complete') {
      var jump = out.hours / out.prev_hours - 1;
      if (jump > 0.3) { warn.push(sprintf('Training time jumped %.0f%% on the week before (%.1f h → %.1f h) - big jumps raise injury and illness risk.', jump * 100, out.prev_hours, out.hours)); score -= 10; }
      else if (jump < -0.35) good.push(sprintf('A lighter week (%.0f%% less than the week before) - useful as a recovery week.', -jump * 100));
    }
    if (fin(out.ctl_start) && fin(out.ctl_end)) {
      var dc = out.ctl_end - out.ctl_start;
      if (dc > 7) { warn.push(sprintf('Fitness (CTL) rose %.1f in one week - above the ~5-7 a week most athletes absorb well.', dc)); score -= 8; }
      else if (dc >= 1.5) { good.push(sprintf('Fitness built steadily (CTL %+.1f).', dc)); score += 5; }
    }
    if (fin(out.acwr_max) && out.acwr_max > 1.5) { warn.push(sprintf('Acute load reached %.2f× your chronic load - a spike.', out.acwr_max)); score -= 8; }
    if (out.dist && fin(out.dist.p1)) {
      if (out.dist.p1 < 70 && out.hours >= 3) { warn.push(sprintf('Only %.0f%% of time was easy - aim for ~75-80%% easy so the hard sessions count.', out.dist.p1)); score -= 6; }
      else if (out.dist.p1 >= 75 && out.hard >= 1) good.push(sprintf('Good balance: %.0f%% easy with %d quality session%s.', out.dist.p1, out.hard, out.hard > 1 ? 's' : ''));
    }
    if (out.hard === 0 && out.hours >= 4 && status === 'complete') warn.push('No quality (hard) sessions this week.');
    if (out.hard >= 4) { warn.push(sprintf('%d hard sessions - more than most athletes recover from in a week.', out.hard)); score -= 6; }
    if (fin(out.sleep_h)) {
      if (out.sleep_h < 7) { warn.push(sprintf('Average sleep %.1f h - under 7 h blunts adaptation.', out.sleep_h)); score -= 6; }
      else if (out.sleep_h >= 7.5) good.push(sprintf('Slept well (%.1f h a night).', out.sleep_h));
    }
    if (fin(out.hrv) && out.hrv_base > 0) {
      var dh = (out.hrv / out.hrv_base - 1) * 100;
      if (dh < -7) { warn.push(sprintf('HRV %.0f%% below your 4-week baseline - signs of accumulated fatigue.', -dh)); score -= 6; }
      else if (dh > 3) good.push(sprintf('HRV %.0f%% above baseline - absorbing the training well.', dh));
    }
    if (out.n === 0 && status === 'complete') { warn.push('No activities recorded this week.'); score = 30; }
    out.good = good; out.warn = warn;
    out.score = status === 'upcoming' ? null : clamp(Math.round(score));
    out.verdict = out.score === null ? 'Upcoming' : status === 'in progress' ? 'In progress' : out.score >= 80 ? 'Strong week' : out.score >= 65 ? 'Solid week' : out.score >= 50 ? 'Mixed week' : 'Off track';
    return out;
  };

  // ===========================================================================
  // Planning advice: learn from previous blocks to improve a future one
  // ===========================================================================
  // planned: the block's sessions (with sport, h, km). start / race: block dates.
  A.planFacts = function (planned, start, race) {
    var w0 = weekStart(start), wl = weekStart(race), weeks = [];
    for (var w = w0; w <= wl; w = addDays(w, 7)) weeks.push(w);
    var wk = weeks.map(function (w) {
      var x = planned.filter(function (s) { return weekStart(s.date) === w; }), runs = x.filter(function (s) { return s.sport === 'Run'; }), rides = x.filter(function (s) { return s.sport === 'Bike'; });
      return { week: w, n: x.length, hours: sum(col(x, 'h')), km: sum(col(x, 'km')), hard: x.filter(function (s) { return HARD_TYPES.indexOf(s.type) >= 0; }).length,
        long_run: max(col(runs, 'km')) || 0, long_ride: max(col(rides, 'km')) || 0 };
    });
    var build = wk.filter(function (x) { return x.week < wl; }), nb = build.length, ramps = [];
    for (var i = 1; i < nb; i++) ramps.push(build[i - 1].hours < 1 ? null : build[i].hours / Math.max(build[i - 1].hours, 0.01) - 1);
    var taper = null;
    if (nb >= 5) { var last2 = mean(build.slice(-2).map(function (x) { return x.hours; })), prior = mean(build.slice(nb - 5, nb - 2).map(function (x) { return x.hours; })); if (prior > 0) taper = (1 - last2 / prior) * 100; }
    var share = {}, totH = Math.max(sum(col(planned, 'h')), 0.01); planned.forEach(function (s) { share[s.sport] = (share[s.sport] || 0) + s.h / totH * 100; });
    var rv = ramps.filter(fin), mr = rv.length ? max(rv) : null;
    return { weekly: wk, n_weeks: nb, avg_hours: nb ? mean(build.filter(function (x) { return x.n > 0; }).map(function (x) { return x.hours; })) || 0 : 0, peak_hours: nb ? max(col(build, 'hours')) : 0,
      max_ramp: fin(mr) ? mr * 100 : null, ramp_week: fin(mr) ? ramps.indexOf(mr) + 2 : null, taper: taper,
      hard_share: planned.length ? planned.filter(function (s) { return HARD_TYPES.indexOf(s.type) >= 0; }).length / planned.length * 100 : null,
      share: share, empty_weeks: build.map(function (x, k) { return x.n === 0 ? k + 1 : null; }).filter(fin),
      long_run: max(planned.filter(function (s) { return s.sport === 'Run'; }).map(function (s) { return s.km; })) || 0,
      down_weeks: ramps.filter(function (r) { return fin(r) && r < -0.15; }).length, n_sessions: planned.length };
  };
  A.historyRow = function (r) {
    var wk = r.train.weekly, legs = r.legs || [], weakest = null;
    var ok = legs.filter(function (l) { return l.exp && fin(l.exp.ratio) && ['Swim', 'Bike', 'Run'].indexOf(l.act.discipline) >= 0; });
    if (ok.length >= 2) weakest = ok.reduce(function (a, b) { return b.exp.ratio < a.exp.ratio ? b : a; }).act.discipline;
    var acts = r.train.acts, totH = Math.max(sum(col(acts, 'hours')), 0.01), sh = function (d) { return sum(acts.filter(function (a) { return a.discipline === d; }).map(function (a) { return a.hours; })) / totH * 100; };
    var cmp = r.train.compliance;
    return { name: r.review.name || 'Block', sport: r.review.sport || '', race_date: r.race_date, score: or(r.race_score, r.training_score), training: r.training_score, race: r.race_score,
      avg_hours: wk.length ? mean(wk.filter(function (w) { return w.sessions > 0; }).map(function (w) { return w.hours; })) : null, peak_hours: wk.length ? max(col(wk, 'hours')) : null,
      taper: r.taper.reduction, load_safety: r.components.load_safety, intensity: r.components.intensity, recovery: r.components.recovery,
      consistency: r.components.consistency, specificity: r.components.specificity, dist_type: r.train.dist_all.type, easy_pct: r.train.dist_all.p1,
      // Completion only means something when most of the block was planned in the app.
      completion: cmp && cmp.planned >= 10 ? cmp.completion : null, weakest: weakest,
      long_run_km: max(acts.filter(function (a) { return a.discipline === 'Run'; }).map(function (a) { return a.km; })),
      run_share: sh('Run'), bike_share: sh('Bike'), swim_share: sh('Swim') };
  };
  A.planAdvice = function (facts, history, raceType, latestChanges, priority) {
    var out = [], add = function (kind, title, detail) { out.push({ kind: kind, title: title, detail: detail }); };
    var isRace = raceType !== 'Training Only', h = (history || []).slice().sort(function (a, b) { return a.race_date < b.race_date ? -1 : 1; });
    var scored = h.filter(function (x) { return fin(x.score); }), same = scored.filter(function (x) { return x.sport === raceType; });
    var pick = (same.length ? same : scored).reduce(function (a, b) { return !a || b.score > a.score ? b : a; }, null);
    var ref = pick ? sprintf('%s (%s, score %d)', pick.name, TP.fmt(pick.race_date, '%b %Y'), pick.score) : null;
    if (facts.empty_weeks.length) {
      var e = facts.empty_weeks, runs = [], cur = [e[0]];
      for (var i = 1; i < e.length; i++) { if (e[i] === e[i - 1] + 1) cur.push(e[i]); else { runs.push(cur); cur = [e[i]]; } }
      runs.push(cur);
      var lbl = runs.map(function (r) { return r.length > 1 ? r[0] + '–' + r[r.length - 1] : String(r[0]); }).join(', ');
      add('change', 'Weeks without sessions', e.length === 1 ? sprintf('Week %s has nothing planned yet.', lbl) : sprintf('%d of the %d build weeks have nothing planned yet (weeks %s).', e.length, facts.n_weeks, lbl));
    }
    if (pick && fin(pick.avg_hours) && facts.avg_hours > 0) {
      var ratio = facts.avg_hours / pick.avg_hours, histPeak = max(col(h, 'peak_hours'));
      if (ratio < 0.85) add('change', 'Volume is below your best block', sprintf('This plan averages %.1f h a week. Your best result, %s, came off %.1f h a week (peak %.1f h). Build towards that.', facts.avg_hours, ref, pick.avg_hours, pick.peak_hours));
      else if (fin(histPeak) && facts.peak_hours > 1.25 * histPeak) add('change', "Peak volume is well above anything you've done", sprintf('The biggest week here is %.1f h; your highest ever block peak was %.1f h. Step up gradually or expect more fatigue than usual.', facts.peak_hours, histPeak));
      else add('keep', 'Volume matches what has worked', sprintf('%.1f h a week on average, close to the %.1f h behind %s.', facts.avg_hours, pick.avg_hours, ref));
    }
    var comps = col(h, 'completion').filter(fin);
    if (comps.length && mean(comps) < 85) add('change', 'Plan for the sessions you actually complete', sprintf('Across previous blocks you completed %.0f%% of planned sessions. Trim the least important session each week or move it to a day you train reliably.', mean(comps)));
    if (fin(facts.max_ramp) && facts.max_ramp > 15) {
      var past = h.filter(function (x) { return fin(x.load_safety) && x.load_safety < 65; });
      add('change', 'A big jump in planned volume', sprintf('Week %d is %.0f%% bigger than the week before. Keep increases to ~10%%.%s', facts.ramp_week, facts.max_ramp, past.length ? ' Load spikes already cost you in ' + past.map(function (x) { return x.name; }).join(', ') + '.' : ''));
    }
    if (facts.n_weeks >= 6 && facts.down_weeks === 0) add('change', 'No recovery weeks', 'Every build week is as big as or bigger than the last. Make every 3rd or 4th week about 25% lighter so the training sinks in.');
    var lowKey = parseInt(priority, 10) >= 4;
    if (isRace && lowKey && fin(facts.taper)) {
      if (facts.taper > 35) add('change', 'Taper is bigger than a low-priority race needs', sprintf('This is a priority %s race, but volume drops %.0f%% over the last two weeks. A 3–5 day mini-taper keeps your build on track for the races that matter more.', priority, facts.taper));
      else add('keep', 'Mini-taper suits a low-priority race', 'Training continues through the race with only a short easing-off, which is right for a priority 4–5 race.');
    } else if (isRace && fin(facts.taper)) {
      var bt = pick && fin(pick.taper) ? pick.taper : null, tgt = fin(bt) && bt >= 25 && bt <= 65 ? bt : 40;
      if (facts.taper < 25) add('change', 'Taper is too small', sprintf('The last two weeks are only %.0f%% lighter than the weeks before. Aim for ~%.0f%%%s, keeping some short race-pace work.', facts.taper, tgt, fin(bt) ? sprintf(' (your best race followed a %.0f%% taper)', bt) : ''));
      else if (facts.taper > 65) add('change', 'Taper may be too deep', sprintf('Volume drops %.0f%% in the last two weeks. Beyond ~60%% you start to lose sharpness; try ~%.0f%%.', facts.taper, tgt));
      else add('keep', 'Taper looks right', sprintf('Volume drops %.0f%% over the final two weeks.', facts.taper));
    }
    if (fin(facts.hard_share)) {
      var lowInt = h.filter(function (x) { return fin(x.intensity) && x.intensity < 65; });
      if (facts.hard_share > 35) add('change', 'Too many hard sessions', sprintf('%.0f%% of planned sessions are hard (tempo, intervals, hills...). Most good blocks keep this to 20-30%%.%s', facts.hard_share, lowInt.length ? ' ' + lowInt.map(function (x) { return x.name; }).join(', ') + ' already ended up ' + String(lowInt[0].dist_type).toLowerCase() + '.' : ''));
      else if (facts.hard_share < 10 && facts.n_sessions >= 8) add('change', 'Very little quality work', sprintf('Only %.0f%% of sessions are hard. Add one or two quality sessions a week in the race sport.', facts.hard_share));
    }
    var wks = h.filter(function (x) { return x.weakest; });
    if (wks.length) {
      var lw = wks[wks.length - 1], sp = lw.weakest, ps = facts.share[sp] || 0, pastS = { Run: lw.run_share, Bike: lw.bike_share, Swim: lw.swim_share }[sp];
      add(ps <= pastS + 3 ? 'change' : 'keep', 'Prioritise the ' + sp.toLowerCase(), sprintf('Your %s was the weakest leg against prediction in %s. It was %.0f%% of training then and is %.0f%% of this plan%s.', sp.toLowerCase(), lw.name, pastS, ps, ps <= pastS + 3 ? ' - give it a bigger share (one extra session a week)' : ''));
    }
    if (h.some(function (x) { return fin(x.specificity) && x.specificity < 70; }) && (raceType === 'Run' || raceType === 'Triathlon')) {
      var lrs = h.filter(function (x) { return fin(x.long_run_km); }), lr = lrs[lrs.length - 1];
      if (lr && facts.long_run > 0 && facts.long_run <= lr.long_run_km) add('change', 'Make the long run longer', sprintf("Race specificity was low last time (longest run %.0f km). This plan's longest run is %.0f km - push it past that.", lr.long_run_km, facts.long_run));
    }
    if (raceType === 'Triathlon') {
      var low = ['Swim', 'Bike', 'Run'].filter(function (s) { return fin(facts.share[s]) && facts.share[s] < 15; });
      if (low.length) add('change', 'Unbalanced triathlon plan', sprintf('%s get%s under 15%% of the training time.', low.join(' and '), low.length === 1 ? 's' : ''));
    }
    var rec = h.filter(function (x) { return fin(x.recovery); });
    if (rec.length && rec[rec.length - 1].recovery < 60) add('change', 'Protect recovery', sprintf('Sleep and HRV scored %d in %s. Put the hardest sessions after rest days and keep an easy day after each.', rec[rec.length - 1].recovery, rec[rec.length - 1].name));
    (latestChanges || []).slice(0, 3).forEach(function (x) { add('review', 'From your last block review', x); });
    if (!out.length) add('keep', 'Plan looks sound', 'Nothing stands out against your previous blocks.');
    var o = { change: 0, review: 1, keep: 2 };
    return out.sort(function (a, b) { return o[a.kind] - o[b.kind]; });
  };

  // ===========================================================================
  // Block progress: how a block that's under way is going, and where the plan takes it.
  // planned: [{date, sport, h, done}]
  // ===========================================================================
  var DEFAULT_TSS_H = { Run: 60, Bike: 55, Swim: 50, Other: 40 };
  A.blockProgress = function (ctx, start, race, raceType, planned, goalS) {
    var today = TP.today(), yesterday = addDays(today, -1), to = yesterday < race ? yesterday : race, scored = ctx.scored;
    if (to < start) return { empty: true, reason: "The block hasn't started yet." };
    var discs = A.BLOCK_DISCIPLINES[raceType] || ['Run', 'Bike', 'Swim'];
    var acts = scored.filter(function (a) { return a.date >= start && a.date <= to && a.discipline !== 'Transition'; }), hist = A.loadModel(scored, start, to);
    if (!hist.length) return { empty: true, reason: 'No Garmin activities yet.' };
    // Planned load still to come: each session's hours x your typical TSS per hour for that sport.
    var rec = scored.filter(function (a) { return a.date >= addDays(today, -120) && a.hours > 0.25; }), rate = Object.assign({}, DEFAULT_TSS_H);
    Object.keys(rate).forEach(function (d) { var v = rec.filter(function (a) { return a.discipline === d; }).map(function (a) { return a.tss / a.hours; }).filter(fin); if (v.length >= 5) rate[d] = median(v); });
    var fut = (planned || []).filter(function (s) { return s.date > to && s.date <= race && !s.done; }).map(function (s) { var d = rate[s.sport] !== undefined ? s.sport : 'Other'; return Object.assign({}, s, { discipline: d, tss: s.h * rate[d] }); });
    var load = hist.map(function (d) { return Object.assign({ kind: 'Done' }, d); }), proj = [];
    if (to < race) {
      var last = hist[hist.length - 1], c0 = last.ctl, a0 = last.atl, tssBy = {};
      fut.forEach(function (s) { tssBy[s.date] = (tssBy[s.date] || 0) + s.tss; });
      for (var d = addDays(to, 1); d <= race; d = addDays(d, 1)) {
        var t = tssBy[d] || 0, tsb = c0 - a0; c0 += (t - c0) / 42; a0 += (t - a0) / 7;
        proj.push({ date: d, tss: t, ctl: c0, atl: a0, tsb: tsb, kind: 'Planned' });
      }
      load = load.concat(proj);
    }
    var weekly = {};
    acts.forEach(function (a) { var k = weekStart(a.date) + '|' + a.discipline + '|Done', x = weekly[k] = weekly[k] || { week: weekStart(a.date), discipline: a.discipline, kind: 'Done', tss: 0, hours: 0 }; x.tss += a.tss; x.hours += a.hours; });
    fut.forEach(function (s) { var k = weekStart(s.date) + '|' + s.discipline + '|Planned', x = weekly[k] = weekly[k] || { week: weekStart(s.date), discipline: s.discipline, kind: 'Planned', tss: 0, hours: 0 }; x.tss += s.tss; x.hours += s.h; });
    var now = hist[hist.length - 1], ctl0 = hist[0].ctl, wksDone = Math.max((days(start, to) + 1) / 7, 1), ramp = (now.ctl - ctl0) / wksDone;
    var raceRow = proj.length ? proj[proj.length - 1] : now, acwr = now.ctl > 10 ? now.atl / now.ctl : null;
    var toDate = (planned || []).filter(function (s) { return s.date <= to; }), hPlan = planned && planned.length ? sum(col(toDate, 'h')) : null, hDone = sum(col(acts, 'hours'));
    var totH = Math.max(hDone, 0.01), xfer = acts.length ? sum(acts.map(function (a) { return a.hours * transfer(a.discipline, discs); })) / totH : null;
    var direct = acts.length ? sum(acts.filter(function (a) { return discs.indexOf(a.discipline) >= 0; }).map(function (a) { return a.hours; })) / totH : null;
    var dist = acts.length ? distOf(acts) : null, recov = A.recovery(ctx.wellness, hist, start, to);
    var last7 = (ctx.wellness || []).filter(function (x) { return x.date > addDays(to, -7) && x.date <= to; });
    var sb = sessionBreakdown(acts, hist, ctx.wellness, discs, addDays(to, 1), raceType, null, ctx.feats, ctx.prof);
    var si = days(start, to) >= 21 && acts.length >= 6 ? sportImpact(acts, scored, ctx.feats, discs, start, addDays(to, 15), sb, fin(goalS) ? goalS / 3600 : null) : [];
    var good = [], watch = [];
    if (ramp > 8) watch.push(sprintf('Fitness is climbing %.1f a week, faster than the ~8 a week most athletes can absorb safely. Ease the next build week.', ramp));
    else if (ramp >= 2) good.push(sprintf('Fitness up from %.0f to %.0f (%+.1f a week): a steady, sustainable build.', ctl0, now.ctl, ramp));
    else if (ramp >= 0) watch.push(sprintf('Fitness has barely moved (%.0f to %.0f). To build, load needs to rise a little each week.', ctl0, now.ctl));
    else watch.push(sprintf('Fitness has dropped from %.0f to %.0f since the block started.', ctl0, now.ctl));
    if (now.tsb < -30) watch.push(sprintf('Form is %+.0f: very deep fatigue. Take an easy day or two before the next key session.', now.tsb));
    else if (now.tsb < -10) good.push(sprintf('Form is %+.0f: productive fatigue, the zone where fitness is built.', now.tsb));
    else if (now.tsb > 5 && days(to, race) > 21) watch.push(sprintf("Form is %+.0f: you're fresh, which this far from race day means the load is light.", now.tsb));
    if (fin(acwr) && acwr > 1.5) watch.push(sprintf('The last 7 days were %.1f× your usual load (ACWR): a spike that raises injury risk.', acwr));
    if (hPlan > 0) {
      var rr = hDone / hPlan;
      if (rr >= 0.9 && rr <= 1.15) good.push(sprintf('%.0f h trained vs %.0f h planned so far: right on plan.', hDone, hPlan));
      else if (rr < 0.9) watch.push(sprintf("%.0f h trained vs %.0f h planned so far (%.0f%%). Don't try to make up missed hours; carry on with the plan.", hDone, hPlan, rr * 100));
      else watch.push(sprintf('%.0f h trained vs %.0f h planned (%.0f%%): more than planned, so watch fatigue.', hDone, hPlan, rr * 100));
    }
    if (proj.length && !fut.length) watch.push(sprintf('No sessions are planned for the rest of the block. With no training, fitness would fall from %.0f to about %.0f by race day: add the remaining weeks in the calendar.', now.ctl, raceRow.ctl));
    else if (proj.length) {
      if (raceRow.tsb >= 5 && raceRow.tsb <= 25) good.push(sprintf("If you follow the plan you'll start fresh (form %+.0f) with fitness around %.0f.", raceRow.tsb, raceRow.ctl));
      else if (raceRow.tsb < 5) watch.push(sprintf("On the current plan you'd reach race day still tired (form %+.0f). Lighten the final 1-2 weeks.", raceRow.tsb));
      else watch.push(sprintf('On the current plan form would be %+.0f on race day: so fresh that fitness is lost. Keep some intensity in the taper.', raceRow.tsb));
    }
    if (dist && fin(dist.p1)) {
      if (dist.p3 > 25) watch.push(sprintf('%.0f%% of training time has been hard (Z3). Most endurance athletes do best with ~80%% easy.', dist.p3));
      else if (dist.p1 >= 70) good.push(sprintf('Intensity so far: %.0f%% easy / %.0f%% moderate / %.0f%% hard (%s).', dist.p1, dist.p2, dist.p3, dist.type.toLowerCase()));
      else watch.push(sprintf('Only %.0f%% of time has been easy, with %.0f%% moderate: keep easy sessions truly easy.', dist.p1, dist.p2));
    }
    if (fin(direct) && discs.length < 3 && direct < 0.9)
      good.push(sprintf('%.0f%% of training has been cross-training; about %.0f%% of your total training effect carries over to the race%s.', (1 - direct) * 100, xfer * 100, discs.indexOf('Run') >= 0 ? ', and the low-impact sessions spare your legs' : ''));
    if (last7.filter(function (x) { return fin(x.sleep_h); }).length >= 4) {
      var sl = mean(col(last7, 'sleep_h'));
      if (sl < 7) watch.push(sprintf('Sleep has averaged %.1f h over the last week: aim for 8 h to absorb the training.', sl)); else good.push(sprintf('Sleep has averaged %.1f h over the last week.', sl));
    }
    if (recov && fin(recov.hrv_below_pct) && recov.hrv_below_pct > 20) watch.push(sprintf('HRV has been below your normal range on %.0f%% of nights in this block.', recov.hrv_below_pct));
    if (recov && fin(recov.rhr_drift) && recov.rhr_drift >= 3) watch.push(sprintf('Resting HR is up %.0f bpm since the start of the block: an early sign of overreaching.', recov.rhr_drift));
    si.forEach(function (sp) {
      if (sp.verdict === 'Improved') good.push(sprintf('%s is responding: %+.1f%% so far (%s).', sp.sport, sp.change, sp.emphasis.replace(/\.$/, '').toLowerCase()));
      else if (sp.verdict === 'Declined') watch.push(sprintf('%s markers are down %.1f%% so far: check sleep, fatigue and whether key sessions are landing.', sp.sport, -sp.change));
    });
    var next7 = fut.filter(function (s) { return s.date <= addDays(to, 7); });
    var fams = A.sessionFamilies(sb, ctx.feats);
    si.forEach(function (x) { x.families = fams.families.filter(function (f) { return f.sport === x.sport; }); });
    return { empty: false, start: start, race_date: race, to: to, discs: discs, load: load, sessions: sb, families: fams, train: { acts: acts }, weekly: Object.keys(weekly).map(function (k) { return weekly[k]; }), rate: rate,
      ctl0: ctl0, now: now, ramp: ramp, acwr: acwr, race_proj: raceRow, h_done: hDone, h_plan: hPlan, sessions_done: acts.length, dist: dist, recovery: recov,
      sport_impact: si, good: good, watch: watch, next7: next7.length ? { n: next7.length, h: sum(col(next7, 'h')), tss: sum(col(next7, 'tss')) } : null };
  };

  // ===========================================================================
  // Garmin -> planner: a planned session from a done activity
  // ===========================================================================
  var PLAN_TYPE = {
    Run: { Intervals: 'Intervals', Speed: 'Intervals', Threshold: 'Tempo', Tempo: 'Tempo', 'Grey zone': 'Tempo', Mixed: 'Fartlek', 'Long endurance': 'Long', Endurance: 'Easy', Short: 'Easy', Recovery: 'Recovery' },
    Bike: { Intervals: 'Intervals', Speed: 'Intervals', Threshold: 'Sweet spot', Tempo: 'Tempo', 'Grey zone': 'Tempo', Mixed: 'Intervals', 'Long endurance': 'Long', Endurance: 'Endurance', Short: 'Endurance', Recovery: 'Recovery' },
    Swim: { Intervals: 'Speed', Speed: 'Speed', Threshold: 'Tempo', Tempo: 'Tempo', 'Grey zone': 'Endurance', Mixed: 'Mixed', 'Long endurance': 'Endurance', Endurance: 'Endurance', Short: 'Technique', Recovery: 'Recovery' } };
  // Session type when no block breakdown has classified the activity.
  A.activityType = function (a, f) {
    var s = (f || {}).structure || {};
    return (s.n_work || 0) >= 2 ? 'Intervals' : a.intensity >= 0.9 ? 'Threshold' : a.hours >= 1.75 ? 'Long endurance' : a.intensity < 0.65 ? 'Recovery' : 'Endurance';
  };
  // One planner session from a done activity (warm-up and cool-down from its structure), or null when the
  // activity isn't something the planner schedules (walks, team sports...).
  A.activityToPlan = function (a, f, type) {
    var key = String(a.type_key || '').toLowerCase(), s = (f || {}).structure || {}, disc = a.discipline, pd, pt;
    type = type || A.activityType(a, f);
    if (disc === 'Run' || disc === 'Bike' || disc === 'Swim') {
      pt = PLAN_TYPE[disc][type] || 'Other';
      if (disc === 'Swim' && a.swim_env === 'Open water') pt = 'Open water';
      pd = disc === 'Bike' ? (/virtual|indoor|trainer/.test(key) ? 'Indoor Bike' : 'Outdoor Bike') : disc;
    } else if (/strength/.test(key)) { pd = 'Gym'; pt = 'Strength'; }
    else if (/row|ski/.test(key)) { pd = 'Hyrox'; pt = 'Erg intervals'; }
    else if (/hiit|hyrox|cardio|fitness/.test(key)) { pd = 'Hyrox'; pt = 'Simulation'; }
    else return null;
    var km = or(a.km, (a.distance_m || 0) / 1000) || 0, dp = disc === 'Swim' ? 100 : 10;
    km = Math.round(km * dp) / dp;
    var segKm = function (k) { return Math.round(sum((s.segments || []).filter(function (g) { return g.kind === k; }).map(function (g) { return g.dist; })) / 10) / 100; };
    var wu = segKm('Warm-up'), cd = segKm('Cool-down');
    if (wu + cd >= km) { wu = 0; cd = 0; }
    var mins = Math.round((a.moving_s || 0) / 60);
    var bits = [s.label || null, mins > 0 ? mins + ' min' : null, fin(a.avg_hr) ? 'avg HR ' + Math.round(a.avg_hr) : null, disc === 'Bike' && fin(a.np) ? Math.round(a.np) + ' W NP' : null].filter(Boolean);
    var byTime = pd === 'Gym' || pd === 'Hyrox' || km === 0;
    return { discipline: pd, type: pt, details: 'From Garmin: ' + (a.name || 'activity') + ' (' + TP.fmt(a.date, '%d %b %Y') + '). ' + bits.join(' · ') + '.',
      wu_cd_check: wu + cd > 0, wu_dist: wu, cd_dist: cd, total_dist: km, num_sets: 1, main_dist_1: Math.max(0, Math.round((km - wu - cd) * 100) / 100),
      main_dist_2: 0, main_dist_3: 0, main_dist_4: 0, main_dist_5: 0, plan_by: byTime ? 'Time' : 'Distance', duration_min: byTime ? mins : null };
  };
})(window.TP);
