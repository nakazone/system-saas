/**
 * Painel financeiro completo — Senior Floors CRM
 */
let currentPeriod = 'month';
let currentWeek = getMonday(new Date());
let plData = null;
let _cfChart = null;
let vendorsCache = [];
let editingOpId = null;
let editingVendorId = null;
let editingExpenseId = null;
/** Se true ao guardar edição, limpa recibo na BD (utilizador clicou Remover anexo). */
let removeExpenseReceiptOnSave = false;
let editingPayRecvId = null;
/** Recibo enviado antes de POST /api/expenses — { receipt_file_path, receipt_url, name } */
let pendingExpenseReceipt = null;

const fmt$ = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(parseFloat(v) || 0);
const fmt$Compact = (v) => {
  const n = parseFloat(v) || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return fmt$(n);
};
const fmtPct = (v) => `${(parseFloat(v) || 0).toFixed(1)}%`;

/** Data civil local YYYY-MM-DD (não usar toISOString — é UTC e desloca o mês/dia). */
function formatLocalYMD(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** API pode devolver DATE como string ou objeto Date (mysql2). */
function fmtOpDate(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return formatLocalYMD(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

async function fetchJsonOrWarn(url, label) {
  const r = await fetch(url, { credentials: 'include' });
  let j;
  try {
    j = await r.json();
  } catch (_) {
    j = { success: false, error: 'Resposta inválida' };
  }
  if (!r.ok || j.success === false) {
    console.warn(`[financial] ${label || url}`, r.status, j.error || j.message || '');
  }
  return j;
}

function getMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = x.getDate() - day + (day === 0 ? -6 : 1);
  x.setDate(diff);
  return formatLocalYMD(x);
}

function showToast(msg, type = 'success') {
  const bg = { success: 'var(--sf-ok, #2d6e4a)', error: 'var(--sf-bad, #b33a3a)', info: 'var(--sf-navy, #1a2036)' };
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;z-index:9999;background:${bg[type] || bg.success};max-width:320px`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function showSkeletons(section) {
  document.querySelectorAll(`[data-skeleton="${section}"]`).forEach((e) => e.classList.add('sf-skeleton'));
}
function hideSkeletons(section) {
  document.querySelectorAll(`[data-skeleton="${section}"]`).forEach((e) => e.classList.remove('sf-skeleton'));
}

function switchFinancialTab(tab) {
  if (tab !== 'vendors') closeVendorDrawer();
  document.querySelectorAll('.fin-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.fin-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === tab));
  if (tab === 'operational') {
    loadVendors();
    loadOperationalCosts();
  }
  if (tab === 'vendors') loadVendors();
  if (tab === 'receipts') loadPaymentReceipts();
}

async function loadPL() {
  showSkeletons('pl');
  const customS = document.getElementById('finCustomStart')?.value;
  const customE = document.getElementById('finCustomEnd')?.value;
  const params = new URLSearchParams();
  if (customS && customE) {
    params.set('start', customS);
    params.set('end', customE);
  } else {
    params.set('period', currentPeriod);
  }
  const [plRes, cfRes] = await Promise.all([
    fetch(`/api/financial/pl?${params}`, { credentials: 'include' }).then((r) => r.json()),
    fetch('/api/financial/cash-flow?months=6', { credentials: 'include' }).then((r) => r.json()),
  ]);
  hideSkeletons('pl');
  if (!plRes.success) {
    showToast(plRes.error || 'Erro P&L', 'error');
    return;
  }
  plData = plRes.data;
  const c = plData.costs || {};
  const totalC = parseFloat(c.total) || 0;
  document.getElementById('pl-revenue').textContent = fmt$(plData.revenue);
  document.getElementById('pl-received').textContent = fmt$(plData.received);
  document.getElementById('pl-cost-total').textContent = fmt$(totalC);
  document.getElementById('pl-gross').textContent = fmt$(plData.gross_profit);
  document.getElementById('pl-net').textContent = fmt$(plData.net_profit);
  const m = parseFloat(plData.net_margin_pct) || 0;
  document.getElementById('pl-margin').textContent = fmtPct(m);
  const marginEl = document.getElementById('kpi-margin');
  marginEl.classList.remove('fin-card--ok', 'fin-card--warn', 'fin-card--bad');
  marginEl.classList.add(m >= 15 ? 'fin-card--ok' : m >= 5 ? 'fin-card--warn' : 'fin-card--bad');

  const pct = (x) => (totalC > 0 ? ((parseFloat(x) || 0) / totalC) * 100 : 0);
  document.getElementById('bd-payroll').textContent = `${fmt$(c.payroll)} (${fmtPct(pct(c.payroll))})`;
  document.getElementById('bd-project').textContent = `${fmt$(c.project)} (${fmtPct(pct(c.project))})`;
  document.getElementById('bd-op').textContent = `${fmt$(c.operational)} (${fmtPct(pct(c.operational))})`;
  document.getElementById('bd-mkt').textContent = `${fmt$(c.marketing)} (${fmtPct(pct(c.marketing))})`;
  document.getElementById('bd-total').textContent = fmt$(totalC);

  const tbody = document.getElementById('pl-projects-body');
  const top = plData.top_projects || [];
  tbody.innerHTML = top.length
    ? top
        .map(
          (r) => `<tr>
        <td>${escapeHtml(r.project_label)}</td>
        <td>${fmt$(r.contract_value)}</td>
        <td>${fmt$(r.cost_total)}</td>
        <td>${fmt$(r.profit)}</td>
        <td>${fmtPct(r.margin_pct)}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="6" style="color:var(--text-muted)">Sem projetos no período</td></tr>';

  if (cfRes.success && cfRes.data) renderCashFlowChart(cfRes.data);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

const EXPENSE_PAYMENT_METHOD_LABELS = {
  cash_debit: 'Dinheiro / cartão de débito',
  credit_card: 'Cartão de crédito',
  store_credit: 'Crédito na loja',
};

function formatExpensePaymentMethod(v) {
  const k = String(v || '').trim();
  if (EXPENSE_PAYMENT_METHOD_LABELS[k]) return EXPENSE_PAYMENT_METHOD_LABELS[k];
  return k || '—';
}

/** URL pública do recibo (expense ou histórico de fornecedor). */
function resolveExpenseReceiptUrl(row) {
  if (!row || typeof row !== 'object') return '';
  const url = row.receipt_url;
  if (url != null && String(url).trim() !== '') {
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    return u.startsWith('/') ? u : `/${u}`;
  }
  const p = row.receipt_file_path || row.receipt_path;
  if (p == null || String(p).trim() === '') return '';
  const rel = String(p).replace(/^\/?uploads\/?/, '');
  return `/uploads/${rel}`;
}

function isReceiptPdfSrc(src) {
  return /\.pdf($|\?|#)/i.test(src || '');
}

function receiptThumbOrLinkHtml(src) {
  if (!src) return '—';
  if (isReceiptPdfSrc(src)) {
    return `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="padding:4px 8px;font-size:11px">Ver PDF</a>`;
  }
  return `<a href="${escapeHtml(src)}" class="fin-exp-receipt-lightbox" data-exp-lightbox="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" loading="lazy" style="max-height:44px;max-width:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border-color);vertical-align:middle;cursor:zoom-in" /></a>`;
}

async function openExpenseModalForEdit(id) {
  if (!id) return;
  editingExpenseId = id;
  removeExpenseReceiptOnSave = false;
  const titleEl = document.getElementById('modalExpenseTitle');
  if (titleEl) titleEl.textContent = 'Editar despesa';
  await ensureExpenseVendorSelect();
  const res = await fetch(`/api/expenses/${id}`, { credentials: 'include' }).then((r) => r.json());
  if (!res.success || !res.data) {
    showToast(res.error || 'Despesa não encontrada', 'error');
    editingExpenseId = null;
    return;
  }
  const row = res.data;
  document.getElementById('exp-cat').value = row.category || 'other';
  document.getElementById('exp-desc').value = row.description || '';
  document.getElementById('exp-amount').value = row.amount != null ? String(row.amount) : '';
  document.getElementById('exp-date').value = fmtOpDate(row.expense_date);
  const expPay = document.getElementById('exp-pay');
  if (expPay) expPay.value = row.payment_method || 'cash_debit';
  const vs = document.getElementById('exp-vendor-select');
  if (vs) vs.value = row.vendor_id != null && row.vendor_id !== '' ? String(row.vendor_id) : '';
  const vf = document.getElementById('exp-vendor-free');
  if (vf) {
    vf.value =
      row.vendor_id != null && String(row.vendor_id).trim() !== ''
        ? ''
        : String(row.vendor_name || row.vendor || '').trim();
  }
  resetExpenseReceiptUI();
  removeExpenseReceiptOnSave = false;
  const url = resolveExpenseReceiptUrl(row);
  if (url) {
    const hint = document.getElementById('exp-receipt-hint');
    if (hint) hint.textContent = 'Recibo atual. Carregue outro ficheiro para substituir ou use Remover anexo.';
    const clr = document.getElementById('exp-receipt-clear');
    if (clr) clr.style.display = '';
    const prev = document.getElementById('exp-receipt-preview');
    if (prev) {
      if (!isReceiptPdfSrc(url)) {
        prev.innerHTML = `<img src="${escapeHtml(url)}" alt="" class="fin-expense-receipt-thumb" />`;
      } else {
        prev.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Ver PDF</a>`;
      }
    }
  }
  openModal('modalExpense');
}

function openPaymentRecvModalForEdit(row) {
  if (!row) return;
  editingPayRecvId = row.id;
  const t = document.getElementById('modalPayRecvTitle');
  if (t) t.textContent = 'Editar recebimento';
  document.getElementById('pr-project').value = row.project_id != null ? String(row.project_id) : '';
  document.getElementById('pr-type').value = row.payment_type || 'other';
  document.getElementById('pr-amount').value = row.amount != null ? String(row.amount) : '';
  document.getElementById('pr-date').value = fmtOpDate(row.payment_date);
  document.getElementById('pr-method').value = row.payment_method || 'check';
  document.getElementById('pr-ref').value = row.reference_number || '';
  openModal('modalPayRecv');
}

async function deleteExpenseById(expenseId, opts) {
  if (!expenseId) return;
  if (!confirm('Excluir esta despesa? Esta ação não pode ser anulada.')) return;
  try {
    const raw = await fetch(`/api/expenses/${expenseId}`, { method: 'DELETE', credentials: 'include' });
    let res = {};
    try {
      res = await raw.json();
    } catch (_) {}
    if (raw.ok && res.success) {
      showToast('Despesa excluída');
      loadVendors();
      loadPL();
      loadPaymentReceipts();
      const rid = opts && opts.refreshVendorDrawerId;
      if (rid) await openVendorDrawer(rid);
    } else {
      showToast(res.error || res.message || `Erro ao excluir (${raw.status})`, 'error');
    }
  } catch (e) {
    showToast(e.message || 'Falha de rede', 'error');
  }
}

function renderCashFlowChart(months) {
  if (_cfChart) {
    _cfChart.destroy();
    _cfChart = null;
  }
  const canvas = document.getElementById('chart-cashflow');
  if (!canvas || !months?.length || typeof Chart === 'undefined') return;
  _cfChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        {
          label: 'Receita',
          data: months.map((m) => parseFloat(m.revenue) || 0),
          backgroundColor: '#c9a882',
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Custos',
          data: months.map((m) => parseFloat(m.costs) || 0),
          backgroundColor: 'rgba(143, 80, 16, 0.4)',
          borderRadius: 4,
          order: 2,
        },
        {
          label: 'Lucro Líquido',
          data: months.map((m) => parseFloat(m.net_profit) || 0),
          type: 'line',
          borderColor: '#2d6e4a',
          backgroundColor: 'rgba(45, 110, 74, 0.08)',
          borderWidth: 2,
          pointRadius: 4,
          fill: true,
          tension: 0.3,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: { callbacks: { label: (c) => ` ${fmt$(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false } },
        y: { ticks: { callback: (v) => fmt$Compact(v) } },
      },
    },
  });
}

async function loadWeeklyForecast(week) {
  const w = week || currentWeek;
  const res = await fetch(`/api/financial/weekly-forecast?week=${encodeURIComponent(w)}`, { credentials: 'include' }).then((r) =>
    r.json()
  );
  if (!res.success) {
    showToast(res.error || 'Erro previsão', 'error');
    return;
  }
  const d = res.data;
  currentWeek = d.week_start;
  document.getElementById('finWeekLabel').textContent = `${d.week_start} → ${d.week_end} (semana de pagamento)`;
  const f = d.forecast;
  document.getElementById('fc-payroll').textContent = fmt$(f.payroll.amount);
  const payLabel = document.getElementById('fcPayrollLabel');
  if (payLabel) {
    payLabel.textContent =
      f.payroll.source === 'construction_payroll' ? 'Folha construção (valor da semana anterior)' : 'Payroll estimado (agendas)';
  }
  const ruleEl = document.getElementById('fcWeekPayRule');
  if (ruleEl) {
    if (f.payroll.source === 'construction_payroll' && f.payroll.work_week && f.payroll.payment_date) {
      ruleEl.textContent = `Regra: a folha Seg–Dom de ${f.payroll.work_week.start} a ${f.payroll.work_week.end} é paga no sábado ${f.payroll.payment_date} (semana que está a ver: ${d.week_start} → ${d.week_end}).`;
    } else {
      ruleEl.textContent =
        'Com período Semana (Seg–Dom) na Folha de construção, o valor real aparece aqui na semana de pagamento seguinte (sábado). Sem período coincidente, usa-se estimativa por agendas de obra.';
    }
  }
  document.getElementById('fc-op').textContent = fmt$(f.operational.amount);
  document.getElementById('fc-mat').textContent = fmt$(f.materials.amount);
  document.getElementById('fc-mkt').textContent = fmt$(f.marketing.amount);
  document.getElementById('fc-total').textContent = fmt$(f.total);

  const rows = [];
  (f.payroll.items || []).forEach((i) => {
    if (i.source === 'construction_payroll') {
      rows.push([
        'Folha constr.',
        `${escapeHtml(i.period_name || 'Período')} · trabalho ${escapeHtml(i.work_week_start)}–${escapeHtml(i.work_week_end)} · pagamento ${escapeHtml(i.payment_date)}`,
        fmt$(i.payable_total),
      ]);
    } else {
      rows.push([
        'Payroll (est.)',
        `${escapeHtml(i.project_name)} · ${escapeHtml(i.crew_name)} · ${i.days_overlap}d`,
        fmt$((i.days_overlap || 0) * (parseFloat(i.daily_rate_avg) || 0)),
      ]);
    }
  });
  (f.operational.items || []).forEach((i) =>
    rows.push(['Operacional', escapeHtml(i.description), fmt$(i.total_amount)])
  );
  (f.materials.items || []).forEach((i) =>
    rows.push(['Material', escapeHtml(i.product_name) + ' · ' + escapeHtml(i.project_name || ''), fmt$(i.total_cost)])
  );
  document.getElementById('fc-detail-body').innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')
    : '<tr><td colspan="3">Sem itens</td></tr>';
}

async function importMarketing() {
  const now = new Date();
  const start = formatLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = formatLocalYMD(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const res = await fetch('/api/financial/import-marketing', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period_start: start, period_end: end }),
  }).then((r) => r.json());
  showToast(
    res.imported > 0 ? `${res.imported} campanhas importadas` : 'Nada novo para importar',
    res.success ? 'info' : 'error'
  );
  if (res.imported > 0) loadPL();
}

async function loadOperationalCosts() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startM = formatLocalYMD(new Date(y, m, 1));
  const endM = formatLocalYMD(new Date(y, m + 1, 0));
  const startY = `${y}-01-01`;
  const endY = `${y}-12-31`;

  const recurringOnly = document.getElementById('opToggleRecurring')?.checked;
  // Tabela: sem filtro de mês — evita registos “invisíveis” por TZ / data fora do intervalo.
  // KPIs e cartas por categoria continuam com filtro do mês local.
  const listUrl = recurringOnly ? '/api/operational-costs/recurring' : '/api/operational-costs';

  const [listRes, monthRes, yearRes, recRes] = await Promise.all([
    fetchJsonOrWarn(listUrl, 'operational-costs list'),
    fetchJsonOrWarn(`/api/operational-costs?start_date=${startM}&end_date=${endM}`, 'operational-costs month'),
    fetchJsonOrWarn(`/api/operational-costs?start_date=${startY}&end_date=${endY}`, 'operational-costs year'),
    fetchJsonOrWarn('/api/operational-costs/recurring', 'operational-costs recurring'),
  ]);

  const listPayload = listRes.success ? listRes.data : null;
  const rows = Array.isArray(listPayload)
    ? listPayload
    : listPayload != null && typeof listPayload === 'object'
      ? [listPayload]
      : [];
  if (!listRes.success) {
    showToast(listRes.error || listRes.message || 'Erro ao carregar a lista de custos', 'error');
  }
  const sumMonth = (monthRes.data || []).reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
  const sumYear = (yearRes.data || []).reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
  document.getElementById('op-kpi-month').textContent = fmt$(sumMonth);
  document.getElementById('op-kpi-year').textContent = fmt$(sumYear);
  document.getElementById('op-kpi-rec-n').textContent = String((recRes.data || []).length);

  const byCat = {};
  (monthRes.data || []).forEach((r) => {
    const k = r.category || 'other';
    if (!byCat[k]) byCat[k] = { total: 0, items: [] };
    byCat[k].total += parseFloat(r.total_amount) || 0;
    byCat[k].items.push(r);
  });
  document.getElementById('op-cat-cards').innerHTML = Object.keys(byCat).length
    ? Object.entries(byCat)
        .map(
          ([k, v]) => `<div class="fin-op-cat-card"><strong>${escapeHtml(k)}</strong><div class="fin-card-val" style="font-size:1.1rem">${fmt$(v.total)}</div><div>${v.items.length} despesas</div><ul style="margin:8px 0 0 14px;font-size:11px;color:var(--text-muted)">${v.items
            .slice(0, 3)
            .map((i) => `<li>${escapeHtml(i.description)}</li>`)
            .join('')}</ul></div>`
        )
        .join('')
    : '<p style="color:var(--text-muted)">Sem dados no mês</p>';

  const listErr = !listRes.success
    ? escapeHtml(String(listRes.error || listRes.message || 'Erro ao carregar'))
    : '';
  const emptyMsg = recurringOnly
    ? 'Nenhum custo recorrente (desmarque «Só recorrentes» para ver todos)'
    : 'Sem registos';
  document.getElementById('op-table-body').innerHTML = listErr
    ? `<tr><td colspan="8" style="color:var(--sf-bad,#b33a3a)">${listErr}</td></tr>`
    : rows.length
      ? rows
          .map((r) => {
            const rec = r.is_recurring ? `<span class="fin-badge-rec">🔄 ${escapeHtml(r.recurrence_type || '')}</span>` : '—';
            const rc = r.receipt_url
              ? `<a href="${escapeHtml(r.receipt_url)}" target="_blank" rel="noopener">Ver</a>
               <button type="button" class="btn btn-sm btn-secondary" data-op-receipt="${r.id}" style="padding:4px 8px;font-size:10px">Upload</button>`
              : `<button type="button" class="btn btn-sm btn-secondary" data-op-receipt="${r.id}" style="padding:4px 8px;font-size:10px">Upload</button>`;
            return `<tr>
          <td>${escapeHtml(fmtOpDate(r.expense_date))}</td>
          <td>${escapeHtml(r.category)}</td>
          <td>${escapeHtml(r.description)}</td>
          <td>${escapeHtml(r.vendor_name || '')}</td>
          <td>${fmt$(r.total_amount)}</td>
          <td>${rec}</td>
          <td>${rc}</td>
          <td style="white-space:nowrap;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            <button type="button" class="btn btn-sm btn-secondary" data-op-edit="${r.id}" style="padding:4px 8px">Editar</button>
            <button type="button" class="btn btn-sm btn-danger" data-op-delete="${r.id}" style="padding:4px 8px">Excluir</button>
          </td>
        </tr>`;
          })
          .join('')
      : `<tr><td colspan="8">${emptyMsg}</td></tr>`;

  document.querySelectorAll('[data-op-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-op-receipt');
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,application/pdf';
      input.onchange = () => uploadOperationalReceipt(id, input.files[0]);
      input.click();
    });
  });
  document.querySelectorAll('[data-op-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openOpModal(parseInt(btn.getAttribute('data-op-edit'), 10)));
  });
  document.querySelectorAll('[data-op-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-op-delete'), 10);
      if (!id) return;
      deleteOperationalCost(id);
    });
  });
}

