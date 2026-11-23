/**
 * chainCommentsClosed.test.tsx: the CHAIN chip asks the relays for comments
 * only while its explorer is open, where the count is shown (arkinox,
 * 2026-11-21: WALK stutters on his phone). Closed, it asked 450 ms after
 * every landed move: one more question to every relay per WALK step, for a
 * number nobody saw. The relay is a stand-in; no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../test/elementRoot'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
/** What the chip asked comments for: the action, or null for nothing. */
const askedFor: Array<string | null> = []
vi.mock('../../hooks/useSocial', () => ({ useActionComments: (a: { id: string } | null) => { askedFor.push(a?.id ?? null); return { comments: [], loading: false, refresh: () => {} } } }))

import { ChainExplorer } from '../ChainExplorer'
import { useChainUi } from '../../store/useChainUi'
import { useCyberspace } from '../../store/useCyberspace'

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }

const realChain = useCyberspace.getState().focusChain
afterEach(() => {
  vi.useRealTimers()
  useChainUi.setState({ explorerOpen: false })
  useCyberspace.setState({ focusChain: realChain, events: [] })
  askedFor.length = 0
})

/** A chain of three actions, as chainAhead.test.tsx gives the chip one. */
function chained(): void {
  const spawn = { id: 'e'.repeat(64), pubkey: 'a'.repeat(64), createdAt: 1_700_000_000, type: 'spawn', name: 'spawn', role: 'spawn', coordHex: 'c'.repeat(64), position: { x: 1n, y: 2n, z: 3n }, plane: 0, prevCoordHex: null, genesisId: null, previousId: null, proofHash: null, sector: '0-0-0' }
  const chain = Array.from({ length: 3 }, (_, i) => ({ ...spawn, id: i.toString(16).padStart(64, '0') }))
  useCyberspace.setState({ focusChain: () => chain as unknown as ReturnType<typeof realChain>, events: [] })
}

describe('the CHAIN chip’s comment count', () => {
  it('asks for nothing while the explorer is closed, however long the mark rests', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    chained()
    useChainUi.setState({ explorerOpen: false })
    const chip = await mount(<ChainExplorer />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(askedFor.filter((a) => a !== null)).toEqual([])
    await chip.unmount()
  })

  it('asks for the action under the mark once the explorer is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    chained()
    useChainUi.setState({ explorerOpen: true })
    const chip = await mount(<ChainExplorer />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(askedFor.filter((a) => a !== null)).toContain('2'.padStart(64, '0'))
    await chip.unmount()
  })
})
