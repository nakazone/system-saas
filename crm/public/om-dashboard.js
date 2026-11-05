/**
 * ObraMate dashboard data layer — shared by the desktop Dashboard (pipeline-lab.html)
 * and the mobile Início (home.html) so both show the same numbers and wording.
 *
 * Data: GET /api/dashboard/overview (server-side KPIs, attention list, today's agenda,
 * pipeline preview). This file only formats; it holds no business rules.
 */
(function (global) {
  if (global.OMDash) return;

  const MONEY_FULL = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const MONEY_COMPACT = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const NUM_PT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function money(n) {
    const v = Number(n);
    return MONEY_FULL.format(Number.isFinite(v) ? v : 0);
  }

  function moneyCompact(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "$0";
    return Math.abs(v) < 1000 ? MONEY_FULL.format(v) : MONEY_COMPACT.format(v);
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function tzOf(ov) {
    return (ov && ov.timezone) || undefined;
  }

  function capitalize(s) {
    const t = String(s || "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  function monthName(iso, tz) {
    const d = iso ? new Date(iso) : new Date();
    try {
      return new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: tz }).format(d);
    } catch (_) {
      return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(d);
    }
  }

  function dateLabel(ov) {
    try {
      const s = new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: tzOf(ov),
      }).format(new Date());
      return capitalize(s);
    } catch (_) {
      return "";
    }
  }

  function hourIn(tz) {
    try {
      return Number(
        new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()),
      );
    } catch (_) {
      return new Date().getHours();
    }
  }

  function greeting(ov, name) {
    const h = hourIn(tzOf(ov));
    const g = h >= 18 || h < 4 ? "Boa noite" : h >= 12 ? "Boa tarde" : "Bom dia";
    const first = String(name || "").trim().split(/\s+/)[0] || "";
    return first ? `${g}, ${first}` : g;
  }

  function timeOf(iso, ov) {
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tzOf(ov),
      }).format(new Date(iso));
    } catch (_) {
      return "";
    }
  }

  function duration(startIso, endIso) {
    const mins = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
    if (!Number.isFinite(mins) || mins <= 0) return "";
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }

  /** "agora", "há 6 min", "há 2 h", "há 3 dias" */
  function ago(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const mins = Math.max(0, Math.floor(((now || Date.now()) - t) / 60000));
    if (mins < 1) return "agora";
    if (mins < 60) return `há ${mins} min`;
    const h = Math.floor(mins / 60);
    if (h < 48) return `há ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 60) return `há ${d} dias`;
    return `há ${Math.floor(d / 30)} meses`;
  }

  /** Waiting time without the "há": "26 h", "3 dias" */
  function waited(iso, now) {
    return ago(iso, now).replace(/^há /, "");
  }

  function days(n) {
    return n === 1 ? "1 dia" : `${n} dias`;
  }

  function stageLabel(slug, name) {
    if (typeof global.pipelineStageDisplayName === "function") return global.pipelineStageDisplayName(slug, name);
    return name || String(slug || "").replace(/_/g, " ");
  }

  function pct(n) {
    return `${NUM_PT.format(n)}%`;
  }

  function delta(current, previous, prevMonth) {
    if (previous == null) return null;
    if (!previous) return current > 0 ? { text: `novo vs ${prevMonth}`, tone: "up" } : null;
    const change = Math.round(((current - previous) / previous) * 100);
    if (change === 0) return { text: `igual a ${prevMonth}`, tone: "flat" };
    return { text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% vs ${prevMonth}`, tone: change > 0 ? "up" : "down" };
  }

  /** Four KPI cards: open quote pipeline, won this month, receivables, gross profit. */
  function kpiCards(ov) {
    const k = (ov && ov.kpis) || {};
    const tz = tzOf(ov);
    const month = monthName(ov && ov.period && ov.period.month_start, tz);
    const prevMonth = monthName(ov && ov.period && ov.period.previous_month_start, tz);
    const cards = [];

    if (k.pipeline_open) {
      const p = k.pipeline_open;
      const hasMoney = p.value != null;
      cards.push({
        key: "pipeline",
        label: "Pipeline aberto",
        value: hasMoney ? moneyCompact(p.value) : plural(p.count, "quote", "quotes"),
        title: hasMoney ? money(p.value) : "Quotes enviados em aberto",
        meta:
          plural(p.count, "quote em aberto", "quotes em aberto") +
          (p.without_value ? ` · ${p.without_value} sem valor` : ""),
        short: plural(p.count, "quote aberto", "quotes abertos"),
        href: "quotes.html?status=sent",
        tone: "dark",
      });
    }
    if (k.won_month) {
      const w = k.won_month;
      const hasMoney = w.value != null;
      cards.push({
        key: "won",
        label: `Fechados no mês`,
        value: hasMoney ? moneyCompact(w.value) : plural(w.count, "quote", "quotes"),
        title: hasMoney ? money(w.value) : "",
        meta: hasMoney
          ? plural(w.count, "quote aprovado", "quotes aprovados") + (month ? ` · ${month}` : "")
          : "aprovados no mês",
        short: hasMoney ? plural(w.count, "aprovado", "aprovados") : "no mês",
        delta: hasMoney ? delta(w.value, w.previous_value, prevMonth) : delta(w.count, w.previous_count, prevMonth),
        href: "quotes.html",
      });
    }
    if (k.receivables) {
      const r = k.receivables;
      cards.push({
        key: "receivables",
        label: "A receber",
        value: moneyCompact(r.open_value),
        title: money(r.open_value),
        meta: r.overdue_count
          ? `${moneyCompact(r.overdue_value)} vencido · ${plural(r.overdue_count, "invoice", "invoices")}`
          : r.open_count
            ? `${plural(r.open_count, "invoice em aberto", "invoices em aberto")} · nada vencido`
            : "Nenhuma invoice em aberto",
        short: r.overdue_count ? `${moneyCompact(r.overdue_value)} vencido` : "nada vencido",
        metaTone: r.overdue_count ? "danger" : "ok",
        href: r.overdue_count ? "invoices.html?status=overdue" : "invoices.html?status=receivable",
      });
    }
    if (k.gross_profit) {
      const g = k.gross_profit;
      const hasMoney = g.value != null;
      cards.push({
        key: "gross_profit",
        label: "Gross Profit",
        value: hasMoney ? moneyCompact(g.value) : plural(g.count, "deal", "deals"),
        title: hasMoney
          ? `${money(g.value)} · receita ${money(g.revenue || 0)} − custo ${money(g.cost || 0)}`
          : "Margem dos quotes fechados no mês",
        meta: hasMoney
          ? plural(g.count, "fechado no mês", "fechados no mês")
          : "sem permissão de preço",
        short: plural(g.count, "fechado", "fechados"),
        delta: hasMoney ? delta(g.value, g.previous_value, prevMonth) : delta(g.count, g.previous_count, prevMonth),
        href: "quotes.html",
      });
    }
    return cards.slice(0, 4);
  }

  /**
   * Home KPI strip: sales (pipeline, won, conversion, new leads) and money (receivables, gross profit).
   * Each tile: { key, group, label, value, title, meta, metaTone, href }.
   */
  function kpiStrip(ov) {
    const k = (ov && ov.kpis) || {};
    const tz = tzOf(ov);
    const prevMonth = monthName(ov && ov.period && ov.period.previous_month_start, tz);
    const shortPrev = prevMonth ? prevMonth.slice(0, 3) + "." : "";
    const vs = (d) => (d ? d.text.replace(/^[▲▼]\s*/, d.tone === "down" ? "−" : "+").replace(` vs ${prevMonth}`, ` vs ${shortPrev}`) : "");
    const tiles = [];

    if (k.pipeline_open) {
      const p = k.pipeline_open;
      const hasMoney = p.value != null;
      tiles.push({
        key: "pipeline",
        group: "sales",
        label: "Pipeline aberto",
        value: hasMoney ? money(p.value) : String(p.count),
        title: hasMoney ? money(p.value) : "",
        meta: plural(p.count, "quote em aberto", "quotes em aberto"),
        href: "quotes.html?status=sent",
      });
    }
    if (k.won_month) {
      const w = k.won_month;
      const hasMoney = w.value != null;
      // Compare like with like: month-to-date vs the same day of last month (the chart shows both paces).
      const dl = w.daily;
      const samePrev =
        dl && dl.previous && dl.previous.length && dl.current && dl.current.length
          ? dl.previous[Math.min(dl.previous.length, dl.current.length) - 1]
          : null;
      const d =
        samePrev != null
          ? delta(dl.current[dl.current.length - 1], samePrev, prevMonth)
          : hasMoney
            ? delta(w.value, w.previous_value, prevMonth)
            : delta(w.count, w.previous_count, prevMonth);
      tiles.push({
        key: "won",
        group: "sales",
        label: "Fechado no mês",
        value: hasMoney ? money(w.value) : String(w.count),
        meta: d ? vs(d) : plural(w.count, "quote aprovado", "quotes aprovados"),
        metaTone: d ? d.tone : "",
        href: "quotes.html",
      });
    }
    if (k.conversion) {
      const c = k.conversion;
      tiles.push({
        key: "conversion",
        group: "sales",
        label: "Conversão",
        value: c.rate == null ? "—" : pct(c.rate),
        meta: c.won + c.lost ? `${plural(c.won, "ganho", "ganhos")} · ${plural(c.lost, "perdido", "perdidos")}` : "sem leads fechados ainda",
        href: "leads.html",
      });
    }
    if (k.leads_month) {
      const l = k.leads_month;
      const d = delta(l.count, l.previous_count, prevMonth);
      tiles.push({
        key: "leads",
        group: "sales",
        label: "Leads novos",
        value: String(l.count),
        meta: d ? vs(d) : "neste mês",
        metaTone: d ? d.tone : "",
        href: "leads.html",
      });
    }
    if (k.receivables) {
      const r = k.receivables;
      tiles.push({
        key: "receivables",
        group: "money",
        label: "A receber",
        value: money(r.open_value),
        meta: r.overdue_count ? `${money(r.overdue_value)} vencido` : r.open_count ? "nada vencido" : "nenhuma invoice em aberto",
        metaTone: r.overdue_count ? "danger" : "",
        href: r.overdue_count ? "invoices.html?status=overdue" : "invoices.html?status=receivable",
      });
    }
    if (k.gross_profit && k.gross_profit.value != null) {
      const g = k.gross_profit;
      const revenue = Number(g.revenue) || 0;
      const margin = revenue > 0 ? Math.round((Number(g.value) / revenue) * 100) : null;
      tiles.push({
        key: "gross_profit",
        group: "money",
        label: "Lucro bruto",
        value: money(g.value),
        title: `Receita ${money(revenue)} − custo ${money(g.cost || 0)}`,
        meta: margin != null ? `margem ${margin}%` : plural(g.count, "fechado no mês", "fechados no mês"),
        href: "quotes.html",
      });
    }
    return tiles;
  }

  /** One sent quote waiting for the client. */
  function quoteWaitView(q) {
    return {
      title: q.name,
      sub: [q.label ? `Quote ${q.label}` : "", q.days === 0 ? "enviado hoje" : `enviado há ${days(q.days)}`].filter(Boolean).join(" · "),
      amount: q.amount != null ? money(q.amount) : "",
      seen: q.viewed ? "Visto" : "Não aberto",
      seenTone: q.viewed ? "ok" : "wait",
      stale: q.days >= 7,
      href: q.href,
    };
  }

  /** Jobs status tiles + rows for the Home "Jobs" card. */
  function jobsStatusView(s) {
    const stats = [
      { key: "field", label: "Em campo", value: s.in_field, href: "jobs.html?filter=field", tone: "" },
      { key: "late", label: "Atrasados", value: s.late, href: "jobs.html?filter=late", tone: s.late ? "danger" : "" },
      { key: "scheduled", label: "Agendados", value: s.scheduled, href: "jobs.html?filter=scheduled", tone: "" },
      { key: "nodate", label: "Sem data", value: s.no_date, href: "jobs.html?filter=nodate", tone: s.no_date ? "warn" : "" },
    ];
    const bill = s.to_invoice && s.to_invoice.count
      ? { value: money(s.to_invoice.value), meta: plural(s.to_invoice.count, "job concluído", "jobs concluídos") }
      : null;
    const rows = (s.items || []).map((it) => ({
      title: it.title,
      sub: it.kind === "late" ? `atrasado ${days(it.days || 1)}` : "concluído · falta faturar",
      aside: it.kind === "to_invoice" && it.amount != null ? money(it.amount) : "",
      tone: it.kind === "late" ? "danger" : "warn",
      href: it.href,
    }));
    return { stats, bill, rows };
  }

  const ICONS = {
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    phone:
      '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v4a5 5 0 005 5 5 5 0 005-5V2M7 22v-4a5 5 0 015-5 5 5 0 015 5v4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.clock}</svg>`;
  }

  /** Human text for one attention item (pt-BR). */
  function attentionView(it, ov, now) {
    const t = now || Date.now();
    const name = it.entity && it.entity.name ? it.entity.name : "";
    const amount = it.amount != null && it.amount > 0 ? moneyCompact(it.amount) : "";
    const bits = (...xs) => xs.filter(Boolean).join(" · ");
    const tel = it.phone ? `tel:${String(it.phone).replace(/[^\d+]/g, "")}` : null;
    const base = { tone: it.priority === "high" ? "danger" : "warn", href: it.href, tel: null, cta: "Abrir" };

    switch (it.kind) {
      case "lead_sla": {
        const left = Math.max(0, Math.ceil((Date.parse(it.deadline) - t) / 60000));
        return {
          ...base,
          icon: icon("bolt"),
          title: `Responder ${name}`,
          detail: bits(`Lead novo ${ago(it.at, t)}`, it.source, amount),
          badge: left > 0 ? `${left} min p/ responder` : "Responder já",
          tel,
          cta: tel ? "Ligar" : "Abrir",
        };
      }
      case "lead_uncontacted":
        return {
          ...base,
          icon: icon("phone"),
          title: `Contatar ${name}`,
          detail: bits(`Sem contato há ${waited(it.at, t)}`, it.source, amount),
          tel,
          cta: tel ? "Ligar" : "Abrir",
        };
      case "followup_overdue":
        return {
          ...base,
          icon: icon("clock"),
          title: `Follow-up atrasado · ${name}`,
          detail: bits(it.label, `venceu há ${days(it.days || 1)}`),
          tel,
          cta: tel ? "Ligar" : "Abrir",
        };
      case "followup_today":
        return {
          ...base,
          icon: icon("clock"),
          title: `Follow-up hoje · ${name}`,
          detail: it.label || "Follow-up agendado para hoje",
          tel,
          cta: tel ? "Ligar" : "Abrir",
        };
      case "quote_changes":
        return {
          ...base,
          icon: icon("edit"),
          title: `Alterações pedidas · ${name}`,
          detail: bits(
            `Quote ${it.label || ""}`.trim(),
            amount,
            it.detail || "cliente pediu mudanças",
          ),
          cta: "Revisar",
        };
      case "quote_expiring": {
        const when = it.days === 0 ? "hoje" : it.days === 1 ? "amanhã" : `em ${it.days} dias`;
        return {
          ...base,
          icon: icon("hourglass"),
          title: `Quote vence ${when} · ${name}`,
          detail: bits(`Quote ${it.label || ""}`.trim(), amount, it.viewed ? "cliente já visualizou" : "ainda não visualizado"),
          cta: "Abrir",
        };
      }
      case "quote_stale":
        return {
          ...base,
          icon: icon("mail"),
          title: `Sem resposta há ${days(it.days || 7)} · ${name}`,
          detail: bits(`Quote ${it.label || ""}`.trim(), amount, it.viewed ? "cliente visualizou" : "não visualizado"),
          cta: "Follow-up",
        };
      case "invoice_overdue":
        return {
          ...base,
          icon: icon("receipt"),
          title: `Invoice vencida · ${name}`,
          detail: bits(it.label, amount, `venceu há ${days(it.days || 1)}`),
          cta: "Cobrar",
        };
      default:
        return { ...base, icon: icon("clock"), title: name, detail: "" };
    }
  }

  const JOB_STATUS = {
    in_progress: "Em andamento",
    on_site: "No local",
    en_route: "A caminho",
    completed: "Concluído",
    scheduled: "",
    draft: "Rascunho",
  };

  function eventView(ev, ov) {
    const isJob = ev.type === "job";
    const long = Date.parse(ev.end) - Date.parse(ev.start) >= 4 * 3600000;
    const status = isJob ? JOB_STATUS[ev.status] || "" : ev.status === "completed" ? "Concluída" : "";
    return {
      time: timeOf(ev.start, ov),
      until: long ? `até ${timeOf(ev.end, ov)}` : duration(ev.start, ev.end),
      title: ev.title,
      sub: [ev.person, ev.address].filter(Boolean).join(" · "),
      tag: isJob ? (ev.phase === "sand_finish" ? "Lixa" : "Instalação") : "Visita",
      tagTone: isJob ? (ev.phase === "sand_finish" ? "sand" : "job") : "visit",
      status,
      live: isJob && (ev.status === "in_progress" || ev.status === "on_site"),
      href: ev.href,
    };
  }

  function summary(ov) {
    const parts = [];
    const ev = (ov && ov.today_events) || null;
    if (ev) {
      const jobEv = ev.filter((e) => e.type === "job");
      const visits = ev.length - jobEv.length;
      const sand = jobEv.filter((e) => e.phase === "sand_finish").length;
      const install = jobEv.length - sand;
      if (!ev.length) parts.push("Agenda livre hoje");
      else {
        const x = [];
        if (visits) x.push(plural(visits, "visita", "visitas"));
        if (install) x.push(plural(install, "instalação", "instalações"));
        if (sand) x.push(plural(sand, "lixa", "lixas"));
        parts.push(`Hoje: ${x.join(" e ")}`);
      }
    }
    const high = ov && ov.attention ? ov.attention.high : 0;
    if (ov && ov.attention) {
      parts.push(high ? plural(high, "item urgente", "itens urgentes") : "nada urgente");
    }
    return parts.length ? `${parts.join(" · ")}.` : "";
  }

  let inflight = null;
  async function load() {
    if (inflight) return inflight;
    inflight = (async () => {
      const r = await fetch("/api/dashboard/overview", { credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) {
        const e = new Error("unauthenticated");
        e.status = 401;
        throw e;
      }
      if (!r.ok || j.success === false) {
        const e = new Error(j.error || `HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      return j;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  async function session() {
    const r = await fetch("/api/auth/session", { credentials: "include" });
    return r.json();
  }

  function can(sess, perm) {
    const u = sess && sess.user;
    if (!u) return false;
    if (u.role === "admin") return true;
    return Array.isArray(u.permissions) && u.permissions.includes(perm);
  }

  global.OMDash = {
    load,
    session,
    can,
    esc,
    money,
    moneyCompact,
    plural,
    ago,
    dateLabel,
    greeting,
    kpiCards,
    kpiStrip,
    quoteWaitView,
    jobsStatusView,
    attentionView,
    eventView,
    summary,
    stageLabel,
    timeOf,
    icon,
  };
})(typeof window !== "undefined" ? window : globalThis);
