/**
 * farCullAlloc.test.ts: a frame of the size cull and its dots allocates
 * nothing (scene/farCull.ts, scene/FarShardDots.tsx).
 *
 * In a file of its own: the other tests give the pass shapes it never sees in
 * the app (an entry's groups let go mid-test, a model with no vertices), and
 * the compiler, sharing what it learns across a file, then leaves the pass
 * less optimised than the app's, which boxes numbers it would not.
 */
import inspector from 'node:inspector'
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, Scene } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { projScaleOf } from '../../lib/markerSize'
import { FOV } from '../camera'
import { FarCull, farCullEntry, setShard } from '../farCull'
import { dotBuffers, writeDots } from '../FarShardDots'
import { farCullUnits } from '../WorldShards'

const PROJ = projScaleOf(1000, FOV)
const NOW = 100_000
const theEye = { x: 0, y: 0, z: 0 }
const eye = (d: number) => { theEye.z = d; return theEye }

/** A shard at the origin, `extent` units each way. */
function cube(name: string, extent: number): ShardModel {
  const c: [number, number, number] = [1, 0.5, 0]
  return { ...newShard(name), unit: 0, extent, mode: 'solid', vertices: [{ p: [-extent, -extent, -extent], c }, { p: [extent, extent, extent], c }, { p: [0, extent, 0], c }], faces: [[0, 1, 2]] }
}

/** An entry as PlacedShard keeps one: every field written, its groups in a scene. */
function placed(cull: FarCull, scene: Scene, shard: ShardModel, x: number) {
  const e = farCullEntry(shard.id)
  e.container = undefined
  e.scale = 1
  e.moving = false
  e.birth = undefined
  setShard(e, shard, farCullUnits(shard))
  const at = new Group()
  at.position.set(x, 0, 0)
  const group = new Group()
  const drawn = new Group()
  drawn.add(new Mesh(new BoxGeometry(1, 1, 1)))
  group.add(drawn)
  at.add(group)
  scene.add(at)
  e.at = at
  e.group = group
  e.drawn = drawn
  cull.add(e)
  return e
}

describe('a frame', () => {
  const post = <T>(sess: inspector.Session, method: string, params?: object): Promise<T> =>
    new Promise((resolve, reject) => { sess.post(method, params as never, (err, r) => (err ? reject(err) : resolve(r as T))) })
  interface SampledNode { selfSize: number; children: SampledNode[] }
  /** What `run` allocated in KB, by V8's sampling heap profiler (frameAlloc.test.ts). */
  async function allocatedKb(run: () => void): Promise<number> {
    const sess = new inspector.Session()
    sess.connect()
    try {
      await post(sess, 'HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
      run()
      const { profile } = await post<{ profile: { head: SampledNode } }>(sess, 'HeapProfiler.stopSampling')
      const sum = (n: SampledNode): number => n.selfSize + n.children.reduce((t, c) => t + sum(c), 0)
      return sum(profile.head) / 1024
    } finally {
      sess.disconnect()
    }
  }

  it('allocates nothing: 200 shards, half of them crossing the line every frame, their dots rebuilt each time', async () => {
    const cull = new FarCull()
    const scene = new Scene()
    // The small half is 2.8 px of radius at 600 and 0.8 at 2,000: hidden and shown again on alternate frames.
    const list = Array.from({ length: 200 }, (_, i) => placed(cull, scene, cube(`f${i}`, i % 2 ? 1 : 200), i))
    let buf = dotBuffers(256)
    const run = (frames: number): void => {
      for (let f = 0; f < frames; f++) {
        const changed = cull.frame(eye(f % 2 ? 2_000 : 600), PROJ, NOW)
        buf = writeDots(cull, buf, changed)
      }
    }
    // Warmed, so the dot list has grown to its size once and the pass is compiled (unoptimised code boxes every number it works out).
    run(3000)
    expect(list.filter((e) => e.hidden).length).toBe(100)
    expect(cull.dotCount).toBe(100)
    run(1)
    expect(cull.dotCount).toBe(0)
    // The profiler's first session costs about 37 KB of its own, and the JIT may compile the pass again
    // in the first few hundred frames under it: both spent on a warm-up of their own. Later ones cost about 2 KB.
    await allocatedKb(() => run(500))
    // 5,000 frames: under 12 KB is under 3 bytes a frame, the profiler's own.
    expect(await allocatedKb(() => run(5000))).toBeLessThan(12)
  })
})

