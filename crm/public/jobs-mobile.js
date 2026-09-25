/**
 * Jobs mobile list — Hoje / Ativos / Concluídos.
 * Field staff: only own jobs (API-scoped), field cards, no office/installer switcher.
 */
(function () {
  const ROLE_KEY = "om_jobs_role";
  let allJobs = [];
  let canManage = false;
  let currentUserId = null;
  let tab = "today";
  let role = "office";
  let isField = false;

  const $ = (id) => document.getElementById(id);

  function isMobile() {
    return window.__omDevice && typeof window.__omDevice.isMobile === "function"
      ? window.__omDevice.isMobile()
      : false;
  }

  function money(n) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(n) || 0);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clientLabel(wo) {
    return wo.customer?.name || wo.builder?.company || wo.builder?.name || wo.source_name || "—";
  }

  function statusPt(status) {
    const map = {
      draft: "Rascunho",
      scheduled: "Agendada",
      in_progress: "Em andamento",
      completed: "Concluído",
      canceled: "Cancelado",
    };
    return map[status] || status || "—";
  }

  function statusCls(status) {
    if (status === "in_progress") return "jcm-badge--progress";
    if (status === "scheduled") return "jcm-badge--sched";
    if (status === "completed") return "jcm-badge--done";
    return "jcm-badge--open";
  }

  function fmtTimeRange(start, end) {
    if (!start) return "Sem horário";
    const s = new Date(start);
    const pad = (n) => String(n).padStart(2, "0");
    const a = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
    if (!end) return a;
    const e = new Date(end);
    return `${a} – ${pad(e.getHours())}:${pad(e.getMinutes())}`;
  }

  function fmtDay(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
  }

  function ymdLocal(d) {
    const x = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }

  function isToday(iso) {
    if (!iso) return false;
    return ymdLocal(iso) === ymdLocal(new Date());
  }

  function isActive(wo) {
    return wo.status === "scheduled" || wo.status === "in_progress" || wo.status === "draft";
  }

  function teamLabel(wo) {
    const parts = [];
    if (wo.crew?.name) parts.push(wo.crew.name);
    if (wo.assigned_user?.name) parts.push(wo.assigned_user.name);
    (wo.members || []).slice(0, 2).forEach((m) => {
      if (m.name && !parts.includes(m.name)) parts.push(m.name);
    });
    return parts.join(", ") || "Sem equipe";
  }

  function onMyJob(wo) {
    if (!currentUserId) return false;
    const uid = String(currentUserId);
    if (String(wo.assigned_user_id || wo.assigned_user?.id || "") === uid) return true;
    if ((wo.members || []).some((m) => String(m.user_id || m.id) === uid)) return true;
    return false;
  }

  function roleFiltered(rows) {
    // Field: API already scopes; office "installer" mode still filters client-side.
    if (isField) return rows;
    if (role !== "installer" || !currentUserId) return rows;
    return rows.filter(onMyJob);
  }

  function tabFiltered(rows) {
    if (tab === "today") {
      return rows.filter(
        (wo) =>
          isToday(wo.scheduled_start) && wo.status !== "canceled" && wo.status !== "completed",
      );
    }
    if (tab === "active") return rows.filter((wo) => isActive(wo) && wo.status !== "canceled");
    if (tab === "done") return rows.filter((wo) => wo.status === "completed");
    return rows;
  }

  function contractTotal(rows) {
    return rows.reduce((s, wo) => s + (Number(wo.services_total) || 0), 0);
  }

  function applyFieldChrome() {
    document.body.classList.add("jcm-field");
    const back = document.querySelector(".jcm-nav .jcm-icon-btn");
    if (back) {
      back.setAttribute("href", "/campo/hoje.html");
      back.setAttribute("aria-label", "Voltar ao Campo");
    }
    const roleEl = document.querySelector(".jcm-role");
    if (roleEl) roleEl.hidden = true;
    const add = $("jobsMobAdd");
    if (add) add.style.display = "none";
    const title = document.querySelector(".jcm-title");
    if (title) title.textContent = "Meus jobs";
  }

  function renderOfficeCard(wo) {
    const maps = wo.address
      ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}`
      : "";
    const cta =
      wo.status === "in_progress"
        ? `<button type="button" class="jcm-job__cta jcm-job__cta--done" data-job-action="complete" data-id="${escapeHtml(wo.id)}">Concluir visita</button>`
        : wo.status === "scheduled" || wo.status === "draft"
          ? `<button type="button" class="jcm-job__cta jcm-job__cta--start" data-job-action="start" data-id="${escapeHtml(wo.id)}">Iniciar visita</button>`
          : `<a class="jcm-job__cta jcm-job__cta--done" href="job-detail.html?id=${encodeURIComponent(wo.id)}" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none">Ver job</a>`;
    const crewColor = wo.crew?.color || "#e8792c";
    return `<article class="jcm-job">
      <a href="job-detail.html?id=${encodeURIComponent(wo.id)}" style="text-decoration:none;color:inherit;display:block">
        <div class="jcm-job__top">
          <p class="jcm-job__time">${escapeHtml(fmtTimeRange(wo.scheduled_start, wo.scheduled_end))}</p>
          <span class="jcm-badge ${statusCls(wo.status)}">${escapeHtml(statusPt(wo.status))}</span>
        </div>
        <p class="jcm-job__title">${escapeHtml(wo.title || "Job")}</p>
        <p class="jcm-job__meta">#${escapeHtml(wo.number != null ? wo.number : "—")} · ${escapeHtml(clientLabel(wo))} · ${escapeHtml(wo.address || "—")}</p>
        <div class="jcm-job__team"><span class="jcm-job__team-dot" style="background:${escapeHtml(crewColor)}"></span>${escapeHtml(teamLabel(wo))}</div>
      </a>
      <div class="jcm-job__actions">
        ${maps ? `<a class="jcm-job__map" href="${maps}" target="_blank" rel="noopener" aria-label="Mapa"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a>` : `<span class="jcm-job__map" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></span>`}
        ${cta}
      </div>
    </article>`;
  }

  function renderFieldCard(wo) {
    const maps = wo.address
      ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}`
      : "";
    const crewColor = wo.crew?.color || "#e8792c";
    const day = fmtDay(wo.scheduled_start);
    const today = isToday(wo.scheduled_start);
    const detailHref = `job-detail.html?id=${encodeURIComponent(wo.id)}`;
    const campoHref = `/campo/ticket.html?id=${encodeURIComponent(wo.id)}`;
    const openHref = isField ? campoHref : detailHref;
    const ctaLabel =
      wo.status === "in_progress"
        ? "Continuar no campo"
        : wo.status === "completed"
          ? "Ver detalhes"
          : "Abrir no campo";
    return `<article class="jcm-job jcm-job--field" style="--job-accent:${escapeHtml(crewColor)}">
      <a class="jcm-job__body" href="${openHref}">
        <div class="jcm-job__top">
          <div class="jcm-job__when">
            <span class="jcm-job__day${today ? " is-today" : ""}">${escapeHtml(today ? "Hoje" : day || "Sem data")}</span>
            <span class="jcm-job__time">${escapeHtml(fmtTimeRange(wo.scheduled_start, wo.scheduled_end))}</span>
          </div>
          <span class="jcm-badge ${statusCls(wo.status)}">${escapeHtml(statusPt(wo.status))}</span>
        </div>
        <p class="jcm-job__title">${escapeHtml(wo.title || "Job")}</p>
        <p class="jcm-job__client">${escapeHtml(clientLabel(wo))}</p>
        ${
          wo.address
            ? `<p class="jcm-job__addr"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${escapeHtml(wo.address)}</span></p>`
            : ""
        }
        <div class="jcm-job__foot">
          <span class="jcm-job__num">#${escapeHtml(wo.number != null ? wo.number : "—")}</span>
          <span class="jcm-job__team"><span class="jcm-job__team-dot" style="background:${escapeHtml(crewColor)}"></span>${escapeHtml(teamLabel(wo))}</span>
        </div>
      </a>
      <div class="jcm-job__actions">
        ${
          maps
            ? `<a class="jcm-job__map" href="${maps}" target="_blank" rel="noopener" aria-label="Abrir mapa"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a>`
            : `<span class="jcm-job__map" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></span>`
        }
        <a class="jcm-job__cta jcm-job__cta--start" href="${openHref}">${ctaLabel}</a>
      </div>
    </article>`;
  }

  function render() {
    if (!isMobile() || !$("jobsMobile")) return;
    const base = roleFiltered(allJobs);
    const todayN = base.filter(
      (wo) => isToday(wo.scheduled_start) && wo.status !== "canceled" && wo.status !== "completed",
    ).length;
    const activeN = base.filter((wo) => isActive(wo) && wo.status !== "canceled").length;
    const doneN = base.filter((wo) => wo.status === "completed").length;
    const activeRows = base.filter((wo) => isActive(wo) && wo.status !== "canceled");

    if (isField) {
      $("jobsMobSub").textContent =
        todayN > 0
          ? `${todayN} hoje · ${activeN} ativo${activeN === 1 ? "" : "s"}`
          : `${activeN} job${activeN === 1 ? "" : "s"} ativo${activeN === 1 ? "" : "s"}`;
    } else {
      $("jobsMobSub").textContent = `${activeN} ativo${activeN === 1 ? "" : "s"} · ${money(contractTotal(activeRows))} em contratos`;
    }

    document.querySelectorAll("[data-jobs-tab]").forEach((btn) => {
      const id = btn.getAttribute("data-jobs-tab");
      btn.classList.toggle("is-active", id === tab);
      const n = id === "today" ? todayN : id === "active" ? activeN : doneN;
      const label = id === "today" ? "Hoje" : id === "active" ? "Ativos" : "Concluídos";
      btn.textContent = `${label} · ${n}`;
    });

    document.querySelectorAll("[data-jobs-role]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-jobs-role") === role);
    });

    const rows = tabFiltered(base);
    const host = $("jobsMobList");
    if (!rows.length) {
      host.innerHTML = `<p class="jcm-empty">${isField ? "Nenhum job atribuído a você neste filtro." : "Nenhum job neste filtro."}</p>`;
      return;
    }
    host.innerHTML = rows.map((wo) => (isField ? renderFieldCard(wo) : renderOfficeCard(wo))).join("");

    host.querySelectorAll("[data-job-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-job-action");
        updateStatus(id, action === "complete" ? "completed" : "in_progress");
      });
    });
  }

  async function updateStatus(id, status) {
    if (!canManage) {
      location.href = `job-detail.html?id=${encodeURIComponent(id)}`;
      return;
    }
    try {
      await fetch(`/api/work-orders/${id}`, {
        credentials: "include",
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.success === false) throw new Error(j.error || "Erro");
        return j;
      });
      window.crmToast?.success?.(status === "completed" ? "Visita concluída" : "Visita iniciada");
      await load();
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  async function load() {
    const j = await fetch("/api/work-orders", { credentials: "include" }).then((r) => r.json());
    if (!j.success && j.success !== undefined) throw new Error(j.error || "Erro");
    allJobs = j.data || [];
    render();
  }

  function bind() {
    document.querySelectorAll("[data-jobs-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.getAttribute("data-jobs-tab") || "today";
        render();
      });
    });
    document.querySelectorAll("[data-jobs-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isField) return;
        role = btn.getAttribute("data-jobs-role") || "office";
        try {
          localStorage.setItem(ROLE_KEY, role);
        } catch (_) {}
        render();
      });
    });
    $("jobsMobAdd")?.addEventListener("click", () => {
      if (window.__crmJobModal) {
        window.__crmJobModal.openCreate().catch((e) => window.crmToast?.error?.(e.message));
      }
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!$("jobsMobile")) return;
    try {
      role = localStorage.getItem(ROLE_KEY) === "installer" ? "installer" : "office";
    } catch (_) {}
    try {
      const s = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json());
      if (!s.authenticated) return;
      currentUserId = s.user?.id || null;
      const roleName = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      canManage = roleName === "admin" || perms.includes("work_orders.manage");
      isField =
        (window.__crmFieldGate && window.__crmFieldGate.isFieldRole(roleName)) ||
        roleName === "installer" ||
        roleName === "crew_lead";
      if (isField) {
        role = "installer";
        applyFieldChrome();
      }
      if (!canManage || isField) {
        const add = $("jobsMobAdd");
        if (add) add.style.display = "none";
      }
      bind();
      await load();
      if (window.__crmJobModal?.onSaved) {
        window.__crmJobModal.onSaved(() => load().catch(() => {}));
      }
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro ao carregar jobs");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
