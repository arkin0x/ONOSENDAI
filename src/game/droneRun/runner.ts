/**
 * runner.ts - one DRONE RUN being played: the simulation stepped at its fixed
 * 60 Hz from the screen's frames, what the view draws between two steps, and
 * what the HUD shows.
 *
 * - The run: solids from the session's world shards (runnerSolids), a
 *   RunState from createRun, restart and nextWave.
 * - The clock: `frame(dt)` from useFrame adds the frame's time to a carry
 *   and runs a fixed step for each STEP_S it owes (at most MAX_FRAME_S of a
 *   frame, so a stall never runs away). Each step reads its own input, once
 *   (input.ts readInput clears the edges it hands over), turned into the
 *   simulation's terms (frame.ts toSimInput), then touched by the touch aim
 *   assist (assist.ts: fire and an aim while a drone is in the box). The run
 *   is therefore a pure function of the input each step read, whatever the
 *   frame times were.
 * - Drawing between steps: before each step the runner keeps where the eye,
 *   every drone and every shot were (`prev`); `alpha()` is the share of a
 *   step the carry holds, so the view draws prev + (now - prev) * alpha.
 * - Paused (the page hidden, a card up): no steps, and the time away is
 *   dropped, not owed.
 * - The HUD: useDroneRunHud, a zustand store set only when a value it shows
 *   changed; heat, charge and the clock move every step, so they are rounded
 *   and refreshed at most 10 times a second (every HUD_EVERY steps).
 * - Events: onDroneRunEvent(cb) hears every step's events (sim/events.ts) in
 *   order, for the HUD's flashes and sounds and the view's effects.
 *
 * Nothing here reads a clock but `frame`'s dt, and nothing is sent anywhere.
 */

import { create } from 'zustand'
import {
  STEP_S, createRun, stepRun, restart as restartState, nextWave as nextWaveState, dronesLeft, stateHash, eyeOf,
  solidsFromShards, piecesFromWorld,
  type DroneRunVariant, type LevelInfo, type RunEvent, type RunInput, type RunState, type Solids, type Vec3,
} from '../../lib/games/droneRun/sim'
import type { WorldShard } from '../../lib/games/play'
import type { Position } from '../../lib/space'
import { lerp3, simYaw, toSimInput } from './frame'
import { noteWeapons, readInput, resetInput } from './input'
import { applyAssist } from './assist'

/** The longest frame the clock honours, seconds: a longer one (a stall, a tab coming back) owes no more than this. */
export const MAX_FRAME_S = 0.25
/** The HUD's moving values (heat, charge, the clock) refresh at most every this many steps: 10 a second. */
export const HUD_EVERY = 6

/** What the HUD shows. Every field is plain data; `weaponNames` keeps one reference for a run's variant. */
export interface DroneRunHud {
  phase: 'safe' | 'wave' | 'cleared' | 'failed'
  hp: number
  maxHp: number
  invulnerable: boolean
  /** The wave's number, from 1. */
  wave: number
  waveName: string
  wavesTotal: number
  /** Drones still to spawn plus drones alive. */
  dronesLeft: number
  /** The gun in hand. */
  weapon: number
  weaponNames: readonly string[]
  /** What each gun runs on, by index: 'heat' or 'ammo'; and whether it charges. */
  weaponKinds: readonly ('heat' | 'ammo')[]
  weaponCharges: readonly boolean[]
  /** The gun in hand's heat, 0..1 of its overheat point (0 for an ammo gun). Rounded to 0.02. */
  heat: number
  overheated: boolean
  /** Rounds in the mag and its size (0 and 0 for a heat gun). */
  ammo: number
  mag: number
  reloading: boolean
  /** Charge, 0..1 of the way to full (0 when not charging). Rounded to 0.05. */
  charge: number
  /** Seconds after a switch before the gun in hand fires: 0 when ready. */
  switching: boolean
  /** Seconds since the wave began (the clear time once cleared). Rounded to 0.1. */
  runTime: number
  kills: number
  score: number
}

