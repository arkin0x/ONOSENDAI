/**
 * discoveryWalkAsks.test.ts: walking asks the relays about the cubes it has
 * entered, not again about all thirteen at every step (arkinox, 2026-11-21:
 * WALK stutters on his phone; his capture shows 200 questions and 5 to 7 MB
 * from the relays in every 5 s while the scene around him stood still).
 *
 * A scan runs at every crossing of the smallest cube, which in WALK is every
 * landed step. The twelve larger cubes have not changed, so their bags come
 * back the same each time. Here a walk of 20 one-gibson steps asks about each
 * large cube once, about the small ones as they are entered, and a cube you
 * stay in is asked again once ANSWER_FRESH_MS has passed.
 *
 * The hook runs under the same small stand-in for React as discoveryTv.test.ts;
 * the region worker and the relay are stand-ins. No network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Effect { deps?: unknown[]; cleanup?: () => void }
const effects: Effect[] = []
const refs: Array<{ current: unknown }> = []
let pending: Array<() => void> = []
let ei = 0
let ri = 0
vi.mock('react', () => ({
  useRef: (v: unknown) => { refs[ri] ??= { current: v }; return refs[ri++] },
  useState: (v: unknown) => [v, () => {}],
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { prev?.cleanup?.(); effects[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const cs = { anchor: { x: 1n << 30n, y: 5n, z: 7n }, anchorPlane: 0, atHead: () => false, headPlane: 0 }
vi.mock('../../store/useCyberspace', () => ({
  MAX_COMPUTE_HEIGHT: 20,
  useCyberspace: Object.assign((sel: (s: typeof cs) => unknown) => sel(cs), { getState: () => cs }),
}))
vi.mock('../../store/useTv', () => ({ useTv: Object.assign((sel: (s: { on: boolean }) => unknown) => sel({ on: false }), { getState: () => ({ on: false }) }) }))
const scanning: boolean[] = []
vi.mock('../../store/useShards', () => ({
  SCAN_MAX_HEIGHT: 12,
  useShards: { getState: () => ({ setScanning: (on: boolean) => { scanning.push(on) }, freshOf: () => [], ownDoorAddresses: () => [], dropStale: () => {}, honorRetractions: () => {}, addDiscovered: () => {} }) },
}))
vi.mock('../../store/useSecrets', () => ({ useSecrets: { getState: () => ({ setCurrent: () => {}, recordPlace: async () => {}, hold: () => {} }) } }))
vi.mock('../../store/useCeremony', () => ({ useCeremony: { getState: () => ({ mark: () => {} }) } }))
/** Every `#d` list the scan sent the relays. */
const asked: string[][] = []
/** Whether the canonical relay answers: when it does not, nothing counts as answered. */
const relay = { canonicalAnswers: true }
vi.mock('../../lib/relay', () => ({
  query: async () => [],
  queryEach: async (f: { '#d'?: string[] }) => { if (f['#d']) asked.push([...f['#d']]); return [{ url: 'wss://relay.test', outcome: relay.canonicalAnswers ? 'answered' : 'unreachable', reason: '', events: [] }] },
  troubleOf: () => (relay.canonicalAnswers ? null : 'unreachable'),
  relaySet: () => ['wss://relay.test'],
}))

/** A region worker: one key per height, its lookup id naming the cube (height and aligned base), then done. */
type Listener = (e: MessageEvent) => void
class FakeWorker {
  private listeners = new Set<Listener>()
  addEventListener(_: string, fn: Listener): void { this.listeners.add(fn) }
  removeEventListener(_: string, fn: Listener): void { this.listeners.delete(fn) }
  postMessage(m: { id: number; x: string; y: string; z: string; heights: number[] }): void {
    const emit = (data: unknown): void => { for (const fn of [...this.listeners]) fn({ data } as MessageEvent) }
    queueMicrotask(() => {
      for (const h of m.heights) {
        const b = (v: string): string => String((BigInt(v) >> BigInt(h)) << BigInt(h))
        emit({ id: m.id, type: 'key', key: { lookupId: `${h}:${b(m.x)},${b(m.y)},${b(m.z)}`, keyHex: '00'.repeat(32), height: h } })
      }
      emit({ id: m.id, type: 'done' })
    })
  }
  terminate(): void {}
}
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const { useDiscovery, ANSWER_FRESH_MS, regionsToAsk } = await import('../useDiscovery')

