// Ironworks Protocol — the match: rounds, economy, bomb, scoring.
// First to 8 rounds wins the match (15 rounds max). A round is won by
// eliminating the other team, by detonation, or by defusal; time running out
// with no plant hands it to the Sentinels. Money flows the Counter-Strike way:
// kills, plants and defusals pay, winners take more than losers, and a losing
// streak pays a little extra so a team can always buy back in.

import { WEAPONS, GRENADE, damageAtRange } from './weapons.js';
import { dist2D } from './util.js';

export const WIN_ROUNDS = 8;
export const MAX_ROUNDS = 15;
export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 35;
export const PLANT_SECONDS = 3;

const BOT_LOADOUTS = {
  rookie: ['smg', 'pistol'],
  veteran: ['rifle', 'smg'],
  elite: ['dmr', 'rifle'],
};

export class Game {
  constructor(S) {
    this.S = S;
    this.rng = S.rng;
    this.time = 0; // match clock, seconds
    this.phase = 'menu'; // menu | buy | live | roundEnd | matchEnd
    this.phaseT = 0; // time left in the phase
    this.round = 0;
    this.score = { sentinel: 0, viper: 0 };
    this.roundHistory = []; // 'S' | 'V' per round
    this.lossStreak = { sentinel: 0, viper: 0 };
    this.bombState = 'none'; // none | carried | dropped | planted
    this.bombCarrier = null;
    this.bombX = 0; this.bombZ = 0;
    this.plantedSite = null;
    this.bombTimer = 0;
    this.lastBeepAt = 0;
    this.grenades = [];
    this.events = []; // killfeed + banners, consumed by the HUD
    this.roundMvp = null;
    this.roundEndReason = '';
    this.winner = null;
    this.player = S.player;
  }

  get phaseSeconds() { return this.phaseT; }

  startMatch() {
    this.score = { sentinel: 0, viper: 0 };
    this.roundHistory = [];
    this.lossStreak = { sentinel: 0, viper: 0 };
    this.winner = null;
    this.round = 0;
    for (const a of this.S.actors) {
      a.money = 800; a.kills = 0; a.deaths = 0; a.damageDealt = 0;
      a.giveWeapon('pistol');
      a.grenades = 0; a.hasKevlar = false; a.hasDefuseKit = false;
    }
    this.startRound();
  }

  startRound() {
    this.round += 1;
    const S = this.S;
    // Spawns and facing.
    const sSpawns = S.world.sites; // (unused; spawns live in MAP via world module)
    const { sentinelSpawns, viperSpawns } = S.map;
    const sentinels = S.actors.filter((a) => a.team === 'sentinel');
    const vipers = S.actors.filter((a) => a.team === 'viper');
    sentinels.forEach((a, i) => {
      const [x, z] = sentinelSpawns[i % sentinelSpawns.length];
      a.resetForRound(x, z, -Math.PI / 2);
    });
    vipers.forEach((a, i) => {
      const [x, z] = viperSpawns[i % viperSpawns.length];
      a.resetForRound(x, z, Math.PI / 2);
    });
    // Bot loadouts: spend the round's money on a real gun.
    for (const b of S.actors.filter((a) => a.isBot)) {
      const options = BOT_LOADOUTS[b.difficulty];
      const pick = options[Math.floor(this.rng() * options.length)];
      const def = WEAPONS[pick];
      if (b.money >= def.price) { b.giveWeapon(pick); b.money -= def.price; }
      else b.giveWeapon('pistol');
      if (b.difficulty !== 'rookie' && b.money >= 650 && this.rng() < 0.5) {
        b.hasKevlar = true; b.armor = 100; b.money -= 650;
      }
      if (b.difficulty === 'elite' && this.rng() < 0.4) { b.grenades = 1; b.money -= 300; }
    }
    // Player keeps their gun and money; a fresh pistol round only on round 1.
    if (this.round === 1) {
      this.player.giveWeapon('pistol');
      this.player.grenades = 0;
    }
    this.player.hasDefuseKit = this.player.hasDefuseKit; // kept across rounds
    // Roles + bomb carrier.
    const { assignRoles } = S.botsModule;
    const bots = S.actors.filter((a) => a.isBot);
    const { site } = assignRoles(bots, this.rng);
    this.bombSiteTarget = site;
    const carrier = bots.find((b) => b.bombCarrier);
    this.bombCarrier = carrier || null;
    this.bombState = carrier ? 'carried' : 'none';
    this.plantedSite = null;
    this.bombTimer = 0;
    this.grenades = [];
    this.roundMvp = null;
    this.phase = 'buy';
    this.phaseT = BUY_SECONDS;
    this.events.push({ type: 'round', round: this.round });
    S.audio?.roundStart();
  }

