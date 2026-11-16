// Ironworks Protocol — bootstrap and the frame loop. This file wires the world,
// the actors, the match, the HUD, the audio and the input together, draws the
// tracers and muzzle flashes, and stages the deterministic ?shot= frames the
// screenshots are taken from. ?shot=menu|combat|buy|plant with &seed=N stages
// one frame, renders it twice, freezes it and sets window.__shotReady.

import * as THREE from 'three';
import { buildWorld, groundAt, MAP } from './world.js';
import { Actor, raycastShot, throwGrenade } from './actors.js';
import { Game } from './game.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { initBotAI, makeBotMesh, syncBotMesh, updateBot, assignRoles, SENTINEL_NAMES, VIPER_NAMES } from './bots.js';
import { WEAPONS, BUY_ITEMS, GRENADE } from './weapons.js';
import { mulberry32, clamp, dist2D } from './util.js';

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = shot ? mulberry32(seed) : mulberry32((Date.now() % 2147483647) | 1);

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2a211a, 0.006);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 220);

const world = buildWorld(THREE, rng);
scene.add(world.group);

// --- actors: the player plus 9 bots (5v5) ---------------------------------
const player = new Actor({ name: 'You', team: 'sentinel', x: -25, z: 0, yaw: -Math.PI / 2 });
player.money = 800;
const actors = [player];
const botSpecs = [
  ...SENTINEL_NAMES.map((name, i) => ({ name, team: 'sentinel', difficulty: ['elite', 'veteran', 'veteran', 'rookie'][i] })),
  ...VIPER_NAMES.map((name, i) => ({ name, team: 'viper', difficulty: ['veteran', 'elite', 'veteran', 'rookie'][i] })),
  { name: 'Eko', team: 'viper', difficulty: 'rookie' },
];
for (const spec of botSpecs) {
  const bot = new Actor({ ...spec, isBot: true, x: 0, z: 0, yaw: 0 });
  bot.mesh = makeBotMesh(THREE, bot);
  scene.add(bot.mesh);
  initBotAI(bot);
  actors.push(bot);
}

// --- shared state -----------------------------------------------------------
const S = {
  rng, scene, camera, world, map: MAP, actors, player,
  botsModule: { assignRoles },
  actorsModule: { throwGrenade },
  audio: new AudioEngine(),
  hud: null, game: null, input: null,
  onShotFired: null, onExplosion: null,
};

const input = new Input();
S.input = input;
const hud = new HUD(S);
S.hud = hud;
const game = new Game(S);
S.game = game;

// --- viewmodel: the gun in the player's hands --------------------------------
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e1a17, roughness: 0.85, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.42), dark);
  body.position.set(0.26, -0.27, -0.62);
  viewmodel.add(body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.24), dark);
  barrel.position.set(0.26, -0.245, -0.92);
  viewmodel.add(barrel);
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.6, metalness: 0.2 }));
  accent.position.set(0.26, -0.21, -0.66);
  viewmodel.add(accent);
}
camera.add(viewmodel);
scene.add(camera);

// --- tracers, muzzle flash, particles ---------------------------------------
const TRACER_MAX = 28;
const tracers = [];
{
  for (let i = 0; i < TRACER_MAX; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }),
    );
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
}
let tracerIdx = 0;
function spawnTracer(from, to) {
  const t = tracers[tracerIdx++ % TRACER_MAX];
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  t.mesh.scale.set(0.035, 0.035, Math.max(0.1, len));
  t.mesh.lookAt(to.x, to.y, to.z);
  t.mesh.visible = true;
  t.life = 0.09;
}
const muzzleLight = new THREE.PointLight(0xffc36b, 0, 9, 1.8);
scene.add(muzzleLight);
const muzzleSprite = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,220,120,1)');
  g.addColorStop(0.4, 'rgba(255,150,40,0.8)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.75 }));
  spr.scale.set(0.18, 0.18, 1);
  spr.visible = false;
  // Fixed to the camera at the gun tip, so the flash reads at the barrel, not
  // floating mid-screen.
  spr.position.set(0.26, -0.24, -1.0);
  camera.add(spr);
  return spr;
})();

