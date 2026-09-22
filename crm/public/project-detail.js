/**
 * Detalhe do projeto — abas, custos, checklist, galeria, P&L
 */
const projectId = new URLSearchParams(location.search).get('id');
let project = null;
let plData = null;
let checklistGrouped = {};
let photosByPhase = { before: [], during: [], after: [] };
let activeTab = 'overview';
let galleryUploadPhase = 'during';
/** @type {Array<{id:number,name:string,role?:string,payment_type:string,daily_rate?:number,hourly_rate?:number}>} */
let constructionPayrollRates = [];
/** @type {Array<{id:number,label:string}>|null} */
let builderPartnerOptions = null;
let canEditProject = true;

function isBuilderProject(p) {
  if (!p) return false;
  if (String(p.client_type || '').toLowerCase() === 'builder') return true;
  if (p.partner_builder_id || p.builder_partner?.builder_table_id) return true;
  if (p.builder_partner?.display_name) return true;
  return false;
}

function builderPartnerLabel(p) {
  const bp = p?.builder_partner;
  if (bp?.display_name) {
    return bp.company ? `${bp.display_name} · ${bp.company}` : bp.display_name;
  }
  return p?.builder_name || '';
}

const FLOORING_OPTIONS = ['hardwood', 'lvp', 'tile', 'laminate', 'engineered', 'other'];
const SERVICE_TYPE_OPTIONS = [
  { value: 'installation', label: 'Installation' },
  { value: 'supply', label: 'Supply' },
  { value: 'sand_finish', label: 'Sand & Finish' },
];

const fmt$ = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(
    parseFloat(v) || 0
  );
const fmtPct = (v) => `${(parseFloat(v) || 0).toFixed(1)}%`;

/** Extrai YYYY-MM-DD de strings ISO/MySQL (evita datas inválidas ao juntar com T12:00:00). */
function toYmdFromApi(iso) {
  if (iso == null || iso === '') return '';
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** Parse números de inputs (aceita vírgula decimal). */
function parseCostNumber(v) {
  if (v == null || v === '') return 0;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const MATERIAL_STATUS_LABELS = {
  pending: 'Pendente',
  ordered: 'Pedido',
  received: 'Recebido',
  partial: 'Parcial',
  returned: 'Devolvido',
};

const PPF_TYPE_LABELS = {
  deposit: 'Sinal',
  progress: 'Progresso',
  final: 'Final',
  other: 'Outro',
};

const PPF_METHOD_LABELS = {
  cash: 'Numerário',
  check: 'Cheque',
  zelle: 'Zelle',
  venmo: 'Venmo',
  credit_card: 'Cartão',
  bank_transfer: 'Transferência',
  other: 'Outro',
};

function labelPpfType(c) {
  return PPF_TYPE_LABELS[String(c || '').toLowerCase()] || c || '—';
}

function labelPpfMethod(c) {
  return PPF_METHOD_LABELS[String(c || '').toLowerCase()] || c || '—';
}

function materialStatusLabel(code) {
  if (code == null || code === '') return '—';
  return MATERIAL_STATUS_LABELS[String(code)] || String(code);
}

function showToast(msg, type = 'success') {
  const bg =
    type === 'error' ? 'var(--sf-bad)' : type === 'info' ? 'var(--sf-navy)' : 'var(--sf-ok)';
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;z-index:9999;background:${bg};max-width:320px`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.style.display = p.id === `tab-${tab}` ? 'flex' : 'none';
  });
}

async function loadProject() {
  if (!projectId) {
    window.location.href = 'projects.html';
    return;
  }
  const [projRes, plRes, checkRes, photoRes, payrollRes] = await Promise.all([
    fetch(`/api/projects/${projectId}`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/profitability`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/checklist`, { credentials: 'include' }),
    fetch(`/api/projects/${projectId}/photos`, { credentials: 'include' }),
    fetch('/api/projects/lookup/construction-payroll-rates', { credentials: 'include' }),
  ]);
  const [projData, plJson, checkJson, photoJson, payrollJson] = await Promise.all([
    projRes.json(),
    plRes.json(),
    checkRes.json(),
    photoRes.json(),
    payrollRes.json().catch(() => ({})),
  ]);
  constructionPayrollRates =
    payrollJson && payrollJson.success && Array.isArray(payrollJson.data) ? payrollJson.data : [];
  if (!projRes.ok || !projData.success) {
    showToast(projData.error || 'Projeto não encontrado', 'error');
    return;
  }
  project = projData.data;
  plData = plJson.success ? plJson.data : null;
  checklistGrouped = checkJson.success && checkJson.data?.grouped ? checkJson.data.grouped : groupChecklist(project.checklist || []);
  photosByPhase =
    photoJson.success && photoJson.data
      ? photoJson.data
      : { before: [], during: [], after: [] };

  renderHeader(project);
  bindProjectSchedule(project);
  renderOverviewTab(project, plData);
  renderCostsTab(project);
  renderChecklistTab();
  renderGalleryTab();
  loadPortfolioStatusLine();
  loadPaymentForecastTab();
  const tb = document.getElementById('tab-btn-builder');
  if (isBuilderProject(project)) {
    if (tb) tb.style.display = '';
    await renderBuilderTab();
  } else if (tb) tb.style.display = 'none';
}

function groupChecklist(items) {
  const g = {};
  (items || []).forEach((row) => {
    const c = row.category || 'Outros';
    if (!g[c]) g[c] = [];
    g[c].push(row);
  });
  return g;
}

const STATUS_LABELS = {
  scheduled: 'Agendado',
  in_progress: 'Em andamento',
  on_hold: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

function fmtShortPt(iso) {
  const ymd = toYmdFromApi(iso);
  if (!ymd) return '—';
  try {
    return new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

/** Data legível (sem hora) para textos corridos na página do projeto. */
function fmtDatePtLong(iso) {
  const ymd = toYmdFromApi(iso);
  if (!ymd) return '—';
  try {
    return new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function updateProgressDatesLine(p) {
  const el = document.getElementById('pd-prog-dates');
  if (!el) return;
  const parts = [];
  const a = fmtShortPt(p.start_date);
  const b = fmtShortPt(p.end_date_estimated);
  if (p.start_date || p.end_date_estimated) parts.push(`${a} → ${b}`);
  if (p.days_estimated != null && p.days_estimated !== '') {
    parts.push(`${parseInt(p.days_estimated, 10)} dias est.`);
  }
  const daysEst = p.days_estimated != null ? parseInt(p.days_estimated, 10) : null;
  const start = toYmdFromApi(p.start_date) ? new Date(`${toYmdFromApi(p.start_date)}T12:00:00`) : null;
  if (start && daysEst) {
    const now = new Date();
    const elapsed = Math.max(1, Math.ceil((now - start) / 86400000));
    parts.push(`Dia ${elapsed}`);
  }
  el.textContent = parts.join(' · ');
}

function bindProjectSchedule(p) {
  const ds = document.getElementById('pd-date-start');
  const de = document.getElementById('pd-date-end');
  const da = document.getElementById('pd-date-end-actual');
  const btn = document.getElementById('pd-dates-save');
  if (ds) {
    const v = toYmdFromApi(p.start_date || p.estimated_start_date);
    ds.value = v || '';
    ds.disabled = !canEditProject;
  }
  if (de) {
    const v = toYmdFromApi(p.end_date_estimated || p.estimated_end_date);
    de.value = v || '';
    de.disabled = !canEditProject;
  }
  if (da) {
    const v = toYmdFromApi(p.end_date_actual || p.actual_end_date);
    da.value = v || '';
    da.disabled = !canEditProject;
  }
  if (btn) {
    btn.style.display = canEditProject ? '' : 'none';
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', saveProjectSchedule);
    }
  }
}

async function saveProjectSchedule() {
  if (!canEditProject) return;
  const start = document.getElementById('pd-date-start')?.value?.trim() || '';
  const end = document.getElementById('pd-date-end')?.value?.trim() || '';
  const endActual = document.getElementById('pd-date-end-actual')?.value?.trim() || '';
  const payload = {
    start_date: start || null,
    end_date_estimated: end || null,
    end_date_actual: endActual || null,
  };
  if (start && end) {
    const d0 = new Date(`${start}T12:00:00`);
    const d1 = new Date(`${end}T12:00:00`);
    if (d1 >= d0) {
      payload.days_estimated = Math.round((d1 - d0) / 86400000);
    }
  }
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao guardar datas', 'error');
    return;
  }
  project = { ...project, ...j.data };
  updateProgressDatesLine(project);
  bindProjectSchedule(project);
  showToast('Datas guardadas');
}

function flooringOptionsHtml(selected) {
  const sel = String(selected || '');
  return (
    '<option value="">—</option>' +
    FLOORING_OPTIONS.map(
      (f) => `<option value="${f}"${sel === f ? ' selected' : ''}>${f}</option>`
    ).join('')
  );
}

function serviceTypeOptionsHtml(selected) {
  const sel = String(selected || 'installation').toLowerCase();
  return SERVICE_TYPE_OPTIONS.map(
    (o) => `<option value="${o.value}"${sel === o.value ? ' selected' : ''}>${o.label}</option>`
  ).join('');
}

let crmUsersForTeam = null;

async function ensureCrmUsersForTeam() {
  if (crmUsersForTeam) return crmUsersForTeam;
  try {
    const r = await fetch('/api/users?limit=200&page=1', { credentials: 'include' });
    const j = await r.json();
    const list = j.data?.users || j.data || j.users || [];
    crmUsersForTeam = Array.isArray(list) ? list.filter((u) => u.is_active !== 0) : [];
  } catch {
    crmUsersForTeam = [];
  }
  return crmUsersForTeam;
}

function userSelectOptions(users, selectedId) {
  const sid = selectedId != null && selectedId !== '' ? String(selectedId) : '';
  let html = '<option value="">— Não atribuído —</option>';
  for (const u of users) {
    html += `<option value="${u.id}"${String(u.id) === sid ? ' selected' : ''}>${escapeHtml(u.name || u.email || `User #${u.id}`)}</option>`;
  }
  return html;
}

function renderProjectTeamBlock(p) {
  const gm = p.general_manager_id ?? p.project_manager_id ?? p.assigned_to ?? '';
  const inst = p.installation_supervisor_id ?? '';
  const sand = p.sand_finish_supervisor_id ?? '';
  if (!canEditProject) {
    return `<div class="pd-project-team" style="margin-bottom:16px">
      <h3 style="font-size:14px;margin:0 0 8px">Equipa SF (portal builder)</h3>
      <p class="pd-muted" style="font-size:12px">Sem permissão para editar (projects.edit).</p>
    </div>`;
  }
  return `<div class="pd-project-team" id="pd-project-team" style="margin-bottom:16px;padding:12px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--sf-surface,#f8fafc)">
    <h3 style="font-size:14px;margin:0 0 10px">Equipa SF (portal builder)</h3>
    <p class="pd-muted" style="font-size:11px;margin:0 0 10px">Contactos exibidos na página do projeto no portal do builder.</p>
    <div class="pd-edit-grid">
      <label>General Manager
        <select id="pd-team-gm"><option value="">A carregar…</option></select>
      </label>
      <label>Installation Supervisor
        <select id="pd-team-install"><option value="">A carregar…</option></select>
      </label>
      <label>Sand &amp; Finish Supervisor
        <select id="pd-team-sand"><option value="">A carregar…</option></select>
      </label>
    </div>
    <div class="pd-project-edit__actions" style="margin-top:10px">
      <button type="button" class="pd-action-btn pd-action-filled" id="pd-team-save">Guardar equipa</button>
    </div>
  </div>`;
}

async function initProjectTeamSelects(p) {
  const users = await ensureCrmUsersForTeam();
  const gm = p.general_manager_id ?? p.project_manager_id ?? p.assigned_to ?? '';
  const inst = p.installation_supervisor_id ?? '';
  const sand = p.sand_finish_supervisor_id ?? '';
  const gmSel = document.getElementById('pd-team-gm');
  const instSel = document.getElementById('pd-team-install');
  const sandSel = document.getElementById('pd-team-sand');
  if (gmSel) gmSel.innerHTML = userSelectOptions(users, gm);
  if (instSel) instSel.innerHTML = userSelectOptions(users, inst);
  if (sandSel) sandSel.innerHTML = userSelectOptions(users, sand);
  document.getElementById('pd-team-save')?.addEventListener('click', saveProjectTeam);
}

async function saveProjectTeam() {
  if (!canEditProject) return;
  const parseId = (el) => {
    const v = el?.value;
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const payload = {
    general_manager_id: parseId(document.getElementById('pd-team-gm')),
    installation_supervisor_id: parseId(document.getElementById('pd-team-install')),
    sand_finish_supervisor_id: parseId(document.getElementById('pd-team-sand')),
  };
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao guardar equipa', 'error');
    return;
  }
  project = { ...project, ...j.data };
  showToast('Equipa atualizada');
}

function renderProjectEditBlock(p) {
  const builderJob = isBuilderProject(p);
  const clientNameRow = builderJob
    ? `<label class="pd-edit-span2">Nome do cliente (morador / cliente final)
          <input type="text" id="pd-edit-client-name" maxlength="255" placeholder="Nome do cliente da obra" value="${escapeHtml(p.client_name || p.lead?.name || '')}" ${canEditProject ? '' : 'disabled'} />
        </label>`
    : '';
  if (!canEditProject) {
    return `
    <div class="pd-project-edit">
      <h3>Dados do projeto</h3>
      ${builderJob && (p.client_name || p.lead?.name) ? `<p class="pd-overview-meta__line" style="margin:0"><strong>Cliente:</strong> ${escapeHtml(p.client_name || p.lead?.name || '')}</p>` : ''}
      <p class="pd-overview-meta__line" style="margin:${builderJob ? '6px' : '0'} 0 0">${escapeHtml(p.address || 'Sem endereço')} · ${escapeHtml(p.flooring_type || '—')} · ${p.total_sqft != null ? `${p.total_sqft} sqft` : '—'}</p>
      <p class="pd-muted" style="font-size:12px;margin:8px 0 0;color:var(--sf-muted)">Sem permissão para editar (projects.edit).</p>
    </div>`;
  }
  return `
    <div class="pd-project-edit" id="pd-project-edit">
      <h3>Dados do projeto</h3>
      <div class="pd-edit-grid">
        ${clientNameRow}
        <label class="pd-edit-span2">Nome do projeto
          <input type="text" id="pd-edit-name" maxlength="255" value="${escapeHtml(p.name || '')}" />
        </label>
        <label class="pd-edit-span2">Endereço da obra
          <input type="text" id="pd-edit-address" placeholder="Digite o endereço (autocomplete)…" autocomplete="off" value="${escapeHtml(p.address || '')}" />
        </label>
        <label>Nº projeto
          <input type="text" id="pd-edit-number" maxlength="64" value="${escapeHtml(p.project_number != null ? String(p.project_number) : '')}" />
        </label>
        <label>Tipo de piso
          <select id="pd-edit-flooring">${flooringOptionsHtml(p.flooring_type)}</select>
        </label>
        <label>Serviço principal
          <select id="pd-edit-service">${serviceTypeOptionsHtml(p.service_type)}</select>
        </label>
        <label>Total sqft
          <input type="number" id="pd-edit-sqft" step="0.01" min="0" value="${p.total_sqft != null && p.total_sqft !== '' ? escapeHtml(String(p.total_sqft)) : ''}" />
        </label>
        <label>Valor do contrato (USD)
          <input type="number" id="pd-edit-contract" step="0.01" min="0" value="${p.contract_value != null && p.contract_value !== '' ? escapeHtml(String(p.contract_value)) : ''}" />
        </label>
        <label class="pd-edit-span2">Notas (visíveis no projeto)
          <textarea id="pd-edit-notes" rows="2" placeholder="Observações gerais…">${escapeHtml(p.notes || '')}</textarea>
        </label>
      </div>
      <div class="pd-project-edit__actions">
        <button type="button" class="pd-action-btn pd-action-filled" id="pd-project-save">Guardar alterações</button>
      </div>
    </div>`;
}

async function saveProjectDetails() {
  if (!canEditProject) return;
  const name = document.getElementById('pd-edit-name')?.value?.trim() || '';
  if (!name) {
    showToast('O nome do projeto é obrigatório', 'error');
    return;
  }
  const payload = {
    name,
    ...(isBuilderProject(project)
      ? { client_name: document.getElementById('pd-edit-client-name')?.value?.trim() || null }
      : {}),
    address: document.getElementById('pd-edit-address')?.value?.trim() || null,
    project_number: document.getElementById('pd-edit-number')?.value?.trim() || null,
    flooring_type: document.getElementById('pd-edit-flooring')?.value || null,
    service_type: document.getElementById('pd-edit-service')?.value || null,
    total_sqft: document.getElementById('pd-edit-sqft')?.value?.trim() || null,
    contract_value: document.getElementById('pd-edit-contract')?.value?.trim() || null,
    notes: document.getElementById('pd-edit-notes')?.value?.trim() || null,
  };
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao guardar projeto', 'error');
    return;
  }
  project = { ...project, ...j.data };
  renderHeader(project);
  showToast('Projeto atualizado');
  const plRes = await fetch(`/api/projects/${projectId}/profitability`, { credentials: 'include' });
  const plJson = await plRes.json();
  if (plJson.success) {
    plData = plJson.data;
    renderOverviewTab(project, plData);
  }
}

function renderBuilderBanner(p) {
  const el = document.getElementById('pd-builder-banner');
  if (!el) return;
  if (!isBuilderProject(p)) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const label = builderPartnerLabel(p);
  if (!label) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const clientLine =
    p.client_name || p.lead?.name
      ? `<span class="pd-builder-banner__co"> · Cliente: ${escapeHtml(p.client_name || p.lead?.name || '')}</span>`
      : '';
  el.innerHTML = `<strong>Builder:</strong> ${escapeHtml(label)}${clientLine}`;
}

function renderHeader(p) {
  document.getElementById('pd-title').textContent = p.name || `Projeto #${p.id}`;
  const crumb = document.getElementById('pd-crumb-name');
  if (crumb) crumb.textContent = 'Detalhe';

  const numEl = document.getElementById('pd-number');
  if (numEl) {
    const pn = p.project_number != null && String(p.project_number).trim() !== '' ? String(p.project_number).trim() : null;
    numEl.textContent = pn || `PRJ-${p.id}`;
  }

  const typeEl = document.getElementById('pd-client-type');
  if (typeEl) {
    if (isBuilderProject(p)) {
      typeEl.textContent = 'Builder';
      typeEl.style.display = '';
    } else {
      const t = (p.client_type || '').toLowerCase();
      if (t === 'customer' || t) {
        typeEl.textContent = 'Cliente';
        typeEl.style.display = '';
      } else {
        typeEl.textContent = '';
        typeEl.style.display = 'none';
      }
    }
  }
  renderBuilderBanner(p);

  const sel = document.getElementById('pd-status');
  if (sel && sel.options.length === 0) {
    ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'].forEach((st) => {
      const o = document.createElement('option');
      o.value = st;
      o.textContent = STATUS_LABELS[st] || st;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => updateStatus(sel.value));
  }
  if (sel) sel.value = p.status || 'scheduled';

  const pct = document.getElementById('pd-pct');
  const fill = document.getElementById('pd-progress-fill');
  if (pct) {
    pct.value = p.completion_percentage ?? 0;
    pct.onchange = () => updateCompletion(pct.value);
  }
  if (fill) fill.style.width = `${parseInt(p.completion_percentage, 10) || 0}%`;
  updateProgressDatesLine(p);
}

async function updateStatus(newStatus) {
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus }),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao atualizar status', 'error');
    return;
  }
  project = { ...project, ...j.data };
  showToast('Status atualizado');
  loadProject();
}

