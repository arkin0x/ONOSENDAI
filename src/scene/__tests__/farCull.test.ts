/**
 * farCull.test.ts: a world shard too small on screen to be anything is not
 * drawn, and one dot is drawn in its place (owner, 2026-11-28: HOP at 2^14 near
 * the Block 101 town crawled, every shard of the town drawn in full while the
 * town was a few pixels across).
 */
import inspector from 'node:inspector'
import { afterEach, describe, expect, it } from 'vitest'
import { BoxGeometry, type BufferAttribute, BufferGeometry, Group, LineSegments, Mesh, Points, Scene, type Object3D } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { withGlow } from 'sno-core/glow'
import { canonicalQuaternion, viewAxes, type Position } from '../../lib/space'
import { SHARD_DECODE_MS } from '../../lib/decode'
import { DOOR_DISSOLVE_MS } from '../../lib/ceremony'
import { projScaleOf } from '../../lib/markerSize'
import { setGuideBags } from '../../tutorial/guideBags'
import { FOV } from '../camera'
import { FarCull, HIDE_BELOW_PX, SHOW_ABOVE_PX, farCullEntry, measureEntry, nextHidden, setShard, shardColour, type FarCullEntry } from '../farCull'
import { dotBuffers, writeDots } from '../FarShardDots'
import { drawableShards, farCullUnits, type PlacedShardDraw } from '../WorldShards'

/** Pixels per render unit at one unit of depth on a 1,000 px tall view. */
const PROJ = projScaleOf(1000, FOV)
const NOW = 100_000

/** A shard at the origin, `extent` units each way, solid, in one colour. */
function cube(name: string, extent = 16, c: [number, number, number] = [1, 0.5, 0]): ShardModel {
  const v = (x: number, y: number, z: number) => ({ p: [x, y, z] as [number, number, number], c })
  return {
    ...newShard(name), unit: 0, extent, mode: 'solid',
    vertices: [v(-extent, -extent, -extent), v(extent, -extent, -extent), v(0, extent, -extent), v(0, 0, extent)],
    faces: [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]],
  }
}

/** A shard drawn as three draws (faces, lines and points, as ShardMesh does), under its positioned group and the group the cull hides. */
function drawnShard(scene: Scene, e: FarCullEntry, centre: [number, number, number]): void {
  const at = new Group()
  at.position.set(...centre)
  const group = new Group()
  const drawn = new Group()
  // As large as the shard draws: its grid, at its scale.
  const side = 2 * e.shard!.extent * e.scale
  const g = new BoxGeometry(side, side, side)
  drawn.add(new Mesh(g), new LineSegments(g), new Points(g))
  group.add(drawn)
  at.add(group)
  scene.add(at)
  e.at = at
  e.group = group
  e.drawn = drawn
}

/** An entry for `shard` at `scale`, in the scene at `centre`, in `cull`. */
function placed(cull: FarCull, scene: Scene, shard: ShardModel, centre: [number, number, number] = [0, 0, 0], scale = 1, key = shard.id): FarCullEntry {
  const e = farCullEntry(key)
  e.scale = scale
  setShard(e, shard, farCullUnits(shard))
  drawnShard(scene, e, centre)
  cull.add(e)
  return e
}

/** The camera on the z axis, `d` from the origin: one object, so a frame in a test allocates nothing of its own. */
const theEye = { x: 0, y: 0, z: 0 }
const eye = (d: number) => { theEye.z = d; return theEye }
/** The shards drawn as dots now. */
const dotted = (cull: FarCull) => cull.dots.slice(0, cull.dotCount)

/** Draw calls a renderer would issue for `root`: every mesh, line and points object whose whole chain is visible, with something to draw. */
function drawCalls(root: Object3D): number {
  let n = 0
  root.traverseVisible((o) => {
    const geo = (o as { geometry?: BufferGeometry }).geometry
    if (!(o as Mesh).isMesh && !(o as Points).isPoints && !(o as LineSegments).isLine) return
    if (geo && geo.drawRange.count === 0) return
    n++
  })
  return n
}

/** How many times an attribute of the dots was marked for upload. */
const version = (buf: { geometry: BufferGeometry }, name: string): number => (buf.geometry.getAttribute(name) as BufferAttribute).version

afterEach(() => setGuideBags(null))

