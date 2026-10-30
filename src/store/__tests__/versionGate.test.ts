/**
 * versionGate.test.ts - the store under a deploy that requires newer chain
 * rules (lib/versionGate.ts; the owner's ruling of 2026-10-30).
 *
 * What would go wrong silently: a stale tab signing a hop, a ride or a
 * spawn in the old format after the cutover, because one path to a
 * kind 3333 did not ask; or a tab that can no longer sign anything at all,
 * chat and profiles included. fetch is a stub: nothing reaches the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => [],
  confirmChainEvents: async () => [],
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { ACTION_KIND } from '../../lib/events'
import { CHAIN_RULES_EPOCH, versionFileOf } from '../../lib/chainRulesEpoch'
import { OWN_BUILD, VERSION_BLOCKED_MESSAGE, checkVersion, resetVersionGateForTests, useVersionGate } from '../../lib/versionGate'
import { useCyberspace, whyNoMove } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()

let deployedEpoch = CHAIN_RULES_EPOCH
const fetchStub = vi.fn(async () => new Response(JSON.stringify(versionFileOf(OWN_BUILD, deployedEpoch)), { status: 200 }))

/** A finished hop proof one unit along x, as the worker would hand it over. */
async function land(): Promise<void> {
  const s = S()
  useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + 1n } })
  await s.applyProofMessage({
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, proofHash: 'ab'.repeat(32), hop: { sealHex: 'ab'.repeat(32), mnHex: '0'.repeat(16), mpHex: '00' },
    terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1,
  })
}

beforeEach(async () => {
  await placeSpawn()
  deployedEpoch = CHAIN_RULES_EPOCH
  fetchStub.mockClear()
  vi.stubGlobal('fetch', fetchStub)
  resetVersionGateForTests(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetVersionGateForTests(false)
})

describe('moving while the deploy requires the same chain epoch', () => {
  it('a hop lands as ever', async () => {
    const before = S().events.length
    await land()
    expect(S().events.length).toBe(before + 1)
    expect(whyNoMove(S().actions())).toBeNull()
    expect(fetchStub).toHaveBeenCalled()
  })
})

describe('moving while the deploy requires a newer chain epoch', () => {
  beforeEach(() => { deployedEpoch = CHAIN_RULES_EPOCH + 1 })

  it('every move is refused with the RELOAD words, once the deploy has said so', async () => {
    await checkVersion()
    expect(useVersionGate.getState().verdict).toBe('blocked')
    expect(whyNoMove(S().actions())).toBe(VERSION_BLOCKED_MESSAGE)
  })

  it('a COMMIT asks first, and is refused before any proof is computed', async () => {
    const before = S().events.length
    useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 1n } })
    await S().commit()
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toBe(VERSION_BLOCKED_MESSAGE)
    expect(S().events.length).toBe(before)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it('a finished proof is not signed: the last look before signing refuses it, though nothing had said so before', async () => {
    const before = S().events.length
    const head = S().prevEventId
    expect(useVersionGate.getState().verdict).toBe('ok')
    await land()
    expect(S().events.length).toBe(before)
    expect(S().prevEventId).toBe(head)
    expect(S().proof.message).toContain(VERSION_BLOCKED_MESSAGE)
    expect(useVersionGate.getState().verdict).toBe('blocked')
  })

  it('the store signer refuses any kind 3333 it is handed, whoever asks', async () => {
    const template = { kind: ACTION_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: '' }
    await expect(S().signEvent(template)).rejects.toThrow(VERSION_BLOCKED_MESSAGE)
  })

  it('a respawn is refused before anything is cleared: a kept HOSAKA job stays (review of #530)', async () => {
    const job = { version: 1, jobId: 'kept-job', costMsats: 21_000 } as unknown as NonNullable<ReturnType<typeof S>['cloud']['job']>
    useCyberspace.setState({ cloud: { ...S().cloud, job } })
    const events = S().events
    await expect(S().respawn()).rejects.toThrow(VERSION_BLOCKED_MESSAGE)
    expect(S().cloud.job).toBe(job)
    expect(S().events).toBe(events)
    expect(S().proof.message).toBe(VERSION_BLOCKED_MESSAGE)
    // Not after the refusal either: a broken chain's respawn adds no End of Chain entry first.
    await expect(S().respawnFromBrokenChain()).rejects.toThrow(VERSION_BLOCKED_MESSAGE)
    expect(S().cloud.job).toBe(job)
    useCyberspace.setState({ cloud: { ...S().cloud, job: null } })
  })

  it('everything else still signs: chat, profiles, reactions', async () => {
    const signed = await S().signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'still here' })
    expect(signed.kind).toBe(1)
    expect(signed.content).toBe('still here')
  })
})

describe('moving while the version file cannot be read', () => {
  it('an error never blocks: the hop lands', async () => {
    fetchStub.mockImplementation(async () => { throw new TypeError('fetch failed') })
    const before = S().events.length
    await land()
    expect(S().events.length).toBe(before + 1)
  })
})