  // Resolve a shot record: damage, deaths, killfeed, money, bomb drops.
  applyShot(shot) {
    const S = this.S;
    const results = [];
    for (const hit of shot.hits) {
      if (!hit.actor) { results.push({ ...hit, damage: 0 }); continue; }
      const def = shot.def;
      let dmg = damageAtRange(def, hit.distance);
      if (hit.headshot) dmg *= def.headMult;
      const res = hit.actor.takeDamage(dmg, shot.actor);
      results.push({ ...hit, damage: res.damage, died: res.died, headshot: hit.headshot });
      if (res.died) {
        this.events.push({
          type: 'kill', killer: shot.actor, victim: hit.actor,
          weapon: def.short, headshot: hit.headshot, at: this.time,
        });
        shot.actor.money += 300;
        if (hit.actor.bombCarrier) {
          hit.actor.bombCarrier = false;
          this.bombCarrier = null;
          this.bombState = 'dropped';
          this.bombX = hit.actor.x; this.bombZ = hit.actor.z;
          this.events.push({ type: 'bombdrop', at: this.time });
        }
        S.audio?.kill();
        if (shot.actor === this.player) S.hud?.flashHitmarker(true);
        else if (hit.actor === this.player) S.audio?.hurt();
      } else if (shot.actor === this.player) {
        S.hud?.flashHitmarker(false);
        S.audio?.hit();
      } else if (hit.actor === this.player) {
        S.audio?.hurt();
        S.hud?.flashDamage();
      }
    }
    this.checkRoundEnd();
    return results;
  }

  plantBomb(actor) {
    const site = this.siteAt(actor.x, actor.z);
    if (!site || this.bombState !== 'carried' || actor !== this.bombCarrier) return false;
    this.bombState = 'planted';
    this.plantedSite = site.id;
    this.bombX = actor.x; this.bombZ = actor.z;
    this.bombTimer = BOMB_SECONDS;
    this.lastBeepAt = 0;
    actor.bombCarrier = false;
    actor.money += 300;
    this.bombCarrier = null;
    this.events.push({ type: 'planted', site: site.id, at: this.time });
    this.S.audio?.plant();
    return true;
  }

  defuseBomb(actor) {
    if (this.bombState !== 'planted') return false;
    this.bombState = 'none';
    actor.money += 300;
    this.events.push({ type: 'defused', at: this.time });
    this.S.audio?.defuse();
    this.endRound('sentinel', 'Bomb defused');
    return true;
  }

  siteAt(x, z) {
    for (const site of Object.values(this.S.world.sites)) {
      if (x >= site.x0 && x <= site.x1 && z >= site.z0 && z <= site.z1) return site;
    }
    return null;
  }

  throwGrenade(actor) {
    if (actor.grenades <= 0) return false;
    actor.grenades -= 1;
    const { throwGrenade } = this.S.actorsModule;
    this.grenades.push(throwGrenade(actor, this.time, this.rng));
    return true;
  }

  updateGrenades(dt) {
    const S = this.S;
    for (const g of this.grenades) {
      g.fuse -= dt;
      g.vy -= GRENADE.gravity * dt;
      // Simple bounce: test each axis against the world boxes.
      const step = (axis, delta) => {
        const nx = g.x + (axis === 'x' ? delta : 0);
        const ny = g.y + (axis === 'y' ? delta : 0);
        const nz = g.z + (axis === 'z' ? delta : 0);
        for (const c of S.world.colliders) {
          if (nx > c.minX && nx < c.maxX && ny > c.minY && ny < c.maxY && nz > c.minZ && nz < c.maxZ) return false;
        }
        return true;
      };
      if (step('x', g.vx * dt)) g.x += g.vx * dt; else { g.vx *= -GRENADE.bounce; g.bounced += 1; }
      if (step('z', g.vz * dt)) g.z += g.vz * dt; else { g.vz *= -GRENADE.bounce; g.bounced += 1; }
      if (step('y', g.vy * dt)) g.y += g.vy * dt;
      else {
        if (g.y < 0.2) { g.y = 0.15; g.vy = Math.abs(g.vy) * GRENADE.bounce; g.vx *= 0.7; g.vz *= 0.7; }
        else { g.vy *= -GRENADE.bounce; }
        g.bounced += 1;
      }
      if (g.y < 0.1) g.y = 0.1;
      if (g.fuse <= 0) this.explodeGrenade(g);
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0);
  }

