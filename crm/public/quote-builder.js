/* global fetch */
(function () {
  const $ = (id) => document.getElementById(id);
  let quoteId = null;
  /** Número legível do orçamento (ex. SF-2026-001). */
  let loadedQuoteNumber = null;
  /** Base URL pública do CRM (ex. https://app.senior-floors.com). */
  let clientPublicCrmUrl = null;
  /** Lead vindo de `?lead_id=` (novo orçamento a partir do lead). */
  let pendingLeadId = null;
  /** `lead_id` do quote já gravado (edição). */
  let loadedQuoteLeadId = null;
  /** Lista de clientes CRM (`/api/customers` — builders e clientes finais convertidos). */
  let clients = [];
  /** Builders do portal (`/api/quotes/lookup/builders`). */
  let quoteBuilders = [];
  /** @type {'lead'|'builder'} */
  let quotePartyMode = 'lead';
  /** Builder selecionado no quote. */
  let selectedQuoteBuilder = null;
  /** E-mails CC adicionais no envio para builders. */
  let builderExtraEmails = [];
  /** Lead escolhido na pesquisa de cliente. */
  let selectedQuoteLead = null;
  let clientSearchTimer = null;
  /** Índice da linha em edição no painel inline; `-1` = nova linha; `null` = fechado. */
  let inlineEditIdx = null;
  let catalog = [];
  let templates = [];
  /** @type {Array<Record<string, unknown>>} */
  let items = [];
  /** Sortable instances for drag-reorder (destroyed on each render). */
  let itemSortables = [];

  const QB_CATEGORIES = [
    { value: 'Supply', label: 'Supply' },
    { value: 'Installation', label: 'Installation' },
    { value: 'Sand & Finishing', label: 'Sand & Finish' },
  ];

  function normalizeServiceType(st) {
    const s = String(st || '').trim();
    if (s === 'Supply' || s.toLowerCase() === 'supply') return 'Supply';
    if (s.includes('Sand') || s.toLowerCase().includes('sand')) return 'Sand & Finishing';
    return 'Installation';
  }

  function categoryLabel(st) {
    const n = normalizeServiceType(st);
    const hit = QB_CATEGORIES.find((c) => c.value === n);
    return hit ? hit.label : n;
  }

  const money = (n) =>
    '$' +
    (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function parseMoneyInput(val) {
    const s = String(val ?? '')
      .replace(/[$,\s]/g, '')
      .trim();
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoneyInput(n) {
    const v = Math.max(0, Number(n) || 0);
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  let qbProgrammaticMoneyUpdate = false;
  let qbSuppressServiceNameInput = false;

  function setMoneyFieldValue(input, amount) {
    if (!input) return;
    qbProgrammaticMoneyUpdate = true;
    input.value = formatMoneyInput(amount);
    qbProgrammaticMoneyUpdate = false;
  }

  function pickCatalogRate(explicit, fallback) {
    const e = explicit != null && explicit !== '' ? Number(explicit) : NaN;
    if (Number.isFinite(e) && e > 0) return e;
    const f = Number(fallback) || 0;
    return Number.isFinite(f) && f > 0 ? f : 0;
  }

  function parseQtyInput(val) {
    const s = String(val ?? '')
      .replace(/,/g, '.')
      .trim();
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function selectAllOnFocus(el) {
    if (!el || el.dataset.selectAllBound) return;
    el.dataset.selectAllBound = '1';
    el.addEventListener('focus', () => {
      setTimeout(() => {
        try {
          el.select();
        } catch (_) {
          /* ignore */
        }
      }, 0);
    });
  }

  function wireMoneyField(input) {
    if (!input || input.dataset.moneyBound) return;
    input.dataset.moneyBound = '1';
    selectAllOnFocus(input);
    input.addEventListener('blur', () => {
      input.value = formatMoneyInput(parseMoneyInput(input.value));
      updateInlineItemTotal();
    });
    input.addEventListener('input', () => updateInlineItemTotal());
  }

  function getActiveLeadId() {
    if (selectedQuoteLead && selectedQuoteLead.id != null) {
      const n = Number(selectedQuoteLead.id);
      if (Number.isFinite(n)) return n;
    }
    if (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId)) return loadedQuoteLeadId;
    if (pendingLeadId != null && Number.isFinite(pendingLeadId)) return pendingLeadId;
    return null;
  }

  function hideClientForms() {
    ['qbClientManualForm', 'qbClientEditForm'].forEach((id) => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
    const me = $('manualClientError');
    const ee = $('editClientError');
    if (me) me.classList.add('hidden');
    if (ee) ee.classList.add('hidden');
  }

  function updateClientActionButtons() {
    const editBtn = $('btnEditClient');
    const crmLink = $('btnOpenLeadInCrm');
    const lid = getActiveLeadId();
    if (editBtn) editBtn.classList.toggle('hidden', !lid);
    if (crmLink) {
      if (lid) {
        crmLink.href = `lead-detail.html?id=${lid}`;
        crmLink.classList.remove('hidden');
      } else {
        crmLink.classList.add('hidden');
      }
    }
  }

  function fillClientEditFormFromLead(lead) {
    if (!lead) return;
    if ($('editClientName')) $('editClientName').value = lead.name != null ? String(lead.name) : '';
    if ($('editClientPhone')) $('editClientPhone').value = lead.phone != null ? String(lead.phone) : '';
    if ($('editClientEmail')) $('editClientEmail').value = lead.email != null ? String(lead.email) : '';
    if ($('editClientZip')) $('editClientZip').value = lead.zipcode != null ? String(lead.zipcode) : '';
    if ($('editClientAddress')) {
      $('editClientAddress').value = leadAddress(lead);
    }
  }

  async function openClientEditForm() {
    const lid = getActiveLeadId();
    if (!lid) {
      qbToast('Selecione ou crie um cliente primeiro.', 'info');
      return;
    }
    hideClientForms();
    let lead = selectedQuoteLead;
    if (!lead || Number(lead.id) !== lid) {
      try {
        const lr = await fetch(`/api/leads/${lid}`, { credentials: 'include' }).then((r) => r.json());
        if (lr.success && lr.data) lead = lr.data;
      } catch (_) {
        qbToast('Erro ao carregar lead.', 'error');
        return;
      }
    }
    selectedQuoteLead = lead;
    fillClientEditFormFromLead(lead);
    const form = $('qbClientEditForm');
    if (form) {
      form.classList.remove('hidden');
      bootQuoteAddressAutocomplete();
      $('editClientName')?.focus();
    }
  }

  async function saveClientEdits() {
    const errEl = $('editClientError');
    if (errEl) errEl.classList.add('hidden');
    const lid = getActiveLeadId();
    if (!lid) {
      qbToast('Nenhum lead associado.', 'error');
      return;
    }
    const name = String($('editClientName')?.value || '').trim();
    const email = String($('editClientEmail')?.value || '').trim();
    const phone = String($('editClientPhone')?.value || '').trim();
    const zipcode = String($('editClientZip')?.value || '').trim();
    const address = String($('editClientAddress')?.value || '').trim();
    if (name.length < 2) {
      if (errEl) {
        errEl.textContent = 'Nome obrigatório (mín. 2 caracteres).';
        errEl.classList.remove('hidden');
      }
      return;
    }
    try {
      const r = await fetch(`/api/leads/${lid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, phone, zipcode, address: address || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || 'Erro ao atualizar lead.');
      selectedQuoteLead = j.data;
      loadedQuoteLeadId = lid;
      const search = $('customerSearch');
      if (search) search.value = formatLeadClientLabel(j.data);
      const cid = parseInt(String($('customerId')?.value), 10);
      if (Number.isFinite(cid) && cid > 0) {
        await fetch(`/api/customers/${cid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name,
            email,
            phone,
            address: address || null,
            zipcode: zipcode || null,
          }),
        }).catch(() => {});
        try {
          const cr = await api(`/api/customers/${cid}`);
          if (cr.data) upsertClientInCache(cr.data);
        } catch (_) {
          upsertClientInCache({ id: cid, name, email, phone, address, zipcode });
        }
      } else {
        try {
          await resolveCustomerForLead(lid);
        } catch (_) {
          /* lead updated; customer optional */
        }
      }
      hideClientForms();
      renderClientDetails();
      updateClientActionButtons();
      qbToast('Cliente atualizado no CRM.', 'success');
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message || 'Erro ao guardar.';
        errEl.classList.remove('hidden');
      } else qbToast(e.message || 'Erro ao guardar.', 'error');
    }
  }

  async function createManualClient() {
    const errEl = $('manualClientError');
    if (errEl) errEl.classList.add('hidden');
    const name = String($('manualClientName')?.value || '').trim();
    const email = String($('manualClientEmail')?.value || '').trim();
    const phone = String($('manualClientPhone')?.value || '').trim();
    const zipcode = String($('manualClientZip')?.value || '').trim();
    const address = String($('manualClientAddress')?.value || '').trim();
    if (name.length < 2 || !email || phone.length < 10 || zipcode.replace(/\D/g, '').length < 5) {
      if (errEl) {
        errEl.textContent = 'Preencha nome, email, telefone e ZIP (5 dígitos).';
        errEl.classList.remove('hidden');
      }
      return;
    }
    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          email,
          phone,
          zipcode,
          address: address || null,
          source: 'Quote Builder',
          form_type: 'manual',
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || 'Erro ao criar lead.');
      hideClientForms();
      ['manualClientName', 'manualClientPhone', 'manualClientEmail', 'manualClientZip', 'manualClientAddress'].forEach(
        (id) => {
          const el = $(id);
          if (el) el.value = '';
        }
      );
      await selectLeadAsClient(j.data);
      qbToast('Cliente criado e selecionado.', 'success');
    } catch (e) {
      if (errEl) {
        errEl.textContent = e.message || 'Erro ao criar.';
        errEl.classList.remove('hidden');
      } else qbToast(e.message || 'Erro ao criar.', 'error');
    }
  }

  function isValidEmailAddress(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s || s.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function renderBuilderExtraEmailChips() {
    const box = $('qbBuilderEmailChips');
    if (!box) return;
    if (!builderExtraEmails.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = builderExtraEmails
      .map((email, idx) => {
        const safe = escapeHtmlText(email);
        return `<span class="qb-extra-emails__chip" data-email-idx="${idx}">
          <span title="${safe}">${safe}</span>
          <button type="button" class="qb-extra-emails__chip-remove" data-remove-email="${idx}" aria-label="Remover ${safe}">×</button>
        </span>`;
      })
      .join('');
  }

  function addBuilderExtraEmail(raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email) return false;
    if (!isValidEmailAddress(email)) {
      qbToast('E-mail inválido.', 'error');
      return false;
    }
    const primary = getClientEmailForQuote().toLowerCase();
    if (primary && email === primary) {
      qbToast('Este já é o e-mail principal do builder.', 'info');
      return false;
    }
    if (builderExtraEmails.includes(email)) {
      qbToast('E-mail já adicionado.', 'info');
      return false;
    }
    builderExtraEmails.push(email);
    renderBuilderExtraEmailChips();
    return true;
  }

  function removeBuilderExtraEmail(idx) {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0 || i >= builderExtraEmails.length) return;
    builderExtraEmails.splice(i, 1);
    renderBuilderExtraEmailChips();
  }

  function tryCommitBuilderExtraEmailInput() {
    const input = $('qbBuilderExtraEmailInput');
    if (!input) return;
    const raw = String(input.value || '').trim();
    if (!raw) return;
    const parts = raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    let added = 0;
    for (const part of parts) {
      if (addBuilderExtraEmail(part)) added += 1;
    }
    if (added) input.value = '';
  }

  function handleServiceFormEnter(e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    const nameEl = $('modalServiceName');
    if (document.activeElement === nameEl && selectActiveModalServiceResult()) {
      return;
    }
    const results = $('modalServiceResults');
    if (results && !results.classList.contains('hidden') && document.activeElement === nameEl) {
      const first = results.querySelector('[data-catalog-id]');
      if (first) {
        first.click();
        return;
      }
    }
    confirmAddServiceLine();
  }

  function qbToast(msg, type) {
    if (window.crmToast && typeof window.crmToast.show === 'function') {
      window.crmToast.show(msg, { type: type === 'error' ? 'error' : type === 'info' ? 'info' : 'success' });
    } else {
      alert(msg);
    }
  }

  let qbNotifyTimer = null;

  function hideQuoteNotify() {
    const root = $('qbNotify');
    if (!root) return;
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    if (qbNotifyTimer) {
      clearTimeout(qbNotifyTimer);
      qbNotifyTimer = null;
    }
  }

  /**
   * Pop-up de notificação (envio de e-mail ao cliente, etc.).
   * @param {{ type?: 'success'|'error', title: string, message: string, ms?: number }} opts
   */
  function showQuoteNotify(opts) {
    const root = $('qbNotify');
    const titleEl = $('qbNotifyTitle');
    const msgEl = $('qbNotifyMsg');
    const iconEl = $('qbNotifyIcon');
    if (!root || !titleEl || !msgEl) return;
    const type = opts.type === 'error' ? 'error' : 'success';
    const ms = typeof opts.ms === 'number' ? opts.ms : type === 'error' ? 9000 : 5500;
    root.classList.remove('qb-notify--success', 'qb-notify--error', 'hidden');
    root.classList.add(type === 'error' ? 'qb-notify--error' : 'qb-notify--success');
    titleEl.textContent = opts.title || '';
    msgEl.textContent = opts.message || '';
    if (iconEl) iconEl.textContent = type === 'error' ? '⚠️' : '✉️';
    root.setAttribute('aria-hidden', 'false');
    if (qbNotifyTimer) clearTimeout(qbNotifyTimer);
    qbNotifyTimer = setTimeout(() => hideQuoteNotify(), ms);
  }

  function wireQuoteNotify() {
    const root = $('qbNotify');
    const panel = root && root.querySelector('.qb-notify__panel');
    const closeBtn = $('qbNotifyClose');
    if (!root || !panel) return;
    panel.addEventListener('click', (e) => e.stopPropagation());
    root.addEventListener('click', () => hideQuoteNotify());
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideQuoteNotify();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.classList.contains('hidden')) hideQuoteNotify();
    });
  }

  function lineAmount(q, r) {
    return Math.round(q * r * 100) / 100;
  }

  function normalizeCatalogId(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Template DB guarda nome+descrição no campo `description` (primeira linha = nome). */
  function unpackTemplateLine(x) {
    let name = x.name != null ? String(x.name).trim() : '';
    let description = x.description != null ? String(x.description).trim() : '';
    if (!name && description) {
      const ix = description.indexOf('\n');
      if (ix >= 0) {
        name = description.slice(0, ix).trim();
        description = description.slice(ix + 1).trim();
      } else {
        name = description;
        description = '';
      }
    }
    return { name, description };
  }

  function emptyLine() {
    return {
      item_type: 'service',
      name: '',
      description: '',
      unit_type: 'sq_ft',
      quantity: 1,
      rate: 0,
      service_type: 'Installation',
      notes: null,
      catalog_customer_notes: null,
      service_catalog_id: null,
      product_id: null,
      cost_price: null,
      markup_percentage: null,
      sell_price: null,
      estimateAuto: false,
    };
  }

  function isBlankLine(it) {
    if (!it || it.estimateAuto || it.item_type === 'product') return false;
    const n = String(it.name || '').trim();
    const d = String(it.description || '').trim();
    const r = Number(it.rate) || 0;
    return !n && !d && r === 0;
  }

  function qbAdjustedSqftValue() {
    const totalSqft = parseFloat(($('qbTotalSqft') && $('qbTotalSqft').value) || '0') || 0;
    const wastePercent = parseFloat(($('qbWastePct') && $('qbWastePct').value) || '0') || 0;
    return totalSqft * (1 + wastePercent / 100);
  }

  function updateQbAdjustedSqft() {
    const el = $('qbAdjustedSqft');
    if (el) el.value = qbAdjustedSqftValue().toFixed(2);
  }

  function qbResetWaste() {
    const flooringType = ($('qbFlooringType') && $('qbFlooringType').value) || '';
    const defaults = { hardwood: 10, engineered: 8, lvp: 5, laminate: 7, tile: 12 };
    const w = defaults[flooringType] || 7;
    const wp = $('qbWastePct');
    if (wp) wp.value = String(w);
    updateQbAdjustedSqft();
    applyEstimateSmartRules();
  }

  /** Regras alinhadas a `estimate-builder.js` → `applySmartRules`. */
  function applyEstimateSmartRules() {
    updateQbAdjustedSqft();
    const flooringType = ($('qbFlooringType') && $('qbFlooringType').value) || '';
    const subfloorType = ($('qbSubfloorType') && $('qbSubfloorType').value) || '';
    const levelCondition = ($('qbLevelCondition') && $('qbLevelCondition').value) || '';
    const stairsCount = parseInt(($('qbStairsCount') && $('qbStairsCount').value) || '0', 10) || 0;
    const totalSqft = parseFloat(($('qbTotalSqft') && $('qbTotalSqft').value) || '0') || 0;
    const adjustedSqft = qbAdjustedSqftValue();

    items = items.filter((it) => !it.estimateAuto);
    if (items.length === 1 && isBlankLine(items[0])) items = [];

    if (flooringType === 'hardwood' && subfloorType === 'concrete') {
      items.push({
        ...emptyLine(),
        name: 'Moisture Barrier',
        description: 'Barreira de umidade para piso de madeira em concreto',
        unit_type: 'sq_ft',
        quantity: adjustedSqft,
        rate: 0.5,
        estimateAuto: true,
      });
    }
    if (levelCondition === 'major' && totalSqft > 0) {
      items.push({
        ...emptyLine(),
        name: 'Leveling Compound',
        description: 'Massa niveladora para piso irregular',
        unit_type: 'sq_ft',
        quantity: totalSqft,
        rate: 1.25,
        estimateAuto: true,
      });
    }
    if (stairsCount > 0) {
      items.push({
        ...emptyLine(),
        name: 'Stair Installation',
        description: `Instalação de ${stairsCount} degrau(s)`,
        unit_type: 'fixed',
        quantity: stairsCount,
        rate: 150.0,
        estimateAuto: true,
      });
    }

    recalc();
    renderItems();
  }

  function wireProjectEstimateRules() {
    const onRuleField = () => {
      updateQbAdjustedSqft();
      applyEstimateSmartRules();
    };
    ['qbFlooringType', 'qbSubfloorType', 'qbLevelCondition'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('change', onRuleField);
    });
    ['qbStairsCount', 'qbTotalSqft', 'qbWastePct'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', onRuleField);
      el.addEventListener('change', onRuleField);
    });
    const btnW = $('btnQbWasteAuto');
    if (btnW) btnW.addEventListener('click', () => qbResetWaste());
    const btnA = $('btnQbApplyRules');
    if (btnA) btnA.addEventListener('click', () => applyEstimateSmartRules());
    updateQbAdjustedSqft();
  }

  function sellFromCostMarkup(cost, mPct) {
    const c = Number(cost) || 0;
    const m = Math.max(0, Number(mPct) || 0);
    return Math.round(c * (1 + m / 100) * 10000) / 10000;
  }

  function markupFromCostAndSell(cost, sell) {
    const c = Number(cost) || 0;
    const s = Number(sell) || 0;
    if (c <= 0) return 0;
    return Math.round(((s - c) / c) * 10000) / 100;
  }

  function parseInlineBaseRate() {
    return parseMoneyInput($('modalServiceRate') && $('modalServiceRate').value);
  }

  function parseInlineMarginPct() {
    const el = $('modalServiceMarkup');
    if (!el || String(el.value || '').trim() === '') return null;
    return parseQtyInput(el.value);
  }

  function computeSellUnitRate(base, marginPct) {
    const b = Number(base) || 0;
    if (b <= 0) return 0;
    if (marginPct == null || !Number.isFinite(marginPct)) return b;
    return sellFromCostMarkup(b, marginPct);
  }

  function recalcInlinePricing() {
    if (qbProgrammaticMoneyUpdate) return;
    updateInlineItemTotal();
  }

  function wireMarginPricingFields() {
    const baseEl = $('modalServiceRate');
    const markupEl = $('modalServiceMarkup');
    if (baseEl && !baseEl.dataset.basePricingBound) {
      baseEl.dataset.basePricingBound = '1';
      wireMoneyField(baseEl);
      baseEl.addEventListener('input', recalcInlinePricing);
      baseEl.addEventListener('blur', recalcInlinePricing);
    }
    if (markupEl && !markupEl.dataset.marginPricingBound) {
      markupEl.dataset.marginPricingBound = '1';
      selectAllOnFocus(markupEl);
      markupEl.addEventListener('input', recalcInlinePricing);
      markupEl.addEventListener('blur', () => {
        const m = parseQtyInput(markupEl.value);
        if (markupEl.value.trim() !== '') markupEl.value = String(m);
        recalcInlinePricing();
      });
    }
  }

  function bootQuoteAddressAutocomplete() {
    if (typeof window.sfInitCrmAddressAutocomplete === 'function') {
      window.sfInitCrmAddressAutocomplete();
    } else if (typeof window.sfBootCrmAddressAutocomplete === 'function') {
      window.sfBootCrmAddressAutocomplete();
    }
  }

  function localProfitSummary() {
    let totalCost = 0;
    let totalRevenue = 0;
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      const sell = Number(it.rate) || 0;
      const cost = Number(it.cost_price);
      totalRevenue += Math.round(q * sell * 100) / 100;
      if (it.item_type === 'product' && Number.isFinite(cost) && cost >= 0) {
        totalCost += Math.round(q * cost * 100) / 100;
      }
    }
    const gp = Math.round((totalRevenue - totalCost) * 100) / 100;
    const mp = totalRevenue > 0 ? Math.round((gp / totalRevenue) * 10000) / 100 : null;
    return { totalCost, totalRevenue, grossProfit: gp, marginPct: mp };
  }

  function updateProfitPanel() {
    const p = localProfitSummary();
    const elC = $('dispCost');
    if (!elC) return;
    elC.textContent = money(p.totalCost);
    $('dispRevenue').textContent = money(p.totalRevenue);
    $('dispProfit').textContent = money(p.grossProfit);
    $('dispMarginPct').textContent = p.marginPct != null ? `${p.marginPct}%` : '—';
    const bar = $('marginBarFill');
    if (bar) {
      const w = p.marginPct != null ? Math.min(100, Math.max(0, Number(p.marginPct))) : 0;
      bar.style.width = `${w}%`;
    }
  }

  function catalogPricingSource() {
    const r = document.querySelector('input[name="pricingCatalog"]:checked');
    return r && r.value === 'builder' ? 'builder' : 'customer';
  }

  function updatePricingActiveLabel() {
    const el = $('qbPricingActiveLabel');
    if (!el) return;
    el.textContent =
      catalogPricingSource() === 'builder'
        ? 'Taxa builder (tabela de parceiro)'
        : 'Taxa cliente final (leads)';
  }

  function setCatalogPricingMode(mode) {
    const m = mode === 'builder' ? 'builder' : 'customer';
    const el = document.querySelector(`input[name="pricingCatalog"][value="${m}"]`);
    if (el) el.checked = true;
    updatePricingActiveLabel();
  }

  function getQuoteParty() {
    return quotePartyMode === 'builder' ? 'builder' : 'lead';
  }

  function syncQuotePartyUi() {
    const party = getQuoteParty();
    document.querySelectorAll('.qb-party-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-party') === party);
    });
    $('qbLeadPanel')?.classList.toggle('hidden', party !== 'lead');
    $('qbBuilderPanel')?.classList.toggle('hidden', party !== 'builder');
  }

  function setQuoteParty(party, { applyPrices = true } = {}) {
    quotePartyMode = party === 'builder' ? 'builder' : 'lead';
    syncQuotePartyUi();
    if (quotePartyMode === 'builder') renderBuilderDetails();
    if (applyPrices) {
      setCatalogPricingMode(quotePartyMode === 'builder' ? 'builder' : 'customer');
      refreshRatesForCatalogLines();
      renderItems();
    } else {
      updatePricingActiveLabel();
    }
  }

  async function loadQuoteBuilders() {
    const sel = $('quoteBuilderSelect');
    if (!sel) return;
    const current = sel.value;
    try {
      const r = await api('/api/quotes/lookup/builders');
      quoteBuilders = Array.isArray(r.data) ? r.data : [];
    } catch {
      quoteBuilders = [];
    }
    const opts = ['<option value="">Selecionar builder…</option>']
      .concat(
        quoteBuilders.map((b) => {
          const id = Number(b.id);
          const label = escapeHtmlText(b.label || b.company || `Builder #${id}`);
          return `<option value="${id}">${label}</option>`;
        })
      )
      .join('');
    sel.innerHTML = opts;
    if (current && quoteBuilders.some((b) => String(b.id) === String(current))) {
      sel.value = current;
    }
  }

  function renderBuilderDetails() {
    const box = $('qbBuilderDetails');
    if (!box) return;
    const b = selectedQuoteBuilder;
    if (!b) {
      box.classList.add('hidden');
      return;
    }
    const set = (id, val) => setWrappingField(id, val);
    set('qbBuilderCompany', b.company || b.label);
    set('qbBuilderContact', b.name);
    set('qbBuilderEmail', b.email);
    set('qbBuilderPhone', b.phone);
    box.classList.remove('hidden');
  }

  function applySelectedBuilder(builder, { applyPrices = true } = {}) {
    selectedQuoteBuilder = builder || null;
    const sel = $('quoteBuilderSelect');
    if (sel && builder && builder.id != null) sel.value = String(builder.id);
    if (builder && builder.customer_id) {
      $('customerId').value = String(builder.customer_id);
    } else if (getQuoteParty() === 'builder') {
      $('customerId').value = '';
    }
    renderBuilderDetails();
    if (applyPrices) {
      setCatalogPricingMode('builder');
      refreshRatesForCatalogLines();
      renderItems();
    }
  }

  function onQuoteBuilderChange() {
    const id = parseInt($('quoteBuilderSelect')?.value, 10);
    if (!Number.isFinite(id) || id <= 0) {
      applySelectedBuilder(null, { applyPrices: true });
      return;
    }
    const b = quoteBuilders.find((x) => Number(x.id) === id) || { id };
    applySelectedBuilder(b, { applyPrices: true });
  }

  /** Alinha rádios Builder / Cliente final ao tipo do cliente CRM. */
  function applyPricingFromCustomerId(cidStr) {
    const cid = parseInt(String(cidStr || '').trim(), 10);
    if (!Number.isFinite(cid) || cid <= 0) return;
    const c = clients.find((x) => Number(x.id) === cid);
    if (!c) return;
    setCatalogPricingMode(c.customer_type === 'builder' ? 'builder' : 'customer');
  }

  /** Recalcula `rate` nas linhas vindas do catálogo conforme a taxa atual (builder vs cliente). */
  function refreshRatesForCatalogLines() {
    const src = catalogPricingSource();
    for (const it of items) {
      const catId = normalizeCatalogId(it.service_catalog_id);
      if (catId == null) continue;
      const row = catalog.find((r) => Number(r.id) === catId);
      if (!row) continue;
      it.rate = effectiveCatalogRate(row, src);
    }
  }

  function effectiveCatalogRate(row, source) {
    if (!row) return 0;
    const fallback = Number(row.default_rate) || 0;
    if (source === 'builder') {
      return pickCatalogRate(row.rate_builder, fallback);
    }
    return pickCatalogRate(row.rate_customer, fallback);
  }

  function resolveModalCatalogRow() {
    if (modalSelectedCatalogRow) return modalSelectedCatalogRow;
    const name = String(($('modalServiceName') && $('modalServiceName').value) || '')
      .trim()
      .toLowerCase();
    if (!name) return null;
    const matches = catalog.filter((r) => String(r.name || '').trim().toLowerCase() === name);
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveInlineBaseRate() {
    let base = parseInlineBaseRate();
    if (base > 0) return base;
    const row = resolveModalCatalogRow();
    if (row) base = effectiveCatalogRate(row, catalogPricingSource());
    return base > 0 ? base : 0;
  }

  /** Preço unitário de venda (valor catálogo + margem). */
  function resolveInlineSellRate() {
    const base = resolveInlineBaseRate();
    const margin = parseInlineMarginPct();
    return computeSellUnitRate(base, margin);
  }


  function serviceTypeFromCatalogCategory(category) {
    const catStr = String(category || '');
    if (catStr === 'Supply' || catStr.toLowerCase() === 'supply') return 'Supply';
    if (catStr === 'Sand & Finishing' || catStr.includes('Sand')) return 'Sand & Finishing';
    return 'Installation';
  }

  function filterCatalogForServiceSearch(query) {
    const q = String(query || '').trim().toLowerCase();
    const list = !q
      ? catalog.slice(0, 40)
      : catalog.filter((row) => String(row.name || '').toLowerCase().includes(q));
    return list.slice(0, 40);
  }

  function updateItemsCountLabel() {
    const el = $('itemsCountLabel');
    if (!el) return;
    const n = items.length;
    el.textContent = n === 1 ? '1 adicionado' : `${n} adicionados`;
  }

  function formatQuoteNumberLabel(num) {
    if (num == null || num === '') return '';
    const s = String(num).trim();
    if (!s) return '';
    return s.startsWith('#') ? s : `#${s}`;
  }

  function leadAddress(lead) {
    if (!lead) return '';
    return String(lead.full_address || lead.address || '').trim();
  }

  function customerAddress(c) {
    if (!c) return '';
    return String(c.address || '').trim();
  }

  function getClientDisplayInfo() {
    if (selectedQuoteLead) {
      return {
        name: selectedQuoteLead.name != null ? String(selectedQuoteLead.name).trim() : '',
        phone: selectedQuoteLead.phone != null ? String(selectedQuoteLead.phone).trim() : '',
        email: selectedQuoteLead.email != null ? String(selectedQuoteLead.email).trim() : '',
        address: leadAddress(selectedQuoteLead),
      };
    }
    const cid = parseInt(String($('customerId') && $('customerId').value), 10);
    if (Number.isFinite(cid) && cid > 0) {
      const c = clients.find((x) => Number(x.id) === cid);
      if (c) {
        const name =
          c.name != null
            ? String(c.name).trim()
            : c.responsible_name != null
              ? String(c.responsible_name).trim()
              : '';
        return {
          name,
          phone: c.phone != null ? String(c.phone).trim() : '',
          email: c.email != null ? String(c.email).trim() : '',
          address: customerAddress(c),
        };
      }
    }
    return null;
  }

  function renderClientDetails() {
    const box = $('qbClientDetails');
    if (!box) return;
    const info = getClientDisplayInfo();
    const hasClient =
      info &&
      (info.name || info.phone || info.email || info.address || parseInt($('customerId')?.value, 10) > 0);
    if (!hasClient) {
      box.classList.add('hidden');
      return;
    }
    const set = (id, val) => setWrappingField(id, val);
    set('qbClientName', info?.name);
    set('qbClientPhone', info?.phone);
    set('qbClientEmail', info?.email);
    set('qbClientAddress', info?.address);
    box.classList.remove('hidden');
    updateClientActionButtons();
  }

  function updateInlineItemTotal() {
    const el = $('inlineItemTotal');
    if (!el) return;
    const qty = parseQtyInput($('modalServiceQty')?.value);
    const sell = resolveInlineSellRate();
    el.textContent = money(lineAmount(qty, sell));
  }

  function unitLabel(unit) {
    const u = String(unit || 'sq_ft');
    if (u === 'sq_ft') return 'Sq Ft';
    if (u === 'linear_ft') return 'Linear Ft';
    if (u === 'fixed') return 'Fixed';
    return u.replace(/_/g, ' ');
  }

  function sumItems() {
    return items.reduce((s, it) => s + lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0), 0);
  }

  function discountAmt(sub, type, val) {
    const d = Number(val) || 0;
    if (type === 'fixed') return Math.min(Math.max(0, d), sub);
    return Math.min(sub * (d / 100), sub);
  }

  function updatePreviewHeader() {
    const meta = $('quoteMeta');
    const metaText = meta && meta.textContent ? meta.textContent : 'Novo orçamento';
    const top = $('topbarTitle');
    const no = $('previewEstimateNo');
    const dateEl = $('previewEstimateDate');
    const titlePart = metaText.includes('·') ? metaText.split('·')[0].trim() : metaText;
    if (top) top.textContent = titlePart;
    const mobileTitle = $('mobileAppTitle');
    if (mobileTitle) mobileTitle.textContent = titlePart;
    if (no) {
      const numLabel = formatQuoteNumberLabel(loadedQuoteNumber);
      if (numLabel) {
        no.textContent = numLabel;
      } else if (quoteId) {
        no.textContent = `#${quoteId}`;
      } else {
        no.textContent = '—';
      }
    }
    const expEl = $('expirationDate');
    const exp = expEl && expEl.value ? String(expEl.value).slice(0, 10) : '';
    const fmt = (iso) => {
      try {
        return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      } catch (_) {
        return iso;
      }
    };
    if (dateEl) {
      dateEl.textContent = exp
        ? `Expira em ${fmt(exp)}`
        : `Criado em ${fmt(new Date().toISOString().slice(0, 10))}`;
    }
  }

  function recalc() {
    const sub = sumItems();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    const tax = parseFloat($('taxTotal').value) || 0;
    const disc = discountAmt(sub, dt, dv);
    const total = Math.max(0, Math.round((sub - disc + tax) * 100) / 100);
    const subEl = $('dispSubtotal');
    const discEl = $('dispDiscount');
    const taxDisp = $('dispTax');
    const totalEl = $('dispTotal');
    const balEl = $('dispBalance');
    if (subEl) subEl.textContent = money(sub);
    if (discEl) discEl.textContent = money(disc);
    if (taxDisp) taxDisp.textContent = money(tax);
    if (totalEl) totalEl.textContent = money(total);
    if (balEl) balEl.textContent = money(total);
    updateProfitPanel();
    return { sub, total, disc, tax };
  }


  function escapeHtmlText(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatLeadClientLabel(lead) {
    if (!lead) return '';
    return lead.name ? String(lead.name).trim() : `Lead #${lead.id}`;
  }

  function formatCustomerLabel(c) {
    if (!c) return '';
    if (c.customer_type === 'builder' && c.responsible_name) {
      return String(c.name || c.responsible_name).trim();
    }
    return String(c.name || '').trim();
  }

  function setWrappingField(id, val) {
    const el = $(id);
    if (!el) return;
    const text = val && String(val).trim() ? String(val).trim() : '—';
    el.textContent = text.replace(/([^\s]{16})/g, '$1\u200b');
  }

  function upsertClientInCache(c) {
    if (!c || c.id == null) return;
    const id = Number(c.id);
    const idx = clients.findIndex((x) => Number(x.id) === id);
    if (idx >= 0) clients[idx] = { ...clients[idx], ...c };
    else clients.push(c);
  }

  function hideClientSearchResults() {
    const box = $('customerSearchResults');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  }

  function showClientSearchResults(html) {
    const box = $('customerSearchResults');
    if (!box) return;
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  async function fetchLeadsForClientSearch(query) {
    const q = String(query || '').trim();
    const params = new URLSearchParams({ limit: '40', page: '1' });
    if (q) params.set('q', q);
    const res = await fetch(`/api/leads?${params.toString()}`, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Não foi possível pesquisar leads.');
    }
    return Array.isArray(data.data) ? data.data : [];
  }

  function renderClientSearchResults(leads) {
    if (!leads.length) {
      showClientSearchResults('<div class="qb-client-search__empty">Nenhum lead encontrado.</div>');
      return;
    }
    const html = leads
      .map((lead) => {
        const id = Number(lead.id);
        const stage = lead.pipeline_stage_name || lead.pipeline_stage_slug || lead.status || '';
        const meta = [
          lead.email ? escapeHtmlText(lead.email) : '',
          lead.phone ? escapeHtmlText(lead.phone) : '',
          stage ? escapeHtmlText(stage) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<button type="button" class="qb-client-search__item" data-lead-id="${id}" role="option">
          <span class="qb-client-search__item-name">${escapeHtmlText(lead.name || `Lead #${id}`)}</span>
          <span class="qb-client-search__item-meta">${meta || `ID ${id}`}</span>
        </button>`;
      })
      .join('');
    showClientSearchResults(html);
  }

  async function resolveCustomerForLead(leadId) {
    const lid = parseInt(String(leadId), 10);
    if (!Number.isFinite(lid) || lid <= 0) return null;

    const byLead = await fetch(`/api/customers/by-lead/${lid}`, { credentials: 'include' }).then((r) =>
      r.json()
    );
    if (byLead.success && byLead.data && byLead.data.id != null) {
      upsertClientInCache(byLead.data);
      return Number(byLead.data.id);
    }

    const created = await fetch('/api/customers/from-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lead_id: lid, customer_type: 'customer' }),
    }).then((r) => r.json());

    if (created.success && created.data && created.data.id != null) {
      const cid = Number(created.data.id);
      try {
        const cr = await api(`/api/customers/${cid}`);
        if (cr.data) upsertClientInCache(cr.data);
        else upsertClientInCache({ id: cid, customer_type: 'customer' });
      } catch (_) {
        upsertClientInCache({ id: cid, customer_type: 'customer' });
      }
      return cid;
    }
    throw new Error(created.error || 'Não foi possível criar cliente a partir do lead.');
  }

  async function selectLeadAsClient(lead) {
    if (!lead || lead.id == null) return;
    setQuoteParty('lead', { applyPrices: true });
    selectedQuoteLead = lead;
    pendingLeadId = Number(lead.id);
    loadedQuoteLeadId = null;
    const search = $('customerSearch');
    if (search) search.value = formatLeadClientLabel(lead);
    hideClientSearchResults();
    renderClientDetails();
    updateClientActionButtons();
    hideClientForms();

    const hint = $('leadContextHint');
    if (hint) {
      hint.textContent = `Associado ao lead: ${lead.name || '#' + lead.id}. O orçamento ficará ligado a este lead ao guardar.`;
      hint.classList.remove('hidden');
    }

    try {
      const cid = await resolveCustomerForLead(lead.id);
      if (cid) {
        $('customerId').value = String(cid);
        applyPricingFromCustomerId(String(cid));
        refreshRatesForCatalogLines();
        renderItems();
        renderClientDetails();
      }
    } catch (e) {
      $('customerId').value = '';
      renderClientDetails();
      qbToast(e.message || 'Lead sem email válido para criar cliente.', 'error');
    }
  }

  async function ensureCustomerForQuote() {
    if (getQuoteParty() === 'builder') {
      const bid = parseInt($('quoteBuilderSelect')?.value, 10);
      if (!Number.isFinite(bid) || bid <= 0) {
        throw new Error('Selecione um builder.');
      }
      const b =
        selectedQuoteBuilder && Number(selectedQuoteBuilder.id) === bid
          ? selectedQuoteBuilder
          : quoteBuilders.find((x) => Number(x.id) === bid);
      if (b && b.customer_id) {
        $('customerId').value = String(b.customer_id);
        return Number(b.customer_id);
      }
      const cid = parseInt(String($('customerId')?.value), 10);
      if (Number.isFinite(cid) && cid > 0) return cid;
      return null;
    }

    let cid = parseInt(String($('customerId') && $('customerId').value), 10);
    if (Number.isFinite(cid) && cid > 0) return cid;

    const leadId =
      (selectedQuoteLead && selectedQuoteLead.id != null && Number(selectedQuoteLead.id)) ||
      (pendingLeadId != null && Number.isFinite(pendingLeadId) ? pendingLeadId : null) ||
      (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId) ? loadedQuoteLeadId : null);

    if (!leadId) {
      throw new Error('Selecione um cliente (lead).');
    }
    cid = await resolveCustomerForLead(leadId);
    if (!cid) throw new Error('Selecione um cliente (lead).');
    $('customerId').value = String(cid);
    return cid;
  }

  function getClientEmailForQuote() {
    if (getQuoteParty() === 'builder' && selectedQuoteBuilder && selectedQuoteBuilder.email) {
      return String(selectedQuoteBuilder.email).trim();
    }
    const cid = parseInt(String($('customerId') && $('customerId').value), 10);
    if (Number.isFinite(cid) && cid > 0) {
      const c = clients.find((x) => Number(x.id) === cid);
      if (c && c.email) return String(c.email).trim();
    }
    if (selectedQuoteLead && selectedQuoteLead.email) return String(selectedQuoteLead.email).trim();
    return '';
  }

  function getClientPhoneForQuote() {
    if (getQuoteParty() === 'builder' && selectedQuoteBuilder && selectedQuoteBuilder.phone) {
      return String(selectedQuoteBuilder.phone).trim();
    }
    if (selectedQuoteLead && selectedQuoteLead.phone) return String(selectedQuoteLead.phone).trim();
    const cid = parseInt(String($('customerId') && $('customerId').value), 10);
    if (Number.isFinite(cid) && cid > 0) {
      const c = clients.find((x) => Number(x.id) === cid);
      if (c && c.phone) return String(c.phone).trim();
    }
    return '';
  }

  function leadFirstNameForSms(lead) {
    if (!lead) return 'there';
    const full = lead.name != null ? String(lead.name).trim() : '';
    const bit = full.split(/\s+/).filter(Boolean)[0];
    return bit || 'there';
  }

  function getQuotePublicUrlFromDom() {
    const a = $('publicLink');
    if (a && a.href && String(a.href).startsWith('http')) return a.href;
    return '';
  }

  async function resolveQuotePublicUrl() {
    const existing = getQuotePublicUrlFromDom();
    if (existing) return existing;
    if (!quoteId) return '';
    try {
      const r = await api(`/api/quotes/${quoteId}`);
      const q = r.data || {};
      if (q.quote_number || q.public_token) {
        setPublicLink(q.public_token, q.quote_number);
        return getQuotePublicUrlFromDom();
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function buildQuoteSmsBody(lead, publicUrl) {
    const first = leadFirstNameForSms(lead);
    const num = loadedQuoteNumber ? formatQuoteNumberLabel(loadedQuoteNumber) : '';
    const ref = num ? ` (${num})` : '';
    let body = `Hi ${first}, your quote from Senior Floors${ref} is ready.`;
    if (publicUrl) {
      body += `\n\nView your quote here:\n${publicUrl}`;
    }
    body += '\n\nThank you!';
    return body;
  }

  let quoteSendMenuOpen = false;
  let loadedQuoteEmailSentAt = null;
  let loadedQuoteViewedAt = null;
  let loadedQuotePdfViewedAt = null;
  /** Status persistido no servidor (pode diferir do dropdown até guardar). */
  let loadedQuoteStatus = null;
  let quoteViewPollTimer = null;
  let quoteViewPollQuickTimer = null;
  let quoteViewNotifyShown = false;
  let quotePdfNotifyShown = false;

  function formatEmailSentWhen(value) {
    if (!value) return '';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
      return d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return String(value);
    }
  }

  function updateEmailSentBadge(sentAt) {
    loadedQuoteEmailSentAt = sentAt || null;
    const badge = $('qbEmailSentBadge');
    const label = $('qbEmailSentBadgeLabel');
    const emailMenuItem = $('quoteSendByEmail');
    if (!badge) return;
    if (loadedQuoteEmailSentAt) {
      const when = formatEmailSentWhen(loadedQuoteEmailSentAt);
      const tip = when ? `E-mail enviado em ${when}` : 'E-mail enviado';
      badge.classList.remove('hidden');
      badge.title = tip;
      badge.setAttribute('aria-label', tip);
      if (label) label.textContent = when ? `E-mail · ${when}` : 'E-mail enviado';
      if (emailMenuItem) {
        const small = emailMenuItem.querySelector('small');
        if (small) small.textContent = when ? `Último envio: ${when}` : 'Já enviado por e-mail';
      }
    } else {
      badge.classList.add('hidden');
      badge.removeAttribute('title');
      badge.setAttribute('aria-label', 'E-mail do orçamento ainda não enviado');
      if (label) label.textContent = 'E-mail enviado';
      if (emailMenuItem) {
        const small = emailMenuItem.querySelector('small');
        if (small) small.textContent = 'Só link seguro no e-mail — orçamento e PDF na página online';
      }
    }
  }

  function stopQuoteViewPolling() {
    if (quoteViewPollTimer) {
      clearInterval(quoteViewPollTimer);
      quoteViewPollTimer = null;
    }
    if (quoteViewPollQuickTimer) {
      clearTimeout(quoteViewPollQuickTimer);
      quoteViewPollQuickTimer = null;
    }
  }

  function shouldPollQuoteView() {
    if (!quoteId) return false;
    const st = String($('status')?.value || '').toLowerCase();
    const waiting = !!(loadedQuoteEmailSentAt || st === 'sent');
    if (!waiting) return false;
    return !loadedQuoteViewedAt || !loadedQuotePdfViewedAt;
  }

  function maybeStopQuoteViewPolling() {
    if (!shouldPollQuoteView()) stopQuoteViewPolling();
  }

  async function pollQuoteViewed() {
    if (!shouldPollQuoteView() || document.visibilityState === 'hidden') return;
    try {
      const r = await api(`/api/quotes/${quoteId}/engagement`);
      const d = r.data;
      if (!d) return;
      if (d.email_sent_at && !loadedQuoteEmailSentAt) updateEmailSentBadge(d.email_sent_at);
      if (d.viewed_at) updateQuoteViewedBadge(d.viewed_at, { notify: true });
      if (d.pdf_viewed_at) updatePdfViewedBadge(d.pdf_viewed_at, { notify: true });
      if (d.status) {
        const statusEl = $('status');
        const st = String(d.status).toLowerCase();
        if (statusEl && ['viewed', 'approved', 'accepted'].includes(st)) {
          statusEl.value = d.status;
          loadedQuoteStatus = d.status;
          syncInvoiceUiVisibility();
        }
      }
      maybeStopQuoteViewPolling();
    } catch {
      /* polling silencioso */
    }
  }

  function startQuoteViewPolling() {
    stopQuoteViewPolling();
    if (!shouldPollQuoteView()) return;
    quoteViewPollQuickTimer = setTimeout(() => void pollQuoteViewed(), 12000);
    quoteViewPollTimer = setInterval(() => void pollQuoteViewed(), 30000);
  }

  function updateQuoteViewedBadge(viewedAt, opts = {}) {
    const wasViewed = !!loadedQuoteViewedAt;
    loadedQuoteViewedAt = viewedAt || null;
    const badge = $('qbQuoteViewedBadge');
    const label = $('qbQuoteViewedBadgeLabel');
    if (!badge) return;
    if (loadedQuoteViewedAt) {
      maybeStopQuoteViewPolling();
      const when = formatEmailSentWhen(loadedQuoteViewedAt);
      const tip = when ? `Cliente abriu o link do orçamento em ${when}` : 'Cliente abriu o link do orçamento';
      badge.classList.remove('hidden');
      badge.title = tip;
      badge.setAttribute('aria-label', tip);
      if (label) label.textContent = when ? `Aberto · ${when}` : 'Aberto pelo cliente';
      const statusEl = $('status');
      if (statusEl && statusEl.value === 'sent') statusEl.value = 'viewed';
      if (opts.notify && !wasViewed && !quoteViewNotifyShown) {
        quoteViewNotifyShown = true;
        showQuoteNotify({
          type: 'success',
          title: 'Orçamento aberto',
          message: when
            ? `O cliente abriu o link do orçamento (${when}).`
            : 'O cliente abriu o link do orçamento online.',
          ms: 12000,
        });
      }
    } else {
      badge.classList.add('hidden');
      badge.removeAttribute('title');
      badge.setAttribute('aria-label', 'Orçamento ainda não aberto pelo cliente');
      if (label) label.textContent = 'Aberto pelo cliente';
      if (!opts.keepNotifyFlag) quoteViewNotifyShown = false;
    }
  }

  function updatePdfViewedBadge(pdfAt, opts = {}) {
    const wasPdf = !!loadedQuotePdfViewedAt;
    loadedQuotePdfViewedAt = pdfAt || null;
    const badge = $('qbPdfViewedBadge');
    const label = $('qbPdfViewedBadgeLabel');
    if (!badge) return;
    if (loadedQuotePdfViewedAt) {
      maybeStopQuoteViewPolling();
      const when = formatEmailSentWhen(loadedQuotePdfViewedAt);
      const tip = when ? `Cliente descarregou o PDF em ${when}` : 'Cliente descarregou o PDF';
      badge.classList.remove('hidden');
      badge.title = tip;
      badge.setAttribute('aria-label', tip);
      if (label) label.textContent = when ? `PDF · ${when}` : 'PDF descarregado';
      if (opts.notify && !wasPdf && !quotePdfNotifyShown) {
        quotePdfNotifyShown = true;
        showQuoteNotify({
          type: 'success',
          title: 'PDF descarregado',
          message: when
            ? `O cliente descarregou o PDF do orçamento (${when}).`
            : 'O cliente descarregou o PDF do orçamento.',
          ms: 12000,
        });
      }
    } else {
      badge.classList.add('hidden');
      badge.removeAttribute('title');
      badge.setAttribute('aria-label', 'PDF ainda não descarregado pelo cliente');
      if (label) label.textContent = 'PDF descarregado';
      if (!opts.keepNotifyFlag) quotePdfNotifyShown = false;
    }
  }

  function closeQuoteSendMenu() {
    const menu = $('quoteSendMenu');
    const btn = $('btnSend');
    if (menu) menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    quoteSendMenuOpen = false;
    document.removeEventListener('click', onQuoteSendMenuOutside, true);
    window.removeEventListener('resize', positionQuoteSendMenu);
  }

  function positionQuoteSendMenu() {
    const menu = $('quoteSendMenu');
    const anchor = $('btnSend');
    if (!menu || !anchor || menu.classList.contains('hidden')) return;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    menu.style.visibility = 'hidden';
    menu.classList.remove('hidden');
    const menuH = menu.offsetHeight || 120;
    const menuW = Math.max(220, menu.offsetWidth || 220);
    let top = r.top - menuH - 6;
    if (top < margin) top = r.bottom + 6;
    let left = r.left + r.width / 2 - menuW / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuW - margin));
    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.width = `${menuW}px`;
    menu.style.visibility = '';
  }

  function onQuoteSendMenuOutside(e) {
    if (
      e.target.closest('#quoteSendMenu') ||
      e.target.closest('#btnSend')
    ) {
      return;
    }
    closeQuoteSendMenu();
  }

  function openQuoteSendMenu() {
    if (!quoteId) return;
    const menu = $('quoteSendMenu');
    const btn = $('btnSend');
    if (!menu || !btn) return;
    quoteSendMenuOpen = true;
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    positionQuoteSendMenu();
    window.addEventListener('resize', positionQuoteSendMenu);
    requestAnimationFrame(() => {
      document.addEventListener('click', onQuoteSendMenuOutside, true);
    });
  }

  function toggleQuoteSendMenu() {
    if (quoteSendMenuOpen) closeQuoteSendMenu();
    else openQuoteSendMenu();
  }

  function getCurrentQuoteLeadId() {
    if (selectedQuoteLead && selectedQuoteLead.id != null) {
      const n = Number(selectedQuoteLead.id);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId) && loadedQuoteLeadId > 0) {
      return loadedQuoteLeadId;
    }
    if (pendingLeadId != null && Number.isFinite(pendingLeadId) && pendingLeadId > 0) {
      return pendingLeadId;
    }
    const params = new URLSearchParams(location.search);
    const fromUrl = parseInt(params.get('lead_id'), 10);
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    return null;
  }

  async function sendQuoteByEmail() {
    closeQuoteSendMenu();
    if (!quoteId) return;
    let cid;
    try {
      cid = await ensureCustomerForQuote();
    } catch (e) {
      showQuoteNotify({
        type: 'error',
        title: 'Cliente necessário',
        message: e.message || 'Selecione um lead na pesquisa de cliente.',
        ms: 8000,
      });
      return;
    }
    const preview = getClientEmailForQuote();
    if (!preview) {
      showQuoteNotify({
        type: 'error',
        title: 'E-mail em falta',
        message: 'Este cliente não tem e-mail no cadastro. Edite o cliente no CRM e adicione o e-mail antes de enviar.',
        ms: 10000,
      });
      return;
    }
    try {
      tryCommitBuilderExtraEmailInput();
      const extra =
        getQuoteParty() === 'builder' && builderExtraEmails.length
          ? builderExtraEmails.slice()
          : [];
      const body = extra.length ? { extra_emails: extra, cc: extra } : {};
      const lid = getCurrentQuoteLeadId();
      if (lid) body.lead_id = lid;
      const r = await api(`/api/quotes/${quoteId}/send-email`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const how = r.transport === 'smtp' ? 'SMTP' : r.transport === 'resend' ? 'Resend' : 'servidor';
      updateEmailSentBadge(r.email_sent_at || new Date().toISOString());
      if (r.email_sent_at == null) {
        try {
          const fresh = await api(`/api/quotes/${quoteId}`);
          if (fresh.data?.email_sent_at) updateEmailSentBadge(fresh.data.email_sent_at);
        } catch {
          /* badge já atualizado com data local */
        }
      }
      const statusEl = $('status');
      if (statusEl && statusEl.value === 'draft') statusEl.value = 'sent';
      startQuoteViewPolling();
      const ccNote = extra.length ? ` (CC: ${extra.join(', ')})` : '';
      const movedNote =
        r.lead_moved === true
          ? ' Lead movido para Quote Sent.'
          : r.lead_move_reason === 'no_lead'
            ? ' (Lead do Kanban não associado a este orçamento.)'
            : '';
      showQuoteNotify({
        type: 'success',
        title: 'E-mail enviado',
        message: `E-mail enviado para ${preview}${ccNote} (${how}) — só com link seguro. Será notificado quando o cliente abrir o link ou descarregar o PDF.${movedNote}`,
      });
    } catch (e) {
      const raw = e.message || '';
      const friendly =
        /badcredentials|username and password not accepted|invalid login|535/i.test(raw)
          ? 'Erro SMTP no servidor. Se usa Resend, remova SMTP_* no Railway (o sistema já não usa Gmail por defeito). Caso contrário: App Password do Google em SMTP_PASS.'
          : raw || 'Não foi possível enviar o e-mail. Verifique GET /api/health/email no servidor.';
      showQuoteNotify({
        type: 'error',
        title: 'Falha ao enviar e-mail',
        message: friendly,
        ms: 14000,
      });
    }
  }

  async function sendQuoteByMessage() {
    closeQuoteSendMenu();
    if (!quoteId) return;
    const phone = getClientPhoneForQuote();
    if (!phone) {
      showQuoteNotify({
        type: 'error',
        title: 'Telefone em falta',
        message: 'Este cliente não tem telefone no cadastro. Edite o cliente no CRM e adicione o telefone.',
        ms: 10000,
      });
      return;
    }
    const publicUrl = await resolveQuotePublicUrl();
    if (!publicUrl) {
      showQuoteNotify({
        type: 'error',
        title: 'Link do orçamento',
        message: 'Guarde o orçamento primeiro para gerar o link público antes de enviar por mensagem.',
        ms: 10000,
      });
      return;
    }
    try {
      const markBody = { mark_sent: true };
      const lid = getCurrentQuoteLeadId();
      if (lid) markBody.lead_id = lid;
      await api(`/api/quotes/${quoteId}/publish-client`, {
        method: 'POST',
        body: JSON.stringify(markBody),
      });
      const statusEl = $('status');
      if (statusEl && statusEl.value === 'draft') statusEl.value = 'sent';
    } catch (_) {
      /* envio SMS segue; a cópia pública pode ficar na versão anterior */
    }
    const lead = selectedQuoteLead || {
      name: $('qbClientName')?.textContent || '',
      phone,
    };
    const body = buildQuoteSmsBody(lead, publicUrl);
    const buildSms =
      typeof window !== 'undefined' && typeof window.sfBuildSmsHref === 'function'
        ? window.sfBuildSmsHref
        : null;
    const href = buildSms ? buildSms(phone, body) : null;
    if (!href) {
      qbToast('Não foi possível abrir a app de mensagens.', 'error');
      return;
    }
    window.location.href = href;
  }

  async function setClientSearchFromLoadedQuote(q) {
    const search = $('customerSearch');
    if (!search || !q) return;
    $('customerId').value = q.customer_id != null ? String(q.customer_id) : '';

    if (q.lead_id != null && q.lead_id !== '') {
      const lid = Number(q.lead_id);
      if (Number.isFinite(lid)) {
        loadedQuoteLeadId = lid;
        selectedQuoteLead = null;
        pendingLeadId = null;
        try {
          const lr = await fetch(`/api/leads/${lid}`, { credentials: 'include' }).then((r) => r.json());
          if (lr.success && lr.data) {
            selectedQuoteLead = lr.data;
            search.value = formatLeadClientLabel(lr.data);
            const hint = $('leadContextHint');
            if (hint) {
              hint.textContent = `Associado ao lead: ${lr.data.name || '#' + lid}.`;
              hint.classList.remove('hidden');
            }
            renderClientDetails();
            return;
          }
        } catch (_) {
          /* ignore */
        }
      }
    }

    if (q.customer_id) {
      const c = clients.find((x) => Number(x.id) === Number(q.customer_id));
      if (c) search.value = formatCustomerLabel(c);
    }
    renderClientDetails();
  }

  function scheduleClientLeadSearch() {
    const search = $('customerSearch');
    if (!search) return;
    const q = search.value.trim();
    clearTimeout(clientSearchTimer);
    clientSearchTimer = setTimeout(async () => {
      try {
        const leads = await fetchLeadsForClientSearch(q);
        renderClientSearchResults(leads);
      } catch (e) {
        showClientSearchResults(
          `<div class="qb-client-search__empty">${escapeHtmlText(e.message || 'Erro na pesquisa')}</div>`
        );
      }
    }, 220);
  }

  function wireClientLeadSearch() {
    const search = $('customerSearch');
    const box = $('customerSearchResults');
    const wrap = $('qbClientSearchWrap');
    if (!search || !box) return;

    search.addEventListener('focus', () => {
      scheduleClientLeadSearch();
    });
    search.addEventListener('input', () => {
      selectedQuoteLead = null;
      pendingLeadId = null;
      loadedQuoteLeadId = null;
      $('customerId').value = '';
      selectedQuoteLead = null;
      renderClientDetails();
      scheduleClientLeadSearch();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideClientSearchResults();
    });

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lead-id]');
      if (!btn) return;
      const lid = parseInt(btn.getAttribute('data-lead-id'), 10);
      if (!Number.isFinite(lid)) return;
      fetch(`/api/leads/${lid}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.data) void selectLeadAsClient(data.data);
        })
        .catch(() => qbToast('Erro ao carregar lead.', 'error'));
    });

    document.addEventListener('click', (e) => {
      if (!wrap || wrap.contains(e.target)) return;
      hideClientSearchResults();
    });
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function attachItemsListHandlers() {
    const list = $('itemsList');
    if (!list || list.dataset.bound) return;
    list.dataset.bound = '1';
    list.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const idx = parseInt(editBtn.getAttribute('data-edit'), 10);
        if (Number.isFinite(idx)) openAddItemPanel(idx);
        return;
      }
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        const idx = parseInt(delBtn.getAttribute('data-del'), 10);
        if (!Number.isFinite(idx)) return;
        if (inlineEditIdx === idx) closeAddItemPanel();
        else if (inlineEditIdx != null && inlineEditIdx > idx) inlineEditIdx -= 1;
        items.splice(idx, 1);
        recalc();
        renderItems();
      }
    });
  }

  let modalSelectedCatalogRow = null;
  let modalServiceSearchTimer = null;
  /** Índice destacado no dropdown de serviços (−1 = nenhum). */
  let modalServiceActiveIndex = -1;
  /** Linhas atualmente listadas no dropdown. */
  let modalServiceVisibleRows = [];

  function hideModalServiceResults() {
    const box = $('modalServiceResults');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
      box.style.maxHeight = '';
    }
    modalServiceActiveIndex = -1;
    modalServiceVisibleRows = [];
    const nameEl = $('modalServiceName');
    if (nameEl) {
      nameEl.removeAttribute('aria-activedescendant');
      nameEl.setAttribute('aria-expanded', 'false');
    }
  }

  function showModalServiceResults(html) {
    const box = $('modalServiceResults');
    if (!box) return;
    box.innerHTML = html;
    box.classList.remove('hidden');
    const nameEl = $('modalServiceName');
    if (nameEl) nameEl.setAttribute('aria-expanded', 'true');
    fitModalServiceResultsHeight();
    if (document.activeElement === nameEl) {
      requestAnimationFrame(() => scrollServiceNameIntoView({ force: true }));
    }
  }

  /** Margem extra acima do teclado / barra de ações (px). */
  const QB_SERVICE_KEYBOARD_GAP = 88;

  function getServiceFieldViewportMetrics() {
    const vv = window.visualViewport;
    const layoutH = window.innerHeight || document.documentElement.clientHeight || 0;
    const vvTop = vv ? vv.offsetTop : 0;
    const vvH = vv ? vv.height : layoutH;
    const actionBar = $('qbActionBar');
    const actionBarH =
      actionBar && !actionBar.classList.contains('hidden')
        ? actionBar.getBoundingClientRect().height
        : 0;
    const keyboardOverlap = Math.max(0, layoutH - (vvTop + vvH));
    const bottomReserve = Math.max(keyboardOverlap, actionBarH, 0) + QB_SERVICE_KEYBOARD_GAP;
    return { vvTop, vvH, layoutH, bottomReserve, keyboardOverlap, actionBarH };
  }

  /** Ajusta a altura do dropdown ao espaço livre abaixo do campo (acima do teclado). */
  function fitModalServiceResultsHeight() {
    const box = $('modalServiceResults');
    const el = $('modalServiceName');
    if (!box || box.classList.contains('hidden') || !el) return;
    const { vvTop, vvH, bottomReserve } = getServiceFieldViewportMetrics();
    const fieldBottom = el.getBoundingClientRect().bottom;
    const available = Math.floor(vvTop + vvH - bottomReserve - fieldBottom - 8);
    const maxH = Math.max(80, Math.min(280, available));
    box.style.maxHeight = `${maxH}px`;
  }

  function syncModalServiceActiveHighlight() {
    const box = $('modalServiceResults');
    if (!box) return;
    const items = Array.from(box.querySelectorAll('[data-catalog-id]'));
    items.forEach((el, i) => {
      const on = i === modalServiceActiveIndex;
      el.classList.toggle('is-active', on);
      el.classList.toggle('qb-client-search__item--active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        const id = el.id || `modalServiceOpt-${i}`;
        el.id = id;
        const nameEl = $('modalServiceName');
        if (nameEl) nameEl.setAttribute('aria-activedescendant', id);
        el.scrollIntoView({ block: 'nearest' });
      }
    });
    if (modalServiceActiveIndex < 0) {
      const nameEl = $('modalServiceName');
      if (nameEl) nameEl.removeAttribute('aria-activedescendant');
    }
  }

  function moveModalServiceActive(delta) {
    const box = $('modalServiceResults');
    if (!box || box.classList.contains('hidden')) return false;
    const count = modalServiceVisibleRows.length;
    if (!count) return false;
    if (modalServiceActiveIndex < 0) {
      modalServiceActiveIndex = delta > 0 ? 0 : count - 1;
    } else {
      modalServiceActiveIndex = (modalServiceActiveIndex + delta + count) % count;
    }
    syncModalServiceActiveHighlight();
    return true;
  }

  function selectActiveModalServiceResult() {
    const box = $('modalServiceResults');
    if (!box || box.classList.contains('hidden')) return false;
    if (modalServiceActiveIndex < 0 || modalServiceActiveIndex >= modalServiceVisibleRows.length) {
      return false;
    }
    const row = modalServiceVisibleRows[modalServiceActiveIndex];
    if (!row) return false;
    applyCatalogRowToServiceModal(row);
    return true;
  }

  function renderModalServiceResults(rows) {
    modalServiceVisibleRows = Array.isArray(rows) ? rows.slice() : [];
    if (!modalServiceVisibleRows.length) {
      modalServiceActiveIndex = -1;
      showModalServiceResults('<div class="qb-client-search__empty">Nenhum serviço no catálogo.</div>');
      return;
    }
    if (modalServiceActiveIndex >= modalServiceVisibleRows.length) {
      modalServiceActiveIndex = modalServiceVisibleRows.length - 1;
    }
    if (modalServiceActiveIndex < 0) modalServiceActiveIndex = 0;
    const src = catalogPricingSource();
    const html = modalServiceVisibleRows
      .map((row, i) => {
        const id = Number(row.id);
        const rate = effectiveCatalogRate(row, src);
        const meta = [
          row.category ? escapeHtmlText(row.category) : '',
          row.unit_type ? escapeHtmlText(row.unit_type) : '',
          money(rate),
        ]
          .filter(Boolean)
          .join(' · ');
        const activeClass =
          i === modalServiceActiveIndex
            ? ' is-active qb-client-search__item--active'
            : '';
        return `<button type="button" id="modalServiceOpt-${i}" class="qb-client-search__item${activeClass}" data-catalog-id="${id}" role="option" aria-selected="${i === modalServiceActiveIndex ? 'true' : 'false'}">
          <span class="qb-client-search__item-name">${escapeHtmlText(row.name || `Serviço #${id}`)}</span>
          <span class="qb-client-search__item-meta">${meta}</span>
        </button>`;
      })
      .join('');
    showModalServiceResults(html);
    syncModalServiceActiveHighlight();
  }

  function handleModalServiceNameKeydown(e) {
    const box = $('modalServiceResults');
    const open = box && !box.classList.contains('hidden') && modalServiceVisibleRows.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        scheduleModalServiceSearch();
        return;
      }
      moveModalServiceActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      moveModalServiceActive(-1);
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        hideModalServiceResults();
      }
      return;
    }
    handleServiceFormEnter(e);
  }

  function applyCatalogRowToServiceModal(row) {
    if (!row) return;
    modalSelectedCatalogRow = row;
    const src = catalogPricingSource();
    const rate = effectiveCatalogRate(row, src);
    if ($('modalServiceMarkup')) $('modalServiceMarkup').value = '';
    qbSuppressServiceNameInput = true;
    $('modalServiceName').value = row.name || '';
    qbSuppressServiceNameInput = false;
    $('modalServiceDesc').value =
      row.default_description != null ? String(row.default_description).trim() : '';
    $('modalServiceType').value = serviceTypeFromCatalogCategory(row.category);
    $('modalServiceUnit').value = row.unit_type || 'sq_ft';
    setMoneyFieldValue($('modalServiceRate'), rate);
    hideModalServiceResults();
    updateInlineItemTotal();
  }

  function resetServiceModalForm() {
    modalSelectedCatalogRow = null;
    const nameEl = $('modalServiceName');
    if (nameEl) nameEl.value = '';
    if ($('modalServiceDesc')) $('modalServiceDesc').value = '';
    if ($('modalServiceType')) $('modalServiceType').value = 'Supply';
    if ($('modalServiceUnit')) $('modalServiceUnit').value = 'sq_ft';
    if ($('modalServiceQty')) $('modalServiceQty').value = '1';
    if ($('modalServiceMarkup')) $('modalServiceMarkup').value = '';
    setMoneyFieldValue($('modalServiceRate'), 0);
    if ($('inlineItemNote')) $('inlineItemNote').value = '';
    hideModalServiceResults();
    updateInlineItemTotal();
  }

  function fillInlineFormFromItem(it) {
    if (!it) return;
    const cid = normalizeCatalogId(it.service_catalog_id);
    modalSelectedCatalogRow = cid ? catalog.find((c) => Number(c.id) === cid) || null : null;
    $('modalServiceName').value = it.name != null ? String(it.name) : '';
    $('modalServiceDesc').value = it.description != null ? String(it.description) : '';
    $('modalServiceType').value = normalizeServiceType(it.service_type);
    $('modalServiceUnit').value = it.unit_type || 'sq_ft';
    $('modalServiceQty').value = String(it.quantity ?? 1);
    const cost = it.cost_price != null ? Number(it.cost_price) : null;
    const sell = Number(it.rate) || 0;
    const markup = it.markup_percentage != null ? Number(it.markup_percentage) : null;
    let base = cost != null && Number.isFinite(cost) && cost > 0 ? cost : sell;
    if ((!base || base <= 0) && sell > 0) base = sell;
    setMoneyFieldValue($('modalServiceRate'), base);
    if ($('modalServiceMarkup')) {
      $('modalServiceMarkup').value =
        markup != null && Number.isFinite(markup) ? String(markup) : '';
    }
    if ($('inlineItemNote')) $('inlineItemNote').value = it.notes != null ? String(it.notes) : '';
    updateInlineItemTotal();
  }

  function scheduleModalServiceSearch() {
    const q = ($('modalServiceName') && $('modalServiceName').value) || '';
    clearTimeout(modalServiceSearchTimer);
    modalServiceSearchTimer = setTimeout(() => {
      renderModalServiceResults(filterCatalogForServiceSearch(q));
    }, 180);
  }

  let qbServiceFieldScrollTimers = [];
  let qbServiceViewportWired = false;

  function clearServiceFieldScrollTimers() {
    qbServiceFieldScrollTimers.forEach((id) => clearTimeout(id));
    qbServiceFieldScrollTimers = [];
  }

  function getBuilderMainScroller() {
    const nameEl = $('modalServiceName');
    if (nameEl) {
      const main = nameEl.closest('.builder-main');
      if (main) return main;
    }
    return document.querySelector('.builder-main');
  }

  /** Fixa o campo Nome do serviço no topo da área visível (acima do teclado). */
  function scrollServiceNameIntoView(opts) {
    const force = opts && opts.force;
    const el = $('modalServiceName');
    const wrap = $('modalServiceSearchWrap') || el;
    if (!el || document.activeElement !== el) return;
    const scroller = getBuilderMainScroller();
    if (!scroller) {
      el.scrollIntoView({ behavior: force ? 'auto' : 'smooth', block: 'start', inline: 'nearest' });
      return;
    }

    const { vvTop, vvH, bottomReserve } = getServiceFieldViewportMetrics();
    const targetTop = vvTop + 12;
    const anchor = wrap.getBoundingClientRect();
    let delta = anchor.top - targetTop;

    // Mantém folga clara entre o campo e o teclado
    const safeBottom = vvTop + vvH - bottomReserve;
    const fieldBottom = el.getBoundingClientRect().bottom;
    if (fieldBottom > safeBottom) {
      delta += fieldBottom - safeBottom;
    }

    if (!force && Math.abs(delta) < 6) {
      fitModalServiceResultsHeight();
      return;
    }

    scroller.scrollTo({
      top: Math.max(0, scroller.scrollTop + delta),
      behavior: force ? 'auto' : 'smooth',
    });

    requestAnimationFrame(() => {
      fitModalServiceResultsHeight();
      const after = wrap.getBoundingClientRect();
      const drift = after.top - targetTop;
      if (Math.abs(drift) > 8) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop + drift);
        fitModalServiceResultsHeight();
      }
      const box = $('modalServiceResults');
      if (box && !box.classList.contains('hidden')) {
        const blockBottom = Math.max(after.bottom, box.getBoundingClientRect().bottom);
        const visibleBottom = vvTop + vvH - bottomReserve;
        if (blockBottom > visibleBottom + 4) {
          scroller.scrollTop = Math.max(0, scroller.scrollTop + (blockBottom - visibleBottom));
          fitModalServiceResultsHeight();
        }
      }
    });
  }

  function ensureServiceNameVisibleForKeyboard() {
    clearServiceFieldScrollTimers();
    const run = () => scrollServiceNameIntoView({ force: true });
    requestAnimationFrame(run);
    // iOS/iPadOS abre o teclado com atraso — repetir após animação
    [80, 200, 360, 560, 800].forEach((ms) => {
      qbServiceFieldScrollTimers.push(setTimeout(run, ms));
    });
  }

  function onServiceNameVisualViewportChange() {
    if (document.activeElement !== $('modalServiceName')) return;
    scrollServiceNameIntoView();
  }

  function wireServiceNameKeyboardScroll() {
    if (qbServiceViewportWired) return;
    qbServiceViewportWired = true;
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onServiceNameVisualViewportChange);
      window.visualViewport.addEventListener('scroll', onServiceNameVisualViewportChange);
    }
    window.addEventListener('orientationchange', () => {
      if (document.activeElement === $('modalServiceName')) ensureServiceNameVisibleForKeyboard();
    });
  }

  function openAddItemPanel(idx) {
    const panel = $('addItemPanel');
    const modalError = $('modalError');
    if (!panel) return;
    inlineEditIdx = Number.isFinite(idx) ? idx : -1;
    if (modalError) modalError.classList.add('hidden');
    if (inlineEditIdx >= 0 && items[inlineEditIdx]) {
      fillInlineFormFromItem(items[inlineEditIdx]);
    } else {
      inlineEditIdx = -1;
      resetServiceModalForm();
    }
    panel.classList.remove('hidden');
    const btnAdd = $('btnAddLine');
    if (btnAdd) btnAdd.classList.add('hidden');
    const confirmBtn = $('modalConfirmService');
    if (confirmBtn) confirmBtn.textContent = inlineEditIdx >= 0 ? 'Guardar' : 'Adicionar';
    scheduleModalServiceSearch();
    const nameEl = $('modalServiceName');
    if (nameEl) {
      nameEl.focus({ preventScroll: true });
      ensureServiceNameVisibleForKeyboard();
    }
    wireMarginPricingFields();
  }

  function closeAddItemPanel() {
    const panel = $('addItemPanel');
    if (panel) panel.classList.add('hidden');
    inlineEditIdx = null;
    const btnAdd = $('btnAddLine');
    if (btnAdd) btnAdd.classList.remove('hidden');
    hideModalServiceResults();
    const modalError = $('modalError');
    if (modalError) modalError.classList.add('hidden');
  }

  function confirmAddServiceLine() {
    const modalError = $('modalError');
    if (modalError) modalError.classList.add('hidden');
    const name = String(($('modalServiceName') && $('modalServiceName').value) || '').trim();
    if (!name) {
      if (modalError) {
        modalError.textContent = 'Indique o nome do serviço.';
        modalError.classList.remove('hidden');
      }
      return;
    }
    const qty = parseQtyInput($('modalServiceQty').value) || 1;
    const catalogRow = resolveModalCatalogRow();
    const baseRate = resolveInlineBaseRate();
    const baseEl = $('modalServiceRate');
    if (baseEl && baseRate > 0) setMoneyFieldValue(baseEl, baseRate);
    const markupRaw = $('modalServiceMarkup') ? parseQtyInput($('modalServiceMarkup').value) : null;
    const markupPct =
      $('modalServiceMarkup') && String($('modalServiceMarkup').value || '').trim() !== ''
        ? markupRaw
        : null;
    const sellRate = computeSellUnitRate(baseRate, markupPct);
    const costPrice = baseRate > 0 ? baseRate : null;
    const row = catalogRow;
    const catNotes = row && row.notes_customer != null ? String(row.notes_customer).trim() : '';
    const noteVal = $('inlineItemNote') ? String($('inlineItemNote').value || '').trim() : '';
    const existing = inlineEditIdx >= 0 ? items[inlineEditIdx] : null;
    const line = {
      item_type: existing && existing.item_type === 'product' ? 'product' : 'service',
      name,
      description: String(($('modalServiceDesc') && $('modalServiceDesc').value) || '').trim(),
      unit_type: $('modalServiceUnit').value || 'sq_ft',
      quantity: qty,
      rate: sellRate,
      service_type: normalizeServiceType($('modalServiceType').value || 'Installation'),
      notes: noteVal || null,
      catalog_customer_notes:
        catNotes || (existing && existing.catalog_customer_notes) || null,
      service_catalog_id: row
        ? normalizeCatalogId(row.id)
        : existing
          ? normalizeCatalogId(existing.service_catalog_id)
          : null,
      product_id: existing && existing.product_id != null ? existing.product_id : null,
      cost_price: costPrice,
      markup_percentage: markupPct,
      sell_price: sellRate,
      estimateAuto: existing ? !!existing.estimateAuto : false,
    };
    if (inlineEditIdx >= 0) items[inlineEditIdx] = line;
    else items.push(line);
    closeAddItemPanel();
    renderItems();
  }

  function applyProjectSqftToAllSqFtLines() {
    const input = $('quoteProjectSqft');
    if (!input) return;
    const raw = String(input.value || '').trim().replace(',', '.');
    const sq = parseFloat(raw);
    if (!Number.isFinite(sq) || sq < 0) {
      qbToast('Indique uma quantidade válida de sq ft (≥ 0).', 'error');
      return;
    }
    let n = 0;
    for (const it of items) {
      if (String(it.unit_type || 'sq_ft') === 'sq_ft') {
        it.quantity = sq;
        n += 1;
      }
    }
    recalc();
    renderItems();
    if (n === 0) {
      qbToast(
        'Nenhuma linha com unidade Sq Ft. Defina a unidade «Sq Ft» nas linhas que devem usar a área do projeto.',
        'info'
      );
    }
  }

  function destroyItemSortables() {
    itemSortables.forEach((s) => {
      try {
        s.destroy();
      } catch (_) {
        /* ignore */
      }
    });
    itemSortables = [];
  }

  function syncItemsOrderFromDom() {
    const list = $('itemsList');
    if (!list) return;
    const newItems = [];
    list.querySelectorAll('.qb-cat-section').forEach((section) => {
      const svcType = section.getAttribute('data-category-value') || 'Installation';
      section.querySelectorAll('.qb-item-card[data-item-idx]').forEach((card) => {
        const idx = parseInt(card.getAttribute('data-item-idx'), 10);
        const it = items[idx];
        if (!it) return;
        const copy = { ...it };
        if (copy.item_type !== 'product' && svcType !== 'products') {
          copy.service_type = svcType;
        }
        newItems.push(copy);
      });
    });
    if (newItems.length) items = newItems;
  }

  function initItemsSortable() {
    destroyItemSortables();
    if (typeof Sortable === 'undefined') return;
    document.querySelectorAll('#itemsList .qb-cat-items').forEach((el) => {
      itemSortables.push(
        Sortable.create(el, {
          handle: '.qb-item-card__grip',
          animation: 150,
          draggable: '.qb-item-card',
          group: 'qb-quote-lines',
          ghostClass: 'sortable-ghost',
          onEnd: () => {
            syncItemsOrderFromDom();
            renderItems();
          },
        })
      );
    });
  }

  function createItemCard(it, idx) {
    const amt = lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0);
    const qty = Number(it.quantity) || 0;
    const rate = Number(it.rate) || 0;
    const name = it.name != null ? String(it.name).trim() : '';
    const desc = it.description != null ? String(it.description).trim() : '';
    const isProduct = it.item_type === 'product';
    const badges = [];
    if (it.estimateAuto) badges.push('<span class="qb-item-card__badge qb-item-card__badge--auto">auto</span>');
    if (isProduct) badges.push('<span class="qb-item-card__badge qb-item-card__badge--product">produto</span>');
    if (!isProduct) {
      badges.push(
        `<span class="qb-item-card__badge qb-item-card__badge--cat">${escapeHtmlText(categoryLabel(it.service_type))}</span>`
      );
    }
    const markup =
      it.markup_percentage != null && Number.isFinite(Number(it.markup_percentage))
        ? ` · ${Number(it.markup_percentage)}% margem`
        : '';
    const card = document.createElement('article');
    card.className = 'qb-item-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('data-item-idx', String(idx));
    card.innerHTML = `
        <div class="qb-item-card__grip" aria-hidden="true" title="Arrastar para reordenar">⋮⋮</div>
        <div class="qb-item-card__body">
          <div class="qb-item-card__top">
            <span class="qb-item-card__name">${escapeHtmlText(name || 'Sem nome')}${badges.join('')}</span>
            <span class="qb-item-card__total">${money(amt)}</span>
          </div>
          ${desc ? `<p class="qb-item-card__desc">— ${escapeHtmlText(desc)}</p>` : ''}
          <p class="qb-item-card__meta">${qty} × ${money(rate)} <span class="text-slate-400">(${escapeHtmlText(unitLabel(it.unit_type))})</span>${markup}</p>
        </div>
        <div class="qb-item-card__actions">
          <button type="button" class="qb-item-card__btn" data-edit="${idx}">Editar</button>
          <button type="button" class="qb-item-card__btn qb-item-card__btn--danger" data-del="${idx}" title="Remover">Remover</button>
        </div>`;
    return card;
  }

  function renderItems() {
    const list = $('itemsList');
    if (!list) return;
    destroyItemSortables();
    list.innerHTML = '';
    updateItemsCountLabel();

    const buckets = { Supply: [], Installation: [], 'Sand & Finishing': [], products: [] };
    items.forEach((it, idx) => {
      if (inlineEditIdx === idx) return;
      if (it.item_type === 'product') buckets.products.push(idx);
      else buckets[normalizeServiceType(it.service_type)].push(idx);
    });

    QB_CATEGORIES.forEach(({ value, label }) => {
      const indices = buckets[value];
      if (!indices.length) return;
      const section = document.createElement('div');
      section.className = 'qb-cat-section';
      section.setAttribute('data-category-value', value);
      const head = document.createElement('div');
      head.className = 'qb-cat-section__head';
      head.textContent = label;
      section.appendChild(head);
      const catList = document.createElement('div');
      catList.className = 'qb-cat-items';
      catList.setAttribute('data-category-value', value);
      indices.forEach((idx) => catList.appendChild(createItemCard(items[idx], idx)));
      section.appendChild(catList);
      list.appendChild(section);
    });

    if (buckets.products.length) {
      const section = document.createElement('div');
      section.className = 'qb-cat-section';
      section.setAttribute('data-category-value', 'products');
      const head = document.createElement('div');
      head.className = 'qb-cat-section__head';
      head.textContent = 'Materials & products';
      section.appendChild(head);
      const catList = document.createElement('div');
      catList.className = 'qb-cat-items';
      catList.setAttribute('data-category-value', 'products');
      buckets.products.forEach((idx) => catList.appendChild(createItemCard(items[idx], idx)));
      section.appendChild(catList);
      list.appendChild(section);
    }

    recalc();
    initItemsSortable();
  }

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

  function isQuoteNumberForPublicUrl(quoteNumber) {
    return /^(?:SF|Q)-\d{4}-\d+$/i.test(String(quoteNumber || '').trim());
  }

  function canonicalPublicQuoteNumber(quoteNumber) {
    const m = String(quoteNumber || '')
      .trim()
      .match(/^(?:SF|Q)-(\d{4})-(\d+)$/i);
    if (!m) return '';
    return `SF-${m[1]}-${String(parseInt(m[2], 10)).padStart(4, '0')}`;
  }

  function publicLinkBaseUrl() {
    const base = (clientPublicCrmUrl || location.origin || '').replace(/\/$/, '');
    return base || location.origin;
  }

  function buildClientPublicQuoteUrl(quoteNumber) {
    const qn = canonicalPublicQuoteNumber(quoteNumber);
    if (!qn) return '';
    return `${publicLinkBaseUrl()}/${encodeURIComponent(qn)}`;
  }

  function setPublicLink(token, quoteNumber) {
    const w = $('publicLinkWrap');
    const a = $('publicLink');
    if (!w || !a) return;
    const qn = quoteNumber != null ? quoteNumber : loadedQuoteNumber;
    const prettyUrl = buildClientPublicQuoteUrl(qn);
    if (prettyUrl) {
      a.href = prettyUrl;
      a.textContent = prettyUrl;
      w.classList.remove('hidden');
      return;
    }
    if (token) {
      a.href = `${location.origin}/quote-public.html?t=${encodeURIComponent(token)}`;
      a.textContent = a.href;
      w.classList.remove('hidden');
      return;
    }
    w.classList.add('hidden');
  }

  let quoteInvoices = [];
  /** @type {{ quote_total: number, invoiced_total: number, remaining_to_invoice: number } | null} */
  let quoteInvoiceBalance = null;

  function isQuoteApprovedStatus(status) {
    return ['approved', 'accepted'].includes(String(status || '').toLowerCase());
  }

  function defaultInvoiceDueDate() {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  }

  function currentQuoteTotalForInvoice() {
    if (quoteInvoiceBalance && Number(quoteInvoiceBalance.quote_total) > 0) {
      return Number(quoteInvoiceBalance.quote_total);
    }
    return Number(recalc().total) || 0;
  }

  function computeLocalInvoiceBalance() {
    const quoteTotal = currentQuoteTotalForInvoice();
    const invoiced = quoteInvoices
      .filter((inv) => String(inv.status || '').toLowerCase() !== 'void')
      .reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
    const invoiced_total = Math.round(invoiced * 100) / 100;
    const remaining_to_invoice = Math.round(Math.max(0, quoteTotal - invoiced_total) * 100) / 100;
    return {
      quote_total: Math.round(quoteTotal * 100) / 100,
      invoiced_total,
      remaining_to_invoice,
    };
  }

  function renderInvoiceBalanceSummary() {
    const bal = quoteInvoiceBalance || computeLocalInvoiceBalance();
    const panel = $('quoteInvoiceBalance');
    const hint = $('invBalanceHint');
    if (!bal || !(bal.quote_total > 0)) {
      if (panel) panel.classList.add('hidden');
      if (hint) hint.classList.add('hidden');
      return bal;
    }
    const text = `Total ${money(bal.quote_total)} · Já faturado ${money(bal.invoiced_total)} · Restante ${money(bal.remaining_to_invoice)}`;
    if (panel) {
      panel.textContent = text;
      panel.classList.toggle('hidden', bal.invoiced_total <= 0 && quoteInvoices.length === 0);
    }
    if (hint) {
      hint.textContent = text;
      hint.classList.remove('hidden');
    }
    return bal;
  }

  function syncInvoiceUiVisibility() {
    const approved = isQuoteApprovedStatus($('status')?.value);
    const panel = $('quoteInvoicesPanel');
    const btnInv = $('btnInvoice');
    if (panel) panel.classList.toggle('hidden', !approved || !quoteId);
    if (btnInv) {
      btnInv.classList.toggle('hidden', !approved);
      btnInv.disabled = !quoteId || !approved;
    }
  }

  async function openInvoicePdf(invoiceId, title) {
    const url = `/api/quote-invoices/${invoiceId}/pdf`;
    const filename = `invoice-${invoiceId}.pdf`;
    if (window.crmPdfViewer?.openFromUrl) {
      await window.crmPdfViewer.openFromUrl(url, { title: title || 'Invoice', filename });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function renderQuoteInvoicesList() {
    const host = $('quoteInvoicesList');
    if (!host) return;
    if (!quoteInvoices.length) {
      host.innerHTML = '<p class="text-xs text-slate-500">Nenhum invoice emitido ainda.</p>';
      return;
    }
    host.innerHTML = quoteInvoices
      .map((inv) => {
        const due = inv.due_date ? String(inv.due_date).slice(0, 10) : '—';
        const status = inv.status || 'issued';
        const paid = Number(inv.paid_amount) || 0;
        const remaining = Number(inv.remaining_amount != null ? inv.remaining_amount : Math.max(0, Number(inv.amount) - paid));
        const payMeta =
          paid > 0.009
            ? ` · pago ${money(paid)}${remaining > 0.009 ? ` · falta ${money(remaining)}` : ''}`
            : '';
        return `<article class="qb-invoice-card" data-invoice-id="${inv.id}">
          <div class="qb-invoice-card__head">
            <span>${escapeHtmlText(inv.invoice_number || `INV-${inv.id}`)}</span>
            <span>${money(inv.amount)}</span>
          </div>
          <div class="qb-invoice-card__meta">${escapeHtmlText(inv.invoice_type || 'payment')} · vence ${escapeHtmlText(due)} · ${escapeHtmlText(status)}${payMeta}</div>
          <div class="qb-invoice-card__actions">
            <button type="button" class="btn btn-sm btn-secondary" data-inv-pdf="${inv.id}">Ver PDF</button>
            <button type="button" class="btn btn-sm btn-ghost" data-inv-email="${inv.id}">Enviar</button>
            ${status !== 'paid' && remaining > 0.009 ? `<button type="button" class="btn btn-sm btn-primary" data-inv-receive="${inv.id}">Receber / recibo</button>` : ''}
            ${status !== 'paid' ? `<button type="button" class="btn btn-sm btn-ghost text-red-600" data-inv-delete="${inv.id}">Apagar</button>` : ''}
          </div>
        </article>`;
      })
      .join('');
    host.querySelectorAll('[data-inv-pdf]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inv = quoteInvoices.find((i) => String(i.id) === btn.dataset.invPdf);
        void openInvoicePdf(btn.dataset.invPdf, inv?.invoice_number ? `Invoice ${inv.invoice_number}` : 'Invoice');
      });
    });
    host.querySelectorAll('[data-inv-email]').forEach((btn) => {
      btn.addEventListener('click', () => void sendQuoteInvoiceEmail(btn.dataset.invEmail));
    });
    host.querySelectorAll('[data-inv-receive]').forEach((btn) => {
      btn.addEventListener('click', () => openReceiptModal(btn.dataset.invReceive));
    });
    host.querySelectorAll('[data-inv-delete]').forEach((btn) => {
      btn.addEventListener('click', () => void deleteQuoteInvoice(btn.dataset.invDelete));
    });
  }

  async function loadQuoteInvoices() {
    if (!quoteId) {
      quoteInvoices = [];
      quoteInvoiceBalance = null;
      renderQuoteInvoicesList();
      renderInvoiceBalanceSummary();
      syncInvoiceUiVisibility();
      return;
    }
    try {
      const r = await api(`/api/quotes/${quoteId}/invoices`);
      quoteInvoices = r.data || [];
      quoteInvoiceBalance = r.balance || null;
    } catch {
      quoteInvoices = [];
      quoteInvoiceBalance = null;
    }
    renderQuoteInvoicesList();
    renderInvoiceBalanceSummary();
    syncInvoiceUiVisibility();
  }

  function openInvoiceModal() {
    const modal = $('qbInvoiceModal');
    if (!modal) return;
    const due = $('invDueDate');
    if (due && !due.value) due.value = defaultInvoiceDueDate();
    const bal = renderInvoiceBalanceSummary() || computeLocalInvoiceBalance();
    const typeEl = $('invType');
    const customEl = $('invCustomAmount');
    if (bal && bal.invoiced_total > 0.009 && bal.remaining_to_invoice > 0.009) {
      if (typeEl) typeEl.value = 'final';
      if (customEl) customEl.value = String(bal.remaining_to_invoice);
    } else if (bal && bal.remaining_to_invoice > 0 && customEl && !customEl.value) {
      customEl.value = String(bal.remaining_to_invoice);
    }
    syncInvoiceTypeFields();
    modal.classList.remove('hidden');
  }

  function closeInvoiceModal() {
    $('qbInvoiceModal')?.classList.add('hidden');
  }

  function syncInvoiceTypeFields() {
    const type = $('invType')?.value || 'deposit';
    $('invDepositWrap')?.classList.toggle('hidden', type !== 'deposit');
    $('invFinalHint')?.classList.toggle('hidden', type !== 'final');
    $('invCustomWrap')?.classList.toggle('hidden', type !== 'progress' && type !== 'custom');
    if (type === 'progress' || type === 'custom') {
      const bal = quoteInvoiceBalance || computeLocalInvoiceBalance();
      const customEl = $('invCustomAmount');
      if (customEl && bal?.remaining_to_invoice > 0 && !customEl.value) {
        customEl.value = String(bal.remaining_to_invoice);
      }
    }
  }

  async function ensureApprovedQuoteSaved() {
    const desired = $('status')?.value;
    if (!isQuoteApprovedStatus(desired)) {
      throw new Error('Só é possível emitir invoice quando o orçamento está aprovado.');
    }
    if (isQuoteApprovedStatus(loadedQuoteStatus)) return;
    await ensureCustomerForQuote();
    const body = payload();
    body.status = desired;
    const r = await api(`/api/quotes/${quoteId}/full`, { method: 'PUT', body: JSON.stringify(body) });
    loadedQuoteStatus = r.data?.quote?.status || desired;
    if (r.data?.quote) {
      loadedQuoteNumber =
        r.data.quote.quote_number != null ? String(r.data.quote.quote_number).trim() : loadedQuoteNumber;
      $('quoteMeta').textContent = `Orçamento ${r.data.quote.quote_number || '#' + r.data.quote.id} · total ${money(r.data.quote.total_amount)}`;
      updatePreviewHeader();
      setPublicLink(r.data.quote.public_token, r.data.quote.quote_number);
    }
  }

  async function submitInvoiceForm(e) {
    e?.preventDefault();
    if (!quoteId) return;
    const type = $('invType')?.value || 'deposit';
    const body = {
      invoice_type: type,
      due_date: $('invDueDate')?.value || null,
      payment_instructions: $('invPaymentInstructions')?.value || null,
      notes: $('invNotes')?.value || null,
    };
    if (type === 'deposit') body.deposit_pct = parseInt($('invDepositPct')?.value, 10) || 50;
    if (type === 'progress' || type === 'custom') {
      body.custom_amount = parseFloat($('invCustomAmount')?.value) || 0;
    }
    /* type === 'final' → servidor calcula o saldo restante */
    const btn = $('btnInvoiceModalSubmit');
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A emitir…';
    }
    try {
      await ensureApprovedQuoteSaved();
      const r = await api(`/api/quotes/${quoteId}/invoices`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closeInvoiceModal();
      if (r.balance) quoteInvoiceBalance = r.balance;
      await loadQuoteInvoices();
      const inv = r.data;
      window.crmToast?.success?.(`Invoice ${inv?.invoice_number || ''} emitido.`);
      if (inv?.id) {
        await openInvoicePdf(inv.id, inv.invoice_number ? `Invoice ${inv.invoice_number}` : 'Invoice');
      }
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao emitir invoice');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Emitir invoice';
      }
    }
  }

  async function sendQuoteInvoiceEmail(invoiceId) {
    if (!invoiceId) return;
    try {
      await api(`/api/quote-invoices/${invoiceId}/send-email`, { method: 'POST', body: '{}' });
      window.crmToast?.success?.('Invoice enviado por e-mail ao cliente.');
      await loadQuoteInvoices();
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao enviar invoice');
    }
  }

  async function markQuoteInvoicePaid(invoiceId) {
    openReceiptModal(invoiceId);
  }

  function openReceiptModal(invoiceId) {
    const modal = $('qbReceiptModal');
    if (!modal || !invoiceId) return;
    const inv = quoteInvoices.find((i) => String(i.id) === String(invoiceId));
    if (!inv) return;
    const remaining =
      inv.remaining_amount != null
        ? Number(inv.remaining_amount)
        : Math.max(0, Number(inv.amount) - (Number(inv.paid_amount) || 0));
    $('rcpInvoiceId').value = String(inv.id);
    $('rcpAmount').value = remaining > 0 ? String(Math.round(remaining * 100) / 100) : '';
    $('rcpPaymentDate').value = new Date().toISOString().slice(0, 10);
    $('rcpMethod').value = 'check';
    $('rcpReference').value = '';
    $('rcpNotes').value = '';
    if ($('rcpSendEmail')) $('rcpSendEmail').checked = true;
    const meta = $('rcpInvoiceMeta');
    if (meta) {
      meta.textContent = `${inv.invoice_number || `INV-${inv.id}`} · total ${money(inv.amount)} · já pago ${money(inv.paid_amount || 0)} · saldo ${money(remaining)}`;
    }
    const hint = $('rcpBalanceHint');
    if (hint) {
      hint.textContent =
        remaining > 0.009
          ? `Pode registar pagamento parcial ou o saldo completo ($${remaining.toFixed(2)}).`
          : 'Invoice sem saldo em aberto.';
    }
    modal.classList.remove('hidden');
    $('rcpAmount')?.focus();
  }

  function closeReceiptModal() {
    $('qbReceiptModal')?.classList.add('hidden');
  }

  async function openReceiptPdf(receiptId, title) {
    const url = `/api/invoice-receipts/${receiptId}/pdf`;
    if (window.crmPdfViewer?.openFromUrl) {
      await window.crmPdfViewer.openFromUrl(url, { title: title || 'Recibo', filename: `receipt-${receiptId}.pdf` });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  async function submitReceiptForm(e) {
    e.preventDefault();
    const invoiceId = $('rcpInvoiceId')?.value;
    if (!invoiceId) return;
    const amount = parseFloat($('rcpAmount')?.value);
    if (!(amount > 0)) {
      window.crmToast?.error?.('Indique o valor recebido.');
      return;
    }
    const btn = $('btnReceiptModalSubmit');
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A processar…';
    }
    try {
      const body = {
        amount,
        payment_date: $('rcpPaymentDate')?.value || undefined,
        payment_method: $('rcpMethod')?.value || 'check',
        reference_number: $('rcpReference')?.value || undefined,
        notes: $('rcpNotes')?.value || undefined,
        send_email: !!$('rcpSendEmail')?.checked,
      };
      const r = await api(`/api/quote-invoices/${invoiceId}/receipts`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closeReceiptModal();
      const paidNote = r.invoice_paid ? ' Invoice liquidado.' : '';
      const emailNote =
        r.email && r.email.ok === false
          ? ` Recibo criado, mas e-mail falhou: ${r.email.error || 'erro'}.`
          : r.email && r.email.ok
            ? ' Recibo enviado por e-mail.'
            : '';
      window.crmToast?.success?.(
        `Recibo ${r.data?.receipt_number || ''} · ${money(r.data?.amount)}.${paidNote}${emailNote}`
      );
      await loadQuoteInvoices();
      if (r.data?.id) {
        void openReceiptPdf(r.data.id, r.data.receipt_number ? `Recibo ${r.data.receipt_number}` : 'Recibo');
      }
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao gerar recibo');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Gerar recibo e dar baixa';
      }
    }
  }

  async function deleteQuoteInvoice(invoiceId) {
    if (!invoiceId) return;
    const inv = quoteInvoices.find((i) => String(i.id) === String(invoiceId));
    const label = inv?.invoice_number || `INV-${invoiceId}`;
    if (!confirm(`Apagar o invoice ${label}? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/quote-invoices/${invoiceId}`, { method: 'DELETE' });
      window.crmToast?.success?.(`Invoice ${label} apagado.`);
      await loadQuoteInvoices();
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao apagar invoice');
    }
  }

  let ownerSignaturePad = null;

  function createOwnerSignaturePad() {
    const canvas = $('ownerSignCanvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasStroke = false;
    ctx.strokeStyle = '#1a2036';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    const pointerPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const pt = e.touches ? e.touches[0] : e;
      return { x: (pt.clientX - rect.left) * scaleX, y: (pt.clientY - rect.top) * scaleY };
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

  function debounceOwnerSig(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function syncOwnerSignatureFromName() {
    if (!$('ownerSignAutoDefault')?.checked) return;
    const name = $('ownerSignName')?.value?.trim() || '';
    if (!ownerSignaturePad) ownerSignaturePad = createOwnerSignaturePad();
    if (!ownerSignaturePad) return;
    if (name.length >= 2) ownerSignaturePad.renderFromName(name);
    else ownerSignaturePad.clear();
  }

  async function loadOwnerSignatureSettings() {
    try {
      const r = await api('/api/quotes/settings/owner-signature');
      const d = r.data || {};
      const nameEl = $('ownerSignName');
      const titleEl = $('ownerSignTitle');
      const autoEl = $('ownerSignAutoDefault');
      if (nameEl && d.name) nameEl.value = d.name;
      if (titleEl && d.title) titleEl.value = d.title;
      if (autoEl) autoEl.checked = d.use_auto_signature !== false;
      if (nameEl?.value && (d.use_auto_signature !== false) && !d.has_signature) {
        syncOwnerSignatureFromName();
      }
      const preview = $('ownerSignPreview');
      if (preview && d.has_signature && d.image_url) {
        preview.src = `${d.image_url}?t=${Date.now()}`;
        preview.classList.remove('hidden');
      } else if (preview) {
        preview.classList.add('hidden');
        preview.removeAttribute('src');
      }
      const meta = $('ownerSignSavedMeta');
      if (meta) {
        if (d.has_signature) {
          const parts = [d.name, d.title].filter(Boolean);
          meta.textContent = parts.length
            ? `Padrão ativo: ${parts.join(' · ')}`
            : 'Assinatura padrão guardada para todos os orçamentos.';
          meta.classList.remove('hidden');
        } else {
          meta.classList.add('hidden');
          meta.textContent = '';
        }
      }
    } catch {
      /* optional */
    }
  }

  async function saveOwnerSignature() {
    const name = $('ownerSignName')?.value?.trim() || '';
    const title = $('ownerSignTitle')?.value?.trim() || '';
    const useAuto = !!$('ownerSignAutoDefault')?.checked;
    if (!name || name.length < 2) {
      qbToast('Indique o nome antes de guardar.', 'error');
      return;
    }
    if (!title || title.length < 2) {
      qbToast('Indique o cargo antes de guardar.', 'error');
      return;
    }
    if (!ownerSignaturePad) ownerSignaturePad = createOwnerSignaturePad();
    if (useAuto && ownerSignaturePad.isEmpty()) ownerSignaturePad.renderFromName(name);
    if (!ownerSignaturePad || ownerSignaturePad.isEmpty()) {
      qbToast('Não foi possível gerar a assinatura.', 'error');
      return;
    }
    const btn = $('btnOwnerSignSave');
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A guardar…';
    }
    try {
      await api('/api/quotes/settings/owner-signature', {
        method: 'PUT',
        body: JSON.stringify({
          name,
          title,
          use_auto_signature: useAuto,
          signature_png: ownerSignaturePad.toDataURL(),
        }),
      });
      qbToast('Assinatura padrão guardada para todos os orçamentos.', 'success');
      ownerSignaturePad.clear();
      await loadOwnerSignatureSettings();
    } catch (err) {
      qbToast(err.message || 'Erro ao guardar assinatura', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Guardar assinatura padrão';
      }
    }
  }

  function renderClientSignaturePanel(q) {
    const panel = $('qbClientSignaturePanel');
    if (!panel) return;
    const approved = isQuoteApprovedStatus(q?.status);
    const hasSig = !!(q?.has_client_signature || q?.client_signed_name);
    if (!approved || !hasSig) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    const img = $('clientSignPreview');
    if (img && q.client_signature_url) {
      img.src = `${q.client_signature_url}?t=${Date.now()}`;
      img.classList.remove('hidden');
    }
    const meta = $('clientSignMeta');
    if (meta) {
      const who = q.client_signed_name || 'Cliente';
      const when = q.approved_at ? String(q.approved_at).slice(0, 10) : '—';
      meta.textContent = `${who} · ${when}`;
    }
  }

  function wireOwnerSignatureUi() {
    ownerSignaturePad = createOwnerSignaturePad();
    $('btnOwnerSignClear')?.addEventListener('click', () => ownerSignaturePad?.clear());
    $('btnOwnerSignSave')?.addEventListener('click', () => void saveOwnerSignature());
    $('ownerSignName')?.addEventListener('input', debounceOwnerSig(syncOwnerSignatureFromName, 250));
    $('ownerSignAutoDefault')?.addEventListener('change', () => {
      if ($('ownerSignAutoDefault')?.checked) syncOwnerSignatureFromName();
    });
  }

  function wireInvoiceUi() {
    $('btnInvoice')?.addEventListener('click', openInvoiceModal);
    $('btnOpenInvoiceModal')?.addEventListener('click', openInvoiceModal);
    $('btnInvoiceModalCancel')?.addEventListener('click', closeInvoiceModal);
    $('qbInvoiceForm')?.addEventListener('submit', submitInvoiceForm);
    $('invType')?.addEventListener('change', syncInvoiceTypeFields);
    $('qbInvoiceModal')?.addEventListener('click', (e) => {
      if (e.target === $('qbInvoiceModal')) closeInvoiceModal();
    });
    $('btnReceiptModalCancel')?.addEventListener('click', closeReceiptModal);
    $('qbReceiptForm')?.addEventListener('submit', submitReceiptForm);
    $('qbReceiptModal')?.addEventListener('click', (e) => {
      if (e.target === $('qbReceiptModal')) closeReceiptModal();
    });
    $('status')?.addEventListener('change', () => {
      syncInvoiceUiVisibility();
    });
  }

  function enableActions() {
    $('btnPdf').disabled = !quoteId;
    const btnSend = $('btnSend');
    if (btnSend) btnSend.disabled = !quoteId;
    $('btnDup').disabled = !quoteId;
    syncInvoiceUiVisibility();
    if (!quoteId) {
      updateEmailSentBadge(null);
      updateQuoteViewedBadge(null);
      updatePdfViewedBadge(null);
      stopQuoteViewPolling();
    }
  }

  async function loadQuote(id) {
    const r = await api(`/api/quotes/${id}`);
    const q = r.data;
    if (!q) return;
    quoteId = q.id;
    loadedQuoteLeadId = q.lead_id != null && q.lead_id !== '' ? Number(q.lead_id) : null;
    if (!Number.isFinite(loadedQuoteLeadId)) loadedQuoteLeadId = null;
    $('customerId').value = q.customer_id || '';
    if ($('quoteJobName')) $('quoteJobName').value = q.job_name || '';
    if ($('quoteJobAddress')) $('quoteJobAddress').value = q.job_address || '';
    await loadQuoteBuilders();
    const isBuilderQuote =
      String(q.quote_party || '') === 'builder' || (q.builder_id != null && Number(q.builder_id) > 0);
    if (isBuilderQuote) {
      setQuoteParty('builder', { applyPrices: false });
      const bid = Number(q.builder_id);
      const b = quoteBuilders.find((x) => Number(x.id) === bid) || (bid ? { id: bid, customer_id: q.customer_id } : null);
      if (b) applySelectedBuilder(b, { applyPrices: false });
      setCatalogPricingMode('builder');
    } else {
      setQuoteParty('lead', { applyPrices: false });
      applySelectedBuilder(null, { applyPrices: false });
      await setClientSearchFromLoadedQuote(q);
      setCatalogPricingMode('customer');
    }
    const qStatus = q.status || 'draft';
    $('status').value = qStatus;
    loadedQuoteStatus = qStatus;
    $('expirationDate').value = q.expiration_date ? String(q.expiration_date).slice(0, 10) : '';
    $('notes').value = q.notes || '';
    $('terms').value = q.terms_conditions || '';
    $('discountType').value = q.discount_type || 'percentage';
    $('discountValue').value = q.discount_value ?? 0;
    $('taxTotal').value = q.tax_total ?? 0;
    items = (q.items || []).map((it) => ({
      item_type: it.item_type || 'service',
      name: it.name != null ? String(it.name) : '',
      description: it.description != null ? String(it.description) : '',
      unit_type: it.unit_type || 'sq_ft',
      quantity: it.quantity,
      rate: it.rate,
      notes: it.notes,
      service_type: it.item_type === 'product' ? null : normalizeServiceType(it.service_type),
      catalog_customer_notes: it.catalog_customer_notes || null,
      service_catalog_id: normalizeCatalogId(it.service_catalog_id),
      product_id: it.product_id != null ? Number(it.product_id) : null,
      cost_price: it.cost_price != null ? Number(it.cost_price) : null,
      markup_percentage: it.markup_percentage != null ? Number(it.markup_percentage) : null,
      sell_price: it.sell_price != null ? Number(it.sell_price) : null,
      estimateAuto: false,
    }));
    loadedQuoteNumber = q.quote_number != null ? String(q.quote_number).trim() : null;
    $('quoteMeta').textContent = `Orçamento ${q.quote_number || '#' + q.id} · total ${money(q.total_amount)}`;
    updateEmailSentBadge(q.email_sent_at || null);
    quoteViewNotifyShown = !!q.viewed_at;
    quotePdfNotifyShown = !!q.pdf_viewed_at;
    updateQuoteViewedBadge(q.viewed_at || null, { keepNotifyFlag: true });
    updatePdfViewedBadge(q.pdf_viewed_at || null, { keepNotifyFlag: true });
    startQuoteViewPolling();
    updatePreviewHeader();
    renderClientDetails();
    setPublicLink(q.public_token, q.quote_number);
    enableActions();
    if (getQuoteParty() === 'builder') {
      setCatalogPricingMode('builder');
      refreshRatesForCatalogLines();
    } else {
      applyPricingFromCustomerId($('customerId').value);
    }
    renderItems();
    renderClientSignaturePanel(q);
    await loadQuoteInvoices();
  }

  function payload() {
    const { sub, tax } = recalc();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    const party = getQuoteParty();
    let lead_id = null;
    if (party === 'lead') {
      if (selectedQuoteLead && selectedQuoteLead.id != null) lead_id = Number(selectedQuoteLead.id);
      else if (loadedQuoteLeadId != null && Number.isFinite(loadedQuoteLeadId)) lead_id = loadedQuoteLeadId;
      else if (pendingLeadId != null && Number.isFinite(pendingLeadId)) lead_id = pendingLeadId;
    }
    const builder_id =
      party === 'builder' ? parseInt($('quoteBuilderSelect')?.value, 10) || null : null;
    const jobName = party === 'builder' ? String($('quoteJobName')?.value || '').trim() : '';
    const jobAddr = party === 'builder' ? String($('quoteJobAddress')?.value || '').trim() : '';
    const base = {
      customer_id: parseInt($('customerId').value, 10) || null,
      quote_party: party,
      builder_id: Number.isFinite(builder_id) && builder_id > 0 ? builder_id : null,
      job_name: jobName || null,
      job_address: jobAddr || null,
      status: $('status').value,
      expiration_date: $('expirationDate').value || null,
      notes: $('notes').value || null,
      terms_conditions: $('terms').value || null,
      discount_type: dt,
      discount_value: dv,
      tax_total: tax,
      subtotal: sub,
      items: items.map((it) => ({
        item_type: it.item_type || 'service',
        name: it.name != null && String(it.name).trim() ? String(it.name).trim() : null,
        description: it.description != null && String(it.description).trim() ? String(it.description).trim() : null,
        unit_type: it.unit_type || 'sq_ft',
        quantity: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
        notes: it.notes || null,
        service_type: it.item_type === 'product' ? null : normalizeServiceType(it.service_type),
        catalog_customer_notes: it.catalog_customer_notes || null,
        service_catalog_id: normalizeCatalogId(it.service_catalog_id),
        product_id: it.product_id != null ? Number(it.product_id) : null,
        cost_price: it.cost_price != null ? Number(it.cost_price) : null,
        markup_percentage: it.markup_percentage != null ? Number(it.markup_percentage) : null,
        sell_price: it.sell_price != null ? Number(it.sell_price) : Number(it.rate) || null,
      })),
    };
    if (lead_id != null) base.lead_id = lead_id;
    else base.lead_id = null;
    return base;
  }

  async function saveQuote() {
    let cid;
    try {
      cid = await ensureCustomerForQuote();
    } catch (e) {
      qbToast(e.message || 'Selecione um lead ou um builder.', 'error');
      return;
    }
    if (getQuoteParty() === 'lead' && !cid) {
      qbToast('Selecione um cliente (lead).', 'error');
      return;
    }
    const body = payload();
    try {
      if (quoteId) {
        const r = await api(`/api/quotes/${quoteId}/full`, { method: 'PUT', body: JSON.stringify(body) });
        if (r.data && r.data.quote) {
          loadedQuoteStatus = r.data.quote.status || body.status || loadedQuoteStatus;
          loadedQuoteNumber =
            r.data.quote.quote_number != null ? String(r.data.quote.quote_number).trim() : null;
          $('quoteMeta').textContent = `Orçamento ${r.data.quote.quote_number || '#' + r.data.quote.id} · total ${money(r.data.quote.total_amount)}`;
          updatePreviewHeader();
          setPublicLink(r.data.quote.public_token, r.data.quote.quote_number);
        }
      } else {
        const r = await api('/api/quotes/full', { method: 'POST', body: JSON.stringify(body) });
        quoteId = r.data.quote.id;
        const lid = pendingLeadId != null && Number.isFinite(pendingLeadId) ? pendingLeadId : null;
        history.replaceState(
          {},
          '',
          lid ? `?id=${quoteId}&lead_id=${lid}` : `?id=${quoteId}`
        );
        await loadQuote(quoteId);
      }
      qbToast('Guardado.', 'success');
      enableActions();
      await loadQuoteInvoices();
    } catch (e) {
      qbToast(e.message || 'Erro ao guardar', 'error');
    }
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      $('authMsg').textContent = 'É necessária sessão — inicie sessão no CRM primeiro.';
      $('authMsg').classList.remove('hidden');
      return;
    }

    const [custRes, catRes, tplRes, uiRes] = await Promise.all([
      api('/api/customers?limit=100'),
      api('/api/quote-catalog').catch(() => ({ data: [] })),
      api('/api/quote-templates').catch(() => ({ data: [] })),
      fetch('/api/config/ui', { credentials: 'include' })
        .then((r) => r.json())
        .catch(() => ({})),
    ]);
    clients = custRes.data || [];
    catalog = catRes.data || [];
    templates = tplRes.data || [];
    if (uiRes.success && uiRes.data && uiRes.data.publicCrmUrl) {
      clientPublicCrmUrl = String(uiRes.data.publicCrmUrl).replace(/\/$/, '');
    }

    wireClientLeadSearch();
    attachItemsListHandlers();
    wireMarginPricingFields();
    bootQuoteAddressAutocomplete();
    await loadQuoteBuilders();
    $('qbPartyLead')?.addEventListener('click', () => setQuoteParty('lead'));
    $('qbPartyBuilder')?.addEventListener('click', () => {
      setQuoteParty('builder');
      void loadQuoteBuilders();
    });
    $('quoteBuilderSelect')?.addEventListener('change', onQuoteBuilderChange);

    const builderEmailChips = $('qbBuilderEmailChips');
    if (builderEmailChips) {
      builderEmailChips.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-email]');
        if (!btn) return;
        removeBuilderExtraEmail(btn.getAttribute('data-remove-email'));
      });
    }
    const builderExtraInput = $('qbBuilderExtraEmailInput');
    if (builderExtraInput) {
      builderExtraInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          tryCommitBuilderExtraEmailInput();
        } else if (e.key === 'Backspace' && !String(builderExtraInput.value || '') && builderExtraEmails.length) {
          removeBuilderExtraEmail(builderExtraEmails.length - 1);
        }
      });
      builderExtraInput.addEventListener('blur', () => tryCommitBuilderExtraEmailInput());
      builderExtraInput.addEventListener('paste', () => {
        setTimeout(() => tryCommitBuilderExtraEmailInput(), 0);
      });
    }
    renderBuilderExtraEmailChips();
    syncQuotePartyUi();
    updatePricingActiveLabel();

    const ts = $('templateSelect');
    ts.innerHTML = '<option value="">— Template —</option>';
    templates.forEach((t) => {
      ts.innerHTML += `<option value="${t.id}">${escapeAttr(t.name)}</option>`;
    });

    const params = new URLSearchParams(location.search);
    const qid = params.get('id');
    const leadParam = params.get('lead_id');
    if (leadParam) {
      const n = parseInt(leadParam, 10);
      if (Number.isFinite(n) && n > 0) pendingLeadId = n;
    }
    if (qid) {
      await loadQuote(parseInt(qid, 10));
    } else {
      items = [];
      loadedQuoteLeadId = null;
      loadedQuoteNumber = null;
      quoteId = null;
      $('quoteMeta').textContent = 'Novo orçamento';
      updatePreviewHeader();
      renderClientDetails();
      updateClientActionButtons();
      setPublicLink(null);
      enableActions();
      renderItems();
    }

    updateClientActionButtons();

    if (pendingLeadId != null && Number.isFinite(pendingLeadId)) {
      const alreadyBound =
        (selectedQuoteLead && Number(selectedQuoteLead.id) === pendingLeadId) ||
        (loadedQuoteLeadId != null && Number(loadedQuoteLeadId) === pendingLeadId);
      if (!alreadyBound || !selectedQuoteLead) {
        try {
          const lr = await fetch(`/api/leads/${pendingLeadId}`, { credentials: 'include' }).then((r) =>
            r.json()
          );
          if (lr.success && lr.data) await selectLeadAsClient(lr.data);
        } catch (_) {
          /* ignore */
        }
      }
    }

    const addItemPanel = $('addItemPanel');
    const modalServiceName = $('modalServiceName');
    const modalServiceResults = $('modalServiceResults');
    const modalServiceWrap = $('modalServiceSearchWrap');

    if (modalServiceName) {
      modalServiceName.setAttribute('role', 'combobox');
      modalServiceName.setAttribute('aria-autocomplete', 'list');
      modalServiceName.setAttribute('aria-expanded', 'false');
      modalServiceName.setAttribute('aria-controls', 'modalServiceResults');
      wireServiceNameKeyboardScroll();
      modalServiceName.addEventListener('focus', () => {
        scheduleModalServiceSearch();
        ensureServiceNameVisibleForKeyboard();
      });
      modalServiceName.addEventListener('blur', () => {
        clearServiceFieldScrollTimers();
      });
      modalServiceName.addEventListener('input', () => {
        if (qbSuppressServiceNameInput) return;
        modalSelectedCatalogRow = null;
        modalServiceActiveIndex = -1;
        scheduleModalServiceSearch();
        scrollServiceNameIntoView({ force: true });
      });
      modalServiceName.addEventListener('keydown', handleModalServiceNameKeydown);
      modalServiceName.addEventListener('touchstart', () => {
        // Prepara scroll antes do teclado no iPad
        setTimeout(() => ensureServiceNameVisibleForKeyboard(), 50);
      }, { passive: true });
    }
    const qtyEl = $('modalServiceQty');
    if (qtyEl) {
      selectAllOnFocus(qtyEl);
      qtyEl.addEventListener('input', updateInlineItemTotal);
      qtyEl.addEventListener('keydown', handleServiceFormEnter);
    }
    const baseRateEl = $('modalServiceRate');
    if (baseRateEl) baseRateEl.addEventListener('keydown', handleServiceFormEnter);
    $('modalServiceDesc')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        confirmAddServiceLine();
      }
    });

    $('btnAddClientManual')?.addEventListener('click', () => {
      hideClientForms();
      $('qbClientManualForm')?.classList.remove('hidden');
      bootQuoteAddressAutocomplete();
      $('manualClientName')?.focus();
    });
    $('btnManualClientCancel')?.addEventListener('click', hideClientForms);
    $('btnManualClientSave')?.addEventListener('click', () => void createManualClient());
    $('btnEditClient')?.addEventListener('click', () => void openClientEditForm());
    $('btnEditClientCancel')?.addEventListener('click', hideClientForms);
    $('btnEditClientSave')?.addEventListener('click', () => void saveClientEdits());

    if (modalServiceResults) {
      modalServiceResults.setAttribute('role', 'listbox');
      modalServiceResults.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-catalog-id]');
        if (!btn) return;
        const cid = parseInt(btn.getAttribute('data-catalog-id'), 10);
        const row = catalog.find((c) => Number(c.id) === cid);
        if (row) applyCatalogRowToServiceModal(row);
      });
      modalServiceResults.addEventListener('mousemove', (e) => {
        const btn = e.target.closest('[data-catalog-id]');
        if (!btn || !modalServiceResults.contains(btn)) return;
        const items = Array.from(modalServiceResults.querySelectorAll('[data-catalog-id]'));
        const idx = items.indexOf(btn);
        if (idx >= 0 && idx !== modalServiceActiveIndex) {
          modalServiceActiveIndex = idx;
          syncModalServiceActiveHighlight();
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (!addItemPanel || addItemPanel.classList.contains('hidden')) return;
      if (!modalServiceWrap || modalServiceWrap.contains(e.target)) return;
      hideModalServiceResults();
    });

    $('modalConfirmService').addEventListener('click', confirmAddServiceLine);
    $('modalCancel').addEventListener('click', closeAddItemPanel);
    $('btnAddLine').addEventListener('click', () => openAddItemPanel(-1));
    const btnSqft = $('btnApplySqftToLines');
    if (btnSqft) btnSqft.addEventListener('click', () => applyProjectSqftToAllSqFtLines());
    const sqftIn = $('quoteProjectSqft');
    if (sqftIn) {
      sqftIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyProjectSqftToAllSqFtLines();
        }
      });
    }
    $('discountType').addEventListener('change', () => recalc());
    $('discountValue').addEventListener('input', () => recalc());
    const taxIn = $('taxTotal');
    if (taxIn) {
      wireMoneyField(taxIn);
      taxIn.addEventListener('input', () => recalc());
    }
    const expIn = $('expirationDate');
    if (expIn) expIn.addEventListener('change', updatePreviewHeader);

    document.querySelectorAll('input[name="pricingCatalog"]').forEach((el) => {
      el.addEventListener('change', () => {
        refreshRatesForCatalogLines();
        renderItems();
      });
    });
    $('btnApplyTemplate').addEventListener('click', async () => {
      const tid = parseInt($('templateSelect').value, 10);
      if (!tid) return;
      const r = await api(`/api/quote-templates/${tid}`);
      const t = r.data;
      items = (t.items || []).map((x) => {
        const { name: tplName, description: tplDesc } = unpackTemplateLine(x);
        return {
          item_type: x.item_type || 'service',
          name: tplName,
          description: tplDesc,
          unit_type: x.unit_type || 'sq_ft',
          quantity: Number(x.quantity) || 1,
          rate: Number(x.rate) || 0,
          notes: x.notes,
          service_type: x.item_type === 'product' ? null : normalizeServiceType(x.service_type),
          catalog_customer_notes: x.catalog_customer_notes || null,
          service_catalog_id: normalizeCatalogId(x.service_catalog_id),
          product_id: x.product_id != null ? Number(x.product_id) : null,
          cost_price: x.cost_price != null ? Number(x.cost_price) : null,
          markup_percentage: x.markup_percentage != null ? Number(x.markup_percentage) : null,
          sell_price: x.sell_price != null ? Number(x.sell_price) : null,
          estimateAuto: false,
        };
      });
      renderItems();
    });

    $('btnSave').addEventListener('click', saveQuote);
    $('btnPdf').addEventListener('click', async () => {
      if (!quoteId) return;
      const btn = $('btnPdf');
      const prevLabel = btn?.textContent || 'Gerar PDF';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'A gerar…';
      }
      try {
        await api(`/api/quotes/${quoteId}/generate-pdf`, { method: 'POST', body: '{}' });
        const title = loadedQuoteNumber ? `Orçamento ${loadedQuoteNumber}` : 'Orçamento';
        const filename = loadedQuoteNumber
          ? `orcamento-${String(loadedQuoteNumber).replace(/[^\w-]+/g, '-')}.pdf`
          : `orcamento-${quoteId}.pdf`;
        if (window.crmPdfViewer?.openFromUrl) {
          await window.crmPdfViewer.openFromUrl(`/api/quotes/${quoteId}/invoice-pdf`, { title, filename });
        } else {
          window.open(`/api/quotes/${quoteId}/invoice-pdf`, '_blank', 'noopener');
        }
      } catch (e) {
        window.crmToast?.error?.(e.message || 'Erro ao gerar PDF');
      } finally {
        if (btn) {
          btn.disabled = !quoteId;
          btn.textContent = prevLabel;
        }
      }
    });
    wireQuoteNotify();
    wireInvoiceUi();
    wireOwnerSignatureUi();
    await loadOwnerSignatureSettings();
    const ownerNameEl = $('ownerSignName');
    if (ownerNameEl && !ownerNameEl.value.trim() && sess.user?.name) {
      ownerNameEl.value = String(sess.user.name).trim();
      syncOwnerSignatureFromName();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void pollQuoteViewed();
    });

    $('btnSend')?.addEventListener('click', () => {
      if (!quoteId) return;
      toggleQuoteSendMenu();
    });
    $('quoteSendByEmail')?.addEventListener('click', () => void sendQuoteByEmail());
    $('quoteSendBySms')?.addEventListener('click', () => void sendQuoteByMessage());
    $('btnDup').addEventListener('click', async () => {
      if (!quoteId) return;
      const r = await api(`/api/quotes/${quoteId}/duplicate`, { method: 'POST', body: '{}' });
      const d = r.data;
      if (d && d.quote) {
        location.href = 'quote-builder.html?id=' + d.quote.id;
      }
    });

    wireProjectEstimateRules();

    $('btnSaveTpl').addEventListener('click', async () => {
      const name = prompt('Template name?');
      if (!name) return;
      const body = {
        name,
        items: items.map((it) => ({
          item_type: it.item_type || 'service',
          name: it.name != null && String(it.name).trim() ? String(it.name).trim() : null,
          description: it.description != null && String(it.description).trim() ? String(it.description).trim() : null,
          unit_type: it.unit_type,
          quantity: it.quantity,
          rate: it.rate,
          notes: it.notes,
          service_type: it.service_type,
          catalog_customer_notes: it.catalog_customer_notes,
          service_catalog_id: normalizeCatalogId(it.service_catalog_id),
          product_id: it.product_id,
          cost_price: it.cost_price,
          markup_percentage: it.markup_percentage,
          sell_price: it.sell_price,
        })),
      };
      try {
        await api('/api/quote-templates', { method: 'POST', body: JSON.stringify(body) });
        qbToast('Template guardado.', 'success');
      } catch (e) {
        qbToast(e.message || 'Erro ao guardar template', 'error');
      }
    });
  }

  init().catch((e) => {
    $('authMsg').textContent = e.message;
    $('authMsg').classList.remove('hidden');
  });
})();
