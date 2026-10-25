/**
 * "Ei, Mate" — hands-free wake phrase for the Mate AI.
 *
 * Cost: zero for ObraMate. The phrase is spotted by the browser's own speech recognition
 * (on the device when the browser offers it); nothing goes to our server until the
 * person says "Ei, Mate" and the request. Commands are then sent as text, so no audio
 * transcription is billed either.
 *
 * Flow: listening for the phrase → "Ei, Mate, cheguei" runs at once; "Ei, Mate" alone beeps
 * and listens to the request → the Mate answers out loud → after a card or a question the
 * next 8 s are heard without the phrase, so "pode" / "não" answer it.
 *
 * Limits: the page must be open with the screen on (the screen is kept awake while on).
 * On iPhone that means the ObraMate app open in front; with it closed only a native app could listen.
 */
(function () {
  if (window.__mateWake) return;
  window.__mateWake = true;

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var KEY_ON = 'mateAi.wake';
  var KEY_TIP = 'mateAi.wake.tip';
  var KEY_LANG = 'mateAiVoiceLang';
  var FOLLOW_MS = 8000;
  var COMMAND_MS = 9000;

  var isField = /\/campo\//.test(location.pathname);
  var state = {
    on: false,
    mode: 'idle', // idle = waiting for "Ei, Mate"; command = taking the request
    commandUntil: 0,
    rec: null,
    running: false,
    paused: false,
    speaking: false,
    restartTimer: 0,
    failures: 0,
    lock: null,
    pending: '',
    sentFor: '',
  };

  /* ───────── phrase spotting ───────── */

  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // How recognizers write "Ei, Mate" / "Hey Mate" / "Oye Mate" in pt, en and es.
  var MATE = '(?:mate|mati|matte|matt|mat|maite|meite|mache|mattie|matey)';
  var CALL_ANYWHERE = new RegExp('(?:^|\\s)(?:ei|hei|hey|hay|ey|oye|oi|ok)\\s+' + MATE + '(?:\\s|$)');
  var CALL_AT_START = new RegExp('^(?:e|a|ai|eh|he)\\s+' + MATE + '(?:\\s|$)');

  /** Returns the request after the phrase ('' when only the phrase was said), or null. */
  function afterCall(raw) {
    var n = norm(raw);
    var m = CALL_ANYWHERE.exec(n) || CALL_AT_START.exec(n);
    if (!m) return null;
    return n.slice(m.index + m[0].length).trim();
  }

  /** Keeps the person's own words (accents, numbers) after the phrase when possible. */
  function originalAfterCall(raw) {
    var words = String(raw || '').trim().split(/\s+/);
    for (var i = 0; i < words.length - 1; i++) {
      if (afterCall(words.slice(i, i + 2).join(' ')) !== null) return words.slice(i + 2).join(' ').replace(/^[,.!\s]+/, '');
    }
    return afterCall(raw) || '';
  }

  /* ───────── recognition ───────── */

  function lang() {
    try {
      var l = localStorage.getItem(KEY_LANG);
      if (l && /^(pt-BR|en-US|es-US)$/.test(l)) return l;
    } catch (_) {}
    var page = (document.documentElement.lang || '').toLowerCase();
    return page.indexOf('en') === 0 ? 'en-US' : page.indexOf('es') === 0 ? 'es-US' : 'pt-BR';
  }

  function panelBusy() {
    return Boolean(window.MateAI && window.MateAI.isListening && window.MateAI.isListening());
  }

  function canListen() {
    return state.on && !state.paused && !state.speaking && !document.hidden && !panelBusy();
  }

  function build() {
    var rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = function () {
      state.running = true;
      state.failures = 0;
      paint();
    };
    rec.onresult = onResult;
    rec.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setOn(false);
        tip('O navegador bloqueou o microfone. Libere a permissão para usar o "Ei, Mate".');
        return;
      }
      if (e.error !== 'no-speech' && e.error !== 'aborted') state.failures += 1;
    };
    rec.onend = function () {
      state.running = false;
      paint();
      scheduleRestart();
    };
    return rec;
  }

  function start() {
    if (!SR || !canListen() || state.running) return;
    clearTimeout(state.restartTimer);
    if (!state.rec) state.rec = build();
    state.rec.lang = lang();
    try {
      state.rec.start();
    } catch (_) {
      // Already starting, or the browser wants a tap first (some iPhones).
      state.failures += 1;
      paint();
    }
  }

  function stop() {
    clearTimeout(state.restartTimer);
    if (state.rec && state.running) {
      try {
        state.rec.abort();
      } catch (_) {}
    }
  }

  function scheduleRestart() {
    clearTimeout(state.restartTimer);
    if (!canListen()) return;
    var wait = state.failures > 3 ? Math.min(15000, 1000 * state.failures) : 250;
    state.restartTimer = setTimeout(start, wait);
  }

  function onResult(e) {
    var finalText = '';
    var interim = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      var t = e.results[i][0] ? e.results[i][0].transcript : '';
      if (e.results[i].isFinal) finalText += ' ' + t;
      else interim += ' ' + t;
    }
    finalText = finalText.trim();
    interim = interim.trim();
    var now = Date.now();

    if (state.mode === 'command' && now > state.commandUntil) setMode('idle');

    if (state.mode === 'command') {
      if (interim) paint(interim);
      if (finalText) {
        var cmd = afterCall(finalText) !== null ? originalAfterCall(finalText) : finalText;
        send(cmd);
      }
      return;
    }

    // Waiting for the phrase.
    var heard = finalText || interim;
    if (afterCall(heard) === null) return;
    if (!finalText) {
      // Show we heard the call; the request comes with the final result.
      paint(interim);
      return;
    }
    var request = originalAfterCall(finalText);
    if (request && request.replace(/\s/g, '').length >= 2) send(request);
    else {
      beep();
      setMode('command', COMMAND_MS);
    }
  }

  function send(text) {
    var t = String(text || '').trim();
    setMode('idle');
    if (!t) return;
    if (!window.MateAI || !window.MateAI.ask) return;
    // Recognizers can repeat the same final result; send it once.
    if (state.sentFor === t && Date.now() - (state.sentAt || 0) < 4000) return;
    state.sentFor = t;
    state.sentAt = Date.now();
    window.MateAI.ask(t, { voice: true });
  }

  function setMode(mode, ms) {
    state.mode = mode;
    state.commandUntil = mode === 'command' ? Date.now() + (ms || COMMAND_MS) : 0;
    paint();
  }

  /* ───────── sound and screen ───────── */

  var audioCtx = null;
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.2);
    } catch (_) {}
  }

  async function keepAwake(on) {
    try {
      if (on && !state.lock && navigator.wakeLock && !document.hidden) {
        state.lock = await navigator.wakeLock.request('screen');
        state.lock.addEventListener('release', function () {
          state.lock = null;
        });
      } else if (!on && state.lock) {
        await state.lock.release();
        state.lock = null;
      }
    } catch (_) {}
  }

  /* ───────── on / off ───────── */

  function setOn(on) {
    state.on = Boolean(on);
    try {
      localStorage.setItem(KEY_ON, state.on ? '1' : '0');
    } catch (_) {}
    if (state.on) {
      state.paused = false;
      state.failures = 0;
      keepAwake(true);
      start();
    } else {
      setMode('idle');
      stop();
      keepAwake(false);
    }
    paint();
  }

  // The Mate talking must not be heard as a request (echo), and the panel's own mic wins.
  window.addEventListener('mateai:speaking', function (e) {
    state.speaking = Boolean(e.detail && e.detail.on);
    if (state.speaking) stop();
    else scheduleRestart();
  });
  window.addEventListener('mateai:spoken', function (e) {
    state.speaking = false;
    if (state.on && e.detail && e.detail.listenAfter) setMode('command', FOLLOW_MS);
    scheduleRestart();
  });
  window.addEventListener('mateai:mic', function (e) {
    if (e.detail && e.detail.on) stop();
    else scheduleRestart();
  });
  document.addEventListener('visibilitychange', function () {
    if (!state.on) return;
    if (document.hidden) {
      stop();
    } else {
      keepAwake(true);
      scheduleRestart();
    }
  });

  /* ───────── indicator ───────── */

  var css =
    '.mate-wake{position:fixed;left:16px;bottom:calc(16px + var(--mate-fab-lift,0px) + env(safe-area-inset-bottom,0px));z-index:2147482990;display:flex;align-items:center;gap:8px;' +
    'padding:8px 12px 8px 10px;border-radius:999px;border:1px solid #E5E7EB;background:#fff;color:#221E1A;font:600 13px/1.2 Geist,system-ui,sans-serif;box-shadow:0 6px 20px rgba(17,24,39,.12);cursor:pointer}' +
    '.mate-wake[hidden]{display:none}' +
    '.mate-wake__dot{width:9px;height:9px;border-radius:50%;background:#98A2B3;flex:none}' +
    '.mate-wake.is-live .mate-wake__dot{background:#E7792C;animation:mateWakePulse 1.6s ease-in-out infinite}' +
    '.mate-wake.is-command{background:#221E1A;color:#fff;border-color:#221E1A}' +
    '.mate-wake.is-command .mate-wake__dot{background:#E7792C}' +
    '.mate-wake__live{max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;opacity:.8}' +
    '.mate-wake-tip{position:fixed;left:16px;right:16px;bottom:calc(64px + var(--mate-fab-lift,0px) + env(safe-area-inset-bottom,0px));z-index:2147482990;max-width:420px;padding:12px 14px;border-radius:14px;' +
    'background:#221E1A;color:#fff;font:400 14px/1.4 Geist,system-ui,sans-serif;box-shadow:0 10px 30px rgba(17,24,39,.25)}' +
    '.mate-wake-tip b{font-weight:600}.mate-wake-tip__row{display:flex;gap:8px;margin-top:10px}' +
    '.mate-wake-tip button{border:0;border-radius:10px;padding:8px 12px;font:600 13px Geist,system-ui,sans-serif;cursor:pointer}' +
    '.mate-wake-tip__yes{background:#E7792C;color:#fff}.mate-wake-tip__no{background:rgba(255,255,255,.12);color:#fff}' +
    '@media (max-width:719px){.mate-wake{bottom:calc(max(92px,var(--mate-fab-lift,0px)) + env(safe-area-inset-bottom,0px))}.mate-wake-tip{bottom:calc(max(140px,var(--mate-fab-lift,0px) + 48px) + env(safe-area-inset-bottom,0px))}}' +
    '@keyframes mateWakePulse{0%,100%{opacity:1}50%{opacity:.35}}' +
    '@media (prefers-reduced-motion:reduce){.mate-wake.is-live .mate-wake__dot{animation:none}}';

  var pill = null;
  var liveEl = null;
  var labelEl = null;

  function ensurePill() {
    if (pill || !document.body) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mate-wake';
    pill.hidden = true;
    pill.innerHTML = '<span class="mate-wake__dot" aria-hidden="true"></span><span class="mate-wake__label"></span><span class="mate-wake__live"></span>';
    labelEl = pill.querySelector('.mate-wake__label');
    liveEl = pill.querySelector('.mate-wake__live');
    pill.addEventListener('click', function () {
      // A tap also unlocks recognition on browsers that need a gesture.
      if (!state.running && state.on) {
        state.paused = false;
        state.failures = 0;
        start();
        return;
      }
      state.paused = !state.paused;
      if (state.paused) stop();
      else start();
      paint();
    });
    document.body.appendChild(pill);
  }

  function paint(live) {
    ensurePill();
    if (!pill) return;
    pill.hidden = !state.on;
    if (!state.on) return;
    var command = state.mode === 'command';
    pill.classList.toggle('is-live', state.running && !state.paused);
    pill.classList.toggle('is-command', command);
    var label = state.paused
      ? '"Ei, Mate" pausado · tocar para ouvir'
      : command
        ? 'Pode falar…'
        : state.running
          ? 'Diga "Ei, Mate"'
          : 'Tocar para ouvir';
    labelEl.textContent = label;
    liveEl.textContent = live && !state.paused ? live : '';
    pill.setAttribute('aria-label', label);
  }

  function tip(message, offer) {
    if (!document.body) return;
    var old = document.querySelector('.mate-wake-tip');
    if (old) old.remove();
    ensurePill();
    var el = document.createElement('div');
    el.className = 'mate-wake-tip';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div>' + message + '</div>' +
      (offer
        ? '<div class="mate-wake-tip__row"><button type="button" class="mate-wake-tip__yes">Ligar</button><button type="button" class="mate-wake-tip__no">Agora não</button></div>'
        : '');
    document.body.appendChild(el);
    var yes = el.querySelector('.mate-wake-tip__yes');
    var no = el.querySelector('.mate-wake-tip__no');
    if (yes) yes.addEventListener('click', function () {
      el.remove();
      setOn(true);
    });
    if (no) no.addEventListener('click', function () {
      el.remove();
    });
    if (!offer) setTimeout(function () {
      el.remove();
    }, 7000);
  }

  /* ───────── public API + start ───────── */

  window.MateWake = {
    supported: Boolean(SR),
    isOn: function () {
      return state.on;
    },
    toggle: function () {
      setOn(!state.on);
      return state.on;
    },
    setOn: setOn,
    /** For tests: what the spotter makes of a phrase. */
    parse: function (text) {
      var after = afterCall(text);
      return after === null ? null : originalAfterCall(text);
    },
  };

  function boot() {
    if (!SR) return;
    var saved = '0';
    try {
      saved = localStorage.getItem(KEY_ON) || '0';
    } catch (_) {}
    if (saved === '1') setOn(true);
    else if (isField) {
      // Field app: offer hands-free once.
      var shown = '0';
      try {
        shown = localStorage.getItem(KEY_TIP) || '0';
      } catch (_) {}
      if (shown !== '1') {
        try {
          localStorage.setItem(KEY_TIP, '1');
        } catch (_) {}
        setTimeout(function () {
          tip('<b>Mãos livres na obra:</b> diga "Ei, Mate" e o pedido, como "Ei, Mate, cheguei". Funciona com o app aberto e a tela ligada.', true);
        }, 1500);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
