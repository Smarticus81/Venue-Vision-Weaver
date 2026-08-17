/**
 * The venue at dusk — a procedural three.js evening built from layered
 * planes, points, and shaders (no textures fetched, no video): gradient
 * sky with a sun/moon disc, sagging strings of glowing bulbs, candle
 * bokeh, drifting petals (mid + soft foreground for lens bleed), and
 * slow mist. Three light moods; the page re-lights live.
 *
 * Palette hexes mirror the .theme-dusk[data-mood] blocks in index.css —
 * keep the two in sync when tuning.
 *
 * Discipline: DPR capped at 2, RAF paused when the tab hides, static
 * single-frame render under reduced motion, full dispose on destroy.
 */
import * as THREE from "three";
import type { MoodKey } from "./moods";

type MoodPalette = {
  skyTop: number;
  skyMid: number;
  skyLow: number;
  glow: number;
  disc: number;
  discPos: [number, number];
  discSize: number;
  discSoft: number;
  discInt: number;
  bulb: number;
  bulbInt: number;
  candle: number;
  candleInt: number;
  petal: number;
  mist: number;
  mistOpacity: number;
};

const PALETTES: Record<MoodKey, MoodPalette> = {
  golden: {
    skyTop: 0x241b3d,
    skyMid: 0x67284a,
    skyLow: 0xc25c2a,
    glow: 0xf7a54b,
    disc: 0xffc37d,
    discPos: [0.78, 0.34],
    discSize: 0.072,
    discSoft: 5.0,
    discInt: 0.9,
    bulb: 0xffd9a0,
    bulbInt: 0.55,
    candle: 0xffb46a,
    candleInt: 0.5,
    petal: 0xf6c3b2,
    mist: 0xd88a5c,
    mistOpacity: 0.09,
  },
  candlelit: {
    skyTop: 0x120d20,
    skyMid: 0x2c1526,
    skyLow: 0x55301b,
    glow: 0xe8873c,
    disc: 0xffb46a,
    discPos: [0.5, 0.0],
    discSize: 0.2,
    discSoft: 4.0,
    discInt: 0.28,
    bulb: 0xffc97a,
    bulbInt: 1.0,
    candle: 0xffab54,
    candleInt: 1.0,
    petal: 0xe8a6b6,
    mist: 0x9a5a3c,
    mistOpacity: 0.08,
  },
  moonlit: {
    skyTop: 0x070b16,
    skyMid: 0x131c30,
    skyLow: 0x29405c,
    glow: 0x6f94bd,
    disc: 0xeef4ff,
    discPos: [0.85, 0.8],
    discSize: 0.038,
    discSoft: 8.0,
    discInt: 1.1,
    bulb: 0xcfe4f8,
    bulbInt: 0.8,
    candle: 0xa8c8e8,
    candleInt: 0.55,
    petal: 0xb9c5df,
    mist: 0x8aa4c8,
    mistOpacity: 0.12,
  },
};

export type VenueSceneHandle = {
  setMood: (mood: MoodKey) => void;
  setScroll: (progress: number) => void;
  setPointer: (nx: number, ny: number) => void;
  destroy: () => void;
};

/* ————— procedural textures (canvas-drawn, nothing fetched) ————— */

