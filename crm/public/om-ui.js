/**
 * ObraMate — comportamento base compartilhado por todos os apps. Injetado em toda página pelo servidor.
 *
 *   const s = OmUI.layer(rootEl, { onClose, history: true, dragHandle: el, initialFocus: el });
 *   s.open();  s.close();  s.isOpen();
 *     Sheet ou diálogo acessível: Esc fecha, o foco fica preso dentro e volta para quem abriu,
 *     o botão voltar do Android fecha (entrada no histórico), a saída anima antes de esconder
 *     (o elemento é escondido com `hidden` no fim) e a alça permite arrastar para fechar.
 *     O painel animado é o filho com data-om-motion; o fundo é o filho com data-om-backdrop.
 *
 *   OmUI.busy(button, true|false)   estado "trabalhando" (spinner, desabilitado, aria-busy)
 *   OmUI.haptic("tap"|"success"|"error")   vibração curta onde existe (Android); no iOS não faz nada
 *   OmUI.reducedMotion()            true quando o sistema pede menos movimento
 */
(function (global) {
  "use strict";
  if (global.OmUI) return;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const stack = [];
  // History: one popstate listener for every layer. A close() that calls history.back() makes a
  // popstate of its own; `ownBacks` swallows it so it cannot close a layer opened right after.
  let ownBacks = 0;
  let pushQueue = [];
  function pushEntry(api) {
    try {
      history.pushState({ ...(history.state || {}), omLayer: stack.length }, "");
      api._pushed = true;
    } catch (_) {}
  }
  global.addEventListener("popstate", () => {
    if (ownBacks > 0) {
      ownBacks -= 1;
      if (!ownBacks && pushQueue.length) {
        const q = pushQueue;
        pushQueue = [];
        q.forEach((api) => api.isOpen() && pushEntry(api));
      }
      return;
    }
    const top = stack[stack.length - 1];
    if (top && top._pushed) {
      top._pushed = false;
      top.close({ fromHistory: true });
    }
  });

  function reducedMotion() {
    try {
      return global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) {
      return false;
    }
  }

  function visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function focusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(visible);
  }

  /** Waits for the exit animation of `el` (or its animated child) — never longer than `max` ms. */
  function afterAnimation(root, max, done) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      root.removeEventListener("animationend", onEnd, true);
      done();
    };
    const onEnd = (e) => {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-om-motion")) finish();
    };
    root.addEventListener("animationend", onEnd, true);
    setTimeout(finish, reducedMotion() ? 140 : max);
  }

  function layer(root, options) {
    const o = options || {};
    let open = false;
    let opener = null;
    let closingTimer = false;

    function onKey(e) {
      if (!open || stack[stack.length - 1] !== api) return;
      if (e.key === "Escape") {
        e.preventDefault();
        api.close();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    const api = {
      _pushed: false,
      isOpen: () => open,
      open() {
        if (open) return;
        open = true;
        closingTimer = false;
        opener = document.activeElement;
        root.hidden = false;
        root.classList.remove("om-ui-closing");
        root.classList.add("om-ui-open");
        if (!root.hasAttribute("role")) root.setAttribute("role", "dialog");
        root.setAttribute("aria-modal", "true");
        stack.push(api);
        document.addEventListener("keydown", onKey, true);
        if (o.history !== false) {
          // A back() from a layer that just closed is still on its way: push after it lands.
          if (ownBacks > 0) pushQueue.push(api);
          else pushEntry(api);
        }
        const target = (o.initialFocus && (typeof o.initialFocus === "function" ? o.initialFocus() : o.initialFocus)) || focusables(root)[0];
        try {
          (target || root).focus({ preventScroll: true });
        } catch (_) {}
        if (typeof o.onOpen === "function") o.onOpen();
      },
      close(opts) {
        if (!open) return;
        open = false;
        const fromHistory = opts && opts.fromHistory;
        const i = stack.indexOf(api);
        if (i >= 0) stack.splice(i, 1);
        document.removeEventListener("keydown", onKey, true);
        pushQueue = pushQueue.filter((x) => x !== api);
        if (api._pushed && !fromHistory) {
          ownBacks += 1;
          try {
            history.back();
          } catch (_) {
            ownBacks -= 1;
          }
        }
        api._pushed = false;
        root.classList.remove("om-ui-open");
        root.classList.add("om-ui-closing");
        closingTimer = true;
        afterAnimation(root, 320, () => {
          if (!closingTimer || open) return;
          root.classList.remove("om-ui-closing");
          root.hidden = true;
        });
        if (opener && document.contains(opener)) {
          try {
            opener.focus({ preventScroll: true });
          } catch (_) {}
        }
        opener = null;
        if (typeof o.onClose === "function") o.onClose();
      },
    };

    if (o.dragHandle) bindDrag(root, o.dragHandle, () => api.close());
    return api;
  }

  /** Drag the sheet down by its handle: closes past 25% of its height or on a quick flick, else springs back. */
  function bindDrag(root, handle, close) {
    const panel = () => root.querySelector("[data-om-motion]") || root;
    let start = null;
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const p = panel();
      start = { y: e.clientY, t: performance.now(), h: p.getBoundingClientRect().height || 1, dy: 0 };
      p.classList.add("om-ui-dragging");
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!start) return;
      start.dy = Math.max(0, e.clientY - start.y);
      panel().style.transform = `translateY(${start.dy}px)`;
    });
    const end = () => {
      if (!start) return;
      const p = panel();
      const v = start.dy / Math.max(1, performance.now() - start.t);
      const shouldClose = start.dy > start.h * 0.25 || v > 0.11;
      p.classList.remove("om-ui-dragging");
      start = null;
      if (shouldClose) {
        p.style.transform = "";
        close();
        return;
      }
      p.classList.add("om-ui-settling");
      p.style.transform = "";
      setTimeout(() => p.classList.remove("om-ui-settling"), 320);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function busy(btn, on) {
    if (!btn) return;
    if (on) {
      if (!btn.querySelector(":scope > .om-busy-label")) {
        const span = document.createElement("span");
        span.className = "om-busy-label";
        while (btn.firstChild) span.appendChild(btn.firstChild);
        btn.appendChild(span);
      }
      btn.classList.add("om-busy");
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    } else {
      btn.classList.remove("om-busy");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  }

  const PATTERNS = { tap: 12, success: [20, 40, 20], error: [40, 60, 40] };
  function haptic(kind) {
    try {
      if (navigator.vibrate) navigator.vibrate(PATTERNS[kind] || PATTERNS.tap);
    } catch (_) {}
  }

  global.OmUI = { VER: "20261105-ui2", layer, busy, haptic, reducedMotion };
})(window);
