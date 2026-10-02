/**
 * Telefone US — padrão (XXX) XXX-XXXX em inputs e exibição.
 *
 *   window.sfFormatPhone(raw)     → "(303) 555-0142"
 *   window.sfPhoneDigits(raw)     → "3035550142"
 *   window.sfMaskPhoneInput(raw)  → máscara progressiva ao digitar
 *   window.sfScanCrmPhoneInputs() → liga máscara em type=tel / name~phone
 */
(function (global) {
  "use strict";

  function digitsOnly(raw) {
    return String(raw == null ? "" : raw).replace(/\D/g, "");
  }

  /** 10 dígitos US (descarta +1). */
  function phoneDigits(raw) {
    let d = digitsOnly(raw);
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    return d.slice(0, 10);
  }

  /** Máscara progressiva a partir de dígitos (até 10). */
  function maskFromDigits(rawDigits) {
    const d = String(rawDigits || "").replace(/\D/g, "").slice(0, 10);
    if (!d.length) return "";
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  /**
   * Formata para exibição. 10 dígitos (ou 11 com 1) → (XXX) XXX-XXXX.
   * Outros comprimentos: máscara parcial se ≤10; senão mantém o texto original.
   */
  function formatPhone(raw) {
    if (raw == null || raw === "") return "";
    const s = String(raw).trim();
    if (!s || s === "—" || s === "-" || /^n\/?a$/i.test(s)) return "";
    let d = digitsOnly(s);
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length > 10) return s;
    return maskFromDigits(d);
  }

  function maskPhoneInput(raw) {
    return maskFromDigits(phoneDigits(raw));
  }

  function isPhoneField(el) {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return false;
    if (el.dataset.crmPhone === "off") return false;
    if (el.type === "tel") return true;
    const name = String(el.name || el.id || "").toLowerCase();
    if (/(^|[_-])phone($|[_-])|telefone|celular|mobile/.test(name)) return true;
    const ac = String(el.autocomplete || "").toLowerCase();
    if (ac === "tel" || ac === "tel-national" || ac === "tel-local") return true;
    return el.dataset.crmPhone === "1";
  }

  function applyMask(el) {
    if (!isPhoneField(el)) return;
    const next = maskPhoneInput(el.value);
    if (el.value !== next) {
      const start = el.selectionStart;
      const atEnd = start == null || start >= el.value.length;
      el.value = next;
      if (!atEnd && typeof el.setSelectionRange === "function") {
        try {
          const pos = next.length;
          el.setSelectionRange(pos, pos);
        } catch (_) {}
      }
    }
    if (!el.getAttribute("maxlength") || Number(el.getAttribute("maxlength")) > 14) {
      el.setAttribute("maxlength", "14");
    }
    if (!el.getAttribute("inputmode")) el.setAttribute("inputmode", "tel");
    if (!el.getAttribute("placeholder")) el.setAttribute("placeholder", "(XXX) XXX-XXXX");
  }

  function bindField(el) {
    if (!(el instanceof HTMLInputElement) || !isPhoneField(el)) return;
    if (el.dataset.crmPhoneBound === "1") {
      applyMask(el);
      return;
    }
    el.dataset.crmPhoneBound = "1";
    applyMask(el);
    el.addEventListener("input", () => applyMask(el));
    el.addEventListener("blur", () => applyMask(el));
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("input").forEach(bindField);
  }

  let observing = false;
  function startObserver() {
    if (observing || typeof MutationObserver === "undefined" || !document.body) return;
    observing = true;
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches && node.matches("input")) bindField(node);
          else scan(node);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    scan(document);
    startObserver();
  }

  global.sfPhoneDigits = phoneDigits;
  global.sfFormatPhone = formatPhone;
  global.sfMaskPhoneInput = maskPhoneInput;
  global.sfScanCrmPhoneInputs = scan;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