function makeGlowTexture(size = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePetalTexture(blurPx: number): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  if ("filter" in ctx) ctx.filter = `blur(${blurPx}px)`;
  const g = ctx.createRadialGradient(0, -6, 4, 0, 0, 52);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.75, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -44);
  ctx.bezierCurveTo(32, -32, 28, 22, 0, 48);
  ctx.bezierCurveTo(-28, 22, -32, -32, 0, -44);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMistTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  if ("filter" in ctx) ctx.filter = "blur(18px)";
  for (let i = 0; i < 9; i++) {
    const x = 20 + Math.random() * (w - 40);
    const y = 30 + Math.random() * (h - 60);
    const r = 22 + Math.random() * 42;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ————— sky shader ————— */

const SKY_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uLow;
  uniform vec3 uGlow;
  uniform vec3 uDisc;
  uniform vec2 uDiscPos;
  uniform float uDiscSize;
  uniform float uDiscSoft;
  uniform float uDiscInt;
  uniform float uDim;
  uniform float uAspect;

  // cheap hash-based grain so gradients never band
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float t = clamp(vUv.y, 0.0, 1.0);
    vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.55, t));
    col = mix(col, uTop, smoothstep(0.42, 1.0, t));
    col += uGlow * pow(1.0 - t, 3.0) * 0.5;

    vec2 p = vec2((vUv.x - uDiscPos.x) * uAspect, vUv.y - uDiscPos.y);
    float d = length(p);
    float disc = 1.0 - smoothstep(uDiscSize * 0.82, uDiscSize, d);
    float halo = exp(-d * uDiscSoft);
    col += uDisc * (disc * 0.95 + halo * 0.5) * uDiscInt;

    col *= 1.0 - uDim;
    col += (hash(vUv * 913.7) - 0.5) * 0.012;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ————— scene ————— */

