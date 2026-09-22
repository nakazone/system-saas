/**
 * Marketing analytics page (dashboard.html #marketingPage)
 */
let marketingCharts = {};

function marketingDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtNum(n, d) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(d != null ? d : 2);
}

function marketingQueryString() {
  const start = document.getElementById('mktDateStart')?.value || marketingDefaultDates().start;
  const end = document.getElementById('mktDateEnd')?.value || marketingDefaultDates().end;
  const utm = (document.getElementById('mktUtmCampaign')?.value || '').trim();
  const plat = (document.getElementById('mktPlatform')?.value || '').trim();
  const src = (document.getElementById('mktSource')?.value || '').trim();
  const p = new URLSearchParams({ start_date: start, end_date: end });
  if (utm) p.set('utm_campaign', utm);
  if (plat) p.set('marketing_platform', plat);
  if (src) p.set('source', src);
  return p.toString();
}

function destroyMarketingCharts() {
  Object.values(marketingCharts).forEach((c) => {
    try {
      c.destroy();
    } catch (e) {}
  });
  marketingCharts = {};
}

async function loadMarketingDashboard() {
  const errEl = document.getElementById('mktError');
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }

  const qs = marketingQueryString();
  try {
    const r = await fetch(`/api/marketing/metrics?${qs}`, { credentials: 'include' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'Falha ao carregar métricas');

    const { kpis, funnel, leads_over_time, revenue_over_time, revenue_by_campaign, period, filters } = j.data;

    const kpiGrid = document.getElementById('mktKpiGrid');
    if (kpiGrid) {
      kpiGrid.innerHTML = `
        <div class="stat-card"><div class="stat-label">Spend (ads)</div><div class="stat-value">${fmtMoney(kpis.total_spend)}</div></div>
        <div class="stat-card"><div class="stat-label">Leads</div><div class="stat-value">${kpis.total_leads}</div></div>
        <div class="stat-card"><div class="stat-label">CPL</div><div class="stat-value">${kpis.cpl != null ? fmtMoney(kpis.cpl) : '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Quotes</div><div class="stat-value">${kpis.total_quotes}</div></div>
        <div class="stat-card"><div class="stat-label">Quotes enviados</div><div class="stat-value">${kpis.quotes_sent}</div></div>
        <div class="stat-card"><div class="stat-label">Deals</div><div class="stat-value">${kpis.total_deals}</div></div>
        <div class="stat-card"><div class="stat-label">Receita</div><div class="stat-value">${fmtMoney(kpis.total_revenue)}</div></div>
        <div class="stat-card"><div class="stat-label">ROI</div><div class="stat-value">${kpis.roi != null ? fmtNum(kpis.roi, 2) + '×' : '—'}</div></div>
        <div class="stat-card"><div class="stat-label">CAC</div><div class="stat-value">${kpis.cac != null ? fmtMoney(kpis.cac) : '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Ticket médio</div><div class="stat-value">${fmtMoney(kpis.avg_deal_value)}</div></div>
        <div class="stat-card"><div class="stat-label">RPL</div><div class="stat-value">${kpis.revenue_per_lead != null ? fmtMoney(kpis.revenue_per_lead) : '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Lead → fechamento</div><div class="stat-value">${kpis.lead_to_close_rate != null ? fmtNum(kpis.lead_to_close_rate * 100, 1) + '%' : '—'}</div></div>
      `;
    }

    document.getElementById('mktPeriodLabel').textContent = `${period.start} → ${period.end}`;

    destroyMarketingCharts();

    if (typeof Chart !== 'undefined') {
      const lt = document.getElementById('mktChartLeadsTime');
      if (lt && leads_over_time?.length >= 0) {
        marketingCharts.leadsTime = new Chart(lt, {
          type: 'line',
          data: {
            labels: leads_over_time.map((x) => x.d),
            datasets: [{ label: 'Leads', data: leads_over_time.map((x) => x.c), borderColor: '#3498db', tension: 0.2 }],
          },
          options: { responsive: true, plugins: { legend: { display: false } } },
        });
      }
      const rt = document.getElementById('mktChartRevenueTime');
      if (rt && revenue_over_time) {
        marketingCharts.revTime = new Chart(rt, {
          type: 'line',
          data: {
            labels: revenue_over_time.map((x) => x.d),
            datasets: [{ label: 'Receita', data: revenue_over_time.map((x) => Number(x.rev) || 0), borderColor: '#27ae60', tension: 0.2 }],
          },
          options: { responsive: true, plugins: { legend: { display: false } } },
        });
      }
      const fn = document.getElementById('mktChartFunnel');
      if (fn && funnel) {
        marketingCharts.funnel = new Chart(fn, {
          type: 'bar',
          data: {
            labels: funnel.map((x) => x.stage),
            datasets: [{ label: 'Leads', data: funnel.map((x) => x.count), backgroundColor: '#9b59b6' }],
          },
          options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } },
        });
      }
      const rc = document.getElementById('mktChartRevCampaign');
      if (rc && revenue_by_campaign?.length) {
        marketingCharts.revCamp = new Chart(rc, {
          type: 'bar',
          data: {
            labels: revenue_by_campaign.map((x) => String(x.campaign).slice(0, 24)),
            datasets: [{ label: 'Receita', data: revenue_by_campaign.map((x) => Number(x.revenue) || 0), backgroundColor: '#e67e22' }],
          },
          options: { responsive: true, plugins: { legend: { display: false } } },
        });
      }
    }

    const tbl = document.getElementById('mktRevByCampaignBody');
    if (tbl) {
      tbl.innerHTML = (revenue_by_campaign || [])
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.campaign)}</td><td>${row.deals}</td><td>${fmtMoney(row.revenue)}</td></tr>`
        )
        .join('');
    }

    await loadMarketingAdSpend();
    await refreshMarketingUrgentBanner();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message || String(e);
      errEl.style.display = 'block';
    }
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function loadMarketingAdSpend() {
  const qs = marketingQueryString();
  const r = await fetch(`/api/marketing/ad-spend?${qs}`, { credentials: 'include' });
  const j = await r.json();
  const tbody = document.getElementById('mktAdSpendBody');
  if (!tbody || !j.success) return;
  tbody.innerHTML = (j.data || [])
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.spend_date || row.period_end || row.period_start || '—')}</td>
      <td>${escapeHtml(row.platform)}</td>
      <td>${escapeHtml(row.campaign_name)}</td>
      <td>${escapeHtml(row.utm_campaign || '')}</td>
      <td>${fmtMoney(row.spend)}</td>
      <td><button type="button" class="btn btn-sm" onclick="deleteAdSpendRow(${row.id})">Excluir</button></td>
    </tr>`
    )
    .join('');
  const sumEl = document.getElementById('mktAdSpendSum');
  if (sumEl) sumEl.textContent = fmtMoney(j.period_spend || 0);
}

