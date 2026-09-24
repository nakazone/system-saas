/**
 * Instalar ObraMate como app (PWA) no dispositivo.
 * - Chrome/Edge/Android: beforeinstallprompt → diálogo nativo
 * - iOS / Safari / demais: modal com passos "Adicionar à tela de início"
 */
(function () {
  if (window.__crmPwaInstall) return;

  const DISMISS_KEY = 'crm_pwa_install_dismissed_v1';
  let deferredPrompt = null;

  function isStandalone() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (typeof navigator.standalone === 'boolean' && navigator.standalone) return true;
      if (document.referrer && document.referrer.startsWith('android-app://')) return true;
    } catch (_) {}
    return false;
  }

  function isIos() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isSafari() {
    const ua = navigator.userAgent || '';
    return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|Edg|OPR|Android/i.test(ua);
  }

  function platformKind() {
    if (isStandalone()) return 'installed';
    if (isIos()) return 'ios';
    if (/Android/i.test(navigator.userAgent || '')) return 'android';
    if (/Mac/i.test(navigator.platform || navigator.userAgent || '')) return 'mac';
    if (/Win/i.test(navigator.platform || navigator.userAgent || '')) return 'windows';
    return 'other';
  }

  function setButtonsVisible(visible) {
    document.querySelectorAll('[data-crm-pwa-install]').forEach((el) => {
      el.hidden = !visible;
      el.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }

  function syncVisibility() {
    if (isStandalone()) {
      setButtonsVisible(false);
      return;
    }
    setButtonsVisible(true);
  }

  function instructionsHtml(kind) {
    if (kind === 'ios') {
      return (
        '<ol class="crm-pwa-install__steps">' +
        '<li>Toque em <strong>Compartilhar</strong> (ícone de quadrado com seta) na barra do Safari.</li>' +
        '<li>Role e escolha <strong>Adicionar à Tela de Início</strong>.</li>' +
        '<li>Confirme em <strong>Adicionar</strong> — o ObraMate abre como app.</li>' +
        '</ol>' +
        '<p class="crm-pwa-install__hint">No iPhone/iPad use o Safari (não o Chrome) para instalar.</p>'
      );
    }
    if (kind === 'mac' && isSafari()) {
      return (
        '<ol class="crm-pwa-install__steps">' +
        '<li>No Safari, abra o menu <strong>Arquivo</strong>.</li>' +
        '<li>Escolha <strong>Adicionar ao Dock</strong> (ou “Add to Dock”).</li>' +
        '<li>O ObraMate fica disponível como aplicativo.</li>' +
        '</ol>'
      );
    }
    if (kind === 'android') {
      return (
        '<ol class="crm-pwa-install__steps">' +
        '<li>Toque no menu <strong>⋮</strong> do Chrome.</li>' +
        '<li>Escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</li>' +
        '<li>Confirme — o ícone do ObraMate aparece na tela.</li>' +
        '</ol>'
      );
    }
    if (kind === 'windows' || kind === 'mac' || kind === 'other') {
      return (
        '<ol class="crm-pwa-install__steps">' +
        '<li>No Chrome ou Edge, clique no ícone de <strong>instalar</strong> na barra de endereço (ou menu ⋮).</li>' +
        '<li>Escolha <strong>Instalar ObraMate</strong>.</li>' +
        '<li>O app abre em janela própria, como um programa.</li>' +
        '</ol>' +
        '<p class="crm-pwa-install__hint">Se o botão nativo não aparecer, use Chrome/Edge atualizado e HTTPS.</p>'
      );
    }
    return '<p>Abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”.</p>';
  }

  function ensureModal() {
    let root = document.getElementById('crmPwaInstallModal');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'crmPwaInstallModal';
    root.className = 'crm-pwa-install';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="crm-pwa-install__backdrop" data-crm-pwa-close></div>' +
      '<div class="crm-pwa-install__panel" role="dialog" aria-modal="true" aria-labelledby="crmPwaInstallTitle">' +
      '<button type="button" class="crm-pwa-install__close" data-crm-pwa-close aria-label="Fechar">×</button>' +
      '<div class="crm-pwa-install__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.75">' +
      '<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/>' +
      '</svg></div>' +
      '<h2 id="crmPwaInstallTitle" class="crm-pwa-install__title">Instalar ObraMate</h2>' +
      '<p class="crm-pwa-install__lead">Use o sistema como app no seu dispositivo — sem loja de aplicativos.</p>' +
      '<div id="crmPwaInstallBody" class="crm-pwa-install__body"></div>' +
      '<div class="crm-pwa-install__actions">' +
      '<button type="button" class="btn btn-primary" id="crmPwaInstallPrimary">Instalar agora</button>' +
      '<button type="button" class="btn btn-secondary" data-crm-pwa-close>Agora não</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    root.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('[data-crm-pwa-close]')) closeModal();
    });

    const primary = document.getElementById('crmPwaInstallPrimary');
    if (primary) {
      primary.addEventListener('click', () => {
        void runInstall(true);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('crm-pwa-install--open')) {
        closeModal();
      }
    });

    return root;
  }

  function openModal() {
    const root = ensureModal();
    const kind = platformKind();
    const body = document.getElementById('crmPwaInstallBody');
    const primary = document.getElementById('crmPwaInstallPrimary');
    if (body) body.innerHTML = instructionsHtml(kind);
    if (primary) {
      const canNative = !!deferredPrompt;
      primary.hidden = !canNative;
      primary.textContent = canNative ? 'Instalar agora' : 'Instalar agora';
    }
    root.classList.add('crm-pwa-install--open');
    root.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const root = document.getElementById('crmPwaInstallModal');
    if (!root) return;
    root.classList.remove('crm-pwa-install--open');
    root.setAttribute('aria-hidden', 'true');
  }

  async function runInstall(fromModal) {
    if (isStandalone()) {
      if (typeof window.crmNotify === 'function') {
        window.crmNotify('O ObraMate já está instalado neste dispositivo.', 'info');
      }
      setButtonsVisible(false);
      closeModal();
      return;
    }

    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (choice && choice.outcome === 'accepted') {
          if (typeof window.crmNotify === 'function') {
            window.crmNotify('App instalado. Abra pelo ícone na tela inicial.', 'success');
          }
          setButtonsVisible(false);
          closeModal();
          return;
        }
      } catch (err) {
        console.warn('[pwa-install]', err);
      }
    }

    // Sem prompt nativo: mostrar / manter instruções
    if (!fromModal) openModal();
    else {
      const primary = document.getElementById('crmPwaInstallPrimary');
      if (primary) primary.hidden = true;
    }
  }

  function onInstallClick(e) {
    if (e) e.preventDefault();
    void runInstall(false);
  }

  function bindButtons() {
    document.querySelectorAll('[data-crm-pwa-install]').forEach((el) => {
      if (el.dataset.pwaBound) return;
      el.dataset.pwaBound = '1';
      el.addEventListener('click', onInstallClick);
    });
  }

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  function init() {
    registerSw();
    ensureModal();
    bindButtons();
    syncVisibility();

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      syncVisibility();
      try {
        if (localStorage.getItem(DISMISS_KEY) === '1') return;
      } catch (_) {}
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      setButtonsVisible(false);
      closeModal();
      if (typeof window.crmNotify === 'function') {
        window.crmNotify('ObraMate instalado com sucesso.', 'success');
      }
    });

    // Re-bind se o shell mover nós no DOM
    setTimeout(bindButtons, 500);
  }

  window.openCrmPwaInstall = function () {
    void runInstall(false);
  };

  window.__crmPwaInstall = { init, bindButtons, open: window.openCrmPwaInstall };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
