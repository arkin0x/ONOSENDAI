/**
 * HeldCharge.tsx - the Quarry Charge in your hand while it is the chosen
 * slot in TERRAIN: the Tri-Pack itself (lib/blueprint/quarryModel.ts), drawn
 * on a canvas of its own the whole screen wide, under every control, as the
 * held Compiler is (HeldCompiler.tsx): it never clips into the world and
 * never takes a tap.
 *
 * At rest it stands in the bottom right corner, tilted toward you as if held
 * up in the right hand, turning a little this way and that so its three
 * charges and their wires catch the light, its hub ring turning on its own
 * (the model's motion). It breathes and bobs with a walk on the page's own
 * motion (styles.css), and dips each time one is placed. With reduced motion
 * it holds still, and the model's ring with it. Hidden with none left.
 *
 * The canvas is made once a visit and kept while the charges are owned, only
 * hidden for another slot, so its WebGL context is not made again on every
 * change of slot. It draws only while shown.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { ShardMesh } from '../scene/ShardMesh'
import { ShardLights } from '../scene/shardLight'
import { QUARRY_BOX, quarryArmedModel, useQuarryModel } from '../lib/blueprint/quarryModel'
import { useTerrain } from '../store/useTerrain'
import { useWalk } from '../store/useWalk'
import { useReducedMotion } from '../hooks/useReducedMotion'

const FOV = 40
const HALF_TAN = Math.tan((FOV * Math.PI) / 360)
/** How far in front of the eye it stands. */
const DEPTH = 4
/** How tall it looks: a share of the screen's height, and at most a share of its width (a phone held upright). */
const HEIGHT_SHARE = 0.3
const WIDTH_SHARE = 0.36
/** Its tilt toward you and its turn, radians; and how far it sways either side. */
const TILT = 0.32
const TURN = -0.55
const SWAY = 0.32
/** A dip when one is placed, ms. */
const DIP_MS = 260

/** Draws every frame while shown (the model's ring turns, and so does the charge), otherwise nothing. */
function Pacer({ shown, still }: { shown: boolean; still: boolean }): null {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!shown) return
    invalidate()
    if (still) return
    let raf = 0
    const tick = (): void => { invalidate(); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [invalidate, shown, still])
  return null
}

function Held({ shard, still, dipAt }: { shard: ShardModel; still: boolean; dipAt: { current: number } }): JSX.Element {
  const holder = useRef<Group>(null)
  const size = useThree((s) => s.size)
  const fit = useMemo(() => {
    const h = QUARRY_BOX.max[1] - QUARRY_BOX.min[1]
    const centre: [number, number, number] = [0, (QUARRY_BOX.max[1] + QUARRY_BOX.min[1]) / 2, (QUARRY_BOX.max[2] + QUARRY_BOX.min[2]) / 2]
    const halfH = DEPTH * HALF_TAN
    const halfW = halfH * (size.width / Math.max(1, size.height))
    // Its height on screen, in the eye's units: a share of the height, held to a share of the width.
    const tall = Math.min(2 * halfH * HEIGHT_SHARE, 2 * halfW * WIDTH_SHARE)
    // In the bottom right, left of the right-hand column of controls (as the carried block stands), its feet a little
    // past the bottom of the screen.
    // On a phone held upright the bottom third of the screen is the pad's (and LOOK's ball on the right): it stands just
    // over it, at the right edge.
    const upright = size.width < size.height
    return { scale: tall / h, centre, x: halfW - tall * (upright ? 0.6 : 1.05), y: upright ? -halfH * 0.3 + tall * 0.5 : -halfH + tall * 0.45 }
  }, [size.width, size.height])
  useFrame(() => {
    const g = holder.current
    if (!g) return
    const t = performance.now()
    const dip = Math.max(0, 1 - (t - dipAt.current) / DIP_MS)
    const sway = still ? 0 : Math.sin(t / 1400) * SWAY
    g.position.set(fit.x, fit.y - dip * 0.25, -DEPTH)
    g.rotation.set(TILT + dip * 0.25, TURN + sway, -0.08, 'XYZ')
  })
  return (
    <group ref={holder}>
      <group scale={fit.scale}>
        <group position={[-fit.centre[0], -fit.centre[1], -fit.centre[2]]}>
          <ShardMesh shard={shard} lit still={still} />
        </group>
      </group>
    </group>
  )
}

/** The held Quarry Charge's canvas (TerrainView.tsx mounts it while the charges are owned). */
export function HeldCharge({ shown = true }: { shown?: boolean }): JSX.Element | null {
  const left = useTerrain((s) => s.inventory.charges ?? 0)
  const walking = useWalk((w) => w.behind > 0 || w.open !== null)
  const still = useReducedMotion()
  const shard = useQuarryModel(true)
  const on = shown && left > 0
  // A dip each time one is placed (the count goes down).
  // The armed look is read now, so a charge placed draws it at once (scene/QuarryFx.tsx).
  useEffect(() => { void quarryArmedModel() }, [])
  const dipAt = useRef(-Infinity)
  const was = useRef(left)
  useEffect(() => {
    if (left < was.current) dipAt.current = performance.now()
    was.current = left
  }, [left])
  if (!shard) return null
  return (
    <div className={`terrain-held-charge${walking ? ' is-walking' : ''}`} aria-hidden style={on ? undefined : { visibility: 'hidden' }}>
      <div className="terrain-held-charge__sway">
        <Canvas dpr={[1, 2]} frameloop="demand" gl={{ alpha: true, antialias: true, premultipliedAlpha: true }} camera={{ fov: FOV, near: 0.05, far: 40, position: [0, 0, 0] }} style={{ pointerEvents: 'none' }}>
          <Pacer shown={on} still={still} />
          <ShardLights />
          <Held shard={shard} still={still} dipAt={dipAt} />
        </Canvas>
      </div>
    </div>
  )
}
