/**
 * ObraBuilder › measurement › Showers (Tile shower builder).
 * Layout: shower chips · top view and walls unfolded, to scale · settings · quantities. A "3D" button
 * opens the shower in 3D (three.js, loaded on demand). Quantities mirror
 * src/lib/trades/packs/tile/shower.ts (a test runs both on the same showers).
 *
 * window.ObShowers = { html(m), bind(view, m, { save, redraw }), quantities(shower), normalize(shower) }
 */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS_ID = 'ppShowersCss';
  const THREE_URL = '/vendor/three-0.160.0.module.min.js';

  const SHAPES = {
    alcove: { label: 'Alcove', walls: ['left', 'back', 'right'], openEdges: 2, curb: true },
    corner: { label: 'Corner', walls: ['back', 'right'], openEdges: 1, curb: true },
    walkin: { label: 'Walk-in', walls: ['left', 'back', 'right'], openEdges: 2, curb: false },
  };
  const WALL_LABEL = { left: 'Left wall', back: 'Back wall', right: 'Right wall' };
  const PAN_LABEL = { mortar: 'Mortar bed', foam: 'Foam pan', prefab: 'Prefab base' };
  const DEFAULTS = {
    name: '', shape: 'alcove', width: 60, depth: 36, height: 96,
    niches: 0, niche_w: 12, niche_h: 24, niche_d: 3.5, niche_wall: 'back',
    bench: false, bench_l: 36, bench_d: 16, bench_h: 18, bench_wall: 'left',
    curb: true, door: 'right', pan: 'mortar', drain: 'center',
    wall_tile: '', tile_long: 24, pattern: 'stacked', floor_tile: '', note: '',
  };
  const LIMITS = { width: 240, depth: 240, height: 144, niche_w: 60, niche_h: 60, niche_d: 12, bench_l: 120, bench_d: 36, bench_h: 30, tile_long: 96 };

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    const l = document.createElement('link');
    l.id = CSS_ID;
    l.rel = 'stylesheet';
    l.href = 'partner-portal-showers.css?v=20261103-sh2';
    document.head.appendChild(l);
  }

  function normalize(raw) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    for (const k of Object.keys(LIMITS)) s[k] = Math.max(0, Math.min(LIMITS[k], Number(s[k]) || 0));
    s.niches = Math.max(0, Math.min(6, Math.round(Number(s.niches) || 0)));
    if (!SHAPES[s.shape]) s.shape = 'alcove';
    const walls = SHAPES[s.shape].walls;
    if (!walls.includes(s.niche_wall)) s.niche_wall = 'back';
    if (!walls.includes(s.bench_wall)) s.bench_wall = walls[0];
    return s;
  }

  function wallsOf(s) {
    return SHAPES[s.shape].walls.map((k) => ({ key: k, label: WALL_LABEL[k], width: k === 'back' ? s.width : s.depth, height: s.height }));
  }
  const sf = (in2) => in2 / 144;
  const r1 = (n) => Math.round(n * 10) / 10;
  const hasCurb = (s) => SHAPES[s.shape].curb && s.curb;

  /** Same rules as the server (src/lib/trades/packs/tile/shower.ts). */
  function quantities(raw) {
    const s = normalize(raw);
    const walls = wallsOf(s);
    const wallIn2 = walls.reduce((a, w) => a + w.width * w.height, 0);
    const nicheReturns = s.niches * 2 * (s.niche_w + s.niche_h) * s.niche_d;
    const benchFront = s.bench ? s.bench_l * s.bench_h : 0;
    const benchTop = s.bench ? s.bench_l * s.bench_d : 0;
    const curbIn = hasCurb(s) ? s.width : 0;
    const curbIn2 = curbIn * (4.5 + 4 + 4.5);
    const floorIn2 = Math.max(0, s.width * s.depth - benchTop);
    const wall = sf(wallIn2 + nicheReturns + benchFront + curbIn2);
    const floor = sf(floorIn2);
    const waste = s.pattern === 'herringbone' ? 0.18 : s.tile_long >= 24 ? 0.12 : 0.1;
    const trimIn = SHAPES[s.shape].openEdges * s.height + s.niches * 2 * (s.niche_w + s.niche_h);
    return {
      walls: walls.map((w) => ({ ...w, sf: r1(sf(w.width * w.height)) })),
      wall_sf: r1(wall),
      floor_sf: r1(floor),
      bench_top_sf: r1(sf(benchTop)),
      waterproofing_sf: r1(sf(wallIn2 + s.width * s.depth + curbIn2 + nicheReturns + benchFront + benchTop)),
      trim_lf: r1(trimIn / 12),
      curb_lf: r1(curbIn / 12),
      pan: s.pan === 'prefab' ? 0 : 1,
      niches: s.niches,
      bench: s.bench ? 1 : 0,
      waste,
      order_wall_sf: Math.ceil(wall * (1 + waste)),
      order_floor_sf: Math.ceil(floor * 1.15),
    };
  }

  /* ───────────────────────── drawings ───────────────────────── */

  function topView(s) {
    const W = 520;
    const k = (W - 150) / Math.max(s.width, s.depth * 1.4, 1);
    const w = s.width * k, d = s.depth * k, x0 = 64, y0 = 44, t = 10;
    const walls = SHAPES[s.shape].walls;
    const q = quantities(s);
    let g = `<rect x="${x0}" y="${y0}" width="${w}" height="${d}" fill="url(#psMos)" stroke="#E5E7EB"/>`;
    const wall = (key, x, y, ww, hh) => `<rect class="ps-w" data-sh-wall="${key}" x="${x}" y="${y}" width="${ww}" height="${hh}" fill="#221E1A"><title>${WALL_LABEL[key]}</title></rect>`;
    if (walls.includes('back')) g += wall('back', x0 - t, y0 - t, w + 2 * t, t);
    if (walls.includes('left')) g += wall('left', x0 - t, y0 - t, t, d + t);
    if (walls.includes('right')) g += wall('right', x0 + w, y0 - t, t, d + t);
    if (s.bench) {
      const bl = Math.min(s.bench_l, s.bench_wall === 'back' ? s.width : s.depth) * k, bd = s.bench_d * k;
      const r = s.bench_wall === 'back' ? [x0, y0, bl, bd] : s.bench_wall === 'left' ? [x0, y0, bd, bl] : [x0 + w - bd, y0, bd, bl];
      g += `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="#D9D2C7" stroke="#B8AE9F"/>`;
      const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
      g += `<text x="${cx}" y="${cy + 4}" font-size="12" fill="#5B5246" text-anchor="middle"${r[3] > r[2] ? ` transform="rotate(-90 ${cx} ${cy})"` : ''}>Bench ${s.bench_l}″ × ${s.bench_d}″</text>`;
    }
    if (s.niches) {
      const nw = s.niche_w * k;
      if (s.niche_wall === 'back') g += `<rect x="${x0 + w / 2 - nw / 2}" y="${y0 - t - 6}" width="${nw}" height="6" fill="#E7792C"/><text x="${x0 + w / 2}" y="${y0 - t - 12}" font-size="12" font-weight="700" fill="#B4561A" text-anchor="middle">Niche ${s.niche_w}″ × ${s.niche_h}″${s.niches > 1 ? ` ×${s.niches}` : ''}</text>`;
      else {
        const x = s.niche_wall === 'left' ? x0 - t - 6 : x0 + w + t;
        g += `<rect x="${x}" y="${y0 + d / 2 - nw / 2}" width="6" height="${nw}" fill="#E7792C"/>`;
      }
    }
    // drain
    g += s.drain === 'linear'
      ? `<rect x="${x0 + w * 0.2}" y="${y0 + d - 16}" width="${w * 0.6}" height="5" rx="2" fill="#8C857C"/>`
      : `<circle cx="${x0 + w / 2}" cy="${y0 + d / 2}" r="7" fill="#fff" stroke="#221E1A" stroke-width="2"/>`;
    // open side: curb, glass, door
    if (hasCurb(s)) g += `<rect x="${x0}" y="${y0 + d}" width="${w}" height="7" fill="#B8AE9F"/>`;
    const gy = y0 + d + 16;
    if (s.door === 'none') g += `<line x1="${x0}" y1="${gy}" x2="${x0 + w * 0.6}" y2="${gy}" stroke="#9DB3BF" stroke-width="4"/>`;
    else {
      const left = s.door === 'left', center = s.door === 'center';
      const dx = center ? [x0 + w * 0.3, x0 + w * 0.7] : left ? [x0, x0 + w * 0.5] : [x0 + w * 0.5, x0 + w];
      if (!center) g += `<line x1="${left ? x0 + w * 0.52 : x0}" y1="${gy}" x2="${left ? x0 + w : x0 + w * 0.48}" y2="${gy}" stroke="#9DB3BF" stroke-width="4"/>`;
      g += `<line x1="${dx[0]}" y1="${gy + 6}" x2="${dx[1]}" y2="${gy + 6}" stroke="#E7792C" stroke-width="4"/>`;
      g += `<text x="${(dx[0] + dx[1]) / 2}" y="${gy + 24}" font-size="12" font-weight="700" fill="#B4561A" text-anchor="middle">Door</text>`;
    }
    if (s.shape === 'corner') g += `<line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + d}" stroke="#9DB3BF" stroke-width="4"/>`;
    g += `<text x="${x0}" y="${gy + 24}" font-size="12" fill="#667085">${hasCurb(s) ? `Curb ${q.curb_lf} LF` : 'No curb'}</text>`;
    g += `<line x1="${x0}" y1="${gy + 44}" x2="${x0 + w}" y2="${gy + 44}" stroke="#221E1A"/><text x="${x0 + w / 2}" y="${gy + 62}" font-size="13" font-weight="700" text-anchor="middle">${s.width}″ wide</text>`;
    g += `<line x1="${x0 + w + 30}" y1="${y0}" x2="${x0 + w + 30}" y2="${y0 + d}" stroke="#221E1A"/><text x="${x0 + w + 38}" y="${y0 + d / 2 + 4}" font-size="13" font-weight="700">${s.depth}″</text>`;
    return `<svg class="ps-top" viewBox="0 0 ${W} ${d + 140}" role="img" aria-label="Shower seen from above">
      <defs><pattern id="psMos" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#EFEBE5"/><path d="M8 0H0V8" fill="none" stroke="#DDD5CA" stroke-width="1"/></pattern></defs>${g}</svg>`;
  }

  function elevations(s) {
    const q = quantities(s);
    const h = 200, k = h / Math.max(1, s.height);
    const tw = Math.max(4, s.tile_long * k), th = Math.max(3, (s.tile_long / 2) * k);
    const figs = q.walls.map((w, i) => {
      const ww = w.width * k;
      const pid = `psWt${i}`;
      let inner = `<rect width="${ww}" height="${h}" fill="url(#${pid})" stroke="#B8AE9F"/>`;
      if (s.niches && w.key === s.niche_wall) {
        const nw = s.niche_w * k, nh = s.niche_h * k, gap = 6;
        const total = s.niches * nh + (s.niches - 1) * gap;
        for (let n = 0; n < s.niches; n++) inner += `<rect x="${ww / 2 - nw / 2}" y="${h - 54 * k - total + n * (nh + gap)}" width="${nw}" height="${nh}" fill="#fff" stroke="#E7792C" stroke-width="2"/>`;
      }
      if (s.bench && w.key === s.bench_wall) inner += `<rect x="0" y="${h - s.bench_h * k}" width="${Math.min(ww, s.bench_l * k)}" height="${s.bench_h * k}" fill="#D9D2C7" stroke="#B8AE9F"/>`;
      if (s.height >= 72) inner += `<line x1="0" y1="${h - 72 * k}" x2="${ww}" y2="${h - 72 * k}" stroke="#536249" stroke-dasharray="3 3"/>`;
      return `<figure data-sh-wall="${w.key}"><svg width="${ww}" height="${h}" viewBox="0 0 ${ww} ${h}" aria-hidden="true"><defs><pattern id="${pid}" width="${tw}" height="${th}" patternUnits="userSpaceOnUse"><rect width="${tw}" height="${th}" fill="#F3F0EA"/><path d="M${tw} 0H0V${th}" fill="none" stroke="#D9D2C7" stroke-width="1"/></pattern></defs>${inner}</svg>
        <figcaption>${w.label}<small>${w.width}″ × ${w.height}″ · ${w.sf} SF</small></figcaption></figure>`;
    });
    return `<div class="ps-elev">${figs.join('')}</div>
      <p class="ps-hint"><span class="ps-hint__72">- - -</span> 72″ above the drain (minimum tiled height)${s.niches ? ` · niche ${s.niche_w}″ × ${s.niche_h}″ at 54″` : ''}</p>`;
  }

  /* ───────────────────────── panels ───────────────────────── */

  const num = (key, label, v, dis, unit = 'in') => `<label class="ps-dim"><span>${label}</span><span class="ps-dim__in"><input type="number" inputmode="decimal" min="0" max="${LIMITS[key] || 240}" step="0.5" data-sh-field="${key}" value="${esc(v)}" ${dis} /><i>${unit}</i></span></label>`;
  const tog = (key, on, dis, label) => `<button type="button" class="ps-tog${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-sh-toggle="${key}" ${dis}></button>`;
  const sel = (key, v, opts, dis, label) => `<select class="ps-sel" data-sh-field="${key}" aria-label="${esc(label)}" ${dis}>${opts.map(([k, l]) => `<option value="${k}"${String(v) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  function settings(s, locked) {
    const dis = locked ? 'disabled' : '';
    const walls = SHAPES[s.shape].walls.map((k) => [k, WALL_LABEL[k].replace(' wall', '')]);
    return `<section class="ps-card"><h2>Shower${locked ? '' : `<button type="button" class="ps-link" data-sh-del>Remove</button>`}</h2>
      <label class="ps-name"><span>Name</span><input type="text" maxlength="80" data-sh-field="name" value="${esc(s.name)}" placeholder="Owner's bath shower" ${dis} /></label>
      <div class="ps-seg" role="group" aria-label="Shape">${Object.entries(SHAPES).map(([k, v]) => `<button type="button" data-sh-shape="${k}" aria-pressed="${k === s.shape}" class="${k === s.shape ? 'is-on' : ''}" ${dis}>${v.label}</button>`).join('')}</div>
      <div class="ps-dims">${num('width', 'Width', s.width, dis)}${num('depth', 'Depth', s.depth, dis)}${num('height', 'Tile height', s.height, dis)}</div>
      <div class="ps-row"><div><b>Niche</b><small>${s.niches ? `${s.niche_w}″ × ${s.niche_h}″ · ${WALL_LABEL[s.niche_wall].toLowerCase()}` : 'None'}</small></div>
        <span class="ps-step">${locked ? '' : '<button type="button" data-sh-niches="-1" aria-label="One less niche">−</button>'}<b>${s.niches}</b>${locked ? '' : '<button type="button" data-sh-niches="1" aria-label="One more niche">+</button>'}</span></div>
      ${s.niches ? `<div class="ps-sub">${num('niche_w', 'Niche W', s.niche_w, dis)}${num('niche_h', 'Niche H', s.niche_h, dis)}<label class="ps-dim"><span>Wall</span>${sel('niche_wall', s.niche_wall, walls, dis, 'Niche wall')}</label></div>` : ''}
      <div class="ps-row"><div><b>Bench</b><small>${s.bench ? `${s.bench_l}″ × ${s.bench_d}″ · ${WALL_LABEL[s.bench_wall].toLowerCase()}` : 'None'}</small></div>${tog('bench', s.bench, dis, 'Bench')}</div>
      ${s.bench ? `<div class="ps-sub">${num('bench_l', 'Length', s.bench_l, dis)}${num('bench_d', 'Depth', s.bench_d, dis)}<label class="ps-dim"><span>Wall</span>${sel('bench_wall', s.bench_wall, walls, dis, 'Bench wall')}</label></div>` : ''}
      ${SHAPES[s.shape].curb ? `<div class="ps-row"><div><b>Curb</b><small>${hasCurb(s) ? `${quantities(s).curb_lf} LF along the opening` : 'Curbless'}</small></div>${tog('curb', s.curb, dis, 'Curb')}</div>` : ''}
      <div class="ps-row"><div><b>Door</b></div>${sel('door', s.door, [['right', 'Right'], ['left', 'Left'], ['center', 'Center'], ['none', 'No door']], dis, 'Door')}</div>
      <div class="ps-row"><div><b>Pan</b></div>${sel('pan', s.pan, Object.entries(PAN_LABEL), dis, 'Pan')}</div>
      <div class="ps-row"><div><b>Drain</b></div>${sel('drain', s.drain, [['center', 'Center'], ['linear', 'Linear']], dis, 'Drain')}</div>
      <div class="ps-row ps-row--stack"><div><b>Wall tile</b><small>${s.pattern === 'herringbone' ? 'Herringbone' : s.pattern === 'offset' ? 'Offset' : 'Stacked'} · ${Math.round(quantities(s).waste * 100)}% waste</small></div>
        <div class="ps-tile"><input type="text" maxlength="80" data-sh-field="wall_tile" value="${esc(s.wall_tile)}" placeholder="12×24 porcelain" ${dis} />${sel('tile_long', s.tile_long, [[6, '≤ 6″'], [12, '12″'], [24, '24″'], [36, '36″'], [48, '48″+']], dis, 'Tile long side')}${sel('pattern', s.pattern, [['stacked', 'Stacked'], ['offset', 'Offset'], ['herringbone', 'Herringbone']], dis, 'Pattern')}</div></div>
      <div class="ps-row ps-row--stack"><div><b>Floor tile</b></div><input type="text" class="ps-in" maxlength="80" data-sh-field="floor_tile" value="${esc(s.floor_tile)}" placeholder="2×2 mosaic" ${dis} /></div>
    </section>`;
  }

  function qtyCard(s) {
    const q = quantities(s);
    const l = (a, b, c) => `<div class="ps-ql"><span>${a}</span><b>${b}</b>${c ? `<small>${c}</small>` : ''}</div>`;
    return `<section class="ps-qty" aria-live="polite"><h2>Quantities<small>this shower</small></h2>
      ${l('Wall tile', `${q.wall_sf} SF`, `Order ${q.order_wall_sf} SF with ${Math.round(q.waste * 100)}% waste${s.niches || s.bench || hasCurb(s) ? ` · ${[s.niches ? 'niche returns' : '', s.bench ? 'bench' : '', hasCurb(s) ? 'curb' : ''].filter(Boolean).join(', ')} included` : ''}`)}
      ${l('Floor tile', `${q.floor_sf} SF`, `Order ${q.order_floor_sf} SF${s.bench ? ' · bench footprint taken out' : ''}`)}
      ${l('Waterproofing', `${q.waterproofing_sf} SF`, 'Walls, floor' + (hasCurb(s) ? ', curb' : '') + (s.niches ? ', niche' : '') + (s.bench ? ', bench' : ''))}
      ${l('Trim / edge', `${q.trim_lf} LF`, 'Open edges' + (s.niches ? ' and niche frame' : ''))}
      ${hasCurb(s) ? l('Curb', `${q.curb_lf} LF`) : ''}
      ${l('Pan · niche · bench', `${q.pan} · ${q.niches} · ${q.bench}`)}
    </section>`;
  }

  function html(m) {
    ensureCss();
    const locked = m.status === 'used';
    const list = (m.data.showers = m.data.showers || []);
    if (m.showerIdx == null || m.showerIdx >= list.length) m.showerIdx = 0;
    const chips = list
      .map((raw, i) => {
        const s = normalize(raw);
        const extras = [s.niches ? (s.niches > 1 ? `${s.niches} niches` : 'niche') : '', s.bench ? 'bench' : ''].filter(Boolean).join(', ');
        return `<button type="button" class="ps-chip${i === m.showerIdx ? ' is-on' : ''}" data-sh-pick="${i}" aria-pressed="${i === m.showerIdx}">${esc(s.name || `Shower ${i + 1}`)}<small>${SHAPES[s.shape].label} · ${s.width}″ × ${s.depth}″${extras ? ` · ${extras}` : ''}</small></button>`;
      })
      .join('');
    const add = locked ? '' : '<button type="button" class="ps-chip ps-chip--add" data-sh-add>+ Shower</button>';
    if (!list.length) {
      return `<section class="ps ps-empty-wrap"><div class="ps-empty"><strong>No showers measured</strong><span>Add each shower with its size, niche, bench and curb — wall and floor tile, waterproofing and trim come out on their own.</span>${locked ? '' : '<button type="button" class="ps-btn ps-btn--pri" data-sh-add>+ Shower</button>'}</div></section>`;
    }
    const s = normalize(list[m.showerIdx]);
    return `<section class="ps">
      <div class="ps-chips">${chips}${add}</div>
      <div class="ps-grid">
        <div class="ps-col">
          <section class="ps-card"><h2>Top view<button type="button" class="ps-btn ps-btn--dark ps-btn--sm" data-sh-3d>3D</button></h2><div data-sh-top>${topView(s)}</div></section>
          <section class="ps-card"><h2>Walls<small>unfolded, to scale</small></h2><div data-sh-elev>${elevations(s)}</div></section>
        </div>
        <div class="ps-col"><div data-sh-settings>${settings(s, locked)}</div><div data-sh-qty>${qtyCard(s)}</div></div>
      </div>
    </section>`;
  }

  /* ───────────────────────── behaviour ───────────────────────── */

  function bind(view, m, ctx) {
    const root = view.querySelector('.ps');
    if (!root) return;
    const locked = m.status === 'used';
    const cur = () => m.data.showers[m.showerIdx];
    const repaint = (all) => {
      const s = normalize(cur());
      if (all) return ctx.redraw();
      root.querySelector('[data-sh-top]').innerHTML = topView(s);
      root.querySelector('[data-sh-elev]').innerHTML = elevations(s);
      root.querySelector('[data-sh-qty]').innerHTML = qtyCard(s);
      const chip = root.querySelector(`[data-sh-pick="${m.showerIdx}"] small`);
      if (chip) chip.textContent = `${SHAPES[s.shape].label} · ${s.width}″ × ${s.depth}″${s.niches || s.bench ? ` · ${[s.niches ? (s.niches > 1 ? `${s.niches} niches` : 'niche') : '', s.bench ? 'bench' : ''].filter(Boolean).join(', ')}` : ''}`;
    };
    const set = (patch, all) => {
      m.data.showers[m.showerIdx] = normalize({ ...cur(), ...patch });
      ctx.save();
      repaint(all);
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sh-pick')) { m.showerIdx = Number(b.getAttribute('data-sh-pick')); return ctx.redraw(); }
      if (b.hasAttribute('data-sh-3d')) return open3d(normalize(cur()));
      if (locked) return;
      if (b.hasAttribute('data-sh-add')) {
        const list = m.data.showers;
        const prev = list[list.length - 1];
        list.push(normalize({ ...(prev ? { ...prev, name: '' } : {}), id: `sh${Date.now().toString(36)}`, name: `Shower ${list.length + 1}` }));
        m.showerIdx = list.length - 1;
        ctx.save();
        return ctx.redraw();
      }
      if (b.hasAttribute('data-sh-del')) {
        const s = normalize(cur());
        if (!window.confirm(`Remove ${s.name || 'this shower'}?`)) return;
        m.data.showers.splice(m.showerIdx, 1);
        m.showerIdx = Math.max(0, m.showerIdx - 1);
        ctx.save();
        return ctx.redraw();
      }
      if (b.hasAttribute('data-sh-shape')) return set({ shape: b.getAttribute('data-sh-shape') }, true);
      if (b.hasAttribute('data-sh-toggle')) { const k = b.getAttribute('data-sh-toggle'); return set({ [k]: !normalize(cur())[k] }, true); }
      if (b.hasAttribute('data-sh-niches')) return set({ niches: normalize(cur()).niches + Number(b.getAttribute('data-sh-niches')) }, true);
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      const k = t.getAttribute && t.getAttribute('data-sh-field');
      if (!k || locked) return;
      if (t.tagName === 'SELECT') return;
      const v = t.type === 'number' ? Number(String(t.value).replace(',', '.')) || 0 : t.value;
      m.data.showers[m.showerIdx] = normalize({ ...cur(), [k]: v });
      ctx.save();
      if (k === 'name') {
        const chip = root.querySelector(`[data-sh-pick="${m.showerIdx}"]`);
        if (chip && chip.firstChild) chip.firstChild.textContent = t.value || `Shower ${m.showerIdx + 1}`;
        return;
      }
      if (t.type === 'number') repaint(false);
    });
    root.addEventListener('change', (e) => {
      const t = e.target;
      const k = t.getAttribute && t.getAttribute('data-sh-field');
      if (!k || locked || t.tagName !== 'SELECT') return;
      set({ [k]: ['tile_long'].includes(k) ? Number(t.value) : t.value }, true);
    });
  }

  /* ───────────────────────── 3D ───────────────────────── */

  let threeP = null;
  async function open3d(s) {
    ensureCss();
    const ov = document.createElement('div');
    ov.className = 'ps-3d';
    ov.innerHTML = `<div class="ps-3d__box" role="dialog" aria-label="Shower in 3D"><div class="ps-3d__bar"><b>${esc(s.name || 'Shower')}</b><span>${SHAPES[s.shape].label} · ${s.width}″ × ${s.depth}″ × ${s.height}″ · drag to turn</span><button type="button" class="ps-btn ps-btn--sm" data-close>Close</button></div><div class="ps-3d__stage" data-stage><p class="ps-3d__load">Loading 3D…</p></div></div>`;
    document.body.appendChild(ov);
    let stop = false;
    const close = () => { stop = true; ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    try {
      if (!threeP) threeP = import(THREE_URL).catch((err) => { threeP = null; throw err; });
      const THREE = await threeP;
      const el = ov.querySelector('[data-stage]');
      el.innerHTML = '';
      buildScene(THREE, el, s, () => stop);
    } catch (_) {
      const el = ov.querySelector('[data-stage]');
      if (el) el.innerHTML = '<p class="ps-3d__load">Could not load the 3D viewer.</p>';
    }
  }

  function buildScene(THREE, el, s, stopped) {
    const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    R.setSize(el.clientWidth, el.clientHeight);
    R.shadowMap.enabled = true;
    el.appendChild(R.domElement);
    const S = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(36, el.clientWidth / el.clientHeight, 0.1, 100);
    S.add(new THREE.HemisphereLight(0xffffff, 0xd8cfc3, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 5);
    sun.castShadow = true;
    S.add(sun);
    const IN = 0.0254;
    const W = s.width * IN, D = s.depth * IN, H = s.height * IN, T = 0.09;
    const tex = (base, line, cw, ch, rx, ry) => {
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, cw, ch); g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(0, 0, cw, ch);
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(rx, ry); return t;
    };
    const tl = Math.max(4, s.tile_long);
    const wallMat = (wIn, hIn) => new THREE.MeshStandardMaterial({ map: tex('#EFEAE2', '#D3CABD', 256, 128, wIn / tl, hIn / (tl / 2)), roughness: 0.55 });
    const box = (w, h, d, mat) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); me.castShadow = me.receiveShadow = true; S.add(me); return me; };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: tex('#E6E0D7', '#CFC5B7', 64, 64, s.width / 2, s.depth / 2), roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const room = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xd9d1c6 }));
    room.rotation.x = -Math.PI / 2; room.position.y = -0.002; room.receiveShadow = true; S.add(room);
    const walls = SHAPES[s.shape].walls;
    if (walls.includes('back')) box(W + 2 * T, H, T, wallMat(s.width, s.height)).position.set(0, H / 2, -D / 2 - T / 2);
    if (walls.includes('left')) box(T, H, D, wallMat(s.depth, s.height)).position.set(-W / 2 - T / 2, H / 2, 0);
    if (walls.includes('right')) box(T, H, D, wallMat(s.depth, s.height)).position.set(W / 2 + T / 2, H / 2, 0);
    const nicheMat = new THREE.MeshStandardMaterial({ color: 0xc9bfb1, roughness: 0.6 });
    for (let n = 0; n < s.niches; n++) {
      const nW = s.niche_w * IN, nH = s.niche_h * IN, y = 54 * IN + nH / 2 + n * (nH + 0.08);
      const me = box(s.niche_wall === 'back' ? nW : 0.02, nH, s.niche_wall === 'back' ? 0.02 : nW, nicheMat);
      if (s.niche_wall === 'back') me.position.set(0, y, -D / 2 + 0.005);
      else me.position.set(s.niche_wall === 'left' ? -W / 2 + 0.005 : W / 2 - 0.005, y, 0);
    }
    if (s.bench) {
      const L = s.bench_l * IN, BD = s.bench_d * IN, BH = s.bench_h * IN;
      const mat = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.5 });
      if (s.bench_wall === 'back') box(Math.min(L, W), BH, BD, mat).position.set(0, BH / 2, -D / 2 + BD / 2);
      else box(BD, BH, Math.min(L, D), mat).position.set(s.bench_wall === 'left' ? -W / 2 + BD / 2 : W / 2 - BD / 2, BH / 2, -D / 2 + Math.min(L, D) / 2);
    }
    if (hasCurb(s)) box(W, 4.5 * IN, 4.5 * IN, new THREE.MeshStandardMaterial({ color: 0xcfc6b8 })).position.set(0, (4.5 * IN) / 2, D / 2);
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.25, roughness: 0.05 });
    const gH = H * 0.82, gy = (hasCurb(s) ? 4.5 * IN : 0) + gH / 2;
    if (s.door !== 'none' || s.shape !== 'walkin') {
      const fixed = new THREE.Mesh(new THREE.BoxGeometry(W * 0.48, gH, 0.01), glassMat);
      fixed.position.set(s.door === 'left' ? W * 0.26 : -W * 0.26, gy, D / 2); S.add(fixed);
    }
    if (s.shape === 'corner') { const side = new THREE.Mesh(new THREE.BoxGeometry(0.01, gH, D), glassMat); side.position.set(-W / 2, gy, 0); S.add(side); }
    const drain = s.drain === 'linear'
      ? new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.004, 0.06), new THREE.MeshStandardMaterial({ color: 0x9a948c, metalness: 0.8, roughness: 0.3 }))
      : new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.004, 24), new THREE.MeshStandardMaterial({ color: 0x9a948c, metalness: 0.8, roughness: 0.3 }));
    drain.position.set(0, 0.003, s.drain === 'linear' ? D / 2 - 0.15 : 0); S.add(drain);
    let th = 0.55, ph = 1.08, r = Math.max(4, Math.max(W, D, H) * 2.6), drag = null;
    const target = new THREE.Vector3(0, H * 0.42, 0);
    const cv = R.domElement;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointerup', () => (drag = null));
    cv.addEventListener('pointermove', (e) => { if (!drag) return; th -= (e.clientX - drag.x) * 0.008; ph = Math.min(1.45, Math.max(0.35, ph - (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); r = Math.min(14, Math.max(2.5, r * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
    const loop = () => {
      if (stopped()) { R.dispose(); return; }
      cam.position.set(target.x + r * Math.sin(ph) * Math.sin(th), target.y + r * Math.cos(ph), target.z + r * Math.sin(ph) * Math.cos(th));
      cam.lookAt(target);
      R.render(S, cam);
      requestAnimationFrame(loop);
    };
    loop();
    el.setAttribute('data-ready', '1');
  }

  window.ObShowers = { html, bind, quantities, normalize, open3d };
})();
