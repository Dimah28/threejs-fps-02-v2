// Ironworks Protocol — the HUD: every number the player needs, nothing they do
// not. Health and armour, ammo and money, round timer and team score with a
// round-history strip, alive pips, a live minimap, a compass strip, killfeed,
// hitmarkers, a damage vignette and the buy menu. All DOM, updated from game
// state each frame; the 3D scene never draws UI.

import { fmtMoney, fmtTime, clamp } from './util.js';
import { WEAPONS, BUY_ITEMS } from './weapons.js';

export class HUD {
  constructor(S) {
    this.S = S;
    this.el = {};
    for (const id of ['health-num', 'health-bar', 'armor-num', 'armor-bar', 'ammo-mag', 'ammo-reserve',
      'weapon-name', 'grenades', 'timer', 'money', 'score-v', 'score-j', 'round-num',
      'bomb-status', 'killfeed', 'banner', 'banner-title', 'banner-sub', 'plant-bar',
      'plant-label', 'plant-fill', 'hint', 'buy-menu', 'buy-money', 'buy-items',
      'overlay', 'overlay-title', 'overlay-copy', 'damage', 'hitmarker', 'crosshair',
      'minimap', 'round-dots', 'alive-v', 'alive-j', 'compass']) {
      this.el[id] = document.getElementById(id);
    }
    this.minimapCtx = this.el.minimap?.getContext('2d');
    this.killfeedRows = [];
    this.hitTimer = 0;
    this.damageTimer = 0;
  }

  flashHitmarker(kill) {
    const h = this.el.hitmarker;
    if (!h) return;
    h.classList.add('on');
    h.classList.toggle('kill', kill);
    this.hitTimer = 0.18;
  }

  flashDamage() {
    const d = this.el.damage;
    if (!d) return;
    d.classList.add('on');
    this.damageTimer = 0.35;
  }

  showBanner(title, sub, won) {
    const b = this.el.banner;
    if (!b) return;
    b.hidden = false;
    b.classList.toggle('won', won === true);
    b.classList.toggle('lost', won === false);
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub || '';
  }

  hideBanner() { if (this.el.banner) this.el.banner.hidden = true; }

  pushKillfeed(text) {
    const feed = this.el.killfeed;
    if (!feed) return;
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.textContent = text;
    feed.prepend(row);
    this.killfeedRows.unshift(row);
    while (this.killfeedRows.length > 5) this.killfeedRows.pop()?.remove();
    setTimeout(() => { row.remove(); this.killfeedRows = this.killfeedRows.filter((r) => r !== row); }, 6000);
  }

  drainEvents() {
    const game = this.S.game;
    while (game.events.length) {
      const ev = game.events.shift();
      if (ev.type === 'kill') {
        const head = ev.headshot ? ' (headshot)' : '';
        this.pushKillfeed(`${ev.killer.name} [${ev.weapon}] ${ev.victim.name}${head}`);
      } else if (ev.type === 'planted') {
        this.pushKillfeed(`Bomb planted at Site ${ev.site}`);
        this.showBanner('BOMB PLANTED', `Site ${ev.site} — defend it or defuse it`, null);
        setTimeout(() => this.hideBanner(), 2200);
      } else if (ev.type === 'defused') {
        this.pushKillfeed('Bomb defused');
      } else if (ev.type === 'bombdrop') {
        this.pushKillfeed('Bomb dropped');
      } else if (ev.type === 'exploded') {
        this.pushKillfeed('Bomb detonated');
      } else if (ev.type === 'roundEnd') {
        const won = ev.winner === this.S.player.team;
        this.showBanner(won ? 'ROUND WON' : 'ROUND LOST', ev.reason, won);
      } else if (ev.type === 'matchEnd') {
        const w = ev.winner === 'draw' ? 'DRAW' : ev.winner === this.S.player.team ? 'VICTORY' : 'DEFEAT';
        this.showBanner(w, `Final score ${game.score.sentinel} — ${game.score.viper}`, ev.winner === this.S.player.team);
      } else if (ev.type === 'round') {
        this.hideBanner();
      }
    }
  }

