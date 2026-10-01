/**
 * branchConflict.test.ts - unpublished moves against another device's
 * published ones from the same point: found, measured, and resolved by the
 * fork rule as it stands (older child continues, tie to the smaller id).
 */

import { describe, expect, it } from 'vitest'
import { continuesOver, findDivergence, foldBranchConflict, relayVersion } from './branchConflict'
import { ACTION_KIND, spawnTemplate, type NostrEvent } from './events'

const PK = 'cd'.repeat(32)
const hex = (n: number): string => n.toString(16).padStart(64, '0')
const spawn: NostrEvent = { ...spawnTemplate(PK, 100), id: hex(1), pubkey: PK, sig: '0'.repeat(128) }
function hop(id: number, prev: string, at: number, genesis = spawn.id): NostrEvent {
  return {
    id: hex(id), pubkey: PK, created_at: at, kind: ACTION_KIND, content: '', sig: '0'.repeat(128),
    tags: [['A', 'hop'], ['C', hex(0xaa + id)], ['c', PK], ['S', '0-0-0'], ['e', genesis, '', 'genesis'], ['e', prev, '', 'previous'], ['proof', hex(0xbeef)]],
  }
}

// The shared part: spawn and one hop, both published.
const h1 = hop(0x10, spawn.id, 110)
const shared = [spawn, h1]
const ok = (...evs: NostrEvent[]): Record<string, string> => Object.fromEntries(evs.map((e) => [e.id, 'ok']))

describe('finding a fork against unpublished moves', () => {
  it('finds none when every local move is published', () => {
    const mine = hop(0x20, h1.id, 130)
    expect(findDivergence([...shared, mine], ok(spawn, h1, mine), [hop(0x30, h1.id, 120)])).toBeNull()
  })

  it('finds none when the relays only extend the head', () => {
    expect(findDivergence(shared, ok(spawn, h1), [hop(0x30, h1.id, 120)])).toBeNull()
  })

  it('finds none for another chain of the same identity (a respawn is adoption, not a fork)', () => {
    const other: NostrEvent = { ...spawnTemplate(PK, 500), id: hex(2), pubkey: PK, sig: '0'.repeat(128) }
    const mine = hop(0x20, h1.id, 130)
    expect(findDivergence([...shared, mine], ok(spawn, h1), [other, hop(0x31, other.id, 510, other.id)])).toBeNull()
  })

  it('finds the fork, both branches, and that the older local move overrides', () => {
    const m1 = hop(0x20, h1.id, 120)
    const m2 = hop(0x21, m1.id, 121)
    const r1 = hop(0x30, h1.id, 125)
    const r2 = hop(0x31, r1.id, 126)
    const d = findDivergence([...shared, m1, m2], ok(spawn, h1), [spawn, h1, r1, r2])!
    expect(d.forkId).toBe(h1.id)
    expect(d.forkIndex).toBe(1)
    expect(d.local.map((a) => a.id)).toEqual([m1.id, m2.id])
    expect(d.relay.map((a) => a.id)).toEqual([r1.id, r2.id])
    expect(d.overrides).toBe(true)
  })

  it('says publishing would not override when the local move is the newer one', () => {
    const m1 = hop(0x20, h1.id, 140)
    const r1 = hop(0x30, h1.id, 125)
    expect(findDivergence([...shared, m1], ok(spawn, h1), [r1])!.overrides).toBe(false)
  })

  it('breaks a same-second tie on the smaller id, as the fork rule does', () => {
    expect(continuesOver({ createdAt: 5, id: 'a' }, { createdAt: 5, id: 'b' })).toBe(true)
    expect(continuesOver({ createdAt: 5, id: 'b' }, { createdAt: 5, id: 'a' })).toBe(false)
    const m1 = hop(0x20, h1.id, 125)
    const r1 = hop(0x30, h1.id, 125)
    expect(findDivergence([...shared, m1], ok(spawn, h1), [r1])!.overrides).toBe(true)
  })

  it('reports the earliest fork when the relays fork twice', () => {
    const m1 = hop(0x20, spawn.id, 105)
    const local = [spawn, m1, hop(0x21, m1.id, 106)]
    const d = findDivergence(local, ok(spawn), [hop(0x30, spawn.id, 107), hop(0x31, m1.id, 108)])!
    expect(d.forkId).toBe(spawn.id)
  })
})

describe('resolving it', () => {
  it('keeps the shared part and the relays\' branch for "the relay\'s version"', () => {
    const m1 = hop(0x20, h1.id, 120)
    const r1 = hop(0x30, h1.id, 125)
    const d = findDivergence([...shared, m1], ok(spawn, h1), [r1])!
    const v = relayVersion([...shared, m1], [r1], d)
    expect(v.events.map((e) => e.id)).toEqual([spawn.id, h1.id, r1.id])
    expect(v.onRelay.has(r1.id)).toBe(true)
  })

  it('grows a pending conflict with what arrives, and ignores what is nothing new', () => {
    const m1 = hop(0x20, h1.id, 120)
    const local = [...shared, m1]
    const r1 = hop(0x30, h1.id, 125)
    const c = foldBranchConflict(null, [r1], local, ok(spawn, h1), 1)!
    expect(c).toMatchObject({ kind: 'branch', forkId: h1.id, at: 1 })
    const grown = foldBranchConflict(c, [hop(0x31, r1.id, 126)], local, ok(spawn, h1), 2)!
    expect(grown.relayEvents).toHaveLength(2)
    expect(grown.at).toBe(1)
    expect(foldBranchConflict(grown, [r1], local, ok(spawn, h1), 3)).toBe(grown)
    expect(foldBranchConflict(null, [hop(0x40, m1.id, 130)], local, ok(spawn, h1), 1)).toBeNull()
  })
})
