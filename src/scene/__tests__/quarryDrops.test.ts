/**
 * quarryDrops.test.ts - the Quarry Charge's rules (lib/terrain/quarry.ts)
 * and its drops on the GPU (scene/quarryDrops.ts): the blast box, the fuse's
 * beeps speeding up, the blink and the countdown, drops read back from
 * storage, a step's cells; and the drops drawn as one InstancedMesh per
 * block kind, written again only when they change, a frame that only draws
 * allocating nothing.
 */

import inspector from 'node:inspector'
import { describe, expect, it } from 'vitest'
import { InstancedMesh } from 'three'
import { DropField } from '../quarryDrops'
import { BLAST_HALF, BLAST_SIDE, DROP_FADE_MS, DROP_LIFE_MS, FUSE_BEEPS, FUSE_MS, beepTimes, blastCells, blinkLit, bodyAt, dropLevel, makeDrop, secondsLeft, stepCells, tidyDrops, type Drop } from '../../lib/terrain/quarry'

const post = <T>(s: inspector.Session, method: string, params?: object): Promise<T> =>
  new Promise((resolve, reject) => { s.post(method, params as never, (e, r) => (e ? reject(e) : resolve(r as T))) })
interface SampledNode { selfSize: number; children: SampledNode[] }
/** What `run` allocated in KB, by V8's sampling heap profiler (as frameAlloc.test.ts measures). */
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

describe('the rules', () => {
  it('the blast is BLAST_SIDE cubed, 7 by 7 by 7, centred on the charge\'s cell', () => {
    expect(BLAST_SIDE).toBe(7)
    const cells = blastCells([10, -4, 3])
    expect(cells).toHaveLength(343)
    expect(new Set(cells.map((c) => c.join(','))).size).toBe(343)
    expect(cells[0]).toEqual([10, -4, 3])
    for (let a = 0; a < 3; a++) {
      const v = cells.map((c) => c[a])
      const at = [10, -4, 3][a]
      expect(Math.min(...v)).toBe(at - BLAST_HALF)
      expect(Math.max(...v)).toBe(at + BLAST_HALF)
    }
  })

  it('the fuse beeps faster and faster to its end; the lamp lights on each beep; the countdown says 3, 2, 1', () => {
    const t = beepTimes(FUSE_MS)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBeLessThan(FUSE_MS)
    const gaps = t.slice(1).map((v, i) => v - t[i])
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1])
    expect(gaps[0]).toBeGreaterThan(3 * gaps[gaps.length - 1])
    expect(FUSE_BEEPS).toEqual(t)
    expect(blinkLit(10)).toBe(true)
    expect(blinkLit(t[1] - 5)).toBe(false)
    expect(blinkLit(-1)).toBe(false)
    expect([0, 999, 1001, 2001, 2999, 3000].map((ms) => secondsLeft(ms))).toEqual([3, 3, 2, 1, 1, 0])
  })

  it('a drop lasts ten minutes, fading over its last seconds', () => {
    const d = makeDrop(1n, 2n, 3n, 0, 5, 1000)
    expect(d.expires).toBe(1000 + DROP_LIFE_MS)
    expect(DROP_LIFE_MS).toBe(600_000)
    expect(dropLevel(d.expires, 1000)).toBe(1)
    expect(dropLevel(d.expires, d.expires - DROP_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(dropLevel(d.expires, d.expires)).toBe(0)
  })

  it('drops read back from storage are kept only well formed and still floating, with the time they had', () => {
    const now = 5_000_000
    const good = makeDrop(-7n, 0x1234567890abcdefn, 3n, 1, 40, now - 60_000)
    const raw = [good, { ...good, id: 0 }, { ...good, id: 255 }, { ...good, plane: 2 }, { ...good, x: '1.5' }, { ...good, expires: now - 1 }, { ...good, expires: now + DROP_LIFE_MS + 5 }, null, 'x']
    const kept = tidyDrops(raw, now)
    expect(kept).toEqual([good])
    expect(kept[0].expires - now).toBe(DROP_LIFE_MS - 60_000)
    expect(tidyDrops('nope', now)).toEqual([])
  })

  it('a step collects every cell it passed through; a jump only where it lands; a body is two cells tall', () => {
    expect(stepCells([0, 0, 0], [3, 0, 0])).toEqual([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])
    expect(stepCells(null, [3, 0, 0])).toEqual([[3, 0, 0]])
    expect(stepCells([0, 0, 0], [30, 0, 0])).toEqual([[30, 0, 0]])
    expect(bodyAt([1, 2, 3])).toEqual([[1, 2, 3], [1, 3, 3]])
  })
})