function render(): void {
  ei = 0
  ri = 0
  pending = []
  useDiscovery()
  for (const run of pending) run()
}

/** One step, and the scan it starts, to its end. */
async function step(dx: bigint): Promise<void> {
  cs.anchor = { ...cs.anchor, x: cs.anchor.x + dx }
  const before = scanning.length
  render()
  await vi.waitFor(() => { expect(scanning.length).toBeGreaterThan(before); expect(scanning.at(-1)).toBe(false) })
}

beforeEach(() => {
  relay.canonicalAnswers = true
  effects.length = 0
  refs.length = 0
  asked.length = 0
  scanning.length = 0
  cs.anchor = { x: 1n << 30n, y: 5n, z: 7n }
})

describe('the scan while walking', () => {
  it('asks about each cube once as it is entered, not about all thirteen at every step', async () => {
    render()
    await vi.waitFor(() => { expect(asked).toHaveLength(1) })
    expect(asked[0]).toHaveLength(13)
    for (let i = 0; i < 20; i++) await step(1n)
    const all = asked.flat()
    // Before: 13 at every step, 273 in all. Now each cube once.
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBeLessThan(13 + 20 * 3)
    // The large cubes (height 6 and up) never change on this walk: asked once.
    expect(all.filter((id) => Number(id.split(':')[0]) >= 6)).toHaveLength(7)
  })

  it('walking to and fro across a cube\'s side asks about each cube once, not at every crossing (owner\'s phone diag, 2026-11-22)', async () => {
    render()
    await vi.waitFor(() => { expect(asked).toHaveLength(1) })
    for (let i = 0; i < 6; i++) await step(i % 2 === 0 ? 1n : -1n)
    const all = asked.flat()
    expect(new Set(all).size).toBe(all.length)
  })

  it('a cube left and entered again after ANSWER_FRESH_MS is asked again', async () => {
    const now = vi.spyOn(Date, 'now')
    let t = 2_000_000
    now.mockImplementation(() => t)
    try {
      render()
      await vi.waitFor(() => { expect(asked).toHaveLength(1) })
      await step(1n)
      const n0 = asked.flat().length
      t += ANSWER_FRESH_MS
      await step(-1n)
      expect(asked.flat().length).toBeGreaterThan(n0)
    } finally {
      now.mockRestore()
    }
  })

  it('asks again about a cube you stay in once ANSWER_FRESH_MS has passed', async () => {
    const now = vi.spyOn(Date, 'now')
    let t = 1_000_000
    now.mockImplementation(() => t)
    try {
      render()
      await vi.waitFor(() => { expect(asked).toHaveLength(1) })
      await step(1n)
      const high = (ids: string[]): string[] => ids.filter((id) => id.startsWith('12:'))
      expect(high(asked.flat())).toHaveLength(1)
      t += ANSWER_FRESH_MS
      await step(1n)
      expect(high(asked.flat())).toHaveLength(2)
    } finally {
      now.mockRestore()
    }
  })

  it('a scan the canonical relay did not answer (down, slow, waiting on the signer) counts for nothing: the next step asks again', async () => {
    relay.canonicalAnswers = false
    render()
    await vi.waitFor(() => { expect(asked).toHaveLength(1) })
    await step(1n)
    expect(asked[1]).toHaveLength(13)
    relay.canonicalAnswers = true
    await step(1n)
    expect(asked[2]).toHaveLength(13)
    await step(1n)
    expect(asked[3].length).toBeLessThan(13)
  })

  it('regionsToAsk: what has no answer, or one older than ANSWER_FRESH_MS', () => {
    const answered = new Map([['a', 1000], ['b', 1000 - ANSWER_FRESH_MS]])
    expect(regionsToAsk(['a', 'b', 'c'], answered, 1000)).toEqual(['b', 'c'])
  })
})