async function deleteOperationalCost(id) {
  if (!confirm('Excluir este custo operacional? O registo será removido da lista (exclusão lógica).')) return;
  try {
    const raw = await fetch(`/api/operational-costs/${id}`, { method: 'DELETE', credentials: 'include' });
    let res = {};
    try {
      res = await raw.json();
    } catch (_) {}
    if (raw.ok && res.success) {
      showToast('Registo excluído');
      if (editingOpId === id) {
        editingOpId = null;
        closeModal('modalOpCost');
      }
      loadOperationalCosts();
      loadPL();
    } else {
      showToast(res.error || res.message || `Erro ao excluir (${raw.status})`, 'error');
    }
  } catch (e) {
    showToast(e.message || 'Falha de rede', 'error');
  }
}

async function uploadOperationalReceipt(id, file) {
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/operational-costs/${id}/receipt`, { method: 'POST', credentials: 'include', body: form }).then((r) =>
    r.json()
  );
  if (res.success) showToast('Recibo salvo');
  else showToast(res.error || 'Erro', 'error');
  loadOperationalCosts();
}

async function ensureExpenseVendorSelect() {
  const res = await fetch('/api/vendors', { credentials: 'include' }).then((r) => r.json());
  const list = res.success && res.data ? res.data : [];
  const sel = document.getElementById('exp-vendor-select');
  if (sel) {
    sel.innerHTML =
      '<option value="">— Fornecedor (cadastro) —</option>' +
      list.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
  }
}

function resetExpenseReceiptUI(opts) {
  pendingExpenseReceipt = null;
  if (opts?.markRemovedOnEdit && editingExpenseId) removeExpenseReceiptOnSave = true;
  const f = document.getElementById('exp-receipt-file');
  const c = document.getElementById('exp-receipt-camera');
  if (f) f.value = '';
  if (c) c.value = '';
  const hint = document.getElementById('exp-receipt-hint');
  if (hint) hint.textContent = '';
  const prev = document.getElementById('exp-receipt-preview');
  if (prev) prev.innerHTML = '';
  const clr = document.getElementById('exp-receipt-clear');
  if (clr) clr.style.display = 'none';
}

async function uploadPendingExpenseReceipt(file) {
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const raw = await fetch('/api/financial/expense-receipt', { method: 'POST', credentials: 'include', body: form });
  let res = {};
  try {
    res = await raw.json();
  } catch (_) {}
  if (!raw.ok || !res.success) {
    showToast(res.error || 'Erro ao enviar recibo', 'error');
    return;
  }
  pendingExpenseReceipt = {
    receipt_file_path: res.receipt_file_path,
    receipt_url: res.receipt_url,
    name: file.name,
  };
  if (editingExpenseId) removeExpenseReceiptOnSave = false;
  const hint = document.getElementById('exp-receipt-hint');
  if (hint) hint.textContent = file.name || 'Anexo carregado';
  const clr = document.getElementById('exp-receipt-clear');
  if (clr) clr.style.display = '';
  const prev = document.getElementById('exp-receipt-preview');
  if (prev && res.receipt_url) {
    if ((file.type || '').startsWith('image/')) {
      prev.innerHTML = `<img src="${escapeHtml(res.receipt_url)}" alt="" class="fin-expense-receipt-thumb" />`;
    } else {
      prev.innerHTML = `<a href="${escapeHtml(res.receipt_url)}" target="_blank" rel="noopener">Abrir PDF / ficheiro</a>`;
    }
  }
}

async function loadVendors() {
  const q = document.getElementById('vendorSearch')?.value?.trim();
  const url = q ? `/api/vendors?search=${encodeURIComponent(q)}` : '/api/vendors';
  const res = await fetch(url, { credentials: 'include' }).then((r) => r.json());
  vendorsCache = res.data || [];
  document.getElementById('vendor-grid').innerHTML = vendorsCache.length
    ? vendorsCache
        .map(
          (v) => `<div class="fin-vendor-card">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-muted)">${escapeHtml(v.category)}</span>
        <h4 style="margin:6px 0;color:var(--sf-navy)">${escapeHtml(v.name)}</h4>
        <p style="font-size:12px;color:var(--text-light)">${escapeHtml([v.contact_name, v.contact_email].filter(Boolean).join(' · '))}</p>
        <p style="font-weight:700;margin-top:8px">${fmt$(v.total_spent)}</p>
        <p style="font-size:12px">${v.rating ? '★'.repeat(v.rating) + '☆'.repeat(5 - v.rating) : '—'}</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          <button type="button" class="btn btn-sm btn-secondary" data-vendor-hist="${v.id}">Ver detalhes</button>
          <button type="button" class="btn btn-sm btn-primary" data-vendor-edit="${v.id}">Editar</button>
        </div>
      </div>`
        )
        .join('')
    : '<p>Sem fornecedores</p>';

  document.querySelectorAll('[data-vendor-hist]').forEach((b) => {
    b.addEventListener('click', () => openVendorDrawer(parseInt(b.getAttribute('data-vendor-hist'), 10)));
  });
  document.querySelectorAll('[data-vendor-edit]').forEach((b) => {
    b.addEventListener('click', () => openVendorModalForEdit(parseInt(b.getAttribute('data-vendor-edit'), 10)));
  });

  if (vendorDrawerVendorId != null && !vendorsCache.some((v) => v.id === vendorDrawerVendorId)) {
    closeVendorDrawer();
  }

  const sel = document.getElementById('op-vendor-select');
  if (sel) {
    sel.innerHTML = '<option value="">— Vendor —</option>' + vendorsCache.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
  }
}

async function openVendorModalForEdit(id) {
  if (!id) return;
  const res = await fetch(`/api/vendors/${id}`, { credentials: 'include' }).then((r) => r.json());
  if (!res.success || !res.data) {
    showToast(res.error || 'Fornecedor não encontrado', 'error');
    return;
  }
  const row = res.data;
  editingVendorId = id;
  const titleEl = document.getElementById('modalVendorTitle');
  if (titleEl) titleEl.textContent = 'Editar fornecedor';
  document.getElementById('v-name').value = row.name || '';
  document.getElementById('v-cat').value = row.category || 'other';
  document.getElementById('v-contact').value = row.contact_name || '';
  document.getElementById('v-email').value = row.contact_email || '';
  document.getElementById('v-phone').value = row.contact_phone || '';
  document.getElementById('v-web').value = row.website || '';
  document.getElementById('v-addr').value = row.address || '';
  document.getElementById('v-terms').value = row.payment_terms || '';
  document.getElementById('v-tax').value = row.tax_id || '';
  document.getElementById('v-rating').value = row.rating != null ? row.rating : '';
  document.getElementById('v-notes').value = row.notes || '';
  openModal('modalVendor');
}

let vendorDrawerVendorId = null;

function closeVendorDrawer() {
  const el = document.getElementById('vendorDetail');
  if (el) {
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }
  vendorDrawerVendorId = null;
}

function switchVendorDrawerTab(tab) {
  const hist = document.getElementById('vd-pane-hist');
  const pay = document.getElementById('vd-pane-pay');
  const files = document.getElementById('vd-pane-files');
  if (hist) hist.style.display = tab === 'hist' ? 'block' : 'none';
  if (pay) pay.style.display = tab === 'pay' ? 'block' : 'none';
  if (files) files.style.display = tab === 'files' ? 'block' : 'none';
  document.querySelectorAll('#vendorDetail .fin-vtab').forEach((b) => {
    b.classList.toggle('on', b.getAttribute('data-vtab') === tab);
  });
}

function renderVendorDrawerInvoicesList(vendorId, items) {
  const listEl = document.getElementById('vdFileList');
  const thumbs = document.getElementById('vdThumbs');
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = '<li style="list-style:none;color:var(--text-muted);padding:8px 0">Nenhum ficheiro</li>';
    if (thumbs) thumbs.innerHTML = '';
    return;
  }
  listEl.innerHTML = items
    .map((a) => {
      const name = escapeHtml(a.original_name || a.file_url || 'ficheiro');
      const memo = a.memo ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(a.memo)}</div>` : '';
      const when = a.created_at ? String(a.created_at).slice(0, 16).replace('T', ' ') : '';
      const isPdf = /\.pdf$/i.test(a.file_url || '') || String(a.original_name || '')
        .toLowerCase()
        .endsWith('.pdf');
      const open = isPdf
        ? `<a href="${escapeHtml(a.file_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="padding:4px 8px;font-size:11px">Abrir</a>`
        : `<button type="button" class="btn btn-sm btn-secondary vd-lightbox" data-vd-src="${escapeHtml(a.file_url)}" style="padding:4px 8px;font-size:11px">Ver</button>`;
      return `<li style="list-style:none;padding:10px 0;border-bottom:1px solid var(--border-color)">
        <strong style="font-size:13px">${name}</strong> <span style="font-size:10px;color:var(--text-muted)">${escapeHtml(when)}</span>
        ${memo}
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          ${open}
          <button type="button" class="btn btn-sm btn-danger" data-vd-del="${a.id}" data-vd-vendor="${vendorId}" style="padding:4px 8px;font-size:11px">Eliminar</button>
        </div>
      </li>`;
    })
    .join('');
  if (thumbs) {
    thumbs.innerHTML = items
      .filter((a) => /\.(png|jpe?g|gif|webp)$/i.test(a.file_url || a.original_name || ''))
      .map(
        (a) =>
          `<img class="vd-lightbox" src="${escapeHtml(a.file_url)}" alt="" data-vd-src="${escapeHtml(a.file_url)}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border-color)" />`
      )
      .join('');
  }
}

