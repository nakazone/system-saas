/**
 * Jobs (computador e iPad) — lista à esquerda e o job aberto à direita com as mesmas
 * abas da antiga tela Abrir job (visão geral, serviços, fotos, campo, conversa).
 */
(function () {
  const I = () => window.JobsInfo;
  const $ = (id) => document.getElementById(id);
  let all = [];
  /** Pending builder-portal requests. Shown on the list before a job exists. */
  let portalRequests = [];
  let canManage = false;
  let canBill = false;
  let canInvoice = false;
  let filter = "all";
  let source = "";
  /** Empty means every status except Pago. */
  let statusFilter = "";
  let sortDir = "newest";
  let q = "";
  let selId = null;
  /** Job opened from a quote link. Stays at the top of the list after Back. */
  let focusId = null;
  let firstLoad = true;
  let detailTab = "geral";
  let detailWo = null;
  /** Bumped to ignore in-flight GET /work-orders/:id that would clobber a fresher status. */
  let detailFetchSeq = 0;
  let billingCtl = null;
  let commsCtl = null;
  let mediaCache = null;
  let fieldCache = null;
  /** Photos and reports the partner can see for the open job. */
  let partnerDocs = null;
  let partnerDocsSeq = 0;
  /** Sunday of the selected week, or null to show every week. */
  let weekFilter = null;
  /** ymd of the day chosen on the week strip, or null to show the whole week. */
  let dayFilter = null;
  /** 1 slides the week strip forward, -1 backward. Cleared after the paint. */
  let weekSlide = 0;
  /** Sunday ymd to scroll into view after the list paints a week change. */
  let pendingWeekKey = null;
  /** Group that the week change opened. */
  let pendingWeekLabel = null;
  /** Last Sunday whose collapses were applied. Null until the first list paint. */
  let appliedWeekKey = null;
  let calCursor = new Date();
  let calOpen = false;
  /** Which week blocks inside Próximos jobs stay open. Key is the Sunday ymd. */
  const weekOpen = new Map();

  const SVG = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16l3-1.5 3 1.5 3-1.5 3 1.5V4a2 2 0 00-2-2z"/><path d="M8 7h6M8 11h6"/></svg>',
  };

  function notify(msg, type) {
    if (window.crmToast?.[type || "info"]) window.crmToast[type || "info"](msg);
  }
  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // ---------------------------------------------------------------- buckets
  function bucket(wo) {
    const J = I();
    if (wo.status === "canceled") return "canceled";
    if (J.late(wo)) return "late";
    if (wo.status === "in_progress") return "field";
    if (J.isActive(wo)) return wo.scheduled_start ? "scheduled" : "nodate";
    const b = wo.billing;
    if (b && b.remaining_to_invoice > 0.004 && b.billing_status !== "no_value") return "toinvoice";
    if (b && b.open_balance > 0.004) return "receivable";
    return "done";
  }
  const GROUPS = [
    ["late", "Atrasados"],
    ["field", "Em campo"],
    ["scheduled", "Agendados"],
    ["nodate", "Sem data"],
    ["toinvoice", "A faturar"],
    ["receivable", "A receber"],
    ["done", "Concluídos"],
    ["canceled", "Cancelados"],
  ];

  function isPaidJob(wo) {
    return Boolean(wo && wo.billing && wo.billing.billing_status === "paid");
  }

  function matchesFilter(wo, f) {
    const J = I();
    const bk = bucket(wo);
    switch (f) {
      case "all":
        return wo.status !== "canceled" && !isPaidJob(wo);
      case "nodate":
        return J.isActive(wo) && !wo.scheduled_start;
      case "scheduled":
        return (wo.status === "scheduled" || wo.status === "draft") && !!wo.scheduled_start;
      case "field":
        return wo.status === "in_progress";
      case "late":
        return !!J.late(wo);
      case "toinvoice":
        return bk === "toinvoice";
      case "receivable":
        return !!(wo.billing && wo.billing.open_balance > 0.004);
      case "done":
        return wo.status === "completed" && !isPaidJob(wo);
      default:
        return true;
    }
  }

  function sourceMatches(wo) {
    if (!source) return true;
    if (source === "builder") return wo.source_type === "builder" || wo.source_type === "contractor";
    return wo.source_type === source;
  }

  function searchHit(wo) {
    if (!sourceMatches(wo)) return false;
    if (!q) return true;
    const text = I().searchText(wo);
    if (text.includes(q)) return true;
    return q.length >= 5 && text.includes(q.slice(1));
  }

  function sortRows(rows) {
    return rows.sort((a, b) => I().compareNearest(a, b));
  }

  // ---------------------------------------------------------------- top
  function renderTiles() {
    const J = I();
    const n = (f) => all.filter((w) => matchesFilter(w, f));
    const sum = (rows, fn) => rows.reduce((s, w) => s + (Number(fn(w)) || 0), 0);
    const T = [];
    const allR = n("all");
    T.push(["all", "Todos", allR.length, `${J.money0(sum(allR, (w) => w.services_total))} em jobs`, ""]);
    const nd = n("nodate");
    T.push(["nodate", "Sem data", nd.length, nd.length ? "marcar na agenda" : "tudo agendado", ""]);
    const sc = n("scheduled");
    T.push(["scheduled", "Agendados", sc.length, sc.length ? J.money0(sum(sc, (w) => w.services_total)) : "", ""]);
    const fi = n("field");
    T.push(["field", "Em campo", fi.length, fi.length ? J.money0(sum(fi, (w) => w.services_total)) : "ninguém em campo", ""]);
    const la = n("late");
    T.push(["late", "Atrasados", la.length, la.length ? "passaram da data" : "nenhum", la.length ? "is-hot" : ""]);
    if (canBill) {
      const ti = n("toinvoice");
      T.push(["toinvoice", "A faturar", ti.length, ti.length ? `${J.money0(sum(ti, (w) => w.billing.remaining_to_invoice))} concluído` : "nada pendente", ""]);
      const re = n("receivable");
      T.push(["receivable", "A receber", re.length, re.length ? J.money0(sum(re, (w) => w.billing.open_balance)) : "nada em aberto", ""]);
    }
    const dn = n("done");
    const paidN = all.filter((w) => isPaidJob(w)).length;
    T.push(["done", "Concluídos", dn.length, paidN ? `${paidN} pago${paidN === 1 ? "" : "s"} oculto${paidN === 1 ? "" : "s"}` : "", ""]);
    const host = $("jxTiles");
    host.style.setProperty("--jx-tiles", T.length);
    host.innerHTML = T.map(
      ([k, l, c, s, cls]) =>
        `<button type="button" class="jx-tile${filter === k && !statusFilter ? " is-on" : ""}" data-jx-filter="${k}" aria-pressed="${filter === k && !statusFilter}"><span>${l}</span><b>${c}</b><small class="${cls}">${I().esc(s)}</small></button>`,
    ).join("");
  }

  // ---------------------------------------------------------------- list
  function useSwipeDelete() {
    return window.matchMedia("(max-width: 1024px), (pointer: coarse)").matches;
  }
  function canFaturar(wo) {
    const b = wo.billing;
    return canInvoice && wo.status !== "canceled" && b && b.remaining_to_invoice > 0.004 && b.billing_status !== "no_value";
  }
  /** Same popup as Serviços → Faturar job (depósito / outro / total). */
  function openFaturar(wo) {
    if (!wo || !window.JobBilling?.openDialog) {
      location.href = `job-detail.html?id=${encodeURIComponent(wo?.id || "")}&faturar=1`;
      return;
    }
    window.JobBilling.openDialog({ jobId: wo.id, billing: wo.billing, jobStatus: wo.status });
  }
  /** Botão principal do cartão — o mesmo do app: agendar, iniciar, concluir, faturar. */
  function cardActions(wo, undated, now) {
    if (!canManage) return "";
    const J = I();
    const id = J.esc(wo.id);
    // Laranja só no que é para agora (em campo, hoje, atrasado, sem data); o resto fica neutro.
    const b = now ? "jmx-b jmx-b--or" : "jmx-b";
    if (wo.status === "in_progress") {
      const nxt = J.nextFinish ? J.nextFinish(wo) : null;
      return `<button type="button" class="${b}" data-jx-act="complete" data-id="${id}">${J.esc(nxt ? nxt.label : "Concluir")}</button>`;
    }
    if (wo.status === "scheduled" || wo.status === "draft") {
      if (undated) return `<button type="button" class="${b}" data-jx-start="${id}">Schedule Job</button>`;
      return `<button type="button" class="${b}" data-jx-act="start" data-id="${id}">Iniciar</button>`;
    }
    if (wo.status === "completed" && canBill && bucket(wo) === "toinvoice") {
      return `<button type="button" class="${b}" data-jx-faturar="${id}">Faturar</button>`;
    }
    return "";
  }
  /** Bloco do dia, como numa agenda: QUA / 4 / NOV. Hoje e em campo, o número fica preto. */
  function dayBlock(wo, finished) {
    const J = I();
    const iso = J.listAnchorIso(wo) || (finished ? wo.updated_at || wo.scheduled_end : null);
    if (!iso) return `<span class="ol-lead jx-day is-none" aria-hidden="true"><b>—</b><small>sem data</small></span>`;
    const d = new Date(iso);
    const wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
    const mo = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getMonth()];
    const today = sod(d).getTime() === sod(new Date()).getTime();
    // Bloco sempre cinza; o número fica preto quando o job é para agora (em campo ou hoje).
    const tone = !finished && (today || wo.status === "in_progress") ? " is-now" : finished ? " is-done" : "";
    return `<span class="ol-lead jx-day${tone}" aria-label="${today ? "Hoje" : `${wd} ${d.getDate()} ${mo}`}"><small>${today ? "hoje" : wd}</small><b>${d.getDate()}</b><small>${mo}</small></span>`;
  }
  /** Hora de início, quando o job tem hora marcada (não meia-noite). */
  function timeText(wo) {
    const iso = I().listAnchorIso(wo);
    if (!iso || wo.status === "completed" || wo.status === "canceled") return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || (d.getHours() === 0 && d.getMinutes() === 0)) return "";
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  function rowHtml(wo, now = false) {
    const J = I();
    const finished = wo.status === "completed" || wo.status === "canceled";
    const undated = !finished && !J.listAnchorIso(wo);
    const when = J.listWhen ? J.listWhen(wo) : { date: undated ? "Sem data" : J.dateRange(wo), status: "" };
    const who = J.client(wo);
    const head = who && who !== "Sem cliente" ? who : wo.title || "Job";
    const href = `job-detail.html?id=${encodeURIComponent(wo.id)}`;
    const showDel = canManage && wo.status !== "canceled";
    const addr = wo.address ? `<span class="ol-m jx-row__addr" title="${J.esc(wo.address)}">${SVG.pin}<span>${J.esc(wo.address)}</span></span>` : `<span class="ol-m"><span>Sem endereço</span></span>`;
    const lt = J.late ? J.late(wo) : null;
    const stText = lt ? lt.short : when.status;
    const tone = J.stageTone ? J.stageTone(wo) : "wait";
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "";
    const actions = cardActions(wo, undated, now);
    const id = J.esc(wo.id);
    // Cartão de agenda: bloco do dia à esquerda (lê-se a lista pela data, como uma agenda),
    // nome + hora, endereço, progresso; embaixo o status e mapa + ação principal.
    const body = `<div class="jx-rowwrap jmx-card">
    <a class="jx-row ol-row${String(wo.id) === String(selId) ? " is-on" : ""}" href="${href}" data-jx-id="${id}">
      ${dayBlock(wo, finished)}
      <b class="ol-t" title="${J.esc(head)}">${J.esc(head)}</b>
      ${timeText(wo) ? `<span class="ol-v ol-time">${J.esc(timeText(wo))}</span>` : ""}
      ${addr}
      ${J.progHtml(wo)}
    </a>
    <div class="jmx-card__r3 jx-foot" data-jx-id="${id}">${stText ? `<span class="ol-st is-${tone}" title="${J.esc(stText)}">${J.esc(stText)}</span>` : ""}${maps ? `<a class="jmx-b jmx-b--sq" href="${maps}" target="_blank" rel="noopener" aria-label="Abrir mapa" title="Abrir mapa">${SVG.pin}</a>` : ""}${actions}</div>
    </div>`;
    // Swipe-to-delete only on touch / narrow — desktop list stays clean (no inline buttons).
    if (showDel && useSwipeDelete()) {
      return `<article class="om-swipe jx-swipe" data-jx-swipe="${J.esc(wo.id)}">
      <div class="om-swipe__actions" aria-hidden="true">
        <a class="om-swipe__act--edit" href="${href}">Abrir</a>
        <button type="button" class="om-swipe__act--delete" data-jx-delete="${J.esc(wo.id)}" data-jx-label="${J.esc(wo.title || J.client(wo))}">Excluir</button>
      </div>
      <div class="om-swipe__body">${body}</div>
    </article>`;
    }
    return body;
  }

  async function deleteJob(id, label, btn) {
    if (!id || !canManage) return;
    const okDel = await window.crmConfirm({
      title: `Excluir o job “${label || id}”?`,
      text: "O job será cancelado e sai da lista ativa.",
      ok: "Excluir job",
      danger: true,
    });
    if (!okDel) return;
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "…";
    }
    try {
      await api(`/api/work-orders/${encodeURIComponent(id)}`, { method: "DELETE" });
      notify("Job excluído.", "success");
      if (String(selId) === String(id)) selId = null;
      await load();
    } catch (err) {
      notify(err.message || "Não foi possível excluir", "error");
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "Excluir";
      }
    }
  }

  function stageMatches(wo, filter) {
    const stage = I().stageLabel(wo);
    if (filter === "Em campo") return I().isInFieldStage ? I().isInFieldStage(stage) : stage === "Em campo" || stage === "Lixa" || stage === "Installing" || stage === "Sanding";
    return stage === filter;
  }

  function statusMatches(wo) {
    if (!statusFilter) return !isPaidJob(wo);
    return stageMatches(wo, statusFilter);
  }

  function visibleRows() {
    const serverSearch = q.length >= 2 && q === fetchedQuery;
    const rows = statusFilter
      ? all.filter((w) => stageMatches(w, statusFilter) && searchHit(w))
      : serverSearch
        ? all.filter((w) => w.status !== "canceled" && !isPaidJob(w) && searchHit(w))
        : all.filter((w) => matchesFilter(w, filter) && searchHit(w));
    const pin = q ? selId : selId || focusId;
    if (pin && !rows.some((w) => String(w.id) === String(pin))) {
      const pinned = all.find((w) => String(w.id) === String(pin));
      const open = String(pin) === String(selId);
      // A chosen status must stay exact. The open job stays on Todos, including when it is paid.
      if (pinned && open && !statusFilter) return [pinned, ...rows];
      if (pinned && pinned.status !== "canceled" && statusMatches(pinned) && searchHit(pinned)) return [pinned, ...rows];
    }
    return rows;
  }

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function sod(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function weekSunday(d) {
    const x = sod(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }
  function sameWeek(a, b) {
    return ymd(weekSunday(a)) === ymd(weekSunday(b));
  }
  function jobAnchor(wo) {
    const iso =
      (I().listAnchorIso ? I().listAnchorIso(wo) : null) ||
      (wo.status === "completed" ? wo.updated_at || wo.scheduled_end : null);
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  /**
   * Lista: Sem data (fechado, no topo), Em Campo (em andamento, hoje e atrasados)
   * e Próximos jobs (de amanhã em diante, um collapse por semana). Concluídos no fim.
   */
  const NOW_GROUPS = new Set(["field", "nodate"]);
  const BAR_GROUPS = new Set(["field", "next", "done"]);
  const BAR_SHORT = { field: "Doing", next: "Next", done: "Done" };
  /** All na barra: a lista mostra todo job, sem o recorte da semana. */
  let showAll = false;
  function weekGroupLabel(sunday, now) {
    const range = weekTitle(sunday);
    const thisWeek = weekSunday(now);
    const nextWeek = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() + 7);
    if (ymd(sunday) === ymd(thisWeek)) return `Esta semana · ${range}`;
    if (ymd(sunday) === ymd(nextWeek)) return `Próxima semana · ${range}`;
    return range;
  }
  function dayGroups(rows) {
    const J = I();
    const now = new Date();
    const t0 = sod(now).getTime();
    const b = { field: [], nodate: [], done: [], off: [] };
    const byWeek = new Map();
    rows.forEach((wo) => {
      if (wo.status === "canceled") return b.off.push(wo);
      if (wo.status === "completed") return b.done.push(wo);
      if (wo.status === "in_progress") return b.field.push(wo);
      const d = jobAnchor(wo);
      if (!d) return b.nodate.push(wo);
      const t = sod(d).getTime();
      if (t === t0 || J.late(wo) || t < t0) return b.field.push(wo);
      const sun = weekSunday(d).getTime();
      if (!byWeek.has(sun)) byWeek.set(sun, []);
      byWeek.get(sun).push(wo);
    });
    const byStart = (a, z) => (J.startMs(a) ?? Infinity) - (J.startMs(z) ?? Infinity);
    const byDoneDesc = (a, z) =>
      new Date(z.updated_at || z.scheduled_end || 0).getTime() - new Date(a.updated_at || a.scheduled_end || 0).getTime();
    const fieldRank = (wo) => {
      if (wo.status === "in_progress") return 0;
      const d = jobAnchor(wo);
      return d && sod(d).getTime() < t0 ? 1 : 2;
    };
    b.field.sort((a, z) => fieldRank(a) - fieldRank(z) || byStart(a, z));
    b.nodate.sort((a, z) => new Date(z.created_at || 0) - new Date(a.created_at || 0));
    b.done.sort(byDoneDesc);
    b.off.sort(byDoneDesc);
    const weeks = [...byWeek.entries()]
      .sort((a, z) => a[0] - z[0])
      .map(([t, list]) => {
        const sunday = new Date(t);
        list.sort(byStart);
        return { key: ymd(sunday), label: weekGroupLabel(sunday, now), rows: list };
      });
    const next = weeks.flatMap((w) => w.rows);
    const order = [
      ["nodate", "Sem data", b.nodate, null],
      // In the field now, plus what is due today or overdue.
      ["field", "Agora", b.field, null],
      ["next", "Próximos jobs", next, weeks],
      ["done", "Concluídos", b.done, null],
      ["off", "Cancelados", b.off, null],
    ];
    return order.filter(([, , g]) => g.length);
  }
  function groupHead(key, label, count) {
    const bar = BAR_GROUPS.has(key) ? ' data-ol-bar="1"' : "";
    const short = BAR_SHORT[key] ? ` data-ol-short="${BAR_SHORT[key]}"` : "";
    const closed = key === "nodate" ? ' data-ol-closed="1"' : "";
    const countHtml = key === "nodate" ? `<em class="jx-ping"><i aria-hidden="true"></i>${count}</em>` : `<em>${count}</em>`;
    return `<p class="jx-grp ol-grp"${bar}${short}${closed}><span>${label}</span>${countHtml}</p>`;
  }
  function weekFoldHtml(weeks) {
    const chev = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
    return weeks
      .map((w, i) => {
        const open = q || showAll ? true : weekOpen.has(w.key) ? weekOpen.get(w.key) : i === 0;
        const rows = w.rows.map((wo) => rowHtml(wo, false)).join("");
        return `<details class="jx-wk"${open ? " open" : ""} data-jx-week="${w.key}"><summary>${chev}<span>${w.label}</span><em>${w.rows.length}</em></summary>${rows}</details>`;
      })
      .join("");
  }
  function weekTitle(sunday) {
    const end = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 6);
    const mo = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    const a = `${sunday.getDate()} ${mo[sunday.getMonth()]}`;
    const b = `${end.getDate()} ${mo[end.getMonth()]}`;
    return `${a} – ${b}`;
  }
  function renderWeekCal() {
    const host = $("jxCal");
    const btn = $("jxCalBtn");
    if (btn) {
      btn.classList.toggle("is-on", Boolean(weekFilter));
      btn.setAttribute("aria-expanded", calOpen ? "true" : "false");
    }
    if (!host) return;
    host.hidden = !calOpen;
    if (!calOpen) {
      host.innerHTML = "";
      return;
    }
    const y = calCursor.getFullYear();
    const m = calCursor.getMonth();
    const first = new Date(y, m, 1);
    const start = weekSunday(first);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const marked = new Set(all.map(jobAnchor).filter(Boolean).map((d) => ymd(d)));
    const today = ymd(new Date());
    const sel = weekFilter ? ymd(weekFilter) : "";
    const rawLabel = calCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
    host.innerHTML = `<div class="jx-cal__bar"><button type="button" data-jx-cal="prev" aria-label="Mês anterior">‹</button><b>${I().esc(label)}</b><button type="button" data-jx-cal="next" aria-label="Próximo mês">›</button></div>
      <div class="jx-cal__wd">${["D", "S", "T", "Q", "Q", "S", "S"].map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="jx-cal__days">${days
        .map((d) => {
          const on = ymd(weekSunday(d)) === sel;
          const muted = d.getMonth() !== m;
          const has = marked.has(ymd(d));
          return `<button type="button" class="jx-cal__d${on ? " is-week" : ""}${muted ? " is-muted" : ""}${ymd(d) === today ? " is-today" : ""}${has ? " has-job" : ""}" data-jx-day="${ymd(d)}">${d.getDate()}</button>`;
        })
        .join("")}</div>
      <button type="button" class="jx-cal__all${weekFilter ? "" : " is-on"}" data-jx-cal="all">Todas as semanas</button>`;
  }
  function requestHit(item) {
    if (!q) return true;
    const text = [item.title, item.address, item.partner_company, item.partner_name, item.external_ref, item.service_type, item.notes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(q) || (q.length >= 5 && text.includes(q.slice(1)));
  }
  function showPending() {
    if (statusFilter && statusFilter !== "Rascunho" && statusFilter !== "Sem data") return false;
    if (filter && filter !== "all" && filter !== "nodate") return false;
    if (source && source !== "builder") return false;
    return true;
  }
  function pendingRequestHtml(item) {
    const J = I();
    const jobId = item.target_job && item.target_job.id;
    const href = jobId
      ? `job-detail.html?id=${encodeURIComponent(jobId)}`
      : `partner-requests-admin.html?id=${encodeURIComponent(item.id)}`;
    const who = item.partner_company || item.partner_name || "Builder";
    const addr = item.address && item.address !== "—" ? `<span class="ol-m jx-row__addr" title="${J.esc(item.address)}">${SVG.pin}<span>${J.esc(item.address)}</span></span>` : "";
    return `<div class="jx-rowwrap"><a class="jx-row ol-row" href="${href}" ${jobId ? `data-jx-id="${J.esc(jobId)}"` : ""}>
      <b class="ol-t" title="${J.esc(who)}">${J.esc(who)}</b>
      <span class="ol-d">Pedido</span>
      ${addr}
      <span class="ol-f"><span class="ol-st is-hot">Aguardando</span><span class="ol-note">${J.esc(item.title || "Pedido do builder")}</span></span>
    </a></div>`;
  }
  function stripWeek() {
    return weekFilter ? weekSunday(weekFilter) : weekSunday(new Date());
  }
  const FOLD_LABELS = ["Sem data", "Do portal", "Em Campo", "Próximos jobs", "Concluídos", "Cancelados"];
  function foldKey() {
    const list = $("jxRows")?.closest(".ol-list");
    if (list && list.__ol && list.__ol.key) return list.__ol.key;
    return "olFold:" + location.pathname + ":jxRows";
  }
  function setGroupFolds(openLabel) {
    const key = foldKey();
    let folds = {};
    try { folds = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { folds = {}; }
    if (!folds || typeof folds !== "object") folds = {};
    FOLD_LABELS.forEach((label) => { folds[label] = openLabel ? label !== openLabel : false; });
    try { localStorage.setItem(key, JSON.stringify(folds)); } catch (e) {}
  }
  /** Past week still has work in Em Campo: em andamento, atrasado ou agendado naquela semana. */
  function weekHasFieldWork(sunday) {
    const t0 = sod(new Date()).getTime();
    return visibleRows().some((wo) => {
      if (wo.status === "completed" || wo.status === "canceled") return false;
      const d = jobAnchor(wo);
      if (!d || !sameWeek(d, sunday)) return false;
      if (wo.status === "in_progress") return true;
      const t = sod(d).getTime();
      return t < t0 || !!(I().late && I().late(wo));
    });
  }
  /**
   * Semana atual: só Em Campo. Passada: Em Campo se ainda há job em andamento, senão só Concluídos.
   * Seguinte: só Próximos jobs. A mesma semana não mexe no que a pessoa abriu na mão.
   */
  function revealWeek(sunday) {
    const sun = weekSunday(sunday);
    const key = ymd(sun);
    const leavingAll = showAll;
    showAll = false;
    if (appliedWeekKey === key && !leavingAll) return;
    const first = !appliedWeekKey;
    appliedWeekKey = key;
    const now = weekSunday(new Date()).getTime();
    const selected = sun.getTime();
    let open = "Em Campo";
    if (selected > now) open = "Próximos jobs";
    else if (selected < now) open = weekHasFieldWork(sun) ? "Em Campo" : "Concluídos";
    setGroupFolds(open);
    weekOpen.forEach((_, k) => { if (k !== key) weekOpen.set(k, false); });
    weekOpen.set(key, open === "Próximos jobs");
    if (!first) {
      pendingWeekKey = key;
      pendingWeekLabel = open;
    }
  }
  function scrollWeekIntoView(key, label) {
    const rows = $("jxRows");
    if (!rows) return;
    const run = () => {
      const week = label === "Próximos jobs" ? rows.querySelector(`details.jx-wk[data-jx-week="${key}"]`) : null;
      const head = [...rows.querySelectorAll(".ol-grp")].find((h) => (h.querySelector("span") || h).textContent.trim() === label);
      const target = week || head;
      if (!target) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (rows.scrollHeight <= rows.clientHeight + 4) return;
      const top = target.getBoundingClientRect().top - rows.getBoundingClientRect().top + rows.scrollTop - 6;
      rows.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    };
    setTimeout(run, 48);
  }
  function shiftWeek(delta) {
    const start = stripWeek();
    weekFilter = new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta * 7);
    dayFilter = null;
    weekSlide = delta > 0 ? 1 : -1;
    revealWeek(weekFilter);
    renderList();
  }
  function weekPage(start) {
    const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const today = ymd(new Date());
    const counts = {};
    visibleRows().forEach((wo) => {
      const d = jobAnchor(wo);
      if (!d) return;
      const key = ymd(sod(d));
      counts[key] = (counts[key] || 0) + 1;
    });
    const chips = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = ymd(d);
      const on = dayFilter === key;
      const dot = on
        ? `<span class="jx-daychip__x" aria-hidden="true">×</span>`
        : counts[key] ? `<span class="jx-daychip__dot"></span>` : `<span class="jx-daychip__dot is-empty"></span>`;
      const picked = on ? ` aria-label="${names[d.getDay()]} ${d.getDate()}, selecionado"` : "";
      return `<button type="button" class="jx-daychip${on ? " is-on" : ""}${key === today ? " is-today" : ""}" data-jx-strip="${key}" role="tab" aria-selected="${on ? "true" : "false"}"${picked}><span class="jx-daychip__name">${names[d.getDay()]}</span><b>${d.getDate()}</b>${dot}</button>`;
    }).join("");
    return `<div class="jx-weekpage">${chips}</div>`;
  }
  function clearDay() {
    if (!dayFilter) return;
    dayFilter = null;
    renderList();
  }
  function syncDayOff() {
    const btn = $("jxDayOff");
    const label = $("jxDayOffLabel");
    if (!btn || !label) return;
    if (!dayFilter) {
      btn.hidden = true;
      label.textContent = "";
      btn.removeAttribute("aria-label");
      return;
    }
    const [yy, mm, dd] = dayFilter.split("-").map(Number);
    const d = new Date(yy, mm - 1, dd);
    const names = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const mo = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    const text = `${names[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]}`;
    label.textContent = text;
    btn.hidden = false;
    btn.setAttribute("aria-label", `Tirar ${text}`);
  }
  function renderWeekStrip() {
    const host = $("jxWeekStrip");
    if (!host) return;
    const start = stripWeek();
    const dir = weekSlide;
    weekSlide = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!dir || reduce) {
      host.innerHTML = weekPage(start);
      return;
    }
    const other = new Date(start.getFullYear(), start.getMonth(), start.getDate() - dir * 7);
    const pages = dir > 0 ? weekPage(other) + weekPage(start) : weekPage(start) + weekPage(other);
    const pageW = host.clientWidth;
    if (pageW < 8) {
      host.innerHTML = weekPage(start);
      return;
    }
    host.innerHTML = `<div class="jx-weektrack">${pages}</div>`;
    const track = host.querySelector(".jx-weektrack");
    track.querySelectorAll(".jx-weekpage").forEach((page) => {
      page.style.flex = "none";
      page.style.width = `${pageW}px`;
    });
    track.style.width = `${pageW * 2}px`;
    const from = dir > 0 ? 0 : -pageW;
    const to = dir > 0 ? -pageW : 0;
    track.style.transition = "none";
    track.style.transform = `translate3d(${from}px,0,0)`;
    track.getBoundingClientRect();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (host.contains(track)) host.innerHTML = weekPage(start);
    };
    requestAnimationFrame(() => {
      track.style.transition = "transform .46s cubic-bezier(.22, .7, .3, 1)";
      track.style.transform = `translate3d(${to}px,0,0)`;
    });
    track.addEventListener("transitionend", (e) => {
      if (e.target === track && e.propertyName === "transform") finish();
    });
    setTimeout(finish, 520);
  }
  function showEveryJob() {
    // Second click goes back to the week on the strip.
    if (showAll) {
      showAll = false;
      revealWeek(stripWeek());
      renderList();
      return;
    }
    showAll = true;
    weekFilter = null;
    dayFilter = null;
    setGroupFolds(null);
    weekOpen.forEach((_, k) => weekOpen.set(k, true));
    renderList();
  }
  function renderList() {
    const list = $("jxRows")?.closest(".ol-list");
    if (list && list.__ol) list.__ol.allOn = showAll;
    syncAllBtn();
    if (!appliedWeekKey && !showAll) revealWeek(stripWeek());
    syncDayOff();
    renderWeekStrip();
    let rows = visibleRows();
    if (!showAll && dayFilter) {
      rows = rows.filter((wo) => {
        const d = jobAnchor(wo);
        return d && ymd(sod(d)) === dayFilter;
      });
    } else if (!showAll && weekFilter) {
      rows = rows.filter((wo) => {
        const d = jobAnchor(wo);
        if (!d) return true;
        return sameWeek(d, weekFilter);
      });
    }
    const pending = showPending() ? portalRequests.filter(requestHit) : [];
    const portalIds = new Set(rows.filter((w) => w.from_portal && I().isActive(w)).map((w) => String(w.id)));
    const portal = sortRows(rows.filter((w) => portalIds.has(String(w.id))));
    rows = rows.filter((w) => !portalIds.has(String(w.id)));
    const host = $("jxRows");
    if (!rows.length && !portal.length && !pending.length) {
      const empty = q
        ? `Nenhum job para “${I().esc(q)}”. Abra o quote e use Abrir job, ou busque pelo builder, endereço ou número do quote.`
        : all.length
          ? "Nenhum job neste filtro."
          : 'Nenhum job ainda. Use Job ou aprove um quote.';
      host.innerHTML =
        !q && !all.length && window.MateFace
          ? window.MateFace.empty({ pose: "point", title: "Nenhum job ainda", text: "Aprove um quote ou crie um job. Posso montar com você.", ask: "criar um job", askLabel: "Criar com o Mate" })
          : `<p class="jx-empty">${empty}</p>`;
      pendingWeekKey = null;
      return rows;
    }
    let html = "";
    if (pending.length || portal.length) {
      html += `<section class="jx-week jx-week--portal ol-band"><p class="jx-grp jx-grp--portal ol-grp"><span>Do portal</span><em>${pending.length + portal.length}</em></p>${pending.map(pendingRequestHtml).join("")}${portal.map((wo) => rowHtml(wo, true)).join("")}</section>`;
    }
    dayGroups(rows).forEach(([key, label, g, weeks]) => {
      const now = NOW_GROUPS.has(key);
      const body = weeks ? weekFoldHtml(weeks) : g.map((wo) => rowHtml(wo, now)).join("");
      html += `<section class="jx-week ol-band">${groupHead(key, label, g.length)}${body}</section>`;
    });
    host.innerHTML = html;
    host.querySelectorAll("details.jx-wk").forEach((el) => {
      el.addEventListener("toggle", () => {
        if (q) return;
        const key = el.getAttribute("data-jx-week");
        if (key) weekOpen.set(key, el.open);
      });
    });
    if (pendingWeekKey) {
      const key = pendingWeekKey;
      const label = pendingWeekLabel;
      pendingWeekKey = null;
      pendingWeekLabel = null;
      scrollWeekIntoView(key, label);
    }
    if (window.OmGestures) window.OmGestures.bindSwipeRow?.(host);
    host.querySelectorAll("[data-jx-start]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wo = all.find((w) => String(w.id) === String(btn.getAttribute("data-jx-start")));
        if (wo && window.__crmJobModal?.openEdit) window.__crmJobModal.openEdit(wo.id);
      });
    });
    host.querySelectorAll("[data-jx-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void deleteJob(btn.getAttribute("data-jx-delete"), btn.getAttribute("data-jx-label"), btn);
      });
    });
    return [...portal, ...rows];
  }

  // ---------------------------------------------------------------- detail
  let sessionPerms = [];
  let sessionRole = "";
  let fieldSummaryFor = null;
  const DETAIL_TABS = [
    ["geral", "Visão geral"],
    ["fotos", "Fotos"],
    ["campo", "Campo"],
    ["stain", "Stain"],
    ["conversa", "Conversa"],
  ];

  function unitLabel(u) {
    const m = { sqft: "sq ft", sq_ft: "sq ft", lf: "lf", linear_ft: "lf", step: "steps", steps: "steps", each: "un", unit: "un", hour: "h" };
    return m[u] || (u ? String(u).replace(/_/g, " ") : "sq ft");
  }
  function qty(n) {
    const x = Number(n) || 0;
    return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function destroyDetailMounts() {
    if (commsCtl && typeof commsCtl.destroy === "function") {
      try {
        commsCtl.destroy();
      } catch (_) {}
    }
    commsCtl = null;
    billingCtl = null;
  }

  function hasPartnerPortal(wo) {
    const customerType = String(wo?.customer_type || "").toLowerCase();
    const source = String(wo?.source_type || "").toLowerCase();
    return Boolean(wo?.from_portal || wo?.builder_id) || customerType === "builder" || customerType === "contractor" || source === "builder" || source === "contractor";
  }
  function detailTabs(wo) {
    return hasPartnerPortal(wo) ? [...DETAIL_TABS, ["builder", "Builder"]] : DETAIL_TABS;
  }
  function partnerShareButton(attr, id, on, onLabel, offLabel, extra) {
    const J = I();
    if (!canManage) return on ? "No portal" : "Oculto";
    return `<button type="button" class="jx-share${on ? " is-on" : ""}" ${attr}="${J.esc(id)}" data-on="${on ? "1" : "0"}"${extra ? ` ${extra}` : ""}>${on ? onLabel : offLabel}</button>`;
  }
  function partnerDocsHtml(wo) {
    const J = I();
    if (!partnerDocs || String(partnerDocs.jobId) !== String(wo.id)) {
      return window.crmSkeleton
        ? `<div id="jxPartnerWait" aria-busy="true">${window.crmSkeleton.rows(3, { avatar: false })}</div>`
        : `<p class="jx-none" id="jxPartnerWait">Carregando o que o parceiro vê…</p>`;
    }
    const rows = [];
    const file = wo.delivery_attachment;
    if (file?.url) {
      rows.push(`<li><span><b>${J.esc(file.name || "Arquivo")}</b><small>Delivery</small></span>${file.key ? partnerShareButton("data-jx-partner-file", wo.id, Boolean(file.shared_with_partners), "No portal", "Compartilhar") : ""}</li>`);
    }
    (partnerDocs.media || []).forEach((m) => {
      const stage = m.stage === "before" ? "Antes" : m.stage === "during" ? "Durante" : m.stage === "after" ? "Depois" : "Foto";
      rows.push(`<li><span><b>${J.esc(m.caption || stage)}</b><small>${J.esc(stage)}</small></span>${partnerShareButton("data-jx-partner-media", m.id, Boolean(m.shared_with_partners), "No portal", "Compartilhar")}</li>`);
    });
    (partnerDocs.reports || []).forEach((r) => {
      const published = r.status === "published";
      rows.push(`<li><span><b>${J.esc(r.title || "Relatório")}</b><small>${published ? "Relatório publicado" : "Publique o relatório antes de compartilhar"}</small></span>${partnerShareButton("data-jx-partner-report", r.id, Boolean(r.shared_with_partners), "No portal", "Compartilhar", published || r.shared_with_partners ? "" : 'disabled title="Publique o relatório antes de compartilhar"')}</li>`);
    });
    if (!rows.length) return `<p class="jx-none">Nada para liberar ainda. Fotos, relatórios e o arquivo de delivery aparecem aqui.</p>`;
    return `<ul class="jx-partner-list">${rows.join("")}</ul>`;
  }
  function partnerBox(wo) {
    if (!hasPartnerPortal(wo)) return "";
    const J = I();
    const who = J.builderName(wo) || J.client(wo);
    const access = wo.customer_id ? `customers.html?id=${encodeURIComponent(wo.customer_id)}` : "";
    return `<div class="jx-box"><h3>Portal do parceiro</h3>
      <p class="jx-note">${J.esc(who)} vê este job na sessão Jobs do portal. Só entra em Documentos o que estiver liberado abaixo.</p>
      <div class="jx-partner">
        <a class="jx-btn" href="partner-login.html" target="_blank" rel="noopener">Abrir portal</a>
        ${access ? `<a class="jx-btn" href="${J.esc(access)}">Acesso do parceiro</a>` : ""}
      </div>
      <div id="jxPartnerDocs">${partnerDocsHtml(wo)}</div>
    </div>`;
  }
  function ensurePartnerDocs(wo) {
    if (!wo || !hasPartnerPortal(wo)) return;
    if (partnerDocs && String(partnerDocs.jobId) === String(wo.id)) return;
    const id = wo.id;
    const seq = ++partnerDocsSeq;
    Promise.all([
      api(`/api/work-orders/${encodeURIComponent(id)}/media`).catch(() => ({ data: [] })),
      api(`/api/work-orders/${encodeURIComponent(id)}/reports`).catch(() => ({ data: [] })),
    ]).then(([media, reports]) => {
      if (seq !== partnerDocsSeq || String(selId) !== String(id)) return;
      partnerDocs = { jobId: id, media: media.data || [], reports: reports.data || [] };
      const host = $("jxPartnerDocs");
      const current = detailWo && String(detailWo.id) === String(id) ? detailWo : all.find((w) => String(w.id) === String(id));
      if (host && current) host.innerHTML = partnerDocsHtml(current);
    }).catch(() => {
      const host = $("jxPartnerDocs");
      if (host && seq === partnerDocsSeq) host.innerHTML = `<p class="jx-none">Não foi possível carregar o portal do parceiro.</p>`;
    });
  }
  async function togglePartnerShare(btn, kind) {
    const id = selId;
    if (!id || !canManage) return;
    const next = btn.getAttribute("data-on") !== "1";
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Salvando…";
    const target = kind === "media"
      ? `/api/work-orders/${encodeURIComponent(id)}/media/${encodeURIComponent(btn.getAttribute("data-jx-partner-media") || "")}/partner-share`
      : kind === "report"
        ? `/api/work-orders/${encodeURIComponent(id)}/reports/${encodeURIComponent(btn.getAttribute("data-jx-partner-report") || "")}/partner-share`
        : `/api/work-orders/${encodeURIComponent(id)}/delivery-attachment/share-with-partner`;
    try {
      const j = await api(target, { method: "PATCH", body: JSON.stringify({ shared_with_partners: next }) });
      if (kind === "media" && partnerDocs) {
        partnerDocs.media = (partnerDocs.media || []).map((m) => (m.id === j.data?.id ? j.data : m));
      } else if (kind === "report" && partnerDocs) {
        partnerDocs.reports = (partnerDocs.reports || []).map((r) => (r.id === j.data?.id ? j.data : r));
      } else {
        const apply = (wo) => wo?.delivery_attachment ? { ...wo, delivery_attachment: { ...wo.delivery_attachment, shared_with_partners: next } } : wo;
        if (detailWo && String(detailWo.id) === String(id)) detailWo = apply(detailWo);
        const ix = all.findIndex((w) => String(w.id) === String(id));
        if (ix >= 0) all[ix] = apply(all[ix]);
      }
      const current = detailWo && String(detailWo.id) === String(id) ? detailWo : all.find((w) => String(w.id) === String(id));
      const host = $("jxPartnerDocs");
      if (host && current) host.innerHTML = partnerDocsHtml(current);
      notify(next ? "Liberado no portal do parceiro." : "Removido do portal do parceiro.", "success");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = prev;
      notify(err.message || "Não foi possível atualizar o portal.", "error");
    }
  }

  function panelGeral(wo) {
    const J = I();
    const lines = wo.line_items || [];
    const svc = lines.length
      ? `<table class="jx-tbl"><thead><tr><th>Serviço</th><th class="r">Qtd</th><th class="r">Preço</th><th class="r">Total</th></tr></thead><tbody>${lines
          .map((l) => {
            const note = String(l.notes || "").trim();
            return `<tr><td>${J.esc(l.service_name)}${note ? `<small class="jx-svc-note">${J.esc(note)}</small>` : ""}</td><td class="r">${qty(l.quantity_sqft)} ${J.esc(unitLabel(l.unit))}</td><td class="r jx-mu">${J.money(l.unit_price)}</td><td class="r">${J.money(l.line_total)}</td></tr>`;
          })
          .join("")}</tbody><tfoot><tr><td colspan="3">Total do job</td><td class="r">${J.money(wo.services_total)}</td></tr></tfoot></table>`
      : `<p class="jx-none">Nenhum serviço ainda.${canManage ? " Adicione pela Tabela de Valores." : ""}</p>`;
    const { code, text: notes } = window.JobHeader.noteParts(wo.notes);
    const invoicesHref = `invoices.html?q=${encodeURIComponent(wo.number != null ? `Job #${wo.number}` : wo.title || "")}`;
    return `<div class="jx-cols">
      <div>
        <div class="jx-box"><h3>Serviços${canManage ? `<button type="button" class="jx-lnk" data-jx-act="services">Editar</button>` : ""}</h3>${svc}</div>
        ${
          notes
            ? `<div class="jx-box"><h3>Notas da obra${canManage ? `<button type="button" class="jx-lnk" data-jx-act="notes">Editar</button>` : ""}</h3><p class="jx-note">${J.esc(notes)}</p></div>`
            : `<div class="jx-box is-empty"><h3>Notas da obra<span class="jx-hint">${code ? "Só o código da caixa, que está no cabeçalho" : canManage ? "Acesso, portão, cuidados com a obra" : "Sem notas"}</span>${canManage ? `<button type="button" class="jx-lnk" data-jx-act="notes">${code ? "Editar" : "Adicionar"}</button>` : ""}</h3></div>`
        }
      </div>
      <div>
        ${canBill ? `<div class="jx-box jx-billing"><h3>Faturas${(wo.invoices || []).length ? `<a class="jx-lnk" href="${J.esc(invoicesHref)}">Ver todas</a>` : ""}</h3><div id="jxBilling"></div></div>` : ""}
        ${partnerBox(wo)}
      </div>
    </div>`;
  }

  function panelFotos(wo) {
    const n = mediaCache ? mediaCache.length : null;
    return `${partnerBox(wo)}<div class="jx-box">
      <h3>Fotos${n != null ? `<span class="jx-ch__n">${n}</span>` : ""}</h3>
      <div id="jxPhotos">${n == null ? `<p class="jx-none">A carregar fotos…</p>` : ""}</div>
    </div>`;
  }

  function panelCampo(wo) {
    return `<div id="jxField">${fieldCache == null ? `<div class="jx-box"><p class="jx-none">A carregar campo…</p></div>` : ""}</div>`;
  }

  function panelStain() {
    return `<div id="jxStain"></div>`;
  }

  function panelConversa() {
    return `<div class="jx-box"><h3>Conversa da obra<a class="jx-lnk" href="chat.html">Abrir ObraChat</a></h3><div id="jxComms"></div></div>`;
  }

  function renderPhotosBody() {
    const box = $("jxPhotos");
    if (!box || mediaCache == null) return;
    const J = I();
    if (!mediaCache.length) {
      box.innerHTML = `<p class="jx-none">Nenhuma foto ainda. Use ObraCam no campo ou envie pelo celular.</p>`;
      return;
    }
    box.innerHTML = `<div class="jx-photos">${mediaCache
      .slice(0, 24)
      .map((m) => {
        const src = m.thumb_url || m.url || m.preview_url || "";
        const stage = m.stage === "before" ? "Antes" : m.stage === "during" ? "Durante" : m.stage === "after" ? "Depois" : "";
        return `<a class="jx-ph" href="${J.esc(m.url || src)}" target="_blank" rel="noopener"${src ? ` style="background-image:url('${J.esc(src)}')"` : ""}>${stage ? `<span>${J.esc(stage)}</span>` : ""}</a>`;
      })
      .join("")}</div>${mediaCache.length > 24 ? `<p class="jx-none" style="margin-top:10px">${mediaCache.length - 24} foto(s) a mais no ObraCam.</p>` : ""}`;
  }

  function renderFieldBody(wo) {
    const box = $("jxField");
    if (!box) return;
    const J = I();
    const f = fieldCache;
    if (!f) {
      box.innerHTML = `<div class="jx-box"><p class="jx-none">Não foi possível carregar o campo.</p></div>`;
      return;
    }
    const c = f.checklist;
    const checklistOn = f.checklist_enabled !== false;
    const att = String(wo.campo_attention || "").trim();
    const h = f.hours || { total: 0, people: [] };
    const people = Array.isArray(h.people) ? h.people : [];
    const measures = Array.isArray(f.measurements) ? f.measurements : [];
    const inspections = Array.isArray(f.inspections) ? f.inspections : [];
    const pct = c?.customized && c.total ? Math.round((c.done / c.total) * 100) : 0;

    const checklistBlock = !checklistOn
      ? ""
      : `<section class="jx-campo__card">
          <header class="jx-campo__hd">
            <div>
              <h3>Checklist</h3>
              ${c?.customized ? `<p class="jx-campo__sub">${c.done} de ${c.total} · ${pct}%</p>` : `<p class="jx-campo__sub">O que a equipe precisa fazer na obra</p>`}
            </div>
            ${canManage ? `<button type="button" class="jx-btn jx-btn--sm" data-jx-act="campo">${c?.customized ? "Editar" : "Criar"}</button>` : ""}
          </header>
          ${
            !c?.customized
              ? `<div class="jx-campo__empty">
                  <p>Nenhum checklist neste job.</p>
                  ${canManage ? `<button type="button" class="jx-btn jx-btn--pri jx-btn--sm" data-jx-act="campo">Criar checklist</button>` : ""}
                </div>`
              : `<div class="jx-campo__bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
                 <ul class="jx-check">${(c.items || [])
                   .map((i) => {
                     const tags = [
                       i.photo_required ? (i.photos ? `${i.photos} foto${i.photos > 1 ? "s" : ""}` : "foto obrigatória") : "",
                     ].filter(Boolean);
                     return `<li class="${i.done ? "is-done" : ""}"><i aria-hidden="true">${i.done ? "✓" : ""}</i><span><b>${J.esc(i.text)}</b>${
                       tags.length ? `<em class="jx-tag">${J.esc(tags.join(" · "))}</em>` : ""
                     }${i.done && i.done_by ? `<small>${J.esc(i.done_by)}</small>` : ""}${i.note ? `<small>${J.esc(i.note)}</small>` : ""}</span></li>`;
                   })
                   .join("")}</ul>`
          }
        </section>`;

    const hoursBlock = `<section class="jx-campo__card">
      <header class="jx-campo__hd">
        <div>
          <h3>Horas na obra</h3>
          <p class="jx-campo__sub">${h.total ? `${qty(h.total)} h registradas` : "Ainda sem horas lançadas"}</p>
        </div>
      </header>
      ${
        people.length
          ? `<ul class="jx-people">${people
              .map(
                (p) => `<li><span class="jx-av">${J.esc(J.initials(p.name))}</span><span><b>${J.esc(p.name)}</b><small>${p.days || 0} dia${
                  p.days === 1 ? "" : "s"
                }${p.sqft ? ` · ${qty(p.sqft)} sq ft` : ""}</small></span><em>${qty(p.hours)} h</em></li>`,
              )
              .join("")}</ul>`
          : `<p class="jx-none">Ninguém registrou horas neste job ainda.</p>`
      }
    </section>`;

    const measuresBlock = measures.length
      ? `<section class="jx-campo__card">
          <header class="jx-campo__hd"><div><h3>Medições</h3><p class="jx-campo__sub">${measures.length} lançamento${measures.length > 1 ? "s" : ""} do campo</p></div></header>
          <table class="jx-tbl"><tbody>${measures
            .map(
              (m) =>
                `<tr><td>${J.esc(m.label)}${m.note ? `<small class="jx-svc-note">${J.esc(m.note)}</small>` : ""}</td><td class="r">${J.esc(qty(m.value))} ${J.esc(m.unit || "")}</td></tr>`,
            )
            .join("")}</tbody></table>
        </section>`
      : "";

    const inspBlock = inspections.length
      ? `<section class="jx-campo__card">
          <header class="jx-campo__hd"><div><h3>Inspeções por voz</h3><p class="jx-campo__sub">${inspections.length} registro${inspections.length > 1 ? "s" : ""}</p></div></header>
          <ul class="jx-insp">${inspections
            .map(
              (i) =>
                `<li><small>${J.esc(new Date(i.created_at).toLocaleString("pt-BR"))}</small><p>${J.esc(i.summary || "Sem resumo")}</p></li>`,
            )
            .join("")}</ul>
        </section>`
      : "";

    box.innerHTML = `
      <div class="jx-campo">
        <section class="jx-campo__card jx-campo__card--attention">
          <header class="jx-campo__hd">
            <div>
              <h3>Atenção para o campo</h3>
              <p class="jx-campo__sub">Aparece em destaque no ticket da equipe</p>
            </div>
          </header>
          ${
            canManage
              ? `<textarea class="jx-ta" id="jxAttention" rows="3" maxlength="2000" placeholder="Ex.: proteger degraus, cachorro no quintal, código do portão…">${J.esc(att)}</textarea>
                 <div class="jx-campo__row">
                   <button type="button" class="jx-btn jx-btn--pri jx-btn--sm" data-jx-act="save-attention">Salvar aviso</button>
                   <span class="jx-campo__hint" id="jxAttentionHint">${att ? "Salvo" : "Vazio — a equipe não vê aviso"}</span>
                 </div>`
              : att
                ? `<p class="jx-note">${J.esc(att)}</p>`
                : `<p class="jx-none">Nada destacado para a equipe.</p>`
          }
        </section>

        <div class="jx-campo__grid">
          <div class="jx-campo__col">${checklistBlock}${measuresBlock}${inspBlock}</div>
          <div class="jx-campo__col">${hoursBlock}</div>
        </div>
      </div>`;
  }

  function mountLazyPanels(wo) {
    if (detailTab === "geral" && canBill && window.JobBilling && $("jxBilling")) {
      billingCtl = window.JobBilling.mountCard($("jxBilling"), {
        jobId: wo.id,
        jobStatus: wo.status,
        canManage: canInvoice,
      });
    }
    if (detailTab === "stain" && window.JobStain && $("jxStain")) {
      window.JobStain.mount($("jxStain"), { jobId: wo.id, notify });
    }
    if (detailTab === "fotos") {
      if (mediaCache && String(mediaCache._jobId) === String(wo.id)) renderPhotosBody();
      else {
        mediaCache = null;
        api(`/api/work-orders/${encodeURIComponent(wo.id)}/media`)
          .then((j) => {
            if (String(selId) !== String(wo.id) || detailTab !== "fotos") return;
            mediaCache = j.data || [];
            mediaCache._jobId = wo.id;
            renderPhotosBody();
            const tab = document.querySelector('[data-jx-tab="fotos"]');
            if (tab && mediaCache.length) tab.innerHTML = `Fotos <em>${mediaCache.length}</em>`;
          })
          .catch(() => {
            const box = $("jxPhotos");
            if (box) box.innerHTML = `<p class="jx-none">Não foi possível carregar as fotos.</p>`;
          });
      }
    }
    if (detailTab === "campo") {
      if (fieldCache && String(fieldCache._jobId) === String(wo.id)) renderFieldBody(wo);
      else {
        fieldCache = null;
        api(`/api/work-orders/${encodeURIComponent(wo.id)}/field`)
          .then((j) => {
            if (String(selId) !== String(wo.id) || detailTab !== "campo") return;
            fieldCache = j.data || null;
            if (fieldCache) fieldCache._jobId = wo.id;
            renderFieldBody(wo);
            const c = fieldCache?.checklist;
            const tab = document.querySelector('[data-jx-tab="campo"]');
            if (tab && c?.customized) tab.innerHTML = `Campo <em>${c.done}/${c.total}</em>`;
          })
          .catch(() => {
            const box = $("jxField");
            if (box) box.innerHTML = `<div class="jx-box"><p class="jx-none">Não foi possível carregar o campo.</p></div>`;
          });
      }
    }
    if (detailTab === "conversa" && window.JobChatComms && $("jxComms")) {
      commsCtl = window.JobChatComms.mount($("jxComms"), {
        jobId: wo.id,
        workOrder: wo,
        compact: true,
        onError: (err) => notify(err.message || "Erro", "error"),
      });
    }
    if (hasPartnerPortal(wo) && window.JobBuilderChannel) {
      if (detailTab === "builder" && $("jxBuilder")) {
        window.JobBuilderChannel.mount($("jxBuilder"), {
          jobId: wo.id,
          canManage,
          notify: (msg, type) => notify(msg, type === "error" ? "error" : "success"),
        });
      } else {
        window.JobBuilderChannel.count(wo.id);
      }
    }
  }

  function renderDetail() {
    const J = I();
    const host = $("jxDetail");
    destroyDetailMounts();
    const listWo = all.find((w) => String(w.id) === String(selId));
    const wo = detailWo && String(detailWo.id) === String(selId) ? detailWo : listWo;
    if (!wo) {
      host.innerHTML =
        missingSel && String(missingSel) === String(selId)
          ? `<div class="jx-blank"><b>Não encontrei esse job.</b><br />O quote aponta para um job que não está mais na lista.</div>`
          : `<div class="jx-blank">Escolha um job na lista.</div>`;
      return;
    }
    const tabs = detailTabs(wo);
    const tab = tabs.some(([k]) => k === detailTab) ? detailTab : "geral";
    detailTab = tab;
    const body =
      tab === "fotos"
        ? panelFotos(wo)
        : tab === "campo"
          ? panelCampo(wo)
          : tab === "stain"
            ? panelStain()
            : tab === "conversa"
              ? panelConversa()
              : tab === "builder"
                ? `<div id="jxBuilder"></div>`
                : panelGeral(wo);

    host.innerHTML = `
      <a class="jx-back" href="#" data-jx-back>${SVG.back}Jobs</a>
      <div id="jxHeader">${window.JobHeader.html(wo, headerCtx(wo))}</div>
      <nav class="jx-tabs" role="tablist">${tabs.map(
        ([k, label]) => `<button type="button" role="tab" class="${k === tab ? "is-on" : ""}" data-jx-tab="${k}" aria-selected="${k === tab}">${label}${k === "builder" ? ` <em id="jdTabBuilder"></em>` : ""}</button>`,
      ).join("")}</nav>
      <div class="jx-panel" data-jx-panel="${tab}">${body}</div>`;
    if (hasPartnerPortal(wo) && (tab === "geral" || tab === "fotos")) ensurePartnerDocs(wo);
    mountLazyPanels(wo);
    ensureFieldSummary(wo);
  }

  function headerCtx(wo) {
    return {
      mode: "panel",
      canManage,
      canBill,
      canInvoice,
      can: (perm) => sessionRole === "admin" || sessionPerms.includes(perm),
      field: fieldCache && String(fieldCache._jobId) === String(wo.id) ? fieldCache : null,
      photos: mediaCache && String(mediaCache._jobId) === String(wo.id) ? mediaCache.length : 0,
    };
  }
  /** The header warns about field problems on every tab, so load them once per job. */
  function ensureFieldSummary(wo) {
    if (fieldCache && String(fieldCache._jobId) === String(wo.id)) return;
    if (fieldSummaryFor === wo.id) return;
    fieldSummaryFor = wo.id;
    api(`/api/work-orders/${encodeURIComponent(wo.id)}/field`)
      .then((j) => {
        if (String(selId) !== String(wo.id) || !j.data) return;
        if (fieldCache && String(fieldCache._jobId) === String(wo.id)) return;
        fieldCache = j.data;
        fieldCache._jobId = wo.id;
        repaintHeader(wo);
        if (detailTab === "campo") renderFieldBody(wo);
      })
      .catch(() => {})
      .finally(() => {
        fieldSummaryFor = null;
      });
  }
  function repaintHeader(wo) {
    const host = $("jxHeader");
    if (host) host.innerHTML = window.JobHeader.html(wo, headerCtx(wo));
  }

  async function ensureDetailWo(id) {
    if (!id) {
      detailWo = null;
      return;
    }
    if (detailWo && String(detailWo.id) === String(id)) return;
    const seq = ++detailFetchSeq;
    try {
      const j = await api(`/api/work-orders/${encodeURIComponent(id)}`);
      if (seq !== detailFetchSeq || String(selId) !== String(id)) return;
      const next = j.data || null;
      if (!next) {
        detailWo = null;
        return;
      }
      const ix = all.findIndex((w) => String(w.id) === String(id));
      const cur = ix >= 0 ? all[ix] : null;
      const nextTs = Date.parse(next.updated_at || "") || 0;
      const curTs = cur ? Date.parse(cur.updated_at || "") || 0 : 0;
      // Never let a slow GET overwrite a newer list/status update (Iniciar / Concluir).
      if (cur && curTs > nextTs) {
        detailWo = { ...next, ...cur };
      } else {
        detailWo = next;
        if (ix >= 0) all[ix] = { ...all[ix], ...next };
      }
      render();
    } catch (_) {
      /* lista já tem o suficiente para a visão geral */
    }
  }

  // The Mate's face (fox) may load after the first render: draw the empty state again with him.
  window.addEventListener('mateface:ready', () => {
    // only when the plain empty text is on screen (never over a list or a loading state)
    if (!document.querySelector('#jxRows .jx-empty')) return;
    try {
      render();
    } catch (_) {}
  });
  let pickDocBound = false;
  function closePicks(except) {
    document.querySelectorAll(".jx-pick__menu").forEach((menu) => {
      if (menu === except) return;
      menu.hidden = true;
      const btn = menu._pickBtn;
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }
  function placePick(menu, btn) {
    const r = btn.getBoundingClientRect();
    const width = Math.max(r.width, 196);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    const space = window.innerHeight - r.bottom - 12;
    menu.style.left = left + "px";
    menu.style.top = (r.bottom + 6) + "px";
    menu.style.width = width + "px";
    menu.style.maxHeight = Math.max(180, Math.min(380, space)) + "px";
  }
  function paintPick(sel) {
    const btn = sel._pickBtn;
    const menu = sel._pickMenu;
    if (!btn || !menu) return;
    const opt = sel.options[sel.selectedIndex];
    const label = sel.closest(".jx-sel")?.querySelector("span")?.textContent || sel.getAttribute("aria-label") || "";
    const valueText = opt ? opt.textContent : "";
    btn.querySelector(".jx-pick__k").textContent = label;
    btn.querySelector(".jx-pick__v").textContent = valueText;
    btn.setAttribute("aria-label", label + (valueText ? ", " + valueText : ""));
    sel.closest(".jx-sel")?.classList.toggle("is-on", !!sel.value);
    const current = sel.value;
    menu.querySelectorAll(".jx-pick__opt").forEach((b) => {
      const on = b.dataset.value === current;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.querySelector("svg").hidden = !on;
    });
  }
  function openPick(sel) {
    const menu = sel._pickMenu;
    const btn = sel._pickBtn;
    if (!menu || !btn) return;
    closePicks(menu);
    placePick(menu, btn);
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const current = menu.querySelector('.jx-pick__opt.is-on') || menu.querySelector(".jx-pick__opt");
    current?.focus();
  }
  function choosePick(sel, value) {
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    paintPick(sel);
    closePicks();
    sel._pickBtn?.focus();
  }
  function bindPick(sel) {
    const wrap = sel.closest(".jx-sel");
    if (!wrap || sel._pickBtn) return;
    sel.classList.add("jx-sel__native");
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jx-pick";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", sel.getAttribute("aria-label") || "Filtro");
    btn.innerHTML = '<span class="jx-pick__k"></span><span class="jx-pick__v"></span><svg class="jx-pick__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const menu = document.createElement("div");
    menu.className = "jx-pick__menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", sel.getAttribute("aria-label") || "Filtro");
    Array.from(sel.options).forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "jx-pick__opt";
      b.setAttribute("role", "option");
      b.dataset.value = opt.value;
      b.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true" hidden><path d="m5 12 5 5L20 7"/></svg>';
      b.querySelector("span").textContent = opt.textContent;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        choosePick(sel, opt.value);
      });
      menu.appendChild(b);
    });
    menu._pickBtn = btn;
    sel._pickBtn = btn;
    sel._pickMenu = menu;
    wrap.appendChild(btn);
    document.body.appendChild(menu);
    paintPick(sel);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.getAttribute("aria-expanded") === "true") closePicks();
      else openPick(sel);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPick(sel);
      }
    });
    menu.addEventListener("keydown", (e) => {
      const opts = Array.from(menu.querySelectorAll(".jx-pick__opt"));
      const i = opts.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); closePicks(); btn.focus(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(opts.length - 1, i + 1)]?.focus(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); opts[Math.max(0, i - 1)]?.focus(); return; }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const cur = opts[i] || opts[0];
        if (cur) choosePick(sel, cur.dataset.value);
      }
    });
    sel.addEventListener("change", () => paintPick(sel));
    if (!pickDocBound) {
      pickDocBound = true;
      document.addEventListener("click", (e) => {
        if (e.target.closest(".jx-pick, .jx-pick__menu")) return;
        closePicks();
      });
      window.addEventListener("resize", () => closePicks());
      document.addEventListener("scroll", (e) => {
        const t = e.target;
        if (t && t.closest && t.closest(".jx-pick__menu")) return;
        closePicks();
      }, true);
    }
  }

  function syncAllBtn() {
    const b = $("jxAll");
    if (!b) return;
    b.classList.toggle("is-on", showAll);
    b.setAttribute("aria-pressed", showAll ? "true" : "false");
  }
  function syncFiltBadge() {
    syncAllBtn();
  }
  function render() {
    syncFiltBadge();
    renderTiles();
    const rows = renderList();
    const wide = window.matchMedia("(min-width: 1025px)").matches;
    const pinned = selId && all.some((w) => String(w.id) === String(selId));
    const asked = new URLSearchParams(location.search).get("id");
    if (wide && !selId && !asked) {
      const first = firstJobToOpen(rows);
      if (first) {
        // Opened for the person, not chosen by them: don't pin it across filters or in the URL.
        const keepFocus = focusId;
        select(first.id, false);
        focusId = keepFocus;
        autoSelected = true;
        return;
      }
    }
    if (wide && !pinned && !rows.some((w) => String(w.id) === String(selId)) && String(selId || "") !== String(asked || "")) {
      const first = $("jxRows").querySelector("[data-jx-id]");
      selId = first ? first.getAttribute("data-jx-id") : null;
      $("jxRows").querySelectorAll("[data-jx-id]").forEach((a) => a.classList.toggle("is-on", a.getAttribute("data-jx-id") === String(selId)));
    } else if (selId) {
      $("jxRows").querySelectorAll("[data-jx-id]").forEach((a) => a.classList.toggle("is-on", a.getAttribute("data-jx-id") === String(selId)));
    }
    if (scrollSel && selId) {
      scrollSel = false;
      $("jxRows").querySelector(".is-on")?.scrollIntoView({ block: "nearest" });
    }
    renderDetail();
  }

  /** The job that matters most right now, in the list's own order; undated ones only after that. */
  function firstJobToOpen(rows) {
    const groups = new Map(dayGroups(rows || []).map(([key, , g]) => [key, g]));
    for (const key of ["field", "next", "nodate", "done", "off"]) {
      if (groups.get(key)?.length) return groups.get(key)[0];
    }
    return null;
  }
  /** A new filter or search shows its own first job instead of keeping the one opened automatically. */
  function releaseAutoSelection() {
    if (!autoSelected) return;
    autoSelected = false;
    selId = null;
    detailWo = null;
  }

  function select(id, push) {
    autoSelected = false;
    const changed = String(selId || "") !== String(id || "");
    selId = id;
    if (id) focusId = id;
    if (changed) {
      detailTab = "geral";
      detailWo = null;
      detailFetchSeq += 1;
      mediaCache = null;
      fieldCache = null;
      partnerDocs = null;
      partnerDocsSeq += 1;
      destroyDetailMounts();
    }
    $("jxRows").querySelectorAll("[data-jx-id]").forEach((a) => a.classList.toggle("is-on", a.getAttribute("data-jx-id") === String(id)));
    renderDetail();
    if (id) void ensureDetailWo(id);
    const narrow = !window.matchMedia("(min-width: 1025px)").matches;
    $("jxSplit").classList.toggle("is-detail", narrow && !!id);
    document.body.classList.toggle("jx-detail-open", narrow && !!id);
    if (push) {
      try {
        const u = new URL(location.href);
        if (id) u.searchParams.set("id", id);
        else u.searchParams.delete("id");
        history.replaceState(null, "", u);
      } catch (_) {}
    }
    if (narrow && id) window.scrollTo(0, 0);
  }

  let loadSeq = 0;
  /** Query the server already applied. Those rows are shown even if a tile or origin filter would hide them. */
  let fetchedQuery = "";
  let scrollSel = false;
  let autoSelected = false;
  let missingSel = null;
  async function load() {
    const seq = ++loadSeq;
    if (firstLoad) {
      const qs = new URLSearchParams(location.search);
      const bmap = { to_invoice: "toinvoice", awaiting_payment: "receivable" };
      if (qs.get("billing") === "paid") statusFilter = "Pago";
      else if (qs.get("billing") && bmap[qs.get("billing")]) filter = bmap[qs.get("billing")];
      if (qs.get("filter")) filter = qs.get("filter");
      if (qs.get("status") && $("jxStatus")) {
        const wanted = qs.get("status") === "Lixa" ? "Em campo" : qs.get("status");
        // Statuses that became tiles keep their old links working.
        const tile = { "Em campo": "field", Agendado: "scheduled", "Sem data": "nodate", "Concluído": "done" }[wanted];
        const known = [...$("jxStatus").options].some((o) => o.value === wanted);
        if (tile) filter = tile;
        else if (known) statusFilter = wanted;
      }
      if ($("jxStatus") && statusFilter) {
        $("jxStatus").value = statusFilter;
        $("jxStatusWrap")?.classList.toggle("is-on", true);
        paintPick($("jxStatus"));
      }
      if (qs.get("sort") === "oldest") sortDir = "oldest";
      if (qs.get("id")) {
        selId = qs.get("id");
        focusId = selId;
        filter = "all";
        q = "";
        scrollSel = true;
        const box = $("jxQ");
        if (box) box.value = "";
      }
    }
    const query = q;
    const params = new URLSearchParams();
    if (query.length >= 2) params.set("q", query);
    const pin = query.length >= 2 ? selId : selId || focusId;
    if (pin) params.set("id", pin);
    const pendingP = canManage
      ? api("/api/partner-requests?status=pending").then((r) => r.data || []).catch(() => [])
      : Promise.resolve([]);
    const [j, pending] = await Promise.all([
      api(`/api/work-orders${params.toString() ? `?${params}` : ""}`),
      pendingP,
    ]);
    if (seq !== loadSeq) return;
    portalRequests = pending;
    fetchedQuery = query.length >= 2 ? query : "";
    all = j.data || [];
    if (selId && !all.some((w) => String(w.id) === String(selId))) {
      try {
        const one = await api(`/api/work-orders/${encodeURIComponent(selId)}`);
        if (seq !== loadSeq) return;
        if (one.data) {
          all = [one.data, ...all];
          missingSel = null;
        } else missingSel = selId;
      } catch (_) {
        missingSel = selId;
      }
    } else if (selId) {
      missingSel = null;
    }
    // Keep detail cache aligned with the list so stage bars follow status changes.
    if (detailWo && selId) {
      const fresh = all.find((w) => String(w.id) === String(selId));
      if (fresh) detailWo = { ...detailWo, ...fresh };
      else detailWo = null;
    }
    if (firstLoad) {
      firstLoad = false;
      const sortEl = $("jxSort");
      if (sortEl) sortEl.value = sortDir;
    }
    render();
    if (selId) {
      if (!window.matchMedia("(min-width: 1025px)").matches && new URLSearchParams(location.search).get("id")) select(selId, false);
      else void ensureDetailWo(selId);
    }
  }

  async function setStatus(id, status, msg) {
    scrollSel = true;
    const j = await api(`/api/work-orders/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    const next = j.data || null;
    detailFetchSeq += 1;
    if (next) {
      const ix = all.findIndex((w) => String(w.id) === String(id));
      if (ix >= 0) all[ix] = { ...all[ix], ...next };
      if (String(selId) === String(id)) detailWo = { ...(detailWo && String(detailWo.id) === String(id) ? detailWo : {}), ...next };
    } else if (String(selId) === String(id)) {
      detailWo = null;
    }
    notify(msg, "success");
    render();
    await load();
  }

  async function finishJob(wo) {
    const J = I();
    const nxt = J.nextFinish(wo);
    const label = wo?.title || (wo ? J.client(wo) : "");
    const ok = await window.crmConfirm.completeJob(label, nxt);
    if (!ok) return;
    await setStatus(wo.id, "completed", nxt?.toast || "Job concluído.");
  }

  async function finishCurrent(wo) {
    const J = I();
    const nxt = J.nextFinish(wo);
    const label = wo?.title || (wo ? J.client(wo) : "");
    const ok = await window.crmConfirm.completeJob(label, nxt);
    if (!ok) return;
    await setStatus(selId, "completed", nxt?.toast || "Job concluído.");
  }

  async function applyStep(idx) {
    if (!canManage || !selId || Number.isNaN(idx)) return;
    const J = I();
    const wo = detailWo && String(detailWo.id) === String(selId) ? detailWo : all.find((w) => String(w.id) === String(selId));
    if (!wo || wo.status === "canceled") return;
    const status = J.statusForStep(idx);
    if (status) {
      if (status === "completed" || (status === "in_progress" && wo.status === "in_progress" && J.nextFinish(wo))) {
        await finishCurrent(wo);
        return;
      }
      if (J.atStatus(wo, status)) return;
      await setStatus(selId, status, J.STATUS_STEP_MSG[status] || "Status atualizado.");
      return;
    }
    if (idx === 3 && canBill) {
      openFaturar(wo);
      return;
    }
    if (idx === 4) notify("Registre o pagamento nas faturas do job.", "info");
  }

  function bind() {
    $("jxTiles").addEventListener("click", (e) => {
      const t = e.target.closest("[data-jx-filter]");
      if (!t) return;
      filter = t.getAttribute("data-jx-filter");
      releaseAutoSelection();
      if (statusFilter && $("jxStatus")) {
        $("jxStatus").value = "";
        $("jxStatus").dispatchEvent(new Event("change"));
        return;
      }
      render();
    });
    $("jxRows").addEventListener("click", (e) => {
      const fat = e.target.closest("[data-jx-faturar]");
      if (fat) {
        e.preventDefault();
        e.stopPropagation();
        const id = fat.getAttribute("data-jx-faturar");
        openFaturar(all.find((w) => String(w.id) === String(id)));
        return;
      }
      const act = e.target.closest("[data-jx-act]");
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        const wo = all.find((w) => String(w.id) === String(act.getAttribute("data-id")));
        if (!wo) return;
        if (act.getAttribute("data-jx-act") === "start") void setStatus(wo.id, "in_progress", I().STATUS_STEP_MSG?.in_progress || "Job iniciado.");
        else void finishJob(wo);
        return;
      }
      if (e.target.closest("[data-jx-delete], .om-swipe__actions, .jmx-b")) return;
      const a = e.target.closest("[data-jx-id]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      select(a.getAttribute("data-jx-id"), true);
    });
    $("jxQ").addEventListener("input", (e) => {
      clearTimeout(e.target._t);
      q = e.target.value.trim().toLowerCase();
      releaseAutoSelection();
      render();
      e.target._t = setTimeout(() => {
        load().catch((err) => notify(err.message, "error"));
      }, 250);
    });
    $("jxStatus")?.addEventListener("change", (e) => {
      statusFilter = e.target.value || "";
      releaseAutoSelection();
      e.target.closest(".jx-sel")?.classList.toggle("is-on", !!statusFilter);
      const params = new URLSearchParams(location.search);
      if (statusFilter) params.set("status", statusFilter);
      else params.delete("status");
      const qs = params.toString();
      history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
      render();
    });
    $("jxSource").addEventListener("change", (e) => {
      source = e.target.value === "contractor" ? "builder" : e.target.value;
      releaseAutoSelection();
      if (e.target.value === "contractor") e.target.value = "builder";
      e.target.closest(".jx-sel").classList.toggle("is-on", !!source);
      const params = new URLSearchParams(location.search);
      if (source) params.set("source", source);
      else params.delete("source");
      const qs = params.toString();
      history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
      render();
    });
    $("jxDetail").addEventListener("click", async (e) => {
      if (e.target.closest("[data-jx-back]")) {
        e.preventDefault();
        select(null, true);
        return;
      }
      const partnerBtn = e.target.closest("[data-jx-partner-media], [data-jx-partner-report], [data-jx-partner-file]");
      if (partnerBtn) {
        e.preventDefault();
        const kind = partnerBtn.hasAttribute("data-jx-partner-media") ? "media" : partnerBtn.hasAttribute("data-jx-partner-report") ? "report" : "file";
        togglePartnerShare(partnerBtn, kind);
        return;
      }
      const tabBtn = e.target.closest("[data-jx-tab]");
      if (tabBtn) {
        e.preventDefault();
        const next = tabBtn.getAttribute("data-jx-tab");
        if (!next || next === detailTab) return;
        detailTab = next;
        renderDetail();
        return;
      }
      const b = e.target.closest("[data-jx-act]");
      if (!b) return;
      const act = b.getAttribute("data-jx-act");
      const id = selId;
      try {
        if (act === "start-date") {
          const wo = all.find((w) => String(w.id) === String(id)) || detailWo;
          if (wo) await window.__crmJobModal.openEdit(wo.id);
        } else if (act === "reopen") await setStatus(id, "draft", "Job reaberto com o valor atual do quote.");
        else if (act === "edit") await window.__crmJobModal.openEdit(id);
        else if (act === "services") await window.__crmJobModal.openEdit(id, { section: "services" });
        else if (act === "schedule") await window.__crmJobModal.openEdit(id, { section: "schedule" });
        else if (act === "team") await window.__crmJobModal.openEdit(id, { section: "team" });
        else if (act === "notes") await window.__crmJobModal.openEdit(id, { section: "notes" });
        else if (act === "campo") await window.__crmJobModal.openEdit(id, { section: "campo" });
        else if (act === "save-attention") {
          const ta = $("jxAttention");
          const btn = b;
          btn.disabled = true;
          try {
            const j = await api(`/api/work-orders/${encodeURIComponent(id)}`, {
              method: "PUT",
              body: JSON.stringify({ campo_attention: (ta?.value || "").trim() || null }),
            });
            const next = j.data || null;
            if (next) {
              detailWo = next;
              const ix = all.findIndex((w) => String(w.id) === String(id));
              if (ix >= 0) all[ix] = { ...all[ix], ...next };
            }
            const hint = $("jxAttentionHint");
            if (hint) hint.textContent = (ta?.value || "").trim() ? "Salvo — a equipe vê no ticket" : "Vazio — a equipe não vê aviso";
            notify("Aviso salvo — a equipe vê em destaque no Campo.", "success");
          } finally {
            btn.disabled = false;
          }
        }         else if (act === "invoice") {
          const wo = detailWo && String(detailWo.id) === String(id) ? detailWo : all.find((w) => String(w.id) === String(id));
          openFaturar(wo);
        } else if (act === "start") await setStatus(id, "in_progress", "Job iniciado.");
        else if (act === "complete") {
          const wo = all.find((w) => String(w.id) === String(id)) || detailWo;
          await finishCurrent(wo);
        }
      } catch (err) {
        notify(err.message || "Erro", "error");
      }
    });
    const currentWo = () => (detailWo && String(detailWo.id) === String(selId) ? detailWo : all.find((w) => String(w.id) === String(selId)));
    window.JobHeader.bind($("jxDetail"), {
      act: async (name) => {
        const id = selId;
        const wo = currentWo();
        if (!wo) return;
        try {
          if (name === "edit") await window.__crmJobModal.openEdit(id);
          else if (name === "services" || name === "schedule" || name === "team") await window.__crmJobModal.openEdit(id, { section: name });
          else if (name === "reopen") await setStatus(id, "draft", "Job reaberto com o valor atual do quote.");
          else if (name === "invoice") openFaturar(wo);
          else if (name === "start") await setStatus(id, "in_progress", "Job iniciado.");
          else if (name === "complete") await finishCurrent(wo);
          else if (name === "lixa") await window.__crmJobModal.openScheduleLixa(wo);
          else if (name === "delete") await deleteJob(id, wo.title || I().client(wo));
          else if (name === "chat") await window.JobChatComms.openJobChannel(id);
        } catch (err) {
          notify(err.message || "Erro", "error");
        }
      },
      step: (i) => applyStep(i).catch((err) => notify(err.message || "Erro", "error")),
      status: (k) => {
        const wo = currentWo();
        if (!wo || k === wo.status) return;
        setStatus(selId, k, "Status atualizado.").catch((err) => notify(err.message || "Erro", "error"));
      },
    });
    $("btnNewJob")?.addEventListener("click", () => {
      window.__crmJobModal.openCreate({ allDay: true }).catch((e) => notify(e.message, "error"));
    });
    ["jxStatus", "jxSource"].forEach((id) => {
      const sel = $(id);
      if (sel) bindPick(sel);
      sel?.addEventListener("change", syncFiltBadge);
    });
    syncFiltBadge();
    renderWeekStrip();
    document.querySelector(".jx-list")?.addEventListener("ol-all", () => showEveryJob());
    $("jxDayOff")?.addEventListener("click", () => clearDay());
    $("jxWeekPrev")?.addEventListener("click", () => shiftWeek(-1));
    $("jxWeekNext")?.addEventListener("click", () => shiftWeek(1));
    $("jxWeekStrip")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-jx-strip]");
      if (!btn) return;
      const key = btn.getAttribute("data-jx-strip");
      const [yy, mm, dd] = String(key || "").split("-").map(Number);
      if (!yy) return;
      if (dayFilter === key) dayFilter = null;
      else {
        dayFilter = key;
        weekFilter = weekSunday(new Date(yy, mm - 1, dd));
        revealWeek(weekFilter);
      }
      renderList();
    });
    $("jxCal")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const day = e.target.closest("[data-jx-day]");
      const act = e.target.closest("[data-jx-cal]");
      if (day) {
        const raw = day.getAttribute("data-jx-day");
        const [yy, mm, dd] = String(raw || "").split("-").map(Number);
        if (!yy) return;
        weekFilter = weekSunday(new Date(yy, mm - 1, dd));
        dayFilter = null;
        calOpen = false;
        renderList();
        return;
      }
      if (!act) return;
      const k = act.getAttribute("data-jx-cal");
      if (k === "prev") calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
      else if (k === "next") calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
      else if (k === "all") {
        weekFilter = null;
        dayFilter = null;
        calOpen = false;
      }
      renderList();
    });
    document.addEventListener("click", () => {
      if (!calOpen) return;
      calOpen = false;
      renderWeekCal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !calOpen) return;
      calOpen = false;
      renderWeekCal();
    });
    window.__crmJobModal.onSaved((data) => {
      if (data && data.id) {
        selId = data.id;
        detailWo = null;
        mediaCache = null;
        fieldCache = null;
      }
      load().catch(() => {});
    });
    window.addEventListener("resize", () => {
      const wide = window.matchMedia("(min-width: 1025px)").matches;
      if (wide) {
        $("jxSplit").classList.remove("is-detail");
        document.body.classList.remove("jx-detail-open");
      }
    });
  }

  /** First paint of the list: skeleton rows in place of the "Carregando…" line. */
  function listSkeleton() {
    const host = $("jxRows");
    if (host && window.crmSkeleton) window.crmSkeleton.fill(host, "rows", 6);
  }
  function listLoadError(err, retry) {
    const host = $("jxRows");
    const msg = err?.message || "Falha ao carregar os jobs";
    if (host && window.crmSkeleton) window.crmSkeleton.error(host, msg, retry);
    else notify(msg, "error");
  }
  async function retryLoad() {
    listSkeleton();
    try {
      await load();
      window.crmSkeleton?.done($("jxRows"));
    } catch (err) {
      listLoadError(err, retryLoad);
    }
  }

  async function boot() {
    if (!$("jx")) return;
    if (window.__omDevice?.isMobile?.()) return;
    let bound = false;
    listSkeleton();
    try {
      await window.__crmJobModal.ready;
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      canManage = role === "admin" || perms.includes("work_orders.manage");
      canBill = role === "admin" || perms.includes("invoices.view");
      canInvoice = role === "admin" || perms.includes("invoices.manage");
      sessionPerms = perms;
      sessionRole = role;
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      const sn = $("sidebarUserName");
      if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
      if (!canManage && $("btnNewJob")) $("btnNewJob").style.display = "none";
      let srcQp = new URLSearchParams(location.search).get("source") || "";
      if (srcQp === "contractor") srcQp = "builder";
      if (srcQp && $("jxSource") && [...$("jxSource").options].some((o) => o.value === srcQp)) {
        source = srcQp;
        $("jxSource").value = srcQp;
        $("jxSource").closest(".jx-sel")?.classList.add("is-on");
      }
      bind();
      bound = true;
      await load();
      window.crmSkeleton?.done($("jxRows"));
      const openId = sessionStorage.getItem("obramate_open_job");
      if (openId) {
        sessionStorage.removeItem("obramate_open_job");
        select(openId, true);
      }
      const setupId = new URLSearchParams(location.search).get("setup");
      if (canManage && setupId) {
        window.__crmJobModal.openEdit(setupId, { fromQuote: true }).catch((e) => notify(e.message, "error"));
        try {
          const u = new URL(location.href);
          u.searchParams.delete("setup");
          history.replaceState(null, "", u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : ""));
        } catch (_) {}
      } else if (canManage && new URLSearchParams(location.search).get("new") === "1") {
        location.replace("quote-builder.html");
        return;
      }
    } catch (err) {
      if (!all.length) listLoadError(err, bound ? retryLoad : () => location.reload());
      else notify(err.message || "Falha ao carregar os jobs", "error");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
