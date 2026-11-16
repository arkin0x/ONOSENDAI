/**
 * Effects.tsx - what the guns and the drones' shots look like in the world:
 *
 * - tracers from the muzzle to where a hitscan pellet stopped, gone in
 *   TRACER_S (80 ms); the scatter's eight thinner; the rail's a thick bright
 *   beam as wide as its charge, lingering a little, with glow along it;
 * - a spark where a shot stops on a wall or a drone, a burst where a drone
 *   is destroyed (the effects payloads' points, grown and faded over their
 *   lifeS as rig.json says);
 * - drone shots in flight: the sniper's bolt and the heavy's ball, drawn at
 *   the size of their hit sphere with a streak behind them, so they are seen
 *   coming and can be dodged (their speed and size are the variant's, class
 *   b; the look is class c);
 * - the player's projectiles, for a variant whose gun fires them.
 *
 * Effects run on the screen's clock (they fade while paused too); they read
 * the run's events (runner.ts onDroneRunEvent) and draw through the view's
 * pools (fx.ts). Nothing allocates per frame once warm.
 */

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Quaternion, Vector3, type Camera } from 'three'
import type { RunEvent, RunState, Vec3 } from '../../lib/games/droneRun/sim'
import { onDroneRunEvent } from './runner'
import { toRender } from './frame'
import type { EffectModel } from './models'
import { PRIORITY, type DroneRunView } from './view'

/** How long a hitscan tracer shows, seconds. */
export const TRACER_S = 0.08
/** How much brighter than its GLOW STRENGTH an effect point is drawn: an effect is a light, on a dark field. */
export const EFFECT_BOOST = 1.6

const SLOTS = 96
const TRACERS = 160

interface Slot { model: EffectModel | null; m: Matrix4; born: number; life: number; scale: number; bright: number }
interface Tracer { a: Vector3; b: Vector3; born: number; life: number; width: number; rgb: [number, number, number]; beam: boolean }

/** The mean colour of an effect's points, for a streak of the same light. */
export function meanColor(e: Pick<EffectModel, 'colors'>): [number, number, number] {
  const c = e.colors
  const n = Math.max(1, c.length / 3)
  let r = 0, g = 0, b = 0
  for (let i = 0; i < c.length; i += 3) { r += c[i]; g += c[i + 1]; b += c[i + 2] }
  return [r / n, g / n, b / n]
}

const UP = new Vector3(0, 1, 0)
const ALT_UP = new Vector3(1, 0, 0)

/** A matrix at `pos` whose -Z runs along `dir` (both render frame), scaled by `s`. */
function aimed(out: Matrix4, pos: Vector3, dir: Vector3, s: number, target: Vector3): Matrix4 {
  target.copy(pos).sub(dir)
  // Matrix4.lookAt points +Z from target to eye: with the target behind, -Z faces along dir.
  out.lookAt(pos, target, Math.abs(dir.y) > 0.95 * dir.length() ? ALT_UP : UP)
  out.scale(target.set(s, s, s))
  out.setPosition(pos)
  return out
}

export class EffectsEngine {
  readonly slots: Slot[] = Array.from({ length: SLOTS }, () => ({ model: null, m: new Matrix4(), born: 0, life: 0, scale: 1, bright: 1 }))
  readonly tracers: Tracer[] = Array.from({ length: TRACERS }, () => ({ a: new Vector3(), b: new Vector3(), born: -1, life: 0, width: 0, rgb: [1, 1, 1], beam: false }))
  private slotAt = 0
  private tracerAt = 0
  /** The screen clock as of the last frame drawn, seconds. */
  now = 0
  private spin = 0
  private readonly v = new Vector3()
  private readonly w = new Vector3()
  private readonly t = new Vector3()
  private readonly m = new Matrix4()
  private readonly q = new Quaternion()
  private readonly weaponRgb: Array<[number, number, number]>
  private readonly drawn: Vec3 = [0, 0, 0]

  constructor(private readonly view: DroneRunView) {
    const ids = view.runner.state.world.variant.spec.weapons.map((w) => w.id)
    this.weaponRgb = ids.map((id) => {
      const flash = view.models.effects[view.models.weapons[id]?.flash ?? '']
      return flash ? meanColor(flash) : [0.6, 0.95, 1]
    })
  }

