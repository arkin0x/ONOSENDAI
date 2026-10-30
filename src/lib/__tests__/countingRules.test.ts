/**
 * countingRules.test.ts: the rules every Cyberspace number shares
 * (lib/countingRules), each on the cases its badge and its board turn on: a
 * fork ends a chain, a gap stops it, a respawn starts one, bags and objects
 * per author with their daily caps, arrivals and active keys in a week.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { newShard, toPayload } from 'sno-core/shards'
import { positionHex, spawnTemplate, type NostrEvent } from '../events'
import {
  BAGS_PER_DAY, DAY_S, OBJECTS_PER_DAY, WEEK_S, activeIn, activeKeys, actionsByAuthor, arrivalTimes, arrivalsIn, bagRecord, bagsHidden, chainLength,
  chainIndex, chainLengthIndexed, deletionOf, keyChains, objectRecord, objectsPublished, respawnCount, validPrefixLength, type BagRecord, type ObjectRecord,
} from '../countingRules'
import { buildChain } from '../events'
import { hopEvent, nextId } from './chainFixtures'

const T = 1_790_000_000

/** A key, its spawn at `t`, and `n` hops after it, one a second, each one Gibson on along x. */
function walk(pk: string, t: number, n: number): NostrEvent[] {
  const home = coordToXyz(hexToCoord(pk))
  const at = (dx: number) => ({ x: home.x + BigInt(dx), y: home.y, z: home.z })
  const spawn: NostrEvent = { ...spawnTemplate(pk, t), id: nextId(), pubkey: pk, sig: '0'.repeat(128) }
  const out = [spawn]
  for (let i = 1; i <= n; i++) {
    out.push(hopEvent({ pubkey: pk, createdAt: t + i, genesisId: spawn.id, previousId: out[i - 1].id, c: i === 1 ? pk : positionHex(at(i - 1), home.plane), to: at(i), plane: home.plane }))
  }
  return out
}
const key = (): string => getPublicKey(generateSecretKey())

describe('LONGEST CHAIN (chainLength, the CHAIN badge\'s number)', () => {
  const pk = key()
  const chain = walk(pk, T, 4)

  it('counts the valid actions on the current chain, the spawn included', () => {
    expect(chainLength(chain, pk)).toBe(5)
    expect(chainLength([chain[0]], pk)).toBe(1)
    expect(chainLength([], pk)).toBe(0)
  })

  it('a fork ends the whole chain: it counts nothing', () => {
    const fork = hopEvent({ pubkey: pk, createdAt: T + 9, genesisId: chain[0].id, previousId: chain[2].id, c: chain[3].tags.find((t) => t[0] === 'c')![1], to: { x: 1n, y: 2n, z: 3n } })
    expect(chainLength([...chain, fork], pk)).toBe(0)
    // Before the second branch was signed, there was no fork.
    expect(chainLength([...chain, fork], pk, T + 8)).toBe(5)
  })

  it('a gap stops it at the event before the gap', () => {
    // The third hop is missing: the fourth names an event no relay has.
    expect(chainLength([chain[0], chain[1], chain[2], chain[4]], pk)).toBe(3)
  })

  it('follows previous links, not timestamps: a hop signed out of order still counts, an orphan does not', () => {
    const late = { ...chain[2], created_at: T + 100 }
    expect(chainLength([chain[0], chain[1], late, chain[3], chain[4]], pk)).toBe(5)
    const orphan = hopEvent({ pubkey: pk, createdAt: T + 3, genesisId: chain[0].id, previousId: nextId(), c: pk, to: { x: 1n, y: 1n, z: 1n } })
    expect(chainLength([chain[0], orphan], pk)).toBe(1)
  })

  it('a respawn starts a new chain; the old one is history', () => {
    const again = walk(pk, T + 50, 2)
    expect(chainLength([...chain, ...again], pk)).toBe(3)
    // As of before the respawn, the old chain stood.
    expect(chainLength([...chain, ...again], pk, T + 49)).toBe(5)
  })

  it('stops at the first action that breaks a rule (the valid prefix)', () => {
    // A hop that does not leave from where the chain stood.
    const wrong = hopEvent({ pubkey: pk, createdAt: T + 5, genesisId: chain[0].id, previousId: chain[4].id, c: pk, to: { x: 9n, y: 9n, z: 9n } })
    expect(chainLength([...chain, wrong], pk)).toBe(5)
    expect(validPrefixLength(buildChain([...chain, wrong], pk))).toBe(5)
  })

  it('only the key\'s own events, and only v2', () => {
    const other = key()
    const stranger = hopEvent({ pubkey: other, createdAt: T + 5, genesisId: chain[0].id, previousId: chain[4].id, c: pk, to: { x: 1n, y: 1n, z: 1n } })
    expect(chainLength([...chain, stranger], pk)).toBe(5)
    const v1 = chain.map((e) => ({ ...e, tags: [...e.tags, ['version', '1']] }))
    expect(chainLength(v1, pk)).toBe(0)
  })
})