describe('hysteresis', () => {
  it('hides under HIDE_BELOW_PX and shows again only over SHOW_ABOVE_PX', () => {
    expect(HIDE_BELOW_PX).toBeLessThan(SHOW_ABOVE_PX)
    expect(nextHidden(false, 1.5)).toBe(false)
    expect(nextHidden(false, 0.9)).toBe(true)
    expect(nextHidden(true, 1.5)).toBe(true)
    expect(nextHidden(true, 2.1)).toBe(false)
  })

  it('a shard at the line does not flicker as the camera eases in and out', () => {
    const cull = new FarCull()
    const scene = new Scene()
    const e = placed(cull, scene, cube('a', 1))
    // Its reach is √3 units: radius √3 × PROJ / d pixels.
    const r = farCullUnits(e.shard!)
    const at = (px: number) => (r * PROJ) / px
    const step = (px: number) => { cull.frame(eye(at(px)), PROJ, NOW); return e.hidden }
    expect(step(1.9)).toBe(false)
    expect(step(0.95)).toBe(true)
    expect(e.group!.visible).toBe(false)
    expect(step(1.5)).toBe(true)
    expect(step(1.9)).toBe(true)
    expect(step(2.1)).toBe(false)
    expect(e.group!.visible).toBe(true)
    expect(step(1.2)).toBe(false)
    expect(step(0.99)).toBe(true)
  })

  it('never hides a shard the eye is inside', () => {
    const cull = new FarCull()
    const e = placed(cull, new Scene(), cube('room', 64), [0, 0, 0], 1 / 1024)
    // Its reach is about 0.108 render units: the eye at 0.05 is inside, whatever a pixel test would say.
    cull.frame(eye(0.05), 0.001, NOW)
    expect(e.hidden).toBe(false)
  })
})

describe('glow', () => {
  it('a glow widens the sphere by its radius', () => {
    const plain: ShardModel = { ...cube('dust', 1), mode: 'points' }
    const glowing = withGlow({ ...plain, id: 'glow' }, { style: 'light', radius: 64 * 120, strength: 50 })
    expect(farCullUnits(glowing) - farCullUnits(plain)).toBeCloseTo(64, 6)
  })

  it('so a glowing shard stays drawn where a plain one of the same size is hidden', () => {
    const cull = new FarCull()
    const scene = new Scene()
    const plainShard: ShardModel = { ...cube('dust', 1), mode: 'points' }
    const plain = placed(cull, scene, plainShard)
    const glowing = placed(cull, scene, withGlow({ ...plainShard, id: 'glow' }, { style: 'light', radius: 64 * 120, strength: 50 }))
    cull.frame(eye(10_000), PROJ, NOW)
    expect(plain.hidden).toBe(true)
    expect(glowing.hidden).toBe(false)
  })
})

describe('never hidden', () => {
  const far = 1e9
  const one = (edit: (e: FarCullEntry) => void, key?: string): FarCullEntry => {
    const cull = new FarCull()
    const e = placed(cull, new Scene(), cube('x'), [0, 0, 0], 1, key)
    edit(e)
    cull.frame(eye(far), PROJ, NOW)
    return e
  }

  it('the shard being edited', () => {
    expect(one((e) => { e.moving = true }).hidden).toBe(false)
    expect(one(() => {}).hidden).toBe(true)
  })

  it('a shard being born, until its decode is done', () => {
    expect(one((e) => { e.birth = NOW - 100 }).hidden).toBe(false)
    expect(one((e) => { e.birth = NOW - SHARD_DECODE_MS - 1 }).hidden).toBe(true)
  })

  it('a shard dissolving, until it is gone', () => {
    expect(one((e) => { e.dissolve = NOW - 100 }).hidden).toBe(false)
    expect(one((e) => { e.dissolve = NOW - DOOR_DISSOLVE_MS - 1 }).hidden).toBe(true)
  })

  it('the tutorial\'s shards: those it lets taps through, those its marks draw, and any its guide placed', () => {
    setGuideBags([], { passTaps: ['wall'], drawnByMark: ['box'] })
    expect(one(() => {}, 'wall').hidden).toBe(false)
    expect(one(() => {}, 'box').hidden).toBe(false)
    setGuideBags([{ id: 'b', pubkey: 'guide', kind: 1, tags: [['d', 'x']], content: '', created_at: 0, sig: '' }])
    expect(one((e) => { e.container = 'guide' }).hidden).toBe(false)
    expect(one((e) => { e.container = 'someone' }).hidden).toBe(true)
  })

  it('a shard that places objects, until its drawn box has been measured', () => {
    const placing = { ...cube('arch'), parts: [{ ref: 'a:33331:' + 'f'.repeat(64) + ':o', at: [0, 0, 0] }] } as unknown as ShardModel
    const cull = new FarCull()
    const scene = new Scene()
    const e = placed(cull, scene, placing)
    e.drawn = null
    cull.frame(eye(far), PROJ, NOW)
    expect(e.hidden).toBe(false)
  })
})

