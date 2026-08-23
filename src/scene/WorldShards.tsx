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
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { ShardMesh } from './ShardMesh'

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

  const placed = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return useShards.getState().worldShards()
      .filter((w) => w.plane === anchorPlane)
      .map((w) => {
        const centre = cellCentre(w.at, origin, scaleExp, axes)
        // 2^(unit - scaleExp) render cells per model unit, in fixed point so
        // the ratio survives past a double at large separations of the two.
        const exp = w.shard.unit - scaleExp
        const scale = exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
        return { ...w, centre, scale }
      })
      .filter((w) => Number.isFinite(w.scale) && Math.hypot(...w.centre) <= REACH)
    // mine and discovered are what worldShards reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => (
        <group key={w.key} position={w.centre}>
          <ShardMesh shard={w.shard} scale={w.scale} />
        </group>
      ))}
    </>
  )
}
