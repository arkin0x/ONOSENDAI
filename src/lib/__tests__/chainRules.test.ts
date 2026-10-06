/**
 * chainRules.test.ts - resolving a chain under the 2026-09-28-virtual-brackets
 * chain rules (cyberspace spec §8.7.3, §8.9, §8.11, §8.12).
 *
 * What would go wrong silently: the chain stopping before the first action
 * this client does not recognize, so the head goes stale and the next move
 * forks from an earlier point and loses to the older branch; a skipped
 * action's own C taken as the position; a game's in-game coordinates taken
 * as where the identity is; and rules that look back stopping at a bracket
 * or a skipped action instead of seeing through it.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import {
  actionLabel,
  actionLink,
  buildChain,
  chainHead,
  lookBack,
  openBracket,
  parseAction,
  positionHex,
  spawnTemplate,
  type NostrEvent,
} from '../events'
import type { Position } from '../space'
import {
  actionEvent,
  enterVirtualEvent,
  exitVirtualEvent,
  hopEvent,
  nextId,
  regionAround,
  virtualEvent,
} from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const GAME = 'ab'.repeat(32)

const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)

/** spawn -> hop1 (+1). Every case builds on this. */
const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane })
const P1 = hexAt(at(1n))

/** A place far from home for a game to be played in: its own aligned cube of height 8. */
const arena: Position = { x: (5n << 40n) + 300n, y: (7n << 40n) + 20n, z: (9n << 40n) + 3n }
const inArena = (dx: bigint): Position => ({ ...arena, x: arena.x + dx })

describe('actions this client does not recognize are skipped (§8.9)', () => {
  it('follows the links through an unknown action and keeps going after it', () => {
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', c: P1, C: at(1n), plane })
    const hop2 = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: wave.id, c: P1, to: at(2n), plane })
    const chain = buildChain([hop2, wave, spawn, hop1])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, hop1.id, wave.id, hop2.id])
    expect(chain[2]).toMatchObject({ type: 'other', name: 'wave', role: 'skipped' })
    expect(chain[3]).toMatchObject({ type: 'hop', role: 'base' })
    expect(chainHead(chain)?.position).toEqual(at(2n))
  })

  it('a chain that ends on unknown actions is at the last recognized C, not theirs', () => {
    // The unknown action claims a different C: a teleport no verifier can
    // check (§8.9 rule 2), so the position does not follow it.
    const flag = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'flag', c: P1, C: at(99n), plane })
    const mark = actionEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: flag.id, name: 'mark' })
    const chain = buildChain([spawn, hop1, flag, mark])
    const head = chainHead(chain)!
    expect(head.id).toBe(mark.id)
    expect(head.coordHex).toBe(P1)
    expect(head.position).toEqual(at(1n))
    // What the unknown action itself said is kept, apart.
    expect(chain[2].declared?.position).toEqual(at(99n))
  })

  it('an unknown action with no C at all is still a link', () => {
    const bare = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'nod' })
    const hop2 = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: bare.id, c: P1, to: at(3n), plane })
    expect(buildChain([spawn, hop1, bare, hop2]).map((a) => a.id)).toEqual([spawn.id, hop1.id, bare.id, hop2.id])
  })

  it('a recognized action that will not parse is broken, followed, and moves nobody', () => {
    const noProof = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'hop', c: P1, C: at(50n), plane })
    const chain = buildChain([spawn, hop1, noProof])
    expect(chain[2]).toMatchObject({ type: 'other', role: 'broken', name: 'hop' })
    expect(chainHead(chain)?.position).toEqual(at(1n))
  })

  it('parseAction alone still refuses an unknown action, and actionLink still reads its links', () => {
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', c: P1, C: at(1n), plane })
    expect(parseAction(wave)).toBeNull()
    expect(actionLink(wave)).toMatchObject({ name: 'wave', genesisId: spawn.id, previousId: hop1.id })
    // A spawn names no previous event, wherever it is published.
    expect(actionLink(spawn)).toBeNull()
  })

  it('still ignores an unknown action that names another genesis', () => {
    const stray = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: 'f'.repeat(64), previousId: hop1.id, name: 'wave' })
    expect(buildChain([spawn, hop1, stray]).map((a) => a.id)).toEqual([spawn.id, hop1.id])
  })

  it('takes the older branch at a fork whose branches are unknown actions', () => {
    const early = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', id: nextId() })
    const late = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: hop1.id, c: P1, to: at(2n), plane })
    expect(chainHead(buildChain([spawn, hop1, late, early]))?.id).toBe(early.id)
  })
})

