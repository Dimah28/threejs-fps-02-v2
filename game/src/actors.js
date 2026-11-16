// Ironworks Protocol — actors: the player and the bots share one body.
// A body is a capsule approximated by an AABB for bullets (body + head boxes) and
// a circle on the ground plane for movement. Feet sit on world.groundAt(x, z);
// jumping adds vertical velocity, gravity pulls back down.

import * as THREE from 'three';
import { WEAPONS, damageAtRange, GRENADE } from './weapons.js';
import { clamp, rayBox, dist2D } from './util.js';

export const EYE_HEIGHT = 1.55;
export const BODY_HEIGHT = 1.7;
export const RADIUS = 0.42;

let nextId = 1;

export class Actor {
  constructor(opts) {
    this.id = nextId++;
    this.name = opts.name;
    this.team = opts.team; // 'sentinel' | 'viper'
    this.isBot = !!opts.isBot;
    this.difficulty = opts.difficulty || 'veteran'; // rookie | veteran | elite
    this.x = opts.x; this.z = opts.z;
    this.y = 0; // feet
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.hp = 100;
    this.armor = 0; // kevlar points
    this.alive = true;
    this.weaponId = 'pistol';
    this.mag = WEAPONS.pistol.mag;
    this.reserve = WEAPONS.pistol.reserve;
    this.grenades = 0;
    this.hasKevlar = false;
    this.hasDefuseKit = false;
    this.money = 800;
    this.kills = 0; this.deaths = 0; this.damageDealt = 0;
    this.vy = 0; this.onGround = true;
    this.crouching = false;
    this.lastShotAt = -10;
    this.reloadingUntil = 0;
    this.bombCarrier = false;
    this.plantProgress = 0; this.defuseProgress = 0;
    this.speedMul = 1;
    this.mesh = null; // bot body mesh (player has none — first person)
    this.muzzle = null;
  }

  get weapon() { return WEAPONS[this.weaponId]; }
  get eyeY() { return this.y + (this.crouching ? 1.15 : EYE_HEIGHT); }
  get headY() { return this.y + BODY_HEIGHT; }

  resetForRound(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = 0;
    this.hp = 100; this.alive = true;
    this.vy = 0; this.onGround = true;
    this.bombCarrier = false; this.plantProgress = 0; this.defuseProgress = 0;
    this.reloadingUntil = 0;
    this.y = 0;
  }

  giveWeapon(id) {
    const def = WEAPONS[id];
    this.weaponId = id;
    this.mag = def.mag;
    this.reserve = def.reserve;
  }

