// Full-page views opened from anywhere (an activity, a sport within a block review), with a back link
// to wherever you came from; and the glossary: technical terms get a dotted underline and explain
// themselves on hover or tap, as in the R app.
(function (TP) {
  var h = TP.h;
  TP.view.stack = [];
  TP.pages = {};

  function mainEl() { return document.getElementById('main'); }
  function currentTitle() {
    var st = TP.view.stack, top = st[st.length - 1];
    if (top) return top.title;
    if (TP.view.page === 'garmin' && TP.view.review) return TP.view.review.name;
    return { myweek: 'My Week', calendar: 'Calendar', reports: 'Block reports', garmin: 'Analysis' }[TP.view.page] || 'Back';
  }
  // p: { kind: 'activity' | 'sport', title, ... }
  TP.openPage = function (p) {
    TP.closeModals();
    var m = mainEl();
    p.back = p.backLabel || currentTitle(); p.scroll = { main: m ? m.scrollTop : 0, win: window.scrollY };
    TP.view.stack.push(p);
    TP.render();
    if (m) m.scrollTop = 0; window.scrollTo(0, 0);
  };
  TP.backPage = function () {
    var p = TP.view.stack.pop(); TP.render();
    if (p && p.reopen) { p.reopen(); return; }   // opened from a pop-up: show it again
    if (p && p.scroll) requestAnimationFrame(function () { var m = mainEl(); if (m) m.scrollTop = p.scroll.main; window.scrollTo(0, p.scroll.win); });
  };
  // Draws the page on top of the stack. Returns false when there isn't one.
  TP.renderStackTop = function (main) {
    var top = TP.view.stack[TP.view.stack.length - 1]; if (!top) return false;
    var page = h('div', { class: 'page detail-page' });
    page.appendChild(h('a', { href: '#', class: 'back-link', onclick: function (e) { e.preventDefault(); TP.backPage(); } }, '← Back to ' + top.back));
    try { TP.pages[top.kind](page, top); }
    catch (e) { console.error(e); page.appendChild(h('div', { class: 'panel' }, 'Couldn’t show this page: ' + e.message)); }
    main.appendChild(page);
    return true;
  };

  // --- Glossary ---
  var G = TP.GLOSSARY = [
    ['CTL', 'Chronic Training Load: your fitness. The average daily training load over roughly the last 6 weeks. It rises slowly as you train consistently.'],
    ['ATL', 'Acute Training Load: your fatigue. The average daily training load over roughly the last week. It rises and falls quickly.'],
    ['TSB', 'Training Stress Balance, or form: fitness (CTL) minus fatigue (ATL). Positive means fresh, negative means tired. Around +5 to +25 is ideal on race day.'],
    ['Form', 'How fresh you are: fitness minus fatigue (TSB). Positive means rested, negative means carrying fatigue.', 1],
    ['TSS', 'Training Stress Score: how big a session was, combining how long and how hard. One hour flat out at threshold = 100.'],
    ['rTSS', 'Running TSS: training stress worked out from your pace (adjusted for hills) against your threshold pace.'],
    ['sTSS', 'Swim TSS: training stress worked out from your swim pace against your threshold swim pace (CSS).'],
    ['hrTSS', 'Heart-rate TSS: training stress worked out from heart rate, used when there’s no power or pace to go on.'],
    ['TRIMP', 'Training impulse: a training-load score based on time spent at each heart rate.'],
    ['ACWR', 'Acute:Chronic Workload Ratio: last week’s load divided by your 6-week average. Around 0.8–1.3 is safe; above 1.5 is a sudden spike that raises injury and illness risk.'],
    ['Ramp', 'Ramp rate: how quickly fitness (CTL) is rising each week. More than about 5–8 a week is hard to absorb.', 1],
    ['Monotony', 'How similar your training days are to each other. Above 2 means too little difference between hard and easy days.', 1],
    ['Strain', 'Weekly load multiplied by monotony: high load with little variety is what tends to lead to illness or burnout.', 1],
    ['Load management', 'How safely training load was increased: no sudden spikes (ACWR), steady ramps and enough easy days.', 1],
    ['HRV', 'Heart-rate variability: the variation in time between heartbeats, measured overnight. Higher than your normal usually means well recovered; lower means stress or fatigue.'],
    ['RHR', 'Resting heart rate. A rise of several beats above your normal can be a sign of fatigue or illness.'],
    ['FTP', 'Functional Threshold Power: the highest power you could hold on the bike for about an hour.'],
    ['NP', 'Normalised Power: average power adjusted for surges, so it reflects the real cost of a ride with lots of changes of pace.'],
    ['IF', 'Intensity Factor: how hard a session was compared with your threshold (NP divided by FTP on the bike). 0.75 is steady endurance; about 0.85 is a strong half-Ironman bike.'],
    ['VI', 'Variability Index: NP divided by average power. Close to 1.0 means very even pacing.'],
    ['LTHR', 'Lactate Threshold Heart Rate: the heart rate you could hold for about an hour of hard effort.'],
    ['CSS', 'Critical Swim Speed: the pace you can sustain in the pool for about 30 minutes, your swimming threshold.'],
    ['Critical speed', 'The fastest running speed you can sustain for a long time (roughly 30–60 minutes), worked out from your best efforts.', 1],
    ['Critical power', 'The highest cycling power you can sustain for a long time, worked out from your best efforts.', 1],
    ['Threshold', 'The effort you can hold for about an hour: above it fatigue builds quickly, below it you can keep going much longer.', 1],
    ['NGP', 'Normalised Graded Pace: your running pace adjusted for hills, so a slow climb and a fast flat run can be compared fairly.'],
    ['EF', 'Efficiency Factor: speed or power per heartbeat. When it rises for the same session, you’re getting fitter.'],
    ['Efficiency', 'How much speed or power you get for each heartbeat. Rising efficiency in the same session means rising fitness.', 1],
    ['Decoupling', 'How much heart rate drifts up relative to pace or power through a session. Under 5% shows good endurance; more means you’re fading.', 1],
    ['Durability', 'How well you hold pace or power late in a long effort without heart rate drifting up (see decoupling).', 1],
    ['Z1', 'Zone 1: easy, below your aerobic threshold. Conversational pace.'],
    ['Z2', 'Zone 2: moderate, between your aerobic and lactate thresholds (tempo).'],
    ['Z3', 'Zone 3: hard, above your lactate threshold (intervals and race-pace efforts).'],
    ['Polarized', 'Training mostly easy with a small amount of very hard work and little in between. Shown to suit most endurance athletes.', 1],
    ['Pyramidal', 'Most training easy, a smaller amount moderate and the least amount hard. A common, effective pattern.', 1],
    ['Threshold-focused', 'A lot of training at moderate ‘comfortably hard’ effort. Productive short term but tiring, and it leaves less room for quality.', 1],
    ['Intensity distribution', 'How your training time splits between easy, moderate and hard effort.', 1],
    ['Specificity', 'How closely training matched the race: time spent in the race’s sports and long sessions near race duration.', 1],
    ['Taper', 'The lighter final weeks before a race, cutting volume (usually 30–60%) while keeping some intensity, so you arrive fresh.', 1],
    ['Freshness', 'How rested you are on race day, measured by form (TSB).', 1],
    ['Riegel', 'Riegel’s formula: predicts a race time over one distance from a result over another, assuming you slow slightly as distance grows.'],
    ['Fade', 'Slowing down over the final part of a race or session compared with the start.', 1],
    ['Negative split', 'Finishing the second half faster than the first: usually the sign of well-judged pacing.', 1],
    ['VO2max', 'The most oxygen your body can use during all-out exercise: a measure of aerobic engine size. Garmin estimates it from runs and rides.'],
    ['Cadence', 'Steps per minute when running, or pedal revolutions per minute when cycling.', 1],
    ['Sweet spot', 'Cycling effort just below threshold (about 88–94% of FTP): a time-efficient way to build fitness.', 1]
  ].map(function (g) { return { term: g[0], def: g[1], ci: !!g[2] }; });

  var byKey = {}; G.forEach(function (g) { byKey[g.ci ? g.term.toLowerCase() : g.term] = g; });
  var esc = function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var sorted = G.slice().sort(function (a, b) { return b.term.length - a.term.length; });
  var reExact = new RegExp('\\b(' + sorted.filter(function (g) { return !g.ci; }).map(function (g) { return esc(g.term); }).join('|') + ')\\b');
  var reLoose = new RegExp('\\b(' + sorted.filter(function (g) { return g.ci; }).map(function (g) { return esc(g.term); }).join('|') + ')\\b', 'i');
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, BUTTON: 1, A: 1, LABEL: 1, svg: 1, SVG: 1, H2: 1 };
  function find(text) {
    var m1 = reExact.exec(text), m2 = reLoose.exec(text);
    if (m1 && (!m2 || m1.index <= m2.index)) return { i: m1.index, t: m1[1], g: byKey[m1[1]] };
    if (m2) return { i: m2.index, t: m2[1], g: byKey[m2[1].toLowerCase()] };
    return null;
  }
  function annotate(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      for (var p = n.parentNode; p && p !== root.parentNode; p = p.parentNode) {
        if (SKIP[p.nodeName] || (p.classList && (p.classList.contains('g-term') || p.classList.contains('tabs') || p.classList.contains('no-gloss') || p.classList.contains('tc') || p.classList.contains('chart-leg')))) return NodeFilter.FILTER_REJECT;
      }
      return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    } });
    var nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue, frag = null, m;
      while ((m = find(text)) && m.g) {
        frag = frag || document.createDocumentFragment();
        if (m.i > 0) frag.appendChild(document.createTextNode(text.slice(0, m.i)));
        var sp = document.createElement('span'); sp.className = 'g-term'; sp.textContent = m.t;
        sp.setAttribute('data-term', m.g.term); sp.setAttribute('data-tip', m.g.def); frag.appendChild(sp);
        text = text.slice(m.i + m.t.length);
      }
      if (frag) { if (text) frag.appendChild(document.createTextNode(text)); node.parentNode.replaceChild(frag, node); }
    });
  }
  // The analysis pages and pop-ups get underlined terms; the planner's own pages don't.
  function scan() {
    pending = false;
    if (document.body.dataset.page === 'garmin' || document.body.dataset.page === 'myweek' || TP.view.stack.length) { var m = mainEl(); if (m) annotate(m); }
    document.querySelectorAll('.md.gloss .md-body').forEach(annotate);
  }
  var pending = false;
  TP.startGlossary = function () {
    new MutationObserver(function () { if (!pending) { pending = true; setTimeout(scan, 150); } }).observe(document.body, { childList: true, subtree: true });
    scan();
    var tip = null;
    function show(el, x, y) {
      if (!tip) { tip = document.createElement('div'); tip.id = 'g-tip'; document.body.appendChild(tip); }
      tip.textContent = ''; var b = document.createElement('b'); b.textContent = el.getAttribute('data-term'); tip.appendChild(b);
      tip.appendChild(document.createTextNode(el.getAttribute('data-tip'))); tip.style.display = 'block';
      var w = tip.offsetWidth, hh = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - w - 8)) + 'px';
      tip.style.top = (y + 16 + hh > window.innerHeight ? y - hh - 10 : y + 16) + 'px';
    }
    function hide() { if (tip) tip.style.display = 'none'; }
    document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('.g-term'); if (t) show(t, e.clientX, e.clientY); else hide(); });
    document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('.g-term'); if (t) { show(t, e.clientX, e.clientY); e.stopPropagation(); e.preventDefault(); } else hide(); }, true);
    document.addEventListener('scroll', hide, true);
  };
  TP.glossaryButton = function () { return h('button', { class: 'btn btn-sm', onclick: TP.showGlossary }, TP.icon('bookmark'), 'Glossary'); };
  TP.showGlossary = function () {
    var list = G.slice().sort(function (a, b) { return a.term.toLowerCase() < b.term.toLowerCase() ? -1 : 1; });
    var m = TP.modal({ size: 'l', stack: true, title: h('div', { class: 'md-t' }, 'Glossary'),
      body: h('div', { class: 'no-gloss' }, h('p', { class: 'muted small' }, 'What the technical terms in the analysis mean. Anywhere a term has a dotted underline, hover over it (or tap it) for the same explanation.'),
        h('dl', { class: 'gloss-list' }, list.map(function (g) { return [h('dt', null, g.term), h('dd', null, g.def)]; }))),
      footer: h('button', { class: 'btn btn-primary', onclick: function () { m.close(); } }, 'Close') });
  };
})(window.TP);
