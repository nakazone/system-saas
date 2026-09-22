/**
 * Lista de projetos — Senior Floors CRM
 */
let state = {
  projects: [],
  filtered: [],
  page: 1,
  filters: { status: '', client_type: '', flooring_type: '', search: '' },
};

const fmt$ = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(
    parseFloat(v) || 0
  );
function toYmd(d) {
  if (d == null || d === '') return '';
  const m = String(d).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

const formatDate = (d) => {
  const ymd = toYmd(d);
  if (!ymd) return '—';
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

function showSkeletons() {
  const el = document.getElementById('projects-grid');
  if (!el) return;
  el.innerHTML = Array.from({ length: 6 })
    .map(
      () =>
        `<div class="sf-card" style="min-height:180px;animation:pulse 1.2s ease-in-out infinite;background:rgba(26,32,54,.06)"></div>`
    )
    .join('');
}

async function loadProjects() {
  showSkeletons();
  const params = new URLSearchParams();
  if (state.filters.status) params.set('status', state.filters.status);
  if (state.filters.client_type) params.set('client_type', state.filters.client_type);
  if (state.filters.flooring_type) params.set('flooring_type', state.filters.flooring_type);
  params.set('page', String(state.page));
  params.set('limit', '100');
  const res = await fetch(`/api/projects?${params}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok || !data.success) {
    document.getElementById('projects-grid').innerHTML =
      `<div class="empty-state" style="color:var(--sf-bad)">Erro ao carregar projetos</div>`;
    return;
  }
  state.projects = data.data || [];
  applyFilters();
  loadStats();
}

async function loadStats() {
  const res = await fetch('/api/projects/stats/overview', { credentials: 'include' });
  const data = await res.json();
  if (data.success && data.data) renderStatsCards(data.data);
}

function renderStatsCards(d) {
  const elA = document.getElementById('kpi-active');
  const elC = document.getElementById('kpi-completed');
  const elR = document.getElementById('kpi-revenue');
  const elM = document.getElementById('kpi-margin');
  if (elA) elA.textContent = String(d.by_status?.in_progress ?? '—');
  if (elC) elC.textContent = String(d.total_completed_month ?? '—');
  if (elR) elR.textContent = fmt$(d.revenue_month);
  if (elM) elM.textContent = `${(parseFloat(d.avg_margin_pct) || 0).toFixed(1)}%`;
}

function applyFilters() {
  const s = (state.filters.search || '').toLowerCase();
  state.filtered = state.projects.filter((p) => {
    return (
      (!s || (p.name || '').toLowerCase().includes(s) || (p.address || '').toLowerCase().includes(s)) &&
      (!state.filters.status || p.status === state.filters.status) &&
      (!state.filters.client_type || p.client_type === state.filters.client_type) &&
      (!state.filters.flooring_type || String(p.flooring_type || '') === state.filters.flooring_type)
    );
  });
  renderProjectCards();
}

function renderProjectCards() {
  const container = document.getElementById('projects-grid');
  if (!container) return;
  if (!state.filtered.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sf-muted)">Nenhum projeto encontrado</div>';
    return;
  }
  container.innerHTML = state.filtered.map((p) => projectCardHTML(p)).join('');
}

function projectCardHTML(p) {
  const statusColors = {
    scheduled: 'var(--sf-navy)',
    in_progress: 'var(--sf-gold3)',
    on_hold: 'var(--sf-warn)',
    completed: 'var(--sf-ok)',
    cancelled: 'var(--sf-muted)',
  };
  const statusLabels = {
    scheduled: 'Agendado',
    in_progress: 'Em Andamento',
    on_hold: 'Pausado',
    completed: 'Concluído',
    cancelled: 'Cancelado',
  };
  const margin =
    p.margin_pct != null ? parseFloat(p.margin_pct) : p.contract_value > 0
      ? ((p.contract_value - p.total_cost_actual) / p.contract_value) * 100
      : 0;
  const chk =
    p.checklist_total > 0 ? `${p.checklist_done}/${p.checklist_total}` : p.checklist_completed ? '✓' : '—';
  return `
    <div class="sf-card project-card" role="link" tabindex="0" data-href="/project-detail.html?id=${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="sf-stage" style="background:${statusColors[p.status] || '#ccc'}20;color:${statusColors[p.status] || '#333'}">${statusLabels[p.status] || p.status}</span>
          ${p.flooring_type ? `<span class="sf-stage" style="background:rgba(26,32,54,.08);color:var(--sf-navy)">${p.flooring_type}</span>` : ''}
          ${p.portfolio_published ? `<span class="sf-stage" style="background:rgba(45,110,74,.12);color:var(--sf-ok)">🌐 Publicado</span>` : ''}
        </div>
        <span style="font-size:11px;font-weight:700;color:var(--sf-gold4)">${p.completion_percentage}%</span>
      </div>
      <div style="font-size:14px;font-weight:700;color:var(--sf-navy);margin-bottom:2px">${escapeHtml(p.name)}</div>
      ${String(p.client_type || '') === 'builder' && p.builder_name ? `<div style="font-size:11px;color:var(--sf-navy);margin-bottom:4px"><strong>Builder:</strong> ${escapeHtml(p.builder_name)}</div>` : ''}
      ${p.client_name ? `<div style="font-size:11px;color:var(--sf-muted);margin-bottom:4px"><strong>Cliente:</strong> ${escapeHtml(p.client_name)}</div>` : ''}
      <div style="font-size:11px;color:var(--sf-muted);margin-bottom:10px">${escapeHtml(p.address || 'Endereço não definido')}</div>
      <div style="height:3px;background:rgba(26,32,54,.1);border-radius:3px;margin-bottom:10px">
        <div style="height:100%;width:${p.completion_percentage}%;background:var(--sf-gold3);border-radius:3px;transition:width .3s"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--sf-muted);margin-bottom:10px">
        <span>📅 ${formatDate(p.start_date)} → ${formatDate(p.end_date_estimated)}</span>
        <span>👷 ${escapeHtml(p.assigned_to_name || 'Não atribuído')}</span>
        <span>💰 ${fmt$(p.contract_value)}</span>
        <span style="color:${margin >= 30 ? 'var(--sf-ok)' : margin >= 15 ? 'var(--sf-warn)' : 'var(--sf-bad)'}">Margem: ${margin.toFixed(1)}%</span>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:10px">
        ${p.supply_value > 0 ? `<div style="flex:${p.supply_value};height:6px;background:var(--sf-navy);border-radius:3px 0 0 3px" title="Supply ${fmt$(p.supply_value)}"></div>` : ''}
        ${p.installation_value > 0 ? `<div style="flex:${p.installation_value};height:6px;background:var(--sf-gold3)" title="Install ${fmt$(p.installation_value)}"></div>` : ''}
        ${p.sand_finish_value > 0 ? `<div style="flex:${p.sand_finish_value};height:6px;background:var(--sf-gold4);border-radius:0 3px 3px 0" title="Sand ${fmt$(p.sand_finish_value)}"></div>` : ''}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:10.5px;color:var(--sf-muted)">
        <span>📷 ${p.photos_count || 0} fotos &nbsp; ${p.checklist_completed ? '✓ Checklist' : `☐ Checklist ${chk}`}</span>
        <span style="color:var(--sf-gold4);font-weight:700">Ver projeto →</span>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function wireProjectCardClicks() {
  document.getElementById('projects-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.project-card[data-href]');
    if (!card) return;
    window.location.href = card.getAttribute('data-href');
  });
  document.getElementById('projects-grid')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.project-card[data-href]');
    if (!card) return;
    e.preventDefault();
    window.location.href = card.getAttribute('data-href');
  });
}