  /** An effect from its payload at `pos` (render frame), its -Z along `dir` (or turned at random), `scale` times its size. */
  spawn(id: string, pos: Vector3, dir: Vector3 | null, scale = 1, bright = 1): void {
    const model = this.view.models.effects[id]
    if (!model) return
    const s = this.slots[this.slotAt]
    this.slotAt = (this.slotAt + 1) % SLOTS
    s.model = model; s.born = this.now; s.life = Math.max(0.02, model.lifeS); s.scale = scale; s.bright = bright
    if (dir && dir.lengthSq() > 1e-12) aimed(s.m, pos, this.w.copy(dir).normalize(), scale, this.t)
    else {
      this.spin += 2.399963
      this.q.setFromAxisAngle(this.w.set(Math.sin(this.spin), Math.cos(this.spin * 1.7), Math.sin(this.spin * 0.6)).normalize(), this.spin)
      s.m.compose(pos, this.q, this.t.set(scale, scale, scale))
    }
  }

  tracer(a: Vector3, b: Vector3, width: number, life: number, rgb: [number, number, number], beam: boolean): void {
    const tr = this.tracers[this.tracerAt]
    this.tracerAt = (this.tracerAt + 1) % TRACERS
    tr.a.copy(a); tr.b.copy(b); tr.born = this.now; tr.life = life; tr.width = width; tr.rgb = rgb; tr.beam = beam
  }

  /** One event of a step. `camera` is the world camera (for where the muzzle is). */
  on(ev: RunEvent, st: RunState, camera: Camera): void {
    const spec = st.world.variant.spec
    switch (ev.type) {
      case 'shot': {
        if (ev.projectile !== undefined) return
        const def = spec.weapons[ev.weapon]
        toRender(ev.end, this.v)
        camera.updateMatrixWorld()
        const from = camera.localToWorld(this.w.copy(this.view.muzzleCam))
        const charged = def.mode === 'charge' && def.charge
        const k = charged ? Math.min(1, Math.max(0, (this.view.runner.chargeBefore - def.charge!.minS) / Math.max(1e-6, def.charge!.maxS - def.charge!.minS))) : 0
        const pellets = def.pellets ?? 1
        const width = charged ? 0.05 + 0.12 * k : pellets > 1 ? 0.01 : 0.016
        const life = charged ? 0.2 + 0.12 * k : TRACER_S
        this.tracer(from, this.v, width, life, this.weaponRgb[ev.weapon] ?? [1, 1, 1], !!charged)
        const reach = def.charge ? Math.max(def.range, def.charge.rangeMax) : def.range
        const dist = Math.hypot(ev.end[0] - ev.origin[0], ev.end[1] - ev.origin[1], ev.end[2] - ev.origin[2])
        if (dist < reach * 0.995) {
          // Sparks spray back toward the shooter.
          this.t.set(-ev.dir[0], -ev.dir[1], ev.dir[2])
          this.spawn('hit-spark', this.v, this.t, pellets > 1 ? 0.7 : 1)
        }
        return
      }
      case 'hit':
        toRender(ev.point, this.v)
        this.spawn('hit-spark', this.v, null, 1.2, 1)
        return
      case 'drone-destroyed': {
        toRender(ev.at, this.v)
        const across = this.view.models.drones[ev.enemy]?.across ?? 1
        this.spawn('drone-burst', this.v, null, across)
        this.spawn('hit-spark', this.v, null, across * 1.3, 1.2)
        return
      }
      case 'drone-shot-ended':
      case 'projectile-ended':
        toRender(ev.at, this.v)
        this.spawn('hit-spark', this.v, null, 1.2, 1.2)
        return
      default:
    }
  }

