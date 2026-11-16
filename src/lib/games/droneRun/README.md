# DRONE RUN: variants and the simulation

A DRONE RUN variant is one JSON data file in `variants/`, typed by `types.ts`. The simulation in `sim/` plays any variant against any level; a new variant needs no code.

## Ledger classes

Every field below is tagged:

- (a) existing primitive: expressible today with Cyberspace and DECKs (shards in region bags, constrain, DECK-0002 entry and exit).
- (b) game-spec candidate: generic rules any client could implement from the published data.
- (c) client only: look, sound and feel. Never in a protocol; the simulation never reads it.

## Units and frame

- Distances in gibsons, times in seconds (`invulnMs` in milliseconds), speeds in gibsons per second, angles in degrees (spread) or radians (turn rates, look).
- Coordinates are region-local gibsons on cyberspace axes: +X right, +Y up, the run goes toward -Z. A whole number is the centre of its gibson (where a shard placed there has its origin), so gibson n spans n - 0.5 to n + 0.5.
- A zone is a box of whole gibsons with both corners included: as a solid box it spans `lo - 0.5` to `hi + 0.5` on each axis.
- Hand: the spec's (spec §11.3, DECK-0002 §9.4): facing +Z, right is +X. The run faces -Z at yaw 0, so there right is -X. In the input, strafe +1 is right in that sense, and increasing yaw turns left (toward +X at yaw 0), as ONOSENDAI's camera yaw does: forward is (sin yaw, 0, -cos yaw), right (-cos yaw, 0, -sin yaw). An input log is recorded in these terms, with no flip anywhere.

## The file

| Field | Meaning | Class |
|---|---|---|
| `format` | Always `"drone-run/1"` | (b) |
| `id`, `name` | The variant's id and shown name | (b) |
| `spec` | The rules (below) | (b) |
| `world.level` | The level the world was built from; the world itself is shards in the region's bags, read like any game world | (a) |
| `client` | Model refs, colours, fog distances for drawing, viewmodel offsets, camera bob, sounds | (c) |

### spec

| Field | Meaning | Class |
|---|---|---|
| `settings` | `mode` ["walk"], `gravity` "on", `view` "first-person", `facing` "-z", `motion` "fluid": the movement model the run uses (WALK's gravity and jumps, fluid WALK's acceleration) | (b) |
| `player.hp` | HP at the start (3) | (b) |
| `player.invulnMs` | After a hit, no damage for this long (ms) | (b) |
| `player.height`, `radius`, `eye` | The body: 2 tall, 0.35 radius, eye 1.75 above the feet | (b) |
| `zones.start`, `zones.finish` | Copied from the level by the build; the simulation reads the level's own | (b) |
| `start` | `{ kind: "leave-zone", zone: "start" }`: the wave starts on the first step the body's box no longer overlaps the start zone | (b) |
| `win` | `{ kind: "reach-zone", zone: "finish" }`: cleared on the first step the body's box overlaps the finish zone | (b) |
| `lose` | `{ kind: "hp-zero" }` | (b) |
| `weapons` | WeaponDef list; the first is in hand at the start | (b) |
| `enemies` | DroneDef list | (b) |
| `waves` | WaveScript list, played in order | (b) |
| `afterLast` | After the last wave: `"repeat-last"` (default) or `"wrap"` | (b) |
| `scoring.perKill` | Points a kill, by enemy id | (b) |
| `scoring.timeBonus` | `{ parS, perSecond }`: points for each second under par | (b) |

### WeaponDef