async function refreshVendorDrawerInvoices(vendorId) {
  const res = await fetch(`/api/vendors/${vendorId}/invoices`, { credentials: 'include' }).then((r) => r.json());
  const items = res.success ? res.data || [] : [];
  renderVendorDrawerInvoicesList(vendorId, items);
}

async function openVendorDrawer(id) {
  vendorDrawerVendorId = id;
  const v = vendorsCache.find((x) => x.id === id);
  document.getElementById('vendorDetailTitle').textContent = v ? v.name : 'Fornecedor';
  const body = document.getElementById('vendorDetailBody');
  body.innerHTML = '<p style="color:var(--text-muted)">A carregar…</p>';
  const vd = document.getElementById('vendorDetail');
  vd.hidden = false;
  vd.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => vd.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

  const [histRes, upRes, invRes] = await Promise.all([
    fetch(`/api/vendors/${id}/history`, { credentials: 'include' }).then((r) => r.json()),
    fetch(`/api/vendors/${id}/upcoming-payments?days=120`, { credentials: 'include' }).then((r) => r.json()),
    fetch(`/api/vendors/${id}/invoices`, { credentials: 'include' }).then((r) => r.json()),
  ]);

  const list = histRes.success ? histRes.data || [] : [];
  let sum = 0;
  const histHtml =
    '<ul style="list-style:none;padding:0;margin:0">' +
    (list.length
      ? list
          .map((r) => {
            sum += parseFloat(r.amount) || 0;
            const src = resolveExpenseReceiptUrl(r);
            const rec = receiptThumbOrLinkHtml(src);
            const delBtn =
              r.type === 'expense' && r.source_id
                ? `<button type="button" class="btn btn-sm btn-danger" data-vd-del-exp="${r.source_id}" style="padding:4px 8px;font-size:11px;margin-top:6px">Excluir despesa</button>`
                : '';
            return `<li style="padding:10px 0;border-bottom:1px solid var(--border-color);display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between">
        <div style="flex:1;min-width:140px">
          <span style="font-size:11px;color:var(--text-muted)">${escapeHtml(r.type)} · ${escapeHtml(String(r.date).slice(0, 10))}${r.status != null && r.status !== '' ? ` · ${escapeHtml(r.status)}` : ''}</span><br/>
          ${escapeHtml(r.description)} — <strong>${fmt$(r.amount)}</strong>
          ${delBtn}
        </div>
        <div style="flex-shrink:0;text-align:right">${rec}</div>
      </li>`;
          })
          .join('')
      : '<li style="color:var(--text-muted);list-style:none">Sem movimentos na amostra</li>') +
    `</ul><p style="margin-top:12px;font-weight:700;font-size:13px">Total (amostra): ${fmt$(sum)}</p>`;

  const upcoming = upRes.success ? upRes.data || [] : [];
  const payRows = upcoming.length
    ? upcoming
        .map((r) => {
          const tipo = r.kind === 'recurring' ? `Recorrente (${escapeHtml(r.recurrence_type || '')})` : 'Único';
          const atraso = r.overdue ? '<span style="background:#fde8e8;color:#a32020;font-size:10px;padding:2px 6px;border-radius:4px;margin-right:4px">Atrasado</span>' : '';
          return `<tr><td>${atraso}${escapeHtml(r.due_date)}</td><td>${escapeHtml(r.description)}</td><td>${fmt$(r.amount)}</td><td>${tipo}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="4" style="color:var(--text-muted)">Nenhum pagamento previsto (120 dias) ou atraso listado</td></tr>';

  const invItems = invRes.success ? invRes.data || [] : [];

  body.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;border-bottom:1px solid var(--border-color);padding-bottom:10px">
      <button type="button" class="btn btn-sm btn-secondary fin-vtab on" data-vtab="hist">Histórico</button>
      <button type="button" class="btn btn-sm btn-secondary fin-vtab" data-vtab="pay">Próximos pagamentos</button>
      <button type="button" class="btn btn-sm btn-secondary fin-vtab" data-vtab="files">Notas e ficheiros</button>
    </div>
    <div id="vd-pane-hist">${histHtml}</div>
    <div id="vd-pane-pay" style="display:none">
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">Custos operacionais ligados a este fornecedor (próximos 120 dias e pendentes atrasados).</p>
      <div class="fin-table-wrap" style="overflow-x:auto">
        <table class="fin-table" style="font-size:12px">
          <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Tipo</th></tr></thead>
          <tbody>${payRows}</tbody>
        </table>
      </div>
    </div>
    <div id="vd-pane-files" style="display:none">
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">Notas fiscais, PDFs ou imagens (até 20 MB).</p>
      <div style="border:1px dashed var(--border-color);border-radius:10px;padding:12px;margin-bottom:14px">
        <input type="text" id="vdMemo" class="fin-form-full" placeholder="Nota / descrição (opcional)" style="width:100%;padding:8px;margin-bottom:8px;border-radius:8px;border:1px solid var(--border-color);box-sizing:border-box" />
        <input type="file" id="vdFile" accept="image/*,.pdf,application/pdf" />
        <button type="button" class="btn btn-sm btn-primary" id="vdUploadBtn" style="margin-top:10px">Enviar ficheiro</button>
      </div>
      <p style="font-size:12px;font-weight:600;color:var(--sf-navy);margin:0 0 6px">Ficheiros guardados</p>
      <ul id="vdFileList" style="padding:0;margin:0"></ul>
      <div id="vdThumbs" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>
    </div>`;

  renderVendorDrawerInvoicesList(id, invItems);

  body.querySelectorAll('.fin-vtab').forEach((btn) => {
    btn.addEventListener('click', () => switchVendorDrawerTab(btn.getAttribute('data-vtab')));
  });
  document.getElementById('vdUploadBtn')?.addEventListener('click', () => vendorDrawerUploadFile());

  body.querySelectorAll('[data-vd-del-exp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const eid = parseInt(btn.getAttribute('data-vd-del-exp'), 10);
      if (eid) deleteExpenseById(eid, { refreshVendorDrawerId: id });
    });
  });
  body.querySelectorAll('#vd-pane-hist .fin-exp-receipt-lightbox').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const s = el.getAttribute('data-exp-lightbox');
      if (s) {
        document.getElementById('lightboxImg').src = s;
        document.getElementById('lightboxReceipt').classList.add('on');
      }
    });
  });
}

