/**
 * Field Quote — medição e orçamento na casa do cliente (celular primeiro).
 * Lista de visitas → painel da visita (Serviços, Cômodos, Extras, Detalhes, Fotos) → Revisar → orçamento.
 * Rascunho salvo no servidor e no aparelho (funciona sem internet e sincroniza quando voltar).
 */
(function () {
  'use strict';

  const C = window.FQ_CATALOG;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, t) => window.crmToast && window.crmToast.show(m, { type: t || 'info' });
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n) || 0);
  const fmtN = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(n) || 0);
  const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const relTime = (iso) => {
    const t = new Date(iso).getTime();
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `há ${m} min`;
    if (m < 1440) return `há ${Math.round(m / 60)} h`;
    return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  };

  async function api(url, opts) {
    const o = Object.assign({ credentials: 'include', cache: 'no-store' }, opts || {});
    if (o.body && typeof o.body !== 'string') {
      o.body = JSON.stringify(o.body);
      o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {});
    }
    const r = await fetch(url, o);
    if (r.status === 401) {
      location.href = '/login.html';
      throw new Error('Sessão expirada');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = new Error(j.message || j.error || 'Não foi possível concluir.');
      e.status = r.status;
      e.body = j;
      throw e;
    }
    return j;
  }

  // ------------------------------------------------------------------ state
  const S = {
    fq: null, // server row (with data)
    d: null, // working data
    pricing: [],
    taxRate: 0,
    dirty: false,
    saving: false,
    offline: !navigator.onLine,
    saveTimer: null,
    sheet: null, // { kind, ... }
  };
  const LS = (id) => 'om_fq_' + id;

  function blankData() {
    return { version: 1, services: [], svc: { installation: { material: 'lvp', pattern: 'straight', supply: false, waste: null }, sanding: { type: 'sand_finish' }, demolition: {} }, rooms: [], extras: {}, custom: [], answers: { general: {}, demolition: {}, installation: {}, sanding: {} }, rates: {}, notes: '', photos: [] };
  }
  function normalizeData(raw) {
    const b = blankData();
    const d = Object.assign(b, raw && typeof raw === 'object' ? raw : {});
    d.svc = Object.assign(blankData().svc, d.svc || {});
    d.svc.installation = Object.assign(blankData().svc.installation, d.svc.installation || {});
    d.svc.sanding = Object.assign(blankData().svc.sanding, d.svc.sanding || {});
    d.answers = Object.assign(blankData().answers, d.answers || {});
    ['rooms', 'custom', 'photos', 'services'].forEach((k) => (d[k] = Array.isArray(d[k]) ? d[k] : []));
    d.extras = d.extras && typeof d.extras === 'object' && !Array.isArray(d.extras) ? d.extras : {};
    d.rates = d.rates && typeof d.rates === 'object' && !Array.isArray(d.rates) ? d.rates : {};
    return d;
  }

  // ------------------------------------------------------------------ math
  const toFt = (ft, inch) => (Number(ft) || 0) + (Number(inch) || 0) / 12;
  function roomArea(r) {
    if (r.mode === 'area') return r2(r.sqft);
    const L = toFt(r.l_ft, r.l_in);
    const W = toFt(r.w_ft, r.w_in);
    let a = L * W;
    (r.parts || []).forEach((p) => (a += (p.sign < 0 ? -1 : 1) * (Number(p.l) || 0) * (Number(p.w) || 0)));
    return r2(Math.max(0, a));
  }
  function roomPerimeter(r) {
    if (r.mode === 'area') return 0;
    const L = toFt(r.l_ft, r.l_in);
    const W = toFt(r.w_ft, r.w_in);
    return L > 0 && W > 0 ? r2(2 * (L + W)) : 0;
  }
  const fmtDim = (ft, inch) => {
    const f = Number(ft) || 0;
    const i = Number(inch) || 0;
    return i ? `${f}′ ${i}″` : `${f}′`;
  };
  const roomDims = (r) => (r.mode === 'area' ? 'área informada' : `${fmtDim(r.l_ft, r.l_in)} × ${fmtDim(r.w_ft, r.w_in)}${(r.parts || []).length ? ` ${r.parts.map((p) => (p.sign < 0 ? '−' : '+') + ' ' + p.l + '×' + p.w).join(' ')}` : ''}`);

  const mat = (id) => C.MATERIALS.find((m) => m.id === id) || C.MATERIALS[C.MATERIALS.length - 1];
  const svcDef = (id) => C.SERVICES.find((s) => s.id === id);
  function installWaste(d) {
    const i = d.svc.installation;
    if (i.waste != null && i.waste !== '') return Number(i.waste) || 0;
    if (i.material === 'carpet') return 8;
    if (i.material === 'tile') return 12;
    const p = C.PATTERNS.find((x) => x.id === i.pattern);
    return p ? p.waste : 10;
  }
  const svcArea = (d, sid) => r2(d.rooms.filter((r) => (r.services || []).includes(sid)).reduce((s, r) => s + roomArea(r), 0));
  const totalArea = (d) => r2(d.rooms.reduce((s, r) => s + roomArea(r), 0));
  const totalPerimeter = (d) => r2(d.rooms.filter((r) => (r.services || []).includes('installation') || !d.services.includes('installation')).reduce((s, r) => s + roomPerimeter(r), 0));

  // ------------------------------------------------------------------ pricing (Tabela de Valores)
  const ctKey = () => 'price_' + ((S.fq && S.fq.customer_type) || 'particular');
  function matchPricing(key) {
    const items = S.pricing.filter((p) => p.active !== 0 && p.active !== false);
    if (!items.length) return null;
    const hay = (p) => `${p.name} ${p.notes || ''}`.toLowerCase();
    const has = (p, words) => words.some((w) => hay(p).includes(w));
    const d = S.d;
    if (key === 'installation' || key === 'supply') {
      const m = mat(d.svc.installation.material);
      const cat = key === 'supply' ? ['supply'] : ['installation'];
      const pool = items.filter((p) => cat.includes(p.category) && p.unit === 'sq_ft');
      const byMat = m.keys.length ? pool.filter((p) => has(p, m.keys)) : [];
      return byMat[0] || (key === 'supply' ? null : pool.find((p) => has(p, svcDef('installation').hints)) || null);
    }
    if (key === 'demolition' || key === 'sanding') {
      const def = svcDef(key);
      return items.find((p) => (key === 'sanding' ? p.category === 'sand_finish' || has(p, def.hints) : has(p, def.hints)) && p.unit === 'sq_ft') || null;
    }
    const ex = C.EXTRAS.find((e) => e.id === key);
    if (ex) return items.find((p) => has(p, ex.hints) && (p.unit === ex.unit || ex.unit === 'fixed' || ex.unit === 'each')) || items.find((p) => has(p, ex.hints)) || null;
    return null;
  }
  function priceOf(p) {
    if (!p) return 0;
    return Number(p[ctKey()]) || Number(p.price_particular) || Number(p.price) || 0;
  }
  function defaultRate(key) {
    if (key === 'supply') return C.SUPPLY.rate;
    const s = svcDef(key);
    if (s) return s.rate;
    const ex = C.EXTRAS.find((e) => e.id === key);
    return ex ? ex.rate : 0;
  }
  /** { rate, source: 'manual'|'tabela'|'padrao', item } */
  function rateFor(key) {
    const o = S.d.rates[key];
    if (o && o.source === 'manual') return { rate: Number(o.rate) || 0, source: 'manual', item: null };
    if (o && o.pricing_item_id) {
      const it = S.pricing.find((p) => p.id === o.pricing_item_id);
      if (it) return { rate: priceOf(it), source: 'tabela', item: it };
    }
    const it = matchPricing(key);
    if (it && priceOf(it) > 0) return { rate: priceOf(it), source: 'tabela', item: it };
    return { rate: defaultRate(key), source: 'padrao', item: null };
  }

  // ------------------------------------------------------------------ lines
  function roomsEn(d, sid) {
    return d.rooms.filter((r) => (r.services || []).includes(sid)).map((r) => r.en || r.label).join(', ');
  }
  function extraQty(d, ex) {
    const st = d.extras[ex.id] || {};
    if (st.qty != null && st.qty !== '' && !st.auto) return Number(st.qty) || 0;
    if (ex.qty === 'perimeter') return Math.ceil(totalPerimeter(d));
    if (ex.qty === 'area') return Math.ceil(svcArea(d, 'installation'));
    return Number(st.qty) || 0;
  }
  function buildLines(d) {
    const out = [];
    const push = (key, name, desc, qty, unit, svc) => {
      const rt = rateFor(key);
      const q = r2(qty);
      if (q <= 0) return;
      out.push({ key, name, description: desc, quantity: q, unit, rate: r2(rt.rate), amount: r2(q * rt.rate), source: rt.source, pricing_item_id: rt.item ? rt.item.id : null, service_type: svc });
    };
    C.SERVICES.forEach((s) => {
      if (!d.services.includes(s.id)) return;
      const area = svcArea(d, s.id);
      if (area <= 0) return;
      const rooms = roomsEn(d, s.id);
      if (s.id === 'demolition') {
        const ex = (d.answers.demolition.existing || []).map((m) => mat(m).en.toLowerCase());
        push('demolition', ex.length ? `Floor removal — ${ex.join(', ')}` : 'Floor removal', rooms, area, 'sq_ft', 'Demolition');
      } else if (s.id === 'installation') {
        const m = mat(d.svc.installation.material);
        const pat = C.PATTERNS.find((p) => p.id === d.svc.installation.pattern);
        const patTxt = pat && pat.id !== 'straight' && ['solid_hardwood', 'engineered_wood', 'lvp', 'laminate', 'tile'].includes(m.id) ? ` — ${pat.en} pattern` : '';
        push('installation', `${m.en} installation${patTxt}`, rooms, area, 'sq_ft', 'Installation');
        if (d.svc.installation.supply) {
          const w = installWaste(d);
          push('supply', `${m.en} — material`, `${fmtN(area)} sq ft + ${w}% waste`, Math.ceil(area * (1 + w / 100)), 'sq_ft', 'Supply');
        }
      } else if (s.id === 'sanding') {
        const t = C.SANDING_TYPES.find((x) => x.id === d.svc.sanding.type) || C.SANDING_TYPES[0];
        push('sanding', `Sand & refinish — ${t.en}`, rooms, area, 'sq_ft', 'Sand & Finishing');
      }
    });
    C.EXTRAS.forEach((ex) => {
      const st = d.extras[ex.id];
      if (!st || !st.on) return;
      const q = ex.unit === 'fixed' ? Math.max(1, extraQty(d, ex)) : extraQty(d, ex);
      push(ex.id, ex.en, ex.qty === 'perimeter' ? 'Measured from room perimeters' : '', q, ex.unit, 'Installation');
    });
    d.custom.forEach((c) => {
      const q = r2(c.qty);
      const rate = r2(c.rate);
      if (!c.name || q <= 0) return;
      out.push({ key: 'custom:' + c.id, name: c.name, description: '', quantity: q, unit: c.unit || 'each', rate, amount: r2(q * rate), source: 'manual', pricing_item_id: null, service_type: 'General', custom: c.id });
    });
    return out;
  }
  function totals(d) {
    const lines = buildLines(d);
    const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
    const tax = r2((subtotal * (Number(S.taxRate) || 0)) / 100);
    return { lines, subtotal, tax, total: r2(subtotal + tax) };
  }

  function attentionSummary(d) {
    const out = [];
    Object.keys(C.QUESTIONS).forEach((g) => {
      (C.QUESTIONS[g] || []).forEach((q) => {
        if (!q.attention) return;
        const v = (d.answers[g] || {})[q.id];
        if (v == null || v === '' || v === false) return;
        out.push(v === true ? q.attention : `${q.attention}: ${v}`);
      });
    });
    return out.join(' · ');
  }

  // ------------------------------------------------------------------ persistence
  function cacheLocal() {
    try {
      localStorage.setItem(LS(S.fq.id), JSON.stringify({ at: Date.now(), fq: Object.assign({}, S.fq, { data: S.d }), dirty: S.dirty }));
    } catch (_) {}
  }
  function readLocal(id) {
    try {
      return JSON.parse(localStorage.getItem(LS(id)) || 'null');
    } catch (_) {
      return null;
    }
  }
  function markDirty() {
    S.dirty = true;
    S.rev = (S.rev || 0) + 1;
    S.d.attention_summary = attentionSummary(S.d);
    cacheLocal();
    renderSaveState();
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(save, 900);
  }
  async function save() {
    if (!S.fq || S.saving || !S.dirty) return;
    if (!navigator.onLine) {
      S.offline = true;
      renderSaveState();
      return;
    }
    S.saving = true;
    renderSaveState();
    const t = totals(S.d);
    const rev = S.rev || 0;
    const sent = JSON.parse(JSON.stringify(S.d));
    try {
      const j = await api('/api/field-quotes/' + encodeURIComponent(S.fq.id), {
        method: 'PUT',
        body: {
          client_name: S.fq.client_name,
          client_phone: S.fq.client_phone,
          client_email: S.fq.client_email,
          address: S.fq.address,
          customer_type: S.fq.customer_type,
          total: t.total,
          total_sqft: totalArea(S.d),
          data: sent,
        },
      });
      // Edits made while this request was in flight still need saving.
      S.dirty = (S.rev || 0) !== rev;
      S.offline = false;
      // Keep the server's photo list (uploads happen on their own route).
      const srv = (j.data.data && j.data.data.photos) || [];
      const ids = new Set(srv.map((p) => p.id));
      S.d.photos = srv.concat(S.d.photos.filter((p) => !ids.has(p.id) && !(sent.photos_removed || []).includes(p.id)));
      if (sent.photos_removed) S.d.photos_removed = (S.d.photos_removed || []).filter((id) => !sent.photos_removed.includes(id));
      cacheLocal();
    } catch (e) {
      if (!e.status) S.offline = true;
      else toast(e.message, 'error');
    } finally {
      S.saving = false;
      renderSaveState();
      if (S.dirty && navigator.onLine && !S.offline) {
        clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(save, 1500);
      }
    }
  }
  window.addEventListener('online', () => {
    S.offline = false;
    renderSaveState();
    save();
  });
  window.addEventListener('offline', () => {
    S.offline = true;
    renderSaveState();
  });
  window.addEventListener('beforeunload', (e) => {
    if (S.dirty && navigator.onLine) {
      save();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function renderSaveState() {
    const el = $('#fqSave');
    if (!el) return;
    let txt = '✓ Salvo';
    let cls = '';
    if (S.offline || !navigator.onLine) {
      txt = S.dirty ? 'Sem internet · salvo no aparelho' : 'Sem internet';
      cls = 'is-off';
    } else if (S.saving) txt = 'Salvando…';
    else if (S.dirty) txt = 'Alterações…';
    el.textContent = txt;
    el.className = 'fq-save ' + cls;
  }

  // ------------------------------------------------------------------ list view
  async function renderList() {
    document.title = 'Field Quote | ObraMate';
    const v = $('#fqView');
    v.innerHTML = `<div class="fq-list">
      <header class="fq-head"><div><h1 class="fq-h1">Field Quote</h1><p class="fq-sub">Meça e monte o orçamento na casa do cliente.</p></div>
        <button type="button" class="fq-btn fq-btn--pri" data-fq-new>+ Nova visita</button></header>
      <section id="fqToday"></section>
      <section class="fq-card" id="fqDrafts"><h3 class="fq-h3">Recentes</h3><p class="fq-empty">Carregando…</p></section>
    </div>`;
    $('#fqLoading').hidden = true;
    const [list, today] = await Promise.all([
      api('/api/field-quotes').catch((e) => ({ error: e })),
      (async () => {
        const a = new Date();
        a.setHours(0, 0, 0, 0);
        const b = new Date(a.getTime() + 2 * 86400e3);
        try {
          const j = await api(`/api/schedule/events?from=${a.toISOString()}&to=${b.toISOString()}`);
          return (j.data || []).filter((e) => e.type === 'visit' && e.status !== 'canceled');
        } catch (_) {
          return [];
        }
      })(),
    ]);
    if (list.error) {
      $('#fqDrafts').innerHTML = `<p class="fq-empty">${esc(list.error.message)}</p>`;
      return;
    }
    const rows = list.data || [];
    const byMeeting = new Set(rows.map((r) => r.meeting_id).filter(Boolean));
    const byLead = new Map(rows.filter((r) => r.status === 'draft').map((r) => [r.lead_id, r]));
    if (today.length) {
      $('#fqToday').innerHTML = `<div class="fq-card"><h3 class="fq-h3">Visitas de hoje e amanhã</h3>${today
        .map((e) => {
          const st = new Date(e.start);
          const lead = (e.meta && e.meta.lead) || {};
          const open = byLead.get(lead.id);
          return `<div class="fq-row"><div class="fq-row__when"><b>${esc(st.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</b><small>${esc(st.toDateString() === new Date().toDateString() ? 'hoje' : 'amanhã')}</small></div>
            <div class="fq-row__main"><b>${esc(e.title)}</b><small>${esc((e.meta && e.meta.location) || lead.address || '')}</small></div>
            ${open ? `<a class="fq-btn fq-btn--sm" href="field-quote.html?id=${esc(open.id)}">Continuar</a>` : byMeeting.has(e.id) ? '' : `<a class="fq-btn fq-btn--sm fq-btn--pri" href="field-quote.html?meeting_id=${esc(e.id)}">Começar</a>`}</div>`;
        })
        .join('')}</div>`;
    }
    $('#fqDrafts').innerHTML = `<h3 class="fq-h3">Recentes</h3>${
      rows.length
        ? rows
            .map(
              (r) => `<a class="fq-row fq-row--link" href="field-quote.html?id=${esc(r.id)}"><div class="fq-row__main"><b>${esc(r.client_name)}</b><small>${esc([r.address, r.rooms_count ? `${r.rooms_count} cômodos · ${fmtN(r.total_sqft)} pé²` : 'sem medidas'].filter(Boolean).join(' · '))}</small></div>
              <div class="fq-row__end"><b>${esc(money(r.total))}</b><span class="fq-pill${r.status === 'quoted' ? ' fq-pill--ink' : ''}">${r.status === 'quoted' ? 'Orçado' : 'Rascunho'}</span><small>${esc(relTime(r.updated_at))}</small></div></a>`
            )
            .join('')
        : '<p class="fq-empty">Nenhuma visita ainda. Comece pela agenda (visita do dia) ou em “Nova visita”.</p>'
    }`;
  }

  // ------------------------------------------------------------------ panel view
  function renderPanel() {
    const fq = S.fq;
    const d = S.d;
    document.title = fq.client_name + ' · Field Quote';
    const t = totals(d);
    const ct = C.CUSTOMER_TYPES.find((x) => x.id === fq.customer_type) || C.CUSTOMER_TYPES[0];
    const svcTxt = d.services.length
      ? d.services
          .map((s) => {
            const def = svcDef(s);
            if (s === 'installation') return `${def.pt} ${mat(d.svc.installation.material).pt}${d.svc.installation.supply ? ' + material' : ''}`;
            if (s === 'sanding') return (C.SANDING_TYPES.find((x) => x.id === d.svc.sanding.type) || {}).pt || def.pt;
            return def.pt;
          })
          .join(' · ')
      : 'Escolha o que vai ser feito';
    const extrasOn = C.EXTRAS.filter((e) => d.extras[e.id] && d.extras[e.id].on);
    const qCount = countAnswers(d);
    const quoted = fq.quote_id && fq.quote;
    $('#fqView').innerHTML = `<div class="fq-panel">
      <header class="fq-top"><a class="fq-back" href="field-quote.html">‹ Visitas</a><span class="fq-save" id="fqSave"></span></header>
      <button type="button" class="fq-client" data-fq-open="client">
        <h1 class="fq-h1">${esc(fq.client_name)}</h1>
        <p class="fq-sub">${esc(fq.address || 'Adicionar endereço')} · ${esc(ct.pt)} <span class="fq-edit">Editar</span></p>
      </button>
      ${quoted ? `<div class="fq-banner">Orçamento <b>${esc(fq.quote.number)}</b> gerado · ${esc(quoteStatusPt(fq.quote.status))}<a href="quote-builder.html?id=${esc(fq.quote_id)}${fq.lead_id ? '&lead_id=' + esc(fq.lead_id) : ''}">Abrir</a></div>` : ''}
      <div class="fq-cards">
        <button type="button" class="fq-card fq-card--btn" data-fq-open="services"><span class="fq-ic">🧰</span><div><b>Serviços</b><small>${esc(svcTxt)}</small></div>${d.services.length ? '<span class="fq-ok">✓</span>' : '<span class="fq-todo"></span>'}</button>
        <div class="fq-card">
          <button type="button" class="fq-card__head" data-fq-open="rooms-help"><span class="fq-ic">📐</span><div><b>Cômodos</b><small>${d.rooms.length ? `${d.rooms.length} cômodo${d.rooms.length > 1 ? 's' : ''} · ${fmtN(totalArea(d))} pé²` : 'Meça cada cômodo'}</small></div>${d.rooms.length ? '<span class="fq-ok">✓</span>' : '<span class="fq-todo"></span>'}</button>
          ${d.rooms
            .map(
              (r) => `<button type="button" class="fq-room" data-fq-room="${esc(r.id)}"><span class="fq-room__sw" style="background:${(r.services || []).length ? svcDef(r.services[r.services.length - 1]).color : '#d6c9b8'}"></span><div><b>${esc(r.label)} <strong>${fmtN(roomArea(r))} pé²</strong></b><small>${esc(roomDims(r))}</small><span class="fq-room__tags">${(r.services || [])
                .map((s) => `<i>${esc(svcDef(s).pt.split(' ')[0])}</i>`)
                .join('')}${photosOf(r.id).length ? `<i>📷 ${photosOf(r.id).length}</i>` : ''}</span></div><span class="fq-chev">›</span></button>`
            )
            .join('')}
          <button type="button" class="fq-btn fq-btn--block" data-fq-room-new ${d.services.length ? '' : 'disabled'}>+ Medir cômodo</button>
          ${!d.services.length ? '<p class="fq-hint">Escolha os serviços primeiro.</p>' : ''}
        </div>
        <button type="button" class="fq-card fq-card--btn" data-fq-open="extras"><span class="fq-ic">➕</span><div><b>Extras</b><small>${extrasOn.length || d.custom.length ? esc([...extrasOn.map((e) => e.pt), ...d.custom.map((c) => c.name)].join(' · ')) : 'Escada, rodapé, transições, descarte…'}</small></div><span class="fq-chev">›</span></button>
        <button type="button" class="fq-card fq-card--btn" data-fq-open="details"><span class="fq-ic">📝</span><div><b>Detalhes da obra</b><small>${qCount.answered ? `${qCount.answered} de ${qCount.total} respondidas` : 'Pets, acesso, piso atual, acabamento…'}</small></div>${qCount.answered >= Math.min(3, qCount.total) ? '<span class="fq-ok">✓</span>' : '<span class="fq-todo"></span>'}</button>
        <div class="fq-card">
          <div class="fq-card__head"><span class="fq-ic">📷</span><div><b>Fotos</b><small>${d.photos.length ? `${d.photos.length} foto${d.photos.length > 1 ? 's' : ''} · vão para o ObraCam do job` : 'Piso atual, danos, acesso'}</small></div></div>
          ${d.photos.length ? `<div class="fq-photos">${d.photos.slice(-8).map((p) => `<button type="button" class="fq-photo" data-fq-photo="${esc(p.id)}" style="background-image:url('${esc(p.url)}')"></button>`).join('')}</div>` : ''}
          <button type="button" class="fq-btn fq-btn--block" data-fq-shoot>📷 Tirar foto</button>
        </div>
        <label class="fq-card fq-notes"><b>Notas internas</b><textarea id="fqNotes" data-crm-rich="off" rows="3" placeholder="O que a equipe precisa saber (não vai para o cliente)">${esc(d.notes || '')}</textarea></label>
      </div>
      <footer class="fq-bar"><div class="fq-bar__tot"><small>Total</small><b id="fqTotal">${esc(money(t.total))}</b></div><button type="button" class="fq-btn fq-btn--pri fq-btn--big" data-fq-open="review" ${t.lines.length ? '' : 'disabled'}>Revisar e enviar</button></footer>
    </div>`;
    $('#fqLoading').hidden = true;
    renderSaveState();
  }

  const photosOf = (roomId) => (S.d.photos || []).filter((p) => p.room_id === roomId);
  const quoteStatusPt = (s) => ({ draft: 'rascunho', sent: 'enviado', viewed: 'visualizado', approved: 'aprovado', converted: 'virou job', changes_requested: 'alteração pedida', rejected: 'recusado' })[s] || s;
  function countAnswers(d) {
    let total = 0;
    let answered = 0;
    ['general', ...d.services].forEach((g) => {
      (C.QUESTIONS[g] || []).forEach((q) => {
        if (q.show && !q.show(d.answers, d.svc)) return;
        total++;
        const v = (d.answers[g] || {})[q.id];
        if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) answered++;
      });
    });
    return { total, answered };
  }

  // ------------------------------------------------------------------ sheets
  function openSheet(html, cls) {
    const sh = $('#fqSheet');
    const card = $('.fq-sheet__card', sh);
    card.className = 'fq-sheet__card' + (cls ? ' ' + cls : '');
    card.innerHTML = html;
    sh.hidden = false;
    document.body.classList.add('fq-sheet-open');
    requestAnimationFrame(() => sh.classList.add('is-open'));
  }
  function closeSheet() {
    const sh = $('#fqSheet');
    sh.classList.remove('is-open');
    document.body.classList.remove('fq-sheet-open');
    S.sheet = null;
    setTimeout(() => {
      if (!sh.classList.contains('is-open')) {
        sh.hidden = true;
        $('.fq-sheet__card', sh).innerHTML = '';
      }
    }, 220);
    if (S.fq) renderPanel();
  }
  const bar = (title, right) => `<header class="fq-sbar"><button type="button" class="fq-link" data-fq-close>${right === 'none' ? 'Fechar' : 'Cancelar'}</button><h2>${esc(title)}</h2>${right === 'none' ? '<span></span>' : right || '<button type="button" class="fq-link fq-link--b" data-fq-close>OK</button>'}</header>`;

  // client
  function sheetClient() {
    const fq = S.fq;
    openSheet(
      `${bar('Cliente', '<button type="button" class="fq-link fq-link--b" data-fq-save-client>Salvar</button>')}
      <div class="fq-sbody">
        <div class="fq-group">
          <label class="fq-field"><span>Nome</span><input name="client_name" value="${esc(fq.client_name)}" autocomplete="name" /></label>
          <label class="fq-field"><span>Telefone</span><input name="client_phone" type="tel" value="${esc(fq.client_phone || '')}" autocomplete="tel" /></label>
          <label class="fq-field"><span>E-mail</span><input name="client_email" type="email" value="${esc(fq.client_email || '')}" autocomplete="email" /></label>
        </div>
        <div class="fq-group"><label class="fq-field fq-field--col"><span>Endereço da obra</span><input name="address" id="fqAddr" value="${esc(fq.address || '')}" autocomplete="off" /></label>
          <button type="button" class="fq-btn fq-btn--block fq-btn--ghost" data-fq-geo>📍 Usar minha localização</button></div>
        <p class="fq-lbl">Tipo de cliente (define a coluna da Tabela de Valores)</p>
        <div class="fq-chips">${C.CUSTOMER_TYPES.map((c) => `<button type="button" class="fq-chip${c.id === fq.customer_type ? ' is-on' : ''}" data-fq-ct="${c.id}">${esc(c.pt)}</button>`).join('')}</div>
      </div>`
    );
    const a = $('#fqAddr');
    if (a && typeof window.sfAttachAddressAutocomplete === 'function') window.sfAttachAddressAutocomplete(a, { map: { combined: a } }).catch(() => {});
  }

  // services
  function sheetServices() {
    const d = S.d;
    const i = d.svc.installation;
    const showPattern = ['solid_hardwood', 'engineered_wood', 'lvp', 'laminate', 'tile'].includes(i.material);
    openSheet(
      `${bar('Serviços')}
      <div class="fq-sbody">
        <p class="fq-lbl">O que vai ser feito</p>
        <div class="fq-svcs">${C.SERVICES.map((s) => `<button type="button" class="fq-svc${d.services.includes(s.id) ? ' is-on' : ''}" data-fq-svc="${s.id}" style="--c:${s.color}"><span>${s.icon}</span><b>${esc(s.pt)}</b></button>`).join('')}</div>
        ${
          d.services.includes('installation')
            ? `<div class="fq-group"><p class="fq-lbl fq-lbl--in">Material a instalar</p><div class="fq-chips">${C.MATERIALS.map((m) => `<button type="button" class="fq-chip${m.id === i.material ? ' is-on' : ''}" data-fq-mat="${m.id}">${esc(m.pt)}</button>`).join('')}</div>
              ${showPattern ? `<p class="fq-lbl fq-lbl--in">Paginação</p><div class="fq-chips">${C.PATTERNS.map((p) => `<button type="button" class="fq-chip${p.id === i.pattern ? ' is-on' : ''}" data-fq-pat="${p.id}">${esc(p.pt)}</button>`).join('')}</div>` : ''}
              <label class="fq-switch"><input type="checkbox" data-fq-supply ${i.supply ? 'checked' : ''}/><span></span><div><b>Nós fornecemos o material</b><small>Entra como linha separada, com ${installWaste(d)}% de perda</small></div></label>
              ${i.supply ? `<div class="fq-stepper-row"><span>Perda</span>${stepper('waste', installWaste(d), '%')}</div>` : ''}</div>`
            : ''
        }
        ${
          d.services.includes('sanding')
            ? `<div class="fq-group"><p class="fq-lbl fq-lbl--in">Tipo de lixa</p><div class="fq-chips fq-chips--col">${C.SANDING_TYPES.map((t) => `<button type="button" class="fq-chip${t.id === d.svc.sanding.type ? ' is-on' : ''}" data-fq-sand="${t.id}">${esc(t.pt)}</button>`).join('')}</div></div>`
            : ''
        }
        <p class="fq-hint">Os serviços escolhidos entram em todos os cômodos novos; dá para tirar de um cômodo específico.</p>
      </div>`
    );
  }
  const stepper = (k, v, suf) => `<div class="fq-stepper" data-fq-step="${k}"><button type="button" data-fq-dec>−</button><b>${esc(v)}${suf || ''}</b><button type="button" data-fq-inc>+</button></div>`;

  // room
  function nextRoomLabel(base) {
    const def = C.ROOMS.find((r) => r.pt === base);
    if (!def || !def.numbered) return { label: base, en: def ? def.en : base };
    const n = S.d.rooms.filter((r) => r.base === base).length + 1;
    return { label: `${base} ${n}`, en: `${def.en} ${n}` };
  }
  function sheetRoom(id) {
    const d = S.d;
    let r = id ? d.rooms.find((x) => x.id === id) : null;
    const isNew = !r;
    if (!r) {
      const first = d.rooms.length ? 'Quarto' : 'Sala';
      const nm = nextRoomLabel(first);
      r = { id: uid(), base: first, label: nm.label, en: nm.en, mode: 'dims', l_ft: '', l_in: '', w_ft: '', w_in: '', sqft: '', parts: [], services: d.services.slice(), note: '' };
    }
    S.sheet = { kind: 'room', room: JSON.parse(JSON.stringify(r)), isNew };
    renderRoomSheet();
  }
  function renderRoomSheet(focusKey) {
    const r = S.sheet.room;
    const d = S.d;
    const area = roomArea(r);
    const per = roomPerimeter(r);
    const w = d.svc.installation.supply && r.services.includes('installation') ? installWaste(d) : 0;
    openSheet(
      `${bar(S.sheet.isNew ? 'Novo cômodo' : r.label, '<button type="button" class="fq-link fq-link--b" data-fq-room-save>Salvar</button>')}
      <div class="fq-sbody">
        <div class="fq-chips fq-chips--scroll">${C.ROOMS.map((x) => `<button type="button" class="fq-chip${r.base === x.pt ? ' is-on' : ''}" data-fq-rname="${esc(x.pt)}">${esc(x.pt)}</button>`).join('')}<button type="button" class="fq-chip${r.base === '__custom' ? ' is-on' : ''}" data-fq-rname="__custom">+ Outro</button></div>
        ${r.base === '__custom' ? `<label class="fq-field fq-field--col fq-group"><span>Nome do cômodo</span><input data-fq-r="label" value="${esc(r.label)}" placeholder="ex.: Sala de TV" /></label>` : ''}
        <div class="fq-seg"><button type="button" class="${r.mode !== 'area' ? 'is-on' : ''}" data-fq-mode="dims">Medidas</button><button type="button" class="${r.mode === 'area' ? 'is-on' : ''}" data-fq-mode="area">Área total</button></div>
        <div class="fq-group fq-measure">
          ${
            r.mode === 'area'
              ? `<label class="fq-dimbox fq-dimbox--wide"><input data-fq-r="sqft" inputmode="decimal" value="${esc(r.sqft)}" placeholder="0" /><small>pé² (sq ft)</small></label>`
              : `<div class="fq-dims"><div class="fq-dim"><small>Comprimento</small><div class="fq-ftin"><label><input data-fq-r="l_ft" inputmode="numeric" value="${esc(r.l_ft)}" placeholder="0" /><span>′</span></label><label><input data-fq-r="l_in" inputmode="numeric" value="${esc(r.l_in)}" placeholder="0" /><span>″</span></label></div></div>
                <span class="fq-x">×</span>
                <div class="fq-dim"><small>Largura</small><div class="fq-ftin"><label><input data-fq-r="w_ft" inputmode="numeric" value="${esc(r.w_ft)}" placeholder="0" /><span>′</span></label><label><input data-fq-r="w_in" inputmode="numeric" value="${esc(r.w_in)}" placeholder="0" /><span>″</span></label></div></div></div>
                ${(r.parts || [])
                  .map(
                    (p, i) => `<div class="fq-part"><span class="fq-part__sign ${p.sign < 0 ? 'is-neg' : ''}">${p.sign < 0 ? '−' : '+'}</span><input data-fq-part="${i}" data-k="label" value="${esc(p.label || '')}" placeholder="${p.sign < 0 ? 'Ilha, lareira…' : 'Closet, nicho…'}" /><input data-fq-part="${i}" data-k="l" inputmode="decimal" value="${esc(p.l)}" placeholder="ft" /><span>×</span><input data-fq-part="${i}" data-k="w" inputmode="decimal" value="${esc(p.w)}" placeholder="ft" /><button type="button" data-fq-part-del="${i}" aria-label="Remover">✕</button></div>`
                  )
                  .join('')}
                <div class="fq-partbtns"><button type="button" data-fq-part-add="1">＋ Somar área</button><button type="button" data-fq-part-add="-1">－ Descontar área</button></div>`
          }
          <div class="fq-area"><b id="fqArea">${fmtN(area)} pé²</b><small id="fqAreaSub">${w ? `+${w}% perda = ${fmtN(Math.ceil(area * (1 + w / 100)))} pé² de material` : per ? `perímetro ${fmtN(per)} pés` : ''}</small></div>
        </div>
        <p class="fq-lbl">Serviços neste cômodo</p>
        <div class="fq-svcs fq-svcs--sm">${d.services.map((sid) => `<button type="button" class="fq-svc${r.services.includes(sid) ? ' is-on' : ''}" data-fq-rsvc="${sid}" style="--c:${svcDef(sid).color}"><b>${esc(svcDef(sid).pt)}</b></button>`).join('')}</div>
        <label class="fq-field fq-field--col fq-group"><span>Observação</span><input data-fq-r="note" value="${esc(r.note || '')}" placeholder="ex.: rodapé danificado, degrau na porta" /></label>
        ${photosOf(r.id).length ? `<div class="fq-photos">${photosOf(r.id).map((p) => `<span class="fq-photo" style="background-image:url('${esc(p.url)}')"></span>`).join('')}</div>` : ''}
        <button type="button" class="fq-btn fq-btn--block fq-btn--ghost" data-fq-shoot="${esc(r.id)}">📷 Foto deste cômodo</button>
        ${S.sheet.isNew ? '' : `<div class="fq-row2"><button type="button" class="fq-btn fq-btn--ghost" data-fq-room-dup>Duplicar</button><button type="button" class="fq-btn fq-btn--danger" data-fq-room-del>Excluir cômodo</button></div>`}
      </div>`,
      'fq-sheet__card--tall'
    );
    const f = focusKey ? $(`[data-fq-r="${focusKey}"]`) : S.sheet.isNew ? $('[data-fq-r="l_ft"], [data-fq-r="sqft"]') : null;
    if (f && window.innerWidth >= 768) f.focus();
  }
  function updateRoomCalc() {
    const r = S.sheet.room;
    const area = roomArea(r);
    const per = roomPerimeter(r);
    const w = S.d.svc.installation.supply && r.services.includes('installation') ? installWaste(S.d) : 0;
    const a = $('#fqArea');
    if (a) a.textContent = `${fmtN(area)} pé²`;
    const sub = $('#fqAreaSub');
    if (sub) sub.textContent = w ? `+${w}% perda = ${fmtN(Math.ceil(area * (1 + w / 100)))} pé² de material` : per ? `perímetro ${fmtN(per)} pés` : '';
  }
  function saveRoom(keepOpen) {
    const r = S.sheet.room;
    if (roomArea(r) <= 0) return toast('Informe as medidas (ou a área) do cômodo.', 'error');
    if (!r.services.length) return toast('Escolha pelo menos um serviço para o cômodo.', 'error');
    const i = S.d.rooms.findIndex((x) => x.id === r.id);
    if (i >= 0) S.d.rooms[i] = r;
    else S.d.rooms.push(r);
    markDirty();
    toast(`${r.label}: ${fmtN(roomArea(r))} pé²`, 'success');
    if (keepOpen) sheetRoom(null);
    else closeSheet();
  }

  // extras
  function sheetExtras() {
    const d = S.d;
    openSheet(
      `${bar('Extras')}
      <div class="fq-sbody">
        <div class="fq-group fq-extras">${C.EXTRAS.map((ex) => {
          const st = d.extras[ex.id] || {};
          const rt = rateFor(ex.id);
          const q = extraQty(d, ex);
          return `<div class="fq-extra${st.on ? ' is-on' : ''}"><label class="fq-switch fq-switch--row"><input type="checkbox" data-fq-extra="${ex.id}" ${st.on ? 'checked' : ''}/><span></span><div><b>${esc(ex.pt)}</b><small>${esc(money(rt.rate))} ${esc(ex.unit === 'fixed' ? '' : '/ ' + C.UNIT_PT[ex.unit])}${rt.source === 'tabela' ? ' · Tabela' : ''}</small></div></label>
            ${
              st.on && ex.unit !== 'fixed'
                ? `<div class="fq-extra__qty">${ex.qty !== 'manual' ? `<button type="button" class="fq-mini${st.auto !== false && (st.qty == null || st.auto) ? ' is-on' : ''}" data-fq-extra-auto="${ex.id}">${ex.qty === 'perimeter' ? 'Pelo perímetro' : 'Pela área'}</button>` : ''}<div class="fq-stepper" data-fq-step="extra:${ex.id}"><button type="button" data-fq-dec>−</button><input inputmode="numeric" data-fq-extra-qty="${ex.id}" value="${esc(q)}" /><button type="button" data-fq-inc>+</button></div><span class="fq-unit">${esc(C.UNIT_PT[ex.unit])}</span></div>`
                : ''
            }</div>`;
        }).join('')}</div>
        <p class="fq-lbl">Itens avulsos</p>
        <div class="fq-group">${d.custom
          .map(
            (c) => `<div class="fq-custom"><input data-fq-custom="${esc(c.id)}" data-k="name" value="${esc(c.name)}" placeholder="Descrição (vai em inglês para o cliente)" /><div class="fq-custom__nums"><input data-fq-custom="${esc(c.id)}" data-k="qty" inputmode="decimal" value="${esc(c.qty)}" placeholder="Qtd" /><span>×</span><input data-fq-custom="${esc(c.id)}" data-k="rate" inputmode="decimal" value="${esc(c.rate)}" placeholder="$" /><button type="button" data-fq-custom-del="${esc(c.id)}">✕</button></div></div>`
          )
          .join('')}<button type="button" class="fq-btn fq-btn--block fq-btn--ghost" data-fq-custom-add>+ Item avulso</button></div>
        <p class="fq-hint">Preços pela Tabela de Valores (${esc((C.CUSTOMER_TYPES.find((x) => x.id === S.fq.customer_type) || {}).pt || '')}). Ajuste qualquer preço em Revisar.</p>
      </div>`
    );
  }

  // details
  function sheetDetails() {
    const d = S.d;
    const groups = ['general', ...d.services];
    const title = { general: 'Geral', demolition: 'Demolição', installation: 'Instalação', sanding: 'Lixa e acabamento' };
    openSheet(
      `${bar('Detalhes da obra')}
      <div class="fq-sbody">${groups
        .map((g) => {
          const qs = (C.QUESTIONS[g] || []).filter((q) => !q.show || q.show(d.answers, d.svc));
          if (!qs.length) return '';
          return `<p class="fq-lbl">${esc(title[g])}</p><div class="fq-group">${qs.map((q) => questionHtml(g, q)).join('')}</div>`;
        })
        .join('')}
        <p class="fq-hint">Itens marcados como atenção (pets, acesso, cor…) vão para “Para o campo” do job quando o orçamento for aprovado.</p>
      </div>`
    );
  }
  function questionHtml(g, q) {
    const v = (S.d.answers[g] || {})[q.id];
    const k = `${g}.${q.id}`;
    if (q.type === 'bool')
      return `<div class="fq-q"><span>${esc(q.pt)}${q.attention ? ' <i class="fq-att">atenção</i>' : ''}</span><div class="fq-yn"><button type="button" class="${v === true ? 'is-on' : ''}" data-fq-ans="${k}" data-v="true">Sim</button><button type="button" class="${v === false ? 'is-on' : ''}" data-fq-ans="${k}" data-v="false">Não</button></div></div>`;
    if (q.type === 'choice')
      return `<div class="fq-q fq-q--col"><span>${esc(q.pt)}</span><div class="fq-chips">${q.options.map(([id, lb]) => `<button type="button" class="fq-chip${v === id ? ' is-on' : ''}" data-fq-ans="${k}" data-v="${id}">${esc(lb)}</button>`).join('')}</div></div>`;
    if (q.type === 'multi')
      return `<div class="fq-q fq-q--col"><span>${esc(q.pt)}</span><div class="fq-chips">${q.options.map((id) => `<button type="button" class="fq-chip${(v || []).includes(id) ? ' is-on' : ''}" data-fq-ans-multi="${k}" data-v="${id}">${esc(mat(id).pt)}</button>`).join('')}</div></div>`;
    if (q.type === 'number')
      return `<div class="fq-q"><span>${esc(q.pt)}</span><input class="fq-qin fq-qin--num" inputmode="numeric" data-fq-ans-in="${k}" value="${esc(v == null ? '' : v)}" /></div>`;
    return `<div class="fq-q fq-q--col"><span>${esc(q.pt)}${q.attention ? ' <i class="fq-att">atenção</i>' : ''}</span><input class="fq-qin" data-fq-ans-in="${k}" value="${esc(v || '')}" /></div>`;
  }

  // review
  function sheetReview() {
    const t = totals(S.d);
    const fq = S.fq;
    const quoted = fq.quote_id && fq.quote;
    const locked = quoted && ['approved', 'converted'].includes(fq.quote.status);
    openSheet(
      `${bar('Revisar', 'none')}
      <div class="fq-sbody">
        <div class="fq-bigtotal"><small>Total para o cliente</small><b>${esc(money(t.total))}</b><span>${fmtN(totalArea(S.d))} pé² · preços ${esc((C.CUSTOMER_TYPES.find((x) => x.id === fq.customer_type) || {}).pt)}</span></div>
        <div class="fq-group fq-lines">${t.lines
          .map(
            (l) => `<button type="button" class="fq-line" data-fq-rate="${esc(l.key)}"><div><b>${esc(l.name)}</b><small>${esc(fmtN(l.quantity))} ${esc(C.UNIT_EN[l.unit] || '')} × ${esc(money(l.rate))}${l.source === 'padrao' ? ' · <em>preço padrão</em>' : l.source === 'manual' ? ' · ajustado' : ''}</small></div><b>${esc(money(l.amount))}</b></button>`
          )
          .join('')}
          ${t.tax ? `<div class="fq-line fq-line--sub"><div><b>Imposto</b><small>${esc(S.taxRate)}%</small></div><b>${esc(money(t.tax))}</b></div>` : ''}
        </div>
        ${t.lines.some((l) => l.source === 'padrao') ? '<p class="fq-hint fq-hint--warn">Linhas com <em>preço padrão</em> não acharam item na Tabela de Valores. Toque para ajustar.</p>' : '<p class="fq-hint">Toque numa linha para trocar o preço. O cliente vê os nomes em inglês.</p>'}
        ${locked ? `<div class="fq-banner">Orçamento ${esc(fq.quote.number)} já está ${esc(quoteStatusPt(fq.quote.status))}. Mudanças aqui não alteram mais o orçamento.</div>` : ''}
        <div class="fq-acts">
          <button type="button" class="fq-btn fq-btn--ink fq-btn--big" data-fq-finish="sign" ${locked ? 'disabled' : ''}>✍️ Cliente aprova e assina agora</button>
          <div class="fq-row2"><button type="button" class="fq-btn" data-fq-finish="sms" ${locked ? 'disabled' : ''}>Enviar por SMS</button><button type="button" class="fq-btn fq-btn--pri" data-fq-finish="open">${quoted ? 'Atualizar e abrir' : 'Abrir orçamento'}</button></div>
          <p class="fq-hint">Gera o orçamento ${quoted ? esc(fq.quote.number) : 'no ObraMate'} com essas linhas${fq.lead_id ? '' : ' e cria o lead no funil'}.</p>
        </div>
      </div>`,
      'fq-sheet__card--tall'
    );
  }
  function sheetRate(key) {
    const t = totals(S.d);
    const line = t.lines.find((l) => l.key === key);
    if (!line) return;
    if (key.startsWith('custom:')) return sheetExtras();
    const cats = key === 'supply' ? ['supply'] : key === 'sanding' ? ['sand_finish', 'installation'] : ['installation', 'supply', 'sand_finish', 'custom'];
    const items = S.pricing.filter((p) => (p.active !== 0 && p.active !== false) && cats.includes(p.category));
    const cur = rateFor(key);
    openSheet(
      `${bar('Preço', 'none')}
      <div class="fq-sbody">
        <p class="fq-lbl">${esc(line.name)}</p>
        <div class="fq-group"><label class="fq-field"><span>Valor por ${esc(C.UNIT_PT[line.unit] || 'un.')}</span><input id="fqRateIn" inputmode="decimal" value="${esc(cur.rate)}" /></label>
          <button type="button" class="fq-btn fq-btn--block fq-btn--pri" data-fq-rate-manual="${esc(key)}">Usar este valor</button></div>
        ${items.length ? `<p class="fq-lbl">Ou escolha da Tabela de Valores</p><div class="fq-group fq-lines">${items
          .map((p) => `<button type="button" class="fq-line${cur.item && cur.item.id === p.id ? ' is-on' : ''}" data-fq-rate-item="${esc(key)}" data-id="${esc(p.id)}"><div><b>${esc(p.name)}</b><small>${esc(p.category_label || p.category)} · ${esc(C.UNIT_PT[p.unit] || p.unit)}</small></div><b>${esc(money(priceOf(p)))}</b></button>`)
          .join('')}</div>` : '<p class="fq-hint">Sua Tabela de Valores ainda não tem itens. Cadastre em Tabela de Valores para os preços virem automáticos.</p>'}
        ${S.d.rates[key] ? `<button type="button" class="fq-btn fq-btn--block fq-btn--ghost" data-fq-rate-reset="${esc(key)}">Voltar ao automático</button>` : ''}
      </div>`
    );
  }

  function sheetPhoto(id) {
    const p = S.d.photos.find((x) => x.id === id);
    if (!p) return;
    const room = S.d.rooms.find((r) => r.id === p.room_id);
    openSheet(
      `${bar(room ? room.label : 'Foto', 'none')}
      <div class="fq-sbody">
        <img class="fq-photo-big" src="${esc(p.url)}" alt="" />
        <p class="fq-hint">${esc([room ? room.label : 'Geral', p.taken_at ? new Date(p.taken_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''].filter(Boolean).join(' · '))} · vai para o ObraCam do job quando o orçamento for aprovado.</p>
        <button type="button" class="fq-btn fq-btn--block fq-btn--danger" data-fq-photo-del="${esc(p.id)}">Excluir foto</button>
      </div>`
    );
  }

  // ------------------------------------------------------------------ finish → real quote
  async function ensureLead() {
    const fq = S.fq;
    if (fq.lead_id) return fq.lead_id;
    try {
      const j = await api('/api/leads', { method: 'POST', body: { name: fq.client_name, phone: fq.client_phone || undefined, email: fq.client_email || undefined, address: fq.address || undefined, source: 'Field Quote', check_duplicates: true } });
      return j.data.id;
    } catch (e) {
      if (e.status === 409 && e.body && e.body.duplicate && e.body.duplicate.id) return e.body.duplicate.id;
      throw e;
    }
  }
  async function finish(mode, btn) {
    const t = totals(S.d);
    if (!t.lines.length) return toast('Adicione serviços e cômodos primeiro.', 'error');
    if (!navigator.onLine) return toast('Sem internet. O rascunho está salvo; gere o orçamento quando voltar o sinal.', 'error');
    if (mode === 'sms' && !S.fq.client_phone) return toast('Adicione o telefone do cliente.', 'error');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Gerando…';
    try {
      S.dirty = true;
      await save();
      const leadId = await ensureLead();
      const fq = S.fq;
      const d = S.d;
      const m = mat(d.svc.installation.material);
      const body = {
        lead_id: leadId,
        status: 'draft',
        title: fq.client_name,
        job_name: fq.client_name,
        job_address: fq.address || null,
        service_type: d.services.map((s) => svcDef(s).en).join(' · '),
        flooring_type: d.services.includes('installation') ? m.id : 'hardwood',
        area_sqft: totalArea(d),
        waste_percent: d.svc.installation.supply ? installWaste(d) : 0,
        items: t.lines.map((l) => ({ name: l.name, description: l.description || null, quantity: l.quantity, rate: l.rate, unit_type: l.unit, item_type: 'service', service_type: l.service_type, pricing_item_id: l.pricing_item_id || undefined })),
        tax_total: t.tax,
        total: t.total,
        field_quote_id: fq.id,
        field_details: d.answers,
      };
      let quoteId = fq.quote_id;
      const editable = !(fq.quote && ['approved', 'converted'].includes(fq.quote.status));
      if (quoteId && editable) await api(`/api/quotes/${encodeURIComponent(quoteId)}/full`, { method: 'PUT', body });
      else if (!quoteId) {
        const j = await api('/api/quotes/full', { method: 'POST', body });
        quoteId = j.data.id;
      }
      const linked = await api(`/api/field-quotes/${encodeURIComponent(fq.id)}/link-quote`, { method: 'POST', body: { quote_id: quoteId, lead_id: leadId } });
      S.fq = Object.assign(S.fq, linked.data, { data: undefined });
      cacheLocal();
      if (mode === 'open') {
        location.href = `quote-builder.html?id=${encodeURIComponent(quoteId)}&lead_id=${encodeURIComponent(leadId)}`;
        return;
      }
      const pub = await api(`/api/quotes/${encodeURIComponent(quoteId)}/publish-client`, { method: 'POST', body: { mark_sent: true } });
      if (mode === 'sign') {
        location.href = pub.public_url;
        return;
      }
      const first = (fq.client_name || '').split(' ')[0];
      const msg = `Hi ${first}, thanks for having us today! Here is your flooring quote: ${pub.public_url}`;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      location.href = `sms:${String(fq.client_phone).replace(/[^\d+]/g, '')}${ios ? '&' : '?'}body=${encodeURIComponent(msg)}`;
      toast('Orçamento enviado. Marcado como enviado no funil.', 'success');
      btn.disabled = false;
      btn.textContent = label;
      await reloadFq();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  async function reloadFq() {
    const j = await api('/api/field-quotes/' + encodeURIComponent(S.fq.id));
    S.fq = j.data;
    S.d = normalizeData(j.data.data);
    cacheLocal();
    renderPanel();
  }

  // ------------------------------------------------------------------ photos
  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1600;
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Não foi possível ler a foto.'));
      img.src = url;
    });
  }
  let shootRoom = null;
  async function uploadPhotos(files) {
    if (!navigator.onLine) return toast('Sem internet: tire a foto pela câmera e envie quando voltar o sinal.', 'error');
    let ok = 0;
    for (const f of files) {
      try {
        const data_url = await compress(f);
        const j = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/photos`, { method: 'POST', body: { data_url, room_id: shootRoom, taken_at: new Date(f.lastModified || Date.now()).toISOString() } });
        S.d.photos.push(j.data);
        ok++;
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    if (ok) toast(ok === 1 ? 'Foto salva' : `${ok} fotos salvas`, 'success');
    cacheLocal();
    if (S.sheet && S.sheet.kind === 'room') renderRoomSheet();
    else renderPanel();
  }

  // ------------------------------------------------------------------ events
  function wire() {
    document.addEventListener('click', async (ev) => {
      const t = ev.target;
      let el;
      if ((el = t.closest('[data-fq-close]'))) return closeSheet();
      if (t.closest('[data-fq-new]')) return newVisit();
      if ((el = t.closest('[data-fq-open]'))) {
        const k = el.dataset.fqOpen;
        if (k === 'client') return sheetClient();
        if (k === 'services') return sheetServices();
        if (k === 'extras') return sheetExtras();
        if (k === 'details') return sheetDetails();
        if (k === 'review') return sheetReview();
        if (k === 'rooms-help') return S.d.services.length ? sheetRoom(null) : sheetServices();
        return;
      }
      if (t.closest('[data-fq-room-new]')) return sheetRoom(null);
      if ((el = t.closest('[data-fq-room]'))) return sheetRoom(el.dataset.fqRoom);
      if ((el = t.closest('[data-fq-shoot]'))) {
        if (S.sheet && S.sheet.kind === 'room' && S.sheet.isNew && el.dataset.fqShoot) {
          // Save the room first so the photo has somewhere to go.
          const r = S.sheet.room;
          if (roomArea(r) > 0 && r.services.length) {
            S.d.rooms.push(r);
            S.sheet.isNew = false;
            markDirty();
          }
        }
        shootRoom = el.dataset.fqShoot || null;
        $('#fqPhotoInput').click();
        return;
      }
      // client sheet
      if ((el = t.closest('[data-fq-ct]'))) {
        $$('[data-fq-ct]').forEach((b) => b.classList.toggle('is-on', b === el));
        return;
      }
      if (t.closest('[data-fq-geo]')) return useLocation();
      if (t.closest('[data-fq-save-client]')) {
        const v = (n) => ($(`.fq-sheet [name="${n}"]`) || {}).value || '';
        const name = v('client_name').trim();
        if (!name) return toast('Informe o nome do cliente.', 'error');
        const ct = $('[data-fq-ct].is-on');
        Object.assign(S.fq, { client_name: name, client_phone: v('client_phone').trim() || null, client_email: v('client_email').trim() || null, address: v('address').trim() || null, customer_type: ct ? ct.dataset.fqCt : S.fq.customer_type });
        markDirty();
        return closeSheet();
      }
      // services sheet
      if ((el = t.closest('[data-fq-svc]'))) {
        const id = el.dataset.fqSvc;
        const d = S.d;
        if (d.services.includes(id)) {
          d.services = d.services.filter((x) => x !== id);
          d.rooms.forEach((r) => (r.services = (r.services || []).filter((x) => x !== id)));
        } else {
          d.services.push(id);
          d.services.sort((a, b) => C.SERVICES.findIndex((s) => s.id === a) - C.SERVICES.findIndex((s) => s.id === b));
          // Existing rooms get the new service too (they can opt out per room).
          d.rooms.forEach((r) => !r.services.includes(id) && r.services.push(id));
        }
        markDirty();
        return sheetServices();
      }
      if ((el = t.closest('[data-fq-mat]'))) {
        S.d.svc.installation.material = el.dataset.fqMat;
        S.d.svc.installation.waste = null;
        markDirty();
        return sheetServices();
      }
      if ((el = t.closest('[data-fq-pat]'))) {
        S.d.svc.installation.pattern = el.dataset.fqPat;
        S.d.svc.installation.waste = null;
        markDirty();
        return sheetServices();
      }
      if ((el = t.closest('[data-fq-sand]'))) {
        S.d.svc.sanding.type = el.dataset.fqSand;
        markDirty();
        return sheetServices();
      }
      if ((el = t.closest('[data-fq-dec], [data-fq-inc]'))) {
        const box = el.closest('[data-fq-step]');
        const k = box.dataset.fqStep;
        const dir = el.hasAttribute('data-fq-inc') ? 1 : -1;
        if (k === 'waste') {
          S.d.svc.installation.waste = Math.max(0, Math.min(40, installWaste(S.d) + dir));
          markDirty();
          return sheetServices();
        }
        if (k.startsWith('extra:')) {
          const id = k.slice(6);
          const ex = C.EXTRAS.find((e) => e.id === id);
          const st = (S.d.extras[id] = S.d.extras[id] || { on: true });
          st.qty = Math.max(0, extraQty(S.d, ex) + dir);
          st.auto = false;
          markDirty();
          return sheetExtras();
        }
        return;
      }
      // room sheet
      if ((el = t.closest('[data-fq-rname]'))) {
        const r = S.sheet.room;
        const base = el.dataset.fqRname;
        if (base === '__custom') {
          r.base = '__custom';
          r.label = '';
          r.en = '';
        } else {
          const nm = base === r.base ? { label: r.label, en: r.en } : nextRoomLabel(base);
          r.base = base;
          r.label = nm.label;
          r.en = nm.en;
        }
        return renderRoomSheet(base === '__custom' ? 'label' : null);
      }
      if ((el = t.closest('[data-fq-mode]'))) {
        S.sheet.room.mode = el.dataset.fqMode;
        return renderRoomSheet(el.dataset.fqMode === 'area' ? 'sqft' : 'l_ft');
      }
      if ((el = t.closest('[data-fq-part-add]'))) {
        S.sheet.room.parts = S.sheet.room.parts || [];
        S.sheet.room.parts.push({ sign: Number(el.dataset.fqPartAdd), label: '', l: '', w: '' });
        return renderRoomSheet();
      }
      if ((el = t.closest('[data-fq-part-del]'))) {
        S.sheet.room.parts.splice(Number(el.dataset.fqPartDel), 1);
        return renderRoomSheet();
      }
      if ((el = t.closest('[data-fq-rsvc]'))) {
        const r = S.sheet.room;
        const id = el.dataset.fqRsvc;
        r.services = r.services.includes(id) ? r.services.filter((x) => x !== id) : [...r.services, id];
        el.classList.toggle('is-on', r.services.includes(id));
        updateRoomCalc();
        return;
      }
      if (t.closest('[data-fq-room-save]')) return saveRoom(false);
      if (t.closest('[data-fq-room-dup]')) {
        const r = JSON.parse(JSON.stringify(S.sheet.room));
        const base = r.base === '__custom' ? null : r.base;
        const nm = base ? nextRoomLabel(base) : { label: r.label + ' (cópia)', en: (r.en || r.label) + ' (copy)' };
        Object.assign(r, { id: uid(), label: nm.label, en: nm.en });
        S.sheet = { kind: 'room', room: r, isNew: true };
        return renderRoomSheet();
      }
      if (t.closest('[data-fq-room-del]')) {
        const id = S.sheet.room.id;
        S.d.rooms = S.d.rooms.filter((x) => x.id !== id);
        markDirty();
        toast('Cômodo excluído', 'info');
        return closeSheet();
      }
      // extras
      if ((el = t.closest('[data-fq-extra-auto]'))) {
        const st = (S.d.extras[el.dataset.fqExtraAuto] = S.d.extras[el.dataset.fqExtraAuto] || { on: true });
        st.auto = true;
        st.qty = null;
        markDirty();
        return sheetExtras();
      }
      if (t.closest('[data-fq-custom-add]')) {
        S.d.custom.push({ id: uid(), name: '', qty: 1, rate: '', unit: 'each' });
        markDirty();
        sheetExtras();
        const ins = $$('[data-fq-custom][data-k="name"]');
        if (ins.length) ins[ins.length - 1].focus();
        return;
      }
      if ((el = t.closest('[data-fq-custom-del]'))) {
        S.d.custom = S.d.custom.filter((c) => c.id !== el.dataset.fqCustomDel);
        markDirty();
        return sheetExtras();
      }
      // details
      if ((el = t.closest('[data-fq-ans]'))) {
        const [g, q] = el.dataset.fqAns.split('.');
        let v = el.dataset.v;
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        S.d.answers[g] = S.d.answers[g] || {};
        S.d.answers[g][q] = S.d.answers[g][q] === v ? null : v;
        markDirty();
        return sheetDetailsKeepScroll();
      }
      if ((el = t.closest('[data-fq-ans-multi]'))) {
        const [g, q] = el.dataset.fqAnsMulti.split('.');
        const cur = (S.d.answers[g] && S.d.answers[g][q]) || [];
        const v = el.dataset.v;
        S.d.answers[g][q] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
        markDirty();
        return sheetDetailsKeepScroll();
      }
      // review / rates
      if ((el = t.closest('[data-fq-rate]'))) return sheetRate(el.dataset.fqRate);
      if ((el = t.closest('[data-fq-rate-manual]'))) {
        const v = Number(String($('#fqRateIn').value).replace(/[$,\s]/g, ''));
        if (!Number.isFinite(v) || v < 0) return toast('Valor inválido.', 'error');
        S.d.rates[el.dataset.fqRateManual] = { source: 'manual', rate: v };
        markDirty();
        return sheetReview();
      }
      if ((el = t.closest('[data-fq-rate-item]'))) {
        S.d.rates[el.dataset.fqRateItem] = { source: 'tabela', pricing_item_id: el.dataset.id };
        markDirty();
        return sheetReview();
      }
      if ((el = t.closest('[data-fq-rate-reset]'))) {
        delete S.d.rates[el.dataset.fqRateReset];
        markDirty();
        return sheetReview();
      }
      if ((el = t.closest('[data-fq-finish]'))) return finish(el.dataset.fqFinish, el);
      if ((el = t.closest('[data-fq-photo]'))) {
        return sheetPhoto(el.dataset.fqPhoto);
      }
      if ((el = t.closest('[data-fq-photo-del]'))) {
        const id = el.dataset.fqPhotoDel;
        S.d.photos = S.d.photos.filter((x) => x.id !== id);
        S.d.photos_removed = [...(S.d.photos_removed || []), id];
        markDirty();
        toast('Foto removida', 'success');
        return closeSheet();
      }
    });

    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.id === 'fqNotes') {
        S.d.notes = t.value;
        return markDirty();
      }
      if (t.dataset.fqR && S.sheet && S.sheet.kind === 'room') {
        const k = t.dataset.fqR;
        let v = t.value;
        if (['l_ft', 'l_in', 'w_ft', 'w_in', 'sqft'].includes(k)) v = v.replace(/[^\d.]/g, '');
        if (k === 'l_in' || k === 'w_in') {
          if (Number(v) >= 12) v = '11';
        }
        if (v !== t.value) t.value = v;
        S.sheet.room[k] = v;
        if (k === 'label') S.sheet.room.en = v;
        return updateRoomCalc();
      }
      if (t.dataset.fqPart != null && S.sheet && S.sheet.kind === 'room') {
        const p = S.sheet.room.parts[Number(t.dataset.fqPart)];
        if (p) p[t.dataset.k] = t.dataset.k === 'label' ? t.value : t.value.replace(/[^\d.]/g, '');
        return updateRoomCalc();
      }
      if (t.dataset.fqExtraQty) {
        const st = (S.d.extras[t.dataset.fqExtraQty] = S.d.extras[t.dataset.fqExtraQty] || { on: true });
        st.qty = Number(t.value.replace(/[^\d.]/g, '')) || 0;
        st.auto = false;
        return markDirty();
      }
      if (t.dataset.fqCustom) {
        const c = S.d.custom.find((x) => x.id === t.dataset.fqCustom);
        if (c) c[t.dataset.k] = t.dataset.k === 'name' ? t.value : t.value.replace(/[^\d.]/g, '');
        return markDirty();
      }
      if (t.dataset.fqAnsIn) {
        const [g, q] = t.dataset.fqAnsIn.split('.');
        S.d.answers[g] = S.d.answers[g] || {};
        S.d.answers[g][q] = t.inputMode === 'numeric' ? (t.value === '' ? null : Number(t.value) || 0) : t.value;
        return markDirty();
      }
    });

    document.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.id === 'fqPhotoInput') {
        const files = Array.from(t.files || []);
        t.value = '';
        if (files.length) uploadPhotos(files);
        return;
      }
      if (t.matches('[data-fq-supply]')) {
        S.d.svc.installation.supply = t.checked;
        markDirty();
        return sheetServices();
      }
      if (t.matches('[data-fq-extra]')) {
        const id = t.dataset.fqExtra;
        const ex = C.EXTRAS.find((e) => e.id === id);
        const st = (S.d.extras[id] = S.d.extras[id] || {});
        st.on = t.checked;
        if (t.checked && st.qty == null && ex.qty === 'manual' && ex.unit !== 'fixed') st.qty = ex.id === 'stairs' ? 13 : 1;
        if (t.checked && ex.qty !== 'manual' && st.auto == null) st.auto = true;
        markDirty();
        return sheetExtras();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#fqSheet').hidden) closeSheet();
      if (e.key === 'Enter' && S.sheet && S.sheet.kind === 'room' && e.target.matches('input')) {
        e.preventDefault();
        const order = $$('.fq-sheet input[inputmode]');
        const i = order.indexOf(e.target);
        if (i >= 0 && i < order.length - 1) order[i + 1].focus();
        else saveRoom(false);
      }
    });
  }

  function sheetDetailsKeepScroll() {
    const body = $('.fq-sheet .fq-sbody');
    const top = body ? body.scrollTop : 0;
    sheetDetails();
    const nb = $('.fq-sheet .fq-sbody');
    if (nb) nb.scrollTop = top;
  }

  function useLocation() {
    if (!navigator.geolocation) return toast('Localização indisponível neste aparelho.', 'error');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let txt = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        try {
          if (typeof window.sfEnsureCrmAddressAutocomplete === 'function') await window.sfEnsureCrmAddressAutocomplete(false);
          if (window.google && window.google.maps && window.google.maps.Geocoder) {
            const res = await new window.google.maps.Geocoder().geocode({ location: { lat: latitude, lng: longitude } });
            if (res && res.results && res.results[0]) txt = res.results[0].formatted_address;
          }
        } catch (_) {}
        const a = $('#fqAddr');
        if (a) a.value = txt;
      },
      () => toast('Não foi possível ler sua localização.', 'error'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function newVisit() {
    try {
      const j = await api('/api/field-quotes', { method: 'POST', body: { client_name: 'Novo cliente' } });
      location.href = 'field-quote.html?id=' + encodeURIComponent(j.data.id) + '&novo=1';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    wire();
    const p = new URLSearchParams(location.search);
    try {
      const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
      if (!sess || !sess.authenticated) {
        location.href = '/login.html';
        return;
      }
    } catch (_) {
      /* offline: keep going with the local copy */
    }
    const leadId = p.get('lead_id');
    const meetingId = p.get('meeting_id');
    if (!p.get('id') && (leadId || meetingId)) {
      try {
        const j = await api('/api/field-quotes', { method: 'POST', body: { lead_id: leadId || undefined, meeting_id: meetingId || undefined } });
        history.replaceState(null, '', 'field-quote.html?id=' + encodeURIComponent(j.data.id));
        return loadPanel(j.data.id, j.data);
      } catch (e) {
        $('#fqLoading').textContent = e.message;
        return;
      }
    }
    if (p.get('id')) return loadPanel(p.get('id'), null, p.get('novo') === '1');
    renderList().catch((e) => ($('#fqLoading').textContent = e.message));
  }

  async function loadPanel(id, row, isNew) {
    const local = readLocal(id);
    try {
      const [fq, pricing, qs] = await Promise.all([
        row ? Promise.resolve({ data: row }) : api('/api/field-quotes/' + encodeURIComponent(id)),
        api('/api/pricing').catch(() => ({ data: [] })),
        api('/api/quotes/settings/defaults').catch(() => ({ data: {} })),
      ]);
      S.fq = fq.data;
      S.pricing = pricing.data || [];
      S.taxRate = Number(qs.data && qs.data.tax_rate) || 0;
      S.d = normalizeData(fq.data.data);
      // Unsynced edits made offline win over the server copy.
      if (local && local.dirty && local.fq && new Date(local.at) > new Date(fq.data.updated_at)) {
        S.fq = Object.assign({}, local.fq, { quote: fq.data.quote, quote_id: fq.data.quote_id, status: fq.data.status });
        S.d = normalizeData(local.fq.data);
        S.d.photos = normalizeData(fq.data.data).photos;
        S.dirty = true;
        setTimeout(save, 300);
      }
      try {
        localStorage.setItem('om_fq_pricing', JSON.stringify({ pricing: S.pricing, tax: S.taxRate }));
      } catch (_) {}
    } catch (e) {
      if (local && local.fq && !e.status) {
        S.fq = local.fq;
        S.d = normalizeData(local.fq.data);
        S.offline = true;
        try {
          const pc = JSON.parse(localStorage.getItem('om_fq_pricing') || '{}');
          S.pricing = pc.pricing || [];
          S.taxRate = pc.tax || 0;
        } catch (_) {}
      } else {
        $('#fqLoading').textContent = e.status === 404 ? 'Field Quote não encontrado.' : e.message;
        return;
      }
    }
    delete S.fq.data;
    cacheLocal();
    renderPanel();
    if (isNew) sheetClient();
    else if (!S.d.services.length) sheetServices();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