const EMPTY_HUD: DroneRunHud = {
  phase: 'safe', hp: 0, maxHp: 0, invulnerable: false, wave: 1, waveName: '', wavesTotal: 0, dronesLeft: 0,
  weapon: 0, weaponNames: [], weaponKinds: [], weaponCharges: [], heat: 0, overheated: false, ammo: 0, mag: 0, reloading: false,
  charge: 0, switching: false, runTime: 0, kills: 0, score: 0,
}

/** The HUD's store: one snapshot, replaced only when a value in it changed. */
export const useDroneRunHud = create<DroneRunHud>(() => ({ ...EMPTY_HUD }))

type Listener = (ev: RunEvent, st: RunState) => void
const listeners = new Set<Listener>()

/** Hear every event of every step, in order. The return stops it. */
export function onDroneRunEvent(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Static facts about a variant's guns, made once per variant so the HUD's lists keep their references. */
const weaponFacts = new WeakMap<DroneRunVariant, Pick<DroneRunHud, 'weaponNames' | 'weaponKinds' | 'weaponCharges'>>()
function factsOf(v: DroneRunVariant): Pick<DroneRunHud, 'weaponNames' | 'weaponKinds' | 'weaponCharges'> {
  let f = weaponFacts.get(v)
  if (!f) {
    f = {
      weaponNames: Object.freeze(v.spec.weapons.map((w) => w.name)),
      weaponKinds: Object.freeze(v.spec.weapons.map((w) => (w.heat ? 'heat' : 'ammo') as 'heat' | 'ammo')),
      weaponCharges: Object.freeze(v.spec.weapons.map((w) => w.mode === 'charge')),
    }
    weaponFacts.set(v, f)
  }
  return f
}

/** `v` to the nearest `step` (a whole fraction such as 0.1), without float dust (5.3, not 5.300000000000001). */
const round = (v: number, step: number): number => Math.round(v / step) / Math.round(1 / step)

/**
 * The HUD's view of a state. `moving` false keeps heat, charge and the clock
 * as they are in `held` (between the 10 Hz refreshes).
 */
export function hudOf(st: RunState, held: DroneRunHud | null, moving: boolean): DroneRunHud {
  const v = st.world.variant
  const spec = v.spec
  const w = st.arsenal.current
  const def = spec.weapons[w]
  const g = st.arsenal.guns[w]
  const script = spec.waves[Math.min(st.wave, spec.waves.length - 1)]
  let kills = 0
  for (const k in st.kills) kills += st.kills[k]
  const time = st.phase === 'cleared' ? (st.clearTimeS ?? 0) : st.waveStep >= 0 ? st.waveStep * STEP_S : 0
  const c = def.charge
  const charge = g.charging && c ? Math.min(1, g.charge / Math.max(1e-6, c.maxS)) : 0
  return {
    phase: st.phase,
    hp: st.hp,
    maxHp: spec.player.hp,
    invulnerable: st.invuln > 0,
    wave: st.wave + 1,
    waveName: script.name,
    wavesTotal: spec.waves.length,
    dronesLeft: dronesLeft(st),
    weapon: w,
    ...factsOf(v),
    heat: moving || !held ? (def.heat ? round(Math.min(1, g.heat / def.heat.overheatAt), 0.02) : 0) : held.heat,
    overheated: g.lock > 0,
    ammo: def.ammo ? g.mag : 0,
    mag: def.ammo ? def.ammo.mag : 0,
    reloading: g.reload > 0,
    charge: moving || !held ? round(charge, 0.05) : held.charge,
    switching: st.arsenal.ready > 0,
    runTime: moving || !held || st.phase !== 'wave' ? round(time, 0.1) : held.runTime,
    kills,
    score: st.score,
  }
}

/** Whether two snapshots show the same thing. */
export function sameHud(a: DroneRunHud, b: DroneRunHud): boolean {
  for (const k in a) {
    const key = k as keyof DroneRunHud
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Where things were before the last step, for drawing between steps. Arrays are reused, never made per frame once warm. */
interface Prev {
  eye: Vec3
  drones: Map<number, Vec3>
  shots: Map<number, Vec3>
  projectiles: Map<number, Vec3>
}

function keep(map: Map<number, Vec3>, id: number, p: Readonly<Vec3>): void {
  const a = map.get(id)
  if (a) { a[0] = p[0]; a[1] = p[1]; a[2] = p[2] } else map.set(id, [p[0], p[1], p[2]])
}

/** Drops the entries of ids no longer alive, once the map holds many more than are. */
function prune(map: Map<number, Vec3>, alive: readonly { id: number }[]): void {
  if (map.size <= alive.length * 2 + 16) return
  const ids = new Set(alive.map((x) => x.id))
  for (const id of map.keys()) if (!ids.has(id)) map.delete(id)
}

/** How a runner is made. */
export interface RunnerOptions {
  level: LevelInfo
  seed?: number
  wave?: number
  /** Where each step's input comes from, in screen terms (input.ts). Default readInput. */
  input?: () => RunInput
  /** Keep the HUD store and the input module in step (default true; tests of the pure clock turn it off). */
  hud?: boolean
  /** Touches each step's input before it is stepped: the touch aim assist (assist.ts applyAssist) by default; false for none. */
  assist?: ((st: RunState, input: RunInput) => unknown) | false
}

/** The solids of the session's world, region-local (sim/fromShards.ts). */
export function runnerSolids(world: readonly WorldShard[], base: Position): Solids {
  return solidsFromShards(piecesFromWorld(world, base))
}

export class DroneRunner {
  state: RunState
  /** Seconds of real time owed to the next step. */
  carry = 0
  /** Steps run since the runner was made. */
  steps = 0
  paused = false
  /** Real time to run time: 1 normally; below 1 is slow motion (the DEV handle's, for recordings). The steps stay fixed. */
  timeScale = 1
  /** The charge of the gun in hand just before the last step (the rail's beam is as thick as its charge). */
  chargeBefore = 0
  readonly prev: Prev = { eye: [0, 0, 0], drones: new Map(), shots: new Map(), projectiles: new Map() }
  private readonly input: () => RunInput
  private readonly hud: boolean
  private readonly assist: ((st: RunState, input: RunInput) => unknown) | null
  private readonly simInput: RunInput = { move: { fwd: 0, strafe: 0 }, yaw: 0, pitch: 0, jump: false, fire: false, select: null, reload: false }
  private skipNext = false
  private sinceHud = HUD_EVERY

  constructor(variant: DroneRunVariant, solids: Solids, opts: RunnerOptions) {
    this.input = opts.input ?? readInput
    this.hud = opts.hud ?? true
    this.assist = opts.assist === false ? null : (opts.assist ?? applyAssist)
    this.state = createRun(variant, solids, { level: opts.level, seed: opts.seed ?? 0, wave: opts.wave ?? 0 })
    this.began()
  }

  /** The run's seed. */
  get seed(): number {
    return this.state.world.options.seed ?? 0
  }

  /** After a fresh state: nothing to draw between, the HUD and the input module told. */
  private began(): void {
    const st = this.state
    const eye = eyeOf(st.body, st.world.variant.spec.player)
    this.prev.eye[0] = eye[0]; this.prev.eye[1] = eye[1]; this.prev.eye[2] = eye[2]
    this.prev.drones.clear()
    this.prev.shots.clear()
    this.prev.projectiles.clear()
    this.carry = 0
    this.sinceHud = HUD_EVERY
    if (this.hud) {
      resetInput(simYaw(st.body.yaw), 0)
      noteWeapons(st.world.variant.spec.weapons.length, st.arsenal.current)
      this.publishHud(true)
    }
  }

  /** Keeps where everything is, for drawing between this step and the next. */
  private keepPrev(): void {
    const st = this.state
    const p = st.world.variant.spec.player
    this.prev.eye[0] = st.body.pos[0]; this.prev.eye[1] = st.body.pos[1] + p.eye; this.prev.eye[2] = st.body.pos[2]
    for (const d of st.drones) keep(this.prev.drones, d.id, d.pos)
    for (const s of st.droneShots) keep(this.prev.shots, s.id, s.pos)
    for (const s of st.projectiles) keep(this.prev.projectiles, s.id, s.pos)
    prune(this.prev.drones, st.drones)
    prune(this.prev.shots, st.droneShots)
    prune(this.prev.projectiles, st.projectiles)
  }

  /** One fixed step with the next input. */
  step(): void {
    const st = this.state
    this.keepPrev()
    const g = st.arsenal.guns[st.arsenal.current]
    this.chargeBefore = g.charging ? g.charge : 0
    const input = toSimInput(this.input(), this.simInput)
    this.assist?.(st, input)
    stepRun(st, input)
    this.steps++
    this.sinceHud++
    for (const ev of st.events) for (const l of listeners) l(ev, st)
  }

  /** A frame of `dt` seconds: runs the steps it owes. Returns how many ran. */
  frame(dt: number): number {
    if (this.paused) return 0
    if (this.skipNext) { this.skipNext = false; return 0 }
    let acc = this.carry + Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, MAX_FRAME_S))
    let n = 0
    while (acc >= STEP_S - 1e-9) {
      this.step()
      acc -= STEP_S
      n++
    }
    this.carry = Math.max(0, acc)
    if (n > 0 && this.hud) this.publishHud(false)
    return n
  }

  /** The share of a step the carry holds, 0 (just stepped) up to below 1. */
  alpha(): number {
    return Math.max(0, Math.min(1, this.carry / STEP_S))
  }

  /** The eye between the last two steps, region-local, into `out`. */
  eye(out: Vec3): Vec3 {
    const st = this.state
    const p = st.world.variant.spec.player
    const now: Vec3 = this.nowEye
    now[0] = st.body.pos[0]; now[1] = st.body.pos[1] + p.eye; now[2] = st.body.pos[2]
    return lerp3(out, this.prev.eye, now, this.alpha())
  }
  private readonly nowEye: Vec3 = [0, 0, 0]

  /** Something with an id and a position, drawn between the last two steps, into `out`. A thing new this step is drawn where it is. */
  between(kind: 'drones' | 'shots' | 'projectiles', id: number, pos: Readonly<Vec3>, out: Vec3): Vec3 {
    const was = this.prev[kind].get(id)
    return was ? lerp3(out, was, pos, this.alpha()) : lerp3(out, pos, pos, 0)
  }

  /** Why the run is paused: the page is hidden, a card is up. It goes on only when no reason is left. */
  private readonly pauses = new Set<string>()

  /** Pause or go on, for `why` (default 'hidden'). Going on drops the time away (the next frame runs no step). */
  setPaused(on: boolean, why = 'hidden'): void {
    if (on) this.pauses.add(why); else this.pauses.delete(why)
    const now = this.pauses.size > 0
    if (now === this.paused) return
    this.paused = now
    this.carry = 0
    if (!now) this.skipNext = true
  }

  /** Back to the safe zone: full HP, no drones, the same wave. */
  restart(): void {
    this.state = restartState(this.state)
    this.began()
  }

  /** The next wave from the safe zone. */
  nextWave(): void {
    this.state = nextWaveState(this.state)
    this.began()
  }

  /** The state's fingerprint (sim/hash.ts). */
  hash(): string {
    return stateHash(this.state)
  }

  /** Sets the HUD store if anything it shows changed. */
  private publishHud(force: boolean): void {
    const moving = force || this.sinceHud >= HUD_EVERY
    const cur = useDroneRunHud.getState()
    const next = hudOf(this.state, cur, moving)
    if (moving) this.sinceHud = 0
    if (!sameHud(cur, next)) useDroneRunHud.setState(next, true)
  }
}

/* ---------- the run on screen, for the HUD's buttons ---------- */

let active: DroneRunner | null = null

/** The runner on screen, or null (Canvas3D sets it). */
export function activeRunner(): DroneRunner | null {
  return active
}
export function setActiveRunner(r: DroneRunner | null): void {
  active = r
  if (!r) useDroneRunHud.setState({ ...EMPTY_HUD }, true)
}

/** RESTART: back to the safe zone, full HP, no drones. */
export function restartRun(): void {
  active?.restart()
}

/** NEXT WAVE: the next wave script, from the safe zone. */
export function nextWaveRun(): void {
  active?.nextWave()
}

/** A card up or down (the HUD's own pauses): no steps meanwhile. */
export function setRunPaused(on: boolean): void {
  active?.setPaused(on, 'card')
}
