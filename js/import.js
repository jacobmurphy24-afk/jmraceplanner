// Garmin history upload: the ZIP from Garmin's "Export your data" (or loose .fit files), read in the
// browser and stored on this device like synced activities. Nothing is uploaded anywhere.
(function (TP) {
  'use strict';
  var h = TP.h, G = TP.garmin, I = G.internals;

  // --- A small ZIP reader working on File/Blob slices, so a multi-gigabyte export is never read whole ---
  function bytesOf(blob, from, to) { return blob.slice(from, to).arrayBuffer().then(function (b) { return new DataView(b); }); }
  function u64(v, p) { return v.getUint32(p, true) + v.getUint32(p + 4, true) * 4294967296; }
  function listZip(blob) {
    var tail = Math.min(blob.size, 65557 + 20);
    return bytesOf(blob, blob.size - tail, blob.size).then(function (v) {
      for (var e = v.byteLength - 22; e >= 0; e--) if (v.getUint32(e, true) === 0x06054b50) break;
      if (e < 0) throw new Error('not a ZIP file');
      var n = v.getUint16(e + 10, true), size = v.getUint32(e + 12, true), off = v.getUint32(e + 16, true);
      // ZIP64: the real values are in the ZIP64 end record that the locator just before points to.
      if ((n === 0xffff || off === 0xffffffff || size === 0xffffffff) && e >= 20 && v.getUint32(e - 20, true) === 0x07064b50) {
        var at = u64(v, e - 12);
        return bytesOf(blob, at, at + 56).then(function (z) { return { n: u64(z, 32), size: u64(z, 40), off: u64(z, 48) }; });
      }
      return { n: n, size: size, off: off };
    }).then(function (d) {
      return bytesOf(blob, d.off, d.off + d.size).then(function (v) {
        var out = [], p = 0, td = new TextDecoder();
        while (p + 46 <= v.byteLength && v.getUint32(p, true) === 0x02014b50) {
          var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
          var nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
          var name = td.decode(new Uint8Array(v.buffer, v.byteOffset + p + 46, nlen));
          for (var x = p + 46 + nlen, xe = x + xlen; x + 4 <= xe;) {   // ZIP64 extra field: sizes and offset over 4 GB
            var id = v.getUint16(x, true), len = v.getUint16(x + 2, true), q = x + 4;
            if (id === 1) {
              if (usize === 0xffffffff) { usize = u64(v, q); q += 8; }
              if (csize === 0xffffffff) { csize = u64(v, q); q += 8; }
              if (off === 0xffffffff) off = u64(v, q);
            }
            x += 4 + len;
          }
          if (!/\/$/.test(name)) out.push({ name: name, method: method, csize: csize, usize: usize, off: off, blob: blob });
          p += 46 + nlen + xlen + clen;
        }
        return out;
      });
    });
  }
  // One entry's contents, as a Blob (inflated by the browser's own decompressor).
  function entryBlob(en) {
    return bytesOf(en.blob, en.off, en.off + 30).then(function (v) {
      var start = en.off + 30 + v.getUint16(26, true) + v.getUint16(28, true), raw = en.blob.slice(start, start + en.csize);
      if (en.method === 0) return raw;
      if (en.method !== 8) throw new Error('unsupported compression');
      return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    });
  }
  function entryBytes(en) { return entryBlob(en).then(function (b) { return b.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); }
  function entryJson(en) { return entryBlob(en).then(function (b) { return b.text(); }).then(JSON.parse); }

  // --- FIT file -> the same activity summary a Garmin sync gives ---
  var FIT_EPOCH = 631065600;
  function snake(x) { return String(x || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }
  function typeKey(sport, sub, nSessions) {
    if (nSessions > 1 || sport === 'multisport' || sport === 'triathlon') return 'multi_sport';
    var s = snake(sport), b = snake(sub);
    if (s === 'swimming') return /open_water/.test(b) ? 'open_water_swimming' : 'lap_swimming';
    if (s === 'running') return b === 'treadmill' ? 'treadmill_running' : b === 'trail' ? 'trail_running' : b === 'indoor_running' ? 'indoor_running' : 'running';
    if (s === 'cycling') return /indoor|spin/.test(b) ? 'indoor_cycling' : /virtual/.test(b) ? 'virtual_ride' : b === 'mountain' ? 'mountain_biking' : b === 'road' ? 'road_biking' : b === 'gravel_cycling' ? 'gravel_cycling' : 'cycling';
    if (s === 'training') return /strength/.test(b) ? 'strength_training' : /cardio/.test(b) ? 'indoor_cardio' : /yoga/.test(b) ? 'yoga' : 'training';
    if (s === 'fitness_equipment') return /row/.test(b) ? 'indoor_rowing' : 'fitness_equipment';
    if (s === 'hiit') return 'hiit';
    return s || 'other';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localString(d, offsetS) {
    var x = new Date(d.getTime() + offsetS * 1000);
    return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()) + ' ' + pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes()) + ':' + pad(x.getUTCSeconds());
  }
  function title(k) { k = k.replace(/_/g, ' '); return k.charAt(0).toUpperCase() + k.slice(1); }
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function readFit(bytes, fileName, index) {
    var m = new FIT.Decoder(FIT.Stream.fromByteArray(Array.from(bytes))).read({ convertDateTimesToDates: true }).messages;
    var fid = (m.fileIdMesgs || [])[0] || {}, ses = (m.sessionMesgs || []).filter(function (s) { return s.startTime; });
    if ((fid.type && fid.type !== 'activity') || !ses.length) return null;   // settings, courses, monitoring…
    var real = ses.filter(function (s) { return s.sport !== 'transition'; }), s0 = ses[0], act = (m.activityMesgs || [])[0] || {};
    // Local start time: the activity message gives local time alongside UTC; otherwise this browser's zone.
    var off = act.localTimestamp && act.timestamp instanceof Date ? act.localTimestamp - (act.timestamp.getTime() / 1000 - FIT_EPOCH) : -s0.startTime.getTimezoneOffset() * 60;
    off = Math.round(off / 900) * 900;
    var gid = (String(fileName).match(/(\d{9,})(?!.*\d{9,})/) || [])[1], meta = gid && index[gid];
    var type = typeof (meta && meta.type) === 'string' ? meta.type : typeKey(s0.sport, s0.subSport, real.length);
    var sum = function (k) { var t = 0, any = false; ses.forEach(function (s) { if (num(s[k]) !== null) { t += s[k]; any = true; } }); return any ? t : null; };
    var wavg = function (k) { var t = 0, w = 0; ses.forEach(function (s) { if (num(s[k]) !== null && s.totalTimerTime) { t += s[k] * s.totalTimerTime; w += s.totalTimerTime; } }); return w ? Math.round(t / w) : null; };
    var one = ses.length === 1 ? s0 : {}, start = localString(s0.startTime, off);
    var a = {
      id: gid || 'fit-' + Math.round(s0.startTime.getTime() / 1000), name: (meta && meta.name) || title(type), type: type, sport: I.disciplineFor(type),
      start: start, date: start.slice(0, 10), duration_s: sum('totalElapsedTime'),
      moving_s: sum('totalTimerTime'), distance_m: sum('totalDistance'), elev_m: sum('totalAscent'),
      avg_hr: ses.length === 1 ? num(s0.avgHeartRate) : wavg('avgHeartRate'), max_hr: ses.reduce(function (x, s) { return Math.max(x, s.maxHeartRate || 0); }, 0) || null,
      avg_power: num(one.avgPower), np: num(one.normalizedPower), calories: sum('totalCalories'),
      aerobic_te: num(one.totalTrainingEffect), anaerobic_te: num(one.totalAnaerobicTrainingEffect), load: num(one.trainingLoadPeak), vo2max: null,
      tss: sum('trainingStressScore'), pool_m: num(one.poolLength), multisport: real.length > 1, fit: true, fitv: I.FIT_VERSION, src: 'upload',
      _utc: s0.startTime.getTime()
    };
    return { act: a, msgs: m };
  }

  // --- Garmin's JSON files in the export: activity names, and sleep / resting heart rate by day ---
  function arr(x) { return Array.isArray(x) ? x : []; }
  function flat(j) { var out = []; arr(j).forEach(function (x) { if (x && Array.isArray(x.summarizedActivitiesExport)) out = out.concat(x.summarizedActivitiesExport); else out.push(x); }); return out; }
  function readIndex(j, index) {
    flat(j).forEach(function (r) {
      if (!r || r.activityId == null) return;
      var t = r.activityType && typeof r.activityType === 'object' ? r.activityType.typeKey : r.activityType;
      index[String(r.activityId)] = { name: r.name || r.activityName || '', type: typeof t === 'string' ? t : null };
    });
  }
  function readWellness(j, w) {
    flat(j).forEach(function (r) {
      var d = r && r.calendarDate; if (!d) return;
      d = String(typeof d === 'object' ? d.date || '' : d).slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(d)) return;
      var x = w[d] = w[d] || {};
      var dp = num(r.deepSleepSeconds), lt = num(r.lightSleepSeconds), rm = num(r.remSleepSeconds);
      if (dp !== null || lt !== null) { x.sleep_h = ((dp || 0) + (lt || 0) + (rm || 0)) / 3600; x.deep_h = (dp || 0) / 3600; if (rm !== null) x.rem_h = rm / 3600; }
      var ss = r.sleepScores || {}, sc = num(ss.overallScore != null ? ss.overallScore : ss.overall && ss.overall.value); if (sc !== null) x.sleep_score = sc;
      var rh = num(r.restingHeartRate) || num(r.currentDayRestingHeartRate); if (rh) x.rhr = rh;
      var hv = num(r.avgOvernightHrv); if (hv) x.hrv = hv;
    });
  }

  // --- The import itself ---
  var job = null;
  G.importing = function () { return job; };
  function say(t) { if (job) { job.msg = t; var el = document.getElementById('imp-msg'); if (el) el.textContent = t; } }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  G.importFiles = function (files) {
    if (job) return job.p;
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return Promise.resolve();
    if (!G.consented()) { G.withConsent(function () { G.importFiles(files); }); return Promise.resolve(); }
    job = { msg: 'Reading files…', added: 0, matched: 0, skipped: 0, failed: 0, nights: 0 };
    TP.changed();
    var fits = [], jsons = [], index = {}, well = {};
    // 1. Find every FIT and JSON file, opening the ZIPs inside the ZIP.
    function scan(entries, depth) {
      return entries.reduce(function (p, en) {
        return p.then(function () {
          var n = en.name.toLowerCase();
          if (/\.fit$/.test(n)) { if (!/wellness|monitor|sleep|metrics/.test(n)) fits.push(en); return; }
          if (/\.json$/.test(n) && /summarizedactivities|sleepdata|udsfile|wellness|aggregator/.test(n.replace(/[_-]/g, ''))) { jsons.push(en); return; }
          if (/\.zip$/.test(n) && depth < 3 && !/wellness|monitor/.test(n)) {
            say('Opening ' + en.name.split('/').pop() + '…');
            return entryBlob(en).then(listZip).then(function (list) { return scan(list, depth + 1); }).catch(function (e) { console.warn('zip', en.name, e); job.failed++; });
          }
        });
      }, Promise.resolve());
    }
    var p = files.reduce(function (p, f) {
      return p.then(function () {
        if (/\.fit$/i.test(f.name)) { fits.push({ name: f.name, file: f }); return; }
        say('Opening ' + f.name + '…');
        return listZip(f).then(function (list) { return scan(list, 0); }).catch(function (e) { console.warn(f.name, e); TP.toast(f.name + ' isn’t a ZIP or FIT file.', 'warn'); });
      });
    }, Promise.resolve());
    // 2. Names and wellness from Garmin's JSON files.
    p = p.then(function () {
      return jsons.reduce(function (p, en) {
        return p.then(function () {
          say('Reading ' + en.name.split('/').pop() + '…');
          return entryJson(en).then(function (j) { if (/summarizedactivities/i.test(en.name)) readIndex(j, index); else readWellness(j, well); }).catch(function (e) { console.warn('json', en.name, e); });
        });
      }, Promise.resolve());
    });
    // 3. Every FIT file: skip ones already here, store the rest in batches.
    p = p.then(function () {
      var have = {}, byStart = [], batchA = [], batchS = [], seen = {};
      G.acts.forEach(function (a) { have[a.id] = a; byStart.push({ t: Date.parse(String(a.start).replace(' ', 'T') + 'Z'), sport: a.sport, a: a }); });
      var flush = function () { var a = batchA, s = batchS; batchA = []; batchS = []; return I.putAll('streams', s).then(function () { return I.putAll('acts', a); }); };
      return fits.reduce(function (p, en, i) {
        return p.then(function () {
          if (i % 5 === 0) say('Reading activities: ' + (i + 1) + ' of ' + fits.length + '…');
          return (en.file ? en.file.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : entryBytes(en)).then(function (bytes) {
            if (!(bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54)) { job.skipped++; return; }
            var r = readFit(bytes, en.name, index); if (!r) { job.skipped++; return; }
            var a = r.act, t = Date.parse(a.start.replace(' ', 'T') + 'Z');
            var old = have[a.id] || (byStart.filter(function (x) { return x.sport === a.sport && Math.abs(x.t - t) < 120e3; })[0] || {}).a;
            if (seen[old ? old.id : a.id]) { job.skipped++; return; }
            if (old && old.fit && (old.fitv || 1) >= I.FIT_VERSION) { seen[old.id] = 1; job.matched++; return; }
            if (old) { a = Object.assign(old, { fit: true, fitv: I.FIT_VERSION }); job.matched++; } else job.added++;
            delete a._utc; seen[a.id] = 1; have[a.id] = a;
            batchS.push(I.parseFit(a.id, bytes, r.msgs)); batchA.push(a);
            delete G.frecs[a.id];
            if (batchA.length >= 25) return flush();
          }).catch(function (e) { console.warn('FIT', en.name, e); job.failed++; }).then(i % 10 === 9 ? tick : null);
        });
      }, Promise.resolve()).then(flush).then(function () { return Object.keys(have).map(function (k) { return have[k]; }); });
    });
    // 4. Wellness: Garmin sync data wins where a day has both.
    p = p.then(function (all) {
      var days = Object.keys(well), cur = {};
      G.wellness.forEach(function (x) { cur[x.date] = x; });
      var list = days.map(function (d) { var o = cur[d] || { date: d }, n = well[d]; Object.keys(n).forEach(function (k) { if (o[k] == null) o[k] = n[k]; }); return o; });
      job.nights = days.length;
      return I.putAll('wellness', list).then(function () { return I.getAll('wellness'); }).then(function (w) {
        G.wellness = (w || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        G.acts = all.filter(function (a) { return a && a.start; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
        var up = G.acts.filter(function (a) { return a.src === 'upload'; });
        if (up.length) I.addRange(up[up.length - 1].date, up[0].date);
      });
    });
    job.p = p.then(function () {
      var j = job;
      if (!j.added && !j.matched && !fits.length) TP.toast('No activity files found. Upload the ZIP from Garmin’s data export, or .fit files.', 'warn');
      else TP.toast('Added ' + j.added + ' activities' + (j.matched ? ', ' + j.matched + ' already here' : '') + (j.nights ? ', ' + j.nights + ' days of sleep and heart-rate data' : '') + (j.failed ? ' (' + j.failed + ' couldn’t be read)' : '') + '.');
    }).catch(function (e) { console.error(e); TP.toast('Upload stopped: ' + e.message, 'error'); })
      .finally(function () { job = null; G.ver++; TP.changed(); G.prepare().then(function () { if (TP.match) TP.match.askSoon(); }); });
    return job.p;
  };

  // --- The upload card ---
  G.importCard = function (opts) {
    opts = opts || {};
    var inp = h('input', { type: 'file', accept: '.zip,.fit,application/zip', multiple: true, style: 'display:none', onchange: function () { G.importFiles(inp.files); inp.value = ''; } });
    var pick = h('button', { class: 'btn btn-primary', disabled: !!job, onclick: function () { G.withConsent(function () { inp.click(); }); } }, TP.icon('upload'), job ? 'Uploading…' : 'Choose your Garmin export');
    var drop = h('div', { class: 'drop-zone', ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); }, ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); G.importFiles(e.dataTransfer.files); } },
      inp, pick, h('div', { class: 'muted small' }, 'or drop the .zip (or .fit files) here'));
    return h('div', { class: 'panel import-card' },
      h('div', { class: 'panel-h' }, opts.title || 'Upload your Garmin history'),
      h('p', { class: 'small' }, 'Request your data from Garmin (it arrives by email as a ZIP), then upload the ZIP here as it is. Your activities, routes and second-by-second data are read in this browser and kept on this device only. ',
        h('a', { href: 'garmin-guide.html', target: '_blank', rel: 'noopener' }, 'How to download your Garmin data')),
      drop,
      job ? h('div', { class: 'sync-progress', id: 'imp-msg' }, job.msg) : null,
      h('p', { class: 'hint' }, 'Garmin’s export can take a few days to arrive and can be several gigabytes. Upload on a computer if you can. Activities already here are skipped, so it’s safe to upload again.'));
  };
})(window.TP);
