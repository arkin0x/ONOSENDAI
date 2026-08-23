/**
 * ShardGhost.tsx — the shard about to be placed, at the cursor.
 *
 * While deploying, this draws the shard you are aiming, dimmed, exactly where
 * and at the size it would land: at the cursor, one model unit to 2^(unit -
 * scaleExp) render cells. Moving the cursor moves it, so you place by looking.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { ShardMesh } from './ShardMesh'

interface Props {
  axes: ViewAxes
}

export function ShardGhost({ axes }: Props): JSX.Element | null {
  const deployId = useShards((s) => s.deployId)
  const shard = useShards((s) => (deployId ? s.deployShard() : null))
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const group = useRef<Group>(null)

  const scale = useMemo(() => {
    if (!shard) return 1
    const exp = shard.unit - scaleExp
    return exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
  }, [shard, scaleExp])

  // Ride the live cursor, like the cursor cube does, rather than a React commit.
  useFrame(() => {
    const g = group.current
    if (!g) return
    const s = useCyberspace.getState()
    const b = cellCentre(s.cursor, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes)
    g.position.set(b[0], b[1], b[2])
  })

  if (!shard || !deployId || !Number.isFinite(scale)) return null

  return (
    <group ref={group}>
      <ShardMesh shard={shard} scale={scale} ghost />
    </group>
  )
}
