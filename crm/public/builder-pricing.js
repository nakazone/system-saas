/**
 * Builder portal  partner pricing (read-only static table).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const VOLUME_DISCOUNTS = [
    { range: '500 - 999 sq ft', pct: 5 },
    { range: '1,000 - 2,499 sq ft', pct: 8 },
    { range: '2,500 - 4,999 sq ft', pct: 12 },
    { range: '5,000+ sq ft', pct: 15 },
  ];

  /** Example complete projects  service lines resolved by name against partner table */
  const PROJECT_SIMULATIONS = [
    {
      id: 'condo-refresh',
      title: 'Condo hardwood refresh',
      tag: 'Small',
      description: '2-bedroom condo: refinish existing hardwood and subfloor prep in living areas.',
      scope: ['Refinish ~1,200 sq ft', 'Subfloor prep'],
      items: [
        { match: ['sanding', 'refinishing'], area_sqft: 1200 },
        { match: ['subfloor'], area_sqft: 1200 },
      ],
    },
    {
      id: 'whole-home',
      title: 'Whole-home hardwood install',
      tag: 'Medium',
      description: 'Single-family home: new solid hardwood on main level with full subfloor preparation.',
      scope: ['Install ~2,800 sq ft', 'Subfloor prep', '8% volume discount'],
      items: [
        { match: ['hardwood installation'], exclude: ['engineered', 'lvp', 'vinyl', 'tile'], area_sqft: 2800 },
        { match: ['subfloor'], area_sqft: 2800 },
      ],
    },
    {
      id: 'luxury-mixed',
      title: 'Luxury mixed-floor remodel',
      tag: 'Large',
      description: 'High-end remodel: engineered wood main areas, tile baths, custom stairs, and prep.',
      scope: ['Engineered ~3,200 sq ft', 'Tile ~800 sq ft', '16 stairs', '12% volume discount'],
      items: [
        { match: ['engineered'], area_sqft: 3200 },
        { match: ['tile', 'stone'], area_sqft: 800 },
        { match: ['stairs', 'patterns'], area_sqft: 16 },
        { match: ['subfloor'], area_sqft: 4000 },
      ],
    },
  ];

  let portalPricingData = [];
  let portalMeta = {};
  let simulationResults = {};
  let activeSimulationId = null;

  function closeSimulationDetail() {
    activeSimulationId = null;
    const host = document.getElementById('pricingSimDetail');
    if (host) {
      host.classList.add('hidden');
      host.innerHTML = '';
    }
    renderSimulationCards();
  }

  function money(n) {
    return '$' + (Number(n) || 0).toFixed(2);
  }

  function moneyShort(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function resolveServiceItem(spec) {
    const match = spec.match || [];
    const exclude = spec.exclude || [];
    return portalPricingData.find((s) => {
      if (s.is_locked) return false;
      const name = String(s.name || '').toLowerCase();
      if (exclude.some((ex) => name.includes(String(ex).toLowerCase()))) return false;
      return match.some((m) => name.includes(String(m).toLowerCase()));
    });
  }

  function buildSimulationPayload(sim) {
    const items = [];
    const missing = [];
    for (const line of sim.items) {
      const svc = resolveServiceItem(line);
      if (!svc) {
        missing.push(line.match.join(' / '));
        continue;
      }
      items.push({ service_id: svc.id, area_sqft: line.area_sqft });
    }
    return { items, missing };
  }

  async function calculateSimulation(sim) {
    const { items, missing } = buildSimulationPayload(sim);
    if (!items.length) {
      return { ok: false, error: 'Pricing lines not available', missing };
    }
    const r = await window.builderAuth.fetch('/api/pricing/calculate-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const j = await r.json();
    if (!r.ok || !j.success) {
      return { ok: false, error: j.error || 'Could not calculate', missing };
    }
    return { ok: true, data: j.data, missing, itemCount: items.length };
  }

  function simulationTotalSqft(data) {
    return (data?.lines || []).reduce((s, l) => s + (Number(l.area_sqft) || 0), 0);
  }

  function renderSimulationDetail(sim, result) {
    const host = document.getElementById('pricingSimDetail');
    if (!host) return;
    if (!result?.ok) {
      host.classList.remove('hidden');
      host.innerHTML = `<div class="bp-card bp-pricing-sim-detail">
        <p class="bp-muted">${escapeHtml(result?.error || 'Simulation unavailable')}</p>
      </div>`;
      return;
    }
    const t = result.data.totals;
    const lines = result.data.lines || [];
    const volPct = Math.max(0, ...lines.map((l) => l.volume_discount_pct || 0));
    host.classList.remove('hidden');
    host.innerHTML = `<div class="bp-card bp-pricing-sim-detail">
      <div class="bp-pricing-sim-detail__head">
        <div>
          <p class="bp-eyebrow">Simulation</p>
          <h3 class="bp-title" style="font-size:1.1rem;margin:0">${escapeHtml(sim.title)}</h3>
          <p class="bp-muted" style="margin:6px 0 0">${escapeHtml(sim.description)}</p>
        </div>
        <div class="bp-pricing-sim-detail__total">
          <span class="bp-pricing-sim-detail__range">${moneyShort(t.estimate_low_discounted)} &ndash; ${moneyShort(t.estimate_high_discounted)}</span>
          <span class="bp-muted" style="font-size:12px">Partner estimate (after discounts)</span>
        </div>
      </div>
      <ul class="bp-pricing-sim-scope">${sim.scope.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      ${volPct ? `<p class="bp-pricing-sim-vol">Includes up to <strong>${volPct}%</strong> volume discount on qualifying lines.</p>` : ''}
      <div class="bp-table-wrap" style="margin-top:12px"><table class="bp-table bp-pricing-sim-table"><thead><tr>
        <th>Service</th><th>Qty</th><th>Volume</th><th>Partner total</th><th>Public range</th>
      </tr></thead><tbody>${lines
        .map(
          (l) => `<tr>
            <td data-label="Service">${escapeHtml(l.service)}</td>
            <td data-label="Qty">${l.area_sqft} ${escapeHtml(l.unit || 'sq ft')}</td>
            <td data-label="Volume">${l.volume_discount_pct ? l.volume_discount_pct + '%' : '&mdash;'}</td>
            <td data-label="Partner">${moneyShort(l.estimate_low_discounted)} &ndash; ${moneyShort(l.estimate_high_discounted)}</td>
            <td data-label="Public">${moneyShort(l.public_estimate_low)} &ndash; ${moneyShort(l.public_estimate_high)}</td>
          </tr>`
        )
        .join('')}</tbody></table></div>
      <p class="bp-muted" style="font-size:12px;margin-top:10px">Illustrative only. Final quotes depend on site conditions, materials, and scope confirmed by Senior Floors.</p>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
        <a href="builder-calculator.html" class="bp-btn-tan" style="text-decoration:none">Customize in calculator</a>
        <a href="builder-estimate-request.html" class="bp-btn-ghost" style="text-decoration:none">Request formal estimate</a>
      </div>
    </div>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderSimulationCards() {
    const grid = document.getElementById('pricingSimsGrid');
    if (!grid) return;
    grid.innerHTML = PROJECT_SIMULATIONS.map((sim) => {
      const result = simulationResults[sim.id];
      let rangeHtml = '<span class="bp-pricing-sim-card__loading">Calculating...</span>';
      if (result?.ok) {
        const t = result.data.totals;
        rangeHtml = `<span class="bp-pricing-sim-card__range">${moneyShort(t.estimate_low_discounted)} &ndash; ${moneyShort(t.estimate_high_discounted)}</span>`;
      } else if (result && !result.ok) {
        rangeHtml = '<span class="bp-pricing-sim-card__loading">Unavailable</span>';
      }
      const active = activeSimulationId === sim.id ? ' bp-pricing-sim-card--active' : '';
      return `<button type="button" class="bp-pricing-sim-card${active}" data-sim-id="${sim.id}">
        <span class="bp-pricing-sim-card__tag">${escapeHtml(sim.tag)}</span>
        <span class="bp-pricing-sim-card__title">${escapeHtml(sim.title)}</span>
        <p class="bp-pricing-sim-card__desc">${escapeHtml(sim.description)}</p>
        ${rangeHtml}
        <span class="bp-pricing-sim-card__cta">${activeSimulationId === sim.id ? 'Hide breakdown' : 'View full breakdown'}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('[data-sim-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.simId;
        if (activeSimulationId === id) {
          closeSimulationDetail();
          return;
        }
        activeSimulationId = id;
        renderSimulationCards();
        const sim = PROJECT_SIMULATIONS.find((s) => s.id === id);
        if (sim) renderSimulationDetail(sim, simulationResults[id]);
      });
    });
  }

  async function loadSimulations() {
    simulationResults = {};
    await Promise.all(
      PROJECT_SIMULATIONS.map(async (sim) => {
        try {
          simulationResults[sim.id] = await calculateSimulation(sim);
        } catch {
          simulationResults[sim.id] = { ok: false, error: 'Network error' };
        }
      })
    );
    renderSimulationCards();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function noteTooltipHtml(notes) {
    if (!notes) return '';
    return `<span class="bp-tooltip-wrap">
      <button type="button" class="bp-info-btn" aria-label="Service notes">i</button>
      <span class="bp-tooltip" role="tooltip">${escapeHtml(notes)}</span>
    </span>`;
  }

  function renderVolume(el) {
    if (!el) return;
    el.innerHTML = `<ul style="margin:0;padding-left:1.2rem">${VOLUME_DISCOUNTS.map(
      (v) => `<li>${v.range}: <strong>${v.pct}%</strong> off partner rate</li>`
    ).join('')}</ul>`;
  }

  function openInlineCalc(serviceId) {
    const svc = portalPricingData.find((s) => s.id === serviceId);
    if (!svc || svc.is_locked) return;
    let modal = document.getElementById('bpPricingCalcModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bpPricingCalcModal';
      modal.className = 'bp-modal';
      document.body.appendChild(modal);
    }
    modal.classList.add('open');
    modal.innerHTML = `<div class="bp-modal__box">
      <h2 class="bp-title">${escapeHtml(svc.name)}</h2>
      <p class="bp-muted">Quick estimate at your partner rate</p>
      <label style="font-size:12px;display:block;margin:12px 0 6px">Area (sq ft)
        <input type="number" id="inlineCalcArea" value="1000" min="100" style="width:100%;padding:8px;margin-top:4px;border-radius:8px;border:1px solid var(--bp-border);box-sizing:border-box" />
      </label>
      <div id="inlineCalcResult" class="bp-card hidden" style="margin-top:12px;background:var(--bp-navy);color:#fff"></div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="bp-btn-tan" id="inlineCalcRun">Calculate</button>
        <button type="button" class="bp-btn-ghost" id="inlineCalcClose">Close</button>
      </div>
    </div>`;
    modal.querySelector('#inlineCalcClose')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
    modal.querySelector('#inlineCalcRun')?.addEventListener('click', async () => {
      const area = parseInt(document.getElementById('inlineCalcArea')?.value, 10) || 0;
      const r = await window.builderAuth.fetch('/api/pricing/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: serviceId, area_sqft: area }),
      });
      const j = await r.json();
      const box = document.getElementById('inlineCalcResult');
      if (!r.ok) {
        box.classList.remove('hidden');
        box.textContent = j.error || 'Error';
        return;
      }
      const d = j.data;
      box.classList.remove('hidden');
      box.innerHTML = `<p style="margin:0">${money(d.estimate_low_discounted)} - ${money(d.estimate_high_discounted)}</p>
        <p style="font-size:12px;margin:6px 0 0;opacity:0.85">${d.volume_discount_pct ? d.volume_discount_pct + '% volume discount' : 'Partner rate'}</p>`;
    });
  }

  async function fetchPricingPdfBlob() {
    const r = await window.builderAuth.fetch('/api/pricing/partner/pdf');
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'Could not generate PDF');
    }
    return r.blob();
  }

  function setPdfButtonsLoading(loading) {
    ['btnViewPricingPdf', 'btnDownloadPricing'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.disabled = loading;
    });
    const viewBtn = document.getElementById('btnViewPricingPdf');
    const dlBtn = document.getElementById('btnDownloadPricing');
    if (!loading) {
      if (viewBtn) viewBtn.textContent = 'View PDF';
      if (dlBtn) dlBtn.textContent = 'Download PDF';
    } else {
      if (viewBtn) viewBtn.textContent = 'Loading...';
      if (dlBtn) dlBtn.textContent = 'Loading...';
    }
  }

  async function viewPricingPdf() {
    setPdfButtonsLoading(true);
    try {
      const blob = await fetchPricingPdfBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      setPdfButtonsLoading(false);
    }
  }

  async function downloadPricingPdf() {
    setPdfButtonsLoading(true);
    try {
      const blob = await fetchPricingPdfBlob();
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `senior-floors-partner-pricing-${stamp}.pdf`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert(e.message || 'PDF error');
    } finally {
      setPdfButtonsLoading(false);
    }
  }

  async function loadPortal() {
    const r = await window.builderAuth.fetch('/api/pricing/partner');
    const j = await r.json();
    if (!r.ok || !j.success) {
      $('portalPricingRoot').innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Could not load pricing')}</p>`;
      return;
    }
    portalPricingData = j.data || [];
    portalMeta = j.meta || {};
    const root = $('portalPricingRoot');
    const validLine = portalMeta.valid_through
      ? `Table valid through <strong>${escapeHtml(portalMeta.valid_through)}</strong> - Last updated ${escapeHtml(String(portalMeta.last_updated || '').slice(0, 10))}`
      : 'Partner rates - contact Senior Floors for an updated table.';
    const rows = portalPricingData
      .map((s) => {
        if (s.is_locked) {
          return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.category_label || '')}</td><td colspan="3"><em>Contact your manager</em> <a href="builder-messages.html" class="bp-btn-tan bp-btn-sm" style="text-decoration:none;margin-left:8px">Request quote</a></td></tr>`;
        }
        return `<tr>
          <td>${escapeHtml(s.name)} ${noteTooltipHtml(s.notes)}</td>
          <td>${escapeHtml(s.category_label || '')}</td>
          <td>${escapeHtml(s.unit || '')}</td>
          <td>${money(s.price_min)} - ${money(s.price_max)}</td>
          <td><span class="bp-badge bp-badge--active">${money(s.partner_price)}</span>
            <button type="button" class="bp-btn-ghost bp-btn-sm" data-calc="${s.id}" style="margin-left:6px">Calc</button></td>
        </tr>`;
      })
      .join('');
    const hdr =
      window.builderPortalCommon?.pageHeaderHtml?.({
        title: 'Partner pricing',
        subtitle: 'Read-only partner rate sheet. Contact Senior Floors to request changes.',
        actionsHtml: `<button type="button" class="bp-btn-ghost" id="btnViewPricingPdf">View PDF</button>
        <button type="button" class="bp-btn-tan" id="btnDownloadPricing">Download PDF</button>`,
      }) || '<h1 class="bp-title">Partner pricing</h1>';
    root.innerHTML = `${hdr}
      <p class="bp-muted">${validLine}</p>
      <h2 class="bp-pricing-table-title">Rate sheet</h2>
      <div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Service</th><th>Category</th><th>Unit</th><th>Public range</th><th>Your price</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h2 style="font-size:1rem;margin-top:1.5rem">Volume discounts</h2>
      <div class="bp-card" id="volPortal"></div>
      <section class="bp-pricing-sims" aria-labelledby="pricingSimsTitle">
        <h2 id="pricingSimsTitle" class="bp-pricing-sims__title">Project simulations</h2>
        <p class="bp-muted bp-pricing-sims__intro">Three example complete projects using your current partner rates. Click one to open the full breakdown.</p>
        <div class="bp-pricing-sims__grid" id="pricingSimsGrid"></div>
        <div id="pricingSimDetail" class="hidden" aria-live="polite"></div>
      </section>
      <p style="margin-top:1rem"><a href="builder-calculator.html" class="bp-btn-tan" style="text-decoration:none;display:inline-block;margin-right:8px">Open calculator</a>
      <a href="builder-estimate-request.html" class="bp-btn-ghost" style="text-decoration:none;display:inline-block">Request formal estimate</a></p>`;
    renderVolume($('volPortal'));
    document.getElementById('btnViewPricingPdf')?.addEventListener('click', viewPricingPdf);
    document.getElementById('btnDownloadPricing')?.addEventListener('click', downloadPricingPdf);
    root.querySelectorAll('[data-calc]').forEach((btn) => {
      btn.addEventListener('click', () => openInlineCalc(parseInt(btn.dataset.calc, 10)));
    });
    void loadSimulations();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (typeof boot === 'function') {
      boot().then((ok) => {
        if (ok) loadPortal();
      });
    } else if (window.builderAuth?.requireAuth?.()) {
      loadPortal();
    }
  });
})();
