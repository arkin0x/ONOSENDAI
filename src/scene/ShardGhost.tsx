/**
 * ShardGhost.tsx — the thing about to be placed, at the cursor.
 *
 * While deploying, this draws what you are aiming, dimmed, where and at the
 * size it would land: a shard at 2^(unit - scaleExp) cells per model unit, or a
 * message as a note. Moving the cursor moves it, so you place by looking.
 *
 * The unit is the deploy bar's `deployUnit`, not the workshop model's, because
 * the two can differ: SCALE MULTIPLIER changes the size this deployment goes
 * out at and the ghost has to be the thing that lands, size included. It is
 * seeded from the model's own unit, so a deploy that never touches the control
 * ghosts exactly as it always did.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { messagePreview } from '../lib/hidden'
import { ShardMesh } from './ShardMesh'
import { regionBox } from '../lib/clip'
import { WorldLabel } from './WorldLabel'

interface Props {
  axes: ViewAxes
}

export function ShardGhost({ axes }: Props): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const shard = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const unit = useShards((s) => s.deployUnit)
  const group = useRef<Group>(null)

  const scale = useMemo(() => {
    if (!shard) return 1
    const exp = unit - scaleExp
    return exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
  }, [shard, unit, scaleExp])
  // The region it will be sealed to, at the cursor: the preview is cropped
  // the way the placed shard will be, so what you see is what lands.
  const cursor = useCyberspace((s) => s.cursor)
  const deployHeight = useShards((s) => s.deployHeight)
  const clip = useMemo(() => (shard ? regionBox(cursor, deployHeight, unit, scaleExp, axes) : undefined), [shard, cursor, deployHeight, unit, scaleExp, axes])

  // Ride the live cursor, like the cursor cube does, rather than a React commit.
  useFrame(() => {
    const g = group.current
    if (!g) return
    const s = useCyberspace.getState()
    const b = cellCentre(s.cursor, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes)
    g.position.set(b[0], b[1], b[2])
  })

  const cursorAt = (): [number, number, number] => {
    const st = useCyberspace.getState()
    return cellCentre(st.cursor, alignedOrigin(st.anchor, st.scaleExp), st.scaleExp, axes)
  }

  // A message ghosts as a dim note that follows the cursor.
  if (pending?.type === 'message') {
    return (
      <WorldLabel
        text={messagePreview(pending.text, 40)}
        color="#ffd27d"
        follow={cursorAt}
        align="center"
        px={13}
        opacity={0.5}
      />
    )
  }

  if (!shard || pending?.type !== 'shard' || !Number.isFinite(scale)) return null

  return (
    <group ref={group}>
      <ShardMesh shard={shard} scale={scale} ghost clip={clip} />
    </group>
  )
}