  explodeGrenade(g) {
    const S = this.S;
    S.onExplosion?.(g);
    S.audio?.explosion();
    for (const a of S.actors) {
      if (!a.alive || a === g.owner) continue;
      const d = Math.sqrt((a.x - g.x) ** 2 + (a.eyeY - g.y) ** 2 + (a.z - g.z) ** 2);
      if (d > GRENADE.radius) continue;
      const dmg = GRENADE.damage * (1 - (d / GRENADE.radius) * 0.7);
      const res = a.takeDamage(dmg, g.owner);
      if (res.died) {
        this.events.push({ type: 'kill', killer: g.owner, victim: a, weapon: 'HE', headshot: false, at: this.time });
        g.owner.money += 300;
        if (a.bombCarrier) {
          a.bombCarrier = false;
          this.bombCarrier = null;
          this.bombState = 'dropped';
          this.bombX = a.x; this.bombZ = a.z;
        }
      }
    }
    this.checkRoundEnd();
  }

  // Player holding E to plant / defuse.
  updatePlayerChannel(dt, holdingE) {
    const p = this.player;
    if (this.phase !== 'live' || !p.alive || !holdingE) {
      p.plantProgress = 0; p.defuseProgress = 0;
      return;
    }
    const site = this.siteAt(p.x, p.z);
    if (p.team === 'viper' && p.bombCarrier && site && this.bombState === 'carried') {
      p.plantProgress += dt / PLANT_SECONDS;
      if (p.plantProgress >= 1) { p.plantProgress = 0; this.plantBomb(p); }
    } else if (p.team === 'sentinel' && this.bombState === 'planted' && site?.id === this.plantedSite) {
      p.defuseProgress += dt / (p.hasDefuseKit ? 2.5 : 5);
      if (p.defuseProgress >= 1) { p.defuseProgress = 0; this.defuseBomb(p); }
    } else {
      p.plantProgress = 0; p.defuseProgress = 0;
    }
  }

  aliveCount(team) {
    return this.S.actors.filter((a) => a.team === team && a.alive).length;
  }

  checkRoundEnd() {
    if (this.phase !== 'live') return;
    const s = this.aliveCount('sentinel');
    const v = this.aliveCount('viper');
    if (v === 0) this.endRound('sentinel', 'Vipers eliminated');
    else if (s === 0) this.endRound('viper', this.bombState === 'planted' ? 'Sentinels eliminated — bomb will detonate' : 'Sentinels eliminated');
  }

  endRound(winnerTeam, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.phase = 'roundEnd';
    this.phaseT = 4.5;
    this.roundEndReason = reason;
    this.score[winnerTeam] += 1;
    this.roundHistory.push(winnerTeam === 'sentinel' ? 'S' : 'V');
    // Economy.
    const loser = winnerTeam === 'sentinel' ? 'viper' : 'sentinel';
    this.lossStreak[loser] += 1;
    this.lossStreak[winnerTeam] = 0;
    const lossBonus = 1900 + Math.min(2, this.lossStreak[loser] - 1) * 500;
    for (const a of this.S.actors) {
      a.money += a.team === winnerTeam ? 3250 : lossBonus;
      if (a.team === winnerTeam) a.money += 0;
    }
    // MVP: most damage this round.
    let mvp = null;
    for (const a of this.S.actors) {
      if (!mvp || a.damageDealt > mvp.damageDealt) mvp = a;
    }
    this.roundMvp = mvp;
    this.events.push({ type: 'roundEnd', winner: winnerTeam, reason, at: this.time });
    if (winnerTeam === 'sentinel') this.S.audio?.roundWon();
    else this.S.audio?.roundLost();
    if (this.score[winnerTeam] >= WIN_ROUNDS || this.round >= MAX_ROUNDS) {
      this.winner = this.score.sentinel > this.score.viper ? 'sentinel'
        : this.score.viper > this.score.sentinel ? 'viper' : 'draw';
      this.phase = 'matchEnd';
      this.phaseT = 8;
      this.events.push({ type: 'matchEnd', winner: this.winner, at: this.time });
    }
  }

  update(dt) {
    this.time += dt;
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { this.phase = 'live'; this.phaseT = ROUND_SECONDS; }
    } else if (this.phase === 'live') {
      this.phaseT -= dt;
      if (this.bombState === 'planted') {
        this.bombTimer -= dt;
        const interval = this.bombTimer < 10 ? 0.5 : this.bombTimer < 20 ? 0.75 : 1;
        if (this.time - this.lastBeepAt >= interval) {
          this.lastBeepAt = this.time;
          this.S.audio?.beep(this.bombTimer < 10);
        }
        if (this.bombTimer <= 0) {
          this.bombState = 'none';
          this.events.push({ type: 'exploded', at: this.time });
          this.S.onExplosion?.({ x: this.bombX, y: 1, z: this.bombZ });
          this.endRound('viper', 'Bomb detonated');
        }
      }
      if (this.phaseT <= 0 && this.phase === 'live') {
        this.endRound('sentinel', 'Time expired — bomb never planted');
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0 && this.phase !== 'matchEnd') this.startRound();
    }
    this.updateGrenades(dt);
  }
}