  /** Everything alive this frame into the pools (opened by the canvas). */
  draw(now: number): void {
    this.now = now
    const { glow, ribbons, runner, models, glowOn } = this.view
    const st = runner.state
    // Effects from payloads.
    for (const s of this.slots) {
      if (!s.model) continue
      const age = now - s.born
      if (age >= s.life || age < 0) { s.model = null; continue }
      const k = age / s.life
      const grow = 1 + (s.model.grow - 1) * k
      const fade = (1 - k) * (1 - k) * s.bright * s.model.strength * EFFECT_BOOST
      this.points(s.model, s.m, grow, fade, s.model.radius * grow * s.scale)
    }
    // Tracers.
    for (const tr of this.tracers) {
      if (tr.born < 0) continue
      const age = now - tr.born
      if (age >= tr.life || age < 0) { tr.born = -1; continue }
      const a = 1 - age / tr.life
      const [r, g, b] = tr.rgb
      const hot = tr.beam ? 1.6 : 0.9
      ribbons.push(tr.a.x, tr.a.y, tr.a.z, tr.b.x, tr.b.y, tr.b.z, tr.width * (tr.beam ? 1 + (1 - a) * 0.6 : 1), r * hot, g * hot, b * hot, a)
      if (tr.beam && glowOn) {
        // Glow along the rail's beam, a point every 1.5 gibsons (at most 60).
        const len = tr.a.distanceTo(tr.b)
        const n = Math.min(60, Math.max(2, Math.floor(len / 1.5)))
        for (let i = 0; i <= n; i++) {
          this.v.lerpVectors(tr.a, tr.b, i / n)
          glow.push(this.v.x, this.v.y, this.v.z, r * a * 0.5, g * a * 0.5, b * a * 0.5, tr.width * 3)
        }
      }
    }
    // Drone shots in flight.
    for (const s of st.droneShots) {
      const model = models.effects[s.enemy === 'sniper' ? 'sniper-bolt' : 'heavy-shot']
      if (!model) continue
      runner.between('shots', s.id, s.pos, this.drawn)
      toRender(this.drawn, this.v)
      this.w.set(s.vel[0], s.vel[1], -s.vel[2])
      const speed = this.w.length()
      if (speed > 1e-6) this.w.multiplyScalar(1 / speed)
      else this.w.set(0, 0, 1)
      const scale = Math.max(1, s.radius / 0.25)
      aimed(this.m, this.v, this.w, scale, this.t)
      this.points(model, this.m, 1, model.strength * EFFECT_BOOST, model.radius * scale)
      const [r, g, b] = this.rgbOf(model)
      // The hit sphere itself as a light, and a streak behind it.
      glow.push(this.v.x, this.v.y, this.v.z, r * 1.6, g * 1.6, b * 1.6, s.radius * 2.2)
      const tail = Math.min(4, 0.25 * speed)
      ribbons.push(this.v.x, this.v.y, this.v.z, this.v.x - this.w.x * tail, this.v.y - this.w.y * tail, this.v.z - this.w.z * tail, s.radius * 1.3, r * 1.4, g * 1.4, b * 1.4, 0.85)
    }
    // The player's projectiles (none of the base guns fire them).
    for (const p of st.projectiles) {
      runner.between('projectiles', p.id, p.pos, this.drawn)
      toRender(this.drawn, this.v)
      const [r, g, b] = this.weaponRgb[p.weapon] ?? [1, 1, 1]
      glow.push(this.v.x, this.v.y, this.v.z, r * 2, g * 2, b * 2, Math.max(0.15, p.radius * 3))
      this.w.set(p.vel[0], p.vel[1], -p.vel[2]).normalize()
      ribbons.push(this.v.x, this.v.y, this.v.z, this.v.x - this.w.x * 1.5, this.v.y - this.w.y * 1.5, this.v.z - this.w.z * 1.5, p.radius * 1.5, r, g, b, 0.8)
    }
  }

  private readonly rgb = new Map<EffectModel, [number, number, number]>()
  private rgbOf(model: EffectModel): [number, number, number] {
    let c = this.rgb.get(model)
    if (!c) { c = meanColor(model); this.rgb.set(model, c) }
    return c
  }

  /** An effect model's points through `m`, each grown by `grow`, at `bright` times its colour, with halos of `radius`. */
  private points(model: EffectModel, m: Matrix4, grow: number, bright: number, radius: number): void {
    const pos = model.positions, col = model.colors
    for (let i = 0; i < pos.length; i += 3) {
      this.t.set(pos[i] * grow, pos[i + 1] * grow, pos[i + 2] * grow).applyMatrix4(m)
      this.view.glow.push(this.t.x, this.t.y, this.t.z, col[i] * bright, col[i + 1] * bright, col[i + 2] * bright, radius)
    }
  }
}

export function Effects({ view }: { view: DroneRunView }): JSX.Element {
  const camera = useThree((s) => s.camera)
  const engine = useMemo(() => new EffectsEngine(view), [view])
  useEffect(() => onDroneRunEvent((ev, st) => engine.on(ev, st, camera)), [engine, camera])
  useFrame(() => engine.draw(view.time), PRIORITY.fill)
  return (
    <>
      <primitive object={view.glow.mesh} />
      <primitive object={view.ribbons.mesh} />
    </>
  )
}
