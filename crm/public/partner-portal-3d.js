/*
 * ObraBuilder — 3D view of a floor plan takeoff (three.js r128 from cdnjs).
 * Builds each level from the 0.5 ft floor grid: floors with the chosen finish (hardwood planks,
 * LVP planks, carpet, rubber…), low cut-away walls on the outline, room names, levels stacked.
 */
(function () {
  'use strict';

  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  let threeP = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!threeP) {
      threeP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = THREE_URL; s.async = true;
        s.onload = () => resolve(window.THREE);
        s.onerror = () => { threeP = null; reject(new Error('Could not load the 3D viewer.')); };
        document.head.appendChild(s);
      });
    }
    return threeP;
  }

  /* ───────────── finishes (drawn on a canvas) ───────────── */

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function shade(hex, f) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))))).join(',')})`;
  }

  /** Plank floor: rows of boards with random lengths, tone and grain. ft = feet the texture covers. */
  function plankCanvas(base, plankIn, seed) {
    const S = 512; const ft = 4; const pxIn = S / (ft * 12);
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d'); const r = rng(seed);
    const rowH = plankIn * pxIn;
    for (let y = 0; y < S; y += rowH) {
      let x = -r() * 40 * pxIn;
      while (x < S) {
        const len = (24 + r() * 48) * pxIn;
        const tone = (r() - 0.5) * 0.22;
        g.fillStyle = shade(base, tone);
        g.fillRect(x, y, len, rowH);
        // grain
        g.globalAlpha = 0.16;
        for (let k = 0; k < 6; k++) {
          g.strokeStyle = shade(base, tone - 0.25 - r() * 0.15);
          g.lineWidth = 0.6 + r();
          g.beginPath();
          const gy = y + r() * rowH;
          g.moveTo(x, gy);
          for (let t = 0; t <= 1; t += 0.1) g.lineTo(x + len * t, gy + Math.sin(t * 6 + r() * 3) * rowH * 0.12);
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(40,25,15,.45)';
        g.fillRect(x, y, 1.2, rowH);
        x += len;
      }
      g.fillStyle = 'rgba(40,25,15,.35)';
      g.fillRect(0, y, S, 1);
    }
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
  function tileCanvas(base) {
    const S = 256; const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, S - 3, S - 3);
    return cv;
  }

  const FINISH = {
    hardwood: { base: '#B98455', plank: 5 },
    lvp: { base: '#A99680', plank: 7 },
    laminate: { base: '#B79F80', plank: 7.5 },
  };

  function finishFor(THREE, mat, i) {
    let cv; let repeatFt = 4;
    if (FINISH[mat.kind]) cv = plankCanvas(FINISH[mat.kind].base, FINISH[mat.kind].plank, 7 + i * 13);
    else if (mat.kind === 'carpet') { cv = noiseCanvas(mat.color, 26, false, 3 + i); repeatFt = 3; }
    else if (mat.kind === 'rubber') { cv = noiseCanvas(shade(mat.color, -0.25), 18, true, 5 + i); repeatFt = 3; }
    else if (mat.kind === 'tile' || mat.kind === 'stone') { cv = tileCanvas(mat.color); repeatFt = 2; }
    else { cv = noiseCanvas(mat.color, 8, false, 9 + i); }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    return { tex, repeatFt };
  }

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

  const STORY = 10; const SLAB = 0.9; const FLOOR_T = 0.12; const WALL_H = 8.2; const EXT_T = 0.55; const INT_T = 0.35; const GAP = 9;

  async function mount(el, plan, opts) {
    const THREE = await loadThree();
    opts = opts || {};
    const mats = plan.materials || [];
    const levels = (plan.levels || []).filter((l) => l.include && l.grid && l.rooms && l.rooms.length).sort((a, b) => a.floor - b.floor);
    const W = el.clientWidth || 600; const H = el.clientHeight || 420;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: Boolean(opts.preserve) });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0xf3f1ee, 1);
    el.appendChild(renderer.domElement);
    const cv = renderer.domElement;
    cv.style.touchAction = 'none';
    cv.setAttribute('aria-label', '3D model of the house with the floors');
    cv.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6cfc4, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(70, 140, 50); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25); fill.position.set(-60, 40, -80); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 5000);

    // bounds of all floors (ft) to center the house
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const decoded = levels.map((l) => {
      const cells = decode(l.grid); const c = l.grid.cell;
      for (let y = 0; y < l.grid.h; y++) for (let x = 0; x < l.grid.w; x++) if (cells[y * l.grid.w + x]) { minX = Math.min(minX, x * c); maxX = Math.max(maxX, (x + 1) * c); minY = Math.min(minY, y * c); maxY = Math.max(maxY, (y + 1) * c); }
      return cells;
    });
    if (!isFinite(minX)) { minX = 0; maxX = 10; minY = 0; maxY = 10; }
    const cx = (minX + maxX) / 2; const cz = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 20);

    const finishes = mats.map((m, i) => finishFor(THREE, m, i));
    const matIndex = new Map(mats.map((m, i) => [m.key, i]));
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xf4f1ec });
    const intMat = new THREE.MeshLambertMaterial({ color: 0xebe6df });
    const slabMat = new THREE.MeshLambertMaterial({ color: 0xcfc8be });
    const offMat = () => new THREE.MeshLambertMaterial({ color: 0xdedad3 });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xbdb5aa });
    const groups = [];
    const pickables = [];

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
        if (!buckets.has(k)) buckets.set(k, { pos: [], nor: [], uv: [] });
        boxInto(buckets.get(k), X(r.x), 0, Z(r.y), X(r.x + r.w), FLOOR_T, Z(r.y + r.h), 4);
      }
      for (const [k, arr] of buckets) {
        let room = null; let mi = -1;
        if (k[0] === 'r') { room = lv.rooms[Number(k.slice(1)) - 1]; mi = matIndex.has(room.material) ? matIndex.get(room.material) : -1; } else mi = Number(k.slice(1)) - 1;
        const m = mats[mi]; const f = finishes[mi];
        const counted = m && m.include && !(room && room.exclude);
        // rescale UVs to this finish (boxInto used 4 ft)
        if (f && f.repeatFt !== 4) for (let i = 0; i < arr.uv.length; i++) arr.uv[i] *= 4 / f.repeatFt;
        const material = counted && f ? new THREE.MeshLambertMaterial({ map: f.tex, color: 0xffffff }) : (m && f && !counted ? new THREE.MeshLambertMaterial({ map: f.tex, color: 0xb9b5ae }) : offMat());
        const mesh = new THREE.Mesh(geomOf(THREE, arr), material);
        mesh.userData = { pick: true, level: lv, room, mat: m || null, counted };
        group.add(mesh); pickables.push(mesh);
      }

      // slab under the whole house of this level
      const house = houseOf(cells, gw, gh);
      const slab = { pos: [], nor: [], uv: [] };
      for (const r of rects(house, gw, gh)) boxInto(slab, X(r.x), -SLAB, Z(r.y), X(r.x + r.w), 0, Z(r.y + r.h), 4);
      if (slab.pos.length) group.add(new THREE.Mesh(geomOf(THREE, slab), slabMat));

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
        wallGroup.add(new THREE.Mesh(g, mat));
        wallGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), lineMat));
      }
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
      scene.add(group);
      groups.push(group);
    });

    // soft shadow under the house
    const shCv = document.createElement('canvas'); shCv.width = shCv.height = 128;
    const shG = shCv.getContext('2d'); const grd = shG.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, 'rgba(60,50,40,.28)'); grd.addColorStop(1, 'rgba(60,50,40,0)'); shG.fillStyle = grd; shG.fillRect(0, 0, 128, 128);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry((maxX - minX) * 1.5, (maxY - minY) * 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCv), transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -SLAB - 0.05; scene.add(ground);

    let explode = opts.separate ? 1 : 0; let explodeTo = explode;
    function layout() { groups.forEach((g, i) => { g.position.y = i * (STORY + GAP * explode); }); }
    layout();
    const stackH = () => (groups.length - 1) * (STORY + GAP * explode) + WALL_H;

    // camera orbit (drag to turn, pinch/wheel to zoom, two fingers or right-drag to move)
    let focus = null;
    const fitDist = () => (focus ? span * 1.0 : Math.max(span * 1.25, stackH() * 2.6));
    const midY = () => (focus ? focus.position.y + 2 : stackH() / 2 - 1);
    const target = new THREE.Vector3(0, midY(), 0);
    let theta = -0.65; let phi = 0.8; let dist = fitDist();
    let auto = !opts.still;
    function place() {
      phi = Math.max(0.12, Math.min(1.48, phi)); dist = Math.max(span * 0.2, Math.min(span * 5, dist));
      camera.position.set(target.x + dist * Math.sin(phi) * Math.sin(theta), target.y + dist * Math.cos(phi), target.z + dist * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
    }
    place();

    // ── picking, tooltip and legend ──
    el.style.position = el.style.position || 'relative';
    const tip = document.createElement('div'); tip.className = 'ob3d-tip'; tip.hidden = true; el.appendChild(tip);
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let hover = null; let pinned = null; let legendKey = null; let legendPinned = null;
    function paintMeshes() {
      const lk = legendPinned || legendKey;
      for (const m of pickables) {
        const on = m === hover || m === pinned;
        const dim = lk && !(m.userData.mat && m.userData.mat.key === lk && m.userData.counted);
        const lit = lk && !dim;
        m.material.emissive && m.material.emissive.setHex(on ? 0x5a3412 : lit ? 0x3a220c : 0x000000);
        m.material.transparent = Boolean(dim);
        m.material.opacity = dim ? 0.28 : 1;
        m.material.needsUpdate = true;
      }
      need();
    }
    function tipFor(mesh, x, y) {
      if (!mesh) { tip.hidden = true; return; }
      const d = mesh.userData; const r = d.room;
      const area = r ? r.area_sf : null;
      tip.innerHTML = `<strong>${escHtml(r ? r.name : (d.mat ? d.mat.label : 'Floor'))}</strong><span><i style="background:${d.mat ? escHtml(d.mat.color) : '#ccc'}"></i>${escHtml(d.mat ? d.mat.label : 'Not flooring')}${area != null ? ` \u00b7 ${Math.round(area).toLocaleString('en-US')} SF` : ''}</span><small>${escHtml(d.level.name)}${d.counted ? '' : ' \u00b7 not counted'}</small>`;
      tip.hidden = false;
      const bw = el.clientWidth; const tw = tip.offsetWidth || 180;
      tip.style.left = `${Math.min(bw - tw - 8, Math.max(8, x + 14))}px`;
      tip.style.top = `${Math.max(8, y - 64)}px`;
    }
    function pickAt(clientX, clientY) {
      const rect = cv.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const vis = pickables.filter((m) => m.parent && m.parent.visible);
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
      legend = document.createElement('div'); legend.className = 'ob3d-legend';
      legend.innerHTML = `<p>Floors</p>${rows.map((m) => `<button type="button" data-ob3d-mat="${escHtml(m.key)}" aria-pressed="false"><i style="background:${escHtml(m.color)}"></i><span>${escHtml(m.label)}</span><b>${Math.round(totals.get(m.key)).toLocaleString('en-US')} SF</b></button>`).join('')}<small>Hover or tap a floor to see it</small>`;
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
    }

    const ptrs = new Map(); let last = null; let pinch = null; let moved = 0;
    cv.addEventListener('pointerdown', (e) => { auto = false; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; pinch = null; moved = 0; });
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
        if (last.pan) pan(dx, dy); else { theta -= dx * 0.008; phi -= dy * 0.006; }
        last.x = e.clientX; last.y = e.clientY;
        tip.hidden = true;
      }
      place(); need();
    });
    const up = (e) => {
      const was = ptrs.has(e.pointerId);
      ptrs.delete(e.pointerId); if (!ptrs.size) last = null; pinch = null;
      if (was && moved < 6 && e.type === 'pointerup') {
        // a tap/click picks a room (tap again elsewhere to clear)
        const p = pickAt(e.clientX, e.clientY);
        pinned = p.mesh && p.mesh !== pinned ? p.mesh : null;
        paintMeshes(); tipFor(pinned, p.x, p.y);
        if (opts.onPick) opts.onPick(pinned ? { level: pinned.userData.level.id, room: pinned.userData.room } : null);
      }
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
    /** Shows one level alone (or all when id is null) and frames it. */
    function only(id) {
      focus = id ? groups.find((g) => g.userData.id === id) || null : null;
      groups.forEach((g) => { g.visible = !focus || g === focus; });
      pinned = null; tip.hidden = true; paintMeshes();
      reset();
    }

    let raf = 0; let dirty = true; let alive = true;
    function need() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!alive) return;
      if (!el.isConnected) { destroy(); return; }
      let anim = false;
      if (Math.abs(explode - explodeTo) > 0.002) { explode += (explodeTo - explode) * 0.18; layout(); target.y = midY(); dist = Math.max(dist, fitDist() * 0.7); place(); anim = true; dirty = true; } else if (explode !== explodeTo) { explode = explodeTo; layout(); dirty = true; }
      if (auto) { theta += 0.0022; place(); dirty = true; }
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
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      renderer.dispose();
      [cv, tip, legend].forEach((n) => { if (n && n.parentNode) n.parentNode.removeChild(n); });
    }
    return {
      destroy,
      reset,
      only,
      separate(on) { explodeTo = on ? 1 : 0; auto = false; need(); },
      walls(on) { groups.forEach((g) => { g.userData.walls.visible = on; }); need(); },
      showLevel(id, on) { const g = groups.find((x) => x.userData.id === id); if (g) { g.visible = on; need(); } },
      showLabels(on) { groups.forEach((g) => { g.userData.labels.visible = on; }); need(); },
      spin(on) { auto = on; need(); },
      highlight(levelId, roomIndex) {
        pinned = pickables.find((m) => m.userData.level.id === levelId && m.userData.room === (m.userData.level.rooms || [])[roomIndex]) || null;
        paintMeshes();
      },
      levels: groups.map((g) => ({ id: g.userData.id, name: g.userData.name })),
      snapshot() {
        const wasLabels = groups.map((g) => g.userData.labels.visible);
        const savedTip = tip.hidden; tip.hidden = true;
        const keep = dist; dist = fitDist() * 0.62; place();
        renderer.render(scene, camera);
        const url = cv.toDataURL('image/jpeg', 0.86);
        dist = keep; place(); need();
        groups.forEach((g, i) => { g.userData.labels.visible = wasLabels[i]; }); tip.hidden = savedTip;
        return url;
      },
    };
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
