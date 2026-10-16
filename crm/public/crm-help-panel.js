/**
 * Help Center slide-over: search, problem solver, tutorials, modules, support.
 */
(function () {
  var PANEL_ID = "crmHelpPanel";
  var BACKDROP_ID = "crmHelpBackdrop";
  var state = { tab: "solve", view: "list", detail: null, query: "" };

  function C() {
    return window.CrmHelpContent || null;
  }

  function ui() {
    var c = C();
    if (!c) return {};
    var loc = c.locale();
    return c.UI[loc] || c.UI.pt;
  }

  function loc() {
    var c = C();
    return c ? c.locale() : "pt";
  }

  function pick(obj) {
    var c = C();
    return c ? c.pick(obj, loc()) : "";
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function chevron() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  }

  function shellHtml() {
    var u = ui();
    return (
      '<aside class="crm-help-panel" id="' +
      PANEL_ID +
      '" role="dialog" aria-modal="true" aria-labelledby="crmHelpPanelTitle" hidden>' +
      '<div class="crm-help-panel__header">' +
      '<div class="crm-help-panel__intro">' +
      '<h2 id="crmHelpPanelTitle">' +
      esc(u.title) +
      "</h2>" +
      '<p class="crm-help-panel__lead">' +
      esc(u.lead) +
      "</p>" +
      "</div>" +
      '<button type="button" class="crm-help-panel__close" data-crm-help-close aria-label="' +
      esc(u.close) +
      '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      "</button>" +
      "</div>" +
      '<div class="crm-help-panel__search-wrap">' +
      '<input type="search" class="crm-help-panel__search" id="crmHelpSearch" placeholder="' +
      esc(u.searchPh) +
      '" autocomplete="off" />' +
      "</div>" +
      '<nav class="crm-help-panel__tabs" role="tablist" aria-label="' +
      esc(u.title) +
      '">' +
      tabBtn("solve", u.tabSolve) +
      tabBtn("tutorials", u.tabTutorials) +
      tabBtn("modules", u.tabModules) +
      tabBtn("support", u.tabSupport) +
      "</nav>" +
      '<div class="crm-help-panel__body" id="crmHelpBody"></div>' +
      "</aside>"
    );
  }

  function tabBtn(id, label) {
    var active = state.tab === id ? " is-active" : "";
    return (
      '<button type="button" role="tab" class="crm-help-panel__tab' +
      active +
      '" data-crm-help-tab="' +
      id +
      '" aria-selected="' +
      (state.tab === id ? "true" : "false") +
      '">' +
      esc(label) +
      "</button>"
    );
  }

  function ensure() {
    var backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.className = "crm-help-backdrop";
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

  function syncTabs() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.querySelectorAll("[data-crm-help-tab]").forEach(function (btn) {
      var on = btn.getAttribute("data-crm-help-tab") === state.tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function setTab(tab) {
    state.tab = tab;
    state.view = "list";
    state.detail = null;
    syncTabs();
    render();
  }

  function openDetail(kind, id) {
    state.view = "detail";
    state.detail = { kind: kind, id: id };
    render();
  }

  function backToList() {
    state.view = "list";
    state.detail = null;
    render();
  }

  function moduleHref(mod, fallback) {
    if (fallback) return fallback;
    return mod ? mod.href : "#";
  }

  function renderProblemDetail(p) {
    var c = C();
    var u = ui();
    var mod = c.moduleById(p.moduleId);
    var href = p.href || moduleHref(mod);
    var steps = (p.steps && (p.steps[loc()] || p.steps.pt)) || [];
    var html =
      '<button type="button" class="crm-help-panel__back" data-crm-help-back>' +
      esc(u.back) +
      "</button>" +
      '<h3 class="crm-help-panel__detail-title">' +
      esc(pick(p.title)) +
      "</h3>" +
      (mod
        ? '<p class="crm-help-panel__meta">' + esc(pick(mod.title)) + "</p>"
        : "") +
      '<p class="crm-help-panel__section-label">' +
      esc(u.stepsLabel) +
      "</p>" +
      '<ol class="crm-help-panel__steps">';
    steps.forEach(function (s) {
      html += "<li>" + esc(s) + "</li>";
    });
    html += "</ol>";
    html +=
      '<a class="crm-help-panel__btn crm-help-panel__btn--block" href="' +
      esc(href) +
      '" data-crm-help-nav>' +
      esc(u.goModule) +
      "</a>";
    if (p.extraLinks && p.extraLinks.length) {
      html += '<p class="crm-help-panel__section-label">' + esc(u.related) + "</p>";
      html += '<div class="crm-help-panel__cards">';
      p.extraLinks.forEach(function (l) {
        html +=
          '<a class="crm-help-panel__card crm-help-panel__card--compact" href="' +
          esc(l.href) +
          '" data-crm-help-nav><strong>' +
          esc(pick(l.label)) +
          "</strong></a>";
      });
      html += "</div>";
    }
    return html;
  }

  function renderTutorialDetail(t) {
    var u = ui();
    var steps = (t.steps && (t.steps[loc()] || t.steps.pt)) || [];
    var html =
      '<button type="button" class="crm-help-panel__back" data-crm-help-back>' +
      esc(u.back) +
      "</button>" +
      '<div class="crm-help-panel__badge-row">' +
      '<span class="crm-help-panel__badge">' +
      esc(levelLabel(t.level)) +
      "</span>" +
      '<span class="crm-help-panel__duration">' +
      esc(pick(t.duration)) +
      "</span>" +
      "</div>" +
      '<h3 class="crm-help-panel__detail-title">' +
      esc(pick(t.title)) +
      "</h3>" +
      '<p class="crm-help-panel__detail-sum">' +
      esc(pick(t.summary)) +
      "</p>" +
      '<p class="crm-help-panel__section-label">' +
      esc(u.stepsLabel) +
      "</p>" +
      '<ol class="crm-help-panel__steps crm-help-panel__steps--linked">';
    steps.forEach(function (s) {
      var text = typeof s === "string" ? s : s.text;
      var href = typeof s === "string" ? null : s.href;
      if (href) {
        html +=
          '<li><a href="' +
          esc(href) +
          '" data-crm-help-nav>' +
          esc(text) +
          "</a></li>";
      } else {
        html += "<li>" + esc(text) + "</li>";
      }
    });
    html += "</ol>";
    return html;
  }

  function levelLabel(level) {
    var u = ui();
    if (level === "start") return u.levelStart;
    if (level === "core") return u.levelCore;
    if (level === "ops") return u.levelOps;
    if (level === "setup") return u.levelSetup;
    return level || "";
  }

  function problemRow(p) {
    var c = C();
    var mod = c.moduleById(p.moduleId);
    return (
      '<button type="button" class="crm-help-panel__row" data-crm-help-problem="' +
      esc(p.id) +
      '">' +
      '<span class="crm-help-panel__row-text">' +
      "<strong>" +
      esc(pick(p.title)) +
      "</strong>" +
      (mod ? "<span>" + esc(pick(mod.title)) + "</span>" : "") +
      "</span>" +
      chevron() +
      "</button>"
    );
  }

  function tutorialRow(t) {
    return (
      '<button type="button" class="crm-help-panel__row" data-crm-help-tutorial="' +
      esc(t.id) +
      '">' +
      '<span class="crm-help-panel__row-text">' +
      "<strong>" +
      esc(pick(t.title)) +
      "</strong>" +
      "<span>" +
      esc(levelLabel(t.level)) +
      " · " +
      esc(pick(t.duration)) +
      "</span>" +
      "</span>" +
      chevron() +
      "</button>"
    );
  }

  function moduleCard(m) {
    return (
      '<a class="crm-help-panel__card" href="' +
      esc(m.href) +
      '" data-crm-help-nav>' +
      "<strong>" +
      esc(pick(m.title)) +
      "</strong>" +
      "<span>" +
      esc(pick(m.blurb)) +
      "</span>" +
      "</a>"
    );
  }

  function renderSearchResults(q) {
    var c = C();
    var u = ui();
    var res = c.searchAll(q, loc());
    var html = '<p class="crm-help-panel__hint">' + esc(u.results) + "</p>";
    var empty =
      !res.problems.length && !res.tutorials.length && !res.modules.length;
    if (empty) {
      return (
        html +
        '<p class="crm-help-panel__empty">' +
        esc(u.empty) +
        "</p>" +
        '<a class="crm-help-panel__btn" href="configuracoes.html#suporte" data-crm-help-nav>' +
        esc(u.supportTicket) +
        "</a>"
      );
    }
    if (res.problems.length) {
      html += '<p class="crm-help-panel__section-label">' + esc(u.tabSolve) + "</p>";
      html += '<div class="crm-help-panel__list">';
      res.problems.forEach(function (p) {
        html += problemRow(p);
      });
      html += "</div>";
    }
    if (res.tutorials.length) {
      html +=
        '<p class="crm-help-panel__section-label">' + esc(u.tabTutorials) + "</p>";
      html += '<div class="crm-help-panel__list">';
      res.tutorials.forEach(function (t) {
        html += tutorialRow(t);
      });
      html += "</div>";
    }
    if (res.modules.length) {
      html +=
        '<p class="crm-help-panel__section-label">' + esc(u.tabModules) + "</p>";
      html += '<div class="crm-help-panel__cards">';
      res.modules.forEach(function (m) {
        html += moduleCard(m);
      });
      html += "</div>";
    }
    return html;
  }

  function renderList() {
    var c = C();
    var u = ui();
    var q = state.query.trim();
    if (q) return renderSearchResults(q);

    if (state.tab === "solve") {
      var html = '<p class="crm-help-panel__hint">' + esc(u.solveHint) + "</p>";
      html += '<div class="crm-help-panel__list">';
      c.PROBLEMS.forEach(function (p) {
        html += problemRow(p);
      });
      html += "</div>";
      return html;
    }

    if (state.tab === "tutorials") {
      var th = '<p class="crm-help-panel__hint">' + esc(u.tutorialsHint) + "</p>";
      th += '<div class="crm-help-panel__list">';
      c.TUTORIALS.forEach(function (t) {
        th += tutorialRow(t);
      });
      th += "</div>";
      return th;
    }

    if (state.tab === "modules") {
      var mh = '<p class="crm-help-panel__hint">' + esc(u.modulesHint) + "</p>";
      mh += '<div class="crm-help-panel__cards">';
      c.MODULES.forEach(function (m) {
        mh += moduleCard(m);
      });
      mh += "</div>";
      return mh;
    }

    return (
      '<p class="crm-help-panel__hint">' +
      esc(u.supportHint) +
      "</p>" +
      '<div class="crm-help-panel__contact">' +
      "<h3>" +
      esc(u.supportTitle) +
      "</h3>" +
      "<p>" +
      esc(u.supportBody) +
      "</p>" +
      '<div class="crm-help-panel__contact-actions">' +
      '<a class="crm-help-panel__btn" href="configuracoes.html#suporte" data-crm-help-nav>' +
      esc(u.supportTicket) +
      "</a>" +
      '<a class="crm-help-panel__btn crm-help-panel__btn--ghost" href="mailto:support@obramate.com">' +
      esc(u.supportEmail) +
      "</a>" +
      "</div>" +
      "</div>"
    );
  }

  function render() {
    var body = document.getElementById("crmHelpBody");
    var c = C();
    if (!body || !c) return;

    if (state.view === "detail" && state.detail) {
      if (state.detail.kind === "problem") {
        var p = null;
        for (var i = 0; i < c.PROBLEMS.length; i++) {
          if (c.PROBLEMS[i].id === state.detail.id) {
            p = c.PROBLEMS[i];
            break;
          }
        }
        body.innerHTML = p ? renderProblemDetail(p) : renderList();
        return;
      }
      if (state.detail.kind === "tutorial") {
        var t = null;
        for (var j = 0; j < c.TUTORIALS.length; j++) {
          if (c.TUTORIALS[j].id === state.detail.id) {
            t = c.TUTORIALS[j];
            break;
          }
        }
        body.innerHTML = t ? renderTutorialDetail(t) : renderList();
        return;
      }
    }
    body.innerHTML = renderList();
  }

  function refreshChrome() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel || !C()) return;
    var u = ui();
    var title = panel.querySelector("#crmHelpPanelTitle");
    var lead = panel.querySelector(".crm-help-panel__lead");
    var search = panel.querySelector("#crmHelpSearch");
    var closeBtn = panel.querySelector("[data-crm-help-close]");
    if (title) title.textContent = u.title;
    if (lead) lead.textContent = u.lead;
    if (search) {
      search.placeholder = u.searchPh;
      search.value = state.query;
    }
    if (closeBtn) closeBtn.setAttribute("aria-label", u.close);
    var labels = {
      solve: u.tabSolve,
      tutorials: u.tabTutorials,
      modules: u.tabModules,
      support: u.tabSupport,
    };
    panel.querySelectorAll("[data-crm-help-tab]").forEach(function (btn) {
      var id = btn.getAttribute("data-crm-help-tab");
      if (labels[id]) btn.textContent = labels[id];
    });
  }

  function open(opts) {
    opts = opts || {};
    var els = ensure();
    if (opts.tab) state.tab = opts.tab;
    if (opts.query != null) state.query = String(opts.query);
    if (opts.problem) {
      state.tab = "solve";
      state.view = "detail";
      state.detail = { kind: "problem", id: opts.problem };
    } else if (opts.tutorial) {
      state.tab = "tutorials";
      state.view = "detail";
      state.detail = { kind: "tutorial", id: opts.tutorial };
    } else if (!opts.keepDetail) {
      state.view = "list";
      state.detail = null;
    }
    refreshChrome();
    syncTabs();
    render();
    els.backdrop.hidden = false;
    els.backdrop.setAttribute("aria-hidden", "false");
    els.panel.hidden = false;
    requestAnimationFrame(function () {
      document.body.classList.add("crm-help-open");
      els.panel.classList.add("is-open");
      els.backdrop.classList.add("is-open");
      var search = document.getElementById("crmHelpSearch");
      if (search && window.matchMedia("(min-width: 900px)").matches) {
        try {
          search.focus();
        } catch (_) {}
      }
    });
    var btn = document.getElementById("crmTopbarHelpBtn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function close() {
    var panel = document.getElementById(PANEL_ID);
    var backdrop = document.getElementById(BACKDROP_ID);
    document.body.classList.remove("crm-help-open");
    if (panel) panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    var btn = document.getElementById("crmTopbarHelpBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    window.setTimeout(function () {
      if (panel) panel.hidden = true;
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
      }
    }, 280);
  }

  function isOpen() {
    return document.body.classList.contains("crm-help-open");
  }

  function bindHelpButton(btn) {
    if (!btn || btn.dataset.crmHelpBound) return;
    btn.dataset.crmHelpBound = "1";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-controls", PANEL_ID);
    btn.setAttribute("aria-expanded", "false");
    if (btn.tagName === "A") {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (isOpen()) close();
        else open();
      });
    } else {
      btn.addEventListener("click", function () {
        if (isOpen()) close();
        else open();
      });
    }
  }

  function refresh() {
    ensure();
    bindHelpButton(document.getElementById("crmTopbarHelpBtn"));
    refreshChrome();
    if (isOpen()) render();
  }

  function init() {
    refresh();

    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest("[data-crm-help-close]") || t.closest("#" + BACKDROP_ID)) {
        close();
        return;
      }
      var tab = t.closest("[data-crm-help-tab]");
      if (tab) {
        setTab(tab.getAttribute("data-crm-help-tab"));
        return;
      }
      if (t.closest("[data-crm-help-back]")) {
        backToList();
        return;
      }
      var prob = t.closest("[data-crm-help-problem]");
      if (prob) {
        openDetail("problem", prob.getAttribute("data-crm-help-problem"));
        return;
      }
      var tut = t.closest("[data-crm-help-tutorial]");
      if (tut) {
        openDetail("tutorial", tut.getAttribute("data-crm-help-tutorial"));
        return;
      }
      if (t.closest("[data-crm-help-nav]")) {
        // allow navigation; close panel shortly after
        window.setTimeout(close, 120);
      }
    });

    document.addEventListener("input", function (e) {
      if (e.target && e.target.id === "crmHelpSearch") {
        state.query = e.target.value || "";
        state.view = "list";
        state.detail = null;
        render();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) close();
    });

    document.addEventListener("crm:localechange", function () {
      refreshChrome();
      if (isOpen()) render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__crmHelpPanel = {
    open: open,
    close: close,
    isOpen: isOpen,
    refresh: refresh,
    showTutorial: function (id) {
      open({ tutorial: id });
    },
    showProblem: function (id) {
      open({ problem: id });
    },
  };
})();
