/**
 * discoveryTv.test.ts: the background scan stands down while Cyberspace TV
 * is on. TV points the anchor at its shots, its bag boxes and a hyperjump's
 * midpoint, none of them where an avatar stood at that moment on tape; TV
 * scans for itself (lib/tv/scan.ts). A scan TV cut off is forgotten, so the
 * view TV puts back is scanned again.
 *
 * The hook runs under a small stand-in for React (effects run after the
 * render that asks for them, when their dependencies change), with the
 * stores as plain objects and a Worker that only records what it is asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Effect { deps?: unknown[]; cleanup?: () => void }
const effects: Effect[] = []
const refs: Array<{ current: unknown }> = []
let pending: Array<() => void> = []
let ei = 0
let ri = 0
vi.mock('react', () => ({
  useRef: (v: unknown) => { refs[ri] ??= { current: v }; return refs[ri++] },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { prev?.cleanup?.(); effects[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const cs = { anchor: { x: 1000n, y: 5n, z: 7n }, anchorPlane: 0, atHead: () => false, headPlane: 0 }
const tv = { on: false }
const setScanning = vi.fn()
vi.mock('../../store/useCyberspace', () => ({
  MAX_COMPUTE_HEIGHT: 20,
  useCyberspace: Object.assign((sel: (s: typeof cs) => unknown) => sel(cs), { getState: () => cs }),
}))
vi.mock('../../store/useTv', () => ({ useTv: Object.assign((sel: (s: typeof tv) => unknown) => sel(tv), { getState: () => tv }) }))
vi.mock('../../store/useShards', () => ({ SCAN_MAX_HEIGHT: 12, useShards: { getState: () => ({ setScanning, freshOf: () => [], addDiscovered: () => {} }) } }))
vi.mock('../../store/useSecrets', () => ({ useSecrets: { getState: () => ({ setCurrent: () => {}, recordPlace: async () => {}, hold: () => {} }) } }))
vi.mock('../../store/useCeremony', () => ({ useCeremony: { getState: () => ({ mark: () => {} }) } }))
vi.mock('../../lib/relay', () => ({ query: async () => [] }))
vi.mock('../../lib/foundCache', () => ({ unbagRemembered: async () => [] }))
vi.mock('../../lib/references', () => ({ resolveReference: async () => null }))

/** What the region worker was asked to derive, by x. */
const posted: string[] = []
class FakeWorker {
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(m: { x: string }): void { posted.push(m.x) }
  terminate(): void {}
}
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const { useDiscovery } = await import('../useDiscovery')

function render(): void {
  ei = 0
  ri = 0
  pending = []
  useDiscovery()
  for (const run of pending) run()
}

beforeEach(() => {
  posted.length = 0
  setScanning.mockClear()
})

describe('the background scan while TV is on', () => {
  it('stands down while TV is on, and scans the view TV puts back', () => {
    render()
    expect(posted).toEqual(['1000'])
    // TV comes on and points the anchor elsewhere, twice.
    tv.on = true
    cs.anchor = { x: 99_000n, y: 5n, z: 7n }
    render()
    expect(posted).toEqual(['1000'])
    // The scan it cut off is forgotten: SCANNING does not stay lit.
    expect(setScanning).toHaveBeenLastCalledWith(false)
    cs.anchor = { x: 123_456n, y: 5n, z: 7n }
    render()
    expect(posted).toEqual(['1000'])
    // TV off, the view put back where it was: scanned again.
    tv.on = false
    cs.anchor = { x: 1000n, y: 5n, z: 7n }
    render()
    expect(posted).toEqual(['1000', '1000'])
  })
})
