// App shell: navigation, page rendering, settings, and saving / loading the plan.
(function (TP) {
  var h = TP.h;

  TP.render = function () {
    var v = TP.view, main = TP.clear(document.getElementById('main'));
    document.querySelectorAll('[data-page]').forEach(function (b) { b.classList.toggle('on', b.dataset.page === v.page); b.setAttribute('aria-current', b.dataset.page === v.page ? 'page' : 'false'); });
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === v.mode); });
    document.body.dataset.page = v.page;
    if (v.page === 'calendar') {
      var cal = h('div', { class: 'cal cal-' + v.mode.toLowerCase() });
      if (v.mode === 'Month') TP.renderMonth(cal); else TP.renderYear(cal);
      main.appendChild(cal);
      var md = h('div', { class: 'main-day' }); TP.renderDay(md); main.appendChild(md);
    } else if (v.page === 'reports') {
      var rp = h('div', { class: 'page' }); TP.renderReports(rp); main.appendChild(rp);
    } else if (v.page === 'garmin') {
      main.appendChild(garminPlaceholder());
    }
    var sd = TP.clear(document.getElementById('side-day')); TP.renderDay(sd);
    TP.renderAccount();
  };

  function garminPlaceholder() {
    return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h2', null, 'Garmin analysis')),
      h('div', { class: 'empty' }, TP.icon('heart', 'width:32px;height:32px'), h('h3', null, 'Coming next'),
        h('p', null, 'This is where your Garmin activities will be analysed: training load, fitness and form, intensity, power and pace curves, and block reviews.'),
        h('p', { class: 'muted' }, 'Activities will be read from FIT files you add here, so your data stays on this device.')));
  }

  TP.go = function (page) { TP.view.page = page; TP.closeMenu(); TP.render(); window.scrollTo(0, 0); };
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
    document.querySelectorAll('[data-page]').forEach(function (b) { b.addEventListener('click', function () { TP.go(b.dataset.page); }); });
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { TP.setMode(b.dataset.mode); }); });
    document.querySelectorAll('[data-action=settings]').forEach(function (b) { b.addEventListener('click', function () { TP.closeMenu(); TP.settings(); }); });
    document.querySelectorAll('[data-action=save-plan]').forEach(function (b) { b.addEventListener('click', TP.savePlan); });
    document.querySelectorAll('[data-action=load-plan]').forEach(function (b) { b.addEventListener('click', TP.loadPlan); });
    document.getElementById('plan-file').addEventListener('change', readPlanFile);
    document.getElementById('top-plan').addEventListener('click', function () { TP.plansPanel(); });
    document.querySelectorAll('[data-action=add-event]').forEach(function (b) { b.addEventListener('click', function () { TP.closeMenu(); TP.eventForm(null, TP.view.selected); }); });
    document.querySelectorAll('[data-action=add-session]').forEach(function (b) { b.addEventListener('click', function () { TP.closeMenu(); TP.sessionForm(null, { date: TP.view.selected }); }); });
    // Phones open on the month view; the year view is easier to read on a wide screen.
    if (window.matchMedia('(max-width: 760px)').matches) TP.view.mode = 'Month';
    TP.onChange(TP.render);
    TP.cloud.init();
    TP.render();
    TP.startUnits();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
  });
})(window.TP);
