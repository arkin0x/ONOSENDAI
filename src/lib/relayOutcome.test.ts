/**
 * relayOutcome.test.ts - a relay's refusal is told apart from a dropped
 * connection, and every event any relay sent is kept once.
 */

import { describe, expect, it } from 'vitest'
import { classifyClose, isRefusal, mergeAnswers } from './relayOutcome'
import type { NostrEvent } from './events'

const ev = (id: string): NostrEvent => ({ id, pubkey: 'p', created_at: 1, kind: 3333, tags: [], content: '', sig: 's' })

describe('a closed subscription', () => {
  it('is a refusal when the relay gave a NIP-01 reason', () => {
    for (const r of ['auth-required: sign in', 'restricted: members only', 'blocked: no', 'rate-limited: slow down', 'error: oops', 'invalid: bad filter']) {
      expect(isRefusal(r)).toBe(true)
      expect(classifyClose('wss://r', r, [])).toEqual({ url: 'wss://r', outcome: 'refused', reason: r, events: [] })
    }
  })

  it('is the connection when the reason is ours or the pool\'s', () => {
    for (const r of ['relay connection closed', 'relay connection closed by us', 'closed by caller', 'pingpong timed out', 'connection failed']) {
      expect(isRefusal(r)).toBe(false)
      expect(classifyClose('wss://r', r, []).outcome).toBe('unreachable')
    }
    expect(classifyClose('wss://r', '', [])).toMatchObject({ outcome: 'unreachable', reason: 'connection closed' })
  })

  it('keeps the events that arrived before it ended', () => {
    expect(classifyClose('wss://r', 'restricted: x', [ev('a')]).events).toEqual([ev('a')])
  })
})

describe('merging answers', () => {
  it('keeps every event once, in arrival order', () => {
    expect(mergeAnswers([
      { url: 'a', outcome: 'answered', events: [ev('1'), ev('2')] },
      { url: 'b', outcome: 'unreachable', reason: 'x', events: [ev('2'), ev('3')] },
    ]).map((e) => e.id)).toEqual(['1', '2', '3'])
  })
})
