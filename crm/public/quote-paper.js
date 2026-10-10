/**
 * Folha com o mesmo visual do PDF do orçamento (src/lib/quotes/pdf.ts).
 * Usada na prévia da lista de Quotes e no popup de serviços do construtor.
 *
 * OmQuotePaper.render(model, opts) → HTML
 *   model: { org, number, issued, valid, bill, job, prep, floorArea, subtotal, discount, tax, total,
 *            deposit, payments, lines: [{ key, name, description, notes, quantity, unit, rate, section }] }
 *   opts:  { mode: 'view'|'edit'|'step', newKey, editBtn, units }
 */
(function (global) {
  const SECTIONS = [
    { key: 'supply', label: 'SUPPLY', name: 'Supply', st: 'Supply' },
    { key: 'installation', label: 'INSTALLATION', name: 'Installation', st: 'Installation' },
    { key: 'sand_finish', label: 'SAND & FINISH', name: 'Sand & Finish', st: 'Sand & Finishing' },
  ];
  const DEFAULT_TAGLINE = 'Hardwood · LVP · Refinishing';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(n) {
    const x = Number(n) || 0;
    return '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function lineAmount(q, r) {
    return Math.round((Number(q) || 0) * (Number(r) || 0) * 100) / 100;
  }
  function fmtDate(v) {
    if (!v) return '—';
    const d = v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T12:00:00Z` : v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function unitText(unit) {
    return String(unit || 'sqft').replace(/_/g, ' ');
  }
  function qtyLabel(qty, unit) {
    const q = Number(qty) || 0;
    const s =
      Math.abs(q) >= 100
        ? q.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : q.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `${s} ${unitText(unit)}`;
  }
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (String(name || 'OM').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || 'OM').toUpperCase();
  }
  /** Mesmo agrupamento do PDF: produto → Supply; sem tipo → Installation. */
  function sectionOf(itemType, serviceType) {
    if (String(itemType || '').toLowerCase() === 'product') return 'supply';
    const st = String(serviceType || '').trim().toLowerCase();
    if (!st) return 'installation';
    if (st.includes('supply') || st.includes('fornec') || st.includes('material')) return 'supply';
    if (st.includes('sand') || st.includes('finish') || st.includes('lix') || st.includes('acab')) return 'sand_finish';
    return 'installation';
  }
  function stripMarks(t) {
    return String(t || '')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1');
  }
  function bodyWithoutTitle(name, description) {
    const n = String(name || '').trim();
    let d = String(description || '').trim();
    if (!d || !n) return d;
    if (d === n) return '';
    const nl = n.toLowerCase();
    const lines = d.split(/\n/);
    if (lines[0] && lines[0].trim().toLowerCase() === nl) d = lines.slice(1).join('\n').trim();
    while (d && d.toLowerCase().startsWith(nl)) d = d.slice(n.length).replace(/^[\s—–:·.\-]+/, '').trim();
    return d;
  }

  /** Modelo a partir de GET /api/quotes/:id/paper */
  function fromApi(d) {
    const lines = (d.lines || [])
      .filter((l) => !l.optionGroupId && !l.isOptional)
      .map((l, i) => ({
        key: i,
        name: l.name || '',
        description: bodyWithoutTitle(l.name, l.description),
        notes: l.notes || '',
        quantity: Number(l.quantity) || 0,
        unit: l.unit,
        rate: Number(l.unitPrice) || 0,
        amount: Number(l.amount) || 0,
        section: sectionOf(l.itemType, l.serviceType),
      }));
    const prepared = d.preparedBy || {};
    return {
      org: orgFromApi(d),
      number: d.number,
      issued: d.issueDate,
      valid: d.validUntil,
      bill: { name: d.customerName || 'Client', email: d.customerEmail, phone: d.customerPhone },
      job: { name: d.projectName || d.title || 'Project', address: d.projectAddress, city: d.projectCityLine },
      prep: {
        name: prepared.name || d.organizationName,
        line: [prepared.title, prepared.email].filter(Boolean).join(' · '),
      },
      floorArea: Number(d.floorAreaSqft) || (d.rooms || []).reduce((s, r) => s + (Number(r.areaSqft) || 0), 0) || 0,
      subtotal: Number(d.subtotal) || 0,
      discount: 0,
      tax: Number(d.taxTotal) || 0,
      total: Number(d.total) || 0,
      schedule: d.schedule || [],
      lines,
    };
  }
  function orgFromApi(d) {
    return {
      name: d.organizationName || '',
      tagline: d.organizationTagline || DEFAULT_TAGLINE,
      contact: [d.organizationContact, d.organizationLicense].filter(Boolean).join('  ·  '),
      logo: d.organizationLogoUrl || '',
      accent: /^#[0-9a-f]{6}$/i.test(d.brandAccent || '') ? d.brandAccent : '#e8792c',
    };
  }

  /** Pagamentos como no PDF: cronograma salvo ou 50% na aprovação + saldo. */
  function payments(model) {
    const total = Number(model.total) || 0;
    const sch = model.schedule || [];
    if (sch.length) {
      return sch.map((it) => {
        const fixed = Number(it.fixedAmount);
        const pct = Number(it.percent);
        let amount = Number.isFinite(fixed) && fixed > 0 ? fixed : 0;
        if (!amount && Number.isFinite(pct) && pct > 0) amount = Math.round(((total * pct) / 100) * 100) / 100;
        return { label: `${it.label}${Number.isFinite(pct) && pct > 0 ? ` (${pct}%)` : ''}`, amount };
      });
    }
    const dep = Math.round(total * 0.5 * 100) / 100;
    return [
      { label: 'Deposit · due on approval (50%)', amount: dep },
      { label: 'Balance · due on completion', amount: Math.max(0, total - dep) },
    ];
  }

  function group(lines) {
    const by = { supply: [], installation: [], sand_finish: [] };
    for (const l of lines) (by[l.section] || by.installation).push(l);
    return SECTIONS.map((s) => ({
      ...s,
      lines: by[s.key],
      total: by[s.key].reduce((t, l) => t + lineAmount(l.quantity, l.rate), 0),
    }));
  }

  const UNITS = [
    ['sq_ft', 'sq ft'],
    ['linear_ft', 'linear ft'],
    ['step', 'step'],
    ['fixed', 'fixed'],
    ['box', 'box'],
    ['piece', 'piece'],
    ['inches', 'inches'],
  ];

  function unitSelect(cur) {
    const list = UNITS.slice();
    if (cur && !list.some(([v]) => v === cur)) list.push([cur, unitText(cur)]);
    return `<select class="qp-in qp-in--unit" data-f="unit" aria-label="Unidade">${list
      .map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`)
      .join('')}</select>`;
  }

  function numVal(n) {
    const v = Number(n) || 0;
    return String(Math.round(v * 100) / 100);
  }

  function rowView(l, opts) {
    const isNew = opts.newKey != null && l.key === opts.newKey;
    const name = stripMarks(l.name).trim();
    const desc = stripMarks(l.description || '');
    const empty = isNew && !name;
    return `<div class="qp-tr${isNew ? ' is-new' : ''}" data-k="${esc(l.key)}">
      <div class="qp-c qp-c--d"><b${empty ? ' class="is-ph"' : ''}>${esc(name || (isNew ? 'Novo serviço' : 'Line item'))}</b>${
        desc ? `<small>${esc(desc)}</small>` : isNew && !desc ? '' : ''
      }${l.notes ? `<em>Note: ${esc(l.notes)}</em>` : ''}</div>
      <div class="qp-c qp-c--q">${isNew && !(Number(l.quantity) > 0) ? '—' : esc(qtyLabel(l.quantity, l.unit))}</div>
      <div class="qp-c qp-c--r">${isNew && !(Number(l.rate) > 0) ? '—' : money(l.rate)}</div>
      <div class="qp-c qp-c--a" data-amt>${isNew && !(lineAmount(l.quantity, l.rate) > 0) ? '—' : money(lineAmount(l.quantity, l.rate))}</div>
    </div>`;
  }

  function rowEdit(l, opts) {
    return `<div class="qp-tr qp-tr--ed${opts.focusKey === l.key ? ' is-on' : ''}" data-k="${esc(l.key)}">
      <div class="qp-c qp-c--d">
        <input class="qp-in qp-in--name" data-f="name" value="${esc(l.name)}" placeholder="Serviço — busque na Tabela de Valor" autocomplete="off" aria-label="Serviço" />
        <textarea class="qp-in qp-in--desc" data-f="description" rows="1" data-crm-rich="off" placeholder="Descrição que o cliente vê (opcional)" aria-label="Descrição">${esc(l.description || '')}</textarea>
      </div>
      <div class="qp-c qp-c--q"><input class="qp-in qp-in--num" data-f="quantity" inputmode="decimal" value="${esc(numVal(l.quantity))}" aria-label="Quantidade" />${unitSelect(l.unit)}</div>
      <div class="qp-c qp-c--r"><span class="qp-cur">$</span><input class="qp-in qp-in--num" data-f="rate" inputmode="decimal" value="${esc((Number(l.rate) || 0).toFixed(2))}" aria-label="Preço unitário" /></div>
      <div class="qp-c qp-c--a" data-amt>${money(lineAmount(l.quantity, l.rate))}</div>
      <button type="button" class="qp-x" data-qp-del="${esc(l.key)}" title="Remover linha" aria-label="Remover linha">×</button>
    </div>`;
  }

  function render(model, opts) {
    opts = opts || {};
    const mode = opts.mode || 'view';
    const org = model.org || {};
    const lines = model.lines || [];
    const sections = group(lines);
    const pays = payments(model);
    const deposit = pays[0] ? pays[0].amount : 0;
    const numLabel = typeof model.number === 'string' && model.number.trim() ? model.number : model.number ? `Q-${model.number}` : 'Q-—';
    const mark = org.logo
      ? `<span class="qp-logo qp-logo--img"><img src="${esc(org.logo)}" alt="" /></span>`
      : `<span class="qp-logo">${esc(initials(org.name))}</span>`;
    const info = (label, rows) =>
      `<div class="qp-info"><span class="qp-lbl">${label}</span>${rows
        .filter((r) => r && r.t)
        .map((r) => (r.b ? `<b>${esc(r.t)}</b>` : `<span>${esc(r.t)}</span>`))
        .join('')}</div>`;

    const secHtml = sections
      .map((s) => {
        const show = s.lines.length || mode === 'edit';
        if (!show) return '';
        const head = `<div class="qp-sec" data-sec="${s.key}"><span>${s.label}</span><small>Section total&nbsp; <i data-sec-total="${s.key}">${money(s.total)}</i></small></div>
          <div class="qp-th"><span>DESCRIPTION</span><span>QTY</span><span>RATE</span><span>AMOUNT</span></div>`;
        const rows = s.lines.map((l) => (mode === 'edit' ? rowEdit(l, opts) : rowView(l, opts))).join('');
        const add =
          mode === 'edit'
            ? `<button type="button" class="qp-add" data-qp-add="${s.key}"><span>+</span> Adicionar serviço em ${s.name}${
                s.lines.length ? '' : ' <em>· seção vazia não aparece no PDF</em>'
              }</button>`
            : '';
        return `<div class="qp-block${s.lines.length ? '' : ' is-empty'}">${head}${rows}${add}</div>`;
      })
      .join('');

    const noLines = !lines.length && mode !== 'edit' ? '<p class="qp-none">No line items.</p>' : '';
    const disc = Number(model.discount) || 0;

    return `<div class="qp-page qp--${mode}" style="--qp-acc:${esc(org.accent || '#e8792c')}">
      <div class="qp-bar"></div>
      ${opts.editBtn ? `<button type="button" class="qp-editbtn" data-qp-edit><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Editar serviços</button>` : ''}
      <header class="qp-hd">
        <div class="qp-org">${mark}<div><b>${esc(org.name)}</b><span>${esc(org.tagline || DEFAULT_TAGLINE)}</span>${
          org.contact ? `<small>${esc(org.contact)}</small>` : ''
        }</div></div>
        <div class="qp-no"><span class="qp-om">ObraMate <i></i></span><span>QUOTE</span><b>${esc(numLabel)}</b><small>Issued ${esc(fmtDate(model.issued))}</small><small>Valid until ${esc(fmtDate(model.valid))}</small></div>
      </header>
      <div class="qp-kpi">
        <div><span class="qp-lbl">QUOTE TOTAL</span><b class="qp-big" data-qp-total>${money(model.total)}</b></div>
        <div><span class="qp-lbl">DUE ON APPROVAL</span><b class="qp-big" data-qp-dep>${money(deposit)}</b></div>
        <div><span class="qp-lbl">FLOOR AREA</span><b>${model.floorArea > 0 ? `${Number(model.floorArea).toLocaleString('en-US')} sq ft` : '—'}</b></div>
        <div><span class="qp-lbl">VALID UNTIL</span><b>${esc(fmtDate(model.valid))}</b></div>
      </div>
      <div class="qp-infos">
        ${info('BILL TO', [{ t: (model.bill || {}).name || 'Client', b: 1 }, { t: (model.bill || {}).email }, { t: (model.bill || {}).phone }])}
        ${info('JOB SITE', [{ t: (model.job || {}).name || 'Project', b: 1 }, { t: (model.job || {}).address }, { t: (model.job || {}).city }])}
        ${info('PREPARED BY', [{ t: (model.prep || {}).name || org.name, b: 1 }, { t: (model.prep || {}).line }])}
      </div>
      <div class="qp-lines">${secHtml}${noLines}</div>
      <div class="qp-end">
        <div class="qp-pay"><b>PAYMENT SCHEDULE</b>${pays
          .map((p, i) => `<div><span>${esc(p.label)}</span><b${i === 0 ? ' data-qp-dep2' : ''}>${money(p.amount)}</b></div>`)
          .join('')}<small>We accept card, ACH, and check.</small></div>
        <div class="qp-tots">
          <div><span>Subtotal</span><b data-qp-sub>${money(model.subtotal)}</b></div>
          ${disc > 0 ? `<div><span>Discount</span><b data-qp-disc>−${money(disc)}</b></div>` : ''}
          <div><span>Tax</span><b data-qp-tax>${money(model.tax)}</b></div>
          <div class="qp-total"><span>TOTAL</span><b data-qp-total2>${money(model.total)}</b></div>
        </div>
      </div>
      <footer class="qp-ft"><span>${esc(numLabel)} · ${esc((model.bill || {}).name || '')}</span><span><i class="qp-om-i"></i>Made with ObraMate</span><span>Page 1 of 2</span></footer>
    </div>`;
  }

  /** Atualiza só os números (sem recriar inputs) depois de uma edição. */
  function refreshNumbers(root, model) {
    if (!root) return;
    const sections = group(model.lines || []);
    for (const s of sections) {
      const el = root.querySelector(`[data-sec-total="${s.key}"]`);
      if (el) el.textContent = money(s.total);
    }
    for (const l of model.lines || []) {
      const row = root.querySelector(`.qp-tr[data-k="${l.key}"] [data-amt]`);
      if (row) row.textContent = money(lineAmount(l.quantity, l.rate));
    }
    const pays = payments(model);
    const set = (sel, v) => root.querySelectorAll(sel).forEach((e) => (e.textContent = v));
    set('[data-qp-total],[data-qp-total2]', money(model.total));
    set('[data-qp-dep],[data-qp-dep2]', money(pays[0] ? pays[0].amount : 0));
    set('[data-qp-sub]', money(model.subtotal));
    set('[data-qp-tax]', money(model.tax));
    set('[data-qp-disc]', '−' + money(model.discount));
  }

  global.OmQuotePaper = {
    SECTIONS,
    render,
    refreshNumbers,
    fromApi,
    orgFromApi,
    sectionOf,
    bodyWithoutTitle,
    lineAmount,
    money,
    qtyLabel,
    unitText,
    UNITS,
    fmtDate,
    payments,
  };
})(window);
