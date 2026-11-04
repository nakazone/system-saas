/**
 * ObraCam (Opção B): lista de jobs ao lado (quem precisa de foto primeiro) e as fotos do job escolhido
 * em Antes / Durante / Depois com o mapa de onde foram tiradas. "Todas as fotos" mostra as recentes por dia.
 * Foto abre no visualizador (cam-viewer.js).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const STAGES = [["before", "Antes"], ["during", "Durante"], ["after", "Depois"], ["none", "Geral"]];
  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const WDL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const FEED_DAYS = 7;
  const GEO_CACHE_KEY = "om_jmb_geocode_v1";
  const SVG = {
    cam: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="11" height="11" aria-label="com marcações"><path d="M4 20l4-1L19 8a2.1 2.1 0 00-3-3L5 16l-1 4z"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="11" height="11" aria-label="com nota"><path d="M5 4h14v12l-4 4H5z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
  };

  let jobs = [];
  let feed = [];
  let mode = "active";
  let q = "";
  let selId = null;
  let stageFilter = "all";
  /** Sticker (photo label) the job grid or feed is narrowed to, "" for all. */
  let stickerFilter = "";
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
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
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
  /** Same stage language as the Jobs list (Rascunho / Sem data / Lixa / Faturado…). */
  function jobStageLabel(j) {
    if (window.JobsInfo?.stageLabel) return window.JobsInfo.stageLabel(j);
    if (window.JobsInfo?.listWhen) {
      const w = window.JobsInfo.listWhen(j);
      if (w && w.status) return w.status;
    }
    return statusLabel(j.status);
  }
  function isActive(j) {
    return j.status === "scheduled" || j.status === "in_progress" || j.status === "draft";
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

  /** Same identity line as Jobs: Nickname/Builder - Client ID. */
  function listWho(j) {
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

  function rowHtml(j) {
    const last = j.last_photo;
    const th = last ? `<span class="cam-row__th ol-lead" style="background-image:url('${esc(last.url)}')"></span>` : `<span class="cam-row__th ol-lead is-empty">${SVG.cam}</span>`;
    const n = j.photo_count != null ? j.photo_count : (j.photos || []).length;
    const who = listWho(j);
    const head = who && who !== "Sem cliente" ? who : j.title || "Job";
    const href = `job-detail.html?id=${encodeURIComponent(j.id)}#fotos`;
    const addr = j.address
      ? `<span class="ol-m cam-row__addr" title="${esc(j.address)}">${SVG.pin}<span>${esc(j.address)}</span></span>`
      : `<span class="ol-m"><span>Sem endereço</span></span>`;
    const stale = needsPhoto(j);
    const lt = window.JobsInfo?.late ? window.JobsInfo.late(j) : null;
    const tone = window.JobsInfo?.stageTone ? window.JobsInfo.stageTone(j) : "wait";
    const note = last ? `última foto ${ago(last.created_at)}` : "nenhuma foto";
    const body = `<a class="cam-row ol-row${String(j.id) === String(selId) && mode !== "photos" ? " is-on" : ""}" href="${href}" data-cam-id="${esc(j.id)}">
      ${th}
      <b class="ol-t" title="${esc(head)}">${esc(head)}</b>
      <span class="ol-v${n ? "" : " is-mu"}">${n ? `${n} foto${n === 1 ? "" : "s"}` : "0 fotos"}</span>
      ${addr}
      <span class="ol-f"><span class="ol-st is-${tone}">${esc(lt ? lt.short : jobStageLabel(j))}</span><span class="ol-note${stale ? " is-hot" : ""}">${esc(note)}</span></span>
    </a>`;
    if (useSwipeDelete() && j.status !== "canceled") {
      return `<article class="om-swipe cam-swipe" data-cam-swipe="${esc(j.id)}">
        <div class="om-swipe__actions" aria-hidden="true">
          <a class="om-swipe__act--edit" href="jobs.html?id=${encodeURIComponent(j.id)}">Abrir</a>
          <button type="button" class="om-swipe__act--delete" data-cam-delete="${esc(j.id)}" data-cam-label="${esc(head)}">Excluir</button>
        </div>
        <div class="om-swipe__body">${body}</div>
      </article>`;
    }
    return body;
  }

  async function deleteJob(id, label, btn) {
    if (!id || !canManage) return;
    if (!confirm(`Excluir o job “${label || id}”?\n\nO job será cancelado e sai da lista ativa.`)) return;
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
  /** Quick filters: what the office checks every morning. */
  const FILTERS = [
    ["all", "Todos", () => true],
    ["need", "Precisa de foto", (j) => needsPhoto(j)],
    ["today", "Hoje", (j) => isToday(j.scheduled_start) || isToday(j.sand_scheduled_start)],
    ["nogps", "Sem GPS", (j) => (j.photos || []).some((p) => !hasGps(p))],
    ["far", "Longe", (j) => (j.photos || []).some((p) => p.far_from_job)],
  ];
  /** The client a job is grouped under: the builder or customer, without the job reference. */
  function clientKey(j) {
    return String(j.builder?.nickname || j.builder?.company || j.customer?.nickname || j.customer?.company || j.customer?.name || j.client_name || j.source_name || "").trim() || "Sem cliente";
  }
  function lastPhotoTime(j) {
    return j.last_photo ? new Date(j.last_photo.created_at).getTime() : 0;
  }
  function cmpJobs(a, b) {
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
    const hit = jobs.filter(jobHit);
    return mode === "done" ? hit.filter((j) => j.status === "completed") : hit.filter(isActive);
  }

  function groups() {
    const f = FILTERS.find(([k]) => k === listPref.filter) || FILTERS[0];
    const rows = baseJobs().filter(f[2]).sort(cmpJobs);
    if (listPref.group === "client") {
      const by = new Map();
      rows.forEach((j) => {
        const k = clientKey(j);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(j);
      });
      return [...by.entries()].sort(([a], [b]) => (a === "Sem cliente") - (b === "Sem cliente") || a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    }
    if (mode === "done") return [["Concluídos", rows]];
    return [
      ["Precisa de foto", rows.filter((j) => needsPhoto(j) && j.scheduled_start)],
      ["Em dia", rows.filter((j) => !needsPhoto(j))],
      ["Sem data", rows.filter((j) => needsPhoto(j) && !j.scheduled_start)],
    ];
  }

  function renderFilters() {
    const base = baseJobs();
    const host = $("camFilters");
    if (!host) return;
    host.innerHTML = FILTERS.map(([k, l, test]) => {
      const n = base.filter(test).length;
      const on = listPref.filter === k;
      if (!n && !on && k !== "all") return "";
      return `<button type="button" class="cam-fchip${on ? " is-on" : ""}${k === "need" && n ? " is-hot" : ""}" data-filter="${k}" aria-pressed="${on}">${l} <em>${n}</em></button>`;
    }).join("");
    if ($("camGroup")) $("camGroup").value = listPref.group;
    if ($("camSort")) $("camSort").value = listPref.sort;
  }

  function renderList() {
    const active = jobs.filter(isActive);
    const done = jobs.filter((j) => j.status === "completed");
    $("camJobsN").textContent = String(jobs.length);
    $("camPhotosN").textContent = String(feed.length);
    document.querySelectorAll("#camViews [data-view]").forEach((b) => {
      const on = (b.getAttribute("data-view") === "photos") === (mode === "photos");
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    renderFilters();
    document.querySelectorAll("#camMode [data-mode]").forEach((b) => {
      const m = b.getAttribute("data-mode");
      const listMode = mode === "photos" ? "active" : mode;
      b.classList.toggle("is-on", m === listMode);
      b.setAttribute("aria-pressed", String(m === listMode));
      b.innerHTML = m === "active" ? `Ativos <em>${active.length}</em>` : `Concluídos <em>${done.length}</em>`;
    });
    const html = groups()
      .filter(([, rows]) => rows.length)
      .map(([label, rows]) => `<p class="cam-grp ol-grp"><span>${label}</span><em>${rows.length}</em></p>${rows.map(rowHtml).join("")}`)
      .join("");
    $("camRows").innerHTML =
      html ||
      `<p class="cam-empty">${listPref.filter !== "all" ? `Nenhum job em “${esc((FILTERS.find(([k]) => k === listPref.filter) || [])[1] || "")}”. <button type="button" class="cam-link" data-filter="all">Ver todos</button>` : q ? "Nenhum job com essa busca." : mode === "done" ? "Nenhum job concluído." : "Nenhum job ativo."}</p>`;
    if (window.OmGestures) window.OmGestures.bindSwipeRow?.($("camRows"));
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
    [feed, ...Object.values(mediaCache), ...jobs.map((x) => x.photos || [])].forEach((arr) =>
      arr.forEach((x) => {
        if (String(x.id) === String(photo.id)) Object.assign(x, patch);
      }),
    );
    if (mode === "photos") renderFeed();
    else renderJob();
    return patch;
  }

  function openViewer(list, index) {
    if (!window.CamViewer || !list.length) return;
    if (canManage && !people) loadPeople().then((pp) => window.CamViewer.setPeople?.(pp));
    window.CamViewer.open({
      canEdit: canManage,
      people,
      onNote: (photo, text) => editPhoto(photo, { caption: text }),
      onAnnotate: (photo, doc) => editPhoto(photo, { annotations: doc }),
      onTakenBy: (photo, id) => editPhoto(photo, { taken_by_id: id }),
      stickers,
      onStickers: canManage ? (photo, ids) => editPhoto(photo, { sticker_ids: ids }) : null,
      onManageStickers: canManage ? () => openStickerManager() : null,
      photos: list,
      index,
      canPortfolio: canManage,
      canDelete: canManage,
      canStage: canManage,
      onStage: async (photo, next) => {
        const r = await api(`/api/work-orders/${encodeURIComponent(photo.job.id)}/media/${encodeURIComponent(photo.id)}/stage`, { method: "PATCH", body: JSON.stringify({ stage: next }) });
        const stage = r.data ? r.data.stage || null : next;
        [feed, ...Object.values(mediaCache), ...jobs.map((x) => x.photos || [])].forEach((arr) =>
          arr.forEach((x) => {
            if (String(x.id) === String(photo.id)) x.stage = stage;
          }),
        );
        window.crmToast?.success?.(`Etapa: ${STAGE[stage] || "Geral"}`);
        // Repaint behind the viewer so the stage counts and tiles match when it closes.
        if (mode === "photos") renderFeed();
        else renderJob();
        return { stage };
      },
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
    return (who && who !== "Sem cliente" ? who : p.job_title) || (p.job_number != null ? `Job #${p.job_number}` : "Job");
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

  function photoTile(p, i, opts) {
    const st = STAGE[p.stage] || "Geral";
    const tags = (p.sticker_ids || []).map(stickerById).filter(Boolean).map((x) => x.name);
    const what = `${st}${tags.length ? ` · ${tags.join(", ")}` : ""}${opts && opts.job ? ` · ${feedJobName(p)}` : ""}`;
    return `<button type="button" class="cam-ph${opts && opts.job ? " cam-ph--job" : ""}" data-ph-i="${i}" aria-label="Ver foto: ${esc(what)}" style="background-image:url('${esc(p.thumb_url || p.url)}')">
      ${opts && opts.stage ? `<span class="cam-ph__st">${esc(st)}${marks(p)}</span>` : marks(p) ? `<span class="cam-ph__st cam-ph__st--ic">${marks(p)}</span>` : ""}
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
    if (s === "Em campo" || s === "Lixa") return "dk";
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
    return `<a class="cam-back" href="#" data-cam-back>${SVG.back}ObraCam</a>
      <div class="cam-dh">
        <div class="cam-dh__t">
          <h2><a href="job-detail.html?id=${encodeURIComponent(j.id)}" title="${esc(name)}">${esc(name)}</a></h2>
          ${sub ? `<p class="cam-dsub" title="${esc(sub)}">${esc(sub)}</p>` : ""}
          <div class="cam-dmeta">
            <span class="cam-pill${st ? ` cam-pill--${st}` : ""}">${esc(stage)}</span>
            <span class="cam-pill${needsPhoto(j) ? " cam-pill--hot" : ""}">${esc(lastTxt)}</span>
            ${facts.map((x) => `<span class="cam-dfact">${x}</span>`).join("")}
            ${addr}
          </div>
        </div>
        <div class="cam-dh__acts">
          <button type="button" class="cam-btn" data-cam-upload="${esc(j.id)}">${SVG.cam}Adicionar fotos</button>
          <a class="cam-btn cam-btn--pri" href="job-detail.html?id=${encodeURIComponent(j.id)}">Abrir job</a>
        </div>
      </div>`;
  }

  function pbarHtml(j) {
    return `<div class="cam-pbar" id="camPbar"><a class="cam-btn" href="job-detail.html?id=${encodeURIComponent(j.id)}">Abrir job</a><button type="button" class="cam-btn cam-btn--pri" data-cam-upload="${esc(j.id)}">${SVG.cam}Tirar foto</button></div>`;
  }
  function movePbar() {
    document.querySelectorAll("body > .cam-pbar").forEach((x) => x.remove());
    const bar = $("camPbar");
    if (!bar) return;
    if (document.body.classList.contains("cam-detail-open")) document.body.appendChild(bar);
    else bar.remove();
  }

  async function renderJob() {
    const host = $("camDetail");
    const j = jobs.find((x) => String(x.id) === String(selId));
    if (!j) {
      host.innerHTML = `<div class="cam-blank">Escolha um job na lista.</div>`;
      return;
    }
    if (!mediaCache[j.id]) {
      host.innerHTML = headHtml(j, null) + `<div class="cam-box"><p class="cam-empty">Carregando fotos…</p></div>`;
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
    const counts = { before: 0, during: 0, after: 0, none: 0 };
    list.forEach((p) => (counts[STAGE[p.stage] ? p.stage : "none"] += 1));
    shown = list.map((p) => toViewer(j, p));
    let body;
    if (!list.length) {
      body = `<div class="cam-box cam-none"><span class="cam-none__ic">${SVG.cam}</span><b>Nenhuma foto ainda</b><p>A equipe tira as fotos pelo Campo (ticket do job). Você também pode adicionar aqui.</p><button type="button" class="cam-btn" data-cam-upload="${esc(j.id)}">Adicionar fotos</button></div>`;
    } else {
      // One grid for every width, filtered by stage: Antes, Durante and Depois always show (zero is information); Geral only when it has photos.
      const chips = [["all", "Todas", list.length], ...STAGES.filter(([k]) => k !== "none" || counts.none).map(([k, l]) => [k, l, counts[k]])];
      if (!chips.some(([k]) => k === stageFilter)) stageFilter = "all";
      if (stickerFilter && !list.some((p) => (p.sticker_ids || []).includes(stickerFilter))) stickerFilter = "";
      const sel = list
        .map((p, i) => [p, i])
        .filter(([p]) => stageFilter === "all" || (stageFilter === "none" ? !STAGE[p.stage] : p.stage === stageFilter))
        .filter(([p]) => !stickerFilter || (p.sticker_ids || []).includes(stickerFilter));
      const label = stickerFilter ? `${(chips.find(([k]) => k === stageFilter) || [])[1] || ""} com “${(stickerById(stickerFilter) || {}).name || ""}”` : (chips.find(([k]) => k === stageFilter) || [])[1] || "";
      const far = list.filter((p) => p.far_from_job).length;
      const content =
        pane === "map"
          ? mapPaneHtml()
          : sel.length
            ? `<div class="cam-pgrid">${sel.map(([p, i]) => photoTile(p, i, { stage: stageFilter === "all" })).join("")}</div>`
            : `<p class="cam-col__none">Nenhuma foto ${stickerFilter ? `em ${esc(label)}` : `de ${esc(label.toLowerCase())}`} ainda.</p>`;
      body = `<div class="cam-box cam-box--photos">
          <div class="cam-chips cam-chips--bar cam-chips--stick">${paneSwitchHtml("Local", far)}${pane === "photos" ? chips.map(([k, l, c]) => chipHtml(k, l, c)).join("") + stickerChipsHtml(list) : ""}</div>
          ${content}
        </div>`;
    }
    host.innerHTML = headHtml(j, list) + body + (isPhone() ? pbarHtml(j) : "");
    movePbar();
    if (list.length && pane === "map") renderJobMap(j, list).catch(() => {});
  }

  /** Sticker filter chips, only for stickers that photos here actually carry, plus "Stickers" to manage them. */
  function stickerChipsHtml(list) {
    const counts = {};
    list.forEach((p) => (p.sticker_ids || []).forEach((id) => (counts[id] = (counts[id] || 0) + 1)));
    const chips = stickers
      .filter((x) => counts[x.id])
      .map((x) => `<button type="button" class="cam-chip cam-chip--stk${stickerFilter === x.id ? " is-on" : ""}" data-no-i18n data-sticker="${esc(x.id)}" aria-pressed="${stickerFilter === x.id}" style="--stk:${esc(x.color)}"><i aria-hidden="true"></i>${esc(x.name)} <em>${counts[x.id]}</em></button>`)
      .join("");
    const manage = canManage ? `<button type="button" class="cam-chip cam-chip--ghost" data-stk-manage>${SVG.tag}Stickers</button>` : "";
    return chips || manage ? `<span class="cam-chips__sep" aria-hidden="true"></span>${chips}${manage}` : "";
  }

  function chipHtml(k, l, c) {
    return `<button type="button" class="cam-chip${k === stageFilter ? " is-on" : ""}" data-stage="${k}" aria-pressed="${k === stageFilter}">${l} <em>${c}</em></button>`;
  }
  /** Fotos | Local (or Mapa): the map is a place you open, not a column that is always half off screen. */
  function paneSwitchHtml(mapLabel, far) {
    const btn = (id, label) => `<button type="button" class="${pane === id ? "is-on" : ""}" data-pane="${id}" aria-pressed="${pane === id}">${label}</button>`;
    return `<span class="cam-pane" role="group" aria-label="Mostrar">${btn("photos", "Fotos")}${btn("map", `${SVG.pin}${mapLabel}${far ? ` <em class="is-far">${far} longe</em>` : ""}`)}</span>`;
  }
  function mapPaneHtml() {
    return `<div class="cam-map cam-map--big" id="camMap"></div><p class="cam-meta" id="camMapNote"></p>`;
  }

  // ---------------------------------------------------------------- todas as fotos
  function renderFeed() {
    const host = $("camDetail");
    // The shell (title, search, map) is built once; typing or picking a stage only repaints the photos, so the search keeps focus and the map is not redrawn.
    if (!host.querySelector("#camFeedBody")) {
      host.innerHTML = `<div class="cam-dh cam-dh--feed"><div class="cam-dh__t"><h2>Todas as fotos</h2><p class="cam-dsub">${feed.length} mais recentes de todos os jobs</p></div>
          <label class="cam-search cam-search--feed"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="search" id="camFeedQ" placeholder="Buscar job, etapa ou quem tirou" autocomplete="off" enterkeyhint="search" value="${esc($("camQ").value)}" /></label></div>
        <div class="cam-box cam-box--feed" id="camFeedBody"></div>`;
      movePbar();
    }
    const hit = feed.filter((p) => {
      if (stageFilter !== "all" && (STAGE[p.stage] ? p.stage : "none") !== stageFilter) return false;
      if (stickerFilter && !(p.sticker_ids || []).includes(stickerFilter)) return false;
      if (!q) return true;
      const tags = (p.sticker_ids || []).map(stickerById).filter(Boolean).map((x) => x.name);
      return norm([p.job_number, p.job_title, feedJobName(p), STAGE[p.stage], p.caption, p.address, p.author_name, p.taken_by_name, p.camera_model, ...tags].filter(Boolean).join(" ")).includes(q);
    }).sort(byTaken);
    const counts = { all: feed.length, before: 0, during: 0, after: 0, none: 0 };
    feed.forEach((p) => (counts[STAGE[p.stage] ? p.stage : "none"] += 1));
    shown = hit.map((p) => toViewer({ id: p.job_id, number: p.job_number, title: p.job_title, client_name: (jobs.find((x) => x.id === p.job_id) || {}).client_name }, p));
    const days = [];
    hit.forEach((p, i) => {
      const k = dayKey(takenAt(p));
      let d = days.find((x) => x.k === k);
      if (!d) days.push((d = { k, label: dayLabel(takenAt(p)), items: [], jobs: new Set() }));
      d.items.push([p, i]);
      d.jobs.add(p.job_id);
    });
    const chips = [["all", "Todas"], ["before", "Antes"], ["during", "Durante"], ["after", "Depois"], ["none", "Geral"]]
      .filter(([k]) => k === "all" || counts[k])
      .map(([k, l]) => chipHtml(k, l, counts[k]))
      .join("");
    const grid = days.length
      ? days
          .map(
            (d) =>
              `<p class="cam-day">${esc(d.label)}<em>${d.items.length} foto${d.items.length === 1 ? "" : "s"} · ${d.jobs.size} job${d.jobs.size === 1 ? "" : "s"}</em></p><div class="cam-feedg">${d.items.map(([p, i]) => photoTile(p, i, { stage: true, job: true })).join("")}</div>`,
          )
          .join("")
      : `<p class="cam-empty">${q || stageFilter !== "all" || stickerFilter ? "Nenhuma foto com esse filtro." : "Ainda sem fotos."}</p>`;
    $("camFeedBody").innerHTML = `<div class="cam-chips cam-chips--bar cam-chips--stick">${paneSwitchHtml("Mapa", 0)}${pane === "photos" ? chips + stickerChipsHtml(feed) : ""}</div>${pane === "map" ? mapPaneHtml() : grid}`;
    if (pane === "map") renderAllMap().catch(() => {});
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

  function newMap() {
    const el = $("camMap");
    if (map) {
      try {
        map.remove();
      } catch (_) {}
      map = null;
    }
    if (!el) return null;
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
    if (!newMap()) return;
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
    if (!newMap()) return;
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
    selId = id;
    stageFilter = "all";
    stickerFilter = "";
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

  async function load() {
    const j = await api("/api/job-media/board?days=3");
    jobs = j.data?.jobs || [];
    feed = j.data?.feed || [];
    const id = new URLSearchParams(location.search).get("id");
    const pre = id && jobs.find((x) => String(x.id) === id);
    if (pre) {
      mode = isActive(pre) ? "active" : "done";
      select(pre.id, false);
      return;
    }
    renderList();
    if (isWide()) {
      selId = firstVisibleId();
      renderList();
      renderRight();
    }
  }

  // ---------------------------------------------------------------- upload with stage
  const UPLOAD_STAGES = [
    { id: "before", label: "Antes" },
    { id: "during", label: "Durante" },
    { id: "after", label: "Depois" },
    { id: "", label: "Geral" },
  ];
  let uploadTarget = null;
  let uploadStage = "during";
  let uploadSheet = null;
  let uploadCamera = null;
  let uploadLibrary = null;

  function ensureUploadUi() {
    if (uploadSheet) return;
    uploadSheet = document.createElement("div");
    uploadSheet.className = "cam-up";
    uploadSheet.hidden = true;
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
    document.body.append(uploadSheet, uploadCamera, uploadLibrary);
    uploadCamera.addEventListener("change", () => {
      void sendUpload(uploadCamera.files);
      uploadCamera.value = "";
    });
    uploadLibrary.addEventListener("change", () => {
      void sendUpload(uploadLibrary.files);
      uploadLibrary.value = "";
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !uploadSheet.hidden) closeUploadSheet();
    });
    uploadSheet.addEventListener("change", (e) => {
      if (e.target.id === "camUpWho") uploadTakenBy = e.target.value;
    });
    uploadSheet.addEventListener("click", (e) => {
      if (e.target === uploadSheet) {
        closeUploadSheet();
        return;
      }
      const t = e.target.closest("[data-cam-up-stage],[data-cam-up-camera],[data-cam-up-library],[data-cam-up-close],[data-cam-up-stk]");
      if (!t) return;
      if (t.hasAttribute("data-cam-up-stk")) {
        const id = t.getAttribute("data-cam-up-stk");
        uploadStickers = uploadStickers.includes(id) ? uploadStickers.filter((x) => x !== id) : uploadStickers.concat(id);
        paintUploadSheet("", false);
        return;
      }
      if (t.hasAttribute("data-cam-up-stage")) {
        uploadStage = t.getAttribute("data-cam-up-stage") || "";
        paintUploadSheet("", false);
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
      if (t.hasAttribute("data-cam-up-close")) closeUploadSheet();
    });
  }

  const UP_ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    lib: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  };
  let uploadBusy = false;
  let uploadReturnFocus = null;
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

  function paintUploadSheet(status, busy, isErr) {
    ensureUploadUi();
    uploadBusy = !!busy;
    const keep = document.activeElement && uploadSheet.contains(document.activeElement) ? [...uploadSheet.querySelectorAll("button")].indexOf(document.activeElement) : -1;
    const dis = busy ? " disabled" : "";
    uploadSheet.innerHTML = `<div class="cam-up__card" role="dialog" aria-modal="true" aria-labelledby="camUpTitle">
      <h2 id="camUpTitle">Classificar e enviar</h2>
      <p>${esc(uploadTarget ? uploadTarget.label : "")}</p>
      <p class="cam-up__lbl" id="camUpStageLbl">Etapa da obra</p>
      <div class="cam-up__stages" role="group" aria-labelledby="camUpStageLbl">${UPLOAD_STAGES.map(
        (s) =>
          `<button type="button" class="cam-up__stage${s.id === uploadStage ? " is-on" : ""}" data-cam-up-stage="${esc(s.id)}" aria-pressed="${s.id === uploadStage}"${dis}>${s.id === uploadStage ? UP_ICON.check : ""}${esc(s.label)}</button>`,
      ).join("")}</div>
      ${stickers.some((x) => !x.archived)
        ? `<p class="cam-up__lbl">Stickers <span>opcional</span></p><div class="cam-up__stks" role="group" aria-label="Stickers" data-no-i18n>${stickers
            .filter((x) => !x.archived)
            .map((x) => `<button type="button" class="cam-up__stk${uploadStickers.includes(x.id) ? " is-on" : ""}" data-cam-up-stk="${esc(x.id)}" aria-pressed="${uploadStickers.includes(x.id)}" style="--stk:${esc(x.color)}"${dis}><i aria-hidden="true"></i>${esc(x.name)}</button>`)
            .join("")}</div>`
        : ""}
      ${people && people.length > 1
        ? `<label class="cam-up__who"><span>Tirada por</span><select id="camUpWho"${dis}>${people
            .map((u) => `<option value="${esc(u.id)}"${u.id === (uploadTakenBy || meId) ? " selected" : ""}>${esc(u.name || "—")}${u.id === meId ? " (você)" : ""}</option>`)
            .join("")}</select></label>`
        : ""}
      <div class="cam-up__go">
        <button type="button" data-cam-up-camera${dis}>${UP_ICON.cam}Câmera</button>
        <button type="button" class="is-sec" data-cam-up-library${dis}>${UP_ICON.lib}Galeria</button>
      </div>
      <div class="cam-up__status${isErr ? " is-err" : ""}" role="status">${esc(status || "")}</div>
      <button type="button" class="cam-up__cancel" data-cam-up-close${dis}>Cancelar</button>
    </div>`;
    if (keep >= 0) uploadSheet.querySelectorAll("button")[keep]?.focus();
  }

  function closeUploadSheet() {
    if (!uploadSheet || uploadSheet.hidden || uploadBusy) return;
    uploadSheet.hidden = true;
    if (uploadReturnFocus && document.contains(uploadReturnFocus)) uploadReturnFocus.focus();
    uploadReturnFocus = null;
  }

  function openUploadSheet(jobId) {
    const j = jobs.find((x) => String(x.id) === String(jobId));
    if (!j) return;
    const who = listWho(j);
    uploadTarget = { id: j.id, label: who && who !== "Sem cliente" ? who : j.title || "Job" };
    uploadStage = "during";
    uploadTakenBy = "";
    uploadStickers = [];
    uploadReturnFocus = document.activeElement;
    paintUploadSheet("", false);
    uploadSheet.hidden = false;
    uploadSheet.querySelector("[data-cam-up-camera]")?.focus({ preventScroll: true });
    if (!people) loadPeople().then(() => !uploadSheet.hidden && !uploadBusy && paintUploadSheet("", false));
  }

  // ---------------------------------------------------------------- sticker manager
  const STICKER_COLORS = ["#B4561A", "#1D6FB8", "#2F7D4F", "#7A4BC2", "#B42318", "#8A6A00", "#0F766E", "#475467"];
  let stkSheet = null;
  let stkReturnFocus = null;
  let stkNewColor = STICKER_COLORS[1];
  let stkStatus = "";

  /** Create, rename, recolour and archive stickers (managers). Every change saves at once. */
  function openStickerManager() {
    if (!canManage) return;
    if (!stkSheet) {
      stkSheet = document.createElement("div");
      stkSheet.className = "cam-up cam-stkm";
      stkSheet.hidden = true;
      document.body.appendChild(stkSheet);
      stkSheet.addEventListener("click", onStickerSheetClick);
      stkSheet.addEventListener("change", onStickerSheetChange);
      stkSheet.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closeStickerManager();
        }
        if (e.key === "Enter" && e.target.id === "camStkNew") {
          e.preventDefault();
          createSticker();
        }
      });
    }
    stkReturnFocus = document.activeElement;
    stkStatus = "";
    paintStickerManager();
    stkSheet.hidden = false;
    stkSheet.querySelector("#camStkNew")?.focus({ preventScroll: true });
  }
  function closeStickerManager() {
    if (!stkSheet || stkSheet.hidden) return;
    stkSheet.hidden = true;
    if (stkReturnFocus && document.contains(stkReturnFocus)) stkReturnFocus.focus();
  }
  function swatches(cur, attr) {
    return STICKER_COLORS.map((c) => `<button type="button" class="cam-stkm__sw${c === cur ? " is-on" : ""}" ${attr}="${c}" aria-pressed="${c === cur}" aria-label="Cor ${c}" style="--stk:${c}"></button>`).join("");
  }
  function paintStickerManager() {
    const active = stickers.filter((x) => !x.archived);
    const archived = stickers.filter((x) => x.archived);
    const row = (x) => `<li class="cam-stkm__row${x.archived ? " is-arch" : ""}" data-stk-row="${esc(x.id)}">
        <span class="cam-stkm__pv" style="--stk:${esc(x.color)}">${esc(x.name)}</span>
        <input type="text" class="cam-stkm__name" value="${esc(x.name)}" maxlength="32" aria-label="Nome do sticker" data-stk-name="${esc(x.id)}"${x.archived ? " disabled" : ""} />
        ${x.archived ? "" : `<span class="cam-stkm__sws" role="group" aria-label="Cor">${swatches(x.color, `data-stk-color-for="${esc(x.id)}" data-stk-color`)}</span>`}
        ${x.system ? `<small>aplicado nas fotos de samples</small>` : ""}
        <button type="button" class="cam-stkm__arch" data-stk-arch="${esc(x.id)}" data-arch="${x.archived ? "0" : "1"}">${x.archived ? "Restaurar" : "Arquivar"}</button>
      </li>`;
    stkSheet.innerHTML = `<div class="cam-up__card cam-stkm__card" role="dialog" aria-modal="true" aria-labelledby="camStkTitle">
      <h2 id="camStkTitle">Stickers</h2>
      <p>Etiquetas para organizar as fotos, como Delivery ou Scan. Cada foto pode ter várias.</p>
      <div class="cam-stkm__new">
        <input type="text" id="camStkNew" maxlength="32" placeholder="Novo sticker, ex.: Delivery" aria-label="Nome do novo sticker" />
        <span class="cam-stkm__sws" role="group" aria-label="Cor do novo sticker">${swatches(stkNewColor, "data-stk-newcolor")}</span>
        <button type="button" class="cam-stkm__add" data-stk-create>Criar</button>
      </div>
      <div class="cam-up__status${/não|erro|já existe/i.test(stkStatus) ? " is-err" : ""}" role="status">${esc(stkStatus)}</div>
      <ul class="cam-stkm__list" data-no-i18n>${active.map(row).join("") || '<li class="cam-empty">Nenhum sticker ainda.</li>'}</ul>
      ${archived.length ? `<p class="cam-up__lbl">Arquivados</p><ul class="cam-stkm__list" data-no-i18n>${archived.map(row).join("")}</ul>` : ""}
      <button type="button" class="cam-up__cancel" data-stk-close>Fechar</button>
    </div>`;
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
      stkStatus = "Escreva um nome para o sticker.";
      paintStickerManager();
      stkSheet.querySelector("#camStkNew")?.focus();
      return;
    }
    try {
      const r = await api("/api/job-media/stickers", { method: "POST", body: JSON.stringify({ name, color: stkNewColor }) });
      stickers = stickers.concat(r.data);
      stkStatus = `“${r.data.name}” criado`;
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
    if (e.target === stkSheet || e.target.closest("[data-stk-close]")) return closeStickerManager();
    const nc = e.target.closest("[data-stk-newcolor]");
    if (nc) {
      stkNewColor = nc.getAttribute("data-stk-newcolor");
      const keep = stkSheet.querySelector("#camStkNew")?.value || "";
      paintStickerManager();
      const inp = stkSheet.querySelector("#camStkNew");
      inp.value = keep;
      inp.focus({ preventScroll: true }); // Enter still creates after picking a colour
      return;
    }
    if (e.target.closest("[data-stk-create]")) return createSticker();
    const col = e.target.closest("[data-stk-color]");
    if (col) return saveSticker(col.getAttribute("data-stk-color-for"), { color: col.getAttribute("data-stk-color") }, "Cor atualizada");
    const ar = e.target.closest("[data-stk-arch]");
    if (ar) {
      const archive = ar.getAttribute("data-arch") === "1";
      const x = stickerById(ar.getAttribute("data-stk-arch"));
      saveSticker(x.id, { archived: archive }, archive ? `“${x.name}” arquivado. As fotos que já têm continuam com ele.` : `“${x.name}” restaurado`);
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

  async function sendUpload(files) {
    const list = Array.from(files || []);
    if (!list.length || !uploadTarget) return;
    let sent = 0;
    const live = uploadFrom === "camera";
    const takenBy = uploadTakenBy && uploadTakenBy !== meId ? uploadTakenBy : null;
    let devicePos;
    const deviceGps = () => (devicePos !== undefined ? Promise.resolve(devicePos) : uploadGps().then((p) => (devicePos = p)));
    try {
      for (const file of list) {
        paintUploadSheet(`Enviando ${sent + 1} de ${list.length}…`, true);
        // Date, GPS and camera from the photo itself (EXIF), read before compression drops them.
        const shot = window.PhotoExif
          ? await window.PhotoExif.uploadMeta(file, { live, deviceGps })
          : { taken_at_device: new Date().toISOString(), taken_at_source: "upload" };
        const body = {
          data_url: await compressUpload(file),
          stage: uploadStage || null,
          ...shot,
          taken_by_id: takenBy,
          sticker_ids: uploadStickers.slice(),
          client_upload_id: window.crypto?.randomUUID ? crypto.randomUUID() : `cam-${Date.now()}-${sent}`,
          device_label: window.__OM_FOCUS_APP ? "ObraCam app" : "ObraCam",
          is_public: false,
        };
        await api(`/api/work-orders/${encodeURIComponent(uploadTarget.id)}/media`, { method: "POST", body: JSON.stringify(body) });
        sent += 1;
      }
      uploadBusy = false;
      closeUploadSheet();
      window.crmToast?.success?.(sent === 1 ? "Foto enviada" : `${sent} fotos enviadas`);
      delete mediaCache[uploadTarget.id];
      await load();
      select(uploadTarget.id, false);
    } catch (e) {
      paintUploadSheet(`${sent ? `${sent} enviada${sent === 1 ? "" : "s"}. ` : ""}${e.message || "Falha ao enviar. Tente de novo."}`, false, true);
      if (sent) {
        delete mediaCache[uploadTarget.id];
        load().then(() => select(uploadTarget.id, false)).catch(() => {});
      }
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
      const f = e.target.closest("[data-filter]");
      if (!f) return;
      listPref.filter = f.getAttribute("data-filter");
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
      const ph = e.target.closest("[data-ph-i]");
      if (ph) openViewer(shown, Number(ph.getAttribute("data-ph-i")) || 0);
    });
    document.addEventListener("click", (e) => {
      const up = e.target.closest(".cam-pbar [data-cam-upload]");
      if (!up) return;
      e.preventDefault();
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
  // The ObraCam app (obracam-app.js) refreshes the job after sending photos.
  window.__camApp = {
    mode: () => mode,
    manageStickers: () => openStickerManager(),
    setView,
    openUpload: openUploadSheet,
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
      canManage = s?.user?.role === "admin" || perms.includes("work_orders.manage");
      meId = s?.user?.id || "";
      const add = $("camAddJob");
      if (add) add.hidden = !canManage;
      // Session arrives after the first paint — rebuild rows so swipe-delete appears.
      renderList();
      if (window.__crmJobModal?.onSaved) {
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
  load().catch((e) => {
    $("camRows").innerHTML = `<p class="cam-empty">${esc(e.message || "Falha ao carregar")}</p>`;
    $("camDetail").innerHTML = "";
  });
})();
