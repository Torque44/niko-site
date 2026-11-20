/* Niko as a generated 3D model (models/niko/stand.glb and seat.glb, made with Hunyuan3D from the turnaround views).
   The generator gives the sculpted shape; here each model is sized, stood on the floor and painted by projecting
   the same views back onto it, each face taking colour from the views it points toward. Returns { stand, seat }. */
window.NikoBody = function (ctx) {
  'use strict';
  const IMG = ctx.img || 'img/niko3d/', MOD = ctx.models || 'models/niko/';
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('missing ' + src)); i.src = src; });
  // real byte progress goes to the loading screen (js/loader.js) as 'niko:progress'
  // contract with the loading screen: 'niko:progress' {key, loaded, total} while a character downloads, 'niko:done' {key, ok}
  // when it is in (or failed), and window.__nikoModels for late listeners. key is 'seat' or 'stand'.
  const models = window.__nikoModels = { seat: 'loading', stand: 'loading' };
  const fire = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* very old browsers */ } };
  const keyOf = url => (/seat/.test(url) ? 'seat' : /stand/.test(url) ? 'stand' : null);
  const loadGLB = url => new Promise((res, rej) => {
    if (!THREE.GLTFLoader) return rej(new Error('no loader'));
    const key = keyOf(url);
    new THREE.GLTFLoader().load(url, g => res(g.scene),
      p => { if (key && p) fire('niko:progress', { key, loaded: p.loaded || 0, total: p.lengthComputable === false ? 0 : (p.total || 0) }); },
      () => rej(new Error('missing ' + url)));
  });
  const done = (key, ok) => { models[key] = ok ? 'ready' : 'failed'; fire('niko:done', { key, ok }); };

  // one view: where the figure sits in the picture, and a texture with colour bled past the outline
  function view(img) {
    const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 110) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const t = document.createElement('canvas'); t.width = w; t.height = h; const tg = t.getContext('2d');
    tg.drawImage(c, 0, 0); tg.globalCompositeOperation = 'destination-over';
    for (const r of [2, 5, 9, 14, 22]) for (let a = 0; a < 8; a++) tg.drawImage(c, Math.cos(a * Math.PI / 4) * r, Math.sin(a * Math.PI / 4) * r);
    tg.fillStyle = '#2a2622'; tg.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(t); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
    return { w, h, x0, x1, y0, y1, tex };
  }

  // pull the mesh out of the file, turn it to face +z, stand it on y = 0 at the given height
  function shape(scene, height, yaw, cut) {
    scene.updateMatrixWorld(true);
    let geo = null;
    scene.traverse(o => { if (o.isMesh && !geo) { geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); } });
    if (!geo) throw new Error('no mesh in model');
    if (yaw) geo.rotateY(yaw);
    geo.computeBoundingBox(); let b = geo.boundingBox;
    if (cut && geo.index) {   // drop triangles the cut test rejects (centre and face normal, in fractions of the box)
      const p = geo.attributes.position, ix = geo.index.array, keep = [], a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3(), sz = b.getSize(new THREE.Vector3());
      for (let i = 0; i < ix.length; i += 3) {
        a.fromBufferAttribute(p, ix[i]); c.fromBufferAttribute(p, ix[i + 1]); d.fromBufferAttribute(p, ix[i + 2]);
        nrm.subVectors(d, c).cross(a.clone().sub(c)).normalize();
        const m = a.clone().add(c).add(d).divideScalar(3);
        if (!cut((m.x - b.min.x) / sz.x, (m.y - b.min.y) / sz.y, (m.z - b.min.z) / sz.z, nrm)) keep.push(ix[i], ix[i + 1], ix[i + 2]);
      }
      const remap = new Int32Array(p.count).fill(-1), pos = []; let k = 0;
      for (let i = 0; i < keep.length; i++) { const v = keep[i]; if (remap[v] < 0) { remap[v] = k++; pos.push(p.getX(v), p.getY(v), p.getZ(v)); } keep[i] = remap[v]; }
      geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(keep);
      geo.computeBoundingBox(); b = geo.boundingBox;
    }
    const s = height / (b.max.y - b.min.y);
    geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); geo.scale(s, s, s);
    geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }

  function paint(geo, V, H) {
    const p = geo.attributes.position.array, n = p.length / 3, b = geo.boundingBox;
    // head close-up: a front projection pinned by the eye midpoint (image px ex,ey <-> mesh metres mx,my) at kx,ky px per metre
    const uH = new Float32Array(n * 2);
    if (H) for (let i = 0; i < n; i++) { uH[i * 2] = (H.ex + (p[i * 3] - H.mx) * H.kx) / H.img.width; uH[i * 2 + 1] = 1 - (H.ey - (p[i * 3 + 1] - H.my) * H.ky) / H.img.height; }
    let tH = null;
    if (H) { tH = new THREE.Texture(H.img); tH.encoding = THREE.sRGBEncoding; tH.needsUpdate = true; }
    geo.setAttribute('uH', new THREE.BufferAttribute(uH, 2));
    const fx = x => (x - b.min.x) / (b.max.x - b.min.x), fy = y => (y - b.min.y) / (b.max.y - b.min.y), fz = z => (z - b.min.z) / (b.max.z - b.min.z);
    const uv = (v, t, y, out, i) => { out[i * 2] = (v.x0 + t * (v.x1 - v.x0)) / v.w; out[i * 2 + 1] = 1 - (v.y1 - fy(y) * (v.y1 - v.y0)) / v.h; };
    const uF = new Float32Array(n * 2), uB = new Float32Array(n * 2), uL = new Float32Array(n * 2), uR = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      uv(V.F, fx(x), y, uF, i); uv(V.B, 1 - fx(x), y, uB, i);                  // seen from behind, his left is on the picture's left
      if (V.L) uv(V.L, 1 - fz(z), y, uL, i); if (V.R) uv(V.R, fz(z), y, uR, i);  // in the left view he faces picture-left
    }
    geo.setAttribute('restN', new THREE.BufferAttribute(geo.attributes.normal.array.slice(), 3));
    geo.setAttribute('uF', new THREE.BufferAttribute(uF, 2)); geo.setAttribute('uB', new THREE.BufferAttribute(uB, 2));
    geo.setAttribute('uL', new THREE.BufferAttribute(uL, 2)); geo.setAttribute('uR', new THREE.BufferAttribute(uR, 2));
    return new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        tF: { value: V.F.tex }, tB: { value: V.B.tex }, tL: { value: (V.L || V.F).tex }, tR: { value: (V.R || V.F).tex }, sides: { value: V.L && V.R ? 1 : 0 },
        amb: { value: new THREE.Color(0.3, 0.3, 0.3) }, keyCol: { value: new THREE.Color(0, 0, 0) }, keyDir: { value: new THREE.Vector3(0, 0.3, 1).normalize() },
        rimSide: { value: new THREE.Color(0, 0, 0) }, rimTop: { value: new THREE.Color(0, 0, 0) }, center: { value: new THREE.Vector3() },
        // directional fill: red wrap light from both sides, cool light from above, a key that fades out below keyLo..keyHi (model y)
        sideCol: { value: new THREE.Color(0, 0, 0) }, topCol: { value: new THREE.Color(0, 0, 0) }, keyLo: { value: -2 }, keyHi: { value: -1 }, spec: { value: 0 },
        tH: { value: tH || V.F.tex }, headOn: { value: H ? 1 : 0 }, hC: { value: new THREE.Vector2(H ? H.cx / H.img.width : 0, H ? 1 - H.cy / H.img.height : 0) },
        hR: { value: new THREE.Vector2(H ? H.rx / H.img.width : 1, H ? H.ry / H.img.height : 1) }
      },
      vertexShader: `
        attribute vec3 restN; attribute vec2 uF; attribute vec2 uB; attribute vec2 uL; attribute vec2 uR; attribute vec2 uH;
        varying vec2 vF; varying vec2 vB; varying vec2 vL; varying vec2 vR; varying vec2 vH; varying vec3 vRN; varying vec3 vNv; varying vec3 vNw; varying vec3 vP; varying vec3 vW; varying float vY;
        void main(){ vF = uF; vB = uB; vL = uL; vR = uR; vH = uH; vRN = restN; vY = position.y; vNv = normalize(normalMatrix * normal); vNw = normalize(mat3(modelMatrix) * normal);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D tF; uniform sampler2D tB; uniform sampler2D tL; uniform sampler2D tR; uniform sampler2D tH; uniform float sides; uniform float headOn;
        uniform vec2 hC; uniform vec2 hR;
        uniform vec3 amb; uniform vec3 keyCol; uniform vec3 keyDir; uniform vec3 rimSide; uniform vec3 rimTop; uniform vec3 center;
        uniform vec3 sideCol; uniform vec3 topCol; uniform float keyLo; uniform float keyHi; uniform float spec;
        varying vec2 vF; varying vec2 vB; varying vec2 vL; varying vec2 vR; varying vec2 vH; varying vec3 vRN; varying vec3 vNv; varying vec3 vNw; varying vec3 vP; varying vec3 vW; varying float vY;
        float wrap(float d){ float w = clamp((d + 0.35) / 1.35, 0.0, 1.0); return w * w; }
        void main(){
          vec3 rn = normalize(vRN);
          float wf = pow(max(rn.z, 0.0), 2.5), wb = pow(max(-rn.z, 0.0), 2.5), wl = pow(max(rn.x, 0.0), 2.5) * sides, wr = pow(max(-rn.x, 0.0), 2.5) * sides;
          if (sides < 0.5) { wf = smoothstep(-0.22, 0.22, rn.z); wb = 1.0 - wf; }
          float ws = wf + wb + wl + wr + 0.0001;
          vec3 alb = (texture2D(tF, vF).rgb * (wf + 0.0001) + texture2D(tB, vB).rgb * wb + texture2D(tL, vL).rgb * wl + texture2D(tR, vR).rgb * wr) / ws;
          vec2 hv = vec2(vH.x, min(vH.y, 0.85));   // the crown, above the picture, takes the stubble band near its top
          float hw = headOn * (1.0 - smoothstep(0.62, 1.0, length((vec2(vH.x, min(vH.y, 0.66)) - hC) / hR))) * smoothstep(0.1, 0.45, rn.z + max(rn.y, 0.0));
          vec3 hc = texture2D(tH, hv, 3.0 * smoothstep(0.82, 0.92, vH.y)).rgb * (1.0 - 0.45 * smoothstep(0.8, 0.9, vH.y)); float hmx = max(hc.r, max(hc.g, hc.b)), hmn = min(hc.r, min(hc.g, hc.b));
          hw *= 1.0 - smoothstep(0.46, 0.51, hmx) * (1.0 - smoothstep(0.012, 0.04, (hmx - hmn) / max(hmx, 0.01)));   // skip the light grey studio backdrop
          alb = mix(alb, hc, hw);
          vec3 n = normalize(vNv), v = normalize(-vP);
          float fr = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0), sgn = sign(vP.x - center.x);
          vec3 nw = normalize(vNw);
          float spot = smoothstep(keyLo, keyHi, vY);
          float kd = max(dot(nw, keyDir), 0.0) * (1.0 - 0.6 * smoothstep(0.3, 0.8, nw.y));   // a low key: the crown stays in shade
          vec3 col = alb * (amb * (0.75 + 0.25 * nw.y) + keyCol * kd * spot
                     + sideCol * (wrap(nw.x) + wrap(-nw.x)) * (0.3 + 0.7 * spot) + topCol * max(nw.y, 0.0));
          vec3 vw = normalize(cameraPosition - vW), hh = normalize(keyDir + vw);
          float gold = smoothstep(0.12, 0.3, alb.r - alb.b) * smoothstep(0.3, 0.55, alb.r) * (1.0 - hw);
          col += keyCol * spot * spec * (0.015 + 0.9 * gold) * pow(max(dot(nw, hh), 0.0), 48.0) * step(0.0, dot(nw, keyDir));
          col += rimSide * fr * smoothstep(0.2, 0.9, n.x * sgn) + rimTop * fr * smoothstep(0.3, 0.9, n.y);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`
    }));
  }

  // head close-up (img/niko3d/niko_head_v3.webp, 1024x1024 from niko_3d_views/v3/head_front.jpg): eye midpoint px (509,425), face ellipse centre (508,495) radii 232x360.
  // mx,my = the sculpted eye midpoint on each mesh in metres after shape(); kx,ky = picture px per metre (from eye spacing, nose, chin, ears)
  const HEAD = { ex: 509, ey: 425, cx: 508, cy: 495, rx: 232, ry: 360 };
  let headImg = null;   // only fetched if a fallback painted model is needed
  const one = (file, names, height, yaw, cut, hk) => Promise.all([loadGLB(MOD + file), headImg || (headImg = loadImg(IMG + 'niko_head_v3.webp').catch(() => null))].concat(names.map(n => (n ? loadImg(IMG + n + '.webp') : null)))).then(r => {
    const V = { F: view(r[2]), B: view(r[3]), L: r[4] ? view(r[4]) : null, R: r[5] ? view(r[5]) : null };
    return paint(shape(r[0], height, yaw, cut), V, r[1] && hk && !yaw ? Object.assign({ img: r[1] }, HEAD, hk) : null);
  });
  // a fully textured model (Meshy): keep its own PBR material, turn it to face +z, stand it on y = 0 at the given height.
  // Returned as a group so the caller can place and turn it; .userData.pro marks it (no projection uniforms).
  // keep(fx, fy, fz): optional test on each triangle's centre, in fractions of the file's own bounding box; false hides
  // that triangle (a new index over the same vertices, so the shape and textures are untouched).
  function hideTris(geo, box, keep) {
    const p = geo.attributes.position, ix = geo.index ? geo.index.array : null, n = ix ? ix.length : p.count, out = [], sz = box.getSize(new THREE.Vector3());
    for (let i = 0; i < n; i += 3) {
      const a = ix ? ix[i] : i, b = ix ? ix[i + 1] : i + 1, c = ix ? ix[i + 2] : i + 2;
      const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
      if (keep((x - box.min.x) / sz.x, (y - box.min.y) / sz.y, (z - box.min.z) / sz.z)) out.push(a, b, c);
    }
    const g = new THREE.BufferGeometry();
    for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
    g.setIndex(out.length > 65535 * 3 || p.count > 65535 ? new THREE.Uint32BufferAttribute(out, 1) : new THREE.Uint16BufferAttribute(out, 1));
    g.boundingBox = box.clone(); g.computeBoundingSphere(); return g;
  }
  function pro(file, height, yaw, keep, env) {
    return loadGLB(MOD + file).then(scene => {
      scene.updateMatrixWorld(true);
      const meshes = []; scene.traverse(o => { if (o.isMesh) meshes.push(o); });
      if (!meshes.length) throw new Error('no mesh in ' + file);
      const inner = new THREE.Group();
      const all = new THREE.Box3(); for (const o of meshes) { o.geometry.computeBoundingBox(); all.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
      for (const o of meshes) {
        const m = new THREE.Mesh(keep ? hideTris(o.geometry, all, keep) : o.geometry, o.material); m.applyMatrix4(o.matrixWorld);
        // Meshy exports metallicFactor 1, which turns cloth and skin into dark mirror metal (no diffuse): treat him as dielectric
        const mt = o.material; mt.side = THREE.FrontSide; mt.metalness = 0; mt.metalnessMap = null;
        for (const k of ['map', 'normalMap', 'roughnessMap']) if (mt[k]) { mt[k].anisotropy = ctx.anisotropy || 8; mt[k].generateMipmaps = true; mt[k].needsUpdate = true; }   // tweed cloth: no shimmer
        const em = env || ctx.envMap;
        if (em) { mt.envMap = em; mt.envMapIntensity = ctx.envIntensity != null ? ctx.envIntensity : 0.6; }
        mt.needsUpdate = true; inner.add(m);
      }
      inner.rotation.y = yaw || 0; inner.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(inner), s = height / (b.max.y - b.min.y);
      inner.scale.setScalar(s);
      inner.position.set(-(b.min.x + b.max.x) / 2 * s, -b.min.y * s, -(b.min.z + b.max.z) / 2 * s);
      const g = new THREE.Group(); g.add(inner); g.userData.pro = true; g.userData.inner = inner; return g;
    });
  }

  // the seated side views face the other way from the standing ones, so seat_right paints his left (+x) side and seat_left his right
  const cfg = Object.assign({ standYaw: 0, seatYaw: 0, standHeight: 1.85, seatHeight: 1.6, proSeatYaw: 0, proSeatHeight: 1.425 }, ctx);   // seat_pro: 1.9 units tall incl. its stool block, so 0.75 m per unit (seat to crown ~0.95 m)
  const oldSeat = () => one('seat.glb', ['seat_front', 'seat_back', 'seat_right', 'seat_left'], cfg.seatHeight, cfg.seatYaw, null, { mx: -0.002, my: 1.458, kx: 2616, ky: 2906 }).catch(e => { console.warn('seated model:', e.message); return null; });
  // which size of each textured model: _m on phones / small or low-memory devices, _hi only with ?q=1 or a clearly high-end
  // desktop (and only when the file exists: a failed _hi load drops back to the normal one).
  const q = new URLSearchParams(location.search), small = matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 500 || (screen.width > 0 && Math.min(screen.width, screen.height) < 700);   // not navigator.deviceMemory: Brave reports a randomised low value on desktops
  // no _hi files were made (READY.txt: 4096 px is as sharp as the 8K original), so _hi is only tried when cfg.hiModels says they exist
  const high = cfg.hiModels && (q.get('q') === '1' || (!small && (navigator.deviceMemory || 0) >= 8 && (navigator.hardwareConcurrency || 0) >= 12 && devicePixelRatio >= 2));
  const sized = (base, ...a) => small && q.get('q') !== '1' ? pro(base + '_m.glb', ...a).catch(() => pro(base + '.glb', ...a))
    : high ? pro(base + '_hi.glb', ...a).catch(() => pro(base + '.glb', ...a)) : pro(base + '.glb', ...a);
  // the seated model can carry a block under him (part of the mesh): cfg.seatKeep hides it by box fraction if needed
  // seat_pro's block: y below the thighs (0..0.33 of the height), z -0.46..0.07 units (0.03..0.58 of the depth); hide it,
  // leaving a 1 cm sliver of its top that the cushion covers. Shins and shoes are further forward and stay.
  const blockOut = (x, y, z) => !(y < 0.325 && z < 0.578);
  // seat_v3 (GTA6-style sitting model): its white cube was removed from the file, so nothing is hidden here.
  // seat_pro (previous model, block still in the mesh) is the fallback.
  // Desktop: seat_full.glb, the source mesh undecimated with its original 8192 textures (only the white cube's faces dropped);
  // seat_hq.glb (same mesh, 4096/2048 textures) with ?hq=1 or when the GPU cannot take 8192 textures.
  // Phones: seat_v3_m.glb (head and hands undecimated, body reduced, 2048 textures). '?v=' keeps old cached copies out.
  const bigTex = (cfg.maxTex || 0) >= 8192, seatFile = small && q.get('q') !== '1' ? 'seat_v3_m.glb?v=3' : (q.get('hq') === '1' || !bigTex ? 'seat_hq.glb?v=1' : 'seat_full.glb?v=1');
  const seatPro = () => pro(seatFile, cfg.proSeatHeight, cfg.proSeatYaw, cfg.seatKeep || null).then(g => { g.userData.v3 = true; return g; })
    .catch(e => { console.warn('seated model:', e.message, '- falling back to seat_pro'); return sized('seat_pro', cfg.proSeatHeight, cfg.proSeatYaw, blockOut); });
  // standing man: seams-locked decimations of his source (no flipped-UV triangles): stand_v3 desktop, stand_v3_m phones;
  // stand_full.glb (the source unchanged) with ?hq=1
  const standFile = small && q.get('q') !== '1' ? 'stand_v3_m.glb?v=1' : (q.get('hq') === '1' ? 'stand_full.glb?v=1' : 'stand_v3.glb?v=1');
  return Promise.all([
    pro(standFile, cfg.standHeight, cfg.proStandYaw || 0, null, cfg.standEnv).catch(() => pro('stand_pro.glb', cfg.standHeight, cfg.proStandYaw || 0, null, cfg.standEnv)).catch(e => {
      console.warn('stand_pro:', e.message, '- falling back to stand.glb');
      return one('stand.glb', ['front', 'back', 'left', 'right'], cfg.standHeight, cfg.standYaw, null, { mx: -0.002, my: 1.71, kx: 2720, ky: 2745 });
    }),
    seatPro().catch(e => { console.warn('seat_pro:', e.message, '- falling back to seat.glb'); return oldSeat(); })
  ]).then(r => {
    // 'niko:done' after main.js has added them (its .then runs before this timeout)
    setTimeout(() => { done('stand', !!r[0]); done('seat', !!r[1]); }, 0);
    return { stand: r[0], seat: r[1] };
  }, e => { setTimeout(() => { done('stand', false); done('seat', models.seat === 'ready'); }, 0); throw e; });
};
