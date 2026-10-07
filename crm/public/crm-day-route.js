/**
 * Day route panel — route drawn inside ObraMate (Google Map polyline).
 * Fallbacks: OSRM geometry, then Maps Embed iframe (still in-app).
 * Includes Delivery pickup stops before each job when present.
 *
 * window.__crmDayRoute = {
 *   open({ title, subtitle, origin, stops, onSaveOrigin? }),
 *   close(),
 *   stopsFromAgendaEvents(events),
 *   stopsFromCampoJobs(jobs),
 * }
 */
(function () {
  if (window.__crmDayRoute) return;

  const CSS_HREF = "crm-day-route.css?v=20261006-route6";
  let root = null;
  let map = null;
  let routePolylines = [];
  let markers = [];
  let state = null;
  let mapsReady = null;
  let originAcAttached = false;
  let RouteClass = null;
  let mapsKey = null;
  let routeTimer = null;

  function $(sel, el) {
    return (el || document).querySelector(sel);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else if (type === "error") alert(msg);
  }

  function ensureCss() {
    if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    const base = document.querySelector('script[src*="crm-day-route"]');
    if (base && base.src) {
      try {
        link.href = new URL("../crm-day-route.css?v=20261006-route6", base.src).href;
      } catch (_) {
        link.href = "/crm-day-route.css?v=20261006-route6";
      }
    } else {
      link.href = "/crm-day-route.css?v=20261006-route6";
    }
    document.head.appendChild(link);
  }

  function nativePlaceUrl(address) {
    return "https://maps.google.com/?q=" + encodeURIComponent(address || "");
  }

  function nativeDirUrl(origin, stopAddresses) {
    const stops = (stopAddresses || []).filter(Boolean);
    if (!stops.length && !origin) return "";
    if (!origin && stops.length === 1) return nativePlaceUrl(stops[0]);
    const dest = stops[stops.length - 1] || origin;
    const mid = origin ? stops.slice(0, -1) : stops.slice(1, -1);
    const params = new URLSearchParams({ api: "1", travelmode: "driving" });
    if (origin) params.set("origin", origin);
    if (dest) params.set("destination", dest);
    if (mid.length) params.set("waypoints", mid.join("|"));
    return "https://www.google.com/maps/dir/?" + params.toString();
  }

  function kindLabel(kind) {
    if (kind === "delivery") return "Delivery";
    if (kind === "origin") return "Partida";
    if (kind === "visit") return "Visita";
    if (kind === "meeting") return "Reunião";
    return "Job";
  }

  function stopsFromAgendaEvents(events) {
    const out = [];
    (events || []).forEach((e) => {
      const m = e.meta || {};
      const needs = Boolean(e.needs_delivery || m.needs_delivery);
      const pickup = (e.delivery_pickup_address || m.delivery_pickup_address || "").trim();
      const jobAddr = (e.address || "").trim();
      const time = e.start && !e.allDay ? formatTime(e.start) : "";
      if (needs && pickup) {
        out.push({
          id: e.id + ":delivery",
          kind: "delivery",
          label: (e.title || "Job") + " · retirada",
          address: pickup,
          time,
        });
      }
      if (jobAddr) {
        out.push({
          id: e.id,
          kind: e.type === "visit" ? "visit" : e.type === "meeting" ? "meeting" : "job",
          label: e.title || "Parada",
          address: jobAddr,
          time,
        });
      }
    });
    return out;
  }

  function stopsFromCampoJobs(jobs) {
    const out = [];
    (jobs || []).forEach((j) => {
      const pickup = (j.delivery_pickup_address || "").trim();
      const jobAddr = (j.address || "").trim();
      const time = j.start_label || j.start || "";
      const title = j.title || "Obra";
      if (j.needs_delivery && pickup) {
        out.push({
          id: j.id + ":delivery",
          kind: "delivery",
          label: title + " · retirada",
          address: pickup,
          time,
        });
      }
      if (jobAddr) {
        out.push({
          id: j.id,
          kind: "job",
          label: title,
          address: jobAddr,
          time,
        });
      }
    });
    return out;
  }

  function formatTime(d) {
    try {
      const x = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(x.getTime())) return "";
      return x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch (_) {
      return "";
    }
  }

  function ensureDom() {
    if (root && document.body.contains(root)) return root;
    ensureCss();
    const wrap = document.createElement("div");
    wrap.innerHTML = `
<div class="dr-root" id="drRoot" hidden>
  <div class="dr-backdrop" data-dr-close></div>
  <div class="dr-panel" role="dialog" aria-modal="true" aria-labelledby="drTitle">
    <header class="dr-panel__hd">
      <div>
        <h2 id="drTitle">Rota do dia</h2>
        <p id="drSub"></p>
      </div>
      <button type="button" class="dr-x" data-dr-close aria-label="Fechar">×</button>
    </header>
    <div class="dr-origin">
      <label for="drOrigin">Ponto de partida</label>
      <div class="dr-origin__row">
        <span class="dr-inwrap"><input type="text" class="dr-in" id="drOrigin" maxlength="500" autocomplete="off" placeholder="Casa, depósito, escritório…" /></span>
        <button type="button" class="dr-btn" id="drSaveOrigin" title="Salvar no seu cadastro">Salvar</button>
        <button type="button" class="dr-btn dr-btn--pri" id="drGo">Traçar rota</button>
      </div>
    </div>
    <div class="dr-body">
      <aside class="dr-list" id="drList"></aside>
      <div class="dr-map-wrap">
        <div class="dr-map" id="drMap" aria-label="Mapa da rota"></div>
        <iframe class="dr-embed" id="drEmbed" title="Rota no mapa" hidden loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
        <p class="dr-hint" id="drHint">Informe a partida e toque em Traçar rota.</p>
      </div>
    </div>
    <footer class="dr-ft">
      <div class="dr-ft__sum" id="drSum"></div>
      <a class="dr-btn" id="drNative" href="#" target="_blank" rel="noopener" hidden>Abrir no app Maps</a>
      <button type="button" class="dr-btn dr-btn--ghost" data-dr-close>Fechar</button>
    </footer>
  </div>
</div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    root = document.getElementById("drRoot");
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-dr-close]")) close();
      const stop = e.target.closest("[data-dr-addr]");
      if (stop) {
        const addr = stop.getAttribute("data-dr-addr");
        if (addr) focusAddressOnMap(addr);
      }
    });
    $("#drGo", root).addEventListener("click", () => {
      drawRoute({ notifyError: true }).catch(() => {});
    });
    $("#drSaveOrigin", root).addEventListener("click", () => saveOrigin().catch((err) => notify(err.message || "Não salvou", "error")));
    $("#drOrigin", root).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        drawRoute({ notifyError: true }).catch(() => {});
      }
    });
    return root;
  }

  function setHint(text, kind) {
    const el = $("#drHint", root);
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.remove("dr-hint--ok", "dr-hint--err", "dr-hint--busy");
    if (kind) el.classList.add("dr-hint--" + kind);
  }

  function showJsMap() {
    const canvas = $("#drMap", root);
    const embed = $("#drEmbed", root);
    if (canvas) canvas.hidden = false;
    if (embed) {
      embed.hidden = true;
      embed.removeAttribute("src");
    }
  }

  function showEmbed(origin, stops) {
    const embed = $("#drEmbed", root);
    const canvas = $("#drMap", root);
    if (!embed || !mapsKey) return false;
    const dest = stops[stops.length - 1].address;
    const mid = stops
      .slice(0, -1)
      .map((s) => s.address)
      .filter(Boolean)
      .slice(0, 8);
    const params = new URLSearchParams({
      key: mapsKey,
      origin,
      destination: dest,
      mode: "driving",
    });
    if (mid.length) params.set("waypoints", mid.join("|"));
    embed.src = "https://www.google.com/maps/embed/v1/directions?" + params.toString();
    embed.hidden = false;
    if (canvas) canvas.hidden = true;
    clearMarkers();
    clearRoutePolylines();
    return true;
  }

  async function fetchMapsKey() {
    if (mapsKey) return mapsKey;
    try {
      const r = await fetch("/api/config/ui", { credentials: "include" });
      const j = await r.json();
      mapsKey = (j.data && j.data.googleMapsJsKey && String(j.data.googleMapsJsKey).trim()) || null;
    } catch (_) {
      mapsKey = null;
    }
    return mapsKey;
  }

  function mapsLoaded() {
    return !!(window.google && window.google.maps && window.google.maps.Map);
  }

  async function loadMaps() {
    if (mapsReady) return mapsReady;
    mapsReady = (async () => {
      await fetchMapsKey();
      if (!mapsLoaded()) {
        if (typeof window.sfEnsureCrmAddressAutocomplete === "function") {
          await window.sfEnsureCrmAddressAutocomplete(false);
        }
      }
      if (!mapsLoaded()) {
        const key = mapsKey || (await fetchMapsKey());
        if (!key) throw new Error("Google Maps não configurado neste ambiente.");
        await new Promise((resolve, reject) => {
          if (mapsLoaded()) {
            resolve();
            return;
          }
          const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
          if (existing) {
            let n = 0;
            const t = setInterval(() => {
              n += 1;
              if (mapsLoaded()) {
                clearInterval(t);
                resolve();
              } else if (n > 100) {
                clearInterval(t);
                reject(new Error("Timeout Google Maps"));
              }
            }, 100);
            return;
          }
          const cb = "__drMapsInit_" + Date.now();
          window[cb] = () => {
            try {
              delete window[cb];
            } catch (_) {}
            if (window.__crmGoogleMapsAuthFailed) reject(new Error("Google Maps: chave inválida ou sem billing."));
            else resolve();
          };
          const s = document.createElement("script");
          s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&libraries=places&callback=" + cb;
          s.async = true;
          s.onerror = () => reject(new Error("Falha ao carregar Google Maps"));
          document.head.appendChild(s);
        });
      }
      if (!mapsLoaded()) throw new Error("Google Maps não ficou pronto.");
      if (!RouteClass && typeof google.maps.importLibrary === "function") {
        try {
          const lib = await google.maps.importLibrary("routes");
          RouteClass = lib && lib.Route;
        } catch (_) {
          RouteClass = null;
        }
      }
      return true;
    })().catch((err) => {
      mapsReady = null;
      throw err;
    });
    return mapsReady;
  }

  async function attachOriginAutocomplete() {
    const input = $("#drOrigin", root);
    if (!input || originAcAttached) return;
    if (typeof window.sfAttachAddressAutocomplete !== "function") return;
    try {
      const ok = await window.sfAttachAddressAutocomplete(input, {
        types: ["geocode"],
        map: { combined: input },
      });
      if (ok) originAcAttached = true;
    } catch (_) {}
  }

  function clearMarkers() {
    markers.forEach((m) => {
      try {
        m.setMap(null);
      } catch (_) {}
    });
    markers = [];
  }

  function clearRoutePolylines() {
    routePolylines.forEach((p) => {
      try {
        p.setMap(null);
      } catch (_) {}
    });
    routePolylines = [];
  }

  function fitMapToPath(path) {
    if (!map || !path || !path.length) return;
    const bounds = new google.maps.LatLngBounds();
    path.forEach((pt) => bounds.extend(pt));
    if (!bounds.isEmpty()) map.fitBounds(bounds, 56);
  }

  function drawPathPolyline(path) {
    if (!map || !path || !path.length) return null;
    const poly = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: "#c1652f",
      strokeOpacity: 0.95,
      strokeWeight: 6,
      map,
      zIndex: 2,
    });
    routePolylines.push(poly);
    return poly;
  }

  function placeMarker(item) {
    if (!map || !item || !item.latLng) return null;
    const m = new google.maps.Marker({
      map,
      position: item.latLng,
      label: item.origin ? "P" : String(item.label || ""),
      title: item.address || "",
      zIndex: item.origin ? 3 : 2,
    });
    markers.push(m);
    return m;
  }

  function geocodeOne(address) {
    return new Promise((resolve) => {
      if (!address) return resolve(null);
      if (!window.google || !google.maps || !google.maps.Geocoder) return resolve(null);
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === "OK" && results && results[0] && results[0].geometry) {
          resolve(results[0].geometry.location);
        } else resolve(null);
      });
    });
  }

  async function geocodePhoton(address) {
    try {
      const url =
        "https://photon.komoot.io/api/?q=" + encodeURIComponent(address) + "&limit=1&lang=en";
      const r = await fetch(url);
      const j = await r.json();
      const f = j && j.features && j.features[0];
      const c = f && f.geometry && f.geometry.coordinates;
      if (!c || c.length < 2) return null;
      return { lat: c[1], lng: c[0] };
    } catch (_) {
      return null;
    }
  }

  async function resolveLatLng(address) {
    let loc = await geocodeOne(address);
    if (loc) return { lat: loc.lat(), lng: loc.lng(), latLng: loc };
    const ph = await geocodePhoton(address);
    if (!ph) return null;
    const latLng = mapsLoaded() ? new google.maps.LatLng(ph.lat, ph.lng) : null;
    return { lat: ph.lat, lng: ph.lng, latLng };
  }

  async function resolveAllPoints(origin, stops) {
    const items = [];
    const o = await resolveLatLng(origin);
    if (!o) throw new Error("Não localizamos o ponto de partida. Confira o endereço.");
    items.push({ origin: true, label: "P", address: origin, ...o });
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const p = await resolveLatLng(s.address);
      if (!p) throw new Error("Não localizamos: " + (s.label || s.address));
      items.push({ origin: false, label: String(i + 1), address: s.address, kind: s.kind, ...p });
    }
    return items;
  }

  function focusAddressOnMap(address) {
    const hit = markers.find((m) => (m.getTitle && m.getTitle()) === address);
    if (hit && map) {
      showJsMap();
      map.panTo(hit.getPosition());
      map.setZoom(Math.max(map.getZoom() || 12, 14));
      return;
    }
    // Fallback: open place only if map markers missing.
    window.open(nativePlaceUrl(address), "_blank", "noopener");
  }

  function plotResolvedMarkers(points) {
    clearMarkers();
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => {
      placeMarker(p);
      if (p.latLng) bounds.extend(p.latLng);
      else bounds.extend({ lat: p.lat, lng: p.lng });
    });
    if (map && !bounds.isEmpty()) map.fitBounds(bounds, 56);
  }

  async function routeViaGoogle(points) {
    if (!RouteClass) throw new Error("Routes API indisponível");
    const origin = points[0].latLng || { lat: points[0].lat, lng: points[0].lng };
    const dest = points[points.length - 1].latLng || {
      lat: points[points.length - 1].lat,
      lng: points[points.length - 1].lng,
    };
    const intermediates = points.slice(1, -1).map((p) => ({
      location: p.latLng || { lat: p.lat, lng: p.lng },
    }));
    const request = {
      origin,
      destination: dest,
      travelMode: "DRIVING",
      fields: ["path", "legs", "distanceMeters", "durationMillis"],
    };
    if (intermediates.length) request.intermediates = intermediates;

    if (routeTimer) clearTimeout(routeTimer);
    const result = await Promise.race([
      RouteClass.computeRoutes(request),
      new Promise((_, reject) => {
        routeTimer = setTimeout(() => reject(new Error("Tempo esgotado ao calcular a rota.")), 20000);
      }),
    ]);
    if (routeTimer) {
      clearTimeout(routeTimer);
      routeTimer = null;
    }
    const route = result && result.routes && result.routes[0];
    if (!route || !route.path || !route.path.length) throw new Error("Sem path da rota");
    return {
      path: route.path,
      meters: route.distanceMeters || 0,
      millis: route.durationMillis || 0,
      route,
    };
  }

  async function routeViaOsrm(points) {
    const coords = points.map((p) => p.lng + "," + p.lat).join(";");
    const url =
      "https://router.project-osrm.org/route/v1/driving/" +
      coords +
      "?overview=full&geometries=geojson";
    const r = await fetch(url);
    if (!r.ok) throw new Error("OSRM HTTP " + r.status);
    const j = await r.json();
    if (j.code !== "Ok" || !j.routes || !j.routes[0]) throw new Error("OSRM sem rota");
    const route = j.routes[0];
    const path = (route.geometry.coordinates || []).map((c) => ({ lat: c[1], lng: c[0] }));
    if (!path.length) throw new Error("OSRM path vazio");
    return { path, meters: route.distance || 0, millis: (route.duration || 0) * 1000 };
  }

  function routeErrorMessage(err) {
    const raw = String((err && (err.message || err.status || err)) || "");
    if (/zero_results|not_found|no route|nenhuma rota|não achamos|sem path|osrm sem/i.test(raw)) {
      return "Não achamos rota de carro entre esses pontos.";
    }
    if (/request_denied|permission|not enabled|routes api|billing/i.test(raw)) {
      return "Não foi possível usar a Routes API — tentamos desenhar a rota de outro jeito.";
    }
    if (/tempo esgotado/i.test(raw)) return raw;
    if (/não localizamos/i.test(raw)) return raw;
    if (!raw || raw === "[object Object]" || /toque num endereço|rota pronta/i.test(raw)) {
      return "Falha ao calcular a rota.";
    }
    return raw.length > 160 ? "Falha ao calcular a rota." : raw;
  }

  function formatSum(meters, millis) {
    const km = (meters || 0) / 1000;
    const mins = Math.max(1, Math.round((millis || 0) / 60000));
    const hm = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    return `Rota · ${km < 10 ? km.toFixed(1) : Math.round(km)} km · ${hm}`;
  }

  function renderList() {
    const list = $("#drList", root);
    const origin = ($("#drOrigin", root).value || "").trim();
    const stops = state.stops || [];
    let html = "";
    if (origin) {
      html += `<button type="button" class="dr-stop dr-stop--origin" data-dr-addr="${esc(origin)}"><span class="dr-stop__kind">Partida</span><b>Início</b><small>${esc(origin)}</small></button>`;
    }
    if (!stops.length) {
      html += '<p class="dr-empty">Nenhuma parada com endereço neste dia.</p>';
    } else {
      stops.forEach((s, i) => {
        const cls = s.kind === "delivery" ? " dr-stop--delivery" : "";
        html += `<button type="button" class="dr-stop${cls}" data-dr-addr="${esc(s.address)}"><span class="dr-stop__kind">${esc(kindLabel(s.kind))}</span><b>${i + 1}. ${esc(s.label)}</b><small>${s.time ? esc(s.time) + " · " : ""}${esc(s.address)}</small></button>`;
      });
    }
    list.innerHTML = html;
  }

  function updateNativeLink(origin, stops) {
    const a = $("#drNative", root);
    const addrs = stops.map((s) => s.address).filter(Boolean);
    const href = nativeDirUrl(origin, addrs);
    if (!href) {
      a.hidden = true;
      a.removeAttribute("href");
      return;
    }
    a.hidden = false;
    a.href = href;
  }

  async function saveOrigin() {
    const address = ($("#drOrigin", root).value || "").trim();
    const r = await fetch("/api/auth/route-start", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: address || null }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || "Não foi possível salvar");
    state.origin = address;
    if (typeof state.onSaveOrigin === "function") state.onSaveOrigin(address);
    notify(address ? "Ponto de partida salvo no cadastro." : "Ponto de partida removido.", "success");
  }

  function ensureMapCanvas() {
    showJsMap();
    const canvas = $("#drMap", root);
    if (!map) {
      map = new google.maps.Map(canvas, {
        zoom: 11,
        center: { lat: 30.27, lng: -97.74 },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
      });
    }
    refreshMapSize();
  }

  function refreshMapSize() {
    if (!map) return;
    try {
      google.maps.event.trigger(map, "resize");
    } catch (_) {}
  }

  async function drawRoute(opts) {
    opts = opts || {};
    const origin = ($("#drOrigin", root).value || "").trim();
    const stops = (state.stops || []).filter((s) => s.address);
    state.origin = origin;
    renderList();
    updateNativeLink(origin, stops);
    setHint("Calculando rota no mapa…", "busy");
    $("#drSum", root).textContent = "";

    if (!stops.length) {
      setHint("Sem endereços para traçar.", "err");
      return;
    }
    if (!origin) {
      setHint("Informe o ponto de partida para ver a rota no mapa.", "err");
      if (opts.notifyError) notify("Informe o ponto de partida.", "error");
      return;
    }

    try {
      await loadMaps();
      ensureMapCanvas();
      // Wait a tick so the panel has real size before drawing.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
      refreshMapSize();

      const points = await resolveAllPoints(origin, stops);
      clearRoutePolylines();
      plotResolvedMarkers(points);

      let drawn = null;
      // 1) Google Routes API (preferred)
      try {
        drawn = await routeViaGoogle(points);
      } catch (_) {
        drawn = null;
      }
      // 2) OSRM geometry — still drawn inside our map
      if (!drawn) {
        try {
          drawn = await routeViaOsrm(points);
        } catch (_) {
          drawn = null;
        }
      }

      if (drawn && drawn.path && drawn.path.length) {
        showJsMap();
        clearRoutePolylines();
        drawPathPolyline(drawn.path);
        fitMapToPath(drawn.path);
        plotResolvedMarkers(points);
        refreshMapSize();
        $("#drSum", root).textContent = formatSum(drawn.meters, drawn.millis);
        setHint("Rota desenhada no mapa.", "ok");
        return;
      }

      // 3) Maps Embed iframe — still inside ObraMate
      if (showEmbed(origin, stops)) {
        $("#drSum", root).textContent = "Rota no mapa";
        setHint("Rota exibida no mapa embutido.", "ok");
        return;
      }

      throw new Error("Não foi possível desenhar a rota no mapa.");
    } catch (err) {
      if (routeTimer) {
        clearTimeout(routeTimer);
        routeTimer = null;
      }
      const msg = routeErrorMessage(err);
      // Last resort: embed if we have a key
      if (showEmbed(origin, stops)) {
        $("#drSum", root).textContent = "Rota no mapa";
        setHint("Rota exibida no mapa embutido.", "ok");
        return;
      }
      setHint(msg, "err");
      $("#drSum", root).textContent = "";
      updateNativeLink(origin, stops);
      if (opts.notifyError) notify(msg, "error");
    }
  }

  async function open(opts) {
    opts = opts || {};
    ensureDom();
    state = {
      title: opts.title || "Rota do dia",
      subtitle: opts.subtitle || "",
      origin: opts.origin || "",
      stops: Array.isArray(opts.stops) ? opts.stops : [],
      onSaveOrigin: opts.onSaveOrigin || null,
    };
    root.hidden = false;
    document.body.style.overflow = "hidden";
    $("#drTitle", root).textContent = state.title;
    $("#drSub", root).textContent = state.subtitle || "";
    $("#drOrigin", root).value = state.origin || "";
    $("#drSum", root).textContent = "";
    setHint("Calculando rota no mapa…", "busy");
    renderList();
    updateNativeLink(state.origin, state.stops);
    showJsMap();

    const acPromise = attachOriginAutocomplete();

    try {
      await loadMaps();
      ensureMapCanvas();
      await acPromise;
      await new Promise((r) => setTimeout(r, 100));
      refreshMapSize();
      if (state.origin && state.stops.length) await drawRoute({ notifyError: false });
      else {
        setHint("Informe a partida e toque em Traçar rota.", "busy");
        if (state.stops.length) {
          try {
            const pts = [];
            for (let i = 0; i < state.stops.length; i++) {
              const p = await resolveLatLng(state.stops[i].address);
              if (p) pts.push({ origin: false, label: String(i + 1), address: state.stops[i].address, ...p });
            }
            if (pts.length) plotResolvedMarkers(pts);
          } catch (_) {}
        }
      }
    } catch (err) {
      setHint(routeErrorMessage(err) || "Mapa indisponível.", "err");
      updateNativeLink(state.origin, state.stops);
      await acPromise.catch(() => {});
    }
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    document.body.style.overflow = "";
    const embed = $("#drEmbed", root);
    if (embed) {
      embed.hidden = true;
      embed.removeAttribute("src");
    }
  }

  window.__crmDayRoute = {
    open,
    close,
    stopsFromAgendaEvents,
    stopsFromCampoJobs,
  };
})();
