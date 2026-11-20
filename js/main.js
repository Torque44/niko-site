/* $NIKO first cut: one Three.js scene, the camera is driven by scroll.
   Film time T: 0..1 rooftop, 1..2 across the bay, 2..3 the office. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeInOut = t => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
  const DEG = Math.PI / 180;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- plain UI ---------- */
  const copyBtn = $('#copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = $('#ca').textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied';
      } catch (e) {
        const r = document.createRange(); r.selectNodeContents($('#ca'));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        copyBtn.textContent = 'Selected, press Ctrl+C';
      }
      setTimeout(() => { copyBtn.textContent = 'Copy address'; }, 2200);
    });
  }

  /* ---------- can we run the film? ---------- */
  const canvas = $('#film');
  let renderer = null;
  if (!reduced && window.THREE) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { renderer = null; }
  }
  if (!renderer) return;               // static page: all copy is already visible
  document.documentElement.classList.add('film');

  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 2 : 3));   // final ratio (4K budget + quality governor) is set by NikoPost.setSize
  renderer.outputEncoding = THREE.sRGBEncoding;
  const post = window.NikoPost(renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.25, 2800);
  const C = hex => new THREE.Color(hex).convertSRGBToLinear();

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
  function tex(c) { const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = MAX_ANISO; return t; }
  function at(m, x, y, z) { m.position.set(x, y, z); return m; }

  /* soft round glow, used for every fake bloom */
  const glowTex = (() => {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return tex(c);
  })();
  function glow(hex, size, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: C(hex), blending: THREE.AdditiveBlending, transparent: true,
      opacity, depthWrite: false, fog: false, toneMapped: false
    }));
    s.scale.set(size, size, 1);
    return s;
  }

  /* small environment maps so wet floors, chrome and gold have something to reflect */
  function envFrom(draw) {
    const c = makeCanvas(512, 256); draw(c.getContext('2d'));
    const t = tex(c); t.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const out = pm.fromEquirectangular(t).texture;
    t.dispose(); pm.dispose();
    return out;
  }
  const envCity = envFrom(g => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#02040a'); gr.addColorStop(0.42, '#0d2a48'); gr.addColorStop(0.5, '#f08a4b');
    gr.addColorStop(0.53, '#0a1420'); gr.addColorStop(1, '#020305');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    const r = rng(3);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = ['#ffd9a0', '#9fd6ff', '#ff6a4a', '#fff'][i % 4];
      g.globalAlpha = 0.5 + r() * 0.5;
      g.fillRect(r() * 512, 112 + r() * 18, 2 + r() * 3, 2 + r() * 5);
    }
  });
  const envOffice = envFrom(g => {
    g.fillStyle = '#030101'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#ff1a14'; g.fillRect(40, 138, 150, 6); g.fillRect(322, 138, 150, 6); g.fillRect(0, 198, 512, 4);
    const b = g.createLinearGradient(0, 70, 0, 150); b.addColorStop(0, '#081a40'); b.addColorStop(1, '#10285c');
    g.fillStyle = b; g.fillRect(196, 70, 120, 78);
    g.fillStyle = '#ffb070'; g.fillRect(430, 96, 14, 10);
  });

  /* =====================================================================
     SET A: the terrace, the bay, the skyline
     ===================================================================== */
  const setA = new THREE.Group(); scene.add(setA);
  const WATER_Y = -14;
  const vice = window.NikoVice({ renderer, scene, C, rng, makeCanvas, tex, glow, glowTex, WATER_Y, coarse });
  setA.add(vice.group);

  // the word. Built once the display font is ready.
  const typeMat = new THREE.MeshBasicMaterial({ transparent: true, fog: false, toneMapped: false, depthWrite: false, opacity: 0, color: new THREE.Color(0.78, 0.76, 0.75) });
  const typeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), typeMat);
  typeMesh.visible = false; setA.add(typeMesh);
  const TYPE_Z = -760;
  let typeAspect = { wide: 2.4, tall: 0.56 }, typeTex = { wide: null, tall: null };
  function drawType(lines) {
    const fs = 820, font = '900 ' + fs + 'px "Sofia Sans Extra Condensed", "Arial Narrow", Impact, sans-serif';
    const probe = makeCanvas(8, 8).getContext('2d'); probe.font = font;
    const ms = lines.map(l => probe.measureText(l));
    const cap = Math.ceil(Math.max(...ms.map(m => m.actualBoundingBoxAscent)));
    const widths = ms.map(m => m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    const pad = 24, gap = Math.round(cap * 0.1);
    const W = Math.ceil(Math.max(...widths)) + pad * 2, H = lines.length * cap + (lines.length - 1) * gap + pad * 2;
    const c = makeCanvas(W, H), g = c.getContext('2d');
    g.font = font; g.fillStyle = '#f3f6fa'; g.textBaseline = 'alphabetic';
    lines.forEach((l, i) => g.fillText(l, (W - widths[i]) / 2 + ms[i].actualBoundingBoxLeft, pad + cap + i * (cap + gap)));
    g.globalCompositeOperation = 'destination-in';           // letters sink into the horizon haze
    const fade = g.createLinearGradient(0, 0, 0, H);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.72, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = fade; g.fillRect(0, 0, W, H);
    const t = tex(c);
    return { t, aspect: W / H };
  }
  function buildType() {
    const a = drawType(['NIKO']), b = drawType(['NI', 'KO']);
    typeTex = { wide: a.t, tall: b.t }; typeAspect = { wide: a.aspect, tall: b.aspect };
    typeMesh.visible = true; layout();
  }
  const fontSpec = '900 100px "Sofia Sans Extra Condensed"';
  if (document.fonts && document.fonts.load) {
    Promise.race([document.fonts.load(fontSpec, 'NIKO'), new Promise(r => setTimeout(r, 2500))]).then(buildType, buildType);
  } else { buildType(); }

  // terrace
  const wetMat = new THREE.MeshStandardMaterial({ color: C('#0b0d11'), metalness: 0.6, roughness: 0.28, envMap: envCity, envMapIntensity: 1.3 });
  const steelMat = new THREE.MeshStandardMaterial({ color: C('#20242a'), metalness: 1, roughness: 0.3, envMap: envCity, envMapIntensity: 1.4 });
  setA.add(at(new THREE.Mesh(new THREE.BoxGeometry(18, 0.4, 11), wetMat), 0, -0.2, 3.6));
  setA.add(at(new THREE.Mesh(new THREE.BoxGeometry(18, 0.05, 0.08), steelMat), 0, 1.08, -1.7));
  for (let i = -4; i <= 4; i++) setA.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.08, 0.05), steelMat), i * 2 + 1, 0.54, -1.7));
  setA.add(at(new THREE.Mesh(new THREE.PlaneGeometry(18, 1.0),
    new THREE.MeshBasicMaterial({ color: C('#8fc7ff'), transparent: true, opacity: 0.045, depthWrite: false })), 0, 0.55, -1.7));
  const lampA = new THREE.PointLight(C('#ff7a3d'), 1.5, 24, 2); lampA.position.set(-5, 2.6, -1); setA.add(lampA);
  const lampB = new THREE.PointLight(C('#4f9dff'), 1.1, 24, 2); lampB.position.set(6, 2.2, 0.5); setA.add(lampB);

  // the man on the terrace, seen from behind. Drawn, not modelled.
  const figure = (() => {
    const W = 600, H = 1200, c = makeCanvas(W, H), g = c.getContext('2d');
    const P = d => new Path2D(d);
    const flip = d => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => (W - x) + ' ' + y);
    // trousers and shoes
    g.fillStyle = '#080a0f';
    g.fill(P('M202 684 C192 800 190 900 196 1000 C200 1060 196 1110 190 1146 L266 1146 C272 1050 284 900 298 744 L302 744 C316 900 328 1050 334 1146 L410 1146 C404 1110 400 1060 404 1000 C410 900 408 800 398 684 Z'));
    g.fillStyle = '#050608';
    g.fill(P('M180 1140 C180 1128 264 1128 270 1140 L272 1172 L176 1172 Z'));
    g.fill(P('M330 1140 C336 1128 420 1128 420 1140 L424 1172 L328 1172 Z'));
    // jacket body: square shoulders, tapering to a blouson waistband
    const jg = g.createLinearGradient(0, 200, 0, 710); jg.addColorStop(0, '#17120d'); jg.addColorStop(1, '#0c0a08');
    g.fillStyle = jg;
    g.fill(P('M252 204 C226 210 190 224 152 242 C150 262 160 300 176 332 C186 420 192 520 190 600 L188 652 L198 676 L198 706 L402 706 L402 676 L412 652 L410 600 C408 520 414 420 424 332 C440 300 450 262 448 242 C410 224 374 210 348 204 C326 196 274 196 252 204 Z'));
    // arms: elbows out, hands in the pockets, a sliver of city showing between arm and body
    const arm = 'M152 242 C128 250 114 292 112 344 C108 430 100 484 98 528 C100 590 132 640 176 672 L204 650 C176 620 160 580 158 530 C158 470 166 400 180 334 C176 300 166 262 152 242 Z';
    g.fill(P(arm)); g.fill(P(flip(arm)));
    g.fillStyle = '#0a0806'; g.fill(P('M198 676 L402 676 L402 706 L198 706 Z'));
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2.5; g.lineCap = 'round';
    g.stroke(P('M300 214 L300 676')); g.stroke(P('M168 300 C240 280 360 280 432 300'));
    g.strokeStyle = 'rgba(64,50,36,0.3)'; g.lineWidth = 3;
    g.stroke(P('M236 430 C254 480 256 550 246 612')); g.stroke(P('M368 446 C352 506 354 566 362 624'));
    // neck, collar, ears, head
    g.fillStyle = '#17110e'; g.fill(P('M269 148 L331 148 L336 212 L264 212 Z'));
    g.fillStyle = '#1e1710'; g.fill(P('M250 196 C280 184 320 184 350 196 L356 226 C322 214 278 214 244 226 Z'));
    g.save(); g.translate(300, 170); g.rotate(-0.035); g.translate(-300, -170);
    g.fillStyle = '#17110e'; g.beginPath(); g.ellipse(245, 118, 8, 17, 0, 0, 7); g.ellipse(355, 118, 8, 17, 0, 0, 7); g.fill();
    g.fillStyle = '#0b0a0a'; g.beginPath(); g.ellipse(300, 104, 54, 68, 0, 0, 7); g.fill();
    g.fillStyle = '#17110e'; g.fill(P('M264 158 C282 170 318 170 336 158 L334 176 L266 176 Z'));
    g.restore();

    // rim light: the outside of the figure throws its "shadow" inward, so only the edges catch it
    const mask = makeCanvas(W, H), mg = mask.getContext('2d');
    mg.fillRect(0, 0, W, H); mg.globalCompositeOperation = 'destination-out'; mg.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    const rim = (color, blur, ox, oy) => { g.shadowColor = color; g.shadowBlur = blur; g.shadowOffsetX = ox; g.shadowOffsetY = oy; g.drawImage(mask, 0, 0); };
    rim('rgba(255,140,84,0.9)', 9, 4, 2);
    rim('rgba(110,175,255,0.6)', 9, -4, 2);
    rim('rgba(255,222,184,0.35)', 5, 0, 3);
    const t = tex(c); t.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 1.96),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    m.position.set(0, 0.97, 0); m.renderOrder = 5;
    return m;
  })();
  setA.add(figure); vice.hideInReflection(figure); figure.visible = !window.NikoBody;   // shown only if the 3D models fail

  // rain close to the lens
  const rain = (() => {
    const N = 900, p = new Float32Array(N * 6), d = [], r = rng(9);
    for (let i = 0; i < N; i++) d.push({ x: lerp(-11, 11, r()), y: r() * 11, z: lerp(-9, 6, r()), v: 15 + r() * 8, l: 0.22 + r() * 0.3 });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: C('#a8c8ea'), transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
    m.frustumCulled = false; m.renderOrder = 6;
    m.userData.tick = dt => {
      for (let i = 0; i < N; i++) {
        const o = d[i]; o.y -= o.v * dt; if (o.y < -0.2) o.y += 11;
        p[i * 6] = o.x; p[i * 6 + 1] = o.y; p[i * 6 + 2] = o.z;
        p[i * 6 + 3] = o.x - o.l * 0.12; p[i * 6 + 4] = o.y - o.l; p[i * 6 + 5] = o.z;
      }
      g.attributes.position.needsUpdate = true;
    };
    return m;
  })();
  setA.add(rain); rain.visible = false; vice.hideInReflection(rain);

  /* =====================================================================
     SET B: the office. Lives far below set A; the cut is hidden by a fade.
     ===================================================================== */
  const OFF = -2000;
  const office = new THREE.Group(); office.position.y = OFF; office.visible = false; scene.add(office);
  const mirror = new THREE.Group(); mirror.scale.y = -1; office.add(mirror);   // everything in here shows in the floor

  const redHex = '#ff1c16';
  const tubeMat = new THREE.MeshBasicMaterial({ color: C('#ff5a4c'), toneMapped: false });
  const haloTex = (() => {
    const c = makeCanvas(256, 64), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
    g.globalCompositeOperation = 'destination-in';
    const e = g.createLinearGradient(0, 0, 256, 0);
    e.addColorStop(0, 'rgba(0,0,0,0)'); e.addColorStop(0.08, 'rgba(0,0,0,1)'); e.addColorStop(0.92, 'rgba(0,0,0,1)'); e.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = e; g.fillRect(0, 0, 256, 64);
    return tex(c);
  })();
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, color: C(redHex), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  function tube(len, axis, x, y, z) {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 8), tubeMat); t.rotation.z = Math.PI / 2;
    const h = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.4, 0.5), haloMat);
    g.add(t, h); if (axis === 'z') g.rotation.y = Math.PI / 2;
    g.position.set(x, y, z);
    return g;
  }
  const tubes = new THREE.Group();
  for (const sx of [-1, 1]) tubes.add(tube(4.4, 'z', sx * 4.36, 0.92, -1.9), tube(4.4, 'z', sx * 4.36, 1.16, -1.9));
  tubes.add(tube(8.6, 'x', 0, 0.1, -3.86));
  office.add(tubes); mirror.add(tubes.clone());

  // window wall: the city out of focus
  const bokeh = (() => {
    const c = makeCanvas(3072, 1152), g = c.getContext('2d'), r = rng(31); g.scale(3, 3);   // drawn at 3x: the bokeh fills the frame at 4K
    const bg = g.createLinearGradient(0, 0, 0, 384); bg.addColorStop(0, '#010207'); bg.addColorStop(0.6, '#040d20'); bg.addColorStop(1, '#02060f');
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 384);
    const cols = ['#8fb6ff', '#5f90f0', '#bcd4ff', '#ffd9a0', '#ffb46b', '#ff5a4a'];
    for (let i = 0; i < 300; i++) {
      const x = r() * 1024, y = 170 + Math.pow(r(), 1.5) * 150 * (r() < 0.5 ? -0.5 : 1), rad = 1.5 + Math.pow(r(), 2) * 8, col = cols[(Math.pow(r(), 1.5) * cols.length) | 0];
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, col); gr.addColorStop(0.7, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.12 + r() * 0.4; g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
    return tex(c);
  })();
  const windowWall = new THREE.Group();
  windowWall.add(at(new THREE.Mesh(new THREE.PlaneGeometry(10.4, 3.9), new THREE.MeshBasicMaterial({ map: bokeh, toneMapped: false })), 0, 1.75, -4.3));
  const frameMat = new THREE.MeshStandardMaterial({ color: C('#070405'), roughness: 0.5, metalness: 0.4 });
  for (let i = -3; i <= 3; i++) windowWall.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.5, 0.12), frameMat), i * 1.45, 1.75, -4.0));
  windowWall.add(at(new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.1, 0.14), frameMat), 0, 0.24, -4.0));
  office.add(windowWall); mirror.add(windowWall.clone());
  const backGlow = glow('#ff1c12', 6.5, 0.12); backGlow.position.set(0, 0.5, -3.7); office.add(backGlow);

  // fluted side walls, ceiling, floor
  const wallMat = new THREE.MeshStandardMaterial({ color: C('#120809'), roughness: 0.4, metalness: 0.3, envMap: envOffice, envMapIntensity: 0.35 });
  (() => {
    const fl = new THREE.CylinderGeometry(0.11, 0.11, 3.5, 14), n = 36, im = new THREE.InstancedMesh(fl, wallMat, n * 2), m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) for (let s = 0; s < 2; s++) { m4.makeTranslation((s ? 1 : -1) * 4.52, 1.75, -4.1 + i * 0.22); im.setMatrixAt(i * 2 + s, m4); }
    office.add(im);
  })();
  office.add(at(new THREE.Mesh(new THREE.BoxGeometry(11, 0.1, 12), new THREE.MeshStandardMaterial({ color: C('#050203'), roughness: 0.8 })), 0, 3.55, 0));
  const floorMat = new THREE.MeshBasicMaterial({ color: C('#040203'), transparent: true, opacity: 0.77 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 16), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.z = 1.5; floor.renderOrder = 2;
  office.add(floor);

  // lights: everything comes from behind or beside him. The front stays dark.
  const red1 = new THREE.PointLight(C(redHex), 3.0, 9, 2); red1.position.set(-1.7, 1.35, -3.5);   // behind him, not beside: red catches only the back edge of head and shoulders
  const red2 = new THREE.PointLight(C(redHex), 3.0, 9, 2); red2.position.set(1.7, 1.35, -3.5);
  const red3 = new THREE.PointLight(C('#ff2a16'), 1.4, 7, 2); red3.position.set(0, 0.35, -3.3);
  const cool = new THREE.PointLight(C('#5f86ff'), 1.5, 9, 2); cool.position.set(0.4, 2.9, -2.1);
  const fill = new THREE.PointLight(C('#ff2418'), 0.05, 9, 2); fill.position.set(-0.6, 1.3, 3.6);
  const key = new THREE.SpotLight(C('#ffb478'), 0.0, 8, 0.42, 0.9, 1.6); key.position.set(1.5, 1.2, 1.7);
  office.add(red1, red2, red3, cool, fill, key, key.target); key.target.position.set(0, 0.95, 0);
  // lights for the seated man only (narrow cones, short range): a soft warm-white key from front camera-left above his eyes
  // (face ~1.32 m, z ~-0.1 once the chair has turned), and a cool kicker from the window side behind him
  const faceKey = new THREE.SpotLight(C('#ffd8b8'), 0, 3.2, 0.33, 0.85, 1); faceKey.position.set(-0.5, 2.25, 1.6);   // high and frontal: under his lowered brow
  faceKey.target.position.set(0.02, 1.28, 0.05); office.add(faceKey, faceKey.target);
  const kicker = new THREE.SpotLight(C('#7d9cff'), 0, 3.0, 0.3, 0.8, 1); kicker.position.set(0.9, 1.75, -1.9);   // well behind him: back of head and shoulders only
  kicker.target.position.set(0, 1.2, -0.3); office.add(kicker, kicker.target);
  const eyeLight = new THREE.PointLight(C('#ffe6d0'), 0, 3.2, 1.5); office.add(eyeLight);   // weak light near the lens: lifts the eye sockets, gives catchlights
  const amb = new THREE.AmbientLight(C('#2a0b0b'), 0); scene.add(amb);

  // the man is a silhouette: a dark body, red on the outer edges, cool light on the tops.
  // Edges that face inward (an arm against the chest) stay dark, so the joins do not show.
  const rimCenter = { value: new THREE.Vector3() };
  function rimMat(baseHex, sideGain, topGain) {
    return new THREE.ShaderMaterial({
      uniforms: { base: { value: C(baseHex) }, side: { value: C('#ff2a1c') }, topc: { value: C('#9ab6ff') }, center: rimCenter, sg: { value: sideGain }, tg: { value: topGain } },
      vertexShader: [
        'varying vec3 vN; varying vec3 vP;',
        'void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }'
      ].join(String.fromCharCode(10)),
      fragmentShader: [
        'uniform vec3 base; uniform vec3 side; uniform vec3 topc; uniform vec3 center; uniform float sg; uniform float tg;',
        'varying vec3 vN; varying vec3 vP;',
        'void main(){',
        '  vec3 n = normalize(vN); vec3 v = normalize(-vP);',
        '  float f = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.5);',
        '  float sgn = sign(vP.x - center.x);',
        '  float sideMask = smoothstep(0.35, 0.95, n.x * sgn);',
        '  float topMask = smoothstep(0.45, 0.95, n.y);',
        '  vec3 col = base + side * f * sideMask * 1.5 * sg + topc * f * topMask * 0.9 * tg;',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join(String.fromCharCode(10))
    });
  }

  // the chair and the man in it
  const chair = new THREE.Group();
  (() => {
    const leather = new THREE.MeshPhysicalMaterial({ color: C('#2a090c'), roughness: 0.34, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.28, envMap: envOffice, envMapIntensity: 1.0, side: THREE.DoubleSide });
    const chrome = new THREE.MeshStandardMaterial({ color: C('#b8b8bc'), metalness: 1, roughness: 0.18, envMap: envOffice, envMapIntensity: 1.6 });
    const rubber = new THREE.MeshStandardMaterial({ color: C('#060606'), roughness: 0.6 });

    // high back: a shallow arc of leather, rounded at the shoulders, leaning back
    const back = new THREE.Group(); back.position.set(0, 0.54, -0.27); back.rotation.x = -0.13; chair.add(back);
    const RB = 0.68, AB = 29 * DEG, SEG = 40, TH = 0.1, HB = 0.9;
    const topY = a => HB - 0.14 * smooth(15 * DEG, 29 * DEG, Math.abs(a));
    const bx = a => RB * Math.sin(a), bz = a => RB * (1 - Math.cos(a));
    const pos = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const a = -AB + (2 * AB * i) / SEG, x = bx(a), z = bz(a), ty = topY(a);
      pos.push(x, 0, z, x, ty, z, x, ty, z + TH, x, 0, z + TH);
      if (i < SEG) { const b = i * 4, n = b + 4; for (let k = 0; k < 3; k++) idx.push(b + k, n + k, b + k + 1, b + k + 1, n + k, n + k + 1); }
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals();
    back.add(new THREE.Mesh(sg, leather));
    const arc = (y, dz, n = 30) => { const p = []; for (let i = 0; i <= n; i++) { const a = -AB + (2 * AB * i) / n; p.push(new THREE.Vector3(bx(a), y == null ? topY(a) : y, bz(a) + dz)); } return new THREE.CatmullRomCurve3(p); };
    back.add(new THREE.Mesh(new THREE.TubeGeometry(arc(null, TH / 2), 60, 0.06, 10), leather));                  // rolled top
    for (const s of [-1, 1]) back.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.058, topY(AB) - 0.02, 6, 12), leather), bx(s * AB), topY(AB) / 2, bz(AB) + TH / 2));
    for (const y of [0.16, 0.34, 0.52, 0.68]) {                                                                  // stitched channels, both faces
      back.add(new THREE.Mesh(new THREE.TubeGeometry(arc(y, -0.004), 40, 0.009, 6), leather));
      back.add(new THREE.Mesh(new THREE.TubeGeometry(arc(y, TH + 0.004), 40, 0.009, 6), leather));
    }
    // seat
    const seat = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 16), leather); seat.scale.set(0.9, 0.2, 0.84); seat.position.set(0, 0.52, 0.02); chair.add(seat);
    chair.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.56), leather), 0, 0.45, 0.02));
    // arms: padded rests on chrome posts
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.36), leather); pad.position.set(s * 0.35, 0.755, 0.0); chair.add(pad);
      for (const z of [-0.12, 0.12]) chair.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.3, 10), chrome), s * 0.35, 0.6, z));
    }
    // swivel base
    chair.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 14), chrome), 0, 0.25, 0));
    chair.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.05, 20), chrome), 0, 0.085, 0));
    for (let k = 0; k < 5; k++) {
      const a = k * 72 * DEG + 0.3, spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.026, 0.044), chrome);
      spoke.position.set(Math.cos(a) * 0.19, 0.075, Math.sin(a) * 0.19); spoke.rotation.y = -a; chair.add(spoke);
      chair.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), rubber), Math.cos(a) * 0.34, 0.034, Math.sin(a) * 0.34));
    }

    // --- the man: simple forms, kept in the dark on purpose. He reads as a silhouette with lit edges. ---
    const skin = rimMat('#0c0806', 1, 0.8);
    const hair = rimMat('#1d1f23', 0.7, 1.5);
    const jacket = rimMat('#070605', 1, 0.9);
    const knit = rimMat('#020202', 0.2, 0.2);
    const denim = rimMat('#04060a', 0.45, 0.25);
    const shoe = rimMat('#020202', 0.6, 0.3);
    const gold = new THREE.MeshStandardMaterial({ color: C('#e0aa45'), metalness: 1, roughness: 0.22, envMap: envOffice, envMapIntensity: 3, flatShading: true });
    const man = new THREE.Group(); man.name = 'man'; chair.add(man);
    const UP = new THREE.Vector3(0, 1, 0);
    const limb = (parent, a, b, rad, mat) => {
      const A3 = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A3), len = d.length();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 6, 14), mat);
      m.position.copy(A3).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); parent.add(m); return m;
    };
    const ball = (parent, rad, mat, p, s) => { const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 24, 18), mat); m.position.set(...p); if (s) m.scale.set(...s); parent.add(m); return m; };

    const up = new THREE.Group(); up.position.set(0, 0.6, -0.05); up.rotation.x = -0.13; man.add(up);    // leaning back
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.26, 8, 20), jacket); torso.scale.set(1.3, 1, 0.82); torso.position.set(0, 0.3, 0); up.add(torso);
    limb(up, [-0.215, 0.56, 0], [0.215, 0.56, 0], 0.086, jacket);                                        // shoulders
    const yoke = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), jacket); yoke.scale.set(1.55, 0.72, 0.8); yoke.position.set(0, 0.47, 0); up.add(yoke);
    const front = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 14), knit); front.scale.set(0.6, 1, 0.5); front.position.set(0, 0.34, 0.102); up.add(front);
    up.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.076, 0.09, 20), knit), 0, 0.66, 0.006));  // roll neck
    up.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.08, 16), skin), 0, 0.705, 0.01));
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.0085, 5, 44), gold); chain.scale.set(1, 1.3, 1); chain.rotation.x = -0.5; chain.position.set(0, 0.59, 0.05); up.add(chain);
    const head = new THREE.Group(); head.position.set(0, 0.835, 0.024); head.rotation.set(0.14, -0.14, 0.05); up.add(head);
    ball(head, 0.105, skin, [0, 0, 0], [0.9, 1.1, 1.04]);
    ball(head, 0.086, skin, [0, -0.06, 0.03], [0.86, 0.98, 0.9]);                                        // jaw
    ball(head, 0.025, skin, [-0.094, -0.012, 0.0], [0.45, 1, 0.7]); ball(head, 0.025, skin, [0.094, -0.012, 0.0], [0.45, 1, 0.7]);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.109, 28, 18, 0, Math.PI * 2, 0, 1.9), hair); cap.scale.set(0.92, 1.1, 1.06); cap.rotation.x = -0.46; head.add(cap);

    man.updateMatrixWorld(true);
    const sh = s => { const v = new THREE.Vector3(s * 0.255, 0.55, 0); up.localToWorld(v); return [v.x, v.y, v.z]; };
    for (const s of [-1, 1]) {
      const elbow = [s * 0.365, 0.835, -0.08], hand = [s * 0.345, 0.825, 0.17];
      limb(man, sh(s), elbow, 0.074, jacket); limb(man, elbow, hand, 0.058, jacket);
      ball(man, 0.04, skin, [s * 0.345, 0.815, 0.2], [0.95, 0.5, 1.35]);
      limb(man, [s * 0.11, 0.63, 0.04], [s * 0.19, 0.6, 0.43], 0.074, denim);                             // thigh
      limb(man, [s * 0.19, 0.58, 0.45], [s * 0.215, 0.13, 0.5], 0.056, denim);                             // shin
      man.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.27), shoe), s * 0.22, 0.04, 0.565));
    }
  })();
  office.add(chair);
  let chairMirror = chair.clone(); mirror.add(chairMirror);
  const ember = glow('#ff6a24', 0.07, 1); ember.position.set(0.36, 0.86, 0.3); chair.add(ember);
  // real models (Poly Haven, CC0). The armchair takes over from the hand-built chair once it has loaded; busts line the walls.
  if (THREE.GLTFLoader) {
    const gl = new THREE.GLTFLoader();
    const prep = root => { root.traverse(o => { if (o.isMesh) { o.material.envMap = envOffice; o.material.envMapIntensity = 0.7; } }); return root; };
    gl.load('models/armchair/ArmChair_01_1k.gltf', g => {
      const model = prep(g.scene); model.scale.set(1.1, 1.1, 0.85);   // cushion top ~0.54 m (thighs 0.52 m); seat depth cut to fit his thighs so the shins come down in front
      chair.children.forEach(c => { if (c.name !== 'man' && c !== ember) c.visible = false; });
      chair.add(model);
      chair.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.7, 0.05, 48), new THREE.MeshStandardMaterial({ color: C('#080506'), roughness: 0.9, metalness: 0 })), 0, 0.025, -0.03));
      const seated = chair.getObjectByName('man'); if (seated) seated.position.set(0, -0.03, 0);
      mirror.remove(chairMirror); chairMirror = chair.clone(); mirror.add(chairMirror);
    }, undefined, e => console.warn('armchair failed', e));
    gl.load('models/bust/marble_bust_01_1k.gltf', g => {
      const bust = prep(g.scene);
      bust.traverse(o => { if (o.isMesh) { o.material.color.multiplyScalar(0.45); o.material.envMapIntensity = 0.35; } });   // background props: about half as bright
      const plinth = new THREE.MeshStandardMaterial({ color: C('#0c0809'), roughness: 0.4, metalness: 0.3, envMap: envOffice, envMapIntensity: 0.4 });
      const row = new THREE.Group();
      [[-3.75, -3.0, 1], [-3.75, -1.7, 1], [-3.75, -0.4, 1], [3.75, -3.0, -1], [3.75, -1.7, -1], [3.75, -0.4, -1]].forEach(v => {
        const b = bust.clone(true); b.scale.setScalar(1.55); b.position.set(v[0], 1.08, v[1]); b.rotation.y = v[2] * Math.PI / 2; row.add(b);
        row.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.08, 0.42), plinth), v[0], 0.54, v[1]));
      });
      office.add(row); mirror.add(row.clone());
    }, undefined, e => console.warn('bust failed', e));
  }

  // Niko himself, built from the turnaround views (js/niko.js): standing on the terrace, seated in the chair
  let nikoStand = null, nikoSeat = null; const standLights = [];
  const seatKey = C('#ffdcc4').multiplyScalar(1.5);
  const nq = new URLSearchParams(location.search);
  const handMan = chair.getObjectByName('man').children.slice();   // the hand-built stand-in: hidden while the models load
  if (window.NikoBody) handMan.forEach(c => { c.visible = false; });
  if (window.NikoBody) window.NikoBody({ C, maxTex: renderer.capabilities.maxTextureSize, anisotropy: renderer.capabilities.getMaxAnisotropy(), envMap: envOffice, standEnv: envCity, envIntensity: 0.2, proSeatYaw: (+nq.get('py') || 0) * Math.PI / 2, standYaw: (+nq.get('ny') || 0) * Math.PI / 2, seatYaw: (+nq.get('sy') || 0) * Math.PI / 2 }).then(nk => {
    nikoStand = nk.stand; nikoStand.rotation.y = Math.PI; nikoStand.renderOrder = 5;
    setA.add(nikoStand); vice.hideInReflection(nikoStand); figure.visible = false;
    let u = nikoStand.userData.pro ? null : nikoStand.material.uniforms;
    if (u) { u.amb.value.setRGB(0.2, 0.15, 0.25); u.rimSide.value.copy(C('#ff8a54')).multiplyScalar(0.9); u.rimTop.value.copy(C('#ffd0a0')).multiplyScalar(0.3); }
    else {   // textured Meshy model: short-range spots on him only (distance-limited so the city and type are untouched)
      const sl = (hex, i, p, ang) => { const s = new THREE.SpotLight(C(hex), i, 5, ang, 0.6, 1); s.position.set(...p); s.target.position.set(0, 1.1, 0); s.userData.i = i; setA.add(s, s.target); return s; };
      standLights.push(sl('#ff9a5c', 2.8, [-1.6, 2.4, -2.2], 0.5), sl('#ffb070', 2.1, [1.7, 1.9, -2.0], 0.5),   // warm skyline rims, both shoulders
        sl('#8fa6d8', 0.55, [0.6, 2.2, 2.6], 0.42));                                                                  // cool dusk fill from the camera side
    }
    if (!nk.seat) { handMan.forEach(c => { c.visible = true; }); return; }
    nikoSeat = nk.seat;
    const seated = chair.getObjectByName('man');
    seated.children.forEach(c => { c.visible = false; }); seated.add(nikoSeat);
    if (nikoSeat.userData.pro) {   // textured Meshy model: its own PBR material under the office lights
      const q = (nq.get('sp') || '').split(',').map(Number);
      nikoSeat.position.set(q[0] || 0, q[1] || 0.08, q[2] || 0.12);   // soles on the 0.05 m rug disc, thighs at ~0.52 m, 2 cm into the 0.54 m cushion; forward so the knees reach the front edge
      mirror.remove(chairMirror); chairMirror = chair.clone(); mirror.add(chairMirror);
      return;
    }
    nikoSeat.position.set(0, 0.075, 0.16);   // seat line ~0.54 m, sunk into the 0.60 m cushion; knees just past its front edge
    u = nikoSeat.material.uniforms;
    // cutscene lighting: warm-neutral key from camera-left at ~45 deg (fades out below the chest so the hands sink into shadow),
    // red wrap light from both sides as the accent, faint cool top light, only a trace of edge glow
    u.amb.value.setRGB(0.06, 0.03, 0.032); u.keyDir.value.set(-0.62, 0.3, 0.7).normalize();
    u.sideCol.value.copy(C('#ff2a1c')).multiplyScalar(0.42); u.topCol.value.copy(C('#9ab6ff')).multiplyScalar(0.16);
    u.keyLo.value = 0.68; u.keyHi.value = 1.02; u.spec.value = 1;
    u.rimSide.value.copy(C('#ff2a1c')).multiplyScalar(0.12); u.rimTop.value.setRGB(0, 0, 0);
    mirror.remove(chairMirror); chairMirror = chair.clone(); mirror.add(chairMirror);
  }).catch(e => { console.warn('niko body failed', e); figure.visible = true; handMan.forEach(c => { c.visible = true; }); })
    .then(() => window.dispatchEvent(new Event('niko:ready')));   // the loading screen waits for this
  else window.dispatchEvent(new Event('niko:ready'));
  const smoke = (() => {
    const N = 22, parts = [], r = rng(40), src = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C('#e2a79c'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      office.add(s); parts.push({ s, age: (i / N) * 5.5, life: 5.5, dx: 0, dz: 0, seed: r() * 10 });
    }
    return dt => {
      for (const p of parts) {
        p.age += dt;
        if (p.age > p.life) {
          p.age -= p.life; ember.getWorldPosition(src); office.worldToLocal(src);
          p.s.position.copy(src); p.dx = (r() - 0.5) * 0.03; p.dz = (r() - 0.5) * 0.03;
        }
        const u = p.age / p.life;
        p.s.position.y += dt * (0.2 + u * 0.1);
        p.s.position.x += dt * (p.dx + Math.sin(p.age * 1.1 + p.seed) * 0.022);
        p.s.position.z += dt * p.dz;
        const sc = 0.06 + u * 0.5; p.s.scale.set(sc, sc * 1.5, 1);
        p.s.material.opacity = 0.16 * smooth(0, 0.12, u) * (1 - smooth(0.4, 1, u));
      }
    };
  })();
  // contact shadow
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.006; blob.renderOrder = 3; office.add(blob);

  // side table: a lamp and a glass
  const table = new THREE.Group();
  (() => {
    const dark = new THREE.MeshStandardMaterial({ color: C('#0c0a0a'), roughness: 0.3, metalness: 0.8, envMap: envOffice });
    table.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.025, 36), dark), 0, 0.56, 0));
    table.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 10), dark), 0, 0.28, 0));
    table.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 28), dark), 0, 0.01, 0));
    table.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 0.085, 20),
      new THREE.MeshPhysicalMaterial({ color: C('#c9731f'), roughness: 0.05, transparent: true, opacity: 0.6, envMap: envOffice, envMapIntensity: 2 })), 0.1, 0.615, 0.08));
    table.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), dark), -0.1, 0.7, -0.06));
    table.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.11, 24, 1, true), dark), -0.1, 0.87, -0.06));
    table.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), new THREE.MeshBasicMaterial({ color: C('#ffc890'), toneMapped: false })), -0.1, 0.83, -0.06));
    const g = glow('#ff9a50', 0.5, 0.4); g.position.set(-0.1, 0.8, -0.06); table.add(g);
    table.position.set(1.12, 0, -0.35);
  })();
  office.add(table); mirror.add(table.clone());

  // air: a little red haze behind him so the silhouette separates, and dust
  const hazeTex = (() => {
    const c = makeCanvas(256, 256), g = c.getContext('2d'), r = rng(77);
    for (let i = 0; i < 60; i++) {
      const x = r() * 256, y = r() * 256, rad = 30 + r() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
    const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const hazes = [[-2.7, 0.06], [-1.2, 0.025], [1.6, 0.01]].map(([z, op]) => {
    const t = hazeTex.clone(); t.needsUpdate = true; t.repeat.set(1.4, 0.7);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.6), new THREE.MeshBasicMaterial({ map: t, color: C('#ff1c16'), blending: THREE.AdditiveBlending, transparent: true, opacity: op, depthWrite: false, toneMapped: false }));
    m.position.set(0, 1.5, z); m.renderOrder = 4; office.add(m); return m;
  });
  const dust = (() => {
    const N = 260, p = new Float32Array(N * 3), r = rng(12);
    for (let i = 0; i < N; i++) { p[i * 3] = lerp(-4, 4, r()); p[i * 3 + 1] = r() * 3; p[i * 3 + 2] = lerp(-3.5, 4, r()); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, size: 0.03, color: C('#ffb4a4'), transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    office.add(m); return m;
  })();

  /* =====================================================================
     THE FILM: scroll to time, time to camera
     ===================================================================== */
  const fogB = { color: C('#070102'), density: 0.045 };
  scene.fog = new THREE.FogExp2(0x000000, 0.0007);
  scene.background = new THREE.Color(0x000000);

  // camera keys. Set B positions are local to the office.
  const KA = [
    { t: 0.0,  p: [0, 1.25, 4.3],      l: [0, 124, -760] },
    { t: 0.55, p: [0, 1.42, 3.5],      l: [0, 120, -760] },
    { t: 1.0,  p: [8, 10, -6],         l: [70, 44, -600] },
    { t: 1.32, p: [44, 13, -176],      l: [120, 20, -430] },
    { t: 1.6,  p: [112, 44, -350],     l: [190, 124, -600] },
    { t: 2.0,  p: [190, 160, -508],    l: [190, 160, -600] }
  ];
  const KB = [
    { t: 2.0,  p: [0, 1.18, 5.5],      l: [0, 1.0, 0] },
    { t: 2.16, p: [0, 1.16, 4.8],      l: [0, 1.04, 0] },
    // seated Meshy model: eyes ~1.32 m, face at z ~-0.1
    // seat_v3: head ~(0.02, 1.37, 0.01), tilted down; a low camera looking up meets his lowered gaze
    { t: 2.48, p: [0.25, 1.0, 2.6],    l: [0.02, 1.0, 0.05] },  // medium: full figure in the chair
    { t: 2.6,  p: [0.15, 1.08, 1.95],  l: [0.02, 1.25, 0.05] }, // portrait from below eye line: head ~24% of frame height
    { t: 2.72, p: [-0.25, 1.08, 1.95], l: [0.05, 1.24, 0.05] }, // slow orbit to camera-left, same distance
    { t: 2.86, p: [-0.6, 1.05, 2.0],   l: [0.46, 1.12, 0.05] }, // final: him in the left third, busts to the right
    { t: 3.0,  p: [-0.68, 1.05, 2.1],  l: [0.5, 1.11, 0.05] }
  ];
  const vP = new THREE.Vector3(), vL = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3();
  function sample(keys, T) {
    let i = 0; while (i < keys.length - 2 && T > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1], u = clamp((T - a.t) / (b.t - a.t)), e = u * u * (3 - 2 * u);
    vP.lerpVectors(vA.fromArray(a.p), vB.fromArray(b.p), e);
    vL.lerpVectors(vA.fromArray(a.l), vB.fromArray(b.l), e);
  }

  // scroll metrics
  const acts = ['rooftop', 'crossing', 'office'].map(id => document.getElementById(id));
  let metrics = [], vw = 1, vh = 1, aspect = 1;
  function measure() { metrics = acts.map(el => ({ top: el.offsetTop, h: el.offsetHeight })); }
  function timeAt(y) {
    for (let i = metrics.length - 1; i >= 0; i--) if (y >= metrics[i].top) return i + clamp((y - metrics[i].top) / metrics[i].h);
    return 0;
  }
  function scrollFor(T) { const i = clamp(Math.floor(T), 0, metrics.length - 1); return metrics[i].top + (T - i) * metrics[i].h; }

  function layout() {
    vw = canvas.clientWidth || window.innerWidth; vh = canvas.clientHeight || window.innerHeight; aspect = vw / vh;   // the canvas box, not the window: no resample under a scrollbar
    renderer.setSize(vw, vh, false); post.setSize(vw, vh); vice.setSize(vw, vh);
    // hold the horizontal field of view on narrow screens, up to a point
    const base = 38 * DEG;
    camera.userData.fovA = aspect >= 1.5 ? 38 : Math.min(66, (2 * Math.atan(Math.tan(base / 2) * 1.5 / aspect)) / DEG);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    measure();
    // size the word to the frame
    if (typeMesh.visible) {
      const tall = aspect < 0.9, key = tall ? 'tall' : 'wide';
      const hf = 2 * Math.atan(Math.tan((camera.userData.fovA * DEG) / 2) * aspect);
      const frameW = 2 * 764 * Math.tan(hf / 2), W = frameW * (tall ? 0.5 : 0.7), H = W / typeAspect[key];
      if (typeMat.map !== typeTex[key]) { typeMat.map = typeTex[key]; typeMat.needsUpdate = true; }
      typeMesh.scale.set(W, H, 1);
      typeMesh.position.set(0, 1.25 + 764 * Math.tan((tall ? 8.5 : 2.1) * DEG) + H / 2, TYPE_Z);   // phone: the stacked word sits above the man's head, KO clear of him
    }
  }

  // DOM cues
  const cues = $$('[data-cue]').map(el => { const [a, b] = el.dataset.cue.split(',').map(Number); return { el, a, b, last: '' }; });
  const root = document.documentElement, cutEl = $('.cut');
  function applyCues(T) {
    const F = 0.035;
    for (const c of cues) {
      const inn = c.a < 0 ? 1 : smooth(c.a, c.a + F, T), out = smooth(c.b - F, c.b, T), o = Math.min(inn, 1 - out);
      const key = o.toFixed(3);
      if (key === c.last) continue; c.last = key;
      c.el.style.setProperty('--o', key);
      c.el.style.setProperty('--v', o > 0.004 ? 'visible' : 'hidden');
      c.el.style.setProperty('--y', ((1 - inn) * 26 - out * 18).toFixed(1));
    }
    cutEl.style.opacity = (T < 2 ? smooth(1.86, 1.985, T) : 1 - smooth(2.0, 2.11, T)).toFixed(3);
    root.style.setProperty('--bars', (smooth(1.985, 2.07, T) * (1 - smooth(2.86, 2.95, T))).toFixed(3));
  }

  // photo plates: each holds for a stretch of film time, pushes in slowly and drifts with the pointer
  const plates = $$('[data-plate]').map(el => { const [a, b] = el.dataset.plate.split(',').map(Number); return { el, a, b, on: false }; });
  function applyPlates(T) {
    const F = 0.012; let covered = false;
    for (const p of plates) {
      const o = Math.min(smooth(p.a, p.a + F, T), 1 - smooth(p.b - F, p.b, T));
      if (o <= 0.002) { if (p.on) { p.on = false; p.el.style.visibility = 'hidden'; p.el.style.opacity = '0'; } continue; }
      p.on = true; if (o > 0.995) covered = true;
      const k = clamp((T - p.a) / (Math.min(p.b, 3) - p.a)), sc = 1.045 + k * 0.07;
      p.el.style.visibility = 'visible'; p.el.style.opacity = o.toFixed(3);
      p.el.style.transform = 'translate3d(' + (-ptr.x * 12).toFixed(1) + 'px,' + (-ptr.y * 8).toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';
    }
    return covered;
  }

  // pointer parallax
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', e => { ptr.tx = (e.clientX / vw) * 2 - 1; ptr.ty = (e.clientY / vh) * 2 - 1; }, { passive: true });

  const right = new THREE.Vector3(), upv = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3();
  const state = { y: window.scrollY, T: 0, frozen: null };
  function update(T, time, dt) {
    const inB = T >= 2;
    setA.visible = !inB; office.visible = inB;
    if (inB) { scene.fog.color.copy(fogB.color); scene.fog.density = fogB.density; }
    amb.intensity = inB ? 0.07 : 0;

    sample(inB ? KB : KA, T);
    if (inB && aspect < 1) {   // portrait end frame: him centred, chest up, in the upper half (the token block sits below)
      const k = smooth(2.78, 2.9, T); vP.lerp(vA.set(0, 1.05, 2.25), k); vL.lerp(vB.set(0.02, 0.98, 0.05), k);
    }
    if (state.dbg && inB) { vP.set(state.dbg[0], state.dbg[1], state.dbg[2]); vL.set(state.dbg[3], state.dbg[4], state.dbg[5]); }
    if (state.dbg && !inB && state.dbg.length > 6) { vP.set(state.dbg[0], state.dbg[1], state.dbg[2]); vL.set(state.dbg[3], state.dbg[4], state.dbg[5]); }
    if (inB) { vL.x *= clamp(aspect / 1.6); vP.y += OFF; vL.y += OFF; }
    // parallax: slide the camera, keep the target
    fwd.subVectors(vL, vP).normalize(); right.crossVectors(fwd, upv).normalize();
    const amp = inB ? 0.2 : lerp(0.3, 6, smooth(0.9, 1.6, T));
    const sway = Math.sin(time * 0.23) * 0.25;
    vP.addScaledVector(right, (ptr.x + sway) * amp); vP.y += -ptr.y * amp * 0.45 + Math.sin(time * 0.31) * amp * 0.08;
    camera.position.copy(vP); camera.lookAt(vL);
    if (!inB) camera.rotateZ(Math.sin(smooth(1.0, 1.95, T) * Math.PI) * -0.07);   // bank into the turn toward the tower
    const fov = inB ? lerp(36, 32, smooth(2.16, 2.45, T)) * (aspect < 1 ? 1.5 : 1) : camera.userData.fovA;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    if (!inB) {
      typeMat.opacity = 0.97 * (1 - smooth(0.82, 1.2, T));
      figure.material.opacity = 1 - smooth(1.02, 1.12, T);
      if (nikoStand) {
        nikoStand.visible = T < 1.09; standLights.forEach(l => { l.intensity = nikoStand.visible ? l.userData.i : 0; });   // intensity, not visibility: no shader rebuild
        camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        if (!nikoStand.userData.pro) nikoStand.material.uniforms.center.value.set(0, 1, 0).applyMatrix4(camera.matrixWorldInverse);
      }
      vice.update(time, dt, smooth(0.9, 1.7, T), camera);
      scene.fog.color.copy(vice.fogColor); scene.fog.density = vice.fogDensity;
    } else {
      camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      rimCenter.value.set(0, OFF + 1, 0).applyMatrix4(camera.matrixWorldInverse);
      if (nikoSeat && !nikoSeat.userData.pro) { nikoSeat.material.uniforms.center.value.copy(rimCenter.value); nikoSeat.material.uniforms.keyCol.value.copy(seatKey).multiplyScalar(0.95 * smooth(2.3, 2.5, T)); }
      const e = easeInOut(smooth(2.16, 2.42, T));
      chair.rotation.y = lerp(Math.PI, -0.08, e) + Math.sin(time * 0.5) * 0.012;
      chairMirror.rotation.y = chair.rotation.y;
      key.intensity = 0.55 * smooth(2.3, 2.5, T);
      const lit = nikoSeat && nikoSeat.userData.pro ? smooth(2.28, 2.45, T) : 0;
      faceKey.intensity = 2.8 * lit; kicker.intensity = 1.6 * lit;
      eyeLight.intensity = 0.45 * lit; eyeLight.position.copy(camera.position).y -= OFF;   // rides on the camera axis (office-local)
      const pulse = 1 + Math.sin(time * 1.3) * 0.03;
      const redK = 3.4 - 1.0 * smooth(2.4, 2.55, T);   // once he faces camera, less red wrapping onto the front of his face
      red1.intensity = redK * pulse; red2.intensity = redK * pulse;
      hazes.forEach((h, i) => { h.material.map.offset.x = time * 0.006 * (i + 1); h.material.map.offset.y = Math.sin(time * 0.05 + i) * 0.1; });
      dust.rotation.y = time * 0.01; dust.position.y = Math.sin(time * 0.1) * 0.05;
      ember.material.opacity = 0.7 + 0.3 * Math.sin(time * 2.1); smoke(dt);
    }
  }

  let lastNow = performance.now(), raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
    const k = 1 - Math.exp(-dt * 6.5);
    state.y += (window.scrollY - state.y) * k;
    ptr.x += (ptr.tx - ptr.x) * (1 - Math.exp(-dt * 3)); ptr.y += (ptr.ty - ptr.y) * (1 - Math.exp(-dt * 3));
    state.T = state.frozen != null ? state.frozen : timeAt(state.y);
    applyCues(state.T);
    if (applyPlates(state.T)) return;        // a photo fills the frame: nothing behind it needs drawing
    update(state.T, now / 1000, dt);
    const outside = state.T < 2;
    if (outside) vice.reflect(camera);
    post.strength = outside ? 0.5 : 0.42;
    post.render(scene, camera);
  }
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) { lastNow = performance.now(); raf = requestAnimationFrame(frame); }
  });
  window.addEventListener('resize', layout);

  // in-page links land on a moment in the film, not on a section edge
  const landing = { '#rooftop': 0, '#office': 2.06, '#token': 3 };
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const T = landing[a.getAttribute('href')]; if (T == null) return;
    e.preventDefault();
    window.scrollTo({ top: T >= 3 ? document.documentElement.scrollHeight : scrollFor(T), behavior: 'smooth' });
  }));

  layout();
  // debugging and review: ?t=2.4 freezes the film at that moment
  const dq = new URLSearchParams(location.search).get('dbg');
  if (dq) state.dbg = dq.split(',').map(Number);
  const q = new URLSearchParams(location.search).get('t');
  if (q != null && !isNaN(parseFloat(q))) state.frozen = parseFloat(q);
  window.__niko = { seek: T => { state.frozen = null; window.scrollTo(0, scrollFor(T)); state.y = scrollFor(T); }, freeze: T => { state.frozen = T; } };
  raf = requestAnimationFrame(frame);
})();
