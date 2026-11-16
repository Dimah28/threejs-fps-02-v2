// Ironworks Protocol — the map: "Ironworks District", a dusk industrial yard.
// 56 x 40 m, two bomb sites (A Furnace Hall north-east, B Crane Yard south-east),
// three lanes, and an elevated catwalk across mid with ramps at both ends, so
// height is a real tactical choice. All textures are painted on canvas at load.

import * as THREE from 'three';
import { concreteTexture, metalTexture, hazardTexture } from './palette.js';
import { mulberry32 } from './util.js';

export const MAP = {
  minX: -28, maxX: 28, minZ: -20, maxZ: 20,
  catwalkY: 3.2,
  sites: {
    A: { id: 'A', name: 'Furnace Hall', x0: 16, x1: 24, z0: -16, z1: -8, cx: 20, cz: -12 },
    B: { id: 'B', name: 'Crane Yard', x0: 16, x1: 24, z0: 8, z1: 16, cx: 20, cz: 12 },
  },
  sentinelSpawns: [[-25, -8], [-25, -4], [-25, 0], [-25, 4], [-25, 8]],
  viperSpawns: [[25, -8], [25, -4], [25, 0], [25, 4], [25, 8]],
};

// Ground height at (x, z): the catwalk deck and its ramps, otherwise the floor.
export function groundAt(x, z) {
  if (z >= -2.2 && z <= 2.2) {
    if (x >= -12 && x <= 12) return MAP.catwalkY;
    if (x > -17 && x < -12) return MAP.catwalkY * ((x + 17) / 5);
    if (x > 12 && x < 17) return MAP.catwalkY * ((17 - x) / 5);
  }
  return 0;
}

// Waypoint graph the bots path over. Nodes are {x, z}; edges are index pairs.
const NODES = [
  [-25, 0], [-20, -12], [-20, 0], [-20, 12],          // 0-3  west
  [-12, -12], [-12, 0], [-12, 12],                    // 4-6  mid-west
  [-12, 0], [0, 0], [12, 0],                           // 7-9  catwalk (7 = west top)
  [12, -12], [12, 0], [12, 12],                       // 10-12 mid-east
  [-4, -14], [6, -14], [14, -14],                      // 13-15 north lane
  [-4, 14], [6, 14], [14, 14],                         // 16-18 south lane
  [16, -12], [20, -12],                               // 19-20 site A
  [16, 12], [20, 12],                                 // 21-22 site B
  [20, -4], [20, 4],                                  // 23-24 east approach
  [25, 0], [22, -8], [22, 8],                         // 25-27 viper side
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6], [1, 13], [3, 16],
  [4, 13], [6, 16], [4, 5], [5, 6], [5, 7], [7, 8], [8, 9], [9, 11],
  [10, 13], [12, 16], [10, 14], [12, 17], [13, 14], [14, 15], [16, 17], [17, 18],
  [15, 19], [15, 23], [18, 21], [18, 24], [19, 20], [21, 22], [23, 19], [24, 21],
  [23, 26], [24, 27], [20, 26], [22, 27], [25, 26], [25, 27], [10, 11], [11, 12],
  [14, 10], [17, 12], [2, 0],
];

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// BFS shortest path (list of node indices) from node a to node b.
export function findPath(a, b) {
  if (a === b) return [a];
  const prev = new Array(NODES.length).fill(-1);
  const queue = [a];
  prev[a] = a;
  while (queue.length) {
    const n = queue.shift();
    for (const [u, v] of EDGES) {
      const m = u === n ? v : v === n ? u : -1;
      if (m >= 0 && prev[m] === -1) {
        prev[m] = n;
        if (m === b) {
          const path = [b];
          let cur = b;
          while (cur !== a) { cur = prev[cur]; path.unshift(cur); }
          return path;
        }
        queue.push(m);
      }
    }
  }
  return [a];
}

export function nodePos(i) { return { x: NODES[i][0], z: NODES[i][1] }; }

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function letterSprite(THREE, letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,16,12,0.55)';
  ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 3.2, 1);
  return sprite;
}