let pctTimer;
async function updateCompletion(v) {
  clearTimeout(pctTimer);
  pctTimer = setTimeout(async () => {
    const n = Math.min(100, Math.max(0, parseInt(String(v), 10) || 0));
    await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completion_percentage: n }),
    });
    document.getElementById('pd-progress-fill').style.width = `${n}%`;
    showToast('Progresso guardado');
  }, 400);
}

function allocProjectedForService(pr, contractVal, serviceRevenue) {
  const c = parseFloat(contractVal) || 0;
  const rev = parseFloat(serviceRevenue) || 0;
  if (!pr?.projected || c <= 0) return 0;
  return (rev / c) * (parseFloat(pr.projected.total) || 0);
}

function varianceCellClass(diff, projectedLine) {
  const d = parseFloat(diff) || 0;
  const base = parseFloat(projectedLine) || 0;
  if (d <= 0.005) return 'pd-var pd-var-ok';
  if (base > 0 && d < base * 0.1) return 'pd-var pd-var-warn';
  return 'pd-var pd-var-bad';
}

function formatCostVariance(diff, projectedLine) {
  const d = parseFloat(diff) || 0;
  const base = parseFloat(projectedLine) || 0;
  const sign = d > 0 ? '+' : '';
  const pct = base > 0 ? (d / base) * 100 : 0;
  return `${sign}${fmt$(d)} (${sign}${Math.abs(pct).toFixed(1)}%)`;
}

function serviceCardHtml(key, title, svc, pr, contractVal) {
  const rev = parseFloat(svc.revenue) || 0;
  const actual = parseFloat(svc.total_cost) || 0;
  const projected = pr ? allocProjectedForService(pr, contractVal, rev) : null;
  const profit = parseFloat(svc.gross_profit) != null ? parseFloat(svc.gross_profit) : rev - actual;
  const margin = svc.margin_pct != null ? svc.margin_pct : rev > 0 ? ((profit / rev) * 100).toFixed(1) : 0;
  const projLabel = pr && contractVal > 0 ? fmt$(projected) : '—';
  const cls =
    key === 'supply' ? 'pd-svc-card pd-svc-supply' : key === 'installation' ? 'pd-svc-card pd-svc-install' : 'pd-svc-card pd-svc-sand';
  const id =
    key === 'installation' ? 'installation' : key === 'sand_finish' ? 'sand' : 'supply';
  return `
    <div class="${cls}" id="svc-${id}">
      <div class="pd-svc-title">${title}</div>
      <div class="pd-svc-rows">
        <div class="pd-svc-row"><span>Receita</span><strong>${fmt$(rev)}</strong></div>
        <div class="pd-svc-row"><span>Custo proj.</span><strong>${projLabel}</strong></div>
        <div class="pd-svc-row"><span>Custo real</span><strong>${fmt$(actual)}</strong></div>
        <div class="pd-svc-row"><span>Lucro</span><strong class="pd-profit-val">${fmt$(profit)}</strong></div>
      </div>
      <div class="pd-svc-margin">Margem: <strong>${fmtPct(margin)}</strong></div>
    </div>`;
}

