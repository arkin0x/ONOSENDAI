/**
 * seedsGrow.test.ts: blooms grown as the seeds worker grows them (DECK-0008
 * §4, §5). The worker's job, run inline, draws exactly the bloom sno-core's
 * growBloom draws (its payload hash is the vectors'); a bloom grown a slice
 * at a time is the bloom grown at once; a missing block leaves it behind; and
 * the engine takes a seed from its DNA to a drawn shard, skipping a seed
 * short of its DNA's price, holding a seed too heavy for the budget at its
 * axiom until GROW ANYWAY, and saying when its DNA is mixed or missing. No
 * worker (node has none: growClient runs the job inline) and no network.
 */

import { describe, expect, it, vi } from 'vitest'
import { fromPayload } from 'sno-core/shards'
import { growBloom, parseDna, sha256Hex, worstCaseSteps, type Caps } from 'sno-core/seeds'
import { GrowCache, handleGrow, type GrowRequest } from '../seeds/growJob'
import { bloomShard } from '../seeds/bloomShard'
import { BloomEngine, type BloomView } from '../seeds/bloomEngine'
import { DnaResolver } from '../seeds/dnaStore'
import { HeaderBook } from '../seeds/headerBook'
import { growInWorker, resetInlineGrowth } from '../seeds/growClient'
import { PHONE_BUDGET, DESKTOP_BUDGET, SLICE_STEPS, tooHeavy } from '../seeds/bloomBudget'
import { seedItemOf } from '../seeds/seedItem'
import { bloomGrowthWords, bloomStateLine } from '../seeds/bloomWords'
import type { NostrEvent } from '../events'
import { clampTimes, crystalDna, dnaOf, mineSeedEvent, vectorBlocks, vectors } from './seedsFixture'

const blocks = vectorBlocks()
const day30 = vectors.growth.cases.find((c: { what: string; dna: string }) => c.dna === 'fiddlehead' && c.what.startsWith('day 30'))

/** The model sno-core's own payload reads as, its time stamp aside. */
function modelOfPayload(sno: unknown, id: string): unknown {
  return { ...fromPayload(sno, id)!, updatedAt: 0 }
}

function request(c: typeof day30, over: Partial<GrowRequest> = {}): GrowRequest {
  const hashes: Record<number, string> = {}
  for (const h of c.weather_blocks as number[]) hashes[h] = blocks.get(h)!
  return { type: 'grow', id: 1, key: `seed:${c.what}:${c.dna}`, dna: vectors.growth.dnas[c.dna], seed: { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }, clock: c.clock, hashes, maxSteps: 1 << 30, ...over }
}