async function vendorDrawerUploadFile() {
  const vid = vendorDrawerVendorId;
  if (!vid) return;
  const input = document.getElementById('vdFile');
  const memoEl = document.getElementById('vdMemo');
  const memo = memoEl?.value?.trim() || '';
  if (!input?.files?.length) {
    showToast('Escolha um ficheiro', 'error');
    return;
  }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  if (memo) fd.append('memo', memo);
  const res = await fetch(`/api/vendors/${vid}/invoices`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  }).then((r) => r.json());
  if (res.success) {
    showToast('Ficheiro enviado');
    input.value = '';
    if (memoEl) memoEl.value = '';
    await refreshVendorDrawerInvoices(vid);
  } else showToast(res.error || 'Erro ao enviar', 'error');
}

async function loadPaymentReceipts() {
  const [pr, pend, proj] = await Promise.all([
    fetch('/api/payment-receipts', { credentials: 'include' }).then((r) => r.json()),
    fetch('/api/payment-receipts/pending-summary', { credentials: 'include' }).then((r) => r.json()),
    fetch('/api/projects?limit=100', { credentials: 'include' }).then((r) => r.json()),
  ]);

  const rows = pr.success ? pr.data || [] : [];
  document.getElementById('payrecv-body').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<tr>
      <td>${escapeHtml(r.project_label)}</td>
      <td>${escapeHtml(r.payment_type)}</td>
      <td>${fmt$(r.amount)}</td>
      <td>${escapeHtml(String(r.payment_date).slice(0, 10))}</td>
      <td>${escapeHtml(r.payment_method)}</td>
      <td>${escapeHtml(r.reference_number || '')}</td>
      <td><button type="button" class="btn btn-sm btn-secondary" data-edit-pr="${r.id}" style="padding:4px 8px;font-size:11px">Editar</button></td>
      <td><button type="button" class="btn btn-sm btn-secondary" data-del-pr="${r.id}" style="padding:4px 8px">✕</button></td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="8">Sem recebimentos</td></tr>';

  document.querySelectorAll('[data-edit-pr]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = parseInt(b.getAttribute('data-edit-pr'), 10);
      const row = rows.find((x) => x.id === id);
      if (row) openPaymentRecvModalForEdit(row);
    });
  });

  document.querySelectorAll('[data-del-pr]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Eliminar recebimento?')) return;
      await fetch(`/api/payment-receipts/${b.getAttribute('data-del-pr')}`, { method: 'DELETE', credentials: 'include' });
      loadPaymentReceipts();
      loadPL();
    });
  });

  const pendRows = pend.success ? pend.data || [] : [];
  document.getElementById('payrecv-pending').innerHTML = pendRows.length
    ? pendRows
        .map(
          (r) => `<div style="padding:8px 0;border-bottom:1px solid var(--border-color)">
      <strong>${escapeHtml(r.project_label)}</strong><br/>
      Contrato ${fmt$(r.contract_value)} · Recebido ${fmt$(r.received_total)} · <span style="color:#c9781a">Pendente ${fmt$(r.pending)}</span>
    </div>`
        )
        .join('')
    : '<span style="color:var(--text-muted)">Nenhum saldo pendente listado</span>';

  const projects = proj.success && proj.data ? proj.data : [];
  const sel = document.getElementById('pr-project');
  if (sel) {
    sel.innerHTML =
      '<option value="">— Projeto —</option>' +
      projects
        .map((p) => {
          const label = p.project_number || `PRJ-${p.id}`;
          return `<option value="${p.id}">${escapeHtml(label)}</option>`;
        })
        .join('');
  }

  const ex = await fetch('/api/expenses?limit=250', { credentials: 'include' }).then((r) => r.json());
  const exRows = ex.success ? ex.data || [] : [];
  const tbody = document.getElementById('expense-receipt-body');
  if (tbody) {
    tbody.innerHTML = exRows.length
      ? exRows
          .map((e) => {
            const src = resolveExpenseReceiptUrl(e);
            const vendor =
              e.vendor_name != null && String(e.vendor_name).trim() !== ''
                ? String(e.vendor_name).trim()
                : e.vendor != null && String(e.vendor).trim() !== ''
                  ? String(e.vendor).trim()
                  : '—';
            const recBlock = `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:200px">
          <span>${receiptThumbOrLinkHtml(src)}</span>
          <label class="btn btn-sm btn-secondary" for="fin-exp-rc-${e.id}" style="padding:4px 8px;font-size:10px;margin:0;cursor:pointer">Carregar</label>
          <input type="file" id="fin-exp-rc-${e.id}" class="fin-sr-only fin-exp-row-receipt" data-expense-id="${e.id}" accept="image/*,.pdf,application/pdf" />
        </div>`;
            return `<tr>
        <td>${escapeHtml(fmtOpDate(e.expense_date))}</td>
        <td>${escapeHtml(e.description || '')}</td>
        <td>${escapeHtml(vendor)}</td>
        <td>${fmt$(e.total_amount)}</td>
        <td>${escapeHtml(formatExpensePaymentMethod(e.payment_method))}</td>
        <td>${recBlock}</td>
        <td style="white-space:nowrap">
          <button type="button" class="btn btn-sm btn-secondary" data-edit-expense="${e.id}" style="padding:4px 8px;font-size:11px">Editar</button>
          <button type="button" class="btn btn-sm btn-danger" data-del-expense="${e.id}" style="padding:4px 8px;font-size:11px">Excluir</button>
        </td>
      </tr>`;
          })
          .join('')
      : '<tr><td colspan="7" style="color:var(--text-muted)">Sem despesas registadas</td></tr>';
    tbody.querySelectorAll('[data-edit-expense]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-edit-expense'), 10);
        openExpenseModalForEdit(id);
      });
    });
    tbody.querySelectorAll('[data-del-expense]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-del-expense'), 10);
        deleteExpenseById(id, {});
      });
    });
    tbody.querySelectorAll('.fin-exp-receipt-lightbox').forEach((el) => {
      el.addEventListener('click', (ev) => {
        ev.preventDefault();
        const s = el.getAttribute('data-exp-lightbox');
        if (s) {
          document.getElementById('lightboxImg').src = s;
          document.getElementById('lightboxReceipt').classList.add('on');
        }
      });
    });
  }
}

