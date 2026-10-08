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

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      scheduled: "Scheduled",
      in_progress: "Em progresso",
      completed: "Concluído",
      canceled: "Cancelado",
    };
    return map[status] || status || "—";
  }

  function stageLabel(stage) {
    const map = { before: "Antes", during: "Durante", after: "Depois" };
    return map[stage] || "Foto";
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function proofLabel(j) {
    if (j.stale) return "Atrasado";
    if (j.last_photo) return "OK";
    return "Sem foto";
  }

  function setMapStatus(text) {
    const el = document.getElementById("jmbMapStatus");
    if (el) el.textContent = text || "";
  }

  function photoSrc(p) {
    return (p && (p.url || p.thumb_url)) || "";
  }

  function normalizeQuery(q) {
    return String(q || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function jobMatches(j, q) {
    if (!q) return true;
    const hay = normalizeQuery(
      [j.number, j.title, j.address, j.status, j.field_status, proofLabel(j)].filter(Boolean).join(" "),
    );
    return hay.includes(q);
  }

  function feedMatches(p, q) {
    if (!q) return true;
    const hay = normalizeQuery(
      [p.job_number, p.job_title, p.stage, p.caption, p.address, p.author_name].filter(Boolean).join(" "),
    );
    return hay.includes(q);
  }

  function filteredJobs() {
    return allJobs.filter((j) => jobMatches(j, searchQ));
  }

  function filteredFeed() {
    return allFeed.filter((p) => feedMatches(p, searchQ));
  }

  function setSearchMeta(jobs, feed) {
    const meta = document.getElementById("jmbSearchMeta");
    if (!meta) return;
    if (!searchQ) {
      meta.textContent = "";
      return;
    }
    meta.textContent = `${jobs.length} job(s) · ${feed.length} foto(s)`;
  }

  function renderOverview(jobs) {
    const total = jobs.length;
    const ok = jobs.filter((j) => j.last_photo && !j.stale).length;
    const stale = jobs.filter((j) => j.stale || !j.last_photo).length;
    const elJobs = document.getElementById("jmbStatJobs");
    const elOk = document.getElementById("jmbStatOk");
    const elStale = document.getElementById("jmbStatStale");
    if (elJobs) elJobs.textContent = String(total);
    if (elOk) elOk.textContent = String(ok);
    if (elStale) elStale.textContent = String(stale);
    const count = document.getElementById("jmbJobsCount");
    if (count) count.textContent = `(${total})`;
  }

  function fmtDistance(m) {
    if (m == null || !Number.isFinite(Number(m))) return "";
    const n = Number(m);
    if (n < 1000) return `${Math.round(n)} m`;
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km`;
  }

  function renderFeed(feed) {
    const feedEl = document.getElementById("jmbFeed");
    if (!feedEl) return;
    if (!feed.length) {
      feedEl.innerHTML = searchQ
        ? '<p class="jobs-empty" style="padding:1rem 0">Nenhuma foto corresponde à busca.</p>'
        : '<p class="jobs-empty" style="padding:1rem 0">Ainda sem fotos recentes.</p>';
      return;
    }
    feedEl.innerHTML = feed
      .map((p) => {
        const hasGps = p.location_available && p.lat != null && p.lng != null;
        const maps = hasGps ? `https://maps.google.com/?q=${encodeURIComponent(`${p.lat},${p.lng}`)}` : "";
        const dist = fmtDistance(p.distance_m);
        const loc = hasGps
          ? `<a class="jmb-feed__gps${p.far_from_job ? " is-far" : ""}" href="${escapeHtml(maps)}" target="_blank" rel="noopener">${
              p.far_from_job ? `Longe · ${escapeHtml(dist)}` : dist ? `${escapeHtml(dist)} do job` : "Ver no mapa"
            }</a>`
          : `<span class="jmb-feed__gps is-off">Sem GPS</span>`;
        return `<div class="jmb-feed__item">
          <a class="jmb-feed__thumb" href="job-detail.html?id=${encodeURIComponent(p.job_id)}">
            <img src="${escapeHtml(p.thumb_url || p.url)}" alt="" loading="lazy" />
          </a>
          <span>
            <a class="jobs-table__client" href="job-detail.html?id=${encodeURIComponent(p.job_id)}">#${escapeHtml(String(p.job_number ?? "—"))}</a>
            ${escapeHtml(p.job_title || "")}<br/>
            <span class="jobs-table__muted">${escapeHtml(stageLabel(p.stage))} · ${escapeHtml(fmtWhen(p.created_at))}</span><br/>
            ${loc}
          </span>
        </div>`;
      })
      .join("");
  }

  function renderJobs(jobs) {
    const body = document.getElementById("jmbJobsBody");
    if (!body) return;
    if (!jobs.length) {
      body.innerHTML = searchQ
        ? '<tr><td colspan="5" class="jobs-empty">Nenhum job corresponde à busca.</td></tr>'
        : '<tr><td colspan="5" class="jobs-empty">Nenhum job aberto no período.</td></tr>';
      return;
    }
    body.innerHTML = jobs
      .map((j) => {
        const proof = j.stale
          ? '<span class="jmb-badge jmb-badge--warn">Atrasado</span>'
          : j.last_photo
            ? '<span class="jmb-badge jmb-badge--ok">OK</span>'
            : '<span class="jmb-badge">Sem foto</span>';
        const gpsCount = (j.photos || []).filter((p) => p.lat != null && p.lng != null).length;
        const far = (j.photos || []).some((p) => p.far_from_job);
        const gpsHint = gpsCount
          ? `<div class="jobs-table__muted">${gpsCount} foto(s) com GPS${far ? " · longe do job" : ""}</div>`
          : "";
        const thumbs = (j.photos || [])
          .slice(0, 4)
          .map(
            (p) =>
              `<img src="${escapeHtml(photoSrc(p))}" alt="" loading="lazy" style="width:28px;height:28px;object-fit:cover;border-radius:6px;border:1px solid #e7e5e4;margin-right:2px;vertical-align:middle;background:#ebe7e0" />`,
          )
          .join("");
        const more = (j.photos || []).length > 4 ? `<span class="jobs-table__muted">+${j.photos.length - 4}</span>` : "";
        return `<tr>
          <td>
            <a class="jobs-table__client" href="${escapeHtml(j.detail_url)}">#${escapeHtml(String(j.number ?? "—"))}</a>
            <div class="jobs-table__muted">${escapeHtml(j.title || "")}</div>
            ${thumbs ? `<div style="margin-top:0.35rem;line-height:0">${thumbs}${more}</div>` : ""}
            ${gpsHint}
          </td>
          <td class="jobs-table__muted">${escapeHtml(j.address || "—")}</td>
          <td><span class="job-status is-${escapeHtml(j.status || "draft")}">${escapeHtml(statusLabel(j.status))}</span></td>
          <td class="jobs-table__muted">${escapeHtml(fmtWhen(j.last_photo?.created_at))}</td>
          <td>${proof}</td>
        </tr>`;
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
    if (j.stale || !j.last_photo) return "#c2410c";
    return "#065f46";
  }

  function jobPinHtml(j) {
    const photos = (j.photos || []).filter((p) => photoSrc(p)).slice(0, 3);
    if (!photos.length) {
      const color = markerColor(j);
      return `<span class="jmb-marker__pin" style="background:${color};width:18px;height:18px"></span>`;
    }
    const tone = j.stale || !j.last_photo ? "is-stale" : "is-ok";
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
        (p) =>
          `<a href="${escapeHtml(j.detail_url)}"><img src="${escapeHtml(photoSrc(p))}" alt="" loading="lazy" /></a>`,
      )
      .join("");
    const extra =
      (j.photos || []).length > 6
        ? `<span style="font-size:11px;color:#8a8074;align-self:center">+${j.photos.length - 6}</span>`
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
      `<strong>#${escapeHtml(String(j.number ?? ""))}</strong> · ${escapeHtml(proofLabel(j))}<br/>` +
        `${escapeHtml(j.title || "")}<br/>` +
        `<span style="color:#6b645c;font-size:12px">${escapeHtml(j.address || "")}</span>` +
        popupThumbsHtml(j) +
        `<span style="color:#8a8074;font-size:11px">${sourceLabel}</span><br/>` +
        `<a href="${escapeHtml(j.detail_url)}">Abrir job</a>`,
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
      : `<span class="jmb-marker__pin jmb-marker__pin--photo" style="background:${far ? "#c2410c" : "#065f46"}"></span>`;
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
    const preview = src
      ? `<a href="${escapeHtml(j.detail_url)}"><img src="${escapeHtml(src)}" alt="" style="width:100%;max-width:160px;height:100px;object-fit:cover;border-radius:8px;display:block;margin:0.4rem 0;background:#ebe7e0" /></a>`
      : "";
    m.bindPopup(
      `<strong>#${escapeHtml(String(j.number ?? ""))}</strong> · foto<br/>` +
        `${escapeHtml(stageLabel(photo.stage))} · ${escapeHtml(when)}<br/>` +
        preview +
        `<span style="color:#6b645c;font-size:12px">${escapeHtml(addr)}</span><br/>` +
        (dist
          ? `<span style="color:${far ? "#c2410c" : "#065f46"};font-size:12px">${far ? "Longe" : "No local"} · ${escapeHtml(dist)}</span><br/>`
          : "") +
        `<a href="${escapeHtml(maps)}" target="_blank" rel="noopener">Abrir no Maps</a> · ` +
        `<a href="${escapeHtml(j.detail_url)}">Job</a>`,
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
    if (!el || typeof L === "undefined") return;
    const gen = ++mapGen;

    mapMarkers = [];
    if (map) {
      map.remove();
      map = null;
    }
    map = L.map(el).setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
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
          : "Sem coordenadas — tire fotos com GPS no Campo ou adicione endereço nos jobs.",
      );
      return;
    }

    if (!needGeocode.length) {
      setMapStatus(
        `${photoPins} foto(s) com GPS` + (sitePins ? ` · ${sitePins} local(is) de job` : ""),
      );
      return;
    }

    setMapStatus(
      `A localizar ${needGeocode.length} job(s) pelo endereço…` +
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
        `Mapa: ${photoPins} foto(s)` +
          (placed ? ` · ${placed} job(s)` : "") +
          (failed ? ` · ${failed} sem localização` : "") +
          (i + 1 < needGeocode.length ? ` · a processar ${i + 2}/${needGeocode.length}` : ""),
      );
    }
    if (gen !== mapGen) return;
    setMapStatus(
      photoPins || placed
        ? `${photoPins} foto(s) com GPS` +
            (placed ? ` · ${placed} job(s)` : "") +
            (failed ? ` · ${failed} sem localização` : "")
        : "Não foi possível localizar os jobs. Verifique os endereços.",
    );
  }

  function applyFilters() {
    const jobs = filteredJobs();
    const feed = filteredFeed();
    setSearchMeta(jobs, feed);
    renderOverview(jobs);
    renderFeed(feed);
    renderJobs(jobs);
    renderMap(jobs).catch(() => {});
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
    setMapStatus("A carregar…");
    const json = await api("/api/job-media/board?days=3");
    allJobs = json.data?.jobs || [];
    allFeed = json.data?.feed || [];
    applyFilters();
  }

  document.getElementById("jmbReload")?.addEventListener("click", () => {
    load().catch((e) => {
      if (window.crmToast?.show) window.crmToast.show(e.message || "Falha ao atualizar", { type: "error" });
    });
  });

  wireSearch();

  load().catch((e) => {
    const feedEl = document.getElementById("jmbFeed");
    if (feedEl) {
      feedEl.innerHTML = `<p class="jobs-empty" style="padding:1rem 0">${escapeHtml(e.message || "Falha ao carregar")}</p>`;
    }
    const body = document.getElementById("jmbJobsBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="5" class="jobs-empty">${escapeHtml(e.message || "Falha ao carregar")}</td></tr>`;
    }
    setMapStatus(e.message || "Falha ao carregar");
  });
})();
