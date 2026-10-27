// Garmin: connect with a Garmin Connect Personal API key, sync activities (summaries + FIT files), sleep
// and HRV into this device's storage, and prepare them for the analysis (analysis.js). The key and
// activities are kept on this device, separately for each account that signs in on it. Requests go
// through the site's relay (garmin-relay/), because Garmin doesn't accept them straight from a web page.
(function (TP) {
  var h = TP.h;
  var RELAY = 'https://garmin.jmraceplanner.co.uk';
  var FIT_VERSION = 2;   // 2: FIT files also give the route, laps and swim lengths
  var KEY = 'tp-garmin-key', TOKEN = 'tp-garmin-token', RANGE = 'tp-garmin-range', RANGES = 'tp-garmin-ranges', PROFILE = 'tp-garmin-profile';
  var G = TP.garmin = { acts: [], frecs: {}, wellness: [], loaded: false, syncing: null, prep: null, ver: 0 };
  var uid = null;
  // Storage names include the signed-in account, so two people using one device don't see each other's data.
  function storeKey(name) { return name + (uid ? ':' + uid : ''); }
  function dbName() { return 'tp-garmin' + (uid ? '-' + uid : ''); }
  function readLS(name, dflt) { try { var v = JSON.parse(localStorage.getItem(storeKey(name)) || 'null'); return v === null ? dflt : v; } catch (e) { return dflt; } }

  // --- Storage on this device (IndexedDB) ---
  // acts: activity summaries · streams: second-by-second data · feats: analysis features · wellness: sleep / HRV by date
  var STORES = ['acts', 'streams', 'feats', 'wellness'];
  var dbp = null, wiped = false;
  function db() {
    if (wiped) return Promise.reject(new Error('Garmin data has been removed from this device.'));
    if (!dbp) dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(dbName(), 2);
      r.onupgradeneeded = function () {
        STORES.forEach(function (s) { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: s === 'wellness' ? 'date' : 'id' }); });
      };
      // Let go when the database is being deleted (signing out), so the delete isn't blocked.
      r.onsuccess = function () { var d = r.result; d.onversionchange = function () { d.close(); }; res(d); }; r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); };
    }); });
  }
  function putAll(store, list) { return list.length ? tx(store, 'readwrite', function (s) { list.forEach(function (a) { s.put(a); }); }) : Promise.resolve(); }
  function getAll(store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); }
  G.stream = function (id) { return tx('streams', 'readonly', function (s) { return s.get(id); }); };
  // Called when someone signs in or out (or at start-up without accounts).
  G.setUser = function (id) {
    uid = id || null; dbp = null; wiped = false; G.acts = []; G.frecs = {}; G.wellness = []; G.loaded = false; G.syncing = null; G.progress = ''; G.prep = null; G.ver++;
    if (TP.mine) TP.mine.reset();
    if (TP.cloud && TP.cloud.enabled && !uid) { TP.changed(); return; }
    migrate().then(G.load);
  };
  // Signing out or deleting the account: remove the signed-in account's key, settings and stored
  // activities from this device (other accounts that sign in here keep theirs). The data is cleared
  // first, which always works; deleting the then-empty database can be held up by the browser until
  // the page closes, so its name is kept and the delete is finished the next time the site opens.
  var FORGET = 'tp-garmin-forget';
  G.wipeDevice = function () {
    var name = dbName(), suffix = uid ? ':' + uid : null;
    if (suffix) Object.keys(localStorage).forEach(function (k) { if (k.slice(-suffix.length) === suffix && k.indexOf('tp-garmin') === 0) localStorage.removeItem(k); });
    try { localStorage.setItem(FORGET, JSON.stringify(forgetList().concat([name]))); } catch (e) {}
    var cleared = Promise.all(STORES.map(function (st) { return tx(st, 'readwrite', function (s) { s.clear(); }); })).catch(function (e) { console.warn('garmin clear', e); });
    return cleared.then(function () {
      // Nothing reopens the database between here and the sign-out (which calls setUser).
      var open = dbp; dbp = null; wiped = true; G.acts = []; G.frecs = {}; G.wellness = [];
      return open ? open.then(function (d) { d.close(); }, function () {}) : null;
    }).then(function () { return dropDb(name, 1500); });
  };
  function forgetList() { try { return JSON.parse(localStorage.getItem(FORGET) || '[]'); } catch (e) { return []; } }
  function dropDb(name, wait) {
    return new Promise(function (res) {
      var r = indexedDB.deleteDatabase(name);
      r.onsuccess = function () { try { localStorage.setItem(FORGET, JSON.stringify(forgetList().filter(function (n) { return n !== name; }))); } catch (e) {} res(); };
      r.onerror = function () { res(); };
      setTimeout(res, wait);
    });
  }
  // At start-up, before anything opens them: finish deleting databases a sign-out left behind.
  forgetList().forEach(function (n) { dropDb(n, 0); });
  // Garmin data saved before accounts belonged to "this device": it moves to the first account that signs in here.
  function migrate() {
    if (!uid || !localStorage.getItem(KEY) && !localStorage.getItem(RANGE)) return Promise.resolve();
    [KEY, TOKEN, RANGE].forEach(function (n) { var v = localStorage.getItem(n); if (v !== null && localStorage.getItem(storeKey(n)) === null) localStorage.setItem(storeKey(n), v); localStorage.removeItem(n); });
    return new Promise(function (res) {
      var r = indexedDB.open('tp-garmin', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('acts', { keyPath: 'id' }); r.result.createObjectStore('streams', { keyPath: 'id' }); };
      r.onerror = function () { res(); };
      r.onsuccess = function () {
        var old = r.result, t = old.transaction(['acts', 'streams'], 'readonly'), got = {};
        ['acts', 'streams'].forEach(function (st) { var q = t.objectStore(st).getAll(); q.onsuccess = function () { got[st] = q.result || []; }; });
        t.oncomplete = function () {
          old.close();
          putAll('acts', got.acts).then(function () { return putAll('streams', got.streams); })
            .then(function () { indexedDB.deleteDatabase('tp-garmin'); res(); }, function () { res(); });
        };
      };
    });
  }
  G.load = function () {
    return Promise.all([getAll('acts'), getAll('feats'), getAll('wellness')]).then(function (r) {
      G.acts = (r[0] || []).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
      G.acts.forEach(function (a) { if (a.sport === 'Gym') a.sport = 'Strength'; });   // renamed from Gym
      G.frecs = {}; (r[1] || []).forEach(function (f) { G.frecs[f.id] = f; });
      G.wellness = (r[2] || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      G.loaded = true; G.ver++; TP.changed();
      G.prepare().then(function () { if (TP.match) TP.match.askSoon(); });
    }).catch(function (e) { console.warn('garmin storage', e); G.loaded = true; TP.changed(); });
  };

  // --- Connection ---
  G.key = function () { try { return localStorage.getItem(storeKey(KEY)) || ''; } catch (e) { return ''; } };
  G.connected = function () { return !!G.key(); };
  function jwtExp(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) { return Date.now() + 23 * 3600e3; } }
  // The key is swapped for an access token that lasts up to 24 hours; a new one is fetched when needed.
  function token(force) {
    var c = readLS(TOKEN, null);
    if (!force && c && c.exp > Date.now() + 60e3) return Promise.resolve(c.token);
    return fetch(RELAY + '/personalapitoken-service/personal-api/personal-api-key/token', { method: 'POST', headers: { Accept: '*/*', Authorization: 'ApiKey ' + G.key() } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('Garmin didn’t accept that API key. Check it was copied in full and hasn’t expired or been deleted.');
        if (!r.ok) throw new Error('Garmin returned an error (' + r.status + '). Try again in a minute.');
        return r.text();
      }).then(function (body) {
        // Garmin replies with the token itself as plain text (a JWT); accept JSON too, just in case.
        body = (body || '').trim();
        var j = null; if (body.charAt(0) === '{') { try { j = JSON.parse(body); } catch (e) {} }
        var t = j ? (j.access_token || j.accessToken || j.token) : body.replace(/^"|"$/g, '');
        if (!t || t.split('.').length !== 3) throw new Error('Garmin’s reply didn’t include an access token. Try again in a minute.');
        localStorage.setItem(storeKey(TOKEN), JSON.stringify({ token: t, exp: j && j.expires_in ? Date.now() + j.expires_in * 1000 : jwtExp(t) }));
        return t;
      });
  }
  function api(path, asBytes, retried) {
    return token(false).then(function (t) {
      return fetch(RELAY + path, { headers: { Authorization: 'Bearer ' + t, Accept: asBytes ? 'application/zip, application/x-zip-compressed, application/octet-stream' : 'application/json' } });
    }).then(function (r) {
      if (r.status === 401 && !retried) { localStorage.removeItem(storeKey(TOKEN)); return api(path, asBytes, true); }
      if (r.status === 429) throw new Error('Garmin is limiting requests right now. Wait a few minutes and sync again – what’s already downloaded is kept.');
      if (!r.ok) throw new Error('Garmin returned an error (' + r.status + ') for ' + path.split('?')[0] + '.');
      // An empty reply means "nothing" (as in Garmin's own client), not an error.
      return asBytes ? r.arrayBuffer() : r.text().then(function (x) { return x.trim() ? JSON.parse(x) : null; });
    });
  }
  G.connect = function (key) {
    key = key.trim();
    if (key.length < 10) return Promise.reject(new Error('That doesn’t look like a complete API key.'));
    localStorage.setItem(storeKey(KEY), key); localStorage.removeItem(storeKey(TOKEN));
    return token(true).catch(function (e) { localStorage.removeItem(storeKey(KEY)); throw e; });
  };
  G.disconnect = function () { localStorage.removeItem(storeKey(KEY)); localStorage.removeItem(storeKey(TOKEN)); TP.changed(); };
  G.clearActs = function () {
    return Promise.all(STORES.map(function (st) { return tx(st, 'readwrite', function (s) { s.clear(); }); })).then(function () {
      G.acts = []; G.frecs = {}; G.wellness = []; G.ver++;
      localStorage.removeItem(storeKey(RANGES)); TP.changed();
    });
  };

  // --- Consent ---
  // Heart rate, sleep and HRV are health data (special category data under UK GDPR), so nothing is read
  // from Garmin until the person explicitly agrees. The agreement is saved with their account (or on
  // this device without accounts) as users/{uid}/garmin/consent: { health: { version, at } }. Raising
  // CONSENT_VERSION asks everyone again, so do that whenever the wording below changes what's done.
  var CONSENT_VERSION = 1, CONSENT = 'consent';
  function consentDoc() { return TP.mine.get(CONSENT); }
  G.consentKnown = function () { return TP.mine.ready(CONSENT); };
  G.consented = function () { var c = consentDoc().health; return !!(c && c.version >= CONSENT_VERSION); };
  G.consentDate = function () { var c = consentDoc().health; return c ? c.at.slice(0, 10) : null; };
  function giveConsent() { TP.mine.set(CONSENT, { health: { version: CONSENT_VERSION, at: new Date().toISOString() } }); }
  // Runs fn now if the person has agreed, otherwise once they agree in the pop-up.
  G.withConsent = function (fn) {
    if (G.consented()) return fn();
    var tick = TP.input('checkbox', ''), ok = h('button', { class: 'btn btn-primary', disabled: true, onclick: function () { giveConsent(); m.close(); fn(); } }, 'Agree and continue');
    tick.onchange = function () { ok.disabled = !tick.checked; };
    var cloud = TP.cloud && TP.cloud.enabled && TP.cloud.user;
    var m = TP.modal({ size: 'm', stack: true, title: h('div', { class: 'md-t' }, 'Using your Garmin health data'),
      body: [
        h('p', null, 'To show your training load, fitness, recovery and race readiness, Training Planner reads this from Garmin:'),
        h('ul', { class: 'small' },
          h('li', null, 'your activities, with heart rate, power, pace, cadence, elevation, laps and GPS routes, second by second;'),
          h('li', null, 'sleep, resting heart rate and heart-rate variability (HRV) by day.')),
        h('p', { class: 'small' }, 'This counts as health data, so it’s only used with your permission. ',
          h('b', null, 'It’s kept in this browser on this device. '),
          cloud ? 'Your training thresholds, block reviews and links between sessions and activities are saved to your account so they appear on your other devices. ' : '',
          'It’s used only for your own analysis. It’s never sold, shared or used for advertising.'),
        h('p', { class: 'small' }, 'You can withdraw your consent at any time in Settings → Garmin analysis → Withdraw consent, which deletes the Garmin data on this device. ',
          h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy')),
        h('label', { class: 'check consent-check' }, tick, 'I agree to Training Planner using my Garmin health data as described above.')],
      footer: [h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Not now'), ok] });
  };
  // Removes the consent record, the API key and everything stored on this device.
  G.withdrawConsent = function () {
    G.disconnect(); TP.mine.set(CONSENT, {});
    return G.clearActs().then(function () { TP.toast('Consent withdrawn. Garmin data on this device has been deleted.'); });
  };
  // Garmin data stored before consent was asked for (or before the wording changed): ask once per visit.
  var askedOnce = false;
  G.askIfNeeded = function () {
    if (askedOnce || !G.loaded || !G.acts.length || !G.consentKnown() || G.consented()) return;
    askedOnce = true;
    setTimeout(function () { G.withConsent(function () { TP.changed(); }); }, 0);
  };
  // Shown in place of the analysis until the person agrees (or deletes the data).
  function consentPanel() {
    return h('div', { class: 'panel consent-panel' },
      h('div', { class: 'panel-h' }, 'Your permission is needed'),
      h('p', { class: 'small' }, 'There are ' + G.acts.length + ' Garmin activities stored on this device. Heart rate, sleep and HRV are health data, so the analysis needs your permission to use them.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onclick: function () { G.withConsent(function () { TP.changed(); }); } }, 'Review and agree'),
        h('button', { class: 'btn btn-outline-danger', onclick: function () {
          TP.confirm('Delete the Garmin activities and sleep data stored on this device? They stay on Garmin.', 'Delete', function () { G.withdrawConsent(); });
        } }, TP.icon('trash'), 'Delete Garmin data from this device')));
  }

  // --- Activities ---
  function disciplineFor(k) {
    k = (k || '').toLowerCase();
    if (k.indexOf('swim') >= 0) return 'Swim';
    if (k.indexOf('run') >= 0) return 'Run';
    if (/cycl|bik|ride/.test(k)) return 'Bike';
    if (/strength|weight|gym/.test(k)) return 'Strength';
    if (/hyrox|hiit|row|ski_erg|indoor_cardio|fitness_equipment/.test(k)) return 'Hyrox';
    return 'Other';
  }
  G.disciplineFor = disciplineFor;
  function num(x) { var v = parseFloat(x); return isFinite(v) ? v : null; }
  function summary(a) {
    var type = (a.activityType && a.activityType.typeKey) || '', start = String(a.startTimeLocal || a.startTimeGMT || '');
    return { id: String(a.activityId), name: a.activityName || '', type: type, sport: disciplineFor(type), start: start, date: start.slice(0, 10),
      duration_s: num(a.duration), moving_s: num(a.movingDuration) || num(a.duration), distance_m: num(a.distance), elev_m: num(a.elevationGain),
      avg_hr: num(a.averageHR), max_hr: num(a.maxHR), avg_power: num(a.avgPower), np: num(a.normPower), calories: num(a.calories),
      aerobic_te: num(a.aerobicTrainingEffect), anaerobic_te: num(a.anaerobicTrainingEffect), load: num(a.activityTrainingLoad), vo2max: num(a.vO2MaxValue),
      tss: num(a.trainingStressScore), pool_m: num(a.poolLength), multisport: type.indexOf('multi_sport') >= 0, fit: false };
  }
  function search(from, to) {
    var out = [], start = 0, limit = 100;
    function page() {
      var q = '?start=' + start + '&limit=' + limit + '&startDate=' + from + '&endDate=' + to;
      return api('/activitylist-service/activities/search/activities' + q).then(function (list) {
        list = Array.isArray(list) ? list : (list && (list.activities || list.activityList)) || [];
        out = out.concat(list);
        if (list.length === limit && start < 5000) { start += limit; return page(); }
        return out;
      });
    }
    return page();
  }

  // Garmin's "original" download is a ZIP holding the FIT file. A small unzip using the browser's own
  // decompression (no extra library).
  function unzip(buf) {
    var b = new Uint8Array(buf), v = new DataView(buf);
    if (b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54) return Promise.resolve(b);   // already a FIT file
    for (var e = b.length - 22; e >= Math.max(0, b.length - 66000); e--) if (v.getUint32(e, true) === 0x06054b50) break;
    if (e < 0) return Promise.reject(new Error('Download wasn’t a ZIP or FIT file.'));
    var n = v.getUint16(e + 10, true), p = v.getUint32(e + 16, true);
    for (var i = 0; i < n; i++) {
      var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      var name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/\.fit$/i.test(name)) continue;
      var start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), data = b.subarray(start, start + csize);
      if (method === 0) return Promise.resolve(data);
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (x) { return new Uint8Array(x); });
    }
    return Promise.reject(new Error('No FIT file inside the download.'));
  }
  // FIT -> compact second-by-second streams (seconds from start) plus the legs of multisport files.
  function parseFit(id, bytes, m) {
    if (!m) m = new FIT.Decoder(FIT.Stream.fromByteArray(Array.from(bytes))).read({ convertDateTimesToDates: true }).messages;
    var rec = m.recordMesgs || [];
    if (!rec.length) return null;
    var t0 = rec[0].timestamp.getTime(), col = { t: [], hr: [], power: [], speed: [], cadence: [], distance: [], altitude: [] }, route = [];
    var SEMI = 180 / Math.pow(2, 31), rel = function (d) { return d ? Math.round((d.getTime() - t0) / 1000) : null; };
    rec.forEach(function (r) {
      if (r.positionLat != null && r.positionLong != null) route.push([Math.round((r.timestamp.getTime() - t0) / 1000), Math.round(r.positionLat * SEMI * 1e6) / 1e6, Math.round(r.positionLong * SEMI * 1e6) / 1e6]);
      col.t.push(Math.round((r.timestamp.getTime() - t0) / 1000));
      col.hr.push(r.heartRate == null ? null : r.heartRate);
      col.power.push(r.power == null ? null : r.power);
      var sp = r.enhancedSpeed != null ? r.enhancedSpeed : r.speed; col.speed.push(sp == null ? null : Math.round(sp * 1000) / 1000);
      col.cadence.push(r.cadence == null ? null : r.cadence + (r.fractionalCadence || 0));
      col.distance.push(r.distance == null ? null : Math.round(r.distance * 10) / 10);
      var al = r.enhancedAltitude != null ? r.enhancedAltitude : r.altitude; col.altitude.push(al == null ? null : Math.round(al * 10) / 10);
    });
    var legs = (m.sessionMesgs || []).map(function (s) {
      return { sport: s.sport || '', sub_sport: s.subSport || '', start: s.startTime ? Math.round((s.startTime.getTime() - t0) / 1000) : 0,
        timer_s: s.totalTimerTime, elapsed_s: s.totalElapsedTime, distance_m: s.totalDistance, avg_hr: s.avgHeartRate, avg_power: s.avgPower, np: s.normalizedPower };
    });
    var lengths = (m.lengthMesgs || []).filter(function (l) { return l.lengthType === 'active'; }).map(function (l) { return { t: rel(l.startTime), dur: l.totalTimerTime, strokes: l.totalStrokes, stroke: l.swimStroke || '' }; });
    // Laps: auto splits, lap-button presses, or structured workout steps (warm-up / active / rest / cool-down).
    var laps = (m.lapMesgs || []).filter(function (l) { return l.startTime; }).map(function (l) {
      return { t: rel(l.startTime), dur: l.totalTimerTime, dist: l.totalDistance, speed: l.enhancedAvgSpeed != null ? l.enhancedAvgSpeed : l.avgSpeed, hr: l.avgHeartRate, max_hr: l.maxHeartRate,
        power: l.avgPower, intensity: String(l.intensity || ''), trigger: String(l.lapTrigger || '') };
    });
    // GPS route, thinned to about 1,000 points (enough for the map and for spotting repeated routes).
    var step = Math.max(1, Math.floor(route.length / 1000)), thin = route.filter(function (p, i) { return i % step === 0 || i === route.length - 1; });
    return Object.assign({ id: id, v: FIT_VERSION, legs: legs.length > 1 ? legs : [], lengths: lengths, laps: laps, route: thin }, col);
  }

  // Dates covered by a sync: a planned session in them with no activity counts as missed.
  function addRange(from, to) {
    var r = readLS(RANGES, null) || initialRanges(); r.push([from, to]);
    r.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    var out = [];
    r.forEach(function (x) { var l = out[out.length - 1]; if (l && x[0] <= TP.addDays(l[1], 1)) { if (x[1] > l[1]) l[1] = x[1]; } else out.push(x.slice()); });
    localStorage.setItem(storeKey(RANGES), JSON.stringify(out));
  }
  function initialRanges() { var s = readLS(RANGE, null); return s && s.from && s.to ? [[s.from, s.to]] : []; }
  G.covered = function (d) {
    var r = readLS(RANGES, null) || initialRanges();
    if (!r.length && G.acts.length) r = [[G.acts[G.acts.length - 1].date, G.acts[0].date]];
    return r.some(function (x) { return d >= x[0] && d <= x[1]; });
  };

  // Garmin's own thresholds (lactate threshold HR and pace, FTP) and gender for TRIMP.
  function fetchProfile() {
    return api('/userprofile-service/userprofile/settings').then(function (st) {
      var ud = (st && (st.userData || st)) || {};
      var p = { lthr: num(ud.lactateThresholdHeartRate), lt_speed: num(ud.lactateThresholdSpeed), ftp: num(ud.functionalThresholdPower || ud.ftp), gender: ud.gender || null, at: TP.today() };
      localStorage.setItem(storeKey(PROFILE), JSON.stringify(p));
    }).catch(function (e) { console.warn('Garmin profile', e); });
  }
  G.profile = function () { return readLS(PROFILE, {}); };

  // Sleep, overnight HRV and resting HR for each night (stored under the morning you wake up).
  function dig(o, path) { return path.split('.').reduce(function (v, k) { return v && typeof v === 'object' ? v[k] : undefined; }, o); }
  function first(o) { for (var i = 1; i < arguments.length; i++) { var v = dig(o, arguments[i]); if (v !== undefined && v !== null) return v; } return null; }
  function chunks(from, to, n) { var out = []; for (var d = from; d <= to; d = TP.addDays(d, n)) { var e = TP.addDays(d, n - 1); out.push([d, e < to ? e : to]); } return out; }
  function fetchWellness(from, to) {
    var w = {}, get = function (d) { return w[d] = w[d] || Object.assign({ date: d }, G.wellness.filter(function (x) { return x.date === d; })[0] || {}); };
    var seq = function (list, fn) { return list.reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve()); };
    var sleep = function () { return seq(chunks(from, to, 28), function (c) {
      G.progress = 'Downloading sleep and HRV from ' + TP.fmt(c[0], '%d %b') + '…'; TP.changed();
      return api('/sleep-service/sleep/dailySleepSummariesByDate?startDate=' + c[0] + '&endDate=' + c[1]).then(function (data) {
        var items = Array.isArray(data) ? data : data ? (data.dailySleepSummaries || data.data || data.individualStats || []) : [];
        items.forEach(function (it) {
          var dto = it.dailySleepDTO || it, d = first(dto, 'calendarDate') || first(it, 'calendarDate'); if (!d) return;
          var x = get(String(d).slice(0, 10));
          var sl = num(first(dto, 'sleepTimeSeconds', 'totalSleepTimeInSeconds', 'values.totalSleepTimeInSeconds'));
          if (sl) x.sleep_h = sl / 3600;
          var dp = num(first(dto, 'deepSleepSeconds', 'deepTime')), rm = num(first(dto, 'remSleepSeconds', 'remTime'));
          if (dp !== null) x.deep_h = dp / 3600;
          if (rm !== null) x.rem_h = rm / 3600;
          var sc = num(first(dto, 'sleepScores.overall.value', 'sleepScore', 'overallSleepScore.value')); if (sc !== null) x.sleep_score = sc;
          var rh = num(first(it, 'restingHeartRate') || first(dto, 'restingHeartRate')); if (rh) x.rhr = rh;
          var hv = num(first(it, 'avgOvernightHrv') || first(dto, 'avgOvernightHrv')); if (hv) x.hrv = hv;
        });
      });
    }); };
    var hrv = function () { return seq(chunks(from, to, 28), function (c) {
      return api('/hrv-service/hrv/daily/' + c[0] + '/' + c[1]).then(function (data) {
        var rows = (data && (data.hrvSummaries || data)) || [];
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
          if (!row || !row.calendarDate) return;
          var x = get(row.calendarDate), b = row.baseline || {};
          if (num(b.balancedLow)) x.hrv_low = num(b.balancedLow);
          if (num(b.balancedUpper)) x.hrv_high = num(b.balancedUpper);
          if (!x.hrv && num(row.lastNightAvg)) x.hrv = num(row.lastNightAvg);
          if (num(row.weeklyAvg)) x.hrv7d = num(row.weeklyAvg);
        });
      });
    }); };
    var rhr = function () { return seq(chunks(from, to, 180), function (c) {
      return api('/usersummary-service/v2/dailysummaries?startDate=' + c[0] + '&endDate=' + c[1]).then(function (data) {
        var rows = (data && (data.data || data)) || [];
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
          var v = row && num(dig(row, 'heartRate.restingValue') || row.restingHeartRate);
          if (row && row.calendarDate && v) { var x = get(row.calendarDate); if (!x.rhr) x.rhr = v; }
        });
      });
    }); };
    var keep = function () {
      var list = Object.keys(w).map(function (k) { return w[k]; });
      return putAll('wellness', list).then(function () { return getAll('wellness'); }).then(function (all) { G.wellness = (all || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; }); G.ver++; });
    };
    // Each kind is optional: whatever Garmin returns is kept.
    var soft = function (fn) { return function () { return fn().catch(function (e) { if (/limiting/.test(e.message)) throw e; console.warn('wellness', e); }); }; };
    return soft(sleep)().then(soft(hrv)).then(soft(rhr)).then(keep, function (e) { return keep().then(function () { throw e; }); });
  }

  // Sync: list activities in the range, keep their summaries, fetch each new FIT file, then sleep / HRV
  // and Garmin's thresholds, and prepare the analysis.
  G.sync = function (from, to, withFit) {
    if (G.syncing) return G.syncing;
    if (!G.consented()) { G.withConsent(function () { G.sync(from, to, withFit); }); return Promise.resolve(); }
    G.progress = 'Finding activities…';
    var today = TP.today(); if (to > today) to = today;
    G.syncing = search(from, to).then(function (list) {
      var acts = list.map(summary), byId = {};
      G.acts.forEach(function (a) { byId[a.id] = a; });
      acts.forEach(function (a) { var o = byId[a.id]; a.fit = !!(o && o.fit); a.fitv = o && o.fitv; byId[a.id] = a; });
      G.acts = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
      G.ver++;
      return putAll('acts', acts).then(function () {
        if (!withFit) return { found: acts.length, fit: 0 };
        var todo = acts.filter(function (a) { return !a.fit || (a.fitv || 1) < FIT_VERSION; }), done = 0, failed = 0;
        return todo.reduce(function (chain, a, i) {
          return chain.then(function () {
            G.progress = 'Downloading FIT files ' + (i + 1) + ' of ' + todo.length + ' (routes, laps and second-by-second data)…'; TP.changed();
            return api('/download-service/files/activity/' + a.id, true).then(unzip).then(function (bytes) {
              var st = parseFit(a.id, bytes); a.fit = true; a.fitv = FIT_VERSION;
              return (st ? putAll('streams', [st]) : Promise.resolve()).then(function () { done++; delete G.frecs[a.id]; return putAll('acts', [a]); });
            }).catch(function (e) { failed++; console.warn('FIT', a.id, e); if (/limiting/.test(e.message)) throw e; });
          });
        }, Promise.resolve()).then(function () { return { found: acts.length, fit: done, failed: failed }; });
      });
    }).then(function (r) {
      addRange(from, to);
      return fetchProfile().then(function () { return fetchWellness(from, to).catch(function (e) { r.wellnessError = e.message; }); }).then(function () { return r; });
    }).then(function (r) {
      TP.toast('Synced ' + r.found + ' activities' + (r.fit ? ', ' + r.fit + ' new FIT files' : '') + (r.failed ? ' (' + r.failed + ' couldn’t be read)' : '') + '.');
      return r;
    }).catch(function (e) { TP.toast(e.message, 'error'); })
      .finally(function () {
        G.syncing = null; G.progress = ''; G.ver++; TP.changed();
        G.prepare().then(function () { if (TP.match) TP.match.askSoon(); });
      });
    TP.changed();   // now that a sync is under way: progress shows and the button reads "Syncing…"
    return G.syncing;
  };

  // Re-download one activity's FIT file (for an activity saved before routes and laps were kept).
  G.refetch = function (id) {
    var a = G.acts.filter(function (x) { return x.id === id; })[0];
    if (!a || !G.connected()) return Promise.reject(new Error('Connect Garmin to load this.'));
    if (!G.consented()) return Promise.reject(new Error('Agree to Training Planner using your Garmin data (in Analysis) to load this.'));
    return api('/download-service/files/activity/' + id, true).then(unzip).then(function (bytes) {
      var st = parseFit(id, bytes); a.fit = true; a.fitv = FIT_VERSION; delete G.frecs[id];
      return (st ? putAll('streams', [st]) : Promise.resolve()).then(function () { return putAll('acts', [a]); })
        .then(function () { return G.prepare(); }).then(function () { return G.frecs[id] ? null : G.prepare(); }).then(function () { return st; });
    });
  };
  // For the history upload (import.js).
  G.internals = { parseFit: parseFit, putAll: putAll, getAll: getAll, addRange: addRange, disciplineFor: disciplineFor, FIT_VERSION: FIT_VERSION };
  G.needsRefetch = function (a) { return a && a.fit && (a.fitv || 1) < FIT_VERSION; };
  // The first date with Garmin data on this device (the load model needs ~6 weeks before a block).
  G.historyStart = function () {
    var r = readLS(RANGES, null) || initialRanges(), first = G.acts.length ? G.acts[G.acts.length - 1].date : null;
    if (r.length && (!first || r[0][0] < first)) return r[0][0];
    return first;
  };

  // Work out the analysis features of every activity with a FIT file that doesn't have them yet
  // (in small steps, so the page stays responsive).
  var preparing = null;
  G.prepare = function () {
    if (preparing) return preparing;
    var todo = G.acts.filter(function (a) { return a.fit && (!G.frecs[a.id] || G.frecs[a.id].v !== TP.TA.FEATURE_VERSION); });
    if (!todo.length) return Promise.resolve();
    G.prep = { done: 0, total: todo.length }; TP.changed();
    var batch = [];
    preparing = todo.reduce(function (chain, a) {
      return chain.then(function () {
        return G.stream(a.id).then(function (raw) {
          var rec; try { rec = TP.TA.activityFeatures(a, raw); } catch (e) { console.warn('features', a.id, e); rec = { id: a.id, v: TP.TA.FEATURE_VERSION, f: { moving_s: null }, legs: null }; }
          G.frecs[a.id] = rec; batch.push(rec); G.prep.done++;
          var el = document.getElementById('g-prep'); if (el) el.textContent = 'Analysing activities: ' + G.prep.done + ' of ' + G.prep.total + '…';
          if (batch.length >= 20) { var b = batch; batch = []; return putAll('feats', b); }
        }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); });
      });
    }, Promise.resolve()).then(function () { return putAll('feats', batch); }).catch(function (e) { console.warn('prepare', e); })
      .then(function () { preparing = null; G.prep = null; G.ver++; TP.changed(); });
    return preparing;
  };

  // Everything the analysis needs, worked out once and reused until activities, sleep data or
  // thresholds change.
  var cache = null;
  G.ctx = function () {
    var ov = (TP.mine && TP.mine.get('settings').thresholds) || {}, key = G.ver + '|' + JSON.stringify(ov) + '|' + uid;
    if (cache && cache.key === key) return cache;
    var A = TP.TA, b = A.buildIndex(G.acts, G.frecs), gp = G.profile();
    var prof = A.estimateProfile(b.idx, b.feats, gp, G.wellness, ov);
    cache = { key: key, historyStart: G.historyStart(), idx: b.idx, feats: b.feats, transitions: b.transitions, prof: prof, scored: A.score(b.idx, b.feats, prof),
      wellness: G.wellness, garminProfile: gp, overrides: ov, compliance: function (f, t, bid) { return TP.match.compliance(f, t, bid); } };
    cache.byId = {}; cache.scored.forEach(function (a) { cache.byId[a.id] = a; });
    return cache;
  };
  // A scored activity (or the legs of a multisport one) by its Garmin id.
  G.scoredFor = function (id) {
    var c = G.ctx(); if (c.byId[id]) return [c.byId[id]];
    return c.scored.filter(function (a) { return a.parent_id === id; });
  };

  // --- Page ---
  TP.view.gtab = TP.view.gtab || 'Overview';
  TP.renderGarmin = function (root) {
    if (TP.view.review) { TP.blocks.page(root, TP.view.review); return; }
    root.appendChild(h('div', { class: 'page-head page-head-row' }, h('h2', null, 'Analysis'), TP.glossaryButton()));
    // First time: the full instructions. After that, one line to sync (or reconnect).
    if (!G.connected() && !G.acts.length) {
      root.appendChild(G.importCard());
      root.appendChild(h('div', { class: 'sync-bar' }, h('span', { class: 'small grow muted' }, 'Have a Garmin personal API key? Connect it to sync new activities automatically.'),
        h('button', { class: 'btn btn-sm', onclick: function () { showConnect = !showConnect; TP.changed(); } }, showConnect ? 'Hide' : 'Connect with API key')));
      if (showConnect) root.appendChild(connectCard());
    } else root.appendChild(syncBar());
    if (G.prep) root.appendChild(h('div', { class: 'panel prep' }, h('div', { class: 'spinner' }), h('span', { id: 'g-prep' }, 'Analysing activities: ' + G.prep.done + ' of ' + G.prep.total + '…')));
    var tabs = ['Overview', 'Block reviews'], body = h('div');
    if (tabs.indexOf(TP.view.gtab) < 0) TP.view.gtab = 'Overview';
    root.appendChild(TP.chips(tabs.map(function (t) { return { value: t, label: t }; }), TP.view.gtab, function (v) { TP.view.gtab = v; draw(); }, 'tabs'));
    root.appendChild(body);
    function draw() {
      TP.clear(body);
      try {
        if (!G.loaded) body.appendChild(h('p', { class: 'muted' }, 'Loading…'));
        else if (G.acts.length && G.consentKnown() && !G.consented()) body.appendChild(consentPanel());
        else if (!G.acts.length) body.appendChild(h('div', { class: 'empty' }, h('h3', null, 'No Garmin activities yet'), h('p', null, G.connected() ? 'Sync from Garmin above. Twelve weeks or more gives the analysis enough to work with.' : 'Connect Garmin above, then sync.')));
        else if (TP.view.gtab === 'Block reviews') TP.blocks.render(body);
        else TP.coach.render(body);
      } catch (e) { console.error(e); body.appendChild(h('div', { class: 'panel' }, 'Something went wrong drawing this page: ' + e.message)); }
    }
    draw();
  };
  // The last date synced, and a one-press sync that picks up from there.
  G.lastSynced = function () { var r = readLS(RANGES, null) || initialRanges(); return r.length ? r[r.length - 1][1] : null; };
  // Sync from a few days before the last sync (a new device: the last six months).
  G.quickSync = function () {
    var last = G.lastSynced(), today = TP.today();
    var from = last ? (TP.addDays(last, -3) < TP.addDays(today, -365) ? TP.addDays(today, -365) : TP.addDays(last, -3)) : TP.addDays(today, -182);
    return G.sync(from, today, true);
  };
  // Home page: one button, outlined green when Garmin is connected and red when it isn't. Connected,
  // it syncs; otherwise it opens Analysis, where Garmin data is uploaded or connected.
  G.statusButton = function () {
    var on = G.connected(), last = G.lastSynced();
    var b = h('button', { class: 'btn btn-sm g-status ' + (on ? 'g-on' : 'g-off'), disabled: !!G.syncing,
      title: on ? 'Garmin connected' + (last ? ', synced to ' + TP.fmt(last, '%d %b') : '') + '. Press to sync.' : 'Garmin not connected. Press to upload your Garmin data or connect.',
      onclick: function () { if (on) G.quickSync(); else TP.go('garmin'); } },
      h('i', { class: 'g-dot' }), G.syncing ? 'Syncing…' : 'Garmin');
    return h('div', { class: 'g-status-wrap' }, b, G.progress ? h('div', { class: 'g-status-msg' }, G.progress) : null);
  };
  var showOptions = false, showConnect = false, showImport = false;
  function importBtn() { return h('button', { class: 'btn btn-sm', onclick: function () { showImport = !showImport; TP.changed(); } }, TP.icon('upload'), showImport ? 'Hide upload' : 'Upload history'); }
  function withImport(wrap) { if (showImport || G.importing()) wrap.appendChild(G.importCard()); return wrap; }
  // The one-line sync bar (new users get a link to the connection instructions instead).
  G.syncBar = function () {
    if (!G.connected() && !G.acts.length) return h('div', { class: 'sync-bar' }, h('span', { class: 'small grow' }, h('b', null, 'Connect Garmin'), h('span', { class: 'muted' }, ' to see your training, fitness and health here.')),
      h('button', { class: 'btn btn-sm btn-primary', onclick: function () { TP.go('garmin'); } }, 'Connect'));
    return syncBar();
  };
  function syncBar() {
    var last = G.lastSynced(), today = TP.today();
    if (!G.connected()) {
      var bar0 = h('div', { class: 'sync-bar' }, h('span', { class: 'muted small grow' }, G.acts.length + ' Garmin activities stored on this device'), importBtn(),
        h('button', { class: 'btn btn-sm', onclick: function () { showConnect = !showConnect; TP.changed(); } }, showConnect ? 'Hide' : 'Connect Garmin'));
      return withImport(showConnect ? h('div', null, bar0, connectCard()) : h('div', null, bar0));
    }
    var quick = h('button', { class: 'btn btn-sm btn-primary', disabled: !!G.syncing, onclick: G.quickSync }, TP.icon('download'), G.syncing ? 'Syncing…' : 'Sync');
    var bar = h('div', { class: 'sync-bar' },
      h('span', { class: 'small grow' }, h('b', null, 'Garmin connected'), h('span', { class: 'muted' }, ' · ' + G.acts.length + ' activities' + (last ? ' · synced to ' + TP.fmt(last, '%d %b') : ''))),
      quick, importBtn(), h('button', { class: 'btn btn-sm', onclick: function () { showOptions = !showOptions; TP.changed(); } }, showOptions ? 'Hide options' : 'Options'));
    var wrap = h('div', null, bar);
    if (G.progress) wrap.appendChild(h('div', { class: 'sync-progress' }, G.progress));
    if (showOptions) wrap.appendChild(syncCard());
    return withImport(wrap);
  }

  function connectCard() {
    var key = TP.input('password', '', { placeholder: 'Paste your Garmin API key', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    var go = h('button', { class: 'btn btn-primary', onclick: function () {
      G.withConsent(function () {
      go.disabled = true; go.textContent = 'Connecting…';
      G.connect(key.value).then(function () { TP.toast('Garmin connected.'); TP.changed(); })
        .catch(function (e) { TP.toast(e.message, 'error'); }).finally(function () { go.disabled = false; go.textContent = 'Connect'; });
      });
    } }, 'Connect');
    var step = function (n, body) { return h('li', null, h('span', { class: 'step-n' }, n), h('div', null, body)); };
    return h('div', { class: 'panel garmin-connect' },
      h('div', { class: 'panel-h' }, 'Connect Garmin with your personal API key'),
      h('ol', { class: 'steps-list' },
        step(1, [h('b', null, 'Open Garmin Connect’s API key page. '), 'On a computer or your phone’s browser, go to ',
          h('a', { href: 'https://connect.garmin.com/app/settings/personalApiToken', target: '_blank', rel: 'noopener' }, 'connect.garmin.com/app/settings/personalApiToken'),
          ' and sign in with your Garmin account (in Garmin Connect on the web: your profile picture → Settings → Personal API Key).']),
        step(2, [h('b', null, 'Select Create Key. '), 'Read and accept Garmin’s terms.']),
        step(3, [h('b', null, 'Choose how long it lasts. '), '1 year is easiest. Garmin emails you about a week before it expires, and you can make a new one the same way.']),
        step(4, [h('b', null, 'Copy the key straight away. '), 'Garmin shows it only once. If you lose it, delete it on that page and create a new one.']),
        step(5, [h('b', null, 'Paste it below and press Connect.')])),
      h('div', { class: 'key-row' }, TP.revealable(key, 'API key'), go),
      h('p', { class: 'hint' }, 'Treat the key like a password. It’s kept only in this browser on this device and is never added to your plan or account, so connect each device separately. ' +
        'Requests pass through this site’s relay because Garmin doesn’t accept them straight from a web page; the relay doesn’t store anything. ' +
        'The personal API is for your own data only, and it’s read-only: nothing on your Garmin account can be changed from here.'));
  }

  function syncCard() {
    var saved = readLS(RANGE, {});
    var from = TP.input('date', saved.from || TP.addDays(TP.today(), -182)), to = TP.input('date', TP.today());
    var fit = TP.input('checkbox', '', { checked: saved.fit !== false });
    var k = G.key();
    var btn = h('button', { class: 'btn btn-primary', disabled: !!G.syncing, onclick: function () {
      if (!from.value || !to.value || from.value > to.value) { TP.toast('Pick a start date before the end date.', 'warn'); return; }
      localStorage.setItem(storeKey(RANGE), JSON.stringify({ from: from.value, to: to.value, fit: fit.checked }));
      G.sync(from.value, to.value, fit.checked);
    } }, TP.icon('download'), G.syncing ? 'Syncing…' : 'Sync from Garmin');
    return h('div', { class: 'panel' },
      h('div', { class: 'panel-top' }, h('div', null, h('div', { class: 'panel-h' }, 'Garmin connected'),
        h('div', { class: 'muted small' }, 'API key …' + k.slice(-4) + ' · saved on this device · ' + G.acts.length + ' activities' + (G.wellness.length ? ', ' + G.wellness.length + ' nights of sleep data' : '') + ' stored here')),
        h('a', { href: '#', class: 'small', onclick: function (e) {
          e.preventDefault();
          TP.confirm('Disconnect Garmin on this device? The API key is removed from this browser. Synced activities are kept unless you also clear them in Settings.', 'Disconnect', function () { G.disconnect(); });
        } }, 'Disconnect')),
      h('div', { class: 'sync-row' }, TP.field('From', from), TP.field('To', to),
        h('label', { class: 'check' }, fit, 'Also download FIT files (heart rate, power, pace each second – needed for the full analysis)'), btn),
      G.progress ? h('div', { class: 'sync-progress' }, G.progress) : null,
      h('div', { class: 'hint' }, 'Each sync also fetches sleep, overnight HRV and resting heart rate for those dates, and your Garmin thresholds. Activities already on this device aren’t downloaded again.'));
  }

})(window.TP);
