/**
 * ObraMate — animação de reload "Montagem" (opção 1B do Claude Design), com o símbolo real da marca.
 * As 3 peças do logo entram de fora e se encaixam.
 *  - Splash ao abrir o app (celular/tablet, uma vez por sessão)
 *  - Puxar para atualizar (om-gestures.js usa OmReload.ptr*)
 *  - Carregamento entre páginas (véu com o símbolo em ciclo)
 * Carregar logo depois de <body>: <script src="/om-reload.js?v=…"></script>
 */
(function (g) {
  "use strict";
  if (g.OmReload) return;

  const ORANGE = "#E7792C";
  /** Peças do símbolo (traçadas do logo oficial, viewBox 0 0 512 512) e a direção de onde entram. */
  const PIECES = [
    { pts: "112,112 361,112 302,157 159,158 158,337 112,297", dx: -71, dy: -71 },
    { pts: "112,353 334,354 285,399 112,399", dx: 0, dy: 100 },
    { pts: "398,113 399,398 356,353 354,207 263,281 193,281", dx: 71, dy: -71 },
  ];

  const CSS = `
.om-rl{display:block;overflow:visible}
.om-rl polygon{fill:${ORANGE};transform:translate(var(--dx),var(--dy));opacity:0}
.om-rl.is-in polygon{animation:omRlIn var(--rl-dur,1.05s) cubic-bezier(.34,1.4,.64,1) both;animation-delay:calc(var(--i) * var(--rl-gap,.14s))}
.om-rl.is-loop polygon{animation:omRlLoop 2.2s infinite both;animation-delay:calc(var(--i) * .16s)}
.om-rl.is-manual polygon{animation:none;transform:translate(calc(var(--dx) * (1 - var(--p,0))),calc(var(--dy) * (1 - var(--p,0))));opacity:min(1,calc(var(--p,0) * 2.5))}
.om-rl.is-done polygon{animation:none;transform:none;opacity:1}
@keyframes omRlIn{0%{transform:translate(var(--dx),var(--dy));opacity:0}40%{opacity:1}100%{transform:translate(0,0);opacity:1}}
@keyframes omRlLoop{0%{transform:translate(0,0);opacity:1;animation-timing-function:cubic-bezier(.65,0,.35,1)}28%{transform:translate(var(--dx),var(--dy));opacity:0;animation-timing-function:cubic-bezier(.34,1.4,.64,1)}100%{transform:translate(0,0);opacity:1}}
.om-rl-splash{position:fixed;inset:0;z-index:2147483000;background:#F7F8FA;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;transition:opacity .55s ease}
.om-rl-splash.is-out{opacity:0;pointer-events:none}
.om-rl-splash img{width:188px;height:auto;opacity:0;transform:translateY(6px);transition:opacity .55s ease,transform .55s ease}
.om-rl-splash.is-word img{opacity:1;transform:none}
.om-rl-ov{position:fixed;inset:0;z-index:2147482000;background:rgba(247,248,250,.9);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .38s ease}
.om-rl-ov.is-on{opacity:1;pointer-events:auto}
@media (prefers-reduced-motion: reduce){
  .om-rl polygon,.om-rl.is-in polygon,.om-rl.is-manual polygon{animation:none;transform:none;opacity:1}
  .om-rl.is-loop polygon{animation:omRlPulse 1.4s ease-in-out infinite;transform:none}
  @keyframes omRlPulse{50%{opacity:.35}}
}`;

  function injectCss() {
    if (document.getElementById("om-reload-css")) return;
    const st = document.createElement("style");
    st.id = "om-reload-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /** SVG do símbolo. state: 'in' (monta uma vez) | 'loop' | 'manual' (usa --p) | 'done'. */
  function mark(size, state) {
    const polys = PIECES.map(
      (p, i) => `<polygon points="${p.pts}" style="--i:${i};--dx:${p.dx}px;--dy:${p.dy}px"/>`,
    ).join("");
    return `<svg class="om-rl is-${state || "in"}" width="${size}" height="${size}" viewBox="100 100 312 312" aria-hidden="true" focusable="false">${polys}</svg>`;
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
    const el = document.createElement("div");
    el.className = "om-rl-splash";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = mark(92, "in").replace('class="om-rl is-in"', 'class="om-rl is-in" style="--rl-dur:1.1s;--rl-gap:.14s"') +
      '<img src="/assets/obramate-wordmark.png?v=20261012-rl1" alt="" width="188" height="31" />';
    document.body.appendChild(el);
    const t0 = Date.now();
    const MIN = reduced() ? 500 : 1900;
    setTimeout(() => el.classList.add("is-word"), reduced() ? 0 : 1100);
    let gone = false;
    const out = () => {
      if (gone) return;
      gone = true;
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 500);
    };
    const ready = () => setTimeout(out, Math.max(0, MIN - (Date.now() - t0)));
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
    setTimeout(out, 4200); // nunca prende o app
    el.addEventListener("click", out);
  }

  /* ---------------- carregamento entre páginas ---------------- */
  let ov = null;
  let ovTimer = null;
  let ovFail = null;
  function overlay() {
    if (ov) return ov;
    ov = document.createElement("div");
    ov.className = "om-rl-ov";
    ov.setAttribute("aria-hidden", "true");
    ov.innerHTML = mark(72, "loop");
    document.body.appendChild(ov);
    return ov;
  }
  let ovShownAt = 0;
  const OV_MIN_MS = 720; // enough for one calm assemble cycle — avoids flashy “bug” transitions
  function showLoading(delay) {
    if (!document.body) return;
    clearTimeout(ovTimer);
    ovTimer = setTimeout(() => {
      overlay().classList.add("is-on");
      ovShownAt = Date.now();
      clearTimeout(ovFail);
      ovFail = setTimeout(hideLoading, 12000);
    }, delay == null ? 90 : delay);
  }
  function hideLoading() {
    clearTimeout(ovTimer);
    clearTimeout(ovFail);
    if (!ov || !ov.classList.contains("is-on")) {
      ovShownAt = 0;
      return;
    }
    const wait = Math.max(0, OV_MIN_MS - (Date.now() - (ovShownAt || Date.now())));
    const out = () => {
      if (ov) ov.classList.remove("is-on");
      ovShownAt = 0;
    };
    if (wait > 0) setTimeout(out, wait);
    else out();
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
    if (u.pathname === location.pathname && u.search === location.search) return false; // só muda o #
    return true;
  }
  /** Chegando de um link do app: o véu já aparece e some quando a página termina de carregar. */
  function arrival() {
    let ts = 0;
    try {
      ts = Number(sessionStorage.getItem("om_nav_loading") || 0);
      sessionStorage.removeItem("om_nav_loading");
    } catch (_) {
      /* ignore */
    }
    if (!ts || Date.now() - ts > 8000 || !touchUi() || document.querySelector(".om-rl-splash")) return;
    const el = overlay();
    el.style.transition = "none";
    el.classList.add("is-on");
    ovShownAt = Date.now();
    void el.offsetWidth;
    el.style.transition = "";
    const t0 = Date.now();
    // Keep the veil up long enough to feel intentional (not a blink).
    const done = () => setTimeout(hideLoading, Math.max(280, 900 - (Date.now() - t0)));
    if (document.readyState === "complete") done();
    else window.addEventListener("load", done, { once: true });
    clearTimeout(ovFail);
    ovFail = setTimeout(hideLoading, 5000);
  }
  function bindNav() {
    // bolha na window: roda depois dos handlers das páginas (que podem impedir a navegação)
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
    window.addEventListener("pageshow", hideLoading);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") hideLoading();
    });
  }

  /* ---------------- puxar para atualizar ---------------- */
  /** Prepara o indicador (om-gestures.js). */
  function ptrInit(ind) {
    if (!ind || ind.dataset.omRl === "1") return;
    ind.dataset.omRl = "1";
    ind.classList.add("om-ptr--rl");
    ind.innerHTML = `<span class="om-ptr__mark">${mark(38, "manual")}</span><span class="om-ptr__lbl"></span>`;
  }
  function ptrSet(ind, state, p, label) {
    if (!ind) return;
    ptrInit(ind);
    const svg = ind.querySelector(".om-rl");
    const lbl = ind.querySelector(".om-ptr__lbl");
    if (svg) {
      svg.classList.remove("is-in", "is-loop", "is-manual", "is-done");
      svg.classList.add(state === "busy" ? "is-loop" : state === "done" ? "is-done" : "is-manual");
      const pp = Math.max(0, Math.min(1, p || 0));
      svg.style.setProperty("--p", String(pp));
      const mk = ind.querySelector(".om-ptr__mark");
      if (mk) mk.style.transform = state === "pull" ? `scale(${0.6 + 0.4 * pp})` : "";
    }
    if (lbl && label != null) lbl.textContent = String(label).replace(/^[↓↑]\s*/, "");
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