// Impact sparks + explosion puffs: one Points cloud, recycled.
const PARTICLE_MAX = 400;
const particleGeo = new THREE.BufferGeometry();
const particlePos = new Float32Array(PARTICLE_MAX * 3);
const particleVel = new Float32Array(PARTICLE_MAX * 3);
const particleLife = new Float32Array(PARTICLE_MAX);
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
const particleMat = new THREE.PointsMaterial({ color: 0xffc36b, size: 0.09, transparent: true, opacity: 0.95 });
const particles = new THREE.Points(particleGeo, particleMat);
particles.frustumCulled = false;
scene.add(particles);
let particleIdx = 0;
function spawnParticles(point, n, color, speed = 4) {
  particleMat.color.setHex(color);
  for (let i = 0; i < n; i++) {
    const j = particleIdx++ % PARTICLE_MAX;
    particlePos[j * 3] = point.x; particlePos[j * 3 + 1] = point.y; particlePos[j * 3 + 2] = point.z;
    const a = rng() * Math.PI * 2, b = (rng() - 0.5) * Math.PI;
    const s = speed * (0.4 + rng() * 0.8);
    particleVel[j * 3] = Math.cos(a) * Math.cos(b) * s;
    particleVel[j * 3 + 1] = Math.abs(Math.sin(b)) * s + 1;
    particleVel[j * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
    particleLife[j] = 0.4 + rng() * 0.4;
  }
  particleGeo.attributes.position.needsUpdate = true;
}
function updateParticles(dt) {
  let any = false;
  for (let j = 0; j < PARTICLE_MAX; j++) {
    if (particleLife[j] <= 0) continue;
    any = true;
    particleLife[j] -= dt;
    particleVel[j * 3 + 1] -= 9 * dt;
    particlePos[j * 3] += particleVel[j * 3] * dt;
    particlePos[j * 3 + 1] += particleVel[j * 3 + 1] * dt;
    particlePos[j * 3 + 2] += particleVel[j * 3 + 2] * dt;
    if (particlePos[j * 3 + 1] < 0.02) { particlePos[j * 3 + 1] = 0.02; particleVel[j * 3 + 1] *= -0.3; }
  }
  if (any) particleGeo.attributes.position.needsUpdate = true;
}

// Bomb meshes: dropped and planted.
const bombMesh = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x2a2521, roughness: 0.5, metalness: 0.6 }));
  body.castShadow = true;
  bombMesh.add(body);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  light.position.set(0, 0.16, 0);
  light.name = 'bombLight';
  bombMesh.add(light);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// --- shooting pipeline: tracers, flash, sound, damage ------------------------
S.onShotFired = (shot) => {
  const { actor, def, hits, origin } = shot;
  const distToPlayer = dist2D(actor.x, actor.z, player.x, player.z);
  S.audio.shot(def.sound, actor === player ? 0 : distToPlayer);
  // Muzzle flash at the shooter's gun.
  const flashPos = {
    x: actor.x - Math.sin(actor.yaw) * 0.7,
    y: actor.eyeY - 0.12,
    z: actor.z - Math.cos(actor.yaw) * 0.7,
  };
  // Muzzle flash: the sprite rides the camera at the gun tip; the light is in
  // world space at the shooter's muzzle.
  muzzleSprite.visible = true;
  muzzleLight.position.set(flashPos.x, flashPos.y, flashPos.z);
  muzzleLight.intensity = 6;
  setTimeout(() => { muzzleSprite.visible = false; muzzleLight.intensity = 0; }, 45);
  for (const hit of hits) {
    const end = hit ? hit.point : {
      x: origin.x + (-Math.sin(actor.yaw)) * 60,
      y: origin.y, z: origin.z + (-Math.cos(actor.yaw)) * 60,
    };
    spawnTracer(flashPos, end);
    if (hit) {
      if (hit.actor) spawnParticles(hit.point, 6, 0xff5040, 3);
      else spawnParticles(hit.point, 8, 0xffc36b, 2.5);
    }
  }
  if (shot.hits.length) game.applyShot(shot);
};

