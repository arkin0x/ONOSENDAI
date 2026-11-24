/**
 * modesPad.test.ts - the pad following a MODES list (store/modeOrder.ts,
 * store/padMode.ts, store/startMode.ts; owner, 2026-11-24):
 *
 * - the mode button goes round the player's ring, the second button is
 *   whichever mode the list puts second, and both still work as WALK's
 *   toggle always did: in, and back to where it was pressed from;
 * - a mode switched off is out of the ring, and still opens when something
 *   asks for it by name (B, N, TRY WALK's enterWalk, ?mode=view, a switch
 *   by name), with the mode button the way back;
 * - the app starts in the list's first mode: WALK at your head with the
 *   cursor on you, VIEW at your avatar; never over what the player started,
 *   never in the newcomer view, a tour run or TV;
 * - the newcomer view keeps the default pad whatever the list says.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
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
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { useShards } from '../useShards'
import { useWalk } from '../useWalk'
import { useScan } from '../useScan'
import { useTutorial } from '../useTutorial'
import { useTv } from '../useTv'
import { currentPadMode, cycleMode, enterWalk, goBack, pressSecond, switchMode, watchLastRing } from '../padMode'
import { DEFAULT_MODES, modeRoles, moveModeTo, resetModes, setModeOn, updateModes, useModes, type ModeId, type ModeSettings } from '../modeOrder'
import { applyStartMode, headSettled, untouchedStart, watchStartMode, worldSettled } from '../startMode'
import { stopSpectating } from '../../lib/spectator'
import { applyArrivalMode } from '../arrivalMode'
import { walkCancel } from '../../hooks/useKeyboard'
import { useNewcomer } from '../../newcomer/useNewcomer'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()

/** Keep a list for the identity on screen. TERRAIN, on by default, is off unless the list names it (these lists predate it). */
function setList(order: ModeId[], off: ModeId[] = []): void {
  updateModes((): ModeSettings => {
    let s: ModeSettings = { order: DEFAULT_MODES.order, off: [] }
    order.forEach((id, i) => { s = moveModeTo(s, id, i) })
    for (const id of order.includes('terrain') ? off : [...off, 'terrain' as ModeId]) s = setModeOn(s, id, false)
    return s
  })
}

let stopRing: () => void = () => {}

beforeEach(async () => {
  stopRing()
  stopSpectating()
  useWalk.getState().setGravity(false)
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle', deployError: null })
  useWalk.getState().exit()
  B().exit()
  useScan.getState().exit()
  S().clearFocus()
  useTutorial.setState({ active: false })
  useTv.setState({ on: false })
  useNewcomer.setState({ record: { seen: [] } })
  await placeSpawn()
  S().cancel()
  useCyberspace.setState({ scaleExp: 0 })
  resetModes()
  useModes.setState({ back: null, lastRing: null })
  stopRing = watchLastRing()
  expect(currentPadMode()).toBe('hop')
})

describe('the owner\'s example: WALK first, BUILD the second button', () => {
  beforeEach(() => setList(['walk', 'build', 'hop', 'view', 'scan']))

  it('the mode button goes WALK, HOP, VIEW, SCAN and back to WALK', () => {
    expect(modeRoles()).toEqual({ start: 'walk', second: 'build', ring: ['walk', 'hop', 'view', 'scan'] })
    switchMode('walk')
    expect(S().walking).toBe(true)
    cycleMode()
    expect(currentPadMode()).toBe('hop')
    expect(S().walking).toBe(false)
    cycleMode()
    expect(currentPadMode()).toBe('view')
    // VIEW to SCAN keeps the view: SCAN starts where VIEW was looking.
    S().moveCursor({ axis: 'x', dir: 1 })
    const looked = { ...S().cursor }
    cycleMode()
    expect(currentPadMode()).toBe('scan')
    expect(S().cursor).toEqual(looked)
    cycleMode()
    expect(currentPadMode()).toBe('walk')
    expect(S().atHead()).toBe(true)
    expect(S().cursor).toEqual(S().position)
  })

  it('X in WALK, a ring mode now, stays in WALK', () => {
    switchMode('walk')
    walkCancel()
    expect(currentPadMode()).toBe('walk')
  })

  it('the second button goes into BUILD and back to WALK; the dim mode button goes back too', () => {
    switchMode('walk')
    pressSecond()
    expect(currentPadMode()).toBe('build')
    pressSecond()
    expect(currentPadMode()).toBe('walk')
    // From VIEW, and back to VIEW by the dim mode button.
    switchMode('view')
    pressSecond()
    expect(currentPadMode()).toBe('build')
    cycleMode()
    expect(currentPadMode()).toBe('view')
  })

  it('the second button waits while a deploy is lined up in BUILD', () => {
    switchMode('hop')
    pressSecond()
    expect(currentPadMode()).toBe('build')
    useShards.setState({ pending: { kind: 'shard' } as never, placedLast: null })
    pressSecond()
    cycleMode()
    expect(currentPadMode()).toBe('build')
    useShards.setState({ pending: null })
  })
})

