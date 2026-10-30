/*
 * ObraBuilder — floor plan takeoff engine (runs in the browser).
 *
 * Reads house plans where the flooring is marked with legend colors (Bluebeam/PDF markups):
 *   1. pdf.js renders each sheet and gives the text with positions;
 *   2. the legend ("HARDWOOD", "LVP/LAMINATE", "CARPET"…) gives each floor's color;
 *   3. the scale comes from the chained dimension strings on the sheet (13'-0" 15'-4" …);
 *   4. every pixel is matched to the nearest legend color (also when the markup is see-through),
 *      thin linework is closed, small holes (text) filled, and line-like blobs dropped;
 *   5. room names on the sheet split each colored area into rooms;
 *   6. a 0.5 ft grid of the floors is kept for the 3D view.
 * Photos/scans without text work too: the person taps the colors and marks a known length.
 */
(function () {
  'use strict';

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  /* ───────────── vocabulary ───────────── */

  const LEGEND = [
    [/^(HARD\s?WOOD|WOOD\s+FLOOR(ING)?|ENGINEERED(\s+(HARD)?WOOD)?|SOLID\s+WOOD)\b/, 'hardwood', 'Hardwood'],
    [/^(LVP|LVT|LUXURY\s+VINYL|VINYL\s+PLANK|LVP\s*\/\s*LAMINATE|LVP\s*\/\s*LVT)\b/, 'lvp', 'LVP'],
    [/^LAMINATE\b/, 'laminate', 'Laminate'],
    [/^CARPET\b/, 'carpet', 'Carpet'],
    [/^RUBBER\b/, 'rubber', 'Rubber floor'],
    [/^(TILE|PORCELAIN|CERAMIC)\b/, 'tile', 'Tile'],
    [/^(STONE|MARBLE|SLATE)\b/, 'stone', 'Stone'],
    [/^(MUD\s+SHOWER|SHOWER\s+PAN|SLAB\s+C\.?\s?TOP|COUNTER|QUARTZ|GRANITE)/, 'other', null],
  ];
  const FLOORING = ['hardwood', 'lvp', 'laminate', 'carpet', 'rubber'];
  /** Counted right away; rubber and the rest can be switched on by hand. */
  const DEFAULT_ON = ['hardwood', 'lvp', 'laminate', 'carpet'];
  /** Words that name a room on a plan (room labels split a colored area into rooms). */
  const ROOM_WORDS = /\b(ROOM|BED(ROOM)?|BATH|BTH|KITCHEN|KIT|DINING|DINE|LIVING|GREAT|FAMILY|FAM|OFFICE|STUDY|DEN|LOFT|FLEX|BONUS|MEDIA|THEATER|THEATRE|GAME|REC|GYM|EXERCISE|LAUNDRY|LAUND|MUD\s?ROOM|MUDROOM|PANTRY|CLOSET|CLOS|CLO|W\.?\s?I\.?\s?C|WIC|HALL|FOYER|ENTRY|NOOK|BREAKFAST|POWDER|PWDR|LAV|SPA|RETREAT|SUITE|OWNER'?S?|MASTER|PRIMARY|GUEST|NURSERY|PLAY|STORAGE|STOR|MECH|UTILITY|UTIL|SAUNA|STEAM|WINE|BAR|LOUNGE|LANDING|STAIR|GALLERY|LIBRARY|CRAFT|DROP\s+ZONE|LOCKER|SCULLERY|PREP|HEARTH|SITTING|ATTIC|BASEMENT|LIBRARY|GARAGE|SHOP|WORKSHOP|ARTS?)\b/;
  /** Notes that mention a room but are not its name. */
  const NOISE = /\b(METERS?|PANELS?|MATCH|ROUTE|CONNECT|DRAIN|SUMP|ABV|ABOVE|BELOW|BLW|BY BUILDER|NOTES?|TYP|U\.N\.O|SEE|PER|REFER|VERIFY|PROVIDE|INSTALL|WALL|BEAM|DOOR|WINDOW|SOFFIT|CLG\.?|CEILING|LINE|RAIL|TRUSS|HDR\.?|JOIST|FLOOR PLAN|FURRING|PLUMB|ROUGH|PATIO|PAVERS|DECK|PORCH|BALCONY|COVERED|EXTERIOR|SIDING|SET|SHOWER|SINK|SPEC)\b/;
  const DIM = /^(\d{1,3})['’′]\s*-?\s*(\d{1,2})?(?:\s+(\d{1,2})\/(\d{1,2}))?\s*["”″]?$/;
  const LEVEL_RX = /\b(LOWER|BASEMENT|GARDEN|MAIN|FIRST|1ST|GROUND|UPPER|SECOND|2ND|THIRD|3RD|LOFT)\s+(LEVEL|FLOOR)(\s+FLOOR)?\s+PLAN\b/;
  const LEVEL_ORDER = { LOWER: 0, BASEMENT: 0, GARDEN: 0, MAIN: 1, FIRST: 1, '1ST': 1, GROUND: 1, UPPER: 2, SECOND: 2, '2ND': 2, LOFT: 3, THIRD: 3, '3RD': 3 };
  const LEVEL_NAME = { LOWER: 'Lower level', BASEMENT: 'Basement', GARDEN: 'Garden level', MAIN: 'Main level', FIRST: 'First floor', '1ST': 'First floor', GROUND: 'Ground floor', UPPER: 'Upper level', SECOND: 'Second floor', '2ND': 'Second floor', THIRD: 'Third floor', '3RD': 'Third floor', LOFT: 'Loft' };

  /* ───────────── helpers ───────────── */

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = () => resolve(); s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  async function pdfLib() {
    if (!window.pdfjsLib) await loadScript(PDFJS);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return window.pdfjsLib;
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const hexOf = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const median = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };

  function parseDim(t) {
    const m = DIM.exec(t.replace(/\s+/g, ' ').trim());
    if (!m) return null;
    const ft = +m[1] + (m[2] ? +m[2] / 12 : 0) + (m[3] && +m[4] ? (+m[3] / +m[4]) / 12 : 0);
    return ft > 0 ? ft : null;
  }
  function legendKind(t) {
    const u = t.toUpperCase().replace(/\s+/g, ' ').trim();
    for (const [rx, kind, label] of LEGEND) if (rx.test(u)) return { kind, label: label || titleCase(u) };
    return null;
  }
  function titleCase(s) { return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bLvp\b/, 'LVP'); }

  /* ───────────── reading a sheet ───────────── */

  /** Text lines of a page in display coordinates (pt), merged from pdf.js items. */
  async function pageLines(lib, page, viewport) {
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const str = (it.str || '').trim();
      if (!str) continue;
      const m = lib.Util.transform(viewport.transform, it.transform);
      const ang = Math.atan2(m[1], m[0]);
      const h = Math.hypot(m[2], m[3]) || 6;
      const dx = Math.cos(ang); const dy = Math.sin(ang);
      const w = it.width * viewport.scale;
      items.push({ str: it.str, x: m[4], y: m[5], dx, dy, w, h, ang: Math.round(ang / (Math.PI / 2)) & 3 });
    }
    // merge runs on the same baseline (e.g. "3'-5" + "1/2"")
    const key = (it) => (it.ang % 2 === 0 ? it.y : it.x);
    const along = (it) => (it.ang % 2 === 0 ? it.x * (it.ang === 0 ? 1 : -1) : it.y * (it.ang === 1 ? 1 : -1));
    items.sort((a, b) => a.ang - b.ang || key(a) - key(b) || along(a) - along(b));
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && last.ang === it.ang && Math.abs(key(last) - key(it)) < Math.max(1, it.h * 0.25) && along(it) - (last.along + last.w) < it.h * 0.45 && along(it) >= last.along - 1) {
        // the same run printed twice on top of itself (fake bold) — keep one
        if (it.str.trim() === last.chunk.trim() && Math.abs(along(it) - last.chunkAt) < it.h * 0.6) continue;
        last.str += (/\s$/.test(last.str) || along(it) - (last.along + last.w) < it.h * 0.12 ? '' : ' ') + it.str;
        last.w = Math.max(last.w, along(it) + it.w - last.along);
        last.chunk = it.str; last.chunkAt = along(it);
      } else {
        lines.push({ ...it, along: along(it), chunk: it.str, chunkAt: along(it) });
      }
    }
    for (const l of lines) {
      l.text = l.str.replace(/\s+/g, ' ').trim();
      // centre of the text box (baseline origin + half the run along the direction, half the height up)
      l.cx = l.x + l.dx * l.w / 2 + l.dy * l.h * 0.35;
      l.cy = l.y + l.dy * l.w / 2 - l.dx * l.h * 0.35;
      l.x0 = Math.min(l.x, l.x + l.dx * l.w); l.x1 = Math.max(l.x, l.x + l.dx * l.w);
      l.y0 = Math.min(l.y, l.y + l.dy * l.w) - (l.ang % 2 === 0 ? l.h : 0); l.y1 = Math.max(l.y, l.y + l.dy * l.w);
    }
    return lines;
  }

  /** Points per foot from chained dimension strings: neighbours in a row sit (a+b)/2 apart. */
  function scaleFromDims(lines) {
    const dims = [];
    for (const l of lines) {
      const ft = parseDim(l.text);
      if (ft && ft >= 0.75 && ft < 400) dims.push({ ft, cx: l.cx, cy: l.cy, horiz: l.ang % 2 === 0 });
    }
    const ratios = [];
    for (const horiz of [true, false]) {
      const sel = dims.filter((d) => d.horiz === horiz).sort((a, b) => (horiz ? a.cy - b.cy : a.cx - b.cx));
      const rows = [];
      for (const d of sel) {
        const r = rows[rows.length - 1];
        if (r && Math.abs((horiz ? d.cy : d.cx) - (horiz ? r[r.length - 1].cy : r[r.length - 1].cx)) < 1.5) r.push(d); else rows.push([d]);
      }
      for (const r of rows) {
        r.sort((a, b) => (horiz ? a.cx - b.cx : a.cy - b.cy));
        for (let i = 1; i < r.length; i++) {
          const gap = horiz ? r[i].cx - r[i - 1].cx : r[i].cy - r[i - 1].cy;
          const half = (r[i].ft + r[i - 1].ft) / 2;
          if (half >= 1 && gap > 2) ratios.push(gap / half);
        }
      }
    }
    if (ratios.length < 4) return { ppf: null, confidence: 0, samples: ratios.length };
    // densest 4% window on a log scale
    const logs = ratios.map(Math.log).sort((a, b) => a - b);
    let best = 0; let bi = 0; const win = Math.log(1.04);
    for (let i = 0, j = 0; i < logs.length; i++) {
      while (logs[i] - logs[j] > win) j++;
      if (i - j + 1 > best) { best = i - j + 1; bi = i; }
    }
    const lo = logs[bi] - win; const hi = logs[bi];
    const inWin = logs.filter((v) => v >= lo && v <= hi);
    const ppf = Math.exp(inWin.reduce((a, b) => a + b, 0) / inWin.length);
    return { ppf, confidence: best / logs.length, samples: best };
  }

  function levelFromText(lines, pageNo) {
    for (const l of lines) {
      const m = LEVEL_RX.exec(l.text.toUpperCase());
      if (m) return { name: LEVEL_NAME[m[1]] || titleCase(m[1]) + ' level', order: LEVEL_ORDER[m[1]] ?? pageNo };
    }
    return { name: `Sheet ${pageNo}`, order: pageNo };
  }

  function legendFromText(lines) {
    const hits = [];
    for (const l of lines) {
      if (l.ang !== 0 || l.text.length > 28) continue;
      const k = legendKind(l.text);
      if (k) hits.push({ ...k, line: l });
    }
    // the legend is a column of entries with the same left edge
    const cols = new Map();
    for (const h of hits) {
      const x = Math.round(h.line.x0 / 3);
      const near = [x - 1, x, x + 1].find((k) => cols.has(k));
      const k = near ?? x;
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k).push(h);
    }
    let col = [];
    for (const c of cols.values()) if (c.length > col.length) col = c;
    // a real legend lists different floors; two "TILE" callouts that happen to line up are not one
    return col.length >= 2 && new Set(col.map((h) => h.label)).size >= 2 ? col : [];
  }

  /** The color of each legend swatch (left of its word), from the rendered sheet. */
  function sampleSwatches(col, img, W, H, Z) {
    const out = [];
    for (const h of col) {
      const l = h.line;
      const y = Math.round(((l.y0 + l.y1) / 2) * Z);
      const xa = Math.max(0, Math.round((l.x0 - 32) * Z)); const xb = Math.max(0, Math.round((l.x0 - 5) * Z));
      const px = [];
      for (let yy = y - 2; yy <= y + 2; yy++) {
        if (yy < 0 || yy >= H) continue;
        for (let x = xa; x < xb; x++) {
          const i = (yy * W + x) * 4; const r = img[i]; const g = img[i + 1]; const b = img[i + 2];
          const s = r + g + b; const sat = Math.max(r, g, b) - Math.min(r, g, b);
          if (s < 735 && s > 60 && sat > 12) px.push([r, g, b]);
        }
      }
      if (px.length < 6) continue;
      const c = [0, 1, 2].map((k) => median(px.map((p) => p[k])));
      out.push({ kind: h.kind, label: h.label, color: hexOf(c) });
    }
    // one entry per label
    const seen = new Set();
    return out.filter((m) => (seen.has(m.label) ? false : (seen.add(m.label), true)));
  }

  /* ───────────── pixels → floors ───────────── */

  /** Label every pixel with the nearest legend color (0 = none). Handles see-through markups. */
  function classify(img, W, H, mats) {
    const n = W * H; const lab = new Uint8Array(n);
    const vs = mats.map((m) => { if (m.skip) return { v: [0, 0, 0], vv: 1, skip: true }; const c = rgbOf(m.color); const v = [c[0] - 255, c[1] - 255, c[2] - 255]; return { v, vv: v[0] * v[0] + v[1] * v[1] + v[2] * v[2] || 1 }; });
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const r = img[i]; const g = img[i + 1]; const b = img[i + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b); const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx - mn <= 14) continue;
      const pr = r - 255; const pg = g - 255; const pb = b - 255;
      let best = 0; let bd = 14;
      for (let k = 0; k < vs.length; k++) {
        const { v, vv, skip } = vs[k];
        if (skip) continue;
        const t = (pr * v[0] + pg * v[1] + pb * v[2]) / vv;
        if (t < 0.4 || t > 1.12) continue;
        const tc = t > 1.08 ? 1.08 : t;
        const d = Math.max(Math.abs(pr - tc * v[0]), Math.abs(pg - tc * v[1]), Math.abs(pb - tc * v[2]));
        if (d < bd) { bd = d; best = k + 1; }
      }
      lab[p] = best;
    }
    return lab;
  }

  function dilate(src, W, H, r) {
    const tmp = new Uint8Array(src.length); const out = new Uint8Array(src.length);
    for (let y = 0; y < H; y++) {
      const o = y * W; let run = -1e9;
      for (let x = 0; x < W; x++) { if (src[o + x]) run = x; if (x - run <= r) tmp[o + x] = 1; }
      run = 1e9;
      for (let x = W - 1; x >= 0; x--) { if (src[o + x]) run = x; if (run - x <= r) tmp[o + x] = 1; }
    }
    for (let x = 0; x < W; x++) {
      let run = -1e9;
      for (let y = 0; y < H; y++) { if (tmp[y * W + x]) run = y; if (y - run <= r) out[y * W + x] = 1; }
      run = 1e9;
      for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) run = y; if (run - y <= r) out[y * W + x] = 1; }
    }
    return out;
  }
  function erode(src, W, H, r) {
    const inv = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) inv[i] = src[i] ? 0 : 1;
    const d = dilate(inv, W, H, r);
    for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
    return d;
  }

  /** Connected components (8-way or 4-way). Returns {comp: Int32Array, count, areas}. */
  function components(mask, W, H, eight) {
    const comp = new Int32Array(mask.length); const stack = new Int32Array(mask.length);
    const areas = [0]; let count = 0;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || comp[s]) continue;
      count++; let sp = 0; stack[sp++] = s; comp[s] = count; let a = 0;
      while (sp) {
        const p = stack[--sp]; a++;
        const x = p % W; const y = (p - x) / W;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy; if (yy < 0 || yy >= H) continue;
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            if (!eight && ox && oy) continue;
            const xx = x + ox; if (xx < 0 || xx >= W) continue;
            const q = yy * W + xx;
            if (mask[q] && !comp[q]) { comp[q] = count; stack[sp++] = q; }
          }
        }
      }
      areas.push(a);
    }
    return { comp, count, areas };
  }

  /**
   * Floors of one sheet. `img` is RGBA, Z = pixels per pt (or per image px), ppf = pt per foot.
   * Returns per-pixel material labels (1-based) and the kept areas.
   */
  async function floorsOf(img, W, H, mats, ppf, Z, exclude, progress) {
    const pxPerFt = ppf * Z; const sfPerPx = 1 / (pxPerFt * pxPerFt);
    const lab = classify(img, W, H, mats);
    if (exclude) for (const b of exclude) {
      const x0 = Math.max(0, Math.floor(b.x0 * Z)); const x1 = Math.min(W, Math.ceil(b.x1 * Z));
      const y0 = Math.max(0, Math.floor(b.y0 * Z)); const y1 = Math.min(H, Math.ceil(b.y1 * Z));
      for (let y = y0; y < y1; y++) lab.fill(0, y * W + x0, y * W + x1);
    }
    const out = new Uint8Array(W * H); const areas = [];
    const r = Math.max(1, Math.round(0.6 * Z));
    for (let k = 1; k <= mats.length; k++) {
      progress && progress(k / mats.length);
      await tick();
      const m = new Uint8Array(W * H); let any = 0;
      for (let i = 0; i < m.length; i++) if (lab[i] === k) { m[i] = 1; any++; }
      if (any * sfPerPx < 4) continue;
      let mc = erode(dilate(m, W, H, r), W, H, r);
      // fill small enclosed holes (text, symbols inside a room)
      const inv = new Uint8Array(W * H); for (let i = 0; i < inv.length; i++) inv[i] = mc[i] ? 0 : 1;
      const holes = components(inv, W, H, false);
      const border = new Uint8Array(holes.count + 1);
      for (let x = 0; x < W; x++) { border[holes.comp[x]] = 1; border[holes.comp[(H - 1) * W + x]] = 1; }
      for (let y = 0; y < H; y++) { border[holes.comp[y * W]] = 1; border[holes.comp[y * W + W - 1]] = 1; }
      const maxHole = 4 / sfPerPx;
      for (let i = 0; i < inv.length; i++) { const c = holes.comp[i]; if (c && !border[c] && holes.areas[c] < maxHole) mc[i] = 1; }
      const cc = components(mc, W, H, true);
      const raw = new Float64Array(cc.count + 1);
      for (let i = 0; i < m.length; i++) if (m[i]) raw[cc.comp[i]]++;
      const keep = new Uint8Array(cc.count + 1);
      for (let c = 1; c <= cc.count; c++) {
        const sf = cc.areas[c] * sfPerPx;
        if (sf >= 6 && raw[c] / cc.areas[c] >= 0.6) { keep[c] = 1; areas.push({ mat: k, comp: c, sf }); }
      }
      for (let i = 0; i < mc.length; i++) if (keep[cc.comp[i]] && !out[i]) out[i] = k;
      mc = null;
    }
    return { labels: out, sfPerPx, pxPerFt };
  }

  /** Splits the floors into rooms using the room names printed on the sheet. */
  function roomsOf(labels, W, H, mats, lines, Z, pxPerFt) {
    const sfPerPx = 1 / (pxPerFt * pxPerFt);
    // regions = connected areas of one material
    const regions = [];
    const regionOf = new Int32Array(W * H);
    for (let k = 1; k <= mats.length; k++) {
      const m = new Uint8Array(W * H); let any = false;
      for (let i = 0; i < m.length; i++) if (labels[i] === k) { m[i] = 1; any = true; }
      if (!any) continue;
      const cc = components(m, W, H, true);
      const base = regions.length;
      for (let c = 1; c <= cc.count; c++) regions.push({ mat: k, area: cc.areas[c], names: [] });
      for (let i = 0; i < m.length; i++) if (cc.comp[i]) regionOf[i] = base + cc.comp[i];
    }
    // room names that sit on a region; names on two lines ("GREAT" / "ROOM") are joined
    const cand = lines.filter((l) => {
      const t = l.text.toUpperCase();
      return l.text.length >= 2 && l.text.length <= 30 && /[A-Z]{2}/.test(t) && !/\d['’]/.test(t) && !/:$/.test(t) && !legendKind(t) && t === l.text.toUpperCase();
    }).map((l) => ({ text: l.text, cx: l.cx, cy: l.cy, h: l.h }));
    const joined = [];
    const used = new Set();
    cand.sort((a, b) => a.cy - b.cy);
    for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      for (let j = i + 1; j < cand.length; j++) {
        const b = cand[j];
        if (b.cy - a.cy > a.h * 1.9) break;
        if (b.cy - a.cy < a.h * 0.6 || Math.abs(b.cx - a.cx) > Math.max(3, a.h)) continue;
        if (a.text.split(' ').length > 2 || b.text.split(' ').length > 2) continue;
        if (NOISE.test(a.text.toUpperCase()) || NOISE.test(b.text.toUpperCase()) || /\d/.test(b.text)) continue;
        joined.push({ text: `${a.text} ${b.text}`, cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2, h: a.h });
        used.add(a); used.add(b);
        break;
      }
    }
    const named = [...joined, ...cand.filter((c) => !used.has(c))];
    for (const l of named) {
      const t = l.text.toUpperCase();
      if (!ROOM_WORDS.test(t) || NOISE.test(t)) continue;
      const x = Math.round(l.cx * Z); const y = Math.round(l.cy * Z);
      // nearest region pixel within ~1.5 ft
      const rad = Math.round(1.5 * pxPerFt); let hit = 0; let hd = 1e9;
      for (let yy = Math.max(0, y - rad); yy <= Math.min(H - 1, y + rad); yy += 2) {
        for (let xx = Math.max(0, x - rad); xx <= Math.min(W - 1, x + rad); xx += 2) {
          const rg = regionOf[yy * W + xx];
          if (!rg) continue;
          const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
          if (d < hd) { hd = d; hit = rg; }
        }
      }
      if (!hit) continue;
      const name = cleanRoom(l.text);
      const reg = regions[hit - 1];
      if (!reg.names.some((n) => n.name === name && Math.hypot(n.x - x, n.y - y) < 4 * pxPerFt)) reg.names.push({ name, x, y });
    }
    // assign each pixel to the nearest name of its region (coarse cells keep it fast)
    const cell = Math.max(2, Math.round(pxPerFt / 2));
    const rooms = [];
    const roomIndex = new Map();
    const cellRoom = new Map();
    const roomPx = new Int32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const rg = regionOf[y * W + x];
        if (!rg) continue;
        const reg = regions[rg - 1];
        let room;
        if (reg.names.length <= 1) {
          const key = 'r' + rg;
          room = roomIndex.get(key);
          if (room === undefined) {
            const n = reg.names[0];
            room = rooms.length; roomIndex.set(key, room);
            rooms.push({ name: n ? n.name : '', mat: reg.mat, px: 0, sx: 0, sy: 0, lx: n ? n.x : null, ly: n ? n.y : null });
          }
        } else {
          const ck = rg * 1e7 + Math.floor(y / cell) * 1e4 + Math.floor(x / cell);
          room = cellRoom.get(ck);
          if (room === undefined) {
            let bi = 0; let bd = 1e18;
            for (let i = 0; i < reg.names.length; i++) { const n = reg.names[i]; const d = (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y); if (d < bd) { bd = d; bi = i; } }
            const key = 'r' + rg + ':' + bi;
            room = roomIndex.get(key);
            if (room === undefined) {
              const n = reg.names[bi];
              room = rooms.length; roomIndex.set(key, room);
              rooms.push({ name: n.name, mat: reg.mat, px: 0, sx: 0, sy: 0, lx: n.x, ly: n.y });
            }
            cellRoom.set(ck, room);
          }
        }
        const r = rooms[room]; r.px++; r.sx += x; r.sy += y;
        roomPx[y * W + x] = room + 1;
      }
    }
    const minPx = 2 / sfPerPx;
    const list = rooms.map((r, i) => ({ r, i })).filter(({ r }) => r.px >= minPx).map(({ r, i }) => ({
      orig: i + 1,
      name: r.name,
      mat: r.mat,
      area_sf: r.px * sfPerPx,
      x: (r.lx ?? r.sx / r.px) / pxPerFt,
      y: (r.ly ?? r.sy / r.px) / pxPerFt,
    }));
    // unnamed areas: "Hardwood area 2"; repeated names get a number
    const count = {};
    for (const r of list) {
      const base = r.name || `${mats[r.mat - 1].label} area`;
      count[base] = (count[base] || 0) + 1;
      r.name = count[base] > 1 || !r.name ? `${base} ${count[base]}` : base;
    }
    list.sort((a, b) => b.area_sf - a.area_sf);
    // pixel → final room number (1-based in the sorted list, 0 = dropped)
    const remap = new Int32Array(rooms.length + 1);
    list.forEach((r, i) => { remap[r.orig] = i + 1; });
    for (let i = 0; i < roomPx.length; i++) if (roomPx[i]) roomPx[i] = remap[roomPx[i]];
    return { list, roomPx };
  }

  function cleanRoom(t) {
    return titleCase(t.replace(/^(L\.?L\.?|M\.?L\.?|U\.?L\.?)\s*[-–]\s*/i, '').replace(/\s+\d+'.*$/, '').replace(/^[\s/\-–.,]+/, '').trim())
      .replace(/\bW\.?\s?I\.?\s?C\.?/i, 'W.I.C.').replace(/\bOwner'?s\b/i, "Owner's").slice(0, 60);
  }

  /** A coarse grid (cell ft) of the floors for the 3D view, run-length encoded. */
  function gridOf(labels, W, H, pxPerFt, nmat, roomPx) {
    const pageFt = Math.max(W, H) / pxPerFt;
    const cellFt = Math.max(0.5, Math.ceil((pageFt / 1000) * 10) / 10);
    const c = cellFt * pxPerFt;
    const gw = Math.ceil(W / c); const gh = Math.ceil(H / c);
    const counts = new Uint32Array(gw * gh * (nmat + 1));
    for (let y = 0; y < H; y++) {
      const gy = Math.floor(y / c);
      for (let x = 0; x < W; x++) {
        const k = labels[y * W + x];
        if (k) counts[(gy * gw + Math.floor(x / c)) * (nmat + 1) + k]++;
      }
    }
    const half = (c * c) / 2;
    const parts = []; let prev = -1; let run = 0;
    for (let i = 0; i < gw * gh; i++) {
      let best = 0; let bn = half;
      for (let k = 1; k <= nmat; k++) { const v = counts[i * (nmat + 1) + k]; if (v >= bn) { bn = v; best = k; } }
      if (best === prev) run++; else { if (run) parts.push(prev + 'x' + run); prev = best; run = 1; }
    }
    if (run) parts.push(prev + 'x' + run);
    // room of each cell (majority vote over its pixels), so the 3D can pick and highlight rooms
    let roomsRle = '';
    if (roomPx) {
      const cand = new Int32Array(gw * gh); const cnt = new Int32Array(gw * gh);
      for (let y = 0; y < H; y++) {
        const gy = Math.floor(y / c);
        for (let x = 0; x < W; x++) {
          const rm = roomPx[y * W + x]; if (!rm) continue;
          const ci = gy * gw + Math.floor(x / c);
          if (cand[ci] === rm) cnt[ci]++; else if (cnt[ci] === 0) { cand[ci] = rm; cnt[ci] = 1; } else cnt[ci]--;
        }
      }
      const rp = []; let pv = -1; let rn = 0;
      const mats = decodeRle(parts.join(','), gw * gh);
      for (let i = 0; i < gw * gh; i++) {
        const v = mats[i] ? cand[i] : 0;
        if (v === pv) rn++; else { if (rn) rp.push(pv + 'x' + rn); pv = v; rn = 1; }
      }
      if (rn) rp.push(pv + 'x' + rn);
      roomsRle = rp.join(',');
    }
    return { w: gw, h: gh, cell: cellFt, rle: parts.join(','), ...(roomsRle ? { rooms: roomsRle } : {}) };
  }

  function decodeRle(rle, n) {
    const out = new Int32Array(n); let i = 0;
    for (const part of String(rle || '').split(',')) {
      if (!part) continue;
      const [v, k] = part.split('x').map(Number);
      if (v) out.fill(v, i, i + k);
      i += k;
    }
    return out;
  }
  function decodeGrid(grid) {
    const out = new Uint8Array(grid.w * grid.h); let i = 0;
    for (const part of String(grid.rle || '').split(',')) {
      if (!part) continue;
      const [v, n] = part.split('x').map(Number);
      if (v) out.fill(v, i, i + n);
      i += n;
    }
    return out;
  }

  /* ───────────── public API ───────────── */

  /**
   * Opens a plan file and reads what it can without the pixels: sheets, level names, legend, scale.
   * Returns { kind: 'pdf'|'image', sheets: [{ page, name, order, ptW, ptH, ppf, scaleConf, lines, legend }] }.
   */
  async function open(file, onProgress) {
    const buf = await file.arrayBuffer();
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
      const lib = await pdfLib();
      const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      const sheets = [];
      for (let p = 1; p <= Math.min(doc.numPages, 12); p++) {
        onProgress && onProgress({ step: 'read', page: p, pages: doc.numPages });
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const lines = await pageLines(lib, page, vp);
        const sc = scaleFromDims(lines);
        const lv = levelFromText(lines, p);
        sheets.push({ page: p, name: lv.name, order: lv.order, ptW: vp.width, ptH: vp.height, ppf: sc.ppf, scaleConf: sc.confidence, lines, legendCol: legendFromText(lines), _page: page });
      }
      return { kind: 'pdf', doc, sheets, pages: doc.numPages };
    }
    const url = URL.createObjectURL(file);
    const im = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Could not open that image.')); i.src = url; });
    return { kind: 'image', image: im, sheets: [{ page: 1, name: 'Main level', order: 1, ptW: im.naturalWidth, ptH: im.naturalHeight, ppf: null, scaleConf: 0, lines: [], legendCol: [], _image: im }], pages: 1 };
  }

  /** Renders a sheet; Z pixels per pt (for an image: per image pixel). */
  async function render(sheet, Z) {
    const W = Math.max(1, Math.round(sheet.ptW * Z)); const H = Math.max(1, Math.round(sheet.ptH * Z));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (sheet._page) await sheet._page.render({ canvasContext: ctx, viewport: sheet._page.getViewport({ scale: Z }) }).promise;
    else ctx.drawImage(sheet._image, 0, 0, W, H);
    return { canvas, ctx, W, H, Z };
  }

  /** Pixels per pt that keep ~12 px per foot and the sheet under ~14 megapixels. */
  function zoomFor(sheet, ppf) {
    let Z = ppf ? 12 / ppf : 3;
    Z = Math.max(sheet._image ? 0.25 : 1.5, Math.min(sheet._image ? 2 : 4, Z));
    const maxPx = 14e6;
    if (sheet.ptW * sheet.ptH * Z * Z > maxPx) Z = Math.sqrt(maxPx / (sheet.ptW * sheet.ptH));
    return Z;
  }

  /** Legend colors found on the sheets (first sheet that has a legend wins; others add new entries). */
  async function legend(opened) {
    const mats = [];
    for (const sh of opened.sheets) {
      if (!sh.legendCol.length) continue;
      const Z = 2;
      const r = await render(sh, Z);
      const img = r.ctx.getImageData(0, 0, r.W, r.H).data;
      for (const m of sampleSwatches(sh.legendCol, img, r.W, r.H, Z)) if (!mats.some((x) => x.label === m.label)) mats.push(m);
      if (mats.length) {
        sh.legendBox = boxOf(sh.legendCol);
      }
    }
    for (const sh of opened.sheets) if (!sh.legendBox && sh.legendCol.length) sh.legendBox = boxOf(sh.legendCol);
    return mats.map((m, i) => ({ key: m.kind + '-' + (i + 1), label: m.label, color: m.color, kind: m.kind, include: DEFAULT_ON.includes(m.kind), sand_finish: false }));
  }
  /* ───────────── plans without a legend: highlighter markups + callout notes ───────────── */

  /** Words in a callout that name a floor, anywhere in the note ("6\" WHITE OAK - SITE FIN.", "TILE TO CEILING"). */
  const NOTE_KIND = [
    [/\b(HARD\s?WOOD|WOOD\s+FLOOR|ENGINEERED|WHITE\s+OAK|RED\s+OAK|OAK|HICKORY|MAPLE|WALNUT|ACACIA)\b/, 'hardwood', 'Hardwood'],
    [/\b(LVP|LVT|LUXURY\s+VINYL|VINYL\s+PLANK|SPC|WPC)\b/, 'lvp', 'LVP'],
    [/\bLAMINATE\b/, 'laminate', 'Laminate'],
    [/\bCARPET\b/, 'carpet', 'Carpet'],
    [/\bRUBBER\b/, 'rubber', 'Rubber floor'],
    [/\b(TILE|PORCELAIN|CERAMIC)\b/, 'tile', 'Tile'],
    [/\b(STONE|MARBLE|SLATE|TRAVERTINE)\b/, 'stone', 'Stone'],
    [/\b(POLISHED|SEALED|STAINED|GROUND|BURNISHED|EXPOSED)\s+CONCRETE\b|\bCONCRETE\s+(FLOOR|FLOORS|SLAB|FINISH)\b|\bEPOXY\b/, 'concrete', 'Polished concrete'],
  ];
  /** A note that covers a whole level ("POLISHED CONCRETE THROUGHOUT", "CARPET ENTIRE BASEMENT"). */
  const WHOLE_LEVEL = /\b(THROUGHOUT|THRU\s?OUT|ENTIRE\s+(FLOOR|LEVEL|BASEMENT|SPACE)|ALL\s+(OF\s+)?(THE\s+)?(BASEMENT|LEVEL|FLOOR|ROOMS))\b/;
  const NOT_FLOOR = /\b(TREADS?|RISERS?|STAIRS?|STEPS?|NOSE|TOPS?|COUNTER|BACKSPLASH|VANITY\s+TOP|CABINET|WALLS?|FOUNDATION|FOOTINGS?|DRIVEWAY|SIDEWALK|CURB)\b/;
  function noteKind(text) {
    const u = text.toUpperCase().replace(/\s+/g, ' ');
    // the most specific word wins: "POLISHED CONCRETE" over a "WOOD" elsewhere in a long note
    let best = null;
    for (const [rx, kind, label] of NOTE_KIND) { const m = rx.exec(u); if (m && (!best || m.index < best.at)) best = { kind, label: kind === 'concrete' && !/POLISHED/.test(u) ? 'Concrete' : label, at: m.index }; }
    return best && { kind: best.kind, label: best.label };
  }
  const dist3 = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  /** The big fill colors on the sheets (highlighter markups), biggest first. */
  async function fillColors(opened) {
    const bins = new Map(); let total = 0;
    const perSheet = [];
    for (const sh of opened.sheets) {
      const Z = Math.min(1.5, 1200 / Math.max(sh.ptW, sh.ptH));
      const r = await render(sh, Z);
      const img = r.ctx.getImageData(0, 0, r.W, r.H).data;
      perSheet.push({ sh, img, W: r.W, H: r.H, Z });
      for (let i = 0; i < img.length; i += 4) {
        const c = [img[i], img[i + 1], img[i + 2]];
        const mx = Math.max(...c); const mn = Math.min(...c);
        total++;
        if (mx - mn < 40 || mx < 90) continue;
        // pure red/magenta ink (callout text, leader lines, clouds) is not a floor fill
        if (c[0] > 180 && c[1] < 70 && c[2] < 90) continue;
        const k = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4);
        const b = bins.get(k) || { n: 0, s: [0, 0, 0] };
        b.n++; b.s[0] += c[0]; b.s[1] += c[1]; b.s[2] += c[2];
        bins.set(k, b);
      }
    }
    const peaks = [...bins.values()].map((b) => ({ n: b.n, c: b.s.map((v) => v / b.n) })).sort((a, b) => b.n - a.n);
    const out = [];
    for (const p of peaks) {
      const hit = out.find((o) => dist3(o.c, p.c) < 46);
      if (hit) { hit.n += p.n; continue; }
      out.push({ ...p });
    }
    // a see-through highlighter shows one hue in many shades (over white, over linework): one color
    const hueOf = (c) => { const [r, g, b] = c; const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); if (mx === mn) return 0; let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); h *= 60; return h < 0 ? h + 360 : h; };
    const groups = [];
    for (const o of out) {
      const h = hueOf(o.c);
      const g = groups.find((x) => Math.min(Math.abs(x.h - h), 360 - Math.abs(x.h - h)) < 14);
      if (g) g.parts.push(o); else groups.push({ h, parts: [o] });
    }
    const merged = groups.map((g) => {
      const vivid = g.parts.filter((p) => Math.max(...p.c) - Math.min(...p.c) >= 80);
      const rep = (vivid.length ? vivid : g.parts).sort((a, b) => b.n - a.n)[0];
      return { c: rep.c, n: g.parts.reduce((a, p) => a + p.n, 0) };
    }).sort((a, b) => b.n - a.n);
    const min = Math.max(400, total * 0.004);
    for (const o of merged) o.c = o.c.map((v) => Math.round(v));
    const colors = merged.filter((o) => o.n >= min).slice(0, 6).map((o) => ({ color: hexOf(o.c), rgb: o.c, px: o.n }));
    return { colors, perSheet };
  }

  /** The colored box a note is written on: grow from the text while the edge is still that color. */
  function boxAround(l, img, W, H, Z, col) {
    const isCol = (x, y) => { const i = (y * W + x) * 4; const sh = shadeOf([img[i], img[i + 1], img[i + 2]], [col]); return Boolean(sh && sh.t >= 0.6); };
    let x0 = Math.floor(l.x0 * Z); let x1 = Math.ceil(l.x1 * Z); let y0 = Math.floor(l.y0 * Z); let y1 = Math.ceil(l.y1 * Z);
    const share = (xa, xb, ya, yb) => { let n = 0; let c = 0; for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; if (isCol(x, y)) c++; } return n ? c / n : 0; };
    const lim = Math.round(160 * Z);
    for (let k = 0; k < lim && share(x0 - 1, x0 - 1, y0, y1) > 0.5; k++) x0--;
    for (let k = 0; k < lim && share(x1 + 1, x1 + 1, y0, y1) > 0.5; k++) x1++;
    for (let k = 0; k < lim && share(x0, x1, y0 - 1, y0 - 1) > 0.5; k++) y0--;
    for (let k = 0; k < lim && share(x0, x1, y1 + 1, y1 + 1) > 0.5; k++) y1++;
    return { x0: x0 / Z - 2, x1: x1 / Z + 2, y0: y0 / Z - 2, y1: y1 / Z + 2 };
  }
  /** Which of the colors a pixel is, also when the markup is see-through (light) or over linework (dark). */
  function shadeOf(c, colors) {
    let best = -1; let bd = 30; let bt = 0;
    colors.forEach((k, j) => {
      const v = [k.rgb[0] - 255, k.rgb[1] - 255, k.rgb[2] - 255]; const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] || 1;
      const p = [c[0] - 255, c[1] - 255, c[2] - 255];
      const t = (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / vv;
      if (t < 0.3 || t > 1.6) return;
      const tc = Math.min(1, t);
      const d = Math.max(Math.abs(p[0] - tc * v[0]), Math.abs(p[1] - tc * v[1]), Math.abs(p[2] - tc * v[2])) / (t > 1 ? t : 1);
      if (d < bd) { bd = d; best = j; bt = t; }
    });
    return best < 0 ? null : { j: best, t: bt };
  }
  /** Background behind a text line (median of the non-ink pixels in its box). */
  function bgUnder(l, img, W, H, Z) {
    const x0 = Math.max(0, Math.floor(l.x0 * Z)); const x1 = Math.min(W - 1, Math.ceil(l.x1 * Z));
    const y0 = Math.max(0, Math.floor(l.y0 * Z)); const y1 = Math.min(H - 1, Math.ceil(l.y1 * Z));
    const px = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * W + x) * 4; const c = [img[i], img[i + 1], img[i + 2]];
      if (c[0] + c[1] + c[2] < 300) continue; // ink
      px.push(c);
    }
    if (px.length < 8) return null;
    return [0, 1, 2].map((k) => median(px.map((p) => p[k])));
  }
  /** Share of each color around a point (radius in pt), to tie a callout to the area it points at. */
  function colorsNear(cx, cy, rad, img, W, H, Z, colors) {
    const n = new Array(colors.length).fill(0);
    const r = Math.round(rad * Z); const X = Math.round(cx * Z); const Y = Math.round(cy * Z);
    for (let y = Math.max(0, Y - r); y < Math.min(H, Y + r); y += 2) for (let x = Math.max(0, X - r); x < Math.min(W, X + r); x += 2) {
      const i = (y * W + x) * 4; const c = [img[i], img[i + 1], img[i + 2]];
      const sh = shadeOf(c, colors);
      if (sh) n[sh.j]++;
    }
    return n;
  }
  /** Floor product details written in a note: '6" WHITE OAK - SITE FIN.' → width, species, finish. */
  function specFromNote(text) {
    const u = text.toUpperCase(); const spec = {};
    const w = /(\d{1,2}(?:[-\s]\d\/\d)?)\s*(?:"|”|″|IN\b|INCH)/.exec(u);
    if (w) spec.width = `${w[1].replace(/\s/, '-')}"`;
    const sp = /(WHITE OAK|RED OAK|HICKORY|MAPLE|WALNUT|ASH|BIRCH|ACACIA)/.exec(u);
    if (sp) spec.species = titleCase(sp[1]);
    if (/SITE\s*FIN|UNFINISHED|SAND\s*(?:&|AND)\s*FINISH/.test(u)) spec.finish = 'Unfinished — sand & finish on site';
    else if (/PRE-?FINISHED/.test(u)) spec.finish = 'Prefinished';
    if (/ENGINEERED/.test(u)) spec.construction = 'Engineered'; else if (/\bSOLID\b/.test(u)) spec.construction = 'Solid';
    return spec;
  }
  /**
   * Plans marked up without a legend: finds the fill colors and names them from the notes —
   * a note written on a box of that color, or callouts sitting next to areas of that color.
   * Returns the floors it could name and the colors it couldn't.
   */
  async function markupColors(opened) {
    const { colors, perSheet } = await fillColors(opened);
    if (!colors.length) return { mats: [], unknown: [] };
    const votes = colors.map(() => ({}));
    // notes per sheet: the same highlighter can mean wood upstairs and concrete in the basement
    const local = new Map(); // page → colors.map(() => {kind: {label, n, spec}})
    const addNote = (page, j, k, text, w) => {
      if (!local.has(page)) local.set(page, colors.map(() => ({})));
      const sv = local.get(page)[j];
      sv[k.kind] = sv[k.kind] || { ...k, n: 0, spec: {} };
      sv[k.kind].n += w;
      Object.assign(sv[k.kind].spec, specFromNote(text));
    };
    for (const { sh, img, W, H, Z } of perSheet) {
      // notes are often split over lines: join each line with the one under it for the words
      const ls = sh.lines.filter((l) => l.ang === 0 && l.text.length <= 60);
      const noteOf = (l) => {
        // the lines of one note: same left edge, stacked one under the other
        const block = [l];
        for (let dir of [-1, 1]) {
          let cur = l;
          for (let k = 0; k < 6; k++) {
            const nx = ls.find((m) => !block.includes(m) && Math.abs(m.x0 - cur.x0) < Math.max(6, cur.h * 1.2) && (dir > 0 ? m.y0 > cur.y0 && m.y0 - cur.y1 < cur.h * 1.4 : m.y0 < cur.y0 && cur.y0 - m.y1 < cur.h * 1.4));
            if (!nx) break;
            block.push(nx); cur = nx;
          }
        }
        return block.sort((a, b) => a.y0 - b.y0).map((m) => m.text).join(' ');
      };
      // the color covering most of this sheet (for "… THROUGHOUT" notes)
      const share = colorsNear(sh.ptW / 2, sh.ptH / 2, Math.max(sh.ptW, sh.ptH), img, W, H, Z, colors);
      const main = share.indexOf(Math.max(...share));
      const seenText = new Set();
      ls.forEach((l) => {
        const text = noteOf(l);
        const k = noteKind(text) || noteKind(l.text);
        const U = text.toUpperCase();
        if (!k || NOT_FLOOR.test(U) && k.kind !== 'tile') return;
        const bg = bgUnder(l, img, W, H, Z);
        const on = bg ? shadeOf(bg, colors) : null;
        if (on && on.t >= 0.75) {
          // the note is written on a solid box of that color: that's the color's legend — and not a floor
          sh.noteBoxes = sh.noteBoxes || [];
          if (!sh.noteBoxes.some((b) => l.cx >= b.x0 && l.cx <= b.x1 && l.cy >= b.y0 && l.cy <= b.y1)) sh.noteBoxes.push(boxAround(l, img, W, H, Z, colors[on.j]));
          if (seenText.has(text)) return; seenText.add(text);
          addNote(sh.page, on.j, k, text, WHOLE_LEVEL.test(U) ? 3 : 1);
          return;
        }
        if (WHOLE_LEVEL.test(U) && share[main] > 0 && !seenText.has(text)) {
          // "POLISHED CONCRETE THROUGHOUT": the whole level, whatever color it was marked in
          seenText.add(text);
          addNote(sh.page, main, k, text, 2);
          return;
        }
        const near = colorsNear(l.cx, l.cy, 36, img, W, H, Z, colors);
        const tot = near.reduce((a, b) => a + b, 0);
        if (!tot) return;
        near.forEach((n, j) => { if (n / tot > 0.25) { const v = votes[j]; v[k.kind] = v[k.kind] || { ...k, n: 0, spec: specFromNote(text) }; v[k.kind].n += n / tot; } });
      });
    }
    const top = (o) => Object.values(o).sort((a, b) => b.n - a.n)[0] || null;
    const name = (pg) => (opened.sheets.find((x) => x.page === pg) || {}).name || `Sheet ${pg}`;
    const mats = []; const unknown = [];
    colors.forEach((c, j) => {
      // what each sheet's notes say this color is
      const perPage = [...local.entries()].map(([page, arr]) => ({ page, pick: top(arr[j]) })).filter((x) => x.pick);
      // the color's usual meaning: the kind most sheets agree on (then the most notes)
      const tally = {};
      for (const x of perPage) { const t = tally[x.pick.kind] || (tally[x.pick.kind] = { ...x.pick, sheets: 0, n: 0, spec: {} }); t.sheets++; t.n += x.pick.n; Object.assign(t.spec, x.pick.spec); }
      const s0 = Object.values(tally).sort((a, b) => b.sheets - a.sheets || b.n - a.n)[0] || null;
      const v = top(votes[j]);
      const pick = s0 || v;
      if (!pick) { unknown.push({ color: c.color, px: c.px }); return; }
      const odd = perPage.filter((x) => x.pick.kind !== pick.kind);
      mats.push({ label: pick.label, color: c.color, kind: pick.kind, spec: pick.spec || {}, from: s0 ? 'note' : 'callout', not_pages: odd.map((x) => x.page) });
      // sheets whose notes say otherwise get their own floor for this color
      const byKind = {};
      for (const x of odd) (byKind[x.pick.kind] = byKind[x.pick.kind] || { ...x.pick, pages: [], spec: {} }).pages.push(x.page), Object.assign(byKind[x.pick.kind].spec, x.pick.spec);
      for (const o of Object.values(byKind)) mats.push({ label: o.label, color: c.color, kind: o.kind, spec: o.spec, from: 'note', pages: o.pages });
    });
    return {
      mats: mats.map((m, i) => {
        const out = { key: m.kind + '-' + (i + 1), label: m.label, color: m.color, kind: m.kind, include: DEFAULT_ON.includes(m.kind), sand_finish: m.kind === 'hardwood' && /site|sand/i.test(m.spec.finish || ''), spec: m.spec, from: m.from };
        if (m.pages && m.pages.length) { out.pages = m.pages; out.where = m.pages.map(name).join(', '); }
        if (m.not_pages && m.not_pages.length) { out.not_pages = m.not_pages; out.where = 'All but ' + m.not_pages.map(name).join(', '); }
        return out;
      }),
      unknown,
    };
  }
  /** Whether a floor color counts on a sheet (a color can mean another floor on one sheet). */
  function onSheet(m, page) {
    if (Array.isArray(m.pages) && m.pages.length && !m.pages.includes(page)) return false;
    if (Array.isArray(m.not_pages) && m.not_pages.includes(page)) return false;
    return true;
  }

  function boxOf(col) {
    const xs = col.map((h) => h.line.x0); const xe = col.map((h) => h.line.x1); const ys = col.map((h) => h.line.y0); const ye = col.map((h) => h.line.y1);
    return { x0: Math.min(...xs) - 45, x1: Math.max(...xe) + 25, y0: Math.min(...ys) - 18, y1: Math.max(...ye) + 18 };
  }

  /**
   * Reads one sheet with the given materials and scale. Returns the level for the measurement
   * plus a preview image (data URL) and the per-pixel labels for the overlay.
   */
  async function readSheet(sheet, mats, ppf, onProgress) {
    const Z = zoomFor(sheet, ppf);
    onProgress && onProgress({ step: 'render', page: sheet.page });
    const r = await render(sheet, Z);
    const img = r.ctx.getImageData(0, 0, r.W, r.H).data;
    onProgress && onProgress({ step: 'floors', page: sheet.page });
    const exclude = [...(sheet.legendBox ? [sheet.legendBox] : []), ...(sheet.noteBoxes || [])];
    // a color can mean another floor on one sheet ("POLISHED CONCRETE THROUGHOUT" on the basement)
    const use = mats.map((m) => ({ ...m, skip: !onSheet(m, sheet.page) }));
    const fl = await floorsOf(img, r.W, r.H, use, ppf, Z, exclude, (f) => onProgress && onProgress({ step: 'floors', page: sheet.page, f }));
    await tick();
    onProgress && onProgress({ step: 'rooms', page: sheet.page });
    const ro = roomsOf(fl.labels, r.W, r.H, mats, sheet.lines, Z, fl.pxPerFt);
    const rooms = ro.list;
    const grid = gridOf(fl.labels, r.W, r.H, fl.pxPerFt, mats.length, ro.roomPx);
    // preview: the sheet itself, max 1600 px wide
    const ps = Math.min(1, 1600 / r.W);
    const pv = document.createElement('canvas'); pv.width = Math.round(r.W * ps); pv.height = Math.round(r.H * ps);
    pv.getContext('2d').drawImage(r.canvas, 0, 0, pv.width, pv.height);
    const preview = pv.toDataURL('image/jpeg', 0.82);
    r.canvas.width = 1; r.canvas.height = 1;
    return {
      level: {
        id: 'lv' + sheet.page,
        page: sheet.page,
        name: sheet.name,
        scale_ppf: ppf,
        scale_auto: Boolean(sheet.ppf && Math.abs(sheet.ppf - ppf) < 1e-6),
        include: rooms.length > 0,
        floor: sheet.order,
        rooms: rooms.map((rm, i) => ({ id: `r${sheet.page}-${i + 1}`, name: rm.name, material: mats[rm.mat - 1].key, area_sf: Math.round(rm.area_sf * 10) / 10, x: Math.round(rm.x * 10) / 10, y: Math.round(rm.y * 10) / 10, exclude: false })),
        grid,
        preview: null,
      },
      preview,
    };
  }

  /** Color under a point of a rendered sheet (for "tap a floor color" on scans). */
  function colorAt(canvas, x, y) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) { const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); if (sat > 12) px.push([d[i], d[i + 1], d[i + 2]]); }
    if (!px.length) return null;
    return hexOf([0, 1, 2].map((k) => median(px.map((p) => p[k]))));
  }

  window.ObTakeoff = { open, legend, markupColors, onSheet, readSheet, render, zoomFor, colorAt, decodeGrid, decodeRle, parseDim, FLOORING, _test: { scaleFromDims, legendKind, cleanRoom, noteKind } };
})();
