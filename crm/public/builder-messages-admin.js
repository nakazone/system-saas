/**
 * CRM admin ù builder messaging (conversations list, internal notes, project filter).
 */
/* global crmNotify */
(function () {
  const params = new URLSearchParams(location.search);
  let activeBuilderId = params.get('builder_id') ? parseInt(params.get('builder_id'), 10) : null;
  let adminProjectFilter = '';
  let pollTimer = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDayLabel(iso) {
    if (!iso) return '';
    const day = String(iso).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    if (day === today) return 'Hoje';
    if (day === yesterday) return 'Ontem';
    try {
      return new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return day;
    }
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(iso).slice(11, 16);
    }
  }

  function threadUrl(builderId) {
    let url = `/api/builder-messages/thread/${builderId}?include_internal=1`;
    if (adminProjectFilter === 'general') url += '&general=1';
    else if (adminProjectFilter) url += `&project_id=${encodeURIComponent(adminProjectFilter)}`;
    return url;
  }

  function attachmentHtml(m) {
    if (!m.attachment_url) return '';
    const url = escapeHtml(m.attachment_url);
    if (/\.pdf$/i.test(m.attachment_url)) {
      return `<p class="bp-msg-attach"><a href="${url}" target="_blank" rel="noopener" class="bp-msg-attach-pdf">&#128196; Anexo PDF</a></p>`;
    }
    return `<p class="bp-msg-attach"><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" class="bp-msg-attach-img" loading="lazy" /></a></p>`;
  }

  function renderThread(panel, data) {
    const builder = data.builder;
    const messages = data.messages || [];
    const name = escapeHtml(
      builder?.company || [builder?.first_name, builder?.last_name].filter(Boolean).join(' ') || 'Builder'
    );
    let html = `<header class="bp-msg-header">
      <strong>${name}</strong>
      <div class="bp-msg-filters" style="margin-top:8px">
        <label class="bp-msg-filters__label">Conversa
          <select id="adminProjectFilter" class="bp-msg-filters__select">
            <option value="">Todas as mensagens</option>
            <option value="general"${adminProjectFilter === 'general' ? ' selected' : ''}>Conversas gerais</option>
          </select>
        </label>
      </div>
    </header>`;
    html += '<div class="bp-msg-scroll" id="msgScroll">';
    let lastDate = '';
    messages.forEach((m) => {
      const day = String(m.created_at).slice(0, 10);
      if (day !== lastDate) {
        lastDate = day;
        html += `<div class="bp-msg-date">${escapeHtml(fmtDayLabel(m.created_at))}</div>`;
      }
      const mine = m.sender_type === 'admin';
      const internal = m.is_internal_note === 1 || m.is_internal_note === true;
      const readMark =
        !mine && !internal
          ? m.is_read
            ? ' <span class="bp-msg-read" title="Lida">&#10003;&#10003;</span>'
            : ' <span class="bp-msg-read" title="Enviada">&#10003;</span>'
          : '';
      const body =
        m.message && m.message !== '(attachment)' ? `<p>${escapeHtml(m.message)}</p>` : '';
      const rowClass = mine ? 'bp-msg-row bp-msg-row--mine' : 'bp-msg-row bp-msg-row--sf';
      html += `<div class="${rowClass}">
        <div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine bp-msg-bubble--staff' : 'bp-msg-bubble--sf'} ${internal ? 'bp-msg-bubble--note' : ''}">
          ${body}${internal ? '' : attachmentHtml(m)}
          <span class="bp-msg-time">${escapeHtml(fmtTime(m.created_at))}${readMark}${internal ? ' (nota interna)' : ''}</span>
        </div>
      </div>`;
    });
    if (!messages.length) {
      html += '<p class="bp-muted bp-msg-empty">Sem mensagens nesta conversa.</p>';
    }
    html += '</div>';
    html += `<footer class="bp-msg-compose">
      <label class="bp-msg-internal"><input type="checkbox" id="internalNote" /> Nota interna (sù equipa)</label>
      <textarea id="msgInput" rows="2" placeholder="Escreva uma mensagem..."></textarea>
      <div class="bp-msg-compose__actions">
        <button type="button" class="bp-btn-tan" id="btnSend">Enviar</button>
      </div>
    </footer>`;
    panel.innerHTML = html;
    const scroll = document.getElementById('msgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('btnSend')?.addEventListener('click', sendMessage);
    document.getElementById('adminProjectFilter')?.addEventListener('change', (e) => {
      adminProjectFilter = e.target.value;
      loadAdminThread(activeBuilderId);
    });
    populateAdminProjects(builder?.id);
  }

  async function populateAdminProjects(builderId) {
    if (!builderId) return;
    const sel = document.getElementById('adminProjectFilter');
    if (!sel || sel.dataset.loaded === String(builderId)) return;
    try {
      const r = await fetch(`/api/builders/${builderId}`, { credentials: 'include' });
      const j = await r.json();
      (j.data?.projects || []).forEach((p) => {
        const o = document.createElement('option');
        o.value = String(p.id);
        o.textContent = p.name || p.project_number || `Projeto #${p.id}`;
        if (String(p.id) === String(adminProjectFilter)) o.selected = true;
        sel.appendChild(o);
      });
      sel.dataset.loaded = String(builderId);
    } catch (_) {}
  }

  async function sendMessage() {
    const text = document.getElementById('msgInput')?.value?.trim();
    if (!text || !activeBuilderId) return;
    const body = {
      builder_id: activeBuilderId,
      message: text,
      is_internal_note: !!document.getElementById('internalNote')?.checked,
    };
    if (adminProjectFilter && adminProjectFilter !== 'general') {
      body.project_id = parseInt(adminProjectFilter, 10);
    }
    const r = await fetch('/api/builder-messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      crmNotify?.(j.error || 'Erro', 'error') || alert(j.error || 'Erro');
      return;
    }
    document.getElementById('msgInput').value = '';
    await loadAdminThread(activeBuilderId);
    await loadAdminList();
  }

  async function loadAdminThread(builderId) {
    if (!builderId) return;
    activeBuilderId = builderId;
    const panel = document.getElementById('threadPanel');
    const r = await fetch(threadUrl(builderId), { credentials: 'include' });
    const j = await r.json();
    if (!j.success) {
      panel.innerHTML = '<p class="bp-muted" style="padding:24px">Erro ao carregar thread.</p>';
      return;
    }
    renderThread(panel, j.data);
    document.querySelectorAll('.bp-msg-conv').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.id, 10) === builderId);
    });
    const u = new URL(location.href);
    u.searchParams.set('builder_id', String(builderId));
    history.replaceState(null, '', u.pathname + u.search);
  }

  async function loadAdminList() {
    const r = await fetch('/api/builder-messages/conversations', { credentials: 'include' });
    const j = await r.json();
    const list = document.getElementById('convList');
    const rows = j.data || [];
    if (!rows.length) {
      list.innerHTML = '<p style="padding:12px">Nenhuma conversa ainda.</p>';
      return;
    }
    list.innerHTML = rows
      .map(
        (c) => `<button type="button" class="bp-msg-conv ${c.builder_id === activeBuilderId ? 'active' : ''}" data-id="${c.builder_id}">
          <strong>${escapeHtml(c.company || c.first_name + ' ' + c.last_name)}</strong>
          ${c.unread_count > 0 ? `<span class="bp-badge bp-badge--pending">${c.unread_count}</span>` : ''}
          <p class="bp-muted">${escapeHtml((c.last_message || '').slice(0, 60))}</p>
        </button>`
      )
      .join('');
    list.querySelectorAll('.bp-msg-conv').forEach((btn) => {
      btn.addEventListener('click', () => {
        adminProjectFilter = '';
        const sel = document.getElementById('adminProjectFilter');
        if (sel) delete sel.dataset.loaded;
        loadAdminThread(parseInt(btn.dataset.id, 10));
      });
    });
    if (activeBuilderId) await loadAdminThread(activeBuilderId);
  }

  function startAdminPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (activeBuilderId) {
        loadAdminList();
        loadAdminThread(activeBuilderId);
      }
    }, 30000);
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    await loadAdminList();
    startAdminPolling();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