function renderOverviewTab(p, pl) {
  const el = document.getElementById('tab-overview');
  if (!el) return;
  const pr = pl?.profitability || null;
  const contractVal = parseFloat(pl?.contract_value) || parseFloat(pl?.totals?.total_revenue) || 0;
  const bs = pl?.by_service || {};
  const supply = bs.supply || {};
  const inst = bs.installation || {};
  const sand = bs.sand_finish || {};
  const totals = pl?.totals || {};
  const revenueDisplay = contractVal > 0 ? contractVal : parseFloat(totals.total_revenue) || 0;
  const gross = parseFloat(totals.gross_profit) || 0;
  const marginPct = totals.margin_pct != null ? totals.margin_pct : revenueDisplay > 0 ? ((gross / revenueDisplay) * 100).toFixed(1) : 0;
  const marginSub =
    parseFloat(marginPct) >= 35 ? 'acima da meta' : parseFloat(marginPct) >= 25 ? 'no alvo' : 'abaixo da meta';
  const profitSub = (p.status || '') === 'completed' ? 'fechado' : 'em andamento';

  let compareBlock = '';
  let daysBar = '';
  if (pr) {
    const row = (label, pj, ac) => {
      const diff = ac - pj;
      const vc = varianceCellClass(diff, pj);
      return `<div class="pd-compare-row">
        <span>${label}</span>
        <span>${fmt$(pj)}</span>
        <span>${fmt$(ac)}</span>
        <span class="${vc}">${formatCostVariance(diff, pj)}</span>
      </div>`;
    };
    compareBlock = `
    <div class="pd-compare-wrap">
      <div class="pd-compare-title">
        <span class="pd-section-dot"></span>
        Projeção vs custo real
      </div>
      <div class="pd-compare-table">
        <div class="pd-compare-header">
          <span>Item de custo</span>
          <span>Projetado</span>
          <span>Real</span>
          <span>Variação</span>
        </div>
        ${row('Labor (mão de obra)', pr.projected.labor, pr.actual.labor)}
        ${row('Material', pr.projected.material, pr.actual.material)}
        ${row('Custos adicionais', pr.projected.additional, pr.actual.additional)}
        <div class="pd-compare-row pd-compare-total">
          <span>Total</span>
          <span>${fmt$(pr.projected.total)}</span>
          <span>${fmt$(pr.actual.total)}</span>
          <span class="${varianceCellClass(pr.variance.cost_diff, pr.projected.total)}">${formatCostVariance(pr.variance.cost_diff, pr.projected.total)}</span>
        </div>
      </div>
    </div>`;

    const dEst = pr.days_estimated != null ? parseInt(pr.days_estimated, 10) : null;
    const dAct = pr.days_actual != null ? parseInt(pr.days_actual, 10) : null;
    const dVar = pr.days_variance != null ? parseInt(pr.days_variance, 10) : null;
    let varText = '—';
    let varClass = 'pd-days-num';
    if (dVar === 0) {
      varText = 'No prazo';
    } else if (dVar > 0) {
      varText = `+${dVar} dia${dVar > 1 ? 's' : ''}`;
      varClass += ' pd-days-num--warn';
    } else if (dVar < 0) {
      varText = `${dVar} dia${dVar < -1 ? 's' : ''}`;
    }
    const estRange = `${fmtShortPt(p.start_date)} → ${fmtShortPt(p.end_date_estimated)} <strong>estimado</strong>`;
    let realRange = '—';
    if (p.start_date && dAct != null && !Number.isNaN(dAct)) {
      try {
        const start = new Date(`${toYmdFromApi(p.start_date)}T12:00:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + Math.max(0, dAct - 1));
        realRange = `${fmtShortPt(p.start_date)} → ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} <strong>real</strong>`;
      } catch {
        realRange = `—`;
      }
    }

    daysBar = `
    <div class="pd-days-bar">
      <div class="pd-days-item">
        <div class="pd-days-num" id="days-estimated">${dEst != null ? dEst : '—'}</div>
        <div class="pd-days-label">Dias estimados</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="pd-days-num pd-days-num--accent" id="days-actual">${dAct != null ? dAct : '—'}</div>
        <div class="pd-days-label">Dias reais</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="${varClass}" id="days-variance">${varText}</div>
        <div class="pd-days-label">Variação</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-detail" id="days-detail">${estRange}<br />${realRange}</div>
    </div>`;
  } else if (pl && (pl.days_estimated != null || pl.days_actual != null)) {
    const dEst = pl.days_estimated != null ? parseInt(pl.days_estimated, 10) : null;
    const dAct = pl.days_actual != null ? parseInt(pl.days_actual, 10) : null;
    const dVar = pl.days_variance != null ? parseInt(pl.days_variance, 10) : null;
    let varText = '—';
    let varClass = 'pd-days-num';
    if (dVar === 0) varText = 'No prazo';
    else if (dVar > 0) {
      varText = `+${dVar} dia${dVar > 1 ? 's' : ''}`;
      varClass += ' pd-days-num--warn';
    } else if (dVar < 0) varText = `${dVar} dia${dVar < -1 ? 's' : ''}`;
    const estRange = `${fmtShortPt(p.start_date)} → ${fmtShortPt(p.end_date_estimated)} <strong>estimado</strong>`;
    daysBar = `
    <div class="pd-days-bar">
      <div class="pd-days-item">
        <div class="pd-days-num">${dEst != null ? dEst : '—'}</div>
        <div class="pd-days-label">Dias estimados</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="pd-days-num pd-days-num--accent">${dAct != null ? dAct : '—'}</div>
        <div class="pd-days-label">Dias reais</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-item">
        <div class="${varClass}">${varText}</div>
        <div class="pd-days-label">Variação</div>
      </div>
      <div class="pd-days-div"></div>
      <div class="pd-days-detail">${estRange}</div>
    </div>`;
  }

  const partnerLabel = builderPartnerLabel(p);
  el.innerHTML = `
    ${renderProjectEditBlock(p)}
    ${renderProjectTeamBlock(p)}
    <div class="pd-builder-link" style="margin-bottom:16px;padding:12px 14px;border:1px solid var(--border-color);border-radius:10px;background:var(--sf-surface,#f8fafc)">
      <div style="font-size:12px;font-weight:600;color:var(--sf-navy);margin-bottom:8px">Portal do builder${partnerLabel ? ` · <span style="font-weight:500">${escapeHtml(partnerLabel)}</span>` : ''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <select id="pd-builder-partner" style="flex:1;min-width:220px;padding:8px;border-radius:8px;border:1px solid var(--border-color)">
          <option value="">— Sem parceiro —</option>
        </select>
        <button type="button" class="pd-action-btn pd-action-filled" id="pd-builder-partner-save">Guardar</button>
      </div>
      <p id="pd-builder-partner-hint" style="font-size:11px;color:var(--sf-muted);margin:8px 0 0">${partnerLabel ? `Ligado: ${escapeHtml(partnerLabel)}` : 'Selecione um builder cadastrado para o projeto aparecer no portal dele.'}</p>
    </div>
    <div class="pd-service-grid" id="service-cards-grid">
      ${serviceCardHtml('supply', 'Supply', supply, pr, contractVal)}
      ${serviceCardHtml('installation', 'Installation', inst, pr, contractVal)}
      ${serviceCardHtml('sand_finish', 'Sand &amp; Finish', sand, pr, contractVal)}
    </div>
    <div class="pd-totals-card">
      <div class="pd-total-item">
        <div class="pd-total-label">Receita total</div>
        <div class="pd-total-val" id="total-revenue">${fmt$(revenueDisplay)}</div>
        <div class="pd-total-sub">valor do contrato</div>
      </div>
      <div class="pd-total-item">
        <div class="pd-total-label">Custo total</div>
        <div class="pd-total-val" id="total-cost">${fmt$(totals.total_cost)}</div>
        <div class="pd-total-sub" id="total-cost-sub">real até agora</div>
      </div>
      <div class="pd-total-item">
        <div class="pd-total-label">Lucro bruto</div>
        <div class="pd-total-val pd-total-ok" id="total-profit">${fmt$(gross)}</div>
        <div class="pd-total-sub" id="total-profit-sub">${profitSub}</div>
      </div>
      <div class="pd-total-item">
        <div class="pd-total-label">Margem</div>
        <div class="pd-total-val pd-total-ok" id="total-margin">${fmtPct(marginPct)}</div>
        <div class="pd-total-sub" id="total-margin-sub">${marginSub}</div>
      </div>
    </div>
    ${compareBlock}
    ${daysBar}
  `;
  wireBuilderPartnerBlock(p);
  initProjectTeamSelects(p);
  document.getElementById('pd-project-save')?.addEventListener('click', saveProjectDetails);
  wireProjectAddressAutocomplete();
}

function wireProjectAddressAutocomplete() {
  const el = document.getElementById('pd-edit-address');
  if (!el || typeof window.sfAttachAddressAutocomplete !== 'function') return;
  window.sfAttachAddressAutocomplete(el, {
    country: 'us',
    map: { combined: '#pd-edit-address' },
  }).catch(() => {});
}

async function ensureBuilderPartnerOptions() {
  if (builderPartnerOptions) return builderPartnerOptions;
  try {
    const r = await fetch('/api/projects/lookup/builders', { credentials: 'include' });
    const j = await r.json();
    builderPartnerOptions = j.success && Array.isArray(j.data) ? j.data : [];
  } catch {
    builderPartnerOptions = [];
  }
  return builderPartnerOptions;
}

async function wireBuilderPartnerBlock(p) {
  const sel = document.getElementById('pd-builder-partner');
  if (!sel) return;
  const opts = await ensureBuilderPartnerOptions();
  const current = p.partner_builder_id || p.builder_partner?.builder_table_id || '';
  sel.innerHTML =
    '<option value="">— Sem parceiro —</option>' +
    opts
      .map(
        (b) =>
          `<option value="${b.id}"${String(b.id) === String(current) ? ' selected' : ''}>${escapeHtml(b.label || `Builder #${b.id}`)}</option>`
      )
      .join('');
  document.getElementById('pd-builder-partner-save')?.addEventListener('click', saveBuilderPartner);
}

async function saveBuilderPartner() {
  const sel = document.getElementById('pd-builder-partner');
  const val = sel?.value ?? '';
  const res = await fetch(`/api/projects/${projectId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ builder_partner_id: val ? parseInt(val, 10) : null }),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao guardar builder', 'error');
    return;
  }
  project = j.data;
  renderHeader(project);
  if (plData) renderOverviewTab(project, plData);
  showToast('Parceiro builder atualizado');
  const hint = document.getElementById('pd-builder-partner-hint');
  if (hint) {
    hint.textContent = project.builder_partner?.display_name
      ? `Ligado: ${project.builder_partner.display_name}. Visível no portal do builder.`
      : 'Sem parceiro — o projeto não aparece no portal.';
  }
  const tb = document.getElementById('tab-btn-builder');
  if (isBuilderProject(project)) {
    if (tb) tb.style.display = '';
    await renderBuilderTab();
  } else if (tb) tb.style.display = 'none';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

async function loadPaymentForecastTab() {
  const shell = document.getElementById('tab-payforecast');
  if (!shell) return;
  shell.innerHTML = '<p class="pd-muted" style="padding:12px">A carregar previsões…</p>';
  try {
    const res = await fetch(`/api/projects/${projectId}/payment-forecast`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok || !j.success) {
      shell.innerHTML = `<p class="pd-muted" style="padding:12px">Erro: ${escapeHtml(j.error || String(res.status))}</p>`;
      return;
    }
    renderPaymentForecastShell(j.data);
  } catch (_) {
    shell.innerHTML = '<p class="pd-muted" style="padding:12px">Falha de rede ao carregar previsões.</p>';
  }
}

function renderPaymentForecastShell(data) {
  const el = document.getElementById('tab-payforecast');
  if (!el) return;
  const forecasts = data?.forecasts || [];
  const receipts = data?.receipts || [];
  if (data?.tableMissing) {
    el.innerHTML =
      '<p class="pd-muted" style="padding:12px;max-width:520px">A tabela de previsões ainda não existe nesta base. Reinicie o servidor (o schema financeiro cria <code>project_payment_forecasts</code> no arranque).</p>';
    return;
  }

  const typeOpts = Object.entries(PPF_TYPE_LABELS)
    .map(([k, lab]) => `<option value="${escapeHtml(k)}">${escapeHtml(lab)}</option>`)
    .join('');
  const methodOpts = Object.entries(PPF_METHOD_LABELS)
    .map(([k, lab]) => `<option value="${escapeHtml(k)}">${escapeHtml(lab)}</option>`)
    .join('');

  const receiptOpts =
    '<option value="">— (opcional) Ligar a recebimento já registado</option>' +
    receipts
      .map(
        (r) =>
          `<option value="${r.id}">#${r.id} · ${fmtDatePtLong(r.payment_date)} · ${fmt$(r.amount)} · ${escapeHtml(labelPpfType(r.payment_type))}</option>`
      )
      .join('');

  const fcRows = forecasts.length
    ? forecasts
        .map((f) => {
          const linked =
            f.payment_receipt_id != null
              ? ` <span class="pd-muted" style="font-size:11px">→ recebimento #${f.payment_receipt_id}</span>`
              : '';
          return `<tr>
        <td>${escapeHtml(fmtDatePtLong(f.expected_payment_date))}</td>
        <td>${escapeHtml(labelPpfType(f.payment_type))}</td>
        <td>${escapeHtml(labelPpfMethod(f.payment_method))}</td>
        <td>${f.amount != null ? fmt$(f.amount) : '—'}</td>
        <td>${escapeHtml(f.notes || '')}${linked}</td>
        <td style="white-space:nowrap">
          <button type="button" class="pd-btn pd-btn--compact pd-btn--danger" data-pf-del="${f.id}">Excluir</button>
        </td>
      </tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="pd-muted">Nenhuma previsão — adicione abaixo.</td></tr>';

  const rcRows = receipts.length
    ? receipts
        .map(
          (r) => `<tr>
      <td>${escapeHtml(fmtDatePtLong(r.payment_date))}</td>
      <td>${escapeHtml(labelPpfType(r.payment_type))}</td>
      <td>${escapeHtml(labelPpfMethod(r.payment_method))}</td>
      <td>${fmt$(r.amount)}</td>
      <td>${escapeHtml(r.reference_number || '—')}</td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="pd-muted">Sem recebimentos registados no financeiro para este projeto.</td></tr>';

  el.innerHTML = `
    <div class="pd-payforecast-wrap" style="padding:4px 0 24px;max-width:960px">
      <p style="font-size:13px;color:var(--sf-muted);margin:0 0 14px">
        Previsões de recebimento (cliente / obra) alinhadas com o módulo financeiro.
        Os <strong>recebimentos reais</strong> vêm da tabela de recebimentos; pode ligar uma previsão a um recebimento já criado.
        <a href="financial.html" class="pd-breadcrumb-link" style="margin-left:6px">Abrir Financeiro</a>
      </p>

      <h3 style="font-size:14px;margin:18px 0 8px">Recebimentos registados (financeiro)</h3>
      <div class="fin-table-wrap" style="overflow-x:auto;margin-bottom:20px">
        <table class="pd-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Forma</th><th>Valor</th><th>Ref.</th></tr></thead>
          <tbody>${rcRows}</tbody>
        </table>
      </div>

      <h3 style="font-size:14px;margin:18px 0 8px">Previsões</h3>
      <div class="fin-table-wrap" style="overflow-x:auto;margin-bottom:16px">
        <table class="pd-table">
          <thead><tr><th>Data prevista</th><th>Tipo</th><th>Forma de pagamento</th><th>Valor</th><th>Notas</th><th></th></tr></thead>
          <tbody>${fcRows}</tbody>
        </table>
      </div>

      <div class="sf-card" style="padding:14px">
        <p style="font-weight:600;margin:0 0 10px;font-size:13px">Nova previsão</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;align-items:end">
          <label style="font-size:12px">Data prevista *
            <input type="date" id="pf-new-date" class="pd-date-input" style="width:100%;margin-top:4px" />
          </label>
          <label style="font-size:12px">Tipo
            <select id="pf-new-type" style="width:100%;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--border-color)">${typeOpts}</select>
          </label>
          <label style="font-size:12px">Forma
            <select id="pf-new-method" style="width:100%;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--border-color)">${methodOpts}</select>
          </label>
          <label style="font-size:12px">Valor (USD)
            <input type="text" id="pf-new-amount" placeholder="0" style="width:100%;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--border-color)" />
          </label>
        </div>
        <label style="font-size:12px;display:block;margin-top:10px">Ligação opcional
          <select id="pf-new-receipt" style="width:100%;max-width:100%;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--border-color)">${receiptOpts}</select>
        </label>
        <label style="font-size:12px;display:block;margin-top:10px">Notas
          <input type="text" id="pf-new-notes" maxlength="500" style="width:100%;margin-top:4px;padding:6px;border-radius:8px;border:1px solid var(--border-color)" />
        </label>
        <button type="button" class="pd-action-btn pd-action-filled" id="pf-new-submit" style="margin-top:12px">Adicionar previsão</button>
      </div>
    </div>`;

  el.querySelectorAll('[data-pf-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-pf-del'), 10);
      if (!id || !confirm('Eliminar esta previsão?')) return;
      const raw = await fetch(`/api/projects/${projectId}/payment-forecast/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const j = await raw.json().catch(() => ({}));
      if (!raw.ok || !j.success) {
        showToast(j.error || 'Erro ao eliminar', 'error');
        return;
      }
      showToast('Previsão eliminada');
      loadPaymentForecastTab();
    });
  });

  document.getElementById('pf-new-submit')?.addEventListener('click', async () => {
    const expected_payment_date = document.getElementById('pf-new-date')?.value?.trim() || '';
    if (!expected_payment_date) {
      showToast('Indique a data prevista', 'error');
      return;
    }
    const body = {
      expected_payment_date,
      payment_type: document.getElementById('pf-new-type')?.value || 'progress',
      payment_method: document.getElementById('pf-new-method')?.value || 'check',
      amount: document.getElementById('pf-new-amount')?.value?.trim() || null,
      notes: document.getElementById('pf-new-notes')?.value?.trim() || null,
      payment_receipt_id: document.getElementById('pf-new-receipt')?.value || null,
    };
    const raw = await fetch(`/api/projects/${projectId}/payment-forecast`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await raw.json().catch(() => ({}));
    if (!raw.ok || !j.success) {
      showToast(j.error || 'Erro ao criar', 'error');
      return;
    }
    showToast('Previsão adicionada');
    loadPaymentForecastTab();
  });
}

function costRowIsProjected(r) {
  return r.is_projected === 1 || r.is_projected === true;
}

/** Atualiza visibilidade das linhas e totais conforme filtro real / projetado (aba Custos). */
function applyCostProjectionFilter() {
  const sel = document.getElementById('pd-cost-filter');
  if (!sel) return;
  const v = sel.value;
  try {
    localStorage.setItem('sf_project_cost_filter', v);
  } catch (_) {}

  const tab = document.getElementById('tab-costs');
  if (!tab) return;

  tab.querySelectorAll('.pd-collapsible[data-section]').forEach((section) => {
    const table = section.querySelector('table.pd-table tbody');
    if (!table) return;
    const rows = table.querySelectorAll('tr[data-projection]');
    let sum = 0;
    let anyShown = false;
    rows.forEach((tr) => {
      const p = tr.getAttribute('data-projection');
      const show = v === 'all' || (v === 'real' && p === '0') || (v === 'projected' && p === '1');
      tr.classList.toggle('pd-cost-row-hidden', !show);
      if (show) {
        sum += parseFloat(tr.getAttribute('data-total')) || 0;
        anyShown = true;
      }
    });
    const noMatch = table.querySelector('tr.pd-cost-no-match');
    if (noMatch) {
      noMatch.hidden = anyShown || rows.length === 0;
    }
    const sumEl = section.querySelector('.pd-cost-section-sum');
    if (sumEl) sumEl.textContent = fmt$(sum);
  });

  let grand = 0;
  tab.querySelectorAll('tr[data-projection]:not(.pd-cost-row-hidden)').forEach((tr) => {
    grand += parseFloat(tr.getAttribute('data-total')) || 0;
  });
  const grandEl = document.getElementById('pd-costs-grand-total');
  if (grandEl) grandEl.textContent = fmt$(grand);
  const sub = document.getElementById('pd-costs-grand-sub');
  if (sub) {
    if (v === 'all') sub.textContent = 'todos os itens';
    else if (v === 'real') sub.textContent = 'apenas custos reais';
    else sub.textContent = 'apenas custos projetados';
  }
}

function syncCostEntryModeToAllForms(mode) {
  document
    .querySelectorAll('#tab-costs select[data-f="is_projected"], #tab-costs select[data-f="general_is_projected"]')
    .forEach((s) => {
      s.value = mode;
    });
}

function wireCostEntryModeDefaults() {
  const master = document.getElementById('pd-cost-entry-mode');
  if (!master) return;
  try {
    const m = localStorage.getItem('sf_project_cost_entry_mode');
    if (m === '0' || m === '1') master.value = m;
  } catch (_) {}
  syncCostEntryModeToAllForms(master.value);
  master.addEventListener('change', () => {
    try {
      localStorage.setItem('sf_project_cost_entry_mode', master.value);
    } catch (_) {}
    syncCostEntryModeToAllForms(master.value);
  });
}

function persistCostEntryModeFromForm(form) {
  const sel =
    form?.querySelector('[data-f="is_projected"]') || form?.querySelector('[data-f="general_is_projected"]');
  if (!sel) return;
  try {
    localStorage.setItem('sf_project_cost_entry_mode', sel.value);
    const master = document.getElementById('pd-cost-entry-mode');
    if (master) master.value = sel.value;
  } catch (_) {}
}

function updateMaterialCalcTotal(form) {
  if (!form || form.getAttribute('data-add') !== 'material') return;
  const get = (n) => form.querySelector(`[data-f="${n}"]`)?.value;
  const qo = parseCostNumber(get('qty_ordered'));
  const qu = parseCostNumber(get('qty_used'));
  const qr = parseCostNumber(get('qty_received'));
  const uc = parseCostNumber(get('unit_cost'));
  const line = qo > 0 ? qo : qu > 0 ? qu : qr;
  const el = form.querySelector('[data-f="material_calc_total"]');
  if (el) el.textContent = fmt$(line * uc);
}

function wireMaterialCalcAndRowActions(root) {
  root.querySelectorAll('[data-add="material"]').forEach((form) => {
    ['qty_ordered', 'qty_used', 'qty_received', 'unit_cost'].forEach((name) => {
      form.querySelector(`[data-f="${name}"]`)?.addEventListener('input', () => updateMaterialCalcTotal(form));
    });
    updateMaterialCalcTotal(form);
  });

  root.querySelectorAll('[data-edit-mat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-mat');
      const m = (project?.materials || []).find((x) => String(x.id) === String(id));
      if (!m) {
        showToast('Material não encontrado', 'error');
        return;
      }
      const form = root.querySelector('[data-add="material"]');
      if (!form) return;
      const section = form.closest('.pd-collapsible');
      section?.classList.add('open');
      form.querySelector('[data-f="material_edit_id"]').value = String(m.id);
      form.querySelector('[data-f="product_name"]').value = m.product_name || '';
      form.querySelector('[data-f="sku"]').value = m.sku != null ? String(m.sku) : '';
      form.querySelector('[data-f="supplier"]').value = m.supplier != null ? String(m.supplier) : '';
      form.querySelector('[data-f="unit"]').value = m.unit != null ? String(m.unit) : '';
      form.querySelector('[data-f="qty_ordered"]').value = m.qty_ordered != null ? String(m.qty_ordered) : '';
      form.querySelector('[data-f="qty_received"]').value = m.qty_received != null ? String(m.qty_received) : '';
      form.querySelector('[data-f="qty_used"]').value = m.qty_used != null ? String(m.qty_used) : '';
      form.querySelector('[data-f="unit_cost"]').value = m.unit_cost != null ? String(m.unit_cost) : '';
      form.querySelector('[data-f="service_category"]').value = m.service_category || 'general';
      form.querySelector('[data-f="is_projected"]').value = costRowIsProjected(m) ? '1' : '0';
      const st = form.querySelector('[data-f="status"]');
      if (st) {
        const ok = ['pending', 'ordered', 'received', 'partial', 'returned'];
        st.value = m.status && ok.includes(String(m.status)) ? String(m.status) : 'ordered';
      }
      const notes = form.querySelector('[data-f="mat_notes"]');
      if (notes) notes.value = m.notes != null ? String(m.notes) : '';
      const mc = form.querySelector('[data-f="material_color"]');
      if (mc) mc.value = m.material_color != null ? String(m.material_color) : '';
      const ms = form.querySelector('[data-f="material_spec"]');
      if (ms) ms.value = m.material_spec != null ? String(m.material_spec) : '';
      const mi = form.querySelector('[data-f="material_image_url"]');
      if (mi) mi.value = m.material_image_url != null ? String(m.material_image_url) : '';
      const hid = form.querySelector('[data-f="erp_product_id"]');
      const search = form.querySelector('[data-f="erp_product_search"]');
      if (m.erp_product_id != null && String(m.erp_product_id).trim() !== '') {
        if (hid) hid.value = String(m.erp_product_id);
        if (search) search.value = [m.product_name, m.sku].filter(Boolean).join(' · ');
      } else {
        if (hid) hid.value = '';
        if (search) search.value = '';
      }
      const cancel = form.querySelector('[data-cancel-mat-edit]');
      if (cancel) cancel.style.display = '';
      const sub = form.querySelector('[data-submit-cost="material"]');
      if (sub) sub.textContent = 'Salvar alterações';
      updateMaterialCalcTotal(form);
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  root.querySelectorAll('[data-del-mat]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-del-mat');
      if (!id || !confirm('Excluir este material do projeto?')) return;
      const res = await fetch(`/api/projects/${projectId}/materials/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) showToast(j.error || 'Erro ao excluir', 'error');
      else showToast('Material excluído');
      loadProject();
    });
  });

  root.querySelectorAll('[data-cancel-mat-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.closest('[data-add="material"]');
      if (!form) return;
      form.querySelector('[data-f="material_edit_id"]').value = '';
      form.querySelector('[data-f="erp_product_id"]').value = '';
      form.querySelector('[data-f="erp_product_search"]').value = '';
      form.querySelector('[data-f="product_name"]').value = '';
      form.querySelector('[data-f="sku"]').value = '';
      form.querySelector('[data-f="supplier"]').value = '';
      form.querySelector('[data-f="unit"]').value = '';
      form.querySelector('[data-f="qty_ordered"]').value = '';
      form.querySelector('[data-f="qty_received"]').value = '';
      form.querySelector('[data-f="qty_used"]').value = '';
      form.querySelector('[data-f="unit_cost"]').value = '';
      form.querySelector('[data-f="mat_notes"]').value = '';
      if (form.querySelector('[data-f="status"]')) form.querySelector('[data-f="status"]').value = 'ordered';
      form.querySelector('[data-f="service_category"]').value = 'supply';
      const master = document.getElementById('pd-cost-entry-mode');
      form.querySelector('[data-f="is_projected"]').value = master && master.value === '1' ? '1' : '0';
      btn.style.display = 'none';
      const sub = form.querySelector('[data-submit-cost="material"]');
      if (sub) sub.textContent = sub.getAttribute('data-default-label') || '+ Adicionar material';
      updateMaterialCalcTotal(form);
    });
  });
}