describe('MOST RESPAWNS (respawnCount, PHOENIX)', () => {
  const pk = key()
  const first = walk(pk, T, 2)
  const idle = walk(pk, T + 100, 0)
  const third = walk(pk, T + 200, 1)

  it('counts the spawns after the first that kept going', () => {
    expect(respawnCount([...first, ...idle, ...third], pk)).toBe(1)
    expect(respawnCount(first, pk)).toBe(0)
    // A spawn with nothing after it is free and counts for nothing.
    expect(respawnCount([...first, ...idle], pk)).toBe(0)
  })

  it('a respawn whose chain forked did not keep going', () => {
    const fork = hopEvent({ pubkey: pk, createdAt: T + 205, genesisId: third[0].id, previousId: third[0].id, c: pk, to: { x: 1n, y: 1n, z: 1n } })
    expect(respawnCount([...first, ...third, fork], pk)).toBe(0)
  })

  it('the first spawn is never a respawn, however far it went', () => {
    expect(respawnCount([...walk(pk, T, 9)], pk)).toBe(0)
  })
})

describe('active keys in a week (activeIn, activeKeys)', () => {
  const a = key()
  const b = key()
  const c = key()
  const asOf = T + 30 * DAY_S
  const evs = [...walk(a, asOf - DAY_S, 2), ...walk(b, asOf - 10 * DAY_S, 1), ...walk(c, asOf + 10, 1)]

  it('a key with a valid action in (asOf - 7 days, asOf]', () => {
    const by = actionsByAuthor(evs)
    expect(activeKeys(by, asOf - WEEK_S, asOf)).toEqual([a])
    expect(activeKeys(by, asOf - 2 * WEEK_S, asOf - WEEK_S)).toEqual([b])
  })

  it('an action on a forked chain is not valid, so not activity', () => {
    const ch = walk(a, asOf - DAY_S, 1)
    const fork = hopEvent({ pubkey: a, createdAt: asOf - DAY_S + 5, genesisId: ch[0].id, previousId: ch[0].id, c: a, to: { x: 1n, y: 1n, z: 1n } })
    expect(activeIn([...ch, fork], a, asOf - WEEK_S, asOf)).toBe(false)
  })

  it('an older chain\'s actions count in their week', () => {
    const old = walk(a, asOf - 3 * DAY_S, 3)
    const again = walk(a, asOf + DAY_S, 0)
    expect(activeIn([...old, ...again], a, asOf - WEEK_S, asOf)).toBe(true)
  })
})