S.onExplosion = (pos) => {
  spawnParticles({ x: pos.x, y: (pos.y || 1) + 0.4, z: pos.z }, 60, 0xff7a1a, 9);
  const light = new THREE.PointLight(0xff7a1a, 60, 22, 1.5);
  light.position.set(pos.x, (pos.y || 1) + 1, pos.z);
  scene.add(light);
  setTimeout(() => scene.remove(light), 350);
};

// --- economy: buying ---------------------------------------------------------
S.buyItem = (id) => {
  const p = player;
  if (game.phase !== 'buy') return;
  const item = BUY_ITEMS.find((b) => b.id === id);
  if (!item) return;
  if (p.money < item.price) { S.audio.denied(); return; }
  if (item.kind === 'weapon') {
    p.money -= item.price;
    p.giveWeapon(item.id);
    p.ownedWeapons.add(item.id);
  } else if (item.id === 'kevlar') {
    if (p.hasKevlar) return;
    p.money -= item.price;
    p.hasKevlar = true; p.armor = 100;
  } else if (item.id === 'grenade') {
    p.money -= item.price;
    p.grenades += 1;
  } else if (item.id === 'defusekit') {
    if (p.hasDefuseKit) return;
    p.money -= item.price;
    p.hasDefuseKit = true;
  }
  S.audio.buy();
  hud.renderBuyMenu(true);
};
player.ownedWeapons = new Set(['pistol']);

// --- player controller --------------------------------------------------------
let prevFireHeld = false;
let scopeTarget = 1;
let cameraShake = 0;

function updatePlayer(dt) {
  const p = player;
  if (!p.alive) return;
  const { dx, dy } = input.consumeMouse();
  const sens = 0.0023 / scopeTarget;
  p.yaw -= dx * sens;
  p.pitch = clamp(p.pitch - dy * sens, -1.45, 1.45);
  p.crouching = input.crouch;

  const def = p.weapon;
  let speed = 5.2 * def.moveSpeed * (p.crouching ? 0.55 : 1) * (input.running ? 1.12 : 1);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let mx = (-sin * input.moveZ + cos * input.moveX);
  let mz = (-cos * input.moveZ - sin * input.moveX);
  const len = Math.hypot(mx, mz);
  if (len > 0.01) { mx /= len; mz /= len; }
  p.moving = len > 0.01;
  p.move(mx * speed * dt, mz * speed * dt, world, dt);
  if (input.jumpPressed) p.jump();

  // Scope with right mouse (Longbow only).
  const wantScope = input.keys.has('MouseRight') && p.weaponId === 'dmr';
  scopeTarget = wantScope ? def.zoom : 1;

  // Fire.
  const fireEdge = input.fireHeld && !prevFireHeld;
  if (input.fireHeld && (def.auto || fireEdge) && game.phase === 'live') {
    const shot = p.tryShoot(game.time, rng, world, actors);
    if (shot) {
      if (shot.dry) { S.audio.dryFire(); p.startReload(game.time); }
      else {
        S.onShotFired(shot);
        cameraShake = Math.min(0.5, cameraShake + def.kick * 0.12);
      }
    }
  }
  prevFireHeld = input.fireHeld;

  // Reload.
  if (input.pressed('KeyR') && p.startReload(game.time)) S.audio.reload();
  if (game.time >= p.reloadingUntil && p.reloadingUntil > 0) p.finishReload();

  // Weapon slots 1-6 (only weapons the player owns).
  const slots = ['pistol', 'smg', 'shotgun', 'rifle', 'dmr', 'lmg'];
  slots.forEach((id, i) => {
    if (input.pressed(`Digit${i + 1}`) && p.ownedWeapons.has(id) && p.weaponId !== id) {
      p.giveWeapon(id);
    }
  });
  // Grenade.
  if (input.pressed('KeyG') && game.phase === 'live') game.throwGrenade(p);
  // Buy menu keys during the buy phase.
  if (game.phase === 'buy') {
    BUY_ITEMS.forEach((item, i) => {
      if (input.pressed(`Digit${i + 1}`)) S.buyItem(item.id);
    });
  }
  if (input.pressed('KeyB') && game.phase === 'buy') {
    const menu = document.getElementById('buy-menu');
    const open = menu.hidden;
    hud.renderBuyMenu(open);
    if (!open) input.requestLock(renderer.domElement);
  }
  // Plant / defuse channel (hold E).
  game.updatePlayerChannel(dt, input.keys.has('KeyE'));
  input.endFrame();
}

