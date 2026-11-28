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
 *     left over it, white with a dark edge, never hidden by the blocks.
 *     Reduced motion holds the ring still, as it does every motion;
 *   - the drops (scene/quarryDrops.ts): every block the blast took, as a
 *     small copy of itself in its own cell, one InstancedMesh per kind,
 *     turning, bobbing and fading in the shader; a frame sets only the time.
 *
 * Nothing is made per frame. The lamp's glow adds its light and blooms.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, CanvasTexture, Group, Sprite, SpriteMaterial } from 'three'
import type { ClockReading } from 'sno-core/animClock'
import type { ShardModel } from 'sno-core/shards'
import { terrainSession, type TerrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useQuarry, type ArmedCharge } from '../store/useQuarry'
import { FUSE_MS, blinkLit, secondsLeft } from '../lib/terrain/quarry'
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
  g.font = '700 92px ui-monospace, "SFMono-Regular", Menlo, monospace'
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

/** One charge burning: the armed Tri-Pack in its cell, the lamp flashing on the beeps, the seconds over it. */
function PlacedCharge({ charge, model, glow, digits }: { charge: ArmedCharge; model: ShardModel; glow: SpriteMaterial; digits: SpriteMaterial[] }): JSX.Element {
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
    d.visible = left >= 1 && left <= 3
    if (d.visible) d.material = digits[left - 1]
  })
  return (
    <group ref={group}>
      <group position={[0, LIFT, 0]} scale={SCALE}>
        <AnimClock.Provider value={clock}>
          <ShardMesh shard={model} world lit />
        </AnimClock.Provider>
      </group>
      <sprite ref={lamp} material={glow} scale={[0.9, 0.9, 1]} position={[QUARRY_LAMP[0] * SCALE, LIFT + QUARRY_LAMP[1] * SCALE, QUARRY_LAMP[2] * SCALE]} renderOrder={15} visible={false} raycast={() => {}} />
      <sprite ref={digit} material={digits[2]} scale={[0.6, 0.6, 1]} position={[0, STANDS + 0.45, 0]} renderOrder={16} visible={false} raycast={() => {}} />
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
    const digits = [1, 2, 3].map((d) => new SpriteMaterial({ map: digitTexture(d), depthWrite: false, depthTest: false, transparent: true, toneMapped: false }))
    return { glow, glowMap, digits }
  }, [])
  useEffect(() => () => {
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
    if (!s || !on) return
    fieldMatrix(s, axes, zoom, f.matrix)
    f.matrixWorldNeedsUpdate = true
    // The drops: written again only when they change or the field does; a frame moves only their time.
    drops.update(s, q.owner === s.owner ? q.drops : NO_DROPS, q.version)
    drops.tick(Date.now())
  })

  return (
    <group ref={frame} name="quarry-fx" visible={false} matrixAutoUpdate={false}>
      {model && charges.slice(0, CHARGES_DRAWN).map((c) => <PlacedCharge key={c.id} charge={c} model={model} glow={look.glow} digits={look.digits} />)}
      <primitive object={drops.group} />
    </group>
  )
}

/** None, the same every frame. */
const NO_DROPS: readonly never[] = []
