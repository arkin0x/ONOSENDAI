/**
 * ThumbStage.tsx - the one hidden canvas that draws every shard picture.
 *
 * Mounted once for the whole app by ThumbHost, off screen and small, and only
 * while there are pictures to draw: every list of shards asks the same queue
 * (store/useThumbs, hud/ShardThumb), so however many lists are open there is
 * one canvas, and none at all once the queue has been empty a while. It takes the first job
 * in useThumbs' queue, draws that object with the same ShardMesh the world
 * uses, framed on its own bounds from a three-quarter view, waits a few
 * frames for the draw to settle, and keeps the frame as an image. Then the
 * next. One WebGL context for the whole list, and it renders only while
 * there is something to draw (frameloop "never" when the queue is empty).
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { placedBounds, resolveParts, type Placed } from 'sno-core/parts'
import { fetchRef } from '../lib/parts'
import { keepPrograms } from '../lib/keepPrograms'
import { ShardMesh } from './ShardMesh'
import { ShardLights } from './shardLight'
import { useThumbs, type ThumbJob } from '../store/useThumbs'

/** The picture's size in pixels; tiles show it at about half that, so it stays sharp on a phone. */
export const THUMB_PX = 160

/**
 * Frames drawn before the picture is taken, for a shape with no parts. The
 * stage draws each frame itself, then reads it straight back (Capture), so the
 * first frame the shape is in is the picture: there is nothing to settle (no
 * decode on the stage, and the point discs are sized before the draw). Four,
 * at the display's rate, made every picture wait four frames.
 */
export const SETTLE_FRAMES = 1
/** For an object that places others, once their payloads are in hand: ShardMesh resolves them again from the shared cache. */
const PARTS_SETTLE_FRAMES = 12
/** How long a composite object's parts get to arrive before it is drawn with what came (a placeholder for the rest). */
const PARTS_WAIT_MS = 8000

/** How long the canvas stays after the queue empties: a scroll that pauses does not make a new WebGL context. */
export const IDLE_MS = 8000
/** How long one picture may take before the stage is made again (a lost context draws nothing, ever). Past PARTS_WAIT_MS. */
export const JOB_LIMIT_MS = 12000

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

/** How far a camera with this field of view stands for a sphere of `reach` to fit with a little room. */
export function framedDistance(reach: number, fovDeg: number): number {
  return (reach / Math.sin((fovDeg / 2) * (Math.PI / 180))) * 1.08
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

  // The frame the camera was last placed for, and whether the picture is taken.
  const placed = useRef<ThumbFrame | null>(null)
  const taken = useRef(false)

  // Priority 1: this canvas is drawn here and not by r3f, so the frame read
  // back is the one just drawn, not the one before it. The camera is placed
  // here too, before the draw: placed in an effect, it could still stand
  // where the last picture had it when the first frame was drawn.
  useFrame(({ scene }) => {
    const t0 = import.meta.env.DEV ? performance.now() : 0
    if (frame && placed.current !== frame) {
      placed.current = frame
      frames.current = 0
      // A three-quarter view from above and to the right, far enough that the
      // sphere around the object fits the frame with a little room, whatever
      // its proportions: the direction (0.62, 0.48, 0.62) normalized, times
      // the distance.
      const d = framedDistance(frame.reach, FOV)
      const n = Math.hypot(0.62, 0.48, 0.62)
      camera.position.set((d * 0.62) / n, (d * 0.48) / n, (d * 0.62) / n)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }
    gl.render(scene, camera)
    if (!frame) return
    // A lost context draws nothing and three says nothing (render returns
    // early), yet the canvas still reads back, blank: kept, that blank would
    // stand for the shape on this device for good (review of #451). So a
    // frame counts only when the context is there and something was drawn
    // in it; until then the job waits, and the watchdog (ThumbHost) makes the
    // stage again.
    if (gl.getContext().isContextLost() || gl.info.render.calls === 0) return
    frames.current += 1
    if (frames.current < wait || taken.current) return
    taken.current = true
    try {
      const url = gl.domElement.toDataURL('image/png')
      if (import.meta.env.DEV) measured(gl, job.key, performance.now() - t0)
      useThumbs.getState().done(job.key, url)
    } catch {
      useThumbs.getState().fail(job.key)
    }
  }, 1)

  if (!frame) return null
  return (
    <group position={[-frame.centre[0], -frame.centre[1], -frame.centre[2]]}>
      <ShardMesh key={job.key} shard={job.shard} lit />
    </group>
  )
}

/**
 * In development only, for the browser smoke test: how long each picture took
 * from the job reaching the stage to the image, the main thread spent on the
 * frame that drew and read it, and what the renderer holds
 * after it (window.__thumbs). Geometries and textures should come back to
 * where they were: each picture's are let go when it unmounts.
 */
