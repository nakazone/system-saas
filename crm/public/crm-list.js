/* ObraMate — comportamento comum das listas laterais (.ol-list).
 *
 * Não muda como cada módulo desenha a lista. Depois de cada render ele:
 *   1. Transforma cada cabeçalho .ol-grp num botão que recolhe o grupo
 *      (estado salvo por página + grupo). Grupos "encerrados" (concluídos,
 *      pagos, arquivados…) começam recolhidos quando há outros grupos.
 *   2. Mostra só as primeiras linhas de grupos longos, com "Mostrar mais N".
 *   3. Desenha uma faixa com os filtros ativos (busca, selects, segmentos),
 *      cada um com ×, mais "Limpar" e "Recolher tudo / Abrir tudo".
 *
 * Buscando, tudo abre: resultado de busca nunca fica escondido.
 * Um módulo pode marcar um controle com data-ol-ignore (ex.: Ordenar) para não
 * virar filtro, e um contêiner de chips com data-ol-filter.
 */
(function () {
  "use strict";

  var CAP = 6;          // linhas visíveis por grupo antes de "Mostrar mais"
  var CAP_FLAT = 20;    // lista sem grupos
  var SLACK = 2;        // não esconder só 1–2 linhas: mostra tudo
  // grupos que pedem ação: nunca começam recolhidos
  var HOT_RE = /sem data|atrasad|vencid|overdue|pede|aguardando aprova|não lid|a classificar/i;
  var DONE_RE = /conclu|finaliz|aprovados|expirad|\bpag[oa]s?\b|paid|arquiv|cancel|perdid|recusad|anulad|\bvoid\b|fechad/i;

  var lists = [];

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
    return {};
  }

  function labelOf(h) { return textNoCount(h); }

  function textNoCount(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll("em, .visually-hidden, svg").forEach(function (n) { n.remove(); });
    return c.textContent.replace(/\s+/g, " ").trim();
  }

  function isOn(b) {
    return b.classList.contains("is-on") || b.classList.contains("is-active") ||
      b.getAttribute("aria-pressed") === "true" || b.getAttribute("aria-selected") === "true";
  }

  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

  /* ---------- filtros ativos */
  function activeFilters(L) {
    var top = L.top;
    if (!top) return [];
    var out = [];
    top.querySelectorAll('input[type="search"]').forEach(function (inp) {
      if (inp.closest("[data-ol-ignore]") || !inp.value.trim()) return;
      out.push({ label: "“" + inp.value.trim() + "”", clear: function () { inp.value = ""; fire(inp, "input"); fire(inp, "search"); } });
    });
    top.querySelectorAll("select").forEach(function (sel) {
      if (sel.closest("[data-ol-ignore]") || sel.selectedIndex <= 0) return;
      var name = sel.getAttribute("aria-label") || "";
      var opt = sel.options[sel.selectedIndex];
      out.push({
        label: (name ? name + ": " : "") + (opt ? opt.textContent.trim() : sel.value),
        clear: function () { sel.selectedIndex = 0; fire(sel, "change"); }
      });
    });
    top.querySelectorAll(".ol-seg, [data-ol-filter]").forEach(function (seg) {
      if (seg.closest("[data-ol-ignore]") || seg.hidden) return;
      var btns = Array.prototype.filter.call(seg.querySelectorAll("button, a"), function (b) { return !b.hidden; });
      if (btns.length < 2) return;
      var on = btns.filter(isOn)[0];
      if (!on || on === btns[0]) return;
      out.push({ label: textNoCount(on), clear: function () { btns[0].click(); } });
    });
    return out;
  }

  function searching(L) {
    return !!(L.top && Array.prototype.some.call(L.top.querySelectorAll('input[type="search"]'), function (i) {
      return i.value.trim();
    }));
  }

  /* ---------- grupos */
  function groupsOf(rows) {
    var heads = rows.querySelectorAll(".ol-grp");
    var groups = [];
    heads.forEach(function (h) {
      var items = [];
      for (var n = h.nextElementSibling; n && !n.classList.contains("ol-grp"); n = n.nextElementSibling) {
        if (n.classList.contains("ol-more")) continue;
        items.push(n);
      }
      if (items.length) groups.push({ head: h, label: labelOf(h), items: items });
    });
    if (!groups.length) {
      var flat = Array.prototype.filter.call(rows.children, function (n) {
        return !n.classList.contains("ol-more") && !n.classList.contains("ol-filt") && n.tagName !== "P";
      });
      if (flat.length) groups.push({ head: null, label: "", items: flat });
    }
    return groups;
  }

  function apply(L) {
    L.mo.disconnect();
    try { render(L); if (!(L.spyLock && Date.now() < L.spyLock)) { L.spy = null; spy(L); } else markSpy(L); } finally { L.mo.observe(L.rows, { childList: true, subtree: true }); }
  }

  function render(L) {
    var rows = L.rows;
    rows.querySelectorAll(".ol-more").forEach(function (b) { b.remove(); });
    var q = searching(L);
    var folds = store(L.key);
    var groups = groupsOf(rows);
    var heads = groups.filter(function (g) { return g.head; });
    var multi = heads.length > 1;
    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    // muitos grupos e muitas linhas: só os 3 primeiros (abertos) começam abertos
    var openSlots = total > 24 ? 3 : Infinity;
    var nItems = 0;
    var nShown = 0;

    groups.forEach(function (g) {
      var h = g.head;
      var collapsed = false;
      if (h) {
        var saved = Object.prototype.hasOwnProperty.call(folds, g.label) ? folds[g.label] : null;
        var forceClosed = h.getAttribute("data-ol-closed") === "1";
        var forceOpen = h.getAttribute("data-ol-open") === "1";
        var hot = !forceClosed && HOT_RE.test(g.label);
        var auto = forceClosed || (!hot && (DONE_RE.test(g.label) || openSlots <= 0));
        if (q || forceOpen) collapsed = false;
        else if (saved !== null) collapsed = saved;
        else if (forceClosed) collapsed = true;
        else collapsed = multi && auto;
        if (!collapsed && !hot && !DONE_RE.test(g.label)) openSlots--;
        h.classList.add("ol-grp--fold");
        h.classList.toggle("is-folded", collapsed);
        h.setAttribute("role", "button");
        h.setAttribute("tabindex", "0");
        h.setAttribute("aria-expanded", String(!collapsed));
        h.dataset.olLabel = g.label;
        if (!h.querySelector(".ol-chev")) {
          h.insertAdjacentHTML("afterbegin", '<svg class="ol-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>');
        }
      }
      var cap = h ? CAP : CAP_FLAT;
      var open = q || L.opened[g.label];
      var limit = open || g.items.length <= cap + SLACK ? Infinity : cap;
      var hidden = 0;
      var last = null;
      g.items.forEach(function (it, i) {
        var keep = it.querySelector(".is-on, .is-active") || it.classList.contains("is-on") || it.classList.contains("is-active");
        var hide = collapsed || (i >= limit && !keep);
        it.classList.toggle("ol-hide", hide);
        if (hide && !collapsed) hidden++;
        if (!hide) { last = it; nShown++; }
        nItems++;
      });
      if (hidden && last) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ol-more";
        b.dataset.olLabel = g.label;
        b.textContent = "Mostrar mais " + hidden;
        last.after(b);
      }
    });
    L.groups = groups;
    bar(L, q, multi, groups);
  }

  /* ---------- faixa: filtros ativos + recolher */
  function bar(L, q, multi, groups) {
    var host = L.bar;
    var filters = activeFilters(L);
    var anyOpen = groups.some(function (g) { return g.head && !g.head.classList.contains("is-folded"); });
    var html = "";
    if (filters.length) {
      html += '<div class="ol-act" role="group" aria-label="Filtros ativos">';
      filters.forEach(function (f, i) {
        html += '<button type="button" class="ol-chip" data-ol-clear="' + i + '" aria-label="Remover filtro ' +
          esc(f.label) + '"><span>' + esc(f.label) + '</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
      });
      if (filters.length > 1) html += '<button type="button" class="ol-clear" data-ol-clear="all">Limpar</button>';
      html += "</div>";
    }
    // Índice dos grupos: a lista inteira num relance, um toque para ir ao grupo.
    // Substitui a linha "Recolher tudo" — o recolher vira o ícone no fim do índice.
    if (multi && !q) {
      var idx = [];
      var byShort = {};
      var onlyBar = groups.some(function (g) { return g.head && g.head.getAttribute("data-ol-bar") === "1"; });
      groups.forEach(function (g, gi) {
        if (!g.head) return;
        if (onlyBar && g.head.getAttribute("data-ol-bar") !== "1") return;
        var short = g.label.split(" · ")[0];
        var n = parseInt((g.head.querySelector("em") || {}).textContent, 10);
        if (isNaN(n)) n = g.items.length;
        if (byShort[short]) { byShort[short].n += n; return; }
        byShort[short] = { short: short, n: n, gi: gi, label: g.label, hot: HOT_RE.test(g.label), folded: g.head.classList.contains("is-folded") };
        idx.push(byShort[short]);
      });
      var foldLabel = anyOpen ? "Recolher todos os grupos" : "Abrir todos os grupos";
      html += '<div class="ol-idx"><nav class="ol-idx__list" aria-label="Ir para o grupo">' +
        idx.map(function (x) {
          return '<button type="button" class="ol-idx__b' + (x.hot ? " is-hot" : "") + (x.folded ? " is-folded" : "") +
            (L.spy === x.short ? " is-here" : "") + '" data-ol-go="' + x.gi + '" data-ol-short="' + esc(x.short) + '">' +
            esc(x.short) + "<em>" + x.n + "</em></button>";
        }).join("") +
        '</nav><button type="button" class="ol-idx__fold" data-ol-foldall="' + (anyOpen ? "1" : "0") + '" aria-label="' + foldLabel +
        '" title="' + foldLabel + '"><svg viewBox="0 0 24 24" aria-hidden="true">' +
        (anyOpen ? '<path d="m7 11 5-5 5 5M7 18l5-5 5 5"/>' : '<path d="m7 6 5 5 5-5M7 13l5 5 5-5"/>') + "</svg></button></div>";
    }
    L.filters = filters;
    if (host.innerHTML !== html) {
      var nav = host.querySelector(".ol-idx__list");
      var sx = nav ? nav.scrollLeft : 0;
      host.innerHTML = html;
      nav = host.querySelector(".ol-idx__list");
      if (nav) nav.scrollLeft = sx;
    }
    host.hidden = !html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function toggle(L, h) {
    if (h.getAttribute("data-ol-open") === "1") return;
    var folds = store(L.key);
    var label = h.dataset.olLabel;
    folds[label] = !h.classList.contains("is-folded");
    var keys = Object.keys(folds);
    if (keys.length > 80) keys.slice(0, keys.length - 80).forEach(function (k) { delete folds[k]; });
    store(L.key, folds);
    apply(L);
  }

  /* ---------- índice: ir ao grupo e marcar onde estamos */
  function goTo(L, gi) {
    var g = L.groups[gi];
    if (!g || !g.head) return;
    if (g.head.classList.contains("is-folded")) {
      var folds = store(L.key);
      folds[g.label] = false;
      store(L.key, folds);
      apply(L);
      g = L.groups[gi];
    }
    var target = g.head.parentElement && g.head.parentElement.classList.contains("ol-band") ? g.head.parentElement : g.head;
    var smooth = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    var rows = L.rows;
    if (rows.scrollHeight > rows.clientHeight + 4 && getComputedStyle(rows).overflowY !== "visible") {
      var top = target.getBoundingClientRect().top - rows.getBoundingClientRect().top + rows.scrollTop - 6;
      rows.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    } else {
      target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    }
    L.spy = g.label.split(" · ")[0];
    // o grupo tocado fica marcado mesmo que a lista não role até ele (fim da lista)
    L.spyLock = Date.now() + 1200;
    markSpy(L);
  }

  function spy(L) {
    if (!L.groups || (L.spyLock && Date.now() < L.spyLock)) return;
    var rows = L.rows;
    var inner = rows.scrollHeight > rows.clientHeight + 4 && getComputedStyle(rows).overflowY !== "visible";
    var edge = inner ? rows.getBoundingClientRect().top + 12 : (L.bar.getBoundingClientRect().bottom || 0) + 12;
    var cur = null;
    L.groups.forEach(function (g) {
      if (!g.head) return;
      var el = g.head.parentElement && g.head.parentElement.classList.contains("ol-band") ? g.head.parentElement : g.head;
      if (el.getBoundingClientRect().top <= edge) cur = g;
    });
    if (!cur) cur = L.groups.filter(function (g) { return g.head; })[0];
    var short = cur ? cur.label.split(" · ")[0] : "";
    if (short === L.spy) return;
    L.spy = short;
    markSpy(L);
  }

  function markSpy(L) {
    var here = null;
    L.bar.querySelectorAll(".ol-idx__b").forEach(function (b) {
      var on = b.dataset.olShort === L.spy;
      b.classList.toggle("is-here", on);
      if (on) here = b;
    });
    if (here) {
      var nav = here.parentElement;
      var l = here.offsetLeft - nav.offsetLeft;
      if (l < nav.scrollLeft || l + here.offsetWidth > nav.scrollLeft + nav.clientWidth) {
        nav.scrollTo({ left: Math.max(0, l - 24), behavior: "smooth" });
      }
    }
  }

  /* ---------- montar */
  function mount(list, i) {
    if (list.__ol) return;
    var rows = list.querySelector(".ol-rows, [data-ol-rows]") || list;
    var top = list.querySelector(".ol-top, [data-ol-top]");
    var barEl = document.createElement("div");
    barEl.className = "ol-filt";
    barEl.hidden = true;
    // lista "bare" re-renderiza o próprio contêiner: a faixa fica fora dele
    (rows === list ? list : rows).before(barEl);

    var L = {
      list: list, rows: rows, top: top, bar: barEl, opened: {},
      key: "olFold:" + location.pathname + ":" + (list.id || rows.id || i)
    };
    list.__ol = L;
    var t = 0;
    L.mo = new MutationObserver(function () {
      // setTimeout, não rAF: rAF para em aba/painel em segundo plano e a lista ficaria sem grupos.
      clearTimeout(t);
      t = setTimeout(function () { apply(L); }, 16);
    });

    rows.addEventListener("click", function (e) {
      var more = e.target.closest(".ol-more");
      if (more) { L.opened[more.dataset.olLabel] = true; apply(L); return; }
      var h = e.target.closest(".ol-grp--fold");
      if (h && rows.contains(h) && !e.target.closest("a, button:not(.ol-grp), input, select")) toggle(L, h);
    });
    rows.addEventListener("keydown", function (e) {
      var h = e.target.closest && e.target.closest(".ol-grp--fold");
      if (h && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(L, h); }
    });
    function onFoldAll(e) {
      var fa = e.target.closest("[data-ol-foldall]");
      if (!fa) return false;
      var fold = fa.dataset.olFoldall === "1";
      var folds = store(L.key);
      L.groups.forEach(function (g) { if (g.head) folds[g.label] = fold; });
      store(L.key, folds);
      apply(L);
      return true;
    }
    barEl.addEventListener("click", function (e) {
      var c = e.target.closest("[data-ol-clear]");
      if (c) {
        var k = c.dataset.olClear;
        if (k === "all") L.filters.slice().reverse().forEach(function (f) { f.clear(); });
        else if (L.filters[+k]) L.filters[+k].clear();
        setTimeout(function () { apply(L); }, 0);
        return;
      }
      var go = e.target.closest("[data-ol-go]");
      if (go) { goTo(L, +go.dataset.olGo); return; }
      onFoldAll(e);
    });
    // índice acompanha a rolagem: o grupo no topo fica marcado
    var spyT = 0;
    var onScroll = function () {
      clearTimeout(spyT);
      spyT = setTimeout(function () { spy(L); }, 60);
    };
    rows.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    // filtros mudam fora da lista (selects, chips, busca) → atualizar faixa
    var later = function () { setTimeout(function () { apply(L); }, 0); };
    if (top) {
      top.addEventListener("input", later);
      top.addEventListener("change", later);
      top.addEventListener("click", function (e) { if (e.target.closest("button, a")) later(); });
    }

    lists.push(L);
    apply(L);
  }

  function init() {
    document.querySelectorAll(".ol-list").forEach(mount);
  }

  window.CrmList = { refresh: function () { lists.forEach(apply); }, init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
