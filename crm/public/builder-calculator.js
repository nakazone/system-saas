(function () {
  let services = [];
  let lastResult = null;
  let savedCalculationId = null;
  let calcMode = 'quick';
  const AREA_MIN = 100;
  const AREA_MAX = 15000;
  const SHARE_EXPIRY_DAYS = 30;

  function fmt(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clampArea(n) {
    const v = parseInt(String(n), 10) || AREA_MIN;
    return Math.min(AREA_MAX, Math.max(AREA_MIN, v));
  }

  function serviceOptions(selectedId) {
    return services
      .filter((s) => !s.is_locked)
      .map(
        (s) =>
          `<option value="${s.id}"${String(s.id) === String(selectedId) ? ' selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.unit || 'sq ft')}) &mdash; ${fmt(s.partner_price)}/unit</option>`
      )
      .join('');
  }

  function wireAreaControls(row) {
    const slider = row.querySelector('.calc-area-slider');
    const input = row.querySelector('.calc-area');
    if (!slider || !input) return;
    const syncFromSlider = () => {
      input.value = slider.value;
    };
    const syncFromInput = () => {
      const v = clampArea(input.value);
      input.value = v;
      slider.value = v;
    };
    slider.addEventListener('input', syncFromSlider);
    input.addEventListener('input', syncFromInput);
    input.addEventListener('change', syncFromInput);
    syncFromInput();
  }

  function addLineRow(serviceId = '', area = 1000) {
    const host = document.getElementById('calcLines');
    const row = document.createElement('div');
    row.className = 'bp-calc-line';
    const a = clampArea(area);
    row.innerHTML = `
      <select class="calc-svc" aria-label="Service">${serviceOptions(serviceId)}</select>
      <div class="bp-calc-area-wrap">
        <input type="range" class="calc-area-slider" min="${AREA_MIN}" max="${AREA_MAX}" step="50" value="${a}" aria-label="Area slider" />
        <div class="bp-calc-area-input-row">
          <input type="number" class="calc-area" min="${AREA_MIN}" max="${AREA_MAX}" value="${a}" placeholder="sq ft" aria-label="Area in square feet" />
          <span class="bp-calc-area-unit">sq ft</span>
        </div>
      </div>
      <button type="button" class="bp-btn-ghost bp-calc-line-remove" title="Remove line" aria-label="Remove service">&times;</button>`;
    host.appendChild(row);
    wireAreaControls(row);
    row.querySelector('.bp-calc-line-remove')?.addEventListener('click', () => {
      if (host.querySelectorAll('.bp-calc-line').length > 1) row.remove();
    });
    syncModeUi();
  }

  function clearLines() {
    const host = document.getElementById('calcLines');
    if (host) host.innerHTML = '';
  }

  function gatherLines() {
    return [...document.querySelectorAll('.bp-calc-line')].map((row) => ({
      service_id: parseInt(row.querySelector('.calc-svc')?.value, 10),
      area_sqft: clampArea(row.querySelector('.calc-area')?.value),
    }));
  }

  function syncModeUi() {
    const addBtn = document.getElementById('btnAddLine');
    const hint = document.getElementById('calcModeHint');
    const lines = document.querySelectorAll('.bp-calc-line');
    if (calcMode === 'quick') {
      if (addBtn) addBtn.classList.add('hidden');
      if (hint) hint.textContent = 'One service and area. Use the slider or type sq ft.';
      while (document.querySelectorAll('.bp-calc-line').length > 1) {
        document.querySelector('.bp-calc-line:last-child')?.remove();
      }
      lines.forEach((row) => {
        const rm = row.querySelector('.bp-calc-line-remove');
        if (rm) rm.style.visibility = 'hidden';
      });
    } else {
      if (addBtn) addBtn.classList.remove('hidden');
      if (hint) {
        hint.textContent =
          'Full project mode: add installation, sand & finish, prep, etc. Each line has its own area.';
      }
      document.querySelectorAll('.bp-calc-line-remove').forEach((btn) => {
        btn.style.visibility = 'visible';
      });
    }
  }

  function setCalcMode(mode) {
    calcMode = mode === 'full' ? 'full' : 'quick';
    document.querySelectorAll('input[name="calcMode"]').forEach((el) => {
      el.checked = el.value === calcMode;
    });
    if (!document.querySelector('.bp-calc-line')) {
      addLineRow(services[0]?.id, 1000);
    }
    syncModeUi();
  }

  function renderResults(data) {
    const t = data.totals;
    document.getElementById('calcResult')?.classList.remove('hidden');
    document.getElementById('calcRange').textContent = `${fmt(t.estimate_low_discounted)} \u2013 ${fmt(t.estimate_high_discounted)}`;

    const beforeEl = document.getElementById('calcRangeBefore');
    const hasDiscount = t.estimate_low !== t.estimate_low_discounted || t.estimate_high !== t.estimate_high_discounted;
    if (beforeEl) {
      beforeEl.textContent = hasDiscount
        ? `Before volume discount: ${fmt(t.estimate_low)} \u2013 ${fmt(t.estimate_high)}`
        : '';
    }

    const publicEl = document.getElementById('calcPublic');
    if (publicEl) {
      publicEl.textContent =
        t.public_estimate_low > 0
          ? `Public pricing range: ${fmt(t.public_estimate_low)} \u2013 ${fmt(t.public_estimate_high)}`
          : '';
    }

    const savingsEl = document.getElementById('calcSavings');
    if (savingsEl) {
      const sLo = t.public_savings_low || 0;
      const sHi = t.public_savings_high || 0;
      savingsEl.textContent =
        sLo > 0 || sHi > 0
          ? `You save approximately ${fmt(sLo)}${sHi > sLo ? ` \u2013 ${fmt(sHi)}` : ''} vs public pricing as a partner`
          : '';
    }

    const volLines = data.lines.filter((l) => l.volume_discount_pct > 0);
    const volEl = document.getElementById('calcVol');
    if (volEl) {
      volEl.textContent = volLines.length
        ? volLines
            .map((l) => `${l.service}: ${l.volume_discount_pct}% volume discount (${l.area_sqft} sq ft)`)
            .join(' \u2022 ')
        : 'Based on your partner rates (no volume discount on these areas)';
    }

    const bd = document.getElementById('calcBreakdown');
    if (!bd) return;
    bd.classList.remove('hidden');
    bd.innerHTML = `<h3 class="bp-calc-breakdown-title">Breakdown by service</h3>
      <div class="bp-table-wrap"><table class="bp-table bp-calc-breakdown-table"><thead><tr>
        <th>Service</th><th>Area</th><th>Volume</th><th>Partner (after disc.)</th><th>Public range</th>
      </tr></thead><tbody>${data.lines
        .map(
          (l) =>
            `<tr>
              <td data-label="Service">${escapeHtml(l.service)}</td>
              <td data-label="Area">${l.area_sqft} ${escapeHtml(l.unit || 'sq ft')}</td>
              <td data-label="Volume">${l.volume_discount_pct ? l.volume_discount_pct + '%' : '\u2014'}</td>
              <td data-label="Partner">${fmt(l.estimate_low_discounted)} \u2013 ${fmt(l.estimate_high_discounted)}</td>
              <td data-label="Public">${fmt(l.public_estimate_low)} \u2013 ${fmt(l.public_estimate_high)}</td>
            </tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  function itemsSummary(items) {
    return (items || [])
      .map((i) => `${i.service || 'Service'} (${i.area_sqft || 0} sq ft)`)
      .join(', ');
  }

  function reopenEstimate(record) {
    if (!record?.items?.length) return;
    clearLines();
    setCalcMode(record.items.length > 1 ? 'full' : 'quick');
    record.items.forEach((item) => {
      addLineRow(item.service_id, item.area_sqft || 1000);
    });
    savedCalculationId = record.id || null;
    lastResult = { lines: record.items, totals: sumFromItems(record.items, record) };
    renderResults(lastResult);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function sumFromItems(items, record) {
    if (record?.total_low != null) {
      return {
        estimate_low_discounted: Number(record.total_low),
        estimate_high_discounted: Number(record.total_high),
        area_sqft: record.area_sqft_total || items.reduce((s, i) => s + (i.area_sqft || 0), 0),
        estimate_low: items.reduce((s, i) => s + (i.estimate_low || i.estimate_low_discounted || 0), 0),
        estimate_high: items.reduce((s, i) => s + (i.estimate_high || i.estimate_high_discounted || 0), 0),
        public_estimate_low: items.reduce((s, i) => s + (i.public_estimate_low || 0), 0),
        public_estimate_high: items.reduce((s, i) => s + (i.public_estimate_high || 0), 0),
        public_savings_low: items.reduce((s, i) => s + (i.public_savings_low || 0), 0),
        public_savings_high: items.reduce((s, i) => s + (i.public_savings_high || 0), 0),
      };
    }
    return lastResult?.totals || {};
  }

  async function loadServices() {
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    services = j.data || [];
    if (!document.querySelector('.bp-calc-line')) {
      addLineRow(services[0]?.id, 1000);
    } else {
      document.querySelectorAll('.calc-svc').forEach((sel) => {
        const cur = sel.value;
        sel.innerHTML = serviceOptions(cur);
      });
    }
  }

  async function loadRecent() {
    const host = document.getElementById('calcRecent');
    if (!host) return;
    try {
      const r = await window.builderAuth.fetch('/api/builder-calculations?limit=5');
      const j = await r.json();
      const rows = j.data || [];
      if (!rows.length) {
        host.innerHTML = '<p class="bp-muted bp-card">No saved estimates yet.</p>';
        return;
      }
      host.innerHTML = rows
        .map(
          (c) => `<button type="button" class="bp-card bp-calc-recent-item" data-calc-id="${c.id}">
          <span class="bp-calc-recent-item__head">
            <strong>${escapeHtml(c.label || 'Estimate #' + c.id)}</strong>
            <span class="bp-muted">${String(c.created_at).slice(0, 10)}</span>
          </span>
          <span class="bp-calc-recent-item__range">${fmt(c.total_low)} \u2013 ${fmt(c.total_high)}</span>
          <span class="bp-calc-recent-item__meta">${escapeHtml(itemsSummary(c.items))}${c.area_sqft_total ? ` \u2022 ${c.area_sqft_total} sq ft total` : ''}</span>
          <span class="bp-calc-recent-item__action">Tap to reopen</span>
        </button>`
        )
        .join('');
      host.querySelectorAll('[data-calc-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.getAttribute('data-calc-id'), 10);
          const rec = rows.find((x) => x.id === id);
          if (rec) reopenEstimate(rec);
        });
      });
    } catch {
      host.innerHTML = '';
    }
  }

  function printEstimatePdf() {
    if (!lastResult) {
      alert('Calculate first.');
      return;
    }
    const w = window.open('', '_blank');
    if (!w) {
      alert('Allow popups to print or save as PDF.');
      return;
    }
    const t = lastResult.totals;
    const label = savedCalculationId ? `Estimate #${savedCalculationId}` : 'Quick estimate';
    const rows = (lastResult.lines || [])
      .map(
        (l) =>
          `<tr><td>${escapeHtml(l.service)}</td><td>${l.area_sqft}</td><td>${l.volume_discount_pct ? l.volume_discount_pct + '%' : '\u2014'}</td><td>${fmt(l.estimate_low_discounted)} \u2013 ${fmt(l.estimate_high_discounted)}</td><td>${fmt(l.public_estimate_low)} \u2013 ${fmt(l.public_estimate_high)}</td></tr>`
      )
      .join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${label}</title>
      <style>body{font-family:Inter,sans-serif;padding:32px;color:#1a2036;max-width:720px;margin:0 auto}
      h1{font-size:1.25rem;margin:0 0 8px}.muted{color:#64748b;font-size:13px}
      .hero{background:#1a2036;color:#fff;padding:20px;border-radius:10px;margin:16px 0}
      .hero strong{font-size:1.5rem;display:block;margin-top:6px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
      th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f8fafc}
      .fine{font-size:10px;color:#64748b;margin-top:24px}</style></head><body>
      <img src="/assets/SeniorFloors.png" alt="" width="48" onerror="this.style.display='none'" />
      <h1>Senior Floors &mdash; Partner estimate</h1>
      <p class="muted">${label} &mdash; ${new Date().toLocaleDateString('en-US')}</p>
      <div class="hero"><span>Estimated partner range</span><strong>${fmt(t.estimate_low_discounted)} \u2013 ${fmt(t.estimate_high_discounted)}</strong>
      ${t.public_savings_low ? `<span style="display:block;margin-top:8px;font-size:13px;color:#d4af74">Partner savings vs public: ${fmt(t.public_savings_low)}${t.public_savings_high > t.public_savings_low ? ` \u2013 ${fmt(t.public_savings_high)}` : ''}</span>` : ''}</div>
      <table><thead><tr><th>Service</th><th>Area</th><th>Volume disc.</th><th>Partner</th><th>Public</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fine">Ballpark estimate only. Not a binding quote. Final pricing depends on site conditions and scope. Contact Senior Floors for a formal proposal.</p></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  function showShareNote(expiresAt) {
    const el = document.getElementById('calcShareNote');
    if (!el) return;
    if (!expiresAt) {
      el.classList.add('hidden');
      return;
    }
    const d = new Date(expiresAt);
    el.textContent = `Share link valid for ${SHARE_EXPIRY_DAYS} days (until ${d.toLocaleDateString('en-US')}).`;
    el.classList.remove('hidden');
  }

  document.querySelectorAll('input[name="calcMode"]').forEach((el) => {
    el.addEventListener('change', () => setCalcMode(el.value));
  });

  document.getElementById('btnAddLine')?.addEventListener('click', () => addLineRow(services[0]?.id, 1000));

  document.getElementById('btnCalc')?.addEventListener('click', async () => {
    const items = gatherLines().filter((x) => x.service_id && x.area_sqft > 0);
    if (!items.length) {
      alert('Add at least one service with area.');
      return;
    }
    const r = await window.builderAuth.fetch('/api/pricing/calculate-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Error');
      return;
    }
    lastResult = j.data;
    savedCalculationId = null;
    renderResults(j.data);
    document.getElementById('calcShareNote')?.classList.add('hidden');
  });

  document.getElementById('btnSaveCalc')?.addEventListener('click', async () => {
    if (!lastResult) {
      alert('Calculate first.');
      return;
    }
    const defaultLabel = calcMode === 'full' ? 'Full project estimate' : 'Quick estimate';
    const label = prompt('Label for this estimate (optional):', defaultLabel);
    if (label === null) return;
    const body = {
      label: label || null,
      items: lastResult.lines,
      totals: lastResult.totals,
    };
    if (savedCalculationId) body.id = savedCalculationId;
    const r = await window.builderAuth.fetch('/api/builder-calculations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Could not save');
      return;
    }
    savedCalculationId = j.data?.id || savedCalculationId;
    alert('Estimate saved.');
    loadRecent();
  });

  document.getElementById('btnShareCalc')?.addEventListener('click', async () => {
    if (!lastResult) {
      alert('Calculate first.');
      return;
    }
    let sharePath = null;
    let shareExpires = null;

    if (savedCalculationId) {
      const sr = await window.builderAuth.fetch(`/api/builder-calculations/${savedCalculationId}/share`, {
        method: 'POST',
      });
      const sj = await sr.json();
      if (!sr.ok) {
        alert(sj.error || 'Could not create share link');
        return;
      }
      sharePath = sj.data.share_path;
      shareExpires = sj.data.share_expires_at;
    } else {
      const r = await window.builderAuth.fetch('/api/builder-calculations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Shared estimate',
          items: lastResult.lines,
          totals: lastResult.totals,
          generate_share: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error || 'Could not create share link');
        return;
      }
      savedCalculationId = j.data.id;
      sharePath = j.data.share_path;
      shareExpires = j.data.share_expires_at;
      loadRecent();
    }

    const url = `${location.origin}${sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`Share link copied. Valid for ${SHARE_EXPIRY_DAYS} days.`);
    } catch {
      prompt('Copy this link:', url);
    }
    showShareNote(shareExpires);
  });

  document.getElementById('btnPrintCalc')?.addEventListener('click', printEstimatePdf);

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      if (!window.builderAuth?.getToken()) return;
      await loadServices();
      setCalcMode('quick');
      loadRecent();
      const params = new URLSearchParams(location.search);
      if (params.get('service_id')) {
        clearLines();
        addLineRow(params.get('service_id'), params.get('sqft') || 1000);
      }
      const loadId = parseInt(params.get('load'), 10);
      if (loadId) {
        try {
          const r = await window.builderAuth.fetch(`/api/builder-calculations/${loadId}`);
          const j = await r.json();
          if (j.success && j.data) reopenEstimate(j.data);
        } catch (_) {}
      }
    }, 120);
  });
})();
