/**
 * Builder portal — messages thread (read/send, project filter, attachments).
 */
(function () {
  const params = new URLSearchParams(location.search);
  let projectFilter = params.get('project_id') || '';
  let pollTimer = null;
  let lastMessageCount = 0;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sfBadge() {
    return (
      window.builderPortalCommon?.sfContactBadgeHtml?.('Senior Floors') ||
      '<span class="bp-sf-contact-badge" title="Senior Floors"><img src="/assets/SeniorFloors.png" alt="Senior Floors" width="26" height="26" /></span>'
    );
  }

  function fmtDayLabel(iso) {
    if (!iso) return '';
    const day = String(iso).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    try {
      return new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
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
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(iso).slice(11, 16);
    }
  }

  function threadUrl() {
    let url = '/api/builder-messages/partner/thread';
    if (projectFilter === 'general') url += '?general=1';
    else if (projectFilter) url += `?project_id=${encodeURIComponent(projectFilter)}`;
    return url;
  }

  function attachmentHtml(m) {
    if (!m.attachment_url) return '';
    const url = escapeHtml(m.attachment_url);
    if (/\.pdf$/i.test(m.attachment_url)) {
      return `<p class="bp-msg-attach"><a href="${url}" target="_blank" rel="noopener" class="bp-msg-attach-pdf">&#128196; PDF attachment</a></p>`;
    }
    return `<p class="bp-msg-attach"><a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Attachment" class="bp-msg-attach-img" loading="lazy" /></a></p>`;
  }

  function renderMessages(host, messages) {
    let html = '<div class="bp-msg-scroll" id="msgScroll">';
    let lastDate = '';
    (messages || []).forEach((m) => {
      const day = String(m.created_at).slice(0, 10);
      if (day !== lastDate) {
        lastDate = day;
        html += `<div class="bp-msg-date">${escapeHtml(fmtDayLabel(m.created_at))}</div>`;
      }
      const mine = m.sender_type === 'builder';
      const readMark = mine
        ? m.is_read
          ? ' <span class="bp-msg-read" title="Read by Senior Floors">&#10003;&#10003;</span>'
          : ' <span class="bp-msg-read" title="Sent">&#10003;</span>'
        : '';
      const body = m.message && m.message !== '(attachment)' ? `<p>${escapeHtml(m.message)}</p>` : '';
      const rowClass = mine ? 'bp-msg-row bp-msg-row--mine' : 'bp-msg-row bp-msg-row--sf';
      const avatar = mine ? '' : `<div class="bp-msg-row__avatar">${sfBadge()}</div>`;
      html += `<div class="${rowClass}">
        ${avatar}
        <div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine' : 'bp-msg-bubble--sf'}">
          ${body}${attachmentHtml(m)}
          <span class="bp-msg-time">${escapeHtml(fmtTime(m.created_at))}${readMark}</span>
        </div>
      </div>`;
    });
    if (!(messages || []).length) {
      html +=
        '<p class="bp-muted bp-msg-empty">No messages yet. Say hello to your Senior Floors team.</p>';
    }
    html += '</div>';
    html += `<footer class="bp-msg-compose">
      <textarea id="msgInput" rows="2" placeholder="Write a message..."></textarea>
      <div class="bp-msg-compose__actions">
        <label class="bp-msg-attach-btn" title="Attach image or PDF (max 10MB)">
          <span aria-hidden="true">&#128206;</span>
          <input type="file" id="msgAttach" accept=".jpg,.jpeg,.png,.webp,.pdf" hidden />
        </label>
        <span class="bp-msg-file-name" id="msgFileName"></span>
        <button type="button" class="bp-btn-tan" id="btnSend">Send</button>
      </div>
    </footer>`;
    host.innerHTML = html;
    const scroll = document.getElementById('msgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('btnSend')?.addEventListener('click', () => sendMessage(host));
    document.getElementById('msgAttach')?.addEventListener('change', (e) => {
      const name = e.target.files?.[0]?.name || '';
      const el = document.getElementById('msgFileName');
      if (el) el.textContent = name ? name : '';
    });
    document.getElementById('msgInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(host);
      }
    });
  }

  async function sendMessage(host) {
    const text = document.getElementById('msgInput')?.value?.trim();
    const file = document.getElementById('msgAttach')?.files?.[0];
    if (!text && !file) return;
    const fd = new FormData();
    if (text) fd.append('message', text);
    else fd.append('message', '(attachment)');
    if (file) fd.append('attachment', file);
    if (projectFilter && projectFilter !== 'general') {
      fd.append('project_id', String(parseInt(projectFilter, 10)));
    }
    const r = await window.builderAuth.fetch('/api/builder-messages/partner', { method: 'POST', body: fd });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || 'Send failed');
      return;
    }
    document.getElementById('msgInput').value = '';
    const att = document.getElementById('msgAttach');
    if (att) att.value = '';
    const fn = document.getElementById('msgFileName');
    if (fn) fn.textContent = '';
    await loadThread(host, true);
    window.builderPortalCommon?.refreshUnreadBadges?.();
  }

  async function loadThread(host, forceScroll) {
    const r = await window.builderAuth.fetch(threadUrl());
    const j = await r.json();
    if (!j.success) {
      host.innerHTML = '<p class="bp-card">Could not load messages.</p>';
      return;
    }
    const count = (j.data.messages || []).length;
    const wasAtBottom = (() => {
      const s = document.getElementById('msgScroll');
      if (!s) return true;
      return s.scrollHeight - s.scrollTop - s.clientHeight < 80;
    })();
    renderMessages(host, j.data.messages);
    if (forceScroll || count > lastMessageCount || wasAtBottom) {
      const scroll = document.getElementById('msgScroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }
    lastMessageCount = count;
  }

  async function populateProjectFilter() {
    const sel = document.getElementById('msgProjectFilter');
    if (!sel) return;
    const r = await window.builderAuth.fetch('/api/builder-projects');
    const j = await r.json();
    (j.data || []).forEach((p) => {
      const o = document.createElement('option');
      o.value = String(p.id);
      o.textContent = p.name || p.project_number || `Project #${p.id}`;
      if (String(p.id) === String(projectFilter)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      projectFilter = sel.value;
      lastMessageCount = 0;
      loadThread(document.getElementById('portalThread'), true);
    });
  }

  function startPolling(host) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      await loadThread(host, false);
      window.builderPortalCommon?.refreshUnreadBadges?.();
    }, 30000);
  }

  async function init() {
    const host = document.getElementById('portalThread');
    if (!host) return;
    host.innerHTML = '<p class="bp-muted" style="padding:24px">Loading...</p>';
    await populateProjectFilter();
    await loadThread(host, true);
    startPolling(host);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (boot) boot().then((ok) => ok && init());
    else setTimeout(init, 200);
  });
})();
