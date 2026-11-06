/**
 * ObraCam inside a job: latest photos, what's missing, and the common actions.
 * Shared by the Jobs side panel, the job page and the phone screen.
 *
 * window.JobCamBlock = { mount(el, opts), uploadFiles(job, files, opts) }
 *
 * mount opts: { job, canAdd, canManage, onViewAll(), onAdd() }
 * After photos or a report change, the "jobcam:changed" window event ({ detail: { jobId } })
 * lets each screen refresh itself.
 */
(function () {
  if (window.JobCamBlock) return;

  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const THUMBS = 4;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else if (window.crmToast?.[type || "info"]) window.crmToast[type || "info"](msg);
  }
  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }
  function changed(jobId) {
    window.dispatchEvent(new CustomEvent("jobcam:changed", { detail: { jobId } }));
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  /** The job's phase already says which stage a new photo belongs to; it can be changed in the viewer. */
  function stageForJob(job) {
    if (job.status === "completed") return "after";
    if (job.status === "in_progress") return "during";
    return "before";
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

  /**
   * Sends one photo at a time so a bad file never loses the good ones.
   * opts: { stage, onProgress(done, total) } → { added: [rows], failed: [messages] }
   */
  async function uploadFiles(job, files, opts) {
    const o = opts || {};
    const added = [];
    const failed = [];
    let i = 0;
    for (const file of files) {
      i += 1;
      o.onProgress?.(i, files.length);
      const type = String(file.type || "").toLowerCase();
      if (type.includes("heic") || type.includes("heif")) {
        failed.push(`${file.name || "Foto"}: HEIC não é suportado, exporte como JPG.`);
        continue;
      }
      try {
        const dataUrl = await compressImage(file, 1600, 0.75);
        const j = await api(`/api/work-orders/${encodeURIComponent(job.id)}/media`, {
          method: "POST",
          body: JSON.stringify({
            data_url: dataUrl,
            stage: o.stage === undefined ? stageForJob(job) : o.stage,
            taken_at_device: new Date(file.lastModified || Date.now()).toISOString(),
            address: job.address || null,
            client_upload_id: window.crypto?.randomUUID ? crypto.randomUUID() : `office-${Date.now()}-${i}`,
            device_label: "Office web",
            is_public: false,
          }),
        });
        added.push(j.data);
      } catch (e) {
        failed.push(`${file.name || "Foto"}: ${e.message || "falha no envio"}`);
      }
    }
    if (added.length) changed(job.id);
    return { added, failed };
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
    const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (days <= 0) return `hoje, ${time}`;
    if (days === 1) return `ontem, ${time}`;
    return `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(/\.$/, "")}, ${time}`;
  }

  /** A real gap the office can act on: nothing invented, and it clears when the photo arrives. */
  function pendingNote(job, media, counts) {
    if (!media.length) return "";
    if (job.status === "completed" && !counts.after) return "Falta foto de depois do job.";
    if (job.status === "in_progress") {
      const days = Math.floor((Date.now() - new Date(media[0].created_at).getTime()) / 86400000);
      if (days >= 3) return `Sem foto nova há ${days} dias.`;
    }
    return "";
  }

  function html(state, opts) {
    const { media, reports, aiEnabled } = state;
    const job = opts.job;
    const add = opts.canAdd
      ? `<button type="button" class="jc-act jc-act--main" data-jc-add>${opts.onAdd ? "Tirar foto" : "Adicionar fotos"}</button>`
      : "";
    if (!media.length) {
      return `<p class="jc-empty">Nenhuma foto ainda.</p>${add ? `<div class="jc-acts">${add}</div>` : ""}`;
    }
    const counts = { before: 0, during: 0, after: 0, other: 0 };
    media.forEach((m) => {
      counts[STAGE[m.stage] ? m.stage : "other"] += 1;
    });
    const extra = media.length - THUMBS;
    const thumbs = media
      .slice(0, THUMBS)
      .map((m, i) => {
        const stage = STAGE[m.stage] || "";
        const more = i === THUMBS - 1 && extra > 0 ? `<em>+${extra}</em>` : "";
        return `<button type="button" class="jc-thumb" data-jc-photo="${i}" aria-label="Abrir foto${stage ? ` ${stage}` : ""}, ${esc(dayLabel(m.taken_at_device || m.created_at))}">
          <img src="${esc(m.thumb_url || m.url)}" alt="" loading="lazy" />${stage ? `<span>${esc(stage)}</span>` : ""}${more}
        </button>`;
      })
      .join("");
    const stages = Object.entries(STAGE)
      .filter(([k]) => counts[k])
      .map(([k, l]) => `${l} ${counts[k]}`)
      .concat(counts.other ? [`Geral ${counts.other}`] : [])
      .join(" · ");
    const last = media[0];
    const who = last.taken_by_name || last.uploaded_by_name || last.author_name || "";
    const note = pendingNote(job, media, counts);
    const report = reports[0];
    const reportAct = report
      ? `<a class="jc-act" href="/api/work-orders/${encodeURIComponent(job.id)}/reports/${encodeURIComponent(report.id)}/pdf" target="_blank" rel="noopener">Ver relatório</a>`
      : aiEnabled && opts.canManage
        ? `<button type="button" class="jc-act" data-jc-report>Gerar relatório</button>`
        : "";
    const viewAll = opts.onViewAll ? `<button type="button" class="jc-act" data-jc-all>Ver todas (${media.length})</button>` : "";
    return `<div class="jc-thumbs">${thumbs}</div>
      <p class="jc-meta">${esc(stages)}</p>
      <p class="jc-meta">Última foto ${esc(dayLabel(last.taken_at_device || last.created_at))}${who ? ` por ${esc(who)}` : ""}</p>
      ${note ? `<p class="jc-note">${esc(note)}</p>` : ""}
      <div class="jc-acts">${add}${viewAll}${reportAct}</div>`;
  }

  function openViewer(state, opts, index) {
    if (!window.CamViewer) return;
    const job = opts.job;
    const client = window.JobsInfo?.client?.(job) || job.title || "";
    const refresh = () => state.refresh();
    window.CamViewer.open({
      photos: state.media.map((m) => ({
        id: m.legacy ? null : m.id, url: m.url, thumb_url: m.thumb_url, stage: m.stage, created_at: m.created_at, taken_at_device: m.taken_at_device,
        author: m.author_name, device: m.device_label, caption: m.caption, uploaded_by_name: m.uploaded_by_name, taken_by_name: m.taken_by_name, taken_at_source: m.taken_at_source, location_source: m.location_source, camera_model: m.camera_model, annotations: m.annotations, sticker_ids: m.sticker_ids || [], address: m.address || job.address, lat: m.lat, lng: m.lng,
        location_available: m.location_available, distance_m: m.distance_m, far_from_job: m.far_from_job, in_portfolio: m.in_portfolio,
        job: { number: job.number, title: job.title || client, client },
      })),
      index,
      ...(opts.canManage && window.CamViewer.jobEditing ? window.CamViewer.jobEditing(job.id, refresh) : {}),
      canPortfolio: Boolean(opts.canManage),
      onPortfolio: async (photo, next) => {
        const j = await api(`/api/work-orders/${encodeURIComponent(job.id)}/media/${encodeURIComponent(photo.id)}/portfolio`, {
          method: "PATCH",
          body: JSON.stringify({ in_portfolio: next }),
        });
        notify(next ? "Foto no portfólio público." : "Foto tirada do portfólio.", "success");
        changed(job.id);
        return j.data;
      },
    });
  }

  function mount(el, opts) {
    const jobId = opts.job.id;
    const state = { media: [], reports: [], aiEnabled: false, refresh: null };
    const paint = () => {
      el.innerHTML = html(state, opts);
    };
    async function refresh() {
      const [m, r] = await Promise.all([
        api(`/api/work-orders/${encodeURIComponent(jobId)}/media`),
        api(`/api/work-orders/${encodeURIComponent(jobId)}/reports`).catch(() => ({ data: [], meta: {} })),
      ]);
      state.media = m.data || [];
      state.reports = r.data || [];
      state.aiEnabled = Boolean(r.meta?.ai_enabled);
      if (el.isConnected) paint();
    }
    state.refresh = () => refresh().catch(() => {});

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp";
    input.multiple = true;
    input.hidden = true;
    input.setAttribute("aria-label", "Escolher fotos");
    el.after(input);

    input.addEventListener("change", async () => {
      const files = [...(input.files || [])];
      input.value = "";
      if (!files.length) return;
      const btn = el.querySelector("[data-jc-add]");
      const label = btn?.textContent;
      if (btn) btn.disabled = true;
      const out = await uploadFiles(opts.job, files, {
        onProgress: (i, n) => {
          if (btn?.isConnected) btn.textContent = `Enviando ${i} de ${n}…`;
        },
      });
      if (btn?.isConnected) {
        btn.disabled = false;
        btn.textContent = label;
      }
      if (out.added.length) {
        const stage = STAGE[out.added[0].stage];
        notify(`${plural(out.added.length, "foto adicionada", "fotos adicionadas")}${stage ? ` em ${stage}` : ""}. Dá para mudar a etapa abrindo a foto.`, "success");
      }
      if (out.failed.length) notify(out.failed.join(" "), "error");
    });

    el.addEventListener("click", async (e) => {
      const photo = e.target.closest("[data-jc-photo]");
      if (photo) {
        openViewer(state, opts, Number(photo.getAttribute("data-jc-photo")) || 0);
        return;
      }
      if (e.target.closest("[data-jc-add]")) {
        if (opts.onAdd) opts.onAdd();
        else input.click();
        return;
      }
      if (e.target.closest("[data-jc-all]")) {
        opts.onViewAll?.();
        return;
      }
      const rep = e.target.closest("[data-jc-report]");
      if (rep) {
        rep.disabled = true;
        rep.textContent = "Gerando…";
        try {
          await api(`/api/work-orders/${encodeURIComponent(jobId)}/reports/generate`, {
            method: "POST",
            body: JSON.stringify({ template_key: "site_visit" }),
          });
          notify("Rascunho do relatório pronto. Revise antes de mandar ao cliente.", "success");
          changed(jobId);
        } catch (err) {
          notify(err.message || "Não foi possível gerar o relatório. Tente de novo.", "error");
          if (rep.isConnected) {
            rep.disabled = false;
            rep.textContent = "Gerar relatório";
          }
        }
      }
    });

    const onChanged = (e) => {
      if (!el.isConnected) {
        window.removeEventListener("jobcam:changed", onChanged);
        input.remove();
        return;
      }
      if (String(e.detail?.jobId) === String(jobId)) state.refresh();
    };
    window.addEventListener("jobcam:changed", onChanged);

    el.innerHTML = window.crmSkeleton ? window.crmSkeleton.rows(2, { avatar: false }) : '<p class="jc-empty">Carregando fotos…</p>';
    refresh().catch(() => {
      el.innerHTML = '<p class="jc-empty">Não foi possível carregar as fotos. Atualize a página para tentar de novo.</p>';
    });
    return { refresh: state.refresh };
  }

  window.JobCamBlock = { mount, uploadFiles };
})();