  // Move with per-axis AABB collision. Returns true if the full step landed.
  move(dx, dz, world, dt) {
    const colliders = world.colliders;
    const feet = this.y;
    const head = feet + BODY_HEIGHT;
    const tryMove = (nx, nz) => {
      for (const c of colliders) {
        if (c.maxY <= feet + 0.05 || c.minY >= head - 0.05) continue;
        if (nx + RADIUS > c.minX && nx - RADIUS < c.maxX && nz + RADIUS > c.minZ && nz - RADIUS < c.maxZ) {
          return false;
        }
      }
      return true;
    };
    if (tryMove(this.x + dx, this.z)) this.x += dx;
    if (tryMove(this.x, this.z + dz)) this.z += dz;
    // Gravity / ground following (ramps and the catwalk).
    const ground = world.groundAt(this.x, this.z);
    if (this.onGround) {
      this.y = ground;
    } else {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) { this.y = ground; this.vy = 0; this.onGround = true; }
    }
  }

  jump() {
    if (this.onGround) { this.vy = 7.5; this.onGround = false; }
  }

  // Fire one trigger pull. `rng` supplies spread; `now` is game time in seconds.
  // Returns a shot record for tracers/sound, or null when it cannot fire.
  tryShoot(now, rng, world, actors) {
    const def = this.weapon;
    if (!this.alive || now < this.lastShotAt + def.rof || now < this.reloadingUntil) return null;
    if (this.mag <= 0) return { dry: true, actor: this };
    this.lastShotAt = now;
    this.mag -= 1;
    this.pitch += def.recoil * (this.crouching ? 0.7 : 1);
    const origin = { x: this.x, y: this.eyeY, z: this.z };
    const hits = [];
    for (let p = 0; p < def.pellets; p++) {
      const spreadDeg = (this.onGround ? def.spreadDeg : def.airSpreadDeg) + (this.moving ? def.moveSpreadDeg - def.spreadDeg : 0);
      const spread = (spreadDeg * Math.PI) / 180;
      const a = rng() * Math.PI * 2;
      const r = (rng() + rng()) * 0.5 * spread; // triangular: tight centre
      const yaw = this.yaw + Math.cos(a) * r;
      const pitch = this.pitch + Math.sin(a) * r;
      const dir = {
        x: -Math.sin(yaw) * Math.cos(pitch),
        y: Math.sin(pitch),
        z: -Math.cos(yaw) * Math.cos(pitch),
      };
      const hit = raycastShot(origin, dir, world, actors, this);
      if (hit) hits.push(hit);
    }
    return { actor: this, def, hits, origin };
  }

  startReload(now) {
    const def = this.weapon;
    if (this.mag >= def.mag || this.reserve <= 0 || now < this.reloadingUntil) return false;
    this.reloadingUntil = now + 1.6;
    return true;
  }

  finishReload() {
    const def = this.weapon;
    const need = def.mag - this.mag;
    const take = Math.min(need, this.reserve === Infinity ? need : this.reserve);
    this.mag += take;
    if (this.reserve !== Infinity) this.reserve -= take;
    this.reloadingUntil = 0;
  }

  // Apply damage; returns { died, damage }.
  takeDamage(amount, attacker) {
    if (!this.alive) return { died: false, damage: 0 };
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.5);
      this.armor -= absorbed;
      dmg -= absorbed;
      if (this.armor <= 0) this.hasKevlar = false;
    }
    dmg = Math.max(1, Math.round(dmg));
    this.hp -= dmg;
    if (attacker) attacker.damageDealt += dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths += 1;
      if (attacker) attacker.kills += 1;
      return { died: true, damage: dmg };
    }
    return { died: false, damage: dmg };
  }

  // Hitboxes for raycasts: body box + smaller head box on top.
  hitBoxes() {
    return [
      { minX: this.x - RADIUS, maxX: this.x + RADIUS, minY: this.y, maxY: this.y + BODY_HEIGHT - 0.25, minZ: this.z - RADIUS, maxZ: this.z + RADIUS, head: false },
      { minX: this.x - 0.3, maxX: this.x + 0.3, minY: this.y + BODY_HEIGHT - 0.25, maxY: this.y + BODY_HEIGHT, minZ: this.z - 0.3, maxZ: this.z + 0.3, head: true },
    ];
  }
}

// One hitscan ray against the world and every other alive actor.
// Returns { point, distance, actor, headshot } or null.
export function raycastShot(origin, dir, world, actors, shooter) {
  let best = null;
  // Floor plane as a box so shots can hit the ground.
  const boxes = [{ minX: -60, maxX: 60, minY: -1, maxY: 0, minZ: -60, maxZ: 60, world: true }, ...world.colliders];
  for (const b of boxes) {
    const t = rayBox(origin, dir, b);
    if (t !== Infinity && (!best || t < best.distance)) {
      best = { distance: t, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t }, actor: null, headshot: false };
    }
  }
  for (const a of actors) {
    if (a === shooter || !a.alive) continue;
    for (const hb of a.hitBoxes()) {
      const t = rayBox(origin, dir, hb);
      if (t !== Infinity && (!best || t < best.distance)) {
        best = { distance: t, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t }, actor: a, headshot: hb.head };
      }
    }
  }
  return best;
}

// Line of sight between two eye positions (no actor in between).
export function hasLineOfSight(a, b, world) {
  const origin = { x: a.x, y: a.eyeY, z: a.z };
  const dx = b.x - a.x, dy = b.eyeY - a.eyeY, dz = b.z - a.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.01) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const boxes = [{ minX: -60, maxX: 60, minY: -1, maxY: 0, minZ: -60, maxZ: 60 }, ...world.colliders];
  for (const box of boxes) {
    const t = rayBox(origin, dir, box);
    if (t !== Infinity && t < dist - 0.5) return false;
  }
  return true;
}

export function throwGrenade(actor, now, rng) {
  const dir = {
    x: -Math.sin(actor.yaw) * Math.cos(actor.pitch),
    y: Math.sin(actor.pitch) + 0.25,
    z: -Math.cos(actor.yaw) * Math.cos(actor.pitch),
  };
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  return {
    x: actor.x, y: actor.eyeY, z: actor.z,
    vx: (dir.x / len) * GRENADE.throwSpeed,
    vy: (dir.y / len) * GRENADE.throwSpeed,
    vz: (dir.z / len) * GRENADE.throwSpeed,
    fuse: GRENADE.fuse, owner: actor, bounced: 0,
  };
}
