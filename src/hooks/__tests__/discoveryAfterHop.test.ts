/**
 * discoveryAfterHop.test.ts: after your own hop, the scan waits for the
 * avatar to arrive (lib/hopStage.ts), so what it opens and reveals, the
 * tutorial's chest among it, never lands in the frames the glide is drawn in
 * (owner, 2026-11-12: "make sure that we do the hop when the CPU is not
 * overloaded so that everything plays smoothly"). Any other move of the
 * anchor scans at once.
 *
 * The hook runs under the same small stand-in for React as discoveryTv.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Effect { deps?: unknown[]; cleanup?: () => void }
const effects: Effect[] = []
const refs: Array<{ current: unknown }> = []
let pending: Array<() => void> = []
let ei = 0
let ri = 0
vi.mock('react', () => ({
  useRef: (v: unknown) => { refs[ri] ??= { current: v }; return refs[ri++] },
  useState: (v: unknown) => [v, () => {}],
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { prev?.cleanup?.(); effects[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const scanning: boolean[] = []
const cs = { anchor: { x: 1000n, y: 5n, z: 7n }, anchorPlane: 0, atHead: () => false, headPlane: 0 }
vi.mock('../../store/useCyberspace', () => ({
  MAX_COMPUTE_HEIGHT: 20,
  useCyberspace: Object.assign((sel: (s: typeof cs) => unknown) => sel(cs), { getState: () => cs }),
}))
vi.mock('../../store/useTv', () => ({ useTv: Object.assign((sel: (s: { on: boolean }) => unknown) => sel({ on: false }), { getState: () => ({ on: false }) }) }))
vi.mock('../../store/useShards', () => ({
  SCAN_MAX_HEIGHT: 12,
  useShards: { getState: () => ({ setScanning: (on: boolean) => { scanning.push(on) }, freshOf: () => [], ownDoorAddresses: () => [], dropStale: () => {}, honorRetractions: () => {}, addDiscovered: () => {} }) },
}))
vi.mock('../../store/useSecrets', () => ({ useSecrets: { getState: () => ({ setCurrent: () => {}, recordPlace: async () => {}, hold: () => {} }) } }))
vi.mock('../../store/useCeremony', () => ({ useCeremony: { getState: () => ({ mark: () => {} }) } }))
vi.mock('../../lib/relay', () => ({ query: async () => [] }))

const posted: number[] = []
class FakeWorker {
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(m: { id: number }): void { posted.push(m.id) }
  terminate(): void {}
}
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const { useDiscovery } = await import('../useDiscovery')
const { glideDone, hopLanding, resetHopStage } = await import('../../lib/hopStage')

function render(): void {
  ei = 0
  ri = 0
  pending = []
  useDiscovery()
  for (const run of pending) run()
}

// Each test mounts the hook afresh: a new worker, nothing scanned yet.
beforeEach(() => {
  effects.length = 0
  refs.length = 0
  posted.length = 0
  scanning.length = 0
  cs.anchor = { x: 1000n, y: 5n, z: 7n }
})
afterEach(() => { resetHopStage() })

describe('the scan after your own hop', () => {
  it('scans at once when the anchor moves for anything but your own landing', () => {
    render()
    expect(posted).toHaveLength(1)
    expect(scanning.at(-1)).toBe(true)
  })

  it('waits while the avatar glides, and starts once it has arrived', async () => {
    render()
    posted.length = 0
    scanning.length = 0
    hopLanding()
    cs.anchor = { x: 1010n, y: 5n, z: 7n }
    render()
    // Landed, still gliding: nothing asked of the worker, SCANNING not lit.
    expect(posted).toHaveLength(0)
    expect(scanning).toEqual([])
    glideDone()
    await vi.waitFor(() => { expect(posted).toHaveLength(1) })
    expect(scanning).toEqual([true])
  })

  it('a scan overtaken while it waited never starts: only the newest place is scanned', async () => {
    render()
    posted.length = 0
    hopLanding()
    cs.anchor = { x: 2000n, y: 5n, z: 7n }
    render()
    cs.anchor = { x: 3000n, y: 5n, z: 7n }
    render()
    expect(posted).toHaveLength(0)
    glideDone()
    await vi.waitFor(() => { expect(posted).toHaveLength(1) })
    await new Promise((r) => setTimeout(r, 20))
    expect(posted).toHaveLength(1)
  })
})
