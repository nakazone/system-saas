/**
 * ObraCam photo viewer (desktop, iPad, iPhone): the photo on a dark stage, its details in a fixed panel
 * (beside it on wide screens, under it on phones), zoom and gestures, a note, and a markup layer drawn
 * over the original photo (the file itself never changes).
 *
 * window.CamViewer.open({
 *   photos, index,
 *   canPortfolio, onPortfolio(photo, next) => Promise<{in_portfolio}|void>,
 *   canDelete,    onDelete(photo) => Promise<void>,
 *   canStage,     onStage(photo, stage|null) => Promise<{stage}>,
 *   canEdit,      onNote(photo, text|null) => Promise<{caption}>,
 *                 onAnnotate(photo, doc|null) => Promise<{annotations}>,
 *                 people: [{id, name}], onTakenBy(photo, userId|null) => Promise<{taken_by_id, taken_by_name}>,
 *                 stickers: [{id, name, color, archived}], onStickers(photo, ids) => Promise<{sticker_ids}>, onManageStickers(),
 *   from,         the tapped tile (element): the photo grows out of it on open (FLIP), and the thumbnail shows at once
 * })
 * window.CamViewer.sharePhotos([{ url, name }]) shares files through the system sheet when the browser can
 * (navigator.canShare({ files })); resolves "shared" | "cancelled" | "unsupported" | "failed".
 * photo = { id, url, thumb_url, stage, created_at, taken_at_device, taken_at_source, author, uploaded_by_name,
 *           taken_by_id, taken_by_name, device, camera_model, caption, annotations, address, lat, lng,
 *           location_source, distance_m, far_from_job, location_available, in_portfolio,
 *           job: { id, number, title, client, name } }
 */