describe('placed objects', () => {
  it('a placed object far larger than its parent keeps the parent drawn, measured from the drawn box', () => {
    const placing = { ...cube('arch', 1), parts: [{ ref: 'a:33331:' + 'f'.repeat(64) + ':o', at: [0, 0, 0] }] } as unknown as ShardModel
    const cull = new FarCull()
    const scene = new Scene()
    const e = placed(cull, scene, placing, [5, 0, 0])
    // The placed object: 400 units across, beside the parent.
    const big = new Mesh(new BoxGeometry(400, 400, 400))
    big.position.set(100, 0, 0)
    e.drawn!.add(big)
    scene.updateMatrixWorld(true)
    measureEntry(e)
    expect(e.measured).toBe(true)
    // The far corner: 300 out on x, 200 on y and z.
    expect(e.measuredUnits).toBeCloseTo(Math.hypot(300, 200, 200), 6)
    const d = 20_000
    cull.frame(eye(d), PROJ, NOW)
    expect(e.hidden).toBe(false)
    // Without it, the parent alone is under a pixel there.
    expect((farCullUnits(placing) * PROJ) / d).toBeLessThan(HIDE_BELOW_PX)
  })

  it('measured in turn, a few a frame, and kept at the largest seen', () => {
    const placing = { ...cube('arch', 1), parts: [{ ref: 'a:33331:' + 'f'.repeat(64) + ':o', at: [0, 0, 0] }] } as unknown as ShardModel
    const cull = new FarCull()
    const scene = new Scene()
    const list = Array.from({ length: 6 }, (_, i) => placed(cull, scene, { ...placing, id: `p${i}` }, [i * 10, 0, 0]))
    scene.updateMatrixWorld(true)
    cull.frame(eye(1e9), PROJ, NOW)
    expect(list.filter((e) => e.measured).length).toBe(2)
    cull.frame(eye(1e9), PROJ, NOW)
    cull.frame(eye(1e9), PROJ, NOW)
    expect(list.every((e) => e.measured)).toBe(true)
    const was = list[0].measuredUnits
    list[0].drawn!.clear()
    for (let i = 0; i < 3; i++) cull.frame(eye(1e9), PROJ, NOW)
    expect(list[0].measuredUnits).toBe(was)
  })
})

describe('the dots', () => {
  it('one per hidden shard, in its colour, at its place; rebuilt when the set changes, moved when a shard moves', () => {
    const cull = new FarCull()
    const scene = new Scene()
    const a = placed(cull, scene, cube('a', 1, [1, 0, 0]), [1, 0, 0])
    const b = placed(cull, scene, cube('b', 1, [0, 1, 0]), [2, 0, 0])
    const c = placed(cull, scene, cube('c', 100, [0, 0, 1]), [3, 0, 0])
    let buf = dotBuffers(1)
    expect(cull.frame(eye(10_000), PROJ, NOW)).toBe(true)
    buf = writeDots(cull, buf, true)
    expect(dotted(cull)).toEqual([a, b])
    expect(buf.geometry.drawRange.count).toBe(2)
    expect(buf.capacity).toBe(2)
    expect(Array.from(buf.colors.slice(0, 6))).toEqual([1, 0, 0, 0, 1, 0])
    expect(Array.from(buf.positions.slice(0, 6))).toEqual([1, 0, 0, 2, 0, 0])
    expect(c.dotted).toBe(false)

    // Nothing changed: no rebuild, nothing sent again.
    const posVersion = version(buf, 'position')
    const colVersion = version(buf, 'aColor')
    expect(cull.frame(eye(10_000), PROJ, NOW)).toBe(false)
    buf = writeDots(cull, buf, false)
    expect(version(buf, 'position')).toBe(posVersion)
    expect(version(buf, 'aColor')).toBe(colVersion)

    // A landing moves every shard: the dot follows, the colours stay.
    a.at!.position.x = 5
    expect(cull.frame(eye(10_000), PROJ, NOW)).toBe(false)
    buf = writeDots(cull, buf, false)
    expect(buf.positions[0]).toBe(5)
    expect(version(buf, 'position')).toBeGreaterThan(posVersion)
    expect(version(buf, 'aColor')).toBe(colVersion)

    // b goes past the reach (its positioned group hidden): no dot for what is not drawn at all.
    b.at!.visible = false
    expect(cull.frame(eye(10_000), PROJ, NOW)).toBe(true)
    buf = writeDots(cull, buf, true)
    expect(dotted(cull)).toEqual([a])
    expect(buf.geometry.drawRange.count).toBe(1)

    // A shard taken down takes its dot.
    cull.remove(a)
    expect(cull.frame(eye(10_000), PROJ, NOW)).toBe(true)
    expect(dotted(cull)).toEqual([])

    // Close up, nothing is a dot.
    b.at!.visible = true
    const d = placed(cull, scene, cube('d', 1), [0, 0, 0])
    cull.frame(eye(10), PROJ, NOW)
    expect(dotted(cull)).toEqual([])
    expect(d.group!.visible).toBe(true)
  })

  it('outgrown, the buffers double and the old geometry is let go', () => {
    const cull = new FarCull()
    const scene = new Scene()
    for (let i = 0; i < 5; i++) placed(cull, scene, cube(`s${i}`, 1), [i, 0, 0])
    cull.frame(eye(1e6), PROJ, NOW)
    const first = dotBuffers(2)
    let disposed = false
    first.geometry.addEventListener('dispose', () => { disposed = true })
    const next = writeDots(cull, first, true)
    expect(next.capacity).toBe(8)
    expect(next.geometry.drawRange.count).toBe(5)
    expect(disposed).toBe(true)
  })

  it('a shard with no vertices of its own is a dot in the accent colour', () => {
    expect(shardColour({ ...newShard('empty') })).toEqual([0, 0.9, 1])
  })

  it('going away shows every shard again', () => {
    const cull = new FarCull()
    const e = placed(cull, new Scene(), cube('a', 1))
    cull.frame(eye(1e6), PROJ, NOW)
    expect(e.group!.visible).toBe(false)
    cull.restore()
    expect(e.group!.visible).toBe(true)
    expect(dotted(cull)).toEqual([])
  })
})

