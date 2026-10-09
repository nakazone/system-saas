/**
 * Tabela de Valor — Opção A (tabela por categoria com edição no lugar) com a lista lateral da B.
 * Lista à esquerda: "Tabela completa" + serviços por categoria. Direita: a tabela (A) ou o serviço aberto (B).
 * API: /api/pricing (GET/POST/PUT/DELETE). O portal do builder lê a mesma tabela.
 */
/* global crmNotify */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const notify = (m, t) => (typeof crmNotify === 'function' ? crmNotify(m, t) : window.alert(m));

  const VOLUME_DISCOUNTS = [
    { range: '500 – 999 sq ft', pct: 5 },
    { range: '1,000 – 2,499 sq ft', pct: 8 },
    { range: '2,500 – 4,999 sq ft', pct: 12 },
    { range: '5,000+ sq ft', pct: 15 },
  ];
  const CATS = [
    ['installation', 'Instalação'],
    ['sand_finish', 'Lixamento'],
    ['supply', 'Material'],
    ['custom', 'Personalizado'],
  ];
  const catLabel = (c) => (CATS.find((x) => x[0] === c) || [null, c || 'Outro'])[1];
  const UNITS = [
    ['sq_ft', 'sq ft'],
    ['linear_ft', 'linear ft'],
    ['step', 'degrau'],
    ['each', 'unidade'],
    ['hour', 'hora'],
  ];
  const unitLabel = (u) => {
    const k = String(u || '').trim();
    const hit = UNITS.find((x) => x[0] === k || x[1] === k);
    if (hit) return hit[1];
    return k.replace(/_/g, ' ') || '—';
  };
  const TYPES = [
    ['price_particular', 'Particular'],
    ['price_builder', 'Builder'],
    ['price_contractor', 'Contractor'],
    ['price_loja', 'Loja'],
  ];

  const S = { rows: [], canEdit: false, q: '', cat: '', sel: null, detail: false, ver: 0 };

  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || r.statusText);
    return j;
  }
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const money = (v) => {
    const n = num(v);
    if (n == null || !Number.isFinite(n) || n === 0) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n >= 100 ? 0 : 2, maximumFractionDigits: n >= 100 ? 0 : 2 });
  };
  const pct = (v, base) => {
    const a = num(v);
    const b = num(base);
    if (!a || !b) return '';
    const p = Math.round(((a - b) / b) * 100);
    if (!p) return 'igual';
    return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
  };
  const isVis = (s) => Number(s.is_visible) === 1 || s.is_visible === true;
  const isLocked = (s) => Number(s.is_locked) === 1 || s.is_locked === true;

  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.rows.filter((s) => {
      if (S.cat === 'other') {
        if (s.category === 'installation' || s.category === 'sand_finish') return false;
      } else if (S.cat && s.category !== S.cat) return false;
      if (!q) return true;
      return [s.name, s.unit, unitLabel(s.unit), s.notes, catLabel(s.category)].join(' ').toLowerCase().includes(q);
    });
  }
  function groups(list) {
    const out = CATS.map(([k, l]) => [k, l, list.filter((s) => s.category === k)]);
    const rest = list.filter((s) => !CATS.some((c) => c[0] === s.category));
    if (rest.length) out.push(['other', 'Outros', rest]);
    return out.filter((g) => g[2].length);
  }

  /* ---------------- lista lateral */
  function renderSeg() {
    const n = (k) => S.rows.filter((s) => s.category === k).length;
    const btn = (k, l, c) => `<button type="button" data-cat="${k}" class="${S.cat === k ? 'is-on' : ''}">${l} <em>${c}</em></button>`;
    const others = S.rows.filter((s) => s.category !== 'installation' && s.category !== 'sand_finish').length;
    $('tvSeg').innerHTML = btn('', 'Todas', S.rows.length) + (n('installation') ? btn('installation', 'Instalação', n('installation')) : '') + (n('sand_finish') ? btn('sand_finish', 'Lixa', n('sand_finish')) : '') + (others ? btn('other', 'Outros', others) : '');
  }
  function renderList() {
    const list = filtered();
    const vis = S.rows.filter(isVis).length;
    $('tvSub').textContent = `${S.rows.length} serviço${S.rows.length === 1 ? '' : 's'} · ${vis} no portal do builder`;
    let h = `<a class="tv-res${!S.sel ? ' is-on' : ''}" href="#" data-tv-res><span class="tv-res__ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16M9 5v14"/></svg></span><span class="tv-res__b"><b>Tabela completa</b><small>4 preços por serviço · editar no lugar</small></span></a>`;
    if (!S.rows.length) h += '<p class="tv-empty">Nenhum serviço ainda. Toque em Novo para começar.</p>';
    else if (!list.length) h += '<p class="tv-empty">Nenhum serviço com essa busca.</p>';
    groups(list).forEach(([, label, items]) => {
      h += `<div class="tv-grp">${esc(label)}<em>${items.length}</em></div>`;
      h += items
        .map(
          (s) => `<a class="tv-row${S.sel === s.id ? ' is-on' : ''}${isVis(s) ? '' : ' is-off'}" href="#" data-tv-sel="${esc(s.id)}">
        <span class="tv-row__b"><b>${esc(s.name)}</b><small>${esc(unitLabel(s.unit))}${isVis(s) ? '' : ' · oculto no portal'}</small></span>
        <span class="tv-row__v">${money(s.price_particular)}<small>Builder ${money(s.price_builder)}</small></span></a>`,
        )
        .join('');
    });
    $('tvRows').innerHTML = h;
  }

  /* ---------------- tabela (Opção A) */
  function tablePane() {
    const list = filtered();
    const n = (k) => S.rows.filter((s) => s.category === k);
    const tiles = [['', 'Todas', S.rows]].concat(CATS.map(([k, l]) => [k, l, n(k)]).filter((t) => t[2].length));
    const tileHtml = tiles
      .map(([k, l, items]) => {
        const hid = items.filter((s) => !isVis(s)).length;
        const sub = k === '' ? `${items.length - hid} no portal` : hid ? `${hid} oculto${hid === 1 ? '' : 's'} no portal` : items.slice(0, 3).map((s) => s.name).join(', ');
        return `<button type="button" class="tv-tile${S.cat === k ? ' is-on' : ''}" data-cat="${k}"><span>${esc(l)}</span><b>${items.length}</b><small>${esc(sub)}</small></button>`;
      })
      .join('');
    const ro = S.canEdit ? '' : ' readonly';
    const cell = (s, f) => {
      const v = num(s[f]);
      const diff = f === 'price_particular' ? '' : pct(v, s.price_particular);
      return `<td class="r"><label class="tv-cell"><span class="tv-cell__in"><i>$</i><input type="number" step="0.01" min="0" inputmode="decimal" data-tv-price="${esc(s.id)}" data-f="${f}" value="${v ? v.toFixed(2) : ''}" placeholder="—" aria-label="${esc(s.name)} · ${f}"${ro} /></span>${diff ? `<small>${diff}</small>` : ''}</label></td>`;
    };
    const body = groups(list)
      .map(
        ([, label, items]) => `<tr class="tv-gr"><td colspan="8"><span>${esc(label)}</span><em>${items.length} serviço${items.length === 1 ? '' : 's'}</em></td></tr>${items
          .map(
            (s) => `<tr class="tv-tr${isVis(s) ? '' : ' is-off'}" data-id="${esc(s.id)}">
          <td><a href="#" class="tv-name" data-tv-sel="${esc(s.id)}"><b>${esc(s.name)}</b>${s.notes ? `<small>${esc(s.notes)}</small>` : ''}</a></td>
          <td class="tv-unit">${esc(unitLabel(s.unit))}</td>
          ${TYPES.map(([f]) => cell(s, f)).join('')}
          <td><button type="button" class="tv-vis${isVis(s) ? ' is-on' : ''}" data-tv-vis="${esc(s.id)}"${S.canEdit ? '' : ' disabled'} title="${isVis(s) ? 'Visível no portal do builder' : 'Oculto no portal do builder'}"><svg viewBox="0 0 24 24" aria-hidden="true">${isVis(s) ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>' : '<path d="M17.9 17.9A10.1 10.1 0 0112 19c-7 0-11-7-11-7a18.4 18.4 0 015.1-5.9M9.9 4.2A9.1 9.1 0 0112 4c7 0 11 7 11 7a18.5 18.5 0 01-2.2 3.2M1 1l22 22"/>'}</svg>${isVis(s) ? 'Visível' : 'Oculto'}</button></td>
          <td class="r"><a href="#" class="tv-go" data-tv-sel="${esc(s.id)}" aria-label="Abrir ${esc(s.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></a></td>
        </tr>`,
          )
          .join('')}`,
      )
      .join('');
    const empty = !S.rows.length
      ? '<div class="tv-card tv-blank"><b>Nenhum serviço na tabela.</b> Crie o primeiro com Novo serviço.</div>'
      : !list.length
        ? '<div class="tv-card tv-blank">Nenhum serviço com essa busca.</div>'
        : '';
    return `<div class="tv-phead"><div><p>Preços por tipo de cliente · usados nos orçamentos, no Field Quote e no portal do builder</p><h2>Tabela completa</h2></div>${S.canEdit ? '<button type="button" class="tv-btn tv-btn--pri" data-tv-new><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Novo serviço</button>' : ''}</div>
      <div class="tv-tiles" style="--n:${tiles.length}">${tileHtml}</div>
      ${S.canEdit && S.rows.length ? '<p class="tv-hint">Clique num preço para editar — salva sozinho ao sair do campo. A % mostra a diferença para o preço Particular.</p>' : ''}
      ${empty || `<div class="tv-card tv-tbl-wrap"><table class="tv-tbl"><thead><tr><th>Serviço</th><th>Unidade</th>${TYPES.map(([, l]) => `<th class="r">${l}</th>`).join('')}<th>Portal</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`}
      ${volumeHtml()}`;
  }
  function volumeHtml() {
    return `<div class="tv-card tv-vol"><h3>Desconto por volume <em>aplicado ao preço Builder no portal do builder</em></h3><div class="tv-vol__g">${VOLUME_DISCOUNTS.map((v) => `<div><span>${esc(v.range)}</span><b>${v.pct}%</b></div>`).join('')}</div></div>`;
  }

  /* ---------------- formulário do serviço (painel e popup) */
  function chips(name, list, cur) {
    return `<div class="tv-chips" data-chips="${name}">${list.map(([k, l]) => `<button type="button" data-chip="${esc(k)}" class="${cur === k ? 'is-on' : ''}">${esc(l)}</button>`).join('')}<input type="hidden" name="${name}" value="${esc(cur)}" /></div>`;
  }
  function unitField(cur) {
    const known = UNITS.some((u) => u[0] === cur);
    return `<div class="tv-chips" data-chips="unit">${UNITS.map(([k, l]) => `<button type="button" data-chip="${k}" class="${cur === k ? 'is-on' : ''}">${l}</button>`).join('')}<input class="tv-unit-other" type="text" maxlength="24" placeholder="outra" value="${known ? '' : esc(cur)}" aria-label="Outra unidade" /><input type="hidden" name="unit" value="${esc(cur)}" /></div>`;
  }
  function priceInputs(s) {
    return `<div class="tv-p4">${TYPES.map(([f, l]) => {
      const v = num(s[f]);
      const d = f === 'price_particular' ? 'base' : pct(v, s.price_particular) || '';
      return `<label class="tv-pc${f === 'price_particular' ? ' is-base' : ''}"><span>${l}</span><span class="tv-pc__in"><i>$</i><input type="number" step="0.01" min="0" inputmode="decimal" name="${f}" value="${v ? v.toFixed(2) : ''}" placeholder="0.00" /></span><small data-diff="${f}">${d}</small></label>`;
    }).join('')}</div>`;
  }
  function toggle(name, on, title, sub) {
    return `<label class="tv-tg"><span><b>${title}</b><small>${sub}</small></span><input type="checkbox" name="${name}" ${on ? 'checked' : ''} /><i aria-hidden="true"></i></label>`;
  }
  function formFields(s, compact) {
    return `<label class="tv-field"><span>Nome do serviço <span class="tv-opt">aparece no orçamento e no portal</span></span><input name="name" value="${esc(s.name || '')}" maxlength="160" placeholder="Ex.: LVP install" required /></label>
      <div class="tv-field">Categoria${chips('category', CATS, s.category || 'installation')}</div>
      <div class="tv-field">Unidade${unitField(s.unit || 'sq_ft')}</div>
      ${compact ? `<p class="tv-sec">Preço por tipo de cliente</p>${priceInputs(s)}` : ''}
      <p class="tv-sec">Portal do builder</p>
      ${toggle('is_visible', s.is_visible === undefined ? true : isVis(s), 'Visível no portal', 'O builder vê este serviço e o preço dele')}
      ${toggle('is_locked', isLocked(s), 'Preço bloqueado', 'O builder não pode pedir outro valor')}
      <label class="tv-field"><span>Nota no portal <span class="tv-opt">opcional</span></span><textarea name="notes" rows="2" data-crm-rich="off" placeholder="Texto que o builder vê ao lado do preço">${esc(s.notes || '')}</textarea></label>
      <label class="tv-field">Posição na lista<input name="sort_order" type="number" value="${esc(s.sort_order ?? 0)}" /></label>`;
  }

  function servicePane(s) {
    const ro = !S.canEdit;
    return `<form class="tv-svc" id="tvSvc" data-id="${esc(s.id)}">
      <div class="tv-svc__hd"><div class="tv-svc__t"><div class="tv-chiprow"><span class="tv-chip">${esc(catLabel(s.category))}</span><span class="tv-chip ${isVis(s) ? 'is-ok' : ''}">${isVis(s) ? 'Visível no portal' : 'Oculto no portal'}</span>${isLocked(s) ? '<span class="tv-chip">Preço bloqueado</span>' : ''}</div><h2>${esc(s.name)}</h2><p>por ${esc(unitLabel(s.unit))} · aparece nos orçamentos, no Field Quote e no portal do builder</p></div>
        ${ro ? '' : '<div class="tv-svc__acts"><button type="button" class="tv-btn tv-btn--warn" data-tv-del>Excluir</button><button type="submit" class="tv-btn tv-btn--pri">Salvar alterações</button></div>'}</div>
      ${priceInputs(s)}
      <div class="tv-svc__g"><div class="tv-card"><h3>Serviço</h3>
        <label class="tv-field">Nome<input name="name" value="${esc(s.name || '')}" maxlength="160" required /></label>
        <div class="tv-field">Categoria${chips('category', CATS, s.category || 'installation')}</div>
        <div class="tv-field">Unidade${unitField(s.unit || 'sq_ft')}</div></div>
        <div class="tv-card"><h3>Portal do builder</h3>
        ${toggle('is_visible', isVis(s), 'Visível no portal', 'O builder vê este serviço e o preço dele')}
        ${toggle('is_locked', isLocked(s), 'Preço bloqueado', 'O builder não pode pedir outro valor')}
        <label class="tv-field"><span>Nota no portal <span class="tv-opt">opcional</span></span><textarea name="notes" rows="2" data-crm-rich="off" placeholder="Texto que o builder vê ao lado do preço">${esc(s.notes || '')}</textarea></label>
        <label class="tv-field">Posição na lista<input name="sort_order" type="number" value="${esc(s.sort_order ?? 0)}" /></label></div></div>
      ${volumeHtml()}
    </form>`;
  }

  /* ---------------- render */
  function current() {
    return S.sel ? S.rows.find((r) => String(r.id) === String(S.sel)) || null : null;
  }
  function renderPane() {
    const s = current();
    if (S.sel && !s) S.sel = null;
    $('tvPane').innerHTML = s ? servicePane(s) : tablePane();
    if (!S.canEdit && s) $('tvPane').querySelectorAll('input, textarea, button[data-chip]').forEach((el) => (el.disabled = true));
    const bar = $('tvMbar');
    if (s && S.canEdit) {
      bar.innerHTML = '<button type="button" class="tv-btn tv-btn--sq tv-btn--warn" data-tv-del aria-label="Excluir"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button><button type="button" class="tv-btn tv-btn--pri" data-tv-save>Salvar alterações</button>';
      bar.hidden = false;
    } else {
      bar.hidden = true;
      bar.innerHTML = '';
    }
  }
  const narrow = () => window.matchMedia('(max-width: 1024px)').matches;
  function sync() {
    const on = narrow() && S.detail && Boolean(current());
    $('tvSplit').classList.toggle('is-detail', on);
    document.body.classList.toggle('tv-detail-open', on);
  }
  function render() {
    renderSeg();
    renderList();
    renderPane();
    sync();
  }
  function select(id) {
    S.sel = id || null;
    S.detail = Boolean(id);
    render();
    try {
      const u = new URL(location.href);
      if (S.sel) u.searchParams.set('id', S.sel);
      else u.searchParams.delete('id');
      history.replaceState(null, '', u.toString());
    } catch (e) { /* ignore */ }
    if (narrow()) window.scrollTo({ top: 0 });
  }

  /* ---------------- ações */
  function readForm(root) {
    const g = (n) => root.querySelector(`[name="${n}"]`);
    const body = {
      name: String(g('name')?.value || '').trim(),
      category: g('category')?.value || 'installation',
      unit: String(g('unit')?.value || '').trim() || 'sq_ft',
      is_visible: Boolean(g('is_visible')?.checked),
      is_locked: Boolean(g('is_locked')?.checked),
      notes: g('notes')?.value || '',
      sort_order: Number(g('sort_order')?.value) || 0,
    };
    TYPES.forEach(([f]) => {
      const el = g(f);
      if (el) body[f] = el.value === '' ? 0 : Number(el.value);
    });
    return body;
  }
  async function saveService() {
    const f = $('tvSvc');
    if (!f || !S.canEdit) return;
    const body = readForm(f);
    if (!body.name) return notify('Preencha o nome do serviço.', 'error');
    document.querySelectorAll('[data-tv-save], #tvSvc [type="submit"]').forEach((b) => (b.disabled = true));
    try {
      const j = await api(`/api/pricing/${encodeURIComponent(f.dataset.id)}`, { method: 'PUT', body: JSON.stringify(body) });
      const i = S.rows.findIndex((r) => String(r.id) === String(f.dataset.id));
      if (i >= 0 && j.data) S.rows[i] = { ...S.rows[i], ...j.data };
      notify('Salvo. O portal do builder já mostra o novo preço.', 'success');
      render();
    } catch (e) {
      notify(e.message, 'error');
      document.querySelectorAll('[data-tv-save], #tvSvc [type="submit"]').forEach((b) => (b.disabled = false));
    }
  }
  let delArmed = null;
  async function deleteService(btn) {
    const s = current();
    if (!s || !S.canEdit) return;
    if (delArmed !== s.id) {
      delArmed = s.id;
      document.querySelectorAll('[data-tv-del]').forEach((b) => {
        b.classList.add('is-armed');
        if (!b.classList.contains('tv-btn--sq')) b.textContent = 'Confirmar exclusão';
      });
      setTimeout(() => {
        if (delArmed !== s.id) return;
        delArmed = null;
        document.querySelectorAll('[data-tv-del]').forEach((b) => {
          b.classList.remove('is-armed');
          if (!b.classList.contains('tv-btn--sq')) b.textContent = 'Excluir';
        });
      }, 4000);
      return;
    }
    delArmed = null;
    try {
      await api(`/api/pricing/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      S.rows = S.rows.filter((r) => String(r.id) !== String(s.id));
      notify('Serviço removido da tabela.', 'success');
      select(null);
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function savePrice(input) {
    const id = input.dataset.tvPrice;
    const f = input.dataset.f;
    const s = S.rows.find((r) => String(r.id) === String(id));
    if (!s || !S.canEdit) return;
    const v = input.value === '' ? 0 : Number(input.value);
    if (!Number.isFinite(v) || v < 0) return notify('Valor inválido.', 'error');
    if ((num(s[f]) || 0) === v) return;
    input.closest('.tv-cell')?.classList.add('is-saving');
    try {
      const j = await api(`/api/pricing/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ [f]: v }) });
      Object.assign(s, j.data || { [f]: v });
      const cell = input.closest('.tv-cell');
      cell?.classList.remove('is-saving');
      cell?.classList.add('is-saved');
      setTimeout(() => cell?.classList.remove('is-saved'), 1200);
      // atualiza as % da linha sem redesenhar a tabela (o foco segue para o próximo campo)
      const tr = input.closest('tr');
      if (tr) {
        TYPES.forEach(([ff]) => {
          if (ff === 'price_particular') return;
          const inp = tr.querySelector(`[data-f="${ff}"]`);
          const lbl = inp?.closest('.tv-cell');
          if (!lbl) return;
          let sm = lbl.querySelector('small');
          const d = pct(s[ff], s.price_particular);
          if (!sm && d) {
            sm = document.createElement('small');
            lbl.appendChild(sm);
          }
          if (sm) sm.textContent = d;
        });
      }
      renderList();
    } catch (e) {
      input.closest('.tv-cell')?.classList.remove('is-saving');
      notify(e.message, 'error');
    }
  }
  async function toggleVis(btn) {
    const s = S.rows.find((r) => String(r.id) === String(btn.dataset.tvVis));
    if (!s || !S.canEdit) return;
    try {
      const j = await api(`/api/pricing/${encodeURIComponent(s.id)}`, { method: 'PUT', body: JSON.stringify({ is_visible: !isVis(s) }) });
      Object.assign(s, j.data || { is_visible: !isVis(s) });
      render();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  function openNew() {
    if (!S.canEdit) return;
    $('tvFormBody').innerHTML = formFields({ category: S.cat && S.cat !== 'other' ? S.cat : 'installation', unit: 'sq_ft' }, true);
    $('tvModal').hidden = false;
    document.body.classList.add('tv-modal-open');
    setTimeout(() => $('tvFormBody').querySelector('[name="name"]')?.focus(), 30);
  }
  function closeNew() {
    $('tvModal').hidden = true;
    document.body.classList.remove('tv-modal-open');
  }
  async function submitNew(e) {
    e.preventDefault();
    const body = readForm($('tvForm'));
    if (!body.name) return notify('Preencha o nome do serviço.', 'error');
    try {
      const j = await api('/api/pricing', { method: 'POST', body: JSON.stringify(body) });
      if (j.data) S.rows.push(j.data);
      S.rows.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.name).localeCompare(String(b.name)));
      closeNew();
      notify('Serviço criado.', 'success');
      S.q = '';
      $('pricingSearch').value = '';
      select(j.data ? j.data.id : null);
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  function refreshDiffs(root) {
    const base = num(root.querySelector('[name="price_particular"]')?.value);
    TYPES.forEach(([f]) => {
      if (f === 'price_particular') return;
      const el = root.querySelector(`[data-diff="${f}"]`);
      if (el) el.textContent = pct(root.querySelector(`[name="${f}"]`)?.value, base);
    });
  }

  function bind() {
    $('pricingSearch').addEventListener('input', (e) => {
      S.q = e.target.value || '';
      renderList();
      if (!S.sel) renderPane();
    });
    document.addEventListener('click', (e) => {
      const t = e.target;
      let b;
      if ((b = t.closest('[data-cat]')) && !t.closest('[data-chips]')) {
        S.cat = b.dataset.cat;
        S.sel = null;
        S.detail = false;
        return render();
      }
      if ((b = t.closest('[data-tv-sel]'))) {
        e.preventDefault();
        return select(b.dataset.tvSel);
      }
      if (t.closest('[data-tv-res]')) {
        e.preventDefault();
        return select(null);
      }
      if ((b = t.closest('[data-chip]'))) {
        const box = b.closest('[data-chips]');
        box.querySelectorAll('[data-chip]').forEach((x) => x.classList.toggle('is-on', x === b));
        box.querySelector('input[type="hidden"]').value = b.dataset.chip;
        const other = box.querySelector('.tv-unit-other');
        if (other) other.value = '';
        return;
      }
      if (t.closest('[data-tv-new]') || t.closest('#tvNewBtn')) return openNew();
      if (t.closest('[data-tv-close]')) return closeNew();
      if ((b = t.closest('[data-tv-vis]'))) return toggleVis(b);
      if ((b = t.closest('[data-tv-del]'))) return deleteService(b);
      if (t.closest('[data-tv-save]')) return saveService();
    });
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'tvSvc') {
        e.preventDefault();
        saveService();
      }
    });
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('tv-unit-other')) {
        const box = t.closest('[data-chips]');
        box.querySelectorAll('[data-chip]').forEach((x) => x.classList.remove('is-on'));
        box.querySelector('input[type="hidden"]').value = t.value.trim();
      }
      if (t.name && t.name.startsWith('price_')) refreshDiffs(t.closest('form'));
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('[data-tv-price]')) savePrice(e.target);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-tv-price]')) {
        e.preventDefault();
        e.target.blur();
      }
      if (e.key === 'Escape' && !$('tvModal').hidden) closeNew();
    });
    $('tvForm').addEventListener('submit', submitNew);
    $('tvBack').addEventListener('click', (e) => {
      e.preventDefault();
      S.detail = false;
      sync();
    });
    window.addEventListener('resize', sync);
    document.body.appendChild($('tvMbar'));
    document.body.appendChild($('tvModal'));
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()).catch(() => ({}));
    if (!sess.authenticated) {
      location.href = 'login.html?return=' + encodeURIComponent(location.pathname);
      return;
    }
    const user = sess.user || {};
    const perms = Array.isArray(sess.permissions) ? sess.permissions : Array.isArray(user.permissions) ? user.permissions : [];
    const role = String(sess.role || user.role || '').toLowerCase();
    S.canEdit = role === 'admin' || perms.includes('builders.edit');
    if (!S.canEdit) {
      $('adminReadOnlyBanner').hidden = false;
      $('tvNewBtn').hidden = true;
    }
    bind();
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('id')) {
        S.sel = u.searchParams.get('id');
        S.detail = true;
      }
      if (u.searchParams.get('new') === '1') setTimeout(openNew, 200);
    } catch (e) { /* ignore */ }
    try {
      const j = await api('/api/pricing');
      S.rows = j.data || [];
    } catch (e) {
      $('tvRows').innerHTML = `<p class="tv-empty">${esc(e.message)}</p>`;
    }
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