describe('the worker\'s growth equals the engine\'s', () => {
  it('the fiddlehead at day 30: the vectors\' payload hash, and the same shard from the buffers as from the payload', () => {
    const c = day30
    const bloom = growBloom(parseDna(vectors.growth.dnas[c.dna]), { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }, c.clock, (h) => blocks.get(h))
    expect(bloom.sha256).toBe(c.sno_sha256)
    const { answer, transfer } = handleGrow(request(c), new GrowCache())
    expect(answer.type).toBe('bloom')
    if (answer.type !== 'bloom') return
    expect(transfer.length).toBe(3)
    expect(answer.growth.generation).toBe(c.generation)
    expect(answer.buffers.colors.length).toBe(c.vertices)
    expect(bloomShard(answer.buffers, c.dna, c.scale, 'x')).toEqual(modelOfPayload(bloom.sno, 'x'))
  })

  it('every growth vector at scale 0 and 4: the same shard either way', () => {
    for (const c of vectors.growth.cases.filter((x: { dna: string }) => x.dna !== 'turtle').slice(0, 30)) {
      const bloom = growBloom(parseDna(vectors.growth.dnas[c.dna]), { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }, c.clock, (h) => blocks.get(h))
      expect(bloom.sha256, c.what).toBe(c.sno_sha256)
      const { answer } = handleGrow(request(c), new GrowCache())
      if (answer.type !== 'bloom') throw new Error(`${c.what}: ${answer.type}`)
      expect(bloomShard(answer.buffers, bloom.sno.name, c.scale, 'x'), c.what).toEqual(modelOfPayload(bloom.sno, 'x'))
    }
  })

  it('grown a slice at a time, it comes back partial until done, and then is the same bloom', () => {
    const cache = new GrowCache()
    const req = request(day30, { maxSteps: 2000 })
    let partials = 0
    let answer = handleGrow(req, cache).answer
    while (answer.type === 'partial') { partials++; answer = handleGrow(req, cache).answer }
    expect(partials).toBeGreaterThan(3)
    if (answer.type !== 'bloom') throw new Error(answer.type)
    const whole = handleGrow(request(day30, { key: 'whole' }), new GrowCache()).answer
    if (whole.type !== 'bloom') throw new Error(whole.type)
    expect(bloomShard(answer.buffers, 'f', 0, 'x')).toEqual(bloomShard(whole.buffers, 'f', 0, 'x'))
  })

  it('a driving block the page lacks: drawn behind, at the generation it reached', () => {
    const req = request(day30)
    const missing = (day30.weather_blocks as number[])[9]
    delete req.hashes[missing]
    const { answer } = handleGrow(req, new GrowCache())
    if (answer.type !== 'bloom') throw new Error(answer.type)
    expect(answer.growth).toMatchObject({ behind: true, missingBlock: missing, generation: 9 })
  })

  it('an invalid DNA is an error, not a throw', () => {
    const { answer } = handleGrow(request(day30, { dna: 'dna x\naxiom F(' }), new GrowCache())
    expect(answer.type).toBe('error')
  })
})

describe('the budget', () => {
  it('the original DNAs\' caps grow on a phone; the largest caps wait there, and grow on a larger screen', () => {
    const original: Caps = { vertices: 8000, symbols: 6000, generations: 40 }
    const largest: Caps = { vertices: 65536, symbols: 16384, generations: 256 }
    expect(worstCaseSteps(original)).toBe(240_000)
    expect(tooHeavy(original, PHONE_BUDGET)).toBe(false)
    expect(tooHeavy(largest, PHONE_BUDGET)).toBe(true)
    expect(tooHeavy(largest, DESKTOP_BUDGET)).toBe(false)
    expect(SLICE_STEPS).toBeLessThan(PHONE_BUDGET)
  })
})