function renderCostsTab(p) {
  const el = document.getElementById('tab-costs');
  if (!el) return;
  const costs = p.costs || [];
  const labor = costs.filter((c) => c.cost_type === 'labor');
  const additional = costs.filter((c) => c.cost_type === 'additional');
  const materials = p.materials || [];
  const sumLabor = labor.reduce((a, x) => a + (parseFloat(x.total_cost) || 0), 0);
  const sumAdd = additional.reduce((a, x) => a + (parseFloat(x.total_cost) || 0), 0);
  const sumMat = materials.reduce((a, x) => a + (parseFloat(x.total_cost) || 0), 0);
  const grand = sumLabor + sumAdd + sumMat;
  el.innerHTML = `
    <div class="pd-cost-filter-bar">
      <div class="pd-cost-filter-group">
        <label for="pd-cost-filter">Visualizar</label>
        <select id="pd-cost-filter" class="pd-cost-filter-select" aria-label="Filtrar custos por real ou projetado">
          <option value="all">Todos (real + projetado)</option>
          <option value="real">Somente custo real</option>
          <option value="projected">Somente custo projetado</option>
        </select>
      </div>
      <div class="pd-cost-filter-group">
        <label for="pd-cost-entry-mode">Novo lançamento</label>
        <select id="pd-cost-entry-mode" class="pd-cost-filter-select" aria-label="Padrão real ou projetado para novos custos">
          <option value="0">Custo real</option>
          <option value="1">Custo projetado</option>
        </select>
      </div>
    </div>
    <button type="button" class="pd-btn pd-btn--primary" id="btn-sync-payroll-tab" style="margin-bottom:14px">🔄 Importar da folha de pagamento</button>
    <p class="pd-cost-grand-line">
      <span class="pd-cost-grand-label">Total (filtro):</span>
      <strong id="pd-costs-grand-total">${fmt$(grand)}</strong>
      <span class="pd-cost-grand-sub" id="pd-costs-grand-sub">todos os itens</span>
    </p>
    ${costSection('labor', 'Mão de obra (labor)', labor, sumLabor, 'labor', null, constructionPayrollRates)}
    ${costSection('material', 'Materiais (stock)', [], sumMat, 'material', materials)}
    ${costSection('additional', 'Adicional', additional, sumAdd, 'additional')}
  `;
  el.querySelectorAll('.pd-collapsible-h').forEach((h) => {
    h.addEventListener('click', () => h.closest('.pd-collapsible').classList.toggle('open'));
  });
  wireCostForms(el, p);
  wireErpProductMaterialPickers(el);
  wireMaterialCalcAndRowActions(el);
  document.getElementById('btn-sync-payroll-tab')?.addEventListener('click', syncPayroll);
  const filt = document.getElementById('pd-cost-filter');
  if (filt) {
    try {
      const s = localStorage.getItem('sf_project_cost_filter');
      if (s === 'real' || s === 'projected' || s === 'all') filt.value = s;
    } catch (_) {}
    filt.addEventListener('change', applyCostProjectionFilter);
    applyCostProjectionFilter();
  }
  wireCostEntryModeDefaults();
}

