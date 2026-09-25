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
    if (!jobs.length) {
      list.innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0">Nenhuma visita neste dia.</p>';
      return;
    }
    list.innerHTML = jobs
      .map((j) => {
        const st = statusLabel(j.status);
        const cls = statusBadgeClass(j.status);
        return `
        <a class="cm-job-card" href="ticket.html?id=${encodeURIComponent(j.id)}">
          <div class="cm-job-card__top">
            <p class="cm-job-card__time">${escapeHtml(j.start || "—")}${j.end ? ` – ${escapeHtml(j.end)}` : ""}</p>
            <span class="cm-badge ${cls}">${st}</span>
          </div>
          <p class="cm-job-card__title">${escapeHtml(j.title)}</p>
          <p class="cm-job-card__sub">#${j.number ?? "—"} · ${escapeHtml(j.client)}${j.address ? ` · ${escapeHtml(j.address)}` : ""}</p>
          ${
            j.team
              ? `<p class="cm-job-card__team">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            ${escapeHtml(j.team)}
          </p>`
              : ""
          }
        </a>`;
      })
      .join("");
  }

  async function load() {
    const q = new URLSearchParams();
    if (weekStartYmd) q.set("week", weekStartYmd);
    if (selectedYmd) q.set("day", selectedYmd);
    const json = await api(`/api/campo/agenda?${q}`);
    render(json.data);
  }

  function shiftWeek(delta) {
    if (!weekStartYmd) return;
    const d = new Date(weekStartYmd + "T12:00:00");
    d.setDate(d.getDate() + delta * 7);
    weekStartYmd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    selectedYmd = weekStartYmd;
    load().catch((e) => alert(e.message || "Falha ao carregar"));
  }

  function bind() {
    $("cmWeekPrev")?.addEventListener("click", () => shiftWeek(-1));
    $("cmWeekNext")?.addEventListener("click", () => shiftWeek(1));
    $("cmWeekStrip")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ymd]");
      if (!btn) return;
      selectedYmd = btn.getAttribute("data-ymd");
      load().catch((err) => alert(err.message || "Falha"));
    });
  }

  async function init() {
    bind();
    try {
      await load();
    } catch (err) {
      console.warn("[campo/agenda]", err);
      // soft fallback empty
      $("cmWeekLabel").textContent = "Agenda indisponível";
      $("cmAgendaList").innerHTML =
        '<p class="cm-subtitle">Não foi possível carregar. Tente de novo.</p>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoAgenda = { VER };
})();
