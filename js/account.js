// Account and sharing screens: sign in / create account, and "Plans & sharing"
// (your plans, invitations, and who can see or edit the open plan).
(function (TP) {
  var h = TP.h, C = TP.cloud;
  var ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'View only' };

  function busy(btn, p) {
    var label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
    return p.finally(function () { btn.disabled = false; btn.textContent = label; });
  }
  function fail(e) { TP.toast(C.message(e), 'error'); }

  // --- The current plan, shown in the sidebar and the phone's top bar ---
  TP.renderAccount = function () {
    var side = TP.clear(document.getElementById('side-account')), top = TP.clear(document.getElementById('top-plan'));
    document.body.classList.toggle('cloud-on', C.enabled);
    if (!C.enabled) { top.style.display = 'none'; return; }
    top.style.display = '';
    var name = C.isActive() ? C.plan.name : 'This device', role = C.isActive() ? ROLE_LABEL[C.role()] : (C.user ? 'Only on this device' : 'Not signed in');
    var shared = C.isActive() && C.plan.memberIds.length > 1;
    side.appendChild(h('button', { class: 'plan-card', onclick: TP.plansPanel },
      h('div', { class: 'lbl' }, 'Plan'),
      h('div', { class: 'plan-name' }, name),
      h('div', { class: 'plan-sub' }, role + (shared ? ' · shared with ' + (C.plan.memberIds.length - 1) : '') + (C.isActive() && !C.synced ? ' · syncing…' : '')),
      h('div', { class: 'plan-link' }, C.user ? 'Plans & sharing' : 'Sign in to share plans', C.invites.length ? h('span', { class: 'badge' }, C.invites.length) : null)));
    top.appendChild(h('span', { class: 'top-plan-name' }, name));
    if (C.invites.length) top.appendChild(h('span', { class: 'badge' }, C.invites.length));
  };

  // --- Sign in / create account ---
  TP.signInForm = function (mode) {
    mode = mode || 'signin';
    var name = TP.input('text', '', { autocomplete: 'name', placeholder: 'e.g. Jacob Murphy' });
    var email = TP.input('email', '', { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
    var pass = TP.input('password', '', { autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });
    var go = h('button', { class: 'btn btn-primary', onclick: submit }, mode === 'signup' ? 'Create account' : 'Sign in');
    function submit() {
      if (mode === 'signup' && !name.value.trim()) { TP.toast('Add your name so people know who you are.', 'warn'); return; }
      var p = mode === 'signup' ? C.signUp(name.value, email.value, pass.value) : C.signIn(email.value, pass.value);
      busy(go, p).then(function () {
        m.close();
        if (mode === 'signup') TP.toast('Account created. Check your email for a link to verify your address.');
        TP.plansPanel();
      }).catch(fail);
    }
    [name, email, pass].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); });
    var m = TP.modal({ size: 's', title: h('div', null, h('div', { class: 'md-t' }, mode === 'signup' ? 'Create an account' : 'Sign in'),
        h('div', { class: 'md-sub' }, 'Your account lets you keep plans online and share them with other people.')),
      body: [
        mode === 'signup' ? TP.field('Your name', name) : null,
        TP.field('Email', email), TP.field('Password', pass),
        mode === 'signup' ? h('p', { class: 'hint' }, 'At least 6 characters. You’ll get an email to confirm your address; you need to confirm it before you can join plans shared with you.') : null,
        h('div', { class: 'auth-links' },
          mode === 'signup'
            ? h('a', { href: '#', onclick: function (e) { e.preventDefault(); TP.signInForm('signin'); } }, 'Already have an account? Sign in')
            : [h('a', { href: '#', onclick: function (e) { e.preventDefault(); TP.signInForm('signup'); } }, 'New here? Create an account'),
               h('a', { href: '#', onclick: function (e) {
                 e.preventDefault();
                 if (!email.value.trim()) { TP.toast('Type your email first.', 'warn'); return; }
                 C.resetPassword(email.value).then(function () { TP.toast('Password reset email sent.'); }).catch(fail);
               } }, 'Forgot password?')])],
      footer: [h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel'), go] });
    setTimeout(function () { (mode === 'signup' ? name : email).focus(); }, 50);
  };

  // ===========================================================================
  // THE GATE: nothing in the app is reachable until you've signed in, and (the first time) set up a plan.
  // ===========================================================================
  var gateMode = 'signin';
  // Returns true while the gate is showing. It only redraws when its screen changes, so typing isn't lost.
  TP.renderGate = function () {
    var gate = document.getElementById('gate');
    var screen = !C.enabled ? '' : !C.ready ? 'loading' : !C.user ? gateMode : !C.plansLoaded ? 'plans' : C.needsStart ? 'start' : '';
    document.body.classList.toggle('gated', !!screen);
    var sig = screen + '|' + (C.user ? C.user.uid + C.user.verified + C.invites.length : '');
    if (gate.dataset.sig === sig) return !!screen;
    gate.dataset.sig = sig; TP.clear(gate);
    if (!screen) return false;
    var card = h('div', { class: 'gate-card' },
      h('div', { class: 'gate-brand' }, h('div', { class: 'logo' }, TP.icon('activity')), h('div', null, h('div', { class: 'brand-t' }, 'Training Planner'), h('div', { class: 'brand-s' }, 'jmraceplanner.co.uk'))));
    ({ loading: gateLoading, plans: gatePlans, start: gateStart, signin: gateAuth, signup: gateAuth, reset: gateAuth })[screen](card, screen);
    gate.appendChild(card);
    var first = card.querySelector('input'); if (first && window.matchMedia('(min-width: 761px)').matches) setTimeout(function () { first.focus(); }, 30);
    return true;
  };
  function redraw(mode) { gateMode = mode; document.getElementById('gate').dataset.sig = ''; TP.renderGate(); }

  function gateLoading(card) { card.appendChild(h('p', { class: 'gate-wait' }, 'Opening…')); }
  function gatePlans(card) {
    card.appendChild(h('p', { class: 'gate-wait' }, 'Loading your plans…'));
    card.appendChild(h('p', { class: 'hint' }, 'The first time you sign in on a device this needs an internet connection; after that it also works offline.'));
    card.appendChild(h('a', { href: '#', class: 'gate-link', onclick: function (e) { e.preventDefault(); C.signOut(); } }, 'Sign out'));
  }

  function gateAuth(card, mode) {
    var title = { signin: 'Sign in', signup: 'Create your account', reset: 'Reset your password' }[mode];
    var name = TP.input('text', '', { autocomplete: 'name', placeholder: 'e.g. Jacob Murphy' });
    var email = TP.input('email', '', { autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
    var pass = TP.input('password', '', { autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });
    var go = h('button', { class: 'btn btn-primary gate-go', type: 'submit' }, { signin: 'Sign in', signup: 'Create account', reset: 'Send reset email' }[mode]);
    var form = h('form', { onsubmit: function (e) {
      e.preventDefault();
      if (mode === 'signup' && !name.value.trim()) { TP.toast('Add your name so people you share with know who you are.', 'warn'); return; }
      var p = mode === 'signup' ? C.signUp(name.value, email.value, pass.value)
            : mode === 'reset' ? C.resetPassword(email.value).then(function () { TP.toast('Password reset email sent – check your inbox (and spam).'); redraw('signin'); })
            : C.signIn(email.value, pass.value);
      busy(go, p).then(function () { if (mode === 'signup') TP.toast('Account created. We’ve emailed you a link to confirm your address.'); }).catch(fail);
    } },
      mode === 'signup' ? TP.field('Your name', name) : null,
      TP.field('Email', email),
      mode !== 'reset' ? TP.field('Password', pass) : null,
      mode === 'signup' ? h('p', { class: 'hint' }, 'At least 6 characters.') : null,
      go);
    card.appendChild(h('h1', { class: 'gate-title' }, title));
    card.appendChild(h('p', { class: 'gate-sub' }, mode === 'reset' ? 'We’ll email you a link to choose a new password.' : 'Plan your race calendar and training blocks, share plans with the people you train with, and connect Garmin.'));
    card.appendChild(form);
    var link = function (label, m) { return h('a', { href: '#', class: 'gate-link', onclick: function (e) { e.preventDefault(); redraw(m); } }, label); };
    card.appendChild(h('div', { class: 'gate-links' },
      mode === 'signin' ? [link('Create an account', 'signup'), link('Forgot password?', 'reset')]
      : mode === 'signup' ? link('Already have an account? Sign in', 'signin') : link('Back to sign in', 'signin')));
  }

  // First sign-in: start a plan (optionally from one saved on this device before accounts), or join one you were invited to.
  function gateStart(card) {
    var u = C.user, local = TP.localPlan(), nEv = Object.keys(local.events).length, nSe = local.sessions.length, hasLocal = nEv + nSe > 0;
    card.appendChild(h('h1', { class: 'gate-title' }, 'Welcome' + (u.name ? ', ' + u.name.split(' ')[0] : '')));
    card.appendChild(h('p', { class: 'gate-sub' }, 'Set up your training plan. It’s saved to your account, so it’s the same on every device you sign in on.'));
    if (C.invites.length) {
      card.appendChild(h('div', { class: 'form-section' }, 'You’ve been invited'));
      C.invites.forEach(function (p) {
        var owner = p.people && p.people[p.ownerId];
        card.appendChild(h('div', { class: 'panel invite' }, h('div', { class: 'grow' }, h('div', { class: 'strong' }, p.name), h('div', { class: 'muted small' }, (owner ? owner.name : 'Someone') + ' · ' + ROLE_LABEL[p.inviteRoles[u.email]])),
          h('button', { class: 'btn btn-sm btn-primary', onclick: function () { busy(this, C.accept(p.id)).then(function () { C.needsStart = false; TP.changed(); }).catch(fail); } }, 'Join')));
      });
      card.appendChild(h('div', { class: 'form-section' }, 'Or start your own plan'));
    } else if (!u.verified) {
      card.appendChild(h('div', { class: 'verify' },
        h('div', null, 'Been invited to someone\u2019s plan? Confirm your email first using the link we sent to ' + u.email + ', then press the button.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: function () {
            busy(this, C.refreshVerified()).then(function (ok) { TP.toast(ok ? 'Email confirmed.' + (C.invites.length ? '' : ' No invitations yet.') : 'Not confirmed yet \u2013 click the link in the email, then try again.', ok ? 'info' : 'warn'); }).catch(fail);
          } }, 'I\u2019ve confirmed my email'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: function () { C.resendVerification().then(function () { TP.toast('Email sent again.'); }).catch(fail); } }, 'Send it again'))));
    }
    var nm = TP.input('text', 'My plan', { placeholder: 'e.g. 2027 season' });
    var copy = TP.input('checkbox', '', { checked: hasLocal });
    var go = h('button', { class: 'btn btn-primary gate-go', type: 'submit' }, 'Create my plan');
    card.appendChild(h('form', { onsubmit: function (e) {
      e.preventDefault();
      var withLocal = hasLocal && copy.checked;
      busy(go, C.createPlan(nm.value || 'My plan', withLocal)).then(function () { if (withLocal) TP.clearLocalPlan(); }).catch(fail);
    } },
      TP.field('Plan name', nm),
      hasLocal ? h('label', { class: 'check gate-check' }, copy, h('span', null, 'Copy the plan saved in this browser (' + nEv + ' events, ' + nSe + ' sessions) into it. It’s then removed from this browser.')) : null,
      go));
    card.appendChild(h('div', { class: 'gate-links' }, h('span', { class: 'muted small' }, 'Signed in as ' + u.email),
      h('a', { href: '#', class: 'gate-link', onclick: function (e) { e.preventDefault(); C.signOut(); } }, 'Sign out')));
  }

  // --- Plans & sharing ---
  TP.plansPanel = function () {
    if (!C.enabled) return;
    if (!C.user) { TP.signInForm('signin'); return; }
    var body = h('div');
    var m = TP.modal({ size: 'l', cls: 'plans-modal', title: h('div', { class: 'md-t' }, 'Plans & sharing'), body: body,
      footer: [h('button', { class: 'btn btn-primary', onclick: function () { m.close(); } }, 'Done')], onClose: function () { TP.offChange(draw); } });
    function draw() { if (!body.isConnected) return; TP.clear(body); body.appendChild(content(m)); }
    TP.onChange(draw); draw();
  };

  function content(m) {
    var u = C.user, out = h('div');
    // Account
    out.appendChild(h('div', { class: 'form-section' }, 'Your account'));
    out.appendChild(h('div', { class: 'panel acct' },
      h('div', { class: 'acct-row' },
        h('div', { class: 'avatar' }, (u.name || u.email).charAt(0).toUpperCase()),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, u.name || '(no name)'), h('div', { class: 'muted small' }, u.email)),
        h('button', { class: 'btn btn-sm', onclick: function () {
          var nm = TP.input('text', u.name);
          var t = TP.modal({ size: 's', stack: true, title: 'Your name', body: TP.field('Name shown to people you share with', nm),
            footer: [h('button', { class: 'btn', onclick: function () { t.close(); } }, 'Cancel'),
                     h('button', { class: 'btn btn-primary', onclick: function () { if (nm.value.trim()) C.rename(nm.value).then(function () { t.close(); }).catch(fail); } }, 'Save')] });
        } }, 'Edit name'),
        h('button', { class: 'btn btn-sm', onclick: function () { m.close(); C.signOut(); TP.toast('Signed out.'); } }, 'Sign out')),
      u.verified ? null : h('div', { class: 'verify' },
        h('div', null, h('b', null, 'Confirm your email. '), 'We sent a link to ' + u.email + '. You need to confirm it before you can join plans shared with you.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm btn-primary', onclick: function () {
            C.refreshVerified().then(function (ok) { TP.toast(ok ? 'Email confirmed.' : 'Not confirmed yet – click the link in the email, then try again.', ok ? 'info' : 'warn'); }).catch(fail);
          } }, 'I’ve confirmed it'),
          h('button', { class: 'btn btn-sm', onclick: function () { C.resendVerification().then(function () { TP.toast('Email sent again.'); }).catch(fail); } }, 'Send the email again')))));

    // Invitations
    if (C.invites.length) {
      out.appendChild(h('div', { class: 'form-section' }, 'Invitations'));
      C.invites.forEach(function (p) {
        var owner = p.people && p.people[p.ownerId];
        out.appendChild(h('div', { class: 'panel invite' },
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, p.name), h('div', { class: 'muted small' }, (owner ? owner.name : 'Someone') + ' invited you · ' + ROLE_LABEL[p.inviteRoles[u.email]])),
          h('button', { class: 'btn btn-sm', onclick: function () { C.decline(p.id).catch(fail); } }, 'Decline'),
          h('button', { class: 'btn btn-sm btn-primary', onclick: function () { C.accept(p.id).then(function () { m.close(); }).catch(fail); } }, 'Join')));
      });
    }

    // Plans
    out.appendChild(h('div', { class: 'form-section' }, 'Your plans'));
    var list = h('div', { class: 'plan-list' });
    var local = TP.localPlan(), nLocal = local.sessions.length + Object.keys(local.events).length;
    C.plans.forEach(function (p) {
      var others = p.memberIds.length - 1;
      list.appendChild(planRow(p.name, ROLE_LABEL[p.roles[u.uid]] + (others ? ' · shared with ' + others : ' · just you'), p.id === C.activeId, function () { C.open(p.id); }));
    });
    out.appendChild(list);
    out.appendChild(h('div', { class: 'btn-row', style: 'margin-top:8px' },
      h('button', { class: 'btn btn-sm', onclick: function () { newPlan(false); } }, TP.icon('plus'), 'New empty plan'),
      nLocal ? h('button', { class: 'btn btn-sm', onclick: function () { newPlan(true); } }, TP.icon('copy'), 'Copy this device’s old plan into a new plan') : null));

    // The open plan's people
    if (C.isActive()) out.appendChild(sharing(m));
    return out;
  }

  function planRow(name, sub, on, open) {
    return h('button', { class: 'plan-row' + (on ? ' on' : ''), onclick: function () { if (!on) open(); } },
      h('span', { class: 'radio' + (on ? ' on' : '') }), h('span', { class: 'grow' }, h('div', { class: 'strong' }, name), h('div', { class: 'muted small' }, sub)),
      on ? h('span', { class: 'open-lbl' }, 'Open') : null);
  }

  function newPlan(copyLocal) {
    var nm = TP.input('text', copyLocal ? 'My plan' : '', { placeholder: 'e.g. 2027 season' });
    var t = TP.modal({ size: 's', stack: true, title: copyLocal ? 'Put this device’s plan online' : 'New plan',
      body: [TP.field('Plan name', nm), copyLocal ? h('p', { class: 'hint' }, 'Copies every event, session and template from this device into a new online plan you can share. The old copy is then removed from this device.') : null],
      footer: [h('button', { class: 'btn', onclick: function () { t.close(); } }, 'Cancel'),
               h('button', { class: 'btn btn-primary', onclick: function () {
                 if (!nm.value.trim()) return;
                 busy(this, C.createPlan(nm.value, copyLocal)).then(function () { if (copyLocal) TP.clearLocalPlan(); t.close(); }).catch(fail);
               } }, 'Create')] });
    setTimeout(function () { nm.focus(); }, 50);
  }

  function sharing(m) {
    var p = C.plan, u = C.user, isOwner = C.role() === 'owner', out = h('div');
    out.appendChild(h('div', { class: 'form-section' }, 'People in “' + p.name + '”'));
    var rows = h('div', { class: 'people' });
    p.memberIds.slice().sort(function (a, b) { return a === p.ownerId ? -1 : b === p.ownerId ? 1 : 0; }).forEach(function (uid) {
      var who = (p.people || {})[uid] || { name: 'Unknown', email: '' }, role = p.roles[uid];
      var ctl = isOwner && uid !== u.uid
        ? [TP.selectEl([{ value: 'editor', label: 'Can edit' }, { value: 'viewer', label: 'View only' }], role, { class: 'inp inp-sm', onchange: function () { C.setRole(uid, this.value).catch(fail); } }),
           h('button', { class: 'btn btn-sm btn-outline-danger', onclick: function () {
             TP.confirm('Remove ' + who.name + ' from “' + p.name + '”? They’ll lose access straight away.', 'Remove', function () { C.removeMember(uid).catch(fail); });
           } }, 'Remove')]
        : h('span', { class: 'role-tag' }, ROLE_LABEL[role]);
      rows.appendChild(h('div', { class: 'person' }, h('div', { class: 'avatar' }, (who.name || who.email || '?').charAt(0).toUpperCase()),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, who.name + (uid === u.uid ? ' (you)' : '')), h('div', { class: 'muted small' }, who.email)), ctl));
    });
    (p.inviteEmails || []).forEach(function (em) {
      rows.appendChild(h('div', { class: 'person pending' }, h('div', { class: 'avatar' }, '@'),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, em), h('div', { class: 'muted small' }, 'Invited · ' + ROLE_LABEL[p.inviteRoles[em]] + ' · waiting for them to join')),
        isOwner ? h('button', { class: 'btn btn-sm', onclick: function () { C.cancelInvite(em).catch(fail); } }, 'Cancel invite') : null));
    });
    out.appendChild(rows);

    if (isOwner) {
      var email = TP.input('email', '', { placeholder: 'their email address', inputmode: 'email', autocapitalize: 'off' });
      var role = TP.selectEl([{ value: 'editor', label: 'Can edit' }, { value: 'viewer', label: 'View only' }], 'editor', { class: 'inp' });
      var send = h('button', { class: 'btn btn-primary', onclick: function () {
        busy(send, C.invite(email.value, role.value)).then(function () { TP.toast('Invited ' + email.value.trim() + '.'); email.value = ''; }).catch(fail);
      } }, 'Invite');
      out.appendChild(h('div', { class: 'invite-form' }, TP.field('Invite someone by email', email), TP.field('They can', role), send));
      out.appendChild(h('p', { class: 'hint' }, 'They’ll see the invitation here, in Plans & sharing, once they sign in with that email (or create an account with it) and confirm their address. Tell them to visit jmraceplanner.co.uk.'));
      out.appendChild(h('div', { class: 'form-section' }, 'Plan settings'));
      var nm = TP.input('text', p.name);
      out.appendChild(h('div', { class: 'invite-form' }, TP.field('Plan name', nm),
        h('button', { class: 'btn', onclick: function () { if (nm.value.trim()) C.renamePlan(nm.value).then(function () { TP.toast('Renamed.'); }).catch(fail); } }, 'Rename')));
      out.appendChild(h('button', { class: 'btn btn-outline-danger', style: 'margin-top:10px', onclick: function () {
        TP.confirm('Delete “' + p.name + '” for everyone in it? Its events and sessions are deleted too. Use Save plan first if you want a copy.', 'Delete plan', function () {
          C.deletePlan(p.id).then(function () { TP.toast('Plan deleted.'); }).catch(fail);
        });
      } }, TP.icon('trash'), 'Delete this plan'));
    } else {
      out.appendChild(h('button', { class: 'btn btn-outline-danger', style: 'margin-top:10px', onclick: function () {
        TP.confirm('Leave “' + p.name + '”? You’ll need a new invite to get back in.', 'Leave', function () { C.leave(p.id).then(function () { TP.toast('You left the plan.'); }).catch(fail); });
      } }, 'Leave this plan'));
    }
    return out;
  }
})(window.TP);
