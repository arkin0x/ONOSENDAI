/**
 * chunkStay.test.tsx - leaving the chunk you were digging (owner, 2026-11-28):
 * the line under the cross only after you took a block from the chunk you
 * left (and once per crossing for a while); STAY IN THIS CHUNK on only for the
 * chunk you stand in, never during the tour, letting go on leaving TERRAIN
 * (a HOP included), a hyperjump's ride, a respawn, anything that moves you
 * out, and a tap on its chip; and a CARD press carried across into an
 * unsurveyed chunk never turns into a survey of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../terrain/HeldCompiler', () => ({ HeldCompiler: () => null }))

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}
;(globalThis as { removeEventListener?: unknown }).removeEventListener ??= () => {}
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

const aim = vi.hoisted(() => ({ card: null as string | null, target: null as string | null }))
vi.mock('../../store/useTerrain', async (orig) => {
  const real = await orig<typeof import('../../store/useTerrain')>()
  return { ...real, get terrainSession() { return real.terrainSession }, cardChunkHere: () => aim.card, surveyTarget: () => aim.target }
})

import { createElement } from 'react'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { setTerrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { useTutorial } from '../../store/useTutorial'
import { TerrainWorld } from '../../lib/terrain/world'
import { CELLS, chunkOf, type ChunkBase } from '../../lib/terrain/coords'
import type { Position } from '../../lib/space'
import { CARRIED_MS, LEFT_DUG, LEFT_DUG_UNSURVEYED, carriedAcross, chunkHere, crossingWords, leaveStay, ownerNow, resetCrossings, stayIn, stayKey, useChunkStay } from '../chunkStay'
import { dugIn, lockedFor, resetStay, setLock } from '../stayLock'
import { StayChip } from '../StayChip'
import { STAY_AWAY, STAY_OFF, STAY_ON, StayRow } from '../SurveyCard'
import { LONG_PRESS_MS, abandonCard, pressCard } from '../TerrainView'
import { cancelSurveyHold, useSurveyHold } from '../surveyHold'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const BASE: ChunkBase = chunkOf(0x1234567890abcdef12340n, 0xfedcba0987654321fed80n, 0x0f0f0f0f0f0f0f0f0f0e0n, 0)
const at = (x: number, y: number, z: number): Position => ({ x: BASE.x + BigInt(x), y: BASE.y + BigInt(y), z: BASE.z + BigInt(z) })
/** Three chunks side by side: A (surveyed, solid below y 16), B east of it (not surveyed), C south of it (surveyed). */
const IN_A = at(5, 20, 5), IN_B = at(37, 20, 5), IN_C = at(5, 20, 37)
let A = '', B = '', C = ''

function field(): TerrainSession {
  const world = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
  const ground = (): Uint8Array => { const b = new Uint8Array(CELLS); for (let o = 0; o < 16 * 1024; o++) b[o] = 1; return b }
  const a = world.slotAt(0, 0, 0, true)!, b = world.slotAt(1, 0, 0, true)!, c = world.slotAt(0, 0, 1, true)!
  for (const sl of [a, c]) { const g = ground(); world.setBlocks(sl.key, g, g.slice()); sl.own = g.slice(); sl.revision = 2 }
  A = a.key; B = b.key; C = c.key
  // A field by hand that never reads anything (its `ready` never settles, so following you stops there).
  return {
    owner: ownerNow(), plane: 0, world, pending: new Map(), layers: new Map(), surveyedKeys: new Set([a.key, c.key]), revisions: new Map([[a.key, { revision: 2, surveyed: 1 }], [c.key, { revision: 2, surveyed: 1 }]]),
    unreadable: new Set(), building: new Set(), nextSeq: 0, db: null, version: 0, ready: new Promise<void>(() => {}),
  } as unknown as TerrainSession
}

const go = (p: Position): void => useCyberspace.setState({ position: p })

beforeEach(() => {
  resetStay()
  resetCrossings()
  useCyberspace.setState({ walking: false, plane: 0, position: IN_A, transit: null })
  setTerrainSession(field())
  useTerrain.setState({ active: true, message: null, surveying: [] })
})
afterEach(() => {
  cancelSurveyHold()
  abandonCard()
  aim.card = null
  aim.target = null
  useTutorial.setState({ active: false })
  useTerrain.setState({ active: false, message: null })
  setTerrainSession(null)
})

describe('the line when you cross', () => {
  it('says nothing for a chunk you never dug in, and nothing on entering TERRAIN', () => {
    expect(useChunkStay.getState().here).toBe(A)
    expect(useTerrain.getState().message).toBeNull()
    go(IN_B)
    expect(useChunkStay.getState().here).toBe(B)
    expect(useTerrain.getState().message).toBeNull()
  })

  it('after a block mined in the chunk, leaving it says so, and that the next one is not surveyed', () => {
    expect(useTerrain.getState().mine({ cell: [5, 10, 5] } as never)).toBe(true)
    expect(dugIn(ownerNow(), A)).toBe(true)
    go(IN_B)
    expect(useTerrain.getState().message).toBe(LEFT_DUG_UNSURVEYED)
    // Back into the dug chunk: you are where you were digging, nothing to say.
    useTerrain.setState({ message: null })
    go(IN_A)
    expect(useTerrain.getState().message).toBeNull()
    // Pacing along the edge: the same crossing is not said again for a while.
    go(IN_B)
    expect(useTerrain.getState().message).toBeNull()
  })

  it('into a surveyed chunk: only that you left the one you were digging', () => {
    useTerrain.getState().mine({ cell: [6, 10, 6] } as never)
    go(IN_C)
    expect(useTerrain.getState().message).toBe(LEFT_DUG)
  })

  it('words by what you left and where you are', () => {
    expect(crossingWords(false, false)).toBeNull()
    expect(crossingWords(true, true)).toBe(LEFT_DUG)
    expect(crossingWords(true, null)).toBe(LEFT_DUG)
    expect(crossingWords(true, false)).toBe(LEFT_DUG_UNSURVEYED)
  })
})

