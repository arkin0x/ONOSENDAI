/**
 * chainRulings.test.ts - arkinox's rulings of 2026-10-07 on three chain-rule
 * questions, folded into chain rules revision 2026-09-28-virtual-brackets.
 *
 * Q1: no zero-length ride, ever. A ride whose destination block is the block
 * it starts from is BROKEN, and the rule is marked as one a spec change
 * introduced, because such a ride was valid when it was made.
 *
 * Q2: a virtual bracket is opaque to the base protocol. Inside one only the
 * links and the names are read: a game's actions may carry any c and C, or
 * none. The entry must start where the chain stood and not move (C equals
 * c); the exit must name the entry and put the identity back at the entry's
 * c, whatever its own c.
 *
 * Q3: an invalid chain stands at its last valid position, frozen until a
 * respawn, and a break that is not the person's doing is apologized for.
 *
 * Q7: the newest spawn wins even when it is invalid. There is no fallback to
 * an older spawn: the chain is dead from the spawn row, and the identity
 * stands at its spawn coordinate, since no event of the chain is valid.
 *
 * What would go wrong silently: a zero-length ride read as a valid move; a
 * game's moves marked BROKEN for coordinates the game is entitled to choose,
 * which freezes a player who did nothing wrong; an identity drawn where its
 * broken actions claim to go; and an apology owed and not given, or given
 * where none is owed.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import {
  CHAIN_RULES_REVISION,
  buildChain,
  chainHead,
  firstBreak,
  hyperjumpTemplate,
  openBracket,
  positionHex,
  spawnTemplate,
  type NostrEvent,
} from '../events'
import { apologyFor, breakCause, endOfChainLabel } from '../chainBreak'
import { newestSpawnId } from '../chains'
import type { Position } from '../space'
import { actionEvent, enterVirtualEvent, exitVirtualEvent, hopEvent, virtualEvent } from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const GAME = 'ab'.repeat(32)

const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)

const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane })
const P1 = hexAt(at(1n))
const arena: Position = { x: (5n << 40n) + 300n, y: (7n << 40n) + 20n, z: (9n << 40n) + 3n }
const inArena = (dx: bigint): Position => ({ ...arena, x: arena.x + dx })

/** A boarding at P1, then a ride from `from` to `to`, landing at `C`. */
function boardAndRide(from: number, to: number, C: Position = at(1n)): NostrEvent[] {
  const board = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'enter-hyperspace', c: P1, C: at(1n), plane, tags: [['proof', '0'.repeat(64)]] })
  const ride = actionEvent({
    pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: board.id, name: 'hyperjump', c: P1, C, plane,
    tags: [['from_height', String(from)], ['B', String(to)], ['as_of', String(Math.max(from, to))], ['proof', '0'.repeat(64)], ['mp', ''], ['mn', '0'.repeat(16)]],
  })
  return [board, ride]
}

describe('Q1: no zero-length rides, ever', () => {
  it('a zero-length ride in a chain is BROKEN, says so, and is flagged as a rule from a spec change', () => {
    const [board, ride] = boardAndRide(840_000, 840_000)
    const chain = buildChain([spawn, hop1, board, ride])
    expect(chain[3].type).toBe('hyperjump')
    expect(chain[3].breaks).toMatch(/zero-length ride/)
    expect(chain[3].breakSince).toBe(CHAIN_RULES_REVISION)
    expect(firstBreak(chain)?.index).toBe(3)
  })

  it('a ride to a different block is not', () => {
    const [board, ride] = boardAndRide(840_000, 840_001)
    expect(firstBreak(buildChain([spawn, hop1, board, ride]))).toBeNull()
  })

  it('the template refuses to build one, so nothing can sign one', () => {
    const input = { createdAt: 1, genesisId: '0'.repeat(64), previousId: '0'.repeat(64), prevCoordHex: P1, toCoordHex: P1, rootHex: '0'.repeat(64), mp: '', mnHex: '0'.repeat(16) }
    expect(() => hyperjumpTemplate({ ...input, fromHeight: 5, toHeight: 5 })).toThrow(/zero-length/)
    expect(() => hyperjumpTemplate({ ...input, fromHeight: 5, toHeight: 6 })).not.toThrow()
  })
})