interface ThumbStats { started: Record<string, number>; ms: number[]; work: number[]; memory: Array<{ geometries: number; textures: number; programs: number }>; contexts: number }
function stats(): ThumbStats {
  const w = window as unknown as { __thumbs?: ThumbStats }
  w.__thumbs ??= { started: {}, ms: [], work: [], memory: [], contexts: 0 }
  return w.__thumbs
}
function measured(gl: { info: { memory: { geometries: number; textures: number }; programs: unknown[] | null } }, key: string, work: number): void {
  const s = stats()
  s.work.push(work)
  const t0 = s.started[key]
  if (t0 !== undefined) { s.ms.push(performance.now() - t0); delete s.started[key] }
  s.memory.push({ geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 })
}

export function ThumbStage(): JSX.Element {
  const job = useThumbs((s) => s.queue[0] ?? null)
  if (import.meta.env.DEV && job) stats().started[job.key] ??= performance.now()
  return (
    <div className="thumbstage" aria-hidden="true">
      <Canvas
        frameloop={job ? 'always' : 'never'}
        dpr={1}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        camera={{ fov: FOV, near: 0.01, far: 100000 }}
        style={{ width: THUMB_PX, height: THUMB_PX }}
        // One shard after another on the same canvas: compiled once (lib/keepPrograms).
        onCreated={({ gl, scene }) => { keepPrograms(gl, scene); if (import.meta.env.DEV) stats().contexts++ }}
      >
        {/* Lit as on the bench, near the world's full color (shardLight.tsx; arkinox, 2026-10-12). */}
        <ShardLights />
        {/* Keyed: each job starts with no frame, so none is drawn on the last one's framing. */}
        {job && <Capture key={job.key} job={job} />}
      </Canvas>
    </div>
  )
}

/**
 * Catches a stage that throws: the shard being drawn fails (its row shows the
 * icon) and the stage is made again for the rest. One bad shard does not take
 * every picture with it (review of #451); a canvas that cannot be made at all
 * (no WebGL) throws every time, and after MAX_STALLS in a row the pictures
 * stop for the session (useThumbs crash).
 */
class StageBoundary extends Component<{ children: ReactNode; onCrash: () => void }, { broken: boolean }> {
  state = { broken: false }
  static getDerivedStateFromError(): { broken: boolean } { return { broken: true } }
  componentDidCatch(e: unknown): void {
    console.warn('[onosendai] shard pictures: the drawing stage failed', e)
    this.props.onCrash()
  }
  render(): ReactNode { return this.state.broken ? null : this.props.children }
}

/** Whether the page is on screen. A hidden page draws no frames, so nothing on the stage can finish. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = (): void => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/**
 * The stage, mounted at the app's root (App.tsx): there while the queue has
 * something in it and IDLE_MS after, so a list costs one WebGL context while
 * its pictures are drawn and none once they are. A picture that takes longer
 * than JOB_LIMIT_MS (a lost context never draws again) goes to the back of the
 * queue, once (useThumbs stall), and the stage is made again. Not while the
 * page is hidden: a hidden page draws no frames, and counting that as stalls
 * turned the pictures off for a tab left in the background (review of #451).
 */
export function ThumbHost(): JSX.Element | null {
  const busy = useThumbs((s) => s.queue.length > 0 && !s.disabled)
  const head = useThumbs((s) => s.queue[0]?.key ?? null)
  const [up, setUp] = useState(false)
  const [made, setMade] = useState(0)
  const visible = useVisible()
  useEffect(() => {
    if (busy) { setUp(true); return }
    if (!up) return
    const t = window.setTimeout(() => setUp(false), IDLE_MS)
    return () => window.clearTimeout(t)
  }, [busy, up])
  useEffect(() => {
    if (!head || !visible) return
    const t = window.setTimeout(() => { useThumbs.getState().stall(head); setMade((n) => n + 1) }, JOB_LIMIT_MS)
    return () => window.clearTimeout(t)
  }, [head, made, visible])
  // A stage that threw is made again only for a job to draw: with none (a
  // browser without WebGL, the queue emptied by the crash), making it again
  // would only throw again, every frame (review of #451). It waits, broken,
  // for the next job.
  const [broken, setBroken] = useState(false)
  const crashed = (): void => {
    const first = useThumbs.getState().queue[0]?.key
    if (first) useThumbs.getState().crash(first)
    setBroken(true)
  }
  useEffect(() => {
    if (!broken || !head) return
    setBroken(false)
    setMade((n) => n + 1)
  }, [broken, head])
  if (!up) return null
  return <StageBoundary key={made} onCrash={crashed}><ThumbStage /></StageBoundary>
}
