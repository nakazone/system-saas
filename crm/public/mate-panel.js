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
  };
  var KEY_THREAD = 'mateAi.thread.v1';
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
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  var EXAMPLES = [
    'Criar um quote para o John Smith, 1350 pés de madeira',
    'O que tem amanhã?',
    'Quanto faturei este mês?',
    'Emitir a invoice do job 1042 para sexta',
    'Novo lead: Ana, 720 555 0101, trocar carpete',
    'Quem está me devendo?',
  ];

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
  };

  var today = new Date().toISOString().slice(0, 10);
  var saved = load(KEY_THREAD, null);
  if (saved && saved.day === today && Array.isArray(saved.items)) {
    state.thread = saved.items.filter(function (m) {
      return m && m.kind !== 'thinking';
    });
  }

  function persist() {
    var items = state.thread.slice(-MAX_THREAD).map(function (m) {
      // Confirmation tokens expire; keep only what is safe to show after a reload.
      if (m.kind === 'card' || m.kind === 'clarify') {
        var copy = Object.assign({}, m, { stale: true });
        return copy;
      }
      return m;
    });
    save(KEY_THREAD, { day: today, items: items });
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
    '<button type="button" class="mate-mic" id="mateMic" aria-label="Gravar pedido">' + ICON.mic + '</button>' +
    '<button type="button" class="mate-send" id="mateSend" aria-label="Enviar" disabled>' + ICON.send + '</button>' +
    (inlineHost ? '' : '<button type="button" class="mate-icon-btn mate-pal__close" data-mate="close" title="Fechar (Esc)" aria-label="Fechar">' + ICON.close + '</button>') +
    '</div>' +
    '<p class="mate-pal__hint" id="mateHint" aria-live="polite"></p>' +
    '<div class="mate-pal__chips" id="mateChips" hidden></div>' +
    '<div class="mate-pal__body" id="mateThread" aria-live="polite"></div>' +
    '<footer class="mate-pal__foot">' +
    '<span class="mate-pal__keys" id="mateKeys"></span>' +
    '<span class="mate-pal__mode" id="mateHeadSub"></span>' +
    '<button type="button" class="mate-pal__link" data-mate="clear">Nova conversa</button>' +
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

  // Short placeholder on phones, where the long example wraps.
  (function placeholder() {
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 719px)') : null;
    function set() {
      inputEl.placeholder = narrow && narrow.matches ? 'Peça ao Mate…' : 'Peça ao Mate… ex.: quote pro John, 1350 pés de madeira';
    }
    set();
    if (narrow && narrow.addEventListener) narrow.addEventListener('change', set);
  })();

  function mount() {
    if (inlineHost) {
      inlineHost.appendChild(panel);
      state.open = true;
      render();
      loadStart();
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
    if (!state.open) lastFocus = document.activeElement;
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

  function startHtml() {
    var html = '<div class="mate-start">';
    var sug = state.suggestions || [];
    if (sug.length) {
      html += '<h3>Para fazer agora</h3><div class="mate-rows">';
      sug.forEach(function (s, i) {
        html +=
          '<button type="button" class="mate-row mate-row--' + esc(s.tone) + '" data-mate="sug" data-nav data-i="' + i + '">' +
          '<span class="mate-row__body"><strong>' + esc(s.title) + '</strong>' + (s.detail ? '<small>' + esc(s.detail) + '</small>' : '') + '</span>' +
          '<span class="mate-row__go">' + esc(s.run.label) + '</span></button>';
      });
      html += '</div>';
    }
    html += '<h3>Experimente</h3><div class="mate-rows">';
    EXAMPLES.forEach(function (t) {
      html += '<button type="button" class="mate-row mate-row--example" data-mate="say" data-nav data-text="' + esc(t) + '"><span class="mate-row__body">' + esc(t) + '</span><span class="mate-row__go" aria-hidden="true">↵</span></button>';
    });
    html += '</div><p class="mate-hello">Eu preparo, você confirma — nada vai para o cliente sem o seu ok.</p></div>';
    return html;
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
    panel.classList.toggle('has-thread', state.thread.length > 0);
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
      html +=
        '<button type="button" class="mate-history-toggle" data-mate="history" aria-expanded="' + (state.showHistory ? 'true' : 'false') + '">' +
        (state.showHistory ? 'Ocultar conversa anterior' : 'Conversa anterior · ' + asks + (asks === 1 ? ' pedido' : ' pedidos')) +
        '</button>';
      if (state.showHistory) html += '<div class="mate-history">' + earlier.map(renderMsg).join('') + '</div>';
    }
    html += '<div class="mate-turn" id="mateTurn">' + current.map(renderMsg).join('') + '</div>';
    threadEl.innerHTML = html;
    requestAnimationFrame(function () {
      var turn = document.getElementById('mateTurn');
      if (!turn) return;
      // Keep the start of the current step visible; long answers scroll from there.
      threadEl.scrollTop = state.showHistory ? turn.offsetTop - 8 : 0;
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
        (confirm.checkbox && !m.acked ? ' disabled' : '') + (m.working ? ' disabled' : '') + '>' +
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
    if (s.type === 'note') return '<p class="mate-note mate-note--' + esc(s.tone || 'neutral') + '">' + esc(s.text) + '</p>';
    return '';
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
    staleOpenCards();
    push({ role: 'user', text: t });
    var thinking = push({ role: 'mate', kind: 'thinking' });
    inputEl.value = '';
    autoGrow();
    setBusy(true);
    try {
      var r = await api('POST', API.act, { text: t, screen: screenForRequest(), memory: memory().slice(0, -1), pending: pending });
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
      var r = await api('POST', API.act, { action: action, args: args || {}, patch: patch || undefined, screen: screenForRequest() });
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
      var r = await api('POST', m.card.confirm.exec.endpoint, m.card.confirm.exec.body);
      var res = r.result || {};
      var done = {
        role: 'mate',
        kind: 'done',
        result: res,
        undo: r.undo_token ? { token: r.undo_token, expires: r.undo_expires_at } : null,
      };
      replace(m.id, done);
      if (done.undo) tickUndo(done.id);
      handleClient(res.client);
      state.suggestionsAt = 0;
      if (state.open || inlineHost) inputEl.focus();
    } catch (err) {
      m.working = false;
      render();
      push({ role: 'mate', kind: 'error', message: err.message || 'Não foi possível concluir.' });
    }
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
    else if (what === 'history') {
      state.showHistory = !state.showHistory;
      render();
    } else if (what === 'clear') {
      state.showHistory = false;
      state.thread = [];
      persist();
      render();
      loadStart();
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
  }

  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    var empty = !inputEl.value.trim();
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
  };

  state.thread.forEach(function (m) {
    if (m.kind === 'done' && m.undo && Date.parse(m.undo.expires) > Date.now()) tickUndo(m.id);
    else if (m.kind === 'done' && m.undo) m.undo = null;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
