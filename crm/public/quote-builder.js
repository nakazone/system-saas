/* global fetch */
(function () {
  const $ = (id) => document.getElementById(id);
  let quoteId = null;
  /** Número legível do orçamento (ex. OM-2026-001; aceita legado SF-/Q-). */
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
  /** @type {'lead'|'builder'|'contractor'|'loja'} */
  let quotePartyMode = 'lead';
  /** Builder selecionado no quote. */
  let selectedQuoteBuilder = null;
  /** Cliente org (contract/loja/particular) selecionado. */
  let selectedOrgCustomer = null;
  /** E-mails CC adicionais no envio para builders. */
  let builderExtraEmails = [];
  /** Lead escolhido na pesquisa de cliente. */
  let selectedQuoteLead = null;
  let clientSearchTimer = null;
  let orgCustomerSearchTimer = null;
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

  /** Map Tabela de Valores keys/labels (and quote service_type) → QB category values. */
  function normalizeServiceType(st) {
    const s = String(st || '').trim();
    if (!s) return 'Installation';
    const lower = s
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      lower === 'supply' ||
      lower.includes('supply') ||
      lower.includes('fornec') ||
      lower.includes('material')
    ) {
      return 'Supply';
    }
    if (
      lower === 'sand finish' ||
      lower === 'sand finishing' ||
      lower === 'sandfinish' ||
      lower.includes('sand') ||
      lower.includes('lix') ||
      lower.includes('acab') ||
      (lower.includes('finish') && !lower.includes('install'))
    ) {
      return 'Sand & Finishing';
    }
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
    if (selectedQuoteLead && selectedQuoteLead.id != null) return selectedQuoteLead.id;
    if (loadedQuoteLeadId != null && loadedQuoteLeadId !== '') return loadedQuoteLeadId;
    if (pendingLeadId != null && pendingLeadId !== '') return pendingLeadId;
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
    if (!lead || !sameId(lead.id, lid)) {
      try {
        const lr = await fetch(`/api/leads/${encodeURIComponent(lid)}`, { credentials: 'include' }).then((r) => r.json());
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
      const cid = String($('customerId')?.value || '').trim();
      if (cid) {
        await fetch(`/api/customers/${encodeURIComponent(cid)}`, {
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
        errEl.textContent = e.message || 'Erro ao salvar.';
        errEl.classList.remove('hidden');
      } else qbToast(e.message || 'Erro ao salvar.', 'error');
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
        errEl.textContent = 'Preencha nome, e-mail, telefone e CEP (5 dígitos).';
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

  /** Contexto ao editar preço inline (focus → blur). */
  let inlineRateEditCtx = null;
  let rateSavePending = null;

  let descSavePending = null;
  /** Queued after rate modal so both prompts can run in sequence. */
  let pendingDescOffer = null;

  function flushPendingDescOffer() {
    const next = pendingDescOffer;
    pendingDescOffer = null;
    if (next) {
      setTimeout(() => maybeOfferDescPersist(next), 50);
    }
  }

  function closeSaveRateModal() {
    const root = $('qbSaveRateModal');
    if (root) root.classList.add('hidden');
    rateSavePending = null;
    flushPendingDescOffer();
  }

  function openSaveRateModal(payload) {
    const root = $('qbSaveRateModal');
    if (!root) return;
    rateSavePending = payload;
    const nameEl = $('qbSaveRateServiceName');
    const oldEl = $('qbSaveRateOld');
    const newEl = $('qbSaveRateNew');
    const typeEl = $('qbSaveRateTypeLabel');
    const clientBtn = $('qbSaveRateClient');
    const clientHint = $('qbSaveRateClientHint');
    if (nameEl) nameEl.textContent = payload.serviceName || 'Serviço';
    if (oldEl) oldEl.textContent = money(payload.tableRate);
    if (newEl) newEl.textContent = money(payload.newRate);
    if (typeEl) typeEl.textContent = pricingTypeLabel(payload.src);
    const noCustomer = !payload.customer || payload.customer.id == null;
    if (clientBtn) {
      clientBtn.disabled = noCustomer;
      clientBtn.classList.toggle('opacity-50', noCustomer);
    }
    if (clientHint) clientHint.classList.toggle('hidden', !noCustomer);
    root.classList.remove('hidden');
  }

  function maybeOfferRatePersist(opts) {
    const modalOpen = $('qbSaveRateModal') && !$('qbSaveRateModal').classList.contains('hidden');
    if (modalOpen) return;
    const it = items[opts.itemIdx];
    if (!it) return;
    const row = opts.row || catalogRowForItem(it);
    const pricingItemId = opts.pricingItemId || catalogPricingItemId(row);
    if (!pricingItemId) return;
    const src = opts.src || catalogPricingSource();
    const tableRate = opts.tableRate != null ? Number(opts.tableRate) : systemRateForCatalogRow(row, src);
    const newRate = Number(opts.newRate);
    if (!Number.isFinite(newRate) || newRate < 0) return;
    if (ratesNearlyEqual(newRate, tableRate)) return;
    const customer = getQuoteCustomerRecord();
    openSaveRateModal({
      itemIdx: opts.itemIdx,
      serviceName: it.name || (row && row.name) || '',
      newRate,
      tableRate,
      pricingItemId,
      src,
      row,
      customer,
    });
  }

  function catalogDescriptionForRow(row) {
    if (!row) return '';
    return String(row.default_description || row.notes_customer || row.notes || '').trim();
  }

  function normalizeDescText(s) {
    return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
  }

  function descriptionBodyWithoutTitle(name, description) {
    if (typeof window.sfDescriptionBodyWithoutTitle === 'function') {
      return window.sfDescriptionBodyWithoutTitle(name, description);
    }
    const n = String(name || '').trim();
    let desc = String(description || '').trim();
    if (!desc) return '';
    if (!n) return desc;
    if (desc === n) return '';
    const nLower = n.toLowerCase();
    const lines = desc.split(/\n/);
    if (lines[0] && lines[0].trim().toLowerCase() === nLower) {
      desc = lines.slice(1).join('\n').trim();
    }
    while (desc && desc.toLowerCase().startsWith(nLower)) {
      desc = desc.slice(n.length).replace(/^[\s—–:·.\-]+/, '').trim();
    }
    return desc;
  }

  function formatRichHtml(s) {
    if (typeof window.sfFormatRichTextHtml === 'function') {
      return window.sfFormatRichTextHtml(s);
    }
    return escapeHtmlText(s);
  }

  function closeSaveDescModal() {
    const root = $('qbSaveDescModal');
    if (root) root.classList.add('hidden');
    descSavePending = null;
  }

  function openSaveDescModal(payload) {
    const root = $('qbSaveDescModal');
    if (!root) return;
    descSavePending = payload;
    const nameEl = $('qbSaveDescServiceName');
    const oldEl = $('qbSaveDescOld');
    const newEl = $('qbSaveDescNew');
    if (nameEl) nameEl.textContent = payload.serviceName || 'Serviço';
    if (oldEl) {
      const oldTxt = payload.tableDesc || '(sem descrição)';
      oldEl.textContent = oldTxt.length > 160 ? `${oldTxt.slice(0, 157)}…` : oldTxt;
    }
    if (newEl) {
      const newTxt = payload.newDesc || '(vazia)';
      newEl.textContent = newTxt.length > 160 ? `${newTxt.slice(0, 157)}…` : newTxt;
    }
    root.classList.remove('hidden');
  }

  function maybeOfferDescPersist(opts) {
    const rateOpen = $('qbSaveRateModal') && !$('qbSaveRateModal').classList.contains('hidden');
    if (rateOpen) {
      pendingDescOffer = opts;
      return;
    }
    const descOpen = $('qbSaveDescModal') && !$('qbSaveDescModal').classList.contains('hidden');
    if (descOpen) return;
    const it = items[opts.itemIdx];
    if (!it) return;
    const row = opts.row || catalogRowForItem(it);
    const pricingItemId = opts.pricingItemId || catalogPricingItemId(row);
    if (!pricingItemId) return;
    const tableDesc =
      opts.tableDesc != null ? String(opts.tableDesc) : catalogDescriptionForRow(row);
    const newDesc = opts.newDesc != null ? String(opts.newDesc) : String(it.description || '');
    if (normalizeDescText(newDesc) === normalizeDescText(tableDesc)) return;
    openSaveDescModal({
      itemIdx: opts.itemIdx,
      serviceName: it.name || (row && row.name) || '',
      newDesc,
      tableDesc,
      pricingItemId,
      row,
    });
  }

  function patchLocalCatalogDescription(pricingItemId, notes) {
    const pid = String(pricingItemId);
    const text = notes != null ? String(notes) : '';
    for (const row of catalog) {
      if (catalogPricingItemId(row) !== pid && String(row.id) !== pid) continue;
      row.default_description = text || null;
      row.notes_customer = text || null;
      row.notes = text || null;
    }
  }

  async function persistDescToPricingTable() {
    const p = descSavePending;
    if (!p || !p.pricingItemId) return;
    const ok = confirm(
      'Atualizar a descrição deste serviço na Tabela de Valores?\n\n' +
        'Isto altera a descrição do sistema para todos os orçamentos futuros.',
    );
    if (!ok) return;
    const btn = $('qbSaveDescTable');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(`/api/pricing/${encodeURIComponent(p.pricingItemId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes: p.newDesc || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || 'Não foi possível atualizar a descrição.');
      patchLocalCatalogDescription(p.pricingItemId, p.newDesc || '');
      const it = items[p.itemIdx];
      if (it) it.pricing_item_id = p.pricingItemId;
      qbToast('Descrição atualizada na Tabela de Valores.', 'success');
      closeSaveDescModal();
    } catch (e) {
      qbToast(e.message || 'Erro ao atualizar a descrição.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireSaveDescModal() {
    $('qbSaveDescQuoteOnly')?.addEventListener('click', () => closeSaveDescModal());
    $('qbSaveDescTable')?.addEventListener('click', () => void persistDescToPricingTable());
    $('qbSaveDescCancel')?.addEventListener('click', () => closeSaveDescModal());
    const root = $('qbSaveDescModal');
    if (root) {
      root.addEventListener('click', (e) => {
        if (e.target === root) closeSaveDescModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.classList.contains('hidden')) closeSaveDescModal();
    });
  }

  async function persistRateForCustomerOnly() {
    const p = rateSavePending;
    if (!p || !p.customer || p.customer.id == null) {
      qbToast('Selecione um cliente CRM para gravar preço personalizado.', 'error');
      return;
    }
    const cid = String(p.customer.id);
    const prevRates =
      p.customer.custom_pricing_rates && typeof p.customer.custom_pricing_rates === 'object'
        ? { ...p.customer.custom_pricing_rates }
        : {};
    prevRates[String(p.pricingItemId)] = p.newRate;
    const btn = $('qbSaveRateClient');
    if (btn) btn.disabled = true;
    try {
      const r = await fetch(`/api/customers/${encodeURIComponent(cid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pricing_mode: 'custom',
          custom_pricing_rates: prevRates,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || 'Não foi possível gravar preço do cliente.');
      if (j.data) upsertClientInCache(j.data);
      if (selectedOrgCustomer && sameId(selectedOrgCustomer.id, cid)) {
        selectedOrgCustomer = { ...selectedOrgCustomer, ...j.data };
      }
      qbToast('Preço gravado só para este cliente.', 'success');
      closeSaveRateModal();
    } catch (e) {
      qbToast(e.message || 'Erro ao gravar preço do cliente.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function persistRateToPricingTable() {
    const p = rateSavePending;
    if (!p || !p.pricingItemId) return;
    const field = pricingFieldKeyForSource(p.src);
    const label = pricingTypeLabel(p.src);
    const ok = confirm(
      `Atualizar a Tabela de Valores (${label}) para ${money(p.newRate)}?\n\n` +
        `Isto altera o preço do sistema para todos os orçamentos futuros (exceto clientes com preço personalizado).`,
    );
    if (!ok) return;
    const btn = $('qbSaveRateTable');
    if (btn) btn.disabled = true;
    try {
      const body = { [field]: p.newRate };
      const r = await fetch(`/api/pricing/${encodeURIComponent(p.pricingItemId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || 'Não foi possível atualizar a Tabela de Valores.');
      patchLocalCatalogRates(p.pricingItemId, p.src, p.newRate);
      const it = items[p.itemIdx];
      if (it) it.pricing_item_id = p.pricingItemId;
      qbToast('Tabela de Valores atualizada.', 'success');
      closeSaveRateModal();
    } catch (e) {
      qbToast(e.message || 'Erro ao atualizar a Tabela de Valores.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireSaveRateModal() {
    $('qbSaveRateQuoteOnly')?.addEventListener('click', () => closeSaveRateModal());
    $('qbSaveRateClient')?.addEventListener('click', () => void persistRateForCustomerOnly());
    $('qbSaveRateTable')?.addEventListener('click', () => void persistRateToPricingTable());
    $('qbSaveRateCancel')?.addEventListener('click', () => closeSaveRateModal());
    const root = $('qbSaveRateModal');
    if (root) {
      root.addEventListener('click', (e) => {
        if (e.target === root) closeSaveRateModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.classList.contains('hidden')) closeSaveRateModal();
    });
  }

  function lineAmount(q, r) {
    return Math.round(q * r * 100) / 100;
  }

  function normalizeCatalogId(v) {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n) && String(n) === s) return n;
    return s;
  }

  function sameId(a, b) {
    if (a == null || b == null || a === '' || b === '') return false;
    return String(a) === String(b);
  }

  function findCatalogRowById(id) {
    const nid = normalizeCatalogId(id);
    if (nid == null) return null;
    return catalog.find((r) => sameId(r.id, nid)) || null;
  }

  function catalogPricingItemId(row) {
    if (!row) return null;
    if (row.pricing_item_id != null && String(row.pricing_item_id).trim() !== '') {
      return String(row.pricing_item_id);
    }
    if (row.source === 'pricing' && row.id != null) return String(row.id);
    return null;
  }

  function catalogRowForItem(it) {
    if (!it) return null;
    const catId = normalizeCatalogId(it.service_catalog_id);
    if (catId != null) {
      const row = findCatalogRowById(catId);
      if (row) return row;
    }
    const pid = it.pricing_item_id != null ? String(it.pricing_item_id).trim() : '';
    if (pid) {
      const byPid = catalog.find((r) => catalogPricingItemId(r) === pid);
      if (byPid) return byPid;
    }
    const key = catalogNameKey(it.name);
    if (!key) return null;
    const matches = catalog.filter((r) => catalogNameKey(r.name) === key);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const withPricing = matches.find((r) => catalogPricingItemId(r));
    return withPricing || matches[0];
  }

  function getQuoteCustomerRecord() {
    const cid = String($('customerId')?.value || '').trim();
    if (cid) {
      const c = clients.find((x) => sameId(x.id, cid));
      if (c) return c;
    }
    return selectedOrgCustomer || null;
  }

  function customRateForCatalogRow(c, row) {
    if (!c || String(c.pricing_mode || '').toLowerCase() !== 'custom' || !c.custom_pricing_rates) return null;
    const rates = c.custom_pricing_rates;
    const pid = catalogPricingItemId(row);
    if (pid && rates[pid] != null) {
      const n = Number(rates[pid]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    if (row.id != null && rates[String(row.id)] != null) {
      const n = Number(rates[String(row.id)]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  }

  function systemRateForCatalogRow(row, source) {
    if (!row) return 0;
    const fallback = Number(row.default_rate) || Number(row.rate_particular) || Number(row.rate_customer) || 0;
    const src = source === 'customer' || source === 'lead' ? 'particular' : source;
    if (src === 'builder') return pickCatalogRate(row.rate_builder, fallback);
    if (src === 'contractor') return pickCatalogRate(row.rate_contractor, fallback);
    if (src === 'loja') return pickCatalogRate(row.rate_loja, fallback);
    return pickCatalogRate(row.rate_particular != null ? row.rate_particular : row.rate_customer, fallback);
  }

  function pricingFieldKeyForSource(src) {
    if (src === 'builder') return 'price_builder';
    if (src === 'contractor') return 'price_contractor';
    if (src === 'loja') return 'price_loja';
    return 'price_particular';
  }

  function ratesNearlyEqual(a, b) {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.009;
  }

  function patchLocalCatalogRates(pricingItemId, src, newRate) {
    const pid = String(pricingItemId);
    const n = Number(newRate);
    if (!Number.isFinite(n)) return;
    for (const row of catalog) {
      if (catalogPricingItemId(row) !== pid && String(row.id) !== pid) continue;
      if (src === 'builder') row.rate_builder = n;
      else if (src === 'contractor') row.rate_contractor = n;
      else if (src === 'loja') row.rate_loja = n;
      else {
        row.rate_particular = n;
        row.rate_customer = n;
        row.default_rate = n;
      }
    }
  }

  function pricingTypeFromParty(party) {
    if (party === 'builder') return 'builder';
    if (party === 'contractor') return 'contractor';
    if (party === 'loja') return 'loja';
    return 'particular';
  }

  function pricingTypeLabel(type) {
    const map = {
      particular: 'Particular',
      builder: 'Builder',
      contractor: 'Contractor',
      loja: 'Loja',
    };
    return map[type] || type;
  }

  function mapPricingRowsToCatalog(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => {
        if (!r) return false;
        const active = r.active === undefined || r.active === null ? 1 : Number(r.active);
        const visible = r.is_visible === undefined || r.is_visible === null ? 1 : Number(r.is_visible);
        return active !== 0 && visible !== 0 && Number.isFinite(active) && Number.isFinite(visible);
      })
      .map((r) => {
        const particular = Number(r.price_particular) || Number(r.price_max) || Number(r.price) || 0;
        const builder =
          Number(r.price_builder) || Number(r.partner_price) || Number(r.price_min) || particular || 0;
        const contractor = Number(r.price_contractor) || builder || 0;
        const loja = Number(r.price_loja) || Number(r.price_min) || Number(r.price) || particular || 0;
        return {
          id: r.id,
          name: r.name,
          // Prefer raw key (supply|installation|sand_finish); normalize handles labels too.
          category: normalizeServiceType(r.category || r.category_label || ''),
          unit_type: r.unit || 'sq_ft',
          default_rate: particular,
          rate_particular: particular,
          rate_customer: particular,
          rate_builder: builder,
          rate_contractor: contractor,
          rate_loja: loja,
          // Tabela de Valores.notes → descrição da linha no Quote
          default_description: r.notes != null ? String(r.notes).trim() || null : null,
          notes_customer: r.notes != null ? String(r.notes).trim() || null : null,
          source: 'pricing',
          pricing_item_id: r.id,
        };
      });
  }

  function mapQuoteCatalogRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => r && r.name)
      .map((r) => {
        const unit = Number(r.unit_price) || Number(r.default_rate) || Number(r.rate) || 0;
        const particular = Number(r.rate_customer != null ? r.rate_customer : unit) || unit;
        const builder = Number(r.rate_builder != null ? r.rate_builder : unit) || unit;
        const contractor = Number(r.rate_contractor != null ? r.rate_contractor : builder) || builder;
        const loja = Number(r.rate_loja != null ? r.rate_loja : unit) || unit;
        return {
          id: r.id,
          name: r.name,
          category: normalizeServiceType(r.service_type || r.category || ''),
          unit_type: r.unit_type || 'sq_ft',
          default_rate: particular,
          rate_particular: particular,
          rate_customer: particular,
          rate_builder: builder,
          rate_contractor: contractor,
          rate_loja: loja,
          default_description: r.description != null ? String(r.description).trim() || null : null,
          notes_customer: r.description != null ? String(r.description).trim() || null : null,
          source: 'quote-catalog',
        };
      });
  }

  function catalogNameKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase();
  }

  /**
   * Catálogo de serviços do quote = quote-catalog (primário).
   * Taxas por tipo vêm da Tabela de Valores quando o nome bate;
   * serviços só na tabela de preços também entram na lista.
   */
  async function loadServiceCatalog() {
    const [pricingRes, quoteCatRes] = await Promise.all([
      api('/api/pricing').catch(() => ({ data: [] })),
      api('/api/quote-catalog').catch(() => ({ data: [] })),
    ]);
    const pricingData = Array.isArray(pricingRes?.data)
      ? pricingRes.data
      : Array.isArray(pricingRes)
        ? pricingRes
        : [];
    const quoteData = Array.isArray(quoteCatRes?.data)
      ? quoteCatRes.data
      : Array.isArray(quoteCatRes)
        ? quoteCatRes
        : [];
    const fromPricing = mapPricingRowsToCatalog(pricingData);
    const fromQuote = mapQuoteCatalogRows(quoteData);

    if (!fromPricing.length && !fromQuote.length) {
      catalog = [];
      return;
    }

    if (!fromQuote.length) {
      catalog = fromPricing;
      return;
    }

    const pricingByName = new Map();
    for (const row of fromPricing) {
      const key = catalogNameKey(row.name);
      if (key && !pricingByName.has(key)) pricingByName.set(key, row);
    }

    const merged = fromQuote.map((q) => {
      const hit = pricingByName.get(catalogNameKey(q.name));
      if (!hit) return q;
      const pricingNotes =
        (hit.default_description && String(hit.default_description).trim()) ||
        (hit.notes_customer && String(hit.notes_customer).trim()) ||
        '';
      return {
        ...q,
        // Tabela de Valores is source of truth for category when names match.
        category: hit.category || q.category,
        default_rate: hit.rate_particular || q.default_rate,
        rate_particular: hit.rate_particular || q.rate_particular,
        rate_customer: hit.rate_particular || q.rate_customer,
        rate_builder: hit.rate_builder || q.rate_builder,
        rate_contractor: hit.rate_contractor || q.rate_contractor,
        rate_loja: hit.rate_loja || q.rate_loja,
        // Prefer notes from Tabela de Valores as the quote line description.
        default_description: pricingNotes || q.default_description || q.notes_customer || null,
        notes_customer: pricingNotes || q.notes_customer || null,
        pricing_item_id: hit.id,
      };
    });

    const seen = new Set(merged.map((r) => catalogNameKey(r.name)).filter(Boolean));
    for (const p of fromPricing) {
      const key = catalogNameKey(p.name);
      if (!key || seen.has(key)) continue;
      merged.push(p);
      seen.add(key);
    }
    catalog = merged;
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
      pricing_item_id: null,
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
    const inl = $('qbMarginInline');
    if (inl) inl.textContent = p.marginPct != null && p.totalCost > 0 ? `· ${p.marginPct}%` : '';
    const bar = $('marginBarFill');
    if (bar) {
      const w = p.marginPct != null ? Math.min(100, Math.max(0, Number(p.marginPct))) : 0;
      bar.style.width = `${w}%`;
    }
  }

  function catalogPricingSource() {
    const r = document.querySelector('input[name="pricingCatalog"]:checked');
    const v = r && r.value ? String(r.value) : '';
    if (v === 'builder' || v === 'contractor' || v === 'loja' || v === 'particular') return v;
    if (v === 'customer') return 'particular';
    return pricingTypeFromParty(getQuoteParty());
  }

  function updatePricingActiveLabel() {
    const el = $('qbPricingActiveLabel');
    if (!el) return;
    const src = catalogPricingSource();
    const cid = String($('customerId')?.value || '');
    const c = cid ? clients.find((x) => sameId(x.id, cid)) : null;
    if (c && c.pricing_mode === 'custom') {
      el.textContent = `Preços customizados · base ${pricingTypeLabel(src)}`;
      return;
    }
    el.textContent = `${pricingTypeLabel(src)} · Tabela de Valores`;
    el.title = el.textContent;
  }

  function setCatalogPricingMode(mode) {
    const m = pricingTypeFromParty(mode === 'customer' || mode === 'lead' ? 'lead' : mode);
    const el = document.querySelector(`input[name="pricingCatalog"][value="${m}"]`);
    if (el) el.checked = true;
    updatePricingActiveLabel();
  }

  function getQuoteParty() {
    if (quotePartyMode === 'builder' || quotePartyMode === 'contractor' || quotePartyMode === 'loja') {
      return quotePartyMode;
    }
    return 'lead';
  }

  function isParticularLikeClient() {
    if (getQuoteParty() !== 'lead') return false;
    if (selectedQuoteLead) return true;
    const c = getQuoteCustomerRecord();
    if (!c) return false;
    const t = String(c.customer_type || 'particular').toLowerCase();
    return !t || t === 'particular' || t === 'lead' || t === 'customer';
  }

  function syncPartyTabsVisibility() {
    const solo = isParticularLikeClient();
    const tabs = $('qbPartyTabs');
    if (tabs) {
      tabs.classList.toggle('is-solo', solo);
      tabs.hidden = solo;
    }
    document.querySelectorAll('.qb-party-tab').forEach((btn) => {
      const p = btn.getAttribute('data-party');
      if (p === 'lead') {
        btn.hidden = false;
        btn.textContent = solo ? 'Cliente' : 'Leads / Particular';
      } else {
        btn.hidden = solo;
      }
    });
  }

  function syncQuoteNoteLabel() {
    const label = document.querySelector('#qbQuoteNote label[for="quoteJobName"]');
    const hint = document.querySelector('#qbQuoteNote .qb-quote-note__hint');
    const party = getQuoteParty();
    if (!label) return;
    if (party === 'builder' || party === 'contractor' || party === 'loja') {
      label.textContent = 'Nota / nome do projeto';
      if (hint) hint.textContent = 'Aparece na lista e no PDF deste orçamento.';
    } else {
      label.textContent = 'Nota / referência';
      if (hint) hint.textContent = 'Aparece na lista de orçamentos para distinguir quotes do mesmo cliente.';
    }
  }

  function syncQuotePartyUi() {
    const party = getQuoteParty();
    document.querySelectorAll('.qb-party-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-party') === party);
    });
    $('qbLeadPanel')?.classList.toggle('hidden', party !== 'lead');
    $('qbBuilderPanel')?.classList.toggle('hidden', party !== 'builder');
    const org = party === 'contractor' || party === 'loja';
    $('qbOrgCustomerPanel')?.classList.toggle('hidden', !org);
    $('qbJobFields')?.classList.toggle('hidden', party === 'lead');
    const hint = $('qbOrgCustomerHint');
    if (hint) {
      hint.textContent =
        party === 'contractor'
          ? 'Usa a coluna Contract da Tabela de Valores.'
          : party === 'loja'
            ? 'Usa a coluna Loja da Tabela de Valores.'
            : 'Usa a coluna correspondente da Tabela de Valores.';
    }
    const search = $('orgCustomerSearch');
    if (search && org) {
      search.placeholder =
        party === 'contractor'
          ? 'Pesquisar contract por nome, empresa, e-mail…'
          : 'Pesquisar loja por nome, empresa, e-mail…';
    }
    syncPartyTabsVisibility();
    syncQuoteNoteLabel();
  }

  function setQuoteParty(party, { applyPrices = true } = {}) {
    const next =
      party === 'builder' || party === 'contractor' || party === 'loja' ? party : 'lead';
    if (quotePartyMode !== next) {
      if (next !== 'builder') {
        selectedQuoteBuilder = null;
        const sel = $('quoteBuilderSelect');
        if (sel) sel.value = '';
        renderBuilderDetails();
      }
      if (next === 'lead' || next === 'builder') {
        selectedOrgCustomer = null;
        renderOrgCustomerDetails();
        const orgSearch = $('orgCustomerSearch');
        if (orgSearch && (next === 'lead' || next === 'builder')) orgSearch.value = '';
        hideOrgCustomerSearchResults();
      }
      if (next !== 'lead') {
        selectedQuoteLead = null;
        pendingLeadId = null;
        const leadSearch = $('customerSearch');
        if (leadSearch && next !== 'lead') {
          /* keep label only when staying on lead */
        }
      }
    }
    quotePartyMode = next;
    syncQuotePartyUi();
    if (quotePartyMode === 'builder') renderBuilderDetails();
    if (quotePartyMode === 'contractor' || quotePartyMode === 'loja') renderOrgCustomerDetails();
    if (applyPrices) {
      setCatalogPricingMode(pricingTypeFromParty(quotePartyMode));
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
          const id = String(b.id);
          const label = escapeHtmlText(b.label || b.company || b.full_name || b.name || `Builder ${id.slice(0, 8)}`);
          return `<option value="${escapeAttr(id)}">${label}</option>`;
        })
      )
      .join('');
    sel.innerHTML = opts;
    if (current && quoteBuilders.some((b) => sameId(b.id, current))) {
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
      if (!builder || !builder.customer_id) $('customerId').value = '';
    }
    renderBuilderDetails();
    if (applyPrices) {
      setCatalogPricingMode('builder');
      refreshRatesForCatalogLines();
      renderItems();
    }
  }

  function onQuoteBuilderChange() {
    const raw = $('quoteBuilderSelect')?.value;
    if (!raw) {
      applySelectedBuilder(null, { applyPrices: true });
      return;
    }
    const b = quoteBuilders.find((x) => sameId(x.id, raw)) || { id: raw };
    applySelectedBuilder(b, { applyPrices: true });
  }

  function applyPricingFromCustomer(c) {
    if (!c) return;
    const type = String(c.customer_type || 'particular').toLowerCase();
    if (type === 'builder' || type === 'contractor' || type === 'loja') {
      setCatalogPricingMode(type);
    } else {
      setCatalogPricingMode('particular');
    }
  }

  /** Alinha a tabela de preços ao tipo do cliente CRM. */
  function applyPricingFromCustomerId(cidStr) {
    const cid = String(cidStr || '').trim();
    if (!cid) return;
    const c = clients.find((x) => sameId(x.id, cid));
    if (!c) return;
    applyPricingFromCustomer(c);
  }

  /** Recalcula `rate` nas linhas vindas do catálogo conforme a taxa atual. */
  function refreshRatesForCatalogLines() {
    const src = catalogPricingSource();
    for (const it of items) {
      const catId = normalizeCatalogId(it.service_catalog_id);
      if (catId == null) continue;
      const row = findCatalogRowById(catId);
      if (!row) continue;
      it.rate = effectiveCatalogRate(row, src);
    }
  }

  function effectiveCatalogRate(row, source) {
    if (!row) return 0;
    const custom = customRateForCatalogRow(getQuoteCustomerRecord(), row);
    if (custom != null && custom > 0) return custom;
    return systemRateForCatalogRow(row, source);
  }

  function resolveModalCatalogRow() {
    if (modalSelectedCatalogRow) return modalSelectedCatalogRow;
    const name = String(($('modalServiceName') && $('modalServiceName').value) || '')
      .trim()
      .toLowerCase();
    if (!name) return null;
    const matches = catalog.filter((r) => String(r.name || '').trim().toLowerCase() === name);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    // Prefer the row that carries Tabela de Valores notes / description
    const withNotes = matches.find(
      (r) =>
        (r.default_description && String(r.default_description).trim()) ||
        (r.notes_customer && String(r.notes_customer).trim())
    );
    return withNotes || matches[0];
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
    return normalizeServiceType(category);
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
    if (selectedOrgCustomer) {
      return {
        name: selectedOrgCustomer.name != null ? String(selectedOrgCustomer.name).trim() : '',
        phone: selectedOrgCustomer.phone != null ? String(selectedOrgCustomer.phone).trim() : '',
        email: selectedOrgCustomer.email != null ? String(selectedOrgCustomer.email).trim() : '',
        address: customerAddress(selectedOrgCustomer),
      };
    }
    const cid = String($('customerId') && $('customerId').value || '').trim();
    if (cid) {
      const c = clients.find((x) => sameId(x.id, cid));
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
      (info.name || info.phone || info.email || info.address || String($('customerId')?.value || '').trim());
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
    const u = String(unit || 'sq_ft').toLowerCase();
    const map = { sq_ft: 'sq ft', sqft: 'sq ft', linear_ft: 'lin ft', lf: 'lin ft', fixed: 'fixo', step: 'degraus', steps: 'degraus', each: 'un', unit: 'un', hour: 'h', hours: 'h', day: 'dias', days: 'dias' };
    return map[u] || u.replace(/_/g, ' ');
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

  /** Configurações › Orçamentos: default tax % for new quotes until the user types a value. */
  let defaultTaxRate = 0;
  let taxTouched = false;
  /** Paid total from invoices — Balance = total − paid. */
  let quotePaidTotal = 0;

  function recalc() {
    const sub = sumItems();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    const disc = discountAmt(sub, dt, dv);
    if (!quoteId && defaultTaxRate > 0 && !taxTouched && $('taxTotal')) {
      $('taxTotal').value = String(Math.round(Math.max(0, sub - disc) * defaultTaxRate) / 100);
    }
    const tax = parseFloat($('taxTotal').value) || 0;
    const total = Math.max(0, Math.round((sub - disc + tax) * 100) / 100);
    const remainingDue =
      quoteInvoiceBalance && quoteInvoiceBalance.remaining_due != null
        ? Number(quoteInvoiceBalance.remaining_due)
        : Math.max(0, Math.round((total - quotePaidTotal) * 100) / 100);
    const subEl = $('dispSubtotal');
    const discEl = $('dispDiscount');
    const taxDisp = $('dispTax');
    const totalEl = $('dispTotal');
    const balEl = $('dispBalance');
    if (subEl) subEl.textContent = money(sub);
    if (discEl) discEl.textContent = money(disc);
    if (taxDisp) taxDisp.textContent = money(tax);
    if (totalEl) totalEl.textContent = money(total);
    if (balEl) balEl.textContent = money(remainingDue);
    updateProfitPanel();
    return { sub, total, disc, tax, remainingDue };
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
    const idx = clients.findIndex((x) => sameId(x.id, c.id));
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

  async function fetchLeadParticularSearch(query) {
    const [leads, particulars] = await Promise.all([
      fetchLeadsForClientSearch(query),
      fetchCustomersByType('particular', query).catch(() => []),
    ]);
    particulars.forEach(upsertClientInCache);
    return { leads, particulars };
  }

  function renderClientSearchResults(payload) {
    const leads = Array.isArray(payload) ? payload : payload?.leads || [];
    const particulars = Array.isArray(payload) ? [] : payload?.particulars || [];
    if (!leads.length && !particulars.length) {
      showClientSearchResults('<div class="qb-client-search__empty">Nenhum lead ou particular encontrado.</div>');
      return;
    }
    const leadHtml = leads
      .map((lead) => {
        const id = String(lead.id);
        const stage = lead.pipeline_stage_name || lead.pipeline_stage_slug || lead.status || '';
        const meta = [
          'Lead',
          lead.email ? escapeHtmlText(lead.email) : '',
          lead.phone ? escapeHtmlText(lead.phone) : '',
          stage ? escapeHtmlText(stage) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<button type="button" class="qb-client-search__item" data-lead-id="${escapeAttr(id)}" role="option">
          <span class="qb-client-search__item-name">${escapeHtmlText(lead.name || `Lead ${id.slice(0, 8)}`)}</span>
          <span class="qb-client-search__item-meta">${meta}</span>
        </button>`;
      })
      .join('');
    const particularHtml = particulars
      .map((c) => {
        const id = String(c.id);
        const meta = [
          'Particular',
          c.email ? escapeHtmlText(c.email) : '',
          c.phone ? escapeHtmlText(c.phone) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<button type="button" class="qb-client-search__item" data-particular-id="${escapeAttr(id)}" role="option">
          <span class="qb-client-search__item-name">${escapeHtmlText(c.name || `Cliente ${id.slice(0, 8)}`)}</span>
          <span class="qb-client-search__item-meta">${meta}</span>
        </button>`;
      })
      .join('');
    showClientSearchResults(leadHtml + particularHtml);
  }

  async function resolveCustomerForLead(leadId) {
    const lid = String(leadId || '').trim();
    if (!lid) return null;

    const byLead = await fetch(`/api/customers/by-lead/${encodeURIComponent(lid)}`, {
      credentials: 'include',
    }).then((r) => r.json());
    if (byLead.success && byLead.data && byLead.data.id != null) {
      upsertClientInCache(byLead.data);
      return byLead.data.id;
    }

    const created = await fetch('/api/customers/from-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lead_id: lid, customer_type: 'particular' }),
    }).then((r) => r.json());

    if (created.success && created.data && created.data.id != null) {
      const cid = created.data.id;
      try {
        const cr = await api(`/api/customers/${encodeURIComponent(cid)}`);
        if (cr.data) upsertClientInCache(cr.data);
        else upsertClientInCache({ id: cid, customer_type: 'particular' });
      } catch (_) {
        upsertClientInCache({ id: cid, customer_type: 'particular' });
      }
      return cid;
    }
    throw new Error(created.error || 'Não foi possível criar cliente a partir do lead.');
  }

  function hideOrgCustomerSearchResults() {
    const box = $('orgCustomerSearchResults');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  }

  function showOrgCustomerSearchResults(html) {
    const box = $('orgCustomerSearchResults');
    if (!box) return;
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  function renderOrgCustomerDetails() {
    const box = $('qbOrgCustomerDetails');
    if (!box) return;
    const c = selectedOrgCustomer;
    if (!c) {
      box.classList.add('hidden');
      return;
    }
    setWrappingField('qbOrgCustomerName', c.name);
    setWrappingField('qbOrgCustomerCompany', c.company);
    setWrappingField('qbOrgCustomerEmail', c.email);
    setWrappingField('qbOrgCustomerPhone', c.phone);
    box.classList.remove('hidden');
  }

  async function fetchCustomersByType(customerType, query) {
    const params = new URLSearchParams({
      limit: '40',
      page: '1',
      customer_type: customerType,
    });
    const q = String(query || '').trim();
    if (q) params.set('q', q);
    const r = await api(`/api/customers?${params.toString()}`);
    return Array.isArray(r.data) ? r.data : [];
  }

  function renderOrgCustomerSearchResults(rows) {
    if (!rows.length) {
      showOrgCustomerSearchResults('<div class="qb-client-search__empty">Nenhum cliente encontrado.</div>');
      return;
    }
    const html = rows
      .map((c) => {
        const id = String(c.id);
        const meta = [
          c.company ? escapeHtmlText(c.company) : '',
          c.email ? escapeHtmlText(c.email) : '',
          c.phone ? escapeHtmlText(c.phone) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<button type="button" class="qb-client-search__item" data-org-customer-id="${escapeAttr(id)}" role="option">
          <span class="qb-client-search__item-name">${escapeHtmlText(c.name || c.company || `Cliente ${id.slice(0, 8)}`)}</span>
          <span class="qb-client-search__item-meta">${meta || pricingTypeLabel(c.customer_type || getQuoteParty())}</span>
        </button>`;
      })
      .join('');
    showOrgCustomerSearchResults(html);
  }

  function scheduleOrgCustomerSearch() {
    clearTimeout(orgCustomerSearchTimer);
    orgCustomerSearchTimer = setTimeout(() => void runOrgCustomerSearch(), 220);
  }

  async function runOrgCustomerSearch() {
    const party = getQuoteParty();
    if (party !== 'contractor' && party !== 'loja') return;
    const q = $('orgCustomerSearch')?.value || '';
    try {
      const rows = await fetchCustomersByType(party, q);
      rows.forEach(upsertClientInCache);
      renderOrgCustomerSearchResults(rows);
    } catch (e) {
      showOrgCustomerSearchResults(
        `<div class="qb-client-search__empty">${escapeHtmlText(e.message || 'Erro na pesquisa.')}</div>`
      );
    }
  }

  function selectOrgCustomer(c, { applyPrices = true } = {}) {
    if (!c || c.id == null) return;
    selectedOrgCustomer = c;
    upsertClientInCache(c);
    $('customerId').value = String(c.id);
    const search = $('orgCustomerSearch');
    if (search) search.value = c.name || c.company || '';
    hideOrgCustomerSearchResults();
    renderOrgCustomerDetails();
    if (applyPrices) {
      applyPricingFromCustomer(c);
      refreshRatesForCatalogLines();
      renderItems();
    } else {
      updatePricingActiveLabel();
    }
  }

  function wireOrgCustomerSearch() {
    const search = $('orgCustomerSearch');
    const box = $('orgCustomerSearchResults');
    const wrap = $('qbOrgCustomerSearchWrap');
    if (!search || !box) return;
    search.addEventListener('focus', () => scheduleOrgCustomerSearch());
    search.addEventListener('input', () => {
      selectedOrgCustomer = null;
      $('customerId').value = '';
      renderOrgCustomerDetails();
      scheduleOrgCustomerSearch();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideOrgCustomerSearchResults();
    });
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-org-customer-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-org-customer-id');
      const cached = clients.find((x) => sameId(x.id, id));
      if (cached) {
        selectOrgCustomer(cached);
        return;
      }
      api(`/api/customers/${encodeURIComponent(id)}`)
        .then((r) => {
          if (r.data) selectOrgCustomer(r.data);
        })
        .catch(() => qbToast('Erro ao carregar cliente.', 'error'));
    });
    document.addEventListener('click', (e) => {
      if (!wrap || wrap.contains(e.target)) return;
      hideOrgCustomerSearchResults();
    });
  }

  async function selectLeadAsClient(lead) {
    if (!lead || lead.id == null) return;
    setQuoteParty('lead', { applyPrices: true });
    selectedQuoteLead = lead;
    pendingLeadId = lead.id;
    loadedQuoteLeadId = null;
    const search = $('customerSearch');
    if (search) search.value = formatLeadClientLabel(lead);
    hideClientSearchResults();
    renderClientDetails();
    updateClientActionButtons();
    hideClientForms();

    const hint = $('leadContextHint');
    if (hint) {
      hint.textContent = `Associado ao lead: ${lead.name || '#' + lead.id}. O orçamento ficará ligado a este lead ao salvar.`;
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
    syncPartyTabsVisibility();
  }

  async function ensureCustomerForQuote() {
    const party = getQuoteParty();
    if (party === 'builder') {
      const bid = String($('quoteBuilderSelect')?.value || '').trim();
      if (!bid) throw new Error('Selecione um builder.');
      const b =
        selectedQuoteBuilder && sameId(selectedQuoteBuilder.id, bid)
          ? selectedQuoteBuilder
          : quoteBuilders.find((x) => sameId(x.id, bid));
      if (b && b.customer_id) {
        $('customerId').value = String(b.customer_id);
        return b.customer_id;
      }
      const cid = String($('customerId')?.value || '').trim();
      return cid || null;
    }

    if (party === 'contractor' || party === 'loja') {
      const cid = String($('customerId')?.value || '').trim();
      if (!cid) {
        throw new Error(party === 'loja' ? 'Selecione uma loja.' : 'Selecione um contract.');
      }
      return cid;
    }

    let cid = String($('customerId') && $('customerId').value || '').trim();
    if (cid) return cid;

    const leadId =
      (selectedQuoteLead && selectedQuoteLead.id != null ? selectedQuoteLead.id : null) ||
      pendingLeadId ||
      loadedQuoteLeadId;

    if (!leadId) {
      throw new Error('Selecione um cliente (lead ou particular).');
    }
    cid = await resolveCustomerForLead(leadId);
    if (!cid) throw new Error('Selecione um cliente (lead ou particular).');
    $('customerId').value = String(cid);
    return cid;
  }

  function getClientEmailForQuote() {
    if (getQuoteParty() === 'builder' && selectedQuoteBuilder && selectedQuoteBuilder.email) {
      return String(selectedQuoteBuilder.email).trim();
    }
    if (selectedOrgCustomer && selectedOrgCustomer.email) {
      return String(selectedOrgCustomer.email).trim();
    }
    const cid = String($('customerId') && $('customerId').value || '').trim();
    if (cid) {
      const c = clients.find((x) => sameId(x.id, cid));
      if (c && c.email) return String(c.email).trim();
    }
    if (selectedQuoteLead && selectedQuoteLead.email) return String(selectedQuoteLead.email).trim();
    return '';
  }

  function getClientPhoneForQuote() {
    if (getQuoteParty() === 'builder' && selectedQuoteBuilder && selectedQuoteBuilder.phone) {
      return String(selectedQuoteBuilder.phone).trim();
    }
    if (selectedOrgCustomer && selectedOrgCustomer.phone) {
      return String(selectedOrgCustomer.phone).trim();
    }
    if (selectedQuoteLead && selectedQuoteLead.phone) return String(selectedQuoteLead.phone).trim();
    const cid = String($('customerId') && $('customerId').value || '').trim();
    if (cid) {
      const c = clients.find((x) => sameId(x.id, cid));
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

  function isLikelyQuotePublicUrl(url) {
    const s = String(url || '').trim();
    if (!/^https?:\/\//i.test(s)) return false;
    if (/\/public\/quotes\//i.test(s)) return true;
    if (/quote-public\.html\?t=/i.test(s)) return true;
    if (/\/(?:SF|Q|OM)-\d{4}-\d+/i.test(s)) return true;
    return false;
  }

  function getQuotePublicUrlFromDom() {
    const a = $('publicLink');
    if (!a || !a.href) return '';
    const href = String(a.href).trim();
    return isLikelyQuotePublicUrl(href) ? href : '';
  }

  function applyPublicUrlToDom(url) {
    const href = String(url || '').trim();
    if (!isLikelyQuotePublicUrl(href)) return;
    const w = $('publicLinkWrap');
    const a = $('publicLink');
    if (!w || !a) return;
    a.href = href;
    a.textContent = href;
    w.classList.remove('hidden');
  }

  async function resolveQuotePublicUrl() {
    const existing = getQuotePublicUrlFromDom();
    if (existing) return existing;
    if (loadedQuoteNumber) {
      const pretty = buildClientPublicQuoteUrl(loadedQuoteNumber);
      if (pretty) {
        applyPublicUrlToDom(pretty);
        return pretty;
      }
    }
    if (!quoteId) return '';
    try {
      const r = await api(`/api/quotes/${quoteId}`);
      const q = r.data || {};
      if (q.quote_number) loadedQuoteNumber = String(q.quote_number).trim();
      const pretty = buildClientPublicQuoteUrl(q.quote_number || loadedQuoteNumber);
      if (pretty) {
        applyPublicUrlToDom(pretty);
        return pretty;
      }
      if (q.public_token) {
        setPublicLink(q.public_token, q.quote_number || loadedQuoteNumber);
        const fromDom = getQuotePublicUrlFromDom();
        if (fromDom) return fromDom;
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  /** Issue a secure public access link (same path used by e-mail). */
  async function issueQuotePublicUrl(opts) {
    if (!quoteId) return '';
    const markBody = {};
    if (opts && opts.markSent) markBody.mark_sent = true;
    const lid = getCurrentQuoteLeadId();
    if (lid) markBody.lead_id = lid;
    const pub = await api(`/api/quotes/${quoteId}/publish-client`, {
      method: 'POST',
      body: JSON.stringify(markBody),
    });
    const url = pub && pub.public_url ? String(pub.public_url).trim() : '';
    if (url) applyPublicUrlToDom(url);
    if (opts && opts.markSent) {
      const statusEl = $('status');
      if (statusEl && statusEl.value === 'draft') statusEl.value = 'sent';
    }
    return isLikelyQuotePublicUrl(url) ? url : '';
  }

  /** Customer-facing SMS / WhatsApp templates from Configurações › Orçamentos. */
  let quoteShareMessages = {
    sms_body:
      "Hi [name], your quote [quote_number] is ready.\n\nView your quote here:\n[link]\n\nThank you!",
    followup_body:
      "Hi [name]! Did you get a chance to review the quote? Happy to answer any questions. [link]",
  };
  let quoteShareCompanyName = '';

  function applyQuoteShareTemplate(tpl, vars) {
    let out = String(tpl || '');
    const map = {
      name: vars.name != null ? String(vars.name) : '',
      company: vars.company != null ? String(vars.company) : '',
      quote_number: vars.quote_number != null ? String(vars.quote_number) : '',
      link: vars.link != null ? String(vars.link) : '',
    };
    out = out.replace(/\[name\]/gi, map.name);
    out = out.replace(/\[company\]/gi, map.company);
    out = out.replace(/\[quote_number\]/gi, map.quote_number);
    out = out.replace(/\[link\]/gi, map.link);
    out = out.replace(/\(\s*\)/g, '');
    out = out.replace(/[ \t]{2,}/g, ' ');
    out = out.replace(/[ \t]+\n/g, '\n');
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.trim();
  }

  function buildQuoteSmsBody(lead, publicUrl) {
    const first = leadFirstNameForSms(lead);
    const num = loadedQuoteNumber ? formatQuoteNumberLabel(loadedQuoteNumber) : '';
    return applyQuoteShareTemplate(quoteShareMessages.sms_body, {
      name: first,
      company: quoteShareCompanyName,
      quote_number: num,
      link: publicUrl || '',
    });
  }

  function buildQuoteFollowupBody(firstName, publicUrl) {
    return applyQuoteShareTemplate(quoteShareMessages.followup_body, {
      name: firstName || 'there',
      company: quoteShareCompanyName,
      quote_number: loadedQuoteNumber ? formatQuoteNumberLabel(loadedQuoteNumber) : '',
      link: publicUrl || '',
    });
  }

  let quoteSendMenuOpen = false;
  let quoteSendMenuAnchor = null;
  let loadedQuoteEmailSentAt = null;
  let loadedQuoteViewedAt = null;
  let loadedQuotePdfViewedAt = null;
  /** Status persistido no servidor (pode diferir do dropdown até guardar). */
  let loadedQuoteStatus = null;
  /** Preserved when the client-notes field is removed from the editor UI. */
  let loadedQuoteNotes = null;
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
    qbMeta.email_sent_at = sentAt || null;
    qbScheduleProgress();
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
    qbMeta.viewed_at = viewedAt || null;
    qbScheduleProgress();
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
    qbMeta.pdf_viewed_at = pdfAt || null;
    qbScheduleProgress();
    const wasPdf = !!loadedQuotePdfViewedAt;
    loadedQuotePdfViewedAt = pdfAt || null;
    const badge = $('qbPdfViewedBadge');
    const label = $('qbPdfViewedBadgeLabel');
    if (!badge) return;
    if (loadedQuotePdfViewedAt) {
      maybeStopQuoteViewPolling();
      const when = formatEmailSentWhen(loadedQuotePdfViewedAt);
      const tip = when ? `Cliente baixou o PDF em ${when}` : 'Cliente baixou o PDF';
      badge.classList.remove('hidden');
      badge.title = tip;
      badge.setAttribute('aria-label', tip);
      if (label) label.textContent = when ? `PDF · ${when}` : 'PDF baixado';
      if (opts.notify && !wasPdf && !quotePdfNotifyShown) {
        quotePdfNotifyShown = true;
        showQuoteNotify({
          type: 'success',
          title: 'PDF baixado',
          message: when
            ? `O cliente baixou o PDF do orçamento (${when}).`
            : 'O cliente baixou o PDF do orçamento.',
          ms: 12000,
        });
      }
    } else {
      badge.classList.add('hidden');
      badge.removeAttribute('title');
      badge.setAttribute('aria-label', 'PDF ainda não baixado pelo cliente');
      if (label) label.textContent = 'PDF baixado';
      if (!opts.keepNotifyFlag) quotePdfNotifyShown = false;
    }
  }

  function getQuoteSendAnchor() {
    const proxies = Array.from(document.querySelectorAll('[data-qb-proxy="btnSend"]'));
    const visibleProxy = proxies.find((el) => {
      if (el.hidden || el.disabled) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visibleProxy) return visibleProxy;
    const btn = $('btnSend');
    if (btn) {
      const st = window.getComputedStyle(btn);
      if (st.display !== 'none' && st.visibility !== 'hidden') {
        const r = btn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return btn;
      }
    }
    return visibleProxy || btn || null;
  }

  function closeQuoteSendMenu() {
    const menu = $('quoteSendMenu');
    const btn = $('btnSend');
    if (menu) {
      menu.classList.add('hidden');
      menu.style.top = '';
      menu.style.left = '';
      menu.style.width = '';
      menu.style.visibility = '';
    }
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.querySelectorAll('[data-qb-proxy="btnSend"]').forEach((el) => {
      el.setAttribute('aria-expanded', 'false');
    });
    quoteSendMenuOpen = false;
    quoteSendMenuAnchor = null;
    document.removeEventListener('click', onQuoteSendMenuOutside, true);
    window.removeEventListener('resize', positionQuoteSendMenu);
    window.removeEventListener('scroll', positionQuoteSendMenu, true);
  }

  function positionQuoteSendMenu() {
    const menu = $('quoteSendMenu');
    const anchor = quoteSendMenuAnchor || getQuoteSendAnchor();
    if (!menu || !anchor || menu.classList.contains('hidden')) return;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    menu.style.visibility = 'hidden';
    menu.classList.remove('hidden');
    const menuH = menu.offsetHeight || 120;
    const menuW = Math.max(220, Math.min(320, menu.offsetWidth || 240));
    // Prefer below the Enviar button; flip above only if it would clip the viewport.
    let top = r.bottom + 6;
    if (top + menuH > window.innerHeight - margin) {
      const above = r.top - menuH - 6;
      if (above >= margin) top = above;
      else top = Math.max(margin, window.innerHeight - menuH - margin);
    }
    // Align to the button's right edge (Enviar sits on the right in the desk toolbar).
    let left = r.right - menuW;
    left = Math.max(margin, Math.min(left, window.innerWidth - menuW - margin));
    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.width = `${menuW}px`;
    menu.style.visibility = '';
  }

  function onQuoteSendMenuOutside(e) {
    if (
      e.target.closest('#quoteSendMenu') ||
      e.target.closest('#btnSend') ||
      e.target.closest('[data-qb-proxy="btnSend"]') ||
      e.target.closest('[data-qb-proxy-now="btnSend"]')
    ) {
      return;
    }
    closeQuoteSendMenu();
  }

  function openQuoteSendMenu(anchorEl) {
    if (!quoteId) return;
    const menu = $('quoteSendMenu');
    const btn = $('btnSend');
    if (!menu || !btn) return;
    quoteSendMenuAnchor = anchorEl || getQuoteSendAnchor() || btn;
    quoteSendMenuOpen = true;
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    if (quoteSendMenuAnchor && quoteSendMenuAnchor !== btn) {
      quoteSendMenuAnchor.setAttribute('aria-expanded', 'true');
    }
    positionQuoteSendMenu();
    window.addEventListener('resize', positionQuoteSendMenu);
    window.addEventListener('scroll', positionQuoteSendMenu, true);
    requestAnimationFrame(() => {
      document.addEventListener('click', onQuoteSendMenuOutside, true);
    });
  }

  function toggleQuoteSendMenu(anchorEl) {
    if (quoteSendMenuOpen) closeQuoteSendMenu();
    else openQuoteSendMenu(anchorEl);
  }

  function getCurrentQuoteLeadId() {
    const raw = getActiveLeadId();
    if (raw == null || raw === '') return null;
    return String(raw);
  }

  let pendingEmailSendBody = null;
  /** @type {{ kind: 'quote' | 'receipt', body?: object, invoiceId?: string } | null} */
  let pendingEmailAction = null;
  /** Extra CC emails for the quote email preview modal. */
  let previewExtraEmails = [];

  function closeEmailPreviewModal() {
    $('qbEmailPreviewModal')?.classList.add('hidden');
    pendingEmailSendBody = null;
    pendingEmailAction = null;
    previewExtraEmails = [];
    const frame = $('qbEmailPreviewFrame');
    if (frame) frame.removeAttribute('srcdoc');
    const sendBtn = $('btnEmailPreviewSend');
    if (sendBtn) sendBtn.textContent = 'Enviar e-mail';
    const extraInput = $('qbEmailPreviewExtraInput');
    if (extraInput) extraInput.value = '';
    renderPreviewExtraEmailChips();
  }

  function renderPreviewExtraEmailChips() {
    const box = $('qbEmailPreviewExtraChips');
    if (!box) return;
    if (!previewExtraEmails.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = previewExtraEmails
      .map((email, idx) => {
        const safe = escapeHtmlText(email);
        return `<span class="qb-extra-emails__chip" data-preview-email-idx="${idx}">
          <span title="${safe}">${safe}</span>
          <button type="button" class="qb-extra-emails__chip-remove" data-remove-preview-email="${idx}" aria-label="Remover ${safe}">×</button>
        </span>`;
      })
      .join('');
  }

  function addPreviewExtraEmail(raw, { quietInvalid = false } = {}) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email) return false;
    if (!isValidEmailAddress(email)) {
      if (!quietInvalid) qbToast('E-mail inválido.', 'error');
      return false;
    }
    const primary = String($('qbEmailPreviewTo')?.value || '').trim().toLowerCase();
    if (primary && email === primary) {
      if (!quietInvalid) qbToast('Este já é o destinatário principal.', 'info');
      return false;
    }
    if (previewExtraEmails.includes(email)) {
      if (!quietInvalid) qbToast('E-mail já adicionado.', 'info');
      return false;
    }
    previewExtraEmails.push(email);
    renderPreviewExtraEmailChips();
    return true;
  }

  function removePreviewExtraEmail(idx) {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0 || i >= previewExtraEmails.length) return;
    previewExtraEmails.splice(i, 1);
    renderPreviewExtraEmailChips();
  }

  function tryCommitPreviewExtraEmailInput({ quietInvalid = false } = {}) {
    const input = $('qbEmailPreviewExtraInput');
    if (!input) return;
    const raw = String(input.value || '').trim();
    if (!raw) return;
    const parts = raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
    let added = 0;
    for (const part of parts) {
      if (addPreviewExtraEmail(part, { quietInvalid })) added += 1;
    }
    if (added > 0) input.value = '';
  }

  function openEmailPreviewModal(preview, opts) {
    pendingEmailAction = opts || { kind: 'quote', body: {} };
    pendingEmailSendBody = opts?.kind === 'quote' ? opts.body || {} : null;
    const isReceipt = opts?.kind === 'receipt';
    const modal = $('qbEmailPreviewModal');
    if (!modal) return;
    const title = $('qbEmailPreviewTitle');
    if (title) {
      title.textContent = isReceipt ? 'Pré-visualizar e-mail do recibo' : 'Pré-visualizar e-mail';
    }
    const meta = $('qbEmailPreviewMeta');
    if (meta) {
      let html = '';
      if (preview.client_name) {
        html += `<div><strong>Cliente:</strong> ${escapeHtmlText(preview.client_name)}</div>`;
      }
      if (preview.invoice_number) {
        html += `<div><strong>Fatura:</strong> ${escapeHtmlText(preview.invoice_number)}</div>`;
      }
      if (preview.amount != null) {
        html += `<div><strong>Valor:</strong> ${money(preview.amount)}${
          preview.method_label ? ` · ${escapeHtmlText(preview.method_label)}` : ''
        }</div>`;
      }
      if (preview.quote_number) {
        html += `<div><strong>Orçamento:</strong> ${escapeHtmlText(preview.quote_number)}</div>`;
      }
      if (preview.note) {
        html += `<div style="margin-top:6px;font-size:12px;color:#78716c">${escapeHtmlText(preview.note)}</div>`;
      }
      meta.innerHTML = html;
    }

    const toEl = $('qbEmailPreviewTo');
    const toWrap = $('qbEmailPreviewToWrap');
    if (toEl) {
      toEl.value = preview.to || '';
      toEl.readOnly = isReceipt;
    }
    if (toWrap) toWrap.classList.toggle('hidden', false);

    const subj = $('qbEmailPreviewSubject');
    if (subj) {
      subj.value = preview.subject || '';
      subj.readOnly = isReceipt;
    }

    const extrasWrap = $('qbEmailPreviewExtrasWrap');
    if (extrasWrap) extrasWrap.classList.toggle('hidden', isReceipt);
    previewExtraEmails = [];
    if (!isReceipt) {
      const fromPreview = Array.isArray(preview.cc)
        ? preview.cc
        : Array.isArray(preview.extra_emails)
          ? preview.extra_emails
          : [];
      const fromBody = Array.isArray(opts?.body?.extra_emails)
        ? opts.body.extra_emails
        : Array.isArray(opts?.body?.cc)
          ? opts.body.cc
          : [];
      const seed = [...fromPreview, ...fromBody]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => isValidEmailAddress(e));
      const primary = String(preview.to || '').trim().toLowerCase();
      previewExtraEmails = [...new Set(seed)].filter((e) => e && e !== primary);
    }
    renderPreviewExtraEmailChips();
    const extraInput = $('qbEmailPreviewExtraInput');
    if (extraInput) extraInput.value = '';

    const frame = $('qbEmailPreviewFrame');
    if (frame) frame.srcdoc = preview.html || '<p>Sem pré-visualização.</p>';
    const sendBtn = $('btnEmailPreviewSend');
    if (sendBtn) {
      sendBtn.textContent = isReceipt ? 'Registrar e enviar' : 'Enviar e-mail';
    }
    modal.classList.remove('hidden');
    if (!isReceipt && subj && !subj.readOnly) {
      setTimeout(() => subj.focus(), 50);
    }
  }

  async function sendQuoteByEmail() {
    closeQuoteSendMenu();
    if (!quoteId) return;
    try {
      await ensureCustomerForQuote();
    } catch (e) {
      showQuoteNotify({
        type: 'error',
        title: 'Cliente necessário',
        message: e.message || 'Selecione um lead na pesquisa de cliente.',
        ms: 8000,
      });
      return;
    }
    const previewTo = getClientEmailForQuote();
    if (!previewTo) {
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
      const body = { to: previewTo };
      if (extra.length) {
        body.extra_emails = extra;
        body.cc = extra;
      }
      const lid = getCurrentQuoteLeadId();
      if (lid) body.lead_id = lid;
      const r = await api(`/api/quotes/${quoteId}/email-preview`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      openEmailPreviewModal(r, { kind: 'quote', body });
    } catch (e) {
      showQuoteNotify({
        type: 'error',
        title: 'Pré-visualização',
        message: e.message || 'Não foi possível gerar a pré-visualização do e-mail.',
        ms: 10000,
      });
    }
  }

  async function confirmSendQuoteEmail() {
    if (pendingEmailAction?.kind === 'receipt') {
      await confirmSendReceiptEmail();
      return;
    }
    if (!quoteId || !pendingEmailSendBody) return;
    tryCommitPreviewExtraEmailInput();
    const to = String($('qbEmailPreviewTo')?.value || '').trim().toLowerCase();
    if (!isValidEmailAddress(to)) {
      showQuoteNotify({
        type: 'error',
        title: 'E-mail inválido',
        message: 'Informe um destinatário principal válido.',
        ms: 8000,
      });
      $('qbEmailPreviewTo')?.focus();
      return;
    }
    const subject = String($('qbEmailPreviewSubject')?.value || '').trim();
    if (!subject) {
      showQuoteNotify({
        type: 'error',
        title: 'Assunto em falta',
        message: 'Escreva o título (assunto) do e-mail antes de enviar.',
        ms: 8000,
      });
      $('qbEmailPreviewSubject')?.focus();
      return;
    }
    const extras = previewExtraEmails.filter((e) => e && e !== to);
    const btn = $('btnEmailPreviewSend');
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A enviar…';
    }
    try {
      const body = { ...pendingEmailSendBody, to, subject };
      if (extras.length) {
        body.extra_emails = extras;
        body.cc = extras;
      } else {
        delete body.extra_emails;
        delete body.cc;
      }
      const r = await api(`/api/quotes/${quoteId}/send-email`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closeEmailPreviewModal();
      if (r.public_url) applyPublicUrlToDom(r.public_url);
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
      const ccNote = extras.length ? ` (CC: ${extras.join(', ')})` : '';
      const movedNote =
        r.lead_moved === true
          ? ' Lead movido para Orçamento enviado.'
          : r.lead_move_reason === 'no_lead'
            ? ' (Lead do Kanban não associado a este orçamento.)'
            : '';
      showQuoteNotify({
        type: 'success',
        title: 'E-mail enviado',
        message: `E-mail enviado para ${to}${ccNote} (${how}) — só com link seguro. Você será avisado quando o cliente abrir o link ou baixar o PDF.${movedNote}`,
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
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Enviar e-mail';
      }
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
    let publicUrl = '';
    try {
      publicUrl = await issueQuotePublicUrl({ markSent: true });
    } catch (_) {
      /* try legacy / cached link below */
    }
    if (!publicUrl) {
      publicUrl = await resolveQuotePublicUrl();
    }
    if (!publicUrl) {
      showQuoteNotify({
        type: 'error',
        title: 'Link do orçamento',
        message:
          'Não foi possível gerar o link público. Salve o orçamento e tente de novo. Se o erro continuar, recarregue a página.',
        ms: 10000,
      });
      return;
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
      const lid = String(q.lead_id);
      loadedQuoteLeadId = lid;
      selectedQuoteLead = null;
      pendingLeadId = null;
      try {
        const lr = await fetch(`/api/leads/${encodeURIComponent(lid)}`, { credentials: 'include' }).then((r) => r.json());
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

    if (q.customer_id) {
      const c = clients.find((x) => sameId(x.id, q.customer_id));
      if (c) {
        search.value = formatCustomerLabel(c);
        const type = String(c.customer_type || '').toLowerCase();
        if (type === 'builder' || type === 'contractor' || type === 'loja') {
          setQuoteParty(type, { applyPrices: false });
          if (type === 'contractor' || type === 'loja') {
            selectOrgCustomer(c, { applyPrices: false });
          }
        } else {
          applyPricingFromCustomer(c);
        }
      }
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
        const payload = await fetchLeadParticularSearch(q);
        renderClientSearchResults(payload);
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
      syncPartyTabsVisibility();
      scheduleClientLeadSearch();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideClientSearchResults();
    });

    box.addEventListener('click', (e) => {
      const particularBtn = e.target.closest('[data-particular-id]');
      if (particularBtn) {
        const id = particularBtn.getAttribute('data-particular-id');
        const cached = clients.find((x) => sameId(x.id, id));
        const applyParticular = (c) => {
          setQuoteParty('lead', { applyPrices: false });
          selectedQuoteLead = null;
          pendingLeadId = null;
          selectedOrgCustomer = null;
          $('customerId').value = String(c.id);
          upsertClientInCache(c);
          const searchEl = $('customerSearch');
          if (searchEl) searchEl.value = formatCustomerLabel(c);
          hideClientSearchResults();
          renderClientDetails();
          updateClientActionButtons();
          applyPricingFromCustomer(c);
          refreshRatesForCatalogLines();
          renderItems();
          syncPartyTabsVisibility();
        };
        if (cached) {
          applyParticular(cached);
          return;
        }
        api(`/api/customers/${encodeURIComponent(id)}`)
          .then((r) => {
            if (r.data) applyParticular(r.data);
          })
          .catch(() => qbToast('Erro ao carregar particular.', 'error'));
        return;
      }
      const btn = e.target.closest('[data-lead-id]');
      if (!btn) return;
      const lid = btn.getAttribute('data-lead-id');
      if (!lid) return;
      fetch(`/api/leads/${encodeURIComponent(lid)}`, { credentials: 'include' })
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

  function parseInlineNumber(v) {
    const n = parseFloat(String(v || '').replace(/[^0-9.,-]/g, '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function attachItemsListHandlers() {
    const list = $('itemsList');
    if (!list || list.dataset.bound) return;
    list.dataset.bound = '1';
    list.addEventListener('focusin', (e) => {
      const q = e.target.closest('[data-rate]');
      if (!q) return;
      const idx = parseInt(q.getAttribute('data-rate'), 10);
      const it = items[idx];
      if (!it) return;
      const row = catalogRowForItem(it);
      const pricingItemId = catalogPricingItemId(row);
      if (!pricingItemId) {
        inlineRateEditCtx = null;
        return;
      }
      const src = catalogPricingSource();
      inlineRateEditCtx = {
        idx,
        pricingItemId,
        tableRate: systemRateForCatalogRow(row, src),
        row,
        src,
      };
    });
    list.addEventListener('input', (e) => {
      const q = e.target.closest('[data-qty],[data-rate]');
      if (!q) return;
      const idx = parseInt(q.getAttribute('data-qty') ?? q.getAttribute('data-rate'), 10);
      const it = items[idx];
      if (!it) return;
      const val = parseInlineNumber(q.value);
      if (q.hasAttribute('data-qty')) it.quantity = val;
      else {
        it.rate = val;
        it.sell_price = val;
      }
      const tot = list.querySelector(`[data-total="${idx}"]`);
      if (tot) tot.textContent = money(lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0));
      recalc();
      qbMarkDirty();
    });
    list.addEventListener('focusout', (e) => {
      const q = e.target.closest('[data-rate]');
      if (!q) return;
      const idx = parseInt(q.getAttribute('data-rate'), 10);
      const newRate = parseInlineNumber(q.value);
      q.value = inlineNum(newRate, true);
      const ctx = inlineRateEditCtx;
      inlineRateEditCtx = null;
      if (!ctx || ctx.idx !== idx) return;
      setTimeout(() => {
        maybeOfferRatePersist({
          itemIdx: idx,
          newRate,
          pricingItemId: ctx.pricingItemId,
          tableRate: ctx.tableRate,
          row: ctx.row,
          src: ctx.src,
        });
      }, 0);
    });
    list.addEventListener('keydown', (e) => {
      const q = e.target.closest('[data-qty],[data-rate]');
      if (q && e.key === 'Enter') {
        e.preventDefault();
        q.blur();
        return;
      }
      if (q && e.key === 'Tab') {
        const fields = Array.from(list.querySelectorAll('[data-qty],[data-rate]'));
        const i = fields.indexOf(e.target);
        if (i < 0) return;
        const next = e.shiftKey ? fields[i - 1] : fields[i + 1];
        if (!next) return; // leave list / native Tab
        e.preventDefault();
        next.focus();
        try {
          next.select();
        } catch (_) {
          /* ignore */
        }
        return;
      }
      const nm = e.target.closest('.qb-row__name');
      if (nm && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        nm.click();
      }
    });
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
        qbMarkDirty();
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

  /** Margem extra acima do teclado (px). A barra inferior some com o teclado aberto. */
  const QB_SERVICE_KEYBOARD_GAP = 24;
  const QB_KEYBOARD_HIDE_BAR_PX = 72;

  function isEditableFocusTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const type = String(el.type || '').toLowerCase();
      if (type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio' || type === 'file') {
        return false;
      }
      return true;
    }
    return Boolean(el.isContentEditable);
  }

  /** Qty / price fields — auto-scroll while typing is disruptive; only assist when a soft keyboard is open. */
  function isQtyOrRateField(el) {
    if (!el || !el.getAttribute) return false;
    if (el.hasAttribute('data-qty') || el.hasAttribute('data-rate')) return true;
    const id = el.id || '';
    return (
      id === 'modalServiceQty' ||
      id === 'modalServiceRate' ||
      id === 'modalServiceMarkup' ||
      id === 'discountValue' ||
      id === 'taxTotal'
    );
  }

  function softKeyboardLikelyOpen() {
    return getServiceFieldViewportMetrics().keyboardOverlap >= QB_KEYBOARD_HIDE_BAR_PX;
  }

  function shouldAssistScrollForField(el) {
    if (!isEditableFocusTarget(el)) return false;
    if (isQtyOrRateField(el) && !softKeyboardLikelyOpen()) return false;
    return true;
  }

  function getServiceFieldViewportMetrics() {
    const vv = window.visualViewport;
    const layoutH = window.innerHeight || document.documentElement.clientHeight || 0;
    const vvTop = vv ? vv.offsetTop : 0;
    const vvH = vv ? vv.height : layoutH;
    const actionBar = $('qbActionBar');
    const keyboardOverlap = Math.max(0, layoutH - (vvTop + vvH));
    const barHidden =
      keyboardOverlap >= QB_KEYBOARD_HIDE_BAR_PX ||
      (actionBar && actionBar.getAttribute('data-kb-hidden') === '1');
    const actionBarH =
      !barHidden && actionBar && !actionBar.classList.contains('hidden')
        ? actionBar.getBoundingClientRect().height
        : 0;
    const bottomReserve = Math.max(keyboardOverlap, actionBarH, 0) + QB_SERVICE_KEYBOARD_GAP;
    return { vvTop, vvH, layoutH, bottomReserve, keyboardOverlap, actionBarH, barHidden };
  }

  function syncActionBarForKeyboard() {
    const bar = $('qbActionBar');
    if (!bar) return;
    const { keyboardOverlap } = getServiceFieldViewportMetrics();
    const editing = isEditableFocusTarget(document.activeElement);
    const hide = editing && keyboardOverlap >= QB_KEYBOARD_HIDE_BAR_PX;
    if (hide) {
      bar.setAttribute('data-kb-hidden', '1');
      bar.style.visibility = 'hidden';
      bar.style.pointerEvents = 'none';
      bar.setAttribute('aria-hidden', 'true');
    } else {
      bar.removeAttribute('data-kb-hidden');
      bar.style.visibility = '';
      bar.style.pointerEvents = '';
      bar.removeAttribute('aria-hidden');
    }
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
        const id = String(row.id);
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
        return `<button type="button" id="modalServiceOpt-${i}" class="qb-client-search__item${activeClass}" data-catalog-id="${escapeAttr(id)}" role="option" aria-selected="${i === modalServiceActiveIndex ? 'true' : 'false'}">
          <span class="qb-client-search__item-name">${escapeHtmlText(row.name || `Serviço ${id.slice(0, 8)}`)}</span>
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
    const name = row.name || '';
    const descRaw = catalogDescriptionForRow(row);
    $('modalServiceDesc').value = descriptionBodyWithoutTitle(name, descRaw);
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
    modalSelectedCatalogRow = cid ? findCatalogRowById(cid) : null;
    const itemName = it.name != null ? String(it.name) : '';
    $('modalServiceName').value = itemName;
    $('modalServiceDesc').value = descriptionBodyWithoutTitle(
      itemName,
      it.description != null ? String(it.description) : '',
    );
    const typeEl = $('modalServiceType');
    const normalizedType = normalizeServiceType(it.service_type);
    if (typeEl) {
      typeEl.value = normalizedType;
      // If the option didn't stick (legacy value), force Sand & Finish / category match.
      if (typeEl.value !== normalizedType) {
        const opt = Array.from(typeEl.options || []).find(
          (o) => normalizeServiceType(o.value) === normalizedType,
        );
        if (opt) typeEl.value = opt.value;
      }
    }
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

  function getBuilderMainScroller(fromEl) {
    const seed = fromEl || $('modalServiceName') || document.activeElement;
    if (seed && seed.closest) {
      const main = seed.closest('.builder-main');
      if (main) return main;
    }
    return document.querySelector('.builder-main');
  }

  /** Mantém o campo focado visível acima do teclado (nome, termos, busca de serviço, etc.). */
  function scrollFocusedFieldIntoView(opts) {
    const force = opts && opts.force;
    const el = document.activeElement;
    if (!isEditableFocusTarget(el)) return;
    // Avoid jump-scroll when typing qty/price on desktop (or whenever soft keyboard is closed).
    if (!shouldAssistScrollForField(el)) {
      syncActionBarForKeyboard();
      return;
    }
    syncActionBarForKeyboard();
    const wrap =
      (el.id === 'modalServiceName' && ($('modalServiceSearchWrap') || el)) ||
      el.closest('.qb-row__qty, .qb-row__rate, .qb-item-editor__field, .qb-notes__box, label') ||
      el;
    const scroller = getBuilderMainScroller(el);
    if (!scroller) {
      // Prefer nearest — centering the field causes the “page jumps while I type” bug.
      el.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
      return;
    }

    const { vvTop, vvH, bottomReserve } = getServiceFieldViewportMetrics();
    const targetTop = vvTop + 16;
    const safeBottom = vvTop + vvH - bottomReserve;
    const rect = wrap.getBoundingClientRect();
    let delta = 0;
    if (rect.top < targetTop) {
      delta = rect.top - targetTop;
    } else if (rect.bottom > safeBottom) {
      delta = rect.bottom - safeBottom;
    }

    // Even with force, skip tiny adjustments — they feel like random scroll while typing.
    if (Math.abs(delta) < (force ? 12 : 6)) {
      if (el.id === 'modalServiceName') fitModalServiceResultsHeight();
      return;
    }

    scroller.scrollTo({
      top: Math.max(0, scroller.scrollTop + delta),
      behavior: force ? 'auto' : 'smooth',
    });

    requestAnimationFrame(() => {
      if (el.id === 'modalServiceName') fitModalServiceResultsHeight();
      const after = wrap.getBoundingClientRect();
      let fix = 0;
      if (after.top < targetTop) fix = after.top - targetTop;
      else if (after.bottom > safeBottom) fix = after.bottom - safeBottom;
      if (Math.abs(fix) > 6) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop + fix);
        if (el.id === 'modalServiceName') fitModalServiceResultsHeight();
      }
      const box = $('modalServiceResults');
      if (el.id === 'modalServiceName' && box && !box.classList.contains('hidden')) {
        const blockBottom = Math.max(after.bottom, box.getBoundingClientRect().bottom);
        if (blockBottom > safeBottom + 4) {
          scroller.scrollTop = Math.max(0, scroller.scrollTop + (blockBottom - safeBottom));
          fitModalServiceResultsHeight();
        }
      }
    });
  }

  function scrollServiceNameIntoView(opts) {
    scrollFocusedFieldIntoView(opts);
  }

  function ensureFocusedFieldVisibleForKeyboard() {
    const el = document.activeElement;
    if (!shouldAssistScrollForField(el)) {
      syncActionBarForKeyboard();
      clearServiceFieldScrollTimers();
      return;
    }
    clearServiceFieldScrollTimers();
    const run = () => {
      syncActionBarForKeyboard();
      scrollFocusedFieldIntoView({ force: true });
    };
    requestAnimationFrame(run);
    // iOS/iPadOS abre o teclado com atraso — repetir após animação (só com teclado virtual)
    [80, 200, 360, 560].forEach((ms) => {
      qbServiceFieldScrollTimers.push(setTimeout(run, ms));
    });
  }

  function ensureServiceNameVisibleForKeyboard() {
    ensureFocusedFieldVisibleForKeyboard();
  }

  function onQuoteEditorVisualViewportChange() {
    syncActionBarForKeyboard();
    const el = document.activeElement;
    if (!shouldAssistScrollForField(el)) return;
    // Ignore viewport jitter while typing qty/price unless the soft keyboard is open.
    if (!softKeyboardLikelyOpen()) return;
    scrollFocusedFieldIntoView();
  }

  function wireServiceNameKeyboardScroll() {
    if (qbServiceViewportWired) return;
    qbServiceViewportWired = true;
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onQuoteEditorVisualViewportChange);
      window.visualViewport.addEventListener('scroll', onQuoteEditorVisualViewportChange);
    }
    window.addEventListener('orientationchange', () => {
      if (shouldAssistScrollForField(document.activeElement)) ensureFocusedFieldVisibleForKeyboard();
    });
    document.addEventListener(
      'focusin',
      (e) => {
        if (!isEditableFocusTarget(e.target)) return;
        if (!e.target.closest || !e.target.closest('.qb-page, .builder-main, #addItemPanel, #itemsList, .qb-notes')) {
          return;
        }
        // Qty/price: do not kick off multi-timeout scroll storms on focus.
        if (isQtyOrRateField(e.target) && !softKeyboardLikelyOpen()) {
          syncActionBarForKeyboard();
          return;
        }
        ensureFocusedFieldVisibleForKeyboard();
      },
      true,
    );
    document.addEventListener(
      'focusout',
      () => {
        clearServiceFieldScrollTimers();
        setTimeout(() => syncActionBarForKeyboard(), 120);
      },
      true,
    );
  }

  function ensureServiceDescRichText() {
    const ta = $('modalServiceDesc');
    if (!ta) return;
    if (typeof window.sfAttachRichText === 'function') {
      window.sfAttachRichText(ta);
    } else if (typeof window.sfScanCrmRichText === 'function') {
      window.sfScanCrmRichText(ta.parentElement || document);
    }
  }

  /** Home slot for the add/edit panel (just before the “Adicionar serviço” foot). */
  function restoreAddItemPanelHome() {
    const panel = $('addItemPanel');
    if (!panel) return;
    panel.classList.remove('qb-item-editor--docked');
    document.querySelectorAll('.qb-item-card.is-editing').forEach((el) => el.classList.remove('is-editing'));
    const foot = document.querySelector('#qbItemsSection .qb-items-foot');
    if (foot && foot.parentNode && panel.nextElementSibling !== foot) {
      foot.parentNode.insertBefore(panel, foot);
    }
  }

  /**
   * While editing an existing line, dock the editor directly under that row.
   * For “add new”, keep it at the foot of the items section.
   */
  function dockAddItemPanel() {
    const panel = $('addItemPanel');
    if (!panel || panel.classList.contains('hidden')) {
      restoreAddItemPanelHome();
      return;
    }
    document.querySelectorAll('.qb-item-card.is-editing').forEach((el) => el.classList.remove('is-editing'));
    if (inlineEditIdx != null && inlineEditIdx >= 0) {
      const card = document.querySelector(`#itemsList [data-item-idx="${inlineEditIdx}"]`);
      if (card && card.parentNode) {
        card.classList.add('is-editing');
        panel.classList.add('qb-item-editor--docked');
        if (card.nextElementSibling !== panel) {
          card.insertAdjacentElement('afterend', panel);
        }
        return;
      }
    }
    restoreAddItemPanelHome();
    panel.classList.remove('qb-item-editor--docked');
  }

  function openLineNoteDetailsIfNeeded() {
    const noteEl = $('inlineItemNote');
    const details = noteEl && noteEl.closest ? noteEl.closest('details') : null;
    if (!details) return;
    const hasNote = noteEl && String(noteEl.value || '').trim();
    if (hasNote) details.open = true;
  }

  /** Focusable fields inside the service/note editor, in Tab order. */
  function serviceEditorTabFields() {
    const ids = [
      'modalServiceName',
      'modalServiceDesc',
      'modalServiceQty',
      'modalServiceRate',
      'modalServiceMarkup',
      'modalServiceType',
      'modalServiceUnit',
      'inlineItemNote',
      'modalCancel',
      'modalConfirmService',
    ];
    const out = [];
    for (const id of ids) {
      const el = $(id);
      if (!el || el.disabled) continue;
      if (id === 'inlineItemNote') {
        const details = el.closest && el.closest('details');
        if (details && !details.open) {
          // Still include so Tab can open + focus the note field.
          out.push(el);
          continue;
        }
      }
      out.push(el);
    }
    return out;
  }

  function focusServiceEditorField(el) {
    if (!el) return;
    if (el.id === 'inlineItemNote') {
      const details = el.closest && el.closest('details');
      if (details) details.open = true;
    }
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      el.focus();
    }
    if (typeof el.select === 'function' && /^(text|search|tel|url|password)$/i.test(el.type || 'text')) {
      try {
        el.select();
      } catch (_) {
        /* ignore */
      }
    }
    if (shouldAssistScrollForField(el)) scrollFocusedFieldIntoView({ force: true });
  }

  function handleServiceEditorTab(e) {
    if (e.key !== 'Tab') return;
    const panel = $('addItemPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (!panel.contains(e.target)) return;
    // Let browser handle Tab inside the catalog dropdown listbox.
    const results = $('modalServiceResults');
    if (results && !results.classList.contains('hidden') && results.contains(e.target)) return;

    const fields = serviceEditorTabFields();
    if (fields.length < 2) return;
    let idx = fields.indexOf(e.target);
    if (idx < 0) {
      // Rich-text toolbar buttons / wrappers: find nearest field.
      idx = fields.findIndex((f) => f === e.target || (f.contains && f.contains(e.target)));
      if (idx < 0) {
        const wrap = e.target.closest && e.target.closest('.qb-item-editor__field, .qb-pricing-cell, .qb-item-editor__actions');
        if (wrap) {
          idx = fields.findIndex((f) => wrap.contains(f));
        }
      }
    }
    if (idx < 0) return;
    e.preventDefault();
    if (e.target === $('modalServiceName')) hideModalServiceResults();
    const nextIdx = e.shiftKey
      ? (idx - 1 + fields.length) % fields.length
      : (idx + 1) % fields.length;
    focusServiceEditorField(fields[nextIdx]);
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
    ensureServiceDescRichText();
    openLineNoteDetailsIfNeeded();
    dockAddItemPanel();
    const btnAdd = $('btnAddLine');
    if (btnAdd) btnAdd.classList.add('hidden');
    const confirmBtn = $('modalConfirmService');
    if (confirmBtn) confirmBtn.textContent = inlineEditIdx >= 0 ? 'Salvar' : 'Adicionar';
    scheduleModalServiceSearch();
    requestAnimationFrame(() => {
      try {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } catch (_) {
        /* ignore */
      }
    });
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
    restoreAddItemPanelHome();
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
    const catNotesRaw = row ? catalogDescriptionForRow(row) : '';
    const catNotes = descriptionBodyWithoutTitle(name, catNotesRaw);
    const noteVal = $('inlineItemNote') ? String($('inlineItemNote').value || '').trim() : '';
    const existing = inlineEditIdx >= 0 ? items[inlineEditIdx] : null;
    const typedDescRaw = String(($('modalServiceDesc') && $('modalServiceDesc').value) || '').trim();
    const typedDesc = descriptionBodyWithoutTitle(name, typedDescRaw);
    // Prefer the text the user typed; fall back to catalog notes (already de-titled).
    const lineDesc = typedDesc || catNotes || '';
    const line = {
      item_type: existing && existing.item_type === 'product' ? 'product' : 'service',
      name,
      description: lineDesc,
      unit_type: $('modalServiceUnit').value || 'sq_ft',
      quantity: qty,
      rate: sellRate,
      service_type: normalizeServiceType($('modalServiceType').value || 'Installation'),
      notes: noteVal || null,
      // Keep in sync with the line description so PDF/public don't show a stale catalog blurb.
      catalog_customer_notes: lineDesc || null,
      service_catalog_id: row
        ? normalizeCatalogId(row.id)
        : existing
          ? normalizeCatalogId(existing.service_catalog_id)
          : null,
      product_id: existing && existing.product_id != null ? existing.product_id : null,
      cost_price: costPrice,
      markup_percentage: markupPct,
      sell_price: sellRate,
      pricing_item_id: catalogPricingItemId(row) || (existing && existing.pricing_item_id) || null,
      estimateAuto: existing ? !!existing.estimateAuto : false,
    };
    const savedIdx = inlineEditIdx >= 0 ? inlineEditIdx : items.length;
    if (inlineEditIdx >= 0) items[inlineEditIdx] = line;
    else items.push(line);
    closeAddItemPanel();
    renderItems();
    const pid = line.pricing_item_id;
    const tableDesc = row ? catalogDescriptionForRow(row) : '';
    const descChanged =
      !!pid &&
      !!row &&
      normalizeDescText(lineDesc) !== normalizeDescText(descriptionBodyWithoutTitle(name, tableDesc)) &&
      normalizeDescText(lineDesc) !== normalizeDescText(tableDesc);
    const src = catalogPricingSource();
    const tableRate = row ? systemRateForCatalogRow(row, src) : 0;
    const rateChanged = !!pid && !!row && !ratesNearlyEqual(sellRate, tableRate);
    const descOffer = descChanged
      ? {
          itemIdx: savedIdx,
          newDesc: lineDesc,
          tableDesc,
          pricingItemId: String(pid),
          row,
        }
      : null;
    setTimeout(() => {
      if (rateChanged) {
        if (descOffer) pendingDescOffer = descOffer;
        maybeOfferRatePersist({
          itemIdx: savedIdx,
          newRate: sellRate,
          pricingItemId: String(pid),
          tableRate,
          row,
          src,
        });
      } else if (descOffer) {
        maybeOfferDescPersist(descOffer);
      }
    }, 80);
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
          filter: '.qb-item-editor',
          preventOnFilter: false,
          group: 'qb-quote-lines',
          ghostClass: 'sortable-ghost',
          onEnd: () => {
            syncItemsOrderFromDom();
            renderItems();
            qbMarkDirty();
          },
        })
      );
    });
  }

  /** Plain number for an inline input (no thousands separator, trimmed decimals). */
  function inlineNum(n, decimals) {
    const v = Number(n) || 0;
    return decimals ? v.toFixed(2) : String(Math.round(v * 100) / 100);
  }

  /** One line of the quote: name/description open the full editor; quantity and price edit in place. */
  function createItemCard(it, idx) {
    const amt = lineAmount(Number(it.quantity) || 0, Number(it.rate) || 0);
    const name = it.name != null ? String(it.name).trim() : '';
    let desc = it.description != null ? String(it.description).trim() : '';
    // Older lines saved "Name Description" in the description: don't repeat the name.
    desc = descriptionBodyWithoutTitle(name, desc);
    const isProduct = it.item_type === 'product';
    const badges = [];
    if (it.estimateAuto) badges.push('<span class="qb-item-card__badge qb-item-card__badge--auto">auto</span>');
    if (isProduct) badges.push('<span class="qb-item-card__badge qb-item-card__badge--product">produto</span>');
    const markup =
      it.markup_percentage != null && Number.isFinite(Number(it.markup_percentage)) && Number(it.markup_percentage) !== 0
        ? `<span class="qb-row__mk">${Number(it.markup_percentage)}% margem</span>`
        : '';
    const card = document.createElement('article');
    card.className = 'qb-item-card qb-row';
    card.setAttribute('role', 'listitem');
    card.setAttribute('data-item-idx', String(idx));
    card.innerHTML = `
        <div class="qb-item-card__grip" aria-hidden="true" title="Arrastar para reordenar">⋮⋮</div>
        <div class="qb-row__name" data-edit="${idx}" role="button" tabindex="0" title="Editar descrição e detalhes">
          <b>${escapeHtmlText(name || 'Sem nome')}</b>${badges.join('')}
          ${desc ? `<small>${formatRichHtml(desc)}</small>` : ''}${markup}
        </div>
        <label class="qb-row__qty"><span class="qb-row__lbl">Qtd</span><input type="text" inputmode="decimal" data-qty="${idx}" value="${inlineNum(it.quantity)}" aria-label="Quantidade de ${escapeHtmlText(name)}" autocomplete="off" /></label>
        <span class="qb-row__unit">${escapeHtmlText(unitLabel(it.unit_type))}</span>
        <label class="qb-row__rate"><span class="qb-row__lbl">Preço</span><span class="qb-row__cur">$</span><input type="text" inputmode="decimal" data-rate="${idx}" value="${inlineNum(it.rate, true)}" aria-label="Preço de ${escapeHtmlText(name)}" autocomplete="off" /></label>
        <span class="qb-row__total" data-total="${idx}">${money(amt)}</span>
        <div class="qb-row__act">
          <button type="button" class="qb-row__ic" data-edit="${idx}" title="Editar" aria-label="Editar ${escapeHtmlText(name)}">✎</button>
          <button type="button" class="qb-row__ic qb-row__ic--del" data-del="${idx}" title="Remover" aria-label="Remover ${escapeHtmlText(name)}">×</button>
        </div>`;
    return card;
  }

  function renderItems() {
    const list = $('itemsList');
    if (!list) return;
    // Panel may be docked inside the list — move it out before wiping DOM.
    restoreAddItemPanelHome();
    destroyItemSortables();
    list.innerHTML = '';
    updateItemsCountLabel();

    const buckets = { Supply: [], Installation: [], 'Sand & Finishing': [], products: [] };
    items.forEach((it, idx) => {
      if (it.item_type === 'product') buckets.products.push(idx);
      else buckets[normalizeServiceType(it.service_type)].push(idx);
    });

    if (items.length) {
      const headRow = document.createElement('div');
      headRow.className = 'qb-rows-head';
      headRow.setAttribute('aria-hidden', 'true');
      headRow.innerHTML = '<span></span><span>Serviço</span><span class="r">Qtd</span><span>Un.</span><span class="r">Preço</span><span class="r">Total</span><span></span>';
      list.appendChild(headRow);
    }
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
      head.textContent = 'Materiais e produtos';
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
    dockAddItemPanel();
  }

  async function api(path, opt) {
    const r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...opt,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || r.statusText);
    const method = String((opt && opt.method) || 'GET').toUpperCase();
    if ((method === 'POST' || method === 'PUT') && /^\/api\/quotes(\/[^/]+)?\/full$/.test(path)) {
      const q = j && j.data && (j.data.quote || j.data);
      if (q && q.created_at && !qbMeta.created_at) qbMeta.created_at = q.created_at;
      if (q && q.work_order_id) qbMeta.work_order_id = q.work_order_id;
      if (j.created_job_id) qbMeta.work_order_id = j.created_job_id;
      setTimeout(() => {
        qbSetDirty(false);
        qbRenderProgress();
      }, 0);
    }
    return j;
  }

  /** API returns the quote at `data` (sometimes nested as `data.quote`). */
  function quoteFromApiResponse(r) {
    const d = r && r.data;
    if (!d) return null;
    if (d.quote && typeof d.quote === 'object') return d.quote;
    if (d.id != null) return d;
    return null;
  }


  function isQuoteNumberForPublicUrl(quoteNumber) {
    return /^(?:SF|Q|OM)-\d{4}-\d+$/i.test(String(quoteNumber || '').trim());
  }

  function canonicalPublicQuoteNumber(quoteNumber) {
    const m = String(quoteNumber || '')
      .trim()
      .match(/^(SF|Q|OM)-(\d{4})-(\d+)$/i);
    if (!m) return '';
    // Preserve existing public links (SF/Q); normalize Q → OM for new-style numbers.
    const prefix = m[1].toUpperCase() === 'Q' ? 'OM' : m[1].toUpperCase();
    return `${prefix}-${m[2]}-${String(parseInt(m[3], 10)).padStart(4, '0')}`;
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
  /** @type {{ quote_total: number, invoiced_total: number, remaining_to_invoice: number, paid_total?: number, remaining_due?: number } | null} */
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
    const active = quoteInvoices.filter((inv) => String(inv.status || '').toLowerCase() !== 'void');
    const invoiced = active.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
    const paid = active.reduce((s, inv) => s + (Number(inv.paid_amount) || 0), 0);
    const invoiced_total = Math.round(invoiced * 100) / 100;
    const paid_total = Math.round(paid * 100) / 100;
    const remaining_to_invoice = Math.round(Math.max(0, quoteTotal - invoiced_total) * 100) / 100;
    const remaining_due = Math.round(Math.max(0, quoteTotal - paid_total) * 100) / 100;
    return {
      quote_total: Math.round(quoteTotal * 100) / 100,
      invoiced_total,
      paid_total,
      remaining_to_invoice,
      remaining_due,
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
    const paid = Number(bal.paid_total) || 0;
    const due =
      bal.remaining_due != null
        ? Number(bal.remaining_due)
        : Math.max(0, Number(bal.quote_total) - paid);
    const text = `Total ${money(bal.quote_total)} · Faturado ${money(bal.invoiced_total)} · Pago ${money(paid)} · Em aberto ${money(due)}`;
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
      await window.crmPdfViewer.openFromUrl(url, { title: title || 'Fatura', filename });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function invoiceTypeLabel(type) {
    const map = {
      deposit: 'Depósito',
      final: 'Saldo restante',
      full: 'Valor total',
      progress: 'Parcela',
      custom: 'Personalizado',
      payment: 'Pagamento',
    };
    return map[type] || type || 'Pagamento';
  }

  function invoiceStatusLabel(status) {
    const map = {
      draft: 'Rascunho',
      issued: 'Emitida',
      sent: 'Enviada',
      viewed: 'Vista',
      partial: 'Parcial',
      partially_paid: 'Parcial',
      overdue: 'Vencida',
      paid: 'Paga',
      void: 'Anulada',
      cancelled: 'Cancelada',
    };
    return map[status] || status || 'Emitida';
  }

  function renderQuoteInvoicesList() {
    const host = $('quoteInvoicesList');
    if (!host) return;
    if (!quoteInvoices.length) {
      host.innerHTML = '<p class="text-xs text-slate-500">Nenhuma fatura emitida ainda.</p>';
      return;
    }
    /* Faturas vivem no módulo próprio (invoice.html): aqui só o resumo e atalhos. */
    host.innerHTML = quoteInvoices
      .map((inv) => {
        const st = inv.display_status || inv.status || 'draft';
        const paid = Number(inv.paid_amount) || 0;
        const remaining = Number(inv.remaining_amount != null ? inv.remaining_amount : Math.max(0, Number(inv.amount) - paid));
        const href = `invoice.html?id=${encodeURIComponent(inv.id)}`;
        const payMeta =
          st === 'paid'
            ? ' · paga'
            : paid > 0.009
              ? ` · pago ${money(paid)} · falta ${money(remaining)}`
              : '';
        const canReceive = st !== 'paid' && st !== 'void' && remaining > 0.009;
        return `<article class="qb-invoice-card${st === 'void' ? ' is-void' : ''}" data-invoice-id="${inv.id}">
          <a class="qb-invoice-card__head" href="${href}">
            <span>${escapeHtmlText(inv.invoice_number || 'Fatura')}</span>
            <span>${money(inv.amount)}</span>
          </a>
          <div class="qb-invoice-card__meta">${escapeHtmlText(invoiceTypeLabel(inv.invoice_type))} · ${escapeHtmlText(invoiceStatusLabel(st))}${inv.due_date && st !== 'paid' && st !== 'void' ? ` · vence ${escapeHtmlText(String(inv.due_date).slice(0, 10))}` : ''}${payMeta}</div>
          <div class="qb-invoice-card__actions">
            <a class="btn btn-sm btn-secondary" href="${href}">Abrir fatura</a>
            ${canReceive ? `<a class="btn btn-sm btn-primary" href="${href}&action=pay">Receber</a>` : ''}
          </div>
        </article>`;
      })
      .join('');
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
      quotePaidTotal = Number(quoteInvoiceBalance?.paid_total) || 0;
    } catch {
      quoteInvoices = [];
      quoteInvoiceBalance = null;
      quotePaidTotal = 0;
    }
    renderQuoteInvoicesList();
    renderInvoiceBalanceSummary();
    syncInvoiceUiVisibility();
    recalc();
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
      throw new Error('Só é possível emitir fatura quando o orçamento está aprovado.');
    }
    if (isQuoteApprovedStatus(loadedQuoteStatus)) return;
    await ensureCustomerForQuote();
    const body = payload();
    body.status = desired;
    const r = await api(`/api/quotes/${quoteId}/full`, { method: 'PUT', body: JSON.stringify(body) });
    const q = quoteFromApiResponse(r);
    loadedQuoteStatus = q?.status || desired;
    if (q) {
      loadedQuoteNumber =
        q.quote_number != null ? String(q.quote_number).trim() : loadedQuoteNumber;
      $('quoteMeta').textContent = `Orçamento ${q.quote_number || '#' + q.id} · total ${money(q.total_amount)}`;
      updatePreviewHeader();
      setPublicLink(q.public_token, q.quote_number);
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
      const inv = r.data;
      /* A fatura tem módulo próprio: seguir para ela em vez de ficar no orçamento. */
      if (inv?.id) {
        qbForceNavigate(`invoice.html?id=${encodeURIComponent(inv.id)}&new=1`);
        return;
      }
      await loadQuoteInvoices();
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao emitir fatura');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Emitir fatura';
      }
    }
  }

  async function sendQuoteInvoiceEmail(invoiceId) {
    if (!invoiceId) return;
    try {
      await api(`/api/quote-invoices/${invoiceId}/send-email`, { method: 'POST', body: '{}' });
      window.crmToast?.success?.('Fatura enviada por e-mail ao cliente.');
      await loadQuoteInvoices();
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao enviar fatura');
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
          : 'Fatura sem saldo em aberto.';
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

  async function previewReceiptEmail() {
    const invoiceId = $('rcpInvoiceId')?.value;
    if (!invoiceId) return;
    const amount = parseFloat($('rcpAmount')?.value);
    if (!(amount > 0)) {
      window.crmToast?.error?.('Indique o valor recebido.');
      return;
    }
    const body = {
      amount,
      mode: 'partial',
      payment_date: $('rcpPaymentDate')?.value || undefined,
      payment_method: $('rcpMethod')?.value || 'check',
      reference_number: $('rcpReference')?.value || undefined,
      notes: $('rcpNotes')?.value || undefined,
      send_email: true,
    };
    try {
      const preview = await api(`/api/quote-invoices/${invoiceId}/receipt-email-preview`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      openEmailPreviewModal(preview, { kind: 'receipt', invoiceId, body });
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Não foi possível pré-visualizar o e-mail.');
    }
  }

  async function confirmSendReceiptEmail() {
    const action = pendingEmailAction;
    if (!action || action.kind !== 'receipt' || !action.invoiceId) return;
    const btn = $('btnEmailPreviewSend');
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A processar…';
    }
    try {
      const emailTo = String($('qbEmailPreviewTo')?.value || '').trim() || action.body?.email_to || undefined;
      const r = await api(`/api/quote-invoices/${action.invoiceId}/receipts`, {
        method: 'POST',
        body: JSON.stringify({ ...action.body, send_email: true, email_to: emailTo }),
      });
      closeEmailPreviewModal();
      closeReceiptModal();
      if (r.balance) {
        quoteInvoiceBalance = r.balance;
        quotePaidTotal = Number(r.balance.paid_total) || 0;
      }
      const paidNote = r.invoice_paid ? ' Fatura liquidada.' : '';
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
      recalc();
      if (r.data?.id) {
        void openReceiptPdf(r.data.id, r.data.receipt_number ? `Recibo ${r.data.receipt_number}` : 'Recibo');
      }
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao gerar recibo');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Registrar e enviar';
      }
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
    if ($('rcpSendEmail')?.checked) {
      await previewReceiptEmail();
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
        send_email: false,
      };
      const r = await api(`/api/quote-invoices/${invoiceId}/receipts`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      closeReceiptModal();
      if (r.balance) {
        quoteInvoiceBalance = r.balance;
        quotePaidTotal = Number(r.balance.paid_total) || 0;
      }
      const paidNote = r.invoice_paid ? ' Fatura liquidada.' : '';
      window.crmToast?.success?.(
        `Recibo ${r.data?.receipt_number || ''} · ${money(r.data?.amount)}.${paidNote}`
      );
      await loadQuoteInvoices();
      recalc();
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
    if (!confirm(`Excluir a fatura ${label}? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/quote-invoices/${invoiceId}`, { method: 'DELETE' });
      window.crmToast?.success?.(`Fatura ${label} excluída.`);
      await loadQuoteInvoices();
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Erro ao excluir a fatura');
    }
  }

  /** New quote: validity, terms and tax from Configurações › Orçamentos. */
  async function loadQuoteShareSettings() {
    try {
      const r = await api('/api/quotes/settings/defaults');
      const d = r.data || {};
      if (d.share_messages && typeof d.share_messages === 'object') {
        if (d.share_messages.sms_body) quoteShareMessages.sms_body = String(d.share_messages.sms_body);
        if (d.share_messages.followup_body) {
          quoteShareMessages.followup_body = String(d.share_messages.followup_body);
        }
      }
      if (d.company_name) quoteShareCompanyName = String(d.company_name).trim();
      return d;
    } catch (_) {
      return {};
    }
  }

  async function applyNewQuoteDefaults() {
    try {
      const d = await loadQuoteShareSettings();
      const exp = $('expirationDate');
      if (exp && !exp.value && d.validity_days) {
        const dt = new Date();
        dt.setDate(dt.getDate() + Number(d.validity_days));
        exp.value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
      const terms = $('terms');
      if (terms && !terms.value.trim() && d.terms) terms.value = d.terms;
      defaultTaxRate = Number(d.tax_rate) || 0;
      const meta = $('quoteMeta');
      if (meta && d.next_label) meta.textContent = `Novo orçamento · será ${d.next_label}`;
    } catch (_) {
      /* defaults are optional */
    }
  }

  let ownerSignaturePad = null;

  function createOwnerSignaturePad() {
    const canvas = $('ownerSignCanvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasStroke = false;
    ctx.strokeStyle = '#1c1917';
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
            : 'Assinatura padrão salva para todos os orçamentos.';
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
      qbToast('Indique o nome antes de salvar.', 'error');
      return;
    }
    if (!title || title.length < 2) {
      qbToast('Indique o cargo antes de salvar.', 'error');
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
      btn.textContent = 'Salvando…';
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
      qbToast('Assinatura padrão salva para todos os orçamentos.', 'success');
      ownerSignaturePad.clear();
      await loadOwnerSignatureSettings();
    } catch (err) {
      qbToast(err.message || 'Erro ao salvar a assinatura', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Salvar assinatura padrão';
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
    $('btnRcpPreviewEmail')?.addEventListener('click', () => void previewReceiptEmail());
    $('qbReceiptModal')?.addEventListener('click', (e) => {
      if (e.target === $('qbReceiptModal')) closeReceiptModal();
    });
    $('btnEmailPreviewCancel')?.addEventListener('click', closeEmailPreviewModal);
    $('btnEmailPreviewSend')?.addEventListener('click', () => void confirmSendQuoteEmail());
    $('qbEmailPreviewModal')?.addEventListener('click', (e) => {
      if (e.target === $('qbEmailPreviewModal')) closeEmailPreviewModal();
    });
    const previewExtraChips = $('qbEmailPreviewExtraChips');
    if (previewExtraChips) {
      previewExtraChips.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-preview-email]');
        if (!btn) return;
        removePreviewExtraEmail(btn.getAttribute('data-remove-preview-email'));
      });
    }
    const previewExtraInput = $('qbEmailPreviewExtraInput');
    if (previewExtraInput) {
      previewExtraInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          tryCommitPreviewExtraEmailInput();
        } else if (e.key === 'Backspace' && !String(previewExtraInput.value || '') && previewExtraEmails.length) {
          removePreviewExtraEmail(previewExtraEmails.length - 1);
        }
      });
      // Mobile keyboards: Done/OK often blurs the field instead of sending Enter.
      previewExtraInput.addEventListener('blur', () => {
        tryCommitPreviewExtraEmailInput({ quietInvalid: true });
      });
      previewExtraInput.addEventListener('change', () => {
        setTimeout(() => tryCommitPreviewExtraEmailInput({ quietInvalid: true }), 0);
      });
    }
    $('btnEmailPreviewExtraAdd')?.addEventListener('click', () => {
      tryCommitPreviewExtraEmailInput({ quietInvalid: false });
      $('qbEmailPreviewExtraInput')?.focus();
    });
    $('status')?.addEventListener('change', () => {
      syncInvoiceUiVisibility();
      qbRenderProgress();
    });
  }

  function enableActions() {
    $('btnPdf').disabled = !quoteId;
    const btnSend = $('btnSend');
    if (btnSend) btnSend.disabled = !quoteId;
    $('btnDup').disabled = !quoteId;
    if ($('btnDeleteQuote')) $('btnDeleteQuote').disabled = !quoteId;
    syncInvoiceUiVisibility();
    if (!quoteId) {
      updateEmailSentBadge(null);
      updateQuoteViewedBadge(null);
      updatePdfViewedBadge(null);
      stopQuoteViewPolling();
    }
  }

  async function deleteQuote() {
    if (!quoteId) return;
    const label = loadedQuoteNumber || `#${quoteId}`;
    if (
      !confirm(
        `Excluir o orçamento ${label}?\n\nEsta ação não pode ser desfeita. Faturas ligadas a este orçamento também podem ser removidas.`,
      )
    ) {
      return;
    }
    const btn = $('btnDeleteQuote');
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Excluindo…';
    }
    try {
      await api(`/api/quotes/${encodeURIComponent(quoteId)}`, { method: 'DELETE' });
      window.crmToast?.success?.(`Orçamento ${label} excluído.`);
      qbForceNavigate('quotes.html');
    } catch (err) {
      window.crmToast?.error?.(err.message || 'Não foi possível excluir o orçamento.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || 'Excluir';
      }
      enableActions();
    }
  }

  async function loadQuote(id) {
    const qid = String(id || '').trim();
    if (!qid || qid === 'NaN') return;
    const r = await api(`/api/quotes/${encodeURIComponent(qid)}`);
    const q = r.data;
    if (!q) return;
    quoteId = q.id;
    loadedQuoteLeadId = q.lead_id != null && q.lead_id !== '' ? String(q.lead_id) : null;
    $('customerId').value = q.customer_id || '';
    const payload = q.payload && typeof q.payload === 'object' ? q.payload : {};
    if ($('quoteJobName')) $('quoteJobName').value = q.job_name || payload.job_name || q.title || '';
    if ($('quoteJobAddress')) $('quoteJobAddress').value = q.job_address || payload.job_address || '';
    await loadQuoteBuilders();
    const isBuilderQuote =
      String(q.quote_party || payload.quote_party || '') === 'builder' ||
      (q.builder_id != null && String(q.builder_id).trim() !== '');
    if (isBuilderQuote) {
      setQuoteParty('builder', { applyPrices: false });
      const bid = String(q.builder_id || '');
      const b = quoteBuilders.find((x) => String(x.id) === bid) || (bid ? { id: bid, customer_id: q.customer_id } : null);
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
    loadedQuoteNotes = q.notes || null;
    if ($('notes')) $('notes').value = loadedQuoteNotes || '';
    $('terms').value = q.terms_conditions || q.terms || '';
    $('discountType').value = q.discount_type || 'percentage';
    $('discountValue').value = q.discount_value ?? 0;
    $('taxTotal').value = q.tax_total ?? 0;
    items = (q.items || []).map((it) => {
      const rate = Number(it.rate != null ? it.rate : it.unit_price) || 0;
      const unitType =
        it.unit_type ||
        (String(it.unit || '').toLowerCase() === 'sqft' || String(it.unit || '').toLowerCase() === 'sq_ft'
          ? 'sq_ft'
          : String(it.unit || '').toLowerCase() === 'each' || String(it.unit || '').toLowerCase() === 'fixed'
            ? 'fixed'
            : it.unit || 'sq_ft');
      return {
        item_type: it.item_type || 'service',
        name: it.name != null ? String(it.name) : '',
        description: it.description != null ? String(it.description) : '',
        unit_type: unitType,
        quantity: it.quantity,
        rate,
        notes: it.notes,
        service_type: it.item_type === 'product' ? null : normalizeServiceType(it.service_type),
        catalog_customer_notes: it.catalog_customer_notes || null,
        service_catalog_id: normalizeCatalogId(it.service_catalog_id),
        pricing_item_id: it.pricing_item_id != null ? String(it.pricing_item_id) : null,
        product_id: it.product_id != null ? it.product_id : null,
        cost_price: it.cost_price != null ? Number(it.cost_price) : null,
        markup_percentage: it.markup_percentage != null ? Number(it.markup_percentage) : null,
        sell_price: it.sell_price != null ? Number(it.sell_price) : rate,
        estimateAuto: false,
      };
    });
    for (const it of items) {
      if (!it.pricing_item_id) {
        const pid = catalogPricingItemId(catalogRowForItem(it));
        if (pid) it.pricing_item_id = pid;
      }
    }
    loadedQuoteNumber = q.quote_number != null ? String(q.quote_number).trim() : null;
    const totalAmt = q.total_amount != null ? q.total_amount : q.total;
    $('quoteMeta').textContent = `Orçamento ${q.quote_number || '#' + q.id} · total ${money(totalAmt)}`;
    updateEmailSentBadge(q.email_sent_at || null);
    quoteViewNotifyShown = !!q.viewed_at;
    quotePdfNotifyShown = !!q.pdf_viewed_at;
    updateQuoteViewedBadge(q.viewed_at || null, { keepNotifyFlag: true });
    updatePdfViewedBadge(q.pdf_viewed_at || null, { keepNotifyFlag: true });
    qbMeta = {
      created_at: q.created_at || null,
      email_sent_at: q.email_sent_at || null,
      viewed_at: q.viewed_at || null,
      pdf_viewed_at: q.pdf_viewed_at || null,
      signed_at: q.signed_at || null,
      work_order_id: q.work_order_id || null,
    };
    startQuoteViewPolling();
    updatePreviewHeader();
    renderClientDetails();
    setPublicLink(q.public_token, q.quote_number);
    enableActions();
    qbRenderProgress();
    qbSetDirty(false);
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
    const { sub, tax, total } = recalc();
    const dt = $('discountType').value;
    const dv = parseFloat($('discountValue').value) || 0;
    const party = getQuoteParty();
    let lead_id = null;
    if (selectedQuoteLead && selectedQuoteLead.id != null) lead_id = String(selectedQuoteLead.id);
    else if (loadedQuoteLeadId != null && loadedQuoteLeadId !== '') lead_id = String(loadedQuoteLeadId);
    else if (pendingLeadId != null && pendingLeadId !== '') lead_id = String(pendingLeadId);
    const builderRaw = party === 'builder' ? String($('quoteBuilderSelect')?.value || '').trim() : '';
    const jobName = String($('quoteJobName')?.value || '').trim().slice(0, 120);
    const jobAddr =
      party === 'builder' || party === 'contractor' || party === 'loja'
        ? String($('quoteJobAddress')?.value || '').trim()
        : '';
    const customerRaw = String($('customerId')?.value || '').trim();
    const base = {
      customer_id: customerRaw || null,
      quote_party: party,
      builder_id: builderRaw || null,
      job_name: jobName || null,
      job_address: jobAddr || null,
      status: $('status').value,
      expiration_date: $('expirationDate').value || null,
      notes: $('notes') ? ($('notes').value || null) : loadedQuoteNotes,
      terms_conditions: $('terms').value || null,
      discount_type: dt,
      discount_value: dv,
      tax_total: tax,
      subtotal: sub,
      total,
      items: items.map((it) => ({
        item_type: it.item_type || 'service',
        name: it.name != null && String(it.name).trim() ? String(it.name).trim() : null,
        description: it.description != null && String(it.description).trim() ? String(it.description).trim() : null,
        unit_type: it.unit_type || 'sq_ft',
        quantity: Number(it.quantity) || 0,
        rate: Number(it.rate) || 0,
        unit_price: Number(it.rate) || 0,
        notes: it.notes || null,
        service_type: it.item_type === 'product' ? null : normalizeServiceType(it.service_type),
        catalog_customer_notes: it.catalog_customer_notes || null,
        service_catalog_id: normalizeCatalogId(it.service_catalog_id),
        product_id: it.product_id != null ? String(it.product_id) : null,
        cost_price: it.cost_price != null ? Number(it.cost_price) : null,
        markup_percentage: it.markup_percentage != null ? Number(it.markup_percentage) : null,
        sell_price: it.sell_price != null ? Number(it.sell_price) : Number(it.rate) || null,
      })),
    };
    if (lead_id != null) base.lead_id = lead_id;
    // Never send lead_id: null — a null wipe was clearing the Kanban link on every save.
    return base;
  }

  /** @returns {Promise<boolean>} true when the quote was saved successfully */
  async function saveQuote() {
    let cid;
    try {
      cid = await ensureCustomerForQuote();
    } catch (e) {
      qbToast(e.message || 'Selecione um lead ou um builder.', 'error');
      return false;
    }
    if (getQuoteParty() === 'lead' && !cid) {
      qbToast('Selecione um cliente (lead).', 'error');
      return false;
    }
    const body = payload();
    const wasApproved = isQuoteApprovedStatus(loadedQuoteStatus);
    try {
      if (quoteId) {
        const r = await api(`/api/quotes/${quoteId}/full`, { method: 'PUT', body: JSON.stringify(body) });
        const q = quoteFromApiResponse(r);
        if (q) {
          loadedQuoteStatus = q.status || body.status || loadedQuoteStatus;
          loadedQuoteNumber = q.quote_number != null ? String(q.quote_number).trim() : null;
          $('quoteMeta').textContent = `Orçamento ${q.quote_number || '#' + q.id} · total ${money(q.total_amount)}`;
          updatePreviewHeader();
          setPublicLink(q.public_token, q.quote_number);
        }
        await loadQuoteInvoices();
        if (isQuoteApprovedStatus(loadedQuoteStatus)) {
          syncInvoiceUiVisibility();
          const createdIds = Array.isArray(r.created_invoice_ids) ? r.created_invoice_ids : [];
          const hasInvoice = createdIds.length > 0 || quoteInvoices.length > 0;
          const jobCreated = Boolean(r.created_job_id);
          if (!wasApproved) {
            let msg = 'Orçamento aprovado';
            if (hasInvoice && jobCreated) msg = 'Orçamento aprovado — fatura e job criados.';
            else if (hasInvoice) msg = 'Orçamento aprovado — fatura criada.';
            else if (jobCreated) msg = 'Orçamento aprovado — job criado (fatura pendente).';
            else msg = 'Orçamento aprovado, mas a fatura não foi criada. Salve de novo ou emita manualmente.';
            qbToast(msg, hasInvoice || jobCreated ? 'success' : 'error');
            enableActions();
            return true;
          }
          // Backfill path: already approved, save again to create missing invoice.
          if (!hasInvoice) {
            qbToast('Orçamento aprovado sem fatura — tente salvar de novo.', 'error');
          }
        }
      } else {
        const r = await api('/api/quotes/full', { method: 'POST', body: JSON.stringify(body) });
        const q = quoteFromApiResponse(r);
        if (!q || q.id == null) throw new Error('Resposta inválida ao criar orçamento.');
        quoteId = q.id;
        const lid =
          pendingLeadId != null && pendingLeadId !== ''
            ? pendingLeadId
            : selectedQuoteLead?.id != null
              ? selectedQuoteLead.id
              : null;
        history.replaceState(
          {},
          '',
          lid ? `?id=${quoteId}&lead_id=${encodeURIComponent(lid)}` : `?id=${quoteId}`
        );
        await loadQuote(quoteId);
        if (isQuoteApprovedStatus(loadedQuoteStatus) && !quoteInvoices.length) {
          const createdIds = Array.isArray(r.created_invoice_ids) ? r.created_invoice_ids : [];
          const jobCreated = Boolean(r.created_job_id);
          let msg = 'Orçamento aprovado';
          if (createdIds.length && jobCreated) msg = 'Orçamento aprovado — fatura e job criados.';
          else if (createdIds.length) msg = 'Orçamento aprovado — fatura criada.';
          else if (jobCreated) msg = 'Orçamento aprovado — job criado (fatura pendente).';
          else msg = 'Orçamento aprovado, mas a fatura não foi criada. Salve de novo ou emita manualmente.';
          qbToast(msg, createdIds.length || jobCreated ? 'success' : 'error');
          enableActions();
          return true;
        }
      }
      qbToast('Salvo.', 'success');
      enableActions();
      await loadQuoteInvoices();
      return true;
    } catch (e) {
      qbToast(e.message || 'Erro ao salvar', 'error');
      return false;
    }
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      $('authMsg').textContent = 'É necessária sessão — inicie sessão no CRM primeiro.';
      $('authMsg').classList.remove('hidden');
      return;
    }

    const [custRes, tplRes, uiRes] = await Promise.all([
      api('/api/customers?limit=100'),
      api('/api/quote-templates').catch(() => ({ data: [] })),
      fetch('/api/config/ui', { credentials: 'include' })
        .then((r) => r.json())
        .catch(() => ({})),
    ]);
    clients = custRes.data || [];
    templates = tplRes.data || [];
    await loadServiceCatalog();
    if (uiRes.success && uiRes.data && uiRes.data.publicCrmUrl) {
      clientPublicCrmUrl = String(uiRes.data.publicCrmUrl).replace(/\/$/, '');
    }

    wireClientLeadSearch();
    wireOrgCustomerSearch();
    attachItemsListHandlers();
    wireMarginPricingFields();
    bootQuoteAddressAutocomplete();
    await loadQuoteBuilders();
    $('qbPartyLead')?.addEventListener('click', () => setQuoteParty('lead'));
    $('qbPartyBuilder')?.addEventListener('click', () => {
      setQuoteParty('builder');
      void loadQuoteBuilders();
    });
    $('qbPartyContractor')?.addEventListener('click', () => {
      setQuoteParty('contractor');
      scheduleOrgCustomerSearch();
    });
    $('qbPartyLoja')?.addEventListener('click', () => {
      setQuoteParty('loja');
      scheduleOrgCustomerSearch();
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
    if (leadParam && String(leadParam).trim()) {
      pendingLeadId = String(leadParam).trim();
    }
    if (qid) {
      await Promise.all([loadQuote(qid), loadQuoteShareSettings()]);
    } else {
      items = [];
      loadedQuoteLeadId = null;
      loadedQuoteNumber = null;
      quoteId = null;
      $('quoteMeta').textContent = 'Novo orçamento';
      await applyNewQuoteDefaults();
      updatePreviewHeader();
      renderClientDetails();
      updateClientActionButtons();
      setPublicLink(null);
      enableActions();
      renderItems();
    }

    updateClientActionButtons();

    if (pendingLeadId != null && String(pendingLeadId).trim() !== '') {
      const alreadyBound =
        (selectedQuoteLead && sameId(selectedQuoteLead.id, pendingLeadId)) ||
        (loadedQuoteLeadId != null && sameId(loadedQuoteLeadId, pendingLeadId));
      if (!alreadyBound || !selectedQuoteLead) {
        try {
          const lr = await fetch(`/api/leads/${encodeURIComponent(String(pendingLeadId))}`, {
            credentials: 'include',
          }).then((r) => r.json());
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
    $('modalServiceMarkup')?.addEventListener('keydown', handleServiceFormEnter);
    $('inlineItemNote')?.addEventListener('keydown', handleServiceFormEnter);
    $('modalServiceDesc')?.addEventListener('keydown', (e) => {
      // Enter = nova linha (deixar o browser inserir \n). Ctrl/⌘+Enter = salvar.
      if (e.key !== 'Enter') return;
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey) {
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
        const cid = btn.getAttribute('data-catalog-id');
        const row = findCatalogRowById(cid);
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
    addItemPanel?.addEventListener('keydown', handleServiceEditorTab);
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
      taxIn.addEventListener('input', () => {
        taxTouched = true;
        recalc();
      });
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
      const btn = $('btnPdf');
      const prevLabel = btn?.textContent || 'Gerar PDF';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'A gerar…';
      }
      try {
        // PDF reads from the DB — persist unsaved description/price edits first.
        if (qbDirtyFlag || !quoteId) {
          const ok = await saveQuote();
          if (!ok) return;
        }
        if (!quoteId) return;
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
    wireSaveRateModal();
    wireSaveDescModal();
    ensureServiceDescRichText();
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

    $('btnSend')?.addEventListener('click', (e) => {
      if (!quoteId) return;
      toggleQuoteSendMenu(e.currentTarget);
    });
    $('quoteSendByEmail')?.addEventListener('click', () => void sendQuoteByEmail());
    $('quoteSendBySms')?.addEventListener('click', () => void sendQuoteByMessage());
    $('btnDup').addEventListener('click', async () => {
      if (!quoteId) return;
      const r = await api(`/api/quotes/${quoteId}/duplicate`, { method: 'POST', body: '{}' });
      const q = quoteFromApiResponse(r);
      if (q && q.id != null) {
        qbForceNavigate('quote-builder.html?id=' + encodeURIComponent(q.id));
      }
    });
    $('btnDeleteQuote')?.addEventListener('click', () => void deleteQuote());

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
        qbToast('Template salvo.', 'success');
      } catch (e) {
        qbToast(e.message || 'Erro ao salvar template', 'error');
      }
    });

    function syncQbProxyActions() {
      document.querySelectorAll('[data-qb-proxy]').forEach((proxy) => {
        const src = document.getElementById(proxy.getAttribute('data-qb-proxy'));
        if (!src) return;
        proxy.disabled = !!src.disabled;
        proxy.hidden = src.classList.contains('hidden') || !!src.hidden;
      });
    }
    document.querySelectorAll('[data-qb-proxy]').forEach((proxy) => {
      if (proxy.dataset.bound === '1') return;
      proxy.dataset.bound = '1';
      proxy.addEventListener('click', (e) => {
        const id = proxy.getAttribute('data-qb-proxy');
        const src = document.getElementById(id);
        if (!src || src.disabled || src.hidden) return;
        if (id === 'btnSend') {
          e.preventDefault();
          if (!quoteId) return;
          toggleQuoteSendMenu(proxy);
          return;
        }
        src.click();
      });
    });
    syncQbProxyActions();
    const actionBar = document.getElementById('qbActionBar');
    if (actionBar && typeof MutationObserver !== 'undefined') {
      new MutationObserver(syncQbProxyActions).observe(actionBar, {
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'hidden', 'class'],
      });
    }
  }

  // ---------------------------------------------------------------- painel (status, andamento, próximo passo)
  let qbMeta = { created_at: null, email_sent_at: null, viewed_at: null, pdf_viewed_at: null, signed_at: null, work_order_id: null };
  let qbDirtyFlag = false;
  /** When true, next navigation skips the unsaved-changes guard. */
  let qbLeaveAllow = false;
  let qbLeavePendingUrl = null;
  let qbProgressTimer = null;
  const QB_STATUS = {
    draft: ['Rascunho', 'draft'],
    sent: ['Enviado', 'sent'],
    viewed: ['Visualizado', 'viewed'],
    approved: ['Aprovado', 'approved'],
    accepted: ['Aceito', 'approved'],
    rejected: ['Recusado', 'rejected'],
  };

  function qbScheduleProgress() {
    clearTimeout(qbProgressTimer);
    qbProgressTimer = setTimeout(qbRenderProgress, 30);
  }
  function qbSetDirty(on) {
    qbDirtyFlag = Boolean(on) && Boolean(quoteId || items.length);
    const el = $('qbDirty');
    if (el) el.hidden = !qbDirtyFlag;
    document.querySelectorAll('[data-qb-proxy="btnSave"], #btnSave').forEach((b) => b.classList.toggle('qb-save--dirty', qbDirtyFlag));
  }
  function qbMarkDirty() {
    qbSetDirty(true);
  }

  function qbForceNavigate(url) {
    qbLeaveAllow = true;
    qbSetDirty(false);
    window.location.href = url;
  }

  function qbCloseLeaveModal() {
    const root = $('qbLeaveModal');
    if (root) root.classList.add('hidden');
    qbLeavePendingUrl = null;
    const saveBtn = $('qbLeaveSave');
    if (saveBtn) saveBtn.disabled = false;
  }

  function qbOpenLeaveModal(url) {
    qbLeavePendingUrl = url;
    const root = $('qbLeaveModal');
    if (root) root.classList.remove('hidden');
    $('qbLeaveSave')?.focus();
  }

  function qbRequestNavigate(url) {
    if (!url) return;
    if (qbLeaveAllow || !qbDirtyFlag) {
      qbForceNavigate(url);
      return;
    }
    qbOpenLeaveModal(url);
  }

  function qbIsInternalNavLink(a) {
    if (!a || !a.getAttribute) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    const raw = String(a.getAttribute('href') || '').trim();
    if (!raw || raw === '#' || raw.startsWith('#')) return false;
    if (/^(mailto:|tel:|sms:|javascript:)/i.test(raw)) return false;
    try {
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin) return false;
      if (u.pathname === location.pathname && u.search === location.search) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  async function qbLeaveSaveAndGo() {
    const url = qbLeavePendingUrl;
    if (!url) return;
    const btn = $('qbLeaveSave');
    if (btn) btn.disabled = true;
    try {
      const ok = await saveQuote();
      if (ok) {
        qbCloseLeaveModal();
        qbForceNavigate(url);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function qbLeaveDiscardAndGo() {
    const url = qbLeavePendingUrl;
    qbCloseLeaveModal();
    if (url) qbForceNavigate(url);
  }

  function wireLeaveGuard() {
    $('qbLeaveSave')?.addEventListener('click', () => void qbLeaveSaveAndGo());
    $('qbLeaveDiscard')?.addEventListener('click', () => qbLeaveDiscardAndGo());
    $('qbLeaveStay')?.addEventListener('click', () => qbCloseLeaveModal());
    const root = $('qbLeaveModal');
    if (root) {
      root.addEventListener('click', (e) => {
        if (e.target === root) qbCloseLeaveModal();
      });
    }
    document.addEventListener(
      'click',
      (e) => {
        if (!qbDirtyFlag || qbLeaveAllow) return;
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (typeof e.button === 'number' && e.button !== 0) return;
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!qbIsInternalNavLink(a)) return;
        e.preventDefault();
        e.stopPropagation();
        qbOpenLeaveModal(a.href);
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.classList.contains('hidden')) {
        e.preventDefault();
        qbCloseLeaveModal();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (qbLeaveAllow || !qbDirtyFlag) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }
  function qbWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const t = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${t}`;
  }
  function qbAgo(iso) {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return `hoje às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    if (days === 1) return `ontem às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    return `há ${days} dias`;
  }
  function qbDigits(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) d = `1${d}`;
    return d.length >= 11 ? d : '';
  }
  function qbClientFirstName() {
    const n = String($('qbClientName')?.textContent || $('qbBuilderContact')?.textContent || '').trim();
    return n && n !== '—' ? n.split(/\s+/)[0] : '';
  }
  function qbClientPhone() {
    const t = String($('qbClientPhone')?.textContent || $('qbBuilderPhone')?.textContent || $('qbOrgCustomerPhone')?.textContent || '').trim();
    return t === '—' ? '' : t;
  }

  function qbRenderProgress() {
    const status = String($('status')?.value || 'draft').toLowerCase();
    const [label, tone] = QB_STATUS[status] || [status, 'draft'];
    const pill = $('qbStatusPill');
    if (pill) {
      pill.textContent = label;
      pill.dataset.status = tone;
    }
    const job = String($('quoteJobName')?.value || '').trim();
    const tj = $('qbTopJob');
    if (tj) tj.textContent = job ? ` · ${job}` : '';

    const approved = isQuoteApprovedStatus(status);
    const sent = qbMeta.email_sent_at || ['sent', 'viewed', 'approved', 'accepted'].includes(status);
    const viewed = qbMeta.viewed_at || ['viewed', 'approved', 'accepted'].includes(status);
    const steps = [
      { on: Boolean(quoteId), label: 'Criado', at: qbMeta.created_at },
      { on: Boolean(sent), label: qbMeta.email_sent_at ? 'Enviado por e-mail' : 'Enviado', at: qbMeta.email_sent_at },
      { on: Boolean(viewed), label: 'Aberto pelo cliente', at: qbMeta.viewed_at },
      { on: approved, label: qbMeta.signed_at ? 'Aprovado e assinado' : 'Aprovado', at: qbMeta.signed_at },
      { on: Boolean(qbMeta.work_order_id), label: 'Job criado', at: null, href: qbMeta.work_order_id ? `job-detail.html?id=${encodeURIComponent(qbMeta.work_order_id)}` : null },
    ];
    if (status === 'rejected') steps.splice(3, 2, { on: true, label: 'Recusado pelo cliente', at: null, bad: true });
    const nowIdx = steps.findIndex((x) => !x.on);
    const prog = $('qbProgress');
    if (prog) {
      prog.innerHTML = `<h3 class="qb-side-t">Andamento</h3><ol class="qb-tl">${steps
        .map((x, i) => {
          const cls = x.bad ? 'is-bad' : x.on ? 'is-on' : i === nowIdx ? 'is-now' : '';
          const txt = x.href && x.on ? `<a href="${x.href}">${x.label} →</a>` : x.label;
          return `<li class="${cls}"><i aria-hidden="true">${x.bad ? '!' : x.on ? '✓' : ''}</i><span>${txt}</span>${x.at ? `<small>${qbWhen(x.at)}</small>` : ''}</li>`;
        })
        .join('')}</ol>`;
    }

    // Next step: one clear action for where the quote is.
    const box = $('qbNext');
    if (!box) return;
    const link = $('publicLink')?.href || '';
    const first = qbClientFirstName();
    const phone = qbDigits(qbClientPhone());
    let title = '';
    let text = '';
    let btn = '';
    if (!quoteId) {
      title = 'Monte o orçamento';
      text = 'Escolha o cliente, adicione os serviços e salve.';
      btn = '<button type="button" class="btn btn-primary" data-qb-proxy-now="btnSave">Salvar orçamento</button>';
    } else if (status === 'rejected') {
      title = 'Cliente recusou';
      text = 'Duplique para mandar uma nova versão com outro preço ou escopo.';
      btn = '<button type="button" class="btn btn-primary" data-qb-proxy-now="btnDup">Duplicar como nova versão</button>';
    } else if (approved && qbMeta.work_order_id) {
      title = 'Aprovado — job criado';
      text = 'Agende a equipe e acompanhe as faturas pelo job.';
      btn = `<a class="btn btn-primary" href="job-detail.html?id=${encodeURIComponent(qbMeta.work_order_id)}">Abrir o job</a>`;
    } else if (approved) {
      title = 'Aprovado';
      text = 'Emita a fatura de depósito para começar.';
      btn = '<button type="button" class="btn btn-primary" data-qb-proxy-now="btnInvoice">Emitir fatura</button>';
    } else if (viewed) {
      title = 'Cliente abriu o orçamento';
      text = `${first || 'O cliente'} abriu ${qbMeta.viewed_at ? qbAgo(qbMeta.viewed_at) : ''} e ainda não aprovou.`;
      const msg = buildQuoteFollowupBody(first, link);
      btn = phone
        ? `<a class="btn btn-primary" href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Lembrar por WhatsApp</a>`
        : '<button type="button" class="btn btn-primary" data-qb-proxy-now="btnSend">Reenviar</button>';
    } else if (sent) {
      title = 'Enviado — aguardando o cliente';
      text = qbMeta.email_sent_at ? `Enviado ${qbAgo(qbMeta.email_sent_at)}. Ainda não abriu.` : 'Ainda não abriu.';
      btn = '<button type="button" class="btn btn-primary" data-qb-proxy-now="btnSend">Reenviar</button>';
    } else {
      title = 'Pronto para enviar';
      text = 'Confira os itens e mande o link por e-mail ou SMS.';
      btn = '<button type="button" class="btn btn-primary" data-qb-proxy-now="btnSend">Enviar ao cliente</button>';
    }
    box.innerHTML = `<b>${title}</b><p>${text}</p>${btn}`;
  }

  function qbOpenMoreMenu(anchor) {
    const menu = $('qbMoreMenu');
    if (!menu) return;
    const open = menu.classList.contains('hidden');
    document.querySelectorAll('[data-qb-more]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (!open) {
      menu.classList.add('hidden');
      return;
    }
    menu.querySelectorAll('[data-qb-proxy]').forEach((proxy) => {
      const src = document.getElementById(proxy.getAttribute('data-qb-proxy'));
      proxy.disabled = !src || !!src.disabled;
      proxy.hidden = !src || src.classList.contains('hidden') || !!src.hidden;
    });
    menu.classList.remove('hidden');
    anchor.setAttribute('aria-expanded', 'true');
    const mobile = window.matchMedia('(max-width: 1099px)').matches;
    menu.classList.toggle('qb-more-menu--sheet', mobile);
    if (!mobile) {
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
    } else {
      menu.style.top = '';
      menu.style.left = '';
    }
  }

  function initQbPanel() {
    document.addEventListener('click', (e) => {
      const more = e.target.closest('[data-qb-more]');
      if (more) {
        e.preventDefault();
        qbOpenMoreMenu(more);
        return;
      }
      const menu = $('qbMoreMenu');
      if (menu && !menu.classList.contains('hidden') && !e.target.closest('#qbMoreMenu')) menu.classList.add('hidden');
      if (menu && e.target.closest('#qbMoreMenu [data-qb-proxy]')) setTimeout(() => menu.classList.add('hidden'), 0);
      const now = e.target.closest('[data-qb-proxy-now]');
      if (now) {
        const id = now.getAttribute('data-qb-proxy-now');
        const src = $(id);
        if (!src || src.disabled) return;
        if (id === 'btnSend') {
          e.preventDefault();
          e.stopPropagation();
          toggleQuoteSendMenu(now);
          return;
        }
        src.click();
      }
      if (e.target.closest('#qbCopyLink')) {
        const url = $('publicLink')?.href;
        if (url && navigator.clipboard) navigator.clipboard.writeText(url).then(() => qbToast('Link copiado.', 'success'));
      }
      if (e.target.closest('#modalConfirmService, #btnApplyTemplate, #btnApplySqftToLines, #btnQbApplyRules')) qbMarkDirty();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $('qbMoreMenu')?.classList.add('hidden');
    });
    // Anything typed in the quote (except the search boxes) leaves unsaved changes.
    const root = document.querySelector('.estimate-builder');
    const SKIP = new Set(['customerSearch', 'orgCustomerSearch', 'modalServiceName', 'qbBuilderExtraEmailInput', 'ownerSignName', 'ownerSignTitle']);
    root?.addEventListener('change', (e) => {
      if (!SKIP.has(e.target.id) && !e.target.closest('#addItemPanel')) qbMarkDirty();
    });
    root?.addEventListener('input', (e) => {
      if (SKIP.has(e.target.id) || e.target.closest('#addItemPanel')) {
        if (e.target.id === 'quoteJobName') qbScheduleProgress();
        return;
      }
      qbMarkDirty();
      if (e.target.id === 'quoteJobName') qbScheduleProgress();
    });
    wireLeaveGuard();
    qbRenderProgress();
  }

  initQbPanel();

  init().catch((e) => {
    $('authMsg').textContent = e.message;
    $('authMsg').classList.remove('hidden');
  });
})();