function updateCamera(dt) {
  const p = player;
  if (!p.alive) {
    // Spectate a living teammate from behind.
    const mate = actors.find((a) => a.alive && a.team === p.team && a !== p);
    if (mate) {
      const back = 3.2;
      camera.position.set(
        mate.x + Math.sin(mate.yaw) * back,
        mate.y + 2.6,
        mate.z + Math.cos(mate.yaw) * back,
      );
      camera.lookAt(mate.x, mate.y + 1.3, mate.z);
    } else {
      camera.position.set(0, 26, 26);
      camera.lookAt(0, 0, 0);
    }
    return;
  }
  camera.position.set(p.x, p.eyeY, p.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  camera.rotation.z = 0;
  if (cameraShake > 0.001) {
    camera.rotation.x += (rng() - 0.5) * cameraShake * 0.02;
    camera.rotation.y += (rng() - 0.5) * cameraShake * 0.02;
    cameraShake *= Math.exp(-8 * dt);
  }
  const targetFov = 75 / scopeTarget;
  camera.fov += (targetFov - camera.fov) * Math.min(1, 12 * dt);
  camera.updateProjectionMatrix();
  viewmodel.visible = scopeTarget < 1.5;
}

function updateBombMesh() {
  if (game.bombState === 'planted' || game.bombState === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(game.bombX, game.bombState === 'planted' ? 0.12 : 0.12, game.bombZ);
    const light = bombMesh.getObjectByName('bombLight');
    if (light) {
      const blink = game.bombState === 'planted' ? (Math.floor(game.time * (game.bombTimer < 10 ? 4 : 2)) % 2 === 0) : true;
      light.visible = blink;
    }
  } else {
    bombMesh.visible = false;
  }
}

// --- the frame loop -----------------------------------------------------------
let last = performance.now();
let frozen = false;

function frame(now) {
  if (frozen) return;
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  if (!shot) {
    game.update(dt);
    if (game.phase === 'live' || game.phase === 'buy' || game.phase === 'roundEnd') {
      updatePlayer(dt);
      for (const a of actors) {
        if (a.isBot) updateBot(a, S, dt);
        syncBotMesh(a);
      }
    }
    // Reload completion for the player is checked in updatePlayer; bots inside updateBot.
    hud.update(dt);
    updateCamera(dt);
    updateBombMesh();
    updateParticles(dt);
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
}

// --- staged screenshots -------------------------------------------------------
// Each shot stages one deterministic frame, renders it twice, freezes it.
function stageShot(kind) {
  const overlay = document.getElementById('overlay');
  const buyMenu = document.getElementById('buy-menu');
  game.startMatch();
  if (kind === 'menu') {
    // Low overview across the yard toward the furnace glow, sky in frame.
    document.getElementById('hud').style.display = 'none';
    camera.position.set(-24, 5.5, 15);
    camera.lookAt(16, 2.5, -10);
    overlay.hidden = false;
    buyMenu.hidden = true;
    hud.update(0);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    // Leave the HUD hidden: the page is frozen, and the screenshot composites
    // the DOM as it stands at capture time, not as it stood at render time.
    window.__shotReady = true;
    return;
  }
  overlay.hidden = true;
  if (kind === 'buy') {
    game.phase = 'buy';
    game.phaseT = 12;
    player.money = 5200;
    player.giveWeapon('rifle');
    player.ownedWeapons.add('rifle');
    player.ownedWeapons.add('smg');
    hud.renderBuyMenu(true);
    hud.update(0);
    updateCamera(0);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    window.__shotReady = true;
    return;
  }
  if (kind === 'combat') {
    game.phase = 'live';
    game.phaseT = 80;
    // Player ON the catwalk, firing down it at a Viper crossing ahead.
    player.x = -6; player.z = 0; player.y = 3.2;
    player.yaw = -Math.PI / 2; player.pitch = -0.02;
    player.giveWeapon('rifle');
    player.ownedWeapons.add('rifle');
    const viper = actors.find((a) => a.team === 'viper' && a.isBot);
    viper.x = 2; viper.z = 0; viper.y = 3.2; viper.yaw = Math.PI / 2; viper.alive = true; viper.hp = 100;
    const mate = actors.find((a) => a.team === 'sentinel' && a.isBot);
    mate.x = -14; mate.z = -6; mate.y = 0; mate.yaw = -Math.PI / 2; mate.alive = true; mate.hp = 100;
    for (const a of actors) syncBotMesh(a);
    // One deterministic rifle shot at the Viper: tracer + hitmarker in frame.
    const shotRec = player.tryShoot(game.time, rng, world, actors);
    if (shotRec && !shotRec.dry) {
      S.onShotFired(shotRec); // draws the tracer and resolves the hit once
    }
    hud.update(0);
    updateCamera(0);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    window.__shotReady = true;
    return;
  }
  if (kind === 'plant') {
    game.phase = 'live';
    game.phaseT = 60;
    game.bombState = 'carried';
    game.bombCarrier = player;
    player.bombCarrier = true;
    player.x = 19; player.z = -11; player.y = 0;
    player.yaw = Math.PI / 2 + 0.35; player.pitch = -0.05;
    player.giveWeapon('rifle');
    player.ownedWeapons.add('rifle');
    player.plantProgress = 0.62;
    const mate = actors.find((a) => a.team === 'sentinel' && a.isBot);
    mate.x = 15; mate.z = -8; mate.y = 0; mate.yaw = -Math.PI / 2; mate.alive = true;
    for (const a of actors) syncBotMesh(a);
    hud.update(0);
    updateCamera(0);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    window.__shotReady = true;
    return;
  }
  window.__shotReady = true;
}

// --- menu wiring --------------------------------------------------------------
const playBtn = document.getElementById('play');
input.attach(renderer.domElement, () => {
  S.audio.ensure();
  if (game.phase === 'menu') {
    document.getElementById('overlay').hidden = true;
    game.startMatch();
    hud.renderBuyMenu(true);
  }
});
playBtn?.addEventListener('click', () => {
  S.audio.ensure();
  document.getElementById('overlay').hidden = true;
  game.startMatch();
  hud.renderBuyMenu(true);
  input.requestLock(renderer.domElement);
});
document.getElementById('buy-close')?.addEventListener('click', () => {
  hud.renderBuyMenu(false);
  input.requestLock(renderer.domElement);
});
document.getElementById('overlay-title').textContent = 'Ironworks Protocol';

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addEventListener('error', (event) => {
  window.__shotError = String(event.message || event.error);
});

// Debug hook for headless play-tests: phase, round, score, alive counts, player.
window.__gameDebug = () => ({
  phase: game.phase,
  round: game.round,
  score: game.score,
  aliveS: game.aliveCount('sentinel'),
  aliveV: game.aliveCount('viper'),
  playerHp: Math.round(player.hp),
  playerAlive: player.alive,
  playerPos: [Math.round(player.x), Math.round(player.z)],
  bomb: game.bombState,
  time: Math.round(game.time),
});

if (shot) {
  try {
    stageShot(shot);
  } catch (err) {
    window.__shotError = String(err?.message || err);
  }
  frozen = true;
} else {
  requestAnimationFrame(frame);
}
