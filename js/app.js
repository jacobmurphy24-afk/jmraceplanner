// App shell: navigation, page rendering, settings, and saving / loading the plan.
(function (TP) {
  var h = TP.h;

  var SIDEWAYS = '.tabs-scroll, .tbl-wrap, .rp-timeline-wrap, .tabs, .chips';
  TP.render = function () {
    if (TP.renderGate()) return;
    // Rows scrolled sideways (tab bars, wide tables) keep their place when the page redraws,
    // e.g. when synced data arrives while you're scrolling the tabs on a phone.
    var sideways = {}, keyOf = function (el, seen) { var k = el.className; seen[k] = (seen[k] || 0) + 1; return k + '#' + seen[k]; };
    var seen0 = {}; document.querySelectorAll(SIDEWAYS.replace(/(^|, )/g, '$1#main ')).forEach(function (el) { var k = keyOf(el, seen0); if (el.scrollLeft) sideways[k] = el.scrollLeft; });
    var v = TP.view, main = TP.clear(document.getElementById('main'));
    document.querySelectorAll('button[data-page]').forEach(function (b) { b.classList.toggle('on', b.dataset.page === v.page); b.setAttribute('aria-current', b.dataset.page === v.page ? 'page' : 'false'); });
    document.querySelectorAll('button[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === v.mode); });
    document.body.dataset.page = v.page;
    if (TP.renderStackTop(main)) {
      // a full-page view (an activity, a sport) is open on top of the page
    } else if (v.page === 'calendar') {
      var cal = h('div', { class: 'cal cal-' + v.mode.toLowerCase() });
      if (v.mode === 'Month') TP.renderMonth(cal); else TP.renderYear(cal);
      main.appendChild(cal);
      var md = h('div', { class: 'main-day' }); TP.renderDay(md); main.appendChild(md);
    } else if (v.page === 'myweek') {
      var mp = h('div', { class: 'page' }); TP.myWeek.page(mp); main.appendChild(mp);
    } else if (v.page === 'reports') {
      var rp = h('div', { class: 'page' }); TP.renderReports(rp); main.appendChild(rp);
    } else if (v.page === 'garmin') {
      var gp = h('div', { class: 'page' }); TP.renderGarmin(gp); main.appendChild(gp);
    }
    var sd = TP.clear(document.getElementById('side-day')); TP.renderDay(sd);
    TP.renderAccount();
    if (TP.garmin) TP.garmin.askIfNeeded();
    if (Object.keys(sideways).length) {
      var seen1 = {}; main.querySelectorAll(SIDEWAYS).forEach(function (el) { var k = keyOf(el, seen1); if (sideways[k]) el.scrollLeft = sideways[k]; });
    }
  };


  TP.go = function (page) { TP.view.page = page; TP.view.review = null; TP.view.stack = []; TP.closeMenu(); TP.render(); window.scrollTo(0, 0); };
  TP.setMode = function (mode) { TP.view.page = 'calendar'; TP.view.mode = mode; TP.render(); };
  TP.closeMenu = function () { document.body.classList.remove('menu-open'); };

  // --- Settings ---
  TP.settings = function () {
    var units = TP.chips([{ value: 'metric', label: 'Kilometres and metres' }, { value: 'imperial', label: 'Miles and yards' }], TP.state.prefs.units,
      function (v) { TP.state.prefs.units = v; TP.save(); TP.applyUnits(); }, 'chips');
    var m = TP.modal({ size: 'm', title: h('div', { class: 'md-t' }, 'Settings'),
      body: [
        h('div', { class: 'form-section' }, 'Distance units'), units,
        h('p', { class: 'hint' }, 'Changes every distance, pace and speed shown. Your plan isn\u2019t changed, so you can switch back at any time.'),
        h('div', { class: 'form-section' }, 'Activity analysis'),
        h('p', { class: 'small' }, 'Training stress, zones and predictions use your thresholds, estimated from your activities unless you enter tested values.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-sm', onclick: function () {
            var b = h('div'); TP.coach.thresholds(b);
            var t = TP.modal({ size: 'l', stack: true, cls: 'gloss', title: h('div', { class: 'md-t' }, 'Training thresholds'), body: b, footer: h('button', { class: 'btn btn-primary', onclick: function () { t.close(); } }, 'Done') });
          } }, TP.icon('heart'), 'Training thresholds'),
          TP.garmin && TP.garmin.acts.length ? h('button', { class: 'btn btn-sm btn-outline-danger', onclick: function () {
            TP.confirm('Delete the ' + TP.garmin.acts.length + ' activities and sleep data stored on this device? You can upload them again later.', 'Delete', function () { TP.garmin.clearActs(); m.close(); });
          } }, TP.icon('trash'), 'Clear stored activities') : null,
          TP.garmin && (TP.garmin.consented() || TP.garmin.acts.length || TP.garmin.connected()) ? h('button', { class: 'btn btn-sm btn-outline-danger', onclick: function () {
            TP.confirm('Withdraw your consent to Training Planner using your activity and health data? All activity data on this device is deleted, and you’ll be asked again before anything is read.', 'Withdraw', function () { TP.garmin.withdrawConsent(); m.close(); });
          } }, 'Withdraw consent') : null),
        h('p', { class: 'hint' }, 'Activities are kept only on this device. ' + (TP.garmin && TP.garmin.consented() ? 'You agreed to their use on ' + TP.fmt(TP.garmin.consentDate(), '%d %b %Y') + '. ' : ''), h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy')),
        h('div', { class: 'form-section' }, 'Start again'),
        h('p', { class: 'small' }, 'Your plan is saved automatically in this browser. Use Save plan first if you want a copy.'),
        h('button', { class: 'btn btn-outline-danger', onclick: function () {
          TP.confirm('Delete every event, session and template in this browser? This can\u2019t be undone unless you saved the plan.', 'Delete everything', function () {
            TP.state = { events: {}, sessions: [], templates: {}, prefs: TP.state.prefs }; TP.save(); m.close();
          });
        } }, TP.icon('trash'), 'Clear this browser\u2019s plan')],
      footer: h('button', { class: 'btn btn-primary', onclick: function () { m.close(); } }, 'Done') });
  };

  // --- Save / load the plan as a file (like Save / Load workspace in the R app) ---
  TP.savePlan = function () {
    var blob = new Blob([TP.exportJSON()], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'training-plan-' + TP.today() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };
  // Opens this site's saved plans and workspaces converted from the R app (export_for_web.R).
  TP.loadPlan = function () { document.getElementById('plan-file').click(); };
  function readPlanFile() {
    var input = this, f = input.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      input.value = '';
      var target = TP.cloud.isActive() ? 'the online plan \u201c' + TP.cloud.plan.name + '\u201d (for everyone in it)' : 'the plan in this browser';
      TP.confirm('Replace ' + target + ' with \u201c' + f.name + '\u201d? Save your current plan first if you want to keep it.', 'Replace plan', function () {
        try { TP.importJSON(r.result); TP.save(); TP.applyUnits(); TP.toast('Plan loaded.'); }
        catch (e) { TP.toast(e.message, 'error'); }
      });
    };
    r.readAsText(f);
  }

  // --- Start ---
  document.addEventListener('DOMContentLoaded', function () {
    TP.load();
    document.querySelectorAll('button[data-page]').forEach(function (b) { b.addEventListener('click', function () { TP.go(b.dataset.page); }); });
    document.querySelectorAll('button[data-mode]').forEach(function (b) { b.addEventListener('click', function () { TP.setMode(b.dataset.mode); }); });
    document.querySelectorAll('[data-action=settings]').forEach(function (b) { b.addEventListener('click', function () { TP.closeMenu(); TP.settings(); }); });
    document.querySelectorAll('[data-action=save-plan]').forEach(function (b) { b.addEventListener('click', TP.savePlan); });
    document.querySelectorAll('[data-action=load-plan]').forEach(function (b) { b.addEventListener('click', TP.loadPlan); });
    document.getElementById('plan-file').addEventListener('change', readPlanFile);
    document.getElementById('top-plan').addEventListener('click', function () { TP.plansPanel(); });
    document.querySelectorAll('[data-action=add-event]').forEach(function (b) { b.addEventListener('click', function () { TP.closeMenu(); TP.eventForm(null, TP.view.selected); }); });
    // The + in the phone tab bar: a session or an event on the selected date.
    document.querySelectorAll('[data-action=add-session]').forEach(function (b) { b.addEventListener('click', function () {
      TP.closeMenu();
      var d = TP.view.selected, m = TP.modal({ size: 'm', cls: 'add-sheet', title: h('div', null, h('div', { class: 'md-t' }, 'Add'), h('div', { class: 'md-sub' }, TP.fmt(d, '%A %d %B %Y'))),
        body: h('div', { class: 'add-choices' },
          h('button', { class: 'btn btn-primary', onclick: function () { m.close(); TP.sessionForm(null, { date: d }); } }, TP.icon('plus'), 'Session'),
          h('button', { class: 'btn', onclick: function () { m.close(); TP.eventForm(null, d); } }, TP.icon('plus'), 'Event (race or training block)')) });
    }); });
    // Phones open on the month view; the year view is easier to read on a wide screen.
    if (window.matchMedia('(max-width: 760px)').matches) TP.view.mode = 'Month';
    TP.onChange(TP.render);
    TP.cloud.init();
    if (!TP.cloud.enabled) TP.garmin.setUser(null);   // no accounts configured: this device's Garmin data
    TP.render();
    TP.startUnits();
    TP.startGlossary();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      // When an update takes over from the version already running, reload once to show it,
      // unless a form is open, so nothing being typed is lost.
      var hadVersion = !!navigator.serviceWorker.controller, reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadVersion || reloaded) return;
        reloaded = true;
        if (document.body.classList.contains('md-open')) TP.toast('A new version is ready – it’ll show next time you open the app.');
        else location.reload();
      });
      navigator.serviceWorker.register('sw.js').then(function (r) {
        r.update();
        // Phones often resume the app from the background instead of reopening it: check for an
        // update then too (a new version takes over and the page reloads, as above).
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') r.update().catch(function () {}); });
      }).catch(function () {});
    }
  });
})(window.TP);
