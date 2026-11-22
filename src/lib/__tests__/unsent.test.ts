/**
 * unsent.test.ts: the actions no relay has taken yet, kept as the chain grows
 * and its actions are taken, rather than read off the whole chain at every
 * change (owner's phone walk of 2026-11-21: a 2,600-action chain, several
 * such passes per WALK step, the CHAIN status count and the old-format check).
 *
 * What would go wrong silently: a count or a list that differs from reading
 * the whole chain.
 */
import { describe, expect, it } from 'vitest'
import { forgetUnsent, unsentOf } from '../unsent'
import { staleFormatCut } from '../staleFormat'
import type { NostrEvent } from '../events'

const ev = (n: number, tags: string[][] = [['A', 'hop'], ['mn', 'x'], ['mp', 'y']]): NostrEvent => ({ id: n.toString(16).padStart(64, '0'), pubkey: 'a'.repeat(64), created_at: n, kind: 3333, tags, content: '', sig: 'f'.repeat(128) })
const whole = (events: NostrEvent[], published: Record<string, string>) => events.filter((e) => published[e.id] !== 'ok')

describe('unsentOf', () => {
  it('matches reading the whole chain through a walk: landings, sends, acks, a fold that replaces the chain', () => {
    let events: NostrEvent[] = []
    let published: Record<string, string> = {}
    let n = 1
    for (let step = 0; step < 300; step++) {
      const r = (step * 7919) % 10
      if (r < 5) { const e = ev(n++); events = [...events, e]; published = { ...published, [e.id]: 'queued' } }
      else if (r < 8) { const first = whole(events, published)[0]; if (first) published = { ...published, [first.id]: r === 5 ? 'sending' : 'ok' } }
      else if (r === 8) { events = events.slice(); published = { ...published } }
      else { events = events.filter((_, i) => i % 13 !== 5) }
      expect(unsentOf(events, published).map((e) => e.id)).toEqual(whole(events, published).map((e) => e.id))
    }
  })

  it('a chain that grew by appended actions reads only the backlog and the new ones: the same array back for the same chain and map', () => {
    const events = [ev(1), ev(2)]
    const published = { [events[0].id]: 'ok', [events[1].id]: 'queued' }
    const a = unsentOf(events, published)
    expect(unsentOf(events, published)).toBe(a)
    expect(a.map((e) => e.created_at)).toEqual([2])
  })
})

describe('staleFormatCut from the unsent actions', () => {
  it('gives the same cut as reading the whole chain', () => {
    const stale = ev(4, [['A', 'hop']])
    const events = [ev(1), ev(2), ev(3), stale, ev(5)]
    const published: Record<string, string> = { [events[0].id]: 'ok', [events[1].id]: 'ok', [events[2].id]: 'queued', [stale.id]: 'queued', [events[4].id]: 'queued' }
    const sent = (id: string) => published[id] === 'ok'
    expect(staleFormatCut(events, sent, unsentOf(events, published))).toEqual(staleFormatCut(events, sent))
    expect(staleFormatCut(events, sent, unsentOf(events, published))?.at).toBe(3)
    // Nothing stale among the unsent: no cut, both ways.
    const clean = [ev(1), ev(2)]
    const p2 = { [clean[0].id]: 'ok', [clean[1].id]: 'queued' }
    expect(staleFormatCut(clean, (id) => p2[id] === 'ok', unsentOf(clean, p2))).toBeNull()
    expect(staleFormatCut(clean, (id) => p2[id] === 'ok')).toBeNull()
  })
})

describe('an ok action marked back (a fold of another tab\'s save, useCyberspace takeInStored)', () => {
  it('after forgetUnsent the answer is read off the whole chain again', () => {
    const events = [ev(901), ev(902)]
    const published: Record<string, string> = { [events[0].id]: 'ok', [events[1].id]: 'ok' }
    expect(unsentOf(events, published)).toEqual([])
    // The same array; a new map that marks one back.
    const back = { ...published, [events[1].id]: 'queued' }
    forgetUnsent()
    expect(unsentOf(events, back).map((e) => e.id)).toEqual([events[1].id])
  })
})
