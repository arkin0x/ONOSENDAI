/**
 * chainRulings1008.test.ts - arkinox's rulings of 2026-10-08 on the points
 * the reference verifiers left open, and the three ride checks he approved.
 *
 * What would go wrong silently: an event carrying two e previous tags, two C
 * tags or two proofs read by its first copy and passed as valid; a bare
 * ["A"] read as an unknown action and skipped, as if the chain were fine;
 * a fork resolved to its older branch, so the identity kept moving on a
 * chain every other verifier calls dead; and a ride that leaves from a block
 * the last ride never reached, or names no as_of, drawn as a valid ride.
 */

import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import {
  FORK_RULE,
  RULINGS_2026_10_08,
  TAGS_ONCE_RULE,
  actionLabel,
  buildChain,
  firstBreak,
  newestSpawn,
  positionHex,
  spawnTemplate,
  type NostrEvent,
} from '../events'
import { apologyFor } from '../chainBreak'
import type { Position } from '../space'
import { actionEvent, enterVirtualEvent, exitVirtualEvent, hopEvent, nextId, virtualEvent } from './chainFixtures'

const pk = getPublicKey(generateSecretKey())
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)
const GAME = 'cd'.repeat(32)
const ZERO = '0'.repeat(64)

function spawnAt(createdAt: number, tags?: (own: string[][]) => string[][]): NostrEvent {
  const t = spawnTemplate(pk, createdAt)
  return { ...t, tags: tags ? tags(t.tags) : t.tags, id: nextId(), pubkey: pk, sig: '0'.repeat(128) }
}
const plus = (ev: NostrEvent, extra: string[][]): NostrEvent => ({ ...ev, tags: [...ev.tags, ...extra] })
const without = (ev: NostrEvent, name: string): NostrEvent => ({ ...ev, tags: ev.tags.filter((t) => t[0] !== name) })

const spawn = spawnAt(1_000)
const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane })
const hop2 = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), to: at(2n), plane })

describe('exactly one e genesis and one e previous on every chain event, one e entry on an exit (ruling 1)', () => {
  it('a hop with a second e previous is broken, and is on the chain by its first copy', () => {
    const doubled = plus(hop2, [['e', spawn.id, '', 'previous']])
    const chain = buildChain([spawn, hop1, doubled])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, hop1.id, doubled.id])
    expect(chain[2].breaks).toMatch(/^a hop carrying two e tags marked previous\. Every tag the chain rules read has to appear exactly once/)
    expect(chain[2].breakSince).toEqual(TAGS_ONCE_RULE)
    expect(chain[2].coordHex).toBe(hexAt(at(1n)))
  })

  it('a second e genesis, even naming the same spawn, breaks the event', () => {
    const doubled = plus(hop1, [['e', spawn.id, '', 'genesis']])
    expect(buildChain([spawn, doubled])[1].breaks).toMatch(/two e tags marked genesis/)
  })

  it('a skipped action with two e previous tags is broken, not skipped', () => {
    const wave = plus(actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave' }), [['e', hop1.id, '', 'previous']])
    const entry = buildChain([spawn, hop1, wave])[2]
    expect(entry.role).toBe('broken')
    expect(entry.breaks).toMatch(/^an event carrying two e tags marked previous/)
  })

  it("inside a bracket, a game's move with two e genesis tags is broken; its other tags stay the game's", () => {
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: at(1n), height: 8, game: GAME, plane })
    const move = virtualEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, name: 'castle', c: 'zz', inGame: at(9n), plane })
    const free = plus(move, [['C', ZERO], ['proof', 'x'], ['proof', 'y']])
    expect(firstBreak(buildChain([spawn, hop1, enter, free]))).toBeNull()
    const doubled = buildChain([spawn, hop1, enter, plus(move, [['e', spawn.id, '', 'genesis']])])[3]
    expect(doubled.breaks).toMatch(/two e tags marked genesis/)
    expect(doubled.bracketId).toBe(enter.id)
  })

  it('an exit with two e entry tags is broken; its c, doubled or malformed, never is (ruling 2)', () => {
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: at(1n), height: 8, game: GAME, plane })
    const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, entryId: enter.id, restore: at(1n), plane })
    expect(firstBreak(buildChain([spawn, hop1, enter, plus(exit, [['c', 'not a coordinate'], ['c', ZERO], ['c']])]))).toBeNull()
    const doubled = buildChain([spawn, hop1, enter, plus(exit, [['e', enter.id, '', 'entry']])])[3]
    expect(doubled.role).toBe('exit')
    expect(doubled.breaks).toMatch(/^an exit-virtual carrying two e tags marked entry/)
  })
})

