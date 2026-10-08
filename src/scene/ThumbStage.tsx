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
import { useEffect, useRef, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { placedBounds, resolveParts, type Placed } from 'sno-core/parts'
import { fetchRef } from '../lib/parts'
import { ShardMesh } from './ShardMesh'
import { useThumbs, type ThumbJob } from '../store/useThumbs'

/** The picture's size in pixels; tiles show it at about half that, so it stays sharp on a phone. */
export const THUMB_PX = 160

/** Frames drawn before the picture is taken: the decode and the first draw settle in this. */
const SETTLE_FRAMES = 4
/** For an object that places others, once their payloads are in hand: ShardMesh resolves them again from the shared cache. */
const PARTS_SETTLE_FRAMES = 12
/** How long a composite object's parts get to arrive before it is drawn with what came (a placeholder for the rest). */
const PARTS_WAIT_MS = 8000

/** The camera's field of view, in degrees. */
const FOV = 35

/** A frame: the middle of what is drawn and the radius of the sphere around it, in render space. */
export interface ThumbFrame { centre: [number, number, number]; reach: number }

/** The frame around a box in render space; a default for nothing at all. */
export function frameOfBounds(b: { min: number[]; max: number[] } | null): ThumbFrame {
  if (!b) return { centre: [0, 0, 0], reach: 2 }
  const centre = [0, 1, 2].map((a) => (b.min[a] + b.max[a]) / 2) as [number, number, number]
  const half = [0, 1, 2].map((a) => (b.max[a] - b.min[a]) / 2)
  return { centre, reach: Math.max(0.5, Math.hypot(half[0], half[1], half[2])) }
}

/**
 * The frame around an object and everything it places (sno-core placedBounds),
 * once its parts have been fetched: an object that is only the arrangement of
 * others ("Column Wall") has no vertices of its own to frame, and drawn before
 * its parts arrived it came out blank, and stayed blank (review of #233).
 */
export async function frameOf(shard: ShardModel): Promise<ThumbFrame> {
  if (!shard.refs?.length || !shard.parts?.length) return frameOfBounds(placedBounds(shard, []))
  const timeout = new Promise<Placed[] | null>((resolve) => setTimeout(() => resolve(null), PARTS_WAIT_MS))
  const placed = await Promise.race([resolveParts(shard, fetchRef).catch(() => null), timeout])
  return frameOfBounds(placedBounds(shard, placed ?? []))
}

function Capture({ job }: { job: ThumbJob }): JSX.Element | null {
  const { gl, camera } = useThree()
  const frames = useRef(0)
  // The frame, once the parts (if any) are in hand; nothing is drawn before.
  const [frame, setFrame] = useState<ThumbFrame | null>(null)
  const wait = job.shard.parts?.length ? PARTS_SETTLE_FRAMES : SETTLE_FRAMES
  useEffect(() => {
    let live = true
    setFrame(null)
    void frameOf(job.shard).then((f) => { if (live) setFrame(f) })
    return () => { live = false }
  }, [job.key, job.shard])

  // A three-quarter view from above and to the right, far enough that the
  // sphere around the object fits the frame with a little room, whatever its
  // proportions.
  useEffect(() => {
    if (!frame) return
    frames.current = 0
    const d = (frame.reach / Math.sin((FOV / 2) * (Math.PI / 180))) * 1.08
    // The direction (0.62, 0.48, 0.62) normalized, times the distance.
    const n = Math.hypot(0.62, 0.48, 0.62)
    camera.position.set((d * 0.62) / n, (d * 0.48) / n, (d * 0.62) / n)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [frame, camera])

  useFrame(() => {
    if (!frame) return
    frames.current += 1
    if (frames.current !== wait) return
    try {
      useThumbs.getState().done(job.key, gl.domElement.toDataURL('image/png'))
    } catch {
      useThumbs.getState().fail(job.key)
    }
  })

  if (!frame) return null
  return (
    <group position={[-frame.centre[0], -frame.centre[1], -frame.centre[2]]}>
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
