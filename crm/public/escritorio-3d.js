/**
 * Escritório IA — showroom 3D (visão geral do escritório).
 * A flooring showroom where each employee sits at their own station. Data comes from the office
 * page through `update()`; clicking a person calls `onPick(key)` (the page opens the quick chat).
 * Falls back to the 2D plan when WebGL or three.js is not available.
 */
(function () {
  'use strict';
  const BASE = '/assets/virtual-office/showroom/';
  const WOOD = [1, 2, 3, 4, 5, 6].map((i) => `${BASE}wood/w${i}.jpg`);
  /** Seated portraits made for the default faces; other faces use a framed portrait at the chair. */
  const SEATED = { mate: `${BASE}seated/mate.png`, 'avatar-1': `${BASE}seated/rafael.png`, 'avatar-2': `${BASE}seated/lara.png`, 'avatar-5': `${BASE}seated/marina.png` };
  const SLOTS = {
    operations: { label: 'OPERAÇÕES', color: '#8A6D4F', x: -4.5, z: -8.5 },
    central: { label: 'APROVAÇÕES', color: '#E7792C', x: 0, z: -8.35 },
    commercial: { label: 'COMERCIAL', color: '#4F6D8A', x: 4.5, z: -8.5 },
    finance: { label: 'FINANCEIRO', color: '#536249', x: -4.5, z: 0.12 },
  };

  function supported() {
    try {
      if (!window.THREE || !window.WebGLRenderingContext) return false;
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (_) { return false; }
  }

  function mount(host, opts) {
    const THREE = window.THREE;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    host.classList.add('office3d');
    host.innerHTML = '<div class="office3d__gl"></div><div class="office3d__overlay"></div>'
      + '<div class="office3d__hud"><button type="button" class="office3d__chip" data-office3d="overview">Visão geral</button></div>'
      + '<p class="office3d__hint">Arraste para girar · roda ou pinça para aproximar · toque numa pessoa para conversar</p>'
      + '<div class="office3d__loading">Montando o showroom…</div>';
    const glHost = host.querySelector('.office3d__gl');
    const overlay = host.querySelector('.office3d__overlay');
    const PIX = {};
    let data = { agents: [], pending: 0 };
    let ready = false;
    let api = { update(next) { data = Object.assign(data, next || {}); }, say() {}, focus() {}, overview() {}, destroy() {} };
    Promise.all(WOOD.map((src) => new Promise((res) => { const im = new Image(); im.onload = () => { PIX[src] = im; res(); }; im.onerror = () => res(); im.src = src; })))
      .then(() => { try { build(); } catch (error) { console.error('[office3d]', error); host.querySelector('.office3d__loading').textContent = 'Não foi possível montar o showroom.'; } });
    return {
      update: (next) => api.update(next),
      say: (key, text, ms) => api.say(key, text, ms),
      focus: (key) => api.focus(key),
      overview: () => api.overview(),
      destroy: () => api.destroy(),
    };

    function build() {
    let pending = 0;
    const plaques = {};
    /* ---------- renderer / scene ---------- */
    const renderer = new THREE.WebGLRenderer({ antialias:true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    glHost.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#EDE9E3').convertSRGBToLinear();
    scene.fog = new THREE.Fog(scene.background, 22, 40);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 80);
    const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    const texOf = (i) => { const src = WOOD[i % WOOD.length]; const t = new THREE.Texture(PIX[src] || undefined); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.needsUpdate = Boolean(PIX[src]); return t; };
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness:.8, metalness:0 }, o));
    const M = {
      wall: std({ color:C('#F7F5F1'), roughness:.95 }),
      ceil: std({ color:C('#FBFAF8'), roughness:1 }),
      bronze: std({ color:C('#6E5A43'), roughness:.45, metalness:.6 }),
      black: std({ color:C('#1C1B1A'), roughness:.5, metalness:.3 }),
      white: std({ color:C('#FFFFFF'), roughness:.7 }),
      led: new THREE.MeshBasicMaterial({ color:C('#FFD9A8') }),
      glass: new THREE.MeshStandardMaterial({ color:C('#CFE0EC'), transparent:true, opacity:.18, roughness:.05, metalness:.1, depthWrite:false }),
      window: new THREE.MeshBasicMaterial({ color:C('#F3F7FA') }),
      olive: std({ color:C('#6B7044'), roughness:.9 }),
      mustard: std({ color:C('#E0A82E'), roughness:.85 }),
      sofa: std({ color:C('#3F5566'), roughness:.9 }),
      paper: std({ color:C('#FFFFFF'), roughness:.9 }),
      rug: std({ color:C('#D9CDBE'), roughness:1 }),
      leaf: std({ color:C('#5E7D4F'), roughness:.9 }),
      pot: std({ color:C('#CBB9A5'), roughness:.9 }),
      screen: new THREE.MeshBasicMaterial({ color:C('#DCE8F4') }),
      strap: std({ color:C('#8B5A34'), roughness:.7 }),
    };
    const woodMat = (i, tint, repeat) => {
      const t = texOf(i);
      if (repeat){ t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
      return std({ map:t, color:C(tint || '#FFFFFF'), roughness:.62 });
    };
    const root = new THREE.Group(); scene.add(root);
    function box(w,h,d,mat,x,y,z,opt){ const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat); m.position.set(x,y,z); m.castShadow = !(opt && opt.noCast); m.receiveShadow = true; root.add(m); return m; }

    /* ---------- room ---------- */
    const RW = 14, X0 = -7, X1 = 7, Z0 = -11, Z1 = 5, H = 3.6;
    // Wide-plank oak floor: planks cut from the wood scans, staggered joints, thin seams.
    function plankFloorTexture(){
      const S = 2048, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
      const span = 4, px = S / span, plankW = .22 * px; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const light = [0, 1, 2, 3].map((i) => PIX[WOOD[i]]).filter(Boolean);
      for (let col = 0; col * plankW < S; col++){
        let y = -rnd() * 2.2 * px;
        while (y < S){
          const len = (1.4 + rnd() * 1.4) * px, im = light[Math.floor(rnd() * light.length)];
          if (im){ const sw = im.width / 3.2, sx = rnd() * (im.width - sw), sy = rnd() * im.height * .3; g.drawImage(im, sx, sy, sw, im.height * .68, col * plankW, y, plankW, len); }
          g.fillStyle = `rgba(${rnd() < .5 ? '255,248,238' : '120,90,60'},${(rnd() * .08).toFixed(3)})`; g.fillRect(col * plankW, y, plankW, len);
          g.fillStyle = 'rgba(70,50,30,.35)'; g.fillRect(col * plankW, y, plankW, 2);
          y += len;
        }
        g.fillStyle = 'rgba(70,50,30,.28)'; g.fillRect(col * plankW, 0, 1.5, S);
      }
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14 / span, 16 / span); return t;
    }
    const floorTex = plankFloorTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, Z1 - Z0), std({ map:floorTex, color:C('#F6EFE6'), roughness:.5 }));
    floor.rotation.x = -Math.PI/2; floor.position.set(0, 0, (Z0 + Z1)/2); floor.receiveShadow = true; floor.userData.floor = true; root.add(floor);

    const upper = []; // hidden in the top view so the room can be seen from above
    const cutaway = [];
    for (const [w, d, x, z] of [[RW, .02, 0, Z0 + .012], [.02, Z1 - Z0, X0 + .012, (Z0+Z1)/2], [.02, Z1 - Z0, X1 - .012, (Z0+Z1)/2]]) box(w, .1, d, M.white, x, .05, z, { noCast:true });
    cutaway.push({ objs:[box(.2, H, Z1 - Z0, M.wall, X0 - .1, H/2, (Z0+Z1)/2, { noCast:true })], p:new THREE.Vector3(X0, 0, 0), n:new THREE.Vector3(-1, 0, 0) });
    cutaway.push({ objs:[box(.2, H, Z1 - Z0, M.wall, X1 + .1, H/2, (Z0+Z1)/2, { noCast:true })], p:new THREE.Vector3(X1, 0, 0), n:new THREE.Vector3(1, 0, 0) });
    cutaway.push({ objs:[box(RW, H, .2, M.wall, 0, H/2, Z0 - .1, { noCast:true })], p:new THREE.Vector3(0, 0, Z0), n:new THREE.Vector3(0, 0, -1) });
    for (const x of [-4.2, 0, 4.2]) { box(2.6, 2.5, .05, M.window, x, 1.85, Z0 + .02, { noCast:true }); box(.06, 2.5, .08, M.black, x, 1.85, Z0 + .05, { noCast:true }); box(2.6, .06, .08, M.black, x, 1.85, Z0 + .05, { noCast:true }); }
    // glass storefront
    const frontWall = { objs:[box(RW, H, .04, M.glass, 0, H/2, Z1, { noCast:true })], p:new THREE.Vector3(0, 0, Z1), n:new THREE.Vector3(0, 0, 1) };
    for (const x of [-7, -3.5, -1.1, 1.1, 3.5, 7]) frontWall.objs.push(box(.08, H, .1, M.black, x, H/2, Z1, { noCast:true }));
    cutaway.push(frontWall);
    const doorL = box(1.08, 2.6, .05, M.glass, -.56, 1.3, Z1 - .05, { noCast:true });
    const doorR = box(1.08, 2.6, .05, M.glass, .56, 1.3, Z1 - .05, { noCast:true });
    frontWall.objs.push(doorL, doorR, box(RW, .1, .14, M.black, 0, 2.65, Z1, { noCast:true }));
    // sunlight patches from the back windows
    const sunPatches = [];
    for (const x of [-4.2, 0, 4.2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), new THREE.MeshBasicMaterial({ color:0xFFF4E2, transparent:true, opacity:.22, depthWrite:false })); p.rotation.x = -Math.PI/2; p.position.set(x + .5, .012, Z0 + 2.6); root.add(p); sunPatches.push(p); }

    /* ---------- track lights with cones ---------- */
    const cones = [];
    const coneMat = () => new THREE.MeshBasicMaterial({ color:0xFFE7C4, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    function trackRow(x, z0, z1, n, aimX){
      upper.push(box(.05, .05, z1 - z0, M.black, x, H - .04, (z0+z1)/2, { noCast:true }));
      for (let i = 0; i < n; i++){
        const z = z0 + (i + .5) * (z1 - z0) / n;
        const head = box(.12, .22, .12, M.black, x, H - .2, z, { noCast:true });
        head.rotation.z = aimX ? (aimX > x ? .55 : -.55) : 0;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(.55, 2.6, 24, 1, true), coneMat());
        upper.push(head); cone.position.set(x + (aimX ? (aimX - x) * .45 : 0), H - 1.6, z); cone.rotation.z = aimX ? (aimX > x ? .55 : -.55) : 0;
        cone.visible = false; cones.push(cone);
      }
    }
    trackRow(3.4, -9.5, 3, 6, 6.6); trackRow(-3.4, -9.5, 3, 6, -6.6); trackRow(0, -6, -1, 2, 0);

    /* ---------- right wall: bronze shelves with tilted boards (Coleções) ---------- */
    const boards = [];
    const COLLECTIONS = ['Carmel','Malibu','Laguna','Sausalito','Big Sur','Monterey','Pismo','Ojai','Mendocino','Catalina'];
    {
      const x = X1 - .35;
      for (let bay = 0; bay < 3; bay++){
        const z = -5.6 + bay * 2.05;
        box(.06, 3.2, .06, M.bronze, x - .3, 1.6, z - 1.0); box(.06, 3.2, .06, M.bronze, x + .25, 1.6, z - 1.0);
        for (let row = 0; row < 2; row++){
          const y = .25 + row * 1.45;
          box(.6, .04, 2, M.bronze, x, y, z);
          const led = box(.04, .02, 1.9, M.led, x - .26, y + 1.38, z, { noCast:true });
          const idx = bay * 2 + row;
          const b = new THREE.Mesh(new THREE.BoxGeometry(.05, 1.2, 1.7), [M.bronze, woodMat(idx), M.bronze, M.bronze, M.bronze, M.bronze]);
          b.position.set(x - .05, y + .66, z); b.rotation.z = .2; b.castShadow = true; b.receiveShadow = true;
          b.material[1] = woodMat(idx, idx % 3 === 0 ? '#F2E7D8' : '#FFFFFF');
          b.userData.board = { name:COLLECTIONS[idx], finish: idx % 6 >= 4 ? 'Carvalho defumado' : 'Carvalho europeu natural', base:b.rotation.z, pull:0, wall:'right', home:b.position.clone() };
          root.add(b); boards.push(b);
          const glow = new THREE.PointLight(0xFFC98A, .32, 2.4, 2); glow.position.set(x - .5, y + 1.1, z); root.add(glow);
        }
      }
      box(.6, .04, 6.2, M.bronze, x, 3.2, -3.55);
    }

    /* ---------- left wall: boards hanging on straps over a glowing ledge (Balcão area) ---------- */
    {
      const x = X0 + .18;
      box(.36, .7, 9, M.white, X0 + .18, .35, -4.2);
      box(.02, .03, 9, M.led, X0 + .37, .02, -4.2, { noCast:true });
      for (let i = 0; i < 9; i++){
        const z = -8.2 + i * .98;
        const idx = 10 + i;
        const b = new THREE.Mesh(new THREE.BoxGeometry(.05, 1.05, .82), [woodMat(idx), M.bronze, M.bronze, M.bronze, M.bronze, M.bronze]);
        b.material[1] = woodMat(idx, i % 4 === 1 ? '#E9DCCB' : '#FFFFFF');
        b.position.set(x + .28, 1.25, z); b.rotation.z = -.1; b.castShadow = true;
        b.userData.board = { name:COLLECTIONS[idx % COLLECTIONS.length] + ' ' + (i + 1), finish: idx % 6 >= 4 ? 'Carvalho escovado escuro' : 'Carvalho claro', base:b.rotation.z, pull:0, wall:'left', home:b.position.clone() };
        root.add(b); boards.push(b);
        box(.02, .26, .05, M.strap, x + .26, 1.86, z - .2, { noCast:true }); box(.02, .26, .05, M.strap, x + .26, 1.86, z + .2, { noCast:true });
      }
    }

    /* ---------- hanging herringbone panel ---------- */
    function herringbone(){
      const c = document.createElement('canvas'); c.width = 512; c.height = 640; const g = c.getContext('2d');
      const imgs = WOOD.slice(0,4).map((src) => { const im = new Image(); im.src = src; return im; });
      const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
      Promise.all(imgs.map((im) => im.decode().catch(() => {}))).then(() => {
        g.fillStyle = '#C9A77E'; g.fillRect(0,0,512,640);
        const pw = 160, ph = 40; let k = 0;
        for (let y = -200; y < 800; y += ph * 2){
          for (let x = -200; x < 700; x += pw){
            for (const dir of [1,-1]){
              g.save(); g.translate(x + (dir < 0 ? pw/2 : 0), y + (dir < 0 ? ph : 0)); g.rotate(dir * Math.PI/4);
              const im = imgs[k++ % imgs.length];
              if (im.complete && im.naturalWidth) g.drawImage(im, (k*37)%200, (k*53)%300, 220, 60, 0, 0, pw, ph);
              g.strokeStyle = 'rgba(60,40,20,.35)'; g.lineWidth = 1.5; g.strokeRect(0,0,pw,ph); g.restore();
            }
          }
        }
        tex.needsUpdate = true;
      });
      return tex;
    }
    const hb = new THREE.Group(); hb.position.set(0, 1.85, -3.3); root.add(hb);
    { const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.65, .05), std({ map:herringbone(), roughness:.6 })); m.castShadow = true; hb.add(m);
      for (const x of [-.5,.5]) { const ch = box(.012, 1.0, .012, M.black, x, 1.32, 0, { noCast:true }); root.remove(ch); hb.add(ch); } }

    /* ---------- sectors: a wooden bay for each person, with the name on a plaque, all facing the entrance ---------- */
    const ZONES = {
      fin:  { name:'FINANCEIRO', who:'Marina · pagamentos e cobranças', color:'#536249' },
      ops:  { name:'OPERAÇÕES', who:'Rafael · agenda e equipes', color:'#8A6D4F' },
      apr:  { name:'APROVAÇÕES', who:'Mate · gerente geral', color:'#E7792C' },
      com:  { name:'COMERCIAL', who:'Lara · coleções e orçamentos', color:'#4F6D8A' },
      wait: { name:'SALA DE ESPERA', who:'Clientes e visitas', color:'#B08D62' },
    };
    function plaqueTexture(zn){
      const c = document.createElement('canvas'); c.width = 1024; c.height = 240; const g = c.getContext('2d');
      g.fillStyle = '#2B2622'; g.fillRect(0, 0, 1024, 240);
      g.fillStyle = zn.color; g.fillRect(0, 0, 18, 240);
      g.fillStyle = '#F7F1E8'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      let fs = 92; g.font = `800 ${fs}px Geist, sans-serif`; g.letterSpacing = '6px';
      while (fs > 48 && g.measureText(zn.name).width > 900){ fs -= 4; g.font = `800 ${fs}px Geist, sans-serif`; }
      g.fillText(zn.name, 64, 128);
      g.letterSpacing = '0px'; g.globalAlpha = .72; g.font = '500 40px Geist, sans-serif'; g.fillText(zn.who, 66, 192);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t;
    }
    const BAY_W = 3.4, BAY_H = 3.05;
    function bay(slot, zn, cx, cz){
      const slats = 14, sw = BAY_W / slats;
      for (let i = 0; i < slats; i++) box(sw - .03, BAY_H, .1, woodMat(i % 3, i % 2 ? '#F3E8DA' : '#FFFFFF'), cx - BAY_W/2 + sw * (i + .5), BAY_H/2 + .06, cz);
      box(BAY_W, .12, .2, M.bronze, cx, .06, cz, { noCast:true });
      box(BAY_W, .14, .16, M.bronze, cx, BAY_H + .1, cz);
      box(BAY_W - .1, .06, .14, M.black, cx, BAY_H - .02, cz + .02, { noCast:true });
      const W = 3.2, H = W * 240 / 1024;
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map:plaqueTexture(zn) }));
      plaque.position.set(cx, 2.62, cz + .062); root.add(plaque); plaques[slot] = plaque;
      const led = box(BAY_W - .2, .02, .03, M.led, cx, BAY_H - .08, cz + .08, { noCast:true });
      box(.9, .04, .24, woodMat(5, '#FFFFFF'), cx + 1.05, 1.55, cz + .17);
      for (let i = 0; i < 3; i++) box(.22, .16 - i * .03, .18, woodMat(i), cx + .78 + i * .24, 1.65 - i * .015, cz + .17);
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, .22, 16), M.white); vase.position.set(cx - 1.1, 1.68, cz + .17); root.add(vase);
      box(.9, .04, .24, woodMat(5, '#FFFFFF'), cx - 1.05, 1.55, cz + .17);
      for (let i = 0; i < 4; i++) box(.05, .28, .2, woodMat(i + 2), cx - 1.38 + i * .07, 1.71, cz + .17, { noCast:true });
      return { x0:cx - BAY_W/2 - .15, x1:cx + BAY_W/2 + .15, z0:cz - .25, z1:cz + .25 };
    }
    function velvetChair(cx, cz, rotY){
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY; root.add(g);
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
      add(new THREE.BoxGeometry(.5, .09, .48), M.olive, 0, .47, 0);
      const back = add(new THREE.CylinderGeometry(.27, .27, .42, 20, 1, false, -Math.PI/2, Math.PI), M.olive, 0, .74, .02); back.scale.z = .35;
      for (const lx of [-.21, .21]) for (const lz of [-.19, .19]) add(new THREE.CylinderGeometry(.012, .012, .43, 8), M.bronze, lx, .215, lz);
      return g;
    }
    function deskLamp(x, z){
      box(.14, .02, .14, M.black, x, .8, z, { noCast:true });
      const a = box(.02, .38, .02, M.black, x, 1.0, z); a.rotation.z = .25;
      const b = box(.02, .3, .02, M.black, x - .12, 1.22, z); b.rotation.z = -1.0;
      const shade = new THREE.Mesh(new THREE.ConeGeometry(.08, .12, 16, 1, true), M.black); shade.position.set(x - .26, 1.25, z); shade.rotation.z = .6; root.add(shade);
      const bulb = new THREE.PointLight(0xFFD7A0, .25, 1.6, 2); bulb.position.set(x - .3, 1.15, z); root.add(bulb);
    }
    function deskPlant(x, z){
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.07, .06, .12, 16), M.pot); pot.position.set(x, .84, z); root.add(pot);
      const l = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 10), M.leaf); l.position.set(x, .97, z); l.scale.y = 1.3; l.castShadow = true; root.add(l);
    }
    function desk(cx, cz){
      const w = 1.8, d = .8;
      box(w, .045, d, woodMat(3, '#F6EDE2'), cx, .765, cz);
      box(w + .01, .02, d + .01, woodMat(4, '#8A6A4A'), cx, .735, cz, { noCast:true });
      // drawer pedestal on the right, bronze frame on the left
      box(.46, .7, d - .06, woodMat(2, '#EFE3D3'), cx + w/2 - .26, .37, cz);
      for (let i = 0; i < 3; i++){ box(.42, .006, .01, M.black, cx + w/2 - .26, .2 + i * .2, cz + d/2 - .025, { noCast:true }); box(.12, .015, .02, M.bronze, cx + w/2 - .26, .28 + i * .2, cz + d/2 - .015, { noCast:true }); }
      box(.04, .72, .04, M.bronze, cx - w/2 + .06, .36, cz - d/2 + .06); box(.04, .72, .04, M.bronze, cx - w/2 + .06, .36, cz + d/2 - .06);
      box(.04, .04, d - .1, M.bronze, cx - w/2 + .06, .05, cz);
      // monitor on a stand, keyboard, mouse, notebook, mug, sample stack, lamp, plant
      // open laptop turned to the person (low, so the face stays visible)
      box(.36, .015, .25, std({ color:C('#BFC3C7'), metalness:.4, roughness:.35 }), cx + .38, .795, cz - .12, { noCast:true });
      const lid = box(.36, .24, .012, std({ color:C('#BFC3C7'), metalness:.4, roughness:.35 }), cx + .38, .91, cz + .02); lid.rotation.x = .35;
      box(.06, .02, .1, std({ color:C('#DCD8D2') }), cx + .05, .795, cz - .05, { noCast:true });
      box(.22, .015, .3, std({ color:C('#2F3E46') }), cx + .45, .795, cz + .12, { noCast:true });
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(.04, .035, .1, 14), M.white); mug.position.set(cx + .62, .84, cz - .1); root.add(mug);
      for (let i = 0; i < 3; i++) box(.34, .02, .2, woodMat(i + 1), cx + .5, .8 + i * .022, cz - .22 + i * .01, { noCast:true });
      deskLamp(cx - .72, cz - .25); deskPlant(cx - .78, cz + .22);
      velvetChair(cx - .45, cz + 1.0, Math.PI); velvetChair(cx + .45, cz + 1.0, Math.PI);
      return { x0:cx - w/2 - .15, x1:cx + w/2 + .15, z0:cz - d/2 - .15, z1:cz + d/2 + 1.35 };
    }
    const BACK_Z = -9.4, FRONT_Z = -.3;
    const OBST_EXTRA = [
      bay('operations', ZONES.ops, -4.5, BACK_Z), bay('central', ZONES.apr, 0, BACK_Z), bay('commercial', ZONES.com, 4.5, BACK_Z),
      bay('finance', ZONES.fin, -4.5, FRONT_Z), bay('wait', ZONES.wait, 4.5, FRONT_Z),
      desk(-4.5, -7.7), desk(4.5, -7.7),
    ];
    // Mate's consultation table is the approvals desk.
    const table = box(2.6, .07, 1.05, woodMat(2, '#F7EEE2'), 0, .76, -7.5);
    box(2.62, .025, 1.07, woodMat(4, '#8A6A4A'), 0, .715, -7.5, { noCast:true });
    box(1.6, .005, .34, std({ color:C('#E9E1D4'), roughness:1 }), 0, .8, -7.5, { noCast:true });
    for (const px of [-.7, .7]){ const shade = new THREE.Mesh(new THREE.CylinderGeometry(.12, .2, .22, 24, 1, true), M.black); shade.position.set(px, 2.15, -7.5); root.add(shade); upper.push(box(.008, 1.3, .008, M.black, px, 2.9, -7.5, { noCast:true })); const l = new THREE.PointLight(0xFFD7A0, .35, 3, 2); l.position.set(px, 2.0, -7.5); root.add(l); }
    deskPlant(-1.05, -7.75);
    box(.08, .74, .8, M.bronze, -1.0, .37, -7.5); box(.08, .74, .8, M.bronze, 1.0, .37, -7.5);
    for (const cx of [-.65, .65]) velvetChair(cx, -6.7, Math.PI);
    OBST_EXTRA.push({ x0:-1.5, x1:1.5, z0:-8.15, z1:-6.35 });
    const papers = new THREE.Group(); root.add(papers);
    function drawPapers(){
      papers.clear();
      for (let i = 0; i < pending; i++){
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(.3, .012 + i*.004, .4), M.paper);
        sheet.position.set(-.6 + i * .45, .8 + i * .002, -7.3); sheet.rotation.y = (i - 1) * .12; sheet.castShadow = true; papers.add(sheet);
        const chip = new THREE.Mesh(new THREE.BoxGeometry(.16, .02, .1), woodMat(i + 2)); chip.position.set(-.55 + i*.45, .82 + i*.004, -7.2); papers.add(chip);
      }
    }
    drawPapers();
    // Marina's counter in front of the Financeiro bay.
    box(2.2, 1.0, .6, woodMat(4, '#FFFFFF'), -4.5, .5, .93);
    for (let i = 0; i < 22; i++){ const f = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .96, 10, 1, false, 0, Math.PI), woodMat(i % 3, '#F1E4D2')); f.rotation.y = -Math.PI/2; f.position.set(-4.5 - 1.05 + i * .1, .5, 1.23); f.castShadow = true; root.add(f); }
    box(2.3, .05, .75, std({ color:C('#F2F0EC'), roughness:.25, metalness:.05 }), -4.5, 1.03, .95);
    box(.09, .14, .05, M.black, -3.95, 1.12, .85); deskPlant(-3.6, .8);
    const marinaScreen = box(.5, .3, .01, M.screen, -5.25, 1.28, .82, { noCast:true }); marinaScreen.rotation.y = -.5;
    const marinaMon = box(.54, .34, .04, M.black, -5.27, 1.28, .8); marinaMon.rotation.y = -.5;
    OBST_EXTRA.push({ x0:-5.8, x1:-3.2, z0:.45, z1:1.45 });
    // Waiting area in front of its bay.
    (function rug(){ const c = document.createElement('canvas'); c.width = 600; c.height = 440; const g = c.getContext('2d'); g.fillStyle = '#E2D7C8'; g.fillRect(0,0,600,440); g.strokeStyle = '#B9A88F'; g.lineWidth = 10; g.strokeRect(22,22,556,396); g.lineWidth = 3; g.strokeRect(44,44,512,352); g.globalAlpha = .25; for (let i = 0; i < 600; i += 6){ g.fillStyle = i % 12 ? '#D6C9B7' : '#EEE6DA'; g.fillRect(i, 0, 3, 440); } const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; const m = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.2), std({ map:t, roughness:1 })); m.rotation.x = -Math.PI/2; m.position.set(4.5, .012, 1.9); m.receiveShadow = true; root.add(m); })();
    box(2.2, .14, .9, M.sofa, 4.5, .2, .78);
    for (const sx of [-.53, .53]) { box(1.0, .14, .78, M.sofa, 4.5 + sx, .34, .82); box(1.0, .46, .2, M.sofa, 4.5 + sx, .62, .42); }
    for (const ax of [-1.17, 1.17]) box(.16, .5, .9, M.sofa, 4.5 + ax, .38, .78);
    for (const lx of [-1.0, 1.0]) for (const lz of [.42, 1.15]) box(.04, .13, .04, M.black, 4.5 + lx, .065, lz, { noCast:true });
    box(.34, .3, .1, M.mustard, 3.75, .56, .55).rotation.z = .2; box(.34, .3, .1, std({ color:C('#E8E1D6') }), 5.25, .56, .55).rotation.z = -.2;
    for (const ax of [3.3, 5.7]){
      const g = new THREE.Group(); g.position.set(ax, 0, 3.0); g.rotation.y = Math.PI + (ax < 4.5 ? -.35 : .35); root.add(g);
      const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, M.mustard); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
      add(new THREE.BoxGeometry(.72, .16, .7), 0, .34, 0); add(new THREE.BoxGeometry(.72, .52, .16), 0, .62, .3);
      add(new THREE.BoxGeometry(.12, .34, .7), -.36, .48, 0); add(new THREE.BoxGeometry(.12, .34, .7), .36, .48, 0);
      for (const lx of [-.3, .3]) for (const lz of [-.28, .28]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.018, .012, .26, 8), M.bronze); leg.position.set(lx, .13, lz); g.add(leg); }
    }
    const ct = new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.04,32), woodMat(3, '#F3E8DA')); ct.position.set(4.5, .4, 1.9); ct.castShadow = true; root.add(ct);
    box(.04, .38, .04, M.black, 4.5, .2, 1.9, { noCast:true });
    for (let i = 0; i < 3; i++) box(.26 - i * .03, .03, .2 - i * .02, std({ color:C(['#3F5566','#E8E1D6','#B08D62'][i]) }), 4.38, .435 + i * .03, 1.85, { noCast:true });
    const fl = box(.03, 1.6, .03, M.black, 6.1, .8, .35); const flShade = new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, .26, 20, 1, true), std({ color:C('#F3EBDD'), side:THREE.DoubleSide })); flShade.position.set(6.1, 1.65, .35); root.add(flShade);
    const flLight = new THREE.PointLight(0xFFD7A0, .35, 3, 2); flLight.position.set(6.1, 1.55, .35); root.add(flLight);
    OBST_EXTRA.push({ x0:2.8, x1:6.2, z0:.2, z1:3.6 });
    for (const [px, pz] of [[-6.4, 4.2],[6.4, -10.3],[-6.4,-10.3],[6.4, -7.6]]) { box(.5,.6,.5,M.pot,px,.3,pz); const l = new THREE.Mesh(new THREE.SphereGeometry(.45,16,12), M.leaf); l.position.set(px, 1.05, pz); l.scale.y = 1.4; l.castShadow = true; root.add(l); }
    const pivots = [];

    /* ---------- wall sign over the collections ---------- */
    function sign(text, w){
      const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d');
      g.fillStyle = '#6E5A43'; g.fillRect(0,0,1024,160); g.fillStyle = '#F7F1E8'; g.font = '600 64px Geist, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.letterSpacing = '8px'; g.fillText(text, 512, 84);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 1024), new THREE.MeshBasicMaterial({ map:t }));
    }
    { const s = sign('COLEÇÕES', 2.2); s.position.set(X1 - .02, 3.35, -3.55); s.rotation.y = -Math.PI/2; root.add(s); }

    /* ---------- lights ---------- */
    const hemi = new THREE.HemisphereLight(0xFFFFFF, 0xD9C8B2, .55); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xFFF1DE, .9); sun.position.set(-3, 9, -16); sun.target.position.set(0, 0, -2); scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048); Object.assign(sun.shadow.camera, { left:-10, right:10, top:12, bottom:-12, near:1, far:40 }); sun.shadow.bias = -.0004; scene.add(sun);
    const fill = new THREE.PointLight(0xFFE2BC, .5, 14, 2); fill.position.set(0, 3.2, -3); scene.add(fill);
    const front = new THREE.PointLight(0xFFFFFF, .35, 14, 2); front.position.set(0, 3.2, 3); scene.add(front);

    upper.forEach((o) => { o.visible = false; });

    /* ---------- people at their stations ---------- */
    const people = {};
    const contactTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(40,28,18,.45)'); gr.addColorStop(1, 'rgba(40,28,18,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    function officeChair(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g);
      const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
      const fabric = std({ color: C('#2A2826'), roughness: .9 });
      add(new THREE.BoxGeometry(.52, .08, .5), fabric, 0, .48, 0);
      const back = add(new THREE.BoxGeometry(.48, .62, .06), fabric, 0, .88, -.27); back.rotation.x = -.12;
      add(new THREE.CylinderGeometry(.03, .03, .36, 10), M.black, 0, .27, 0);
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const leg = add(new THREE.BoxGeometry(.04, .03, .3), M.black, Math.sin(a) * .15, .06, Math.cos(a) * .15); leg.rotation.y = a; add(new THREE.SphereGeometry(.03, 8, 6), M.black, Math.sin(a) * .29, .03, Math.cos(a) * .29); }
      for (const sx of [-.27, .27]) add(new THREE.BoxGeometry(.04, .04, .3), M.black, sx, .66, -.02);
    }
    Object.values(SLOTS).forEach((slot) => {
      officeChair(slot.x, slot.z - .1);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .8), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.set(slot.x, .013, slot.z); root.add(sh);
    });
    function portraitCard(faceUrl, name) {
      // A framed portrait standing on the chair, for faces without a seated picture.
      const c = document.createElement('canvas'); c.width = 400; c.height = 520; const g = c.getContext('2d');
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
      const draw = (img) => {
        g.clearRect(0, 0, 400, 520);
        g.fillStyle = '#2B2622'; g.beginPath(); g.roundRect ? g.roundRect(0, 0, 400, 520, 28) : g.rect(0, 0, 400, 520); g.fill();
        g.save(); g.beginPath(); g.arc(200, 210, 160, 0, Math.PI * 2); g.clip();
        if (img) g.drawImage(img, 40, 50, 320, 320); else { g.fillStyle = '#6E5A43'; g.fillRect(40, 50, 320, 320); }
        g.restore(); g.fillStyle = '#F7F1E8'; g.font = '700 46px Geist, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(name, 200, 452);
        t.needsUpdate = true;
      };
      draw(null);
      const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => draw(img); img.src = faceUrl;
      return t;
    }
    function setPerson(slotKey, agent) {
      const slot = SLOTS[slotKey];
      const id = agent ? `${agent.key}|${agent.seated || ''}|${agent.face || ''}|${agent.name}` : '';
      if (slot.id === id) return;
      slot.id = id;
      if (slot.mesh) { root.remove(slot.mesh); slot.mesh.geometry.dispose(); slot.mesh.material.dispose(); slot.mesh = null; }
      if (!agent) return;
      let mesh;
      if (agent.seated) {
        const t = loader.load(agent.seated); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
        const h = 1.45, w = h * 2 / 3; const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: .3, toneMapped: false }));
      } else {
        const geo = new THREE.PlaneGeometry(.62, .8); geo.translate(0, 1.0, 0);
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: portraitCard(agent.face, agent.name), transparent: true, toneMapped: false }));
      }
      mesh.position.set(slot.x, 0, slot.z); mesh.userData.person = agent.key; mesh.renderOrder = 2; root.add(mesh);
      slot.mesh = mesh;
    }

    /* ---------- camera: overview with cutaway walls ---------- */
    const orbit = { az: 0, el: .45, dist: 26, target: new THREE.Vector3(0, 0, -4.2), goal: new THREE.Vector3(0, 0, -4.2), goalDist: 16, goalEl: .8 };
    function overview() { orbit.goal.set(0, 0, -4.2); orbit.goalDist = camera.aspect < .8 ? 25 : 16; orbit.goalEl = camera.aspect < .8 ? 1.0 : .8; orbit.az = 0; }
    function focusAt(x, z) { orbit.az = 0; orbit.goal.set(x - (camera.aspect > 1.2 ? .9 : 0), .9, z + .6); orbit.goalDist = camera.aspect < .8 ? 9 : 6.5; orbit.goalEl = .42; }
    let sized = false;
    function resize() { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.fov = camera.aspect < .8 ? 66 : 54; camera.updateProjectionMatrix(); if (!sized) { sized = true; overview(); orbit.dist = orbit.goalDist + 8; } }
    const ro = new ResizeObserver(resize); ro.observe(host); resize(); overview();
    glHost.appendChild(renderer.domElement);

    /* ---------- pointer ---------- */
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const el = renderer.domElement; const ptrs = new Map(); let down = null, moved = false, pinch = 0;
    function pick(e, list) { const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray.intersectObjects(list, true); }
    const personAt = (k) => Object.values(SLOTS).find((s) => s.mesh && s.mesh.userData.person === k);
    function choose(key) { if (!key) return; const slot = personAt(key); if (slot) focusAt(slot.x, slot.z); if (opts && typeof opts.onPick === 'function') opts.onPick(key); }
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); down = [e.clientX, e.clientY]; moved = false; });
    el.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) { const hit = pick(e, Object.values(SLOTS).map((s) => s.mesh).filter(Boolean).concat([table]))[0]; el.style.cursor = hit ? 'pointer' : 'grab'; return; }
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) orbit.goalDist = Math.min(32, Math.max(5, orbit.goalDist * pinch / d)); pinch = d; moved = true; return; }
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) moved = true;
      orbit.az -= (e.clientX - prev[0]) * .006; orbit.goalEl = Math.max(.3, Math.min(1.35, orbit.goalEl + (e.clientY - prev[1]) * .004));
    });
    el.addEventListener('pointerup', (e) => {
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0;
      if (moved || !down) return;
      const hits = pick(e, Object.values(SLOTS).map((s) => s.mesh).filter(Boolean).concat([table]));
      const h = hits[0]; if (!h) return;
      if (h.object.userData.person) choose(h.object.userData.person);
      else if (h.object === table) { const central = data.agents.find((a) => a.department === 'central'); if (central) choose(central.key); }
    });
    el.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); pinch = 0; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); orbit.goalDist = Math.min(32, Math.max(5, orbit.goalDist * (1 + Math.sign(e.deltaY) * .1))); }, { passive: false });
    host.querySelector('[data-office3d="overview"]').addEventListener('click', overview);
    overlay.addEventListener('click', (e) => { const t = e.target.closest('[data-office3d-key]'); if (t) choose(t.dataset.office3dKey); });

    /* ---------- labels and speech bubbles ---------- */
    const bubbles = {};
    const esc = (s) => String(s || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    function project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera); if (v.z > 1 || v.z < -1) return null; const r = host.getBoundingClientRect(); const p = [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; return (p[0] < -60 || p[0] > r.width + 60 || p[1] < -60 || p[1] > r.height + 60) ? null : p; }
    // Tags and bubbles are kept as elements and only moved each frame, so clicks land on a stable node.
    const nodes = new Map();
    function node(id, cls) {
      let n = nodes.get(id);
      if (!n) { n = document.createElement('button'); n.type = 'button'; overlay.appendChild(n); nodes.set(id, n); }
      n.className = cls; n.__seen = true; return n;
    }
    function setHtml(n, html) { if (n.__html !== html) { n.innerHTML = html; n.__html = html; } }
    function renderOverlay(now) {
      const r = host.getBoundingClientRect();
      nodes.forEach((n) => { n.__seen = false; });
      for (const slot of Object.values(SLOTS)) {
        if (!slot.mesh) continue;
        const key = slot.mesh.userData.person; const agent = data.agents.find((x) => x.key === key); if (!agent) continue;
        const a = key === data.chatKey ? null : project(slot.x, 0, slot.z + 1.75);
        if (a) {
          const n = node(`tag:${key}`, 'office3d__tag'); n.dataset.office3dKey = key; n.dataset.tone = agent.tone || 'idle';
          setHtml(n, `<i aria-hidden="true"></i><span><strong>${esc(agent.name)}</strong>${agent.line ? `<small>${esc(agent.line)}</small>` : ''}</span>`);
          n.style.transform = `translate(${a[0].toFixed(1)}px, ${a[1].toFixed(1)}px) translate(-50%, -50%)`;
        }
        const b = bubbles[key];
        if (b && b.until < now) delete bubbles[key];
        else if (b && key !== data.chatKey) {
          const h = project(slot.x, 1.95, slot.z);
          if (h) {
            const n = node(`bubble:${key}`, `office3d__bubble${agent.tone === 'waiting' ? ' is-waiting' : ''}`); n.dataset.office3dKey = key;
            setHtml(n, `<strong>${esc(agent.name)}</strong>${esc(b.text)}`);
            n.style.transform = `translate(${Math.max(130, Math.min(r.width - 130, h[0])).toFixed(1)}px, ${(h[1] - 20).toFixed(1)}px) translate(-50%, -100%)`;
          }
        }
      }
      nodes.forEach((n, id) => { if (!n.__seen) { n.remove(); nodes.delete(id); } });
    }

    /* ---------- loop (paused when hidden) ---------- */
    let last = performance.now(), visible = true, raf = 0;
    const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); }); io.observe(host);
    function frame(now) {
      raf = 0;
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const k = reduce ? 1 : Math.min(1, dt * 2.6);
      orbit.target.lerp(orbit.goal, k); orbit.dist += (orbit.goalDist - orbit.dist) * k; orbit.el += (orbit.goalEl - orbit.el) * k;
      const t = orbit.target;
      camera.position.set(t.x + orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az), t.y + orbit.dist * Math.sin(orbit.el), t.z + orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az)); camera.lookAt(t);
      for (const w of cutaway) { const show = camera.position.clone().sub(w.p).dot(w.n) < 0; w.objs.forEach((o) => { o.visible = show; }); }
      for (const slot of Object.values(SLOTS)) if (slot.mesh) slot.mesh.rotation.y = Math.atan2(camera.position.x - slot.x, camera.position.z - slot.z) * .85;
      if (!reduce) { hb.rotation.y = Math.sin(now / 3200) * .35; sunPatches.forEach((p, i) => { p.material.opacity = .18 + Math.sin(now / 2600 + i) * .04; }); }
      renderer.render(scene, camera);
      renderOverlay(now);
      if (visible && document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && visible && !raf) raf = requestAnimationFrame(frame); });

    function apply() {
      for (const [slotKey, slot] of Object.entries(SLOTS)) {
        const agent = data.agents.find((a) => a.department === slotKey);
        setPerson(slotKey, agent || null);
        const label = agent ? { name: slot.label, who: `${agent.name} · ${agent.title}`, color: slot.color } : { name: slot.label, who: 'Mesa livre', color: slot.color };
        const sig = `${label.name}|${label.who}`;
        if (plaques[slotKey] && plaques[slotKey].__sig !== sig) { plaques[slotKey].material.map = plaqueTexture(label); plaques[slotKey].material.needsUpdate = true; plaques[slotKey].__sig = sig; }
      }
      const count = Math.min(5, Math.max(0, Number(data.pending) || 0));
      if (count !== pending) { pending = count; drawPapers(); }
    }
    api = {
      update(next) { data = Object.assign(data, next || {}); apply(); },
      say(key, text, ms) { if (key && text) bubbles[key] = { text: String(text).slice(0, 160), until: performance.now() + (ms || 8000) }; },
      focus(key) { const slot = personAt(key); if (slot) focusAt(slot.x, slot.z); },
      overview,
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); host.innerHTML = ''; },
    };
    apply();
    ready = true;
    host.querySelector('.office3d__loading').remove();
    host.classList.add('is-ready');
    raf = requestAnimationFrame(frame);
    }
  }

  window.OfficeShowroom = { supported, mount, seatedFor: (agent) => (agent.key === 'mate' ? SEATED.mate : (!agent.photoUrl && SEATED[agent.avatarKey]) || '') };
})();
