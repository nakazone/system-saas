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
    ai: { measureProposal: null, photoProposal: null, selectedPhotoIds: [], review: null, assistQuestion: '', assistResult: null, conversationBusy: false, conversationOpen: false, conversationRecognition: null, conversationSpeakReplies: true, speechVoices: [], speechVoiceId: '', speechVoicesLoading: false, speechVoicesLoaded: false, speechVoicesError: '', speechAudio: null, speechUrl: null, speechRequestId: 0, speechCache: new Map(), presentation: null, presentationSlide: 0 },
    presentationQuoteOnly: false,
    presentationQuoteId: null,
  };
  const LS = (id) => 'om_fq_' + id;

  function blankData() {
    return { version: 1, services: [], svc: { installation: { material: 'lvp', pattern: 'straight', supply: false, waste: null }, sanding: { type: 'sand_finish' }, demolition: {} }, rooms: [], extras: {}, custom: [], answers: { general: {}, demolition: {}, installation: {}, sanding: {} }, rates: {}, notes: '', photos: [], floorplan: null, photo_analysis: null, ai_conversation: [] };
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
    d.floorplan = d.floorplan && typeof d.floorplan === 'object' && !Array.isArray(d.floorplan) ? d.floorplan : null;
    d.photo_analysis = d.photo_analysis && typeof d.photo_analysis === 'object' && !Array.isArray(d.photo_analysis) ? d.photo_analysis : null;
    d.ai_conversation = Array.isArray(d.ai_conversation) ? d.ai_conversation.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-40) : [];
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
    if (S.ai) { S.ai.review = null; S.ai.assistResult = null; }
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

  // ------------------------------------------------------------------ icons (no emoji)
  const svg = (p, w) => `<svg width="${w || 20}" height="${w || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    cam: () => svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    mic: (w) => svg('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', w),
    plus: (w) => svg('<path d="M12 5v14M5 12h14"/>', w || 16),
    check: (w) => svg('<path d="M5 12l5 5 9-10"/>', w || 16),
    chev: () => svg('<path d="M9 6l6 6-6 6"/>', 18),
    back: () => svg('<path d="M15 6l-6 6 6 6"/>', 20),
    route: () => svg('<path d="M3 11l18-8-8 18-2-8z"/>', 18),
    play: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>',
    mate: (w) => `<svg width="${w || 20}" height="${w || 20}" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l5.5 5.5h7L21 3v10a9 9 0 0 1-18 0z" fill="#E7792C"/><circle cx="9" cy="13.5" r="1.4" fill="#fff"/><circle cx="15" cy="13.5" r="1.4" fill="#fff"/></svg>`,
  };

  // ------------------------------------------------------------------ Mate tips (local checks, nothing changes without a tap)
  const WOOD_LIKE = ['lvp', 'solid_hardwood', 'engineered_wood', 'laminate'];
  function cloneD() {
    return JSON.parse(JSON.stringify(S.d));
  }
  function extraOn(d, id, qty) {
    const ex = C.EXTRAS.find((e) => e.id === id);
    const st = (d.extras[id] = Object.assign({}, d.extras[id] || {}, { on: true }));
    if (ex.unit === 'fixed') Object.assign(st, { qty: 1, auto: false });
    else if (ex.qty !== 'manual') Object.assign(st, { qty: null, auto: true });
    else Object.assign(st, { qty: qty || st.qty || 1, auto: false });
  }
  function mateTips() {
    const d = S.d;
    const out = [];
    const dismissed = new Set(d.mate_dismissed || []);
    const on = (id) => d.extras[id] && d.extras[id].on;
    const inst = d.services.includes('installation');
    const subfloor = (d.answers.demolition || {}).subfloor;
    if (inst && subfloor === 'concrete' && WOOD_LIKE.includes(d.svc.installation.material) && !on('moisture'))
      out.push({ id: 'moisture', text: `Contrapiso de concreto com ${mat(d.svc.installation.material).pt}. Incluir <b>barreira de umidade</b>?`, apply: (x) => extraOn(x, 'moisture') });
    const heavy = String((d.answers.general || {}).heavy_items || '').trim();
    if (heavy && !on('furniture')) out.push({ id: 'furniture', text: `Você anotou “${esc(heavy.slice(0, 40))}”. Incluir <b>mover móveis</b>?`, apply: (x) => extraOn(x, 'furniture') });
    if (d.services.includes('demolition') && svcArea(d, 'demolition') > 0 && !on('haul_away')) out.push({ id: 'haul_away', text: 'Tem demolição e nenhum descarte. Incluir <b>descarte / caçamba</b>?', apply: (x) => extraOn(x, 'haul_away') });
    const instRooms = d.rooms.filter((r) => (r.services || []).includes('installation')).length;
    if (inst && instRooms > 1 && !on('transitions')) out.push({ id: 'transitions', text: `${instRooms} cômodos com piso novo e nenhuma transição. Incluir <b>${instRooms - 1} transição${instRooms - 1 > 1 ? 'ões' : ''}</b>?`, apply: (x) => extraOn(x, 'transitions', instRooms - 1) });
    if (inst && instRooms && !on('quarter_round') && !on('baseboard_install') && !on('baseboard_remove')) out.push({ id: 'quarter_round', text: 'Piso novo sem acabamento na parede. Incluir <b>quarter round</b> pelo perímetro?', apply: (x) => extraOn(x, 'quarter_round') });
    const noPhoto = d.rooms.find((r) => !photosOf(r.id).length);
    if (noPhoto) out.push({ id: 'photo:' + noPhoto.id, text: `<b>${esc(noPhoto.label)}</b> está sem foto. A equipe vai precisar ver o piso atual.`, shoot: noPhoto.id });
    const base = totals(d).total;
    return out
      .filter((t) => !dismissed.has(t.id))
      .map((t) => {
        if (!t.apply) return t;
        const c = cloneD();
        const real = S.d;
        S.d = c;
        t.apply(c);
        const after = totals(c).total;
        S.d = real;
        return Object.assign(t, { delta: r2(after - base) });
      });
  }
  function tipHtml(t, compact) {
    const right = t.shoot
      ? `<button type="button" class="fq-btn fq-btn--sm" data-fq-shoot="${esc(t.shoot)}">Tirar foto</button>`
      : `<button type="button" class="fq-btn fq-btn--sm fq-btn--pri" data-fq-tip-yes="${esc(t.id)}">Incluir</button>`;
    return `<div class="fq-tip${compact ? ' fq-tip--row' : ''}"><div class="fq-tip__txt">${t.text}${t.delta ? ` <span class="fq-tip__d">${t.delta > 0 ? '+' : ''}${esc(money(t.delta))}</span>` : ''}</div><div class="fq-tip__acts"><button type="button" class="fq-btn fq-btn--sm fq-btn--quiet" data-fq-tip-no="${esc(t.id)}">Agora não</button>${right}</div></div>`;
  }
  function tipsCard(tips, max) {
    if (!tips.length) return '';
    const shown = tips.slice(0, max || 1);
    return `<section class="fq-mate" aria-label="Sugestões do Mate"><div class="fq-mate__head">${IC.mate()}<b>Mate</b>${tips.length > shown.length ? `<span>${tips.length} sugestões</span>` : ''}</div>${shown.map((t) => tipHtml(t)).join('')}</section>`;
  }

  // ------------------------------------------------------------------ list view
  const briefCache = (() => {
    try { return JSON.parse(sessionStorage.getItem('om_fq_brief') || '{}'); } catch (_) { return {}; }
  })();
  async function loadBriefing(leadId, el) {
    if (!leadId || !el) return;
    const show = (b) => {
      el.innerHTML = `<div class="fq-brief__head">${IC.mate(18)}<b>Briefing do Mate</b></div><p>${esc(b.summary)}</p>${(b.questions || []).length ? `<span class="fq-lbl2">PERGUNTE NA VISITA</span><ul>${b.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}`;
      el.hidden = false;
    };
    if (briefCache[leadId]) return show(briefCache[leadId]);
    try {
      const j = await api('/api/field-quotes/ai/briefing', { method: 'POST', body: { lead_id: leadId } });
      briefCache[leadId] = j.data;
      try { sessionStorage.setItem('om_fq_brief', JSON.stringify(briefCache)); } catch (_) {}
      show(j.data);
    } catch (_) {
      el.hidden = true;
    }
  }
  async function renderList() {
    document.title = 'Field Quote | ObraMate';
    const v = $('#fqView');
    v.innerHTML = `<div class="fq-list">
      <header class="fq-head"><h1 class="fq-h1">Field Quote</h1>
        <button type="button" class="fq-btn fq-btn--pri" data-fq-new>${IC.plus()}Nova visita</button></header>
      <section id="fqToday"></section>
      <section id="fqDrafts"><p class="fq-empty">Carregando…</p></section>
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
          return (j.data || []).filter((e) => e.type === 'visit' && e.status !== 'canceled').sort((x, y) => new Date(x.start) - new Date(y.start));
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
    const now = Date.now();
    const upcoming = today.filter((e) => new Date(e.end || e.start).getTime() > now - 3 * 3600e3);
    const visitAct = (e, big) => {
      const lead = (e.meta && e.meta.lead) || {};
      const open = byLead.get(lead.id);
      const cls = big ? ' fq-btn--pri fq-btn--grow' : ' fq-btn--sm';
      if (open) return `<a class="fq-btn${cls}" href="field-quote.html?id=${esc(open.id)}">Continuar</a>`;
      if (byMeeting.has(e.id)) return '';
      return `<a class="fq-btn${cls}${big ? '' : ' fq-btn--pri'}" href="field-quote.html?meeting_id=${esc(e.id)}">${big ? 'Começar visita' : 'Começar'}</a>`;
    };
    const when = (st) => `${st.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    const dayTxt = (st) => (st.toDateString() === new Date().toDateString() ? 'hoje' : 'amanhã');
    if (upcoming.length) {
      const [first, ...rest] = upcoming;
      const st = new Date(first.start);
      const lead = (first.meta && first.meta.lead) || {};
      const addr = (first.meta && first.meta.location) || lead.address || '';
      $('#fqToday').innerHTML = `<p class="fq-lbl2">PRÓXIMA VISITA</p>
        <article class="fq-next">
          <div class="fq-next__top"><span class="fq-next__when">${esc(dayTxt(st) === 'hoje' ? 'Hoje' : 'Amanhã')} · ${esc(when(st))}</span></div>
          <h2 class="fq-next__name">${esc(first.title)}</h2>
          ${addr ? `<p class="fq-next__addr">${esc(addr)}</p>` : ''}
          <div class="fq-brief" id="fqBrief" hidden></div>
          <div class="fq-next__acts">${addr ? `<a class="fq-btn" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}" target="_blank" rel="noopener">${IC.route()}Rota</a>` : ''}${visitAct(first, true)}</div>
        </article>
        ${rest.length ? `<div class="fq-card fq-card--list">${rest
          .map((e) => {
            const s2 = new Date(e.start);
            const l2 = (e.meta && e.meta.lead) || {};
            return `<div class="fq-row"><div class="fq-row__when"><b>${esc(when(s2))}</b><small>${esc(dayTxt(s2))}</small></div><div class="fq-row__main"><b>${esc(e.title)}</b><small>${esc((e.meta && e.meta.location) || l2.address || '')}</small></div>${visitAct(e)}</div>`;
          })
          .join('')}</div>` : ''}`;
      if (lead.id && !byLead.get(lead.id)) loadBriefing(lead.id, $('#fqBrief'));
    }
    const drafts = rows.filter((r) => r.status !== 'quoted');
    const quoted = rows.filter((r) => r.status === 'quoted');
    const row = (r) => {
      const sub = r.status === 'quoted'
        ? `<small>${esc([r.address, relTime(r.updated_at)].filter(Boolean).join(' · '))}</small>`
        : r.rooms_count
          ? `<small>${esc(`${r.rooms_count} cômodo${r.rooms_count > 1 ? 's' : ''} · ${fmtN(r.total_sqft)} pé² · ${relTime(r.updated_at)}`)}</small>`
          : `<small class="fq-warn">sem medidas · ${esc(relTime(r.updated_at))}</small>`;
      return `<a class="fq-row fq-row--link" href="field-quote.html?id=${esc(r.id)}"><div class="fq-row__main"><b>${esc(r.client_name)}</b>${sub}</div><div class="fq-row__end"><b>${esc(money(r.total))}</b>${IC.chev()}</div></a>`;
    };
    $('#fqDrafts').innerHTML = rows.length
      ? `${drafts.length ? `<p class="fq-lbl2">RASCUNHOS</p><div class="fq-card fq-card--list">${drafts.map(row).join('')}</div>` : ''}
         ${quoted.length ? `<p class="fq-lbl2">ORÇADOS</p><div class="fq-card fq-card--list">${quoted.map(row).join('')}</div>` : ''}`
      : '<p class="fq-empty">Nenhuma visita ainda. Comece pela visita do dia na agenda ou em “Nova visita”.</p>';
  }

  // ------------------------------------------------------------------ panel view
  function progress(d) {
    const measured = d.rooms.filter((r) => roomArea(r) > 0).length;
    const planOpen = d.floorplan && Array.isArray(d.floorplan.rooms) ? d.floorplan.rooms.filter((r) => !d.rooms.find((x) => x.id === r.measured_room_id)).length : 0;
    const roomsTotal = d.rooms.length + planOpen;
    const q = countAnswers(d);
    const withPhoto = d.rooms.filter((r) => photosOf(r.id).length).length;
    const st = (done, part) => (done ? 'is-done' : part ? 'is-part' : '');
    return [
      { name: 'Serviços', cls: st(d.services.length > 0) },
      { name: roomsTotal ? `Medidas ${measured}/${roomsTotal}` : 'Medidas', cls: st(measured > 0 && !planOpen, measured > 0) },
      { name: `Fotos ${d.photos.length}`, cls: st(d.rooms.length > 0 && withPhoto === d.rooms.length, d.photos.length > 0) },
      { name: q.total ? `Detalhes ${q.answered}/${q.total}` : 'Detalhes', cls: st(q.total > 0 && q.answered >= Math.min(3, q.total), q.answered > 0) },
    ];
  }
  function svcChips(d) {
    const chips = d.services.map((s) => {
      const def = svcDef(s);
      let t = def.pt;
      if (s === 'demolition') {
        const ex = (d.answers.demolition.existing || []).map((m) => mat(m).pt.split(' ')[0].toLowerCase());
        t = ex.length ? `Tirar ${ex.join(' e ')}` : 'Demolição';
      }
      if (s === 'installation') t = `${mat(d.svc.installation.material).pt.split(' (')[0]}${d.svc.installation.supply ? ' + material' : ''}`;
      if (s === 'sanding') t = (C.SANDING_TYPES.find((x) => x.id === d.svc.sanding.type) || {}).pt || def.pt;
      return `<button type="button" class="fq-chip is-on" data-fq-open="services">${esc(t)}</button>`;
    });
    return chips.join('') + `<button type="button" class="fq-chip" data-fq-open="services">${IC.plus(14)}${d.services.length ? 'Serviço' : 'Escolher serviços'}</button>`;
  }
  function roomCard(r) {
    const n = photosOf(r.id).length;
    const area = roomArea(r);
    const flag = area <= 0 ? '<span class="fq-flag">falta medir</span>' : !n ? '<span class="fq-flag">sem foto</span>' : `<span class="fq-ok" role="img" aria-label="Completo">${IC.check()}</span>`;
    return `<button type="button" class="fq-rc" data-fq-room="${esc(r.id)}"><span class="fq-rc__top"><b>${esc(r.label)}</b>${flag}</span><span class="fq-rc__area">${fmtN(area)} <small>pé²</small></span><span class="fq-rc__sub">${esc(roomDims(r))}${n ? ` · ${n} foto${n > 1 ? 's' : ''}` : ''}</span></button>`;
  }
  function sideHtml(t, tips) {
    const area = totalArea(S.d);
    return `${pendingCardHtml()}<section class="fq-live"><span class="fq-lbl2">PROPOSTA AO VIVO</span><b class="fq-live__tot">${esc(money(t.total))}</b><span class="fq-live__sub">${area ? `${fmtN(area)} pé² · ${esc(money(r2(t.total / area)))}/pé²` : 'meça os cômodos'} · preços ${esc((C.CUSTOMER_TYPES.find((x) => x.id === S.fq.customer_type) || {}).pt || '')}</span>
      <div class="fq-live__lines">${t.lines.map((l) => `<button type="button" class="fq-live__ln" data-fq-rate="${esc(l.key)}"><span>${esc(l.name)}${l.source === 'padrao' ? ' <em>preço padrão</em>' : ''}</span><b>${esc(money(l.amount))}</b></button>`).join('') || '<p class="fq-empty">As linhas aparecem aqui enquanto você mede.</p>'}</div></section>
      ${tipsCard(tips, 3)}`;
  }
  function renderPanel() {
    const fq = S.fq;
    const d = S.d;
    document.title = fq.client_name + ' · Field Quote';
    const t = totals(d);
    const ct = C.CUSTOMER_TYPES.find((x) => x.id === fq.customer_type) || C.CUSTOMER_TYPES[0];
    const quoted = fq.quote_id && fq.quote;
    const tips = mateTips();
    const extrasOn = C.EXTRAS.filter((e) => d.extras[e.id] && d.extras[e.id].on);
    const qCount = countAnswers(d);
    const planOpen = d.floorplan && Array.isArray(d.floorplan.rooms) ? d.floorplan.rooms.filter((r) => !d.rooms.find((x) => x.id === r.measured_room_id)) : [];
    const area = totalArea(d);
    $('#fqView').innerHTML = `<div class="fq-panel">
      <div class="fq-panel__main">
      <header class="fq-top"><a class="fq-back" href="field-quote.html">${IC.back()}Visitas</a><span class="fq-save" id="fqSave"></span></header>
      <button type="button" class="fq-client" data-fq-open="client">
        <h1 class="fq-h1">${esc(fq.client_name)}</h1>
        <p class="fq-sub">${esc(fq.address || 'Adicionar endereço')} · ${esc(ct.pt)} · <span class="fq-edit">Editar</span></p>
      </button>
      <div class="fq-prog" aria-label="Andamento da visita">${progress(d).map((p) => `<div class="fq-prog__i ${p.cls}"><i></i><span>${esc(p.name)}</span></div>`).join('')}</div>
      ${quoted ? `<div class="fq-quoted"><div><b>Orçamento ${esc(fq.quote.number)}</b><small>${esc(quoteStatusPt(fq.quote.status))}</small></div><a class="fq-btn fq-btn--sm" href="quote-builder.html?id=${esc(fq.quote_id)}${fq.lead_id ? '&lead_id=' + esc(fq.lead_id) : ''}">Abrir</a><button type="button" class="fq-btn fq-btn--sm fq-btn--ink" data-fq-present-existing>${IC.play()}Apresentar</button></div>` : ''}
      <div class="fq-only-phone">${pendingCardHtml()}${tipsCard(tips, 1)}</div>
      <section class="fq-sec"><p class="fq-lbl2">O QUE VAI SER FEITO</p><div class="fq-chips">${svcChips(d)}</div></section>
      <section class="fq-sec">
        <div class="fq-sec__head"><p class="fq-lbl2">CÔMODOS${area ? ` · ${fmtN(area)} PÉ²` : ''}</p>${d.services.length ? `<button type="button" class="fq-link2" data-fq-ai-measure>${IC.mic(15)}Ditar medidas</button>` : ''}</div>
        <div class="fq-rooms">${d.rooms.map(roomCard).join('')}
          ${planOpen.map((r) => `<button type="button" class="fq-rc fq-rc--todo" data-fq-plan-measure="${esc(r.id)}"><span class="fq-rc__top"><b>${esc(r.label)}</b><span class="fq-flag">falta medir</span></span><span class="fq-rc__sub">da planta das fotos</span></button>`).join('')}
          <button type="button" class="fq-rc fq-rc--add" data-fq-room-new>${IC.plus(22)}<span>Cômodo</span></button>
        </div>
      </section>
      <section class="fq-sec fq-list2">
        <button type="button" class="fq-li2" data-fq-open="extras"><span><b>Extras</b><small>${extrasOn.length || d.custom.length ? esc([...extrasOn.map((e) => e.pt), ...d.custom.map((c) => c.name).filter(Boolean)].join(' · ')) : 'Escada, rodapé, transições, descarte…'}</small></span>${IC.chev()}</button>
        <button type="button" class="fq-li2" data-fq-open="details"><span><b>Detalhes da obra</b><small>${qCount.answered ? `${qCount.answered} de ${qCount.total} respondidas` : 'Pets, acesso, piso atual, acabamento…'}${attentionSummary(d) ? ' · ' + esc(attentionSummary(d)) : ''}</small></span>${IC.chev()}</button>
        <div class="fq-li2 fq-li2--photos"><span><b>Fotos</b><small>${d.photos.length ? `${d.photos.length} foto${d.photos.length > 1 ? 's' : ''} · vão para o ObraCam do job` : 'Piso atual, danos, acesso'}</small></span>
          ${d.photos.length ? `<div class="fq-photos">${d.photos.slice(-8).map((p) => `<button type="button" class="fq-photo" data-fq-photo="${esc(p.id)}" style="background-image:url('${esc(p.url)}')" aria-label="Abrir foto"></button>`).join('')}</div>` : ''}
          <div class="fq-row2"><button type="button" class="fq-btn" data-fq-shoot>${IC.cam()}Tirar foto</button><button type="button" class="fq-btn fq-btn--quiet" data-fq-ai-photos ${d.photos.length ? '' : 'disabled'}>${IC.mate(18)}Ler fotos</button></div>
          ${d.photo_analysis && d.photo_analysis.observations && d.photo_analysis.observations.length ? `<small class="fq-mut">O Mate leu as fotos: ${esc(d.photo_analysis.observations.slice(0, 2).map((o) => o.title).join(' · '))}</small>` : ''}
        </div>
        <label class="fq-li2 fq-notes"><b>Notas internas</b><textarea id="fqNotes" data-crm-rich="off" rows="3" placeholder="O que a equipe precisa saber (não vai para o cliente)">${esc(d.notes || '')}</textarea></label>
      </section>
      </div>
      <aside class="fq-panel__side" aria-label="Proposta e Mate">${sideHtml(t, tips)}</aside>
      <footer class="fq-bar">
        <div class="fq-bar__mate">
          <button type="button" class="fq-round" data-fq-shoot aria-label="Tirar foto">${IC.cam()}</button>
          <button type="button" class="fq-matebtn" data-fq-ai-conversation="listen">${IC.mic(20)}<span>Fale com o Mate</span></button>
        </div>
        <div class="fq-bar__sum"><div class="fq-bar__tot"><small>Total${area ? ` · ${esc(money(r2(t.total / area)))}/pé²` : ''}</small><b id="fqTotal">${esc(money(t.total))}</b></div><button type="button" class="fq-btn fq-btn--pri fq-btn--big" data-fq-open="review" ${t.lines.length ? '' : 'disabled'}>Revisar</button></div>
      </footer>
    </div>`;
    $('#fqLoading').hidden = true;
    renderSaveState();
  }

  const photosOf = (roomId) => (S.d.photos || []).filter((p) => p.room_id === roomId);
  function renderFloorplanSvg(plan) {
    const colors = ['#FCE8D8', '#E7EEF8', '#E7F1EC', '#F3EAF7', '#F5EFD9', '#E9EEF0'];
    const rooms = Array.isArray(plan && plan.rooms) ? plan.rooms : [];
    return `<svg class="fq-plan-svg" viewBox="0 0 100 100" role="img" aria-label="Esboço aproximado da planta baixa">${rooms.map((r, i) => {
      const w = Math.max(1, Math.min(100, Number(r.w) || 1));
      const h = Math.max(1, Math.min(100, Number(r.h) || 1));
      const x = Math.max(0, Math.min(100 - w, Number(r.x) || 0));
      const y = Math.max(0, Math.min(100 - h, Number(r.y) || 0));
      const label = String(r.label || `Área ${i + 1}`);
      const fs = Math.max(3.4, Math.min(6.2, Math.min(w, h) / 5));
      return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.4" fill="${colors[i % colors.length]}" stroke="#7F5A42" stroke-width="0.7"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-family="sans-serif" fill="#221E1A">${esc(label.slice(0, 24))}</text></g>`;
    }).join('')}</svg>`;
  }
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
    const standaloneQuoteId = S.presentationQuoteOnly ? S.presentationQuoteId : null;
    stopAiAudio();
    if (S.ai) {
      S.ai.conversationOpen = false;
      if (S.ai.conversationRecognition) {
        const recognition = S.ai.conversationRecognition;
        S.ai.conversationRecognition = null;
        try { recognition.stop(); } catch (_) {}
      }
    }
    if (S.ai && S.ai.presentation) {
      S.ai.presentation = null;
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
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
    if (standaloneQuoteId) {
      S.presentationQuoteOnly = false;
      if (window.opener && !window.opener.closed) {
        window.close();
        setTimeout(() => {
          if (!window.closed) location.href = `quote-builder.html?id=${encodeURIComponent(standaloneQuoteId)}`;
        }, 250);
      } else {
        location.href = `quote-builder.html?id=${encodeURIComponent(standaloneQuoteId)}`;
      }
    }
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
          <button type="button" class="fq-btn fq-btn--block fq-btn--ghost" data-fq-geo>${IC.route()}Usar minha localização</button></div>
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
        <div class="fq-svcs">${C.SERVICES.map((s) => `<button type="button" class="fq-svc${d.services.includes(s.id) ? ' is-on' : ''}" data-fq-svc="${s.id}"><span class="fq-svc__ck">${IC.check(14)}</span><b>${esc(s.pt)}</b></button>`).join('')}</div>
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
    const ids = d.rooms.map((x) => x.id);
    const at = ids.indexOf(r.id);
    const nav = S.sheet.isNew
      ? `<h2>Novo cômodo</h2>`
      : `<div class="fq-rnav"><button type="button" class="fq-rnav__b" data-fq-room-go="-1" ${at > 0 ? '' : 'disabled'} aria-label="Cômodo anterior">${IC.back()}</button><h2>${esc(r.label)}<small>${at + 1} de ${ids.length}</small></h2><button type="button" class="fq-rnav__b" data-fq-room-go="1" aria-label="${at < ids.length - 1 ? 'Próximo cômodo' : 'Novo cômodo'}">${IC.chev()}</button></div>`;
    openSheet(
      `<header class="fq-sbar"><button type="button" class="fq-link" data-fq-close>Cancelar</button>${nav}<button type="button" class="fq-link fq-link--b" data-fq-room-save>Salvar</button></header>
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
        <div class="fq-row2"><button type="button" class="fq-btn" data-fq-shoot="${esc(r.id)}">${IC.cam()}Foto deste cômodo</button><button type="button" class="fq-btn fq-btn--quiet" data-fq-ai-measure>${IC.mic(18)}Ditar medidas</button></div>
        <button type="button" class="fq-btn fq-btn--ink fq-btn--block fq-btn--next" data-fq-room-next>Salvar e medir o próximo</button>
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
    if (S.sheet.planRoomId && S.d.floorplan && Array.isArray(S.d.floorplan.rooms)) {
      const planRoom = S.d.floorplan.rooms.find((x) => x.id === S.sheet.planRoomId);
      if (planRoom) { planRoom.measured_room_id = r.id; planRoom.label = r.label; }
    }
    markDirty();
    toast(`${r.label}: ${fmtN(roomArea(r))} pé²`, 'success');
    if (keepOpen) {
      const ids = S.d.rooms.map((x) => x.id);
      const next = ids[ids.indexOf(r.id) + 1];
      const after = S.d.rooms.find((x) => x.id === next && roomArea(x) <= 0);
      sheetRoom(after ? after.id : null);
    } else closeSheet();
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
        <div class="fq-ai-review"><button type="button" class="fq-btn fq-btn--block fq-btn--ghost" data-fq-ai-assist>Abrir copiloto da visita</button><p class="fq-hint">Pergunte o que conferir ou o que esclarecer com o cliente, usando o contexto desta obra.</p></div>
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

  // review → "Resultado"
  function lineGroup(l) {
    const n = String(l.name || '').toLowerCase();
    if (l.key === 'supply') return 'Material';
    if (l.key === 'installation') return 'Instalação';
    if (l.key === 'demolition') return 'Remoção do piso';
    if (l.key === 'sanding') return 'Lixa e acabamento';
    if (l.key === 'stairs') return 'Escada';
    if (l.key === 'haul_away') return 'Descarte';
    if (['baseboard_install', 'baseboard_remove', 'quarter_round', 'transitions'].includes(l.key) || /trim|transition/.test(n)) return 'Acabamentos';
    if (['underlayment', 'moisture', 'leveling'].includes(l.key)) return 'Preparo do contrapiso';
    return 'Outros';
  }
  function moneyRows(t, view) {
    const d = S.d;
    let rows = [];
    if (view === 'room') {
      const acc = new Map(d.rooms.map((r) => [r.id, 0]));
      let general = 0;
      t.lines.forEach((l) => {
        const sid = l.key === 'supply' ? 'installation' : l.key;
        if (l.unit === 'sq_ft' && C.SERVICES.some((s) => s.id === sid)) {
          const pool = d.rooms.filter((r) => (r.services || []).includes(sid));
          const a = pool.reduce((s, r) => s + roomArea(r), 0);
          if (a > 0) return pool.forEach((r) => acc.set(r.id, acc.get(r.id) + (l.amount * roomArea(r)) / a));
        }
        if (l.unit === 'linear_ft' || (l.unit === 'sq_ft' && ['underlayment', 'moisture'].includes(l.key))) {
          const pool = d.rooms.filter((r) => (l.unit === 'linear_ft' ? roomPerimeter(r) : roomArea(r)) > 0);
          const tot = pool.reduce((s, r) => s + (l.unit === 'linear_ft' ? roomPerimeter(r) : roomArea(r)), 0);
          if (tot > 0) return pool.forEach((r) => acc.set(r.id, acc.get(r.id) + (l.amount * (l.unit === 'linear_ft' ? roomPerimeter(r) : roomArea(r))) / tot));
        }
        general += l.amount;
      });
      rows = d.rooms.map((r) => ({ label: r.label, sub: `${fmtN(roomArea(r))} pé²`, amount: r2(acc.get(r.id)) }));
      if (general > 0) rows.push({ label: 'Geral', sub: 'escada, descarte, itens fixos', amount: r2(general) });
    } else {
      const g = new Map();
      t.lines.forEach((l) => {
        const k = lineGroup(l);
        const cur = g.get(k) || { label: k, amount: 0, lines: [] };
        cur.amount += l.amount;
        cur.lines.push(l);
        g.set(k, cur);
      });
      rows = [...g.values()].map((x) => ({ label: x.label, sub: x.lines.length === 1 ? `${fmtN(x.lines[0].quantity)} ${C.UNIT_PT[x.lines[0].unit] || ''} × ${money(x.lines[0].rate)}` : `${x.lines.length} itens`, amount: r2(x.amount), lines: x.lines }));
    }
    if (t.tax) rows.push({ label: 'Imposto', sub: `${S.taxRate}%`, amount: t.tax });
    return rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  }
  function sheetReview() {
    const t = totals(S.d);
    const fq = S.fq;
    const quoted = fq.quote_id && fq.quote;
    const locked = quoted && ['approved', 'converted'].includes(fq.quote.status);
    const area = totalArea(S.d);
    const view = S.reviewView || 'svc';
    const rows = moneyRows(t, view);
    const max = Math.max(1, ...rows.map((r) => r.amount));
    const tips = mateTips();
    const ai = S.ai.review;
    openSheet(
      `${bar('Resultado', 'none')}
      <div class="fq-sbody fq-result">
        <div class="fq-bigtotal"><small>Total para o cliente</small><b>${esc(money(t.total))}</b><span>preços ${esc((C.CUSTOMER_TYPES.find((x) => x.id === fq.customer_type) || {}).pt)}</span></div>
        <div class="fq-stats">
          <div><small>Por pé²</small><b>${area ? esc(money(r2(t.total / area))) : '—'}</b></div>
          <div><small>Área</small><b>${fmtN(area)} pé²</b></div>
          <div><small>Cômodos</small><b>${S.d.rooms.length}</b></div>
        </div>
        <section class="fq-money">
          <div class="fq-money__head"><b>Para onde vai o dinheiro</b>
            <div class="fq-seg fq-seg--sm" role="group" aria-label="Agrupar por"><button type="button" class="${view === 'room' ? 'is-on' : ''}" data-fq-review-view="room" aria-pressed="${view === 'room'}">Cômodo</button><button type="button" class="${view === 'svc' ? 'is-on' : ''}" data-fq-review-view="svc" aria-pressed="${view === 'svc'}">Serviço</button></div></div>
          ${rows
            .map((r, i) => {
              const tap = view === 'svc' && r.lines && r.lines.length === 1 ? ` data-fq-rate="${esc(r.lines[0].key)}"` : '';
              const warn = r.lines && r.lines.some((l) => l.source === 'padrao') ? ' <em>preço padrão</em>' : '';
              return `<${tap ? 'button type="button"' : 'div'} class="fq-mrow" style="animation-delay:${(i * 0.06).toFixed(2)}s"${tap}><span class="fq-mrow__top"><span>${esc(r.label)} <small>${esc(r.sub)}</small>${warn}</span><b>${esc(money(r.amount))}</b></span><span class="fq-mrow__bar"><i style="width:${Math.max(2, Math.round((r.amount / max) * 100))}%;animation-delay:${(i * 0.06).toFixed(2)}s"></i></span></${tap ? 'button' : 'div'}>${view === 'svc' && r.lines && r.lines.length > 1 ? r.lines.map((l) => `<button type="button" class="fq-msub" data-fq-rate="${esc(l.key)}"><span>${esc(l.name)}${l.source === 'padrao' ? ' <em>preço padrão</em>' : ''}</span><small>${esc(fmtN(l.quantity))} ${esc(C.UNIT_PT[l.unit] || '')} × ${esc(money(l.rate))}</small><b>${esc(money(l.amount))}</b></button>`).join('') : ''}`;
            })
            .join('')}
          <p class="fq-hint">${view === 'svc' ? 'Toque numa linha para trocar o preço. O cliente vê os nomes em inglês.' : 'Divisão aproximada pela área e pelo perímetro de cada cômodo.'}</p>
        </section>
        ${locked ? `<div class="fq-banner">Orçamento ${esc(fq.quote.number)} já está ${esc(quoteStatusPt(fq.quote.status))}. Mudanças aqui não alteram mais o orçamento.</div>` : ''}
        <section class="fq-mate">
          <div class="fq-mate__head">${IC.mate()}<b>Antes de mostrar ao cliente</b>${tips.length ? `<span>${tips.length} ponto${tips.length > 1 ? 's' : ''}</span>` : ''}</div>
          ${tips.map((x) => tipHtml(x, true)).join('')}
          ${ai ? `${ai.checks.map((item) => `<div class="fq-tip fq-tip--row"><div class="fq-tip__txt"><b>${esc(item.title)}</b> ${esc(item.detail)}</div></div>`).join('')}${ai.suggested_extras.length ? `<div class="fq-tip fq-tip--row"><div class="fq-tip__txt">Extras para avaliar: ${ai.suggested_extras.map((item) => { const extra = C.EXTRAS.find((x) => x.id === item.id); return `<b>${esc(extra ? extra.pt : item.id)}</b> (${esc(item.reason)})`; }).join('; ')}</div><div class="fq-tip__acts"><button type="button" class="fq-btn fq-btn--sm" data-fq-open-extras>Revisar extras</button></div></div>` : ''}${!ai.checks.length && !ai.suggested_extras.length ? '<p class="fq-mut">A revisão completa não achou pendências.</p>' : ''}` : `<button type="button" class="fq-btn fq-btn--quiet fq-btn--block" data-fq-ai-review>Revisão completa com o Mate</button>`}
          <small class="fq-mut">O Mate sugere; nada muda no orçamento sem o seu toque.</small>
        </section>
      </div>
      <footer class="fq-sfoot">
        <button type="button" class="fq-btn fq-btn--pri fq-btn--big fq-btn--block" data-fq-finish="present" ${locked && !quoted ? 'disabled' : ''}>${IC.play()}Apresentar ao cliente</button>
        <div class="fq-row2"><button type="button" class="fq-btn" data-fq-finish="sms" ${locked ? 'disabled' : ''}>Enviar link (SMS)</button><button type="button" class="fq-btn" data-fq-finish="open">${quoted ? 'Atualizar e abrir' : 'Abrir no editor'}</button></div>
        <button type="button" class="fq-link2 fq-link2--c" data-fq-finish="sign" ${locked ? 'disabled' : ''}>Cliente assina agora, sem apresentação</button>
      </footer>`,
      'fq-sheet__card--tall'
    );
    S.sheet = { kind: 'review' };
  }

  // ------------------------------------------------------------------ client tour (animated proposal)
  function tourSpeak(text) {
    if (S.ai.speechVoiceId) return playAiAudio(text);
    if (window.QuoteTour) window.QuoteTour.browserSpeak(text);
  }
  function tourStop() {
    stopAiAudio();
    if (window.QuoteTour) window.QuoteTour.browserStop();
  }
  async function openTour(btn) {
    if (!window.QuoteTour) return toast('A apresentação não carregou. Atualize a página.', 'error');
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Preparando…'; }
    try {
      void loadElevenLabsVoices();
      const j = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/tour`);
      if (S.sheet || !$('#fqSheet').hidden) closeSheet();
      const ok = window.QuoteTour.open(j.data, {
        approveLabel: 'Approve & sign',
        speak: tourSpeak,
        stopSpeak: tourStop,
        onApprove: async () => {
          try {
            const pub = await api(`/api/quotes/${encodeURIComponent(S.fq.quote_id)}/publish-client`, { method: 'POST', body: { mark_sent: true } });
            location.href = pub.public_url;
          } catch (e) { toast(e.message, 'error'); }
        },
      });
      if (!ok) toast('Meça pelo menos um cômodo para apresentar.', 'error');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
    }
  }
  function sheetAiAssist() {
    S.ai.assistResult = null;
    S.ai.assistQuestion = '';
    renderAiAssist();
  }
  function renderAiAssist() {
    const result = S.ai.assistResult;
    openSheet(
      `${bar('Copiloto da visita', '<button type="button" class="fq-link fq-link--b" data-fq-ai-assist-run>Consultar</button>')}
      <div class="fq-sbody">
        <p class="fq-hint fq-ai-lead">Faça uma pergunta sobre esta obra. O copiloto considera os serviços, medidas, respostas e observações já salvas.</p>
        <label class="fq-field fq-field--col fq-group"><span>Sua pergunta</span><textarea id="fqAiAssistQuestion" rows="4" maxlength="1000" placeholder="Ex.: O que devo confirmar antes de instalar LVP sobre o piso atual?">${esc(S.ai.assistQuestion)}</textarea></label>
        <button type="button" class="fq-btn fq-btn--block fq-btn--pri" data-fq-ai-assist-run>Consultar copiloto</button>
        ${result ? `<section class="fq-ai-assist-result"><h3>Orientação</h3><p>${esc(result.answer)}</p>${result.checks.length ? `<h4>Pontos para conferir</h4>${result.checks.map((item) => `<article class="fq-ai-finding"><b>${esc(item.title)}</b><p>${esc(item.detail)}</p></article>`).join('')}` : ''}${result.questions.length ? `<h4>Perguntas para o cliente</h4>${result.questions.map((item) => `<button type="button" class="fq-ai-question-chip" data-fq-ai-assist-fill="${esc(item.question)}"><b>${esc(item.question)}</b><small>${esc(item.reason)}</small></button>`).join('')}` : ''}<small class="fq-ai-source">Orientação da IA · confirme as condições e os requisitos aplicáveis no local.</small></section>` : ''}
        <p class="fq-hint">O copiloto não altera medidas, serviços ou preços.</p>
      </div>`,
      'fq-sheet__card--tall'
    );
  }
  async function runAiAssist() {
    const question = ($('#fqAiAssistQuestion') || {}).value || '';
    if (question.trim().length < 3) return toast('Escreva uma pergunta primeiro.', 'error');
    S.ai.assistQuestion = question.trim();
    const buttons = $$('[data-fq-ai-assist-run]');
    buttons.forEach((button) => { button.disabled = true; button.textContent = 'Consultando…'; });
    try {
      await save();
      if (S.dirty) throw new Error('Aguarde o Field Quote salvar para consultar o contexto atual.');
      const response = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/ai/assist`, { method: 'POST', body: { question: S.ai.assistQuestion } });
      S.ai.assistResult = response.data;
      renderAiAssist();
    } catch (e) {
      toast(e.message, 'error');
      const current = $$('[data-fq-ai-assist-run]');
      current.forEach((button) => { button.disabled = false; button.textContent = button.closest('.fq-sbar') ? 'Consultar' : 'Consultar copiloto'; });
    }
  }
  function sheetAiConversation(listen) {
    if (!Array.isArray(S.d.ai_conversation)) S.d.ai_conversation = [];
    S.ai.conversationOpen = true;
    renderAiConversation(!listen);
    void loadElevenLabsVoices();
    if (listen && (window.SpeechRecognition || window.webkitSpeechRecognition)) dictateAiConversation();
  }
  /** Preview a Mate patch on a copy, so the card can say exactly what would change. */
  function previewPatch(patch) {
    const real = S.d;
    const before = totals(real).total;
    S.d = JSON.parse(JSON.stringify(real));
    let changes = [];
    let after = before;
    try {
      changes = applyAiConversationPatch(patch || {});
      after = totals(S.d).total;
    } finally {
      S.d = real;
    }
    return { patch, changes, delta: r2(after - before) };
  }
  function pendingCardHtml() {
    const p = S.ai.pending;
    if (!p || !p.changes.length) return '';
    return `<section class="fq-pending" aria-label="Mudanças propostas pelo Mate">
      <div class="fq-mate__head">${IC.mate()}<b>Vou aplicar</b>${p.delta ? `<span class="fq-pending__d">${p.delta > 0 ? '+' : ''}${esc(money(p.delta))}</span>` : ''}</div>
      <ul>${p.changes.map((c) => `<li>${esc(String(c).replace(/^Adicionei /, 'Adicionar ').replace(/^Removi /, 'Remover ').replace(/^Atualizei /, 'Atualizar ').replace(/^Registrei /, 'Registrar ').replace(/^Anotei /, 'Anotar '))}</li>`).join('')}</ul>
      <div class="fq-row2"><button type="button" class="fq-btn" data-fq-pending-no>Descartar</button><button type="button" class="fq-btn fq-btn--pri" data-fq-pending-yes>Confirmar</button></div>
    </section>`;
  }
  function confirmPending(ok) {
    const p = S.ai.pending;
    S.ai.pending = null;
    if (ok && p) {
      applyAiConversationPatch(p.patch);
      markDirty();
      renderPanel();
      toast('Orçamento atualizado.', 'success');
      save();
    }
    if (S.ai.conversationOpen) renderAiConversation();
  }
  function renderAiConversation(focusInput) {
    const messages = Array.isArray(S.d.ai_conversation) ? S.d.ai_conversation : [];
    const estimate = totals(S.d);
    const serviceCount = S.d.services.length;
    const roomCount = S.d.rooms.length;
    const hasSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasSpeechOutput = S.ai.speechVoices.length > 0;
    const listening = Boolean(S.ai.conversationRecognition);
    const messageHtml = messages.map((message) => {
      const isUser = message.role === 'user';
      return `<article class="fq-chat__message ${isUser ? 'fq-chat__message--user' : 'fq-chat__message--assistant'}"><p>${esc(message.content)}</p></article>`;
    }).join('');
    openSheet(
      `${bar('Mate', 'none')}
      <div class="fq-chat">
        <div class="fq-chat__summary"><span>${serviceCount} serviço${serviceCount === 1 ? '' : 's'}</span><span>${roomCount} cômodo${roomCount === 1 ? '' : 's'}</span><b>${esc(money(estimate.total))}</b></div>
        <div class="fq-chat__messages" id="fqAiConversationMessages" role="log" aria-label="Conversa sobre o orçamento" aria-live="polite">
          ${messages.length ? messageHtml : `<div class="fq-chat__welcome"><b>Fale como contaria para alguém da equipe.</b><p>Cômodo por cômodo: o que sai, o que entra e as medidas. Eu monto e você confirma.</p><small>Ex.: “Sala dezesseis por doze, tira o carpete e coloca LVP. Corredor dez por quatro, mesmo piso.”</small></div>`}
          ${S.ai.conversationBusy ? '<div class="fq-chat__typing" role="status"><i></i><i></i><i></i><span>Um instante…</span></div>' : ''}
          ${pendingCardHtml()}
        </div>
        <div class="fq-chat__composer">
          ${listening ? '<div class="fq-listen" role="status"><span class="fq-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Ouvindo… toque em Parar quando terminar</div>' : ''}
          <div class="fq-chat__composer-row">
            <textarea id="fqAiConversationInput" rows="1" maxlength="1400" aria-label="Descreva o que será feito" placeholder="Digite ou toque no microfone" ${S.ai.conversationBusy ? 'disabled' : ''}></textarea>
            <button type="button" class="fq-round fq-round--ink${listening ? ' is-live' : ''}" data-fq-ai-conversation-mic ${!hasSpeech || S.ai.conversationBusy ? 'disabled' : ''} aria-label="${listening ? 'Parar captura de voz' : 'Falar com o Mate'}">${listening ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>' : IC.mic(20)}</button>
            <button type="button" class="fq-btn fq-btn--pri fq-chat__send" data-fq-ai-conversation-send ${S.ai.conversationBusy ? 'disabled' : ''}>Enviar</button>
          </div>
          <div class="fq-chat__opts">
            <label class="fq-chat__language"><span>Fala em</span><select id="fqAiConversationLanguage" aria-label="Idioma da fala"><option value="pt-BR">Português</option><option value="en-US">English</option></select></label>
            ${hasSpeechOutput ? `<button type="button" class="fq-chat__speak" data-fq-ai-conversation-speak-toggle aria-pressed="${S.ai.conversationSpeakReplies ? 'true' : 'false'}">${S.ai.conversationSpeakReplies ? 'Mate responde em voz' : 'Resposta só em texto'}</button>` : ''}
          </div>
          ${!hasSpeech ? '<p class="fq-chat__footnote">Microfone indisponível neste navegador: use o ditado do teclado.</p>' : ''}
        </div>
      </div>`,
      'fq-sheet__card--tall fq-sheet__card--conversation'
    );
    const stream = $('#fqAiConversationMessages');
    if (stream) stream.scrollTop = stream.scrollHeight;
    if (focusInput && window.innerWidth >= 768) $('#fqAiConversationInput')?.focus();
  }
  function applyAiConversationPatch(patch) {
    const changes = [];
    const serviceNames = (ids) => ids.map((id) => svcDef(id)?.pt).filter(Boolean);
    const removeServices = [...new Set((patch.services_remove || []).filter((id) => C.SERVICES.some((service) => service.id === id)))];
    const addServices = [...new Set((patch.services_add || []).filter((id) => C.SERVICES.some((service) => service.id === id)))];
    S.d.services = [...new Set(S.d.services.filter((id) => !removeServices.includes(id)).concat(addServices))];
    if (removeServices.length) {
      S.d.rooms.forEach((room) => { room.services = (room.services || []).filter((id) => !removeServices.includes(id)); });
      changes.push(`Removi ${serviceNames(removeServices).join(', ')}`);
    }
    if (addServices.length) changes.push(`Adicionei ${serviceNames(addServices).join(', ')}`);

    const installation = patch.installation || {};
    if (S.d.services.includes('installation')) {
      if (installation.material && C.MATERIALS.some((item) => item.id === installation.material)) {
        S.d.svc.installation.material = installation.material;
        changes.push(`Material: ${mat(installation.material).pt}`);
      }
      if (installation.pattern && C.PATTERNS.some((item) => item.id === installation.pattern)) {
        S.d.svc.installation.pattern = installation.pattern;
        changes.push(`Paginação: ${C.PATTERNS.find((item) => item.id === installation.pattern).pt}`);
      }
      if (typeof installation.supply === 'boolean') {
        S.d.svc.installation.supply = installation.supply;
        changes.push(installation.supply ? 'Material fornecido pela equipe' : 'Material fornecido pelo cliente');
      }
    }
    if (S.d.services.includes('sanding') && patch.sanding_type && C.SANDING_TYPES.some((item) => item.id === patch.sanding_type)) {
      S.d.svc.sanding.type = patch.sanding_type;
      changes.push(`Tipo de acabamento: ${C.SANDING_TYPES.find((item) => item.id === patch.sanding_type).pt}`);
    }

    const roomIdsToRemove = new Set(patch.rooms_remove_ids || []);
    if (roomIdsToRemove.size) {
      const before = S.d.rooms.length;
      S.d.rooms = S.d.rooms.filter((room) => !roomIdsToRemove.has(room.id));
      if (S.d.rooms.length < before) changes.push(`Removi ${before - S.d.rooms.length} cômodo${before - S.d.rooms.length === 1 ? '' : 's'}`);
    }
    let updatedRooms = 0;
    (patch.rooms_update || []).forEach((update) => {
      const room = S.d.rooms.find((candidate) => candidate.id === update.id);
      if (!room) return;
      const allowed = ['label', 'base', 'mode', 'l_ft', 'l_in', 'w_ft', 'w_in', 'sqft', 'parts', 'services', 'note'];
      allowed.forEach((key) => { if (Object.prototype.hasOwnProperty.call(update, key)) room[key] = update[key]; });
      if (Array.isArray(room.services)) room.services = room.services.filter((id) => S.d.services.includes(id));
      const roomDef = C.ROOMS.find((item) => item.pt === room.base);
      if (roomDef && room.base !== '__custom') {
        const suffix = String(room.label || '').match(/\s+(\d+)$/)?.[1];
        room.en = suffix && roomDef.numbered ? `${roomDef.en} ${suffix}` : roomDef.en;
      }
      updatedRooms++;
    });
    if (updatedRooms) changes.push(`Atualizei ${updatedRooms} cômodo${updatedRooms === 1 ? '' : 's'}`);

    const newRooms = (patch.rooms_add || []).filter((room) => {
      if (room.mode === 'area') return Number(room.sqft) > 0;
      return toFt(room.l_ft, room.l_in) > 0 && toFt(room.w_ft, room.w_in) > 0;
    }).map((room) => {
      const roomDef = C.ROOMS.find((item) => item.pt === room.base);
      const roomServices = Array.isArray(room.services) && room.services.length ? room.services : S.d.services;
      const suffix = String(room.label || '').match(/\s+(\d+)$/)?.[1];
      return Object.assign({}, room, {
        id: uid(),
        en: roomDef && room.base !== '__custom' ? `${roomDef.en}${suffix && roomDef.numbered ? ` ${suffix}` : ''}` : room.label,
        services: roomServices.filter((id) => S.d.services.includes(id)),
      });
    }).filter((room) => room.services.length > 0);
    if (newRooms.length) {
      S.d.rooms.push(...newRooms);
      changes.push(`Adicionei ${newRooms.length} cômodo${newRooms.length === 1 ? '' : 's'}`);
    }

    let extrasChanged = 0;
    (patch.extras || []).forEach((item) => {
      const definition = C.EXTRAS.find((extra) => extra.id === item.id);
      if (!definition) return;
      if (!item.on) {
        if (S.d.extras[item.id]) S.d.extras[item.id].on = false;
        extrasChanged++;
        return;
      }
      if (definition.qty === 'manual' && definition.unit !== 'fixed' && !(Number(item.qty) > 0)) return;
      const state = S.d.extras[item.id] = Object.assign({}, S.d.extras[item.id] || {}, { on: true });
      if (definition.unit === 'fixed') Object.assign(state, { qty: 1, auto: false });
      else if (definition.qty !== 'manual') Object.assign(state, { qty: null, auto: true });
      else Object.assign(state, { qty: Number(item.qty), auto: false });
      extrasChanged++;
    });
    if (extrasChanged) changes.push(`Atualizei ${extrasChanged} extra${extrasChanged === 1 ? '' : 's'}`);

    let detailChanges = 0;
    (patch.answers || []).forEach((answer) => {
      const group = C.QUESTIONS[answer.group];
      const question = group && group.find((item) => item.id === answer.id);
      if (!question) return;
      let valid = false;
      if (question.type === 'bool') valid = typeof answer.value === 'boolean';
      else if (question.type === 'number') valid = typeof answer.value === 'number' && Number.isFinite(answer.value) && answer.value >= 0;
      else if (question.type === 'text') valid = typeof answer.value === 'string';
      else if (question.type === 'multi') valid = Array.isArray(answer.value) && answer.value.every((value) => question.options.includes(value));
      else if (question.type === 'choice') valid = typeof answer.value === 'string' && question.options.some((option) => (Array.isArray(option) ? option[0] : option) === answer.value);
      if (!valid) return;
      S.d.answers[answer.group] = S.d.answers[answer.group] || {};
      S.d.answers[answer.group][answer.id] = answer.value;
      detailChanges++;
    });
    if (detailChanges) changes.push(`Registrei ${detailChanges} detalhe${detailChanges === 1 ? '' : 's'} da obra`);

    const note = String(patch.notes_append || '').trim();
    if (note) {
      S.d.notes = [S.d.notes, note].filter(Boolean).join('\n');
      changes.push('Anotei o detalhe interno da obra');
    }
    return changes;
  }
  async function sendAiConversation(message, fromVoice) {
    const input = $('#fqAiConversationInput');
    const text = String(message == null ? (input && input.value || '') : message).trim().slice(0, 1400);
    if (!text || S.ai.conversationBusy) return;
    S.ai.pending = null;
    const history = (S.d.ai_conversation || []).filter((item) => !item.transient).slice(-20).map((item) => ({ role: item.role, content: item.content }));
    S.d.ai_conversation.push({ role: 'user', content: text });
    S.d.ai_conversation = S.d.ai_conversation.slice(-40);
    S.ai.conversationBusy = true;
    markDirty();
    renderAiConversation();
    try {
      const saveDeadline = Date.now() + 30_000;
      while (S.saving && Date.now() < saveDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
      if (S.saving) throw new Error('O quote ainda está salvando. Tente enviar novamente em alguns segundos.');
      if (!navigator.onLine) throw new Error('Sem conexão: volte a ficar online para continuar a conversa.');
      await save();
      if (S.dirty) throw new Error('Não consegui salvar o quote. Confira sua conexão e tente novamente.');
      const response = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/ai/conversation`, {
        method: 'POST',
        body: { message: text, history },
      });
      // Nothing changes until the user confirms the card.
      const pending = previewPatch(response.data.patch || {});
      S.ai.pending = pending.changes.length ? pending : null;
      S.d.ai_conversation.push({ role: 'assistant', content: response.data.reply });
      S.d.ai_conversation = S.d.ai_conversation.slice(-40);
      S.ai.conversationBusy = false;
      if (fromVoice) void speakAiConversation(response.data.reply);
      markDirty();
      if (S.ai.conversationOpen) renderAiConversation();
      await save();
    } catch (e) {
      S.ai.conversationBusy = false;
      S.d.ai_conversation.push({ role: 'assistant', content: e.message || 'Não consegui continuar agora. Tente novamente.', transient: true });
      S.d.ai_conversation = S.d.ai_conversation.slice(-40);
      markDirty();
      if (S.ai.conversationOpen) renderAiConversation();
      else toast(e.message || 'Não consegui continuar agora.', 'error');
    }
  }
  function stopAiAudio() {
    S.ai.speechRequestId++;
    if (S.ai.speechAudio) {
      S.ai.speechAudio.pause();
      S.ai.speechAudio.src = '';
      S.ai.speechAudio = null;
    }
    if (S.ai.speechUrl) {
      URL.revokeObjectURL(S.ai.speechUrl);
      S.ai.speechUrl = null;
    }
  }
  async function loadElevenLabsVoices() {
    if (S.ai.speechVoicesLoaded || S.ai.speechVoicesLoading) return;
    S.ai.speechVoicesLoading = true;
    S.ai.speechVoicesError = '';
    try {
      const result = await api('/api/field-quotes/ai/voices');
      S.ai.speechVoices = Array.isArray(result.data.voices) ? result.data.voices : [];
      let savedVoiceId = '';
      try { savedVoiceId = localStorage.getItem('fq_ai_eleven_voice') || ''; } catch (_) {}
      const portugueseVoice = S.ai.speechVoices.find((voice) => [...(voice.languages || []), voice.labels && voice.labels.language].filter(Boolean).some((language) => /(^pt\b|portuguese)/i.test(language)));
      const preferred = savedVoiceId || result.data.default_voice_id || (portugueseVoice && portugueseVoice.voiceId) || '';
      S.ai.speechVoiceId = S.ai.speechVoices.some((voice) => voice.voiceId === preferred)
        ? preferred
        : (S.ai.speechVoices[0] && S.ai.speechVoices[0].voiceId) || '';
      S.ai.speechVoicesLoaded = true;
    } catch (e) {
      S.ai.speechVoicesError = e.message || 'Não foi possível carregar as vozes ElevenLabs.';
    } finally {
      S.ai.speechVoicesLoading = false;
      if (S.ai.conversationOpen) renderAiConversation();
      else if (S.ai.presentation) renderPresentation();
    }
  }
  async function playAiAudio(text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;
    if (!S.ai.speechVoiceId) {
      toast(S.ai.speechVoicesError || 'Configure a chave ElevenLabs no servidor e escolha uma voz.', 'error');
      return;
    }
    const endpoint = S.presentationQuoteOnly
      ? `/api/quotes/${encodeURIComponent(S.presentationQuoteId)}/ai/speech`
      : S.fq && S.fq.id ? `/api/field-quotes/${encodeURIComponent(S.fq.id)}/ai/speech` : null;
    if (!endpoint) return toast('Não encontrei o orçamento para gerar a narração.', 'error');
    stopAiAudio();
    const requestId = S.ai.speechRequestId;
    const cacheKey = `${S.ai.speechVoiceId}\n${cleanText}`;
    try {
      let blob = S.ai.speechCache.get(cacheKey);
      if (!blob) {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText, voice_id: S.ai.speechVoiceId }),
        });
        if (response.status === 401) {
          location.href = '/login.html';
          throw new Error('Sessão expirada');
        }
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          throw new Error(failure.message || failure.error || 'Não foi possível gerar a voz.');
        }
        blob = await response.blob();
        S.ai.speechCache.set(cacheKey, blob);
        while (S.ai.speechCache.size > 6) S.ai.speechCache.delete(S.ai.speechCache.keys().next().value);
      }
      if (requestId !== S.ai.speechRequestId) return;
      const audioUrl = URL.createObjectURL(blob);
      S.ai.speechUrl = audioUrl;
      const audio = new Audio(audioUrl);
      S.ai.speechAudio = audio;
      const release = () => {
        if (S.ai.speechAudio === audio) S.ai.speechAudio = null;
        if (S.ai.speechUrl === audioUrl) {
          URL.revokeObjectURL(audioUrl);
          S.ai.speechUrl = null;
        }
      };
      audio.addEventListener('ended', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      await audio.play();
    } catch (e) {
      if (requestId === S.ai.speechRequestId) {
        stopAiAudio();
        toast(e.message || 'Não foi possível reproduzir o áudio.', 'error');
      }
    }
  }
  async function speakAiConversation(text) {
    if (!S.ai.conversationSpeakReplies || !S.ai.conversationOpen) return;
    await playAiAudio(text);
  }
  function dictateAiConversation() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (S.ai.conversationRecognition) {
      try { S.ai.conversationRecognition.stop(); } catch (_) {}
      return;
    }
    if (!Speech || S.ai.conversationBusy) return;
    const language = $('#fqAiConversationLanguage');
    const button = $('[data-fq-ai-conversation-mic]');
    const input = $('#fqAiConversationInput');
    if (input) input.blur();
    const recognition = new Speech();
    let transcript = '';
    recognition.lang = language ? language.value : 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      if (!S.ai.conversationOpen) {
        try { recognition.stop(); } catch (_) {}
        return;
      }
      S.ai.conversationRecognition = recognition;
      renderAiConversation();
    };
    recognition.onresult = (event) => {
      transcript = Array.from(event.results || []).map((result) => result[0] && result[0].transcript || '').join(' ').trim();
    };
    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') toast('Não consegui captar a fala. Tente novamente ou digite a mensagem.', 'error');
    };
    recognition.onend = () => {
      if (S.ai.conversationRecognition === recognition) S.ai.conversationRecognition = null;
      if (!S.ai.conversationOpen) return;
      if (transcript) sendAiConversation(transcript, true);
      else renderAiConversation();
    };
    try { recognition.start(); } catch (_) { toast('O microfone não iniciou. Digite a mensagem para continuar.', 'error'); }
  }
  function sheetAiMeasure() {
    S.ai.measureProposal = null;
    const hasSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    openSheet(
      `${bar('Ditar medidas', '<button type="button" class="fq-link fq-link--b" data-fq-ai-measure-generate>Interpretar</button>')}
      <div class="fq-sbody">
        <p class="fq-hint fq-ai-lead">Descreva os cômodos, as medidas e os serviços. A IA prepara os campos; você confere antes de adicionar.</p>
        <label class="fq-field fq-field--col fq-group"><span>Descrição falada ou digitada</span><textarea id="fqAiMeasureText" rows="5" maxlength="2000" placeholder="Ex.: Sala 18 pés e 6 por 14, closet de 4 por 2. Instala LVP nos dois cômodos."></textarea></label>
        <div class="fq-ai-controls"><label class="fq-ai-language"><span>Idioma da fala</span><select id="fqAiMeasureLanguage"><option value="pt-BR">Português</option><option value="en-US">English</option></select></label><button type="button" class="fq-btn fq-btn--ghost" data-fq-ai-dictate ${hasSpeech ? '' : 'disabled'} aria-label="Ditar descrição de medidas">Ditar</button></div>
        ${hasSpeech ? '' : '<p class="fq-hint">Ditado não disponível neste navegador. Digite as medidas para continuar.</p>'}
        <p class="fq-hint">Exemplo: “Quarto 12 por 10 pés, carpete antigo para remover e instalar LVP.” O cálculo da área e dos valores continua sendo feito pelo sistema.</p>
        <div id="fqAiMeasureResult"></div>
      </div>`,
      'fq-sheet__card--tall'
    );
  }
  function renderAiMeasureResult() {
    const proposal = S.ai.measureProposal;
    const root = $('#fqAiMeasureResult');
    if (!root || !proposal) return;
    const rooms = proposal.rooms || [];
    const extras = proposal.extras || [];
    root.innerHTML = `<div class="fq-ai-proposal"><h3>Confira antes de adicionar</h3>${rooms.map((r) => `<article class="fq-ai-proposal__row"><b>${esc(r.label)}</b><span>${esc(r.mode === 'area' ? `${fmtN(r.sqft)} pé²` : `${fmtDim(r.l_ft, r.l_in)} × ${fmtDim(r.w_ft, r.w_in)}`)}</span>${r.parts && r.parts.length ? `<small>${r.parts.map((p) => `${p.sign < 0 ? '−' : '+'} ${esc(p.label || 'área')} ${fmtN(p.l)} × ${fmtN(p.w)} pés`).join(' · ')}</small>` : ''}<small>Área calculada: ${fmtN(roomArea(r))} pé² · ${(r.services || []).map((id) => esc((svcDef(id) || {}).pt || id)).join(', ')}</small></article>`).join('')}${extras.length ? `<div class="fq-ai-suggestions"><b>Extras identificados</b>${extras.map((x) => { const extra = C.EXTRAS.find((e) => e.id === x.id); return `<p>${esc(extra ? extra.pt : x.id)} · ${fmtN(x.qty)} ${esc(C.UNIT_PT[extra && extra.unit] || '')}</p>`; }).join('')}</div>` : ''}${proposal.clarification ? `<p class="fq-ai-question">${esc(proposal.clarification)} Edite a descrição e interprete novamente.</p>` : ''}<button type="button" class="fq-btn fq-btn--block fq-btn--pri" data-fq-ai-apply ${proposal.clarification || (!rooms.length && !extras.length) ? 'disabled' : ''}>Adicionar ao Field Quote</button></div>`;
  }
  function dictateMeasure() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) return;
    const rec = new Speech();
    const button = $('[data-fq-ai-dictate]');
    const input = $('#fqAiMeasureText');
    const lang = $('#fqAiMeasureLanguage');
    rec.lang = lang ? lang.value : 'pt-BR';
    rec.continuous = false;
    rec.interimResults = false;
    if (button) { button.disabled = true; button.textContent = 'Ouvindo…'; }
    rec.onresult = (event) => {
      const transcript = Array.from(event.results || []).map((r) => r[0] && r[0].transcript || '').join(' ').trim();
      if (input && transcript) input.value = `${input.value.trim()}${input.value.trim() ? ' ' : ''}${transcript}`;
    };
    rec.onerror = () => toast('Não foi possível captar a fala. Digite as medidas para continuar.', 'error');
    rec.onend = () => { if (button) { button.disabled = false; button.textContent = 'Ditar'; } };
    try { rec.start(); } catch (_) { if (button) { button.disabled = false; button.textContent = 'Ditar'; } }
  }
  async function runAiMeasure() {
    const text = ($('#fqAiMeasureText') || {}).value || '';
    if (text.trim().length < 3) return toast('Descreva as medidas primeiro.', 'error');
    const button = $('[data-fq-ai-measure-generate]');
    if (button) { button.disabled = true; button.textContent = 'Interpretando…'; }
    try {
      const result = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/ai/measure`, { method: 'POST', body: { text, services: S.d.services } });
      S.ai.measureProposal = result.data;
      renderAiMeasureResult();
    } catch (e) { toast(e.message, 'error'); }
    finally { if (button) { button.disabled = false; button.textContent = 'Interpretar'; } }
  }
  function applyAiMeasure() {
    const proposal = S.ai.measureProposal;
    if (!proposal || proposal.clarification) return;
    S.d.rooms.push(...(proposal.rooms || []));
    (proposal.extras || []).forEach((item) => {
      const def = C.EXTRAS.find((e) => e.id === item.id);
      if (!def) return;
      const st = S.d.extras[item.id] = Object.assign({}, S.d.extras[item.id] || {}, { on: true });
      if (item.qty > 0) Object.assign(st, { qty: item.qty, auto: false });
      else if (def.qty !== 'manual') Object.assign(st, { qty: null, auto: true });
      else if (def.unit === 'fixed') Object.assign(st, { qty: 1, auto: false });
      else Object.assign(st, { qty: 0, auto: false });
    });
    markDirty();
    S.ai.measureProposal = null;
    closeSheet();
    toast('Medidas adicionadas. Confira as áreas calculadas.', 'success');
  }
  function renderAiPhotoSheet() {
    const photos = S.d.photos || [];
    const selected = S.ai.selectedPhotoIds || [];
    const proposal = S.ai.photoProposal;
    openSheet(
      `${bar('Analisar fotos', proposal ? '<button type="button" class="fq-link fq-link--b" data-fq-ai-photo-save>Salvar planta</button>' : '<button type="button" class="fq-link fq-link--b" data-fq-ai-photo-run>Analisar</button>')}
      <div class="fq-sbody"><p class="fq-hint fq-ai-lead">Selecione as fotos da visita. A IA sugere materiais, condições visíveis e um esboço das áreas reconhecidas.</p>
        <div class="fq-ai-photo-grid">${photos.slice(-8).map((p) => `<label class="fq-ai-photo ${selected.includes(p.id) ? 'is-selected' : ''}"><input type="checkbox" data-fq-ai-photo-check="${esc(p.id)}" ${selected.includes(p.id) ? 'checked' : ''}/><img src="${esc(p.url)}" alt="Foto da visita" loading="lazy"/><span>${esc((S.d.rooms.find((r) => r.id === p.room_id) || {}).label || 'Foto da visita')}</span></label>`).join('')}</div>
        ${proposal ? `<section class="fq-ai-findings">${proposal.observations.length ? proposal.observations.map((item) => `<article class="fq-ai-finding"><b>${esc(item.title)} <small>${Math.round(item.confidence * 100)}% confiança visual</small></b><p>${esc(item.detail)}</p></article>`).join('') : '<p class="fq-ai-empty">Nenhuma observação visual encontrada.</p>'}</section>${proposal.floorplan_rooms.length ? `<section class="fq-plan-preview"><h3>Planta preliminar</h3>${renderFloorplanSvg({ rooms: proposal.floorplan_rooms })}<p>${esc(proposal.floorplan_note)}</p><small>Este desenho não tem escala e não preenche as medidas do orçamento.</small></section>` : ''}${proposal.suggested_extras.length ? `<section class="fq-ai-suggestions"><b>Extras para conferir</b>${proposal.suggested_extras.map((item) => { const extra = C.EXTRAS.find((x) => x.id === item.id); return `<p><strong>${esc(extra ? extra.pt : item.id)}:</strong> ${esc(item.reason)}</p>`; }).join('')}<button type="button" class="fq-mini" data-fq-open-extras>Revisar extras</button></section>` : ''}<button type="button" class="fq-btn fq-btn--block fq-btn--pri" data-fq-ai-photo-save>Salvar planta e observações</button>` : `<button type="button" class="fq-btn fq-btn--block fq-btn--pri" data-fq-ai-photo-run ${selected.length ? '' : 'disabled'}>Analisar fotos</button>`}
        <p class="fq-hint">O esboço é aproximado. Confira as áreas no local e registre as medidas manualmente ou por ditado antes de gerar o orçamento.</p>
      </div>`,
      'fq-sheet__card--tall'
    );
  }
  function sheetAiPhotos() {
    S.ai.photoProposal = null;
    S.ai.selectedPhotoIds = (S.d.photos || []).slice(-8).map((p) => p.id);
    renderAiPhotoSheet();
  }
  async function runAiPhotoAnalysis() {
    const button = $('[data-fq-ai-photo-run]');
    if (button) { button.disabled = true; button.textContent = 'Analisando…'; }
    try {
      const result = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/ai/photos`, { method: 'POST', body: { photo_ids: S.ai.selectedPhotoIds } });
      S.ai.photoProposal = result.data;
      renderAiPhotoSheet();
    } catch (e) { toast(e.message, 'error'); if (button) { button.disabled = false; button.textContent = 'Analisar fotos'; } }
  }
  function saveAiPhotoAnalysis() {
    const proposal = S.ai.photoProposal;
    if (!proposal) return;
    S.d.floorplan = {
      version: 1,
      is_approximate: true,
      scale_confirmed: false,
      note: proposal.floorplan_note,
      created_at: proposal.generated_at,
      rooms: (proposal.floorplan_rooms || []).map((r) => ({ id: uid(), label: r.label, x: r.x, y: r.y, w: r.w, h: r.h, confidence: r.confidence, measured_room_id: null })),
    };
    S.d.photo_analysis = { observations: proposal.observations || [], suggested_extras: proposal.suggested_extras || [], photo_ids: proposal.photo_ids || [], generated_at: proposal.generated_at };
    markDirty();
    closeSheet();
    toast('Planta preliminar salva. Confirme cada cômodo e registre as medidas.', 'success');
  }
  async function runAiReview() {
    const button = $('[data-fq-ai-review]');
    if (button) { button.disabled = true; button.textContent = 'Revisando…'; }
    try {
      await save();
      if (S.dirty) throw new Error('Aguarde o Field Quote salvar para revisar os dados atuais.');
      const lines = totals(S.d).lines.map((line) => ({ name: line.name, quantity: line.quantity, unit: line.unit, price_source: line.source }));
      const result = await api(`/api/field-quotes/${encodeURIComponent(S.fq.id)}/ai/review`, { method: 'POST', body: { lines } });
      S.ai.review = result.data;
      sheetReview();
    } catch (e) { toast(e.message, 'error'); }
    finally { const current = $('[data-fq-ai-review]'); if (current) { current.disabled = false; current.textContent = 'Revisar proposta com IA'; } }
  }
  async function presentExistingQuote(button) {
    if (!S.fq || !S.fq.quote_id) return;
    await openTour(button);
  }
  function sheetRoomFromPlan(planRoomId) {
    const planRoom = S.d.floorplan && S.d.floorplan.rooms && S.d.floorplan.rooms.find((r) => r.id === planRoomId);
    if (!planRoom) return;
    const label = String(planRoom.label || 'Novo cômodo');
    const room = { id: uid(), base: '__custom', label, en: label, mode: 'dims', l_ft: '', l_in: '', w_ft: '', w_in: '', sqft: '', parts: [], services: S.d.services.slice(), note: '' };
    S.sheet = { kind: 'room', room, isNew: true, planRoomId };
    renderRoomSheet();
  }
  function renderPresentation() {
    const p = S.ai.presentation;
    if (!p) return;
    const canSpeak = S.ai.speechVoices.length > 0;
    const voiceOptions = S.ai.speechVoices.map((voice) => {
      const details = [voice.labels && voice.labels.accent, voice.labels && voice.labels.gender].filter(Boolean).join(' · ');
      return `<option value="${esc(voice.voiceId)}" ${voice.voiceId === S.ai.speechVoiceId ? 'selected' : ''}>${esc(voice.name)}${details ? ` · ${esc(details)}` : ''}</option>`;
    }).join('');
    const totalSlides = (p.items || []).length + 2;
    const index = Math.max(0, Math.min(totalSlides - 1, Number(S.ai.presentationSlide) || 0));
    S.ai.presentationSlide = index;
    const isOpening = index === 0;
    const isClosing = index === totalSlides - 1;
    const item = !isOpening && !isClosing ? p.items[index - 1] : null;
    const countText = item ? `${index} de ${totalSlides - 2} itens` : isOpening ? 'Apresentação da proposta' : 'Resumo';
    const slide = isOpening
      ? `<div class="fq-present__copy"><p>${esc(p.opening)}</p><div class="fq-present__total"><small>Total da proposta</small><b>${esc(money(p.total))}</b></div></div>`
      : isClosing
        ? `<div class="fq-present__copy"><p>${esc(p.closing)}</p><div class="fq-present__total"><small>Total da proposta</small><b>${esc(money(p.total))}</b></div></div>`
        : `<article class="fq-present__service"><p class="fq-present__eyebrow">${esc(item.item_type === 'product' ? 'Material' : 'Serviço')} ${index}</p><h2>${esc(item.title)}</h2><p class="fq-present__qty">${esc(fmtN(item.quantity))} ${esc(String(item.unit || '').replace(/_/g, ' '))}<span>${esc(money(item.amount))}</span></p><div class="fq-present__explanation">${esc(item.explanation)}</div>${item.next_step ? `<p class="fq-present__next">${esc(item.next_step)}</p>` : ''}</article>`;
    openSheet(
      `<header class="fq-present__header"><button type="button" class="fq-present__text-btn" data-fq-close>Encerrar</button><div><span>PROPOSTA ${esc(p.quote_number || '')}</span><b>Apresentação ao cliente</b></div><button type="button" class="fq-present__text-btn" data-fq-present-fullscreen>Expandir tela</button></header>
      <main class="fq-present__main" aria-live="polite"><p class="fq-present__eyebrow">${esc(countText)}</p>${slide}</main>
      <footer class="fq-present__footer"><div class="fq-present__audio"><button type="button" class="fq-btn fq-btn--ghost" data-fq-present-speak ${canSpeak ? '' : 'disabled'}>Ouvir apresentação</button><button type="button" class="fq-btn fq-btn--ghost" data-fq-present-stop>Parar áudio</button></div><label class="fq-present__voice"><span>Voz da IA</span><select id="fqAiVoiceSelect" aria-label="Escolher voz da ElevenLabs" ${canSpeak ? '' : 'disabled'}>${voiceOptions || `<option value="">${S.ai.speechVoicesLoading ? 'Carregando vozes…' : 'Vozes indisponíveis'}</option>`}</select></label><div class="fq-present__nav"><button type="button" class="fq-btn" data-fq-present-prev ${index <= 0 ? 'disabled' : ''}>Voltar</button><span>${index + 1} / ${totalSlides}</span><button type="button" class="fq-btn fq-btn--pri" data-fq-present-next ${index >= totalSlides - 1 ? 'disabled' : ''}>Próximo</button></div><p class="fq-present__hint">${p.source === 'ai' ? 'Roteiro preparado pela IA a partir dos itens do orçamento.' : 'Roteiro resumido dos itens do orçamento.'} Os nomes, quantidades e valores vêm do quote. ${canSpeak ? '' : esc(S.ai.speechVoicesError || (S.ai.speechVoicesLoading ? 'Buscando vozes ElevenLabs…' : 'Configure ELEVENLABS_API_KEY no servidor para habilitar a narração.'))}</p></footer>`,
      'fq-sheet__card--present'
    );
  }
  async function speakPresentation() {
    const p = S.ai.presentation;
    if (!p) return;
    const text = [p.opening, ...(p.items || []).flatMap((item) => [item.title, `${fmtN(item.quantity)} ${String(item.unit || '').replace(/_/g, ' ')}`, item.explanation, item.next_step]), `The proposal total is ${money(p.total)}.`, p.closing].filter(Boolean).join('. ');
    await playAiAudio(text);
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
    const label = btn.innerHTML;
    btn.textContent = 'Gerando…';
    try {
      S.dirty = true;
      await save();
      if (S.dirty) throw new Error('Aguarde o salvamento do Field Quote antes de gerar o orçamento.');
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
      if (mode === 'present') {
        btn.disabled = false;
        btn.innerHTML = label;
        await openTour(btn);
        renderPanel();
        return;
      }
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
      btn.innerHTML = label;
      await reloadFq();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = label;
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
    else if (S.sheet && S.sheet.kind === 'review') { renderPanel(); sheetReview(); }
    else renderPanel();
  }

  // ------------------------------------------------------------------ events
  function wire() {
    document.addEventListener('click', async (ev) => {
      const t = ev.target;
      let el;
      if ((el = t.closest('[data-fq-close]'))) return closeSheet();
      if (t.closest('[data-fq-ai-measure]')) return sheetAiMeasure();
      if (t.closest('[data-fq-ai-dictate]')) return dictateMeasure();
      if (t.closest('[data-fq-ai-measure-generate]')) return runAiMeasure();
      if (t.closest('[data-fq-ai-apply]')) return applyAiMeasure();
      if (t.closest('[data-fq-ai-photos]')) return sheetAiPhotos();
      if (t.closest('[data-fq-ai-photo-run]')) return runAiPhotoAnalysis();
      if (t.closest('[data-fq-ai-photo-save]')) return saveAiPhotoAnalysis();
      if (t.closest('[data-fq-ai-review]')) return runAiReview();
      if ((el = t.closest('[data-fq-present-existing]'))) return presentExistingQuote(el);
      if (t.closest('[data-fq-ai-assist]')) return sheetAiAssist();
      if (t.closest('[data-fq-ai-assist-run]')) return runAiAssist();
      if ((el = t.closest('[data-fq-ai-conversation]'))) return sheetAiConversation(el.dataset.fqAiConversation === 'listen');
      if (t.closest('[data-fq-pending-yes]')) return confirmPending(true);
      if (t.closest('[data-fq-pending-no]')) return confirmPending(false);
      if (t.closest('[data-fq-ai-conversation-send]')) return sendAiConversation();
      if (t.closest('[data-fq-ai-conversation-mic]')) return dictateAiConversation();
      if (t.closest('[data-fq-ai-conversation-speak-toggle]')) {
        S.ai.conversationSpeakReplies = !S.ai.conversationSpeakReplies;
        if (!S.ai.conversationSpeakReplies) stopAiAudio();
        return renderAiConversation();
      }
      if ((el = t.closest('[data-fq-ai-assist-fill]'))) {
        S.ai.assistQuestion = el.dataset.fqAiAssistFill || '';
        const input = $('#fqAiAssistQuestion');
        if (input) { input.value = S.ai.assistQuestion; input.focus(); }
        return;
      }
      if (t.closest('[data-fq-open-extras]')) return sheetExtras();
      if ((el = t.closest('[data-fq-plan-measure]'))) return sheetRoomFromPlan(el.dataset.fqPlanMeasure);
      if (t.closest('[data-fq-present-speak]')) return speakPresentation();
      if (t.closest('[data-fq-present-stop]')) { stopAiAudio(); return; }
      if (t.closest('[data-fq-present-prev]')) { stopAiAudio(); S.ai.presentationSlide = Math.max(0, S.ai.presentationSlide - 1); return renderPresentation(); }
      if (t.closest('[data-fq-present-next]')) { stopAiAudio(); S.ai.presentationSlide += 1; return renderPresentation(); }
      if (t.closest('[data-fq-present-fullscreen]')) {
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Não foi possível abrir em tela cheia.', 'error'));
        else toast('Tela cheia não disponível neste navegador.', 'info');
        return;
      }
      if (t.closest('[data-fq-new]')) return newVisit();
      if ((el = t.closest('[data-fq-tip-yes]'))) {
        const tip = mateTips().find((x) => x.id === el.dataset.fqTipYes);
        if (tip && tip.apply) {
          tip.apply(S.d);
          markDirty();
          toast('Incluído no orçamento.', 'success');
        }
        return S.sheet && S.sheet.kind === 'review' ? sheetReview() : renderPanel();
      }
      if ((el = t.closest('[data-fq-tip-no]'))) {
        S.d.mate_dismissed = [...new Set([...(S.d.mate_dismissed || []), el.dataset.fqTipNo])];
        markDirty();
        return S.sheet && S.sheet.kind === 'review' ? sheetReview() : renderPanel();
      }
      if ((el = t.closest('[data-fq-review-view]'))) {
        S.reviewView = el.dataset.fqReviewView;
        const body = $('.fq-sheet .fq-sbody');
        const top = body ? body.scrollTop : 0;
        sheetReview();
        const nb = $('.fq-sheet .fq-sbody');
        if (nb) nb.scrollTop = top;
        return;
      }
      if ((el = t.closest('[data-fq-room-go]'))) {
        const dir = Number(el.dataset.fqRoomGo);
        const cur = S.sheet && S.sheet.room;
        if (!cur) return;
        if (roomArea(cur) > 0 && cur.services.length) {
          const k = S.d.rooms.findIndex((x) => x.id === cur.id);
          if (k >= 0) S.d.rooms[k] = cur;
          else S.d.rooms.push(cur);
          markDirty();
        }
        const ids = S.d.rooms.map((x) => x.id);
        const at = ids.indexOf(cur.id);
        const next = ids[at + dir];
        return next ? sheetRoom(next) : sheetRoom(null);
      }
      if (t.closest('[data-fq-room-next]')) return saveRoom(true);
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
      if (t.id === 'fqAiVoiceSelect') {
        S.ai.speechVoiceId = t.value || '';
        try { localStorage.setItem('fq_ai_eleven_voice', S.ai.speechVoiceId); } catch (_) {}
        stopAiAudio();
        return;
      }
      if (t.matches('[data-fq-ai-photo-check]')) {
        const id = t.dataset.fqAiPhotoCheck;
        S.ai.selectedPhotoIds = t.checked ? [...new Set([...(S.ai.selectedPhotoIds || []), id])] : (S.ai.selectedPhotoIds || []).filter((x) => x !== id);
        S.ai.photoProposal = null;
        return renderAiPhotoSheet();
      }
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
      if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'fqAiConversationInput') {
        e.preventDefault();
        sendAiConversation();
      }
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
    const presentationQuoteId = p.get('presentation_quote');
    if (presentationQuoteId) {
      S.presentationQuoteOnly = true;
      S.presentationQuoteId = presentationQuoteId;
      try {
        const result = await api(`/api/quotes/${encodeURIComponent(presentationQuoteId)}/ai/presentation`, { method: 'POST', body: {} });
        S.ai.presentation = result.data;
        S.ai.presentationSlide = 0;
        $('#fqLoading').hidden = true;
        renderPresentation();
        void loadElevenLabsVoices();
      } catch (e) {
        const loading = $('#fqLoading');
        loading.textContent = `${e.message} `;
        const back = document.createElement('a');
        back.href = `quote-builder.html?id=${encodeURIComponent(presentationQuoteId)}`;
        back.textContent = 'Voltar ao orçamento';
        loading.append(back);
      }
      return;
    }
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
