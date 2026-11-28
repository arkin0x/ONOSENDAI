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
import { DropField, secondsOf } from '../quarryDrops'
import type { Flight } from '../../store/quarryHoming'
import { COUNTDOWN, DIGIT_SIZE, DIGIT_SIZE_FINAL, digitSize } from '../QuarryFx'
import { BLAST_HALF, BLAST_SIDE, DROP_FADE_MS, DROP_LIFE_MS, FUSE_BEEPS, FUSE_FINAL_MS, FUSE_MS, HOME_ACCEL, HOME_MAX_SPEED, HOME_REDUCED_MS, beepTimes, blastCells, blinkLit, bodyAt, dropLevel, makeDrop, secondsLeft, stepCells, tidyDrops, type Drop } from '../../lib/terrain/quarry'

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

  it('the fuse is 10 seconds: a beep a second with the countdown, then faster and faster through the last 3; the lamp lights on each beep', () => {
    expect(FUSE_MS).toBe(10_000)
    expect(FUSE_FINAL_MS).toBe(3000)
    const t = beepTimes(FUSE_MS)
    expect(t[0]).toBe(0)
    expect(t[t.length - 1]).toBeLessThan(FUSE_MS)
    expect(FUSE_BEEPS).toEqual(t)
    // Calm: on every whole second until the last 3, so the lamp and the countdown keep time and no second passes unmarked.
    expect(t.filter((v) => v < FUSE_MS - FUSE_FINAL_MS)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000])
    // The last 3 seconds: quicker and quicker, every gap shorter than a calm second, none longer than the one before.
    const last = t.filter((v) => v >= FUSE_MS - FUSE_FINAL_MS)
    expect(last[0]).toBe(FUSE_MS - FUSE_FINAL_MS)
    const gaps = last.slice(1).map((v, i) => v - last[i])
    expect(gaps[0]).toBeLessThan(1000)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1])
    expect(gaps[0]).toBeGreaterThan(3 * gaps[gaps.length - 1])
    // No gap anywhere longer than a second.
    const all = [...t, FUSE_MS].slice(1).map((v, i) => v - t[i])
    expect(Math.max(...all)).toBeLessThanOrEqual(1000)
    expect(blinkLit(10)).toBe(true)
    expect(blinkLit(500)).toBe(false)
    expect(blinkLit(1010)).toBe(true)
    expect(blinkLit(-1)).toBe(false)
    // A short fuse is all quickening, as before.
    const short = beepTimes(3000)
    expect(short[0]).toBe(0)
    expect(short[1] - short[0]).toBeLessThan(1000)
  })

  it('the countdown shows every second of the fuse, 10 down to 1, larger through the last 3', () => {
    expect([0, 1, 999, 1000, 1001, 6999, 7000, 7001, 8001, 9001, 9999, 10_000].map((ms) => secondsLeft(ms))).toEqual([10, 10, 10, 9, 9, 4, 3, 3, 2, 1, 1, 0])
    expect(COUNTDOWN).toBe(10)
    expect(digitSize(0)).toBe(DIGIT_SIZE)
    expect(digitSize(6999)).toBe(DIGIT_SIZE)
    expect(digitSize(7000)).toBe(DIGIT_SIZE_FINAL)
    expect(DIGIT_SIZE_FINAL).toBeGreaterThan(DIGIT_SIZE)
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

  it('a drop flying is written into its instance once, when it sets off: when, how far, its lean; a frame moves only the time and the body', async () => {
    const f = new DropField()
    const drops = full()
    f.update(field, drops, 1)
    const k = f.kinds.get(1)!
    // None flying: every instance says so.
    expect(k.home.array[0]).toBe(-1)
    const now = Date.now()
    const flights = new Map<Drop, Flight>([[drops[0], { start: now + 100, arrive: now + 700, len: 5.5, side: -0.4, reduced: false }]])
    expect(f.update(field, drops, 1, flights, 0)).toBe(false)
    expect(f.update(field, drops, 1, flights, 1)).toBe(true)
    expect(k.home.array[0]).toBeCloseTo(secondsOf(now + 100), 2)
    expect(k.home.array[1]).toBeCloseTo(5.5)
    expect(k.home.array[2]).toBeCloseTo(-0.4)
    expect(k.home.array[3]).toBe(0)
    expect(k.home.array[4]).toBe(-1)
    // The shader works the flight from the same numbers as lib/terrain/quarry.ts.
    const u = k.material.uniforms
    expect(u.uAccel.value).toBe(HOME_ACCEL)
    expect(u.uVmax.value).toBe(HOME_MAX_SPEED)
    expect(u.uReduced.value).toBeCloseTo(HOME_REDUCED_MS / 1000)
    expect(u.uBody).toBe(f.body)
    const body = { x: 3, y: 4.5, z: -2 }
    const frame = (): void => { f.update(field, drops, 1, flights, 1); f.tick(Date.now(), body) }
    await allocatedKb(() => { for (let i = 0; i < 5000; i++) frame() })
    const kb = await allocatedKb(() => { for (let i = 0; i < 5000; i++) frame() })
    expect((kb * 1024) / 5000).toBeLessThan(64)
    expect([f.body.value.x, f.body.value.y, f.body.value.z]).toEqual([3, 4.5, -2])
    expect(f.writes).toBe(2)
    f.dispose()
  })

  it('drops on the other plane are not drawn here', () => {
    const f = new DropField()
    f.update(field, [makeDrop(1000n, 2000n, 3000n, 1, 5, Date.now())], 1)
    expect([...f.kinds.values()].reduce((n, k) => n + k.mesh.count, 0)).toBe(0)
    f.dispose()
  })
})
