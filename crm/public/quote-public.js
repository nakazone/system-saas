/* global fetch, crmNotify */
(function () {
  const params = new URLSearchParams(location.search);
  const legacyToken = params.get('t');
  const docEl = document.getElementById('quoteDocument');
  const innerEl = document.getElementById('quoteDocumentInner');
  const actionsEl = document.getElementById('quoteActions');
  const approvedEl = document.getElementById('quoteApprovedMsg');
  const errorEl = document.getElementById('quoteError');
  const loadingEl = document.getElementById('quoteLoading');

  const QUOTE_NUMBER_PATH_RE = /^\/((?:SF|Q)-\d{4}-\d+)\/?$/i;

  const COMPANY = {
    name: 'Senior Floors',
    tagline: 'Hardwood · LVP · Refinishing · Denver Metro',
    phone: '(720) 751-9813',
    email: 'contact@senior-floors.com',
  };

  const SECTION_DEFS = [
    { key: 'installation', label: 'Installation' },
    { key: 'sand_finish', label: 'Sand & Finishing' },
    { key: 'supply', label: 'Supply' },
    { key: 'products', label: 'Materials & products' },
  ];

  const money = (n) =>
    '$' +
    (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolvePublicQuoteAccess() {
    const pathMatch = location.pathname.match(QUOTE_NUMBER_PATH_RE);
    if (pathMatch) {
      return {
        mode: 'number',
        ref: pathMatch[1],
        apiBase: `/api/public/quotes/by-number/${encodeURIComponent(pathMatch[1])}`,
      };
    }
    if (legacyToken && legacyToken.length >= 16) {
      return {
        mode: 'token',
        ref: legacyToken,
        apiBase: `/api/public/quotes/${encodeURIComponent(legacyToken)}`,
      };
    }
    return null;
  }

  const access = resolvePublicQuoteAccess();

  function defaultTerms() {
    return (
      'This quote is valid until the expiration date shown. Pricing assumes access to the job site and ' +
      'accurate measurements; changes in scope may require a revised quote. A signed approval or deposit ' +
      'may be required to schedule work.'
    );
  }

  /** Same section logic as quotePdf.js */
  function lineSection(it) {
    if (String(it.item_type || '').toLowerCase() === 'product') return 'products';
    const st = String(it.service_type || '').trim();
    if (!st) return 'installation';
    const lower = st.toLowerCase();
    if (lower === 'supply') return 'supply';
    if (lower.includes('sand') || lower.includes('finishing')) return 'sand_finish';
    return 'installation';
  }

  function groupItems(items) {
    const buckets = { installation: [], sand_finish: [], supply: [], products: [] };
    for (const it of items || []) {
      const k = lineSection(it);
      if (buckets[k]) buckets[k].push(it);
      else buckets.installation.push(it);
    }
    return SECTION_DEFS.filter((d) => buckets[d.key].length > 0).map((d) => ({
      label: d.label,
      items: buckets[d.key],
    }));
  }

  function isClientSigned(q) {
    return !!(q.client_signed_name || q.has_client_signature || q.client_signature_url);
  }

  function renderLineRow(it) {
    const nameStr = String(it.name || '').trim();
    const descStr = String(it.description || '').trim();
    const headline =
      nameStr || (descStr ? descStr.split(/\n/)[0] : '') || String(it.floor_type || '') || 'Line item';
    let bodyStr = '';
    if (nameStr && descStr && descStr !== nameStr) {
      bodyStr = descStr;
    } else if (!nameStr && descStr && descStr.includes('\n')) {
      bodyStr = descStr.split(/\n/).slice(1).join('\n').trim();
    }
    const qty = Number(it.quantity) || 0;
    const rate = Number(it.rate ?? it.unit_price) || 0;
    const amt = Number(it.amount ?? it.total_price) || qty * rate;
    const ut = it.unit_type ? String(it.unit_type).replace(/_/g, ' ') : 'sq ft';
    const catalogNotes = String(it.catalog_customer_notes || '').trim();
    const lineComment = String(it.notes || '').trim();
    const detailParts = [];
    if (catalogNotes) detailParts.push(catalogNotes);
    if (lineComment) detailParts.push(`Comment: ${lineComment}`);
    const detailHtml = detailParts.length
      ? `<span class="qp-line__detail">${escapeHtml(detailParts.join(' — '))}</span>`
      : '';
    const bodyHtml = bodyStr ? `<span class="qp-line__body">${escapeHtml(bodyStr)}</span>` : '';

    return `<tr>
      <td>
        <span class="qp-line__title">${escapeHtml(headline)}</span>
        ${bodyHtml}
        ${detailHtml}
      </td>
      <td class="qp-num">${escapeHtml(`${qty} ${ut}`)}</td>
      <td class="qp-num">${escapeHtml(money(rate))}</td>
      <td class="qp-num qp-line__amt">${escapeHtml(money(amt))}</td>
    </tr>`;
  }

  function renderTableHeader() {
    return `<thead><tr>
      <th>Description</th>
      <th class="qp-num">Qty</th>
      <th class="qp-num">Rate</th>
      <th class="qp-num">Amount</th>
    </tr></thead>`;
  }

  function renderSections(items) {
    const sections = groupItems(items);
    if (!sections.length) {
      return '<p class="qp-empty">No line items.</p>';
    }
    return sections
      .map(
        (sec) => `
      <div class="qp-section">
        <h2 class="qp-section-title">${escapeHtml(sec.label)}</h2>
        <table class="qp-table">
          <colgroup>
            <col class="col-desc" />
            <col class="col-qty" />
            <col class="col-rate" />
            <col class="col-amt" />
          </colgroup>
          ${renderTableHeader()}
          <tbody>${sec.items.map(renderLineRow).join('')}</tbody>
        </table>
      </div>`
      )
      .join('');
  }

  function createSignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasStroke = false;
    ctx.strokeStyle = '#1a2036';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pointerPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const pt = e.touches ? e.touches[0] : e;
      return {
        x: (pt.clientX - rect.left) * scaleX,
        y: (pt.clientY - rect.top) * scaleY,
      };
    };

    const start = (e) => {
      drawing = true;
      hasStroke = true;
      const p = pointerPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      e.preventDefault();
    };

    const move = (e) => {
      if (!drawing) return;
      const p = pointerPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      e.preventDefault();
    };

    const end = () => {
      drawing = false;
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    return {
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasStroke = false;
      },
      isEmpty() {
        return !hasStroke;
      },
      renderFromName(name) {
        const ok = window.QuoteSignatureAuto?.renderAutoSignatureOnCanvas(canvas, name);
        hasStroke = !!ok;
        return ok;
      },
      toDataURL() {
        return canvas.toDataURL('image/png');
      },
    };
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  let signaturePad = null;

  function hasOwnerSignature(ownerSig) {
    const o = ownerSig || {};
    return !!(o.has_image || o.image_url || o.name || o.title);
  }

  function renderOwnerSignatureCol(ownerSig) {
    if (!hasOwnerSignature(ownerSig)) return '';
    const owner = ownerSig || {};
    const ownerImg = owner.image_url
      ? `<img src="${owner.image_url}" alt="Authorized signature" />`
      : '<span class="qp-muted-text">Senior Floors</span>';
    const ownerName = owner.name
      ? `<p class="qp-signatures__name">${escapeHtml(owner.name)}</p>`
      : '';
    const ownerTitleHtml = owner.title
      ? `<p class="qp-signatures__title">${escapeHtml(owner.title)}</p>`
      : '';

    return `
        <div class="qp-signatures__col">
          <h3>Authorized by</h3>
          <div class="qp-signatures__box">${ownerImg}</div>
          ${ownerName}
          ${ownerTitleHtml}
        </div>`;
  }

  function renderClientSignatureCol(q) {
    if (!isClientSigned(q)) return '';
    const clientName = escapeHtml(q.client_signed_name || q.customer_name || 'Client');
    const when = q.approved_at ? escapeHtml(String(q.approved_at).slice(0, 10)) : '—';
    const clientImg = q.client_signature_url
      ? `<img src="${access.apiBase}/client-signature" alt="Client signature" />`
      : '<span class="qp-muted-text">Signed</span>';

    return `
        <div class="qp-signatures__col">
          <h3>Client approval</h3>
          <div class="qp-signatures__box">${clientImg}</div>
          <p class="qp-signatures__name">${clientName}</p>
          <p class="qp-signatures__date">Date: ${when}</p>
        </div>`;
  }

  function renderSignaturesBlock(q, ownerSig) {
    const ownerCol = renderOwnerSignatureCol(ownerSig);
    const clientCol = renderClientSignatureCol(q);
    if (!ownerCol && !clientCol) return '';
    const single = ownerCol && !clientCol;
    return `<section class="qp-signatures${single ? ' qp-signatures--single' : ''}">${ownerCol}${clientCol}</section>`;
  }

  function renderDocument(q, items, ownerSig) {
    const isBuilder = String(q.quote_party || '') === 'builder' || q.builder_id;
    const builderPerson = [q.builder_first_name, q.builder_last_name].filter(Boolean).join(' ').trim();
    const clientName = escapeHtml(
      isBuilder
        ? q.builder_company || builderPerson || q.customer_name || 'Builder'
        : q.customer_name || 'Client'
    );
    const email = escapeHtml(q.customer_email || q.builder_email || '');
    const phone = escapeHtml(q.customer_phone || q.builder_phone || '');
    const jobName = isBuilder && q.job_name ? escapeHtml(String(q.job_name)) : '';
    const jobAddr = isBuilder && q.job_address ? escapeHtml(String(q.job_address)) : '';
    const issue = q.issue_date ? String(q.issue_date).slice(0, 10) : '';
    const exp = q.expiration_date ? String(q.expiration_date).slice(0, 10) : '';
    const sub = Number(q.subtotal) || 0;
    const tax = Number(q.tax_total) || 0;
    const total = Number(q.total_amount) || 0;
    const discType = q.discount_type === 'fixed' ? '$' : '%';
    const discVal = Number(q.discount_value) || 0;
    const discDisplay = discType === '$' ? money(discVal) : `${discVal}%`;
    const terms = escapeHtml((q.terms_conditions && String(q.terms_conditions).trim()) || defaultTerms());
    const notes = q.notes ? escapeHtml(String(q.notes)) : '';

    const panelMeta = [
      issue ? `<p>Issue: ${escapeHtml(issue)}</p>` : '',
      exp ? `<p>Expires: ${escapeHtml(exp)}</p>` : '',
      `<p>Status: ${escapeHtml(q.status || 'draft')}</p>`,
    ].join('');

    return `
      <header class="qp-header">
        <div class="qp-header__brand">
          <img class="qp-logo" src="/assets/SeniorFloors.png" alt="" width="68" height="68" onerror="this.style.display='none'" />
          <div class="qp-company">
            <h1 class="qp-company__name">${escapeHtml(COMPANY.name)}</h1>
            <p class="qp-company__tagline">${escapeHtml(COMPANY.tagline)}</p>
            <p class="qp-company__contact">${escapeHtml(COMPANY.phone)} · ${escapeHtml(COMPANY.email)}</p>
          </div>
        </div>
        <aside class="qp-quote-panel">
          <p class="qp-quote-panel__label">QUOTE</p>
          <p class="qp-quote-panel__number">${escapeHtml(q.quote_number || `Quote #${q.id}`)}</p>
          ${panelMeta}
        </aside>
      </header>

      <section class="qp-billto">
        <p class="qp-billto__label">Bill to</p>
        <p class="qp-billto__name">${clientName}</p>
        ${email ? `<p class="qp-billto__meta">${email}</p>` : ''}
        ${phone ? `<p class="qp-billto__meta">${phone}</p>` : ''}
      </section>
      ${
        jobName || jobAddr
          ? `<section class="qp-billto">
        <p class="qp-billto__label">Project</p>
        ${jobName ? `<p class="qp-billto__name">${jobName}</p>` : ''}
        ${jobAddr ? `<p class="qp-billto__meta">${jobAddr}</p>` : ''}
      </section>`
          : ''
      }

      ${renderSections(items)}

      <div class="qp-totals-wrap">
        <table class="qp-totals">
          <tbody>
            <tr><td>Subtotal</td><td>${money(sub)}</td></tr>
            <tr><td>Tax</td><td>${money(tax)}</td></tr>
            <tr><td>Discount (${escapeHtml(discType)})</td><td>${escapeHtml(discDisplay)}</td></tr>
          </tbody>
        </table>
        <p class="qp-totals-label">Quote total</p>
        <div class="qp-grand-total">
          <span class="qp-grand-total__label">TOTAL</span>
          <span class="qp-grand-total__value">${money(total)}</span>
        </div>
      </div>

      <section class="qp-terms">
        <h3 class="qp-block-title">Terms &amp; conditions</h3>
        <p class="qp-block-text">${terms}</p>
      </section>

      ${
        notes
          ? `<section class="qp-notes">
        <h3 class="qp-block-title">Notes</h3>
        <p class="qp-block-text">${notes}</p>
      </section>`
          : ''
      }

      ${renderSignaturesBlock(q, ownerSig)}
    `;
  }

  function openSignModal() {
    const modal = document.getElementById('qpSignModal');
    const canvas = document.getElementById('qpSignCanvas');
    if (!modal || !canvas) return;
    if (!signaturePad) signaturePad = createSignaturePad(canvas);
    signaturePad.clear();
    const nameInput = document.getElementById('qpSignerName');
    const defaultName = access?.lastQuote?.customer_name ? String(access.lastQuote.customer_name).trim() : '';
    if (nameInput) {
      nameInput.value = defaultName;
      if (defaultName.length >= 2) signaturePad.renderFromName(defaultName);
    }
    modal.classList.remove('hidden');
    nameInput?.focus();
  }

  function closeSignModal() {
    document.getElementById('qpSignModal')?.classList.add('hidden');
  }

  function wireSignModal() {
    document.getElementById('qpSignBackdrop')?.addEventListener('click', closeSignModal);
    document.getElementById('qpSignCancel')?.addEventListener('click', closeSignModal);
    document.getElementById('qpSignClear')?.addEventListener('click', () => signaturePad?.clear());
    const nameInput = document.getElementById('qpSignerName');
    if (nameInput) {
      nameInput.addEventListener(
        'input',
        debounce(() => {
          const n = nameInput.value.trim();
          if (!signaturePad) return;
          if (n.length >= 2) signaturePad.renderFromName(n);
          else signaturePad.clear();
        }, 250)
      );
    }
    document.getElementById('qpSignSubmit')?.addEventListener('click', async () => {
      const btn = document.getElementById('qpSignSubmit');
      const name = document.getElementById('qpSignerName')?.value?.trim() || '';
      if (!name || name.length < 2) {
        const msg = 'Please enter your full name.';
        if (typeof crmNotify === 'function') crmNotify(msg, 'error');
        else alert(msg);
        return;
      }
      if (!signaturePad) signaturePad = createSignaturePad(document.getElementById('qpSignCanvas'));
      if (signaturePad.isEmpty()) signaturePad.renderFromName(name);
      if (!signaturePad || signaturePad.isEmpty()) {
        const msg = 'Please draw your signature.';
        if (typeof crmNotify === 'function') crmNotify(msg, 'error');
        else alert(msg);
        return;
      }
      if (btn) btn.disabled = true;
      try {
        const rr = await fetch(`${access.apiBase}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signer_name: name,
            signature_png: signaturePad.toDataURL(),
          }),
        });
        const jj = await rr.json();
        if (rr.ok && jj.success) {
          closeSignModal();
          await load();
        } else {
          const msg = jj.error || 'Could not approve.';
          if (typeof crmNotify === 'function') crmNotify(msg, 'error');
          else alert(msg);
        }
      } catch {
        if (typeof crmNotify === 'function') crmNotify('Could not approve.', 'error');
        else alert('Could not approve.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderActions(clientSigned) {
    if (!access) return;
    if (clientSigned) {
      actionsEl.innerHTML = '';
      actionsEl.hidden = true;
      const who = access?.lastQuote?.client_signed_name;
      approvedEl.textContent = who
        ? `Thank you — this quote is approved and signed by ${who}.`
        : 'Thank you — this quote is approved.';
      approvedEl.hidden = false;
      return;
    }
    approvedEl.hidden = true;
    actionsEl.hidden = false;
    actionsEl.innerHTML = `
      <a
        class="qp-btn qp-btn--outline"
        href="${access.apiBase}/pdf"
        target="_blank"
        rel="noopener noreferrer"
      >Download PDF</a>
      <button type="button" class="qp-btn qp-btn--primary" id="btnApprove">Approve &amp; sign</button>
    `;
    document.getElementById('btnApprove')?.addEventListener('click', openSignModal);
  }

  function showError(msg) {
    loadingEl.hidden = true;
    docEl.hidden = true;
    actionsEl.hidden = true;
    approvedEl.hidden = true;
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    errorEl.hidden = false;
  }

  async function load() {
    if (!access) {
      showError('Invalid or missing link.');
      return;
    }
    try {
      const r = await fetch(access.apiBase);
      const j = await r.json();
      if (!r.ok || !j.success) {
        showError('Quote not found or link expired.');
        return;
      }
      const q = j.data.quote;
      const items = j.data.items || [];
      const ownerSig = j.data.owner_signature || null;
      if (access) access.lastQuote = q;
      const clientSigned = isClientSigned(q);

      loadingEl.hidden = true;
      errorEl.hidden = true;
      errorEl.classList.add('hidden');

      innerEl.innerHTML = renderDocument(q, items, ownerSig);
      docEl.hidden = false;
      renderActions(clientSigned);
      document.title = `Quote ${q.quote_number || q.id} — Senior Floors`;
    } catch {
      showError('Could not load quote.');
    }
  }

  wireSignModal();
  load();
})();