describe('virtual brackets (§8.11)', () => {
  const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: inArena(0n), height: 8, game: GAME, plane })
  const IN0 = positionHex(inArena(0n), plane)
  const move1 = virtualEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: enter.id, name: 'move', c: IN0, inGame: inArena(5n), plane })
  const IN1 = positionHex(inArena(5n), plane)
  const move2 = virtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: move1.id, name: 'capture', c: IN1, inGame: inArena(9n), plane })
  const IN2 = positionHex(inArena(9n), plane)
  const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_023, genesisId: spawn.id, previousId: move2.id, entryId: enter.id, c: IN2, restore: at(1n), plane })

  it('parses an enter-virtual: held at its c, in the game at its C, with its game and region', () => {
    const a = parseAction(enter)!
    expect(a).toMatchObject({ type: 'enter-virtual', role: 'enter', coordHex: P1, game: { pubkey: GAME, relayHint: '' } })
    expect(a.position).toEqual(at(1n))
    expect(a.declared?.position).toEqual(inArena(0n))
    expect(a.region).toMatchObject({ height: 8, base: regionAround(arena, 8), plane })
  })

  it('holds the position at the entry c for every action inside, and draws the game apart', () => {
    const chain = buildChain([spawn, hop1, enter, move1, move2])
    expect(chain.map((a) => a.role)).toEqual(['base', 'base', 'enter', 'virtual', 'virtual'])
    for (const a of chain.slice(2)) {
      expect(a.coordHex).toBe(P1)
      expect(a.bracketId).toBe(enter.id)
    }
    expect(chain.slice(2).map((a) => a.declared?.position)).toEqual([inArena(0n), inArena(5n), inArena(9n)])
    expect(actionLabel(chain[4])).toBe('GAME · CAPTURE')
  })

  it('a chain may end inside a bracket: the head is the last game move, the position the entry c (rule 7)', () => {
    const chain = buildChain([spawn, hop1, enter, move1])
    expect(chainHead(chain)?.id).toBe(move1.id)
    expect(chainHead(chain)?.position).toEqual(at(1n))
    expect(openBracket(chain)?.id).toBe(enter.id)
  })

  it('the exit closes the bracket and restores the position; the next hop continues from it (rule 2)', () => {
    const hop2 = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: exit.id, c: P1, to: at(2n), plane })
    const chain = buildChain([spawn, hop1, enter, move1, move2, exit, hop2])
    expect(chain.map((a) => a.role)).toEqual(['base', 'base', 'enter', 'virtual', 'virtual', 'exit', 'base'])
    expect(chain[5].position).toEqual(at(1n))
    expect(openBracket(chain)).toBeNull()
    expect(openBracket(chain, 4)?.id).toBe(enter.id)
    expect(chainHead(chain)?.position).toEqual(at(2n))
  })

  it('a base action inside a bracket is broken, moves nobody, and leaves the bracket open (rule 3)', () => {
    const hopInside = hopEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: move1.id, c: IN1, to: inArena(6n), plane })
    const chain = buildChain([spawn, hop1, enter, move1, hopInside])
    expect(chain[4]).toMatchObject({ role: 'broken', name: 'hop', type: 'other', bracketId: enter.id })
    expect(chainHead(chain)?.position).toEqual(at(1n))
    expect(openBracket(chain)?.id).toBe(enter.id)
  })

  it('a game move outside the region is broken (rule 4)', () => {
    const away = virtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: move1.id, name: 'move', c: IN1, inGame: { ...arena, x: arena.x + (1n << 20n) }, plane })
    expect(buildChain([spawn, hop1, enter, move1, away])[4].role).toBe('broken')
  })

  it('an exit naming the wrong entry, or putting the identity anywhere else, closes nothing (rules 2 and 6)', () => {
    const wrongEntry = exitVirtualEvent({ pubkey: pk, createdAt: 1_023, genesisId: spawn.id, previousId: move2.id, entryId: 'e'.repeat(64), c: IN2, restore: at(1n), plane })
    const wrongPlace = exitVirtualEvent({ pubkey: pk, createdAt: 1_023, genesisId: spawn.id, previousId: move2.id, entryId: enter.id, c: IN2, restore: at(7n), plane })
    for (const bad of [wrongEntry, wrongPlace]) {
      const chain = buildChain([spawn, hop1, enter, move1, move2, bad])
      expect(chain[5].role).toBe('broken')
      expect(openBracket(chain)?.id).toBe(enter.id)
      expect(chainHead(chain)?.position).toEqual(at(1n))
    }
  })

  it('an exit with no bracket open is broken (rule 6)', () => {
    const loose = exitVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, entryId: 'e'.repeat(64), c: P1, restore: at(1n), plane })
    expect(buildChain([spawn, hop1, loose])[2].role).toBe('broken')
  })

  it('a respawn starts a new chain even with a bracket open', () => {
    const respawn = finalizeEvent(spawnTemplate(pk, 2_000), sk) as NostrEvent
    const chain = buildChain([spawn, hop1, enter, move1, respawn])
    expect(chain.map((a) => a.id)).toEqual([respawn.id])
    expect(openBracket(chain)).toBeNull()
  })

  describe('the enter-virtual form check (§8.11.1, §8.11.5)', () => {
    const base = { pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: inArena(0n), height: 8, game: GAME, plane }
    it('wants exactly one p tag marked game, 64 lowercase hex', () => {
      expect(parseAction(enterVirtualEvent({ ...base, pTags: [] }))).toBeNull()
      expect(parseAction(enterVirtualEvent({ ...base, pTags: [['p', GAME, '', 'game'], ['p', 'cd'.repeat(32), '', 'game']] }))).toBeNull()
      expect(parseAction(enterVirtualEvent({ ...base, pTags: [['p', GAME.toUpperCase(), '', 'game']] }))).toBeNull()
      expect(parseAction(enterVirtualEvent({ ...base, pTags: [['p', GAME.slice(2), '', 'game']] }))).toBeNull()
      // Another p tag without the game marker is not the game's.
      expect(parseAction(enterVirtualEvent({ ...base, pTags: [['p', GAME, 'wss://relay.example', 'game'], ['p', 'cd'.repeat(32)]] }))?.game)
        .toEqual({ pubkey: GAME, relayHint: 'wss://relay.example' })
    })
    it('wants an aligned region with a canonical height, and the entry inside it', () => {
      expect(parseAction(enterVirtualEvent({ ...base, regionBase: inArena(1n) }))).toBeNull()
      expect(parseAction(enterVirtualEvent({ ...base, regionBase: regionAround({ ...arena, x: arena.x + (1n << 12n) }, 8) }))).toBeNull()
      const raw = enterVirtualEvent(base)
      const withH = (h: string): NostrEvent => ({ ...raw, tags: raw.tags.map((t) => (t[0] === 'region' ? [t[0], t[1], h] : t)) })
      expect(parseAction(withH('08'))).toBeNull()
      expect(parseAction(withH('86'))).toBeNull()
    })
    it('a malformed enter is broken and opens no bracket: what follows it is skipped', () => {
      const bad = enterVirtualEvent({ ...base, pTags: [] })
      const after = virtualEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: bad.id, name: 'move', c: IN0, inGame: inArena(5n), plane })
      const chain = buildChain([spawn, hop1, bad, after])
      expect(chain.map((a) => a.role)).toEqual(['base', 'base', 'broken', 'skipped'])
      expect(openBracket(chain)).toBeNull()
    })
  })
})

describe('rules that look back see through skipped actions and brackets (§8.9 rule 4, §8.11.4 rule 8)', () => {
  const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: inArena(0n), height: 8, game: GAME, plane })
  const IN0 = positionHex(inArena(0n), plane)
  const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_023, genesisId: spawn.id, previousId: enter.id, entryId: enter.id, c: IN0, restore: at(1n), plane })
  const wave = actionEvent({ pubkey: pk, createdAt: 1_024, genesisId: spawn.id, previousId: exit.id, name: 'wave' })

  it('an exit stands for the action before its entry, and a skipped action is passed over', () => {
    const chain = buildChain([spawn, hop1, enter, exit, wave])
    expect(chain.map((a) => a.role)).toEqual(['base', 'base', 'enter', 'exit', 'skipped'])
    expect(lookBack(chain, chain.length)?.id).toBe(hop1.id)
    expect(lookBack(chain, 4)?.id).toBe(hop1.id)
    // Inside a bracket, the bracket's entry is what came before.
    expect(lookBack(chain, 3)?.id).toBe(enter.id)
    expect(lookBack(chain, 1)?.id).toBe(spawn.id)
    expect(lookBack(chain, 0)).toBeNull()
  })
})
