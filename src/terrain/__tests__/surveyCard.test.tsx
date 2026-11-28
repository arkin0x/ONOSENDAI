/**
 * surveyCard.test.tsx - CARD and the survey card on screen (owner,
 * 2026-11-27: "Inside the already-surveyed region, the survey button should
 * change to Card and pressing it shows the card"):
 *
 * - SURVEY's slot says CARD, with its own icon, while you stand in a surveyed
 *   chunk, and SURVEY (the hold) otherwise; the same one button either way.
 * - A tap on CARD (or G) opens the card at once; held past a tap with a chunk
 *   ahead open to survey, it becomes SURVEY's hold for that chunk, and letting
 *   go before the end cancels it; held with none ahead, it opens the card.
 * - The card shows the ground, the hardness, the stamp's date, the recipe
 *   line for a Glowcore here, each kind with visible or buried, and no position.
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
  // The field is read live (a copy would keep the null it had when mocked).
  return { ...real, get terrainSession() { return real.terrainSession }, cardChunkHere: () => aim.card, surveyTarget: () => aim.target }
})

import { createElement } from 'react'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { TerrainView, LONG_PRESS_MS, pressCard, releaseCard, abandonCard } from '../TerrainView'
import { SurveyCard } from '../SurveyCard'
import { setTerrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { emptyInventory } from '../../lib/terrain/terrainDb'
import { TerrainWorld } from '../../lib/terrain/world'
import { CELLS, idx, type ChunkBase } from '../../lib/terrain/coords'
import { forgetAssays } from '../../lib/terrain/assay'
import { cancelSurveyHold, useSurveyHold } from '../surveyHold'
import { openSurveyCard, resetSurveyCards, stampDate, useSurveyCard } from '../surveyCard'
import { topEscape } from '../../hooks/useEscape'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const slotButton = (m: Mounted): Host | undefined => m.all().find((h) => h.type === 'button' && String(h.props.className ?? '').includes('terrain-act--survey'))
const iconOf = (m: Mounted): string | undefined => {
  const b = slotButton(m)
  if (!b) return undefined
  const out: Host[] = []
  const walk = (h: Host | string): void => { if (typeof h === 'string') return; out.push(h); h.children.forEach(walk) }
  walk(b)
  return out.map((h) => h.props['data-icon'] as string | undefined).find(Boolean)
}
/** Press the slot's button as a finger does: down, then up after `ms`. */
async function hold(m: Mounted, ms: number): Promise<void> {
  const b = slotButton(m)!
  const ev = { preventDefault: () => {}, stopPropagation: () => {}, pointerId: 1, currentTarget: { releasePointerCapture: () => {} } }
  ;(b.props.onPointerDown as (e: unknown) => void)(ev)
  await wait(ms)
  ;(slotButton(m)!.props.onPointerUp as () => void)()
  await wait(5)
}

const BASE: ChunkBase = { x: 0x1234567890abcdef12340n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n, plane: 0 }

/** A field with one chunk: Gridstone, a buried Glowcore, an open layer on top. */
function fieldWithGlowcore(at: number | null): string {
  const world = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
  const slot = world.slotAt(0, 0, 0, true)!
  const b = new Uint8Array(CELLS).fill(1)
  for (let o = 31 * 1024; o < CELLS; o++) b[o] = 0
  b[idx(10, 10, 10)] = 42
  world.setBlocks(slot.key, b, b.slice())
  slot.ground = { family: 'volcanic', maxK: 11, meanK: 7.6, top: 7 }
  const revisions = new Map([[slot.key, { revision: 2, surveyed: at === null ? 0 : Math.floor(at / 1000) }]])
  setTerrainSession({ world, revisions, surveyedKeys: new Set([slot.key]), building: new Set() } as unknown as TerrainSession)
  return slot.key
}

beforeEach(() => {
  forgetAssays()
  resetSurveyCards()
  useCyberspace.setState({ walking: true })
  useTerrain.setState({ active: true, loading: false, sheet: false, surveying: [], inventory: emptyInventory() })
})
afterEach(() => {
  cancelSurveyHold()
  abandonCard()
  aim.card = null
  aim.target = null
  setTerrainSession(null)
  useTerrain.setState({ active: false, inventory: emptyInventory() })
  useCyberspace.setState({ walking: false })
})