describe('a mode switched off', () => {
  it('leaves the ring', () => {
    setList(['hop', 'walk', 'view', 'build', 'scan'], ['view'])
    cycleMode()
    expect(currentPadMode()).toBe('build')
    cycleMode()
    expect(currentPadMode()).toBe('scan')
    cycleMode()
    expect(currentPadMode()).toBe('hop')
  })

  it('still opens by its key and by name, and the mode button goes back to the last ring mode', () => {
    setList(['hop', 'walk', 'view', 'build', 'scan'], ['build', 'scan'])
    expect(modeRoles().ring).toEqual(['hop', 'view'])
    cycleMode()
    expect(currentPadMode()).toBe('view')
    // B, the Stash panel's BUILD, PLACE from the workshop: useBuilder enter.
    B().toggle()
    expect(currentPadMode()).toBe('build')
    cycleMode()
    expect(currentPadMode()).toBe('view')
    // N: SCAN by name.
    useScan.getState().enter()
    expect(currentPadMode()).toBe('scan')
    goBack()
    expect(currentPadMode()).toBe('view')
    // A switch by name (the tour, a link).
    switchMode('build')
    expect(currentPadMode()).toBe('build')
  })

  it('WALK off: TRY WALK still walks, and leaving goes back where it came from', () => {
    setList(['hop', 'walk', 'view', 'build', 'scan'], ['walk'])
    expect(modeRoles().second).toBe('view')
    cycleMode()
    expect(currentPadMode()).toBe('build')
    enterWalk()
    expect(currentPadMode()).toBe('walk')
    walkCancel()
    expect(currentPadMode()).toBe('build')
  })

  it('VIEW off: ?mode=view still opens VIEW', () => {
    setList(['hop', 'walk', 'view', 'build', 'scan'], ['view'])
    expect(applyArrivalMode('view')).toBe(true)
    expect(currentPadMode()).toBe('view')
  })

  it('the second button off: the next mode on is the second button; one mode on: none', () => {
    setList(['hop', 'walk', 'view', 'build', 'scan'], ['walk'])
    pressSecond()
    expect(currentPadMode()).toBe('view')
    pressSecond()
    expect(currentPadMode()).toBe('hop')
    setList(['hop', 'walk', 'view', 'build', 'scan'], ['walk', 'view', 'build', 'scan'])
    expect(modeRoles()).toEqual({ start: 'hop', second: null, ring: ['hop'] })
    pressSecond()
    cycleMode()
    expect(currentPadMode()).toBe('hop')
  })
})

