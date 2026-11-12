/**
 * padModeCycle.test.ts - the mode button's ring, HOP, VIEW, BUILD and back
 * to HOP (arkinox, 2026-11-11; BUILD joined on 2026-11-02), with WALK out of
 * it: a toggle that remembers the mode it was entered from and goes back to
 * it, and RECALL that stays in VIEW and BUILD (arkinox, 2026-11-12). Every
 * other way in and out of BUILD still works beside it: B, Esc, EXIT, a
 * deploy lined up, and spectating.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // No relay is ever dialed from here: a socket that never opens.
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    static OPEN = 1
    readyState = 0
    onopen = null; onclose = null; onerror = null; onmessage = null
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
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

vi.mock('../../lib/workers', () => ({ postProof: vi.fn(), cancelProof: vi.fn(), setProofHandler: vi.fn() }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
// A spectated avatar with nothing on the relay: the scene watches their spawn.
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { useShards } from '../useShards'
import { useWalk } from '../useWalk'
import { useToast } from '../useToast'
import { useRegion } from '../useRegion'
import { buildHeld, buildToHop, currentPadMode, cycleMode, enterWalk, leaveWalk, padMode, recall } from '../padMode'
import { walkCancel } from '../../hooks/useKeyboard'
import { escapeTop } from '../../hooks/useEscape'
import { spectate, stopSpectating } from '../../lib/spectator'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()

beforeEach(async () => {
  stopSpectating()
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle', deployError: null })
  useWalk.getState().exit()
  B().exit()
  S().clearFocus()
  useToast.getState().dismiss()
  await placeSpawn()
  S().cancel()
  useCyberspace.setState({ scaleExp: 0 })
  expect(currentPadMode()).toBe('hop')
})

describe('the mode button', () => {
  it('goes HOP, VIEW, BUILD and back to HOP, one press each', () => {
    const home = { ...S().position }
    cycleMode()
    expect(currentPadMode()).toBe('view')
    expect(S().viewing()).toBe(true)
    // Looked away in VIEW: BUILD starts where the view's cursor is.
    S().moveCursor({ axis: 'x', dir: 1 })
    const looked = { ...S().cursor }
    expect(looked).not.toEqual(home)

    cycleMode()
    expect(currentPadMode()).toBe('build')
    expect(B().active).toBe(true)
    expect(B().via).toBe('build')
    expect(S().cursor).toEqual(looked)

    cycleMode()
    expect(currentPadMode()).toBe('hop')
    expect(B().active).toBe(false)
    expect(S().focus).toBeNull()
    expect(S().atHead()).toBe(true)
    expect(S().cursor).toEqual(home)
  })

  it('VIEW to BUILD ends region mode, a VIEW tool', () => {
    cycleMode()
    useRegion.getState().enter()
    expect(useRegion.getState().active).toBe(true)
    cycleMode()
    expect(currentPadMode()).toBe('build')
    expect(useRegion.getState().active).toBe(false)
  })

  it('keeps the zoom all the way round', () => {
    useCyberspace.setState({ scaleExp: 5 })
    for (const mode of ['view', 'build', 'hop'] as const) {
      cycleMode()
      expect(currentPadMode()).toBe(mode)
      expect(S().scaleExp).toBe(5)
    }
  })

  it('from BUILD goes home to HOP even with the build cursor moved away, where EXIT leaves the view', () => {
    const home = { ...S().position }
    B().enter('build')
    S().moveCursor({ axis: 'x', dir: 1 })
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(B().leftAvatar).toBe(true)
    // EXIT (and B, and Esc) leave the view where it is (R6).
    B().exit()
    expect(S().focus?.drive).toBe(true)
    S().clearFocus()

    B().enter('build')
    S().moveCursor({ axis: 'x', dir: 1 })
    cycleMode()
    expect(B().active).toBe(false)
    expect(S().focus).toBeNull()
    expect(S().cursor).toEqual(home)
    expect(currentPadMode()).toBe('hop')
    // A mode ended on purpose is no BUILD MODE ENDED.
    expect(useToast.getState().toast?.label).not.toBe('BUILD MODE ENDED')
  })

  it('waits in BUILD while a deploy is lined up, and a copy lined up after a placement does not hold it', () => {
    B().enter('build')
    const pending = { type: 'message' as const, text: 'hi' }
    useShards.setState({ pending })
    expect(buildHeld()).toBe(true)
    cycleMode()
    expect(B().active).toBe(true)
    buildToHop()
    expect(B().active).toBe(true)
    // A copy lined up again after a placement: leaving stands it down.
    useShards.setState({ placedLast: { pending } as never })
    expect(buildHeld()).toBe(false)
    cycleMode()
    expect(B().active).toBe(false)
    expect(useShards.getState().pending).toBeNull()
    expect(currentPadMode()).toBe('hop')
  })

  it('while spectating, leaves BUILD back to watching them: there is no HOP to go to', async () => {
    const pk = getPublicKey(generateSecretKey())
    B().enter('build')
    await spectate(pk)
    expect(B().active).toBe(true)
    cycleMode()
    expect(B().active).toBe(false)
    expect(S().spectate?.pubkey).toBe(pk)
    expect(S().focus).toBeNull()
  })
})

describe('the other ways in and out still work', () => {
  it('RECALL (X) in WALK goes back to HOP, not to BUILD', () => {
    useWalk.getState().enter()
    walkCancel()
    expect(S().walking).toBe(false)
    expect(B().active).toBe(false)
    expect(currentPadMode()).toBe('hop')
  })

  it('B goes from WALK into BUILD and back out, and Esc leaves BUILD', () => {
    useWalk.getState().enter()
    B().toggle()
    expect(S().walking).toBe(false)
    expect(B().active).toBe(true)
    B().toggle()
    expect(B().active).toBe(false)
    expect(currentPadMode()).toBe('hop')

    B().toggle()
    expect(B().active).toBe(true)
    escapeTop()
    expect(B().active).toBe(false)
  })

  it('WALK is out of the ring: the mode button in WALK goes back to HOP', () => {
    useWalk.getState().enter()
    cycleMode()
    expect(S().walking).toBe(false)
    expect(B().active).toBe(false)
    expect(currentPadMode()).toBe('hop')
  })

  it('names the mode with WALK first, then BUILD, then VIEW', () => {
    expect(padMode(true, false, false)).toBe('walk')
    expect(padMode(false, true, false)).toBe('build')
    expect(padMode(false, true, true)).toBe('build')
    expect(padMode(false, false, true)).toBe('view')
    expect(padMode(false, false, false)).toBe('hop')
  })
})

describe('WALK, a toggle that remembers the mode (arkinox, 2026-11-12)', () => {
  it('from HOP, VIEW and BUILD, and back to each, VIEW and BUILD at your avatar', () => {
    const home = { ...S().position }
    for (const from of ['hop', 'view', 'build'] as const) {
      if (from === 'view') S().viewHere()
      if (from === 'build') B().enter('build')
      expect(currentPadMode()).toBe(from)
      enterWalk()
      expect(currentPadMode()).toBe('walk')
      expect(S().atHead()).toBe(true)
      expect(useWalk.getState().from).toBe(from)
      leaveWalk()
      expect(currentPadMode()).toBe(from)
      expect(S().cursor).toEqual(home)
      if (from === 'view') S().clearFocus()
      if (from === 'build') buildToHop()
    }
  })

  it('X at rest in WALK goes back to the mode too, and the mode button in WALK does', () => {
    S().viewHere()
    enterWalk()
    walkCancel()
    expect(currentPadMode()).toBe('view')
    cycleMode()
    expect(currentPadMode()).toBe('build')
    enterWalk()
    cycleMode()
    expect(currentPadMode()).toBe('build')
  })

  it('keeps the zoom in and out of WALK', () => {
    useCyberspace.setState({ scaleExp: 4 })
    S().viewHere()
    enterWalk()
    expect(S().scaleExp).toBe(4)
    leaveWalk()
    expect(S().scaleExp).toBe(4)
  })

  it('does not start from BUILD while a deploy is lined up: the deploy and BUILD stay', () => {
    B().enter('build')
    const pending = { type: 'message' as const, text: 'hi' }
    useShards.setState({ pending })
    enterWalk()
    expect(S().walking).toBe(false)
    expect(B().active).toBe(true)
    expect(useShards.getState().pending).toEqual(pending)
  })

  it('entered any other way (B into BUILD, then out) goes back to HOP', () => {
    S().viewHere()
    enterWalk()
    B().toggle()
    expect(S().walking).toBe(false)
    B().toggle()
    useWalk.getState().enter()
    expect(useWalk.getState().from).toBe('hop')
    leaveWalk()
    expect(currentPadMode()).toBe('hop')
  })
})

describe('RECALL stays in the mode (arkinox, 2026-11-12)', () => {
  it('in VIEW: the cursor and the view come home, VIEW stays, at the zoom you are at', () => {
    const home = { ...S().position }
    S().viewHere()
    for (let i = 0; i < 3; i++) S().moveCursor({ axis: 'x', dir: 1 })
    useCyberspace.setState({ scaleExp: 3 })
    recall()
    expect(currentPadMode()).toBe('view')
    expect(S().cursor).toEqual(home)
    expect(S().focus?.position).toEqual(home)
    expect(S().anchor).toEqual(home)
    expect(S().scaleExp).toBe(3)
  })

  it('in BUILD: the build cursor comes home, BUILD stays', () => {
    const home = { ...S().position }
    B().enter('build')
    S().moveCursor({ axis: 'x', dir: 1 })
    recall()
    expect(currentPadMode()).toBe('build')
    expect(S().cursor).toEqual(home)
  })

  it('in HOP: the cursor comes home, as before', () => {
    const home = { ...S().position }
    S().moveCursor({ axis: 'x', dir: 1 })
    recall()
    expect(currentPadMode()).toBe('hop')
    expect(S().cursor).toEqual(home)
  })

  it('in region mode: RESET a grown region, then back to the entry cell as X, then home with region mode ended, VIEW staying', () => {
    const home = { ...S().position }
    S().viewHere()
    S().moveCursor({ axis: 'x', dir: 1 })
    useRegion.getState().enter()
    const entry = { ...useRegion.getState().entry! }
    for (let i = 0; i < 40; i++) S().moveCursor({ axis: 'y', dir: 1 })
    expect(useRegion.getState().prefix).not.toBe(useRegion.getState().entryPrefix)
    recall()
    expect(useRegion.getState().prefix).toBe(useRegion.getState().entryPrefix)
    expect(useRegion.getState().active).toBe(true)
    recall()
    expect(useRegion.getState().active).toBe(true)
    expect(S().cursor).toEqual(entry)
    recall()
    expect(useRegion.getState().active).toBe(false)
    expect(currentPadMode()).toBe('view')
    expect(S().cursor).toEqual(home)
  })
})
