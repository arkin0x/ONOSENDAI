/**
 * plantSeed.test.ts: SEED through the deploy (DECK-0008 §8.2). The seed is
 * written into the bag at the build cursor by the same bag writer as every
 * item, planted at the trusted clock block (NTH's newest anchor minus 6), its
 * work mined at its DNA's price; LOCAL keeps the DNA and the bag here, LIVE
 * sends the DNA before the bag (free), and CANCEL stops the mining with
 * nothing signed or placed. The relays are mocks; the miner runs inline.
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import anchor975256 from '../../lib/__tests__/vectors/nth-anchor-975256.json'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const sent: { kind: number; tags: string[][]; id: string; content: string }[] = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => {
    sent.push(ev)
    return { ok: true, accepted: ['wss://relay.test'] }
  }),
  // NTH's newest anchor for the trusted tip; nothing else is on the relay.
  query: vi.fn(async (f: { kinds?: number[]; authors?: string[]; '#B'?: string[] }) => (f.kinds?.includes(321) && f.authors && !f['#B'] ? [JSON.parse(JSON.stringify(anchor975256))] : [])),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  queryAny: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  relaySet: () => ['wss://relay.test'],
}))

import { workOk } from 'sno-core/seeds'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useToast } from '../useToast'
import { forgetKeptDnas, setSeedMiner } from '../plantSeed'
import { mineChunk } from '../../lib/avatarMine'
import { MineCancelled, type AvatarMiner } from '../../lib/avatarWorker'
import { seedItemOf } from '../../lib/seeds/seedItem'
import { dnaResolver } from '../../lib/seeds/seedSources'
import { STARTER_DNAS } from '../../lib/seeds/starterDnas'
import { BASE_CAPS } from 'sno-core/seeds'
import { deployPoint } from '../../lib/space'
import { positionHex } from '../../lib/events'

/** The NIP-13 loop, inline. */
const inline: AvatarMiner = (template, target, onProgress) => {
  let found = null
  let tries = 0
  while (!found) { found = mineChunk(template, target, tries, 20_000); tries += 20_000; onProgress({ tries, elapsedMs: 1 }) }
  return { done: Promise.resolve({ ...found, tries, elapsedMs: 1 }), cancel: () => {} }
}

/** The crystal at the free caps: 16 bits, quick to mine in a test. */
const draft = { text: STARTER_DNAS[5].text, caps: BASE_CAPS, scale: 0, title: '' }

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  forgetKeptDnas()
  setSeedMiner(inline)
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null, deployMining: false })
  useCyberspace.setState({ live: false })
  useToast.getState().dismiss()
})