describe('the mode the app starts in', () => {
  it('HOP first (the default) does nothing', () => {
    expect(applyStartMode()).toBe(false)
    expect(currentPadMode()).toBe('hop')
  })

  it('WALK first starts in WALK at your head, the cursor on you, the walk fresh', () => {
    setList(['walk', 'hop', 'view', 'build', 'scan'])
    expect(applyStartMode()).toBe(true)
    expect(S().walking).toBe(true)
    expect(S().atHead()).toBe(true)
    expect(S().cursor).toEqual(S().position)
    expect(S().focus).toBeNull()
    const w = useWalk.getState()
    expect(w.queue).toEqual([])
    expect(w.behind).toBe(0)
    expect(w.open).toBeNull()
    // A press is a step, as in any WALK.
    const before = { ...S().cursor }
    useWalk.getState().press('up')
    expect(S().cursor).not.toEqual(before)
  })

  it('WALK first under GRAVITY: no fall, no hop signed, gravity left on, until the first press', () => {
    setList(['walk', 'hop', 'view', 'build', 'scan'])
    useWalk.getState().setGravity(true)
    // Nothing under you at all: a WALK entered by hand would fall or switch gravity off.
    const events = S().events.length
    expect(applyStartMode()).toBe(true)
    expect(S().walking).toBe(true)
    expect(useWalk.getState().falling).toBe(false)
    expect(useWalk.getState().gravity).toBe(true)
    expect(useWalk.getState().queue).toEqual([])
    expect(S().events.length).toBe(events)
    expect(S().cursor).toEqual(S().position)
    useWalk.getState().setGravity(false)
  })

  it('waits for the relays\' check of the head; a check still out keeps HOP', async () => {
    const me = S().identity.pubkey
    expect(await headSettled(me, 50)).toBe(true)
    useCyberspace.setState({ selfCheck: { pubkey: me, status: 'checking' } as never })
    expect(await headSettled(me, 50)).toBe(false)
    const later = headSettled(me, 2000)
    useCyberspace.setState({ selfCheck: { pubkey: me, status: 'found' } as never })
    expect(await later).toBe(true)
    useCyberspace.setState({ selfCheck: { pubkey: me, status: 'none' } as never })
  })

  it('VIEW first starts in VIEW at your avatar, once the saved chain is in', async () => {
    setList(['view', 'hop', 'walk', 'build', 'scan'])
    const stop = watchStartMode()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    stop()
    expect(currentPadMode()).toBe('view')
    expect(S().cursor).toEqual(S().position)
  })

  it('never over what the player started: a cursor moved, a mode entered', () => {
    setList(['walk', 'hop', 'view', 'build', 'scan'])
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(untouchedStart()).toBe(false)
    expect(applyStartMode()).toBe(false)
    expect(S().walking).toBe(false)
    S().cancel()
    B().enter('build')
    expect(applyStartMode()).toBe(false)
    expect(currentPadMode()).toBe('build')
  })

  it('not in the newcomer view, a tour run or TV', () => {
    setList(['walk', 'hop', 'view', 'build', 'scan'])
    useNewcomer.setState({ record: { stage: 'newcomer', seen: [] } })
    expect(applyStartMode()).toBe(false)
    useNewcomer.setState({ record: { stage: 'graduated', seen: [] } })
    useTutorial.setState({ active: true })
    expect(applyStartMode()).toBe(false)
    useTutorial.setState({ active: false })
    useTv.setState({ on: true })
    expect(applyStartMode()).toBe(false)
    useTv.setState({ on: false })
    expect(currentPadMode()).toBe('hop')
    expect(applyStartMode()).toBe(true)
    expect(currentPadMode()).toBe('walk')
  })

  it('WALK waits for the world to be still, at most a cap', async () => {
    vi.useFakeTimers()
    try {
      let done = false
      void worldSettled(100, 1000).then(() => { done = true })
      await vi.advanceTimersByTimeAsync(60)
      useShards.setState({ discovered: {} })
      await vi.advanceTimersByTimeAsync(60)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(60)
      expect(done).toBe(true)
      done = false
      void worldSettled(100, 300).then(() => { done = true })
      for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(80); useShards.setState({ discovered: {} }) }
      expect(done).toBe(true)
    } finally { vi.useRealTimers() }
  })
})

describe('never stuck', () => {
  it('the ring passes over a mode that will not open here (WALK in hyperspace transit)', () => {
    // HOP second, so WALK is in the ring after VIEW.
    setList(['view', 'hop', 'walk', 'build', 'scan'])
    expect(modeRoles().ring).toEqual(['view', 'walk', 'build', 'scan'])
    S().viewHere()
    expect(currentPadMode()).toBe('view')
    // No head to walk from (padMode enterWalk refuses).
    useCyberspace.setState({ transit: {} as never })
    try {
      cycleMode()
      expect(currentPadMode()).toBe('build')
    } finally {
      useCyberspace.setState({ transit: null })
    }
  })

  it('the second button\'s way back is forgotten once its mode is left another way, and never names a mode switched off', () => {
    setList(['hop', 'scan', 'view', 'build', 'walk'])
    expect(modeRoles().second).toBe('scan')
    B().enter('build')
    pressSecond()
    expect(currentPadMode()).toBe('scan')
    expect(useModes.getState().back).toBe('build')
    // N out of SCAN: the way back is gone.
    useScan.getState().exit()
    expect(useModes.getState().back).toBeNull()
    // Into SCAN by N from VIEW, then VIEW switched off: the way back is the first mode.
    switchMode('view')
    useScan.getState().enter()
    updateModes((s) => setModeOn(s, 'view', false))
    goBack()
    expect(currentPadMode()).toBe('hop')
  })
})

describe('the newcomer view', () => {
  it('keeps the default ring and WALK as the second button, whatever the list says', () => {
    setList(['walk', 'build', 'scan', 'view', 'hop'], ['view'])
    useNewcomer.setState({ record: { stage: 'newcomer', seen: [] } })
    expect(modeRoles()).toEqual({ start: 'hop', second: 'walk', ring: ['hop', 'view', 'build', 'scan'] })
    for (const mode of ['view', 'build', 'scan', 'hop'] as const) {
      cycleMode()
      expect(currentPadMode()).toBe(mode)
    }
    pressSecond()
    expect(currentPadMode()).toBe('walk')
    walkCancel()
    expect(currentPadMode()).toBe('hop')
  })
})
