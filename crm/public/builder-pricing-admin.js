/**
 * CRM admin  edit partner pricing table (builders portal reads via API).
 */
/* global crmNotify */
(function () {
  const $ = (id) => document.getElementById(id);

  const VOLUME_DISCOUNTS = [
    { range: '500 - 999 sq ft', pct: 5 },
    { range: '1,000 - 2,499 sq ft', pct: 8 },
    { range: '2,500 - 4,999 sq ft', pct: 12 },
    { range: '5,000+ sq ft', pct: 15 },
  ];

  let adminCanEdit = false;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function adminApi(path, opts) {
    const r = await fetch(path, { credentials: 'include', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function renderVolume(el) {
    if (!el) return;
    el.innerHTML = `<ul style="margin:0;padding-left:1.2rem">${VOLUME_DISCOUNTS.map(
      (v) => `<li>${v.range}: <strong>${v.pct}%</strong> no preco parceiro</li>`
    ).join('')}</ul>`;
  }

  function adminRowHtml(s) {
    const dis = adminCanEdit ? '' : ' disabled';
    return `<tr data-id="${s.id}">
          <td><input class="bp-inline" data-f="sort_order" type="number" value="${s.sort_order ?? 0}" style="width:44px"${dis} /></td>
          <td><input class="bp-inline" data-f="name" value="${escapeHtml(s.name)}"${dis} /></td>
          <td><select data-f="category" class="bp-inline"${dis}>
            <option value="installation" ${s.category === 'installation' ? 'selected' : ''}>Installation</option>
            <option value="sand_finish" ${s.category === 'sand_finish' ? 'selected' : ''}>Sand & Finish</option>
            <option value="supply" ${s.category === 'supply' ? 'selected' : ''}>Supply</option>
            <option value="custom" ${s.category === 'custom' ? 'selected' : ''}>Custom</option>
          </select></td>
          <td><input class="bp-inline" data-f="unit" value="${escapeHtml(s.unit || '')}" style="width:70px"${dis} /></td>
          <td><input class="bp-inline" data-f="price_min" type="number" step="0.01" value="${s.price_min}" style="width:72px"${dis} /></td>
          <td><input class="bp-inline" data-f="price_max" type="number" step="0.01" value="${s.price_max}" style="width:72px"${dis} /></td>
          <td><input class="bp-inline" data-f="partner_price" type="number" step="0.01" value="${s.partner_price}" style="width:72px"${dis} /></td>
          <td><textarea class="bp-inline bp-inline-notes" data-f="notes" rows="2" placeholder="Nota exibida no portal do builder..."${dis}>${escapeHtml(s.notes || '')}</textarea></td>
          <td><input type="checkbox" data-f="is_visible" ${s.is_visible ? 'checked' : ''}${dis} /></td>
          <td><input type="checkbox" data-f="is_locked" ${s.is_locked ? 'checked' : ''}${dis} /></td>
          <td style="white-space:nowrap">
            ${adminCanEdit ? `<button type="button" class="bp-btn-tan bp-btn-sm" data-save="${s.id}">Salvar</button>
            <button type="button" class="bp-btn-ghost bp-btn-sm" data-del="${s.id}" style="margin-left:4px">Excluir</button>` : ''}
          </td>
        </tr>`;
  }

  async function loadAdmin() {
    const j = await adminApi('/api/pricing');
    const tbody = $('pricingTbody');
    tbody.innerHTML = (j.data || []).map(adminRowHtml).join('');
    renderVolume($('volumeDiscounts'));
    if (!adminCanEdit) return;
    tbody.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(btn.dataset.save));
    });
    tbody.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteRow(btn.dataset.del));
    });
  }

  async function saveRow(id) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    const body = {};
    tr.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') body[f] = el.checked;
      else if (f === 'notes') body[f] = el.value;
      else body[f] = el.type === 'number' ? parseFloat(el.value) : el.value;
    });
    try {
      await adminApi(`/api/pricing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      crmNotify('Salvo. O portal do builder sera atualizado automaticamente.', 'success');
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function deleteRow(id) {
    if (!confirm('Excluir este servico da tabela?')) return;
    try {
      await adminApi(`/api/pricing/${id}`, { method: 'DELETE' });
      crmNotify('Servico removido.', 'success');
      await loadAdmin();
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html?return=' + encodeURIComponent(location.pathname);
      return;
    }
    const user = sess.user || {};
    const perms = Array.isArray(sess.permissions)
      ? sess.permissions
      : Array.isArray(user.permissions)
        ? user.permissions
        : [];
    const role = String(sess.role || user.role || '').toLowerCase();
    adminCanEdit = role === 'admin' || perms.includes('builders.edit');
    if (!adminCanEdit) {
      $('adminReadOnlyBanner')?.classList.remove('hidden');
      $('btnAddService')?.setAttribute('disabled', 'disabled');
    }
    $('btnAddService')?.addEventListener('click', async () => {
      if (!adminCanEdit) return;
      try {
        await adminApi('/api/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New service', category: 'installation' }),
        });
        await loadAdmin();
        crmNotify('Servico adicionado.', 'success');
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
    await loadAdmin();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