async function deleteAdSpendRow(id) {
  if (!confirm('Excluir esta linha de spend?')) return;
  await fetch(`/api/marketing/ad-spend/${id}`, { method: 'DELETE', credentials: 'include' });
  loadMarketingAdSpend();
  loadMarketingDashboard();
}

async function submitAdSpend(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    platform: fd.get('platform'),
    campaign_name: fd.get('campaign_name'),
    utm_campaign: fd.get('utm_campaign') || null,
    spend: Number.parseFloat(String(fd.get('spend') || '0')) || 0,
    spend_date: fd.get('spend_date'),
    notes: fd.get('notes') || null,
  };
  const r = await fetch('/api/marketing/ad-spend', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) {
    if (typeof crmNotify === 'function') crmNotify(j.error || 'Erro ao salvar', 'error');
    else alert(j.error || 'Erro ao salvar');
    return;
  }
  e.target.reset();
  loadMarketingAdSpend();
  loadMarketingDashboard();
}

function exportMarketingLeadsCsv() {
  const qs = marketingQueryString();
  window.location.assign(`/api/marketing/export/leads?${qs}`);
}

/** Um único aviso na página Marketing (evita dezenas de toasts/notificações ao abrir o separador). */
async function refreshMarketingUrgentBanner() {
  const banner = document.getElementById('mktUrgentBanner');
  if (!banner) return;
  try {
    const r = await fetch('/api/marketing/alerts/not-contacted', { credentials: 'include' });
    const j = await r.json();
    if (!j.success || !j.count) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }
    const n = j.count;
    const leads = j.data || [];
    const sample = leads
      .slice(0, 3)
      .map((l) => escapeHtml(l.name || 'Lead'))
      .join(', ');
    const more = n > 3 ? ` e mais ${n - 3}` : '';
    banner.innerHTML =
      '<div class="mkt-urgent-banner-inner">' +
      '<span class="mkt-urgent-banner-icon" aria-hidden="true">⏱</span>' +
      '<div class="mkt-urgent-banner-text">' +
      `<strong>${n} lead(s) sem contacto</strong> há mais de 5 minutos.` +
      (sample ? `<span class="mkt-urgent-banner-names"> Ex.: ${sample}${more}.</span>` : '') +
      '</div>' +
      '<button type="button" class="btn btn-secondary" onclick="showPage(\'leads\')">Ver leads</button>' +
      '</div>';
    banner.style.display = 'block';
  } catch (e) {
    banner.style.display = 'none';
    banner.innerHTML = '';
  }
}

function initMarketingPage() {
  const { start, end } = marketingDefaultDates();
  const ds = document.getElementById('mktDateStart');
  const de = document.getElementById('mktDateEnd');
  if (ds && !ds.value) ds.value = start;
  if (de && !de.value) de.value = end;
  const sd = document.getElementById('mktSpendDate');
  if (sd && !sd.value) sd.value = end;
}

window.loadMarketingDashboard = loadMarketingDashboard;
window.submitAdSpend = submitAdSpend;
window.deleteAdSpendRow = deleteAdSpendRow;
window.exportMarketingLeadsCsv = exportMarketingLeadsCsv;
window.initMarketingPage = initMarketingPage;
