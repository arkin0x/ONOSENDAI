import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyHopLevel1 } from 'cyberspace-core'
import { activeIn, bestChainLength, chainLength, dropUnlistedV1Hops, keyChains, respawnCount, spawnsOf } from '../countingRules'
import type { NostrEvent } from '../events'
import { loadV1HopList } from '../v1HopList'
import { GRANDFATHERED_V1_HOPS as GUARD } from '../v1HopListGuard'
import raw from './vectors/unlisted-v1-hops.json'

// The real events of the two identities whose only hop failed the census 1
// audit (grandfathered-v1-hops.txt): a spawn and one h24 hop each, 2026-09-03.
const events = raw as NostrEvent[]
const KEYS = [...new Set(events.map((e) => e.pubkey))]
const hopOf = (pk: string): NostrEvent => events.find((e) => e.pubkey === pk && e.tags.some((t) => t[0] === 'A' && t[1] === 'hop'))!
const LISTED_HOP = 'a11938c376d8b53032d9a704a3db3fc1d82add779c164fe589f922889a88ab9f'

describe('the version 1 hop list, loaded lazily', () => {
  it('is the census, from its own chunk', async () => {
    const list = await loadV1HopList()
    expect(list.size).toBeGreaterThanOrEqual(2658)
    expect(list.has(LISTED_HOP)).toBe(true)
    for (const pk of KEYS) expect(list.has(hopOf(pk).id)).toBe(false)
    expect(await loadV1HopList()).toBe(list)
  })

  it('the guard throws when read, and never answers', () => {
    expect(() => GUARD.has(LISTED_HOP)).toThrow(/explicit `grandfathered`/)
    expect(() => GUARD.size).toThrow(/explicit `grandfathered`/)
  })

  it('every call in the app passes its own list, because in a build the default is the guard', () => {
    const calls: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'fixtures') walk(path)
        } else if (/\.tsx?$/.test(e.name)) {
          const text = readFileSync(path, 'utf8')
          if (/isGrandfatheredV1Hop\(/.test(text)) throw new Error(`${path} reads the guard through isGrandfatheredV1Hop`)
          for (const m of text.matchAll(/verifyHopLevel1\(/g)) {
            // The claim is the object literal right after the call.
            calls.push(path)
            expect(text.slice(m.index, text.indexOf('\n    }', m.index)), path).toMatch(/grandfathered:/)
          }
        }
      }
    }
    walk('src')
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('a listed hop is accepted through the real list, and not through an empty one', async () => {
    const list = await loadV1HopList()
    const claim = {
      from: { x: 1n, y: 2n, z: 3n, plane: 0 as const }, to: { x: 2n, y: 2n, z: 3n, plane: 0 as const }, previousEventIdHex: 'ab'.repeat(32),
      proof: 'cd'.repeat(32), nonce: null, openings: null, eventId: LISTED_HOP,
    }
    expect(verifyHopLevel1({ ...claim, grandfathered: list })).toEqual([])
    expect(verifyHopLevel1({ ...claim, grandfathered: new Set() })).toEqual(['form:mn', 'form:mp'])
  })
})

describe('dropUnlistedV1Hops', () => {
  it('without it, the failed hops count: the counting rules check no proof', () => {
    for (const pk of KEYS) {
      expect(chainLength(events, pk)).toBe(2)
      expect(bestChainLength(events, pk)).toBe(2)
    }
  })

  it('takes the failed hops off every chain rule, and the spawn still stands', async () => {
    const kept = dropUnlistedV1Hops(events, await loadV1HopList())
    expect(kept).toHaveLength(events.length - KEYS.length)
    for (const pk of KEYS) {
      const hop = hopOf(pk)
      expect(chainLength(kept, pk)).toBe(1)
      expect(bestChainLength(kept, pk)).toBe(1)
      expect(spawnsOf(kept, pk)).toHaveLength(1)
      expect(respawnCount(kept, pk)).toBe(0)
      // Active in the minute of the spawn, not in a window holding only the hop.
      const spawn = spawnsOf(kept, pk)[0].created_at
      expect(spawn).toBeLessThan(hop.created_at)
      expect(activeIn(events, pk, spawn, hop.created_at)).toBe(true)
      expect(activeIn(kept, pk, spawn, hop.created_at)).toBe(false)
      expect(keyChains(kept, pk).chainLength).toBe(1)
    }
  })

  it('ends a chain at the event before the hop: nothing after it counts', async () => {
    const pk = KEYS[0]
    const hop = hopOf(pk)
    const next: NostrEvent = {
      ...hop,
      id: 'ee'.repeat(32),
      created_at: hop.created_at + 1,
      tags: hop.tags.map((t) => (t[0] === 'e' && t[3] === 'previous' ? [t[0], hop.id, t[2], t[3]] : t)).concat([['mn', '00'.repeat(8)], ['mp', 'ab']]),
    }
    const kept = dropUnlistedV1Hops([...events, next], new Set())
    expect(kept.some((e) => e.id === next.id)).toBe(true) // it carries mn and mp, so this does not touch it
    expect(chainLength(kept, pk)).toBe(1)
  })

  it('leaves everything else alone: listed hops, hops with mn or mp, spawns, other kinds and actions', () => {
    const hop = hopOf(KEYS[0])
    const withMn = { ...hop, id: '01'.repeat(32), tags: [...hop.tags, ['mn', '00'.repeat(8)]] }
    const withMp = { ...hop, id: '02'.repeat(32), tags: [...hop.tags, ['mp', 'ab']] }
    const other = { ...hop, id: '03'.repeat(32), kind: 1 }
    const sidestep = { ...hop, id: '04'.repeat(32), tags: hop.tags.map((t) => (t[0] === 'A' ? ['A', 'sidestep'] : t)) }
    const spawn = events.find((e) => e.pubkey === KEYS[0] && e.id !== hop.id)!
    const input = [withMn, withMp, other, sidestep, spawn, hop]
    expect(dropUnlistedV1Hops(input, new Set([hop.id]))).toEqual(input)
    expect(dropUnlistedV1Hops(input, new Set())).toEqual(input.slice(0, 5))
  })
})