describe('keyChains: each chain built once, the same answers', () => {
  it('agrees with chainLength, respawnCount and activeIn', () => {
    const pk = key()
    const asOf = T + 20 * DAY_S
    const sets: NostrEvent[][] = [
      walk(pk, T, 3),
      [...walk(pk, T, 3), ...walk(pk, asOf - DAY_S, 2)],
      [...walk(pk, T, 1), ...walk(pk, T + DAY_S, 0), ...walk(pk, asOf - 3, 2)],
    ]
    for (const evs of sets) {
      for (const t of [asOf, asOf - 2 * DAY_S, T + 2]) {
        const k = keyChains(evs, pk, t)
        expect(k.chainLength).toBe(chainLength(evs, pk, t))
        expect(k.respawns).toBe(respawnCount(evs, pk, t))
        expect(k.activeWeek).toBe(activeIn(evs, pk, t - WEEK_S, t))
      }
    }
  })
})

describe('MOST BAGS HIDDEN (bagsHidden, STASH)', () => {
  const pk = 'a'.repeat(64)
  const bag = (d: string, t: number, sealed = true, who = pk): BagRecord => bagRecord({ id: nextId(), pubkey: who, created_at: t, kind: 33330, tags: [['d', d], ...(sealed ? [['encrypted', 'x']] : [])], content: '', sig: '' })!

  it('counts live sealed bags, the newest of each d once', () => {
    const bags = [bag('one', T), bag('one', T + 10), bag('two', T + 20), bag('open', T + 30, false), bag('theirs', T, true, 'b'.repeat(64))]
    expect(bagsHidden(bags, []).get(pk)).toBe(2)
    expect(bagsHidden(bags, []).get('b'.repeat(64))).toBe(1)
  })

  it('at most five a UTC day', () => {
    const day = Math.floor(T / DAY_S) * DAY_S
    const bags = Array.from({ length: 8 }, (_, i) => bag(`d${i}`, day + i * 60)).concat([bag('next', day + DAY_S + 5)])
    expect(bagsHidden(bags, []).get(pk)).toBe(BAGS_PER_DAY + 1)
  })

  it('a deletion by its author takes a bag away; a bag sealed again after it is back', () => {
    const b1 = bag('one', T)
    const del = deletionOf({ id: nextId(), pubkey: pk, created_at: T + 5, kind: 5, tags: [['a', `33330:${pk}:one`], ['k', '33330']], content: '', sig: '' })!
    expect(bagsHidden([b1], [del]).get(pk)).toBeUndefined()
    expect(bagsHidden([b1, bag('one', T + 10)], [del]).get(pk)).toBe(1)
    const byId = deletionOf({ id: nextId(), pubkey: pk, created_at: T + 5, kind: 5, tags: [['e', b1.id]], content: '', sig: '' })!
    expect(bagsHidden([b1], [byId]).get(pk)).toBeUndefined()
    const notTheirs = { ...del, pubkey: 'c'.repeat(64) }
    expect(bagsHidden([b1], [notTheirs]).get(pk)).toBe(1)
  })

  it('reads no place: a bag record is who, which d, when and sealed', () => {
    const r = bagRecord({ id: nextId(), pubkey: pk, created_at: T, kind: 33330, tags: [['d', 'x'], ['encrypted', 'y'], ['H', '12'], ['hint', 'h'], ['S', '123'], ['C', 'f'.repeat(64)]], content: 'riddle', sig: '' })!
    expect(Object.keys(r).sort()).toEqual(['createdAt', 'd', 'id', 'kind', 'pubkey', 'sealed'])
  })
})

