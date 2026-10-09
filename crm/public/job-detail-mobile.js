/**
 * Job detail mobile overlay — visits, photos capture/upload, finance snippet.
 */
(function () {
  const ROLE_KEY = "om_jobs_role";
  let job = null;
  let canManage = false;
  let canBill = false;
  let canInvoice = false;
  let isField = false;
  let jobId = null;
  let detTab = "visitas";
  let mediaList = [];
  let mediaLoaded = false;
  let commsCtl = null;
  let checklistEnabled = true;

  const $ = (id) => document.getElementById(id);

  function isMobile() {
    return window.__omDevice && typeof window.__omDevice.isMobile === "function"
      ? window.__omDevice.isMobile()
      : false;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusPt(status) {
    const map = {
      draft: "Rascunho",
      scheduled: "Agendado",
      in_progress: "Em campo",
      completed: "Concluído",
      canceled: "Cancelado",
    };
    return map[status] || status || "—";
  }

  function statusCls(status) {
    if (status === "in_progress") return "jcm-badge--progress";
    if (status === "scheduled") return "jcm-badge--sched";
    if (status === "completed") return "jcm-badge--done";
    return "jcm-badge--open";
  }

  function stageLabel(stage) {
    const map = { before: "Antes", during: "Durante", after: "Depois" };
    return map[stage] || "";
  }

  function clientLabel(wo) {
    return wo.customer?.name || wo.builder?.company || wo.builder?.name || wo.source_name || "—";
  }

  function teamLabel(wo) {
    const parts = [];
    if (wo.crew?.name) parts.push(wo.crew.name);
    if (wo.assigned_user?.name) parts.push(wo.assigned_user.name);
    (wo.members || []).forEach((m) => {
      if (m.name && !parts.includes(m.name)) parts.push(m.name);
    });
    return parts.join(", ") || "Sem equipe";
  }

  function fmtDay(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function fmtTimeRange(start, end) {
    if (!start) return "";
    const s = new Date(start);
    const pad = (n) => String(n).padStart(2, "0");
    const a = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
    if (!end) return a;
    const e = new Date(end);
    return `${a} – ${pad(e.getHours())}:${pad(e.getMinutes())}`;
  }

  function isTodayIso(iso) {
    return !!iso && new Date(iso).toDateString() === new Date().toDateString();
  }

  function moneyFmt(n) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
  }

  function sqftTotal(wo) {
    const items = wo.line_items || [];
    const sum = items.reduce((s, it) => s + (Number(it.quantity_sqft) || 0), 0);
    return sum > 0 ? `${Math.round(sum)} sq ft` : "";
  }

  function canUpload() {
    return canManage || isField;
  }

  function buildTimeline(wo) {
    const title = wo.title || "Visita";
    const start = wo.scheduled_start;
    const end = wo.scheduled_end;
    const steps = [];
    if (wo.status === "completed") {
      steps.push({ title, meta: fmtDay(end || start), state: "done" });
    } else if (wo.status === "in_progress") {
      steps.push({
        title,
        meta: `${fmtDay(start)}${start ? ` · ${fmtTimeRange(start, end)}${isTodayIso(start) ? " · hoje" : ""}` : ""}`,
        state: "current",
      });
      steps.push({ title: "Vistoria final", meta: "A agendar", state: "upcoming" });
    } else if (start) {
      steps.push({
        title,
        meta: `${fmtDay(start)} · ${fmtTimeRange(start, end)}`,
        state: "current",
      });
      steps.push({ title: "Vistoria final", meta: "A agendar", state: "upcoming" });
    } else {
      steps.push({ title: "Agendar visita", meta: "Sem data", state: "upcoming" });
    }
    (wo.line_items || []).slice(0, 3).forEach((it, i) => {
      if (!it.service_name) return;
      const unit = it.unit
        ? String(it.unit).replace(/_/g, " ")
        : "sq ft";
      steps.push({
        title: it.service_name,
        meta: it.quantity_sqft ? `${it.quantity_sqft} ${unit}` : "",
        state: wo.status === "completed" ? "done" : i === 0 && !start ? "current" : "upcoming",
      });
    });
    return steps.slice(0, 5);
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
          if (!ctx) {
            throw new Error("Canvas unavailable");
          }
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

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler imagem"));
      reader.readAsDataURL(file);
    });
  }

  async function fileToUploadDataUrl(file) {
    const type = String(file.type || "").toLowerCase();
    if (type && !type.startsWith("image/")) {
      throw new Error("Selecione uma imagem");
    }
    try {
      const dataUrl = await compressImage(file, 1280, 0.7);
      if (dataUrl.length > 9_000_000) throw new Error("Foto demasiado grande após compressão");
      return dataUrl;
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("HEIC") || msg.includes("unsupported-type")) {
        throw new Error("Formato não suportado. Use JPG ou PNG.");
      }
      const dataUrl = await readFileAsDataUrl(file);
      if (/^data:image\/(heic|heif)/i.test(dataUrl)) {
        throw new Error("Formato HEIC não suportado. Use JPG ou PNG.");
      }
      if (dataUrl.length > 9_000_000) {
        throw new Error("Foto demasiado grande. Tente outra com menor resolução.");
      }
      return dataUrl;
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

  async function fetchJson(url, opts, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 90000);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) {
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      return j;
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Tempo esgotado no envio. Tente novamente.");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadMedia() {
    if (!jobId) return;
    const j = await fetchJson(`/api/work-orders/${jobId}/media`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    }, 30000);
    mediaList = j.data || [];
    mediaLoaded = true;
  }

  async function uploadViaOffice(payload) {
    const j = await fetchJson(
      `/api/work-orders/${jobId}/media`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      },
      90000,
    );
    return j.data;
  }

  async function uploadViaCampo(payload) {
    const j = await fetchJson(
      `/api/campo/jobs/${jobId}/photos`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      },
      90000,
    );
    const photos = j.data?.photos || [];
    return photos[0] || null;
  }

  async function uploadPhoto(file) {
    if (!canUpload()) throw new Error("Sem permissão para adicionar fotos");
    const [dataUrl, gps] = await Promise.all([fileToUploadDataUrl(file), getGps()]);
    const stage = ($("jobMobPhotoStage")?.value || "").trim() || null;
    const caption = ($("jobMobPhotoCaption")?.value || "").trim() || null;
    const clientId =
      window.crypto && crypto.randomUUID ? crypto.randomUUID() : `mob-${Date.now()}`;
    const payload = {
      data_url: dataUrl,
      stage,
      caption,
      taken_at_device: new Date().toISOString(),
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      gps_accuracy_m: gps?.gpsAccuracyM ?? null,
      address: job?.address || null,
      client_upload_id: clientId,
      device_label: "Mobile web",
      is_public: false,
    };

    let uploaded = null;
    if (canManage) {
      uploaded = await uploadViaOffice(payload);
    } else {
      uploaded = await uploadViaCampo(payload);
    }

    await loadMedia();
    if ($("jobMobPhotoCaption")) $("jobMobPhotoCaption").value = "";
    renderFotos();
    return uploaded;
  }

  function renderFotos() {
    const root = $("jobMobExtra");
    if (!root) return;
    const uploadBlock = canUpload()
      ? `<div class="jcm-card jcm-photo-upload">
          <div class="jcm-photo-upload__row">
            <label class="jcm-photo-upload__field">
              Etapa
              <select id="jobMobPhotoStage">
                <option value="">Geral</option>
                <option value="before">Antes</option>
                <option value="during">Durante</option>
                <option value="after">Depois</option>
              </select>
            </label>
            <label class="jcm-photo-upload__field jcm-photo-upload__field--grow">
              Legenda
              <input type="text" id="jobMobPhotoCaption" maxlength="500" placeholder="Opcional" />
            </label>
          </div>
          <div class="jcm-photo-actions">
            <button type="button" class="jcm-foot__btn jcm-foot__btn--primary" id="jobMobTakePhoto">Tirar foto</button>
            <button type="button" class="jcm-foot__btn jcm-foot__btn--ghost" id="jobMobPickPhoto">Galeria</button>
          </div>
          <input type="file" id="jobMobCameraInput" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png" capture="environment" hidden />
          <input type="file" id="jobMobGalleryInput" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png" hidden />
        </div>`
      : `<div class="jcm-card"><p class="jcm-empty" style="padding:0.75rem 0">Sem permissão para adicionar fotos neste job.</p></div>`;

    const grid = !mediaLoaded
      ? `<p class="jcm-empty">A carregar fotos…</p>`
      : mediaList.length
        ? `<div class="jcm-photo-grid">${mediaList
            .map((p, i) => {
              const st = stageLabel(p.stage);
              const cap = escapeHtml(p.caption || st || "Foto");
              return `<a class="jcm-photo-thumb" href="${escapeHtml(p.url)}" target="_blank" rel="noopener" data-mob-photo="${i}">
                ${st ? `<span class="jcm-photo-thumb__stg">${escapeHtml(st)}</span>` : ""}
                <img src="${escapeHtml(p.thumb_url || p.url)}" alt="${cap}" loading="lazy" />
                <span class="jcm-photo-thumb__cap">${cap}</span>
              </a>`;
            })
            .join("")}</div>`
        : `<p class="jcm-empty">Ainda sem fotos. Tire uma agora.</p>`;

    root.innerHTML = `${uploadBlock}${grid}`;

    $("jobMobTakePhoto")?.addEventListener("click", () => $("jobMobCameraInput")?.click());
    $("jobMobPickPhoto")?.addEventListener("click", () => $("jobMobGalleryInput")?.click());
    const onFile = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        window.crmToast?.show?.("A enviar foto…", { type: "info" });
        await uploadPhoto(file);
        window.crmToast?.success?.("Foto adicionada");
      } catch (err) {
        console.error("[job-photo-upload]", err);
        window.crmToast?.error?.(err.message || "Falha no upload");
      }
    };
    $("jobMobCameraInput")?.addEventListener("change", onFile);
    $("jobMobGalleryInput")?.addEventListener("change", onFile);
  }

  function render() {
    if (!job || !$("jobMobRoot")) return;
    const wo = job;
    const J = window.JobsInfo;
    $("jobMobId").textContent = wo.number != null ? `#${wo.number}` : "";
    const badge = $("jobMobStatus");
    badge.textContent = statusPt(wo.status);
    badge.className = `jcm-badge ${statusCls(wo.status)}`;
    const lt = J ? J.late(wo) : null;
    const lateEl = $("jobMobLate");
    if (lateEl) {
      lateEl.hidden = !lt;
      lateEl.textContent = lt ? lt.short : "";
    }
    $("jobMobName").textContent = wo.title || `Job para ${clientLabel(wo)}`;
    $("jobMobType").textContent = [clientLabel(wo), J ? J.dateRange(wo) : fmtDay(wo.scheduled_start), sqftTotal(wo)].filter(Boolean).join(" · ");
    const stepsEl = $("jobMobSteps");
    if (stepsEl && J) {
      const st = J.step(wo);
      const names = ["Agendado", "Campo", "Concluído", "Faturado", "Pago"];
      stepsEl.hidden = st < 0;
      stepsEl.innerHTML = names.map((n, i) => `<li class="${i < st ? "is-ok" : i === st ? "is-cur" : ""}"><i></i>${n}</li>`).join("");
    }
    const when = $("jobMobWhen");
    if (when) when.textContent = wo.scheduled_start ? `${J ? J.dateRange(wo) : fmtDay(wo.scheduled_start)} · ${fmtTimeRange(wo.scheduled_start, wo.scheduled_end)}` : "Sem data";
    const b = wo.billing;
    const mw = $("jobMobMoneyWrap");
    if (mw) {
      mw.hidden = !(canBill && b);
      if (canBill && b) {
        const rows = [["Total do job", moneyFmt(b.services_total)]];
        if (b.remaining_to_invoice > 0.004) rows.push(["A faturar", moneyFmt(b.remaining_to_invoice)]);
        if (b.open_balance > 0.004) rows.push(["A receber", moneyFmt(b.open_balance)]);
        rows.push(["Recebido", moneyFmt(b.paid_total)]);
        $("jobMobMoney").innerHTML = rows.map(([k, v]) => `<div class="jmx-li"><span>${k}</span><b>${v}</b></div>`).join("");
      }
    }
    const billQ = $("jobMobBillQuick");
    if (billQ) billQ.hidden = !canBill;
    const svcSum = $("jobMobSvcSum");
    if (svcSum) {
      const n = (wo.line_items || []).length;
      svcSum.textContent = `${n} serviço${n === 1 ? "" : "s"} · editar ›`;
    }

    const addr = wo.address || "—";
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "#";
    $("jobMobAddr").textContent = addr;
    $("jobMobTeam").textContent = teamLabel(wo);
    $("jobMobMapQuick").href = maps;
    const phone = wo.customer?.phone || "";
    $("jobMobCallQuick").href = phone ? `tel:${phone}` : "customers.html";
    $("jobMobNotesQuick").href = `#`;
    const svcBtn = $("jobMobEditServices");
    if (svcBtn) {
      svcBtn.hidden = !canManage;
    }

    const steps = buildTimeline(wo);
    $("jobMobTimeline").innerHTML = steps
      .map((st) => {
        const cls = st.state === "done" ? "is-done" : st.state === "current" ? "is-current" : "";
        return `<div class="jcm-tl ${cls}">
          <div class="jcm-tl__rail"><span class="jcm-tl__dot"></span><span class="jcm-tl__line"></span></div>
          <div>
            <p class="jcm-tl__title">${escapeHtml(st.title)}</p>
            <p class="jcm-tl__meta">${escapeHtml(st.meta || "")}</p>
          </div>
        </div>`;
      })
      .join("");

    const notes = (wo.notes || "").trim();
    $("jobMobInstr").hidden = !notes;
    const lockCode = typeof window.parseJobLockbox === "function" ? window.parseJobLockbox(notes) : null;
    let noteText = lockCode ? notes.replace(/\/lockbox\s*[#:]?\s*[0-9A-Za-z-]{2,24}\b\s*[—–-]?\s*/i, "").trim() : notes;
    if (lockCode && noteText) noteText = noteText.charAt(0).toUpperCase() + noteText.slice(1);
    $("jobMobInstrBody").innerHTML =
      (lockCode && window.jobLockboxBadgeHtml ? `<span style="display:block;margin-bottom:6px">${window.jobLockboxBadgeHtml(notes)}</span>` : "") +
      escapeHtml(noteText).replace(/\n/g, "<br>");

    const cta = $("jobMobCta");
    const foot = $("jobMobFoot");
    foot.classList.add("is-visible", "jcm-foot--single");

    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      const key = btn.getAttribute("data-jd-tab");
      if (key === "checklist") {
        btn.hidden = !checklistEnabled;
        if (!checklistEnabled && detTab === "checklist") detTab = "visitas";
      }
      btn.classList.toggle("is-active", key === detTab);
    });
    $("jobMobVisitas").hidden = detTab !== "visitas";
    $("jobMobExtra").hidden = detTab === "visitas";

    if (detTab !== "comunicacoes" && commsCtl) {
      try {
        commsCtl.destroy();
      } catch (_) {}
      commsCtl = null;
    }

    if (detTab === "fotos") {
      if (canUpload()) {
        cta.textContent = "Tirar foto";
        cta.className = "jcm-foot__btn jcm-foot__btn--primary";
        cta.dataset.action = "photo";
      } else {
        cta.textContent = "Abrir Campo";
        cta.className = "jcm-foot__btn jcm-foot__btn--ghost";
        cta.dataset.action = "campo";
      }
      if (!mediaLoaded) {
        $("jobMobExtra").innerHTML = `<p class="jcm-empty">A carregar fotos…</p>`;
        loadMedia()
          .then(() => renderFotos())
          .catch((e) => {
            $("jobMobExtra").innerHTML = `<p class="jcm-empty">${escapeHtml(e.message || "Erro")}</p>`;
          });
      } else {
        renderFotos();
      }
    } else if (detTab === "checklist") {
      if (!checklistEnabled) {
        detTab = "visitas";
        render();
        return;
      }
      $("jobMobExtra").innerHTML = `<p class="jcm-empty">A carregar checklist…</p>`;
      restoreVisitCta();
      fetch(`/api/work-orders/${encodeURIComponent(wo.id)}/field`, { credentials: "include" })
        .then((r) => r.json())
        .then((j) => {
          if (detTab !== "checklist") return;
          const f = j && j.data;
          if (!f) throw new Error(j?.error || "Erro");
          checklistEnabled = f.checklist_enabled !== false;
          if (!checklistEnabled) {
            detTab = "visitas";
            render();
            return;
          }
          const c = f.checklist;
          const hours = f.hours && f.hours.total ? ` · ${f.hours.total} h registradas` : "";
          $("jobMobExtra").innerHTML = `<div class="jcm-card">
            <p class="jcm-dl__k" style="margin:0 0 10px">${c.done}/${c.total} feitos${hours}${c.customized ? "" : " · modelo padrão"}</p>
            ${c.items
              .map(
                (i) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid #efe8dc">
                  <span style="width:20px;height:20px;border-radius:6px;flex:none;display:grid;place-items:center;font-size:12px;color:#fff;${i.done ? "background:#211d1a" : "border:2px solid #e2d9cc"}">${i.done ? "✓" : ""}</span>
                  <span style="${i.done ? "color:#8a8074" : ""}">${escapeHtml(i.text)}${i.photo_required ? ` <small style="color:#c1652f;font-weight:700">· foto</small>` : ""}</span></div>`,
              )
              .join("")}
            <a href="${escapeHtml(f.campo_url)}" style="display:inline-block;margin-top:10px;font-weight:800;color:#c1652f;text-decoration:none">Abrir no Campo →</a>
          </div>`;
        })
        .catch((e) => {
          if (detTab === "checklist") $("jobMobExtra").innerHTML = `<p class="jcm-empty">${escapeHtml(e.message || "Erro")}</p>`;
        });
    } else if (detTab === "comunicacoes") {
      cta.textContent = "Abrir canal";
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "comms-channel";
      if (commsCtl) {
        try {
          commsCtl.destroy();
        } catch (_) {}
        commsCtl = null;
      }
      $("jobMobExtra").innerHTML = "";
      if (window.JobChatComms && jobId) {
        commsCtl = window.JobChatComms.mount($("jobMobExtra"), {
          jobId,
          workOrder: job,
          compact: true,
          onError: (err) => alert(err.message || "Erro"),
        });
      } else {
        $("jobMobExtra").innerHTML = `<p class="jcm-empty">ObraChat indisponível.</p>`;
      }
    } else if (detTab === "servicos") {
      restoreVisitCta();
      const items = Array.isArray(wo.line_items) ? wo.line_items : [];
      const total = Number(wo.services_total) || 0;
      const money = (n) =>
        Number.isFinite(Number(n))
          ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "—";
      const list = items.length
        ? `<div class="jcm-dl">${items
            .map((li) => {
              const qty = Number(li.quantity_sqft) || 0;
              const price = Number(li.unit_price) || 0;
              const lineTot = qty * price;
              return `<div class="jcm-dl__row">
                <span class="jcm-dl__k">${escapeHtml(li.service_name || "Serviço")}${qty ? ` · ${escapeHtml(String(qty))}${li.unit ? ` ${escapeHtml(li.unit)}` : ""}` : ""}${
                  li.notes ? `<small style="display:block;margin-top:3px;font-weight:600;color:#8a8074">${escapeHtml(li.notes)}</small>` : ""
                }</span>
                <span class="jcm-dl__v">${escapeHtml(money(lineTot || price))}</span>
              </div>`;
            })
            .join("")}
            <div class="jcm-dl__row" style="margin-top:8px;padding-top:8px;border-top:1px solid #efe8dc">
              <span class="jcm-dl__k"><strong>Total</strong></span>
              <span class="jcm-dl__v"><strong>${escapeHtml(money(total))}</strong></span>
            </div>
          </div>`
        : `<p class="jcm-empty" style="padding:0.5rem 0">Nenhum serviço neste job.</p>`;
      const acts = canManage
        ? `<div class="jcm-photo-actions" style="margin-top:12px">
            <button type="button" class="jcm-foot__btn jcm-foot__btn--primary" data-job-mob-svc="edit">${items.length ? "Editar serviços" : "Adicionar serviços"}</button>
            <button type="button" class="jcm-foot__btn jcm-foot__btn--ghost" data-job-mob-svc="add">+ Serviço</button>
          </div>`
        : "";
      $("jobMobExtra").innerHTML = `<div class="jcm-card"><div class="jcm-ch" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px"><h2 style="margin:0;font-size:15px;font-weight:800">Serviços</h2><span style="color:#8a8074;font-weight:700;font-size:13px">${items.length}</span></div>${list}${acts}</div>`;
    } else if (detTab === "financeiro") {
      const total = Number(wo.services_total) || 0;
      const svcActs = canManage
        ? `<div class="jcm-photo-actions" style="margin:0 0 12px">
            <button type="button" class="jcm-foot__btn jcm-foot__btn--ghost" data-job-mob-svc="edit">Editar serviços</button>
            <button type="button" class="jcm-foot__btn jcm-foot__btn--ghost" data-job-mob-svc="add">+ Serviço</button>
          </div>`
        : "";
      if (canBill && window.JobBilling) {
        $("jobMobExtra").innerHTML = `${svcActs}<div class="jcm-card"><div id="jobMobBilling"></div></div>`;
        window.JobBilling.mountCard($("jobMobBilling"), {
          jobId: wo.id,
          jobStatus: wo.status,
          canManage: canInvoice,
        });
      } else {
        $("jobMobExtra").innerHTML = `${svcActs}<div class="jcm-card"><div class="jcm-dl">
          <div class="jcm-dl__row"><span class="jcm-dl__k">Serviços</span><span class="jcm-dl__v">${escapeHtml(
            String(total ? `$${total.toFixed(2)}` : "—"),
          )}</span></div>
        </div></div>`;
      }
      restoreVisitCta();
    } else {
      restoreVisitCta();
    }
  }

  function restoreVisitCta() {
    const wo = job;
    const cta = $("jobMobCta");
    if (!cta || !wo) return;
    if (wo.status === "in_progress") {
      cta.textContent = "Concluir job";
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "complete";
    } else if (wo.status === "completed" && canInvoice && wo.billing && wo.billing.remaining_to_invoice > 0.004 && window.JobBilling) {
      cta.textContent = `Faturar ${moneyFmt(wo.billing.remaining_to_invoice)}`;
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "invoice";
    } else if (wo.status === "completed") {
      cta.textContent = "Ver na agenda";
      cta.className = "jcm-foot__btn jcm-foot__btn--ghost";
      cta.dataset.action = "schedule";
    } else {
      cta.textContent = "Iniciar job";
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "start";
    }
  }

  async function setStatus(status) {
    if (!canManage || !jobId) return;
    const r = await fetch(`/api/work-orders/${jobId}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || "Erro");
    job = j.data;
    render();
  }

  function openServicesModal() {
    if (!canManage || !jobId || !window.__crmJobModal) return;
    window.__crmJobModal
      .openEdit(jobId, { section: "services" })
      .catch((e) => window.crmToast?.error?.(e.message || "Erro"));
  }

  function bind() {
    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detTab = btn.getAttribute("data-jd-tab") || "visitas";
        render();
      });
    });
    document.querySelectorAll("[data-jobs-role]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const role = btn.getAttribute("data-jobs-role") || "office";
        try {
          localStorage.setItem(ROLE_KEY, role);
        } catch (_) {}
        document.querySelectorAll("[data-jobs-role]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-jobs-role") === role);
        });
      });
    });
    $("jobMobEditServices")?.addEventListener("click", () => openServicesModal());
    $("jobMobExtra")?.addEventListener("click", (e) => {
      const ph = e.target.closest("[data-mob-photo]");
      if (ph && window.CamViewer) {
        e.preventDefault();
        const wo = job || {};
        window.CamViewer.open({
          photos: mediaList.map((m) => ({
            id: m.legacy ? null : m.id, url: m.url, thumb_url: m.thumb_url, stage: m.stage, created_at: m.created_at, taken_at_device: m.taken_at_device,
            author: m.author_name, device: m.device_label, caption: m.caption, address: m.address || wo.address, lat: m.lat, lng: m.lng,
            location_available: m.location_available, distance_m: m.distance_m, far_from_job: m.far_from_job, in_portfolio: m.in_portfolio,
            job: { number: wo.number, title: wo.title || clientLabel(wo), client: clientLabel(wo) },
          })),
          index: Number(ph.getAttribute("data-mob-photo")) || 0,
        });
        return;
      }
      const btn = e.target.closest("[data-job-mob-svc]");
      if (!btn) return;
      openServicesModal();
    });
    $("jobMobCta")?.addEventListener("click", async () => {
      const action = $("jobMobCta").dataset.action;
      try {
        if (action === "photo") {
          $("jobMobCameraInput")?.click() ||
            (() => {
              detTab = "fotos";
              render();
              setTimeout(() => $("jobMobCameraInput")?.click(), 50);
            })();
          return;
        }
        if (action === "campo") {
          location.href = `campo/ticket.html?id=${encodeURIComponent(jobId)}`;
          return;
        }
        if (action === "comms-channel") {
          if (window.JobChatComms) {
            await window.JobChatComms.openJobChannel(jobId);
          }
          return;
        }
        if (action === "invoice") {
          window.JobBilling.openDialog({ jobId, billing: job.billing, jobStatus: job.status });
          return;
        }
        if (action === "start") {
          await setStatus("in_progress");
          window.crmToast?.success?.("Job iniciado");
        } else if (action === "complete") {
          if (!confirm("Marcar o job como concluído?")) return;
          await setStatus("completed");
          window.crmToast?.success?.("Job concluído");
        } else if (action === "schedule") {
          location.href = "schedule.html";
        }
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro");
      }
    });
    $("jobMobPhotosQuick")?.addEventListener("click", (e) => {
      e.preventDefault();
      detTab = "fotos";
      render();
      document.querySelector("[data-jd-tab='fotos']")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("jobMobBillQuick")?.addEventListener("click", () => {
      detTab = "financeiro";
      render();
      document.querySelector("[data-jd-tab='financeiro']")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("jobMobNotesQuick")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (canManage && window.__crmJobModal) {
        window.__crmJobModal.openEdit(jobId, { section: "notes" }).catch((err) => window.crmToast?.error?.(err.message || "Erro"));
        return;
      }
      $("jobMobInstr")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!$("jobMobRoot")) return;
    jobId = new URLSearchParams(location.search).get("id");
    if (!jobId) return;
    if ((location.hash || "") === "#fotos") detTab = "fotos";
    // A barra fixa fica no body: dentro do main (que pode ter transform) ela não gruda no rodapé.
    const foot = $("jobMobFoot");
    if (foot && foot.parentElement !== document.body) document.body.appendChild(foot);
    try {
      const role = localStorage.getItem(ROLE_KEY) === "installer" ? "installer" : "office";
      document.querySelectorAll("[data-jobs-role]").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-jobs-role") === role);
      });
    } catch (_) {}
    try {
      const s = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json());
      if (!s.authenticated) return;
      const roleName = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      canManage = roleName === "admin" || perms.includes("work_orders.manage");
      canBill = roleName === "admin" || perms.includes("invoices.view");
      canInvoice = roleName === "admin" || perms.includes("invoices.manage");
      isField =
        roleName === "installer" ||
        roleName === "crew_lead" ||
        roleName === "subcontractor" ||
        (window.__crmFieldGate && window.__crmFieldGate.isFieldRole?.(roleName));
      const j = await fetch(`/api/work-orders/${jobId}`, { credentials: "include" }).then((r) => r.json());
      if (!j.success && j.success !== undefined) throw new Error(j.error || "Erro");
      job = j.data;
      bind();
      render();
      if (window.__crmJobModal?.onSaved) {
        window.__crmJobModal.onSaved(async (data) => {
          if (data?.id && String(data.id) === String(jobId)) {
            job = data;
            render();
          } else if (jobId) {
            try {
              const refreshed = await fetch(`/api/work-orders/${jobId}`, { credentials: "include" }).then((r) =>
                r.json(),
              );
              if (refreshed?.data) {
                job = refreshed.data;
                render();
              }
            } catch (_) {}
          }
        });
      }
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
