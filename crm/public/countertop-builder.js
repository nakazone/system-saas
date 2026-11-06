/**
 * Countertop builder (Countertops trade): the tops of a job measured piece by piece — wall runs,
 * islands, vanities — with the exposed edges, backsplash walls, waterfall sides, sink, cooktop,
 * holes and bar overhang. Out come square feet, edge feet, cutouts, backsplash, supports, seams
 * and an estimate of slabs, and the quote lines with their prices.
 * Same look as the shower builder (partner-portal-showers.css, "ps-" classes): chips · top view to
 * scale · settings · quantities. The shop's templater still makes the real drawing; this is the
 * estimate a salesperson builds on site.
 *
 * window.ObTops = { html(m), bind(view, m, { save, redraw }), quantities(tops), normalize(tops),
 *                   quoteLines(tops), PRICE_ITEMS, matchPrice(item, rows), setLang('pt'|'es'|'en') }
 * m = { data: { tops: { spec, pieces } }, idx }
 */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let LANG = 'en';
  const PT = {
    Countertops: 'Bancadas', Countertop: 'Bancada', 'Wall run': 'Bancada de parede', Island: 'Ilha', Vanity: 'Banheiro',
    'Top view': 'Vista de cima', 'to scale': 'em escala', Remove: 'Remover', Name: 'Nome', Kind: 'Tipo',
    Length: 'Compr.', Depth: 'Profund.', 'Bar overhang': 'Balanço', 'Exposed edges': 'Bordas expostas', Front: 'Frente', Back: 'Fundo', Left: 'Esquerda', Right: 'Direita',
    Backsplash: 'Rodabanca', 'Backsplash walls': 'Paredes com rodabanca', Waterfall: 'Cascata', Sink: 'Cuba', None: 'Nenhuma', Undermount: 'Embutida (undermount)', Farmhouse: 'Farmhouse', 'Drop-in': 'Sobrepor',
    Cooktop: 'Cooktop', 'Faucet holes': 'Furos de torneira', Outlets: 'Tomadas', 'One less': 'Um a menos', 'One more': 'Mais um',
    'Whole job': 'Para o job todo', Level: 'Nível', Material: 'Material', Color: 'Cor', Thickness: 'Espessura', Edge: 'Borda',
    Eased: 'Reta (eased)', Bevel: 'Chanfro / meia-cana', Ogee: 'Ogee / bullnose', Mitered: 'Esquadria (mitered)', '4″': '4″', 'Full height': 'Até o armário', 'No backsplash': 'Sem rodabanca', Height: 'Altura',
    'Tear-out': 'Retirar bancada antiga', Quantities: 'Quantidades', 'whole job': 'job todo', 'Edges': 'Bordas', Cutouts: 'Cutouts', Supports: 'Suportes', Seams: 'Emendas', Slabs: 'Slabs (estimativa)',
    'sinks, cooktop, holes': 'cubas, cooktop, furos', 'cabinet line': 'linha do armário', 'over 10″ needs support': 'acima de 10″ precisa de suporte',
    'No countertops yet': 'Nenhuma bancada medida', 'Add each run, island and vanity — square feet, edges, cutouts and backsplash come out on their own.': 'Adicione cada bancada, ilha e banheiro — pé², bordas, cutouts e rodabanca saem sozinhos.',
    '+ Run': '+ Bancada', '+ Island': '+ Ilha', '+ Vanity': '+ Banheiro', 'this countertop?': 'esta bancada?', 'Tap again to remove': 'Toque de novo para remover', SF: 'pé²', LF: 'pé lin.', 'Kitchen run': 'Bancada da pia', 'Hall bath vanity': 'Banheiro social',
    'Estimate before the template — the shop confirms seams and slabs.': 'Estimativa antes do template — a oficina confirma emendas e slabs.',
  };
  const ES = {
    Countertops: 'Encimeras', Countertop: 'Encimera', 'Wall run': 'Encimera de pared', Island: 'Isla', Vanity: 'Baño',
    'Top view': 'Vista superior', 'to scale': 'a escala', Remove: 'Quitar', Name: 'Nombre', Kind: 'Tipo',
    Length: 'Largo', Depth: 'Fondo', 'Bar overhang': 'Voladizo', 'Exposed edges': 'Bordes expuestos', Front: 'Frente', Back: 'Fondo', Left: 'Izquierda', Right: 'Derecha',
    Backsplash: 'Salpicadero', 'Backsplash walls': 'Paredes con salpicadero', Waterfall: 'Cascada', Sink: 'Fregadero', None: 'Ninguno', Undermount: 'Bajo cubierta', Farmhouse: 'Farmhouse', 'Drop-in': 'Sobreponer',
    Cooktop: 'Cooktop', 'Faucet holes': 'Agujeros de grifo', Outlets: 'Enchufes', 'One less': 'Uno menos', 'One more': 'Uno más',
    'Whole job': 'Para todo el trabajo', Level: 'Nivel', Material: 'Material', Color: 'Color', Thickness: 'Espesor', Edge: 'Borde',
    Eased: 'Recto (eased)', Bevel: 'Bisel / media caña', Ogee: 'Ogee / bullnose', Mitered: 'Inglete (mitered)', '4″': '4″', 'Full height': 'Hasta el gabinete', 'No backsplash': 'Sin salpicadero', Height: 'Altura',
    'Tear-out': 'Quitar encimera vieja', Quantities: 'Cantidades', 'whole job': 'todo el trabajo', Edges: 'Bordes', Cutouts: 'Cortes', Supports: 'Soportes', Seams: 'Uniones', Slabs: 'Slabs (estimado)',
    'sinks, cooktop, holes': 'fregaderos, cooktop, agujeros', 'cabinet line': 'línea del gabinete', 'over 10″ needs support': 'más de 10″ necesita soporte',
    'No countertops yet': 'Ninguna encimera medida', 'Add each run, island and vanity — square feet, edges, cutouts and backsplash come out on their own.': 'Agregue cada encimera, isla y baño — pie², bordes, cortes y salpicadero salen solos.',
    '+ Run': '+ Encimera', '+ Island': '+ Isla', '+ Vanity': '+ Baño', 'this countertop?': 'esta encimera?', 'Tap again to remove': 'Toque otra vez para quitar', SF: 'pie²', LF: 'pie lin.', 'Kitchen run': 'Encimera del fregadero', 'Hall bath vanity': 'Baño de visitas',
    'Estimate before the template — the shop confirms seams and slabs.': 'Estimado antes del template — el taller confirma uniones y slabs.',
  };
  const DICT = { pt: PT, es: ES };
  const T = (k) => (DICT[LANG] && DICT[LANG][k] != null ? DICT[LANG][k] : k);

  const KINDS = {
    run: { label: 'Wall run', length: 96, depth: 25.5, edges: { front: true, back: false, left: false, right: false }, splash: { back: true, left: false, right: false }, sink: 'undermount' },
    island: { label: 'Island', length: 96, depth: 42, edges: { front: true, back: true, left: true, right: true }, splash: { back: false, left: false, right: false }, sink: 'none' },
    vanity: { label: 'Vanity', length: 49, depth: 22, edges: { front: true, back: false, left: false, right: false }, splash: { back: true, left: false, right: false }, sink: 'undermount' },
  };
  const SINKS = ['none', 'undermount', 'farmhouse', 'dropin'];
  const SINK_LABEL = { none: 'None', undermount: 'Undermount', farmhouse: 'Farmhouse', dropin: 'Drop-in' };
  const EDGES = ['eased', 'bevel', 'ogee', 'mitered'];
  const EDGE_LABEL = { eased: 'Eased', bevel: 'Bevel', ogee: 'Ogee', mitered: 'Mitered' };
  // Slab ~ 55″ × 120″ (standard quartz); jumbo slabs reach ~ 65″ × 130″. Estimates.
  const SLAB_SF = (55 * 120) / 144;
  const MAX_RUN = 120;
  const num = (v, d, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const r1 = (n) => Math.round(n * 10) / 10;
  const bool = (v, d) => (v === undefined ? d : Boolean(v));

  function normPiece(raw, i) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const kind = KINDS[p.kind] ? p.kind : 'run';
    const k = KINDS[kind];
    const e = p.edges || {};
    const s = p.splash || {};
    const w = p.waterfall || {};
    return {
      id: String(p.id || `ct${i}`),
      name: String(p.name || '').slice(0, 80),
      kind,
      length: num(p.length, k.length, 6, 240),
      depth: num(p.depth, k.depth, 6, 72),
      overhang: num(p.overhang, 0, 0, 24),
      edges: { front: bool(e.front, k.edges.front), back: bool(e.back, k.edges.back), left: bool(e.left, k.edges.left), right: bool(e.right, k.edges.right) },
      splash: { back: bool(s.back, k.splash.back), left: bool(s.left, k.splash.left), right: bool(s.right, k.splash.right) },
      waterfall: { left: bool(w.left, false), right: bool(w.right, false) },
      sink: SINKS.includes(p.sink) ? p.sink : k.sink,
      cooktop: Boolean(p.cooktop),
      faucet_holes: num(p.faucet_holes, kind === 'island' ? 0 : 1, 0, 6),
      outlets: num(p.outlets, 0, 0, 8),
    };
  }
  function normSpec(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      level: num(s.level, 2, 1, 4),
      material: String(s.material || 'Quartz').slice(0, 60),
      color: String(s.color || '').slice(0, 80),
      thickness: s.thickness === '2 cm' ? '2 cm' : '3 cm',
      edge: EDGES.includes(s.edge) ? s.edge : 'eased',
      splash: ['none', '4in', 'full'].includes(s.splash) ? s.splash : '4in',
      full_h: num(s.full_h, 18, 4, 60),
      tearout: Boolean(s.tearout),
    };
  }
  /** { spec, pieces } with every field filled. */
  function normalize(raw) {
    const t = raw && typeof raw === 'object' ? raw : {};
    return { spec: normSpec(t.spec), pieces: (Array.isArray(t.pieces) ? t.pieces : []).map(normPiece) };
  }

  /** Per piece and for the whole job (estimates; the template is the real measure). */
  function pieceQty(p, spec) {
    const deep = p.depth + p.overhang;
    const wfIn2 = (p.waterfall.left ? 1 : 0) * deep * 36 + (p.waterfall.right ? 1 : 0) * deep * 36;
    const sf = (p.length * deep + wfIn2) / 144;
    const edgeIn = (p.edges.front ? p.length : 0) + (p.edges.back ? p.length : 0) + (p.edges.left && !p.waterfall.left ? deep : 0) + (p.edges.right && !p.waterfall.right ? deep : 0);
    const splashIn = (p.splash.back ? p.length : 0) + (p.splash.left ? p.depth : 0) + (p.splash.right ? p.depth : 0);
    const limit = spec.thickness === '2 cm' ? 6 : 10;
    return {
      sf: r1(sf),
      edge_lf: r1(edgeIn / 12),
      splash_lf: spec.splash === 'none' ? 0 : r1(splashIn / 12),
      waterfalls: (p.waterfall.left ? 1 : 0) + (p.waterfall.right ? 1 : 0),
      supports: p.overhang > limit ? Math.max(2, Math.ceil(p.length / 32)) : 0,
      seams: p.length > MAX_RUN ? Math.ceil(p.length / MAX_RUN) - 1 : 0,
    };
  }
  function quantities(raw) {
    const t = normalize(raw);
    const per = t.pieces.map((p) => pieceQty(p, t.spec));
    const sum = (k) => r1(per.reduce((a, q) => a + q[k], 0));
    const count = (f) => t.pieces.reduce((a, p) => a + f(p), 0);
    const splashLf = sum('splash_lf');
    const sf = sum('sf');
    return {
      per,
      sf,
      edge_lf: sum('edge_lf'),
      splash_lf: t.spec.splash === '4in' ? splashLf : 0,
      splash_sf: t.spec.splash === 'full' ? r1((splashLf * t.spec.full_h) / 12) : 0,
      waterfalls: sum('waterfalls'),
      supports: sum('supports'),
      seams: sum('seams'),
      sinks: { undermount: count((p) => (p.sink === 'undermount' ? 1 : 0)), farmhouse: count((p) => (p.sink === 'farmhouse' ? 1 : 0)), dropin: count((p) => (p.sink === 'dropin' ? 1 : 0)) },
      cooktops: count((p) => (p.cooktop ? 1 : 0)),
      faucet_holes: count((p) => p.faucet_holes),
      outlets: count((p) => p.outlets),
      // Slabs with ~20% for layout, veining and seams (estimate; the shop's nesting decides).
      slabs: sf ? Math.ceil((sf * 1.2 + (t.spec.splash === 'full' ? (splashLf * t.spec.full_h) / 12 : 0)) / SLAB_SF) : 0,
    };
  }

  /* ─────────────── prices and quote lines ─────────────── */
  const PRICE_ITEMS = {
    ct_top_l1: { names: ['countertop - level 1 (fabricate & install)'], hints: ['level 1'], rate: 55 },
    ct_top_l2: { names: ['countertop - level 2 (fabricate & install)'], hints: ['level 2'], rate: 68 },
    ct_top_l3: { names: ['countertop - level 3 (fabricate & install)'], hints: ['level 3'], rate: 82 },
    ct_top_l4: { names: ['countertop - level 4 / premium (fabricate & install)'], hints: ['level 4', 'premium'], rate: 110 },
    ct_edge_bevel: { names: ['edge upgrade - bevel / half bullnose'], hints: ['bevel'], rate: 10 },
    ct_edge_ogee: { names: ['edge upgrade - ogee / full bullnose'], hints: ['ogee'], rate: 18 },
    ct_edge_mitered: { names: ['mitered edge (laminated)'], hints: ['mitered'], rate: 30 },
    ct_waterfall: { names: ['waterfall edge (per side)'], hints: ['waterfall'], rate: 900 },
    ct_sink_undermount: { names: ['undermount sink cutout'], hints: ['undermount'], rate: 275 },
    ct_sink_farmhouse: { names: ['farmhouse / apron sink cutout'], hints: ['farmhouse', 'apron'], rate: 350 },
    ct_sink_dropin: { names: ['drop-in sink / vanity bowl cutout'], hints: ['drop-in'], rate: 150 },
    ct_cooktop: { names: ['cooktop cutout'], hints: ['cooktop'], rate: 200 },
    ct_faucet: { names: ['faucet / accessory hole'], hints: ['faucet'], rate: 35 },
    ct_outlet: { names: ['outlet cutout'], hints: ['outlet'], rate: 50 },
    ct_splash4: { names: ['4" backsplash'], hints: ['4" backsplash', '4 in backsplash'], rate: 16 },
    ct_splashfull: { names: ['full-height backsplash'], hints: ['full-height', 'full height'], rate: 45 },
    ct_support: { names: ['support bracket / corbel'], hints: ['bracket', 'corbel'], rate: 60 },
    ct_tearout: { names: ['countertop tear-out & disposal'], hints: ['tear-out', 'tear out'], rate: 350 },
  };
  const priceName = (n) => String(n || '').toLowerCase().replace(/[–—]/g, '-').replace(/[″“”]/g, '"').replace(/\s+/g, ' ').trim();
  function matchPrice(item, rows) {
    const def = PRICE_ITEMS[item];
    if (!def || !Array.isArray(rows)) return null;
    return rows.find((r) => def.names.includes(priceName(r.name))) || rows.find((r) => def.hints.some((w) => priceName(r.name).includes(w))) || null;
  }
  const LEVEL_NAME = (n) => (n === 4 ? 'Countertop – Level 4 / Premium (fabricate & install)' : `Countertop – Level ${n} (fabricate & install)`);
  const KIND_EN = { run: 'Wall run', island: 'Island', vanity: 'Vanity' };
  const inch = (v) => `${Math.round(v * 10) / 10}″`;

  /** Quote lines, in English for the customer: [{ item, key, name, description, quantity, unit }]. */
  function quoteLines(raw) {
    const t = normalize(raw);
    if (!t.pieces.length) return [];
    const q = quantities(t);
    const s = t.spec;
    const mat = [s.material, s.color, s.thickness].filter(Boolean).join(' · ');
    const out = [];
    const add = (item, key, name, description, quantity, unit) => {
      if (quantity > 0) out.push({ item, key, name, description, quantity, unit, ...(key.includes('@') ? { piece_id: key.split('@')[1] } : {}) });
    };
    t.pieces.forEach((p, i) => {
      const who = p.name || `${KIND_EN[p.kind]} ${i + 1}`;
      const dims = `${inch(p.length)} × ${inch(p.depth)}${p.overhang ? ` + ${inch(p.overhang)} overhang` : ''}`;
      add(`ct_top_l${s.level}`, `ct_top_l${s.level}@${p.id}`, LEVEL_NAME(s.level), `${who} · ${dims}${mat ? ` · ${mat}` : ''}`, q.per[i].sf, 'sq_ft');
    });
    add('ct_waterfall', 'ct_waterfall', 'Waterfall Edge (per side)', 'Mitered waterfall to the floor', q.waterfalls, 'each');
    if (s.edge !== 'eased') {
      const nm = { bevel: 'Edge Upgrade – Bevel / Half Bullnose', ogee: 'Edge Upgrade – Ogee / Full Bullnose', mitered: 'Mitered Edge (laminated)' }[s.edge];
      add(`ct_edge_${s.edge}`, `ct_edge_${s.edge}`, nm, 'Exposed edges', q.edge_lf, 'linear_ft');
    }
    add('ct_sink_undermount', 'ct_sink_undermount', 'Undermount Sink Cutout', 'Polished cutout, sink mounted', q.sinks.undermount, 'each');
    add('ct_sink_farmhouse', 'ct_sink_farmhouse', 'Farmhouse / Apron Sink Cutout', '', q.sinks.farmhouse, 'each');
    add('ct_sink_dropin', 'ct_sink_dropin', 'Drop-In Sink / Vanity Bowl Cutout', '', q.sinks.dropin, 'each');
    add('ct_cooktop', 'ct_cooktop', 'Cooktop Cutout', '', q.cooktops, 'each');
    add('ct_faucet', 'ct_faucet', 'Faucet / Accessory Hole', '', q.faucet_holes, 'each');
    add('ct_outlet', 'ct_outlet', 'Outlet Cutout', '', q.outlets, 'each');
    add('ct_splash4', 'ct_splash4', '4" Backsplash', mat, q.splash_lf, 'linear_ft');
    add('ct_splashfull', 'ct_splashfull', 'Full-Height Backsplash', `${inch(s.full_h)} high${mat ? ` · ${mat}` : ''}`, q.splash_sf, 'sq_ft');
    add('ct_support', 'ct_support', 'Support Bracket / Corbel', 'Overhang support', q.supports, 'each');
    if (s.tearout) add('ct_tearout', 'ct_tearout', 'Countertop Tear-Out & Disposal', 'Existing tops removed and hauled away', 1, 'each');
    return out;
  }

  /* ─────────────── drawing: one piece seen from above, to scale ─────────────── */
  function topView(p, spec) {
    const deep = p.depth + p.overhang;
    const W = 560;
    const k = Math.min((W - 110) / p.length, 240 / deep);
    const x0 = 40, y0 = 34, w = p.length * k, h = deep * k, cab = p.depth * k;
    const thick = 6;
    let g = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="3" fill="#EFEAE3" stroke="#221E1A" stroke-width="1.5"/>`;
    if (p.overhang) g += `<line x1="${x0}" y1="${y0 + cab}" x2="${x0 + w}" y2="${y0 + cab}" stroke="#98A2B3" stroke-dasharray="4 4"/><text x="${x0 + w - 6}" y="${y0 + cab - 5}" text-anchor="end" font-size="11" fill="#667085">${esc(T('cabinet line'))}</text>`;
    // backsplash walls (dark), exposed edges (orange), waterfall sides (orange, hatched)
    if (spec.splash !== 'none') {
      if (p.splash.back) g += `<rect x="${x0}" y="${y0 - thick}" width="${w}" height="${thick}" fill="#221E1A"/>`;
      if (p.splash.left) g += `<rect x="${x0 - thick}" y="${y0}" width="${thick}" height="${cab}" fill="#221E1A"/>`;
      if (p.splash.right) g += `<rect x="${x0 + w}" y="${y0}" width="${thick}" height="${cab}" fill="#221E1A"/>`;
    }
    const edge = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#E7792C" stroke-width="4" stroke-linecap="round"/>`;
    if (p.edges.front) g += edge(x0, y0 + h, x0 + w, y0 + h);
    if (p.edges.back) g += edge(x0, y0, x0 + w, y0);
    if (p.edges.left && !p.waterfall.left) g += edge(x0, y0, x0, y0 + h);
    if (p.edges.right && !p.waterfall.right) g += edge(x0 + w, y0, x0 + w, y0 + h);
    const wf = (x) => `<rect x="${x}" y="${y0}" width="10" height="${h}" fill="url(#ctHatch)" stroke="#E7792C" stroke-width="1.5"/>`;
    if (p.waterfall.left) g += wf(x0 - 12);
    if (p.waterfall.right) g += wf(x0 + w + 2);
    // sink / cooktop / holes, along the run
    const midY = y0 + Math.min(cab, h) / 2;
    const sinkW = (p.sink === 'farmhouse' ? 33 : p.kind === 'vanity' ? 19 : 30) * k;
    const sinkD = (p.kind === 'vanity' ? 15 : 18) * k;
    const sinkX = x0 + (p.cooktop ? w * 0.28 : w / 2) - sinkW / 2;
    const keepOut = [];
    if (p.sink !== 'none') {
      keepOut.push([sinkX, sinkX + sinkW]);
      const sy = p.sink === 'farmhouse' ? y0 + h - sinkD : midY - sinkD / 2 + 2 * k;
      g += `<rect x="${sinkX}" y="${sy}" width="${sinkW}" height="${sinkD}" rx="${p.sink === 'dropin' ? 4 : 8}" fill="#fff" stroke="#221E1A" stroke-width="1.3"/>`;
      for (let i = 0; i < p.faucet_holes; i++) g += `<circle cx="${sinkX + sinkW / 2 + (i - (p.faucet_holes - 1) / 2) * 3.2 * k}" cy="${sy - 2.2 * k}" r="${Math.max(2.5, 0.7 * k)}" fill="#221E1A"/>`;
    }
    if (p.cooktop) {
      const cw = 30 * k, cd = 20 * k, cx = x0 + w * (p.sink !== 'none' ? 0.72 : 0.5) - cw / 2, cy = midY - cd / 2;
      keepOut.push([cx, cx + cw]);
      g += `<rect x="${cx}" y="${cy}" width="${cw}" height="${cd}" rx="3" fill="#2B2724"/>`;
      [[0.28, 0.32], [0.72, 0.32], [0.28, 0.7], [0.72, 0.7]].forEach(([a, b]) => (g += `<circle cx="${cx + cw * a}" cy="${cy + cd * b}" r="${Math.max(3, 3.2 * k)}" fill="none" stroke="#8A817A" stroke-width="1.2"/>`));
    }
    // seams (estimate)
    const seams = p.length > MAX_RUN ? Math.ceil(p.length / MAX_RUN) - 1 : 0;
    // A seam never goes through a sink or a cooktop: it moves past it (the shop decides the real one).
    for (let i = 1; i <= seams; i++) {
      let sx = x0 + (w * i) / (seams + 1);
      keepOut.forEach(([a, b]) => {
        if (sx > a - 3 * k && sx < b + 3 * k) sx = b + 4 * k < x0 + w - 6 * k ? b + 4 * k : a - 4 * k;
      });
      g += `<line x1="${sx}" y1="${y0}" x2="${sx}" y2="${y0 + h}" stroke="#536249" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    }
    // dims
    g += `<text x="${x0 + w / 2}" y="${y0 + h + 22}" text-anchor="middle" font-size="13" font-weight="700" fill="#221E1A">${inch(p.length)}</text>`;
    g += `<text x="${x0 + w + 14}" y="${y0 + h / 2}" font-size="13" font-weight="700" fill="#221E1A" dominant-baseline="middle">${inch(deep)}</text>`;
    const H = y0 + h + 34;
    return `<svg class="ps-top" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T('Top view'))}"><defs><pattern id="ctHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#FBF1EA"/><path d="M0 0V6" stroke="#E7792C" stroke-width="1.4"/></pattern></defs>${g}</svg>`;
  }

  /* ─────────────── screen ─────────────── */
  const SF = () => T('SF');
  const LF = () => T('LF');
  const numIn = (field, label, v, unit) => `<label class="ps-dim"><span>${esc(label)}</span><span class="ps-dim__in"><input type="number" inputmode="decimal" step="0.25" data-ct-num="${field}" value="${esc(v)}" /><i>${unit || '″'}</i></span></label>`;
  const tog = (attr, on, label) => `<button type="button" class="ps-tog${on ? ' is-on' : ''}" ${attr} aria-pressed="${on}" aria-label="${esc(label)}"></button>`;
  const step = (field, v, label) => `<div class="ps-row"><div><b>${esc(label)}</b></div><div class="ps-step"><button type="button" data-ct-step="${field}" data-d="-1" aria-label="${esc(T('One less'))}">−</button><b>${v}</b><button type="button" data-ct-step="${field}" data-d="1" aria-label="${esc(T('One more'))}">+</button></div></div>`;
  const chipSub = (p, spec) => {
    const q = pieceQty(p, spec);
    return `${T(KINDS[p.kind].label)} · ${inch(p.length)} × ${inch(p.depth + p.overhang)} · ${q.sf} ${SF()}`;
  };
  const pieceName = (p, i) => p.name || `${T(KINDS[p.kind].label)} ${i + 1}`;

  function html(m) {
    const t = normalize(m.data.tops);
    m.data.tops = t;
    const add = `<button type="button" class="ps-chip ps-chip--add" data-ct-add="run">${esc(T('+ Run'))}</button><button type="button" class="ps-chip ps-chip--add" data-ct-add="island">${esc(T('+ Island'))}</button><button type="button" class="ps-chip ps-chip--add" data-ct-add="vanity">${esc(T('+ Vanity'))}</button>`;
    if (!t.pieces.length) {
      return `<div class="ps ct"><div class="ps-empty-wrap"><div class="ps-empty"><strong>${esc(T('No countertops yet'))}</strong><span>${esc(T('Add each run, island and vanity — square feet, edges, cutouts and backsplash come out on their own.'))}</span><div class="ps-chips" style="justify-content:center;margin:6px 0 0">${add}</div></div></div>${specCard(t)}</div>`;
    }
    m.idx = Math.max(0, Math.min(t.pieces.length - 1, m.idx || 0));
    const p = t.pieces[m.idx];
    const chips = t.pieces.map((x, i) => `<button type="button" class="ps-chip${i === m.idx ? ' is-on' : ''}" data-ct-pick="${i}" aria-pressed="${i === m.idx}">${esc(pieceName(x, i))}<small>${esc(chipSub(x, t.spec))}</small></button>`).join('');
    const sides = (group, keys, title) => `<div class="ps-row ps-row--stack"><b>${esc(title)}</b><div class="ct-sides">${keys.map((k) => `<button type="button" class="ct-side${p[group][k] ? ' is-on' : ''}" data-ct-side="${group}.${k}" aria-pressed="${p[group][k]}">${esc(T(k[0].toUpperCase() + k.slice(1)))}</button>`).join('')}</div></div>`;
    const sinkSel = `<select class="ps-sel" data-ct-field="sink" aria-label="${esc(T('Sink'))}">${SINKS.map((s) => `<option value="${s}" ${s === p.sink ? 'selected' : ''}>${esc(T(SINK_LABEL[s]))}</option>`).join('')}</select>`;
    return `<div class="ps ct">
      <div class="ps-chips">${chips}${add}</div>
      <div class="ps-grid">
        <div class="ps-col">
          <section class="ps-card"><h2>${esc(T('Top view'))}<small>${esc(T('to scale'))}</small></h2>${topView(p, t.spec)}
            <p class="ps-hint">${esc(T('Estimate before the template — the shop confirms seams and slabs.'))}</p></section>
          ${specCard(t)}
        </div>
        <div class="ps-col">
          <section class="ps-card"><h2>${esc(T('Countertop'))}<button type="button" class="ps-link" data-ct-del>${esc(T('Remove'))}</button></h2>
            <label class="ps-name"><span>${esc(T('Name'))}</span><input type="text" maxlength="80" data-ct-field="name" value="${esc(p.name)}" placeholder="${esc(T(p.kind === 'vanity' ? 'Hall bath vanity' : 'Kitchen run'))}" /></label>
            <div class="ps-seg" role="group" aria-label="${esc(T('Kind'))}">${Object.keys(KINDS).map((k) => `<button type="button" data-ct-kind="${k}" class="${k === p.kind ? 'is-on' : ''}" aria-pressed="${k === p.kind}">${esc(T(KINDS[k].label))}</button>`).join('')}</div>
            <div class="ps-dims">${numIn('length', T('Length'), p.length)}${numIn('depth', T('Depth'), p.depth)}${numIn('overhang', T('Bar overhang'), p.overhang)}</div>
            <div class="ct-hint">${supportHint(p, t.spec)}</div>
            ${sides('edges', ['front', 'back', 'left', 'right'], T('Exposed edges'))}
            ${t.spec.splash !== 'none' ? sides('splash', ['back', 'left', 'right'], T('Backsplash walls')) : ''}
            ${sides('waterfall', ['left', 'right'], T('Waterfall'))}
            <div class="ps-row"><div><b>${esc(T('Sink'))}</b></div>${sinkSel}</div>
            <div class="ps-row"><div><b>${esc(T('Cooktop'))}</b></div>${tog('data-ct-toggle="cooktop"', p.cooktop, T('Cooktop'))}</div>
            ${step('faucet_holes', p.faucet_holes, T('Faucet holes'))}
            ${step('outlets', p.outlets, T('Outlets'))}
          </section>
          ${qtyCard(t)}
        </div>
      </div>
    </div>`;
  }

  function supportHint(p, spec) {
    const limit = spec.thickness === '2 cm' ? 6 : 10;
    return p.overhang > limit ? `<p class="ps-hint ps-hint__72">${esc(T('over 10″ needs support').replace('10″', `${limit}″`))}</p>` : '';
  }
  function specCard(t) {
    const s = t.spec;
    const sel = (field, val, opts, label) => `<select class="ps-sel" data-ct-spec="${field}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `<section class="ps-card"><h2>${esc(T('Whole job'))}</h2>
      <div class="ps-row"><div><b>${esc(T('Level'))}</b></div>${sel('level', s.level, [1, 2, 3, 4].map((n) => [n, `${T('Level')} ${n}`]), T('Level'))}</div>
      <div class="ps-row ps-row--stack"><b>${esc(T('Material'))}</b><div class="ps-tile"><input type="text" maxlength="60" data-ct-spec="material" value="${esc(s.material)}" /><input type="text" maxlength="80" data-ct-spec="color" value="${esc(s.color)}" placeholder="${esc(T('Color'))}" />${sel('thickness', s.thickness, [['3 cm', '3 cm'], ['2 cm', '2 cm']], T('Thickness'))}</div></div>
      <div class="ps-row"><div><b>${esc(T('Edge'))}</b></div>${sel('edge', s.edge, EDGES.map((e) => [e, T(EDGE_LABEL[e])]), T('Edge'))}</div>
      <div class="ps-row"><div><b>${esc(T('Backsplash'))}</b></div>${sel('splash', s.splash, [['4in', T('4″')], ['full', T('Full height')], ['none', T('No backsplash')]], T('Backsplash'))}</div>
      ${s.splash === 'full' ? `<div class="ps-sub">${numIn('full_h', T('Height'), s.full_h)}</div>` : ''}
      <div class="ps-row"><div><b>${esc(T('Tear-out'))}</b></div>${tog('data-ct-spec-toggle="tearout"', s.tearout, T('Tear-out'))}</div>
    </section>`;
  }

  function qtyCard(t) {
    const q = quantities(t);
    const l = (a, b, c) => `<div class="ps-ql"><span>${esc(a)}</span><b>${esc(b)}</b>${c ? `<small>${esc(c)}</small>` : ''}</div>`;
    const cut = q.sinks.undermount + q.sinks.farmhouse + q.sinks.dropin + q.cooktops;
    return `<section class="ps-qty" aria-live="polite"><h2>${esc(T('Quantities'))}<small>${esc(T('whole job'))}</small></h2>
      ${l(T('Countertops'), `${q.sf} ${SF()}`, `${t.spec.material}${t.spec.color ? ` ${t.spec.color}` : ''} · ${t.spec.thickness} · ${T('Level')} ${t.spec.level}`)}
      ${l(T('Edges'), `${q.edge_lf} ${LF()}`, T(EDGE_LABEL[t.spec.edge]))}
      ${l(T('Cutouts'), `${cut} · ${q.faucet_holes}`, T('sinks, cooktop, holes'))}
      ${t.spec.splash === '4in' ? l(T('Backsplash'), `${q.splash_lf} ${LF()}`) : t.spec.splash === 'full' ? l(T('Backsplash'), `${q.splash_sf} ${SF()}`) : ''}
      ${q.waterfalls ? l(T('Waterfall'), String(q.waterfalls)) : ''}
      ${q.supports ? l(T('Supports'), String(q.supports)) : ''}
      ${l(`${T('Seams')} · ${T('Slabs')}`, `${q.seams} · ${q.slabs}`)}
    </section>`;
  }

  function ensureCss() {
    [['ppShowersCss', '/partner-portal-showers.css?v=20261105-mg3'], ['ctTopsCss', '/countertop-builder.css?v=20261105-mg1']].forEach(([id, href]) => {
      if (document.getElementById(id)) return;
      const l = document.createElement('link');
      l.id = id;
      l.rel = 'stylesheet';
      l.href = href;
      document.head.appendChild(l);
    });
  }

  function bind(root, m, ctx) {
    ensureCss();
    const box = root.querySelector('.ps') || root;
    const t = () => m.data.tops;
    const cur = () => t().pieces[m.idx];
    const done = (redraw) => {
      ctx.save && ctx.save();
      if (redraw) ctx.redraw && ctx.redraw();
      else {
        const q = box.querySelector('.ps-qty');
        if (q) q.outerHTML = qtyCard(normalize(t()));
        const view = box.querySelector('.ps-top');
        if (view && cur()) view.outerHTML = topView(normalize(t()).pieces[m.idx], normalize(t()).spec);
        const hint = box.querySelector('.ct-hint');
        if (hint && cur()) hint.innerHTML = supportHint(normalize(t()).pieces[m.idx], normalize(t()).spec);
        const chip = box.querySelector(`[data-ct-pick="${m.idx}"] small`);
        if (chip && cur()) chip.textContent = chipSub(normalize(t()).pieces[m.idx], normalize(t()).spec);
      }
    };
    box.addEventListener('click', (e) => {
      const el = e.target.closest('[data-ct-pick],[data-ct-add],[data-ct-del],[data-ct-kind],[data-ct-side],[data-ct-toggle],[data-ct-spec-toggle],[data-ct-step]');
      if (!el) return;
      const tops = t();
      if (el.hasAttribute('data-ct-pick')) {
        m.idx = Number(el.dataset.ctPick) || 0;
        return ctx.redraw && ctx.redraw();
      }
      if (el.hasAttribute('data-ct-add')) {
        const kind = el.dataset.ctAdd;
        tops.pieces.push(normPiece({ id: `ct${Date.now().toString(36)}`, kind }, tops.pieces.length));
        m.idx = tops.pieces.length - 1;
        return done(true);
      }
      const p = cur();
      if (!p) return;
      if (el.hasAttribute('data-ct-del')) {
        // Two taps instead of a browser dialog: the first one arms the button for 4 s.
        if (el.dataset.armed !== '1') {
          el.dataset.armed = '1';
          el.textContent = T('Tap again to remove');
          el.setAttribute('aria-live', 'polite');
          setTimeout(() => { if (el.isConnected) { el.dataset.armed = ''; el.textContent = T('Remove'); } }, 4000);
          return;
        }
        tops.pieces.splice(m.idx, 1);
        m.idx = Math.max(0, m.idx - 1);
        return done(true);
      }
      if (el.hasAttribute('data-ct-kind')) {
        const k = KINDS[el.dataset.ctKind];
        Object.assign(p, { kind: el.dataset.ctKind, depth: k.depth, edges: { ...k.edges }, splash: { ...k.splash }, sink: k.sink });
        return done(true);
      }
      if (el.hasAttribute('data-ct-side')) {
        const [g, k] = el.dataset.ctSide.split('.');
        p[g] = { ...p[g], [k]: !p[g][k] };
        return done(true);
      }
      if (el.hasAttribute('data-ct-toggle')) {
        p[el.dataset.ctToggle] = !p[el.dataset.ctToggle];
        return done(true);
      }
      if (el.hasAttribute('data-ct-spec-toggle')) {
        tops.spec[el.dataset.ctSpecToggle] = !tops.spec[el.dataset.ctSpecToggle];
        return done(true);
      }
      if (el.hasAttribute('data-ct-step')) {
        const f = el.dataset.ctStep;
        p[f] = Math.max(0, Math.min(f === 'outlets' ? 8 : 6, (Number(p[f]) || 0) + Number(el.dataset.d)));
        return done(true);
      }
    });
    box.addEventListener('input', (e) => {
      const el = e.target;
      const p = cur();
      if (el.matches('[data-ct-num]')) {
        const f = el.dataset.ctNum;
        const v = Number(el.value);
        if (!Number.isFinite(v)) return;
        if (f === 'full_h') t().spec.full_h = v;
        else if (p) p[f] = v;
        return done(false);
      }
      if (el.matches('[data-ct-field="name"]') && p) {
        p.name = el.value;
        const chip = box.querySelector(`[data-ct-pick="${m.idx}"]`);
        if (chip && chip.firstChild) chip.firstChild.textContent = el.value || pieceName({ ...p, name: '' }, m.idx);
        return ctx.save && ctx.save();
      }
      if (el.matches('input[data-ct-spec]')) {
        t().spec[el.dataset.ctSpec] = el.value;
        return done(false);
      }
    });
    box.addEventListener('change', (e) => {
      const el = e.target;
      if (el.matches('select[data-ct-spec]')) {
        const f = el.dataset.ctSpec;
        t().spec[f] = f === 'level' ? Number(el.value) : el.value;
        return done(true);
      }
      if (el.matches('select[data-ct-field="sink"]') && cur()) {
        cur().sink = el.value;
        return done(true);
      }
    });
  }

  const setLang = (l) => {
    LANG = l === 'pt' || l === 'es' ? l : 'en';
  };
  window.ObTops = {
    html,
    bind,
    normalize,
    quantities,
    quoteLines,
    PRICE_ITEMS,
    matchPrice,
    setLang,
    chip: (raw, i) => {
      const t = normalize(raw);
      const p = t.pieces[i];
      return p ? { name: pieceName(p, i), sub: chipSub(p, t.spec) } : null;
    },
  };
})();
