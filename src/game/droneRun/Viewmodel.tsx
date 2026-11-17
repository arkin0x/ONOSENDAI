/**
 * Viewmodel.tsx - the gun in hand, in first person.
 *
 * Drawn in a pass of its own after the world, with the depth cleared
 * (Canvas3D's renderer), from a camera at the eye with the world camera's
 * lens, so it never sinks into a wall however close you stand.
 *
 * - Place: rig.json's `viewmodel` for the gun, the phone's on an upright
 *   screen and the desktop's otherwise: offset [right, down, forward]
 *   gibsons from the eye, turned about the camera's X, Y, Z (models.ts
 *   viewPlaceFor). The grip is the payload's origin.
 * - Recoil: a small kick back and up per trigger pull, easing out.
 * - Switching: the old gun lowers and the new one rises, together taking the
 *   new gun's readyS, the simulation's own time before it fires.
 * - Reloading (an ammo gun): it dips and rolls for the reload's length.
 * - A heat gun's barrel glows with its heat, red and pulsing while locked;
 *   the charge gun's muzzle gathers light as it charges.
 * - The muzzle flash: the gun's flash payload (rig.json `flash`) at the
 *   muzzle, grown and faded over its lifeS; the rail's scaled by its charge.
 * - A little sway with the camera's bob (none with reduced motion).
 *
 * The gun is drawn with a plain lit mesh of the payload's faces, so none of
 * the world's corner dots sit on it. Where the muzzle is goes to the view
 * (muzzleCam) for the world's tracers to start from.
 *
 * Ledger class (c): all of it. The readyS and reloadS it follows are the
 * variant's (class b).
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Group, Matrix4, Mesh, Vector3 } from 'three'
import { onDroneRunEvent } from './runner'
import { viewPlaceFor, type EffectModel } from './models'
import { DRONE_MATERIAL } from './Drones'
import { EFFECT_BOOST } from './Effects'
import { PRIORITY, type DroneRunView } from './view'
import { ShardLights } from '../../scene/shardLight'

const DEG = Math.PI / 180

interface Flash { model: EffectModel | null; born: number; scale: number }

/** Where a switch is: the gun shown and how far it is lowered (0 up, 1 down). */
export function switchPose(sinceS: number, durS: number, from: number, to: number): { shown: number; lower: number } {
  if (!(durS > 0) || sinceS >= durS) return { shown: to, lower: 0 }
  const s = Math.max(0, sinceS / durS)
  return s < 0.5 ? { shown: from, lower: s * 2 } : { shown: to, lower: (1 - s) * 2 }
}