export function createVenueScene(
  canvas: HTMLCanvasElement,
  opts: { mood: MoodKey; reducedMotion: boolean },
): VenueSceneHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  const { reducedMotion } = opts;
  const small = window.innerWidth < 768;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.autoClear = false;

  /* Sky pass */
  const skyScene = new THREE.Scene();
  const skyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const skyUniforms = {
    uTop: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uLow: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uDisc: { value: new THREE.Color() },
    uDiscPos: { value: new THREE.Vector2() },
    uDiscSize: { value: 0.1 },
    uDiscSoft: { value: 5 },
    uDiscInt: { value: 1 },
    uDim: { value: 0 },
    uAspect: { value: 1 },
  };
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: skyUniforms,
    depthTest: false,
    depthWrite: false,
  });
  const skyGeo = new THREE.PlaneGeometry(2, 2);
  skyScene.add(new THREE.Mesh(skyGeo, skyMat));

  /* Main pass */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80);
  camera.position.set(0, 0, 12);

  const glowTex = makeGlowTexture();
  const petalTex = makePetalTexture(2);
  const petalSoftTex = makePetalTexture(9);
  const mistTex = makeMistTexture();

  /* String lights: sagging strands of glowing bulbs + a faint wire. */
  type Strand = { points: THREE.Points; wire: THREE.Line; phases: Float32Array; colors: Float32Array };
  const strands: Strand[] = [];
  const strandSpecs = [
    { y: 4.6, z: -9, sag: 1.7, n: 30 },
    { y: 3.4, z: -5.5, sag: 2.1, n: 26 },
    { y: 5.2, z: -13, sag: 1.3, n: 34 },
  ];
  const bulbMat = new THREE.PointsMaterial({
    size: 0.34,
    map: glowTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    sizeAttenuation: true,
  });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
  for (const spec of strandSpecs) {
    const positions = new Float32Array(spec.n * 3);
    const colors = new Float32Array(spec.n * 3);
    const phases = new Float32Array(spec.n);
    for (let i = 0; i < spec.n; i++) {
      const t = i / (spec.n - 1);
      positions[i * 3] = -16 + t * 32;
      positions[i * 3 + 1] = spec.y - Math.sin(t * Math.PI) * spec.sag;
      positions[i * 3 + 2] = spec.z;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geo, bulbMat);
    const wire = new THREE.Line(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3)),
      wireMat,
    );
    scene.add(points, wire);
    strands.push({ points, wire, phases, colors });
  }

  /* Candle bokeh: warm points low in frame, receding into depth. */
  const candleCount = small ? 70 : 130;
  const candlePos = new Float32Array(candleCount * 3);
  const candleCol = new Float32Array(candleCount * 3);
  const candlePhase = new Float32Array(candleCount);
  for (let i = 0; i < candleCount; i++) {
    candlePos[i * 3] = (Math.random() - 0.5) * 34;
    candlePos[i * 3 + 1] = -4.6 + Math.random() * 3.4;
    candlePos[i * 3 + 2] = -2 - Math.random() * 26;
    candlePhase[i] = Math.random() * Math.PI * 2;
  }
  const candleGeo = new THREE.BufferGeometry();
  candleGeo.setAttribute("position", new THREE.BufferAttribute(candlePos, 3));
  candleGeo.setAttribute("color", new THREE.BufferAttribute(candleCol, 3));
  const candleMat = new THREE.PointsMaterial({
    size: 0.5,
    map: glowTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    sizeAttenuation: true,
  });
  const candles = new THREE.Points(candleGeo, candleMat);
  scene.add(candles);

  /* Petals: mid-field instanced planes + a few huge soft ones near the
     lens for the cinematic frame-bleed. */
  type PetalField = {
    mesh: THREE.InstancedMesh;
    mat: THREE.MeshBasicMaterial;
    state: { x: number; y: number; z: number; fall: number; swayAmp: number; swayPhase: number; spinX: number; spinY: number; spinZ: number; scale: number }[];
    topY: number;
    bottomY: number;
  };
  const dummy = new THREE.Object3D();

  function makePetalField(count: number, tex: THREE.Texture, opacity: number, near: boolean): PetalField {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(near ? 2.2 : 0.26, near ? 2.8 : 0.34);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const state = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * (near ? 26 : 22),
      y: -8 + Math.random() * 18,
      z: near ? 5 + Math.random() * 4 : -2 - Math.random() * 12,
      fall: (near ? 0.25 : 0.4) + Math.random() * (near ? 0.2 : 0.5),
      swayAmp: 0.4 + Math.random() * 0.9,
      swayPhase: Math.random() * Math.PI * 2,
      spinX: (Math.random() - 0.5) * 1.6,
      spinY: (Math.random() - 0.5) * 1.6,
      spinZ: (Math.random() - 0.5) * 1.2,
      scale: 0.7 + Math.random() * 0.75,
    }));
    scene.add(mesh);
    return { mesh, mat, state, topY: 10, bottomY: -9 };
  }

  const petalsMid = makePetalField(small ? 55 : 100, petalTex, 0.85, false);
  const petalsNear = makePetalField(small ? 4 : 7, petalSoftTex, 0.2, true);

  /* Mist: broad soft planes drifting sideways. */
  const mistPlanes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; speed: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: mistTex,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(38, 9), mat);
    mesh.position.set((Math.random() - 0.5) * 10, -3.2 + i * 1.4, -16 - i * 5);
    scene.add(mesh);
    mistPlanes.push({ mesh, mat, speed: 0.12 + i * 0.05 });
  }

  /* ————— mood state (lerped every frame) ————— */

  const current = {
    skyTop: new THREE.Color(),
    skyMid: new THREE.Color(),
    skyLow: new THREE.Color(),
    glow: new THREE.Color(),
    disc: new THREE.Color(),
    discPos: new THREE.Vector2(),
    discSize: 0.1,
    discSoft: 5,
    discInt: 1,
    bulb: new THREE.Color(),
    bulbInt: 1,
    candle: new THREE.Color(),
    candleInt: 1,
    petal: new THREE.Color(),
    mist: new THREE.Color(),
    mistOpacity: 0.08,
  };
  const target = { ...current, ...{} };
  // target needs its own vector/color instances:
  target.skyTop = new THREE.Color();
  target.skyMid = new THREE.Color();
  target.skyLow = new THREE.Color();
  target.glow = new THREE.Color();
  target.disc = new THREE.Color();
  target.discPos = new THREE.Vector2();
  target.bulb = new THREE.Color();
  target.candle = new THREE.Color();
  target.petal = new THREE.Color();
  target.mist = new THREE.Color();

  function applyPalette(dst: typeof current, p: MoodPalette) {
    dst.skyTop.setHex(p.skyTop);
    dst.skyMid.setHex(p.skyMid);
    dst.skyLow.setHex(p.skyLow);
    dst.glow.setHex(p.glow);
    dst.disc.setHex(p.disc);
    dst.discPos.set(p.discPos[0], p.discPos[1]);
    dst.discSize = p.discSize;
    dst.discSoft = p.discSoft;
    dst.discInt = p.discInt;
    dst.bulb.setHex(p.bulb);
    dst.bulbInt = p.bulbInt;
    dst.candle.setHex(p.candle);
    dst.candleInt = p.candleInt;
    dst.petal.setHex(p.petal);
    dst.mist.setHex(p.mist);
    dst.mistOpacity = p.mistOpacity;
  }

  applyPalette(current, PALETTES[opts.mood]);
  applyPalette(target, PALETTES[opts.mood]);

  let scroll = 0;
  const pointer = { x: 0, y: 0 };
  let disposed = false;
  let raf = 0;
  let lastT = performance.now();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    skyUniforms.uAspect.value = w / h;
  }
  resize();
  window.addEventListener("resize", onResize);
  function onResize() {
    resize();
    if (reducedMotion) renderFrame(0.016);
  }

  function lerpState(dt: number) {
    const k = 1 - Math.exp(-3.2 * dt);
    current.skyTop.lerp(target.skyTop, k);
    current.skyMid.lerp(target.skyMid, k);
    current.skyLow.lerp(target.skyLow, k);
    current.glow.lerp(target.glow, k);
    current.disc.lerp(target.disc, k);
    current.discPos.lerp(target.discPos, k);
    current.discSize += (target.discSize - current.discSize) * k;
    current.discSoft += (target.discSoft - current.discSoft) * k;
    current.discInt += (target.discInt - current.discInt) * k;
    current.bulb.lerp(target.bulb, k);
    current.bulbInt += (target.bulbInt - current.bulbInt) * k;
    current.candle.lerp(target.candle, k);
    current.candleInt += (target.candleInt - current.candleInt) * k;
    current.petal.lerp(target.petal, k);
    current.mist.lerp(target.mist, k);
    current.mistOpacity += (target.mistOpacity - current.mistOpacity) * k;
  }

  const tmpColor = new THREE.Color();

  function renderFrame(dt: number) {
    const t = performance.now() / 1000;
    lerpState(reducedMotion ? 1 : dt);

    // Sky
    skyUniforms.uTop.value.copy(current.skyTop);
    skyUniforms.uMid.value.copy(current.skyMid);
    skyUniforms.uLow.value.copy(current.skyLow);
    skyUniforms.uGlow.value.copy(current.glow);
    skyUniforms.uDisc.value.copy(current.disc);
    skyUniforms.uDiscPos.value.set(current.discPos.x, current.discPos.y - scroll * 0.1);
    skyUniforms.uDiscSize.value = current.discSize;
    skyUniforms.uDiscSoft.value = current.discSoft;
    skyUniforms.uDiscInt.value = current.discInt;
    // Darkest through the middle of the page, easing back for the offer.
    skyUniforms.uDim.value = 0.32 * Math.sin(Math.min(1, Math.max(0, scroll)) * Math.PI);

    // Bulb twinkle
    for (const strand of strands) {
      const n = strand.phases.length;
      for (let i = 0; i < n; i++) {
        const tw = reducedMotion ? 0.9 : 0.72 + 0.28 * Math.sin(t * 2.1 + strand.phases[i]);
        tmpColor.copy(current.bulb).multiplyScalar(tw * current.bulbInt);
        strand.colors[i * 3] = tmpColor.r;
        strand.colors[i * 3 + 1] = tmpColor.g;
        strand.colors[i * 3 + 2] = tmpColor.b;
      }
      const attr = strand.points.geometry.getAttribute("color") as THREE.BufferAttribute;
      (attr.array as Float32Array).set(strand.colors);
      attr.needsUpdate = true;
      if (!reducedMotion) strand.points.rotation.z = Math.sin(t * 0.28 + strand.phases[0]) * 0.008;
    }

    // Candle flicker + slow drift
    {
      const posAttr = candleGeo.getAttribute("position") as THREE.BufferAttribute;
      const colAttr = candleGeo.getAttribute("color") as THREE.BufferAttribute;
      const pos = posAttr.array as Float32Array;
      const col = colAttr.array as Float32Array;
      for (let i = 0; i < candleCount; i++) {
        if (!reducedMotion) {
          pos[i * 3 + 1] += Math.sin(t * 0.5 + candlePhase[i]) * 0.0009;
        }
        const fl = reducedMotion ? 0.85 : 0.6 + 0.4 * Math.abs(Math.sin(t * 3.1 + candlePhase[i] * 2.0));
        tmpColor.copy(current.candle).multiplyScalar(fl * current.candleInt);
        col[i * 3] = tmpColor.r;
        col[i * 3 + 1] = tmpColor.g;
        col[i * 3 + 2] = tmpColor.b;
      }
      if (!reducedMotion) posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    // Petals
    const wind = 1 + scroll * 0.8;
    for (const field of [petalsMid, petalsNear]) {
      field.mat.color.copy(current.petal);
      const s = field.state;
      for (let i = 0; i < s.length; i++) {
        const p = s[i];
        if (!reducedMotion) {
          p.y -= p.fall * dt * wind;
          p.x += Math.sin(t * 0.6 + p.swayPhase) * dt * p.swayAmp;
          if (p.y < field.bottomY) {
            p.y = field.topY;
            p.x = (Math.random() - 0.5) * 24;
          }
        }
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(
          t * p.spinX + p.swayPhase,
          t * p.spinY + p.swayPhase * 1.7,
          t * p.spinZ + p.swayPhase * 0.6,
        );
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        field.mesh.setMatrixAt(i, dummy.matrix);
      }
      field.mesh.instanceMatrix.needsUpdate = true;
    }

    // Mist drift
    for (const m of mistPlanes) {
      m.mat.color.copy(current.mist);
      m.mat.opacity = current.mistOpacity;
      if (!reducedMotion) {
        m.mesh.position.x += m.speed * dt;
        if (m.mesh.position.x > 24) m.mesh.position.x = -24;
      }
    }

    // Camera: pointer parallax + gentle descent with scroll.
    const cx = pointer.x * 0.55;
    const cy = -pointer.y * 0.32 - scroll * 1.4;
    camera.position.x += (cx - camera.position.x) * (reducedMotion ? 1 : 0.045);
    camera.position.y += (cy - camera.position.y) * (reducedMotion ? 1 : 0.045);
    camera.lookAt(0, camera.position.y * 0.4, -8);

    renderer.clear(true, true);
    renderer.render(skyScene, skyCamera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  function loop() {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    renderFrame(dt);
    raf = requestAnimationFrame(loop);
  }

  function onVisibility() {
    if (disposed || reducedMotion) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  if (reducedMotion) {
    renderFrame(0.016);
  } else {
    raf = requestAnimationFrame(loop);
  }

  return {
    setMood(mood: MoodKey) {
      applyPalette(target, PALETTES[mood]);
      if (reducedMotion && !disposed) renderFrame(0.016);
    },
    setScroll(progress: number) {
      scroll = progress;
      if (reducedMotion && !disposed) renderFrame(0.016);
    },
    setPointer(nx: number, ny: number) {
      pointer.x = nx;
      pointer.y = ny;
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const strand of strands) {
        strand.points.geometry.dispose();
        strand.wire.geometry.dispose();
      }
      candleGeo.dispose();
      petalsMid.mesh.geometry.dispose();
      petalsNear.mesh.geometry.dispose();
      for (const m of mistPlanes) m.mesh.geometry.dispose();
      bulbMat.dispose();
      wireMat.dispose();
      candleMat.dispose();
      petalsMid.mat.dispose();
      petalsNear.mat.dispose();
      for (const m of mistPlanes) m.mat.dispose();
      skyMat.dispose();
      skyGeo.dispose();
      glowTex.dispose();
      petalTex.dispose();
      petalSoftTex.dispose();
      mistTex.dispose();
      renderer.dispose();
    },
  };
}
