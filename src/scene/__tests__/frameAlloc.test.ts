/**
 * What a frame allocates, standing still. A desktop draws 144 of them a second, so
 * a kilobyte a frame is about 8 MB a minute of garbage (singlePass.test.ts guards
 * the same thing for three's two-pass flip). These fail without the fixes.
 */
import fs from 'node:fs'
import inspector from 'node:inspector'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { claimScreenAxes, viewAxes, type ViewAxes } from '../../lib/space'
import { opaqueOrder, sortWithoutBoxing, transparentOrder, type Sortable } from '../../lib/sortNoAlloc'

/** A budget per sort of 200 objects: its working copy of about 3 KB, and room for noise. */
const SORT_BUDGET_KB = 8

const post = <T>(s: inspector.Session, method: string, params?: object): Promise<T> =>
  new Promise((resolve, reject) => { s.post(method, params as never, (e, r) => (e ? reject(e) : resolve(r as T))) })

interface SampledNode { selfSize: number; children: SampledNode[] }

/** What `run` allocated in KB, by V8's sampling heap profiler, collected or not. Nothing here touches the network. */
async function allocatedKb(run: () => void): Promise<number> {
  const s = new inspector.Session()
  s.connect()
  try {
    await post(s, 'HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
    run()
    const { profile } = await post<{ profile: { head: SampledNode } }>(s, 'HeapProfiler.stopSampling')
    const sum = (n: SampledNode): number => n.selfSize + n.children.reduce((t, c) => t + sum(c), 0)
    return sum(profile.head) / 1024
  } finally {
    s.disconnect()
  }
}

const item = (i: number): Sortable => ({ groupOrder: i % 3 === 0 ? 1 : 0, renderOrder: i % 5, material: { id: i % 7 }, z: Math.sin(i) * 100.5, id: i })
const items = (n: number): Sortable[] => Array.from({ length: n }, (_, i) => item(i))

// three's own, as they stand in three.module.js: the order these must keep.
function painterSortStable(a: Sortable, b: Sortable): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder
  if (a.material.id !== b.material.id) return a.material.id - b.material.id
  if (a.z !== b.z) return a.z - b.z
  return a.id - b.id
}
function reversePainterSortStable(a: Sortable, b: Sortable): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder
  if (a.z !== b.z) return b.z - a.z
  return a.id - b.id
}