export function Viewmodel({ view }: { view: DroneRunView }): JSX.Element {
  const size = useThree((s) => s.size)
  const weapons = view.runner.state.world.variant.spec.weapons
  const meshes = useMemo(() => weapons.map((w) => {
    const g = view.models.weapons[w.id]?.body
    const m = new Mesh(g ?? undefined, DRONE_MATERIAL)
    m.frustumCulled = false
    m.visible = false
    return m
  }), [view, weapons])
  const gun = useMemo(() => {
    const g = new Group()
    g.matrixAutoUpdate = false
    for (const m of meshes) g.add(m)
    return g
  }, [meshes])

  const anim = useRef({ recoil: 0, from: 0, to: 0, since: 99, dur: 0, lastShotStep: -1, now: 0 })
  const flashes = useRef<Flash[]>(Array.from({ length: 6 }, () => ({ model: null, born: 0, scale: 1 })))
  const flashAt = useRef(0)

  useEffect(() => onDroneRunEvent((ev, st) => {
    const a = anim.current
    if (ev.type === 'weapon-switched') {
      a.from = ev.from; a.to = ev.to; a.since = 0; a.dur = st.world.variant.spec.weapons[ev.to].readyS ?? 0.3
    } else if (ev.type === 'shot' && a.lastShotStep !== st.step) {
      // Once a trigger pull, however many pellets.
      a.lastShotStep = st.step
      const def = st.world.variant.spec.weapons[ev.weapon]
      const k = def.mode === 'charge' && def.charge ? Math.min(1, view.runner.chargeBefore / Math.max(1e-6, def.charge.maxS)) : 0
      a.recoil = Math.min(1.6, a.recoil + (def.mode === 'charge' ? 0.8 + 0.8 * k : (def.pellets ?? 1) > 1 ? 1 : 0.45))
      const model = view.models.effects[view.models.weapons[def.id]?.flash ?? '']
      const f = flashes.current[flashAt.current]
      flashAt.current = (flashAt.current + 1) % flashes.current.length
      f.model = model ?? null; f.born = a.now; f.scale = def.mode === 'charge' ? 0.7 + 1.1 * k : 1
    }
  }), [view])

  const tmp = useMemo(() => ({ e: new Euler(0, 0, 0, 'ZYX'), v: new Vector3(), m: new Matrix4(), f: new Matrix4(), s: new Vector3() }), [])

  useFrame((_, frameDt) => {
    const dt = frameDt * view.runner.timeScale
    const a = anim.current
    const t = view.time
    a.now = t
    a.since += dt
    a.recoil *= Math.exp(-dt * 14)
    const st = view.runner.state
    const ars = st.arsenal
    const sw = switchPose(a.since, a.dur, a.from, ars.current)
    const shown = sw.shown
    const def = weapons[shown]
    const model = view.models.weapons[def.id]
    for (let i = 0; i < meshes.length; i++) meshes[i].visible = i === shown && !!model
    if (!model) return
    const place = viewPlaceFor(model, size.width, size.height)
    const g = ars.guns[shown]
    const dip = def.ammo && g.reload > 0 && shown === ars.current ? Math.sin(Math.PI * (1 - g.reload / def.ammo.reloadS)) : 0
    const swayOn = !view.reducedMotion
    const bx = swayOn ? Math.sin(view.bob.phase) * view.bob.amount * 0.5 : 0
    const by = swayOn ? -Math.abs(Math.cos(view.bob.phase)) * view.bob.amount * 0.6 + Math.sin(t * 1.3) * 0.004 : 0
    const r = a.recoil
    gun.position.set(place.offset[0] + bx, -place.offset[1] - sw.lower * 0.45 - dip * 0.14 + by, -place.offset[2] + r * 0.06)
    tmp.e.set(place.turn[0] * DEG + r * 0.09 - sw.lower * 0.7 - dip * 0.45, place.turn[1] * DEG, place.turn[2] * DEG + dip * 0.35, 'ZYX')
    gun.quaternion.setFromEuler(tmp.e)
    gun.scale.setScalar(place.scale)
    gun.updateMatrix()
    // Where the muzzle is now, camera space.
    view.muzzleCam.set(model.muzzle[0], model.muzzle[1], model.muzzle[2]).applyMatrix4(gun.matrix)
    const vm = view.vmGlow
    // The heat gun's barrel.
    if (def.heat && sw.lower < 0.6) {
      const locked = g.lock > 0
      const h = Math.min(1, g.heat / def.heat.overheatAt)
      if (locked || h > 0.04) {
        const pulse = locked ? 0.65 + 0.35 * Math.sin(t * 18) : 1
        const cr = 1, cg = locked ? 0.18 : 0.35 + 0.55 * h, cb = locked ? 0.12 : 0.08 + 0.6 * h * h
        const k = (locked ? 1.4 : 0.3 + 1.6 * h) * pulse
        for (let i = 0; i < 3; i++) {
          tmp.v.set(model.muzzle[0], model.muzzle[1], model.muzzle[2] + 0.06 + i * 0.09).applyMatrix4(gun.matrix)
          vm.push(tmp.v.x, tmp.v.y, tmp.v.z, cr * k, cg * k, cb * k, 0.025 + 0.045 * (locked ? 1 : h))
        }
      }
    }
    // The charge gathering at the muzzle.
    if (def.charge && g.charging && shown === ars.current) {
      const k = Math.min(1, g.charge / Math.max(1e-6, def.charge.maxS))
      const ready = g.charge >= def.charge.minS
      const flick = view.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 50)
      const b = (ready ? 1.2 : 0.5) + 1.8 * k
      vm.push(view.muzzleCam.x, view.muzzleCam.y, view.muzzleCam.z, 0.5 * b, 0.95 * b, 1 * b, (0.03 + 0.12 * k) * flick)
    }
    // Muzzle flashes, following the gun.
    tmp.f.copy(gun.matrix).multiply(tmp.m.makeTranslation(model.muzzle[0], model.muzzle[1], model.muzzle[2]))
    for (const f of flashes.current) {
      if (!f.model) continue
      const age = t - f.born
      const life = Math.max(0.03, f.model.lifeS)
      if (age >= life || age < 0) { f.model = null; continue }
      const k = age / life
      const grow = (1 + (f.model.grow - 1) * k) * f.scale
      const bright = (1 - k) * f.model.strength * EFFECT_BOOST * 1.3
      const p = f.model.positions, c = f.model.colors
      for (let i = 0; i < p.length; i += 3) {
        tmp.v.set(p[i] * grow, p[i + 1] * grow, p[i + 2] * grow).applyMatrix4(tmp.f)
        vm.push(tmp.v.x, tmp.v.y, tmp.v.z, c[i] * bright, c[i + 1] * bright, c[i + 2] * bright, f.model.radius * grow * 1.6)
      }
    }
  }, PRIORITY.fill)

  return (
    <>
      <ShardLights />
      <primitive object={gun} />
      <primitive object={view.vmGlow.mesh} />
    </>
  )
}
