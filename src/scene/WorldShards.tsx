/**
 * WorldShards.tsx — the shards placed in cyberspace, drawn where they sit.
 *
 * Each shard renders at its own coordinate, at its own unit scale: one model
 * unit is 2^unit gibsons, which at the current zoom is 2^(unit - scaleExp)
 * render cells. So a shard hidden at a fine unit is a speck until you zoom in
 * to it, and a monument at a coarse unit fills the view from far off, which is
 * the honest picture. Culled past the same reach as Earth and the spawn mark.
 */

import { useMemo } from 'react'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import type { ThreeEvent } from '@react-three/fiber'
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useCeremony } from '../store/useCeremony'
import { useShards } from '../store/useShards'
import { ShardMesh } from './ShardMesh'

/** A press that travels further than this is an orbit, not a tap. */
const TAP_SLOP = 8

const REACH = GRID_RADIUS * 8

interface Props {
  axes: ViewAxes
}

export function WorldShards({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // Subscribed so the set re-renders when a deploy or a discovery lands.
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const births = useCeremony((s) => s.births)

  const placed = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return useShards.getState().worldItems()
      .filter((w) => w.type === 'shard' && w.shard && w.plane === anchorPlane)
      .map((w) => {
        const shard = w.shard!
        const centre = cellCentre(w.at, origin, scaleExp, axes)
        // 2^(unit - scaleExp) render cells per model unit, in fixed point so
        // the ratio survives past a double at large separations of the two.
        const exp = shard.unit - scaleExp
        const scale = exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
        return { key: w.key, shard, centre, scale }
      })
      .filter((w) => Number.isFinite(w.scale) && Math.hypot(...w.centre) <= REACH)
    // mine and discovered are what worldShards reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => {
        const hit = Math.max(0.6, w.scale * 2)
        const open = (e: ThreeEvent<MouseEvent>): void => {
          if (e.delta > TAP_SLOP) return
          e.stopPropagation()
          markSceneTapHandled()
          useShards.getState().selectSecret(w.key)
        }
        return (
          <group key={w.key} position={w.centre}>
            <ShardMesh shard={w.shard} scale={w.scale} birth={births[w.key]} world />
            {/* An invisible, generous tap target: shards can be a few pixels. */}
            <mesh onClick={open}>
              <sphereGeometry args={[hit, 8, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}
