/**
 * Popup de serviços do construtor de orçamento — mesma aparência do PDF, numa tela só:
 *  - à esquerda, "Adicionar serviço" (Serviço → Quantidade → Preço → Descrição → Seção);
 *  - à direita, a folha do PDF, editável no lugar, com a linha nova entrando ao vivo.
 * Ao adicionar, a linha vai para a folha e o painel volta para o próximo serviço — sem fechar.
 * Cada mudança já vai para o orçamento (QBBridge, quote-builder.js); "Salvar e fechar" grava.
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
  let open = false;
  let W = []; // itens do orçamento (cópia viva, sincronizada com o construtor)
  let added = 0; // serviços adicionados nesta abertura
  let draft = null;
  let step = 1;
  let ddState = null;
  let syncT = null;
  let flashKey = null;
  let saving = false;
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
  function stacked() {
    return window.matchMedia('(max-width: 1024px) and (orientation: portrait), (max-width: 900px)').matches;
  }
  function secName(st) {
    const n = B().normalizeServiceType(st);
    return n === 'Sand & Finishing' ? 'Sand & Finish' : n;
  }
  /** "orçamento" no Quote · "job" quando o Job modal empresta esta tela. */
  function docNoun() {
    try {
      const n = B().docNoun && B().docNoun();
      return n ? String(n) : 'orçamento';
    } catch (_) {
      return 'orçamento';
    }
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
      section: P.sectionOf(it.item_type, it.service_type, it.name),
    };
  }

  function buildModel(withDraft) {
    const h = B().header();
    const pd = paper || {};
    const d = withDraft ? draftItem() : null;
    const t = B().totals(d && d.name ? W.concat([d]) : W);
    const lines = W.map((it, i) => itemToLine(it, i));
    if (d) lines.push(itemToLine(d, 'new'));
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
      signatures: P.signaturesFromApi ? P.signaturesFromApi(pd) : null,
      floorArea: h.floorArea || Number(pd.floorAreaSqft) || 0,
      subtotal: t.sub,
      discount: t.disc,
      tax: t.tax,
      total: t.total,
      schedule: pd.schedule || [],
      lines,
    };
  }

  /** Leva a folha para o orçamento (o construtor marca "alterações não salvas"). */
  function sync(now) {
    clearTimeout(syncT);
    const run = () => {
      syncT = null;
      B().setItems(W.filter((it) => String(it.name || '').trim() || Number(it.rate) > 0));
    };
    if (now) run();
    else syncT = setTimeout(run, 350);
  }

  /* ---------- casca ---------- */
  function ensureDom() {
    if (E.root) return;
    const root = document.createElement('div');
    root.className = 'qpe';
    root.id = 'qpe';
    root.hidden = true;
    root.dataset.mode = 'work';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'qpeTitle');
    root.innerHTML = `
      <div class="qpe-box">
        <header class="qpe-hd">
          <button type="button" class="qpe-x" data-qpe-close aria-label="Fechar"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
          <div class="qpe-hd__t"><h2 id="qpeTitle"></h2><p id="qpeSub"></p></div>
          <div class="qpe-hd__r">
            <span class="qpe-tot">Total <b id="qpeTotal">$0.00</b></span>
            <button type="button" class="qpe-btn qpe-btn--ghost" data-qpe-close>Fechar</button>
            <button type="button" class="qpe-btn qpe-btn--pri" id="qpeSave">Salvar e fechar</button>
          </div>
        </header>
        <div class="qpe-body">
          <section class="qpe-steps" id="qpeSteps" aria-label="Adicionar serviço"></section>
          <div class="qpe-wrap" id="qpeWrap"><div class="qp" id="qpePaper"></div></div>
        </div>
      </div>
      <div class="qpe-dd" id="qpeDD" hidden role="listbox"></div>`;
    document.body.appendChild(root);
    E.root = root;
    ['qpeTitle', 'qpeSub', 'qpeTotal', 'qpeSave', 'qpeSteps', 'qpeWrap', 'qpePaper', 'qpeDD'].forEach((id) => {
      E[id] = document.getElementById(id);
    });
    bind();
  }

  /** Abre a tela (opts.section já escolhe a seção do próximo serviço). */
  async function openWork(opts) {
    if (!B()) return;
    ensureDom();
    opts = opts || {};
    if (!open) {
      W = B().getItems();
      added = 0;
      draft = newDraft(sectionSt(opts.section));
      step = 1;
    }
    await loadPaper();
    open = true;
    E.root.hidden = false;
    document.documentElement.classList.add('qpe-open');
    renderHead();
    renderAll(true);
    if (opts.focusPaper) E.qpeWrap.scrollTop = 0;
  }
  function close() {
    if (syncT) sync(true);
    open = false;
    E.root.hidden = true;
    document.documentElement.classList.remove('qpe-open');
    hideDD();
    if (added) B().toast(`${added} ${added === 1 ? 'serviço adicionado' : 'serviços adicionados'} — lembre de salvar o ${docNoun()}.`, 'success');
    try {
      if (B().onClose) B().onClose({ added });
    } catch (_) {
      /* ignore */
    }
  }
  async function saveAndClose() {
    if (saving) return;
    if (syncT) sync(true);
    saving = true;
    E.qpeSave.disabled = true;
    E.qpeSave.textContent = 'Salvando…';
    let ok = false;
    try {
      ok = (await B().save()) !== false;
    } catch (_) {
      ok = false;
    }
    saving = false;
    E.qpeSave.disabled = false;
    E.qpeSave.textContent = 'Salvar e fechar';
    if (ok) {
      added = 0;
      close();
    }
  }

  function setTotal(v) {
    E.qpeTotal.textContent = money(v);
  }
  function renderHead() {
    const n = B().header().number || (paper && paper.number) || '';
    E.qpeTitle.textContent = `Serviços do ${docNoun()}${n ? ' · ' + n : ''}`;
    E.qpeSub.textContent = isPhone()
      ? 'Adicione embaixo · toque na folha para editar'
      : stacked()
        ? 'Adicione abaixo e veja a linha entrar na folha · toque na folha para editar'
        : 'Adicione à esquerda e veja a linha entrar na folha · clique na folha para editar';
  }

  /* ---------- folha ---------- */
  function renderPaper(scrollToNew) {
    const m = buildModel(true);
    E.qpePaper.innerHTML = P.render(m, { mode: 'edit', newKey: 'new' });
    E.qpePaper.querySelectorAll('.qp-in--desc').forEach(autosize);
    setTotal(m.total);
    if (flashKey != null) {
      const row = E.qpePaper.querySelector(`.qp-tr[data-k="${flashKey}"]`);
      if (row) row.classList.add('is-flash');
    }
    if (scrollToNew) scrollIntoWrap(E.qpePaper.querySelector('.qp-tr.is-new'));
  }
  function scrollIntoWrap(row) {
    if (!row) return;
    const wr = E.qpeWrap.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < wr.top + 20 || rr.bottom > wr.bottom - 20) {
      E.qpeWrap.scrollTop += rr.top - wr.top - wr.height / 3;
    }
  }
  /** Atualiza só a linha nova (sem recriar os campos da folha). */
  function refreshDraftRow() {
    const old = E.qpePaper.querySelector('.qp-tr.is-new');
    const m = buildModel(true);
    const sec = P.sectionOf('service', draftItem().service_type, draftItem().name);
    const oldSec = old && old.closest('.qp-block') && old.closest('.qp-block').querySelector('.qp-sec');
    if (!old || !oldSec || oldSec.getAttribute('data-sec') !== sec) {
      renderPaper(true);
      return;
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = P.render(m, { mode: 'edit', newKey: 'new' });
    const fresh = tmp.querySelector('.qp-tr.is-new');
    if (fresh) old.replaceWith(fresh);
    P.refreshNumbers(E.qpePaper, m);
    setTotal(m.total);
  }
  function refreshNumbers() {
    const m = buildModel(true);
    P.refreshNumbers(E.qpePaper, m);
    setTotal(m.total);
  }
  function autosize(t) {
    t.style.setProperty('height', 'auto', 'important');
    t.style.setProperty('height', t.scrollHeight + 2 + 'px', 'important');
  }

  function onPaperInput(e) {
    const inp = e.target.closest('[data-f]');
    if (!inp || !open) return;
    const row = inp.closest('.qp-tr');
    const k = Number(row && row.getAttribute('data-k'));
    const it = W[k];
    if (!it) return;
    const f = inp.getAttribute('data-f');
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
    refreshNumbers();
    sync();
  }

  /* ---------- busca na Tabela de Valor (linhas da folha) ---------- */
  function openDD(input, k) {
    const q = String(input.value || '').trim();
    const rows = B().filterCatalog(q).slice(0, 7);
    if (!rows.length) {
      hideDD();
      return;
    }
    ddState = { input, k, rows, on: 0 };
    E.qpeDD.innerHTML =
      `<div class="qpe-dd__h">Tabela de Valor · ${esc(B().pricingLabel())}</div>` +
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
    sync(true);
    renderPaper(false);
    const q = E.qpePaper.querySelector(`.qp-tr[data-k="${k}"] [data-f="quantity"]`);
    if (q) q.focus();
  }

  const descAck = new Set();
  function normDesc(s) {
    return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  }
  function rowForItem(it) {
    if (!it) return null;
    if (it.row) return it.row;
    const cat = (B().catalog && B().catalog()) || [];
    const sid = it.service_catalog_id != null ? String(it.service_catalog_id) : '';
    if (sid) {
      const hit = cat.find((r) => String(r.id) === sid);
      if (hit) return hit;
    }
    const pid = it.pricing_item_id != null ? String(it.pricing_item_id) : '';
    if (pid) {
      const hit = cat.find((r) => {
        const ids = B().catalogIds(r);
        return String(r.id) === pid || String(ids.pricing_item_id || '') === pid;
      });
      if (hit) return hit;
    }
    const name = String(it.name || '').trim().toLowerCase();
    if (!name) return null;
    return cat.find((r) => String(r.name || '').trim().toLowerCase() === name) || null;
  }
  /** Pergunta se a descrição nova fica só neste quote ou entra na Tabela de Valores. */
  function offerDesc(it, idx) {
    if (!it || !B().offerDescriptionChange) return;
    const row = rowForItem(it);
    if (!row) return;
    const pid = B().catalogIds(row).pricing_item_id;
    if (!pid) return;
    const tableDesc = B().descFor(row, it.name || row.name);
    const newDesc = String(it.description || '');
    if (normDesc(newDesc) === normDesc(tableDesc)) return;
    const key = String(pid) + '\n' + normDesc(newDesc);
    if (descAck.has(key)) return;
    descAck.add(key);
    if (idx != null && idx >= 0) sync(true);
    B().offerDescriptionChange({
      itemIdx: idx != null ? idx : -1,
      serviceName: it.name || row.name || '',
      newDesc,
      tableDesc,
      pricingItemId: String(pid),
      row,
    });
  }

  function onPaperKey(e) {
    if (ddState && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      ddState.on = (ddState.on + (e.key === 'ArrowDown' ? 1 : -1) + ddState.rows.length) % ddState.rows.length;
      E.qpeDD.querySelectorAll('[data-dd]').forEach((b, i) => b.classList.toggle('is-on', i === ddState.on));
      return;
    }
    if (e.key === 'Enter' && e.target.matches('.qp-in')) {
      if (e.target.matches('textarea') && e.shiftKey) return;
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

  /* ---------- painel "Adicionar serviço" ---------- */
  function sectionSt(key) {
    return key ? (P.SECTIONS.find((s) => s.key === key) || {}).st || null : null;
  }
  function newDraft(sectionStValue) {
    return {
      name: '',
      description: '',
      notes: '',
      quantity: '',
      unit_type: 'sq_ft',
      base: 0,
      markup: '',
      service_type: sectionStValue || 'Installation',
      sectionSet: !!sectionStValue,
      row: null,
      query: '',
    };
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
  function hasName() {
    return !!String(draft.name || '').trim();
  }
  function canReach(id) {
    return id <= 1 || hasName();
  }
  function stepSummary(id) {
    const unit = P.unitText(draft.unit_type);
    if (id === 1) return draft.name ? `${draft.name}${draft.row ? ' · Tabela de Valor' : ' · serviço novo'}` : '';
    if (id === 2) return num(draft.quantity) > 0 ? P.qtyLabel(num(draft.quantity), draft.unit_type) : '';
    if (id === 3) {
      if (!(num(draft.base) > 0)) return '';
      const mk = String(draft.markup).trim() !== '' ? ` · margem ${num(draft.markup)}%` : '';
      return `${money(draftSell())} / ${unit}${mk}`;
    }
    if (id === 4) return draft.description ? `“${String(draft.description).split('\n')[0].slice(0, 60)}”` : '';
    if (id === 5) return secName(draft.service_type);
    return '';
  }

  function calcHtml() {
    const sell = draftSell();
    return `No PDF: <b>${money(sell)}</b> × ${esc(P.qtyLabel(num(draft.quantity), draft.unit_type))} = <b>${money(B().lineAmount(num(draft.quantity), sell))}</b>`;
  }

  function optsHtml(q) {
    const rows = B().filterCatalog(q).slice(0, 8);
    const exact = rows.some((r) => String(r.name || '').trim().toLowerCase() === String(q || '').trim().toLowerCase());
    return (
      (rows
        .map(
          (r) => `<button type="button" class="qpe-opt${draft.row === r ? ' is-on' : ''}" data-pick="${esc(String(r.id))}">
            <b>${esc(r.name)}</b><span>${esc(secName(r.category))} · ${esc(P.unitText(r.unit_type || 'sq_ft'))} · ${money(B().rateFor(r))}</span></button>`,
        )
        .join('') || '<p class="qpe-empty">Nada na Tabela de Valor com esse nome.</p>') +
      (String(q || '').trim() && !exact
        ? `<button type="button" class="qpe-opt qpe-opt--new" data-pick-new><b>+ “${esc(String(q).trim())}”</b><span>usar como serviço novo</span></button>`
        : '')
    );
  }

  function stepBody(id) {
    if (id === 1) {
      const q = draft.query != null ? draft.query : draft.name;
      return `<label class="qpe-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="qpeQ" value="${esc(q)}" placeholder="Buscar na Tabela de Valor" autocomplete="off" aria-label="Buscar serviço" /></label>
        <div class="qpe-opts" id="qpeOpts">${optsHtml(q)}</div>`;
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
      return `<div class="qpe-grid2">
          <label class="qpe-f"><span>Preço por ${esc(P.unitText(draft.unit_type))}</span><div class="qpe-money"><i>$</i><input class="qpe-in" id="qpeRate" inputmode="decimal" value="${esc(draft.base ? String(Math.round(num(draft.base) * 100) / 100) : '')}" placeholder="0.00" /></div></label>
          <label class="qpe-f"><span>Margem %</span><input class="qpe-in" id="qpeMk" inputmode="decimal" value="${esc(draft.markup)}" placeholder="opcional" /></label>
        </div>
        <p class="qpe-note">${table > 0 ? `Tabela de Valor (${esc(B().pricingLabel())}): ${money(table)} / ${esc(P.unitText(draft.row.unit_type || draft.unit_type))}` : 'Serviço fora da Tabela de Valor — digite o preço.'}</p>
        <p class="qpe-calc" id="qpeCalc">${calcHtml()}</p>`;
    }
    if (id === 4) {
      return `<label class="qpe-f"><span>Descrição</span><textarea class="qpe-in" id="qpeDesc" rows="3" data-crm-rich="off" placeholder="Enter segue · Shift+Enter quebra a linha">${esc(draft.description)}</textarea></label>
        <label class="qpe-f"><span>Observação <em>opcional · aparece como “Note:”</em></span><input class="qpe-in" id="qpeNotes" value="${esc(draft.notes)}" /></label>`;
    }
    const cur = B().normalizeServiceType(draft.service_type);
    const sug = draft.row ? B().normalizeServiceType(draft.row.category) : null;
    return `<div class="qpe-chips qpe-chips--sec" role="group" aria-label="Seção">${P.SECTIONS.map(
      (s) => `<button type="button" class="qpe-chip${cur === s.st ? ' is-on' : ''}" data-sec="${esc(s.st)}">${esc(s.name)}</button>`,
    ).join('')}</div>
      ${sug ? `<p class="qpe-note">Sugestão da Tabela de Valor: ${esc(secName(sug))}</p>` : ''}`;
  }

  function renderSteps() {
    const list = STEPS.map((s) => {
      const on = s.id === step;
      const sum = stepSummary(s.id);
      const done = !on && !!sum && hasName();
      return `<div class="qpe-st${on ? ' is-on' : ''}${done ? ' is-done' : ''}" data-st="${s.id}">
        <button type="button" class="qpe-st__h" data-go="${s.id}"${canReach(s.id) ? '' : ' disabled'}>
          <span class="qpe-st__n">${done ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>' : s.id}</span>
          <span class="qpe-st__t"><b>${s.t}</b><small>${esc(sum || s.hint)}</small></span>
        </button>
        ${on ? `<div class="qpe-st__b">${stepBody(s.id)}</div>` : ''}
      </div>`;
    }).join('');
    const head = `<div class="qpe-st-hd"><b>Adicionar serviço</b>${
      added ? `<span class="qpe-st-hd__n">${added} ${added === 1 ? 'adicionado' : 'adicionados'}</span>` : ''
    }${hasName() ? '<button type="button" class="qpe-link qpe-link--mu" data-clear>Limpar</button>' : ''}</div>`;
    E.qpeSteps.innerHTML = `${head}<div class="qpe-st-list">${list}</div>
      <div class="qpe-st-ft">
        ${step > 1 ? '<button type="button" class="qpe-btn qpe-btn--ghost qpe-btn--sq" data-step-back aria-label="Voltar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>' : ''}
        ${step < 5 ? `<button type="button" class="qpe-btn qpe-btn--ghost" data-step-next${canReach(step + 1) ? '' : ' disabled'}>Próximo</button>` : ''}
        <button type="button" class="qpe-btn qpe-btn--pri" data-add${hasName() ? '' : ' disabled'}>Adicionar à folha <kbd>↵</kbd></button>
      </div>`;
    const on = E.qpeSteps.querySelector('.qpe-st.is-on');
    const lst = E.qpeSteps.querySelector('.qpe-st-list');
    if (on && lst) {
      const lr = lst.getBoundingClientRect();
      const or = on.getBoundingClientRect();
      if (or.bottom > lr.bottom || or.top < lr.top) lst.scrollTop += or.top - lr.top - 8;
    }
  }
  function syncFooter() {
    const add = E.qpeSteps.querySelector('[data-add]');
    if (add) add.disabled = !hasName();
    const nx = E.qpeSteps.querySelector('[data-step-next]');
    if (nx) nx.disabled = !canReach(step + 1);
    E.qpeSteps.querySelectorAll('[data-go]').forEach((b) => {
      b.disabled = !canReach(Number(b.getAttribute('data-go')));
    });
  }

  function renderAll(scroll, focus) {
    renderSteps();
    renderPaper(scroll !== false);
    if (focus !== false) focusStep();
  }
  function focusStep() {
    const id = { 1: 'qpeQ', 2: 'qpeQty', 3: 'qpeRate', 4: 'qpeDesc' }[step];
    const el = id && document.getElementById(id);
    if (el && !isPhone()) {
      el.focus();
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch (_) {
        /* ignore */
      }
    }
  }
  function goStep(n) {
    if (n < 1 || n > 5 || !canReach(n)) return;
    step = n;
    renderSteps();
    refreshDraftRow();
    focusStep();
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
    step = 2;
    renderSteps();
    renderPaper(true);
    focusStep();
  }

  /** Adiciona a linha à folha e já prepara o próximo serviço (a tela não fecha). */
  function addDraft() {
    const it = draftItem();
    if (!it.name) {
      goStep(1);
      return;
    }
    if (!(it.quantity > 0)) it.quantity = 1;
    W.push(it);
    added += 1;
    flashKey = W.length - 1;
    sync(true);
    draft = newDraft(draft.sectionSet ? draft.service_type : null);
    step = 1;
    renderSteps();
    renderPaper(false);
    scrollIntoWrap(E.qpePaper.querySelector(`.qp-tr[data-k="${flashKey}"]`));
    setTimeout(() => {
      flashKey = null;
    }, 1700);
    focusStep();
  }

  let optsActive = -1;

  function syncOptsHighlight() {
    const box = document.getElementById('qpeOpts');
    if (!box) return;
    const buttons = Array.from(box.querySelectorAll('[data-pick], [data-pick-new]'));
    buttons.forEach((btn, i) => {
      const on = i === optsActive;
      btn.classList.toggle('is-on', on);
      btn.classList.toggle('is-kb', on);
      if (on) btn.scrollIntoView({ block: 'nearest' });
    });
  }

  function moveOptsActive(delta) {
    const box = document.getElementById('qpeOpts');
    if (!box) return false;
    const buttons = Array.from(box.querySelectorAll('[data-pick], [data-pick-new]'));
    if (!buttons.length) return false;
    if (optsActive < 0) optsActive = delta > 0 ? 0 : buttons.length - 1;
    else optsActive = (optsActive + delta + buttons.length) % buttons.length;
    syncOptsHighlight();
    return true;
  }

  function selectOptsActive() {
    const box = document.getElementById('qpeOpts');
    if (!box || optsActive < 0) return false;
    const buttons = Array.from(box.querySelectorAll('[data-pick], [data-pick-new]'));
    const btn = buttons[optsActive];
    if (!btn) return false;
    if (btn.hasAttribute('data-pick-new')) {
      draft.row = null;
      draft.query = null;
      draft.base = 0;
      goStep(2);
      return true;
    }
    const id = btn.getAttribute('data-pick');
    const r = B().catalog().find((x) => String(x.id) === id);
    if (r) {
      pickRow(r);
      return true;
    }
    return false;
  }

  function onStepInput(e) {
    const t = e.target;
    if (t.id === 'qpeQ') {
      draft.query = t.value;
      draft.name = t.value;
      draft.row = null;
      optsActive = -1;
      const box = document.getElementById('qpeOpts');
      if (box) box.innerHTML = optsHtml(t.value);
      syncFooter();
    } else if (t.id === 'qpeQty') draft.quantity = t.value;
    else if (t.id === 'qpeRate') draft.base = num(t.value);
    else if (t.id === 'qpeMk') draft.markup = t.value;
    else if (t.id === 'qpeDesc') draft.description = t.value;
    else if (t.id === 'qpeNotes') draft.notes = t.value;
    else return;
    if (t.id === 'qpeRate' || t.id === 'qpeMk') {
      const c = document.getElementById('qpeCalc');
      if (c) c.innerHTML = calcHtml();
    }
    const sm = E.qpeSteps.querySelector(`.qpe-st[data-st="${step}"] .qpe-st__t small`);
    if (sm && step !== 1) sm.textContent = stepSummary(step) || STEPS[step - 1].hint;
    refreshDraftRow();
  }

  /* ---------- eventos ---------- */
  function bind() {
    E.root.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-qpe-close]')) {
        close();
        return;
      }
      if (t.closest('#qpeSave')) {
        void saveAndClose();
        return;
      }
      const secAdd = t.closest('[data-qp-add]');
      if (secAdd) {
        const st = sectionSt(secAdd.getAttribute('data-qp-add'));
        if (st) {
          draft.service_type = st;
          draft.sectionSet = true;
        }
        if (!hasName()) step = 1;
        renderAll(true);
        return;
      }
      const del = t.closest('[data-qp-del]');
      if (del) {
        W.splice(Number(del.getAttribute('data-qp-del')), 1);
        sync(true);
        renderPaper(false);
        return;
      }
      const dd = t.closest('[data-dd]');
      if (dd) {
        pickDD(Number(dd.getAttribute('data-dd')));
        return;
      }
      if (!t.closest('.qpe-steps')) return;
      if (t.closest('[data-clear]')) {
        draft = newDraft(draft.sectionSet ? draft.service_type : null);
        step = 1;
        renderAll(false);
        return;
      }
      const go = t.closest('[data-go]');
      if (go) {
        goStep(Number(go.getAttribute('data-go')));
        return;
      }
      const pick = t.closest('[data-pick]');
      if (pick) {
        const r = B().catalog().find((x) => String(x.id) === pick.getAttribute('data-pick'));
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
        renderSteps();
        refreshDraftRow();
        focusStep();
        return;
      }
      const ar = t.closest('[data-area]');
      if (ar) {
        draft.quantity = String(Math.round(Number(ar.getAttribute('data-area')) * 100) / 100);
        draft.unit_type = 'sq_ft';
        renderSteps();
        refreshDraftRow();
        focusStep();
        return;
      }
      const sc = t.closest('[data-sec]');
      if (sc) {
        draft.service_type = sc.getAttribute('data-sec');
        draft.sectionSet = true;
        renderSteps();
        renderPaper(true);
        return;
      }
      if (t.closest('[data-step-next]')) {
        goStep(step + 1);
        return;
      }
      if (t.closest('[data-step-back]')) {
        goStep(step - 1);
        return;
      }
      if (t.closest('[data-add]')) addDraft();
    });
    E.root.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-dd]')) e.preventDefault();
    });
    E.qpePaper.addEventListener('input', onPaperInput);
    E.qpePaper.addEventListener('change', (e) => {
      if (e.target.matches('select[data-f]')) onPaperInput(e);
    });
    E.qpePaper.addEventListener('keydown', onPaperKey);
    E.qpePaper.addEventListener('focusin', (e) => {
      if (e.target.matches('[data-f="name"]')) {
        const row = e.target.closest('.qp-tr');
        if (e.target.value.trim().length < 2) openDD(e.target, Number(row.getAttribute('data-k')));
      }
    });
    E.qpePaper.addEventListener('focusout', (e) => {
      if (e.target.matches('[data-f="name"]')) {
        setTimeout(() => {
          if (ddState && document.activeElement !== ddState.input) hideDD();
        }, 120);
      }
      if (e.target.matches('[data-f="quantity"],[data-f="rate"]')) {
        const v = num(e.target.value);
        e.target.value = e.target.matches('[data-f="rate"]') ? v.toFixed(2) : String(Math.round(v * 100) / 100);
      }
      if (e.target.matches('[data-f="description"]')) {
        const row = e.target.closest('.qp-tr');
        const k = Number(row && row.getAttribute('data-k'));
        if (W[k]) offerDesc(W[k], k);
      }
    });
    E.qpeWrap.addEventListener('scroll', hideDD, { passive: true });
    E.qpeSteps.addEventListener('input', onStepInput);
    E.qpeSteps.addEventListener('focusout', (e) => {
      if (e.target && e.target.id === 'qpeDesc') offerDesc(draft, -1);
    });
    E.qpeSteps.addEventListener('keydown', (e) => {
      if (step === 1 && e.target && e.target.id === 'qpeQ') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveOptsActive(e.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (optsActive >= 0 && selectOptsActive()) return;
          const q = String(draft.query || '').trim().toLowerCase();
          const exact = q && B().catalog().find((x) => String(x.name || '').trim().toLowerCase() === q);
          const list = draft.query ? B().filterCatalog(draft.query) : [];
          if (exact) pickRow(exact);
          else if (list.length === 1) pickRow(list[0]);
          else if (hasName()) goStep(2);
          return;
        }
        if (e.key === 'Escape') {
          optsActive = -1;
          syncOptsHighlight();
          return;
        }
      }
      if (e.target && e.target.matches('textarea')) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        if (step < 5) goStep(step + 1);
        else addDraft();
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (step === 1) {
        const q = String(draft.query || '').trim().toLowerCase();
        const exact = q && B().catalog().find((x) => String(x.name || '').trim().toLowerCase() === q);
        const list = draft.query ? B().filterCatalog(draft.query) : [];
        if (exact) pickRow(exact);
        else if (list.length === 1) pickRow(list[0]);
        else if (hasName()) goStep(2);
        return;
      }
      // Enter adiciona quando já há preço (veio da Tabela ou foi digitado); senão vai ao próximo passo.
      if (num(draft.base) > 0 || step === 5) addDraft();
      else goStep(step + 1);
    });
    document.addEventListener('keydown', (e) => {
      if (!E.root || E.root.hidden || e.key !== 'Escape') return;
      if (ddState) {
        hideDD();
        return;
      }
      close();
    });
    window.addEventListener('resize', () => {
      hideDD();
      if (open) renderHead();
    });
  }

  window.OmQuoteServices = {
    openDoc: () => openWork({ focusPaper: true }),
    openStep: (opts) => openWork(opts),
  };
})();
