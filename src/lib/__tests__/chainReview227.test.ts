/**
 * chainReview227.test.ts - the review of #227: apologies that are true,
 * chains that are only their own author's, reasons that never print two
 * different coordinates the same, and an End of Chain that stays in RECENT.
 *
 * What would go wrong silently: an apology telling someone their action was
 * valid when signed, when it was signed after the rule took effect; another
 * key's validly signed newer spawn, served by a misbehaving relay, freezing
 * this identity (Q7); a reason that reads "it starts from …abc123, but the
 * chain stood at …abc123"; a frozen chain whose last event is a broken ride
 * reported as standing at a stop; and the way back to a frozen chain pushed
 * out of RECENT by three ordinary lookups.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** What every relay question answers in this file: whatever the test puts here. */
let relay: NostrEvent[] = []
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  query: async () => relay,
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import {
  BRACKET_RULES,
  PLANE_BIT_FIX_AT,
  RULINGS_2026_10_07,
  buildChain,
  firstBreak,
  newestSpawn,
  positionHex,
  shownApart,
  spawnTemplate,
  type NostrEvent,
} from '../events'
import { apologyFor, breakCause } from '../chainBreak'
import { fetchChainEvents } from '../chains'
import { lineStateOf } from '../hyperspace/ride'
import { rememberView, type RecentView } from '../viewAt'
import type { Position } from '../space'
import { actionEvent, enterVirtualEvent, hopEvent } from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)
const P1 = hexAt(at(1n))
const hop1 = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane })

/** A boarding at P1 and a zero-length ride after it, signed at `when`. */
function zeroRide(when: number): NostrEvent[] {
  const board = actionEvent({ pubkey: pk, createdAt: when - 10, genesisId: spawn.id, previousId: hop1.id, name: 'enter-hyperspace', c: P1, C: at(1n), plane, tags: [['proof', '0'.repeat(64)]] })
  const ride = actionEvent({
    pubkey: pk, createdAt: when, genesisId: spawn.id, previousId: board.id, name: 'hyperjump', c: P1, C: at(1n), plane,
    tags: [['from_height', '9'], ['B', '9'], ['as_of', '9'], ['proof', '0'.repeat(64)], ['mp', ''], ['mn', '0'.repeat(16)]],
  })
  return [board, ride]
}

describe('item 4: the apology is true, and says which ruling and when', () => {
  it('a 2026-10-07 rule: apologized for before it took effect, naming the ruling and the pending errata', () => {
    const a = buildChain([spawn, hop1, ...zeroRide(1_500)])[3]
    expect(a.breakSince).toEqual(RULINGS_2026_10_07)
    expect(a.breaks).toMatch(/per the 2026-10-07 ruling, spec errata pending/)
    const sorry = apologyFor(a)!
    expect(sorry).toMatch(/valid under the chain rules when it was signed/)
    expect(sorry).toMatch(/took effect on 2026-10-07, by arkinox's ruling of that day, folded into chain rules revision 2026-09-28-virtual-brackets \(the spec errata is pending\)/)
  })

  it('the same break signed after the rule took effect: the reason, and no apology', () => {
    const a = buildChain([spawn, hop1, ...zeroRide(RULINGS_2026_10_07.effectiveAt + 60)])[3]
    expect(a.breaks).toMatch(/zero-length ride/)
    expect(breakCause(a)).toBeNull()
    expect(apologyFor(a)).toBeNull()
  })

  it('a bracket rule dates from spec PR #44 merging, 2026-10-06, and is told so', () => {
    const elsewhere = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(at(40n)), inGame: at(40n), height: 8, game: 'ab'.repeat(32), plane })
    const a = buildChain([spawn, hop1, elsewhere])[2]
    expect(a.breakSince).toEqual(BRACKET_RULES)
    expect(apologyFor(a)).toMatch(/took effect on 2026-10-06, when spec PR #44 brought virtual brackets/)
    const late = { ...elsewhere, created_at: BRACKET_RULES.effectiveAt + 1 }
    expect(apologyFor(buildChain([spawn, hop1, late])[2])).toBeNull()
  })

  it('the plane-bit apology only for boardings signed before PR #225 shipped', () => {
    const p1 = { x: 11n, y: 22n, z: 33n }
    const hopIdea = hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: p1, plane: 1 })
    const board = (when: number): NostrEvent => actionEvent({ pubkey: pk, createdAt: when, genesisId: spawn.id, previousId: hopIdea.id, name: 'enter-hyperspace', c: positionHex(p1, 0), C: p1, plane: 0, tags: [['proof', '0'.repeat(64)]] })
    const before = buildChain([spawn, hopIdea, board(PLANE_BIT_FIX_AT - 60)])[2]
    expect(before.breakBug).toBe('plane-bit')
    expect(apologyFor(before)).toMatch(/ONOSENDAI caused this/)
    const after = buildChain([spawn, hopIdea, board(PLANE_BIT_FIX_AT + 60)])[2]
    expect(after.breakBug).toBe('plane-bit')
    expect(apologyFor(after)).toBeNull()
  })
})

