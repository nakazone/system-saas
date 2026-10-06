/**
 * Página do lead (layout "Abas", igual ao Job): cabeçalho com ações, funil clicável,
 * abas Visão geral / Atividade / Orçamentos e visitas / Qualificação e coluna lateral
 * com o próximo passo. Substitui o popup (lead-quick-sheet) e a página antiga.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (v) =>
    String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const money = (n) => {
    const x = Number(n);
    if (n == null || n === '' || !Number.isFinite(x)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: x % 1 ? 2 : 0 }).format(x);
  };
  const rich = (v) => (typeof window.sfFormatRichTextHtml === 'function' ? window.sfFormatRichTextHtml(v) : esc(v));
  const toast = (msg, type) => {
    if (window.crmToast && window.crmToast.show) window.crmToast.show(msg, { type: type || 'info' });
  };
  const fmtDate = (iso, withTime) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const opts = { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined };
    let s = d.toLocaleDateString('pt-BR', opts).replace('.', '');
    if (withTime) s += ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return s;
  };
  const fmtWeekday = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return wd.charAt(0).toUpperCase() + wd.slice(1) + ', ' + fmtDate(iso, true);
  };
  const relTime = (iso) => {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    const fut = diff < 0;
    const m = Math.round(Math.abs(diff) / 60000);
    let s;
    if (m < 1) return 'agora';
    if (m < 60) s = m + ' min';
    else if (m < 60 * 24) s = Math.round(m / 60) + ' h';
    else if (m < 60 * 24 * 2) return fut ? 'amanhã' : 'ontem';
    else if (m < 60 * 24 * 30) s = Math.round(m / 1440) + ' dias';
    else return fmtDate(iso);
    return fut ? 'em ' + s : 'há ' + s;
  };
  const toLocalInput = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return { date: '', time: '' };
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
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
      const err = new Error(j.message || j.error || 'Não foi possível salvar.');
      err.status = r.status;
      throw err;
    }
    return j;
  }

  // ------------------------------------------------------------------ labels
  const STAGES = [
    { slug: 'new_lead', label: 'Novo lead' },
    { slug: 'contacted', label: 'Contactado' },
    { slug: 'meeting_scheduled', label: 'Visita agendada' },
    { slug: 'quote_sent', label: 'Orçamento enviado' },
    { slug: 'follow_up_1', label: 'Follow-up' },
    { slug: 'stand_by', label: 'Stand-by' },
    { slug: 'won', label: 'Ganho' },
  ];
  const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.slug, s.label]));
  STAGE_LABEL.lost = 'Perdido';
  const canonSlug = (slug) =>
    typeof window.normalizePipelineSlug === 'function' ? window.normalizePipelineSlug(slug) : String(slug || '');
  const stageLabel = (slug) => STAGE_LABEL[canonSlug(slug)] || slug || '—';

  const QUOTE_STATUS = {
    draft: 'Rascunho',
    sent: 'Enviado',
    viewed: 'Visualizado',
    changes_requested: 'Alteração pedida',
    approved: 'Aprovado',
    accepted: 'Aprovado',
    converted: 'Convertido em job',
    archived: 'Arquivado',
    rejected: 'Recusado',
    expired: 'Expirado',
  };
  const VISIT_STATUS = { scheduled: 'Agendada', completed: 'Realizada', cancelled: 'Cancelada', no_show: 'Não compareceu' };
  const PRIORITY = { low: 'Baixa', medium: 'Média', high: 'Alta' };
  const PROPERTY = { house: 'Casa', apartment: 'Apartamento', commercial: 'Comercial', other: 'Outro' };
  const SERVICE = { installation: 'Instalação', sanding: 'Lixa e acabamento', repair: 'Reparo', renovation: 'Reforma', other: 'Outro' };
  const URGENCY = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' };
  const PAYMENT = { cash: 'À vista', financing: 'Financiamento', insurance: 'Seguro', other: 'Outro' };
  const LOSS_PT = {
    price: 'Preço', Price: 'Preço',
    timeline: 'Prazo', Timeline: 'Prazo',
    chose_competitor: 'Escolheu outra empresa', 'Chose competitor': 'Escolheu outra empresa',
    no_response: 'Sem resposta', 'No response': 'Sem resposta',
    project_postponed: 'Projeto adiado', 'Project postponed': 'Projeto adiado',
    other: 'Outro', Other: 'Outro',
  };
  const lossName = (r) => (r ? LOSS_PT[r.slug] || LOSS_PT[r.name] || r.name : '');
  const CALL_RESULTS = ['Atendeu', 'Não atendeu', 'Caixa postal', 'Número errado'];
  const UTM_LABELS = {
    form_type: 'Formulário',
    utm_source: 'UTM source',
    utm_medium: 'UTM medium',
    utm_campaign: 'Campanha',
    utm_adset: 'Conjunto',
    utm_ad: 'Anúncio',
    utm_term: 'Termo',
    utm_content: 'Conteúdo',
    marketing_platform: 'Plataforma',
    landing_page: 'Página de entrada',
    referrer_url: 'Referência',
    gclid: 'gclid',
    fbclid: 'fbclid',
  };

  // ------------------------------------------------------------------ state
  const S = {
    id: '',
    lead: null,
    stages: [],
    quotes: [],
    visits: [],
    interactions: [],
    followups: [],
    qual: null,
    users: [],
    lossReasons: [],
    tab: 'geral',
    editing: null, // 'contact' | 'project' | null
    composer: 'note',
  };

  // ------------------------------------------------------------------ load
  async function boot() {
    const params = new URLSearchParams(location.search);
    S.id = String(params.get('id') || '').trim();
    const tab = params.get('tab');
    if (tab && ['geral', 'atividade', 'orcamentos', 'qualificacao'].includes(tab)) S.tab = tab;
    if (params.get('tab') === 'communication') S.tab = 'atividade';
    if (!S.id || S.id === 'null' || S.id === 'undefined') {
      showError('Lead não informado. <a href="leads.html">Voltar ao funil</a>');
      return;
    }
    $('#logoutBtn') &&
      $('#logoutBtn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        location.href = '/login.html';
      });
    try {
      const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
      if (!sess || !sess.authenticated) {
        location.href = '/login.html';
        return;
      }
      const un = $('#sidebarUserName');
      if (un && sess.user) un.textContent = sess.user.name || sess.user.email;
    } catch (_) {
      location.href = '/login.html';
      return;
    }
    wire();
    await loadAll();
    if (params.get('schedule') === '1' || params.get('visit') === '1') openVisitModal();
    if (typeof window.sfLoadLeadMessageSettings === 'function') window.sfLoadLeadMessageSettings().catch(() => {});
  }

  async function loadAll() {
    try {
      const [lead, stages, quotes, visits, inter, fu, qual] = await Promise.all([
        api('/api/leads/' + encodeURIComponent(S.id)),
        api('/api/pipeline-stages').catch(() => ({ data: [] })),
        api('/api/quotes?lead_id=' + encodeURIComponent(S.id) + '&limit=50').catch(() => ({ data: [] })),
        api('/api/visits?lead_id=' + encodeURIComponent(S.id)).catch(() => ({ data: [] })),
        api('/api/leads/' + encodeURIComponent(S.id) + '/interactions').catch(() => ({ data: [] })),
        api('/api/leads/' + encodeURIComponent(S.id) + '/followups').catch(() => ({ data: [] })),
        api('/api/leads/' + encodeURIComponent(S.id) + '/qualification').catch(() => ({ data: null })),
      ]);
      S.lead = lead.data;
      S.stages =
        typeof window.mergePipelineStagesForUi === 'function'
          ? window.mergePipelineStagesForUi(stages.data || [])
          : (stages.data || []).map((s) => ({ id: s.id, slug: s.slug }));
      S.quotes = Array.isArray(quotes.data) ? quotes.data : [];
      S.visits = Array.isArray(visits.data) ? visits.data : [];
      S.interactions = Array.isArray(inter.data) ? inter.data : [];
      S.followups = Array.isArray(fu.data) ? fu.data : [];
      S.qual = qual.data && typeof qual.data === 'object' ? qual.data : null;
    } catch (e) {
      showError(e.status === 404 ? 'Este lead não existe ou foi excluído. <a href="leads.html">Voltar ao funil</a>' : esc(e.message));
      return;
    }
    $('#lpLoading').hidden = true;
    $('#lpPage').hidden = false;
    $('#lpRoot').setAttribute('aria-busy', 'false');
    document.title = (S.lead.name || 'Lead') + ' | ObraMate';
    const mh = $('.mobile-app-header__title');
    if (mh) mh.textContent = 'Lead';
    renderAll();
  }

  async function reloadLead() {
    const j = await api('/api/leads/' + encodeURIComponent(S.id));
    S.lead = j.data;
  }
  async function reloadActivity() {
    const [inter, fu] = await Promise.all([
      api('/api/leads/' + encodeURIComponent(S.id) + '/interactions'),
      api('/api/leads/' + encodeURIComponent(S.id) + '/followups'),
    ]);
    S.interactions = inter.data || [];
    S.followups = fu.data || [];
  }
  async function reloadVisits() {
    const j = await api('/api/visits?lead_id=' + encodeURIComponent(S.id));
    S.visits = j.data || [];
  }
  async function ensureUsers() {
    if (S.users.length) return S.users;
    try {
      const j = await api('/api/users?limit=100');
      S.users = (j.data || []).filter((u) => u && u.id);
    } catch (_) {
      S.users = [];
    }
    return S.users;
  }
  async function ensureLossReasons() {
    if (S.lossReasons.length) return S.lossReasons;
    try {
      const j = await api('/api/loss-reasons');
      S.lossReasons = j.data || [];
    } catch (_) {
      S.lossReasons = [];
    }
    return S.lossReasons;
  }

  function showError(html) {
    $('#lpLoading').hidden = true;
    const el = $('#lpError');
    el.innerHTML = html;
    el.hidden = false;
  }

  // ------------------------------------------------------------------ derived
  const currentSlug = () => canonSlug((S.lead && (S.lead.pipeline_stage_slug || S.lead.status)) || 'new_lead');
  const isLost = () => currentSlug() === 'lost';
  const stageRow = (slug) => S.stages.find((s) => s.slug === slug) || { slug };
  const leadAddress = () => {
    const L = S.lead || {};
    const a = String(L.address || '').trim();
    const z = String(L.zipcode || '').trim();
    if (!a) return z && z !== '00000' ? z : '';
    if (!z || z === '00000' || a.includes(z)) return a;
    return a + ', ' + z;
  };
  const sortedVisits = () =>
    S.visits.slice().sort((a, b) => new Date(b.scheduled_at || 0).getTime() - new Date(a.scheduled_at || 0).getTime());
  const upcomingVisit = () =>
    S.visits
      .filter((v) => (v.status || 'scheduled') === 'scheduled' && v.scheduled_at && new Date(v.scheduled_at).getTime() > Date.now() - 2 * 3600e3)
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
  const pendingFollowups = () =>
    S.followups
      .filter((f) => (f.status || 'pending') !== 'done')
      .sort((a, b) => new Date(a.due_date || '2999-01-01').getTime() - new Date(b.due_date || '2999-01-01').getTime());
  const quoteLabel = (q) => (q.quote_number ? 'Q-' + String(q.quote_number).replace(/^Q-?/i, '') : 'Orçamento');
  const quoteTitle = (q) => {
    const t = String(q.title || '').trim();
    return t && t !== (S.lead && S.lead.name) ? t : q.flooring_type ? String(q.flooring_type).replace(/_/g, ' ') : '';
  };
  const quoteStatus = (q) => {
    const st = String(q.status || 'draft');
    if (st === 'sent' && q.viewed_at) return 'viewed';
    return st;
  };
  const latestQuote = () => S.quotes[0] || null;

  // ------------------------------------------------------------------ render
  function renderAll() {
    renderHead();
    renderFunnel();
    renderSide();
    renderTabs();
    renderPanel();
  }

  function renderHead() {
    const L = S.lead;
    $('#lpName').textContent = L.name || 'Sem nome';
    const pri = String(L.priority || 'medium');
    const slug = currentSlug();
    const bits = [];
    bits.push(`<span class="lp-pill lp-pill--stage" data-stage="${esc(slug)}">${esc(stageLabel(slug))}</span>`);
    if (pri === 'high') bits.push('<span class="lp-pill lp-pill--hot">Alta prioridade</span>');
    if (pri === 'low') bits.push('<span class="lp-pill lp-pill--low">Baixa prioridade</span>');
    const meta = [L.source || 'Sem origem', 'criado ' + relTime(L.created_at)];
    if (L.owner_name) meta.push('Dono: ' + L.owner_name);
    bits.push(`<span class="lp-meta__txt">${esc(meta.join(' · '))}</span>`);
    $('#lpMeta').innerHTML = bits.join('');

    const phone = L.phone ? String(L.phone) : '';
    const tel = phone && typeof window.sfBuildTelHref === 'function' ? window.sfBuildTelHref(phone) : phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : '';
    const q = latestQuote();
    const acts = [];
    acts.push(
      tel
        ? `<a class="lp-btn" href="${esc(tel)}" data-lp-call><span aria-hidden="true">📞</span> Ligar</a>`
        : '<button type="button" class="lp-btn" disabled title="Sem telefone">📞 Ligar</button>'
    );
    acts.push(`<button type="button" class="lp-btn" data-lp-sms ${phone ? '' : 'disabled title="Sem telefone"'}><span aria-hidden="true">💬</span> SMS</button>`);
    acts.push(`<button type="button" class="lp-btn lp-hide-sm" data-lp-email ${L.email ? '' : 'disabled title="Sem e-mail"'}><span aria-hidden="true">✉️</span> E-mail</button>`);
    acts.push('<button type="button" class="lp-btn lp-btn--ghost" data-lp-more aria-haspopup="menu" aria-label="Mais ações">⋯</button>');
    if (q && q.has_invoice_pdf) {
      acts.push(`<button type="button" class="lp-btn lp-hide-sm" data-lp-pdf="${esc(q.id)}" data-lp-pdf-label="${esc(quoteLabel(q))}">Ver PDF</button>`);
    }
    if (q && !['approved', 'converted', 'accepted'].includes(String(q.status))) {
      acts.push(`<a class="lp-btn lp-btn--pri" href="${esc(quoteHref(q))}">Editar orçamento</a>`);
    } else {
      acts.push(`<a class="lp-btn lp-btn--pri" href="${esc(newQuoteHref())}">Criar orçamento</a>`);
    }
    $('#lpActions').innerHTML = acts.join('');

    const lost = $('#lpLost');
    if (isLost()) {
      const why = [L.loss_reason_name ? LOSS_PT[L.loss_reason_name] || L.loss_reason_name : '', L.loss_note].filter(Boolean).join(' — ');
      lost.innerHTML = `<div><b>Lead perdido</b>${L.lost_at ? ' em ' + esc(fmtDate(L.lost_at)) : ''}${why ? '<span> · ' + esc(why) + '</span>' : ''}</div>
        <div class="lp-lost__acts"><button type="button" class="lp-btn lp-btn--sm" data-lp-lost-edit>Editar motivo</button><button type="button" class="lp-btn lp-btn--sm lp-btn--ink" data-lp-reopen>Reabrir lead</button></div>`;
      lost.hidden = false;
    } else {
      lost.hidden = true;
      lost.innerHTML = '';
    }
  }

  function renderFunnel() {
    const slug = currentSlug();
    const idx = STAGES.findIndex((s) => s.slug === slug);
    $('#lpFunnel').innerHTML = STAGES.map((s, i) => {
      const cls = isLost() ? '' : i < idx ? 'is-done' : i === idx ? 'is-now' : '';
      return `<button type="button" class="lp-step ${cls}" data-lp-stage="${s.slug}" aria-current="${i === idx ? 'step' : 'false'}" title="Mover para ${esc(s.label)}"><span>${esc(s.label)}</span></button>`;
    }).join('');
    const now = $('#lpFunnel .is-now');
    if (now && now.scrollIntoView && window.innerWidth < 760) now.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function nextStep() {
    const L = S.lead;
    const slug = currentSlug();
    const fu = pendingFollowups()[0];
    const visit = upcomingVisit();
    const q = latestQuote();
    if (isLost()) return { title: 'Lead perdido', sub: 'Se o cliente voltar, reabra para continuar no funil.', btn: { label: 'Reabrir lead', attr: 'data-lp-reopen' } };
    if (slug === 'won') {
      return q
        ? { title: 'Negócio fechado', sub: `${quoteLabel(q)} · ${money(q.total)}`, btn: { label: 'Ver orçamento', href: quoteHref(q) } }
        : { title: 'Negócio fechado', sub: 'Crie o orçamento para gerar o job e a fatura.', btn: { label: 'Criar orçamento', href: newQuoteHref() } };
    }
    if (fu && fu.due_date && new Date(fu.due_date).getTime() < Date.now()) {
      return { title: fu.title || 'Follow-up', sub: 'Atrasado · era para ' + fmtDate(fu.due_date, true), btn: { label: 'Marcar como feito', attr: `data-lp-fu-done="${esc(fu.id)}"` }, warn: true };
    }
    if (visit) {
      return {
        title: 'Visita ' + fmtWeekday(visit.scheduled_at),
        sub: [visit.address || leadAddress(), 'confirme com o cliente na véspera'].filter(Boolean).join(' · '),
        btn: L.phone ? { label: 'Confirmar por SMS', attr: 'data-lp-sms' } : { label: 'Editar visita', attr: `data-lp-visit-edit="${esc(visit.id)}"` },
      };
    }
    if (slug === 'new_lead') {
      return L.phone
        ? { title: 'Fazer o primeiro contato', sub: 'Ligue ou mande SMS e registre o resultado.', btn: { label: 'Ligar agora', href: 'tel:' + String(L.phone).replace(/[^\d+]/g, ''), attr: 'data-lp-call' } }
        : { title: 'Fazer o primeiro contato', sub: 'Este lead não tem telefone. Tente por e-mail.', btn: { label: 'Enviar e-mail', attr: 'data-lp-email' } };
    }
    if (slug === 'meeting_scheduled' && !visit && !q) {
      return { title: 'Agendar a visita técnica', sub: 'A etapa diz visita agendada, mas não há visita futura.', btn: { label: 'Agendar visita', attr: 'data-lp-visit-new' } };
    }
    if (!q) return { title: 'Montar o orçamento', sub: 'Com as medidas da visita, crie e envie o orçamento.', btn: { label: 'Criar orçamento', href: newQuoteHref() } };
    if (fu) return { title: fu.title || 'Follow-up', sub: fu.due_date ? 'Para ' + fmtDate(fu.due_date, true) : 'Sem data', btn: { label: 'Marcar como feito', attr: `data-lp-fu-done="${esc(fu.id)}"` } };
    const st = quoteStatus(q);
    if (st === 'draft') return { title: `Enviar o ${quoteLabel(q)}`, sub: `${money(q.total)} · ainda em rascunho`, btn: { label: 'Abrir orçamento', href: quoteHref(q) } };
    if (st === 'changes_requested') return { title: 'Cliente pediu alterações', sub: `${quoteLabel(q)} · ajuste e reenvie`, btn: { label: 'Abrir orçamento', href: quoteHref(q) } };
    if (['approved', 'accepted', 'converted'].includes(st)) return { title: 'Orçamento aprovado', sub: 'Mova o lead para Ganho.', btn: { label: 'Marcar como ganho', attr: 'data-lp-stage="won"' } };
    return {
      title: 'Acompanhar o ' + quoteLabel(q),
      sub: st === 'viewed' ? `Cliente abriu ${relTime(q.viewed_at)} · ${money(q.total)}` : `Enviado · ${money(q.total)} · ainda não aberto`,
      btn: { label: 'Agendar follow-up', attr: 'data-lp-fu-new' },
    };
  }

  function nextCardHtml() {
    const n = nextStep();
    const b = n.btn;
    const btn = b.href
      ? `<a class="lp-btn lp-btn--pri lp-btn--block" href="${esc(b.href)}" ${b.attr || ''}>${esc(b.label)}</a>`
      : `<button type="button" class="lp-btn lp-btn--pri lp-btn--block" ${b.attr || ''}>${esc(b.label)}</button>`;
    return `<div class="lp-card lp-next${n.warn ? ' lp-next--warn' : ''}"><h3 class="lp-h3">Próximo passo</h3><p class="lp-next__t">${esc(n.title)}</p><p class="lp-next__s">${esc(n.sub || '')}</p>${btn}</div>`;
  }

  function renderSide() {
    const L = S.lead;
    const pri = String(L.priority || 'medium');
    const quotes = S.quotes.slice(0, 4);
    const quotesHtml = quotes.length
      ? quotes
          .map(
            (q) => `<a class="lp-qrow" href="${esc(quoteHref(q))}"><div><b>${esc(quoteLabel(q))}</b><small>${esc(quoteTitle(q) || fmtDate(q.created_at))}</small></div>
          <div class="lp-r"><b class="lp-num">${esc(money(q.total))}</b><span class="lp-qs" data-qs="${esc(quoteStatus(q))}">${esc(QUOTE_STATUS[quoteStatus(q)] || quoteStatus(q))}</span></div></a>`
          )
          .join('') + (S.quotes.length > 4 ? `<button type="button" class="lp-link" data-lp-tab-go="orcamentos">Ver todos (${S.quotes.length})</button>` : '')
      : '<p class="lp-empty">Nenhum orçamento ainda.</p>';
    const tags = (L.tags || []).map((t) => `<span class="lp-chip">${esc(t)}<button type="button" data-lp-tag-del="${esc(t)}" aria-label="Remover ${esc(t)}">×</button></span>`).join('');
    $('#lpSide').innerHTML = `
      <div class="lp-only-desk">${nextCardHtml()}</div>
      <div class="lp-card"><h3 class="lp-h3">Orçamentos <a class="lp-link" href="${esc(newQuoteHref())}">+ Novo</a></h3>${quotesHtml}</div>
      <div class="lp-card"><h3 class="lp-h3">Detalhes</h3>
        <dl class="lp-kv">
          <dt>Prioridade</dt><dd><div class="lp-seg" role="group" aria-label="Prioridade">${['low', 'medium', 'high']
            .map((p) => `<button type="button" class="${p === pri ? 'is-on' : ''}" data-lp-priority="${p}">${PRIORITY[p]}</button>`)
            .join('')}</div></dd>
          <dt>Dono</dt><dd><select class="lp-select" id="lpOwner" aria-label="Dono do lead"><option value="">${esc(L.owner_name || 'Ninguém')}</option></select></dd>
          <dt>Origem</dt><dd>${esc(L.source || '—')}</dd>
          <dt>Criado</dt><dd>${esc(fmtDate(L.created_at))}</dd>
          <dt>Último contato</dt><dd>${esc(L.last_contacted_at ? relTime(L.last_contacted_at) : '—')}</dd>
        </dl>
        <div class="lp-tags">${tags}<form class="lp-tag-add" data-lp-tag-form><input type="text" maxlength="40" placeholder="+ Tag" aria-label="Nova tag" /></form></div>
      </div>`;
    $('#lpNextMob').innerHTML = nextCardHtml();
    fillOwnerSelect();
  }

  async function fillOwnerSelect() {
    const sel = $('#lpOwner');
    if (!sel) return;
    const users = await ensureUsers();
    const cur = S.lead.owner_id || '';
    sel.innerHTML =
      '<option value="">Ninguém</option>' +
      users.map((u) => `<option value="${esc(u.id)}" ${String(u.id) === String(cur) ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('');
    if (cur && !users.some((u) => String(u.id) === String(cur))) {
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(S.lead.owner_name || 'Usuário')}</option>`);
    }
  }

  function renderTabs() {
    $$('#lpTabs .lp-tab').forEach((b) => {
      const on = b.getAttribute('data-lp-tab') === S.tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.lp-panel').forEach((p) => (p.hidden = p.getAttribute('data-lp-panel') !== S.tab));
    const nAtv = S.interactions.length + S.followups.length;
    $('#lpTabNAtv').textContent = nAtv ? String(nAtv) : '';
    const nOrc = S.quotes.length + S.visits.length;
    $('#lpTabNOrc').textContent = nOrc ? String(nOrc) : '';
  }

  function renderPanel() {
    if (S.tab === 'geral') renderGeral();
    else if (S.tab === 'atividade') renderAtividade();
    else if (S.tab === 'orcamentos') renderOrcamentos();
    else renderQualificacao();
  }

  // ---------- Visão geral
  function renderGeral() {
    const L = S.lead;
    const Q = S.qual || {};
    const contact =
      S.editing === 'contact'
        ? `<form class="lp-form" data-lp-form="contact">
          <label>Nome<input name="name" required value="${esc(L.name)}" /></label>
          <div class="lp-form__2"><label>Telefone<input name="phone" type="tel" value="${esc(typeof window.sfFormatPhone === 'function' ? window.sfFormatPhone(L.phone) || L.phone || '' : L.phone || '')}" /></label>
          <label>E-mail<input name="email" type="email" value="${esc(L.email || '')}" /></label></div>
          <label>Endereço<input name="address" data-lp-address autocomplete="off" value="${esc(L.address || '')}" /></label>
          <div class="lp-form__2"><label>CEP / ZIP<input name="zipcode" value="${esc(L.zipcode && L.zipcode !== '00000' ? L.zipcode : '')}" /></label>
          <label>Empresa<input name="company_name" value="${esc(L.company_name || '')}" /></label></div>
          <label>Origem<input name="source" value="${esc(L.source || '')}" /></label>
          <div class="lp-form__acts"><button type="button" class="lp-btn" data-lp-cancel>Cancelar</button><button type="submit" class="lp-btn lp-btn--ink">Salvar</button></div>
        </form>`
        : `<dl class="lp-kv">
          <dt>Telefone</dt><dd>${L.phone ? `<a href="tel:${esc(String(L.phone).replace(/[^\d+]/g, ''))}">${esc(typeof window.sfFormatPhone === 'function' ? window.sfFormatPhone(L.phone) || L.phone : L.phone)}</a>` : '<span class="lp-mut">—</span>'}</dd>
          <dt>E-mail</dt><dd>${L.email ? `<a href="mailto:${esc(L.email)}">${esc(L.email)}</a>` : '<span class="lp-mut">—</span>'}</dd>
          <dt>Endereço</dt><dd>${leadAddress() ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(leadAddress())}" target="_blank" rel="noopener">${esc(leadAddress())}</a>` : '<button type="button" class="lp-link" data-lp-edit="contact">Adicionar endereço</button>'}</dd>
          ${L.company_name ? `<dt>Empresa</dt><dd>${esc(L.company_name)}</dd>` : ''}
        </dl>`;
    const project =
      S.editing === 'project'
        ? `<form class="lp-form" data-lp-form="project">
          <div class="lp-form__2"><label>Serviço${selectHtml('service_type', SERVICE, Q.service_type)}</label>
          <label>Imóvel${selectHtml('property_type', PROPERTY, Q.property_type)}</label></div>
          <div class="lp-form__2"><label>Área estimada<input name="estimated_area" placeholder="ex.: 850 sqft" value="${esc(Q.estimated_area || '')}" /></label>
          <label>Valor estimado ($)<input name="estimated_value" inputmode="decimal" value="${esc(L.estimated_value != null ? L.estimated_value : '')}" /></label></div>
          <label>Prazo do cliente<input name="decision_timeline" placeholder="ex.: até novembro" value="${esc(Q.decision_timeline || '')}" /></label>
          <div class="lp-form__acts"><button type="button" class="lp-btn" data-lp-cancel>Cancelar</button><button type="submit" class="lp-btn lp-btn--ink">Salvar</button></div>
        </form>`
        : `<dl class="lp-kv">
          <dt>Serviço</dt><dd>${esc(SERVICE[Q.service_type] || Q.service_type || '—')}</dd>
          <dt>Imóvel</dt><dd>${esc(PROPERTY[Q.property_type] || Q.property_type || '—')}</dd>
          <dt>Área</dt><dd>${esc(Q.estimated_area || '—')}</dd>
          <dt>Valor est.</dt><dd>${esc(money(L.estimated_value))}</dd>
          <dt>Prazo</dt><dd>${esc(Q.decision_timeline || '—')}</dd>
        </dl>`;
    const recent = timelineItems().slice(0, 3);
    const utmKeys = Object.keys(UTM_LABELS).filter((k) => L[k]);
    $('#lpPanelGeral').innerHTML = `
      <div class="lp-2col">
        <div class="lp-card"><h3 class="lp-h3">Contato ${S.editing === 'contact' ? '' : '<button type="button" class="lp-link" data-lp-edit="contact">Editar</button>'}</h3>${contact}</div>
        <div class="lp-card"><h3 class="lp-h3">Projeto ${S.editing === 'project' ? '' : '<button type="button" class="lp-link" data-lp-edit="project">Editar</button>'}</h3>${project}</div>
      </div>
      ${L.message ? `<div class="lp-card"><h3 class="lp-h3">Mensagem do cliente</h3><p class="lp-quote">${esc(L.message)}</p></div>` : ''}
      <div class="lp-card"><h3 class="lp-h3">Notas internas <span class="lp-saved" id="lpNotesSaved" hidden>Salvo</span></h3>
        <textarea class="lp-textarea" id="lpNotes" rows="4" placeholder="Anote o que a equipe precisa saber sobre este lead…">${esc(L.notes || '')}</textarea>
        <div class="lp-form__acts lp-form__acts--end"><button type="button" class="lp-btn lp-btn--sm lp-btn--ink" data-lp-notes-save hidden>Salvar notas</button></div>
      </div>
      <div class="lp-card"><h3 class="lp-h3">Última atividade <button type="button" class="lp-link" data-lp-tab-go="atividade">Ver tudo</button></h3>
        ${recent.length ? `<ul class="lp-tl">${recent.map(tlItemHtml).join('')}</ul>` : '<p class="lp-empty">Nada registrado ainda.</p>'}
        <button type="button" class="lp-btn lp-btn--sm" data-lp-tab-go="atividade" data-lp-composer="note">+ Registrar nota ou ligação</button>
      </div>
      ${
        utmKeys.length
          ? `<details class="lp-card lp-details"><summary class="lp-h3">Origem e marketing</summary><dl class="lp-kv">${utmKeys
              .map((k) => `<dt>${esc(UTM_LABELS[k])}</dt><dd class="lp-break">${esc(L[k])}</dd>`)
              .join('')}</dl></details>`
          : ''
      }`;
    if (S.editing === 'contact') attachAddress($('[data-lp-address]'));
  }

  function selectHtml(name, map, val) {
    const v = val == null ? '' : String(val);
    const known = Object.prototype.hasOwnProperty.call(map, v);
    return `<select name="${name}"><option value="">—</option>${Object.keys(map)
      .map((k) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(map[k])}</option>`)
      .join('')}${v && !known ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : ''}</select>`;
  }

  async function attachAddress(input) {
    if (!input || typeof window.sfAttachAddressAutocomplete !== 'function') return;
    try {
      await window.sfAttachAddressAutocomplete(input, {
        map: { combined: input },
        onSelect(parsed) {
          if (!parsed) return;
          const line = String(parsed.line1 || '').trim();
          const fmt = String(parsed.formatted || '').trim();
          input.value = /^\d/.test(fmt) ? fmt : line || fmt;
          const zip = parsed.zip || parsed.postal_code || parsed.zipcode;
          const form = input.closest('form');
          const zipIn = form && form.querySelector('[name="zipcode"]');
          if (zip && zipIn) zipIn.value = zip;
        },
      });
    } catch (_) {}
  }

  // ---------- Atividade / timeline
  function timelineItems() {
    const out = [];
    const L = S.lead;
    S.interactions.forEach((i) => {
      const type = String(i.type || 'note');
      if (type === 'stage') {
        out.push({
          at: i.created_at,
          icon: '↗',
          title: i.to_stage === 'lost' || i.to_stage === 'closed_lost' ? 'Marcado como perdido' : 'Etapa: ' + stageLabel(i.to_stage),
          body: [i.from_stage ? 'antes: ' + stageLabel(i.from_stage) : '', i.notes || ''].filter(Boolean).join(' · '),
          who: i.user_name,
        });
        return;
      }
      const map = { call: ['📞', 'Ligação'], sms: ['💬', 'SMS'], email: ['✉️', 'E-mail'], whatsapp: ['💬', 'WhatsApp'], visit: ['📅', 'Visita'], meeting: ['📅', 'Reunião'], note: ['📝', 'Nota'] };
      const m = map[type] || ['📝', type];
      out.push({ at: i.created_at, icon: m[0], title: m[1] + (i.subject ? ' — ' + i.subject : ''), body: i.notes || '', who: i.user_name, del: { kind: 'interactions', id: i.id } });
    });
    S.followups.forEach((f) => {
      const done = (f.status || 'pending') === 'done';
      out.push({
        at: done ? f.completed_at || f.updated_at || f.created_at : f.created_at,
        icon: done ? '✓' : '⏰',
        title: (done ? 'Follow-up feito: ' : 'Follow-up agendado: ') + (f.title || ''),
        body: [f.due_date ? 'para ' + fmtDate(f.due_date, true) : '', f.description || ''].filter(Boolean).join(' · '),
        del: { kind: 'followups', id: f.id },
      });
    });
    S.visits.forEach((v) => {
      if (!v.scheduled_at) return;
      const st = v.status || 'scheduled';
      out.push({
        at: v.created_at || v.scheduled_at,
        icon: '📅',
        title: (st === 'scheduled' ? 'Visita marcada para ' : 'Visita ' + (VISIT_STATUS[st] || st).toLowerCase() + ' — ') + fmtWeekday(v.scheduled_at),
        body: v.address || '',
      });
    });
    S.quotes.forEach((q) => {
      out.push({ at: q.created_at, icon: '📄', title: quoteLabel(q) + ' criado', body: [quoteTitle(q), money(q.total)].filter(Boolean).join(' · '), href: quoteHref(q) });
      if (q.email_sent_at) out.push({ at: q.email_sent_at, icon: '📤', title: quoteLabel(q) + ' enviado ao cliente', body: money(q.total), href: quoteHref(q) });
      if (q.viewed_at) out.push({ at: q.viewed_at, icon: '👁', title: quoteLabel(q) + ' visualizado pelo cliente', body: '', href: quoteHref(q) });
      if (q.signed_at) out.push({ at: q.signed_at, icon: '✍️', title: quoteLabel(q) + ' aprovado e assinado', body: money(q.total), href: quoteHref(q) });
    });
    out.push({ at: L.created_at, icon: '✨', title: 'Lead criado' + (L.source ? ' · ' + L.source : ''), body: L.message ? '“' + String(L.message).slice(0, 140) + (String(L.message).length > 140 ? '…' : '') + '”' : '' });
    return out.filter((x) => x.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  function tlItemHtml(it) {
    const title = it.href ? `<a href="${esc(it.href)}">${esc(it.title)}</a>` : esc(it.title);
    const del = it.del ? `<button type="button" class="lp-tl__del" data-lp-del-kind="${it.del.kind}" data-lp-del-id="${esc(it.del.id)}" aria-label="Excluir" title="Excluir">×</button>` : '';
    return `<li><span class="lp-ic" aria-hidden="true">${it.icon}</span><div class="lp-tl__b"><b>${title}</b>${it.body ? `<p>${rich(it.body)}</p>` : ''}${
      it.who ? `<small>${esc(it.who)}</small>` : ''
    }</div><time title="${esc(fmtDate(it.at, true))}">${esc(relTime(it.at))}</time>${del}</li>`;
  }

  function composerHtml() {
    const c = S.composer;
    const chips = [
      ['note', '📝 Nota'],
      ['call', '📞 Ligação'],
      ['followup', '⏰ Follow-up'],
    ]
      .map(([k, l]) => `<button type="button" class="lp-chip-btn ${k === c ? 'is-on' : ''}" data-lp-composer="${k}">${l}</button>`)
      .join('');
    let fields = '';
    if (c === 'note') fields = '<textarea name="notes" class="lp-textarea" rows="3" required placeholder="Escreva uma nota sobre o lead…"></textarea>';
    if (c === 'call')
      fields = `<div class="lp-seg lp-seg--wrap" role="radiogroup" aria-label="Resultado">${CALL_RESULTS.map(
        (r, i) => `<label class="lp-radio"><input type="radio" name="subject" value="${esc(r)}" ${i === 0 ? 'checked' : ''}/> <span>${esc(r)}</span></label>`
      ).join('')}</div><textarea name="notes" class="lp-textarea" rows="2" placeholder="O que foi conversado? (opcional)"></textarea>`;
    if (c === 'followup') {
      const d = new Date(Date.now() + 86400e3);
      d.setHours(9, 0, 0, 0);
      const v = toLocalInput(d.toISOString());
      fields = `<input name="title" class="lp-input" required placeholder="O que fazer? ex.: Ligar para saber do orçamento" />
        <div class="lp-form__2"><input name="date" type="date" class="lp-input" required value="${v.date}" aria-label="Data" /><input name="time" type="time" class="lp-input" value="${v.time}" aria-label="Hora" /></div>`;
    }
    const btn = { note: 'Salvar nota', call: 'Registrar ligação', followup: 'Agendar follow-up' }[c];
    return `<form class="lp-card lp-composer" data-lp-form="composer"><div class="lp-chips">${chips}</div>${fields}<div class="lp-form__acts lp-form__acts--end"><button type="submit" class="lp-btn lp-btn--ink">${btn}</button></div></form>`;
  }

  function renderAtividade() {
    const pend = pendingFollowups();
    const items = timelineItems();
    $('#lpPanelAtividade').innerHTML = `${composerHtml()}
      ${
        pend.length
          ? `<div class="lp-card"><h3 class="lp-h3">Follow-ups pendentes</h3><ul class="lp-fu">${pend
              .map((f) => {
                const late = f.due_date && new Date(f.due_date).getTime() < Date.now();
                return `<li><button type="button" class="lp-check" data-lp-fu-done="${esc(f.id)}" aria-label="Marcar como feito"></button><div><b>${esc(f.title || 'Follow-up')}</b><small class="${late ? 'lp-late' : ''}">${
                  f.due_date ? (late ? 'Atrasado · ' : '') + esc(fmtDate(f.due_date, true)) : 'Sem data'
                }</small></div></li>`;
              })
              .join('')}</ul></div>`
          : ''
      }
      <div class="lp-card"><h3 class="lp-h3">Linha do tempo</h3><ul class="lp-tl">${items.map(tlItemHtml).join('')}</ul></div>`;
  }

  // ---------- Orçamentos e visitas
  function renderOrcamentos() {
    const quotes = S.quotes.length
      ? `<div class="lp-table-wrap"><table class="lp-table"><thead><tr><th>Orçamento</th><th>Status</th><th class="lp-r">Total</th><th class="lp-hide-sm">Criado</th><th></th></tr></thead><tbody>${S.quotes
          .map((q) => {
            const st = quoteStatus(q);
            return `<tr><td><a href="${esc(quoteHref(q))}"><b>${esc(quoteLabel(q))}</b></a><small>${esc(quoteTitle(q))}</small></td>
            <td><span class="lp-qs" data-qs="${esc(st)}">${esc(QUOTE_STATUS[st] || st)}</span></td>
            <td class="lp-r lp-num">${esc(money(q.total))}</td><td class="lp-hide-sm">${esc(fmtDate(q.created_at))}</td>
            <td class="lp-r lp-row-acts"><button type="button" class="lp-btn lp-btn--sm lp-btn--ghost" data-lp-pdf="${esc(q.id)}" data-lp-pdf-label="${esc(quoteLabel(q))}">PDF</button><a class="lp-btn lp-btn--sm" href="${esc(quoteHref(q))}">Abrir</a>${
              ['draft', 'archived', 'expired'].includes(String(q.status))
                ? `<button type="button" class="lp-btn lp-btn--sm lp-btn--ghost lp-danger" data-lp-quote-del="${esc(q.id)}" aria-label="Excluir orçamento">Excluir</button>`
                : ''
            }</td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : '<p class="lp-empty">Nenhum orçamento para este lead.</p>';
    const visits = S.visits.length
      ? `<ul class="lp-visits">${sortedVisits()
          .map((v) => {
            const st = v.status || 'scheduled';
            const who = v.seller_id ? (S.users.find((u) => String(u.id) === String(v.seller_id)) || {}).name : '';
            return `<li><div class="lp-visit__d"><b>${esc(fmtWeekday(v.scheduled_at))}</b><small>${esc([v.address, who].filter(Boolean).join(' · ') || 'Sem endereço')}</small>${
              v.notes ? `<p>${esc(v.notes)}</p>` : ''
            }</div><span class="lp-vs" data-vs="${esc(st)}">${esc(VISIT_STATUS[st] || st)}</span><button type="button" class="lp-btn lp-btn--sm" data-lp-visit-edit="${esc(v.id)}">Editar</button></li>`;
          })
          .join('')}</ul>`
      : '<p class="lp-empty">Nenhuma visita agendada.</p>';
    $('#lpPanelOrcamentos').innerHTML = `
      <div class="lp-card"><h3 class="lp-h3">Orçamentos <a class="lp-link" href="${esc(newQuoteHref())}">+ Novo orçamento</a></h3>${quotes}</div>
      <div class="lp-card"><h3 class="lp-h3">Visitas <button type="button" class="lp-link" data-lp-visit-new>+ Agendar visita</button></h3>${visits}</div>`;
    if (S.visits.some((v) => v.seller_id) && !S.users.length) ensureUsers().then(() => S.tab === 'orcamentos' && renderOrcamentos());
  }

  // ---------- Qualificação
  function renderQualificacao() {
    const Q = S.qual || {};
    $('#lpPanelQualificacao').innerHTML = `<form class="lp-card lp-form" data-lp-form="qual">
      <h3 class="lp-h3">Qualificação ${Q.updated_at ? `<span class="lp-mut lp-small">atualizada ${esc(relTime(Q.updated_at))}</span>` : ''}</h3>
      <div class="lp-form__2"><label>Tipo de imóvel${selectHtml('property_type', PROPERTY, Q.property_type)}</label><label>Serviço${selectHtml('service_type', SERVICE, Q.service_type)}</label></div>
      <div class="lp-form__2"><label>Área estimada<input name="estimated_area" placeholder="ex.: 850 sqft" value="${esc(Q.estimated_area || '')}" /></label><label>Orçamento do cliente<input name="estimated_budget" placeholder="ex.: $8–12 mil" value="${esc(Q.estimated_budget || '')}" /></label></div>
      <div class="lp-form__2"><label>Urgência${selectHtml('urgency', URGENCY, Q.urgency || 'medium')}</label><label>Pagamento${selectHtml('payment_type', PAYMENT, Q.payment_type)}</label></div>
      <div class="lp-form__2"><label>Quem decide<input name="decision_maker" placeholder="ex.: o casal, o síndico" value="${esc(Q.decision_maker || '')}" /></label><label>Prazo para decidir<input name="decision_timeline" placeholder="ex.: até novembro" value="${esc(Q.decision_timeline || '')}" /></label></div>
      <label>Observações<textarea name="qualification_notes" class="lp-textarea" rows="3" placeholder="Pets, móveis, acesso, piso atual…">${esc(Q.qualification_notes || '')}</textarea></label>
      <div class="lp-form__acts lp-form__acts--end"><button type="submit" class="lp-btn lp-btn--ink">Salvar qualificação</button></div>
    </form>`;
  }

  // ------------------------------------------------------------------ links
  const newQuoteHref = () => 'quote-builder.html?lead_id=' + encodeURIComponent(S.id);
  const quoteHref = (q) => 'quote-builder.html?id=' + encodeURIComponent(q.id) + '&lead_id=' + encodeURIComponent(S.id);

  // ------------------------------------------------------------------ actions
  async function saveLead(patch, okMsg) {
    const j = await api('/api/leads/' + encodeURIComponent(S.id), { method: 'PUT', body: patch });
    S.lead = j.data;
    if (okMsg) toast(okMsg, 'success');
    return j.data;
  }

  async function moveStage(slug, extra) {
    if (slug === currentSlug() && !extra) return;
    if (slug === 'lost') return openLostModal();
    if (slug === 'meeting_scheduled' && !upcomingVisit()) {
      openVisitModal(null, { fromStage: true });
      return;
    }
    const row = stageRow(slug);
    const body = Object.assign({ status: slug }, row.id ? { pipeline_stage_id: row.id } : {}, extra || {});
    try {
      await saveLead(body, 'Etapa: ' + stageLabel(slug));
      await reloadActivity().catch(() => {});
      renderAll();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function openMenu(anchor, items) {
    const m = $('#lpMenu');
    m.innerHTML = items
      .map((it) =>
        it.sep
          ? '<hr />'
          : it.href
            ? `<a class="lp-menu__item" href="${esc(it.href)}" ${it.attr || ''} ${it.target ? 'target="_blank" rel="noopener"' : ''}>${esc(it.label)}</a>`
            : `<button type="button" class="lp-menu__item ${it.danger ? 'lp-danger' : ''}" ${it.attr || ''}>${esc(it.label)}</button>`
      )
      .join('');
    m.hidden = false;
    const sheet = window.innerWidth < 760;
    m.classList.toggle('lp-menu--sheet', sheet);
    if (!sheet) {
      const r = anchor.getBoundingClientRect();
      m.style.top = r.bottom + 6 + 'px';
      m.style.left = Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)) + 'px';
    } else {
      m.style.top = '';
      m.style.left = '';
    }
  }
  const closeMenu = () => {
    const m = $('#lpMenu');
    m.hidden = true;
    m.innerHTML = '';
  };

  function moreMenu(anchor) {
    const L = S.lead;
    const digits = String(L.phone || '').replace(/\D/g, '');
    const wa = digits ? 'https://wa.me/' + (digits.length === 10 ? '1' + digits : digits) : '';
    const items = [
      { label: 'Agendar visita', attr: 'data-lp-visit-new' },
      { label: 'Agendar follow-up', attr: 'data-lp-fu-new' },
    ];
    if (L.email) items.push({ label: 'Enviar e-mail', attr: 'data-lp-email', mobOnly: true });
    if (wa) items.push({ label: 'WhatsApp', href: wa, target: true });
    items.push({ sep: true });
    items.push(isLost() ? { label: 'Reabrir lead', attr: 'data-lp-reopen' } : { label: 'Marcar como perdido', attr: 'data-lp-lost' });
    items.push({ label: 'Excluir lead', attr: 'data-lp-delete', danger: true });
    openMenu(anchor, items);
  }

  // ---------- modal
  let modalSubmit = null;
  function openModal(title, html, onSubmit) {
    $('#lpModalTitle').textContent = title;
    $('#lpModalForm').innerHTML = html;
    modalSubmit = onSubmit;
    $('#lpModal').hidden = false;
    document.body.classList.add('lp-modal-open');
    const f = $('#lpModalForm input:not([type=hidden]), #lpModalForm select, #lpModalForm textarea');
    if (f && window.innerWidth >= 760) setTimeout(() => f.focus(), 30);
  }
  function closeModal() {
    $('#lpModal').hidden = true;
    $('#lpModalForm').innerHTML = '';
    modalSubmit = null;
    document.body.classList.remove('lp-modal-open');
  }

  async function openVisitModal(visitId, opts) {
    const v = visitId ? S.visits.find((x) => String(x.id) === String(visitId)) : null;
    const users = await ensureUsers();
    let when = v ? toLocalInput(v.scheduled_at) : null;
    if (!when) {
      const d = new Date(Date.now() + 86400e3);
      d.setHours(10, 0, 0, 0);
      when = toLocalInput(d.toISOString());
    }
    const seller = v ? v.seller_id : S.lead.owner_id;
    openModal(
      v ? 'Editar visita' : 'Agendar visita',
      `<div class="lp-form__2"><label>Data<input type="date" name="date" required value="${when.date}" /></label><label>Hora<input type="time" name="time" required value="${when.time}" /></label></div>
      <label>Responsável<select name="seller_id"><option value="">—</option>${users
        .map((u) => `<option value="${esc(u.id)}" ${String(u.id) === String(seller || '') ? 'selected' : ''}>${esc(u.name || u.email)}</option>`)
        .join('')}</select></label>
      <label>Endereço<input name="address" data-lp-address autocomplete="off" value="${esc(v ? v.address || '' : leadAddress())}" /></label>
      ${v ? `<label>Status${selectHtml('status', VISIT_STATUS, v.status || 'scheduled')}</label>` : ''}
      <label>Observações<textarea name="notes" rows="2" placeholder="Portão, cachorro, quem vai receber…">${esc(v ? v.notes || '' : '')}</textarea></label>
      ${!v ? '<p class="lp-hint">O lead vai para a etapa <b>Visita agendada</b>.</p>' : ''}
      <div class="lp-form__acts"><button type="button" class="lp-btn" data-lp-close>Cancelar</button><button type="submit" class="lp-btn lp-btn--pri">${v ? 'Salvar visita' : 'Agendar visita'}</button></div>`,
      async (fd) => {
        const date = fd.get('date');
        const time = fd.get('time') || '09:00';
        if (!date) throw new Error('Informe a data da visita.');
        const scheduled = new Date(`${date}T${time}`);
        const body = {
          lead_id: S.id,
          scheduled_at: scheduled.toISOString(),
          address: String(fd.get('address') || '').trim() || null,
          notes: String(fd.get('notes') || '').trim() || null,
          seller_id: fd.get('seller_id') || null,
        };
        if (v) body.status = fd.get('status') || 'scheduled';
        const j = await api(v ? '/api/visits/' + encodeURIComponent(v.id) : '/api/visits', { method: v ? 'PUT' : 'POST', body });
        if (j.lead) S.lead = j.lead;
        await Promise.all([reloadVisits(), reloadActivity()]).catch(() => {});
        toast(v ? 'Visita atualizada' : 'Visita agendada', 'success');
        renderAll();
      }
    );
    attachAddress($('#lpModalForm [data-lp-address]'));
    void opts;
  }

  async function openLostModal() {
    const reasons = await ensureLossReasons();
    const L = S.lead;
    openModal(
      isLost() ? 'Motivo da perda' : 'Marcar como perdido',
      `${reasons.length ? `<label>Motivo<select name="loss_reason_id"><option value="">—</option>${reasons
        .map((r) => `<option value="${esc(r.id)}" ${String(r.id) === String(L.loss_reason_id || '') ? 'selected' : ''}>${esc(lossName(r))}</option>`)
        .join('')}</select></label>` : ''}
      <label>Observação<textarea name="loss_note" rows="3" placeholder="ex.: fechou com outra empresa, preço acima do esperado">${esc(L.loss_note || '')}</textarea></label>
      <div class="lp-form__acts"><button type="button" class="lp-btn" data-lp-close>Cancelar</button><button type="submit" class="lp-btn lp-btn--ink">${isLost() ? 'Salvar' : 'Marcar como perdido'}</button></div>`,
      async (fd) => {
        const row = stageRow('lost');
        const body = { loss_note: String(fd.get('loss_note') || '').trim() || null };
        if (reasons.length) body.loss_reason_id = fd.get('loss_reason_id') || null;
        if (!isLost()) Object.assign(body, { status: 'lost' }, row.id ? { pipeline_stage_id: row.id } : {});
        await saveLead(body, isLost() ? 'Motivo salvo' : 'Lead marcado como perdido');
        await reloadActivity().catch(() => {});
        renderAll();
      }
    );
  }

  function openFollowupModal() {
    const d = new Date(Date.now() + 2 * 86400e3);
    d.setHours(9, 0, 0, 0);
    const v = toLocalInput(d.toISOString());
    const q = latestQuote();
    openModal(
      'Agendar follow-up',
      `<label>O que fazer<input name="title" required value="${esc(q ? 'Ligar sobre o ' + quoteLabel(q) : 'Ligar para o cliente')}" /></label>
      <div class="lp-form__2"><label>Data<input type="date" name="date" required value="${v.date}" /></label><label>Hora<input type="time" name="time" value="${v.time}" /></label></div>
      <label>Detalhes<textarea name="description" rows="2"></textarea></label>
      <div class="lp-form__acts"><button type="button" class="lp-btn" data-lp-close>Cancelar</button><button type="submit" class="lp-btn lp-btn--ink">Agendar</button></div>`,
      async (fd) => {
        await createFollowup(fd);
        renderAll();
      }
    );
  }

  async function createFollowup(fd) {
    const date = fd.get('date');
    if (!date) throw new Error('Informe a data.');
    const due = new Date(`${date}T${fd.get('time') || '09:00'}`);
    await api('/api/leads/' + encodeURIComponent(S.id) + '/followups', {
      method: 'POST',
      body: { title: String(fd.get('title') || 'Follow-up').trim(), description: String(fd.get('description') || '').trim() || null, due_date: due.toISOString() },
    });
    await reloadActivity();
    toast('Follow-up agendado para ' + fmtDate(due.toISOString(), true), 'success');
  }

  function confirmModal(title, text, btnLabel, onOk) {
    openModal(title, `<p class="lp-confirm">${esc(text)}</p><div class="lp-form__acts"><button type="button" class="lp-btn" data-lp-close>Cancelar</button><button type="submit" class="lp-btn lp-btn--danger">${esc(btnLabel)}</button></div>`, onOk);
  }

  // ------------------------------------------------------------------ events
  function wire() {
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('change', onChange);
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'lpNotes') {
        const dirty = e.target.value !== (S.lead.notes || '');
        const b = $('[data-lp-notes-save]');
        if (b) b.hidden = !dirty;
        const sv = $('#lpNotesSaved');
        if (sv) sv.hidden = true;
      }
    });
    document.addEventListener(
      'blur',
      (e) => {
        if (e.target && e.target.id === 'lpNotes' && e.target.value !== (S.lead.notes || '')) saveNotes();
      },
      true
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#lpMenu').hidden) closeMenu();
        else if (!$('#lpModal').hidden) closeModal();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      const n = $('#lpNotes');
      if (n && S.lead && n.value !== (S.lead.notes || '')) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function saveNotes() {
    const n = $('#lpNotes');
    if (!n) return;
    const val = n.value;
    try {
      await saveLead({ notes: val });
      const b = $('[data-lp-notes-save]');
      if (b) b.hidden = true;
      const sv = $('#lpNotesSaved');
      if (sv) sv.hidden = false;
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function setTab(tab) {
    S.tab = tab;
    S.editing = null;
    const u = new URL(location.href);
    if (tab === 'geral') u.searchParams.delete('tab');
    else u.searchParams.set('tab', tab);
    history.replaceState(null, '', u.toString());
    renderTabs();
    renderPanel();
  }

  async function onClick(e) {
    const t = e.target;
    const menuOpen = !$('#lpMenu').hidden;
    if (menuOpen && !t.closest('#lpMenu') && !t.closest('[data-lp-more]')) closeMenu();
    if (t.closest('#lpMenu') && t.closest('.lp-menu__item')) setTimeout(closeMenu, 0);

    let el;
    if ((el = t.closest('[data-lp-close]'))) return closeModal();
    if ((el = t.closest('[data-lp-tab]'))) return setTab(el.getAttribute('data-lp-tab'));
    if ((el = t.closest('[data-lp-tab-go]'))) {
      if (el.hasAttribute('data-lp-composer')) S.composer = el.getAttribute('data-lp-composer');
      setTab(el.getAttribute('data-lp-tab-go'));
      $('#lpTabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if ((el = t.closest('[data-lp-composer]'))) {
      S.composer = el.getAttribute('data-lp-composer');
      return renderAtividade();
    }
    if ((el = t.closest('[data-lp-more]'))) {
      if (menuOpen) return closeMenu();
      return moreMenu(el);
    }
    if ((el = t.closest('[data-lp-stage]'))) return moveStage(el.getAttribute('data-lp-stage'));
    if (t.closest('[data-lp-reopen]')) {
      const prev = S.interactions.find((i) => i.type === 'stage' && (i.to_stage === 'lost' || i.to_stage === 'closed_lost'));
      const back = prev && prev.from_stage && canonSlug(prev.from_stage) !== 'lost' ? canonSlug(prev.from_stage) : 'new_lead';
      return moveStage(back === 'meeting_scheduled' && !upcomingVisit() ? 'stand_by' : back);
    }
    if (t.closest('[data-lp-lost]') || t.closest('[data-lp-lost-edit]')) return openLostModal();
    if (t.closest('[data-lp-visit-new]')) return openVisitModal();
    if ((el = t.closest('[data-lp-visit-edit]'))) return openVisitModal(el.getAttribute('data-lp-visit-edit'));
    if (t.closest('[data-lp-fu-new]')) return openFollowupModal();
    if ((el = t.closest('[data-lp-fu-done]'))) {
      try {
        await api('/api/leads/' + encodeURIComponent(S.id) + '/followups/' + encodeURIComponent(el.getAttribute('data-lp-fu-done')), { method: 'PUT', body: { status: 'done' } });
        await reloadActivity();
        toast('Follow-up concluído', 'success');
        renderAll();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if ((el = t.closest('[data-lp-edit]'))) {
      S.editing = el.getAttribute('data-lp-edit');
      if (S.tab !== 'geral') S.tab = 'geral';
      renderTabs();
      renderGeral();
      const f = $(`[data-lp-form="${S.editing}"] input, [data-lp-form="${S.editing}"] select`);
      if (f) f.focus();
      return;
    }
    if (t.closest('[data-lp-cancel]')) {
      S.editing = null;
      return renderGeral();
    }
    if (t.closest('[data-lp-notes-save]')) return saveNotes();
    if ((el = t.closest('[data-lp-priority]'))) {
      const p = el.getAttribute('data-lp-priority');
      if (p === S.lead.priority) return;
      try {
        await saveLead({ priority: p }, 'Prioridade: ' + PRIORITY[p]);
        renderHead();
        renderSide();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if ((el = t.closest('[data-lp-tag-del]'))) {
      const tag = el.getAttribute('data-lp-tag-del');
      try {
        await saveLead({ tags: (S.lead.tags || []).filter((x) => x !== tag) });
        renderSide();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if (t.closest('[data-lp-call]')) {
      // The tel: link opens the dialer; the composer is ready to log how the call went.
      S.composer = 'call';
      setTimeout(() => setTab('atividade'), 300);
      return;
    }
    if ((el = t.closest('[data-lp-sms]'))) {
      e.preventDefault();
      if (typeof window.sfOpenSmsChoiceMenu === 'function') return window.sfOpenSmsChoiceMenu(el, S.lead);
      if (S.lead.phone) location.href = 'sms:' + String(S.lead.phone).replace(/[^\d+]/g, '');
      return;
    }
    if ((el = t.closest('[data-lp-email]'))) {
      e.preventDefault();
      if (typeof window.sfOpenEmailChoiceMenu === 'function') return window.sfOpenEmailChoiceMenu(el, S.lead);
      if (S.lead.email) location.href = 'mailto:' + S.lead.email;
      return;
    }
    if ((el = t.closest('[data-lp-pdf]'))) {
      const id = el.getAttribute('data-lp-pdf');
      const label = el.getAttribute('data-lp-pdf-label') || 'Orçamento';
      const url = '/api/quotes/' + encodeURIComponent(id) + '/invoice-pdf';
      if (window.crmPdfViewer && window.crmPdfViewer.openFromUrl) window.crmPdfViewer.openFromUrl(url, { title: label });
      else window.open(url, '_blank');
      return;
    }
    if ((el = t.closest('[data-lp-quote-del]'))) {
      const id = el.getAttribute('data-lp-quote-del');
      const q = S.quotes.find((x) => String(x.id) === String(id));
      return confirmModal('Excluir orçamento', `Excluir o ${q ? quoteLabel(q) : 'orçamento'}? Isso não pode ser desfeito.`, 'Excluir', async () => {
        await api('/api/quotes/' + encodeURIComponent(id) + '?lead_id=' + encodeURIComponent(S.id), { method: 'DELETE' });
        S.quotes = S.quotes.filter((x) => String(x.id) !== String(id));
        toast('Orçamento excluído', 'success');
        renderAll();
      });
    }
    if ((el = t.closest('[data-lp-del-kind]'))) {
      const kind = el.getAttribute('data-lp-del-kind');
      const id = el.getAttribute('data-lp-del-id');
      return confirmModal('Excluir registro', 'Excluir este registro da linha do tempo?', 'Excluir', async () => {
        await api('/api/leads/' + encodeURIComponent(S.id) + '/' + kind + '/' + encodeURIComponent(id), { method: 'DELETE' });
        await reloadActivity();
        renderAll();
      });
    }
    if (t.closest('[data-lp-delete]')) {
      return confirmModal('Excluir lead', `Excluir ${S.lead.name}? Notas, visitas e histórico deste lead serão apagados.`, 'Excluir lead', async () => {
        await api('/api/leads/' + encodeURIComponent(S.id), { method: 'DELETE' });
        toast('Lead excluído', 'success');
        location.href = 'leads.html';
      });
    }
  }

  async function onChange(e) {
    if (e.target && e.target.id === 'lpOwner') {
      try {
        await saveLead({ owner_id: e.target.value || null }, 'Dono atualizado');
        renderHead();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }

  async function onSubmit(e) {
    const form = e.target;
    if (form.id === 'lpModalForm') {
      e.preventDefault();
      if (!modalSubmit) return;
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try {
        await modalSubmit(new FormData(form));
        closeModal();
      } catch (err) {
        toast(err.message, 'error');
        if (btn) btn.disabled = false;
      }
      return;
    }
    if (form.matches('[data-lp-tag-form]')) {
      e.preventDefault();
      const input = form.querySelector('input');
      const v = String(input.value || '').trim();
      if (!v) return;
      try {
        await saveLead({ tags: (S.lead.tags || []).concat(v) });
        renderSide();
        const again = $('[data-lp-tag-form] input');
        if (again) again.focus();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    const kind = form.getAttribute('data-lp-form');
    if (!kind) return;
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      if (kind === 'contact') {
        const name = String(fd.get('name') || '').trim();
        if (!name) throw new Error('O nome é obrigatório.');
        const email = String(fd.get('email') || '').trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
        await saveLead(
          {
            name,
            phone: String(fd.get('phone') || '').trim(),
            email,
            address: String(fd.get('address') || '').trim(),
            zipcode: String(fd.get('zipcode') || '').trim(),
            company_name: String(fd.get('company_name') || '').trim(),
            source: String(fd.get('source') || '').trim(),
          },
          'Contato salvo'
        );
        S.editing = null;
        renderAll();
      } else if (kind === 'project') {
        const raw = String(fd.get('estimated_value') || '').replace(/[$,\s]/g, '');
        const val = raw === '' ? null : Number(raw);
        if (raw !== '' && !Number.isFinite(val)) throw new Error('Valor estimado inválido.');
        const qual = Object.assign({}, S.qual || {}, {
          service_type: fd.get('service_type') || null,
          property_type: fd.get('property_type') || null,
          estimated_area: String(fd.get('estimated_area') || '').trim() || null,
          decision_timeline: String(fd.get('decision_timeline') || '').trim() || null,
        });
        const [, qj] = await Promise.all([
          saveLead({ estimated_value: val }),
          api('/api/leads/' + encodeURIComponent(S.id) + '/qualification', { method: 'PUT', body: qual }),
        ]);
        S.qual = qj.data;
        S.editing = null;
        toast('Projeto salvo', 'success');
        renderAll();
      } else if (kind === 'qual') {
        const qual = Object.assign({}, S.qual || {});
        ['property_type', 'service_type', 'estimated_area', 'estimated_budget', 'urgency', 'payment_type', 'decision_maker', 'decision_timeline', 'qualification_notes'].forEach((k) => {
          const v = String(fd.get(k) || '').trim();
          qual[k] = v || null;
        });
        const qj = await api('/api/leads/' + encodeURIComponent(S.id) + '/qualification', { method: 'PUT', body: qual });
        S.qual = qj.data;
        toast('Qualificação salva', 'success');
        renderQualificacao();
      } else if (kind === 'composer') {
        if (S.composer === 'followup') {
          await createFollowup(fd);
        } else {
          const notes = String(fd.get('notes') || '').trim();
          if (S.composer === 'note' && !notes) throw new Error('Escreva a nota.');
          await api('/api/leads/' + encodeURIComponent(S.id) + '/interactions', {
            method: 'POST',
            body: { type: S.composer === 'call' ? 'call' : 'note', subject: S.composer === 'call' ? fd.get('subject') : null, notes: notes || null },
          });
          await Promise.all([reloadActivity(), reloadLead()]);
          toast(S.composer === 'call' ? 'Ligação registrada' : 'Nota salva', 'success');
        }
        S.composer = 'note';
        renderAll();
      }
    } catch (err) {
      toast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
