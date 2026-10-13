/**
 * ObraMate — animação de reload "Montagem" com o símbolo real da marca.
 * Peças entram de fora e se encaixam (dirigido por JS — CSS transform em
 * <polygon> fica estático no Safari/iOS).
 *  - Splash ao abrir (touch, uma vez por sessão)
 *  - Puxar para atualizar (om-gestures.js → OmReload.ptr*)
 *  - Véu entre páginas / full reload
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

  // Splash uses the original CSS assemble (polygons + keyframes). Overlay/PTR use JS on <g>.
  const CSS = `
.om-rl{display:block;overflow:visible}
.om-rl__g{fill:${ORANGE}}
.om-rl > polygon{fill:${ORANGE};transform:translate(var(--dx),var(--dy));opacity:0}
.om-rl.is-in > polygon{animation:omRlIn var(--rl-dur,1.1s) cubic-bezier(.34,1.56,.64,1) both;animation-delay:calc(var(--i) * var(--rl-gap,.14s))}
.om-rl.is-done > polygon{animation:none;transform:none;opacity:1}
@keyframes omRlIn{0%{transform:translate(var(--dx),var(--dy));opacity:0}40%{opacity:1}100%{transform:translate(0,0);opacity:1}}
.om-rl-splash{position:fixed;inset:0;z-index:2147483000;background:#F7F8FA;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;transition:opacity .45s ease}
.om-rl-splash.is-out{opacity:0;pointer-events:none}
.om-rl-splash img{width:188px;height:auto;opacity:0;transform:translateY(6px);transition:opacity .5s ease,transform .5s ease}
.om-rl-splash.is-word img{opacity:1;transform:none}
.om-rl-ov{position:fixed;inset:0;z-index:2147482000;background:rgba(247,248,250,.86);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .3s ease}
.om-rl-ov.is-on{opacity:1;pointer-events:auto}
.om-ptr--rl,.om-ptr--rl.om-ptr-visible,
.sf-ptr-indicator.om-ptr--rl{display:none!important;height:0!important;max-height:0!important;opacity:0!important;pointer-events:none!important;margin:0!important;padding:0!important;overflow:hidden!important}
@media (prefers-reduced-motion: reduce){
  .om-rl > polygon,.om-rl.is-in > polygon{animation:none;transform:none;opacity:1}
  .om-rl-ov{transition:none}
}`;

  function injectCss() {
    if (document.getElementById("om-reload-css")) return;
    const st = document.createElement("style");
    st.id = "om-reload-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function easeOutBack(t) {
    const c = 1.4;
    const t1 = t - 1;
    return 1 + c * t1 * t1 * t1 + (c + 1) * t1 * t1;
  }
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /** p=0 espalhado, p=1 montado. */
  function paintMark(svg, p) {
    if (!svg) return;
    const prog = Math.max(0, Math.min(1, p));
    const groups = svg.querySelectorAll(".om-rl__g");
    for (let i = 0; i < groups.length; i += 1) {
      const piece = PIECES[i];
      if (!piece) continue;
      const scatter = 1 - prog;
      const dx = piece.dx * scatter;
      const dy = piece.dy * scatter;
      const op = Math.max(0, Math.min(1, prog * 2.4));
      groups[i].setAttribute("transform", "translate(" + dx + "," + dy + ")");
      groups[i].setAttribute("opacity", String(op));
    }
  }

  function stopAnim(svg) {
    if (!svg) return;
    if (svg.__omRaf) {
      cancelAnimationFrame(svg.__omRaf);
      svg.__omRaf = 0;
    }
    svg.__omMode = "";
  }

  function startLoop(svg) {
    if (!svg || reduced()) {
      paintMark(svg, 1);
      return;
    }
    stopAnim(svg);
    svg.__omMode = "loop";
    const t0 = performance.now();
    const PERIOD = 2200;
    const tick = (now) => {
      if (svg.__omMode !== "loop") return;
      const cycle = ((now - t0) % PERIOD) / PERIOD;
      let p;
      if (cycle < 0.3) {
        p = 1 - easeInOut(cycle / 0.3);
      } else {
        p = easeOutBack(Math.min(1, (cycle - 0.3) / 0.7));
        p = Math.max(0, Math.min(1, p));
      }
      paintMark(svg, p);
      svg.__omRaf = requestAnimationFrame(tick);
    };
    svg.__omRaf = requestAnimationFrame(tick);
  }

  function playIn(svg, durMs) {
    if (!svg) return;
    if (reduced()) {
      paintMark(svg, 1);
      return;
    }
    stopAnim(svg);
    svg.__omMode = "in";
    const dur = durMs || 1050;
    const gap = 140;
    const t0 = performance.now();
    const total = dur + gap * 2;
    const tick = (now) => {
      if (svg.__omMode !== "in") return;
      const groups = svg.querySelectorAll(".om-rl__g");
      for (let i = 0; i < groups.length; i += 1) {
        const local = Math.max(0, Math.min(1, (now - t0 - i * gap) / dur));
        const p = easeOutBack(local);
        const piece = PIECES[i];
        const scatter = 1 - Math.max(0, Math.min(1, p));
        groups[i].setAttribute(
          "transform",
          "translate(" + piece.dx * scatter + "," + piece.dy * scatter + ")",
        );
        groups[i].setAttribute("opacity", String(Math.max(0, Math.min(1, local * 2.2))));
      }
      if (now - t0 < total) svg.__omRaf = requestAnimationFrame(tick);
      else {
        paintMark(svg, 1);
        svg.__omMode = "done";
      }
    };
    svg.__omRaf = requestAnimationFrame(tick);
  }

  /**
   * SVG do símbolo.
   * state 'in' → polygons + CSS (splash original).
   * outros → <g> para animação JS (overlay / PTR).
   */
  function mark(size, state) {
    const st = state || "in";
    if (st === "in") {
      const polys = PIECES.map(
        (p, i) =>
          `<polygon points="${p.pts}" style="--i:${i};--dx:${p.dx}px;--dy:${p.dy}px"/>`,
      ).join("");
      return `<svg class="om-rl is-in" width="${size}" height="${size}" viewBox="100 100 312 312" aria-hidden="true" focusable="false">${polys}</svg>`;
    }
    const groups = PIECES.map(
      (p, i) =>
        `<g class="om-rl__g" data-i="${i}" transform="translate(${p.dx},${p.dy})" opacity="0"><polygon points="${p.pts}"/></g>`,
    ).join("");
    return `<svg class="om-rl is-${st}" width="${size}" height="${size}" viewBox="100 100 312 312" aria-hidden="true" focusable="false">${groups}</svg>`;
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

  /* ---------------- splash ao abrir (animação original CSS) ---------------- */
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
    el.innerHTML =
      mark(92, "in").replace(
        'class="om-rl is-in"',
        'class="om-rl is-in" style="--rl-dur:1.1s;--rl-gap:.14s"',
      ) + '<img src="/assets/obramate-wordmark.png?v=20261012-rl1" alt="" width="188" height="31" />';
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
  let ovShownAt = 0;
  let navVeil = false;
  const OV_MIN_MS = 900;

  function overlay() {
    if (ov) return ov;
    ov = document.createElement("div");
    ov.className = "om-rl-ov";
    ov.setAttribute("aria-hidden", "true");
    ov.innerHTML = mark(84, "loop");
    document.body.appendChild(ov);
    return ov;
  }

  function showOverlayNow() {
    const el = overlay();
    el.classList.add("is-on");
    ovShownAt = Date.now();
    const svg = el.querySelector(".om-rl");
    startLoop(svg);
    clearTimeout(ovFail);
    ovFail = setTimeout(hideLoading, 12000);
    return el;
  }

  function showLoading(delay) {
    if (!document.body) return;
    clearTimeout(ovTimer);
    ovTimer = setTimeout(showOverlayNow, delay == null ? 40 : delay);
  }

  function hideLoading(force) {
    clearTimeout(ovTimer);
    clearTimeout(ovFail);
    if (!ov || !ov.classList.contains("is-on")) {
      ovShownAt = 0;
      return;
    }
    const out = () => {
      if (ov) {
        stopAnim(ov.querySelector(".om-rl"));
        ov.classList.remove("is-on");
      }
      ovShownAt = 0;
    };
    if (force) {
      out();
      return;
    }
    const wait = Math.max(0, OV_MIN_MS - (Date.now() - (ovShownAt || Date.now())));
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
    if (!ts || Date.now() - ts > 8000 || !touchUi() || document.querySelector(".om-rl-splash")) return;
    navVeil = true;
    showOverlayNow();
    const t0 = Date.now();
    const done = () =>
      setTimeout(() => {
        navVeil = false;
        hideLoading();
      }, Math.max(500, 1200 - (Date.now() - t0)));
    if (document.readyState === "complete") done();
    else window.addEventListener("load", done, { once: true });
    clearTimeout(ovFail);
    ovFail = setTimeout(() => {
      navVeil = false;
      hideLoading();
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
