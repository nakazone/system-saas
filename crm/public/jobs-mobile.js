/**
 * Jobs mobile list — Hoje / Ativos / Concluídos.
 * Field staff: only own jobs (API-scoped), field cards, no office/installer switcher.
 */
(function () {
  const ROLE_KEY = "om_jobs_role";
  let allJobs = [];
  let canManage = false;
  let canInvoice = false;
  let currentUserId = null;
  let tab = "today";
  let tabChosen = false;
  let role = "office";
  let isField = false;
  let mobQ = "";
  let fetchedMobQuery = "";
  /** Empty hides paid jobs. */
  let mobStatus = "";
  /** Job opened from a quote. Stays at the top even when the default tab is today. */
  let focusId = null;
  let loadSeq = 0;

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

  function compactMoney(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 10000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return money(v);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clientLabel(wo) {
    if (window.JobsInfo?.client) {
      const name = window.JobsInfo.client(wo);
      if (name && name !== "Sem cliente") return name;
    }
    return wo.customer?.name || wo.builder?.company || wo.builder?.name || wo.lead_name || wo.source_name || "—";
  }

  function cardTitle(wo) {
    const who = clientLabel(wo);
    return who && who !== "—" ? who : wo.title || "Job";
  }

  function statusPt(status) {
    const map = {
      draft: "Rascunho",
      scheduled: "Agendado",
      in_progress: "Em campo",
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

  function isPaidJob(wo) {
    return Boolean(wo && wo.billing && wo.billing.billing_status === "paid");
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

  function byCreatedDesc(a, b) {
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  }

  function tabFiltered(rows) {
    const needle = mobQ.trim().toLowerCase();
    const serverSearch = needle.length >= 2 && needle === fetchedMobQuery;
    const matched = !needle || serverSearch
      ? rows
      : rows.filter((wo) => {
          const text = window.JobsInfo?.searchText?.(wo) || "";
          return text.includes(needle) || (needle.length >= 5 && text.includes(needle.slice(1)));
        });
    if (needle.length >= 2 && !mobStatus) {
      return matched.filter((wo) => wo.status !== "canceled" && !isPaidJob(wo)).sort(byCreatedDesc);
    }
    let out;
    if (mobStatus) {
      out = matched.filter((wo) => window.JobsInfo?.stageLabel?.(wo) === mobStatus);
    } else if (tab === "today") {
      out = matched.filter(
        (wo) =>
          isToday(wo.scheduled_start) && wo.status !== "canceled" && wo.status !== "completed" && !isPaidJob(wo),
      );
    } else if (tab === "active") out = matched.filter((wo) => isActive(wo) && wo.status !== "canceled" && !isPaidJob(wo));
    else if (tab === "bill") out = matched.filter((wo) => toBill(wo) && !isPaidJob(wo));
    else if (tab === "done") out = matched.filter((wo) => wo.status === "completed" && !isPaidJob(wo));
    else out = matched.filter((wo) => !isPaidJob(wo));
    out.sort((a, b) => (window.JobsInfo?.compareNearest ? window.JobsInfo.compareNearest(a, b) : 0));
    if (focusId) {
      const pinned = rows.find((wo) => String(wo.id) === String(focusId) && wo.status !== "canceled");
      const allowed = pinned && (mobStatus ? window.JobsInfo?.stageLabel?.(pinned) === mobStatus : !isPaidJob(pinned));
      if (allowed) out = [pinned, ...out.filter((wo) => String(wo.id) !== String(pinned.id))];
    }
    return out;
  }

  function toBill(wo) {
    return wo.status === "completed" && wo.billing && wo.billing.billing_status !== "no_value" && wo.billing.remaining_to_invoice > 0.004;
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
    const J = window.JobsInfo;
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "";
    const detailHref = `job-detail.html?id=${encodeURIComponent(wo.id)}`;
    const nxt = J && J.nextFinish ? J.nextFinish(wo) : null;
    const cta =
      wo.status === "in_progress"
        ? `<button type="button" class="jmx-b jmx-b--or" data-job-action="complete" data-id="${escapeHtml(wo.id)}">${escapeHtml(nxt ? nxt.label : "Concluir")}</button>`
        : wo.status === "scheduled" || wo.status === "draft"
          ? canManage
            ? !wo.scheduled_start && !(wo.sector === "both" && wo.sand_scheduled_start)
              ? `<button type="button" class="jmx-b jmx-b--or" data-job-action="edit" data-id="${escapeHtml(wo.id)}">Schedule Job</button>`
              : `<button type="button" class="jmx-b jmx-b--or" data-job-action="start" data-id="${escapeHtml(wo.id)}">Iniciar</button><button type="button" class="jmx-b" data-job-action="complete" data-id="${escapeHtml(wo.id)}">Já concluído</button>`
            : wo.scheduled_start
              ? `<a class="jmx-b jmx-b--or" href="campo/ticket.html?id=${encodeURIComponent(wo.id)}">Campo</a>`
              : `<a class="jmx-b" href="${detailHref}">Ver job</a>`
          : `<a class="jmx-b" href="${detailHref}">Ver job</a>`;
    const listed = J && J.listWhen ? J.listWhen(wo) : null;
    const when = listed
      ? [listed.date, listed.status].filter(Boolean).join(" · ")
      : !wo.scheduled_start && !(wo.sector === "both" && wo.sand_scheduled_start)
        ? "Sem data"
        : fmtDay(wo.scheduled_start);
    return `<article class="om-swipe jcm-job-swipe" data-job-id="${escapeHtml(wo.id)}">
      <div class="om-swipe__actions" aria-hidden="true">
        <a class="om-swipe__act--edit" href="${detailHref}">Abrir</a>
        ${canManage && wo.status !== "canceled" ? `<button type="button" class="om-swipe__act--delete" data-job-delete="${escapeHtml(wo.id)}" data-job-label="${escapeHtml(wo.title || clientLabel(wo))}">Excluir</button>` : `<a class="om-swipe__act--open" href="${detailHref}">Detalhe</a>`}
      </div>
      <div class="om-swipe__body jmx-card">
        <a class="jmx-card__a" href="${detailHref}">
          <b class="jmx-card__t">${escapeHtml(cardTitle(wo))}</b>
          ${wo.address ? `<span class="jmx-card__s jmx-card__addr"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${escapeHtml(wo.address)}</span></span>` : ""}
          ${J ? J.progHtml(wo) : ""}
        </a>
        <div class="jmx-card__r3">
          <span class="jmx-card__when">${escapeHtml(when)}</span>
          ${maps ? `<a class="jmx-b jmx-b--sq" href="${maps}" target="_blank" rel="noopener" aria-label="Mapa"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></a>` : ""}
          ${cta}
        </div>
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
    return `<article class="om-swipe jcm-job-swipe" data-job-id="${escapeHtml(wo.id)}" style="--job-accent:${escapeHtml(crewColor)}">
      <div class="om-swipe__actions" aria-hidden="true">
        <a class="om-swipe__act--edit" href="${openHref}">Abrir</a>
        <a class="om-swipe__act--open" href="${detailHref}">Detalhe</a>
      </div>
      <div class="om-swipe__body jcm-job jcm-job--field">
        <a class="jcm-job__body" href="${openHref}">
          <div class="jcm-job__top">
            <div class="jcm-job__when">
              <span class="jcm-job__day${today ? " is-today" : ""}">${escapeHtml(today ? "Hoje" : day || "Sem data")}</span>
              <span class="jcm-job__time">${escapeHtml(fmtTimeRange(wo.scheduled_start, wo.scheduled_end))}</span>
            </div>
            <span class="jcm-badge ${statusCls(wo.status)}">${escapeHtml(statusPt(wo.status))}</span>
          </div>
          <p class="jcm-job__title">${escapeHtml(cardTitle(wo))}</p>
          <p class="jcm-job__client">${escapeHtml(window.JobsInfo?.findLine ? window.JobsInfo.findLine(wo) : clientLabel(wo))}</p>
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
    const doneN = base.filter((wo) => wo.status === "completed" && !isPaidJob(wo)).length;
    const activeRows = base.filter((wo) => isActive(wo) && wo.status !== "canceled");
    const billN = base.filter(toBill).length;
    if (!tabChosen && tab === "today" && todayN === 0 && activeN > 0) tab = "active";
    const J = window.JobsInfo;
    const lateN = J ? base.filter((wo) => J.late(wo)).length : 0;

    const sub = $("jobsMobSub");
    if (sub) {
      if (isField) {
        sub.textContent =
          todayN > 0
            ? `${todayN} hoje · ${activeN} ativo${activeN === 1 ? "" : "s"}`
            : `${activeN} job${activeN === 1 ? "" : "s"} ativo${activeN === 1 ? "" : "s"}`;
      } else {
        sub.textContent = `${activeN} ativo${activeN === 1 ? "" : "s"} · ${money(contractTotal(activeRows))} em contratos`;
      }
    }
    const sum = $("jobsMobSum");
    if (sum) {
      sum.hidden = isField;
      const billTotal = base.reduce((t, wo) => t + (wo.status !== "canceled" && wo.billing && wo.billing.billing_status !== "no_value" ? wo.billing.remaining_to_invoice || 0 : 0), 0);
      const hasBill = base.some((wo) => wo.billing);
      sum.innerHTML = `<div><span>Ativos</span><b>${activeN}</b></div><div><span>Atrasados</span><b class="${lateN ? "is-hot" : ""}">${lateN}</b></div>${
        hasBill ? `<div><span>A faturar</span><b>${escapeHtml(compactMoney(billTotal))}</b></div>` : `<div><span>Em contratos</span><b>${escapeHtml(compactMoney(contractTotal(activeRows)))}</b></div>`
      }`;
    }

    document.querySelectorAll("[data-jobs-tab]").forEach((btn) => {
      const id = btn.getAttribute("data-jobs-tab");
      if (id === "bill") btn.hidden = isField || billN === 0;
      btn.classList.toggle("is-active", id === tab);
      const n = id === "today" ? todayN : id === "active" ? activeN : id === "bill" ? billN : doneN;
      const label = id === "today" ? "Hoje" : id === "active" ? "Ativos" : id === "bill" ? "A faturar" : "Concluídos";
      btn.innerHTML = `${label} <em>${n}</em>`;
    });

    document.querySelectorAll("[data-jobs-role]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-jobs-role") === role);
    });

    const rows = tabFiltered(base);
    const host = $("jobsMobList");
    if (!host) return;
    if (!rows.length) {
      const empty = mobQ
        ? `Nenhum job para “${escapeHtml(mobQ)}”. Abra o quote e use Abrir job.`
        : isField
          ? "Nenhum job atribuído a você neste filtro."
          : "Nenhum job neste filtro.";
      host.innerHTML = `<p class="jcm-empty">${empty}</p>`;
      return;
    }
    host.innerHTML = rows.map((wo) => (isField ? renderFieldCard(wo) : renderOfficeCard(wo))).join("");
    if (window.OmGestures) window.OmGestures.bindSwipeRow(host);

    host.querySelectorAll("[data-job-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-job-action");
        if (action === "edit" || action === "start-date") {
          if (window.__crmJobModal?.openEdit) window.__crmJobModal.openEdit(id);
          return;
        }
        if (action === "invoice") {
          const wo = allJobs.find((j) => String(j.id) === String(id));
          if (window.JobBilling?.openDialog && wo) {
            window.JobBilling.openDialog({ jobId: wo.id, billing: wo.billing, jobStatus: wo.status });
          } else {
            location.href = `job-detail.html?id=${encodeURIComponent(id)}&faturar=1`;
          }
          return;
        }
        updateStatus(id, action === "complete" ? "completed" : "in_progress");
      });
    });
    host.querySelectorAll("[data-job-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void deleteJob(btn.getAttribute("data-job-delete"), btn.getAttribute("data-job-label"), btn);
      });
    });
  }

  async function deleteJob(id, label, btn) {
    if (!id || !canManage) return;
    if (!confirm(`Excluir o job “${label || id}”?\n\nO job será cancelado e sai da lista ativa.`)) return;
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "…";
    }
    try {
      const r = await fetch(`/api/work-orders/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
      window.crmToast?.success?.("Job excluído.");
      await load();
    } catch (err) {
      window.crmToast?.error?.(err.message || "Não foi possível excluir");
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "Excluir";
      }
    }
  }

  async function updateStatus(id, status) {
    if (!canManage) {
      location.href = `job-detail.html?id=${encodeURIComponent(id)}`;
      return;
    }
    let doneToast = status === "completed" ? "Job concluído" : "Job iniciado";
    if (status === "completed") {
      const wo = allJobs.find((w) => String(w.id) === String(id));
      const nxt = wo && window.JobsInfo?.nextFinish ? window.JobsInfo.nextFinish(wo) : null;
      if (nxt?.toast) doneToast = nxt.toast;
      const label = wo?.title || (wo ? clientLabel(wo) : "");
      const ok = window.crmConfirm?.completeJob
        ? await window.crmConfirm.completeJob(label, nxt)
        : confirm(nxt?.confirm || "Marcar o job como concluído?");
      if (!ok) return;
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
      window.crmToast?.success?.(doneToast);
      await load();
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  async function load() {
    const seq = ++loadSeq;
    const query = mobQ.trim();
    const params = new URLSearchParams();
    if (query.length >= 2) params.set("q", query);
    if (focusId && query.length < 2) params.set("id", focusId);
    const j = await fetch(`/api/work-orders${params.toString() ? `?${params}` : ""}`, { credentials: "include" }).then((r) => r.json());
    if (seq !== loadSeq) return;
    if (!j.success && j.success !== undefined) throw new Error(j.error || "Erro");
    fetchedMobQuery = query.length >= 2 ? query.toLowerCase() : "";
    allJobs = j.data || [];
    if (focusId && !allJobs.some((wo) => String(wo.id) === String(focusId))) {
      try {
        const one = await fetch(`/api/work-orders/${encodeURIComponent(focusId)}`, { credentials: "include" }).then((r) => r.json());
        if (seq !== loadSeq) return;
        if (one?.data) allJobs = [one.data, ...allJobs];
      } catch (_) {}
    }
    render();
  }

  function bind() {
    $("jxStatusMob")?.addEventListener("change", (e) => {
      mobStatus = e.target.value || "";
      e.target.closest(".jx-sel")?.classList.toggle("is-on", !!mobStatus);
      render();
    });
    document.querySelectorAll("[data-jobs-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        tab = btn.getAttribute("data-jobs-tab") || "today";
        tabChosen = true;
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
      window.__crmJobModal?.openCreate({ allDay: true }).catch((e) => window.crmToast?.error?.(e.message || "Não foi possível abrir o job"));
    });
    $("jobsMobQ")?.addEventListener("input", (e) => {
      clearTimeout(e.target._t);
      mobQ = e.target.value.trim();
      render();
      e.target._t = setTimeout(() => {
        load().catch((err) => window.crmToast?.error?.(err.message || "Não foi possível buscar"));
      }, 250);
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!$("jobsMobile")) return;
    const opened = new URLSearchParams(location.search).get("id");
    if (opened) {
      focusId = opened;
      tab = "active";
      tabChosen = true;
    }
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
      canInvoice = roleName === "admin" || perms.includes("invoices.manage");
      isField =
        (window.__crmFieldGate && window.__crmFieldGate.isFieldRole(roleName)) ||
        roleName === "installer" || roleName === "subcontractor" ||
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
      if (window.OmGestures) {
        window.OmGestures.initPullToRefresh({
          key: "jobs",
          indicator: "#jobsPtr",
          refresh: () => load(),
        });
        window.OmGestures.ensureDockPadding("#jobsMobile, #jobsMobList");
      }
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
