/**
 * checkAgainRetriesAuth.test.ts - CHECK AGAIN on a held chain is a deliberate
 * tap, as RETRY is: every relay whose AUTH the signer turned down or let run
 * out asks the signer again before the check (review of #570, F2). Without
 * it the check reused the dead AUTH, asked the signer nothing, and the panel
 * told the person to approve a prompt that was never shown.
 */

import { describe, expect, it, vi } from 'vitest'

const retried = vi.hoisted(() => [] as (string | undefined)[])
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  retryFailedAuth: (only?: string) => { retried.push(only) },
}))
vi.mock('../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chains')>()),
  askChainEvents: async () => [],
}))

import { recheckNow } from '../selfSync'
import { signerHeld } from '../authOpen'

describe('CHECK AGAIN', () => {
  it('asks the signer again for each relay it holds up, and only those', () => {
    signerHeld.add('wss://cyberspace.nostr1.com/')
    signerHeld.add('wss://mine.example/')
    recheckNow()
    signerHeld.clear()
    expect(retried.sort()).toEqual(['wss://cyberspace.nostr1.com/', 'wss://mine.example/'])
  })
})
