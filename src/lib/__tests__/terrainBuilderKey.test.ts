/**
 * terrainBuilderKey.test.ts - the builder key (lib/terrain/builderKey.ts,
 * builderTags.ts) and what an author's chain says of it (reachChain.ts),
 * DECK-0009 §4: the tag owed until an action carrying it is on the relay;
 * never on a mined template, never on anything but a movement action, never
 * twice; a fixed template left alone; retirement owed on the next action
 * with a new key named beside it; and a key valid for a layer only when its
 * reach event's line names it and nothing retires it (from here on, or all).
 *
 * Every key is a throwaway made here.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { hopTemplate, spawnTemplate, positionHex, type NostrEvent } from '../events'
import {
  builderRecord, ensureBuilderKey, forgetBuilderRecords, namedKey, nameAgain, noteFound, owedTags, retireCurrent, waitingIds,
} from '../terrain/builderKey'
import { fixTags, noteActionSigned, owedBuilderTags, withBuilderTags } from '../terrain/builderTags'
import { reachCandidates, reachPlaces, readChainOf, retiredAnywhere, onLine } from '../terrain/reachChain'

beforeEach(() => forgetBuilderRecords())

const move = (tags: string[][] = []) => ({ kind: 3333, created_at: 1_790_000_000, tags: [['A', 'hop'], ...tags], content: '' })

describe('the builder tag rides on the next movement action', () => {
  it('is owed from the first TERRAIN use until an action carrying it is found on the relay', () => {
    const me = getPublicKey(generateSecretKey())
    expect(owedBuilderTags(me)).toEqual([])
    const rec = ensureBuilderKey(me)
    const pub = rec.current!
    expect(pub).toMatch(/^[0-9a-f]{64}$/)
    expect(pub).not.toBe(me)
    expect(owedBuilderTags(me)).toEqual([['builder', pub]])
    // Added to a move, once; a move that has it is left as the same object.
    const t = withBuilderTags(move(), me)
    expect(t.tags).toContainEqual(['builder', pub])
    expect(withBuilderTags(t, me)).toBe(t)
    // Never on another kind, a mined template, or another identity's move.
    const bag = { ...move(), kind: 33330 }
    expect(withBuilderTags(bag, me)).toBe(bag)
    const mined = move([['nonce', '1', '8']])
    expect(withBuilderTags(mined, me)).toBe(mined)
    const other = move()
    expect(withBuilderTags(other, getPublicKey(generateSecretKey()))).toBe(other)
    // Signed: remembered as waiting; still owed until the relay holds one.
    noteActionSigned({ id: 'a'.repeat(64), pubkey: me, kind: 3333, tags: t.tags })
    expect(waitingIds(me)).toEqual(['a'.repeat(64)])
    expect(owedBuilderTags(me)).toEqual([['builder', pub]])
    expect(namedKey(me)).toBeNull()
    noteFound(me, new Set(['a'.repeat(64)]))
    expect(namedKey(me)?.named).toBe('a'.repeat(64))
    expect(owedBuilderTags(me)).toEqual([])
    expect(withBuilderTags(other, me)).toBe(other)
    // The naming lost from the chain (a respawn): owed again.
    nameAgain(me, pub)
    expect(owedBuilderTags(me)).toEqual([['builder', pub]])
  })

  it('a fixed template is fixed', () => {
    const t = fixTags(move())
    expect(t.tags).toHaveLength(1)
  })

  it('retiring: builder-retire for the old key and builder for a new one, on the same next action', () => {
    const me = getPublicKey(generateSecretKey())
    const old = ensureBuilderKey(me).current!
    noteActionSigned({ id: 'b'.repeat(64), pubkey: me, kind: 3333, tags: [['builder', old]] })
    noteFound(me, new Set(['b'.repeat(64)]))
    retireCurrent(me)
    const rec = builderRecord(me)!
    const fresh = rec.current!
    expect(fresh).not.toBe(old)
    expect(owedTags(rec)).toEqual([['builder', fresh], ['builder-retire', old]])
    expect(namedKey(me)).toBeNull()
    const t = withBuilderTags(move(), me)
    noteActionSigned({ id: 'c'.repeat(64), pubkey: me, kind: 3333, tags: t.tags })
    noteFound(me, new Set(['c'.repeat(64)]))
    expect(owedTags(builderRecord(me))).toEqual([])
    expect(namedKey(me)?.pub).toBe(fresh)
    // "all" when a key may have been copied.
    retireCurrent(me, true)
    expect(owedTags(builderRecord(me))).toContainEqual(['builder-retire', fresh, 'all'])
  })
})

/** A throwaway author's chain: a spawn, then hops to `stops`, each event carrying `extra[i]` tags. */
function chainOf(stops: Array<{ x: bigint; y: bigint; z: bigint }>, extra: string[][][] = []): { pubkey: string; events: NostrEvent[] } {
  let sk = generateSecretKey()
  let pubkey = getPublicKey(sk)
  while ((parseInt(pubkey.slice(-1), 16) & 1) !== 0) { sk = generateSecretKey(); pubkey = getPublicKey(sk) }
  const spawn = finalizeEvent({ ...spawnTemplate(pubkey, 1_790_000_000), tags: [...spawnTemplate(pubkey, 1_790_000_000).tags, ...(extra[0] ?? [])] }, sk) as unknown as NostrEvent
  const events = [spawn]
  let prev = spawn
  let prevHex = pubkey
  stops.forEach((to, i) => {
    const t = hopTemplate({ createdAt: 1_790_000_001 + i, genesisId: spawn.id, previousId: prev.id, prevCoordHex: prevHex, to: { ...to }, plane: 0, proofHash: 'ab'.repeat(32), mn: '0'.repeat(16), mp: '00'.repeat(32) })
    const ev = finalizeEvent({ ...t, tags: [...t.tags, ...(extra[i + 1] ?? [])] }, sk) as unknown as NostrEvent
    events.push(ev)
    prev = ev
    prevHex = positionHex({ ...to }, 0)
  })
  return { pubkey, events }
}

