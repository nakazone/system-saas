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

  async function refreshAll() {
    if (typeof window.loadCRMKanban === "function") {
      await window.loadCRMKanban();
    } else if (typeof window.loadKanbanBoard === "function") {
      await window.loadKanbanBoard();
    }
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
      window.__crmUserId = s.user?.id || null;
      // Busca enquanto digita (sem botões Buscar/Limpar/Atualizar).
      let searchTimer = null;
      $("leadsListSearchInput").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => refreshAll().catch((e) => notify(e.message, "error")), 320);
      });
      $("leadsListSearchInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          clearTimeout(searchTimer);
          refreshAll().catch((err) => notify(err.message, "error"));
        }
      });

      const viewToggle = $("leadsKanbanViewToggle");
      // Honor ?view= from the other screen; switch Quadro/Lista on this page (distinct visuals).
      try {
        const params = new URLSearchParams(location.search);
        const qView = params.get("view");
        if (qView === "list" || qView === "kanban") {
          localStorage.setItem("obramate_leads_view", qView);
        }
      } catch (_) {}
      const current = (() => {
        try {
          return localStorage.getItem("obramate_leads_view") || "kanban";
        } catch (_) {
          return "kanban";
        }
      })();
      if (viewToggle) {
        viewToggle.hidden = false;
        viewToggle.style.display = "inline-flex";
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
          if (view === "list" && typeof window.showListView === "function") window.showListView();
          else if (typeof window.showKanbanView === "function") window.showKanbanView();
          try {
            const u = new URL(location.href);
            u.searchParams.set("view", view);
            history.replaceState(null, "", u.toString());
          } catch (_) {}
        });
      }

      window.__omPullRefresh = () => refreshAll();
      await refreshAll();
      if (current === "list" && typeof window.showListView === "function") window.showListView();
      else if (typeof window.showKanbanView === "function") window.showKanbanView();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
