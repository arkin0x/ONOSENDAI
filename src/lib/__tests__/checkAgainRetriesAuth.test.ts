/**
 * checkAgainRetriesAuth.test.ts - the self-check through selfSync, as CHECK
 * AGAIN runs it (review of #570, F2, and its re-review):
 *
 * - a relay known to hold this chain, kept from being read by the signer,
 *   leaves the verdict unknown, never none, even when the canonical relay
 *   answered with nothing: check() passes the chain's holders to
 *   decideSelfCheck (P1c);
 * - CHECK AGAIN asks the signer again for the relays this chain lives on
 *   (the canonical relay and its known holders), and for no other: without
 *   it the check reused the dead AUTH, asked nothing, and the panel told the
 *   person to approve a prompt that was never shown.
 */

import { describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ retried: [] as (string | undefined)[], answers: [] as unknown[] }))
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  retryFailedAuth: (only?: string) => { net.retried.push(only) },
}))
vi.mock('../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chains')>()),
  askChainEvents: async () => net.answers,
}))

import { normalizeURL } from 'nostr-tools/utils'
import { recheckNow } from '../selfSync'
import { signerHeld } from '../authOpen'
import { noteChainHolders } from '../chainHolders'
import { AUTH_STALLED } from '../relayOutcome'
import { DEFAULT_RELAY } from '../../store/useRelays'
import { useCyberspace } from '../../store/useCyberspace'

const CANON = normalizeURL(DEFAULT_RELAY)
const HOLDER = 'wss://holder1c.example/'
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

describe('CHECK AGAIN', () => {
  it('asks the signer again for the canonical relay and this chain\'s known holders, and only those', () => {
    const me = useCyberspace.getState().identity.pubkey
    noteChainHolders(me, [HOLDER])
    signerHeld.add(CANON)
    signerHeld.add(HOLDER)
    signerHeld.add('wss://nos.lol/')
    net.retried.length = 0
    recheckNow()
    signerHeld.clear()
    expect(net.retried.sort()).toEqual([CANON, HOLDER].sort())
  })
})

describe('the self-check, through check()', () => {
  it('P1c: a known holder held by the signer leaves it unknown though the canonical relay answered with nothing', async () => {
    const me = useCyberspace.getState().identity.pubkey
    noteChainHolders(me, [HOLDER])
    net.answers = [
      { url: CANON, outcome: 'answered', events: [] },
      { url: HOLDER, outcome: 'refused', reason: AUTH_STALLED, events: [] },
    ]
    recheckNow()
    await settle()
    expect(useCyberspace.getState().selfCheck).toMatchObject({ pubkey: me, status: 'unknown' })
  })

  it('the same relay, never a holder of this chain, does not: none', async () => {
    const me = useCyberspace.getState().identity.pubkey
    net.answers = [
      { url: CANON, outcome: 'answered', events: [] },
      { url: 'wss://never.held.example/', outcome: 'refused', reason: AUTH_STALLED, events: [] },
    ]
    recheckNow()
    await settle()
    expect(useCyberspace.getState().selfCheck).toMatchObject({ pubkey: me, status: 'none' })
  })
})
