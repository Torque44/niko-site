/* Bloom, filmic tone curve, a touch of lens colour and a vignette.
   The scene is drawn into an sRGB-stored target, bright parts are blurred at three sizes and added back.

   Resolution: the canvas renders at native device pixels, up to a 4K budget (3840x2160 backing pixels; phones less).
   Every pass is expressed in screen fractions, so 1080p and 4K show the same picture, only sharper:
   bloom always runs at a 1080p-equivalent size, the lens fringe and vignette are in UV space.
   A governor watches the frame time and steps the render scale down (1, 0.85, 0.7, 0.6) when a machine cannot keep up.
   ?q=1 pins full quality (review screenshots), ?post=0 turns the post pipeline off. */
window.NikoPost = function (renderer) {
  'use strict';
  const qs0 = new URLSearchParams(location.search);
  const ok = renderer.capabilities.isWebGL2 && qs0.get('post') !== '0';
  const coarse = matchMedia('(pointer: coarse)').matches;

  /* ---------- resolution policy + adaptive quality governor ---------- */
  const force = qs0.get('q') === '1';
  const BUDGET = coarse ? 2.6e6 : 3840 * 2160;          // backing pixels at full quality
  const PR_CAP = coarse ? 2 : 3;
  const STEPS = [1, 0.85, 0.7, 0.6];
  const gov = { step: 0, w: 0, h: 0, acc: 0, n: 0, last: 0, changed: performance.now() + 2500, good: 0, vsync: 1e9, fails: [0, 0, 0, 0] };
  const basePR = (w, h) => Math.max(0.5, Math.min(window.devicePixelRatio || 1, PR_CAP, Math.sqrt(BUDGET / Math.max(1, w * h))));
  function applyPR(w, h) {
    gov.w = w; gov.h = h;
    const pr = basePR(w, h) * STEPS[gov.step];
    if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) renderer.setPixelRatio(pr);   // three resizes the canvas itself
  }
  function setStep(s, now) {
    gov.step = s; gov.changed = now; gov.acc = 0; gov.n = 0; gov.good = 0;
    window.dispatchEvent(new Event('resize'));        // the page's layout() resizes canvas, post targets and the reflection
  }
  function tick() {
    const now = performance.now(), dt = now - gov.last; gov.last = now;
    if (force || dt <= 0 || dt > 250 || now - gov.changed < 1200) return;   // hidden/throttled tab, shader warm-up
    gov.vsync = Math.min(gov.vsync, Math.max(4, dt));
    gov.acc += dt; gov.n++;
    if (gov.acc < 1000) return;
    const avg = gov.acc / gov.n; gov.acc = 0; gov.n = 0;
    if (avg > 22 && gov.step < STEPS.length - 1) { gov.fails[gov.step]++; setStep(gov.step + 1, now); return; }
    // headroom: under ~12 ms, or (60 Hz displays never go under 16.7) holding vsync, for long enough
    const easy = avg < 12 || avg < gov.vsync * 1.12;
    gov.good = easy ? gov.good + 1 : 0;
    const up = gov.step - 1, need = avg < 12 ? 3 : 6 + 6 * (up >= 0 ? gov.fails[up] : 0);
    if (up >= 0 && gov.good >= need && gov.fails[up] < 3) setStep(up, now);
  }
  const quality = { get step() { return gov.step; }, get scale() { return STEPS[gov.step]; }, forced: force, budget: BUDGET };
  window.__nikoQuality = quality;

  if (!ok) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    return { enabled: false, strength: 1, quality,
      setSize(w, h) { applyPR(w, h); },
      render(scene, camera) { tick(); renderer.setRenderTarget(null); renderer.render(scene, camera); } };
  }
  renderer.toneMapping = THREE.NoToneMapping;        // the curve is applied once, at the end

  const mk = (opts) => new THREE.WebGLRenderTarget(2, 2, Object.assign({ minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }, opts || {}));
  const sceneRT = mk({ depthBuffer: true, samples: coarse ? 2 : 4 }); sceneRT.texture.encoding = THREE.sRGBEncoding;
  // bloom chain in half float: no 8-bit steps in the long glow gradients (the red room, the dusk sky)
  const levels = [0, 1, 2].map(() => [mk({ type: THREE.HalfFloatType }), mk({ type: THREE.HalfFloatType })]);

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), qs = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; qs.add(quad);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const pass = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });

  // bright pass doubles as the downsample: four bilinear taps average a 2x2 or 4x4 block, so small lights do not sparkle at 4K
  const bright = pass(`
    uniform sampler2D t; uniform float th; uniform vec2 off; varying vec2 vUv;
    vec3 tap(vec2 uv){ vec3 c = texture2D(t, uv).rgb; float l = max(c.r, max(c.g, c.b)); return c * smoothstep(th, th + 0.2, l); }
    void main(){
      vec3 c = tap(vUv + vec2(-off.x, -off.y)) + tap(vUv + vec2(off.x, -off.y)) + tap(vUv + vec2(-off.x, off.y)) + tap(vUv + vec2(off.x, off.y));
      gl_FragColor = vec4(c * 0.25, 1.0); }`, { t: { value: null }, th: { value: 0.8 }, off: { value: new THREE.Vector2() } });
  const blur = pass(`
    uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
    void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227;
      c += (texture2D(t, vUv + dir * 1.385).rgb + texture2D(t, vUv - dir * 1.385).rgb) * 0.316;
      c += (texture2D(t, vUv + dir * 3.231).rgb + texture2D(t, vUv - dir * 3.231).rgb) * 0.0703;
      gl_FragColor = vec4(c, 1.0); }`, { t: { value: null }, dir: { value: new THREE.Vector2() } });
  const final = pass(`
    uniform sampler2D t; uniform sampler2D b0; uniform sampler2D b1; uniform sampler2D b2;
    uniform float strength; uniform float exposure; uniform vec2 px; uniform float sharp; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec3 c = vec3(texture2D(t, vUv + d * r2 * 0.007).r, texture2D(t, vUv).g, texture2D(t, vUv - d * r2 * 0.007).b);
      // mild sharpen at native pixels; the step is clamped so hard edges cannot ring
      vec3 nb = texture2D(t, vUv + vec2(px.x, 0.0)).rgb + texture2D(t, vUv - vec2(px.x, 0.0)).rgb + texture2D(t, vUv + vec2(0.0, px.y)).rgb + texture2D(t, vUv - vec2(0.0, px.y)).rgb;
      vec3 hp = c - nb * 0.25; float lim = 0.04 + 0.08 * dot(c, vec3(0.3, 0.5, 0.2));
      c = max(c + clamp(hp * sharp, -lim, lim), 0.0);
      vec3 bloom = texture2D(b0, vUv).rgb * 0.55 + texture2D(b1, vUv).rgb * 0.8 + texture2D(b2, vUv).rgb * 1.0;
      c += bloom * strength;
      c = aces(c * exposure);
      c *= 1.0 - 0.42 * pow(r2 * 2.0, 1.15);
      gl_FragColor = vec4(c, 1.0);
      #include <encodings_fragment>
      // dither after the sRGB encode: breaks the 8-bit steps in the sky gradient and the red room
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      gl_FragColor.rgb += (ign - 0.5) / 255.0;
    }`, { t: { value: null }, b0: { value: null }, b1: { value: null }, b2: { value: null }, strength: { value: 1 }, exposure: { value: 1.0 }, px: { value: new THREE.Vector2() }, sharp: { value: 0.35 } });

  const draw = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(qs, cam); };
  const api = {
    enabled: true, strength: 1, quality,
    setSize(w, h) {
      applyPR(w, h);
      const pr = renderer.getPixelRatio(), W = Math.max(2, Math.round(w * pr)), H = Math.max(2, Math.round(h * pr));
      sceneRT.setSize(W, H);
      // bloom at a 1080p-equivalent size whatever the backing size: same radius on screen, a quarter of the cost at 4K
      const k = Math.min(1, 1080 / H);
      levels.forEach((l, i) => { const s = 2 << i, bw = Math.max(2, Math.round(W * k / s)), bh = Math.max(2, Math.round(H * k / s)); l[0].setSize(bw, bh); l[1].setSize(bw, bh); });
      const ratio = W / levels[0][1].width;
      bright.uniforms.off.value.set(ratio * 0.25 / W, ratio * 0.25 / H);
      final.uniforms.px.value.set(1 / W, 1 / H);
      final.uniforms.sharp.value = H > 1300 ? 0.35 : 0.22;
    },
    render(scene, camera) {
      tick();
      renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
      let src = sceneRT.texture;
      levels.forEach((l, i) => {
        if (i === 0) { bright.uniforms.t.value = src; draw(bright, l[1]); src = l[1].texture; }
        blur.uniforms.t.value = src; blur.uniforms.dir.value.set(1 / l[0].width, 0); draw(blur, l[0]);
        blur.uniforms.t.value = l[0].texture; blur.uniforms.dir.value.set(0, 1 / l[0].height); draw(blur, l[1]);
        src = l[1].texture;
      });
      final.uniforms.t.value = sceneRT.texture; final.uniforms.strength.value = api.strength;
      final.uniforms.b0.value = levels[0][1].texture; final.uniforms.b1.value = levels[1][1].texture; final.uniforms.b2.value = levels[2][1].texture;
      draw(final, null);
    }
  };
  return api;
};
