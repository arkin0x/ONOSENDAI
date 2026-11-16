/**
 * hiddenAudioGame.test.tsx - a game opening stops every hidden audio world
 * voice (scene/HiddenAudio.tsx): the scene's frames stop under a game
 * (scene/frameDriver), so no plan would stop them, and the ears are the
 * game's. A card's PLAY, started by the person, plays on. React's effects
 * are run by hand here; the stores are stood in.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  inGame: false,
  world: new Set<string>(['item-a', 'item-b']),
  stopped: [] as string[],
  cardsStopped: [] as string[],
  duck: [] as boolean[],
}))

vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  useEffect: (fn: () => void | (() => void)) => { h.effects.push(fn) },
  useRef: <T,>(v: T) => ({ current: v }),
}))
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }))
vi.mock('../../store/useGame', () => ({ useGame: <T,>(sel: (s: { session: unknown }) => T) => sel({ session: h.inGame ? {} : null }) }))
vi.mock('../../store/useCyberspace', () => ({ alignedOrigin: () => [0, 0, 0], useCyberspace: { getState: () => ({}) } }))
vi.mock('../../store/useShards', () => ({ muteSubject: () => '', useShards: { getState: () => ({}) } }))
vi.mock('../../store/useMutes', () => ({ useMutes: { getState: () => ({}) } }))
vi.mock('../../store/useSoundMutes', () => ({ trackSilenced: () => false }))
vi.mock('../../store/useHiddenAudio', () => ({
  audioListener: () => null, moveListener: () => {}, placeWorld: () => {}, setWorldGain: () => {}, startWorld: () => {},
  worldFailed: () => false, worldPending: () => new Set(),
  worldVoices: () => new Set(h.world),
  stopWorld: (k: string) => { h.stopped.push(k); h.world.delete(k) },
  stopAudio: (k: string) => { h.cardsStopped.push(k) },
  setWorldDuck: (on: boolean) => { h.duck.push(on) },
}))

import { HiddenAudio } from '../HiddenAudio'

const AXES = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as const

/** Render once and run the effects React would run after it. */
function render(): Array<void | (() => void)> {
  h.effects = []
  HiddenAudio({ axes: AXES as never })
  return h.effects.map((fn) => fn())
}

beforeEach(() => {
  h.inGame = false
  h.world = new Set(['item-a', 'item-b'])
  h.stopped = []; h.cardsStopped = []; h.duck = []
})

describe('hidden audio under a game', () => {
  it('out of a game, nothing is stopped', () => {
    render()
    expect(h.stopped).toEqual([])
  })

  it('a game opening stops every world voice and lets the music back up; a card plays on', () => {
    h.inGame = true
    render()
    expect(h.stopped.sort()).toEqual(['item-a', 'item-b'])
    expect(h.duck).toContain(false)
    expect(h.cardsStopped).toEqual([])
  })

  it('leaving the scene stops them the same way', () => {
    const cleanups = render()
    for (const c of cleanups) if (typeof c === 'function') c()
    expect(h.stopped.sort()).toEqual(['item-a', 'item-b'])
  })
})
