(function () {
  let map = null;
  let mapMarkers = [];
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

  function renderFeed(feed) {
    const feedEl = document.getElementById("jmbFeed");
    if (!feedEl) return;
    if (!feed.length) {
      feedEl.innerHTML = '<p class="jobs-empty" style="padding:1rem 0">Ainda sem fotos recentes.</p>';
      return;
    }
    feedEl.innerHTML = feed
      .map(
        (p) => `<a class="jmb-feed__item" href="job-detail.html?id=${encodeURIComponent(p.job_id)}">
          <img src="${escapeHtml(p.thumb_url || p.url)}" alt="" loading="lazy" />
          <span>
            <strong class="jobs-table__client">#${escapeHtml(String(p.job_number ?? "—"))}</strong>
            ${escapeHtml(p.job_title || "")}<br/>
            <span class="jobs-table__muted">${escapeHtml(stageLabel(p.stage))} · ${escapeHtml(fmtWhen(p.created_at))}</span>
          </span>
        </a>`,
      )
      .join("");
  }

  function renderJobs(jobs) {
    const body = document.getElementById("jmbJobsBody");
    if (!body) return;
    if (!jobs.length) {
      body.innerHTML = '<tr><td colspan="5" class="jobs-empty">Nenhum job aberto no período.</td></tr>';
      return;
    }
    body.innerHTML = jobs
      .map((j) => {
        const proof = j.stale
          ? '<span class="jmb-badge jmb-badge--warn">Atrasado</span>'
          : j.last_photo
            ? '<span class="jmb-badge jmb-badge--ok">OK</span>'
            : '<span class="jmb-badge">Sem foto</span>';
        return `<tr>
          <td>
            <a class="jobs-table__client" href="${escapeHtml(j.detail_url)}">#${escapeHtml(String(j.number ?? "—"))}</a>
            <div class="jobs-table__muted">${escapeHtml(j.title || "")}</div>
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

  function addJobMarker(j, lat, lng, source) {
    if (!map || lat == null || lng == null) return null;
    const color = markerColor(j);
    const icon = L.divIcon({
      className: "jmb-marker",
      html: `<span class="jmb-marker__pin" style="background:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const m = L.marker([lat, lng], { icon }).addTo(map);
    m.bindPopup(
      `<strong>#${escapeHtml(String(j.number ?? ""))}</strong> · ${escapeHtml(proofLabel(j))}<br/>` +
        `${escapeHtml(j.title || "")}<br/>` +
        `<span style="color:#6b645c;font-size:12px">${escapeHtml(j.address || "")}</span><br/>` +
        `<span style="color:#8a8074;font-size:11px">${source === "photo" ? "GPS da foto" : "Endereço do job"}</span><br/>` +
        `<a href="${escapeHtml(j.detail_url)}">Abrir job</a>`,
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

    const withPhotoGps = [];
    const needGeocode = [];
    for (const j of jobs) {
      const plat = j.last_photo?.lat;
      const plng = j.last_photo?.lng;
      if (plat != null && plng != null && Number.isFinite(Number(plat)) && Number.isFinite(Number(plng))) {
        withPhotoGps.push(j);
      } else if (j.address && String(j.address).trim()) {
        needGeocode.push(j);
      }
    }

    for (const j of withPhotoGps) {
      addJobMarker(j, Number(j.last_photo.lat), Number(j.last_photo.lng), "photo");
    }
    fitMap();

    if (!needGeocode.length && !withPhotoGps.length) {
      setMapStatus("Sem coordenadas — adicione endereço nos jobs ou fotos com GPS.");
      return;
    }

    if (!needGeocode.length) {
      setMapStatus(`${withPhotoGps.length} job(s) no mapa (GPS das fotos)`);
      return;
    }

    setMapStatus(
      `A localizar ${needGeocode.length} job(s) pelo endereço…` +
        (withPhotoGps.length ? ` (${withPhotoGps.length} já no mapa)` : ""),
    );

    let placed = withPhotoGps.length;
    let failed = 0;
    for (let i = 0; i < needGeocode.length; i++) {
      const j = needGeocode[i];
      const geo = await geocodeAddress(j.address);
      if (geo) {
        addJobMarker(j, geo.lat, geo.lng, "address");
        placed += 1;
        fitMap();
      } else {
        failed += 1;
      }
      setMapStatus(
        `Mapa: ${placed} job(s)` +
          (failed ? ` · ${failed} sem localização` : "") +
          (i + 1 < needGeocode.length ? ` · a processar ${i + 2}/${needGeocode.length}` : ""),
      );
    }
    setMapStatus(
      placed
        ? `${placed} job(s) no mapa` + (failed ? ` · ${failed} sem localização` : "")
        : "Não foi possível localizar os jobs. Verifique os endereços.",
    );
  }

  async function load() {
    setMapStatus("A carregar…");
    const json = await api("/api/job-media/board?days=3");
    const jobs = json.data?.jobs || [];
    const feed = json.data?.feed || [];
    renderOverview(jobs);
    renderFeed(feed);
    renderJobs(jobs);
    await renderMap(jobs);
  }

  document.getElementById("jmbReload")?.addEventListener("click", () => {
    load().catch((e) => {
      if (window.crmToast?.show) window.crmToast.show(e.message || "Falha ao atualizar", { type: "error" });
    });
  });

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
