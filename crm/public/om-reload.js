/**
 * ObraMate — animação "Montagem" com o símbolo + nome da marca.
 *  - Abrir app / puxar-para-atualizar: sequência completa (peças + “ObraMate”)
 *  - Mudança de página: véu rápido (mais fluido)
 * Carregar logo depois de <body>: <script src="/om-reload.js?v=…"></script>
 */
(function (g) {
  "use strict";
  if (g.OmReload) return;

  const ORANGE = "#E7792C";
  const PIECES = [
    { pts: "112,112 361,112 302,157 159,158 158,337 112,297", dx: -71, dy: -71 },
    { pts: "112,353 334,354 285,399 112,399", dx: 0, dy: 100 },
    { pts: "398,113 399,398 356,353 354,207 263,281 193,281", dx: 71, dy: -71 },
  ];

  const MARK_SIZE = 92;
  /** Sequência completa (abrir app + reload). */
  const FULL_WORD_AT_MS = 700;
  const FULL_MIN_MS = 1900;
  const FULL_MIN_REDUCED_MS = 500;
  /** Mudança de página — curta e fluida. */
  const NAV_MIN_MS = 320;
  const NAV_MIN_REDUCED_MS = 120;
  const NAV_SHOW_DELAY_MS = 0;
  const FADE_OUT_MS = 320;

  const CSS = `
.om-rl{display:block;overflow:visible}
.om-rl > polygon{fill:${ORANGE};transform:translate(var(--dx),var(--dy));opacity:0}
.om-rl.is-in > polygon{animation:omRlIn var(--rl-dur,1.1s) cubic-bezier(.34,1.56,.64,1) both;animation-delay:calc(var(--i) * var(--rl-gap,.14s))}
.om-rl.is-done > polygon{animation:none;transform:none;opacity:1}
.om-rl--nav > polygon{animation-duration:var(--rl-dur,.55s)!important}
@keyframes omRlIn{0%{transform:translate(var(--dx),var(--dy));opacity:0}40%{opacity:1}100%{transform:translate(0,0);opacity:1}}
@keyframes omRlWordIn{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
.om-rl-splash{position:fixed;inset:0;z-index:2147483000;background:#F7F8FA;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;transition:opacity .32s ease}
.om-rl-splash.is-out{opacity:0;pointer-events:none}
.om-rl-splash .om-rl-brand{display:flex;align-items:center;justify-content:center;min-height:40px}
/* Real logo artwork (custom wordmark font) — not a CSS font approximation */
.om-rl-splash .om-rl-wordmark-img{display:block;width:min(200px,72vw);height:auto;opacity:0;animation:omRlWordIn .5s ease ${FULL_WORD_AT_MS}ms both}
.om-rl-splash--nav .om-rl-brand{display:none}
.om-ptr--rl,.om-ptr--rl.om-ptr-visible,
.sf-ptr-indicator.om-ptr--rl{display:none!important;height:0!important;max-height:0!important;opacity:0!important;pointer-events:none!important;margin:0!important;padding:0!important;overflow:hidden!important}
@media (prefers-reduced-motion: reduce){
  .om-rl > polygon,.om-rl.is-in > polygon{animation:none;transform:none;opacity:1}
  .om-rl-splash .om-rl-wordmark-img{animation:none;opacity:1;transform:none}
}`;

  function injectCss() {
    let st = document.getElementById("om-reload-css");
    if (!st) {
      st = document.createElement("style");
      st.id = "om-reload-css";
      (document.head || document.documentElement).appendChild(st);
    }
    st.textContent = CSS;
  }

  function touchUi() {
    try {
      return window.matchMedia("(pointer: coarse), (max-width: 1024px)").matches;
    } catch (_) {
      return false;
    }
  }
  function reduced() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) {
      return false;
    }
  }

  function mark(size, opts) {
    const polys = PIECES.map(
      (p, i) =>
        `<polygon points="${p.pts}" style="--i:${i};--dx:${p.dx}px;--dy:${p.dy}px"/>`,
    ).join("");
    const nav = opts && opts.nav ? " om-rl--nav" : "";
    const dur = opts && opts.nav ? "0.55s" : "1.1s";
    const gap = opts && opts.nav ? "0.08s" : "0.14s";
    return `<svg class="om-rl is-in${nav}" width="${size}" height="${size}" viewBox="100 100 312 312" style="--rl-dur:${dur};--rl-gap:${gap}" aria-hidden="true" focusable="false">${polys}</svg>`;
  }

  /** Markup com wordmark oficial (PNG com a tipografia real do logo). */
  function entryMarkup(kind) {
    const nav = kind === "nav";
    const size = nav ? 64 : MARK_SIZE;
    const brand = nav
      ? ""
      : `<div class="om-rl-brand">` +
        `<img class="om-rl-wordmark-img" src="/assets/obramate-wordmark.png?v=20261013-rl8" alt="ObraMate" width="200" height="33" decoding="async" />` +
        `</div>`;
    return mark(size, { nav }) + brand;
  }

  let layer = null;
  let layerShownAt = 0;
  let layerKind = "full";
  let failTimer = null;
  let showTimer = null;
  let navVeil = false;
  let hideAfterMin = null;

  function minMsFor(kind) {
    if (kind === "nav") return reduced() ? NAV_MIN_REDUCED_MS : NAV_MIN_MS;
    return reduced() ? FULL_MIN_REDUCED_MS : FULL_MIN_MS;
  }

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement("div");
    layer.className = "om-rl-splash";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }

  /**
   * kind: 'full' (abrir app / reload) | 'nav' (troca de página, rápida)
   */
  function playEntry(kind) {
    const mode = kind === "nav" ? "nav" : "full";
    layerKind = mode;
    const el = ensureLayer();
    el.classList.remove("is-out", "is-word");
    el.classList.toggle("om-rl-splash--nav", mode === "nav");
    el.innerHTML = entryMarkup(mode);
    // Warm the wordmark so fade-in isn't blank on slow first paint.
    if (mode === "full") {
      try {
        const img = new Image();
        img.src = "/assets/obramate-wordmark.png?v=20261013-rl8";
      } catch (_) {}
    }
    // Restart CSS animations (mark + wordmark).
    void el.offsetWidth;
    layerShownAt = Date.now();
    return el;
  }

  function dismissLayer(force) {
    clearTimeout(failTimer);
    clearTimeout(showTimer);
    clearTimeout(hideAfterMin);
    if (!layer || !document.body.contains(layer)) {
      layerShownAt = 0;
      return;
    }
    const el = layer;
    const kind = layerKind;
    const finish = () => {
      el.classList.add("is-out");
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (layer === el) layer = null;
      }, FADE_OUT_MS);
      layerShownAt = 0;
    };
    if (force) {
      finish();
      return;
    }
    const wait = Math.max(0, minMsFor(kind) - (Date.now() - (layerShownAt || Date.now())));
    if (wait > 0) hideAfterMin = setTimeout(finish, wait);
    else finish();
  }

  /* ---------------- splash ao abrir (completo + nome) ---------------- */
  function splash() {
    let seen = false;
    try {
      seen = sessionStorage.getItem("om_splash_seen") === "1";
      sessionStorage.setItem("om_splash_seen", "1");
    } catch (_) {
      seen = true;
    }
    if (seen || !touchUi() || !document.body) return;

    playEntry("full");
    const t0 = Date.now();
    let gone = false;
    const out = () => {
      if (gone) return;
      gone = true;
      dismissLayer(true);
    };
    const ready = () => setTimeout(out, Math.max(0, minMsFor("full") - (Date.now() - t0)));
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
    setTimeout(out, 4200);
    if (layer) layer.addEventListener("click", out);
  }

  /* ---------------- reload (completo + nome) / nav (rápido) ---------------- */
  function showOverlayNow(kind) {
    playEntry(kind === "nav" ? "nav" : "full");
    clearTimeout(failTimer);
    failTimer = setTimeout(() => dismissLayer(true), kind === "nav" ? 4000 : 12000);
    return layer;
  }

  function showLoading(delay, kind) {
    if (!document.body) return;
    clearTimeout(showTimer);
    const mode = kind === "full" ? "full" : "nav";
    const d = delay == null ? (mode === "nav" ? NAV_SHOW_DELAY_MS : 40) : delay;
    showTimer = setTimeout(() => showOverlayNow(mode), d);
  }

  function hideLoading(force) {
    clearTimeout(showTimer);
    clearTimeout(failTimer);
    if (!layer || layer.classList.contains("is-out")) {
      layerShownAt = 0;
      return;
    }
    dismissLayer(!!force);
  }

  function isPageLink(a, e) {
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    if (a.hasAttribute("download") || (a.target && a.target !== "_self")) return false;
    const raw = a.getAttribute("href") || "";
    if (!raw || raw.charAt(0) === "#" || /^(javascript|mailto|tel|sms|data|blob):/i.test(raw)) return false;
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch (_) {
      return false;
    }
    if (u.origin !== location.origin) return false;
    if (/^\/api\//.test(u.pathname) || /\.(pdf|png|jpe?g|csv|xlsx?|zip)$/i.test(u.pathname)) return false;
    if (u.pathname === location.pathname && u.search === location.search) return false;
    return true;
  }

  function arrival() {
    let ts = 0;
    let kind = "nav";
    try {
      ts = Number(sessionStorage.getItem("om_nav_loading") || 0);
      kind = sessionStorage.getItem("om_nav_kind") === "full" ? "full" : "nav";
      sessionStorage.removeItem("om_nav_loading");
      sessionStorage.removeItem("om_nav_kind");
    } catch (_) {
      /* ignore */
    }
    if (!ts || Date.now() - ts > 8000 || !touchUi()) return;
    if (document.querySelector(".om-rl-splash") && !navVeil) return;

    navVeil = true;
    showOverlayNow(kind);
    const t0 = Date.now();
    const done = () =>
      setTimeout(() => {
        navVeil = false;
        hideLoading();
      }, Math.max(0, minMsFor(kind) - (Date.now() - t0)));
    if (document.readyState === "complete") done();
    else window.addEventListener("load", done, { once: true });
    clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      navVeil = false;
      hideLoading(true);
    }, kind === "full" ? 6000 : 2500);
  }

  function bindNav() {
    window.addEventListener("click", (e) => {
      if (!touchUi()) return;
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (isPageLink(a, e)) {
        showLoading(NAV_SHOW_DELAY_MS, "nav");
        try {
          sessionStorage.setItem("om_nav_loading", String(Date.now()));
          sessionStorage.setItem("om_nav_kind", "nav");
        } catch (_) {
          /* ignore */
        }
      }
    });
    arrival();
    window.addEventListener("pageshow", () => {
      if (!navVeil) hideLoading();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !navVeil) hideLoading();
    });
  }

  function ptrInit(ind) {
    if (!ind || ind.dataset.omRl === "1") return;
    ind.dataset.omRl = "1";
    ind.classList.add("om-ptr--rl");
    ind.innerHTML = "";
    ind.setAttribute("aria-hidden", "true");
  }

  function ptrSet(ind, state) {
    if (!ind) return;
    ptrInit(ind);
    if (state === "busy") {
      try {
        sessionStorage.setItem("om_nav_kind", "full");
      } catch (_) {
        /* ignore */
      }
      showLoading(0, "full");
    } else if (state === "done") {
      hideLoading();
    }
  }

  injectCss();
  g.OmReload = { mark, showLoading, hideLoading, ptrInit, ptrSet };
  if (document.body) {
    splash();
    bindNav();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      splash();
      bindNav();
    });
  }
})(window);
