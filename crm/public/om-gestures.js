/**
 * Shared mobile/tablet gestures for ObraMate CRM.
 * - Pull-to-refresh
 * - Swipe row left → reveal Edit / Delete (or custom actions)
 * Edge-swipe back lives in om-mobile-nav.js (enhanced there).
 */
(function (global) {
  "use strict";

  const VER = "20261002-gest1";

  function isTouchViewport() {
    return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
  }

  function haptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch (_) {}
  }

  function scrollTopNearZero(el) {
    if (!el) return true;
    if (el === document.body || el === document.documentElement) {
      return (window.scrollY || document.documentElement.scrollTop || 0) <= 2;
    }
    return (el.scrollTop || 0) <= 2;
  }

  function findScrollRoot(start) {
    let n = start;
    while (n && n !== document.body && n !== document.documentElement) {
      if (n instanceof HTMLElement) {
        const st = getComputedStyle(n);
        const oy = st.overflowY;
        if ((oy === "auto" || oy === "scroll" || oy === "overlay") && n.scrollHeight > n.clientHeight + 8) {
          return n;
        }
      }
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  /**
   * @param {{
   *   indicator: HTMLElement|string,
   *   refresh: () => Promise<void>|void,
   *   enabled?: () => boolean,
   *   labelIdle?: string,
   *   labelReady?: string,
   *   labelBusy?: string,
   * }} opts
   */
  function initPullToRefresh(opts) {
    if (!opts || typeof opts.refresh !== "function") return;
    const key = opts.key || "default";
    if (!global.__omPtrRegistry) global.__omPtrRegistry = Object.create(null);
    global.__omPtrRegistry[key] = opts;

    if (document.documentElement.dataset.omPtrBound === "1") return;
    document.documentElement.dataset.omPtrBound = "1";

    let pulling = false;
    let armed = false;
    let startY = 0;
    let refreshing = false;
    let activeKey = null;

    function indEl(o) {
      if (!o) return null;
      if (typeof o.indicator === "string") return document.querySelector(o.indicator);
      return o.indicator || null;
    }

    function activeOpts() {
      const reg = global.__omPtrRegistry || {};
      for (const k of Object.keys(reg)) {
        const o = reg[k];
        if (o.enabled && !o.enabled()) continue;
        if (!indEl(o)) continue;
        return { key: k, opts: o };
      }
      return null;
    }

    document.addEventListener(
      "touchstart",
      (e) => {
        if (!isTouchViewport()) return;
        const hit = activeOpts();
        if (!hit || !e.touches || !e.touches.length) return;
        const root = findScrollRoot(e.target);
        if (!scrollTopNearZero(root)) return;
        pulling = true;
        armed = true;
        activeKey = hit.key;
        startY = e.touches[0].clientY;
      },
      { passive: true, capture: true },
    );

    document.addEventListener(
      "touchmove",
      (e) => {
        if (!isTouchViewport() || !pulling || !armed || !activeKey) return;
        const o = global.__omPtrRegistry[activeKey];
        const ind = indEl(o);
        if (!ind || !e.touches || !e.touches.length) return;
        const root = findScrollRoot(e.target);
        if (!scrollTopNearZero(root)) {
          ind.classList.remove("om-ptr-visible", "is-ready");
          armed = false;
          return;
        }
        const dy = e.touches[0].clientY - startY;
        if (dy > 0 && dy < 140) {
          try {
            e.preventDefault();
          } catch (_) {}
        }
        const idle = o.labelIdle || "↓ Puxe para atualizar";
        const ready = o.labelReady || "↓ Largar para atualizar";
        if (dy > 48) {
          ind.classList.add("om-ptr-visible");
          const ok = dy > 72;
          ind.classList.toggle("is-ready", ok);
          ind.textContent = ok ? ready : idle;
        } else {
          ind.classList.remove("om-ptr-visible", "is-ready");
        }
      },
      { passive: false, capture: true },
    );

    const end = async () => {
      if (!pulling || !activeKey) {
        pulling = false;
        armed = false;
        return;
      }
      const o = global.__omPtrRegistry[activeKey];
      const ind = indEl(o);
      const should = !!(ind && ind.classList.contains("om-ptr-visible") && ind.classList.contains("is-ready"));
      pulling = false;
      armed = false;
      if (ind) {
        ind.classList.remove("om-ptr-visible", "is-ready");
        if (should) ind.textContent = o.labelBusy || "A atualizar…";
      }
      if (!should || refreshing) {
        activeKey = null;
        if (ind) ind.textContent = (o && o.labelIdle) || "↓ Puxe para atualizar";
        return;
      }
      refreshing = true;
      haptic(12);
      try {
        await Promise.resolve(o.refresh());
      } finally {
        refreshing = false;
        if (ind) ind.textContent = o.labelIdle || "↓ Puxe para atualizar";
        activeKey = null;
      }
    };

    document.addEventListener("touchend", end, { passive: true, capture: true });
    document.addEventListener("touchcancel", end, { passive: true, capture: true });
  }

  /**
   * Swipe row left to reveal trailing actions (Edit / Delete).
   * Markup:
   *   .om-swipe
   *     .om-swipe__actions  (buttons behind)
   *     .om-swipe__body     (foreground content)
   *
   * @param {HTMLElement} container
   * @param {{
   *   rowSelector?: string,
   *   bodySelector?: string,
   *   openClass?: string,
   *   openX?: number,
   *   ignoreSelector?: string,
   * }} [cfg]
   */
  function bindSwipeRow(container, cfg) {
    if (!container || container.dataset.omSwipeBound === "1") return;
    container.dataset.omSwipeBound = "1";
    const rowSel = (cfg && cfg.rowSelector) || ".om-swipe";
    const bodySel = (cfg && cfg.bodySelector) || ".om-swipe__body";
    const openClass = (cfg && cfg.openClass) || "om-swipe--open";
    const OPEN_X = (cfg && cfg.openX) || -148;
    // Never treat .om-swipe__body itself as "ignored" — bodies are often <button>/<a>.
    const ignoreSel =
      (cfg && cfg.ignoreSelector) ||
      ".om-swipe__actions button, .om-swipe__actions a, input, select, textarea";

    let active = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let dragging = false;
    let axis = null;
    let skipClick = false;

    function bodyOf(row) {
      return row && row.querySelector(bodySel);
    }

    function setOpen(row, open) {
      const body = bodyOf(row);
      if (!body) return;
      row.classList.toggle(openClass, open);
      body.style.transform = open ? `translateX(${OPEN_X}px)` : "";
    }

    function closeOthers(except) {
      container.querySelectorAll(rowSel + "." + openClass).forEach((r) => {
        if (r !== except) setOpen(r, false);
      });
    }

    function shouldIgnorePointer(target, row) {
      if (!target || !row) return true;
      if (target.closest(".om-swipe__actions")) return true;
      if (target.closest(ignoreSel) && !target.closest(bodySel)) return true;
      return false;
    }

    container.addEventListener(
      "pointerdown",
      (e) => {
        if (!isTouchViewport()) return;
        const row = e.target.closest(rowSel);
        if (!row || shouldIgnorePointer(e.target, row)) return;
        active = row;
        startX = e.clientX;
        startY = e.clientY;
        lastX = e.clientX;
        dragging = false;
        axis = null;
        skipClick = false;
        const body = bodyOf(row);
        if (body) body.style.transition = "none";
        try {
          row.setPointerCapture(e.pointerId);
        } catch (_) {}
      },
      { passive: true },
    );

    container.addEventListener(
      "pointermove",
      (e) => {
        if (!active) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        lastX = e.clientX;
        if (!axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        }
        if (axis !== "x") return;
        dragging = true;
        skipClick = true;
        const base = active.classList.contains(openClass) ? OPEN_X : 0;
        let next = base + dx;
        if (next > 0) next = 0;
        if (next < OPEN_X - 28) next = OPEN_X - 28;
        const body = bodyOf(active);
        if (body) body.style.transform = `translateX(${next}px)`;
      },
      { passive: true },
    );

    const end = (e) => {
      if (!active) return;
      const row = active;
      const body = bodyOf(row);
      active = null;
      if (body) body.style.transition = "";
      if (!dragging || axis !== "x") {
        dragging = false;
        axis = null;
        return;
      }
      dragging = false;
      axis = null;
      const clientX = e && e.clientX != null ? e.clientX : lastX;
      const dx = clientX - startX;
      const wasOpen = row.classList.contains(openClass);
      const shouldOpen = wasOpen ? !(dx > 40) : dx < -56;
      closeOthers(row);
      setOpen(row, shouldOpen);
      if (shouldOpen) haptic(8);
    };

    container.addEventListener("pointerup", end, { passive: true });
    container.addEventListener("pointercancel", end, { passive: true });

    container.addEventListener(
      "click",
      (e) => {
        const row = e.target.closest(rowSel);
        if (!row) return;
        if (e.target.closest(".om-swipe__actions")) return;
        if (skipClick) {
          skipClick = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (row.classList.contains(openClass)) {
          setOpen(row, false);
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
  }

  /** Ensure primary mobile CTAs stay above the tab bar (padding helper). */
  function ensureDockPadding(selector) {
    document.querySelectorAll(selector || "[data-om-dock-pad]").forEach((el) => {
      el.classList.add("om-dock-pad");
    });
  }

  global.OmGestures = {
    VER,
    isTouchViewport,
    initPullToRefresh,
    bindSwipeRow,
    ensureDockPadding,
    haptic,
  };
})(typeof window !== "undefined" ? window : globalThis);
