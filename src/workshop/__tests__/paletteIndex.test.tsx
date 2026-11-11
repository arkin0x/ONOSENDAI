/**
 * paletteIndex.test.tsx: the palette sheet shows each color's number without
 * hovering (arkinox, 2026-11-11: on a phone the tooltip never shows, and a
 * SEEDO DNA names its colors by number, '(171)). The color in hand is read out
 * by number and hex in the head, and every swatch carries its number in an ink
 * that reads on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
import { mount, settled, textOf, type Host } from '../../test/elementRoot'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
// The harness renders with no DOM: the bits the stores reach for.
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

// The sheet renders through a portal into document.body; here, the element itself.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))
vi.mock('../../lib/relay', () => ({ onAuthChange: () => () => {}, signInFailed: () => false, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

const { PaletteModal, inkContrast, lightInk } = await import('../PaletteModal')
const { useWorkshop } = await import('../../store/useWorkshop')

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
const cls = (h: Host): string => String(h.props.className ?? '')
const swatches = (all: Host[]): Host[] => all.filter((h) => h.type === 'button' && cls(h).includes('palettes__sw'))
const numberOf = (h: Host): string | null => {
  const n = h.children.find((c): c is Host => typeof c !== 'string' && cls(c) === 'palettes__n')
  return n ? textOf(n) : null
}
const readout = (all: Host[]): Host | undefined => all.find((h) => cls(h) === 'palettes__now')

async function sheet(colorHex: string, recent: string[] = [], palette?: Array<[number, number, number]>) {
  const shards = palette ? [{ id: 'own', name: 'own', vertices: [], faces: [], mode: 'solid', unit: 0, extent: 8, updatedAt: 1, palette, paletteName: 'four' }] : []
  useWorkshop.setState({ shards, currentId: palette ? 'own' : null, color: rgb(colorHex), palette: recent, palettes: [] } as never)
  return mount(<PaletteModal onClose={() => {}} />)
}

afterEach(() => { useWorkshop.setState({ shards: [], currentId: null, palette: [] } as never) })

describe('the palette sheet names colors by number', () => {
  it('reads out the color in hand by number and hex, without hover', async () => {
    const hex = hexAt(BUILT_IN, 171)
    const m = await sheet(hex)
    const now = readout(m.all())
    expect(now).toBeDefined()
    const words = textOf(now!)
    expect(words).toContain('COLOR')
    expect(words).toContain('171')
    expect(words).toContain(hex)
    await m.unmount()
  })

  it('says so when the color in hand is not in this palette', async () => {
    // A hex the built-in does not hold: the readout gives the hex and no number.
    const off = '#123457'
    expect(BUILT_IN.some((_, i) => hexAt(BUILT_IN, i) === off)).toBe(false)
    const m = await sheet(off)
    const now = readout(m.all())!
    expect(now.children.some((c) => typeof c !== 'string' && cls(c) === 'palettes__now-n')).toBe(false)
    expect(textOf(now)).toContain(`${off} · not in this palette`)
    await m.unmount()
  })

  it('writes every swatch its own number, and marks the one in hand', async () => {
    const m = await sheet(hexAt(BUILT_IN, 171))
    const sw = swatches(m.all())
    expect(sw).toHaveLength(256)
    sw.forEach((h, i) => expect(numberOf(h)).toBe(String(i)))
    const on = sw.filter((h) => cls(h).includes('is-on'))
    expect(on).toHaveLength(1)
    expect(numberOf(on[0])).toBe('171')
    await m.unmount()
  })

  it('numbers the recent row by its place in the palette', async () => {
    const recent = [hexAt(BUILT_IN, 12), hexAt(BUILT_IN, 240)]
    const m = await sheet(recent[0], recent)
    const sw = swatches(m.all())
    // The recent row comes first, then the 256.
    expect(sw).toHaveLength(258)
    expect(numberOf(sw[0])).toBe('12')
    expect(numberOf(sw[1])).toBe('240')
    expect(sw[1].props['aria-label']).toBe(`Recently used color 240, ${recent[1]}`)
    await m.unmount()
  })

  it('shows no numbers while building a palette, whose numbers are the picks\' order', async () => {
    const m = await sheet(hexAt(BUILT_IN, 0))
    await m.press('NEW PALETTE')
    expect(readout(m.all())).toBeUndefined()
    expect(swatches(m.all()).every((h) => numberOf(h) === null)).toBe(true)
    ;(swatches(m.all())[5].props.onClick as () => void)()
    await settled()
    const after = swatches(m.all())
    expect(after[5].props['aria-pressed']).toBe(true)
    expect(after.every((h) => numberOf(h) === null)).toBe(true)
    await m.unmount()
  })

  it('builds a new palette from the built-in colors picked, even on an object with its own', async () => {
    // The sheet while building is the built-in, so a pick is a built-in
    // index. Taking it from the object's own palette instead gave the wrong
    // colors, and undefined past the end of a short one.
    const own: Array<[number, number, number]> = [[10, 10, 10], [250, 250, 250], [0, 175, 202], [200, 40, 40]]
    const m = await sheet('#00afca', [], own)
    await m.press('NEW PALETTE')
    const sw = swatches(m.all())
    expect(sw).toHaveLength(256)
    // Picked out of order, one inside the own palette's length and one past it.
    for (const i of [200, 2]) {
      ;(swatches(m.all())[i].props.onClick as () => void)()
      await settled()
    }
    await m.press(/^MAKE IT/)
    const made = useWorkshop.getState().palettes
    expect(made).toHaveLength(1)
    expect(made[0].colors).toEqual([BUILT_IN[200], BUILT_IN[2]])
    await m.unmount()
  })

  it('numbers a palette of the object\'s own by its own places', async () => {
    const own: Array<[number, number, number]> = [[10, 10, 10], [250, 250, 250], [0, 175, 202], [200, 40, 40]]
    const off = hexAt(BUILT_IN, 100)
    const m = await sheet('#00afca', [off, '#00afca'], own)
    const sw = swatches(m.all())
    // Two recent, then the object's four.
    expect(sw).toHaveLength(6)
    expect(numberOf(sw[0])).toBeNull()
    expect(sw[0].props['aria-label']).toBe(`Recently used color ${off}`)
    expect(numberOf(sw[1])).toBe('2')
    expect(sw.slice(2).map(numberOf)).toEqual(['0', '1', '2', '3'])
    expect(cls(sw[4])).toContain('is-on')
    expect(textOf(readout(m.all())!)).toContain('2')
    expect(textOf(readout(m.all())!)).toContain('#00afca')
    await m.unmount()
  })

  it('writes the number in light ink on the darks and dark ink on the lights', async () => {
    const m = await sheet(hexAt(BUILT_IN, 0))
    const sw = swatches(m.all())
    sw.forEach((h, i) => expect(cls(h).includes('is-light')).toBe(lightInk(hexAt(BUILT_IN, i))))
    expect(cls(sw[192])).toContain('is-light')
    expect(cls(sw[223])).not.toContain('is-light')
    await m.unmount()
  })
})

describe('lightInk', () => {
  it('writes light on the darks and dark on the lights', () => {
    expect(lightInk('#000000')).toBe(true)
    expect(lightInk('#0a1020')).toBe(true)
    expect(lightInk('#ffffff')).toBe(false)
    expect(lightInk('#f0f0a0')).toBe(false)
    // Saturated blue is dark to the eye though one channel is full.
    expect(lightInk('#0000ff')).toBe(true)
    // Bright saturated mid tones take dark ink (a raw hex threshold got these wrong).
    expect(lightInk('#00afca')).toBe(false)
    expect(lightInk('#ff1ae7')).toBe(false)
  })

  it('keeps every built-in number at 3:1 contrast or better, faded as drawn', () => {
    const worst = Math.min(...BUILT_IN.map((_, i) => inkContrast(hexAt(BUILT_IN, i))))
    expect(worst).toBeGreaterThanOrEqual(3)
  })
})
