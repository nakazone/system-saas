/**
 * Quick Quote (on-site) — 2-step flow: build everything on one scroll, then review & save.
 * POST /api/customers + POST /api/quotes/full; ERP preview for products.
 */
(function () {
  const OS_TOTAL_STEPS = 2;

  function osToast(msg, type) {
    if (window.crmToast && typeof window.crmToast.show === 'function') {
      window.crmToast.show(msg, { type: type === 'error' ? 'error' : type === 'info' ? 'info' : 'success' });
    } else {
      alert(msg);
    }
  }

  const INSTALL_RATE = 4;
  const SAND_RATE = 3.5;

  const ADDON_DEFS = [
    { id: 'baseboards', label: 'Baseboards', sub: '+$2.00/ft', rate: 2, unit: 'linear_ft', defaultQty: (sq) => Math.max(80, Math.round(sq * 0.35)) },
    { id: 'stairs', label: 'Stairs', sub: '+$85 each', rate: 85, unit: 'piece', defaultQty: 0 },
    { id: 'removal', label: 'Floor removal', sub: '+$1.50/sqft', rate: 1.5, unit: 'sq_ft', defaultQty: (sq) => sq },
    { id: 'furniture', label: 'Furniture moving', sub: 'Flat fee', rate: 250, unit: 'fixed', defaultQty: 1 },
  ];

  const state = {
    step: 1,
    view: 'steps',
    client: { name: '', email: '', phone: '', address: '' },
    measureMode: 'total',
    totalSqft: 0,
    rooms: [],
    service: 'installation',
    materialSource: 'we',
    productSearch: '',
    product: null,
    productQty: 0,
    addons: { baseboards: false, stairs: false, removal: false, furniture: false },
    addonQty: { baseboards: null, stairs: 0, removal: null, furniture: 1 },
    customLines: [],
    photos: [],
    quoteId: null,
    gbbChoice: null,
    gbbSendGateDone: false,
    customerId: null,
    mapsKey: null,
    autocomplete: null,
    nominatimTimer: null,
    speechRec: null,
  };

  const $ = (id) => document.getElementById(id);

  function money(n) {
    const x = Number(n) || 0;
    return `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function effectiveSqft() {
    if (state.measureMode === 'total') return Math.max(0, Number(state.totalSqft) || 0);
    return state.rooms.reduce((s, r) => s + (Math.max(0, Number(r.sqft) || 0)), 0);
  }

  function syncHeroSqftVisibility() {
    const ed = $('heroSqftEditable');
    const ro = $('heroSqftReadonly');
    if (!ed || !ro) return;
    const rooms = state.measureMode === 'rooms';
    ed.classList.toggle('hidden', rooms);
    ro.classList.toggle('hidden', !rooms);
    const h = $('heroEffectiveSqft');
    if (h) h.textContent = String(effectiveSqft());
  }

  function svcLabel() {
    if (state.service === 'sand') return 'Sand & Finishing';
    if (state.service === 'both') return 'Installation + Sand & Finishing';
    return 'Installation';
  }

  function buildServiceLines(sq) {
    const lines = [];
    if (state.service === 'installation' || state.service === 'both') {
      lines.push({
        name: 'Installation',
        service_type: 'Installation',
        quantity: sq,
        rate: INSTALL_RATE,
        unit_type: 'sq_ft',
        type: 'service',
      });
    }
    if (state.service === 'sand' || state.service === 'both') {
      lines.push({
        name: 'Sand & Finishing',
        service_type: 'Sand & Finishing',
        quantity: sq,
        rate: SAND_RATE,
        unit_type: 'sq_ft',
        type: 'service',
      });
    }
    return lines;
  }

  function buildAddonLines(sq) {
    const lines = [];
    for (const d of ADDON_DEFS) {
      if (!state.addons[d.id]) continue;
      let qty = state.addonQty[d.id];
      if (qty == null || qty === '') {
        qty = typeof d.defaultQty === 'function' ? d.defaultQty(sq) : d.defaultQty;
      }
      qty = Math.max(0, Number(qty) || 0);
      if (qty <= 0 && d.id !== 'furniture') continue;
      if (d.id === 'furniture' && qty <= 0) continue;
      const rate = d.rate;
      lines.push({
        name: d.label,
        service_type: 'Installation',
        quantity: qty,
        rate,
        unit_type: d.unit,
        type: 'service',
        description: d.sub,
      });
    }
    return lines;
  }

  function buildMaterialLine(sq) {
    if (state.materialSource !== 'we' || !state.product) return [];
    const qty = Math.max(0, Number(state.productQty) || 0);
    if (qty <= 0) return [];
    const p = state.product;
    return [
      {
        item_type: 'product',
        product_id: p.id,
        name: p.name,
        quantity: qty,
        rate: p.sell,
        unit_type: p.unit_type || 'sq_ft',
        type: 'material',
        cost_price: p.cost,
        markup_percentage: p.margin,
      },
    ];
  }

  function buildCustomLines() {
    return state.customLines.map((c) => ({
      name: c.name,
      service_type: 'Installation',
      quantity: 1,
      rate: c.amount,
      unit_type: 'fixed',
      type: 'service',
    }));
  }

  function lineTotal(line) {
    const q = Number(line.quantity) || 0;
    const r = Number(line.rate) || 0;
    return Math.round(q * r * 100) / 100;
  }

  function sumLines(lines) {
    return lines.reduce((s, l) => s + lineTotal(l), 0);
  }

  function computeBreakdown() {
    const sq = effectiveSqft();
    const services = buildServiceLines(sq);
    const addons = buildAddonLines(sq);
    const materials = buildMaterialLine(sq);
    const custom = buildCustomLines();
    return {
      sq,
      material: sumLines(materials),
      total: sumLines(services) + sumLines(addons) + sumLines(materials) + sumLines(custom),
      services,
      addons,
      materials,
      custom,
    };
  }

  function applyGbbTier(tier) {
    state.gbbChoice = tier;
    if (tier === 'basic') {
      state.addons = { baseboards: false, stairs: false, removal: false, furniture: false };
    } else if (tier === 'standard') {
      state.addons = { baseboards: true, stairs: false, removal: true, furniture: false };
    } else {
      state.addons = { baseboards: true, stairs: true, removal: true, furniture: true };
      state.addonQty.stairs = Math.max(1, state.addonQty.stairs || 1);
    }
  }

  function buildItemsForApi() {
    const b = computeBreakdown();
    return [...b.services, ...b.addons, ...b.materials, ...b.custom];
  }

  function renderStepper() {
    const dots = $('stepperDots');
    dots.innerHTML = '';
    for (let i = 1; i <= OS_TOTAL_STEPS; i += 1) {
      const d = document.createElement('span');
      d.className = 'os-step-dot' + (i === state.step ? ' os-step-dot--on' : '');
      d.title = i === 1 ? 'Build' : 'Save';
      dots.appendChild(d);
    }
    const lab = $('stepLabel');
    if (lab) {
      if (state.view === 'gbb') lab.textContent = 'Packages';
      else if (state.step === 1) lab.textContent = 'Build';
      else lab.textContent = 'Save';
    }
  }

  function renderPricingBar() {
    const b = computeBreakdown();
    $('pricingTotal').textContent = money(b.total);
  }

  function syncPanels() {
    const fab = $('fabAdd');
    if (state.view === 'gbb') {
      document.querySelectorAll('.step-panel').forEach((el) => el.classList.add('hidden'));
      $('panelGbb').classList.remove('hidden');
      $('footerNav').classList.add('hidden');
      $('footerFinal').classList.add('hidden');
      if (fab) fab.classList.add('hidden');
      renderGbb();
      return;
    }
    $('panelGbb').classList.add('hidden');
    const b = $('osPanelBuild');
    const r = $('osPanelReview');
    if (b) b.classList.toggle('hidden', state.step !== 1);
    if (r) r.classList.toggle('hidden', state.step !== 2);
    const final = state.step === 2;
    $('footerNav').classList.toggle('hidden', final);
    $('footerFinal').classList.toggle('hidden', !final);
    $('btnBack').classList.toggle('hidden', state.step <= 1);
    const nextBtn = $('btnNext');
    if (nextBtn) {
      nextBtn.classList.toggle('hidden', final);
      if (!final) nextBtn.textContent = 'Review & save →';
    }
    if (fab) fab.classList.toggle('hidden', state.step !== 1);
  }

  function renderRooms() {
    const host = $('roomList');
    host.innerHTML = '';
    state.rooms.forEach((r, idx) => {
      const row = document.createElement('div');
      row.className = 'flex gap-2 items-center';
      row.innerHTML = `
        <input type="text" data-i="${idx}" data-k="name" class="flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm" value="${escapeAttr(r.name)}" />
        <input type="number" data-i="${idx}" data-k="sqft" min="0" step="1" class="w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm tabular-nums" value="${r.sqft}" />
        <button type="button" data-del="${idx}" class="text-red-500 font-bold px-2">✕</button>`;
      host.appendChild(row);
    });
    host.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.i;
        const k = inp.dataset.k;
        if (k === 'name') state.rooms[i].name = inp.value;
        else state.rooms[i].sqft = Math.max(0, Number(inp.value) || 0);
        renderRoomSum();
        renderPricingBar();
      });
    });
    host.querySelectorAll('button[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.rooms.splice(+btn.dataset.del, 1);
        if (!state.rooms.length) state.rooms.push({ name: 'Room', sqft: 0 });
        renderRooms();
        renderRoomSum();
        renderPricingBar();
      });
    });
    renderRoomSum();
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function renderRoomSum() {
    const el = $('roomSumDisplay');
    if (el) el.textContent = `${effectiveSqft()} sqft`;
    const hero = $('heroEffectiveSqft');
    if (hero) hero.textContent = String(effectiveSqft());
  }

  function renderAddonToggles() {
    const host = $('addonToggles');
    const sq = effectiveSqft();
    host.innerHTML = '';
    ADDON_DEFS.forEach((d) => {
      const row = document.createElement('label');
      row.className =
        'flex items-center justify-between gap-2 py-2.5 px-1 border-b border-slate-100 last:border-0 cursor-pointer';
      const checked = !!state.addons[d.id];
      const qtyVal =
        state.addonQty[d.id] != null && state.addonQty[d.id] !== ''
          ? state.addonQty[d.id]
          : typeof d.defaultQty === 'function'
            ? d.defaultQty(sq)
            : d.defaultQty;
      row.innerHTML = `
        <span class="flex items-center gap-2 min-w-0">
          <input type="checkbox" data-addon="${d.id}" class="rounded border-slate-300 w-5 h-5 shrink-0" ${checked ? 'checked' : ''} />
          <span class="min-w-0"><span class="font-semibold text-slate-800 text-sm">${d.label}</span> <span class="text-[11px] text-slate-500">${d.sub}</span></span>
        </span>
        <input type="number" min="0" step="1" data-addon-qty="${d.id}" class="w-[4.5rem] rounded-lg border border-slate-200 px-1.5 py-1 text-xs tabular-nums shrink-0 ${checked ? '' : 'opacity-40'}" value="${qtyVal}" />
      `;
      host.appendChild(row);
    });
    host.querySelectorAll('input[data-addon]').forEach((cb) => {
      cb.addEventListener('change', () => {
        state.addons[cb.dataset.addon] = cb.checked;
        renderAddonToggles();
        renderPricingBar();
      });
    });
    host.querySelectorAll('input[data-addon-qty]').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.addonQty[inp.dataset.addonQty] = inp.value === '' ? '' : Number(inp.value);
        renderPricingBar();
      });
    });
  }

  function renderSummary() {
    const b = computeBreakdown();
    const svcTotal = sumLines(b.services) + sumLines(b.custom);
    const addTotal = sumLines(b.addons);
    const lines = $('summaryLines');
    lines.innerHTML = `
      <div class="flex justify-between"><span class="text-slate-600">Installation</span><span class="font-semibold tabular-nums">${money(svcTotal)}</span></div>
      <div class="flex justify-between"><span class="text-slate-600">Material</span><span class="font-semibold tabular-nums">${money(b.material)}</span></div>
      <div class="flex justify-between"><span class="text-slate-600">Add-ons</span><span class="font-semibold tabular-nums">${money(addTotal)}</span></div>
    `;
    $('summaryTotal').textContent = money(b.total);
  }

  function gbbTotals() {
    const sq = effectiveSqft();
    const base = {
      basic: { mult: 1, materialMult: 1 },
      standard: { mult: 1, materialMult: 1 },
      premium: { mult: 1.08, materialMult: 1.12 },
    };
    const tiers = ['basic', 'standard', 'premium'];
    const out = {};
    tiers.forEach((t) => {
      const prev = { ...state.addons };
      const prevQty = { ...state.addonQty };
      applyGbbTier(t);
      const b = computeBreakdown();
      let total = b.total * base[t].mult;
      total = Math.round(total * base[t].materialMult * 100) / 100;
      out[t] = total;
      state.addons = prev;
      state.addonQty = prevQty;
    });
    return out;
  }

  function renderGbb() {
    const totals = gbbTotals();
    const cards = $('gbbCards');
    const desc = {
      basic: 'Installation focus — minimal add-ons',
      standard: 'Installation · Baseboards · Removal',
      premium: 'Premium bundle · stairs · full service',
    };
    cards.innerHTML = ['basic', 'standard', 'premium']
      .map(
        (t) => `
      <button type="button" data-tier="${t}" class="w-full text-left rounded-2xl border-2 border-slate-200 p-4 os-card-tap hover:border-[#d6b598]">
        <div class="font-bold text-[#1a2036] capitalize">${t === 'standard' ? 'Standard ⭐' : t}</div>
        <div class="text-2xl font-bold text-[#1a2036] mt-1 tabular-nums">${money(totals[t])}</div>
        <div class="text-xs text-slate-500 mt-2">${desc[t]}</div>
      </button>`
      )
      .join('');
    cards.querySelectorAll('button[data-tier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyGbbTier(btn.dataset.tier);
        state.gbbSendGateDone = true;
        state.view = 'steps';
        state.step = 2;
        syncPanels();
        renderStepper();
        renderSummary();
        renderPricingBar();
        renderAddonToggles();
      });
    });
  }

  async function api(path, opt = {}) {
    const { headers: hdr, ...rest } = opt;
    const headers = { ...hdr };
    if (rest.body != null && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(path, { credentials: 'include', ...rest, headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || r.statusText);
    return j;
  }

  async function ensureCustomer() {
    if (state.customerId) return state.customerId;
    const emailRaw = state.client.email.trim();
    const email =
      emailRaw ||
      `onsite.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@quote.seniorfloors.local`;
    const body = {
      name: state.client.name.trim(),
      email,
      phone: state.client.phone.trim() || '—',
      address: state.client.address.trim() || null,
      customer_type: 'residential',
    };
    const res = await api('/api/customers', { method: 'POST', body: JSON.stringify(body) });
    state.customerId = res.data.id;
    return state.customerId;
  }

  async function persistQuote(status) {
    const items = buildItemsForApi();
    if (!items.length) throw new Error('Add at least one line (check sq ft and service).');
    const b = computeBreakdown();
    const notesParts = [
      'On-Site Quote (mobile)',
      state.client.address ? `Job address: ${state.client.address}` : null,
      state.photos.length ? `${state.photos.length} photo(s) noted on device` : null,
    ].filter(Boolean);
    const payload = {
      customer_id: await ensureCustomer(),
      status,
      items,
      subtotal: b.total,
      discount_type: 'percentage',
      discount_value: 0,
      tax_total: 0,
      notes: notesParts.join('\n'),
      service_type: svcLabel(),
    };
    if (state.quoteId) {
      const u = await api(`/api/quotes/${state.quoteId}/full`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return u.data;
    }
    const c = await api('/api/quotes/full', { method: 'POST', body: JSON.stringify(payload) });
    const q = c.data && c.data.quote;
    state.quoteId = q && q.id != null ? Number(q.id) : null;
    if (!state.quoteId) throw new Error('Quote created but id missing in response');
    return c.data;
  }

  async function loadUiConfig() {
    try {
      const j = await api('/api/config/ui');
      state.mapsKey = j.data?.googleMapsJsKey || null;
      $('placesHint').classList.toggle('hidden', !state.mapsKey);
      if (state.mapsKey) loadGoogleScript(state.mapsKey);
    } catch {
      state.mapsKey = null;
    }
  }

  function loadGoogleScript(key) {
    if (window.google?.maps?.places) {
      initPlaces();
      return;
    }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=__osqPlacesInit`;
    s.async = true;
    window.__osqPlacesInit = () => {
      initPlaces();
      delete window.__osqPlacesInit;
    };
    document.head.appendChild(s);
  }

  function initPlaces() {
    const input = $('clientAddress');
    if (!input || !window.google?.maps?.places) return;
    try {
      state.autocomplete = new google.maps.places.Autocomplete(input, {
        fields: ['formatted_address', 'geometry'],
        types: ['address'],
      });
      state.autocomplete.addListener('place_changed', () => {
        const p = state.autocomplete.getPlace();
        if (p.formatted_address) state.client.address = p.formatted_address;
        $('clientAddress').value = state.client.address;
      });
    } catch (e) {
      console.warn('Places init', e);
    }
  }

  function nominatimSuggest(q) {
    if (q.length < 3) {
      $('addressSuggestions').classList.add('hidden');
      return;
    }
    clearTimeout(state.nominatimTimer);
    state.nominatimTimer = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        const rows = await r.json();
        const box = $('addressSuggestions');
        box.innerHTML = '';
        if (!rows.length) {
          box.classList.add('hidden');
          return;
        }
        rows.forEach((row) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800';
          b.textContent = row.display_name;
          b.addEventListener('click', () => {
            state.client.address = row.display_name;
            $('clientAddress').value = row.display_name;
            box.classList.add('hidden');
          });
          box.appendChild(b);
        });
        box.classList.remove('hidden');
      } catch {
        $('addressSuggestions').classList.add('hidden');
      }
    }, 350);
  }

  function bind() {
    const navToggle = $('btnToggleCrmNav');
    const osTop = $('osTopFixed');
    const mainScroll = $('mainScroll');
    function applyOsCrmNavCollapse(collapsed) {
      if (!osTop || !mainScroll) return;
      osTop.classList.toggle('os-crm-nav-collapsed', collapsed);
      mainScroll.classList.toggle('os-pt-compact', collapsed);
      if (navToggle) {
        navToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        navToggle.textContent = collapsed ? 'Menu' : 'Ocultar';
        navToggle.setAttribute('title', collapsed ? 'Mostrar navegação CRM' : 'Ocultar navegação CRM');
      }
      try {
        localStorage.setItem('osCrmNavCollapsed', collapsed ? '1' : '0');
      } catch (_) {
        /* ignore */
      }
    }
    if (navToggle && osTop && mainScroll) {
      let startCollapsed = false;
      try {
        startCollapsed = localStorage.getItem('osCrmNavCollapsed') === '1';
      } catch (_) {
        startCollapsed = false;
      }
      applyOsCrmNavCollapse(startCollapsed);
      navToggle.addEventListener('click', () => {
        applyOsCrmNavCollapse(!osTop.classList.contains('os-crm-nav-collapsed'));
      });
    }

    $('clientName').addEventListener('input', (e) => {
      state.client.name = e.target.value;
    });
    $('clientEmail').addEventListener('input', (e) => {
      state.client.email = e.target.value;
    });
    $('clientPhone').addEventListener('input', (e) => {
      state.client.phone = e.target.value;
    });
    $('clientAddress').addEventListener('input', (e) => {
      state.client.address = e.target.value;
      if (!state.mapsKey) nominatimSuggest(e.target.value.trim());
    });

    $('btnUseLocation').addEventListener('click', () => {
      if (!navigator.geolocation) {
        osToast('Geolocation not available.', 'error');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`;
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            const j = await r.json();
            const addr = j.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            state.client.address = addr;
            $('clientAddress').value = addr;
          } catch {
            state.client.address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            $('clientAddress').value = state.client.address;
          }
        },
        () => osToast('Could not read location — check permissions.', 'error')
      );
    });

    $('modeTotal').addEventListener('click', () => {
      state.measureMode = 'total';
      $('modeTotal').className = 'flex-1 py-2.5 text-xs font-bold bg-[#1a2036] text-white';
      $('modeRooms').className = 'flex-1 py-2.5 text-xs font-bold bg-white text-slate-700';
      $('blockRooms').classList.add('hidden');
      syncHeroSqftVisibility();
      renderPricingBar();
    });
    $('modeRooms').addEventListener('click', () => {
      state.measureMode = 'rooms';
      $('modeRooms').className = 'flex-1 py-2.5 text-xs font-bold bg-[#1a2036] text-white';
      $('modeTotal').className = 'flex-1 py-2.5 text-xs font-bold bg-white text-slate-700';
      $('blockRooms').classList.remove('hidden');
      if (!state.rooms.length) state.rooms.push({ name: 'Room', sqft: 0 });
      renderRooms();
      syncHeroSqftVisibility();
      renderPricingBar();
    });
    $('inputTotalSqft').addEventListener('input', (e) => {
      state.totalSqft = Math.max(0, Number(e.target.value) || 0);
      state.productQty = state.totalSqft;
      renderPricingBar();
    });
    $('btnAddRoom').addEventListener('click', () => {
      state.rooms.push({ name: 'Room', sqft: 0 });
      renderRooms();
      renderPricingBar();
    });

    document.querySelectorAll('.svc-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.service = btn.dataset.svc;
        document.querySelectorAll('.svc-card').forEach((b) => {
          b.classList.remove('os-card-tap--sel', 'border-[#d6b598]');
          b.classList.add('border-slate-200');
        });
        btn.classList.add('os-card-tap--sel', 'border-[#d6b598]');
        btn.classList.remove('border-slate-200');
        $('svcSelectedLabel').textContent = svcLabel();
        renderPricingBar();
      });
    });

    $('matWe').addEventListener('click', () => {
      state.materialSource = 'we';
      $('matWe').className = 'flex-1 py-3 bg-[#1a2036] text-white';
      $('matCust').className = 'flex-1 py-3 bg-white text-slate-700';
      $('blockProductSearch').classList.remove('hidden');
      $('matCustNote').classList.add('hidden');
      renderPricingBar();
    });
    $('matCust').addEventListener('click', () => {
      state.materialSource = 'customer';
      $('matCust').className = 'flex-1 py-3 bg-[#1a2036] text-white';
      $('matWe').className = 'flex-1 py-3 bg-white text-slate-700';
      $('blockProductSearch').classList.add('hidden');
      $('matCustNote').classList.remove('hidden');
      state.product = null;
      renderPricingBar();
    });

    let productTimer;
    $('productSearch').addEventListener('input', (e) => {
      state.productSearch = e.target.value;
      clearTimeout(productTimer);
      productTimer = setTimeout(() => searchProducts(e.target.value.trim()), 280);
    });

    $('productQty').addEventListener('input', (e) => {
      state.productQty = Math.max(0, Number(e.target.value) || 0);
      renderPricingBar();
    });

    $('presetBasic').addEventListener('click', () => {
      applyGbbTier('basic');
      renderAddonToggles();
      renderPricingBar();
    });
    $('presetStandard').addEventListener('click', () => {
      applyGbbTier('standard');
      renderAddonToggles();
      renderPricingBar();
    });
    $('presetPremium').addEventListener('click', () => {
      applyGbbTier('premium');
      renderAddonToggles();
      renderPricingBar();
    });

    $('btnNext').addEventListener('click', () => {
      if (state.step !== 1) return;
      if (!state.client.name.trim()) {
        osToast('Client name is required.', 'error');
        return;
      }
      const items = buildItemsForApi();
      if (!items.length) {
        osToast('Add square footage (or room totals) or a quick line from +.', 'error');
        return;
      }
      if (computeBreakdown().total <= 0) {
        osToast('Total is $0 — add sq ft, material, or a paying line.', 'error');
        return;
      }
      state.step = 2;
      renderSummary();
      renderStepper();
      syncPanels();
      renderPricingBar();
      const main = $('mainScroll');
      if (main) main.scrollTop = 0;
    });
    $('btnBack').addEventListener('click', () => {
      if (state.step > 1) {
        state.step -= 1;
        renderStepper();
        syncPanels();
        renderPricingBar();
        const main = $('mainScroll');
        if (main) main.scrollTop = 0;
      }
    });

    $('chkGbb').addEventListener('change', () => {
      if (!$('chkGbb').checked) state.gbbSendGateDone = false;
    });

    $('btnOpenGbb').addEventListener('click', () => {
      state.view = 'gbb';
      renderStepper();
      syncPanels();
    });
    $('gbbBack').addEventListener('click', () => {
      state.view = 'steps';
      state.step = 2;
      renderStepper();
      syncPanels();
    });

    async function finalize(status, msg) {
      try {
        await persistQuote(status);
        osToast(msg, 'success');
        if (state.quoteId) window.location.href = `quote-builder.html?id=${state.quoteId}`;
      } catch (e) {
        osToast(e.message || String(e), 'error');
      }
    }

    $('btnSendQuote').addEventListener('click', () => {
      if ($('chkGbb').checked && !state.gbbSendGateDone) {
        state.view = 'gbb';
        renderStepper();
        syncPanels();
        return;
      }
      finalize('sent', 'Saved. Opening full quote…');
    });
    function gateGbbThen(run) {
      if ($('chkGbb').checked && !state.gbbSendGateDone) {
        state.view = 'gbb';
        renderStepper();
        syncPanels();
        return;
      }
      run();
    }

    $('btnApprove').addEventListener('click', () =>
      gateGbbThen(() => finalize('approved', 'Approved. Opening quote…'))
    );
    $('btnDeposit').addEventListener('click', () =>
      gateGbbThen(() => finalize('sent', 'Saved. Collect deposit in builder or POS.'))
    );

    $('fabAdd').addEventListener('click', () => {
      $('sheetBackdrop').classList.remove('hidden');
      $('sheetAdd').classList.remove('hidden');
    });
    $('sheetBackdrop').addEventListener('click', closeSheet);
    $('sheetCancel').addEventListener('click', closeSheet);
    $('sheetSaveLine').addEventListener('click', () => {
      const name = $('quickLineName').value.trim();
      const amount = Number($('quickLineAmt').value) || 0;
      if (!name || amount <= 0) {
        osToast('Description and amount required.', 'error');
        return;
      }
      state.customLines.push({ name, amount });
      $('quickLineName').value = '';
      $('quickLineAmt').value = '';
      closeSheet();
      renderSummary();
      renderPricingBar();
    });

    $('btnVoice').addEventListener('click', startVoice);

    $('photoInput').addEventListener('change', (e) => {
      const files = [...e.target.files];
      state.photos.push(...files);
      const th = $('photoThumbs');
      files.forEach((f) => {
        const url = URL.createObjectURL(f);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'w-16 h-16 object-cover rounded-lg border border-slate-200';
        th.appendChild(img);
      });
      e.target.value = '';
    });
  }

  function closeSheet() {
    $('sheetBackdrop').classList.add('hidden');
    $('sheetAdd').classList.add('hidden');
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      osToast('Speech recognition not supported in this browser.', 'info');
      return;
    }
    if (state.speechRec) {
      state.speechRec.stop();
      state.speechRec = null;
      $('btnVoice').textContent = '🎤 Try voice (this device)';
      return;
    }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.onresult = (ev) => {
      const t = ev.results[0][0].transcript;
      parseVoice(t);
      $('btnVoice').textContent = '🎤 Try voice (this device)';
      state.speechRec = null;
    };
    r.onerror = () => {
      $('btnVoice').textContent = '🎤 Try voice (this device)';
      state.speechRec = null;
    };
    state.speechRec = r;
    r.start();
    $('btnVoice').textContent = 'Listening… tap to stop';
  }

  function parseVoice(text) {
    const lower = text.toLowerCase();
    const mSq = lower.match(/(\d+)\s*(sq\s*ft|sqft|square\s*feet)/);
    const mRoom = lower.match(/(?:room|add)\s+(.+?)\s+(\d+)/i);
    if (mSq && lower.includes('room')) {
      const sq = parseInt(mSq[1], 10);
      state.measureMode = 'rooms';
      $('modeRooms').click();
      state.rooms.push({ name: 'Voice room', sqft: sq });
      renderRooms();
    } else if (mRoom) {
      state.measureMode = 'rooms';
      $('modeRooms').click();
      state.rooms.push({ name: mRoom[1].trim(), sqft: parseInt(mRoom[2], 10) });
      renderRooms();
    } else if (mSq) {
      state.totalSqft = parseInt(mSq[1], 10);
      $('inputTotalSqft').value = state.totalSqft;
      state.productQty = state.totalSqft;
    }
    renderPricingBar();
    renderSummary();
    osToast(`Heard: "${text}"`, 'info');
  }

  async function searchProducts(q) {
    const list = $('productPickList');
    if (!q) {
      list.classList.add('hidden');
      return;
    }
    try {
      const j = await api(`/api/erp/products?q=${encodeURIComponent(q)}&limit=20`);
      list.innerHTML = '';
      (j.data || []).forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-full text-left px-3 py-2 hover:bg-slate-50 text-sm';
        b.textContent = p.name;
        b.addEventListener('click', () => selectProduct(p.id));
        list.appendChild(b);
      });
      list.classList.toggle('hidden', !j.data?.length);
    } catch (e) {
      $('migrateMsg').textContent = e.message || 'ERP products unavailable.';
      $('migrateMsg').classList.remove('hidden');
      list.classList.add('hidden');
    }
  }

  async function selectProduct(id) {
    try {
      const j = await api(`/api/erp/products/preview/${id}`);
      const d = j.data;
      const p = d.product;
      state.product = {
        id: p.id,
        name: p.name,
        cost: d.product.cost_price,
        margin: d.default_markup_percentage,
        sell: d.suggested_sell_price,
        unit_type: p.unit_type || 'sq_ft',
      };
      state.productQty = effectiveSqft();
      $('productPickList').classList.add('hidden');
      $('productSearch').value = p.name;
      $('productSelected').classList.remove('hidden');
      $('prodName').textContent = p.name;
      $('prodCost').textContent = money(state.product.cost);
      $('prodMargin').textContent = String(state.product.margin);
      $('prodSell').textContent = money(state.product.sell);
      $('productQty').value = state.productQty;
      renderPricingBar();
    } catch (e) {
      osToast(e.message || String(e), 'error');
    }
  }

  function init() {
    $('clientName').value = state.client.name;
    $('inputTotalSqft').value = state.totalSqft;
    $('productQty').value = state.productQty;
    document.querySelector('.svc-card[data-svc="installation"]').classList.add('os-card-tap--sel', 'border-[#d6b598]');
    document.querySelector('.svc-card[data-svc="installation"]').classList.remove('border-slate-200');
    $('svcSelectedLabel').textContent = svcLabel();
    bind();
    syncHeroSqftVisibility();
    renderStepper();
    renderAddonToggles();
    syncPanels();
    renderPricingBar();
    loadUiConfig().catch(() => {});

    api('/api/auth/session')
      .then((j) => {
        if (!j.authenticated) {
          $('authBanner').textContent = 'Sign in required — open login.html, then return here.';
          $('authBanner').classList.remove('hidden');
        }
      })
      .catch(() => {
        $('authBanner').textContent = 'Sign in required — open login.html, then return here.';
        $('authBanner').classList.remove('hidden');
      });
  }

  init();
})();
