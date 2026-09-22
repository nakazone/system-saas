/**
 * Construction payroll UI — /payroll-module.html
 */
const CP = '/api/construction-payroll';

let canManage = false;
/** Lançar/guardar linhas do quadro: quem entra nesta página já tem payroll.view */
let canEditTimesheet = false;
let role = '';
let permissionKeys = [];
let employees = [];
let employeesById = {};
let periods = [];
let projects = [];
let selectedPeriodId = null;
/** Última data definida no quadro — novas linhas e cópia para a linha seguinte (mesmo bloco). */
let lastTimesheetDateYmd = null;

const TIMESHEET_DATA_ROW_SEL = '#timesheetTable tr.payroll-ts-line';

function allTimesheetDataRows() {
  return document.querySelectorAll(TIMESHEET_DATA_ROW_SEL);
}

function clearTimesheetDataRows() {
  allTimesheetDataRows().forEach((tr) => tr.remove());
}

/** IDs vindos da API podem ser string/número — comparar sempre normalizado */
function periodIdNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
let currentPeriod = null;
let timesheetRows = [];
let closingPeriodMode = false;
let employeeAggRefreshTimer = null;
/** AbortController para totais em tempo real no modal de fecho (reembolso/desconto) */
let previewAdjustmentsLiveAbort = null;
/** @type {{ id: number, name: string }[]} */
let shareSlipsRowsCache = [];

/** Período em edição: API (currentPeriod) ou fallback à lista (evita esconder botões se o GET falhar). */
function selectedPeriodRecord() {
  const sid = periodIdNum(selectedPeriodId);
  if (sid == null) return null;
  if (currentPeriod != null && periodIdNum(currentPeriod.id) === sid) return currentPeriod;
  return periods.find((x) => periodIdNum(x.id) === sid) || null;
}

/** Alterar linhas já guardadas (dias/horas): aberto + payroll.view; fechado só payroll.manage */
function canEditTimesheetGrid() {
  const p = selectedPeriodRecord();
  if (!p) return false;
  if (p.status === 'closed') return canManage;
  return canEditTimesheet;
}

/** + Linha só com período aberto */
function canAddTimesheetRows() {
  const p = selectedPeriodRecord();
  if (!p || p.status === 'closed') return false;
  return canEditTimesheet;
}

function sectorLabel(s) {
  if (s === 'installation') return 'Installation';
  if (s === 'sand_finish') return 'Sand & Finish';
  return '—';
}

function paymentTypeLabel(pt) {
  const s = String(pt || 'daily').toLowerCase();
  if (s === 'hourly') return 'Por hora';
  if (s === 'mixed') return 'Misto (dia + hora)';
  return 'Por dia';
}

function money(n) {
  const x = Number(n) || 0;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(x);
}

/** Quantidades no relatório (diárias, horas) — até 2 casas, sem forçar zeros à direita desnecessários */
function fmtReportQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(x);
}

const EMPLOYEE_REPORT_HEADERS = [
  'Funcionário',
  'Setor',
  'Diárias',
  'Horas Extras',
  'Valor',
  'Reembolso',
  'Desconto',
  'Total',
];

