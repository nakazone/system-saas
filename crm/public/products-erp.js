/* global fetch */
(function () {
  const $ = (id) => document.getElementById(id);
  let products = [];
  let suppliers = [];

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
    return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  async function loadMargins() {
    const r = await api('/api/erp/category-margins');
    const wrap = $('marginsList');
    wrap.innerHTML = '';
    (r.data || []).forEach((row) => {
      const cat = String(row.category);
      const div = document.createElement('div');
      div.className = 'flex items-center gap-2 border rounded-lg px-3 py-2';
      div.innerHTML = `<span class="font-medium w-28">${esc(cat)}</span>
        <input type="number" step="0.01" min="0" data-cat="${esc(cat)}" value="${row.margin_percentage}" class="border rounded px-2 py-1 w-24 text-sm" />
        <span class="text-slate-500">%</span>
        <button type="button" class="btn btn-sm btn-primary ml-auto save-margin" data-cat="${esc(cat)}">Save</button>`;
      wrap.appendChild(div);
    });
    wrap.querySelectorAll('.save-margin').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cat = btn.getAttribute('data-cat');
        const inp = btn.closest('div').querySelector('input[type="number"]');
        const margin_percentage = parseFloat(inp.value);
        try {
          await api('/api/erp/category-margins', {
            method: 'PUT',
            body: JSON.stringify({ category: cat, margin_percentage }),
          });
          btn.textContent = 'Saved';
          setTimeout(() => {
            btn.textContent = 'Save';
          }, 1200);
        } catch (e) {
          if (typeof crmNotify === 'function') crmNotify(e.message, 'error');
          else alert(e.message);
        }
      });
    });
  }

  function fillSupplierSelects() {
    const fs = $('fSupplier');
    const ff = $('filterSupplier');
    const opts = '<option value="">All suppliers</option>' + suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    ff.innerHTML = opts;
    fs.innerHTML = suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }

  async function loadProducts() {
    const sid = $('filterSupplier').value;
    const q = $('filterQ').value.trim();
    const all = $('showInactive').checked ? '1' : '0';
    let url = '/api/erp/products?limit=500&all=' + all;
    if (sid) url += '&supplier_id=' + encodeURIComponent(sid);
    if (q) url += '&q=' + encodeURIComponent(q);
    const r = await api(url);
    products = r.data || [];
    renderTable();
  }

  function renderTable() {
    const tb = $('tbody');
    tb.innerHTML = '';
    products.forEach((p) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100';
      const on = Number(p.active) === 1;
      tr.innerHTML = `
        <td class="px-3 py-2">${esc(p.supplier_name)}</td>
        <td class="px-3 py-2 font-medium">${esc(p.name)}</td>
        <td class="px-3 py-2">${esc(p.category)}</td>
        <td class="px-3 py-2">${esc(p.unit_type)}</td>
        <td class="px-3 py-2 text-right font-mono">${money(p.cost_price)}</td>
        <td class="px-3 py-2">${esc(p.sku)}</td>
        <td class="px-3 py-2">${on ? 'Yes' : 'No'}</td>
        <td class="px-3 py-2 text-right space-x-2">
          <button type="button" class="btn btn-sm btn-secondary" data-edit="${p.id}">Edit</button>
          ${on ? `<button type="button" class="btn btn-sm btn-danger" data-del="${p.id}">Deactivate</button>` : ''}
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
    const p = products.find((x) => Number(x.id) === id);
    if (!p) return;
    $('editId').value = String(id);
    $('modalTitle').textContent = 'Edit product';
    $('fSupplier').value = String(p.supplier_id);
    $('fName').value = p.name || '';
    $('fCategory').value = p.category || 'Hardwood';
    $('fUnit').value = p.unit_type || 'sq_ft';
    $('fCost').value = p.cost_price ?? '';
    $('fSku').value = p.sku || '';
    $('fDesc').value = p.description || '';
    $('fStock').value = p.stock_qty != null ? p.stock_qty : '';
    $('fActive').checked = Number(p.active) === 1;
    $('activeWrap').classList.remove('hidden');
    openM();
  }

  async function del(id) {
    if (!confirm('Deactivate product?')) return;
    await api('/api/erp/products/' + id, { method: 'DELETE' });
    await loadProducts();
  }

  async function init() {
    const s = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!s.authenticated) {
      $('authMsg').textContent = 'Log in first.';
      $('authMsg').classList.remove('hidden');
      return;
    }

    const supR = await api('/api/erp/suppliers?all=1').catch(() => ({ data: [] }));
    suppliers = supR.data || [];
    fillSupplierSelects();

    await loadMargins();
    await loadProducts();

    $('filterSupplier').addEventListener('change', loadProducts);
    $('filterQ').addEventListener(
      'input',
      debounce(loadProducts, 350)
    );
    $('showInactive').addEventListener('change', loadProducts);
    $('btnReload').addEventListener('click', loadProducts);

    $('btnNew').addEventListener('click', () => {
      $('editId').value = '';
      $('modalTitle').textContent = 'New product';
      if (suppliers[0]) $('fSupplier').value = String(suppliers[0].id);
      $('fName').value = '';
      $('fCategory').value = 'Hardwood';
      $('fUnit').value = 'sq_ft';
      $('fCost').value = '';
      $('fSku').value = '';
      $('fDesc').value = '';
      $('fStock').value = '';
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
        supplier_id: parseInt($('fSupplier').value, 10),
        name: $('fName').value.trim(),
        category: $('fCategory').value,
        unit_type: $('fUnit').value,
        cost_price: parseFloat($('fCost').value),
        sku: $('fSku').value.trim() || null,
        description: $('fDesc').value.trim() || null,
        stock_qty: $('fStock').value.trim() === '' ? null : parseInt($('fStock').value, 10),
        active: $('fActive').checked,
      };
      if (!body.name || !body.supplier_id) {
        $('formError').textContent = 'Name and supplier required';
        $('formError').classList.remove('hidden');
        return;
      }
      try {
        if (id) await api('/api/erp/products/' + id, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/api/erp/products', { method: 'POST', body: JSON.stringify(body) });
        closeM();
        await loadProducts();
      } catch (e) {
        $('formError').textContent = e.message;
        $('formError').classList.remove('hidden');
      }
    });
  }

  function debounce(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  init().catch((e) => {
    $('authMsg').textContent = e.message;
    $('authMsg').classList.remove('hidden');
  });
})();
