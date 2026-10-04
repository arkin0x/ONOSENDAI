/**
 * colorTools.test.ts - the dropper, the recent row, and the clipboard keys
 * (ported with snocrash's color corner, arkinox 2026-09-27).
 *
 * The dropper takes the one selected point's color, or a selected face's
 * (its hard color when it has one, else the average of its corners), snapped onto the object's palette, into hand and
 * onto the front of the recent row. The recent row holds only colors somebody
 * picked: it starts empty, and the starter swatches older builds seeded are
 * dropped unless they were picked. COPY holds the selection without moving it
 * and CLEAR CLIPBOARD lets it go.
 */

import { beforeEach, describe, expect, it } from 'vitest'

// The stores keep shards and deployments in localStorage; the test runs where
// there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { hexToRgb, newShard, rgbToHex, type ShardModel } from 'sno-core/shards'
import { BUILT_IN, hexAt, snapHex } from 'sno-core/snoPalette'
import { DEFAULT_PALETTE, unseeded, useWorkshop } from '../useWorkshop'

const w = () => useWorkshop.getState()
const RED = hexAt(BUILT_IN, 238)
const BLUE = hexAt(BUILT_IN, 239)
const WHITE = hexAt(BUILT_IN, 225)

function bench(): ShardModel {
  const s: ShardModel = {
    ...newShard('Tri'),
    vertices: [
      { p: [0, 0, 0], c: hexToRgb(RED) },
      { p: [1, 0, 0], c: hexToRgb(BLUE) },
      { p: [0, 1, 0], c: hexToRgb(WHITE) },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [s], currentId: s.id, selection: [], partSel: [], selectedFace: null, palette: [], clip: null, color: [0, 0.9, 1] })
  return s
}

beforeEach(() => { bench() })

describe('the dropper', () => {
  it('takes the one selected point\'s color into hand and onto the front of the recent row', () => {
    useWorkshop.setState({ selection: [1] })
    w().sampleColor()
    expect(rgbToHex(w().color)).toBe(BLUE)
    expect(w().palette[0]).toBe(BLUE)
  })

  it('takes a selected face\'s color as the average of its corners, snapped onto the palette', () => {
    useWorkshop.setState({ selectedFace: 0 })
    w().sampleColor()
    const cs = [RED, BLUE, WHITE].map(hexToRgb)
    const mean = [0, 1, 2].map((k) => (cs[0][k] + cs[1][k] + cs[2][k]) / 3) as [number, number, number]
    const want = snapHex(BUILT_IN, rgbToHex(mean))!
    expect(rgbToHex(w().color)).toBe(want)
    expect(w().palette).toEqual([want])
  })

  it('takes a face\'s hard color (SEAM) when it has one, not the average of its corners', () => {
    const s = w().current()!
    const GREEN = hexAt(BUILT_IN, 246)
    useWorkshop.setState({ shards: [{ ...s, facecolors: [hexToRgb(GREEN)] }], selectedFace: 0 })
    w().sampleColor()
    expect(rgbToHex(w().color)).toBe(GREEN)
    expect(w().palette[0]).toBe(GREEN)
  })

  it('does nothing with several points, or none, in hand, and paints nothing ever', () => {
    const before = w().current()!.vertices
    useWorkshop.setState({ selection: [0, 1] })
    w().sampleColor()
    useWorkshop.setState({ selection: [] })
    w().sampleColor()
    expect(w().palette).toEqual([])
    expect(w().current()!.vertices).toBe(before)
  })
})

describe('the recent row', () => {
  it('drops the old starter swatches nobody picked, and keeps what was picked', () => {
    expect(unseeded([...DEFAULT_PALETTE])).toEqual([])
    // A picked color goes to the front; the seeds behind it were never picked.
    expect(unseeded(['#123456', ...DEFAULT_PALETTE])).toEqual(['#123456'])
    // A seed that was picked moved to the front, so it stays; the rest go.
    const picked = DEFAULT_PALETTE[3]
    expect(unseeded([picked, ...DEFAULT_PALETTE.filter((h) => h !== picked)])).toEqual([picked])
    // A list that never had the seeds is untouched.
    expect(unseeded(['#123456', '#abcdef'])).toEqual(['#123456', '#abcdef'])
  })
})

describe('COPY and CLEAR CLIPBOARD', () => {
  it('COPY holds the selection and leaves it where it is; CLEAR lets it go', () => {
    const before = w().current()!.vertices
    useWorkshop.setState({ selection: [0, 1] })
    w().copySelection()
    expect(w().clip?.points).toHaveLength(2)
    expect(w().current()!.vertices).toBe(before)
    w().clearClip()
    expect(w().clip).toBeNull()
  })
})

describe('a palette on nostr', () => {
  it('goes out as kind 3367 with one c tag per color in index order, its name, and nothing in content', async () => {
    const { paletteTemplate, PALETTE_KIND } = await import('../usePaletteNet')
    const colors = [hexToRgb(RED), hexToRgb(BLUE)].map((c) => c.map((x) => Math.round(x * 255))) as [number, number, number][]
    const t = paletteTemplate('Two', colors, 1_800_000_000)
    expect(t.kind).toBe(PALETTE_KIND)
    expect(t.tags.filter((x) => x[0] === 'c').map((x) => x[1])).toEqual([RED, BLUE])
    expect(t.tags).toContainEqual(['name', 'Two'])
    expect(t.tags).toContainEqual(['client', 'ONOSENDAI'])
    expect(t.content).toBe('')
  })

  it('an edit names the event it corrects, and the chain start once they differ', async () => {
    const { paletteTemplate } = await import('../usePaletteNet')
    const colors: [number, number, number][] = [[255, 0, 0], [0, 0, 255]]
    const t = paletteTemplate('Two', colors, 1_800_000_000, { id: 'b'.repeat(64), genesis: 'a'.repeat(64), relays: ['wss://r.test'] })
    expect(t.tags).toContainEqual(['e', 'b'.repeat(64), 'wss://r.test', 'previous'])
    expect(t.tags).toContainEqual(['e', 'a'.repeat(64), '', 'genesis'])
  })
})
