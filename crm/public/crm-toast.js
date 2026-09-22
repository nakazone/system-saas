/**
 * Toasts CRM — window.crmToast.show(message, { type, durationMs })
 */
(function () {
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

  function show(message, opts) {
    if (!message) return;
    const type = opts && opts.type === 'error' ? 'error' : opts && opts.type === 'info' ? 'info' : 'success';
    const durationMs = (opts && opts.durationMs) || (type === 'error' ? 7000 : 4500);
    const host = ensureHost();
    const el = document.createElement('div');
    el.className = 'crm-toast crm-toast--' + type;
    el.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'crm-toast__close';
    close.setAttribute('aria-label', 'Fechar');
    close.innerHTML = '&times;';
    close.addEventListener('click', () => el.remove());
    el.appendChild(close);
    host.appendChild(el);
    const t = setTimeout(() => {
      el.remove();
    }, durationMs);
    close.addEventListener('click', () => {
      clearTimeout(t);
      el.remove();
    });
  }

  /**
   * Atalho global — usar em todo o CRM em vez de alert().
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='info']
   */
  function notify(message, type) {
    if (!message) return;
    const t =
      type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'info' ? 'info' : 'info';
    show(message, { type: t });
  }

  window.crmToast = {
    show,
    notify,
    success: (message) => show(message, { type: 'success' }),
    error: (message) => show(message, { type: 'error' }),
    info: (message) => show(message, { type: 'info' }),
  };
  window.crmNotify = notify;
})();
