/**
 * branchConflict.test.ts - unpublished moves against another device's
 * published ones from the same point: found, measured, and resolved the only
 * way a fork allows. A fork ends the whole chain (spec §8.7.3 rule 4;
 * arkinox, 2026-10-08), so no side of one ever wins, and this device's side
 * is never published.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as branchConflict from '../branchConflict'
import { findDivergence, foldBranchConflict, relayVersion } from '../branchConflict'
import { ACTION_KIND, buildChain, spawnTemplate, type NostrEvent } from '../events'

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

  it('finds the fork and both branches, and says nothing of a side that would win: none does', () => {
    const m1 = hop(0x20, h1.id, 120)
    const m2 = hop(0x21, m1.id, 121)
    const r1 = hop(0x30, h1.id, 125)
    const r2 = hop(0x31, r1.id, 126)
    const d = findDivergence([...shared, m1, m2], ok(spawn, h1), [spawn, h1, r1, r2])!
    expect(d.forkId).toBe(h1.id)
    expect(d.forkIndex).toBe(1)
    expect(d.local.map((a) => a.id)).toEqual([m1.id, m2.id])
    expect(d.relay.map((a) => a.id)).toEqual([r1.id, r2.id])
    expect('overrides' in d).toBe(false)
    expect('continuesOver' in branchConflict).toBe(false)
  })

  it('finds a fork made by a game client or an unknown action, not only by a hop (spec §8.9 rule 1)', () => {
    // A game client on the same identity entered a game from h1 while this
    // device had an unpublished hop from h1: publishing the hop would fork
    // the chain, as a second hop would.
    const m1 = hop(0x20, h1.id, 140)
    const enter: NostrEvent = {
      id: hex(0x40), pubkey: PK, created_at: 125, kind: ACTION_KIND, content: '', sig: '0'.repeat(128),
      tags: [['A', 'enter-virtual'], ['e', spawn.id, '', 'genesis'], ['e', h1.id, '', 'previous'], ['c', hex(0xaa + 0x10)], ['C', hex(0xaa + 0x10)], ['S', '0-0-0'], ['p', 'ab'.repeat(32), '', 'game']],
    }
    const wave: NostrEvent = { ...enter, id: hex(0x41), tags: [['A', 'wave'], ['e', spawn.id, '', 'genesis'], ['e', h1.id, '', 'previous']] }
    for (const theirs of [enter, wave]) {
      const d = findDivergence([...shared, m1], ok(spawn, h1), [theirs])!
      expect(d.forkId).toBe(h1.id)
      expect(d.relay.map((a) => a.id)).toEqual([theirs.id])
    }
  })

  it('finds the same divergence whichever side signed first, or in the same second: signing time decides nothing', () => {
    const r1 = hop(0x30, h1.id, 125)
    for (const at of [120, 125, 140]) {
      const m1 = hop(0x20, h1.id, at)
      const d = findDivergence([...shared, m1], ok(spawn, h1), [r1])!
      expect(d.forkId).toBe(h1.id)
      expect(d.local.map((a) => a.id)).toEqual([m1.id])
      expect(d.relay.map((a) => a.id)).toEqual([r1.id])
      // Publishing this device's side would make a fork, and the chain dead.
      expect(buildChain([...shared, m1, r1])[0].fork?.branchIds.sort()).toEqual([m1.id, r1.id].sort())
    }
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

  it('keeps every relay event when the relays already fork the chain: that chain is dead, and neither branch is dropped', () => {
    const m1 = hop(0x20, h1.id, 120)
    const r1 = hop(0x30, h1.id, 125)
    const r2a = hop(0x31, r1.id, 126)
    const r2b = hop(0x32, r1.id, 127)
    const d = findDivergence([...shared, m1], ok(spawn, h1), [r1, r2a, r2b])!
    const v = relayVersion([...shared, m1], [r1, r2a, r2b], d)
    expect(v.events.map((e) => e.id).sort()).toEqual([spawn.id, h1.id, r1.id, r2a.id, r2b.id].sort())
    expect(buildChain(v.events)[0].fork?.previousId).toBe(r1.id)
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

describe('nothing in ONOSENDAI teaches the older-branch rule', () => {
  it('no source file says a branch of a fork wins, continues the chain or overturns moves (spec §8.7.3 rule 4)', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const old = /older branch|older child|wins? (the|a) fork|overturn|earlier action continues|continues over/i
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) { if (name !== '__tests__') walk(path) }
        else if (/\.tsx?$/.test(name) && old.test(readFileSync(path, 'utf8'))) offenders.push(path)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
