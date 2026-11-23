/**
 * relayTrouble.test.ts - what a list shows when the canonical relay gave it
 * nothing (relay.ts troubleOf): only an answer from the canonical relay is
 * "nothing there". Its refusal for want of AUTH reads as a sign-in problem,
 * and its silence or another refusal as not reached; another relay's
 * trouble is not the list's (HIDDEN BAGS, 2026-11-04).
 */

import { describe, expect, it } from 'vitest'
import { normalizeURL } from 'nostr-tools/utils'
import { CYBERSPACE_RELAY, troubleOf } from '../relay'
import type { RelayAnswer } from '../relayOutcome'

const CANON = normalizeURL(CYBERSPACE_RELAY)
const OTHER = 'wss://other.example/'

describe('troubleOf', () => {
  it('is nothing when the canonical relay answered, even with nothing', () => {
    expect(troubleOf([{ url: CANON, outcome: 'answered', events: [] }])).toBeNull()
  })

  it('is a sign-in problem when the canonical relay wants AUTH', () => {
    expect(troubleOf([{ url: CANON, outcome: 'refused', reason: 'auth-required: you must auth', events: [] }])).toBe('auth')
  })

  it('is not reached when it never answered, or refused for another reason', () => {
    expect(troubleOf([{ url: CANON, outcome: 'unreachable', reason: 'no answer in time', events: [] }])).toBe('unreachable')
    expect(troubleOf([{ url: CANON, outcome: 'refused', reason: 'rate-limited: slow down', events: [] }])).toBe('unreachable')
  })

  it('looks only at the canonical relay', () => {
    const answers: RelayAnswer[] = [
      { url: CANON, outcome: 'answered', events: [] },
      { url: OTHER, outcome: 'refused', reason: 'auth-required: you must auth', events: [] },
    ]
    expect(troubleOf(answers)).toBeNull()
    expect(troubleOf([{ url: OTHER, outcome: 'unreachable', reason: 'down', events: [] }])).toBeNull()
  })
})
