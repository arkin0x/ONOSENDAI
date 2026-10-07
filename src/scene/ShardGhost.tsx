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
 * The position follows the same rule. A deploy hides the item at
 * deployPoint, the centre of the cursor's cell at the zoom you build in (or
 * of the region, when the bag is smaller than a cell), and WorldShards and
 * WorldMessages draw a hidden item at its true place (itemCentre). The ghost
 * is drawn at itemCentre of that same deployPoint and sealed by the one
 * regionBox both use, so it is exactly what lands, centred in the cursor
 * cube, at every zoom (arkinox, 2026-10-01).
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
import { deployPoint, itemCentre, type ViewAxes } from '../lib/space'
import { bearingOf, csDirection, frameOf, placedPose, snapOffered, type V3 } from '../lib/pose'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { messagePreview } from '../lib/hidden'
import { ShardMesh } from './ShardMesh'
import { regionBox } from '../lib/clip'
import { WorldLabel } from './WorldLabel'
import { turnShard } from '../lib/turn'

interface Props {
  axes: ViewAxes
}

export function ShardGhost({ axes }: Props): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const model = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
  // What will land: the model turned by the deploy bar's TURN row, the same function the deploy uses.
  const deployTurn = useShards((s) => s.deployTurn)
  const shard = useMemo(() => (model ? turnShard(model, deployTurn) : null), [model, deployTurn])
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const unit = useShards((s) => s.deployUnit)
  const group = useRef<Group>(null)

  const scale = useMemo(() => {
    if (!shard) return 1
    const exp = unit - scaleExp
    return exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
  }, [shard, unit, scaleExp])
  // Where the deploy will hide it, and the region it will be sealed to there:
  // the preview is cropped the way the placed shard will be, so what you see
  // is what lands.
  const cursor = useCyberspace((s) => s.cursor)
  const deployHeight = useShards((s) => s.deployHeight)
  const at = useMemo(() => deployPoint(cursor, scaleExp, deployHeight), [cursor, scaleExp, deployHeight])
  const clip = useMemo(() => (shard ? regionBox(at, deployHeight, unit, axes) : undefined), [shard, at, deployHeight, unit, axes])

  // Standing on the ground where it lands, if that is what is being deployed.
  const plane = useCyberspace((s) => s.plane)
  const up = useShards((s) => s.deployUp)
  const spin = useShards((s) => s.deploySpin)
  const standing = up && snapOffered(plane, deployHeight)
  // In the view frame either way, exactly as WorldShards draws what lands
  // (pose.ts placedPose): after a compass turn the ghost turns with its place.
  const pose = useMemo(
    () => (shard ? placedPose(axes, standing ? { at, spin } : undefined) : undefined),
    [shard, standing, at, spin, axes],
  )
  // The frame the bearing is measured in, where it lands: recomputed only when
  // the cursor moves, not every frame the camera turns.
  const frame = useMemo(() => (standing ? frameOf(at) : null), [standing, at])

  // Where the item lands, live: itemCentre of the deploy point, read straight
  // from the stores each frame like the cursor cube, not from a React commit.
  const landingAt = (): [number, number, number] => {
    const st = useCyberspace.getState()
    const p = deployPoint(st.cursor, st.scaleExp, useShards.getState().deployHeight)
    return itemCentre(p, alignedOrigin(st.anchor, st.scaleExp), st.scaleExp, axes)
  }

  // Ride the live cursor, like the cursor cube does, rather than a React commit.
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const b = landingAt()
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


  // A message ghosts as a dim note that follows the cursor.
  if (pending?.type === 'message') {
    return (
      <WorldLabel
        text={messagePreview(pending.text, 40)}
        color="#ffd27d"
        follow={landingAt}
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
