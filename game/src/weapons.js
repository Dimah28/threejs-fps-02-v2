// Ironworks Protocol — weapon definitions. Every gun has its own damage, rate of
// fire, magazine, spread, recoil kick, move-speed penalty and sound kind, so the
// buy menu is a real choice: accuracy and range beat raw fire rate at distance,
// and a shotgun or SMG wins the close corridors the rifle loses.

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', short: 'P9', price: 0,
    damage: 26, headMult: 2.0, rof: 0.32, mag: 12, reserve: Infinity,
    spreadDeg: 0.9, moveSpreadDeg: 2.2, airSpreadDeg: 3.5,
    recoil: 0.011, kick: 0.35, rangeFalloff: [25, 40],
    moveSpeed: 1.0, auto: false, pellets: 1, zoom: 1, sound: 'pistol',
  },
  smg: {
    id: 'smg', name: 'Kestrel SMG', short: 'KST', price: 900,
    damage: 22, headMult: 1.8, rof: 0.09, mag: 30, reserve: 120,
    spreadDeg: 1.7, moveSpreadDeg: 3.0, airSpreadDeg: 4.5,
    recoil: 0.008, kick: 0.22, rangeFalloff: [18, 32],
    moveSpeed: 1.0, auto: true, pellets: 1, zoom: 1, sound: 'smg',
  },
  rifle: {
    id: 'rifle', name: 'Mantis Rifle', short: 'MNT', price: 2200,
    damage: 34, headMult: 2.0, rof: 0.13, mag: 25, reserve: 75,
    spreadDeg: 0.7, moveSpreadDeg: 1.8, airSpreadDeg: 3.2,
    recoil: 0.016, kick: 0.5, rangeFalloff: [30, 55],
    moveSpeed: 0.96, auto: true, pellets: 1, zoom: 1, sound: 'rifle',
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher 12G', short: 'BRC', price: 1500,
    damage: 12, headMult: 1.6, rof: 0.85, mag: 6, reserve: 24,
    spreadDeg: 4.6, moveSpreadDeg: 5.5, airSpreadDeg: 6.5,
    recoil: 0.05, kick: 1.4, rangeFalloff: [10, 20],
    moveSpeed: 0.97, auto: false, pellets: 8, zoom: 1, sound: 'shotgun',
  },
  dmr: {
    id: 'dmr', name: 'Longbow DMR', short: 'LGB', price: 3800,
    damage: 88, headMult: 2.2, rof: 0.95, mag: 5, reserve: 15,
    spreadDeg: 0.08, moveSpreadDeg: 1.4, airSpreadDeg: 2.6,
    recoil: 0.045, kick: 1.1, rangeFalloff: [45, 90],
    moveSpeed: 0.94, auto: false, pellets: 1, zoom: 2.6, sound: 'dmr',
  },
  lmg: {
    id: 'lmg', name: 'Tempest LMG', short: 'TMP', price: 3200,
    damage: 28, headMult: 1.7, rof: 0.11, mag: 60, reserve: 120,
    spreadDeg: 1.9, moveSpreadDeg: 3.2, airSpreadDeg: 4.8,
    recoil: 0.012, kick: 0.32, rangeFalloff: [28, 50],
    moveSpeed: 0.9, auto: true, pellets: 1, zoom: 1, sound: 'lmg',
  },
};

export const BUY_ITEMS = [
  { id: 'smg', kind: 'weapon', price: 900, label: 'Kestrel SMG', note: 'Close quarters · 30 rnd' },
  { id: 'shotgun', kind: 'weapon', price: 1500, label: 'Breacher 12G', note: '8 pellets · devastating up close' },
  { id: 'rifle', kind: 'weapon', price: 2200, label: 'Mantis Rifle', note: 'All-round · 25 rnd' },
  { id: 'lmg', kind: 'weapon', price: 3200, label: 'Tempest LMG', note: '60 rnd · holds a lane' },
  { id: 'dmr', kind: 'weapon', price: 3800, label: 'Longbow DMR', note: 'One-shot headshot · scope' },
  { id: 'kevlar', kind: 'gear', price: 650, label: 'Kevlar Vest', note: 'Halves damage taken' },
  { id: 'grenade', kind: 'gear', price: 300, label: 'HE Grenade', note: 'Key G to throw' },
  { id: 'defusekit', kind: 'gear', price: 400, label: 'Defuse Kit', note: 'Defuse in 2.5s (Sentinels)' },
];

export const GRENADE = {
  damage: 95, radius: 6.5, fuse: 1.6, bounce: 0.45, gravity: 14, throwSpeed: 17,
};

export function damageAtRange(def, distance) {
  const [near, far] = def.rangeFalloff;
  if (distance <= near) return def.damage;
  if (distance >= far) return def.damage * 0.55;
  return def.damage * (1 - 0.45 * ((distance - near) / (far - near)));
}
