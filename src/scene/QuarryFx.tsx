/**
 * QuarryFx.tsx - the Quarry Charge in the scene (store/useQuarry.ts holds
 * the charges and drops; lib/terrain/quarry.ts the rules). Drawn in the
 * TERRAIN field's frame (TerrainLayer fieldMatrix), as SmashFx is, so a cell
 * is one unit here at any zoom:
 *
 *   - each charge burning: the Tri-Pack armed (lib/blueprint/quarryModel.ts)
 *     standing in its cell, its detonator lamp flashing on every beep of the
 *     fuse (FUSE_BEEPS, so the light and the sound keep time), its hub ring
 *     turning faster and faster as the fuse runs out (its own motion clock,
 *     scene/animMotion.ts AnimClock, sped up for it alone), and the seconds
 *     left over it the whole fuse (10 to 1), white with a dark edge, never
 *     hidden by the blocks, drawn larger through the last FUSE_FINAL_MS as
 *     the beeps quicken.
 *     Reduced motion holds the ring still, as it does every motion;
 *   - the drops (scene/quarryDrops.ts): every block the blast took, as a
 *     small copy of itself in its own cell, one InstancedMesh per kind,
 *     turning, bobbing and fading in the shader; a frame sets only the time
 *     and the body's middle, and asks store/quarryHoming.ts which set off
 *     toward it and which arrived (the flights are the shader's too).
 *
 * Nothing is made per frame. The lamp's glow adds its light and blooms.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BoxGeometry, CanvasTexture, Group, MeshBasicMaterial, Sprite, SpriteMaterial } from 'three'
import type { ClockReading } from 'sno-core/animClock'
import type { ShardModel } from 'sno-core/shards'
import { terrainSession, type TerrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useQuarry, type ArmedCharge } from '../store/useQuarry'
import { FUSE_FINAL_MS, FUSE_MS, blinkLit, secondsLeft } from '../lib/terrain/quarry'
import { bodyPoint, flights, homing, idleHoming, tickHoming } from '../store/quarryHoming'
import { ITEM_ORANGE } from '../lib/blueprint/itemMark'
import { QUARRY_BOX, QUARRY_LAMP, useQuarryModel } from '../lib/blueprint/quarryModel'
import { DropField } from './quarryDrops'
import { ShardMesh } from './ShardMesh'
import { AnimClock, type ClockOverride } from './animMotion'
import { MAX_SCALE, drawnScale, fieldMatrix } from './TerrainLayer'
import type { ViewAxes } from '../lib/space'

/** A digit for the countdown: white with a dark edge, as text over the scene is (owner's taste). */
function digitTexture(d: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const g = c.getContext('2d')
  if (!g) return null
  // Two digits (10) narrower, so they fit the same square.
  g.font = `700 ${d >= 10 ? 70 : 92}px ui-monospace, "SFMono-Regular", Menlo, monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 14
  g.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  g.strokeText(String(d), 64, 68)
  g.fillStyle = '#ffffff'
  g.fillText(String(d), 64, 68)
  return new CanvasTexture(c)
}

/** A soft round glow, white in the middle: tinted by its material. */
function glowTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 64; c.height = 64
  const g = c.getContext('2d')
  if (!g) return null
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

/** The countdown's digits: every whole second of the fuse, 1 to 10. */
export const COUNTDOWN = Math.ceil(FUSE_MS / 1000)
/** The countdown's size over a charge, in blocks, and through the fuse's last FUSE_FINAL_MS. */
export const DIGIT_SIZE = 0.6
export const DIGIT_SIZE_FINAL = 0.78
/** The countdown's size `ms` into the fuse: larger as the beeps quicken. */
export const digitSize = (ms: number): number => (FUSE_MS - ms <= FUSE_FINAL_MS ? DIGIT_SIZE_FINAL : DIGIT_SIZE)

/** The most charges drawn burning at once; more still blast, unseen. */
const CHARGES_DRAWN = 8
/** How tall a charge stands in its cell, in blocks. */
const STANDS = 0.92
/** The model's scale in the cell, and how far up its feet are lifted so they stand on the cell's floor. */
const SCALE = STANDS / (QUARRY_BOX.max[1] - QUARRY_BOX.min[1])
const LIFT = -QUARRY_BOX.min[1] * SCALE
/** How much faster than its own the hub ring turns at the fuse's very end (it starts at its own speed). */
export const FUSE_SPIN_GAIN = 5

/**
 * The fuse's clock for a charge's own motion: its seconds since it was armed
 * pass faster and faster, `1 + gain * p^2` times its own at a share `p` of the
 * fuse, so the ring speeds up smoothly to the blast. Worked from the moment
 * alone (the integral of that speed), so asking twice in a frame gives the
 * same answer.
 */
export function fuseSeconds(sinceArmedS: number, fuseS: number = FUSE_MS / 1000, gain: number = FUSE_SPIN_GAIN): number {
  const e = Math.max(0, Math.min(fuseS, sinceArmedS))
  return e + (gain * e * e * e) / (3 * fuseS * fuseS) + Math.max(0, sinceArmedS - fuseS) * (1 + gain)
}

/** A charge's own clock (scene/animMotion.ts ClockOverride): the shared reading, its moment moved on by the fuse. One object, written over each frame. */
export function fuseClock(armedAtMs: number): ClockOverride {
  const out: ClockReading = { t: 0, version: 0, nowS: 0, chosen: false }
  return (r) => {
    const since = r.nowS - armedAtMs / 1000
    out.t = r.t + (fuseSeconds(since) - Math.max(0, since))
    out.version = r.version
    out.nowS = r.nowS
    out.chosen = r.chosen
    return out
  }
}

/** The stand-in while the armed model is not read (or could not be): a dark casing banded in orange, made once. */
const STAND_IN = new BoxGeometry(1, 1, 1)
interface StandIn { casing: MeshBasicMaterial; band: MeshBasicMaterial }

/**
 * One charge burning: the armed Tri-Pack in its cell (or, while it is not
 * read, a plain banded box: the fuse shows either way), the lamp flashing on
 * the beeps, the seconds over it.
 */
function PlacedCharge({ charge, model, standIn, glow, digits }: { charge: ArmedCharge; model: ShardModel | null; standIn: StandIn; glow: SpriteMaterial; digits: SpriteMaterial[] }): JSX.Element {
  const group = useRef<Group>(null)
  const lamp = useRef<Sprite>(null)
  const digit = useRef<Sprite>(null)
  const clock = useMemo(() => fuseClock(charge.armedAt), [charge.armedAt])
  /** Where it stands in the field, worked out again only when the field changes. */
  const at = useRef<{ field: TerrainSession | null }>({ field: null })
  useFrame(() => {
    const g = group.current, l = lamp.current, d = digit.current
    const s = terrainSession
    if (!g || !l || !d || !s) return
    if (at.current.field !== s) {
      at.current.field = s
      const o = s.world.origin
      g.position.set(Number(charge.x - o.x) + 0.5, Number(charge.y - o.y), Number(charge.z - o.z) + 0.5)
    }
    g.visible = s.owner === charge.owner && s.plane === charge.plane
    const ms = performance.now() - charge.armedAt
    l.visible = blinkLit(ms)
    const left = secondsLeft(ms, FUSE_MS)
    d.visible = left >= 1 && left <= digits.length
    if (d.visible) {
      d.material = digits[left - 1]
      const k = digitSize(ms)
      d.scale.set(k, k, 1)
    }
  })
  return (
    <group ref={group}>
      {model ? (
        <group position={[0, LIFT, 0]} scale={SCALE}>
          <AnimClock.Provider value={clock}>
            <ShardMesh shard={model} world lit />
          </AnimClock.Provider>
        </group>
      ) : (
        <group position={[0, STANDS * 0.4, 0]}>
          <mesh geometry={STAND_IN} material={standIn.casing} scale={[0.5, STANDS * 0.8, 0.5]} raycast={() => {}} />
          <mesh geometry={STAND_IN} material={standIn.band} scale={[0.52, 0.12, 0.52]} raycast={() => {}} />
        </group>
      )}
      <sprite ref={lamp} material={glow} scale={[0.9, 0.9, 1]} position={[QUARRY_LAMP[0] * SCALE, LIFT + QUARRY_LAMP[1] * SCALE, QUARRY_LAMP[2] * SCALE]} renderOrder={15} visible={false} raycast={() => {}} />
      <sprite ref={digit} material={digits[digits.length - 1]} scale={[DIGIT_SIZE, DIGIT_SIZE, 1]} position={[0, STANDS + 0.45, 0]} renderOrder={16} visible={false} raycast={() => {}} />
    </group>
  )
}

export function QuarryFx({ axes }: { axes: ViewAxes }): JSX.Element {
  const frame = useRef<Group>(null)
  // The charges burning (only an arm or a blast draws this again), and the armed model, read once any burns.
  const charges = useQuarry((s) => s.charges)
  const model = useQuarryModel(charges.length > 0, 'armed')
  // The drops (scene/quarryDrops.ts): one instanced mesh per block kind, made as kinds come, let go with the scene.
  const drops = useMemo(() => new DropField(), [])
  useEffect(() => () => drops.dispose(), [drops])

  const look = useMemo(() => {
    const glowMap = glowTexture()
    const glow = new SpriteMaterial({ map: glowMap, color: ITEM_ORANGE, blending: AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false })
    const digits = Array.from({ length: COUNTDOWN }, (_, i) => i + 1).map((d) => new SpriteMaterial({ map: digitTexture(d), depthWrite: false, depthTest: false, transparent: true, toneMapped: false }))
    const standIn: StandIn = { casing: new MeshBasicMaterial({ color: '#1d2224', toneMapped: false }), band: new MeshBasicMaterial({ color: ITEM_ORANGE, toneMapped: false }) }
    return { glow, glowMap, digits, standIn }
  }, [])
  useEffect(() => () => {
    look.standIn.casing.dispose()
    look.standIn.band.dispose()
    for (const m of look.digits) { m.map?.dispose(); m.dispose() }
    look.glow.dispose()
    look.glowMap?.dispose()
  }, [look])

  useFrame(() => {
    const f = frame.current
    if (!f) return
    const s = terrainSession
    const plane = useCyberspace.getState().plane
    const zoom = drawnScale()
    const q = useQuarry.getState()
    const on = !!s && s.plane === plane && zoom <= MAX_SCALE && (q.charges.length > 0 || q.drops.length > 0)
    f.visible = on
    // Nothing drawing the drops, or none left: no flight is kept waiting (store/quarryHoming.ts idleHoming).
    if (!s || !on || !q.drops.length) idleHoming()
    if (!s || !on) return
    fieldMatrix(s, axes, zoom, f.matrix)
    f.matrixWorldNeedsUpdate = true
    // The drops flying to you: those within reach set off, those arrived are carried (store/quarryHoming.ts).
    const now = Date.now()
    if (q.drops.length) tickHoming(now)
    const st = useQuarry.getState()
    // The drops: written again only when they change, one sets off, or the field changes; a frame moves only their time
    // and the body's middle they fly to.
    drops.update(s, st.owner === s.owner ? st.drops : NO_DROPS, st.version, flights, homing.version)
    drops.tick(now, bodyPoint.valid ? bodyPoint : undefined)
  })

  return (
    <group ref={frame} name="quarry-fx" visible={false} matrixAutoUpdate={false}>
      {shownCharges(charges, terrainSession).map((c) => <PlacedCharge key={c.id} charge={c} model={model} standIn={look.standIn} glow={look.glow} digits={look.digits} />)}
      <primitive object={drops.group} />
    </group>
  )
}

/** The charges drawn in a field: its identity's and plane's first, then at most CHARGES_DRAWN of them (review of #962). */
export function shownCharges<C extends Pick<ArmedCharge, 'owner' | 'plane'>>(charges: readonly C[], s: Pick<TerrainSession, 'owner' | 'plane'> | null): C[] {
  if (!s) return []
  return charges.filter((c) => c.owner === s.owner && c.plane === s.plane).slice(0, CHARGES_DRAWN)
}

/** None, the same every frame. */
const NO_DROPS: readonly never[] = []
