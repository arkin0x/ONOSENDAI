/**
 * noBroadcastTv.test.ts - Cyberspace TV never broadcasts an event tagged
 * no-broadcast (spec §8.13; owner, 2026-11-14: TV "will simply not broadcast
 * any event carrying that tag"): not on the tape, not in a bag, object,
 * avatar, comment or reaction segment, not in its scan, not in any number.
 * The tag never changes a chain: a chain with a tagged stretch is the same
 * valid chain, and TV plays its untagged parts, jumping over the stretch.
 */
import { describe, expect, it } from 'vitest'
import type { Filter } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { newShard, toPayload } from 'sno-core/shards'
import { buildChain, positionHex, spawnTemplate, type NostrEvent } from '../../events'
import type { RelayAnswer } from '../../relayOutcome'
import { hopEvent, nextId } from '../../__tests__/chainFixtures'
import {
  activeIn, arrivalTimes, bagRecord, bagsHidden, bestChainLength, chainIndex, chainLength, chainLengthIndexed, keyChains, objectRecord, objectsPublished,
  respawnCount, validPrefixLength, type BagRecord, type ObjectRecord,
} from '../../countingRules'
import { TapeReader, beatOf, itemOf } from '../tape'
import { Director } from '../director'
import { loadCensus } from '../stats'
import { avatarTemplate } from '../../avatar'
import { NO_BROADCAST } from '../../noBroadcast'

const T = 1_790_000_000
const TAG = [NO_BROADCAST]
const tagged = (e: NostrEvent): NostrEvent => ({ ...e, tags: [...e.tags, TAG] })
const key = (): string => getPublicKey(generateSecretKey())

/** A key's spawn at `t` and `n` hops, one a second, each one Gibson on along x; the hops in `hide` (1-based) and the spawn when `hideSpawn` are tagged. */
function walk(pk: string, t: number, n: number, hide: number[] = [], hideSpawn = false): NostrEvent[] {
  const home = coordToXyz(hexToCoord(pk))
  const at = (dx: number) => ({ x: home.x + BigInt(dx), y: home.y, z: home.z })
  const spawn0: NostrEvent = { ...spawnTemplate(pk, t), id: nextId(), pubkey: pk, sig: '0'.repeat(128) }
  const spawn = hideSpawn ? tagged(spawn0) : spawn0
  const out = [spawn]
  for (let i = 1; i <= n; i++) {
    const hop = hopEvent({ pubkey: pk, createdAt: t + i, genesisId: spawn.id, previousId: out[i - 1].id, c: i === 1 ? pk : positionHex(at(i - 1), home.plane), to: at(i), plane: home.plane })
    out.push(hide.includes(i) ? tagged(hop) : hop)
  }
  return out
}

/** A relay over a fixed list, honouring kinds, since, until, limit and `#e`. */
function relay(events: NostrEvent[]): { ask: (f: Filter) => Promise<RelayAnswer[]>; asked: Filter[] } {
  const asked: Filter[] = []
  return {
    asked,
    ask: async (f) => {
      asked.push(f)
      const es = (f as { '#e'?: string[] })['#e']
      const as = (f as { '#A'?: string[] })['#A']
      const got = events
        .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!es || e.tags.some((t) => t[0] === 'e' && es.includes(t[1]))) && (!as || e.tags.some((t) => t[0] === 'A' && as.includes(t[1]))))
        .filter((e) => (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, f.limit ?? Infinity)
      return [{ url: 'wss://relay.test', outcome: 'answered', events: got }]
    },
  }
}

