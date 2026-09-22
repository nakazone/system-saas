/* global crmNotify */
(function () {
  const STATUS_OPTIONS = [
    { value: 'pending', label: 'Submitted' },
    { value: 'reviewing', label: 'Under review' },
    { value: 'quoted', label: 'Quote sent' },
    { value: 'won', label: 'Accepted' },
    { value: 'lost', label: 'Declined' },
  ];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function statusLabel(v) {
    return STATUS_OPTIONS.find((o) => o.value === v)?.label || v || '—';
  }

  async function load() {
    const st = document.getElementById('filterSt').value;
    const url = st ? `/api/estimate-requests?status=${encodeURIComponent(st)}` : '/api/estimate-requests';
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    const tbody = document.getElementById('estTbody');
    if (!j.success || !j.data.length) {
      tbody.innerHTML = '<tr><td colspan="8">Nenhum pedido.</td></tr>';
      return;
    }
    tbody.innerHTML = j.data
      .map((e) => {
        const opts = STATUS_OPTIONS.map(
          (o) =>
            `<option value="${o.value}" ${String(e.status).toLowerCase() === o.value || (o.value === 'reviewing' && e.status === 'in_review') ? 'selected' : ''}>${o.label}</option>`
        ).join('');
        return `<tr>
          <td><strong>${escapeHtml(e.ref_number)}</strong></td>
          <td>${escapeHtml(e.company || `${e.first_name || ''} ${e.last_name || ''}`.trim())}</td>
          <td>${escapeHtml((e.address || '').slice(0, 40))}</td>
          <td>${e.area_sqft || '—'}</td>
          <td>${escapeHtml(statusLabel(e.status === 'in_review' ? 'reviewing' : e.status))}</td>
          <td>${e.lead_id ? `<a href="lead-detail.html?id=${e.lead_id}">#${e.lead_id}</a>` : '—'}</td>
          <td>${escapeHtml(String(e.created_at).slice(0, 10))}</td>
          <td><select data-id="${e.id}" class="st-sel">${opts}</select></td>
        </tr>`;
      })
      .join('');
    tbody.querySelectorAll('.st-sel').forEach((sel) => {
      sel.addEventListener('change', async () => {
        await fetch(`/api/estimate-requests/${sel.dataset.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: sel.value }),
        });
        crmNotify('Status atualizado.', 'success');
        load();
      });
    });
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    const filter = document.getElementById('filterSt');
    if (filter && !filter.options.length) {
      STATUS_OPTIONS.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        filter.appendChild(opt);
      });
      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'All statuses';
      filter.insertBefore(all, filter.firstChild);
    }
    filter.addEventListener('change', load);
    load();
  }

  init();
})();