function costSection(key, title, rows, sum, type, matRows, payrollEmployees) {
  const isMat = type === 'material';
  const list = isMat ? matRows : rows;
  const matExtra =
    isMat
      ? `<div class="pd-inline-form pd-mat-general" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--sf-border)">
    <p style="grid-column:1/-1;font-size:13px;color:var(--sf-muted);margin:0 0 4px">Custos gerais de materiais (valor único, ex. consumíveis diversos)</p>
    ${materialGeneralFormFields()}
    <button type="button" class="pd-btn pd-btn--primary" style="grid-column:1/-1" data-submit-general-material>+ Adicionar custo geral</button>
  </div>`
      : '';
  return `
    <div class="pd-collapsible open" data-section="${key}">
      <div class="pd-collapsible-h"><span>${title}</span><span class="pd-cost-section-sum">${fmt$(sum)}</span></div>
      <div class="pd-collapsible-b">
        <table class="pd-table">
          <thead><tr><th>Descrição</th><th>Cat.</th><th>Qtd</th><th>Un.</th><th>Unit</th><th>Total</th>${isMat ? '<th>Status</th>' : '<th>Pago</th>'}<th></th></tr></thead>
          <tbody>
            ${
              list.length
                ? `${list.map((r) => costRowHtml(r, isMat)).join('')}<tr class="pd-cost-no-match" hidden><td colspan="8" style="color:var(--sf-muted)">Nenhum item neste filtro</td></tr>`
                : '<tr><td colspan="8" style="color:var(--sf-muted)">Sem itens</td></tr>'
            }
          </tbody>
        </table>
        <div class="pd-inline-form" data-add="${type}">
          ${isMat ? materialFormFields() : type === 'labor' ? laborFormFields(payrollEmployees || []) : additionalFormFields()}
          <button type="button" class="pd-btn pd-btn--primary" style="grid-column:1/-1" data-submit-cost="${type}" data-default-label="${isMat ? '+ Adicionar material' : '+ Adicionar'}">${isMat ? '+ Adicionar material' : '+ Adicionar'}</button>
        </div>
        ${matExtra}
      </div>
    </div>`;
}

function laborFormFields(employees) {
  const opts =
    employees && employees.length
      ? employees
          .map((e) => {
            const pt = e.payment_type || 'daily';
            const hint = pt === 'hourly' ? 'hora' : pt === 'mixed' ? 'misto' : 'diária';
            const label = `${e.name || ''}${e.role ? ' — ' + e.role : ''} (${hint})`;
            const dr = parseFloat(e.daily_rate) || 0;
            const hr = parseFloat(e.hourly_rate) || 0;
            return `<option value="${e.id}" data-payment="${escapeHtml(pt)}" data-daily="${dr}" data-hourly="${hr}" data-name="${escapeHtml(e.name || '')}">${escapeHtml(label)}</option>`;
          })
          .join('')
      : '';
  const payrollHint =
    employees && employees.length
      ? ''
      : '<p style="grid-column:1/-1;font-size:12px;color:var(--sf-muted);margin:0">Nenhum funcionário ativo na folha de construção — preencha custo e unidade manualmente.</p>';
  return `
    <select data-f="payroll_pick" style="grid-column:1/-1">
      <option value="">— Funcionário (folha) / aplicar diária ou hora —</option>
      ${opts}
    </select>
    ${payrollHint}
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="text" data-f="description" placeholder="Descrição" />
    <input type="number" data-f="quantity" placeholder="Qtd (ex. nº de diárias)" step="0.01" value="1" />
    <input type="text" data-f="unit" placeholder="Unidade (dias, h…)" />
    <input type="number" data-f="unit_cost" placeholder="Custo unit. (preenche pela folha)" step="0.01" />
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>`;
}

