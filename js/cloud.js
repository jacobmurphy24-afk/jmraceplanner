// Accounts and shared plans (Firebase). You sign in before using the app; every plan belongs to an
// account and is stored online, syncs live to everyone in it, and keeps working offline (changes upload
// when you're back online). Without a Firebase project configured, the app runs on this device only.
(function (TP) {
  var F = window.FB, cfg = window.TP_FIREBASE_CONFIG;
  var COLLS = ['events', 'sessions', 'templates'];
  var auth, db, unsubPlans = null, unsubInvites = null, unsubContent = [];
  var C = TP.cloud = {
    enabled: false, ready: false, user: null, plans: [], invites: [], activeId: null, plan: null, synced: true,
    plansLoaded: false, needsStart: false,
    isActive: function () { return !!C.activeId && !!C.plan; },
    role: function () { return C.plan && C.user ? C.plan.roles[C.user.uid] : null; },
    canEdit: function () { return !C.isActive() || ['owner', 'editor'].indexOf(C.role()) >= 0; }
  };
  var baseline = { events: {}, sessions: {}, templates: {} };
  var loaded = {};

  function emulator() { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]emulator\b/.test(location.search); }
  function activeKey() { return 'tp-active-plan-' + (C.user ? C.user.uid : ''); }
  function clean(x) { return JSON.parse(JSON.stringify(x)); }
  // Same content, same string: keys sorted at every level, so field order never looks like a change.
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + stable(x[k]); }).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  // An item as the app holds it, so stored and current copies compare equal.
  function norm(coll, obj, key) {
    if (coll === 'sessions') { var s = TP.normaliseSession(Object.assign({}, obj, { id: key })); delete s.id; return s; }
    if (coll === 'events') return TP.normaliseEvent(obj);
    return obj;
  }
  // Template names can contain '/' and other characters a document id can't.
  function tplId(name) { return encodeURIComponent(name).replace(/\./g, '%2E').slice(0, 900); }

  C.init = function () {
    if (!F || !(cfg || emulator())) return;           // no Firebase project set up yet: device-only mode
    var app = F.initializeApp(cfg || { apiKey: 'demo', projectId: 'demo-jmraceplanner', authDomain: 'localhost' });
    auth = F.getAuth(app);
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
    if (emulator()) { F.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', 8080); }
    C.enabled = true;
    F.onAuthStateChanged(auth, function (u) {
      stopAll();
      C.activeId = null; C.plan = null; C.plansLoaded = false; C.needsStart = false;
      TP.state = TP.normalise({ prefs: TP.state.prefs });
      document.body.classList.remove('readonly');
      C.user = u ? { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || '', verified: u.emailVerified } : null;
      C.ready = true;
      if (TP.garmin) TP.garmin.setUser(C.user ? C.user.uid : null);
      if (C.user) listenPlans();
      TP.changed();
    });
  };

  function stopAll() {
    if (unsubPlans) unsubPlans(); if (unsubInvites) unsubInvites();
    unsubPlans = unsubInvites = null; stopContent(); C.plans = []; C.invites = [];
  }
  function stopContent() { unsubContent.forEach(function (u) { u(); }); unsubContent = []; }

  function listenPlans() {
    var uid = C.user.uid;
    // includeMetadataChanges: also hear when the server confirms what the device cache said (e.g. "no plans yet").
    unsubPlans = F.onSnapshot(F.query(F.collection(db, 'plans'), F.where('memberIds', 'array-contains', uid)), { includeMetadataChanges: true }, function (snap) {
      C.plans = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      // Offline on a device that has never loaded this account's plans: wait for the server.
      if (snap.metadata.fromCache && !snap.docs.length && !C.plansLoaded) return;
      C.plansLoaded = true;
      if (C.activeId) {
        C.plan = C.plans.filter(function (p) { return p.id === C.activeId; })[0] || null;
        // Removed from the plan (or it was deleted): open another one.
        if (!C.plan && !snap.metadata.fromCache) { TP.toast('You no longer have access to that plan.', 'warn'); C.closePlan(); }
      } else C.pickPlan();
      document.body.classList.toggle('readonly', !C.canEdit());
      TP.changed();
    }, function (e) { console.warn('plans', e); });
    // Invites need a verified email (see firestore.rules). The sign-in token can still say "unverified" for
    // up to an hour after confirming, so refresh it first when the two disagree.
    if (!C.user.verified) return;
    var u = auth.currentUser;
    u.getIdTokenResult().then(function (t) { return t.claims.email_verified ? null : u.getIdToken(true); }).catch(function () {}).then(function () {
      if (!C.user || C.user.uid !== uid || unsubInvites) return;
      unsubInvites = F.onSnapshot(F.query(F.collection(db, 'plans'), F.where('inviteEmails', 'array-contains', C.user.email)), function (snap) {
        C.invites = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        TP.changed();
      }, function (e) { console.warn('invites', e); });
    });
  }

  // --- Opening a plan ---
  C.open = function (id, quiet) {
    stopContent();
    C.activeId = id; localStorage.setItem(activeKey(), id);
    C.plan = C.plans.filter(function (p) { return p.id === id; })[0] || C.plan;
    baseline = { events: {}, sessions: {}, templates: {} }; loaded = {};
    TP.state = TP.normalise({ prefs: TP.state.prefs });
    COLLS.forEach(function (coll) {
      unsubContent.push(F.onSnapshot(F.collection(db, 'plans', id, coll), { includeMetadataChanges: true }, function (snap) {
        // A snapshot that changes nothing on screen (only the device cache catching up) doesn't redraw,
        // so the page isn't rebuilt under your finger while you scroll.
        var changes = snap.docChanges(), wasSynced = C.synced, wasLoaded = loaded[coll];
        changes.forEach(function (ch) {
          var d = ch.doc.data(), key = coll === 'templates' ? d._name : ch.doc.id;
          if (ch.type === 'removed') { delete baseline[coll][ch.doc.id]; remove(coll, key); return; }
          var obj = Object.assign({}, d); delete obj._name;
          obj = norm(coll, obj, key);
          baseline[coll][ch.doc.id] = stable(obj);
          put(coll, key, clean(obj));
        });
        loaded[coll] = true;
        C.synced = !snap.metadata.hasPendingWrites;
        if (!changes.length && wasLoaded && wasSynced === C.synced) return;
        TP.state = TP.normalise(TP.state);
        TP.changed();
      }, function (e) {
        console.warn(coll, e);
        if (e.code === 'permission-denied' && C.activeId === id) { TP.toast('You no longer have access to that plan.', 'warn'); C.closePlan(); }
      }));
    });
    document.body.classList.toggle('readonly', !C.canEdit());
    if (!quiet) TP.toast('Opened “' + (C.plan ? C.plan.name : 'plan') + '”.');
    TP.changed();
  };
  // Open the plan used last on this device, or the first one; with none yet, ask how to start.
  C.pickPlan = function (exclude) {
    if (C.creating) return;                    // createPlan opens the new plan itself
    var plans = C.plans.filter(function (p) { return p.id !== exclude; }), saved = localStorage.getItem(activeKey());
    var target = plans.filter(function (p) { return p.id === saved; })[0] || plans[0];
    C.needsStart = !target;
    if (target) C.open(target.id, true); else TP.changed();
  };
  C.closePlan = function (exclude) {
    var was = C.activeId;
    stopContent(); C.activeId = null; C.plan = null;
    localStorage.removeItem(activeKey());
    TP.state = TP.normalise({ prefs: TP.state.prefs });
    document.body.classList.remove('readonly');
    C.pickPlan(exclude || was);
  };
  function put(coll, key, obj) {
    if (coll === 'events') TP.state.events[key] = obj;
    else if (coll === 'templates') TP.state.templates[key] = obj;
    else {
      obj.id = key;
      var i = TP.state.sessions.findIndex(function (s) { return s.id === key; });
      if (i >= 0) TP.state.sessions[i] = obj; else TP.state.sessions.push(obj);
    }
  }
  function remove(coll, key) {
    if (coll === 'sessions') TP.state.sessions = TP.state.sessions.filter(function (s) { return s.id !== key; });
    else delete TP.state[coll][key];
  }

  // The open plan as documents, keyed the way they're stored.
  function currentDocs() {
    var out = { events: {}, sessions: {}, templates: {} };
    Object.keys(TP.state.events).forEach(function (id) { out.events[id] = clean(TP.state.events[id]); });
    TP.state.sessions.forEach(function (s) { var x = clean(s); delete x.id; out.sessions[s.id] = x; });
    Object.keys(TP.state.templates).forEach(function (n) { out.templates[tplId(n)] = Object.assign(clean(TP.state.templates[n]), { _name: n }); });
    return out;
  }
  function stringifyDoc(coll, d) { var x = Object.assign({}, d); if (coll === 'templates') delete x._name; return stable(x); }

  // Send what changed since the last sync: one write per new/changed item, one delete per removed item.
  C.push = function () {
    if (!C.isActive()) return;
    if (!C.canEdit()) { TP.toast('You can view this plan but not change it.', 'warn'); C.open(C.activeId, true); return; }
    if (!COLLS.every(function (c) { return loaded[c]; })) return;
    var cur = currentDocs(), ops = [];
    COLLS.forEach(function (coll) {
      Object.keys(cur[coll]).forEach(function (id) {
        var s = stringifyDoc(coll, cur[coll][id]);
        if (baseline[coll][id] !== s) { ops.push({ set: true, coll: coll, id: id, data: cur[coll][id] }); baseline[coll][id] = s; }
      });
      Object.keys(baseline[coll]).forEach(function (id) { if (!cur[coll][id]) { ops.push({ set: false, coll: coll, id: id }); delete baseline[coll][id]; } });
    });
    if (!ops.length) return;
    writeOps(C.activeId, ops).then(function () {
      return F.updateDoc(F.doc(db, 'plans', C.activeId), { updatedAt: F.serverTimestamp() });
    }).catch(function (e) { TP.toast('Couldn’t save to the shared plan: ' + e.message, 'error'); C.open(C.activeId, true); });
  };
  function writeOps(planId, ops) {
    var chain = Promise.resolve();
    for (var i = 0; i < ops.length; i += 400) (function (chunk) {
      chain = chain.then(function () {
        var b = F.writeBatch(db);
        chunk.forEach(function (o) {
          var ref = F.doc(db, 'plans', planId, o.coll, o.id);
          if (o.set) b.set(ref, o.data); else b.delete(ref);
        });
        return b.commit();
      });
    })(ops.slice(i, i + 400));
    return chain;
  }

  // --- Account ---
  function profileDoc() { return F.setDoc(F.doc(db, 'users', C.user.uid), { name: C.user.name, email: C.user.email }, { merge: true }); }
  C.signUp = function (name, email, password) {
    return F.createUserWithEmailAndPassword(auth, email.trim(), password).then(function (cred) {
      return F.updateProfile(cred.user, { displayName: name.trim() }).then(function () {
        C.user = { uid: cred.user.uid, email: cred.user.email.toLowerCase(), name: name.trim(), verified: false };
        return Promise.all([profileDoc(), F.sendEmailVerification(cred.user)]);
      });
    });
  };
  C.signIn = function (email, password) { return F.signInWithEmailAndPassword(auth, email.trim(), password); };
  C.signOut = function () { return F.signOut(auth); };
  C.resetPassword = function (email) { return F.sendPasswordResetEmail(auth, email.trim()); };
  C.resendVerification = function () { return F.sendEmailVerification(auth.currentUser); };
  // After clicking the link in the email: refresh the account so invites appear.
  C.refreshVerified = function () {
    var u = auth.currentUser;
    return F.reload(u).then(function () { return u.getIdToken(true); }).then(function () {
      C.user.verified = u.emailVerified;
      if (u.emailVerified) { stopAll(); listenPlans(); if (C.activeId) C.open(C.activeId, true); }
      TP.changed();
      return u.emailVerified;
    });
  };
  C.rename = function (name) {
    var u = auth.currentUser;
    return F.updateProfile(u, { displayName: name.trim() }).then(function () { C.user.name = name.trim(); TP.changed(); return profileDoc(); });
  };

  // --- Plans ---
  function me() { var o = {}; o[C.user.uid] = { name: C.user.name || C.user.email, email: C.user.email }; return o; }
  // A new online plan, optionally starting with a copy of this device's plan.
  C.createPlan = function (name, copyLocal) {
    var ref = F.doc(F.collection(db, 'plans')), uid = C.user.uid, roles = {}; roles[uid] = 'owner';
    C.creating = true;
    return F.setDoc(ref, { name: name.trim().slice(0, 80) || 'My plan', ownerId: uid, memberIds: [uid], roles: roles, people: me(),
      inviteEmails: [], inviteRoles: {}, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() })
      .then(function () {
        if (!copyLocal) return;
        var local = TP.localPlan(), ops = [];
        Object.keys(local.events).forEach(function (id) { ops.push({ set: true, coll: 'events', id: id, data: clean(local.events[id]) }); });
        local.sessions.forEach(function (s) { var x = clean(s); delete x.id; ops.push({ set: true, coll: 'sessions', id: s.id, data: x }); });
        Object.keys(local.templates).forEach(function (n) { ops.push({ set: true, coll: 'templates', id: tplId(n), data: Object.assign(clean(local.templates[n]), { _name: n }) }); });
        return writeOps(ref.id, ops);
      })
      .then(function () {
        C.creating = false; C.needsStart = false;
        C.plans = C.plans.concat([{ id: ref.id, name: name, roles: roles, memberIds: [uid], people: me(), inviteEmails: [], inviteRoles: {}, ownerId: uid }]);
        C.open(ref.id, true); return ref.id;
      }, function (e) { C.creating = false; throw e; });
  };
  function planRef(id) { return F.doc(db, 'plans', id || C.activeId); }
  function planData(id) { return C.plans.concat(C.invites).filter(function (p) { return p.id === id; })[0]; }
  C.renamePlan = function (name) { return F.updateDoc(planRef(), { name: name.trim().slice(0, 80), updatedAt: F.serverTimestamp() }); };
  C.deletePlan = function (id) {
    // Contents first: their rules check the plan still exists.
    return Promise.all(COLLS.map(function (coll) { return F.getDocs(F.collection(db, 'plans', id, coll)); })).then(function (snaps) {
      var ops = [];
      snaps.forEach(function (s, i) { s.docs.forEach(function (d) { ops.push({ set: false, coll: COLLS[i], id: d.id }); }); });
      if (id === C.activeId) C.closePlan(id);
      return writeOps(id, ops);
    }).then(function () { return F.deleteDoc(planRef(id)); });
  };
  C.invite = function (email, role) {
    var p = planData(C.activeId); email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Promise.reject(new Error('That doesn’t look like an email address.'));
    if (Object.keys(p.people || {}).some(function (k) { return (p.people[k].email || '').toLowerCase() === email; })) return Promise.reject(new Error('They’re already in this plan.'));
    var ir = Object.assign({}, p.inviteRoles); ir[email] = role;
    return F.updateDoc(planRef(), { inviteEmails: Object.keys(ir), inviteRoles: ir, updatedAt: F.serverTimestamp() });
  };
  // Emails the invitation (through the site's relay, which checks you own the plan). Resolves when sent;
  // rejects with a message to show if it couldn't be.
  C.emailInvite = function (email) {
    var id = C.activeId;
    return auth.currentUser.getIdToken().then(function (t) {
      return fetch('https://garmin.jmraceplanner.co.uk/invite', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: id, email: email.trim().toLowerCase() }) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok || !b.sent) throw new Error(b.error || 'The invite email couldn’t be sent.'); });
    }, function () { throw new Error('No connection, so the invite email couldn’t be sent.'); });
  };
  C.cancelInvite = function (email) {
    var p = planData(C.activeId), ir = Object.assign({}, p.inviteRoles); delete ir[email];
    return F.updateDoc(planRef(), { inviteEmails: Object.keys(ir), inviteRoles: ir, updatedAt: F.serverTimestamp() });
  };
  C.setRole = function (uid, role) {
    var p = planData(C.activeId), r = Object.assign({}, p.roles); r[uid] = role;
    return F.updateDoc(planRef(), { roles: r, updatedAt: F.serverTimestamp() });
  };
  C.removeMember = function (uid) {
    var p = planData(C.activeId), r = Object.assign({}, p.roles), pe = Object.assign({}, p.people); delete r[uid]; delete pe[uid];
    return F.updateDoc(planRef(), { memberIds: p.memberIds.filter(function (x) { return x !== uid; }), roles: r, people: pe, updatedAt: F.serverTimestamp() });
  };
  C.accept = function (id) {
    var p = planData(id), uid = C.user.uid, em = C.user.email, r = Object.assign({}, p.roles), pe = Object.assign({}, p.people), ir = Object.assign({}, p.inviteRoles);
    r[uid] = p.inviteRoles[em]; pe[uid] = { name: C.user.name || em, email: em }; delete ir[em];
    return F.updateDoc(planRef(id), { memberIds: p.memberIds.concat([uid]), roles: r, people: pe, inviteEmails: Object.keys(ir), inviteRoles: ir, updatedAt: F.serverTimestamp() })
      .then(function () { C.invites = C.invites.filter(function (x) { return x.id !== id; }); C.plans = C.plans.concat([Object.assign({}, p, { roles: r, memberIds: p.memberIds.concat([uid]) })]); C.open(id); });
  };
  C.decline = function (id) {
    var p = planData(id), ir = Object.assign({}, p.inviteRoles); delete ir[C.user.email];
    return F.updateDoc(planRef(id), { inviteEmails: Object.keys(ir), inviteRoles: ir, updatedAt: F.serverTimestamp() });
  };
  C.leave = function (id) {
    var p = planData(id), uid = C.user.uid, r = Object.assign({}, p.roles), pe = Object.assign({}, p.people); delete r[uid]; delete pe[uid];
    if (id === C.activeId) C.closePlan(id);
    return F.updateDoc(planRef(id), { memberIds: p.memberIds.filter(function (x) { return x !== uid; }), roles: r, people: pe, updatedAt: F.serverTimestamp() });
  };

  // Friendly messages for the errors people actually hit.
  // This account's own data that isn't part of a plan (Garmin links, block reviews, thresholds):
  // users/{uid}/garmin/{name}, private to the account and the same on every device it signs in on.
  C.listenMine = function (name, cb) {
    if (!C.user) return function () {};
    return F.onSnapshot(F.doc(db, 'users', C.user.uid, 'garmin', name), function (s) { cb(s.exists() ? s.data() : null); }, function (e) { console.warn('garmin data', name, e); });
  };
  C.saveMine = function (name, data) {
    if (!C.user) return Promise.resolve();
    return F.setDoc(F.doc(db, 'users', C.user.uid, 'garmin', name), clean(data)).catch(function (e) { TP.toast(C.message(e), 'error'); });
  };

  C.message = function (e) {
    var m = { 'auth/invalid-credential': 'Email or password is wrong.', 'auth/wrong-password': 'Email or password is wrong.', 'auth/user-not-found': 'No account with that email.',
      'auth/email-already-in-use': 'There’s already an account with that email – sign in instead.', 'auth/weak-password': 'Use a password of at least 6 characters.',
      'auth/invalid-email': 'That doesn’t look like an email address.', 'auth/too-many-requests': 'Too many attempts – wait a few minutes and try again.',
      'auth/network-request-failed': 'No connection – check you’re online.', 'permission-denied': 'You don’t have permission to do that.' }[e && e.code];
    return m || (e && e.message) || 'Something went wrong.';
  };
})(window.TP);
