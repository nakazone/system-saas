/**
 * Web Push — ativar alertas no dispositivo (PWA / iOS Home Screen + Android/Desktop).
 */
(function () {
  function isStandalone() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (typeof navigator.standalone === 'boolean' && navigator.standalone) return true;
    } catch (_) {}
    return false;
  }

  function isIos() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === 'function') window.crmNotify(msg, type || 'info');
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function ensureSw() {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker não suportado neste navegador.');
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function getPublicKey() {
    const r = await fetch('/api/push/vapid-public-key', { credentials: 'include', cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.success || !j.data?.publicKey) throw new Error(j.error || 'Chave push indisponível');
    return j.data.publicKey;
  }

  async function enablePush() {
    if (!('Notification' in window) || !('PushManager' in window)) {
      throw new Error('Notificações push não são suportadas neste navegador.');
    }
    if (isIos() && !isStandalone()) {
      throw new Error(
        'No iPhone/iPad: instale o ObraMate na Tela de Início e abra pelo ícone para ativar alertas.'
      );
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Permissão de notificação negada. Ative nas configurações do dispositivo.');
    }

    const reg = await ensureSw();
    const publicKey = await getPublicKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const json = sub.toJSON();
    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || 'Falha ao registar dispositivo');
    return true;
  }

  async function disablePush() {
    const reg = await ensureSw();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try {
        await sub.unsubscribe();
      } catch (_) {}
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    } else {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    }
  }

  async function refreshStatus() {
    const btns = document.querySelectorAll('[data-crm-push-enable]');
    const statusEls = document.querySelectorAll('[data-crm-push-status]');
    let subscribed = false;
    try {
      const r = await fetch('/api/push/status', { credentials: 'include', cache: 'no-store' });
      const j = await r.json();
      if (j.success) subscribed = !!j.data?.subscribed;
    } catch (_) {}

    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
    btns.forEach((btn) => {
      if (subscribed) {
        btn.textContent = btn.getAttribute('data-label-on') || 'Alertas ativos';
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('is-active');
      } else {
        btn.textContent = btn.getAttribute('data-label-off') || 'Ativar alertas';
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('is-active');
      }
    });
    statusEls.forEach((el) => {
      if (subscribed) el.textContent = 'Alertas push ativos neste dispositivo.';
      else if (isIos() && !isStandalone()) {
        el.textContent = 'No iPhone/iPad: instale o app e abra pelo ícone para ativar.';
      } else if (perm === 'denied') {
        el.textContent = 'Notificações bloqueadas no navegador/dispositivo.';
      } else {
        el.textContent = 'Receba avisos de novos leads mesmo com o app fechado.';
      }
    });
    return subscribed;
  }

  async function onEnableClick(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const wasOn = btn.getAttribute('aria-pressed') === 'true';
    btn.disabled = true;
    try {
      if (wasOn) {
        await disablePush();
        notify('Alertas desativados neste dispositivo.', 'info');
      } else {
        await enablePush();
        notify('Alertas ativados! Você receberá novos leads neste dispositivo.', 'success');
      }
      await refreshStatus();
    } catch (err) {
      notify(err.message || 'Não foi possível alterar alertas.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function bind() {
    document.querySelectorAll('[data-crm-push-enable]').forEach((btn) => {
      if (btn.dataset.pushBound) return;
      btn.dataset.pushBound = '1';
      btn.addEventListener('click', onEnableClick);
    });
  }

  function init() {
    if (!('serviceWorker' in navigator)) return;
    bind();
    refreshStatus().catch(() => {});
    setTimeout(bind, 800);
  }

  window.enableCrmPush = enablePush;
  window.disableCrmPush = disablePush;
  window.refreshCrmPushStatus = refreshStatus;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
