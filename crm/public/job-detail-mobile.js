/**
 * Job detail mobile overlay — visits, photos capture/upload, finance snippet.
 */
(function () {
  const ROLE_KEY = "om_jobs_role";
  let job = null;
  let canManage = false;
  let isField = false;
  let jobId = null;
  let detTab = "visitas";
  let mediaList = [];
  let mediaLoaded = false;
  let commsCtl = null;

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
      scheduled: "Agendada",
      in_progress: "Em andamento",
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
        meta: `${fmtDay(start)}${start ? ` · ${fmtTimeRange(start, end)} · hoje` : ""}`,
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
      steps.push({
        title: it.service_name,
        meta: it.quantity_sqft ? `${it.quantity_sqft} sq ft` : "",
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
            .map((p) => {
              const st = stageLabel(p.stage);
              const cap = escapeHtml(p.caption || st || "Foto");
              return `<a class="jcm-photo-thumb" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
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
    $("jobMobId").textContent = `Job #${wo.number != null ? wo.number : "—"}`;
    const badge = $("jobMobStatus");
    badge.textContent = statusPt(wo.status);
    badge.className = `jcm-badge ${statusCls(wo.status)}`;
    $("jobMobName").textContent = clientLabel(wo);
    const typeBits = [wo.title, sqftTotal(wo)].filter(Boolean).join(" · ");
    $("jobMobType").textContent = typeBits || "—";

    const addr = wo.address || "—";
    const maps = wo.address ? `https://maps.google.com/?q=${encodeURIComponent(wo.address)}` : "#";
    $("jobMobAddr").textContent = addr;
    $("jobMobTeam").textContent = teamLabel(wo);
    $("jobMobMapQuick").href = maps;
    const phone = wo.customer?.phone || "";
    $("jobMobCallQuick").href = phone ? `tel:${phone}` : "customers.html";
    $("jobMobNotesQuick").href = `#`;

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
    $("jobMobInstrBody").textContent = notes;

    const cta = $("jobMobCta");
    const foot = $("jobMobFoot");
    foot.classList.add("is-visible", "jcm-foot--single");

    document.querySelectorAll("[data-jd-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-jd-tab") === detTab);
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
      $("jobMobExtra").innerHTML = `<p class="jcm-empty">Checklist em breve.</p>`;
      restoreVisitCta();
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
        $("jobMobExtra").innerHTML = `<p class="jcm-empty">Chat indisponível.</p>`;
      }
    } else if (detTab === "financeiro") {
      const total = Number(wo.services_total) || 0;
      $("jobMobExtra").innerHTML = `<div class="jcm-card"><div class="jcm-dl">
        <div class="jcm-dl__row"><span class="jcm-dl__k">Serviços</span><span class="jcm-dl__v">${escapeHtml(
          String(total ? `$${total.toFixed(2)}` : "—"),
        )}</span></div>
      </div></div>`;
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
      cta.textContent = "Concluir visita";
      cta.className = "jcm-foot__btn jcm-foot__btn--ink";
      cta.dataset.action = "complete";
    } else if (wo.status === "completed") {
      cta.textContent = "Ver no Schedule";
      cta.className = "jcm-foot__btn jcm-foot__btn--ghost";
      cta.dataset.action = "schedule";
    } else {
      cta.textContent = "Iniciar visita";
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
        if (action === "start") {
          await setStatus("in_progress");
          window.crmToast?.success?.("Visita iniciada");
        } else if (action === "complete") {
          await setStatus("completed");
          window.crmToast?.success?.("Visita concluída");
        } else if (action === "schedule") {
          location.href = "schedule.html";
        }
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro");
      }
    });
    $("jobMobNotesQuick")?.addEventListener("click", (e) => {
      e.preventDefault();
      $("jobMobInstr")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!$("jobMobRoot")) return;
    jobId = new URLSearchParams(location.search).get("id");
    if (!jobId) return;
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
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
