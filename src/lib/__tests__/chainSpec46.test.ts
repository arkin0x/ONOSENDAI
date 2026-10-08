/**
 * chainSpec46.test.ts - the chain rules as spec PR #46 (commit 912f3d7,
 * merged 2026-10-08T04:04:00Z, 23:04 on 2026-10-07 at UTC-5) wrote them
 * down: arkinox's rulings of 2026-10-07 and the clarifications he gave while
 * it was open.
 *
 * What would go wrong silently: an event carrying two X tags, or two S tags,
 * reading as valid because only the first copy was ever looked at, so a
 * relay asked for one sector would find a move that also claims another
 * (spec §10); two A tags, even identical ones, slipping through on a move, a
 * skipped action or a game's own move (§8.8); an event with no A tag ending
 * the chain quietly as a gap, instead of breaking it where every other
 * verifier breaks it (§8.7.3); doubled sector tags on a game's own move or a
 * skipped action breaking a chain the bracket rules say nothing about
 * (§8.11.4 rule 4, §8.9); and a reason or an apology still saying the spec
 * errata is pending, after the spec carries the rule.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import {
  DUPLICATE_SECTOR_RULE,
  ONE_A_TAG_RULE,
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
import { actionEvent, enterVirtualEvent, exitVirtualEvent, hopEvent, nextId, regionAround, virtualEvent } from './chainFixtures'

const pk = getPublicKey(generateSecretKey())
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)
const GAME = 'ab'.repeat(32)

/** A spawn for this identity, signed at `createdAt`, with `tags` in place of its own when given. */
function spawnAt(createdAt: number, tags?: (own: string[][]) => string[][]): NostrEvent {
  const t = spawnTemplate(pk, createdAt)
  return { ...t, tags: tags ? tags(t.tags) : t.tags, id: nextId(), pubkey: pk, sig: '0'.repeat(128) }
}

/** The same event with more tags after its own. */
const plus = (ev: NostrEvent, extra: string[][]): NostrEvent => ({ ...ev, tags: [...ev.tags, ...extra] })

/** The value of an event's first tag of that name. */
const valueOf = (ev: NostrEvent, name: string): string => ev.tags.find((t) => t[0] === name)![1]

const spawn = spawnAt(1_000)
const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane })

