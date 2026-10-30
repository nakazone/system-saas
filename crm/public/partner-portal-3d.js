/*
 * ObraBuilder — 3D view of a measurement: the house from the plan takeoff with the chosen floors,
 * the measured stairs (treads, risers, nosings, landings, rails) in their place, and the vents.
 * three.js r160, served by the app (/vendor). Physically based materials, soft shadows, room light.
 * Also drives the presentation: floors laid room by room, the stair assembled step by step, vents.
 */
(function () {
  'use strict';

  const THREE_URL = '/vendor/three-0.160.0.module.min.js';
  let threeP = null;
  function loadThree() {
    if (!threeP) threeP = import(THREE_URL).catch(() => { threeP = null; throw new Error('Could not load the 3D viewer.'); });
    return threeP;
  }

  /* ───────────── finishes (drawn on a canvas) ───────────── */

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shade(hex, f) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))))).join(',')})`;
  }
  const SPECIES = [
    [/white\s*oak/i, '#C9A57A'], [/red\s*oak/i, '#BE8660'], [/hickory/i, '#BF9466'], [/maple/i, '#D8B98E'],
    [/walnut/i, '#6F4B34'], [/cherry|jatoba/i, '#9A4A2C'], [/ash/i, '#D4BC95'], [/pine/i, '#D9B47C'], [/teak/i, '#A87A48'],
  ];
  function woodColor(text, fallback) {
    const t = String(text || '');
    for (const [re, c] of SPECIES) if (re.test(t)) return c;
    return fallback || '#C49C6E';
  }

  /** Plank floor: rows of boards with random lengths, tone, grain and eased edges. ft = feet the texture covers. */
  function plankCanvas(base, plankIn, seed) {
    const S = 1024; const ft = 4; const pxIn = S / (ft * 12);
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d'); const r = rng(seed);
    const rowH = plankIn * pxIn;
    for (let y = 0; y < S; y += rowH) {
      let x = -r() * 40 * pxIn;
      while (x < S) {
        const len = (28 + r() * 56) * pxIn;
        const tone = (r() - 0.5) * 0.2;
        const grd = g.createLinearGradient(x, y, x + len, y + rowH);
        grd.addColorStop(0, shade(base, tone)); grd.addColorStop(1, shade(base, tone - 0.05));
        g.fillStyle = grd; g.fillRect(x, y, len, rowH);
        g.globalAlpha = 0.18;
        for (let k = 0; k < 10; k++) {
          g.strokeStyle = shade(base, tone - 0.22 - r() * 0.18);
          g.lineWidth = 0.5 + r() * 1.4;
          g.beginPath();
          const gy = y + r() * rowH;
          g.moveTo(x, gy);
          for (let t = 0; t <= 1; t += 0.05) g.lineTo(x + len * t, gy + Math.sin(t * (4 + r() * 4) + k) * rowH * 0.1);
          g.stroke();
        }
        if (r() > 0.7) { g.globalAlpha = 0.14; g.fillStyle = shade(base, -0.35); g.beginPath(); g.ellipse(x + len * r(), y + rowH * (0.3 + r() * 0.4), 6 + r() * 6, 2 + r() * 2, 0, 0, Math.PI * 2); g.fill(); }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(35,22,12,.55)'; g.fillRect(x, y, 2, rowH);
        x += len;
      }
      g.fillStyle = 'rgba(35,22,12,.5)'; g.fillRect(0, y, S, 2);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, y + 2, S, 2);
    }
    return cv;
  }
  /** Long-grain board (stair treads, risers, landings). */
  function grainCanvas(base, seed) {
    const W = 512; const H = 128; const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 46; k++) {
      g.globalAlpha = 0.12 + r() * 0.12;
      g.strokeStyle = shade(base, -0.18 - r() * 0.22); g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath(); const y0 = r() * H; g.moveTo(0, y0);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + Math.sin(x / (40 + r() * 60) + k) * 3);
      g.stroke();
    }
    g.globalAlpha = 1;
    return cv;
  }
  function noiseCanvas(base, amount, speck, seed) {
    const S = 256; const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d'); const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    if (speck) for (let k = 0; k < 900; k++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)'; g.fillRect(r() * S, r() * S, 1.5, 1.5); }
    return cv;
  }
  /** Polished concrete: soft clouds and a few aggregate specks. */
  function concreteCanvas(seed) {
    const S = 512; const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d'); const r = rng(seed);
    g.fillStyle = '#B9B5AF'; g.fillRect(0, 0, S, S);
    for (let k = 0; k < 60; k++) {
      const x = r() * S; const y = r() * S; const rad = 30 + r() * 120;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = r() > 0.5 ? '255,255,255' : '90,86,80';
      grd.addColorStop(0, `rgba(${c},.09)`); grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let k = 0; k < 1400; k++) { g.fillStyle = `rgba(${r() > 0.5 ? '70,66,60' : '235,232,226'},${0.25 + r() * 0.3})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
    return cv;
  }
  function tileCanvas(base) {
    const S = 256; const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, S, S); grd.addColorStop(0, shade(base, 0.08)); grd.addColorStop(1, shade(base, -0.06));
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4; g.strokeRect(2, 2, S - 4, S - 4);
    return cv;
  }
  /** A floor register seen from above: frame and slots. */
  function ventCanvas(base) {
    const W = 256; const H = 96; const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6); g.fillRect(0, 0, 6, H); g.fillRect(W - 6, 0, 6, H);
    for (let x = 20; x < W - 16; x += 14) { g.fillStyle = '#1E1814'; g.fillRect(x, 16, 7, H - 32); }
    return cv;
  }

  const FINISH = {
    hardwood: { base: '#B98455', plank: 5, rough: 0.42 },
    lvp: { base: '#A99680', plank: 7, rough: 0.5 },
    laminate: { base: '#B79F80', plank: 7.5, rough: 0.48 },
  };
  const ROUGH = { carpet: 0.98, rubber: 0.9, tile: 0.2, stone: 0.3, concrete: 0.22, other: 0.7 };

  function finishFor(THREE, mat, i) {
    let cv; let repeatFt = 4; let rough = ROUGH[mat.kind] != null ? ROUGH[mat.kind] : 0.7; let bump = 0.6;
    if (FINISH[mat.kind]) {
      const sp = mat.spec && (mat.spec.species || mat.spec.color);
      const base = mat.kind === 'hardwood' && sp ? woodColor(sp, FINISH.hardwood.base) : FINISH[mat.kind].base;
      cv = plankCanvas(base, FINISH[mat.kind].plank, 7 + i * 13); rough = FINISH[mat.kind].rough;
    } else if (mat.kind === 'carpet') { cv = noiseCanvas(mat.color, 34, false, 3 + i); repeatFt = 3; bump = 1.4; }
    else if (mat.kind === 'rubber') { cv = noiseCanvas(shade(mat.color, -0.25), 18, true, 5 + i); repeatFt = 3; }
    else if (mat.kind === 'concrete') { cv = concreteCanvas(11 + i); repeatFt = 10; bump = 0.15; }
    else if (mat.kind === 'tile' || mat.kind === 'stone') { cv = tileCanvas(mat.color); repeatFt = 2; bump = 0.5; }
    else { cv = noiseCanvas(mat.color, 8, false, 9 + i); }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    const bumpTex = new THREE.CanvasTexture(cv); bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    return { tex, bumpTex, repeatFt, rough, bump };
  }

  /** Soft studio light for reflections (a lit box with a few bright panels, prefiltered). */
  function studioEnv(THREE, renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const sc = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0xbdb6ac, side: THREE.BackSide }));
    room.position.y = 8; sc.add(room);
    const panel = (w, h, x, y, z, ry, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.y = ry; m.rotation.x = y > 15 ? Math.PI / 2 : 0; sc.add(m);
    };
    panel(16, 16, 0, 17.9, 0, 0, 3.2);
    panel(10, 6, -19.8, 8, 4, Math.PI / 2, 2.2);
    panel(10, 6, 19.8, 8, -6, -Math.PI / 2, 1.4);
    const rt = pm.fromScene(sc, 0.04);
    pm.dispose();
    return rt.texture;
  }

  /* ───────────── geometry from the grid ───────────── */

  /* ───────────── geometry from the grid ───────────── */

  function decode(grid) {
    const out = new Uint8Array(grid.w * grid.h); let i = 0;
    for (const part of String(grid.rle || '').split(',')) {
      if (!part) continue;
      const [v, n] = part.split('x').map(Number);
      if (v) out.fill(v, i, i + n);
      i += n;
    }
    return out;
  }

  /** Greedy rectangles of equal cells: [{x,y,w,h,v}]. */
  function rects(cells, W, H) {
    const done = new Uint8Array(cells.length); const out = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = cells[y * W + x];
        if (!v || done[y * W + x]) continue;
        let w = 1;
        while (x + w < W && cells[y * W + x + w] === v && !done[y * W + x + w]) w++;
        let h = 1;
        outer: while (y + h < H) {
          for (let k = 0; k < w; k++) if (cells[(y + h) * W + x + k] !== v || done[(y + h) * W + x + k]) break outer;
          h++;
        }
        for (let yy = y; yy < y + h; yy++) done.fill(1, yy * W + x, yy * W + x + w);
        out.push({ x, y, w, h, v });
      }
    }
    return out;
  }

  /** Outline segments between floor and no floor: [{x0,y0,x1,y1}] in cells. */
  function outline(cells, W, H) {
    const segs = [];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cells[y * W + x]);
    for (let y = 0; y <= H; y++) {
      let run = -1; let side = 0;
      for (let x = 0; x <= W; x++) {
        const a = at(x, y - 1) ? 1 : 0; const b = at(x, y) ? 1 : 0;
        const s = a !== b ? (a ? 1 : -1) : 0;
        if (s !== side || x === W) {
          if (side && run >= 0) segs.push({ x0: run, y0: y, x1: x, y1: y, n: side });
          run = s ? x : -1; side = s;
        }
      }
    }
    for (let x = 0; x <= W; x++) {
      let run = -1; let side = 0;
      for (let y = 0; y <= H; y++) {
        const a = at(x - 1, y) ? 1 : 0; const b = at(x, y) ? 1 : 0;
        const s = a !== b ? (a ? 1 : -1) : 0;
        if (s !== side || y === H) {
          if (side && run >= 0) segs.push({ x0: x, y0: run, x1: x, y1: y, n: side });
          run = s ? y : -1; side = s;
        }
      }
    }
    return segs;
  }

  function boxInto(arr, x0, y0, z0, x1, y1, z1, uvFt) {
    // six faces, two triangles each; uv from world xz (top) or along the face (sides)
    const P = arr.pos; const N = arr.nor; const U = arr.uv;
    const quad = (a, b, c, d, n, uva, uvb, uvc, uvd) => {
      for (const [p, uv] of [[a, uva], [b, uvb], [c, uvc], [a, uva], [c, uvc], [d, uvd]]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); U.push(uv[0], uv[1]); }
    };
    const u = (v) => v / uvFt;
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], [u(x0), u(z0)], [u(x0), u(z1)], [u(x1), u(z1)], [u(x1), u(z0)]);
    quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], [0, 0], [0, 1], [1, 1], [1, 0]);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [u(x0), 0], [u(x1), 0], [u(x1), u(y1 - y0)], [u(x0), u(y1 - y0)]);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [u(x1), 0], [u(x0), 0], [u(x0), u(y1 - y0)], [u(x1), u(y1 - y0)]);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u(z1), 0], [u(z0), 0], [u(z0), u(y1 - y0)], [u(z1), u(y1 - y0)]);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u(z0), 0], [u(z1), 0], [u(z1), u(y1 - y0)], [u(z0), u(y1 - y0)]);
  }
  function geomOf(THREE, arr) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
    return g;
  }

  function labelSprite(THREE, text) {
    const cv = document.createElement('canvas'); const g = cv.getContext('2d');
    const fs = 44; g.font = `600 ${fs}px Geist, system-ui, sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + 36; cv.width = w; cv.height = fs + 26;
    g.font = `600 ${fs}px Geist, system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.92)';
    const r = 18; g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, cv.height, r); g.arcTo(w, cv.height, 0, cv.height, r); g.arcTo(0, cv.height, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
    g.fillStyle = '#221E1A'; g.textBaseline = 'middle'; g.fillText(text, 18, cv.height / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = 1.5; sp.scale.set((h * w) / cv.height, h, 1);
    sp.renderOrder = 10;
    return sp;
  }

  /* ───────────── stairs ───────────── */

  const IN = 1 / 12;
  /** Flights that belong together: a root flight and the ones that start on its landing, in order. */
  function stairChains(stairs) {
    const byId = new Map(stairs.map((s) => [s.id, s]));
    const kids = new Map();
    stairs.forEach((s) => { if (s.starts_on_landing_of && byId.has(s.starts_on_landing_of)) { const k = s.starts_on_landing_of; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(s); } });
    const roots = stairs.filter((s) => !s.starts_on_landing_of || !byId.has(s.starts_on_landing_of));
    return roots.map((root) => {
      const out = []; const walk = (s, parent) => { out.push({ stair: s, parent }); (kids.get(s.id) || []).forEach((k) => walk(k, s)); };
      walk(root, null);
      return out;
    }).filter((ch) => ch.some((f) => (f.stair.steps || []).length));
  }

  /**
   * One stair (all its flights and landings) in its own coordinates (feet, base at y=0, first flight
   * climbing toward -z). Each step is a group (tread, riser, nosing, the mass under it, rail posts)
   * so the presentation can bring them in one by one.
   */
  function buildStair(THREE, chain, kit) {
    const root = new THREE.Group();
    const steps = []; const flights = new Map(); const picks = [];
    const left = (d) => ({ x: d.z, z: -d.x });
    const rot = (d) => Math.atan2(d.x, d.z);
    let treads = 0; let risers = 0; let landings = 0;
    const state = new Map(); // flight id → { end:{x,z}, d, e, w }

    const addBox = (grp, across, h, along, p, y, d, mat, opts) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(across, h, along), mat);
      mesh.position.set(p.x - grp.position.x, y + h / 2 - grp.position.y, p.z - grp.position.z);
      mesh.rotation.y = rot(d);
      mesh.castShadow = !(opts && opts.noShadow); mesh.receiveShadow = true;
      grp.add(mesh);
      return mesh;
    };
    const beam = (grp, a, b, r, mat) => {
      const A = new THREE.Vector3(a.x - grp.position.x, a.y - grp.position.y, a.z - grp.position.z);
      const B = new THREE.Vector3(b.x - grp.position.x, b.y - grp.position.y, b.z - grp.position.z);
      const len = A.distanceTo(B); if (len < 0.01) return null;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      m.castShadow = true; grp.add(m); return m;
    };

    chain.forEach(({ stair: st, parent }) => {
      const comps = (st.steps || []).filter((c) => c.kind === 'riser' ? (c.riser_h || c.riser_w) : (c.tread_w || c.tread_d || c.riser_h));
      if (!comps.length) return;
      const w = ((Number(comps.find((c) => c.tread_w)?.tread_w) || Number(comps[0].riser_w) || 36)) * IN;
      let d = { x: 0, z: -1 }; let start = { x: 0, z: 0 }; let e = 0;
      const ps = parent && state.get(parent.id);
      if (ps) {
        const turn = st.turn || 'straight';
        const L = left(ps.d);
        e = ps.e;
        if (ps.landing) {
          const ld = ps.landing.depth; const lw = ps.landing.width;
          const lc = { x: ps.end.x + ps.d.x * ld / 2 + ps.landing.shift * L.x, z: ps.end.z + ps.d.z * ld / 2 + ps.landing.shift * L.z };
          if (turn === 'left' || turn === 'right') {
            const s = turn === 'left' ? 1 : -1; d = { x: L.x * s, z: L.z * s };
            start = { x: lc.x + d.x * lw / 2, z: lc.z + d.z * lw / 2 };
          } else if (turn === 'u_left' || turn === 'u_right') {
            const s = turn === 'u_left' ? 1 : -1; d = { x: -ps.d.x, z: -ps.d.z };
            const off = (ps.w / 2 + w / 2 + 2 * IN) * s;
            start = { x: ps.end.x + L.x * off, z: ps.end.z + L.z * off };
          } else { d = ps.d; start = { x: ps.end.x + ps.d.x * ld, z: ps.end.z + ps.d.z * ld }; }
        } else { d = ps.d; start = ps.end; }
      }
      const L = left(d);
      const wood = kit.wood(st); const riserMat = st.riser_material === 'primed' || st.riser_material === 'paint_grade' ? kit.paint : wood;
      let a = 0; let first = true; const railPts = { l: [], r: [] };
      const flightSteps = [];
      comps.forEach((c, ci) => {
        const rise = (Number(c.riser_h) || 7.5) * IN;
        const run = c.kind === 'riser' ? 0 : (Number(c.tread_d) || 10.5) * IN;
        const p0 = { x: start.x + d.x * a, z: start.z + d.z * a };
        const grp = new THREE.Group();
        const mid = { x: start.x + d.x * (a + run / 2), z: start.z + d.z * (a + run / 2) };
        grp.position.set(mid.x, e, mid.z);
        root.add(grp);
        const T = 1 * IN; const nose = 1.1 * IN;
        const open = c.open || 'none';
        const hasRiser = c.kind === 'riser' ? st.riser_material !== 'none' : !c.no_riser && st.riser_material !== 'none';
        if (hasRiser) { addBox(grp, w, rise - (c.kind === 'riser' ? 0 : T), 0.75 * IN, { x: p0.x + d.x * 0.04, z: p0.z + d.z * 0.04 }, e, d, riserMat); risers += 1; }
        if (c.kind !== 'riser') {
          const ovL = open === 'left' || open === 'both' ? 1.2 * IN : 0; const ovR = open === 'right' || open === 'both' ? 1.2 * IN : 0;
          const across = w + ovL + ovR; const shift = (ovL - ovR) / 2;
          const tc = { x: start.x + d.x * (a + run / 2 - nose / 2) + L.x * shift, z: start.z + d.z * (a + run / 2 - nose / 2) + L.z * shift };
          const tread = addBox(grp, across, T, run + nose, tc, e + rise - T, d, wood);
          tread.userData = { pick: true, stair: st, counted: true };
          picks.push(tread);
          treads += 1;
          // the mass under the step, down to the floor
          const mc = { x: start.x + d.x * (a + run / 2), z: start.z + d.z * (a + run / 2) };
          addBox(grp, w - 0.06, Math.max(0.05, e + rise - T), run, mc, 0, d, kit.mass, { noShadow: false });
          // rail posts (two balusters per tread) on open sides
          [['l', 1, open === 'left' || open === 'both'], ['r', -1, open === 'right' || open === 'both']].forEach(([k, s, on]) => {
            if (!on) return;
            const off = (w / 2 - 1.8 * IN) * s;
            [0.28, 0.72].forEach((f) => {
              const bp = { x: start.x + d.x * (a + run * f) + L.x * off, z: start.z + d.z * (a + run * f) + L.z * off };
              addBox(grp, 1.5 * IN, 2.85, 1.5 * IN, bp, e + rise, d, kit.paint);
            });
            railPts[k].push({ x: start.x + d.x * (a + run / 2) + L.x * off, y: e + rise + 2.95, z: start.z + d.z * (a + run / 2) + L.z * off });
          });
        }
        e += rise; a += run;
        grp.userData.kind = c.kind === 'riser' ? 'riser' : 'step'; grp.userData.riser = hasRiser;
        steps.push(grp); flightSteps.push(grp);
        first = false; void first; void ci;
      });
      const end = { x: start.x + d.x * a, z: start.z + d.z * a };
      // landing at the top of this flight
      let landing = null;
      if (st.landing && st.landing.enabled) {
        const kidsOf = chain.filter((f) => f.parent && f.parent.id === st.id);
        const kid = kidsOf[0] && kidsOf[0].stair;
        const kw = kid ? (Number((kid.steps || []).find((c) => c.tread_w)?.tread_w) || 36) * IN : w;
        const uturn = kid && /^u_/.test(kid.turn || '');
        const ld = (Number(st.landing.depth) || 0) * IN || Math.max(w, kw);
        const lw = uturn ? w + kw + 2 * IN : Math.max((Number(st.landing.width) || 0) * IN || w, w);
        const shift = uturn ? ((kid.turn === 'u_left' ? 1 : -1) * (kw + 2 * IN)) / 2 : 0;
        landing = { depth: ld, width: lw, shift };
        const lc = { x: end.x + d.x * ld / 2 + L.x * shift, z: end.z + d.z * ld / 2 + L.z * shift };
        const grp = new THREE.Group(); grp.position.set(lc.x, e, lc.z); root.add(grp);
        const top = addBox(grp, lw, 1 * IN, ld, lc, e - 1 * IN, d, wood);
        top.userData = { pick: true, stair: st, counted: true, landing: true };
        picks.push(top);
        addBox(grp, lw - 0.06, Math.max(0.05, e - 1 * IN), ld - 0.04, lc, 0, d, kit.mass);
        grp.userData.kind = 'landing';
        steps.push(grp); landings += 1;
      }
      // hand rail along each open side
      ['l', 'r'].forEach((k) => {
        const pts = railPts[k]; if (pts.length < 2) return;
        const grp = flightSteps[flightSteps.length - 1];
        beam(grp, pts[0], pts[pts.length - 1], 1.4 * IN, kit.rail);
      });
      state.set(st.id, { end, d, e, w, landing });
      flights.set(st.id, { center: { x: start.x + d.x * a / 2, z: start.z + d.z * a / 2 }, d, base: ps ? ps.e : 0, len: a, w });
    });
    return { root, steps, flights, picks, counts: { treads, risers, landings } };
  }

  /* ───────────── vents ───────────── */

  const NO_VENT_ROOM = /closet|w\.?\s?i\.?\s?c|bath|powder|pantry|laundry|steam|water closet|mech|garage|porch|deck|patio|stair/i;
  /** Cells next to a wall in a room, spread around it: where registers usually sit. */
  function wallSpots(roomGrid, rm, gw, gh) {
    const pts = [];
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x; if (roomGrid[i] !== rm) continue;
      const up = roomGrid[i - gw] !== rm; const dn = roomGrid[i + gw] !== rm; const lf = roomGrid[i - 1] !== rm; const rt = roomGrid[i + 1] !== rm;
      if (up || dn || lf || rt) pts.push({ x, y, horiz: up || dn, inward: up ? 1 : dn ? -1 : lf ? 1 : -1 });
    }
    if (!pts.length) return pts;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length; const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    return pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  }

  /* ───────────── viewer ───────────── */

  /** Edges between cells that need a wall: [{x0,y0,x1,y1,kind,out}] (cells, kind 'ext'|'int', out = side of the outside). */
  function wallEdges(floor, house, room, W, H) {
    const segs = [];
    const at = (a, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : a[y * W + x]);
    const kindOf = (ax, ay, bx, by) => {
      const ha = at(house, ax, ay); const hb = at(house, bx, by);
      if (ha !== hb) return { k: 'ext', out: ha ? 1 : -1 };
      if (!ha) return null;
      const fa = at(floor, ax, ay); const fb = at(floor, bx, by);
      if (Boolean(fa) !== Boolean(fb)) return { k: 'int', out: 0 };
      if (fa && fa !== fb) return { k: 'int', out: 0 };
      return null;
    };
    for (let y = 0; y <= H; y++) {
      let run = -1; let cur = null;
      for (let x = 0; x <= W; x++) {
        const e = x < W ? kindOf(x, y - 1, x, y) : null;
        const same = e && cur && e.k === cur.k && e.out === cur.out;
        if (!same) {
          if (cur) segs.push({ x0: run, y0: y, x1: x, y1: y, kind: cur.k, out: cur.out, horiz: true });
          cur = e; run = x;
        }
      }
    }
    for (let x = 0; x <= W; x++) {
      let run = -1; let cur = null;
      for (let y = 0; y <= H; y++) {
        const e = y < H ? kindOf(x - 1, y, x, y) : null;
        const same = e && cur && e.k === cur.k && e.out === cur.out;
        if (!same) {
          if (cur) segs.push({ x0: x, y0: run, x1: x, y1: y, kind: cur.k, out: cur.out, horiz: false });
          cur = e; run = y;
        }
      }
    }
    return segs;
  }

  /** Floor cells plus the closed holes inside them (rooms without flooring, stairs) = the house. */
  function houseOf(floor, W, H) {
    const out = new Uint8Array(W * H);
    const seen = new Uint8Array(W * H); const stack = [];
    for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (seen[p] || floor[p]) continue;
      seen[p] = 1;
      const x = p % W; const y = (p - x) / W;
      if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W);
    }
    for (let i = 0; i < out.length; i++) out[i] = floor[i] || !seen[i] ? 1 : 0;
    return out;
  }

  const CUT = 0.42; const STORY = 10; const SLAB = 0.9; const FLOOR_T = 0.12; const WALL_H = 8.2; const EXT_T = 0.55; const INT_T = 0.35; const GAP = 9;

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  async function mount(el, plan, opts) {
    const THREE = await loadThree();
    opts = opts || {};
    plan = plan || { levels: [], materials: [] };
    const mats = plan.materials || [];
    const levels = (plan.levels || []).filter((l) => l.include && l.grid && l.rooms && l.rooms.length).sort((a, b) => a.floor - b.floor);
    const W = el.clientWidth || 600; const H = el.clientHeight || 420;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: Boolean(opts.preserve) });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xf3f1ee, 1);
    el.appendChild(renderer.domElement);
    const cv = renderer.domElement;
    cv.style.touchAction = 'none';
    cv.setAttribute('aria-label', '3D model of the house with the floors, stairs and vents');
    cv.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    scene.environment = studioEnv(THREE, renderer);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9ab98, 0.7));
    const sun = new THREE.DirectionalLight(0xffeedd, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 4;
    scene.add(sun); scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xe8eef8, 0.45); fill.position.set(-60, 40, -80); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(36, W / H, 0.5, 5000);

    // bounds of all floors (ft) to center the house
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const decoded = levels.map((l) => {
      const cells = decode(l.grid); const c = l.grid.cell;
      for (let y = 0; y < l.grid.h; y++) for (let x = 0; x < l.grid.w; x++) if (cells[y * l.grid.w + x]) { minX = Math.min(minX, x * c); maxX = Math.max(maxX, (x + 1) * c); minY = Math.min(minY, y * c); maxY = Math.max(maxY, (y + 1) * c); }
      return cells;
    });
    const noHouse = !isFinite(minX);
    if (noHouse) { minX = 0; maxX = 16; minY = 0; maxY = 16; }
    const cx = (minX + maxX) / 2; const cz = (minY + maxY) / 2;
    let span = Math.max(maxX - minX, maxY - minY, 20);

    const finishes = mats.map((m, i) => finishFor(THREE, m, i));
    const matIndex = new Map(mats.map((m, i) => [m.key, i]));
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.92 });
    const intMat = new THREE.MeshStandardMaterial({ color: 0xeee9e2, roughness: 0.92 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xc9c3ba, roughness: 0.95 });
    const offMat = () => new THREE.MeshStandardMaterial({ color: 0xdedad3, roughness: 0.9 });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xcfc6ba, transparent: true, opacity: 0.8 });
    const woodCache = new Map();
    const kit = {
      wood(st) {
        const base = woodColor([st.species, st.color].filter(Boolean).join(' '));
        if (!woodCache.has(base)) {
          const tex = new THREE.CanvasTexture(grainCanvas(base, base.length * 7)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
          woodCache.set(base, new THREE.MeshStandardMaterial({ map: tex, color: 0xd9c2a8, roughness: 0.34, metalness: 0, envMapIntensity: 0.8 }));
        }
        return woodCache.get(base);
      },
      paint: new THREE.MeshStandardMaterial({ color: 0xf7f4ef, roughness: 0.55 }),
      mass: new THREE.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.92 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.35 }),
    };
    const groups = [];
    const pickables = [];
    const floorsByOrder = [];
    const stairSets = [];
    const ventMeshes = []; const ventPins = [];
    let sfTotal = 0;

    levels.forEach((lv, li) => {
      const cells = decoded[li]; const gw = lv.grid.w; const gh = lv.grid.h; const c = lv.grid.cell;
      const roomGrid = lv.grid.rooms ? decodeRooms(lv.grid.rooms, gw * gh) : null;
      const group = new THREE.Group(); group.userData = { id: lv.id, name: lv.name, index: li };
      const X = (v) => v * c - cx; const Z = (v) => v * c - cz;

      // floors: one mesh per room (so a room can be picked and lit up), else per floor type
      const buckets = new Map();
      const keyOf = (i) => {
        const rm = roomGrid ? roomGrid[i] : 0;
        return rm && lv.rooms[rm - 1] ? `r${rm}` : `m${cells[i]}`;
      };
      const tagged = new Int32Array(gw * gh);
      const ids = new Map(); let nid = 0;
      for (let i = 0; i < cells.length; i++) {
        if (!cells[i]) continue;
        const k = keyOf(i);
        if (!ids.has(k)) ids.set(k, ++nid);
        tagged[i] = ids.get(k);
      }
      const byId = new Map([...ids.entries()].map(([k, v]) => [v, k]));
      for (const r of rects(tagged, gw, gh)) {
        const k = byId.get(r.v);
        if (!buckets.has(k)) buckets.set(k, { pos: [], nor: [], uv: [], x: 0, n: 0 });
        const b = buckets.get(k); b.x += (r.x + r.w / 2) * r.w * r.h; b.n += r.w * r.h;
        boxInto(b, X(r.x), 0, Z(r.y), X(r.x + r.w), FLOOR_T, Z(r.y + r.h), 4);
      }
      for (const [k, arr] of buckets) {
        let room = null; let mi = -1;
        if (k[0] === 'r') { room = lv.rooms[Number(k.slice(1)) - 1]; mi = matIndex.has(room.material) ? matIndex.get(room.material) : -1; } else mi = Number(k.slice(1)) - 1;
        const m = mats[mi]; const f = finishes[mi];
        const counted = Boolean(m && m.include && !(room && room.exclude));
        if (f && f.repeatFt !== 4) for (let i = 0; i < arr.uv.length; i++) arr.uv[i] *= 4 / f.repeatFt;
        const material = f
          ? new THREE.MeshStandardMaterial({ map: f.tex, bumpMap: f.bumpTex, bumpScale: f.bump, roughness: f.rough, metalness: 0, color: counted ? 0xe8dccf : 0xb9b5ae, envMapIntensity: 0.6 })
          : offMat();
        const mesh = new THREE.Mesh(geomOf(THREE, arr), material);
        mesh.receiveShadow = true;
        mesh.userData = { pick: true, level: lv, room, mat: m || null, counted, area: room ? room.area_sf : 0, cx: arr.x / Math.max(1, arr.n) };
        if (counted && room) sfTotal += room.area_sf || 0;
        group.add(mesh); pickables.push(mesh); floorsByOrder.push(mesh);
      }

      // slab under the whole house of this level
      const house = houseOf(cells, gw, gh);
      const slab = { pos: [], nor: [], uv: [] };
      for (const r of rects(house, gw, gh)) boxInto(slab, X(r.x), -SLAB, Z(r.y), X(r.x + r.w), 0, Z(r.y + r.h), 4);
      if (slab.pos.length) { const sm = new THREE.Mesh(geomOf(THREE, slab), slabMat); sm.receiveShadow = true; sm.castShadow = true; group.add(sm); }

      // walls: outside of the house, around rooms without flooring, between different floors
      const ext = { pos: [], nor: [], uv: [] }; const int = { pos: [], nor: [], uv: [] };
      for (const s of wallEdges(cells, house, roomGrid, gw, gh)) {
        const T = s.kind === 'ext' ? EXT_T : INT_T;
        const arr = s.kind === 'ext' ? ext : int;
        const h = s.kind === 'ext' ? WALL_H : WALL_H - 0.4;
        if (s.horiz) {
          const z = Z(s.y0); const z0 = s.kind === 'ext' ? (s.out > 0 ? z : z - T) : z - T / 2;
          boxInto(arr, X(s.x0) - (s.kind === 'ext' ? T : 0), FLOOR_T, z0, X(s.x1) + (s.kind === 'ext' ? T : 0), FLOOR_T + h, z0 + T, 4);
        } else {
          const x = X(s.x0); const x0 = s.kind === 'ext' ? (s.out > 0 ? x : x - T) : x - T / 2;
          boxInto(arr, x0, FLOOR_T, Z(s.y0), x0 + T, FLOOR_T + h, Z(s.y1), 4);
        }
      }
      const wallGroup = new THREE.Group();
      for (const [arr, mat] of [[ext, wallMat], [int, intMat]]) {
        if (!arr.pos.length) continue;
        const g = geomOf(THREE, arr);
        const wm = new THREE.Mesh(g, mat); wm.castShadow = true; wm.receiveShadow = true;
        wallGroup.add(wm);
        wallGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), lineMat));
      }
      wallGroup.scale.y = CUT;
      group.add(wallGroup);
      group.userData.walls = wallGroup;

      const labels = new THREE.Group();
      lv.rooms.forEach((r) => {
        if (r.exclude || r.area_sf < 55 || !r.name) return;
        const sp = labelSprite(THREE, r.name);
        sp.position.set(r.x - cx, FLOOR_T + 1.4, r.y - cz);
        labels.add(sp);
      });
      group.add(labels);
      group.userData.labels = labels;
      group.userData.roomGrid = roomGrid; group.userData.X = X; group.userData.Z = Z;
      scene.add(group);
      groups.push(group);
    });

    // ── stairs: each stair (flights + landings) built once, then set where the plan shows it ──
    const chains = stairChains(opts.stairs || []);
    let besideX = (maxX - cx) + 5;
    chains.forEach((chain) => {
      const built = buildStair(THREE, chain, kit);
      if (!built.steps.length) return;
      const holder = new THREE.Group(); holder.add(built.root);
      let placed = false;
      for (const { stair } of chain) {
        const ps = (plan.stairs || []).find((x) => x.stair_id === stair.id && !x.dismissed && !x.same_as);
        const fl = built.flights.get(stair.id);
        if (!ps || !fl) continue;
        const li = levels.findIndex((l) => (ps.level_id ? l.id === ps.level_id : l.page === ps.page));
        if (li < 0) continue;
        const lv = levels[li];
        const sheetWft = lv.sheet_pt_w ? lv.sheet_pt_w / lv.scale_ppf : lv.grid.w * lv.grid.cell;
        const sheetHft = lv.sheet_pt_h ? lv.sheet_pt_h / lv.scale_ppf : lv.grid.h * lv.grid.cell;
        const bx0 = ps.fx0 * sheetWft - cx; const bx1 = ps.fx1 * sheetWft - cx;
        const bz0 = ps.fy0 * sheetHft - cz; const bz1 = ps.fy1 * sheetHft - cz;
        const alongZ = (bz1 - bz0) >= (bx1 - bx0);
        const dT = alongZ ? { x: 0, z: ps.flip ? 1 : -1 } : { x: ps.flip ? 1 : -1, z: 0 };
        const phi = Math.atan2(dT.x, dT.z) - Math.atan2(fl.d.x, fl.d.z);
        built.root.rotation.y = phi;
        const cs = Math.cos(phi); const sn = Math.sin(phi);
        const rc = { x: fl.center.x * cs + fl.center.z * sn, z: -fl.center.x * sn + fl.center.z * cs };
        built.root.position.set((bx0 + bx1) / 2 - rc.x, FLOOR_T, (bz0 + bz1) / 2 - rc.z);
        groups[li].add(holder);
        placed = true;
        break;
      }
      if (!placed) {
        // not on the plan: stands next to the house, on the lowest floor
        const box = new THREE.Box3().setFromObject(built.root);
        built.root.position.set(besideX - box.min.x, FLOOR_T, -(box.min.z + box.max.z) / 2);
        besideX += (box.max.x - box.min.x) + 4;
        if (groups[0]) groups[0].add(holder); else scene.add(holder);
        if (noHouse) span = Math.max(span, besideX - (maxX - cx));
      }
      built.picks.forEach((m) => { m.userData.level = { id: '', name: chain[0].stair.name || 'Stair' }; pickables.push(m); });
      stairSets.push({ ...built, holder, name: chain.map((f) => f.stair.name).filter(Boolean).join(' + ') });
    });

    // ── vents: registers by the walls of their room (or spread over the living rooms) ──
    const vents = (opts.vents || []).flatMap((v) => Array.from({ length: Math.min(40, Math.max(1, Number(v.qty) || 1)) }, () => v)).slice(0, 80);
    if (vents.length && groups.length) {
      const rooms = [];
      levels.forEach((lv, li) => {
        const rg = groups[li].userData.roomGrid; if (!rg) return;
        lv.rooms.forEach((r, ri) => { if (!r.exclude && r.area_sf >= 40 && r.name) rooms.push({ lv, li, r, rm: ri + 1, used: 0 }); });
      });
      const living = rooms.filter((x) => !NO_VENT_ROOM.test(x.r.name)).sort((a, b) => b.r.area_sf - a.r.area_sf);
      const pool = living.length ? living : rooms;
      const plan2 = new Map();
      let rr = 0;
      vents.forEach((v) => {
        const want = String(v.room || '').trim().toLowerCase();
        let target = want ? rooms.find((x) => x.r.name.toLowerCase() === want) || rooms.find((x) => x.r.name.toLowerCase().includes(want)) : null;
        if (!target && pool.length) { target = pool[rr % pool.length]; rr += 1; }
        if (!target) return;
        if (!plan2.has(target)) plan2.set(target, []);
        plan2.get(target).push(v);
      });
      const texCache = new Map();
      const pcv = document.createElement('canvas'); pcv.width = pcv.height = 96; const pg = pcv.getContext('2d');
      pg.fillStyle = 'rgba(231,121,44,.25)'; pg.beginPath(); pg.arc(48, 48, 46, 0, 7); pg.fill();
      pg.fillStyle = '#E7792C'; pg.beginPath(); pg.arc(48, 48, 30, 0, 7); pg.fill();
      pg.fillStyle = '#fff'; for (let k = 0; k < 4; k++) pg.fillRect(32 + k * 9, 36, 4, 24);
      const ptex = new THREE.CanvasTexture(pcv); ptex.colorSpace = THREE.SRGBColorSpace;
      const pinMat = new THREE.SpriteMaterial({ map: ptex, depthTest: false, transparent: true });
      plan2.forEach((list, t) => {
        const lv = t.lv; const g = groups[t.li]; const c = lv.grid.cell;
        const spots = wallSpots(g.userData.roomGrid, t.rm, lv.grid.w, lv.grid.h);
        if (!spots.length) return;
        list.forEach((v, k) => {
          const sp = spots[Math.floor(((k + 0.5) / list.length) * spots.length) % spots.length];
          const m = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i.exec(String(v.size || '4x10'));
          const a = (m ? Number(m[1]) : 4) * IN; const b = (m ? Number(m[2]) : 10) * IN;
          const base = woodColor([v.species, v.color].join(' '), '#8C8781');
          const key = `${base}`;
          if (!texCache.has(key)) { const tx = new THREE.CanvasTexture(ventCanvas(base)); tx.colorSpace = THREE.SRGBColorSpace; texCache.set(key, new THREE.MeshStandardMaterial({ map: tx, roughness: 0.45 })); }
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(sp.horiz ? b : a, 0.03, sp.horiz ? a : b), texCache.get(key));
          const inset = 0.7;
          const px = g.userData.X(sp.x + 0.5) + (sp.horiz ? 0 : sp.inward * inset);
          const pz = g.userData.Z(sp.y + 0.5) + (sp.horiz ? sp.inward * inset : 0);
          mesh.position.set(px, FLOOR_T + 0.016, pz);
          mesh.receiveShadow = true;
          mesh.userData = { pick: true, level: lv, vent: v, room: t.r, counted: true };
          g.add(mesh); pickables.push(mesh); ventMeshes.push(mesh);
          const pin = new THREE.Sprite(pinMat); pin.scale.set(2, 2, 1); pin.position.set(px, FLOOR_T + 1.6, pz); pin.visible = false; pin.renderOrder = 11;
          g.add(pin); ventPins.push(pin); mesh.userData.pin = pin;
        });
      });
    }

    // ground: catches the sun's shadow, plus a soft glow under the house
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 6, span * 6), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -SLAB - 0.04; ground.receiveShadow = true; scene.add(ground);
    const shCv = document.createElement('canvas'); shCv.width = shCv.height = 128;
    const shG = shCv.getContext('2d'); const grd = shG.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, 'rgba(60,50,40,.22)'); grd.addColorStop(1, 'rgba(60,50,40,0)'); shG.fillStyle = grd; shG.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX) * 1.6, (maxY - minY) * 1.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCv), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = -SLAB - 0.03; scene.add(blob);

    let explode = opts.separate ? 1 : 0; let explodeTo = explode;
    function layout() { groups.forEach((g, i) => { g.position.y = i * (STORY + GAP * explode); }); }
    layout();
    const stackH = () => Math.max(0, groups.length - 1) * (STORY + GAP * explode) + WALL_H;
    function aimSun() {
      const h = stackH();
      sun.position.set(span * 0.55, h + span * 1.1, span * 0.42); sun.target.position.set(0, h / 3, 0);
      const s = span * 0.85 + h * 0.4; const cam = sun.shadow.camera;
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 1; cam.far = span * 4 + h * 2; cam.updateProjectionMatrix();
    }
    aimSun();

    // camera orbit with inertia (drag to turn, pinch/wheel to zoom, two fingers or right-drag to move)
    let focus = null;
    const tall = () => Math.max(1, 1.15 / Math.max(0.3, camera.aspect));
    const fitDist = () => (focus ? span * 1.0 : Math.max(span * 1.25, stackH() * 2.6)) * tall();
    const midY = () => (focus ? focus.position.y + 2 : stackH() / 2 - 1);
    const target = new THREE.Vector3(0, midY(), 0);
    let theta = -0.65; let phi = 0.8; let dist = fitDist();
    let vT = 0; let vP = 0;
    let auto = !opts.still;
    function place() {
      phi = Math.max(0.12, Math.min(1.48, phi)); dist = Math.max(span * 0.08, Math.min(span * 5, dist));
      camera.position.set(target.x + dist * Math.sin(phi) * Math.sin(theta), target.y + dist * Math.cos(phi), target.z + dist * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
    }
    place();

    // ── picking, tooltip and legend ──
    el.style.position = el.style.position || 'relative';
    const tip = document.createElement('div'); tip.className = 'ob3d-tip'; tip.hidden = true; el.appendChild(tip);
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let hover = null; let pinned = null; let legendKey = null; let legendPinned = null;
    const glow = new Map();
    function paintMeshes() {
      const lk = legendPinned || legendKey;
      const hot = new Set([hover, pinned].filter(Boolean));
      // a stair lights up as a whole
      [...hot].forEach((h) => { if (h.userData.stair) pickables.forEach((m) => { if (m.userData.stair === h.userData.stair) hot.add(m); }); });
      for (const m of pickables) {
        if (!m.userData.room && !m.userData.mat) continue; // floors only dim/light; stairs and vents below
        const dim = lk && !(m.userData.mat && m.userData.mat.key === lk && m.userData.counted);
        const lit = lk && !dim;
        if (m.material.emissive) m.material.emissive.setHex(hot.has(m) ? 0x5a3412 : lit ? 0x3a220c : 0x000000);
        m.material.transparent = Boolean(dim) || m.userData.fading;
        if (!m.userData.fading) m.material.opacity = dim ? 0.28 : 1;
        m.material.needsUpdate = true;
      }
      pickables.forEach((m) => {
        if (!(m.userData.stair || m.userData.vent)) return;
        const on = hot.has(m);
        if (on && !glow.has(m)) { const mat = m.material.clone(); mat.emissive = new THREE.Color(0x5a3412); glow.set(m, m.material); m.material = mat; }
        if (!on && glow.has(m)) { m.material.dispose(); m.material = glow.get(m); glow.delete(m); }
      });
      need();
    }
    function placeTip(x, y) {
      tip.hidden = false;
      const bw = el.clientWidth; const tw = tip.offsetWidth || 180;
      tip.style.left = `${Math.min(bw - tw - 8, Math.max(8, x + 14))}px`;
      tip.style.top = `${Math.max(8, y - 64)}px`;
    }
    function tipFor(mesh, x, y) {
      if (!mesh) { tip.hidden = true; return; }
      const d = mesh.userData; const r = d.room;
      if (d.stair) {
        const set = stairSets.find((s) => s.picks.includes(mesh));
        const n = set ? set.counts : null;
        tip.innerHTML = `<strong>${escHtml(set ? set.name : d.stair.name || 'Stair')}</strong><span><i style="background:${escHtml(woodColor(d.stair.species))}"></i>${n ? `${n.treads} treads · ${n.risers} risers${n.landings ? ` · ${n.landings} landing${n.landings > 1 ? 's' : ''}` : ''}` : ''}</span><small>${escHtml([d.stair.species, d.stair.finish].filter(Boolean).join(' · ') || 'Stair')}</small>`;
        placeTip(x, y); return;
      }
      if (d.vent) {
        tip.innerHTML = `<strong>Vent · ${escHtml(String(d.vent.size || '').replace('x', '×'))}</strong><span><i style="background:${escHtml(woodColor(d.vent.species, '#8C8781'))}"></i>${escHtml({ flush: 'Flush mount', self_rimming: 'Self-rimming', return_air: 'Return air' }[d.vent.type] || d.vent.type || '')}</span><small>${escHtml([r && r.name, d.vent.species].filter(Boolean).join(' · '))}</small>`;
        placeTip(x, y); return;
      }
      const area = r ? r.area_sf : null;
      tip.innerHTML = `<strong>${escHtml(r ? r.name : (d.mat ? d.mat.label : 'Floor'))}</strong><span><i style="background:${d.mat ? escHtml(d.mat.color) : '#ccc'}"></i>${escHtml(d.mat ? d.mat.label : 'Not flooring')}${area != null ? ` · ${Math.round(area).toLocaleString('en-US')} SF` : ''}</span><small>${escHtml(d.level.name)}${d.counted ? '' : ' · not counted'}</small>`;
      placeTip(x, y);
    }
    function pickAt(clientX, clientY) {
      const rect = cv.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const vis = pickables.filter((m) => { let o = m; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
      const hit = ray.intersectObjects(vis, false)[0];
      return { mesh: hit ? hit.object : null, x: clientX - rect.left, y: clientY - rect.top };
    }

    let legend = null;
    if (opts.legend !== false) {
      const totals = new Map();
      for (const m of pickables) {
        const d = m.userData; if (!d.mat || !d.room || !d.counted) continue;
        totals.set(d.mat.key, (totals.get(d.mat.key) || 0) + d.room.area_sf);
      }
      const rows = mats.filter((m) => m.include && totals.get(m.key));
      const st = stairSets.reduce((a, s) => ({ t: a.t + s.counts.treads, r: a.r + s.counts.risers }), { t: 0, r: 0 });
      legend = document.createElement('div'); legend.className = 'ob3d-legend';
      legend.innerHTML = `${rows.length ? `<p>Floors</p>${rows.map((m) => `<button type="button" data-ob3d-mat="${escHtml(m.key)}" aria-pressed="false"><i style="background:${escHtml(m.color)}"></i><span>${escHtml(m.label)}</span><b>${Math.round(totals.get(m.key)).toLocaleString('en-US')} SF</b></button>`).join('')}` : ''}${stairSets.length ? `<button type="button" data-ob3d-go="stairs"><i style="background:${escHtml(woodColor((opts.stairs || [])[0] && opts.stairs[0].species))}"></i><span>Stairs</span><b>${st.t} treads</b></button>` : ''}${ventMeshes.length ? `<button type="button" data-ob3d-go="vents"><i style="background:#3a2a1e"></i><span>Vents</span><b>${(opts.vents || []).reduce((a, v) => a + (Number(v.qty) || 1), 0)}</b></button>` : ''}<small>Hover or tap to see it</small>`;
      el.appendChild(legend);
      legend.querySelectorAll('[data-ob3d-mat]').forEach((b) => {
        const k = b.getAttribute('data-ob3d-mat');
        b.addEventListener('mouseenter', () => { legendKey = k; paintMeshes(); });
        b.addEventListener('mouseleave', () => { legendKey = null; paintMeshes(); });
        b.addEventListener('focus', () => { legendKey = k; paintMeshes(); });
        b.addEventListener('blur', () => { legendKey = null; paintMeshes(); });
        b.addEventListener('click', () => {
          legendPinned = legendPinned === k ? null : k;
          legend.querySelectorAll('[data-ob3d-mat]').forEach((x) => x.setAttribute('aria-pressed', String(x.getAttribute('data-ob3d-mat') === legendPinned)));
          paintMeshes();
        });
      });
      legend.querySelectorAll('[data-ob3d-go]').forEach((b) => b.addEventListener('click', () => { auto = false; flyTo(b.getAttribute('data-ob3d-go'), 1100); }));
    }

    const ptrs = new Map(); let last = null; let pinch = null; let moved = 0;
    cv.addEventListener('pointerdown', (e) => { auto = false; vT = 0; vP = 0; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; pinch = null; moved = 0; });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const p = pickAt(e.clientX, e.clientY);
          if (p.mesh !== hover) { hover = p.mesh; paintMeshes(); }
          tipFor(hover || pinned, p.x, p.y);
          cv.style.cursor = hover ? 'pointer' : 'grab';
        }
        return;
      }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch) { dist *= pinch.d / d; pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y); }
        pinch = { d, mid }; moved += 10;
      } else if (last) {
        const dx = e.clientX - last.x; const dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (last.pan) pan(dx, dy); else { vT = -dx * 0.008; vP = -dy * 0.006; theta += vT; phi += vP; }
        last.x = e.clientX; last.y = e.clientY;
        tip.hidden = true;
      }
      place(); need();
    });
    const up = (e) => {
      const was = ptrs.has(e.pointerId);
      ptrs.delete(e.pointerId); if (!ptrs.size) last = null; pinch = null;
      if (was && moved < 6 && e.type === 'pointerup') {
        vT = 0; vP = 0;
        const p = pickAt(e.clientX, e.clientY);
        pinned = p.mesh && p.mesh !== pinned ? p.mesh : null;
        paintMeshes(); tipFor(pinned, p.x, p.y);
        if (opts.onPick) opts.onPick(pinned && pinned.userData.room ? { level: pinned.userData.level.id, room: pinned.userData.room } : null);
      } else if (was) need();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (hover) { hover = null; paintMeshes(); } if (!pinned) tip.hidden = true; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); auto = false; dist *= Math.exp(e.deltaY * 0.0012); place(); need(); }, { passive: false });
    cv.addEventListener('dblclick', () => reset());
    function pan(dx, dy) {
      const k = dist * 0.0016;
      const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
      const fwd = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
      target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
    }
    function reset() { theta = -0.65; phi = focus ? 0.68 : 0.8; dist = fitDist(); target.set(0, midY(), 0); place(); need(); }
    function only(id) {
      focus = id ? groups.find((g) => g.userData.id === id) || null : null;
      groups.forEach((g) => { g.visible = !focus || g === focus; });
      pinned = null; tip.hidden = true; paintMeshes();
      reset();
    }

    // ── tweens (presentation) ──
    const tweens = [];
    function tween(dur, fn, delay) {
      return new Promise((res) => { tweens.push({ t0: performance.now() + (delay || 0), dur: Math.max(1, dur), fn, res, started: false }); need(); });
    }
    /** Moves the camera to frame the house, the stairs or the vents. */
    function flyTo(what, ms) {
      let box = null;
      ventPins.forEach((p) => { p.visible = what === 'vents'; });
      if (what === 'stairs' && stairSets.length) {
        const main = stairSets.slice().sort((a, b) => b.counts.treads - a.counts.treads)[0];
        const top = groups.indexOf(main.holder.parent);
        groups.forEach((g, i) => { g.visible = top < 0 || i <= top; });
        box = new THREE.Box3().expandByObject(main.root);
      } else if (!focus) groups.forEach((g) => { g.visible = true; });
      if (what === 'vents' && ventMeshes.length) { box = new THREE.Box3(); ventMeshes.forEach((m) => box.expandByObject(m)); }
      const from = { tx: target.x, ty: target.y, tz: target.z, d: dist, th: theta, ph: phi };
      let to;
      if (box && !box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
        to = { tx: c.x, ty: c.y, tz: c.z, d: (what === 'vents' ? Math.max(30, Math.max(s.x, s.z) * 1.25) : Math.max(16, Math.max(s.x, s.y, s.z) * 1.7)) * tall(), th: theta + 0.5, ph: what === 'vents' ? 0.6 : 1.0 };
      } else {
        to = { tx: 0, ty: midY(), tz: 0, d: fitDist(), th: theta + 0.35, ph: 0.8 };
      }
      return tween(ms || 1400, (p) => {
        const k = ease(p);
        target.set(from.tx + (to.tx - from.tx) * k, from.ty + (to.ty - from.ty) * k, from.tz + (to.tz - from.tz) * k);
        dist = from.d + (to.d - from.d) * k; theta = from.th + (to.th - from.th) * k; phi = from.ph + (to.ph - from.ph) * k;
        place();
      });
    }

    let raf = 0; let dirty = true; let alive = true;
    function need() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!alive) return;
      if (!el.isConnected) { destroy(); return; }
      let anim = false;
      if (Math.abs(explode - explodeTo) > 0.002) { explode += (explodeTo - explode) * 0.18; layout(); aimSun(); target.y = midY(); dist = Math.max(dist, fitDist() * 0.7); place(); anim = true; dirty = true; } else if (explode !== explodeTo) { explode = explodeTo; layout(); aimSun(); dirty = true; }
      if (!ptrs.size && (Math.abs(vT) > 0.0004 || Math.abs(vP) > 0.0004)) { theta += vT; phi += vP; vT *= 0.92; vP *= 0.92; place(); anim = true; dirty = true; }
      if (auto) { theta += 0.0016; place(); dirty = true; }
      if (tweens.length) {
        const now = performance.now();
        for (let i = tweens.length - 1; i >= 0; i--) {
          const tw = tweens[i]; if (now < tw.t0) continue;
          const p = Math.min(1, (now - tw.t0) / tw.dur);
          tw.fn(p);
          if (p >= 1) { tweens.splice(i, 1); tw.res(); }
        }
        anim = true; dirty = true;
      }
      if (dirty) { renderer.render(scene, camera); dirty = false; }
      if (auto || anim) raf = requestAnimationFrame(frame);
    }
    need();
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth; const h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); need();
    });
    ro.observe(el);

    function destroy() {
      alive = false; ro.disconnect(); if (raf) cancelAnimationFrame(raf);
      tweens.splice(0).forEach((t) => t.res());
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
      [cv, tip, legend].forEach((n) => { if (n && n.parentNode) n.parentNode.removeChild(n); });
    }

    // ── presentation: the house builds itself ──
    const floorOrder = floorsByOrder.slice().sort((a, b) => (groups.indexOf(a.parent) - groups.indexOf(b.parent)) || (a.userData.cx - b.userData.cx));
    const present = {
      info: {
        sf: Math.round(sfTotal),
        levels: levels.length,
        stairs: stairSets.reduce((a, s) => ({ treads: a.treads + s.counts.treads, risers: a.risers + s.counts.risers, landings: a.landings + s.counts.landings }), { treads: 0, risers: 0, landings: 0 }),
        vents: ventMeshes.length,
      },
      /** Empty house: walls only. */
      clear() {
        floorOrder.forEach((m) => { m.visible = false; });
        stairSets.forEach((s) => s.steps.forEach((g) => { g.visible = false; }));
        ventMeshes.forEach((m) => { m.visible = false; });
        ventPins.forEach((p) => { p.visible = false; });
        groups.forEach((g) => { g.userData.labels.visible = false; });
        pinned = null; hover = null; tip.hidden = true; if (legend) legend.hidden = true;
        need();
      },
      /** Floors laid room by room; onTick(sf so far). */
      floors(ms, onTick) {
        const n = floorOrder.length; if (!n) return Promise.resolve();
        const each = Math.max(60, (ms || 4000) / n); let sf = 0;
        return Promise.all(floorOrder.map((m, i) => tween(520, (p) => {
          if (!m.userData.started) { m.userData.started = true; m.visible = true; m.userData.fading = true; m.material.transparent = true; }
          const k = easeOut(p);
          m.position.y = (1 - k) * 3.2; m.material.opacity = k;
          if (p >= 1) { m.userData.fading = false; m.material.transparent = false; m.material.opacity = 1; m.userData.started = false; if (m.userData.counted && m.userData.room) { sf += m.userData.room.area_sf || 0; if (onTick) onTick(sf); } }
        }, i * each)));
      },
      /** The stair assembled step by step; onTick({treads, risers, landings}). */
      async stairs(ms, onTick) {
        if (!stairSets.length) return;
        await flyTo('stairs', 1300);
        const all = stairSets.flatMap((s) => s.steps);
        const each = Math.max(70, (ms || 3200) / all.length); const c = { treads: 0, risers: 0, landings: 0 };
        await Promise.all(all.map((g, i) => tween(420, (p) => {
          if (p > 0 && !g.visible) { g.visible = true; }
          const k = easeOut(p); g.scale.set(1, Math.max(0.001, k), 1);
          g.userData.y0 = g.userData.y0 == null ? g.position.y : g.userData.y0; g.position.y = g.userData.y0 + (1 - k) * 1.6;
          if (p >= 1) {
            if (g.userData.kind === 'landing') c.landings += 1; else { if (g.userData.kind === 'step') c.treads += 1; if (g.userData.riser) c.risers += 1; }
            if (onTick) onTick({ ...c });
          }
        }, i * each)));
      },
      /** Vents pop in at their rooms; onTick(count). */
      async vents(ms, onTick) {
        if (!ventMeshes.length) return;
        await flyTo('vents', 1300);
        const each = Math.max(60, (ms || 2400) / ventMeshes.length); let n = 0;
        await Promise.all(ventMeshes.map((m, i) => tween(380, (p) => {
          if (p > 0) { m.visible = true; if (m.userData.pin) m.userData.pin.visible = true; }
          const k = easeOut(p); const s = 0.001 + k * (p < 1 ? 1.5 - 0.5 * k : 1);
          m.scale.set(s, 1, s);
          if (m.userData.pin) m.userData.pin.scale.set(2 * Math.max(0.01, k), 2 * Math.max(0.01, k), 1);
          if (p >= 1) { n += 1; if (onTick) onTick(n); }
        }, i * each)));
      },
      /** Everything in place. */
      showAll() {
        tweens.splice(0).forEach((t) => { try { t.fn(1); } catch (_) { /* done */ } t.res(); });
        floorOrder.forEach((m) => { m.visible = true; m.position.y = 0; m.material.opacity = 1; m.material.transparent = false; m.userData.fading = false; });
        stairSets.forEach((s) => s.steps.forEach((g) => { g.visible = true; g.scale.set(1, 1, 1); if (g.userData.y0 != null) g.position.y = g.userData.y0; }));
        ventMeshes.forEach((m) => { m.visible = true; m.scale.set(1, 1, 1); if (m.userData.pin) m.userData.pin.scale.set(2, 2, 1); });
        groups.forEach((g) => { g.userData.labels.visible = true; });
        if (legend) legend.hidden = false;
        need();
      },
      home(ms) { return flyTo('home', ms || 1400); },
      fly(what, ms) { return flyTo(what, ms); },
      hideStairs() { stairSets.forEach((st) => st.steps.forEach((g) => { g.visible = false; })); need(); },
      hideVents() { ventMeshes.forEach((m) => { m.visible = false; }); ventPins.forEach((p) => { p.visible = false; }); need(); },
      pins(on) { ventPins.forEach((p) => { p.visible = on; }); need(); },
      tour(on) { auto = Boolean(on); need(); },
      labels(on) { groups.forEach((g) => { g.userData.labels.visible = on; }); need(); },
    };

    const api = {
      destroy,
      reset,
      only,
      present,
      separate(on) { explodeTo = on ? 1 : 0; auto = false; need(); },
      walls(on) { groups.forEach((g) => { g.userData.walls.visible = on; }); need(); },
      showLevel(id, on) { const g = groups.find((x) => x.userData.id === id); if (g) { g.visible = on; need(); } },
      showLabels(on) { groups.forEach((g) => { g.userData.labels.visible = on; }); need(); },
      spin(on) { auto = on; need(); },
      highlight(levelId, roomIndex) {
        pinned = pickables.find((m) => m.userData.level && m.userData.level.id === levelId && m.userData.room === (m.userData.level.rooms || [])[roomIndex]) || null;
        paintMeshes();
      },
      levels: groups.map((g) => ({ id: g.userData.id, name: g.userData.name })),
      snapshot() {
        const savedTip = tip.hidden; tip.hidden = true;
        const keep = dist; dist = fitDist() * 0.62; place();
        renderer.render(scene, camera);
        const url = cv.toDataURL('image/jpeg', 0.86);
        dist = keep; place(); need();
        tip.hidden = savedTip;
        return url;
      },
      wallHeight(k) { groups.forEach((g) => { g.userData.walls.scale.y = k; }); need(); },
    };
    el.__ob3d = api;
    return api;
  }

  function decodeRooms(rle, n) {
    const out = new Int32Array(n); let i = 0;
    for (const part of String(rle || '').split(',')) {
      if (!part) continue;
      const [v, k] = part.split('x').map(Number);
      if (v) out.fill(v, i, i + k);
      i += k;
    }
    return out;
  }
  function escHtml(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  window.ObPlan3D = { mount, load: loadThree };
})();