describe('Q2: a virtual bracket is opaque to the base protocol', () => {
  const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: inArena(0n), height: 8, game: GAME, plane })

  it('game events with arbitrary or missing c and C are not broken, inside or outside the region, and hold the position at P', () => {
    const wild = virtualEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: enter.id, name: 'move', c: 'ef'.repeat(32), inGame: { x: 1n, y: 2n, z: 3n }, plane })
    const bare = virtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: wild.id, name: 'think' })
    const jump = virtualEvent({ pubkey: pk, createdAt: 1_023, genesisId: spawn.id, previousId: bare.id, name: 'move', c: hexAt(inArena(77n)), inGame: { ...arena, x: arena.x + (1n << 20n) }, plane })
    const chain = buildChain([spawn, hop1, enter, wild, bare, jump])
    expect(chain.map((a) => a.role)).toEqual(['base', 'base', 'enter', 'virtual', 'virtual', 'virtual'])
    expect(firstBreak(chain)).toBeNull()
    for (const a of chain.slice(2)) expect(a.coordHex).toBe(P1)
    expect(chainHead(chain)?.position).toEqual(at(1n))
    // The game's own places are kept for the pink line; the bare one has none.
    expect(chain.slice(3).map((a) => a.declared?.position)).toEqual([{ x: 1n, y: 2n, z: 3n }, undefined, { ...arena, x: arena.x + (1n << 20n) }])
  })

  it("the exit's c is not checked: arbitrary or missing, it closes the bracket and continuity resumes from its C", () => {
    const move = virtualEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: enter.id, name: 'move', c: hexAt(inArena(0n)), inGame: inArena(5n), plane })
    for (const c of ['12'.repeat(32), undefined]) {
      const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: move.id, entryId: enter.id, c, restore: at(1n), plane })
      const hop2 = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: exit.id, c: P1, to: at(2n), plane })
      const chain = buildChain([spawn, hop1, enter, move, exit, hop2])
      expect(chain.map((a) => a.role)).toEqual(['base', 'base', 'enter', 'virtual', 'exit', 'base'])
      expect(firstBreak(chain)).toBeNull()
      expect(openBracket(chain)).toBeNull()
      expect(chainHead(chain)?.position).toEqual(at(2n))
    }
  })

  it('an exit that does not put the identity back at P is still broken', () => {
    const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: enter.id, entryId: enter.id, restore: at(9n), plane })
    const chain = buildChain([spawn, hop1, enter, exit])
    expect(chain[3].role).toBe('broken')
    expect(chain[3].breakSince).toBe(CHAIN_RULES_REVISION)
  })

  it('an enter-virtual whose C is not its c is BROKEN, flagged as a spec-change rule, and moves nobody', () => {
    const moving = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, C: inArena(0n), inGame: inArena(0n), height: 8, game: GAME, plane })
    const chain = buildChain([spawn, hop1, moving])
    expect(chain[2].role).toBe('enter')
    expect(chain[2].breaks).toMatch(/does not move you/)
    expect(chain[2].breakSince).toBe(CHAIN_RULES_REVISION)
    expect(chainHead(chain)?.position).toEqual(at(1n))
  })

  it('an enter-virtual whose c breaks continuity is BROKEN, flagged as a spec-change rule', () => {
    const elsewhere = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(40n)), inGame: inArena(0n), height: 8, game: GAME, plane })
    const chain = buildChain([spawn, hop1, elsewhere])
    expect(chain[2].breaks).toMatch(/starts from/)
    expect(chain[2].breakSince).toBe(CHAIN_RULES_REVISION)
    // Frozen at P1, not at the place it entered from.
    expect(chainHead(chain)?.position).toEqual(at(1n))
  })
})

