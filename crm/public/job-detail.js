(function () {
  let canManage = false;
  let job = null;
  let jobId = null;
  let mediaList = [];
  let reports = [];
  let aiEnabled = false;
  let proposals = [];
  let marketing = null;
  let reviewReq = null;
  let orgSlug = null;
  let commsCtl = null;

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      scheduled: "Upcoming",
      in_progress: "In progress",
      completed: "Completed",
      canceled: "Canceled",
    };
    return map[status] || status || "—";
  }

  function clientLabel(wo) {
    return (
      wo.customer?.name ||
      wo.builder?.company ||
      wo.builder?.name ||
      wo.source_name ||
      "Client"
    );
  }

  function fmtDay(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function fmtWhen(start, end) {
    if (!start) return "—";
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const opts = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    const a = s.toLocaleString(undefined, opts);
    if (!e) return a;
    return `${a} – ${e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  function sourceLabel(wo) {
    const type = wo.source_type || "other";
    const labels = {
      particular: "Particular",
      builder: "Builder",
      contractor: "Contractor",
      loja: "Loja",
      internal: "Internal",
      other: "Other",
    };
    const nice = labels[type] || type;
    const name = wo.source_name;
    if (name) return `${nice} · ${name}`;
    return nice;
  }

  function render() {
    if (!job) return;
    const client = clientLabel(job);
    document.title = `Job for ${client} | ObraMate`;

    const badge = $("jobStatusBadge");
    badge.className = `job-status is-${job.status || "draft"}`;
    badge.textContent = statusLabel(job.status);

    $("jobDetailTitle").textContent = `Job for ${client}`;
    $("jobClientName").textContent = client;
    $("jobProperty").textContent = job.address || "No property address";

    const contact = $("jobClientContact");
    const bits = [];
    if (job.customer?.phone) {
      bits.push(`<a href="tel:${escapeHtml(job.customer.phone)}">${escapeHtml(job.customer.phone)}</a>`);
    }
    if (job.customer?.email) {
      bits.push(`<a href="mailto:${escapeHtml(job.customer.email)}">${escapeHtml(job.customer.email)}</a>`);
    }
    contact.innerHTML = bits.length ? bits.join("") : '<span style="color:#8a8074">Sem contacto</span>';

    $("jobMetaNumber").textContent = job.number != null ? String(job.number) : "—";
    if ($("jobMetaTitle")) $("jobMetaTitle").textContent = job.title || "—";
    $("jobMetaSource").textContent = sourceLabel(job);
    $("jobMetaStart").textContent = fmtDay(job.scheduled_start);
    $("jobMetaEnd").textContent = fmtDay(job.scheduled_end);
    $("jobMetaAssignee").textContent = job.assigned_user?.name || "—";

    const members = Array.isArray(job.members) ? job.members : [];
    const temps = Array.isArray(job.temp_workers) ? job.temp_workers : [];
    const memberNames = members.map((m) => m.name).filter(Boolean);
    $("jobMetaTeam").textContent = memberNames.length
      ? memberNames.join(", ")
      : temps.length
        ? `${temps.length} temporário(s)`
        : "—";

    const servicesBody = $("jobServicesBody");
    if (servicesBody) {
      const lines = Array.isArray(job.line_items) ? job.line_items : [];
      if (!lines.length) {
        servicesBody.innerHTML =
          '<p class="jobs-empty" style="padding:1rem 0">Sem serviços neste job. Use Editar serviços para adicionar.</p>';
      } else {
        const rows = lines
          .map((li) => {
            const unit = li.unit
              ? String(li.unit)
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase())
              : "";
            const qtyLabel = unit
              ? `${li.quantity_sqft ?? 0} ${unit}`
              : String(li.quantity_sqft ?? 0);
            return `<tr>
              <td>${escapeHtml(li.service_name || "—")}</td>
              <td style="text-align:right">${escapeHtml(qtyLabel)}</td>
              <td style="text-align:right">${escapeHtml(
                (Number(li.unit_price) || 0).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                }),
              )}</td>
              <td style="text-align:right">${escapeHtml(
                (Number(li.line_total) || 0).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                }),
              )}</td>
            </tr>`;
          })
          .join("");
        const total = (Number(job.services_total) || 0).toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
        });
        servicesBody.innerHTML = `<table class="job-visits-table">
          <thead><tr><th>Serviço</th><th style="text-align:right">Qtd</th><th style="text-align:right">Preço</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${escapeHtml(total)}</td></tr></tfoot>
        </table>`;
      }
    }

    const teamBody = $("jobTeamBody");
    if (teamBody) {
      const parts = [];
      if (job.assigned_user?.name) {
        parts.push(`<p><strong>Responsável:</strong> ${escapeHtml(job.assigned_user.name)}</p>`);
      }
      if (memberNames.length) {
        parts.push(
          `<p><strong>Equipe:</strong> ${memberNames.map(escapeHtml).join(", ")}</p>`,
        );
      }
      if (temps.length) {
        parts.push(
          `<div style="margin-top:0.65rem"><strong>Temporários</strong>
          <ul class="job-temp-detail-list" style="margin:0.35rem 0 0;padding:0;list-style:none;display:grid;gap:0.55rem">
          ${temps
            .map(
              (t) =>
                `<li data-temp-id="${escapeHtml(t.id)}" style="border:1px solid #e8e0d4;border-radius:10px;padding:0.65rem 0.75rem">
                  <div style="display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:space-between;align-items:center">
                    <div>
                      <strong>${escapeHtml(t.name)}</strong>
                      <div style="color:#8a8074;font-size:0.8rem">${escapeHtml([t.phone, t.email].filter(Boolean).join(" · ") || "Sem telefone")}</div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:0.35rem">
                      <button type="button" class="btn btn-primary btn-sm job-detail-temp-wa" data-id="${escapeHtml(t.id)}">WhatsApp</button>
                      <button type="button" class="btn btn-secondary btn-sm job-detail-temp-sms" data-id="${escapeHtml(t.id)}">SMS</button>
                      <button type="button" class="btn btn-secondary btn-sm job-detail-temp-copy" data-id="${escapeHtml(t.id)}">Copiar link</button>
                    </div>
                  </div>
                </li>`,
            )
            .join("")}
          </ul></div>`,
        );
      }
      if (!parts.length) {
        teamBody.innerHTML =
          '<p class="jobs-empty" style="padding:0.5rem 0">Sem equipe adicional. Use Gerir para adicionar.</p>';
      } else {
        teamBody.innerHTML = parts.join("");
      }
    }

    $("jobNotes").value = job.notes || "";
    const preview = (job.notes || "").trim();
    $("jobRailNotesPreview").textContent = preview || "Leave an internal note for yourself or a team member.";

    const visits = $("jobVisitsBody");
    if (job.scheduled_start) {
      visits.innerHTML = `<table class="job-visits-table">
        <thead>
          <tr>
            <th>Date and time</th>
            <th>Title</th>
            <th>Status</th>
            <th>Assigned</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(fmtWhen(job.scheduled_start, job.scheduled_end))}</td>
            <td>${escapeHtml(job.title || "Job visit")}</td>
            <td><span class="job-status is-${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span></td>
            <td>${escapeHtml(job.assigned_user?.name || "—")}</td>
          </tr>
        </tbody>
      </table>`;
    } else {
      visits.innerHTML = '<p class="jobs-empty" style="padding:1rem 0">Sem agendamento. Edite o job ou use o Schedule.</p>';
    }

    const schedHref = job.scheduled_start
      ? `schedule.html?focus=${encodeURIComponent(job.scheduled_start)}`
      : "schedule.html";
    $("btnOpenSchedule").href = schedHref;
    if ($("btnEditSchedule")) $("btnEditSchedule").href = schedHref;

    renderMedia();
    renderReports();
    renderProposals();
    renderMarketing();

    if (!canManage) {
      ["btnEditJob", "btnEditJobAll", "btnDeleteJob", "btnSaveNotes", "btnManageTeam", "btnEditServices", "btnEditDetails", "btnEditScheduleSection", "btnEditScheduleMeta", "btnEditScheduleMeta2", "btnEditTeamMeta", "btnCreateProposal", "btnCreateProposalAi"].forEach((id) => {
        const el = $(id);
        if (el) el.style.display = "none";
      });
      $("jobNotes").readOnly = true;
    }
  }

  function stageLabel(stage) {
    const map = { before: "Before", during: "During", after: "After" };
    return map[stage] || "";
  }

  function renderMedia() {
    const body = $("jobMediaBody");
    const portfolioLink = $("jobPortfolioLink");
    if (portfolioLink) {
      if (orgSlug) {
        portfolioLink.hidden = false;
        portfolioLink.href = `/public/portfolio/${encodeURIComponent(orgSlug)}?embed=1`;
      } else {
        portfolioLink.hidden = true;
      }
    }
    if (!body) return;
    if (!mediaList.length) {
      body.innerHTML =
        '<p class="jobs-empty" style="padding:1rem 0">Ainda sem fotos. Use “Adicionar foto” ou capture no Campo.</p>';
      return;
    }
    const last = mediaList[0];
    const ageDays = last?.created_at
      ? Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86_400_000)
      : null;
    const stale =
      ageDays != null && ageDays >= 3
        ? `<p class="jobs-empty" style="padding:0 0 0.75rem;color:#b45309;font-weight:600">⚠ Last photo ${ageDays} day(s) ago</p>`
        : "";
    body.innerHTML =
      stale +
      `<div class="job-media-grid">${mediaList
      .map((p) => {
        const st = stageLabel(p.stage);
        const cap = escapeHtml(p.caption || st || "Photo");
        const ann = p.annotations?.shapes?.length
          ? ` · ${p.annotations.shapes.length} mark(s)`
          : "";
        const port = p.in_portfolio ? " · portfolio" : "";
        const ocr =
          p.ocr?.serial_number || p.ocr?.label_text
            ? ` · OCR: ${escapeHtml(p.ocr.serial_number || p.ocr.label_text)}`
            : "";
        const toggle =
          canManage && !p.legacy
            ? `<button type="button" class="job-card__link job-media-portfolio" data-id="${escapeHtml(p.id)}" data-on="${p.in_portfolio ? "1" : "0"}">${
                p.in_portfolio ? "Remove from portfolio" : "Add to portfolio"
              }</button>`
            : "";
        return `<div class="job-media-thumb-wrap">
          <a class="job-media-thumb" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
          ${st ? `<span class="job-media-thumb__stg">${escapeHtml(st)}</span>` : ""}
          <img src="${escapeHtml(p.thumb_url || p.url)}" alt="${cap}" loading="lazy" />
          <span class="job-media-thumb__cap">${cap}${p.is_public ? " · public" : ""}${port}${ann}${ocr}</span>
        </a>${toggle}</div>`;
      })
      .join("")}</div>`;
  }

  async function togglePortfolio(mediaId, next) {
    const j = await api(`/api/work-orders/${jobId}/media/${mediaId}/portfolio`, {
      method: "PATCH",
      body: JSON.stringify({ in_portfolio: next }),
    });
    mediaList = mediaList.map((p) => (p.id === mediaId ? j.data : p));
    renderMedia();
    notify(next ? "Added to public portfolio." : "Removed from portfolio.", "success");
  }

  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const type = String(file.type || "").toLowerCase();
      if (type && !/^image\/(jpeg|jpg|png|webp|gif)$/.test(type)) {
        reject(new Error("unsupported-type"));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        reject(new Error("compress-timeout"));
      }, 10000);
      img.onload = () => {
        if (settled) return;
        try {
          let { width, height } = img;
          const edge = Math.max(width, height);
          const scale = edge > maxEdge ? maxEdge / edge : 1;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          settled = true;
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } catch (e) {
          settled = true;
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        reject(new Error("Falha ao processar imagem"));
      };
      img.src = url;
    });
  }

  async function fileToUploadDataUrl(file) {
    const type = String(file.type || "").toLowerCase();
    if (type.includes("heic") || type.includes("heif")) {
      throw new Error("Formato HEIC não suportado. Exporte/guarde como JPG ou PNG e tente de novo.");
    }
    if (type && !type.startsWith("image/")) {
      throw new Error("Selecione uma imagem JPG ou PNG");
    }
    try {
      const dataUrl = await compressImage(file, 1280, 0.7);
      if (dataUrl.length > 9_000_000) throw new Error("Foto demasiado grande");
      return dataUrl;
    } catch (err) {
      if (String(err?.message || "").includes("HEIC")) throw err;
      throw new Error(
        "Não foi possível processar esta imagem. Use JPG ou PNG (não HEIC).",
      );
    }
  }

  function getGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), 1500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          finish({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            gpsAccuracyM: pos.coords.accuracy,
          });
        },
        () => {
          clearTimeout(timer);
          finish(null);
        },
        { enableHighAccuracy: false, timeout: 1400, maximumAge: 120000 },
      );
    });
  }

  async function uploadJobPhoto(file) {
    if (!jobId) return;
    if (!canManage) {
      notify("Sem permissão para adicionar fotos.", "error");
      return;
    }
    const btn = $("btnAddJobPhoto");
    if (btn) btn.disabled = true;
    try {
      notify("A enviar foto…", "info");
      const [dataUrl, gps] = await Promise.all([fileToUploadDataUrl(file), getGps()]);
      const stage = ($("jobPhotoStage")?.value || "").trim() || null;
      const caption = ($("jobPhotoCaption")?.value || "").trim() || null;
      const clientId =
        window.crypto && crypto.randomUUID ? crypto.randomUUID() : `office-${Date.now()}`;
      const j = await api(`/api/work-orders/${jobId}/media`, {
        method: "POST",
        body: JSON.stringify({
          data_url: dataUrl,
          stage,
          caption,
          taken_at_device: new Date().toISOString(),
          lat: gps?.lat ?? null,
          lng: gps?.lng ?? null,
          gps_accuracy_m: gps?.gpsAccuracyM ?? null,
          address: job?.address || null,
          client_upload_id: clientId,
          device_label: "Office web",
          is_public: false,
        }),
      });
      mediaList = [j.data, ...mediaList.filter((p) => p.id !== j.data.id)];
      renderMedia();
      if ($("jobPhotoCaption")) $("jobPhotoCaption").value = "";
      notify("Foto adicionada.", "success");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderReports() {
    const body = $("jobReportBody");
    const genBtn = $("btnGenerateReport");
    if (genBtn) {
      genBtn.style.opacity = aiEnabled ? "1" : "0.45";
      genBtn.title = aiEnabled
        ? "Generate AI draft from photos"
        : "Configure OPENAI_API_KEY to enable AI reports";
    }
    if (!body) return;
    if (!reports.length) {
      body.innerHTML =
        '<p class="jobs-empty" style="padding:1rem 0">Generate a draft report from job photos.</p>';
      return;
    }
    body.innerHTML = reports
      .map((r) => {
        const pdf = `/api/work-orders/${encodeURIComponent(jobId)}/reports/${encodeURIComponent(r.id)}/pdf`;
        return `<article class="job-report-item">
          <div class="job-report-item__head">
            <strong>${escapeHtml(r.title || "Report")}</strong>
            <span class="job-report-item__meta">${escapeHtml(r.status)} · ${escapeHtml(r.source)}</span>
          </div>
          <p>${escapeHtml((r.summary || "").slice(0, 420))}</p>
          <div class="job-report-item__actions">
            <a class="job-card__link" href="${pdf}" target="_blank" rel="noopener">PDF</a>
            <button type="button" class="job-card__link job-report-publish" data-id="${escapeHtml(r.id)}" data-status="${r.status === "published" ? "draft" : "published"}">
              ${r.status === "published" ? "Unpublish" : "Publish"}
            </button>
            <button type="button" class="job-card__link job-report-public" data-id="${escapeHtml(r.id)}" data-public="${r.is_public ? "0" : "1"}">
              ${r.is_public ? "Hide from link" : "Share on link"}
            </button>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderProposals() {
    const body = $("jobProposalBody");
    if (!body) return;
    if (!proposals.length) {
      body.innerHTML =
        '<p class="jobs-empty" style="padding:1rem 0">Turn this job into a quote the customer can sign online.</p>';
      return;
    }
    body.innerHTML = proposals
      .map((q) => {
        const total = (Number(q.total) || 0).toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
        });
        return `<article class="job-report-item">
          <div class="job-report-item__head">
            <strong>#${escapeHtml(String(q.number))} · ${escapeHtml(q.title || "Proposal")}</strong>
            <span class="job-report-item__meta">${escapeHtml(q.status)} · ${escapeHtml(total)}</span>
          </div>
          <div class="job-report-item__actions">
            <a class="job-card__link" href="${escapeHtml(q.edit_url || `/quotes/${q.id}`)}" target="_blank" rel="noopener">Open quote</a>
            ${
              q.status === "draft" || q.status === "changes_requested"
                ? `<button type="button" class="job-card__link job-proposal-send" data-id="${escapeHtml(q.id)}">Send for signature</button>`
                : q.public_url
                  ? `<a class="job-card__link" href="${escapeHtml(q.public_url)}" target="_blank" rel="noopener">Public link</a>`
                  : `<button type="button" class="job-card__link job-proposal-send" data-id="${escapeHtml(q.id)}">Copy / resend link</button>`
            }
          </div>
        </article>`;
      })
      .join("");
  }

  function renderMarketing() {
    const body = $("jobMarketingBody");
    if (!body) return;
    if (!marketing) {
      body.innerHTML =
        '<p class="jobs-empty" style="padding:1rem 0">Export a caption + photos, or copy a Google review request.</p>';
      return;
    }
    const beforeN = marketing.before?.length || 0;
    const afterN = marketing.after?.length || 0;
    const reviewBit = reviewReq
      ? `<div class="job-report-item" style="border-top:1px solid var(--jobs-border);margin-top:0.75rem;padding-top:0.75rem">
          <strong>Review request</strong>
          <p style="white-space:pre-wrap;margin:0.4rem 0 0.6rem;font-size:0.85rem">${escapeHtml(reviewReq.message || "")}</p>
          <div class="job-report-item__actions">
            ${reviewReq.whatsapp_url ? `<a class="job-card__link" href="${escapeHtml(reviewReq.whatsapp_url)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
            ${reviewReq.sms_url ? `<a class="job-card__link" href="${escapeHtml(reviewReq.sms_url)}">SMS</a>` : ""}
            ${reviewReq.mailto_url ? `<a class="job-card__link" href="${escapeHtml(reviewReq.mailto_url)}">Email</a>` : ""}
            <button type="button" class="job-card__link" id="btnCopyReviewMsg">Copy message</button>
          </div>
          ${
            reviewReq.google_review_url
              ? ""
              : '<p class="jobs-empty" style="padding:0.5rem 0 0;font-size:0.78rem">Tip: set org featureFlags.google_review_url to include your Google link.</p>'
          }
        </div>`
      : "";
    body.innerHTML = `
      <p style="margin:0 0 0.5rem;font-size:0.875rem"><strong>${beforeN}</strong> before · <strong>${afterN}</strong> after</p>
      <textarea class="job-notes-area" id="jobSocialCaption" rows="4" readonly>${escapeHtml(marketing.social_caption || "")}</textarea>
      <div class="job-report-item__actions" style="margin-top:0.55rem">
        <button type="button" class="job-card__link" id="btnCopyCaption">Copy caption</button>
      </div>
      ${reviewBit}`;
  }

  async function loadProposalsMarketing() {
    const [q, port, rev] = await Promise.all([
      api(`/api/work-orders/${jobId}/quotes`),
      api(`/api/work-orders/${jobId}/portfolio-preview`),
      api(`/api/work-orders/${jobId}/review-request`),
    ]);
    proposals = q.data || [];
    marketing = port.data || null;
    reviewReq = rev.data || null;
    renderProposals();
    renderMarketing();
  }

  async function createProposal(withAi) {
    if (!canManage) return;
    notify(withAi ? "Creating AI proposal…" : "Creating proposal…", "info");
    const j = await api(`/api/work-orders/${jobId}/quotes`, {
      method: "POST",
      body: JSON.stringify({
        include_public_photos: true,
        suggest_with_ai: Boolean(withAi),
      }),
    });
    proposals = [j.data, ...proposals.filter((p) => p.id !== j.data.id)];
    renderProposals();
    notify("Draft proposal ready — review lines then send for signature.", "success");
  }

  async function sendProposal(quoteId) {
    const j = await api(`/api/work-orders/${jobId}/quotes/${quoteId}/send`, { method: "POST" });
    const url = j.data?.public_url || "";
    proposals = proposals.map((p) => (p.id === quoteId ? { ...p, ...j.data } : p));
    renderProposals();
    if (url && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      notify("Signature link copied.", "success");
    } else if (url) {
      window.prompt("Customer signature link:", url);
    } else {
      notify("Proposal marked as sent.", "success");
    }
    if (j.data?.whatsapp_url && confirm("Open WhatsApp to send the link?")) {
      window.open(j.data.whatsapp_url, "_blank", "noopener");
    }
  }

  async function loadMediaReports() {
    const [mediaRes, reportRes] = await Promise.all([
      api(`/api/work-orders/${jobId}/media`),
      api(`/api/work-orders/${jobId}/reports`),
    ]);
    mediaList = mediaRes.data || [];
    reports = reportRes.data || [];
    aiEnabled = Boolean(reportRes.meta?.ai_enabled);
    renderMedia();
    renderReports();
  }

  async function loadJob() {
    const j = await api(`/api/work-orders/${jobId}`);
    job = j.data;
    render();
    await Promise.all([
      loadMediaReports().catch(() => {}),
      loadProposalsMarketing().catch(() => {}),
      mountComms().catch(() => {}),
    ]);
  }

  async function mountComms() {
    const body = $("jobCommsBody");
    if (!body || !jobId || !window.JobChatComms) return;
    if (commsCtl) {
      try {
        commsCtl.destroy();
      } catch (_) {}
      commsCtl = null;
    }
    body.innerHTML = "";
    commsCtl = window.JobChatComms.mount(body, {
      jobId,
      workOrder: job,
      onError: (err) => notify(err.message || "Erro", "error"),
    });
  }

  async function generateReport() {
    if (!aiEnabled) {
      notify("AI reports need OPENAI_API_KEY on the server.", "error");
      return;
    }
    if (!mediaList.length) {
      notify("Add field photos before generating a report.", "error");
      return;
    }
    notify("Generating report…", "info");
    const j = await api(`/api/work-orders/${jobId}/reports/generate`, {
      method: "POST",
      body: JSON.stringify({ template_key: "site_visit" }),
    });
    reports = [j.data, ...reports.filter((r) => r.id !== j.data.id)];
    renderReports();
    notify("Draft report ready.", "success");
  }

  async function toggleReportStatus(reportId, status) {
    const j = await api(`/api/work-orders/${jobId}/reports/${reportId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    reports = reports.map((r) => (r.id === reportId ? j.data : r));
    renderReports();
    notify(status === "published" ? "Report published." : "Report set to draft.", "success");
  }

  async function toggleReportPublic(reportId, isPublic) {
    const j = await api(`/api/work-orders/${jobId}/reports/${reportId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_public: isPublic }),
    });
    reports = reports.map((r) => (r.id === reportId ? j.data : r));
    renderReports();
    notify(isPublic ? "Visible on temp-worker link." : "Hidden from public link.", "success");
  }

  async function saveNotes() {
    if (!canManage || !jobId) return;
    const notes = $("jobNotes").value.trim() || null;
    const j = await api(`/api/work-orders/${jobId}`, {
      method: "PUT",
      body: JSON.stringify({ notes }),
    });
    job = j.data;
    render();
    notify("Notas guardadas.", "success");
  }

  async function deleteJob() {
    if (!canManage || !jobId) return;
    if (!confirm("Excluir este job? Ele será cancelado e sairá da agenda.")) return;
    await api(`/api/work-orders/${jobId}`, { method: "DELETE" });
    notify("Job excluído.", "success");
    window.location.href = "jobs.html";
  }

  async function shareTempFromDetail(id, channel) {
    if (!canManage || !jobId) return;
    try {
      const j = await api(`/api/work-orders/${jobId}/temp-workers/${id}/share-link`, { method: "POST" });
      const url = j.data?.url || "";
      if (!url) throw new Error("Link não gerado");
      if (channel === "whatsapp" && j.data.whatsapp_url) {
        window.open(j.data.whatsapp_url, "_blank", "noopener");
        notify("Abra o WhatsApp e envie a mensagem.", "success");
        return;
      }
      if (channel === "sms" && j.data.sms_url) {
        window.location.href = j.data.sms_url;
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        notify("Link copiado.", "success");
      } else {
        window.prompt("Copie o link:", url);
      }
    } catch (e) {
      notify(e.message || "Erro ao enviar ticket", "error");
    }
  }

  async function boot() {
    jobId = new URLSearchParams(window.location.search).get("id");
    if (!jobId) {
      window.location.href = "jobs.html";
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
      orgSlug = s.organization?.slug || s.user?.organization?.slug || null;
      if (!canManage) {
        const addBtn = $("btnAddJobPhoto");
        const bar = $("jobMediaUploadBar");
        if (addBtn) addBtn.style.display = "none";
        if (bar) bar.style.display = "none";
      }
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";

      window.__crmJobModal.onSaved((data) => {
        if (!data) {
          window.location.href = "jobs.html";
          return;
        }
        if (data.id === jobId) {
          job = data;
          render();
        } else {
          loadJob().catch(() => {});
        }
      });

      function openSection(section) {
        window.__crmJobModal.openEdit(jobId, { section }).catch((e) => notify(e.message, "error"));
      }

      $("btnEditJob").addEventListener("click", () => openSection("details"));
      $("btnEditDetails")?.addEventListener("click", () => openSection("details"));
      $("btnEditJobAll")?.addEventListener("click", () => openSection("all"));
      $("btnManageTeam")?.addEventListener("click", () => openSection("team"));
      $("btnEditTeamMeta")?.addEventListener("click", () => openSection("team"));
      $("btnEditServices")?.addEventListener("click", () => openSection("services"));
      $("btnEditScheduleSection")?.addEventListener("click", () => openSection("schedule"));
      $("btnEditScheduleMeta")?.addEventListener("click", () => openSection("schedule"));
      $("btnEditScheduleMeta2")?.addEventListener("click", () => openSection("schedule"));
      $("jobTeamBody")?.addEventListener("click", (e) => {
        const wa = e.target.closest(".job-detail-temp-wa");
        if (wa) {
          shareTempFromDetail(wa.getAttribute("data-id"), "whatsapp");
          return;
        }
        const sms = e.target.closest(".job-detail-temp-sms");
        if (sms) {
          shareTempFromDetail(sms.getAttribute("data-id"), "sms");
          return;
        }
        const copy = e.target.closest(".job-detail-temp-copy");
        if (copy) shareTempFromDetail(copy.getAttribute("data-id"), "copy");
      });
      $("btnDeleteJob").addEventListener("click", () => {
        deleteJob().catch((e) => notify(e.message, "error"));
      });
      $("btnSaveNotes").addEventListener("click", () => {
        saveNotes().catch((e) => notify(e.message, "error"));
      });
      $("btnRefreshMedia")?.addEventListener("click", () => {
        loadMediaReports().catch((e) => notify(e.message, "error"));
      });
      $("btnAddJobPhoto")?.addEventListener("click", () => {
        if (!canManage) {
          notify("Sem permissão para adicionar fotos.", "error");
          return;
        }
        $("jobPhotoInput")?.click();
      });
      $("jobPhotoInput")?.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        uploadJobPhoto(file).catch((err) => notify(err.message || "Falha no upload", "error"));
      });
      $("jobMediaBody")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".job-media-portfolio");
        if (!btn) return;
        e.preventDefault();
        const id = btn.getAttribute("data-id");
        const next = btn.getAttribute("data-on") !== "1";
        togglePortfolio(id, next).catch((err) => notify(err.message, "error"));
      });
      $("btnGenerateReport")?.addEventListener("click", () => {
        generateReport().catch((e) => notify(e.message, "error"));
      });
      $("btnCreateProposal")?.addEventListener("click", () => {
        createProposal(false).catch((e) => notify(e.message, "error"));
      });
      $("btnCreateProposalAi")?.addEventListener("click", () => {
        createProposal(true).catch((e) => notify(e.message, "error"));
      });
      $("btnRefreshMarketing")?.addEventListener("click", () => {
        loadProposalsMarketing().catch((e) => notify(e.message, "error"));
      });
      $("jobProposalBody")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".job-proposal-send");
        if (!btn) return;
        sendProposal(btn.getAttribute("data-id")).catch((err) => notify(err.message, "error"));
      });
      $("jobMarketingBody")?.addEventListener("click", async (e) => {
        if (e.target.closest("#btnCopyCaption")) {
          const text = $("jobSocialCaption")?.value || marketing?.social_caption || "";
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            notify("Caption copied.", "success");
          } else window.prompt("Caption:", text);
          return;
        }
        if (e.target.closest("#btnCopyReviewMsg")) {
          const text = reviewReq?.message || "";
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            notify("Review message copied.", "success");
          } else window.prompt("Message:", text);
        }
      });
      $("jobReportBody")?.addEventListener("click", (e) => {
        const pub = e.target.closest(".job-report-public");
        if (pub) {
          toggleReportPublic(pub.getAttribute("data-id"), pub.getAttribute("data-public") === "1").catch(
            (err) => notify(err.message, "error"),
          );
          return;
        }
        const btn = e.target.closest(".job-report-publish");
        if (!btn) return;
        toggleReportStatus(btn.getAttribute("data-id"), btn.getAttribute("data-status")).catch(
          (err) => notify(err.message, "error"),
        );
      });
      $("jobNotes").addEventListener("input", () => {
        const preview = $("jobNotes").value.trim();
        $("jobRailNotesPreview").textContent =
          preview || "Leave an internal note for yourself or a team member.";
      });

      await loadJob();
    } catch (err) {
      notify(err.message || "Falha ao carregar job", "error");
      window.location.href = "jobs.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
