import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const calls: { deposits: number[]; waits: string[] } = { deposits: [], waits: [] }
let settleAs: 'settled' | 'expired' = 'settled'

vi.mock('../lib/hosaka', async () => {
  const actual = await vi.importActual<typeof import('../lib/hosaka')>('../lib/hosaka')
  return {
    ...actual,
    createHosakaClient: () => ({}),
  }
})

import { useCyberspace } from './useCyberspace'

const LIMITS = {
  max_hop_height: 27, max_sidestep_height: 29, hop_min_msats: 1000,
  deposit_min_msats: 1000, deposit_max_msats: 5_000_000_000, invoice_ttl_seconds: 3600,
}

/** The client the store talks to, replaced for the test. */
function stubClient(): void {
  const invoice = {
    deposit_id: 'dep-1', status: 'pending', amount_msats: 0, bolt11: 'lnbc1fake',
    payment_hash: 'ff'.repeat(32), created_at: 1, expires_at: Math.floor(Date.now() / 1000) + 3600,
    settled_at: null, settled_msats: null, balance_msats: 0,
  }
  const client = {
    deposit: async (msats: number) => { calls.deposits.push(msats); return { ...invoice, amount_msats: msats } },
    waitForDeposit: async (id: string) => { calls.waits.push(id); return { ...invoice, status: settleAs, balance_msats: settleAs === 'settled' ? 21_000 : 0 } },
    balance: async () => ({ pubkey: 'x', balance_msats: 21_000, ledger: [] }),
  }
  ;(globalThis as { __hosakaStub?: unknown }).__hosakaStub = client
}

describe('topping up the compute balance', () => {
  beforeEach(() => {
    calls.deposits = []; calls.waits = []
    settleAs = 'settled'
    stubClient()
    useCyberspace.setState({
      cloud: { ...useCyberspace.getState().cloud, limits: LIMITS, status: 'idle', invoice: null, invoiceOpen: false, balanceError: null, message: null },
      plan: null,
    })
  })

  it('refuses an amount below the provider’s minimum, without asking for an invoice', async () => {
    await useCyberspace.getState().topUp(0)
    expect(calls.deposits).toHaveLength(0)
    expect(useCyberspace.getState().cloud.balanceError).toMatch(/between/)
  })

  it('refuses while a move is in flight, because they share one invoice', async () => {
    useCyberspace.setState({ cloud: { ...useCyberspace.getState().cloud, status: 'computing' } })
    await useCyberspace.getState().topUp(1000)
    expect(calls.deposits).toHaveLength(0)
    expect(useCyberspace.getState().cloud.balanceError).toMatch(/in progress/)
  })
})
