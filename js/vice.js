/* Vice City at dusk, built from code. Look reference: docs/2026-11-20-vice-city-look-reference.md
   Returns the group plus update(), reflect() and the fog values the rest of the scene should use. */
window.NikoVice = function (ctx) {
  'use strict';
  const { renderer, scene, C, rng, makeCanvas, tex, glow, WATER_Y, coarse } = ctx;
  const group = new THREE.Group();
  const lerp = (a, b, t) => a + (b - a) * t;
  const r = rng(2026), rd = rng(4711);   // r lays the city out (keep its call order); rd is for added detail only
  const U = { night: { value: 0 }, time: { value: 0 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.0005 }, camPos: { value: new THREE.Vector3() } };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const bx = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(box, mat); m.scale.set(w, h, d); m.position.set(x, y, z); return m; };
  const tickers = [];
  // small lights are round glowing dots sized in pixels: scaled with the backing height so 4K shows the same picture as 1080p
  const dotTex = (() => {
    const c = makeCanvas(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(c);
  })();
  const dots = [];
  const dotMat = (size, o) => {
    const m = new THREE.PointsMaterial(Object.assign({ size, sizeAttenuation: false, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }, o));
    m.userData.base = size; dots.push(m); return m;
  };

  const NOISE = `
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return s; }`;
  // one sky for everything: the dome draws it, glass reflects it
  const SKY = `
    vec3 skyRamp(float h, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4){
      vec3 c = mix(c0, c1, smoothstep(0.0, 0.045, h));
      c = mix(c, c2, smoothstep(0.035, 0.13, h));
      c = mix(c, c3, smoothstep(0.11, 0.3, h));
      return mix(c, c4, smoothstep(0.28, 0.85, h)); }
    vec3 skyCol(vec3 d, float night){
      float h = max(d.y, 0.0);
      vec3 dusk = skyRamp(h, vec3(0.86, 0.15, 0.04), vec3(0.62, 0.06, 0.11), vec3(0.25, 0.05, 0.25), vec3(0.06, 0.035, 0.22), vec3(0.016, 0.015, 0.1));
      vec3 nite = skyRamp(h, vec3(0.34, 0.07, 0.2), vec3(0.2, 0.045, 0.19), vec3(0.13, 0.04, 0.19), vec3(0.075, 0.024, 0.14), vec3(0.024, 0.01, 0.062));
      float sunSide = 0.5 + 0.5 * dot(normalize(vec3(d.x, 0.0001, d.z)), vec3(0.0, 0.0, -1.0));
      vec3 col = mix(dusk, nite, night) * mix(mix(vec3(0.3, 0.36, 0.8), vec3(0.7, 0.5, 0.85), night), vec3(1.0), smoothstep(0.1, 0.8, sunSide));
      col += vec3(1.0, 0.42, 0.1) * pow(sunSide, 9.0) * exp(-h * 16.0) * 0.5 * (1.0 - night * 0.92);
      col += vec3(0.5, 0.12, 0.3) * exp(-h * 9.0) * night * 0.35;   // light dome over the city
      return col; }`;

  // height fog: at night it is densest at street level and tinted by the city light, so tower bases sink into a glowing haze
  const FOG = `
    float fogF(float d, float y){ float hf = exp(-max(y + 14.0, 0.0) / 60.0); float k = fogDensity * d; return 1.0 - exp(-k * k * mix(1.0, 0.55 + 2.8 * hf, night)); }
    vec3 fogC(float y){ float hf = exp(-max(y + 14.0, 0.0) / 45.0); return mix(fogColor, fogColor * vec3(2.3, 1.2, 1.4) + vec3(0.05, 0.012, 0.025), hf * night * 0.85); }`;

  /* ---------- sky ---------- */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 40, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { night: U.night, time: U.time },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float night; uniform float time; varying vec3 vDir;
      ${NOISE} ${SKY}
      void main(){
        vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        vec3 col = skyCol(d, night);
        vec2 cp = d.xz / (h + 0.18) * 1.5 + vec2(time * 0.004, 0.0);
        float cl = smoothstep(0.56 - 0.15 * night, 0.9, fbm(cp + fbm(cp * 0.5) * 0.6)) * smoothstep(0.03, 0.22, h) * (1.0 - smoothstep(0.45, 0.9, h));
        float under = 1.0 - smoothstep(0.05, 0.42, h);
        vec3 cloud = mix(mix(vec3(0.9, 0.2, 0.16), vec3(0.2, 0.07, 0.3), smoothstep(0.05, 0.4, h)), mix(vec3(0.05, 0.02, 0.07), vec3(0.62, 0.2, 0.22), under), night);
        col = mix(col, cloud, cl * mix(0.4, 0.8, night));
        float azA = atan(d.x, -d.z);
        float cu = fbm(vec2(azA * 3.5, h * 14.0) + vec2(3.0, 0.0) + time * 0.002);
        float cum = smoothstep(0.5, 0.62, cu) * smoothstep(0.012, 0.045, h) * (1.0 - smoothstep(0.08, 0.24, h + (cu - 0.5) * 0.22)) * smoothstep(0.3, 1.1, abs(azA));
        vec3 cumCol = mix(mix(vec3(0.95, 0.3, 0.18), vec3(0.28, 0.09, 0.32), smoothstep(0.03, 0.2, h)), mix(vec3(0.75, 0.26, 0.24), vec3(0.12, 0.04, 0.12), smoothstep(0.02, 0.2, h)), night);
        col = mix(col, cumCol, cum * 0.7);
        vec2 sp = d.xz / (h + 0.4) * 230.0;
        col += vec3(0.8, 0.86, 1.0) * step(0.997, hash(floor(sp))) * (1.0 - smoothstep(0.1, 0.32, length(fract(sp) - 0.5))) * smoothstep(0.14, 0.5, h) * (0.04 + 0.96 * night) * (1.0 - cl);
        // below the horizon (seen from high up in the flight): the far city haze, not a hard black band
        if (d.y < 0.0) {
          vec3 haze = col * mix(1.0, 0.5, smoothstep(0.0, 0.03, -d.y));
          col = mix(haze, mix(vec3(0.06, 0.025, 0.08), vec3(0.025, 0.012, 0.045), night), smoothstep(0.0, 0.3, -d.y));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <encodings_fragment>
      }`
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; group.add(sky);

  /* ---------- tower skin: drawn per pixel, so windows stay sharp at any distance ----------
     style 0 glass curtain wall, 1 balcony condo, 2 stone with punched windows.
     Glass shows the sky it faces. Each window has its own light, colour and brightness. */
  const CELL = [[2.3, 3.6], [4.4, 3.3], [2.8, 3.8]];
  function skin(o) {
    return new THREE.ShaderMaterial({
      extensions: { derivatives: true },
      uniforms: {
        dims: { value: new THREE.Vector3(o.w, o.h, o.d) }, cell: { value: new THREE.Vector2(CELL[o.style][0], CELL[o.style][1]) }, roundish: { value: o.round ? 1 : 0 },
        style: { value: o.style }, seed: { value: o.seed }, tint: { value: o.tint }, led: { value: o.led || new THREE.Color(0, 0, 0) },
        flood: { value: o.flood || 0 }, density: { value: o.density },
        night: U.night, fogColor: U.fogColor, fogDensity: U.fogDensity, camPos: U.camPos
      },
      vertexShader: `
        uniform vec3 dims; uniform vec2 cell; uniform float roundish; uniform float seed; uniform vec3 tint;
        varying vec2 vCell; varying vec3 vN; varying vec3 vW; varying float vDist; varying float vFace; varying float vU; varying float vV; varying float vSeed; varying vec3 vTint;
        void main(){
          vec3 dd = dims; vec4 lp = vec4(position, 1.0); vec3 ln = normal; vSeed = seed; vTint = tint;
          #ifdef USE_INSTANCING
            dd = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
            lp = instanceMatrix * lp; ln = mat3(instanceMatrix) * ln;
            vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453) * 40.0;
          #endif
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor;
          #endif
          vN = normalize(mat3(modelMatrix) * ln);
          float hw = mix(abs(normal.x) > 0.5 ? dd.z : dd.x, dd.x, roundish);
          vCell = vec2(uv.x * hw / cell.x, uv.y * dd.y / cell.y); vU = uv.x; vV = uv.y;
          vFace = (1.0 - roundish) * (floor(normal.x * 1.5 + 0.5) + 2.0 * floor(normal.z * 1.5 + 0.5));
          vec4 w = modelMatrix * lp; vW = w.xyz;
          vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform float style; uniform vec3 led; uniform float flood; uniform float density; uniform float roundish; uniform vec2 cell;
        uniform float night; uniform vec3 fogColor; uniform float fogDensity; uniform vec3 camPos;
        varying vec2 vCell; varying vec3 vN; varying vec3 vW; varying float vDist; varying float vFace; varying float vU; varying float vV; varying float vSeed; varying vec3 vTint;
        ${SKY} ${FOG}
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rect(vec2 f, vec2 lo, vec2 hi, vec2 aa){ vec2 a = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f)); return a.x * a.y; }
        // a fake room behind each window (interior mapping): back wall, side walls, ceiling and floor, all in perspective
        vec3 room(vec2 f, vec3 N, vec3 V, vec3 lamp, vec2 key){
          vec3 T = normalize(vec3(N.z, 0.0, -N.x) + vec3(1e-4, 0.0, 0.0)), rd = -V;
          vec3 r = vec3(dot(rd, T), rd.y, max(-dot(rd, N), 0.04));
          vec3 box = vec3(cell, cell.x * (0.9 + 0.5 * h21(key + 2.2)));
          vec3 p0 = vec3(f * cell, 0.0);
          vec3 tq = (step(0.0, r) * box - p0) / r;
          float t = min(tq.x, min(tq.y, tq.z)); vec3 h = p0 + r * t;
          float depth = clamp(h.z / box.z, 0.0, 1.0);
          vec3 c;
          if (t == tq.z) {                                  // back wall, sometimes a dark sofa or desk across it
            c = lamp * mix(0.42, 0.8, h.y / cell.y);
            float furn = step(0.45, h21(key + 7.7)) * (1.0 - step(cell.y * (0.22 + 0.16 * h21(key + 1.9)), h.y));
            c *= 1.0 - 0.8 * furn;
          } else if (t == tq.y) {
            c = r.y > 0.0 ? lamp * (1.15 + 1.4 * exp(-8.0 * dot(h.xz / box.xz - vec2(0.5, 0.55), h.xz / box.xz - vec2(0.5, 0.55)))) : lamp * 0.26;
          } else c = lamp * 0.55;
          return c * mix(1.0, 0.62, depth);
        }
        void main(){
          float seed = vSeed; vec3 tint = vTint;
          vec2 c = floor(vCell), f = fract(vCell), aa = fwidth(vCell) * 0.8;
          vec2 key = c + vec2(seed * 17.0 + vFace * 31.0, seed * 3.0);
          float id = h21(key), row = h21(vec2(c.y + seed * 5.0, vFace + 2.0));
          float lit = step(id, row > 0.94 ? 0.92 : (row < 0.1 ? 0.03 : density));
          vec3 lamp = mix(vec3(1.0, 0.6, 0.24), vec3(1.0, 0.84, 0.58), h21(key + 3.7));
          lamp = mix(lamp, vec3(0.72, 0.85, 1.0), step(0.91, h21(key * 1.3 + 1.1)));
          lamp = mix(lamp, h21(key + 4.4) < 0.5 ? vec3(1.0, 0.3, 0.75) : vec3(0.3, 0.9, 1.0), step(0.985, h21(key * 0.7 + 8.3)));   // the odd party, the odd TV
          float bright = 0.22 + 0.78 * pow(h21(key + 9.1), 1.6);
          // blinds: some windows are covered from the top down to a random height and glow flat through the fabric
          float blindH = h21(key + 5.3) < 0.34 ? mix(0.25, 0.85, h21(key + 6.1)) : 0.0;
          float blind = smoothstep(1.0 - blindH - aa.y, 1.0 - blindH + aa.y, f.y);
          vec3 N = normalize(vN), V = normalize(camPos - vW), R = reflect(-V, N);
          vec3 inside = mix(room(f, N, V, lamp, key), lamp * 0.62 * (0.85 + 0.15 * f.y), blind);
          vec3 refl = skyCol(normalize(vec3(R.x, abs(R.y) + 0.03, R.z)), night);
          float fres = 0.22 + 0.78 * pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 amb = mix(vec3(0.12, 0.09, 0.2), vec3(0.03, 0.034, 0.07), night);
          float shade = 0.72 + 0.28 * max(N.z, 0.0);
          float pane = 0.85 + 0.3 * h21(key + 11.0);         // glass panes never match exactly
          vec3 col = vec3(0.0); vec3 em = vec3(0.0);
          if (style < 0.5) {
            float glass = rect(f, vec2(0.04, 0.2), vec2(0.96, 0.975), aa);
            float fin = step(3.0, mod(c.x, 4.0)) * (1.0 - rect(f, vec2(-1.0, -1.0), vec2(0.86, 2.0), aa));   // every fourth mullion is a deep fin
            col = mix(tint * amb * 0.4, refl * fres * 1.25 * tint * pane + tint * amb * 0.22, glass);
            col = mix(col, tint * amb * shade * 0.9 + refl * 0.06, fin);
            em = inside * bright * lit * rect(f, vec2(0.1, 0.26), vec2(0.9, 0.94), aa) * (1.0 - fin);
          } else if (style < 1.5) {
            float slab = smoothstep(0.86 - aa.y, 0.86 + aa.y, f.y);
            float lip = rect(f, vec2(-1.0, 0.86), vec2(2.0, 0.895), aa);          // the slab edge catches the sky
            float shadow = smoothstep(0.68 - aa.y, 0.68 + aa.y, f.y) * (1.0 - slab);
            float wallV = 1.0 - rect(f, vec2(0.07, -1.0), vec2(0.93, 2.0), aa);
            float rail = rect(f, vec2(0.07, 0.0), vec2(0.93, 0.3), aa);
            vec3 wall = tint * amb * shade * 1.55 + tint * flood * vec3(0.85, 0.8, 0.78);
            col = refl * fres * 0.42 * pane + vec3(0.012, 0.016, 0.024);
            col = mix(col, col * 0.4, shadow); col += tint * amb * 0.2 * rail;
            float solid = max(slab, wallV); col = mix(col, wall, solid) + tint * amb * 0.5 * lip;
            em = inside * bright * lit * (1.0 - solid) * (1.0 - rail * 0.3) * (1.0 - shadow * 0.45);
          } else {
            float win = rect(f, vec2(0.24, 0.2), vec2(0.76, 0.82), aa);
            vec3 wall = tint * amb * shade * 1.3 * (0.88 + 0.12 * h21(c + 0.5)) + tint * flood * vec3(0.85, 0.8, 0.78);
            col = mix(wall, refl * fres * 0.5 * pane + vec3(0.01, 0.013, 0.02), win);
            em = inside * bright * lit * win;
          }
          // far away, single windows are smaller than a pixel: settle to their average instead of shimmering
          float far = clamp(max(aa.x, aa.y) * 1.7 - 0.25, 0.0, 1.0);
          em = mix(em, vec3(1.0, 0.72, 0.42) * 0.7 * density * (style < 0.5 ? 0.55 : (style < 1.5 ? 0.42 : 0.3)), far);
          float edge = max(1.0 - smoothstep(0.0, 0.014, vU), smoothstep(0.986, 1.0, vU)) * (1.0 - roundish);
          em += led * edge * 1.2;
          // LED lines on the top floors of towers that carry an accent colour
          float crownZone = smoothstep(0.84, 0.86, vV) * step(0.001, dot(led, vec3(1.0)));
          float ln = 1.0 - smoothstep(0.0, aa.y * 1.5 + 0.015, abs(f.y - 0.1));
          em += led * ln * crownZone * mix(1.6, 0.9, far);
          col += em * mix(0.55, 1.0, night);
          float fg = fogF(vDist, vW.y);
          col = mix(col, fogC(vW.y), fg * 0.9) + em * fg * 0.25;
          gl_FragColor = vec4(col, 1.0);
          #include <encodings_fragment>
        }`
    });
  }
  const TINTS = [['#bfe6ff', '#9fd9d0', '#d8c9ff', '#ffd9b0', '#cfe0ea'], ['#ffffff', '#ffe9d6', '#dff5ea', '#fff3c4', '#e9f0ff'], ['#d9cdbd', '#cfd6e2', '#e6d0c0']];
  const roofMat = new THREE.MeshBasicMaterial({ color: C('#0b0a12') });
  const neonMat = hex => new THREE.MeshBasicMaterial({ color: C(hex) });
  const beacons = [];
  const beacon = (x, y, z, size, rnd) => { const b = glow('#ff2a1a', size || 12, 1); b.position.set(x, y, z); group.add(b); beacons.push({ s: b, phase: (rnd || r)() * 6 }); };
  const CROWN = ['#2de2c8', '#5fb4ff', '#ff3fa4', '#fff2dc', '#b266ff'];
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1, false);

  /* near-tower silhouette details: real balcony slabs and railings, lit crown signs, helipads */
  const slabMat = new THREE.MeshBasicMaterial({ color: C('#6a5c7a') }), railMat = new THREE.MeshBasicMaterial({ color: C('#262436'), transparent: true, opacity: 0.8 });
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function balconies(x, z, w, d, h) {
    const fl = Math.floor(h / 3.3) - 1; if (fl < 2) return;
    const faces = [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]], n = fl * 4;
    const sl = new THREE.InstancedMesh(box, slabMat, n), rl = new THREE.InstancedMesh(box, railMat, n); let i = 0;
    for (let k = 1; k <= fl; k++) {
      const y = WATER_Y + k * 3.3 - 0.4;
      for (const [fx, fz, len] of faces) {
        sl.setMatrixAt(i, _m4.compose(_p.set(x + fx * (w / 2 + 0.8), y, z + fz * (d / 2 + 0.8)), _q, _s.set(fx ? 1.6 : len + 1.2, 0.3, fx ? len + 1.2 : 1.6)));
        rl.setMatrixAt(i, _m4.compose(_p.set(x + fx * (w / 2 + 1.56), y + 0.62, z + fz * (d / 2 + 1.56)), _q, _s.set(fx ? 0.07 : len + 1.2, 0.95, fx ? len + 1.2 : 0.07)));
        i++;
      }
    }
    group.add(sl, rl);
  }
  // glass towers up close: projecting fin blades every third bay, two setback ledges with a lit soffit, a dark louvred plant band
  const finMat = new THREE.MeshBasicMaterial({ color: C('#2b2a3c') }), louvMat = new THREE.MeshBasicMaterial({ color: C('#0e0d16') }), soffitMat = new THREE.MeshBasicMaterial({ color: C('#ffd2a0') });
  function glassDepth(x, z, w, d, h) {
    const faces = [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]], bay = 2.3 * 3, mats = [];
    faces.forEach(([fx, fz, len]) => { const n = Math.floor(len / bay); for (let i = 1; i < n; i++) { const u = -len / 2 + i * (len / n); mats.push([x + (fx ? fx * (w / 2 + 0.45) : u), z + (fz ? fz * (d / 2 + 0.45) : u), fx ? 0.9 : 0.35, fx ? 0.35 : 0.9]); } });
    const fins = new THREE.InstancedMesh(box, finMat, mats.length);
    mats.forEach(([px, pz, sx, sz], i) => fins.setMatrixAt(i, _m4.compose(_p.set(px, WATER_Y + h / 2, pz), _q, _s.set(sx, h, sz))));
    group.add(fins);
    for (const k of [0.34, 0.68]) {
      const y = WATER_Y + Math.round(h * k / 3.6) * 3.6;
      group.add(bx(w + 3, 0.7, d + 3, finMat, x, y + 0.35, z));                    // ledge
      group.add(bx(w + 2.4, 0.12, d + 2.4, soffitMat, x, y - 0.04, z));            // its lit underside
    }
    const yb = WATER_Y + Math.round(h * 0.5 / 3.6) * 3.6 + 1.8;
    group.add(bx(w + 0.5, 3.4, d + 0.5, louvMat, x, yb, z));                         // mechanical floor band
  }
  const SIGNS = ['OCEANA', 'VICE BANK', 'LUMEN', 'MARQUIS', 'HELIX', 'PALMERA', 'ONYX', 'CORAL ONE', 'SOLANO', 'BAYVIEW'];
  let signN = 0;
  function crownSign(x, y, z, wdt, col) {
    const c = makeCanvas(1024, 256), g = c.getContext('2d'), name = SIGNS[signN++ % SIGNS.length];
    g.font = '800 170px "Sofia Sans Extra Condensed", "Arial Narrow", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = 28; g.fillStyle = col; g.fillText(name, 512, 132); g.shadowBlur = 8; g.fillStyle = '#ffffff'; g.fillText(name, 512, 132);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wdt, wdt / 4), new THREE.MeshBasicMaterial({ map: tex(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    m.position.set(x, y, z); group.add(m);
  }
  const padTex = (() => {
    const c = makeCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#1a1820'; g.beginPath(); g.arc(256, 256, 250, 0, 7); g.fill();
    g.strokeStyle = '#e8e2d0'; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 200, 0, 7); g.stroke();
    g.fillStyle = '#e8e2d0'; g.fillRect(176, 146, 34, 220); g.fillRect(302, 146, 34, 220); g.fillRect(176, 240, 160, 32);
    return tex(c);
  })();
  function helipad(x, y, z, size) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 48), new THREE.MeshBasicMaterial({ map: padTex, color: C('#9a90a8') }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); group.add(m);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, l = glow(i % 2 ? '#7dffb0' : '#fff2c8', 2.2, 0.9); l.position.set(x + Math.cos(a) * size * 0.5, y + 0.3, z + Math.sin(a) * size * 0.5); group.add(l); }
  }

  function tower(x, z, w, d, h, o) {
    o = o || {};
    const style = o.style == null ? (r() < 0.42 ? 0 : r() < 0.72 ? 1 : 2) : o.style, seed = r() * 40;
    const tint = C(TINTS[style][(r() * TINTS[style].length) | 0]), density = 0.12 + r() * 0.22, flood = style > 0 && r() < 0.07 ? 0.24 : 0;
    const round = !o.square && style === 0 && r() < 0.22;
    const led = o.led ? C(o.led) : (h > 75 && r() < 0.16 ? C(CROWN[(r() * CROWN.length) | 0]) : null);
    const part = (pw, pd, ph, y0) => {
      const mat = skin({ style, seed, tint, density, flood, led, w: round ? Math.PI * pw : pw, h: ph, d: pd, round });
      const m = round ? new THREE.Mesh(cyl, [mat, roofMat, roofMat]) : new THREE.Mesh(box, [mat, mat, roofMat, roofMat, mat, mat]);
      m.scale.set(pw, ph, round ? pw : pd); m.position.set(x, y0 + ph / 2, z); group.add(m);
    };
    let top = WATER_Y + h, tw = w, td = d;
    part(w, d, h, WATER_Y);
    const tiers = h > 55 && r() < 0.55 ? (r() < 0.4 ? 2 : 1) : 0;         // setbacks: the tower steps in toward the top
    for (let i = 0; i < tiers; i++) { tw *= 0.7; td *= 0.7; const th = h * (0.1 + r() * 0.16); part(tw, td, th, top); top += th; }
    for (let i = 0; i < 2; i++) group.add(bx(2 + r() * 4, 1.5 + r() * 2.5, 2 + r() * 4, roofMat, x + (r() - 0.5) * tw * 0.5, top + 1, z + (r() - 0.5) * td * 0.5));   // plant on the roof
    if (!round) {   // parapet, a mechanical penthouse, and a thin antenna cluster: no bare box tops
      group.add(bx(tw + 0.5, 1.4, td + 0.5, roofMat, x, top + 0.7, z));
      const pw = tw * (0.35 + rd() * 0.25), pd = td * (0.35 + rd() * 0.25), ph = 3 + rd() * 4;
      group.add(bx(pw, ph, pd, roofMat, x + (rd() - 0.5) * (tw - pw) * 0.8, top + ph / 2, z + (rd() - 0.5) * (td - pd) * 0.8));
      for (let i = 0; i < 3; i++) { const ah = 4 + rd() * 9; group.add(bx(0.35, ah, 0.35, roofMat, x + (rd() - 0.5) * tw * 0.7, top + ah / 2, z + (rd() - 0.5) * td * 0.7)); }
      if (h > 95) for (const sx of [-1, 1]) beacon(x + sx * tw * 0.46, top + 1.8, z + td * 0.46, 6, rd);   // aircraft-warning lights on the corners
    }
    if (o.crown || (h > 70 && r() < 0.5)) {
      const col = o.crown || CROWN[(r() * CROWN.length) | 0];
      const band = round ? new THREE.Mesh(cyl, neonMat(col)) : new THREE.Mesh(box, neonMat(col));
      band.scale.set(tw + 0.6, 1.5, (round ? tw : td) + 0.6); band.position.set(x, top - 2.2, z); group.add(band);
      const gl = glow(col, tw * 2.4, 0.5); gl.position.set(x, top - 2, z + td / 2 + 12); group.add(gl);
      if (!round && tw > 13 && o.crown !== '#ff2a1a') crownSign(x, top - 6.5, z + td / 2 + 0.25, tw * 0.86, col);
    }
    if (!round && Math.hypot(x - CLUB.x, z - CLUB.z) < 340) {
      if (style === 1) balconies(x, z, w, d, h);
      if (style === 0) glassDepth(x, z, w, d, h);
      if (h > 115 && !o.crown && rd() < 0.7) helipad(x, top + 1.45, z, Math.min(tw, td) * 0.72);
    }
    if (o.crane || (h > 90 && r() < 0.18)) {
      const mh = 22 + r() * 12;
      group.add(bx(1, mh, 1, roofMat, x + tw * 0.2, top + mh / 2, z)); group.add(bx(38, 0.9, 0.9, roofMat, x + tw * 0.2 + 9, top + mh, z));
      beacon(x + tw * 0.2, top + mh + 1.5, z);
    } else if (o.mast || (h > 80 && r() < 0.5)) {
      const mh = 12 + r() * 22; group.add(bx(1.1, mh, 1.1, roofMat, x, top + mh / 2, z)); beacon(x, top + mh + 1, z);
    }
  }

  // downtown: clusters with gaps, slim towers, uneven heights
  const CLUB = { x: 190, z: -600 }, WHEEL = { x: -236, z: -548 };
  const clear = (x, z) => (Math.abs(x - CLUB.x) < 52 && z > -650) || (Math.abs(x - WHEEL.x) < 62 && z > -640);
  [[-900, 7, 0.55], [-610, 12, 0.85], [-400, 8, 0.7], [-130, 16, 1.0], [70, 11, 0.9], [330, 12, 0.95], [560, 9, 0.7], [830, 8, 0.6], [1060, 5, 0.5]].forEach(([cx, n, k]) => {
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 190, z = -565 - r() * 210;
      if (clear(x, z)) continue;
      tower(x, z, 17 + r() * 16, 17 + r() * 16, (34 + Math.pow(r(), 2.1) * 125) * k);
    }
  });
  // the club tower, tallest in town, with the red room
  tower(CLUB.x, CLUB.z, 48, 48, 200, { style: 0, square: true, crown: '#ff2a1a', led: '#ff2a1a', mast: true });
  const room = new THREE.Mesh(new THREE.PlaneGeometry(44, 12.1), new THREE.MeshBasicMaterial({ map: (() => {
    const c = makeCanvas(1600, 440), g = c.getContext('2d'); g.scale(4, 4);   // drawn at 4x: it fills the frame as the camera arrives
    const gr = g.createRadialGradient(200, 70, 4, 200, 60, 230); gr.addColorStop(0, '#ff5a3a'); gr.addColorStop(0.3, '#e0180f'); gr.addColorStop(1, '#4a0605');
    g.fillStyle = gr; g.fillRect(0, 0, 400, 110); g.fillStyle = '#120202';
    g.fillRect(187, 52, 26, 50); g.beginPath(); g.ellipse(200, 54, 13, 9, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(200, 43, 6, 5, 0, 0, 7); g.fill();
    g.fillRect(0, 102, 400, 8); for (let x = 0; x <= 400; x += 50) g.fillRect(x - 2, 0, 4, 110);
    return tex(c); })() }));
  room.position.set(CLUB.x, 160, CLUB.z + 24.3); group.add(room);
  const roomGlow = glow('#ff2a14', 90, 0.28); roomGlow.position.set(CLUB.x, 160, CLUB.z + 26); roomGlow.material.depthTest = false; group.add(roomGlow);

  // low city: dark blocks under a carpet of small lights, and the glow that hangs over it
  group.add(bx(3600, 1.2, 1200, new THREE.MeshBasicMaterial({ color: C('#1c0f28') }), 0, WATER_Y + 0.3, -1136));   // streets under a glowing haze, not black
  (() => {
    // the low blocks carry real windows too (instanced tower skin: size, seed and tint come per instance)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), blocks = [[], []];
    for (let i = 0; i < 150; i++) { const h = 8 + r() * 26, s = new THREE.Vector3(20 + r() * 40, h, 20 + r() * 40); blocks[rd() < 0.6 ? 0 : 1].push([new THREE.Vector3(lerp(-1500, 1500, r()), WATER_Y + h / 2, -545 - r() * 330), s]); }
    [[2, TINTS[2]], [1, TINTS[1]]].forEach(([style, tints], k) => {
      const mat = skin({ style, seed: 0, tint: C('#ffffff'), density: 0.3, w: 1, h: 1, d: 1 });
      const im = new THREE.InstancedMesh(box, [mat, mat, roofMat, roofMat, mat, mat], blocks[k].length);
      blocks[k].forEach(([p, s], i) => { im.setMatrixAt(i, m4.compose(p, q, s)); im.setColorAt(i, C(tints[(rd() * tints.length) | 0]).multiplyScalar(0.55 + rd() * 0.3)); });
      group.add(im);
    });
    const N = 1700, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), cc = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const near = r() < 0.4;
      pos[i * 3] = lerp(-1600, 1600, r()); pos[i * 3 + 1] = WATER_Y + 1.5 + (near ? r() * 4 : r() * 30); pos[i * 3 + 2] = near ? -538 - r() * 12 : -550 - r() * 420;
      const k = r(); cc.copy(C(k < 0.62 ? '#ffb347' : k < 0.86 ? '#fff0d0' : k < 0.93 ? '#35e0ff' : k < 0.97 ? '#ff5ab0' : '#ff3b30')); col.set([cc.r, cc.g, cc.b], i * 3);
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    group.add(new THREE.Points(pg, dotMat(4, { vertexColors: true })));
    (() => {   // denser low city under the flight path: more blocks, varied heights, roof lights, a few lit billboards
      const n = 140, mat = skin({ style: 2, seed: 0, tint: C('#ffffff'), density: 0.38, w: 1, h: 1, d: 1 });
      const im = new THREE.InstancedMesh(box, [mat, mat, roofMat, roofMat, mat, mat], n), roof = [];
      for (let i = 0; i < n; i++) {
        const h = 6 + Math.pow(rd(), 1.6) * 38, x = lerp(-450, 750, rd()), z = -548 - rd() * 280;
        const sx = 12 + rd() * 30, sz = 12 + rd() * 30;
        im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, WATER_Y + h / 2, z), q, new THREE.Vector3(sx, h, sz)));
        im.setColorAt(i, C(TINTS[rd() < 0.5 ? 2 : 1][(rd() * 5) | 0] || '#d9cdbd').multiplyScalar(0.5 + rd() * 0.35));
        roof.push(x + (rd() - 0.5) * sx * 0.6, WATER_Y + h + 1.2, z + (rd() - 0.5) * sz * 0.6);
        if (rd() < 0.4) group.add(bx(sx * 0.3, 2.5, sz * 0.3, roofMat, x, WATER_Y + h + 1.25, z));
      }
      group.add(im);
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(roof), 3));
      group.add(new THREE.Points(rg, dotMat(3.6, { color: C('#ff4a3a') })));
      const BB = [['SUNSET RUM', '#ff3fa4'], ['VICE AIR', '#35e0ff'], ['LUCKY 7', '#ffd23f'], ['NEON NIGHTS', '#b266ff'], ['MALIBU', '#2dffb3'], ['OCEAN CLUB', '#ff8a2a']];
      BB.forEach(([txt, col], i) => {
        const c = makeCanvas(512, 192), g = c.getContext('2d');
        g.fillStyle = '#0c0a14'; g.fillRect(0, 0, 512, 192); g.strokeStyle = col; g.lineWidth = 8; g.shadowColor = col; g.shadowBlur = 18; g.strokeRect(10, 10, 492, 172);
        g.font = '800 92px "Sofia Sans Extra Condensed", "Arial Narrow", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(txt, 256, 100);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 9.75), new THREE.MeshBasicMaterial({ map: tex(c), toneMapped: false }));
        m.position.set(lerp(-60, 520, (i + 0.5) / BB.length) + (rd() - 0.5) * 40, WATER_Y + 30 + rd() * 22, -552 - rd() * 25); group.add(m);
        if (txt === 'LUCKY 7') { m.position.x -= 30; m.position.y += 7; }   // keep it clear of the port crane silhouette in the flight shot
        group.add(bx(0.6, m.position.y - WATER_Y, 0.6, roofMat, m.position.x, (m.position.y + WATER_Y) / 2 - 4, m.position.z - 0.5));
      });
    })();
    const dome = glow('#ffa040', 1, 0.1); dome.scale.set(2800, 110, 1); dome.position.set(0, WATER_Y + 20, -556); group.add(dome);
    tickers.push(() => { dome.material.opacity = lerp(0.09, 0.17, U.night.value); });
  })();

  // the wheel on the waterfront
  (() => {
    const g = new THREE.Group(), R = 36, cy = WATER_Y + 42, spin = new THREE.Group(); g.add(spin);
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.55, 6, 72), neonMat('#ff5ab0')));
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.5, 0.3, 6, 48), neonMat('#fff2dc')));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, sp = new THREE.Mesh(new THREE.BoxGeometry(R, 0.22, 0.22), neonMat(i % 2 ? '#fff2dc' : '#ffd0ea'));
      sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a; spin.add(sp);
      const cab = glow(i % 2 ? '#35e0ff' : '#ff5ab0', 5, 0.9); cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); spin.add(cab);
    }
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 46, 1.4), roofMat); leg.position.set(s * 9, -20, 0); leg.rotation.z = -s * 0.4; g.add(leg); }
    g.add(glow('#ff5ab0', 130, 0.22));
    g.position.set(WHEEL.x, cy, WHEEL.z); group.add(g);
    tickers.push(t => { spin.rotation.z = t * 0.05; });
  })();

  // causeway: a long low bridge with sodium lights and traffic
  (() => {
    const A = new THREE.Vector3(-1000, WATER_Y + 7, -448), B = new THREE.Vector3(820, WATER_Y + 7, -526), D = B.clone().sub(A), L = D.length(), dir = D.clone().normalize();
    const ry = Math.atan2(-D.z, D.x), mid = A.clone().addScaledVector(D, 0.5), dark = new THREE.MeshBasicMaterial({ color: C('#0b0b12') });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L, 1.3, 9), dark); deck.position.copy(mid); deck.rotation.y = ry; group.add(deck);
    const np = Math.floor(L / 48), pim = new THREE.InstancedMesh(box, dark, np), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(2.6, 7, 6), p = new THREE.Vector3();
    for (let i = 0; i < np; i++) { p.copy(A).addScaledVector(dir, (i + 0.5) * 48); p.y = WATER_Y + 3.5; pim.setMatrixAt(i, m4.compose(p, q, s)); }
    group.add(pim);
    const nl = Math.floor(L / 13), lp = new Float32Array(nl * 6), side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < nl; i++) for (let k = 0; k < 2; k++) { p.copy(A).addScaledVector(dir, i * 13).addScaledVector(side, k ? 4 : -4); lp.set([p.x, p.y + 5, p.z], (i * 2 + k) * 3); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    group.add(new THREE.Points(lg, dotMat(4.4, { color: C('#ffb347') })));
    (() => {   // sodium pools on the deck under every lamp
      const pm = new THREE.MeshBasicMaterial({ map: ctx.glowTex, color: C('#ffa23a'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.5, depthWrite: false });
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(pg, pm, nl * 2), sc = new THREE.Vector3(11, 1, 8), pp = new THREE.Vector3();
      for (let i = 0; i < nl * 2; i++) im.setMatrixAt(i, m4.compose(pp.set(lp[i * 3], WATER_Y + 7.7, lp[i * 3 + 2]), q, sc));
      im.renderOrder = 1; group.add(im);
    })();
    const NC = 56, cp = new Float32Array(NC * 3), ccol = new Float32Array(NC * 3), cars = [], cc = new THREE.Color();
    for (let i = 0; i < NC; i++) { const fwd = i % 2 === 0; cars.push({ u: r(), v: (0.012 + r() * 0.01) * (fwd ? 1 : -1), lane: fwd ? 1.8 : -1.8 }); cc.copy(C(fwd ? '#fff3d8' : '#ff2a1a')); ccol.set([cc.r, cc.g, cc.b], i * 3); }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    group.add(new THREE.Points(cg, dotMat(5.2, { vertexColors: true })));
    const cglow = cars.map((c, i) => { const g = glow(i % 2 === 0 ? '#fff3d8' : '#ff2a1a', i % 2 === 0 ? 3.2 : 2.4, 0.85); group.add(g); return g; });
    tickers.push((t, dt) => {
      for (let i = 0; i < NC; i++) { const c = cars[i]; c.u = (c.u + c.v * dt + 1) % 1; p.copy(A).addScaledVector(dir, c.u * L).addScaledVector(side, c.lane); cp[i * 3] = p.x; cp[i * 3 + 1] = p.y + 1.4; cp[i * 3 + 2] = p.z; cglow[i].position.set(p.x, p.y + 1.4, p.z); }
      cg.attributes.position.needsUpdate = true;
    });
  })();

  /* ---------- loaded models (Kenney, CC0): shaded by the same dusk as everything else ---------- */
  const gltf = THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
  function loadModels(urls, done) {
    if (!gltf) return;
    Promise.all(urls.map(u => new Promise((res, rej) => gltf.load(u, g => res(g.scene), undefined, rej)))).then(done).catch(e => console.warn('model load failed', e));
  }
  let white = null;
  function propMat(o) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: o.map || (white = white || flat('#ffffff')) }, tint: { value: o.color || new THREE.Color(1, 1, 1) }, lamp: { value: o.lamp || 0 }, fade: { value: 1 }, night: U.night, fogColor: U.fogColor, fogDensity: U.fogDensity },
      vertexShader: `
        varying vec2 vUv; varying vec3 vN; varying float vDist; varying float vWy;
        void main(){
          vec4 lp = vec4(position, 1.0); vec3 ln = normal;
          #ifdef USE_INSTANCING
            lp = instanceMatrix * lp; ln = mat3(instanceMatrix) * ln;
          #endif
          vUv = uv; vN = normalize(mat3(modelMatrix) * ln);
          vec4 wp = modelMatrix * lp; vWy = wp.y; vec4 mv = viewMatrix * wp; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 tint; uniform float lamp; uniform float fade; uniform float night; uniform vec3 fogColor; uniform float fogDensity;
        varying vec2 vUv; varying vec3 vN; varying float vDist; varying float vWy;
        ${FOG}
        void main(){
          if (fade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= fade) discard;   // dither dissolve (hero palms)
          vec4 tx = texture2D(map, vUv); if (tx.a < 0.5) discard;
          vec3 base = tx.rgb * tint, n = normalize(vN);
          vec3 sky = mix(vec3(0.3, 0.2, 0.42), vec3(0.05, 0.055, 0.11), night) * (0.55 + 0.45 * n.y);
          vec3 sun = vec3(1.0, 0.36, 0.14) * pow(max(dot(n, normalize(vec3(0.0, 0.25, -1.0))), 0.0), 1.5) * 0.7 * (1.0 - night);
          vec3 col = base * (sky + sun + lamp * vec3(1.0, 0.72, 0.42));
          float f = fogF(vDist, vWy);
          gl_FragColor = vec4(mix(col, fogC(vWy), f * 0.9), 1.0);
          #include <encodings_fragment>
        }`
    });
  }
  /* HD props (models/hd/, written last: READY.txt). Missing folder = keep the Kenney fallbacks, quietly. */
  const hdInfo = { front: null };
  const hdReady = fetch('models/hd/READY.txt', { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).then(t => {
    const m = /front[^\n]*?([+-])\s*([xyz])\b/i.exec(t); if (m) hdInfo.front = m[1] + m[2].toLowerCase();
    return !!t;
  }).catch(() => false);
  // wrap a loaded scene: dusk shading, ground contact at y = 0, scaled to a length (cars, front turned to +x) or a height (palms)
  function hdNormalize(sc, mode, size) {
    dress(sc, mode === 'len' ? 0.35 : 0.15);
    const inner = new THREE.Group(); inner.add(sc);
    const f = hdInfo.front; inner.rotation.y = f === '-x' ? Math.PI : f === '+z' ? Math.PI / 2 : f === '-z' ? -Math.PI / 2 : 0;
    inner.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(inner), sz = bb.getSize(new THREE.Vector3());
    if (mode === 'len' && !f && sz.z > sz.x) { inner.rotation.y = Math.PI / 2; inner.updateMatrixWorld(true); bb.setFromObject(inner); bb.getSize(sz); }
    const k = size / (mode === 'len' ? Math.max(sz.x, 1e-3) : Math.max(sz.y, 1e-3));
    const c = bb.getCenter(new THREE.Vector3());
    const outer = new THREE.Group(); inner.position.set(-c.x * k, -bb.min.y * k, -c.z * k); inner.scale.setScalar(k);
    inner.rotation.y = inner.rotation.y; outer.add(inner); return outer;
  }
  const dress = (root, lamp) => { root.traverse(o => { if (o.isMesh) { const s = o.material.side; o.material = propMat({ map: o.material.map, color: o.material.color, lamp }); o.material.side = s; } }); return root; };

  /* ---------- palms ---------- */
  function drawFronds(g, cx, cy, n, a0, a1, len, s, lw) {
    g.lineCap = 'round';
    for (let f = 0; f < n; f++) {
      const a = lerp(a0, a1, n > 1 ? f / (n - 1) : 0.5) + (s() - 0.5) * 0.16, L = len * (0.8 + s() * 0.3), droop = 0.9 + s() * 0.6;
      let px = cx, py = cy;
      for (let k = 1; k <= 26; k++) {
        const t = k / 26, x = cx + Math.cos(a) * L * t, y = cy + Math.sin(a) * L * t + droop * L * 0.5 * t * t;
        g.strokeStyle = '#0d1410'; g.lineWidth = (2.6 - t * 1.6) * lw; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
        const nx = -(y - py), ny = x - px, nl = Math.hypot(nx, ny) || 1, ll = ((1 - Math.abs(t - 0.45) * 1.5) * 0.19 + 0.04) * L;
        g.strokeStyle = k % 3 ? '#0e1711' : '#1a2618'; g.lineWidth = 1.5 * lw;
        for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + (nx / nl) * ll * sg + (x - px) * 0.9, y + (ny / nl) * ll * sg + L * 0.06 + t * L * 0.05); g.stroke(); }
        px = x; py = y;
      }
    }
  }
  const palmTex = (() => {
    const c = makeCanvas(256, 512), g = c.getContext('2d'), s = rng(5);
    g.lineCap = 'round';
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, x = 122 + Math.sin(t * 1.5) * 20, y = 508 - t * 330;
      g.strokeStyle = i % 2 ? '#1c140f' : '#120d0a'; g.lineWidth = 15 - t * 7; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.6, y - 9); g.stroke();
    }
    drawFronds(g, 142, 176, 15, -Math.PI * 0.02, -Math.PI * 0.98, 110, s, 1);
    return tex(c);
  })();
  const palmGeo = new THREE.PlaneGeometry(0.5, 1); palmGeo.translate(0, 0.5, 0);
  const palmMat = new THREE.MeshBasicMaterial({ map: palmTex, alphaTest: 0.4, side: THREE.DoubleSide });
  const palmSpots = []; let cardPalms = [];
  const palm = (x, y, z, h) => palmSpots.push([x, y, z, h]);
  function plantPalms() {
    const n = palmSpots.length, a = new THREE.InstancedMesh(palmGeo, palmMat, n), b = new THREE.InstancedMesh(palmGeo, palmMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    palmSpots.forEach(([x, y, z, h], i) => {
      const ry = r() * Math.PI; p.set(x, y, z); s.set(h, h, h);
      a.setMatrixAt(i, m4.compose(p, q.setFromEuler(e.set(0, ry, 0)), s)); b.setMatrixAt(i, m4.compose(p, q.setFromEuler(e.set(0, ry + Math.PI / 2, 0)), s));
    });
    group.add(a, b); cardPalms = [a, b];
  }
  // two crowns hanging into the top of the hero frame, close to the lens
  const fronds = (() => {
    // 1024 px, fine leaflets: each frond is a curved rib with ~90 thin, tapered, drooping leaflets per side, a warm rim on the lower edges
    const c = makeCanvas(1024, 1024), g = c.getContext('2d'), s = rng(8); g.scale(2, 2); g.lineCap = 'round';
    for (let f = 0; f < 8; f++) {
      const a = lerp(0.05, 1.3, f / 7) + (s() - 0.5) * 0.12, L = 440 * (0.72 + s() * 0.36), droop = 0.45 + s() * 0.75, pts = [], K = 90;
      for (let k = 0; k <= K; k++) { const t = k / K; pts.push([6 + Math.cos(a) * L * t, 10 + Math.sin(a) * L * t + droop * L * 0.45 * t * t]); }
      for (let k = 2; k <= K; k++) {
        const t = k / K, x = pts[k][0], y = pts[k][1], dx = x - pts[k - 1][0], dy = y - pts[k - 1][1], dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux;
        const ll = L * (0.04 + 0.19 * Math.sin(Math.PI * Math.min(1, t * 1.12))) * (0.85 + s() * 0.3);
        for (const sg of [-1, 1]) {
          const ex = x + nx * ll * sg + ux * ll * 0.55, ey = y + ny * ll * sg + uy * ll * 0.55 + ll * (0.35 + s() * 0.25);
          g.strokeStyle = s() < 0.5 ? '#0a110c' : '#0f1a12'; g.lineWidth = 2.6 * (1 - t * 0.5);
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + nx * ll * sg * 0.6, y + ny * ll * sg * 0.6, ex, ey); g.stroke();
          if (sg > 0 && s() < 0.35) { g.strokeStyle = 'rgba(255,150,110,0.22)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(x + 1, y + 1); g.quadraticCurveTo(x + nx * ll * 0.6 + 1, y + ny * ll * 0.6 + 1, ex + 1, ey + 1); g.stroke(); }
        }
      }
      g.strokeStyle = '#080d0a'; g.lineWidth = 4.5; g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke();
    }
    const t = tex(c), out = [];
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.3, fog: false, side: THREE.DoubleSide, color: C('#4a3a50') }));
      m.scale.x = -sx; m.position.set(sx * 1.62, 2.55, 1.9 + (sx > 0 ? 0.25 : 0)); m.renderOrder = 7; group.add(m); out.push(m);
    }
    tickers.push(t2 => { out.forEach((m, i) => { m.rotation.z = Math.sin(t2 * 0.7 + i * 2) * 0.035 * (i ? -1 : 1); }); });
    return out;
  })();

  /* ---------- the strip: pastel art-deco hotels with neon, on an island in front of downtown ---------- */
  const flat = hex => { const c = makeCanvas(4, 4), g = c.getContext('2d'); g.fillStyle = hex; g.fillRect(0, 0, 4, 4); return tex(c); };
  const black = flat('#000000');
  function decoMat(wall, glowT, gain) {
    return new THREE.ShaderMaterial({
      uniforms: { wall: { value: wall }, glowT: { value: glowT }, gain: { value: gain == null ? 1 : gain }, night: U.night, fogColor: U.fogColor, fogDensity: U.fogDensity },
      vertexShader: `
        varying vec2 vUv; varying float vShade; varying float vDist; varying float vWy;
        void main(){ vUv = uv; vWy = (modelMatrix * vec4(position, 1.0)).y; vec3 n = normalize(mat3(modelMatrix) * normal); vShade = 0.7 + 0.3 * max(n.z, 0.0) + 0.12 * n.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D wall; uniform sampler2D glowT; uniform float gain; uniform float night; uniform vec3 fogColor; uniform float fogDensity;
        varying vec2 vUv; varying float vShade; varying float vDist; varying float vWy;
        ${FOG}
        void main(){
          vec3 w = texture2D(wall, vUv).rgb, g = texture2D(glowT, vUv).rgb;
          vec3 amb = mix(vec3(0.2, 0.14, 0.28), vec3(0.05, 0.05, 0.1), night);
          vec3 col = w * amb * vShade + g * gain * mix(0.6, 1.0, night);
          float f = fogF(vDist, vWy);
          gl_FragColor = vec4(mix(col, fogC(vWy), f * 0.9) + g * gain * f * 0.25, 1.0);
          #include <encodings_fragment>
        }`
    });
  }
  const warm = ['#ffd08a', '#ffe2b0', '#ffb86a', '#ffc98a', '#fff0d0'];
  const PASTEL = ['#f2a7b8', '#a8e0c8', '#f6e2a0', '#a9d4f0', '#f7c2a0', '#f2efe8', '#cbb4ea', '#8fd8d8'];
  const FIN = ['#f7f3ec', '#f2efe8', '#e98aa2', '#f7f3ec', '#6fc3b0', '#f2a7b8', '#f7f3ec', '#f6e2a0'];
  const NEON = [['#ff3fa4', '#35e0ff'], ['#35e0ff', '#ffd23f'], ['#ff5ab0', '#ff8a2a'], ['#2dffb3', '#ff3fa4'], ['#b266ff', '#ff5ab0'], ['#ff3b30', '#fff2dc'], ['#35e0ff', '#ff3fa4'], ['#ffd23f', '#ff3fa4']];
  const NAMES = ['CORAL', 'BELLIC', 'VESPER', 'MARLIN', 'BROKER', 'SOLEIL', 'ROMANS', 'TIDES', 'DELMAR', 'HOVE', 'CABANA', 'ROXANA', 'NEPTUNE'];
  const decoSets = [];
  function drawDeco(i, set, font) {
    const W = 512, H = 256, g = set.wall.getContext('2d'), e = set.glow.getContext('2d'), rr = rng(900 + i), S = set.wall.width / W;
    g.setTransform(S, 0, 0, S, 0, 0); e.setTransform(S, 0, 0, S, 0, 0);
    const na = NEON[i % NEON.length][0], nb = NEON[i % NEON.length][1], name = NAMES[i % NAMES.length];
    e.globalAlpha = 1; e.shadowBlur = 0; e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    g.fillStyle = PASTEL[i % PASTEL.length]; g.fillRect(0, 0, W, H);
    const floors = 3 + (i % 2), gy = H - 58, fh = gy / floors;
    for (let f = 0; f < floors; f++) {
      const y = f * fh;
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, y, W, 6); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y + 6, W, 7);
      e.fillStyle = na; e.shadowColor = na; e.shadowBlur = 9 * S; e.fillRect(8, y + 1.5, W - 16, 2.6); e.shadowBlur = 0;
      for (let x = 20; x < W - 44; x += 47) {
        if (Math.abs(x + 16 - W / 2) < 58) continue;
        g.fillStyle = '#f6f2ea'; g.fillRect(x - 3, y + 19, 38, fh - 29); g.fillStyle = '#22303e'; g.fillRect(x, y + 22, 32, fh - 35);
        if (rr() < 0.45) { e.globalAlpha = 0.45 + rr() * 0.5; e.fillStyle = warm[(rr() * warm.length) | 0]; e.fillRect(x, y + 22, 32, fh - 35); e.globalAlpha = 1; }
      }
    }
    const fx = W / 2 - 40;
    g.fillStyle = FIN[i % FIN.length]; g.fillRect(fx, 0, 80, gy); g.fillStyle = 'rgba(0,0,0,0.16)'; for (let k = 1; k < 4; k++) g.fillRect(fx + k * 20 - 1, 0, 2, gy);
    e.fillStyle = nb; e.shadowColor = nb; e.shadowBlur = 11 * S; e.fillRect(fx + 2, 5, 3, gy - 10); e.fillRect(fx + 75, 5, 3, gy - 10); e.shadowBlur = 0;
    const step = Math.min(29, (gy - 20) / name.length);
    e.font = '800 ' + Math.round(step * 1.08) + 'px ' + font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.fillStyle = '#ffffff'; e.shadowColor = na; e.shadowBlur = 13 * S;
    [...name].forEach((ch, k) => { e.fillText(ch, W / 2, 12 + step * (k + 0.5)); e.fillText(ch, W / 2, 12 + step * (k + 0.5)); });
    e.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, gy, W, 58); g.fillStyle = '#f6f2ea'; g.fillRect(0, gy, W, 7);
    for (let x = 10; x < W; x += 63) {
      g.fillStyle = '#18202a'; g.fillRect(x, gy + 14, 45, 44);
      const wg = e.createLinearGradient(0, gy + 12, 0, H); wg.addColorStop(0, 'rgba(255,196,120,0.95)'); wg.addColorStop(1, 'rgba(255,150,70,0.45)'); e.fillStyle = wg; e.fillRect(x, gy + 14, 45, 44);
    }
    e.fillStyle = nb; e.shadowColor = nb; e.shadowBlur = 9 * S; e.fillRect(0, gy + 2.5, W, 2.6); e.shadowBlur = 0;
    set.wallT.needsUpdate = true; set.glowT.needsUpdate = true;
  }
  const STRIP = { x0: -170, x1: 300, z: -292, y: WATER_Y + 1.6 };
  group.add(bx(540, 1.9, 84, new THREE.MeshBasicMaterial({ color: C('#1c1620') }), 65, WATER_Y + 0.65, -288));
  group.add(bx(540, 0.2, 13, new THREE.MeshBasicMaterial({ color: C('#5a4650') }), 65, WATER_Y + 1.62, -252.5));     // beach
  group.add(bx(540, 0.06, 7, new THREE.MeshBasicMaterial({ color: C('#0d0c12') }), 65, WATER_Y + 1.63, -262.5));      // the road
  (() => {
    let x = STRIP.x0, i = 0;
    const lamps = [], roadZ = -262.5;
    while (x < STRIP.x1) {
      const w = 26 + r() * 12, h = 12.5 + r() * 5.5, d = 22, cx = x + w / 2;
      const SS = coarse ? 1 : 2, set = { wall: makeCanvas(512 * SS, 256 * SS), glow: makeCanvas(512 * SS, 256 * SS) }; set.wallT = tex(set.wall); set.glowT = tex(set.glow);
      decoSets.push(set); drawDeco(i, set, '"Arial Narrow", Impact, sans-serif');
      const front = decoMat(set.wallT, set.glowT, 1.5), plain = decoMat(flat(PASTEL[i % PASTEL.length]), black);
      const m = new THREE.Mesh(box, [plain, plain, roofMat, roofMat, front, plain]); m.scale.set(w, h, d); m.position.set(cx, STRIP.y + h / 2, STRIP.z); group.add(m);
      const fh = 5 + r() * 3; group.add(bx(w * 0.16, fh, 3.2, decoMat(flat(FIN[i % FIN.length]), black), cx, STRIP.y + h + fh / 2, STRIP.z + d / 2 - 1.4));
      const nb = NEON[i % NEON.length][1], na = NEON[i % NEON.length][0];
      for (const s of [-1, 1]) group.add(bx(0.22, fh, 0.22, neonMat(nb), cx + s * w * 0.08, STRIP.y + h + fh / 2, STRIP.z + d / 2 + 0.3));
      const gl = glow(na, w * 1.5, 0.4); gl.position.set(cx, STRIP.y + h * 0.55, STRIP.z + d / 2 + 4); group.add(gl);
      if (i % 3 === 1) {
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(11, 5), neonMat('#22b9d6')); pool.rotation.x = -Math.PI / 2; pool.position.set(cx + 3, STRIP.y + 0.12, STRIP.z + d / 2 + 8); group.add(pool);
        const pg = glow('#35e0ff', 22, 0.35); pg.position.set(cx + 3, STRIP.y + 2, STRIP.z + d / 2 + 8); group.add(pg);
      }
      for (let px = x + 3; px < x + w; px += 9 + r() * 4) palm(px, STRIP.y, STRIP.z + d / 2 + 3 + r() * 3, 10.5 + r() * 4.5);
      for (let lx = x + 2; lx < x + w + 3; lx += 8.5) lamps.push(lx, STRIP.y + 5.2, roadZ - 4.4);
      x += w + 3; i++;
    }
    for (let px = STRIP.x0 - 18; px < STRIP.x1 + 20; px += 15 + r() * 14) palm(px, STRIP.y, -249 - r() * 4, 9 + r() * 4);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lamps), 3));
    group.add(new THREE.Points(lg, dotMat(5, { color: C('#ffb347') })));
    (() => {   // sodium pools on the road, and warm uplight on the palm trunks
      const n = lamps.length / 3, pm = new THREE.MeshBasicMaterial({ map: ctx.glowTex, color: C('#ffa23a'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55, depthWrite: false });
      const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(pg, pm, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(13, 1, 10), pp = new THREE.Vector3();
      for (let i = 0; i < n; i++) im.setMatrixAt(i, m4.compose(pp.set(lamps[i * 3], STRIP.y + 0.1, lamps[i * 3 + 2] + 2.5), q, sc));
      im.renderOrder = 1; group.add(im);
      const up = palmSpots.filter(v => v[2] > -300).map(v => { const g = glow('#ffb070', 5.5, 0.45); g.position.set(v[0], v[1] + 1.5, v[2] + 0.6); group.add(g); return g; });
    })();
    // cars: a body, a cabin, two pairs of lights, cruising the strip
    const N = 16, paint = ['#d8262c', '#f2c12e', '#19b5b0', '#f4f1ea', '#ff5ab0', '#2a5fd6', '#101014', '#ff7a1a'];
    const body = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), N), cabin = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: C('#0c0f16') }), N);
    body.frustumCulled = false; cabin.frustumCulled = false;
    const cp = new Float32Array(N * 6), ccol = new Float32Array(N * 6), cars = [], cc = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let k = 0; k < N; k++) {
      const f = k % 2 === 0; cars.push({ u: r(), v: (0.016 + r() * 0.014) * (f ? 1 : -1), z: roadZ + (f ? 1.6 : -1.6), f });
      body.setColorAt(k, cc.copy(C(paint[k % paint.length])).multiplyScalar(0.34));
      cc.copy(C('#fff3d8')); ccol.set([cc.r, cc.g, cc.b], k * 6); cc.copy(C('#ff2a1a')); ccol.set([cc.r, cc.g, cc.b], k * 6 + 3);
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    const carLights = new THREE.Points(cg, dotMat(5.2, { vertexColors: true })); carLights.frustumCulled = false;
    group.add(body, cabin, carLights);
    const carModels = [], carGlow = [];
    const beamMat = new THREE.MeshBasicMaterial({ map: ctx.glowTex, color: C('#fff0d0'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.35, depthWrite: false });
    const beamGeo = new THREE.PlaneGeometry(1, 1); beamGeo.rotateX(-Math.PI / 2);
    for (let k = 0; k < N; k++) {
      const hd = glow('#fff3d8', 2.4, 0.95), tl = glow('#ff2a1a', 1.7, 0.9), bm = new THREE.Mesh(beamGeo, beamMat); bm.scale.set(9, 1, 3.2);
      group.add(hd, tl, bm); carGlow.push([hd, tl, bm]);
    }
    loadModels(['sedan-sports', 'hatchback-sports', 'sedan', 'suv-luxury', 'taxi', 'police', 'race', 'van'].map(n => 'models/cars/' + n + '.glb'), scenes => {
      cars.forEach((c, k) => {
        const m = dress(scenes[k % scenes.length].clone(true), 0.5); m.scale.setScalar(1.75); m.rotation.y = c.f ? Math.PI / 2 : -Math.PI / 2;
        group.add(m); carModels[k] = m;
      });
      body.visible = false; cabin.visible = false;
      // realistic replacements, when present: they take over from the Kenney cars (geometry and textures shared by every copy)
      hdReady.then(ready => { if (ready) loadModels(['car_sport', 'car_suv'].map(n => 'models/hd/' + n + '.glb'), hd => {
        const kinds = hd.map(sc => hdNormalize(sc, 'len', 4.7));
        cars.forEach((c, k) => {
          const m = kinds[k % kinds.length].clone(true); m.rotation.y = c.f ? 0 : Math.PI;
          if (carModels[k]) group.remove(carModels[k]); group.add(m); carModels[k] = m;
        });
      }); });
    });
    tickers.push((t, dt) => {
      for (let k = 0; k < N; k++) {
        const c = cars[k]; c.u = (c.u + c.v * dt + 1) % 1; const x2 = lerp(STRIP.x0 - 30, STRIP.x1 + 30, c.u), dirx = c.f ? 1 : -1;
        body.setMatrixAt(k, m4.compose(p.set(x2, STRIP.y + 0.62, c.z), q, s.set(4.4, 0.85, 1.9)));
        cabin.setMatrixAt(k, m4.compose(p.set(x2 - dirx * 0.3, STRIP.y + 1.3, c.z), q, s.set(2.1, 0.62, 1.65)));
        if (carModels[k]) carModels[k].position.set(x2, STRIP.y + 0.06, c.z);
        const cgk = carGlow[k]; cgk[0].position.set(x2 + dirx * 2.3, STRIP.y + 0.75, c.z); cgk[1].position.set(x2 - dirx * 2.3, STRIP.y + 0.8, c.z); cgk[2].position.set(x2 + dirx * 6.5, STRIP.y + 0.09, c.z);
        cp[k * 6] = x2 + dirx * 2.25; cp[k * 6 + 1] = STRIP.y + 0.7; cp[k * 6 + 2] = c.z; cp[k * 6 + 3] = x2 - dirx * 2.25; cp[k * 6 + 4] = STRIP.y + 0.75; cp[k * 6 + 5] = c.z;
      }
      body.instanceMatrix.needsUpdate = true; cabin.instanceMatrix.needsUpdate = true; cg.attributes.position.needsUpdate = true;
    });
  })();
  if (document.fonts && document.fonts.load) {
    document.fonts.load('800 30px "Sofia Sans Extra Condensed"', 'NIKO').then(() => decoSets.forEach((s, i) => drawDeco(i, s, '"Sofia Sans Extra Condensed", "Arial Narrow", sans-serif')), () => {});
  }

  /* ---------- the port: gantry cranes, container stacks, a docked ship, sodium light ---------- */
  (() => {
    const PX = 215, PZ = -404, PW = 250, PD = 64, top = WATER_Y + 1.3, quay = PZ + PD / 2;
    group.add(bx(PW, 1.6, PD, new THREE.MeshBasicMaterial({ color: C('#14121a') }), PX, WATER_Y + 0.5, PZ));
    const steel = new THREE.MeshBasicMaterial({ color: C('#161d30') }), steel2 = new THREE.MeshBasicMaterial({ color: C('#2a1416') });
    const crane = (x, mat) => {
      const g = new THREE.Group(), add = (w, h, d, px, py, pz, rx) => { const m = bx(w, h, d, mat, px, py, pz); if (rx) m.rotation.x = rx; g.add(m); };
      for (const sx of [-6.5, 6.5]) { for (const sz of [-7, 7]) add(1.4, 28, 1.4, sx, 14, sz); add(1.2, 1.2, 15.4, sx, 3, 0); }
      for (const sz of [-7, 7]) add(14.4, 1.4, 1.4, 0, 27.5, sz);
      add(2.4, 2.2, 60, 0, 29.5, 15); add(1.2, 16, 1.2, 0, 37.5, -3);
      add(0.5, 0.5, 48.4, 0, 38, 20, 0.313); add(0.5, 0.5, 19.1, 0, 38, -9, -0.893);
      add(7, 4.5, 9, 0, 32.8, -9); add(2.6, 2.4, 3.2, 0, 27.2, 22);
      for (const lz of [6, 22, 38]) { const l = glow('#fff0d0', 7, 0.9); l.position.set(0, 27.6, lz); g.add(l); }
      g.scale.setScalar(1.12); g.position.set(x, top, quay - 9); group.add(g);
      beacon(x, top + 52, quay - 12, 10);
    };
    [PX - 92, PX - 34, PX + 30, PX + 94].forEach((x, i) => crane(x, i === 2 ? steel2 : steel));
    // containers: stacked blocks on the yard, and a load on the ship
    const cols = ['#7a2a1c', '#1f4a78', '#2a6a4a', '#b0641e', '#8a8a86', '#1f6a70', '#6a1f3a', '#c2a02a'], spots = [];
    for (let ix = 0; ix < 16; ix++) for (let iz = 0; iz < 4; iz++) {
      if (r() < 0.18) continue; const n = 1 + (r() * 4 | 0);
      for (let k = 0; k < n; k++) spots.push([PX - PW / 2 + 14 + ix * 14.4, top + 1.3 + k * 2.62, PZ - 24 + iz * 8.2]);
    }
    const SX = PX - 8, SZ = quay + 21, deckY = WATER_Y + 7.4;
    for (let ix = 0; ix < 6; ix++) for (let iz = 0; iz < 5; iz++) { const n = 2 + (r() * 3 | 0); for (let k = 0; k < n; k++) spots.push([SX - 36 + ix * 12.6, deckY + 1.3 + k * 2.62, SZ - 5.2 + iz * 2.6]); }
    const im = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(12.2, 2.6, 2.5), p = new THREE.Vector3(), cc = new THREE.Color();
    spots.forEach((v, i) => { im.setMatrixAt(i, m4.compose(p.set(v[0], v[1], v[2]), q, s)); im.setColorAt(i, cc.copy(C(cols[(r() * cols.length) | 0])).multiplyScalar(0.15 + r() * 0.13)); });
    im.frustumCulled = false; group.add(im);
    // the ship
    group.add(bx(120, 8.4, 17, new THREE.MeshBasicMaterial({ color: C('#0f1626') }), SX, WATER_Y + 3.2, SZ));
    group.add(bx(120.3, 1.3, 17.3, new THREE.MeshBasicMaterial({ color: C('#571412') }), SX, WATER_Y + 0.5, SZ));
    const house = skin({ style: 2, seed: 7.7, tint: C('#e6e2d8'), density: 0.6, w: 11, h: 16, d: 15 });
    const hm = new THREE.Mesh(box, [house, house, roofMat, roofMat, house, house]); hm.scale.set(11, 16, 15); hm.position.set(SX + 50, deckY + 8, SZ); group.add(hm);
    group.add(bx(4, 7, 5, new THREE.MeshBasicMaterial({ color: C('#571412') }), SX + 51, deckY + 19.5, SZ));
    beacon(SX + 50, deckY + 25, SZ, 8);
    // sodium masts: a lamp, a pool of yellow on the ground
    const pool = new THREE.MeshBasicMaterial({ map: glow('#ffffff', 1).material.map, color: C('#ffb23a'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.4, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const x = PX - PW / 2 + 22 + i * 35, z = PZ - 6 + (i % 2 ? 14 : -12);
      group.add(bx(0.6, 27, 0.6, steel, x, top + 13.5, z));
      const l = glow('#ffc04a', 20, 0.95); l.position.set(x, top + 27.5, z); group.add(l);
      const d = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), pool); d.rotation.x = -Math.PI / 2; d.position.set(x, top + 0.12, z); d.renderOrder = 1; group.add(d);
    }
  })();

  for (let i = 0; i < 46; i++) { const x = lerp(-1300, 1300, r()); if (!clear(x, -540)) palm(x, WATER_Y + 0.9, -537 - r() * 6, 11 + r() * 6); }
  plantPalms();
  loadModels(['tree_palmDetailedTall', 'tree_palmBend', 'tree_palmTall'].map(n => 'models/palms/' + n + '.glb'), scenes => {
    if (heroPalms.length) return;                    // the HD palms got here first
    const kinds = scenes.map(sc => {
      sc.updateMatrixWorld(true); const parts = []; let top = 0;
      sc.traverse(o => { if (o.isMesh) { const g = o.geometry.clone().applyMatrix4(o.matrixWorld); g.computeBoundingBox(); top = Math.max(top, g.boundingBox.max.y); parts.push({ g, leaf: /leaf/i.test(o.material.name) }); } });
      return { parts, top };
    });
    const leafMat = propMat({ color: C('#2a7a5a') }), barkMat = propMat({ color: C('#6a4632') });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    kinds.forEach((kd, ki) => {
      const spots = palmSpots.filter((v, i) => i % kinds.length === ki);
      kd.parts.forEach(pt => {
        const im = new THREE.InstancedMesh(pt.g, pt.leaf ? leafMat : barkMat, spots.length);
        spots.forEach((v, i) => { im.setMatrixAt(i, m4.compose(p.set(v[0], v[1], v[2]), q.setFromEuler(e.set(0, i * 2.4 + ki, 0)), s.setScalar(v[3] / kd.top))); });
        im.frustumCulled = false; group.add(im);
      });
    });
    cardPalms.forEach(o => group.remove(o));
    kenneyPalms.push(...group.children.filter(o => o.isInstancedMesh && (o.material === leafMat || o.material === barkMat)));
  });
  const kenneyPalms = [];
  // HD palm: one instanced mesh per part for every palm spot, plus two crowns hanging into the top corners of the hero frame
  hdReady.then(ready => { if (ready) loadModels(['models/hd/palm.glb', 'models/hd/palm_lod.glb'], ([sc, lod]) => {
    const unit = hdNormalize(sc, 'h', 1); unit.updateMatrixWorld(true);
    const lodUnit = hdNormalize(lod, 'h', 1); lodUnit.updateMatrixWorld(true);   // ~8k-triangle LOD for every street palm; full mesh only for the two hero palms
    const parts = []; lodUnit.traverse(o => { if (o.isMesh) parts.push({ g: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material }); });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    // near (the strip) and far (the downtown waterfront) sets: the far set is left out of the mirror pass, it is a few pixels tall there
    [palmSpots.filter(v => v[2] > -300), palmSpots.filter(v => v[2] <= -300)].forEach((spots, far) => parts.forEach(pt => {
      const im = new THREE.InstancedMesh(pt.g, pt.mat, spots.length);
      spots.forEach((v, i) => im.setMatrixAt(i, m4.compose(p.set(v[0], v[1], v[2]), q.setFromEuler(e.set((rd() - 0.5) * 0.12, rd() * 6.28, (rd() - 0.5) * 0.12)), s.setScalar(v[3]))));
      im.frustumCulled = false; group.add(im); if (far) hidden.push(im);
    }));
    kenneyPalms.forEach(o => group.remove(o)); cardPalms.forEach(o => group.remove(o));
    // foreground crowns: tall palms just outside the terrace rail, tops in the upper corners (tune HERO_PALMS if framing is off)
    const HERO_PALMS = [[-3.2, -0.2, 0.5, 4.4, 0.5], [3.3, -0.2, 0.8, 4.6, 2.2]];
    HERO_PALMS.forEach(([x, y, z, h, ry]) => {
      const m = unit.clone(true); m.scale.setScalar(h);
      m.traverse(o => { if (o.isMesh) { const map = o.material.uniforms.map.value; o.material = o.material.clone(); o.material.uniforms.map.value = map; o.material.uniforms.tint.value = o.material.uniforms.tint.value.clone().multiplyScalar(0.45); } });   // backlit at dusk: near silhouettes, not lit green
      m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 7; group.add(m); hidden.push(m);
      heroPalms.push(m);
    });
    fronds.forEach(f => { f.userData.off = true; f.visible = false; });
  }); });
  const heroPalms = [];

  // boats: a hull, a cabin light, a slow drift
  (() => {
    const hull = new THREE.MeshBasicMaterial({ color: C('#0c0c14') }), cabinMat = new THREE.MeshBasicMaterial({ color: C('#1a1824') }), boats = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group(), len = 7 + r() * 12;
      g.add(bx(len, 1.4, 3, hull, 0, 0.7, 0)); g.add(bx(len * 0.4, 1.3, 2.2, cabinMat, -len * 0.08, 2, 0));
      g.add(bx(len * 0.36, 0.28, 2.26, neonMat('#ffc98a'), -len * 0.08, 2.15, 0));   // a thin strip of lit cabin windows
      const l = glow(i % 3 ? '#fff3d8' : '#ff3b30', 5, 0.9); l.position.set(len * 0.3, 3.4, 0); g.add(l);
      g.position.set(lerp(-560, 620, r()), WATER_Y, lerp(-70, -225, r()));
      group.add(g); boats.push({ g, v: (r() - 0.5) * 3.2 });
    }
    tickers.push((t, dt) => { for (const b of boats) { b.g.position.x += b.v * dt; if (b.g.position.x > 700) b.g.position.x = -640; if (b.g.position.x < -640) b.g.position.x = 700; b.g.position.y = WATER_Y + Math.sin(t * 0.8 + b.v) * 0.08; } });
  })();

  // air traffic: two airliners on approach and a helicopter circling the club tower
  (() => {
    const mk = () => { const g = new THREE.Group(), w = glow('#ffffff', 16, 1), red = glow('#ff2a1a', 9, 0.9); red.position.x = 3; g.add(w, red); group.add(g); return { g, w }; };
    const a = mk(), b = mk(), h = mk();
    tickers.push(t => {
      const ua = (t * 0.011) % 1, ub = (t * 0.008 + 0.55) % 1;
      a.g.position.set(lerp(-1500, 1500, ua), 330 - ua * 90, -1150); b.g.position.set(lerp(1400, -1400, ub), 250 + ub * 120, -1400);
      h.g.position.set(CLUB.x + Math.cos(t * 0.16) * 95, 232 + Math.sin(t * 0.3) * 6, CLUB.z + Math.sin(t * 0.16) * 95);
      a.w.material.opacity = (t * 1.1) % 1 < 0.08 ? 1 : 0.12; b.w.material.opacity = (t * 0.9 + 0.4) % 1 < 0.08 ? 1 : 0.12; h.w.material.opacity = (t * 1.6) % 1 < 0.12 ? 1 : 0.2;
    });
  })();

  /* ---------- the bay: a real mirrored render, rippled and smeared into streaks ---------- */
  const reflRT = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }); reflRT.texture.encoding = THREE.sRGBEncoding;
  const reflCam = new THREE.PerspectiveCamera(), texMatrix = new THREE.Matrix4();
  /* Small ripples, not waves: a ripple normal from four octaves of scrolling noise, each octave faded out once it is
     finer than a pixel (so it is crisp at 4K and does not shimmer at 1080p). The normal bends the mirror image a little
     sideways and a lot vertically, which breaks lights into short vertical streaks; fresnel decides how much mirror
     and how much deep indigo water; the low sun and the neon leave a glitter path. */
  const water = new THREE.Mesh(new THREE.PlaneGeometry(5200, 1500), new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    uniforms: { tRefl: { value: reflRT.texture }, texMatrix: { value: texMatrix }, camPos: U.camPos, time: U.time, night: U.night, fogColor: U.fogColor, fogDensity: U.fogDensity },
    vertexShader: `
      uniform mat4 texMatrix; varying vec4 vRefl; varying vec3 vW; varying float vDist;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vRefl = texMatrix * w; vec4 mv = viewMatrix * w; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform sampler2D tRefl; uniform vec3 camPos; uniform float time; uniform float night; uniform vec3 fogColor; uniform float fogDensity;
      varying vec4 vRefl; varying vec3 vW; varying float vDist;
      ${NOISE} ${FOG}
      vec2 grad(vec2 p){ const float e = 0.3; return vec2(noise(p + vec2(e, 0.0)) - noise(p - vec2(e, 0.0)), noise(p + vec2(0.0, e)) - noise(p - vec2(0.0, e))) / (2.0 * e); }
      void main(){
        vec2 p = vW.xz;
        float pf = max(length(fwidth(p)), 1e-4);                         // metres per pixel here
        float o1 = 1.0 - smoothstep(0.3, 0.7, 0.35 * pf), o2 = 1.0 - smoothstep(0.3, 0.7, 1.1 * pf), o3 = 1.0 - smoothstep(0.3, 0.7, 3.2 * pf);
        vec2 g = grad(p * vec2(0.1, 0.16) + vec2(time * 0.05, time * 0.035)) * 0.8
               + grad(p * vec2(0.35, 0.5) - vec2(time * 0.11, -time * 0.08)) * 0.55 * o1
               + grad(p * vec2(1.1, 1.6) + vec2(-time * 0.23, time * 0.2)) * 0.32 * o2
               + grad(p * vec2(3.2, 4.4) + vec2(time * 0.41, -time * 0.33)) * 0.2 * o3;
        vec3 N = normalize(vec3(-g.x * 0.16, 1.0, -g.y * 0.16));
        vec3 V = normalize(camPos - vW);
        float k = 1.0 / (1.0 + vDist * 0.004);
        vec2 uv = vRefl.xy / vRefl.w + vec2(N.x * 0.012, N.z * 0.05) * k;
        vec3 rf = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 7; i++) {                                     // short vertical smear: lights become streaks
          float t = float(i) / 6.0 - 0.5, w = 1.0 - abs(t) * 1.3;
          rf += texture2D(tRefl, uv + vec2(0.0, t * 0.04 * k)).rgb * w; ws += w;
        }
        rf /= ws;
        // big white sources (the title) break into a soft dim column; saturated neon keeps its punch
        float wh = smoothstep(0.25, 0.8, min(rf.r, min(rf.g, rf.b)));
        rf *= 1.0 - 0.8 * wh;
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        fres = mix(fres, 1.0, 0.25);                                     // still water at dusk: mostly mirror
        vec3 deep = mix(vec3(0.035, 0.024, 0.11), vec3(0.004, 0.006, 0.02), night);
        vec3 col = mix(deep, rf, clamp(fres, 0.0, 1.0)) + rf * rf * 0.35 * (1.0 - wh);
        // glitter: the low sun behind the skyline and its broad pink sheen, plus sparkle on ripple crests
        vec3 R = reflect(-V, N), sun = normalize(vec3(0.0, 0.05, -1.0));
        float sd = max(dot(R, sun), 0.0);
        col += vec3(1.0, 0.5, 0.28) * (pow(sd, 900.0) * 6.0 + pow(sd, 60.0) * 0.12) * (1.0 - night * 0.85) * o1;
        float crest = smoothstep(0.55, 0.95, length(g) * 0.55) * o2;
        col += rf * crest * 0.6;
        float f = fogF(vDist, vW.y);
        gl_FragColor = vec4(mix(col, fogC(vW.y), f * 0.75), 1.0);
        #include <encodings_fragment>
      }`
  }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, WATER_Y, 214); group.add(water);

  const hidden = fronds.slice(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const fogDusk = C('#6a3260'), fogNight = C('#2a1440');

  return {
    group, uniforms: U, fogColor: U.fogColor.value, get fogDensity() { return U.fogDensity.value; },
    hideInReflection(o) { hidden.push(o); },
    setSize(w, h) {
      const pr = renderer.getPixelRatio(), H = h * pr;
      // the mirror image runs at 0.75x up to ~1100 lines, then holds there (it is rippled and smeared anyway)
      const s = coarse ? 0.45 : Math.min(0.75, Math.max(0.5, 1100 / H));
      reflRT.setSize(Math.max(2, w * pr * s | 0), Math.max(2, h * pr * s | 0));
      const k = Math.max(1, H / 900); dots.forEach(m => { m.size = m.userData.base * k; });
    },
    update(time, dt, night, camera) {
      U.time.value = time; U.night.value = night; U.camPos.value.copy(camera.position);
      U.fogColor.value.copy(fogDusk).lerp(fogNight, night); U.fogDensity.value = lerp(0.0005, 0.00045, night);
      sky.position.copy(camera.position);
      fronds.forEach(f => { f.visible = !f.userData.off && camera.position.y < 6; });
      // the crane-up off the terrace flies straight through the right-hand crown: dissolve both hero palms as it lifts
      const pf = 1 - Math.min(1, Math.max(0, (camera.position.y - 1.55) / 0.9));
      heroPalms.forEach(m => { m.visible = pf > 0.001; if (m.userData.pf !== pf) { m.userData.pf = pf; m.traverse(o => { if (o.isMesh && o.material.uniforms && o.material.uniforms.fade) o.material.uniforms.fade.value = pf; }); } });
      for (const b of beacons) b.s.material.opacity = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(time * 1.6 + b.phase), 6);
      for (const t of tickers) t(time, dt);
    },
    // draw the scene from the camera's mirror image under the water, for the bay to sample
    reflect(camera) {
      camera.updateMatrixWorld();
      reflCam.fov = camera.fov; reflCam.aspect = camera.aspect; reflCam.near = camera.near; reflCam.far = camera.far; reflCam.updateProjectionMatrix();
      camera.getWorldDirection(v1); v2.copy(camera.position).add(v1);
      reflCam.position.set(camera.position.x, 2 * WATER_Y - camera.position.y, camera.position.z);
      reflCam.up.set(0, -1, 0); reflCam.lookAt(v2.x, 2 * WATER_Y - v2.y, v2.z); reflCam.updateMatrixWorld(); reflCam.matrixWorldInverse.copy(reflCam.matrixWorld).invert();
      texMatrix.copy(bias).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
      const was = hidden.map(o => o.visible); hidden.forEach(o => { o.visible = false; }); water.visible = false;
      const rt = renderer.getRenderTarget(); renderer.setRenderTarget(reflRT); renderer.render(scene, reflCam); renderer.setRenderTarget(rt);
      water.visible = true; hidden.forEach((o, i) => { o.visible = was[i]; });
    }
  };
};
