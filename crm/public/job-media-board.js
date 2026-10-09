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
  };

  let jobs = [];
  let feed = [];
  let mode = "active";
  let q = "";
  let selId = null;
  let stageFilter = "all";
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
    const d = fmtDist(p.distance_m);
    return `<span class="cam-tag">${SVG.pin}${d ? esc(d) : "GPS"}</span>`;
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
    return norm([j.number, j.title, j.address, j.client_name, statusLabel(j.status), ...(j.photos || []).map((p) => p.author_name)].filter(Boolean).join(" ")).includes(q);
  }

  function rowSub(j) {
    const st = isActive(j) && !j.scheduled_start ? "Sem data" : statusLabel(j.status);
    if (!j.last_photo) return { text: `${st} · nenhuma foto`, hot: needsPhoto(j) && !!j.scheduled_start };
    return { text: `${st} · última ${ago(j.last_photo.created_at)}`, hot: needsPhoto(j) };
  }

  function rowHtml(j) {
    const last = j.last_photo;
    const th = last ? `<span class="cam-row__th" style="background-image:url('${esc(last.url)}')"></span>` : `<span class="cam-row__th is-empty">${SVG.cam}</span>`;
    const sub = rowSub(j);
    const n = j.photo_count != null ? j.photo_count : (j.photos || []).length;
    return `<a class="cam-row${String(j.id) === String(selId) && mode !== "photos" ? " is-on" : ""}" href="job-detail.html?id=${encodeURIComponent(j.id)}#fotos" data-cam-id="${esc(j.id)}">
      ${th}
      <span class="cam-row__b"><b>${esc(j.title || "Job")}</b><small class="${sub.hot ? "is-hot" : ""}">${esc(sub.text)}</small></span>
      ${n ? `<em>${n} foto${n === 1 ? "" : "s"}</em>` : ""}
    </a>`;
  }

  function groups() {
    const hit = jobs.filter(jobHit);
    if (mode === "done") {
      const done = hit.filter((j) => j.status === "completed").sort((a, b) => new Date(b.last_photo?.created_at || 0) - new Date(a.last_photo?.created_at || 0));
      return [["Concluídos", done]];
    }
    const act = hit.filter(isActive);
    const g = [
      ["Precisa de foto", act.filter((j) => needsPhoto(j) && j.scheduled_start)],
      ["Em dia", act.filter((j) => !needsPhoto(j))],
      ["Sem data", act.filter((j) => needsPhoto(j) && !j.scheduled_start)],
    ];
    if (mode === "photos") g.push(["Concluídos", hit.filter((j) => j.status === "completed")]);
    return g;
  }

  function renderList() {
    const active = jobs.filter(isActive);
    const done = jobs.filter((j) => j.status === "completed");
    const need = active.filter(needsPhoto).length;
    const recent = feed.filter((p) => new Date(p.created_at).getTime() >= Date.now() - FEED_DAYS * 86400000);
    const noGps = feed.filter((p) => !hasGps(p)).length;
    $("camJobsN").textContent = `${jobs.length} job${jobs.length === 1 ? "" : "s"}`;
    $("camStats").innerHTML = `<span><b>${recent.length}</b> foto${recent.length === 1 ? "" : "s"} · ${FEED_DAYS} dias</span><span><b class="${need ? "is-hot" : ""}">${need}</b> sem foto 3+ dias</span><span><b>${noGps}</b> sem GPS</span>`;
    document.querySelectorAll("#camMode [data-mode]").forEach((b) => {
      const m = b.getAttribute("data-mode");
      b.classList.toggle("is-on", m === mode);
      b.innerHTML = m === "active" ? `Ativos <em>${active.length}</em>` : m === "done" ? `Concluídos <em>${done.length}</em>` : "Todas as fotos";
    });
    const html = groups()
      .filter(([, rows]) => rows.length)
      .map(([label, rows]) => `<p class="cam-grp"><span>${label}</span><em>${rows.length}</em></p>${rows.map(rowHtml).join("")}`)
      .join("");
    $("camRows").innerHTML = html || `<p class="cam-empty">${q ? "Nenhum job com essa busca." : mode === "done" ? "Nenhum job concluído." : "Nenhum job ativo."}</p>`;
  }

  /** Abre primeiro um job que tenha fotos (senão o primeiro da lista). */
  function firstVisibleId() {
    const rows = [...$("camRows").querySelectorAll("[data-cam-id]")].map((a) => a.getAttribute("data-cam-id"));
    const withPhotos = rows.find((id) => (jobs.find((j) => String(j.id) === id) || {}).last_photo);
    return withPhotos || rows[0] || null;
  }

  // ---------------------------------------------------------------- visualizador
  function toViewer(j, p) {
    return {
      id: p.legacy ? null : p.id, url: p.url, thumb_url: p.thumb_url || p.url, stage: p.stage, created_at: p.created_at, taken_at_device: p.taken_at_device,
      author: p.author_name, device: p.device_label, caption: p.caption, address: p.address || j.address, lat: p.lat, lng: p.lng,
      location_available: p.location_available != null ? p.location_available : p.lat != null, distance_m: p.distance_m, far_from_job: p.far_from_job,
      in_portfolio: p.in_portfolio, job: { id: j.id, number: j.number, title: j.title, client: j.client_name },
    };
  }

  function openViewer(list, index) {
    if (!window.CamViewer || !list.length) return;
    window.CamViewer.open({
      photos: list,
      index,
      canPortfolio: canManage,
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
    });
  }

  function photoTile(p, i, opts) {
    const st = STAGE[p.stage] || "Geral";
    return `<button type="button" class="cam-ph" data-ph-i="${i}" aria-label="Ver foto" style="background-image:url('${esc(p.thumb_url || p.url)}')">
      ${opts && opts.stage ? `<span class="cam-ph__st">${esc(st)}</span>` : ""}
      ${opts && opts.job ? `<span class="cam-ph__jn">#${esc(p.job_number ?? "—")}</span>` : ""}
      ${gpsTag(p)}
    </button>`;
  }

  // ---------------------------------------------------------------- job aberto
  function headHtml(j, list) {
    const n = list ? list.length : j.photo_count || 0;
    const authors = list ? [...new Set(list.map((p) => p.author_name).filter(Boolean))] : [];
    const st = j.status === "in_progress" ? "dk" : j.status === "completed" ? "ol" : "";
    const lastTxt = j.last_photo ? `Última foto ${ago(j.last_photo.created_at)}` : "Nenhuma foto";
    const meta = [j.client_name ? esc(j.client_name) : "", j.address ? `${SVG.pin}${esc(j.address)}` : "", `${n} foto${n === 1 ? "" : "s"}`, authors.length ? `por ${esc(authors.slice(0, 3).join(", "))}` : ""].filter(Boolean);
    return `<a class="cam-back" href="#" data-cam-back>${SVG.back}ObraCam</a>
      <div class="cam-dh">
        <div class="cam-dh__t">
          <div class="cam-chips"><span class="cam-pill${st ? ` cam-pill--${st}` : ""}">${esc(statusLabel(j.status))}</span><span class="cam-pill${needsPhoto(j) ? " cam-pill--hot" : ""}">${esc(lastTxt)}</span>${j.number != null ? `<span class="cam-num">Job #${esc(j.number)}</span>` : ""}</div>
          <h2><a href="job-detail.html?id=${encodeURIComponent(j.id)}">${esc(j.title || "Job")}</a></h2>
          <p class="cam-dmeta">${meta.map((x) => `<span>${x}</span>`).join("")}</p>
        </div>
        <div class="cam-dh__acts">
          <a class="cam-btn" href="job-detail.html?id=${encodeURIComponent(j.id)}#fotos">${SVG.cam}Adicionar fotos</a>
          <a class="cam-btn cam-btn--pri" href="job-detail.html?id=${encodeURIComponent(j.id)}">Abrir job</a>
        </div>
      </div>`;
  }

  function pbarHtml(j) {
    return `<div class="cam-pbar" id="camPbar"><a class="cam-btn" href="job-detail.html?id=${encodeURIComponent(j.id)}">Abrir job</a><a class="cam-btn cam-btn--pri" href="job-detail.html?id=${encodeURIComponent(j.id)}#fotos">${SVG.cam}Tirar foto</a></div>`;
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
    const list = mediaCache[j.id];
    const counts = { before: 0, during: 0, after: 0, none: 0 };
    list.forEach((p) => (counts[STAGE[p.stage] ? p.stage : "none"] += 1));
    shown = list.map((p) => toViewer(j, p));
    const mapBox = `<div class="cam-box cam-box--map"><h3>Onde foram tiradas</h3><div class="cam-map" id="camMap"></div><p class="cam-meta" id="camMapNote"></p></div>`;
    let body;
    if (!list.length) {
      body = `<div class="cam-box cam-none"><span class="cam-none__ic">${SVG.cam}</span><b>Nenhuma foto ainda</b><p>A equipe tira as fotos pelo Campo (ticket do job). Você também pode adicionar pela página do job.</p><a class="cam-btn" href="job-detail.html?id=${encodeURIComponent(j.id)}#fotos">Adicionar fotos</a></div>`;
    } else if (isPhone()) {
      const segs = [["all", "Todas", list.length], ...STAGES.filter(([k]) => counts[k]).map(([k, l]) => [k, l, counts[k]])];
      if (!segs.some(([k]) => k === stageFilter)) stageFilter = "all";
      const sel = list.map((p, i) => [p, i]).filter(([p]) => stageFilter === "all" || (stageFilter === "none" ? !STAGE[p.stage] : p.stage === stageFilter));
      body = `<div class="cam-pseg">${segs.map(([k, l, n]) => `<button type="button" class="${k === stageFilter ? "is-on" : ""}" data-stage="${k}">${l} <em>${n}</em></button>`).join("")}</div>
        <div class="cam-pgrid">${sel.map(([p, i]) => photoTile(p, i, { stage: stageFilter === "all" })).join("")}</div>${mapBox}`;
    } else {
      const cols = STAGES.filter(([k]) => k !== "none" || counts.none)
        .map(([k, l]) => {
          const items = list.map((p, i) => [p, i]).filter(([p]) => (k === "none" ? !STAGE[p.stage] : p.stage === k));
          return `<div class="cam-col"><h4>${l}<em>${items.length}</em></h4>${items.length ? `<div class="cam-col__g">${items.map(([p, i]) => photoTile(p, i)).join("")}</div>` : `<p class="cam-col__none">Sem fotos</p>`}</div>`;
        })
        .join("");
      body = `<div class="cam-body"><div class="cam-box"><div class="cam-cols" style="--cam-cols:${counts.none ? 4 : 3}">${cols}</div></div>${mapBox}</div>`;
    }
    host.innerHTML = headHtml(j, list) + body + (isPhone() ? pbarHtml(j) : "");
    movePbar();
    if (list.length) renderJobMap(j, list).catch(() => {});
  }

  // ---------------------------------------------------------------- todas as fotos
  function renderFeed() {
    const host = $("camDetail");
    const hit = feed.filter((p) => {
      if (stageFilter !== "all" && (STAGE[p.stage] ? p.stage : "none") !== stageFilter) return false;
      if (!q) return true;
      return norm([p.job_number, p.job_title, STAGE[p.stage], p.caption, p.address, p.author_name].filter(Boolean).join(" ")).includes(q);
    });
    const counts = { all: feed.length, before: 0, during: 0, after: 0, none: 0 };
    feed.forEach((p) => (counts[STAGE[p.stage] ? p.stage : "none"] += 1));
    shown = hit.map((p) => toViewer({ id: p.job_id, number: p.job_number, title: p.job_title, client_name: (jobs.find((x) => x.id === p.job_id) || {}).client_name }, p));
    const days = [];
    hit.forEach((p, i) => {
      const k = dayKey(p.created_at);
      let d = days.find((x) => x.k === k);
      if (!d) days.push((d = { k, label: dayLabel(p.created_at), items: [], jobs: new Set() }));
      d.items.push([p, i]);
      d.jobs.add(p.job_id);
    });
    const chips = [["all", "Todas"], ["before", "Antes"], ["during", "Durante"], ["after", "Depois"], ["none", "Geral"]]
      .filter(([k]) => k === "all" || counts[k])
      .map(([k, l]) => `<button type="button" class="cam-chip${stageFilter === k ? " is-on" : ""}" data-stage="${k}">${l} <em>${counts[k]}</em></button>`)
      .join("");
    const grid = days.length
      ? days
          .map(
            (d) =>
              `<p class="cam-day">${esc(d.label)}<em>${d.items.length} foto${d.items.length === 1 ? "" : "s"} · ${d.jobs.size} job${d.jobs.size === 1 ? "" : "s"}</em></p><div class="cam-feedg">${d.items.map(([p, i]) => photoTile(p, i, { stage: true, job: true })).join("")}</div>`,
          )
          .join("")
      : `<p class="cam-empty">${q || stageFilter !== "all" ? "Nenhuma foto com esse filtro." : "Ainda sem fotos."}</p>`;
    host.innerHTML = `<a class="cam-back" href="#" data-cam-back>${SVG.back}ObraCam</a>
      <div class="cam-dh"><div class="cam-dh__t"><h2>Todas as fotos</h2><p class="cam-dmeta"><span>${feed.length} mais recentes de todos os jobs</span></p></div></div>
      <div class="cam-chips cam-chips--bar">${chips}</div>
      <div class="cam-body"><div class="cam-box">${grid}</div>
      <div class="cam-box cam-box--map"><h3>Mapa dos jobs</h3><div class="cam-map" id="camMap"></div><p class="cam-meta" id="camMapNote"></p></div></div>`;
    movePbar();
    renderAllMap().catch(() => {});
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
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19 }).addTo(map);
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
    renderList();
    const narrow = !isWide();
    const open = narrow && (!!id || mode === "photos");
    $("camSplit").classList.toggle("is-detail", open);
    document.body.classList.toggle("cam-detail-open", open);
    renderRight();
    if (push) {
      try {
        const u = new URL(location.href);
        if (id) u.searchParams.set("id", id);
        else u.searchParams.delete("id");
        history.replaceState(null, "", u);
      } catch (_) {}
    }
    if (narrow) window.scrollTo(0, 0);
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

  function bind() {
    $("camMode").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (!b) return;
      mode = b.getAttribute("data-mode");
      stageFilter = "all";
      if (mode === "photos") {
        select(null, true);
        return;
      }
      selId = null;
      renderList();
      if (isWide()) {
        selId = firstVisibleId();
        renderList();
        renderRight();
      }
    });
    $("camRows").addEventListener("click", (e) => {
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
        if (mode === "photos") renderFeed();
      }, 160);
    });
    $("camDetail").addEventListener("click", (e) => {
      if (e.target.closest("[data-cam-back]")) {
        e.preventDefault();
        back();
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
    window.addEventListener("resize", () => {
      if (isWide() && document.body.classList.contains("cam-detail-open")) {
        $("camSplit").classList.remove("is-detail");
        document.body.classList.remove("cam-detail-open");
        movePbar();
      }
    });
  }

  bind();
  fetch("/api/auth/session", { credentials: "include" })
    .then((r) => r.json())
    .then((s) => {
      const perms = s?.user?.permissions || [];
      canManage = s?.user?.role === "admin" || perms.includes("work_orders.manage");
    })
    .catch(() => {});
  load().catch((e) => {
    $("camRows").innerHTML = `<p class="cam-empty">${esc(e.message || "Falha ao carregar")}</p>`;
    $("camDetail").innerHTML = "";
  });
})();
