(function () {
  let map = null;
  let mapMarkers = [];
  let allJobs = [];
  let allFeed = [];
  let searchQ = "";
  let searchTimer = null;
  let mapGen = 0;
  const GEO_CACHE_KEY = "om_jmb_geocode_v1";
  const geoCache = loadGeoCache();

  async function api(url) {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadGeoCache() {
    try {
      const raw = localStorage.getItem(GEO_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveGeoCache() {
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache));
    } catch (_) {}
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  let days = 7;
  let stageFilter = "all";
  let jobFilter = "active";
  let canManage = false;

  function statusLabel(status) {
    const map = { draft: "Rascunho", scheduled: "Agendado", in_progress: "Em campo", completed: "Concluído", canceled: "Cancelado" };
    return map[status] || status || "—";
  }

  function stageLabel(stage) {
    return STAGE[stage] || "Geral";
  }

  function isActive(j) {
    return j.status === "scheduled" || j.status === "in_progress" || j.status === "draft";
  }

  /** Sem foto recente só vale para job ativo (concluído não precisa de foto nova). */
  function needsPhoto(j) {
    return isActive(j) && !!j.stale;
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]} · ${p(d.getHours())}:${p(d.getMinutes())}`;
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

  function proofLabel(j) {
    if (!isActive(j)) return j.last_photo ? "Concluído" : "—";
    if (j.stale) return j.last_photo ? "Sem foto recente" : "Sem foto";
    return "Em dia";
  }

  function setMapStatus(text) {
    const el = document.getElementById("jmbMapStatus");
    if (el) el.textContent = text || "";
  }

  function photoSrc(p) {
    return (p && (p.thumb_url || p.url)) || "";
  }

  function normalizeQuery(q) {
    return String(q || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  function jobMatches(j, q) {
    if (!q) return true;
    const hay = normalizeQuery(
      [j.number, j.title, j.address, j.client_name, statusLabel(j.status), proofLabel(j), ...(j.photos || []).map((p) => p.author_name)].filter(Boolean).join(" "),
    );
    return hay.includes(q);
  }

  function feedMatches(p, q) {
    if (stageFilter !== "all" && (p.stage || "none") !== stageFilter) return false;
    if (!q) return true;
    const hay = normalizeQuery([p.job_number, p.job_title, stageLabel(p.stage), p.caption, p.address, p.author_name].filter(Boolean).join(" "));
    return hay.includes(q);
  }

  function inPeriod(p) {
    return new Date(p.created_at).getTime() >= Date.now() - days * 86400000;
  }

  function filteredJobs() {
    return allJobs.filter((j) => {
      if (!jobMatches(j, searchQ)) return false;
      if (jobFilter === "active") return isActive(j);
      if (jobFilter === "need") return needsPhoto(j);
      if (jobFilter === "done") return j.status === "completed";
      return true;
    });
  }

  function filteredFeed() {
    return allFeed.filter((p) => feedMatches(p, searchQ));
  }

  function setSearchMeta(jobs, feed) {
    const meta = document.getElementById("jmbSearchMeta");
    if (!meta) return;
    meta.textContent = searchQ ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} · ${feed.length} foto${feed.length === 1 ? "" : "s"}` : "";
  }

  function renderOverview() {
    const active = allJobs.filter(isActive);
    const ok = active.filter((j) => !j.stale).length;
    const need = active.filter((j) => j.stale).length;
    const period = allFeed.filter(inPeriod);
    const noGps = period.filter((p) => !(p.location_available && p.lat != null && p.lng != null)).length;
    const far = period.filter((p) => p.far_from_job).length;
    const cards = [
      ["Jobs ativos", active.length, "agendados ou em campo", "", "active"],
      ["Com foto recente", ok, `nos últimos ${days} dias`, ok ? "is-ok" : "", "active"],
      ["Sem foto recente", need, need ? "jobs ativos precisam de foto" : "todos em dia", need ? "is-hot" : "", "need"],
      ["Fotos no período", period.length, period.length ? `${noGps} sem GPS · ${far} longe do job` : `nenhuma em ${days} dias`, far ? "is-hot" : "", ""],
    ];
    const host = document.getElementById("camCards");
    if (host) {
      host.innerHTML = cards
        .map(
          ([k, v, sub, cls, f]) =>
            `<button type="button" class="cam-card${f && jobFilter === f && f === "need" ? " is-on" : ""}" ${f ? `data-cam-jobs="${f}"` : 'data-cam-scroll="feed"'}><span>${k}</span><b class="${cls === "is-hot" && v ? "is-hot" : ""}">${v}</b><small class="${cls}">${escapeHtml(sub)}</small></button>`,
        )
        .join("");
    }
    const stageHost = document.getElementById("camStage");
    if (stageHost) {
      const counts = { all: allFeed.length, before: 0, during: 0, after: 0, none: 0 };
      allFeed.forEach((p) => (counts[p.stage && counts[p.stage] != null ? p.stage : "none"] += 1));
      stageHost.innerHTML = [["all", "Todas"], ["before", "Antes"], ["during", "Durante"], ["after", "Depois"], ["none", "Geral"]]
        .filter(([k]) => k === "all" || counts[k] > 0)
        .map(([k, l]) => `<button type="button" class="cam-chip${stageFilter === k ? " is-on" : ""}" data-stage="${k}">${l} <em>${counts[k]}</em></button>`)
        .join("");
    }
    const jf = document.getElementById("camJobFilter");
    if (jf) {
      const n = { active: active.length, need, done: allJobs.filter((j) => j.status === "completed").length, all: allJobs.length };
      jf.innerHTML = [["active", "Ativos"], ["need", "Sem foto recente"], ["done", "Concluídos"], ["all", "Todos"]]
        .map(([k, l]) => `<button type="button" class="cam-chip${jobFilter === k ? " is-on" : ""}" data-jobs="${k}">${l} <em>${n[k]}</em></button>`)
        .join("");
    }
  }

  function fmtDistance(m) {
    if (m == null || !Number.isFinite(Number(m))) return "";
    const n = Number(m);
    if (n < 1000) return `${Math.round(n)} m`;
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km`;
  }

  function gpsHtml(p) {
    const hasGps = p.location_available !== false && p.lat != null && p.lng != null;
    if (!hasGps) return `<span class="cam-gps is-off">Sem GPS</span>`;
    const maps = `https://maps.google.com/?q=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
    const dist = fmtDistance(p.distance_m);
    return `<a class="cam-gps${p.far_from_job ? " is-far" : ""}" href="${escapeHtml(maps)}" target="_blank" rel="noopener">${p.far_from_job ? `Longe · ${escapeHtml(dist)}` : dist ? `${escapeHtml(dist)} do job` : "Ver no mapa"}</a>`;
  }

  /** Foto do feed → formato do visualizador. */
  function feedToViewer(p) {
    return {
      id: p.id, url: p.url, thumb_url: p.thumb_url, stage: p.stage, created_at: p.created_at, taken_at_device: p.taken_at_device,
      author: p.author_name, device: p.device_label, caption: p.caption, address: p.address, lat: p.lat, lng: p.lng,
      location_available: p.location_available, distance_m: p.distance_m, far_from_job: p.far_from_job, in_portfolio: p.in_portfolio,
      job: { id: p.job_id, number: p.job_number, title: p.job_title, client: (allJobs.find((j) => j.id === p.job_id) || {}).client_name },
    };
  }
  function jobPhotoToViewer(j, p) {
    return {
      id: p.id, url: p.url, thumb_url: p.url, stage: p.stage, created_at: p.created_at, taken_at_device: p.taken_at_device,
      author: p.author_name, device: p.device_label, caption: p.caption, address: p.address || j.address, lat: p.lat, lng: p.lng,
      location_available: p.lat != null && p.lng != null, distance_m: p.distance_m, far_from_job: p.far_from_job, in_portfolio: p.in_portfolio,
      job: { id: j.id, number: j.number, title: j.title, client: j.client_name },
    };
  }

  function openViewer(list, index) {
    if (!window.CamViewer) return;
    window.CamViewer.open({
      photos: list,
      index,
      canPortfolio: canManage,
      onPortfolio: async (photo, next) => {
        const r = await fetch(`/api/work-orders/${encodeURIComponent(photo.job.id)}/media/${encodeURIComponent(photo.id)}/portfolio`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ in_portfolio: next }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.success === false) throw new Error(j.error || "Erro ao salvar");
        [allFeed, ...allJobs.map((x) => x.photos || [])].forEach((arr) => arr.forEach((q) => { if (q.id === photo.id) q.in_portfolio = next; }));
        window.crmToast?.success?.(next ? "Foto no portfólio público." : "Foto tirada do portfólio.");
        return { in_portfolio: next };
      },
    });
  }

  let shownFeed = [];
  let feedAll = false;
  function renderFeed(feed) {
    const feedEl = document.getElementById("jmbFeed");
    if (!feedEl) return;
    shownFeed = feed;
    const cnt = document.getElementById("camFeedCount");
    if (cnt) cnt.textContent = feed.length ? `${feed.length} foto${feed.length === 1 ? "" : "s"}` : "";
    if (!feed.length) {
      feedEl.innerHTML = `<p class="cam-empty">${searchQ || stageFilter !== "all" ? "Nenhuma foto com esse filtro." : "Ainda sem fotos. A equipe tira pelo Campo (ticket do job)."}</p>`;
      return;
    }
    const phone = window.matchMedia("(max-width: 760px)").matches;
    const cut = phone && !feedAll && feed.length > 4 ? 4 : feed.length;
    feedEl.innerHTML = feed
      .slice(0, cut)
      .map(
        (p, i) => `<div class="cam-fi">
          <button type="button" class="cam-fi__th" data-feed-i="${i}" aria-label="Ver foto" style="background-image:url('${escapeHtml(p.thumb_url || p.url)}')"><span>${escapeHtml(stageLabel(p.stage))}</span></button>
          <div class="cam-fi__b">
            <a href="job-detail.html?id=${encodeURIComponent(p.job_id)}#fotos"><b>#${escapeHtml(String(p.job_number ?? "—"))}</b> ${escapeHtml(p.job_title || "")}</a>
            <small>${escapeHtml(fmtWhen(p.taken_at_device || p.created_at))}${p.author_name ? ` · ${escapeHtml(p.author_name)}` : ""}</small>
            ${p.caption ? `<small class="cam-fi__cap">${escapeHtml(p.caption)}</small>` : ""}
            ${gpsHtml(p)}
          </div>
        </div>`,
      )
      .join("") + (cut < feed.length ? `<button type="button" class="cam-feed__all" data-feed-all>Ver todas as ${feed.length} fotos</button>` : "");
  }

  function renderJobs(jobs) {
    const body = document.getElementById("jmbJobsBody");
    if (!body) return;
    const count = document.getElementById("jmbJobsCount");
    if (count) count.textContent = String(jobs.length);
    if (!jobs.length) {
      body.innerHTML = `<p class="cam-empty">${searchQ ? "Nenhum job com essa busca." : jobFilter === "need" ? "Todos os jobs ativos têm foto recente." : "Nenhum job neste filtro."}</p>`;
      return;
    }
    const order = (j) => (needsPhoto(j) ? 0 : isActive(j) ? 1 : 2);
    body.innerHTML = jobs
      .slice()
      .sort((a, b) => order(a) - order(b))
      .map((j) => {
        const label = proofLabel(j);
        const cls = label === "Em dia" ? "ok" : label === "Sem foto recente" || label === "Sem foto" ? "hot" : "";
        const photos = (j.photos || []).filter((p) => photoSrc(p));
        const total = j.photo_count != null ? j.photo_count : photos.length;
        const thumbs = photos
          .slice(0, 5)
          .map((p, i) => `<button type="button" class="cam-th" data-job-photo="${escapeHtml(j.id)}" data-i="${i}" aria-label="Ver foto" style="background-image:url('${escapeHtml(photoSrc(p))}')"></button>`)
          .join("");
        const more = total > 5 ? `<span class="cam-more">+${total - 5}</span>` : "";
        const gpsCount = photos.filter((p) => p.lat != null && p.lng != null).length;
        const far = photos.filter((p) => p.far_from_job).length;
        const st = j.status === "in_progress" ? "dk" : j.status === "completed" ? "ol" : "";
        return `<div class="cam-tr">
          <div class="cam-td cam-td--job">
            <a href="${escapeHtml(j.detail_url)}#fotos"><b>${escapeHtml(j.title || "Job")}</b></a>
            <small>#${escapeHtml(String(j.number ?? "—"))}${j.client_name ? ` · ${escapeHtml(j.client_name)}` : ""}</small>
            ${thumbs ? `<div class="cam-ths">${thumbs}${more}</div>` : ""}
          </div>
          <div class="cam-td cam-td--addr">${escapeHtml(j.address || "Sem endereço")}</div>
          <div class="cam-td"><span class="cam-pill${st ? ` cam-pill--${st}` : ""}">${escapeHtml(statusLabel(j.status))}</span></div>
          <div class="cam-td cam-td--last">${j.last_photo ? `<b>${escapeHtml(ago(j.last_photo.created_at))}</b><small>${escapeHtml(fmtWhen(j.last_photo.created_at))}</small>` : '<span class="cam-mu">Nenhuma foto</span>'}</div>
          <div class="cam-td cam-td--n">${total ? `<b>${total}</b><small>${gpsCount ? `${gpsCount} com GPS` : "sem GPS"}${far ? ` · <span class="cam-hot">${far} longe</span>` : ""}</small>` : '<span class="cam-mu">—</span>'}</div>
          <div class="cam-td"><span class="cam-proof${cls ? ` cam-proof--${cls}` : ""}">${escapeHtml(label)}</span></div>
        </div>`;
      })
      .join("");
  }

  async function geocodeNominatim(address) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address);
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows[0]) return null;
    const lat = Number(rows[0].lat);
    const lng = Number(rows[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  async function geocodeAddress(address) {
    const key = String(address || "")
      .trim()
      .toLowerCase();
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(geoCache, key)) {
      return geoCache[key];
    }
    let pt = null;
    try {
      pt = await geocodeNominatim(address);
    } catch (_) {
      pt = null;
    }
    geoCache[key] = pt;
    saveGeoCache();
    await sleep(1100);
    return pt;
  }

  function markerColor(j) {
    if (needsPhoto(j)) return "#B4561A";
    return "#221E1A";
  }

  function jobPinHtml(j) {
    const photos = (j.photos || []).filter((p) => photoSrc(p)).slice(0, 3);
    if (!photos.length) {
      const color = markerColor(j);
      return `<span class="jmb-marker__pin" style="background:${color};width:18px;height:18px"></span>`;
    }
    const tone = needsPhoto(j) ? "is-stale" : "is-ok";
    const imgs = photos
      .map((p) => `<img class="jmb-marker__thumb" src="${escapeHtml(photoSrc(p))}" alt="" />`)
      .join("");
    const total = (j.photos || []).length;
    const badge = total > 1 ? `<span class="jmb-marker__n">${total > 9 ? "9+" : total}</span>` : "";
    return `<span class="jmb-marker__stack ${tone}">${imgs}${badge}</span>`;
  }

  function popupThumbsHtml(j) {
    const photos = (j.photos || []).filter((p) => photoSrc(p)).slice(0, 6);
    if (!photos.length) return "";
    const imgs = photos
      .map(
        (p, i) =>
          `<button type="button" data-job-photo="${escapeHtml(j.id)}" data-i="${i}" aria-label="Ver foto" style="background-image:url('${escapeHtml(photoSrc(p))}')"></button>`,
      )
      .join("");
    const extra =
      (j.photos || []).length > 6
        ? `<span class="cam-pop__more">+${j.photos.length - 6}</span>`
        : "";
    return `<div class="jmb-popup-thumbs">${imgs}${extra}</div>`;
  }

  function addJobMarker(j, lat, lng, source) {
    if (!map || lat == null || lng == null) return null;
    const hasThumbs = (j.photos || []).some((p) => photoSrc(p));
    const size = hasThumbs ? 44 : 18;
    const icon = L.divIcon({
      className: "jmb-marker",
      html: jobPinHtml(j),
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    const m = L.marker([lat, lng], { icon, zIndexOffset: hasThumbs ? 200 : 100 }).addTo(map);
    const sourceLabel =
      source === "photo" ? "GPS da foto" : source === "site" ? "Local do job (GPS/fotos)" : "Endereço do job";
    const tip = j.address || `#${j.number ?? ""} ${j.title || ""}`.trim() || sourceLabel;
    m.bindTooltip(escapeHtml(tip), { direction: "top", opacity: 0.95 });
    m.bindPopup(
      `<div class="cam-pop"><small>Job #${escapeHtml(String(j.number ?? ""))} · ${escapeHtml(statusLabel(j.status))}</small>` +
        `<b>${escapeHtml(j.title || "")}</b>` +
        `<span class="cam-pop__addr">${escapeHtml(j.address || "")}</span>` +
        `<span class="cam-proof${needsPhoto(j) ? " cam-proof--hot" : isActive(j) ? " cam-proof--ok" : ""}">${escapeHtml(proofLabel(j))}</span>` +
        popupThumbsHtml(j) +
        `<span class="cam-pop__src">${sourceLabel}</span>` +
        `<a class="cam-pop__btn" href="${escapeHtml(j.detail_url)}#fotos">Abrir job</a></div>`,
      { maxWidth: 260 },
    );
    mapMarkers.push(m);
    return m;
  }

  function addPhotoMarker(j, photo) {
    if (!map || photo?.lat == null || photo?.lng == null) return null;
    const far = Boolean(photo.far_from_job);
    const src = photoSrc(photo);
    const html = src
      ? `<img class="jmb-marker__photo-thumb${far ? " is-far" : ""}" src="${escapeHtml(src)}" alt="" />`
      : `<span class="jmb-marker__pin jmb-marker__pin--photo" style="background:${far ? "#B4561A" : "#221E1A"}"></span>`;
    const size = src ? 34 : 12;
    const icon = L.divIcon({
      className: "jmb-marker",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    const m = L.marker([Number(photo.lat), Number(photo.lng)], { icon, zIndexOffset: 50 }).addTo(map);
    const dist = fmtDistance(photo.distance_m);
    const maps = `https://maps.google.com/?q=${encodeURIComponent(`${photo.lat},${photo.lng}`)}`;
    const when = fmtWhen(photo.taken_at_device || photo.created_at);
    const addr = photo.address || j.address || `${Number(photo.lat).toFixed(5)}, ${Number(photo.lng).toFixed(5)}`;
    const tip = [when, addr].filter(Boolean).join(" · ");
    m.bindTooltip(escapeHtml(tip), { direction: "top", opacity: 0.95, sticky: true });
    const idx = (j.photos || []).findIndex((q) => q.id === photo.id);
    const preview = src
      ? `<button type="button" class="cam-pop__img" data-job-photo="${escapeHtml(j.id)}" data-i="${idx < 0 ? 0 : idx}" style="background-image:url('${escapeHtml(src)}')" aria-label="Ver foto"></button>`
      : "";
    m.bindPopup(
      `<div class="cam-pop"><small>Job #${escapeHtml(String(j.number ?? ""))} · ${escapeHtml(stageLabel(photo.stage))}</small>` +
        `<b>${escapeHtml(j.title || "")}</b>` +
        preview +
        `<span class="cam-pop__addr">${escapeHtml(when)} · ${escapeHtml(addr)}</span>` +
        (dist ? `<span class="cam-pop__dist${far ? " is-far" : ""}">${far ? "Longe do job" : "No local"} · ${escapeHtml(dist)}</span>` : "") +
        `<span class="cam-pop__row"><a href="${escapeHtml(maps)}" target="_blank" rel="noopener">Abrir no Maps</a><a href="${escapeHtml(j.detail_url)}#fotos">Abrir job</a></span></div>`,
      { maxWidth: 260 },
    );
    mapMarkers.push(m);
    return m;
  }

  function fitMap() {
    if (!map || !mapMarkers.length) return;
    const bounds = mapMarkers.map((m) => m.getLatLng());
    if (bounds.length === 1) map.setView(bounds[0], 12);
    else map.fitBounds(bounds, { padding: [28, 28] });
  }

  async function renderMap(jobs) {
    const el = document.getElementById("jmbMap");
    if (!el) return;
    if (typeof L === "undefined") {
      setMapStatus("Mapa indisponível agora");
      return;
    }
    const gen = ++mapGen;

    mapMarkers = [];
    if (map) {
      map.remove();
      map = null;
    }
    map = L.map(el).setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    setTimeout(() => map && map.invalidateSize(), 80);

    let photoPins = 0;
    let sitePins = 0;
    const needGeocode = [];

    for (const j of jobs) {
      const photosWithGps = (j.photos || []).filter((p) => p.lat != null && p.lng != null);
      for (const p of photosWithGps) {
        addPhotoMarker(j, p);
        photoPins += 1;
      }
      if (j.geo_lat != null && j.geo_lng != null && Number.isFinite(Number(j.geo_lat)) && Number.isFinite(Number(j.geo_lng))) {
        addJobMarker(j, Number(j.geo_lat), Number(j.geo_lng), "site");
        sitePins += 1;
      } else if (!photosWithGps.length && j.address && String(j.address).trim()) {
        needGeocode.push(j);
      }
    }
    if (gen !== mapGen) return;
    fitMap();

    if (!photoPins && !sitePins && !needGeocode.length) {
      setMapStatus(
        searchQ
          ? "Nenhum resultado com coordenadas na busca."
          : "Sem localização — tire fotos com GPS no Campo ou ponha o endereço nos jobs.",
      );
      return;
    }

    if (!needGeocode.length) {
      setMapStatus(
        `${photoPins} foto${photoPins === 1 ? "" : "s"} com GPS` + (sitePins ? ` · ${sitePins} job${sitePins === 1 ? "" : "s"}` : ""),
      );
      return;
    }

    setMapStatus(
      `Localizando ${needGeocode.length} job${needGeocode.length === 1 ? "" : "s"} pelo endereço…` +
        (photoPins ? ` (${photoPins} fotos já no mapa)` : ""),
    );

    let placed = sitePins;
    let failed = 0;
    for (let i = 0; i < needGeocode.length; i++) {
      if (gen !== mapGen) return;
      const j = needGeocode[i];
      const geo = await geocodeAddress(j.address);
      if (gen !== mapGen) return;
      if (geo) {
        addJobMarker(j, geo.lat, geo.lng, "address");
        placed += 1;
        fitMap();
      } else {
        failed += 1;
      }
      setMapStatus(
        `${photoPins} foto${photoPins === 1 ? "" : "s"}` +
          (placed ? ` · ${placed} job${placed === 1 ? "" : "s"}` : "") +
          (failed ? ` · ${failed} sem localização` : "") +
          (i + 1 < needGeocode.length ? ` · ${i + 2}/${needGeocode.length}` : ""),
      );
    }
    if (gen !== mapGen) return;
    setMapStatus(
      photoPins || placed
        ? `${photoPins} foto${photoPins === 1 ? "" : "s"} com GPS` +
            (placed ? ` · ${placed} job${placed === 1 ? "" : "s"} pelo endereço` : "") +
            (failed ? ` · ${failed} sem localização` : "")
        : "Não foi possível localizar os jobs. Verifique os endereços.",
    );
  }

  function applyFilters() {
    const jobs = filteredJobs();
    const feed = filteredFeed();
    setSearchMeta(jobs, feed);
    renderOverview();
    renderFeed(feed);
    renderJobs(jobs);
    const mapJobs = allJobs.filter((j) => jobMatches(j, searchQ) && (isActive(j) || (j.photos || []).length));
    renderMap(mapJobs).catch(() => {});
  }

  function wireSearch() {
    const input = document.getElementById("jmbSearch");
    const clearBtn = document.getElementById("jmbSearchClear");
    if (!input) return;

    const syncClear = () => {
      if (clearBtn) clearBtn.hidden = !String(input.value || "").trim();
    };

    input.addEventListener("input", () => {
      syncClear();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQ = normalizeQuery(input.value);
        applyFilters();
      }, 180);
    });

    clearBtn?.addEventListener("click", () => {
      input.value = "";
      searchQ = "";
      syncClear();
      applyFilters();
      input.focus();
    });
  }

  async function load() {
    setMapStatus("Carregando…");
    const json = await api(`/api/job-media/board?days=${days}`);
    allJobs = json.data?.jobs || [];
    allFeed = json.data?.feed || [];
    applyFilters();
  }

  function bind() {
    document.getElementById("camDays")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-days]");
      if (!b) return;
      days = Number(b.getAttribute("data-days")) || 7;
      document.querySelectorAll("#camDays [data-days]").forEach((x) => x.classList.toggle("is-on", x === b));
      load().catch((err) => window.crmToast?.error?.(err.message || "Falha ao atualizar"));
    });
    document.getElementById("camStage")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-stage]");
      if (!b) return;
      stageFilter = b.getAttribute("data-stage");
      applyFilters();
    });
    document.getElementById("camJobFilter")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-jobs]");
      if (!b) return;
      jobFilter = b.getAttribute("data-jobs");
      applyFilters();
    });
    document.getElementById("camCards")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cam-jobs],[data-cam-scroll]");
      if (!b) return;
      if (b.hasAttribute("data-cam-jobs")) {
        jobFilter = b.getAttribute("data-cam-jobs");
        applyFilters();
        document.querySelector(".cam-list-h")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        document.getElementById("jmbFeed")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    document.getElementById("jmbFeed")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-feed-all]")) {
        feedAll = true;
        renderFeed(shownFeed);
        return;
      }
      const b = e.target.closest("[data-feed-i]");
      if (!b) return;
      openViewer(shownFeed.map(feedToViewer), Number(b.getAttribute("data-feed-i")) || 0);
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-job-photo]");
      if (!b) return;
      const j = allJobs.find((x) => String(x.id) === b.getAttribute("data-job-photo"));
      if (!j) return;
      const list = (j.photos || []).filter((p) => photoSrc(p)).map((p) => jobPhotoToViewer(j, p));
      openViewer(list, Number(b.getAttribute("data-i")) || 0);
    });
  }

  wireSearch();
  bind();

  fetch("/api/auth/session", { credentials: "include" })
    .then((r) => r.json())
    .then((s) => {
      const perms = s?.user?.permissions || [];
      canManage = s?.user?.role === "admin" || perms.includes("work_orders.manage");
    })
    .catch(() => {});

  load().catch((e) => {
    const feedEl = document.getElementById("jmbFeed");
    if (feedEl) feedEl.innerHTML = `<p class="cam-empty">${escapeHtml(e.message || "Falha ao carregar")}</p>`;
    const body = document.getElementById("jmbJobsBody");
    if (body) body.innerHTML = `<p class="cam-empty">${escapeHtml(e.message || "Falha ao carregar")}</p>`;
    setMapStatus(e.message || "Falha ao carregar");
  });
})();