describe('only kind 3333 takes part (ruling 3)', () => {
  it('an event of another kind naming the spawn is not on the chain, and makes no fork', () => {
    const other = { ...hopEvent({ pubkey: pk, createdAt: 1_005, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(9n), plane }), kind: 1 }
    const chain = buildChain([spawn, other, hop1])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, hop1.id])
    expect(firstBreak(chain)).toBeNull()
  })
})

describe('any A tag equal to spawn makes a spawn (ruling 4)', () => {
  it('a spawn that also carries another A tag is the newest spawn, invalid, and dead at the spawn coordinate', () => {
    const newer = spawnAt(2_000, (own) => [...own, ['A', 'hop']])
    expect(newestSpawn([spawn, hop1, newer], pk)?.id).toBe(newer.id)
    const chain = buildChain([spawn, hop1, newer])
    expect(chain.map((a) => a.id)).toEqual([newer.id])
    expect(chain[0].breaks).toMatch(/two A tags \(spawn, hop\)/)
    expect(chain[0].coordHex).toBe(pk)
  })
})

describe('a spawn is never a link (2026-10-08 ruling, spec PR #48)', () => {
  it('an older spawn-tagged event naming the spawn as genesis and h1 as previous makes no fork, and the chain stays valid at h2', () => {
    const stray = spawnAt(990, (own) => [...own, ['e', spawn.id, '', 'genesis'], ['e', hop1.id, '', 'previous']])
    const chain = buildChain([spawn, hop1, hop2, stray])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, hop1.id, hop2.id])
    expect(firstBreak(chain)).toBeNull()
    expect(chain[2].coordHex).toBe(hexAt(at(2n)))
  })

  it('an event carrying a hop A tag and a spawn A tag, with links, is never followed: no fork, and it is not read as the hop', () => {
    const both = plus(hopEvent({ pubkey: pk, createdAt: 995, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), to: at(9n), plane }), [['A', 'spawn']])
    const chain = buildChain([spawn, hop1, hop2, both])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, hop1.id, hop2.id])
    expect(firstBreak(chain)).toBeNull()
  })
})

describe('always mainnet: a net tag is never read (2026-10-08 ruling, spec PR #48)', () => {
  it('net tags, doubled or naming another network, change nothing about a chain', () => {
    const tagged = plus(hop2, [['net', 'testnet'], ['net', 'signet']])
    const chain = buildChain([spawn, plus(hop1, [['net', 'regtest']]), tagged])
    expect(firstBreak(chain)).toBeNull()
    expect(chain.map((a) => a.coordHex)).toEqual(buildChain([spawn, hop1, hop2]).map((a) => a.coordHex))
  })
})

