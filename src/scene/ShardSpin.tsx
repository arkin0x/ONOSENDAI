/**
 * ShardSpin.tsx: a shard turning slowly on its own small canvas, for a card
 * that shows someone's avatar (PersonModal; arkinox, 2026-10-11: "an avatar
 * preview (spinning preview)").
 *
 * Framed the way the feed's pictures are (ThumbStage frameOf, framedDistance):
 * on the bounds of the shard and everything it places, from a three-quarter
 * view a little above, lit as on the bench (shardLight.tsx) so its faces read. It turns about
 * the vertical through the middle of those bounds. The canvas takes no
 * pointer events (r3f writes pointer-events inline on its wrapper, so it is
 * set on the Canvas itself), so the card under it scrolls and closes as
 * usual.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { ShardMesh } from './ShardMesh'
import { ShardLights } from './shardLight'
import { frameOf, framedDistance, type ThumbFrame } from './ThumbStage'

/** The camera's field of view, in degrees, as for the feed's pictures. */
const FOV = 35
/** Radians a second: one turn in about twelve seconds. */
const SPIN_PER_S = 0.5

function Spinning({ shard }: { shard: ShardModel }): JSX.Element | null {
  const { camera } = useThree()
  const turn = useRef<Group>(null)
  const [frame, setFrame] = useState<ThumbFrame | null>(null)
  useEffect(() => {
    let live = true
    setFrame(null)
    void frameOf(shard).then((f) => { if (live) setFrame(f) })
    return () => { live = false }
  }, [shard])
  useEffect(() => {
    if (!frame) return
    const d = framedDistance(frame.reach, FOV)
    camera.position.set(0, d * 0.42, d * 0.91)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [frame, camera])
  useFrame((_, dt) => {
    if (turn.current) turn.current.rotation.y += dt * SPIN_PER_S
  })
  if (!frame) return null
  return (
    <group ref={turn}>
      <group position={[-frame.centre[0], -frame.centre[1], -frame.centre[2]]}>
        <ShardMesh shard={shard} lit />
      </group>
    </group>
  )
}

/** `preserve` keeps the last frame in the canvas, for a reader that copies it (Cyberspace TV's panels). */
export function ShardSpin({ shard, size = 160, preserve = false }: { shard: ShardModel; size?: number; preserve?: boolean }): JSX.Element {
  return (
    <div className="shardspin" style={{ width: size, height: size }} aria-label={`${shard.name}, turning`} role="img">
      <Canvas
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: preserve }}
        camera={{ fov: FOV, near: 0.01, far: 100000 }}
        style={{ width: size, height: size, pointerEvents: 'none' }}
      >
        {/* Lit as on the bench, near the world's full color (shardLight.tsx; arkinox, 2026-10-12). */}
        <ShardLights />
        <Spinning shard={shard} />
      </Canvas>
    </div>
  )
}