describe('Q3: an invalid chain stands at its last valid position, frozen until respawn', () => {
  it("the identity stands at the C of the last event before the first broken one, not the broken event's claimed C", () => {
    const stray = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(7n)), to: at(8n), plane })
    // A later hop that follows on from the broken one, as its author meant.
    const onward = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: stray.id, c: hexAt(at(8n)), to: at(9n), plane })
    const chain = buildChain([spawn, hop1, stray, onward])
    const broken = firstBreak(chain)!
    expect(broken.index).toBe(2)
    expect(broken.lastValid?.id).toBe(hop1.id)
    expect(chainHead(chain)?.id).toBe(onward.id)
    expect(chainHead(chain)?.coordHex).toBe(P1)
    expect(chainHead(chain)?.position).toEqual(at(1n))
    // What each one claimed is kept apart, and the trail of positions stops at P1.
    expect(chain[3].declared?.position).toEqual(at(9n))
    expect(chain.map((a) => a.position)).toEqual([at(0n), at(1n), at(1n), at(1n)])
    // A row after the break is judged on what it did itself: it followed on correctly.
    expect(chain[3].breaks).toBeUndefined()
  })

  it('the End of Chain label is the first eight hex of the last valid event', () => {
    expect(endOfChainLabel(hop1.id)).toBe(`End of Chain ${hop1.id.slice(0, 8)}`)
  })

  describe('the apology is chosen by what caused the break', () => {
    it('a rule a spec change introduced: the zero-length ride and the enter-virtual refinement', () => {
      const [board, ride] = boardAndRide(9, 9)
      const zero = buildChain([spawn, hop1, board, ride])[3]
      expect(breakCause(zero)).toEqual({ kind: 'spec-change', revision: CHAIN_RULES_REVISION })
      expect(apologyFor(zero)).toMatch(/sorry/i)
      expect(apologyFor(zero)).toMatch(/valid under the chain rules when it was signed/)
      const moving = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, C: inArena(0n), inGame: inArena(0n), height: 8, game: GAME, plane })
      expect(breakCause(buildChain([spawn, hop1, moving])[2])?.kind).toBe('spec-change')
    })

    it('the plane-bit boarding fixed in PR #225: ONOSENDAI caused it, and says so', () => {
      const p1 = { x: 11n, y: 22n, z: 33n }
      const hopIdea = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: p1, plane: 1 })
      const board = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hopIdea.id, name: 'enter-hyperspace', c: positionHex(p1, 0), C: p1, plane: 0, tags: [['proof', '0'.repeat(64)]] })
      const a = buildChain([spawn, hopIdea, board])[2]
      expect(a.breakBug).toBe('plane-bit')
      expect(breakCause(a)).toEqual({ kind: 'onosendai-bug', bug: 'plane-bit' })
      expect(apologyFor(a)).toMatch(/ONOSENDAI caused this, not you/)
    })

    it('a boarding from a different x, y or z is not the plane-bit bug, and an old rule is owed no apology', () => {
      const board = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'enter-hyperspace', c: hexAt(at(5n)), C: at(5n), plane, tags: [['proof', '0'.repeat(64)]] })
      const a = buildChain([spawn, hop1, board])[2]
      expect(a.breaks).toBeDefined()
      expect(a.breakBug).toBeUndefined()
      expect(a.breakSince).toBeUndefined()
      expect(apologyFor(a)).toBeNull()
      // A hop that starts elsewhere is an old rule too.
      const stray = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(7n)), to: at(8n), plane })
      expect(apologyFor(buildChain([spawn, hop1, stray])[2])).toBeNull()
    })

    it('a known bug comes before a spec change when both are marked', () => {
      expect(breakCause({ breakBug: 'plane-bit', breakSince: CHAIN_RULES_REVISION })?.kind).toBe('onosendai-bug')
    })
  })
})

describe('Q7: an invalid newest spawn wins, dead, with no fallback to an older spawn', () => {
  /** A newer spawn signed by the same key whose C is not the key's coordinate. */
  const badSpawn = finalizeEvent({
    kind: 3333, created_at: 2_000, content: '',
    tags: [['A', 'spawn'], ['C', hexAt(at(500n))], ['S', '0-0-0']],
  }, sk) as NostrEvent
  /** One that names no C at all. */
  const bareSpawn = finalizeEvent({ kind: 3333, created_at: 2_000, content: '', tags: [['A', 'spawn']] }, sk) as NostrEvent

  it('a valid older chain plus a newer invalid spawn resolves to the newer spawn, broken at row 0, at the spawn coordinate', () => {
    const chain = buildChain([spawn, hop1, badSpawn])
    expect(chain.map((a) => a.id)).toEqual([badSpawn.id])
    expect(chain[0]).toMatchObject({ role: 'broken', name: 'spawn' })
    expect(chain[0].breaks).toMatch(/not the coordinate your public key decodes to/)
    expect(chain[0].coordHex).toBe(pk)
    expect(chain[0].position).toEqual(at(0n))
    expect(chain[0].declared?.position).toEqual(at(500n))
    const broken = firstBreak(chain)!
    expect(broken.index).toBe(0)
    expect(broken.lastValid).toBeNull()
    // A spawn rule is as old as spawns: no apology is owed.
    expect(apologyFor(broken.action)).toBeNull()
    // The fetch asks for the newer spawn's chain, never the older one's.
    expect(newestSpawnId([spawn, hop1, badSpawn])).toBe(badSpawn.id)
  })

  it('a malformed newest spawn is dead too, and what follows it stays frozen at the spawn coordinate', () => {
    const after = hopEvent({ pubkey: pk, createdAt: 2_010, genesisId: bareSpawn.id, previousId: bareSpawn.id, c: pk, to: at(3n), plane })
    const chain = buildChain([spawn, hop1, bareSpawn, after])
    expect(chain.map((a) => a.id)).toEqual([bareSpawn.id, after.id])
    expect(chain[0].breaks).toMatch(/missing a tag/)
    expect(chainHead(chain)?.position).toEqual(at(0n))
    expect(firstBreak(chain)?.index).toBe(0)
  })
})
