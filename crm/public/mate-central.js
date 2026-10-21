/**
 * Mate AI page (Central do Mate): the bar in the middle, conversations on the left, what the
 * Mate did under the bar and the daily brief on the right. On phones the three parts are tabs.
 */
(function () {
  'use strict';
  var root = document.getElementById('mateCentral');
  if (!root) return;

  var convsEl = document.getElementById('mcConvs');
  var qEl = document.getElementById('mcQ');
  var actEl = document.getElementById('mcActivity');
  var briefForm = document.getElementById('mcBrief');
  var briefMsg = document.getElementById('mcBriefMsg');
  var hourEl = document.getElementById('mcHour');
  var todayEl = document.getElementById('mcTodayList');
  var convs = null;
  var activeId = null;

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
    if (/^[a-z0-9_-]+\.html(\?[^\s"'<>]*)?$/i.test(h)) return h;
    if (/^\/[a-z0-9_/-]+\.html(\?[^\s"'<>]*)?$/i.test(h) && h.indexOf('//') < 0) return h;
    if (/^\/api\/[a-z-]+\/[0-9a-f-]{36}\/(invoice-pdf|paper|pdf)$/i.test(h)) return h;
    return '';
  }

  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    var json = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || json.success === false) throw new Error(json.error || 'Erro ' + res.status);
    return json;
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

  function time(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ───────── tabs (phone) ───────── */

  function showTab(name) {
    root.setAttribute('data-tab', name);
    root.querySelectorAll('.mc-tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  root.setAttribute('data-tab', 'pedir');
  root.querySelector('.mc-tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.mc-tab');
    if (t) showTab(t.getAttribute('data-tab'));
  });

  /* ───────── conversations ───────── */

  function renderConvs() {
    if (!convs) return;
    var cur = window.MateAI && window.MateAI.current ? window.MateAI.current() : null;
    if (!convs.length) {
      convsEl.innerHTML = '<p class="mc-empty">' + (qEl.value.trim() ? 'Nenhuma conversa com essa busca.' : 'Suas conversas com o Mate aparecem aqui.') + '</p>';
      return;
    }
    var html = '';
    var day = '';
    convs.forEach(function (c) {
      var d = dayLabel(c.updated_at);
      if (d !== day) {
        day = d;
        html += '<h3>' + esc(d) + '</h3>';
      }
      html +=
        '<button type="button" class="mc-conv' + (c.id === cur || c.id === activeId ? ' is-on' : '') + '" data-id="' + esc(c.id) + '">' +
        '<strong>' + esc(c.title) + '</strong>' +
        '<small>' + esc(c.outcome || c.turns + (c.turns === 1 ? ' pedido' : ' pedidos')) + ' · ' + esc(time(c.updated_at)) + '</small></button>';
    });
    convsEl.innerHTML = html;
  }

  var qTimer = null;
  function loadConvs() {
    var q = qEl.value.trim();
    api('GET', '/api/mate-ai/conversations?limit=60' + (q ? '&q=' + encodeURIComponent(q) : ''))
      .then(function (r) {
        convs = r.data || [];
        renderConvs();
      })
      .catch(function () {
        convsEl.innerHTML = '<p class="mc-empty">Não consegui carregar as conversas.</p>';
      });
  }

  qEl.addEventListener('input', function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(loadConvs, 220);
  });

  convsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.mc-conv');
    if (!b || !window.MateAI) return;
    activeId = b.getAttribute('data-id');
    window.MateAI.load(activeId);
    renderConvs();
    showTab('pedir');
    var inline = document.getElementById('mateAiInline');
    if (inline && inline.scrollIntoView && window.innerWidth < 720) inline.scrollIntoView({ block: 'start' });
  });

  document.getElementById('mcNew').addEventListener('click', function () {
    if (!window.MateAI) return;
    activeId = null;
    window.MateAI.newConversation();
    renderConvs();
    showTab('pedir');
  });

  window.addEventListener('mate:saved', function () {
    loadConvs();
  });

  /* ───────── what the Mate did ───────── */

  function loadActivity() {
    api('GET', '/api/mate-ai/activity?days=2')
      .then(function (r) {
        var rows = r.data || [];
        if (!rows.length) {
          actEl.innerHTML = '<p class="mc-empty">Quando você confirmar algo pelo Mate, aparece aqui com o link para abrir.</p>';
          return;
        }
        var html = '';
        var day = '';
        rows.forEach(function (a) {
          var d = dayLabel(a.at);
          if (d !== day) {
            day = d;
            html += '<h3>' + esc(d) + '</h3>';
          }
          var href = a.open ? safeHref(a.open.href) : '';
          html +=
            '<div class="mc-act">' +
            '<span class="mc-act__time">' + esc(time(a.at)) + '</span>' +
            '<div class="mc-act__body"><strong>' + esc(a.title) + '</strong>' +
            '<small>' + esc([a.module, a.detail].filter(Boolean).join(' · ')) + '</small></div>' +
            (href ? '<a class="mc-link" href="' + esc(href) + '">' + esc(a.open.label || 'Abrir') + '</a>' : '') +
            '</div>';
        });
        actEl.innerHTML = html;
      })
      .catch(function () {
        actEl.innerHTML = '<p class="mc-empty">Não consegui carregar o que o Mate fez.</p>';
      });
  }

  window.addEventListener('mate:done', function () {
    setTimeout(loadActivity, 400);
  });

  /* ───────── daily brief ───────── */

  for (var h = 4; h <= 22; h++) {
    var o = document.createElement('option');
    o.value = String(h);
    o.textContent = h + 'h';
    hourEl.appendChild(o);
  }

  function fillBrief(data) {
    var p = data.prefs || { enabled: false, hour: 7, channels: ['push'] };
    briefForm.enabled.checked = Boolean(p.enabled);
    hourEl.value = String(p.hour);
    if (!hourEl.value) hourEl.value = '7';
    briefForm.push.checked = (p.channels || []).indexOf('push') >= 0;
    briefForm.email.checked = (p.channels || []).indexOf('email') >= 0;
    syncBriefState();
    if (data.preview) {
      todayEl.innerHTML = (data.preview.lines || [])
        .map(function (l) {
          return '<li>' + esc(l) + '</li>';
        })
        .join('');
    }
  }

  function syncBriefState() {
    briefForm.classList.toggle('is-off', !briefForm.enabled.checked);
  }

  function saveBrief() {
    var channels = [];
    if (briefForm.push.checked) channels.push('push');
    if (briefForm.email.checked) channels.push('email');
    if (!channels.length) {
      briefForm.push.checked = true;
      channels = ['push'];
    }
    syncBriefState();
    briefMsg.textContent = 'Salvando…';
    api('PUT', '/api/mate-ai/brief', { enabled: briefForm.enabled.checked, hour: Number(hourEl.value), channels: channels })
      .then(function () {
        briefMsg.textContent = briefForm.enabled.checked ? 'Ligado: todo dia às ' + hourEl.value + 'h.' : 'Desligado.';
      })
      .catch(function (err) {
        briefMsg.textContent = err.message || 'Não consegui salvar.';
      });
  }

  briefForm.addEventListener('change', saveBrief);
  briefForm.addEventListener('submit', function (e) {
    e.preventDefault();
  });

  api('GET', '/api/mate-ai/brief?preview=1')
    .then(function (r) {
      fillBrief(r.data || {});
    })
    .catch(function () {
      briefMsg.textContent = 'Não consegui carregar o resumo.';
    });

  loadConvs();
  loadActivity();
})();
