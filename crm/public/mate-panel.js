/**
 * Mate AI — command bar available on every CRM screen (⌘J / Ctrl J, the topbar button, the
 * "Mate AI" nav item, or the floating button on phones).
 *
 * Desktop: a centered bar over the dimmed page — type or talk at the top, the current step
 * (card / question / answer) right under it, earlier turns folded away. Phone: a bottom sheet
 * with the input at the bottom, next to the thumb and the keyboard.
 *
 * Talk or type → the server picks an action and returns a CARD to confirm, a QUESTION with
 * options, or an ANSWER. Cards are edited in place (each edit re-prepares on the server, no new
 * AI call), confirmed with one tap or Enter, and reversible actions offer "Desfazer" for 30 s.
 *
 * Page mode: when the page has #mateAiInline (mate-ai.html) the bar renders inside it.
 */
(function () {
  'use strict';
  if (window.__mateAiPanel) return;
  window.__mateAiPanel = true;

  var API = {
    act: '/api/mate-ai/act',
    exec: '/api/mate-ai/execute',
    undo: '/api/mate-ai/undo',
    sug: '/api/mate-ai/suggestions',
    ctx: '/api/mate-ai/context',
    status: '/api/mate-ai/status',
    transcribe: '/api/mate-ai/transcribe',
    catalog: '/api/mate-ai/catalog',
    convs: '/api/mate-ai/conversations',
  };
  var officePage = /\/escritorio-ia(\.html)?$/i.test(location.pathname);
  var requestedAgent = new URLSearchParams(location.search).get('agent') || (officePage ? 'mate' : '');
  var agentKey = /^[a-z0-9_-]{1,60}$/i.test(requestedAgent) ? requestedAgent.toLowerCase() : '';
  var agentMode = Boolean(agentKey && document.getElementById('mateAiInline'));
  var agentProfile = null;
  var agentUnavailable = false;
  var KEY_THREAD = 'mateAi.thread.v2' + (agentMode ? '.agent.' + agentKey : '');
  var KEY_HIDDEN = 'mateAi.hidden.v1';
  var KEY_CATALOG = 'mateAi.catalog.v1';
  /** Reopening within this time offers "Continuar"; after it, the conversation is only in the history. */
  var RESUME_MS = 15 * 60 * 1000;
  /** Confirmation tokens last 10 min on the server; older cards can no longer be confirmed. */
  var CARD_TTL_MS = 9 * 60 * 1000;
  var MAX_TODO = 3;
  var KEY_LANG = 'mateAiVoiceLang';
  var MAX_THREAD = 40;

  var ICON = {
    spark: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" opacity=".7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  /** Used only when the catalog cannot be loaded. */
  var EXAMPLES = [
    'Criar um quote para o John Smith, 1350 pés de madeira',
    'O que tem amanhã?',
    'Quanto faturei este mês?',
    'Emitir a invoice do job 1042 para sexta',
    'Novo lead: Ana, 720 555 0101, trocar carpete',
    'Quem está me devendo?',
  ];

  function examplesForAgent(agent) {
    var caps = Array.isArray(agent && agent.capabilities) ? agent.capabilities : [];
    var examples = [];
    if (caps.indexOf('leads.search') >= 0) examples.push('Quais leads precisam de retorno?');
    if (caps.indexOf('customers.search') >= 0) examples.push('Me mostre o resumo de um cliente');
    if (caps.indexOf('quotes.prepare') >= 0) examples.push('Criar um orçamento para um cliente');
    if (caps.indexOf('quotes.send') >= 0) examples.push('Enviar o último orçamento por e-mail');
    if (caps.indexOf('jobs.view') >= 0 || caps.indexOf('schedule.view') >= 0) examples.push('O que temos na agenda amanhã?');
    if (caps.indexOf('jobs.manage') >= 0) examples.push('Atualizar o status do job 1042');
    if (caps.indexOf('schedule.manage') >= 0) examples.push('Agendar o job 1042 para amanhã às 8h');
    if (caps.indexOf('invoices.view') >= 0) examples.push('Quais invoices estão vencidas?');
    if (caps.indexOf('invoices.manage') >= 0) examples.push('Enviar a invoice 3012 para o cliente');
    if (caps.indexOf('payments.manage') >= 0) examples.push('Registrar um pagamento que recebemos hoje');
    if (caps.indexOf('office.summary') >= 0) examples.push('Me dê um resumo da operação deste mês');
    return examples.slice(0, 5);
  }

  /* ───────── helpers ───────── */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHref(href) {
    var h = String(href || '');
    if (/^(https?:|sms:|tel:|mailto:)/i.test(h)) return h;
    if (/^[a-z0-9_-]+\.html(\?[^\s"'<>]*)?$/i.test(h)) return h;
    if (/^\/[a-z0-9_/-]+\.html(\?[^\s"'<>]*)?$/i.test(h) && h.indexOf('//') < 0) return h;
    if (/^\/api\/[a-z-]+\/[0-9a-f-]{36}\/(invoice-pdf|paper|pdf)$/i.test(h)) return h;
    return '#';
  }

  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function store(kind) {
    try {
      return window[kind];
    } catch (_) {
      return null;
    }
  }

  function load(key, fallback) {
    try {
      var s = store('sessionStorage');
      var raw = s && s.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      var s = store('sessionStorage');
      if (s) s.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function loadLocal(key, fallback) {
    try {
      var s = store('localStorage');
      var raw = s && s.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveLocal(key, value) {
    try {
      var s = store('localStorage');
      if (s) s.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function newId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /** Lowercase, no accents: "Lança" and "lanca" match. */
  function fold(v) {
    return String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function ago(ts) {
    var min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    return h < 24 ? 'há ' + h + ' h' : 'há ' + Math.round(h / 24) + ' d';
  }

  function isPhone() {
    return Boolean(window.matchMedia && window.matchMedia('(max-width: 719px)').matches);
  }

  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      var err = new Error(data.error || 'Não foi possível concluir.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /** The record on screen, from the URL. */
  function detectScreen() {
    var file = (location.pathname.split('/').pop() || '').toLowerCase();
    var id = new URLSearchParams(location.search).get('id') || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    var map = {
      'job-detail.html': 'job',
      'lead-detail.html': 'lead',
      'quote-builder.html': 'quote',
      'invoice.html': 'invoice',
      'customers.html': 'customer',
      'ticket.html': 'job',
    };
    return map[file] ? { type: map[file], id: id } : null;
  }

  /* ───────── state ───────── */

  var inlineHost = document.getElementById('mateAiInline');
  var state = {
    open: false,
    thread: [],
    screen: detectScreen(),
    screenLabel: '',
    screenChips: [],
    useScreen: true,
    busy: false,
    suggestions: null,
    suggestionsAt: 0,
    ai: null,
    showHistory: false,
    convId: newId(),
    lastAt: 0,
    resume: null,
    view: 'thread',
    history: null,
    historyQ: '',
    showCatalog: false,
    catalog: null,
    openModule: null,
    typeahead: [],
  };
  var isField = /\/campo\//.test(location.pathname);

  /** Cards older than the token's life can no longer be confirmed; undo windows that passed are gone. */
  function revive(items) {
    var now = Date.now();
    return (items || [])
      .filter(function (m) {
        return m && m.kind !== 'thinking';
      })
      .map(function (m) {
        if ((m.kind === 'card' || m.kind === 'clarify') && (!m.at || now - m.at > CARD_TTL_MS)) m.stale = true;
        if (m.undo && !(Date.parse(m.undo.expires) > now)) m.undo = null;
        m.working = false;
        return m;
      });
  }

  function hasAsk(items) {
    return (items || []).some(function (m) {
      return m.role === 'user';
    });
  }

  // The bar always opens clean. A conversation from the last few minutes is offered as "Continuar".
  (function restore() {
    var saved = load(KEY_THREAD, null);
    if (saved && saved.id && Array.isArray(saved.items) && hasAsk(saved.items) && Date.now() - (saved.at || 0) < RESUME_MS) {
      state.resume = { id: saved.id, at: saved.at, items: revive(saved.items) };
    }
  })();

  var syncTimer = null;

  function persist() {
    var items = state.thread.slice(-MAX_THREAD).filter(function (m) {
      return m.kind !== 'thinking';
    });
    if (hasAsk(items)) save(KEY_THREAD, { id: state.convId, at: state.lastAt || Date.now(), items: items });
    clearTimeout(syncTimer);
    if (hasAsk(items)) syncTimer = setTimeout(syncServer, 1200);
  }

  /** Keeps the conversation in the account's history (the server drops confirmation tokens). */
  function syncServer() {
    var items = state.thread.slice(-MAX_THREAD).filter(function (m) {
      return m.kind !== 'thinking';
    });
    if (!hasAsk(items)) return;
    var id = state.convId;
    api('PUT', API.convs + '/' + encodeURIComponent(id), { items: items, agent_key: agentMode ? agentKey : undefined })
      .then(function () {
        state.history = null;
        try {
          window.dispatchEvent(new CustomEvent('mate:saved', { detail: { id: id } }));
        } catch (_) {}
      })
      .catch(function () {});
  }

  /** Starts a new conversation; the current one stays in the history (and in "Continuar" for a while). */
  function freshStart() {
    if (hasAsk(state.thread)) {
      clearTimeout(syncTimer);
      syncServer();
      var recent = Date.now() - (state.lastAt || 0) < RESUME_MS;
      state.resume = recent ? { id: state.convId, at: state.lastAt, items: state.thread.slice() } : null;
    } else if (state.resume && Date.now() - (state.resume.at || 0) >= RESUME_MS) {
      state.resume = null;
    }
    state.thread = [];
    state.convId = newId();
    state.screen = detectScreen();
    state.showHistory = false;
    state.view = 'thread';
    state.typeahead = [];
    publishOfficeContext(null);
  }

  function resumeConversation() {
    var r = state.resume;
    if (!r) return;
    state.resume = null;
    state.thread = revive(r.items);
    state.convId = r.id;
    state.lastAt = r.at || Date.now();
    state.view = 'thread';
    state.screen = officeEntity(entityFromItems(state.thread)) || detectScreen();
    publishOfficeContext(entityFromItems(state.thread));
    save(KEY_THREAD, { id: r.id, at: state.lastAt, items: state.thread });
    render();
  }

  /** Short memory sent to the server for follow-ups ("agora manda por SMS"). */
  function memory() {
    var out = [];
    state.thread.forEach(function (m) {
      if (m.role === 'user' && m.text) out.push({ role: 'user', text: String(m.text).slice(0, 380) });
      else if (m.kind === 'done' && m.result) {
        out.push({ role: 'assistant', text: String(m.result.memory || m.result.title || '').slice(0, 380), entity: m.result.entity || null });
      } else if ((m.kind === 'reply' || m.kind === 'error') && m.message) {
        out.push({ role: 'assistant', text: String(m.message).slice(0, 380) });
      } else if (m.kind === 'card' && m.card && m.card.confirm) {
        // A proposal: say it is not done yet, and keep its args so "faz um novo com isso" can rebuild it.
        var args = '';
        try { args = JSON.stringify(m.args || {}); } catch (e) { args = ''; }
        out.push({
          role: 'assistant',
          text: ('Proposed, NOT confirmed (does not exist yet): ' + m.card.title + ' · ' + (m.action || '') + ' ' + args).slice(0, 880),
        });
      } else if ((m.kind === 'card' || m.kind === 'answer') && m.card) {
        out.push({ role: 'assistant', text: ('Showed: ' + m.card.title).slice(0, 380) });
      }
    });
    return out.slice(-12);
  }

  /** The newest card / question / error not yet confirmed or canceled: follow-ups refer to it. */
  function pendingForRequest() {
    for (var i = state.thread.length - 1; i >= 0; i--) {
      var m = state.thread[i];
      if (m.role === 'user' || m.kind === 'thinking') continue;
      if (m.kind === 'done' || m.kind === 'reply' || m.canceled) return null;
      if (!m.action || !m.args) return null;
      if (m.kind === 'card' || m.kind === 'clarify' || m.kind === 'error' || m.kind === 'answer') {
        var summary = m.kind === 'clarify' ? (m.clarify && m.clarify.question) || '' : m.kind === 'error' ? m.message || '' : (m.card && m.card.title) || '';
        return { action: m.action, args: m.args, status: m.kind, summary: String(summary).slice(0, 580) };
      }
      return null;
    }
    return null;
  }

  function screenForRequest() {
    return state.useScreen && state.screen ? state.screen : null;
  }

  function entityFromItems(items) {
    for (var i = (items || []).length - 1; i >= 0; i--) {
      var message = items[i];
      var entity = message && message.kind === 'done' && message.result && message.result.entity;
      if (entity && entity.id && entity.type) return entity;
      var args = message && (message.args || (message.card && message.card.args));
      if (args && args.quote_id) return { type: 'quote', id: String(args.quote_id) };
    }
    return null;
  }

  function officeEntity(entity) {
    if (!entity || !entity.id || !entity.type) return null;
    return { type: entity.type === 'work_order' ? 'job' : String(entity.type), id: String(entity.id) };
  }

  function publishOfficeContext(entity) {
    if (!officePage) return;
    var active = officeEntity(entity || state.screen || entityFromItems(state.thread));
    if (active) state.screen = active;
    else if (!entity && !state.screen) state.screen = null;
    var detail = { entity: active, agentKey: agentMode ? agentKey : null };
    window.__mateAiOfficeContext = detail;
    try { window.dispatchEvent(new CustomEvent('mate:office-context', { detail: detail })); } catch (_) {}
  }

  /* ───────── DOM ───────── */

  var fab = null;
  var backdrop = null;
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  var panel = document.createElement('section');
  panel.className = 'mate-pal' + (inlineHost ? ' mate-pal--inline' : '');
  panel.setAttribute('role', inlineHost ? 'region' : 'dialog');
  panel.setAttribute('aria-label', 'Mate AI');
  if (!inlineHost) panel.setAttribute('aria-modal', 'true');
  panel.innerHTML =
    '<div class="mate-pal__grab" aria-hidden="true"></div>' +
    '<div class="mate-pal__bar">' +
    '<span class="mate-pal__mark" aria-hidden="true">' + ICON.spark + '</span>' +
    '<div class="mate-pal__ctx" id="mateContext" hidden></div>' +
    '<label class="mate-pal__field"><span class="mate-sr">Pedido para o Mate AI</span>' +
    '<textarea id="mateInput" rows="1" maxlength="600" placeholder="Peça ao Mate… ex.: quote pro John, 1350 pés de madeira" data-crm-rich="off" enterkeyhint="send"></textarea></label>' +
    '<button type="button" class="mate-mic mate-cam" id="mateCam" aria-label="Anexar foto" title="Anexar foto (recibo, problema na obra)">' + ICON.camera + '</button>' +
    '<input type="file" id="mateCamFile" accept="image/*" capture="environment" hidden>' +
    '<button type="button" class="mate-mic" id="mateMic" aria-label="Gravar pedido">' + ICON.mic + '</button>' +
    '<button type="button" class="mate-send" id="mateSend" aria-label="Enviar" disabled>' + ICON.send + '</button>' +
    (inlineHost ? '' : '<button type="button" class="mate-icon-btn mate-pal__close" data-mate="close" title="Fechar (Esc)" aria-label="Fechar">' + ICON.close + '</button>') +
    '</div>' +
    '<p class="mate-pal__hint" id="mateHint" aria-live="polite"></p>' +
    '<div class="mate-ahead" id="mateAhead" role="listbox" aria-label="Sugestões para completar" hidden></div>' +
    '<div class="mate-pal__chips" id="mateChips" hidden></div>' +
    '<div class="mate-pal__body" id="mateThread" aria-live="polite"></div>' +
    '<footer class="mate-pal__foot">' +
    '<span class="mate-pal__keys" id="mateKeys"></span>' +
    '<span class="mate-pal__mode" id="mateHeadSub"></span>' +
    '<span class="mate-pal__links">' +
    '<button type="button" class="mate-pal__link mate-pal__new" data-mate="clear">Nova conversa</button>' +
    '<button type="button" class="mate-pal__link" data-mate="history-open">Histórico</button>' +
    '</span>' +
    '</footer>';

  var threadEl = panel.querySelector('#mateThread');
  var inputEl = panel.querySelector('#mateInput');
  var sendEl = panel.querySelector('#mateSend');
  var micEl = panel.querySelector('#mateMic');
  var hintEl = panel.querySelector('#mateHint');
  var chipsEl = panel.querySelector('#mateChips');
  var contextEl = panel.querySelector('#mateContext');
  var headSubEl = panel.querySelector('#mateHeadSub');
  var keysEl = panel.querySelector('#mateKeys');
  var camEl = panel.querySelector('#mateCam');
  var camFile = panel.querySelector('#mateCamFile');
  var aheadEl = panel.querySelector('#mateAhead');
  if (isField) panel.classList.add('mate-pal--field');

  // Short placeholder on phones, where the long example wraps.
  (function placeholder() {
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 719px)') : null;
    function set() {
      if (actionable()) return;
      if (agentMode && agentProfile) inputEl.placeholder = 'Fale com ' + agentProfile.name + '…';
      else inputEl.placeholder = narrow && narrow.matches ? 'Peça ao Mate…' : 'Peça ao Mate… ex.: quote pro John, 1350 pés de madeira';
    }
    set();
    if (narrow && narrow.addEventListener) narrow.addEventListener('change', set);
  })();

  function mount() {
    if (inlineHost) {
      if (agentMode && state.resume) {
        state.screen = officeEntity(entityFromItems(state.resume.items));
        publishOfficeContext(state.screen);
      }
      inlineHost.appendChild(panel);
      state.open = true;
      render();
      if (agentMode) {
        panel.classList.add('mate-pal--agent');
        panel.setAttribute('aria-label', 'Conversa com funcionária virtual');
        micEl.hidden = true;
        camEl.hidden = true;
        loadAgentProfile().then(function () { render(); });
      } else {
        loadStart();
      }
      return;
    }
    backdrop = document.createElement('div');
    backdrop.className = 'mate-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    // Phones only (CSS): tap opens, press and hold talks.
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'mate-fab';
    fab.setAttribute('aria-label', 'Abrir Mate AI (segure para falar)');
    fab.innerHTML = '<span class="mate-fab__spark">' + ICON.spark + '</span><span class="mate-fab__label">Mate AI</span>';
    document.body.appendChild(fab);
    wireFab();
    addTopbarButton();
    followKeyboard();
    var liftTimer = null;
    function liftSoon() {
      clearTimeout(liftTimer);
      liftTimer = setTimeout(liftFab, 120);
    }
    window.addEventListener('resize', liftSoon);
    window.addEventListener('scroll', liftSoon, { passive: true });
    setTimeout(liftFab, 600);
    setTimeout(liftFab, 2000);
  }

  async function loadAgentProfile() {
    try {
      var r = await api('GET', '/api/virtual-office/agents');
      agentProfile = (r.data || []).find(function (item) { return item.key === agentKey && item.enabled; }) || null;
      if (!agentProfile) throw new Error('Perfil indisponível');
      var name = String(agentProfile.name || 'Funcionária');
      var title = String(agentProfile.title || 'Funcionária virtual');
      var eyebrow = document.querySelector('.mate-ai-eyebrow');
      var heading = document.querySelector('.mate-ai-heading h1');
      var description = document.querySelector('.mate-ai-heading p:not(.mate-ai-eyebrow)');
      var mobileHeading = document.querySelector('.mobile-app-header__title');
      var headingBlock = document.querySelector('.mate-ai-heading > div');
      if (eyebrow) eyebrow.textContent = 'ObraMate · Escritório virtual';
      if (heading) heading.textContent = name;
      if (description) description.textContent = title + '. Escreva a tarefa que precisa. Ações que afetam clientes ou registros aparecem para sua revisão antes da confirmação.';
      if (mobileHeading) mobileHeading.textContent = name;
      if (headingBlock && !headingBlock.querySelector('.mate-agent-back')) {
        var back = document.createElement('a');
        back.className = 'mate-agent-back';
        back.href = 'escritorio-ia.html';
        back.textContent = '← Voltar ao escritório virtual';
        headingBlock.appendChild(back);
      }
      document.title = name + ' | Escritório ObraMate';
      var label = panel.querySelector('.mate-sr');
      if (label) label.textContent = 'Pedido para ' + name;
      inputEl.placeholder = 'Fale com ' + name + '…';
      headSubEl.textContent = title + ' · pode falar do seu jeito';
      panel.setAttribute('aria-label', 'Conversa com ' + name);
      try { window.dispatchEvent(new CustomEvent('mate:agent-profile', { detail: { agent: agentProfile } })); } catch (_) {}
    } catch (_) {
      agentUnavailable = true;
      inputEl.disabled = true;
      sendEl.disabled = true;
      var description = document.querySelector('.mate-ai-heading p:not(.mate-ai-eyebrow)');
      if (description) description.textContent = 'Este funcionário virtual está inativo ou indisponível. Volte ao escritório virtual para escolher outro.';
    }
  }

  function addTopbarButton() {
    var tries = 0;
    (function attempt() {
      var right = document.querySelector('#crmTopbar .crm-topbar__right');
      if (!right) {
        if (++tries < 20) setTimeout(attempt, 250);
        return;
      }
      if (document.getElementById('mateTopbarBtn')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'mateTopbarBtn';
      btn.className = 'mate-topbar-btn';
      btn.innerHTML = ICON.spark + '<span>Peça ao Mate…</span><kbd>' + (mac ? '⌘J' : 'Ctrl J') + '</kbd>';
      btn.addEventListener('click', function () {
        toggle();
      });
      right.insertBefore(btn, right.firstChild);
    })();
  }

  /** Phone: keep the sheet above the on-screen keyboard. */
  function followKeyboard() {
    var vv = window.visualViewport;
    if (!vv) return;
    function sync() {
      var covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      panel.style.setProperty('--mate-kb', covered + 'px');
      panel.style.setProperty('--mate-vh', vv.height + 'px');
    }
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
  }

  /* ───────── open / close ───────── */

  var lastFocus = null;

  function open(opts) {
    if (inlineHost) return;
    if (!state.open) {
      lastFocus = document.activeElement;
      if (!opts || !opts.keep) freshStart();
    }
    state.open = true;
    panel.classList.add('is-open');
    document.body.classList.add('mate-open');
    if (backdrop) backdrop.hidden = false;
    render();
    loadStart();
    if (!opts || opts.focus !== false) {
      setTimeout(function () {
        inputEl.focus();
      }, 40);
    }
  }

  function close() {
    if (inlineHost) return;
    state.open = false;
    panel.classList.remove('is-open');
    document.body.classList.remove('mate-open');
    if (backdrop) backdrop.hidden = true;
    stopVoice(true);
    var back = lastFocus && document.contains(lastFocus) ? lastFocus : fab;
    if (back && back.focus) back.focus();
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === 'j') {
      e.preventDefault();
      if (inlineHost) inputEl.focus();
      else toggle();
      return;
    }
    if (e.key === 'Escape' && state.open && !inlineHost && !e.defaultPrevented) {
      if (listening) stopVoice(true);
      else close();
    }
  });

  // The "Mate AI" item in the navigation opens the bar instead of leaving the page.
  document.addEventListener(
    'click',
    function (e) {
      if (inlineHost || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || panel.contains(a)) return;
      var href = a.getAttribute('href') || '';
      if (!/(^|\/)mate-ai(\.html)?([?#].*)?$/i.test(href)) return;
      e.preventDefault();
      open();
    },
    true,
  );

  /* ───────── start screen: context, suggestions, examples ───────── */

  async function loadStart() {
    var now = Date.now();
    if (state.ai === null) {
      api('GET', API.status)
        .then(function (s) {
          state.ai = Boolean(s.ai);
          if (!s.ai) headSubEl.textContent = 'Modo básico · IA não configurada';
          voiceMode = s.server_voice === false ? 'browser' : 'server';
        })
        .catch(function (err) {
          if (err && (err.status === 401 || err.status === 404)) hideAll();
        });
    }
    if (state.screen && !state.screenLabel) {
      api('GET', API.ctx + '?type=' + encodeURIComponent(state.screen.type) + '&id=' + encodeURIComponent(state.screen.id))
        .then(function (r) {
          if (r.screen) {
            state.screenLabel = r.screen.label;
            state.screenChips = r.suggestions || [];
          } else {
            state.screen = null;
          }
          renderContext();
          renderChips();
        })
        .catch(function () {});
    }
    if (!state.catalog) {
      var cached = load(KEY_CATALOG, null);
      if (cached && cached.at && now - cached.at < 10 * 60 * 1000 && cached.data) state.catalog = cached.data;
      else {
        state.catalog = { modules: [] };
        api('GET', API.catalog)
          .then(function (r) {
            state.catalog = r.data || { modules: [] };
            save(KEY_CATALOG, { at: Date.now(), data: state.catalog });
            if (!state.thread.length && state.view === 'thread') render();
          })
          .catch(function () {});
      }
    }
    if (!state.suggestions || now - state.suggestionsAt > 60000) {
      state.suggestionsAt = now;
      api('GET', API.sug)
        .then(function (r) {
          state.suggestions = r.data || [];
          if (!state.thread.length) render();
        })
        .catch(function () {
          state.suggestions = [];
        });
    }
  }

  function hideAll() {
    if (fab) fab.hidden = true;
    var tb = document.getElementById('mateTopbarBtn');
    if (tb) tb.hidden = true;
    if (!inlineHost) close();
  }

  function renderContext() {
    if (!state.screen || !state.screenLabel) {
      contextEl.hidden = true;
      return;
    }
    contextEl.hidden = false;
    contextEl.innerHTML = state.useScreen
      ? '<button type="button" class="mate-ctx-chip" data-mate="ctx-off" title="Não usar esta tela no pedido">' + esc(state.screenLabel) + '<span aria-hidden="true">×</span></button>'
      : '<button type="button" class="mate-ctx-chip is-off" data-mate="ctx-on" title="Usar esta tela no pedido">+ ' + esc(state.screenLabel) + '</button>';
  }

  /** Suggestions for the record on screen, while nothing is waiting for an answer. */
  function renderChips() {
    var chips = state.useScreen && state.screen && state.screenChips.length && !actionable() ? state.screenChips : [];
    chipsEl.innerHTML = chips
      .map(function (c) {
        return '<button type="button" class="mate-chip" data-mate="say" data-nav data-text="' + esc(c) + '">' + esc(c) + '</button>';
      })
      .join('');
    chipsEl.hidden = !chips.length;
  }

  /* ───────── start screen ───────── */

  function hiddenToday() {
    var h = loadLocal(KEY_HIDDEN, null);
    var day = new Date().toDateString();
    return h && h.day === day && Array.isArray(h.ids) ? h.ids : [];
  }

  function hideSuggestion(id) {
    var ids = hiddenToday();
    if (ids.indexOf(id) < 0) ids.push(id);
    saveLocal(KEY_HIDDEN, { day: new Date().toDateString(), ids: ids.slice(-50) });
  }

  /** What to do now: at most 3, minus the ones hidden today. */
  function todo() {
    var hidden = hiddenToday();
    return (state.suggestions || [])
      .map(function (s, i) {
        return { s: s, i: i };
      })
      .filter(function (x) {
        return hidden.indexOf(x.s.id) < 0;
      })
      .slice(0, MAX_TODO);
  }

  /** Field crew: the three things of the day, one tap each. */
  var FIELD_QUICK = [
    { label: 'Cheguei no job', text: 'Cheguei no job', detail: 'Marca a chegada com a sua localização' },
    { label: 'Lançar despesa com foto', camera: true, detail: 'Tire a foto do recibo e diga o valor' },
    { label: 'Terminar o dia', text: 'Terminar o dia', detail: 'Fecha o seu dia de trabalho' },
  ];

  function startHtml() {
    if (agentMode && agentUnavailable) {
      return '<div class="mate-start"><p class="mate-hello">Este funcionário está inativo ou indisponível. Volte ao escritório virtual para escolher outro.</p></div>';
    }
    var html = '<div class="mate-start">';
    var r = state.resume;
    if (r && Date.now() - (r.at || 0) < RESUME_MS) {
      var users = r.items.filter(function (m) {
        return m.role === 'user';
      });
      var last = users.length ? String(users[users.length - 1].text || '').replace(/^📷\s*/, '') : '';
      html +=
        '<button type="button" class="mate-resume" data-mate="resume" data-nav>' +
        '<span class="mate-resume__label">Continuar</span>' +
        '<span class="mate-resume__text">' + esc(last) + '</span>' +
        '<span class="mate-resume__when">' + esc(ago(r.at)) + '</span></button>';
    }
    var rows = agentMode ? [] : todo();
    if (!agentMode && isField && !rows.length) {
      html += '<h3>Para fazer agora</h3><div class="mate-rows">';
      FIELD_QUICK.forEach(function (q, i) {
        html +=
          '<button type="button" class="mate-row mate-row--accent" data-mate="field" data-nav data-i="' + i + '">' +
          '<span class="mate-row__body"><strong>' + esc(q.label) + '</strong><small>' + esc(q.detail) + '</small></span>' +
          '<span class="mate-row__go" aria-hidden="true">›</span></button>';
      });
      html += '</div>';
    } else if (rows.length) {
      html += '<h3>Para fazer agora</h3><div class="mate-rows">';
      rows.forEach(function (x) {
        var s = x.s;
        html +=
          '<div class="mate-row-wrap">' +
          '<button type="button" class="mate-row mate-row--' + esc(s.tone) + '" data-mate="sug" data-nav data-i="' + x.i + '">' +
          '<span class="mate-row__body"><strong>' + esc(s.title) + '</strong>' + (s.detail ? '<small>' + esc(s.detail) + '</small>' : '') + '</span>' +
          '<span class="mate-row__go">' + esc(s.run.label) + '</span></button>' +
          '<button type="button" class="mate-row__hide" data-mate="sug-hide" data-id="' + esc(s.id) + '" title="Esconder até amanhã" aria-label="Esconder até amanhã">' + ICON.close + '</button>' +
          '</div>';
      });
      html += '</div>';
    } else if (!agentMode && state.suggestions && !r) {
      html += '<p class="mate-empty">Nada urgente agora. Diga o que precisa ou toque no microfone.</p>';
    }
    var examples = agentMode ? agentProfile ? examplesForAgent(agentProfile) : [] : EXAMPLES;
    if (agentMode && !agentProfile) {
      html += '<p class="mate-hello">Carregando o perfil e as capacidades…</p></div>';
      return html;
    }
    if (agentMode) {
      var first = String(agentProfile.title || '').toLowerCase();
      html += '<div class="mate-agent-hello"><strong>' + esc(agentProfile.name) + '</strong><p>Oi! Aqui é ' + esc(agentProfile.name) + (first ? ', ' + esc(first) : '') + '. Pode falar comigo do seu jeito: um pedido, uma pergunta ou só um oi.</p></div>';
      examples = ['Tudo bem por aí?', 'O que tem na sua mesa hoje?'].concat(examples).slice(0, 6);
      html += '<h3>Puxe assunto</h3><div class="mate-rows">';
      examples.forEach(function (t) {
        html += '<button type="button" class="mate-row mate-row--example" data-mate="say" data-nav data-text="' + esc(t) + '"><span class="mate-row__body">' + esc(t) + '</span><span class="mate-row__go" aria-hidden="true">↵</span></button>';
      });
      html += '</div><p class="mate-hello">' + esc(agentProfile.name) + ' prepara a ação; você revisa e confirma antes de enviar.</p></div>';
      return html;
    }
    html += catalogHtml();
    return html + '</div>';
  }

  function catalogModules() {
    if (state.catalog && state.catalog.modules && state.catalog.modules.length) return state.catalog.modules;
    return [{ key: 'exemplos', label: 'Exemplos', items: EXAMPLES.map(function (t) { return { text: t }; }) }];
  }

  /** "O que posso pedir?": closed by default; open, it lists what can be asked, by module. */
  function catalogHtml() {
    var mods = catalogModules();
    var total = mods.reduce(function (n, m) {
      return n + m.items.length;
    }, 0);
    var html =
      '<div class="mate-catalog' + (state.showCatalog ? ' is-open' : '') + '">' +
      '<button type="button" class="mate-catalog__toggle" data-mate="catalog" data-nav aria-expanded="' + (state.showCatalog ? 'true' : 'false') + '">' +
      '<span>O que posso pedir?</span><small>' + total + ' exemplos</small><span class="mate-catalog__chev" aria-hidden="true">›</span></button>';
    if (state.showCatalog) {
      html += '<div class="mate-catalog__body">';
      mods.forEach(function (m) {
        var openM = state.openModule === m.key || mods.length === 1;
        html +=
          '<div class="mate-mod' + (openM ? ' is-open' : '') + '">' +
          '<button type="button" class="mate-mod__head" data-mate="module" data-key="' + esc(m.key) + '" data-nav aria-expanded="' + (openM ? 'true' : 'false') + '">' +
          '<span>' + esc(m.label) + '</span><small>' + m.items.length + '</small></button>';
        if (openM) {
          html += '<div class="mate-mod__items">';
          m.items.forEach(function (it) {
            html += '<button type="button" class="mate-ex" data-mate="fill" data-nav data-text="' + esc(it.text) + '">' + esc(it.text) + '</button>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '<p class="mate-hello">Toque num exemplo para editar e enviar. Eu preparo, você confirma: nada vai para o cliente sem o seu ok.</p></div>';
    }
    return html + '</div>';
  }

  /* ───────── history ───────── */

  function loadHistory() {
    var q = state.historyQ.trim();
    api('GET', API.convs + '?limit=50' + (q ? '&q=' + encodeURIComponent(q) : '') + (agentMode ? '&agent_key=' + encodeURIComponent(agentKey) : ''))
      .then(function (r) {
        state.history = (r.data || []).filter(function (conversation) { return !agentMode || conversation.agent_key === agentKey; });
        if (state.view === 'history') renderHistoryList();
      })
      .catch(function () {
        state.history = [];
        if (state.view === 'history') renderHistoryList();
      });
  }

  function dayLabel(iso) {
    var d = new Date(iso);
    var today = new Date();
    var y = new Date();
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Hoje';
    if (d.toDateString() === y.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function historyListHtml(list) {
    if (!list) return '<p class="mate-empty">Carregando…</p>';
    if (!list.length) return '<p class="mate-empty">' + (state.historyQ ? 'Nenhuma conversa com essa busca.' : 'Suas conversas com o Mate aparecem aqui.') + '</p>';
    var html = '';
    var current = '';
    list.forEach(function (c) {
      var day = dayLabel(c.updated_at);
      if (day !== current) {
        current = day;
        html += '<h3>' + esc(day) + '</h3>';
      }
      html +=
        '<button type="button" class="mate-conv" data-mate="conv-open" data-nav data-id="' + esc(c.id) + '">' +
        '<strong>' + esc(c.title) + '</strong>' +
        '<small>' + esc(c.outcome || (c.turns + (c.turns === 1 ? ' pedido' : ' pedidos'))) + ' · ' + esc(new Date(c.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) + '</small>' +
        '</button>';
    });
    return html;
  }

  function historyHtml() {
    return (
      '<div class="mate-hist">' +
      '<div class="mate-hist__top"><button type="button" class="mate-pal__link" data-mate="history-close">‹ Voltar</button>' +
      '<input class="mate-input mate-hist__q" id="mateHistQ" type="search" placeholder="Buscar nas conversas" value="' + esc(state.historyQ) + '" autocomplete="off"></div>' +
      '<div class="mate-hist__list" id="mateHistList">' + historyListHtml(state.history) + '</div></div>'
    );
  }

  function renderHistoryList() {
    var host = panel.querySelector('#mateHistList');
    if (host) host.innerHTML = historyListHtml(state.history);
  }

  function openHistory() {
    state.view = 'history';
    state.history = null;
    render();
    loadHistory();
    var q = panel.querySelector('#mateHistQ');
    if (q && !isPhone()) q.focus();
  }

  async function loadConversation(id) {
    try {
      var r = await api('GET', API.convs + '/' + encodeURIComponent(id) + (agentMode ? '?agent_key=' + encodeURIComponent(agentKey) : ''));
      if (hasAsk(state.thread) && state.convId !== id) syncServer();
      state.thread = revive(r.data.items || []).map(function (m) {
        if (m.kind === 'card' || m.kind === 'clarify') m.stale = true;
        return m;
      });
      state.convId = r.data.id;
      state.lastAt = Date.parse(r.data.updated_at) || Date.now();
      state.resume = null;
      state.view = 'thread';
      state.showHistory = true;
      state.screen = officeEntity(entityFromItems(state.thread)) || detectScreen();
      publishOfficeContext(entityFromItems(state.thread));
      if (!state.open && !inlineHost) open({ keep: true });
      render();
    } catch (err) {
      hint(err.message || 'Não consegui abrir a conversa.');
    }
  }

  /* ───────── typeahead ───────── */

  function catalogItems() {
    var out = [];
    catalogModules().forEach(function (m) {
      m.items.forEach(function (it) {
        out.push({ text: it.text, module: m.label, f: fold(it.text) });
      });
    });
    (state.screenChips || []).forEach(function (c) {
      out.push({ text: c, module: 'Esta tela', f: fold(c) });
    });
    return out;
  }

  /** Up to 3 phrases that start like what is being typed. */
  function updateAhead() {
    var q = fold(inputEl.value).trim();
    var words = q.split(/\s+/).filter(Boolean);
    if (q.length < 2 || state.busy || state.view !== 'thread' || actionable()) {
      state.typeahead = [];
      renderAhead();
      return;
    }
    var scored = [];
    catalogItems().forEach(function (it) {
      var tokens = it.f.split(/[^a-z0-9#$]+/).filter(Boolean);
      var hits = 0;
      words.forEach(function (w, i) {
        var last = i === words.length - 1;
        if (tokens.some(function (t) { return last ? t.indexOf(w) === 0 : t === w || t.indexOf(w) === 0; })) hits++;
      });
      if (hits === words.length && it.f !== q) scored.push({ it: it, score: (it.f.indexOf(q) === 0 ? 10 : 0) + hits - it.f.length / 200 });
    });
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    var seen = {};
    state.typeahead = scored
      .map(function (x) { return x.it; })
      .filter(function (it) {
        if (seen[it.f]) return false;
        seen[it.f] = true;
        return true;
      })
      .slice(0, 3);
    renderAhead();
  }

  function renderAhead() {
    var list = state.typeahead || [];
    aheadEl.hidden = !list.length;
    aheadEl.innerHTML = list
      .map(function (it, i) {
        return (
          '<button type="button" class="mate-ahead__item" role="option" data-mate="fill" data-nav data-text="' + esc(it.text) + '">' +
          '<span>' + esc(it.text) + '</span><small>' + esc(it.module) + (i === 0 && !isPhone() ? ' · Tab' : '') + '</small></button>'
        );
      })
      .join('');
  }

  function fillInput(text) {
    inputEl.value = text;
    autoGrow();
    state.typeahead = [];
    renderAhead();
    inputEl.focus();
    try {
      inputEl.setSelectionRange(text.length, text.length);
    } catch (_) {}
    hint('Ajuste o pedido e envie.');
  }

  /** The newest card waiting for a confirmation (Enter confirms it). */
  function actionable() {
    for (var i = state.thread.length - 1; i >= 0; i--) {
      var m = state.thread[i];
      if (m.role === 'user') return null;
      if (m.kind === 'card' && m.card && m.card.confirm && !m.stale && !m.canceled) return m;
    }
    return null;
  }

  function lastUserIndex() {
    for (var i = state.thread.length - 1; i >= 0; i--) if (state.thread[i].role === 'user') return i;
    return -1;
  }

  function renderKeys() {
    if (!keysEl) return;
    var a = actionable();
    var canEnter = a && !a.working && !(a.card.confirm.checkbox && !a.acked);
    var parts = [];
    if (canEnter) parts.push('<kbd>↵</kbd> ' + esc(a.card.confirm.label));
    else parts.push('<kbd>↵</kbd> enviar');
    if (state.thread.length) parts.push('<kbd>↑</kbd> repetir pedido');
    if (!inlineHost) parts.push('<kbd>esc</kbd> fechar');
    keysEl.innerHTML = parts.join('<span class="mate-dot-sep">·</span>');
  }

  function render() {
    renderContext();
    renderChips();
    renderKeys();
    var a = actionable();
    panel.classList.toggle('has-thread', state.thread.length > 0);
    panel.classList.toggle('has-card', Boolean(a));
    panel.classList.toggle('is-full', Boolean(a) || state.view === 'history');
    panel.classList.toggle('is-history', state.view === 'history');
    inputEl.placeholder = a
      ? 'Ou diga outra coisa…'
      : agentMode && agentProfile
        ? 'Fale com ' + agentProfile.name + '…'
        : isPhone()
          ? 'Peça ao Mate…'
          : 'Peça ao Mate… ex.: quote pro John, 1350 pés de madeira';
    if (a) {
      state.typeahead = [];
      renderAhead();
    }
    if (state.view === 'history') {
      threadEl.innerHTML = historyHtml();
      threadEl.scrollTop = 0;
      return;
    }
    if (!state.thread.length) {
      threadEl.innerHTML = startHtml();
      threadEl.scrollTop = 0;
      return;
    }
    // Only the current step is in view; earlier turns fold into "Conversa anterior".
    var lu = Math.max(0, lastUserIndex());
    var earlier = state.thread.slice(0, lu);
    var current = state.thread.slice(lu);
    var asks = earlier.filter(function (m) {
      return m.role === 'user';
    }).length;
    var html = '';
    if (earlier.length) {
      if (agentMode) {
        html += '<div class="mate-history mate-history--always">' + earlier.map(renderMsg).join('') + '</div>';
      } else {
        html +=
          '<button type="button" class="mate-history-toggle" data-mate="history" aria-expanded="' + (state.showHistory ? 'true' : 'false') + '">' +
          (state.showHistory ? 'Ocultar conversa anterior' : 'Conversa anterior · ' + asks + (asks === 1 ? ' pedido' : ' pedidos')) +
          '</button>';
        if (state.showHistory) html += '<div class="mate-history">' + earlier.map(renderMsg).join('') + '</div>';
      }
    }
    html += '<div class="mate-turn" id="mateTurn">' + current.map(renderMsg).join('') + '</div>';
    threadEl.innerHTML = html;
    requestAnimationFrame(function () {
      var turn = document.getElementById('mateTurn');
      if (!turn) return;
      // Keep the start of the current step visible; long answers scroll from there.
      threadEl.scrollTop = agentMode ? threadEl.scrollHeight : state.showHistory ? turn.offsetTop - 8 : 0;
    });
  }

  function renderMsg(m) {
    if (m.role === 'user') return '<div class="mate-msg mate-msg--user"><p class="mate-echo">' + esc(m.text) + '</p></div>';
    var inner = '';
    if (m.kind === 'thinking') inner = '<div class="mate-thinking" aria-label="Pensando"><i></i><i></i><i></i></div>';
    else if (m.kind === 'reply') inner = '<div class="mate-say">' + esc(m.message) + '</div>';
    else if (m.kind === 'error') inner = '<div class="mate-say mate-say--error">' + esc(m.message) + '</div>';
    else if (m.kind === 'clarify') inner = renderClarify(m);
    else if (m.kind === 'card' || m.kind === 'answer') inner = renderCard(m);
    else if (m.kind === 'done') inner = renderDone(m);
    return '<div class="mate-msg" data-id="' + esc(m.id) + '">' + inner + '</div>';
  }

  function editButton(m, edit, label) {
    if (!edit || m.stale || m.kind === 'answer') return '';
    return (
      '<button type="button" class="mate-edit" data-mate="edit" data-msg="' + esc(m.id) + '" data-edit="' + esc(JSON.stringify(edit)) + '" title="Alterar ' + esc(label) + '" aria-label="Alterar ' + esc(label) + '">' +
      ICON.edit +
      '</button>'
    );
  }

  function renderCard(m) {
    var c = m.card || {};
    var confirm = c.confirm;
    var isSend = confirm && confirm.tone === 'send';
    var html = '<article class="mate-card' + (isSend ? ' mate-card--send' : '') + (m.stale ? ' is-stale' : '') + '">';
    html += '<div class="mate-card__head"><h4 class="mate-card__title"><span>' + esc(c.title) + '</span>';
    if (c.badge) html += '<span class="mate-badge mate-badge--' + esc(c.badge.tone) + '">' + esc(c.badge.text) + '</span>';
    html += '</h4>' + (c.subtitle ? '<p class="mate-card__sub">' + esc(c.subtitle) + '</p>' : '') + '</div>';
    (c.sections || []).forEach(function (s) {
      html += '<div class="mate-sec">' + renderSection(m, s) + '</div>';
    });
    if (c.assumptions && c.assumptions.length) {
      html += '<div class="mate-assume">';
      c.assumptions.forEach(function (a) {
        html += '<span>Você disse “' + esc(a.said) + '” → <b>' + esc(a.chosen) + '</b></span>';
      });
      html += '</div>';
    }
    var links = (c.links || []).slice();
    if (links.length) {
      html += '<div class="mate-links">' + links.map(function (l) {
        return '<a href="' + esc(safeHref(l.href)) + '">' + esc(l.label) + '</a>';
      }).join('') + '</div>';
    }
    if (confirm && !m.stale) {
      html += '<div class="mate-actions">';
      if (confirm.checkbox) {
        html += '<label class="mate-check"><input type="checkbox" data-mate="ack" data-msg="' + esc(m.id) + '"' + (m.acked ? ' checked' : '') + '> ' + esc(confirm.checkbox) + '</label>';
      }
      html +=
        '<button type="button" class="mate-btn ' + (isSend ? 'mate-btn--send' : 'mate-btn--primary') + '" data-mate="confirm" data-msg="' + esc(m.id) + '"' +
        (confirm.checkbox && !m.acked ? ' disabled' : '') + (m.working || pickTotal(m) === 0 ? ' disabled' : '') + '>' +
        (m.working ? 'Fazendo…' : esc(confirm.label) + (actionable() === m ? '<kbd class="mate-btn__kbd" aria-hidden="true">↵</kbd>' : '')) + '</button>';
      if (c.open) html += '<a class="mate-btn mate-btn--ghost" href="' + esc(safeHref(c.open.href)) + '">' + esc(c.open.label) + '</a>';
      html += '<button type="button" class="mate-btn mate-btn--quiet" data-mate="cancel" data-msg="' + esc(m.id) + '">Cancelar</button>';
      html += '</div>';
    } else if (!confirm && c.open && !m.stale) {
      html += '<div class="mate-links"><a href="' + esc(safeHref(c.open.href)) + '">' + esc(c.open.label) + '</a></div>';
    }
    if (m.canceled) html += '<div class="mate-links"><span style="color:var(--mate-muted);font-size:12.5px">Cancelado.</span></div>';
    return html + '</article>';
  }

  function renderSection(m, s) {
    if (s.type === 'fields') {
      return '<dl class="mate-fields">' + (s.rows || []).map(function (r) {
        return '<dt>' + esc(r.label) + '</dt><dd><span>' + esc(r.value) + '</span>' + editButton(m, r.edit, r.label) + '</dd>';
      }).join('') + '</dl>';
    }
    if (s.type === 'table') {
      var align = s.align || [];
      var head = '<tr>' + (s.columns || []).map(function (c, i) {
        return '<th class="' + (align[i] === 'right' ? 'is-right' : '') + '">' + esc(c) + '</th>';
      }).join('') + '</tr>';
      var body = (s.rows || []).map(function (row, ri) {
        return '<tr>' + row.map(function (cell, ci) {
          var content = esc(cell);
          if (ci === 0 && s.notes && s.notes[ri]) content += '<span class="mate-table__note">' + esc(s.notes[ri]) + '</span>';
          if (s.edits && s.edits[ri] && ci === s.editColumn) {
            content = '<span class="mate-cell-edit">' + content + editButton(m, s.edits[ri], s.columns[ci]) + '</span>';
          }
          return '<td class="' + (align[ci] === 'right' ? 'is-right' : '') + '">' + content + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="mate-table-wrap"><table class="mate-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }
    if (s.type === 'totals') {
      return '<div class="mate-totals">' + (s.rows || []).map(function (r) {
        return '<div class="' + (r.strong ? 'is-strong' : '') + '"><span>' + esc(r.label) + '</span><span>' + esc(r.value) + '</span></div>';
      }).join('') + '</div>';
    }
    if (s.type === 'list') {
      var items = s.items || [];
      if (!items.length) return '<p class="mate-list__empty">' + esc(s.empty || 'Nada por aqui.') + '</p>';
      return '<ul class="mate-list">' + items.map(function (it, i) {
        var title = it.href ? '<a href="' + esc(safeHref(it.href)) + '">' + esc(it.title) + '</a>' : '<strong>' + esc(it.title) + '</strong>';
        var sub = [it.detail, it.meta].filter(Boolean).join(' · ');
        return (
          '<li><span class="mate-list__dot mate-list__dot--' + esc(it.tone || 'neutral') + '"></span>' +
          '<span class="mate-list__body">' + title + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
          (it.run && !m.stale ? '<button type="button" class="mate-btn mate-btn--ghost mate-btn--sm mate-row-run" data-mate="run" data-msg="' + esc(m.id) + '" data-row="' + i + '">' + esc(it.run.label) + '</button>' : '') +
          '</li>'
        );
      }).join('') + '</ul>';
    }
    if (s.type === 'pick') {
      var off = m.exclude || [];
      var items2 = s.items || [];
      var on = items2.filter(function (it) { return off.indexOf(it.id) < 0; }).length;
      return (
        '<div class="mate-pick__head"><span>' + on + ' de ' + items2.length + ' selecionados</span>' +
        (m.stale ? '' : '<button type="button" class="mate-pal__link" data-mate="pick-all" data-msg="' + esc(m.id) + '">' + (on === items2.length ? 'Desmarcar todos' : 'Marcar todos') + '</button>') +
        '</div><ul class="mate-pick">' +
        items2.map(function (it) {
          var checked = off.indexOf(it.id) < 0;
          return (
            '<li><label><input type="checkbox" data-mate="pick-item" data-msg="' + esc(m.id) + '" data-id="' + esc(it.id) + '"' + (checked ? ' checked' : '') + (m.stale ? ' disabled' : '') + '>' +
            '<span class="mate-list__dot mate-list__dot--' + esc(it.tone || 'neutral') + '"></span>' +
            '<span class="mate-list__body"><strong>' + esc(it.title) + '</strong>' + (it.detail || it.meta ? '<small>' + esc([it.detail, it.meta].filter(Boolean).join(' · ')) + '</small>' : '') + '</span></label></li>'
          );
        }).join('') +
        '</ul>'
      );
    }
    if (s.type === 'note') return '<p class="mate-note mate-note--' + esc(s.tone || 'neutral') + '">' + esc(s.text) + '</p>';
    return '';
  }

  function pickTotal(m) {
    var sec = ((m.card && m.card.sections) || []).find(function (x) { return x.type === 'pick'; });
    if (!sec) return null;
    var off = m.exclude || [];
    return (sec.items || []).filter(function (it) { return off.indexOf(it.id) < 0; }).length;
  }

  function renderClarify(m) {
    var c = m.clarify || {};
    var html = '<article class="mate-card' + (m.stale ? ' is-stale' : '') + '"><div class="mate-card__head"><h4 class="mate-card__title"><span>' + esc(c.question) + '</span></h4></div><div class="mate-sec">';
    if (!m.stale) {
      if (c.options && c.options.length) {
        html += '<div class="mate-choices">' + c.options.map(function (o, i) {
          return '<button type="button" class="mate-choice" data-mate="pick" data-msg="' + esc(m.id) + '" data-i="' + i + '"><strong>' + esc(o.label) + '</strong>' + (o.detail ? '<small>' + esc(o.detail) + '</small>' : '') + '</button>';
        }).join('') + '</div>';
      }
      if (c.search) {
        html +=
          '<form class="mate-search" data-mate="search" data-msg="' + esc(m.id) + '"><input class="mate-input" name="q" autocomplete="off" placeholder="' + esc(c.search.placeholder) + '">' +
          '<button class="mate-btn mate-btn--ghost" type="submit">OK</button></form>';
      }
    }
    return html + '</div></article>';
  }

  function renderDone(m) {
    var r = m.result || {};
    var html = '<article class="mate-card"><div class="mate-done"><span class="mate-done__icon">' + ICON.check + '</span><div class="mate-done__body">';
    html += '<strong>' + esc(r.title) + '</strong>' + (r.detail ? '<small>' + esc(r.detail) + '</small>' : '');
    html += '<div class="mate-done__row">';
    (r.links || []).forEach(function (l) {
      html += '<a class="mate-btn mate-btn--ghost mate-btn--sm" href="' + esc(safeHref(l.href)) + '"' + (/^https?:/i.test(l.href) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>';
    });
    if (m.undo && m.undo.token && Date.parse(m.undo.expires) > Date.now()) {
      var left = Math.max(0, Math.ceil((Date.parse(m.undo.expires) - Date.now()) / 1000));
      html += '<button type="button" class="mate-btn mate-btn--ghost mate-btn--sm" data-mate="undo" data-msg="' + esc(m.id) + '">Desfazer (' + left + ')</button>';
    }
    if (touchesScreen(r.entity)) {
      html += '<button type="button" class="mate-btn mate-btn--ghost mate-btn--sm" data-mate="reload">Atualizar tela</button>';
    }
    if (r.next && !m.nextUsed) {
      html += '<button type="button" class="mate-btn mate-btn--primary mate-btn--sm" data-mate="next" data-msg="' + esc(m.id) + '">' + esc(r.next.label) + '</button>';
    }
    html += '</div></div></div></article>';
    return html;
  }

  /* ───────── thread ops ───────── */

  function push(m) {
    m.id = m.id || uid();
    m.at = m.at || Date.now();
    state.lastAt = Date.now();
    state.thread.push(m);
    if (state.thread.length > MAX_THREAD) state.thread = state.thread.slice(-MAX_THREAD);
    persist();
    render();
    return m;
  }

  function replace(id, m) {
    var i = state.thread.findIndex(function (x) {
      return x.id === id;
    });
    if (i < 0) return push(m);
    m.id = id;
    m.at = Date.now();
    state.lastAt = Date.now();
    state.thread[i] = m;
    persist();
    render();
    return m;
  }

  function find(id) {
    return state.thread.find(function (x) {
      return x.id === id;
    });
  }

  /** Only the newest card/question is actionable. */
  function staleOpenCards() {
    state.thread.forEach(function (m) {
      if ((m.kind === 'card' || m.kind === 'clarify') && !m.stale) m.stale = true;
    });
  }

  function fromResponse(r) {
    if (r.type === 'reply') return { role: 'mate', kind: 'reply', message: r.message };
    if (r.type === 'error') return { role: 'mate', kind: 'error', message: r.message, action: r.action, args: r.args };
    if (r.type === 'clarify') return { role: 'mate', kind: 'clarify', action: r.action, args: r.args, clarify: r.clarify, message: r.message };
    return { role: 'mate', kind: r.type === 'answer' ? 'answer' : 'card', action: r.action, args: r.args, card: r.card, message: r.message };
  }

  function setBusy(on) {
    state.busy = on;
    sendEl.disabled = on || !inputEl.value.trim();
    inputEl.readOnly = on;
  }

  async function ask(text) {
    var t = String(text || '').trim();
    if (!t || state.busy) return;
    if (!state.open && !inlineHost) open({ focus: false });
    var pending = pendingForRequest();
    var photo = state.attachment || null;
    state.attachment = null;
    camEl.classList.remove('is-on');
    staleOpenCards();
    push({ role: 'user', text: (photo ? '📷 ' : '') + t });
    var thinking = push({ role: 'mate', kind: 'thinking' });
    inputEl.value = '';
    autoGrow();
    state.typeahead = [];
    renderAhead();
    setBusy(true);
    try {
      var r = await api('POST', API.act, { text: t, screen: screenForRequest(), memory: memory().slice(0, -1), pending: pending, attachment: photo || undefined, agent_key: agentMode ? agentKey : undefined });
      var m = fromResponse(r);
      replace(thinking.id, m);
      if (r.ai_error) {
        push({ role: 'mate', kind: 'error', message: 'A IA não respondeu (' + String(r.ai_error).slice(0, 220) + '). Usei a leitura básica. Só administradores veem este aviso.' });
      }
      if (r.message && m.kind !== 'reply' && m.kind !== 'error') hint(r.message);
    } catch (err) {
      replace(thinking.id, { role: 'mate', kind: 'error', message: err.message || 'Não consegui agora. Tente de novo.' });
    } finally {
      setBusy(false);
    }
  }

  /** Re-prepare without the AI: a choice, a card edit, a row action, a suggestion. */
  async function act(action, args, patch, replaceId) {
    if (state.busy) return;
    staleOpenCards();
    var placeholder = replaceId ? find(replaceId) : null;
    var thinking = placeholder ? placeholder : push({ role: 'mate', kind: 'thinking' });
    if (placeholder) {
      placeholder.working = true;
      render();
    }
    setBusy(true);
    try {
      var r = await api('POST', API.act, { action: action, args: args || {}, patch: patch || undefined, screen: screenForRequest(), agent_key: agentMode ? agentKey : undefined });
      replace(thinking.id, fromResponse(r));
    } catch (err) {
      replace(thinking.id, { role: 'mate', kind: 'error', message: err.message || 'Não consegui agora.' });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(m) {
    if (!m || !m.card || !m.card.confirm || m.working) return;
    m.working = true;
    render();
    try {
      var body = Object.assign({}, m.card.confirm.exec.body);
      if (m.exclude && m.exclude.length) body.exclude = m.exclude.slice();
      if (m.card.confirm.geo) body.geo = await whereAmI();
      var r = await api('POST', m.card.confirm.exec.endpoint, body);
      var res = r.result || {};
      var done = {
        role: 'mate',
        kind: 'done',
        result: res,
        undo: r.undo_token ? { token: r.undo_token, expires: r.undo_expires_at } : null,
      };
      if (res.entity && res.entity.id && res.entity.type) state.screen = officeEntity(res.entity);
      publishOfficeContext(res.entity || state.screen || entityFromItems(state.thread));
      replace(m.id, done);
      if (done.undo) tickUndo(done.id);
      handleClient(res.client);
      state.suggestionsAt = 0;
      try {
        window.dispatchEvent(new CustomEvent('mate:done', { detail: { result: res } }));
      } catch (_) {}
      if (isPhone() && !inlineHost && !(res.client && res.client.type !== 'copy')) {
        // Phone: back to the page; the result and "Desfazer" stay in a notice at the bottom.
        close();
        showToast(done);
        return;
      }
      if (state.open || inlineHost) inputEl.focus();
    } catch (err) {
      m.working = false;
      render();
      push({ role: 'mate', kind: 'error', message: err.message || 'Não foi possível concluir.' });
    }
  }

  /** Device location for field day start/finish; null when denied or slow. */
  function whereAmI() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 9000);
      navigator.geolocation.getCurrentPosition(
        function (p) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
        },
        function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    });
  }

  /** The confirmed action changed the record the user is looking at. */
  function touchesScreen(entity) {
    if (!entity || !state.screen) return false;
    var type = entity.type === 'work_order' ? 'job' : entity.type;
    return type === state.screen.type && entity.id === state.screen.id;
  }

  function handleClient(client) {
    if (!client) return;
    if (client.type === 'copy' && client.text) {
      try {
        navigator.clipboard.writeText(client.text);
        hint('Link copiado.');
      } catch (_) {}
    }
    if (client.type === 'open' && client.href) {
      setTimeout(function () {
        location.href = safeHref(client.href);
      }, 500);
      return;
    }
    if (client.type === 'quote_edit' && client.quote_id) {
      try {
        sessionStorage.setItem('mateAi.quoteEdit:' + client.quote_id, JSON.stringify({ ops: client.ops || {}, at: Date.now() }));
      } catch (_) {}
      setTimeout(function () {
        location.href = safeHref(client.href);
      }, 600);
    }
  }

  function tickUndo(id) {
    var timer = setInterval(function () {
      var m = find(id);
      if (!m || !m.undo || Date.parse(m.undo.expires) <= Date.now()) {
        if (m && m.undo) {
          m.undo = null;
          persist();
        }
        clearInterval(timer);
        render();
        return;
      }
      var btn = threadEl.querySelector('[data-mate="undo"][data-msg="' + id + '"]');
      if (btn) btn.textContent = 'Desfazer (' + Math.ceil((Date.parse(m.undo.expires) - Date.now()) / 1000) + ')';
    }, 1000);
  }

  async function undo(m) {
    if (!m || !m.undo) return;
    var token = m.undo.token;
    m.undo = null;
    render();
    try {
      var r = await api('POST', API.undo, { token: token });
      var result = r.result || {};
      if (result.entity && result.entity.id && result.entity.type) state.screen = officeEntity(result.entity);
      publishOfficeContext(result.entity || state.screen);
      push({ role: 'mate', kind: 'reply', message: (r.result && r.result.title) || 'Desfeito.' });
      if (m.result && touchesScreen(m.result.entity)) hint('Desfeito. Atualize a tela para ver.');
    } catch (err) {
      push({ role: 'mate', kind: 'error', message: err.message || 'Não foi possível desfazer.' });
    }
  }

  /* ───────── inline edits ───────── */

  function startEdit(btn) {
    var m = find(btn.getAttribute('data-msg'));
    var edit;
    try {
      edit = JSON.parse(btn.getAttribute('data-edit') || '{}');
    } catch (_) {
      return;
    }
    if (!m || !edit.path) return;
    var host = btn.parentElement;
    var field;
    if (edit.input === 'select') {
      field = document.createElement('select');
      (edit.options || []).forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (String(o.value) === String(edit.value)) opt.selected = true;
        field.appendChild(opt);
      });
    } else {
      field = document.createElement('input');
      field.type = edit.input === 'date' ? 'date' : edit.input === 'number' || edit.input === 'money' ? 'number' : 'text';
      if (field.type === 'number') {
        field.step = edit.input === 'money' ? '0.01' : 'any';
        field.min = '0';
        field.inputMode = 'decimal';
      }
      field.value = edit.value == null ? '' : String(edit.value);
    }
    field.className = 'mate-input';
    host.innerHTML = '';
    host.appendChild(field);
    field.focus();
    if (field.select) field.select();
    var doneOnce = false;
    function commit(save) {
      if (doneOnce) return;
      doneOnce = true;
      if (!save) {
        render();
        return;
      }
      var v = field.value;
      if (edit.input === 'number' || edit.input === 'money') v = v === '' ? null : Number(v);
      if (String(v == null ? '' : v) === String(edit.value == null ? '' : edit.value)) {
        render();
        return;
      }
      var patch = {};
      patch[edit.path] = v;
      act(m.action, m.args, patch, m.id);
    }
    field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commit(false);
      }
    });
    field.addEventListener('change', function () {
      if (edit.input === 'select' || edit.input === 'date') commit(true);
    });
    field.addEventListener('blur', function () {
      commit(true);
    });
  }

  /* ───────── events ───────── */

  panel.addEventListener('click', function (e) {
    var el = e.target.closest('[data-mate]');
    if (!el || !panel.contains(el)) return;
    var what = el.getAttribute('data-mate');
    var m = el.hasAttribute('data-msg') ? find(el.getAttribute('data-msg')) : null;
    if (what === 'close') close();
    else if (what === 'pick-all' && m) {
      var sec = (m.card.sections || []).find(function (x) { return x.type === 'pick'; });
      var allIds = sec ? sec.items.map(function (it) { return it.id; }) : [];
      m.exclude = (m.exclude || []).length ? [] : allIds;
      render();
    } else if (what === 'history') {
      state.showHistory = !state.showHistory;
      render();
    } else if (what === 'clear') {
      freshStart();
      render();
      loadStart();
      inputEl.focus();
    } else if (what === 'resume') resumeConversation();
    else if (what === 'history-open') openHistory();
    else if (what === 'history-close') {
      state.view = 'thread';
      render();
      inputEl.focus();
    } else if (what === 'conv-open') loadConversation(el.getAttribute('data-id'));
    else if (what === 'catalog') {
      state.showCatalog = !state.showCatalog;
      render();
      if (state.showCatalog) {
        var cat = panel.querySelector('.mate-catalog');
        if (cat && cat.scrollIntoView) cat.scrollIntoView({ block: 'nearest' });
      }
    } else if (what === 'module') {
      var key = el.getAttribute('data-key');
      state.openModule = state.openModule === key ? null : key;
      render();
      var head = panel.querySelector('[data-mate="module"][data-key="' + key + '"]');
      if (head) head.focus();
    } else if (what === 'fill') fillInput(el.getAttribute('data-text') || '');
    else if (what === 'sug-hide') {
      hideSuggestion(el.getAttribute('data-id'));
      render();
    } else if (what === 'field') {
      var q = FIELD_QUICK[Number(el.getAttribute('data-i'))];
      if (q && q.camera) camFile.click();
      else if (q) ask(q.text);
    } else if (what === 'say') ask(el.getAttribute('data-text'));
    else if (what === 'sug') {
      var s = (state.suggestions || [])[Number(el.getAttribute('data-i'))];
      if (s) {
        push({ role: 'user', text: s.title });
        act(s.run.action, s.run.args);
      }
    } else if (what === 'confirm') confirm(m);
    else if (what === 'cancel' && m) {
      m.stale = true;
      m.canceled = true;
      persist();
      render();
    } else if (what === 'edit') startEdit(el);
    else if (what === 'pick' && m) {
      var o = m.clarify.options[Number(el.getAttribute('data-i'))];
      if (o) {
        push({ role: 'user', text: o.label });
        act(m.action, m.args, o.patch);
      }
    } else if (what === 'run' && m) {
      var section = (m.card.sections || []).find(function (s) {
        return s.type === 'list';
      });
      var it = section && section.items[Number(el.getAttribute('data-row'))];
      if (it && it.run) {
        push({ role: 'user', text: it.run.label + ': ' + it.title });
        act(it.run.action, it.run.args);
      }
    } else if (what === 'undo') undo(m);
    else if (what === 'reload') location.reload();
    else if (what === 'next' && m && m.result && m.result.next) {
      m.nextUsed = true;
      push({ role: 'user', text: m.result.next.label });
      act(m.result.next.action, m.result.next.args);
    } else if (what === 'ctx-off' || what === 'ctx-on') {
      state.useScreen = what === 'ctx-on';
      renderContext();
      renderChips();
    }
  });

  panel.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-mate') === 'pick-item') {
      var pm = find(el.getAttribute('data-msg'));
      if (pm) {
        var id = el.getAttribute('data-id');
        pm.exclude = (pm.exclude || []).filter(function (x) { return x !== id; });
        if (!el.checked) pm.exclude.push(id);
        render();
      }
      return;
    }
    if (el && el.getAttribute && el.getAttribute('data-mate') === 'ack') {
      var m = find(el.getAttribute('data-msg'));
      if (m) {
        m.acked = el.checked;
        var btn = panel.querySelector('[data-mate="confirm"][data-msg="' + m.id + '"]');
        if (btn) btn.disabled = !el.checked;
        renderKeys();
      }
    }
  });

  panel.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-mate="search"]');
    if (!form) return;
    e.preventDefault();
    var m = find(form.getAttribute('data-msg'));
    var q = String(new FormData(form).get('q') || '').trim();
    if (!m || !q) return;
    var patch = {};
    patch[m.clarify.search.path] = q;
    (m.clarify.search.clear || []).forEach(function (p) {
      patch[p] = null;
    });
    push({ role: 'user', text: q });
    act(m.action, m.args, patch);
  });

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(140, inputEl.scrollHeight) + 'px';
    sendEl.disabled = state.busy || !inputEl.value.trim();
    panel.classList.toggle('has-text', Boolean(inputEl.value.trim()));
  }

  inputEl.addEventListener('input', function () {
    autoGrow();
    updateAhead();
  });

  var histTimer = null;
  panel.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'mateHistQ') return;
    state.historyQ = e.target.value;
    clearTimeout(histTimer);
    histTimer = setTimeout(loadHistory, 220);
  });
  inputEl.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    var empty = !inputEl.value.trim();
    if (e.key === 'Tab' && !e.shiftKey && state.typeahead && state.typeahead.length) {
      e.preventDefault();
      fillInput(state.typeahead[0].text);
      return;
    }
    if (e.key === 'Escape' && state.typeahead && state.typeahead.length) {
      e.preventDefault();
      e.stopPropagation();
      state.typeahead = [];
      renderAhead();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!empty) {
        ask(inputEl.value);
        return;
      }
      var a = actionable();
      if (a && !a.working && !(a.card.confirm.checkbox && !a.acked)) confirm(a);
      return;
    }
    if (e.key === 'ArrowUp' && empty) {
      var lu = lastUserIndex();
      if (lu >= 0) {
        e.preventDefault();
        inputEl.value = state.thread[lu].text || '';
        autoGrow();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
      return;
    }
    if (e.key === 'ArrowDown' && empty) {
      var first = panel.querySelector('[data-nav]');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Arrow keys move between suggestion rows; Up from the first row returns to the input.
  panel.addEventListener('keydown', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-nav')) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    var items = Array.prototype.slice.call(panel.querySelectorAll('[data-nav]'));
    var i = items.indexOf(el);
    e.preventDefault();
    if (e.key === 'ArrowUp' && i <= 0) inputEl.focus();
    else if (items[i + (e.key === 'ArrowDown' ? 1 : -1)]) items[i + (e.key === 'ArrowDown' ? 1 : -1)].focus();
  });
  sendEl.addEventListener('click', function () {
    ask(inputEl.value);
  });

  function hint(text, live) {
    hintEl.textContent = text || '';
    hintEl.classList.toggle('is-live', Boolean(live));
  }

  /* ───────── phone: result notice ───────── */

  var toastEl = null;
  var toastTimer = null;

  function showToast(m) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'mate-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
      toastEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-toast]');
        if (!b) return;
        var what = b.getAttribute('data-toast');
        var msg = find(toastEl.getAttribute('data-msg'));
        if (what === 'undo' && msg) {
          hideToast();
          undo(msg).then(function () {
            var last = state.thread[state.thread.length - 1];
            if (last && (last.kind === 'reply' || last.kind === 'error')) showNote(last.message, last.kind === 'error');
          });
        } else if (what === 'next' && msg && msg.result && msg.result.next) {
          hideToast();
          msg.nextUsed = true;
          open({ keep: true, focus: false });
          push({ role: 'user', text: msg.result.next.label });
          act(msg.result.next.action, msg.result.next.args);
        } else if (what === 'close') hideToast();
      });
    }
    var r = m.result || {};
    toastEl.setAttribute('data-msg', m.id);
    var links = (r.links || []).slice(0, 1).map(function (l) {
      return '<a href="' + esc(safeHref(l.href)) + '">' + esc(l.label) + '</a>';
    });
    var html =
      '<span class="mate-toast__icon">' + ICON.check + '</span>' +
      '<div class="mate-toast__body"><strong>' + esc(r.title) + '</strong>' + (r.detail ? '<small>' + esc(r.detail) + '</small>' : '') +
      '<div class="mate-toast__row">' + links.join('') +
      (m.undo ? '<button type="button" data-toast="undo">Desfazer (<span data-left>' + Math.max(0, Math.ceil((Date.parse(m.undo.expires) - Date.now()) / 1000)) + '</span>)</button>' : '') +
      (r.next ? '<button type="button" data-toast="next" class="is-primary">' + esc(r.next.label) + '</button>' : '') +
      '</div></div><button type="button" class="mate-toast__x" data-toast="close" aria-label="Fechar">' + ICON.close + '</button>';
    toastEl.innerHTML = html;
    toastEl.classList.add('is-on');
    liftFab();
    clearTimeout(toastTimer);
    var until = m.undo ? Date.parse(m.undo.expires) - Date.now() : r.next ? 15000 : 7000;
    var tick = setInterval(function () {
      var left = toastEl.querySelector('[data-left]');
      var mm = find(m.id);
      if (!left || !mm || !mm.undo) return clearInterval(tick);
      var secs = Math.ceil((Date.parse(mm.undo.expires) - Date.now()) / 1000);
      if (secs <= 0) {
        clearInterval(tick);
        var btn = toastEl.querySelector('[data-toast="undo"]');
        if (btn) btn.remove();
      } else left.textContent = secs;
    }, 1000);
    toastTimer = setTimeout(hideToast, Math.max(6000, until));
  }

  function showNote(text, bad) {
    if (!toastEl) return;
    toastEl.innerHTML = '<div class="mate-toast__body"><strong>' + esc(text || '') + '</strong></div><button type="button" class="mate-toast__x" data-toast="close" aria-label="Fechar">' + ICON.close + '</button>';
    toastEl.classList.toggle('is-bad', Boolean(bad));
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  function hideToast() {
    if (toastEl) toastEl.classList.remove('is-on', 'is-bad');
    clearTimeout(toastTimer);
    liftFab();
  }

  /** The floating button rises above bars fixed at the bottom of the page (save, totals, tabs). */
  function liftFab() {
    if (!fab || !document.elementsFromPoint) return;
    var lift = 0;
    var x = window.innerWidth - 36;
    var y = window.innerHeight - 6;
    var els = document.elementsFromPoint(x, y) || [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === fab || fab.contains(el) || el === toastEl || (toastEl && toastEl.contains(el)) || el === panel || panel.contains(el) || (backdrop && el === backdrop) || el === document.body || el === document.documentElement) continue;
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        var pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') {
          var rect = n.getBoundingClientRect();
          if (rect.height < window.innerHeight * 0.4) lift = Math.max(lift, window.innerHeight - rect.top);
          break;
        }
      }
    }
    if (toastEl && toastEl.classList.contains('is-on')) lift = Math.max(lift, window.innerHeight - toastEl.getBoundingClientRect().top);
    document.documentElement.style.setProperty('--mate-fab-lift', lift ? lift + 8 + 'px' : '0px');
  }

  /* ───────── photo ───────── */

  /** Shrinks a photo to 1600 px JPEG before it travels (receipts stay readable). */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Não consegui abrir a foto.'));
      };
      img.src = url;
    });
  }

  camEl.addEventListener('click', function () {
    if (state.attachment) {
      state.attachment = null;
      camEl.classList.remove('is-on');
      hint('Foto removida.');
      return;
    }
    camFile.click();
  });
  camFile.addEventListener('change', function () {
    var f = camFile.files && camFile.files[0];
    camFile.value = '';
    if (!f) return;
    shrink(f)
      .then(function (dataUrl) {
        state.attachment = dataUrl;
        camEl.classList.add('is-on');
        hint('Foto anexada. Diga o que fazer com ela (ex.: “lança esse recibo no job 1042”). Toque na câmera para tirar.');
        inputEl.focus();
      })
      .catch(function (err) {
        hint(err.message);
      });
  });

  /* ───────── voice ───────── */

  var canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var voiceMode = canRecord ? 'server' : SR ? 'browser' : 'none';
  var rec = null;
  var chunks = [];
  var stream = null;
  var recognition = null;
  var listening = false;
  var maxTimer = null;
  var finalText = '';
  var heard = false;

  function voiceLang() {
    try {
      var l = localStorage.getItem(KEY_LANG);
      if (l && /^(pt-BR|en-US|es-US)$/.test(l)) return l;
    } catch (_) {}
    var page = (document.documentElement.lang || '').toLowerCase();
    return page.indexOf('en') === 0 ? 'en-US' : page.indexOf('es') === 0 ? 'es-US' : 'pt-BR';
  }

  function setListening(on) {
    listening = on;
    micEl.classList.toggle('is-recording', on);
    micEl.innerHTML = on ? ICON.stop : ICON.mic;
    micEl.setAttribute('aria-label', on ? 'Parar e enviar' : 'Gravar pedido');
    if (fab) fab.classList.toggle('is-recording', on);
  }

  function pickMime() {
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < types.length; i++) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  async function startVoice() {
    if (listening) return;
    if (voiceMode === 'server' && canRecord) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_) {
        hint('O navegador bloqueou o microfone. Libere a permissão ou digite.');
        return;
      }
      var mime = pickMime();
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks = [];
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onstop = function () {
        if (stream) stream.getTracks().forEach(function (t) {
          t.stop();
        });
        clearTimeout(maxTimer);
        setListening(false);
        if (rec && rec.__discard) return;
        var blob = new Blob(chunks, { type: (rec && rec.mimeType) || 'audio/webm' });
        if (blob.size < 1200) {
          hint('Não ouvi nada. Fale perto do microfone e tente de novo.');
          return;
        }
        transcribe(blob);
      };
      rec.start();
      setListening(true);
      hint('Gravando… fale o pedido e toque em parar.', true);
      maxTimer = setTimeout(function () {
        stopVoice();
      }, 60000);
      return;
    }
    if (SR) {
      startBrowserVoice();
      return;
    }
    hint('Gravação de voz não disponível neste navegador. Digite o pedido.');
  }

  function stopVoice(discard) {
    if (!listening) return;
    if (rec && rec.state === 'recording') {
      rec.__discard = Boolean(discard);
      rec.stop();
    } else if (recognition) {
      recognition.__discard = Boolean(discard);
      recognition.stop();
    }
  }

  function transcribe(blob) {
    hint('Transcrevendo…', true);
    micEl.disabled = true;
    var reader = new FileReader();
    reader.onloadend = async function () {
      try {
        var r = await api('POST', API.transcribe, { data_url: reader.result, language: voiceLang().slice(0, 2) });
        hint('');
        ask(r.text);
      } catch (err) {
        if (err.data && err.data.fallback === 'browser' && SR) {
          voiceMode = 'browser';
          hint('Transcrição do servidor indisponível — usando a do navegador. Fale de novo.');
          startBrowserVoice();
        } else {
          hint(err.message || 'Não consegui transcrever. Tente de novo ou digite.');
        }
      } finally {
        micEl.disabled = false;
      }
    };
    reader.readAsDataURL(blob);
  }

  function startBrowserVoice() {
    if (!recognition) {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = function () {
        finalText = '';
        heard = false;
        recognition.__discard = false;
        setListening(true);
        hint('Ouvindo… toque em parar quando terminar.', true);
      };
      recognition.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var t = e.results[i][0] ? e.results[i][0].transcript : '';
          if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + t.trim();
          else interim += t;
        }
        var live = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
        if (live) {
          heard = true;
          inputEl.value = live;
          autoGrow();
        }
      };
      recognition.onerror = function (e) {
        if (e.error === 'no-speech') hint('Não ouvi nada. Tente de novo.');
        else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') hint('O navegador bloqueou o microfone.');
        else if (e.error !== 'aborted') hint('Não consegui transcrever (' + e.error + ').');
      };
      recognition.onend = function () {
        setListening(false);
        if (!recognition.__discard && heard && inputEl.value.trim()) {
          hint('');
          ask(inputEl.value);
        }
      };
    }
    recognition.lang = voiceLang();
    try {
      recognition.start();
    } catch (_) {}
  }

  if (voiceMode === 'none') {
    micEl.disabled = true;
    micEl.title = 'Voz indisponível neste navegador';
  }

  micEl.addEventListener('click', function () {
    if (listening) stopVoice();
    else startVoice();
  });

  /** Floating button: tap opens; press and hold talks (release sends). */
  function wireFab() {
    var holdTimer = null;
    var held = false;
    fab.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      held = false;
      holdTimer = setTimeout(function () {
        held = true;
        open({ focus: false });
        startVoice();
      }, 450);
    });
    function release() {
      clearTimeout(holdTimer);
      if (held) {
        setTimeout(function () {
          stopVoice();
        }, 250);
      }
    }
    fab.addEventListener('pointerup', release);
    fab.addEventListener('pointercancel', release);
    fab.addEventListener('pointerleave', function () {
      clearTimeout(holdTimer);
    });
    fab.addEventListener('click', function () {
      if (held) {
        held = false;
        return;
      }
      open();
    });
    fab.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }

  /* ───────── boot ───────── */

  window.MateAI = {
    open: open,
    close: close,
    ask: function (text) {
      open({ focus: false });
      ask(text);
    },
    fill: function (text) {
      if (!state.open && !inlineHost) open();
      fillInput(String(text || ''));
    },
    load: loadConversation,
    /** Prepare a suggestion's action as a card; nothing runs until the user confirms it. */
    run: function (action, args) {
      if (!action) return;
      if (!state.open && !inlineHost) open({ focus: false });
      act(String(action), args || {});
    },
    newConversation: function () {
      freshStart();
      render();
      loadStart();
      inputEl.focus();
    },
    current: function () {
      return state.convId;
    },
  };

  state.thread.forEach(function (m) {
    if (m.kind === 'done' && m.undo && Date.parse(m.undo.expires) > Date.now()) tickUndo(m.id);
    else if (m.kind === 'done' && m.undo) m.undo = null;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
