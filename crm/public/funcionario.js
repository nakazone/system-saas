/**
 * Desktop employee dashboard — diária, extras, pagamentos, obras.
 */
(function () {
  const VER = "20260925-field2";
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

  function greeting(now) {
    const h = now.getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  }

  function formatDayMeta(d) {
    return d.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
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
    if (status === "on_site") return "func-badge--site";
    if (status === "en_route" || status === "in_progress") return "func-badge--progress";
    return "";
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
    else alert(msg);
  }

  function renderHeader() {
    const now = new Date();
    const u = state?.user || {};
    const first = u.first_name || String(u.name || "").split(/\s+/)[0] || "";
    $("funcDate").textContent = formatDayMeta(now);
    $("funcGreet").textContent = `${greeting(now)}${first ? `, ${first}` : ""}`;
    $("funcMeta").textContent = `${u.team || "Equipe"} · Funcionário`;
  }

  function renderFolha() {
    const f = state?.folha;
    const btn = $("funcAddDiaria");
    const hint = $("funcHint");
    const minus = $("funcExtraMinus");
    const plus = $("funcExtraPlus");

    if (!f || !f.linked) {
      $("funcPeriod").textContent = "Folha";
      $("funcAmount").textContent = "—";
      $("funcStatus").textContent = f?.message || "Conta não vinculada à folha";
      $("funcDiariaVal").textContent = "—";
      $("funcExtraVal").textContent = "—";
      $("funcExtraMid").textContent = "—";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Diária indisponível";
      }
      if (minus) minus.disabled = true;
      if (plus) plus.disabled = true;
      if (hint) {
        hint.hidden = false;
        hint.textContent =
          f?.message || "Peça ao escritório para vincular seu usuário ao funcionário da folha.";
      }
      return;
    }

    const today = f.today || {};
    $("funcPeriod").textContent = f.period ? f.period.label : "Sem período";
    $("funcAmount").textContent = today.amount_label || "$0.00";
    $("funcStatus").textContent = today.has_diaria
      ? today.overtime_hours > 0
        ? `Diária + ${today.overtime_label} extras`
        : "Diária lançada"
      : today.overtime_hours > 0
        ? `Só extras · ${today.overtime_label}`
        : "Sem lançamento ainda";

    $("funcDiariaVal").textContent = today.has_diaria ? "Lançada" : "Pendente";
    $("funcDiariaChip")?.classList.toggle("is-done", Boolean(today.has_diaria));
    $("funcExtraVal").textContent = today.overtime_label || "0 min";
    $("funcExtraMid").textContent = today.overtime_label || "0 min";

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
    const list = $("funcPayList");
    const rows = state?.payments || state?.folha?.payments || [];
    if (!rows.length) {
      list.innerHTML =
        '<p class="func-pay__empty">Nenhum pagamento previsto. Quando o escritório abrir um período, ele aparece aqui.</p>';
      return;
    }
    list.innerHTML = rows
      .map((p) => {
        const tone =
          p.pay_status === "paid"
            ? "func-pay__card--paid"
            : p.pay_status === "due"
              ? "func-pay__card--due"
              : "";
        return `
        <article class="func-pay__card ${tone}">
          <div class="func-pay__top">
            <p class="func-pay__label">${escapeHtml(p.label)}</p>
            <span class="func-pay__badge">${escapeHtml(p.status_label)}</span>
          </div>
          <p class="func-pay__amount">${escapeHtml(p.amount_label)}</p>
          <p class="func-pay__meta">${escapeHtml(p.range_label)} · ${escapeHtml(p.hint || "")}</p>
        </article>`;
      })
      .join("");
  }

  function renderJobs() {
    const list = $("funcJobsList");
    const rows = state?.jobs || [];
    if (!rows.length) {
      list.innerHTML = '<p class="func-jobs__empty">Nenhuma obra sua para hoje.</p>';
      return;
    }
    list.innerHTML = rows
      .map((j) => {
        const start = j.start || "—";
        const end = j.end || "";
        const badge = statusLabel(j.status);
        const cls = statusBadgeClass(j.status);
        return `
        <a class="func-job" href="job-detail.html?id=${encodeURIComponent(j.id)}">
          <div class="func-job__times">
            <div>${escapeHtml(start)}</div>
            <div>${escapeHtml(end)}</div>
          </div>
          <div>
            <p class="func-job__title">${escapeHtml(j.title)}</p>
            <p class="func-job__sub">#${j.number ?? "—"} · ${escapeHtml(j.client)}</p>
          </div>
          <span class="func-badge ${cls}">${escapeHtml(badge)}</span>
        </a>`;
      })
      .join("");
  }

  function apply(data) {
    state = data;
    renderHeader();
    renderFolha();
    renderPayments();
    renderJobs();
  }

  function applyFolha(folha) {
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
      if (json.data) applyFolha(json.data);
      toast("Lançamento atualizado", "success");
    } finally {
      busy = false;
      renderFolha();
    }
  }

  function bind() {
    $("funcAddDiaria")?.addEventListener("click", async () => {
      try {
        await postFolha("/api/campo/folha/diaria", {});
      } catch (err) {
        toast(err.message || "Falha ao lançar diária");
        busy = false;
        renderFolha();
      }
    });
    $("funcExtraPlus")?.addEventListener("click", async () => {
      try {
        await postFolha("/api/campo/folha/extra", { delta_hours: 0.5 });
      } catch (err) {
        toast(err.message || "Falha ao adicionar extra");
        busy = false;
        renderFolha();
      }
    });
    $("funcExtraMinus")?.addEventListener("click", async () => {
      try {
        await postFolha("/api/campo/folha/extra", { delta_hours: -0.5 });
      } catch (err) {
        toast(err.message || "Falha ao remover extra");
        busy = false;
        renderFolha();
      }
    });
  }

  async function init() {
    document.body.classList.add("func-no-dock");
    bind();
    try {
      const json = await api("/api/campo/hoje");
      apply(json.data);
    } catch (err) {
      toast(err.message || "Falha ao carregar");
      console.warn("[funcionario]", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__funcionarioHome = { VER };
})();
