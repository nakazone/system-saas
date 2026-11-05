/**
 * Central de Ajuda — centered dialog (top-bar help button).
 * Ask anything (AI, POST /api/help/ask) with instant local results while typing,
 * Mate tutorials per module (crm-mate-tour.js), fixes for common problems, and support tickets.
 * Content: crm-help-content.js (window.CrmHelpContent). Public API: window.__crmHelpPanel.
 */
(function () {
  var PANEL_ID = "crmHelpPanel";
  var BACKDROP_ID = "crmHelpBackdrop";
  var FACE = "/assets/img/mascot/mate-head-neutral.webp?v=20261027-m2";
  var state = { tab: "home", view: "list", detail: null, query: "", supportStatus: "", ai: null };
  var lastFocus = null;

  function C() {
    return window.CrmHelpContent || null;
  }

  function loc() {
    var c = C();
    return c ? c.locale() : "pt";
  }

  function en() {
    return loc() === "en";
  }

  function ui() {
    var c = C();
    if (!c) return {};
    return c.UI[loc()] || c.UI.pt;
  }

  function pick(obj) {
    var c = C();
    return c ? c.pick(obj, loc()) : "";
  }

  function T(pt, enText) {
    return en() ? enText : pt;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var ICON = {
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    chevron: '<path d="M9 18l6-6-6-6"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
    home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  };

  function svg(name, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : "") + ' viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || "") + "</svg>";
  }

  function tours() {
    return window.MateTour && typeof window.MateTour.list === "function" ? window.MateTour.list() : [];
  }

  /* ---------- Shell ---------- */

  function shellHtml() {
    var u = ui();
    return (
      '<div class="hc" id="' + PANEL_ID + '" role="dialog" aria-modal="true" aria-labelledby="crmHelpPanelTitle" hidden>' +
      '<header class="hc__head">' +
      '<span class="hc__face" aria-hidden="true"><img src="' + FACE + '" alt="" width="44" height="44"></span>' +
      '<div class="hc__intro"><h2 id="crmHelpPanelTitle" class="hc__title"></h2><p class="hc__lead"></p></div>' +
      '<button type="button" class="hc__close" data-crm-help-close aria-label="' + esc(u.close) + '">' + svg("close") + "</button>" +
      "</header>" +
      '<form class="hc__ask" id="crmHelpAsk" role="search" autocomplete="off">' +
      svg("spark", "hc__ask-icon") +
      '<input type="search" class="hc__ask-input" id="crmHelpSearch" enterkeyhint="search" maxlength="400" />' +
      '<button type="submit" class="hc__ask-btn" id="crmHelpAskBtn"></button>' +
      "</form>" +
      '<div class="hc__main">' +
      '<nav class="hc__nav" role="tablist" aria-label="Ajuda">' +
      tabBtn("home", "home") +
      tabBtn("tutorials", "play") +
      tabBtn("solve", "wrench") +
      tabBtn("support", "chat") +
      "</nav>" +
      '<div class="hc__body" id="crmHelpBody" tabindex="-1"></div>' +
      "</div>" +
      "</div>"
    );
  }

  function tabLabel(id) {
    var u = ui();
    if (id === "home") return u.tabHome;
    if (id === "tutorials") return T("Tutoriais com o Mate", "Tutorials with Mate");
    if (id === "solve") return T("Resolver um problema", "Fix a problem");
    return T("Falar com o suporte", "Contact support");
  }

  function tabBtn(id, icon) {
    return (
      '<button type="button" role="tab" class="hc__tab" data-crm-help-tab="' + id + '" aria-selected="false">' +
      svg(icon) + '<span data-tab-label="' + id + '"></span></button>'
    );
  }

  function ensure() {
    var backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "hc-backdrop";
      backdrop.hidden = true;
      backdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(backdrop);
    }
    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      document.body.insertAdjacentHTML("beforeend", shellHtml());
      panel = document.getElementById(PANEL_ID);
    }
    return { backdrop: backdrop, panel: panel };
  }

  function refreshChrome() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel || !C()) return;
    var u = ui();
    panel.querySelector("#crmHelpPanelTitle").textContent = T("Como posso ajudar?", "How can I help?");
    panel.querySelector(".hc__lead").textContent = T(
      "Pergunte do seu jeito, aprenda um módulo com o Mate ou fale com a gente.",
      "Ask in your own words, learn a module with Mate, or talk to us.",
    );
    var input = panel.querySelector("#crmHelpSearch");
    input.placeholder = T("Pergunte qualquer coisa. Ex.: como cobro um job que terminou?", "Ask anything. e.g. how do I bill a finished job?");
    input.setAttribute("aria-label", T("Pergunte ao Mate", "Ask Mate"));
    input.value = state.query;
    panel.querySelector("#crmHelpAskBtn").textContent = T("Perguntar", "Ask");
    panel.querySelector("[data-crm-help-close]").setAttribute("aria-label", u.close);
    panel.querySelectorAll("[data-tab-label]").forEach(function (el) {
      el.textContent = tabLabel(el.getAttribute("data-tab-label"));
    });
  }

  function syncTabs() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    var active = state.query.trim() ? "" : state.tab;
    panel.querySelectorAll("[data-crm-help-tab]").forEach(function (btn) {
      var on = btn.getAttribute("data-crm-help-tab") === active;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  /* ---------- Local search (instant, while typing) ---------- */

  var STOP = /^(o|a|os|as|um|uma|de|do|da|dos|das|e|em|no|na|nos|nas|para|pra|por|com|como|que|qual|onde|quando|eu|meu|minha|se|ao|the|to|of|in|on|for|how|do|i|my|is|it|and|an|what|where|can)$/;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ");
  }

  // Words people use → words the help content uses (both languages).
  var SYN = {
    cobr: ["fatur", "invoi", "cobr", "pagam"],
    fatur: ["fatur", "invoi", "cobr"],
    receb: ["pagam", "receb", "fatur"],
    pagar: ["pagam", "folha", "payro"],
    obra: ["job", "obra"],
    job: ["job", "obra"],
    orcam: ["orcam", "quote", "propo"],
    propo: ["orcam", "quote", "propo"],
    quote: ["orcam", "quote"],
    clien: ["clien", "lead"],
    visit: ["visit", "agend", "agend"],
    marca: ["agend", "visit"],
    agend: ["agend", "visit", "calen"],
    foto: ["foto", "photo", "obrac"],
    equip: ["equip", "team", "usuar", "convi"],
    funci: ["equip", "folha", "funci"],
    hora: ["horas", "folha", "hour"],
    preco: ["preco", "tabel", "valor", "price"],
    gasto: ["custo", "fluxo", "finan"],
    custo: ["custo", "fluxo", "finan"],
    recib: ["recib", "fluxo", "custo"],
    logo: ["marca", "logo", "brand"],
    erro: ["bug", "erro", "suporte"],
  };

  function stem(w) {
    return w.length > 5 ? w.slice(0, 5) : w; // "cobrar"/"cobro"/"cobrança" → "cobr…"
  }

  function terms(q) {
    var out = [];
    norm(q)
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 1 && !STOP.test(w);
      })
      .forEach(function (w) {
        var st = stem(w);
        var key = Object.keys(SYN).filter(function (k) {
          return st.indexOf(k) === 0 || k.indexOf(st) === 0;
        })[0];
        out.push(key ? SYN[key] : [st]);
      });
    return out; // one group per word: any of its variants counts
  }

  function score(hay, groups) {
    var words = norm(hay).split(/\s+/);
    var s = 0;
    groups.forEach(function (g) {
      var best = 0;
      g.forEach(function (t) {
        for (var i = 0; i < words.length; i++) {
          if (words[i].indexOf(t) === 0) best = Math.max(best, 2);
          else if (t.length > 3 && words[i].indexOf(t) > 0) best = Math.max(best, 1);
        }
      });
      s += best;
    });
    return s;
  }

  function localSearch(q) {
    var c = C();
    var ts = terms(q);
    if (!ts.length) return { tours: [], problems: [], tutorials: [], modules: [] };
    function rank(list, blob) {
      return list
        .map(function (x) {
          return { x: x, s: score(blob(x), ts) };
        })
        .filter(function (r) {
          return r.s > 0;
        })
        .sort(function (a, b) {
          return b.s - a.s;
        })
        .map(function (r) {
          return r.x;
        });
    }
    return {
      tours: rank(tours(), function (t) {
        return t.title + " " + t.blurb + " " + t.id;
      }).slice(0, 4),
      problems: rank(c.PROBLEMS, function (p) {
        return pick(p.title) + " " + (p.tags || []).join(" ");
      }).slice(0, 5),
      tutorials: rank(c.TUTORIALS, function (t) {
        return pick(t.title) + " " + pick(t.summary);
      }).slice(0, 3),
      modules: rank(c.MODULES, function (m) {
        return pick(m.title) + " " + pick(m.blurb) + " " + m.id;
      }).slice(0, 4),
    };
  }

  /* ---------- AI answer ---------- */

  function catalog() {
    var c = C();
    var out = [];
    tours().forEach(function (t) {
      out.push({ kind: "tour", id: t.id, title: T("Tutorial com o Mate: ", "Tour with Mate: ") + t.title, hint: t.blurb });
    });
    c.PROBLEMS.forEach(function (p) {
      out.push({ kind: "problem", id: p.id, title: pick(p.title), hint: (p.tags || []).join(", ").slice(0, 280) });
    });
    c.TUTORIALS.forEach(function (t) {
      out.push({ kind: "tutorial", id: t.id, title: pick(t.title), hint: pick(t.summary).slice(0, 280) });
    });
    c.MODULES.forEach(function (m) {
      out.push({ kind: "module", id: m.id, title: pick(m.title), hint: pick(m.blurb).slice(0, 280) });
    });
    return out;
  }

  var askSeq = 0;

  function ask(q) {
    q = String(q || "").trim();
    if (q.length < 2) return;
    var seq = ++askSeq;
    state.ai = { q: q, status: "loading" };
    render();
    fetch("/api/help/ask", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: q, page: C().currentPageFile() || location.pathname, locale: loc(), catalog: catalog() }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j || {} };
        });
      })
      .then(function (res) {
        if (seq !== askSeq) return;
        if (res.ok && res.j.success) state.ai = { q: q, status: "ok", data: res.j.data };
        else state.ai = { q: q, status: "error", code: res.j.code || "" };
        render();
      })
      .catch(function () {
        if (seq !== askSeq) return;
        state.ai = { q: q, status: "error", code: "network" };
        render();
      });
  }

  function matchButton(m) {
    var c = C();
    if (m.kind === "tour") {
      var t = window.MateTour && window.MateTour.byId(m.id);
      if (!t) return "";
      return (
        '<button type="button" class="hc-match hc-match--tour" data-crm-help-tour="' + esc(t.id) + '">' +
        '<span class="hc-match__icon">' + svg("play") + "</span>" +
        '<span class="hc-match__text"><strong>' + esc(T("Aprender ", "Learn ") + t.title + T(" com o Mate", " with Mate")) + "</strong>" +
        "<span>" + esc(t.steps + T(" passos · ", " steps · ") + t.minutes + " min") + "</span></span>" +
        svg("chevron", "hc-match__chev") + "</button>"
      );
    }
    if (m.kind === "problem") {
      var p = c.problemById(m.id);
      if (!p) return "";
      return (
        '<button type="button" class="hc-match" data-crm-help-problem="' + esc(p.id) + '">' +
        '<span class="hc-match__icon">' + svg("wrench") + "</span>" +
        '<span class="hc-match__text"><strong>' + esc(pick(p.title)) + "</strong><span>" + esc(T("Passo a passo", "Step by step")) + "</span></span>" +
        svg("chevron", "hc-match__chev") + "</button>"
      );
    }
    if (m.kind === "tutorial") {
      var tu = c.tutorialById(m.id);
      if (!tu) return "";
      return (
        '<button type="button" class="hc-match" data-crm-help-tutorial="' + esc(tu.id) + '">' +
        '<span class="hc-match__icon">' + svg("doc") + "</span>" +
        '<span class="hc-match__text"><strong>' + esc(pick(tu.title)) + "</strong><span>" + esc(pick(tu.duration)) + "</span></span>" +
        svg("chevron", "hc-match__chev") + "</button>"
      );
    }
    var mod = c.moduleById(m.id);
    if (!mod) return "";
    return (
      '<a class="hc-match" href="' + esc(mod.href) + '" data-crm-help-nav>' +
      '<span class="hc-match__icon">' + svg("arrow") + "</span>" +
      '<span class="hc-match__text"><strong>' + esc(T("Abrir ", "Open ") + pick(mod.title)) + "</strong><span>" + esc(pick(mod.blurb)) + "</span></span>" +
      svg("chevron", "hc-match__chev") + "</a>"
    );
  }

  function renderAi() {
    var a = state.ai;
    var q = state.query.trim();
    if (!a || a.q !== q) {
      return (
        '<button type="button" class="hc-ai hc-ai--cta" data-crm-help-ask>' +
        '<span class="hc-ai__face" aria-hidden="true"><img src="' + FACE + '" alt="" width="32" height="32"></span>' +
        '<span class="hc-ai__cta-text"><strong>' + esc(T("Perguntar ao Mate", "Ask Mate")) + "</strong>" +
        "<span>“" + esc(q) + "”</span></span>" +
        '<kbd class="hc-ai__kbd">Enter</kbd></button>'
      );
    }
    if (a.status === "loading") {
      return (
        '<div class="hc-ai hc-ai--loading" role="status">' +
        '<span class="hc-ai__face is-thinking" aria-hidden="true"><img src="' + FACE + '" alt="" width="32" height="32"></span>' +
        '<span class="hc-ai__dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
        "<span>" + esc(T("O Mate está pensando…", "Mate is thinking…")) + "</span></div>"
      );
    }
    if (a.status === "error") {
      var msg =
        a.code === "ai_off"
          ? T("A busca com IA não está ligada nesta conta. Veja os resultados abaixo.", "AI search isn't on for this account. See the results below.")
          : a.code === "slow_down"
            ? T("Muitas perguntas seguidas. Tente de novo em um minuto.", "Too many questions in a row. Try again in a minute.")
            : T("Não consegui responder agora. Veja os resultados abaixo ou tente de novo.", "I couldn't answer right now. See the results below or try again.");
      return '<div class="hc-ai hc-ai--error"><span class="hc-ai__face" aria-hidden="true"><img src="' + FACE + '" alt="" width="32" height="32"></span><p>' + esc(msg) + "</p></div>";
    }
    var d = a.data || {};
    var html = '<article class="hc-ai hc-ai--answer" aria-live="polite">';
    html += '<header class="hc-ai__head"><span class="hc-ai__face" aria-hidden="true"><img src="' + FACE + '" alt="" width="32" height="32"></span><strong>' + esc(T("Mate", "Mate")) + "</strong><span class=\"hc-ai__tag\">IA</span></header>";
    if (d.answer) html += '<p class="hc-ai__answer">' + esc(d.answer) + "</p>";
    if (d.steps && d.steps.length) {
      html += '<ol class="hc-steps">';
      d.steps.forEach(function (s) {
        html += "<li>" + esc(s) + "</li>";
      });
      html += "</ol>";
    }
    var btns = (d.matches || []).map(matchButton).join("");
    if (btns) html += '<div class="hc-ai__matches">' + btns + "</div>";
    html +=
      '<footer class="hc-ai__foot">' + esc(T("Não resolveu?", "Didn't help?")) +
      ' <button type="button" class="hc-link" data-crm-help-tab="support">' + esc(T("Fale com o suporte", "Contact support")) + "</button></footer>";
    html += "</article>";
    return html;
  }

  function renderSearch() {
    var q = state.query.trim();
    var res = localSearch(q);
    var html = renderAi();
    var any = res.tours.length || res.problems.length || res.tutorials.length || res.modules.length;
    if (!any) {
      if (!state.ai || state.ai.q !== q) {
        html += '<p class="hc-muted">' + esc(T("Sem resultados rápidos. Pergunte ao Mate — ele entende do seu jeito.", "No quick results. Ask Mate — he understands your words.")) + "</p>";
      }
      return html;
    }
    html += '<p class="hc-label">' + esc(T("Resultados rápidos", "Quick results")) + "</p>";
    html += '<div class="hc-list">';
    res.tours.forEach(function (t) {
      html += matchButton({ kind: "tour", id: t.id });
    });
    res.problems.forEach(function (p) {
      html += matchButton({ kind: "problem", id: p.id });
    });
    res.tutorials.forEach(function (t) {
      html += matchButton({ kind: "tutorial", id: t.id });
    });
    res.modules.forEach(function (m) {
      html += matchButton({ kind: "module", id: m.id });
    });
    html += "</div>";
    return html;
  }

  /* ---------- Views ---------- */

  function tourCard(t, big) {
    return (
      '<button type="button" class="hc-tour' + (big ? " hc-tour--big" : "") + (t.done ? " is-done" : "") + '" data-crm-help-tour="' + esc(t.id) + '">' +
      '<span class="hc-tour__top"><span class="hc-tour__title">' + esc(t.title) + "</span>" +
      (t.done ? '<span class="hc-tour__done">' + svg("check") + esc(T("Feito", "Done")) + "</span>" : "") +
      "</span>" +
      '<span class="hc-tour__blurb">' + esc(t.blurb) + "</span>" +
      '<span class="hc-tour__meta">' + svg("play") + esc(t.steps + T(" passos · ", " steps · ") + t.minutes + " min") + "</span>" +
      "</button>"
    );
  }

  function renderHome() {
    var c = C();
    var html = "";
    var here = window.MateTour && window.MateTour.forPage();
    var hereTour = here && window.MateTour.byId(here);
    var ctx = c.contextualItems();

    if (hereTour) {
      html +=
        '<section class="hc-hero">' +
        '<img class="hc-hero__mate" src="/assets/img/mascot/mate-wave.webp?v=20261027-m2" alt="" width="96" height="96" loading="lazy">' +
        '<div class="hc-hero__text"><p class="hc-hero__kicker">' + esc(T("Nesta tela", "On this screen")) + "</p>" +
        "<h3>" + esc(T("Aprenda ", "Learn ") + hereTour.title + T(" comigo", " with me")) + "</h3>" +
        "<p>" + esc(hereTour.blurb + " " + hereTour.steps + T(" passos, ", " steps, ") + hereTour.minutes + " min.") + "</p>" +
        '<button type="button" class="hc-btn" data-crm-help-tour="' + esc(hereTour.id) + '">' + svg("play") + esc(T("Começar tutorial", "Start tutorial")) + "</button>" +
        "</div></section>";
    }

    if (ctx.problems.length) {
      html += '<p class="hc-label">' + esc(T("Dúvidas comuns aqui", "Common questions here")) + "</p><div class=\"hc-chips\">";
      ctx.problems.forEach(function (p) {
        html += '<button type="button" class="hc-chip" data-crm-help-problem="' + esc(p.id) + '">' + esc(pick(p.title)) + "</button>";
      });
      html += "</div>";
    }

    html += renderChecklist();

    var list = tours().filter(function (t) {
      return t.id !== here;
    });
    if (list.length) {
      html +=
        '<div class="hc-label-row"><p class="hc-label">' + esc(T("Tutoriais com o Mate", "Tutorials with Mate")) + "</p>" +
        '<button type="button" class="hc-link" data-crm-help-tab="tutorials">' + esc(T("Ver todos", "See all")) + "</button></div>";
      html += '<div class="hc-tours">' + list.slice(0, 6).map(function (t) {
        return tourCard(t);
      }).join("") + "</div>";
    }
    return html;
  }

  function renderChecklist() {
    var c = C();
    var u = ui();
    var map = c.loadChecklistState();
    var items = c.CHECKLIST || [];
    var done = items.filter(function (it) {
      return map[it.id];
    }).length;
    if (done >= items.length) return "";
    var html =
      '<section class="hc-check">' +
      '<div class="hc-check__head"><strong>' + esc(u.checklistTitle) + "</strong><span>" + done + " " + esc(u.checklistProgress) + " " + items.length + "</span></div>" +
      '<div class="hc-check__bar" aria-hidden="true"><i style="width:' + Math.round((done / items.length) * 100) + '%"></i></div>' +
      '<ul class="hc-check__list">';
    items.forEach(function (it) {
      var on = !!map[it.id];
      html +=
        '<li class="' + (on ? "is-done" : "") + '">' +
        '<button type="button" class="hc-check__box" data-crm-help-check="' + esc(it.id) + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(on ? u.markUndo : u.markDone) + '">' + (on ? svg("check") : "") + "</button>" +
        '<a href="' + esc(it.href) + '" data-crm-help-nav>' + esc(pick(it.label)) + "</a></li>";
    });
    return html + "</ul></section>";
  }

  function renderTutorials() {
    var c = C();
    var list = tours();
    var done = list.filter(function (t) {
      return t.done;
    }).length;
    var html =
      '<div class="hc-intro-row"><img src="' + FACE + '" alt="" width="36" height="36" aria-hidden="true">' +
      "<p>" + esc(T("Escolha um módulo e eu te mostro na tela, passo a passo. ", "Pick a module and I'll show you on screen, step by step. ")) +
      "<strong>" + done + "/" + list.length + "</strong> " + esc(T("feitos", "done")) + "</p></div>";
    html += '<div class="hc-tours hc-tours--all">' + list.map(function (t) {
      return tourCard(t);
    }).join("") + "</div>";
    html += '<p class="hc-label">' + esc(T("Guias de fluxo completo", "Full workflow guides")) + '</p><div class="hc-list">';
    c.TUTORIALS.forEach(function (t) {
      html += matchButton({ kind: "tutorial", id: t.id });
    });
    return html + "</div>";
  }

  function renderSolve() {
    var c = C();
    var html = '<p class="hc-muted">' + esc(ui().solveHint) + '</p><div class="hc-list">';
    c.PROBLEMS.forEach(function (p) {
      html += matchButton({ kind: "problem", id: p.id });
    });
    return html + "</div>";
  }

  function backBtn() {
    return '<button type="button" class="hc-back" data-crm-help-back>' + svg("back") + esc(ui().back) + "</button>";
  }

  function renderProblemDetail(p) {
    var c = C();
    var u = ui();
    var mod = c.moduleById(p.moduleId);
    var href = p.href || (mod && mod.href) || "#";
    var steps = (p.steps && (p.steps[loc()] || p.steps.pt)) || [];
    var tour = mod && window.MateTour && window.MateTour.byId(mod.id);
    var html = backBtn() + '<h3 class="hc-detail__title">' + esc(pick(p.title)) + "</h3>";
    if (mod) html += '<p class="hc-muted">' + esc(pick(mod.title)) + "</p>";
    html += '<ol class="hc-steps hc-steps--big">';
    steps.forEach(function (s) {
      html += "<li>" + esc(s) + "</li>";
    });
    html += '</ol><div class="hc-actions">';
    if (p.helpTab === "support") {
      html += '<button type="button" class="hc-btn" data-crm-help-tab="support">' + esc(tabLabel("support")) + "</button>";
    } else {
      if (tour) html += '<button type="button" class="hc-btn" data-crm-help-tour="' + esc(tour.id) + '">' + svg("play") + esc(T("Me mostre na tela", "Show me on screen")) + "</button>";
      html += '<a class="hc-btn hc-btn--ghost" href="' + esc(href) + '" data-crm-help-nav>' + esc(u.goModule) + "</a>";
    }
    html += "</div>";
    if (p.extraLinks && p.extraLinks.length) {
      html += '<p class="hc-label">' + esc(u.related) + '</p><div class="hc-chips">';
      p.extraLinks.forEach(function (l) {
        html += l.helpTab
          ? '<button type="button" class="hc-chip" data-crm-help-tab="' + esc(l.helpTab) + '">' + esc(pick(l.label)) + "</button>"
          : '<a class="hc-chip" href="' + esc(l.href) + '" data-crm-help-nav>' + esc(pick(l.label)) + "</a>";
      });
      html += "</div>";
    }
    return html;
  }

  function renderTutorialDetail(t) {
    var steps = (t.steps && (t.steps[loc()] || t.steps.pt)) || [];
    var html = backBtn() + '<p class="hc-muted">' + esc(pick(t.duration)) + "</p>";
    html += '<h3 class="hc-detail__title">' + esc(pick(t.title)) + "</h3>";
    html += '<p class="hc-detail__sum">' + esc(pick(t.summary)) + '</p><ol class="hc-steps hc-steps--big hc-steps--links">';
    steps.forEach(function (s) {
      var text = typeof s === "string" ? s : s.text;
      var href = typeof s === "string" ? null : s.href;
      html += href ? '<li><a href="' + esc(href) + '" data-crm-help-nav>' + esc(text) + svg("arrow") + "</a></li>" : "<li>" + esc(text) + "</li>";
    });
    return html + "</ol>";
  }

  function renderSupport() {
    var u = ui();
    var page = C().currentPageFile() || location.pathname;
    var flash =
      state.supportStatus === "ok"
        ? '<p class="hc-flash is-ok">' + esc(u.supportOk) + "</p>"
        : state.supportStatus === "err"
          ? '<p class="hc-flash is-err">' + esc(u.supportErr) + "</p>"
          : "";
    return (
      '<div class="hc-support">' +
      '<form class="hc-form" id="crmHelpSupportForm" autocomplete="off">' +
      '<p class="hc-muted">' + esc(u.supportHint) + "</p>" + flash +
      '<div class="hc-seg" role="radiogroup" aria-label="' + esc(u.supportCat) + '">' +
      ["question", "bug", "suggestion", "other"].map(function (v, i) {
        var lbl = { question: u.catQuestion, bug: u.catBug, suggestion: u.catSuggestion, other: u.catOther }[v];
        return '<label class="hc-seg__opt"><input type="radio" name="category" value="' + v + '"' + (i === 0 ? " checked" : "") + "><span>" + esc(lbl) + "</span></label>";
      }).join("") +
      "</div>" +
      '<label class="hc-field"><span>' + esc(u.supportSubject) + '</span><input name="subject" id="crmHelpSubject" required minlength="3" maxlength="160" /></label>' +
      '<label class="hc-field"><span>' + esc(u.supportMessage) + '</span><textarea name="body" id="crmHelpBodyMsg" rows="4" required minlength="10" maxlength="7800"></textarea></label>' +
      '<p class="hc-ctx">' + esc(T("Vamos junto: ", "Included: ") + page) + "</p>" +
      '<div class="hc-actions">' +
      '<button type="submit" class="hc-btn" id="crmHelpSendBtn">' + svg("send") + esc(u.supportTicket) + "</button>" +
      '<a class="hc-btn hc-btn--ghost" href="mailto:support@obramate.com">' + esc(u.supportEmail) + "</a>" +
      "</div></form>" +
      '<section class="hc-history"><p class="hc-label">' + esc(u.supportHistory) + '</p><div id="crmHelpTicketList" class="hc-tickets"><p class="hc-muted">' + esc(u.supportEmptyHist) + "</p></div></section>" +
      "</div>"
    );
  }

  function loadSupportHistory() {
    var list = document.getElementById("crmHelpTicketList");
    if (!list) return;
    var u = ui();
    fetch("/api/support/tickets", { credentials: "include", cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var rows = (j && j.data) || [];
        if (!rows.length) return;
        var cats = { question: u.catQuestion, suggestion: u.catSuggestion, bug: u.catBug, other: u.catOther };
        list.innerHTML = rows
          .slice(0, 8)
          .map(function (t) {
            var when = t.created_at
              ? new Date(t.created_at).toLocaleDateString(en() ? "en-US" : "pt-BR", { day: "2-digit", month: "short" })
              : "";
            var st = t.status === "closed" ? T("Resolvido", "Resolved") : t.status === "waiting" ? T("Respondido", "Replied") : T("Aberto", "Open");
            var tone = t.status === "closed" ? "ok" : t.status === "waiting" ? "info" : "open";
            return (
              '<article class="hc-ticket">' +
              '<div class="hc-ticket__meta"><span class="hc-pill hc-pill--' + tone + '">' + esc(st) + "</span><span>" + esc(cats[t.category] || "") + "</span><span>" + esc(when) + "</span></div>" +
              "<strong>" + esc(t.subject) + "</strong></article>"
            );
          })
          .join("");
      })
      .catch(function () {});
  }

  function submitSupport(e) {
    e.preventDefault();
    var u = ui();
    var form = e.target;
    var subjectEl = document.getElementById("crmHelpSubject");
    var bodyEl = document.getElementById("crmHelpBodyMsg");
    var btn = document.getElementById("crmHelpSendBtn");
    var subject = subjectEl.value.trim();
    var body = bodyEl.value.trim();
    if (subject.length < 3 || body.length < 10) {
      (subject.length < 3 ? subjectEl : bodyEl).focus();
      return;
    }
    var cat = (form.querySelector('input[name="category"]:checked') || {}).value || "question";
    var page = C().currentPageFile() || location.pathname;
    btn.disabled = true;
    btn.textContent = u.supportSending;
    fetch("/api/support/tickets", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: cat, subject: subject, body: body + "\n\n---\nPágina: " + page + "\nURL: " + location.href }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("fail");
        state.supportStatus = "ok";
        render();
      })
      .catch(function () {
        state.supportStatus = "err";
        render();
      });
  }

  function render() {
    var body = document.getElementById("crmHelpBody");
    var c = C();
    if (!body || !c) return;
    syncTabs();
    var html;
    if (state.view === "detail" && state.detail) {
      var item = state.detail.kind === "problem" ? c.problemById(state.detail.id) : c.tutorialById(state.detail.id);
      html = item ? (state.detail.kind === "problem" ? renderProblemDetail(item) : renderTutorialDetail(item)) : "";
    }
    if (!html) {
      if (state.query.trim()) html = renderSearch();
      else if (state.tab === "tutorials") html = renderTutorials();
      else if (state.tab === "solve") html = renderSolve();
      else if (state.tab === "support") html = renderSupport();
      else html = renderHome();
    }
    body.innerHTML = html;
    if (state.tab === "support" && !state.query.trim() && state.view !== "detail") {
      var form = document.getElementById("crmHelpSupportForm");
      if (form) form.addEventListener("submit", submitSupport);
      loadSupportHistory();
    }
  }

  /* ---------- Open / close ---------- */

  function open(opts) {
    opts = opts || {};
    var els = ensure();
    lastFocus = document.activeElement;
    state.tab = opts.tab || "home";
    state.view = "list";
    state.detail = null;
    state.supportStatus = "";
    if (opts.query != null) state.query = String(opts.query);
    else state.query = "";
    if (opts.problem) {
      state.tab = "solve";
      state.view = "detail";
      state.detail = { kind: "problem", id: opts.problem };
    } else if (opts.tutorial) {
      state.tab = "tutorials";
      state.view = "detail";
      state.detail = { kind: "tutorial", id: opts.tutorial };
    }
    refreshChrome();
    render();
    els.backdrop.hidden = false;
    els.panel.hidden = false;
    document.body.classList.add("crm-help-open");
    requestAnimationFrame(function () {
      els.panel.classList.add("is-open");
      els.backdrop.classList.add("is-open");
      var input = document.getElementById("crmHelpSearch");
      if (input && window.matchMedia("(min-width: 900px)").matches) {
        try {
          input.focus({ preventScroll: true });
        } catch (_) {}
      }
    });
    var btn = document.getElementById("crmTopbarHelpBtn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function close() {
    var panel = document.getElementById(PANEL_ID);
    var backdrop = document.getElementById(BACKDROP_ID);
    if (!panel || panel.hidden) return;
    document.body.classList.remove("crm-help-open");
    panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    var btn = document.getElementById("crmTopbarHelpBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    window.setTimeout(function () {
      if (panel.classList.contains("is-open")) return;
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 200);
    if (lastFocus && typeof lastFocus.focus === "function" && lastFocus.isConnected) {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (_) {}
    }
  }

  function isOpen() {
    return document.body.classList.contains("crm-help-open");
  }

  /** Keep Tab inside the dialog. */
  function trapFocus(e) {
    var panel = document.getElementById(PANEL_ID);
    if (!panel || !isOpen()) return;
    var f = panel.querySelectorAll('button:not([disabled]), a[href], input:not([type="hidden"]), textarea, select, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function bindHelpButton(btn) {
    if (!btn || btn.dataset.crmHelpBound) return;
    btn.dataset.crmHelpBound = "1";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-controls", PANEL_ID);
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (isOpen()) close();
      else open();
    });
  }

  function ensureTourScript() {
    if (window.MateTour || document.querySelector('script[src*="crm-mate-tour.js"]')) return;
    var s = document.createElement("script");
    s.src = "crm-mate-tour.js?v=20261105-help1";
    s.onload = function () {
      if (isOpen()) render();
    };
    document.body.appendChild(s);
    if (!document.querySelector('link[href*="crm-mate-tour.css"]')) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = "crm-mate-tour.css?v=20261105-help1";
      document.head.appendChild(l);
    }
  }

  function refresh() {
    ensure();
    ensureTourScript();
    bindHelpButton(document.getElementById("crmTopbarHelpBtn"));
    refreshChrome();
    if (isOpen()) render();
  }

  function init() {
    refresh();

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t.closest) return;
      if (t.closest("[data-crm-help-close]") || t.closest("#" + BACKDROP_ID)) {
        close();
        return;
      }
      if (!t.closest("#" + PANEL_ID)) return;
      var tour = t.closest("[data-crm-help-tour]");
      if (tour) {
        var id = tour.getAttribute("data-crm-help-tour");
        close();
        if (window.MateTour) window.MateTour.start(id);
        return;
      }
      if (t.closest("[data-crm-help-ask]")) {
        ask(state.query);
        return;
      }
      var tab = t.closest("[data-crm-help-tab]");
      if (tab) {
        state.tab = tab.getAttribute("data-crm-help-tab");
        state.view = "list";
        state.detail = null;
        state.supportStatus = "";
        state.query = "";
        var input = document.getElementById("crmHelpSearch");
        if (input) input.value = "";
        render();
        var body = document.getElementById("crmHelpBody");
        if (body) body.scrollTop = 0;
        return;
      }
      if (t.closest("[data-crm-help-back]")) {
        state.view = "list";
        state.detail = null;
        render();
        return;
      }
      var check = t.closest("[data-crm-help-check]");
      if (check) {
        C().toggleChecklistItem(check.getAttribute("data-crm-help-check"));
        render();
        return;
      }
      var prob = t.closest("[data-crm-help-problem]");
      if (prob) {
        state.view = "detail";
        state.detail = { kind: "problem", id: prob.getAttribute("data-crm-help-problem") };
        render();
        return;
      }
      var tut = t.closest("[data-crm-help-tutorial]");
      if (tut) {
        state.view = "detail";
        state.detail = { kind: "tutorial", id: tut.getAttribute("data-crm-help-tutorial") };
        render();
        return;
      }
      if (t.closest("[data-crm-help-nav]")) window.setTimeout(close, 80);
    });

    document.addEventListener("input", function (e) {
      if (e.target && e.target.id === "crmHelpSearch") {
        state.query = e.target.value || "";
        state.view = "list";
        state.detail = null;
        render();
      }
    });

    document.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "crmHelpAsk") {
        e.preventDefault();
        ask(state.query);
      }
    });

    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") {
        if (state.query) {
          state.query = "";
          var input = document.getElementById("crmHelpSearch");
          if (input) input.value = "";
          render();
        } else close();
      } else if (e.key === "Tab") trapFocus(e);
    });

    document.addEventListener("crm:localechange", function () {
      refreshChrome();
      if (isOpen()) render();
    });

    // Deep links: #help, #help-support, #help-tutorials, #help-solve
    try {
      var hash = (location.hash || "").replace(/^#/, "");
      if (hash === "help" || hash === "help-home") open({ tab: "home" });
      else if (hash === "help-support" || hash === "suporte") open({ tab: "support" });
      else if (hash === "help-tutorials") open({ tab: "tutorials" });
      else if (hash === "help-solve") open({ tab: "solve" });
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.__crmHelpPanel = {
    open: open,
    close: close,
    isOpen: isOpen,
    refresh: refresh,
    ask: function (q) {
      open({ query: q });
      ask(q);
    },
    showTutorial: function (id) {
      open({ tutorial: id });
    },
    showProblem: function (id) {
      open({ problem: id });
    },
  };
})();
