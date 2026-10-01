/**
 * Minimal rich text for CRM textareas: select text → Bold / Italic.
 * Stores plain text with markers: **bold** and _italic_.
 */
(function (global) {
  'use strict';

  var attached = new WeakSet();
  var BOLD = '**';
  var ITALIC = '_';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Escape then turn **bold** / _italic_ into HTML. Newlines left to CSS pre-wrap. */
  function formatRichTextHtml(text) {
    var html = escapeHtml(text);
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    return html;
  }

  /** Strip markers for PDF / SMS / plain surfaces. */
  function stripRichMarkers(text) {
    return String(text == null ? '' : text)
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1');
  }

  function wrapOrToggle(ta, marker) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    if (start == null || end == null || start === end) {
      // No selection: insert empty markers and place caret inside
      var empty = marker + marker;
      var before = ta.value.slice(0, start);
      var after = ta.value.slice(end);
      ta.value = before + empty + after;
      var caret = start + marker.length;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      return;
    }

    var val = ta.value;
    var selected = val.slice(start, end);
    var openLen = marker.length;
    var nextVal;
    var newStart;
    var newEnd;

    // Already wrapped inside selection
    if (
      selected.length > openLen * 2 &&
      selected.slice(0, openLen) === marker &&
      selected.slice(-openLen) === marker
    ) {
      var inner = selected.slice(openLen, -openLen);
      nextVal = val.slice(0, start) + inner + val.slice(end);
      newStart = start;
      newEnd = start + inner.length;
    } else if (
      start >= openLen &&
      val.slice(start - openLen, start) === marker &&
      val.slice(end, end + openLen) === marker
    ) {
      // Markers sit just outside the selection
      nextVal = val.slice(0, start - openLen) + selected + val.slice(end + openLen);
      newStart = start - openLen;
      newEnd = newStart + selected.length;
    } else {
      nextVal = val.slice(0, start) + marker + selected + marker + val.slice(end);
      newStart = start + openLen;
      newEnd = end + openLen;
    }

    ta.value = nextVal;
    ta.setSelectionRange(newStart, newEnd);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    ta.focus();
  }

  function ensureStyles() {
    if (document.getElementById('crm-rich-text-style')) return;
    var link = document.querySelector('link[href*="crm-rich-text.css"]');
    if (link) return;
    var s = document.createElement('link');
    s.id = 'crm-rich-text-style';
    s.rel = 'stylesheet';
    s.href = 'crm-rich-text.css?v=20261001-rich1';
    document.head.appendChild(s);
  }

  function buildToolbar(ta) {
    var bar = document.createElement('div');
    bar.className = 'crm-rich-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Formatação de texto');

    function btn(label, title, marker, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'crm-rich-toolbar__btn' + (cls ? ' ' + cls : '');
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = label;
      b.addEventListener('mousedown', function (e) {
        e.preventDefault(); // keep textarea selection
      });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        wrapOrToggle(ta, marker);
      });
      return b;
    }

    bar.appendChild(btn('<strong>B</strong>', 'Negrito (Ctrl/⌘+B)', BOLD, 'crm-rich-toolbar__btn--bold'));
    bar.appendChild(btn('<em>I</em>', 'Itálico (Ctrl/⌘+I)', ITALIC, 'crm-rich-toolbar__btn--italic'));
    return bar;
  }

  function wrapField(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA' || attached.has(ta)) return false;
    if (ta.getAttribute('data-crm-rich') === 'off') return false;

    ensureStyles();
    attached.add(ta);
    ta.setAttribute('data-crm-rich', 'basic');

    var parent = ta.parentElement;
    var wrap = document.createElement('div');
    wrap.className = 'crm-rich-field';

    if (parent && parent.classList.contains('crm-rich-field')) {
      // already wrapped
      return true;
    }

    parent.insertBefore(wrap, ta);
    var toolbar = buildToolbar(ta);
    wrap.appendChild(toolbar);
    wrap.appendChild(ta);

    ta.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      var key = String(e.key || '').toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        wrapOrToggle(ta, BOLD);
      } else if (key === 'i') {
        e.preventDefault();
        wrapOrToggle(ta, ITALIC);
      }
    });

    return true;
  }

  var SKIP_ID_RE = /^(chatInput|msgInput|sms|qbSms|invEmail|password)/i;
  var SKIP_NAME_RE = /(password|sms|phone|email|code|token)/i;
  var INCLUDE_ID_RE =
    /(notes|terms|message|description|desc|attention|comment|body|observ|instruc|bio|detail)/i;

  function shouldEnhance(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return false;
    if (ta.disabled || ta.readOnly) return false;
    if (ta.getAttribute('data-crm-rich') === 'off') return false;
    if (ta.getAttribute('data-crm-rich') === 'basic') return true;
    if (SKIP_ID_RE.test(ta.id || '')) return false;
    if (SKIP_NAME_RE.test((ta.id || '') + ' ' + (ta.name || ''))) return false;
    var rows = parseInt(ta.getAttribute('rows') || '0', 10);
    if (INCLUDE_ID_RE.test((ta.id || '') + ' ' + (ta.name || '') + ' ' + (ta.className || ''))) {
      return true;
    }
    if (rows >= 2) return true;
    // Tall single-row-ish fields used as notes
    if (ta.offsetHeight >= 64) return true;
    return false;
  }

  function scanAndAttach(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('textarea');
    list.forEach(function (ta) {
      if (attached.has(ta)) return;
      if (!shouldEnhance(ta)) return;
      wrapField(ta);
    });
  }

  function boot() {
    ensureStyles();
    scanAndAttach(document);
    if (typeof MutationObserver !== 'undefined' && document.body && !global.__crmRichTextObs) {
      global.__crmRichTextObs = true;
      var t = null;
      var obs = new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(function () {
          scanAndAttach(document);
        }, 200);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  global.sfFormatRichTextHtml = formatRichTextHtml;
  global.sfStripRichMarkers = stripRichMarkers;
  global.sfEscapeHtml = escapeHtml;
  global.sfAttachRichText = wrapField;
  global.sfScanCrmRichText = scanAndAttach;
  global.sfBootCrmRichText = boot;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(boot, 350);
    });
  } else {
    setTimeout(boot, 350);
  }
})(typeof window !== 'undefined' ? window : globalThis);
