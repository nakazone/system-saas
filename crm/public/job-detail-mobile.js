/**
 * Job page on the phone: who, where, when, the money, and one action in the footer.
 * Same reading as the desktop header (job-header.js), in one column.
 */
(function () {
  let job = null;
  let canManage = false;
  let canBill = false;
  let canInvoice = false;
  let isField = false;
  let jobId = null;
  let detTab = "geral";
  let field = null;
  let sessionPerms = [];
  let sessionRole = "";
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

  const can = (perm) => sessionRole === "admin" || sessionPerms.includes(perm);
  function headerCtx() {
    return { mode: "phone", canManage, canBill, canInvoice, can, field, billing: job?.billing || null, invoices: job?.invoices || null };
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
    const who = (J && J.fieldClient ? J.fieldClient(wo) : null) || clientLabel(wo);
    const idEl = $("jobMobId");
    if (isField) {
      idEl.textContent = "";
      idEl.hidden = true;
    } else {
      idEl.hidden = false;
      idEl.textContent = wo.number != null ? `#${wo.number}` : "";
    }
    const badge = $("jobMobStatus");
    badge.textContent = statusPt(wo.status);
    badge.className = `jcm-badge ${statusCls(wo.status)}`;
    const lt = J ? J.late(wo) : null;
    const lateEl = $("jobMobLate");
    if (lateEl) {
      lateEl.hidden = !lt;
      lateEl.textContent = lt ? lt.short : "";
    }
    if (isField) {
      $("jobMobName").textContent = who && who !== "—" && who !== "Sem cliente" ? who : "Job";
      $("jobMobType").textContent = wo.address || "Sem endereço";
    } else {
      const client = J ? J.client(wo) : clientLabel(wo);
      const head = client && client !== "Sem cliente" ? client : wo.title || "Job";
      $("jobMobName").textContent = head;
      $("jobMobType").textContent = [wo.title !== head ? wo.title : "", sqftTotal(wo)].filter(Boolean).join(" · ");
    }
    const stepsEl = $("jobMobSteps");
    if (stepsEl && J) {
      const st = J.step(wo);
      const names = ["Agendado", "Campo", "Concluído", "Faturado", "Pago"];
      stepsEl.hidden = st < 0;
      const halves = J.fieldHalves(wo);
      const nxt = J.nextFinish(wo);
      stepsEl.innerHTML = names
        .map((n, i) => {
          const cls = i < st ? "is-ok" : i === st ? "is-cur" : "";
          const status = J.statusForStep(i);
          const clickable = canManage && st >= 0 && (status || (i === 3 && canBill));
          const tip = status ? (i === 1 && nxt ? nxt.label : `Mover para ${n}`) : i === 3 ? "Faturar" : i === 4 ? "Pagamento nas faturas" : n;
          if (i === 1 && halves) {
            const inst = st > 1 ? "d" : halves.inst;
            const sand = st > 1 ? "d" : halves.sand;
            return `<li class="${cls} is-split${clickable ? " is-btn" : ""}"${
              clickable
                ? ` role="button" tabindex="0" data-mob-step="${i}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"`
                : ""
            }><span class="jmx-step-split"><i class="${inst}"></i><i class="${sand}"></i></span>${n}</li>`;
          }
          return `<li class="${cls}${clickable ? " is-btn" : ""}"${
            clickable
              ? ` role="button" tabindex="0" data-mob-step="${i}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"`
              : ""
          }><i></i>${n}</li>`;
        })
        .join("");
    }
    renderFacts(wo);
    renderAlerts(wo);
    renderMenu(wo);

    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "";
    const mapQuick = $("jobMobMapQuick");
    mapQuick.hidden = !maps;
    if (maps) mapQuick.href = maps;
    // On site the crew talks to whoever lives there; the office talks to its customer.
    const phone = isField ? wo.homeowner_phone || wo.customer?.phone : wo.customer?.phone || wo.homeowner_phone;
    const callQuick = $("jobMobCallQuick");
    callQuick.hidden = !phone;
    if (phone) callQuick.href = `tel:${String(phone).replace(/[^\d+]/g, "")}`;
    $("jobMobChatQuick").hidden = !can("chat.use");

    const cta = $("jobMobCta");
    const foot = $("jobMobFoot");
    foot.classList.add("is-visible", "jcm-foot--single");

    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      const key = btn.getAttribute("data-jd-tab");
      if (key === "checklist") {
        btn.hidden = !checklistEnabled;
        if (!checklistEnabled && detTab === "checklist") detTab = "geral";
      }
      btn.classList.toggle("is-active", key === detTab);
    });

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
        detTab = "geral";
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
            detTab = "geral";
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
    } else if (detTab === "stain") {
      cta.textContent = "Samples de stain";
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "stain";
      if (window.JobStain) window.JobStain.mount($("jobMobExtra"), { jobId: wo.id, compact: true });
      else $("jobMobExtra").innerHTML = `<p class="jcm-empty">Stain indisponível.</p>`;
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
          onError: (err) => window.crmToast?.error(err.message || "Erro no ObraChat"),
        });
      } else {
        $("jobMobExtra").innerHTML = `<p class="jcm-empty">ObraChat indisponível.</p>`;
      }
    } else {
      restoreVisitCta();
      renderOverview(wo);
    }
  }

  /** Notes first (what matters on site), then services, then invoices. Totals live in the facts above. */
  function renderOverview(wo) {
    const { code, text } = window.JobHeader.noteParts(wo.notes);
    const edit = (act, label) => (canManage ? `<button type="button" class="jmx-link" data-mob-edit="${act}">${label}</button>` : "");
    const notes = text
      ? `<section class="jcm-card jmx-sec"><div class="jmx-sec__h"><h2>${isField ? "Instruções para a equipe" : "Notas da obra"}</h2>${edit("notes", "Editar")}</div><p class="jmx-sec__p">${escapeHtml(text).replace(/\n/g, "<br>")}</p></section>`
      : canManage
        ? `<section class="jcm-card jmx-sec jmx-sec--one"><div class="jmx-sec__h"><h2>Notas da obra</h2>${edit("notes", code ? "Editar" : "Adicionar")}</div></section>`
        : "";
    const items = Array.isArray(wo.line_items) ? wo.line_items : [];
    const showMoney = !isField;
    const list = items.length
      ? `<div class="jcm-dl">${items
          .map((li) => {
            const qty = Number(li.quantity_sqft) || 0;
            const unit = li.unit ? String(li.unit).replace(/_/g, " ") : "sq ft";
            return `<div class="jcm-dl__row">
              <span class="jcm-dl__k">${escapeHtml(li.service_name || "Serviço")}${qty ? ` · ${escapeHtml(String(qty))}${unit ? ` ${escapeHtml(unit)}` : ""}` : ""}${
                li.notes ? `<small class="jmx-sec__note">${escapeHtml(li.notes)}</small>` : ""
              }</span>
              ${showMoney ? `<span class="jcm-dl__v">${escapeHtml(moneyFmt(li.line_total))}</span>` : ""}
            </div>`;
          })
          .join("")}${
          showMoney
            ? `<div class="jcm-dl__row jmx-sec__total"><span class="jcm-dl__k"><strong>Total do job</strong></span><span class="jcm-dl__v"><strong>${escapeHtml(moneyFmt(wo.services_total))}</strong></span></div>`
            : ""
        }</div>`
      : `<p class="jcm-empty">Nenhum serviço neste job.</p>`;
    const services = `<section class="jcm-card jmx-sec"><div class="jmx-sec__h"><h2>Serviços</h2>${edit("services", items.length ? "Editar" : "Adicionar")}</div>${list}</section>`;
    const invoices = canBill && window.JobBilling
      ? `<section class="jcm-card jmx-sec jd-billing" id="jobMobBillingCard"><div class="jmx-sec__h"><h2>Faturas</h2></div><div id="jobMobBilling"></div></section>`
      : "";
    $("jobMobExtra").innerHTML = notes + services + invoices;
    if (invoices) {
      window.JobBilling.mountCard($("jobMobBilling"), { jobId: wo.id, jobStatus: wo.status, canManage: canInvoice });
    }
  }

  /** One row per subject, each with its own action. */
  function renderFacts(wo) {
    const J = window.JobsInfo;
    const H = window.JobHeader;
    const rows = [];
    const { code } = H.noteParts(wo.notes);
    const lock = code
      ? `<span class="jh-lock"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>${escapeHtml(code)}</span>`
      : "";
    const row = (label, value, sub, action, extra) =>
      `<div class="jmx-fact"><div class="jmx-fact__m"><small>${label}</small>${value}${sub ? `<span>${sub}</span>` : ""}${extra || ""}</div>${action || ""}</div>`;
    const act = (name, label) => `<button type="button" class="jmx-fact__a" data-mob-fact="${name}">${label}</button>`;
    rows.push(
      row(
        "Obra",
        `<b>${escapeHtml(wo.address || "Sem endereço")}</b>`,
        "",
        "",
        lock,
      ),
    );
    const dated = wo.scheduled_start || wo.sand_scheduled_start;
    const open = wo.status !== "completed" && wo.status !== "canceled";
    rows.push(
      row(
        "Agenda",
        `<b>${escapeHtml(dated ? J.dateRange(wo) : "Sem data")}</b>`,
        escapeHtml(H.whenSub(wo)),
        canManage && open ? act("schedule", dated ? "Remarcar" : "Agendar") : "",
      ),
    );
    if (!isField || teamLabel(wo) !== "Sem equipe") {
      rows.push(row("Equipe", `<b>${escapeHtml(teamLabel(wo))}</b>`, "", canManage ? act("team", "Gerir") : ""));
    }
    const b = canBill ? wo.billing : null;
    if (b) {
      const m = H.moneySummary(b);
      const primaryIsInvoice = H.primary(wo, headerCtx())?.act === "invoice";
      const action = H.canEmit(wo, headerCtx()) && !primaryIsInvoice ? act("invoice", "Emitir Invoice") : (wo.invoices || []).length ? act("bills", "Faturas") : "";
      rows.push(
        row(
          m.head.k,
          `<b class="jmx-fact__money">${escapeHtml(moneyFmt(m.head.v))}</b>`,
          escapeHtml(m.parts.join(" · ")),
          action,
          m.total > 0 ? `<i class="jh-bar" aria-hidden="true"><i class="p" style="width:${m.paidPct.toFixed(1)}%"></i><i class="o" style="width:${m.openPct.toFixed(1)}%"></i></i>` : "",
        ),
      );
    }
    $("jobMobFacts").innerHTML = rows.join("");
  }

  function renderAlerts(wo) {
    const box = $("jobMobAlerts");
    const html = window.JobHeader.alerts(wo, headerCtx());
    box.hidden = !html;
    box.innerHTML = html;
  }

  function renderMenu(wo) {
    if (isField) {
      $("jobMobMenu").innerHTML = "";
      return;
    }
    const id = encodeURIComponent(wo.id);
    const leading = [
      canManage ? `<button type="button" role="menuitem" data-jh-act="edit">Editar job</button>` : "",
      `<a role="menuitem" href="/campo/ticket.html?id=${id}">Abrir ticket da equipe</a>`,
      wo.quote_id && can("quotes.view") ? `<a role="menuitem" href="quote-builder.html?id=${encodeURIComponent(wo.quote_id)}">Abrir orçamento${wo.quote_number ? ` ${escapeHtml(wo.quote_number)}` : ""}</a>` : "",
      can("finance.manage") ? `<a role="menuitem" href="finance.html?new=cost&job=${id}">Lançar custo</a>` : "",
    ].join("");
    $("jobMobMenu").innerHTML = window.JobHeader.menu(wo, headerCtx(), leading);
  }

  function restoreVisitCta() {
    const wo = job;
    const cta = $("jobMobCta");
    const sec = $("jobMobCtaSecondary");
    if (!cta || !wo) return;
    if (sec) {
      sec.hidden = true;
      sec.dataset.action = "";
    }
    // Same next step as the desktop header.
    const next = window.JobHeader.primary(wo, headerCtx());
    if (next) {
      cta.textContent = next.label;
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = next.href ? "href" : next.act;
      cta.dataset.href = next.href || "";
      // Late and never started: it may already be done.
      if (next.act === "start" && window.JobsInfo?.late?.(wo) && sec) {
        sec.hidden = false;
        sec.textContent = "Já concluído";
        sec.className = "jcm-foot__btn jcm-foot__btn--ghost";
        sec.dataset.action = "complete";
      }
    } else if (canManage && wo.status === "completed") {
      cta.textContent = "Editar";
      cta.className = "jcm-foot__btn jcm-foot__btn--ghost";
      cta.dataset.action = "edit";
    } else if (wo.status === "completed") {
      cta.textContent = "Ver na agenda";
      cta.className = "jcm-foot__btn jcm-foot__btn--ghost";
      cta.dataset.action = "schedule";
    } else if (!canManage && (wo.status === "draft" || wo.status === "scheduled" || wo.status === "in_progress")) {
      cta.textContent = wo.status === "in_progress" ? "Abrir no Campo" : "Iniciar no Campo";
      cta.className = "jcm-foot__btn jcm-foot__btn--primary";
      cta.dataset.action = "campo";
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

  async function finishMobJob() {
    const J = window.JobsInfo;
    const nxt = J?.nextFinish?.(job);
    const label = job?.title || (J && job ? J.client(job) : "");
    const ok = await window.crmConfirm.completeJob(label, nxt);
    if (!ok) return;
    await setStatus("completed");
    window.crmToast?.success?.(nxt?.toast || "Job concluído");
  }

  async function applyMobStep(idx) {
    if (!canManage || !job || job.status === "canceled" || Number.isNaN(idx)) return;
    const J = window.JobsInfo;
    const status = J?.statusForStep?.(idx);
    if (status) {
      if (status === "completed" || (status === "in_progress" && job.status === "in_progress" && J?.nextFinish?.(job))) {
        await finishMobJob();
        return;
      }
      if (J.atStatus(job, status)) return;
      await setStatus(status);
      window.crmToast?.success?.(J.STATUS_STEP_MSG?.[status] || "Status atualizado.");
      return;
    }
    if (idx === 3 && canBill && window.JobBilling) {
      window.JobBilling.openDialog({ jobId, billing: job.billing, jobStatus: job.status });
      return;
    }
    if (idx === 4) window.crmToast?.info?.("Registre o pagamento nas faturas do job.");
  }

  async function deleteMobJob() {
    const ok = await window.crmConfirm({ title: "Excluir este job?", text: "Ele será cancelado e sairá da agenda.", ok: "Excluir job", danger: true });
    if (!ok) return;
    const r = await fetch(`/api/work-orders/${jobId}`, { method: "DELETE", credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || "Não foi possível excluir o job.");
    window.crmToast?.success?.("Job excluído.");
    location.href = "jobs.html";
  }

  /** The header warns about field problems; loading them never holds up the screen. */
  async function loadFieldSummary() {
    try {
      const r = await fetch(`/api/work-orders/${encodeURIComponent(jobId)}/field`, { credentials: "include" });
      const j = await r.json();
      if (j?.data) {
        field = j.data;
        checklistEnabled = field.checklist_enabled !== false;
        renderAlerts(job);
        document.querySelector('[data-jd-tab="checklist"]')?.toggleAttribute("hidden", !checklistEnabled);
      }
    } catch (_) {}
  }

  function bind() {
    window.JobHeader.bind($("jobMobMenu"), {
      act: async (name) => {
        try {
          if (name === "edit") await window.__crmJobModal.openEdit(jobId);
          else if (name === "lixa") await window.__crmJobModal.openScheduleLixa(job);
          else if (name === "delete") await deleteMobJob();
        } catch (err) {
          window.crmToast?.error?.(err.message || "Erro");
        }
      },
      status: (k) => {
        if (k === job.status) return;
        setStatus(k)
          .then(() => window.crmToast?.success?.("Status atualizado."))
          .catch((err) => window.crmToast?.error?.(err.message || "Erro"));
      },
    });
    $("jobMobFacts").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mob-fact]");
      if (!b || !job) return;
      const name = b.getAttribute("data-mob-fact");
      if (name === "invoice") {
        window.JobBilling.openDialog({ jobId, billing: job.billing, jobStatus: job.status });
      } else if (name === "bills") {
        detTab = "geral";
        render();
        setTimeout(() => $("jobMobBillingCard")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      } else {
        window.__crmJobModal.openEdit(jobId, { section: name }).catch((err) => window.crmToast?.error?.(err.message || "Erro"));
      }
    });
    $("jobMobChatQuick").addEventListener("click", (e) => {
      e.preventDefault();
      const link = e.currentTarget;
      if (link.getAttribute("aria-busy") === "true") return;
      link.setAttribute("aria-busy", "true");
      window.JobChatComms.openJobChannel(jobId)
        .catch((err) => window.crmToast?.error?.(err.message || "Não foi possível abrir o canal."))
        .finally(() => link.removeAttribute("aria-busy"));
    });
    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        detTab = btn.getAttribute("data-jd-tab") || "geral";
        render();
      });
    });
    $("jobMobExtra")?.addEventListener("click", (e) => {
      const ph = e.target.closest("[data-mob-photo]");
      if (ph && window.CamViewer) {
        e.preventDefault();
        const wo = job || {};
        window.CamViewer.open({
          photos: mediaList.map((m) => ({
            id: m.legacy ? null : m.id, url: m.url, thumb_url: m.thumb_url, stage: m.stage, created_at: m.created_at, taken_at_device: m.taken_at_device,
            author: m.author_name, device: m.device_label, caption: m.caption, uploaded_by_name: m.uploaded_by_name, taken_by_name: m.taken_by_name, taken_at_source: m.taken_at_source, location_source: m.location_source, camera_model: m.camera_model, annotations: m.annotations, sticker_ids: m.sticker_ids || [], address: m.address || wo.address, lat: m.lat, lng: m.lng,
            location_available: m.location_available, distance_m: m.distance_m, far_from_job: m.far_from_job, in_portfolio: m.in_portfolio,
            job: { number: wo.number, title: wo.title || clientLabel(wo), client: clientLabel(wo) },
          })),
          index: Number(ph.getAttribute("data-mob-photo")) || 0,
          // Managers edit from the phone job page too.
          ...(canManage && window.CamViewer.jobEditing
            ? window.CamViewer.jobEditing(jobId, (row) => {
                mediaList = mediaList.map((x) => (x.id === row.id ? { ...x, ...row } : x));
              })
            : {}),
        });
        return;
      }
      const edit = e.target.closest("[data-mob-edit]");
      if (!edit) return;
      window.__crmJobModal.openEdit(jobId, { section: edit.getAttribute("data-mob-edit") }).catch((err) => window.crmToast?.error?.(err.message || "Erro"));
    });
    async function runMobCta(action) {
      if (!action) return;
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
        if (action === "href") {
          location.href = $("jobMobCta").dataset.href;
          return;
        }
        if (action === "services") {
          await window.__crmJobModal.openEdit(jobId, { section: "services" });
          return;
        }
        if (action === "campo") {
          location.href = `campo/ticket.html?id=${encodeURIComponent(jobId)}`;
          return;
        }
        if (action === "stain") {
          location.href = `campo/stain.html?id=${encodeURIComponent(jobId)}`;
          return;
        }
        if (action === "comms-channel") {
          if (window.JobChatComms) {
            await window.JobChatComms.openJobChannel(jobId);
          }
          return;
        }
        if (action === "edit") {
          if (window.__crmJobModal?.openEdit) window.__crmJobModal.openEdit(jobId);
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
          await finishMobJob();
        } else if (action === "schedule") {
          location.href = "schedule.html";
        }
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro");
      }
    }
    $("jobMobCta")?.addEventListener("click", () => runMobCta($("jobMobCta").dataset.action));
    $("jobMobCtaSecondary")?.addEventListener("click", () => runMobCta($("jobMobCtaSecondary").dataset.action));
    $("jobMobSteps")?.addEventListener("click", (e) => {
      const stepEl = e.target.closest("[data-mob-step]");
      if (!stepEl) return;
      e.preventDefault();
      applyMobStep(Number(stepEl.getAttribute("data-mob-step"))).catch((err) =>
        window.crmToast?.error?.(err.message || "Erro"),
      );
    });
    $("jobMobSteps")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const stepEl = e.target.closest("[data-mob-step]");
      if (!stepEl) return;
      e.preventDefault();
      applyMobStep(Number(stepEl.getAttribute("data-mob-step"))).catch((err) =>
        window.crmToast?.error?.(err.message || "Erro"),
      );
    });
    $("jobMobPhotosQuick")?.addEventListener("click", (e) => {
      e.preventDefault();
      detTab = "fotos";
      render();
      document.querySelector("[data-jd-tab='fotos']")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!$("jobMobRoot")) return;
    jobId = String(new URLSearchParams(location.search).get("id") || "")
      .replace(/:(sand|installation|main)$/i, "")
      .trim();
    if (!jobId) return;
    if ((location.hash || "") === "#fotos") detTab = "fotos";
    // A barra fixa fica no body: dentro do main (que pode ter transform) ela não gruda no rodapé.
    const foot = $("jobMobFoot");
    if (foot && foot.parentElement !== document.body) document.body.appendChild(foot);
    try {
      const s = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json());
      if (!s.authenticated) return;
      const roleName = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      sessionPerms = perms;
      sessionRole = roleName;
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
      loadFieldSummary();
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
