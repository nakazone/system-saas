/**
 * Jobs — leitura derivada de um job (atraso, etapa, cobrança). Usado pela lista,
 * pela página do job e pelo celular para falar a mesma língua.
 * window.JobsInfo = { late, step, progHtml, stageLabel, bill, money, money0, client, dateRange, esc }
 */
(function () {
  const DAY = 86400000;
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  const fmt0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const money0 = (n) => fmt0.format(Number(n) || 0);
  const money = (n) => fmt2.format(Number(n) || 0);

  function client(wo) {
    return wo.customer?.name || wo.builder?.company || wo.builder?.name || wo.source_name || "Sem cliente";
  }

  function isActive(wo) {
    return wo.status === "draft" || wo.status === "scheduled" || wo.status === "in_progress";
  }

  /** { days, label, kind } quando o job passou da data e ainda não foi concluído; senão null. */
  function late(wo, now) {
    if (!isActive(wo) || !wo.scheduled_start) return null;
    const t = now || Date.now();
    if (wo.status === "in_progress") {
      const end = new Date(wo.scheduled_end || wo.scheduled_start).getTime();
      if (end >= t) return null;
      const d = Math.max(1, Math.floor((t - end) / DAY));
      return { days: d, kind: "late", label: `atrasado ${d} dia${d > 1 ? "s" : ""}`, short: `Atrasado ${d} dia${d > 1 ? "s" : ""}` };
    }
    const start = new Date(wo.scheduled_start).getTime();
    const end = new Date(wo.scheduled_end || wo.scheduled_start).getTime();
    if (start >= t - DAY / 2 && end >= t) return null;
    if (end < t) {
      const d = Math.max(1, Math.floor((t - end) / DAY));
      return { days: d, kind: "notstarted", label: `não iniciado · ${d} dia${d > 1 ? "s" : ""}`, short: `Não iniciado · ${d} dia${d > 1 ? "s" : ""}` };
    }
    return null;
  }

  /**
   * Etapa atual 0..5 no caminho Agendado → Em campo → Concluído → Faturado → Pago.
   * 5 = tudo feito (pago). -1 = cancelado.
   */
  function step(wo) {
    if (wo.status === "canceled") return -1;
    if (wo.status === "in_progress") return 1;
    if (wo.status !== "completed") return 0;
    const b = wo.billing;
    if (!b || b.billing_status === "no_value") return 5;
    if (b.billing_status === "paid") return 5;
    if (b.remaining_to_invoice > 0.004) return 3;
    if (b.open_balance > 0.004) return 4;
    return 5;
  }
  const STEP_NAMES = ["Agendado", "Em campo", "Concluído", "Faturado", "Pago"];

  function stageLabel(wo) {
    if (wo.status === "canceled") return "Cancelado";
    if (wo.status === "draft" && !wo.scheduled_start) return "Rascunho";
    if (!wo.scheduled_start && wo.status !== "completed") return "Sem data";
    const s = step(wo);
    if (s === 0) return "Agendado";
    if (s === 1) return "Em campo";
    if (s === 3) return "Concluído";
    if (s === 4) return "Faturado";
    return wo.billing && wo.billing.billing_status === "paid" ? "Pago" : "Concluído";
  }

  function progHtml(wo) {
    const s = step(wo);
    if (s < 0) return `<span class="jx-prog jx-prog--x"></span>`;
    let h = "";
    for (let i = 0; i < 5; i += 1) {
      const c = i < s ? "d" : i === s ? "n" : "";
      h += `<i class="${c}"></i>`;
    }
    return `<span class="jx-prog" aria-label="Etapa: ${esc(stageLabel(wo))}">${h}</span>`;
  }

  /** Rótulo curto de cobrança. cls: '' | 'dk' | 'ok' | 'mu' */
  function bill(wo) {
    const b = wo.billing;
    if (!b) return null;
    if (b.billing_status === "no_value") return { text: "Sem valor", cls: "mu" };
    if (b.billing_status === "paid") return { text: "Pago", cls: "ok" };
    if (b.open_balance > 0.004 && b.remaining_to_invoice <= 0.004) return { text: `${money0(b.open_balance)} a receber`, cls: "dk" };
    if (b.open_balance > 0.004) return { text: `${money0(b.open_balance)} a receber`, cls: "dk" };
    if (b.billing_status === "partially_invoiced") return { text: `Falta faturar ${money0(b.remaining_to_invoice)}`, cls: "" };
    return { text: "A faturar", cls: "" };
  }

  function dateRange(wo) {
    if (!wo.scheduled_start) return "Sem data";
    const s = new Date(wo.scheduled_start);
    const e = wo.scheduled_end ? new Date(wo.scheduled_end) : null;
    if (!e || s.toDateString() === e.toDateString()) return `${WD[s.getDay()]} ${s.getDate()} ${MO[s.getMonth()]}`;
    if (s.getMonth() === e.getMonth()) return `${s.getDate()} – ${e.getDate()} ${MO[e.getMonth()]}`;
    return `${s.getDate()} ${MO[s.getMonth()]} – ${e.getDate()} ${MO[e.getMonth()]}`;
  }

  function dayShort(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getDate()} ${MO[d.getMonth()]}`;
  }

  function isToday(iso) {
    if (!iso) return false;
    return new Date(iso).toDateString() === new Date().toDateString();
  }

  function initials(name) {
    const p = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "—";
    return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }

  function team(wo) {
    const out = [];
    if (wo.assigned_user?.name) out.push({ name: wo.assigned_user.name, lead: true });
    (wo.members || []).forEach((m) => {
      if (m.name && !out.some((o) => o.name === m.name)) out.push({ name: m.name });
    });
    (wo.temp_workers || []).forEach((t) => {
      if (t.name) out.push({ name: t.name, temp: true });
    });
    return out;
  }

  window.JobsInfo = {
    esc, money, money0, client, isActive, late, step, STEP_NAMES, stageLabel, progHtml, bill, dateRange, dayShort, isToday, initials, team,
  };
})();
