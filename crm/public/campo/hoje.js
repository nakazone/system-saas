/**
 * Campo · Hoje — ponto ao vivo (Fase 2 API) + fallback mock
 */
(function () {
  const VER = "20260925-campo2";
  const M = window.__campoMock;
  const $ = (id) => document.getElementById(id);

  let state = null; // /api/campo/hoje payload
  let useMock = false;
  let timerId = null;
  let basePaidMs = 0;
  let baseAt = 0;
  let paused = false;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mapsUrl(address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(address || "")}`;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatHms(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
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
    if (status === "en_route") return "cm-badge--progress";
    if (status === "in_progress") return "cm-badge--progress";
    return "cm-badge--sched";
  }

  function formatDayMeta(d) {
    if (M && M.formatDayMeta) return M.formatDayMeta(d);
    return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" });
  }

  function greeting(now) {
    if (M && M.greeting) return M.greeting(now);
    const h = now.getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...opts,
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

  function syncTimerFromPonto(ponto) {
    paused = Boolean(ponto?.paused);
    basePaidMs = Number(ponto?.paid_ms) || 0;
    baseAt = Date.now();
  }

  function currentPaidMs() {
    if (paused || !state?.ponto?.open) return basePaidMs;
    return basePaidMs + Math.max(0, Date.now() - baseAt);
  }

  function tickTimer() {
    const el = $("cmTimer");
    if (!el) return;
    if (!state?.ponto?.open && !useMock) {
      el.textContent = formatHms(basePaidMs);
      return;
    }
    el.textContent = formatHms(currentPaidMs());
  }

  function renderHeader() {
    const now = new Date();
    const u = state?.user || M?.user || { initials: "?", first_name: "", firstName: "", team: "" };
    const first = u.first_name || u.firstName || "";
    $("cmAvatar").textContent = u.initials || "?";
    $("cmGreet").textContent = `${greeting(now)}${first ? `, ${first}` : ""}`;
    $("cmMeta").textContent = `${u.team || "Equipe"} · ${formatDayMeta(now)}`;
  }

  function renderPonto() {
    const ponto = state?.ponto;
    const open = Boolean(ponto?.open);
    const cur = ponto?.current;
    const endBtn = $("cmEndBtn");
    const pauseBtn = $("cmPauseBtn");
    const trocarBtn = $("cmTrocarBtn");
    const clockInBtn = $("cmClockInBtn");

    if (clockInBtn) clockInBtn.hidden = open;
    if (pauseBtn) pauseBtn.hidden = !open;
    if (endBtn) endBtn.hidden = !open;
    if (trocarBtn) trocarBtn.disabled = !open;

    if (!open) {
      $("cmEntrada").textContent = ponto?.clock_in_label
        ? `Encerrado · entrada ${ponto.clock_in_label}`
        : "Sem turno hoje";
      $("cmStatusTitle").textContent = ponto?.shift ? "Dia encerrado" : "Fora de ponto";
      $("cmStatusSub").textContent = "Toque em Iniciar dia para bater o ponto";
      $("cmStatusDot").className = "cm-ponto__status-dot cm-ponto__status-dot--pause";
      tickTimer();
      return;
    }

    $("cmEntrada").textContent = `Entrada ${ponto.clock_in_label || "—"}`;
    const kind = cur?.activity_kind || "on_site";
    $("cmStatusDot").className =
      kind === "break"
        ? "cm-ponto__status-dot cm-ponto__status-dot--pause"
        : kind === "travel"
          ? "cm-ponto__status-dot cm-ponto__status-dot--travel"
          : kind === "shopping"
            ? "cm-ponto__status-dot cm-ponto__status-dot--shop"
            : "cm-ponto__status-dot";
    $("cmStatusTitle").textContent = cur?.label || "—";
    if (kind === "on_site" && cur?.work_order) {
      const wo = cur.work_order;
      $("cmStatusSub").textContent = `#${wo.number ?? "—"} ${wo.client_short || ""} · desde ${cur.since_label || ""}`;
    } else {
      $("cmStatusSub").textContent = cur
        ? kind === "break"
          ? "Não conta no total"
          : `desde ${cur.since_label || ""}`
        : "—";
    }
    if (pauseBtn) pauseBtn.textContent = ponto.paused ? "Retomar" : "Pausa";
    tickTimer();
  }

  function renderHere() {
    const card = $("cmHereCard");
    const ponto = state?.ponto;
    const cur = ponto?.current;
    const wo =
      cur?.work_order ||
      (state?.jobs || []).find((j) => j.status === "on_site") ||
      (state?.jobs || [])[0];

    if (!ponto?.open || !wo || cur?.activity_kind === "break") {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    const start = wo.start || (cur?.work_order ? null : wo.start);
    const end = wo.end;
    $("cmHereTime").textContent =
      start && end ? `${start} – ${end}` : start || "Sem horário";
    $("cmHereTitle").textContent = wo.title || "Obra";
    $("cmHereClient").textContent = `#${wo.number ?? "—"} · ${wo.client || wo.client_short || "—"}`;
    $("cmHereAddrText").textContent = wo.address || "Sem endereço";
    $("cmNavBtn").href = wo.address ? mapsUrl(wo.address) : "#";
    $("cmOpenTicket").href = `ticket.html?id=${encodeURIComponent(wo.id)}`;
  }

  function renderDayList() {
    const list = $("cmDayList");
    const rows = state?.jobs || [];
    if (!rows.length) {
      list.innerHTML =
        '<p class="cm-subtitle" style="margin:0.25rem 0">Nenhuma obra sua para hoje.</p>';
      return;
    }
    list.innerHTML = rows
      .map((j) => {
        const badge = statusLabel(j.status);
        const cls = statusBadgeClass(j.status);
        const start = j.start || "—";
        const end = j.end || "";
        return `
        <a class="cm-day-row" href="ticket.html?id=${encodeURIComponent(j.id)}">
          <div class="cm-day-row__times">
            <span>${escapeHtml(start)}</span>
            <span>${escapeHtml(end)}</span>
          </div>
          <div>
            <p class="cm-day-row__title">${escapeHtml(j.title)}</p>
            <p class="cm-day-row__sub">#${j.number ?? "—"} · ${escapeHtml(j.client)}</p>
          </div>
          <span class="cm-badge ${cls}">${badge}</span>
        </a>`;
      })
      .join("");
  }

  function selectedActivityId() {
    const cur = state?.ponto?.current;
    if (!cur) return null;
    if (cur.activity_kind === "on_site" && cur.work_order_id) {
      return `on_site:${cur.work_order_id}`;
    }
    return cur.activity_kind;
  }

  function renderActivityList() {
    const activities = state?.activities || [];
    const selected = selectedActivityId();
    const colors = {
      on_site: "var(--cm-green)",
      travel: "var(--cm-blue)",
      shopping: "var(--cm-orange)",
      break: "#a8a29e",
    };
    $("cmActivityList").innerHTML = activities
      .map((a) => {
        const sel = a.id === selected ? " is-selected" : "";
        return `
        <button type="button" class="cm-activity${sel}"
          data-kind="${escapeHtml(a.activity_kind)}"
          data-wo="${a.work_order_id ? escapeHtml(a.work_order_id) : ""}">
          <span class="cm-activity__dot" style="background:${colors[a.activity_kind] || "#a8a29e"}"></span>
          <span>
            <p class="cm-activity__title">${escapeHtml(a.title)}</p>
            <p class="cm-activity__sub">${escapeHtml(a.sub)}</p>
          </span>
        </button>`;
      })
      .join("");
  }

  function openSheet() {
    if (!state?.ponto?.open) return;
    renderActivityList();
    $("cmSheetBackdrop").hidden = false;
    $("cmActivitySheet").hidden = false;
    document.body.classList.add("cm-sheet-open");
  }

  function closeSheet() {
    $("cmSheetBackdrop").hidden = true;
    $("cmActivitySheet").hidden = true;
    document.body.classList.remove("cm-sheet-open");
  }

  function applyPayload(data) {
    state = data;
    useMock = false;
    syncTimerFromPonto(data.ponto);
    renderHeader();
    renderPonto();
    renderHere();
    renderDayList();
  }

  function toast(msg) {
    if (window.crmToast?.show) window.crmToast.show(msg, { type: "error" });
    else alert(msg);
  }

  async function postPonto(path, body) {
    const json = await api(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : "{}",
    });
    if (json.data) applyPayload(json.data);
    closeSheet();
  }

  function bind() {
    $("cmTrocarBtn")?.addEventListener("click", openSheet);
    $("cmSheetClose")?.addEventListener("click", closeSheet);
    $("cmSheetBackdrop")?.addEventListener("click", closeSheet);
    $("cmActivityList")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-kind]");
      if (!btn) return;
      const kind = btn.getAttribute("data-kind");
      const wo = btn.getAttribute("data-wo") || null;
      try {
        await postPonto("/api/campo/ponto/switch", {
          activity_kind: kind,
          work_order_id: wo || null,
        });
      } catch (err) {
        toast(err.message || "Falha ao trocar atividade");
      }
    });
    $("cmPauseBtn")?.addEventListener("click", async () => {
      try {
        if (state?.ponto?.paused) await postPonto("/api/campo/ponto/resume");
        else await postPonto("/api/campo/ponto/pause");
      } catch (err) {
        toast(err.message || "Falha na pausa");
      }
    });
    $("cmEndBtn")?.addEventListener("click", async () => {
      if (!confirm("Encerrar o dia? O ponto será fechado.")) return;
      try {
        await postPonto("/api/campo/ponto/clock-out");
      } catch (err) {
        toast(err.message || "Falha ao encerrar");
      }
    });
    $("cmClockInBtn")?.addEventListener("click", async () => {
      try {
        const firstJob = (state?.jobs || [])[0];
        await postPonto("/api/campo/ponto/clock-in", {
          activity_kind: firstJob ? "on_site" : "travel",
          work_order_id: firstJob?.id || null,
        });
      } catch (err) {
        toast(err.message || "Falha ao iniciar dia");
      }
    });
  }

  function fallbackMock() {
    useMock = true;
    if (!M) return;
    const user = M.user;
    const shift = M.openShift();
    const act = M.activities[shift.activityId];
    const jobs = M.buildTodayJobs();
    state = {
      user: {
        id: user.id,
        name: user.name,
        first_name: user.firstName,
        initials: user.initials,
        team: user.team,
      },
      ponto: {
        open: true,
        clock_in_label: shift.clockInLabel,
        paid_ms: M.elapsedPaidMs(shift),
        paused: false,
        current: {
          activity_kind: act.kind,
          label: act.label,
          since_label: shift.activitySinceLabel,
          work_order_id: act.workOrderId,
          work_order: jobs[0]
            ? {
                id: jobs[0].id,
                number: jobs[0].number,
                title: jobs[0].title,
                address: jobs[0].address,
                client: jobs[0].client,
                client_short: jobs[0].clientShort,
              }
            : null,
        },
      },
      jobs: jobs.map((j) => ({
        id: j.id,
        number: j.number,
        title: j.title,
        client: j.client,
        client_short: j.clientShort,
        address: j.address,
        start: j.start,
        end: j.end,
        status: j.status,
        team: j.team,
      })),
      activities: Object.values(M.activities).map((a) => ({
        id: a.id,
        activity_kind: a.kind,
        label: a.label,
        title: a.title,
        sub: a.sub,
        work_order_id: a.workOrderId,
      })),
    };
    syncTimerFromPonto(state.ponto);
    renderHeader();
    renderPonto();
    renderHere();
    renderDayList();
  }

  async function init() {
    bind();
    // Clock-in button is in HTML
    try {
      const json = await api("/api/campo/hoje");
      applyPayload(json.data);
    } catch (err) {
      console.warn("[campo/hoje]", err);
      fallbackMock();
    }

    timerId = setInterval(tickTimer, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoHoje = { VER, refresh: init };
})();