describe('three\'s render orders, unboxed', () => {
  it('keep exactly three\'s order', () => {
    const list = items(400)
    expect(list.slice().sort(opaqueOrder).map((x) => x.id)).toEqual(list.slice().sort(painterSortStable).map((x) => x.id))
    expect(list.slice().sort(transparentOrder).map((x) => x.id)).toEqual(list.slice().sort(reversePainterSortStable).map((x) => x.id))
  })

  it('still match three\'s source: an upgrade that changes its order fails here', () => {
    const three = fs.readFileSync(path.resolve(__dirname, '../../../node_modules/three/build/three.module.js'), 'utf8')
    expect(three).toMatch(/function reversePainterSortStable\( a, b \) \{\s+if \( a\.groupOrder !== b\.groupOrder \) \{\s+return a\.groupOrder - b\.groupOrder;\s+\} else if \( a\.renderOrder !== b\.renderOrder \) \{\s+return a\.renderOrder - b\.renderOrder;\s+\} else if \( a\.z !== b\.z \) \{\s+return b\.z - a\.z;\s+\} else \{\s+return a\.id - b\.id;/)
    expect(three).toMatch(/function painterSortStable\( a, b \) \{\s+if \( a\.groupOrder !== b\.groupOrder \) \{\s+return a\.groupOrder - b\.groupOrder;\s+\} else if \( a\.renderOrder !== b\.renderOrder \) \{\s+return a\.renderOrder - b\.renderOrder;\s+\} else if \( a\.material\.id !== b\.material\.id \) \{\s+return a\.material\.id - b\.material\.id;\s+\} else if \( a\.z !== b\.z \) \{\s+return a\.z - b\.z;\s+\} else \{\s+return a\.id - b\.id;/)
  })

  it('answer in small integers, which allocate nothing', () => {
    const list = items(200)
    for (const a of list) for (const b of list.slice(0, 20)) {
      for (const f of [opaqueOrder, transparentOrder]) expect([-1, 0, 1]).toContain(f(a, b) + 0)
    }
  })

  it('a depth tie, or NaN, is the same as three\'s', () => {
    const a = { ...item(1), z: NaN }, b = { ...item(1), id: 2, z: 5 }
    expect(transparentOrder(a, b)).toBe(0)
    expect(Number.isNaN(reversePainterSortStable(a, b))).toBe(true)
  })

  it('the main view uses them', () => {
    const scene = fs.readFileSync(path.resolve(__dirname, '../Scene.tsx'), 'utf8')
    expect(scene).toMatch(/sortWithoutBoxing\(gl\)/)
    let opaque: unknown, transparent: unknown
    sortWithoutBoxing({ setOpaqueSort: (f) => { opaque = f }, setTransparentSort: (f) => { transparent = f } })
    expect(opaque).toBe(opaqueOrder)
    expect(transparent).toBe(transparentOrder)
  })

  /**
   * The budget itself, measured by V8's own allocation sampler. Three's comparator
   * allocates about 20 KB for a sort of 200 objects, a handful of frames' worth at
   * his spot, and the unboxed one leaves only the sort's working copy, about 3 KB.
   */
  it('a sort of 200 stays under its budget, where three\'s comparator is over it', async () => {
    const list = items(200)
    const kbPerSort = async (f: (a: Sortable, b: Sortable) => number): Promise<number> =>
      (await allocatedKb(() => { for (let i = 0; i < 300; i++) { for (let k = 0; k < list.length; k++) list[k].z = Math.sin(k + i) * 100.5; list.sort(f) } })) / 300
    // Warmed up first: what is measured is running code and not its compile.
    await kbPerSort(transparentOrder)
    await kbPerSort(reversePainterSortStable)
    expect(await kbPerSort(transparentOrder)).toBeLessThan(SORT_BUDGET_KB)
    expect(await kbPerSort(reversePainterSortStable)).toBeGreaterThan(SORT_BUDGET_KB)
  })
})

describe('the view\'s axes', () => {
  const q = (): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)

  it('asked for again in one view, they are the same object, so nothing is allocated', () => {
    const view = q()
    const a = viewAxes(view)
    expect(viewAxes(view)).toBe(a)
    expect(viewAxes(q())).toBe(a)
  })

  it('a new view gets its own answer, and going back gets the right one', () => {
    const a = viewAxes(q())
    const none = viewAxes(new Quaternion())
    expect(none).not.toEqual(a)
    expect(none.right).toEqual({ axis: 'x', dir: 1 })
    expect(viewAxes(q())).toEqual(a)
  })

  it('are frozen, since every caller shares them', () => {
    const a = viewAxes(new Quaternion())
    expect(Object.isFrozen(a)).toBe(true)
    expect(Object.isFrozen(a.right)).toBe(true)
  })

  it('a thousand asks in one view cost a fraction of working them out each time', async () => {
    const one = new Quaternion(), other = q()
    const asks = (n: number, flip: boolean): void => { for (let i = 0; i < n; i++) viewAxes(flip && i % 2 ? other : one) }
    // Warmed up first, so what is measured is running code and not its compile.
    asks(20_000, true)
    asks(20_000, false)
    const kept = await allocatedKb(() => asks(1000, false))
    const worked = await allocatedKb(() => asks(1000, true))
    expect(kept * 4).toBeLessThan(worked)
  })

  it('a hook that selects them stays still between view changes, so it does not re-render', () => {
    const view = new Quaternion()
    const seen = new Set<ViewAxes>()
    for (let i = 0; i < 1000; i++) seen.add(viewAxes(view))
    expect(seen.size).toBe(1)
  })
})

describe('claiming the screen\'s axes', () => {
  const local = viewAxes(new Quaternion())
  const vectors = (n: number): Vector3[][] => Array.from({ length: n }, (_, i) => [
    new Vector3(Math.sin(i), Math.cos(i * 2), Math.sin(i * 3)),
    new Vector3(Math.cos(i * 5), Math.sin(i * 7), Math.cos(i * 11)),
    new Vector3(Math.sin(i * 13), Math.cos(i * 17), Math.sin(i * 19)),
  ])

  it('allocates only its answer: three small objects and their wrapper', async () => {
    const [r, u, o] = vectors(1)[0]
    for (let i = 0; i < 2000; i++) claimScreenAxes(r, u, o, local)
    const kb = await allocatedKb(() => { for (let i = 0; i < 1000; i++) claimScreenAxes(r, u, o, local) })
    // 160 bytes a call or so, where the closures and arrays it replaced took about 700.
    expect(kb).toBeLessThan(400)
  })

  it('is a permutation for any input, whatever the three vectors', () => {
    for (const [r, u, o] of vectors(500)) {
      const s = claimScreenAxes(r, u, o, local)
      expect(new Set([s.right.axis, s.up.axis, s.out.axis]).size).toBe(3)
    }
    const zero = new Vector3()
    const s = claimScreenAxes(zero, zero, zero, local)
    expect(new Set([s.right.axis, s.up.axis, s.out.axis]).size).toBe(3)
  })

  it('gives what the arrays and closures it replaced gave, on 2,000 random cameras', () => {
    const was = (right: Vector3, up: Vector3, out: Vector3, l: ViewAxes): ViewAxes => {
      const slots = [l.right, l.up, l.out]
      const taken = [false, false, false]
      const claim = (v: Vector3) => {
        const c = [v.x, v.y, v.z]
        let i = -1
        for (let k = 0; k < 3; k++) {
          if (taken[k]) continue
          if (i === -1 || Math.abs(c[k]) > Math.abs(c[i])) i = k
        }
        taken[i] = true
        const dir = (slots[i].dir * (c[i] >= 0 ? 1 : -1)) as 1 | -1
        return { axis: slots[i].axis, dir }
      }
      const r = claim(right), u = claim(up), o = claim(out)
      return { right: r, up: u, out: o }
    }
    for (const [r, u, o] of vectors(2000)) expect(claimScreenAxes(r, u, o, local)).toEqual(was(r, u, o, local))
  })
})
