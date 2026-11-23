/**
 * travelFirstHop.test.ts: a newcomer's first hop glides (owner, 2026-11-12:
 * "When I do the first hop I never see the animation").
 *
 * The first COMMIT of a new identity signs the spawn where it stands (a new
 * genesis, the anchor unmoved) and then the hop. Travel read the hop as a new
 * chain, a cut, because its key was only taken when the anchor moved; the
 * glide never started. The component runs under a small stand-in for React
 * and R3F: its layout effect and its frame are called by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Effect { deps?: unknown[] }
const effects: Effect[] = []
const refs: Array<{ current: unknown }> = []
let pending: Array<() => void> = []
let ei = 0
let ri = 0
let frame: (() => void) | null = null
vi.mock('react', () => ({
  useRef: (v: unknown) => { refs[ri] ??= { current: v }; return refs[ri++] },
  useLayoutEffect: (fn: () => void, deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { fn(); effects[k] = { deps } })
  },
}))
vi.mock('@react-three/fiber', () => ({ useFrame: (fn: () => void) => { frame = fn } }))

const st = {
  anchor: { x: 1000n, y: 5n, z: 7n },
  scaleExp: 0,
  genesisId: '',
  focus: null as null,
  exploreIndex: null as number | null,
  focusPubkey: () => 'p'.repeat(64),
}
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: (sel: (s: typeof st) => unknown) => sel(st),
  alignedOrigin: (p: { x: bigint; y: bigint; z: bigint }) => p,
}))

const { Travel } = await import('../Travel')
const { travelOffset } = await import('../../lib/travel')
const { hopLanding, hopSettling, resetHopStage } = await import('../../lib/hopStage')
const axes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as never

function render(): void {
  ei = 0
  ri = 0
  pending = []
  Travel({ axes })
  for (const run of pending) run()
}

beforeEach(() => { resetHopStage(); travelOffset.set(0, 0, 0) })

describe('Travel: the first hop after the spawn', () => {
  it('glides: the spawn changed the chain where it stood, and the hop is a journey, not a cut', () => {
    render()
    // COMMIT signs the spawn: a new genesis, the same place.
    st.genesisId = 's'.repeat(64)
    st.anchor = { ...st.anchor }
    render()
    expect(travelOffset.lengthSq()).toBe(0)
    // Then the hop lands, ten gibsons out.
    hopLanding()
    st.anchor = { x: 1000n, y: 5n, z: 17n }
    render()
    // Drawn where it was: ten cells back along z, and still on its way.
    expect(travelOffset.z).toBeCloseTo(-10, 6)
    expect(hopSettling()).toBe(true)
    frame!()
    expect(travelOffset.lengthSq()).toBeGreaterThan(0)
  })

  it('a new chain that also moves the anchor (a respawn elsewhere) is still a cut, and what waited goes', () => {
    render()
    hopLanding()
    st.genesisId = 'r'.repeat(64)
    st.anchor = { x: 99_000n, y: 5n, z: 7n }
    render()
    expect(travelOffset.lengthSq()).toBe(0)
    expect(hopSettling()).toBe(false)
  })
})