describe('a hub zoomed out', () => {
  const axes = viewAxes(canonicalQuaternion())
  const anchor: Position = { x: 1n << 60n, y: 1n << 60n, z: 1n << 60n }
  /** 200 shards over a town 4,096 gibsons across, about a Block 101 hub; one in ten places an object. */
  const town = Array.from({ length: 200 }, (_, i) => {
    const off = (k: number) => BigInt(Math.round(((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1) * 2048))
    const shard = i % 10 === 0
      ? { ...cube(`s${i}`, 16), parts: [{ ref: 'a:33331:' + 'f'.repeat(64) + ':o', at: [0, 0, 0] }] } as unknown as ShardModel
      : cube(`s${i}`, 4 + (i % 13))
    return { key: `k${i}`, type: 'shard' as const, at: { x: anchor.x + off(1), y: anchor.y + off(2), z: anchor.z + off(3) }, height: 8, plane: 0 as const, shard }
  })

  /** The town as the world mounts it at `scaleExp`, drawn, with the camera `d` out from the render origin on a 1,080 px tall view. */
  function hub(scaleExp: number, d: number): { cull: FarCull; scene: Scene; placed: PlacedShardDraw[]; dots: Points } {
    const cull = new FarCull()
    const scene = new Scene()
    // HOP's reach at its farthest orbit (buildZoom.ts).
    const shown = drawableShards(town, anchor, 0, scaleExp, axes, 768)
    for (const w of shown) {
      const e = farCullEntry(w.key)
      e.scale = w.scale
      setShard(e, w.shard, farCullUnits(w.shard))
      drawnShard(scene, e, w.centre)
      // A placed object as large again as its parent (16 units), beside it.
      if (w.shard.parts) {
        const part = new Mesh(new BoxGeometry(32 * w.scale, 32 * w.scale, 32 * w.scale))
        part.position.set(16 * w.scale, 0, 0)
        e.drawn!.add(part)
      }
      cull.add(e)
    }
    scene.updateMatrixWorld(true)
    const proj = projScaleOf(1080, FOV)
    // Long enough for every shard that places objects to be measured.
    for (let i = 0; i < 120; i++) cull.frame(eye(d), proj, NOW)
    let buf = dotBuffers(64)
    buf = writeDots(cull, buf, true)
    const dots = new Points(buf.geometry)
    dots.visible = cull.dotCount > 0
    scene.add(dots)
    return { cull, scene, placed: shown, dots }
  }

  it('at 2^14, a 200-shard hub issues under 20 shard draw calls (it was 600)', () => {
    const { scene, placed, cull } = hub(14, 96)
    expect(placed.length).toBe(200)
    // Every shard hidden would be 3 draws each, and one for every placed object.
    expect(drawCalls(scene)).toBeLessThan(20)
    expect(cull.dotCount).toBeGreaterThan(180)
  })

  it('at 2^0, up close, nothing changes: every shard in reach is drawn, and there are no dots', () => {
    for (const d of [2, 30, 96]) {
      const { scene, placed, cull } = hub(0, d)
      expect(placed.length).toBeGreaterThan(0)
      expect(cull.entries.every((e) => !e.hidden && e.group!.visible)).toBe(true)
      expect(cull.dotCount).toBe(0)
      const parts = placed.filter((w) => w.shard.parts).length
      expect(drawCalls(scene)).toBe(placed.length * 3 + parts)
    }
  })
})

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
    const list = Array.from({ length: 200 }, (_, i) => placed(cull, scene, cube(`f${i}`, i % 2 ? 1 : 200), [i, 0, 0]))
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
    // The profiler's first session costs about 37 KB of its own; later ones about 2 KB.
    await allocatedKb(() => {})
    expect(await allocatedKb(() => run(500))).toBeLessThan(12)
  })
})