describe('the drops on the GPU', () => {
  const field = { world: { origin: { x: 1000n, y: 2000n, z: 3000n } }, plane: 0 }
  /** 343 drops of three kinds, as a full blast of mixed ground leaves. */
  function full(): Drop[] {
    const out: Drop[] = []
    let i = 0
    for (let y = 0; y < 7; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) out.push(makeDrop(1000n + BigInt(x), 2000n + BigInt(y), 3000n + BigInt(z), 0, [1, 2, 40][i++ % 3], Date.now()))
    return out
  }

  it('one InstancedMesh per block kind, holding every drop of that kind', () => {
    const f = new DropField()
    const drops = full()
    expect(f.update(field, drops, 1)).toBe(true)
    const meshes = f.group.children as InstancedMesh[]
    expect(meshes).toHaveLength(3)
    for (const m of meshes) expect(m).toBeInstanceOf(InstancedMesh)
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(343)
    // Where each floats: its cell's middle in the field's frame.
    const m = f.kinds.get(1)!.mesh
    const e = m.instanceMatrix.array
    expect([e[12], e[13], e[14]]).toEqual([0.5, 0.5, 0.5])
    f.dispose()
  })

  it('written again only when the drops or the field change; a frame moves only the time, and allocates nothing', async () => {
    const f = new DropField()
    const drops = full()
    f.update(field, drops, 1)
    const arrays = [...f.kinds.values()].map((k) => [k.mesh.instanceMatrix.array, k.drop.array])
    expect(f.update(field, drops, 1)).toBe(false)
    expect(f.writes).toBe(1)
    const frame = (): void => { f.update(field, drops, 1); f.tick(Date.now()) }
    // Warmed up first: what is measured is running code and not its compile.
    await allocatedKb(() => { for (let i = 0; i < 5000; i++) frame() })
    const kb = await allocatedKb(() => { for (let i = 0; i < 5000; i++) frame() })
    // A couple of boxed numbers a frame at most (the clock read and the time set, as every shader clock here does),
    // against kilobytes if anything were made per drop.
    expect((kb * 1024) / 5000).toBeLessThan(64)
    expect(f.writes).toBe(1)
    // Fewer drops (one collected) keeps the same arrays: only the counts and the values change.
    expect(f.update(field, drops.slice(1), 2)).toBe(true)
    expect([...f.kinds.values()].map((k) => [k.mesh.instanceMatrix.array, k.drop.array])).toEqual(arrays)
    expect([...f.kinds.values()].reduce((n, k) => n + k.mesh.count, 0)).toBe(342)
    // The field moving its origin writes them again, where they now are.
    const moved = { world: { origin: { x: 999n, y: 2000n, z: 3000n } }, plane: 0 }
    expect(f.update(moved, drops, 2)).toBe(true)
    expect(f.kinds.get(1)!.mesh.instanceMatrix.array[12]).toBe(1.5)
    f.dispose()
  })

  it('drops on the other plane are not drawn here', () => {
    const f = new DropField()
    f.update(field, [makeDrop(1000n, 2000n, 3000n, 1, 5, Date.now())], 1)
    expect([...f.kinds.values()].reduce((n, k) => n + k.mesh.count, 0)).toBe(0)
    f.dispose()
  })
})