function materialGeneralFormFields() {
  return `
    <select data-f="general_is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="number" data-f="general_total" placeholder="Valor total ($)" step="0.01" min="0" />
    <select data-f="general_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>
    <input type="text" data-f="general_notes" placeholder="Notas (opcional)" style="grid-column:1/-1" />`;
}

function erpUnitDisplay(ut) {
  const u = String(ut || 'sq_ft').toLowerCase();
  if (u === 'sq_ft') return 'sq ft';
  if (u === 'linear_ft') return 'linear ft';
  return u.replace(/_/g, ' ');
}

function materialFormFields() {
  return `
    <input type="hidden" data-f="material_edit_id" value="" />
    <div class="pd-erp-wrap" style="grid-column:1/-1">
      <span class="pd-erp-label">Catálogo ERP</span>
      <div class="pd-erp-search-wrap">
        <input type="search" data-f="erp_product_search" placeholder="Pesquisar produto (nome ou SKU)…" autocomplete="off" />
        <input type="hidden" data-f="erp_product_id" value="" />
        <div class="pd-erp-results" data-erp-results hidden></div>
      </div>
    </div>
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <select data-f="status" style="grid-column:1/-1" aria-label="Status do material">
      <option value="ordered">Pedido / planejado</option>
      <option value="pending">Pendente</option>
      <option value="partial">Recebimento parcial</option>
      <option value="received">Recebido</option>
      <option value="returned">Devolvido</option>
    </select>
    <input type="text" data-f="product_name" placeholder="Produto" />
    <input type="text" data-f="sku" placeholder="SKU" />
    <input type="text" data-f="supplier" placeholder="Fornecedor" />
    <input type="text" data-f="unit" placeholder="Unidade (ex. sq ft, caixa)" />
    <input type="number" data-f="qty_ordered" placeholder="Qtd pedida" step="0.01" inputmode="decimal" />
    <input type="number" data-f="qty_received" placeholder="Qtd recebida" step="0.01" inputmode="decimal" />
    <input type="number" data-f="qty_used" placeholder="Qtd usada" step="0.01" inputmode="decimal" />
    <input type="number" data-f="unit_cost" placeholder="Custo unit." step="0.01" inputmode="decimal" />
    <p class="pd-mat-calc-line" style="grid-column:1/-1">Total (qtd base × custo unit.): <strong data-f="material_calc_total">—</strong></p>
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>
    <input type="text" data-f="mat_notes" placeholder="Notas (opcional)" style="grid-column:1/-1" />
    <input type="text" data-f="material_color" placeholder="Cor (portal builder)" style="grid-column:1/-1" />
    <input type="text" data-f="material_spec" placeholder="Especificação (dimensões, acabamento…)" style="grid-column:1/-1" />
    <input type="url" data-f="material_image_url" placeholder="URL foto do material (portal)" style="grid-column:1/-1" />
    <button type="button" class="pd-btn" style="grid-column:1/-1;display:none" data-cancel-mat-edit>Cancelar edição</button>`;
}

function additionalFormFields() {
  return `
    <select data-f="is_projected" style="grid-column:1/-1">
      <option value="0">Custo real</option>
      <option value="1">Projetado</option>
    </select>
    <input type="text" data-f="description" placeholder="Descrição" style="grid-column:span 2" />
    <input type="number" data-f="quantity" placeholder="Qtd" step="0.01" value="1" />
    <input type="number" data-f="unit_cost" placeholder="Valor total como unit*qtd" step="0.01" />
    <select data-f="service_category"><option value="general">general</option><option value="supply">supply</option><option value="installation">installation</option><option value="sand_finish">sand_finish</option></select>
    <input type="text" data-f="vendor" placeholder="Vendor" />`;
}

function costRowHtml(r, isMat) {
  const projFlag = costRowIsProjected(r) ? '1' : '0';
  const totNum = parseFloat(r.total_cost) || 0;
  if (isMat) {
    const proj = costRowIsProjected(r) ? ' <small>(proj.)</small>' : '';
    const erp =
      r.erp_product_id != null && String(r.erp_product_id).trim() !== ''
        ? ' <span class="pd-erp-badge" title="Ligado ao ERP">ERP</span>'
        : '';
    return `<tr data-projection="${projFlag}" data-total="${totNum}">
      <td>${escapeHtml(r.product_name)}${erp}${proj}</td><td>${escapeHtml(r.service_category)}</td>
      <td>${r.qty_ordered}</td><td>${escapeHtml(r.unit || '')}</td><td>${fmt$(r.unit_cost)}</td><td>${fmt$(r.total_cost)}</td>
      <td>${escapeHtml(materialStatusLabel(r.status))}</td>
      <td class="pd-table-actions"><button type="button" class="pd-btn pd-btn--compact" data-edit-mat="${r.id}">Editar</button><button type="button" class="pd-btn pd-btn--compact pd-btn--danger" data-del-mat="${r.id}">Excluir</button></td></tr>`;
  }
  const proj = costRowIsProjected(r) ? ' <small>(proj.)</small>' : '';
  return `<tr data-projection="${projFlag}" data-total="${totNum}">
    <td>${escapeHtml(r.description)}${proj}</td><td>${escapeHtml(r.service_category)}</td>
    <td>${r.quantity}</td><td>${escapeHtml(r.unit || '')}</td><td>${fmt$(r.unit_cost)}</td><td>${fmt$(r.total_cost)}</td>
    <td>${r.paid ? 'Sim' : 'Não'}</td>
    <td><button type="button" class="pd-btn" data-del-cost="${r.id}">✕</button></td></tr>`;
}

function wirePayrollPick(root) {
  root.querySelectorAll('[data-f="payroll_pick"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      if (!opt || !sel.value) return;
      const form = sel.closest('.pd-inline-form');
      if (!form) return;
      const pt = (opt.getAttribute('data-payment') || 'daily').toLowerCase();
      const daily = parseFloat(opt.getAttribute('data-daily')) || 0;
      const hourly = parseFloat(opt.getAttribute('data-hourly')) || 0;
      const uc = form.querySelector('[data-f="unit_cost"]');
      const u = form.querySelector('[data-f="unit"]');
      const desc = form.querySelector('[data-f="description"]');
      if (pt === 'hourly') {
        if (uc) uc.value = hourly > 0 ? String(hourly) : '';
        if (u) u.value = 'h';
      } else if (pt === 'mixed') {
        if (daily > 0) {
          if (uc) uc.value = String(daily);
          if (u) u.value = 'dias';
        } else if (hourly > 0) {
          if (uc) uc.value = String(hourly);
          if (u) u.value = 'h';
        }
      } else {
        if (uc) uc.value = daily > 0 ? String(daily) : '';
        if (u) u.value = 'dias';
      }
      const name = opt.getAttribute('data-name') || '';
      if (desc && name && !String(desc.value).trim()) desc.value = name;
    });
  });
}

let erpMaterialSearchTimer = null;

async function fetchErpProductsForProject(q) {
  const res = await fetch(
    `/api/projects/lookup/erp-products?q=${encodeURIComponent(q)}&limit=80`,
    { credentials: 'include' }
  );
  const j = await res.json();
  if (!j.success) return { list: [], erp: false };
  return { list: j.data || [], erp: j.erp_available !== false };
}

function wireErpProductMaterialPickers(root) {
  root.querySelectorAll('[data-add="material"]').forEach((form) => {
    const search = form.querySelector('[data-f="erp_product_search"]');
    const box = form.querySelector('[data-erp-results]');
    const hid = form.querySelector('[data-f="erp_product_id"]');
    if (!search || !box || !hid) return;

    const applyProduct = (p) => {
      hid.value = String(p.id);
      const pn = form.querySelector('[data-f="product_name"]');
      const sku = form.querySelector('[data-f="sku"]');
      const sup = form.querySelector('[data-f="supplier"]');
      const unit = form.querySelector('[data-f="unit"]');
      const uc = form.querySelector('[data-f="unit_cost"]');
      const cat = form.querySelector('[data-f="service_category"]');
      if (pn) pn.value = p.name || '';
      if (sku) sku.value = p.sku || '';
      if (sup) sup.value = p.supplier_name || '';
      if (unit) unit.value = erpUnitDisplay(p.unit_type);
      if (uc) uc.value = p.cost_price != null ? String(p.cost_price) : '';
      if (cat) cat.value = 'supply';
      search.value = [p.name, p.sku].filter(Boolean).join(' · ');
      box.innerHTML = '';
      box.hidden = true;
      updateMaterialCalcTotal(form);
    };

    search.addEventListener('input', () => {
      clearTimeout(erpMaterialSearchTimer);
      hid.value = '';
      const q = search.value.trim();
      if (q.length < 2) {
        box.innerHTML = '';
        box.hidden = true;
        return;
      }
      erpMaterialSearchTimer = setTimeout(async () => {
        const { list, erp } = await fetchErpProductsForProject(q);
        if (!erp) {
          box.innerHTML =
            '<div class="pd-erp-row pd-erp-row--muted">ERP indisponível — use cadastro manual ou rode migrate supplier-product.</div>';
          box.hidden = false;
          return;
        }
        if (!list.length) {
          box.innerHTML = '<div class="pd-erp-row pd-erp-row--muted">Nenhum resultado</div>';
          box.hidden = false;
          return;
        }
        box.innerHTML = list
          .map(
            (p) =>
              `<button type="button" class="pd-erp-row" data-erp-pick="${p.id}"><strong>${escapeHtml(p.name || '')}</strong><span>${escapeHtml(p.sku || '—')} · ${fmt$(p.cost_price)} · ${escapeHtml(p.supplier_name || '')}</span></button>`
          )
          .join('');
        box.hidden = false;
        box.querySelectorAll('[data-erp-pick]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const pid = parseInt(btn.getAttribute('data-erp-pick'), 10);
            const row = list.find((x) => x.id === pid);
            if (row) applyProduct(row);
          });
        });
      }, 300);
    });

    search.addEventListener('blur', () => {
      setTimeout(() => {
        if (!box.matches(':hover')) box.hidden = true;
      }, 200);
    });
  });
}

