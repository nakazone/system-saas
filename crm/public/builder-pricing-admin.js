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

  const CATEGORY_LABELS = {
    installation: 'Instalação',
    sand_finish: 'Lixamento',
    supply: 'Material',
    custom: 'Personalizado',
  };

  let adminCanEdit = false;
  let allRows = [];
  let searchQuery = '';
  let categoryFilter = '';
  let expandedId = null;

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

  function matchesFilters(s) {
    if (categoryFilter && String(s.category || '') !== categoryFilter) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const hay = [s.name, s.unit, s.notes, s.category, CATEGORY_LABELS[s.category] || '']
      .map((x) => String(x || '').toLowerCase())
      .join(' ');
    return hay.includes(q);
  }

  function filteredRows() {
    return allRows.filter(matchesFilters);
  }

  function adminRowHtml(s) {
    const dis = adminCanEdit ? '' : ' disabled';
    const vis = Number(s.is_visible) === 1 || s.is_visible === true;
    const locked = Number(s.is_locked) === 1 || s.is_locked === true;
    const partnerVal = s.partner_price != null && s.partner_price !== '' ? s.partner_price : '';
    const open = expandedId === s.id;
    const catLabel = CATEGORY_LABELS[s.category] || s.category || '—';
    return `<article class="bp-pricing-row${open ? ' is-open' : ''}${vis ? '' : ' is-hidden-svc'}" data-id="${escapeHtml(s.id)}">
      <div class="bp-pricing-row__main">
        <button type="button" class="bp-pricing-row__toggle" data-toggle="${escapeHtml(s.id)}" aria-expanded="${open ? 'true' : 'false'}" title="Mais detalhes">
          <span aria-hidden="true">${open ? '▾' : '▸'}</span>
        </button>
        <label class="bp-pricing-cell bp-pricing-cell--name">
          <span class="bp-pricing-cell__lbl">Serviço</span>
          <input class="bp-pricing-input" data-f="name" type="text" value="${escapeHtml(s.name)}"${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--cat">
          <span class="bp-pricing-cell__lbl">Categoria</span>
          <select data-f="category" class="bp-pricing-input"${dis} title="${escapeHtml(catLabel)}">
            <option value="installation" ${s.category === 'installation' ? 'selected' : ''}>Instalação</option>
            <option value="sand_finish" ${s.category === 'sand_finish' ? 'selected' : ''}>Lixamento</option>
            <option value="supply" ${s.category === 'supply' ? 'selected' : ''}>Material</option>
            <option value="custom" ${s.category === 'custom' ? 'selected' : ''}>Personalizado</option>
          </select>
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--unit">
          <span class="bp-pricing-cell__lbl">Unidade</span>
          <input class="bp-pricing-input" data-f="unit" type="text" value="${escapeHtml(s.unit || '')}" placeholder="sq ft"${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--num">
          <span class="bp-pricing-cell__lbl">Mín $</span>
          <input class="bp-pricing-input" data-f="price_min" type="number" step="0.01" value="${s.price_min}"${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--num">
          <span class="bp-pricing-cell__lbl">Máx $</span>
          <input class="bp-pricing-input" data-f="price_max" type="number" step="0.01" value="${s.price_max}"${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--num bp-pricing-cell--partner">
          <span class="bp-pricing-cell__lbl">Parceiro $</span>
          <input class="bp-pricing-input" data-f="partner_price" type="number" step="0.01" value="${partnerVal}"${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--check" title="Visível no portal">
          <span class="bp-pricing-cell__lbl">Vis.</span>
          <input type="checkbox" data-f="is_visible" ${vis ? 'checked' : ''}${dis} />
        </label>
        <div class="bp-pricing-row__actions">
          ${
            adminCanEdit
              ? `<button type="button" class="bp-btn-tan bp-btn-sm" data-save="${escapeHtml(s.id)}">Salvar</button>
                 <button type="button" class="bp-btn-ghost bp-btn-sm" data-del="${escapeHtml(s.id)}" title="Excluir">×</button>`
              : ''
          }
        </div>
      </div>
      <div class="bp-pricing-row__extra"${open ? '' : ' hidden'}>
        <label class="bp-pricing-cell bp-pricing-cell--order">
          <span class="bp-pricing-cell__lbl">Ordem</span>
          <input class="bp-pricing-input" data-f="sort_order" type="number" value="${s.sort_order ?? 0}"${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--check-wide">
          <span class="bp-pricing-cell__lbl">Bloqueado</span>
          <input type="checkbox" data-f="is_locked" ${locked ? 'checked' : ''}${dis} />
        </label>
        <label class="bp-pricing-cell bp-pricing-cell--notes">
          <span class="bp-pricing-cell__lbl">Notas (portal)</span>
          <textarea class="bp-pricing-input bp-pricing-input--notes" data-f="notes" rows="2" placeholder="Texto opcional no portal…"${dis}>${escapeHtml(s.notes || '')}</textarea>
        </label>
      </div>
    </article>`;
  }

  function bindListEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggle;
        expandedId = expandedId === id ? null : id;
        renderList();
      });
    });
    if (!adminCanEdit) return;
    root.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => saveRow(btn.dataset.save));
    });
    root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteRow(btn.dataset.del));
    });
  }

  function renderList() {
    const list = $('pricingList');
    const empty = $('pricingEmpty');
    const noMatch = $('pricingNoMatch');
    const countEl = $('pricingCount');
    const filtered = filteredRows();

    if (empty) empty.classList.toggle('hidden', allRows.length > 0);
    if (noMatch) noMatch.classList.toggle('hidden', !(allRows.length > 0 && filtered.length === 0));
    if (countEl) {
      if (!allRows.length) countEl.textContent = '';
      else if (filtered.length === allRows.length) countEl.textContent = `${allRows.length} serviço${allRows.length === 1 ? '' : 's'}`;
      else countEl.textContent = `${filtered.length} de ${allRows.length}`;
    }
    if (list) {
      list.innerHTML = filtered.map(adminRowHtml).join('');
      bindListEvents(list);
    }
  }

  async function loadAdmin() {
    const j = await adminApi('/api/pricing');
    allRows = j.data || [];
    renderList();
    renderVolume($('volumeDiscounts'));
  }

  async function saveRow(id) {
    const card = document.querySelector(`.bp-pricing-row[data-id="${id}"]`);
    if (!card) return;
    const body = {};
    card.querySelectorAll('[data-f]').forEach((el) => {
      const f = el.dataset.f;
      if (el.type === 'checkbox') body[f] = el.checked;
      else if (f === 'notes') body[f] = el.value;
      else body[f] = el.type === 'number' ? parseFloat(el.value) : el.value;
    });
    try {
      const j = await adminApi(`/api/pricing/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const idx = allRows.findIndex((r) => String(r.id) === String(id));
      if (idx >= 0 && j.data) allRows[idx] = { ...allRows[idx], ...j.data };
      crmNotify('Salvo. O portal do builder será atualizado automaticamente.', 'success');
      renderList();
    } catch (e) {
      crmNotify(e.message, 'error');
    }
  }

  async function deleteRow(id) {
    if (!confirm('Excluir este serviço da tabela?')) return;
    try {
      await adminApi(`/api/pricing/${id}`, { method: 'DELETE' });
      allRows = allRows.filter((r) => String(r.id) !== String(id));
      if (expandedId === id) expandedId = null;
      crmNotify('Serviço removido.', 'success');
      renderList();
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

    $('pricingSearch')?.addEventListener('input', (e) => {
      searchQuery = e.target.value || '';
      renderList();
    });
    $('pricingCategoryFilter')?.addEventListener('change', (e) => {
      categoryFilter = e.target.value || '';
      renderList();
    });

    $('btnAddService')?.addEventListener('click', async () => {
      if (!adminCanEdit) return;
      try {
        const j = await adminApi('/api/pricing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Novo serviço', category: 'installation' }),
        });
        if (j.data) {
          allRows = [j.data, ...allRows];
          expandedId = j.data.id;
          searchQuery = '';
          categoryFilter = '';
          if ($('pricingSearch')) $('pricingSearch').value = '';
          if ($('pricingCategoryFilter')) $('pricingCategoryFilter').value = '';
        }
        crmNotify('Serviço adicionado.', 'success');
        renderList();
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
    await loadAdmin();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
