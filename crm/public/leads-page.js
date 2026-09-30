(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function normalizeSlug(raw) {
    if (typeof window.normalizePipelineSlug === "function") {
      return window.normalizePipelineSlug(raw || "");
    }
    const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
    const legacy = {
      new: "new_lead",
      lead_received: "new_lead",
      visit_scheduled: "meeting_scheduled",
      assessment_scheduled: "meeting_scheduled",
      proposal_sent: "quote_sent",
      proposal_created: "quote_sent",
      closed_won: "won",
      closed_lost: "lost",
    };
    return legacy[s] || s;
  }

  function leadSlug(lead) {
    return normalizeSlug(lead.status || lead.pipeline_stage_slug || "");
  }

  function fmtMoney(n) {
    return (
      "$" +
      Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }

  function renderOverview(rows) {
    let nNew = 0;
    let meeting = 0;
    let quote = 0;
    let won = 0;
    let new7 = 0;
    let openValue = 0;
    const now = Date.now();
    const dayMs = 86400000;

    rows.forEach((lead) => {
      const slug = leadSlug(lead);
      if (slug === "new_lead") nNew += 1;
      else if (slug === "meeting_scheduled") meeting += 1;
      else if (slug === "quote_sent" || slug === "follow_up_1") quote += 1;
      else if (slug === "won") won += 1;

      if (lead.created_at) {
        const t = new Date(lead.created_at).getTime();
        if (t >= now - 7 * dayMs && t <= now) new7 += 1;
      }

      if (slug && slug !== "won" && slug !== "lost") {
        openValue += Number(lead.estimated_value || 0);
      }
    });

    $("ovNew").textContent = String(nNew);
    $("ovMeeting").textContent = String(meeting);
    $("ovQuote").textContent = String(quote);
    $("ovWon").textContent = String(won);
    $("ovNew7").textContent = String(new7);
    $("ovOpenValue").textContent = fmtMoney(openValue);
    $("leadsResultCount").textContent = `(${rows.length})`;
  }

  async function loadOverview() {
    const searchEl = $("leadsListSearchInput");
    const q =
      searchEl && searchEl.value && String(searchEl.value).trim()
        ? "&q=" + encodeURIComponent(String(searchEl.value).trim())
        : "";
    const j = await api("/api/leads?limit=5000&page=1" + q);
    renderOverview(j.data || []);
  }

  async function refreshAll() {
    if (typeof window.loadCRMKanban === "function") {
      await window.loadCRMKanban();
    } else if (typeof window.loadKanbanBoard === "function") {
      await window.loadKanbanBoard();
    }
    await loadOverview().catch(() => {});
  }

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName") && ($("sidebarUserName").textContent = s.user?.name || s.user?.email || "—");
      $("sidebarUserRole") && ($("sidebarUserRole").textContent = role || "");

      $("btnNewLead").addEventListener("click", () => {
        if (typeof window.showNewLeadModal === "function") window.showNewLeadModal();
      });
      $("btnReload").addEventListener("click", () => refreshAll().catch((e) => notify(e.message, "error")));
      $("btnSearchLeads").addEventListener("click", () => refreshAll().catch((e) => notify(e.message, "error")));
      $("btnClearSearch").addEventListener("click", () => {
        $("leadsListSearchInput").value = "";
        refreshAll().catch((e) => notify(e.message, "error"));
      });
      $("leadsListSearchInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          refreshAll().catch((err) => notify(err.message, "error"));
        }
      });

      const viewToggle = $("leadsKanbanViewToggle");
      const isTablet =
        (window.__omDevice && typeof window.__omDevice.isTablet === "function" && window.__omDevice.isTablet()) ||
        document.body.classList.contains("om-device-tablet");
      // Honor ?view= from the other screen; never overwrite an explicit list preference on boot.
      try {
        const params = new URLSearchParams(location.search);
        const qView = params.get("view");
        if (qView === "list" || qView === "kanban") {
          localStorage.setItem("obramate_leads_view", qView);
        }
      } catch (_) {}
      if (viewToggle && isTablet) {
        viewToggle.hidden = false;
        viewToggle.style.display = "inline-flex";
        const current = (() => {
          try {
            return localStorage.getItem("obramate_leads_view") || "kanban";
          } catch (_) {
            return "kanban";
          }
        })();
        viewToggle.querySelectorAll("[data-leads-view]").forEach((btn) => {
          const on = btn.getAttribute("data-leads-view") === current;
          btn.classList.toggle("is-active", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        });
        viewToggle.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-leads-view]");
          if (!btn) return;
          e.preventDefault();
          const view = btn.getAttribute("data-leads-view") || "kanban";
          try {
            localStorage.setItem("obramate_leads_view", view);
          } catch (_) {}
          viewToggle.querySelectorAll("[data-leads-view]").forEach((b) => {
            const on = b.getAttribute("data-leads-view") === view;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
          });
          if (view === "list") location.assign("pipeline-lab.html?view=list");
        });
      }

      // If a tablet explicitly asked for list, send them there (e.g. stale bookmark).
      if (isTablet) {
        try {
          if (localStorage.getItem("obramate_leads_view") === "list") {
            location.replace("pipeline-lab.html?view=list");
            return;
          }
        } catch (_) {}
      }

      // Refresh overview when kanban reloads after create/drag
      const origLoad = window.loadKanbanBoard;
      if (typeof origLoad === "function") {
        window.loadKanbanBoard = async function () {
          const result = await origLoad.apply(this, arguments);
          loadOverview().catch(() => {});
          return result;
        };
      }

      await refreshAll();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
