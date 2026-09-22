/**
 * Marketing module — Senior Floors CRM (vanilla JS)
 */
const state = {
  period: 'month',
  stats: null,
  campaigns: [],
  filteredCampaigns: [],
  currentPage: 1,
  pageSize: 10,
  filterPlatform: 'all',
  filterSearch: '',
  importStep: 1,
  importPlatform: null,
  importFile: null,
  importRowsEstimate: 0,
};

const fmt$ = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
const fmtN = (v) => new Intl.NumberFormat('en-US').format(v || 0);
const fmtPct = (v) => `${(+v || 0).toFixed(1)}%`;
const fmtX = (v) => `${(+v || 0).toFixed(2)}x`;
const safeDivide = (a, b) => (b > 0 ? a / b : 0);

function kpiStatus(metric, value) {
  const v = +value || 0;
  if (metric === 'cpl') {
    if (v <= 30) return { label: 'Ótimo', cls: 'success' };
    if (v <= 60) return { label: 'Ok', cls: 'warning' };
    return { label: 'Alto', cls: 'danger' };
  }
  if (metric === 'cpa') {
    if (v <= 150) return { label: 'Ótimo', cls: 'success' };
    if (v <= 300) return { label: 'Ok', cls: 'warning' };
    return { label: 'Alto', cls: 'danger' };
  }
  if (metric === 'roas') {
    if (v >= 3) return { label: 'Ótimo', cls: 'success' };
    if (v >= 1) return { label: 'Ok', cls: 'warning' };
    return { label: 'Baixo', cls: 'danger' };
  }
  return { label: '', cls: '' };
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'mk-toast ' + (type === 'danger' ? 'danger' : 'success');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showSkeletons() {
  document.querySelectorAll('[data-skeleton]').forEach((el) => el.classList.add('skeleton'));
}
function hideSkeletons() {
  document.querySelectorAll('[data-skeleton]').forEach((el) => el.classList.remove('skeleton'));
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function platformLabel(p) {
  const m = {
    google_ads: 'Google Ads',
    meta: 'Meta',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    other: 'Outras',
  };
  return m[p] || p;
}

function platformEmoji(p) {
  const m = { google_ads: '🔍', meta: '📘', instagram: '📸', tiktok: '🎵', other: '📎' };
  return m[p] || '📎';
}

function platformPillClass(p) {
  if (p === 'google_ads') return 'p-google';
  if (p === 'meta') return 'p-meta';
  if (p === 'instagram') return 'p-insta';
  if (p === 'tiktok') return 'p-tiktok';
  return 'p-other';
}

function sourceColorClass(src) {
  const l = String(src || '').toLowerCase();
  if (l.includes('google')) return '#3b82f6';
  if (l.includes('facebook') || l.includes('meta') || l.includes('fb')) return '#6366f1';
  if (l.includes('instagram') || l.includes('ig')) return '#ec4899';
  if (l.includes('direct') || l.includes('none') || l.includes('unknown')) return '#94a3b8';
  return '#0ea5e9';
}

async function checkAuth() {
  try {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    const j = await r.json();
    if (!j.authenticated) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  } catch (_) {
    window.location.href = 'login.html';
    return false;
  }
}

async function loadStats(period = state.period) {
  showSkeletons();
  const banner = document.getElementById('mkSetupBanner');
  if (banner) {
    banner.hidden = true;
    banner.textContent = '';
  }
  try {
    const res = await fetch(`/api/marketing/stats?period=${encodeURIComponent(period)}`, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = 'login.html';
      return;
    }
    if (res.status === 403) {
      showToast('Sem permissão (reports.view). Peça a um admin acesso a relatórios.', 'danger');
      return;
    }
    if (!res.ok) {
      showToast(data.error || data.message || `Erro ${res.status}`, 'danger');
      return;
    }
    state.stats = data;
    if (data.setup_required && data.setup_message && banner) {
      banner.textContent = data.setup_message;
      banner.hidden = false;
    }
    renderGoalsBar(state.stats.goals);
    renderKPIs(state.stats);
    renderPlatformCards(state.stats.by_platform, state.stats.summary?.total_spend || 0);
    renderLeadSources(state.stats.leads_by_source || []);
    renderTrend(state.stats.monthly_trend || []);
  } catch (e) {
    showToast('Erro ao carregar dados de marketing', 'danger');
  } finally {
    hideSkeletons();
  }
}

async function loadAdSpend() {
  try {
    const res = await fetch('/api/marketing/ad-spend?limit=500', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      state.campaigns = [];
      applyFilters();
      return;
    }
    state.campaigns = data.data || [];
    applyFilters();
  } catch (_) {
    state.campaigns = [];
    applyFilters();
  }
}

function renderGoalsBar(g) {
  const bar = document.getElementById('mkGoalsBar');
  const empty = document.getElementById('mkGoalsEmpty');
  if (!bar || !empty) return;
  if (!g || !g.exists) {
    bar.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  bar.style.display = 'grid';
  const pct = (cur, max) => (max > 0 ? Math.min(100, safeDivide(cur, max) * 100) : 0);
  const bPct = g.budget_limit > 0 ? pct(g.budget_used, g.budget_limit) : 0;
  const lPct = g.goal_leads > 0 ? pct(g.leads_current, g.goal_leads) : 0;
  bar.innerHTML = `
    <div class="mk-goal-item">
      <div class="mk-goal-item__label">Budget</div>
      <div class="mk-goal-item__val">${fmt$(g.budget_used)} / ${g.budget_limit != null ? fmt$(g.budget_limit) : '—'}</div>
      <div class="mk-mini-bar"><span style="width:${bPct}%"></span></div>
      <span class="mk-badge mk-badge--ok">${g.budget_pct != null ? g.budget_pct.toFixed(0) + '%' : '—'}</span>
    </div>
    <div class="mk-goal-item">
      <div class="mk-goal-item__label">Leads</div>
      <div class="mk-goal-item__val">${fmtN(g.leads_current)} / ${g.goal_leads != null ? fmtN(g.goal_leads) : '—'}</div>
      <div class="mk-mini-bar"><span style="width:${lPct}%"></span></div>
      <span class="mk-badge mk-badge--${g.leads_pct > 100 ? 'warning' : 'ok'}">${g.leads_pct != null ? g.leads_pct.toFixed(0) + '%' : '—'}</span>
    </div>
    <div class="mk-goal-item">
      <div class="mk-goal-item__label">CPL</div>
      <div class="mk-goal-item__val">${fmt$(g.cpl_current)} ${g.goal_cpl_max != null ? '/ max ' + fmt$(g.goal_cpl_max) : ''}</div>
      <div class="mk-mini-bar"><span style="width:100%;background:${g.cpl_status === 'danger' ? '#ef4444' : g.cpl_status === 'warning' ? '#f59e0b' : '#22c55e'}"></span></div>
      <span class="mk-badge mk-badge--${g.cpl_status === 'ok' ? 'ok' : g.cpl_status === 'warning' ? 'warning' : 'danger'}">${g.cpl_status === 'ok' ? 'OK' : 'ATENÇÃO ⚠'}</span>
    </div>
    <div class="mk-goal-item">
      <div class="mk-goal-item__label">ROAS</div>
      <div class="mk-goal-item__val">${fmtX(g.roas_current)}x ${g.goal_roas_min != null ? '/ min ' + fmtX(g.goal_roas_min) + 'x' : ''}</div>
      <div class="mk-mini-bar"><span style="width:100%;background:${g.roas_status === 'danger' ? '#ef4444' : g.roas_status === 'warning' ? '#f59e0b' : '#22c55e'}"></span></div>
      <span class="mk-badge mk-badge--${g.roas_status === 'ok' ? 'ok' : g.roas_status === 'warning' ? 'warning' : 'danger'}">${g.roas_status === 'ok' ? 'OK' : 'ATENÇÃO ⚠'}</span>
    </div>
  `;
}

function renderKPIs(s) {
  const sum = s.summary || {};
  const k = s.kpis || {};
  document.getElementById('kpiSpend').textContent = fmt$(sum.total_spend);
  document.getElementById('kpiCpc').textContent = fmt$(k.cpc);
  document.getElementById('kpiCpcSub').textContent = `${fmtN(sum.total_clicks)} cliques`;
  document.getElementById('kpiCpl').textContent = fmt$(k.cpl);
  document.getElementById('kpiCplSub').textContent = `${fmtN(sum.total_leads)} leads CRM · ${fmtN(sum.total_conversions)} conv. ads`;
  document.getElementById('kpiCpa').textContent = fmt$(k.cpa);
  document.getElementById('kpiCpaSub').textContent = `${fmtN(sum.closed_won_count)} fechamentos`;
  document.getElementById('kpiRoas').textContent = fmtX(k.roas);
  document.getElementById('kpiCtr').textContent = fmtPct(k.ctr);
  document.getElementById('kpiCtrSub').textContent = `${fmtN(sum.total_impressions)} impressões`;
  document.getElementById('kpiConv').textContent = fmtPct(k.conversion_rate);
  document.getElementById('kpiRev').textContent = fmt$(sum.total_revenue_attributed);

  const setBadge = (id, metric, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const st = kpiStatus(metric, val);
    if (!st.cls) {
      el.textContent = '';
      return;
    }
    el.className = 'mk-kpi-badge ' + st.cls;
    el.textContent = st.label;
  };
  setBadge('kpiCplBadge', 'cpl', k.cpl);
  setBadge('kpiCpaBadge', 'cpa', k.cpa);
  setBadge('kpiRoasBadge', 'roas', k.roas);

  const roasCard = document.querySelector('#kpiRoas')?.closest('.mk-kpi-card');
  if (roasCard) {
    const ro = +k.roas || 0;
    roasCard.style.borderLeftColor = ro >= 3 ? '#22c55e' : ro >= 1 ? '#f59e0b' : '#ef4444';
  }
}

function renderPlatformCards(platforms, totalSpend) {
  const el = document.getElementById('mkPlatformSection');
  if (!el) return;
  const list = platforms && platforms.length ? platforms : [];
  if (!list.length) {
    el.innerHTML = '<p class="mk-kpi-card__sub">Sem dados de plataforma no período.</p>';
    return;
  }
  el.innerHTML = list
    .map((p) => {
      const share =
        p.spend_share != null && p.spend_share !== ''
          ? +p.spend_share
          : totalSpend > 0
            ? safeDivide(p.spend, totalSpend) * 100
            : 0;
      const eff = (p.roas || 0) >= 2 && (p.cpl || 0) <= 60;
      return `<div class="mk-plat-card ${state.filterPlatform === p.platform ? 'mk-plat-card--sel' : ''}" data-plat="${escapeHtml(p.platform)}">
        <div class="mk-plat-card__head"><span>${platformEmoji(p.platform)} ${escapeHtml(p.label || platformLabel(p.platform))}</span>
        <span class="mk-badge mk-badge--${eff ? 'ok' : 'warning'}">${eff ? 'Eficiente ✓' : 'Atenção ⚠'}</span></div>
        <div class="mk-plat-metrics">
          <div><span>Spend</span>${fmt$(p.spend)}</div>
          <div><span>Leads (conv.)</span>${fmtN(p.platform_leads ?? p.conversions)}</div>
          <div><span>CPC</span>${fmt$(p.cpc)}</div>
          <div><span>CPL</span>${fmt$(p.cpl)}</div>
        </div>
        <div class="mk-mini-bar" style="margin-top:0.5rem"><span style="width:${share}%"></span></div>
        <div class="mk-kpi-card__sub" style="margin-top:0.35rem">ROAS: <span class="${(p.roas || 0) >= 2 ? 'roas-good' : (p.roas || 0) >= 1 ? 'roas-mid' : 'roas-bad'}">${fmtX(p.roas)}x</span> · ${share.toFixed(0)}% do gasto</div>
      </div>`;
    })
    .join('');
  el.querySelectorAll('.mk-plat-card').forEach((card) => {
    card.addEventListener('click', () => {
      const pl = card.getAttribute('data-plat');
      state.filterPlatform = pl;
      document.getElementById('mkFilterPlat').value = pl;
      applyFilters();
      document.getElementById('mkTableSection')?.scrollIntoView({ behavior: 'smooth' });
      renderPlatformCards(state.stats?.by_platform || [], state.stats?.summary?.total_spend || 0);
    });
  });
}

function renderLeadSources(rows) {
  const host = document.getElementById('mkSourcesBars');
  if (!host) return;
  const total = rows.reduce((s, r) => s + (+r.count || 0), 0);
  let top = rows.slice(0, 8);
  let otherSum = 0;
  if (rows.length > 8) {
    otherSum = rows.slice(8).reduce((s, r) => s + (+r.count || 0), 0);
    top = rows.slice(0, 8);
    if (otherSum > 0) top = top.concat([{ source: 'Outros', count: otherSum }]);
  }
  const maxC = Math.max(...top.map((r) => +r.count || 0), 1);
  host.innerHTML = top
    .map((r) => {
      const c = +r.count || 0;
      const pct = r.percentage != null && r.percentage !== '' ? +r.percentage : total > 0 ? (c / total) * 100 : 0;
      const w = (c / maxC) * 100;
      const col = sourceColorClass(r.source);
      return `<div class="mk-bar-row" title="${escapeHtml(r.source)}: ${c}">
        <div class="mk-bar-row__top"><span>${escapeHtml(r.source)}</span><span>${fmtN(c)} (${pct.toFixed(1)}%)</span></div>
        <div class="mk-bar-track"><div class="mk-bar-fill" style="width:${w}%;background:${col}"></div></div>
      </div>`;
    })
    .join('');
}

function renderTrend(rows) {
  const tb = document.querySelector('#mkTrendTable tbody');
  const tf = document.querySelector('#mkTrendTable tfoot');
  if (!tb || !tf) return;
  let ts = 0,
    tl = 0,
    tr = 0;
  tb.innerHTML = rows
    .map((r, i) => {
      ts += +r.spend || 0;
      tl += +r.leads || 0;
      tr += +r.revenue || 0;
      const ro = +r.roas || 0;
      const rc = ro >= 2 ? 'roas-good' : ro >= 1 ? 'roas-mid' : 'roas-bad';
      const bold = i === rows.length - 1 ? 'font-weight:700' : '';
      return `<tr style="${bold}"><td>${escapeHtml(r.month_label || r.month)}</td><td>${fmt$(r.spend)}</td><td>${fmtN(r.leads)}</td><td>${fmt$(r.cpl)}</td><td>${fmt$(r.revenue)}</td><td class="${rc}">${fmtX(r.roas)}x</td></tr>`;
    })
    .join('');
  const avgRoas = ts > 0 ? tr / ts : 0;
  tf.innerHTML = `<tr><td>Totais</td><td>${fmt$(ts)}</td><td>${fmtN(tl)}</td><td>—</td><td>${fmt$(tr)}</td><td class="${avgRoas >= 2 ? 'roas-good' : avgRoas >= 1 ? 'roas-mid' : 'roas-bad'}">${fmtX(avgRoas)}x</td></tr>`;
}

function applyFilters() {
  const q = state.filterSearch.toLowerCase();
  state.filteredCampaigns = state.campaigns.filter((c) => {
    const name = String(c.campaign_name || '').toLowerCase();
    const matchSearch = !q || name.includes(q);
    const matchPlatform = state.filterPlatform === 'all' || c.platform === state.filterPlatform;
    return matchSearch && matchPlatform;
  });
  state.currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('mkSpendBody');
  const info = document.getElementById('mkPageInfo');
  if (!tbody) return;
  const start = (state.currentPage - 1) * state.pageSize;
  const page = state.filteredCampaigns.slice(start, start + state.pageSize);
  const totalP = Math.max(1, Math.ceil(state.filteredCampaigns.length / state.pageSize));
  tbody.innerHTML = page
    .map((row) => {
      const conv = +row.conversions || 0;
      const sp = +row.spend || 0;
      const cpl = conv > 0 ? sp / conv : null;
      const p0 = row.period_start || row.spend_date || '—';
      const p1 = row.period_end || row.spend_date || '—';
      return `<tr>
        <td><span class="mk-plat-pill ${platformPillClass(row.platform)}">${escapeHtml(platformLabel(row.platform))}</span></td>
        <td class="mk-cell-campaign">${escapeHtml(row.campaign_name)}</td>
        <td class="mk-cell-period">${escapeHtml(p0)} → ${escapeHtml(p1)}</td>
        <td class="mk-num">${fmt$(row.spend)}</td>
        <td class="mk-num">${fmtN(row.clicks)}</td>
        <td class="mk-num">${fmtN(row.impressions)}</td>
        <td class="mk-num">${fmtN(row.conversions)}</td>
        <td class="mk-num">${cpl != null ? fmt$(cpl) : '—'}</td>
        <td class="mk-actions-col">
          <div class="mk-row-actions">
            <button type="button" class="mk-icon-btn" data-edit="${row.id}" title="Editar">✏️</button>
            <button type="button" class="mk-icon-btn mk-icon-btn--danger" data-del="${row.id}" title="Eliminar">🗑️</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
  if (info) info.textContent = `Página ${state.currentPage} de ${totalP} (${state.filteredCampaigns.length} registos)`;
  tbody.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const raw = b.getAttribute('data-edit');
      const nid = raw != null && raw !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(nid) || nid <= 0) return;
      openEditModal(nid);
    })
  );
  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const raw = b.getAttribute('data-del');
      const nid = raw != null && raw !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(nid) || nid <= 0) return;
      deleteRow(nid);
    })
  );
}

async function deleteRow(id) {
  if (!confirm('Eliminar este registo? (arquivo)')) return;
  const r = await fetch(`/api/marketing/ad-spend/${id}`, { method: 'DELETE', credentials: 'include' });
  const j = await r.json();
  if (!j.success) {
    showToast(j.error || 'Erro', 'danger');
    return;
  }
  showToast('Registo removido');
  loadAdSpend();
  loadStats(state.period);
}

function bindPeriodSelector() {
  document.querySelectorAll('.mk-pill[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mk-pill[data-period]').forEach((b) => b.classList.remove('mk-pill--active'));
      btn.classList.add('mk-pill--active');
      state.period = btn.getAttribute('data-period');
      loadStats(state.period);
    });
  });
}

function previewCSV(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const rows = lines.slice(1, 4).map((l) => l.split(',').map((c) => c.trim().replace(/"/g, '')));
  return { headers, rows };
}

function initImportModal() {
  const modal = document.getElementById('modalImport');
  const hints = {
    google_ads: 'Google Ads: Relatórios → Tabelas → Campanhas → Download CSV',
    meta: 'Meta: Ads Manager → Exportar → CSV (Campaign, Spend, Clicks, Impressions, Results)',
    instagram: 'Instagram: mesmo export do Meta Ads Manager',
    tiktok: 'TikTok Ads Manager → Relatórios → Download',
  };
  document.getElementById('btnImport')?.addEventListener('click', () => {
    state.importStep = 1;
    state.importPlatform = null;
    state.importFile = null;
    modal.hidden = false;
    showImportStep(1);
  });
  document.querySelectorAll('#importStep1 [data-plat]').forEach((b) => {
    b.addEventListener('click', () => {
      state.importPlatform = b.getAttribute('data-plat');
      document.querySelectorAll('#importStep1 [data-plat]').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      document.getElementById('importHint').textContent = hints[state.importPlatform] || '';
      showImportStep(2);
    });
  });
  const drop = document.getElementById('importDrop');
  const fin = document.getElementById('importFile');
  drop?.addEventListener('click', () => fin?.click());
  drop?.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop?.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) setImportFile(e.dataTransfer.files[0]);
  });
  fin?.addEventListener('change', () => {
    if (fin.files[0]) setImportFile(fin.files[0]);
  });
  document.getElementById('impBack2')?.addEventListener('click', () => showImportStep(1));
  document.getElementById('impNext2')?.addEventListener('click', () => {
    if (!state.importFile) {
      showToast('Selecione um ficheiro', 'danger');
      return;
    }
    const ds = document.getElementById('impStart').value;
    const de = document.getElementById('impEnd').value;
    if (!ds || !de) {
      showToast('Indique o período', 'danger');
      return;
    }
    showImportStep(3);
    const n = state.importRowsEstimate || '—';
    document.getElementById('importSummary').textContent = `Plataforma: ${platformLabel(state.importPlatform)} · ${state.importFile.name} · ${ds} → ${de} · ~${n} linhas`;
  });
  document.getElementById('impBack3')?.addEventListener('click', () => showImportStep(2));
  document.getElementById('impDo')?.addEventListener('click', doImport);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

function setImportFile(file) {
  state.importFile = file;
  document.getElementById('importFileMeta').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  const wrap = document.getElementById('importPreviewWrap');
  const low = file.name.toLowerCase();
  if (low.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = previewCSV(reader.result);
      state.importRowsEstimate = reader.result.split('\n').filter((l) => l.trim()).length - 1;
      wrap.innerHTML = `<table class="mk-data"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
    };
    reader.readAsText(file);
  } else {
    state.importRowsEstimate = 0;
    wrap.innerHTML = '<p class="mk-kpi-card__sub">Pré-visualização detalhada só para CSV. Excel será processado no servidor.</p>';
  }
}

function showImportStep(n) {
  state.importStep = n;
  document.getElementById('importStep1').hidden = n !== 1;
  document.getElementById('importStep2').hidden = n !== 2;
  document.getElementById('importStep3').hidden = n !== 3;
  ['st1', 'st2', 'st3'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', i + 1 === n);
  });
  document.getElementById('importErr').textContent = '';
  document.getElementById('importOk').textContent = '';
}

async function doImport() {
  const sp = document.getElementById('impSpinner');
  sp.style.display = 'block';
  document.getElementById('importErr').textContent = '';
  try {
    const fd = new FormData();
    fd.append('file', state.importFile);
    fd.append('platform', state.importPlatform);
    fd.append('period_start', document.getElementById('impStart').value);
    fd.append('period_end', document.getElementById('impEnd').value);
    if (document.getElementById('impReplace').checked) fd.append('replace', '1');
    const r = await fetch('/api/marketing/import', { method: 'POST', body: fd, credentials: 'include' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'Falha');
    document.getElementById('importOk').textContent = `✓ ${j.imported} importados, ${j.skipped} ignorados`;
    if (j.errors?.length) document.getElementById('importErr').innerHTML = j.errors.slice(0, 8).map(escapeHtml).join('<br>');
    loadAdSpend();
    loadStats(state.period);
    setTimeout(() => {
      document.getElementById('modalImport').hidden = true;
      sp.style.display = 'none';
    }, 2000);
  } catch (e) {
    document.getElementById('importErr').textContent = e.message || String(e);
    sp.style.display = 'none';
  }
}

function initManualModal() {
  const modal = document.getElementById('modalManual');
  document.getElementById('btnManual')?.addEventListener('click', () => {
    modal.hidden = false;
    const t = new Date();
    document.getElementById('mPStart').value = t.toISOString().slice(0, 10);
    document.getElementById('mPEnd').value = t.toISOString().slice(0, 10);
  });
  ['mSpend', 'mConv', 'mCval'].forEach((id) =>
    document.getElementById(id)?.addEventListener('input', updateManualPreview)
  );
  document.getElementById('mSave')?.addEventListener('click', async () => {
    const body = {
      platform: document.getElementById('mPlatform').value,
      campaign_name: document.getElementById('mCampaign').value.trim(),
      ad_set_name: document.getElementById('mAdset').value.trim() || null,
      period_start: document.getElementById('mPStart').value,
      period_end: document.getElementById('mPEnd').value,
      spend: +document.getElementById('mSpend').value || 0,
      impressions: +document.getElementById('mImp').value || 0,
      clicks: +document.getElementById('mClk').value || 0,
      conversions: +document.getElementById('mConv').value || 0,
      conversion_value: +document.getElementById('mCval').value || 0,
      notes: document.getElementById('mNotes').value || null,
    };
    if (!body.campaign_name) {
      showToast('Campanha obrigatória', 'danger');
      return;
    }
    const r = await fetch('/api/marketing/ad-spend', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.success) {
      showToast(j.error || 'Erro', 'danger');
      return;
    }
    showToast('Guardado');
    modal.hidden = true;
    loadAdSpend();
    loadStats(state.period);
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

function updateManualPreview() {
  const sp = +document.getElementById('mSpend').value || 0;
  const cv = +document.getElementById('mConv').value || 0;
  const val = +document.getElementById('mCval').value || 0;
  document.getElementById('mPreviewCpl').textContent = cv > 0 ? fmt$(sp / cv) : '—';
  document.getElementById('mPreviewRoas').textContent = sp > 0 ? fmtX(val / sp) : '—';
}

function initGoalsModal() {
  const modal = document.getElementById('modalGoals');
  const open = async () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('goalMonth').value = ym;
    document.getElementById('modalGoalsTitle').textContent = 'Metas de Marketing — ' + ym;
    modal.hidden = false;
    try {
      const r = await fetch(`/api/marketing/goals?month=${ym}`, { credentials: 'include' });
      const j = await r.json();
      const row = (j.data || []).find((x) => x.platform === 'all') || (j.data || [])[0];
      if (row) {
        document.getElementById('goalBudget').value = row.budget_limit ?? '';
        document.getElementById('goalLeadsN').value = row.goal_leads ?? '';
        document.getElementById('goalCpl').value = row.goal_cpl_max ?? '';
        document.getElementById('goalRoas').value = row.goal_roas_min ?? '';
        document.getElementById('goalCpa').value = row.goal_cpa_max ?? '';
        document.getElementById('goalNotes').value = row.notes ?? '';
      } else {
        ['goalBudget', 'goalLeadsN', 'goalCpl', 'goalRoas', 'goalCpa', 'goalNotes'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
      }
    } catch (_) {}
  };
  document.getElementById('btnGoals')?.addEventListener('click', open);
  document.getElementById('linkDefineGoals')?.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  document.getElementById('goalSave')?.addEventListener('click', async () => {
    const month = document.getElementById('goalMonth').value;
    const body = {
      month,
      platform: 'all',
      budget_limit: document.getElementById('goalBudget').value || null,
      goal_leads: document.getElementById('goalLeadsN').value || null,
      goal_cpl_max: document.getElementById('goalCpl').value || null,
      goal_roas_min: document.getElementById('goalRoas').value || null,
      goal_cpa_max: document.getElementById('goalCpa').value || null,
      notes: document.getElementById('goalNotes').value || null,
    };
    const r = await fetch('/api/marketing/goals', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.success) {
      showToast(j.error || 'Erro', 'danger');
      return;
    }
    showToast('Metas salvas ✓');
    modal.hidden = true;
    loadStats(state.period);
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
}

function closeAllMarketingModals() {
  ['modalGoals', 'modalManual', 'modalImport', 'modalEdit'].forEach((mid) => {
    const el = document.getElementById(mid);
    if (el) el.hidden = true;
  });
}

function openEditModal(id) {
  const nid = Number(id);
  if (!Number.isFinite(nid) || nid <= 0) return;
  const row = state.campaigns.find((r) => r.id === nid);
  if (!row) return;
  const modal = document.getElementById('modalEdit');
  document.getElementById('eId').value = String(row.id);
  const sel = document.getElementById('ePlatform');
  sel.innerHTML = ['google_ads', 'meta', 'instagram', 'tiktok', 'other']
    .map((p) => `<option value="${p}" ${row.platform === p ? 'selected' : ''}>${platformLabel(p)}</option>`)
    .join('');
  document.getElementById('eCampaign').value = row.campaign_name || '';
  document.getElementById('eStart').value = (row.period_start || row.spend_date || '').slice(0, 10);
  document.getElementById('eEnd').value = (row.period_end || row.spend_date || '').slice(0, 10);
  document.getElementById('eSpend').value = row.spend ?? '';
  document.getElementById('eClk').value = row.clicks ?? '';
  document.getElementById('eImp').value = row.impressions ?? '';
  document.getElementById('eConv').value = row.conversions ?? '';
  document.getElementById('eCval').value = row.conversion_value ?? '';
  document.getElementById('eNotes').value = row.notes ?? '';
  modal.hidden = false;
}

document.getElementById('eSave')?.addEventListener('click', async () => {
  const id = document.getElementById('eId').value;
  const body = {
    platform: document.getElementById('ePlatform').value,
    campaign_name: document.getElementById('eCampaign').value,
    period_start: document.getElementById('eStart').value,
    period_end: document.getElementById('eEnd').value,
    spend: +document.getElementById('eSpend').value,
    clicks: +document.getElementById('eClk').value,
    impressions: +document.getElementById('eImp').value,
    conversions: +document.getElementById('eConv').value,
    conversion_value: +document.getElementById('eCval').value,
    notes: document.getElementById('eNotes').value,
  };
  const r = await fetch(`/api/marketing/ad-spend/${id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) {
    showToast(j.error || 'Erro', 'danger');
    return;
  }
  showToast('Atualizado');
  document.getElementById('modalEdit').hidden = true;
  loadAdSpend();
  loadStats(state.period);
});

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => {
    const id = b.getAttribute('data-close');
    const m = document.getElementById(id);
    if (m) m.hidden = true;
  });
});

document.getElementById('mkSearch')?.addEventListener('input', (e) => {
  state.filterSearch = e.target.value;
  applyFilters();
});
document.getElementById('mkFilterPlat')?.addEventListener('change', (e) => {
  state.filterPlatform = e.target.value;
  renderPlatformCards(state.stats?.by_platform || [], state.stats?.summary?.total_spend || 0);
  applyFilters();
});
document.getElementById('mkClearFilters')?.addEventListener('click', () => {
  state.filterSearch = '';
  state.filterPlatform = 'all';
  document.getElementById('mkSearch').value = '';
  document.getElementById('mkFilterPlat').value = 'all';
  renderPlatformCards(state.stats?.by_platform || [], state.stats?.summary?.total_spend || 0);
  applyFilters();
});
document.getElementById('mkPrev')?.addEventListener('click', () => {
  if (state.currentPage > 1) {
    state.currentPage--;
    renderTable();
  }
});
document.getElementById('mkNext')?.addEventListener('click', () => {
  const totalP = Math.max(1, Math.ceil(state.filteredCampaigns.length / state.pageSize));
  if (state.currentPage < totalP) {
    state.currentPage++;
    renderTable();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await checkAuth())) return;
  closeAllMarketingModals();
  loadStats();
  loadAdSpend();
  initImportModal();
  initManualModal();
  initGoalsModal();
  bindPeriodSelector();
});

setInterval(() => loadStats(state.period), 10 * 60 * 1000);
