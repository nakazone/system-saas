/**
 * Centro de notificações (sino) — histórico em localStorage, em blocos por assunto (recolhíveis).
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
    return clusters(readAll()).filter((c) => c.unread).length;
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

  /* ---------- Blocks, icons and text clean-up ---------- */

  const FOLD_KEY = 'om_nc_fold_v1';
  const FILTER_KEY = 'om_nc_filter_v1';
  const PREVIEW = 4;
  const MATE_FACE = '/assets/img/mascot/mate-head-neutral.webp?v=20261027-m2';

  const ICONS = {
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
    jobs: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
    quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    money: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    builder: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    drop: '<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"/>',
    wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
  };

  const GROUPS = [
    { key: 'mate', label: 'Mate e escritório', icon: 'spark', test: (t) => /^(mate\.|office\.)/.test(t) },
    { key: 'jobs', label: 'Jobs', icon: 'jobs', test: (t) => /^jobs?\./.test(t) },
    { key: 'sales', label: 'Orçamentos e visitas', icon: 'quote', test: (t) => /^(quote|visit|stain|lead)/.test(t) },
    { key: 'money', label: 'Pagamentos', icon: 'money', test: (t) => /^(invoice|payroll|payment)/.test(t) },
    { key: 'chat', label: 'Mensagens', icon: 'chat', test: (t) => /^chat\./.test(t) },
    { key: 'builders', label: 'Builders', icon: 'builder', test: (t) => /^builder/.test(t) },
    { key: 'other', label: 'Outros avisos', icon: 'bell', test: () => true },
  ];

  /** Icon + tone for one notification type (tone: '' | 'ok' | 'warn'). */
  function iconFor(type) {
    if (/^(mate\.|job\.problem$|jobs\.nocrew$)/.test(type)) return { mate: true, tone: type === 'job.problem' ? 'warn' : '' };
    if (type === 'job.problem') return { icon: 'alert', tone: 'warn' };
    if (/^(quote\.signed|quote\.approved|stain\.approved|invoice\.payment|payroll\.paid)$/.test(type)) return { icon: 'check', tone: 'ok' };
    if (type === 'quote.viewed') return { icon: 'eye', tone: '' };
    if (type === 'quote.changes_requested' || type === 'payroll.returned') return { icon: 'alert', tone: 'warn' };
    if (/^visit\./.test(type) || type === 'job.reminder' || type === 'office.reminder') return { icon: 'calendar', tone: '' };
    if (/^stain\./.test(type)) return { icon: 'drop', tone: '' };
    if (/^payroll\./.test(type)) return { icon: 'wallet', tone: '' };
    const g = GROUPS.find((x) => x.test(type));
    return { icon: g ? g.icon : 'bell', tone: '' };
  }

  function svg(name, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.bell) + '</svg>';
  }

  function iconTile(type) {
    const ic = iconFor(type);
    const tone = ic.tone ? ' nc-tile--' + ic.tone : '';
    if (ic.mate) {
      return '<span class="nc-tile nc-tile--mate' + tone + '" aria-hidden="true"><img src="' + MATE_FACE + '" alt="" width="26" height="26" loading="lazy"></span>';
    }
    return '<span class="nc-tile' + tone + '">' + svg(ic.icon) + '</span>';
  }

  /** The office agents write "Marina: …" and a long greeting; keep the facts. */
  function cleanText(it) {
    let title = String(it.title || 'Notificação');
    let body = String(it.body || '');
    let who = '';
    if (/^mate\./.test(String(it.type || ''))) {
      const m = title.match(/^([A-ZÀ-Ý][\wÀ-ÿ]{1,20}):\s+(.+)$/);
      if (m) {
        who = m[1];
        title = m[2];
      }
      body = body
        .replace(/^Oi,\s*aqui é [^.·]+\.\s*(·\s*)?/i, '')
        .replace(/\s*Abra o Escritório para revisar isso comigo\.?\s*$/i, '')
        .replace(/\s*·\s*$/, '')
        .trim();
    }
    return { title, body, who };
  }

  function relTime(ts) {
    const diff = Date.now() - ts;
    if (!(diff >= 0)) return formatTime(ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    const h = Math.floor(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    const d = Math.floor(h / 24);
    if (d === 1) return 'ontem';
    if (d < 7) return 'há ' + d + ' dias';
    try {
      return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    } catch {
      return '';
    }
  }

  /** The same alert repeats (a daily reminder, a pending action re-sent): show it once, newest first. */
  function clusters(items) {
    const map = new Map();
    items.forEach((it) => {
      const key = [it.type || '', it.title || '', it.body || ''].join('\u0001');
      let c = map.get(key);
      if (!c) {
        c = { key, latest: it, items: [], unread: false };
        map.set(key, c);
      }
      c.items.push(it);
      if (!it.read) c.unread = true;
      if ((it.ts || 0) >= (c.latest.ts || 0)) c.latest = it;
    });
    return [...map.values()].sort((a, b) => (b.latest.ts || 0) - (a.latest.ts || 0));
  }

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  let folded = readJson(FOLD_KEY, {});
  let filter = readJson(FILTER_KEY, 'all') === 'unread' ? 'unread' : 'all';
  const expanded = {};

  function renderItem(c) {
    const it = c.latest;
    const t = cleanText(it);
    const repeat = c.items.length > 1 ? '<span class="nc-item__repeat">' + c.items.length + '×</span>' : '';
    const kicker = t.who ? '<span class="nc-item__who">' + escapeHtml(t.who) + '</span>' : '';
    return (
      '<button type="button" class="nc-item' + (c.unread ? ' is-unread' : '') + '" data-nc-key="' + escapeHtml(c.latest.id) + '">' +
      iconTile(String(it.type || '')) +
      '<span class="nc-item__main">' +
      '<span class="nc-item__top">' + kicker + '<span class="nc-item__time">' + escapeHtml(relTime(it.ts)) + '</span>' + repeat + '</span>' +
      '<span class="nc-item__title">' + escapeHtml(t.title) + '</span>' +
      (t.body ? '<span class="nc-item__body">' + escapeHtml(t.body) + '</span>' : '') +
      '</span>' +
      (c.unread ? '<span class="nc-item__dot" aria-label="Não lida"></span>' : '') +
      '</button>'
    );
  }

  function renderList() {
    if (!listEl) return;
    const all = clusters(readAll());
    const unread = all.filter((c) => c.unread).length;
    const unreadEl = document.getElementById('ncUnread');
    if (unreadEl) {
      unreadEl.hidden = !unread;
      unreadEl.textContent = unread === 1 ? '1 nova' : unread + ' novas';
    }
    if (panelEl) {
      panelEl.querySelectorAll('[data-nc-filter]').forEach((b) => {
        b.setAttribute('aria-pressed', b.getAttribute('data-nc-filter') === filter ? 'true' : 'false');
      });
      const markAll = document.getElementById('notificationMarkAllRead');
      if (markAll) markAll.disabled = !unread;
      const clearBtn = document.getElementById('notificationClearAll');
      if (clearBtn) clearBtn.disabled = !all.length;
    }

    const shown = filter === 'unread' ? all.filter((c) => c.unread) : all;
    if (!shown.length) {
      const msg = all.length ? 'Nada novo por aqui.' : 'Nenhuma notificação ainda.';
      const sub = all.length
        ? 'Você já viu tudo. Toque em “Todas” para rever o histórico.'
        : 'Novos leads, propostas assinadas, pagamentos e avisos do Mate aparecem aqui.';
      listEl.innerHTML =
        '<div class="nc-empty"><img src="/assets/img/mascot/mate-celebrate.webp?v=20261027-m2" alt="" width="84" height="76" loading="lazy">' +
        '<strong>' + msg + '</strong><span>' + sub + '</span></div>';
      return;
    }

    const byGroup = new Map();
    shown.forEach((c) => {
      const g = GROUPS.find((x) => x.test(String(c.latest.type || '')));
      if (!byGroup.has(g.key)) byGroup.set(g.key, []);
      byGroup.get(g.key).push(c);
    });

    // Blocks with the newest news first (clusters are already newest-first inside each block).
    const order = GROUPS.filter((g) => byGroup.has(g.key)).sort(
      (a, b) => (byGroup.get(b.key)[0].latest.ts || 0) - (byGroup.get(a.key)[0].latest.ts || 0),
    );
    listEl.innerHTML = order
      .map((g) => {
        const rows = byGroup.get(g.key);
        const gUnread = rows.filter((c) => c.unread).length;
        const isFolded = !!folded[g.key];
        const limit = expanded[g.key] ? rows.length : PREVIEW;
        const more = rows.length - limit;
        return (
          '<section class="nc-grp' + (isFolded ? ' is-folded' : '') + '" data-nc-group="' + g.key + '">' +
          '<button type="button" class="nc-grp__head" aria-expanded="' + (isFolded ? 'false' : 'true') + '" aria-controls="nc-g-' + g.key + '">' +
          '<span class="nc-grp__icon">' + svg(g.icon) + '</span>' +
          '<span class="nc-grp__label">' + escapeHtml(g.label) + '</span>' +
          (gUnread ? '<span class="nc-grp__badge">' + gUnread + '</span>' : '<span class="nc-grp__total">' + rows.length + '</span>') +
          svg('chevron', 'nc-grp__chev') +
          '</button>' +
          '<div class="nc-grp__body" id="nc-g-' + g.key + '"><div class="nc-grp__inner">' +
          rows.slice(0, limit).map(renderItem).join('') +
          (more > 0 ? '<button type="button" class="nc-grp__more" data-nc-more="' + g.key + '">Ver mais ' + more + '</button>' : '') +
          '</div></div>' +
          '</section>'
        );
      })
      .join('');
  }

  function openCluster(key) {
    const all = readAll();
    const c = clusters(all).find((x) => x.latest.id === key);
    if (!c) return;
    const ids = new Set(c.items.map((x) => x.id));
    const serverIds = [];
    all.forEach((x) => {
      if (ids.has(x.id) && !x.read) {
        x.read = true;
        if (x.serverId) serverIds.push(x.serverId);
      }
    });
    writeAll(all);
    if (serverIds.length) {
      fetch('/api/notifications/read', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: serverIds.slice(0, 100) }),
      }).catch(function () {});
    }
    updateBellBadge();
    renderList();
    if (c.latest.action) {
      setPanelOpen(false);
      runAction(c.latest.action);
    }
  }

  function onListClick(e) {
    const head = e.target.closest('.nc-grp__head');
    if (head) {
      const grp = head.closest('[data-nc-group]');
      const key = grp.getAttribute('data-nc-group');
      folded[key] = !folded[key];
      if (!folded[key]) delete folded[key];
      writeJson(FOLD_KEY, folded);
      grp.classList.toggle('is-folded', !!folded[key]);
      head.setAttribute('aria-expanded', folded[key] ? 'false' : 'true');
      return;
    }
    const more = e.target.closest('[data-nc-more]');
    if (more) {
      expanded[more.getAttribute('data-nc-more')] = true;
      renderList();
      return;
    }
    const item = e.target.closest('[data-nc-key]');
    if (item) openCluster(item.getAttribute('data-nc-key'));
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

  async function clearAll() {
    var ok = window.crmConfirm
      ? await window.crmConfirm({
          title: 'Apagar todas as notificações?',
          text: 'O histórico de notificações deste aparelho fica vazio.',
          ok: 'Apagar tudo',
          danger: true,
        })
      : false;
    if (!ok) return;
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
    if (!e.target.isConnected) return;
    if (!wrapEl.contains(e.target)) setPanelOpen(false);
  }

  function onKey(e) {
    if (e.key === 'Escape' && panelOpen) {
      setPanelOpen(false);
      if (btnEl) btnEl.focus();
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
    listEl.addEventListener('click', onListClick);
    panelEl.querySelectorAll('[data-nc-filter]').forEach((b) => {
      b.addEventListener('click', () => {
        filter = b.getAttribute('data-nc-filter') === 'unread' ? 'unread' : 'all';
        writeJson(FILTER_KEY, filter);
        renderList();
      });
    });

    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);

    updateBellBadge();
    pullServerNotifications();
    pullOfficePendingActions();
    // Push messages refresh at once; the timer is only a fallback, and a hidden tab skips it
    // (it catches up on visibilitychange below).
    if (!pollTimer) pollTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      pullServerNotifications();
      pullOfficePendingActions();
    }, 60000);
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
