/**
 * Popup de serviços do construtor de orçamento — mesma aparência do PDF.
 *  - Documento (openDoc): a folha é editável no lugar (nome, descrição, qtd, unidade, preço).
 *  - Passo a passo (openStep): Serviço → Quantidade → Preço → Descrição → Seção,
 *    com a linha nova entrando na folha ao lado a cada passo.
 * Lê e grava os itens pelo window.QBBridge (quote-builder.js).
 */
(function () {
  const P = window.OmQuotePaper;
  if (!P) return;
  const B = () => window.QBBridge;

  const STEPS = [
    { id: 1, t: 'Serviço', hint: 'Escolha na Tabela de Valor ou digite' },
    { id: 2, t: 'Quantidade', hint: 'Quanto vai no PDF' },
    { id: 3, t: 'Preço', hint: 'Valor da Tabela · margem opcional' },
    { id: 4, t: 'Descrição no PDF', hint: 'O texto que o cliente lê' },
    { id: 5, t: 'Seção', hint: 'Supply, Installation ou Sand & Finish' },
  ];
  const UNIT_CHIPS = [
    ['sq_ft', 'sq ft'],
    ['linear_ft', 'linear ft'],
    ['step', 'step'],
    ['fixed', 'fixed'],
    ['box', 'box'],
    ['piece', 'piece'],
  ];

  let paper = null; // GET /api/quotes/:id/paper
  let paperFor = undefined;
  let mode = null; // 'doc' | 'step'
  let W = null; // itens em edição no modo documento
  let docDirty = false;
  let fromDoc = false;
  let draft = null;
  let step = 1;
  let ddState = null;
  let cancelArmed = 0;
  const E = {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '').replace(/,/g, '.'));
    return Number.isFinite(n) ? n : 0;
  }
  function money(n) {
    return P.money(n);
  }
  function isPhone() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  /* ---------- dados da folha ---------- */
  async function loadPaper() {
    const h = B().header();
    const key = h.quoteId || 'new';
    if (paper && paperFor === key) return paper;
    try {
      const r = await fetch(`/api/quotes/${encodeURIComponent(key)}/paper`, { credentials: 'include' });
      const j = await r.json();
      if (j && j.success) {
        paper = j.data;
        paperFor = key;
      }
    } catch (_) {
      /* a folha funciona sem o cabeçalho salvo */
    }
    return paper;
  }

  function itemToLine(it, key) {
    return {
      key,
      name: it.name || '',
      description: P.bodyWithoutTitle(it.name, it.description),
      notes: it.notes || '',
      quantity: Number(it.quantity) || 0,
      unit: it.unit_type || 'sq_ft',
      rate: Number(it.rate) || 0,
      section: P.sectionOf(it.item_type, it.service_type),
    };
  }

  function buildModel(list, extraLine) {
    const h = B().header();
    const pd = paper || {};
    const all = extraLine ? list.concat([extraLine.item]) : list;
    const t = B().totals(all);
    const lines = list.map((it, i) => itemToLine(it, i));
    if (extraLine) lines.push(itemToLine(extraLine.item, 'new'));
    const prepared = pd.preparedBy || {};
    return {
      org: P.orgFromApi(pd),
      number: h.number || pd.number || '',
      issued: pd.issueDate || new Date().toISOString(),
      valid: h.valid || pd.validUntil || '',
      bill: {
        name: h.bill.name || pd.customerName || 'Client',
        email: h.bill.email || pd.customerEmail || '',
        phone: h.bill.phone || pd.customerPhone || '',
      },
      job: {
        name: h.jobName || pd.projectName || pd.title || 'Project',
        address: pd.projectAddress || h.jobAddress || '',
        city: pd.projectCityLine || '',
      },
      prep: {
        name: prepared.name || pd.organizationName || '',
        line: [prepared.title, prepared.email].filter(Boolean).join(' · '),
      },
      floorArea: h.floorArea || Number(pd.floorAreaSqft) || 0,
      subtotal: t.sub,
      discount: t.disc,
      tax: t.tax,
      total: t.total,
      schedule: pd.schedule || [],
      lines,
    };
  }

  /* ---------- casca do popup ---------- */
  function ensureDom() {
    if (E.root) return;
    const root = document.createElement('div');
    root.className = 'qpe';
    root.id = 'qpe';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'qpeTitle');
    root.innerHTML = `
      <div class="qpe-box">
        <header class="qpe-hd">
          <button type="button" class="qpe-x" data-qpe-cancel aria-label="Fechar"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          <div class="qpe-hd__t"><h2 id="qpeTitle"></h2><p id="qpeSub"></p></div>
          <div class="qpe-hd__r">
            <span class="qpe-tot">Total <b id="qpeTotal">$0.00</b></span>
            <button type="button" class="qpe-btn qpe-btn--ghost" id="qpeCancel" data-qpe-cancel>Cancelar</button>
            <button type="button" class="qpe-btn qpe-btn--pri" id="qpeDone">Pronto</button>
          </div>
        </header>
        <div class="qpe-body">
          <section class="qpe-steps" id="qpeSteps" aria-label="Passo a passo"></section>
          <div class="qpe-wrap" id="qpeWrap"><div class="qp" id="qpePaper"></div></div>
          <aside class="qpe-side" id="qpeSide"></aside>
        </div>
        <div class="qpe-mbar" id="qpeMbar">
          <span class="qpe-mbar__t">Total <b id="qpeMTotal">$0.00</b></span>
          <button type="button" class="qpe-btn qpe-btn--pri" data-qpe-add="">+ Adicionar serviço</button>
        </div>
      </div>
      <div class="qpe-dd" id="qpeDD" hidden role="listbox"></div>`;
    document.body.appendChild(root);
    E.root = root;
    ['qpeTitle', 'qpeSub', 'qpeTotal', 'qpeMTotal', 'qpeCancel', 'qpeDone', 'qpeSteps', 'qpeWrap', 'qpePaper', 'qpeSide', 'qpeMbar', 'qpeDD'].forEach((id) => {
      E[id] = document.getElementById(id);
    });
    bind();
  }

  function show() {
    E.root.hidden = false;
    document.documentElement.classList.add('qpe-open');
    E.root.dataset.mode = mode;
  }
  function hide() {
    E.root.hidden = true;
    document.documentElement.classList.remove('qpe-open');
    hideDD();
    mode = null;
    W = null;
    draft = null;
  }

  function setTotal(v) {
    E.qpeTotal.textContent = money(v);
    E.qpeMTotal.textContent = money(v);
  }

  /* ---------- modo documento ---------- */
  async function openDoc() {
    if (!B()) return;
    ensureDom();
    mode = 'doc';
    fromDoc = false;
    W = B().getItems();
    docDirty = false;
    await loadPaper();
    show();
    renderDoc();
    E.qpeWrap.scrollTop = 0;
  }

  function docTitle() {
    const n = B().header().number || (paper && paper.number) || '';
    return `Serviços do orçamento${n ? ' · ' + n : ''}`;
  }

  function renderDoc(focusKey) {
    E.root.dataset.mode = 'doc';
    E.qpeTitle.textContent = docTitle();
    E.qpeSub.textContent = 'Edite direto no documento — é assim que o cliente vê o PDF';
    E.qpeDone.textContent = 'Pronto';
    E.qpeDone.hidden = false;
    E.qpeCancel.textContent = 'Cancelar';
    cancelArmed = 0;
    const m = buildModel(W);
    E.qpePaper.innerHTML = P.render(m, { mode: 'edit', focusKey });
    E.qpePaper.querySelectorAll('.qp-in--desc').forEach(autosize);
    setTotal(m.total);
    renderSide(m);
    E.qpeMbar.querySelector('[data-qpe-add]').setAttribute('data-qpe-add', '');
  }

  function renderSide(m) {
    const sq = B().header().projectArea;
    E.qpeSide.innerHTML = `
      <div class="qpe-card">
        <button type="button" class="qpe-btn qpe-btn--pri qpe-btn--full" data-qpe-add="">+ Adicionar serviço</button>
        <p class="qpe-note">Passo a passo, vendo a linha entrar no PDF.</p>
      </div>
      <div class="qpe-card">
        <h3>Resumo</h3>
        <dl class="qpe-sum">
          <div><dt>Subtotal</dt><dd data-side="sub">${money(m.subtotal)}</dd></div>
          ${m.discount > 0 ? `<div><dt>Desconto</dt><dd data-side="disc">−${money(m.discount)}</dd></div>` : ''}
          <div><dt>Imposto</dt><dd data-side="tax">${money(m.tax)}</dd></div>
          <div class="qpe-sum__t"><dt>Total</dt><dd data-side="total">${money(m.total)}</dd></div>
          ${sq > 0 ? `<div><dt>Por sq ft</dt><dd data-side="sqft">${money(m.total / sq)}</dd></div>` : ''}
        </dl>
        <p class="qpe-note">Desconto e imposto ficam no resumo do orçamento.</p>
      </div>
      <div class="qpe-card">
        <h3>Atalhos</h3>
        <ul class="qpe-tips">
          <li>Clique em qualquer texto da folha para editar</li>
          <li>Digite o nome para buscar na Tabela de Valor (${esc(B().pricingLabel())})</li>
          <li><kbd>Enter</kbd> vai para o próximo campo</li>
        </ul>
      </div>`;
  }

  function refreshDocNumbers() {
    const m = buildModel(W);
    P.refreshNumbers(E.qpePaper, m);
    setTotal(m.total);
    const set = (k, v) => {
      const el = E.qpeSide.querySelector(`[data-side="${k}"]`);
      if (el) el.textContent = v;
    };
    set('sub', money(m.subtotal));
    set('disc', '−' + money(m.discount));
    set('tax', money(m.tax));
    set('total', money(m.total));
    const sq = B().header().projectArea;
    if (sq > 0) set('sqft', money(m.total / sq));
  }

  function autosize(t) {
    t.style.setProperty('height', 'auto', 'important');
    t.style.setProperty('height', t.scrollHeight + 2 + 'px', 'important');
  }

  function onDocInput(e) {
    const inp = e.target.closest('[data-f]');
    if (!inp || mode !== 'doc') return;
    const row = inp.closest('.qp-tr');
    const k = Number(row && row.getAttribute('data-k'));
    const it = W[k];
    if (!it) return;
    const f = inp.getAttribute('data-f');
    docDirty = true;
    if (f === 'name') {
      it.name = inp.value;
      openDD(inp, k);
    } else if (f === 'description') {
      it.description = inp.value;
      it.catalog_customer_notes = inp.value || null;
      autosize(inp);
    } else if (f === 'quantity') {
      it.quantity = num(inp.value);
    } else if (f === 'rate') {
      it.rate = num(inp.value);
      it.sell_price = it.rate;
    } else if (f === 'unit') {
      it.unit_type = inp.value;
    }
    refreshDocNumbers();
  }

  /* ---------- busca na Tabela de Valor (modo documento) ---------- */
  function openDD(input, k) {
    const q = String(input.value || '').trim();
    const rows = B().filterCatalog(q).slice(0, 7);
    if (!rows.length) {
      hideDD();
      return;
    }
    ddState = { input, k, rows, on: 0 };
    const label = B().pricingLabel();
    E.qpeDD.innerHTML =
      `<div class="qpe-dd__h">Tabela de Valor · ${esc(label)}</div>` +
      rows
        .map(
          (r, i) => `<button type="button" class="qpe-dd__o${i === 0 ? ' is-on' : ''}" data-dd="${i}" role="option">
            <b>${esc(r.name)}</b><span>${esc(P.unitText(r.unit_type || 'sq_ft'))} · ${money(B().rateFor(r))}</span></button>`,
        )
        .join('');
    const rc = input.getBoundingClientRect();
    const w = Math.max(rc.width, 300);
    const left = Math.min(rc.left, window.innerWidth - w - 8);
    E.qpeDD.style.width = w + 'px';
    E.qpeDD.style.left = Math.max(8, left) + 'px';
    E.qpeDD.style.top = rc.bottom + 4 + 'px';
    E.qpeDD.hidden = false;
    const h = E.qpeDD.offsetHeight;
    if (rc.bottom + 4 + h > window.innerHeight - 8 && rc.top - h - 4 > 8) {
      E.qpeDD.style.top = rc.top - h - 4 + 'px';
    }
  }
  function hideDD() {
    if (E.qpeDD) E.qpeDD.hidden = true;
    ddState = null;
  }
  function pickDD(i) {
    if (!ddState) return;
    const r = ddState.rows[i];
    const k = ddState.k;
    hideDD();
    if (!r || !W[k]) return;
    const rate = B().rateFor(r);
    const desc = B().descFor(r, r.name);
    W[k] = {
      ...W[k],
      ...B().catalogIds(r),
      name: r.name || W[k].name,
      description: desc || W[k].description,
      catalog_customer_notes: desc || W[k].description || null,
      unit_type: r.unit_type || W[k].unit_type || 'sq_ft',
      rate,
      sell_price: rate,
      cost_price: rate > 0 ? rate : null,
      markup_percentage: null,
    };
    docDirty = true;
    renderDoc(k);
    const q = E.qpePaper.querySelector(`.qp-tr[data-k="${k}"] [data-f="quantity"]`);
    if (q) q.focus();
  }

  function onDocKey(e) {
    if (ddState && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      ddState.on = (ddState.on + (e.key === 'ArrowDown' ? 1 : -1) + ddState.rows.length) % ddState.rows.length;
      E.qpeDD.querySelectorAll('[data-dd]').forEach((b, i) => b.classList.toggle('is-on', i === ddState.on));
      return;
    }
    if (e.key === 'Enter' && e.target.matches('.qp-in') && !e.target.matches('textarea')) {
      e.preventDefault();
      if (ddState && e.target === ddState.input) {
        pickDD(ddState.on);
        return;
      }
      const all = Array.from(E.qpePaper.querySelectorAll('.qp-in'));
      const nx = all[all.indexOf(e.target) + 1];
      if (nx) nx.focus();
      else e.target.blur();
    }
    if (e.key === 'Escape' && ddState) {
      e.stopPropagation();
      hideDD();
    }
  }

  function commitDoc() {
    hideDD();
    const clean = W.filter((it) => String(it.name || '').trim() || Number(it.rate) > 0);
    B().setItems(clean);
    hide();
    if (docDirty) B().toast('Serviços atualizados.', 'success');
  }

  /* ---------- passo a passo ---------- */
  function newDraft(section) {
    return {
      name: '',
      description: '',
      notes: '',
      quantity: '',
      unit_type: 'sq_ft',
      base: 0,
      markup: '',
      service_type: section || 'Installation',
      sectionSet: !!section,
      row: null,
      query: '',
    };
  }

  async function openStep(opts) {
    if (!B()) return;
    ensureDom();
    opts = opts || {};
    fromDoc = mode === 'doc';
    mode = 'step';
    const st = opts.section
      ? (P.SECTIONS.find((s) => s.key === opts.section) || {}).st
      : null;
    draft = newDraft(st);
    step = 1;
    await loadPaper();
    show();
    renderStep(true);
  }

  function draftSell() {
    const m = String(draft.markup).trim() === '' ? null : num(draft.markup);
    return B().computeSellUnitRate(num(draft.base), m);
  }

  function draftItem() {
    const sell = draftSell();
    const ids = B().catalogIds(draft.row);
    const desc = String(draft.description || '').trim();
    const m = String(draft.markup).trim() === '' ? null : num(draft.markup);
    return {
      item_type: 'service',
      name: String(draft.name || '').trim(),
      description: desc,
      unit_type: draft.unit_type || 'sq_ft',
      quantity: num(draft.quantity),
      rate: sell,
      service_type: B().normalizeServiceType(draft.service_type),
      notes: String(draft.notes || '').trim() || null,
      catalog_customer_notes: desc || null,
      service_catalog_id: ids.service_catalog_id,
      product_id: null,
      cost_price: num(draft.base) > 0 ? num(draft.base) : null,
      markup_percentage: m,
      sell_price: sell,
      pricing_item_id: ids.pricing_item_id,
      estimateAuto: false,
    };
  }

  function baseList() {
    return fromDoc && W ? W : B().getItems();
  }

  function stepSummary(id) {
    const unit = P.unitText(draft.unit_type);
    if (id === 1) return draft.name ? `${draft.name}${draft.row ? ' · Tabela de Valor' : ' · serviço novo'}` : '';
    if (id === 2) return num(draft.quantity) > 0 ? `${P.qtyLabel(num(draft.quantity), draft.unit_type)}` : '';
    if (id === 3) {
      if (!(num(draft.base) > 0)) return '';
      const mk = String(draft.markup).trim() !== '' ? ` · margem ${num(draft.markup)}%` : '';
      return `${money(draftSell())} / ${unit}${mk}`;
    }
    if (id === 4) return draft.description ? `“${String(draft.description).split('\n')[0].slice(0, 60)}”` : '';
    if (id === 5) return (P.SECTIONS.find((s) => s.st === B().normalizeServiceType(draft.service_type)) || {}).name || '';
    return '';
  }

  function canReach(id) {
    if (id <= 1) return true;
    return !!String(draft.name || '').trim();
  }

  function stepBody(id) {
    if (id === 1) {
      const q = draft.query != null ? draft.query : draft.name;
      const rows = B().filterCatalog(q).slice(0, 8);
      const exact = rows.some((r) => String(r.name || '').trim().toLowerCase() === String(q || '').trim().toLowerCase());
      return `<label class="qpe-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="qpeQ" value="${esc(q)}" placeholder="Buscar na Tabela de Valor" autocomplete="off" aria-label="Buscar serviço" /></label>
        <div class="qpe-opts" id="qpeOpts">${
          rows
            .map(
              (r) => `<button type="button" class="qpe-opt${draft.row === r ? ' is-on' : ''}" data-pick="${esc(String(r.id))}">
              <b>${esc(r.name)}</b><span>${esc(B().normalizeServiceType(r.category) === 'Sand & Finishing' ? 'Sand & Finish' : B().normalizeServiceType(r.category))} · ${esc(P.unitText(r.unit_type || 'sq_ft'))} · ${money(B().rateFor(r))}</span></button>`,
            )
            .join('') || '<p class="qpe-empty">Nada na Tabela de Valor com esse nome.</p>'
        }${
          String(q || '').trim() && !exact
            ? `<button type="button" class="qpe-opt qpe-opt--new" data-pick-new><b>+ “${esc(String(q).trim())}”</b><span>usar como serviço novo</span></button>`
            : ''
        }</div>`;
    }
    if (id === 2) {
      const area = B().header().projectArea;
      const chips = UNIT_CHIPS.slice();
      if (!chips.some(([v]) => v === draft.unit_type)) chips.unshift([draft.unit_type, P.unitText(draft.unit_type)]);
      return `<div class="qpe-qty">
          <input class="qpe-in qpe-in--big" id="qpeQty" inputmode="decimal" value="${esc(draft.quantity)}" placeholder="0" aria-label="Quantidade" />
          <div class="qpe-chips" role="group" aria-label="Unidade">${chips
            .map(([v, l]) => `<button type="button" class="qpe-chip${draft.unit_type === v ? ' is-on' : ''}" data-unit="${esc(v)}">${esc(l)}</button>`)
            .join('')}</div>
        </div>
        ${area > 0 ? `<button type="button" class="qpe-link" data-area="${area}">Usar a área do projeto · ${Math.round(area).toLocaleString('en-US')} sq ft</button>` : ''}`;
    }
    if (id === 3) {
      const table = draft.row ? B().rateFor(draft.row) : 0;
      const sell = draftSell();
      return `<div class="qpe-grid2">
          <label class="qpe-f"><span>Preço por ${esc(P.unitText(draft.unit_type))}</span><div class="qpe-money"><i>$</i><input class="qpe-in" id="qpeRate" inputmode="decimal" value="${esc(draft.base ? String(Math.round(num(draft.base) * 100) / 100) : '')}" placeholder="0.00" /></div></label>
          <label class="qpe-f"><span>Margem %</span><input class="qpe-in" id="qpeMk" inputmode="decimal" value="${esc(draft.markup)}" placeholder="opcional" /></label>
        </div>
        <p class="qpe-note">${table > 0 ? `Tabela de Valor (${esc(B().pricingLabel())}): ${money(table)} / ${esc(P.unitText(draft.row.unit_type || draft.unit_type))}` : 'Serviço fora da Tabela de Valor — digite o preço.'}</p>
        <p class="qpe-calc" id="qpeCalc">No PDF: <b>${money(sell)}</b> × ${esc(P.qtyLabel(num(draft.quantity), draft.unit_type))} = <b>${money(B().lineAmount(num(draft.quantity), sell))}</b></p>`;
    }
    if (id === 4) {
      return `<label class="qpe-f"><span>Descrição</span><textarea class="qpe-in" id="qpeDesc" rows="3" data-crm-rich="off" placeholder="Ex.: Remove and reinstall baseboards">${esc(draft.description)}</textarea></label>
        <label class="qpe-f"><span>Observação <em>opcional · aparece como “Note:”</em></span><input class="qpe-in" id="qpeNotes" value="${esc(draft.notes)}" /></label>`;
    }
    const cur = B().normalizeServiceType(draft.service_type);
    const sug = draft.row ? B().normalizeServiceType(draft.row.category) : null;
    return `<div class="qpe-chips qpe-chips--sec" role="group" aria-label="Seção">${P.SECTIONS.map(
      (s) => `<button type="button" class="qpe-chip${cur === s.st ? ' is-on' : ''}" data-sec="${esc(s.st)}">${esc(s.name)}</button>`,
    ).join('')}</div>
      ${sug ? `<p class="qpe-note">Sugestão da Tabela de Valor: ${esc(sug === 'Sand & Finishing' ? 'Sand & Finish' : sug)}</p>` : ''}`;
  }

  function renderStepsPanel() {
    const list = STEPS.map((s) => {
      const on = s.id === step;
      const sum = stepSummary(s.id);
      const done = !on && !!sum && s.id < step;
      return `<div class="qpe-st${on ? ' is-on' : ''}${done ? ' is-done' : ''}" data-st="${s.id}">
        <button type="button" class="qpe-st__h" data-go="${s.id}"${canReach(s.id) ? '' : ' disabled'}>
          <span class="qpe-st__n">${done ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>' : s.id}</span>
          <span class="qpe-st__t"><b>${s.t}</b><small>${esc(sum || s.hint)}</small></span>
        </button>
        ${on ? `<div class="qpe-st__b">${stepBody(s.id)}</div>` : ''}
      </div>`;
    }).join('');
    const last = step === 5;
    E.qpeSteps.innerHTML = `<div class="qpe-st-list">${list}</div>
      <div class="qpe-st-ft">
        <button type="button" class="qpe-btn qpe-btn--ghost" data-step-back>${step === 1 ? (fromDoc ? 'Documento' : 'Cancelar') : 'Voltar'}</button>
        ${
          last
            ? `<button type="button" class="qpe-btn qpe-btn--ghost" data-add-more>Adicionar e continuar</button><button type="button" class="qpe-btn qpe-btn--pri" data-add>Adicionar</button>`
            : `<button type="button" class="qpe-btn qpe-btn--pri" data-step-next${canReach(step + 1) ? '' : ' disabled'}>Continuar</button>`
        }
      </div>`;
  }

  function renderStepPaper(scroll) {
    const base = baseList();
    const m = buildModel(base, { item: draftItem() });
    E.qpePaper.innerHTML = P.render(m, { mode: 'step', newKey: 'new' });
    setTotal(m.total);
    if (scroll) {
      const row = E.qpePaper.querySelector('.qp-tr.is-new');
      if (row) {
        const wr = E.qpeWrap.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        if (rr.top < wr.top + 20 || rr.bottom > wr.bottom - 20) {
          E.qpeWrap.scrollTop += rr.top - wr.top - wr.height / 3;
        }
      }
    }
  }

  function renderStep(scroll, focus) {
    E.root.dataset.mode = 'step';
    const n = B().header().number || (paper && paper.number) || '';
    E.qpeTitle.textContent = `Adicionar serviço${n ? ' · ' + n : ''}`;
    const stacked = window.matchMedia('(max-width: 1024px) and (orientation: portrait), (max-width: 900px)').matches;
    E.qpeSub.textContent = isPhone()
      ? 'A linha entra na folha a cada passo'
      : stacked
        ? 'Preencha abaixo e veja a linha entrar no PDF acima'
        : 'Preencha à esquerda e veja a linha entrar no PDF à direita';
    E.qpeDone.hidden = true;
    E.qpeCancel.textContent = fromDoc ? 'Voltar ao documento' : 'Fechar';
    renderStepsPanel();
    renderStepPaper(scroll !== false);
    const on = E.qpeSteps.querySelector('.qpe-st.is-on');
    const lst = E.qpeSteps.querySelector('.qpe-st-list');
    if (on && lst) {
      const lr = lst.getBoundingClientRect();
      const or = on.getBoundingClientRect();
      if (or.bottom > lr.bottom || or.top < lr.top) lst.scrollTop += or.top - lr.top - 8;
    }
    if (focus !== false) focusStep();
  }

  function focusStep() {
    const id = { 1: 'qpeQ', 2: 'qpeQty', 3: 'qpeRate', 4: 'qpeDesc' }[step];
    const el = id && document.getElementById(id);
    if (el && !isPhone()) {
      el.focus();
      try {
        const v = el.value;
        el.setSelectionRange(v.length, v.length);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function goStep(n) {
    if (n < 1 || n > 5 || !canReach(n)) return;
    step = n;
    renderStep(true);
  }

  function pickRow(r) {
    draft.row = r;
    draft.name = r.name || '';
    draft.query = null;
    draft.description = B().descFor(r, r.name);
    draft.unit_type = r.unit_type || 'sq_ft';
    draft.base = B().rateFor(r);
    draft.markup = '';
    if (!draft.sectionSet) draft.service_type = B().normalizeServiceType(r.category);
    goStep(2);
  }

  function addDraft(more) {
    const it = draftItem();
    if (!it.name) {
      goStep(1);
      return;
    }
    if (!(it.quantity > 0)) it.quantity = 1;
    if (fromDoc) {
      W.push(it);
      docDirty = true;
      if (more) {
        draft = newDraft(draft.sectionSet ? draft.service_type : null);
        step = 1;
        renderStep(true);
        return;
      }
      mode = 'doc';
      renderDoc(W.length - 1);
      const row = E.qpePaper.querySelector(`.qp-tr[data-k="${W.length - 1}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center' });
        row.classList.add('is-flash');
      }
      return;
    }
    const list = B().getItems();
    list.push(it);
    B().setItems(list);
    B().toast(`“${it.name}” adicionado.`, 'success');
    if (more) {
      draft = newDraft(draft.sectionSet ? draft.service_type : null);
      step = 1;
      renderStep(true);
      return;
    }
    hide();
  }

  function onStepInput(e) {
    const t = e.target;
    if (t.id === 'qpeQ') {
      draft.query = t.value;
      draft.name = t.value;
      draft.row = null;
      const box = document.getElementById('qpeOpts');
      if (box) {
        const tmp = document.createElement('div');
        tmp.innerHTML = stepBody(1);
        const fresh = tmp.querySelector('#qpeOpts');
        if (fresh) box.innerHTML = fresh.innerHTML;
      }
      const nx = E.qpeSteps.querySelector('[data-step-next]');
      if (nx) nx.disabled = !canReach(2);
      E.qpeSteps.querySelectorAll('[data-go]').forEach((b) => {
        b.disabled = !canReach(Number(b.getAttribute('data-go')));
      });
    } else if (t.id === 'qpeQty') draft.quantity = t.value;
    else if (t.id === 'qpeRate') draft.base = num(t.value);
    else if (t.id === 'qpeMk') draft.markup = t.value;
    else if (t.id === 'qpeDesc') draft.description = t.value;
    else if (t.id === 'qpeNotes') draft.notes = t.value;
    else return;
    if (t.id === 'qpeRate' || t.id === 'qpeMk') {
      const c = document.getElementById('qpeCalc');
      const sell = draftSell();
      if (c) c.innerHTML = `No PDF: <b>${money(sell)}</b> × ${esc(P.qtyLabel(num(draft.quantity), draft.unit_type))} = <b>${money(B().lineAmount(num(draft.quantity), sell))}</b>`;
    }
    const sm = E.qpeSteps.querySelector(`.qpe-st[data-st="${step}"] .qpe-st__t small`);
    if (sm && step !== 1) sm.textContent = stepSummary(step) || STEPS[step - 1].hint;
    renderStepPaper(false);
  }

  /* ---------- eventos ---------- */
  function cancel() {
    if (mode === 'step') {
      if (fromDoc) {
        mode = 'doc';
        renderDoc();
      } else hide();
      return;
    }
    if (mode === 'doc') {
      if (docDirty && !cancelArmed) {
        cancelArmed = 1;
        E.qpeCancel.textContent = 'Descartar alterações?';
        E.qpeCancel.classList.add('is-warn');
        setTimeout(() => {
          if (!E.qpeCancel) return;
          cancelArmed = 0;
          E.qpeCancel.classList.remove('is-warn');
          if (mode === 'doc') E.qpeCancel.textContent = 'Cancelar';
        }, 3200);
        return;
      }
      E.qpeCancel.classList.remove('is-warn');
      hide();
    }
  }

  function bind() {
    E.root.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-qpe-cancel]')) {
        if (t.closest('.qpe-x') && mode === 'doc' && docDirty) {
          // no celular o X também pede confirmação
        }
        cancel();
        return;
      }
      if (t.closest('#qpeDone')) {
        commitDoc();
        return;
      }
      const add = t.closest('[data-qpe-add],[data-qp-add]');
      if (add) {
        const sec = add.getAttribute('data-qp-add') || '';
        void openStep({ section: sec || null });
        return;
      }
      const del = t.closest('[data-qp-del]');
      if (del && mode === 'doc') {
        const k = Number(del.getAttribute('data-qp-del'));
        W.splice(k, 1);
        docDirty = true;
        renderDoc();
        return;
      }
      const dd = t.closest('[data-dd]');
      if (dd) {
        pickDD(Number(dd.getAttribute('data-dd')));
        return;
      }
      if (mode !== 'step') return;
      const go = t.closest('[data-go]');
      if (go) {
        goStep(Number(go.getAttribute('data-go')));
        return;
      }
      const pick = t.closest('[data-pick]');
      if (pick) {
        const id = pick.getAttribute('data-pick');
        const r = B().catalog().find((x) => String(x.id) === id);
        if (r) pickRow(r);
        return;
      }
      if (t.closest('[data-pick-new]')) {
        draft.row = null;
        draft.query = null;
        draft.base = 0;
        goStep(2);
        return;
      }
      const u = t.closest('[data-unit]');
      if (u) {
        draft.unit_type = u.getAttribute('data-unit');
        renderStep(false, false);
        const q = document.getElementById('qpeQty');
        if (q && !isPhone()) q.focus();
        return;
      }
      const ar = t.closest('[data-area]');
      if (ar) {
        draft.quantity = String(Math.round(Number(ar.getAttribute('data-area')) * 100) / 100);
        draft.unit_type = 'sq_ft';
        renderStep(false);
        return;
      }
      const sc = t.closest('[data-sec]');
      if (sc && t.closest('.qpe-steps')) {
        draft.service_type = sc.getAttribute('data-sec');
        draft.sectionSet = true;
        renderStep(true, false);
        return;
      }
      if (t.closest('[data-step-next]')) {
        goStep(step + 1);
        return;
      }
      if (t.closest('[data-step-back]')) {
        if (step === 1) cancel();
        else goStep(step - 1);
        return;
      }
      if (t.closest('[data-add-more]')) {
        addDraft(true);
        return;
      }
      if (t.closest('[data-add]')) {
        addDraft(false);
      }
    });
    E.root.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-dd]')) e.preventDefault();
    });
    E.qpePaper.addEventListener('input', onDocInput);
    E.qpePaper.addEventListener('change', (e) => {
      if (e.target.matches('select[data-f]')) onDocInput(e);
    });
    E.qpePaper.addEventListener('keydown', onDocKey);
    E.qpePaper.addEventListener('focusin', (e) => {
      if (mode === 'doc' && e.target.matches('[data-f="name"]')) {
        const row = e.target.closest('.qp-tr');
        if (e.target.value.trim().length < 2) openDD(e.target, Number(row.getAttribute('data-k')));
      }
    });
    E.qpePaper.addEventListener('focusout', (e) => {
      if (e.target.matches('[data-f="name"]')) setTimeout(() => {
        if (ddState && document.activeElement !== ddState.input) hideDD();
      }, 120);
      if (e.target.matches('[data-f="quantity"],[data-f="rate"]')) {
        const v = num(e.target.value);
        e.target.value = e.target.matches('[data-f="rate"]') ? v.toFixed(2) : String(Math.round(v * 100) / 100);
      }
    });
    E.qpeWrap.addEventListener('scroll', hideDD, { passive: true });
    E.qpeSteps.addEventListener('input', onStepInput);
    E.qpeSteps.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.matches('textarea')) return;
      e.preventDefault();
      if (step === 1) {
        const first = E.qpeSteps.querySelector('[data-pick]');
        const q = String(draft.query || '').trim().toLowerCase();
        const r = q && B().catalog().find((x) => String(x.name || '').trim().toLowerCase() === q);
        if (r) pickRow(r);
        else if (first && draft.query && B().filterCatalog(draft.query).length === 1) first.click();
        else if (canReach(2)) goStep(2);
        return;
      }
      if (step === 5) addDraft(false);
      else goStep(step + 1);
    });
    document.addEventListener('keydown', (e) => {
      if (!E.root || E.root.hidden || e.key !== 'Escape') return;
      if (ddState) {
        hideDD();
        return;
      }
      cancel();
    });
    window.addEventListener('resize', () => {
      hideDD();
    });
  }

  window.OmQuoteServices = { openDoc, openStep };
})();