describe('each sector tag exactly once (spec §10, clarified by spec PR #46)', () => {
  it('a hop carrying a second X tag is broken, even when both copies say the same', () => {
    const hop = plus(hop1, [['X', valueOf(hop1, 'X')]])
    const chain = buildChain([spawn, hop])
    expect(chain[1].breaks).toMatch(/^a hop carrying two X tags\. Each sector tag has to appear exactly once/)
    expect(chain[1].breaks).toMatch(/\(spec §10, as clarified by spec PR #46\)$/)
    expect(chain[1].breakSince).toEqual(DUPLICATE_SECTOR_RULE)
    expect(firstBreak(chain)?.index).toBe(1)
    // Frozen at the last valid position: the spawn, not the hop's C.
    expect(chain[1].coordHex).toBe(pk)
    expect(chain[1].declared?.coordHex).toBe(hexAt(at(1n)))
  })

  it('a hop carrying a second S tag is broken for the copy, whatever the copy says', () => {
    const hop = plus(hop1, [['S', '1-2-3']])
    expect(buildChain([spawn, hop])[1].breaks).toMatch(/^a hop carrying two S tags\./)
  })

  it('several doubled tags are all named', () => {
    const hop = plus(hop1, [['X', valueOf(hop1, 'X')], ['S', valueOf(hop1, 'S')], ['S', valueOf(hop1, 'S')]])
    expect(buildChain([spawn, hop])[1].breaks).toMatch(/^a hop carrying two X tags and three S tags\./)
  })

  it('the newest spawn with a doubled S tag is broken at the spawn coordinate, with no fallback to the older one (Q7)', () => {
    const newer = spawnAt(2_000, (own) => [...own, ['S', own.find((t) => t[0] === 'S')![1]]])
    const chain = buildChain([spawn, hop1, newer])
    expect(chain.map((a) => a.id)).toEqual([newer.id])
    expect(chain[0].role).toBe('broken')
    expect(chain[0].breaks).toMatch(/^a spawn carrying two S tags\./)
    expect(chain[0].breakSince).toEqual(DUPLICATE_SECTOR_RULE)
    expect(chain[0].coordHex).toBe(pk)
  })

  it("names its day in arkinox's time zone, as every other rule does: #46 merged at 23:04 on 2026-10-07 at UTC-5", () => {
    expect(DUPLICATE_SECTOR_RULE.effectiveAt).toBe(Date.parse('2026-10-08T04:04:00Z') / 1000)
    const atUtcMinus5 = new Date((DUPLICATE_SECTOR_RULE.effectiveAt - 5 * 3600) * 1000).toISOString().slice(0, 10)
    expect(DUPLICATE_SECTOR_RULE.since).toBe(atUtcMinus5)
    expect(DUPLICATE_SECTOR_RULE.since).toBe('2026-10-07')
  })

  it('is apologized for when signed before spec PR #46 merged, and not after', () => {
    const before = buildChain([spawn, plus(hop1, [['X', valueOf(hop1, 'X')]])])[1]
    expect(apologyFor(before)).toMatch(/gained additional validation on 2026-10-07, when spec PR #46 merged with arkinox's clarifications in it, into chain rules revision 2026-09-28-virtual-brackets/)
    const t = DUPLICATE_SECTOR_RULE.effectiveAt + 60
    const lateSpawn = spawnAt(t)
    const lateHop = hopEvent({ pubkey: pk, createdAt: t + 10, genesisId: lateSpawn.id, previousId: lateSpawn.id, c: pk, to: at(1n), plane })
    const after = buildChain([lateSpawn, plus(lateHop, [['X', valueOf(lateHop, 'X')]])])[1]
    expect(after.breaks).toMatch(/two X tags/)
    expect(apologyFor(after)).toBeNull()
  })
})

describe('exactly one A tag on every event (spec §8.8, Q5)', () => {
  it('two identical A tags on a hop break the chain there, and the row still says it is a hop', () => {
    const hop = plus(hop1, [['A', 'hop']])
    const chain = buildChain([spawn, hop])
    expect(chain[1].breaks).toMatch(/^an event carrying two A tags \(hop, hop\)\. Every event on a chain has to carry exactly one A tag, even when the copies agree/)
    expect(chain[1].breaks).toMatch(/\(spec §8\.8\)$/)
    expect(chain[1].breakSince).toEqual(ONE_A_TAG_RULE)
    expect(chain[1].role).toBe('base')
    expect(actionLabel(chain[1])).toBe('BROKEN · HOP')
    expect(chain[1].coordHex).toBe(pk)
  })

  it('a skipped action is checked for its A tags too, and nothing else (Q6)', () => {
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', tags: [['X', '1'], ['X', '1']] })
    const ok = buildChain([spawn, hop1, wave])[2]
    expect(ok.role).toBe('skipped')
    expect(ok.breaks).toBeUndefined()
    const doubled = buildChain([spawn, hop1, plus(wave, [['A', 'wave']])])[2]
    expect(doubled.role).toBe('broken')
    expect(doubled.breaks).toMatch(/two A tags \(wave, wave\)/)
    expect(actionLabel(doubled)).toBe('BROKEN · WAVE')
  })

  it('a spawn with two A tags is broken at the spawn coordinate, with no fallback (Q7)', () => {
    const newer = spawnAt(2_000, (own) => [['A', 'spawn'], ...own])
    const chain = buildChain([spawn, hop1, newer])
    expect(chain.map((a) => a.id)).toEqual([newer.id])
    expect(chain[0].role).toBe('broken')
    expect(chain[0].breaks).toMatch(/two A tags \(spawn, spawn\)/)
    expect(chain[0].breakSince).toEqual(ONE_A_TAG_RULE)
    expect(chain[0].coordHex).toBe(pk)
  })

  it('an event carrying ["A", "spawn"] after another A tag is still the newest spawn, and broken (§8.7.3 rule 1)', () => {
    const newer = spawnAt(2_000, (own) => [['A', 'hop'], ...own])
    expect(newestSpawn([spawn, hop1, newer], pk)?.id).toBe(newer.id)
    const chain = buildChain([spawn, hop1, newer])
    expect(chain[0].id).toBe(newer.id)
    expect(chain[0].breaks).toMatch(/two A tags \(hop, spawn\)/)
  })

  it('inside a bracket, a game move or an exit with two A tags is broken (§8.11.4 rule 4, §8.11.5)', () => {
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: at(1n), height: 8, game: GAME, plane })
    const move = virtualEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, name: 'castle' })
    const fine = buildChain([spawn, hop1, enter, move])[3]
    expect(fine.role).toBe('virtual')
    expect(fine.breaks).toBeUndefined()
    const doubled = buildChain([spawn, hop1, enter, plus(move, [['A', 'castle']])])[3]
    // Still the game's move, so the row says so, and broken for the second tag.
    expect(doubled.role).toBe('virtual')
    expect(actionLabel(doubled)).toBe('BROKEN · GAME · CASTLE')
    expect(doubled.bracketId).toBe(enter.id)
    expect(doubled.breaks).toMatch(/two A tags \(castle, castle\)/)
    const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_040, genesisId: spawn.id, previousId: move.id, entryId: enter.id, restore: at(1n), plane })
    expect(buildChain([spawn, hop1, enter, move, exit])[4].breaks).toBeUndefined()
    const badExit = buildChain([spawn, hop1, enter, move, plus(exit, [['A', 'exit-virtual']])])[4]
    expect(badExit.breaks).toMatch(/two A tags \(exit-virtual, exit-virtual\)/)
    expect(badExit.breakSince).toEqual(ONE_A_TAG_RULE)
  })

  it('an enter-virtual with two A tags still opens its bracket, so the game moves after it read as the game', () => {
    const enter = plus(enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: at(1n), height: 8, game: GAME, plane }), [['A', 'enter-virtual']])
    const move = virtualEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, name: 'castle' })
    const chain = buildChain([spawn, hop1, enter, move])
    expect(chain[2].role).toBe('enter')
    expect(chain[2].breaks).toMatch(/two A tags/)
    expect(chain[3].role).toBe('virtual')
  })
})

