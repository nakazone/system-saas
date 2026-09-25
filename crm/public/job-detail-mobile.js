/**
 * Job detail mobile overlay.
 */
(function () {
  const ROLE_KEY = "om_jobs_role";
  let job = null;
  let canManage = false;
  let jobId = null;
  let detTab = "visitas";

  const $ = (id) => document.getElementById(id);

  function isMobile() {
    return window.__omDevice && typeof window.__omDevice.isMobile === "function"
      ? window.__omDevice.isMobile()
      : false;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function clientLabel(wo) {
    return wo.customer?.name || wo.builder?.company || wo.builder?.name || wo.source_name || "—";
  }

  function teamLabel(wo) {
    const parts = [];
    if (wo.crew?.name) parts.push(wo.crew.name);
    if (wo.assigned_user?.name) parts.push(wo.assigned_user.name);
    (wo.members || []).forEach((m) => {
      if (m.name && !parts.includes(m.name)) parts.push(m.name);
    });
    return parts.join(", ") || "Sem equipe";
  }

  function fmtDay(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function fmtTimeRange(start, end) {
    if (!start) return "";
    const s = new Date(start);
    const pad = (n) => String(n).padStart(2, "0");
    const a = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
    if (!end) return a;
    const e = new Date(end);
    return `${a} – ${pad(e.getHours())}:${pad(e.getMinutes())}`;
  }

  function sqftTotal(wo) {
    const items = wo.line_items || [];
    const sum = items.reduce((s, it) => s + (Number(it.quantity_sqft) || 0), 0);
    return sum > 0 ? `${Math.round(sum)} sq ft` : "";
  }

  function buildTimeline(wo) {
    const title = wo.title || "Visita";
    const start = wo.scheduled_start;
    const end = wo.scheduled_end;
    const steps = [];
    if (wo.status === "completed") {
      steps.push({ title, meta: fmtDay(end || start), state: "done" });
    } else if (wo.status === "in_progress") {
      steps.push({
        title,
        meta: `${fmtDay(start)}${start ? ` · ${fmtTimeRange(start, end)} · hoje` : ""}`,
        state: "current",
      });
      steps.push({ title: "Vistoria final", meta: "A agendar", state: "upcoming" });
    } else if (start) {
      steps.push({
        title,
        meta: `${fmtDay(start)} · ${fmtTimeRange(start, end)}`,
        state: "current",
      });
      steps.push({ title: "Vistoria final", meta: "A agendar", state: "upcoming" });
    } else {
      steps.push({ title: "Agendar visita", meta: "Sem data", state: "upcoming" });
    }
    (wo.line_items || []).slice(0, 3).forEach((it, i) => {
      if (!it.service_name) return;
      steps.push({
        title: it.service_name,
        meta: it.quantity_sqft ? `${it.quantity_sqft} sq ft` : "",
        state: wo.status === "completed" ? "done" : i === 0 && !start ? "current" : "upcoming",
      });
    });
    return steps.slice(0, 5);
  }

  function render() {
    if (!job || !$("jobMobRoot")) return;
    const wo = job;
    $("jobMobId").textContent = `Job #${wo.number != null ? wo.number : "—"}`;
    const badge = $("jobMobStatus");
    badge.textContent = statusPt(wo.status);
    badge.className = `jcm-badge ${statusCls(wo.status)}`;
    $("jobMobName").textContent = clientLabel(wo);
    const typeBits = [wo.title, sqftTotal(wo)].filter(Boolean).join(" · ");
    $("jobMobType").textContent = typeBits || "—";

    const addr = wo.address || "—";
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "#";
    $("jobMobAddr").textContent = addr;
    $("jobMobTeam").textContent = teamLabel(wo);
    $("jobMobMapQuick").href = maps;
    const phone = wo.customer?.phone || "";
    $("jobMobCallQuick").href = phone ? `tel:${phone}` : "customers.html";
    $("jobMobNotesQuick").href = `#`;

    const steps = buildTimeline(wo);
    $("jobMobTimeline").innerHTML = steps
      .map((st, i) => {
        const cls = st.state === "done" ? "is-done" : st.state === "current" ? "is-current" : "";
        return `<div class="jcm-tl ${cls}">
          <div class="jcm-tl__rail"><span class="jcm-tl__dot"></span><span class="jcm-tl__line"></span></div>
          <div>
            <p class="jcm-tl__title">${escapeHtml(st.title)}</p>
            <p class="jcm-tl__meta">${escapeHtml(st.meta || "")}</p>
          </div>
        </div>`;
      })
      .join("");

    const notes = (wo.notes || "").trim();
    $("jobMobInstr").hidden = !notes;
    $("jobMobInstrBody").textContent = notes;

    const cta = $("jobMobCta");
    const foot = $("jobMobFoot");
    foot.classList.add("is-visible", "jcm-foot--single");
    if (wo.status === "in_progress") {
      cta.textContent = "Concluir visita";
      cta.className = "jcm-foot__btn jcm-foot__btn--ink";
      cta.dataset.action = "complete";
    } else if (wo.status === "completed") {
      cta.textContent = "Ver no Schedule";
      cta.className = "jcm-foot__btn jcm-foot__btn--ghost";
      cta.dataset.action = "schedule";
    } else {
      cta.textContent = "Iniciar visita";
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "start";
    }

    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-jd-tab") === detTab);
    });
    $("jobMobVisitas").hidden = detTab !== "visitas";
    $("jobMobExtra").hidden = detTab === "visitas";
    if (detTab === "checklist") {
      $("jobMobExtra").innerHTML = `<p class="jcm-empty">Checklist em breve.</p>`;
    } else if (detTab === "fotos") {
      $("jobMobExtra").innerHTML = `<p class="jcm-empty">Fotos em breve.</p>`;
    } else if (detTab === "financeiro") {
      const total = Number(wo.services_total) || 0;
      $("jobMobExtra").innerHTML = `<div class="jcm-card"><div class="jcm-dl">
        <div class="jcm-dl__row"><span class="jcm-dl__k">Serviços</span><span class="jcm-dl__v">${escapeHtml(
          String(total ? `$${total.toFixed(2)}` : "—"),
        )}</span></div>
      </div></div>`;
    }
  }

  async function setStatus(status) {
    if (!canManage || !jobId) return;
    const r = await fetch(`/api/work-orders/${jobId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || "Erro");
    job = j.data;
    render();
  }

  function bind() {
    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detTab = btn.getAttribute("data-jd-tab") || "visitas";
        render();
      });
    });
    document.querySelectorAll("[data-jobs-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-jobs-role") || "office";
        try {
          localStorage.setItem(ROLE_KEY, role);
        } catch (_) {}
        document.querySelectorAll("[data-jobs-role]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-jobs-role") === role);
        });
      });
    });
    $("jobMobCta")?.addEventListener("click", async () => {
      const action = $("jobMobCta").dataset.action;
      try {
        if (action === "start") {
          await setStatus("in_progress");
          window.crmToast?.success?.("Visita iniciada");
        } else if (action === "complete") {
          await setStatus("completed");
          window.crmToast?.success?.("Visita concluída");
        } else if (action === "schedule") {
          location.href = "schedule.html";
        }
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro");
      }
    });
    $("jobMobNotesQuick")?.addEventListener("click", (e) => {
      e.preventDefault();
      $("jobMobInstr")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!$("jobMobRoot")) return;
    jobId = new URLSearchParams(location.search).get("id");
    if (!jobId) return;
    try {
      const role = localStorage.getItem(ROLE_KEY) === "installer" ? "installer" : "office";
      document.querySelectorAll("[data-jobs-role]").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-jobs-role") === role);
      });
    } catch (_) {}
    try {
      const s = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json());
      if (!s.authenticated) return;
      const roleName = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      canManage = roleName === "admin" || perms.includes("work_orders.manage");
      const j = await fetch(`/api/work-orders/${jobId}`, { credentials: "include" }).then((r) => r.json());
      if (!j.success && j.success !== undefined) throw new Error(j.error || "Erro");
      job = j.data;
      bind();
      render();
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
