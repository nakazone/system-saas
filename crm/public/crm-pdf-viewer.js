/**
 * Visualizador PDF in-app com botão Fechar (iPad / PWA).
 */
(function () {
  let root = null;
  let currentObjectUrl = null;
  let previousBodyOverflow = '';
  let bodyLocked = false;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'crmPdfViewer';
    root.className = 'crm-pdf-viewer';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <header class="crm-pdf-viewer__bar">
        <button type="button" class="crm-pdf-viewer__close" id="crmPdfViewerClose" aria-label="Fechar PDF">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Fechar
        </button>
        <div class="crm-pdf-viewer__brand" aria-hidden="true">
          <img class="crm-pdf-viewer__brand-mark" src="/assets/favicon-192.png" alt="" width="28" height="28" onerror="this.src='/assets/favicon.png'" />
          <span class="crm-pdf-viewer__brand-name">ObraMate</span>
        </div>
        <h2 class="crm-pdf-viewer__title" id="crmPdfViewerTitle">PDF</h2>
        <a href="#" class="crm-pdf-viewer__download hidden" id="crmPdfViewerDownload" download>Descarregar</a>
      </header>
      <div class="crm-pdf-viewer__body" id="crmPdfViewerBody">
        <p class="crm-pdf-viewer__loading" id="crmPdfViewerLoading">A carregar PDF…</p>
      </div>`;
    document.body.appendChild(root);

    root.querySelector('#crmPdfViewerClose')?.addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);
    return root;
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && root?.classList.contains('is-open')) {
      e.preventDefault();
      close();
    }
  }

  function revokeUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  function setBodyLock(locked) {
    if (locked) {
      // openFromUrl calls open() twice (loading → blob); only lock once so we
      // don't snapshot overflow:"hidden" and restore a frozen page on close.
      if (bodyLocked) return;
      previousBodyOverflow = document.body.style.overflow || '';
      document.body.classList.add('crm-pdf-viewer-open');
      document.body.style.overflow = 'hidden';
      bodyLocked = true;
      return;
    }
    document.body.classList.remove('crm-pdf-viewer-open');
    document.body.style.overflow = previousBodyOverflow || '';
    previousBodyOverflow = '';
    bodyLocked = false;
  }

  function showFrame(src) {
    const body = root.querySelector('#crmPdfViewerBody');
    const loading = root.querySelector('#crmPdfViewerLoading');
    if (loading) loading.remove();
    body.querySelector('.crm-pdf-viewer__frame')?.remove();
    body.querySelector('.crm-pdf-viewer__error')?.remove();
    const embed = document.createElement('embed');
    embed.className = 'crm-pdf-viewer__frame';
    embed.type = 'application/pdf';
    embed.src = src;
    embed.setAttribute('title', root.querySelector('#crmPdfViewerTitle')?.textContent || 'PDF');
    body.appendChild(embed);
  }

  function showError(msg) {
    const body = root.querySelector('#crmPdfViewerBody');
    root.querySelector('#crmPdfViewerLoading')?.remove();
    body.querySelector('.crm-pdf-viewer__frame')?.remove();
    let err = body.querySelector('.crm-pdf-viewer__error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'crm-pdf-viewer__error';
      body.appendChild(err);
    }
    err.textContent = msg;
  }

  function open(opts = {}) {
    const { blob, url, title = 'PDF', filename = 'documento.pdf' } = opts;
    ensureRoot();
    revokeUrl();

    const titleEl = root.querySelector('#crmPdfViewerTitle');
    if (titleEl) titleEl.textContent = title;

    const dl = root.querySelector('#crmPdfViewerDownload');
    let src = url || '';
    if (blob instanceof Blob) {
      currentObjectUrl = URL.createObjectURL(blob);
      src = currentObjectUrl;
    }
    if (dl) {
      if (src) {
        dl.href = src;
        dl.download = filename;
        dl.classList.remove('hidden');
      } else {
        dl.classList.add('hidden');
      }
    }

    const body = root.querySelector('#crmPdfViewerBody');
    body.innerHTML = '<p class="crm-pdf-viewer__loading" id="crmPdfViewerLoading">A carregar PDF…</p>';

    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    setBodyLock(true);

    if (src) {
      showFrame(src);
    } else {
      showError('PDF indisponível.');
    }

    root.querySelector('#crmPdfViewerClose')?.focus();
  }

  function close() {
    if (!root) return;
    // Blur before tearing down so iOS/Safari doesn't leave focus stuck in the PDF embed.
    const active = document.activeElement;
    if (active && root.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    const body = root.querySelector('#crmPdfViewerBody');
    if (body) {
      // Drop the embed first — PDF plugins can keep intercepting touches after hide.
      body.innerHTML = '<p class="crm-pdf-viewer__loading" id="crmPdfViewerLoading">A carregar PDF…</p>';
    }
    revokeUrl();
    setBodyLock(false);
    // Safety: never leave scroll locked if a previous open raced.
    if (document.body.classList.contains('crm-pdf-viewer-open')) {
      document.body.classList.remove('crm-pdf-viewer-open');
    }
    if (document.body.style.overflow === 'hidden' && !bodyLocked) {
      document.body.style.overflow = '';
    }
  }

  async function openFromUrl(url, opts = {}) {
    const { title = 'PDF', filename = 'documento.pdf', fetchInit = {} } = opts;
    ensureRoot();
    open({ title, filename });
    try {
      const r = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/pdf' },
        ...fetchInit,
      });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok) {
        const j = ct.includes('json') ? await r.json().catch(() => ({})) : {};
        throw new Error(j.error || `Erro ao carregar PDF (${r.status})`);
      }
      if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Resposta inválida');
      }
      // If the user already closed while fetch was in flight, don't reopen.
      if (!root.classList.contains('is-open')) return;
      const blob = await r.blob();
      if (!root.classList.contains('is-open')) return;
      open({ blob, title, filename });
    } catch (e) {
      if (!root?.classList.contains('is-open')) return;
      showError(e.message || 'Não foi possível abrir o PDF.');
      window.crmToast?.error?.(e.message || 'Não foi possível abrir o PDF.');
    }
  }

  window.crmPdfViewer = { open, close, openFromUrl };
})();
