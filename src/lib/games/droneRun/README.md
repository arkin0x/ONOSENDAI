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
| `client` | Model refs, colours, fog distances for drawing, viewmodel offsets, camera bob, sounds (`sounds`: each drone id's looping voice, its pitch, waveforms, chop, filter, level, attack rise and windup whine; `sounds.voices`: how many are heard at once on a phone and a desktop, how far they carry, Doppler and wall muffling; `sounds.ui.<control>`: each control's short press sound (fire, jump, sprintOn, sprintOff, lockout, switch, reload, restart, nextWave, exit, sound), as layers of swept tones and filtered noise with a repeat gap; `sounds.hit`, `sounds.kill`, `sounds.miss`: the hitmarker (with each gun's pitch), the kill shot and an aimed pull sent wide, in the same form). So no enemy may have the id `voices`, `ui`, `hit`, `kill` or `miss`: `createRun` rejects it | (c) |

### spec

| Field | Meaning | Class |
|---|---|---|
| `settings` | `mode` ["walk"], `gravity` "on", `view` "first-person", `facing` "-z", `motion` "fluid": the movement model the run uses (WALK's gravity and jumps, fluid WALK's acceleration) | (b) |
| `player.hp` | HP at the start (3) | (b) |
| `player.invulnMs` | After a hit, no damage for this long (ms) | (b) |
| `player.height`, `radius`, `eye` | The body: 2 tall, 0.35 radius, eye 1.75 above the feet | (b) |
| `player.stamina` | Sprint (RunInput.sprint, below): `{ max, drainPerS, refillPerS, refillDelayS, lockoutS, speedMul }`; base 100, 35, 25, 0.6 s, 1.2 s, 1.6. Without it, sprint does nothing | (b) |
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
| `assistHit` | Share of aimed pulls that land, 0..1 (default 1). Each aimed pull rolls on the run's assist stream (the assist roll, below); a roll at or above this goes wide. Only with `assist`. Base PULSE RIFLE: 0.85 | (b) |
| `assistMissBy` | How far a wide aimed pull clears the drone's surface, gibsons (default 1). Only with `assist` | (b) |
| `assist` | `"auto"`: the gun may take aimed shots (`RunInput.aim`, below); only on a hitscan gun whose `mode` is `"auto"`, and `createRun` rejects it anywhere else (a semi gun fires once a press, so a held assisted trigger would latch; a charge gun fires on release, which a held trigger never gives, and its release step carries no aim). The base variant gives it to the PULSE RIFLE alone. The simulation reads it (an aim is honoured only for such a gun), so it is a rule; when a client sends aims (ONOSENDAI: only on a touch screen, while a drone is in the box round the reticle) is the client's (c) | (b) |

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
| `attack` | `{ kind: "contact" or "shot", damage (always 1), cooldownS, shot?: { speed, radius, range, windupS }, burst?, burstGapS?, lead?, leadMaxS? }` | (b) |
| `attack.lead`, `attack.leadMaxS` | How much a shot leads a moving player, 0..1 (default 0), and the longest prediction, seconds (default 1.5). Leading below. Base: sniper 1 and 3 s, heavy 0.7 and 3 s | (b) |
| `altitude` | `{ min, max }` above the ground under it | (b) |
| `dive` | Optional dive tuning: `commitRange`, `speedFactor`, `maxS`, `pullUpS`, `hoverAbove`, `track` | (b) |
| `dive.track` | How fast a dive re-aims, degrees a second (default 0: the point stays locked). Tracking below. Base scout: 90 | (b) |
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

### RunInput.aim (an aimed shot)

| Field | Meaning | Class |
|---|---|---|
| `aim` | Optional `{ yaw, pitch }`, in the look's terms. On a step where the gun in hand fires and its def has `assist: "auto"`, every pellet goes exactly along the aim, with no spread, instead of along the look, unless the assist roll (below) sends the pull wide. The look (camera, body) is untouched. Ignored on a step with no shot, by any other gun, and when not finite. The two spread draws are still taken, so the guns' random stream is the same with or without aims. It is in the input log, so a replay is exact | (b) |

A checker cannot tell an aim sent by an assist from an aimbot's: the log only shows that the player's client chose the direction. What the rules can say is which guns may carry an aim (`assist`); a stricter rule set could also cap how far an aim may stray from the look.

### The assist roll (which aimed shots miss)

A rule (b): which shots may miss changes where shots land, so a checker must roll exactly as the simulation does.

- The stream: the run's fourth generator, mulberry32 (sim/rng.ts) seeded `mixSeeds(mixSeeds(run seed, wave seed), 4)` (the guns' spread is 1, the drones 2, the spawns 3). Only aimed pulls draw from it, so a run with no aims never touches it, and every other stream draws exactly what it would without the roll.
- The draws: every aimed pull of an assist gun (a step whose gun in hand fires and whose input carries a finite `aim`) draws two numbers, always both, in this order: `roll`, then `turn`. One pair a pull, whatever the pellet count.
- Hit or wide: `roll < assistHit` lands along the aim. Otherwise the pull goes wide: the aimed drone is the first live drone the aimed line meets before a solid, within the gun's range (the hitscan cast, from the eye, at the drones where the last step left them). Every pellet then leaves along the line from the eye to that drone's centre, tilted away from it by the angle whose sine is `(radius + assistMissBy) / distance` (90 degrees when the eye is closer than that), toward the side `turn * 2 pi` names round the line, in the spread cone's basis (sim/weapons.ts `tilt`). Its closest pass to the centre is `radius + assistMissBy`, so it clears the drone by `assistMissBy` and passes visibly beside it. It can still hit another drone in its way. A wide pull whose aimed line meets no drone keeps its aim.
- The shot event carries `wide: true` for a wide pellet, for the view (class c how it looks).

### RunInput.sprint

| Field | Meaning | Class |
|---|---|---|
| `sprint` | Optional, held (absent is false). While held, a move is held (the wish, the move's length after it is kept inside the unit circle, is at least 0.2, SPRINT_MIN_PUSH in sim/player.ts, so a thumb resting near the stick's centre spends nothing) and stamina is above 0 with no lockout running, the top speed is `speedMul` times fluid WALK's and stamina drains `drainPerS` a second; the refill delay restarts. Running dry starts a lockout of `lockoutS`, during which sprint does nothing. Any step not sprinting counts the lockout and the delay down, then refills `refillPerS` a second up to `max`. Acceleration and braking stay fluid WALK's (let go above the walking top speed, the body brakes at FLUID_DECEL). It is in the input log, so a replay is exact | (b) |

### Leading shots and tracking dives

Rules (b), with no random draws: both are functions of the state alone, so a replay is exact.

- Leading: a shot fired while the drone sees the player aims at the chest plus the player's level velocity (the body's velocity with its vertical part dropped: a jump is not predicted) times `lead` times `t`. `t` is the intercept time of a bolt at `shot.speed` from the drone's centre, leaving `radius + shot.radius + 0.05` out along its way, against a target at the chest moving at the full level velocity: the smallest t above 0 with |chest + v t - drone| = offset + speed t (sim/drones.ts `interceptTime`), held to `leadMaxS`. When there is none (the player faster than the bolt, as when sprinting across a heavy), `t` is instead the time the player passes closest to the drone's centre, the t minimising |chest + v t - drone| (sim/drones.ts `closestApproachTime`), held to `leadMaxS`, and 0 when that is not after now (the player already moving away). Lead 1 meets a player running in a straight line at constant speed; a change of direction after the shot still dodges it. Out of sight, the drone fires at the last known place, unled. Each shot of a burst is led as it is fired.
- Tracking: while diving and seeing the player, the level bearing of the dive's heading (from the drone to its locked point) turns toward the chest's bearing by at most `track` degrees a second; the locked point keeps its height and its distance from the drone (sim/drones.ts `trackDive`). So moving across a dive no longer dodges it, a late sidestep faster across than the drone can turn still does, and running straight at it meets it no sooner than a locked dive (the drone speed test's 1.6 s floor holds).

### What the simulation reads from the level

`level.json` (the level agent's format) must carry `zones.start`, `zones.finish`, `entry` (a point at or a little above the floor, or `{ at, yaw }`) and `spawns` (a list of `{ id, at }` or a map from id to point). Zones should reach well above the floor: jumping out of the top of the start zone counts as leaving it.

## Making a new variant

1. Copy `variants/drone-run-base.json` to `variants/<new-id>.json` and change `id` and `name`.
2. Change numbers in `spec`: guns, drones, waves, scoring. Spawn points named in waves must exist in the level.
3. Keep `world.level` pointing at a built level, and `client` for the look.
4. Load it like the base variant; `createRun` checks it (unknown enemy or spawn point, a gun with both or neither of heat and ammo, `assist` on a gun that is not auto hitscan, `assistHit` outside 0 to 1 or either assist number without `assist`, a stamina number below 0 or a zero `max` or `speedMul`) and throws with a plain message.

## The simulation in one paragraph

`createRun(variant, solids, { level, seed, wave })` makes a run; `stepRun(state, input)` advances it one fixed step of 1/60 s, mutating the state in place, and lists what happened in `state.events`. Inputs are `{ move: { fwd, strafe }, yaw, pitch, jump, fire, select, reload, aim?, sprint? }`. Within a step the body moves first, then the guns fire (from the moved eye, at the drones where the last step left them), then drones spawn, move and attack. `restart` and `nextWave` return fresh states; `stateHash` fingerprints a state. The run is a pure function of the variant, the solids, the level, the seed and the input log, so another client can replay it.

### Replay across engines

The replay holds inside one JavaScript engine: the same inputs give the same `stateHash`. Across engines it may not. ECMAScript lets `Math.sin`, `cos`, `atan2`, `hypot` and `exp` differ in the last bits between V8, JavaScriptCore and SpiderMonkey, and over thousands of steps that can change a hit. A client in another engine or language that wants to check someone else's run would need positions and velocities in fixed point, or fixed approximations of those functions. Until then, a replay check is only good within the engine that recorded the run.