function openModal(id) {
  document.getElementById(id)?.classList.add('on');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('on');
  if (id === 'modalExpense') {
    editingExpenseId = null;
    removeExpenseReceiptOnSave = false;
  }
  if (id === 'modalPayRecv') editingPayRecvId = null;
}

async function openOpModal(id) {
  editingOpId = id || null;
  document.getElementById('op-is-rec').checked = false;
  document.getElementById('op-rec-type').style.display = 'none';
  document.getElementById('op-rec-day').style.display = 'none';
  document.getElementById('op-rec-end').style.display = 'none';
  if (id) {
    const res = await fetch(`/api/operational-costs/${id}`, { credentials: 'include' }).then((r) => r.json());
    const row = res.success ? res.data : null;
    if (row) {
      document.getElementById('op-cat').value = row.category;
      document.getElementById('op-sub').value = row.subcategory || '';
      document.getElementById('op-vendor-select').value = row.vendor_id || '';
      document.getElementById('op-desc').value = row.description;
      document.getElementById('op-amount').value = row.amount;
      document.getElementById('op-date').value = fmtOpDate(row.expense_date);
      document.getElementById('op-pay').value = row.payment_method || 'credit_card';
      document.getElementById('op-is-rec').checked = !!row.is_recurring;
      if (row.is_recurring) {
        document.getElementById('op-rec-type').style.display = 'block';
        document.getElementById('op-rec-day').style.display = 'block';
        document.getElementById('op-rec-end').style.display = 'block';
        document.getElementById('op-rec-type').value = row.recurrence_type || 'monthly';
        document.getElementById('op-rec-day').value = row.recurrence_day ?? '';
        document.getElementById('op-rec-end').value = row.recurrence_end_date ? String(row.recurrence_end_date).slice(0, 10) : '';
      }
    }
  } else {
    document.getElementById('op-desc').value = '';
    document.getElementById('op-amount').value = '';
    document.getElementById('op-date').value = formatLocalYMD(new Date());
  }
  openModal('modalOpCost');
}