function wireCostForms(root) {
  wirePayrollPick(root);
  root.querySelectorAll('[data-submit-general-material]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const form = btn.closest('.pd-mat-general');
      const get = (name) => form?.querySelector(`[data-f="${name}"]`)?.value;
      const total = parseFloat(get('general_total')) || 0;
      if (total <= 0) {
        showToast('Informe o valor total dos custos gerais', 'error');
        return;
      }
      const body = {
        product_name: 'Custos gerais de materiais',
        unit: 'total',
        qty_ordered: 1,
        qty_received: 0,
        qty_used: 0,
        unit_cost: total,
        service_category: get('general_category') || 'general',
        notes: get('general_notes')?.trim() || null,
        is_projected: get('general_is_projected') === '1',
      };
      const res = await fetch(`/api/projects/${projectId}/materials`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) showToast(j.error || 'Erro', 'error');
      else {
        showToast('Custo geral de materiais adicionado');
        persistCostEntryModeFromForm(form);
        form.querySelector('[data-f="general_total"]').value = '';
        const n = form.querySelector('[data-f="general_notes"]');
        if (n) n.value = '';
      }
      loadProject();
    });
  });
  root.querySelectorAll('[data-submit-cost]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.getAttribute('data-submit-cost');
      const form = btn.closest('.pd-inline-form');
      const get = (name) => form.querySelector(`[data-f="${name}"]`)?.value;
      if (type === 'material') {
        const editId = (get('material_edit_id') || '').trim();
        if (!String(get('product_name') || '').trim()) {
          showToast('Informe o nome do produto', 'error');
          return;
        }
        const body = {
          product_name: get('product_name'),
          sku: (get('sku') || '').trim() || null,
          supplier: (get('supplier') || '').trim() || null,
          unit: (get('unit') || '').trim() || null,
          qty_ordered: parseCostNumber(get('qty_ordered')),
          qty_received: parseCostNumber(get('qty_received')),
          qty_used: parseCostNumber(get('qty_used')),
          unit_cost: parseCostNumber(get('unit_cost')),
          service_category: get('service_category') || 'general',
          status: get('status') || undefined,
          notes: (get('mat_notes') || '').trim() || null,
          material_color: (get('material_color') || '').trim() || null,
          material_spec: (get('material_spec') || '').trim() || null,
          material_image_url: (get('material_image_url') || '').trim() || null,
          is_projected: get('is_projected') === '1',
        };
        const eidRaw = get('erp_product_id');
        if (eidRaw) {
          const n = parseInt(String(eidRaw), 10);
          if (Number.isFinite(n) && n > 0) body.erp_product_id = n;
        } else if (editId) {
          body.erp_product_id = null;
        }
        const url = editId
          ? `/api/projects/${projectId}/materials/${editId}`
          : `/api/projects/${projectId}/materials`;
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok || !j.success) showToast(j.error || 'Erro', 'error');
        else {
          showToast(editId ? 'Material atualizado' : 'Material adicionado');
          persistCostEntryModeFromForm(form);
        }
      } else {
        const body = {
          cost_type: type,
          description: get('description') || 'Item',
          quantity: get('quantity') || 1,
          unit: get('unit') || null,
          unit_cost: get('unit_cost') || 0,
          service_category: get('service_category') || 'general',
          vendor: get('vendor') || null,
          is_projected: get('is_projected') === '1',
        };
        const res = await fetch(`/api/projects/${projectId}/costs`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok || !j.success) showToast(j.error || 'Erro', 'error');
        else {
          showToast('Custo adicionado');
          persistCostEntryModeFromForm(form);
        }
      }
      loadProject();
    });
  });
  root.querySelectorAll('[data-del-cost]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-del-cost');
      await fetch(`/api/projects/${projectId}/costs/${id}`, { method: 'DELETE', credentials: 'include' });
      loadProject();
    });
  });
}

function renderChecklistTab() {
  const el = document.getElementById('tab-checklist');
  if (!el) return;
  const items = Object.values(checklistGrouped).flat();
  const total = items.length;
  const done = items.filter((i) => i.checked === 1 || i.checked === true).length;
  const banner =
    project.checklist_completed && project.checklist_completed_at
      ? `<div class="pd-banner-ok">Vistoria concluída ✓ ${escapeHtml(String(project.checklist_completed_at).slice(0, 16))}</div>`
      : '';
  el.innerHTML = `
    ${banner}
    <p style="font-size:13px;margin-bottom:8px"><strong>${done}</strong> de <strong>${total}</strong> itens</p>
    <div style="height:8px;background:rgba(26,32,54,.1);border-radius:6px;margin-bottom:12px"><div style="height:100%;width:${total ? (done / total) * 100 : 0}%;background:var(--sf-ok);border-radius:6px"></div></div>
    <button type="button" class="pd-btn" id="btn-check-all" style="margin-bottom:14px">Marcar todos como concluído</button>
    <div id="checklist-groups"></div>
  `;
  const host = document.getElementById('checklist-groups');
  Object.keys(checklistGrouped)
    .sort()
    .forEach((cat) => {
      const wrap = document.createElement('div');
      wrap.className = 'pd-check-cat';
      wrap.innerHTML = `<h4>${escapeHtml(cat)}</h4>`;
      checklistGrouped[cat].forEach((item) => {
        const block = document.createElement('div');
        block.style.marginBottom = '10px';
        const row = document.createElement('div');
        row.className = 'pd-check-item';
        const checked = item.checked === 1 || item.checked === true;
        const visPortal = item.visible_to_builder === 1 || item.visible_to_builder === true;
        const assignedTo = String(item.assigned_to || 'sf').toLowerCase() === 'builder' ? 'builder' : 'sf';
        row.innerHTML = `
          <input type="checkbox" id="chk-${item.id}" data-item-id="${item.id}" ${checked ? 'checked' : ''} />
          <label for="chk-${item.id}" style="flex:1;cursor:pointer;font-size:13px">${escapeHtml(item.item)}</label>
          <button type="button" class="pd-btn" data-toggle-note="${item.id}" aria-label="Nota">▾</button>`;
        const portalMeta = document.createElement('div');
        portalMeta.style.cssText =
          'display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-left:28px;margin-top:6px;font-size:11px;color:var(--sf-muted)';
        portalMeta.innerHTML = `
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" data-portal-visible="${item.id}" ${visPortal ? 'checked' : ''} />
            Visível no portal do builder
          </label>
          <label>Responsável
            <select data-portal-assigned="${item.id}" style="margin-left:4px;padding:2px 6px;border-radius:4px;border:1px solid var(--sf-border)">
              <option value="sf" ${assignedTo === 'sf' ? 'selected' : ''}>Senior Floors</option>
              <option value="builder" ${assignedTo === 'builder' ? 'selected' : ''}>Builder</option>
            </select>
          </label>`;
        const note = document.createElement('div');
        note.style.cssText = 'display:none;width:100%;margin-top:4px;padding-left:28px;box-sizing:border-box';
        note.innerHTML = `<textarea data-note="${item.id}" rows="2" style="width:100%;border-radius:6px;border:1px solid var(--sf-border);padding:6px;box-sizing:border-box" placeholder="Nota">${escapeHtml(item.notes || '')}</textarea><button type="button" class="pd-btn" data-save-note="${item.id}" style="margin-top:4px">Guardar nota</button>`;
        block.appendChild(row);
        block.appendChild(portalMeta);
        block.appendChild(note);
        wrap.appendChild(block);
        row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
          toggleChecklistItem(item.id, e.target.checked);
        });
        portalMeta.querySelector(`[data-portal-visible="${item.id}"]`)?.addEventListener('change', async (e) => {
          await saveChecklistPortalMeta(item.id, {
            visible_to_builder: e.target.checked,
            assigned_to: portalMeta.querySelector(`[data-portal-assigned="${item.id}"]`)?.value || 'sf',
          });
        });
        portalMeta.querySelector(`[data-portal-assigned="${item.id}"]`)?.addEventListener('change', async (e) => {
          await saveChecklistPortalMeta(item.id, {
            visible_to_builder: portalMeta.querySelector(`[data-portal-visible="${item.id}"]`)?.checked,
            assigned_to: e.target.value,
          });
        });
        row.querySelector('[data-toggle-note]')?.addEventListener('click', () => {
          note.style.display = note.style.display === 'none' ? 'block' : 'none';
        });
        note.querySelector('[data-save-note]')?.addEventListener('click', async () => {
          const txt = block.querySelector(`[data-note="${item.id}"]`)?.value;
          await fetch(`/api/projects/${projectId}/checklist/${item.id}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checked: row.querySelector('input[type=checkbox]').checked, notes: txt }),
          });
          showToast('Nota guardada');
        });
      });
      host.appendChild(wrap);
    });
  document.getElementById('btn-check-all')?.addEventListener('click', async () => {
    if (!confirm('Marcar todos os itens como concluídos?')) return;
    for (const it of items) {
      await fetch(`/api/projects/${projectId}/checklist/${it.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: true }),
      });
    }
    showToast('Checklist atualizado');
    loadProject();
  });
}

