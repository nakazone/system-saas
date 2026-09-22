/* global fetch */
(function () {
  const $ = (id) => document.getElementById(id);
  let rows = [];

  async function api(path, opt) {
    const r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...opt,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || r.statusText);
    return j;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    const tb = $('tbody');
    tb.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      const on = Number(r.active) === 1;
      tr.innerHTML = `
        <td class="px-4 py-3 font-medium">${esc(r.name)}</td>
        <td class="px-4 py-3">${esc(r.contact_name)}</td>
        <td class="px-4 py-3">${esc(r.phone)}</td>
        <td class="px-4 py-3">${esc(r.email)}</td>
        <td class="px-4 py-3">${on ? 'Yes' : 'No'}</td>
        <td class="px-4 py-3 text-right space-x-2">
          <button type="button" class="btn btn-sm btn-secondary" data-edit="${r.id}">Edit</button>
          ${on ? `<button type="button" class="btn btn-sm btn-danger" data-del="${r.id}">Deactivate</button>` : ''}
        </td>`;
      tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => edit(Number(b.getAttribute('data-edit'))))
    );
    tb.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => del(Number(b.getAttribute('data-del'))))
    );
  }

  async function load() {
    const all = $('showInactive').checked ? '1' : '0';
    const r = await api('/api/erp/suppliers' + (all === '1' ? '?all=1' : ''));
    rows = r.data || [];
    render();
  }

  function openM() {
    $('modal').classList.remove('hidden');
    $('modal').classList.add('flex');
  }
  function closeM() {
    $('modal').classList.add('hidden');
    $('modal').classList.remove('flex');
    $('formError').classList.add('hidden');
  }

  function edit(id) {
    const r = rows.find((x) => Number(x.id) === id);
    if (!r) return;
    $('editId').value = String(id);
    $('modalTitle').textContent = 'Edit supplier';
    $('fName').value = r.name || '';
    $('fContact').value = r.contact_name || '';
    $('fPhone').value = r.phone || '';
    $('fEmail').value = r.email || '';
    $('fAddress').value = r.address || '';
    $('fNotes').value = r.notes || '';
    $('fActive').checked = Number(r.active) === 1;
    $('activeWrap').classList.remove('hidden');
    openM();
  }

  async function del(id) {
    if (!confirm('Deactivate supplier?')) return;
    await api('/api/erp/suppliers/' + id, { method: 'DELETE' });
    await load();
  }

  async function init() {
    const s = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!s.authenticated) {
      $('authMsg').textContent = 'Log in first.';
      $('authMsg').classList.remove('hidden');
      return;
    }
    $('showInactive').addEventListener('change', load);
    $('btnNew').addEventListener('click', () => {
      $('editId').value = '';
      $('modalTitle').textContent = 'New supplier';
      $('fName').value = '';
      $('fContact').value = '';
      $('fPhone').value = '';
      $('fEmail').value = '';
      $('fAddress').value = '';
      $('fNotes').value = '';
      $('activeWrap').classList.add('hidden');
      openM();
    });
    $('btnCancel').addEventListener('click', closeM);
    $('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeM();
    });
    $('btnSave').addEventListener('click', async () => {
      $('formError').classList.add('hidden');
      const id = $('editId').value.trim();
      const body = {
        name: $('fName').value.trim(),
        contact_name: $('fContact').value.trim() || null,
        phone: $('fPhone').value.trim() || null,
        email: $('fEmail').value.trim() || null,
        address: $('fAddress').value.trim() || null,
        notes: $('fNotes').value.trim() || null,
        active: $('fActive').checked,
      };
      if (!body.name) {
        $('formError').textContent = 'Name required';
        $('formError').classList.remove('hidden');
        return;
      }
      try {
        if (id) await api('/api/erp/suppliers/' + id, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/api/erp/suppliers', { method: 'POST', body: JSON.stringify(body) });
        closeM();
        await load();
      } catch (e) {
        $('formError').textContent = e.message;
        $('formError').classList.remove('hidden');
      }
    });
    await load();
  }

  init().catch((e) => {
    $('authMsg').textContent = e.message;
    $('authMsg').classList.remove('hidden');
  });
})();
