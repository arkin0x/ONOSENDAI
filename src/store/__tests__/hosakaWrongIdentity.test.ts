/**
 * hosakaWrongIdentity.test.ts - a HOSAKA balance is only ever kept for the
 * identity that asked for it (identity-switch audit, 2026-11-19).
 *
 * HOSAKA answers a balance question for the key that signed it. The store
 * used to keep the answer under whoever was signed in when it came back, so
 * a switch while the question was out wrote one identity's balance into
 * another's: B's panel showed A's sats, and B's saved figure was A's until
 * the next check. Each answer is now kept for the identity that asked, and
 * shown only while it is signed in. The HOSAKA client is faked, and each
 * answer is held until the test has switched identity. No network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fake, storage } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  const fake = {
    apiUrl: 'http://fake',
    limits: vi.fn(), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), getJob: vi.fn(), startJob: vi.fn(),
    claimDeposit: vi.fn(), balance: vi.fn(), deposit: vi.fn(), waitForDeposit: vi.fn(), waitForJob: vi.fn(),
  }
  return { fake, storage }
})

vi.mock('../../lib/hosaka', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/hosaka')>()
  return { ...actual, createHosaka: () => fake }
})

import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { loadBalance, saveCloudDeposit } from '../../lib/cloud'
import type { HosakaDeposit, HosakaLimits } from '../../lib/hosaka'
import { useCyberspace } from '../useCyberspace'

const S = useCyberspace.getState
const LIMITS: HosakaLimits = { max_hop_height: 25, max_sidestep_height: 29, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 5e9, invoice_ttl_seconds: 3600, hop_proof_version: 2, hop_paused: false, hop_paused_reason: null }

/** A promise the test resolves by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const settledDeposit = (id: string, balance: number): HosakaDeposit => ({
  deposit_id: id, status: 'settled', amount_msats: 15000, bolt11: `lnbc-${id}`, payment_hash: 'h', created_at: 1,
  expires_at: Math.floor(Date.now() / 1000) + 3600, settled_at: 2, settled_msats: 15000, preimage: null, balance_msats: balance,
} as HosakaDeposit)

/** Sign in as a fresh key; its pubkey. */
async function signInFresh(): Promise<string> {
  const sk = generateSecretKey()
  await S().useNsec(nip19.nsecEncode(sk))
  return getPublicKey(sk)
}

beforeEach(async () => {
  for (const fn of Object.values(fake)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
  fake.claimDeposit.mockResolvedValue({ status: 'pending' })
  fake.limits.mockResolvedValue(LIMITS)
  fake.balance.mockResolvedValue({ pubkey: '', balance_msats: 0, ledger: [] })
  storage.removeItem('onosendai:hosakaBalance')
  useCyberspace.setState({ cloudPrefs: { mode: 'auto', autoMaxSats: 100, apiUrl: 'http://fake', profile: 'cost' } })
  await signInFresh()
})

describe('a switch of identity while HOSAKA answers a balance question', () => {
  it('BALANCE asked as A, answered after B signed in: B neither shows nor keeps A\'s figure', async () => {
    const answer = deferred<{ pubkey: string; balance_msats: number; ledger: [] }>()
    fake.balance.mockReturnValue(answer.promise)
    const a = S().identity.pubkey
    const asking = S().refreshBalance()
    const b = await signInFresh()
    answer.resolve({ pubkey: a, balance_msats: 7000, ledger: [] })
    await asking
    expect(S().identity.pubkey).toBe(b)
    expect(S().cloud.balance?.msats).not.toBe(7000)
    expect(loadBalance(b)?.msats).not.toBe(7000)
    // A's own figure is kept for A.
    expect(loadBalance(a)?.msats).toBe(7000)
    // B's panel is B's: A's late check does not end a check B has started.
    expect(S().cloud.balanceError).toBeNull()
  })

  it('a route deposit of A claimed at startup, answered after B signed in: B neither shows nor keeps A\'s figure', async () => {
    const a = S().identity.pubkey
    saveCloudDeposit({ depositId: 'dep-a', pubkey: a, amountMsats: 15000, expiresAt: Math.floor(Date.now() / 1000) + 3600, bolt11: 'lnbc-dep-a' })
    const answer = deferred<HosakaDeposit>()
    fake.claimDeposit.mockReturnValueOnce(answer.promise)
    const resuming = S().resumeCloudJob()
    const b = await signInFresh()
    answer.resolve(settledDeposit('dep-a', 22000))
    await resuming
    expect(S().identity.pubkey).toBe(b)
    expect(S().cloud.balance?.msats).not.toBe(22000)
    expect(loadBalance(b)?.msats).not.toBe(22000)
    expect(loadBalance(a)?.msats).toBe(22000)
    // A's credit is not announced on B's screen.
    expect(S().cloud.message ?? '').not.toMatch(/route deposit/)
    expect(S().cloud.credited).toBeFalsy()
  })

  it('TOP UP paid as A, settled after B signed in: B neither shows nor keeps A\'s figure', async () => {
    useCyberspace.setState({ cloud: { ...S().cloud, status: 'idle', limits: null } })
    fake.deposit.mockResolvedValue({ ...settledDeposit('dep-top', 0), status: 'pending', settled_at: null, settled_msats: null })
    const answer = deferred<HosakaDeposit>()
    fake.waitForDeposit.mockReturnValue(answer.promise)
    const paying = S().topUp(15)
    await vi.waitFor(() => { expect(fake.waitForDeposit).toHaveBeenCalled() })
    const b = await signInFresh()
    answer.resolve(settledDeposit('dep-top', 33000))
    await paying
    expect(S().identity.pubkey).toBe(b)
    expect(S().cloud.balance?.msats).not.toBe(33000)
    expect(loadBalance(b)?.msats).not.toBe(33000)
  })

  it('B\'s check in flight when A\'s late one comes back: B\'s stays checking', async () => {
    const late = deferred<{ pubkey: string; balance_msats: number; ledger: [] }>()
    fake.balance.mockReturnValueOnce(late.promise)
    const asking = S().refreshBalance()
    await signInFresh()
    const mine = deferred<{ pubkey: string; balance_msats: number; ledger: [] }>()
    fake.balance.mockReturnValueOnce(mine.promise)
    const bAsking = S().refreshBalance()
    expect(S().cloud.balanceChecking).toBe(true)
    late.resolve({ pubkey: '', balance_msats: 1000, ledger: [] })
    await asking
    expect(S().cloud.balanceChecking).toBe(true)
    mine.resolve({ pubkey: S().identity.pubkey, balance_msats: 2000, ledger: [] })
    await bAsking
    expect(S().cloud.balanceChecking).toBe(false)
    expect(S().cloud.balance?.msats).toBe(2000)
  })

  it('with no switch, the figure is shown and kept for the identity that asked', async () => {
    fake.balance.mockResolvedValue({ pubkey: S().identity.pubkey, balance_msats: 9000, ledger: [] })
    await S().refreshBalance()
    expect(S().cloud.balance?.msats).toBe(9000)
    expect(loadBalance(S().identity.pubkey)?.msats).toBe(9000)
  })
})