async function toggleChecklistItem(itemId, checked) {
  await fetch(`/api/projects/${projectId}/checklist/${itemId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checked }),
  });
  loadProject();
}

async function saveChecklistPortalMeta(itemId, meta) {
  const row = document.querySelector(`#chk-${itemId}`);
  await fetch(`/api/projects/${projectId}/checklist/${itemId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      checked: row ? row.checked : false,
      visible_to_builder: !!meta.visible_to_builder,
      assigned_to: meta.assigned_to === 'builder' ? 'builder' : 'sf',
    }),
  });
  showToast('Portal do builder atualizado', 'info');
}

function renderGalleryTab() {
  const el = document.getElementById('tab-gallery');
  if (!el) return;
  el.innerHTML = `
    <div class="pd-gallery-page-grid">
      ${galleryCol('before', 'Antes')}
      ${galleryCol('during', 'Durante')}
      ${galleryCol('after', 'Depois')}
    </div>
    <div class="pd-portfolio-panel" id="portfolio-panel">
      <div class="pd-section-header" style="margin-bottom:14px">
        <div class="pd-section-title-row">
          <span class="pd-section-dot"></span>
          <span class="pd-section-title">Publicar no portfólio Senior Floors</span>
        </div>
      </div>
      <div class="pd-portfolio-form">
        <div class="pd-portfolio-form-row">
          <label class="pd-label" for="portfolio-title">Título</label>
          <input type="text" class="pd-input" id="portfolio-title" placeholder="Ex.: Hardwood Installation — Naples, FL" />
        </div>
        <div class="pd-portfolio-form-row">
          <label class="pd-label" for="portfolio-desc">Descrição</label>
          <textarea class="pd-input pd-textarea" id="portfolio-desc" placeholder="Descreva o projeto para o portfólio…"></textarea>
        </div>
        <p class="pd-portfolio-info" id="portfolio-selected-count">Fotos para portfólio: 0</p>
        <div class="pd-portfolio-actions">
          <button type="button" class="pd-btn-primary" id="btn-publish-portfolio">🌐 Publicar no site</button>
          <button type="button" class="pd-action-btn" id="btn-copy-photo-urls">📋 Copiar URLs</button>
        </div>
        <p id="portfolio-live-status" style="font-size:12px;font-weight:600;color:var(--sf-ok);min-height:1.25em"></p>
        <p class="pd-portfolio-webhook-note" id="portfolio-hint">
          Sem webhook: copie as URLs e publique manualmente em <a href="https://senior-floors.com" target="_blank" rel="noopener">senior-floors.com</a>. Configure <code>PORTFOLIO_WEBHOOK_URL</code> no servidor para sync automático.
        </p>
      </div>
    </div>`;
  el.querySelectorAll('.pd-add-photo').forEach((box) => {
    box.addEventListener('click', () => {
      galleryUploadPhase = box.getAttribute('data-phase') || 'during';
      document.getElementById('pd-file-input').click();
    });
  });
  el.querySelectorAll('.pd-gallery-photos img').forEach((img) => {
    img.addEventListener('click', () => {
      const all = flattenPhotos();
      const idx = all.findIndex((x) => x.url === img.getAttribute('src'));
      openLightbox(all, idx >= 0 ? idx : 0);
    });
  });
  function refreshPortfolioCount() {
    const n = el.querySelectorAll('.photo-select:checked').length;
    const c = document.getElementById('portfolio-selected-count');
    if (c) c.textContent = `Fotos para portfólio: ${n}`;
  }
  el.querySelectorAll('.photo-select').forEach((cb) => {
    cb.addEventListener('change', refreshPortfolioCount);
  });
  refreshPortfolioCount();
  el.querySelectorAll('.pd-set-cover').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCoverPhoto(btn.getAttribute('data-photo-id'));
    });
  });
  document.getElementById('btn-publish-portfolio')?.addEventListener('click', publishPortfolio);
  document.getElementById('btn-copy-photo-urls')?.addEventListener('click', copyPhotoUrls);
}

function galleryCol(phase, label) {
  const list = photosByPhase[phase] || [];
  const thumbs = list
    .map((ph) => {
      const sel = ph.is_portfolio === 1 || ph.is_portfolio === true ? ' checked' : '';
      return `<div style="display:flex;flex-direction:column;gap:4px">
        <img src="${escapeHtml(ph.url)}" alt="" data-photo-id="${ph.id}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer" />
        <label style="font-size:10px;display:flex;align-items:center;gap:4px;color:var(--sf-muted)">
          <input type="checkbox" class="photo-select" data-photo-id="${ph.id}"${sel} /> Portfólio
        </label>
        <button type="button" class="pd-btn pd-set-cover" data-photo-id="${ph.id}" style="font-size:10px;padding:4px 6px">⭐ Capa</button>
      </div>`;
    })
    .join('');
  return `<div class="pd-gallery-col" id="gallery-${phase}">
    <div class="pd-gallery-col-header">
      <span class="pd-gallery-col-title">${label}</span>
      <span class="pd-gallery-count">${list.length} foto${list.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="pd-gallery-photos">${thumbs}</div>
    <div class="pd-add-photo" data-phase="${phase}" role="button" tabindex="0">+ Adicionar foto</div>
  </div>`;
}

function flattenPhotos() {
  return [...(photosByPhase.before || []), ...(photosByPhase.during || []), ...(photosByPhase.after || [])];
}

function openLightbox(photos, index) {
  let curr = index;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:16px';
  const cap = document.createElement('div');
  cap.style.cssText = 'color:rgba(255,255,255,.7);font-size:12px';
  const img = document.createElement('img');
  img.style.cssText = 'max-width:90vw;max-height:75vh;object-fit:contain;border-radius:8px';
  const nav = document.createElement('div');
  nav.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
  function render() {
    const p = photos[curr];
    img.src = p.url;
    cap.textContent = `${p.caption || ''} ${curr + 1}/${photos.length}`;
    nav.innerHTML = '';
    if (curr > 0) {
      const b = document.createElement('button');
      b.textContent = '← Anterior';
      b.style.cssText =
        'padding:8px 18px;background:rgba(255,255,255,.12);border:none;border-radius:8px;color:#fff;cursor:pointer';
      b.onclick = () => {
        curr--;
        render();
      };
      nav.appendChild(b);
    }
    const close = document.createElement('button');
    close.textContent = '✕ Fechar';
    close.style.cssText =
      'padding:8px 18px;background:rgba(255,255,255,.12);border:none;border-radius:8px;color:#fff;cursor:pointer';
    close.onclick = () => document.body.removeChild(overlay);
    nav.appendChild(close);
    if (curr < photos.length - 1) {
      const n = document.createElement('button');
      n.textContent = 'Próxima →';
      n.style.cssText =
        'padding:8px 18px;background:rgba(255,255,255,.12);border:none;border-radius:8px;color:#fff;cursor:pointer';
      n.onclick = () => {
        curr++;
        render();
      };
      nav.appendChild(n);
    }
    const del = document.createElement('button');
    del.textContent = 'Eliminar foto';
    del.style.cssText =
      'padding:8px 18px;background:rgba(143,32,32,.6);border:none;border-radius:8px;color:#fff;cursor:pointer';
    del.onclick = async () => {
      if (!confirm('Remover esta foto?')) return;
      await fetch(`/api/projects/${projectId}/photos/${p.id}`, { method: 'DELETE', credentials: 'include' });
      document.body.removeChild(overlay);
      loadProject();
    };
    nav.appendChild(del);
  }
  overlay.appendChild(img);
  overlay.appendChild(cap);
  overlay.appendChild(nav);
  render();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
  document.body.appendChild(overlay);
}

async function uploadPhoto(file, phase) {
  const form = new FormData();
  form.append('file', file);
  form.append('phase', phase);
  showToast(`A enviar ${file.name}…`, 'info');
  const res = await fetch(`/api/projects/${projectId}/photos`, { method: 'POST', credentials: 'include', body: form });
  if (res.ok) {
    showToast('Foto enviada ✓');
    loadProject();
  } else {
    const j = await res.json().catch(() => ({}));
    showToast(j.error || 'Erro ao enviar foto', 'error');
  }
}

async function syncPayroll() {
  const btn = document.getElementById('btn-sync-payroll');
  const tabBtn = document.getElementById('btn-sync-payroll-tab');
  const busy = btn || tabBtn;
  if (busy) {
    busy.disabled = true;
    busy.textContent = 'Sincronizando…';
  }
  try {
    const res = await fetch(`/api/projects/${projectId}/costs/sync-payroll`, {
      method: 'POST',
      credentials: 'include',
    });
    const j = await res.json();
    if (res.ok && j.success) {
      if (j.synced > 0) {
        showToast(`${j.synced} lançamento(s) importado(s) da folha de pagamento`);
        loadProject();
      } else {
        showToast('Nenhum lançamento novo na folha de pagamento', 'info');
      }
    } else {
      showToast(j.error || 'Erro ao sincronizar', 'error');
    }
  } catch (e) {
    showToast('Erro de rede', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Payroll';
    }
    if (tabBtn) {
      tabBtn.disabled = false;
      tabBtn.textContent = '🔄 Importar da folha de pagamento';
    }
  }
}

async function setCoverPhoto(photoId) {
  const id = parseInt(String(photoId), 10);
  if (!id) return;
  const res = await fetch(`/api/projects/${projectId}/photos/${id}/cover`, {
    method: 'PUT',
    credentials: 'include',
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    showToast(j.error || 'Erro ao definir capa', 'error');
    return;
  }
  showToast('Foto de capa atualizada');
}

async function publishPortfolio() {
  const selected = [...document.querySelectorAll('.photo-select:checked')].map((c) =>
    parseInt(c.getAttribute('data-photo-id'), 10)
  );
  const title = document.getElementById('portfolio-title')?.value?.trim() || `Project #${projectId}`;
  const description = document.getElementById('portfolio-desc')?.value?.trim() || '';
  if (!selected.length) {
    showToast('Selecione ao menos uma foto', 'error');
    return;
  }
  const btn = document.getElementById('btn-publish-portfolio');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'A publicar…';
  }
  try {
    const res = await fetch(`/api/projects/${projectId}/portfolio/publish`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_ids: selected, title, description }),
    });
    const j = await res.json();
    if (res.ok && j.success) {
      showToast(
        j.data?.webhook_sent ? 'Publicado (webhook enviado) ✓' : 'Fotos marcadas — configure o webhook para sync automático',
        j.data?.webhook_sent ? 'success' : 'info'
      );
      loadProject();
    } else {
      showToast(j.error || 'Erro ao publicar', 'error');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🌐 Publicar no site';
    }
  }
}

async function copyPhotoUrls() {
  const all = flattenPhotos();
  const urls = all.map((p) => `${location.origin}${p.url}`).join('\n');
  try {
    await navigator.clipboard.writeText(urls);
    showToast('URLs copiadas');
  } catch (_) {
    showToast('Não foi possível copiar', 'error');
  }
}

async function loadPortfolioStatusLine() {
  const live = document.getElementById('portfolio-live-status');
  if (!live) return;
  try {
    const r = await fetch(`/api/projects/${projectId}/portfolio/status`, { credentials: 'include' });
    const j = await r.json();
    const d = j.data || {};
    if (d.portfolio_published) {
      const when = d.portfolio_published_at ? String(d.portfolio_published_at).slice(0, 10) : '';
      live.textContent = when ? `🌐 Publicado em ${when}` : '🌐 Publicado no portfólio';
    } else {
      live.textContent = project?.portfolio_published ? '🌐 Publicado no portfólio' : '';
    }
  } catch (_) {}
}

async function renderBuilderTab() {
  const el = document.getElementById('tab-builder');
  if (!el || !project.builder_id) return;
  const res = await fetch(`/api/projects/builder/${project.builder_id}`, { credentials: 'include' });
  const j = await res.json();
  if (!j.success) {
    el.innerHTML = '<p>Não foi possível carregar dados do builder.</p>';
    return;
  }
  const b = j.data.builder;
  const agg = j.data.aggregates || {};
  const projs = j.data.projects || [];
  el.innerHTML = `
    <div class="sf-card" style="margin-bottom:12px">
      <h3 style="margin:0 0 8px;color:var(--sf-navy)">${escapeHtml(b?.name || 'Builder')}</h3>
      <p style="margin:0;font-size:13px;color:var(--sf-muted)">${escapeHtml(b?.email || '')} ${escapeHtml(b?.phone || '')}</p>
      <p style="margin:8px 0 0;font-size:13px">${escapeHtml(b?.address || '')}</p>
    </div>
    <div class="sf-card" style="margin-bottom:12px;font-size:13px;font-weight:600">
      ${agg.project_count || 0} projetos · ${fmt$(agg.total_sqft)} sqft · Receita ${fmt$(agg.total_revenue)} · Lucro ${fmt$(agg.total_profit)} · Margem média ${fmtPct(agg.avg_margin_pct)}
    </div>
    <table class="pd-table" style="background:#fff;border-radius:8px">
      <thead><tr><th>Projeto</th><th>Status</th><th>Valor</th></tr></thead>
      <tbody>
        ${projs.map((p) => `<tr style="cursor:pointer" data-go="${p.id}"><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.status)}</td><td>${fmt$(p.contract_value)}</td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('tr[data-go]').forEach((tr) => {
    tr.addEventListener('click', () => {
      window.location.href = `/project-detail.html?id=${tr.getAttribute('data-go')}`;
    });
  });
}

document.getElementById('pd-file-input')?.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) uploadPhoto(f, galleryUploadPhase);
});

document.querySelectorAll('.tab-btn').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

document.getElementById('btn-tab-gallery')?.addEventListener('click', () => switchTab('gallery'));

function goToPublishPanel() {
  switchTab('gallery');
  requestAnimationFrame(() => {
    document.getElementById('portfolio-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-sync-payroll')?.addEventListener('click', syncPayroll);
  document.getElementById('btn-pd-publish')?.addEventListener('click', goToPublishPanel);
  fetch('/api/auth/session', { credentials: 'include' }).then(async (r) => {
    const j = await r.json();
    if (!j.authenticated) {
      window.location.href = '/login.html';
      return;
    }
    const perms = j.user?.permissions || j.permissions || [];
    const isAdmin = j.user?.role === 'admin' || j.user?.role === 'superadmin';
    canEditProject = isAdmin || (Array.isArray(perms) && perms.includes('projects.edit'));
    const pct = document.getElementById('pd-pct');
    const statusSel = document.getElementById('pd-status');
    if (!canEditProject) {
      if (pct) pct.disabled = true;
      if (statusSel) statusSel.disabled = true;
    }
    loadProject();
  });
});