describe('the tape skips tagged events', () => {
  const pk = key()

  it('a tagged move is no beat; a tagged bag, object, avatar, comment or reaction is no item', () => {
    const [spawn, hop] = walk(pk, T, 1)
    expect(beatOf(spawn)).not.toBeNull()
    expect(beatOf(tagged(spawn))).toBeNull()
    expect(beatOf(hop)).not.toBeNull()
    expect(beatOf(tagged(hop))).toBeNull()
    const s = newShard('tower')
    s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
    s.faces = [[0, 1, 2]]
    const base = { pubkey: pk, created_at: T, sig: '' }
    const items: NostrEvent[] = [
      { ...base, id: nextId(), kind: 33330, tags: [['d', 'x'], ['encrypted', 'aes-256-gcm', 'y', 'cyberspace:region']], content: '' },
      { ...base, id: nextId(), kind: 33331, tags: [['d', 'tower']], content: JSON.stringify(toPayload(s)) },
      { ...base, id: nextId(), ...avatarTemplate(s, T) },
      { ...base, id: nextId(), kind: 1111, tags: [['K', '3333'], ['E', hop.id], ['k', '3333'], ['e', hop.id]], content: 'nice hop' },
      { ...base, id: nextId(), kind: 7, tags: [['k', '3333'], ['e', hop.id], ['p', pk]], content: '+' },
    ]
    for (const e of items) {
      expect(itemOf(e), `kind ${e.kind}`).not.toBeNull()
      expect(itemOf(tagged(e)), `kind ${e.kind}`).toBeNull()
    }
  })

  it('a chain with a tagged stretch: its untagged moves play, and the first after the stretch starts a shot of its own', async () => {
    // Spawn, hops 1-2 shown, 3-5 tagged (a tutorial), 6-7 shown, all within one trip's gaps.
    const chain = walk(pk, T, 7, [3, 4, 5])
    expect(validPrefixLength(buildChain(chain, pk))).toBe(8)
    const reader = new TapeReader(T - 10, relay(chain).ask, () => T + 100, false)
    const beats = []
    while (!reader.caughtUp) beats.push(...await reader.next())
    expect(beats.map((b) => b.id)).toEqual([chain[0], chain[1], chain[2], chain[6], chain[7]].map((e) => e.id))
    expect(beats.map((b) => b.afterHidden === true)).toEqual([false, false, false, true, false])
    const d = new Director()
    for (const b of beats) d.add(b)
    const shots = d.release(Infinity)
    expect(shots.map((s) => s.beats.map((b) => b.id))).toEqual([[chain[0].id, chain[1].id, chain[2].id], [chain[6].id, chain[7].id]])
    // The shot after the stretch opens where the stretch left the avatar: the `c` of hop 6, hop 5's landing.
    expect(shots[1].beats[0].from.position.x).toBe(coordToXyz(hexToCoord(pk)).x + 5n)
  })

  it('the move after a tagged stretch is known by its previous link, even signed in the same second with a smaller id', async () => {
    const chain = walk(pk, T, 3, [2])
    // Hop 3 signed in hop 2's second, with an id that sorts before it.
    const same = chain.map((e, i) => (i === 3 ? { ...e, created_at: chain[2].created_at, id: '0'.repeat(63) + '1' } : e))
    const reader = new TapeReader(T - 10, relay(same).ask, () => T + 100, false)
    const beats = []
    while (!reader.caughtUp) beats.push(...await reader.next())
    expect(beats.map((b) => b.afterHidden === true)).toEqual([false, false, true])
  })

  it('a tutorial from the spawn: nothing plays until the first untagged move', async () => {
    const chain = walk(pk, T, 4, [1, 2], true)
    const reader = new TapeReader(T - 10, relay(chain).ask, () => T + 100, false)
    const beats = []
    while (!reader.caughtUp) beats.push(...await reader.next())
    expect(beats.map((b) => b.id)).toEqual([chain[3].id, chain[4].id])
    expect(beats[0].afterHidden).toBe(true)
  })
})

describe('TV\'s numbers leave tagged events out (lib/countingRules)', () => {
  const pk = key()
  const chain = walk(pk, T, 6, [2, 3, 4])

  it('LONGEST CHAIN counts the untagged valid actions; the chain stays valid through the tagged ones', () => {
    expect(validPrefixLength(buildChain(chain, pk))).toBe(7)
    expect(chainLength(chain, pk)).toBe(4)
    expect(bestChainLength(chain, pk)).toBe(4)
    expect(keyChains(chain, pk).chainLength).toBe(4)
    expect(keyChains(chain, pk, Infinity, null).chainLength).toBe(4)
    // As of each moment, as the ticker asks.
    const index = chainIndex(chain, pk)
    for (let t = T - 1; t <= T + 7; t++) expect(chainLengthIndexed(index, chain, t), `t ${t}`).toBe(chainLength(chain, pk, t))
    expect(chainLength(chain, pk, T + 3)).toBe(2)
    // Untagged, the same chain counts every action.
    const plain = chain.map((e) => ({ ...e, tags: e.tags.filter((t) => t[0] !== NO_BROADCAST) }))
    expect(chainLength(plain, pk)).toBe(7)
  })

  it('a tagged action makes no key active; a tagged respawn or a tagged hop is no PHOENIX', () => {
    const tut = walk(pk, T, 2, [1, 2], true)
    expect(activeIn(tut, pk, T - 1, T + 10)).toBe(false)
    expect(activeIn(walk(pk, T, 2, [1]), pk, T - 1, T + 10)).toBe(true)
    const again = walk(pk, T + 100, 1, [], true)
    expect(respawnCount([...walk(pk, T, 1), ...again], pk)).toBe(0)
    const againHop = walk(pk, T + 100, 1, [1])
    expect(respawnCount([...walk(pk, T, 1), ...againHop], pk)).toBe(0)
    expect(respawnCount([...walk(pk, T, 1), ...walk(pk, T + 100, 1)], pk)).toBe(1)
    expect(keyChains([...walk(pk, T, 1), ...again], pk).respawns).toBe(0)
  })

  it('a key whose spawn is tagged arrives with its first untagged action on that chain, not before', () => {
    const tut = walk(pk, T, 4, [1, 2], true)
    expect(arrivalTimes(tut).get(pk)).toBe(T + 3)
    expect(arrivalTimes(tut.slice(0, 3)).has(pk)).toBe(false)
    expect(arrivalTimes(walk(pk, T, 1)).get(pk)).toBe(T)
    // Known spawns held apart: the chain's actions alone say when.
    const held = new Map([[tut[0].id, pk]])
    expect(arrivalTimes(tut.slice(1), held).get(pk)).toBe(T + 3)
  })

  it('a tagged bag or object counts for nothing, as the newest of its address', () => {
    const bag = (d: string, t: number, hide = false): BagRecord => bagRecord({ id: nextId(), pubkey: pk, created_at: t, kind: 33330, tags: [['d', d], ['encrypted', 'x'], ...(hide ? [TAG] : [])], content: '', sig: '' })!
    expect(bagRecord({ id: nextId(), pubkey: pk, created_at: T, kind: 33330, tags: [['d', 'a'], TAG], content: '', sig: '' })?.noBroadcast).toBe(true)
    expect(bagsHidden([bag('a', T), bag('b', T + 1, true)], []).get(pk)).toBe(1)
    // An untagged bag rewritten tagged: the newest stands, and is not counted.
    expect(bagsHidden([bag('a', T), bag('a', T + 5, true)], []).get(pk)).toBeUndefined()
    const s = newShard('cube')
    s.vertices = Array.from({ length: 8 }, (_, i) => ({ p: [i & 1, (i >> 1) & 1, (i >> 2) & 1] as [number, number, number], c: [1, 1, 1] as [number, number, number] }))
    s.faces = [[0, 1, 2]]
    const obj = (d: string, hide: boolean): ObjectRecord => objectRecord({ id: nextId(), pubkey: pk, created_at: T, kind: 33331, tags: [['d', d], ...(hide ? [TAG] : [])], content: JSON.stringify(toPayload(s)), sig: '' })!
    expect(objectsPublished([obj('a', false)], []).get(pk)).toBe(1)
    expect(objectsPublished([obj('a', true)], []).get(pk)).toBeUndefined()
  })
})