describe('an event with no A tag (spec §8.8, §8.7.3)', () => {
  const noA: NostrEvent = { ...hop1, id: nextId(), tags: hop1.tags.filter((t) => t[0] !== 'A') }

  it('is on the chain and breaks it there, instead of being a gap the chain quietly ends at', () => {
    const chain = buildChain([spawn, noA])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, noA.id])
    expect(chain[1].role).toBe('broken')
    expect(chain[1].breaks).toMatch(/^an event on your chain with no A tag, so it names no action at all\./)
    expect(chain[1].breakSince).toEqual(ONE_A_TAG_RULE)
    expect(actionLabel(chain[1])).toBe('BROKEN')
  })

  it('wins a fork over a later valid branch, because a fork is decided before validity (§8.7.3)', () => {
    const later = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(2n), plane })
    const chain = buildChain([spawn, later, noA])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, noA.id])
    expect(firstBreak(chain)?.index).toBe(1)
  })
})

describe('doubled sector tags inside a bracket follow the bracket rules (§8.11.4 rule 4)', () => {
  const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: at(1n), height: 8, game: GAME, plane })

  it('an enter-virtual carrying a second S tag is broken: its sector tags count (§8.11.1)', () => {
    const doubled = buildChain([spawn, hop1, plus(enter, [['S', valueOf(enter, 'S')]])])[2]
    expect(doubled.role).toBe('enter')
    expect(doubled.breaks).toMatch(/^an entry into a game carrying two S tags\./)
    expect(doubled.breakSince).toEqual(DUPLICATE_SECTOR_RULE)
  })

  it("a game's own move with doubled sector tags is not read, so it breaks nothing", () => {
    const move = virtualEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, name: 'castle', c: hexAt(at(1n)), inGame: at(5n), plane })
    const doubled = plus(move, [['X', '7'], ['S', '7-7-7'], ['S', '8-8-8']])
    const chain = buildChain([spawn, hop1, enter, doubled])
    expect(chain[3].role).toBe('virtual')
    expect(firstBreak(chain)).toBeNull()
  })

  it('an exit-virtual carrying a second X tag is broken: its sector tags count (§8.11.3)', () => {
    const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_040, genesisId: spawn.id, previousId: enter.id, entryId: enter.id, restore: at(1n), plane })
    const doubled = buildChain([spawn, hop1, enter, plus(exit, [['X', valueOf(exit, 'X')]])])[3]
    expect(doubled.role).toBe('exit')
    expect(doubled.breaks).toMatch(/^an exit from a game carrying two X tags\./)
  })

  it('a skipped action with doubled sector tags breaks nothing: its tags are its DECK\'s (§8.9)', () => {
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'wave', C: at(1n), plane, tags: [['X', '0'], ['S', '0-0-0']] })
    const chain = buildChain([spawn, hop1, wave])
    expect(chain[2].role).toBe('skipped')
    expect(firstBreak(chain)).toBeNull()
  })
})

describe('the rest of #46, as checked', () => {
  it('a fork is decided by signing time before validity: an earlier branch with wrong sector tags beats a later valid one (§8.7.3)', () => {
    const early = { ...hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane }) }
    const wrong: NostrEvent = { ...early, tags: early.tags.map((t) => (t[0] === 'S' ? ['S', '9-9-9'] : t)) }
    const later = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(2n), plane })
    const chain = buildChain([spawn, later, wrong])
    expect(chain.map((a) => a.id)).toEqual([spawn.id, wrong.id])
    expect(chain[1].breaks).toMatch(/sector tags do not agree/)
  })

  it('a game region far from where the identity stands breaks nothing: proximity is the game\'s (§8.11.1)', () => {
    const far = regionAround(at(1n << 60n), 8)
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(1n)), inGame: far, regionBase: far, height: 8, game: GAME, plane })
    const chain = buildChain([spawn, hop1, enter])
    expect(chain[2].role).toBe('enter')
    expect(firstBreak(chain)).toBeNull()
  })
})

describe('no reason or apology says the spec errata is pending', () => {
  it('no source file says so, now that spec PR #46 carries every rule', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const self = fileURLToPath(import.meta.url)
    const pending = /errata (is )?pending/i
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name) && path !== self && pending.test(readFileSync(path, 'utf8'))) offenders.push(path)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
