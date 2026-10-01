/**
 * Job page (desktop + tablet). Phones use the job-detail-mobile.js overlay.
 *
 * Header (status, client, address, dates, main action) + progress steps, then tabs:
 * Visão geral · Serviços e faturas · Fotos · Campo · Conversa. Tab data loads on demand.
 */
(function () {
  const STATUS = {
    draft: ["Rascunho", "draft"],
    scheduled: ["Agendado", "scheduled"],
    in_progress: ["Em andamento", "progress"],
    completed: ["Concluído", "done"],
    canceled: ["Cancelado", "canceled"],
  };
  const SOURCE = { particular: "Particular", builder: "Builder", contractor: "Contractor", loja: "Loja", internal: "Interno", other: "Outro" };
  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const TABS = ["geral", "servicos", "fotos", "campo", "conversa"];

  let jobId = null;
  let job = null;
  let canManage = false;
  let canBill = false;
  let canInvoice = false;
  let orgSlug = null;
  let billing = null; // { billing, data: invoices }
  let media = null;
  let mediaFilter = "all";
  let reports = [];
  let aiEnabled = false;
  let field = null;
  let proposals = null;
  let commsCtl = null;
  let billingCtl = null;
  let tab = "geral";
  let afterOpen = null;
  let reviewReq = null;
  let marketing = null;

  const $ = (id) => document.getElementById(id);
  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function money(n) {
    return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function money0(n) {
    return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }
  function initials(name) {
    const p = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  function unitLabel(unit) {
    const raw = String(unit || "").trim().toLowerCase().replace(/\s+/g, "_");
    const map = { sq_ft: "sq ft", sqft: "sq ft", linear_ft: "lin ft", linear_feet: "lin ft", lf: "lin ft", step: "steps", steps: "steps", unit: "un", each: "un", piece: "pç", fixed: "", hour: "h", hours: "h", day: "dias", days: "dias" };
    return raw in map ? map[raw] : String(unit || "").replace(/_/g, " ");
  }
  const qty = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  function fmtDay(d, opts) {
    return d.toLocaleDateString("pt-BR", opts || { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "");
  }
  function fmtTime(d) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  /** "Qui 24 set" */
  function shortDay(d) {
    return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
  }
  function whenText() {
    if (!job.scheduled_start) return { main: "Sem data", sub: "Ainda não agendado" };
    const s = new Date(job.scheduled_start);
    const e = job.scheduled_end ? new Date(job.scheduled_end) : null;
    if (!e) return { main: shortDay(s), sub: `${fmtTime(s)} · sem fim definido` };
    const sameDay = s.toDateString() === e.toDateString();
    const sameMonth = s.getMonth() === e.getMonth();
    return {
      main: sameDay ? shortDay(s) : `${WD[s.getDay()]} ${s.getDate()}${sameMonth ? "" : ` ${MO[s.getMonth()]}`} → ${shortDay(e)}`,
      sub: `${fmtTime(s)} – ${fmtTime(e)}`,
    };
  }
  function shortRange() {
    if (!job.scheduled_start) return "Sem data";
    const s = new Date(job.scheduled_start);
    const e = job.scheduled_end ? new Date(job.scheduled_end) : null;
    const dm = { day: "numeric", month: "short" };
    if (!e || s.toDateString() === e.toDateString()) return fmtDay(s, dm);
    if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${fmtDay(e, dm)}`;
    return `${fmtDay(s, dm)} – ${fmtDay(e, dm)}`;
  }
  function clientName() {
    return job.customer?.name || job.builder?.company || job.builder?.name || job.source_name || "Sem cliente";
  }
  function lockbox(notes) {
    const fn = window.parseJobLockbox;
    if (typeof fn === "function") return fn(notes);
    const m = String(notes || "").match(/\/lockbox\s*[#:]?\s*([0-9A-Za-z-]{2,24})\b/i);
    return m ? m[1] : null;
  }
  function mapsUrl() {
    return job.address ? `https://maps.google.com/?q=${encodeURIComponent(job.address)}` : "";
  }

  // ---------------------------------------------------------------- header
  function renderHeader() {
    const [label, cls] = STATUS[job.status] || [job.status, "draft"];
    const b = billing?.billing || job.billing;
    $("jdChips").innerHTML = `
      <span class="jd-pill jd-pill--${cls}">${esc(label)}</span>
      ${canBill && b && b.billing_status !== "no_value" && window.JobBilling ? window.JobBilling.chip(b) : ""}
      ${job.number != null ? `<span class="jd-num">Job #${esc(job.number)}</span>` : ""}`;
    $("jobDetailTitle").textContent = job.title || `Job para ${clientName()}`;
    document.title = `${job.title || clientName()} | ObraMate`;
    const type = SOURCE[job.source_type] || "";
    const parts = [
      `<span><b>${esc(clientName())}</b>${type ? ` · ${esc(type)}` : ""}</span>`,
      job.address
        ? `<a href="${esc(mapsUrl())}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(job.address)}</a>`
        : `<span class="jd-muted">Sem endereço</span>`,
      `<span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${esc(shortRange())}</span>`,
    ];
    $("jdSub").innerHTML = parts.join("");
    renderPrimary();
    $("btnOpenSchedule").href = job.scheduled_start ? `schedule.html?focus=${encodeURIComponent(job.scheduled_start)}` : "schedule.html";
    $("jdOpenCampo").href = `/campo/ticket.html?id=${encodeURIComponent(job.id)}`;
    const map = $("jdOpenMap");
    map.hidden = !job.address;
    if (job.address) map.href = mapsUrl();
  }

  /** One obvious next step, depending on where the job is. */
  function primaryAction() {
    if (job.status === "canceled") return null;
    const b = billing?.billing;
    if (canInvoice && b) {
      if (job.status === "completed" && b.remaining_to_invoice > 0.004) {
        return { label: `Faturar ${money0(b.remaining_to_invoice)}`, act: "invoice" };
      }
      if (b.open_balance > 0.004) {
        const list = billing.data || [];
        const open = list.find((i) => i.display_status !== "draft" && i.remaining_amount > 0.004) || list.find((i) => i.remaining_amount > 0.004);
        if (open) return { label: open.display_status === "draft" ? "Enviar fatura" : "Receber pagamento", href: open.url };
      }
    }
    if (!canManage) return null;
    if (!job.line_items?.length) return { label: "Adicionar serviços", act: "services" };
    if (!job.scheduled_start) return { label: "Agendar", act: "schedule" };
    if (job.status === "draft" || job.status === "scheduled") return { label: "Iniciar job", act: "start" };
    if (job.status === "in_progress") return { label: "Concluir job", act: "complete" };
    return null;
  }
  function renderPrimary() {
    const a = primaryAction();
    const box = $("jdPrimary");
    if (!a) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = a.href
      ? `<a class="jd-btn jd-btn--pri" href="${esc(a.href)}">${esc(a.label)}</a>`
      : `<button type="button" class="jd-btn jd-btn--pri" data-primary="${esc(a.act)}">${esc(a.label)}</button>`;
  }
  async function runPrimary(act) {
    if (act === "invoice") return window.JobBilling.openDialog({ jobId, billing: billing.billing, jobStatus: job.status });
    if (act === "services") return openSection("services");
    if (act === "schedule") return openSection("schedule");
    if (act === "start") return setStatus("in_progress", "Job iniciado.");
    if (act === "complete") {
      if (!confirm("Marcar o job como concluído?")) return;
      return setStatus("completed", "Job concluído.");
    }
  }
  async function setStatus(status, msg) {
    const j = await api(`/api/work-orders/${jobId}`, { method: "PUT", body: JSON.stringify({ status }) });
    job = j.data;
    notify(msg || "Status atualizado.", "success");
    await refreshBilling();
    renderAll();
  }

  // ---------------------------------------------------------------- steps
  function renderSteps() {
    if (job.status === "canceled") {
      $("jdSteps").innerHTML = `<li class="jd-step is-canceled"><i>×</i><span>Job cancelado</span></li>`;
      return;
    }
    const b = billing?.billing;
    const done = job.status === "completed";
    const steps = [
      {
        label: "Agendado",
        sub: job.scheduled_start ? fmtDay(new Date(job.scheduled_start), { day: "numeric", month: "short" }) : "sem data",
        state: job.scheduled_start ? "ok" : "cur",
      },
      {
        label: "Em campo",
        sub:
          job.status === "in_progress"
            ? field?.field_status_label || "em andamento"
            : field?.hours?.total
              ? `${qty(field.hours.total)} h registradas`
              : "",
        state: done ? "ok" : job.status === "in_progress" ? "cur" : "",
      },
      { label: "Concluído", sub: "", state: done ? "ok" : "" },
    ];
    if (canBill && b) {
      const fully = b.services_total > 0 && b.remaining_to_invoice <= 0.004;
      steps.push({
        label: "Faturado",
        sub: b.invoiced_total > 0 ? money0(b.invoiced_total) : "",
        state: fully ? "ok" : b.invoiced_total > 0 || done ? "cur" : "",
      });
      steps.push({
        label: "Pago",
        sub: b.billing_status === "paid" ? money0(b.paid_total) : b.open_balance > 0 ? `falta ${money0(b.open_balance)}` : "",
        state: b.billing_status === "paid" ? "ok" : b.open_balance > 0 ? "cur" : "",
      });
    }
    // Only the first unfinished step is "current".
    let seen = false;
    steps.forEach((s) => {
      if (s.state === "cur") {
        if (seen) s.state = "";
        seen = true;
      }
    });
    $("jdSteps").innerHTML = steps
      .map(
        (s, i) => `<li class="jd-step${s.state ? ` is-${s.state}` : ""}"><i>${s.state === "ok" ? "✓" : i + 1}</i><span>${esc(s.label)}${s.sub ? `<small>${esc(s.sub)}</small>` : ""}</span></li>`,
      )
      .join("");
  }

  // ---------------------------------------------------------------- overview
  function renderFacts() {
    const w = whenText();
    const c = job.customer;
    const contact = [c?.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : "", c?.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""]
      .filter(Boolean)
      .join(" · ");
    const members = (job.members || []).filter((m) => m.user_id !== job.assigned_user_id);
    const temps = job.temp_workers || [];
    const teamSub = [members.length ? `+ ${members.map((m) => String(m.name || "").split(" ")[0]).join(", ")}` : "", temps.length ? `${temps.length} temp.` : ""]
      .filter(Boolean)
      .join(" · ");
    const n = (job.line_items || []).length;
    $("jdFacts").innerHTML = `
      <div><small>Cliente</small><b>${esc(clientName())}</b><span>${contact || esc(job.builder?.name || "Sem contato")}</span></div>
      <div><small>Quando</small><b>${esc(w.main)}</b><span>${esc(w.sub)}</span></div>
      <div><small>Equipe</small><b>${esc(job.assigned_user?.name || "Sem responsável")}</b><span>${esc(teamSub || (job.assigned_user ? "Responsável" : ""))}</span></div>
      <div><small>Preços</small><b>Tabela · ${esc(SOURCE[job.source_type] || "—")}</b><span>${n ? `${n} serviço${n > 1 ? "s" : ""} · ${money(job.services_total)}` : "Sem serviços"}</span></div>`;
  }

  function renderAttention() {
    const card = $("jdAttentionCard");
    const att = (job.campo_attention || "").trim();
    const problem = (field?.problem_note || "").trim();
    card.hidden = !att && !problem;
    if (card.hidden) return;
    card.className = `jd-card jd-alert${problem ? " jd-alert--problem" : ""}`;
    card.innerHTML = `${problem ? `<div><b>Problema relatado pelo campo</b><p>${esc(problem)}</p></div>` : ""}
      ${att ? `<div><b>Atenção para o campo</b><p>${esc(att)}</p></div>` : ""}
      <button type="button" class="jd-link" data-goto="campo">Ver no Campo</button>`;
  }

  function servicesTable(full) {
    const lines = job.line_items || [];
    if (!lines.length) {
      return `<p class="jd-empty">Nenhum serviço ainda.${canManage ? " Adicione os serviços da Tabela de Valores — eles viram a fatura do job." : ""}</p>`;
    }
    return `<table class="jd-table">
      <thead><tr><th>Serviço</th><th class="r">Qtd</th>${full ? '<th class="r">Preço</th>' : ""}<th class="r">Total</th></tr></thead>
      <tbody>${lines
        .map(
          (l) => `<tr><td>${esc(l.service_name)}</td><td class="r">${esc(qty(l.quantity_sqft))} ${esc(unitLabel(l.unit))}</td>${
            full ? `<td class="r jd-muted">${money(l.unit_price)}</td>` : ""
          }<td class="r">${money(l.line_total)}</td></tr>`,
        )
        .join("")}</tbody>
      <tfoot><tr><td colspan="${full ? 3 : 2}">Total do job</td><td class="r">${money(job.services_total)}</td></tr></tfoot>
    </table>`;
  }

  function renderServices() {
    const n = (job.line_items || []).length;
    $("jdSvcCount").textContent = n || "";
    $("jdSvcCount2").textContent = n || "";
    $("jobServicesBody").innerHTML = servicesTable(false);
    $("jdServicesFull").innerHTML = servicesTable(true);
  }

  function renderNotes() {
    const raw = (job.notes || "").trim();
    const code = lockbox(raw);
    let text = raw.replace(/\/lockbox\s*[#:]?\s*[0-9A-Za-z-]{2,24}\b\s*[—–-]?\s*/i, "").trim();
    if (code && text) text = text.charAt(0).toUpperCase() + text.slice(1);
    $("jdNotesView").innerHTML = raw
      ? `<div class="jd-note">${
          code
            ? `<span class="jd-lock" title="Código da caixa (lockbox)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>${esc(code)}</span>`
            : ""
        }${text ? `<p>${esc(text)}</p>` : ""}</div>`
      : `<p class="jd-empty">Sem notas.${canManage ? " Use para acesso, código do portão, cuidados com a obra." : ""}</p>`;
    $("jobNotes").value = job.notes || "";
  }

  function renderTeam() {
    const rows = [];
    if (job.assigned_user) rows.push({ name: job.assigned_user.name, role: "Responsável", lead: true });
    (job.members || []).filter((m) => m.user_id !== job.assigned_user_id).forEach((m) => rows.push({ name: m.name, role: "Equipe" }));
    const temps = job.temp_workers || [];
    $("jobTeamBody").innerHTML =
      rows.length || temps.length
        ? `<ul class="jd-people">${rows
            .map((r) => `<li><span class="jd-av${r.lead ? " jd-av--lead" : ""}">${esc(initials(r.name))}</span><span><b>${esc(r.name)}</b><small>${esc(r.role)}</small></span></li>`)
            .join("")}${temps
            .map(
              (t) => `<li><span class="jd-av jd-av--temp">${esc(initials(t.name))}</span><span><b>${esc(t.name)}</b><small>Temporário${t.phone ? ` · ${esc(t.phone)}` : ""}</small></span>
              ${canManage ? `<span class="jd-people__act"><button type="button" class="jd-mini" data-temp="${esc(t.id)}" data-ch="whatsapp">WhatsApp</button><button type="button" class="jd-mini" data-temp="${esc(t.id)}" data-ch="copy">Link</button></span>` : ""}</li>`,
            )
            .join("")}</ul>`
        : `<p class="jd-empty">Ninguém escalado.</p>`;
  }

  const INV_ST = { draft: "Rascunho", sent: "Enviada", viewed: "Vista", partially_paid: "Parcial", overdue: "Vencida", paid: "Paga", void: "Anulada" };
  function renderMoney() {
    const card = $("jdMoneyCard");
    const b = billing?.billing;
    card.hidden = !canBill || !b;
    if (card.hidden) return;
    const total = Number(b.services_total) || 0;
    const paidPct = total > 0 ? Math.min(100, (b.paid_total / total) * 100) : 0;
    const openPct = total > 0 ? Math.min(100 - paidPct, (b.open_balance / total) * 100) : 0;
    const headline =
      b.billing_status === "paid"
        ? { k: "Recebido", v: b.paid_total }
        : b.open_balance > 0.004
          ? { k: "A receber", v: b.open_balance }
          : { k: "A faturar", v: b.remaining_to_invoice };
    const invs = (billing.data || []).slice(-3).reverse();
    $("jdMoney").innerHTML = `
      <div class="jd-big"><small>${headline.k}</small><strong>${money(headline.v)}</strong></div>
      ${total > 0 ? `<div class="jd-bar"><i class="p" style="width:${paidPct.toFixed(1)}%"></i><i class="o" style="width:${openPct.toFixed(1)}%"></i></div>` : ""}
      <dl class="jd-kv">
        <div><dt><i class="jd-dot jd-dot--paid"></i>Recebido</dt><dd>${money(b.paid_total)}</dd></div>
        <div><dt><i class="jd-dot jd-dot--open"></i>Em aberto</dt><dd>${money(b.open_balance)}</dd></div>
        <div><dt>A faturar</dt><dd>${money(b.remaining_to_invoice)}</dd></div>
        <div class="jd-kv__total"><dt>Total do job</dt><dd>${money(total)}</dd></div>
      </dl>
      ${
        invs.length
          ? `<ul class="jd-invs">${invs
              .map(
                (i) => `<li><a href="${esc(i.url)}"><span><b>${esc(i.invoice_number || "Fatura")}</b><small>${esc(i.invoice_type_label || "")}</small></span>
                <span class="jd-tag jd-tag--${esc(i.display_status)}">${esc(INV_ST[i.display_status] || i.display_status)}</span><span class="jd-invs__amt">${money0(i.amount)}</span></a></li>`,
              )
              .join("")}</ul>`
          : ""
      }`;
  }

  // ---------------------------------------------------------------- after the job (review, caption, report, portfolio)
  function renderAfter() {
    const card = $("jdAfterCard");
    const show = job.status === "completed" || (media || []).some((m) => m.stage === "after");
    card.hidden = !show;
    if (!show) return;
    $("jdAfterActions").innerHTML = `
      <button type="button" class="jd-btn${afterOpen === "review" ? " is-on" : ""}" data-after="review">Pedir review</button>
      <button type="button" class="jd-btn${afterOpen === "caption" ? " is-on" : ""}" data-after="caption">Antes/depois para redes</button>
      <button type="button" class="jd-btn" data-goto="fotos" data-scroll="jobReportCard">Relatório com fotos</button>
      ${orgSlug ? `<a class="jd-btn" href="/public/portfolio/${encodeURIComponent(orgSlug)}?embed=1" target="_blank" rel="noopener">Portfólio público</a>` : ""}`;
    const body = $("jdAfterBody");
    if (afterOpen === "review") {
      if (!reviewReq) {
        body.innerHTML = '<p class="jd-empty">A carregar…</p>';
        api(`/api/work-orders/${jobId}/review-request`)
          .then((j) => {
            reviewReq = j.data || {};
            renderAfter();
          })
          .catch((e) => (body.innerHTML = `<p class="jd-empty">${esc(e.message)}</p>`));
        return;
      }
      body.innerHTML = `<div class="jd-after">
        <p class="jd-after__msg">${esc(reviewReq.message || "")}</p>
        <div class="jd-actions">
          ${reviewReq.whatsapp_url ? `<a class="jd-mini" href="${esc(reviewReq.whatsapp_url)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          ${reviewReq.sms_url ? `<a class="jd-mini" href="${esc(reviewReq.sms_url)}">SMS</a>` : ""}
          ${reviewReq.mailto_url ? `<a class="jd-mini" href="${esc(reviewReq.mailto_url)}">E-mail</a>` : ""}
          <button type="button" class="jd-mini" data-copy="review">Copiar</button>
        </div>
        ${reviewReq.google_review_url ? "" : '<p class="jd-hint">Dica: cadastre o link do Google Reviews da empresa para ele entrar na mensagem.</p>'}
      </div>`;
    } else if (afterOpen === "caption") {
      if (!marketing) {
        body.innerHTML = '<p class="jd-empty">A carregar…</p>';
        api(`/api/work-orders/${jobId}/portfolio-preview`)
          .then((j) => {
            marketing = j.data || {};
            renderAfter();
          })
          .catch((e) => (body.innerHTML = `<p class="jd-empty">${esc(e.message)}</p>`));
        return;
      }
      body.innerHTML = `<div class="jd-after">
        <p class="jd-hint">${marketing.before?.length || 0} foto(s) de antes · ${marketing.after?.length || 0} de depois</p>
        <textarea class="jd-ta" readonly rows="5">${esc(marketing.social_caption || "")}</textarea>
        <div class="jd-actions"><button type="button" class="jd-mini" data-copy="caption">Copiar legenda</button><button type="button" class="jd-mini" data-goto="fotos">Ver fotos</button></div>
      </div>`;
    } else {
      body.innerHTML = "";
    }
  }

  // ---------------------------------------------------------------- serviços e faturas
  function renderBillingTab() {
    const card = $("jobBillingCard");
    card.hidden = !canBill || !window.JobBilling;
    if (card.hidden) return;
    $("jobBillingAll").href = `invoices.html?q=${encodeURIComponent(job.number != null ? `Job #${job.number}` : job.title || "")}`;
    $("jobBillingChip").innerHTML = window.JobBilling.chip(billing?.billing || job.billing);
    if (!billingCtl) {
      billingCtl = window.JobBilling.mountCard($("jobBillingBody"), {
        jobId,
        jobStatus: job.status,
        canManage: canInvoice,
        onChange: (b) => {
          $("jobBillingChip").innerHTML = window.JobBilling.chip(b);
        },
      });
    } else {
      billingCtl.setJobStatus(job.status);
      billingCtl.refresh().catch(() => {});
    }
  }

  function isB2B() {
    const s = String(job.source_type || "").toLowerCase();
    return s === "builder" || s === "contractor" || s === "loja" || Boolean(job.builder_id);
  }
  async function loadProposals() {
    const card = $("jobProposalCard");
    try {
      const j = await api(`/api/work-orders/${jobId}/quotes`);
      proposals = j.data || [];
    } catch (_) {
      proposals = [];
    }
    // Fixed-price jobs (Builder / Contractor / Loja) are billed from the table — no quote.
    card.hidden = isB2B() && !proposals.length;
    const body = $("jobProposalBody");
    if (!proposals.length) {
      body.innerHTML = '<p class="jd-empty">Transforme este job num orçamento que o cliente assina online.</p>';
      return;
    }
    body.innerHTML = `<ul class="jd-invs">${proposals
      .map(
        (q) => `<li><a href="${esc(q.edit_url || `quote-builder.html?id=${q.id}`)}"><span><b>#${esc(q.number)} · ${esc(q.title || "Proposta")}</b><small>${esc(q.status)}</small></span><span class="jd-invs__amt">${money0(q.total)}</span></a>
        ${q.status === "draft" || q.status === "changes_requested" ? `<button type="button" class="jd-mini" data-send-quote="${esc(q.id)}">Enviar para assinatura</button>` : ""}</li>`,
      )
      .join("")}</ul>`;
  }
  async function createProposal(withAi) {
    notify(withAi ? "Criando proposta com IA…" : "Criando proposta…", "info");
    await api(`/api/work-orders/${jobId}/quotes`, { method: "POST", body: JSON.stringify({ include_public_photos: true, suggest_with_ai: Boolean(withAi) }) });
    notify("Proposta criada — revise as linhas e envie para assinatura.", "success");
    await loadProposals();
  }
  async function sendProposal(id) {
    const j = await api(`/api/work-orders/${jobId}/quotes/${id}/send`, { method: "POST" });
    const url = j.data?.public_url || "";
    if (url && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      notify("Link de assinatura copiado.", "success");
    } else if (url) window.prompt("Link de assinatura:", url);
    await loadProposals();
  }

  // ---------------------------------------------------------------- fotos
  async function loadMedia() {
    const [m, r] = await Promise.all([
      api(`/api/work-orders/${jobId}/media`),
      api(`/api/work-orders/${jobId}/reports`).catch(() => ({ data: [], meta: {} })),
    ]);
    media = m.data || [];
    reports = r.data || [];
    aiEnabled = Boolean(r.meta?.ai_enabled);
    $("jdTabFotos").textContent = media.length ? String(media.length) : "";
  }
  function renderPhotos() {
    if (!media) {
      $("jobMediaBody").innerHTML = '<p class="jd-empty">A carregar fotos…</p>';
      return;
    }
    const counts = { all: media.length, before: 0, during: 0, after: 0, none: 0 };
    media.forEach((m) => {
      counts[m.stage && counts[m.stage] != null ? m.stage : "none"] += 1;
    });
    const opts = [
      ["all", "Todas"],
      ["before", "Antes"],
      ["during", "Durante"],
      ["after", "Depois"],
      ["none", "Geral"],
    ].filter(([k]) => k === "all" || counts[k] > 0);
    if (!opts.some(([k]) => k === mediaFilter)) mediaFilter = "all";
    $("jdPhotoFilter").innerHTML = opts
      .map(([k, l]) => `<button type="button" class="${k === mediaFilter ? "is-on" : ""}" data-filter="${k}">${l} <em>${counts[k]}</em></button>`)
      .join("");
    $("jdPhotoCount").textContent = media.length || "";
    const list = media.filter((m) => mediaFilter === "all" || (mediaFilter === "none" ? !m.stage : m.stage === mediaFilter));
    const last = media[0];
    const age = last?.created_at ? Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000) : null;
    const stale = job.status === "in_progress" && age != null && age >= 3 ? `<p class="jd-warn">Última foto há ${age} dias.</p>` : "";
    $("jobMediaBody").innerHTML = list.length
      ? `${stale}<div class="jd-photos">${list
          .map((p) => {
            const st = STAGE[p.stage] || "";
            return `<figure class="jd-photo">
              <a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.thumb_url || p.url)}" alt="${esc(p.caption || st || "Foto")}" loading="lazy" /></a>
              ${st ? `<span class="jd-photo__stage">${esc(st)}</span>` : ""}
              ${p.in_portfolio ? '<span class="jd-photo__flag">Portfólio</span>' : ""}
              <figcaption><span>${esc(p.caption || "")}</span>
              ${canManage && !p.legacy ? `<button type="button" class="jd-photo__port" data-port="${esc(p.id)}" data-on="${p.in_portfolio ? "1" : "0"}" title="${p.in_portfolio ? "Tirar do portfólio" : "Pôr no portfólio"}" aria-label="${p.in_portfolio ? "Tirar do portfólio" : "Pôr no portfólio"}">${p.in_portfolio ? "★" : "☆"}</button>` : ""}</figcaption>
            </figure>`;
          })
          .join("")}</div>`
      : `<p class="jd-empty">${media.length ? "Nenhuma foto nesta etapa." : "Ainda sem fotos. Adicione aqui ou tire pelo Campo."}</p>`;
    const link = $("jobPortfolioLink");
    link.hidden = !orgSlug;
    if (orgSlug) link.href = `/public/portfolio/${encodeURIComponent(orgSlug)}?embed=1`;
    renderReports();
  }
  function renderReports() {
    const btn = $("btnGenerateReport");
    btn.disabled = !aiEnabled || !canManage;
    btn.title = aiEnabled ? "Gerar rascunho a partir das fotos" : "Precisa da chave de IA configurada no servidor";
    $("jobReportBody").innerHTML = reports.length
      ? `<ul class="jd-reports">${reports
          .map(
            (r) => `<li><div><b>${esc(r.title || "Relatório")}</b><small>${esc(r.status === "published" ? "Publicado" : "Rascunho")}${r.is_public ? " · no link do cliente" : ""}</small><p>${esc((r.summary || "").slice(0, 280))}</p></div>
            <span class="jd-actions"><a class="jd-mini" href="/api/work-orders/${encodeURIComponent(jobId)}/reports/${encodeURIComponent(r.id)}/pdf" target="_blank" rel="noopener">PDF</a>
            ${
              canManage
                ? `<button type="button" class="jd-mini" data-report="${esc(r.id)}" data-status="${r.status === "published" ? "draft" : "published"}">${r.status === "published" ? "Despublicar" : "Publicar"}</button>
            <button type="button" class="jd-mini" data-report-pub="${esc(r.id)}" data-public="${r.is_public ? "0" : "1"}">${r.is_public ? "Tirar do link" : "Mostrar no link"}</button>`
                : ""
            }</span></li>`,
          )
          .join("")}</ul>`
      : `<p class="jd-empty">${aiEnabled ? "Gere um relatório com as fotos do job para mandar ao cliente." : "Relatório com IA indisponível neste servidor."}</p>`;
  }

  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível ler a imagem. Use JPG ou PNG."));
      };
      img.src = url;
    });
  }
  async function uploadPhotos(files) {
    const btn = $("btnAddJobPhoto");
    btn.disabled = true;
    const stage = $("jobPhotoStage").value || null;
    let ok = 0;
    try {
      for (const file of files) {
        const type = String(file.type || "").toLowerCase();
        if (type.includes("heic") || type.includes("heif")) {
          notify("Foto HEIC não suportada — exporte como JPG.", "error");
          continue;
        }
        btn.textContent = `Enviando ${ok + 1}/${files.length}…`;
        const dataUrl = await compressImage(file, 1600, 0.75);
        const j = await api(`/api/work-orders/${jobId}/media`, {
          method: "POST",
          body: JSON.stringify({
            data_url: dataUrl,
            stage,
            taken_at_device: new Date(file.lastModified || Date.now()).toISOString(),
            address: job.address || null,
            client_upload_id: window.crypto?.randomUUID ? crypto.randomUUID() : `office-${Date.now()}-${ok}`,
            device_label: "Office web",
            is_public: false,
          }),
        });
        media = [j.data, ...(media || []).filter((p) => p.id !== j.data.id)];
        ok += 1;
      }
      if (ok) notify(ok === 1 ? "Foto adicionada." : `${ok} fotos adicionadas.`, "success");
    } catch (e) {
      notify(e.message || "Falha no envio", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "+ Adicionar fotos";
      $("jdTabFotos").textContent = media?.length ? String(media.length) : "";
      renderPhotos();
      renderAfter();
    }
  }

  // ---------------------------------------------------------------- campo
  async function loadField() {
    try {
      const j = await api(`/api/work-orders/${jobId}/field`);
      field = j.data;
    } catch (_) {
      field = null;
    }
    const c = field?.checklist;
    $("jdTabCampo").textContent = c && c.customized ? `${c.done}/${c.total}` : "";
  }
  function renderField() {
    const box = $("jdField");
    if (!field) {
      box.innerHTML = '<div class="jd-card"><p class="jd-empty">Não foi possível carregar o campo.</p></div>';
      return;
    }
    const c = field.checklist;
    const h = field.hours;
    const att = job.campo_attention || "";
    // The office can close a job without the crew stepping through Campo — show the real state.
    const fs = job.status === "completed" ? "completed" : job.status === "canceled" ? "canceled" : field.field_status;
    const fsLabel = fs === "completed" ? "Concluída" : fs === "canceled" ? "Cancelada" : field.field_status_label;
    const fsCls = fs === "completed" ? "done" : fs === "canceled" ? "canceled" : fs === "scheduled" ? "scheduled" : "progress";
    box.innerHTML = `<div class="jd-grid">
      <div class="jd-col">
        ${field.problem_note ? `<div class="jd-card jd-alert jd-alert--problem"><div><b>Problema relatado</b><p>${esc(field.problem_note)}</p></div></div>` : ""}
        <div class="jd-card">
          <div class="jd-ch"><h2>Checklist</h2><span class="jd-ch__n">${c.done}/${c.total}</span><a class="jd-link" href="${esc(field.campo_url)}">Abrir no Campo</a></div>
          ${!c.customized ? '<p class="jd-hint">Modelo padrão — a equipe ajusta o checklist no Campo.</p>' : ""}
          <div class="jd-bar jd-bar--thin"><i class="p" style="width:${c.total ? ((c.done / c.total) * 100).toFixed(0) : 0}%"></i></div>
          <ul class="jd-check">${c.items
            .map(
              (i) => `<li class="${i.done ? "is-done" : ""}"><i aria-hidden="true">${i.done ? "✓" : ""}</i><span>${esc(i.text)}${
                i.photo_required ? ` <em class="jd-tag">${i.photos ? `${i.photos} foto${i.photos > 1 ? "s" : ""}` : "foto obrigatória"}</em>` : ""
              }${i.note ? `<small>${esc(i.note)}</small>` : ""}</span></li>`,
            )
            .join("")}</ul>
        </div>
        ${
          field.measurements.length
            ? `<div class="jd-card"><div class="jd-ch"><h2>Medições do campo</h2><span class="jd-ch__n">${field.measurements.length}</span></div>
              <table class="jd-table"><tbody>${field.measurements
                .map((m) => `<tr><td>${esc(m.label)}${m.note ? `<small class="jd-muted"> · ${esc(m.note)}</small>` : ""}</td><td class="r">${esc(qty(m.value))} ${esc(m.unit)}</td></tr>`)
                .join("")}</tbody></table></div>`
            : ""
        }
        ${
          field.inspections.length
            ? `<div class="jd-card"><div class="jd-ch"><h2>Inspeções por voz</h2><span class="jd-ch__n">${field.inspections.length}</span></div>
              <ul class="jd-reports">${field.inspections
                .map((i) => `<li><div><small>${esc(new Date(i.created_at).toLocaleString("pt-BR"))}</small><p>${esc(i.summary || "Sem resumo")}</p></div></li>`)
                .join("")}</ul></div>`
            : ""
        }
      </div>
      <aside class="jd-col jd-side">
        <div class="jd-card">
          <div class="jd-ch"><h2>Status no campo</h2></div>
          <p class="jd-fieldstat"><span class="jd-pill jd-pill--${fsCls}">${esc(fsLabel)}</span></p>
        </div>
        <div class="jd-card">
          <div class="jd-ch"><h2>Horas no job</h2><span class="jd-ch__n">${h.total ? `${qty(h.total)} h` : ""}</span></div>
          ${
            h.people.length
              ? `<ul class="jd-people">${h.people
                  .map(
                    (p) => `<li><span class="jd-av">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b><small>${p.days} dia${p.days === 1 ? "" : "s"}${p.sqft ? ` · ${qty(p.sqft)} sq ft` : ""}</small></span><span class="jd-people__num">${qty(p.hours)} h</span></li>`,
                  )
                  .join("")}</ul>`
              : '<p class="jd-empty">Ninguém registrou horas neste job ainda.</p>'
          }
        </div>
        <div class="jd-card">
          <div class="jd-ch"><h2>Atenção para o campo</h2></div>
          ${
            canManage
              ? `<textarea class="jd-ta" id="jdAttention" rows="3" maxlength="2000" placeholder="Aparece em destaque para a equipe no Campo. Ex.: proteger degraus, cachorro no quintal.">${esc(att)}</textarea>
                 <div class="jd-row-end"><button type="button" class="jd-btn jd-btn--pri jd-btn--sm" id="jdAttentionSave">Salvar</button></div>`
              : att
                ? `<p>${esc(att)}</p>`
                : '<p class="jd-empty">Nada destacado.</p>'
          }
        </div>
      </aside>
    </div>`;
  }

  // ---------------------------------------------------------------- tabs
  function setTab(next, opts) {
    tab = TABS.includes(next) ? next : "geral";
    document.querySelectorAll("#jdTabs [data-tab]").forEach((b) => {
      const on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("#jobDetailRoot [data-panel]").forEach((p) => {
      p.hidden = p.getAttribute("data-panel") !== tab;
    });
    if (!opts || !opts.silent) {
      try {
        history.replaceState(null, "", `${location.pathname}${location.search}${tab === "geral" ? "" : `#${tab}`}`);
      } catch (_) {}
    }
    if (tab === "servicos") {
      renderBillingTab();
      if (proposals === null) loadProposals();
    }
    if (tab === "fotos") {
      if (!media) loadMedia().then(renderPhotos).catch((e) => ($("jobMediaBody").innerHTML = `<p class="jd-empty">${esc(e.message)}</p>`));
      else renderPhotos();
    }
    if (tab === "campo") {
      if (!field) {
        $("jdField").innerHTML = '<div class="jd-card"><p class="jd-empty">A carregar…</p></div>';
        loadField().then(renderField);
      } else renderField();
    }
    if (tab === "conversa" && !commsCtl && window.JobChatComms) {
      commsCtl = window.JobChatComms.mount($("jobCommsBody"), {
        jobId,
        workOrder: job,
        onError: (err) => notify(err.message || "Erro", "error"),
      });
    }
  }

  // ---------------------------------------------------------------- data
  async function refreshBilling() {
    if (!canBill || !window.JobBilling) return;
    try {
      billing = await window.JobBilling.load(jobId);
    } catch (_) {
      billing = null;
    }
  }

  function renderAll() {
    renderHeader();
    renderSteps();
    renderFacts();
    renderAttention();
    renderServices();
    renderNotes();
    renderTeam();
    renderMoney();
    renderAfter();
    if (tab === "servicos") renderBillingTab();
    if (tab === "campo" && field) renderField();
    if (!canManage) {
      document.querySelectorAll('#jobDetailRoot [data-crm-permission="work_orders.manage"]').forEach((el) => (el.style.display = "none"));
      const bar = $("jobMediaUploadBar");
      if (bar) bar.querySelectorAll("select, #btnAddJobPhoto").forEach((el) => (el.style.display = "none"));
    }
  }

  async function loadJob() {
    const j = await api(`/api/work-orders/${jobId}`);
    job = j.data;
    await Promise.all([refreshBilling(), loadField(), loadMedia().catch(() => {})]);
    renderAll();
  }

  function openSection(section) {
    return window.__crmJobModal.openEdit(jobId, { section }).catch((e) => notify(e.message, "error"));
  }

  async function shareTemp(id, channel) {
    try {
      const j = await api(`/api/work-orders/${jobId}/temp-workers/${id}/share-link`, { method: "POST" });
      const d = j.data || {};
      if (channel === "whatsapp" && d.whatsapp_url) window.open(d.whatsapp_url, "_blank", "noopener");
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(d.url);
        notify("Link copiado.", "success");
      } else window.prompt("Link do job:", d.url);
    } catch (e) {
      notify(e.message || "Erro ao gerar o link", "error");
    }
  }

  function renderStatusMenu() {
    const box = $("jdStatusList");
    box.innerHTML = Object.entries(STATUS)
      .map(([k, [l, cls]]) => `<button type="button" role="menuitemradio" aria-checked="${k === job.status}" data-set-status="${k}"><span class="jd-pill jd-pill--${cls}">${l}</span>${k === job.status ? " ✓" : ""}</button>`)
      .join("");
  }

  function bind() {
    const root = $("jobDetailRoot");
    $("jdTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) setTab(b.getAttribute("data-tab"));
    });
    $("jdTabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1);
      const next = TABS[(i + TABS.length) % TABS.length];
      setTab(next);
      document.querySelector(`#jdTabs [data-tab="${next}"]`)?.focus();
    });

    const menu = $("jdMoreMenu");
    const closeMenu = () => {
      menu.hidden = true;
      $("jdStatusList").hidden = true;
      $("jdMoreBtn").setAttribute("aria-expanded", "false");
    };
    $("jdMoreBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeMenu();
      menu.hidden = !open;
      $("jdMoreBtn").setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
    $("jdStatusMenu").addEventListener("click", () => {
      renderStatusMenu();
      $("jdStatusList").hidden = !$("jdStatusList").hidden;
    });
    $("jdStatusList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-set-status]");
      if (!b) return;
      const k = b.getAttribute("data-set-status");
      closeMenu();
      if (k === job.status) return;
      try {
        await setStatus(k);
      } catch (err) {
        notify(err.message, "error");
      }
    });

    root.addEventListener("click", async (e) => {
      const t = e.target;
      const go = t.closest("[data-goto]");
      if (go) {
        e.preventDefault();
        setTab(go.getAttribute("data-goto"));
        const sc = go.getAttribute("data-scroll");
        const top = $("jdTabs").getBoundingClientRect().top + window.scrollY - 12;
        if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
        if (sc) setTimeout(() => $(sc)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        return;
      }
      const prim = t.closest("[data-primary]");
      if (prim) {
        runPrimary(prim.getAttribute("data-primary")).catch((err) => notify(err.message, "error"));
        return;
      }
      const after = t.closest("[data-after]");
      if (after) {
        const k = after.getAttribute("data-after");
        afterOpen = afterOpen === k ? null : k;
        renderAfter();
        return;
      }
      const copy = t.closest("[data-copy]");
      if (copy) {
        const text = copy.getAttribute("data-copy") === "review" ? reviewReq?.message || "" : marketing?.social_caption || "";
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          notify("Copiado.", "success");
        } else window.prompt("Copie:", text);
        return;
      }
      const temp = t.closest("[data-temp]");
      if (temp) {
        shareTemp(temp.getAttribute("data-temp"), temp.getAttribute("data-ch"));
        return;
      }
      const filter = t.closest("[data-filter]");
      if (filter) {
        mediaFilter = filter.getAttribute("data-filter");
        renderPhotos();
        return;
      }
      const port = t.closest("[data-port]");
      if (port) {
        const next = port.getAttribute("data-on") !== "1";
        try {
          const j = await api(`/api/work-orders/${jobId}/media/${port.getAttribute("data-port")}/portfolio`, {
            method: "PATCH",
            body: JSON.stringify({ in_portfolio: next }),
          });
          media = media.map((p) => (p.id === j.data.id ? j.data : p));
          renderPhotos();
          notify(next ? "Foto no portfólio público." : "Foto tirada do portfólio.", "success");
        } catch (err) {
          notify(err.message, "error");
        }
        return;
      }
      const rep = t.closest("[data-report]");
      const repPub = t.closest("[data-report-pub]");
      if (rep || repPub) {
        const id = rep ? rep.getAttribute("data-report") : repPub.getAttribute("data-report-pub");
        const body = rep ? { status: rep.getAttribute("data-status") } : { is_public: repPub.getAttribute("data-public") === "1" };
        try {
          const j = await api(`/api/work-orders/${jobId}/reports/${id}`, { method: "PATCH", body: JSON.stringify(body) });
          reports = reports.map((r) => (r.id === j.data.id ? j.data : r));
          renderReports();
        } catch (err) {
          notify(err.message, "error");
        }
        return;
      }
      const sendQ = t.closest("[data-send-quote]");
      if (sendQ) {
        sendProposal(sendQ.getAttribute("data-send-quote")).catch((err) => notify(err.message, "error"));
        return;
      }
      if (t.closest("#jdAttentionSave")) {
        try {
          const j = await api(`/api/work-orders/${jobId}`, {
            method: "PUT",
            body: JSON.stringify({ campo_attention: $("jdAttention").value.trim() || null }),
          });
          job = j.data;
          renderAttention();
          notify("Aviso salvo — a equipe vê em destaque no Campo.", "success");
        } catch (err) {
          notify(err.message, "error");
        }
      }
    });

    $("btnEditJobAll").addEventListener("click", () => openSection("all"));
    $("btnEditServices").addEventListener("click", () => openSection("services"));
    $("btnEditServices2").addEventListener("click", () => openSection("services"));
    $("btnManageTeam").addEventListener("click", () => openSection("team"));
    $("btnDeleteJob").addEventListener("click", async () => {
      closeMenu();
      if (!confirm("Excluir este job? Ele será cancelado e sairá da agenda.")) return;
      try {
        await api(`/api/work-orders/${jobId}`, { method: "DELETE" });
        notify("Job excluído.", "success");
        location.href = "jobs.html";
      } catch (e) {
        notify(e.message, "error");
      }
    });

    const closeNotes = () => {
      $("jdNotesView").hidden = false;
      $("jdNotesEditor").hidden = true;
      $("jdNotesEdit").hidden = false;
    };
    $("jdNotesEdit").addEventListener("click", () => {
      $("jdNotesView").hidden = true;
      $("jdNotesEditor").hidden = false;
      $("jdNotesEdit").hidden = true;
      $("jobNotes").focus();
    });
    $("jdNotesCancel").addEventListener("click", () => {
      $("jobNotes").value = job.notes || "";
      closeNotes();
    });
    $("btnSaveNotes").addEventListener("click", async () => {
      try {
        const j = await api(`/api/work-orders/${jobId}`, { method: "PUT", body: JSON.stringify({ notes: $("jobNotes").value.trim() || null }) });
        job = j.data;
        renderNotes();
        closeNotes();
        notify("Notas salvas.", "success");
      } catch (e) {
        notify(e.message, "error");
      }
    });

    $("btnAddJobPhoto").addEventListener("click", () => $("jobPhotoInput").click());
    $("jobPhotoInput").addEventListener("change", (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      if (files.length) uploadPhotos(files);
    });
    $("btnGenerateReport").addEventListener("click", async () => {
      if (!media?.length) {
        notify("Adicione fotos antes de gerar o relatório.", "error");
        return;
      }
      try {
        notify("Gerando relatório…", "info");
        const j = await api(`/api/work-orders/${jobId}/reports/generate`, { method: "POST", body: JSON.stringify({ template_key: "site_visit" }) });
        reports = [j.data, ...reports.filter((r) => r.id !== j.data.id)];
        renderReports();
        notify("Rascunho do relatório pronto.", "success");
      } catch (e) {
        notify(e.message, "error");
      }
    });
    $("btnCreateProposal").addEventListener("click", () => createProposal(false).catch((e) => notify(e.message, "error")));
    $("btnCreateProposalAi").addEventListener("click", () => createProposal(true).catch((e) => notify(e.message, "error")));

    window.__crmJobModal.onSaved((data) => {
      if (!data) {
        location.href = "jobs.html";
        return;
      }
      if (data.id === jobId) {
        job = data;
        Promise.all([refreshBilling(), loadField()]).then(renderAll);
      }
    });
  }

  async function boot() {
    jobId = new URLSearchParams(location.search).get("id");
    if (!jobId) {
      location.href = "jobs.html";
      return;
    }
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
      orgSlug = s.organization?.slug || s.user?.organization?.slug || null;
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      const sn = $("sidebarUserName");
      if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
      const sr = $("sidebarUserRole");
      if (sr) sr.textContent = role || "";

      bind();
      await loadJob();
      setTab((location.hash || "").replace("#", "") || "geral", { silent: true });

      // Deep link from the Jobs list ("Faturar"): open the billing dialog straight away.
      if (new URLSearchParams(location.search).get("faturar") === "1" && canInvoice && billing?.billing?.remaining_to_invoice > 0.004) {
        window.JobBilling.openDialog({ jobId, billing: billing.billing, jobStatus: job.status });
      }
    } catch (err) {
      notify(err.message || "Falha ao carregar o job", "error");
      if (err.status === 404) setTimeout(() => (location.href = "jobs.html"), 1200);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
