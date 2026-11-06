/**
 * ObraCam (Opção B): lista de jobs ao lado (quem precisa de foto primeiro) e as fotos do job escolhido
 * por fase com o mapa de onde foram tiradas. "Fotos recentes" mostra as dos últimos dias, por dia.
 * Foto abre no visualizador (cam-viewer.js?v=20261105-apps3).
 */
(function () {
  // /obracam on a computer: the page is already on its way to the normal ObraCam (inline check at the top of <body>)
  if (window.__OM_CAM_LEAVING) return;
  const $ = (id) => document.getElementById(id);
  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  /** Job phases in the order work happens; the server works each photo's phase out from its date and the job's dates.
   *  The keys are what the API stores; the second item is only the name on screen. */
  const PHASES = [["delivery", "Entrega"], ["scan", "Medição"], ["installation", "Instalação"], ["sand_finish", "Lixa e acabamento"], ["walkthrough", "Vistoria final"]];
  const PHASE = Object.fromEntries(PHASES);
  const phaseOf = (p) => (PHASE[p.phase] ? p.phase : "none");
  const phaseName = (p) => PHASE[p.phase] || "Sem fase";
  /** Phases this job has (from its services and dates); every phase when unknown. */
  const jobPhaseList = (j) => (j && ((metaCache[j.id] && metaCache[j.id].phases) || j.phases)) || PHASES.map(([k]) => k);
  const WDL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  /** "Fotos recentes" asks the board for this many days of photos across all jobs. */
  const FEED_DAYS = 3;
  const GEO_CACHE_KEY = "om_jmb_geocode_v1";
  const SVG = {
    cam: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="11" height="11" aria-label="com marcações"><path d="M4 20l4-1L19 8a2.1 2.1 0 00-3-3L5 16l-1 4z"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="11" height="11" aria-label="com nota"><path d="M5 4h14v12l-4 4H5z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    noteChip: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/><path d="M8.5 9h7M8.5 12.5h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    sel: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg>',
    dl: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/></svg>',
    layers: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    archive: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/></svg>',
    restore: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg>',
    receipt:
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  };

  let jobs = [];
  let feed = [];
  /** The board (jobs + recent photos) has arrived at least once. */
  let loaded = false;
  let mode = "active";
  let q = "";
  let selId = null;
  /** Phase the job grid / feed is narrowed to: "all", a phase key, or "none". */
  let stageFilter = "all";
  /** Only photos that carry a note. */
  let noteFilter = false;
  /** Sticker (photo label) the job grid or feed is narrowed to, "" for all. */
  let stickerFilter = "";
  /** Multi-select: on while picking photos; ids of the picked photos; the raw photos on screen (with their job). */
  let selecting = false;
  const picked = new Set();
  let onScreen = [];
  let stickers = [];
  const stickerById = (id) => stickers.find((x) => x.id === id);
  function loadStickers() {
    return api("/api/job-media/stickers")
      .then((r) => {
        stickers = r.data || [];
        window.CamViewer?.setStickers?.(stickers);
      })
      .catch(() => {});
  }
  /** Each job and the feed show either the photos or "Local" (the map); the map loads only when asked for. */
  let pane = "photos";
  let canManage = false;
  /** Field crew can edit/upload photos on their jobs without office manage. */
  let canEditMedia = false;
  /** ObraCrew shell: calendar jobs only, ticket links, no office chrome. */
  let crewMode = false;
  let showAll = false;
  /** Crew week strip (same shape as Campo Agenda). */
  let crewWeekStart = null;
  let crewSelectedYmd = null;
  let crewAgendaDays = [];
  let crewRangeLabel = "";
  /** Jobs for the selected day from /api/campo/agenda — same list as Campo Agenda. */
  let crewDayJobs = null;

  function jobOpenHref(id, hash) {
    if (crewMode) return `/campo/ticket.html?id=${encodeURIComponent(id)}`;
    return `job-detail.html?id=${encodeURIComponent(id)}${hash || ""}`;
  }
  const mediaCache = {};
  const metaCache = {};
  let map = null;
  let mapGen = 0;
  let shown = [];
  const geoCache = (() => {
    try {
      return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  })();

  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json", "Content-Type": "application/json" }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || `HTTP ${r.status}`);
      err.status = r.status;
      err.code = j.code || "";
      throw err;
    }
    return j;
  }

  /** What went wrong, said in Portuguese for the person holding the phone (never "HTTP 500"). */
  function friendlyError(err, what, verb) {
    const e = err || {};
    const raw = String(e.message || "");
    const thing = what || "a foto";
    const act = verb || "enviar";
    if (e.name === "TypeError" || /failed to fetch|network|load failed/i.test(raw) || (typeof navigator !== "undefined" && navigator.onLine === false))
      return "Sem conexão com a internet. Confira o sinal e tente de novo.";
    if (/heic|heif/i.test(raw)) return "Esta foto está em HEIC. Use JPG ou PNG (no iPhone: Ajustes > Câmera > Formatos > Mais compatível).";
    if (/too large|413/i.test(raw) || e.status === 413) return "A foto é grande demais (máximo 12 MB).";
    if (/ler esta imagem/i.test(raw)) return raw;
    if (e.code === "LIMIT_REACHED") return "O limite de fotos do mês do seu plano acabou. Fale com o administrador da empresa.";
    if (e.status === 403) return `Você não tem permissão para ${act} ${thing} neste job.`;
    if (e.status === 404) return "Este job não existe mais ou foi cancelado.";
    if (e.status === 400) return `O servidor recusou ${thing}. Tente outra foto, em JPG ou PNG.`;
    if (e.status >= 500 || /^HTTP \d/.test(raw)) return "O servidor não respondeu agora. Tente de novo em instantes.";
    // a message already written in Portuguese (ours, or the server's) is kept; anything else gets the plain one
    return /[áéíóúâêôãõç]/i.test(raw) ? raw : `Não foi possível ${act} ${thing}. Tente de novo.`;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function norm(s) {
    return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function statusLabel(s) {
    return { draft: "Rascunho", scheduled: "Agendado", in_progress: "Em campo", completed: "Concluído", canceled: "Cancelado" }[s] || s || "—";
  }
  /** ObraCrew production label (Agendado / Installing|Sanding / Concluído) — never billing. */
  function jobStageLabel(j) {
    if (crewMode && window.JobsInfo?.crewStageLabel) return window.JobsInfo.crewStageLabel(j);
    if (crewMode && j.field_status_label) return j.field_status_label;
    if (window.JobsInfo?.stageLabel) return window.JobsInfo.stageLabel(j);
    if (window.JobsInfo?.listWhen) {
      const w = window.JobsInfo.listWhen(j);
      if (w && w.status) return w.status;
    }
    return statusLabel(j.status);
  }
  function isDone(j) {
    const s = String(j.status || "");
    return s === "completed" || s === "done" || s === "canceled";
  }
  function isActive(j) {
    if (isDone(j)) return false;
    const s = String(j.status || "");
    return (
      s === "scheduled" ||
      s === "in_progress" ||
      s === "draft" ||
      s === "on_site" ||
      s === "en_route" ||
      !s
    );
  }

  /** Prefer Jobs office raw_status; Agenda UI keys are secondary. */
  function crewStatusFromAgenda(aj) {
    const raw = String(aj.raw_status || "");
    if (raw === "completed" || raw === "canceled") return raw;
    if (raw === "in_progress") return "in_progress";
    if (raw === "scheduled" || raw === "draft") return "scheduled";
    const ui = String(aj.status || "");
    if (ui === "done" || ui === "completed") return "completed";
    if (ui === "in_progress") return "in_progress";
    if (ui === "scheduled") return "scheduled";
    return raw || ui || "scheduled";
  }

  /** Map Agenda day jobs into ObraCam row shape; prefer board row when both exist. */
  function mergeAgendaJob(aj) {
    const board = jobs.find((x) => String(x.id) === String(aj.id));
    const fromAgenda = {
      id: aj.id,
      number: aj.number,
      title: aj.title,
      address: aj.address || "",
      scheduled_start: aj.scheduled_start,
      sand_scheduled_start: aj.sand_scheduled_start,
      installation_done_at: aj.installation_done_at,
      sand_done_at: aj.sand_done_at,
      status: crewStatusFromAgenda(aj),
      homeowner_name: aj.homeowner_name,
      client_name: aj.client,
      client: aj.client,
      field_status_label: aj.field_status_label,
      sector: aj.sector,
    };
    return board ? { ...board, ...fromAgenda } : fromAgenda;
  }
  function needsPhoto(j) {
    return isActive(j) && !!j.stale;
  }
  function ago(iso) {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    const d = Math.floor(ms / 86400000);
    if (d <= 0) {
      const h = Math.floor(ms / 3600000);
      return h <= 0 ? "agora há pouco" : `há ${h} h`;
    }
    return d === 1 ? "ontem" : `há ${d} dias`;
  }
  /** Photos are ordered and grouped by when they were taken (from the photo's own data), falling back to the upload. */
  function takenAt(p) {
    return p.taken_at_device || p.created_at;
  }
  function byTaken(a, b) {
    return new Date(takenAt(b)) - new Date(takenAt(a));
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  function dayLabel(iso) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return "Hoje";
    if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return "Ontem";
    return `${WDL[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]}`;
  }
  function fmtDist(m) {
    if (m == null || !Number.isFinite(Number(m))) return "";
    const n = Number(m);
    return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km`;
  }
  function hasGps(p) {
    return p.lat != null && p.lng != null && p.location_available !== false;
  }
  function gpsTag(p) {
    if (!hasGps(p)) return `<span class="cam-tag">${SVG.pin}sem GPS</span>`;
    if (p.far_from_job) return `<span class="cam-tag is-far">${SVG.pin}longe${p.distance_m != null ? ` · ${esc(fmtDist(p.distance_m))}` : ""}</span>`;
    // A photo taken at the site needs no badge; the distance stays in the viewer.
    return "";
  }
  function isPhone() {
    return window.matchMedia("(max-width: 760px)").matches;
  }
  function isWide() {
    return window.matchMedia("(min-width: 1025px)").matches;
  }
  const coarse = () => window.matchMedia("(pointer: coarse)").matches;
  const canShare = () => !!(window.CamViewer && window.CamViewer.canShareFiles && window.CamViewer.canShareFiles());

  /**
   * ObraCam sheets (upload, etiquetas, ações em lote) on OmUI.layer: Esc, focus kept inside and given back, Android
   * back closes, and the exit animates before the sheet hides. Markup: root.cam-up > .cam-up__bg[data-om-backdrop] +
   * .cam-up__card (the animated panel: "sheet" from the bottom on phones, "pop" centred on wider screens).
   * om-ui.js loads deferred, so the layer is made on first open; without it the sheet still opens and closes.
   */
  function camSheet(root, opts) {
    const o = opts || {};
    let layer = null;
    const make = () => {
      if (!layer && window.OmUI && window.OmUI.layer) layer = window.OmUI.layer(root, { history: true, onClose: o.onClose, initialFocus: o.initialFocus });
      return layer;
    };
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-om-backdrop]")) api.close();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !layer) {
        e.preventDefault();
        api.close();
      }
    });
    const api = {
      open() {
        const card = root.querySelector(".cam-up__card");
        if (card) card.setAttribute("data-om-motion", window.matchMedia("(min-width: 761px)").matches ? "pop" : "sheet");
        if (make()) return layer.open();
        root.hidden = false;
        const t = typeof o.initialFocus === "function" ? o.initialFocus() : o.initialFocus;
        (t || root.querySelector("button"))?.focus({ preventScroll: true });
      },
      close() {
        if (layer) return layer.close();
        if (root.hidden) return;
        root.hidden = true;
        if (typeof o.onClose === "function") o.onClose();
      },
      isOpen: () => (layer ? layer.isOpen() : !root.hidden),
    };
    return api;
  }
  /** The shell every ObraCam sheet shares; the body is what gets repainted, so the card's entrance never replays. */
  function sheetShell(cls, labelId) {
    const el = document.createElement("div");
    el.className = `cam-up${cls ? ` ${cls}` : ""}`;
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    if (labelId) el.setAttribute("aria-labelledby", labelId);
    el.innerHTML = `<div class="cam-up__bg" data-om-backdrop aria-hidden="true"></div><div class="cam-up__card"><div class="cam-up__body"></div></div>`;
    document.body.appendChild(el);
    return el;
  }

  // ---------------------------------------------------------------- lista
  function jobHit(j) {
    if (!q) return true;
    const who = listWho(j);
    return norm(
      [j.number, j.title, j.address, j.client_name, j.client_ref, who, j.builder?.nickname, j.builder?.company, jobStageLabel(j), ...(j.photos || []).map((p) => p.author_name)]
        .filter(Boolean)
        .join(" "),
    ).includes(q);
  }

  /** Same identity line as Jobs; ObraCrew uses homeowner/client only (no nickname). */
  function listWho(j) {
    if (crewMode) {
      const home = String(j.homeowner_name || j.client_name || j.client || "").trim();
      if (home) return home;
      if (window.JobsInfo?.fieldClient) return window.JobsInfo.fieldClient(j) || "Sem cliente";
    }
    if (window.JobsInfo?.client) return window.JobsInfo.client(j);
    const nick = String(j.builder?.nickname || j.customer?.nickname || "").trim();
    const base = String(
      nick || j.customer?.name || j.customer?.company || j.builder?.company || j.builder?.name || j.client_name || j.source_name || "",
    ).trim();
    const ref = String(j.client_ref || j.customer?.client_code || "").trim();
    if (ref) {
      if (!base) return ref;
      if (base.toLowerCase().includes(ref.toLowerCase())) return base;
      return `${base} - ${ref}`;
    }
    return base || "Sem cliente";
  }

  function useSwipeDelete() {
    return canManage && window.matchMedia("(max-width: 1024px), (pointer: coarse)").matches;
  }

  function sod(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Same day block as Jobs: QUA / 4 / NOV — list reads as an agenda. */
  function dayBlock(j) {
    const J = window.JobsInfo;
    const finished = j.status === "completed" || j.status === "canceled";
    const iso = (J && J.listAnchorIso ? J.listAnchorIso(j) : null) || (finished ? j.updated_at || j.scheduled_end : null);
    if (!iso) return `<span class="ol-lead jx-day is-none" aria-hidden="true"><b>—</b><small>sem data</small></span>`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return `<span class="ol-lead jx-day is-none" aria-hidden="true"><b>—</b><small>sem data</small></span>`;
    const wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
    const mo = MO[d.getMonth()];
    const today = sod(d).getTime() === sod(new Date()).getTime();
    const late = J && J.late ? J.late(j) : null;
    const tone = today ? " is-today" : !finished && late ? " is-late" : finished ? " is-done" : "";
    return `<span class="ol-lead jx-day${tone}" aria-label="${today ? "Hoje" : `${wd} ${d.getDate()} ${mo}`}"><small>${today ? "hoje" : wd}</small><b>${d.getDate()}</b><small>${mo}</small></span>`;
  }

  /** ObraCrew Jobs card day block (jobs-mobile fieldDayBlock). */
  function crewDayBlock(j) {
    const J = window.JobsInfo;
    const finished = j.status === "completed" || j.status === "canceled";
    const iso = (J && J.listAnchorIso ? J.listAnchorIso(j) : null) || (finished ? j.updated_at || j.scheduled_end : null);
    if (!iso) return `<span class="jx-day is-none" aria-hidden="true"><small>sem</small><b>—</b><small>data</small></span>`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return `<span class="jx-day is-none" aria-hidden="true"><small>sem</small><b>—</b><small>data</small></span>`;
    const wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
    const mo = MO[d.getMonth()];
    const today = sod(d).getTime() === sod(new Date()).getTime();
    const tone = !finished && (today || j.status === "in_progress") ? " is-now" : finished ? " is-done" : "";
    return `<span class="jx-day${tone}" aria-label="${today ? "Hoje" : `${wd} ${d.getDate()} ${mo}`}"><small>${today ? "hoje" : wd}</small><b>${d.getDate()}</b><small>${mo}</small></span>`;
  }

  function timeText(j) {
    const J = window.JobsInfo;
    const iso = J && J.listAnchorIso ? J.listAnchorIso(j) : j.scheduled_start;
    if (!iso || j.status === "completed" || j.status === "canceled") return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || (d.getHours() === 0 && d.getMinutes() === 0)) return "";
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  /** ObraCrew Jobs card: day · client · address · status/hora · mapa. */
  function crewRowHtml(j) {
    const J = window.JobsInfo;
    const who = listWho(j);
    const head = who && who !== "Sem cliente" ? who : j.title || "Job";
    const href = `#cam-${encodeURIComponent(j.id)}`;
    const maps = j.address ? `https://maps.google.com/?q=${encodeURIComponent(j.address)}` : "";
    const listed = J && J.crewListWhen ? J.crewListWhen(j) : J && J.listWhen ? J.listWhen(j) : null;
    const stText = listed?.status || jobStageLabel(j);
    const tone = J && J.crewStageTone ? J.crewStageTone(j) : J && J.stageTone ? J.stageTone(j) : "wait";
    const time = timeText(j);
    const on = String(j.id) === String(selId) && mode !== "photos" ? " is-on" : "";
    const id = esc(j.id);
    const mapPin =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
    return `<div class="crew-job cam-crew-job${on}">
      <a class="crew-job__main cam-row" href="${href}" data-cam-id="${id}">
        ${crewDayBlock(j)}
        <div class="crew-job__copy">
          <b class="crew-job__title">${esc(head)}</b>
          ${j.address ? `<span class="crew-job__addr">${esc(j.address)}</span>` : `<span class="crew-job__addr">Sem endereço</span>`}
          <span class="crew-job__meta">
            ${stText ? `<span class="ol-st is-${tone}">${esc(stText)}</span>` : ""}
            ${time ? `<span class="crew-job__clock">${esc(time)}</span>` : ""}
          </span>
        </div>
      </a>
      ${
        maps
          ? `<a class="crew-job__map" href="${maps}" target="_blank" rel="noopener" aria-label="Abrir mapa">${mapPin}</a>`
          : `<span class="crew-job__map is-off" aria-hidden="true">${mapPin}</span>`
      }
    </div>`;
  }

  /** Same card anatomy as Jobs: day · client · address · progress · status + map + CTA. */
  function rowHtml(j) {
    if (crewMode) return crewRowHtml(j);
    const n = j.photo_count != null ? j.photo_count : (j.photos || []).length;
    const who = listWho(j);
    const head = who && who !== "Sem cliente" ? who : j.title || "Job";
    const href = jobOpenHref(j.id, "#fotos");
    const openHref = jobOpenHref(j.id);
    const addr = j.address
      ? `<span class="ol-m jx-row__addr" title="${esc(j.address)}">${SVG.pin}<span>${esc(j.address)}</span></span>`
      : `<span class="ol-m"><span>Sem endereço</span></span>`;
    const stale = needsPhoto(j);
    const lt = window.JobsInfo?.late ? window.JobsInfo.late(j) : null;
    const tone = window.JobsInfo?.stageTone ? window.JobsInfo.stageTone(j) : "wait";
    const stText = lt ? lt.short : jobStageLabel(j);
    const maps = j.address ? `https://maps.google.com/?q=${encodeURIComponent(j.address)}` : "";
    const time = timeText(j);
    const prog = window.JobsInfo?.progHtml ? window.JobsInfo.progHtml(j) : "";
    const on = String(j.id) === String(selId) && mode !== "photos" ? " is-on" : "";
    const ctaLbl = n ? `${n} foto${n === 1 ? "" : "s"}` : stale ? "Tirar foto" : "Fotos";
    const ctaCls = stale || !n ? "jmx-b jmx-b--or" : "jmx-b";
    const id = esc(j.id);
    const body = `<div class="jx-rowwrap jmx-card">
    <a class="cam-row jx-row ol-row${on}" href="${href}" data-cam-id="${id}">
      ${dayBlock(j)}
      <b class="ol-t" title="${esc(head)}">${esc(head)}</b>
      ${time ? `<span class="ol-v ol-time">${esc(time)}</span>` : ""}
      ${addr}
      ${prog}
    </a>
    <div class="jmx-card__r3 jx-foot" data-cam-id="${id}">
      ${stText ? `<span class="ol-st is-${tone}" title="${esc(stText)}">${esc(stText)}</span>` : ""}
      ${maps ? `<a class="jmx-b jmx-b--sq" href="${maps}" target="_blank" rel="noopener" aria-label="Abrir mapa" title="Abrir mapa">${SVG.pin}</a>` : ""}
      <a class="${ctaCls}" href="${href}" data-cam-id="${id}">${esc(ctaLbl)}</a>
    </div>
    </div>`;
    if (useSwipeDelete() && j.status !== "canceled") {
      return `<article class="om-swipe cam-swipe" data-cam-swipe="${id}">
        <div class="om-swipe__actions" aria-hidden="true">
          <a class="om-swipe__act--edit" href="${openHref}">Abrir</a>
          <button type="button" class="om-swipe__act--delete" data-cam-delete="${id}" data-cam-label="${esc(head)}">Excluir</button>
        </div>
        <div class="om-swipe__body">${body}</div>
      </article>`;
    }
    return body;
  }

  async function deleteJob(id, label, btn) {
    if (!id || !canManage) return;
    const okDel = await window.crmConfirm({
      title: `Excluir o job “${label || id}”?`,
      text: "O job será cancelado e sai da lista ativa.",
      ok: "Excluir job",
      danger: true,
    });
    if (!okDel) return;
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "…";
    }
    try {
      await api(`/api/work-orders/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (window.crmToast?.success) window.crmToast.success("Job excluído.");
      jobs = jobs.filter((j) => String(j.id) !== String(id));
      delete mediaCache[id];
      delete metaCache[id];
      if (String(selId) === String(id)) {
        selId = null;
        document.body.classList.remove("cam-detail-open");
        $("camSplit")?.classList.remove("is-detail");
      }
      renderList();
      if (window.OmGestures) window.OmGestures.bindSwipeRow?.($("camRows"));
      if (isWide()) {
        selId = firstVisibleId();
        renderList();
        if (selId) renderRight();
        else $("camDetail").innerHTML = `<div class="cam-blank">Escolha um job na lista.</div>`;
      } else if (!selId) {
        $("camDetail").innerHTML = "";
      }
    } catch (err) {
      if (window.crmToast?.error) window.crmToast.error(err.message || "Não foi possível excluir");
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "Excluir";
      }
    }
  }

  // ---------------------------------------------------------------- list filters, grouping, order
  const LIST_PREF_KEY = "om_cam_list_v1";
  const listPref = (() => {
    const d = { filter: "all", group: "status", sort: "recent" };
    try {
      return { ...d, ...(JSON.parse(localStorage.getItem(LIST_PREF_KEY) || "{}") || {}) };
    } catch (_) {
      return d;
    }
  })();
  function savePref() {
    try {
      localStorage.setItem(LIST_PREF_KEY, JSON.stringify(listPref));
    } catch (_) {}
  }
  function isToday(iso) {
    return !!iso && new Date(iso).toDateString() === new Date().toDateString();
  }
  /** Quick filters (office). Crew uses only Em produção / Últimos trabalhos via #camMode. */
  function filtersForMode() {
    if (crewMode) return [["all", "Todos", () => true]];
    return [
      ["all", "Todos", () => true],
      ["need", "Precisa de foto", (j) => needsPhoto(j)],
      ["today", "Hoje", (j) => isToday(j.scheduled_start) || isToday(j.sand_scheduled_start)],
      ["nogps", "Sem GPS", (j) => (j.photos || []).some((p) => !hasGps(p))],
      ["far", "Longe", (j) => (j.photos || []).some((p) => p.far_from_job)],
    ];
  }
  let FILTERS = filtersForMode();
  /** The client a job is grouped under: the builder or customer, without the job reference. */
  function clientKey(j) {
    return String(j.builder?.nickname || j.builder?.company || j.customer?.nickname || j.customer?.company || j.customer?.name || j.client_name || j.source_name || "").trim() || "Sem cliente";
  }
  function lastPhotoTime(j) {
    return j.last_photo ? new Date(j.last_photo.created_at).getTime() : 0;
  }
  function jobAnchorIso(j) {
    return (window.JobsInfo && window.JobsInfo.listAnchorIso ? window.JobsInfo.listAnchorIso(j) : null) || j.scheduled_start || j.sand_scheduled_start || null;
  }
  function cmpJobs(a, b) {
    if (crewMode) {
      if (mode === "done") {
        const ta = new Date(a.updated_at || a.scheduled_end || jobAnchorIso(a) || 0).getTime();
        const tb = new Date(b.updated_at || b.scheduled_end || jobAnchorIso(b) || 0).getTime();
        return tb - ta;
      }
      // Em produção: próximas datas primeiro; sem data no fim.
      const ta = jobAnchorIso(a) ? new Date(jobAnchorIso(a)).getTime() : Number.POSITIVE_INFINITY;
      const tb = jobAnchorIso(b) ? new Date(jobAnchorIso(b)).getTime() : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return listWho(a).localeCompare(listWho(b), "pt-BR", { sensitivity: "base" });
    }
    if (listPref.sort === "name") return listWho(a).localeCompare(listWho(b), "pt-BR", { sensitivity: "base" });
    if (listPref.sort === "schedule") {
      const ta = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Infinity;
      const tb = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Infinity;
      return ta - tb;
    }
    return lastPhotoTime(b) - lastPhotoTime(a);
  }
  /** Jobs in the current tab (Ativos / Concluídos) that match the search, before the quick filter. */
  function baseJobs() {
    // Crew calendar day = same appointments as Campo Agenda (all jobs that day).
    if (crewMode && crewSelectedYmd && Array.isArray(crewDayJobs)) {
      return crewDayJobs.map(mergeAgendaJob).filter(jobHit);
    }
    const hit = jobs.filter(jobHit);
    if (showAll) return hit;
    return mode === "done" ? hit.filter(isDone) : hit.filter(isActive);
  }

  function renderCrewWeek() {
    const host = $("camWeek");
    const strip = $("camWeekStrip");
    const label = $("camWeekLabel");
    if (!host || !strip) return;
    if (!crewMode) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (label) {
      label.textContent = crewRangeLabel ? `Esta semana · ${crewRangeLabel}` : "Esta semana";
    }
    strip.innerHTML = (crewAgendaDays || [])
      .map((d) => {
        const on = d.ymd === crewSelectedYmd;
        const dots = (d.dots || [])
          .map((t) => `<span class="cam-day-chip__dot${t === "orange" ? " cam-day-chip__dot--warn" : ""}"></span>`)
          .join("");
        return `<button type="button" class="cam-day-chip${on ? " is-active" : ""}" data-cam-ymd="${esc(d.ymd)}" role="tab" aria-selected="${on}">
          <span class="cam-day-chip__name">${esc(d.label)}</span>
          <span class="cam-day-chip__num">${esc(String(d.day_num))}</span>
          <span class="cam-day-chip__dots">${dots}</span>
        </button>`;
      })
      .join("");
  }
  async function loadCrewAgenda() {
    if (!crewMode) return;
    try {
      const params = new URLSearchParams();
      if (crewWeekStart) params.set("week", crewWeekStart);
      if (crewSelectedYmd) params.set("day", crewSelectedYmd);
      const r = await api(`/api/campo/agenda?${params}`);
      const data = r.data || r;
      crewWeekStart = data.week_start || crewWeekStart;
      crewSelectedYmd = data.selected_day || crewSelectedYmd;
      crewAgendaDays = data.days || [];
      crewRangeLabel = data.range_label || crewRangeLabel;
      crewDayJobs = data.jobs || [];
      renderCrewWeek();
      renderList();
    } catch (_) {
      /* board list still works without the strip */
    }
  }
  function shiftCrewWeek(delta) {
    if (!crewWeekStart) return;
    const d = new Date(crewWeekStart + "T12:00:00");
    d.setDate(d.getDate() + delta * 7);
    crewWeekStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    crewSelectedYmd = crewWeekStart;
    void loadCrewAgenda();
  }

  function groups() {
    const f = FILTERS.find(([k]) => k === listPref.filter) || FILTERS[0];
    const rows = baseJobs().filter(f[2]).sort(cmpJobs);
    // ObraCrew: one flat list — no office buckets.
    if (crewMode) return [["", rows]];
    if (listPref.group === "client") {
      const by = new Map();
      rows.forEach((j) => {
        const k = clientKey(j);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(j);
      });
      return [...by.entries()].sort(([a], [b]) => (a === "Sem cliente") - (b === "Sem cliente") || a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    }
    if (showAll) {
      const active = rows.filter((j) => !isDone(j));
      return [
        ["Precisa de foto", active.filter((j) => needsPhoto(j) && j.scheduled_start)],
        ["Em dia", active.filter((j) => !needsPhoto(j))],
        ["Sem data", active.filter((j) => needsPhoto(j) && !j.scheduled_start)],
        ["Concluídos", rows.filter(isDone)],
      ];
    }
    if (mode === "done") return [["Concluídos", rows]];
    return [
      ["Precisa de foto", rows.filter((j) => needsPhoto(j) && j.scheduled_start)],
      ["Em dia", rows.filter((j) => !needsPhoto(j))],
      ["Sem data", rows.filter((j) => needsPhoto(j) && !j.scheduled_start)],
    ];
  }

  function renderFilters() {
    const sel = $("camFilt");
    if (sel) {
      const active = jobs.filter((j) => isActive(j) && jobHit(j));
      const labels = { all: "Todos", need: "Precisa de foto", today: "Hoje", nogps: "Sem GPS", far: "Longe", done: "Concluídos" };
      Array.from(sel.options).forEach((opt) => {
        let n = 0;
        if (opt.value === "done") n = jobs.filter((j) => isDone(j) && jobHit(j)).length;
        else if (opt.value === "all") n = active.length;
        else {
          const spec = FILTERS.find((x) => x[0] === opt.value);
          n = spec ? active.filter(spec[2]).length : 0;
        }
        const name = labels[opt.value] || opt.textContent;
        opt.textContent = n ? `${name} · ${n}` : name;
      });
      sel.value = showAll ? "all" : mode === "done" ? "done" : listPref.filter;
      window.OlPick?.paint(sel);
    }
    if ($("camGroup")) {
      $("camGroup").value = listPref.group;
      window.OlPick?.paint($("camGroup"));
    }
    const allBtn = $("camAll");
    if (allBtn) {
      allBtn.classList.toggle("is-on", showAll);
      allBtn.setAttribute("aria-pressed", showAll ? "true" : "false");
    }
  }

  function renderList() {
    const crewDay =
      crewMode && crewSelectedYmd && Array.isArray(crewDayJobs) ? crewDayJobs.map(mergeAgendaJob) : null;
    const active = crewDay ? crewDay.filter(isActive) : jobs.filter(isActive);
    const done = crewDay ? crewDay.filter(isDone) : jobs.filter(isDone);
    if ($("camJobsN")) $("camJobsN").textContent = String(jobs.length);
    if ($("camPhotosN")) $("camPhotosN").textContent = String(feed.length);
    document.querySelectorAll("#camViews [data-view]").forEach((b) => {
      const on = (b.getAttribute("data-view") === "photos") === (mode === "photos");
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (!crewMode) renderFilters();
    document.querySelectorAll("#camMode [data-mode]").forEach((b) => {
      const m = b.getAttribute("data-mode");
      const listMode = mode === "photos" ? "active" : mode;
      b.classList.toggle("is-on", m === listMode);
      b.setAttribute("aria-pressed", String(m === listMode));
      if (crewMode) {
        // Calendar day shows every Agenda job; counts still split active vs done for context.
        const dayN = crewDay ? crewDay.length : active.length + done.length;
        b.innerHTML =
          m === "active"
            ? `Em produção<em>${crewDay ? dayN : active.length}</em>`
            : `Últimos trabalhos<em>${done.length}</em>`;
      } else {
        b.innerHTML = m === "active" ? `Ativos <em>${active.length}</em>` : `Concluídos <em>${done.length}</em>`;
      }
    });
    // before the board arrives the skeleton stays (the session can answer first and would paint "Nenhum job")
    if (!loaded) return;
    const html = groups()
      .filter(([, rows]) => rows.length)
      .map(([label, rows]) => {
        const head = label ? `<p class="cam-grp ol-grp"><span>${esc(label)}</span><em>${rows.length}</em></p>` : "";
        return head + rows.map(rowHtml).join("");
      })
      .join("");
    $("camRows").removeAttribute("aria-busy");
    const emptyCrew = crewSelectedYmd
      ? "Nenhuma obra neste dia."
      : mode === "done"
        ? "Nenhum trabalho recente."
        : "Nenhum trabalho em produção.";
    $("camRows").innerHTML =
      html ||
      `<p class="cam-empty">${
        listPref.filter !== "all" && !crewMode
          ? `Nenhum job em “${esc((FILTERS.find(([k]) => k === listPref.filter) || [])[1] || "")}”. <button type="button" class="cam-link" data-filter="all">Ver todos</button>`
          : q
            ? "Nenhum job com essa busca."
            : crewMode
              ? emptyCrew
              : mode === "done"
                ? "Nenhum job concluído."
                : "Nenhum job ativo."
      }</p>`;
    if (window.OmGestures) window.OmGestures.bindSwipeRow?.($("camRows"));
    ensureCrewActs();
  }

  /** Abre primeiro um job que tenha fotos (senão o primeiro da lista). */
  function firstVisibleId() {
    const rows = [...$("camRows").querySelectorAll("[data-cam-id]")].map((a) => a.getAttribute("data-cam-id"));
    const withPhotos = rows.find((id) => (jobs.find((j) => String(j.id) === id) || {}).last_photo);
    return withPhotos || rows[0] || null;
  }

  // ---------------------------------------------------------------- visualizador
  function viewerJobName(j) {
    const full = jobs.find((x) => String(x.id) === String(j.id));
    const who = full ? listWho(full) : "";
    return who && who !== "Sem cliente" ? who : j.title || "";
  }

  function toViewer(j, p) {
    return {
      id: p.legacy ? null : p.id, url: p.url, thumb_url: p.thumb_url || p.url, stage: p.stage, created_at: p.created_at, taken_at_device: p.taken_at_device,
      author: p.author_name, device: p.device_label, caption: p.caption, address: p.address || j.address, lat: p.lat, lng: p.lng,
      uploaded_by_name: p.uploaded_by_name || p.author_name, taken_by_id: p.taken_by_id || p.author_id, taken_by_name: p.taken_by_name || p.author_name,
      taken_at_source: p.taken_at_source, location_source: p.location_source, camera_model: p.camera_model, annotations: p.annotations || null,
      sticker_ids: (p.sticker_ids || []).slice(),
      phase: p.phase || null, phase_source: p.phase_source || null, phases: jobPhaseList(jobs.find((x) => String(x.id) === String(j.id)) || j),
      location_available: p.location_available != null ? p.location_available : p.lat != null, distance_m: p.distance_m, far_from_job: p.far_from_job,
      in_portfolio: p.in_portfolio, job: { id: j.id, number: j.number, title: j.title, client: j.client_name, name: viewerJobName(j) },
    };
  }

  function dropPhotoEverywhere(photoId) {
    const id = String(photoId);
    feed = feed.filter((x) => String(x.id) !== id);
    Object.keys(mediaCache).forEach((jobId) => {
      mediaCache[jobId] = (mediaCache[jobId] || []).filter((x) => String(x.id) !== id);
    });
    jobs.forEach((j) => {
      if (!j.photos) return;
      j.photos = j.photos.filter((x) => String(x.id) !== id);
      j.photo_count = Math.max(0, (j.photo_count || 0) - 1);
      if (j.last_photo && String(j.last_photo.id) === id) j.last_photo = j.photos[0] || null;
    });
  }

  /** Save one change on a photo and mirror it into every cached copy (job list, job photos, feed). */
  async function editPhoto(photo, changes) {
    const r = await api(`/api/work-orders/${encodeURIComponent(photo.job.id)}/media/${encodeURIComponent(photo.id)}`, { method: "PATCH", body: JSON.stringify(changes) });
    const d = r.data || {};
    const patch = {};
    if ("caption" in changes) patch.caption = d.caption ?? null;
    if ("annotations" in changes) patch.annotations = d.annotations ?? null;
    if ("taken_by_id" in changes) Object.assign(patch, { taken_by_id: d.taken_by_id, taken_by_name: d.taken_by_name });
    if ("sticker_ids" in changes) patch.sticker_ids = d.sticker_ids || [];
    if ("phase" in changes) Object.assign(patch, { phase: d.phase || null, phase_source: d.phase_source || null });
    [feed, ...Object.values(mediaCache), ...jobs.map((x) => x.photos || [])].forEach((arr) =>
      arr.forEach((x) => {
        if (String(x.id) === String(photo.id)) Object.assign(x, patch);
      }),
    );
    if (mode === "photos") renderFeed();
    else renderJob();
    return patch;
  }

  function openViewer(list, index, from) {
    if (!window.CamViewer || !list.length) return;
    if (canManage && !people) loadPeople().then((pp) => window.CamViewer.setPeople?.(pp));
    window.CamViewer.open({
      canEdit: canEditMedia,
      people,
      onNote: (photo, text) => editPhoto(photo, { caption: text }),
      onAnnotate: (photo, doc) => editPhoto(photo, { annotations: doc }),
      onTakenBy: canManage ? (photo, id) => editPhoto(photo, { taken_by_id: id }) : null,
      stickers,
      onStickers: canEditMedia ? (photo, ids) => editPhoto(photo, { sticker_ids: ids }) : null,
      onManageStickers: canManage ? () => openStickerManager() : null,
      photos: list,
      index,
      from: from || null,
      canPortfolio: canManage,
      canDelete: canEditMedia,
      onPhase: canEditMedia ? (photo, next) => editPhoto(photo, { phase: next }) : null,
      onPortfolio: async (photo, next) => {
        await api(`/api/work-orders/${encodeURIComponent(photo.job.id)}/media/${encodeURIComponent(photo.id)}/portfolio`, { method: "PATCH", body: JSON.stringify({ in_portfolio: next }) });
        [feed, ...Object.values(mediaCache), ...jobs.map((x) => x.photos || [])].forEach((arr) =>
          arr.forEach((x) => {
            if (x.id === photo.id) x.in_portfolio = next;
          }),
        );
        window.crmToast?.success?.(next ? "Foto no portfólio público." : "Foto tirada do portfólio.");
        return { in_portfolio: next };
      },
      onDelete: async (photo) => {
        await api(`/api/work-orders/${encodeURIComponent(photo.job.id)}/media/${encodeURIComponent(photo.id)}`, { method: "DELETE" });
        dropPhotoEverywhere(photo.id);
        window.crmToast?.success?.("Foto apagada.");
        renderList();
        renderRight();
      },
    });
  }

  /** Feed tiles name the job the way the list does (client first), so nobody has to remember what "#8" was. */
  function feedJobName(p) {
    const j = jobs.find((x) => String(x.id) === String(p.job_id));
    const who = j ? listWho(j) : "";
    return (who && who !== "Sem cliente" ? who : p.job_title) || (p.job_number != null ? `Job ${p.job_number}` : "Job");
  }

  /** Small icons on a tile when the photo carries a note or markup. */
  function marks(p) {
    const ink = p.annotations && Array.isArray(p.annotations.shapes) && p.annotations.shapes.length;
    return `${ink ? SVG.pen : ""}${p.caption ? SVG.note : ""}`;
  }

  /** Sticker badges on a tile: the first two by name, then "+N". */
  function tileStickers(p) {
    const list = (p.sticker_ids || []).map(stickerById).filter(Boolean);
    if (!list.length) return "";
    const shown = list.slice(0, 2).map((x) => `<span style="--stk:${esc(x.color)}">${esc(x.name)}</span>`).join("");
    return `<span class="cam-ph__stk" data-no-i18n>${shown}${list.length > 2 ? `<span class="is-more">+${list.length - 2}</span>` : ""}</span>`;
  }

  /** "Instalação, ter 4 nov": what a photo is, for its alt text and its button label. */
  function photoAlt(p) {
    const d = new Date(takenAt(p));
    const when = Number.isNaN(d.getTime()) ? "" : `, ${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
    return `${PHASE[p.phase] || STAGE[p.stage] || "Foto"}${when}`;
  }

  function photoTile(p, i, opts) {
    const st = phaseName(p);
    const tags = (p.sticker_ids || []).map(stickerById).filter(Boolean).map((x) => x.name);
    const what = `${photoAlt(p)}${tags.length ? ` · ${tags.join(", ")}` : ""}${opts && opts.job ? ` · ${feedJobName(p)}` : ""}`;
    const pick = selecting && picked.has(String(p.id));
    return `<button type="button" class="cam-ph${opts && opts.job ? " cam-ph--job" : ""}${pick ? " is-pick" : ""}" data-ph-i="${i}" data-ph-id="${esc(p.id)}"${selecting ? ` aria-pressed="${pick}"` : ""} aria-label="${selecting ? "Selecionar" : "Ver"} foto: ${esc(what)}">
      <img class="cam-ph__img" src="${esc(p.thumb_url || p.url)}" alt="${esc(photoAlt(p))}" loading="lazy" decoding="async" draggable="false" />
      ${selecting ? `<span class="cam-ph__ck" aria-hidden="true">${SVG.check}</span>` : ""}
      ${opts && opts.stage ? `<span class="cam-ph__st" data-no-i18n>${esc(st)}${marks(p)}</span>` : marks(p) ? `<span class="cam-ph__st cam-ph__st--ic">${marks(p)}</span>` : ""}
      ${tileStickers(p)}
      ${opts && opts.job ? `<span class="cam-ph__jn">${esc(feedJobName(p))}</span>` : ""}
      ${gpsTag(p)}
    </button>`;
  }

  // ---------------------------------------------------------------- job aberto
  function mapsHref(address) {
    return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
  }
  function stagePillCls(label) {
    const s = String(label || "");
    if (window.JobsInfo?.isInFieldStage?.(s) || s === "Em campo" || s === "Lixa" || s === "Installing" || s === "Sanding") return "dk";
    if (s === "Concluído" || s === "Faturado" || s === "Pago") return "ol";
    return "";
  }

  function headHtml(j, list) {
    const n = list ? list.length : j.photo_count || 0;
    const authors = list ? [...new Set(list.map((p) => p.author_name).filter(Boolean))] : [];
    const stage = jobStageLabel(j);
    const st = stagePillCls(stage);
    const lastTxt = j.last_photo ? `Última foto ${ago(j.last_photo.created_at)}` : "Nenhuma foto";
    const who = listWho(j);
    const hasWho = who && who !== "Sem cliente";
    const name = hasWho ? who : j.title || "Job";
    // The heading shows the client, so the job's own title rides along as one quiet line (full text on hover).
    const sub = hasWho && j.title && norm(j.title) !== norm(who) ? j.title : "";
    const facts = [j.number != null ? `Job #${esc(j.number)}` : "", `${n} foto${n === 1 ? "" : "s"}`, authors.length ? `por ${esc(authors.slice(0, 3).join(", "))}` : ""].filter(Boolean);
    const addr = j.address
      ? `<a class="cam-dloc" href="${esc(mapsHref(j.address))}" target="_blank" rel="noopener" title="${esc(j.address)} · abrir no mapa">${SVG.pin}<span>${esc(j.address)}</span></a>`
      : `<span class="cam-dloc cam-dloc--none">${SVG.pin}<span>Sem endereço</span></span>`;
    const open = jobOpenHref(j.id);
    const openLbl = crewMode ? "Ticket" : "Abrir job";
    return `<a class="cam-back" href="#" data-cam-back>${SVG.back}ObraCam</a>
      <div class="cam-dh">
        <div class="cam-dh__t">
          <h2><a href="${open}" title="${esc(name)}">${esc(name)}</a></h2>
          ${sub && !crewMode ? `<p class="cam-dsub" title="${esc(sub)}">${esc(sub)}</p>` : ""}
          <div class="cam-dmeta">
            <span class="cam-pill${st ? ` cam-pill--${st}` : ""}">${esc(stage)}</span>
            <span class="cam-pill${needsPhoto(j) ? " cam-pill--hot" : ""}">${esc(lastTxt)}</span>
            ${crewMode ? "" : facts.map((x) => `<span class="cam-dfact">${x}</span>`).join("")}
            ${addr}
          </div>
        </div>
        <div class="cam-dh__acts">
          ${
            crewMode
              ? `<button type="button" class="cam-btn" data-cam-receipt>${SVG.receipt}Scanner Recibo</button>
          <button type="button" class="cam-btn cam-btn--pri" data-cam-upload="${esc(j.id)}">${SVG.cam}Tirar foto</button>`
              : `<button type="button" class="cam-btn" data-cam-upload="${esc(j.id)}">${SVG.cam}Adicionar fotos</button>
          <a class="cam-btn cam-btn--pri" href="${open}">${openLbl}</a>`
          }
        </div>
      </div>`;
  }

  /** Job used by the crew “Tirar foto” CTA (open job, else today’s first). */
  function photoTargetJob() {
    if (selId) {
      const open = jobs.find((x) => String(x.id) === String(selId));
      if (open) return open;
    }
    const day = (crewDayJobs || []).map(mergeAgendaJob);
    return day.find((j) => j.status === "in_progress") || day[0] || null;
  }

  function crewActionButtonsHtml(jobId) {
    const id = jobId ? esc(jobId) : "";
    return `<button type="button" class="cam-btn" data-cam-receipt>${SVG.receipt}<span>Scanner Recibo</span></button>
      <button type="button" class="cam-btn cam-btn--pri" data-cam-upload="${id}"${id ? "" : " disabled aria-disabled=\"true\""}>${SVG.cam}<span>Tirar foto</span></button>`;
  }

  function pbarHtml(j) {
    if (crewMode) {
      return `<div class="cam-pbar cam-pbar--crew" id="camPbar">${crewActionButtonsHtml(j.id)}</div>`;
    }
    const open = jobOpenHref(j.id);
    return `<div class="cam-pbar" id="camPbar"><a class="cam-btn" href="${open}">Abrir job</a><button type="button" class="cam-btn cam-btn--pri" data-cam-upload="${esc(j.id)}">${SVG.cam}Tirar foto</button></div>`;
  }

  function ensureCrewActs() {
    let bar = $("camCrewActs");
    if (!crewMode) {
      if (bar) bar.remove();
      // Body flag must not reuse .cam-crew-acts — that class is display:none on the bar host.
      document.body.classList.remove("cam-has-crew-acts", "cam-crew-acts");
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "cam-crew-acts";
      bar.id = "camCrewActs";
      bar.setAttribute("aria-label", "Ações rápidas");
      document.body.appendChild(bar);
    }
    const j = photoTargetJob();
    bar.innerHTML = crewActionButtonsHtml(j && j.id);
    const detailOpen = document.body.classList.contains("cam-detail-open");
    bar.hidden = detailOpen;
    document.body.classList.remove("cam-crew-acts");
    document.body.classList.toggle("cam-has-crew-acts", !detailOpen);
  }

  function movePbar() {
    document.querySelectorAll("body > .cam-pbar").forEach((x) => x.remove());
    const bar = $("camPbar");
    if (!bar) {
      ensureCrewActs();
      return;
    }
    if (document.body.classList.contains("cam-detail-open")) document.body.appendChild(bar);
    else bar.remove();
    ensureCrewActs();
  }

  async function renderJob() {
    const host = $("camDetail");
    const j = jobs.find((x) => String(x.id) === String(selId));
    if (!j) {
      host.innerHTML = `<div class="cam-blank">Escolha um job na lista.</div>`;
      return;
    }
    if (!mediaCache[j.id]) {
      host.innerHTML = headHtml(j, null) + `<div class="cam-box cam-box--photos" aria-busy="true">${skelGrid(j.photo_count || 9)}</div>`;
      try {
        const m = await api(`/api/work-orders/${encodeURIComponent(j.id)}/media`);
        mediaCache[j.id] = (m.data || []).filter((p) => (p.type || "photo") === "photo" && p.url);
        metaCache[j.id] = m.meta || {};
      } catch (_) {
        mediaCache[j.id] = (j.photos || []).map((p) => ({ ...p, thumb_url: p.url }));
      }
      if (String(selId) !== String(j.id) || mode === "photos") return;
    }
    const list = mediaCache[j.id].slice().sort(byTaken);
    onScreen = list.map((p) => ({ ...p, job_id: j.id }));
    const counts = { none: 0 };
    PHASES.forEach(([k]) => (counts[k] = 0));
    list.forEach((p) => (counts[phaseOf(p)] += 1));
    shown = list.map((p) => toViewer(j, p));
    let body;
    if (!list.length) {
      body = crewMode
        ? `<div class="cam-box cam-none"><span class="cam-none__ic">${SVG.cam}</span><b>Nenhuma foto ainda</b><p>Tire a primeira foto desta obra.</p><button type="button" class="cam-btn" data-cam-upload="${esc(j.id)}">Tirar foto</button></div>`
        : `<div class="cam-box cam-none"><span class="cam-none__ic">${SVG.cam}</span><b>Nenhuma foto ainda</b><p>A equipe tira as fotos pelo Campo (ticket do job). Você também pode adicionar aqui.</p><button type="button" class="cam-btn" data-cam-upload="${esc(j.id)}">Adicionar fotos</button></div>`;
    } else {
      // One grid for every width, filtered by stage: Antes, Durante and Depois always show (zero is information); Geral only when it has photos.
      // Phase chips in work order: the job's own phases always show (zero is information), others only with photos.
      const has = jobPhaseList(j);
      const chips = [["all", "Todas", list.length], ...PHASES.filter(([k]) => has.includes(k) || counts[k]).map(([k, l]) => [k, l, counts[k]]), ...(counts.none ? [["none", "Sem fase", counts.none]] : [])];
      if (!chips.some(([k]) => k === stageFilter)) stageFilter = "all";
      if (stickerFilter && !list.some((p) => (p.sticker_ids || []).includes(stickerFilter))) stickerFilter = "";
      const sel = list
        .map((p, i) => [p, i])
        .filter(([p]) => stageFilter === "all" || phaseOf(p) === stageFilter)
        .filter(([p]) => !noteFilter || p.caption)
        .filter(([p]) => !stickerFilter || (p.sticker_ids || []).includes(stickerFilter));
      onScreen = sel.map(([p]) => ({ ...p, job_id: j.id })); // "Todas" picks what the filters show
      const label = stickerFilter ? `${(chips.find(([k]) => k === stageFilter) || [])[1] || ""} com “${(stickerById(stickerFilter) || {}).name || ""}”` : (chips.find(([k]) => k === stageFilter) || [])[1] || "";
      const far = list.filter((p) => p.far_from_job).length;
      const content =
        pane === "map"
          ? mapPaneHtml()
          : sel.length
            ? stageFilter === "all"
              ? phaseSectionsHtml(sel.map(([p, i]) => [{ ...p, job_id: j.id }, i]))
              : daysHtml(sel.map(([p, i]) => [{ ...p, job_id: j.id }, i]), "cam-pgrid", { tile: {} })
            : `<p class="cam-col__none">Nenhuma foto ${noteFilter ? "com nota " : ""}${stickerFilter ? `em ${esc(label)}` : stageFilter === "all" ? "" : `em ${esc(label)}`} ainda.</p>`;
      body = `<div class="cam-box cam-box--photos">
          <div class="cam-chips cam-chips--bar cam-chips--stick">${paneSwitchHtml("Local", far)}${pane === "photos" ? selectChipHtml() + chips.map(([k, l, c]) => chipHtml(k, l, c)).join("") + noteChipHtml(list) + stickerChipsHtml(list) : ""}</div>
          ${content}
        </div>`;
    }
    host.innerHTML = headHtml(j, list) + body + (isPhone() ? pbarHtml(j) : "");
    movePbar();
    renderSelBar();
    if (pane === "photos") selectHintOnce(onScreen.length);
    if (list.length && pane === "map") renderJobMap(j, list).catch(() => {});
  }

  /** "Todas": one section per job phase, in work order (Entrega → Vistoria final), each split by day. */
  function phaseSectionsHtml(items) {
    const keys = PHASES.map(([k]) => k).concat("none");
    return keys
      .map((k) => {
        const its = items.filter(([p]) => phaseOf(p) === k);
        if (!its.length) return "";
        return `<section class="cam-phase" aria-label="${esc(PHASE[k] || "Sem fase")}"><h3 class="cam-phase__h" data-no-i18n><span>${esc(PHASE[k] || "Sem fase")}</span><em>${its.length} foto${its.length === 1 ? "" : "s"}</em></h3>${daysHtml(its, "cam-pgrid", { tile: {} })}</section>`;
      })
      .join("");
  }
  /** "Com nota": narrows to photos that carry a note. */
  function noteChipHtml(list) {
    const n = list.filter((p) => p.caption).length;
    if (!n && !noteFilter) return "";
    return `<button type="button" class="cam-chip cam-chip--note${noteFilter ? " is-on" : ""}" data-note-filter aria-pressed="${noteFilter}">${SVG.noteChip}Com nota <em>${n}</em></button>`;
  }

  /** Photos split by the day they were taken; in select mode each day can be picked at once. */
  function daysHtml(items, gridCls, opts) {
    const days = [];
    items.forEach(([p, i]) => {
      const k = dayKey(takenAt(p));
      let d = days.find((x) => x.k === k);
      if (!d) days.push((d = { k, label: dayLabel(takenAt(p)), items: [], jobs: new Set() }));
      d.items.push([p, i]);
      d.jobs.add(p.job_id);
    });
    // Long grids: each day block skips layout and paint while off screen; the height guess keeps the scrollbar steady.
    const long = items.length > 48;
    const cols = isPhone() ? 3 : Math.max(2, Math.floor(((($("camDetail") || {}).clientWidth || 900) - 36) / 148));
    const rowH = isPhone() ? Math.round(window.innerWidth / 3) : 150;
    return days
      .map((d) => {
        const ids = d.items.map(([p]) => String(p.id));
        const all = ids.every((id) => picked.has(id));
        const n = d.items.length;
        const meta = `${n} foto${n === 1 ? "" : "s"}${opts.jobs ? ` · ${d.jobs.size} job${d.jobs.size === 1 ? "" : "s"}` : ""}`;
        const cv = long ? ` is-cv" style="contain-intrinsic-size: auto ${Math.ceil(n / cols) * rowH + 44}px` : "";
        return `<div class="cam-dayg${cv}"><div class="cam-day"><span>${esc(d.label)}</span><em>${meta}</em>${selecting ? `<button type="button" class="cam-link" data-sel-day="${esc(ids.join(","))}" data-all="${all ? 1 : 0}">${all ? "Desmarcar dia" : "Selecionar dia"}</button>` : ""}</div>
          <div class="${gridCls}">${d.items.map(([p, i]) => photoTile(p, i, opts.tile)).join("")}</div></div>`;
      })
      .join("");
  }

  /** Sticker filter chips, only for stickers that photos here actually carry, plus "Stickers" to manage them. */
  function stickerChipsHtml(list) {
    const counts = {};
    list.forEach((p) => (p.sticker_ids || []).forEach((id) => (counts[id] = (counts[id] || 0) + 1)));
    const chips = stickers
      .filter((x) => counts[x.id])
      .map((x) => `<button type="button" class="cam-chip cam-chip--stk${stickerFilter === x.id ? " is-on" : ""}" data-no-i18n data-sticker="${esc(x.id)}" aria-pressed="${stickerFilter === x.id}" style="--stk:${esc(x.color)}"><i aria-hidden="true"></i>${esc(x.name)} <em>${counts[x.id]}</em></button>`)
      .join("");
    const manage = canManage ? `<button type="button" class="cam-chip cam-chip--ghost" data-stk-manage>${SVG.tag}Etiquetas</button>` : "";
    return chips || manage ? `<span class="cam-chips__sep" aria-hidden="true"></span>${chips}${manage}` : "";
  }

  // ---------------------------------------------------------------- multi-select
  function selectChipHtml() {
    if (selecting || !onScreen.length) return "";
    return `<button type="button" class="cam-chip cam-chip--sel" data-sel-start>${SVG.sel}Selecionar</button>`;
  }
  const SEL_HINT_KEY = "om_cam_selhint_v1";
  /** Holding a photo is invisible on a touch screen: say it once, the first time a grid with photos shows. */
  function selectHintOnce(n) {
    if (selecting || n < 2 || !coarse()) return;
    try {
      if (localStorage.getItem(SEL_HINT_KEY)) return;
      localStorage.setItem(SEL_HINT_KEY, "1");
    } catch (_) {
      return;
    }
    setTimeout(() => window.crmToast?.info?.("Toque e segure uma foto para selecionar várias"), 600);
  }
  function startSelecting(firstId) {
    selecting = true;
    picked.clear();
    if (firstId) picked.add(String(firstId));
    try {
      localStorage.setItem(SEL_HINT_KEY, "1");
    } catch (_) {}
    document.body.classList.add("cam-selecting");
    renderRight();
  }
  /** The bar drops back below the screen edge (180ms) before it goes; a new selection gets a fresh bar meanwhile. */
  function dropSelBar() {
    const bar = $("camSelBar");
    if (!bar) return;
    bar.removeAttribute("id");
    bar.classList.add("is-leaving");
    setTimeout(() => bar.remove(), 200);
  }
  function stopSelecting() {
    if (!selecting) return;
    selecting = false;
    picked.clear();
    document.body.classList.remove("cam-selecting");
    dropSelBar();
    closeSelSheet();
    renderRight();
  }
  function pickedPhotos() {
    return onScreen.filter((p) => picked.has(String(p.id)));
  }
  /** Flip one tile without repainting the grid, so long lists stay smooth while picking. */
  function togglePick(id) {
    id = String(id);
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    document.querySelectorAll(`#camDetail [data-ph-id="${CSS.escape(id)}"]`).forEach((t) => {
      t.classList.toggle("is-pick", picked.has(id));
      t.setAttribute("aria-pressed", String(picked.has(id)));
    });
    syncDayLinks();
    renderSelBar();
  }
  function syncDayLinks() {
    document.querySelectorAll("#camDetail [data-sel-day]").forEach((b) => {
      const all = b.getAttribute("data-sel-day").split(",").every((id) => picked.has(id));
      b.setAttribute("data-all", all ? "1" : "0");
      b.textContent = all ? "Desmarcar dia" : "Selecionar dia";
    });
  }
  function renderSelBar() {
    let bar = $("camSelBar");
    if (!selecting) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "camSelBar";
      bar.className = "cam-selbar";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Fotos selecionadas");
      document.body.appendChild(bar);
    }
    const n = picked.size;
    const all = onScreen.length && onScreen.every((p) => picked.has(String(p.id)));
    const dis = n ? "" : " disabled";
    // Phones that can share get "Compartilhar" (its sheet also saves to Fotos) in place of "Baixar"; computers keep both.
    const share = canShare();
    const dl = !share || !coarse();
    bar.innerHTML = `<button type="button" class="cam-selbar__x" data-sel-stop aria-label="Sair da seleção">${SVG.x}</button>
      <span class="cam-selbar__n" role="status" aria-live="polite"><b>${n}</b> ${n === 1 ? "foto" : "fotos"}</span>
      <button type="button" class="cam-link" data-sel-all="${all ? 0 : 1}">${all ? "Desmarcar todas" : "Todas"}</button>
      <span class="cam-selbar__acts">
        ${canEditMedia ? `<button type="button" data-sel-act="stage"${dis}>${SVG.layers}<span>Fase</span></button>` : ""}${canManage ? `<button type="button" data-sel-act="stickers"${dis}>${SVG.tag}<span>Etiquetas</span></button>` : ""}
        ${share ? `<button type="button" class="is-share" data-sel-act="share"${dis}>${SVG.share}<span>Compartilhar</span></button>` : ""}
        ${dl ? `<button type="button" data-sel-act="download"${dis}>${SVG.dl}<span>Baixar</span></button>` : ""}
        ${canEditMedia ? `<button type="button" class="is-danger" data-sel-act="delete"${dis}>${SVG.trash}<span>Apagar</span></button>` : ""}
      </span>`;
  }

  /** Small sheet for a batch choice (fase, etiquetas), above the selection bar. Same shell and motion as the others. */
  let selSheetApi = null;
  function closeSelSheet() {
    if (selSheetApi) selSheetApi.close();
  }
  function selSheet(title, inner) {
    const old = $("camSelSheet");
    if (old) {
      old.removeAttribute("id");
      selSheetApi?.close();
      setTimeout(() => old.remove(), 400);
    }
    const el = sheetShell("cam-selsheet", "camSelT");
    el.id = "camSelSheet";
    el.querySelector(".cam-up__body").innerHTML = `<h2 id="camSelT">${title}</h2>${inner}<div class="cam-up__status" role="status"></div><button type="button" class="cam-up__cancel" data-selsheet-close>Fechar</button>`;
    const api = camSheet(el, {
      onClose: () => {
        if (selSheetApi === api) selSheetApi = null;
        setTimeout(() => el.remove(), 400);
      },
    });
    selSheetApi = api;
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-selsheet-close]")) api.close();
    });
    api.open();
    el.close = () => api.close();
    return el;
  }
  /** Run one request per photo, in order, with progress in the sheet or bar; returns how many worked. */
  async function eachPhoto(list, label, fn, statusEl) {
    let ok = 0;
    for (const p of list) {
      if (statusEl) statusEl.textContent = `${label} ${ok + 1} de ${list.length}…`;
      try {
        await fn(p);
        ok += 1;
      } catch (err) {
        const msg = friendlyError(err, "esta foto", "mudar");
        if (statusEl) statusEl.textContent = msg;
        window.crmToast?.error?.(`${ok} de ${list.length} feitas. ${msg}`);
        break;
      }
    }
    return ok;
  }
  function patchCaches(id, patch) {
    [feed, onScreen, ...Object.values(mediaCache), ...jobs.map((x) => x.photos || [])].forEach((arr) =>
      arr.forEach((x) => {
        if (String(x.id) === String(id)) Object.assign(x, patch);
      }),
    );
  }
  /** Phase for many photos at once; "Automático" hands them back to the date rules. */
  function openStageSheet() {
    const list = pickedPhotos();
    const opts = PHASES.map(([k, l]) => [k, l]).concat([["", "Automático (pela data)"]]);
    const el = selSheet(`Fase de ${list.length} foto${list.length === 1 ? "" : "s"}`, `<div class="cam-up__phases" data-no-i18n>${opts.map(([k, l]) => `<button type="button" class="cam-up__stage${k ? "" : " cam-up__stage--auto"}" data-bulk-phase="${esc(k)}">${esc(l)}</button>`).join("")}</div>`);
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-bulk-phase]");
      if (!b) return;
      const phase = b.getAttribute("data-bulk-phase") || null;
      el.querySelectorAll("button").forEach((x) => (x.disabled = true));
      const ok = await eachPhoto(list, "Mudando", async (p) => {
        const r = await api(`/api/work-orders/${encodeURIComponent(p.job_id)}/media/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ phase }) });
        patchCaches(p.id, { phase: r.data ? r.data.phase : phase, phase_source: r.data ? r.data.phase_source : phase ? "manual" : null });
      }, el.querySelector(".cam-up__status"));
      el.close();
      window.crmToast?.success?.(`${ok} foto${ok === 1 ? "" : "s"} em ${PHASE[phase] || "fase automática"}`);
      renderRight();
    });
  }
  /** Stickers for many photos: a sticker every picked photo has is removed from all; otherwise it is added to all. */
  function openStickersSheet() {
    const list = pickedPhotos();
    const paint = () => {
      const chips = stickers
        .filter((x) => !x.archived)
        .map((x) => {
          const n = list.filter((p) => (p.sticker_ids || []).includes(x.id)).length;
          const state = n === list.length ? "all" : n ? "some" : "none";
          return `<button type="button" class="cam-up__stk${state === "all" ? " is-on" : ""}${state === "some" ? " is-some" : ""}" data-bulk-stk="${esc(x.id)}" aria-pressed="${state === "all" ? "true" : state === "some" ? "mixed" : "false"}" style="--stk:${esc(x.color)}"><i aria-hidden="true"></i>${esc(x.name)}${state === "some" ? ` <em>${n}/${list.length}</em>` : ""}</button>`;
        })
        .join("");
      return `<p>Toque para pôr em todas as fotos; toque de novo para tirar de todas.</p><div class="cam-up__stks" data-no-i18n>${chips || "Nenhuma etiqueta criada."}</div>`;
    };
    const el = selSheet(`Etiquetas em ${list.length} foto${list.length === 1 ? "" : "s"}`, `<div data-bulk-body>${paint()}</div>`);
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-bulk-stk]");
      if (!b) return;
      const id = b.getAttribute("data-bulk-stk");
      const remove = list.every((p) => (p.sticker_ids || []).includes(id));
      el.querySelectorAll("[data-bulk-stk]").forEach((x) => (x.disabled = true));
      const status = el.querySelector(".cam-up__status");
      await eachPhoto(list, remove ? "Tirando de" : "Pondo em", async (p) => {
        const cur = p.sticker_ids || [];
        const next = remove ? cur.filter((x) => x !== id) : cur.includes(id) ? cur : cur.concat(id);
        if (next.join() === cur.join()) return;
        const r = await api(`/api/work-orders/${encodeURIComponent(p.job_id)}/media/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify({ sticker_ids: next }) });
        patchCaches(p.id, { sticker_ids: (r.data && r.data.sticker_ids) || next });
      }, status);
      status.textContent = remove ? "Etiqueta tirada das fotos" : "Etiqueta posta nas fotos";
      el.querySelector("[data-bulk-body]").innerHTML = paint();
      renderRight();
    });
  }
  /** File name for a picked photo: job number + the day it was taken (obracam-job-1234-2026-11-05-2.jpg). */
  function pickedName(p, n, total) {
    const number = p.job_number != null ? p.job_number : (jobs.find((j) => String(j.id) === String(p.job_id)) || {}).number;
    const ref = { ...p, job: { number } };
    if (window.CamViewer && window.CamViewer.photoName) return window.CamViewer.photoName(ref, total > 1 ? n + 1 : 0);
    return `obracam-${number || "foto"}${total > 1 ? `-${n + 1}` : ""}.jpg`;
  }
  /** One file per photo; the browser may ask once to allow several downloads. Phones often take only the first. */
  async function downloadPicked() {
    const list = pickedPhotos();
    if (list.length > 1) {
      window.crmToast?.info?.(
        coarse()
          ? `Baixando ${list.length} fotos, uma por vez. No celular o navegador pode salvar só a primeira; para todas, baixe pelo computador.`
          : `Baixando ${list.length} fotos, uma por vez. Se o navegador perguntar, permita vários downloads.`,
      );
    }
    for (const [n, p] of list.entries()) {
      const a = document.createElement("a");
      a.href = p.url;
      a.download = pickedName(p, n, list.length);
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 350));
    }
    if (!coarse()) window.crmToast?.success?.(`${list.length} foto${list.length === 1 ? "" : "s"} baixada${list.length === 1 ? "" : "s"}`);
  }
  /** "Compartilhar": the picked photos as JPEG files in the system sheet (WhatsApp, Mensagens, Salvar imagens…). */
  async function sharePicked(btn) {
    const list = pickedPhotos();
    if (!list.length) return;
    window.OmUI?.busy?.(btn, true);
    let r = "unsupported";
    try {
      r = window.CamViewer && window.CamViewer.sharePhotos ? await window.CamViewer.sharePhotos(list.map((p, n) => ({ url: p.url, name: pickedName(p, n, list.length) }))) : "unsupported";
    } finally {
      window.OmUI?.busy?.(btn, false);
    }
    if (r === "failed") window.crmToast?.info?.("Não deu para compartilhar agora; as fotos vão ser baixadas.");
    if (r === "unsupported" || r === "failed") downloadPicked();
  }
  async function deletePicked() {
    const list = pickedPhotos();
    const okDel = await window.crmConfirm({
      title: `Apagar ${list.length} foto${list.length === 1 ? "" : "s"}?`,
      text: "Elas saem dos jobs e do ObraCam.",
      ok: list.length === 1 ? "Apagar foto" : "Apagar fotos",
      danger: true,
    });
    if (!okDel) return;
    const bar = $("camSelBar");
    bar?.querySelectorAll("button").forEach((x) => (x.disabled = true));
    const ok = await eachPhoto(list, "Apagando", async (p) => {
      await api(`/api/work-orders/${encodeURIComponent(p.job_id)}/media/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      dropPhotoEverywhere(p.id);
      delete mediaCache[p.job_id];
    }, bar?.querySelector(".cam-selbar__n"));
    window.crmToast?.success?.(`${ok} foto${ok === 1 ? "" : "s"} apagada${ok === 1 ? "" : "s"}`);
    stopSelecting();
    renderList();
  }
  function onSelBarClick(e) {
    if (e.target.closest("[data-sel-stop]")) return stopSelecting();
    const all = e.target.closest("[data-sel-all]");
    if (all) {
      if (all.getAttribute("data-sel-all") === "1") onScreen.forEach((p) => picked.add(String(p.id)));
      else picked.clear();
      document.querySelectorAll("#camDetail [data-ph-id]").forEach((t) => {
        const on = picked.has(t.getAttribute("data-ph-id"));
        t.classList.toggle("is-pick", on);
        t.setAttribute("aria-pressed", String(on));
      });
      syncDayLinks();
      return renderSelBar();
    }
    const act = e.target.closest("[data-sel-act]");
    if (!act || !picked.size) return;
    const k = act.getAttribute("data-sel-act");
    if (k === "stage") openStageSheet();
    else if (k === "stickers") openStickersSheet();
    else if (k === "download") downloadPicked();
    else if (k === "share") sharePicked(act);
    else if (k === "delete") deletePicked();
  }

  function chipHtml(k, l, c) {
    return `<button type="button" class="cam-chip${k === stageFilter ? " is-on" : ""}" data-no-i18n data-stage="${k}" aria-pressed="${k === stageFilter}">${l} <em>${c}</em></button>`;
  }
  /** Fotos | Local (or Mapa): the map is a place you open, not a column that is always half off screen. */
  function paneSwitchHtml(mapLabel, far) {
    const btn = (id, label) => `<button type="button" class="${pane === id ? "is-on" : ""}" data-pane="${id}" aria-pressed="${pane === id}">${label}</button>`;
    return `<span class="cam-pane" role="group" aria-label="Mostrar">${btn("photos", "Fotos")}${btn("map", `${SVG.pin}${mapLabel}${far ? ` <em class="is-far">${far} longe</em>` : ""}`)}</span>`;
  }
  function mapPaneHtml() {
    return `<div class="cam-map cam-map--big" id="camMap"></div><p class="cam-meta" id="camMapNote"></p>`;
  }

  // ---------------------------------------------------------------- fotos recentes (últimos dias, todos os jobs)
  function feedSub() {
    return `Últimos ${FEED_DAYS} dias · ${feed.length} foto${feed.length === 1 ? "" : "s"} de todos os jobs`;
  }
  function renderFeed() {
    const host = $("camDetail");
    // The shell (title, search, map) is built once; typing or picking a stage only repaints the photos, so the search keeps focus and the map is not redrawn.
    if (!host.querySelector("#camFeedBody")) {
      host.innerHTML = `<div class="cam-dh cam-dh--feed"><div class="cam-dh__t"><h2>Fotos recentes</h2><p class="cam-dsub" id="camFeedSub">${feedSub()}</p></div>
          <label class="cam-search cam-search--feed"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="search" id="camFeedQ" placeholder="Buscar job, etapa ou quem tirou" autocomplete="off" enterkeyhint="search" value="${esc($("camQ").value)}" /></label></div>
        <div class="cam-box cam-box--feed" id="camFeedBody"></div>`;
      movePbar();
    }
    if ($("camFeedSub")) $("camFeedSub").textContent = feedSub();
    const hit = feed.filter((p) => {
      if (stageFilter !== "all" && phaseOf(p) !== stageFilter) return false;
      if (noteFilter && !p.caption) return false;
      if (stickerFilter && !(p.sticker_ids || []).includes(stickerFilter)) return false;
      if (!q) return true;
      const tags = (p.sticker_ids || []).map(stickerById).filter(Boolean).map((x) => x.name);
      return norm([p.job_number, p.job_title, feedJobName(p), phaseName(p), p.caption, p.address, p.author_name, p.taken_by_name, p.camera_model, ...tags].filter(Boolean).join(" ")).includes(q);
    }).sort(byTaken);
    const counts = { all: feed.length, none: 0 };
    PHASES.forEach(([k]) => (counts[k] = 0));
    feed.forEach((p) => (counts[phaseOf(p)] += 1));
    shown = hit.map((p) => toViewer({ id: p.job_id, number: p.job_number, title: p.job_title, client_name: (jobs.find((x) => x.id === p.job_id) || {}).client_name }, p));
    onScreen = hit;
    const chips = [["all", "Todas"], ...PHASES, ["none", "Sem fase"]]
      .filter(([k]) => k === "all" || counts[k])
      .map(([k, l]) => chipHtml(k, l, counts[k]))
      .join("");
    const grid = !loaded
      ? skelGrid(12)
      : hit.length
      ? daysHtml(hit.map((p, i) => [p, i]), "cam-feedg", { jobs: true, tile: { stage: true, job: true } })
      : `<p class="cam-empty">${q || stageFilter !== "all" || stickerFilter || noteFilter ? "Nenhuma foto com esse filtro." : `Nenhuma foto nos últimos ${FEED_DAYS} dias.`}</p>`;
    $("camFeedBody").innerHTML = `<div class="cam-chips cam-chips--bar cam-chips--stick">${paneSwitchHtml("Mapa", 0)}${pane === "photos" ? selectChipHtml() + chips + noteChipHtml(feed) + stickerChipsHtml(feed) : ""}</div>${pane === "map" ? mapPaneHtml() : grid}`;
    renderSelBar();
    if (pane === "map") renderAllMap().catch(() => {});
    else if (loaded) selectHintOnce(hit.length);
  }

  // ---------------------------------------------------------------- mapa
  async function geocode(address) {
    const key = String(address || "").trim().toLowerCase();
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(geoCache, key)) return geoCache[key];
    let pt = null;
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address), { headers: { Accept: "application/json" } });
      const rows = r.ok ? await r.json() : [];
      if (rows[0]) pt = { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
    } catch (_) {}
    geoCache[key] = pt;
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache));
    } catch (_) {}
    return pt;
  }

  /** Leaflet is only for the map: its CSS and JS load the first time a map opens, not with the page. */
  const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
  let leafletP = null;
  function loadLeaflet() {
    if (typeof L !== "undefined") return Promise.resolve();
    if (leafletP) return leafletP;
    leafletP = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = `${LEAFLET}.css`;
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = `${LEAFLET}.js`;
      js.async = true;
      js.onload = () => resolve();
      js.onerror = () => {
        leafletP = null;
        js.remove();
        reject(new Error("leaflet"));
      };
      document.head.appendChild(js);
    });
    return leafletP;
  }

  async function newMap(gen) {
    if (map) {
      try {
        map.remove();
      } catch (_) {}
      map = null;
    }
    if (!$("camMap")) return null;
    const note0 = $("camMapNote");
    if (typeof L === "undefined" && note0) note0.textContent = "Carregando o mapa…";
    try {
      await loadLeaflet();
    } catch (_) {}
    // the person may have left the map (or opened another) while Leaflet was loading
    if (gen !== mapGen) return null;
    const el = $("camMap");
    if (!el) return null;
    if (note0 && note0.isConnected) note0.textContent = "";
    if (typeof L === "undefined") {
      el.classList.add("is-off");
      const note = $("camMapNote");
      if (note) note.textContent = "Mapa indisponível agora";
      return null;
    }
    map = L.map(el).setView([39.5, -98.35], 4);
    // Same tiles as the Calendar and Pipeline maps; the CARTO basemap now stamps "API key required" over the map.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap", maxZoom: 19 }).addTo(map);
    setTimeout(() => map && map.invalidateSize(), 80);
    return map;
  }
  function fit(pts) {
    if (!map || !pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(pts, { padding: [28, 28], maxZoom: 16 });
  }
  function photoIcon(p) {
    return L.divIcon({ className: "jmb-marker", html: `<img class="jmb-marker__photo-thumb${p.far_from_job ? " is-far" : ""}" src="${esc(p.thumb_url || p.url)}" alt="" />`, iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function jobIcon(hot) {
    return L.divIcon({ className: "jmb-marker", html: `<span class="jmb-marker__pin" style="background:${hot ? "#B4561A" : "#221E1A"}"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  async function renderJobMap(j, list) {
    const gen = ++mapGen;
    if (!(await newMap(gen))) return;
    const pts = [];
    list.forEach((p, i) => {
      if (!hasGps(p)) return;
      const m = L.marker([Number(p.lat), Number(p.lng)], { icon: photoIcon(p) }).addTo(map);
      m.on("click", () => openViewer(shown, i));
      pts.push([Number(p.lat), Number(p.lng)]);
    });
    let site = metaCache[j.id]?.job_geo || (j.geo_lat != null ? { lat: j.geo_lat, lng: j.geo_lng } : null);
    if (!site && j.address) site = await geocode(j.address);
    if (gen !== mapGen || !map) return;
    if (site && Number.isFinite(Number(site.lat))) {
      L.marker([Number(site.lat), Number(site.lng)], { icon: jobIcon(false) }).addTo(map).bindTooltip(esc(j.address || "Local do job"));
      pts.push([Number(site.lat), Number(site.lng)]);
    }
    fit(pts);
    const note = $("camMapNote");
    if (note) note.textContent = `${list.filter(hasGps).length} de ${list.length} com GPS${site ? " · ponto preto = local do job" : ""}`;
  }

  async function renderAllMap() {
    const gen = ++mapGen;
    if (!(await newMap(gen))) return;
    const pts = [];
    let placed = 0;
    for (const j of jobs.filter((x) => isActive(x) || (x.photos || []).length)) {
      let pt = j.geo_lat != null ? { lat: j.geo_lat, lng: j.geo_lng } : null;
      if (!pt && j.address) pt = await geocode(j.address);
      if (gen !== mapGen || !map) return;
      if (!pt || !Number.isFinite(Number(pt.lat))) continue;
      const m = L.marker([Number(pt.lat), Number(pt.lng)], { icon: jobIcon(needsPhoto(j)) }).addTo(map);
      m.bindTooltip(esc(`#${j.number ?? ""} ${j.title || ""}`));
      m.on("click", () => {
        mode = isActive(j) ? "active" : "done";
        select(j.id, true);
      });
      pts.push([Number(pt.lat), Number(pt.lng)]);
      placed += 1;
      fit(pts);
    }
    const note = $("camMapNote");
    if (note) note.textContent = `${placed} job${placed === 1 ? "" : "s"} no mapa · laranja = precisa de foto`;
  }

  // ---------------------------------------------------------------- navegação
  function renderRight() {
    if (mode === "photos") renderFeed();
    else renderJob();
  }

  function select(id, push) {
    if (selecting) {
      selecting = false;
      picked.clear();
      document.body.classList.remove("cam-selecting");
      dropSelBar();
    }
    selId = id;
    stageFilter = "all";
    stickerFilter = "";
    noteFilter = false;
    pane = "photos";
    renderList();
    const feedView = mode === "photos";
    const narrow = !isWide();
    const open = narrow && !!id && !feedView;
    $("camSplit").classList.toggle("is-detail", open);
    $("camSplit").classList.toggle("is-feed", feedView);
    document.body.classList.toggle("cam-detail-open", open);
    $("camDetail").innerHTML = "";
    movePbar();
    renderRight();
    if (push) {
      try {
        const u = new URL(location.href);
        if (id) u.searchParams.set("id", id);
        else u.searchParams.delete("id");
        history.replaceState(null, "", u);
      } catch (_) {}
    }
    if (narrow) {
      window.scrollTo(0, 0);
      const main = document.querySelector(".dashboard-main");
      if (main) main.scrollTop = 0;
    }
  }

  /** Jobs | Fotos: the two top-level views. Fotos is every recent photo across jobs; Jobs is the triage list with one job open. */
  function setView(view) {
    if (crewMode && view === "photos") return;
    if (view === "photos") {
      if (mode === "photos") return;
      mode = "photos";
      select(null, true);
      return;
    }
    if (mode === "photos") mode = "active";
    renderList();
    select(isWide() ? firstVisibleId() : null, true);
  }

  function back() {
    $("camSplit").classList.remove("is-detail");
    document.body.classList.remove("cam-detail-open");
    movePbar();
    if (mode === "photos") mode = "active";
    selId = null;
    renderList();
    try {
      const u = new URL(location.href);
      u.searchParams.delete("id");
      history.replaceState(null, "", u);
    } catch (_) {}
  }

  // ---------------------------------------------------------------- loading and failure, shaped like the content
  function skelRows(n) {
    let out = "";
    for (let i = 0; i < n; i += 1)
      out += `<div class="cam-skel-row"><i class="cam-skel cam-skel--day"></i><span><i class="cam-skel cam-skel--line" style="width:${[62, 48, 70, 55][i % 4]}%"></i><i class="cam-skel cam-skel--sm" style="width:${[38, 44, 30, 41][i % 4]}%"></i></span></div>`;
    return `<div class="cam-skel-rows" aria-hidden="true">${out}</div><span class="cam-sr" role="status">Carregando jobs</span>`;
  }
  function skelGrid(n) {
    const k = Math.max(6, Math.min(n || 9, 15));
    return `<i class="cam-skel cam-skel-h" aria-hidden="true"></i><div class="cam-skel-grid" aria-hidden="true">${'<i class="cam-skel"></i>'.repeat(k)}</div><span class="cam-sr" role="status">Carregando fotos</span>`;
  }
  function loadErrorHtml(err) {
    const off = (typeof navigator !== "undefined" && navigator.onLine === false) || (err && err.name === "TypeError");
    return `<div class="cam-err" role="alert"><b>${off ? "Sem conexão" : "Não deu para carregar o ObraCam"}</b><p>${off ? "Confira a internet do aparelho e tente de novo." : "O servidor não respondeu agora. Tente de novo em instantes."}</p><button type="button" data-cam-retry>Tentar de novo</button></div>`;
  }
  function boot() {
    $("camRows").innerHTML = skelRows(5);
    if (mode === "photos") renderFeed();
    return load().catch((e) => {
      if (e && e.message === "unauth") return;
      $("camRows").innerHTML = loadErrorHtml(e);
      $("camDetail").innerHTML = mode === "photos" ? loadErrorHtml(e) : "";
    });
  }

  async function load() {
    const j = await api(`/api/job-media/board?days=${FEED_DAYS}`);
    jobs = j.data?.jobs || [];
    feed = j.data?.feed || [];
    loaded = true;
    const id = new URLSearchParams(location.search).get("id");
    const pre = id && jobs.find((x) => String(x.id) === id);
    if (pre) {
      mode = isActive(pre) ? "active" : "done";
      select(pre.id, false);
      return;
    }
    renderList();
    if (mode === "photos") renderRight();
    else if (isWide()) {
      selId = firstVisibleId();
      renderList();
      renderRight();
    }
  }

  // ---------------------------------------------------------------- upload (one sheet, one send path)
  let uploadTarget = null;
  let uploadSheet = null;
  let uploadLayer = null;
  let uploadCamera = null;
  let uploadLibrary = null;
  /** What the sheet shows: idle (choose), progress ("2 de 5"), error (message + "Tentar de novo"). */
  let uploadState = { kind: "idle" };
  /** Files still to send after a failure, so "Tentar de novo" picks up where it stopped. */
  let uploadRetry = null;

  function ensureUploadUi() {
    if (uploadSheet) return;
    uploadSheet = sheetShell("cam-up--send", "camUpTitle");
    uploadLayer = camSheet(uploadSheet, {
      initialFocus: () => uploadSheet.querySelector("[data-cam-up-camera]") || uploadSheet.querySelector("[data-cam-up-retry]") || uploadSheet.querySelector(".cam-up__cancel"),
    });
    uploadCamera = document.createElement("input");
    uploadCamera.type = "file";
    uploadCamera.accept = "image/*";
    uploadCamera.setAttribute("capture", "environment");
    uploadCamera.hidden = true;
    uploadLibrary = document.createElement("input");
    uploadLibrary.type = "file";
    uploadLibrary.accept = "image/*";
    uploadLibrary.multiple = true;
    uploadLibrary.hidden = true;
    document.body.append(uploadCamera, uploadLibrary);
    uploadCamera.addEventListener("change", () => {
      void sendUpload(uploadCamera.files);
      uploadCamera.value = "";
    });
    uploadLibrary.addEventListener("change", () => {
      void sendUpload(uploadLibrary.files);
      uploadLibrary.value = "";
    });
    uploadSheet.addEventListener("change", (e) => {
      if (e.target.id === "camUpWho") uploadTakenBy = e.target.value;
    });
    uploadSheet.addEventListener("click", (e) => {
      const t = e.target.closest("[data-cam-up-camera],[data-cam-up-library],[data-cam-up-close],[data-cam-up-stk],[data-cam-up-retry]");
      if (!t) return;
      if (t.hasAttribute("data-cam-up-stk")) {
        const id = t.getAttribute("data-cam-up-stk");
        uploadStickers = uploadStickers.includes(id) ? uploadStickers.filter((x) => x !== id) : uploadStickers.concat(id);
        paintUploadSheet();
        return;
      }
      if (t.hasAttribute("data-cam-up-camera")) {
        uploadFrom = "camera";
        return uploadCamera.click();
      }
      if (t.hasAttribute("data-cam-up-library")) {
        uploadFrom = "library";
        return uploadLibrary.click();
      }
      if (t.hasAttribute("data-cam-up-retry")) {
        const again = uploadRetry;
        uploadRetry = null;
        if (again && again.length) void sendUpload(again);
        else {
          uploadState = { kind: "idle" };
          paintUploadSheet();
        }
        return;
      }
      if (t.hasAttribute("data-cam-up-close")) closeUploadSheet();
    });
  }

  const UP_ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    lib: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  };
  let uploadFrom = "library";
  let uploadTakenBy = "";
  let uploadStickers = [];
  let people = null;
  let meId = "";

  /** Team for "Tirada por"; loaded the first time the sheet opens. */
  function loadPeople() {
    if (people) return Promise.resolve(people);
    return api("/api/job-media/people")
      .then((r) => (people = r.data || []))
      .catch(() => (people = []));
  }

  function progressHtml(i, n) {
    return `<div class="cam-up__prog" role="status" aria-live="polite"><b data-up-n>Enviando ${i + 1} de ${n}…</b><div class="cam-up__bar" aria-hidden="true"><i style="--p:${(i / n).toFixed(3)}"></i></div></div>`;
  }
  /** Progress moves in place (text + bar), so the bar glides from file to file instead of being repainted. */
  function showProgress(i, n) {
    uploadState = { kind: "progress", i, n };
    const b = uploadSheet && uploadSheet.querySelector("[data-up-n]");
    if (!b) return paintUploadSheet();
    b.textContent = `Enviando ${i + 1} de ${n}…`;
    uploadSheet.querySelector(".cam-up__bar i")?.style.setProperty("--p", (i / n).toFixed(3));
  }

  function paintUploadSheet() {
    ensureUploadUi();
    const body = uploadSheet.querySelector(".cam-up__body");
    const stt = uploadState || { kind: "idle" };
    const busy = stt.kind === "progress";
    const keep = document.activeElement && body.contains(document.activeElement) ? [...body.querySelectorAll("button")].indexOf(document.activeElement) : -1;
    const dis = busy ? " disabled" : "";
    const active = stickers.filter((x) => !x.archived);
    body.innerHTML = `<h2 id="camUpTitle">Enviar fotos</h2>
      <p>${esc(uploadTarget ? uploadTarget.label : "")}</p>
      <div class="cam-up__auto">${UP_ICON.check}<span><b>A fase é automática.</b> Entrega, Medição, Instalação, Lixa e acabamento ou Vistoria final, pela data de cada foto e as datas do job. Dá para corrigir depois.</span></div>
      ${active.length
        ? `<p class="cam-up__lbl">Etiquetas <span>opcional</span></p><div class="cam-up__stks" role="group" aria-label="Etiquetas" data-no-i18n>${active
            .map((x) => `<button type="button" class="cam-up__stk${uploadStickers.includes(x.id) ? " is-on" : ""}" data-cam-up-stk="${esc(x.id)}" aria-pressed="${uploadStickers.includes(x.id)}" style="--stk:${esc(x.color)}"${dis}><i aria-hidden="true"></i>${esc(x.name)}</button>`)
            .join("")}</div>`
        : ""}
      ${people && people.length > 1
        ? `<label class="cam-up__who"><span>Tirada por</span><select id="camUpWho"${dis}>${people
            .map((u) => `<option value="${esc(u.id)}"${u.id === (uploadTakenBy || meId) ? " selected" : ""}>${esc(u.name || "—")}${u.id === meId ? " (você)" : ""}</option>`)
            .join("")}</select></label>`
        : ""}
      ${busy
        ? progressHtml(stt.i, stt.n)
        : stt.kind === "error"
          ? `<div class="cam-up__err" role="alert"><b>${esc(stt.title)}</b>${esc(stt.message)}</div>
             <button type="button" class="cam-up__retry" data-cam-up-retry>Tentar de novo</button>`
          : `<div class="cam-up__go">
               <button type="button" data-cam-up-camera>${UP_ICON.cam}Câmera</button>
               <button type="button" class="is-sec" data-cam-up-library>${UP_ICON.lib}Galeria</button>
             </div>`}
      <button type="button" class="cam-up__cancel" data-cam-up-close>${busy ? "Fechar (o envio continua)" : "Cancelar"}</button>`;
    if (keep >= 0) body.querySelectorAll("button")[keep]?.focus();
  }

  function closeUploadSheet() {
    if (uploadLayer) uploadLayer.close();
  }

  function openUploadSheet(jobId) {
    const j = jobs.find((x) => String(x.id) === String(jobId)) || (jobId ? null : photoTargetJob());
    if (!j) {
      window.crmToast?.error?.("Escolha um job na agenda para tirar foto.");
      return;
    }
    ensureUploadUi();
    const who = listWho(j);
    const same = uploadTarget && String(uploadTarget.id) === String(j.id);
    uploadTarget = { id: j.id, label: who && who !== "Sem cliente" ? who : j.title || "Job" };
    // an upload still running (or stopped with an error) for this job keeps its state; anything else starts clean
    if (!(same && (uploadState.kind === "progress" || uploadState.kind === "error"))) {
      uploadState = { kind: "idle" };
      uploadRetry = null;
      uploadTakenBy = "";
      uploadStickers = [];
    }
    paintUploadSheet();
    uploadLayer.open();
    if (!people) loadPeople().then(() => uploadLayer.isOpen() && uploadState.kind !== "progress" && paintUploadSheet());
  }

  // ---------------------------------------------------------------- Scanner Recibo (reembolso do dia)
  let receiptSheet = null;
  let receiptLayer = null;
  let receiptCamera = null;
  let receiptState = { kind: "idle" }; // idle | form | saving

  function ensureReceiptUi() {
    if (receiptSheet) return;
    receiptSheet = sheetShell("cam-up--receipt", "camRcptTitle");
    receiptLayer = camSheet(receiptSheet, {
      initialFocus: () =>
        receiptSheet.querySelector("#camRcptAmt") || receiptSheet.querySelector("[data-cam-rcpt-camera]") || receiptSheet.querySelector("[data-cam-rcpt-close]"),
    });
    receiptCamera = document.createElement("input");
    receiptCamera.type = "file";
    receiptCamera.accept = "image/*";
    receiptCamera.setAttribute("capture", "environment");
    receiptCamera.hidden = true;
    document.body.appendChild(receiptCamera);
    receiptCamera.addEventListener("change", () => {
      const file = receiptCamera.files && receiptCamera.files[0];
      receiptCamera.value = "";
      if (file) void onReceiptFile(file);
    });
    receiptSheet.addEventListener("click", (e) => {
      const t = e.target.closest("[data-cam-rcpt-camera],[data-cam-rcpt-close],[data-cam-rcpt-save],[data-cam-rcpt-retake]");
      if (!t) return;
      if (t.hasAttribute("data-cam-rcpt-camera") || t.hasAttribute("data-cam-rcpt-retake")) {
        receiptCamera.click();
        return;
      }
      if (t.hasAttribute("data-cam-rcpt-save")) {
        void saveReceipt();
        return;
      }
      if (t.hasAttribute("data-cam-rcpt-close")) closeReceiptSheet();
    });
  }

  function paintReceiptSheet() {
    ensureReceiptUi();
    const body = receiptSheet.querySelector(".cam-up__body");
    const st = receiptState || { kind: "idle" };
    if (st.kind === "idle") {
      body.innerHTML = `<h2 id="camRcptTitle">Scanner Recibo</h2>
        <p>Gasolina, material ou ferramenta — a foto vai para o reembolso do seu dia.</p>
        <div class="cam-up__go">
          <button type="button" data-cam-rcpt-camera>${UP_ICON.cam}Tirar foto do recibo</button>
        </div>
        <button type="button" class="cam-up__cancel" data-cam-rcpt-close>Cancelar</button>`;
      return;
    }
    const busy = st.kind === "saving";
    body.innerHTML = `<h2 id="camRcptTitle">Scanner Recibo</h2>
      <p>Confira o valor e envie.</p>
      ${st.preview ? `<div class="cam-rcpt-prev"><img src="${esc(st.preview)}" alt="Prévia do recibo" /></div>` : ""}
      <label class="cam-up__who"><span>Valor (USD)</span>
        <input id="camRcptAmt" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${esc(st.amount || "")}"${busy ? " disabled" : ""} />
      </label>
      <label class="cam-up__who"><span>Descrição <span style="font-weight:500;color:var(--cam-ink2)">opcional</span></span>
        <input id="camRcptDesc" type="text" maxlength="300" placeholder="Ex.: gasolina, material" value="${esc(st.desc || "")}"${busy ? " disabled" : ""} />
      </label>
      ${st.error ? `<div class="cam-up__err" role="alert"><b>${esc(st.error)}</b></div>` : ""}
      <div class="cam-up__go">
        <button type="button" data-cam-rcpt-save${busy ? " disabled" : ""}>${busy ? "Enviando…" : "Enviar recibo"}</button>
        <button type="button" class="is-sec" data-cam-rcpt-retake${busy ? " disabled" : ""}>Outra foto</button>
      </div>
      <button type="button" class="cam-up__cancel" data-cam-rcpt-close>${busy ? "Fechar" : "Cancelar"}</button>`;
  }

  function closeReceiptSheet() {
    if (receiptLayer) receiptLayer.close();
    receiptState = { kind: "idle" };
  }

  function openReceiptSheet() {
    ensureReceiptUi();
    receiptState = { kind: "idle" };
    paintReceiptSheet();
    receiptLayer.open();
    // Same tap opens the camera (must stay sync for the browser gesture).
    receiptCamera.click();
  }

  async function onReceiptFile(file) {
    try {
      const dataUrl = await compressUpload(file);
      receiptState = {
        kind: "form",
        dataUrl,
        preview: dataUrl,
        amount: receiptState.amount || "",
        desc: receiptState.desc || "",
        error: "",
      };
      paintReceiptSheet();
      receiptSheet.querySelector("#camRcptAmt")?.focus();
    } catch (e) {
      window.crmToast?.error?.(friendlyError(e, "o recibo", "ler"));
    }
  }

  async function saveReceipt() {
    if (!receiptState || receiptState.kind === "saving") return;
    const amtEl = receiptSheet.querySelector("#camRcptAmt");
    const descEl = receiptSheet.querySelector("#camRcptDesc");
    const amount = Number(amtEl && amtEl.value);
    const desc = String((descEl && descEl.value) || "").trim();
    if (!(amount > 0)) {
      receiptState = { ...receiptState, kind: "form", amount: amtEl?.value || "", desc, error: "Informe o valor do recibo." };
      paintReceiptSheet();
      amtEl?.focus();
      return;
    }
    if (!receiptState.dataUrl) {
      receiptState = { ...receiptState, kind: "idle" };
      paintReceiptSheet();
      return;
    }
    receiptState = { ...receiptState, kind: "saving", amount: String(amount), desc, error: "" };
    paintReceiptSheet();
    try {
      const up = await api("/api/campo/dia/recibos", {
        method: "POST",
        body: JSON.stringify({ data_url: receiptState.dataUrl }),
      });
      const stored = up.data || up;
      await api("/api/campo/dia/despesas", {
        method: "POST",
        body: JSON.stringify({
          amount: Math.round(amount * 100) / 100,
          description: desc || null,
          receipt_url: stored.url || null,
          receipt_key: stored.key || null,
        }),
      });
      closeReceiptSheet();
      window.OmUI?.haptic?.("success");
      window.crmToast?.success?.("Recibo enviado");
    } catch (e) {
      const msg =
        e.code === "NOT_LINKED"
          ? "Seu usuário ainda não está ligado à folha."
          : e.code === "NO_OPEN_DAY"
            ? "Comece o dia em Hoje para lançar o recibo."
            : friendlyError(e, "o recibo");
      receiptState = { ...receiptState, kind: "form", error: msg };
      paintReceiptSheet();
      window.OmUI?.haptic?.("error");
    }
  }

  // ---------------------------------------------------------------- sticker manager
  const STICKER_COLORS = ["#B4561A", "#1D6FB8", "#2F7D4F", "#7A4BC2", "#B42318", "#8A6A00", "#0F766E", "#475467"];
  let stkSheet = null;
  let stkLayer = null;
  let stkNewColor = STICKER_COLORS[1];
  let stkStatus = "";

  /** Create, rename, recolour and archive stickers (managers). Every change saves at once. */
  function openStickerManager() {
    if (!canManage) return;
    if (!stkSheet) {
      stkSheet = sheetShell("cam-stkm", "camStkTitle");
      stkSheet.querySelector(".cam-up__card").classList.add("cam-stkm__card");
      stkLayer = camSheet(stkSheet, { initialFocus: () => stkSheet.querySelector("#camStkNew") });
      stkSheet.addEventListener("click", onStickerSheetClick);
      stkSheet.addEventListener("change", onStickerSheetChange);
      stkSheet.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.id === "camStkNew") {
          e.preventDefault();
          createSticker();
        }
      });
    }
    stkStatus = "";
    stkColorFor = null;
    paintStickerManager();
    stkLayer.open();
  }
  function closeStickerManager() {
    if (stkLayer) stkLayer.close();
  }
  /** Which row shows its colour choices ("new" for the new-sticker row), and whether archived ones are open. */
  let stkColorFor = null;
  let stkShowArchived = false;
  function swatches(cur, attr) {
    return STICKER_COLORS.map((c) => `<button type="button" class="cam-stkm__sw${c === cur ? " is-on" : ""}" ${attr}="${c}" aria-pressed="${c === cur}" aria-label="Cor ${c}" style="--stk:${c}"></button>`).join("");
  }
  /** One compact row per sticker: colour dot (opens the colours for that row only), name, archive. */
  function paintStickerManager() {
    const active = stickers.filter((x) => !x.archived);
    const archived = stickers.filter((x) => x.archived);
    const keepNew = stkSheet.querySelector("#camStkNew")?.value || "";
    const row = (x) => `<li class="cam-stkm__row${x.archived ? " is-arch" : ""}${stkColorFor === x.id ? " is-open" : ""}">
        <button type="button" class="cam-stkm__dot" data-stk-pick="${esc(x.id)}" aria-expanded="${stkColorFor === x.id}" aria-label="Cor de ${esc(x.name)}" style="--stk:${esc(x.color)}"${x.archived ? " disabled" : ""}></button>
        <input type="text" class="cam-stkm__name" value="${esc(x.name)}" maxlength="32" aria-label="Nome da etiqueta" data-stk-name="${esc(x.id)}"${x.archived ? " disabled" : ""} />
        ${x.system ? `<span class="cam-stkm__tag" title="Aplicado sozinho nas fotos de samples">automático</span>` : ""}
        <button type="button" class="cam-stkm__arch" data-stk-arch="${esc(x.id)}" data-arch="${x.archived ? "0" : "1"}" aria-label="${x.archived ? "Restaurar" : "Arquivar"} ${esc(x.name)}" title="${x.archived ? "Restaurar" : "Arquivar"}">${x.archived ? SVG.restore : SVG.archive}</button>
        ${stkColorFor === x.id ? `<div class="cam-stkm__sws" role="group" aria-label="Cor de ${esc(x.name)}">${swatches(x.color, `data-stk-color-for="${esc(x.id)}" data-stk-color`)}</div>` : ""}
      </li>`;
    stkSheet.querySelector(".cam-up__body").innerHTML = `
      <div class="cam-stkm__head"><h2 id="camStkTitle">Etiquetas</h2><button type="button" class="cam-stkm__x" data-stk-close aria-label="Fechar">${SVG.x}</button></div>
      <p class="cam-stkm__lead">Etiquetas para organizar as fotos. Uma foto pode ter várias.</p>
      <div class="cam-stkm__new${stkColorFor === "new" ? " is-open" : ""}">
        <button type="button" class="cam-stkm__dot" data-stk-pick="new" aria-expanded="${stkColorFor === "new"}" aria-label="Cor da nova etiqueta" style="--stk:${stkNewColor}"></button>
        <input type="text" id="camStkNew" maxlength="32" placeholder="Nova etiqueta, ex.: Rodapé" aria-label="Nome da nova etiqueta" value="${esc(keepNew)}" />
        <button type="button" class="cam-stkm__add" data-stk-create>Criar</button>
        ${stkColorFor === "new" ? `<div class="cam-stkm__sws" role="group" aria-label="Cor da nova etiqueta">${swatches(stkNewColor, "data-stk-newcolor")}</div>` : ""}
      </div>
      <div class="cam-up__status${/não|erro|já existe|escreva/i.test(stkStatus) ? " is-err" : ""}" role="status">${esc(stkStatus)}</div>
      <ul class="cam-stkm__list" data-no-i18n>${active.map(row).join("") || '<li class="cam-empty">Nenhuma etiqueta ainda. Crie a primeira acima.</li>'}</ul>
      ${archived.length
        ? `<button type="button" class="cam-stkm__more" data-stk-archived aria-expanded="${stkShowArchived}">${stkShowArchived ? "Esconder" : "Ver"} arquivadas <em>${archived.length}</em></button>${stkShowArchived ? `<ul class="cam-stkm__list" data-no-i18n>${archived.map(row).join("")}</ul>` : ""}`
        : ""}`;
  }
  async function saveSticker(id, changes, msg) {
    try {
      const r = await api(`/api/job-media/stickers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) });
      stickers = stickers.map((x) => (x.id === id ? r.data : x));
      stkStatus = msg || "Salvo";
    } catch (e) {
      stkStatus = e.message || "Não foi possível salvar";
    }
    afterStickerChange();
  }
  async function createSticker() {
    const input = stkSheet.querySelector("#camStkNew");
    const name = (input?.value || "").trim();
    if (!name) {
      stkStatus = "Escreva um nome para a etiqueta.";
      paintStickerManager();
      stkSheet.querySelector("#camStkNew")?.focus();
      return;
    }
    try {
      const r = await api("/api/job-media/stickers", { method: "POST", body: JSON.stringify({ name, color: stkNewColor }) });
      stickers = stickers.concat(r.data);
      stkStatus = `“${r.data.name}” criada`;
      if (input) input.value = "";
    } catch (e) {
      stkStatus = e.message || "Não foi possível criar";
    }
    afterStickerChange();
    stkSheet.querySelector("#camStkNew")?.focus();
  }
  function afterStickerChange() {
    paintStickerManager();
    window.CamViewer?.setStickers?.(stickers);
    renderRight();
  }
  function onStickerSheetClick(e) {
    if (e.target.closest("[data-stk-close]")) return closeStickerManager();
    const pick = e.target.closest("[data-stk-pick]");
    if (pick) {
      const id = pick.getAttribute("data-stk-pick");
      stkColorFor = stkColorFor === id ? null : id;
      paintStickerManager();
      stkSheet.querySelector(`[data-stk-pick="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest("[data-stk-archived]")) {
      stkShowArchived = !stkShowArchived;
      return paintStickerManager();
    }
    const nc = e.target.closest("[data-stk-newcolor]");
    if (nc) {
      stkNewColor = nc.getAttribute("data-stk-newcolor");
      stkColorFor = null;
      paintStickerManager();
      stkSheet.querySelector("#camStkNew")?.focus({ preventScroll: true }); // Enter still creates after picking a colour
      return;
    }
    if (e.target.closest("[data-stk-create]")) return createSticker();
    const col = e.target.closest("[data-stk-color]");
    if (col) {
      stkColorFor = null;
      return saveSticker(col.getAttribute("data-stk-color-for"), { color: col.getAttribute("data-stk-color") }, "Cor atualizada");
    }
    const ar = e.target.closest("[data-stk-arch]");
    if (ar) {
      const archive = ar.getAttribute("data-arch") === "1";
      const x = stickerById(ar.getAttribute("data-stk-arch"));
      saveSticker(x.id, { archived: archive }, archive ? `“${x.name}” arquivada. As fotos que já têm continuam com ela.` : `“${x.name}” restaurada`);
    }
  }
  function onStickerSheetChange(e) {
    const id = e.target.getAttribute && e.target.getAttribute("data-stk-name");
    if (!id) return;
    const name = e.target.value.trim();
    const x = stickerById(id);
    if (!x || !name || name === x.name) {
      e.target.value = x ? x.name : "";
      return;
    }
    saveSticker(id, { name }, "Nome atualizado");
  }

  /** JPEG, longest side 1600px: what every ObraCam upload sends (the board and the ObraCam app alike). */
  function compressUpload(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível ler esta imagem. Use JPG ou PNG."));
      };
      img.src = url;
    });
  }

  function uploadGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      const timer = setTimeout(() => resolve(null), 1500);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(timer);
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 1500, maximumAge: 60000 },
      );
    });
  }

  /**
   * The one upload path (window.__camApp.uploadPhotos): EXIF date/GPS/camera read before compression, JPEG
   * compression, device GPS only when the photo has none, then one POST per file, in order.
   * Resolves { sent: [rows], error, remaining: [files not sent] }; it stops at the first failure.
   */
  async function uploadPhotos(jobId, files, opts) {
    const o = opts || {};
    const list = Array.from(files || []);
    const sent = [];
    let devicePos;
    const deviceGps = () => (devicePos !== undefined ? Promise.resolve(devicePos) : uploadGps().then((p) => (devicePos = p)));
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      if (typeof o.onProgress === "function") o.onProgress(i, list.length);
      try {
        const shot = window.PhotoExif
          ? await window.PhotoExif.uploadMeta(file, { live: !!o.live, deviceGps })
          : { taken_at_device: new Date().toISOString(), taken_at_source: "upload" };
        const body = {
          data_url: await compressUpload(file),
          stage: null,
          ...shot,
          taken_by_id: o.takenBy || null,
          sticker_ids: (o.stickerIds || []).slice(),
          client_upload_id: file.__camUploadId || (file.__camUploadId = window.crypto?.randomUUID ? crypto.randomUUID() : `cam-${Date.now()}-${i}`),
          device_label: window.__OM_FOCUS_APP ? "ObraCam app" : "ObraCam",
          is_public: false,
        };
        const r = await api(`/api/work-orders/${encodeURIComponent(jobId)}/media`, { method: "POST", body: JSON.stringify(body) });
        sent.push(r.data || null);
      } catch (error) {
        return { sent, error, remaining: list.slice(i) };
      }
    }
    if (typeof o.onProgress === "function") o.onProgress(list.length, list.length);
    return { sent, error: null, remaining: [] };
  }

  /** New photos go into the open job, its card and the recent feed without reloading the whole board. */
  async function insertUploaded(jobId, rows) {
    const id = String(jobId);
    const ids = new Set(rows.filter(Boolean).map((r) => String(r.id)));
    try {
      const m = await api(`/api/work-orders/${encodeURIComponent(jobId)}/media`);
      mediaCache[jobId] = (m.data || []).filter((p) => (p.type || "photo") === "photo" && p.url);
      metaCache[jobId] = m.meta || {};
    } catch (_) {
      // could not read the job back: the old way, a full refresh
      delete mediaCache[jobId];
      await load();
      if (mode !== "photos") select(jobId, false);
      return;
    }
    const j = jobs.find((x) => String(x.id) === id);
    const fresh = mediaCache[jobId].filter((p) => ids.has(String(p.id))).sort(byTaken);
    if (j) {
      j.photo_count = mediaCache[jobId].length;
      j.photos = fresh.concat((j.photos || []).filter((x) => !ids.has(String(x.id))));
      const newest = mediaCache[jobId].slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (newest) j.last_photo = newest;
      j.stale = false;
    }
    feed = fresh.map((p) => ({ ...p, job_id: j ? j.id : jobId, job_number: j ? j.number : null, job_title: j ? j.title : "" })).concat(feed.filter((x) => !ids.has(String(x.id))));
    renderList();
    if (mode === "photos") renderFeed();
    else if (String(selId) === id) renderJob();
    else select(jobId, false);
  }

  async function sendUpload(files) {
    const list = Array.from(files || []);
    if (!list.length || !uploadTarget) return;
    const target = uploadTarget;
    const takenBy = uploadTakenBy && uploadTakenBy !== meId ? uploadTakenBy : null;
    uploadRetry = null;
    uploadState = { kind: "progress", i: 0, n: list.length };
    paintUploadSheet();
    const res = await uploadPhotos(target.id, list, {
      live: uploadFrom === "camera",
      takenBy,
      stickerIds: uploadStickers,
      onProgress: (i, n) => {
        if (uploadTarget === target && i < n) showProgress(i, n);
      },
    });
    const ok = res.sent.length;
    if (ok) insertUploaded(target.id, res.sent).catch(() => {});
    if (!res.error) {
      uploadState = { kind: "idle" };
      closeUploadSheet();
      window.OmUI?.haptic?.("success");
      window.crmToast?.success?.(ok === 1 ? "Foto enviada" : `${ok} fotos enviadas`);
      return;
    }
    uploadRetry = res.remaining;
    const left = res.remaining.length;
    uploadState = {
      kind: "error",
      title: ok ? `${ok} de ${list.length} enviada${ok === 1 ? "" : "s"}. ${left === 1 ? "Falta 1." : `Faltam ${left}.`}` : left === 1 ? "A foto não foi enviada." : `As ${left} fotos não foram enviadas.`,
      message: friendlyError(res.error, "a foto"),
    };
    window.OmUI?.haptic?.("error");
    if (uploadTarget === target) {
      if (uploadLayer.isOpen()) paintUploadSheet();
      else window.crmToast?.show?.(`${uploadState.title} ${uploadState.message}`, { type: "error", action: { label: "Tentar de novo", onClick: () => openUploadSheet(target.id) } });
    }
  }

  function bind() {
    $("camViews").addEventListener("click", (e) => {
      const b = e.target.closest("[data-view]");
      if (b) setView(b.getAttribute("data-view"));
    });
    $("camDetail").addEventListener("input", (e) => {
      if (e.target.id !== "camFeedQ") return;
      clearTimeout(e.target._t);
      e.target._t = setTimeout(() => {
        $("camQ").value = e.target.value;
        q = norm(e.target.value);
        renderList();
        if (pane === "photos") renderFeed();
      }, 160);
    });
    const relist = () => {
      savePref();
      renderList();
      if (isWide() && mode !== "photos" && !$("camRows").querySelector(`[data-cam-id="${CSS.escape(String(selId || ""))}"]`)) {
        selId = firstVisibleId();
        renderList();
        renderRight();
      }
    };
    $("cam").addEventListener("click", (e) => {
      if (e.target.closest("[data-cam-retry]")) {
        boot();
        return;
      }
      const f = e.target.closest("[data-filter]");
      if (!f) return;
      showAll = false;
      mode = "active";
      listPref.filter = f.getAttribute("data-filter");
      relist();
    });
    $("camFilt")?.addEventListener("change", (e) => {
      const v = e.target.value;
      showAll = false;
      if (v === "done") {
        mode = "done";
        listPref.filter = "all";
      } else {
        mode = "active";
        listPref.filter = v || "all";
      }
      relist();
    });
    document.querySelector(".cam-list")?.addEventListener("ol-all", () => {
      if (crewMode) return;
      window.CrmList?.openAll(document.querySelector(".cam-list"));
      showAll = true;
      mode = "active";
      listPref.filter = "all";
      savePref();
      relist();
    });
    $("camGroup")?.addEventListener("change", (e) => {
      listPref.group = e.target.value;
      relist();
    });
    $("camSort")?.addEventListener("change", (e) => {
      listPref.sort = e.target.value;
      relist();
    });
    $("camMode").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      showAll = false;
      mode = b.getAttribute("data-mode");
      stageFilter = "all";
      selId = null;
      renderList();
      if (isWide()) {
        selId = firstVisibleId();
        renderList();
        renderRight();
      }
    });
    $("camRows").addEventListener("click", (e) => {
      const del = e.target.closest("[data-cam-delete]");
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        void deleteJob(del.getAttribute("data-cam-delete"), del.getAttribute("data-cam-label"), del);
        return;
      }
      if (e.target.closest(".om-swipe__actions")) return;
      // Map opens externally — don't hijack into the split detail.
      if (e.target.closest("a[target='_blank'], .jmx-b--sq")) return;
      const a = e.target.closest("[data-cam-id]");
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const j = jobs.find((x) => String(x.id) === a.getAttribute("data-cam-id"));
      if (mode === "photos") mode = j && j.status === "completed" ? "done" : "active";
      select(a.getAttribute("data-cam-id"), true);
    });
    $("camQ").addEventListener("input", (e) => {
      clearTimeout(e.target._t);
      e.target._t = setTimeout(() => {
        q = norm(e.target.value);
        renderList();
        if (mode === "photos" && pane === "photos") renderFeed();
      }, 160);
    });
    $("camWeekPrev")?.addEventListener("click", () => shiftCrewWeek(-1));
    $("camWeekNext")?.addEventListener("click", () => shiftCrewWeek(1));
    $("camWeekStrip")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cam-ymd]");
      if (!btn || !crewMode) return;
      const ymd = btn.getAttribute("data-cam-ymd");
      if (!ymd || ymd === crewSelectedYmd) return;
      crewSelectedYmd = ymd;
      renderCrewWeek();
      void loadCrewAgenda();
    });
    $("camDetail").addEventListener("click", (e) => {
      if (e.target.closest("[data-cam-back]")) {
        e.preventDefault();
        back();
        return;
      }
      const up = e.target.closest("[data-cam-upload]");
      if (up) {
        e.preventDefault();
        openUploadSheet(up.getAttribute("data-cam-upload"));
        return;
      }
      if (e.target.closest("[data-note-filter]")) {
        noteFilter = !noteFilter;
        renderRight();
        return;
      }
      const sk = e.target.closest("[data-sticker]");
      if (sk) {
        const id = sk.getAttribute("data-sticker");
        stickerFilter = stickerFilter === id ? "" : id;
        renderRight();
        return;
      }
      if (e.target.closest("[data-stk-manage]")) {
        openStickerManager();
        return;
      }
      const pn = e.target.closest("[data-pane]");
      if (pn) {
        if (selecting) {
          selecting = false;
          picked.clear();
          document.body.classList.remove("cam-selecting");
          dropSelBar();
        }
        pane = pn.getAttribute("data-pane");
        renderRight();
        return;
      }
      const s = e.target.closest("[data-stage]");
      if (s) {
        stageFilter = s.getAttribute("data-stage");
        renderRight();
        return;
      }
      if (e.target.closest("[data-sel-start]")) {
        startSelecting();
        return;
      }
      const day = e.target.closest("[data-sel-day]");
      if (day) {
        const ids = day.getAttribute("data-sel-day").split(",");
        const all = day.getAttribute("data-all") === "1";
        ids.forEach((id) => (all ? picked.delete(id) : picked.add(id)));
        document.querySelectorAll("#camDetail [data-ph-id]").forEach((t) => {
          const on = picked.has(t.getAttribute("data-ph-id"));
          t.classList.toggle("is-pick", on);
          t.setAttribute("aria-pressed", String(on));
        });
        syncDayLinks();
        renderSelBar();
        return;
      }
      const ph = e.target.closest("[data-ph-i]");
      if (ph && longPressed) {
        longPressed = false;
        return;
      }
      if (ph && selecting) return togglePick(ph.getAttribute("data-ph-id"));
      if (ph) openViewer(shown, Number(ph.getAttribute("data-ph-i")) || 0, ph);
    });
    // Touch: holding a photo for half a second starts selecting with that photo picked.
    let pressTimer = null;
    let pressAt = null;
    let longPressed = false;
    $("camDetail").addEventListener("pointerdown", (e) => {
      const ph = e.target.closest("[data-ph-id]");
      if (!ph || e.pointerType === "mouse" || selecting) return;
      pressAt = { x: e.clientX, y: e.clientY };
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressed = true;
        startSelecting(ph.getAttribute("data-ph-id"));
        if (navigator.vibrate) navigator.vibrate(12);
      }, 480);
    });
    const cancelPress = () => clearTimeout(pressTimer);
    $("camDetail").addEventListener("pointerup", cancelPress);
    $("camDetail").addEventListener("pointercancel", cancelPress);
    $("camDetail").addEventListener("pointermove", (e) => {
      if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancelPress();
    });
    $("camDetail").addEventListener("contextmenu", (e) => {
      if (e.target.closest("[data-ph-id]")) e.preventDefault();
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#camSelBar")) onSelBarClick(e);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && selecting && !e.defaultPrevented && !document.querySelector(".cv:not([hidden]), .cam-up:not([hidden])")) stopSelecting();
    });
    document.addEventListener("click", (e) => {
      const rcpt = e.target.closest("[data-cam-receipt]");
      if (rcpt) {
        e.preventDefault();
        openReceiptSheet();
        return;
      }
      const up = e.target.closest(".cam-pbar [data-cam-upload], #camCrewActs [data-cam-upload]");
      if (!up) return;
      e.preventDefault();
      if (up.disabled || up.getAttribute("aria-disabled") === "true") {
        window.crmToast?.error?.("Escolha um job na agenda para tirar foto.");
        return;
      }
      openUploadSheet(up.getAttribute("data-cam-upload"));
    });
    window.addEventListener("resize", () => {
      if (isWide() && document.body.classList.contains("cam-detail-open")) {
        $("camSplit").classList.remove("is-detail");
        document.body.classList.remove("cam-detail-open");
        movePbar();
      }
    });
  }

  function boardJobFromWo(wo) {
    const builderName = wo.builder
      ? [wo.builder.first_name || wo.builder.firstName, wo.builder.last_name || wo.builder.lastName].filter(Boolean).join(" ").trim()
      : "";
    return {
      id: wo.id,
      number: wo.number,
      title: wo.title,
      status: wo.status,
      field_status: wo.field_status || null,
      sector: wo.sector || null,
      address: wo.address || null,
      client_ref: wo.client_ref || wo.customer?.client_code || wo.customer?.clientCode || null,
      client_name: wo.customer?.name || wo.builder?.company || builderName || wo.source_name || null,
      customer: wo.customer
        ? {
            name: wo.customer.name,
            company: wo.customer.company,
            nickname: wo.customer.nickname,
            client_code: wo.customer.client_code || wo.customer.clientCode || null,
          }
        : null,
      builder: wo.builder
        ? {
            company: wo.builder.company || null,
            name: builderName || wo.builder.name || null,
            nickname: wo.builder.nickname || null,
          }
        : null,
      source_name: wo.source_name || null,
      photo_count: 0,
      scheduled_start: wo.scheduled_start || null,
      sand_scheduled_start: wo.sand_scheduled_start || null,
      installation_done_at: wo.installation_done_at || null,
      sand_done_at: wo.sand_done_at || null,
      billing: wo.billing || null,
      geo_lat: null,
      geo_lng: null,
      last_photo: null,
      photos: [],
      stale: true,
      detail_url: `job-detail.html?id=${wo.id}`,
    };
  }

  async function openNewJobTicket(wo) {
    if (!wo?.id) return;
    mode = "active";
    stageFilter = "all";
    const ix = jobs.findIndex((j) => String(j.id) === String(wo.id));
    const row = boardJobFromWo(wo);
    if (ix >= 0) jobs[ix] = { ...jobs[ix], ...row, photos: jobs[ix].photos || [], photo_count: jobs[ix].photo_count || 0 };
    else jobs.unshift(row);
    mediaCache[wo.id] = mediaCache[wo.id] || [];
    select(wo.id, true);
  }

  bind();
  // The ObraCam app (obracam-app.js?v=20261105-apps3) refreshes the job after sending photos.
  window.__camApp = {
    mode: () => mode,
    manageStickers: () => openStickerManager(),
    setView,
    openUpload: openUploadSheet,
    /** Shared upload path for the ObraCam app: (jobId, files, { live, takenBy, stickerIds, onProgress }) → { sent, error, remaining }. */
    uploadPhotos,
    friendlyError,
    reload(id) {
      if (id) delete mediaCache[id];
      return load().then(() => {
        if (id) select(id, false);
      });
    },
  };
  $("camAddJob")?.addEventListener("click", () => {
    if (!canManage || !window.__crmJobModal?.openCreate) return;
    window.__crmJobModal.openCreate({ allDay: true }).catch((e) => window.crmToast?.error?.(e.message || "Não foi possível abrir o job"));
  });
  fetch("/api/auth/session", { credentials: "include" })
    .then((r) => r.json())
    .then((s) => {
      const perms = s?.user?.permissions || [];
      const role = String(s?.user?.role || "").toLowerCase();
      const field =
        (window.__crmFieldGate && window.__crmFieldGate.isFieldRole(role)) ||
        role === "installer" ||
        role === "crew_lead" ||
        role === "subcontractor";
      crewMode = field;
      // Office-only: create/delete jobs, stickers admin, portfolio. Field never gets these.
      canManage = !field && (role === "admin" || perms.includes("work_orders.manage"));
      canEditMedia = canManage || field || perms.includes("work_orders.view");
      meId = s?.user?.id || "";
      if (crewMode) {
        document.body.classList.add("cam-crew", "om-field-nav");
        FILTERS = filtersForMode();
        listPref.filter = "all";
        listPref.sort = "schedule";
        listPref.group = "status";
        q = "";
        if ($("camQ")) {
          $("camQ").value = "";
          $("camQ").placeholder = "Buscar obra ou endereço";
        }
        if (mode === "photos") mode = "active";
        savePref();
        const modeHost = $("camMode");
        if (modeHost) modeHost.setAttribute("aria-label", "Em produção ou últimos trabalhos");
        void loadCrewAgenda();
      }
      const add = $("camAddJob");
      if (add) add.hidden = !canManage;
      // Session arrives after the first paint — rebuild rows so swipe-delete appears.
      renderList();
      if (selId) renderJob();
      if (!crewMode && window.__crmJobModal?.onSaved) {
        window.__crmJobModal.onSaved((data, meta) => {
          if (data && meta?.created) openNewJobTicket(data);
          else if (data) load().then(() => select(data.id, true)).catch(() => {});
        });
      }
    })
    .catch(() => {});
  // Stickers may arrive after the first paint; repaint so tiles and filters show them.
  loadStickers().then(() => {
    if (!jobs.length) return;
    if (mode === "photos") renderFeed();
    else if (selId) renderJob();
  });
  boot();
})();
