/**
 * Campo · Hoje — diária + extras + próximos pagamentos
 */
(function () {
  const VER = "20260925-campo5";
  const M = window.__campoMock;
  const $ = (id) => document.getElementById(id);

  let state = null;
  let busy = false;

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

  function toast(msg, type) {
    if (window.crmToast?.show) window.crmToast.show(msg, { type: type || "error" });
    else if (type === "success") alert(msg);
    else alert(msg);
  }

  function renderHeader() {
    const now = new Date();
    const u = state?.user || M?.user || { initials: "?", first_name: "", firstName: "", team: "" };
    const first = u.first_name || u.firstName || "";
    $("cmAvatar").textContent = u.initials || "?";
    $("cmGreet").textContent = `${greeting(now)}${first ? `, ${first}` : ""}`;
    $("cmMeta").textContent = `${u.team || "Equipe"} · ${formatDayMeta(now)}`;
  }

  function renderFolha() {
    const f = state?.folha;
    const btn = $("cmAddDiariaBtn");
    const hint = $("cmDiariaHint");
    const minus = $("cmExtraMinus");
    const plus = $("cmExtraPlus");

    if (!f || !f.linked) {
      $("cmDiariaPeriod").textContent = "Folha";
      $("cmDiariaAmount").textContent = "—";
      $("cmDiariaStatus").textContent = f?.message || "Conta não vinculada à folha";
      $("cmDiariaChipVal").textContent = "—";
      $("cmExtraVal").textContent = "—";
      $("cmExtraMid").textContent = "—";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Diária indisponível";
      }
      if (minus) minus.disabled = true;
      if (plus) plus.disabled = true;
      if (hint) {
        hint.hidden = false;
        hint.textContent = f?.message || "Peça ao escritório para vincular seu usuário ao funcionário da folha.";
      }
      return;
    }

    const today = f.today || {};
    const period = f.period;
    $("cmDiariaPeriod").textContent = period ? period.label : "Sem período";
    $("cmDiariaAmount").textContent = today.amount_label || "$0.00";
    $("cmDiariaStatus").textContent = today.has_diaria
      ? today.overtime_hours > 0
        ? `Diária + ${today.overtime_label} extras`
        : "Diária lançada"
      : today.overtime_hours > 0
        ? `Só extras · ${today.overtime_label}`
        : "Sem lançamento ainda";

    const chip = $("cmDiariaChip");
    $("cmDiariaChipVal").textContent = today.has_diaria ? "Lançada" : "Pendente";
    if (chip) chip.classList.toggle("is-done", Boolean(today.has_diaria));

    $("cmExtraVal").textContent = today.overtime_label || "0 min";
    $("cmExtraMid").textContent = today.overtime_label || "0 min";

    const can = Boolean(f.can_edit);
    if (btn) {
      btn.disabled = !can || today.has_diaria || busy;
      btn.textContent = today.has_diaria ? "Diária já lançada" : "Adicionar diária inteira";
    }
    if (minus) minus.disabled = !can || busy || !(today.overtime_hours > 0);
    if (plus) plus.disabled = !can || busy;

    if (hint) {
      if (f.message) {
        hint.hidden = false;
        hint.textContent = f.message;
      } else if (f.employee) {
        hint.hidden = false;
        hint.textContent = `Diária ${f.employee.daily_rate_label} · Extra ${f.employee.overtime_rate_label}/h`;
      } else {
        hint.hidden = true;
      }
    }
  }

  function renderPayments() {
    const list = $("cmPayList");
    if (!list) return;
    const rows = state?.payments || state?.folha?.payments || [];
    if (!rows.length) {
      list.innerHTML =
        '<p class="cm-pay__empty">Nenhum pagamento previsto. Quando o escritório abrir um período, ele aparece aqui.</p>';
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        const tone =
          p.pay_status === "paid"
            ? "cm-pay__card--paid"
            : p.pay_status === "due"
              ? "cm-pay__card--due"
              : "cm-pay__card--open";
        return `
        <article class="cm-pay__card ${tone}">
          <div class="cm-pay__card-top">
            <p class="cm-pay__card-label">${escapeHtml(p.label)}</p>
            <span class="cm-pay__badge">${escapeHtml(p.status_label)}</span>
          </div>
          <p class="cm-pay__card-amount">${escapeHtml(p.amount_label)}</p>
          <p class="cm-pay__card-meta">${escapeHtml(p.range_label)} · ${escapeHtml(p.hint || "")}</p>
        </article>`;
      })
      .join("");
  }

  function renderHere() {
    const card = $("cmHereCard");
    const jobs = state?.jobs || [];
    const wo =
      jobs.find((j) => j.status === "on_site") ||
      jobs.find((j) => j.status === "en_route" || j.status === "in_progress") ||
      jobs[0];

    if (!wo) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";
    $("cmHereTime").textContent =
      wo.start && wo.end ? `${wo.start} – ${wo.end}` : wo.start || "Sem horário";
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

  function applyPayload(data) {
    state = data;
    renderHeader();
    renderFolha();
    renderPayments();
    renderHere();
    renderDayList();
  }

  function applyFolhaOnly(folha) {
    if (!state) state = {};
    state.folha = folha;
    state.payments = folha.payments || state.payments || [];
    renderFolha();
    renderPayments();
  }

  async function postFolha(path, body) {
    if (busy) return;
    busy = true;
    renderFolha();
    try {
      const json = await api(path, {
        method: "POST",
        body: JSON.stringify(body || {}),
      });
      if (json.data) applyFolhaOnly(json.data);
      toast("Lançamento atualizado", "success");
    } finally {
      busy = false;
      renderFolha();
    }
  }

  function bind() {
    $("cmAddDiariaBtn")?.addEventListener("click", async () => {
      try {
        await postFolha("/api/campo/folha/diaria", {});
      } catch (err) {
        toast(err.message || "Falha ao lançar diária");
        busy = false;
        renderFolha();
      }
    });
    $("cmExtraPlus")?.addEventListener("click", async () => {
      try {
        await postFolha("/api/campo/folha/extra", { delta_hours: 0.5 });
      } catch (err) {
        toast(err.message || "Falha ao adicionar extra");
        busy = false;
        renderFolha();
      }
    });
    $("cmExtraMinus")?.addEventListener("click", async () => {
      try {
        await postFolha("/api/campo/folha/extra", { delta_hours: -0.5 });
      } catch (err) {
        toast(err.message || "Falha ao remover extra");
        busy = false;
        renderFolha();
      }
    });
  }

  function fallbackMock() {
    if (!M) return;
    const user = M.user;
    const jobs = M.buildTodayJobs();
    state = {
      user: {
        id: user.id,
        name: user.name,
        first_name: user.firstName,
        initials: user.initials,
        team: user.team,
      },
      folha: {
        linked: true,
        can_edit: true,
        message: null,
        employee: {
          id: "mock",
          name: user.name,
          daily_rate: 180,
          daily_rate_label: "$180.00",
          overtime_rate: 30,
          overtime_rate_label: "$30.00",
        },
        period: {
          id: "p1",
          label: "Semana 22–28 set",
          range_label: "22/09/2025 – 28/09/2025",
        },
        today: {
          has_diaria: false,
          days_worked: 0,
          overtime_hours: 0,
          overtime_label: "0 min",
          amount: 0,
          amount_label: "$0.00",
        },
        payments: [
          {
            id: "p1",
            label: "Semana 22–28 set",
            amount_label: "$540.00",
            status_label: "Em andamento",
            pay_status: "open",
            range_label: "22/09 – 28/09",
            hint: "Fecha 28/09/2025",
          },
        ],
      },
      payments: [
        {
          id: "p1",
          label: "Semana 22–28 set",
          amount_label: "$540.00",
          status_label: "Em andamento",
          pay_status: "open",
          range_label: "22/09 – 28/09",
          hint: "Fecha 28/09/2025",
        },
      ],
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
    };
    applyPayload(state);
  }

  async function init() {
    bind();
    try {
      const json = await api("/api/campo/hoje");
      applyPayload(json.data);
    } catch (err) {
      console.warn("[campo/hoje]", err);
      fallbackMock();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoHoje = { VER, refresh: init };
})();
