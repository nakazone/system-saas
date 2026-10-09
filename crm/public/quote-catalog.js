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

  function money(n) {
    const x = Number(n) || 0;
    return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function unitLabel(u) {
    const m = { sq_ft: 'Sq ft', linear_ft: 'Linear ft', inches: 'Inches', fixed: 'Fixed' };
    return m[u] || u || '—';
  }

  function effectiveBuilder(r) {
    return r.rate_builder != null ? r.rate_builder : r.default_rate != null ? r.default_rate : r.unit_price;
  }

  function effectiveCustomer(r) {
    return r.rate_customer != null ? r.rate_customer : r.default_rate != null ? r.default_rate : r.unit_price;
  }

  function setCatalogTab(which) {
    const builder = which === 'builder';
    $('panelBuilder').classList.toggle('hidden', !builder);
    $('panelCustomer').classList.toggle('hidden', builder);
    document.querySelectorAll('.catalog-tab').forEach((btn) => {
      const on = btn.getAttribute('data-catalog-tab') === which;
      btn.classList.toggle('catalog-tab--active', on);
    });
  }

  function openModal() {
    $('modal').classList.remove('hidden');
    $('modal').classList.add('flex');
  }

  function closeModal() {
    $('modal').classList.add('hidden');
    $('modal').classList.remove('flex');
    $('formError').classList.add('hidden');
  }

  function render() {
    const tb = $('tbody');
    const empty = $('empty');
    tb.innerHTML = '';
    if (!rows.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      const active = r.active == null || r.active === true || Number(r.active) === 1;
      if (!active) tr.className = 'is-off';
      tr.innerHTML = `
        <td class="qx-ctable__name">${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.category || r.service_type || '—')}</td>
        <td>${unitLabel(r.unit_type)}</td>
        <td class="r b">${money(effectiveBuilder(r))}</td>
        <td class="r b">${money(effectiveCustomer(r))}</td>
        <td>${active ? '<span class="qx-pill qx-pill--ol"><i></i>Ativo</span>' : '<span class="qx-pill qx-pill--mu"><i></i>Inativo</span>'}</td>
        <td class="r qx-ctable__acts">
          <button type="button" class="qx-btn qx-btn--sm" data-edit="${escapeHtml(r.id)}">Editar</button>
          ${active ? `<button type="button" class="qx-btn qx-btn--sm qx-btn--quiet" data-del="${escapeHtml(r.id)}">Desativar</button>` : `<button type="button" class="qx-btn qx-btn--sm" data-rest="${escapeHtml(r.id)}">Reativar</button>`}
        </td>`;
      tb.appendChild(tr);
    });

    tb.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => edit(b.getAttribute('data-edit')));
    });
    tb.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', () => deactivate(b.getAttribute('data-del')));
    });
    tb.querySelectorAll('[data-rest]').forEach((b) => {
      b.addEventListener('click', () => reactivate(b.getAttribute('data-rest')));
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function rowById(arr, id) {
    const n = id;
    return arr.find((x) => String(x.id) === String(n));
  }

  async function load() {
    const all = $('showInactive').checked ? '1' : '0';
    const r = await api('/api/quote-catalog' + (all === '1' ? '?all=1' : ''));
    if (r.message && String(r.message).includes('migrate')) {
      $('migrateMsg').textContent = r.message + ' — npm run migrate:quotes-module';
      $('migrateMsg').classList.remove('hidden');
    }
    rows = r.data || [];
    render();
  }

  function resetForm() {
    $('editId').value = '';
    $('modalTitle').textContent = 'Novo serviço';
    $('fName').value = '';
    $('fCategory').value = 'Installation';
    $('fUnit').value = 'sq_ft';
    $('fRateBuilder').value = '';
    $('fRateCustomer').value = '';
    $('fNotesBuilder').value = '';
    $('fNotesCustomer').value = '';
    $('fDesc').value = '';
    $('fActive').checked = true;
    $('fActiveWrap').classList.add('hidden');
    setCatalogTab('builder');
  }

  function edit(id) {
    const row = rowById(rows, id);
    if (!row) return;
    $('editId').value = String(id);
    $('modalTitle').textContent = 'Editar serviço';
    $('fName').value = row.name || '';
    $('fCategory').value = row.category || 'Installation';
    $('fUnit').value = row.unit_type || 'sq_ft';
    const b = effectiveBuilder(row);
    const c = effectiveCustomer(row);
    $('fRateBuilder').value = b != null ? b : '';
    $('fRateCustomer').value = c != null ? c : '';
    $('fNotesBuilder').value = row.notes_builder || '';
    $('fNotesCustomer').value = row.notes_customer || '';
    $('fDesc').value = row.default_description || '';
    $('fActive').checked = row.active == null || row.active === true || Number(row.active) === 1;
    $('fActiveWrap').classList.remove('hidden');
    setCatalogTab('builder');
    openModal();
  }

  async function deactivate(id) {
    if (!confirm('Desativar este item? Deixará de aparecer no Quote (pode reativar depois).')) return;
    await api('/api/quote-catalog/' + id, { method: 'DELETE' });
    await load();
  }

  async function reactivate(id) {
    const row = rowById(rows, id);
    if (!row) return;
    const b = Number(effectiveBuilder(row)) || 0;
    const c = Number(effectiveCustomer(row)) || 0;
    await api('/api/quote-catalog/' + id, {
      method: 'PUT',
      body: JSON.stringify({
        name: row.name,
        category: row.category,
        rate_builder: b,
        rate_customer: c,
        default_rate: c,
        unit_type: row.unit_type,
        default_description: row.default_description,
        notes_builder: row.notes_builder || null,
        notes_customer: row.notes_customer || null,
        active: true,
      }),
    });
    await load();
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((x) => x.json());
    if (!sess.authenticated) {
      $('authMsg').textContent = 'Inicie sessão no CRM para gerir o catálogo.';
      $('authMsg').classList.remove('hidden');
      return;
    }

    document.querySelectorAll('[data-catalog-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setCatalogTab(btn.getAttribute('data-catalog-tab')));
    });

    $('showInactive').addEventListener('change', load);
    $('btnNew').addEventListener('click', () => {
      resetForm();
      openModal();
    });
    $('btnCancel').addEventListener('click', closeModal);
    $('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('formError').classList.add('hidden');
      const id = $('editId').value.trim();
      const rb = parseFloat($('fRateBuilder').value);
      const rc = parseFloat($('fRateCustomer').value);
      if (!Number.isFinite(rb) || rb < 0 || !Number.isFinite(rc) || rc < 0) {
        $('formError').textContent = 'Preços Builder e cliente final devem ser números ≥ 0.';
        $('formError').classList.remove('hidden');
        return;
      }
      const body = {
        name: $('fName').value.trim(),
        category: $('fCategory').value,
        unit_type: $('fUnit').value,
        rate_builder: rb,
        rate_customer: rc,
        default_rate: rc,
        default_description: $('fDesc').value.trim() || null,
        notes_builder: $('fNotesBuilder').value.trim() || null,
        notes_customer: $('fNotesCustomer').value.trim() || null,
        active: $('fActive').checked,
      };
      try {
        if (id) {
          await api('/api/quote-catalog/' + id, { method: 'PUT', body: JSON.stringify(body) });
        } else {
          delete body.active;
          await api('/api/quote-catalog', { method: 'POST', body: JSON.stringify(body) });
        }
        closeModal();
        await load();
      } catch (err) {
        $('formError').textContent = err.message;
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
