// Ironworks Protocol — bot AI. Ten bots, five a side, in three difficulty tiers.
// Rookies react slowly and miss wide; veterans hold angles and trade; elites
// flank, pre-aim and punish. Every bot thinks in roles: push a lane, hold a
// site, flank the catwalk, retreat when hurt, plant the bomb, or defuse it.
// Pathing runs on the map's waypoint graph, never through walls.

import * as THREE from 'three';
import { nearestNode, findPath, nodePos } from './world.js';
import { clamp, angleDiff, dist2D, weightedPick } from './util.js';
import { hasLineOfSight } from './actors.js';

export const DIFFICULTY = {
  rookie: { reaction: 0.95, aimErrDeg: 3.4, burst: [2, 3], pause: [0.9, 1.5], speed: 0.88, accuracy: 0.34, holdChance: 0.25 },
  veteran: { reaction: 0.55, aimErrDeg: 2.0, burst: [3, 5], pause: [0.55, 1.0], speed: 1.0, accuracy: 0.5, holdChance: 0.45 },
  elite: { reaction: 0.32, aimErrDeg: 1.0, burst: [4, 6], pause: [0.35, 0.7], speed: 1.1, accuracy: 0.66, holdChance: 0.6 },
};

const SENTINEL_NAMES = ['Aldo', 'Bram', 'Citra', 'Dewi'];
const VIPER_NAMES = ['Raka', 'Sinta', 'Gilang', 'Putri'];

export function botColor(team) {
  return team === 'sentinel' ? 0x3f8cff : 0xe07830;
}

