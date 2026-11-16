# Ironworks Protocol — a three.js tactical FPS

A round-based tactical first-person shooter in the Counter-Strike style, built
for the make.fun bounty "Make the best three.js tactical FPS". Two teams of five
fight short rounds on a dusk industrial yard: the Vipers plant the bomb at Site A
or Site B (or eliminate the Sentinels), the Sentinels defend, defuse, or wipe
the attackers out. First to 8 rounds takes the match (15 rounds max). You play
as a Sentinel against 9 bots. Everything is original: our own map, art, sounds
and names. No build step, no network requests — static files plus three.js.

## Play it

```
node serve.ts        # serves game/ on http://localhost:8080
```

Open the page, click **Click to play**. The game runs in a desktop browser
with WebGL2. Screenshots are staged deterministically: open
`?shot=menu|combat|buy|plant&seed=1` and the game freezes one exact frame.

## The map: Ironworks District (56 x 40 m)

- **Two bomb sites.** Site A is the Furnace Hall (north-east), lit by the
  furnace mouth; Site B is the Crane Yard (south-east), under a yellow gantry
  crane. Each site is marked on the floor and on the minimap.
- **Three lanes.** North lane past the silos, south lane past the containers,
  and mid through the machine hall — plus an **elevated catwalk** across mid
  with a ramp at each end. Height is a real choice: the catwalk sees both
  sites, but its rails leave you exposed.
- **Real cover.** Shipping containers, crates, silos, pillars and the furnace
  itself break sightlines. Crates are low enough to shoot over; containers are
  not. Bullets collide with the world (ray vs AABB), so cover works.
- **Dusk light.** A low amber sun with soft shadows, a cool hemisphere fill,
  fog, and a painted gradient sky. All textures (concrete, corrugated metal,
  hazard stripes) are drawn on canvas at load time — no image files.

## The guns (buy phase, keys 1–8 or click)

| Weapon | Price | Character |
| --- | --- | --- |
| P9 Sidearm | $0 | 12 rounds, reliable, infinite reserve |
| Kestrel SMG | $900 | 30 rounds, close quarters, wide spread |
| Breacher 12G | $1,500 | 8 pellets, devastating up close, useless far |
| Mantis Rifle | $2,200 | 25 rounds, the all-rounder |
| Tempest LMG | $3,200 | 60 rounds, holds a lane, slows you down |
| Longbow DMR | $3,800 | 5 rounds, scoped, one-shot headshot |
| HE Grenade | $300 | Arcing throw, bounce, 6.5 m blast |
| Kevlar Vest | $650 | Halves damage taken (100 points) |
| Defuse Kit | $400 | Defuse in 2.5 s instead of 5 s |

Every gun has its own damage, rate of fire, magazine, spread (standing,
moving, airborne), recoil kick and movement penalty, plus range falloff — so
accuracy beats fire rate at distance and the shotgun wins the corridors the
rifle loses. The crosshair opens up as spread grows. Bought weapons stay in
slots 1–6 across rounds; money carries over.

## The economy

Kill +$300, plant +$300, defuse +$300. Round win +$3,250, round loss
+$1,900 plus $500 per consecutive loss (up to two) so a team can always buy
back in. Start money $800: a pistol round, then real guns from round two.

## The bots (9 of them, 3 difficulty tiers)

- **Rookies** react in ~1 s, miss wide, move slowly. **Veterans** hold
  angles, trade kills and reload sensibly. **Elites** flank, pre-aim and
  punish — one elite per team, marked with a gold helmet stripe.
- Bots think in roles: the Viper carrier pushes its assigned site, others
  split across sites or flank via the catwalk; Sentinels hold sites or rotate.
  They path on a 28-node waypoint graph (BFS), never through walls.
- In a fight they strafe, fire in bursts with pauses, crouch when holding,
  and **retreat toward spawn when hurt**. When the bomb drops, the nearest
  Viper runs to pick it up; when it is planted, Vipers defend and Sentinels
  rush to defuse. The carrier plants only when the site looks clear.

## The round

Buy phase (15 s, shop with keys 1–8) → live round (100 s) → round end with
an MVP banner → next buy phase. The bomb takes 3 s to plant (hold E in a
site) and 5 s to defuse (2.5 s with a kit); it detonates 35 s after the
plant, beeping faster as it nears zero. Time expiring with no plant hands the
round to the Sentinels.

## The HUD

Health and armour bars, ammo and reserve, money, round timer (red while the
bomb ticks), team score with a round-history strip, alive counts, a **live
minimap** (walls, catwalk, sites, every player, blinking planted bomb),
a **compass strip**, killfeed, hitmarkers (red on kill), a damage vignette,
a plant/defuse progress bar and a death spectate camera that follows a living
teammate.

## Feel

Muzzle flash light plus tracer lines, impact sparks, grenade explosions with
light and smoke, screen shake on firing, footstep and reload sounds, weapon
cracks that differ per gun, bomb beeps and round stingers — all synthesised
with WebAudio, no audio files.

## Controls

- **W A S D** move · **Shift** run · **Ctrl** crouch · **Space** jump
- **Mouse** look · **Click** fire · **Right mouse** scope (Longbow)
- **R** reload · **G** throw grenade · **E** plant / defuse (hold)
- **1–6** weapons · **B** buy menu (buy phase only)

## How it is built

- `game/index.html` — the shell and all HUD markup/CSS.
- `game/src/main.js` — bootstrap, frame loop, player controller, tracers,
  particles, bomb meshes, deterministic `?shot=` staging.
- `game/src/world.js` — the map: geometry, canvas textures, colliders, the
  catwalk height field, the waypoint graph and BFS pathfinding.
- `game/src/actors.js` — bodies (player + bots): movement with AABB
  collision, gravity and jumping, hitscan shooting with body/head boxes,
  kevlar, grenade throws.
- `game/src/bots.js` — bot AI: roles, waypoint pathing, engagement bursts,
  strafing, retreat, plant/defuse, difficulty tiers.
- `game/src/game.js` — the match: round state machine, economy, bomb timer,
  grenade physics, scoring, MVP.
- `game/src/hud.js` — the HUD: minimap, compass, killfeed, buy menu.
- `game/src/input.js` — keyboard/mouse/pointer-lock input (lock failures
  never throw, so headless tests keep running).
- `game/src/weapons.js` — the six guns, gear prices, range falloff.
- `game/src/audio.js` — WebAudio synthesis for every sound.
- `game/src/util.js` + `game/src/palette.js` — seeded RNG, ray/box math,
  canvas textures.
- `game/vendor/three/` — three.js 0.187.0 (module + core) from the kit.
- `main.ts` — copies `game/` and `screenshots/` to `/output` and writes
  `dossier.json` with the kit's vendored `vendor/makefun-threejs.ts`.
- `serve.ts` — a tiny static server for local play-testing.

## Screenshots

Four staged frames, all rendered by the game itself with `?shot=…&seed=1`:

1. `1-menu.jpg` — the menu over the yard.
2. `2-combat.jpg` — mid-lane firefight, tracer in flight.
3. `3-buy.jpg` — the buy phase shop.
4. `4-plant.jpg` — planting at Site A.

## License

MIT — see `LICENSE`. three.js is MIT-licensed (see
`game/vendor/three/LICENSE`).