describe('the engine, from a seed to a drawn bloom', () => {
  // The vectors' honest planting: planted 970,524, settled from clock 970,546.
  const honest = vectors.clamp.cases[0]
  const at = { x: 77_000n, y: 1_200n, z: 33n }
  const synthetic = (h: number): string => sha256Hex(new TextEncoder().encode(`block ${h}`))
  /** The vectors' header times, then one every ten minutes past them. */
  const times = clampTimes()
  for (let h = 970620; h <= 971200; h++) times.set(h, 1791544000 + (h - 970620) * 600)

  function engineFor(dnaEvents: NostrEvent[], o: { tip?: number | null; budget?: number; grow?: typeof growInWorker } = {}) {
    resetInlineGrowth()
    const fetched: number[] = []
    const fetch = vi.fn(async (ids: string[]) => dnaEvents.filter((e) => ids.includes(e.id)))
    const dna = new DnaResolver({ fetch, load: async () => undefined, save: async () => {} })
    const book = new HeaderBook()
    const views = new Map<string, BloomView>()
    const grow = vi.fn(growInWorker)
    const engine = new BloomEngine({
      dna,
      book,
      // Verified headers only: times, and the hashes that drive the weather, come through here.
      fetchHeaders: async (heights) => {
        fetched.push(...heights)
        for (const h of heights) { const t = times.get(h); if (t !== undefined) book.add({ height: h, hash: synthetic(h), time: t }) }
        book.markAbsent(heights)
      },
      tip: () => (o.tip === undefined ? 970524 + 3 * 144 : o.tip),
      grow: o.grow ?? grow,
      budget: o.budget ?? DESKTOP_BUDGET,
      onView: (id, v) => views.set(id, v),
    })
    return { engine, views, fetch, grow, fetched }
  }

  async function settle(engine: BloomEngine, id: string): Promise<void> {
    await engine.refresh(id)
  }

  const crystal = crystalDna()
  const seedEvent = mineSeedEvent({ dnaId: crystal.id, planted: honest.stated, at, plane: 0, createdAt: honest.created_at })
  const seed = seedItemOf(seedEvent)!

  it('grows the bloom sno-core grows, at day 3, its weather fetched as verified headers', async () => {
    const { engine, views, fetched } = engineFor([crystal])
    engine.want([seed])
    await settle(engine, seed.id)
    const v = views.get(seed.id)!
    expect(v.status).toBe('grown')
    expect(v.planted).toBe(970524)
    expect(v.dna?.name).toBe('crystal')
    expect(v.growth?.generation).toBe(3)
    expect(bloomStateLine(v)).toBeNull()
    // DISCOVERED NEARBY's row: the free caps' 32 days, fully grown on day 33 (plant.ts previewLastDay).
    expect(v.dna?.generations).toBe(32)
    expect(bloomGrowthWords(v)).toBe('day 3 of 33')
    const bloom = growBloom(parseDna(crystal.content), { coord: seed.coord, planted: 970524, scale: 0 }, v.clock!, synthetic)
    expect({ ...v.shard!, id: 'x' }).toEqual(modelOfPayload(bloom.sno, 'x'))
    for (const k of [1, 2, 3]) expect(fetched).toContain(970524 + k * 144)
  })

  it('its clock is the trusted tip, NTH\'s newest anchor, never 6 below it; no generation reads a block above the clock', async () => {
    // The trusted tip puts the third driving block, 970,524 + 3 x 144, exactly at the clock.
    const tip = 970524 + 3 * 144
    const { engine, views, fetched, grow } = engineFor([crystal], { tip })
    engine.want([seed])
    await settle(engine, seed.id)
    const v = views.get(seed.id)!
    expect(v.clock).toBe(tip)
    expect(v.growth?.generation).toBe(3)
    // The clock block's own hash drives generation 3, and is fetched like any other.
    expect(fetched).toContain(tip)
    expect(Math.max(...fetched)).toBeLessThanOrEqual(tip)
    for (const [req] of grow.mock.calls) {
      expect(req.clock).toBe(tip)
      for (const h of Object.keys(req.hashes)) expect(Number(h)).toBeLessThanOrEqual(tip)
    }
    // One block less and the third day has not come: its driving block is above the clock, and is not read.
    const before = engineFor([crystal], { tip: tip - 1 })
    before.engine.want([seed])
    await settle(before.engine, seed.id)
    expect(before.views.get(seed.id)).toMatchObject({ clock: tip - 1, growth: { generation: 2 } })
    expect(before.fetched).not.toContain(tip)
    for (const [req] of before.grow.mock.calls) expect(Object.keys(req.hashes).map(Number)).not.toContain(tip)
  })

  it('a slice that made no progress is followed by one that grows it whole; a forgotten seed stops', async () => {
    const asks: number[] = []
    const stuck = vi.fn(async (req: Parameters<typeof growInWorker>[0]) => {
      asks.push(req.maxSteps)
      // The worker forgot it between slices: generation 1 every time, until asked for all of it.
      if (req.maxSteps < Number.MAX_SAFE_INTEGER) return { type: 'partial' as const, id: 0, key: req.key, generation: 1, targetGeneration: 3 }
      return growInWorker(req)
    })
    const { engine, views } = engineFor([crystal], { grow: stuck })
    engine.want([seed])
    await settle(engine, seed.id)
    expect(views.get(seed.id)?.status).toBe('grown')
    expect(asks.slice(-1)[0]).toBe(Number.MAX_SAFE_INTEGER)
    expect(asks.length).toBe(3)

    let calls = 0
    const forever = vi.fn(async (req: Parameters<typeof growInWorker>[0]) => {
      calls++
      if (calls === 2) other.engine.forget([seed.id])
      return { type: 'partial' as const, id: 0, key: req.key, generation: calls, targetGeneration: 99 }
    })
    const other = engineFor([crystal], { grow: forever })
    other.engine.want([seed])
    await settle(other.engine, seed.id)
    expect(calls).toBe(2)
  })

  it('the same block again: nothing is grown twice', async () => {
    const { engine, grow } = engineFor([crystal])
    engine.want([seed])
    await settle(engine, seed.id)
    const calls = grow.mock.calls.length
    await engine.refresh(seed.id)
    expect(grow.mock.calls.length).toBe(calls)
  })

  it('too heavy for the budget: drawn as its axiom, until GROW ANYWAY', async () => {
    const { engine, views } = engineFor([crystal], { budget: 1000 })
    engine.want([seed])
    await settle(engine, seed.id)
    expect(views.get(seed.id)).toMatchObject({ status: 'heavy', growth: { generation: 0 } })
    expect(bloomStateLine(views.get(seed.id))).toBe('Too heavy to grow here.')
    // Drawn as its axiom, so its row says why, not its age.
    expect(bloomGrowthWords(views.get(seed.id))).toBe('Too heavy to grow here')
    engine.growAnyway(seed.id)
    await settle(engine, seed.id)
    expect(views.get(seed.id)).toMatchObject({ status: 'grown', growth: { generation: 3 } })
  })

  it('a seed short of its DNA\'s price is never grown', async () => {
    const dear = dnaOf(crystal.content, [['caps', '4096', '2048', '32']])
    const cheap = seedItemOf(mineSeedEvent({ dnaId: dear.id, planted: honest.stated, at, plane: 0, createdAt: honest.created_at }))!
    const { engine, views, grow } = engineFor([dear])
    engine.want([cheap])
    await settle(engine, cheap.id)
    expect(views.get(cheap.id)?.status).toBe('underpaid')
    expect(grow).not.toHaveBeenCalled()
  })

  it('a mixed DNA is coming soon; a missing one says so; no tip is waiting for blocks', async () => {
    const mixed = dnaOf('', [['e', 'aa'.repeat(32), '', 'mother']])
    const s1 = seedItemOf(mineSeedEvent({ dnaId: mixed.id, planted: honest.stated, at, plane: 0, createdAt: honest.created_at }))!
    const s2 = seedItemOf(mineSeedEvent({ dnaId: 'bb'.repeat(32), planted: honest.stated, at, plane: 0, createdAt: honest.created_at }))!
    const { engine, views, grow } = engineFor([mixed])
    engine.want([s1, s2])
    await settle(engine, s1.id)
    await settle(engine, s2.id)
    expect(views.get(s1.id)?.status).toBe('mixed')
    expect(bloomStateLine(views.get(s1.id))).toBe('Mixed DNA, coming soon.')
    expect(views.get(s2.id)?.status).toBe('dna-missing')
    // Looked at again while still missing: the same view, not a new one for the store.
    const was = views.get(s2.id)
    await engine.refresh(s2.id)
    expect(views.get(s2.id)).toBe(was)
    expect(grow).not.toHaveBeenCalled()
    const none = engineFor([crystal], { tip: null })
    none.engine.want([seed])
    await settle(none.engine, seed.id)
    expect(bloomStateLine(none.views.get(seed.id))).toBe('Waiting for blocks.')
  }, 60_000) // two seeds mined at 16 bits

  it('before its planted height settles, it is drawn as its axiom, pending', async () => {
    const { engine, views } = engineFor([crystal], { tip: honest.not_settled_at_clock })
    engine.want([seed])
    await settle(engine, seed.id)
    expect(views.get(seed.id)).toMatchObject({ status: 'pending', growth: { generation: 0 } })
    expect(views.get(seed.id)?.shard?.vertices.length).toBeGreaterThan(0)
  })
})