// A readable low-poly body: torso, head with visor, gun. Elites get a gold stripe.
export function makeBotMesh(THREE, actor) {
  const g = new THREE.Group();
  const color = botColor(actor.team);
  const torsoMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2521, roughness: 0.85, metalness: 0.1 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.34), torsoMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.38), darkMat);
  vest.position.y = 1.15;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), darkMat);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06),
    new THREE.MeshStandardMaterial({ color: actor.team === 'sentinel' ? 0x9fd0ff : 0xffc08a, roughness: 0.2, metalness: 0.6, emissive: actor.team === 'sentinel' ? 0x1a4a8a : 0x8a3a10, emissiveIntensity: 0.6 }));
  visor.position.set(0, 1.7, 0.19);
  g.add(visor);
  if (actor.difficulty === 'elite') {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.44),
      new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.4, metalness: 0.7 }));
    stripe.position.y = 1.9;
    g.add(stripe);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), darkMat);
  gun.position.set(0.28, 1.25, 0.3);
  g.add(gun);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.26), darkMat);
  legL.position.set(-0.16, 0.32, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

export function syncBotMesh(actor) {
  const m = actor.mesh;
  if (!m) return;
  m.position.set(actor.x, actor.y, actor.z);
  m.rotation.y = actor.yaw + Math.PI; // model faces +Z, actor faces -Z at yaw 0
  m.visible = actor.alive;
  if (!actor.alive) {
    m.rotation.x = -Math.PI / 2;
    m.position.y = actor.y + 0.3;
  } else {
    m.rotation.x = 0;
  }
}

// Assign round roles: one carrier, others split across the two sites / mid.
export function assignRoles(bots, rng) {
  const vipers = bots.filter((b) => b.team === 'viper' && b.alive);
  const sentinels = bots.filter((b) => b.team === 'sentinel' && b.alive);
  const site = rng() < 0.5 ? 'A' : 'B';
  const carrier = vipers[Math.floor(rng() * vipers.length)];
  for (const b of vipers) {
    b.ai.assignedSite = b === carrier ? site : (rng() < 0.55 ? site : (site === 'A' ? 'B' : 'A'));
    b.ai.role = b === carrier ? 'carrier' : (rng() < 0.3 ? 'flank' : 'push');
    b.bombCarrier = b === carrier;
  }
  for (const b of sentinels) {
    b.ai.assignedSite = rng() < 0.5 ? 'A' : 'B';
    b.ai.role = rng() < DIFFICULTY[b.difficulty].holdChance ? 'hold' : 'push';
  }
  return { site, carrier };
}

export function initBotAI(bot) {
  bot.ai = {
    path: [], pathIndex: 0, targetNode: -1,
    state: 'push', nextThink: 0, nextBurstAt: 0, burstLeft: 0,
    engageAt: 0, enemy: null, strafeDir: 1, strafeUntil: 0,
    assignedSite: 'A', role: 'push', lastSeen: 0, stuckAt: 0, stuckPos: null,
  };
}

function visibleEnemies(bot, actors, world) {
  const out = [];
  for (const a of actors) {
    if (a === bot || !a.alive || a.team === bot.team) continue;
    const d = dist2D(bot.x, bot.z, a.x, a.z);
    if (d > 48) continue;
    if (hasLineOfSight(bot, a, world)) out.push({ actor: a, dist: d });
  }
  out.sort((p, q) => p.dist - q.dist);
  return out;
}

function setPath(bot, targetNode) {
  const from = nearestNode(bot.x, bot.z);
  bot.ai.path = findPath(from, targetNode);
  bot.ai.pathIndex = 0;
  bot.ai.targetNode = targetNode;
}

function nodeForObjective(bot, game, world) {
  const sites = world.sites;
  if (bot.team === 'viper') {
    if (game.bombState === 'planted') {
      // Defend the planted site.
      return nearestNode(sites[game.plantedSite].cx, sites[game.plantedSite].cz);
    }
    if (game.bombState === 'dropped') {
      return nearestNode(game.bombX, game.bombZ);
    }
    if (bot.bombCarrier) {
      const s = sites[bot.ai.assignedSite];
      return nearestNode(s.cx, s.cz);
    }
    // Support the carrier's site, or flank via the catwalk.
    if (bot.ai.role === 'flank') return 8; // catwalk centre
    const s = sites[bot.ai.assignedSite];
    return nearestNode(s.cx + (bot.ai.role === 'push' ? -4 : 0), s.cz);
  }
  // Sentinels
  if (game.bombState === 'planted') {
    const s = sites[game.plantedSite];
    return nearestNode(s.cx, s.cz);
  }
  if (bot.ai.role === 'hold') {
    const s = sites[bot.ai.assignedSite];
    return nearestNode(s.cx - 5, s.cz + (bot.ai.assignedSite === 'A' ? 3 : -3));
  }
  return weightedPick(game.rng, [[3, 8], [2, 14], [2, 17]]) ?? 8; // catwalk / north / south mid
}

export function updateBot(bot, S, dt) {
  const { game, world, rng } = S;
  const ai = bot.ai;
  const now = game.time;
  if (!bot.alive) return;
  // Freeze time (buy phase) and round end: hold position, no shooting.
  if (game.phase !== 'live') {
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    return;
  }

  // --- think (4x a second): objective, target, combat awareness
  if (now >= ai.nextThink) {
    ai.nextThink = now + 0.25;
    const seen = visibleEnemies(bot, S.actors, world);
    ai.enemy = seen.length ? seen[0].actor : null;
    if (ai.enemy) {
      if (!ai.enemySeenAt) {
        ai.enemySeenAt = now;
        ai.engageAt = now + DIFFICULTY[bot.difficulty].reaction;
      }
      ai.lastSeen = now;
    } else {
      ai.enemySeenAt = 0;
    }

    // Retreat when badly hurt and an enemy is close.
    if (bot.hp < 35 && ai.enemy && dist2D(bot.x, bot.z, ai.enemy.x, ai.enemy.z) < 20) {
      ai.state = 'retreat';
    } else if (bot.team === 'viper' && bot.bombCarrier && game.bombState === 'carried') {
      const s = world.sites[bot.ai.assignedSite];
      if (dist2D(bot.x, bot.z, s.cx, s.cz) < 4 && !ai.enemy) ai.state = 'plant';
      else ai.state = 'push';
    } else if (bot.team === 'sentinel' && game.bombState === 'planted') {
      const s = world.sites[game.plantedSite];
      ai.state = dist2D(bot.x, bot.z, s.cx, s.cz) < 4.5 && !ai.enemy ? 'defuse' : 'hunt';
    } else if (bot.team === 'viper' && game.bombState === 'dropped') {
      ai.state = 'pickup';
    } else if (ai.enemy) {
      ai.state = 'engage';
    } else {
      ai.state = bot.ai.role === 'hold' ? 'hold' : 'push';
    }

    if (ai.state === 'retreat') {
      const home = bot.team === 'sentinel' ? 0 : 25;
      setPath(bot, home);
    } else if (ai.state === 'plant' || ai.state === 'defuse') {
      ai.path = []; ai.pathIndex = 0;
    } else if (ai.state !== 'engage' && ai.state !== 'hold') {
      const target = nodeForObjective(bot, game, world);
      if (target !== ai.targetNode) setPath(bot, target);
    }

    // Stuck detection: repath with a small random detour.
    if (ai.stuckPos) {
      if (dist2D(bot.x, bot.z, ai.stuckPos.x, ai.stuckPos.z) < 0.3 && now - ai.stuckAt > 2.5) {
        const detour = Math.floor(rng() * 27);
        setPath(bot, detour);
        ai.stuckAt = now;
      }
    } else {
      ai.stuckPos = { x: bot.x, z: bot.z };
      ai.stuckAt = now;
    }
    if (dist2D(bot.x, bot.z, ai.stuckPos.x, ai.stuckPos.z) > 1) {
      ai.stuckPos = { x: bot.x, z: bot.z };
      ai.stuckAt = now;
    }
  }

  // --- plant / defuse channels
  if (ai.state === 'plant') {
    bot.plantProgress += dt / 3;
    if (bot.plantProgress >= 1) {
      game.plantBomb(bot);
      bot.plantProgress = 0;
    }
    return; // planting bot stands still
  }
  if (ai.state === 'defuse') {
    bot.defuseProgress += dt / (bot.hasDefuseKit ? 2.5 : 5);
    if (bot.defuseProgress >= 1) {
      game.defuseBomb(bot);
      bot.defuseProgress = 0;
    }
    return;
  }
  bot.plantProgress = 0;
  bot.defuseProgress = 0;

  // --- combat: aim and fire in bursts
  let moveDir = null;
  if (ai.enemy && ai.enemy.alive) {
    const e = ai.enemy;
    const d = dist2D(bot.x, bot.z, e.x, e.z);
    const desiredYaw = Math.atan2(-(e.x - bot.x), -(e.z - bot.z));
    const turnRate = bot.difficulty === 'elite' ? 9 : bot.difficulty === 'veteran' ? 7 : 5;
    bot.yaw += clamp(angleDiff(bot.yaw, desiredYaw), -turnRate * dt, turnRate * dt);
    const targetPitch = Math.atan2((e.eyeY - 0.15) - bot.eyeY, d);
    bot.pitch += clamp(targetPitch - bot.pitch, -4 * dt, 4 * dt);
    // Strafe while engaging.
    if (now > ai.strafeUntil) {
      ai.strafeDir = rng() < 0.5 ? -1 : 1;
      ai.strafeUntil = now + 0.7 + rng() * 0.8;
    }
    const strafeAngle = desiredYaw + (Math.PI / 2) * ai.strafeDir;
    moveDir = { x: Math.sin(strafeAngle) * 0.6, z: Math.cos(strafeAngle) * 0.6 };
    // Fire bursts once the reaction time has passed and the aim is close.
    if (now >= ai.engageAt && Math.abs(angleDiff(bot.yaw, desiredYaw)) < 0.12) {
      if (ai.burstLeft <= 0 && now >= ai.nextBurstAt) {
        const [lo, hi] = DIFFICULTY[bot.difficulty].burst;
        ai.burstLeft = lo + Math.floor(rng() * (hi - lo + 1));
      }
      if (ai.burstLeft > 0 && now >= bot.lastShotAt + bot.weapon.rof) {
        const err = (DIFFICULTY[bot.difficulty].aimErrDeg * Math.PI) / 180;
        const savedYaw = bot.yaw, savedPitch = bot.pitch;
        bot.yaw += (rng() * 2 - 1) * err;
        bot.pitch += (rng() * 2 - 1) * err * 0.6;
        const shot = bot.tryShoot(now, rng, world, S.actors);
        bot.yaw = savedYaw; bot.pitch = savedPitch;
        if (shot && !shot.dry) {
          ai.burstLeft -= 1;
          S.onShotFired?.(shot);
          if (ai.burstLeft <= 0) {
            const [plo, phi] = DIFFICULTY[bot.difficulty].pause;
            ai.nextBurstAt = now + plo + rng() * (phi - plo);
          }
        } else if (shot?.dry) {
          bot.startReload(now);
          S.audio?.reload();
        }
      }
    }
    if (now >= bot.reloadingUntil && bot.reloadingUntil > 0) bot.finishReload();
  }

  // --- movement along the waypoint path (or strafe while engaging)
  const speed = 4.3 * DIFFICULTY[bot.difficulty].speed * bot.weapon.moveSpeed * (bot.crouching ? 0.55 : 1);
  let mx = 0, mz = 0;
  if (moveDir) {
    mx = moveDir.x; mz = moveDir.z;
  } else if (ai.path.length && ai.pathIndex < ai.path.length) {
    const node = nodePos(ai.path[ai.pathIndex]);
    const dx = node.x - bot.x, dz = node.z - bot.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.9) {
      ai.pathIndex += 1;
    } else {
      mx = dx / d; mz = dz / d;
      const desiredYaw = Math.atan2(-dx, -dz);
      const turnRate = 6;
      bot.yaw += clamp(angleDiff(bot.yaw, desiredYaw), -turnRate * dt, turnRate * dt);
    }
  } else if (ai.state === 'hold') {
    // Hold the angle: face the likely approach (the site's open side).
    const s = world.sites[bot.ai.assignedSite];
    const desiredYaw = Math.atan2(-(s.cx - 6 - bot.x), -(s.cz - bot.z));
    bot.yaw += clamp(angleDiff(bot.yaw, desiredYaw), -3 * dt, 3 * dt);
  }
  bot.moving = Math.abs(mx) + Math.abs(mz) > 0.01;
  if (bot.moving) bot.move(mx * speed * dt, mz * speed * dt, world, dt);
  else bot.move(0, 0, world, dt);

  // Reload when the magazine runs dry outside combat.
  if (bot.mag === 0 && !ai.enemy) {
    if (bot.startReload(now)) S.audio?.reload();
  }
  if (now >= bot.reloadingUntil && bot.reloadingUntil > 0) bot.finishReload();

  // Pick up a dropped bomb by walking over it.
  if (game.bombState === 'dropped' && bot.team === 'viper' && dist2D(bot.x, bot.z, game.bombX, game.bombZ) < 1.3) {
    bot.bombCarrier = true;
    game.bombState = 'carried';
    game.bombCarrier = bot;
  }
}

export { SENTINEL_NAMES, VIPER_NAMES };
