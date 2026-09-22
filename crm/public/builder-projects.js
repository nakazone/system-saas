(function () {
  const host = document.getElementById('projectsHost');
  let allProjects = [];
  let filter = 'active';
  let searchQ = '';
  let yearFilter = '';
  let serviceFilter = '';
  let viewMode = localStorage.getItem('bp_proj_view') || 'list';

  const COMPLETED = new Set(['completed', 'closed', 'cancelled']);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const cls = COMPLETED.has(s)
      ? 'bp-badge--pending'
      : s === 'in_progress' || s === 'active'
        ? 'bp-badge--active'
        : 'bp-badge--scheduled';
    return `<span class="bp-badge ${cls}">${escapeHtml(status || 'unknown')}</span>`;
  }

  function fmtDate(d) {
    if (!d) return '';
    try {
      return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(d).slice(0, 10);
    }
  }

  function relTime(d) {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'Updated today';
    if (days === 1) return 'Updated yesterday';
    return `Updated ${days} days ago`;
  }

  function filtered() {
    let rows = allProjects;
    if (filter === 'completed') {
      rows = rows.filter((p) => COMPLETED.has(String(p.status || '').toLowerCase()));
    } else if (filter !== 'all') {
      rows = rows.filter((p) => !COMPLETED.has(String(p.status || '').toLowerCase()));
    }
    if (yearFilter) {
      rows = rows.filter((p) => {
        const d = p.start_date || p.updated_at;
        return d && String(d).slice(0, 4) === yearFilter;
      });
    }
    if (serviceFilter) {
      rows = rows.filter((p) => String(p.service_type || '').toLowerCase().includes(serviceFilter));
    }
    const q = searchQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) => {
        const hay = [p.name, p.address, p.project_number, p.flooring_type, p.manager_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }

  function cardList(p) {
    const pct = Math.min(100, Number(p.completion_percentage) || 0);
    const title = p.name || p.project_number || `Project #${p.id}`;
    return `<div class="bp-card bp-proj-card">
      <div class="bp-proj-card__main">
        <div class="bp-proj-card__head">
          <strong>${escapeHtml(title)}</strong>
          ${statusBadge(p.status)}
        </div>
        <p class="bp-muted" style="margin:4px 0;font-size:13px">${escapeHtml(p.address || '')}</p>
        <p class="bp-muted" style="margin:0;font-size:12px">
          ${p.flooring_type ? escapeHtml(p.flooring_type) : ''}${p.total_sqft ? ` — ${p.total_sqft} sqft` : ''}
          ${p.start_date ? ` — Start ${fmtDate(p.start_date)}` : ''}
        </p>
        <p class="bp-muted" style="margin:4px 0 0;font-size:11px">
          Next: ${escapeHtml(p.next_step || '—')} — ${p.photo_count || 0} photos — ${escapeHtml(p.manager_name || 'SF team')}
          — ${relTime(p.updated_at)}
        </p>
        <div class="bp-progress-bar" style="margin-top:10px;max-width:280px"><div class="bp-progress-fill" style="width:${pct}%"></div></div>
        <span class="bp-muted" style="font-size:11px">${pct}%</span>
      </div>
      <a href="builder-project.html?id=${p.id}" class="bp-btn-tan" style="text-decoration:none;white-space:nowrap;align-self:center">View details</a>
    </div>`;
  }

  function cardGrid(p) {
    const pct = Math.min(100, Number(p.completion_percentage) || 0);
    const title = p.name || p.project_number || `Project #${p.id}`;
    const img = p.cover_url
      ? `<img src="${escapeHtml(p.cover_url)}" alt="" loading="lazy" />`
      : '<div class="bp-proj-grid__ph">No photo</div>';
    return `<a href="builder-project.html?id=${p.id}" class="bp-proj-grid-card">
      <div class="bp-proj-grid-card__img">${img}${statusBadge(p.status)}</div>
      <div class="bp-proj-grid-card__body">
        <strong>${escapeHtml(title)}</strong>
        <p class="bp-muted" style="margin:4px 0 0;font-size:12px">${escapeHtml(p.address || '')}</p>
        <div class="bp-progress-bar" style="margin-top:8px"><div class="bp-progress-fill" style="width:${pct}%"></div></div>
      </div>
    </a>`;
  }

  function renderList() {
    const rows = filtered();
    document.getElementById('viewList')?.classList.toggle('active', viewMode === 'list');
    document.getElementById('viewGrid')?.classList.toggle('active', viewMode === 'grid');
    if (!rows.length) {
      host.innerHTML =
        '<p class="bp-card">No projects in this view. <a href="builder-estimate-request.html">Request an estimate</a> to get started.</p>';
      return;
    }
    if (viewMode === 'grid') {
      host.innerHTML = `<div class="bp-proj-grid">${rows.map(cardGrid).join('')}</div>`;
    } else {
      host.innerHTML = rows.map(cardList).join('');
    }
  }

  function populateFilters() {
    const years = [...new Set(allProjects.map((p) => String((p.start_date || p.updated_at || '').slice(0, 4))).filter(Boolean))].sort().reverse();
    const ysel = document.getElementById('filterYear');
    years.forEach((y) => {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      ysel.appendChild(o);
    });
    const services = new Set();
    allProjects.forEach((p) => {
      String(p.service_type || '')
        .split(',')
        .forEach((s) => {
          const t = s.trim();
          if (t) services.add(t);
        });
    });
    const ssel = document.getElementById('filterService');
    [...services].sort().forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      ssel.appendChild(o);
    });
  }

  document.getElementById('projSearch')?.addEventListener('input', (e) => {
    searchQ = e.target.value;
    renderList();
  });
  document.getElementById('filterYear')?.addEventListener('change', (e) => {
    yearFilter = e.target.value;
    renderList();
  });
  document.getElementById('filterService')?.addEventListener('change', (e) => {
    serviceFilter = e.target.value;
    renderList();
  });
  document.querySelectorAll('.bp-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('.bp-filter-btn').forEach((b) => {
        b.classList.toggle('bp-btn-tan', b === btn);
        b.classList.toggle('bp-btn-ghost', b !== btn);
        b.classList.toggle('active', b === btn);
      });
      renderList();
    });
  });
  document.getElementById('viewList')?.addEventListener('click', () => {
    viewMode = 'list';
    localStorage.setItem('bp_proj_view', 'list');
    renderList();
  });
  document.getElementById('viewGrid')?.addEventListener('click', () => {
    viewMode = 'grid';
    localStorage.setItem('bp_proj_view', 'grid');
    renderList();
  });

  async function load() {
    const pr = await window.builderAuth.fetch('/api/builder-projects');
    const pj = await pr.json();
    if (!pj.success) {
      host.innerHTML = `<p class="bp-card">${escapeHtml(pj.error || 'Error')}</p>`;
      return;
    }
    allProjects = pj.data || [];
    populateFilters();
    renderList();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.builderAuth?.getToken()) load();
      else location.href = 'builder-login.html';
    }, 120);
  });
})();
