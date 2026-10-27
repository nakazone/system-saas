/**
 * Interactive Help Center slide-over (top-bar ?).
 * Home hub + context + checklist + solve/tutorials + inline support tickets.
 */
(function () {
  var PANEL_ID = "crmHelpPanel";
  var BACKDROP_ID = "crmHelpBackdrop";
  var state = { tab: "home", view: "list", detail: null, query: "", supportStatus: "" };

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
      '<p class="crm-help-panel__eyebrow">ObraMate</p>' +
      '<h2 id="crmHelpPanelTitle">' +
      esc(u.title) +
      "</h2>" +
      '<p class="crm-help-panel__lead">' +
      esc(u.lead) +
      "</p>" +
      // The Mate (fox) answers help too: one tap opens him with the question
      ('<button type="button" class="crm-help-panel__mate" data-crm-help-mate>' +
          '<span class="crm-help-panel__mateface" aria-hidden="true"><img src="/assets/img/mascot/mate-head-neutral.webp?v=20261027-m2" alt="" width="28" height="28"></span>' +
          '<span>' + esc({ en: "Ask Mate", es: "Pregúntale a Mate" }[loc()] || "Pergunte ao Mate") + '</span></button>') +
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
      '" autocomplete="off" enterkeyhint="search" />' +
      "</div>" +
      '<nav class="crm-help-panel__tabs" role="tablist" aria-label="' +
      esc(u.title) +
      '">' +
      tabBtn("home", u.tabHome) +
      tabBtn("solve", u.tabSolve) +
      tabBtn("tutorials", u.tabTutorials) +
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
    state.supportStatus = "";
    syncTabs();
    render();
    if (tab === "support") loadSupportHistory();
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

  function chip(label, attrs) {
    return (
      '<button type="button" class="crm-help-panel__chip" ' +
      attrs +
      ">" +
      esc(label) +
      "</button>"
    );
  }

  function renderHome() {
    var c = C();
    var u = ui();
    var ctx = c.contextualItems();
    var html = "";

    if (ctx.module || ctx.problems.length || ctx.tutorials.length) {
      html += '<section class="crm-help-panel__block crm-help-panel__block--context">';
      html +=
        '<div class="crm-help-panel__block-head"><span>' +
        esc(u.hereNow) +
        "</span>" +
        (ctx.module
          ? '<a class="crm-help-panel__block-link" href="' +
            esc(ctx.module.href) +
            '" data-crm-help-nav>' +
            esc(pick(ctx.module.title)) +
            "</a>"
          : "") +
        "</div>";
      html += '<p class="crm-help-panel__hint crm-help-panel__hint--tight">' + esc(u.hereHint) + "</p>";
      html += '<div class="crm-help-panel__chips">';
      ctx.problems.forEach(function (p) {
        html += chip(pick(p.title), 'data-crm-help-problem="' + esc(p.id) + '"');
      });
      ctx.tutorials.forEach(function (t) {
        html += chip(pick(t.title), 'data-crm-help-tutorial="' + esc(t.id) + '"');
      });
      html += "</div></section>";
    }

    html += renderChecklist();

    html += '<section class="crm-help-panel__block">';
    html += '<p class="crm-help-panel__section-label">' + esc(u.quickTitle) + "</p>";
    html += '<div class="crm-help-panel__quick">';
    html +=
      '<button type="button" class="crm-help-panel__quick-btn" data-crm-help-tab="solve"><strong>' +
      esc(u.tabSolve) +
      "</strong><span>" +
      esc(u.solveHint) +
      "</span></button>";
    html +=
      '<button type="button" class="crm-help-panel__quick-btn" data-crm-help-tab="tutorials"><strong>' +
      esc(u.tabTutorials) +
      "</strong><span>" +
      esc(u.tutorialsHint) +
      "</span></button>";
    html +=
      '<button type="button" class="crm-help-panel__quick-btn" data-crm-help-tab="support"><strong>' +
      esc(u.tabSupport) +
      "</strong><span>" +
      esc(u.supportHint) +
      "</span></button>";
    html += "</div></section>";

    html += '<section class="crm-help-panel__block">';
    html +=
      '<div class="crm-help-panel__block-head"><span>' +
      esc(u.tabModules) +
      '</span><button type="button" class="crm-help-panel__block-link" data-crm-help-show-modules>' +
      esc(u.seeAll) +
      "</button></div>";
    html += '<div class="crm-help-panel__modules-scroll">';
    c.MODULES.slice(0, 8).forEach(function (m) {
      html +=
        '<a class="crm-help-panel__mod-pill" href="' +
        esc(m.href) +
        '" data-crm-help-nav>' +
        esc(pick(m.title)) +
        "</a>";
    });
    html += "</div></section>";

    return html;
  }

  function renderChecklist() {
    var c = C();
    var u = ui();
    var map = c.loadChecklistState();
    var items = c.CHECKLIST || [];
    var done = 0;
    items.forEach(function (it) {
      if (map[it.id]) done++;
    });
    if (done >= items.length) return "";

    var html =
      '<section class="crm-help-panel__block crm-help-panel__block--check">' +
      '<div class="crm-help-panel__block-head"><span>' +
      esc(u.checklistTitle) +
      '</span><span class="crm-help-panel__progress">' +
      done +
      " " +
      esc(u.checklistProgress) +
      " " +
      items.length +
      "</span></div>" +
      '<div class="crm-help-panel__progress-bar" aria-hidden="true"><i style="width:' +
      Math.round((done / items.length) * 100) +
      '%"></i></div>' +
      '<ul class="crm-help-panel__check">';

    items.forEach(function (it) {
      var on = !!map[it.id];
      html +=
        '<li class="crm-help-panel__check-item' +
        (on ? " is-done" : "") +
        '">' +
        '<button type="button" class="crm-help-panel__check-toggle" data-crm-help-check="' +
        esc(it.id) +
        '" aria-pressed="' +
        (on ? "true" : "false") +
        '" title="' +
        esc(on ? u.markUndo : u.markDone) +
        '">' +
        (on ? "✓" : "") +
        "</button>" +
        '<a href="' +
        esc(it.href) +
        '" data-crm-help-nav>' +
        esc(pick(it.label)) +
        "</a>" +
        "</li>";
    });
    html += "</ul></section>";
    return html;
  }

  function renderSupport() {
    var u = ui();
    var page = C().currentPageFile() || location.pathname;
    var status =
      state.supportStatus === "ok"
        ? '<p class="crm-help-panel__flash is-ok">' + esc(u.supportOk) + "</p>"
        : state.supportStatus === "err"
          ? '<p class="crm-help-panel__flash is-err">' + esc(u.supportErr) + "</p>"
          : "";

    return (
      '<p class="crm-help-panel__hint">' +
      esc(u.supportHint) +
      "</p>" +
      status +
      '<form class="crm-help-panel__form" id="crmHelpSupportForm" autocomplete="off">' +
      '<label class="crm-help-panel__field"><span>' +
      esc(u.supportCat) +
      '</span><select name="category" id="crmHelpCat">' +
      '<option value="question">' +
      esc(u.catQuestion) +
      "</option>" +
      '<option value="suggestion">' +
      esc(u.catSuggestion) +
      "</option>" +
      '<option value="bug">' +
      esc(u.catBug) +
      "</option>" +
      '<option value="other">' +
      esc(u.catOther) +
      "</option>" +
      "</select></label>" +
      '<label class="crm-help-panel__field"><span>' +
      esc(u.supportSubject) +
      '</span><input name="subject" id="crmHelpSubject" required maxlength="160" /></label>' +
      '<label class="crm-help-panel__field"><span>' +
      esc(u.supportMessage) +
      '</span><textarea name="body" id="crmHelpBodyMsg" rows="4" required maxlength="7800"></textarea></label>' +
      '<p class="crm-help-panel__ctx-note">' +
      esc(page) +
      "</p>" +
      '<div class="crm-help-panel__form-actions">' +
      '<button type="submit" class="crm-help-panel__btn" id="crmHelpSendBtn">' +
      esc(u.supportTicket) +
      "</button>" +
      '<a class="crm-help-panel__btn crm-help-panel__btn--ghost" href="mailto:support@obramate.com">' +
      esc(u.supportEmail) +
      "</a>" +
      "</div>" +
      "</form>" +
      '<p class="crm-help-panel__section-label">' +
      esc(u.supportHistory) +
      "</p>" +
      '<div id="crmHelpTicketList" class="crm-help-panel__tickets"><p class="crm-help-panel__hint">' +
      esc(u.supportEmptyHist) +
      "</p></div>"
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
        if (!rows.length) {
          list.innerHTML =
            '<p class="crm-help-panel__hint">' + esc(u.supportEmptyHist) + "</p>";
          return;
        }
        var cats = {
          question: u.catQuestion,
          suggestion: u.catSuggestion,
          bug: u.catBug,
          other: u.catOther,
        };
        list.innerHTML = rows
          .slice(0, 8)
          .map(function (t) {
            var when = t.created_at
              ? new Date(t.created_at).toLocaleString(loc() === "en" ? "en-US" : "pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "";
            var st =
              t.status === "closed"
                ? loc() === "en"
                  ? "Resolved"
                  : "Resolvido"
                : t.status === "waiting"
                  ? loc() === "en"
                    ? "Replied"
                    : "Respondido"
                  : loc() === "en"
                    ? "Open"
                    : "Aberto";
            return (
              '<article class="crm-help-panel__ticket">' +
              '<div class="crm-help-panel__ticket-meta"><span>' +
              esc(st) +
              "</span><span>" +
              esc(cats[t.category] || t.category || "") +
              "</span><span>" +
              esc(when) +
              "</span></div>" +
              "<strong>" +
              esc(t.subject) +
              "</strong>" +
              "<p>" +
              esc(t.body) +
              "</p>" +
              "</article>"
            );
          })
          .join("");
      })
      .catch(function () {});
  }

  function submitSupport(e) {
    e.preventDefault();
    var u = ui();
    var subjectEl = document.getElementById("crmHelpSubject");
    var bodyEl = document.getElementById("crmHelpBodyMsg");
    var catEl = document.getElementById("crmHelpCat");
    var btn = document.getElementById("crmHelpSendBtn");
    if (!subjectEl || !bodyEl || !btn) return;
    var subject = subjectEl.value.trim();
    var body = bodyEl.value.trim();
    if (!subject || !body) {
      (subject ? bodyEl : subjectEl).focus();
      return;
    }
    var page = C().currentPageFile() || location.pathname;
    var payloadBody = body + "\n\n---\nPágina: " + page + "\nURL: " + location.href;
    btn.disabled = true;
    btn.textContent = u.supportSending;
    fetch("/api/support/tickets", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: (catEl && catEl.value) || "question",
        subject: subject,
        body: payloadBody,
      }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || "fail");
        subjectEl.value = "";
        bodyEl.value = "";
        if (catEl) catEl.value = "question";
        state.supportStatus = "ok";
        render();
        loadSupportHistory();
      })
      .catch(function () {
        state.supportStatus = "err";
        render();
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = u.supportTicket;
      });
  }

  function renderProblemDetail(p) {
    var c = C();
    var u = ui();
    var mod = c.moduleById(p.moduleId);
    var href = p.href || (mod && mod.href) || "#";
    var steps = (p.steps && (p.steps[loc()] || p.steps.pt)) || [];
    var html =
      '<button type="button" class="crm-help-panel__back" data-crm-help-back>' +
      esc(u.back) +
      "</button>" +
      '<h3 class="crm-help-panel__detail-title">' +
      esc(pick(p.title)) +
      "</h3>" +
      (mod ? '<p class="crm-help-panel__meta">' + esc(pick(mod.title)) + "</p>" : "") +
      '<p class="crm-help-panel__section-label">' +
      esc(u.stepsLabel) +
      "</p>" +
      '<ol class="crm-help-panel__steps">';
    steps.forEach(function (s) {
      html += "<li>" + esc(s) + "</li>";
    });
    html += "</ol>";
    if (p.helpTab === "support") {
      html +=
        '<button type="button" class="crm-help-panel__btn crm-help-panel__btn--block" data-crm-help-tab="support">' +
        esc(u.tabSupport) +
        "</button>";
    } else {
      html +=
        '<a class="crm-help-panel__btn crm-help-panel__btn--block" href="' +
        esc(href) +
        '" data-crm-help-nav>' +
        esc(u.goModule) +
        "</a>";
    }
    if (p.extraLinks && p.extraLinks.length) {
      html += '<p class="crm-help-panel__section-label">' + esc(u.related) + "</p>";
      html += '<div class="crm-help-panel__cards">';
      p.extraLinks.forEach(function (l) {
        if (l.helpTab) {
          html +=
            '<button type="button" class="crm-help-panel__card crm-help-panel__card--compact" data-crm-help-tab="' +
            esc(l.helpTab) +
            '"><strong>' +
            esc(pick(l.label)) +
            "</strong></button>";
        } else {
          html +=
            '<a class="crm-help-panel__card crm-help-panel__card--compact" href="' +
            esc(l.href) +
            '" data-crm-help-nav><strong>' +
            esc(pick(l.label)) +
            "</strong></a>";
        }
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
          '<li><a href="' + esc(href) + '" data-crm-help-nav>' + esc(text) + "</a></li>";
      } else {
        html += "<li>" + esc(text) + "</li>";
      }
    });
    html += "</ol>";
    return html;
  }

  function renderSearchResults(q) {
    var c = C();
    var u = ui();
    var res = c.searchAll(q, loc());
    var html = '<p class="crm-help-panel__hint">' + esc(u.results) + "</p>";
    var empty = !res.problems.length && !res.tutorials.length && !res.modules.length;
    if (empty) {
      return (
        html +
        '<p class="crm-help-panel__empty">' +
        esc(u.empty) +
        "</p>" +
        '<button type="button" class="crm-help-panel__btn" data-crm-help-tab="support">' +
        esc(u.tabSupport) +
        "</button>"
      );
    }
    if (res.problems.length) {
      html +=
        '<p class="crm-help-panel__section-label">' +
        esc(u.tabSolve) +
        '</p><div class="crm-help-panel__list">';
      res.problems.forEach(function (p) {
        html += problemRow(p);
      });
      html += "</div>";
    }
    if (res.tutorials.length) {
      html +=
        '<p class="crm-help-panel__section-label">' +
        esc(u.tabTutorials) +
        '</p><div class="crm-help-panel__list">';
      res.tutorials.forEach(function (t) {
        html += tutorialRow(t);
      });
      html += "</div>";
    }
    if (res.modules.length) {
      html +=
        '<p class="crm-help-panel__section-label">' +
        esc(u.tabModules) +
        '</p><div class="crm-help-panel__cards">';
      res.modules.forEach(function (m) {
        html += moduleCard(m);
      });
      html += "</div>";
    }
    return html;
  }

  function renderModulesAll() {
    var c = C();
    var u = ui();
    var html =
      '<button type="button" class="crm-help-panel__back" data-crm-help-back-home>' +
      esc(u.back) +
      "</button>" +
      '<p class="crm-help-panel__hint">' +
      esc(u.modulesHint) +
      '</p><div class="crm-help-panel__cards">';
    c.MODULES.forEach(function (m) {
      html += moduleCard(m);
    });
    html += "</div>";
    return html;
  }

  function renderList() {
    var c = C();
    var u = ui();
    var q = state.query.trim();
    if (q) return renderSearchResults(q);

    if (state.view === "modules") return renderModulesAll();

    if (state.tab === "home") return renderHome();

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

    if (state.tab === "support") return renderSupport();

    return renderHome();
  }

  function render() {
    var body = document.getElementById("crmHelpBody");
    var c = C();
    if (!body || !c) return;

    if (state.view === "detail" && state.detail) {
      if (state.detail.kind === "problem") {
        var p = c.problemById(state.detail.id);
        body.innerHTML = p ? renderProblemDetail(p) : renderList();
        return;
      }
      if (state.detail.kind === "tutorial") {
        var t = c.tutorialById(state.detail.id);
        body.innerHTML = t ? renderTutorialDetail(t) : renderList();
        return;
      }
    }
    body.innerHTML = renderList();
    if (state.tab === "support" && state.view === "list" && !state.query) {
      loadSupportHistory();
      var form = document.getElementById("crmHelpSupportForm");
      if (form && !form.dataset.bound) {
        form.dataset.bound = "1";
        form.addEventListener("submit", submitSupport);
      }
    }
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
      home: u.tabHome,
      solve: u.tabSolve,
      tutorials: u.tabTutorials,
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
    else if (!opts.problem && !opts.tutorial) state.tab = "home";
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
    function toggle(e) {
      if (e) e.preventDefault();
      if (isOpen()) close();
      else open();
    }
    btn.addEventListener("click", toggle);
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
      if (t.closest("[data-crm-help-mate]")) {
        var q = (document.getElementById("crmHelpSearch") || {}).value || "";
        close();
        if (window.MateAI) {
          if (q.trim() && typeof window.MateAI.ask === "function") window.MateAI.ask(q.trim());
          else if (typeof window.MateAI.open === "function") window.MateAI.open();
        }
        return;
      }
      var tab = t.closest("[data-crm-help-tab]");
      if (tab && tab.closest("#" + PANEL_ID)) {
        setTab(tab.getAttribute("data-crm-help-tab"));
        return;
      }
      if (t.closest("[data-crm-help-back]")) {
        backToList();
        return;
      }
      if (t.closest("[data-crm-help-back-home]")) {
        state.view = "list";
        state.tab = "home";
        state.detail = null;
        syncTabs();
        render();
        return;
      }
      if (t.closest("[data-crm-help-show-modules]")) {
        state.view = "modules";
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
        openDetail("problem", prob.getAttribute("data-crm-help-problem"));
        return;
      }
      var tut = t.closest("[data-crm-help-tutorial]");
      if (tut) {
        openDetail("tutorial", tut.getAttribute("data-crm-help-tutorial"));
        return;
      }
      if (t.closest("[data-crm-help-nav]")) {
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

    // Deep-link: #help, #help-support, #help-tutorials
    try {
      var hash = (location.hash || "").replace(/^#/, "");
      if (hash === "help" || hash === "help-home") open({ tab: "home" });
      else if (hash === "help-support" || hash === "suporte") open({ tab: "support" });
      else if (hash === "help-tutorials") open({ tab: "tutorials" });
      else if (hash === "help-solve") open({ tab: "solve" });
    } catch (_) {}
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
