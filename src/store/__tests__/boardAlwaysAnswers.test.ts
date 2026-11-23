/**
 * boardAlwaysAnswers.test.ts - every press of BOARD boards or says why
 * (2026-11-16). In a private tab the owner set a destination about 500,000
 * blocks away and pressed BOARD, and nothing happened: a new identity has no
 * chain yet, and boardHyperspace ended without a word. BOARD is a deliberate
 * first act, as a first move is, so it now signs the spawn and boards; every
 * other refusal comes back as words the Hyperspace panel shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

// The relays answer the head check, holding nothing newer.
vi.mock('../../lib/chains', async (orig) => ({ ...(await orig<typeof import('../../lib/chains')>()), confirmChainEvents: vi.fn(async () => []) }))

import { buildChain } from '../../lib/events'
import { BOARD_MOVE_COMPUTING_MESSAGE, BOARD_OWN_CHAIN_MESSAGE, BOARD_CHOOSE_FIRST_MESSAGE, useCyberspace } from '../useCyberspace'
import { boardFromAnywhere, useRideRun } from '../../hud/HyperspacePanel'

const S = useCyberspace.getState
const IDLE = { ...S().proof, status: 'idle' as const, message: null }

beforeEach(() => {
  // A new identity, never placed: the provisional state a private tab starts in.
  useCyberspace.setState({
    events: [], genesisId: '', prevEventId: '', published: {}, held: false,
    transit: null, exploreIndex: null, spectate: null, focus: null, chainConflict: null,
    selfCheck: { pubkey: S().identity.pubkey, status: 'none' },
    proof: IDLE,
  })
  useRideRun.setState({ error: null, boarding: false, progress: null, hosaka: false, path: null })
})

describe('BOARD on an identity never placed', () => {
  it('signs the spawn, then boards from it', async () => {
    expect(await S().boardHyperspace()).toBeNull()
    expect(buildChain(S().events).map((a) => a.type)).toEqual(['spawn', 'enter-hyperspace'])
    expect(S().transit?.stage).toBe('boarded')
  })

  it('from the panel: boards, leaves no error, and is never stuck BOARDING', async () => {
    await boardFromAnywhere()
    expect(S().transit?.stage).toBe('boarded')
    expect(useRideRun.getState()).toMatchObject({ error: null, boarding: false })
  })
})

describe('BOARD that cannot board says why', () => {
  it('while a move is computing', async () => {
    useCyberspace.setState({ proof: { ...IDLE, status: 'computing' } })
    expect(await S().boardHyperspace()).toBe(BOARD_MOVE_COMPUTING_MESSAGE)
    expect(S().events).toEqual([])
  })

  it('from history or a spectation', async () => {
    useCyberspace.setState({ exploreIndex: 0 })
    expect(await S().boardHyperspace()).toBe(BOARD_OWN_CHAIN_MESSAGE)
    expect(S().events).toEqual([])
  })

  it('while a choice between two chains waits', async () => {
    useCyberspace.setState({ chainConflict: { kind: 'held' } as never })
    expect(await S().boardHyperspace()).toBe(BOARD_CHOOSE_FIRST_MESSAGE)
    expect(S().events).toEqual([])
  })

  it('when the relays\' answer to the head check raises a choice between two chains, nothing is signed onto either', async () => {
    // A rival chain arrives once the spawn is signed, as it can for a held
    // spawn while the head is confirmed: the choice is raised, the head does not move.
    const stop = useCyberspace.subscribe((st) => {
      if (st.events.length === 1 && !st.chainConflict) useCyberspace.setState({ chainConflict: { kind: 'held' } as never })
    })
    try {
      expect(await S().boardHyperspace()).toBe(BOARD_CHOOSE_FIRST_MESSAGE)
    } finally {
      stop()
    }
    expect(buildChain(S().events).map((a) => a.type)).toEqual(['spawn'])
    expect(S().transit).toBeNull()
  })

  it('and the panel shows those words where BOARD was pressed', async () => {
    useCyberspace.setState({ proof: { ...IDLE, status: 'computing' } })
    await boardFromAnywhere()
    expect(useRideRun.getState()).toMatchObject({ error: BOARD_MOVE_COMPUTING_MESSAGE, boarding: false })
  })
})