describe('planting a seed', () => {
  it('LOCAL: the seed in the bag at the cursor, at the clock block, its work at its price; nothing sent', async () => {
    useShards.getState().startDeploySeed(draft)
    expect(useShards.getState().pending?.type).toBe('seed')
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    const row = useShards.getState().mine.find((d) => d.type === 'seed')
    expect(row).toBeDefined()
    const ev = row!.inner
    expect(ev.kind).toBe(3351)
    const cs = useCyberspace.getState()
    const seed = seedItemOf(ev)!
    expect(seed.coord).toBe(positionHex(deployPoint(cs.cursor, cs.scaleExp, 0), row!.plane))
    expect(seed.planted).toBe(975256 - 6)
    expect(seed.target).toBe(16)
    expect(workOk(ev, 16)).toBe(true)
    expect(ev.tags.some((t) => t[0] === '-')).toBe(true)
    // The DNA it names is known here, and grows it after a reload too.
    expect(dnaResolver.verdict(seed.dnaId)).toMatchObject({ state: 'ok', name: 'crystal' })
    expect(row!.published).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it('LIVE: the DNA goes out before the bag; a second planting of the same DNA names the same one', async () => {
    useCyberspace.setState({ live: true })
    useShards.getState().startDeploySeed(draft)
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    const kinds = sent.map((e) => e.kind)
    expect(kinds[0]).toBe(3350)
    expect(kinds).toContain(33330)
    const dna = sent[0]
    const first = seedItemOf(useShards.getState().mine.find((d) => d.type === 'seed')!.inner)!
    expect(first.dnaId).toBe(dna.id)
    expect(first.dnaRelay).toBe('wss://relay.test')
    // AGAIN: lined up with the same DNA; planted elsewhere, it names the same event.
    expect(useShards.getState().pending?.type).toBe('seed')
    useShards.setState({ pending: { type: 'seed', seed: draft } })
    useCyberspace.setState({ cursor: { ...useCyberspace.getState().cursor, x: useCyberspace.getState().cursor.x + 5000n } })
    await useShards.getState().deploy()
    const seeds = useShards.getState().mine.filter((d) => d.type === 'seed').map((d) => seedItemOf(d.inner)!)
    expect(seeds).toHaveLength(2)
    expect(seeds[1].dnaId).toBe(dna.id)
  })

  it('LOCAL after a reload: the DNA signed before is found in IndexedDB and named again, not signed twice', async () => {
    useShards.getState().startDeploySeed(draft)
    await useShards.getState().deploy()
    const first = seedItemOf(useShards.getState().mine.find((d) => d.type === 'seed')!.inner)!
    // A reload forgets the session's DNAs; IndexedDB keeps them.
    forgetKeptDnas()
    await new Promise((r) => setTimeout(r, 50))
    useShards.setState({ pending: { type: 'seed', seed: draft }, deployStatus: 'idle' })
    useCyberspace.setState({ cursor: { ...useCyberspace.getState().cursor, x: useCyberspace.getState().cursor.x + 9000n } })
    await useShards.getState().deploy()
    const seeds = useShards.getState().mine.filter((d) => d.type === 'seed').map((d) => seedItemOf(d.inner)!)
    expect(seeds).toHaveLength(2)
    expect(seeds[1].dnaId).toBe(first.dnaId)
  })

  it('another deploy lined up while it mines stops the mining, and its bar is left alone', async () => {
    let cancelled = false
    let tick: ReturnType<typeof setInterval> | undefined
    const slow: AvatarMiner = (_t, _target, onProgress) => {
      let rejectIt: (e: Error) => void = () => {}
      const done = new Promise<never>((_, rej) => { rejectIt = rej })
      let tries = 0
      tick = setInterval(() => { tries += 1000; onProgress({ tries, elapsedMs: tries }) }, 5)
      return { done, cancel: () => { cancelled = true; clearInterval(tick); rejectIt(new MineCancelled()) } }
    }
    setSeedMiner(slow)
    useShards.getState().startDeploySeed(draft)
    const going = useShards.getState().deploy()
    await vi.waitFor(() => expect(useShards.getState().deployMining).toBe(true))
    useShards.getState().startDeployMessage('something else')
    await going
    expect(cancelled).toBe(true)
    expect(useShards.getState().pending?.type).toBe('message')
    expect(useShards.getState().deployNote ?? '').not.toMatch(/Mining/)
    expect(useShards.getState().mine.some((d) => d.type === 'seed')).toBe(false)
    clearInterval(tick)
  })

  it('CANCEL while mining: nothing signed, nothing placed, nothing said to have failed', async () => {
    let rejectIt: (e: Error) => void = () => {}
    const hanging: AvatarMiner = () => ({ done: new Promise((_, rej) => { rejectIt = rej }), cancel: () => rejectIt(new MineCancelled()) })
    setSeedMiner(hanging)
    useShards.getState().startDeploySeed(draft)
    const going = useShards.getState().deploy()
    await vi.waitFor(() => expect(useShards.getState().deployMining).toBe(true))
    expect(useShards.getState().deployNote).toBe('Mining the seed')
    useShards.getState().cancelDeploy(true)
    await going
    expect(useShards.getState()).toMatchObject({ pending: null, deployStatus: 'idle', deployMining: false, deployError: null })
    expect(useShards.getState().mine.some((d) => d.type === 'seed')).toBe(false)
    expect(useToast.getState().toast).toBeNull()
  })
})