document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/auth/session', { credentials: 'include' })
    .then((r) => r.json())
    .then((j) => {
      if (!j.authenticated) window.location.href = 'login.html';
    })
    .catch(() => {});

  document.querySelectorAll('.fin-tab').forEach((b) => {
    b.addEventListener('click', () => switchFinancialTab(b.dataset.tab));
  });

  document.getElementById('finPeriodType')?.addEventListener('change', (e) => {
    currentPeriod = e.target.value;
    document.getElementById('finCustomStart').value = '';
    document.getElementById('finCustomEnd').value = '';
    loadPL();
  });
  document.getElementById('btnFinApplyPeriod')?.addEventListener('click', () => loadPL());
  document.getElementById('btnImportMarketing')?.addEventListener('click', importMarketing);
  document.getElementById('btnAddExpense')?.addEventListener('click', async () => {
    editingExpenseId = null;
    removeExpenseReceiptOnSave = false;
    const titleEl = document.getElementById('modalExpenseTitle');
    if (titleEl) titleEl.textContent = 'Nova despesa';
    resetExpenseReceiptUI();
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-vendor-free').value = '';
    document.getElementById('exp-date').value = formatLocalYMD(new Date());
    const expPay = document.getElementById('exp-pay');
    if (expPay) expPay.value = 'cash_debit';
    await ensureExpenseVendorSelect();
    openModal('modalExpense');
  });

  document.getElementById('exp-receipt-file')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) uploadPendingExpenseReceipt(f);
  });
  document.getElementById('exp-receipt-camera')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) uploadPendingExpenseReceipt(f);
  });
  document.getElementById('exp-receipt-clear')?.addEventListener('click', () =>
    resetExpenseReceiptUI({ markRemovedOnEdit: true })
  );

  document.getElementById('btnSaveExpense')?.addEventListener('click', async () => {
    const vSel = document.getElementById('exp-vendor-select')?.value?.trim() || '';
    const vendorId = vSel && /^\d+$/.test(vSel) ? parseInt(vSel, 10) : null;
    const vendorFree = document.getElementById('exp-vendor-free')?.value?.trim() || null;
    const body = {
      category: document.getElementById('exp-cat').value,
      description: document.getElementById('exp-desc').value,
      amount: document.getElementById('exp-amount').value,
      expense_date: document.getElementById('exp-date').value,
      payment_method: document.getElementById('exp-pay')?.value || 'cash_debit',
      vendor_id: vendorId,
      vendor: vendorFree,
    };
    if (pendingExpenseReceipt) {
      body.receipt_url = pendingExpenseReceipt.receipt_url;
      body.receipt_file_path = pendingExpenseReceipt.receipt_file_path;
    } else if (editingExpenseId && removeExpenseReceiptOnSave) {
      body.receipt_url = null;
      body.receipt_file_path = null;
    }
    if (!body.description || !body.amount || !body.expense_date) {
      showToast('Preencha descrição, valor e data', 'error');
      return;
    }
    const url = editingExpenseId ? `/api/expenses/${editingExpenseId}` : '/api/expenses';
    const method = editingExpenseId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (res.success) {
      showToast(editingExpenseId ? 'Despesa atualizada' : 'Despesa criada');
      editingExpenseId = null;
      removeExpenseReceiptOnSave = false;
      resetExpenseReceiptUI();
      closeModal('modalExpense');
      loadPL();
      loadVendors();
      loadPaymentReceipts();
    } else showToast(res.error || 'Erro', 'error');
  });

  document.getElementById('btnPrevWeek')?.addEventListener('click', () => {
    const d = new Date(`${currentWeek}T12:00:00`);
    d.setDate(d.getDate() - 7);
    currentWeek = formatLocalYMD(d);
    loadWeeklyForecast(currentWeek);
  });
  document.getElementById('btnNextWeek')?.addEventListener('click', () => {
    const d = new Date(`${currentWeek}T12:00:00`);
    d.setDate(d.getDate() + 7);
    currentWeek = formatLocalYMD(d);
    loadWeeklyForecast(currentWeek);
  });

  document.getElementById('opToggleRecurring')?.addEventListener('change', () => loadOperationalCosts());
  document.getElementById('btnAddOpCost')?.addEventListener('click', () => openOpModal(null));
  document.getElementById('op-is-rec')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    document.getElementById('op-rec-type').style.display = on ? 'block' : 'none';
    document.getElementById('op-rec-day').style.display = on ? 'block' : 'none';
    document.getElementById('op-rec-end').style.display = on ? 'block' : 'none';
  });

  document.getElementById('btnSaveOpCost')?.addEventListener('click', async () => {
    const rec = document.getElementById('op-is-rec').checked;
    const desc = document.getElementById('op-desc').value.trim();
    const amtStr = document.getElementById('op-amount').value;
    const expDate = document.getElementById('op-date').value;
    const vSel = document.getElementById('op-vendor-select').value.trim();
    const vendorId = vSel && /^\d+$/.test(vSel) ? parseInt(vSel, 10) : null;

    if (!desc) {
      showToast('Preencha a descrição', 'error');
      return;
    }
    if (!expDate) {
      showToast('Preencha a data', 'error');
      return;
    }
    const amt = parseFloat(amtStr);
    if (!Number.isFinite(amt)) {
      showToast('Valor inválido', 'error');
      return;
    }

    const body = {
      category: document.getElementById('op-cat').value,
      subcategory: document.getElementById('op-sub').value.trim() || null,
      vendor_id: vendorId,
      description: desc,
      amount: amt,
      expense_date: expDate,
      payment_method: document.getElementById('op-pay').value,
      is_recurring: rec,
      recurrence_type: rec ? document.getElementById('op-rec-type').value : null,
      recurrence_day: rec ? document.getElementById('op-rec-day').value || null : null,
      recurrence_end_date: rec ? document.getElementById('op-rec-end').value || null : null,
      status: rec ? 'recurring' : 'pending',
    };
    const url = editingOpId ? `/api/operational-costs/${editingOpId}` : '/api/operational-costs';
    const method = editingOpId ? 'PUT' : 'POST';
    try {
      const raw = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let res = {};
      try {
        res = await raw.json();
      } catch (_) {}
      if (raw.ok && res.success) {
        showToast('Guardado');
        closeModal('modalOpCost');
        editingOpId = null;
        const recToggle = document.getElementById('opToggleRecurring');
        if (!rec && recToggle && recToggle.checked) recToggle.checked = false;
        loadOperationalCosts();
        loadPL();
      } else {
        showToast(res.error || res.message || `Erro ao guardar (${raw.status})`, 'error');
      }
    } catch (e) {
      showToast(e.message || 'Falha de rede ao guardar', 'error');
    }
  });

  document.getElementById('vendorSearch')?.addEventListener(
    'input',
    debounce(() => loadVendors(), 300)
  );
  document.getElementById('btnNewVendor')?.addEventListener('click', () => {
    editingVendorId = null;
    const titleEl = document.getElementById('modalVendorTitle');
    if (titleEl) titleEl.textContent = 'Novo fornecedor';
    ['v-name', 'v-contact', 'v-email', 'v-phone', 'v-web', 'v-addr', 'v-terms', 'v-tax', 'v-rating', 'v-notes'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    openModal('modalVendor');
  });
  document.getElementById('btnSaveVendor')?.addEventListener('click', async () => {
    const body = {
      name: document.getElementById('v-name').value,
      category: document.getElementById('v-cat').value,
      contact_name: document.getElementById('v-contact').value || null,
      contact_email: document.getElementById('v-email').value || null,
      contact_phone: document.getElementById('v-phone').value || null,
      website: document.getElementById('v-web').value || null,
      address: document.getElementById('v-addr').value || null,
      payment_terms: document.getElementById('v-terms').value || null,
      tax_id: document.getElementById('v-tax').value || null,
      rating: document.getElementById('v-rating').value || null,
      notes: document.getElementById('v-notes').value || null,
    };
    if (!body.name) {
      showToast('Nome obrigatório', 'error');
      return;
    }
    const url = editingVendorId ? `/api/vendors/${editingVendorId}` : '/api/vendors';
    const method = editingVendorId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (res.success) {
      showToast('Fornecedor guardado');
      closeModal('modalVendor');
      loadVendors();
    } else showToast(res.error || 'Erro', 'error');
  });

  document.getElementById('btnAddPaymentRecv')?.addEventListener('click', () => {
    editingPayRecvId = null;
    const t = document.getElementById('modalPayRecvTitle');
    if (t) t.textContent = 'Recebimento';
    document.getElementById('pr-date').value = formatLocalYMD(new Date());
    document.getElementById('pr-amount').value = '';
    document.getElementById('pr-ref').value = '';
    openModal('modalPayRecv');
  });
  document.getElementById('btnSavePayRecv')?.addEventListener('click', async () => {
    const body = {
      project_id: document.getElementById('pr-project').value,
      payment_type: document.getElementById('pr-type').value,
      amount: document.getElementById('pr-amount').value,
      payment_date: document.getElementById('pr-date').value,
      payment_method: document.getElementById('pr-method').value,
      reference_number: document.getElementById('pr-ref').value || null,
    };
    if (!body.project_id || !body.amount || !body.payment_date) {
      showToast('Projeto, valor e data obrigatórios', 'error');
      return;
    }
    const url = editingPayRecvId ? `/api/payment-receipts/${editingPayRecvId}` : '/api/payment-receipts';
    const method = editingPayRecvId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (res.success) {
      showToast(editingPayRecvId ? 'Recebimento atualizado' : 'Recebimento registado');
      editingPayRecvId = null;
      closeModal('modalPayRecv');
      loadPaymentReceipts();
      loadPL();
    } else showToast(res.error || 'Erro', 'error');
  });

  document.getElementById('pane-receipts')?.addEventListener('change', async (ev) => {
    const inp = ev.target.closest?.('.fin-exp-row-receipt');
    if (!inp || !inp.files?.length) return;
    const eid = parseInt(inp.getAttribute('data-expense-id'), 10);
    if (!eid) return;
    const file = inp.files[0];
    const form = new FormData();
    form.append('file', file);
    try {
      const raw = await fetch(`/api/expenses/${eid}/receipt`, { method: 'POST', credentials: 'include', body: form });
      let j = {};
      try {
        j = await raw.json();
      } catch (_) {}
      if (!raw.ok || !j.success) {
        showToast(j.error || `Erro ao enviar recibo (${raw.status})`, 'error');
        return;
      }
      showToast('Recibo anexado');
      loadPaymentReceipts();
      loadVendors();
      loadPL();
    } catch (e) {
      showToast(e.message || 'Falha de rede', 'error');
    } finally {
      inp.value = '';
    }
  });

  document.getElementById('vendorDetailBack')?.addEventListener('click', () => closeVendorDrawer());

  document.getElementById('vendorDetail')?.addEventListener('click', async (e) => {
    const lb = e.target.closest?.('.vd-lightbox');
    if (lb) {
      const src = lb.getAttribute('data-vd-src');
      if (src) {
        document.getElementById('lightboxImg').src = src;
        document.getElementById('lightboxReceipt').classList.add('on');
      }
      e.preventDefault();
      return;
    }
    const del = e.target.closest?.('[data-vd-del]');
    if (del) {
      if (!confirm('Eliminar este ficheiro?')) return;
      const attId = del.getAttribute('data-vd-del');
      const vid = parseInt(del.getAttribute('data-vd-vendor'), 10);
      if (!attId || !vid) return;
      const res = await fetch(`/api/vendors/${vid}/invoices/${attId}`, {
        method: 'DELETE',
        credentials: 'include',
      }).then((r) => r.json());
      if (res.success) {
        showToast('Ficheiro eliminado');
        await refreshVendorDrawerInvoices(vid);
      } else showToast(res.error || 'Erro', 'error');
    }
  });

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.getAttribute('data-close')));
  });

  const mt = document.getElementById('mobileMenuToggle');
  const sb = document.getElementById('finSidebar');
  const ov = document.getElementById('mobileOverlay');
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const lbEl = document.getElementById('lightboxReceipt');
    if (lbEl?.classList.contains('on')) {
      closeModal('lightboxReceipt');
      return;
    }
    const vd = document.getElementById('vendorDetail');
    if (vd && !vd.hidden) closeVendorDrawer();
  });

  if (mt && sb && ov) {
    mt.addEventListener('click', () => {
      const open = sb.classList.toggle('mobile-open');
      ov.classList.toggle('active', open);
      mt.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    ov.addEventListener('click', () => {
      sb.classList.remove('mobile-open');
      ov.classList.remove('active');
    });
  }

  currentWeek = getMonday(new Date());
  loadPL();
  loadWeeklyForecast(currentWeek);
  loadVendors();

  function applyFinancialHash() {
    const raw = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (!raw) return;
    if (raw === 'vendors') {
      switchFinancialTab('vendors');
      return;
    }
    if (
      raw === 'receipts' ||
      raw === 'recebimentos' ||
      raw === 'notas-recibos' ||
      raw === 'recibos'
    ) {
      switchFinancialTab('receipts');
      let scrollId = null;
      if (raw === 'recebimentos') scrollId = 'fin-section-recebimentos';
      else if (raw === 'notas-recibos' || raw === 'recibos') scrollId = 'fin-section-notas-recibos';
      if (scrollId) {
        requestAnimationFrame(() =>
          document.getElementById(scrollId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        );
      }
    }
  }
  applyFinancialHash();
  window.addEventListener('hashchange', applyFinancialHash);
});

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
