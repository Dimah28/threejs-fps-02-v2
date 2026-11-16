// Ironworks Protocol — shared math and deterministic random helpers.
// Everything the game randomises during a staged screenshot comes from mulberry32,
// so a ?shot= frame renders the same bytes on every run.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

// Shortest signed angle difference in radians, wrapped to [-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtMoney(n) {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// 2D distance on the ground plane.
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Ray vs axis-aligned box (slab test). Returns distance along the ray or Infinity.
// The box is { minX, maxX, minY, maxY, minZ, maxZ }; origin and dir are {x,y,z}
// with dir normalised. Used for bullets, line of sight and grenade bounces.
export function rayBox(origin, dir, box) {
  let tMin = 0, tMax = Infinity;
  const axes = [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']];
  for (const [axis, lo, hi] of axes) {
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < box[lo] || o > box[hi]) return Infinity;
    } else {
      let t1 = (box[lo] - o) / d, t2 = (box[hi] - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return Infinity;
    }
  }
  return tMin;
}

// Pick a weighted random entry from [[weight, value], ...] using a seeded rng.
export function weightedPick(rng, entries) {
  let total = 0;
  for (const [w] of entries) total += w;
  let roll = rng() * total;
  for (const [w, v] of entries) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return entries[entries.length - 1][1];
}
