/**
 * Toasts CRM — window.crmToast.show(message, { type, durationMs, action })
 *
 * action: { label, onClick } adds a button (e.g. "Desfazer"). Clicking it runs onClick
 * and closes the toast. window.crmToast.undo(message, onUndo) is the shortcut for the
 * "act now, offer undo" pattern that replaces confirm() for reversible actions.
 *
 * The server injects this file on every CRM page; pages that also load it themselves
 * hit the guard below, so the API is defined once.
 */
(function () {
  if (window.crmToast && window.crmToast.__v2) return;

  function ensureHost() {
    let h = document.getElementById('crmToastHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'crmToastHost';
      h.setAttribute('aria-live', 'polite');
      document.body.appendChild(h);
    }
    return h;
  }

  function dismiss(el) {
    if (!el || el.dataset.leaving === '1') return;
    el.dataset.leaving = '1';
    el.classList.add('is-leaving');
    // Matches the 150ms exit in crm-toast.css; remove right away if animations are off.
    setTimeout(() => el.remove(), 160);
  }

  function show(message, opts) {
    if (!message) return null;
    const o = opts || {};
    const requested = o.type;
    const type = ['error', 'info', 'warning'].includes(requested) ? requested : 'success';
    const durationMs = o.durationMs || (o.action ? 6000 : type === 'error' || type === 'warning' ? 7000 : 4500);
    const host = ensureHost();
    const el = document.createElement('div');
    el.className = 'crm-toast crm-toast--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.className = 'crm-toast__text';
    text.textContent = message;
    el.appendChild(text);
    let timer = null;
    if (o.action && o.action.label) {
      const act = document.createElement('button');
      act.type = 'button';
      act.className = 'crm-toast__action';
      act.textContent = o.action.label;
      act.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss(el);
        try {
          if (typeof o.action.onClick === 'function') o.action.onClick();
        } catch (_) {}
      });
      el.appendChild(act);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'crm-toast__close';
    close.setAttribute('aria-label', 'Fechar');
    close.innerHTML = '&times;';
    close.addEventListener('click', () => {
      clearTimeout(timer);
      dismiss(el);
    });
    el.appendChild(close);
    host.appendChild(el);
    timer = setTimeout(() => dismiss(el), durationMs);
    return el;
  }

  /**
   * Atalho global — usar em todo o CRM em vez de alert().
   * @param {string} message
   * @param {'success'|'error'|'info'|'warning'} [type='info']
   */
  function notify(message, type) {
    if (!message) return;
    const t = ['error', 'success', 'info', 'warning'].includes(type) ? type : 'info';
    show(message, { type: t });
  }

  /** "Feito · Desfazer" — the action already happened; onUndo reverts it. */
  function undo(message, onUndo, opts) {
    return show(message, Object.assign({ type: 'success', action: { label: 'Desfazer', onClick: onUndo } }, opts || {}));
  }

  window.crmToast = {
    __v2: true,
    show,
    notify,
    undo,
    success: (message) => show(message, { type: 'success' }),
    error: (message) => show(message, { type: 'error' }),
    info: (message) => show(message, { type: 'info' }),
    warning: (message) => show(message, { type: 'warning' }),
  };
  window.crmNotify = notify;
})();
