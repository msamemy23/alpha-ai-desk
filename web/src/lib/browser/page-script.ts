/**
 * The small script Alpha runs INSIDE a web page to read it (controls, visible text, forms) and to find one control again.
 *
 * It runs in a separate "isolated world" of the page, so the page's own scripts cannot replace the functions it uses to
 * lie about what a field is. It only reads and measures; it never reads cookies or storage, never makes requests, and
 * never types. Typing and clicking are done from outside with real input events.
 *
 * It is plain JavaScript in a string (not TypeScript) on purpose: a build tool must never rewrite code that is sent to
 * another program. Keep backticks and dollar-brace sequences out of it.
 */
export const PAGE_SCRIPT = String.raw`
(function () {
  if (globalThis.__alpha) return;
  var MAX_NODES = 9000;

  function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\' + c; }); }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }

  function parseColor(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    if (p.length < 3) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    function f(v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function backdrop(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      var bg = parseColor(getComputedStyle(n).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  var visCache = new WeakMap();
  // Is this element something a person can see? Text that is not goes to "hidden" and is only used to warn.
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (visCache.has(el)) return visCache.get(el);
    var ok = true;
    try {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') ok = false;
      else if (parseFloat(cs.opacity) < 0.05) ok = false;
      else if (parseFloat(cs.fontSize) < 4) ok = false;
      else if (el.parentElement && !isVisible(el.parentElement)) ok = false;
      else {
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0 && el.children.length === 0) ok = false;
        else if (r.right < -200 || r.bottom < -3000 && window.scrollY === 0 || r.left > document.documentElement.scrollWidth + 400) ok = false;
        else {
          var fg = parseColor(cs.color), bg = backdrop(el);
          if (fg && fg.a > 0.05 && el.textContent && el.textContent.trim()) {
            var l1 = lum(fg), l2 = lum(bg), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
            if ((hi + 0.05) / (lo + 0.05) < 1.15) ok = false;
          }
        }
      }
    } catch (e) { ok = true; }
    visCache.set(el, ok);
    return ok;
  }
  function inView(r) { return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth; }

  function locOf(el) {
    if (el.id && document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    var parts = [];
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.id && document.querySelectorAll('#' + esc(n.id)).length === 1) { parts.unshift('#' + esc(n.id)); break; }
      var tag = n.tagName.toLowerCase();
      var idx = 1, sib = n;
      while ((sib = sib.previousElementSibling)) { if (sib.tagName === n.tagName) idx++; }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      n = n.parentElement;
      if (parts.length > 14) break;
    }
    return parts.join(' > ').slice(0, 480);
  }

  function labelFor(el) {
    var t = '';
    var by = el.getAttribute('aria-labelledby');
    if (by) {
      t = by.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.textContent : ''; }).join(' ');
    }
    if (!t && el.id) {
      var lab = document.querySelector('label[for="' + String(el.id).replace(/"/g, '') + '"]');
      if (lab) t = lab.textContent;
    }
    if (!t) { var w = el.closest && el.closest('label'); if (w) t = w.textContent; }
    return clip(t, 80);
  }

  var formList = [];
  function formIndexOf(form) {
    if (!form) return -1;
    var i = formList.indexOf(form);
    if (i === -1) { formList.push(form); i = formList.length - 1; }
    return i;
  }

  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var r = el.getBoundingClientRect();
    var form = el.form || (el.closest && el.closest('form')) || null;
    var type = (el.getAttribute('type') || '').toLowerCase();
    var isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    var value = '';
    if (isField && type !== 'password' && type !== 'file') { try { value = String(el.value == null ? '' : el.value).slice(0, 300); } catch (e) {} }
    var options = [];
    if (tag === 'select') { for (var i = 0; i < el.options.length && i < 40; i++) options.push(clip(el.options[i].text, 60)); }
    return {
      tag: tag, type: type, name: clip(el.getAttribute('name'), 60), id: clip(el.id, 60),
      label: labelFor(el), placeholder: clip(el.getAttribute('placeholder'), 60), ariaLabel: clip(el.getAttribute('aria-label'), 80),
      title: clip(el.getAttribute('title'), 80), autocomplete: clip(el.getAttribute('autocomplete'), 40),
      text: isField ? '' : clip(el.innerText || el.textContent, 100),
      href: tag === 'a' ? String(el.href || '').slice(0, 1000) : '',
      value: value, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', checked: !!el.checked,
      formIndex: formIndexOf(form),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      options: options, loc: locOf(el),
      consent: !!(el.closest && el.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[aria-label*="cookie" i],[aria-label*="consent" i]')),
      download: el.hasAttribute('download')
    };
  }

  var SELECTOR = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[onclick]';

  function visibleText(limit) {
    var out = [], hidden = [], total = 0, htotal = 0, nodes = 0;
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode()) && nodes++ < MAX_NODES) {
      var p = n.parentElement;
      if (!p) continue;
      var tn = p.tagName;
      if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'NOSCRIPT' || tn === 'TEMPLATE' || tn === 'TEXTAREA' || tn === 'OPTION') continue;
      var s = n.nodeValue.replace(/\s+/g, ' ');
      if (!s.trim()) continue;
      if (isVisible(p)) { if (total < limit) { out.push(s); total += s.length; } }
      else if (htotal < 20000) { hidden.push(s); htotal += s.length; }
    }
    return { text: out.join('\n').replace(/ ?\n ?/g, '\n').slice(0, limit), hidden: hidden.join('\n') };
  }

  function collect(opts) {
    formList = [];
    visCache = new WeakMap();
    var max = (opts && opts.maxControls) || 80;
    var els = Array.prototype.slice.call(document.querySelectorAll(SELECTOR), 0, 900);
    var controls = [];
    for (var i = 0; i < els.length && controls.length < max; i++) {
      var el = els[i];
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (!isVisible(el)) continue;
      if (el.tagName === 'INPUT' && (el.type === 'hidden')) continue;
      var d = describe(el);
      d.inView = inView(r);
      controls.push(d);
    }
    var forms = formList.map(function (f, idx) {
      var action = '', same = true;
      try { var u = new URL(f.getAttribute('action') || location.href, location.href); action = u.href; same = u.origin === location.origin; } catch (e) {}
      return { index: idx, method: (f.getAttribute('method') || 'get').toLowerCase() === 'post' ? 'post' : 'get', action: action, sameOrigin: same, fieldCount: f.querySelectorAll('input,select,textarea').length, hasPassword: !!f.querySelector('input[type="password"]') };
    });
    var vt = visibleText((opts && opts.textLimit) || 9000);
    var comments = [];
    var cw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT, null);
    var cn, cc = 0;
    while ((cn = cw.nextNode()) && cc++ < 200) comments.push(cn.nodeValue.slice(0, 500));
    return {
      url: location.href, title: clip(document.title, 200),
      scrollY: Math.round(window.scrollY), scrollHeight: Math.round(document.documentElement.scrollHeight),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      controls: controls, forms: forms, text: vt.text, hidden: vt.hidden + '\n' + comments.join('\n'),
      hasPassword: !!document.querySelector('input[type="password"]'),
      captcha: !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile')
    };
  }

  function find(loc) {
    try { return document.querySelector(loc); } catch (e) { return null; }
  }

  // Describe one control found by its path, and report where to click. Scrolls it into view first.
  function locate(loc, scroll) {
    var el = find(loc);
    if (!el) return null;
    formList = [];
    if (scroll) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {} }
    var d = describe(el);
    var r = el.getBoundingClientRect();
    var cx = Math.round(r.left + Math.min(r.width / 2, 400)), cy = Math.round(r.top + Math.min(r.height / 2, 300));
    var top = document.elementFromPoint(cx, cy);
    var covered = !(top && (top === el || el.contains(top) || (top.tagName === 'LABEL' && top.control === el)));
    var forms = [];
    var f = el.form || (el.closest && el.closest('form'));
    if (scroll) {
      // Nothing opens a second window: links and forms open in this one.
      try { if (el.tagName === 'A' && el.target && el.target !== '_self') el.target = '_self'; if (f && f.target && f.target !== '_self') f.target = '_self'; } catch (e) {}
    }
    if (f) {
      var isSubmit = (d.tag === 'button' && d.type !== 'button' && d.type !== 'reset') || (d.tag === 'input' && (d.type === 'submit' || d.type === 'image'));
      var fa = isSubmit ? (el.getAttribute('formaction') || '') : '';
      var fm = isSubmit ? (el.getAttribute('formmethod') || '') : '';
      var action = '', same = true;
      try { var u = new URL(fa || f.getAttribute('action') || location.href, location.href); u.hash = ''; action = u.href; same = u.origin === location.origin; } catch (e) {}
      forms.push({ index: d.formIndex, method: (fm || f.getAttribute('method') || 'get').toLowerCase() === 'post' ? 'post' : 'get', action: action, sameOrigin: same, fieldCount: f.querySelectorAll('input,select,textarea').length, hasPassword: !!f.querySelector('input[type="password"]') });
      var fields = [];
      var inputs = f.querySelectorAll('input,select,textarea');
      for (var i = 0; i < inputs.length && i < 40; i++) {
        var x = inputs[i];
        if (x.type === 'hidden' || x.type === 'submit' || x.type === 'button' || x.type === 'image' || x.type === 'password') continue;
        var dx = describe(x);
        var val = dx.value;
        if (x.type === 'checkbox' || x.type === 'radio') val = x.checked ? 'checked' : '';
        if (val) fields.push({ raw: dx, value: String(val).slice(0, 200) });
      }
      d.formFields = fields;
    }
    return { control: d, point: { x: cx, y: cy }, covered: covered, forms: forms, captcha: !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile') };
  }

  function setSelect(loc, wanted) {
    var el = find(loc);
    if (!el || el.tagName !== 'SELECT') return false;
    var w = String(wanted).trim().toLowerCase();
    for (var i = 0; i < el.options.length; i++) {
      var o = el.options[i];
      if (o.value.toLowerCase() === w || o.text.trim().toLowerCase() === w) {
        el.value = o.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function focusAndClear(loc) {
    var el = find(loc);
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); el.focus(); if (el.select) el.select(); } catch (e) {}
    return document.activeElement === el;
  }

  function focusOnly(loc) {
    var el = find(loc);
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); el.focus(); } catch (e) {}
    return document.activeElement === el;
  }

  function scrollTo(y) { window.scrollTo(0, y); return Math.round(window.scrollY); }

  globalThis.__alpha = { collect: collect, locate: locate, setSelect: setSelect, focusAndClear: focusAndClear, focusOnly: focusOnly, scrollTo: scrollTo };
})();
`
