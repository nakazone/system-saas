/**
 * Campo · Agenda — week API (Fase 3)
 */
(function () {
  const VER = "20260925-campo3";
  const M = window.__campoMock;
  const $ = (id) => document.getElementById(id);

  let weekStartYmd = null;
  let selectedYmd = null;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusLabel(status) {
    const map = {
      on_site: "No local",
      scheduled: "Agendada",
      en_route: "A caminho",
      done: "Concluída",
      in_progress: "Em andamento",
    };
    return map[status] || status || "—";
  }

  function statusBadgeClass(status) {
    if (status === "on_site") return "cm-badge--site";
    if (status === "en_route" || status === "in_progress") return "cm-badge--progress";
    return "cm-badge--sched";
  }

  function formatDayMeta(ymd) {
    const d = new Date(ymd + "T12:00:00");
    if (M && M.formatDayMeta) return M.formatDayMeta(d);
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" });
  }

  async function api(path) {
    if (window.OmOffline && typeof window.OmOffline.api === "function") {
      return window.OmOffline.api(path, { credentials: "same-origin" });
    }
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  function render(data) {
    weekStartYmd = data.week_start;
    selectedYmd = data.selected_day;
    $("cmWeekLabel").textContent = `Esta semana · ${data.range_label}`;

    $("cmWeekStrip").innerHTML = (data.days || [])
      .map((d) => {
        const active = d.ymd === selectedYmd ? " is-active" : "";
        const dots = (d.dots || [])
          .map(
            (t) =>
              `<span class="cm-day-chip__dot${t === "orange" ? " cm-day-chip__dot--warn" : ""}"></span>`,
          )
          .join("");
        return `
        <button type="button" class="cm-day-chip${active}" data-ymd="${d.ymd}" role="tab" aria-selected="${d.ymd === selectedYmd}">
          <span class="cm-day-chip__name">${escapeHtml(d.label)}</span>
          <span class="cm-day-chip__num">${d.day_num}</span>
          <span class="cm-day-chip__dots">${dots}</span>
        </button>`;
      })
      .join("");

    const today = data.days?.find((d) => d.is_today)?.ymd;
    const heading =
      selectedYmd === today
        ? `Hoje · ${formatDayMeta(selectedYmd)}`
        : formatDayMeta(selectedYmd);
    $("cmDayHeading").textContent = heading;

    const jobs = data.jobs || [];
    const list = $("cmAgendaList");
    // The route panel script loads on the first tap (campo-nav.js?v=20261105-field1 → loadDayRoute).
    const canRoute = jobs.some((j) => j.address || j.delivery_pickup_address);
    if (!jobs.length) {
      list.innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0">Nenhuma visita neste dia.</p>';
      return;
    }
    list.innerHTML =
      (canRoute
        ? `<button type="button" class="cm-btn cm-btn--dark cm-btn--sm" id="cmDayRoute" data-om-press style="width:100%;margin:0 0 0.75rem">Ver rota do dia</button>`
        : "") +
      jobs
        .map((j) => {
          const st = statusLabel(j.status);
          const cls = statusBadgeClass(j.status);
          const who = j.client || j.title || "Job";
          return `
        <a class="cm-job-card" data-om-press href="ticket.html?id=${encodeURIComponent(j.id)}">
          <div class="cm-job-card__top">
            <p class="cm-job-card__time">${escapeHtml(j.start || "—")}${j.end ? ` – ${escapeHtml(j.end)}` : ""}</p>
            <span class="cm-badge ${cls}">${st}</span>
          </div>
          <p class="cm-job-card__title">${escapeHtml(who)}</p>
          <p class="cm-job-card__sub">${escapeHtml(j.address || "Sem endereço")}</p>
        </a>`;
        })
        .join("");
    $("cmDayRoute")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const UI = window.OmUI;
      if (UI) UI.busy(btn, true);
      try {
        const route = window.__campoNav && window.__campoNav.loadDayRoute ? await window.__campoNav.loadDayRoute() : window.__crmDayRoute;
        if (!route) throw new Error("Não deu para abrir a rota agora.");
        route.open({
          title: "Rota do dia",
          subtitle: $("cmDayHeading")?.textContent || "",
          origin: window.__campoRouteStart || "",
          stops: route.stopsFromCampoJobs(jobs),
          onSaveOrigin: (addr) => {
            window.__campoRouteStart = addr || "";
          },
        });
      } catch (err) {
        if (window.crmToast) window.crmToast.error((err && err.message) || "Não deu para abrir a rota agora.");
      } finally {
        if (UI && btn.isConnected) UI.busy(btn, false);
      }
    });
  }

  async function load() {
    const q = new URLSearchParams();
    if (weekStartYmd) q.set("week", weekStartYmd);
    if (selectedYmd) q.set("day", selectedYmd);
    const json = await api(`/api/campo/agenda?${q}`);
    render(json.data);
    try {
      const jobs = (json.data && json.data.jobs) || [];
      const ids = jobs.map((j) => j.id || j.work_order_id).filter(Boolean);
      if (window.OmOffline && ids.length) {
        window.OmOffline.warm(ids.slice(0, 12).map((id) => `/api/campo/jobs/${encodeURIComponent(id)}`));
      }
    } catch (_) {}
  }

  /** Reload with a skeleton in the list; on failure an inline error with "Tentar de novo". */
  async function reload() {
    const list = $("cmAgendaList");
    const sk = window.crmSkeleton;
    if (list && sk) sk.fill(list, "rows", 3, { avatar: false });
    try {
      await load();
      if (list && sk) sk.done(list);
    } catch (err) {
      console.warn("[campo/agenda]", err);
      if (list && sk) sk.error(list, (err && err.message) || "Não foi possível carregar a agenda.", reload);
      else if (window.crmToast) window.crmToast.error((err && err.message) || "Não foi possível carregar a agenda.");
    }
  }

  function shiftWeek(delta) {
    if (!weekStartYmd) return;
    const d = new Date(weekStartYmd + "T12:00:00");
    d.setDate(d.getDate() + delta * 7);
    weekStartYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    selectedYmd = weekStartYmd;
    void reload();
  }

  function bind() {
    $("cmWeekPrev")?.addEventListener("click", () => shiftWeek(-1));
    $("cmWeekNext")?.addEventListener("click", () => shiftWeek(1));
    $("cmWeekStrip")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ymd]");
      if (!btn) return;
      selectedYmd = btn.getAttribute("data-ymd");
      void reload();
    });
  }

  async function init() {
    bind();
    try {
      const sess = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json());
      window.__campoRouteStart = (sess && sess.user && sess.user.route_start_address) || "";
    } catch (_) {
      window.__campoRouteStart = "";
    }
    const list = $("cmAgendaList");
    const sk = window.crmSkeleton;
    if (list && sk && !list.children.length) sk.fill(list, "rows", 3, { avatar: false });
    try {
      await load();
      if (list && sk) sk.done(list);
    } catch (err) {
      console.warn("[campo/agenda]", err);
      // soft fallback empty
      $("cmWeekLabel").textContent = "Agenda indisponível";
      if (list && sk) sk.error(list, "Não foi possível carregar a agenda.", reload);
      else list.innerHTML = '<p class="cm-subtitle">Não foi possível carregar. Tente de novo.</p>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoAgenda = { VER };
})();
