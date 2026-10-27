/**
 * Mate's face — the fox mascot as the face of Mate AI.
 *
 * One small module for every surface (team CRM, field app, public quote/invoice,
 * partner portal, login). Rule: Mate shows up where he talks or acts; he never
 * decorates lists, tables, forms or customer PDFs.
 *
 *   MateFace.face(state, { size, live, label })  → HTML of a round avatar
 *   MateFace.art(pose, { size, alt })             → HTML of a full-body pose
 *   MateFace.set(el, state)                       → change one avatar's expression
 *   MateFace.setLive(state)                       → change every live avatar (bar, FAB, pill)
 *   MateFace.celebrate({ key, title, detail, pose, action })
 *   MateFace.empty({ title, text, ask, askLabel, pose })  → HTML for an empty state where Mate offers help
 *   MateFace.footer({ href })                     → "Made with ObraMate" footer HTML (customer pages)
 *
 * States: neutral, listening, thinking, talking, happy, curious, sorry (an action failed).
 * Poses: wave, point, tablet, celebrate, reading, sleeping, thumbs, laptop, run, hero.
 * Assets live in /assets/img/mascot (served on every host).
 */
(function () {
  if (window.MateFace) return;

  var VER = '20261026-m1';
  var BASE = '/assets/img/mascot/';
  var STATES = ['neutral', 'listening', 'thinking', 'talking', 'happy', 'curious', 'sorry'];
  var POSES = ['wave', 'point', 'tablet', 'celebrate', 'reading', 'sleeping', 'thumbs', 'laptop', 'run', 'hero'];
  var REDUCED = false;
  try {
    REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  /* stylesheet next to this script (works from /, /campo/ and public pages) */
  (function css() {
    if (document.querySelector('link[data-mate-face-css]')) return;
    var me = document.currentScript && document.currentScript.src;
    var href = me ? me.replace(/mate-face\.js(\?.*)?$/, 'mate-face.css?v=' + VER) : '/mate-face.css?v=' + VER;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-mate-face-css', '');
    (document.head || document.documentElement).appendChild(l);
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(state) {
    return STATES.indexOf(state) >= 0 ? state : 'neutral';
  }

  function headSrc(state) {
    return BASE + 'mate-head-' + norm(state) + '.webp?v=' + VER;
  }

  function poseSrc(pose) {
    return BASE + 'mate-' + (POSES.indexOf(pose) >= 0 ? pose : 'thumbs') + '.webp?v=' + VER;
  }

  var preloaded = false;
  function preload() {
    if (preloaded) return;
    preloaded = true;
    var run = function () {
      STATES.forEach(function (s) {
        var i = new Image();
        i.decoding = 'async';
        i.src = headSrc(s);
      });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1200);
  }

  /** Round avatar. size: xs 20 · sm 24 · md 28 · lg 40 · xl 52 · hero 64 (px) or a number. */
  function face(state, opts) {
    opts = opts || {};
    var size = opts.size || 'md';
    var px = typeof size === 'number' ? size : { xs: 20, sm: 24, md: 28, lg: 40, xl: 52, hero: 64 }[size] || 28;
    var cls = 'mate-face' + (typeof size === 'string' ? ' mate-face--' + size : '') + (opts.ring ? ' mate-face--ring' : '') + (opts.className ? ' ' + opts.className : '');
    var st = norm(state);
    preload();
    return (
      '<span class="' + cls + '" data-mate-face' + (opts.live ? '="live"' : '') + ' data-state="' + st + '"' +
      (typeof size === 'number' ? ' style="--mate-face:' + px + 'px"' : '') +
      (opts.label ? ' role="img" aria-label="' + esc(opts.label) + '"' : ' aria-hidden="true"') + '>' +
      '<img src="' + headSrc(st) + '" alt="" width="' + px + '" height="' + px + '" decoding="async" draggable="false">' +
      '</span>'
    );
  }

  /** Full-body pose (transparent background). size: s 72 · m 96 · l 128 · xl 160 (height) or a number. */
  function art(pose, opts) {
    opts = opts || {};
    var size = opts.size || 'm';
    var h = typeof size === 'number' ? size : { xs: 48, s: 72, m: 96, l: 128, xl: 160 }[size] || 96;
    return (
      '<img class="mate-art mate-art--' + esc(pose) + (opts.className ? ' ' + esc(opts.className) : '') + '" src="' + poseSrc(pose) + '" alt="' + esc(opts.alt || '') + '"' +
      ' style="height:' + h + 'px" height="' + h + '" decoding="async" loading="' + (opts.eager ? 'eager' : 'lazy') + '" draggable="false">'
    );
  }

  /* ───────── expressions ───────── */

  var talkTimers = new WeakMap();

  function swap(el, src) {
    var img = el.querySelector('img');
    if (!img || img.getAttribute('src') === src) return;
    img.setAttribute('src', src);
  }

  function stopTalk(el) {
    var t = talkTimers.get(el);
    if (t) clearInterval(t);
    talkTimers.delete(el);
  }

  function set(el, state) {
    if (!el) return;
    var st = norm(state);
    stopTalk(el);
    el.setAttribute('data-state', st);
    swap(el, headSrc(st));
    // Talking = two frames (mouth open / closed), only while speaking.
    if (st === 'talking' && !REDUCED) {
      var open = true;
      talkTimers.set(
        el,
        setInterval(function () {
          if (!el.isConnected) return stopTalk(el);
          open = !open;
          swap(el, headSrc(open ? 'talking' : 'listening'));
        }, 190)
      );
    }
  }

  var liveState = 'neutral';
  var resetTimer = null;

  /** Every avatar marked live (bar, card head, FAB, wake pill). `ms` returns to neutral after a while. */
  function setLive(state, ms) {
    liveState = norm(state);
    clearTimeout(resetTimer);
    document.querySelectorAll('[data-mate-face="live"]').forEach(function (el) {
      set(el, liveState);
    });
    if (ms) {
      resetTimer = setTimeout(function () {
        setLive('neutral');
      }, ms);
    }
  }

  // Live avatars follow the panel's events (mate-panel.js dispatches these).
  var micOn = false;
  var speaking = false;
  window.addEventListener('mateai:mic', function (e) {
    micOn = Boolean(e.detail && e.detail.on);
    setLive(micOn ? 'listening' : speaking ? 'talking' : 'neutral');
  });
  window.addEventListener('mateai:speaking', function (e) {
    speaking = Boolean(e.detail && e.detail.on);
    setLive(speaking ? 'talking' : micOn ? 'listening' : 'neutral');
  });
  window.addEventListener('mateai:state', function (e) {
    var d = e.detail || {};
    if (speaking && d.state !== 'talking') return;
    setLive(d.state, d.ms);
  });

  /* ───────── celebrations (milestones) ───────── */

  var SEEN_KEY = 'mateFace.celebrated.v1';
  function seen() {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }
  function markSeen(key) {
    try {
      var s = seen();
      s[key] = Date.now();
      localStorage.setItem(SEEN_KEY, JSON.stringify(s));
    } catch (_) {}
  }
  function wasSeen(key) {
    return Boolean(key && seen()[key]);
  }

  var celebEl = null;
  var celebTimer = null;

  function closeCelebration() {
    if (!celebEl) return;
    celebEl.classList.remove('is-on');
    clearTimeout(celebTimer);
    var el = celebEl;
    setTimeout(function () {
      if (el && !el.classList.contains('is-on')) el.hidden = true;
    }, 260);
  }

  /** A small, once-only moment: Mate celebrates and leaves. Returns false when already seen. */
  function celebrate(o) {
    o = o || {};
    if (o.key && wasSeen(o.key)) return false;
    if (o.key) markSeen(o.key);
    if (!celebEl) {
      celebEl = document.createElement('div');
      celebEl.className = 'mate-celebrate';
      celebEl.setAttribute('role', 'status');
      celebEl.hidden = true;
      document.body.appendChild(celebEl);
      celebEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-celebrate]');
        if (!b) return;
        if (b.getAttribute('data-celebrate') === 'ask' && window.MateAI && typeof window.MateAI.ask === 'function') {
          window.MateAI.ask(b.getAttribute('data-ask') || '');
        }
        closeCelebration();
      });
    }
    var bits = '';
    if (!REDUCED) {
      for (var i = 0; i < 14; i++) bits += '<i style="--i:' + i + '"></i>';
    }
    var action = '';
    if (o.action && o.action.href) {
      action = '<a class="mate-celebrate__btn" href="' + esc(o.action.href) + '" data-celebrate="go">' + esc(o.action.label) + '</a>';
    } else if (o.action && o.action.ask) {
      action = '<button type="button" class="mate-celebrate__btn" data-celebrate="ask" data-ask="' + esc(o.action.ask) + '">' + esc(o.action.label) + '</button>';
    }
    celebEl.innerHTML =
      '<div class="mate-celebrate__bits" aria-hidden="true">' + bits + '</div>' +
      '<div class="mate-celebrate__art">' + art(o.pose || 'celebrate', { size: 'l', eager: true }) + '</div>' +
      '<div class="mate-celebrate__body"><strong>' + esc(o.title) + '</strong>' + (o.detail ? '<p>' + esc(o.detail) + '</p>' : '') +
      '<div class="mate-celebrate__row">' + action + '<button type="button" class="mate-celebrate__ok" data-celebrate="close">' + esc(o.closeLabel || 'Valeu, Mate') + '</button></div></div>' +
      '<button type="button" class="mate-celebrate__x" data-celebrate="close" aria-label="' + esc(o.closeAria || 'Fechar') + '">×</button>';
    celebEl.hidden = false;
    // next frame so the transition runs
    requestAnimationFrame(function () {
      celebEl.classList.add('is-on');
    });
    clearTimeout(celebTimer);
    celebTimer = setTimeout(closeCelebration, o.ms || 9000);
    return true;
  }

  /* ───────── empty state where Mate offers to do it ───────── */

  function empty(o) {
    o = o || {};
    return (
      '<div class="mate-empty">' +
      art(o.pose || 'point', { size: o.size || 's' }) +
      '<div class="mate-empty__body"><strong>' + esc(o.title || '') + '</strong>' +
      (o.text ? '<p>' + esc(o.text) + '</p>' : '') +
      (o.ask ? '<button type="button" class="mate-empty__ask" data-mate-ask="' + esc(o.ask) + '">' + face('neutral', { size: 'sm' }) + '<span>' + esc(o.askLabel || 'Pedir ao Mate') + '</span></button>' : '') +
      '</div></div>'
    );
  }

  // Any [data-mate-ask] button opens the Mate with that request (empty states, help, onboarding).
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mate-ask]');
    if (!b) return;
    var q = b.getAttribute('data-mate-ask');
    if (window.MateAI && typeof window.MateAI.ask === 'function') {
      e.preventDefault();
      window.MateAI.ask(q);
    }
  });

  /* ───────── customer-facing footer ───────── */

  function footer(o) {
    o = o || {};
    var href = o.href || 'https://obramate.com/?utm_source=customer_doc&utm_medium=footer';
    return (
      '<a class="mate-madewith" href="' + esc(href) + '" target="_blank" rel="noopener">' +
      face('happy', { size: 'sm' }) +
      '<span>' + esc(o.text || 'Made with ObraMate') + '</span></a>'
    );
  }

  window.MateFace = {
    version: VER,
    states: STATES.slice(),
    poses: POSES.slice(),
    headSrc: headSrc,
    poseSrc: poseSrc,
    face: face,
    art: art,
    set: set,
    setLive: setLive,
    liveState: function () {
      return liveState;
    },
    celebrate: celebrate,
    wasSeen: wasSeen,
    empty: empty,
    footer: footer,
    reducedMotion: REDUCED,
  };
  try {
    window.dispatchEvent(new CustomEvent('mateface:ready'));
  } catch (_) {}
})();