  renderBuyMenu(open) {
    const menu = this.el['buy-menu'];
    if (!menu) return;
    menu.hidden = !open;
    if (!open) return;
    const p = this.S.player;
    this.el['buy-money'].textContent = fmtMoney(p.money);
    const items = this.el['buy-items'];
    items.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-item';
      const owned = item.kind === 'weapon' ? p.weaponId === item.id
        : item.id === 'kevlar' ? p.hasKevlar
        : item.id === 'defusekit' ? p.hasDefuseKit
        : item.id === 'grenade' ? p.grenades > 0 : false;
      if (owned) btn.classList.add('owned');
      btn.innerHTML = `<span>${item.label}</span><span>${item.note} · ${fmtMoney(item.price)}</span>`;
      btn.addEventListener('click', () => this.S.buyItem?.(item.id));
      items.appendChild(btn);
    }
  }

  drawMinimap() {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const W = 180, H = 124;
    const sx = (x) => ((x + 28) / 56) * W;
    const sz = (z) => ((z + 20) / 40) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,18,15,0.9)';
    ctx.fillRect(0, 0, W, H);
    // walls
    ctx.strokeStyle = '#5c6670'; ctx.lineWidth = 2;
    ctx.strokeRect(sx(-28), sz(-20), sx(28) - sx(-28), sz(20) - sz(-20));
    // catwalk
    ctx.fillStyle = '#3d342a';
    ctx.fillRect(sx(-12), sz(-2.2), sx(12) - sx(-12), sz(2.2) - sz(-2.2));
    // sites
    const game = this.S.game;
    for (const site of Object.values(this.S.world.sites)) {
      ctx.fillStyle = site.id === 'A' ? 'rgba(245,166,35,0.35)' : 'rgba(63,140,255,0.35)';
      ctx.fillRect(sx(site.x0), sz(site.z0), sx(site.x1) - sx(site.x0), sz(site.z1) - sz(site.z0));
      ctx.fillStyle = '#f2ead9';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(site.id, sx(site.cx) - 3, sz(site.cz) + 4);
    }
    // planted bomb blinks
    if (game.bombState === 'planted' && Math.floor(game.time * 2) % 2 === 0) {
      ctx.fillStyle = '#e5484d';
      ctx.beginPath(); ctx.arc(sx(game.bombX), sz(game.bombZ), 4, 0, Math.PI * 2); ctx.fill();
    } else if (game.bombState === 'dropped') {
      ctx.fillStyle = '#f5a623';
      ctx.beginPath(); ctx.arc(sx(game.bombX), sz(game.bombZ), 3, 0, Math.PI * 2); ctx.fill();
    }
    // actors
    for (const a of this.S.actors) {
      if (!a.alive) continue;
      ctx.fillStyle = a.team === 'sentinel' ? '#3f8cff' : '#e07830';
      ctx.beginPath(); ctx.arc(sx(a.x), sz(a.z), a === this.S.player ? 4 : 3, 0, Math.PI * 2); ctx.fill();
      if (a === this.S.player) {
        ctx.strokeStyle = '#f2ead9'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx(a.x), sz(a.z), 6, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  drawCompass() {
    const c = this.el.compass;
    if (!c) return;
    const yaw = this.S.player.yaw;
    // Heading: yaw 0 faces north (-Z). Show a strip of cardinal marks.
    const marks = [];
    const headings = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];
    // Player forward angle in world: forward = (-sin yaw, -cos yaw); heading angle = atan2(fx, -fz)... use yaw directly.
    let deg = ((-yaw * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    c.textContent = `${String(Math.round(deg)).padStart(3, '0')}° ${headings.reduce((best, [label, a]) => {
      const d = Math.abs(((a + yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d < best.d ? { label, d } : best;
    }, { label: 'N', d: 99 }).label}`;
    void marks;
  }

  update(dt) {
    const S = this.S;
    const p = S.player;
    const game = S.game;
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.el.hitmarker?.classList.remove('on', 'kill');
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) this.el.damage?.classList.remove('on');
    }
    this.drainEvents();
    // Health / armour
    if (this.el['health-num']) this.el['health-num'].textContent = String(Math.max(0, Math.round(p.hp)));
    const hb = this.el['health-bar'];
    if (hb) {
      hb.style.width = `${clamp(p.hp, 0, 100)}%`;
      hb.classList.toggle('low', p.hp <= 30);
    }
    if (this.el['armor-num']) this.el['armor-num'].textContent = p.armor > 0 ? String(Math.round(p.armor)) : '—';
    const ab = this.el['armor-bar'];
    if (ab) ab.style.width = `${clamp(p.armor, 0, 100)}%`;
    // Ammo
    const def = p.weapon;
    if (this.el['ammo-mag']) this.el['ammo-mag'].textContent = String(p.mag);
    if (this.el['ammo-reserve']) this.el['ammo-reserve'].textContent = p.reserve === Infinity ? '/ ∞' : `/ ${p.reserve}`;
    if (this.el['weapon-name']) this.el['weapon-name'].textContent = def.name;
    if (this.el.grenades) this.el.grenades.textContent = p.grenades > 0 ? `HE ×${p.grenades} (G)` : '';
    // Crosshair spread grows with weapon spread and movement.
    const spread = def.spreadDeg + (p.moving ? def.moveSpreadDeg : 0);
    this.el.crosshair?.style.setProperty('--gap', `${Math.round(6 + spread * 4)}px`);
    // Top bar
    if (this.el.timer) {
      this.el.timer.textContent = game.phase === 'buy' ? `BUY ${fmtTime(game.phaseT)}`
        : game.bombState === 'planted' ? fmtTime(game.bombTimer)
        : fmtTime(game.phaseT);
      this.el.timer.classList.toggle('planted', game.bombState === 'planted');
    }
    if (this.el.money) this.el.money.textContent = fmtMoney(p.money);
    if (this.el['score-v']) this.el['score-v'].textContent = String(game.score.sentinel);
    if (this.el['score-j']) this.el['score-j'].textContent = String(game.score.viper);
    if (this.el['round-num']) this.el['round-num'].textContent = `ROUND ${Math.max(1, game.round)}`;
    if (this.el['round-dots']) {
      this.el['round-dots'].textContent = game.roundHistory.map((r) => (r === 'S' ? '●' : '○')).join(' ');
    }
    if (this.el['alive-v']) this.el['alive-v'].textContent = `S ${game.aliveCount('sentinel')}`;
    if (this.el['alive-j']) this.el['alive-j'].textContent = `V ${game.aliveCount('viper')}`;
    // Bomb status line
    const bs = this.el['bomb-status'];
    if (bs) {
      if (game.bombState === 'planted') {
        bs.textContent = `BOMB PLANTED — SITE ${game.plantedSite}`;
        bs.classList.add('danger');
      } else if (game.bombState === 'dropped') {
        bs.textContent = 'BOMB DROPPED';
        bs.classList.remove('danger');
      } else if (p.bombCarrier) {
        bs.textContent = 'YOU CARRY THE BOMB — PLANT AT A OR B (HOLD E)';
        bs.classList.add('danger');
      } else {
        bs.textContent = '';
        bs.classList.remove('danger');
      }
    }
    // Plant / defuse progress
    const pb = this.el['plant-bar'];
    if (pb) {
      const planting = p.plantProgress > 0;
      const defusing = p.defuseProgress > 0;
      pb.hidden = !planting && !defusing;
      if (planting) {
        this.el['plant-label'].textContent = 'PLANTING BOMB…';
        this.el['plant-fill'].style.width = `${p.plantProgress * 100}%`;
      } else if (defusing) {
        this.el['plant-label'].textContent = 'DEFUSING…';
        this.el['plant-fill'].style.width = `${p.defuseProgress * 100}%`;
      }
    }
    // Hint line
    if (this.el.hint) {
      if (game.phase === 'buy') this.el.hint.textContent = 'Buy phase — B for shop · 1–5 weapons · 6 grenade';
      else if (!p.alive) this.el.hint.textContent = 'You are down — spectating your team';
      else if (p.bombCarrier) this.el.hint.textContent = 'Carry the bomb to Site A or B — hold E to plant';
      else this.el.hint.textContent = '';
    }
    this.drawMinimap();
    this.drawCompass();
  }
}
