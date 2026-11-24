/**
 * hopKeepsCursor.test.ts - a switch into HOP keeps the cursor where it is
 * (owner, 2026-11-24: "when I switch to hop mode, the cursor is recalled,
 * but that isn't helpful. switching between all the other modes doesn't
 * recall my cursor").
 *
 * The recall was a leftover of RETURN ending the free view (#102: "RETURN
 * recalls the cursor with the anchor"), which the ring took over when it
 * ended VIEW, BUILD and SCAN for HOP. RECALL and X still bring it home, and
 * so do RETURN, EXIT and Esc. With the cursor kept off your avatar, COMMIT
 * takes the slot the mode button stood in, so a quick second tap meant for
 * the ring is not taken for a commit (padMode commitSettling).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

import { samePosition, useCyberspace } from '../useCyberspace'
import { resetModes, setModeOn, updateModes } from '../modeOrder'
import { useBuilder } from '../useBuilder'
import { useShards } from '../useShards'
import { useWalk } from '../useWalk'
import { useScan } from '../useScan'
import { useRegion } from '../useRegion'
import { commitSettling, currentPadMode, cycleMode, HOP_COMMIT_SETTLE_MS, recall, switchMode, type PadMode } from '../padMode'
import { escapeTop } from '../../hooks/useEscape'
import { stopSpectating } from '../../lib/spectator'
import { buildStage, type BuildFacts } from '../../tutorial/buildRoute'
import { leavePlanting } from '../../tutorial/director'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()

/** Into `mode` from HOP, with the cursor moved off your avatar there (WALK's cursor is its head and stays). */
function inModeAway(mode: PadMode): void {
  switchMode(mode)
  expect(currentPadMode()).toBe(mode)
  if (mode === 'walk') return
  for (let i = 0; i < 3; i++) S().moveCursor({ axis: 'x', dir: 1 })
  S().moveCursor({ axis: 'z', dir: -1 })
  expect(samePosition(S().cursor, S().position)).toBe(false)
}

/** In HOP at your head, the cursor where it was, the lined-up plane unchanged. */
function expectHopAt(cursor: { x: bigint; y: bigint; z: bigint }, plane: number): void {
  const s = S()
  expect(currentPadMode()).toBe('hop')
  expect(s.focus).toBeNull()
  expect(s.atHead()).toBe(true)
  expect(s.anchor).toEqual(s.position)
  expect(s.cursor).toEqual(cursor)
  expect(s.plane).toBe(plane)
}

beforeEach(async () => {
  stopSpectating()
  useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle', deployError: null, deployInto: null })
  useWalk.getState().exit()
  B().exit()
  useScan.getState().exit()
  useRegion.getState().exit()
  S().clearFocus()
  await placeSpawn()
  S().cancel()
  useCyberspace.setState({ scaleExp: 2 })
  // The ring as the tour teaches it (the teaching list has TERRAIN off): HOP, VIEW, BUILD, SCAN.
  resetModes()
  updateModes((m) => setModeOn(m, 'terrain', false))
  expect(currentPadMode()).toBe('hop')
})

afterEach(() => { vi.useRealTimers() })

describe('a switch into HOP keeps the cursor', () => {
  for (const from of ['build', 'view', 'walk', 'scan'] as const) {
    it(`from ${from.toUpperCase()}`, () => {
      inModeAway(from)
      const at = { ...S().cursor }
      const plane = S().plane
      switchMode('hop')
      expectHopAt(at, plane)
    })
  }

  it('round the ring with the mode button, from SCAN back to HOP', () => {
    cycleMode() // VIEW
    cycleMode() // BUILD
    cycleMode() // SCAN
    expect(currentPadMode()).toBe('scan')
    for (let i = 0; i < 2; i++) S().moveCursor({ axis: 'y', dir: 1 })
    const at = { ...S().cursor }
    cycleMode()
    expectHopAt(at, S().plane)
  })

  it('N out of SCAN and B out of BUILD, the keys that switch by name', () => {
    inModeAway('scan')
    let at = { ...S().cursor }
    // N's way out (useKeyboard): scanToHop, the ring's own.
    switchMode('hop')
    expectHopAt(at, S().plane)
    recall()
    inModeAway('build')
    at = { ...S().cursor }
    B().toggle()
    expectHopAt(at, S().plane)
  })

  it('VIEW’s own plane stays the view’s: HOP is back in the plane you lined up', () => {
    inModeAway('view')
    const lined = S().plane
    S().togglePlane()
    expect(S().anchorPlane).not.toBe(lined)
    const at = { ...S().cursor }
    switchMode('hop')
    expectHopAt(at, lined)
    expect(S().anchorPlane).toBe(lined)
  })
})

describe('RECALL still brings it home', () => {
  it('RECALL on the pad, in HOP, after a switch kept the cursor', () => {
    inModeAway('view')
    switchMode('hop')
    expect(samePosition(S().cursor, S().position)).toBe(false)
    recall()
    expect(S().cursor).toEqual(S().position)
    expect(currentPadMode()).toBe('hop')
  })

  it('X (cancel) in HOP', () => {
    inModeAway('build')
    switchMode('hop')
    S().cancel()
    expect(S().cursor).toEqual(S().position)
  })

  it('RECALL in VIEW and BUILD still stays in the mode, at home', () => {
    inModeAway('view')
    recall()
    expect(currentPadMode()).toBe('view')
    expect(S().cursor).toEqual(S().position)
    switchMode('hop')
    inModeAway('build')
    recall()
    expect(currentPadMode()).toBe('build')
    expect(S().cursor).toEqual(S().position)
  })

  it('EXIT and Esc out of BUILD still come home, as their titles say', () => {
    inModeAway('build')
    B().exit()
    expect(currentPadMode()).toBe('hop')
    expect(S().cursor).toEqual(S().position)
    inModeAway('build')
    expect(escapeTop()).toBe(true)
    expect(currentPadMode()).toBe('hop')
    expect(S().cursor).toEqual(S().position)
  })
})

describe('COMMIT in the mode button’s slot', () => {
  it('ignores a press for a moment after a switch into HOP, then takes it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    inModeAway('scan')
    switchMode('hop')
    expect(commitSettling()).toBe(true)
    vi.setSystemTime(1_000_000 + HOP_COMMIT_SETTLE_MS - 1)
    expect(commitSettling()).toBe(true)
    vi.setSystemTime(1_000_000 + HOP_COMMIT_SETTLE_MS)
    expect(commitSettling()).toBe(false)
  })
})

describe('the tour', () => {
  /** The facts BUILD SOMETHING reads at its 'build' stage: the shard moved, the menu shut. */
  const facts = (): BuildFacts => ({
    menuOpen: false, itemsOpen: null, shardActionsOpen: false, inWorkshop: true,
    building: B().active, armed: !samePosition(S().cursor, S().position), picking: false, lined: false,
  })

  it('BUILD SOMETHING: round the ring into HOP with the cursor kept, the tour asks for RECALL, then the mode button', () => {
    inModeAway('scan')
    switchMode('hop')
    expect(buildStage(facts())).toBe('recall')
    recall()
    expect(buildStage(facts())).toBe('build')
    cycleMode() // VIEW
    cycleMode() // BUILD
    expect(buildStage(facts())).toBe('object')
  })

  it('the bud still leaves BUILD for HOP at your avatar', () => {
    inModeAway('build')
    leavePlanting()
    expect(currentPadMode()).toBe('hop')
    expect(S().cursor).toEqual(S().position)
  })
})