async function openModal() {
  const m = document.getElementById('modalNewProject');
  if (!m) return;
  m.classList.add('open');
  await populateModalSelects();
}

function closeModal() {
  document.getElementById('modalNewProject')?.classList.remove('open');
}

async function populateModalSelects() {
  const leadSel = document.getElementById('np-lead');
  const crewSel = document.getElementById('np-crew');
  const userSel = document.getElementById('np-assigned');
  if (leadSel && leadSel.options.length <= 1) {
    try {
      const r = await fetch('/api/leads?limit=300&page=1', { credentials: 'include' });
      const j = await r.json();
      const leads = j.data || [];
      leads.forEach((l) => {
        const o = document.createElement('option');
        o.value = String(l.id);
        o.textContent = `${l.name || 'Lead'} (#${l.id})`;
        leadSel.appendChild(o);
      });
    } catch (_) {}
  }
  if (crewSel && crewSel.options.length <= 1) {
    try {
      const r = await fetch('/api/crews', { credentials: 'include' });
      const j = await r.json();
      (j.data || []).forEach((c) => {
        const o = document.createElement('option');
        o.value = String(c.id);
        o.textContent = c.name || `Crew ${c.id}`;
        crewSel.appendChild(o);
      });
    } catch (_) {}
  }
  if (userSel && userSel.options.length <= 1) {
    try {
      const r = await fetch('/api/users?limit=200&page=1', { credentials: 'include' });
      const j = await r.json();
      (j.data || []).forEach((u) => {
        const o = document.createElement('option');
        o.value = String(u.id);
        o.textContent = u.name || u.email || `User ${u.id}`;
        userSel.appendChild(o);
      });
    } catch (_) {}
  }
  const builderSel = document.getElementById('np-builder-partner');
  if (builderSel && builderSel.options.length <= 1) {
    try {
      const r = await fetch('/api/projects/lookup/builders', { credentials: 'include' });
      const j = await r.json();
      (j.data || []).forEach((b) => {
        const o = document.createElement('option');
        o.value = String(b.id);
        o.textContent = b.label || `Builder #${b.id}`;
        builderSel.appendChild(o);
      });
    } catch (_) {}
  }
}

