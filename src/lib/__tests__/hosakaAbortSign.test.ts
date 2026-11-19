/**
 * hosakaAbortSign.test.ts - a HOSAKA request whose flow has ended asks the
 * signer for nothing (identity-switch audit, 2026-11-19).
 *
 * A switch of identity ends the cloud flow by aborting its signal. Two ways
 * past that: a request signed its NIP-98 authorization before it looked at
 * the signal, so an ended flow still asked the identity signed in now to sign
 * for the old one's job; and the paid job's START went out with no signal at
 * all, so it was signed by the new identity and sent for the old identity's
 * job. Fetch and the signer are scripted. No network.
 */

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { EventTemplate, NostrEvent } from '../events'
import { createHosaka, HosakaError, type HosakaClient, type HosakaDeposit, type HosakaJob } from '../hosaka'
import { driveCloudJob, wirePosition, type PendingCloudJob } from '../cloud'

const sk = generateSecretKey()

describe('a HOSAKA request under a signal already aborted', () => {
  it('is refused before the signer is asked, and nothing is sent', async () => {
    const sign = vi.fn((t: EventTemplate): Promise<NostrEvent> => Promise.resolve(finalizeEvent(t, sk) as unknown as NostrEvent))
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const client = createHosaka({ apiUrl: 'https://hosaka.test', sign, fetch: fetchFn as unknown as typeof fetch })
    const ended = new AbortController()
    ended.abort()
    for (const asked of [client.startJob('job-1', ended.signal), client.balance(ended.signal), client.deposit(5000, ended.signal)]) {
      const err = await asked.then(() => null, (e: unknown) => e)
      expect(err).toBeInstanceOf(HosakaError)
      expect((err as HosakaError).code).toBe('aborted')
    }
    expect(sign).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('a paid job started by driveCloudJob', () => {
  it('starts under the flow\'s signal, so ending the flow ends the start too', async () => {
    const reject = (): never => { throw new Error('unexpected call') }
    const seen: (AbortSignal | undefined)[] = []
    const job: HosakaJob = { id: 'job-1', status: 'completed', cost_msats: 1000, result: null, error: null }
    const client: HosakaClient = {
      apiUrl: 'http://fake',
      limits: reject, quote: reject, submitHop: reject, submitSidestep: reject, submitRegionKey: reject, rideQuote: reject, submitRide: reject, getJob: reject, balance: reject, deposit: reject,
      claimDeposit: reject, waitForJob: reject,
      waitForDeposit: async (id) => ({ deposit_id: id, status: 'settled' } as HosakaDeposit),
      startJob: async (_id, signal) => { seen.push(signal); return job },
    }
    const record: PendingCloudJob = {
      version: 1, jobId: 'job-1', pollToken: 'tok', action: 'hop', pubkey: 'p', from: wirePosition({ x: 0n, y: 0n, z: 0n }), to: wirePosition({ x: 4104n, y: 0n, z: 0n }),
      plane: 0, prevEventId: 'ab'.repeat(32), costMsats: 1000, createdAt: 0, stage: 'paid', deposit: null,
    }
    const flow = new AbortController()
    await driveCloudJob(client, record, { onStage: () => {}, onRecord: () => {} }, flow.signal)
    expect(seen).toEqual([flow.signal])
  })
})
