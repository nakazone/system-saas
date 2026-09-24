/**
 * Painel rapido do lead no dashboard (popup centrado + animacao FLIP a partir do cartao Kanban).
 * Resumo estatico sempre visivel; estagio/prioridade; botao Agendar visita; orcamentos.
 */
(function (global) {
  let sheetLeadId = null;
  let sheetAnchorEl = null;
  /** @type {Record<string, unknown> | null} */
  let sheetLead = null;
  /** Cache dos estagios do pipeline (com cores), alinhado ao Kanban */
  let sheetStagesCache = [];

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return escapeHtml(String(iso));
      return escapeHtml(d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    } catch {
      return escapeHtml(String(iso));
    }
  }

  function fmtMoney(n) {
    if (n == null || n === '') return '—';
    const x = parseFloat(n);
    if (Number.isNaN(x)) return escapeHtml(String(n));
    return escapeHtml(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(x)
    );
  }

  const DETAIL_LABELS = {
    email: 'Email',
    phone: 'Telefone',
    zipcode: 'CEP',
    message: 'Mensagem',
    notes: 'Notas',
    source: 'Origem',
    status: 'Status',
    priority: 'Prioridade',
    estimated_value: 'Valor estimado',
    created_at: 'Criado em',
    updated_at: 'Atualizado em',
    owner_name: 'Responsavel',
    owner_email: 'Email do responsavel',
    pipeline_stage_name: 'Estagio',
    pipeline_stage_slug: 'Estagio (slug)',
    form_type: 'Tipo de formulario',
    next_steps: 'Proximos passos',
    next_steps_notes: 'Notas proximos passos',
    utm_source: 'UTM source',
    utm_medium: 'UTM medium',
    utm_campaign: 'UTM campaign',
    utm_term: 'UTM term',
    utm_content: 'UTM content',
    marketing_platform: 'Plataforma marketing',
    gclid: 'gclid',
    fbclid: 'fbclid',
    landing_page: 'Landing page',
    referrer_url: 'Referrer',
    city: 'Cidade',
    state: 'Estado',
    address: 'Morada',
    company_name: 'Empresa',
    job_title: 'Cargo',
  };

  const SKIP_KEYS = new Set([
    'id',
    'owner_id',
    'pipeline_stage_id',
    'pipeline_stage_color',
    'created_by',
    'updated_by',
  ]);

  /** Omitir duplicados do bloco principal do resumo */
  const EXTRA_SKIP = new Set([
    'name',
    'email',
    'phone',
    'zipcode',
    'address',
    'notes',
    'priority',
    'estimated_value',
    'status',
    'pipeline_stage_name',
    'pipeline_stage_slug',
    'next_steps',
    'next_steps_notes',
    'owner_name',
  ]);

  function stageDisplayName(lead) {
    const slug = lead.pipeline_stage_slug || lead.status || '';
    const name = lead.pipeline_stage_name;
    if (typeof global.pipelineStageDisplayName === 'function') {
      return global.pipelineStageDisplayName(slug, name);
    }
    return name || slug || '—';
  }

  function formatFieldValue(key, val) {
    if (key === 'estimated_value') return fmtMoney(val);
    if (/_at$/.test(key) || key === 'due_date') return fmtDate(val);
    if (key === 'priority') {
      const p = String(val || 'medium').toLowerCase();
      if (p === 'high') {
        return '<span class="lead-quick-sheet__pri-inline" title="Alta">\u{1F525}</span>';
      }
      if (p === 'low') {
        return '<span class="lead-quick-sheet__pri-inline" title="Baixa">\u{1F9CA}</span>';
      }
      return '<span class="lead-quick-sheet__pri-inline lead-quick-sheet__pri-inline--muted" title="Media">\u2014</span>';
    }
    return escapeHtml(String(val));
  }

  function attrEscape(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  const NEVER_SHOW_KEYS = new Set([
    'estimated_value',
    'next_steps',
    'next_steps_notes',
    'ip_address',
    'ip',
    'client_ip',
  ]);

  const READONLY_DISPLAY_KEYS = new Set([
    'id',
    'created_at',
    'updated_at',
    'pipeline_stage_name',
    'pipeline_stage_slug',
    'pipeline_stage_color',
    'owner_name',
    'owner_email',
    'status',
    'priority',
  ]);

  const PATCHABLE_KEYS = new Set([
    'name',
    'email',
    'phone',
    'zipcode',
    'address',
    'message',
    'notes',
    'owner_id',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'marketing_platform',
    'landing_page',
    'source',
    'form_type',
    'company_name',
    'job_title',
    'city',
    'state',
    'gclid',
    'fbclid',
    'referrer_url',
  ]);

  function isPatchableField(key) {
    return PATCHABLE_KEYS.has(key);
  }

  function formatFieldDisplayRich(key, raw) {
    if (raw == null || (typeof raw === 'string' && !String(raw).trim())) {
      return '<span class="lead-quick-sheet__empty-field">\u2014</span>';
    }
    return formatFieldValue(key, raw);
  }

  function inputTypeForField(key) {
    if (key === 'email') return 'email';
    if (key === 'phone') return 'tel';
    return 'text';
  }

  let ownerUsersCache = null;

  async function fetchUsersForOwnerSelect() {
    if (ownerUsersCache) return ownerUsersCache;
    try {
      const r = await fetch('/api/users?limit=100', { credentials: 'include', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success || !Array.isArray(j.data)) return [];
      ownerUsersCache = j.data;
      return ownerUsersCache;
    } catch (_) {
      return [];
    }
  }

  function renderOwnerFieldRow(lead) {
    const display = lead.owner_name
      ? escapeHtml(String(lead.owner_name))
      : '<span class="lead-quick-sheet__empty-field">\u2014</span>';
    return `<div class="lead-quick-sheet__row lead-quick-sheet__row--editable" data-lqs-row="owner_id">
      <dt>Responsavel</dt>
      <dd class="lead-quick-sheet__dd-field" data-lqs-dd="owner_id">
        <div class="lead-quick-sheet__field-view" data-lqs-view="owner_id">
          <span class="lead-quick-sheet__field-val">${display}</span>
          <button type="button" class="lead-quick-sheet__edit-btn" data-lqs-edit="owner_id" title="Editar" aria-label="Editar responsavel">\u270E</button>
        </div>
      </dd>
    </div>`;
  }

  function renderEditableFieldRow(label, fieldKey, lead) {
    if (!isPatchableField(fieldKey)) return '';
    const display = formatFieldDisplayRich(fieldKey, lead[fieldKey]);
    return `<div class="lead-quick-sheet__row lead-quick-sheet__row--editable" data-lqs-row="${fieldKey}">
      <dt>${escapeHtml(label)}</dt>
      <dd class="lead-quick-sheet__dd-field" data-lqs-dd="${fieldKey}">
        <div class="lead-quick-sheet__field-view" data-lqs-view="${fieldKey}">
          <span class="lead-quick-sheet__field-val">${display}</span>
          <button type="button" class="lead-quick-sheet__edit-btn" data-lqs-edit="${fieldKey}" title="Editar" aria-label="Editar ${escapeHtml(label)}">\u270E</button>
        </div>
      </dd>
    </div>`;
  }

  /** Resumo principal com edicao inline */
  function renderPrimaryStaticSummary(lead) {
    const parts = [
      renderEditableFieldRow('Nome', 'name', lead),
      renderEditableFieldRow('Email', 'email', lead),
      renderEditableFieldRow('Telefone', 'phone', lead),
      renderEditableFieldRow('Morada', 'address', lead),
      renderEditableFieldRow('CEP', 'zipcode', lead),
      renderEditableFieldRow('Notas', 'notes', lead),
      renderOwnerFieldRow(lead),
    ];
    return `<dl class="lead-quick-sheet__dl lead-quick-sheet__dl--primary">${parts.join('')}</dl>`;
  }

  function renderLeadCatalogFields(lead) {
    const ORDER = [
      'owner_email',
      'pipeline_stage_name',
      'status',
      'priority',
      'email',
      'phone',
      'zipcode',
      'source',
      'form_type',
      'message',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'marketing_platform',
      'gclid',
      'fbclid',
      'landing_page',
      'referrer_url',
      'company_name',
      'job_title',
      'city',
      'state',
      'address',
      'created_at',
      'updated_at',
    ];

    const seen = new Set();
    const rows = [];

    function renderCatalogRow(key, labelOverride) {
      if (SKIP_KEYS.has(key) || EXTRA_SKIP.has(key)) return '';
      if (NEVER_SHOW_KEYS.has(key)) return '';
      const val = lead[key];
      if (val == null || val === '') return '';
      if (typeof val === 'object') return '';
      const str = String(val).trim();
      if (!str) return '';
      const label = labelOverride || DETAIL_LABELS[key] || key.replace(/_/g, ' ');
      if (READONLY_DISPLAY_KEYS.has(key) || !isPatchableField(key)) {
        return `<div class="lead-quick-sheet__row"><dt>${escapeHtml(label)}</dt><dd>${formatFieldValue(key, val)}</dd></div>`;
      }
      const display = formatFieldDisplayRich(key, val);
      return `<div class="lead-quick-sheet__row lead-quick-sheet__row--editable" data-lqs-row="${escapeHtml(key)}">
        <dt>${escapeHtml(label)}</dt>
        <dd class="lead-quick-sheet__dd-field" data-lqs-dd="${escapeHtml(key)}">
          <div class="lead-quick-sheet__field-view" data-lqs-view="${escapeHtml(key)}">
            <span class="lead-quick-sheet__field-val">${display}</span>
            <button type="button" class="lead-quick-sheet__edit-btn" data-lqs-edit="${escapeHtml(key)}" title="Editar" aria-label="Editar ${escapeHtml(label)}">\u270E</button>
          </div>
        </dd>
      </div>`;
    }

    function pushField(key, labelOverride) {
      const html = renderCatalogRow(key, labelOverride);
      if (html) {
        rows.push(html);
        seen.add(key);
      }
    }

    ORDER.forEach((k) => pushField(k));
    Object.keys(lead).forEach((k) => {
      if (seen.has(k)) return;
      if (SKIP_KEYS.has(k) || EXTRA_SKIP.has(k)) return;
      if (NEVER_SHOW_KEYS.has(k)) return;
      if (k.startsWith('pipeline_stage_') && k !== 'pipeline_stage_name') return;
      pushField(k);
    });

    if (!rows.length) {
      return '';
    }
    return `<h4 class="lead-quick-sheet__h4">Mais detalhes</h4><dl class="lead-quick-sheet__dl">${rows.join('')}</dl>`;
  }

  function refreshSummarySections() {
    if (!sheetLead) return;
    const primary = document.querySelector('[data-lqs-primary-summary]');
    const catalog = document.querySelector('[data-lqs-catalog]');
    if (primary) primary.innerHTML = renderPrimaryStaticSummary(sheetLead);
    if (catalog) catalog.innerHTML = renderLeadCatalogFields(sheetLead);
    const prop = document.querySelector('[data-lqs-property]');
    if (prop) prop.innerHTML = renderPropertyBlock_(sheetLead);
    const notes = document.querySelector('[data-lqs-notes]');
    if (notes && document.activeElement !== notes) notes.value = sheetLead.notes || '';
  }

  async function enterFieldEdit(fieldKey) {
    const dd = document.querySelector(`[data-lqs-dd="${fieldKey}"]`);
    if (!dd || !sheetLead) return;
    if (fieldKey === 'owner_id') {
      const users = await fetchUsersForOwnerSelect();
      if (!users.length) {
        notifySheet('Nao foi possivel carregar utilizadores.', 'error');
        return;
      }
      const cur = sheetLead.owner_id != null ? String(sheetLead.owner_id) : '';
      const opts =
        '<option value="">\u2014</option>' +
        users
          .map((u) => {
            const id = u.id != null ? String(u.id) : '';
            const sel = id === cur ? ' selected' : '';
            const lab = escapeHtml(String(u.name || u.email || id));
            return `<option value="${escapeHtml(id)}"${sel}>${lab}</option>`;
          })
          .join('');
      dd.innerHTML = `<div class="lead-quick-sheet__field-edit" data-lqs-editing="${fieldKey}">
        <select class="lead-quick-sheet__inline-input lead-quick-sheet__inline-select" data-lqs-input="owner_id">${opts}</select>
        <div class="lead-quick-sheet__edit-actions">
          <button type="button" class="btn btn-primary btn-sm" data-lqs-save="owner_id">Guardar</button>
          <button type="button" class="btn btn-secondary btn-sm" data-lqs-cancel="owner_id">Cancelar</button>
        </div>
      </div>`;
      return;
    }
    const raw = sheetLead[fieldKey];
    const multiline = fieldKey === 'notes' || fieldKey === 'message';
    const escContent = escapeHtml(raw == null ? '' : String(raw));
    const tag = multiline
      ? `<textarea class="lead-quick-sheet__inline-input lead-quick-sheet__inline-input--multi" rows="4" data-lqs-input="${fieldKey}">${escContent}</textarea>`
      : `<input type="${inputTypeForField(fieldKey)}" class="lead-quick-sheet__inline-input" data-lqs-input="${fieldKey}" value="${attrEscape(
          raw == null ? '' : String(raw)
        )}" />`;
    dd.innerHTML = `<div class="lead-quick-sheet__field-edit" data-lqs-editing="${fieldKey}">
      ${tag}
      <div class="lead-quick-sheet__edit-actions">
        <button type="button" class="btn btn-primary btn-sm" data-lqs-save="${fieldKey}">Guardar</button>
        <button type="button" class="btn btn-secondary btn-sm" data-lqs-cancel="${fieldKey}">Cancelar</button>
      </div>
    </div>`;
    const focusEl = dd.querySelector('[data-lqs-input]');
    if (focusEl && typeof focusEl.focus === 'function') focusEl.focus();
    if (
      fieldKey === 'address' &&
      focusEl &&
      focusEl.tagName === 'INPUT' &&
      typeof global.sfAttachAddressAutocomplete === 'function'
    ) {
      focusEl.placeholder = 'Digite a morada (Google Maps)...';
      const ok = await global.sfAttachAddressAutocomplete(focusEl, {
        country: 'us',
        map: { combined: focusEl },
        onSelect: function (parsed) {
          if (parsed && parsed.formatted) focusEl.value = parsed.formatted;
        },
      });
      if (!ok) {
        notifySheet(
          'Autocomplete Google indisponivel. Confirme GOOGLE_MAPS_JS_KEY no Railway, Places API ativa e faca redeploy.',
          'warning'
        );
      }
    }
  }

  async function commitFieldEdit(fieldKey) {
    if (!sheetLeadId || !sheetLead) return;
    const input = document.querySelector(`[data-lqs-input="${fieldKey}"]`);
    if (!input) return;
    let payload = {};
    if (fieldKey === 'owner_id') {
      const v = input.value;
      payload.owner_id = v === '' ? null : v;
      if (payload.owner_id !== null && Number.isNaN(payload.owner_id)) {
        notifySheet('Responsavel invalido.', 'error');
        return;
      }
    } else if (fieldKey === 'zipcode') {
      const z = String(input.value || '').replace(/\D/g, '');
      payload.zipcode = z === '' ? null : z.slice(0, 10);
    } else {
      const raw = input.value;
      payload[fieldKey] = raw.trim() === '' ? null : raw.trim();
    }
    const result = await patchLead(payload);
    if (result != null) refreshSummarySections();
  }

  function snapVisitDatetimeLocalToHalfHour(val) {
    if (!val || typeof val !== 'string') return val;
    const parts = val.split('T');
    if (parts.length !== 2) return val;
    let datePart = parts[0];
    const tm = parts[1].match(/^(\d{2}):(\d{2})/);
    if (!tm) return val;
    let h = parseInt(tm[1], 10);
    let min = parseInt(tm[2], 10);
    if (isNaN(h) || isNaN(min)) return val;
    if (min >= 45) {
      h += 1;
      min = 0;
    } else if (min >= 15) {
      min = 30;
    } else {
      min = 0;
    }
    if (h >= 24) {
      const d = new Date(datePart + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      datePart = d.toISOString().slice(0, 10);
      h = 0;
    }
    return datePart + 'T' + String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
  }

  function parseAddressForVisit(addressStr) {
    if (!addressStr || typeof addressStr !== 'string') {
      return { addressLine1: '', addressLine2: '', city: '', zipcode: '' };
    }
    const s = addressStr.trim();
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return {
        addressLine1: parts[0],
        addressLine2: parts.slice(1, -2).join(', '),
        city: parts[parts.length - 2],
        zipcode: parts[parts.length - 1] || '',
      };
    }
    if (parts.length === 2) return { addressLine1: parts[0], addressLine2: '', city: parts[1], zipcode: '' };
    if (parts.length === 1) return { addressLine1: parts[0], addressLine2: '', city: '', zipcode: '' };
    return { addressLine1: s, addressLine2: '', city: '', zipcode: '' };
  }

  function setLqsVisitAddressFields(obj) {
    const o = obj || {};
    const line1 = document.getElementById('lqsVisitAddressLine1');
    const line2 = document.getElementById('lqsVisitAddressLine2');
    const city = document.getElementById('lqsVisitCity');
    const zip = document.getElementById('lqsVisitZipCode');
    if (line1) line1.value = o.addressLine1 || '';
    if (line2) line2.value = o.addressLine2 || '';
    if (city) city.value = o.city || '';
    if (zip) zip.value = o.zipcode || '';
  }

  async function loadLqsVisitUsers() {
    const sel = document.getElementById('lqsVisitAssignedSelect');
    if (!sel) return;
    try {
      const r = await fetch('/api/users?limit=100', { credentials: 'include', cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      sel.innerHTML = '<option value="">Eu mesmo</option>';
      if (d.success && d.data && d.data.length) {
        d.data.forEach((u) => {
          if (!u.id) return;
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = u.name || u.email || 'User ' + u.id;
          sel.appendChild(opt);
        });
      }
    } catch (_) {}
  }

  let lqsVisitModalWired = false;

  function wireLqsVisitModalOnce() {
    if (lqsVisitModalWired) return;
    const modal = document.getElementById('lqsScheduleVisitModal');
    const form = document.getElementById('lqsNewVisitForm');
    if (!modal || !form) return;
    lqsVisitModalWired = true;
    modal.querySelectorAll('[data-lqs-visit-close]').forEach((el) => {
      el.addEventListener('click', () => closeLqsScheduleVisitModal());
    });
    form.addEventListener('submit', onLqsVisitFormSubmit);
  }

  function openLqsScheduleVisitInDeviceCalendar() {
    if (!sheetLead || !sheetLeadId) return;
    if (typeof global.sfOpenLeadVisitInDeviceCalendar === 'function') {
      const ok = global.sfOpenLeadVisitInDeviceCalendar(sheetLead);
      if (ok) return;
    }
    notifySheet('Não foi possível abrir o calendário. Tente outro browser.', 'error');
  }

  function openLqsScheduleVisitModal() {
    wireLqsVisitModalOnce();
    if (!sheetLead || !sheetLeadId) return;
    const modal = document.getElementById('lqsScheduleVisitModal');
    if (!modal) return;
    const clientEl = document.getElementById('lqsVisitClientName');
    if (clientEl) clientEl.textContent = sheetLead.name ? String(sheetLead.name) : '\u2014';
    const scheduled = document.getElementById('lqsVisitScheduledAt');
    if (scheduled) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      scheduled.value = snapVisitDatetimeLocalToHalfHour(d.toISOString().slice(0, 16));
    }
    let addr = sheetLead.address || sheetLead.address_line1 || '';
    if (!addr && sheetLead.zipcode) addr = 'CEP: ' + sheetLead.zipcode;
    setLqsVisitAddressFields(parseAddressForVisit(addr));
    const notesEl = document.getElementById('lqsVisitNotes');
    if (notesEl) notesEl.value = '';
    void loadLqsVisitUsers();
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeLqsScheduleVisitModal() {
    const modal = document.getElementById('lqsScheduleVisitModal');
    if (modal) {
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
    }
    const root = document.getElementById('leadQuickSheet');
    if (!root || !root.classList.contains('is-open')) {
      document.body.style.overflow = '';
    }
  }

  async function onLqsVisitFormSubmit(e) {
    e.preventDefault();
    if (!sheetLeadId) return false;
    const schedEl = document.getElementById('lqsVisitScheduledAt');
    const scheduledAt = snapVisitDatetimeLocalToHalfHour(schedEl ? schedEl.value : '');
    if (schedEl) schedEl.value = scheduledAt;
    const addressLine1 = (document.getElementById('lqsVisitAddressLine1') || {}).value.trim();
    const addressLine2 = (document.getElementById('lqsVisitAddressLine2') || {}).value.trim();
    const city = (document.getElementById('lqsVisitCity') || {}).value.trim();
    const zipcode = (document.getElementById('lqsVisitZipCode') || {}).value.trim();
    const notes = (document.getElementById('lqsVisitNotes') || {}).value.trim() || null;
    const sellerSel = document.getElementById('lqsVisitAssignedSelect');
    const sellerId = sellerSel && sellerSel.value ? sellerSel.value : null;
    if (!scheduledAt || !addressLine1 || !city) {
      notifySheet('Preencha data/hora, morada (linha 1) e cidade.', 'error');
      return false;
    }
    const btn = document.querySelector('#lqsNewVisitForm button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'A agendar...';
    }
    try {
      const response = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          lead_id: sheetLeadId,
          scheduled_at: scheduledAt,
          address_line1: addressLine1,
          address_line2: addressLine2 || null,
          city: city,
          zipcode: zipcode || null,
          notes: notes,
          seller_id: sellerId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Agendar visita';
      }
      if (data.success) {
        closeLqsScheduleVisitModal();
        notifySheet('Visita agendada.', 'success');
        maybeRefreshKanban();
      } else {
        notifySheet(data.error || 'Nao foi possivel agendar a visita.', 'error');
      }
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Agendar visita';
      }
      notifySheet(err.message || 'Erro de rede', 'error');
    }
    return false;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, data: j };
  }

  function notifySheet(msg, kind) {
    if (typeof global.crmNotify === 'function') global.crmNotify(msg, kind || 'info');
    else if (kind === 'error') alert(msg);
  }

  function maybeRefreshKanban(updatedLead) {
    try {
      if (updatedLead && typeof global.patchKanbanLeadCache === 'function') {
        global.patchKanbanLeadCache(updatedLead);
        return;
      }
      if (typeof global.loadKanbanBoard === 'function') void global.loadKanbanBoard();
      else if (typeof global.loadCRMKanban === 'function') void global.loadCRMKanban();
    } catch (_) {}
  }

  /** Payload PUT com slug + pipeline_stage_id quando o estágio está na lista (Kanban usa o id). */
  function payloadForStatusSlug(slug, stagesList) {
    const raw = String(slug || '').trim();
    if (!raw) return {};
    const list = Array.isArray(stagesList) ? stagesList : sheetStagesCache;
    const hit = list.find((s) => slugMatchesCurrent(s.slug, raw));
    const canonical = hit && hit.slug ? String(hit.slug).trim() : raw;
    const id = hit && hit.id != null ? Number(hit.id) : NaN;
    if (Number.isFinite(id) && id > 0) {
      return { status: canonical, pipeline_stage_id: id };
    }
    return { status: canonical };
  }

  function leadCurrentPipelineSlug(lead) {
    if (!lead) return '';
    const raw = String(lead.pipeline_stage_slug || lead.status || '').trim();
    if (typeof global.normalizePipelineSlug === 'function') {
      return global.normalizePipelineSlug(raw);
    }
    return raw;
  }

  function syncStatusPickerFromLead(lead) {
    const sel = document.getElementById('lqsStatus');
    if (!sel || !lead) return;
    const slug = leadCurrentPipelineSlug(lead);
    if (!slug) return;
    let matched = false;
    for (let i = 0; i < sel.options.length; i++) {
      if (slugMatchesCurrent(sel.options[i].value, slug)) {
        sel.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const st = sheetStagesCache.find((s) => slugMatchesCurrent(s.slug, slug));
      if (st && st.slug) {
        const opt = document.createElement('option');
        opt.value = st.slug;
        opt.textContent =
          typeof global.pipelineStageDisplayName === 'function'
            ? global.pipelineStageDisplayName(st.slug, st.name)
            : st.name || st.slug;
        opt.setAttribute('data-color', st.color || '#94a3b8');
        opt.selected = true;
        sel.appendChild(opt);
      }
    }
    syncStatusDotFromSelect();
  }

  function applyStatusSlugFromPicker(slug) {
    if (!sheetLeadId || !slug) return;
    const sel = document.getElementById('lqsStatus');
    if (!sel) return;
    const payload = payloadForStatusSlug(slug);
    if (!payload.status) return;
    sel.value = payload.status;
    syncStatusDotFromSelect();
    closeStatusMenu();
    void patchLead(payload).then(() => syncStatusDotFromSelect());
  }

  function onDocumentStatusOptionClick(e) {
    const statusOpt = e.target.closest('[data-lqs-status-option]');
    if (!statusOpt || !sheetLeadId) return;
    const menu = document.getElementById('lqsStatusMenu');
    if (!menu || menu.hidden) return;
    const slug = statusOpt.getAttribute('data-value');
    if (!slug) return;
    e.preventDefault();
    applyStatusSlugFromPicker(slug);
  }

  const DEFAULT_STAGES = [
    { id: 1, name: 'New Lead', slug: 'new_lead' },
    { id: 2, name: 'Meeting Scheduled', slug: 'meeting_scheduled' },
    { id: 3, name: 'Quote Sent', slug: 'quote_sent' },
    { id: 4, name: 'Follow Up', slug: 'follow_up_1' },
    { id: 5, name: 'Stand By', slug: 'stand_by' },
    { id: 6, name: 'Won', slug: 'won' },
    { id: 7, name: 'Lost', slug: 'lost' },
  ];

  function normalizeStages(stagesRes) {
    let apiRows = [];
    try {
      const payload = stagesRes && stagesRes.data;
      if (payload && payload.success && Array.isArray(payload.data)) {
        apiRows = payload.data;
      }
    } catch (_) {}
    if (typeof global.mergePipelineStagesForKanban === 'function') {
      return global.mergePipelineStagesForKanban(apiRows);
    }
    const defs = global.PIPELINE_V9_KANBAN_DEFAULTS || {};
    return DEFAULT_STAGES.map((s, i) => ({
      id: null,
      slug: s.slug,
      name: s.name,
      color: (defs[s.slug] && defs[s.slug].color) || '#64748b',
      order_num: i + 1,
      is_active: 1,
    }));
  }

  function slugMatchesCurrent(stageSlug, currentSlug) {
    const a = String(stageSlug || '').trim();
    const b = String(currentSlug || '').trim();
    if (typeof global.normalizePipelineSlug === 'function') {
      return global.normalizePipelineSlug(a) === global.normalizePipelineSlug(b);
    }
    return a === b;
  }

  function renderStageOptions(stages, currentSlug) {
    return stages
      .map((stage) => {
        const slug = stage.slug;
        const label =
          typeof global.pipelineStageDisplayName === 'function'
            ? global.pipelineStageDisplayName(slug, stage.name)
            : stage.name || slug;
        const sel = slugMatchesCurrent(slug, currentSlug) ? ' selected' : '';
        const col = escapeHtml(stage.color || '#94a3b8');
        return `<option value="${escapeHtml(slug)}" data-color="${col}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function stageDisplayLabel(stage) {
    const slug = stage.slug;
    if (typeof global.pipelineStageDisplayName === 'function') {
      return global.pipelineStageDisplayName(slug, stage.name);
    }
    return stage.name || slug;
  }

  function renderStatusMenuOptions(stages, currentSlug) {
    return stages
      .map((stage) => {
        const slug = stage.slug;
        const label = stageDisplayLabel(stage);
        const col = escapeHtml(stage.color || '#94a3b8');
        const sel = slugMatchesCurrent(slug, currentSlug);
        return `<button type="button" class="lead-quick-sheet__status-option${
          sel ? ' is-selected' : ''
        }" role="option" data-lqs-status-option data-value="${escapeHtml(
          slug
        )}" data-color="${col}" aria-selected="${sel ? 'true' : 'false'}">
      <span class="lead-quick-sheet__status-dot lead-quick-sheet__status-dot--option" style="background-color:${col}"></span>
      <span class="lead-quick-sheet__status-option-label">${escapeHtml(label)}</span>
    </button>`;
      })
      .join('');
  }

  /** Select nativo escondido + trigger + lista com cor por opcao (o <select> nao mostra cores por linha). */
  function renderStatusPicker(stages, currentSlug) {
    let triggerLabel = '\u2014';
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      if (slugMatchesCurrent(st.slug, currentSlug)) {
        triggerLabel = stageDisplayLabel(st);
        break;
      }
    }
    return `<div class="lead-quick-sheet__status-picker" id="lqsStatusPicker">
      <select id="lqsStatus" class="lead-quick-sheet__status-select-hidden" tabindex="-1" aria-hidden="true">${renderStageOptions(
        stages,
        currentSlug
      )}</select>
      <button type="button" class="lead-quick-sheet__status-trigger" id="lqsStatusTrigger" aria-expanded="false" aria-haspopup="listbox" aria-controls="lqsStatusMenu">
        <span class="lead-quick-sheet__status-dot lead-quick-sheet__status-dot--trigger" id="lqsStatusDot"></span>
        <span class="lead-quick-sheet__status-trigger-label" id="lqsStatusTriggerLabel">${escapeHtml(triggerLabel)}</span>
        <span class="lead-quick-sheet__status-chevron" aria-hidden="true">\u25BE</span>
      </button>
      <div class="lead-quick-sheet__status-menu" id="lqsStatusMenu" role="listbox" aria-labelledby="lqsStatusTrigger" hidden>${renderStatusMenuOptions(
        stages,
        currentSlug
      )}</div>
    </div>`;
  }

  function positionStatusMenu() {
    const menu = document.getElementById('lqsStatusMenu');
    const trigger = document.getElementById('lqsStatusTrigger');
    if (!menu || !trigger) return;
    const r = trigger.getBoundingClientRect();
    const margin = 8;
    const belowTop = r.bottom + 4;
    const maxH = Math.min(280, window.innerHeight - belowTop - margin);
    menu.style.position = 'fixed';
    menu.style.left =
      Math.max(margin, Math.min(r.left, window.innerWidth - margin - Math.max(r.width, 220))) + 'px';
    menu.style.top = belowTop + 'px';
    menu.style.width = Math.max(r.width, 220) + 'px';
    menu.style.maxHeight = Math.max(120, maxH) + 'px';
    menu.style.overflowY = 'auto';
    menu.style.zIndex = '25000';
  }

  function onStatusMenuDocClick(e) {
    if (e.target.closest('#lqsStatusPicker')) return;
    /* Menu pode estar em document.body (dropdown fixo); clique na lista n—o fecha antes de aplicar */
    if (e.target.closest('#lqsStatusMenu')) return;
    closeStatusMenu();
  }

  function closeStatusMenu() {
    const picker = document.getElementById('lqsStatusPicker');
    const menu = document.getElementById('lqsStatusMenu');
    const trigger = document.getElementById('lqsStatusTrigger');
    document.removeEventListener('click', onStatusMenuDocClick, true);
    window.removeEventListener('resize', positionStatusMenu);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) {
      menu.hidden = true;
      if (picker && menu.parentNode === document.body) {
        picker.appendChild(menu);
      }
    }
  }

  function openStatusMenu() {
    document.removeEventListener('click', onStatusMenuDocClick, true);
    window.removeEventListener('resize', positionStatusMenu);
    const picker = document.getElementById('lqsStatusPicker');
    const menu = document.getElementById('lqsStatusMenu');
    const trigger = document.getElementById('lqsStatusTrigger');
    if (!picker || !menu || !trigger) return;
    if (menu.parentNode !== document.body) {
      document.body.appendChild(menu);
    }
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionStatusMenu();
    window.addEventListener('resize', positionStatusMenu);
    requestAnimationFrame(() => {
      document.addEventListener('click', onStatusMenuDocClick, true);
    });
  }

  function syncStatusDotFromSelect() {
    const sel = document.getElementById('lqsStatus');
    const dot = document.getElementById('lqsStatusDot');
    const labelEl = document.getElementById('lqsStatusTriggerLabel');
    if (!sel || !dot) return;
    const opt = sel.options[sel.selectedIndex];
    const c = opt && opt.getAttribute('data-color');
    const hex = c || '#94a3b8';
    dot.style.backgroundColor = hex;
    sel.style.accentColor = hex;
    if (labelEl && opt) labelEl.textContent = opt.textContent || '';
    document.querySelectorAll('[data-lqs-status-option]').forEach((btn) => {
      const v = btn.getAttribute('data-value');
      const on = slugMatchesCurrent(v, sel.value);
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function stageColorForLead(lead, stages) {
    const slug = lead.pipeline_stage_slug || lead.status || '';
    const list = stages || sheetStagesCache;
    const hit = list.find((s) => slugMatchesCurrent(s.slug, slug));
    return (hit && hit.color) || '#64748b';
  }

  function mergeQuoteRows(quotesData, proposalsData) {
    const quotes =
      quotesData && quotesData.success && Array.isArray(quotesData.data) ? quotesData.data : [];
    const proposals =
      proposalsData && proposalsData.success && Array.isArray(proposalsData.data) ? proposalsData.data : [];
    const rows = [];
    quotes.forEach((q) => {
      rows.push({
        kind: 'quote',
        id: q.id,
        label: q.quote_number || `Quote #${q.id}`,
        amount: q.total_amount,
        status: q.status || 'draft',
        created_at: q.created_at,
        expires: q.expiration_date,
        pdfUrl:
          q.pdf_path || q.has_invoice_pdf ? `/api/quotes/${q.id}/invoice-pdf` : null,
        email_sent_at: q.email_sent_at || null,
        viewed_at: q.viewed_at || null,
        pdf_viewed_at: q.pdf_viewed_at || null,
      });
    });
    proposals.forEach((p) => {
      rows.push({
        kind: 'proposal',
        id: p.id,
        label: p.proposal_number || `Proposta #${p.id}`,
        amount: p.total_value,
        status: p.status || 'draft',
        created_at: p.created_at,
        expires: null,
        pdfUrl: null,
      });
    });
    rows.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return rows;
  }

  function renderQuotesRows(rows, sid) {
    if (!rows.length) {
      return `<p class="lead-quick-sheet__empty">Nenhum orcamento ligado a este lead.</p>
        <p class="lead-quick-sheet__hint">Use <strong>Novo orcamento</strong> na barra superior.</p>`;
    }
    return rows
      .map((row) => {
        const badge =
          row.kind === 'quote'
            ? '<span class="lead-quick-sheet__qbadge lead-quick-sheet__qbadge--quote">Quote</span>'
            : '<span class="lead-quick-sheet__qbadge lead-quick-sheet__qbadge--proposal">Proposta</span>';
        const when = row.created_at ? new Date(row.created_at).toLocaleDateString('pt-BR') : '—';
        const exp =
          row.expires && row.kind === 'quote'
            ? `<p class="lead-quick-sheet__qmeta"><strong>Expira:</strong> ${escapeHtml(
                new Date(row.expires).toLocaleDateString('pt-BR')
              )}</p>`
            : '';
        const editHref =
          row.kind === 'quote'
            ? `quote-builder.html?id=${encodeURIComponent(String(row.id))}&lead_id=${encodeURIComponent(String(sid))}`
            : '#';
        const pdfBtn = row.pdfUrl
          ? `<button type="button" class="btn btn-secondary btn-sm" data-lqs-pdf="${row.id}" data-lqs-pdf-label="${escapeHtml(row.label || 'Orçamento')}">PDF</button>`
          : '';
        const editBtn =
          row.kind === 'quote'
            ? `<a class="btn btn-primary btn-sm" href="${editHref}">Abrir</a>`
            : '';
        const delBtn =
          row.kind === 'quote'
            ? `<button type="button" class="btn btn-danger btn-sm" data-lqs-delete-quote="${row.id}">Excluir</button>`
            : '';
        const qEng =
          row.kind === 'quote' &&
          typeof leadQuoteEngagementFromQuote === 'function' &&
          typeof renderLeadQuoteEngagementIconsHtml === 'function'
            ? `<div class="lead-quick-sheet__qengagement">${renderLeadQuoteEngagementIconsHtml(
                leadQuoteEngagementFromQuote(row),
                escapeHtml,
                { compact: true }
              )}</div>`
            : '';
        return `<div class="lead-quick-sheet__qcard" data-quote-row="${row.kind}-${row.id}">
          <div class="lead-quick-sheet__qhead"><h4 class="lead-quick-sheet__qh4">${escapeHtml(row.label)}</h4>${badge}</div>
          ${qEng}
          <p class="lead-quick-sheet__qmeta"><strong>Valor:</strong> $${parseFloat(row.amount || 0).toLocaleString()}</p>
          <p class="lead-quick-sheet__qmeta"><strong>Status:</strong> ${escapeHtml(String(row.status))}</p>
          <p class="lead-quick-sheet__qmeta"><strong>Criada:</strong> ${escapeHtml(when)}</p>
          ${exp}
          <div class="lead-quick-sheet__qactions">${pdfBtn}${editBtn}${delBtn}
            <button type="button" class="btn btn-secondary btn-sm" data-lqs-open-quotes-crm>Quotes CRM</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function priorityBadgeMarkup(lead) {
    const pri = String(lead.priority || 'medium').toLowerCase().replace(/[^a-z]/g, '') || 'medium';
    if (pri === 'high') {
      return `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--pri lead-quick-sheet__badge--pri-fire" title="Alta">\u{1F525}</span>`;
    }
    if (pri === 'low') {
      return `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--pri lead-quick-sheet__badge--pri-ice" title="Baixa">\u{1F9CA}</span>`;
    }
    return `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--pri lead-quick-sheet__badge--pri-neutral" title="Media">\u2014</span>`;
  }

  function syncPriorityToolbarButtons() {
    if (!sheetLead) return;
    const p = String(sheetLead.priority || 'medium').toLowerCase();
    document.querySelectorAll('[data-lqs-priority]').forEach((btn) => {
      const v = btn.getAttribute('data-lqs-priority');
      const active = (v === 'low' && p === 'low') || (v === 'high' && p === 'high');
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateHeaderBadges(lead) {
    const badgesEl = document.getElementById('leadQuickSheetBadges');
    if (!badgesEl || !lead) return;
    const stageLabel = stageDisplayName(lead);
    const stageHex = escapeHtml(stageColorForLead(lead, sheetStagesCache));
    badgesEl.innerHTML =
      `<span class="lead-quick-sheet__badge lead-quick-sheet__badge--stage" style="--lqs-stage:${stageHex}">${escapeHtml(stageLabel)}</span>` +
      priorityBadgeMarkup(lead);
  }

  async function patchLead(partial) {
    if (!sheetLeadId) return null;
    try {
      const r = await fetch(`/api/leads/${sheetLeadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(partial),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) {
        notifySheet(data.error || 'Nao foi possivel atualizar o lead.', 'error');
        return null;
      }
      if (data.data) {
        sheetLead = data.data;
        updateHeaderBadges(sheetLead);
        syncPriorityToolbarButtons();
        if (partial.status !== undefined) syncStatusPickerFromLead(sheetLead);
      }
      maybeRefreshKanban(data.data || null);
      return data;
    } catch (e) {
      notifySheet(e.message || 'Erro de rede', 'error');
      return null;
    }
  }

  async function refreshQuotesOnly() {
    if (!sheetLeadId) return;
    const [quotesRes, proposalsRes, visitsRes] = await Promise.all([
      fetchJson('/api/quotes?lead_id=' + encodeURIComponent(String(sheetLeadId)) + '&limit=50'),
      fetchJson('/api/leads/' + sheetLeadId + '/proposals'),
      fetchJson('/api/visits?lead_id=' + encodeURIComponent(String(sheetLeadId))),
    ]);
    const rows = mergeQuoteRows(
      quotesRes.ok ? quotesRes.data : {},
      proposalsRes.ok ? proposalsRes.data : {}
    );
    const visits =
      visitsRes.ok && visitsRes.data && visitsRes.data.success && Array.isArray(visitsRes.data.data)
        ? visitsRes.data.data
        : [];
    const mount = document.querySelector('[data-lqs-quotes-list]');
    if (mount) mount.innerHTML = renderQuotesRows(rows, sheetLeadId);
    const work = document.querySelector('[data-lqs-work-overview]');
    if (work) work.innerHTML = renderWorkOverviewRows_(rows, visits);
  }

  function formatMoneyLqs_(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '$0.00';
    return (
      '$' +
      v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }

  function priorityLabelLqs_(p) {
    const v = String(p || 'medium').toLowerCase();
    if (v === 'high') return 'High';
    if (v === 'low') return 'Low';
    return 'Medium';
  }

  function renderWorkOverviewRows_(quoteRows, visits) {
    const items = [];
    (quoteRows || []).forEach((row) => {
      items.push({
        kind: row.kind === 'proposal' ? 'quote' : 'quote',
        icon: '💰',
        title: row.label,
        dateLabel: row.created_at ? new Date(row.created_at).toLocaleDateString() : '—',
        statusLabel: String(row.status || 'draft'),
        amountLabel: formatMoneyLqs_(row.amount),
        sort: row.created_at ? new Date(row.created_at).getTime() : 0,
        rowHtml: null,
        quoteRow: row,
      });
    });
    (visits || []).forEach((v) => {
      items.push({
        kind: 'visit',
        icon: '🏠',
        title: 'Visit' + (v.id != null ? ' #' + v.id : ''),
        dateLabel: v.scheduled_at
          ? 'Scheduled for ' + new Date(v.scheduled_at).toLocaleDateString()
          : '—',
        statusLabel: String(v.status || 'scheduled'),
        amountLabel: '—',
        sort: v.scheduled_at ? new Date(v.scheduled_at).getTime() : 0,
      });
    });
    items.sort((a, b) => (b.sort || 0) - (a.sort || 0));
    if (!items.length) {
      return '<p class="lqs-ov-empty">No work items yet.</p>';
    }
    return (
      '<table class="lqs-work-table"><thead><tr><th>Item</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead><tbody>' +
      items
        .map(
          (it) =>
            '<tr data-lqs-work-kind="' +
            escapeHtml(it.kind) +
            '"><td><span class="lqs-work-item"><span class="lqs-work-item__icon">' +
            escapeHtml(it.icon) +
            '</span>' +
            escapeHtml(it.title) +
            '</span></td><td>' +
            escapeHtml(it.dateLabel) +
            '</td><td><span class="lqs-status-badge">' +
            escapeHtml(it.statusLabel) +
            '</span></td><td>' +
            escapeHtml(it.amountLabel) +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table>'
    );
  }

  function renderPropertyBlock_(lead) {
    const addr = String(lead.address || '').trim();
    const zip = String(lead.zipcode || '').trim();
    const line = [addr, zip].filter(Boolean).join(addr && zip && !addr.includes(zip) ? ', ' : '');
    if (!line) {
      return '<p class="lqs-ov-empty">No property address yet. <button type="button" class="lqs-link" data-lqs-edit-toggle>Add address</button></p>';
    }
    return (
      '<div class="lqs-property-row">' +
      '<span class="lqs-property-row__icon" aria-hidden="true">📍</span>' +
      '<div class="lqs-property-row__text">' +
      escapeHtml(line) +
      '</div>' +
      '<button type="button" class="lqs-property-row__edit" data-lqs-edit-toggle title="Edit" aria-label="Edit address">✎</button>' +
      '</div>'
    );
  }

  function renderSheetBody(lead, bundle) {
    const sid = sheetLeadId;
    const stages = bundle.stages;
    const currentSlug = leadCurrentPipelineSlug(lead);
    const pri = String(lead.priority || 'medium').toLowerCase();
    const telHref =
      typeof global.sfBuildTelHref === 'function'
        ? global.sfBuildTelHref(lead.phone)
        : lead.phone
          ? `tel:${String(lead.phone).replace(/[^\d+]/g, '')}`
          : '';
    const phoneDisplay = lead.phone
      ? telHref
        ? `<a class="lqs-meta-link" href="${escapeHtml(telHref)}">${escapeHtml(lead.phone)}</a>`
        : escapeHtml(lead.phone)
      : '—';
    const emailDisplay = lead.email
      ? `<a class="lqs-meta-link" href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>`
      : '—';
    const actionCls = 'btn btn-secondary btn-sm lqs-btn';
    const sms =
      typeof global.sfRenderLeadSmsActionHtml === 'function'
        ? global.sfRenderLeadSmsActionHtml(lead, actionCls)
        : '';
    const mail =
      typeof global.sfRenderLeadEmailActionHtml === 'function'
        ? global.sfRenderLeadEmailActionHtml(lead, actionCls)
        : lead.email
          ? `<a class="${actionCls}" href="mailto:${escapeHtml(lead.email)}">Email</a>`
          : '';
    const tele = telHref
      ? `<a class="${actionCls}" href="${escapeHtml(telHref)}">Call</a>`
      : '';

    const quoteRows = mergeQuoteRows(bundle.quotesPayload, bundle.proposalsPayload);
    const visits = Array.isArray(bundle.visits) ? bundle.visits : [];
    const priLow = pri === 'low';
    const priHigh = pri === 'high';
    const estVal = formatMoneyLqs_(lead.estimated_value);

    return `
      <div class="lqs-ov">
        <div class="lqs-ov-top">
          <div class="lqs-ov-top__status">
            ${renderStatusPicker(stages, currentSlug)}
          </div>
          <div class="lqs-ov-top__actions">
            ${tele}${sms}${mail}
            <button type="button" class="btn btn-primary btn-sm lqs-btn" data-lqs-create-toggle>+ Create</button>
            <div class="lqs-create-menu" id="lqsCreateMenu" hidden>
              <button type="button" data-lqs-open-schedule>Schedule visit</button>
              <a href="quote-builder.html?lead_id=${encodeURIComponent(String(sid))}" target="_blank" rel="noopener">New quote</a>
              <a class="lqs-full-page" href="lead-detail.html?id=${encodeURIComponent(String(sid))}">Open full page</a>
            </div>
          </div>
        </div>

        <div class="lqs-meta-grid">
          <div class="lqs-meta-item">
            <span class="lqs-meta-item__label">Main phone</span>
            <div class="lqs-meta-item__value">${phoneDisplay}</div>
          </div>
          <div class="lqs-meta-item">
            <span class="lqs-meta-item__label">Priority</span>
            <div class="lqs-meta-item__value lqs-meta-item__value--pri">
              <span>${escapeHtml(priorityLabelLqs_(pri))}</span>
              <div class="lead-quick-sheet__pri-btns" role="group" aria-label="Priority">
                <button type="button" class="lead-quick-sheet__pri-icon${priLow ? ' is-active' : ''}" data-lqs-priority="low" title="Low" aria-pressed="${priLow ? 'true' : 'false'}">\u{1F9CA}</button>
                <button type="button" class="lead-quick-sheet__pri-icon${priHigh ? ' is-active' : ''}" data-lqs-priority="high" title="High" aria-pressed="${priHigh ? 'true' : 'false'}">\u{1F525}</button>
              </div>
            </div>
          </div>
          <div class="lqs-meta-item">
            <span class="lqs-meta-item__label">Main email</span>
            <div class="lqs-meta-item__value">${emailDisplay}</div>
          </div>
          <div class="lqs-meta-item">
            <span class="lqs-meta-item__label">Lead source</span>
            <div class="lqs-meta-item__value">${escapeHtml(lead.source || '—')}</div>
          </div>
        </div>

        <div class="lqs-tabs" role="tablist">
          <button type="button" class="lqs-tab is-active" data-lqs-tab="info" role="tab" aria-selected="true">Lead information</button>
          <button type="button" class="lqs-tab" data-lqs-tab="communication" role="tab" aria-selected="false">Communication</button>
          <button type="button" class="lqs-tab" data-lqs-tab="files" role="tab" aria-selected="false">Files and media</button>
        </div>

        <div class="lqs-tab-panel is-active" data-lqs-panel="info">
          <div class="lqs-ov-grid">
            <div class="lqs-ov-main">
              <section class="lqs-card">
                <div class="lqs-card__head">
                  <h3>Properties</h3>
                  <button type="button" class="lqs-card__plus" data-lqs-edit-toggle aria-label="Edit address">+</button>
                </div>
                <div data-lqs-property>${renderPropertyBlock_(lead)}</div>
              </section>

              <div class="lqs-banner">
                <span><strong>Contacts</strong> — Add contacts to keep track of everyone you communicate with</span>
                <button type="button" class="lqs-link" disabled title="Coming soon">Add Contact</button>
              </div>

              <section class="lqs-card">
                <div class="lqs-card__head">
                  <h3>Work overview</h3>
                  <button type="button" class="lqs-card__plus" data-lqs-create-toggle aria-label="Create">+</button>
                </div>
                <div class="lqs-work-filters">
                  <button type="button" class="lqs-filter is-active" data-lqs-work-filter="all">Status | All</button>
                  <button type="button" class="lqs-filter" data-lqs-work-filter="visit">Visits</button>
                  <button type="button" class="lqs-filter" data-lqs-work-filter="quote">Quotes</button>
                </div>
                <div data-lqs-work-overview>${renderWorkOverviewRows_(quoteRows, visits)}</div>
                <div class="lqs-quotes-detail" data-lqs-quotes-list hidden>${renderQuotesRows(quoteRows, sid)}</div>
              </section>

              <section class="lqs-card lqs-card--edit" data-lqs-edit-panel hidden>
                <div class="lqs-card__head">
                  <h3>Edit contact &amp; details</h3>
                  <button type="button" class="lqs-link" data-lqs-edit-toggle>Close</button>
                </div>
                <div data-lqs-primary-summary>${renderPrimaryStaticSummary(lead)}</div>
                <div data-lqs-catalog>${renderLeadCatalogFields(lead)}</div>
              </section>
            </div>

            <aside class="lqs-ov-rail">
              <section class="lqs-card">
                <div class="lqs-card__head"><h3>Overview</h3></div>
                <p class="lqs-rail-stat">${escapeHtml(estVal)}</p>
                <p class="lqs-rail-label">Estimated value</p>
                <p class="lqs-rail-stat">$0.00</p>
                <p class="lqs-rail-label">Current balance</p>
              </section>
              <section class="lqs-card">
                <div class="lqs-card__head">
                  <h3>Tags</h3>
                  <button type="button" class="lqs-card__plus" disabled title="Coming soon">+</button>
                </div>
                <p class="lqs-ov-empty">This lead has no tags.</p>
              </section>
              <section class="lqs-card">
                <div class="lqs-card__head">
                  <h3>Notes</h3>
                  <button type="button" class="lqs-link" data-lqs-save-notes>Save</button>
                </div>
                <textarea class="lqs-notes" data-lqs-notes maxlength="8000" placeholder="Leave an internal note for yourself or a team member.">${escapeHtml(lead.notes || '')}</textarea>
              </section>
            </aside>
          </div>
        </div>

        <div class="lqs-tab-panel" data-lqs-panel="communication" hidden>
          <section class="lqs-card">
            <p class="lqs-ov-empty">Log calls and messages from the actions above. Full interaction history is on the <a href="lead-detail.html?id=${encodeURIComponent(String(sid))}">full lead page</a>.</p>
            <div class="lqs-comm-actions">${tele}${sms}${mail}
              <button type="button" class="btn btn-secondary btn-sm lqs-btn" data-lqs-open-schedule>Schedule visit</button>
            </div>
          </section>
        </div>

        <div class="lqs-tab-panel" data-lqs-panel="files" hidden>
          <section class="lqs-card">
            <p class="lqs-ov-empty">No files or media yet.</p>
          </section>
        </div>
      </div>`;
  }

  function onSheetBodyClick(e) {
    const smsPickerBtn = e.target.closest('[data-lqs-sms-menu]');
    if (smsPickerBtn && sheetLead) {
      e.preventDefault();
      if (typeof global.sfOpenSmsChoiceMenu === 'function') {
        global.sfOpenSmsChoiceMenu(smsPickerBtn, sheetLead);
      }
      return;
    }
    const emailPickerBtn = e.target.closest('[data-lqs-email-menu]');
    if (emailPickerBtn && sheetLead) {
      e.preventDefault();
      if (typeof global.sfOpenEmailChoiceMenu === 'function') {
        global.sfOpenEmailChoiceMenu(emailPickerBtn, sheetLead);
      }
      return;
    }
    if (e.target.closest('[data-lqs-open-schedule]')) {
      e.preventDefault();
      const createMenu = document.getElementById('lqsCreateMenu');
      if (createMenu) createMenu.hidden = true;
      void openLqsScheduleVisitInDeviceCalendar();
      return;
    }
    const createToggle = e.target.closest('[data-lqs-create-toggle]');
    if (createToggle) {
      e.preventDefault();
      e.stopPropagation();
      const menu = document.getElementById('lqsCreateMenu');
      if (menu) menu.hidden = !menu.hidden;
      return;
    }
    const editToggle = e.target.closest('[data-lqs-edit-toggle]');
    if (editToggle) {
      e.preventDefault();
      const panel = document.querySelector('[data-lqs-edit-panel]');
      if (panel) {
        if (panel.hasAttribute('hidden')) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      }
      return;
    }
    const tabBtn = e.target.closest('[data-lqs-tab]');
    if (tabBtn) {
      e.preventDefault();
      const name = tabBtn.getAttribute('data-lqs-tab');
      document.querySelectorAll('[data-lqs-tab]').forEach((t) => {
        const on = t === tabBtn;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('[data-lqs-panel]').forEach((p) => {
        const on = p.getAttribute('data-lqs-panel') === name;
        p.classList.toggle('is-active', on);
        if (on) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
      return;
    }
    const workFilter = e.target.closest('[data-lqs-work-filter]');
    if (workFilter) {
      e.preventDefault();
      const kind = workFilter.getAttribute('data-lqs-work-filter') || 'all';
      document.querySelectorAll('[data-lqs-work-filter]').forEach((b) => {
        b.classList.toggle('is-active', b === workFilter);
      });
      document.querySelectorAll('[data-lqs-work-kind]').forEach((row) => {
        const k = row.getAttribute('data-lqs-work-kind');
        row.style.display = kind === 'all' || k === kind ? '' : 'none';
      });
      return;
    }
    const saveNotes = e.target.closest('[data-lqs-save-notes]');
    if (saveNotes && sheetLeadId) {
      e.preventDefault();
      const ta = document.querySelector('[data-lqs-notes]');
      void patchLead({ notes: ta ? ta.value : '' });
      return;
    }
    const priBtn = e.target.closest('[data-lqs-priority]');
    if (priBtn && sheetLeadId) {
      e.preventDefault();
      const pv = priBtn.getAttribute('data-lqs-priority');
      if (pv === 'low' || pv === 'high') void patchLead({ priority: pv });
      return;
    }
    const editBtn = e.target.closest('[data-lqs-edit]');
    if (editBtn && sheetLeadId) {
      const fk = editBtn.getAttribute('data-lqs-edit');
      if (fk) {
        e.preventDefault();
        const panel = document.querySelector('[data-lqs-edit-panel]');
        if (panel) panel.removeAttribute('hidden');
        void enterFieldEdit(fk);
      }
      return;
    }
    const saveBtn = e.target.closest('[data-lqs-save]');
    if (saveBtn && sheetLeadId) {
      e.preventDefault();
      const fk = saveBtn.getAttribute('data-lqs-save');
      if (fk) void commitFieldEdit(fk);
      return;
    }
    const cancelBtn = e.target.closest('[data-lqs-cancel]');
    if (cancelBtn && sheetLeadId) {
      e.preventDefault();
      refreshSummarySections();
      return;
    }
    const trigger = e.target.closest('#lqsStatusTrigger');
    if (trigger) {
      e.preventDefault();
      const menu = document.getElementById('lqsStatusMenu');
      if (menu && !menu.hidden) closeStatusMenu();
      else openStatusMenu();
      return;
    }
    const statusOpt = e.target.closest('[data-lqs-status-option]');
    if (statusOpt && sheetLeadId) {
      e.preventDefault();
      e.stopPropagation();
      const slug = statusOpt.getAttribute('data-value');
      if (!slug) return;
      void applyStatusSlugFromPicker(slug);
      return;
    }
    if (e.target.closest('[data-lqs-open-quotes-crm]')) {
      window.location.href = 'dashboard.html?page=quotes';
      return;
    }
    const pdfBtn = e.target.closest('[data-lqs-pdf]');
    if (pdfBtn) {
      e.preventDefault();
      e.stopPropagation();
      const qid = pdfBtn.getAttribute('data-lqs-pdf');
      const label = pdfBtn.getAttribute('data-lqs-pdf-label') || 'Orçamento';
      if (qid && typeof global.openQuoteInvoicePdf === 'function') {
        void global.openQuoteInvoicePdf(qid, label);
      } else if (qid && global.crmPdfViewer?.openFromUrl) {
        void global.crmPdfViewer.openFromUrl(`/api/quotes/${qid}/invoice-pdf`, { title: label });
      }
      return;
    }
    const delBtn = e.target.closest('[data-lqs-delete-quote]');
    if (delBtn && sheetLeadId) {
      const qid = delBtn.getAttribute('data-lqs-delete-quote');
      if (!qid || !confirm('Excluir este orcamento (quote)?')) return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/quotes/${encodeURIComponent(qid)}?lead_id=${encodeURIComponent(String(sheetLeadId))}`,
            { method: 'DELETE', credentials: 'include', cache: 'no-store' }
          );
          let data = {};
          try {
            const t = await res.text();
            if (t && t.trim()) data = JSON.parse(t);
          } catch (_) {}
          if (!res.ok) {
            notifySheet(data.error || data.message || 'Nao foi possivel excluir.', 'error');
            return;
          }
          notifySheet('Quote excluido.', 'success');
          await refreshQuotesOnly();
        } catch (err) {
          notifySheet(err.message || 'Erro de rede', 'error');
        }
      })();
    }
  }

  function onSheetBodyChange(e) {
    const t = e.target;
    if (!sheetLeadId) return;
    if (t.id === 'lqsStatus') {
      void applyStatusSlugFromPicker(t.value);
      return;
    }
  }

  let sheetBodyDelegated = false;
  let docStatusOptionDelegated = false;

  function ensureSheetDelegation() {
    if (sheetBodyDelegated) return;
    const body = document.getElementById('leadQuickSheetBody');
    if (!body) return;
    sheetBodyDelegated = true;
    if (!docStatusOptionDelegated) {
      docStatusOptionDelegated = true;
      document.addEventListener('click', onDocumentStatusOptionClick, true);
    }
    body.addEventListener('click', onSheetBodyClick);
    body.addEventListener('change', onSheetBodyChange);
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = e.target;
      if (
        t &&
        t.matches &&
        t.matches('.lead-quick-sheet__inline-input:not(textarea)') &&
        t.getAttribute('data-lqs-input')
      ) {
        e.preventDefault();
        void commitFieldEdit(t.getAttribute('data-lqs-input'));
      }
    });
    body.addEventListener(
      'scroll',
      () => {
        closeStatusMenu();
      },
      { passive: true }
    );
  }

  function resetPanelTransform(panelEl) {
    if (!panelEl) return;
    panelEl.style.transition = '';
    panelEl.style.transform = '';
    panelEl.style.opacity = '';
    panelEl.style.transformOrigin = '';
    panelEl.style.pointerEvents = '';
  }

  function isMobileQuickSheetLayout() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1024px)').matches;
  }

  function animatePanelFromAnchor(anchorEl, panelEl) {
    if (!panelEl) return;
    panelEl.style.transition = 'none';

    if (isMobileQuickSheetLayout()) {
      /* Bottom sheet: CSS .is-open cuida do translateY */
      resetPanelTransform(panelEl);
      return;
    }

    if (!anchorEl || !(anchorEl instanceof Element)) {
      panelEl.style.opacity = '0';
      panelEl.style.transform = 'translate(-50%, -50%) scale(0.88)';
      panelEl.style.transformOrigin = 'center center';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          panelEl.style.transition =
            'opacity 0.28s ease, transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
          panelEl.style.opacity = '1';
          panelEl.style.transform = 'translate(-50%, -50%) scale(1)';
          const done = () => resetPanelTransform(panelEl);
          panelEl.addEventListener('transitionend', done, { once: true });
          setTimeout(done, 480);
        });
      });
      return;
    }

    const card = anchorEl.getBoundingClientRect();
    const final = panelEl.getBoundingClientRect();

    const cx = card.left + card.width / 2;
    const cy = card.top + card.height / 2;
    const px = final.left + final.width / 2;
    const py = final.top + final.height / 2;

    let scale = Math.min(card.width / final.width, card.height / final.height, 1);
    scale = Math.max(scale, 0.14);

    const dx = cx - px;
    const dy = cy - py;

    panelEl.style.transformOrigin = 'center center';
    panelEl.style.transform =
      'translate(-50%, -50%) translate(' + dx + 'px, ' + dy + 'px) scale(' + scale + ')';
    panelEl.style.opacity = '0.94';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelEl.style.transition =
          'transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease';
        panelEl.style.transform = 'translate(-50%, -50%) scale(1)';
        panelEl.style.opacity = '1';
        const done = () => resetPanelTransform(panelEl);
        panelEl.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 520);
      });
    });
  }

  /**
   * Atualiza estágio do lead (PUT) e sincroniza o cache do Kanban/mobile.
   * @returns {Promise<boolean>}
   */
  async function updateLeadPipelineStage(leadId, stageSlug) {
    const id = String(leadId || '').trim();
    if (!id || !stageSlug) return false;
    let stages = sheetStagesCache;
    if (!stages.length && typeof global.getKanbanBoardStages === 'function') {
      try {
        stages = global.getKanbanBoardStages() || [];
      } catch (_) {
        stages = [];
      }
    }
    if (!stages.length) {
      const stagesRes = await fetchJson('/api/pipeline-stages');
      stages = normalizeStages(stagesRes);
    }
    const payload = payloadForStatusSlug(stageSlug, stages);
    if (!payload.status) return false;
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.success) {
        notifySheet(data.error || 'Nao foi possivel atualizar o lead.', 'error');
        return false;
      }
      if (data.data) {
        if (sheetLeadId === id) {
          sheetLead = data.data;
          updateHeaderBadges(sheetLead);
          syncStatusPickerFromLead(sheetLead);
        }
        maybeRefreshKanban(data.data);
      } else {
        maybeRefreshKanban({
          id,
          status: payload.status,
          pipeline_stage_id: payload.pipeline_stage_id,
          pipeline_stage_slug: payload.status,
        });
      }
      return true;
    } catch (e) {
      notifySheet(e.message || 'Erro de rede', 'error');
      return false;
    }
  }

  async function openLeadQuickSheet(id, anchorEl) {
    const sid = String(id || '').trim();
    if (!sid) return;
    sheetLeadId = sid;
    sheetAnchorEl = anchorEl || null;

    const root = document.getElementById('leadQuickSheet');
    const panelEl = root ? root.querySelector('.lead-quick-sheet__panel') : null;
    const body = document.getElementById('leadQuickSheetBody');
    const titleEl = document.getElementById('leadQuickSheetTitle');
    const badgesEl = document.getElementById('leadQuickSheetBadges');
    if (!root || !body || !titleEl || !badgesEl) {
      window.location.href = 'lead-detail.html?id=' + sid;
      return;
    }

    ensureSheetDelegation();
    wireLqsVisitModalOnce();

    root.classList.add('is-open');
    root.classList.add('lead-quick-sheet--overview');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lead-quick-sheet-open');
    body.innerHTML = '<div class="lead-quick-sheet__loading">A carregar…</div>';

    const [leadRes, stagesRes, quotesRes, proposalsRes, visitsRes] = await Promise.all([
      fetchJson('/api/leads/' + sid),
      fetchJson('/api/pipeline-stages'),
      fetchJson('/api/quotes?lead_id=' + encodeURIComponent(String(sid)) + '&limit=50'),
      fetchJson('/api/leads/' + sid + '/proposals'),
      fetchJson('/api/visits?lead_id=' + encodeURIComponent(String(sid))),
    ]);

    const ld = leadRes.data;
    if (!leadRes.ok || !ld || ld.success !== true || !ld.data) {
      body.innerHTML =
        '<p class="lead-quick-sheet__error">Nao foi possivel carregar o lead.</p>';
      requestAnimationFrame(() => {
        animatePanelFromAnchor(sheetAnchorEl, panelEl);
      });
      return;
    }

    const lead = ld.data;
    sheetLead = lead;
    if (typeof global.sfPrefetchLeadVisitIcs === 'function' && lead.id) {
      void global.sfPrefetchLeadVisitIcs(lead.id);
    }
    titleEl.textContent = lead.name || 'Lead';

    const stages = normalizeStages(stagesRes);
    sheetStagesCache = stages;

    const visits =
      visitsRes.ok && visitsRes.data && visitsRes.data.success && Array.isArray(visitsRes.data.data)
        ? visitsRes.data.data
        : [];

    const bundle = {
      stages,
      quotesPayload: quotesRes.ok ? quotesRes.data : {},
      proposalsPayload: proposalsRes.ok ? proposalsRes.data : {},
      visits,
    };

    body.innerHTML = renderSheetBody(lead, bundle);
    updateHeaderBadges(lead);
    syncPriorityToolbarButtons();
    syncStatusPickerFromLead(lead);

    if (typeof global.sfInitCrmAddressAutocomplete === 'function') {
      setTimeout(function () {
        global.sfInitCrmAddressAutocomplete();
      }, 150);
    }

    requestAnimationFrame(() => {
      animatePanelFromAnchor(sheetAnchorEl, panelEl);
    });
  }

  function closeLeadQuickSheet() {
    closeLqsScheduleVisitModal();
    closeStatusMenu();
    if (typeof global.sfCloseSmsChoiceMenu === 'function') global.sfCloseSmsChoiceMenu();
    if (typeof global.sfDismissPacDropdown === 'function') global.sfDismissPacDropdown();
    ownerUsersCache = null;
    const root = document.getElementById('leadQuickSheet');
    if (!root) return;
    resetPanelTransform(root.querySelector('.lead-quick-sheet__panel'));
    root.classList.remove('is-open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lead-quick-sheet-open');
    sheetLeadId = null;
    sheetAnchorEl = null;
    sheetLead = null;
    sheetStagesCache = [];
  }

  function wire() {
    const root = document.getElementById('leadQuickSheet');
    if (!root) return;
    ensureSheetDelegation();
    const bd = document.getElementById('leadQuickSheetBackdrop');
    const closeBtn = document.getElementById('leadQuickSheetClose');
    if (bd) bd.addEventListener('click', closeLeadQuickSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeLeadQuickSheet);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !root.classList.contains('is-open')) return;
      const visitModal = document.getElementById('lqsScheduleVisitModal');
      if (visitModal && visitModal.classList.contains('active')) {
        closeLqsScheduleVisitModal();
        e.preventDefault();
        return;
      }
      const editing = root.querySelector('#leadQuickSheetBody [data-lqs-editing]');
      if (editing) {
        refreshSummarySections();
        e.preventDefault();
        return;
      }
      const menu = document.getElementById('lqsStatusMenu');
      if (menu && !menu.hidden) {
        closeStatusMenu();
        e.preventDefault();
        return;
      }
      closeLeadQuickSheet();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  global.openLeadQuickSheet = openLeadQuickSheet;
  global.animatePanelFromAnchor = animatePanelFromAnchor;
  global.closeLeadQuickSheet = closeLeadQuickSheet;
  global.updateLeadPipelineStage = updateLeadPipelineStage;

  const origViewLead = typeof global.viewLead === 'function' ? global.viewLead : null;
  global.viewLead = function (id, ev) {
    const r = document.getElementById('leadQuickSheet');
    let anchorEl = null;
    if (ev && ev.currentTarget && ev.currentTarget.closest) {
      anchorEl = ev.currentTarget.closest('.kanban-card, .lcard, [data-lcard-open]');
    } else if (ev && ev.target && ev.target.closest) {
      anchorEl = ev.target.closest('.kanban-card, .lcard, [data-lcard-open]');
    }
    if (r && typeof openLeadQuickSheet === 'function') {
      void openLeadQuickSheet(id, anchorEl);
    } else if (origViewLead) {
      origViewLead(id);
    } else {
      window.location.href = 'lead-detail.html?id=' + encodeURIComponent(id);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
