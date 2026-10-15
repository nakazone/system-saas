/**
 * ObraMate CRM — interface language (pt-BR / en-US / es-ES).
 *
 * The CRM screens are written in Portuguese (with some English). Instead of
 * rewriting every screen with keys, this script translates what is on the page:
 * text nodes and the placeholder / title / aria-label / alt attributes, including
 * everything the scripts add later (MutationObserver). The dictionary comes from
 * /api/i18n/bundle (base translations + the Master "Idiomas" edits + term swaps)
 * and is cached in localStorage by version.
 *
 * Language: the user's choice (saved on the account and on this device), else the
 * company default, else the browser. Portuguese with no Master edits = nothing runs.
 *
 * Opt out on an element with data-no-i18n (and its children). Customer documents
 * drawn inside the CRM (.qp-page, .inv-paper) keep their English labels.
 */
(function () {
  if (window.CrmI18n && window.CrmI18n.__engine) return;

  var STORAGE_KEY = "crm_locale";
  var CACHE_PREFIX = "om_i18n_";
  var SUPPORTED = ["pt", "en", "es"];
  var HTML_LANG = { pt: "pt-BR", en: "en-US", es: "es-ES" };
  var boot = window.__OM_I18N || {};

  // Small key → text strings used by the account menu (kept from the first version).
  var STRINGS = {
    en: {
      "menu.settings": "Settings", "menu.account": "My profile", "menu.company": "Company settings",
      "menu.team": "Team", "menu.language": "Language", "menu.logout": "Log out", "menu.refresh": "Refresh app",
      "menu.open": "Account menu", "lang.en": "English", "lang.pt": "Português", "lang.es": "Español",
      "nav.users": "Team", "nav.settings": "Settings",
    },
    pt: {
      "menu.settings": "Configurações", "menu.account": "Meu perfil", "menu.company": "Configurações da empresa",
      "menu.team": "Equipe", "menu.language": "Idioma", "menu.logout": "Sair", "menu.refresh": "Atualizar app",
      "menu.open": "Menu da conta", "lang.en": "English", "lang.pt": "Português", "lang.es": "Español",
      "nav.users": "Equipe", "nav.settings": "Configurações",
    },
    es: {
      "menu.settings": "Configuración", "menu.account": "Mi perfil", "menu.company": "Configuración de la empresa",
      "menu.team": "Equipo", "menu.language": "Idioma", "menu.logout": "Cerrar sesión", "menu.refresh": "Actualizar app",
      "menu.open": "Menú de la cuenta", "lang.en": "English", "lang.pt": "Português", "lang.es": "Español",
      "nav.users": "Equipo", "nav.settings": "Configuración",
    },
  };

  function normalize(code) {
    var c = String(code || "").toLowerCase().slice(0, 2);
    return SUPPORTED.indexOf(c) >= 0 ? c : null;
  }
  function storeGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storeSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }

  function getLocale() {
    return normalize(storeGet(STORAGE_KEY)) || normalize(boot.locale) || browserLocale();
  }
  function browserLocale() {
    var nav = normalize(navigator.language);
    return nav === "en" || nav === "es" ? nav : "pt";
  }

  var locale = getLocale();
  document.documentElement.lang = HTML_LANG[locale];

  // ---------------------------------------------------------------------------
  // Dictionary
  // ---------------------------------------------------------------------------
  var exact = Object.create(null); // normalized source → target
  var englishOrigin = Object.create(null); // sources that are English in the code (kept inside documents)
  var patterns = []; // { re, out, len }
  var terms = []; // { re, to, toPlural }
  var active = false;

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function compileTerm(t) {
    // Swaps a word or expression; keeps the casing of what was on screen.
    var list = [];
    if (t.fp && t.rp) list.push({ find: t.fp, to: t.rp });
    list.push({ find: t.f, to: t.r });
    return list.map(function (x) {
      var flags = t.c ? "gu" : "giu";
      return { re: new RegExp("(^|[^\\p{L}\\p{N}_])(" + escRe(x.find) + ")(?=$|[^\\p{L}\\p{N}_])", flags), to: x.to, exactCase: !!t.c };
    });
  }

  function load(bundle) {
    exact = Object.create(null);
    englishOrigin = Object.create(null);
    patterns = [];
    terms = [];
    var e = bundle.exact || {};
    for (var k in e) exact[k] = e[k];
    (bundle.english || []).forEach(function (k) { englishOrigin[k] = 1; });
    (bundle.patterns || []).forEach(function (p) {
      var src = p[0];
      var parts = src.split(/\{(\d+)\}/);
      var re = "^";
      var order = [];
      for (var i = 0; i < parts.length; i++) {
        if (i % 2 === 0) re += escRe(parts[i]);
        else { re += "(.+?)"; order.push(Number(parts[i])); }
      }
      re += "$";
      // Placeholders stuck to a word ("Orçamentos{0}") only accept values we can translate,
      // otherwise "Orçamentos enviados" would come out half translated.
      var glued = {};
      src.replace(/\{(\d+)\}/g, function (m0, n, at) {
        var before = src.charAt(at - 1), after = src.charAt(at + m0.length);
        if (/[A-Za-zÀ-ÿ]/.test(before) || /[A-Za-zÀ-ÿ]/.test(after)) glued[n] = 1;
        return m0;
      });
      try { patterns.push({ re: new RegExp(re), out: p[1], order: order, glued: glued, len: src.replace(/\{\d+\}/g, "").length, src: src }); } catch (_) {}
    });
    patterns.sort(function (a, b) { return b.len - a.len; });
    (bundle.terms || []).forEach(function (t) { terms = terms.concat(compileTerm(t)); });
    active = Object.keys(exact).length > 0 || patterns.length > 0 || terms.length > 0;
  }

  function matchCase(sample, word) {
    if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
    var first = sample.charAt(0);
    if (first === first.toUpperCase() && first !== first.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
    return word.charAt(0).toLowerCase() + word.slice(1);
  }

  function applyTerms(text) {
    if (!terms.length) return text;
    var out = text;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      t.re.lastIndex = 0;
      out = out.replace(t.re, function (_m, pre, word) {
        return pre + (t.exactCase ? t.to : matchCase(word, t.to));
      });
    }
    return out;
  }

  var DATE_WORDS = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|dom|seg|ter|qua|qui|sex|sáb|hoje|ontem|amanhã|h|min|d|sq|ft|lf|am|pm)\b\.?/gi;
  /** Has words (not just numbers, money or dates). */
  function wordy(v) {
    return /[A-Za-zÀ-ÿ]{2}/.test(String(v).replace(DATE_WORDS, ""));
  }

  function exactOf(t, inDoc) {
    if (inDoc && englishOrigin[t]) return null;
    var hit = exact[t];
    return hit == null ? null : hit;
  }

  /** A value captured by a pattern: known text, or parts split by "·". */
  function inner(v, inDoc) {
    var t = v.trim();
    if (!t) return v;
    var hit = exactOf(t, inDoc);
    if (hit != null) return v.replace(t, hit);
    if (t.indexOf("·") >= 0) {
      var changed = false;
      var out = v.split(/(\s*·\s*)/).map(function (part, i) {
        if (i % 2 === 1 || !part.trim()) return part;
        var h = exactOf(part.trim(), inDoc);
        if (h == null) h = byPattern(part.trim(), inDoc, true);
        if (h == null) return part;
        changed = true;
        return part.replace(part.trim(), h);
      });
      if (changed) return out.join("");
    }
    return null;
  }

  function byPattern(key, inDoc, strict) {
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i];
      if (inDoc && englishOrigin[p.src]) continue;
      var m = p.re.exec(key);
      if (!m) continue;
      var vals = {};
      var ok = true;
      // Short patterns ("para {0}", "{0} pago") only take values that are numbers, dates or known text.
      var tight = strict || p.len < 7;
      for (var j = 0; j < p.order.length; j++) {
        var n = p.order[j];
        var raw = m[j + 1];
        var tr = inner(raw, inDoc);
        if (tr == null && wordy(raw) && (p.glued[n] || tight)) { ok = false; break; }
        vals[n] = tr == null ? raw : tr;
      }
      if (!ok) continue;
      return p.out.replace(/\{(\d+)\}/g, function (_x, n) { return vals[n] == null ? "" : vals[n]; });
    }
    return null;
  }

  function translateCore(key, inDoc) {
    var hit = exactOf(key, inDoc);
    if (hit != null) return hit;
    var viaPattern = byPattern(key, inDoc, false);
    if (viaPattern != null) return viaPattern;
    var seg = bySegments(key, inDoc);
    if (seg != null) return seg;
    // "nada urgente." / "Salvar:" → the text without the final punctuation
    var m = /^(.*[^\s.:!?…])([.:!?…]+)$/.exec(key);
    if (m) {
      var bare = exactOf(m[1], inDoc);
      if (bare == null) bare = byPattern(m[1], inDoc, false);
      if (bare != null) return bare.replace(/[.:!?…]+$/, "") + m[2];
    }
    return null;
  }

  /** "A pagar · Instalação" → each part on its own, when the whole text isn't known. */
  function bySegments(key, inDoc) {
    if (key.indexOf(" · ") < 0) return null;
    var changed = false;
    var out = key.split(" · ").map(function (part) {
      var t = part.trim();
      if (!t) return part;
      var h = exactOf(t, inDoc);
      if (h == null) h = byPattern(t, inDoc, false);
      if (h == null) return part;
      changed = true;
      return h;
    });
    return changed ? out.join(" · ") : null;
  }

  // Dates written by the screens in Portuguese ("15 out", "terça-feira", "outubro de 2026").
  var DATES = {
    en: {
      mon: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      month: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    },
    es: {
      mon: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
      month: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
      wd: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
      weekday: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
    },
  };
  var PT_MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var PT_MONTH = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var PT_WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  var PT_WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  var reMonthWord = new RegExp("(^|[^\\p{L}])(" + PT_MONTH.join("|") + ")(?=$|[^\\p{L}])", "giu");
  var reMonShort = new RegExp("(\\d{1,2}\\.?\\s|^|[^\\p{L}])(" + PT_MON.join("|") + ")\\.?(?=(\\s+\\d|\\s*[–-]|\\s*$|,|\\s·))", "giu");
  var reWeekday = new RegExp("(^|[^\\p{L}])(" + PT_WEEKDAY.join("|") + ")(-feira)?(?=$|[^\\p{L}])", "giu");
  var reWdShort = new RegExp("(^|[^\\p{L}])(" + PT_WD.join("|") + ")\\.?(?=,?\\s+\\d|\\s*$)", "giu");
  function cap(sample, word) {
    if (sample.length > 1 && sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
    var f = sample.charAt(0);
    return f === f.toUpperCase() && f !== f.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }
  function fixDates(text) {
    var D = DATES[locale];
    if (!D) return text;
    var out = text;
    // "15 de outubro de 2026" / "15 de outubro"
    out = out.replace(new RegExp("(\\d{1,2}) de (" + PT_MONTH.join("|") + ")( de (\\d{4}))?", "giu"), function (_m, d, mo, _y, y) {
      var i = PT_MONTH.indexOf(mo.toLowerCase());
      if (locale === "en") return D.month[i] + " " + d + (y ? ", " + y : "");
      return d + " de " + D.month[i] + (y ? " de " + y : "");
    });
    // "outubro de 2026"
    out = out.replace(new RegExp("(" + PT_MONTH.join("|") + ") de (\\d{4})", "giu"), function (_m, mo, y) {
      var i = PT_MONTH.indexOf(mo.toLowerCase());
      return cap(mo, D.month[i]) + (locale === "en" ? " " : " de ") + y;
    });
    out = out.replace(reMonthWord, function (_m, pre, mo) { return pre + cap(mo, D.month[PT_MONTH.indexOf(mo.toLowerCase())]); });
    out = out.replace(reWeekday, function (m, pre, wd, feira) {
      var i = PT_WEEKDAY.indexOf(wd.toLowerCase());
      if (i >= 1 && i <= 5 && !feira && pre !== "") return m; // "segunda" inside a sentence can mean "second"
      return pre + cap(wd, D.weekday[i]);
    });
    out = out.replace(reMonShort, function (m, pre, mo) {
      var i = PT_MON.indexOf(mo.toLowerCase());
      if (i < 0) return m;
      return pre + cap(mo, D.mon[i]);
    });
    out = out.replace(reWdShort, function (m, pre, wd) {
      var i = PT_WD.indexOf(wd.toLowerCase());
      if (i < 0) return m;
      return pre + cap(wd, D.wd[i]);
    });
    return out;
  }
  var shortDate = /^(dom|seg|ter|qua|qui|sex|sáb|sab|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?$/i;
  var dateHint = /\d|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|-feira|domingo|sábado|terça|quarta|quinta|sexta|segunda/i;

  /** Translate one string as shown on screen (keeps the outer spaces). */
  function translateText(raw, inDoc) {
    if (!raw || !/[A-Za-zÀ-ÿ]/.test(raw)) return raw;
    var lead = raw.match(/^\s*/)[0];
    var trail = raw.match(/\s*$/)[0];
    var key = raw.replace(/\s+/g, " ").trim();
    if (!key) return raw;
    var out = translateCore(key, inDoc);
    var res = out == null ? key : out;
    if (!inDoc && locale !== "pt" && (dateHint.test(res) || shortDate.test(res))) res = fixDates(res);
    if (!inDoc) res = applyTerms(res);
    if (out == null && res === key) return raw;
    return lead + res + trail;
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1 };
  var DOC_SEL = ".qp-page, .inv-paper";
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  var done = new WeakMap(); // node → last text we wrote
  var origAttr = new WeakMap(); // element → { attr: original }

  function skipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP_TAGS[n.tagName]) return true;
      if (n.isContentEditable) return true;
      if (n.hasAttribute("data-no-i18n")) return true;
    }
    return false;
  }
  function inDocument(el) {
    return !!(el && el.closest && el.closest(DOC_SEL));
  }

  function doText(node) {
    var parent = node.parentElement;
    if (!parent || skipped(parent)) return;
    var cur = node.data;
    if (done.get(node) === cur) return;
    var next = translateText(cur, inDocument(parent));
    if (next !== cur) {
      done.set(node, next);
      node.data = next;
    } else {
      done.set(node, cur);
    }
  }

  function doAttrs(el) {
    // TEXTAREA content is the user's text, but its placeholder/title are interface.
    if (el.tagName === "TEXTAREA" ? el.parentElement && skipped(el.parentElement) : skipped(el)) return;
    var doc = inDocument(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      fixAttr(el, a, doc);
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.hasAttribute("value")) fixAttr(el, "value", doc);
  }
  function fixAttr(el, a, doc) {
    var v = el.getAttribute(a);
    var memo = origAttr.get(el);
    if (memo && memo["_" + a] === v) return; // we wrote it
    var next = translateText(v, doc);
    if (!memo) { memo = {}; origAttr.set(el, memo); }
    memo["_" + a] = next;
    if (next !== v) el.setAttribute(a, next);
  }

  function walk(root) {
    if (!active || !root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (skipped(root)) return;
      doAttrs(root);
    }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (n.tagName === "TEXTAREA") { doAttrs(n); return NodeFilter.FILTER_REJECT; }
          return SKIP_TAGS[n.tagName] || n.hasAttribute("data-no-i18n") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else doAttrs(n);
    }
  }

  var observer = null;
  function observe() {
    if (observer || !active) return;
    observer = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") { if (m.target.nodeType === 1) doAttrs(m.target); }
        else if (m.target && m.target.tagName === "TEXTAREA") continue;
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS.concat(["value"]),
    });
  }

  // Dialogs created by the browser.
  function patchDialogs() {
    ["alert", "confirm", "prompt"].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== "function" || orig.__omI18n) return;
      var wrapped = function (msg) {
        var args = Array.prototype.slice.call(arguments);
        if (active && typeof msg === "string") {
          args[0] = msg.split("\n").map(function (line) { return translateText(line, false); }).join("\n");
        }
        return orig.apply(window, args);
      };
      wrapped.__omI18n = true;
      window[name] = wrapped;
    });
  }

  // Dates written with a hard-coded "pt-BR" follow the chosen language.
  function patchDates() {
    if (locale === "pt") return;
    var target = HTML_LANG[locale];
    function fix(l) {
      if (typeof l === "string" && /^pt/i.test(l)) return target;
      if (Array.isArray(l)) return l.map(fix);
      return l;
    }
    ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"].forEach(function (fn) {
      var orig = Date.prototype[fn];
      Date.prototype[fn] = function (l, o) { return orig.call(this, fix(l === undefined ? "pt-BR" : l), o); };
    });
    var DTF = Intl.DateTimeFormat;
    var Patched = function (l, o) { return new DTF(fix(l === undefined ? "pt-BR" : l), o); };
    Patched.prototype = DTF.prototype;
    Patched.supportedLocalesOf = DTF.supportedLocalesOf;
    Intl.DateTimeFormat = Patched;
  }

  function start() {
    if (locale !== "pt") {
      // Longer words than Portuguese in the dock ("Presupuestos", "Calendario").
      var st = document.createElement("style");
      st.setAttribute("data-om-i18n-css", "");
      st.textContent =
        "html[lang] body.dashboard-app-body:not(.om-device-mobile):not(.om-no-dock):not(.qb-sidebar-page) #dashboardSidebar .nav-item .nav-item__label{max-width:76px!important;font-size:10px!important;letter-spacing:-0.02em!important}";
      (document.head || document.documentElement).appendChild(st);
    }
    patchDialogs();
    patchDates();
    walk(document.documentElement);
    observe();
  }

  // ---------------------------------------------------------------------------
  // Bundle loading (localStorage cache by version)
  // ---------------------------------------------------------------------------
  var cacheKey = CACHE_PREFIX + locale;
  var version = boot.v || "";
  var ready = false;
  var readyCbs = [];

  function markReady() {
    ready = true;
    document.documentElement.classList.remove("om-i18n-wait");
    readyCbs.splice(0).forEach(function (f) { try { f(); } catch (_) {} });
  }

  function useBundle(b) {
    load(b);
    if (active) start();
    markReady();
  }

  function fetchBundle() {
    return fetch("/api/i18n/bundle?locale=" + locale + "&v=" + encodeURIComponent(version || "0"), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        if (!b) return null;
        storeSet(cacheKey, JSON.stringify(b));
        return b;
      })
      .catch(function () { return null; });
  }

  var cached = null;
  try { cached = JSON.parse(storeGet(cacheKey) || "null"); } catch (_) { cached = null; }

  if (cached && (!version || cached.v === version)) {
    useBundle(cached);
  } else {
    // Hide the page briefly so it doesn't flash in Portuguese (max 1.5 s).
    if (locale !== "pt" && !cached) {
      document.documentElement.classList.add("om-i18n-wait");
      var st = document.createElement("style");
      st.textContent = "html.om-i18n-wait body{visibility:hidden}";
      (document.head || document.documentElement).appendChild(st);
      setTimeout(markReady, 1500);
    }
    if (cached) useBundle(cached); // old version now, fresh one replaces it below
    fetchBundle().then(function (b) {
      if (b) {
        var wasActive = active;
        load(b);
        if (active) { if (!wasActive) start(); else walk(document.documentElement); }
      }
      if (!ready) markReady();
    });
  }

  // ---------------------------------------------------------------------------
  // Language choice
  // ---------------------------------------------------------------------------
  function setLocale(code, opts) {
    var next = normalize(code) || "pt";
    storeSet(STORAGE_KEY, next);
    document.documentElement.lang = HTML_LANG[next];
    try {
      document.dispatchEvent(new CustomEvent("crm:localechange", { detail: { locale: next } }));
    } catch (_) {}
    if (!(opts && opts.local)) {
      fetch("/api/i18n/locale", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(function () {});
    }
    return next;
  }

  /** Save the language on the account and reload the page in it. */
  function switchTo(code) {
    var next = setLocale(code, { local: true });
    fetch("/api/i18n/locale", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    })
      .catch(function () {})
      .then(function () { location.reload(); });
  }

  // Account / company language: checked once per session, so a change made on
  // another device (or a company default) reaches this one.
  function syncFromAccount() {
    var flag = "om_i18n_synced";
    try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, "1"); } catch (_) {}
    fetch("/api/i18n/me", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.locale) return;
        var want = normalize(j.locale);
        if (!want) return;
        var stored = normalize(storeGet(STORAGE_KEY));
        if (j.source === "user" && want !== stored) { storeSet(STORAGE_KEY, want); if (want !== locale) location.reload(); }
        else if (!stored) { storeSet(STORAGE_KEY, want); if (want !== locale) location.reload(); }
      })
      .catch(function () {});
  }
  if (!/^\/(login|forgot-password|reset-password|change-password)\.html$/.test(location.pathname)) syncFromAccount();

  function t(key) {
    var pack = STRINGS[locale] || STRINGS.pt;
    return pack[key] || STRINGS.en[key] || key;
  }

  // data-i18n keys (account menu) + a full pass.
  function applyDom(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!key) return;
      var value = t(key);
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.setAttribute("placeholder", value);
      else el.textContent = value;
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
    walk(scope === document ? document.documentElement : scope);
  }

  window.CrmI18n = {
    __engine: true,
    SUPPORTED: SUPPORTED,
    LABELS: { pt: "Português (Brasil)", en: "English (US)", es: "Español (España)" },
    getLocale: function () { return locale; },
    setLocale: setLocale,
    switchTo: switchTo,
    t: t,
    /** Translate a string from the code (for scripts that build text). */
    tr: function (s) { return active ? translateText(String(s == null ? "" : s), false) : s; },
    apply: applyDom,
    onReady: function (f) { if (ready) f(); else readyCbs.push(f); },
    STRINGS: STRINGS,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { applyDom(document); });
  }
})();
