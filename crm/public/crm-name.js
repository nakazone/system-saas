/**
 * Nome de pessoa — primeira letra de cada palavra em maiúsculo.
 *
 *   window.sfFormatPersonName(raw) → "Douglas Nakazone Teotonio"
 *   window.sfScanCrmNameInputs()   → liga formatação em campos de nome
 */
(function (global) {
  "use strict";

  function formatPersonName(raw) {
    if (raw == null) return "";
    const s = String(raw).trim().replace(/\s+/g, " ");
    if (!s) return "";
    return s.replace(/[^\s'-]+/g, (word) => {
      if (!word) return word;
      return word.charAt(0).toLocaleUpperCase("en-US") + word.slice(1).toLocaleLowerCase("en-US");
    });
  }

  /** Campos de nome de pessoa (não empresa, serviço, cargo, etc.). */
  function isNameField(el) {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return false;
    if (el.type && el.type !== "text" && el.type !== "search") return false;
    if (el.dataset.crmName === "off") return false;
    if (el.dataset.crmName === "1") return true;

    const ac = String(el.autocomplete || "").toLowerCase();
    if (ac === "name" || ac === "given-name" || ac === "family-name" || ac === "additional-name") {
      return true;
    }

    const key = String(el.name || el.id || "").toLowerCase();
    if (!key) return false;

    // Explicit exclusions (company / catalog / system labels).
    if (
      /(company|organization|org_|workspace|service|product|role|cargo|catalog|category|unit|sku|title|subject|filename|username|slug|job_?name|quote_?name|calendar|agenda|schedname)/.test(
        key,
      )
    ) {
      return false;
    }

    return (
      /^(name|full_?name|first_?name|last_?name|client_?name|customer_?name|user_?name|employee_?name|signer_?name|responsible_?name|manualclientname|editclientname|crmusername|nlsname|paymobavulsoname|ownersignname|qpsignername|clientname|feName|foConfName)$/i.test(
        key,
      ) ||
      /(^|[_-])(first_?name|last_?name|full_?name|client_?name|customer_?name|user_?name|employee_?name|signer_?name|responsible_?name)($|[_-])/i.test(
        key,
      ) ||
      /(^|[_-])name($|[_-])/i.test(key)
    );
  }

  function applyFormat(el) {
    if (!isNameField(el)) return;
    const next = formatPersonName(el.value);
    if (el.value !== next) {
      const start = el.selectionStart;
      const atEnd = start == null || start >= el.value.length;
      el.value = next;
      if (!atEnd && typeof el.setSelectionRange === "function") {
        try {
          const pos = Math.min(start, next.length);
          el.setSelectionRange(pos, pos);
        } catch (_) {}
      }
    }
  }

  function bindField(el) {
    if (!(el instanceof HTMLInputElement) || !isNameField(el)) return;
    if (el.dataset.crmNameBound === "1") {
      applyFormat(el);
      return;
    }
    el.dataset.crmNameBound = "1";
    // Format on blur so mid-typing of a word stays natural; also on change/paste.
    el.addEventListener("blur", () => applyFormat(el));
    el.addEventListener("change", () => applyFormat(el));
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

  global.sfFormatPersonName = formatPersonName;
  global.sfScanCrmNameInputs = scan;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