| Field | Meaning | Class |
|---|---|---|
| `id`, `name` | | (b) |
| `fire` | `"hitscan"` (a straight line, lands at once) or `"projectile"` (flies at `projectileSpeed`) | (b) |
| `mode` | `"auto"` while held, `"semi"` once a press, `"charge"` fires on release | (b) |
| `rate` | Trigger pulls a second at most; the cadence is exact (the remainder carries over) | (b) |
| `damage` | Damage of one pellet at full strength (a charge gun's at `charge.minS`) | (b) |
| `range` | Longest reach (a charge gun's at `charge.minS`) | (b) |
| `falloff` | `{ start, end, minFactor }`: full damage to `start`, straight down to `minFactor` at `end` | (b) |
| `spread` | Cone half-angle, degrees; each pellet is seeded and uniform over the cone's cap | (b) |
| `pellets` | Pellets a pull (default 1) | (b) |
| `pierce` | Drones a shot passes through after the first it hits (default 0) | (b) |
| `projectileSpeed`, `projectileRadius` | Projectile guns only (radius default 0.1) | (b) |
| `charge` | `{ minS, maxS, damageMax, rangeMax }`: damage and range scale straight from minS to maxS | (b) |
| `heat` | `{ perShot, coolPerS, overheatAt, lockS }`; cools while holstered too | (b) |
| `ammo` | `{ mag, reloadS }`; empty reloads by itself; switching away cancels a reload | (b) |
| `readyS` | Seconds after switching before it fires (default 0.3) | (b) |

Exactly one of `heat` or `ammo`.

### DroneDef

| Field | Meaning | Class |
|---|---|---|
| `id`, `name`, `hp` | | (b) |
| `radius` | Collision sphere | (b) |
| `speed`, `accel`, `turnRate` | Top speed, most change of velocity a second, fastest heading turn (rad/s) | (b) |
| `behaviour` | `"dive"`, `"standoff"`, `"tank"` or `"swarm"` (sim/drones.ts describes each) | (b) |
| `detect` | Sees the player only within this AND with a clear line of sight | (b) |
| `loseAfterS` | Seconds out of sight before it gives up and patrols | (b) |
| `preferRange` | The range a standoff or tank drone holds (band of 4 either side) | (b) |
| `attack` | `{ kind: "contact" or "shot", damage (always 1), cooldownS, shot?: { speed, radius, range, windupS }, burst?, burstGapS? }` | (b) |
| `altitude` | `{ min, max }` above the ground under it | (b) |
| `dive` | Optional dive tuning: `commitRange`, `speedFactor`, `maxS`, `pullUpS`, `hoverAbove` | (b) |
| `swarm` | Optional swarm tuning: `separation`, `neighbour`, `cohesion` | (b) |

### WaveScript

| Field | Meaning | Class |
|---|---|---|
| `id`, `name` | | (b) |
| `seed` | uint32, mixed with the run's seed: the same seed and inputs replay the same run | (b) |
| `maxAlive` | Most drones alive at once; a due spawn waits for a slot | (b) |
| `spawns[].at` | A level spawn point id, or a region-local point | (b) |
| `spawns[].enemy`, `count` | Which drone and how many | (b) |
| `spawns[].delayS`, `every` | First drone `delayS` after the line starts, then one each `every` (all at once without) | (b) |
| `spawns[].trigger` | `{ kind: "time", value }` (seconds into the wave) or `{ kind: "player-z-below", value }`; without one the line starts with the wave | (b) |

### What the simulation reads from the level

`level.json` (the level agent's format) must carry `zones.start`, `zones.finish`, `entry` (a point at or a little above the floor, or `{ at, yaw }`) and `spawns` (a list of `{ id, at }` or a map from id to point). Zones should reach well above the floor: jumping out of the top of the start zone counts as leaving it.

## Making a new variant

1. Copy `variants/drone-run-base.json` to `variants/<new-id>.json` and change `id` and `name`.
2. Change numbers in `spec`: guns, drones, waves, scoring. Spawn points named in waves must exist in the level.
3. Keep `world.level` pointing at a built level, and `client` for the look.
4. Load it like the base variant; `createRun` checks it (unknown enemy or spawn point, a gun with both or neither of heat and ammo) and throws with a plain message.

## The simulation in one paragraph

`createRun(variant, solids, { level, seed, wave })` makes a run; `stepRun(state, input)` advances it one fixed step of 1/60 s, mutating the state in place, and lists what happened in `state.events`. Inputs are `{ move: { fwd, strafe }, yaw, pitch, jump, fire, select, reload }`. `restart` and `nextWave` return fresh states; `stateHash` fingerprints a state. The run is a pure function of the variant, the solids, the level, the seed and the input log, so another client can replay it.

### Replay across engines

The replay holds inside one JavaScript engine: the same inputs give the same `stateHash`. Across engines it may not. ECMAScript lets `Math.sin`, `cos`, `atan2`, `hypot` and `exp` differ in the last bits between V8, JavaScriptCore and SpiderMonkey, and over thousands of steps that can change a hit. A client in another engine or language that wants to check someone else's run would need positions and velocities in fixed point, or fixed approximations of those functions. Until then, a replay check is only good within the engine that recorded the run.