describe('what the author\'s chain says of a builder key (§4.4, §6.2)', () => {
  const at = { x: 0x1000n, y: 0x2000n, z: 0x3000n }
  const chunk = { x: 0x1000n, y: 0x2000n, z: 0x3000n, plane: 0 }
  const step = (d: bigint) => ({ x: at.x + d, y: at.y, z: at.z })

  it('valid at and after the action that names it, not before', () => {
    const k = 'e'.repeat(64)
    const c = chainOf([step(1n), step(2n), step(3n)], [[], [], [['builder', k]], []])
    const r = readChainOf(c.pubkey, c.events, new Set())
    expect(r.end).toBe(4)
    const [, h1, h2, h3] = c.events.map((e) => e.id)
    expect([...reachPlaces(r, k, [h1, h2, h3]).keys()]).toEqual([h2, h3])
    expect(reachPlaces(r, 'f'.repeat(64), [h3]).size).toBe(0)
    // This device's own reach: the newest after the naming, within reach.
    expect(reachCandidates(r, k, h2, chunk).map((a) => a.id)).toEqual([h3, h2])
    expect(onLine(r, h2)).toBe(true)
    // A reach event out of reach of a chunk is no candidate there.
    expect(reachCandidates(r, k, h2, { ...chunk, x: chunk.x + 4096n })).toEqual([])
  })

  it('retired from here on: layers naming later reach events stop counting, earlier ones stand', () => {
    const k = 'e'.repeat(64)
    const c = chainOf([step(1n), step(2n), step(3n)], [[['builder', k]], [], [['builder-retire', k]], []])
    const r = readChainOf(c.pubkey, c.events, new Set())
    const [, h1, h2, h3] = c.events.map((e) => e.id)
    expect([...reachPlaces(r, k, [h1, h2, h3]).keys()]).toEqual([h1])
    expect(retiredAnywhere(r, k)).toBe(true)
  })

  it('retired with all: no layer of the key counts, whenever it was written', () => {
    const k = 'e'.repeat(64)
    const c = chainOf([step(1n), step(2n)], [[['builder', k]], [], [['builder-retire', k, 'all']]])
    const r = readChainOf(c.pubkey, c.events, new Set())
    const [, h1] = c.events.map((e) => e.id)
    expect(reachPlaces(r, k, [h1]).size).toBe(0)
  })

  it('a malformed retirement (a third element other than all) is read as from here on', () => {
    const k = 'e'.repeat(64)
    const c = chainOf([step(1n), step(2n)], [[['builder', k]], [], [['builder-retire', k, 'some']]])
    const r = readChainOf(c.pubkey, c.events, new Set())
    const [, h1, h2] = c.events.map((e) => e.id)
    expect([...reachPlaces(r, k, [h1, h2]).keys()]).toEqual([h1])
  })
})
