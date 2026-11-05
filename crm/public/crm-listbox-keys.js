/**
 * Shared keyboard helpers for combobox / listbox pickers.
 * ArrowUp/Down move active option; Enter / Tab select; Escape closes.
 */
(function (global) {
  'use strict';

  /**
   * @param {KeyboardEvent} e
   * @param {{
   *   isOpen: () => boolean,
   *   options: () => Element[],
   *   getActiveIndex: () => number,
   *   setActiveIndex: (i: number) => void,
   *   selectIndex: (i: number) => void,
   *   close?: () => void,
   *   open?: () => void,
   *   activeClass?: string,
   * }} cfg
   * @returns {boolean} true if the event was handled
   */
  function handleListboxKeydown(e, cfg) {
    if (!cfg || !e) return false;
    var key = e.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== 'Tab' && key !== 'Escape') {
      return false;
    }
    var open = typeof cfg.isOpen === 'function' ? !!cfg.isOpen() : false;
    var opts = typeof cfg.options === 'function' ? cfg.options() || [] : [];
    var n = opts.length;

    if (key === 'Escape') {
      if (!open) return false;
      e.preventDefault();
      e.stopPropagation();
      if (typeof cfg.close === 'function') cfg.close();
      return true;
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!open) {
        if (typeof cfg.open === 'function') {
          e.preventDefault();
          cfg.open();
          return true;
        }
        return false;
      }
      if (!n) return false;
      e.preventDefault();
      e.stopPropagation();
      var cur = typeof cfg.getActiveIndex === 'function' ? Number(cfg.getActiveIndex()) : -1;
      if (!Number.isFinite(cur) || cur < 0) cur = key === 'ArrowDown' ? -1 : 0;
      var next = key === 'ArrowDown' ? (cur + 1) % n : (cur - 1 + n) % n;
      if (typeof cfg.setActiveIndex === 'function') cfg.setActiveIndex(next);
      return true;
    }

    if (key === 'Enter') {
      if (!open || !n) return false;
      e.preventDefault();
      e.stopPropagation();
      var idx = typeof cfg.getActiveIndex === 'function' ? Number(cfg.getActiveIndex()) : 0;
      if (!Number.isFinite(idx) || idx < 0) idx = 0;
      if (typeof cfg.selectIndex === 'function') cfg.selectIndex(idx);
      return true;
    }

    if (key === 'Tab') {
      if (!open || !n || e.shiftKey) return false;
      var ti = typeof cfg.getActiveIndex === 'function' ? Number(cfg.getActiveIndex()) : 0;
      if (!Number.isFinite(ti) || ti < 0) ti = 0;
      if (typeof cfg.selectIndex === 'function') cfg.selectIndex(ti);
      // Do not preventDefault — allow focus to move to the next field.
      return true;
    }

    return false;
  }

  /**
   * Highlight option at index; scrolls into view.
   * @param {Element[]} options
   * @param {number} index
   * @param {string} [activeClass]
   */
  function syncListboxActive(options, index, activeClass) {
    var cls = activeClass || 'is-active';
    (options || []).forEach(function (el, i) {
      var on = i === index;
      el.classList.toggle(cls, on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && typeof el.scrollIntoView === 'function') {
        try {
          el.scrollIntoView({ block: 'nearest' });
        } catch (_) {}
      }
    });
  }

  global.sfHandleListboxKeydown = handleListboxKeydown;
  global.sfSyncListboxActive = syncListboxActive;
})(typeof window !== 'undefined' ? window : globalThis);
