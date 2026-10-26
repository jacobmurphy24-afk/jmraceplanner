// UI toolkit: element builder, pop-ups (full-screen sheets on phones), notifications and display units.
(function (TP) {
  // h('div', {class: 'x', onclick: fn}, child, [children], 'text')
  TP.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    append(el, Array.prototype.slice.call(arguments, 2));
    return el;
  };
  function append(el, kids) {
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    });
  }
  TP.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  // Icons come from the inline SVG sprite in index.html, so the site needs no icon font.
  TP.icon = function (name, style) {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), use = document.createElementNS(NS, 'use');
    svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true'); if (style) svg.setAttribute('style', style);
    use.setAttribute('href', '#i-' + name); svg.appendChild(use);
    return svg;
  };

  // --- Pop-ups ---
  var stack = [];
  TP.modal = function (o) {
    var root = document.getElementById('modal-root');
    var box = TP.h('div', { class: 'md md-' + (o.size || 'm') + (o.cls ? ' ' + o.cls : ''), role: 'dialog', 'aria-modal': 'true' },
      TP.h('div', { class: 'md-head', style: o.headStyle },
        TP.h('div', { class: 'md-title' }, o.title),
        TP.h('button', { class: 'md-x', type: 'button', 'aria-label': 'Close', onclick: function () { m.close(); } }, '×')),
      TP.h('div', { class: 'md-body' }, o.body),
      o.footer ? TP.h('div', { class: 'md-foot' }, o.footer) : null);
    var shade = TP.h('div', { class: 'md-shade', onclick: function (e) { if (e.target === shade && o.easyClose !== false) m.close(); } }, box);
    var m = {
      el: box,
      close: function () { if (!shade.parentNode) return; root.removeChild(shade); stack = stack.filter(function (x) { return x !== m; }); document.body.classList.toggle('md-open', stack.length > 0); if (o.onClose) o.onClose(); }
    };
    // A new pop-up replaces the current one unless it asks to stack.
    if (!o.stack) stack.slice().forEach(function (x) { x.close(); });
    root.appendChild(shade); stack.push(m); document.body.classList.add('md-open');
    box.querySelector('.md-body').scrollTop = 0;
    return m;
  };
  TP.closeModals = function () { stack.slice().forEach(function (x) { x.close(); }); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });

  TP.confirm = function (msg, okLabel, onOk) {
    var m = TP.modal({ title: 'Are you sure?', size: 's', stack: true, body: TP.h('p', null, msg),
      footer: [TP.h('button', { class: 'btn', onclick: function () { m.close(); } }, 'Cancel'),
               TP.h('button', { class: 'btn btn-danger', onclick: function () { m.close(); onOk(); } }, okLabel)] });
  };

  TP.toast = function (msg, kind) {
    var t = TP.h('div', { class: 'toast toast-' + (kind || 'info') }, msg);
    document.getElementById('toast-root').appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, kind === 'error' ? 6000 : 3000);
  };

  // Segmented control / chips: one choice from a list. opts = [{value, label, dot}]
  TP.chips = function (opts, selected, onPick, cls) {
    var wrap = TP.h('div', { class: cls || 'chips', role: 'radiogroup' });
    function render(sel) {
      TP.clear(wrap);
      opts.forEach(function (o) {
        wrap.appendChild(TP.h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === sel), class: 'chip' + (o.value === sel ? ' on' : ''),
          onclick: function () { render(o.value); onPick(o.value); } },
          o.dot ? TP.h('span', { class: 'chip-dot', style: 'background:' + o.dot }) : null, o.label));
      });
      wrap.dataset.value = sel;
    }
    render(selected);
    wrap.set = render;
    return wrap;
  };

  // Labelled field wrapper. unit is shown inside the input on the right.
  TP.field = function (label, input, unit, cls) {
    return TP.h('label', { class: 'field' + (cls ? ' ' + cls : '') }, TP.h('span', { class: 'field-l' }, label),
      unit ? TP.h('span', { class: 'unit-wrap', 'data-unit': unit }, input) : input);
  };
  TP.input = function (type, value, attrs) { return TP.h('input', Object.assign({ type: type, value: value == null ? '' : value, class: 'inp' }, attrs || {})); };
  TP.selectEl = function (options, selected, attrs) {
    return TP.h('select', Object.assign({ class: 'inp' }, attrs || {}), options.map(function (o) {
      var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
      return TP.h('option', { value: v, selected: v === selected }, l);
    }));
  };

  // --- Display units: data stays in km / m; miles and yards are only how it's shown. ---
  // Rewrites "10 km", "400 m", "4:30 /km", "2:05 /100 m" and "28 km/h" in the page as they appear
  // (keeping the original so switching back is instant). Inputs and notes are left alone.
  TP.imperial = function () { return TP.state.prefs.units === 'imperial'; };
  TP.distFactor = function () { return TP.imperial() ? 0.621371 : 1; };
  TP.distUnit = function () { return TP.imperial() ? 'mi' : 'km'; };
  var KM_MI = 0.621371, M_YD = 1.093613;
  var RE = /(\d{1,2}):(\d{2})\s?\/(km|100\s?m)\b|(\d[\d,]*(?:\.\d+)?)(\s?)km\/h|(\d[\d,]*(?:\.\d+)?)(\s?)(km|m)\b(?![\/\w])/g;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1 };
  function numv(s) { return parseFloat(s.replace(/,/g, '')); }
  function dec(s) { var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function pace(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function conv(m) {
    if (m[1] !== undefined) { var sec = (+m[1]) * 60 + (+m[2]); return m[3] === 'km' ? pace(sec * 1.609344) + ' /mi' : pace(sec * 0.9144) + ' /100 yd'; }
    if (m[4] !== undefined) return (numv(m[4]) * KM_MI).toFixed(Math.max(1, dec(m[4]))) + m[5] + 'mph';
    var v = numv(m[6]);
    if (m[8] === 'km') { var mi = v * KM_MI, d = dec(m[6]); return mi.toFixed(d === 0 && mi < 100 ? 1 : d).replace(/\.0$/, '') + m[7] + 'mi'; }
    return Math.round(v * M_YD).toLocaleString('en-GB') + m[7] + 'yd';
  }
  function skip(n) {
    for (var p = n.parentNode; p; p = p.parentNode) {
      if (SKIP[p.nodeName] || (p.classList && (p.classList.contains('tp-u') || p.classList.contains('no-units')))) return true;
    }
    return false;
  }
  function convertIn(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [];
    while (w.nextNode()) { var t = w.currentNode; RE.lastIndex = 0; if (RE.test(t.nodeValue) && !skip(t)) nodes.push(t); }
    nodes.forEach(function (t) {
      var s = t.nodeValue, frag = document.createDocumentFragment(), last = 0, m; RE.lastIndex = 0;
      while ((m = RE.exec(s))) {
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var sp = document.createElement('span'); sp.className = 'tp-u'; sp.setAttribute('data-o', m[0]); sp.textContent = conv(m);
        frag.appendChild(sp); last = m.index + m[0].length;
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  }
  function revert() { document.querySelectorAll('.tp-u').forEach(function (sp) { sp.replaceWith(document.createTextNode(sp.getAttribute('data-o'))); }); }
  var pending = false;
  function apply() { pending = false; if (TP.imperial()) convertIn(document.body); }
  TP.applyUnits = function () { revert(); apply(); };
  TP.startUnits = function () {
    new MutationObserver(function () { if (TP.imperial() && !pending) { pending = true; setTimeout(apply, 60); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    apply();
  };
})(window.TP);
