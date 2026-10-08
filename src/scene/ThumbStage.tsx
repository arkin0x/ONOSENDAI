/**
 * ThumbStage.tsx - the one hidden canvas that draws every feed picture.
 *
 * Mounted while a list of objects is on screen (the PLACE OBJECT picker's
 * FEED, the SHARD FEED window), off screen and small. It takes the first job
 * in useThumbs' queue, draws that object with the same ShardMesh the world
 * uses, framed on its own bounds from a three-quarter view, waits a few
 * frames for the draw to settle, and keeps the frame as an image. Then the
 * next. One WebGL context for the whole list, and it renders only while
 * there is something to draw (frameloop "never" when the queue is empty).
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { ticksOf, toRender, type ShardModel } from 'sno-core/shards'
import { ShardMesh } from './ShardMesh'
import { useThumbs, type ThumbJob } from '../store/useThumbs'

/** The picture's size in pixels; tiles show it at about half that, so it stays sharp on a phone. */
export const THUMB_PX = 160

/** Frames drawn before the picture is taken: the decode and the first draw settle in this. */
const SETTLE_FRAMES = 4
/** More for an object that places others: their payloads are fetched first. */
const PARTS_SETTLE_FRAMES = 40

/** The camera's field of view, in degrees. */
const FOV = 35

/** Where an object's points sit in render space: its middle and the radius of the sphere around it. */
export function frameOf(shard: ShardModel): { centre: [number, number, number]; reach: number } {
  if (shard.vertices.length === 0) return { centre: [0, 0, 0], reach: 2 }
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const v of shard.vertices) {
    const p = toRender(ticksOf(v))
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]) }
  }
  const centre = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2) as [number, number, number]
  const half = [0, 1, 2].map((a) => (hi[a] - lo[a]) / 2)
  const reach = Math.max(0.5, Math.hypot(half[0], half[1], half[2]))
  return { centre, reach }
}

function Capture({ job }: { job: ThumbJob }): JSX.Element {
  const { gl, camera } = useThree()
  const frames = useRef(0)
  const { centre, reach } = useMemo(() => frameOf(job.shard), [job.shard])
  const wait = job.shard.parts?.length ? PARTS_SETTLE_FRAMES : SETTLE_FRAMES

  // A three-quarter view from above and to the right, far enough that the
  // sphere around the object fits the frame with a little room, whatever its
  // proportions.
  useEffect(() => {
    frames.current = 0
    const d = (reach / Math.sin((FOV / 2) * (Math.PI / 180))) * 1.08
    // The direction (0.62, 0.48, 0.62) normalized, times the distance.
    const n = Math.hypot(0.62, 0.48, 0.62)
    camera.position.set((d * 0.62) / n, (d * 0.48) / n, (d * 0.62) / n)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [job.key, reach, camera])

  useFrame(() => {
    frames.current += 1
    if (frames.current !== wait) return
    try {
      useThumbs.getState().done(job.key, gl.domElement.toDataURL('image/png'))
    } catch {
      useThumbs.getState().fail(job.key)
    }
  })

  return (
    <group position={[-centre[0], -centre[1], -centre[2]]}>
      <ShardMesh key={job.key} shard={job.shard} lit />
    </group>
  )
}

export function ThumbStage(): JSX.Element {
  const job = useThumbs((s) => s.queue[0] ?? null)
  return (
    <div className="thumbstage" aria-hidden="true">
      <Canvas
        frameloop={job ? 'always' : 'never'}
        dpr={1}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        camera={{ fov: FOV, near: 0.01, far: 100000 }}
        style={{ width: THUMB_PX, height: THUMB_PX }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 4]} intensity={1.2} />
        {job && <Capture job={job} />}
      </Canvas>
    </div>
  )
}
