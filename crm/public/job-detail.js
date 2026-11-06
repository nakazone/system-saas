/**
 * Job page (desktop + tablet). Phones use the job-detail-mobile.js overlay.
 *
 * Header comes from job-header.js (shared with the Jobs side panel), then tabs:
 * Visão geral · Fotos · Campo · Stain · Conversa. Tab data loads on demand.
 */
(function () {
  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const TABS = ["geral", "fotos", "campo", "stain", "conversa", "builder"];

  let jobId = null;
  let job = null;
  let canManage = false;
  let canBill = false;
  let canInvoice = false;
  let sessionPerms = [];
  let sessionRole = "";
  let orgSlug = null;
  let billing = null; // { billing, data: invoices }
  let media = null;
  let mediaMeta = null;
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
    else if (window.crmToast?.show) window.crmToast.show(msg, { type: type || "info" });
    else console.warn(msg);
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
  function clientName() {
    return job.customer?.name || job.builder?.company || job.builder?.name || job.source_name || "Sem cliente";
  }
  // ---------------------------------------------------------------- header
  function headerCtx() {
    return {
      mode: "page",
      canManage,
      canBill,
      canInvoice,
      can: (perm) => sessionRole === "admin" || sessionPerms.includes(perm),
      billing: billing?.billing || null,
      invoices: billing?.data || null,
      field,
      photos: media?.length || 0,
      partnerPortal: hasPartnerPortal(),
    };
  }
  function renderHeader() {
    document.title = `${job.title || clientName()} | ObraMate`;
    $("jdHeader").innerHTML = window.JobHeader.html(job, headerCtx());
  }
  async function openInvoiceDialog() {
    if (!window.JobBilling) return;
    // Refresh first so the dialog offers the real balance.
    try {
      const j = await window.JobBilling.load(jobId);
      billing = { billing: j.billing, data: j.data || [] };
    } catch (_) {}
    return window.JobBilling.openDialog({ jobId, billing: billing?.billing, jobStatus: job.status });
  }
  async function deleteJob() {
    const okDel = await window.crmConfirm({
      title: "Excluir este job?",
      text: "Ele será cancelado e sairá da agenda.",
      ok: "Excluir job",
      danger: true,
    });
    if (!okDel) return;
    await api(`/api/work-orders/${jobId}`, { method: "DELETE" });
    notify("Job excluído.", "success");
    location.href = "jobs.html";
  }
  async function runHeaderAct(act) {
    if (act === "invoice") return openInvoiceDialog();
    if (act === "edit") return openSection("all");
    if (act === "services") return openSection("services");
    if (act === "schedule") return openSection("schedule");
    if (act === "team") return openSection("team");
    if (act === "start") return setStatus("in_progress", "Job iniciado.");
    if (act === "complete") return finishJob();
    if (act === "reopen") return setStatus("draft", "Job reaberto.");
    if (act === "delete") return deleteJob();
    if (act === "chat") return window.JobChatComms.openJobChannel(jobId);
    if (act === "lixa") {
      if (!window.__crmJobModal) throw new Error("Editor de job indisponível.");
      return window.__crmJobModal.openScheduleLixa(job);
    }
  }
  async function setStatus(status, msg) {
    const j = await api(`/api/work-orders/${jobId}`, { method: "PUT", body: JSON.stringify({ status }) });
    job = j.data;
    notify(msg || "Status atualizado.", "success");
    await refreshBilling();
    renderAll();
  }

  async function finishJob() {
    const J = window.JobsInfo;
    const nxt = J?.nextFinish?.(job);
    const label = job?.title || clientName();
    const ok = await window.crmConfirm.completeJob(label, nxt);
    if (!ok) return;
    return setStatus("completed", nxt?.toast || "Job concluído.");
  }
  async function applyStep(idx) {
    if (!canManage || !job || job.status === "canceled" || Number.isNaN(idx)) return;
    const J = window.JobsInfo;
    const status = J?.statusForStep?.(idx);
    if (status) {
      if (status === "completed" || (status === "in_progress" && job.status === "in_progress" && J?.nextFinish?.(job))) {
        await finishJob();
        return;
      }
      if (J.atStatus(job, status)) return;
      await setStatus(status, J.STATUS_STEP_MSG?.[status] || "Status atualizado.");
      return;
    }
    if (idx === 3 && canBill && window.JobBilling) {
      window.JobBilling.openDialog({ jobId, billing: billing?.billing, jobStatus: job.status });
      return;
    }
    if (idx === 4) notify("Registre o pagamento nas faturas do job.", "info");
  }

  // ---------------------------------------------------------------- overview
  function renderServices() {
    const lines = job.line_items || [];
    $("jdSvcCount").textContent = lines.length || "";
    $("jdServicesFull").innerHTML = lines.length
      ? `<table class="jd-table">
      <thead><tr><th>Serviço</th><th class="r">Qtd</th><th class="r">Preço</th><th class="r">Total</th></tr></thead>
      <tbody>${lines
        .map((l) => {
          const note = String(l.notes || "").trim();
          return `<tr><td>${esc(l.service_name)}${note ? `<small class="jd-svc-note">${esc(note)}</small>` : ""}</td><td class="r">${esc(qty(l.quantity_sqft))} ${esc(unitLabel(l.unit))}</td><td class="r jd-muted">${money(l.unit_price)}</td><td class="r">${money(l.line_total)}</td></tr>`;
        })
        .join("")}</tbody>
      <tfoot><tr><td colspan="3">Total do job</td><td class="r">${money(job.services_total)}</td></tr></tfoot>
    </table>`
      : `<p class="jd-empty">Nenhum serviço ainda.${canManage ? " Adicione os serviços da Tabela de Valores: eles viram a fatura do job." : ""}</p>`;
  }

  function renderNotes() {
    const { code, text } = window.JobHeader.noteParts(job.notes);
    const bodyHtml = typeof window.sfFormatRichTextHtml === "function" ? window.sfFormatRichTextHtml(text) : esc(text);
    $("jdNotesView").innerHTML = text
      ? `<div class="jd-note"><p class="crm-rich-html">${bodyHtml}</p></div>`
      : `<p class="jd-empty">${code ? "Só o código da caixa, que já está no cabeçalho." : `Sem notas.${canManage ? " Use para acesso, código do portão, cuidados com a obra." : ""}`}</p>`;
    $("jobNotes").value = job.notes || "";
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
      <button type="button" class="jd-btn" data-goto="fotos" data-scroll="jobReportCard">Relatório com fotos</button>`;
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
    if (!billingCtl) {
      billingCtl = window.JobBilling.mountCard($("jobBillingBody"), {
        jobId,
        jobStatus: job.status,
        canManage: canInvoice,
        // Invoice issued or paid from the card: the header follows, without touching the card again.
        onChange: () => {
          refreshBilling().then(renderHeader);
        },
      });
    } else {
      billingCtl.setJobStatus(job.status);
      billingCtl.refresh().catch(() => {});
    }
  }

  function isB2B() {
    const s = String(job.source_type || "").toLowerCase();
    const customerType = String(job.customer_type || "").toLowerCase();
    return s === "builder" || s === "contractor" || s === "loja" || Boolean(job.builder_id) || ["builder", "contractor", "loja"].includes(customerType);
  }
  function hasPartnerPortal() {
    const customerType = String(job.customer_type || "").toLowerCase();
    const source = String(job.source_type || "").toLowerCase();
    return Boolean(job.builder_id) || ["builder", "contractor"].includes(customerType) || source === "builder" || source === "contractor";
  }
  async function loadProposals() {
    const card = $("jobProposalCard");
    try {
      const j = await api(`/api/work-orders/${jobId}/quotes`);
      proposals = j.data || [];
    } catch (_) {
      proposals = [];
    }
    // Fixed-price jobs (Builder / Loja) are billed from the table — no quote.
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
    } else if (url) await window.crmShare({ url, title: "Link de assinatura", copiedMessage: "Link de assinatura copiado." });
    await loadProposals();
  }

  // ---------------------------------------------------------------- fotos
  async function loadMedia() {
    const [m, r] = await Promise.all([
      api(`/api/work-orders/${jobId}/media`),
      api(`/api/work-orders/${jobId}/reports`).catch(() => ({ data: [], meta: {} })),
    ]);
    media = m.data || [];
    mediaMeta = m.meta || null;
    reports = r.data || [];
    aiEnabled = Boolean(r.meta?.ai_enabled);
    $("jdTabFotos").textContent = media.length ? String(media.length) : "";
  }

  function mapsCoordsUrl(lat, lng) {
    if (lat == null || lng == null) return "";
    return `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  function fmtDistance(m) {
    if (m == null || !Number.isFinite(Number(m))) return "";
    const n = Number(m);
    if (n < 1000) return `${Math.round(n)} m`;
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km`;
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
    const withGps = media.filter((p) => p.location_available).length;
    const far = media.filter((p) => p.far_from_job).length;
    const jobGeo = mediaMeta?.job_geo;
    const gpsSummary =
      media.length
        ? `<p class="jd-gps-summary">${withGps ? `${withGps} com GPS` : "Nenhuma foto com GPS"}${
            jobGeo ? ` · local do job definido` : ""
          }${far ? ` · <span class="jd-gps-far">${far} longe do endereço (&gt;500&nbsp;m)</span>` : ""}</p>`
        : "";
    $("jobMediaBody").innerHTML = list.length
      ? `${stale}${gpsSummary}<div class="jd-photos">${list
          .map((p) => {
            const st = STAGE[p.stage] || "";
            const hasGps = p.location_available && p.lat != null && p.lng != null;
            const maps = hasGps ? mapsCoordsUrl(p.lat, p.lng) : "";
            const dist = fmtDistance(p.distance_m);
            const jobAddr = (job && job.address) || "";
            const when = p.taken_at_device || p.created_at
              ? new Date(p.taken_at_device || p.created_at).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";
            const gpsTitle = hasGps
              ? [when, jobAddr, p.address, `${p.lat}, ${p.lng}`, dist ? `${dist} do job` : ""]
                  .filter(Boolean)
                  .join(" · ")
              : "";
            const locBits = [];
            if (hasGps) {
              locBits.push(
                `<a class="jd-photo__gps${p.far_from_job ? " is-far" : ""}" href="${esc(maps)}" target="_blank" rel="noopener" title="${esc(gpsTitle)}">${p.far_from_job ? "Longe" : dist ? `${dist} do job` : "GPS"}</a>`,
              );
            } else {
              locBits.push(`<span class="jd-photo__gps is-off">Sem GPS</span>`);
            }
            if (when) locBits.push(`<span class="jd-photo__when" title="${esc(gpsTitle || when)}">${esc(when)}</span>`);
            if (p.address || jobAddr) locBits.push(`<span class="jd-photo__addr" title="${esc(p.address || jobAddr)}">${esc(p.address || jobAddr)}</span>`);
            if (dist && !p.far_from_job) locBits.push(`<span class="jd-photo__dist">${esc(dist)} do job</span>`);
            else if (p.far_from_job && dist) locBits.push(`<span class="jd-photo__dist is-far">${esc(dist)} do job</span>`);
            const portBtn =
              canManage && !p.legacy
                ? `<button type="button" class="jd-photo__port" data-port="${esc(p.id)}" data-on="${p.in_portfolio ? "1" : "0"}" title="${p.in_portfolio ? "Tirar do portfólio" : "Pôr no portfólio"}" aria-label="${p.in_portfolio ? "Tirar do portfólio" : "Pôr no portfólio"}">${p.in_portfolio ? "★" : "☆"}</button>`
                : "";
            const partnerShareBtn =
              canManage && !p.legacy && hasPartnerPortal()
                ? `<button type="button" class="jd-mini" data-partner-share="${esc(p.id)}" data-on="${p.shared_with_partners ? "1" : "0"}" aria-pressed="${p.shared_with_partners ? "true" : "false"}">${p.shared_with_partners ? "Remover do portal do parceiro" : "Compartilhar com parceiro"}</button>`
                : "";
            return `<figure class="jd-photo">
              <a href="${esc(p.url)}" target="_blank" rel="noopener" data-view-photo="${esc(p.id)}"><img src="${esc(p.thumb_url || p.url)}" alt="${esc(p.caption || st || "Foto")}" loading="lazy" /></a>
              ${st ? `<span class="jd-photo__stage">${esc(st)}</span>` : ""}
              ${portBtn}
              <figcaption><span>${esc(p.caption || "")}</span></figcaption>
              ${partnerShareBtn ? `<div class="jd-photo__share">${partnerShareBtn}</div>` : ""}
              <div class="jd-photo__loc">${locBits.join("")}</div>
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
            (r) => `<li><div><b>${esc(r.title || "Relatório")}</b><small>${esc(r.status === "published" ? "Publicado" : "Rascunho")}${r.is_public ? " · no link do cliente" : ""}${r.shared_with_partners ? " · no portal do parceiro" : ""}</small><p>${esc((r.summary || "").slice(0, 280))}</p></div>
            <span class="jd-actions"><a class="jd-mini" href="/api/work-orders/${encodeURIComponent(jobId)}/reports/${encodeURIComponent(r.id)}/pdf" target="_blank" rel="noopener">PDF</a>
            ${
              canManage
                ? `<button type="button" class="jd-mini" data-report="${esc(r.id)}" data-status="${r.status === "published" ? "draft" : "published"}">${r.status === "published" ? "Despublicar" : "Publicar"}</button>
            <button type="button" class="jd-mini" data-report-pub="${esc(r.id)}" data-public="${r.is_public ? "0" : "1"}">${r.is_public ? "Tirar do link" : "Mostrar no link"}</button>
            ${hasPartnerPortal() ? `<button type="button" class="jd-mini" data-report-partner="${esc(r.id)}" data-on="${r.shared_with_partners ? "1" : "0"}" aria-pressed="${r.shared_with_partners ? "true" : "false"}" ${r.status !== "published" ? "disabled title=\"Publique o relatório antes de compartilhar\"" : ""}>${r.shared_with_partners ? "Remover do portal do parceiro" : "Compartilhar com parceiro"}</button>` : ""}`
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
    const checklistOn = field?.checklist_enabled !== false;
    $("jdTabCampo").textContent = checklistOn && c && c.customized ? `${c.done}/${c.total}` : "";
  }
  /** Temporary workers get their ticket link here, next to the hours they log. */
  function tempWorkersCard() {
    const temps = job.temp_workers || [];
    if (!temps.length) return "";
    return `<div class="jd-card">
      <div class="jd-ch"><h2>Temporários</h2><span class="jd-ch__n">${temps.length}</span></div>
      <ul class="jd-people">${temps
        .map(
          (t) => `<li><span class="jd-av jd-av--temp">${esc(initials(t.name))}</span><span><b>${esc(t.name)}</b>${t.phone ? `<small>${esc(t.phone)}</small>` : ""}</span>
          ${canManage ? `<span class="jd-people__act"><button type="button" class="jd-mini" data-temp="${esc(t.id)}" data-ch="whatsapp">WhatsApp</button><button type="button" class="jd-mini" data-temp="${esc(t.id)}" data-ch="copy">Link</button></span>` : ""}</li>`,
        )
        .join("")}</ul>
    </div>`;
  }
  function renderField() {
    const box = $("jdField");
    if (!field) {
      box.innerHTML = '<div class="jd-card"><p class="jd-empty">Não foi possível carregar o campo.</p></div>';
      return;
    }
    const c = field.checklist;
    const checklistOn = field.checklist_enabled !== false;
    const h = field.hours;
    const att = job.campo_attention || "";
    const checklistCard = checklistOn
      ? `<div class="jd-card">
          <div class="jd-ch"><h2>Checklist</h2>${c.customized ? `<span class="jd-ch__n">${c.done}/${c.total}</span>` : ""}${
            canManage ? `<button type="button" class="jd-link" data-edit-campo>${c.customized ? "Editar" : "Criar checklist"}</button>` : ""
          }</div>
          ${
            !c.customized
              ? `<p class="jd-empty">Nenhum checklist definido para este job.${canManage ? " Crie a lista do que a equipe precisa fazer — ela aparece no Campo e no ticket do temporário." : ""}</p>`
              : `<div class="jd-bar jd-bar--thin"><i class="p" style="width:${c.total ? ((c.done / c.total) * 100).toFixed(0) : 0}%"></i></div>
          <ul class="jd-check">${c.items
            .map(
              (i) => `<li class="${i.done ? "is-done" : ""}"><i aria-hidden="true">${i.done ? "✓" : ""}</i><span>${esc(i.text)}${
                i.photo_required ? ` <em class="jd-tag">${i.photos ? `${i.photos} foto${i.photos > 1 ? "s" : ""}` : "foto obrigatória"}</em>` : ""
              }${i.done && i.done_by ? `<small>${esc(i.done_by)}</small>` : ""}${i.note ? `<small>${esc(i.note)}</small>` : ""}</span></li>`,
            )
            .join("")}</ul>`
          }
        </div>`
      : "";
    box.innerHTML = `<div class="jd-grid">
      <div class="jd-col">
        ${checklistCard}
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
        ${tempWorkersCard()}
      </aside>
    </div>`;
  }

  // ---------------------------------------------------------------- tabs
  function setTab(next, opts) {
    // Old links to "Serviços e faturas" land on the overview, where that content now lives.
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
    if (tab === "geral") {
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
    if (tab === "stain" && window.JobStain) {
      window.JobStain.mount($("jdStain"), { jobId, notify });
    }
    if (tab === "builder" && window.JobBuilderChannel) {
      window.JobBuilderChannel.mount($("jdBuilderChannel"), { jobId, canManage: canManage, notify });
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
      const j = await window.JobBilling.load(jobId);
      billing = { billing: j.billing, data: j.data || [] };
    } catch (_) {
      billing = null;
    }
  }

  function renderAll() {
    renderHeader();
    renderServices();
    renderNotes();
    renderAfter();
    if (tab === "geral") renderBillingTab();
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
      } else await window.crmShare({ url: d.url, title: "Link do job" });
    } catch (e) {
      notify(e.message || "Erro ao gerar o link", "error");
    }
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

    window.JobHeader.bind($("jdHeader"), {
      act: (name) => runHeaderAct(name).catch((err) => notify(err.message || "Erro", "error")),
      step: (i) => applyStep(i).catch((err) => notify(err.message || "Erro", "error")),
      status: (k) => {
        if (k === job.status) return;
        setStatus(k).catch((err) => notify(err.message, "error"));
      },
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
        } else await window.crmPrompt({ title: "Copie o texto", type: "textarea", value: text, rows: 6, ok: "Fechar", cancel: "Voltar" });
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
      const view = t.closest("[data-view-photo]");
      if (view && window.CamViewer && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const list = (media || []).filter((m) => mediaFilter === "all" || (mediaFilter === "none" ? !m.stage : m.stage === mediaFilter));
        const idx = Math.max(0, list.findIndex((m) => String(m.id) === view.getAttribute("data-view-photo")));
        window.CamViewer.open({
          photos: list.map((m) => ({
            id: m.legacy ? null : m.id, url: m.url, thumb_url: m.thumb_url, stage: m.stage, created_at: m.created_at, taken_at_device: m.taken_at_device,
            author: m.author_name, device: m.device_label, caption: m.caption, uploaded_by_name: m.uploaded_by_name, taken_by_name: m.taken_by_name, taken_at_source: m.taken_at_source, location_source: m.location_source, camera_model: m.camera_model, annotations: m.annotations, sticker_ids: m.sticker_ids || [], address: m.address || job.address, lat: m.lat, lng: m.lng,
            location_available: m.location_available, distance_m: m.distance_m, far_from_job: m.far_from_job, in_portfolio: m.in_portfolio,
            job: { number: job.number, title: job.title || clientName(), client: clientName() },
          })),
          index: idx,
          // Managers edit here too: note, stage, markup and stickers, saved to the photo itself.
          ...(canManage && window.CamViewer.jobEditing
            ? window.CamViewer.jobEditing(jobId, (row) => {
                media = media.map((x) => (x.id === row.id ? { ...x, ...row } : x));
                renderPhotos();
              })
            : {}),
          canPortfolio: canManage,
          onPortfolio: async (photo, next) => {
            const j = await api(`/api/work-orders/${jobId}/media/${photo.id}/portfolio`, { method: "PATCH", body: JSON.stringify({ in_portfolio: next }) });
            media = media.map((x) => (x.id === j.data.id ? j.data : x));
            renderPhotos();
            notify(next ? "Foto no portfólio público." : "Foto tirada do portfólio.", "success");
            return j.data;
          },
        });
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
      const partnerShare = t.closest("[data-partner-share]");
      if (partnerShare) {
        const next = partnerShare.getAttribute("data-on") !== "1";
        const originalLabel = partnerShare.textContent;
        partnerShare.disabled = true;
        partnerShare.textContent = "Salvando…";
        try {
          const j = await api(`/api/work-orders/${jobId}/media/${partnerShare.getAttribute("data-partner-share")}/partner-share`, {
            method: "PATCH",
            body: JSON.stringify({ shared_with_partners: next }),
          });
          media = media.map((p) => (p.id === j.data.id ? j.data : p));
          renderPhotos();
          notify(next ? "Arquivo compartilhado com o parceiro." : "Arquivo removido do portal do parceiro.", "success");
        } catch (err) {
          notify(err.message, "error");
        } finally {
          if (partnerShare.isConnected) {
            partnerShare.disabled = false;
            partnerShare.textContent = originalLabel;
          }
        }
        return;
      }
      const deliveryShare = t.closest("[data-delivery-share]");
      if (deliveryShare) {
        const next = deliveryShare.getAttribute("data-on") !== "1";
        const originalLabel = deliveryShare.textContent;
        deliveryShare.disabled = true;
        deliveryShare.textContent = "Salvando…";
        try {
          await api(`/api/work-orders/${jobId}/delivery-attachment/share-with-partner`, {
            method: "PATCH",
            body: JSON.stringify({ shared_with_partners: next }),
          });
          job.delivery_attachment.shared_with_partners = next;
          renderHeader();
          notify(next ? "Arquivo compartilhado com o parceiro." : "Arquivo removido do portal do parceiro.", "success");
        } catch (err) {
          notify(err.message, "error");
        } finally {
          if (deliveryShare.isConnected) {
            deliveryShare.disabled = false;
            deliveryShare.textContent = originalLabel;
          }
        }
        return;
      }
      const rep = t.closest("[data-report]");
      const repPub = t.closest("[data-report-pub]");
      const repShare = t.closest("[data-report-partner]");
      if (rep || repPub || repShare) {
        const id = rep ? rep.getAttribute("data-report") : repPub ? repPub.getAttribute("data-report-pub") : repShare.getAttribute("data-report-partner");
        const body = rep
          ? { status: rep.getAttribute("data-status") }
          : repPub
            ? { is_public: repPub.getAttribute("data-public") === "1" }
            : { shared_with_partners: repShare.getAttribute("data-on") !== "1" };
        const url = repShare
          ? `/api/work-orders/${jobId}/reports/${id}/partner-share`
          : `/api/work-orders/${jobId}/reports/${id}`;
        if (repShare) {
          repShare.disabled = true;
          repShare.textContent = "Salvando…";
        }
        try {
          const j = await api(url, { method: "PATCH", body: JSON.stringify(body) });
          reports = reports.map((r) => (r.id === j.data.id ? j.data : r));
          renderReports();
          if (repShare) notify(body.shared_with_partners ? "Relatório compartilhado com o parceiro." : "Relatório removido do portal do parceiro.", "success");
        } catch (err) {
          notify(err.message, "error");
        } finally {
          if (repShare?.isConnected) {
            repShare.disabled = false;
            repShare.textContent = repShare.getAttribute("data-on") === "1" ? "Remover do portal do parceiro" : "Compartilhar com parceiro";
          }
        }
        return;
      }
      const sendQ = t.closest("[data-send-quote]");
      if (sendQ) {
        sendProposal(sendQ.getAttribute("data-send-quote")).catch((err) => notify(err.message, "error"));
        return;
      }
      if (t.closest("[data-edit-campo]")) {
        openSection("campo");
        return;
      }
      if (t.closest("#jdAttentionSave")) {
        try {
          const j = await api(`/api/work-orders/${jobId}`, {
            method: "PUT",
            body: JSON.stringify({ campo_attention: $("jdAttention").value.trim() || null }),
          });
          job = j.data;
          renderHeader();
          notify("Aviso salvo — a equipe vê em destaque no Campo.", "success");
        } catch (err) {
          notify(err.message, "error");
        }
      }
    });

    $("btnEditServices").addEventListener("click", () => openSection("services"));

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
    // Calendar may pass `${id}:sand` for sector=both Sand dates — strip before API calls.
    jobId = String(new URLSearchParams(location.search).get("id") || "")
      .replace(/:(sand|installation|main)$/i, "")
      .trim();
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
      sessionPerms = perms;
      sessionRole = role;
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      const sn = $("sidebarUserName");
      if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
      const sr = $("sidebarUserRole");
      if (sr) sr.textContent = role || "";

      bind();
      await loadJob();
      // jobs a builder sent: the channel with the builder (messages + photos they see)
      const bTab = document.querySelector('#jdTabs [data-tab="builder"]');
      if (bTab) bTab.hidden = !hasPartnerPortal();
      if (hasPartnerPortal() && window.JobBuilderChannel) window.JobBuilderChannel.count(jobId);
      if (window.JobStain) window.JobStain.summary(jobId);
      const want = (location.hash || "").replace("#", "");
      setTab(want === "builder" && !hasPartnerPortal() ? "geral" : want || "geral", { silent: true });

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
