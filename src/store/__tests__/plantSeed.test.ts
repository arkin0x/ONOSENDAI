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
/** Events the mock relay holds for reads by id. */
const published: Array<{ id: string; kind: number; tags: string[][]; content: string; pubkey: string; created_at: number; sig: string }> = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => {
    sent.push(ev)
    return { ok: true, accepted: ['wss://relay.test'] }
  }),
  // NTH's newest anchor for the trusted tip; nothing else is on the relay.
  // NTH's newest anchor for the trusted tip, and the owner's published original DNA by id; nothing else.
  query: vi.fn(async (f: { kinds?: number[]; authors?: string[]; '#B'?: string[]; ids?: string[] }) => (f.kinds?.includes(321) && f.authors && !f['#B'] ? [JSON.parse(JSON.stringify(anchor975256))] : f.ids ? published.filter((e) => f.ids!.includes(e.id)).map((e) => JSON.parse(JSON.stringify(e))) : [])),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  queryAny: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  relaySet: () => ['wss://relay.test'],
}))

import { workOk } from 'sno-core/seeds'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useToast } from '../useToast'
import { forgetKeptDnas, setSeedMiner } from '../plantSeed'
import { mineChunk } from '../../lib/avatarMine'
import { MineCancelled, type AvatarMiner } from '../../lib/avatarWorker'
import { seedItemOf } from '../../lib/seeds/seedItem'
import { dnaResolver } from '../../lib/seeds/seedSources'
import { ORIGINAL_DNAS } from '../../lib/seeds/originalDnas'
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
const draft = { text: ORIGINAL_DNAS[5].text, caps: BASE_CAPS, scale: 0, title: '' }

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  forgetKeptDnas()
  setSeedMiner(inline)
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null, deployMining: false })
  useCyberspace.setState({ live: false })
  useToast.getState().dismiss()
})

describe('how a planted bloom stands (DECK-0008 §5.7)', () => {
  it('TURN, SNAP TO EARTH and FINE ROTATION go out as the seed\'s tags, in the payload\'s frame; up only in dataspace', async () => {
    useCyberspace.setState({ plane: 0, anchorPlane: 0, focus: null })
    useShards.getState().startDeploySeed(draft)
    useShards.setState({ deployTurn: [1, 0, 2], deployUp: true, deploySpin: 45 })
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    const first = useShards.getState().mine.find((d) => d.type === 'seed')!
    // The bar turns in this client's model frame (Z negated): a quarter about X runs the other way in the tag, about Z the same.
    expect(first.inner.tags.filter((t) => ['turn', 'up', 'spin'].includes(t[0]))).toEqual([['turn', '3', '0', '2'], ['up'], ['spin', '45']])
    expect(seedItemOf(first.inner)!.stand).toEqual({ turn: [3, 0, 2], up: true, spin: 45 })
    expect(workOk(first.inner, 16)).toBe(true)
    // In ideaspace there is no Earth: the turn goes out, up and spin do not.
    useCyberspace.setState({ plane: 1, anchorPlane: 1, cursor: { ...useCyberspace.getState().cursor, x: useCyberspace.getState().cursor.x + 7000n } })
    useShards.getState().startDeploySeed(draft)
    useShards.setState({ deployTurn: [0, 1, 0], deployUp: true, deploySpin: 45 })
    await useShards.getState().deploy()
    const second = useShards.getState().mine.filter((d) => d.type === 'seed').at(-1)!
    expect(seedItemOf(second.inner)!.stand).toEqual({ turn: [0, 3, 0], up: false, spin: 0 })
  })
})

describe('an original DNA the owner has published', () => {
  it('every seed of it names that event, and no DNA is signed or sent', async () => {
    const owner = finalizeEvent({ kind: 3350, created_at: 1794000000, tags: [['alt', 'Seeds DNA: crystal']], content: draft.text }, generateSecretKey())
    published.push(owner)
    useCyberspace.setState({ live: true })
    useShards.getState().startDeploySeed({ ...draft, dnaId: owner.id })
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    const seed = seedItemOf(useShards.getState().mine.find((d) => d.type === 'seed')!.inner)!
    expect(seed.dnaId).toBe(owner.id)
    expect(sent.some((e) => e.kind === 3350)).toBe(false)
  })

  it('one whose text is not what SEED showed is refused, in words, and nothing is planted', async () => {
    const other = finalizeEvent({ kind: 3350, created_at: 1794000000, tags: [], content: ORIGINAL_DNAS[0].text }, generateSecretKey())
    published.push(other)
    useShards.getState().startDeploySeed({ ...draft, dnaId: other.id })
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toMatch(/original DNA/)
    expect(useShards.getState().mine.some((d) => d.type === 'seed')).toBe(false)
  })
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
