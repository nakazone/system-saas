/**
 * Builder portal — completed project history (summary, filters, CSV/PDF export).
 */
(function () {
  let rows = [];
  let searchQ = '';
  let yearFilter = '';

  function money(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      Number(n) || 0
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function filtered() {
    let list = rows;
    if (yearFilter) list = list.filter((p) => p.completed_year === yearFilter);
    const q = searchQ.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const hay = [p.name, p.address, p.project_number, p.flooring_type].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }

  function summarizeList(list) {
    let totalSqft = 0;
    let totalValue = 0;
    list.forEach((p) => {
      totalSqft += Number(p.total_sqft) || 0;
      totalValue += Number(p.contract_value) || 0;
    });
    return {
      project_count: list.length,
      total_sqft: totalSqft,
      total_value: Math.round(totalValue * 100) / 100,
    };
  }

  function isFilteredView() {
    return !!yearFilter || !!searchQ.trim();
  }

  function renderSummary() {
    const el = document.getElementById('histSummary');
    if (!el) return;
    const s = summarizeList(filtered());
    const hint = isFilteredView()
      ? '<p class="bp-muted" style="grid-column:1/-1;margin:0 0 4px;font-size:12px">Totals for current filter</p>'
      : '';
    el.innerHTML = `${hint}
      <div class="bp-card bp-metric"><div class="bp-metric__val">${s.project_count}</div><div class="bp-metric__lbl">Projects completed</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">${Math.round(s.total_sqft || 0).toLocaleString()}</div><div class="bp-metric__lbl">Sq ft installed</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">${money(s.total_value)}</div><div class="bp-metric__lbl">Total project value</div></div>`;
  }

  function photosCell(p) {
    if (!p.photo_count) return '<span class="bp-muted">\u2014</span>';
    const label = p.has_before_after
      ? `${p.photo_count} photos (Before/After)`
      : `${p.photo_count} photo${p.photo_count === 1 ? '' : 's'}`;
    return `<a href="builder-project.html?id=${p.id}&amp;tab=photos">${escapeHtml(label)}</a>`;
  }

  function renderTable() {
    const list = filtered();
    const tbody = document.getElementById('histBody');
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="7">No completed projects yet. Finished work with Senior Floors will appear here.</td></tr>';
      return;
    }
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7">No completed projects match this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((p) => {
        const title = p.project_number || p.name || `#${p.id}`;
        return `<tr>
          <td>${escapeHtml(title)}</td>
          <td>${escapeHtml(p.address || '\u2014')}</td>
          <td>${escapeHtml(p.flooring_type || '\u2014')}</td>
          <td>${p.total_sqft ? `${p.total_sqft} sqft` : '\u2014'}</td>
          <td>${money(p.contract_value)}</td>
          <td>${escapeHtml(String(p.end_date_actual || '').slice(0, 10) || '\u2014')}</td>
          <td>${photosCell(p)}</td>
        </tr>`;
      })
      .join('');
  }

  function populateYears() {
    const sel = document.getElementById('histYear');
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    const years = [...new Set(rows.map((p) => p.completed_year).filter(Boolean))].sort().reverse();
    years.forEach((y) => {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y;
      if (y === yearFilter) o.selected = true;
      sel.appendChild(o);
    });
  }

  function pdfQuery() {
    const p = new URLSearchParams();
    if (yearFilter) p.set('year', yearFilter);
    if (searchQ.trim()) p.set('q', searchQ.trim());
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  }

  function setPdfLoading(loading) {
    ['btnExportPdf', 'btnViewPdf'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = loading;
    });
    const dl = document.getElementById('btnExportPdf');
    const view = document.getElementById('btnViewPdf');
    if (!loading) {
      if (dl) dl.textContent = 'Download PDF';
      if (view) view.textContent = 'View PDF';
    } else {
      if (dl) dl.textContent = 'Loading...';
      if (view) view.textContent = 'Loading...';
    }
  }

  async function fetchHistoryPdfBlob() {
    const r = await window.builderAuth.fetch(`/api/builder-history/pdf${pdfQuery()}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'Could not generate PDF');
    }
    return r.blob();
  }

  async function viewPdf() {
    setPdfLoading(true);
    try {
      const blob = await fetchHistoryPdfBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      setPdfLoading(false);
    }
  }

  async function downloadPdf() {
    setPdfLoading(true);
    try {
      const blob = await fetchHistoryPdfBlob();
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `senior-floors-completed-projects-${stamp}.pdf`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      setPdfLoading(false);
    }
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-history');
    const j = await r.json();
    rows = j.data || [];
    populateYears();
    renderSummary();
    renderTable();
  }

  function onFilterChange() {
    renderSummary();
    renderTable();
  }

  document.getElementById('histSearch')?.addEventListener('input', (e) => {
    searchQ = e.target.value;
    onFilterChange();
  });
  document.getElementById('histYear')?.addEventListener('change', (e) => {
    yearFilter = e.target.value;
    onFilterChange();
  });

  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    const list = filtered();
    const header = ['Project', 'Address', 'Floor', 'Sqft', 'Value', 'Completed', 'Photos'];
    const lines = [
      header.join(','),
      ...list.map((p) =>
        [
          p.project_number || p.id,
          `"${(p.address || '').replace(/"/g, '""')}"`,
          p.flooring_type || '',
          p.total_sqft || '',
          p.contract_value || '',
          p.end_date_actual || '',
          p.photo_count || 0,
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'senior-floors-completed-projects.csv';
    a.click();
  });

  document.getElementById('btnExportPdf')?.addEventListener('click', downloadPdf);
  document.getElementById('btnViewPdf')?.addEventListener('click', viewPdf);

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (boot) boot().then((ok) => ok && load());
    else if (window.builderAuth?.getToken()) load();
  });
})();
