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
        <button type="button" class="crm-pdf-viewer__close" id="crmPdfViewerClose" aria-label="Voltar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Voltar
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

  let pdfJsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        const lib = window.pdfjsLib;
        if (!lib) {
          reject(new Error('PDF indisponível.'));
          return;
        }
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(lib);
      };
      s.onerror = () => reject(new Error('Não foi possível carregar o visualizador de PDF.'));
      document.head.appendChild(s);
    });
    return pdfJsPromise;
  }

  /** Draw pages ourselves so the Voltar bar stays above the PDF on tablet. */
  async function renderBlob(blob) {
    const body = root.querySelector('#crmPdfViewerBody');
    body.innerHTML = '<div class="crm-pdf-viewer__pages" id="crmPdfPages"><p class="crm-pdf-viewer__loading">A carregar PDF…</p></div>';
    const host = body.querySelector('#crmPdfPages');
    try {
      const lib = await loadPdfJs();
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!root.classList.contains('is-open')) return;
      const pdf = await lib.getDocument({ data }).promise;
      if (!root.classList.contains('is-open') || !host || !host.isConnected) return;
      host.innerHTML = '';
      const width = Math.max(280, host.clientWidth - 24);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!root.classList.contains('is-open')) return;
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        host.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const renderOpts = { canvasContext: ctx, viewport };
        if (dpr !== 1) renderOpts.transform = [dpr, 0, 0, dpr, 0, 0];
        await page.render(renderOpts).promise;
      }
    } catch (e) {
      if (!root?.classList.contains('is-open')) return;
      showError(e.message || 'Não foi possível mostrar o PDF.');
    }
  }

  function showError(msg) {
    const body = root.querySelector('#crmPdfViewerBody');
    root.querySelector('#crmPdfViewerLoading')?.remove();
    body.querySelector('.crm-pdf-viewer__pages')?.remove();
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

    if (blob instanceof Blob) {
      void renderBlob(blob);
    } else if (!src) {
      /* openFromUrl shows the bar first, then paints pages when the file arrives */
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