export function buildWorld(THREE, rng) {
  const group = new THREE.Group();
  const colliders = [];
  const addCollider = (x0, x1, z0, z1, y0, y1) => {
    colliders.push({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 });
  };

  const concrete = concreteTexture(THREE, rng);
  concrete.repeat.set(14, 10);
  const metal = metalTexture(THREE, rng);
  const metalDark = metalTexture(THREE, rng, '#4a4440');
  const hazard = hazardTexture(THREE);
  hazard.repeat.set(6, 1);

  const floorMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95, metalness: 0.02 });
  const wallMat = new THREE.MeshStandardMaterial({ map: metal, roughness: 0.7, metalness: 0.45 });
  const wallDark = new THREE.MeshStandardMaterial({ map: metalDark, roughness: 0.75, metalness: 0.4 });
  const tealMat = new THREE.MeshStandardMaterial({ color: 0x2e6f6a, roughness: 0.6, metalness: 0.5 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x8a4b2a, roughness: 0.8, metalness: 0.35 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.55, metalness: 0.6 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a6a4e, roughness: 0.9, metalness: 0.05 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8, metalness: 0.1 });
  const deckMat = new THREE.MeshStandardMaterial({ map: metalDark, roughness: 0.65, metalness: 0.55 });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(56, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Perimeter walls (height 4)
  const wallH = 4, wallT = 1;
  const walls = [
    [0, -20.5, 58, wallT], [0, 20.5, 58, wallT],
    [-28.5, 0, wallT, 42], [28.5, 0, wallT, 42],
  ];
  for (const [x, z, w, d] of walls) {
    const m = box(w, wallH, d, wallMat);
    m.position.set(x, wallH / 2, z);
    group.add(m);
  }
  addCollider(-29, 29, -21, -20, 0, 4);
  addCollider(-29, 29, 20, 21, 0, 4);
  addCollider(-29, -28, -21, 21, 0, 4);
  addCollider(28, 29, -21, 21, 0, 4);

  // Catwalk deck + ramps + rails + pillars
  const deck = box(24, 0.3, 4.4, deckMat);
  deck.position.set(0, MAP.catwalkY - 0.15, 0);
  group.add(deck);
  addCollider(-12, 12, -2.2, 2.2, 3.05, 3.2); // deck slab (blocks bullets under it? no: minY 3.05 keeps ground clear)
  for (const side of [-1, 1]) {
    const ramp = box(5, 0.3, 4.4, deckMat);
    ramp.position.set(side * 14.5, MAP.catwalkY / 2 - 0.15, 0);
    ramp.rotation.z = side * -Math.atan2(MAP.catwalkY, 5);
    group.add(ramp);
    // rails along the deck
    const rail = box(24, 0.9, 0.12, steelMat);
    rail.position.set(0, MAP.catwalkY + 0.45, side * 2.14);
    group.add(rail);
    addCollider(-12, 12, side * 2.08, side * 2.2, 3.2, 4.1);
    // ramp side rails
    const rrail = box(5, 0.9, 0.12, steelMat);
    rrail.position.set(side * 14.5, MAP.catwalkY / 2 + 0.45, side * 2.14);
    rrail.rotation.z = side * -Math.atan2(MAP.catwalkY, 5);
    group.add(rrail);
  }
  for (const px of [-8, 0, 8]) {
    const pillar = box(0.7, MAP.catwalkY, 0.7, steelMat);
    pillar.position.set(px, MAP.catwalkY / 2, 0);
    group.add(pillar);
    addCollider(px - 0.35, px + 0.35, -0.35, 0.35, 0, MAP.catwalkY);
  }

  // Mid hall pillars (cover at the crossroads)
  for (const [px, pz] of [[-6, -6], [-6, 6], [6, -6], [6, 6]]) {
    const p = box(1, 4, 1, wallDark);
    p.position.set(px, 2, pz);
    group.add(p);
    addCollider(px - 0.5, px + 0.5, pz - 0.5, pz + 0.5, 0, 4);
  }

  // Containers and crates — the cover that makes lanes readable.
  const covers = [
    // [x, z, w, h, d, mat, hazardTrim]
    [-16, -8, 6, 2.4, 2.4, tealMat, true],
    [-16, 8, 6, 2.4, 2.4, rustMat, true],
    [4, -8, 4, 2.4, 2.4, steelMat, false],
    [4, 8, 4, 2.4, 2.4, tealMat, false],
    [10, -16, 2.4, 2.4, 6, rustMat, true],
    [10, 16, 2.4, 2.4, 6, steelMat, true],
    [-8, -16, 4, 1.15, 1.15, crateMat, false],
    [-8, 16, 4, 1.15, 1.15, crateMat, false],
    [18, 0, 2.4, 2.4, 4, tealMat, false],
    [-24, -14, 3, 1.15, 3, crateMat, false],
    [-24, 14, 3, 1.15, 3, crateMat, false],
    [24, -2, 1.15, 1.15, 4, crateMat, false],
    [24, 2, 1.15, 1.15, 4, crateMat, false],
  ];
  for (const [x, z, w, h, d, mat, trim] of covers) {
    const m = box(w, h, d, mat);
    m.position.set(x, h / 2, z);
    group.add(m);
    addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h);
    if (trim) {
      const t = box(w + 0.06, 0.35, d + 0.06, hazardMat);
      t.position.set(x, h - 0.18, z);
      group.add(t);
    }
  }

  // Silos (cylinders, collision as boxes)
  for (const [sx, sz] of [[-2, -17], [-2, 17], [26, -17], [26, 17]]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 5.5, 18), metal);
    silo.position.set(sx, 2.75, sz);
    silo.castShadow = true; silo.receiveShadow = true;
    group.add(silo);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1, 18), rustMat);
    cap.position.set(sx, 6, sz);
    cap.castShadow = true;
    group.add(cap);
    addCollider(sx - 1.8, sx + 1.8, sz - 1.8, sz + 1.8, 0, 5.5);
  }

  // Furnace at Site A — glowing mouth, the landmark of A.
  const furnace = box(6, 5, 4, wallDark);
  furnace.position.set(21, 2.5, -14);
  group.add(furnace);
  addCollider(18, 24, -16, -12, 0, 5);
  const mouth = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 2),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  );
  mouth.position.set(18 - 0.02, 1.6, -14);
  mouth.rotation.y = -Math.PI / 2;
  group.add(mouth);
  const furnaceLight = new THREE.PointLight(0xff7a1a, 30, 18, 1.6);
  furnaceLight.position.set(16.5, 2, -14);
  group.add(furnaceLight);

  // Crane at Site B — yellow gantry over the yard.
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xd8a020, roughness: 0.6, metalness: 0.5 });
  for (const [lx, lz] of [[17, 9], [23, 9], [17, 15], [23, 15]]) {
    const leg = box(0.5, 5, 0.5, craneMat);
    leg.position.set(lx, 2.5, lz);
    group.add(leg);
    addCollider(lx - 0.25, lx + 0.25, lz - 0.25, lz + 0.25, 0, 5);
  }
  const beam = box(8, 0.7, 0.7, craneMat);
  beam.position.set(20, 5.2, 9);
  group.add(beam);
  const beam2 = box(8, 0.7, 0.7, craneMat);
  beam2.position.set(20, 5.2, 15);
  group.add(beam2);
  const hook = box(0.8, 1.2, 0.8, steelMat);
  hook.position.set(20, 4.4, 12);
  group.add(hook);

  // Site floor markings: hazard border + letter sprite floating above.
  for (const site of Object.values(MAP.sites)) {
    const w = site.x1 - site.x0, d = site.z1 - site.z0;
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: hazard, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(site.cx, 0.02, site.cz);
    group.add(mark);
    const sprite = letterSprite(THREE, site.id, site.id === 'A' ? '#f5a623' : '#3f8cff');
    sprite.position.set(site.cx, 6.2, site.cz);
    group.add(sprite);
  }

  // Sky dome: dusk gradient painted on canvas.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1c2733');
  grad.addColorStop(0.45, '#4a3a30');
  grad.addColorStop(0.7, '#8a5a33');
  grad.addColorStop(1, '#2a211a');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  // Lights: low amber sun + cool hemisphere fill.
  const sun = new THREE.DirectionalLight(0xffb36b, 3.0);
  sun.position.set(-30, 26, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0x8fa3b8, 0x2a211a, 1.05));

  return { group, colliders, groundAt, sites: MAP.sites };
}