(function () {
  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const STAGES = [["before", "Antes"], ["during", "Durante"], ["after", "Depois"], ["", "Geral"]];
  /** Display names only: the keys (delivery, scan…) are what the API stores and expects. */
  const PHASE_LABEL = { delivery: "Entrega", scan: "Medição", installation: "Instalação", sand_finish: "Lixa e acabamento", walkthrough: "Vistoria final" };
  /** Name of a phase: the trade's own (Tile, Countertops) when the job follows them, else Hardwood's above. */
  const phaseLabel = (p, k) =>
    (p && p.phase_mode === "phases" && ((p.phase_labels && p.phase_labels[k]) || (k === p.phase && p.phase_label))) || PHASE_LABEL[k] || (p && p.phase_labels && p.phase_labels[k]) || k;
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const COLORS = [
    ["#FF3B30", "Vermelho"], ["#FF9500", "Laranja"], ["#FFCC00", "Amarelo"], ["#34C759", "Verde"], ["#0A84FF", "Azul"],
    ["#AF52DE", "Roxo"], ["#FF2D55", "Rosa"], ["#FFFFFF", "Branco"], ["#8E8E93", "Cinza"], ["#1C1A17", "Preto"],
  ];
  const colorName = (c) => (COLORS.find(([x]) => x.toLowerCase() === String(c).toLowerCase()) || [null, "Outra cor"])[1];
  const TOOLS = [["freehand", "Caneta"], ["arrow", "Seta"], ["rect", "Retângulo"], ["circle", "Círculo"], ["text", "Texto"]];
  const MAX_ZOOM = 5;
  const EASE = "cubic-bezier(.2, .8, .2, 1)";
  /** Motion tokens from om-tokens.css, read once (WAAPI cannot take var()). */
  const tok = (name, fb) => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
    } catch (_) {
      return fb;
    }
  };
  const EASE_OUT = () => tok("--om-ease-out", "cubic-bezier(0.23, 1, 0.32, 1)");
  const EASE_DRAWER = () => tok("--om-ease-drawer", "cubic-bezier(0.32, 0.72, 0, 1)");
  const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
    prev: I('<path d="M15 18l-6-6 6-6"/>'),
    next: I('<path d="M9 18l6-6-6-6"/>'),
    star: I('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
    dl: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    pin: I('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>'),
    pen: I('<path d="M4 20l4-1L19 8a2.1 2.1 0 00-3-3L5 16l-1 4z"/>'),
    eye: I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: I('<path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.1 3.9M6.5 6.6A16.6 16.6 0 002 12s3.6 7 10 7a9.7 9.7 0 004.3-1"/>'),
    zoomIn: I('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'),
    zoomOut: I('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'),
    undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
    redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>'),
    freehand: I('<path d="M3 17c3-4 5-9 8-9s1 8 4 8 3-5 6-6"/>'),
    arrow: I('<path d="M5 19L19 5M10 5h9v9"/>'),
    rect: I('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
    circle: I('<circle cx="12" cy="12" r="8"/>'),
    text: I('<path d="M5 6h14M12 6v13M9 19h6"/>'),
    note: I('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>'),
    tag: I('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
    info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>'),
    share: I('<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/>'),
  };

  // ------------------------------------------------------------------ share (system sheet)
  let shareProbe = null;
  /** True when this browser can hand image files to the system share sheet (iOS, Android, some desktops). */
  function canShareFiles() {
    if (shareProbe != null) return shareProbe;
    try {
      shareProbe = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File([new Blob([""], { type: "image/jpeg" })], "x.jpg", { type: "image/jpeg" })] }));
    } catch (_) {
      shareProbe = false;
    }
    return shareProbe;
  }
  /** The photo as a JPEG file (converted through a canvas when the stored file is another format). */
  async function photoFile(src, name) {
    let blob;
    if (src instanceof Blob) blob = src;
    else {
      const r = await fetch(src, { mode: "cors", credentials: "omit" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      blob = await r.blob();
    }
    if (!/jpe?g/i.test(blob.type || "")) {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("jpeg"))), "image/jpeg", 0.9));
    }
    return new File([blob], /\.jpe?g$/i.test(name) ? name : `${name}.jpg`, { type: "image/jpeg" });
  }
  /**
   * Share photos as files. Fetching them can outlast the tap's permission to open the sheet (Safari), so when the
   * browser refuses for that reason a toast offers "Compartilhar" again, with the files already in hand.
   */
  async function sharePhotos(items) {
    if (!canShareFiles() || !items || !items.length) return "unsupported";
    let files;
    try {
      files = await Promise.all(items.map((x) => photoFile(x.blob || x.url, x.name)));
    } catch (_) {
      return "failed";
    }
    const data = { files, title: files.length === 1 ? "Foto do ObraCam" : `${files.length} fotos do ObraCam` };
    if (navigator.canShare && !navigator.canShare(data)) return "unsupported";
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
      if (err && err.name === "NotAllowedError" && window.crmToast && window.crmToast.show) {
        window.crmToast.show(files.length === 1 ? "Foto pronta para compartilhar" : `${files.length} fotos prontas para compartilhar`, {
          type: "info",
          action: { label: "Compartilhar", onClick: () => navigator.share(data).catch(() => {}) },
        });
        return "shared";
      }
      return "failed";
    }
  }
  /** Files are named by job and day: obracam-job-1234-2026-11-05.jpg (a counter when there are several). */
  function photoName(p, n) {
    const d = new Date(p.taken_at_device || p.created_at || Date.now());
    const day = Number.isNaN(d.getTime()) ? "" : `-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const job = (p.job && p.job.number) != null ? `-job-${p.job.number}` : p.job_number != null ? `-job-${p.job_number}` : "";
    return `obracam${job}${day}${n ? `-${n}` : ""}.jpg`;
  }

  let st = null;
  let root = null;
  let opener = null;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = () => window.matchMedia("(max-width: 900px)").matches;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function when(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
    return `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}${year} · ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function dist(m) {
    if (m == null || !Number.isFinite(Number(m))) return "";
    const n = Number(m);
    return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km`;
  }
  function gpsText(p) {
    const has = p.location_available !== false && p.lat != null && p.lng != null;
    if (!has) return { text: "Sem GPS", cls: "is-mu", href: "", note: "" };
    const d = dist(p.distance_m);
    const href = `https://maps.google.com/?q=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
    const note = p.location_source === "exif" ? "GPS da foto" : p.location_source === "device" ? "GPS do celular no envio" : "";
    if (p.far_from_job) return { text: `Longe do job${d ? ` · ${d}` : ""}`, cls: "is-hot", href, note };
    return { text: d ? `${d} do job` : "Com GPS", cls: "", href, note };
  }
  const TAKEN_NOTE = { exif: "pela câmera", file: "data do arquivo", upload: "hora do envio" };
  function shapesOf(p) {
    const a = p && p.annotations;
    return a && Array.isArray(a.shapes) ? a.shapes : [];
  }
  const cur = () => st.photos[st.index];

  // ------------------------------------------------------------------ ink (markup layer)
  /** Shapes are stored normalised (0..1) like the field app writes them; widths and text sizes are in
   *  px of a ~400px canvas, so they scale by min(width, height) / 400 here. */
  function inkSvg(shapes, w, h, extraCls) {
    const k = Math.min(w, h) / 400;
    const parts = shapes.map((s, idx) => {
      const c = esc(s.color || "#FF3B30");
      const sw = (Number(s.width) || 3) * k;
      const base = `stroke="${c}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
      if (s.type === "freehand" && Array.isArray(s.points)) {
        const pts = [];
        for (let i = 0; i + 1 < s.points.length; i += 2) pts.push(`${(s.points[i] * w).toFixed(1)},${(s.points[i + 1] * h).toFixed(1)}`);
        return `<polyline points="${pts.join(" ")}" ${base}/>`;
      }
      if (s.type === "arrow") {
        const x1 = s.x1 * w, y1 = s.y1 * h, x2 = s.x2 * w, y2 = s.y2 * h;
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const hl = Math.max(14 * k, sw * 3.2);
        const p1 = `${(x2 - hl * Math.cos(ang - 0.45)).toFixed(1)},${(y2 - hl * Math.sin(ang - 0.45)).toFixed(1)}`;
        const p2 = `${(x2 - hl * Math.cos(ang + 0.45)).toFixed(1)},${(y2 - hl * Math.sin(ang + 0.45)).toFixed(1)}`;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${base}/><polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${p1} ${p2}" fill="${c}" stroke="${c}" stroke-width="${(sw / 2).toFixed(2)}" stroke-linejoin="round"/>`;
      }
      if (s.type === "circle") return `<circle cx="${(s.cx * w).toFixed(1)}" cy="${(s.cy * h).toFixed(1)}" r="${(s.r * Math.min(w, h)).toFixed(1)}" ${base}/>`;
      if (s.type === "rect") {
        const x = Math.min(s.x, s.x + s.w) * w, y = Math.min(s.y, s.y + s.h) * h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.abs(s.w * w).toFixed(1)}" height="${Math.abs(s.h * h).toFixed(1)}" rx="${(2 * k).toFixed(1)}" ${base}/>`;
      }
      if (s.type === "text") {
        const fs = (Number(s.size) || 16) * k;
        const halo = c.toUpperCase() === "#1C1A17" ? "#FFFFFF" : "#000000";
        return `<text data-i="${idx}" x="${(s.x * w).toFixed(1)}" y="${(s.y * h).toFixed(1)}" fill="${c}" font-size="${fs.toFixed(1)}" font-weight="700" font-family="Geist, system-ui, sans-serif" stroke="${halo}" stroke-opacity=".55" stroke-width="${(fs * 0.14).toFixed(2)}" paint-order="stroke" stroke-linejoin="round">${esc(s.text || "")}</text>`;
      }
      return "";
    });
    return `<svg class="cv-ink${extraCls ? ` ${extraCls}` : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${parts.join("")}</svg>`;
  }

  // ------------------------------------------------------------------ layout + transform
  function els() {
    return {
      stage: root.querySelector(".cv-stage"),
      box: root.querySelector(".cv-box"),
      pan: root.querySelector(".cv-pan"),
      img: root.querySelector(".cv-img--full"),
      thumb: root.querySelector(".cv-img--thumb"),
    };
  }
  /** The image that gives the photo its size: the full one once it has loaded, the thumbnail before that. */
  function sizedImg() {
    const { img, thumb } = els();
    if (img && img.naturalWidth && img.classList.contains("is-in")) return img;
    if (thumb && thumb.naturalWidth) return thumb;
    return img && img.naturalWidth ? img : null;
  }

  /** Fit the photo inside the box (never cropped, never upscaled past 2x), then centre it. */
  function layout() {
    if (!st) return;
    const { box, pan } = els();
    const img = sizedImg();
    if (!box || !pan || !img) return;
    const bw = box.clientWidth, bh = box.clientHeight;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const fit = Math.min(bw / nw, bh / nh, 2);
    const w = Math.round(nw * fit), h = Math.round(nh * fit);
    st.v = { bw, bh, w, h, ox: (bw - w) / 2, oy: (bh - h) / 2, nw, nh };
    pan.style.width = `${w}px`;
    pan.style.height = `${h}px`;
    pan.style.left = `${st.v.ox}px`;
    pan.style.top = `${st.v.oy}px`;
    st.z = 1;
    st.tx = 0;
    st.ty = 0;
    apply(false);
    paintInk();
  }

  function apply(animate) {
    const { pan } = els();
    if (!pan) return;
    pan.style.transition = animate && !reduced() ? `transform 280ms ${EASE}` : "none";
    pan.style.transform = `translate3d(${st.tx}px, ${st.ty}px, 0) scale(${st.z})`;
    root.classList.toggle("is-zoomed", st.z > 1.01);
    const zl = root.querySelector("[data-cv-zl]");
    if (zl) zl.textContent = `${Math.round(st.z * 100)}%`;
  }

  /** Allowed translation for the current zoom: centred when smaller than the box, edge to edge when larger. */
  function bounds(z) {
    const v = st.v;
    const sw = v.w * z, sh = v.h * z;
    const bx = sw <= v.bw ? [(v.bw - sw) / 2 - v.ox, (v.bw - sw) / 2 - v.ox] : [v.bw - sw - v.ox, -v.ox];
    const by = sh <= v.bh ? [(v.bh - sh) / 2 - v.oy, (v.bh - sh) / 2 - v.oy] : [v.bh - sh - v.oy, -v.oy];
    return { bx, by };
  }
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  /** Past the edge the photo follows the finger less and less, instead of stopping dead. */
  function rubber(n, a, b, dim) {
    if (n < a) return a - band(a - n, dim);
    if (n > b) return b + band(n - b, dim);
    return n;
  }
  function band(over, dim) {
    return (over * dim * 0.55) / (dim + 0.55 * over);
  }
  function settle(animate) {
    st.z = clamp(st.z, 1, MAX_ZOOM);
    const { bx, by } = bounds(st.z);
    st.tx = clamp(st.tx, bx[0], bx[1]);
    st.ty = clamp(st.ty, by[0], by[1]);
    apply(animate);
  }
  /** Zoom to z keeping the box point (px, py) under the same spot of the photo. */
  function zoomAt(z, px, py, animate) {
    const v = st.v;
    const lx = (px - v.ox - st.tx) / st.z;
    const ly = (py - v.oy - st.ty) / st.z;
    st.z = z;
    st.tx = px - v.ox - z * lx;
    st.ty = py - v.oy - z * ly;
    settle(animate);
  }
  /** Read the live transform so a gesture that starts mid-animation picks the photo up where it is. */
  function grabLive() {
    const { pan } = els();
    if (!pan || pan.style.transition === "none") return;
    const m = new DOMMatrixReadOnly(getComputedStyle(pan).transform);
    st.z = m.a;
    st.tx = m.e;
    st.ty = m.f;
    apply(false);
  }
  function boxPoint(e) {
    const r = els().box.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ------------------------------------------------------------------ render
  function render() {
    renderStage();
    renderSide();
  }

  function renderStage() {
    const p = cur();
    const n = st.photos.length;
    const stage = STAGE[p.stage] || "Geral";
    const editing = !!st.edit;
    root.classList.toggle("is-editing", editing); // phones hide the details panel while marking up
    const strip =
      n > 1 && !editing
        ? `<div class="cv-strip" role="group" aria-label="Fotos">${st.photos
            .map((q, i) => `<button type="button" class="${i === st.index ? "is-on" : ""}" data-cv-i="${i}" aria-label="Foto ${i + 1}" aria-current="${i === st.index}"><img src="${esc(q.thumb_url || q.url)}" alt="" loading="lazy" decoding="async" draggable="false" /></button>`)
            .join("")}</div>`
        : "";
    const hasInk = shapesOf(p).length > 0;
    // The tile's thumbnail is already in the cache: it fills the screen at once, the full photo fades in over it.
    const thumb = p.thumb_url && p.thumb_url !== p.url ? p.thumb_url : "";
    root.querySelector(".cv-stage").innerHTML = `
      <div class="cv-top">
        <button type="button" class="cv-round" data-cv="close" aria-label="Fechar">${ICON.x}</button>
        <span class="cv-count">${n > 1 ? `${st.index + 1} de ${n}` : ""}</span>
        <span class="cv-top__acts">
          ${editing ? "" : `<span class="cv-zoom"><button type="button" class="cv-round cv-round--sm" data-cv="zout" aria-label="Diminuir zoom">${ICON.zoomOut}</button><button type="button" class="cv-zl" data-cv="zreset" data-cv-zl aria-label="Voltar ao tamanho da tela">100%</button><button type="button" class="cv-round cv-round--sm" data-cv="zin" aria-label="Aumentar zoom">${ICON.zoomIn}</button></span>`}
          ${hasInk && !editing ? `<button type="button" class="cv-round${st.showInk ? " is-on" : ""}" data-cv="ink" aria-pressed="${st.showInk}" aria-label="${st.showInk ? "Esconder marcações" : "Mostrar marcações"}">${st.showInk ? ICON.eye : ICON.eyeOff}</button>` : ""}
          <span class="cv-phone-acts">
            ${editing ? "" : `<button type="button" class="cv-round${st.sheet ? " is-on" : ""}" data-cv="info" aria-pressed="${!!st.sheet}" aria-label="${st.sheet ? "Esconder dados da foto" : "Ver dados da foto"}">${ICON.info}</button>`}
            ${canShareFiles() && !editing ? `<button type="button" class="cv-round" data-cv="share" aria-label="Compartilhar foto">${ICON.share}</button>` : ""}
            ${st.canPortfolio && p.id && !editing ? `<button type="button" class="cv-round${p.in_portfolio ? " is-on" : ""}" data-cv="port" aria-label="${p.in_portfolio ? "Tirar do portfólio" : "Pôr no portfólio"}">${ICON.star}</button>` : ""}
            ${st.canDelete && p.id && !editing ? `<button type="button" class="cv-round cv-round--danger" data-cv="del" aria-label="Apagar foto">${ICON.trash}</button>` : ""}
          </span>
        </span>
      </div>
      <div class="cv-box${editing ? " is-editing" : ""}">
        <div class="cv-pan">
          ${thumb ? `<img class="cv-img cv-img--thumb" src="${esc(thumb)}" alt="" aria-hidden="true" draggable="false" />` : ""}
          <img class="cv-img cv-img--full${thumb ? "" : " is-in"}" src="${esc(p.url)}" alt="${esc(p.caption || `Foto ${PHASE_LABEL[p.phase] || stage}`)}" draggable="false" decoding="async" />
          <div class="cv-inkwrap"></div>
        </div>
        <div class="cv-load" aria-hidden="true"></div>
      </div>
      ${n > 1 && !editing ? `<button type="button" class="cv-nav cv-nav--prev" data-cv="prev" aria-label="Foto anterior">${ICON.prev}</button><button type="button" class="cv-nav cv-nav--next" data-cv="next" aria-label="Próxima foto">${ICON.next}</button>` : ""}
      ${editing ? toolbarHtml() : strip}`;
    const { img, thumb: thumbEl } = els();
    const shownAt = st.index;
    const ready = () => {
      if (!st || st.index !== shownAt) return;
      root.querySelector(".cv-load")?.remove();
      if (!st.v || (st.z <= 1.01 && !g)) layout();
      if (st.onLaid) {
        const f = st.onLaid;
        st.onLaid = null;
        f();
      }
    };
    const fullIn = () => {
      if (!st || st.index !== shownAt) return;
      img.classList.add("is-in");
      ready();
      preloadAround();
    };
    if (thumbEl) {
      if (thumbEl.complete && thumbEl.naturalWidth) ready();
      else thumbEl.addEventListener("load", ready, { once: true });
    }
    if (img.complete && img.naturalWidth) fullIn();
    else {
      img.addEventListener("load", fullIn, { once: true });
      img.addEventListener("error", () => !thumbEl && root.querySelector(".cv-load")?.classList.add("is-err"), { once: true });
    }
    const on = root.querySelector(".cv-strip .is-on");
    if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
  }

  /** Warm the next and previous full photos, so a swipe lands on a sharp one. */
  function preloadAround() {
    if (!st || st.photos.length < 2) return;
    const n = st.photos.length;
    st.pre = [st.photos[(st.index + 1) % n], st.photos[(st.index - 1 + n) % n]]
      .filter((q) => q && q.url)
      .map((q) => {
        const im = new Image();
        im.decoding = "async";
        im.src = q.url;
        return im;
      });
  }

  function paintInk() {
    if (!st || !st.v) return;
    const wrap = root.querySelector(".cv-inkwrap");
    if (!wrap) return;
    const shapes = st.edit ? st.edit.shapes.concat(st.edit.preview ? [st.edit.preview] : []) : st.showInk ? shapesOf(cur()) : [];
    wrap.innerHTML = shapes.length ? inkSvg(shapes, st.v.nw, st.v.nh) : "";
  }

  /** The toolbar keeps one swatch (the current colour); tapping it opens the full palette above, so the bar never crowds. */
  function toolbarHtml() {
    const e = st.edit;
    const palette = e.palette
      ? `<div class="cv-palette" role="group" aria-label="Cores">${COLORS.map(([c, l]) => `<button type="button" class="cv-swatch${e.color.toLowerCase() === c.toLowerCase() ? " is-on" : ""}" data-cv-color="${c}" aria-pressed="${e.color.toLowerCase() === c.toLowerCase()}" aria-label="${l}" title="${l}" style="--sw:${c}"></button>`).join("")}
          <label class="cv-swatch cv-swatch--custom${COLORS.some(([c]) => c.toLowerCase() === e.color.toLowerCase()) ? "" : " is-on"}" title="Outra cor" style="--sw:${esc(e.color)}"><input type="color" data-cv-custom value="${esc(e.color.length === 7 ? e.color : "#ff3b30")}" aria-label="Escolher outra cor" /></label>
        </div>`
      : "";
    return `<div class="cv-toolwrap">${palette}<div class="cv-tools" role="toolbar" aria-label="Marcar foto">
      <span class="cv-tools__grp">${TOOLS.map(([k, l]) => `<button type="button" class="cv-tool${e.tool === k ? " is-on" : ""}" data-cv-tool="${k}" aria-pressed="${e.tool === k}" title="${l}" aria-label="${l}">${ICON[k]}</button>`).join("")}</span>
      <span class="cv-tools__grp"><button type="button" class="cv-swatch cv-swatch--cur" data-cv="palette" aria-expanded="${!!e.palette}" aria-label="Cor: ${esc(colorName(e.color))}. Mudar cor" title="Cor" style="--sw:${esc(e.color)}"></button>
        <button type="button" class="cv-tool cv-tool--w" data-cv-w aria-label="Espessura: ${e.width > 4 ? "grossa" : "fina"}" title="Espessura"><i style="height:${e.width > 4 ? 6 : 3}px"></i></button></span>
      <span class="cv-tools__grp">
        <button type="button" class="cv-tool" data-cv="undo" aria-label="Desfazer"${e.shapes.length || e.hist.length ? "" : " disabled"}>${ICON.undo}</button>
        <button type="button" class="cv-tool" data-cv="redo" aria-label="Refazer"${e.redo.length ? "" : " disabled"}>${ICON.redo}</button>
        <button type="button" class="cv-tool cv-tool--txt" data-cv="clear"${e.shapes.length ? "" : " disabled"}>Limpar</button>
      </span>
      <span class="cv-tools__grp cv-tools__end">
        <button type="button" class="cv-btn cv-btn--ghost" data-cv="edit-cancel"${e.saving ? " disabled" : ""}>Cancelar</button>
        <button type="button" class="cv-btn cv-btn--pri" data-cv="edit-save"${e.saving ? " disabled" : ""}>${e.saving ? "Salvando…" : "Salvar"}</button>
      </span>
    </div></div>`;
  }

  function renderSide() {
    const p = cur();
    const job = p.job || {};
    const g = gpsText(p);
    const n = st.photos.length;
    const sub = [job.name && job.title && job.title !== job.name ? job.title : job.name ? "" : job.client, p.address].filter(Boolean).join(" · ");
    const takenBy = p.taken_by_name || p.author || "";
    const uploader = p.uploaded_by_name || p.author || "";
    const camera = p.camera_model || "";
    const canEdit = st.canEdit && p.id;
    const shapes = shapesOf(p);
    const people = st.people || [];
    const takenSel =
      canEdit && st.onTakenBy && people.length > 1
        ? `<select class="cv-select" data-cv-takenby aria-label="Quem tirou a foto">${people
            .map((u) => `<option value="${esc(u.id)}"${String(u.id) === String(p.taken_by_id || "") ? " selected" : ""}>${esc(u.name || "—")}</option>`)
            .join("")}${p.taken_by_id && !people.some((u) => String(u.id) === String(p.taken_by_id)) ? `<option selected>${esc(takenBy)}</option>` : ""}</select>`
        : esc(takenBy || "—");
    const side = root.querySelector(".cv-side");
    const scroll = side.scrollTop;
    // An unsaved note survives a repaint (people list arriving, stage change): keep the text and the caret.
    const oldNote = side.querySelector("#cvNote");
    const draft = oldNote && oldNote.dataset.for === String(p.id) && oldNote.value !== (p.caption || "") ? { v: oldNote.value, focus: document.activeElement === oldNote, at: oldNote.selectionStart } : null;
    if (st.focus && phone() && canEdit) {
      side.innerHTML = focusHtml(p, canEdit);
      const nt = side.querySelector("#cvNote");
      if (draft && nt) nt.value = draft.v;
      return;
    }
    side.innerHTML = `
      <button type="button" class="cv-grab" data-cv="sheet" aria-expanded="${!!st.sheet}" aria-label="${st.sheet ? "Recolher dados da foto" : "Ver todos os dados da foto"}"><i></i></button>
      <header class="cv-job">
        ${job.number != null ? `<small>Job #${esc(job.number)}${n > 1 ? ` · foto ${st.index + 1} de ${n}` : ""}</small>` : ""}
        <h2 id="cvTitle">${esc(job.name || job.title || "Foto")}</h2>
        ${sub ? `<p title="${esc(sub)}">${esc(sub)}</p>` : ""}
      </header>
      ${st.onPhase && p.id && (p.phases || []).length
        ? phaseHtml(p)
        : st.canStage && p.id
        ? `<div class="cv-stages" role="group" aria-label="Etapa da foto">${STAGES.map(([k, l]) => `<button type="button" class="${(p.stage || "") === k ? "is-on" : ""}" data-cv-stage="${k}" aria-pressed="${(p.stage || "") === k}"${st.busy ? " disabled" : ""}>${l}</button>`).join("")}</div>`
        : `<div class="cv-chips"><span class="cv-pill">${esc((p.phase && phaseLabel(p, p.phase)) || STAGE[p.stage] || "Geral")}</span></div>`}
      ${canEdit ? quickHtml(p, shapes) : ""}
      <dl class="cv-kv">
        <dt>Tirada</dt><dd>${esc(when(p.taken_at_device || p.created_at))}${TAKEN_NOTE[p.taken_at_source] ? `<small>${TAKEN_NOTE[p.taken_at_source]}</small>` : ""}</dd>
        <dt>Tirada por</dt><dd>${takenSel}</dd>
        ${uploader ? `<dt>Enviada</dt><dd>${esc(uploader)}<small>${esc(when(p.created_at))}</small></dd>` : ""}
        ${camera || p.device ? `<dt>Câmera</dt><dd>${esc(camera || p.device)}${camera && p.device ? `<small>${esc(p.device)}</small>` : ""}</dd>` : ""}
        <dt>Local</dt><dd class="${g.cls}">${g.href ? `<a href="${esc(g.href)}" target="_blank" rel="noopener">${ICON.pin}${esc(g.text)}</a>` : esc(g.text)}${g.note ? `<small>${g.note}</small>` : ""}</dd>
      </dl>
      <section class="cv-note">
        <label for="cvNote">${ICON.note}Nota</label>
        ${canEdit && st.onNote
          ? `<textarea id="cvNote" rows="3" maxlength="500" data-crm-rich="off" data-for="${esc(p.id)}" placeholder="Ex.: rodapé solto perto da porta da cozinha">${esc(p.caption || "")}</textarea><span class="cv-note__st" role="status" aria-live="polite"></span>`
          : `<p class="${p.caption ? "" : "is-mu"}">${esc(p.caption || "Sem nota")}</p>`}
      </section>
      ${stickersHtml(p, canEdit)}
      ${canEdit && st.onAnnotate
        ? `<button type="button" class="cv-btn cv-btn--mark" data-cv="edit"${st.edit ? " disabled" : ""}>${ICON.pen}${shapes.length ? `Editar marcações <em>${shapes.length}</em>` : "Marcar foto"}</button>`
        : ""}
      <div class="cv-sp"></div>
      <div class="cv-acts">
        ${job.id ? `<a class="cv-btn cv-btn--pri" href="job-detail.html?id=${encodeURIComponent(job.id)}#fotos">Abrir job</a>` : ""}
        <div class="cv-row">
          ${st.canPortfolio && p.id ? `<button type="button" class="cv-btn cv-desk" data-cv="port" aria-pressed="${!!p.in_portfolio}">${ICON.star}${p.in_portfolio ? "No portfólio" : "Portfólio"}</button>` : ""}
          ${canShareFiles() ? `<button type="button" class="cv-btn cv-desk" data-cv="share">${ICON.share}Compartilhar</button>` : ""}
          <button type="button" class="cv-btn" data-cv="download"${shapes.length ? ' title="Baixa a foto com as marcações" aria-label="Baixar com marcações"' : ""}>${ICON.dl}Baixar</button>
        </div>
        ${st.canDelete && p.id ? `<button type="button" class="cv-btn cv-btn--danger cv-desk" data-cv="del">${ICON.trash}Apagar foto</button>` : ""}
      </div>`;
    side.scrollTop = scroll;
    const note = side.querySelector("#cvNote");
    if (draft && note) {
      note.value = draft.v;
      if (draft.focus) {
        note.focus({ preventScroll: true });
        note.setSelectionRange(draft.at, draft.at);
      }
    }
  }

  function focusHtml(p, canEdit) {
    const title = st.focus === "note" ? "Nota" : "Etiquetas";
    const body =
      st.focus === "note"
        ? `<section class="cv-note"><textarea id="cvNote" rows="4" maxlength="500" data-crm-rich="off" data-for="${esc(p.id)}" aria-label="Nota da foto" placeholder="Ex.: rodapé solto perto da porta da cozinha">${esc(p.caption || "")}</textarea><span class="cv-note__st" role="status" aria-live="polite"></span></section>`
        : stickersHtml(p, canEdit).replace('class="cv-stks"', 'class="cv-stks cv-stks--focus"');
    return `<div class="cv-focus" role="group" aria-labelledby="cvFocusT">
      <div class="cv-focus__h"><b id="cvFocusT">${st.focus === "note" ? ICON.note : ICON.tag}${title}</b>
        ${st.focus === "stickers" && st.onManageStickers ? `<button type="button" class="cv-link" data-cv="stk-manage">Gerenciar</button>` : ""}
        <button type="button" class="cv-btn cv-btn--pri cv-btn--sm" data-cv="focus-done">Concluído</button></div>
      ${body}
    </div>`;
  }

  /** Job phase of the photo: worked out from its date unless corrected; the job's phases in work order. */
  function phaseHtml(p) {
    const list = (p.phases || []).concat(p.phase && !(p.phases || []).includes(p.phase) ? [p.phase] : []);
    const byPhases = p.phase_mode === "phases";
    return `<div class="cv-phase">
      <div class="cv-phases" role="group" aria-label="Fase da foto" data-no-i18n>${list.map((k) => `<button type="button" class="${p.phase === k ? "is-on" : ""}" data-cv-phase="${k}" aria-pressed="${p.phase === k}"${st.busy ? " disabled" : ""}>${esc(phaseLabel(p, k))}</button>`).join("")}</div>
      <small class="cv-phase__src">${p.phase_source === "manual"
        ? `Corrigida à mão · <button type="button" class="cv-link" data-cv-phase-auto${st.busy ? " disabled" : ""}>${byPhases ? "usar a automática" : "usar a da data"}</button>`
        : p.phase_source === "proof" ? "Prova desta fase do job"
        : byPhases ? (p.phase ? "Pela fase aberta quando a foto foi tirada" : "O job ainda não tem fases")
        : p.phase ? "Pela data da foto e as datas do job" : "Sem datas no job para definir a fase"}</small>
    </div>`;
  }

  /** Phones: the panel starts collapsed, so the edits that matter most stay one tap away. */
  function quickHtml(p, shapes) {
    const n = (p.sticker_ids || []).length;
    return `<div class="cv-quick" role="group" aria-label="Editar foto">
      ${st.onAnnotate ? `<button type="button" data-cv="edit">${ICON.pen}<span>Marcar${shapes.length ? ` <em>${shapes.length}</em>` : ""}</span></button>` : ""}
      ${st.onNote ? `<button type="button" data-cv="q-note">${ICON.note}<span>Nota${p.caption ? " <em>•</em>" : ""}</span></button>` : ""}
      ${st.onStickers ? `<button type="button" data-cv="q-stk">${ICON.tag}<span>Etiquetas${n ? ` <em>${n}</em>` : ""}</span></button>` : ""}
    </div>`;
  }

  /** Etiquetas (stickers in the code and the API): toggle chips for people who edit, plain badges for everyone else. */
  function stickersHtml(p, canEdit) {
    const all = (st.stickers || []).filter((x) => !x.archived || (p.sticker_ids || []).includes(x.id));
    const on = new Set(p.sticker_ids || []);
    if (!all.length && !canEdit) return "";
    const editable = canEdit && st.onStickers;
    const chips = editable
      ? all.map((x) => `<button type="button" class="cv-stk${on.has(x.id) ? " is-on" : ""}" data-cv-stk="${esc(x.id)}" aria-pressed="${on.has(x.id)}" style="--stk:${esc(x.color)}"${st.busy ? " disabled" : ""}><i aria-hidden="true"></i>${esc(x.name)}</button>`).join("")
      : all.filter((x) => on.has(x.id)).map((x) => `<span class="cv-stk is-on" style="--stk:${esc(x.color)}"><i aria-hidden="true"></i>${esc(x.name)}</span>`).join("");
    if (!editable && !chips) return "";
    return `<section class="cv-stks" id="cvStickers">
      <div class="cv-stks__h"><span>${ICON.tag}Etiquetas</span>${editable && st.onManageStickers ? `<button type="button" class="cv-link" data-cv="stk-manage">Gerenciar</button>` : ""}</div>
      <div class="cv-stks__list" data-no-i18n>${chips || '<span class="cv-mu">Nenhuma etiqueta criada.</span>'}</div>
    </section>`;
  }

  // ------------------------------------------------------------------ gestures
  const ptrs = new Map();
  let g = null; // current gesture
  let lastTap = null;

  function onDown(e) {
    if (!st || e.button > 0) return;
    if (!e.target.closest(".cv-box")) return;
    // a finger on the photo while it is still flying in: land it now, then the gesture starts from rest
    if (st.openAnim) {
      try {
        st.openAnim.finish();
      } catch (_) {}
      st.openAnim = null;
    }
    if (e.target.closest("input")) return;
    const box = els().box;
    box.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    grabLive();
    if (st.edit) {
      if (ptrs.size === 1) startInk(e);
      return;
    }
    const pt = boxPoint(e);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      g = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), z0: st.z, mid0: mid(a, b), tx0: st.tx, ty0: st.ty };
      return;
    }
    g = { kind: "pending", x0: e.clientX, y0: e.clientY, tx0: st.tx, ty0: st.ty, pt, hist: [{ x: e.clientX, y: e.clientY, t: performance.now() }], moved: false };
  }

  function mid(a, b) {
    const r = els().box.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  }

  function onMove(e) {
    if (!st || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.edit) return moveInk(e);
    if (!g) return;
    if (g.kind === "pinch" && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = mid(a, b);
      let z = (g.z0 * d) / (g.d0 || 1);
      if (z < 1) z = 1 - band(1 - z, 1) * 0.6;
      if (z > MAX_ZOOM) z = MAX_ZOOM + band(z - MAX_ZOOM, MAX_ZOOM) * 0.3;
      const v = st.v;
      const lx = (g.mid0.x - v.ox - g.tx0) / g.z0;
      const ly = (g.mid0.y - v.oy - g.ty0) / g.z0;
      st.z = z;
      st.tx = m.x - v.ox - z * lx;
      st.ty = m.y - v.oy - z * ly;
      apply(false);
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    g.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (g.hist.length > 6) g.hist.shift();
    if (g.kind === "pending") {
      if (Math.hypot(dx, dy) < 10) return;
      g.moved = true;
      if (st.z > 1.01) g.kind = "pan";
      else if (Math.abs(dx) > Math.abs(dy)) g.kind = st.photos.length > 1 ? "swipe" : "pan";
      else g.kind = dy > 0 && phone() ? "dismiss" : "pan";
    }
    const { bx, by } = bounds(st.z);
    if (g.kind === "pan") {
      st.tx = rubber(g.tx0 + dx, bx[0], bx[1], st.v.bw);
      st.ty = rubber(g.ty0 + dy, by[0], by[1], st.v.bh);
      apply(false);
    } else if (g.kind === "swipe") {
      st.tx = g.tx0 + dx;
      apply(false);
    } else if (g.kind === "dismiss") {
      st.ty = g.ty0 + Math.max(0, dy);
      apply(false);
      root.style.setProperty("--cv-fade", String(Math.max(0.35, 1 - dy / 500)));
    }
  }

  function velocity() {
    const h = g && g.hist;
    if (!h || h.length < 2) return { vx: 0, vy: 0 };
    const a = h[0], b = h[h.length - 1];
    const dt = Math.max(1, b.t - a.t);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  function onUp(e) {
    if (!st || !ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (st.edit) return endInk(e);
    if (!g) return;
    if (g.kind === "pinch") {
      if (ptrs.size === 1) {
        const [only] = [...ptrs.values()];
        g = { kind: "pan", x0: only.x, y0: only.y, tx0: st.tx, ty0: st.ty, hist: [{ x: only.x, y: only.y, t: performance.now() }], moved: true };
        return;
      }
      g = null;
      settle(true);
      return;
    }
    const kind = g.kind;
    const { vx, vy } = velocity();
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const pt = g.pt;
    g = null;
    if (kind === "pending") {
      // A tap: two quick taps zoom in or back out; a tap beside the photo closes on wide screens.
      const now = performance.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 24) {
        lastTap = null;
        if (st.z > 1.01) {
          st.z = 1;
          st.tx = 0;
          st.ty = 0;
          apply(true);
        } else zoomAt(2.5, pt.x, pt.y, true);
        return;
      }
      lastTap = { t: now, x: pt.x, y: pt.y };
      if (!phone() && st.z <= 1.01 && !e.target.closest(".cv-pan")) {
        setTimeout(() => {
          if (lastTap && performance.now() - lastTap.t >= 280) close();
        }, 300);
      }
      return;
    }
    if (kind === "swipe") {
      const far = Math.abs(dx) > st.v.bw * 0.22 || Math.abs(vx) > 0.5;
      if (far && Math.sign(dx || vx) !== 0) {
        slideAway(dx < 0 || (dx === 0 && vx < 0) ? 1 : -1);
        return;
      }
      st.tx = 0;
      apply(true);
      return;
    }
    if (kind === "dismiss") {
      if (dy > 120 || vy > 0.6) {
        close(false, { swipe: { vy } });
        return;
      }
      st.ty = 0;
      root.style.removeProperty("--cv-fade");
      apply(true);
      return;
    }
    // pan: carry a little momentum, then settle inside the edges
    if (!reduced()) {
      st.tx += vx * 120;
      st.ty += vy * 120;
    }
    settle(true);
  }

  /** The photo leaves the way the finger threw it, and the next one comes in from the other side. */
  function slideAway(dir) {
    const { pan } = els();
    if (!pan || reduced()) return go(dir);
    st.tx = -dir * (st.v.bw + 40);
    apply(true);
    pan.addEventListener("transitionend", () => go(dir, -dir), { once: true });
  }

  function onWheel(e) {
    if (!st || st.edit || !e.target.closest(".cv-box")) return;
    e.preventDefault();
    grabLive();
    const pt = boxPoint(e);
    const z = clamp(st.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), 1, MAX_ZOOM);
    zoomAt(z, pt.x, pt.y, false);
  }

  // ------------------------------------------------------------------ markup editing
  function norm(e) {
    const r = els().pan.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  }
  /** Index of the text shape under the pointer (with a little slack for fingers), or -1. */
  function textAt(e) {
    const pad = e.pointerType === "mouse" ? 4 : 12;
    const hits = [...root.querySelectorAll(".cv-inkwrap text[data-i]")].filter((t) => {
      const r = t.getBoundingClientRect();
      return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
    });
    return hits.length ? Number(hits[hits.length - 1].getAttribute("data-i")) : -1;
  }
  function startInk(e) {
    const ed = st.edit;
    const p = norm(e);
    // Any text already on the photo can be picked up and moved, whatever tool is active.
    const ti = textAt(e);
    if (ti >= 0 && ed.shapes[ti] && ed.shapes[ti].type === "text") {
      const t = ed.shapes[ti];
      ed.dragText = { i: ti, start: p, x0: t.x, y0: t.y, moved: false, before: { x: t.x, y: t.y } };
      root.querySelector(".cv-box")?.classList.add("is-dragging");
      return;
    }
    if (ed.tool === "text") {
      ed.pendingText = p;
      return;
    }
    ed.drawing = { start: p, points: [p.x, p.y] };
  }
  function moveInk(e) {
    const ed = st.edit;
    if (ed.dragText) {
      const d = ed.dragText;
      const p = norm(e);
      const t = ed.shapes[d.i];
      if (Math.hypot((p.x - d.start.x) * st.v.w, (p.y - d.start.y) * st.v.h) > 3) d.moved = true;
      t.x = clamp(d.x0 + (p.x - d.start.x), 0, 1);
      t.y = clamp(d.y0 + (p.y - d.start.y), 0.02, 1);
      paintInk();
      return;
    }
    if (!ed.drawing) return;
    const p = norm(e);
    const s = ed.drawing.start;
    const base = { id: "tmp", color: ed.color, width: ed.width };
    if (ed.tool === "freehand") {
      ed.drawing.points.push(p.x, p.y);
      ed.preview = { ...base, type: "freehand", points: ed.drawing.points };
    } else if (ed.tool === "arrow") ed.preview = { ...base, type: "arrow", x1: s.x, y1: s.y, x2: p.x, y2: p.y };
    else if (ed.tool === "rect") ed.preview = { ...base, type: "rect", x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y };
    else if (ed.tool === "circle") {
      const v = st.v;
      const r = Math.hypot((p.x - s.x) * v.nw, (p.y - s.y) * v.nh) / Math.min(v.nw, v.nh);
      ed.preview = { ...base, type: "circle", cx: s.x, cy: s.y, r };
    }
    paintInk();
  }
  function endInk(e) {
    const ed = st.edit;
    if (ed.dragText) {
      const d = ed.dragText;
      ed.dragText = null;
      root.querySelector(".cv-box")?.classList.remove("is-dragging");
      if (d.moved) {
        ed.redo = [];
        ed.hist.push({ t: "move", i: d.i, x: d.before.x, y: d.before.y });
      } else if (ed.tool === "text") {
        // a tap on a text with the Text tool edits its words
        askText({ x: ed.shapes[d.i].x, y: ed.shapes[d.i].y }, e, d.i);
      }
      paintInk();
      refreshTools();
      return;
    }
    if (ed.pendingText) {
      const at = ed.pendingText;
      ed.pendingText = null;
      askText(at, e);
      return;
    }
    if (!ed.drawing) return;
    const shape = ed.preview;
    ed.drawing = null;
    ed.preview = null;
    const tiny =
      !shape ||
      (shape.type === "freehand" && shape.points.length < 6) ||
      (shape.type === "arrow" && Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) < 0.01) ||
      (shape.type === "rect" && (Math.abs(shape.w) < 0.005 || Math.abs(shape.h) < 0.005)) ||
      (shape.type === "circle" && shape.r < 0.005);
    if (!tiny) {
      ed.shapes.push({ ...shape, id: `${shape.type[0]}-${Date.now()}` });
      ed.hist.push({ t: "add" });
      ed.redo = [];
    }
    paintInk();
    refreshTools();
  }
  /** Text goes in where it was tapped, typed in place (no browser prompt). */
  function askText(at, e, editIndex) {
    const { box } = els();
    const r = box.getBoundingClientRect();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cv-textin";
    input.maxLength = 80;
    input.placeholder = "Escreva e aperte Enter";
    const editing = editIndex != null && st.edit.shapes[editIndex];
    if (editing) input.value = editing.text || "";
    input.style.left = `${clamp(e.clientX - r.left, 8, r.width - 220)}px`;
    input.style.top = `${clamp(e.clientY - r.top - 20, 8, r.height - 48)}px`;

    box.appendChild(input);
    let done = false;
    const commit = (keep) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      if (editing && st && st.edit) {
        // editing words in place: empty removes the text
        if (keep && text) editing.text = text;
        else if (keep && !text) st.edit.shapes.splice(editIndex, 1);
        paintInk();
        refreshTools();
        return;
      }
      if (keep && text && st && st.edit) {
        st.edit.hist.push({ t: "add" });
        st.edit.shapes.push({ id: `t-${Date.now()}`, type: "text", color: st.edit.color, x: at.x, y: at.y, text, size: st.edit.width > 4 ? 26 : 18 });
        st.edit.redo = [];
        paintInk();
        refreshTools();
      }
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") commit(true);
      else if (ev.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
    input.focus({ preventScroll: true });
  }
  function refreshTools() {
    const t = root.querySelector(".cv-toolwrap");
    if (t && st.edit) t.outerHTML = toolbarHtml();
  }
  function startEdit() {
    const p = cur();
    if (st.focus) {
      st.focus = null;
      root.classList.remove("is-focus");
      root.classList.toggle("is-peek", !st.sheet);
    }
    st.edit = { tool: "arrow", color: COLORS[0][0], width: 3, shapes: JSON.parse(JSON.stringify(shapesOf(p))), redo: [], hist: [], saving: false };
    render();
  }
  async function saveEdit() {
    const ed = st.edit;
    const p = cur();
    ed.saving = true;
    refreshTools();
    const doc = ed.shapes.length ? { version: 1, shapes: ed.shapes.map(({ id, ...s }) => ({ id: String(id).startsWith("tmp") ? undefined : id, ...s })) } : null;
    try {
      const res = await st.onAnnotate(p, doc);
      p.annotations = res && "annotations" in res ? res.annotations : doc;
      st.edit = null;
      st.showInk = true;
      render();
      window.crmToast?.success?.(doc ? "Marcações salvas" : "Marcações removidas");
    } catch (err) {
      ed.saving = false;
      refreshTools();
      window.crmToast?.error?.(err.message || "Não foi possível salvar as marcações");
    }
  }

  /** The photo as it is seen: the original, or with the markup drawn on top at full resolution (a canvas). */
  async function markedCanvas(p) {
    const shapes = shapesOf(p);
    const img = await loadImg(p.url);
    const w = img.naturalWidth, h = img.naturalHeight;
    const svg = inkSvg(shapes, w, h).replace('class="cv-ink"', `width="${w}" height="${h}"`);
    const ink = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    ctx.drawImage(ink, 0, 0, w, h);
    return c;
  }

  /** "Baixar marcada": the original photo with the markup drawn on top, at full resolution. */
  async function download() {
    const p = cur();
    const shapes = shapesOf(p);
    const name = photoName(p);
    const save = (href) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (!shapes.length) return save(p.url);
    try {
      save((await markedCanvas(p)).toDataURL("image/jpeg", 0.9));
    } catch (_) {
      window.crmToast?.error?.("Não deu para gerar a versão marcada; baixando a original.");
      save(p.url);
    }
  }

  /** "Compartilhar": the system share sheet (WhatsApp, Mensagens, Salvar imagem…); falls back to the download. */
  async function share() {
    const p = cur();
    let blob = null;
    if (shapesOf(p).length) {
      try {
        const c = await markedCanvas(p);
        blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
      } catch (_) {}
    }
    const r = await sharePhotos([{ url: p.url, blob, name: photoName(p) }]);
    if (r === "unsupported" || r === "failed") {
      if (r === "failed") window.crmToast?.info?.("Não deu para compartilhar; a foto vai ser baixada.");
      download();
    }
  }
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      if (!src.startsWith("data:")) im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = src;
    });
  }

  // ------------------------------------------------------------------ clicks + keys
  async function onClick(e) {
    if (!st) return;
    const sb = e.target.closest("[data-cv-stage]");
    if (sb && st.onStage) {
      const p = cur();
      const next = sb.getAttribute("data-cv-stage") || null;
      if ((p.stage || null) === next || st.busy) return;
      st.busy = true;
      renderSide();
      try {
        const res = await st.onStage(p, next);
        p.stage = res && "stage" in res ? res.stage : next;
      } catch (err) {
        window.crmToast?.error?.(err.message || "Não foi possível mudar a etapa");
      }
      if (!st) return;
      st.busy = false;
      renderSide();
      root.querySelector(`[data-cv-stage="${p.stage || ""}"]`)?.focus();
      return;
    }
    const ph = e.target.closest("[data-cv-phase], [data-cv-phase-auto]");
    if (ph && st.onPhase) {
      const p = cur();
      const next = ph.hasAttribute("data-cv-phase-auto") ? null : ph.getAttribute("data-cv-phase");
      if (next && next === p.phase && p.phase_source === "manual") return;
      st.busy = true;
      renderSide();
      try {
        const res = await st.onPhase(p, next);
        if (res) Object.assign(p, { phase: res.phase || null, phase_label: res.phase_label || null, phase_source: res.phase_source || null });
        window.crmToast?.success?.(next ? `Fase: ${phaseLabel(p, next)}` : p.phase_mode === "phases" ? "Fase automática" : "Fase pela data da foto");
      } catch (err) {
        window.crmToast?.error?.(err.message || "Não foi possível mudar a fase");
      }
      if (!st) return;
      st.busy = false;
      renderSide();
      return;
    }
    const stk = e.target.closest("[data-cv-stk]");
    if (stk && st.onStickers) {
      const p = cur();
      const id = stk.getAttribute("data-cv-stk");
      const prev = (p.sticker_ids || []).slice();
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id);
      p.sticker_ids = next; // optimistic: the chip flips at once
      renderSide();
      try {
        const res = await st.onStickers(p, next);
        if (res && Array.isArray(res.sticker_ids)) p.sticker_ids = res.sticker_ids;
      } catch (err) {
        p.sticker_ids = prev;
        window.crmToast?.error?.(err.message || "Não foi possível mudar as etiquetas");
      }
      if (st) renderSide();
      root.querySelector(`[data-cv-stk="${CSS.escape(id)}"]`)?.focus();
      return;
    }
    const tool = e.target.closest("[data-cv-tool]");
    if (tool && st.edit) {
      st.edit.tool = tool.getAttribute("data-cv-tool");
      return refreshTools();
    }
    const sw = e.target.closest("[data-cv-color]");
    if (sw && st.edit) {
      st.edit.color = sw.getAttribute("data-cv-color");
      st.edit.palette = false;
      return refreshTools();
    }
    if (e.target.closest("[data-cv-w]") && st.edit) {
      st.edit.width = st.edit.width > 4 ? 3 : 6;
      return refreshTools();
    }
    const b = e.target.closest("[data-cv],[data-cv-i]");
    if (!b) return;
    if (b.hasAttribute("data-cv-i")) {
      flushNote();
      st.index = Number(b.getAttribute("data-cv-i")) || 0;
      render();
      return;
    }
    const a = b.getAttribute("data-cv");
    const p = cur();
    if (a === "close") close();
    else if (a === "prev") go(-1);
    else if (a === "next") go(1);
    else if (a === "zin") zoomAt(clamp(st.z * 1.6, 1, MAX_ZOOM), st.v.bw / 2, st.v.bh / 2, true);
    else if (a === "zout") zoomAt(clamp(st.z / 1.6, 1, MAX_ZOOM), st.v.bw / 2, st.v.bh / 2, true);
    else if (a === "zreset") {
      st.z = 1;
      st.tx = 0;
      st.ty = 0;
      apply(true);
    } else if (a === "palette" && st.edit) {
      st.edit.palette = !st.edit.palette;
      refreshTools();
    } else if (a === "q-note" || a === "q-stk") {
      openFocus(a === "q-note" ? "note" : "stickers");
    } else if (a === "focus-done") {
      closeFocus();
    } else if (a === "info") {
      // phones: ⓘ opens the photo's details; tapping it again folds them back
      st.focus = null;
      st.sheet = !st.sheet;
      syncPanel();
    } else if (a === "stk-manage" && st.onManageStickers) {
      st.onManageStickers();
    } else if (a === "sheet") {
      // phones: the details panel starts as a short peek so the photo gets the room; the handle opens it
      st.focus = null;
      st.sheet = !st.sheet;
      syncPanel();
    } else if (a === "ink") {
      st.showInk = !st.showInk;
      renderStage();
    } else if (a === "edit") startEdit();
    else if (a === "edit-cancel") {
      st.edit = null;
      render();
    } else if (a === "edit-save") saveEdit();
    else if (a === "undo" && st.edit) {
      // the last thing done goes back: a move returns the text to where it was, otherwise the last shape comes off
      const last = st.edit.hist.length ? st.edit.hist[st.edit.hist.length - 1] : null;
      if (last && last.t === "move" && st.edit.shapes[last.i]) {
        st.edit.hist.pop();
        Object.assign(st.edit.shapes[last.i], { x: last.x, y: last.y });
      } else {
        if (last) st.edit.hist.pop();
        const s = st.edit.shapes.pop();
        if (s) st.edit.redo.push(s);
      }
      paintInk();
      refreshTools();
    } else if (a === "redo" && st.edit) {
      const s = st.edit.redo.pop();
      if (s) st.edit.shapes.push(s);
      paintInk();
      refreshTools();
    } else if (a === "clear" && st.edit) {
      st.edit.redo = st.edit.shapes.slice().reverse();
      st.edit.shapes = [];
      st.edit.hist = [];
      paintInk();
      refreshTools();
    } else if (a === "download") download();
    else if (a === "share") share();
    else if (a === "port" && st.onPortfolio) {
      try {
        const res = await st.onPortfolio(p, !p.in_portfolio);
        p.in_portfolio = res && typeof res.in_portfolio === "boolean" ? res.in_portfolio : !p.in_portfolio;
        render();
      } catch (err) {
        window.crmToast?.error?.(err.message || "Erro");
      }
    } else if (a === "del" && st.onDelete) {
      if (!p?.id) return;
      const ok = await window.crmConfirm({
        title: "Apagar esta foto?",
        text: "Ela sai do job e do ObraCam.",
        ok: "Apagar foto",
        danger: true,
      });
      if (!ok) return;
      try {
        await st.onDelete(p);
        st.photos.splice(st.index, 1);
        if (!st.photos.length) {
          close();
          return;
        }
        if (st.index >= st.photos.length) st.index = st.photos.length - 1;
        render();
      } catch (err) {
        window.crmToast?.error?.(err.message || "Erro");
      }
    }
  }

  async function saveNote(area) {
    if (!st) return;
    const p = cur();
    const text = area.value.trim();
    if (text === (p.caption || "").trim() || !st.onNote) return;
    const status = root.querySelector(".cv-note__st");
    if (status) status.textContent = "Salvando…";
    try {
      const res = await st.onNote(p, text || null);
      p.caption = res && "caption" in res ? res.caption : text || null;
      if (status) status.textContent = "Nota salva";
    } catch (err) {
      if (status) status.textContent = err.message || "Não foi possível salvar a nota";
    }
  }

  function onKey(e) {
    if (!st || root.hidden) return;
    // a sheet over the viewer (etiquetas) already took this Escape
    if (e.defaultPrevented) return;
    const typing = e.target.closest && e.target.closest("textarea, input, select");
    if (e.key === "Escape") {
      if (st.focus) return closeFocus();
      if (st.edit && st.edit.palette) {
        st.edit.palette = false;
        return refreshTools();
      }
      if (typing) return e.target.blur();
      if (st.edit) {
        st.edit = null;
        return render();
      }
      return close();
    }
    if (typing) {
      if (e.target.id === "cvNote" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.target.blur();
      return;
    }
    if (e.key === "Tab") return trapFocus(e);
    if (st.edit) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        root.querySelector(e.shiftKey ? '[data-cv="redo"]' : '[data-cv="undo"]')?.click();
      }
      return;
    }
    if (e.key === "ArrowLeft" && st.z <= 1.01) go(-1);
    else if (e.key === "ArrowRight" && st.z <= 1.01) go(1);
    else if (e.key === "+" || e.key === "=") zoomAt(clamp(st.z * 1.4, 1, MAX_ZOOM), st.v.bw / 2, st.v.bh / 2, true);
    else if (e.key === "-") zoomAt(clamp(st.z / 1.4, 1, MAX_ZOOM), st.v.bw / 2, st.v.bh / 2, true);
    else if (e.key === "0") {
      st.z = 1;
      st.tx = 0;
      st.ty = 0;
      apply(true);
    }
  }
  function trapFocus(e) {
    const f = [...root.querySelectorAll("button:not([disabled]), a[href], textarea, select, input")].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function ensure() {
    if (root) return root;
    root = document.createElement("div");
    root.className = "cv";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "cvTitle");
    root.innerHTML = `<div class="cv-bg" aria-hidden="true"></div><div class="cv-stage"></div><aside class="cv-side" aria-label="Dados da foto"></aside>`;
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("dblclick", (e) => e.preventDefault());
    root.addEventListener("focusout", (e) => {
      if (e.target.id === "cvNote" && st && !root.hidden) saveNote(e.target);
    });
    root.addEventListener("input", (e) => {
      if (!e.target.matches("[data-cv-custom]") || !st || !st.edit) return;
      st.edit.color = e.target.value.toUpperCase();
      root.querySelector(".cv-swatch--custom")?.style.setProperty("--sw", st.edit.color);
      root.querySelector(".cv-swatch--cur")?.style.setProperty("--sw", st.edit.color);
    });
    root.addEventListener("change", async (e) => {
      if (e.target.matches("[data-cv-custom]") && st && st.edit) {
        st.edit.color = e.target.value.toUpperCase();
        st.edit.palette = false;
        return refreshTools();
      }
      if (!e.target.matches("[data-cv-takenby]") || !st || !st.onTakenBy) return;
      const p = cur();
      try {
        const res = await st.onTakenBy(p, e.target.value || null);
        Object.assign(p, res || {});
        window.crmToast?.success?.("Autor da foto atualizado");
      } catch (err) {
        window.crmToast?.error?.(err.message || "Não foi possível mudar");
      }
      renderSide();
    });
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", () => st && !root.hidden && layout());
    return root;
  }

  /**
   * Phones: Nota and Stickers open as their own short panel over the bottom of the photo, with "Concluído".
   * No scrolling down a long panel and back up again; closing returns to the collapsed view.
   */
  function openFocus(kind) {
    st.focus = kind;
    st.sheet = false;
    syncPanel();
    const t = root.querySelector(kind === "note" ? "#cvNote" : ".cv-stk");
    if (t) t.focus({ preventScroll: true });
  }
  function closeFocus() {
    if (!st || !st.focus) return;
    if (st.focus === "note") flushNote();
    st.focus = null;
    syncPanel();
    root.querySelector(`[data-cv="q-note"], [data-cv="q-stk"]`)?.focus({ preventScroll: true });
  }
  /** Panel state classes + repaint; the photo re-fits to the room the panel leaves. */
  function syncPanel() {
    root.classList.toggle("is-peek", !st.sheet && !st.focus);
    root.classList.toggle("is-focus", !!st.focus);
    renderSide();
    renderTopInfo();
    requestAnimationFrame(() => layout());
  }
  function renderTopInfo() {
    const b = root.querySelector('[data-cv="info"]');
    if (!b) return;
    b.classList.toggle("is-on", !!st.sheet);
    b.setAttribute("aria-pressed", String(!!st.sheet));
    b.setAttribute("aria-label", st.sheet ? "Esconder dados da foto" : "Ver dados da foto");
  }

  function flushNote() {
    const area = root && root.querySelector("#cvNote");
    if (area) saveNote(area);
  }

  function go(d, enterFrom) {
    if (!st || st.photos.length < 2) return;
    flushNote();
    st.index = (st.index + d + st.photos.length) % st.photos.length;
    st.edit = null;
    render();
    // the next photo glides in from the side the swipe came from
    if (enterFrom && !reduced() && st.v) {
      st.tx = -enterFrom * 60;
      apply(false);
      requestAnimationFrame(() => {
        st.tx = 0;
        apply(true);
      });
    }
  }

  function open(opts) {
    const photos = (opts && opts.photos) || [];
    if (!photos.length) return;
    opener = document.activeElement;
    st = {
      photos,
      index: Math.min(Math.max(0, opts.index || 0), photos.length - 1),
      canPortfolio: !!opts.canPortfolio,
      onPortfolio: opts.onPortfolio || null,
      canDelete: !!opts.canDelete,
      onDelete: opts.onDelete || null,
      canStage: !!opts.canStage && typeof opts.onStage === "function",
      onStage: opts.onStage || null,
      canEdit: !!opts.canEdit,
      onNote: opts.onNote || null,
      onAnnotate: opts.onAnnotate || null,
      onTakenBy: opts.onTakenBy || null,
      onPhase: opts.onPhase || null,
      stickers: opts.stickers || [],
      onStickers: opts.onStickers || null,
      onManageStickers: opts.onManageStickers || null,
      people: opts.people || null,
      showInk: true,
      sheet: false,
      edit: null,
      busy: false,
      z: 1,
      tx: 0,
      ty: 0,
      v: null,
    };
    ensure();
    // reopening while the last close is still fading: drop that fade and its "hide at the end"
    closeTok += 1;
    try {
      root.getAnimations({ subtree: true }).forEach((x) => x.cancel());
    } catch (_) {}
    root.classList.remove("is-closing");
    root.style.removeProperty("--cv-fade");
    root.classList.toggle("is-peek", true);
    root.classList.remove("is-focus");
    root.hidden = false;
    document.body.classList.add("cv-open");
    const from = opts.from && opts.from.getBoundingClientRect ? opts.from.getBoundingClientRect() : null;
    const openedAt = performance.now();
    // The photo grows out of the tile once its size is known (the thumbnail is usually cached, so that is now).
    st.onLaid = () => enter(from && from.width ? from : null, performance.now() - openedAt < 250);
    render();
    root.querySelector('[data-cv="close"]')?.focus({ preventScroll: true });
    // One history entry per open viewer, so Android back and the edge swipe close the photo instead of leaving the app.
    if (!historyPushed) {
      try {
        history.pushState({ ...(history.state || {}), cvOpen: true }, "");
        historyPushed = true;
      } catch (_) {}
    }
  }

  /**
   * Open choreography. Lead: the photo travels from the tapped tile to its place (translate + scale, clipped to the
   * tile's square at the start), 280ms on the drawer curve. Together with it: the backdrop and the chrome around the
   * photo fade in, 200ms. Reduced motion: everything just fades, 150ms.
   */
  function enter(rect, inTime) {
    if (!st || !root) return;
    const { pan } = els();
    const bg = root.querySelector(".cv-bg");
    root.classList.add("is-opening");
    clearTimeout(enter.t);
    enter.t = setTimeout(() => root && root.classList.remove("is-opening"), 320);
    try {
      if (reduced()) {
        root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
        return;
      }
      bg?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT() });
      if (!rect || !inTime || !pan || !st.v) {
        pan?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT() });
        return;
      }
      const v = st.v;
      const br = els().box.getBoundingClientRect();
      const px = br.left + v.ox, py = br.top + v.oy;
      const sc = Math.max(rect.width / v.w, rect.height / v.h);
      const tx = rect.left + rect.width / 2 - px - (sc * v.w) / 2;
      const ty = rect.top + rect.height / 2 - py - (sc * v.h) / 2;
      const ix = Math.max(0, (v.w - rect.width / sc) / 2);
      const iy = Math.max(0, (v.h - rect.height / sc) / 2);
      const endR = phone() ? 0 : 6;
      st.openAnim = pan.animate(
        [
          { transform: `translate3d(${tx}px, ${ty}px, 0) scale(${sc})`, clipPath: `inset(${iy}px ${ix}px round ${12 / sc}px)` },
          { transform: "translate3d(0px, 0px, 0) scale(1)", clipPath: `inset(0px 0px round ${endR}px)` },
        ],
        { duration: 280, easing: EASE_DRAWER() },
      );
      st.openAnim.onfinish = () => {
        if (st) st.openAnim = null;
      };
    } catch (_) {}
  }

  let historyPushed = false;
  let closeTok = 0;
  window.addEventListener("popstate", (e) => {
    if (!historyPushed) return;
    // back from a sheet opened over the viewer lands on the viewer's own entry: the photo stays open
    if (e.state && e.state.cvOpen) return;
    historyPushed = false;
    if (st) close(true);
  });
  /**
   * Close. X, Esc and back: the viewer fades out, 160ms. Swipe-down: the photo keeps going the way the finger threw
   * it while everything fades, 200ms ease-out, and only then the viewer hides (no vanishing mid-gesture).
   */
  function close(fromHistory, how) {
    if (!root || !st) return;
    if (historyPushed && fromHistory !== true) {
      historyPushed = false;
      try {
        history.back();
      } catch (_) {}
    }
    flushNote();
    const tok = ++closeTok;
    const swipe = how && how.swipe;
    const { pan } = els();
    if (st.openAnim) {
      try {
        st.openAnim.cancel();
      } catch (_) {}
    }
    const done = () => {
      if (tok !== closeTok || !root) return;
      root.hidden = true;
      root.classList.remove("is-closing", "is-opening");
      root.style.removeProperty("--cv-fade");
      try {
        root.getAnimations({ subtree: true }).forEach((x) => x.cancel());
      } catch (_) {}
    };
    root.classList.add("is-closing");
    let anim = null;
    try {
      if (swipe && pan && st.v && !reduced()) {
        const extra = Math.max(st.v.bh * 0.45, (swipe.vy || 0) * 200);
        pan.animate([{ transform: pan.style.transform || "none" }, { transform: `translate3d(${st.tx}px, ${st.ty + extra}px, 0) scale(${st.z})` }], { duration: 200, easing: EASE_OUT(), fill: "forwards" });
        anim = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE_OUT(), fill: "forwards" });
      } else {
        anim = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 150 : 160, easing: "ease-out", fill: "forwards" });
      }
    } catch (_) {
      anim = null;
    }
    document.body.classList.remove("cv-open");
    st = null;
    g = null;
    ptrs.clear();
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
    // hide when the fade ends; the timer covers a tab whose animations are paused (background, throttled frames)
    if (anim && anim.finished) {
      anim.finished.then(done, done);
      setTimeout(done, 260);
    } else done();
  }
  function setPeople(list) {
    if (!st) return;
    st.people = list || [];
    renderSide();
  }

  function setStickers(list) {
    if (!st) return;
    st.stickers = list || [];
    renderSide();
  }

  /**
   * Editing for pages outside ObraCam (the job page): note, stage, markup and stickers saved straight to the
   * photo, then onSaved(row) so the page can refresh its own list. Spread the result into open().
   */
  function jobEditing(jobId, onSaved) {
    const patch = async (photo, changes) => {
      const r = await fetch(`/api/work-orders/${encodeURIComponent(jobId)}/media/${encodeURIComponent(photo.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(changes),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.error || "Não foi possível salvar");
      if (onSaved) onSaved(j.data);
      return j.data;
    };
    fetch("/api/job-media/stickers", { credentials: "include", headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((j) => setStickers(j.data || []))
      .catch(() => {});
    return {
      canEdit: true,
      canStage: true,
      onStage: (photo, stage) => patch(photo, { stage }),
      onNote: (photo, text) => patch(photo, { caption: text }),
      onAnnotate: (photo, doc) => patch(photo, { annotations: doc }),
      onStickers: (photo, ids) => patch(photo, { sticker_ids: ids }),
    };
  }

  window.CamViewer = { open, close, setPeople, setStickers, jobEditing, inkSvg, sharePhotos, canShareFiles, photoName };
})();
