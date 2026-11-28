/**
 * HeldCharge.tsx - the Quarry Charge in your hand while it is the chosen
 * slot in TERRAIN: the Tri-Pack itself (lib/blueprint/quarryModel.ts), held
 * exactly where a carried block is (owner, 2026-11-28: "the quarry charge
 * should be held in the bottom right like the blocks are").
 *
 * Its box is the carried block's own (.terrain-held, TerrainView.tsx
 * HeldBlock): the same corner, the same size, partly off the bottom right of
 * the screen, under every control and the menu, never taking a tap, and
 * hidden with the block's rules (the pad put away, the bag open on a phone).
 * Its canvas is a little larger than that box and centred on it, so the
 * model, tilted toward you as the block is, fits the block's footprint
 * (heldChargeFit: HELD_SHARE of the box at its tallest or widest). It sways
 * with a walk and dips when one is placed exactly as the block does (styles.
 * css terrain-held-sway's steps and terrain-held-dip, 2D, so the canvas is
 * never skewed), and is otherwise still but for its hub ring turning (the
 * model's motion). With reduced motion it holds still, ring and all. Hidden
 * with none left.
 *
 * The canvas is made once a visit and kept while the charges are owned, only
 * hidden for another slot, so its WebGL context is not made again on every
 * change of slot or every placing. It draws only while shown.
 */

import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { ShardMesh } from '../scene/ShardMesh'
import { ShardLights } from '../scene/shardLight'
import { QUARRY_BOX, quarryArmedModel, useQuarryModel } from '../lib/blueprint/quarryModel'
import { useTerrain } from '../store/useTerrain'
import { useWalk } from '../store/useWalk'
import { useReducedMotion } from '../hooks/useReducedMotion'

const FOV = 40
const HALF_TAN = Math.tan((FOV * Math.PI) / 360)
/** How far in front of the eye it is held. */
const DEPTH = 4
/** The canvas's side, in carried-block boxes (styles.css .terrain-held-charge__view), centred on the box. */
export const VIEW_SHARE = 2.2
/** How large it is drawn: at its tallest or widest, this many carried-block boxes (the tilted cube's own reach). */
export const HELD_SHARE = 1.2
/** Its tilt toward you and its turn, radians (about the carried block's 20 and 36 degrees), and its lean. */
export const TILT = 0.34
export const TURN = -0.6
export const LEAN = -0.08

/**
 * How the model sits in its canvas: scaled so that, tilted and turned, its
 * tallest or widest reach is HELD_SHARE of the carried block's box, and
 * moved so its middle is the canvas's (the box's middle).
 */
export function heldChargeFit(box: { min: readonly number[]; max: readonly number[] } = QUARRY_BOX): { scale: number; centre: [number, number, number]; depth: number } {
  const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1], d = box.max[2] - box.min[2]
  const tall = h * Math.cos(TILT) + d * Math.abs(Math.sin(TILT))
  const wide = w * Math.cos(TURN) + d * Math.abs(Math.sin(TURN))
  // The canvas, VIEW_SHARE boxes across, is 2 * DEPTH * HALF_TAN units across at the model's depth.
  const target = (2 * DEPTH * HALF_TAN * HELD_SHARE) / VIEW_SHARE
  const centre: [number, number, number] = [(box.max[0] + box.min[0]) / 2, (box.max[1] + box.min[1]) / 2, (box.max[2] + box.min[2]) / 2]
  return { scale: target / Math.max(tall, wide), centre, depth: DEPTH }
}

/** Draws every frame while shown (the model's hub ring turns), otherwise nothing. */
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

const FIT = heldChargeFit()

function Held({ shard, still }: { shard: ShardModel; still: boolean }): JSX.Element {
  return (
    <group position={[0, 0, -FIT.depth]} rotation={[TILT, TURN, LEAN, 'XYZ']}>
      <group scale={FIT.scale}>
        <group position={[-FIT.centre[0], -FIT.centre[1], -FIT.centre[2]]}>
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
  // The armed look is read now, so a charge placed draws it at once (scene/QuarryFx.tsx).
  useEffect(() => { void quarryArmedModel() }, [])
  // A dip each time one is placed (the count goes down): the carried block's dip, its two names taking turns so it
  // starts again without making the canvas again.
  const [dip, setDip] = useState(0)
  const was = useRef(left)
  useEffect(() => {
    if (left < was.current) setDip((d) => d + 1)
    was.current = left
  }, [left])
  if (!shard) return null
  return (
    <div className={`terrain-held terrain-held--charge${walking ? ' is-walking' : ''}`} aria-hidden style={on ? undefined : { visibility: 'hidden' }}>
      <div className={`terrain-held-charge__dip${dip ? (dip % 2 ? ' is-dip-a' : ' is-dip-b') : ''}`}>
        <div className="terrain-held-charge__sway">
          <div className="terrain-held-charge__view">
            <Canvas dpr={[1, 2]} frameloop="demand" gl={{ alpha: true, antialias: true, premultipliedAlpha: true }} camera={{ fov: FOV, near: 0.05, far: 40, position: [0, 0, 0] }} style={{ pointerEvents: 'none' }}>
              <Pacer shown={on} still={still} />
              <ShardLights />
              <Held shard={shard} still={still} />
            </Canvas>
          </div>
        </div>
      </div>
    </div>
  )
}