describe('MOST OBJECTS PUBLISHED (objectsPublished, BUILDER)', () => {
  const pk = 'a'.repeat(64)
  /** A box of 8 vertices, `k` Gibsons along: a new shape for each k. */
  function boxEvent(d: string, t: number, k: number, extra: string[][] = []): NostrEvent {
    const s = newShard(`Box ${k}`)
    s.id = d
    s.mode = 'solid'
    s.vertices = [[0, 0, 0], [k, 0, 0], [k, 1, 0], [0, 1, 0], [0, 0, 1], [k, 0, 1], [k, 1, 1], [0, 1, 1]].map((p) => ({ p: p as [number, number, number], c: [1, 1, 1] as [number, number, number] }))
    s.faces = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 2, 6], [3, 6, 7]]
    return { id: nextId(), pubkey: pk, created_at: t, kind: 33331, tags: [['d', d], ...extra], content: JSON.stringify(toPayload(s)), sig: '' }
  }
  const rec = (e: NostrEvent): ObjectRecord => objectRecord(e)!

  it('reads the shape once: 8 vertices, a canonical hash, open', () => {
    const r = rec(boxEvent('a', T, 1))
    expect(r.vertices).toBe(8)
    expect(r.shape).toMatch(/^[0-9a-f]+$/)
    expect(r.open).toBe(true)
    expect(rec(boxEvent('b', T, 1)).shape).toBe(r.shape)
    expect(rec(boxEvent('c', T, 2)).shape).not.toBe(r.shape)
  })

  it('counts live public objects, each a new shape, 8+ vertices', () => {
    const list = [rec(boxEvent('a', T, 1)), rec(boxEvent('b', T + 1, 1)), rec(boxEvent('c', T + 2, 2)), rec(boxEvent('sealed', T, 3, [['encrypted', 'x']]))]
    const small: ObjectRecord = { ...rec(boxEvent('tiny', T, 4)), vertices: 4 }
    expect(objectsPublished([...list, small], []).get(pk)).toBe(2)
  })

  it('at most ten a UTC day', () => {
    const day = Math.floor(T / DAY_S) * DAY_S
    const list = Array.from({ length: 14 }, (_, i) => rec(boxEvent(`d${i}`, day + i, i + 1)))
    expect(objectsPublished(list, []).get(pk)).toBe(OBJECTS_PER_DAY)
  })

  it('a payload that does not read counts for nothing', () => {
    const bad = rec({ ...boxEvent('x', T, 1), content: '{not json' })
    expect(bad.shape).toBeNull()
    expect(objectsPublished([bad], []).get(pk)).toBeUndefined()
  })
})

describe('NEW ARRIVALS (arrivalTimes, arrivalsIn)', () => {
  it('each key\'s first v2 spawn, counted in a week', () => {
    const a = key()
    const b = key()
    const asOf = T + 30 * DAY_S
    const evs = [...walk(a, asOf - 10 * DAY_S, 0), ...walk(a, asOf - DAY_S, 0), ...walk(b, asOf - 2 * DAY_S, 1)]
    const arr = arrivalTimes(evs)
    expect(arr.get(a)).toBe(asOf - 10 * DAY_S)
    expect(arrivalsIn(arr, asOf - WEEK_S, asOf)).toBe(1)
    expect(arrivalsIn(arr, asOf - 2 * WEEK_S, asOf - WEEK_S)).toBe(1)
  })
})

describe('chainLengthIndexed: the ticker\'s index answers as chainLength does, at every moment', () => {
  it('a plain chain, a gap, a fork, a respawn, a hop signed out of order, a broken one', () => {
    const pk = key()
    const a = walk(pk, T, 6)
    const fork = hopEvent({ pubkey: pk, createdAt: T + 30, genesisId: a[0].id, previousId: a[3].id, c: a[4].tags.find((t) => t[0] === 'c')![1], to: { x: 1n, y: 2n, z: 3n } })
    const wrong = hopEvent({ pubkey: pk, createdAt: T + 7, genesisId: a[0].id, previousId: a[6].id, c: pk, to: { x: 9n, y: 9n, z: 9n } })
    const again = walk(pk, T + 100, 3)
    const sets: NostrEvent[][] = [
      a,
      [a[0], a[1], a[2], a[4], a[5]],
      [...a, fork],
      [...a, ...again],
      [a[0], a[1], { ...a[2], created_at: T + 50 }, a[3], a[4]],
      [...a, wrong],
    ]
    for (const evs of sets) {
      const index = chainIndex(evs, pk)
      for (let t = T - 1; t <= T + 110; t++) expect(chainLengthIndexed(index, evs, t), `t=${t}`).toBe(chainLength(evs, pk, t))
    }
  })
})
