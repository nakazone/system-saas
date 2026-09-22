/**
 * Centro de notificações (sino) — histórico em localStorage.
 */
(function () {
  const STORAGE_KEY = 'sf_crm_notifications_v1';
  const MAX_ITEMS = 300;

  function genId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeAll(items) {
    const trimmed = items.length > MAX_ITEMS ? items.slice(-MAX_ITEMS) : items;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('notification-center: localStorage full', e);
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  let panelOpen = false;
  let wrapEl;
  let btnEl;
  let badgeEl;
  let panelEl;
  let listEl;

  function unreadCount() {
    return readAll().filter((n) => !n.read).length;
  }

  function updateBellBadge() {
    if (!badgeEl) return;
    const n = unreadCount();
    if (n > 0) {
      badgeEl.hidden = false;
      badgeEl.textContent = n > 99 ? '99+' : String(n);
    } else {
      badgeEl.hidden = true;
      badgeEl.textContent = '';
    }
  }

  function setPanelOpen(open) {
    panelOpen = open;
    if (!panelEl || !btnEl) return;
    panelEl.hidden = !open;
    btnEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function runAction(action) {
    if (!action || typeof action !== 'object') return;
    if (action.kind === 'page' && action.page && typeof window.showPage === 'function') {
      window.showPage(action.page);
    } else if (action.kind === 'lead' && action.leadId != null && typeof window.viewLead === 'function') {
      window.viewLead(action.leadId);
    } else if (action.kind === 'url' && action.href) {
      window.location.href = action.href;
    }
  }

  function renderList() {
    if (!listEl) return;
    const items = readAll().slice().reverse();
    if (items.length === 0) {
      listEl.innerHTML =
        '<div class="notification-panel-empty">Nenhuma notificação guardada. Novos avisos de leads e alertas de marketing aparecem aqui.</div>';
      return;
    }
    listEl.innerHTML = items
      .map((it) => {
        const unread = !it.read ? ' notification-item--unread' : '';
        const type = escapeHtml(it.type || 'info');
        return (
          '<div class="notification-item' +
          unread +
          '" data-nid="' +
          escapeHtml(it.id) +
          '" role="button" tabindex="0">' +
          '<div class="notification-item-meta"><span class="notification-item-type">' +
          type +
          '</span><span class="notification-item-time">' +
          escapeHtml(formatTime(it.ts)) +
          '</span></div>' +
          '<div class="notification-item-title">' +
          escapeHtml(it.title) +
          '</div>' +
          (it.body ? '<div class="notification-item-body">' + escapeHtml(it.body) + '</div>' : '') +
          '</div>'
        );
      })
      .join('');

    listEl.querySelectorAll('.notification-item').forEach((row) => {
      const id = row.getAttribute('data-nid');
      const open = () => {
        const all = readAll();
        const it = all.find((x) => x.id === id);
        if (it) {
          it.read = true;
          writeAll(all);
        }
        updateBellBadge();
        row.classList.remove('notification-item--unread');
        if (it && it.action) runAction(it.action);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function addCrmNotification(payload) {
    const title = (payload && payload.title) || 'Notificação';
    const body = (payload && payload.body) || '';
    const type = (payload && payload.type) || 'info';
    const action = payload && payload.action ? payload.action : null;

    const items = readAll();
    items.push({
      id: genId(),
      title,
      body,
      type,
      ts: Date.now(),
      read: false,
      action,
    });
    writeAll(items);
    updateBellBadge();
    if (panelOpen) renderList();
  }

  function markAllRead() {
    const items = readAll().map((n) => ({ ...n, read: true }));
    writeAll(items);
    updateBellBadge();
    renderList();
  }

  function clearAll() {
    if (!confirm('Apagar todo o histórico de notificações neste dispositivo?')) return;
    writeAll([]);
    updateBellBadge();
    renderList();
  }

  function onDocClick(e) {
    if (!wrapEl || !panelOpen) return;
    if (!wrapEl.contains(e.target)) setPanelOpen(false);
  }

  function onKey(e) {
    if (e.key === 'Escape' && panelOpen) {
      setPanelOpen(false);
    }
  }

  function init() {
    wrapEl = document.getElementById('notificationBellWrap');
    btnEl = document.getElementById('notificationBellBtn');
    badgeEl = document.getElementById('notificationBellBadge');
    panelEl = document.getElementById('notificationPanel');
    listEl = document.getElementById('notificationPanelList');
    if (!wrapEl || !btnEl || !panelEl || !listEl) return;

    btnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      setPanelOpen(!panelOpen);
      if (panelOpen) renderList();
    });

    const markAll = document.getElementById('notificationMarkAllRead');
    const clearBtn = document.getElementById('notificationClearAll');
    if (markAll) markAll.addEventListener('click', () => markAllRead());
    if (clearBtn) clearBtn.addEventListener('click', () => clearAll());

    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);

    updateBellBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addCrmNotification = addCrmNotification;
  window.refreshNotificationBell = updateBellBadge;
})();