describe('a fork ends the whole chain (ruling 5)', () => {
  it('two hops naming the spawn: dead at the spawn coordinate, both branches named, whichever came first', () => {
    const other = hopEvent({ pubkey: pk, createdAt: 1_015, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(5n), plane })
    const chain = buildChain([spawn, hop1, other, hop2])
    const broken = firstBreak(chain)!
    expect(broken.index).toBe(0)
    expect(broken.lastValid).toBeNull()
    expect(chain[0].fork).toEqual({ previousId: spawn.id, branchIds: [hop1.id, other.id] })
    expect(chain[0].breakSince).toEqual(FORK_RULE)
    expect(chain[0].breaks).toMatch(/^a fork: two events \(.+ and .+\) both name row 0 \(event .+\) as the action before them\. A chain may only ever have one next action after each event, so a fork ends the whole chain/)
    expect(chain.every((a) => a.coordHex === pk)).toBe(true)
    expect(actionLabel(chain[0])).toBe('BROKEN · SPAWN')
  })

  it('a fork overrides freezing: S, a, x, b with x invalid and two events naming b stands at the spawn coordinate, not frozen at a (spec §3.2, §8.7.3)', () => {
    const x = plus(hop2, [['C', ZERO]])
    const b = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: x.id, c: hexAt(at(2n)), to: at(3n), plane })
    const c = hopEvent({ pubkey: pk, createdAt: 1_040, genesisId: spawn.id, previousId: b.id, c: hexAt(at(3n)), to: at(4n), plane })
    const d = hopEvent({ pubkey: pk, createdAt: 1_041, genesisId: spawn.id, previousId: b.id, c: hexAt(at(3n)), to: at(5n), plane })
    const chain = buildChain([spawn, hop1, x, b, c, d])
    expect(chain.map((e) => e.id)).toEqual([spawn.id, hop1.id, x.id, b.id])
    expect(firstBreak(chain)?.index).toBe(0)
    expect(chain[0].fork?.branchIds).toEqual([c.id, d.id])
    expect(chain.every((e) => e.coordHex === pk)).toBe(true)
  })

  it('a fork deep in the chain still freezes the identity at its spawn coordinate, not at the fork', () => {
    const rival = hopEvent({ pubkey: pk, createdAt: 1_025, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), to: at(7n), plane })
    const chain = buildChain([spawn, hop1, hop2, rival])
    expect(firstBreak(chain)?.index).toBe(0)
    expect(chain[0].fork?.previousId).toBe(hop1.id)
    expect(chain[chain.length - 1].coordHex).toBe(pk)
  })

  it('three branches are all named', () => {
    const b = hopEvent({ pubkey: pk, createdAt: 1_011, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(3n), plane })
    const c = hopEvent({ pubkey: pk, createdAt: 1_012, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(4n), plane })
    const chain = buildChain([spawn, hop1, b, c])
    expect(chain[0].fork?.branchIds).toEqual([hop1.id, b.id, c.id])
    expect(chain[0].breaks).toMatch(/^a fork: three events \(.+, .+ and .+\) all name/)
  })

  it('the same event twice is not a fork', () => {
    expect(firstBreak(buildChain([spawn, hop1, { ...hop1 }, hop2]))).toBeNull()
  })

  it('no live chain has forked, so the apology is only for a fork signed before the ruling took effect', () => {
    const t = RULINGS_2026_10_08.effectiveAt + 60
    const s = spawnAt(t)
    const a = hopEvent({ pubkey: pk, createdAt: t + 1, genesisId: s.id, previousId: s.id, c: pk, to: at(1n), plane })
    const b = hopEvent({ pubkey: pk, createdAt: t + 2, genesisId: s.id, previousId: s.id, c: pk, to: at(2n), plane })
    expect(apologyFor(buildChain([s, a, b])[0])).toBeNull()
    const old = buildChain([spawn, hop1, hopEvent({ pubkey: pk, createdAt: 1_015, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(5n), plane })])[0]
    expect(apologyFor(old)).toMatch(/took effect on 2026-10-08, by arkinox's ruling of that day, folded into chain rules revision 2026-09-28-virtual-brackets and written into the spec by PR #48 that day, after this action was signed/)
  })
})