describe('STAY IN THIS CHUNK', () => {
  it('on only for the chunk you stand in', () => {
    expect(stayIn(C)).toBe(false)
    expect(stayKey()).toBeNull()
    expect(stayIn(A)).toBe(true)
    expect(stayKey()).toBe(A)
    leaveStay()
    expect(stayKey()).toBeNull()
  })

  it('never during the tour: off as it starts, and cannot be switched on', () => {
    stayIn(A)
    useTutorial.setState({ active: true })
    expect(stayKey()).toBeNull()
    expect(stayIn(A)).toBe(false)
  })

  it('lets go on leaving TERRAIN (a HOP, T, Esc, WALK ending)', () => {
    stayIn(A)
    useTerrain.setState({ active: false })
    expect(stayKey()).toBeNull()
  })

  it('lets go on a hyperjump\'s ride', () => {
    stayIn(A)
    useCyberspace.setState({ transit: { phase: 'boarding' } as never })
    expect(stayKey()).toBeNull()
    useCyberspace.setState({ transit: null })
  })

  it('lets go on a respawn (a new chain)', () => {
    const was = useCyberspace.getState()
    useCyberspace.setState({ events: [{ id: 'g1' }] as never, genesisId: 'g1' })
    stayIn(A)
    useCyberspace.setState({ events: [{ id: 'g2' }] as never, genesisId: 'g2' })
    expect(stayKey()).toBeNull()
    useCyberspace.setState({ events: was.events, genesisId: was.genesisId })
  })

  it('lets go when anything else puts you outside the chunk (the lock holds every step, so it was not a walk)', () => {
    stayIn(A)
    go(IN_C)
    expect(stayKey()).toBeNull()
  })

  it('is each identity\'s own, in memory only', () => {
    setLock('someone-else', C)
    expect(lockedFor('someone-else')).toBe(C)
    expect(stayKey()).toBeNull()
  })

  it('the chip shows while it is on, and a tap lets go', async () => {
    const m = await mount(createElement(StayChip))
    try {
      expect(m.all().find((h) => h.type === 'button')).toBeUndefined()
      stayIn(A)
      await wait(10)
      const chip = m.all().find((h) => h.type === 'button' && String(h.props.className).includes('terrain-stay-chip')) as Host
      expect(chip).toBeTruthy()
      ;(chip.props.onClick as (e: unknown) => void)({ stopPropagation: () => {}, currentTarget: { blur: () => {} } })
      expect(stayKey()).toBeNull()
      await wait(10)
      expect(m.all().find((h) => h.type === 'button')).toBeUndefined()
    } finally {
      await m.unmount()
    }
  })

  it('the survey card\'s switch: off, on, and not offered for a chunk you are not in', async () => {
    const row = (m: Awaited<ReturnType<typeof mount>>): Host => m.all().find((h) => h.type === 'button' && String(h.props.className).includes('survey-stay')) as Host
    const m = await mount(createElement(StayRow, { chunk: A }))
    try {
      expect(row(m).props['aria-checked']).toBe(false)
      expect(textOf(row(m))).toContain(STAY_OFF)
      ;(row(m).props.onClick as () => void)()
      await wait(10)
      expect(stayKey()).toBe(A)
      expect(row(m).props['aria-checked']).toBe(true)
      expect(textOf(row(m))).toContain(STAY_ON)
      ;(row(m).props.onClick as () => void)()
      await wait(10)
      expect(stayKey()).toBeNull()
    } finally {
      await m.unmount()
    }
    const away = await mount(createElement(StayRow, { chunk: C }))
    try {
      expect(row(away).props.disabled).toBe(true)
      expect(textOf(row(away))).toContain(STAY_AWAY)
    } finally {
      await away.unmount()
    }
  })
})

describe('no survey from a press carried across', () => {
  it('a CARD press held across into an unsurveyed chunk never becomes its survey hold', async () => {
    aim.card = A
    pressCard()
    // Walking on while holding: across into B, which SURVEY would now offer.
    go(IN_B)
    aim.card = null
    aim.target = B
    await wait(LONG_PRESS_MS + 40)
    expect(useSurveyHold.getState().since).toBeNull()
  })

  it('a fresh press after the crossing is a press like any other (still the full hold)', async () => {
    go(IN_B)
    aim.card = A
    aim.target = B
    await wait(5)
    pressCard()
    await wait(LONG_PRESS_MS + 40)
    expect(useSurveyHold.getState()).toMatchObject({ key: B })
  })

  it('carried means crossed after the press began, within the last few seconds', () => {
    const t = performance.now()
    go(IN_B)
    expect(carriedAcross(t - 1)).toBe(true)
    expect(carriedAcross(t - 1, performance.now() + CARRIED_MS + 1)).toBe(false)
    expect(carriedAcross(performance.now() + 1)).toBe(false)
    expect(chunkHere()).toBe(B)
  })
})
