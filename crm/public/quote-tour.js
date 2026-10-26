/**
 * Proposal tour — the animated walk-through the homeowner sees.
 * Used in person (Field Quote → "Apresentar ao cliente") and on the public quote link.
 *
 *   QuoteTour.open(tour, { onApprove, approveLabel, speak(text), stopSpeak(), onClose })
 *
 * `tour` comes from the server (src/lib/field-quote/tour.ts): rooms with their sizes and
 * share of the price, the material, the removal, the finishing details and the quote's
 * real totals. All client-facing text is English.
 */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = (n, cents) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TEXTURE = { lvp: 'lvp', solid_hardwood: 'wood', engineered_wood: 'wood', laminate: 'lam', tile: 'tile', carpet: 'carpet', other: 'lvp' };

  /** Lay the rooms out as a simple house: rows of rectangles sized in feet. */
  function layout(tour) {
    const rooms = tour.rooms.map((r, i) => {
      const a = Math.max(r.l, r.w);
      const b = Math.min(r.l, r.w);
      return { i, name: r.name, sqft: r.sqft, price: r.price, w: Math.max(a, 3), h: Math.max(b, 3) };
    });
    const order = rooms.slice().sort((x, y) => y.sqft - x.sqft);
    const total = rooms.reduce((s, r) => s + r.w * r.h, 0);
    const rowW = Math.max(order.length ? order[0].w : 10, Math.sqrt(total) * 1.45);
    let x = 0;
    let y = 0;
    let rowH = 0;
    order.forEach((r) => {
      if (x > 0 && x + r.w > rowW + 0.01) {
        y += rowH;
        x = 0;
        rowH = 0;
      }
      r.x = x;
      r.y = y;
      x += r.w;
      rowH = Math.max(rowH, r.h);
    });
    let bw = Math.max(...rooms.map((r) => r.x + r.w), 1);
    const bh = Math.max(...rooms.map((r) => r.y + r.h), 1);
    let stairs = null;
    if (tour.stairs > 0) {
      stairs = { x: bw, y: 0, w: Math.max(3.5, bw * 0.09), h: Math.min(bh, Math.max(8, tour.stairs * 0.9)) };
      bw += stairs.w;
    }
    // Doorways: midpoints of edges two rooms share.
    const doors = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const v = Math.abs(a.x + a.w - b.x) < 0.01 || Math.abs(b.x + b.w - a.x) < 0.01;
        const hz = Math.abs(a.y + a.h - b.y) < 0.01 || Math.abs(b.y + b.h - a.y) < 0.01;
        if (v) {
          const lo = Math.max(a.y, b.y);
          const hi = Math.min(a.y + a.h, b.y + b.h);
          if (hi - lo > 1.5) doors.push({ x: Math.abs(a.x + a.w - b.x) < 0.01 ? b.x : a.x, y: (lo + hi) / 2 });
        } else if (hz) {
          const lo = Math.max(a.x, b.x);
          const hi = Math.min(a.x + a.w, b.x + b.w);
          if (hi - lo > 1.5) doors.push({ x: (lo + hi) / 2, y: Math.abs(a.y + a.h - b.y) < 0.01 ? b.y : a.y });
        }
      }
    }
    const pct = (o) => `left:${(o.x / bw) * 100}%;top:${(o.y / bh) * 100}%;width:${(o.w / bw) * 100}%;height:${(o.h / bh) * 100}%`;
    return { rooms, stairs, doors: doors.slice(0, Math.max(tour.transitions || 0, 0)), bw, bh, pct, ppt: (p) => `left:${(p.x / bw) * 100}%;top:${(p.y / bh) * 100}%` };
  }

  function stepsFor(t) {
    const s = [{ id: 'home', name: 'Your home' }];
    if (t.removal) s.push({ id: 'removal', name: 'Out with the old' });
    if (t.floor) s.push({ id: 'floor', name: 'Your new floor' });
    if (t.refinish) s.push({ id: 'refinish', name: 'Refinished floors' });
    if (t.stairs || t.trim || t.transitions || (t.details && t.details.length)) s.push({ id: 'details', name: 'Finishing details' });
    s.push({ id: 'invest', name: 'Your investment' });
    s.push({ id: 'approve', name: 'Approve' });
    return s;
  }

  function sayFor(t, id) {
    const rooms = t.rooms.length;
    if (id === 'home') return `Hi ${t.client_first}! Here is your home as we measured it: ${rooms} room${rooms === 1 ? '' : 's'}${t.stairs ? ' and the stairs' : ''}, about ${fmt(t.sqft)} square feet.`;
    if (id === 'removal') return `First we take out the ${t.removal.existing.length ? t.removal.existing.join(' and ') : 'old flooring'} and clear it away.`;
    if (id === 'floor') return `Then the new ${t.floor.label.toLowerCase()} goes in, room by room. ${t.floor.note}`;
    if (id === 'refinish') return `${t.refinish.label}: we take the floors back to fresh wood and finish them so they look new again.`;
    if (id === 'details') return 'We finish the details too, so every edge and doorway looks clean.';
    if (id === 'invest') return `Your total is ${money(t.total, true)}, and here is exactly where it goes.`;
    return 'If everything looks right, you can approve and sign right here.';
  }

  const state = { t: null, opts: null, el: null, i: 0, playing: false, narr: false, timer: null, raf: null, keys: null };

  function texture(t, still) {
    const k = t.floor ? TEXTURE[t.floor.id] || 'lvp' : 'wood';
    return `qt-fl qt-fl--${k}${still ? ' is-still' : ''}`;
  }

  function stageHtml(id) {
    const t = state.t;
    const L = layout(t);
    const order = (r) => (L.rooms.indexOf(r) * 0.16).toFixed(2);
    const base = id !== 'home';
    const showOld = id === 'removal';
    const floorAnim = id === 'floor' || id === 'refinish';
    const floorStill = ['details', 'invest', 'approve'].includes(id) && (t.floor || t.refinish);
    const r = (L.bw / L.bh).toFixed(4);
    let h = `<div class="qt-plan" style="--r:${r};aspect-ratio:${r}">`;
    L.rooms.forEach((r) => {
      const pos = L.pct(r);
      const d = order(r);
      if (base) h += `<div class="qt-ab qt-sub" style="${pos}"></div>`;
      if (showOld) h += `<div class="qt-ab qt-old" style="${pos};animation-delay:${(0.7 + Number(d)).toFixed(2)}s"></div>`;
      if (floorAnim) h += `<div class="qt-ab ${id === 'refinish' && !t.floor ? 'qt-fl qt-fl--wood' : texture(t)}" style="${pos};animation-delay:${d}s">${id === 'refinish' ? `<i class="qt-sheen" style="animation-delay:${(Number(d) + 0.6).toFixed(2)}s"></i>` : ''}</div>`;
      if (floorStill) h += `<div class="qt-ab ${t.floor ? texture(t, true) : 'qt-fl qt-fl--wood is-still'}" style="${pos}"></div>`;
      h += `<div class="qt-ab qt-room${id === 'home' ? ' is-in' : ''}" style="${pos};animation-delay:${d}s"><span class="qt-room__lbl"><b>${esc(r.name)}</b>${id === 'home' ? `<small>${fmt(r.sqft)} sq ft</small>` : ''}</span></div>`;
      if (id === 'details' && t.trim) h += `<div class="qt-ab qt-trim" style="${pos};animation-delay:${d}s" aria-hidden="true"></div>`;
      if (id === 'invest' && r.price > 0) h += `<span class="qt-tag" style="left:${((r.x + r.w / 2) / L.bw) * 100}%;top:${((r.y + r.h / 2) / L.bh) * 100}%;animation-delay:${(0.3 + Number(d)).toFixed(2)}s">${money(r.price)}</span>`;
      if (id === 'approve') h += `<span class="qt-check" style="left:${((r.x + r.w / 2) / L.bw) * 100}%;top:${((r.y + r.h / 2) / L.bh) * 100}%;animation-delay:${d}s" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M5 12l5 5 9-10"/></svg></span>`;
    });
    if (L.stairs) {
      const pos = L.pct(L.stairs);
      if (showOld) h += `<div class="qt-ab qt-old" style="${pos};animation-delay:1.2s"></div>`;
      if (floorAnim || floorStill) h += `<div class="qt-ab ${t.floor ? texture(t, !floorAnim) : 'qt-fl qt-fl--wood is-still'}" style="${pos}"></div>`;
      h += `<div class="qt-ab qt-room qt-stairs${id === 'home' ? ' is-in' : ''}${id === 'details' ? ' is-lit' : ''}" style="${pos}"><span class="qt-room__lbl qt-room__lbl--v"><b>Stairs</b>${id === 'home' ? `<small>${t.stairs}</small>` : ''}</span></div>`;
    }
    if (id === 'details') L.doors.forEach((p, k) => (h += `<span class="qt-door" style="${L.ppt(p)};animation-delay:${(0.8 + k * 0.2).toFixed(2)}s" aria-hidden="true"></span>`));
    return h + '</div>';
  }

  function panelHtml(id) {
    const t = state.t;
    if (id === 'home') return `<p class="qt-p">We measured every room, ${t.stairs ? 'and the stairs, ' : ''}so the numbers you see are for your home.</p><div class="qt-big"><b>${fmt(t.sqft)}</b><span>sq ft${t.stairs ? ` + ${t.stairs} stair treads` : ''}</span></div>`;
    if (id === 'removal') return `<p class="qt-p">We remove the ${esc(t.removal.existing.join(', ') || 'old flooring')} from ${t.rooms.length === 1 ? 'the room' : 'every room in the scope'} and leave the subfloor clean and ready.</p>${t.categories.some((c) => c.label === 'Haul away') ? '<p class="qt-p">Everything we take out is hauled away.</p>' : ''}`;
    if (id === 'floor') return `<div class="qt-swatch ${texture(t, true)}" aria-hidden="true"></div><h3 class="qt-h3">${esc(t.floor.label)}</h3><p class="qt-p">${esc(t.floor.note)}</p>`;
    if (id === 'refinish') return `<div class="qt-swatch qt-fl qt-fl--wood is-still" aria-hidden="true"></div><h3 class="qt-h3">${esc(t.refinish.label)}</h3><p class="qt-p">Your existing wood floors, sanded and finished.</p>`;
    if (id === 'details') return `<div class="qt-list">${(t.details || []).map((d, k) => `<div class="qt-li" style="animation-delay:${(0.2 + k * 0.25).toFixed(2)}s"><span>${esc(d.label)}</span><b>${esc(d.value)}</b></div>`).join('')}</div>${t.transitions ? '<p class="qt-p qt-mut">Orange marks show the doorways.</p>' : ''}`;
    if (id === 'invest') {
      const max = Math.max(...t.categories.map((c) => c.amount), 1);
      return `<div class="qt-total"><b id="qtCount">${money(0, true)}</b>${t.per_sqft ? `<span>${money(t.per_sqft, true)} per sq ft · everything listed included</span>` : ''}</div>
        <div class="qt-bars">${t.categories.map((c, k) => `<div class="qt-barrow"><div class="qt-barrow__top"><span>${esc(c.label)}</span><b>${money(c.amount, true)}</b></div><div class="qt-track"><i style="width:${Math.max(2, Math.round((c.amount / max) * 100))}%;animation-delay:${(0.15 + k * 0.12).toFixed(2)}s"></i></div></div>`).join('')}</div>`;
    }
    return `<div class="qt-list">
        <div class="qt-li"><span>Total</span><b>${money(t.total, true)}</b></div>
        ${t.deposit ? `<div class="qt-li qt-li--hl"><span>${esc(t.deposit.label)}</span><b>${money(t.deposit.amount, true)}</b></div>` : ''}
        ${t.valid_until ? `<div class="qt-li"><span>Valid until</span><b>${esc(new Date(t.valid_until + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</b></div>` : ''}
      </div><p class="qt-p qt-mut">Approving lets ${esc(t.company)} reserve your dates. You'll get a signed copy.</p>`;
  }

  function countUp(to) {
    cancelAnimationFrame(state.raf);
    const el = document.getElementById('qtCount');
    if (!el) return;
    if (reduce()) {
      el.textContent = money(to, true);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 1300);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = money(to * e, true);
      if (p < 1) state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function render() {
    const t = state.t;
    const steps = stepsFor(t);
    state.i = Math.max(0, Math.min(steps.length - 1, state.i));
    const st = steps[state.i];
    const last = state.i === steps.length - 1;
    const say = sayFor(t, st.id);
    state.el.innerHTML = `
      <header class="qt-head">
        <span class="qt-logo" aria-hidden="true">${esc((t.company || 'F').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>
        <div class="qt-head__txt"><b>${esc(t.company)}</b><span>Proposal for ${esc(t.client_first)}${t.quote_number ? ' · ' + esc(t.quote_number) : ''}</span></div>
        <div class="qt-head__acts">
          <button type="button" class="qt-btn qt-btn--sm" data-qt-narr aria-pressed="${state.narr}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg><span>${state.narr ? 'Listening' : 'Listen'}</span></button>
          <button type="button" class="qt-btn qt-btn--sm qt-btn--ink" data-qt-play aria-pressed="${state.playing}">${state.playing ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg><span>Pause</span>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg><span>Play tour</span>'}</button>
          <button type="button" class="qt-x" data-qt-close aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
      </header>
      <nav class="qt-steps" aria-label="Proposal steps">${steps.map((s, k) => `<button type="button" class="qt-step${k === state.i ? ' is-on' : k < state.i ? ' is-done' : ''}" data-qt-go="${k}"><span class="qt-step__n">${k < state.i ? '✓' : k + 1}</span><span class="qt-step__name">${esc(s.name)}</span></button>`).join('')}</nav>
      <main class="qt-stage" aria-label="Your home">${stageHtml(st.id)}${state.narr ? `<p class="qt-say"><span class="qt-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${esc(say)}</p>` : ''}</main>
      <section class="qt-panel" aria-live="polite">
        <span class="qt-kicker">STEP ${state.i + 1} OF ${steps.length}</span>
        <h2 class="qt-h2">${esc(st.name)}</h2>
        <div class="qt-body">${panelHtml(st.id)}</div>
        <div class="qt-nav">
          ${state.i > 0 ? '<button type="button" class="qt-btn" data-qt-prev aria-label="Previous step"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' : ''}
          ${last ? `<button type="button" class="qt-btn qt-btn--pri" data-qt-approve>${esc(state.opts.approveLabel || 'Approve & sign')}</button>` : `<button type="button" class="qt-btn qt-btn--ink" data-qt-next>Next: ${esc(steps[state.i + 1].name)}</button>`}
        </div>
      </section>`;
    if (st.id === 'invest') countUp(t.total);
    if (state.narr && state.opts.speak) state.opts.speak(say);
  }

  function go(i) {
    if (state.opts.stopSpeak) state.opts.stopSpeak();
    state.i = i;
    render();
  }
  function stopPlay() {
    clearInterval(state.timer);
    state.playing = false;
  }
  function togglePlay() {
    if (state.playing) {
      stopPlay();
      return render();
    }
    const steps = stepsFor(state.t);
    if (state.i >= steps.length - 1) state.i = 0;
    state.playing = true;
    render();
    state.timer = setInterval(() => {
      const n = stepsFor(state.t).length;
      if (state.i >= n - 1) {
        stopPlay();
        return render();
      }
      go(state.i + 1);
    }, state.narr ? 9000 : 5500);
  }

  function onClick(ev) {
    const el = ev.target.closest('[data-qt-close],[data-qt-next],[data-qt-prev],[data-qt-go],[data-qt-play],[data-qt-narr],[data-qt-approve]');
    if (!el) return;
    if (el.hasAttribute('data-qt-close')) return close();
    if (el.hasAttribute('data-qt-play')) return togglePlay();
    if (el.hasAttribute('data-qt-narr')) {
      state.narr = !state.narr;
      if (!state.narr && state.opts.stopSpeak) state.opts.stopSpeak();
      if (state.playing) {
        stopPlay();
        state.playing = false;
      }
      return render();
    }
    if (el.hasAttribute('data-qt-approve')) {
      const cb = state.opts.onApprove;
      close();
      if (cb) cb();
      return;
    }
    stopPlay();
    if (el.hasAttribute('data-qt-next')) return go(state.i + 1);
    if (el.hasAttribute('data-qt-prev')) return go(state.i - 1);
    return go(Number(el.dataset.qtGo) || 0);
  }

  function open(tour, opts) {
    if (!tour || !Array.isArray(tour.rooms) || !tour.rooms.length) return false;
    close();
    state.t = tour;
    state.opts = opts || {};
    state.i = 0;
    state.narr = false;
    state.playing = false;
    const el = document.createElement('div');
    el.className = 'qt';
    // Client-facing and always English: keep the CRM translator out of it.
    el.setAttribute('data-no-i18n', '');
    el.setAttribute('translate', 'no');
    el.setAttribute('lang', 'en');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Your proposal');
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
    document.documentElement.classList.add('qt-open');
    state.el = el;
    state.keys = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && state.i < stepsFor(state.t).length - 1) { stopPlay(); go(state.i + 1); }
      else if (e.key === 'ArrowLeft' && state.i > 0) { stopPlay(); go(state.i - 1); }
    };
    document.addEventListener('keydown', state.keys);
    render();
    const first = el.querySelector('[data-qt-play]');
    if (first) first.focus();
    return true;
  }

  function close() {
    if (!state.el) return;
    stopPlay();
    cancelAnimationFrame(state.raf);
    if (state.opts && state.opts.stopSpeak) state.opts.stopSpeak();
    document.removeEventListener('keydown', state.keys);
    state.el.remove();
    state.el = null;
    document.documentElement.classList.remove('qt-open');
    const cb = state.opts && state.opts.onClose;
    if (cb) cb();
  }

  /** Browser voice, for pages without the server voice (public link). */
  function browserSpeak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }
  function browserStop() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  window.QuoteTour = { open, close, browserSpeak, browserStop };
})();
