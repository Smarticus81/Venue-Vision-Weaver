/**
 * The explorable ceremony — a full 3D mountain wedding ceremony built
 * from the owner's prototype: wooden deck stage + aisle, folding chairs
 * with rolled blankets, an autumn floral arc, pines and golden aspens,
 * and a rugged mountain backdrop. Adapted to the landing page's craft
 * bar: art-directed into the three light moods (candles included),
 * instanced florals, orbit-on-desktop only (page scroll is sacred on
 * touch), presets with eased camera flights, IO-driven pause, DPR caps,
 * reduced-motion static frames, and full dispose.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MoodKey } from "./moods";

export type CeremonyView = "aisle" | "altar" | "aerial";

type MoodLight = {
  bg: number;
  fogDensity: number;
  ambient: number;
  ambientI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  sun: number;
  sunI: number;
  sunPos: [number, number, number];
  candleI: number;
};

const LIGHTING: Record<MoodKey, MoodLight> = {
  golden: {
    bg: 0xe8b184,
    fogDensity: 0.0042,
    ambient: 0xffe9d2,
    ambientI: 0.72,
    hemiSky: 0xffd9a8,
    hemiGround: 0xc98d5f,
    hemiI: 0.65,
    sun: 0xffcf9a,
    sunI: 1.35,
    sunPos: [-30, 16, 22],
    candleI: 0,
  },
  candlelit: {
    bg: 0x241423,
    fogDensity: 0.005,
    ambient: 0x9a6f78,
    ambientI: 0.58,
    hemiSky: 0x63455f,
    hemiGround: 0x4a3028,
    hemiI: 0.5,
    sun: 0xff9a55,
    sunI: 0.5,
    sunPos: [-20, 10, 25],
    candleI: 1,
  },
  moonlit: {
    bg: 0x0c1524,
    fogDensity: 0.0045,
    ambient: 0x51678a,
    ambientI: 0.58,
    hemiSky: 0x3f5c86,
    hemiGround: 0x242e40,
    hemiI: 0.55,
    sun: 0xbdd4f0,
    sunI: 0.95,
    sunPos: [18, 32, 15],
    candleI: 0.3,
  },
};

const VIEWS: Record<CeremonyView, { pos: [number, number, number]; look: [number, number, number] }> = {
  aisle: { pos: [0, 2.2, 8.5], look: [0, 1.2, -3] },
  // Standing at the arch, looking back down the aisle at the seats.
  altar: { pos: [0, 1.7, -2.6], look: [0, 0.8, 7] },
  aerial: { pos: [0, 12, 18], look: [0, 0, -2] },
};

export type CeremonySceneHandle = {
  setMood: (mood: MoodKey) => void;
  setView: (view: CeremonyView) => void;
  setActive: (active: boolean) => void;
  destroy: () => void;
};

function makeGlowTexture(size = 64): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCeremonyScene(
  canvas: HTMLCanvasElement,
  opts: { mood: MoodKey; reducedMotion: boolean },
): CeremonySceneHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }

  const { reducedMotion } = opts;
  const small = window.innerWidth < 768;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LIGHTING[opts.mood].bg);
  scene.fog = new THREE.FogExp2(LIGHTING[opts.mood].bg, LIGHTING[opts.mood].fogDensity);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(...VIEWS.aisle.pos);

  /* ————— lights ————— */
  const ambient = new THREE.AmbientLight(0xfff5ea, 0.6);
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0xe5c19d, 0.5);
  const sun = new THREE.DirectionalLight(0xfff8e7, 1.3);
  sun.castShadow = !small;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 150;
  const d = 25;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0005;
  scene.add(ambient, hemi, sun);

  /* ————— materials ————— */
  const woodDeck = new THREE.MeshStandardMaterial({ color: 0xc4a381, roughness: 0.7, metalness: 0.1 });
  const woodChair = new THREE.MeshStandardMaterial({ color: 0xdfb892, roughness: 0.6, metalness: 0.05 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0xf5f2eb, roughness: 0.9 });
  const blanket = new THREE.MeshStandardMaterial({ color: 0x8a99a8, roughness: 0.85 });
  const leafGreen = new THREE.MeshStandardMaterial({ color: 0x2e5a27, roughness: 0.8 });
  const leafDark = new THREE.MeshStandardMaterial({ color: 0x1b3b18, roughness: 0.8 });
  const leafGold = new THREE.MeshStandardMaterial({ color: 0xe0a21b, roughness: 0.7 });
  const leafYellow = new THREE.MeshStandardMaterial({ color: 0xf5c827, roughness: 0.7 });
  const flowerRed = new THREE.MeshStandardMaterial({ color: 0xb52d19, roughness: 0.6 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x4a3321, roughness: 0.9 });
  const plankLine = new THREE.MeshBasicMaterial({ color: 0x5a432e });

  /* ————— ground + deck ————— */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x9e8369, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  const stageShape = new THREE.Shape();
  stageShape.absarc(0, 0, 4.5, 0, Math.PI, false);
  stageShape.lineTo(-4.5, 0);
  stageShape.lineTo(4.5, 0);
  const stage = new THREE.Mesh(
    new THREE.ExtrudeGeometry(stageShape, {
      depth: 0.15,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.03,
      bevelThickness: 0.03,
    }),
    woodDeck,
  );
  stage.rotation.x = Math.PI / 2;
  stage.position.set(0, 0.15, -3);
  stage.receiveShadow = true;
  stage.castShadow = true;
  scene.add(stage);

  const aisle = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 10), woodDeck);
  aisle.position.set(0, 0.075, 2);
  aisle.receiveShadow = true;
  aisle.castShadow = true;
  scene.add(aisle);

  // Plank seams — stage seams shrink with the semicircle so nothing
  // overhangs the dirt.
  const plankGeoNarrow = new THREE.BoxGeometry(2.2, 0.01, 0.02);
  for (let z = -7.25; z <= 6.75; z += 0.25) {
    const onStage = z < -3;
    let line: THREE.Mesh;
    if (onStage) {
      const dz = z + 3;
      const half = Math.sqrt(Math.max(0, 4.5 * 4.5 - dz * dz));
      const width = Math.max(0, half * 2 - 0.25);
      if (width < 0.4) continue;
      line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.01, 0.02), plankLine);
    } else {
      line = new THREE.Mesh(plankGeoNarrow, plankLine);
    }
    line.position.set(0, 0.165, z);
    scene.add(line);
  }

  /* ————— floral arc (instanced per material) ————— */
  {
    const mats = [leafGold, leafYellow, leafGreen, leafDark, flowerRed];
    const bushCount = 180;
    const picks: number[][] = mats.map(() => []);
    for (let i = 0; i < bushCount; i++) {
      const r = Math.random();
      let m = 0;
      if (r < 0.35) m = 1;
      else if (r < 0.6) m = 2;
      else if (r < 0.8) m = 3;
      else if (r < 0.9) m = 4;
      picks[m].push(i);
    }
    const dummy = new THREE.Object3D();
    const baseGeo = new THREE.DodecahedronGeometry(1, 1);
    mats.forEach((mat, mi) => {
      const idxs = picks[mi];
      if (!idxs.length) return;
      const inst = new THREE.InstancedMesh(baseGeo, mat, idxs.length);
      idxs.forEach((i, j) => {
        const angle = (i / bushCount) * Math.PI * 0.85 + Math.PI * 0.075;
        const r = 3.8 + (Math.random() - 0.5) * 0.8;
        dummy.position.set(
          Math.cos(angle) * r,
          0.2 + Math.random() * 0.5,
          -3 - Math.sin(angle) * r * 0.6,
        );
        const size = 0.15 + Math.random() * 0.25;
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        dummy.scale.set(
          size * (1 + Math.random() * 0.5),
          size * (0.7 + Math.random() * 0.6),
          size * (1 + Math.random() * 0.5),
        );
        dummy.updateMatrix();
        inst.setMatrixAt(j, dummy.matrix);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      scene.add(inst);
    });
  }

  /* ————— chairs ————— */
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8);
  const seatGeo = new THREE.BoxGeometry(0.48, 0.04, 0.44);
  const frameGeo = new THREE.BoxGeometry(0.5, 0.03, 0.46);
  const backGeo = new THREE.BoxGeometry(0.48, 0.3, 0.03);
  const blanketGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.38, 12);

  function createChair(hasBlanket: boolean): THREE.Group {
    const chair = new THREE.Group();
    const fl = new THREE.Mesh(legGeo, woodChair);
    fl.position.set(-0.22, 0.35, 0.18);
    fl.rotation.x = -0.15;
    const fr = fl.clone();
    fr.position.x = 0.22;
    const bl = new THREE.Mesh(legGeo, woodChair);
    bl.position.set(-0.22, 0.45, -0.15);
    bl.rotation.x = 0.2;
    bl.scale.set(1, 1.2, 1);
    const br = bl.clone();
    br.position.x = 0.22;
    const seat = new THREE.Mesh(seatGeo, cushion);
    seat.position.set(0, 0.44, 0.02);
    const frame = new THREE.Mesh(frameGeo, woodChair);
    frame.position.set(0, 0.41, 0.02);
    const back = new THREE.Mesh(backGeo, woodChair);
    back.position.set(0, 0.8, -0.2);
    back.rotation.x = -0.15;
    chair.add(fl, fr, bl, br, seat, frame, back);
    if (hasBlanket) {
      const b = new THREE.Mesh(blanketGeo, blanket);
      b.rotation.z = Math.PI / 2;
      b.position.set(0, 0.51, 0.05);
      chair.add(b);
    }
    chair.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return chair;
  }

  {
    const rows = 4;
    const chairsPerRow = 4;
    const aisleWidth = 2.6;
    for (let r = 0; r < rows; r++) {
      const zPos = 1.2 + r * 1.15;
      for (let c = 0; c < chairsPerRow; c++) {
        const left = createChair(Math.random() > 0.4);
        left.position.set(-(aisleWidth / 2 + 0.35 + c * 0.65), 0, zPos);
        left.rotation.y = 0.18 - c * 0.03;
        scene.add(left);
        const right = createChair(Math.random() > 0.4);
        right.position.set(aisleWidth / 2 + 0.35 + c * 0.65, 0, zPos);
        right.rotation.y = -0.18 + c * 0.03;
        scene.add(right);
      }
    }
  }

  /* ————— trees ————— */
  function createPine(): THREE.Group {
    const tree = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 4, 8), trunk);
    t.position.y = 2;
    t.castShadow = true;
    tree.add(t);
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(2.2 * (1 - i / layers), 2.2, 8),
        Math.random() > 0.5 ? leafGreen : leafDark,
      );
      cone.position.y = 2.5 + i * 1.2;
      cone.castShadow = true;
      cone.receiveShadow = true;
      tree.add(cone);
    }
    return tree;
  }

  function createAspen(): THREE.Group {
    const tree = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 5, 8), trunk);
    t.position.y = 2.5;
    t.castShadow = true;
    tree.add(t);
    for (let i = 0; i < 12; i++) {
      const size = 0.8 + Math.random() * 0.8;
      const mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 1),
        Math.random() > 0.3 ? leafGold : leafYellow,
      );
      mesh.position.set((Math.random() - 0.5) * 1.8, 4 + Math.random() * 2.5, (Math.random() - 0.5) * 1.8);
      mesh.castShadow = true;
      tree.add(mesh);
    }
    return tree;
  }

  const treeSpecs: { x: number; z: number; type: "pine" | "aspen"; scale: number }[] = [
    { x: -9, z: -2, type: "pine", scale: 1.3 },
    { x: -11, z: 2, type: "pine", scale: 1.5 },
    { x: -7.5, z: -6, type: "aspen", scale: 1.2 },
    { x: -12, z: -7, type: "pine", scale: 1.8 },
    { x: 9, z: -1, type: "pine", scale: 1.4 },
    { x: 11, z: 3, type: "aspen", scale: 1.3 },
    { x: 8, z: -5, type: "pine", scale: 1.2 },
    { x: 13, z: -6, type: "pine", scale: 1.7 },
    { x: -4, z: -8, type: "pine", scale: 1.1 },
    { x: -2, z: -9, type: "pine", scale: 1.3 },
    { x: 1.5, z: -8.5, type: "pine", scale: 1.2 },
    { x: 4.5, z: -8, type: "pine", scale: 1.4 },
  ];
  for (const p of treeSpecs) {
    const t = p.type === "pine" ? createPine() : createAspen();
    t.position.set(p.x, 0, p.z);
    t.scale.setScalar(p.scale);
    scene.add(t);
  }

  /* ————— mountains ————— */
  {
    for (let i = 0; i < 7; i++) {
      const height = 35 + Math.random() * 20;
      const radius = 25 + Math.random() * 15;
      const geo = new THREE.ConeGeometry(radius, height, 7, 8);
      const pos = geo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        if (pos.getY(j) < height / 2) {
          pos.setX(j, pos.getX(j) + (Math.random() - 0.5) * 3);
          pos.setZ(j, pos.getZ(j) + (Math.random() - 0.5) * 3);
        }
      }
      geo.computeVertexNormals();
      const mountain = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? 0x5a6977 : 0x485868,
          roughness: 0.95,
          metalness: 0.05,
        }),
      );
      mountain.position.set(-70 + i * 22 + (Math.random() - 0.5) * 10, height / 2 - 8, -50 - Math.random() * 20);
      scene.add(mountain);
    }

    const ridgeGeo = new THREE.PlaneGeometry(160, 30, 40, 10);
    const rPos = ridgeGeo.attributes.position;
    for (let i = 0; i < rPos.count; i++) {
      rPos.setY(i, rPos.getY(i) + Math.sin(i * 0.4) * 2.5 + (Math.random() - 0.5) * 1.5);
    }
    ridgeGeo.computeVertexNormals();
    const ridge = new THREE.Mesh(ridgeGeo, new THREE.MeshStandardMaterial({ color: 0x3d5240, roughness: 0.9 }));
    ridge.position.set(0, 5, -35);
    scene.add(ridge);
  }

  /* ————— candles (aisle lanterns + arch cluster) ————— */
  const glowTex = makeGlowTexture();
  const candleSprites: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; phase: number }[] = [];
  {
    const spots: [number, number, number][] = [];
    for (let z = 0.6; z <= 6.4; z += 1.15) {
      spots.push([-1.4, 0.35, z], [1.4, 0.35, z]);
    }
    for (let i = 0; i < 7; i++) {
      const angle = (i / 6) * Math.PI * 0.7 + Math.PI * 0.15;
      spots.push([Math.cos(angle) * 3.4, 0.75 + Math.random() * 0.4, -3 - Math.sin(angle) * 2.2]);
    }
    for (const [x, y, z] of spots) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffb46a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(0.55);
      scene.add(sprite);
      candleSprites.push({ sprite, mat, phase: Math.random() * Math.PI * 2 });
    }
  }

  /* ————— controls ————— */
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.05;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.target.set(...VIEWS.aisle.look);
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.25;
  if (!finePointer) {
    // Touch: presets drive the camera; one finger keeps scrolling the page.
    controls.enableRotate = false;
    canvas.style.touchAction = "pan-y";
  }
  const stopAutoRotate = () => {
    controls.autoRotate = false;
  };
  controls.addEventListener("start", stopAutoRotate);
  controls.update();

  /* ————— mood lerp state ————— */
  const cur = {
    bg: new THREE.Color(LIGHTING[opts.mood].bg),
    fogDensity: LIGHTING[opts.mood].fogDensity,
    ambient: new THREE.Color(LIGHTING[opts.mood].ambient),
    ambientI: LIGHTING[opts.mood].ambientI,
    hemiSky: new THREE.Color(LIGHTING[opts.mood].hemiSky),
    hemiGround: new THREE.Color(LIGHTING[opts.mood].hemiGround),
    hemiI: LIGHTING[opts.mood].hemiI,
    sun: new THREE.Color(LIGHTING[opts.mood].sun),
    sunI: LIGHTING[opts.mood].sunI,
    sunPos: new THREE.Vector3(...LIGHTING[opts.mood].sunPos),
    candleI: LIGHTING[opts.mood].candleI,
  };
  let targetMood = LIGHTING[opts.mood];

  function applyLighting() {
    (scene.background as THREE.Color).copy(cur.bg);
    (scene.fog as THREE.FogExp2).color.copy(cur.bg);
    (scene.fog as THREE.FogExp2).density = cur.fogDensity;
    ambient.color.copy(cur.ambient);
    ambient.intensity = cur.ambientI;
    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGround);
    hemi.intensity = cur.hemiI;
    sun.color.copy(cur.sun);
    sun.intensity = cur.sunI;
    sun.position.copy(cur.sunPos);
  }
  applyLighting();

  /* ————— camera flights ————— */
  let flight: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromLook: THREE.Vector3;
    toLook: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;

  function flyTo(view: CeremonyView) {
    const v = VIEWS[view];
    if (reducedMotion) {
      camera.position.set(...v.pos);
      controls.target.set(...v.look);
      controls.update();
      renderOnce();
      return;
    }
    flight = {
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(...v.pos),
      fromLook: controls.target.clone(),
      toLook: new THREE.Vector3(...v.look),
      start: performance.now(),
      duration: 1100,
    };
  }

  /* ————— loop ————— */
  let disposed = false;
  let active = true;
  let raf = 0;
  const tmpColor = new THREE.Color();

  function tick() {
    const now = performance.now();
    const t = now / 1000;

    // Mood lerp
    const k = reducedMotion ? 1 : 0.055;
    cur.bg.lerp(tmpColor.setHex(targetMood.bg), k);
    cur.fogDensity += (targetMood.fogDensity - cur.fogDensity) * k;
    cur.ambient.lerp(tmpColor.setHex(targetMood.ambient), k);
    cur.ambientI += (targetMood.ambientI - cur.ambientI) * k;
    cur.hemiSky.lerp(tmpColor.setHex(targetMood.hemiSky), k);
    cur.hemiGround.lerp(tmpColor.setHex(targetMood.hemiGround), k);
    cur.hemiI += (targetMood.hemiI - cur.hemiI) * k;
    cur.sun.lerp(tmpColor.setHex(targetMood.sun), k);
    cur.sunI += (targetMood.sunI - cur.sunI) * k;
    cur.sunPos.lerp(new THREE.Vector3(...targetMood.sunPos), k);
    cur.candleI += (targetMood.candleI - cur.candleI) * k;
    applyLighting();

    // Candle flicker
    for (const c of candleSprites) {
      const fl = reducedMotion ? 0.85 : 0.65 + 0.35 * Math.abs(Math.sin(t * 3.4 + c.phase));
      c.mat.opacity = cur.candleI * fl * 0.85;
    }

    // Camera flight
    if (flight) {
      const p = Math.min((now - flight.start) / flight.duration, 1);
      const e = 0.5 - Math.cos(p * Math.PI) / 2;
      camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
      controls.target.lerpVectors(flight.fromLook, flight.toLook, e);
      if (p >= 1) flight = null;
    }

    controls.update();
    renderer.render(scene, camera);
  }

  function loop() {
    if (disposed || !active) return;
    tick();
    raf = requestAnimationFrame(loop);
  }

  function renderOnce() {
    if (disposed) return;
    tick();
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (reducedMotion) renderOnce();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  function onVisibility() {
    if (disposed || reducedMotion) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (active) {
      raf = requestAnimationFrame(loop);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  if (reducedMotion) {
    // Static: render on demand only (mood/view changes, drags disabled).
    renderOnce();
  } else {
    raf = requestAnimationFrame(loop);
  }

  return {
    setMood(mood: MoodKey) {
      targetMood = LIGHTING[mood];
      if (reducedMotion) renderOnce();
    },
    setView(view: CeremonyView) {
      flyTo(view);
    },
    setActive(next: boolean) {
      if (disposed || reducedMotion) {
        active = next;
        return;
      }
      if (next && !active) {
        active = true;
        raf = requestAnimationFrame(loop);
      } else if (!next && active) {
        active = false;
        cancelAnimationFrame(raf);
      }
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      controls.removeEventListener("start", stopAutoRotate);
      controls.dispose();
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) geos.add(mesh.geometry as THREE.BufferGeometry);
        if (mesh.material) {
          const m = mesh.material;
          if (Array.isArray(m)) m.forEach((mm) => mats.add(mm));
          else mats.add(m as THREE.Material);
        }
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      glowTex.dispose();
      renderer.dispose();
    },
  };
}
