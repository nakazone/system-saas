/**
 * CRM admin — edit partner pricing table (builders portal reads via API).
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
    el.innerHTML = VOLUME_DISCOUNTS.map(
      (v) =>
        `<div class="bp-pricing-volume-item"><span class="bp-pricing-volume-item__range">${escapeHtml(v.range)}</span><strong class="bp-pricing-volume-item__pct">${v.pct}%</strong></div>`,
    ).join('');
  }

  function adminCardHtml(s) {
    const dis = adminCanEdit ? '' : ' disabled';
    const vis = Number(s.is_visible) === 1 || s.is_visible === true;
    const locked = Number(s.is_locked) === 1 || s.is_locked === true;
    const partnerVal = s.partner_price != null && s.partner_price !== '' ? s.partner_price : '';
    return `<article class="bp-pricing-card" data-id="${escapeHtml(s.id)}">
      <header class="bp-pricing-card__head">
        <label class="bp-pricing-field bp-pricing-field--grow">
          <span class="bp-pricing-field__label">Serviço</span>
          <input class="bp-pricing-input" data-f="name" type="text" value="${escapeHtml(s.name)}"${dis} />
        </label>
        <label class="bp-pricing-field bp-pricing-field--order">
          <span class="bp-pricing-field__label">Ordem</span>
          <input class="bp-pricing-input" data-f="sort_order" type="number" value="${s.sort_order ?? 0}"${dis} />
        </label>
      </header>
      <div class="bp-pricing-card__grid">
        <label class="bp-pricing-field">
          <span class="bp-pricing-field__label">Categoria</span>
          <select data-f="category" class="bp-pricing-input"${dis}>
            <option value="installation" ${s.category === 'installation' ? 'selected' : ''}>Instalação</option>
            <option value="sand_finish" ${s.category === 'sand_finish' ? 'selected' : ''}>Lixamento</option>
            <option value="supply" ${s.category === 'supply' ? 'selected' : ''}>Material</option>
            <option value="custom" ${s.category === 'custom' ? 'selected' : ''}>Personalizado</option>
          </select>
        </label>
        <label class="bp-pricing-field">
          <span class="bp-pricing-field__label">Unidade</span>
          <input class="bp-pricing-input" data-f="unit" type="text" value="${escapeHtml(s.unit || '')}" placeholder="sq ft, step…"${dis} />
        </label>
        <label class="bp-pricing-field">
          <span class="bp-pricing-field__label">Mín. público ($)</span>
          <input class="bp-pricing-input" data-f="price_min" type="number" step="0.01" value="${s.price_min}"${dis} />
        </label>
        <label class="bp-pricing-field">
          <span class="bp-pricing-field__label">Máx. público ($)</span>
          <input class="bp-pricing-input" data-f="price_max" type="number" step="0.01" value="${s.price_max}"${dis} />
        </label>
        <label class="bp-pricing-field">
          <span class="bp-pricing-field__label">Preço parceiro ($)</span>
          <input class="bp-pricing-input" data-f="partner_price" type="number" step="0.01" value="${partnerVal}"${dis} />
        </label>
      </div>
      <label class="bp-pricing-field bp-pricing-field--full">
        <span class="bp-pricing-field__label">Notas (portal builder)</span>
        <textarea class="bp-pricing-input bp-pricing-input--notes" data-f="notes" rows="2" placeholder="Texto opcional visível no portal…"${dis}>${escapeHtml(s.notes || '')}</textarea>
      </label>
      <div class="bp-pricing-card__flags">
        <label class="bp-pricing-check"><input type="checkbox" data-f="is_visible" ${vis ? 'checked' : ''}${dis} /> Visível no portal</label>
        <label class="bp-pricing-check"><input type="checkbox" data-f="is_locked" ${locked ? 'checked' : ''}${dis} /> Bloqueado</label>
      </div>
      ${
        adminCanEdit
          ? `<footer class="bp-pricing-card__actions">
            <button type="button" class="bp-btn-tan bp-btn-sm" data-save="${escapeHtml(s.id)}">Salvar</button>
            <button type="button" class="bp-btn-ghost bp-btn-sm" data-del="${escapeHtml(s.id)}">Excluir</button>
          </footer>`
          : ''
      }
    </article>`;
  }

  function bindRowActions(root) {
    if (!adminCanEdit || !root) return;
    root.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(btn.dataset.save));
    });
    root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteRow(btn.dataset.del));
    });
  }

  async function loadAdmin() {
    const j = await adminApi('/api/pricing');
    const rows = j.data || [];
    const list = $('pricingList');
    const empty = $('pricingEmpty');
    if (empty) empty.classList.toggle('hidden', rows.length > 0);
    if (list) {
      list.innerHTML = rows.map(adminCardHtml).join('');
      bindRowActions(list);
    }
    renderVolume($('volumeDiscounts'));
  }

  async function saveRow(id) {
    const card = document.querySelector(`.bp-pricing-card[data-id="${id}"]`);
    if (!card) return;
    const body = {};
    card.querySelectorAll('[data-f]').forEach((el) => {
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
      crmNotify('Salvo. O portal do builder será atualizado automaticamente.', 'success');
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function deleteRow(id) {
    if (!confirm('Excluir este serviço da tabela?')) return;
    try {
      await adminApi(`/api/pricing/${id}`, { method: 'DELETE' });
      crmNotify('Serviço removido.', 'success');
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
          body: JSON.stringify({ name: 'Novo serviço', category: 'installation' }),
        });
        await loadAdmin();
        crmNotify('Serviço adicionado.', 'success');
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
    await loadAdmin();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