function wireModal() {
  document.getElementById('btnNewProject')?.addEventListener('click', openModal);
  document.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
  document.getElementById('modalNewProject')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalNewProject') closeModal();
  });
  document.getElementById('np-client-type')?.addEventListener('change', (e) => {
    const partner = document.getElementById('np-builder-partner');
    if (e.target.value === 'builder' && partner && !partner.value) {
      partner.focus();
    }
  });
  document.getElementById('np-days')?.addEventListener('change', syncEndDate);
  document.getElementById('np-start')?.addEventListener('change', syncEndDate);
  document.getElementById('formNewProject')?.addEventListener('submit', submitNewProject);
}

function syncEndDate() {
  const start = document.getElementById('np-start')?.value;
  const days = parseInt(document.getElementById('np-days')?.value, 10);
  if (!start || !days) return;
  const d = new Date(`${start}T12:00:00`);
  d.setDate(d.getDate() + days);
  /* end_date_estimated computed no servidor se enviarmos days_estimated; opcional campo hidden */
}

async function submitNewProject(ev) {
  ev.preventDefault();
  const name = document.getElementById('np-name')?.value?.trim();
  const leadId = document.getElementById('np-lead')?.value;
  if (!name) return;
  const builderPartnerId = document.getElementById('np-builder-partner')?.value || '';
  const clientType = document.getElementById('np-client-type')?.value || 'customer';
  if (clientType === 'builder' && !builderPartnerId && !leadId) {
    alert('Para projeto tipo Builder, selecione um parceiro na lista ou associe um lead com cliente.');
    return;
  }
  const body = {
    name,
    lead_id: leadId ? parseInt(leadId, 10) : null,
    client_type: builderPartnerId ? 'builder' : clientType,
    builder_partner_id: builderPartnerId ? parseInt(builderPartnerId, 10) : null,
    flooring_type: document.getElementById('np-flooring')?.value || null,
    total_sqft: document.getElementById('np-sqft')?.value || null,
    start_date: document.getElementById('np-start')?.value || null,
    days_estimated: document.getElementById('np-days')?.value
      ? parseInt(document.getElementById('np-days').value, 10)
      : null,
    contract_value: document.getElementById('np-contract')?.value || 0,
    supply_value: document.getElementById('np-supply')?.value || 0,
    installation_value: document.getElementById('np-install')?.value || 0,
    sand_finish_value: document.getElementById('np-sand')?.value || 0,
    crew_id: document.getElementById('np-crew')?.value || null,
    assigned_to: document.getElementById('np-assigned')?.value || null,
  };
  if (body.crew_id) body.crew_id = parseInt(body.crew_id, 10);
  if (body.assigned_to) body.assigned_to = parseInt(body.assigned_to, 10);
  const res = await fetch('/api/projects', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok || !j.success) {
    alert(j.error || 'Erro ao criar projeto');
    return;
  }
  closeModal();
  window.location.href = `/project-detail.html?id=${j.data.id}`;
}

function wireFilters() {
  const runServer = () => {
    state.filters.status = document.getElementById('filter-status')?.value || '';
    state.filters.client_type = document.getElementById('filter-client-type')?.value || '';
    state.filters.flooring_type = document.getElementById('filter-flooring')?.value || '';
    state.page = 1;
    loadProjects();
  };
  document.getElementById('filter-status')?.addEventListener('change', runServer);
  document.getElementById('filter-client-type')?.addEventListener('change', runServer);
  document.getElementById('filter-flooring')?.addEventListener('change', runServer);
  let t;
  document.getElementById('filter-search')?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.filters.search = document.getElementById('filter-search')?.value || '';
      applyFilters();
    }, 300);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/auth/session', { credentials: 'include' }).then(async (r) => {
    const j = await r.json();
    if (!j.authenticated) {
      window.location.href = '/login.html';
      return;
    }
    wireFilters();
    wireModal();
    wireProjectCardClicks();
    loadProjects();
  });
});
