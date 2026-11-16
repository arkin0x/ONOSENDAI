/**
 * types.ts - the DRONE RUN data format: a variant file (variants/<id>.json)
 * and the level facts the simulation reads (zones, entry, spawn points).
 *
 * A variant is laid out by ledger class (see README.md and the drone run
 * design note): `spec` is the game-spec candidate (b), the rules any client
 * could implement from published data; `world` names the world, which is
 * shards in the region's bags (a); `client` is this client's own look and
 * feel (c), never read by the simulation.
 *
 * Every coordinate is in region-local gibsons, cyberspace axes: +X right, +Y
 * up, the run goes toward -Z. A whole number is the centre of its gibson,
 * where a shard placed there has its origin, so a gibson n spans n - 0.5 to
 * n + 0.5. A zone is a box of whole gibsons, both corners included: as a
 * solid box it spans lo - 0.5 to hi + 0.5 on each axis.
 */

/** Three numbers on cyberspace axes x, y, z, in region-local gibsons (or gibsons per second for a velocity). */
export type Vec3 = [number, number, number]

/** A box of whole gibsons, both corners included. */
export interface ZoneBox {
  lo: Vec3
  hi: Vec3
}

/** Heat: each shot adds `perShot`; it cools `coolPerS` a second; reaching `overheatAt` locks the gun for `lockS`. */
export interface HeatDef {
  perShot: number
  coolPerS: number
  overheatAt: number
  lockS: number
}

/** A magazine: `mag` trigger pulls, then a reload of `reloadS` seconds. */
export interface AmmoDef {
  mag: number
  reloadS: number
}

/** A charge gun: hold at least `minS` to fire; `maxS` and longer gives `damageMax` and `rangeMax`. */
export interface ChargeDef {
  minS: number
  maxS: number
  damageMax: number
  rangeMax: number
}

/** Damage over distance: full up to `start`, falling straight to `minFactor` of it at `end` and beyond. */
export interface FalloffDef {
  start: number
  end: number
  minFactor: number
}

/** One of the player's guns. Exactly one of `heat` or `ammo`. */
export interface WeaponDef {
  id: string
  name: string
  /** A hitscan shot lands at once along a straight line; a projectile flies at `projectileSpeed`. */
  fire: 'hitscan' | 'projectile'
  /** auto fires while held; semi once a press; charge fires on release after charging. */
  mode: 'auto' | 'semi' | 'charge'
  /** Trigger pulls per second at most. */
  rate: number
  /** Damage of one pellet at full strength (a charge gun's at `charge.minS`). */
  damage: number
  /** The longest reach, in gibsons (a charge gun's at `charge.minS`). */
  range: number
  falloff?: FalloffDef
  /** Half-angle of the spread cone, in degrees. 0 is dead straight. */
  spread: number
  /** Pellets a trigger pull, each with its own spread. Default 1. */
  pellets?: number
  /** Gibsons per second (projectile only). */
  projectileSpeed?: number
  /** A projectile's radius, gibsons (projectile only). Default 0.1. */
  projectileRadius?: number
  charge?: ChargeDef
  /** How many drones a shot passes through after the first it hits. Default 0. */
  pierce?: number
  /** Seconds after switching to it before it can fire. Default 0.3. */
  readyS?: number
  heat?: HeatDef
  ammo?: AmmoDef
  /**
   * "auto": this gun may take an aimed shot (RunInput.aim): a shot fired on
   * a step that carries an aim goes exactly along it, with no spread. Only
   * a hitscan gun may carry it. Without it, the simulation ignores any aim
   * and the gun fires along the look. A client decides when to send an aim
   * (ONOSENDAI: a touch screen's aim assist, which also pulls the trigger
   * when a drone is in the box around the reticle).
   */
  assist?: 'auto'
}

/** A drone's projectile: slow enough to see and dodge, stopped by any solid. */
export interface DroneShotDef {
  /** Gibsons per second. */
  speed: number
  /** Gibsons. */
  radius: number
  /** The farthest it flies, gibsons; also the farthest a drone opens fire from. */
  range: number
  /** The telegraph before it fires, seconds. */
  windupS: number
}

/** How a drone hurts the player. */
export interface DroneAttackDef {
  kind: 'contact' | 'shot'
  /** HP a hit costs. Always 1 for now. */
  damage: number
  /** Seconds between attacks (between bursts for a burst). */
  cooldownS: number
  shot?: DroneShotDef
  /** Shots in one burst (tank). Default 1. */
  burst?: number
  /** Seconds between the shots of a burst. Default 0.25. */
  burstGapS?: number
}

/** Optional tuning of the dive (scout) behaviour; every field has a default (sim/drones.ts DIVE_DEFAULTS). */
export interface DiveTuning {
  /** It commits to a dive from this close, gibsons. */
  commitRange?: number
  /** Its speed in a dive, as a multiple of `speed`. */
  speedFactor?: number
  /** The longest dive, seconds. */
  maxS?: number
  /** How long it climbs away after a dive, seconds. */
  pullUpS?: number
  /** How high above the player it hangs while lining up a dive, gibsons. */
  hoverAbove?: number
}

/** Optional tuning of the swarm behaviour (sim/drones.ts SWARM_DEFAULTS). */
export interface SwarmTuning {
  /** Keep at least this far from other swarmers, gibsons. */
  separation?: number
  /** Swarmers within this distance are one group, gibsons. */
  neighbour?: number
  /** Weight of the pull toward the group's middle. */
  cohesion?: number
}

