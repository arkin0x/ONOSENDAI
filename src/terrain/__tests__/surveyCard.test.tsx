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
 * - The core reads out the slice under a finger or a mouse (owner, 2026-11-28:
 *   "id like to tap or slide my finger across the core sample to see the name
 *   of the resource representing the layer"): a tap, a slide past the ends, a
 *   hatched layer, a hover, the arrows, and a readout that never moves the card.
 */

import { readFileSync } from 'node:fs'
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
import { CORE_CAPTION, SurveyCard } from '../SurveyCard'
import { setTerrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { emptyInventory } from '../../lib/terrain/terrainDb'
import { TerrainWorld } from '../../lib/terrain/world'
import { CELLS, idx, type ChunkBase } from '../../lib/terrain/coords'
import { coreSliceAt, forgetAssays } from '../../lib/terrain/assay'
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

/** A field with one chunk: Gridstone, a buried Glowcore, an open layer on top; `edit` changes its blocks first. */
function fieldWithGlowcore(at: number | null, edit?: (b: Uint8Array) => void): string {
  const world = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
  const slot = world.slotAt(0, 0, 0, true)!
  const b = new Uint8Array(CELLS).fill(1)
  for (let o = 31 * 1024; o < CELLS; o++) b[o] = 0
  b[idx(10, 10, 10)] = 42
  edit?.(b)
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

describe('the core', () => {
  const CINDERROCK = 7
  const LEFT = 100, WIDTH = 320 // 10 px a slice
  const xOf = (layer: number): number => LEFT + (layer - 1) * 10 + 5
  const cls = (h: Host): string[] => String(h.props.className ?? '').split(' ')
  const slider = (m: Mounted): Host => m.all().find((h) => h.props.role === 'slider')!
  const readout = (m: Mounted): Host => m.all().find((h) => cls(h).includes('survey-card__readout'))!
  const bands = (m: Mounted): Host[] => m.all().filter((h) => cls(h).includes('survey-band'))
  const lit = (m: Mounted): number[] => bands(m).flatMap((h, i) => (cls(h).includes('is-active') ? [i + 1] : []))
  const target = { getBoundingClientRect: () => ({ left: LEFT, width: WIDTH }), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() }
  const fire = async (m: Mounted, name: string, e: Record<string, unknown>): Promise<void> => {
    ;(slider(m).props[name] as (e: unknown) => void)({ pointerId: 1, pointerType: 'touch', preventDefault: () => {}, currentTarget: target, ...e })
    await wait(5)
  }

  async function open(): Promise<Mounted> {
    target.setPointerCapture.mockClear()
    target.releasePointerCapture.mockClear()
    // Gridstone with the top layer open (layer 1) and y 25, the seventh layer down, Cinderrock.
    const key = fieldWithGlowcore(null, (b) => { for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) b[idx(x, 25, z)] = CINDERROCK })
    openSurveyCard(key)
    return mount(createElement(SurveyCard))
  }

  it('picks the slice under a pointer at any x, the end slices past either end', () => {
    expect(coreSliceAt(xOf(1), LEFT, WIDTH, 32)).toBe(0)
    expect(coreSliceAt(xOf(7), LEFT, WIDTH, 32)).toBe(6)
    expect(coreSliceAt(LEFT + WIDTH, LEFT, WIDTH, 32)).toBe(31)
    expect(coreSliceAt(-50, LEFT, WIDTH, 32)).toBe(0)
    expect(coreSliceAt(5000, LEFT, WIDTH, 32)).toBe(31)
    expect(coreSliceAt(150, LEFT, 0, 32)).toBe(0)
  })

  it('a tap reads out its slice with the swatch and lights it; a slide follows the finger, past the ends too', async () => {
    const m = await open()
    try {
      expect(textOf(readout(m))).toBe(CORE_CAPTION)
      expect(lit(m)).toEqual([])
      const s = slider(m)
      expect(s.props['aria-hidden']).toBeUndefined()
      expect(s.props.tabIndex).toBe(0)
      expect([s.props['aria-valuemin'], s.props['aria-valuemax']]).toEqual([1, 32])

      await fire(m, 'onPointerDown', { clientX: xOf(7) })
      expect(target.setPointerCapture).toHaveBeenCalledWith(1)
      expect(textOf(readout(m))).toBe('Layer 7: Cinderrock')
      expect(readout(m).children.some((h) => typeof h !== 'string' && cls(h).includes('terrain-swatch'))).toBe(true)
      expect(lit(m)).toEqual([7])
      expect(slider(m).props['aria-valuenow']).toBe(7)
      expect(slider(m).props['aria-valuetext']).toBe('Layer 7: Cinderrock')

      await fire(m, 'onPointerMove', { clientX: xOf(12) })
      expect(textOf(readout(m))).toBe('Layer 12: Gridstone')
      expect(lit(m)).toEqual([12])
      // Captured: the finger slid off the right end keeps the bottom slice.
      await fire(m, 'onPointerMove', { clientX: LEFT + WIDTH + 80 })
      expect(textOf(readout(m))).toBe('Layer 32: Gridstone')
      await fire(m, 'onPointerUp', { clientX: LEFT + WIDTH + 80 })
      expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
      // A finger lifted keeps its slice up to read, and a touch moving without a press picks nothing.
      await fire(m, 'onPointerLeave', {})
      await fire(m, 'onPointerMove', { clientX: xOf(3) })
      expect(textOf(readout(m))).toBe('Layer 32: Gridstone')
      // Focus moving on puts the caption back.
      ;(slider(m).props.onBlur as () => void)()
      await wait(5)
      expect(textOf(readout(m))).toBe(CORE_CAPTION)
      expect(lit(m)).toEqual([])
    } finally {
      await m.unmount()
    }
  })

  it('a hatched layer reads "mostly open" with the hatched mark, never a kind', async () => {
    const m = await open()
    try {
      expect(cls(bands(m)[0])).toContain('is-open')
      await fire(m, 'onPointerDown', { clientX: xOf(1) })
      expect(textOf(readout(m))).toBe('Layer 1: mostly open')
      expect(readout(m).children.some((h) => typeof h !== 'string' && cls(h).includes('survey-card__readout-open'))).toBe(true)
      expect(readout(m).children.some((h) => typeof h !== 'string' && cls(h).includes('terrain-swatch'))).toBe(false)
      expect(slider(m).props['aria-valuetext']).toBe('Layer 1: mostly open')
    } finally {
      await m.unmount()
    }
  })

  it('a mouse hovering reads out the slice under it and lets go as it leaves', async () => {
    const m = await open()
    try {
      await fire(m, 'onPointerMove', { pointerType: 'mouse', clientX: xOf(7) })
      expect(textOf(readout(m))).toBe('Layer 7: Cinderrock')
      await fire(m, 'onPointerLeave', { pointerType: 'mouse' })
      expect(textOf(readout(m))).toBe(CORE_CAPTION)
    } finally {
      await m.unmount()
    }
  })

  it('the arrows, Home and End move along it as a slider, held at the ends', async () => {
    const m = await open()
    try {
      const key = async (k: string): Promise<boolean> => {
        let stopped = false
        ;(slider(m).props.onKeyDown as (e: unknown) => void)({ key: k, preventDefault: () => { stopped = true } })
        await wait(5)
        return stopped
      }
      ;(slider(m).props.onFocus as () => void)()
      await wait(5)
      expect(textOf(readout(m))).toBe('Layer 1: mostly open')
      expect(await key('ArrowRight')).toBe(true)
      expect(slider(m).props['aria-valuenow']).toBe(2)
      for (let i = 0; i < 5; i++) await key('ArrowRight')
      expect(textOf(readout(m))).toBe('Layer 7: Cinderrock')
      expect(slider(m).props['aria-valuetext']).toBe('Layer 7: Cinderrock')
      await key('ArrowLeft')
      expect(slider(m).props['aria-valuenow']).toBe(6)
      await key('End')
      await key('ArrowRight')
      expect(slider(m).props['aria-valuenow']).toBe(32)
      await key('Home')
      await key('ArrowLeft')
      expect(slider(m).props['aria-valuenow']).toBe(1)
      // Esc and every other key go on to the card.
      expect(await key('Escape')).toBe(false)
      expect(await key('Tab')).toBe(false)
      // Focus coming back returns to the same slice.
      await key('ArrowRight')
      ;(slider(m).props.onBlur as () => void)()
      await wait(5)
      expect(textOf(readout(m))).toBe(CORE_CAPTION)
      expect(slider(m).props['aria-valuenow']).toBe(2)
      ;(slider(m).props.onFocus as () => void)()
      await wait(5)
      expect(textOf(readout(m))).toBe('Layer 2: Gridstone')
    } finally {
      await m.unmount()
    }
  })

  it('the readout is the same element at one fixed height whatever it says, so nothing on the card moves', async () => {
    const m = await open()
    try {
      const before = readout(m)
      const tray = m.all().find((h) => cls(h).includes('survey-card__tray'))!
      const shape = (): string[] => tray.children.map((c) => (typeof c === 'string' ? c : cls(c)[0]))
      const was = shape()
      await fire(m, 'onPointerDown', { clientX: xOf(7) })
      expect(readout(m)).toBe(before)
      expect(shape()).toEqual(was)
      expect(was).toEqual(['survey-card__readout', 'survey-card__core', 'survey-card__tray-labels'])
      const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
      const rule = (sel: string): string => css.match(new RegExp(`\\n${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? ''
      expect(rule('.survey-card__readout')).toMatch(/\bheight: 14px;/)
      expect(rule('.survey-card__readout')).toMatch(/white-space: nowrap;/)
      expect(rule('.survey-card__readout')).toMatch(/overflow: hidden;/)
      // The bolder active line sets no height of its own: the same 14px box.
      expect(css.match(/\.survey-card__readout\.is-active \{([^}]*)\}/)?.[1] ?? '').not.toMatch(/height|margin|padding/)
      // Only the core takes the finger's slide; the card body still scrolls.
      expect(rule('.survey-card__core')).toMatch(/touch-action: none;/)
      expect(rule('.survey-card__body')).not.toMatch(/touch-action/)
    } finally {
      await m.unmount()
    }
  })
})