describe("item 6: a chain is only its own author's events", () => {
  const other = generateSecretKey()
  /** Another key's validly signed spawn, newer than this identity's, as a misbehaving relay might serve it. */
  const foreignSpawn = finalizeEvent(spawnTemplate(getPublicKey(other), 5_000), other) as NostrEvent

  beforeEach(() => { relay = [] })

  it("buildChain for a pubkey passes over another key's newer spawn", () => {
    expect(newestSpawn([spawn, foreignSpawn], pk)?.id).toBe(spawn.id)
    expect(buildChain([spawn, hop1, foreignSpawn], pk).map((a) => a.id)).toEqual([spawn.id, hop1.id])
  })

  it("never follows another key's event that names this chain's spawn", () => {
    const intruder = finalizeEvent({ ...hopEvent({ pubkey: getPublicKey(other), createdAt: 1_005, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(9n), plane }), kind: 3333 }, other) as NostrEvent
    expect(buildChain([spawn, intruder, hop1]).map((a) => a.id)).toEqual([spawn.id, hop1.id])
  })

  it("the chain fetch keeps only the identity's own events, whatever the relay sends", async () => {
    relay = [spawn, hop1, foreignSpawn]
    const got = await fetchChainEvents(pk)
    expect(got.every((e) => e.pubkey === pk)).toBe(true)
    expect(buildChain(got).map((a) => a.id)).toEqual([spawn.id, hop1.id])
  })
})

describe('nits from the review', () => {
  it('two coordinates that share their last digits never print the same', () => {
    const a = '1'.repeat(30) + 'a' + '2'.repeat(33)
    const b = '1'.repeat(30) + 'b' + '2'.repeat(33)
    const [x, y] = shownApart(a, b)
    expect(x).not.toBe(y)
    expect(a.slice(-6)).toBe(b.slice(-6))
    // And the reason for a hop that starts elsewhere shows them apart too.
    const far = { ...at(1n), x: at(1n).x + (1n << 60n) }
    const stray = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hexAt(far), to: far, plane })
    const reason = buildChain([spawn, hop1, stray])[2].breaks!
    const [from, stood] = shownApart(hexAt(far), P1)
    expect(reason).toContain(`starts from ${from}`)
    expect(reason).toContain(`left you at ${stood}`)
  })

  it('a pair that differs only in the plane bit says so', () => {
    const p = { x: 11n, y: 22n, z: 33n }
    expect(shownApart(positionHex(p, 0), positionHex(p, 1))[0]).toMatch(/the same x, y and z in the other plane/)
  })

  it('"an enter-virtual", "an enter-hyperspace": the article fits the name', () => {
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: P1, inGame: at(1n), height: 8, game: 'ab'.repeat(32), plane })
    const boardInside = actionEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: enter.id, name: 'enter-hyperspace', c: P1, C: at(1n), plane, tags: [['proof', '0'.repeat(64)]] })
    expect(buildChain([spawn, hop1, enter, boardInside])[3].breaks).toMatch(/^an enter-hyperspace signed while you were inside a game/)
    const malformed = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, name: 'enter-virtual', c: P1, C: at(1n), plane })
    expect(buildChain([spawn, hop1, malformed])[2].breaks).toMatch(/^an enter-virtual that is missing a tag/)
  })

  it('a frozen chain whose last event is a broken ride is not standing at a stop', () => {
    const chain = buildChain([spawn, hop1, ...zeroRide(1_500)])
    expect(firstBreak(chain)?.index).toBe(3)
    expect(lineStateOf(chain)).toBeNull()
  })

  it('an End of Chain entry stays in RECENT through any number of lookups, and stays pinned when looked at again', () => {
    const end: RecentView = { input: P1, label: 'End of Chain abcd1234', plane: 0, pinned: true }
    let list = rememberView([], end)
    for (let i = 0; i < 5; i++) list = rememberView(list, { input: `${i}, ${i}, ${i}`, label: `place ${i}`, plane: 0 })
    expect(list.filter((r) => !r.pinned)).toHaveLength(3)
    expect(list.find((r) => r.input === P1)?.pinned).toBe(true)
    list = rememberView(list, { input: P1, label: 'End of Chain abcd1234', plane: 0 })
    expect(list[0]).toMatchObject({ input: P1, pinned: true })
  })
})
