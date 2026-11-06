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
      scheduled: "Agendado",
      done: "Concluído",
      completed: "Concluído",
      in_progress: "Installing",
      canceled: "Cancelado",
    };
    return map[status] || status || "—";
  }

  function statusTone(j) {
    const raw = String(j.raw_status || "");
    const s = raw || String(j.status || j.field_status || "");
    if (s === "completed" || s === "done" || s === "canceled") return "ok";
    if (s === "in_progress") return "act";
    return "wait";
  }

  function statusText(j) {
    if (j.field_status_label) return j.field_status_label;
    if (window.JobsInfo?.crewStageLabel) {
      return window.JobsInfo.crewStageLabel({
        status: j.raw_status || (j.status === "done" ? "completed" : j.status),
        sector: j.sector,
        installation_done_at: j.installation_done_at,
        sand_done_at: j.sand_done_at,
        scheduled_start: j.scheduled_start,
        sand_scheduled_start: j.sand_scheduled_start,
      });
    }
    return statusLabel(j.raw_status || j.status);
  }

  function formatDayMeta(ymd) {
    const d = new Date(ymd + "T12:00:00");
    if (M && M.formatDayMeta) return M.formatDayMeta(d);
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" });
  }

  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function todayYmdLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  /** Same ObraCam / ObraCrew Jobs card: day · client · address · status/hora · mapa. */
  function crewCardHtml(j) {
    const who = j.homeowner_name || (j.client && j.client !== "—" ? j.client : "") || j.title || "Job";
    const iso = j.scheduled_start || null;
    const finished =
      j.status === "completed" || j.status === "done" || j.status === "canceled" || j.field_status === "completed";
    const isTodayChip = Boolean(selectedYmd && selectedYmd === todayYmdLocal());
    let dayHtml = `<span class="jx-day is-none" aria-hidden="true"><small>sem</small><b>—</b><small>data</small></span>`;
    let time = "";
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        const wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
        const tone =
          !finished && (isTodayChip || j.status === "in_progress" || j.status === "on_site")
            ? " is-now"
            : finished
              ? " is-done"
              : "";
        dayHtml = `<span class="jx-day${tone}" aria-label="${isTodayChip ? "Hoje" : `${wd} ${d.getDate()} ${MO[d.getMonth()]}`}"><small>${isTodayChip ? "hoje" : wd}</small><b>${d.getDate()}</b><small>${MO[d.getMonth()]}</small></span>`;
        if (!finished && !(d.getHours() === 0 && d.getMinutes() === 0)) {
          time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        }
      }
    }
    const maps = j.address ? `https://maps.google.com/?q=${encodeURIComponent(j.address)}` : "";
    const st = statusText(j);
    const tone = statusTone(j);
    const mapPin =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
    return `<div class="crew-job">
      <a class="crew-job__main" data-om-press href="ticket.html?id=${encodeURIComponent(j.id)}">
        ${dayHtml}
        <div class="crew-job__copy">
          <b class="crew-job__title">${escapeHtml(who)}</b>
          <span class="crew-job__addr">${escapeHtml(j.address || "Sem endereço")}</span>
          <span class="crew-job__meta">
            ${st ? `<span class="ol-st is-${tone}">${escapeHtml(st)}</span>` : ""}
            ${time ? `<span class="crew-job__clock">${escapeHtml(time)}</span>` : ""}
          </span>
        </div>
      </a>
      ${
        maps
          ? `<a class="crew-job__map" href="${escapeHtml(maps)}" target="_blank" rel="noopener" aria-label="Abrir mapa">${mapPin}</a>`
          : `<span class="crew-job__map is-off" aria-hidden="true">${mapPin}</span>`
      }
    </div>`;
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
        ? `<button type="button" class="cm-btn cm-btn--dark cm-btn--sm" id="cmDayRoute" data-om-press style="width:100%">Ver rota do dia</button>`
        : "") +
      jobs.map(crewCardHtml).join("");
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
