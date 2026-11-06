/**
 * Campo · Ticket — status, checklist, job media (photo proof)
 */
(function () {
  const VER = "20261105-mg1";
  const $ = (id) => document.getElementById(id);
  const PHASE_LABEL = {
    delivery: "Delivery",
    scan: "Scan",
    installation: "Installation",
    sand_finish: "Sand & Finish",
    walkthrough: "Walk Through",
  };
  const PHASE_KEYS = Object.keys(PHASE_LABEL);
  /** Names of this job's phases: a trade's own (Tile, Countertops) when the job follows them, else Hardwood's. */
  function phaseLabels() {
    return (ticket && ticket.phase_mode === "phases" && ticket.phase_labels) || PHASE_LABEL;
  }

  let jobId = null;
  let ticket = null;
  let tab = "details";
  /** Phase for the next capture: "" = auto, else a phase key. */
  let photoPhase = "";
  /** Gallery filter: "all" or a phase key. */
  let phaseFilter = "all";
  let pendingCount = 0;
  /** Photos being prepared/sent right now: { key, previewUrl }. Shown as tiles so the crew sees the shot instantly. */
  const uploadsInFlight = [];
  let latestReport = null;
  let annotMediaId = null;
  let annotShapes = [];
  let annotTool = "freehand";
  let annotDrawing = null;
  let inspectRec = null;
  let inspectChunks = [];
  let inspectStartedAt = null;
  let inspectMarks = [];
  let lightboxIndex = -1;
  /** Item just ticked by this tap: its check plays the 160ms pop once on the next render. */
  let justChecked = null;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function appleMapsUrl(address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(address || "")}`;
  }
  function googleMapsUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || "")}`;
  }
  function mapsUrl(address) {
    return appleMapsUrl(address);
  }

  // Bottom sheets (#cmMapsLayer, #cmProblemLayer, #cmAnnotLayer): OmUI.layer gives Esc, focus trap and
  // return, Android back, the exit animation and drag-to-close by the grab. Without OmUI: plain show/hide.
  const layers = {};
  function sheetLayer(name) {
    const root = $(`cm${name}Layer`);
    if (!root) return null;
    if (!layers[name] && window.OmUI) {
      layers[name] = window.OmUI.layer(root, {
        onClose: () => onLayerClosed(name),
        dragHandle: root.querySelector(".cm-sheet__grab"),
        initialFocus: () => root.querySelector(".cm-sheet__close"),
      });
    }
    return layers[name] || null;
  }
  function showLayer(name) {
    document.body.classList.add("cm-sheet-open");
    const l = sheetLayer(name);
    if (l) l.open();
    else if ($(`cm${name}Layer`)) $(`cm${name}Layer`).hidden = false;
  }
  function hideLayer(name) {
    const l = sheetLayer(name);
    if (l && l.isOpen()) return l.close();
    if ($(`cm${name}Layer`)) $(`cm${name}Layer`).hidden = true;
    onLayerClosed(name);
  }
  function onLayerClosed(name) {
    if (!Object.keys(layers).some((k) => layers[k].isOpen())) document.body.classList.remove("cm-sheet-open");
    if (name === "Annot") {
      annotMediaId = null;
      annotDrawing = null;
    }
  }

  function openMapsChooser(address) {
    const addr = String(address || "").trim();
    if (!addr) return;
    $("cmMapsAddr").textContent = addr;
    $("cmMapsApple").href = appleMapsUrl(addr);
    $("cmMapsGoogle").href = googleMapsUrl(addr);
    showLayer("Maps");
  }
  function closeMapsChooser() {
    hideLayer("Maps");
  }

  async function api(path, opts) {
    if (window.OmOffline && typeof window.OmOffline.api === "function") {
      const json = await window.OmOffline.api(path, {
        credentials: "same-origin",
        allowQueue: true,
        ...(opts || {}),
      });
      if (json && json.queued) {
        toast(json.message || "Salvo sem sinal — enviamos quando a conexão voltar.", "success");
      }
      return json;
    }
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
    else if (type !== "success") console.warn(msg);
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

  async function fileToUploadDataUrl(file) {
    if (!file.type || !file.type.startsWith("image/")) {
      throw new Error("Selecione uma imagem");
    }
    try {
      // One compression for every Campo screen (campo-photo.js?v=20261105-apps3): 1600px max side, JPEG 0.74.
      if (!window.CampoPhoto) throw new Error("no compressor");
      return await window.CampoPhoto.compress(file);
    } catch (_) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Falha ao ler imagem"));
        reader.readAsDataURL(file);
      });
    }
  }

  function parseLockbox(notes) {
    const m = String(notes || "").match(/\/lockbox\s*[#:]?\s*([0-9A-Za-z-]{2,24})\b/i);
    return m ? m[1] : null;
  }
  function lockboxBadgeHtml(notes) {
    const code = parseLockbox(notes);
    if (!code) return "";
    const cells = [...String(code)]
      .map((ch) => `<span class="job-lockbox-badge__cell">${escapeHtml(ch)}</span>`)
      .join("");
    return `<div class="cm-lockbox" title="LockBox ${escapeHtml(code)}" aria-label="LockBox ${escapeHtml(code)}">
      <span class="cm-lockbox__pad" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="11" width="14" height="10" rx="2"/>
          <path d="M8 11V8a4 4 0 018 0v3"/>
          <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none"/>
        </svg>
      </span>
      <span class="cm-lockbox__cells">${cells}</span>
    </div>`;
  }

  function deliveryBlockHtml(t) {
    const stops = Array.isArray(t.deliveries) && t.deliveries.length
      ? t.deliveries
      : t.needs_delivery
        ? [
            {
              pickup_address: t.delivery_pickup_address,
              location_name: null,
              hours: null,
              notes: t.delivery_notes,
              scheduled_start: null,
            },
          ]
        : [];
    if (!stops.length && !(t.delivery_attachment && t.delivery_attachment.url)) return "";
    const blocks = stops.map((stop, i) => {
      const bits = [];
      bits.push(`<span class="job-delivery-badge">Delivery${stops.length > 1 ? ` ${i + 1}` : ""}</span>`);
      if (stop.location_name) {
        bits.push(`<div class="cm-delivery__row"><small>Local</small><span>${escapeHtml(stop.location_name)}${stop.hours ? ` · ${escapeHtml(stop.hours)}` : ""}</span></div>`);
      }
      if (stop.pickup_address) {
        bits.push(
          `<div class="cm-delivery__row"><small>Retirada</small><button type="button" class="cm-linkish" data-maps-addr="${escapeHtml(stop.pickup_address)}">${escapeHtml(stop.pickup_address)}</button></div>`,
        );
      } else if (stop.hours) {
        bits.push(`<div class="cm-delivery__row"><small>Horário</small><span>${escapeHtml(stop.hours)}</span></div>`);
      }
      if (stop.notes) {
        bits.push(`<div class="cm-delivery__row"><small>Notas / PO</small><span>${escapeHtml(stop.notes)}</span></div>`);
      }
      return `<div class="cm-delivery">${bits.join("")}</div>`;
    });
    if (t.delivery_attachment && t.delivery_attachment.url) {
      blocks.push(
        `<div class="cm-delivery"><div class="cm-delivery__row"><small>Arquivo</small><a href="${escapeHtml(t.delivery_attachment.url)}" target="_blank" rel="noopener">${escapeHtml(t.delivery_attachment.name || "Anexo")}</a></div></div>`,
      );
    }
    return blocks.join("");
  }

  function stripLockboxText(notes) {
    return String(notes || "")
      .replace(/\/lockbox\s*[#:]?\s*[0-9A-Za-z-]{2,24}\b\s*[—–-]?\s*/i, "")
      .trim();
  }

  function renderHero() {
    const t = ticket;
    const who = t.homeowner_name || (t.client && t.client !== "—" ? t.client : "") || "Job";
    $("cmTicketTitle").textContent = who;
    $("cmTicketWhen").textContent = t.when_label || "—";
    $("cmTicketBadge").textContent = t.field_status_label || "—";
    $("cmTicketJob").textContent = who;
    $("cmTicketSub").textContent = t.address || "Sem endereço";
    $("cmTicketAddr").textContent = t.address || "Sem endereço";
    const nav = $("cmTicketNav");
    if (t.address) {
      nav.hidden = false;
      nav.disabled = false;
      nav.dataset.address = t.address;
    } else {
      nav.hidden = true;
      nav.disabled = true;
      delete nav.dataset.address;
    }

    const cta = $("cmTicketCta");
    const wrap = $("cmTicketCtaWrap");
    if (wrap) wrap.hidden = false;
    if (cta) {
      cta.textContent = "Tirar Foto";
      cta.disabled = t.job_media_enabled === false;
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
    const lockbox = t.notes ? lockboxBadgeHtml(t.notes) : "";
    const delivery = deliveryBlockHtml(t);
    const homeowner =
      t.homeowner_name || t.homeowner_phone
        ? `<div class="cm-delivery"><span class="job-delivery-badge">HomeOwner</span><div class="cm-delivery__row"><small>Contato</small><span>${escapeHtml([t.homeowner_name, t.homeowner_phone].filter(Boolean).join(" · "))}</span></div></div>`
        : "";
    // Always surface office Notes (even when "Atenção" is also set / derived from notes).
    const text = stripLockboxText(t.notes || "").trim();
    const hasNote = Boolean(text);
    const cue = $("cmNoteCue");
    const cueText = $("cmNoteCueText");
    if (cue) {
      if (hasNote) {
        cue.hidden = false;
        if (cueText) cueText.textContent = text;
      } else {
        cue.hidden = true;
        if (cueText) cueText.textContent = "";
      }
    }
    const tabDetails = $("cmTabDetails");
    if (tabDetails) {
      tabDetails.classList.toggle("has-note", hasNote);
      tabDetails.setAttribute("data-note", hasNote ? "1" : "0");
      tabDetails.innerHTML = hasNote
        ? `Detalhes<span class="cm-ticket-tabs__dot" aria-label="Tem nota" title="Tem nota do escritório"></span>`
        : "Detalhes";
    }
    const badge = $("cmTicketNoteBadge");
    if (badge) badge.hidden = !hasNote;
    document.body.classList.toggle("cm-ticket-has-note", hasNote);
    if (lockbox || delivery || homeowner) {
      notes.hidden = false;
      notes.innerHTML = `${lockbox}${homeowner}${delivery}`;
    } else {
      notes.hidden = true;
      notes.innerHTML = "";
    }
  }

  function renderChecklist() {
    const t = ticket;
    const tabBtn = $("cmTabChecklist");
    const panel = $("cmPanelChecklist");
    const enabled = t.checklist_enabled !== false;
    if (tabBtn) tabBtn.hidden = !enabled;
    if (!enabled) {
      if (tab === "checklist") {
        tab = "details";
        document.querySelectorAll(".cm-ticket-tabs__btn").forEach((b) => {
          const on = b.getAttribute("data-tab") === "details";
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".cm-ticket-panel").forEach((p) => {
          p.hidden = p.getAttribute("data-panel") !== "details";
        });
      }
      if (panel) panel.hidden = true;
      return;
    }
    const done = t.checklist_done || 0;
    const total = t.checklist_total || 0;
    if ($("cmCheckCount")) $("cmCheckCount").textContent = `${done} de ${total}`;
    if (tabBtn) tabBtn.textContent = `Checklist ${done}/${total}`;
    const pct = total ? Math.round((done / total) * 100) : 0;
    if ($("cmCheckBarFill")) $("cmCheckBarFill").style.transform = `scaleX(${Math.max(0, Math.min(100, Number(pct) || 0)) / 100})`;

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
      <div class="cm-check-item${item.done ? " is-done" : ""}${item.done && item.id === justChecked ? " is-just-done" : ""}" data-check-wrap="${escapeHtml(item.id)}">
        <button type="button" class="cm-check-item__main" data-check-id="${escapeHtml(item.id)}" data-om-press aria-pressed="${item.done ? "true" : "false"}" style="display:flex;gap:0.65rem;align-items:flex-start;width:100%;border:0;background:transparent;padding:0;text-align:left;cursor:pointer">
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
    justChecked = null;
  }

  function updatePendingUi(rows) {
    const mine = (rows || []).filter((r) => r.jobId === jobId);
    pendingCount = mine.length;
    const el = $("cmPhotosPending");
    if (!el) return;
    if (!pendingCount) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const text = $("cmPhotosPendingText");
    if (text) {
      text.textContent =
        pendingCount === 1 ? "1 foto na fila para enviar" : `${pendingCount} fotos na fila para enviar`;
    }
    const send = $("cmPhotosPendingSend");
    if (send) send.hidden = !navigator.onLine;
    if (ticket) renderPhotos();
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

  function photoList() {
    return (ticket?.photos || []).filter((p) => p && (p.url || p.thumb_url));
  }

  function photoPhaseOf(p) {
    return p && phaseLabels()[p.phase] ? p.phase : "";
  }

  function photoMetaLabel(p) {
    const phase = photoPhaseOf(p) ? phaseLabels()[photoPhaseOf(p)] : "";
    const cap = (p.caption || "").trim();
    return [cap, phase].filter(Boolean).join(" · ") || "Foto da obra";
  }

  function filteredPhotos() {
    const all = photoList();
    if (phaseFilter === "all") return all;
    return all.filter((p) => photoPhaseOf(p) === phaseFilter);
  }

  function renderPhotos() {
    const t = ticket;
    const all = photoList();
    const photos = filteredPhotos();
    const total = all.length + pendingCount + uploadsInFlight.length;
    $("cmTabPhotos").textContent = `Fotos · ${total}`;
    const grid = $("cmPhotosGrid");
    renderReportCard();
    if (lightboxIndex >= 0) {
      if (!photos.length) closeLightbox();
      else {
        if (lightboxIndex >= photos.length) lightboxIndex = photos.length - 1;
        renderLightbox();
      }
    }
    const inFlightHtml = uploadsInFlight
      .map(
        (u) => `
      <div class="cm-photo cm-photo--uploading" aria-label="Enviando foto">
        <img src="${escapeHtml(u.previewUrl)}" alt="" />
        <span class="cm-photo__uploading"><i aria-hidden="true"></i>Enviando…</span>
      </div>`,
      )
      .join("");
    if (!photos.length && !inFlightHtml) {
      grid.innerHTML =
        phaseFilter !== "all" && all.length
          ? '<p class="cm-subtitle" style="margin:0.5rem 0">Nenhuma foto nesta fase.</p>'
          : '<p class="cm-subtitle" style="margin:0.5rem 0">Nenhuma foto ainda.</p>';
      return;
    }
    grid.innerHTML =
      inFlightHtml +
      photos
        .map((p, idx) => {
          const phase = photoPhaseOf(p) ? phaseLabels()[photoPhaseOf(p)] : "";
          const gps = p.location_available ? " · GPS" : "";
          const pub = p.is_public ? " · público" : "";
          const meta = photoMetaLabel(p);
          const src = p.thumb_url || p.url || "";
          return `
      <button type="button" class="cm-photo" data-media-id="${escapeHtml(p.id || "")}" data-photo-idx="${idx}" ${p.legacy ? "data-legacy=1" : ""}>
        ${phase ? `<span class="cm-photo__badge">${escapeHtml(phase)}</span>` : ""}
        <img src="${escapeHtml(src)}" alt="${escapeHtml(meta)}" loading="lazy" onerror="this.classList.add('is-broken');this.parentElement&&this.parentElement.classList.add('is-broken')" />
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

  /** Trades with per-job phases (Tile) get a Fases tab; Stain samples are Hardwood only. */
  function hasPhases() {
    return Boolean(window.JobPhases && window.JobPhases.available());
  }
  function stainOff() {
    return Boolean(window.__OM_TRADE && window.__OM_TRADE.id && window.__OM_TRADE.id !== "hardwood");
  }

  function showTab(name) {
    if (name === "phases" && !hasPhases()) name = "details";
    const opening = name === "phases" && tab !== "phases";
    tab = name;
    if (opening) {
      window.JobPhases.mount($("cmPhases"), {
        jobId,
        compact: true,
        address: ticket?.address || null,
        deviceLabel: deviceLabel(),
        notify: (m) => toast(m),
      });
    }
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
    renderPhaseChips();
    renderAll();
  }

  /**
   * Photo phase chips: the job's own phases when it follows a trade's (Tile, Countertops); the
   * Hardwood chips in the page otherwise. Rebuilt only when the list changes.
   */
  let chipsKey = "";
  function renderPhaseChips() {
    const host = $("cmPhaseFilters");
    if (!host || !ticket || ticket.phase_mode !== "phases" || !Array.isArray(ticket.phases)) return;
    const labels = phaseLabels();
    const keys = ticket.phases.filter((k) => labels[k]);
    const key = keys.join(",");
    if (key === chipsKey) return;
    chipsKey = key;
    if (phaseFilter !== "all" && !keys.includes(phaseFilter)) {
      phaseFilter = "all";
      photoPhase = "";
    }
    host.classList.add("cm-chip-row--scroll");
    host.innerHTML = [["all", "Todas"], ...keys.map((k) => [k, labels[k]])]
      .map(([k, l]) => `<button type="button" class="cm-chip${phaseFilter === k ? " is-selected" : ""}" data-photo-phase="${escapeHtml(k)}" aria-pressed="${phaseFilter === k}">${escapeHtml(l)}</button>`)
      .join("");
  }

  function openProblem() {
    $("cmProblemNote").value = ticket?.problem_note || "";
    showLayer("Problem");
  }

  function closeProblem() {
    hideLayer("Problem");
  }

  async function postPhotoPayload(row) {
    const body = {
      data_url: row.dataUrl,
      stage: row.stage || null,
      phase: row.phase || null,
      caption: row.caption || null,
      taken_at_device: row.takenAtDevice,
      taken_at_source: row.takenAtSource || null,
      lat: row.lat,
      lng: row.lng,
      gps_accuracy_m: row.gpsAccuracyM,
      location_source: row.locationSource || null,
      camera_model: row.cameraModel || null,
      address: row.address || null,
      client_upload_id: row.id,
      device_label: row.deviceLabel || deviceLabel(),
      is_public: Boolean(row.isPublic),
    };
    const json = await api(`/api/campo/jobs/${jobId}/photos`, {
      method: "POST",
      // Already in the media queue: a dropped connection must fail here, not move to the generic queue.
      allowQueue: false,
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
    return results;
  }

  async function sendQueuedNow(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Enviando…";
    try {
      const results = (await flushQueue()) || [];
      if (results.some((r) => !r.ok)) {
        toast("Ainda não foi possível enviar. Tentamos de novo quando a conexão melhorar.", "warning");
      }
    } catch (_) {
      toast("Ainda não foi possível enviar. Tentamos de novo quando a conexão melhorar.", "warning");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function refreshPendingUi() {
    if (!window.__campoMediaQueue) return;
    window.__campoMediaQueue.list().then(updatePendingUi).catch(() => {});
  }

  async function uploadOrQueue(file) {
    if (ticket && ticket.job_media_enabled === false) {
      toast("Fotos desativadas para esta organização");
      return;
    }
    // Show the shot right away; EXIF, compression and the upload can take seconds on 4G.
    const inFlight = { key: `f-${Date.now()}-${Math.random()}`, previewUrl: URL.createObjectURL(file) };
    uploadsInFlight.unshift(inFlight);
    showTab("photos");
    renderPhotos();
    try {
      await sendOrQueue(file);
    } finally {
      const i = uploadsInFlight.indexOf(inFlight);
      if (i >= 0) uploadsInFlight.splice(i, 1);
      URL.revokeObjectURL(inFlight.previewUrl);
      renderPhotos();
    }
  }

  async function sendOrQueue(file) {
    // Time, GPS and camera come from the photo itself when it has them (EXIF), before compression drops them.
    const shot = window.PhotoExif
      ? await window.PhotoExif.uploadMeta(file, { live: true, deviceGps: getGps })
      : null;
    const dataUrl = await fileToUploadDataUrl(file);
    const gps = shot ? (shot.lat != null ? { lat: shot.lat, lng: shot.lng, gpsAccuracyM: shot.gps_accuracy_m } : null) : await getGps();
    const caption = ($("cmPhotoCaption")?.value || "").trim() || null;
    const isPublic = Boolean($("cmPhotoPublic")?.checked);
    const payload = {
      jobId,
      dataUrl,
      stage: null,
      phase: photoPhase || null,
      caption,
      takenAtDevice: shot ? shot.taken_at_device : new Date().toISOString(),
      takenAtSource: shot ? shot.taken_at_source : null,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      gpsAccuracyM: gps?.gpsAccuracyM ?? null,
      locationSource: shot ? shot.location_source : gps ? "device" : null,
      cameraModel: shot ? shot.camera_model : null,
      address: ticket?.address || null,
      deviceLabel: deviceLabel(),
      isPublic,
    };

    if (!navigator.onLine && window.__campoMediaQueue) {
      await window.__campoMediaQueue.enqueue(payload);
      toast("Sem rede. A foto ficou na fila e sobe quando a conexão voltar.", "warning");
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
        toast("Não deu para enviar agora. A foto ficou na fila.", "warning");
      } else {
        toast(err.message || "Falha no upload");
      }
    }
  }

  function voiceCaptionOnDevice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error("Reconhecimento de voz não disponível neste navegador"));
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

  function currentLightboxPhoto() {
    const photos = filteredPhotos();
    if (lightboxIndex < 0 || lightboxIndex >= photos.length) return null;
    return photos[lightboxIndex];
  }

  function renderLightbox() {
    const photo = currentLightboxPhoto();
    const box = $("cmLightbox");
    if (!box || !photo) return;
    const photos = filteredPhotos();
    const src = photo.url || photo.thumb_url || "";
    const img = $("cmLightboxImg");
    if (img) {
      img.alt = photoMetaLabel(photo);
      img.src = src;
      img.classList.toggle("is-broken", !src);
      img.onerror = () => img.classList.add("is-broken");
      img.onload = () => img.classList.remove("is-broken");
    }
    const count = $("cmLightboxCount");
    if (count) count.textContent = `${lightboxIndex + 1} / ${photos.length}`;
    const cap = $("cmLightboxCap");
    if (cap) {
      const phase = photoPhaseOf(photo) ? phaseLabels()[photoPhaseOf(photo)] : "";
      const bits = [photo.caption || "", phase, photo.is_public ? "público" : ""]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      cap.textContent = bits.join(" · ") || "Foto da obra";
    }
    const prev = $("cmLightboxPrev");
    const next = $("cmLightboxNext");
    if (prev) prev.hidden = photos.length < 2;
    if (next) next.hidden = photos.length < 2;
    const actions = $("cmLightboxActions");
    if (actions) actions.hidden = Boolean(photo.legacy);
  }

  function openLightbox(index) {
    const photos = filteredPhotos();
    if (!photos.length) return;
    lightboxIndex = Math.max(0, Math.min(index, photos.length - 1));
    const box = $("cmLightbox");
    if (!box) return;
    box.hidden = false;
    document.body.classList.add("cm-lightbox-open");
    renderLightbox();
  }

  function closeLightbox() {
    lightboxIndex = -1;
    const box = $("cmLightbox");
    if (box) box.hidden = true;
    document.body.classList.remove("cm-lightbox-open");
    const img = $("cmLightboxImg");
    if (img) {
      img.removeAttribute("src");
      img.classList.remove("is-broken");
    }
  }

  function stepLightbox(delta) {
    const photos = filteredPhotos();
    if (photos.length < 2 || lightboxIndex < 0) return;
    lightboxIndex = (lightboxIndex + delta + photos.length) % photos.length;
    renderLightbox();
  }

  async function pickPhotoPhase(current) {
    const phases = (ticket && ticket.phases && ticket.phases.length ? ticket.phases : PHASE_KEYS).filter(
      (k) => phaseLabels()[k],
    );
    const choices = ["(Automática)", ...phases.map((k) => phaseLabels()[k])];
    const labels = [null, ...phases];
    const picked = await window.crmPrompt({
      title: "Fase da foto",
      type: "select",
      options: choices.map((label, i) => ({ value: String(i), label })),
      value: String(Math.max(0, labels.indexOf(current || null))),
      ok: "Salvar fase",
    });
    if (picked == null) return undefined;
    const idx = Number(picked);
    if (!Number.isFinite(idx) || idx < 0 || idx >= labels.length) return undefined;
    return labels[idx];
  }

  async function runPhotoAction(action) {
    const photo = currentLightboxPhoto();
    if (!photo || photo.legacy || !jobId) return;
    const mediaId = photo.id;
    try {
      if (action === "anotar") {
        closeLightbox();
        openAnnotator(photo);
        return;
      }
      if (action === "fase") {
        const next = await pickPhotoPhase(photo.phase_source === "manual" ? photo.phase : null);
        if (next === undefined) return;
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ phase: next }),
        });
        apply(json.data);
        toast(next ? `Fase: ${phaseLabels()[next] || next}` : "Fase automática", "success");
        return;
      }
      if (action === "ocr") {
        toast("Lendo etiqueta…", "success");
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}/ocr`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        apply(json.data);
        const o = json.meta?.ocr;
        toast(o?.serial_number || o?.label_text || "OCR concluído", "success");
        return;
      }
      if (action === "voz") {
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
      if (action === "apagar") {
        const okDel = await window.crmConfirm({
          title: "Apagar esta foto?",
          text: "Ela sai do job e não pode ser recuperada.",
          ok: "Apagar foto",
          danger: true,
        });
        if (!okDel) return;
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "DELETE",
        });
        apply(json.data);
        toast("Foto apagada", "success");
        return;
      }
      if (action === "publico") {
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_public: true }),
        });
        apply(json.data);
        toast("Visível no link público", "success");
        return;
      }
      if (action === "privado") {
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_public: false }),
        });
        apply(json.data);
        toast("Removida do link público", "success");
        return;
      }
      if (action === "legenda") {
        const next = await window.crmPrompt({
          title: "Legenda da foto",
          type: "textarea",
          value: photo.caption || "",
          placeholder: "Ex.: Subfloor nivelado na sala",
          rows: 3,
          ok: "Salvar legenda",
        });
        if (next == null) return;
        const json = await api(`/api/campo/jobs/${jobId}/media/${mediaId}`, {
          method: "PATCH",
          body: JSON.stringify({ caption: next.trim() || null }),
        });
        apply(json.data);
        toast("Legenda atualizada", "success");
      }
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
      toast("Gerando relatório…", "success");
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
    el.textContent = `Gravando vistoria · ${secs}s · ${inspectMarks.length} marca(s) · toque no botão para parar`;
    btn.textContent = "Parar vistoria";
  }

  async function toggleInspection() {
    if (inspectRec) {
      await stopInspection();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("Gravação de áudio não disponível neste navegador");
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
      toast("Gravando vistoria — tire fotos para marcar no áudio", "success");
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
      reader.onerror = () => reject(new Error("Falha ao ler o áudio"));
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
      toast("Áudio muito curto");
      return;
    }

    try {
      toast("Enviando vistoria…", "success");
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
          ? `Vistoria salva (${marks.length} marca${marks.length === 1 ? "" : "s"})`
          : "Vistoria salva",
        "success",
      );
    } catch (err) {
      toast(err.message || "Falha ao salvar a vistoria");
    }
  }

  async function addMeasurement() {
    const label = await window.crmPrompt({
      title: "Nova medição",
      label: "Área / divisão",
      value: "Living room",
      ok: "Continuar",
    });
    if (!label || !label.trim()) return;
    const raw = await window.crmPrompt({
      title: `Área de “${label.trim()}”`,
      label: "Área em sqft",
      type: "number",
      inputMode: "decimal",
      placeholder: "Ex.: 350",
      ok: "Salvar medição",
    });
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
      toast("Medição salva", "success");
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
    showLayer("Annot");
    setTimeout(redrawAnnotations, 50);
  }

  function closeAnnotator() {
    hideLayer("Annot");
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
        toast("Anotações salvas", "success");
      } catch (err) {
        toast(err.message || "Falha ao salvar");
      }
    });

    const onStart = async (e) => {
      e.preventDefault();
      const p = pointerNorm(e, canvas);
      if (annotTool === "text") {
        const text = await window.crmPrompt({
          title: "Texto na foto",
          label: "Texto",
          placeholder: "Ex.: Trinca aqui",
          ok: "Adicionar texto",
        });
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
      if (!list.length) {
        toast("Nenhum template disponível");
        return;
      }
      const pick = await window.crmPrompt({
        title: "Escolha o template",
        type: "select",
        label: "Template",
        options: list.map((t, i) => ({ value: String(i + 1), label: t.name })),
        value: "1",
        ok: "Continuar",
      });
      if (!pick) return;
      const idx = Number(pick) - 1;
      const tpl = list[idx];
      if (!tpl) {
        toast("Template inválido");
        return;
      }
      const okTpl = await window.crmConfirm({
        title: `Substituir checklist por “${tpl.name}”?`,
        text: "Os itens atuais do checklist serão trocados pelos do template.",
        ok: "Substituir checklist",
        danger: true,
      });
      if (!okTpl) return;
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
        transcript =
          (await window.crmPrompt({
            title: "Itens do checklist",
            label: "Digite os itens (separados por vírgula)",
            type: "textarea",
            rows: 3,
            placeholder: "Ex.: Proteger rodapé, tirar foto do subfloor",
            ok: "Propor itens",
          })) || "";
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
      const preview = items.map((i) => `${i.text}${i.photo_required ? " (foto)" : ""}`).join(" · ");
      const okApply = await window.crmConfirm({
        title: `Adicionar ${items.length} ite${items.length === 1 ? "m" : "ns"} ao checklist?`,
        text: preview,
        ok: "Adicionar itens",
      });
      if (!okApply) return;
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

    // One listener on the row: the chips can be rebuilt with the job's own phases.
    $("cmPhaseFilters")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-photo-phase]");
      if (!btn) return;
      const next = btn.getAttribute("data-photo-phase") || "all";
      phaseFilter = next;
      // Selecting a phase also tags the next capture; "Todas" leaves phase automatic.
      photoPhase = next === "all" ? "" : next;
      document.querySelectorAll("#cmPhaseFilters [data-photo-phase]").forEach((b) => {
        b.classList.toggle("is-selected", b === btn);
        b.setAttribute("aria-pressed", String(b === btn));
      });
      renderPhotos();
    });

    $("cmTicketCta")?.addEventListener("click", () => {
      if (ticket?.job_media_enabled === false) {
        toast("Fotos desativadas para esta organização");
        return;
      }
      if (window.OmUI) window.OmUI.haptic("tap");
      showTab("photos");
      $("cmPhotoInput")?.click();
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
          if (json && json.queued) return;
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
        if (!item.done) justChecked = id;
        const json = await api(`/api/campo/jobs/${jobId}/checklist`, {
          method: "PATCH",
          body: JSON.stringify({ item_id: id, done: !item.done }),
        });
        if (json && json.queued) {
          item.done = !item.done;
          apply(ticket);
          return;
        }
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
      const btn = e.target.closest("[data-photo-idx]");
      if (!btn) return;
      const idx = Number(btn.getAttribute("data-photo-idx"));
      if (!Number.isFinite(idx)) return;
      openLightbox(idx);
    });

    $("cmLightboxClose")?.addEventListener("click", closeLightbox);
    $("cmLightboxPrev")?.addEventListener("click", () => stepLightbox(-1));
    $("cmLightboxNext")?.addEventListener("click", () => stepLightbox(1));
    $("cmLightboxActions")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lb-action]");
      if (!btn) return;
      runPhotoAction(btn.getAttribute("data-lb-action")).catch(() => {});
    });
    document.addEventListener("keydown", (e) => {
      if (lightboxIndex < 0) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") stepLightbox(-1);
      if (e.key === "ArrowRight") stepLightbox(1);
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

    $("cmTicketNav")?.addEventListener("click", () => {
      openMapsChooser($("cmTicketNav").dataset.address || ticket?.address);
    });
    $("cmMapsClose")?.addEventListener("click", closeMapsChooser);
    $("cmMapsBackdrop")?.addEventListener("click", closeMapsChooser);
    $("cmMapsApple")?.addEventListener("click", () => setTimeout(closeMapsChooser, 200));
    $("cmMapsGoogle")?.addEventListener("click", () => setTimeout(closeMapsChooser, 200));
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-maps-addr]");
      if (!btn) return;
      e.preventDefault();
      openMapsChooser(btn.getAttribute("data-maps-addr"));
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
      refreshPendingUi();
      flushQueue().catch(() => {});
    });
    window.addEventListener("offline", refreshPendingUi);

    $("cmPhotosPendingSend")?.addEventListener("click", (e) => {
      sendQueuedNow(e.currentTarget).catch(() => {});
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
    const phasesTab = $("cmTabPhases");
    if (phasesTab) phasesTab.hidden = !hasPhases();
    if (hasPhases()) window.JobPhases.summary(jobId);
    const stainLink = $("cmStainLink");
    if (stainLink && stainOff()) stainLink.style.display = "none";
    else if (stainLink) {
      stainLink.href = `stain.html?id=${encodeURIComponent(jobId)}`;
      fetch(`/api/work-orders/${encodeURIComponent(jobId)}/stain`, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((j) => {
          const d = j && j.data;
          const sub = $("cmStainLinkSub");
          if (!d || !sub) return;
          if (d.approved) sub.textContent = `Aprovado: ${d.approved.sample.display_name}`;
          else if (d.rounds.length) sub.textContent = `Rodada ${d.rounds[d.rounds.length - 1].number} · ${d.rounds[d.rounds.length - 1].status_label}`;
        })
        .catch(() => {});
    }
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
