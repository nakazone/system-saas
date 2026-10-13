/**
 * ObraMate — animação de reload "Montagem" com o símbolo real da marca.
 * A mesma sequência do abrir o app (peças + wordmark) é usada no puxar-para-atualizar
 * e no carregamento entre páginas.
 * Carregar logo depois de <body>: <script src="/om-reload.js?v=…"></script>
 */
(function (g) {
  "use strict";
  if (g.OmReload) return;

  const ORANGE = "#E7792C";
  /** Peças do símbolo (viewBox 0 0 512 512) + direção de entrada. */
  const PIECES = [
    { pts: "112,112 361,112 302,157 159,158 158,337 112,297", dx: -71, dy: -71 },
    { pts: "112,353 334,354 285,399 112,399", dx: 0, dy: 100 },
    { pts: "398,113 399,398 356,353 354,207 263,281 193,281", dx: 71, dy: -71 },
  ];

  const MARK_SIZE = 92;
  const WORD_AT_MS = 1100;
  const ENTRY_MIN_MS = 1900;
  const ENTRY_MIN_REDUCED_MS = 500;
  const FADE_OUT_MS = 500;

  const CSS = `
.om-rl{display:block;overflow:visible}
.om-rl > polygon{fill:${ORANGE};transform:translate(var(--dx),var(--dy));opacity:0}
.om-rl.is-in > polygon{animation:omRlIn var(--rl-dur,1.1s) cubic-bezier(.34,1.56,.64,1) both;animation-delay:calc(var(--i) * var(--rl-gap,.14s))}
.om-rl.is-done > polygon{animation:none;transform:none;opacity:1}
@keyframes omRlIn{0%{transform:translate(var(--dx),var(--dy));opacity:0}40%{opacity:1}100%{transform:translate(0,0);opacity:1}}
.om-rl-splash{position:fixed;inset:0;z-index:2147483000;background:#F7F8FA;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;transition:opacity .45s ease}
.om-rl-splash.is-out{opacity:0;pointer-events:none}
.om-rl-splash img{width:188px;height:auto;opacity:0;transform:translateY(6px);transition:opacity .5s ease,transform .5s ease}
.om-rl-splash.is-word img{opacity:1;transform:none}
.om-ptr--rl,.om-ptr--rl.om-ptr-visible,
.sf-ptr-indicator.om-ptr--rl{display:none!important;height:0!important;max-height:0!important;opacity:0!important;pointer-events:none!important;margin:0!important;padding:0!important;overflow:hidden!important}
@media (prefers-reduced-motion: reduce){
  .om-rl > polygon,.om-rl.is-in > polygon{animation:none;transform:none;opacity:1}
}`;

  function injectCss() {
    if (document.getElementById("om-reload-css")) return;
    const st = document.createElement("style");
    st.id = "om-reload-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
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
  function entryMinMs() {
    return reduced() ? ENTRY_MIN_REDUCED_MS : ENTRY_MIN_MS;
  }

  /** SVG do símbolo — mesma montagem CSS do abrir o app. */
  function mark(size, state) {
    const polys = PIECES.map(
      (p, i) =>
        `<polygon points="${p.pts}" style="--i:${i};--dx:${p.dx}px;--dy:${p.dy}px"/>`,
    ).join("");
    const st = state === "done" ? "done" : "in";
    return `<svg class="om-rl is-${st}" width="${size}" height="${size}" viewBox="100 100 312 312" aria-hidden="true" focusable="false">${polys}</svg>`;
  }

  /** Markup idêntico ao splash de abertura. */
  function entryMarkup() {
    return (
      mark(MARK_SIZE, "in").replace(
        'class="om-rl is-in"',
        'class="om-rl is-in" style="--rl-dur:1.1s;--rl-gap:.14s"',
      ) +
      '<img src="/assets/obramate-wordmark.png?v=20261012-rl1" alt="" width="188" height="31" />'
    );
  }

  /* ---------------- camada partilhada (abrir app + reload) ---------------- */
  let layer = null;
  let layerShownAt = 0;
  let wordTimer = null;
  let failTimer = null;
  let showTimer = null;
  let navVeil = false;
  let hideAfterMin = null;

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement("div");
    layer.className = "om-rl-splash";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return layer;
  }

  /** Reinicia a animação de entrada (mesma do abrir o app). */
  function playEntry() {
    const el = ensureLayer();
    clearTimeout(wordTimer);
    el.classList.remove("is-out", "is-word");
    el.innerHTML = entryMarkup();
    // Force CSS animation restart.
    void el.offsetWidth;
    layerShownAt = Date.now();
    wordTimer = setTimeout(() => {
      if (layer === el) el.classList.add("is-word");
    }, reduced() ? 0 : WORD_AT_MS);
    return el;
  }

  function dismissLayer(force) {
    clearTimeout(wordTimer);
    clearTimeout(failTimer);
    clearTimeout(showTimer);
    clearTimeout(hideAfterMin);
    if (!layer || !document.body.contains(layer)) {
      layerShownAt = 0;
      return;
    }
    const el = layer;
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
    const wait = Math.max(0, entryMinMs() - (Date.now() - (layerShownAt || Date.now())));
    if (wait > 0) {
      hideAfterMin = setTimeout(finish, wait);
    } else {
      finish();
    }
  }

  /* ---------------- splash ao abrir ---------------- */
  function splash() {
    let seen = false;
    try {
      seen = sessionStorage.getItem("om_splash_seen") === "1";
      sessionStorage.setItem("om_splash_seen", "1");
    } catch (_) {
      seen = true;
    }
    if (seen || !touchUi() || !document.body) return;

    playEntry();
    const t0 = Date.now();
    let gone = false;
    const out = () => {
      if (gone) return;
      gone = true;
      dismissLayer(true);
    };
    const ready = () => setTimeout(out, Math.max(0, entryMinMs() - (Date.now() - t0)));
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
    setTimeout(out, 4200); // nunca prende o app
    if (layer) layer.addEventListener("click", out);
  }

  /* ---------------- reload / navegação — mesma animação ---------------- */
  function showOverlayNow() {
    playEntry();
    clearTimeout(failTimer);
    failTimer = setTimeout(() => dismissLayer(true), 12000);
    return layer;
  }

  function showLoading(delay) {
    if (!document.body) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(showOverlayNow, delay == null ? 40 : delay);
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
    try {
      ts = Number(sessionStorage.getItem("om_nav_loading") || 0);
      sessionStorage.removeItem("om_nav_loading");
    } catch (_) {
      /* ignore */
    }
    if (!ts || Date.now() - ts > 8000 || !touchUi()) return;
    // Se o splash de sessão já está a correr, não empilhar outra camada.
    if (document.querySelector(".om-rl-splash") && !navVeil) return;

    navVeil = true;
    showOverlayNow();
    const t0 = Date.now();
    const done = () =>
      setTimeout(() => {
        navVeil = false;
        hideLoading();
      }, Math.max(0, entryMinMs() - (Date.now() - t0)));
    if (document.readyState === "complete") done();
    else window.addEventListener("load", done, { once: true });
    clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      navVeil = false;
      hideLoading(true);
    }, 6000);
  }

  function bindNav() {
    window.addEventListener("click", (e) => {
      if (!touchUi()) return;
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (isPageLink(a, e)) {
        showLoading();
        try {
          sessionStorage.setItem("om_nav_loading", String(Date.now()));
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

  /* ---------------- puxar para atualizar (sem chip/texto no topo) ---------------- */
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
    if (state === "busy") showLoading(0);
    else if (state === "done") hideLoading();
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
