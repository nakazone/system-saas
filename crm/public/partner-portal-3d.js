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
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('aria-label', '3D view of the floors');
    renderer.domElement.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c7, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(60, 120, 40); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.5, 4000);

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
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xece8e2 });
    const groups = [];
    const LEVEL_H = 10; const FLOOR_T = 0.35; const WALL_H = 2.4; const WALL_T = 0.4;

    levels.forEach((lv, li) => {
      const cells = decoded[li]; const gw = lv.grid.w; const gh = lv.grid.h; const c = lv.grid.cell;
      const group = new THREE.Group(); group.userData = { id: lv.id, name: lv.name, base: li };
      // rooms the person excluded: drop their cells? (keep the floor, the total already leaves them out)
      const byMat = new Map();
      for (const r of rects(cells, gw, gh)) {
        if (!byMat.has(r.v)) byMat.set(r.v, { pos: [], nor: [], uv: [] });
        const f = finishes[r.v - 1];
        boxInto(byMat.get(r.v), r.x * c - cx, 0, r.y * c - cz, (r.x + r.w) * c - cx, FLOOR_T, (r.y + r.h) * c - cz, f ? f.repeatFt : 4);
      }
      for (const [v, arr] of byMat) {
        const f = finishes[v - 1];
        const mat = new THREE.MeshLambertMaterial({ map: f ? f.tex : null, color: f ? 0xffffff : 0xcccccc });
        group.add(new THREE.Mesh(geomOf(THREE, arr), mat));
      }
      const walls = { pos: [], nor: [], uv: [] };
      for (const s of outline(cells, gw, gh)) {
        const x0 = s.x0 * c - cx; const z0 = s.y0 * c - cz; const x1 = s.x1 * c - cx; const z1 = s.y1 * c - cz;
        if (s.y0 === s.y1) { const zz = s.n > 0 ? z0 : z0 - WALL_T; boxInto(walls, x0 - (s.n ? 0 : 0), 0, zz, x1, WALL_H, zz + WALL_T, 4); } else { const xx = s.n > 0 ? x0 : x0 - WALL_T; boxInto(walls, xx, 0, z0, xx + WALL_T, WALL_H, z1, 4); }
      }
      if (walls.pos.length) group.add(new THREE.Mesh(geomOf(THREE, walls), wallMat));
      const labels = new THREE.Group();
      for (const r of lv.rooms) {
        if (r.exclude || r.area_sf < 55 || !r.name) continue;
        const sp = labelSprite(THREE, r.name);
        sp.position.set(r.x - cx, FLOOR_T + 1.6, r.y - cz);
        labels.add(sp);
      }
      group.add(labels);
      group.userData.labels = labels;
      scene.add(group);
      groups.push(group);
    });

    let explode = opts.explode != null ? opts.explode : 1.5;
    function layout() { groups.forEach((g, i) => { g.position.y = i * LEVEL_H * explode; }); }
    layout();

    // orbit (drag to turn, pinch/wheel to zoom, two fingers or right drag to move)
    const target = new THREE.Vector3(0, ((groups.length - 1) * LEVEL_H * explode) / 2, 0);
    const fitDist = () => (focus ? span * 0.95 : Math.max(span * 1.05, (groups.length - 1) * LEVEL_H * explode * 2.4));
    let focus = null;
    let theta = -0.6; let phi = 0.92; let dist = fitDist();
    let auto = !opts.still;
    function place() {
      phi = Math.max(0.12, Math.min(1.45, phi)); dist = Math.max(span * 0.25, Math.min(span * 4, dist));
      camera.position.set(target.x + dist * Math.sin(phi) * Math.sin(theta), target.y + dist * Math.cos(phi), target.z + dist * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
    }
    place();
    const ptrs = new Map(); let last = null; let pinch = null;
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { auto = false; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; pinch = null; });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch) { dist *= pinch.d / d; pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y); }
        pinch = { d, mid };
      } else if (last) {
        const dx = e.clientX - last.x; const dy = e.clientY - last.y;
        if (last.pan) pan(dx, dy); else { theta -= dx * 0.008; phi -= dy * 0.006; }
        last.x = e.clientX; last.y = e.clientY;
      }
      place(); need();
    });
    const up = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) last = null; pinch = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => { e.preventDefault(); auto = false; dist *= Math.exp(e.deltaY * 0.0012); place(); need(); }, { passive: false });
    cv.addEventListener('dblclick', () => reset());
    function pan(dx, dy) {
      const k = dist * 0.0016;
      const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta));
      const fwd = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
      target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
    }
    function reset() { theta = -0.6; phi = 0.92; dist = fitDist(); target.set(0, focus ? focus.position.y : ((groups.length - 1) * LEVEL_H * explode) / 2, 0); place(); need(); }
    /** Shows one level alone (or all when id is null) and frames it. */
    function only(id) {
      focus = id ? groups.find((g) => g.userData.id === id) || null : null;
      groups.forEach((g) => { g.visible = !focus || g === focus; });
      reset();
    }

    let raf = 0; let dirty = true; let alive = true;
    function need() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!alive) return;
      if (!el.isConnected) { destroy(); return; }
      if (auto) { theta += 0.0025; place(); dirty = true; }
      if (dirty) { renderer.render(scene, camera); dirty = false; }
      if (auto) raf = requestAnimationFrame(frame);
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
      renderer.dispose(); if (cv.parentNode) cv.parentNode.removeChild(cv);
    }
    return {
      destroy,
      reset,
      setExplode(v) { explode = v; layout(); target.y = ((groups.length - 1) * LEVEL_H * explode) / 2; place(); need(); },
      showLevel(id, on) { const g = groups.find((x) => x.userData.id === id); if (g) { g.visible = on; need(); } },
      only,
      showLabels(on) { groups.forEach((g) => { g.userData.labels.visible = on; }); need(); },
      spin(on) { auto = on; need(); },
      levels: groups.map((g) => ({ id: g.userData.id, name: g.userData.name })),
      snapshot() { renderer.render(scene, camera); return cv.toDataURL('image/png'); },
    };
  }

  window.ObPlan3D = { mount, load: loadThree };
})();