/** One kind of enemy drone. */
export interface DroneDef {
  id: string
  name: string
  hp: number
  /** Its collision sphere, gibsons. */
  radius: number
  /** Top speed, gibsons per second. */
  speed: number
  /** Most change of velocity a second, gibsons per second per second. */
  accel: number
  /** Fastest turn of its heading, radians per second. */
  turnRate: number
  behaviour: 'dive' | 'standoff' | 'tank' | 'swarm'
  /** It notices the player only within this range and with a clear line of sight, gibsons. */
  detect: number
  /** Seconds without sight before it gives up the chase and patrols. */
  loseAfterS: number
  /** The distance it holds from the player (standoff, tank), gibsons. */
  preferRange?: number
  attack: DroneAttackDef
  /** The band it flies in, gibsons above the ground under it. */
  altitude: { min: number; max: number }
  dive?: DiveTuning
  swarm?: SwarmTuning
}

/** What starts a spawn entry, besides the wave starting. */
export interface SpawnTrigger {
  /** time: `value` seconds after the wave starts. player-z-below: once the player's feet are at z below `value`. */
  kind: 'time' | 'player-z-below'
  value: number
}

/** One line of a wave script: `count` drones of one kind at one place. */
export interface WaveSpawn {
  /** A spawn point id from the level, or a region-local point. */
  at: string | Vec3
  /** A DroneDef id. */
  enemy: string
  count: number
  /** Seconds after the entry starts (the wave start, or its trigger) before the first drone. */
  delayS: number
  /** Seconds between drones of this entry. Absent or 0: all at once (as `maxAlive` allows). */
  every?: number
  trigger?: SpawnTrigger
}

/** One wave: what spawns, where and when. */
export interface WaveScript {
  id: string
  name: string
  /** Seeds the run's random numbers (with the run's own seed). */
  seed: number
  spawns: WaveSpawn[]
  /** Most drones alive at once; a spawn that is due waits for a slot. */
  maxAlive: number
}

/** The player body and its health. */
export interface PlayerSpec {
  hp: number
  /** No damage for this long after a hit, milliseconds. */
  invulnMs: number
  /** Gibsons. */
  height: number
  /** Gibsons. */
  radius: number
  /** Eye height above the feet, gibsons. */
  eye: number
}

/** Points for a clear (optional). */
export interface ScoringSpec {
  /** Points a kill, by DroneDef id. */
  perKill?: Record<string, number>
  /** `perSecond` points for each second the clear beats `parS`. */
  timeBonus?: { parS: number; perSecond: number }
}

/** The rules: what a games-rules DECK could standardise (class b). */
export interface DroneRunSpec {
  settings: { mode: string[]; gravity: 'on' | 'off'; view: 'first-person'; facing: '-z' | '+z' | '-x' | '+x'; motion: 'fluid' }
  player: PlayerSpec
  /** Copied from the level by the build; the simulation reads the level's own. */
  zones?: { start: ZoneBox; finish: ZoneBox }
  win: { kind: 'reach-zone'; zone: 'finish' }
  lose: { kind: 'hp-zero' }
  start: { kind: 'leave-zone'; zone: 'start' }
  weapons: WeaponDef[]
  enemies: DroneDef[]
  waves: WaveScript[]
  /** After the last wave: play it again, or go back to the first. Default repeat-last. */
  afterLast?: 'repeat-last' | 'wrap'
  scoring?: ScoringSpec
}

/** One variant file (format drone-run/1). */
export interface DroneRunVariant {
  format: 'drone-run/1'
  id: string
  name: string
  spec: DroneRunSpec
  /** Class (a): the world is shards in the region's bags; this names the level they were built from. */
  world: { level: string }
  /** Class (c): this client's look and feel. Never read by the simulation. */
  client?: Record<string, unknown>
}

/** A named spawn point of the level. */
export interface SpawnPoint {
  id: string
  at: Vec3
}

/**
 * What the simulation reads from a level (level.json, the level agent's
 * format; other fields are ignored here). `spawns` may be a list or a map
 * from id to point; `entry` a point or `{ at, yaw }`.
 */
export interface LevelInfo {
  id?: string
  zones: { start: ZoneBox; finish: ZoneBox }
  /** Where the player appears: at or a little above the floor, which the body is set down on. */
  entry: Vec3 | { at: Vec3; yaw?: number }
  spawns: SpawnPoint[] | Record<string, Vec3>
}

/** One step of player input. Look angles are absolute, not deltas. */
export interface RunInput {
  /**
   * fwd: +1 forward. strafe: +1 right of forward, in the spec's hand (spec
   * §11.3, DECK-0002 §9.4: facing +Z, right is +X; so facing -Z, the run's
   * way at yaw 0, right is -X). Each -1..1.
   */
  move: { fwd: number; strafe: number }
  /**
   * Radians about +Y. 0 faces -Z; increasing it turns left, toward +X (the
   * left of a viewer facing -Z), as ONOSENDAI's camera yaw turns: forward is
   * (sin yaw, 0, -cos yaw) and right (-cos yaw, 0, -sin yaw).
   */
  yaw: number
  /** Radians; positive looks up. */
  pitch: number
  /** Pressed this step (an edge, not held). */
  jump: boolean
  /** Held. */
  fire: boolean
  /** A weapon index to switch to this step, or null. */
  select: number | null
  /** Pressed this step (an edge). */
  reload: boolean
  /**
   * An aimed shot (optional): a shot the gun in hand fires this step goes
   * along this yaw and pitch (the same terms as the look) with no spread,
   * instead of along the look. Honoured only for a gun whose def has
   * `assist: "auto"`; ignored otherwise, and on a step with no shot. The
   * look, and so the camera and the body, are untouched. It is part of the
   * input log, so a replay is exact. Game-spec candidate (b): it changes
   * where a shot lands.
   */
  aim?: { yaw: number; pitch: number }
}
