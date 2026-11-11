/**
 * paletteIndex.test.tsx: the palette sheet shows each color's number without
 * hovering (arkinox, 2026-11-11: on a phone the tooltip never shows, and a
 * SEEDO DNA names its colors by number, '(171)). The color in hand is read out
 * by number and hex in the head, and every swatch carries its number in an ink
 * that reads on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
import { mount, textOf, type Host } from '../../test/elementRoot'

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

const { PaletteModal, lightInk } = await import('../PaletteModal')
const { useWorkshop } = await import('../../store/useWorkshop')

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
const cls = (h: Host): string => String(h.props.className ?? '')
const swatches = (all: Host[]): Host[] => all.filter((h) => h.type === 'button' && cls(h).includes('palettes__sw'))
const numberOf = (h: Host): string | null => {
  const n = h.children.find((c): c is Host => typeof c !== 'string' && cls(c) === 'palettes__n')
  return n ? textOf(n) : null
}
const readout = (all: Host[]): Host | undefined => all.find((h) => cls(h) === 'palettes__now')

async function sheet(colorHex: string, recent: string[] = []) {
  useWorkshop.setState({ shards: [], currentId: null, color: rgb(colorHex), palette: recent, palettes: [] } as never)
  return mount(<PaletteModal onClose={() => {}} />)
}

afterEach(() => { useWorkshop.setState({ palette: [] } as never) })

describe('the palette sheet names colors by number', () => {
  it('reads out the color in hand by number and hex, without hover', async () => {
    const hex = hexAt(BUILT_IN, 171)
    const m = await sheet(hex)
    const now = readout(m.all())
    expect(now).toBeDefined()
    const words = textOf(now!)
    expect(words).toContain('IN HAND')
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

  it('swaps a picked swatch\'s number for the check while building a palette', async () => {
    const m = await sheet(hexAt(BUILT_IN, 0))
    await m.press('NEW PALETTE')
    expect(readout(m.all())).toBeUndefined()
    const first = swatches(m.all())[5]
    ;(first.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 5))
    const after = swatches(m.all())
    expect(numberOf(after[5])).toBeNull()
    expect(numberOf(after[6])).toBe('6')
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
  })
})
