/**
 * sectorTags.test.ts - sector tags are part of validity (arkinox, 2026-10-07,
 * Q9).
 *
 * On every recognized base action (spawn, hop, sidestep, enter-hyperspace,
 * hyperjump, enter-virtual, exit-virtual) the X, Y, Z and S tags of spec §10
 * are required and must be exactly what sectorTags computes from the
 * action's C; for an entry into a game and an exit from one, C is the real
 * position P. Missing or mismatched, the action is BROKEN and the chain is
 * dead from it. Never asked of a game's own actions (Q2) or of an action
 * this client does not recognize.
 *
 * What would go wrong silently: a move whose tags put it in another sector,
 * so the relays index it where it is not and nobody nearby ever sees it,
 * read as valid; or a game's tagless moves read as broken, which would
 * freeze every player of a game that does not tag its moves.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { SECTOR_TAG_RULE, buildChain, chainHead, firstBreak, positionHex, sectorTags, spawnTemplate, type NostrEvent } from '../events'
import { apologyFor, apologyHeading, breakCause } from '../chainBreak'
import type { Position } from '../space'
import { actionEvent, enterVirtualEvent, exitVirtualEvent, hopEvent, virtualEvent } from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)
const P1 = hexAt(at(1n))
const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane })

/** An event with one tag replaced, or removed when `value` is null. */
function retag(ev: NostrEvent, name: string, value: string | null): NostrEvent {
  const tags = value === null ? ev.tags.filter((t) => t[0] !== name) : ev.tags.map((t) => (t[0] === name ? [name, value] : t))
  return { ...ev, tags }
}

/** A sector number one more than it should be. */
const bump = (v: string): string => (BigInt(v) + 1n).toString()

describe('Q9: sector tags are required on every recognized base action and must match its C', () => {
  it('correct tags are valid', () => {
    expect(firstBreak(buildChain([spawn, hop1]))).toBeNull()
    const want = Object.fromEntries(sectorTags(at(1n)))
    for (const k of ['X', 'Y', 'Z', 'S']) expect(hop1.tags.find((t) => t[0] === k)?.[1]).toBe(want[k])
  })

  it('a missing tag breaks the action, whichever tag it is, and the chain freezes before it', () => {
    for (const k of ['X', 'Y', 'Z', 'S']) {
      const bad = retag(hop1, k, null)
      const chain = buildChain([spawn, bad])
      expect(firstBreak(chain)?.index, k).toBe(1)
      expect(chain[1].breaks).toContain(`without its sector tag ${k}`)
      expect(chain[1].breakSince).toEqual(SECTOR_TAG_RULE)
      expect(chainHead(chain)?.coordHex).toBe(pk)
    }
  })

  it('a wrong X, Y or Z breaks it, and so does a wrong S', () => {
    for (const k of ['X', 'Y', 'Z']) {
      const v = hop1.tags.find((t) => t[0] === k)![1]
      const chain = buildChain([spawn, retag(hop1, k, bump(v))])
      expect(firstBreak(chain)?.index, k).toBe(1)
      expect(chain[1].breaks).toContain(`${k} says ${bump(v)} where its coordinate is in ${v}`)
    }
    const chain = buildChain([spawn, retag(hop1, 'S', '1-2-3')])
    expect(firstBreak(chain)?.index).toBe(1)
    expect(chain[1].breaks).toMatch(/S says 1-2-3/)
  })

  it('a spawn with a wrong sector tag is dead from row 0, at the spawn coordinate', () => {
    const bad = finalizeEvent({ kind: 3333, created_at: 1_000, content: '', tags: [['A', 'spawn'], ['C', pk], ...sectorTags(home).map((t) => (t[0] === 'X' ? ['X', bump(t[1])] : t))] }, sk) as NostrEvent
    const chain = buildChain([bad, { ...hop1, tags: hop1.tags.map((t) => (t[3] === 'genesis' || t[3] === 'previous' ? [t[0], bad.id, '', t[3]] : t)) }])
    expect(firstBreak(chain)?.index).toBe(0)
    expect(chain[0].breaks).toMatch(/sector tags do not agree/)
    expect(chainHead(chain)?.coordHex).toBe(pk)
  })

  it("an entry into a game and an exit from one are checked against P, their real position", () => {
    const arena: Position = { x: (5n << 40n) + 300n, y: (7n << 40n) + 20n, z: (9n << 40n) + 3n }
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: arena, height: 8, game: 'ab'.repeat(32), plane })
    const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, entryId: enter.id, restore: at(1n), plane })
    expect(firstBreak(buildChain([spawn, hop1, enter, exit]))).toBeNull()
    // Tagged with the sector of the place in the game instead of P: broken.
    const arenaTags = sectorTags(arena)
    const enterInGame = { ...enter, tags: enter.tags.filter((t) => !['X', 'Y', 'Z', 'S'].includes(t[0])).concat(arenaTags) }
    expect(firstBreak(buildChain([spawn, hop1, enterInGame]))?.index).toBe(2)
    const exitInGame = { ...exit, tags: exit.tags.filter((t) => !['X', 'Y', 'Z', 'S'].includes(t[0])).concat(arenaTags) }
    const chain = buildChain([spawn, hop1, enter, exitInGame])
    expect(firstBreak(chain)?.index).toBe(3)
    expect(chain[3].breaks).toMatch(/exit from a game whose sector tags/)
  })

  it("a game's own actions without sector tags are fine (Q2)", () => {
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: at(1n), height: 8, game: 'ab'.repeat(32), plane })
    const bare = virtualEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: enter.id, name: 'move' })
    const tagged = virtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: bare.id, name: 'move', c: P1, inGame: at(3n), plane })
    const wrongTags = retag(tagged, 'X', '12345')
    expect(firstBreak(buildChain([spawn, hop1, enter, bare, wrongTags]))).toBeNull()
  })

  it('an action this client does not recognize, with wrong sector tags, is skipped, not broken', () => {
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', c: P1, C: at(1n), plane, tags: [] })
    const chain = buildChain([spawn, hop1, retag(retag(wave, 'X', '1'), 'S', '9-9-9')])
    expect(chain[2].role).toBe('skipped')
    expect(firstBreak(chain)).toBeNull()
  })

  it('a break of it, signed before 2026-10-07, is apologized for as added validation', () => {
    const a = buildChain([spawn, retag(hop1, 'Z', null)])[1]
    expect(breakCause(a)).toEqual({ kind: 'spec-change', rule: SECTOR_TAG_RULE })
    expect(apologyHeading(breakCause(a)!)).toBe('The rules gained additional validation after this was signed.')
    expect(apologyFor(a)).toMatch(/gained additional validation on 2026-10-07, by arkinox's ruling of that day/)
  })

  it('one signed after the rule took effect gets the reason and no apology', () => {
    const late = 1_791_400_000 // 2026-10-07T19:06:40Z
    const lateHop = { ...retag(hop1, 'Z', null), created_at: late }
    const a = buildChain([spawn, lateHop])[1]
    expect(a.breaks).toMatch(/without its sector tag Z/)
    expect(apologyFor(a)).toBeNull()
  })
})