describe('SURVEY\'s slot', () => {
  it('says CARD in a surveyed chunk and SURVEY in one open to survey, in the one same slot', async () => {
    aim.card = 'here'
    const m = await mount(createElement(TerrainView))
    try {
      await wait(300)
      expect(textOf(slotButton(m)!)).toContain('CARD')
      expect(iconOf(m)).toBe('card')
      expect(String(slotButton(m)!.props.className)).toContain('is-card')
      aim.card = null
      aim.target = 'ahead'
      await wait(300)
      expect(textOf(slotButton(m)!)).toContain('SURVEY')
      expect(iconOf(m)).toBe('survey')
      expect(String(slotButton(m)!.props.className)).not.toContain('is-card')
      // Neither: the slot stays, empty, so nothing moves.
      aim.target = null
      await wait(300)
      expect(slotButton(m)).toBeUndefined()
      expect(m.all().some((h) => String(h.props.className ?? '').includes('terrain-tools__slot--survey'))).toBe(true)
    } finally {
      await m.unmount()
    }
  })

  it('a tap on CARD opens the card at once, with no hold', async () => {
    aim.card = 'here'
    const m = await mount(createElement(TerrainView))
    try {
      await wait(300)
      await hold(m, 20)
      expect(useSurveyCard.getState().open).toBe('here')
      expect(useSurveyHold.getState().since).toBeNull()
    } finally {
      await m.unmount()
    }
  })

  it('held past a tap with a chunk ahead, CARD becomes SURVEY\'s hold for it; let go early, nothing is surveyed and no card opens', async () => {
    aim.card = 'here'
    aim.target = 'ahead'
    const real = useTerrain.getState().survey
    const survey = vi.fn(async () => {})
    useTerrain.setState({ survey })
    try {
      pressCard()
      await wait(LONG_PRESS_MS + 40)
      expect(useSurveyHold.getState()).toMatchObject({ key: 'ahead' })
      expect(useSurveyHold.getState().since).not.toBeNull()
      expect(releaseCard()).toBe(true)
      expect(useSurveyHold.getState().since).toBeNull()
      expect(useSurveyCard.getState().open).toBeNull()
      expect(survey).not.toHaveBeenCalled()
    } finally {
      useTerrain.setState({ survey: real })
    }
  })

  it('a press left over (a hold whose lift landed on the card that opened) never swallows the next tap', async () => {
    aim.card = 'here'
    aim.target = 'ahead'
    const real = useTerrain.getState().survey
    useTerrain.setState({ survey: vi.fn(async () => {}) })
    try {
      // Held on into SURVEY's hold, to its end: the press goes with the hold.
      pressCard()
      await wait(LONG_PRESS_MS + 40)
      expect(useSurveyHold.getState().since).not.toBeNull()
      cancelSurveyHold()
      // A leftover press (its lift never came): the next press replaces it, and its tap opens the card.
      pressCard()
      aim.target = null
      pressCard()
      expect(releaseCard()).toBe(true)
      expect(useSurveyCard.getState().open).toBe('here')
    } finally {
      useTerrain.setState({ survey: real })
    }
  })

  it('held with nothing ahead to survey, letting go opens the card; a finger sliding off opens nothing', async () => {
    aim.card = 'here'
    pressCard()
    await wait(LONG_PRESS_MS + 40)
    expect(useSurveyHold.getState().since).toBeNull()
    releaseCard()
    expect(useSurveyCard.getState().open).toBe('here')
    useSurveyCard.setState({ open: null })
    pressCard()
    abandonCard()
    expect(releaseCard()).toBe(false)
    expect(useSurveyCard.getState().open).toBeNull()
  })
})

describe('the card', () => {
  it('shows the ground, hardness, the stamp\'s date, the recipe line, each kind visible or buried; never a position', async () => {
    const at = new Date(2026, 10, 27, 12).getTime()
    const key = fieldWithGlowcore(at)
    openSurveyCard(key)
    const m = await mount(createElement(SurveyCard))
    try {
      expect(m.says('FIELD SURVEY')).toBe(true)
      expect(m.says('Volcanic')).toBe(true)
      // The owner's copy (2026-11-28).
      expect(m.says('SURVEYED')).toBe(true)
      expect(m.says('ASSAY')).toBe(false)
      expect(m.says('Ground type:Volcanic')).toBe(true)
      expect(m.says('Core sample: this chunk\'s 32 layers')).toBe(true)
      expect(m.says('TOPBOTTOM')).toBe(true)
      expect(m.says('Richer than the average hardness of 10.')).toBe(true)
      expect(m.says('COMMON MATERIALS')).toBe(true)
      expect(m.says('COMMON ROCK')).toBe(false)
      expect(m.all().filter((h) => String(h.props.className ?? '').includes('survey-card__section-n')).map(textOf)).toEqual(['COUNTED', 'COUNTED'])
      expect(m.says('Survey material audit.')).toBe(true)
      expect(m.says('What is here')).toBe(false)
      expect(m.says('27 NOV 2026')).toBe(true)
      expect(m.says('Ground revision 2')).toBe(true)
      expect(stampDate(at)).toBe('27 NOV 2026')
      expect(m.says('Glowcore here: the Compiler needs one.')).toBe(true)
      const rows = m.all().filter((h) => String(h.props.className ?? '').split(' ').includes('survey-row'))
      expect(rows.map(textOf)).toEqual([expect.stringMatching(/^Glowcoreburied1$/), expect.stringMatching(/^Gridstonevisible31,743$/)])
      const meter = m.all().find((h) => h.props.role === 'meter')!
      expect(meter.props['aria-valuenow']).toBe(11)
      expect(m.says('11')).toBe(true)
      // No coordinates or directions anywhere on it.
      expect(/\d+,\s*\d+,\s*\d+|north|south|east|west|\bx\b|\by\b/i.test(m.all().map(textOf).join(' '))).toBe(false)
      expect(m.says(key)).toBe(false)
    } finally {
      await m.unmount()
    }
  })

  it('a card that cannot be read draws nothing and takes no Esc', async () => {
    setTerrainSession(null)
    openSurveyCard('nowhere')
    const m = await mount(createElement(SurveyCard))
    try {
      expect(m.says('FIELD SURVEY')).toBe(false)
      expect(topEscape()).toBeNull()
    } finally {
      await m.unmount()
    }
  })

  it('with the Compiler made, no line for it; the card closes by its ✕', async () => {
    const key = fieldWithGlowcore(null)
    useTerrain.setState({ inventory: { ...emptyInventory(), compiler: 'granted' } as ReturnType<typeof emptyInventory> })
    openSurveyCard(key)
    const m = await mount(createElement(SurveyCard))
    try {
      expect(m.says('Glowcore here')).toBe(false)
      expect(m.says('DATE UNKNOWN')).toBe(true)
      const close = m.all().find((h) => h.type === 'button' && String(h.props.className ?? '').includes('modal-close'))!
      ;(close.props.onClick as () => void)()
      await wait(5)
      expect(useSurveyCard.getState().open).toBeNull()
      expect(m.says('FIELD SURVEY')).toBe(false)
    } finally {
      await m.unmount()
    }
  })
})