function calcLinePreview(empId, row) {
  const emp = employeesById[empId];
  if (!emp) return 0;
  const pt = String(emp.payment_type || 'daily').toLowerCase();
  const ovr = row.daily_rate_override;
  const hasOvr = ovr !== undefined && ovr !== null && String(ovr).trim() !== '';
  const drNum = hasOvr ? Number(ovr) : Number(emp.daily_rate) || 0;
  const dr = Number.isFinite(drNum) && drNum >= 0 ? drNum : Number(emp.daily_rate) || 0;
  const hr = Number(emp.hourly_rate) || 0;
  const ort = Number(emp.overtime_rate) || 0;
  const d = Number(row.days_worked) || 0;
  const rh = Number(row.regular_hours) || 0;
  const ot = Number(row.overtime_hours) || 0;
  let base = 0;
  if (pt === 'hourly') base = (rh > 0 ? rh : d) * hr;
  else if (pt === 'mixed') base = d * dr + rh * hr;
  else base = d * dr;
  return Math.round((base + ot * ort) * 100) / 100;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${CP}${path}`, opts);
  const j = await r.json().catch(() => ({}));
  if (j.code === 'PAYROLL_SCHEMA_MISSING') {
    document.getElementById('migrateBanner')?.classList.remove('hidden');
  }
  if (!r.ok) {
    const err = new Error(j.error || r.statusText || 'Request failed');
    err.status = r.status;
    err.payload = j;
    throw err;
  }
  return j;
}

function showAuth(msg) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function setManageUi() {
  const show = canManage;
  ['btnNewEmployee', 'btnNewPeriod', 'btnNewEmployeeEmpty'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  });
  document.getElementById('quickEmpPanel')?.classList.toggle('hidden', !show);
  const readOnlyNote = document.getElementById('equipaReadOnlyNote');
  if (readOnlyNote) {
    const hasView = String(role || '').toLowerCase() === 'admin' || permissionKeys.includes('payroll.view');
    readOnlyNote.classList.toggle('hidden', canManage || !hasView);
  }
  refreshPeriodActions();
}

function refreshPeriodActions() {
  const p = selectedPeriodRecord();
  const delBtn = document.getElementById('btnDeletePeriod');
  if (!p) {
    [
      'btnPreviewClose',
      'btnReopenPeriod',
      'btnAddTimesheetRowInstallation',
      'btnAddTimesheetRowSandFinish',
      'btnSaveTimesheet',
      'btnSharePaySlips',
      'paySlipsMoreDetails',
      'btnPaySlipsPdfZip',
      'btnPaySlipsPngZip',
      'btnPaySlipsEmail',
    ].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    delBtn?.classList.add('hidden');
    return;
  }
  const showSave = canEditTimesheetGrid();
  const showAdd = canAddTimesheetRows();
  document.getElementById('btnSaveTimesheet')?.classList.toggle('hidden', !showSave);
  document.getElementById('btnAddTimesheetRowInstallation')?.classList.toggle('hidden', !showAdd);
  document.getElementById('btnAddTimesheetRowSandFinish')?.classList.toggle('hidden', !showAdd);
  const periodClosed = p.status === 'closed';
  document.getElementById('btnPreviewClose')?.classList.toggle('hidden', !(canManage && !periodClosed));
  document.getElementById('btnReopenPeriod')?.classList.toggle('hidden', !(canManage && periodClosed));
  delBtn?.classList.toggle('hidden', !canManage);
  document.getElementById('btnSharePaySlips')?.classList.remove('hidden');
  document.getElementById('paySlipsMoreDetails')?.classList.remove('hidden');
  document.getElementById('btnPaySlipsPdfZip')?.classList.remove('hidden');
  document.getElementById('btnPaySlipsPngZip')?.classList.remove('hidden');
  document.getElementById('btnPaySlipsEmail')?.classList.toggle('hidden', !canManage);
}

async function loadSession() {
  const r = await fetch('/api/auth/session', { credentials: 'include' });
  const j = await r.json();
  if (!j.authenticated) {
    window.location.href = '/login.html';
    return false;
  }
  if (j.user?.must_change_password) {
    window.location.href = '/change-password.html';
    return false;
  }
  role = j.user?.role || '';
  permissionKeys = Array.isArray(j.user?.permissions)
    ? [...new Set(j.user.permissions.map((k) => String(k).trim()).filter(Boolean))]
    : [];
  const isAdmin = String(role || '').toLowerCase() === 'admin';
  const hasView = isAdmin || permissionKeys.includes('payroll.view');
  canManage = isAdmin || permissionKeys.includes('payroll.manage');
  canEditTimesheet = hasView;
  if (!hasView) {
    showAuth('Sem permissão payroll.view para acessar esta página.');
    return false;
  }
  showAuth('');
  setManageUi();
  return true;
}

async function loadDashboard() {
  try {
    const j = await api('GET', '/dashboard/summary');
    const d = j.data || {};
    document.getElementById('dashActiveEmp').textContent = String(d.active_employees ?? '—');
    document.getElementById('dashOpenPeriods').textContent = String(d.open_periods ?? '—');
    document.getElementById('dashMtd').textContent = money(d.month_to_date_payroll_total);
    const lc = d.last_closed_period;
    document.getElementById('dashLastClosed').textContent = lc
      ? `${lc.name} (${lc.end_date}) — ${money(lc.total)}`
      : '—';
  } catch (e) {
    if (e.status === 403) showAuth('Acesso negado.');
  }
}

async function loadEmployees() {
  const j = await api('GET', '/employees?active=all');
  employees = j.data || [];
  employeesById = {};
  employees.forEach((e) => {
    employeesById[e.id] = e;
  });
  renderEmployeeTable();
  updateEmployeeEmptyState();
  refreshPeriodActions();
}

function updateEmployeeEmptyState() {
  const wrap = document.getElementById('empEmptyCta');
  if (!wrap) return;
  wrap.classList.toggle('hidden', employees.length > 0);
}

/** Totais por funcionário no quadro atual (período selecionado), incluindo linhas ainda não guardadas */
function aggregateDaysAndOtByEmployeeFromGrid() {
  const map = new Map();
  if (!selectedPeriodId) return map;
  allTimesheetDataRows().forEach((tr) => {
    const empEl = tr.querySelector('.ts-emp');
    if (!empEl) return;
    const eid = parseInt(empEl.value, 10);
    if (!eid) return;
    const d = parseNumInput(tr.querySelector('.ts-days')?.value);
    const ot = parseNumInput(tr.querySelector('.ts-ot')?.value);
    const cur = map.get(eid) || { days: 0, ot: 0 };
    cur.days += d;
    cur.ot += ot;
    map.set(eid, cur);
  });
  return map;
}

async function loadProjects() {
  const r = await fetch('/api/projects?limit=100', { credentials: 'include' });
  const j = await r.json();
  projects = j.data || [];
}

/**
 * @param {number|null|undefined} [preferId] — após criar período, forçar esta seleção (evita string/number mismatch)
 */
async function loadPeriods(preferId) {
  const j = await api('GET', '/periods');
  periods = j.data || [];
  const sel = document.getElementById('periodSelect');
  const preferred = periodIdNum(preferId);
  const prev = periodIdNum(selectedPeriodId);
  sel.innerHTML = '<option value="">Selecione o período…</option>';
  periods.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    const st = p.status === 'closed' ? 'Fechado' : 'Aberto';
    opt.textContent = `${p.name} (${p.start_date} a ${p.end_date}) [${st}]`;
    sel.appendChild(opt);
  });
  if (preferred != null && periods.some((p) => periodIdNum(p.id) === preferred)) {
    sel.value = String(preferred);
  } else if (prev != null && periods.some((p) => periodIdNum(p.id) === prev)) {
    sel.value = String(prev);
  } else {
    sel.value = '';
  }
  selectedPeriodId = sel.value ? parseInt(sel.value, 10) : null;
  syncPeriodSelectedLabel();
  await onPeriodChange();
}

function renderEmployeeTable() {
  if (employeeAggRefreshTimer != null) {
    clearTimeout(employeeAggRefreshTimer);
    employeeAggRefreshTimer = null;
  }
  const tb = document.getElementById('employeeTbody');
  tb.innerHTML = '';
  const periodAgg = aggregateDaysAndOtByEmployeeFromGrid();
  employees.forEach((e) => {
    const agg = periodAgg.get(e.id);
    const dPer = selectedPeriodId ? fmtReportQty(agg?.days ?? 0) : '—';
    const otPer = selectedPeriodId ? fmtReportQty(agg?.ot ?? 0) : '—';
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100';
    tr.innerHTML = `
      <td class="px-3 py-2 font-medium">${escapeHtml(e.name)}</td>
      <td class="px-3 py-2">${escapeHtml(sectorLabel(e.sector))}</td>
      <td class="px-3 py-2 text-right tabular-nums">${dPer}</td>
      <td class="px-3 py-2 text-right tabular-nums">${otPer}</td>
      <td class="px-3 py-2">${escapeHtml(paymentTypeLabel(e.payment_type))}</td>
      <td class="px-3 py-2 text-right">${money(e.daily_rate)}</td>
      <td class="px-3 py-2 text-right">${money(e.overtime_rate)}</td>
      <td class="px-3 py-2">${escapeHtml(e.payment_method || '—')}</td>
      <td class="px-3 py-2 text-right">
        ${canManage ? `<button type="button" class="btn btn-sm btn-secondary emp-edit" data-id="${e.id}">Editar</button>` : '—'}
      </td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('.emp-edit').forEach((btn) => {
    btn.addEventListener('click', () => openEmployeeModal(parseInt(btn.getAttribute('data-id'), 10)));
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/**
 * @param {number|string|null|undefined} selectedId
 * @param {'installation'|'sand_finish'} sectorFilter — Installation inclui funcionários sem setor no cadastro
 */
function employeeOptionsHtml(selectedId, sectorFilter) {
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : '';
  let active = employees.filter((e) => e.is_active);
  if (sectorFilter === 'installation') {
    active = active.filter(
      (e) => e.sector === 'installation' || !e.sector || String(e.sector).trim() === ''
    );
  } else if (sectorFilter === 'sand_finish') {
    active = active.filter((e) => e.sector === 'sand_finish');
  }

  const activeIds = new Set(active.map((e) => String(e.id)));
  const selectedEmp = sel ? employeesById[sel] || employees.find((e) => String(e.id) === sel) : null;
  let extra = null;
  if (sel && !activeIds.has(sel) && selectedEmp) {
    const wrong =
      (sectorFilter === 'installation' && selectedEmp.sector === 'sand_finish') ||
      (sectorFilter === 'sand_finish' && selectedEmp.sector !== 'sand_finish');
    const tag = wrong ? ' (outro setor)' : !selectedEmp.is_active ? ' (inativo no cadastro)' : '';
    extra = `<option value="${selectedEmp.id}" selected>${escapeHtml(selectedEmp.name)}${escapeHtml(tag)}</option>`;
  }

  let html =
    '<option value="">—</option>' +
    active
      .map((e) => `<option value="${e.id}"${String(e.id) === sel ? ' selected' : ''}>${escapeHtml(e.name)}</option>`)
      .join('');
  if (extra) html += extra;
  return html;
}

function getTimesheetTbody(sectorKey) {
  if (sectorKey === 'sand_finish') return document.getElementById('timesheetTbodySandFinish');
  return document.getElementById('timesheetTbodyInstallation');
}

function employeeSectorKeyFromEmpId(empId) {
  if (!Number.isFinite(empId)) return 'installation';
  const emp = employeesById[empId];
  if (!emp) return 'installation';
  if (emp.sector === 'sand_finish') return 'sand_finish';
  return 'installation';
}

function sectorKeyFromApiTimesheetRow(row) {
  const es = row?.employee_sector;
  if (es === 'sand_finish') return 'sand_finish';
  if (es === 'installation') return 'installation';
  if (row?.employee_id != null) return employeeSectorKeyFromEmpId(Number(row.employee_id));
  return 'installation';
}

function lastWorkDateInTbody(tb) {
  if (!tb) return '';
  let last = '';
  tb.querySelectorAll('tr.payroll-ts-line .ts-date').forEach((inp) => {
    const v = formatWorkDateForInput(inp.value);
    if (v) last = v;
  });
  return last;
}

function refreshEmployeeSelectForSector(tr, sectorKey) {
  const sel = tr.querySelector('.ts-emp');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = employeeOptionsHtml(cur ? parseInt(cur, 10) : null, sectorKey);
  syncDailyOverrideHint(tr);
  refreshRowAmount(tr);
}

function relocateTimesheetRowForEmployee(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp')?.value, 10);
  const key = employeeSectorKeyFromEmpId(empId);
  const target = getTimesheetTbody(key);
  if (target && tr.parentElement !== target) target.appendChild(tr);
  refreshEmployeeSelectForSector(tr, key);
  syncTimesheetRowPaymentUi(tr);
}

function syncTimesheetRowPaymentUi(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp')?.value, 10);
  const emp = employeesById[empId];
  const pt = String(emp?.payment_type || 'daily').toLowerCase();
  const hint = tr.querySelector('.ts-days-hint');
  if (hint) {
    hint.textContent =
      pt === 'hourly' ? 'Horas (por hora)' : pt === 'mixed' ? 'Dias (misto)' : 'Dias';
  }
  const wrap = tr.querySelector('.ts-mixed-reg-wrap');
  const regInp = tr.querySelector('input.ts-reg');
  if (wrap) {
    const show = pt === 'mixed';
    wrap.classList.toggle('hidden', !show);
    if (!show && regInp) regInp.value = '';
  }
  syncDailyOverrideHint(tr);
  refreshRowAmount(tr);
}

function syncNextRowDateFromChange(tr, ymd) {
  if (!ymd) return;
  let sib = tr.nextElementSibling;
  while (sib && !sib.classList.contains('payroll-ts-line')) {
    sib = sib.nextElementSibling;
  }
  if (!sib) return;
  const nd = sib.querySelector('.ts-date');
  if (nd && !nd.disabled) {
    nd.value = ymd;
    refreshRowAmount(sib);
  }
}

function projectOptionsHtml(selectedId) {
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : '';
  return (
    '<option value="">—</option>' +
    projects
      .map(
        (p) =>
          `<option value="${p.id}"${String(p.id) === sel ? ' selected' : ''}>${escapeHtml(p.project_number || '#' + p.id)}</option>`
      )
      .join('')
  );
}

/** <input type="date"> só aceita AAAA-MM-DD; ISO com hora ou timezone pode mostrar o dia errado */
function formatWorkDateForInput(v) {
  if (v == null || v === '') return '';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** DECIMAL da API (string "1.00", etc.) → texto estável para <input type="number"> */
function formatQtyForInput(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '';
  if (Number.isInteger(r)) return String(r);
  return String(r);
}

function localTodayISO() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localDateToYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultWorkDate() {
  const p = selectedPeriodRecord();
  if (!p || p.start_date == null || p.end_date == null) return localTodayISO();
  const s = String(p.start_date).slice(0, 10);
  const e = String(p.end_date).slice(0, 10);
  const t = localTodayISO();
  if (t >= s && t <= e) return t;
  return s;
}

function parseYmdToLocalDate(ymd) {
  const s = String(ymd || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Segunda-feira (YMD) da semana de calendário que contém `ymd`. */
function mondayYmdOfCalendarDate(ymd) {
  const dt = parseYmdToLocalDate(ymd);
  if (!dt) return null;
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return localDateToYMD(dt);
}

function sundayYmdFromMonday(monYmd) {
  const dt = parseYmdToLocalDate(monYmd);
  if (!dt) return null;
  dt.setDate(dt.getDate() + 6);
  return localDateToYMD(dt);
}

function formatYmdBr(ymd) {
  const s = String(ymd || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatPeriodRangeBr(p) {
  if (!p) return '';
  const a = String(p.start_date || '').slice(0, 10);
  const b = String(p.end_date || '').slice(0, 10);
  return `${formatYmdBr(a)} – ${formatYmdBr(b)}`;
}

function findPeriodByWeekRange(monYmd, sunYmd) {
  return periods.find((x) => {
    const a = String(x.start_date || '').slice(0, 10);
    const b = String(x.end_date || '').slice(0, 10);
    return a === monYmd && b === sunYmd;
  });
}

function syncPeriodSelectedLabel() {
  const sel = document.getElementById('periodSelect');
  const label = document.getElementById('periodSelectedLabel');
  if (!label || !sel) return;
  const id = sel.value;
  if (!id) {
    label.textContent = 'Nenhum período selecionado';
    return;
  }
  const p = periods.find((x) => String(x.id) === String(id));
  label.textContent = p ? `${p.name} · ${formatPeriodRangeBr(p)}` : `Período #${id}`;
}

let periodPickerViewYear = new Date().getFullYear();
let periodPickerViewMonth = new Date().getMonth();
let periodPickerMondayYmd = null;

function closePeriodPickerModal() {
  const m = document.getElementById('periodPickerModal');
  if (!m) return;
  m.classList.add('hidden');
  m.classList.remove('flex');
}

function startMondayDateForMonthGrid(viewYear, viewMonth) {
  const first = new Date(viewYear, viewMonth, 1);
  const dow = first.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return new Date(viewYear, viewMonth, 1 + offset);
}

function renderPeriodPickerUi() {
  const label = document.getElementById('periodPickerMonthLabel');
  const grid = document.getElementById('periodPickerGrid');
  const sumEl = document.getElementById('periodPickerWeekSummary');
  const stEl = document.getElementById('periodPickerStatus');
  const btnUse = document.getElementById('periodPickerUse');
  const btnCreate = document.getElementById('periodPickerCreate');
  if (!label || !grid || !sumEl || !stEl || !btnUse || !btnCreate) return;

  const d0 = new Date(periodPickerViewYear, periodPickerViewMonth, 1);
  label.textContent = d0.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  if (!periodPickerMondayYmd) {
    periodPickerMondayYmd = mondayYmdOfCalendarDate(localTodayISO());
  }

  const start = startMondayDateForMonthGrid(periodPickerViewYear, periodPickerViewMonth);
  const selMon = periodPickerMondayYmd;
  const selSun = sundayYmdFromMonday(selMon);
  grid.innerHTML = '';

  for (let i = 0; i < 42; i++) {
    const cell = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ymd = localDateToYMD(cell);
    const inMonth = cell.getMonth() === periodPickerViewMonth;
    const inWeek = selMon && selSun && ymd >= selMon && ymd <= selSun;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ['btn btn-sm', inWeek ? 'btn-primary' : 'btn-secondary', inMonth ? '' : 'opacity-35']
      .filter(Boolean)
      .join(' ');
    b.textContent = String(cell.getDate());
    b.addEventListener('click', () => {
      periodPickerMondayYmd = mondayYmdOfCalendarDate(ymd);
      renderPeriodPickerUi();
    });
    grid.appendChild(b);
  }

  const sun = selSun || '';
  sumEl.textContent = selMon ? `Semana: ${formatYmdBr(selMon)} – ${formatYmdBr(sun)}` : '';
  const existing = selMon && sun ? findPeriodByWeekRange(selMon, sun) : null;
  if (existing) {
    stEl.textContent = `Período cadastrado: "${existing.name}" (${existing.status === 'closed' ? 'fechado' : 'aberto'}).`;
    btnUse.disabled = false;
    btnCreate.classList.add('hidden');
  } else {
    stEl.textContent = 'Nenhum período cadastrado para esta semana.';
    btnUse.disabled = true;
    btnCreate.classList.toggle('hidden', !canManage);
  }
}

/** @param {{ suggestEmptyWeek?: boolean }} [opts] */
function openPeriodPickerModal(opts) {
  const o = opts || {};
  document.getElementById('periodPickerErr')?.classList.add('hidden');
  const p = selectedPeriodRecord();
  const baseYmd = p?.start_date != null ? formatWorkDateForInput(String(p.start_date)) : localTodayISO();
  const dt0 = parseYmdToLocalDate(baseYmd) || new Date();
  periodPickerViewYear = dt0.getFullYear();
  periodPickerViewMonth = dt0.getMonth();
  if (o.suggestEmptyWeek) {
    periodPickerMondayYmd = mondayYmdOfCalendarDate(localTodayISO());
  } else if (p?.start_date != null) {
    const sd = formatWorkDateForInput(String(p.start_date)).slice(0, 10);
    periodPickerMondayYmd = mondayYmdOfCalendarDate(sd) || sd;
  } else {
    periodPickerMondayYmd = mondayYmdOfCalendarDate(localTodayISO());
  }
  renderPeriodPickerUi();
  const m = document.getElementById('periodPickerModal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

/** Data AAAA-MM-DD dentro do período selecionado (validação antes do POST). */
function workDateInsideSelectedPeriod(ymd) {
  const p = selectedPeriodRecord();
  if (!p || !ymd || ymd.length < 10) return false;
  const s = String(p.start_date || '').slice(0, 10);
  const e = String(p.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return true;
  return ymd >= s && ymd <= e;
}

function bumpInput(tr, sel, delta, min = 0) {
  const input = tr.querySelector(sel);
  if (!input || input.disabled) return;
  const cur = Number(String(input.value).replace(',', '.')) || 0;
  let n = Math.max(min, Math.round((cur + delta) * 100) / 100);
  if (sel === '.ts-days') n = Math.min(2, n);
  input.value = n === 0 ? '' : String(n);
  refreshRowAmount(tr);
}

function parseNumInput(v) {
  if (v === '' || v == null) return 0;
  return Number(String(v).replace(',', '.')) || 0;
}

function refreshRowAmount(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp').value, 10);
  const row = {
    days_worked: parseNumInput(tr.querySelector('.ts-days').value),
    regular_hours: parseNumInput(tr.querySelector('.ts-reg').value),
    overtime_hours: parseNumInput(tr.querySelector('.ts-ot').value),
  };
  const drInp = tr.querySelector('.ts-daily-override');
  if (drInp) {
    const t = (drInp.value || '').trim();
    if (t !== '') row.daily_rate_override = parseNumInput(t);
  }
  const amt = calcLinePreview(empId, row);
  tr.querySelector('.ts-amt').textContent = money(amt);
  updatePeriodRunningTotalFromDom();
}

function syncDailyOverrideHint(tr) {
  const empId = parseInt(tr.querySelector('.ts-emp')?.value, 10);
  const inp = tr.querySelector('.ts-daily-override');
  if (!inp) return;
  const emp = employeesById[empId];
  if (!emp) {
    inp.placeholder = '';
    return;
  }
  const hourly = String(emp.payment_type || '').toLowerCase() === 'hourly';
  inp.placeholder = hourly ? '—' : String(emp.daily_rate ?? '');
  inp.title = hourly
    ? 'Tipo por hora: o valor usa só horas (e HE); este campo não altera o cálculo.'
    : 'Opcional: diária só neste dia. Vazio = usa a diária cadastrada do funcionário.';
}

function tsTap(ev, fn) {
  ev.preventDefault();
  ev.stopPropagation();
  fn();
}

function bindRowEvents(tr) {
  tr.querySelectorAll('.ts-emp, .ts-days, .ts-reg, .ts-ot, .ts-daily-override').forEach((el) => {
    el.addEventListener('change', () => refreshRowAmount(tr));
    el.addEventListener('input', () => refreshRowAmount(tr));
  });
  const dateInp = tr.querySelector('.ts-date');
  if (dateInp) {
    dateInp.addEventListener('change', () => {
      const ymd = formatWorkDateForInput(dateInp.value);
      if (ymd) lastTimesheetDateYmd = ymd;
      refreshRowAmount(tr);
      syncNextRowDateFromChange(tr, ymd);
    });
    dateInp.addEventListener('input', () => refreshRowAmount(tr));
  }
  tr.querySelector('.ts-emp')?.addEventListener('change', () => relocateTimesheetRowForEmployee(tr));
  tr.querySelector('.ts-days-dec')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-days', -0.25)));
  tr.querySelector('.ts-days-inc')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-days', 0.25)));
  tr.querySelector('.ts-reg-dec')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', -0.25)));
  tr.querySelector('.ts-reg-inc')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', 0.25)));
  tr.querySelector('.ts-reg-2')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', 2)));
  tr.querySelector('.ts-reg-4')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-reg', 4)));
  tr.querySelector('.ts-ot-dec')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', -0.25)));
  tr.querySelector('.ts-ot-inc')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 0.25)));
  tr.querySelector('.ts-ot-1')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 1)));
  tr.querySelector('.ts-ot-2')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 2)));
  tr.querySelector('.ts-ot-4')?.addEventListener('click', (e) => tsTap(e, () => bumpInput(tr, '.ts-ot', 4)));
  tr.querySelector('.ts-full')?.addEventListener('click', (e) =>
    tsTap(e, () => {
      const inp = tr.querySelector('.ts-days');
      if (!inp || inp.disabled) return;
      inp.value = '1';
      refreshRowAmount(tr);
    })
  );
  tr.querySelector('.ts-half')?.addEventListener('click', (e) =>
    tsTap(e, () => {
      const inp = tr.querySelector('.ts-days');
      if (!inp || inp.disabled) return;
      inp.value = '0.5';
      refreshRowAmount(tr);
    })
  );
  tr.querySelector('.ts-double-2')?.addEventListener('click', (e) =>
    tsTap(e, () => {
      const inp = tr.querySelector('.ts-days');
      if (!inp || inp.disabled) return;
      inp.value = '2';
      refreshRowAmount(tr);
    })
  );
  tr.querySelector('.ts-del')?.addEventListener('click', async () => {
    const id = tr.dataset.lineId;
    if (!id) {
      tr.remove();
      updatePeriodRunningTotalFromDom();
      return;
    }
    if (!canEditTimesheetGrid()) return;
    if (!window.confirm('Excluir esta linha da planilha de horas?')) return;
    try {
      await api('DELETE', `/timesheets/${id}`);
      window.crmToast?.success?.('Linha removida');
      await loadTimesheetsForPeriod();
    } catch (err) {
      window.crmToast?.error?.(err.message);
    }
  });
}

function appendTimesheetRow(data, sectorKey) {
  const sk = sectorKey ?? sectorKeyFromApiTimesheetRow(data || {});
  const tb = getTimesheetTbody(sk);
  if (!tb) return;
  const tr = document.createElement('tr');
  tr.className = 'border-t border-slate-100 payroll-ts-line';
  const id = data?.id;
  if (id) tr.dataset.lineId = String(id);
  const grid = canEditTimesheetGrid();
  const dis = grid ? '' : ' disabled';
  const d0 = formatQtyForInput(data?.days_worked);
  const r0 = formatQtyForInput(data?.regular_hours);
  const o0 = formatQtyForInput(data?.overtime_hours);
  const drOv =
    data?.daily_rate_override != null && data?.daily_rate_override !== ''
      ? formatQtyForInput(data.daily_rate_override) || String(data.daily_rate_override)
      : '';
  const wDateRaw =
    data?.work_date != null && data.work_date !== ''
      ? data.work_date
      : lastWorkDateInTbody(tb) || lastTimesheetDateYmd || defaultWorkDate();
  const wDate = formatWorkDateForInput(wDateRaw);
  if (wDate) lastTimesheetDateYmd = wDate;
  tr.innerHTML = `
    <td class="px-2 py-1 align-top"><input type="date" class="ts-date w-full border rounded px-2 py-2 text-sm"${dis} value="${wDate}" /></td>
    <td class="px-2 py-1 align-top"><select class="ts-emp w-full border rounded px-2 py-2 text-sm"${dis}>${employeeOptionsHtml(data?.employee_id, sk)}</select></td>
    <td class="px-2 py-1 align-top"><select class="ts-proj w-full border rounded px-2 py-2 text-sm"${dis}>${projectOptionsHtml(data?.project_id)}</select></td>
    <td class="px-1 py-1 align-top"><input type="number" inputmode="decimal" step="any" min="0" class="ts-daily-override payroll-num-input w-[4.5rem] border rounded px-1 py-2 text-sm"${dis} value="${drOv}" /></td>
    <td class="px-1 py-1 align-top">
      <p class="ts-days-hint text-[10px] text-slate-500 text-center mb-0.5 leading-tight">Dias</p>
      <div class="flex items-center justify-center gap-0.5">
        <button type="button" class="ts-numbtn ts-days-dec"${dis} aria-label="Menos dia">−</button>
        <input type="number" inputmode="decimal" step="any" min="0" class="ts-days payroll-num-input w-[4.25rem] border rounded"${dis} value="${d0 === '' || d0 == null ? '' : d0}" />
        <button type="button" class="ts-numbtn ts-days-inc"${dis} aria-label="Mais dia">+</button>
      </div>
      <div class="flex justify-center gap-1 mt-1 flex-wrap">
        <button type="button" class="ts-short ts-full text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>1d</button>
        <button type="button" class="ts-short ts-double-2 text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''} title="2 diárias no mesmo dia (double)">2d</button>
        <button type="button" class="ts-short ts-half text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>½</button>
      </div>
      <div class="ts-mixed-reg-wrap hidden mt-1.5 pt-1 border-t border-slate-200">
        <p class="text-[10px] text-slate-500 text-center mb-0.5">Horas normais (misto)</p>
        <div class="flex items-center justify-center gap-0.5">
          <button type="button" class="ts-numbtn ts-reg-dec"${dis} aria-label="Menos horas normais">−</button>
          <input type="number" inputmode="decimal" step="any" min="0" class="ts-reg payroll-num-input w-[4.25rem] border rounded"${dis} value="${r0 === '' || r0 == null ? '' : r0}" />
          <button type="button" class="ts-numbtn ts-reg-inc"${dis} aria-label="Mais horas normais">+</button>
        </div>
        <div class="flex justify-center gap-1 mt-1 flex-wrap">
          <button type="button" class="ts-short ts-reg-2 text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+2h</button>
          <button type="button" class="ts-short ts-reg-4 text-[10px] px-2 py-1 border border-slate-200 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+4h</button>
        </div>
      </div>
    </td>
    <td class="px-1 py-1 align-top">
      <div class="flex items-center justify-center gap-0.5">
        <button type="button" class="ts-numbtn ts-ot-dec"${dis} aria-label="Menos HE">−</button>
        <input type="number" inputmode="decimal" step="any" min="0" class="ts-ot payroll-num-input w-[4.25rem] border rounded"${dis} value="${o0 === '' || o0 == null ? '' : o0}" />
        <button type="button" class="ts-numbtn ts-ot-inc"${dis} aria-label="Mais HE">+</button>
      </div>
      <div class="flex justify-center gap-1 mt-1 flex-wrap">
        <button type="button" class="ts-short ts-ot-1 text-[10px] px-2 py-1 border border-amber-200 bg-amber-50 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+1h</button>
        <button type="button" class="ts-short ts-ot-2 text-[10px] px-2 py-1 border border-amber-200 bg-amber-50 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+2h</button>
        <button type="button" class="ts-short ts-ot-4 text-[10px] px-2 py-1 border border-amber-200 bg-amber-50 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''}>+4h</button>
      </div>
    </td>
    <td class="px-2 py-1 align-top"><input type="text" class="ts-notes w-full border rounded px-2 py-2 text-sm"${dis} value="" /></td>
    <td class="px-2 py-1 text-right ts-amt text-sm font-semibold align-middle">${money(data?.calculated_amount ?? 0)}</td>
    <td class="px-2 py-1 align-middle">
      <button type="button" class="ts-del px-2 py-1 text-sm border border-red-200 text-red-700 rounded${!grid ? ' opacity-40' : ''}" ${!grid ? 'disabled' : ''} title="Excluir linha">×</button>
    </td>`;
  tb.appendChild(tr);
  if (data?.notes) tr.querySelector('.ts-notes').value = data.notes;
  bindRowEvents(tr);
  syncTimesheetRowPaymentUi(tr);
}

function updatePeriodRunningTotalFromDom() {
  let sum = 0;
  allTimesheetDataRows().forEach((tr) => {
    const empId = parseInt(tr.querySelector('.ts-emp').value, 10);
    const row = {
      days_worked: parseNumInput(tr.querySelector('.ts-days').value),
      regular_hours: parseNumInput(tr.querySelector('.ts-reg').value),
      overtime_hours: parseNumInput(tr.querySelector('.ts-ot').value),
    };
    const drT = tr.querySelector('.ts-daily-override');
    if (drT) {
      const t = (drT.value || '').trim();
      if (t !== '') row.daily_rate_override = parseNumInput(t);
    }
    sum += calcLinePreview(empId, row);
  });
  document.getElementById('periodRunningTotal').textContent = money(sum);
  if (employeeAggRefreshTimer != null) clearTimeout(employeeAggRefreshTimer);
  employeeAggRefreshTimer = setTimeout(() => {
    employeeAggRefreshTimer = null;
    renderEmployeeTable();
  }, 120);
}

function applyPeriodMetaBanner(p) {
  const freqPt =
    p?.frequency === 'weekly'
      ? 'Semanal'
      : p?.frequency === 'biweekly'
        ? 'Quinzenal'
        : p?.frequency === 'monthly'
          ? 'Mensal'
          : p?.frequency || '';
  document.getElementById('periodMeta').textContent = p
    ? `${freqPt} · ${formatPeriodRangeBr(p)} · ${p.status === 'closed' ? 'Fechado' : 'Aberto'}`
    : '';
  const badge = document.getElementById('periodLockBadge');
  if (p?.status === 'closed') badge.classList.remove('hidden');
  else badge.classList.add('hidden');
}

async function loadTimesheetsForPeriod() {
  clearTimesheetDataRows();
  if (!selectedPeriodId) {
    currentPeriod = null;
    document.getElementById('periodMeta').textContent = '';
    document.getElementById('periodLockBadge').classList.add('hidden');
    document.getElementById('periodRunningTotal').textContent = money(0);
    renderEmployeeTable();
    refreshPeriodActions();
    return;
  }
  try {
    const j = await api('GET', `/periods/${selectedPeriodId}/timesheets`);
    currentPeriod = j.period;
    timesheetRows = j.data || [];
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao carregar a planilha.');
    timesheetRows = [];
    const fromList = periods.find((x) => periodIdNum(x.id) === periodIdNum(selectedPeriodId));
    currentPeriod = fromList || { id: selectedPeriodId, status: 'open', start_date: null, end_date: null };
  }

  const p = selectedPeriodRecord();
  applyPeriodMetaBanner(p);

  timesheetRows.forEach((row) => appendTimesheetRow(row, sectorKeyFromApiTimesheetRow(row)));
  updatePeriodRunningTotalFromDom();
  renderEmployeeTable();
  refreshPeriodActions();
}

async function onPeriodChange() {
  const sel = document.getElementById('periodSelect');
  selectedPeriodId = sel.value ? parseInt(sel.value, 10) : null;
  syncPeriodSelectedLabel();
  await loadTimesheetsForPeriod();
}

function collectLinesFromGrid() {
  const lines = [];
  allTimesheetDataRows().forEach((tr) => {
    const dateEl = tr.querySelector('.ts-date');
    const empEl = tr.querySelector('.ts-emp');
    const projEl = tr.querySelector('.ts-proj');
    const daysEl = tr.querySelector('.ts-days');
    const regEl = tr.querySelector('.ts-reg');
    const otEl = tr.querySelector('.ts-ot');
    const notesEl = tr.querySelector('.ts-notes');
    if (!dateEl || !empEl || !daysEl || !regEl || !otEl) return;

    const work_date = formatWorkDateForInput(dateEl.value);
    const employee_id = empEl.value;
    const projectSel = projEl ? projEl.value : '';
    const days_worked = daysEl.value;
    const regular_hours = regEl.value;
    const overtime_hours = otEl.value;
    const notes = (notesEl?.value || '').trim();
    const drRaw = (tr.querySelector('.ts-daily-override')?.value || '').trim();

    const lidRaw = tr.dataset.lineId;
    const lidNum = lidRaw != null && String(lidRaw).trim() !== '' ? parseInt(String(lidRaw), 10) : NaN;
    const hasPersistedId = Number.isFinite(lidNum) && lidNum > 0;

    if (!employee_id || !work_date) return;
    const d = parseNumInput(days_worked);
    const r = parseNumInput(regular_hours);
    const ot = parseNumInput(overtime_hours);
    /* Não gravar linha nova totalmente vazia (evita lixo na BD) */
    if (!hasPersistedId && d === 0 && r === 0 && ot === 0 && !notes) return;
    const o = {
      employee_id: parseInt(employee_id, 10),
      project_id: projectSel ? parseInt(projectSel, 10) : null,
      work_date,
      days_worked: d,
      regular_hours: r,
      overtime_hours: ot,
      notes: notes || null,
      daily_rate_override: drRaw !== '' ? parseNumInput(drRaw) : null,
    };
    if (hasPersistedId) o.id = lidNum;
    lines.push(o);
  });
  return lines;
}

/** Linhas com algum valor mas sem data ou funcionário — avisar antes de guardar */
function timesheetGridValidationIssues() {
  const issues = [];
  let idx = 0;
  const dailySumByEmpDate = new Map();
  allTimesheetDataRows().forEach((tr) => {
    idx += 1;
    const work_date = formatWorkDateForInput(tr.querySelector('.ts-date')?.value);
    const employee_id = tr.querySelector('.ts-emp')?.value;
    const d = parseNumInput(tr.querySelector('.ts-days')?.value);
    const r = parseNumInput(tr.querySelector('.ts-reg')?.value);
    const ot = parseNumInput(tr.querySelector('.ts-ot')?.value);
    const notes = (tr.querySelector('.ts-notes')?.value || '').trim();
    const lidRaw = tr.dataset.lineId;
    const lidNum = lidRaw != null && String(lidRaw).trim() !== '' ? parseInt(String(lidRaw), 10) : NaN;
    const hasPersistedId = Number.isFinite(lidNum) && lidNum > 0;

    const touched =
      !!employee_id ||
      !!work_date ||
      d > 0 ||
      r > 0 ||
      ot > 0 ||
      !!notes ||
      !!(tr.querySelector('.ts-daily-override')?.value || '').trim();
    if (!touched) return;

    if (!employee_id) issues.push(`Linha ${idx}: escolha o funcionário.`);
    if (!work_date) issues.push(`Linha ${idx}: escolha a data do trabalho.`);
    if (work_date && !workDateInsideSelectedPeriod(work_date)) {
      const eid = employee_id ? parseInt(employee_id, 10) : NaN;
      const flex = Number.isFinite(eid) && Number(employeesById[eid]?.allow_work_date_outside_period) === 1;
      if (!flex) {
        issues.push(
          `Linha ${idx}: a data ${work_date} está fora do período (${String(selectedPeriodRecord()?.start_date || '').slice(0, 10)} a ${String(selectedPeriodRecord()?.end_date || '').slice(0, 10)}). Marque «Datas fora da semana» no cadastro do funcionário se o pagamento for neste fechamento com trabalho em outra semana.`
        );
      }
    }
    if (!hasPersistedId && d === 0 && r === 0 && ot === 0 && !notes) {
      issues.push(
        `Linha ${idx}: para uma linha nova, preencha diárias ou horas (coluna Dias/horas), horas extras ou uma nota.`
      );
    }
    if (employee_id && work_date && Number.isFinite(parseInt(employee_id, 10))) {
      const eid = parseInt(employee_id, 10);
      const emp = employeesById[eid];
      const pt = String(emp?.payment_type || 'daily').toLowerCase();
      if (pt !== 'hourly') {
        const sumKey = `${eid}|${work_date}`;
        dailySumByEmpDate.set(sumKey, (dailySumByEmpDate.get(sumKey) || 0) + d);
      }
    }
  });
  dailySumByEmpDate.forEach((sum, key) => {
    if (Math.round(sum * 100) > 200) {
      const [eid, ymd] = key.split('|');
      const emp = employeesById[parseInt(eid, 10)];
      const nm = emp?.name || `ID ${eid}`;
      issues.push(
        `${nm}: soma de diárias em ${ymd} acima de 2 (máximo 2 por dia — double: duas linhas de 1 ou uma linha com 2).`
      );
    }
  });
  return issues;
}

function openEmployeeModal(editId) {
  const m = document.getElementById('empModal');
  document.getElementById('empFormErr').classList.add('hidden');
  document.getElementById('empEditId').value = editId || '';
  document.getElementById('empModalTitle').textContent = editId ? 'Editar funcionário' : 'Novo funcionário';
  document.getElementById('empDelete')?.classList.toggle('hidden', !(editId && canManage));
  document.getElementById('empActiveWrap').classList.toggle('hidden', !editId);
  if (editId) {
    const e = employeesById[editId];
    if (!e) return;
    document.getElementById('empName').value = e.name || '';
    document.getElementById('empRole').value = e.role || '';
    document.getElementById('empPhone').value = e.phone || '';
    document.getElementById('empEmail').value = e.email || '';
    document.getElementById('empPayType').value = e.payment_type || 'daily';
    document.getElementById('empDaily').value = e.daily_rate ?? '';
    document.getElementById('empHourly').value = e.hourly_rate ?? '';
    document.getElementById('empOt').value = e.overtime_rate ?? '';
    document.getElementById('empPayMethod').value = e.payment_method || '';
    const secEl = document.getElementById('empSector');
    if (secEl) secEl.value = e.sector || '';
    const outW = document.getElementById('empAllowOutsideWeek');
    if (outW) outW.checked = Number(e.allow_work_date_outside_period) === 1;
    document.getElementById('empActive').checked = !!e.is_active;
  } else {
    ['empName', 'empRole', 'empPhone', 'empEmail', 'empPayMethod'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('empPayType').value = 'daily';
    document.getElementById('empDaily').value = '0';
    document.getElementById('empHourly').value = '0';
    document.getElementById('empOt').value = '0';
    const outWN = document.getElementById('empAllowOutsideWeek');
    if (outWN) outWN.checked = false;
    const secElNew = document.getElementById('empSector');
    if (secElNew) secElNew.value = '';
  }
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closeEmployeeModal() {
  const m = document.getElementById('empModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

async function saveEmployee() {
  const err = document.getElementById('empFormErr');
  err.classList.add('hidden');
  const editId = document.getElementById('empEditId').value;
  const body = {
    name: document.getElementById('empName').value.trim(),
    role: document.getElementById('empRole').value.trim() || null,
    phone: document.getElementById('empPhone').value.trim() || null,
    email: document.getElementById('empEmail').value.trim() || null,
    payment_type: document.getElementById('empPayType').value,
    daily_rate: Number(document.getElementById('empDaily').value) || 0,
    hourly_rate: Number(document.getElementById('empHourly').value) || 0,
    overtime_rate: Number(document.getElementById('empOt').value) || 0,
    payment_method: document.getElementById('empPayMethod').value.trim() || null,
    sector: document.getElementById('empSector')?.value || null,
    allow_work_date_outside_period: !!document.getElementById('empAllowOutsideWeek')?.checked,
  };
  if (editId) {
    body.is_active = document.getElementById('empActive').checked;
  }
  if (!body.name) {
    err.textContent = 'O nome é obrigatório.';
    err.classList.remove('hidden');
    return;
  }
  try {
    if (editId) {
      await api('PUT', `/employees/${editId}`, body);
      window.crmToast?.success?.('Funcionário atualizado');
    } else {
      await api('POST', '/employees', body);
      window.crmToast?.success?.('Funcionário criado');
    }
    closeEmployeeModal();
    await loadEmployees();
    await loadTimesheetsForPeriod();
  } catch (e) {
    let msg = e.message || 'Erro ao salvar.';
    if (e.status === 403) {
      msg =
        'Sem permissão para criar ou editar funcionários (payroll.manage). Atualize a página; se continuar, peça ao administrador para conceder payroll.manage na matriz de permissões.';
    }
    if (e.status === 503 && e.payload?.code === 'PAYROLL_SCHEMA_MISSING') {
      msg =
        'Tabelas de folha não instaladas no servidor. Execute as migrações MySQL (construction-payroll + payroll-sector-reimbursement).';
    }
    err.textContent = msg;
    err.classList.remove('hidden');
    window.crmToast?.error?.(msg);
  }
}

async function periodPickerSubmitCreate() {
  const errEl = document.getElementById('periodPickerErr');
  errEl?.classList.add('hidden');
  if (!periodPickerMondayYmd || !canManage) return;
  try {
    const j = await api('POST', '/periods', { week_monday: periodPickerMondayYmd });
    const newId = periodIdNum(j.data?.id);
    window.crmToast?.success?.('Período criado');
    closePeriodPickerModal();
    await loadPeriods(newId);
  } catch (e) {
    if (e.status === 409 && e.payload?.code === 'PERIOD_RANGE_EXISTS' && e.payload?.data?.id != null) {
      const exId = periodIdNum(e.payload.data.id);
      window.crmToast?.success?.('Este período já existia — selecionado.');
      closePeriodPickerModal();
      await loadPeriods(exId);
      return;
    }
    if (errEl) {
      errEl.textContent = e.message || 'Erro ao criar período.';
      errEl.classList.remove('hidden');
    }
    window.crmToast?.error?.(e.message || 'Erro ao criar período.');
  }
}

async function periodPickerApplySelection() {
  const sun = sundayYmdFromMonday(periodPickerMondayYmd);
  const existing = periodPickerMondayYmd && sun ? findPeriodByWeekRange(periodPickerMondayYmd, sun) : null;
  if (!existing) return;
  const sel = document.getElementById('periodSelect');
  sel.value = String(existing.id);
  closePeriodPickerModal();
  await onPeriodChange();
}

/** Coluna «Diárias» no preview do período (quantidade, não valor). */
function formatPreviewDiariasQty(row) {
  const pt = String(row.payment_type || 'daily').toLowerCase();
  const d = Number(row.days_worked_sum) || 0;
  const r = Number(row.regular_hours_sum) || 0;
  if (pt === 'hourly') {
    const h = r > 0 ? r : d;
    return `${fmtReportQty(h)} h`;
  }
  if (pt === 'mixed') {
    const parts = [];
    if (d > 0) parts.push(`${fmtReportQty(d)} d`);
    if (r > 0) parts.push(`${fmtReportQty(r)} h`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return fmtReportQty(d);
}

function formatPreviewDoubleDates(row) {
  const pt = String(row.payment_type || 'daily').toLowerCase();
  if (pt === 'hourly') return '—';
  const arr = Array.isArray(row.double_diaria_dates) ? row.double_diaria_dates : [];
  if (!arr.length) return '—';
  return arr.map((ymd) => formatYmdBr(ymd)).join(', ');
}

function bindPreviewAdjustmentsLiveTotals(fixedGrandSheet) {
  previewAdjustmentsLiveAbort?.abort();
  previewAdjustmentsLiveAbort = new AbortController();
  const { signal } = previewAdjustmentsLiveAbort;

  const recalc = () => {
    const gSheet = Number(fixedGrandSheet) || 0;
    let sumReim = 0;
    let sumDisc = 0;
    document.querySelectorAll('#previewTbody tr').forEach((tr) => {
      const sub = Number(tr.dataset.subtotal) || 0;
      const reimInp = tr.querySelector('.preview-reim-input');
      const discInp = tr.querySelector('.preview-disc-input');
      const reim = reimInp ? Math.max(0, Number(reimInp.value) || 0) : 0;
      const disc = discInp ? Math.max(0, Number(discInp.value) || 0) : 0;
      const empTot = Math.round((sub + reim - disc) * 100) / 100;
      tr.dataset.previewReim = String(reim);
      tr.dataset.previewDisc = String(disc);
      tr.dataset.previewTotal = String(empTot);
      sumReim += reim;
      sumDisc += disc;
      const totCell = tr.querySelector('.preview-emp-total');
      if (totCell) {
        totCell.textContent = money(empTot);
      }
    });
    const gEl = document.getElementById('previewGrandSheet');
    const rEl = document.getElementById('previewGrandReim');
    const dEl = document.getElementById('previewGrandDisc');
    const tEl = document.getElementById('previewGrandTotal');
    if (gEl) gEl.textContent = money(gSheet);
    if (rEl) rEl.textContent = money(Math.round(sumReim * 100) / 100);
    if (dEl) dEl.textContent = money(Math.round(sumDisc * 100) / 100);
    if (tEl) tEl.textContent = money(Math.round((gSheet + sumReim - sumDisc) * 100) / 100);
  };

  const tbody = document.getElementById('previewTbody');
  tbody?.addEventListener(
    'input',
    (ev) => {
      const t = ev.target;
      if (t?.classList?.contains('preview-reim-input') || t?.classList?.contains('preview-disc-input')) {
        recalc();
      }
    },
    { signal }
  );
  recalc();
}

function fillPreviewModal(data, opts) {
  closingPeriodMode = !!(opts && opts.closing);
  previewAdjustmentsLiveAbort?.abort();
  previewAdjustmentsLiveAbort = null;

  const tbody = document.getElementById('previewTbody');
  tbody.innerHTML = '';
  const periodClosed = data.period?.status === 'closed';
  const editReim = closingPeriodMode && canManage && !periodClosed;

  document.getElementById('previewReimHint')?.classList.toggle('hidden', !editReim);

  (data.by_employee || []).forEach((row) => {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100';
    tr.dataset.employeeId = String(row.employee_id);
    tr.dataset.subtotal = String(Number(row.subtotal) || 0);
    tr.dataset.daysWorkedSum = String(Number(row.days_worked_sum) || 0);
    tr.dataset.regularHoursSum = String(Number(row.regular_hours_sum) || 0);
    tr.dataset.overtimeHoursSum = String(Number(row.overtime_hours_sum) || 0);
    tr.dataset.amountSheetBase = String(Number(row.amount_sheet_base) || 0);
    tr.dataset.amountOvertime = String(Number(row.amount_overtime) || 0);
    tr.dataset.paymentType = String(row.payment_type || 'daily');
    tr.dataset.employeeName = String(row.name ?? '');
    tr.dataset.sectorLabel = sectorLabel(row.sector);
    const reimVal = Number(row.reimbursement) || 0;
    const discVal = Number(row.discount) || 0;
    const empTotInit =
      row.employee_total != null
        ? Number(row.employee_total)
        : Number(row.subtotal) + reimVal - discVal;
    tr.dataset.previewReim = String(reimVal);
    tr.dataset.previewDisc = String(discVal);
    tr.dataset.previewTotal = String(Math.round(empTotInit * 100) / 100);
    const reimCell = editReim
      ? `<td class="px-2 py-2"><input type="number" step="0.01" min="0" class="preview-reim-input w-full border rounded-lg px-2 py-2 text-sm" value="${reimVal}" /></td>`
      : `<td class="px-3 py-2 text-right">${money(reimVal)}</td>`;
    const discCell = editReim
      ? `<td class="px-2 py-2"><input type="number" step="0.01" min="0" class="preview-disc-input w-full border rounded-lg px-2 py-2 text-sm" value="${discVal}" /></td>`
      : `<td class="px-3 py-2 text-right">${money(discVal)}</td>`;
    const empTot = empTotInit;
    const otH = Number(row.overtime_hours_sum) || 0;
    tr.innerHTML = `<td class="px-3 py-2 font-medium">${escapeHtml(row.name)}<br><span class="text-xs text-slate-500 font-normal">${escapeHtml(sectorLabel(row.sector))}</span></td>
      <td class="px-3 py-2 text-xs text-amber-900 tabular-nums">${escapeHtml(formatPreviewDoubleDates(row))}</td>
      <td class="px-3 py-2 text-right tabular-nums">${escapeHtml(formatPreviewDiariasQty(row))}</td>
      <td class="px-3 py-2 text-right tabular-nums">${escapeHtml(fmtReportQty(otH))} h</td>
      <td class="px-3 py-2 text-right">${money(row.subtotal)}</td>
      ${reimCell}
      ${discCell}
      <td class="px-3 py-2 text-right font-semibold preview-emp-total">${money(empTot)}</td>`;
    tbody.appendChild(tr);
  });

  const sumSheet = (data.by_employee || []).reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
  const sumReim = (data.by_employee || []).reduce((s, r) => s + (Number(r.reimbursement) || 0), 0);
  const sumDisc = (data.by_employee || []).reduce((s, r) => s + (Number(r.discount) || 0), 0);
  const gSheet = data.grand_timesheet != null ? Number(data.grand_timesheet) : sumSheet;
  const gReim = data.grand_reimbursement != null ? Number(data.grand_reimbursement) : sumReim;
  const gDisc = data.grand_discount != null ? Number(data.grand_discount) : sumDisc;
  const gTot =
    data.grand_total != null ? Number(data.grand_total) : Math.round((gSheet + gReim - gDisc) * 100) / 100;

  document.getElementById('previewGrandSheet').textContent = money(gSheet);
  document.getElementById('previewGrandReim').textContent = money(gReim);
  document.getElementById('previewGrandDisc').textContent = money(gDisc);
  document.getElementById('previewGrandTotal').textContent = money(gTot);

  document.getElementById('previewTitle').textContent = closingPeriodMode
    ? 'Fechamento — reembolsos e descontos'
    : 'Prévia da folha';
  document.getElementById('previewSubtitle').textContent = data.period
    ? `${data.period.name} (${data.period.start_date} a ${data.period.end_date})`
    : '';
  document.getElementById('previewCloseActions').classList.toggle('hidden', !closingPeriodMode);
  document.getElementById('previewCloseOnly').classList.toggle('hidden', closingPeriodMode);

  if (editReim) {
    bindPreviewAdjustmentsLiveTotals(gSheet);
  }
}

function collectAdjustmentsFromPreview() {
  const rows = [];
  document.querySelectorAll('#previewTbody tr').forEach((tr) => {
    const id = parseInt(tr.dataset.employeeId, 10);
    if (!id) return;
    const reimInp = tr.querySelector('.preview-reim-input');
    const discInp = tr.querySelector('.preview-disc-input');
    const reimbursement = reimInp ? Number(reimInp.value) || 0 : 0;
    const discount = discInp ? Number(discInp.value) || 0 : 0;
    rows.push({ employee_id: id, reimbursement, discount });
  });
  return rows;
}

async function saveAdjustmentsFromPreview() {
  if (!selectedPeriodId || !canManage) return;
  const adjustments = collectAdjustmentsFromPreview();
  await api('PUT', `/periods/${selectedPeriodId}/adjustments`, { adjustments });
}

function openPreviewModal() {
  const m = document.getElementById('previewModal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closePreviewModal() {
  previewAdjustmentsLiveAbort?.abort();
  previewAdjustmentsLiveAbort = null;
  const m = document.getElementById('previewModal');
  m.classList.add('hidden');
  m.classList.remove('flex');
  closingPeriodMode = false;
}

/** Parte normal (sem HE) a partir de um objeto-linha (API ou derivado do DOM). */
function previewNormativoBlockFromRow(row) {
  const pt = String(row.payment_type || 'daily').toLowerCase();
  const days = Number(row.days_worked_sum) || 0;
  const regH = Number(row.regular_hours_sum) || 0;
  const baseAmt = Number(row.amount_sheet_base) || 0;
  if (pt === 'hourly') {
    const h = regH > 0 ? regH : days;
    return {
      qtyLabel: 'Horas à taxa normal (soma)',
      qty: fmtReportQty(h),
      totalLabel: 'Valor (parte normal)',
      total: baseAmt,
    };
  }
  if (pt === 'mixed') {
    const parts = [];
    if (days > 0) parts.push(`${fmtReportQty(days)} dia(s)`);
    if (regH > 0) parts.push(`${fmtReportQty(regH)} h`);
    return {
      qtyLabel: 'Dias / horas normais',
      qty: parts.length ? parts.join(' · ') : '—',
      totalLabel: 'Valor (parte normal)',
      total: baseAmt,
    };
  }
  return {
    qtyLabel: 'Diárias (soma)',
    qty: fmtReportQty(days),
    totalLabel: 'Valor (parte normal)',
    total: baseAmt,
  };
}

function previewNormativoBlock(tr) {
  return previewNormativoBlockFromRow({
    payment_type: tr.dataset.paymentType,
    days_worked_sum: Number(tr.dataset.daysWorkedSum),
    regular_hours_sum: Number(tr.dataset.regularHoursSum),
    amount_sheet_base: Number(tr.dataset.amountSheetBase),
  });
}

/**
 * PDF multi-página (layout = recibo). `adjustments`: null = GET (BD); array = POST (valores do modal preview).
 */
async function openIndividualReportsPdfFromApi(adjustments) {
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Selecione um período.');
    return;
  }
  const preOpened = window.open('about:blank', '_blank');
  if (preOpened) {
    try {
      preOpened.document.write(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Carregando…</title></head><body><p style="font-family:system-ui,sans-serif;padding:2rem">Gerando PDF…</p></body></html>'
      );
      preOpened.document.close();
    } catch (_) {}
  }
  try {
    const url = `${CP}/periods/${selectedPeriodId}/individual-reports.pdf`;
    const usePost = adjustments != null;
    const r = await fetch(url, {
      method: usePost ? 'POST' : 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/pdf',
        ...(usePost ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(usePost ? { body: JSON.stringify({ adjustments }) } : {}),
    });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok) {
      if (preOpened && !preOpened.closed) {
        try {
          preOpened.close();
        } catch (_) {}
      }
      if (ct.includes('application/json')) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Erro (${r.status})`);
      }
      throw new Error(`PDF (${r.status})`);
    }
    if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'Resposta inválida');
    }
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    if (preOpened && !preOpened.closed) {
      preOpened.location.href = objUrl;
    } else {
      const w = window.open(objUrl, '_blank');
      if (!w) {
        URL.revokeObjectURL(objUrl);
        window.crmToast?.error?.('Pop-up bloqueado.');
        return;
      }
    }
    setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
    window.crmToast?.success?.('PDF aberto (mesmo layout do recibo).');
  } catch (e) {
    if (preOpened && !preOpened.closed) {
      try {
        preOpened.close();
      } catch (_) {}
    }
    window.crmToast?.error?.(e.message || 'Erro ao gerar PDF');
  }
}

async function fetchAndShowPreview(closing) {
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Selecione um período.');
    return;
  }
  try {
    const j = await api('GET', `/periods/${selectedPeriodId}/preview`);
    fillPreviewModal(j.data || {}, { closing });
    openPreviewModal();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function safeSlipFilePart(s) {
  return String(s || 'funcionario').replace(/[^\w.\-]+/g, '_').slice(0, 42);
}

async function fetchPaySlipPdfBlob(periodId, employeeId) {
  const r = await fetch(`${CP}/periods/${periodId}/slips/${employeeId}/pdf`, { credentials: 'include' });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `PDF (${r.status})`);
  }
  return r.blob();
}

async function pdfBlobToPngBlob(pdfBlob, scale = 2) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('pdf.js não carregou (rede ou bloqueador de anúncios).');
  }
  const buf = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar PNG'))), 'image/png');
  });
}

async function buildPaySlipsBlobZip(format) {
  if (!selectedPeriodId) throw new Error('Selecione um período.');
  const j = await api('GET', `/periods/${selectedPeriodId}/preview`);
  const by = j.data?.by_employee;
  if (!Array.isArray(by) || !by.length) {
    throw new Error('Não há dados neste período.');
  }
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip não carregou.');
  }
  const zip = new JSZip();
  const pid = selectedPeriodId;
  for (const row of by) {
    const pdfBlob = await fetchPaySlipPdfBlob(pid, row.employee_id);
    if (format === 'pdf') {
      zip.file(`Recibo-${safeSlipFilePart(row.name)}-${row.employee_id}.pdf`, pdfBlob);
    } else {
      const png = await pdfBlobToPngBlob(pdfBlob);
      zip.file(`Recibo-${safeSlipFilePart(row.name)}-${row.employee_id}.png`, png);
    }
  }
  return zip.generateAsync({ type: 'blob' });
}

async function downloadPaySlipsZip(format) {
  try {
    window.crmToast?.info?.(
      format === 'png'
        ? 'Gerando PNG a partir dos PDFs (pode levar um pouco)…'
        : 'Baixando PDFs…'
    );
    const blob = await buildPaySlipsBlobZip(format);
    const ext = format === 'pdf' ? 'pdf' : 'png';
    downloadBlob(blob, `Senior-Floors-recibos-${ext}-${selectedPeriodId}.zip`);
    window.crmToast?.success?.('Pacote pronto.');
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro');
  }
}

function openShareSlipsModalShell() {
  const m = document.getElementById('shareSlipsModal');
  m.classList.remove('hidden');
  m.classList.add('block');
}

function closeShareSlipsModal() {
  const m = document.getElementById('shareSlipsModal');
  m.classList.add('hidden');
  m.classList.remove('block');
  shareSlipsRowsCache = [];
  const list = document.getElementById('shareSlipsList');
  if (list) list.innerHTML = '';
}

async function openShareSlipsModal() {
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Selecione um período.');
    return;
  }
  try {
    const j = await api('GET', `/periods/${selectedPeriodId}/preview`);
    const by = j.data?.by_employee;
    if (!Array.isArray(by) || !by.length) {
      window.crmToast?.error?.('Não há dados neste período.');
      return;
    }
    shareSlipsRowsCache = by.map((row) => ({
      id: Number(row.employee_id),
      name: row.name == null ? '' : String(row.name),
    }));
    const list = document.getElementById('shareSlipsList');
    list.innerHTML = shareSlipsRowsCache
      .map(
        (r) => `<div class="flex items-center justify-between gap-2 border-b border-slate-100 py-3 px-2">
        <span class="font-medium text-sm text-slate-900 truncate min-w-0">${escapeHtml(r.name || '—')}</span>
        <button type="button" class="btn btn-sm btn-primary shrink-0 share-slip-btn touch-manipulation" data-eid="${r.id}">Compartilhar</button>
      </div>`
      )
      .join('');
    openShareSlipsModalShell();
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao abrir compartilhamento');
  }
}

/**
 * Compartilha um recibo como PNG (Web Share) ou baixa o arquivo.
 * @param {number} employeeId
 * @param {string} [displayName]
 */
async function shareOneSlipAsImage(employeeId, displayName) {
  if (!selectedPeriodId || !Number.isFinite(employeeId)) return;
  const name = displayName || 'Funcionário';
  try {
    window.crmToast?.info?.('Preparando imagem do recibo…');
    const pdfBlob = await fetchPaySlipPdfBlob(selectedPeriodId, employeeId);
    const pngBlob = await pdfBlobToPngBlob(pdfBlob);
    const filename = `Recibo-${safeSlipFilePart(name)}-${employeeId}.png`;
    let usedShare = false;
    if (typeof navigator.share === 'function') {
      let file;
      try {
        file = new File([pngBlob], filename, { type: 'image/png' });
      } catch (_) {
        file = null;
      }
      if (file) {
        try {
          if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
            downloadBlob(pngBlob, filename);
            window.crmToast?.success?.(
              'Este navegador não compartilha arquivos daqui. PNG baixado — anexe no WhatsApp ou nas mensagens.'
            );
            return;
          }
          await navigator.share({
            files: [file],
            title: 'Recibo',
            text: `Recibo — ${name}`,
          });
          usedShare = true;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
    }
    if (!usedShare) {
      downloadBlob(pngBlob, filename);
      window.crmToast?.success?.('PNG baixado — envie como anexo no app.');
    }
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao compartilhar');
  }
}

async function sendPaySlipsEmail() {
  if (!canManage || !selectedPeriodId) return;
  if (
    !confirm(
      'Enviar um e-mail por funcionário com o recibo em PDF (marca Senior Floors)? Inclui apenas quem tem e-mail no cadastro e dados neste período. É necessário Resend ou SMTP configurado no servidor.'
    )
  ) {
    return;
  }
  try {
    window.crmToast?.info?.('Enviando e-mails…');
    const j = await api('POST', `/periods/${selectedPeriodId}/slips/email`, {});
    const d = j.data || {};
    const sent = d.sent ?? 0;
    const results = d.results || [];
    const failed = results.filter((r) => !r.ok);
    window.crmToast?.success?.(`Enviados: ${sent}. Com falha: ${failed.length}.`);
    if (failed.length) {
      console.warn('Pay slip email failures', failed);
    }
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao enviar');
  }
}

/** Relatórios individuais em PDF (layout = recibo), dados gravados na BD. */
async function fetchAndOpenIndividualReports() {
  await openIndividualReportsPdfFromApi(null);
}

/** A partir do modal de prévia: PDF com reembolsos e descontos dos campos (ainda não salvos). */
async function openIndividualPayrollReportsFromPreview() {
  const trs = Array.from(document.querySelectorAll('#previewTbody tr'));
  if (!trs.length) {
    window.crmToast?.error?.('Sem dados para mostrar.');
    return;
  }
  await openIndividualReportsPdfFromApi(collectAdjustmentsFromPreview());
}

async function confirmClosePeriod() {
  if (!selectedPeriodId) return;
  try {
    await saveAdjustmentsFromPreview();
    await api('POST', `/periods/${selectedPeriodId}/close`);
    window.crmToast?.success?.('Período fechado e bloqueado.');
    closePreviewModal();
    await loadPeriods();
    await loadDashboard();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
}

function initReportDates() {
  const t = new Date();
  const from = new Date(t.getFullYear(), t.getMonth(), 1);
  const rf = document.getElementById('reportFrom');
  const rt = document.getElementById('reportTo');
  if (rf) rf.value = localDateToYMD(from);
  if (rt) rt.value = localDateToYMD(t);
}

/** Intervalo De/Até para relatórios (datas locais; corrige se De > Até). */
function getReportRangeOrToast() {
  const rf = document.getElementById('reportFrom');
  const rt = document.getElementById('reportTo');
  if (!rf || !rt) return null;
  let from = (rf.value || '').trim();
  let to = (rt.value || '').trim();
  if (!from || !to) {
    window.crmToast?.error?.('Defina as datas De / Até.');
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    window.crmToast?.error?.('Datas inválidas — use o seletor de data do navegador.');
    return null;
  }
  if (from > to) {
    const x = from;
    from = to;
    to = x;
  }
  return { from, to };
}

function buildReportTableFragment(title, headers, rows) {
  let html = `<div class="rounded-xl border border-slate-200 overflow-hidden shadow-sm"><h3 class="font-bold text-slate-900 px-4 py-3 bg-slate-50 border-b text-sm">${escapeHtml(title)}</h3><div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr>`;
  headers.forEach((h) => {
    html += `<th class="px-3 py-2 text-left text-xs uppercase text-slate-500 bg-white border-b border-slate-100">${escapeHtml(h)}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach((cells) => {
    html += '<tr class="border-t border-slate-100">';
    cells.forEach((c) => {
      html += `<td class="px-3 py-2">${c}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></div></div>';
  return html;
}

function buildTotalReportFragment(d, from, to) {
  const sheet = d.timesheet_total != null ? d.timesheet_total : d.total;
  const reim = d.reimbursement_total != null ? d.reimbursement_total : 0;
  const disc = d.discount_total != null ? d.discount_total : 0;
  const tot =
    d.total != null ? d.total : Math.round((Number(sheet || 0) + Number(reim || 0) - Number(disc || 0)) * 100) / 100;
  return `<div class="rounded-xl border-2 border-[#1a2036]/20 bg-[#1a2036] text-white overflow-hidden shadow-sm">
    <h3 class="font-bold px-4 py-3 text-[#d6b598] text-xs uppercase tracking-wide">Resumo financeiro</h3>
    <div class="px-4 pb-4">
      <p class="text-2xl font-bold">${money(tot)}</p>
      <p class="text-sm text-slate-300 mt-1">Folha: ${money(sheet)} · Reemb.: ${money(reim)} · Desc.: ${money(disc)}</p>
      <p class="text-xs text-slate-400 mt-2">${d.line_count != null ? d.line_count : 0} linhas na planilha · ${escapeHtml(from)} a ${escapeHtml(to)}</p>
    </div>
  </div>`;
}

function renderReportTable(title, headers, rows) {
  document.getElementById('reportOut').innerHTML = buildReportTableFragment(title, headers, rows);
}

async function runReportEmployees() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const j = await api('GET', `/reports/employee-earnings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const raw = j.data || [];
  if (!raw.length) {
    document.getElementById('reportOut').innerHTML =
      '<p class="text-sm text-slate-600 py-4">Nenhum lançamento na planilha neste intervalo (<strong>' +
      escapeHtml(from) +
      '</strong> a <strong>' +
      escapeHtml(to) +
      '</strong>).</p>';
    return;
  }
  const rows = mapEmployeeReportRows(raw);
  renderReportTable('Ganhos por funcionário', EMPLOYEE_REPORT_HEADERS, rows);
}

async function runReportProjects() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const j = await api('GET', `/reports/project-labor?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const raw = j.data || [];
  if (!raw.length) {
    document.getElementById('reportOut').innerHTML =
      '<p class="text-sm text-slate-600 py-4">Nenhum custo por projeto neste intervalo.</p>';
    return;
  }
  const rows = mapProjectReportRows(raw);
  renderReportTable('Mão de obra por projeto', ['Projeto', 'Número', 'Linhas', 'Custo'], rows);
}

async function runReportTotal() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const j = await api('GET', `/reports/total-expenses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  document.getElementById('reportOut').innerHTML = buildTotalReportFragment(j.data || {}, from, to);
}

function mapEmployeeReportRows(raw) {
  return (raw || []).map((r) => [
    escapeHtml(r.name ?? '—'),
    escapeHtml(sectorLabel(r.sector)),
    fmtReportQty(r.total_days),
    fmtReportQty(r.total_overtime_hours),
    money(r.timesheet_earnings != null ? r.timesheet_earnings : 0),
    money(r.reimbursement_total != null ? r.reimbursement_total : 0),
    money(r.discount_total != null ? r.discount_total : 0),
    money(r.total_earnings != null ? r.total_earnings : 0),
  ]);
}

function mapProjectReportRows(raw) {
  return (raw || []).map((r) => [
    r.project_id != null && r.project_id !== '' ? `#${r.project_id}` : '—',
    escapeHtml(r.project_number || '—'),
    String(r.entries ?? 0),
    money(r.labor_cost),
  ]);
}

async function runReportAll() {
  const range = getReportRangeOrToast();
  if (!range) return;
  const { from, to } = range;
  const q = (path) =>
    api('GET', `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const out = document.getElementById('reportOut');
  if (!out) return;
  try {
    const [sEmp, sProj, sTot] = await Promise.allSettled([
      q('/reports/employee-earnings'),
      q('/reports/project-labor'),
      q('/reports/total-expenses'),
    ]);
    const errMsgs = [];
    if (sTot.status === 'rejected') errMsgs.push(sTot.reason?.message || 'Totais');
    if (sEmp.status === 'rejected') errMsgs.push(sEmp.reason?.message || 'Por funcionário');
    if (sProj.status === 'rejected') errMsgs.push(sProj.reason?.message || 'Por projeto');
    if (errMsgs.length === 3) {
      window.crmToast?.error?.(`Relatório falhou: ${errMsgs[0]}`);
      return;
    }

    const jEmp = sEmp.status === 'fulfilled' ? sEmp.value : { data: [] };
    const jProj = sProj.status === 'fulfilled' ? sProj.value : { data: [] };

    const empRows = mapEmployeeReportRows(jEmp.data);
    const projRows = mapProjectReportRows(jProj.data);

    const summaryBlock =
      sTot.status === 'fulfilled'
        ? buildTotalReportFragment((sTot.value && sTot.value.data) || {}, from, to)
        : `<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Resumo financeiro indisponível: ${escapeHtml(
            String(sTot.reason?.message || 'erro no servidor')
          )}</div>`;

    let warn = '';
    if (errMsgs.length && errMsgs.length < 3) {
      warn = `<p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Aviso: ${escapeHtml(errMsgs.join(' · '))}</p>`;
    }

    out.innerHTML = `
      ${warn}
      <p class="text-sm text-slate-600 font-medium">Intervalo: <strong>${escapeHtml(from)}</strong> a <strong>${escapeHtml(to)}</strong></p>
      <div class="space-y-4 mt-3">
        ${summaryBlock}
        ${buildReportTableFragment('Por funcionário', EMPLOYEE_REPORT_HEADERS, empRows)}
        ${buildReportTableFragment('Por projeto', ['ID', 'Número', 'Linhas', 'Custo'], projRows)}
      </div>`;
    window.crmToast?.success?.(errMsgs.length ? 'Relatório parcial gerado' : 'Relatório completo gerado');
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao gerar relatório');
  }
}

async function quickSaveEmployee() {
  const errEl = document.getElementById('empQuickErr');
  errEl?.classList.add('hidden');
  const name = document.getElementById('empQuickName')?.value.trim();
  if (!name) {
    if (errEl) {
      errEl.textContent = 'Indique o nome do funcionário.';
      errEl.classList.remove('hidden');
    }
    return;
  }
  const body = {
    name,
    sector: document.getElementById('empQuickSector')?.value || null,
    payment_type: 'daily',
    daily_rate: Number(document.getElementById('empQuickDaily')?.value) || 0,
    hourly_rate: 0,
    overtime_rate: 0,
    role: null,
    phone: null,
    email: null,
    payment_method: null,
  };
  try {
    await api('POST', '/employees', body);
    const qn = document.getElementById('empQuickName');
    const qd = document.getElementById('empQuickDaily');
    if (qn) qn.value = '';
    if (qd) qd.value = '';
    window.crmToast?.success?.('Funcionário adicionado — você já pode lançar horas.');
    await loadEmployees();
    await loadTimesheetsForPeriod();
    await loadDashboard();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
    window.crmToast?.error?.(e.message);
  }
}

function initPayrollHubNav() {
  const update = () => {
    const hash = (window.location.hash || '#hub-resumo').replace('#', '');
    document.querySelectorAll('.payroll-nav-btn').forEach((b) => {
      const h = (b.getAttribute('href') || '').replace('#', '');
      const on = h === hash;
      b.classList.toggle('active', on);
    });
  };
  window.addEventListener('hashchange', update);
  document.querySelectorAll('.payroll-nav-btn').forEach((b) => {
    b.addEventListener('click', () => setTimeout(update, 50));
  });
  if (!window.location.hash) {
    window.history.replaceState(null, '', '#hub-resumo');
  }
  update();
}

function initPayrollMobileNav() {
  const sidebar = document.getElementById('payrollSidebar');
  const overlay = document.getElementById('mobileOverlay');
  const toggle = document.getElementById('mobileMenuToggle');
  if (!sidebar || !overlay || !toggle) return;

  /** Mesmo breakpoint que o CSS (#payrollShellLayoutLock): gaveta até 1366px (iPad) */
  function isDrawerMode() {
    return window.innerWidth <= 1366;
  }

  function setOpen(open) {
    sidebar.classList.toggle('mobile-open', open);
    overlay.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', () => {
    setOpen(!sidebar.classList.contains('mobile-open'));
  });
  overlay.addEventListener('click', () => setOpen(false));
  window.addEventListener('resize', () => {
    if (!isDrawerMode()) setOpen(false);
  });

  sidebar.addEventListener('click', (e) => {
    const t = e.target.closest('a.nav-item');
    if (t && isDrawerMode()) setOpen(false);
  });

  function syncMobileHeaderAria() {
    const header = document.getElementById('mobileAppHeader');
    if (!header) return;
    header.setAttribute('aria-hidden', isDrawerMode() ? 'false' : 'true');
  }
  syncMobileHeaderAria();
  window.addEventListener('resize', syncMobileHeaderAria);
}

async function reloadAll() {
  await loadDashboard();
  await loadEmployees();
  await loadProjects();
  await loadPeriods();
}

document.getElementById('btnReloadAll')?.addEventListener('click', () => reloadAll());
document.getElementById('periodSelect')?.addEventListener('change', () => void onPeriodChange());
document.getElementById('btnOpenPeriodPicker')?.addEventListener('click', () => openPeriodPickerModal({}));
document.getElementById('periodPickerCancel')?.addEventListener('click', () => closePeriodPickerModal());
document.getElementById('periodPickerUse')?.addEventListener('click', () => void periodPickerApplySelection());
document.getElementById('periodPickerCreate')?.addEventListener('click', () => void periodPickerSubmitCreate());
document.getElementById('periodPickerPrevM')?.addEventListener('click', () => {
  periodPickerViewMonth -= 1;
  if (periodPickerViewMonth < 0) {
    periodPickerViewMonth = 11;
    periodPickerViewYear -= 1;
  }
  renderPeriodPickerUi();
});
document.getElementById('periodPickerNextM')?.addEventListener('click', () => {
  periodPickerViewMonth += 1;
  if (periodPickerViewMonth > 11) {
    periodPickerViewMonth = 0;
    periodPickerViewYear += 1;
  }
  renderPeriodPickerUi();
});
document.getElementById('btnNewEmployee')?.addEventListener('click', () => openEmployeeModal(null));
document.getElementById('empCancel')?.addEventListener('click', () => closeEmployeeModal());
document.getElementById('empDelete')?.addEventListener('click', async () => {
  const editId = document.getElementById('empEditId').value;
  if (!editId || !canManage) return;
  if (
    !window.confirm(
      'Excluir permanentemente este funcionário da equipe? Só é possível se não houver linhas na planilha de horas associadas a ele em nenhum período.'
    )
  ) {
    return;
  }
  try {
    await api('DELETE', `/employees/${editId}`);
    window.crmToast?.success?.('Funcionário removido');
    closeEmployeeModal();
    await loadEmployees();
    await loadTimesheetsForPeriod();
    await loadDashboard();
  } catch (e) {
    window.crmToast?.error?.(e.message || 'Erro ao excluir.');
  }
});
document.getElementById('empSave')?.addEventListener('click', () => saveEmployee());
document.getElementById('btnNewPeriod')?.addEventListener('click', () => openPeriodPickerModal({ suggestEmptyWeek: true }));
document.getElementById('btnDeletePeriod')?.addEventListener('click', async () => {
  if (!canManage || !selectedPeriodId) return;
  const p = selectedPeriodRecord();
  if (!p) return;
  const nm = p.name || `Período #${p.id}`;
  const dates = `${p.start_date} a ${p.end_date}`;
  if (
    !window.confirm(
      `Excluir o período "${nm}" (${dates})?\n\nTodas as linhas da planilha, reembolsos e descontos deste período serão removidos. Esta ação não pode ser desfeita.`
    )
  )
    return;
  try {
    await api('DELETE', `/periods/${selectedPeriodId}`);
    window.crmToast?.success?.('Período excluído.');
    await loadPeriods();
    await loadDashboard();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
function tryAddTimesheetRowForSector(sectorKey) {
  if (!canAddTimesheetRows()) {
    window.crmToast?.error?.(
      selectedPeriodRecord()?.status === 'closed'
        ? 'Período fechado — não é possível adicionar linhas novas (só alterar as existentes, com payroll.manage).'
        : 'Sem permissão para editar a planilha (payroll.view).'
    );
    return;
  }
  if (!selectedPeriodId) {
    window.crmToast?.error?.('Primeiro, escolha um período em «Selecionar período».');
    return;
  }
  const tb = getTimesheetTbody(sectorKey);
  const w = lastWorkDateInTbody(tb) || lastTimesheetDateYmd || defaultWorkDate();
  appendTimesheetRow({ work_date: w }, sectorKey);
  updatePeriodRunningTotalFromDom();
}

document.getElementById('btnAddTimesheetRowInstallation')?.addEventListener('click', () =>
  tryAddTimesheetRowForSector('installation')
);
document.getElementById('btnAddTimesheetRowSandFinish')?.addEventListener('click', () =>
  tryAddTimesheetRowForSector('sand_finish')
);
document.getElementById('btnSaveTimesheet')?.addEventListener('click', async () => {
  const pid = periodIdNum(selectedPeriodId);
  if (pid == null) {
    window.crmToast?.error?.('Escolha um período válido antes de salvar.');
    return;
  }
  if (!canEditTimesheetGrid()) {
    window.crmToast?.error?.(
      selectedPeriodRecord()?.status === 'closed'
        ? 'Período fechado — só quem tem payroll.manage pode salvar alterações na planilha.'
        : 'Sem permissão para salvar a planilha (payroll.view).'
    );
    return;
  }
  const bad = timesheetGridValidationIssues();
  if (bad.length) {
    window.crmToast?.error?.(bad[0] + (bad.length > 1 ? ` (+${bad.length - 1})` : ''));
    return;
  }
  const lines = collectLinesFromGrid();
  if (!lines.length) {
    window.crmToast?.error?.(
      'Nenhuma linha para salvar. Escolha funcionário e data e preencha pelo menos diárias/horas (1d/2d/½), horas extras — ou escreva uma nota.'
    );
    return;
  }
  try {
    const j = await api('POST', `/periods/${pid}/timesheets/bulk`, { lines });
    const saved = Array.isArray(j.data) ? j.data.length : 0;
    if (saved < lines.length) {
      window.crmToast?.error?.(
        `Só ${saved} de ${lines.length} linha(s) foram salvas. Confira funcionário, data no período e se não há duplicados (mesmo dia e projeto).`
      );
    } else {
      window.crmToast?.success?.('Planilha salva');
    }
    await loadTimesheetsForPeriod();
    await loadPeriods(selectedPeriodId);
    await loadDashboard();
  } catch (e) {
    let msg = e.message || 'Erro ao salvar.';
    if (e.status === 403) {
      msg =
        e.payload?.required === 'payroll.view' || e.payload?.required === 'payroll.manage'
          ? 'Sem permissão para salvar a planilha. Confirme payroll.view na sua conta.'
          : 'Sem permissão para esta ação.';
    } else if (String(msg).includes('Já existe linha')) {
      msg =
        'Já existe uma linha para o mesmo funcionário, data e projeto neste período. Edite a linha existente ou escolha outro projeto/data.';
    } else if (String(msg).toLowerCase().includes('fora do período')) {
      msg =
        'A data de cada linha precisa estar entre o início e o fim do período. Corrija a coluna Data.';
    } else if (e.payload?.code === 'BULK_NO_ROWS_SAVED' || String(msg).includes('Nenhuma linha foi gravada')) {
      msg =
        e.payload?.error ||
        'Nenhuma linha foi salva. Verifique funcionário, data dentro do período e se não há duplicados (mesmo dia e projeto).';
    }
    window.crmToast?.error?.(msg);
  }
});
document.getElementById('btnPreviewPayroll')?.addEventListener('click', () => fetchAndShowPreview(false));
document.getElementById('btnPrintIndividualReports')?.addEventListener('click', () => fetchAndOpenIndividualReports());
document.getElementById('btnSharePaySlips')?.addEventListener('click', () => openShareSlipsModal());
document.getElementById('shareSlipsModalClose')?.addEventListener('click', () => closeShareSlipsModal());
document.getElementById('shareSlipsModalBackdrop')?.addEventListener('click', () => closeShareSlipsModal());
document.getElementById('shareSlipsList')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.share-slip-btn');
  if (!btn || !document.getElementById('shareSlipsModal')?.contains(btn)) return;
  const eid = parseInt(btn.getAttribute('data-eid'), 10);
  if (!Number.isFinite(eid)) return;
  const row = shareSlipsRowsCache.find((r) => r.id === eid);
  shareOneSlipAsImage(eid, row?.name);
});
document.getElementById('btnPaySlipsPdfZip')?.addEventListener('click', () => downloadPaySlipsZip('pdf'));
document.getElementById('btnPaySlipsPngZip')?.addEventListener('click', () => downloadPaySlipsZip('png'));
document.getElementById('btnPaySlipsEmail')?.addEventListener('click', () => sendPaySlipsEmail());
document.getElementById('btnPreviewClose')?.addEventListener('click', () => fetchAndShowPreview(true));
document.getElementById('previewCloseOnly')?.addEventListener('click', () => closePreviewModal());
document.getElementById('previewPrintIndividualReports')?.addEventListener('click', () => openIndividualPayrollReportsFromPreview());
document.getElementById('previewCancelClose')?.addEventListener('click', () => closePreviewModal());
document.getElementById('previewSaveAdjustments')?.addEventListener('click', async () => {
  try {
    await saveAdjustmentsFromPreview();
    window.crmToast?.success?.('Reembolsos e descontos salvos');
    await fetchAndShowPreview(true);
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
document.getElementById('previewConfirmClose')?.addEventListener('click', () => confirmClosePeriod());
document.getElementById('btnReopenPeriod')?.addEventListener('click', async () => {
  if (!selectedPeriodId || !canManage) return;
  const p = selectedPeriodRecord();
  if (!p || p.status !== 'closed') return;
  if (
    !confirm(
      'Reabrir este período? A planilha volta a poder ser editada (conforme as permissões). Confirma?'
    )
  ) {
    return;
  }
  try {
    await api('POST', `/periods/${selectedPeriodId}/reopen`);
    window.crmToast?.success?.('Período reaberto.');
    await loadPeriods();
    await loadDashboard();
    await loadTimesheetsForPeriod();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
});
document.getElementById('btnNewEmployeeEmpty')?.addEventListener('click', () => openEmployeeModal(null));
document.getElementById('btnReportAll')?.addEventListener('click', () =>
  runReportAll().catch((e) => window.crmToast?.error?.(e.message || 'Erro ao gerar relatório'))
);
document.getElementById('btnReportEmployees')?.addEventListener('click', () => runReportEmployees().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('btnReportProjects')?.addEventListener('click', () => runReportProjects().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('btnReportTotal')?.addEventListener('click', () => runReportTotal().catch((e) => window.crmToast?.error?.(e.message)));
document.getElementById('empQuickSave')?.addEventListener('click', () => quickSaveEmployee());

(async function boot() {
  initReportDates();
  initPayrollMobileNav();
  initPayrollHubNav();
  const ok = await loadSession();
  if (!ok) return;
  try {
    await reloadAll();
  } catch (e) {
    if (e.status === 403) showAuth('Acesso negado.');
    else if (e.payload?.code === 'PAYROLL_SCHEMA_MISSING') {
      /* banner visible */
    } else window.crmToast?.error?.(e.message);
  }
})();
