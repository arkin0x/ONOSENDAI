/**
 * buildHidesChips.test.tsx: the NEARBY and CHAIN chips stand down while BUILD
 * mode is on (arkinox, 2026-11-02), and come back when it ends.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

// Something decrypted here, so NEARBY has a count to show.
vi.mock('../../hooks/useNearbyLoot', () => ({ useNearbyLoot: () => [{ key: 'k', type: 'key' }] }))

// A server render reads a zustand store's initial state; here each hook
// reads the live state, as a mounted component in the browser does.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { NearbyChip } from '../NearbyChip'
import { ChainExplorer } from '../ChainExplorer'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'

const spawn = { id: 'e'.repeat(64), pubkey: 'p'.repeat(64), type: 'spawn', position: { x: 1n, y: 2n, z: 3n }, plane: 0, created_at: 1 }
const realChain = useCyberspace.getState().focusChain

afterEach(() => {
  useBuilder.setState({ active: false })
  useCyberspace.setState({ focusChain: realChain })
})

describe('BUILD mode keeps NEARBY and CHAIN off the stack', () => {
  it('NEARBY shows its count outside BUILD and nothing in it', () => {
    useShards.setState({ nearbyOpen: false })
    expect(renderToStaticMarkup(<NearbyChip />)).toContain('NEARBY 1')
    useBuilder.setState({ active: true })
    expect(renderToStaticMarkup(<NearbyChip />)).toBe('')
    useBuilder.setState({ active: false })
    expect(renderToStaticMarkup(<NearbyChip />)).toContain('NEARBY 1')
  })

  it('CHAIN shows n/N outside BUILD and nothing in it', () => {
    useCyberspace.setState({ focusChain: () => [spawn] as unknown as ReturnType<typeof realChain> })
    expect(renderToStaticMarkup(<ChainExplorer />)).toContain('CHAIN 1/1')
    useBuilder.setState({ active: true })
    expect(renderToStaticMarkup(<ChainExplorer />)).toBe('')
    useBuilder.setState({ active: false })
    expect(renderToStaticMarkup(<ChainExplorer />)).toContain('CHAIN 1/1')
  })
})