describe('every tag a chain rule reads, exactly once and with a value (ruling 6)', () => {
  it('a bare ["A"] is an A tag that names nothing: broken, not skipped', () => {
    const bare = { ...without(hop2, 'A'), tags: [['A'], ...without(hop2, 'A').tags] }
    const entry = buildChain([spawn, hop1, bare])[2]
    expect(entry.role).toBe('broken')
    expect(entry.breaks).toMatch(/^an event whose A tag is empty, so it names no action at all/)
    expect(entry.breakSince).toEqual(TAGS_ONCE_RULE)
  })

  it('["A", ""] likewise', () => {
    const empty = { ...without(hop2, 'A'), tags: [['A', ''], ...without(hop2, 'A').tags] }
    expect(buildChain([spawn, hop1, empty])[2].breaks).toMatch(/A tag is empty/)
  })

  it('a hop with two C tags, or two proofs, is broken even when the copies agree', () => {
    const C = hop2.tags.find((t) => t[0] === 'C')!
    expect(buildChain([spawn, hop1, plus(hop2, [C])])[2].breaks).toMatch(/^a hop carrying two C tags\./)
    expect(buildChain([spawn, hop1, plus(hop2, [['proof', ZERO]])])[2].breaks).toMatch(/^a hop carrying two proof tags\./)
  })

  it('a spawn with two C tags is broken at the spawn coordinate', () => {
    const doubled = spawnAt(2_000, (own) => [...own, ['C', pk]])
    const chain = buildChain([doubled])
    expect(chain[0].breaks).toMatch(/^a spawn carrying two C tags\./)
    expect(chain[0].breakSince).toEqual(TAGS_ONCE_RULE)
  })

  it('an enter-virtual with two region tags is broken', () => {
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: at(1n), height: 8, game: GAME, plane })
    const region = enter.tags.find((t) => t[0] === 'region')!
    expect(buildChain([spawn, hop1, plus(enter, [region])])[2].breaks).toMatch(/^an enter-virtual carrying two region tags\./)
  })

  it('tags no chain rule reads are free, doubled or not', () => {
    expect(firstBreak(buildChain([spawn, hop1, plus(hop2, [['client', 'a'], ['client', 'b'], ['p', GAME], ['p', GAME], ['t', 'x']])]))).toBeNull()
  })

  it('on a skipped action only A and the links are read: its own C, doubled, is its DECK\'s', () => {
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', C: at(1n), plane, tags: [['C', ZERO], ['proof', 'a'], ['proof', 'b']] })
    const chain = buildChain([spawn, hop1, wave])
    expect(chain[2].role).toBe('skipped')
    expect(firstBreak(chain)).toBeNull()
  })
})

describe('the three ride checks (approved 2026-10-08)', () => {
  const board = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'enter-hyperspace', c: hexAt(at(1n)), C: at(1n), plane, tags: [['proof', ZERO]] })
  const ride = (id: string, previousId: string, c: Position, to: Position, from: number, B: number, asOf?: number): NostrEvent => actionEvent({
    id, pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId, name: 'hyperjump', c: hexAt(c), C: to, plane,
    tags: [['from_height', String(from)], ['B', String(B)], ...(asOf !== undefined ? [['as_of', String(asOf)]] : []), ['proof', ZERO], ['mp', 'ab'], ['mn', '0'.repeat(16)]],
  })

  it('a first ride with as_of at or above B, and a later ride from the last B, are valid', () => {
    const r1 = ride(nextId(), board.id, at(1n), at(20n), 3, 5, 5)
    const r2 = ride(nextId(), r1.id, at(20n), at(30n), 5, 6)
    expect(firstBreak(buildChain([spawn, hop1, board, r1, r2]))).toBeNull()
  })

  it('a first ride with no as_of is broken (DECK-0001 §4.2, §4.3)', () => {
    const chain = buildChain([spawn, hop1, board, ride(nextId(), board.id, at(1n), at(20n), 3, 5)])
    expect(chain[3].breaks).toMatch(/^a first ride after boarding with no as_of tag\./)
    expect(chain[3].coordHex).toBe(hexAt(at(1n)))
  })

  it('a first ride whose as_of is below B is broken (DECK-0001 §4.2)', () => {
    expect(buildChain([spawn, hop1, board, ride(nextId(), board.id, at(1n), at(20n), 3, 5, 4)])[3].breaks).toMatch(/^a first ride whose as_of \(4\) is below the block it rides to \(5\)/)
  })

  it('a later ride that does not leave from the block the last ride reached is broken (DECK-0001 §4.3)', () => {
    const r1 = ride(nextId(), board.id, at(1n), at(20n), 3, 5, 5)
    const r2 = ride(nextId(), r1.id, at(20n), at(30n), 4, 6)
    expect(buildChain([spawn, hop1, board, r1, r2])[4].breaks).toMatch(/^a ride that leaves from block 4, but the ride before it stopped at block 5\./)
  })
})
