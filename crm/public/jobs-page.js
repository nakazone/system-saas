/**
 * Jobs (computador e iPad) — lista à esquerda e o job aberto à direita com as mesmas
 * abas da antiga tela Abrir job (visão geral, serviços, fotos, campo, conversa).
 */
(function () {
  const I = () => window.JobsInfo;
  const $ = (id) => document.getElementById(id);
  let all = [];
  let canManage = false;
  let canBill = false;
  let canInvoice = false;
  let filter = "all";
  let source = "";
  let sortDir = "newest";
  let q = "";
  let selId = null;
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
  let calCursor = new Date();
  let calOpen = false;

  const SOURCE = { particular: "Particular", builder: "Builder", contractor: "Builder", loja: "Builder", internal: "Interno", other: "Outro" };
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

  function matchesFilter(wo, f) {
    const J = I();
    const bk = bucket(wo);
    switch (f) {
      case "all":
        return wo.status !== "canceled";
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
        return wo.status === "completed";
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
    const t = (wo) => new Date(wo.created_at || 0).getTime();
    return rows.sort((a, b) => (sortDir === "oldest" ? t(a) - t(b) : t(b) - t(a)));
  }

  // ---------------------------------------------------------------- top
  function renderSum() {
    const J = I();
    const active = all.filter((w) => J.isActive(w));
    const late = all.filter((w) => J.late(w)).length;
    const contracts = active.reduce((s, w) => s + (Number(w.services_total) || 0), 0);
    const toInvoice = all.filter((w) => w.status !== "canceled" && w.billing && w.billing.billing_status !== "no_value").reduce((s, w) => s + (w.billing.remaining_to_invoice || 0), 0);
    const recv = all.reduce((s, w) => s + (w.billing ? w.billing.open_balance || 0 : 0), 0);
    const parts = [
      ["Ativos", String(active.length), ""],
      ["Em contratos", J.money0(contracts), ""],
      ["Atrasados", String(late), late ? "is-hot" : ""],
    ];
    if (canBill) parts.push(["A faturar", J.money0(toInvoice), ""], ["A receber", J.money0(recv), ""]);
    $("jxSum").innerHTML = parts.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c}">${v}</dd></div>`).join("");
  }

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
    T.push(["scheduled", "Agendados", sc.length, sc.length ? J.money0(sum(sc, (w) => w.services_total)) : "—", ""]);
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
    T.push(["done", "Concluídos", dn.length, dn.length ? (() => { const k = dn.filter((w) => w.billing?.billing_status === "paid").length; return `${k} pago${k === 1 ? "" : "s"}`; })() : "—", ""]);
    const host = $("jxTiles");
    host.style.setProperty("--jx-tiles", T.length);
    host.innerHTML = T.map(
      ([k, l, c, s, cls]) =>
        `<button type="button" class="jx-tile${filter === k ? " is-on" : ""}" data-jx-filter="${k}" aria-pressed="${filter === k}"><span>${l}</span><b>${c}</b><small class="${cls}">${I().esc(s)}</small></button>`,
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
  function rowHtml(wo) {
    const J = I();
    const lt = J.late(wo);
    const undated = !wo.scheduled_start && !(wo.sector === "both" && wo.sand_scheduled_start);
    const when = undated ? "Sem data" : wo.status === "completed" ? `concluído ${J.dayShort(wo.scheduled_end || wo.scheduled_start)}` : J.dateRange(wo);
    const sub = lt ? `<em class="is-hot">${J.esc(lt.label)}</em>` : `<em class="${undated ? "is-hot" : ""}">${J.esc(when)}</em>`;
    const href = `job-detail.html?id=${encodeURIComponent(wo.id)}`;
    const startBtn = undated && canManage ? `<button type="button" class="jx-start" data-jx-start="${J.esc(wo.id)}">Schedule Job</button>` : "";
    const showBill = canFaturar(wo);
    const showDel = canManage && wo.status !== "canceled";
    const body = `<div class="jx-rowwrap${undated ? " is-nodate" : ""}">
    <a class="jx-row${String(wo.id) === String(selId) ? " is-on" : ""}${undated ? " is-nodate" : ""}" href="${href}" data-jx-id="${J.esc(wo.id)}">
      <span class="jx-row__b">
        <span class="jx-row__l1"><b>${J.esc(wo.title || `Job para ${J.client(wo)}`)}</b><em>${canBill || canManage ? J.money0(wo.services_total) : ""}</em></span>
        <span class="jx-row__l2"><span>${J.esc(J.findLine(wo))}</span>${sub}</span>
        ${undated ? `<span class="jx-nodate">Sem data${wo.quote_number ? ` · veio do quote ${J.esc(wo.quote_number)}` : ""}</span>` : ""}
        <span class="jx-row__l3">${J.progHtml(wo)}<small>${J.esc(J.stageLabel(wo))}</small></span>
      </span>
    </a>${startBtn}</div>`;
    // Swipe-to-delete only on touch / narrow — desktop list stays clean (no inline buttons).
    if (showDel && useSwipeDelete()) {
      return `<article class="om-swipe jx-swipe" data-jx-swipe="${J.esc(wo.id)}">
      <div class="om-swipe__actions" aria-hidden="true">
        <a class="om-swipe__act--edit" href="${href}">Abrir</a>
        ${showBill ? `<button type="button" class="om-swipe__act--open" data-jx-faturar="${J.esc(wo.id)}">Faturar</button>` : ""}
        <button type="button" class="om-swipe__act--delete" data-jx-delete="${J.esc(wo.id)}" data-jx-label="${J.esc(wo.title || J.client(wo))}">Excluir</button>
      </div>
      <div class="om-swipe__body">${body}</div>
    </article>`;
    }
    return body;
  }

  async function deleteJob(id, label, btn) {
    if (!id || !canManage) return;
    if (!confirm(`Excluir o job “${label || id}”?\n\nO job será cancelado e sai da lista ativa.`)) return;
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

  function visibleRows() {
    const serverSearch = q.length >= 2 && q === fetchedQuery;
    const rows = serverSearch
      ? all.filter((w) => w.status !== "canceled")
      : all.filter((w) => matchesFilter(w, filter) && searchHit(w));
    if (selId && !rows.some((w) => String(w.id) === String(selId))) {
      const pinned = all.find((w) => String(w.id) === String(selId));
      if (pinned) return [pinned, ...rows];
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
    const iso = wo.scheduled_start || (wo.sector === "both" ? wo.sand_scheduled_start : null);
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
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
  function renderList() {
    renderWeekCal();
    let rows = visibleRows();
    if (weekFilter) {
      rows = rows.filter((wo) => {
        const d = jobAnchor(wo);
        if (!d) return true;
        return sameWeek(d, weekFilter);
      });
    }
    const host = $("jxRows");
    if (!rows.length) {
      const empty = q
        ? `Nenhum job para “${I().esc(q)}”. Abra o quote e use Abrir job, ou busque pelo builder, endereço ou número do quote.`
        : all.length
          ? "Nenhum job neste filtro."
          : 'Nenhum job ainda. Use Job ou aprove um quote.';
      host.innerHTML =
        !q && !all.length && window.MateFace
          ? window.MateFace.empty({ pose: "point", title: "Nenhum job ainda", text: "Aprove um quote ou crie um job. Posso montar com você.", ask: "criar um job", askLabel: "Criar com o Mate" })
          : `<p class="jx-empty">${empty}</p>`;
      return rows;
    }
    const undated = rows.filter((w) => !jobAnchor(w));
    const dated = rows.filter((w) => jobAnchor(w));
    const weeks = new Map();
    dated.forEach((wo) => {
      const key = ymd(weekSunday(jobAnchor(wo)));
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(wo);
    });
    const keys = [...weeks.keys()].sort((a, b) => (sortDir === "oldest" ? a.localeCompare(b) : b.localeCompare(a)));
    let html = "";
    if (undated.length) {
      html += `<section class="jx-week jx-week--nodate"><p class="jx-grp"><span>Sem data</span><em>${undated.length}</em></p>${undated.map(rowHtml).join("")}</section>`;
    }
    keys.forEach((key, i) => {
      const g = sortRows(weeks.get(key));
      const [yy, mm, dd] = key.split("-").map(Number);
      html += `<section class="jx-week jx-week--${i % 2 ? "b" : "a"}"><p class="jx-grp"><span>${weekTitle(new Date(yy, mm - 1, dd))}</span><em>${g.length}</em></p>${g.map(rowHtml).join("")}</section>`;
    });
    host.innerHTML = html;
    if (window.OmGestures) window.OmGestures.bindSwipeRow?.(host);
    host.querySelectorAll("[data-jx-start]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wo = all.find((w) => String(w.id) === String(btn.getAttribute("data-jx-start")));
        if (wo && window.__crmJobModal?.openStartDate) window.__crmJobModal.openStartDate(wo);
      });
    });
    host.querySelectorAll("[data-jx-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void deleteJob(btn.getAttribute("data-jx-delete"), btn.getAttribute("data-jx-label"), btn);
      });
    });
    return rows;
  }

  // ---------------------------------------------------------------- detail
  const DETAIL_TABS = [
    ["geral", "Visão geral"],
    ["servicos", "Serviços e faturas"],
    ["fotos", "Fotos"],
    ["campo", "Campo"],
    ["conversa", "Conversa"],
  ];

  function primary(wo) {
    if (wo.status === "canceled") return null;
    const b = wo.billing;
    // Field/ops status first — Faturar must not hide Iniciar/Concluir (incl. late jobs).
    if (canManage) {
      if (!wo.scheduled_start && !(wo.sector === "both" && wo.sand_scheduled_start)) return { label: "Schedule Job", act: "start-date" };
      if (!(wo.line_items || []).length) return { label: "Adicionar serviços", act: "services" };
      if (wo.status === "draft" || wo.status === "scheduled") return { label: "Iniciar job", act: "start" };
      if (wo.status === "in_progress") return { label: "Concluir job", act: "complete" };
      if (!wo.scheduled_start && wo.status !== "completed") return { label: "Agendar", act: "schedule" };
    }
    if (canFaturar(wo)) {
      return {
        label: `${b.invoiced_total > 0 ? "Faturar saldo" : "Faturar job"} ${I().money0(b.remaining_to_invoice)}`,
        act: "invoice",
      };
    }
    return null;
  }

  /** Extra CTA when job is late: allow jump to completed without going through “Em campo”. */
  function lateActions(wo) {
    if (!canManage || wo.status === "canceled" || wo.status === "completed") return [];
    const acts = [];
    if (wo.status === "draft" || wo.status === "scheduled") {
      acts.push({ label: "Iniciar", act: "start", primary: true });
      acts.push({ label: "Já concluído", act: "complete" });
    } else if (wo.status === "in_progress") {
      acts.push({ label: "Concluir", act: "complete", primary: true });
    }
    acts.push({ label: "Remarcar", act: "schedule" });
    return acts;
  }

  function statusPill(wo) {
    const map = { draft: ["Rascunho", ""], scheduled: ["Agendado", ""], in_progress: ["Em campo", "dk"], completed: ["Concluído", "ol"], canceled: ["Cancelado", "late"] };
    const [l, c] = map[wo.status] || [wo.status, ""];
    return `<span class="jx-pill${c ? ` jx-pill--${c}` : ""}">${l}</span>`;
  }

  function unitLabel(u) {
    const m = { sqft: "sq ft", sq_ft: "sq ft", lf: "lf", linear_ft: "lf", step: "steps", steps: "steps", each: "un", unit: "un", hour: "h" };
    return m[u] || (u ? String(u).replace(/_/g, " ") : "sq ft");
  }
  function qty(n) {
    const x = Number(n) || 0;
    return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function phoneDisp(raw) {
    if (!raw) return "";
    return typeof window.sfFormatPhone === "function" ? window.sfFormatPhone(raw) || raw : raw;
  }

  function startText(wo) {
    if (!wo.scheduled_start && !(wo.sector === "both" && wo.sand_scheduled_start)) return { main: "Sem data", sub: "Ainda não agendado" };
    return { main: I().dateRange(wo), sub: "Dia inteiro" };
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
    return Boolean(wo?.builder_id) || customerType === "builder" || customerType === "contractor";
  }
  function partnerShareButton(attr, id, on, onLabel, offLabel, extra) {
    const J = I();
    if (!canManage) return on ? "No portal" : "Oculto";
    return `<button type="button" class="jx-share${on ? " is-on" : ""}" ${attr}="${J.esc(id)}" data-on="${on ? "1" : "0"}"${extra ? ` ${extra}` : ""}>${on ? onLabel : offLabel}</button>`;
  }
  function partnerDocsHtml(wo) {
    const J = I();
    if (!partnerDocs || String(partnerDocs.jobId) !== String(wo.id)) return `<p class="jx-none" id="jxPartnerWait">Carregando o que o parceiro vê…</p>`;
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
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "";
    const st = startText(wo);
    const c = wo.customer;
    const phone = c?.phone ? phoneDisp(c.phone) : "";
    const tel = c?.phone ? String(c.phone).replace(/[^\d+]/g, "") : "";
    const contact = [phone ? `<a href="tel:${J.esc(tel)}">${J.esc(phone)}</a>` : "", c?.email ? `<a href="mailto:${J.esc(c.email)}">${J.esc(c.email)}</a>` : ""].filter(Boolean).join(" · ");
    const team = J.team(wo);
    const teamHtml = team.length
      ? team.map((t) => `<div class="jx-tm"><span class="jx-av${t.lead ? " jx-av--lead" : ""}">${J.esc(J.initials(t.name))}</span><span><b>${J.esc(t.name)}</b><small>${t.lead ? "Responsável" : t.temp ? "Temporário" : "Equipe"}</small></span></div>`).join("")
      : `<p class="jx-none">Ninguém escalado.</p>`;
    const lines = wo.line_items || [];
    const svc = lines.length
      ? `<table class="jx-tbl"><thead><tr><th>Serviço</th><th class="r">Qtd</th><th class="r">Total</th></tr></thead><tbody>${lines
          .map((l) => {
            const note = String(l.notes || "").trim();
            return `<tr><td>${J.esc(l.service_name)}${note ? `<small class="jx-svc-note">${J.esc(note)}</small>` : ""}</td><td class="r">${qty(l.quantity_sqft)} ${J.esc(unitLabel(l.unit))}</td><td class="r">${J.money(l.line_total)}</td></tr>`;
          })
          .join("")}</tbody><tfoot><tr><td colspan="2">Total do job</td><td class="r">${J.money(wo.services_total)}</td></tr></tfoot></table>`
      : `<p class="jx-none">Nenhum serviço ainda.${canManage ? " Adicione pela Tabela de Valores." : ""}</p>`;
    const notes = String(wo.notes || "").trim();
    const att = String(wo.campo_attention || "").trim();
    const alertBits = [];
    if (att) alertBits.push(`<div><b>Atenção para o campo</b><p>${J.esc(att)}</p></div>`);
    if (wo.needs_delivery) {
      alertBits.push(
        `<div><b>Delivery</b><p>${J.esc(wo.delivery_pickup_address || "Retirar material da obra")}${wo.delivery_notes ? `<br>${J.esc(wo.delivery_notes)}` : ""}</p></div>`,
      );
    }
    const money = canBill && wo.billing
      ? `<div class="jx-box"><h3>Dinheiro</h3><dl class="jx-kv">
          <dt>Total</dt><dd>${J.money(wo.billing.services_total)}</dd>
          <dt>Faturado</dt><dd>${J.money(wo.billing.invoiced_total)}</dd>
          <dt>Recebido</dt><dd>${J.money(wo.billing.paid_total)}</dd>
          <dt>A faturar</dt><dd>${J.money(wo.billing.remaining_to_invoice)}</dd>
        </dl>${canFaturar(wo) ? `<button type="button" class="jx-btn jx-btn--pri" style="margin-top:10px" data-jx-act="invoice">${wo.billing.invoiced_total > 0 ? "Faturar saldo" : "Faturar job"} ${J.money0(wo.billing.remaining_to_invoice)}</button>` : ""}</div>`
      : "";
    return `<div class="jx-cols">
      <div>
        <div class="jx-facts">
          <div><small>Cliente</small><b>${J.esc(J.client(wo))}</b><span>${contact || J.esc(wo.builder?.name || "Sem contato")}</span></div>
          <div><small>Start</small><b>${J.esc(st.main)}</b><span>${J.esc(st.sub)}</span></div>
          <div><small>Equipe</small><b>${J.esc(wo.assigned_user?.name || "Sem responsável")}</b><span>${team.length > 1 ? `${team.length} na equipe` : team.length ? "Responsável" : ""}</span></div>
          <div><small>Preços</small><b>Tabela · ${J.esc(SOURCE[wo.source_type] || "—")}</b><span>${lines.length ? `${lines.length} serviço${lines.length > 1 ? "s" : ""} · ${J.money(wo.services_total)}` : "Sem serviços"}</span></div>
        </div>
        ${alertBits.length ? `<div class="jx-box jx-box--alert">${alertBits.join("")}${canManage ? `<button type="button" class="jx-lnk" data-jx-tab="campo" style="margin-top:8px">Ver no Campo</button>` : ""}</div>` : ""}
        <div class="jx-box"><h3>Serviços${canManage ? `<button type="button" class="jx-lnk" data-jx-act="services">Editar</button>` : ""}</h3>${svc}</div>
        <div class="jx-box"><h3>Notas da obra${canManage ? `<button type="button" class="jx-lnk" data-jx-act="notes">Editar</button>` : ""}</h3>${
          notes ? `<p class="jx-note">${J.esc(notes)}</p>` : `<p class="jx-none">Sem notas.${canManage ? " Use para acesso, portão, cuidados." : ""}</p>`
        }</div>
        <div class="jx-box"><h3>Obra${canManage ? `<button type="button" class="jx-lnk" data-jx-act="schedule">Agenda</button>` : ""}</h3>
          <dl class="jx-kv">
            <dt>Start</dt><dd>${J.esc(J.dateRange(wo))}${wo.scheduled_start || wo.sand_scheduled_start ? " · dia inteiro" : ""}</dd>
            <dt>Endereço</dt><dd>${wo.address ? `<a href="${J.esc(maps)}" target="_blank" rel="noopener">${J.esc(wo.address)}</a>` : '<span class="jx-mu">Sem endereço</span>'}</dd>
            ${wo.quote_number ? `<dt>Quote</dt><dd>${J.esc(wo.quote_number)}</dd>` : ""}
            ${J.builderName(wo) ? `<dt>Builder</dt><dd>${J.esc(J.builderName(wo))}</dd>` : ""}
          </dl>
        </div>
      </div>
      <div>
        ${money}
        ${partnerBox(wo)}
        <div class="jx-box"><h3>Equipe${canManage ? `<button type="button" class="jx-lnk" data-jx-act="team">Gerir</button>` : ""}</h3>${teamHtml}</div>
      </div>
    </div>`;
  }

  function panelServicos(wo) {
    const J = I();
    const lines = wo.line_items || [];
    const svc = lines.length
      ? `<table class="jx-tbl"><thead><tr><th>Serviço</th><th class="r">Qtd</th><th class="r">Preço</th><th class="r">Total</th></tr></thead><tbody>${lines
          .map((l) => `<tr><td>${J.esc(l.service_name)}</td><td class="r">${qty(l.quantity_sqft)} ${J.esc(unitLabel(l.unit))}</td><td class="r jx-mu">${J.money(l.unit_price)}</td><td class="r">${J.money(l.line_total)}</td></tr>`)
          .join("")}</tbody><tfoot><tr><td colspan="3">Total do job</td><td class="r">${J.money(wo.services_total)}</td></tr></tfoot></table>`
      : `<p class="jx-none">Nenhum serviço ainda.</p>`;
    return `<div class="jx-cols">
      <div class="jx-box"><h3>Serviços${canManage ? `<button type="button" class="jx-lnk" data-jx-act="services">Editar serviços</button>` : ""}</h3>${svc}</div>
      <div class="jx-box" ${canBill ? "" : "hidden"}><h3>Faturamento</h3><div id="jxBilling"></div></div>
    </div>`;
  }

  function panelFotos(wo) {
    const n = mediaCache ? mediaCache.length : null;
    return `${partnerBox(wo)}<div class="jx-box">
      <h3>Fotos${n != null ? `<span class="jx-ch__n">${n}</span>` : ""}<a class="jx-lnk" href="job-media-board.html?job=${encodeURIComponent(wo.id)}">ObraCam</a></h3>
      <div id="jxPhotos">${n == null ? `<p class="jx-none">A carregar fotos…</p>` : ""}</div>
    </div>`;
  }

  function panelCampo(wo) {
    return `<div id="jxField">${fieldCache == null ? `<div class="jx-box"><p class="jx-none">A carregar campo…</p></div>` : ""}</div>`;
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

  function fieldStatusMeta(wo, f) {
    const fs = wo.status === "completed" ? "completed" : wo.status === "canceled" ? "canceled" : f.field_status;
    const label =
      fs === "completed" ? "Concluída" : fs === "canceled" ? "Cancelada" : f.field_status_label || f.field_status || "—";
    const cls = fs === "completed" ? "ok" : fs === "canceled" ? "late" : fs === "scheduled" || fs === "assigned" ? "" : "dk";
    return { fs, label, cls };
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
    const st = fieldStatusMeta(wo, f);
    const ticketHref = `campo/ticket.html?id=${encodeURIComponent(wo.id)}`;
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
        <section class="jx-campo__hero">
          <div class="jx-campo__hero-main">
            <span class="jx-pill${st.cls ? ` jx-pill--${st.cls}` : ""}">${J.esc(st.label)}</span>
            <div>
              <h3>Status no Campo</h3>
              <p>${h.total ? `${qty(h.total)} h · ${people.length} pessoa${people.length === 1 ? "" : "s"}` : "Equipe ainda não registrou atividade"}</p>
            </div>
          </div>
          <div class="jx-campo__hero-acts">
            <a class="jx-btn jx-btn--pri jx-btn--sm" href="${ticketHref}" target="_blank" rel="noopener">Abrir ticket</a>
            ${canManage ? `<button type="button" class="jx-btn jx-btn--sm" data-jx-act="campo">Preparar campo</button>` : ""}
          </div>
        </section>

        ${
          f.problem_note
            ? `<section class="jx-campo__card jx-campo__card--danger"><header class="jx-campo__hd"><div><h3>Problema relatado</h3><p class="jx-campo__sub">Vindo do ticket do instalador</p></div></header><p class="jx-note">${J.esc(f.problem_note)}</p></section>`
            : ""
        }

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
    if (detailTab === "servicos" && canBill && window.JobBilling && $("jxBilling")) {
      billingCtl = window.JobBilling.mountCard($("jxBilling"), {
        jobId: wo.id,
        jobStatus: wo.status,
        canManage: canInvoice,
      });
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
  }

  function renderDetail() {
    const J = I();
    const host = $("jxDetail");
    destroyDetailMounts();
    const listWo = all.find((w) => String(w.id) === String(selId));
    const wo = detailWo && String(detailWo.id) === String(selId) ? detailWo : listWo;
    if (!wo) {
      host.innerHTML = `<div class="jx-blank">Escolha um job na lista.</div>`;
      return;
    }
    const lt = J.late(wo);
    const b = wo.billing;
    const bl = J.bill(wo);
    const p = primary(wo);
    const phone = wo.customer?.phone ? String(wo.customer.phone).replace(/[^\d+]/g, "") : "";
    const s = J.step(wo);
    const steps = J.STEP_NAMES.map((n, i) => {
      const cls = s < 0 ? "" : i < s ? "is-ok" : i === s ? "is-cur" : "";
      const st = J.statusForStep(i);
      const clickable = canManage && s >= 0 && (st || (i === 3 && canBill));
      const tip = st
        ? `Mover para ${n}`
        : i === 3
          ? "Faturar"
          : i === 4
            ? "Pagamento nas faturas"
            : n;
      return `<li class="${cls}${clickable ? " is-btn" : ""}"${clickable ? ` role="button" tabindex="0" data-jx-step="${i}" title="${J.esc(tip)}" aria-label="${J.esc(tip)}"` : ""}><i></i>${n}</li>`;
    }).join("");
    const team = J.team(wo);
    const kpis = [["Total do job", J.money0(wo.services_total), `${(wo.line_items || []).length} serviço${(wo.line_items || []).length === 1 ? "" : "s"}`]];
    if (canBill && b) {
      kpis.push(["A faturar", J.money0(b.remaining_to_invoice), b.invoiced_total > 0 ? `${J.money0(b.invoiced_total)} faturado` : "nada faturado"]);
      kpis.push([b.open_balance > 0.004 ? "A receber" : "Recebido", J.money0(b.open_balance > 0.004 ? b.open_balance : b.paid_total), b.open_balance > 0.004 ? `${J.money0(b.paid_total)} recebido` : b.billing_status === "paid" ? "tudo pago" : "nada recebido"]);
    }
    kpis.push(["Equipe", team.length ? team.map((t) => t.name.split(" ")[0]).join(", ") : "Sem equipe", team.length ? `${team.length} pessoa${team.length > 1 ? "s" : ""}` : canManage ? "escalar no Editar" : ""]);

    const tab = DETAIL_TABS.some(([k]) => k === detailTab) ? detailTab : "geral";
    detailTab = tab;
    const body =
      tab === "servicos"
        ? panelServicos(wo)
        : tab === "fotos"
          ? panelFotos(wo)
          : tab === "campo"
            ? panelCampo(wo)
            : tab === "conversa"
              ? panelConversa()
              : panelGeral(wo);

    host.innerHTML = `
      <a class="jx-back" href="#" data-jx-back>${SVG.back}Jobs</a>
      <div class="jx-ch">
        <div class="jx-ch__r">
          <div class="jx-ch__t">
            <div class="jx-chips">${statusPill(wo)}${lt ? `<span class="jx-pill jx-pill--late">${J.esc(lt.short)}</span>` : ""}${bl && canBill && wo.status === "completed" ? `<span class="jx-pill${bl.cls === "ok" ? " jx-pill--ol" : ""}">${J.esc(bl.text)}</span>` : ""}${wo.number != null ? `<span class="jx-num">Job #${J.esc(wo.number)}</span>` : ""}</div>
            <h2>${J.esc(wo.title || `Job para ${J.client(wo)}`)}</h2>
            <p class="jx-meta">${[`<b>${J.esc(J.client(wo))}</b>${SOURCE[wo.source_type] ? ` · ${SOURCE[wo.source_type]}` : ""}`, wo.address ? `${SVG.pin}${J.esc(wo.address)}` : "", `${SVG.cal}${J.esc(J.dateRange(wo))}`].filter(Boolean).map((x, i) => `<span class="jx-mp">${i ? '<i class="jx-dot">·</i>' : ""}${x}</span>`).join("")}</p>
          </div>
          <div class="jx-ch__acts">
            ${phone ? `<a class="jx-btn jx-btn--sq" href="tel:${J.esc(phone)}" title="Ligar para o cliente" aria-label="Ligar">${SVG.phone}</a>` : ""}
            ${canManage ? `<button type="button" class="jx-btn" data-jx-act="edit">${SVG.edit}<span>Editar</span></button>` : ""}
            ${p ? (p.href ? `<a class="jx-btn jx-btn--pri" href="${p.href}">${J.esc(p.label)}</a>` : `<button type="button" class="jx-btn jx-btn--pri" data-jx-act="${p.act}">${J.esc(p.label)}</button>`) : ""}
          </div>
        </div>
        ${s >= 0 ? `<ol class="jx-steps">${steps}</ol>` : ""}
        <div class="jx-kpis">${kpis.map(([k, v, sm]) => `<div><span>${k}</span><b>${J.esc(v)}</b>${sm ? `<small>${J.esc(sm)}</small>` : ""}</div>`).join("")}</div>
        ${
          lt
            ? `<p class="jx-late-line" role="status"><span class="jx-late-line__dot" aria-hidden="true"></span><span>${
                wo.status === "in_progress"
                  ? `Passou do término · ${lt.days} dia${lt.days > 1 ? "s" : ""}`
                  : `Não iniciado · ${lt.days} dia${lt.days > 1 ? "s" : ""} após a data`
              }</span>${
                canManage
                  ? lateActions(wo)
                      .map((a) =>
                        a.primary
                          ? ""
                          : `<button type="button" class="jx-late-line__act" data-jx-act="${a.act}">${J.esc(a.label)}</button>`,
                      )
                      .join("")
                  : ""
              }</p>`
            : ""
        }
      </div>
      <nav class="jx-tabs" role="tablist">${DETAIL_TABS.map(
        ([k, label]) => `<button type="button" role="tab" class="${k === tab ? "is-on" : ""}" data-jx-tab="${k}" aria-selected="${k === tab}">${label}</button>`,
      ).join("")}</nav>
      <div class="jx-panel" data-jx-panel="${tab}">${body}</div>`;
    if (hasPartnerPortal(wo) && (tab === "geral" || tab === "fotos")) ensurePartnerDocs(wo);
    mountLazyPanels(wo);
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
  function render() {
    renderSum();
    renderTiles();
    const rows = renderList();
    const wide = window.matchMedia("(min-width: 1025px)").matches;
    const pinned = selId && all.some((w) => String(w.id) === String(selId));
    if (wide && !pinned && !rows.some((w) => String(w.id) === String(selId))) {
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

  function select(id, push) {
    const changed = String(selId || "") !== String(id || "");
    selId = id;
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
  async function load() {
    const seq = ++loadSeq;
    if (firstLoad) {
      const qs = new URLSearchParams(location.search);
      const bmap = { to_invoice: "toinvoice", awaiting_payment: "receivable", paid: "done" };
      if (qs.get("billing") && bmap[qs.get("billing")]) filter = bmap[qs.get("billing")];
      if (qs.get("filter")) filter = qs.get("filter");
      if (qs.get("sort") === "oldest") sortDir = "oldest";
      if (qs.get("id")) {
        selId = qs.get("id");
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
    const j = await api(`/api/work-orders${params.toString() ? `?${params}` : ""}`);
    if (seq !== loadSeq) return;
    fetchedQuery = query.length >= 2 ? query : "";
    all = j.data || [];
    if (selId && !all.some((w) => String(w.id) === String(selId))) {
      try {
        const one = await api(`/api/work-orders/${encodeURIComponent(selId)}`);
        if (seq !== loadSeq) return;
        if (one.data) all = [one.data, ...all];
      } catch (_) {
        /* the list still renders; the detail fetch reports a missing job */
      }
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

  async function applyStep(idx) {
    if (!canManage || !selId || Number.isNaN(idx)) return;
    const J = I();
    const wo = detailWo && String(detailWo.id) === String(selId) ? detailWo : all.find((w) => String(w.id) === String(selId));
    if (!wo || wo.status === "canceled") return;
    const status = J.statusForStep(idx);
    if (status) {
      if (J.atStatus(wo, status)) return;
      if (status === "completed") {
        const label = wo.title || J.client(wo);
        const ok = window.crmConfirm?.completeJob
          ? await window.crmConfirm.completeJob(label)
          : confirm("Marcar o job como concluído?");
        if (!ok) return;
      }
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
      if (e.target.closest("[data-jx-delete], .om-swipe__actions")) return;
      const a = e.target.closest("[data-jx-id]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      select(a.getAttribute("data-jx-id"), true);
    });
    $("jxQ").addEventListener("input", (e) => {
      clearTimeout(e.target._t);
      q = e.target.value.trim().toLowerCase();
      render();
      e.target._t = setTimeout(() => {
        load().catch((err) => notify(err.message, "error"));
      }, 250);
    });
    $("jxSource").addEventListener("change", (e) => {
      source = e.target.value === "contractor" ? "builder" : e.target.value;
      if (e.target.value === "contractor") e.target.value = "builder";
      e.target.closest(".jx-sel").classList.toggle("is-on", !!source);
      const params = new URLSearchParams(location.search);
      if (source) params.set("source", source);
      else params.delete("source");
      const qs = params.toString();
      history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
      render();
    });
    $("jxSort")?.addEventListener("change", (e) => {
      sortDir = e.target.value === "oldest" ? "oldest" : "newest";
      const params = new URLSearchParams(location.search);
      if (sortDir === "oldest") params.set("sort", "oldest");
      else params.delete("sort");
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
      const stepEl = e.target.closest("[data-jx-step]");
      if (stepEl) {
        e.preventDefault();
        try {
          await applyStep(Number(stepEl.getAttribute("data-jx-step")));
        } catch (err) {
          notify(err.message || "Erro", "error");
        }
        return;
      }
      const b = e.target.closest("[data-jx-act]");
      if (!b) return;
      const act = b.getAttribute("data-jx-act");
      const id = selId;
      try {
        if (act === "start-date") {
          const wo = all.find((w) => String(w.id) === String(id)) || detailWo;
          if (wo) await window.__crmJobModal.openStartDate(wo);
        } else if (act === "edit") await window.__crmJobModal.openEdit(id);
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
          const label = wo?.title || (wo ? I().client(wo) : "");
          const ok = window.crmConfirm?.completeJob
            ? await window.crmConfirm.completeJob(label)
            : confirm("Marcar o job como concluído?");
          if (!ok) return;
          await setStatus(id, "completed", "Job concluído.");
        }
      } catch (err) {
        notify(err.message || "Erro", "error");
      }
    });
    $("jxDetail").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const stepEl = e.target.closest("[data-jx-step]");
      if (!stepEl) return;
      e.preventDefault();
      applyStep(Number(stepEl.getAttribute("data-jx-step"))).catch((err) => notify(err.message || "Erro", "error"));
    });
    $("btnNewJob")?.addEventListener("click", () => {
      window.__crmJobModal.openCreate({ allDay: true }).catch((e) => notify(e.message, "error"));
    });
    $("jxCalBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      calOpen = !calOpen;
      renderWeekCal();
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

  async function boot() {
    if (!$("jx")) return;
    if (window.__omDevice?.isMobile?.()) return;
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
      await load();
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
      notify(err.message || "Falha ao carregar os jobs", "error");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
