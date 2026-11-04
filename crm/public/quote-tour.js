/**
 * Proposal tour — the animated walk-through the homeowner sees.
 * Used in person (Field Quote → "Apresentar ao cliente") and on the public quote link.
 *
 *   QuoteTour.open(tour, { onApprove, approveLabel, speak(text), stopSpeak(), onClose })
 *
 * `tour` comes from the server (src/lib/field-quote/tour.ts): rooms with their sizes and
 * share of the price, the material, the removal, the finishing details and the quote's
 * real totals. All client-facing text is English.
 *
 * Tile visits bring showers (tour.showers): the tour draws each one unfolded — side walls,
 * back wall, floor and curb — and walks the client through it: measured, sealed and
 * flood-tested, then tiled with the niche, bench and trim.
 *
 * Countertops visits bring tops (tour.tops): each piece drawn from above, to scale — templated,
 * laid out on the slab and fabricated (polished edges, seams), then installed with the sink,
 * cooktop and backsplash.
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

  const showersOf = (t) => (Array.isArray(t.showers) ? t.showers : []);
  const roomsOf = (t) => (Array.isArray(t.rooms) ? t.rooms : []);
  const topsOf = (t) => (t.tops && Array.isArray(t.tops.pieces) && t.tops.pieces.length ? t.tops : null);

  function stepsFor(t) {
    const sh = showersOf(t).length;
    const s = roomsOf(t).length ? [{ id: 'home', name: 'Your home' }] : [];
    if (sh) {
      s.push({ id: 'shower', name: sh > 1 ? 'Your showers' : 'Your shower' });
      s.push({ id: 'shower_wp', name: 'Sealed & tested' });
      s.push({ id: 'shower_tile', name: 'Tile & details' });
    }
    if (topsOf(t)) {
      s.push({ id: 'tops', name: topsOf(t).pieces.length > 1 ? 'Your countertops' : 'Your countertop' });
      s.push({ id: 'tops_fab', name: 'Templated & fabricated' });
      s.push({ id: 'tops_install', name: 'Installed' });
    }
    if (t.removal) s.push({ id: 'removal', name: 'Out with the old' });
    if (t.floor) s.push({ id: 'floor', name: 'Your new floor' });
    if (t.refinish) s.push({ id: 'refinish', name: 'Refinished floors' });
    if (t.stairs || t.trim || t.transitions || (t.details && t.details.length)) s.push({ id: 'details', name: 'Finishing details' });
    s.push({ id: 'invest', name: 'Your investment' });
    s.push({ id: 'approve', name: 'Approve' });
    return s;
  }

  const SHAPE_SAY = { alcove: 'an alcove shower', corner: 'a corner shower', walkin: 'a walk-in shower' };
  const PAN_EN = { mortar: 'Mortar bed with liner', foam: 'Foam shower pan', prefab: 'Prefabricated base' };
  const DOOR_EN = { right: 'Door on the right', left: 'Door on the left', center: 'Door in the center', none: 'Open, no door' };
  const PATTERN_EN = { stacked: 'stacked', offset: 'offset', herringbone: 'herringbone' };
  const inch = (v) => `${fmt(v)}″`;
  function curShower(t) {
    const list = showersOf(t);
    state.sh = Math.max(0, Math.min(list.length - 1, state.sh || 0));
    return list[state.sh];
  }
  function sayShower(t, id) {
    const s = curShower(t);
    if (!s) return '';
    if (id === 'shower') return `${roomsOf(t).length ? 'And' : `Hi ${t.client_first}! Here is`} ${showersOf(t).length > 1 ? `${s.name}` : 'your shower'}: ${SHAPE_SAY[s.shape] || 'a shower'}, ${inch(s.width)} wide and ${inch(s.depth)} deep, tiled ${inch(s.height)} high.`;
    if (id === 'shower_wp') return `Before any tile goes up, we seal the walls, the floor${s.curb ? ', the curb' : ''}${s.niches ? ', the niche' : ''}${s.bench ? ' and the bench' : ''} with a waterproof membrane. ${s.pan !== 'prefab' ? 'Then we plug the drain and flood the floor to prove it holds water.' : ''}`;
    return `Then the tile goes in${s.wall_tile ? `: ${s.wall_tile} on the walls` : ''}${s.floor_tile ? ` and ${s.floor_tile} on the floor` : ''}${s.niches ? ', with the niche' : ''}${s.bench ? ' and the bench' : ''}, finished with clean edges.`;
  }

  const SINK_SAY = { undermount: 'undermount sink', farmhouse: 'farmhouse sink', dropin: 'drop-in sink' };
  function sayTops(t, id) {
    const c = topsOf(t);
    const n = c.pieces.length;
    const stone = [c.color, c.material].filter(Boolean).join(' ');
    if (id === 'tops') return `${roomsOf(t).length || showersOf(t).length ? 'And' : `Hi ${t.client_first}! Here are`} your ${n > 1 ? `${n} countertops` : 'countertop'} in ${stone || 'your stone'}, about ${fmt(c.sf)} square feet, measured on site.`;
    if (id === 'tops_fab') return `Once your cabinets are set, we template every top digitally, lay the pieces out on your slab for you to approve${c.seams ? ', seams included' : ''}, then cut and polish the ${c.edge_label.toLowerCase()}.`;
    const sinks = c.pieces.filter((p) => p.sink !== 'none').length;
    return `On install day the tops go in${sinks ? `, the ${sinks > 1 ? 'sinks are' : SINK_SAY[c.pieces.find((p) => p.sink !== 'none').sink] + ' is'} mounted` : ''}${c.splash !== 'none' ? ' and the backsplash goes on' : ''}. We give the silicone a day to cure before reconnecting the plumbing.`;
  }

  function sayFor(t, id) {
    if (id.startsWith('shower')) return sayShower(t, id);
    if (id.startsWith('tops')) return sayTops(t, id);
    const rooms = t.rooms.length;
    if (id === 'home') return `Hi ${t.client_first}! Here is your home as we measured it: ${rooms} room${rooms === 1 ? '' : 's'}${t.stairs ? ' and the stairs' : ''}, about ${fmt(t.sqft)} square feet.`;
    if (id === 'removal') return `First we take out the ${t.removal.existing.length ? t.removal.existing.join(' and ') : 'old flooring'} and clear it away.`;
    if (id === 'floor') return `Then the new ${t.floor.label.toLowerCase()} goes in, room by room. ${t.floor.note}`;
    if (id === 'refinish') return `${t.refinish.label}: we take the floors back to fresh wood and finish them so they look new again.`;
    if (id === 'details') return 'We finish the details too, so every edge and doorway looks clean.';
    if (id === 'home' && !rooms) return `Hi ${t.client_first}! Here is your proposal.`;
    if (id === 'invest') return `Your total is ${money(t.total, true)}, and here is exactly where it goes.`;
    return 'If everything looks right, you can approve and sign right here.';
  }

  const state = { t: null, opts: null, el: null, i: 0, playing: false, narr: false, timer: null, raf: null, keys: null, opt: null, sh: 0 };

  /** The tour as the client sees it right now: with Option A / B, the chosen option's floor and numbers. */
  function view() {
    const t = state.t;
    const o = t.options && t.options.find((x) => x.id === state.opt);
    if (!o) return t;
    return Object.assign({}, t, {
      floor: o.floor || t.floor,
      total: o.total,
      per_sqft: o.per_sqft,
      deposit: o.deposit,
      categories: o.categories,
      details: o.details,
      rooms: t.rooms.map((r, k) => Object.assign({}, r, { price: o.room_prices[k] != null ? o.room_prices[k] : r.price })),
      option_name: o.name,
    });
  }

  function texture(t0, still) {
    const t = t0 || view();
    const k = t.floor ? TEXTURE[t.floor.id] || 'lvp' : 'wood';
    return `qt-fl qt-fl--${k}${still ? ' is-still' : ''}`;
  }

  /**
   * The shower unfolded: left wall | back wall | right wall on top, the floor under the back
   * wall, the curb along the opening. To scale, in inches. Layers by step: outline (measured),
   * membrane + flood test (sealed), tile + niche + bench + trim (tiled).
   */
  function showerSvg(s, id) {
    const keys = (s.walls || []).map((w) => w.key);
    const hasL = keys.includes('left');
    const hasR = keys.includes('right');
    const W = Math.max(12, s.width), D = Math.max(12, s.depth), H = Math.max(24, s.height);
    const L = hasL ? D : 0;
    const TW = L + W + (hasR ? D : 0);
    const curbH = s.curb ? 6 : 0;
    const TH = H + D + curbH;
    const pad = Math.max(10, TW * 0.04);
    const fs = Math.max(5, Math.min(TW, TH) / 22);
    const wallR = { left: [0, 0, D, H], back: [L, 0, W, H], right: [L + W, 0, D, H] };
    const floorR = [L, H, W, D];
    const tiled = ['shower_tile', 'invest', 'approve'].includes(id);
    const sealed = id === 'shower_wp';
    const anim = (name, delay) => (reduce() ? '' : ` style="animation:${name} 1s cubic-bezier(.2,.7,.2,1) ${delay}s both"`);
    const rect = (r, extra) => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" ${extra}/>`;
    const tl = Math.max(4, s.tile_long || 12), th = tl / 2;
    const off = s.pattern === 'offset' || s.pattern === 'herringbone';
    let defs = `<pattern id="qtWt" width="${tl}" height="${th * (off ? 2 : 1)}" patternUnits="userSpaceOnUse"><rect width="${tl}" height="${th * (off ? 2 : 1)}" fill="#EEEAE3"/><path d="M0 0H${tl}M0 0V${th}" stroke="#C9C1B5" stroke-width="0.5" fill="none"/>${off ? `<path d="M0 ${th}H${tl}M${tl / 2} ${th}V${th * 2}" stroke="#C9C1B5" stroke-width="0.5" fill="none"/>` : ''}</pattern>`;
    defs += '<pattern id="qtFt" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#E2DDD5"/><path d="M0 0H3M0 0V3" stroke="#BDB4A7" stroke-width="0.35" fill="none"/></pattern>';
    defs += '<pattern id="qtMb" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#9DB3BF"/><path d="M0 0V6" stroke="#8AA3B1" stroke-width="1.4"/></pattern>';
    let g = '';
    // base: the bare walls and floor
    keys.forEach((k) => (g += rect(wallR[k], 'fill="#fff" stroke="#221E1A" stroke-width="1.2"')));
    g += rect(floorR, 'fill="#fff" stroke="#221E1A" stroke-width="1.2"');
    if (s.curb) g += rect([L, H + D, W, curbH], 'fill="#fff" stroke="#221E1A" stroke-width="1.2"');
    const layer = (fill, delay, cls) => {
      let h = `<g class="${cls}"${anim('qt-sweep', delay)}>`;
      keys.forEach((k) => (h += rect(wallR[k], `fill="${fill === 'tile' ? 'url(#qtWt)' : fill}"`)));
      h += rect(floorR, `fill="${fill === 'tile' ? 'url(#qtFt)' : fill}"`);
      if (s.curb) h += rect([L, H + D, W, curbH], `fill="${fill === 'tile' ? 'url(#qtWt)' : fill}"`);
      return h + '</g>';
    };
    if (sealed) g += layer('url(#qtMb)', 0.2, 'qt-sh-mb');
    if (tiled) g += layer('tile', id === 'shower_tile' ? 0.1 : 0, 'qt-sh-tile');
    // bench: front on its wall, top on the floor
    if (s.bench && keys.includes(s.bench_wall)) {
      const r = wallR[s.bench_wall];
      const len = Math.min(s.bench_l, r[2]);
      const x = s.bench_wall === 'left' ? r[0] + r[2] - len : r[0];
      const fill = tiled ? 'url(#qtWt)' : sealed ? '#8AA3B1' : '#EFEBE5';
      g += rect([x, H - s.bench_h, len, s.bench_h], `fill="${fill}" stroke="#221E1A" stroke-width="0.8"${tiled && id === 'shower_tile' ? anim('qt-pop', 0.9) : ''}`);
      const top = s.bench_wall === 'back' ? [L, H, Math.min(s.bench_l, W), s.bench_d] : s.bench_wall === 'left' ? [L, H, s.bench_d, Math.min(s.bench_l, D)] : [L + W - s.bench_d, H, s.bench_d, Math.min(s.bench_l, D)];
      g += rect(top, `fill="${tiled ? '#D9D2C7' : sealed ? '#8AA3B1' : '#EFEBE5'}" stroke="#221E1A" stroke-width="0.8"`);
      if (id === 'shower') g += `<text x="${top[0] + top[2] / 2}" y="${top[1] + top[3] / 2 + fs * 0.35}" font-size="${fs * 0.8}" text-anchor="middle" fill="#5B5246">Bench</text>`;
    }
    // niche(s): centered on their wall, bottom at 54″
    if (s.niches && keys.includes(s.niche_wall)) {
      const r = wallR[s.niche_wall];
      const nw = Math.min(s.niche_w, r[2] - 4), nh = s.niche_h, gap = 3;
      for (let k = 0; k < s.niches; k++) {
        const y = H - 54 - nh - k * (nh + gap);
        g += rect([r[0] + r[2] / 2 - nw / 2, Math.max(2, y), nw, nh], `fill="${tiled ? '#D9D2C7' : sealed ? '#7F98A6' : '#F7F5F1'}" stroke="${tiled ? '#B4561A' : '#221E1A'}" stroke-width="${tiled ? 1.4 : 0.8}"${id === 'shower_tile' ? anim('qt-pop', 1 + k * 0.2) : ''}`);
      }
    }
    // drain
    if (s.drain === 'linear') g += rect([L + W * 0.15, H + D - 5, W * 0.7, 2.2], 'fill="#8C857C" rx="1"');
    else g += `<circle cx="${L + W / 2}" cy="${H + D / 2}" r="${Math.max(2, W / 28)}" fill="#fff" stroke="#221E1A" stroke-width="0.9"/>`;
    // flood test: water over the floor
    if (sealed && s.pan !== 'prefab') g += rect([L + 1, H + 1, W - 2, D - 2], `fill="rgba(70,140,190,.38)" class="qt-sh-water"${reduce() ? '' : ' style="animation:qt-rise 1s ease-out 1.3s both"'}`);
    // trim: the open vertical edges
    if (tiled) {
      const edges = s.shape === 'corner' ? [L, L + W + D] : [0, TW];
      edges.forEach((x, k) => (g += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#E7792C" stroke-width="2.4"${id === 'shower_tile' ? anim('qt-pop', 1.4 + k * 0.15) : ''}/>`));
    }
    // outlines over the layers, so the walls stay readable
    keys.forEach((k) => (g += rect(wallR[k], 'fill="none" stroke="#221E1A" stroke-width="1.2"')));
    g += rect(floorR, 'fill="none" stroke="#221E1A" stroke-width="1.2"');
    if (s.curb) g += rect([L, H + D, W, curbH], 'fill="none" stroke="#221E1A" stroke-width="1.2"');
    // labels while measuring: under the niche on the walls; on the floor away from the drain
    if (id === 'shower') {
      const lbl = (x, y, txt, big) => `<text x="${x}" y="${y}" font-size="${big ? fs : fs * 0.8}" font-weight="${big ? 700 : 500}" text-anchor="middle" fill="${big ? '#221E1A' : '#475467'}">${esc(txt)}</text>`;
      keys.forEach((k) => {
        const r = wallR[k];
        const w = (s.walls || []).find((x) => x.key === k) || {};
        const y = H - 54 + fs * 1.6;
        g += lbl(r[0] + r[2] / 2, y, w.label || '', true) + lbl(r[0] + r[2] / 2, y + fs * 1.2, `${fmt(r[2])}″ × ${fmt(H)}″`);
      });
      const fx = L + W / 2 + (s.bench && s.bench_wall === 'left' ? s.bench_d / 2 : s.bench && s.bench_wall === 'right' ? -s.bench_d / 2 : 0);
      const fy = s.bench && s.bench_wall === 'back' ? H + s.bench_d : H;
      g += lbl(fx, fy + fs * 1.2, 'Floor', true) + (s.drain === 'linear' ? lbl(fx, fy + fs * 2.3, `${fmt(W)}″ × ${fmt(D)}″`) : lbl(fx, H + D - fs * 0.5, `${fmt(W)}″ × ${fmt(D)}″`));
      if (s.curb) g += lbl(L + W / 2, H + D + curbH + fs * 1.1, 'Curb');
      g += `<line x1="0" y1="${H - 72}" x2="${TW}" y2="${H - 72}" stroke="#536249" stroke-width="0.6" stroke-dasharray="3 3"/>`;
    }
    const vb = `${-pad} ${-pad} ${TW + pad * 2} ${TH + pad * 2 + (s.curb && id === 'shower' ? fs * 1.4 : 0)}`;
    const r = ((TW + pad * 2) / (TH + pad * 2)).toFixed(4);
    return `<div class="qt-shower" style="--r:${r};aspect-ratio:${r}"><svg viewBox="${vb}" width="100%" height="100%" role="img" aria-label="${esc(s.name)}, unfolded"><defs>${defs}</defs>${g}</svg>${['invest', 'approve'].includes(id) ? `<span class="qt-tag" style="left:50%;top:${((H + D / 2 + pad) / (TH + pad * 2)) * 100}%">${id === 'approve' ? '✓ ' : ''}${money(s.price)}</span>` : ''}</div>`;
  }

  /**
   * The countertops from above, to scale, in inches: wall runs and vanities on the first row(s),
   * islands below. Layers by step: the stone (measured), polished edges + seams + waterfalls
   * (fabricated), sink + cooktop + backsplash (installed), prices (investment).
   */
  function topsSvg(c, id) {
    const G = 18;
    const deep = (p) => p.depth + p.overhang;
    const order = c.pieces.map((p, i) => ({ p, i })).sort((a, b) => (a.p.kind === 'island') - (b.p.kind === 'island'));
    const rowW = Math.max(150, ...c.pieces.map((p) => p.length + (p.waterfall.left || p.waterfall.right ? 6 : 0)));
    let x = 0, y = 0, rowH = 0, prevIsland = null;
    const at = [];
    order.forEach(({ p, i }) => {
      const isl = p.kind === 'island';
      if ((x > 0 && x + p.length > rowW + 0.01) || (prevIsland !== null && prevIsland !== isl && x > 0)) {
        y += rowH + G + 14;
        x = 0;
        rowH = 0;
      }
      at[i] = { x, y };
      x += p.length + G;
      rowH = Math.max(rowH, deep(p));
      prevIsland = isl;
    });
    const TW = Math.max(...c.pieces.map((p, i) => at[i].x + p.length), 40);
    const TH = y + rowH + 14 + (['invest', 'approve'].includes(id) ? 8 : 0);
    const pad = Math.max(10, TW * 0.05);
    const fs = Math.max(5, Math.min(TW / 24, 9));
    const fab = ['tops_fab', 'tops_install', 'invest', 'approve'].includes(id);
    const inst = ['tops_install', 'invest', 'approve'].includes(id);
    const anim = (name, delay) => (reduce() ? '' : ` style="animation:${name} 1s cubic-bezier(.2,.7,.2,1) ${delay}s both"`);
    const defs = '<pattern id="qtStone" width="90" height="60" patternUnits="userSpaceOnUse"><rect width="90" height="60" fill="#F2EFEA"/><path d="M-5 48C18 30 30 52 52 30S80 18 96 8" stroke="#D2CCC3" stroke-width="1.1" fill="none"/><path d="M-4 12C12 20 26 6 44 16S70 40 94 34" stroke="#E0DBD3" stroke-width="0.7" fill="none"/></pattern>' +
      '<pattern id="qtWf" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#F2EFEA"/><path d="M0 0V4" stroke="#E7792C" stroke-width="1"/></pattern>';
    let g = '';
    const tags = [];
    order.forEach(({ p, i }, k) => {
      const ox = at[i].x, oy = at[i].y, w = p.length, h = deep(p), cab = p.depth;
      const d = (0.12 * k).toFixed(2);
      g += `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="#fff"/>`;
      g += `<g${anim('qt-sweep', d)}><rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="url(#qtStone)"/></g>`;
      g += `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="none" stroke="#221E1A" stroke-width="0.6"/>`;
      if (p.overhang) g += `<line x1="${ox}" y1="${oy + cab}" x2="${ox + w}" y2="${oy + cab}" stroke="#98A2B3" stroke-width="0.6" stroke-dasharray="3 3"/>`;
      if (inst && c.splash !== 'none') {
        const t2 = 2.5;
        if (p.splash.back) g += `<rect x="${ox}" y="${oy - t2}" width="${w}" height="${t2}" fill="#221E1A"${id === 'tops_install' ? anim('qt-sweep', 1.1) : ''}/>`;
        if (p.splash.left) g += `<rect x="${ox - t2}" y="${oy}" width="${t2}" height="${cab}" fill="#221E1A"/>`;
        if (p.splash.right) g += `<rect x="${ox + w}" y="${oy}" width="${t2}" height="${cab}" fill="#221E1A"/>`;
      }
      if (fab) {
        const e = (x1, y1, x2, y2, dl) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#E7792C" stroke-width="1.6" stroke-linecap="round"${id === 'tops_fab' ? anim('qt-pop', 0.5 + dl) : ''}/>`;
        if (p.edges.front) g += e(ox, oy + h, ox + w, oy + h, 0);
        if (p.edges.back) g += e(ox, oy, ox + w, oy, 0.1);
        if (p.edges.left && !p.waterfall.left) g += e(ox, oy, ox, oy + h, 0.2);
        if (p.edges.right && !p.waterfall.right) g += e(ox + w, oy, ox + w, oy + h, 0.2);
        if (p.waterfall.left) g += `<rect x="${ox - 5}" y="${oy}" width="4" height="${h}" fill="url(#qtWf)" stroke="#E7792C" stroke-width="0.8"/>`;
        if (p.waterfall.right) g += `<rect x="${ox + w + 1}" y="${oy}" width="4" height="${h}" fill="url(#qtWf)" stroke="#E7792C" stroke-width="0.8"/>`;
      }
      // sink, cooktop and holes
      const midY = oy + Math.min(cab, h) / 2;
      const sw = p.sink === 'farmhouse' ? 33 : p.kind === 'vanity' ? 19 : 30, sd = p.kind === 'vanity' ? 15 : 18;
      const sx = ox + (p.cooktop ? w * 0.28 : w / 2) - sw / 2;
      const keep = [];
      if (p.sink !== 'none') {
        keep.push([sx, sx + sw]);
        if (inst || fab) {
          const sy = p.sink === 'farmhouse' ? oy + h - sd : midY - sd / 2 + 2;
          g += `<rect x="${sx}" y="${sy}" width="${sw}" height="${sd}" rx="${p.sink === 'dropin' ? 2 : 4}" fill="${inst ? '#fff' : 'none'}" stroke="#221E1A" stroke-width="${inst ? 0.9 : 0.6}"${inst ? '' : ' stroke-dasharray="2 2"'}${id === 'tops_install' ? anim('qt-pop', 0.5) : ''}/>`;
          if (inst) for (let j = 0; j < p.faucet_holes; j++) g += `<circle cx="${sx + sw / 2 + (j - (p.faucet_holes - 1) / 2) * 3.2}" cy="${sy - 2.4}" r="0.9" fill="#221E1A"/>`;
        }
      }
      if (p.cooktop) {
        const cw = 30, cd = 20, cx = ox + w * (p.sink !== 'none' ? 0.72 : 0.5) - cw / 2, cy = midY - cd / 2;
        keep.push([cx, cx + cw]);
        if (inst || fab) {
          g += `<rect x="${cx}" y="${cy}" width="${cw}" height="${cd}" rx="1.5" fill="${inst ? '#2B2724' : 'none'}" stroke="#221E1A" stroke-width="0.7"${inst ? '' : ' stroke-dasharray="2 2"'}${id === 'tops_install' ? anim('qt-pop', 0.7) : ''}/>`;
          if (inst) [[0.28, 0.32], [0.72, 0.32], [0.28, 0.7], [0.72, 0.7]].forEach(([a, b]) => (g += `<circle cx="${cx + cw * a}" cy="${cy + cd * b}" r="3.2" fill="none" stroke="#8A817A" stroke-width="0.6"/>`));
        }
      }
      if (fab) {
        for (let j = 1; j <= p.seams; j++) {
          let sx2 = ox + (w * j) / (p.seams + 1);
          keep.forEach(([a, b]) => {
            if (sx2 > a - 3 && sx2 < b + 3) sx2 = b + 4 < ox + w - 6 ? b + 4 : a - 4;
          });
          g += `<line x1="${sx2}" y1="${oy}" x2="${sx2}" y2="${oy + h}" stroke="#536249" stroke-width="0.9" stroke-dasharray="3 2"${id === 'tops_fab' ? anim('qt-pop', 0.9) : ''}/>`;
        }
      }
      // name and size under the piece
      g += `<text x="${ox + w / 2}" y="${oy + h + fs * 1.3}" font-size="${fs}" font-weight="700" text-anchor="middle" fill="#221E1A">${esc(p.name)}</text>`;
      if (id === 'tops') g += `<text x="${ox + w / 2}" y="${oy + h + fs * 2.4}" font-size="${fs * 0.8}" text-anchor="middle" fill="#475467">${fmt(p.length)}″ × ${fmt(h)}″ · ${fmt(p.sf)} sq ft</text>`;
      // the price goes under the name, clear of the sink and cooktop
      if (['invest', 'approve'].includes(id)) tags.push({ x: ox + w / 2, y: oy + h + fs * 2.9, price: p.price });
    });
    const vbH = TH + pad * 2 + fs * 1.2;
    const vb = `${-pad} ${-pad} ${TW + pad * 2} ${vbH}`;
    const r = ((TW + pad * 2) / vbH).toFixed(4);
    const tagHtml = tags.map((tg) => `<span class="qt-tag" style="left:${((tg.x + pad) / (TW + pad * 2)) * 100}%;top:${((tg.y + pad) / vbH) * 100}%">${id === 'approve' ? '✓ ' : ''}${money(tg.price)}</span>`).join('');
    return `<div class="qt-shower qt-tops" style="--r:${r};aspect-ratio:${r}"><svg viewBox="${vb}" width="100%" height="100%" role="img" aria-label="Your countertops, from above"><defs>${defs}</defs>${g}</svg>${tagHtml}</div>`;
  }

  function stageHtml(id) {
    const t = view();
    if (id.startsWith('tops') || (!roomsOf(t).length && !showersOf(t).length && topsOf(t))) return topsSvg(topsOf(t), id);
    if (id.startsWith('shower') || (!roomsOf(t).length && showersOf(t).length)) return showerSvg(curShower(t), id);
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

  function optionPicker(t) {
    if (!state.t.options || state.t.options.length < 2) return '';
    return `<div class="qt-opts" role="radiogroup" aria-label="Choose your floor">${state.t.options
      .map((o) => `<button type="button" class="qt-opt${o.id === state.opt ? ' is-on' : ''}" role="radio" aria-checked="${o.id === state.opt}" data-qt-opt="${esc(o.id)}"><span class="qt-swatch qt-swatch--sm ${o.floor ? 'qt-fl qt-fl--' + (TEXTURE[o.floor.id] || 'lvp') + ' is-still' : 'qt-fl qt-fl--wood is-still'}" aria-hidden="true"></span><b>${esc(o.floor ? o.floor.label : o.name)}</b><span>${money(o.total)}</span></button>`)
      .join('')}</div>`;
  }
  function showerPicker(t) {
    const list = showersOf(t);
    if (list.length < 2) return '';
    return `<div class="qt-opts" role="radiogroup" aria-label="Choose a shower">${list
      .map((s, k) => `<button type="button" class="qt-opt${k === state.sh ? ' is-on' : ''}" role="radio" aria-checked="${k === state.sh}" data-qt-sh="${k}"><b>${esc(s.name)}</b><span>${money(s.price)}</span></button>`)
      .join('')}</div>`;
  }
  function showerPanel(t, id) {
    const s = curShower(t);
    const li = (a, b, k) => `<div class="qt-li" style="animation-delay:${(0.15 + (k || 0) * 0.2).toFixed(2)}s"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;
    const head = `${showerPicker(t)}${showersOf(t).length > 1 ? `<h3 class="qt-h3">${esc(s.name)}</h3>` : ''}`;
    if (id === 'shower') {
      return `${head}<p class="qt-p">${esc(s.shape_label)} shower, ${inch(s.width)} wide × ${inch(s.depth)} deep, tiled ${inch(s.height)} high — measured on site, drawn to scale.</p>
        <div class="qt-big"><b>${fmt(s.wall_sf)}</b><span>sq ft of wall tile + ${fmt(s.floor_sf)} sq ft of floor</span></div>
        <div class="qt-list">${[s.niches ? li(s.niches > 1 ? `${s.niches} niches` : 'Niche', `${inch(s.niche_w)} × ${inch(s.niche_h)}`, 0) : '', s.bench ? li('Bench', `${inch(s.bench_l)} × ${inch(s.bench_d)}`, 1) : '', li(s.curb ? 'Curb' : 'Curbless entry', s.curb ? `${inch(s.width)} long` : 'Flush', 2), li('Glass', DOOR_EN[s.door] || 'Door', 3)].join('')}</div>
        <p class="qt-p qt-mut">The dashed line is 72″ above the drain, the minimum tiled height.</p>`;
    }
    if (id === 'shower_wp') {
      return `${head}<p class="qt-p">A shower has to hold water. Before any tile, every surface that gets wet is sealed with a waterproof membrane${s.pan !== 'prefab' ? ', and the floor is flood-tested: we plug the drain, fill it and check it holds' : ''}.</p>
        <div class="qt-big"><b>${fmt(s.waterproofing_sf)}</b><span>sq ft sealed</span></div>
        <div class="qt-list">${li('Shower pan', PAN_EN[s.pan] || 'Shower pan', 0)}${li('Drain', s.drain === 'linear' ? 'Linear drain' : 'Center drain', 1)}${s.pan !== 'prefab' ? li('Flood test', 'Before tile, with photos', 2) : ''}</div>`;
    }
    return `${head}<div class="qt-list">${li('Wall tile', `${s.wall_tile || 'Your selection'}${s.pattern && s.pattern !== 'stacked' ? ` · ${PATTERN_EN[s.pattern]}` : ''}`, 0)}${li('Floor tile', s.floor_tile || 'Your selection', 1)}${s.niches ? li(s.niches > 1 ? 'Niches' : 'Niche', 'Tiled and sealed', 2) : ''}${s.bench ? li('Bench', 'Tiled', 3) : ''}${li('Edges', 'Finished with trim', 4)}</div>
      ${s.price ? `<div class="qt-li qt-li--hl"><span>${showersOf(t).length > 1 ? 'This shower' : 'Your shower'}</span><b>${money(s.price, true)}</b></div>` : ''}
      <p class="qt-p qt-mut">Grout, and flexible caulk where walls meet, are part of the job.</p>`;
  }

  function topsPanel(t, id) {
    const c = topsOf(t);
    const li = (a, b, k) => `<div class="qt-li" style="animation-delay:${(0.15 + (k || 0) * 0.2).toFixed(2)}s"><span>${esc(a)}</span><b>${esc(b)}</b></div>`;
    const stone = [c.material, c.color].filter(Boolean).join(' · ');
    if (id === 'tops') {
      return `<p class="qt-p">${esc(stone || 'Your stone')}, ${esc(c.thickness)} thick — every top measured on site and drawn to scale.</p>
        <div class="qt-big"><b>${fmt(c.sf)}</b><span>sq ft of countertop</span></div>
        <div class="qt-list">${c.pieces.map((p, k) => li(p.name, `${fmt(p.length)}″ × ${fmt(p.depth + p.overhang)}″${p.overhang ? ` · ${fmt(p.overhang)}″ overhang` : ''}`, k)).join('')}</div>
        <p class="qt-p qt-mut">A dashed line marks the cabinet line under a bar overhang.</p>`;
    }
    if (id === 'tops_fab') {
      return `<p class="qt-p">After your cabinets are set, we make a digital template of every top. You approve the layout on your slab — where the seams fall and how the veins run — before we cut.</p>
        <div class="qt-list">${li('Edge profile', `${c.edge_label} · ${fmt(c.edge_lf)} ft`, 0)}${c.waterfalls ? li('Waterfall', `${c.waterfalls} side${c.waterfalls > 1 ? 's' : ''}`, 1) : ''}${li('Seams', c.seams ? `${c.seams}, placed with you` : 'None expected', 2)}${li('Slabs', `About ${c.slabs}`, 3)}</div>
        <p class="qt-p qt-mut">Orange lines are the polished edges; green dashes, the seams. Final seams are set at the template.</p>`;
    }
    if (id === 'tops_install') {
      return `<p class="qt-p">Install day: the tops are set and leveled, ${c.supports ? 'the overhang supported, ' : ''}the sink mounted and sealed, and the silicone cures for a day before the plumbing is reconnected.</p>
        <div class="qt-list">${c.cutouts.map((x, k) => li(x.label, String(x.qty), k)).join('')}${li('Backsplash', c.splash_label, c.cutouts.length)}${c.tearout ? li('Old countertops', 'Removed and hauled away', c.cutouts.length + 1) : ''}</div>
        ${c.price ? `<div class="qt-li qt-li--hl"><span>${c.pieces.length > 1 ? 'Your countertops' : 'Your countertop'}</span><b>${money(c.price, true)}</b></div>` : ''}`;
    }
    return '';
  }

  function panelHtml(id) {
    const t = view();
    if (id.startsWith('shower')) return showerPanel(t, id);
    if (id.startsWith('tops')) return topsPanel(t, id);
    if (id === 'home') return `<p class="qt-p">We measured every room, ${t.stairs ? 'and the stairs, ' : ''}so the numbers you see are for your home.</p><div class="qt-big"><b>${fmt(t.sqft)}</b><span>sq ft${t.stairs ? ` + ${t.stairs} stair treads` : ''}</span></div>`;
    if (id === 'removal') return `<p class="qt-p">We remove the ${esc(t.removal.existing.join(', ') || 'old flooring')} from ${t.rooms.length === 1 ? 'the room' : 'every room in the scope'} and leave the subfloor clean and ready.</p>${t.categories.some((c) => c.label === 'Haul away') ? '<p class="qt-p">Everything we take out is hauled away.</p>' : ''}`;
    if (id === 'floor') return optionPicker(t) ? `${optionPicker(t)}<h3 class="qt-h3">${esc(t.floor.label)}</h3><p class="qt-p">${esc(t.floor.note)}</p><p class="qt-p qt-mut">Tap an option to see it in your home.</p>` : `<div class="qt-swatch ${texture(t, true)}" aria-hidden="true"></div><h3 class="qt-h3">${esc(t.floor.label)}</h3><p class="qt-p">${esc(t.floor.note)}</p>`;
    if (id === 'refinish') return `<div class="qt-swatch qt-fl qt-fl--wood is-still" aria-hidden="true"></div><h3 class="qt-h3">${esc(t.refinish.label)}</h3><p class="qt-p">Your existing wood floors, sanded and finished.</p>`;
    if (id === 'details') return `<div class="qt-list">${(t.details || []).map((d, k) => `<div class="qt-li" style="animation-delay:${(0.2 + k * 0.25).toFixed(2)}s"><span>${esc(d.label)}</span><b>${esc(d.value)}</b></div>`).join('')}</div>${t.transitions ? '<p class="qt-p qt-mut">Orange marks show the doorways.</p>' : ''}`;
    if (id === 'invest') {
      const max = Math.max(...t.categories.map((c) => c.amount), 1);
      return `<div class="qt-total"><b id="qtCount">${money(0, true)}</b>${t.per_sqft ? `<span>${money(t.per_sqft, true)} per sq ft · everything listed included</span>` : ''}</div>
        <div class="qt-bars">${t.categories.map((c, k) => `<div class="qt-barrow"><div class="qt-barrow__top"><span>${esc(c.label)}</span><b>${money(c.amount, true)}</b></div><div class="qt-track"><i style="width:${Math.max(2, Math.round((c.amount / max) * 100))}%;animation-delay:${(0.15 + k * 0.12).toFixed(2)}s"></i></div></div>`).join('')}</div>`;
    }
    return `${optionPicker(t) ? optionPicker(t) : ''}<div class="qt-list">
        ${t.option_name ? `<div class="qt-li"><span>Your choice</span><b>${esc(t.floor ? t.floor.label : t.option_name)}</b></div>` : ''}
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
    const say = sayFor(view(), st.id);
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
      <main class="qt-stage" aria-label="${roomsOf(t).length ? 'Your home' : showersOf(t).length ? 'Your shower' : 'Your countertops'}">${stageHtml(st.id)}${state.narr ? `<p class="qt-say"><span class="qt-mate" aria-hidden="true"><img src="/assets/img/mascot/mate-head-talking.webp?v=20261027-m2" alt="" width="40" height="40"></span>${esc(say)}</p>` : ''}</main>
      <section class="qt-panel" aria-live="polite">
        <span class="qt-kicker">STEP ${state.i + 1} OF ${steps.length}</span>
        <h2 class="qt-h2">${esc(st.name)}</h2>
        <div class="qt-body">${panelHtml(st.id)}</div>
        <div class="qt-nav">
          ${state.i > 0 ? '<button type="button" class="qt-btn" data-qt-prev aria-label="Previous step"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' : ''}
          ${last ? `<button type="button" class="qt-btn qt-btn--pri" data-qt-approve>${esc(state.opts.approveLabel || 'Approve & sign')}</button>` : `<button type="button" class="qt-btn qt-btn--ink" data-qt-next>Next: ${esc(steps[state.i + 1].name)}</button>`}
        </div>
      </section>`;
    if (st.id === 'invest') countUp(view().total);
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
    const el = ev.target.closest('[data-qt-close],[data-qt-next],[data-qt-prev],[data-qt-go],[data-qt-play],[data-qt-narr],[data-qt-approve],[data-qt-opt],[data-qt-sh]');
    if (!el) return;
    if (el.hasAttribute('data-qt-sh')) {
      stopPlay();
      state.sh = Number(el.dataset.qtSh) || 0;
      return render();
    }
    if (el.hasAttribute('data-qt-opt')) {
      stopPlay();
      state.opt = el.dataset.qtOpt;
      if (state.opts.onOption) state.opts.onOption(state.opt);
      return render();
    }
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
      const chosen = state.opt;
      close();
      if (cb) cb(chosen);
      return;
    }
    stopPlay();
    if (el.hasAttribute('data-qt-next')) return go(state.i + 1);
    if (el.hasAttribute('data-qt-prev')) return go(state.i - 1);
    return go(Number(el.dataset.qtGo) || 0);
  }

  function open(tour, opts) {
    if (!tour || (!roomsOf(tour).length && !showersOf(tour).length && !topsOf(tour))) return false;
    close();
    state.t = tour;
    state.opts = opts || {};
    state.i = 0;
    state.sh = 0;
    state.opt = tour.selected_option || (tour.options && tour.options[0] && tour.options[0].id) || null;
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
