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
 * ghosts exactly as it always did. The same is true of the pose: with SNAP TO
 * EARTH on, the ghost stands on the ground at the cursor exactly as the
 * deployed shard will, because both come from one function of the position
 * (lib/pose.ts).
 *
 * FINE ROTATION hands the spin to the camera. Every frame the look direction
 * is read back into cyberspace axes and turned into a compass bearing at the
 * cursor, so orbiting turns the shard to face the way you are looking: the
 * shard's +Z points away from the viewer, into the screen, which is how the
 * bench presents a shard (its camera sits on the model's -Z side and looks
 * along +Z, toward the black sun). Turn it off and the spin stays where the
 * orbit left it.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Group } from 'three'
import { cellCentre, type ViewAxes } from '../lib/space'
import { bearingOf, csDirection, drawPoseAt, frameOf, snapOffered, type V3 } from '../lib/pose'
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

  // Standing on the ground at the cursor, if that is what is being deployed.
  const plane = useCyberspace((s) => s.plane)
  const up = useShards((s) => s.deployUp)
  const spin = useShards((s) => s.deploySpin)
  const standing = up && snapOffered(plane, deployHeight)
  const pose = useMemo(
    () => (shard && standing ? drawPoseAt(cursor, spin, axes) : undefined),
    [shard, standing, cursor, spin, axes],
  )
  // The frame the bearing is measured in, at the cursor: recomputed only when
  // the cursor moves, not every frame the camera turns.
  const frame = useMemo(() => (standing ? frameOf(cursor) : null), [standing, cursor])

  // Ride the live cursor, like the cursor cube does, rather than a React commit.
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const s = useCyberspace.getState()
    const b = cellCentre(s.cursor, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes)
    g.position.set(b[0], b[1], b[2])

    // FINE ROTATION: the camera owns the spin. The direction from the camera
    // to the ghost is the way you are looking; read into cyberspace axes and
    // flattened onto the ground at the cursor, its compass bearing is where
    // the shard's +Z should face. Only a changed whole degree is written, so
    // a still camera writes nothing.
    if (!frame || !useShards.getState().deployFollow) return
    const c = state.camera.position
    const look: V3 = [b[0] - c.x, b[1] - c.y, b[2] - c.z]
    const bearing = bearingOf(frame, csDirection(axes, look))
    if (bearing !== null && bearing !== useShards.getState().deploySpin) useShards.getState().setDeploySpin(bearing)
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
      <ShardMesh shard={shard} scale={scale} ghost clip={clip} pose={pose} />
    </group>
  )
}
