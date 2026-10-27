/**
 * Centro de notificações (sino) — histórico em localStorage.
 */
(function () {
  const STORAGE_KEY = 'sf_crm_notifications_v1';
  const MAX_ITEMS = 300;
  const OFFICE_PENDING_POLL_KEY = 'om.office.pending-poll.v1';
  const OFFICE_PENDING_POLL_MS = 5 * 60 * 1000;

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
        '<div class="notification-panel-empty">Nenhuma notificação. Novos leads, propostas assinadas, alterações e pagamentos aparecem aqui.</div>';
      return;
    }
    listEl.innerHTML = items
      .map((it) => {
        const unread = !it.read ? ' notification-item--unread' : '';
        const type = escapeHtml(it.type || 'info');
        // Alerts the Mate sends himself show his face (fox mascot).
        const mate = /^(mate\.|job\.problem$|jobs\.nocrew$)/.test(String(it.type || ''))
          ? '<span class="notification-item-mate" aria-hidden="true" style="display:inline-block;width:20px;height:20px;margin-right:6px;border-radius:50%;overflow:hidden;background:#F1F3F5;vertical-align:-5px"><img src="/assets/img/mascot/mate-head-neutral.webp?v=20261026-m1" alt="" width="20" height="20" style="display:block;width:100%;height:100%;object-fit:cover"></span>'
          : '';
        return (
          '<div class="notification-item' +
          unread +
          '" data-nid="' +
          escapeHtml(it.id) +
          '" role="button" tabindex="0">' +
          '<div class="notification-item-meta"><span class="notification-item-type">' +
          mate +
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
          if (it.serverId) {
            fetch('/api/notifications/read', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: [it.serverId] }),
            }).catch(function () {});
          }
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
    fetch('/api/notifications/read', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(function () {});
  }

  function clearAll() {
    if (!confirm('Apagar todo o histórico de notificações neste dispositivo?')) return;
    writeAll([]);
    updateBellBadge();
    renderList();
    fetch('/api/notifications', { method: 'DELETE', credentials: 'include' }).catch(function () {});
  }

  function mergeServerItems(rows) {
    const localOnly = readAll().filter(function (n) { return !n.serverId; });
    const mapped = (rows || []).map(function (it) {
      return {
        id: 'srv-' + it.id,
        serverId: it.id,
        title: it.title || 'Notificação',
        body: it.body || '',
        type: it.type || 'info',
        ts: it.createdAt ? new Date(it.createdAt).getTime() : Date.now(),
        read: !!it.readAt,
        action: it.url ? { kind: 'url', href: it.url } : null,
      };
    });
    const merged = localOnly.concat(mapped);
    merged.sort(function (a, b) { return a.ts - b.ts; });
    writeAll(merged);
    updateBellBadge();
    if (panelOpen) renderList();
  }

  var pollTimer = null;
  function pullServerNotifications() {
    return fetch('/api/notifications', { credentials: 'include' })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) return null;
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (json) {
        if (!json || !json.success || !json.data) return;
        mergeServerItems(json.data.items || []);
      })
      .catch(function () {});
  }

  function pullOfficePendingActions() {
    if (document.body && document.body.classList.contains('office-page-body')) return Promise.resolve();
    var last = 0;
    try { last = Number(localStorage.getItem(OFFICE_PENDING_POLL_KEY)) || 0; } catch (_) {}
    if (Date.now() - last < OFFICE_PENDING_POLL_MS) return Promise.resolve();
    try { localStorage.setItem(OFFICE_PENDING_POLL_KEY, String(Date.now())); } catch (_) {}
    return fetch('/api/mate-ai/suggestions', { credentials: 'include', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (json && json.success) return pullServerNotifications();
        return null;
      })
      .catch(function () {});
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
    pullServerNotifications();
    pullOfficePendingActions();
    if (!pollTimer) pollTimer = setInterval(function () {
      pullServerNotifications();
      pullOfficePendingActions();
    }, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        pullServerNotifications();
        pullOfficePendingActions();
      }
    });
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (event) {
        if (event.data && event.data.type === 'om-push') pullServerNotifications();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addCrmNotification = addCrmNotification;
  window.refreshNotificationBell = updateBellBadge;
  window.pullCrmNotifications = pullServerNotifications;
})();