describe('the census (the ticker\'s AVATARS IN CYBERSPACE, BAGS, SHARDS)', () => {
  it('asks after a tagged spawn\'s chain until its key arrives, then counts it from its first untagged action', async () => {
    const pk = key()
    const tut = walk(pk, T, 2, [1, 2], true)
    const other = key()
    const plain = walk(other, T, 0)
    const bags: NostrEvent[] = [
      { id: nextId(), pubkey: pk, created_at: T, kind: 33330, tags: [['d', 'seed'], ['encrypted', 'x'], TAG], content: '', sig: '' },
      { id: nextId(), pubkey: other, created_at: T, kind: 33330, tags: [['d', 'mine'], ['encrypted', 'x']], content: '', sig: '' },
    ]
    let serve = [...tut, ...plain, ...bags]
    const asked: Filter[] = []
    const ask = (f: Filter) => { asked.push(f); return relay(serve).ask(f) }
    const c1 = await loadCensus(ask, null, T + 100)
    // Only the untagged key has arrived; the tagged spawn is held, asked after by `#e`.
    expect([...c1.firstSpawn.keys()]).toEqual([other])
    expect(c1.arrivals).toEqual([T])
    expect([...(c1.heldSpawns ?? new Map())]).toEqual([[tut[0].id, { pubkey: pk, at: T }]])
    expect(asked.some((f) => (f as { '#e'?: string[] })['#e']?.includes(tut[0].id))).toBe(true)
    // The tagged bag is not on the ticker.
    expect(c1.bags).toEqual([T])
    // The tutorial is over: the next move is untagged.
    const home = coordToXyz(hexToCoord(pk))
    const after = hopEvent({ pubkey: pk, createdAt: T + 200, genesisId: tut[0].id, previousId: tut[2].id, c: positionHex({ x: home.x + 2n, y: home.y, z: home.z }, home.plane), to: { x: home.x + 3n, y: home.y, z: home.z }, plane: home.plane })
    serve = [...serve, after]
    const c2 = await loadCensus(ask, c1, T + 300)
    expect(c2.firstSpawn.get(pk)).toBe(T + 200)
    expect(c2.arrivals).toEqual([T, T + 200])
    expect(c2.heldSpawns?.size).toBe(0)
    // A whole read a day on: the arrival stands, and its chain is not asked after again.
    asked.length = 0
    const c3 = await loadCensus(ask, c2, T + 300 + 24 * 60 * 60)
    expect(c3.firstSpawn.get(pk)).toBe(T + 200)
    expect(asked.some((f) => (f as { '#e'?: string[] })['#e'] !== undefined)).toBe(false)
  })

  it('stops asking after a tagged spawn two weeks old: a player who left during the tutorial', async () => {
    const pk = key()
    const serve = walk(pk, T, 1, [1], true)
    const asked: Filter[] = []
    const ask = (f: Filter) => { asked.push(f); return relay(serve).ask(f) }
    const c1 = await loadCensus(ask, null, T + 60)
    expect(c1.heldSpawns?.size).toBe(1)
    asked.length = 0
    const c2 = await loadCensus(ask, c1, T + 15 * 24 * 60 * 60)
    expect(c2.heldSpawns?.size).toBe(0)
    expect(c2.firstSpawn.has(pk)).toBe(false)
    expect(asked.some((f) => (f as { '#e'?: string[] })['#e'] !== undefined)).toBe(false)
  })
})
