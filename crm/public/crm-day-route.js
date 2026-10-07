/**
 * Day route panel — embedded Google Directions + native Maps link.
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

  const CSS_HREF = "crm-day-route.css?v=20261006-route5";
  let root = null;
  let map = null;
  let routePolylines = [];
  let markers = [];
  let state = null;
  let mapsReady = null;
  let originAcAttached = false;
  let RouteClass = null;
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
    link.href = CSS_HREF.startsWith("/") || CSS_HREF.startsWith("http") ? CSS_HREF : `/` + CSS_HREF.replace(/^\//, "");
    // Prefer relative to current page folder for Campo (/campo/)
    const base = document.querySelector('script[src*="crm-day-route"]');
    if (base && base.src) {
      try {
        link.href = new URL("../crm-day-route.css?v=20261006-route5", base.src).href;
      } catch (_) {
        link.href = "/crm-day-route.css?v=20261006-route5";
      }
    } else {
      link.href = "/crm-day-route.css?v=20261006-route5";
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

  /** Expand agenda events into ordered stops (Delivery before job when set). */
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
        <p class="dr-hint" id="drHint">Informe a partida e toque em Traçar rota.</p>
      </div>
    </div>
    <footer class="dr-ft">
      <div class="dr-ft__sum" id="drSum"></div>
      <a class="dr-btn" id="drNative" href="#" target="_blank" rel="noopener" hidden>Abrir no Maps</a>
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
        if (addr) window.open(nativePlaceUrl(addr), "_blank", "noopener");
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

  function mapsLoaded() {
    return !!(window.google && window.google.maps && window.google.maps.Map && typeof window.google.maps.importLibrary === "function");
  }

  async function loadMaps() {
    if (mapsReady) return mapsReady;
    mapsReady = (async () => {
      if (!mapsLoaded()) {
        // Prefer shared loader (Places + auth hook) when available.
        if (typeof window.sfEnsureCrmAddressAutocomplete === "function") {
          await window.sfEnsureCrmAddressAutocomplete(false);
        }
      }
      if (!mapsLoaded()) {
        let key = null;
        try {
          const r = await fetch("/api/config/ui", { credentials: "include" });
          const j = await r.json();
          key = (j.data && j.data.googleMapsJsKey && String(j.data.googleMapsJsKey).trim()) || null;
        } catch (_) {
          key = null;
        }
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
      // Routes library (replaces legacy DirectionsService / Directions API).
      if (!RouteClass) {
        try {
          const lib = await google.maps.importLibrary("routes");
          RouteClass = lib && lib.Route;
        } catch (err) {
          throw new Error(
            "Ative a Routes API no Google Cloud (não a Directions antiga). " +
              ((err && err.message) || ""),
          );
        }
      }
      if (!RouteClass) throw new Error("Routes API indisponível — ative Routes API no Google Cloud.");
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

  function plotStopMarkers(origin, stops) {
    clearMarkers();
    if (!map || !window.google || !google.maps.Geocoder) return;
    const geocoder = new google.maps.Geocoder();
    const bounds = new google.maps.LatLngBounds();
    const addrs = [];
    if (origin) addrs.push({ label: "Partida", address: origin, origin: true });
    (stops || []).forEach((s, i) => addrs.push({ label: String(i + 1), address: s.address, origin: false }));
    addrs.forEach((item) => {
      geocoder.geocode({ address: item.address }, (results, status) => {
        if (status !== "OK" || !results || !results[0]) return;
        const loc = results[0].geometry.location;
        const m = new google.maps.Marker({
          map,
          position: loc,
          label: item.origin ? "P" : item.label,
          title: item.address,
        });
        markers.push(m);
        bounds.extend(loc);
        if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
      });
    });
  }

  function routeErrorMessage(err) {
    const raw = String((err && (err.message || err.status || err)) || "");
    const lower = raw.toLowerCase();
    if (/zero_results|not_found|no route|nenhuma rota|não achamos/i.test(raw) || lower.includes("zero_results")) {
      return "Não achamos rota de carro entre esses pontos.";
    }
    if (/request_denied|permission|not enabled|has not been used|api.*disabled|billing|routes api/i.test(raw)) {
      return "Ative a Routes API no Google Cloud e permita-a na chave Maps.";
    }
    if (/over_query|quota|rate/i.test(raw)) return "Limite da API de rotas atingido. Tente de novo em instantes.";
    if (/invalid_request|invalid argument/i.test(raw)) return "Endereço de partida ou paradas inválidos.";
    if (/tempo esgotado/i.test(raw)) return raw;
    // Avoid dumping opaque Google objects / stacking our own tip text as "Erro".
    if (!raw || raw === "[object Object]" || /toque num endereço/i.test(raw)) {
      return "Falha ao calcular a rota.";
    }
    return raw.length > 180 ? "Falha ao calcular a rota." : raw;
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
    if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
  }

  function drawPathPolyline(path) {
    if (!map || !path || !path.length) return null;
    const poly = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: "#c1652f",
      strokeOpacity: 0.9,
      strokeWeight: 5,
      map,
    });
    routePolylines.push(poly);
    return poly;
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
    const canvas = $("#drMap", root);
    if (!map) {
      // No mapId — keeps classic Marker + Polyline working without Advanced Markers.
      map = new google.maps.Map(canvas, {
        zoom: 11,
        center: { lat: 30.27, lng: -97.74 },
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
    } else {
      try {
        google.maps.event.trigger(map, "resize");
      } catch (_) {}
    }
  }

  async function drawRoute(opts) {
    opts = opts || {};
    const origin = ($("#drOrigin", root).value || "").trim();
    const stops = (state.stops || []).filter((s) => s.address);
    state.origin = origin;
    renderList();
    updateNativeLink(origin, stops);
    setHint("Calculando rota…", "busy");
    $("#drSum", root).textContent = "";

    if (!stops.length) {
      setHint("Sem endereços para traçar.", "err");
      return;
    }
    if (!origin) {
      setHint("Informe o ponto de partida para a rota de carro.", "err");
      if (opts.notifyError) notify("Informe o ponto de partida.", "error");
      return;
    }

    try {
      await loadMaps();
      ensureMapCanvas();
      clearMarkers();
      clearRoutePolylines();

      const dest = stops[stops.length - 1].address;
      const intermediates = stops.slice(0, -1).map((s) => ({ location: s.address }));
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
      if (!route) throw new Error("Não achamos rota de carro entre esses pontos.");

      let drew = false;
      try {
        const polys =
          (route.createPolylines &&
            route.createPolylines({
              polylineOptions: { strokeColor: "#c1652f", strokeWeight: 5, strokeOpacity: 0.9 },
            })) ||
          [];
        polys.forEach((p) => {
          p.setMap(map);
          routePolylines.push(p);
          drew = true;
        });
      } catch (_) {
        drew = false;
      }
      if (!drew && route.path && route.path.length) {
        drawPathPolyline(route.path);
        drew = true;
      }
      if (!drew) throw new Error("Rota calculada, mas o mapa não desenhou o trajeto.");

      if (route.path && route.path.length) fitMapToPath(route.path);
      try {
        plotStopMarkers(origin, stops);
      } catch (_) {}

      const meters = route.distanceMeters || 0;
      const mins = Math.round((route.durationMillis || 0) / 60000);
      const km = meters / 1000;
      const hm = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.max(1, mins)} min`;
      $("#drSum", root).textContent = `Rota · ${km < 10 ? km.toFixed(1) : Math.round(km)} km · ${hm}`;
      setHint("Rota pronta. Toque num endereço para abrir no Maps.", "ok");
    } catch (err) {
      if (routeTimer) {
        clearTimeout(routeTimer);
        routeTimer = null;
      }
      const msg = routeErrorMessage(err);
      setHint(msg + " Use Abrir no Maps.", "err");
      $("#drSum", root).textContent = "";
      updateNativeLink(origin, stops);
      try {
        ensureMapCanvas();
        clearRoutePolylines();
        plotStopMarkers(origin, stops);
      } catch (_) {}
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
    setHint("Informe a partida e toque em Traçar rota.", "busy");
    renderList();
    updateNativeLink(state.origin, state.stops);

    const acPromise = attachOriginAutocomplete();

    try {
      await loadMaps();
      ensureMapCanvas();
      setTimeout(() => {
        try {
          google.maps.event.trigger(map, "resize");
        } catch (_) {}
      }, 80);
      await acPromise;
      if (state.origin && state.stops.length) await drawRoute({ notifyError: false });
      else if (state.stops.length) plotStopMarkers("", state.stops);
    } catch (err) {
      setHint(routeErrorMessage(err) || "Mapa indisponível — use Abrir no Maps.", "err");
      updateNativeLink(state.origin, state.stops);
      await acPromise.catch(() => {});
    }
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    document.body.style.overflow = "";
  }

  window.__crmDayRoute = {
    open,
    close,
    stopsFromAgendaEvents,
    stopsFromCampoJobs,
  };
})();
