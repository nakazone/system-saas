/**
 * Campo · Ticket — status, checklist, job media (photo proof)
 */
(function () {
  const VER = "20260928-media5";
  const $ = (id) => document.getElementById(id);
  const STAGE_LABEL = { before: "Antes", during: "Durante", after: "Depois" };

  let jobId = null;
  let ticket = null;
  let tab = "details";
  let photoStage = "";
  let pendingCount = 0;
  let latestReport = null;
  let annotMediaId = null;
  let annotShapes = [];
  let annotTool = "freehand";
  let annotDrawing = null;
  let inspectRec = null;
  let inspectChunks = [];
  let inspectStartedAt = null;
  let inspectMarks = [];

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mapsUrl(address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(address || "")}`;
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...opts,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  function toast(msg, type) {
    if (window.crmToast?.show) window.crmToast.show(msg, { type: type || "error" });
    else if (type !== "success") alert(msg);
  }

  function deviceLabel() {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad/i.test(ua)) return "iOS Safari";
    if (/Android/i.test(ua)) return "Android Chrome";
    return (navigator.platform || "Web").slice(0, 80);
  }

  function getGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            gpsAccuracyM: pos.coords.accuracy,
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    });
  }

  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
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
            reject(new Error("Canvas unavailable"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Falha ao processar imagem"));
      };
      img.src = url;
    });
  }

  async function fileToUploadDataUrl(file) {
    if (!file.type || !file.type.startsWith("image/")) {
      throw new Error("Selecione uma imagem");
    }
    try {
      return await compressImage(file, 1920, 0.82);
    } catch (_) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Falha ao ler imagem"));
        reader.readAsDataURL(file);
      });
    }
  }

  function renderHero() {
    const t = ticket;
    $("cmTicketTitle").textContent = `Ticket #${t.number ?? "—"}`;
    $("cmTicketWhen").textContent = t.when_label || "—";
    $("cmTicketBadge").textContent = t.field_status_label || "—";
    $("cmTicketJob").textContent = t.title || "—";
    const sqft =
      t.sqft_total > 0
        ? ` · ${Number(t.sqft_total).toLocaleString("en-US")} sq ft`
        : "";
    $("cmTicketSub").textContent = `${t.client || "—"}${sqft}`;
    $("cmTicketAddr").textContent = t.address || "Sem endereço";
    const nav = $("cmTicketNav");
    if (t.address) {
      nav.href = mapsUrl(t.address);
      nav.style.pointerEvents = "";
    } else {
      nav.removeAttribute("href");
      nav.style.pointerEvents = "none";
    }

    $("cmStepper").innerHTML = (t.stepper || [])
      .map(
        (s) => `
      <div class="cm-stepper__item${s.active ? " is-active" : ""}${s.done && !s.active ? " is-done" : ""}">
        <span class="cm-stepper__bar"></span>
        <span class="cm-stepper__label">${escapeHtml(s.label)}</span>
      </div>`,
      )
      .join("");

    const cta = $("cmTicketCta");
    const wrap = $("cmTicketCtaWrap");
    if (t.cta_label) {
      wrap.hidden = false;
      cta.textContent = t.cta_label;
      cta.disabled = false;
    } else {
      wrap.hidden = false;
      cta.textContent = "Visita concluída";
      cta.disabled = true;
    }
  }

  function renderDetails() {
    const t = ticket;
    const att = $("cmAttention");
    if (t.attention) {
      att.hidden = false;
      $("cmAttentionText").textContent = t.attention;
    } else {
      att.hidden = true;
    }

    const total = t.sqft_total > 0 ? `${Number(t.sqft_total).toLocaleString("en-US")} sq ft` : "—";
    $("cmScopeTotal").textContent = total;
    const scope = t.scope || [];
    if (!scope.length) {
      $("cmScopeList").innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0 0">Sem linhas de escopo.</p>';
    } else {
      $("cmScopeList").innerHTML = scope
        .map(
          (s) => `
        <div class="cm-scope__row">
          <span>${escapeHtml(s.name)}</span>
          <span>${Number(s.sqft || 0).toLocaleString("en-US")} sq ft</span>
        </div>`,
        )
        .join("");
    }

    const notes = $("cmNotes");
    if (t.notes && !t.attention) {
      notes.hidden = false;
      notes.textContent = t.notes;
    } else {
      notes.hidden = true;
    }
  }

  function renderChecklist() {
    const t = ticket;
    const done = t.checklist_done || 0;
    const total = t.checklist_total || 0;
    $("cmCheckCount").textContent = `${done} de ${total}`;
    $("cmTabChecklist").textContent = `Checklist ${done}/${total}`;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $("cmCheckBarFill").style.width = `${pct}%`;

    $("cmCheckList").innerHTML = (t.checklist || [])
      .map((item) => {
        const needPhoto = item.photo_required;
        const photoCount = (item.photo_media_ids || []).length;
        const meta = [
          needPhoto ? (photoCount ? `${photoCount} foto(s)` : "foto obrigatória") : null,
          item.done_by ? `por ${item.done_by}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return `
      <div class="cm-check-item${item.done ? " is-done" : ""}" data-check-wrap="${escapeHtml(item.id)}">
        <button type="button" class="cm-check-item__main" data-check-id="${escapeHtml(item.id)}" style="display:flex;gap:0.65rem;align-items:flex-start;width:100%;border:0;background:transparent;padding:0;text-align:left;cursor:pointer">
          <span class="cm-check-item__box" aria-hidden="true">${item.done ? "✓" : ""}</span>
          <span class="cm-check-item__text">
            ${escapeHtml(item.text)}
            ${meta ? `<span class="cm-check-item__meta">${escapeHtml(meta)}</span>` : ""}
          </span>
        </button>
        ${
          needPhoto && !item.done
            ? `<button type="button" class="cm-check-item__photo" data-attach-check="${escapeHtml(item.id)}">Anexar última foto</button>`
            : ""
        }
      </div>`;
      })
      .join("");
  }

  function updatePendingUi(rows) {
    const mine = (rows || []).filter((r) => r.jobId === jobId);
    pendingCount = mine.length;
    const el = $("cmPhotosPending");
    if (!el) return;
    if (!pendingCount) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent =
      pendingCount === 1
        ? "1 foto pendente de envio (offline). Será enviada ao reconectar."
        : `${pendingCount} fotos pendentes de envio (offline). Serão enviadas ao reconectar.`;
  }

  function renderReportCard() {
    const card = $("cmReportCard");
    const btn = $("cmPhotoReportBtn");
    if (btn) {
      btn.hidden = ticket?.job_media_ai_enabled === false;
      btn.disabled = !(ticket?.photos || []).some((p) => !p.legacy);
    }
    if (!card) return;
    if (!latestReport) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    $("cmReportTitle").textContent = latestReport.title || "Relatório";
    $("cmReportSummary").textContent = latestReport.summary || "Rascunho gerado.";
  }

  function renderPhotos() {
    const t = ticket;
    const total = (t.photos_count || 0) + pendingCount;
    $("cmTabPhotos").textContent = `Fotos · ${total}`;
    const grid = $("cmPhotosGrid");
    const photos = t.photos || [];
    renderReportCard();
    if (!photos.length) {
      grid.innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0">Nenhuma foto ainda.</p>';
      return;
    }
    grid.innerHTML = photos
      .map((p) => {
        const stage = p.stage && STAGE_LABEL[p.stage] ? STAGE_LABEL[p.stage] : "";
        const cap = p.caption ? escapeHtml(p.caption) : "";
        const gps = p.location_available ? " · GPS" : "";
        const pub = p.is_public ? " · público" : "";
        const meta = [cap, stage].filter(Boolean).join(" · ") || "Foto da obra";
        return `
      <button type="button" class="cm-photo" data-media-id="${escapeHtml(p.id || "")}" ${p.legacy ? "data-legacy=1" : ""}>
        ${stage ? `<span class="cm-photo__badge">${escapeHtml(stage)}</span>` : ""}
        <img src="${escapeHtml(p.thumb_url || p.url)}" alt="${escapeHtml(meta)}" loading="lazy" />
        <span class="cm-photo__meta">${escapeHtml(meta)}${gps}${pub}</span>
      </button>`;
      })
      .join("");
  }

  function renderAll() {
    renderHero();
    renderDetails();
    renderChecklist();
    renderPhotos();
    showTab(tab);
  }

  function showTab(name) {
    tab = name;
    document.querySelectorAll(".cm-ticket-tabs__btn").forEach((btn) => {
      const on = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".cm-ticket-panel").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
  }

  function apply(data) {
    ticket = data;
    renderAll();
  }

  function openProblem() {
    $("cmProblemNote").value = ticket?.problem_note || "";
    $("cmProblemBackdrop").hidden = false;
    $("cmProblemSheet").hidden = false;
    document.body.classList.add("cm-sheet-open");
  }

  function closeProblem() {
    $("cmProblemBackdrop").hidden = true;
    $("cmProblemSheet").hidden = true;
    document.body.classList.remove("cm-sheet-open");
  }

  async function postPhotoPayload(row) {
    const body = {
      data_url: row.dataUrl,
      stage: row.stage || null,
      caption: row.caption || null,
      taken_at_device: row.takenAtDevice,
      lat: row.lat,
      lng: row.lng,
      gps_accuracy_m: row.gpsAccuracyM,
      address: row.address || null,
      client_upload_id: row.id,
      device_label: row.deviceLabel || deviceLabel(),
      is_public: Boolean(row.isPublic),
    };
    const json = await api(`/api/campo/jobs/${jobId}/photos`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return json.data;
  }

  async function flushQueue() {
    const q = window.__campoMediaQueue;
    if (!q || !jobId) return;
    if (!navigator.onLine) return;
    const results = await q.flush(jobId, postPhotoPayload);
    const ok = results.filter((r) => r.ok);
    if (ok.length) {
      const last = ok[ok.length - 1];
      if (last.data) apply(last.data);
      else {
        const json = await api(`/api/campo/jobs/${encodeURIComponent(jobId)}`);
        apply(json.data);
      }
      toast(
        ok.length === 1 ? "Foto pendente enviada" : `${ok.length} fotos pendentes enviadas`,
        "success",
      );
    }
  }

  async function uploadOrQueue(file) {
    if (ticket && ticket.job_media_enabled === false) {
      toast("Fotos desativadas para esta organização");
      return;
    }
    const dataUrl = await fileToUploadDataUrl(file);
    const gps = await getGps();
    const caption = ($("cmPhotoCaption")?.value || "").trim() || null;
    const isPublic = Boolean($("cmPhotoPublic")?.checked);
    const payload = {
      jobId,
      dataUrl,
      stage: photoStage || null,
      caption,
      takenAtDevice: new Date().toISOString(),
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      gpsAccuracyM: gps?.gpsAccuracyM ?? null,
      address: ticket?.address || null,
      deviceLabel: deviceLabel(),
      isPublic,
    };

    showTab("photos");

    if (!navigator.onLine && window.__campoMediaQueue) {
      await window.__campoMediaQueue.enqueue(payload);
      toast("Sem rede — foto guardada para enviar depois", "success");
      return;
    }

    try {
      const beforeIds = new Set((ticket?.photos || []).map((p) => p.id));
      const clientId =
        window.crypto && crypto.randomUUID ? crypto.randomUUID() : `u-${Date.now()}`;
      const data = await postPhotoPayload({ ...payload, id: clientId });
      apply(data);
      if (inspectRec && inspectStartedAt) {
        const added = (data.photos || []).find((p) => !beforeIds.has(p.id) && !p.legacy);
        if (added?.id) {
          inspectMarks.push({
            media_id: added.id,
            offset_ms: Math.max(0, Date.now() - inspectStartedAt),
            note: caption,
          });
          updateInspectUi();
        }
      }
      if ($("cmPhotoCaption")) $("cmPhotoCaption").value = "";
      toast("Foto enviada", "success");
    } catch (err) {
      if (window.__campoMediaQueue) {
        await window.__campoMediaQueue.enqueue(payload);
        toast("Upload falhou — foto na fila offline", "success");
      } else {
        toast(err.message || "Falha no upload");
      }
    }
  }

  function voiceCaptionOnDevice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error("Speech recognition not supported on this browser"));
    return new Promise((resolve, reject) => {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      let done = false;
      rec.onresult = (ev) => {
        done = true;
        const text = ev.results?.[0]?.[0]?.transcript || "";
        resolve(String(text).trim());
      };
      rec.onerror = (ev) => {
        if (done) return;
        reject(new Error(ev.error || "Speech failed"));
      };
      rec.onend = () => {
        if (!done) reject(new Error("No speech captured"));
      };
      toast("Fale agora…", "success");
      rec.start();
    });
  }

  async function onPhotoActions(mediaId) {
    if (!mediaId || !ticket) return;
    const photo = (ticket.photos || []).find((p) => p.id === mediaId);
    if (!photo || photo.legacy) {
      if (photo?.url) window.open(photo.url, "_blank", "noopener");
      return;
    }
    const choice = window.prompt(
      "Ações: abrir | anotar | ocr | legenda | voz | público | privado | apagar\nEscreva a ação:",
      "abrir",
    );
    if (!choice) return;
    const action = choice.trim().toLowerCase();
    try {
      if (action === "abrir" || action === "open") {
        window.open(photo.url, "_blank", "noopener");
        return;
      }
      if (action === "anotar" || action === "annotate" || action === "draw") {
        openAnnotator(photo);
        return;
      }
      if (action === "ocr" || action === "serial" || action === "etiqueta") {
        toast("A ler etiqueta…", "success");
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}/ocr`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        apply(json.data);
        const o = json.meta?.ocr;
        toast(
          o?.serial_number || o?.label_text || "OCR concluído",
          "success",
        );
        return;
      }
      if (action === "voz" || action === "voice" || action === "speak") {
        const text = await voiceCaptionOnDevice();
        if (!text) {
          toast("Nada reconhecido");
          return;
        }
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ caption: text }),
        });
        apply(json.data);
        toast("Legenda por voz aplicada", "success");
        return;
      }
      if (action === "apagar" || action === "delete" || action === "remover") {
        if (!confirm("Apagar esta foto?")) return;
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "DELETE",
        });
        apply(json.data);
        toast("Foto apagada", "success");
        return;
      }
      if (action === "público" || action === "publico" || action === "public") {
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_public: true }),
        });
        apply(json.data);
        toast("Visível no link público", "success");
        return;
      }
      if (action === "privado" || action === "private") {
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_public: false }),
        });
        apply(json.data);
        toast("Removida do link público", "success");
        return;
      }
      if (action === "legenda" || action === "caption") {
        const next = window.prompt("Legenda", photo.caption || "");
        if (next == null) return;
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ caption: next.trim() || null }),
        });
        apply(json.data);
        toast("Legenda atualizada", "success");
        return;
      }
      toast("Ação desconhecida");
    } catch (err) {
      toast(err.message || "Falha na ação");
    }
  }

  async function generateReport() {
    if (!ticket?.job_media_ai_enabled) {
      toast("IA não configurada no servidor");
      return;
    }
    const btn = $("cmPhotoReportBtn");
    if (btn) btn.disabled = true;
    try {
      toast("A gerar relatório…", "success");
      const json = await api(`/api/campo/jobs/${jobId}/reports/generate`, {
        method: "POST",
        body: JSON.stringify({ template_key: "site_visit" }),
      });
      latestReport = json.data;
      renderReportCard();
      toast("Relatório rascunho pronto", "success");
    } catch (err) {
      toast(err.message || "Falha ao gerar relatório");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function updateInspectUi() {
    const el = $("cmInspectStatus");
    const btn = $("cmInspectBtn");
    if (!el || !btn) return;
    if (!inspectRec) {
      el.hidden = true;
      el.textContent = "";
      btn.textContent = "Vistoria falada";
      return;
    }
    const secs = inspectStartedAt
      ? Math.floor((Date.now() - inspectStartedAt) / 1000)
      : 0;
    el.hidden = false;
    el.textContent = `A gravar vistoria · ${secs}s · ${inspectMarks.length} marca(s) · toque no botão para parar`;
    btn.textContent = "Parar vistoria";
  }

  async function toggleInspection() {
    if (inspectRec) {
      await stopInspection();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("Gravação de áudio não suportada neste browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inspectChunks = [];
      inspectMarks = [];
      inspectStartedAt = Date.now();
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      inspectRec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      inspectRec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) inspectChunks.push(ev.data);
      };
      inspectRec.start(1000);
      updateInspectUi();
      toast("Vistoria a gravar — tire fotos para marcar no áudio", "success");
      const tick = setInterval(() => {
        if (!inspectRec) {
          clearInterval(tick);
          return;
        }
        updateInspectUi();
      }, 1000);
      inspectRec._tick = tick;
    } catch (err) {
      toast(err.message || "Microfone negado");
      inspectRec = null;
      updateInspectUi();
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha a ler áudio"));
      reader.readAsDataURL(blob);
    });
  }

  async function stopInspection() {
    if (!inspectRec) return;
    const rec = inspectRec;
    const started = inspectStartedAt;
    const marks = inspectMarks.slice();
    if (rec._tick) clearInterval(rec._tick);

    const blob = await new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        resolve(new Blob(inspectChunks, { type }));
      };
      try {
        rec.stop();
      } catch (_) {
        resolve(new Blob(inspectChunks, { type: "audio/webm" }));
      }
      try {
        rec.stream?.getTracks?.().forEach((t) => t.stop());
      } catch (_) {}
    });

    inspectRec = null;
    inspectChunks = [];
    inspectStartedAt = null;
    inspectMarks = [];
    updateInspectUi();

    if (!blob || blob.size < 200) {
      toast("Áudio demasiado curto");
      return;
    }

    try {
      toast("A enviar vistoria…", "success");
      const dataUrl = await blobToDataUrl(blob);
      const ended = Date.now();
      await api(`/api/campo/jobs/${jobId}/inspections`, {
        method: "POST",
        body: JSON.stringify({
          audio_data_url: dataUrl,
          started_at_device: started ? new Date(started).toISOString() : null,
          ended_at_device: new Date(ended).toISOString(),
          duration_ms: started ? ended - started : null,
          marks,
        }),
      });
      toast(
        marks.length
          ? `Vistoria guardada (${marks.length} marca${marks.length === 1 ? "" : "s"})`
          : "Vistoria guardada",
        "success",
      );
    } catch (err) {
      toast(err.message || "Falha ao guardar vistoria");
    }
  }

  async function addMeasurement() {
    const label = window.prompt("Área / divisão", "Living room");
    if (!label || !label.trim()) return;
    const raw = window.prompt("Área em sqft", "");
    if (raw == null) return;
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast("Valor inválido");
      return;
    }
    try {
      await api(`/api/campo/jobs/${jobId}/measurements`, {
        method: "POST",
        body: JSON.stringify({
          label: label.trim().slice(0, 120),
          kind: "area_sqft",
          value,
          unit: "sqft",
          source: "manual",
        }),
      });
      toast("Medição guardada", "success");
    } catch (err) {
      toast(err.message || "Medições desativadas ou falha");
    }
  }

  async function loadLatestReport() {
    try {
      const json = await api(`/api/campo/jobs/${encodeURIComponent(jobId)}/reports`);
      latestReport = (json.data || [])[0] || null;
      renderReportCard();
    } catch (_) {
      latestReport = null;
    }
  }

  function annotCanvas() {
    return $("cmAnnotCanvas");
  }

  function redrawAnnotations() {
    const canvas = annotCanvas();
    const img = $("cmAnnotImg");
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    for (const s of annotShapes) {
      ctx.strokeStyle = s.color || "#ff3b30";
      ctx.fillStyle = s.color || "#ff3b30";
      ctx.lineWidth = s.width || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (s.type === "freehand" && Array.isArray(s.points)) {
        ctx.beginPath();
        for (let i = 0; i < s.points.length; i += 2) {
          const x = s.points[i] * w;
          const y = s.points[i + 1] * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (s.type === "arrow") {
        const x1 = s.x1 * w;
        const y1 = s.y1 * h;
        const x2 = s.x2 * w;
        const y2 = s.y2 * h;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const ang = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 12 * Math.cos(ang - 0.4), y2 - 12 * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - 12 * Math.cos(ang + 0.4), y2 - 12 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
      } else if (s.type === "circle") {
        ctx.beginPath();
        ctx.arc(s.cx * w, s.cy * h, s.r * Math.min(w, h), 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.type === "text") {
        ctx.font = `${s.size || 16}px sans-serif`;
        ctx.fillText(s.text || "", s.x * w, s.y * h);
      }
    }
  }

  function openAnnotator(photo) {
    annotMediaId = photo.id;
    const doc = photo.annotations && typeof photo.annotations === "object" ? photo.annotations : {};
    annotShapes = Array.isArray(doc.shapes) ? JSON.parse(JSON.stringify(doc.shapes)) : [];
    annotTool = "freehand";
    document.querySelectorAll("[data-annot-tool]").forEach((b) => {
      b.classList.toggle("is-selected", b.getAttribute("data-annot-tool") === annotTool);
    });
    $("cmAnnotImg").onload = () => redrawAnnotations();
    $("cmAnnotImg").src = photo.url;
    $("cmAnnotBackdrop").hidden = false;
    $("cmAnnotSheet").hidden = false;
    document.body.classList.add("cm-sheet-open");
    setTimeout(redrawAnnotations, 50);
  }

  function closeAnnotator() {
    $("cmAnnotBackdrop").hidden = true;
    $("cmAnnotSheet").hidden = true;
    document.body.classList.remove("cm-sheet-open");
    annotMediaId = null;
    annotDrawing = null;
  }

  function pointerNorm(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - rect.left) / rect.width,
      y: (t.clientY - rect.top) / rect.height,
    };
  }

  function bindAnnotator() {
    const canvas = annotCanvas();
    if (!canvas) return;

    document.querySelectorAll("[data-annot-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        annotTool = btn.getAttribute("data-annot-tool") || "freehand";
        document.querySelectorAll("[data-annot-tool]").forEach((b) => {
          b.classList.toggle("is-selected", b === btn);
        });
      });
    });
    $("cmAnnotUndo")?.addEventListener("click", () => {
      annotShapes.pop();
      redrawAnnotations();
    });
    $("cmAnnotClose")?.addEventListener("click", closeAnnotator);
    $("cmAnnotBackdrop")?.addEventListener("click", closeAnnotator);
    $("cmAnnotSave")?.addEventListener("click", async () => {
      if (!annotMediaId) return;
      try {
        const json = await api(`/api/campo/jobs/${jobId}/media/${annotMediaId}`, {
          method: "PATCH",
          body: JSON.stringify({
            annotations: { version: 1, shapes: annotShapes, updated_at: new Date().toISOString() },
          }),
        });
        apply(json.data);
        closeAnnotator();
        toast("Anotações guardadas", "success");
      } catch (err) {
        toast(err.message || "Falha ao guardar");
      }
    });

    const onStart = (e) => {
      e.preventDefault();
      const p = pointerNorm(e, canvas);
      if (annotTool === "text") {
        const text = window.prompt("Texto na foto", "");
        if (!text) return;
        annotShapes.push({
          id: `t-${Date.now()}`,
          type: "text",
          color: "#ff3b30",
          x: p.x,
          y: p.y,
          text,
          size: 16,
        });
        redrawAnnotations();
        return;
      }
      annotDrawing = { tool: annotTool, start: p, points: [p.x, p.y] };
    };
    const onMove = (e) => {
      if (!annotDrawing) return;
      e.preventDefault();
      const p = pointerNorm(e, canvas);
      if (annotDrawing.tool === "freehand") {
        annotDrawing.points.push(p.x, p.y);
        const tmp = {
          id: "tmp",
          type: "freehand",
          color: "#ff3b30",
          width: 3,
          points: annotDrawing.points,
        };
        const keep = annotShapes.slice();
        annotShapes = keep.concat([tmp]);
        redrawAnnotations();
        annotShapes = keep;
      } else {
        annotDrawing.current = p;
        const keep = annotShapes.slice();
        let tmp;
        if (annotDrawing.tool === "arrow") {
          tmp = {
            id: "tmp",
            type: "arrow",
            color: "#ff3b30",
            width: 3,
            x1: annotDrawing.start.x,
            y1: annotDrawing.start.y,
            x2: p.x,
            y2: p.y,
          };
        } else {
          const dx = p.x - annotDrawing.start.x;
          const dy = p.y - annotDrawing.start.y;
          tmp = {
            id: "tmp",
            type: "circle",
            color: "#ff3b30",
            width: 3,
            cx: annotDrawing.start.x,
            cy: annotDrawing.start.y,
            r: Math.sqrt(dx * dx + dy * dy),
          };
        }
        annotShapes = keep.concat([tmp]);
        redrawAnnotations();
        annotShapes = keep;
      }
    };
    const onEnd = (e) => {
      if (!annotDrawing) return;
      e.preventDefault();
      const p = annotDrawing.current || pointerNorm(e.changedTouches ? e.changedTouches[0] : e, canvas);
      if (annotDrawing.tool === "freehand") {
        annotShapes.push({
          id: `f-${Date.now()}`,
          type: "freehand",
          color: "#ff3b30",
          width: 3,
          points: annotDrawing.points,
        });
      } else if (annotDrawing.tool === "arrow") {
        annotShapes.push({
          id: `a-${Date.now()}`,
          type: "arrow",
          color: "#ff3b30",
          width: 3,
          x1: annotDrawing.start.x,
          y1: annotDrawing.start.y,
          x2: p.x,
          y2: p.y,
        });
      } else if (annotDrawing.tool === "circle") {
        const dx = p.x - annotDrawing.start.x;
        const dy = p.y - annotDrawing.start.y;
        annotShapes.push({
          id: `c-${Date.now()}`,
          type: "circle",
          color: "#ff3b30",
          width: 3,
          cx: annotDrawing.start.x,
          cy: annotDrawing.start.y,
          r: Math.sqrt(dx * dx + dy * dy),
        });
      }
      annotDrawing = null;
      redrawAnnotations();
    };

    canvas.addEventListener("mousedown", onStart);
    canvas.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd, { passive: false });
  }

  async function applyTemplate() {
    try {
      const json = await api(`/api/campo/jobs/${jobId}/checklist/templates`);
      const list = json.data || [];
      const labels = list.map((t, i) => `${i + 1}) ${t.name}`).join("\n");
      const pick = window.prompt(`Escolha o template:\n${labels}`, "1");
      if (!pick) return;
      const idx = Number(pick) - 1;
      const tpl = list[idx];
      if (!tpl) {
        toast("Template inválido");
        return;
      }
      if (!confirm(`Substituir checklist por “${tpl.name}”?`)) return;
      const res = await api(`/api/campo/jobs/${jobId}/checklist/from-template`, {
        method: "POST",
        body: JSON.stringify({ template_key: tpl.key }),
      });
      apply(res.data);
      toast("Checklist aplicado", "success");
    } catch (err) {
      toast(err.message || "Falha no template");
    }
  }

  async function proposeFromVoice() {
    try {
      let transcript = "";
      try {
        transcript = await voiceCaptionOnDevice();
      } catch (_) {
        transcript = window.prompt("Digite os itens (separados por vírgula)", "") || "";
      }
      if (!transcript) return;
      toast("A propor checklist…", "success");
      const json = await api(`/api/campo/jobs/${jobId}/checklist/propose`, {
        method: "POST",
        body: JSON.stringify({ transcript }),
      });
      const items = json.data?.items || [];
      if (!items.length) {
        toast("Nenhum item proposto");
        return;
      }
      const preview = items.map((i) => `• ${i.text}${i.photo_required ? " (foto)" : ""}`).join("\n");
      if (!confirm(`Aplicar estes itens?\n\n${preview}`)) return;
      const res = await api(`/api/campo/jobs/${jobId}/checklist/apply`, {
        method: "POST",
        body: JSON.stringify({
          replace: false,
          items: items.map((i) => ({ text: i.text, photo_required: i.photo_required })),
        }),
      });
      apply(res.data);
      toast("Itens adicionados", "success");
    } catch (err) {
      toast(err.message || "Falha na proposta");
    }
  }

  async function showRecap() {
    try {
      const json = await api(`/api/campo/jobs/${jobId}/recap`);
      const d = json.data || {};
      const el = $("cmCheckRecap");
      if (!el) return;
      el.hidden = false;
      el.textContent = [
        d.photo_summary || "",
        d.pending?.length ? `Pending:\n- ${d.pending.join("\n- ")}` : "No pending checklist items",
        d.risks?.length ? `Risks:\n- ${d.risks.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch (err) {
      toast(err.message || "Falha no recap");
    }
  }

  function bind() {
    $("cmTicketBack")?.addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.href = "hoje.html";
    });

    document.querySelectorAll(".cm-ticket-tabs__btn").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.getAttribute("data-tab")));
    });

    document.querySelectorAll("[data-photo-stage]").forEach((btn) => {
      btn.addEventListener("click", () => {
        photoStage = btn.getAttribute("data-photo-stage") || "";
        document.querySelectorAll("[data-photo-stage]").forEach((b) => {
          b.classList.toggle("is-selected", b === btn);
        });
      });
    });

    $("cmTicketCta")?.addEventListener("click", async () => {
      if (!ticket?.next_status) return;
      try {
        const json = await api(`/api/campo/jobs/${jobId}/field-status`, {
          method: "POST",
          body: JSON.stringify({ advance: true }),
        });
        apply(json.data);
      } catch (err) {
        toast(err.message || "Falha ao atualizar status");
      }
    });

    $("cmCheckList")?.addEventListener("click", async (e) => {
      const attach = e.target.closest("[data-attach-check]");
      if (attach) {
        const id = attach.getAttribute("data-attach-check");
        const photos = (ticket.photos || []).filter((p) => !p.legacy);
        const last = photos[0];
        if (!last) {
          toast("Tire uma foto primeiro");
          return;
        }
        try {
          const item = (ticket.checklist || []).find((c) => c.id === id);
          const json = await api(`/api/campo/jobs/${jobId}/checklist`, {
            method: "PATCH",
            body: JSON.stringify({
              item_id: id,
              done: Boolean(item?.done),
              photo_media_id: last.id,
            }),
          });
          apply(json.data);
          toast("Foto anexada ao item", "success");
        } catch (err) {
          toast(err.message || "Falha ao anexar");
        }
        return;
      }
      const btn = e.target.closest("[data-check-id]");
      if (!btn) return;
      const id = btn.getAttribute("data-check-id");
      const item = (ticket.checklist || []).find((c) => c.id === id);
      if (!item) return;
      try {
        const json = await api(`/api/campo/jobs/${jobId}/checklist`, {
          method: "PATCH",
          body: JSON.stringify({ item_id: id, done: !item.done }),
        });
        apply(json.data);
      } catch (err) {
        toast(err.message || "Falha no checklist");
      }
    });

    $("cmCheckTemplateBtn")?.addEventListener("click", () => applyTemplate().catch(() => {}));
    $("cmCheckVoiceBtn")?.addEventListener("click", () => proposeFromVoice().catch(() => {}));
    $("cmCheckRecapBtn")?.addEventListener("click", () => showRecap().catch(() => {}));

    bindAnnotator();

    $("cmPhotoInput")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        await uploadOrQueue(file);
      } catch (err) {
        toast(err.message || "Falha no upload");
      }
    });

    $("cmPhotosGrid")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-media-id]");
      if (!btn) return;
      onPhotoActions(btn.getAttribute("data-media-id"));
    });

    $("cmPhotoReportBtn")?.addEventListener("click", () => {
      generateReport().catch(() => {});
    });
    $("cmInspectBtn")?.addEventListener("click", () => {
      toggleInspection().catch(() => {});
    });
    $("cmMeasureBtn")?.addEventListener("click", () => {
      addMeasurement().catch(() => {});
    });

    $("cmProblemBtn")?.addEventListener("click", openProblem);
    $("cmProblemClose")?.addEventListener("click", closeProblem);
    $("cmProblemBackdrop")?.addEventListener("click", closeProblem);
    $("cmProblemSubmit")?.addEventListener("click", async () => {
      const note = ($("cmProblemNote").value || "").trim();
      if (note.length < 2) {
        toast("Descreva o problema");
        return;
      }
      try {
        const json = await api(`/api/campo/jobs/${jobId}/problem`, {
          method: "POST",
          body: JSON.stringify({ note }),
        });
        apply(json.data);
        closeProblem();
      } catch (err) {
        toast(err.message || "Falha ao enviar");
      }
    });

    window.addEventListener("online", () => {
      flushQueue().catch(() => {});
    });

    if (window.__campoMediaQueue) {
      window.__campoMediaQueue.onChange(updatePendingUi);
    }
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    jobId = params.get("id");
    if (!jobId) {
      location.href = "hoje.html";
      return;
    }
    bind();
    try {
      const json = await api(`/api/campo/jobs/${encodeURIComponent(jobId)}`);
      apply(json.data);
      if (window.__campoMediaQueue) {
        const rows = await window.__campoMediaQueue.list();
        updatePendingUi(rows);
      }
      await loadLatestReport();
      await flushQueue();
    } catch (err) {
      toast(err.message || "Ticket não encontrado");
      setTimeout(() => {
        location.href = "hoje.html";
      }, 800);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoTicket = { VER };
})();
